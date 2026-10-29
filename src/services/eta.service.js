import { hashObject } from '../utils/hash.js';
import { etaId } from '../utils/idGenerator.js';
import { MINUTE, toMs } from '../utils/time.js';
import { compareEvents } from '../domain/lifecycle.js';
import { legTransitPlan, plannedDwellMinutes, routeStopIds } from '../domain/network.js';
import { FIRST_WAVE_MINUTE, plannedDeliveryWave, retryWaveAfter } from '../domain/operations.js';

/**
 * Transparent, deterministic, rule-based ETA engine (not a trained model).
 *
 *   ETA = predictionAt + base remaining duration (planned dwell + planned transit x carrier factor
 *         + last-mile wave) + per-facility max(queue adjustment, weather adjustment) + hold adjustment
 *
 * Temporal integrity: the engine itself filters every input to what was known at predictionAt
 * (ingestedAt <= predictionAt and occurredAt <= predictionAt). Callers may pass more data than
 * was available; it is ignored. Outcome fields (status, deliveredAt, ground truth) are never inputs.
 */
export const ETA_CONFIG = Object.freeze({
  algorithmVersion: 'eta-rules-v1.0.0',
  queueLookbackMinutes: 480,
  queueHorizonMinutes: 360,
  minRemainingTransitMinutes: 15,
  minRemainingLastMileMinutes: 30,
  expectedDeliveryOffsetMinutes: 270,
  exceptionHoldMinutes: 1440,
  staleEventHours: 24,
  firstWaveMinute: FIRST_WAVE_MINUTE,
});
export const ETA_CONFIG_HASH = hashObject(ETA_CONFIG);

/** The only shipment attributes the engine may see: facts fixed at shipment creation. */
export const PREDICTION_SHIPMENT_FIELDS = Object.freeze([
  'shipmentId',
  'carrierId',
  'serviceLevelId',
  'originFacilityId',
  'destinationFacilityId',
  'plannedRouteId',
  'createdAt',
  'plannedPickupAt',
  'promisedDeliveryAt',
]);

export function toPredictionShipment(shipment) {
  const view = {};
  for (const field of PREDICTION_SHIPMENT_FIELDS) view[field] = shipment[field];
  view.createdAt = toMs(view.createdAt);
  view.plannedPickupAt = toMs(view.plannedPickupAt);
  view.promisedDeliveryAt = toMs(view.promisedDeliveryAt);
  return Object.freeze(view);
}

const normEvent = (e) => ({
  eventId: e.eventId,
  sequence: e.sequence,
  eventType: e.eventType,
  facilityId: e.facilityId,
  exceptionCode: e.exceptionCode ?? null,
  toRouteId: e.routeChange?.toRouteId ?? null,
  occurredAt: toMs(e.occurredAt),
  ingestedAt: toMs(e.ingestedAt),
});

/** Eligible = received AND happened by the prediction time; exact duplicates are dropped. */
export function selectEligibleEvents(events, predictionAt) {
  const t = toMs(predictionAt);
  const eligible = [];
  const duplicates = [];
  const seen = new Set();
  for (const e of events.map(normEvent).sort(compareEvents)) {
    if (e.ingestedAt > t || e.occurredAt > t) continue;
    const key = `${e.eventType}|${e.facilityId}|${e.occurredAt}`;
    if (seen.has(key)) duplicates.push(e);
    else {
      seen.add(key);
      eligible.push(e);
    }
  }
  return { eligible, duplicates };
}

function locate(eligible, plannedRoute, routesById) {
  let route = plannedRoute;
  let stops = routeStopIds(route);
  let position = { phase: 'PRE_PICKUP', stopIndex: null, at: null };
  let progress = -1;
  const ignored = [];
  for (const e of eligible) {
    if (position.phase === 'DELIVERED') {
      ignored.push(e);
      continue;
    }
    const idx = stops.indexOf(e.facilityId);
    switch (e.eventType) {
      case 'ROUTE_CHANGED': {
        const next = e.toRouteId ? routesById.get(e.toRouteId) : null;
        const nextIdx = next ? routeStopIds(next).indexOf(e.facilityId) : -1;
        if (!next || nextIdx < 0) {
          ignored.push(e);
          break;
        }
        route = next;
        stops = routeStopIds(next);
        progress = nextIdx;
        if (position.phase === 'AT_FACILITY') position = { ...position, stopIndex: nextIdx };
        else position = { phase: 'AT_FACILITY', stopIndex: nextIdx, at: e.occurredAt };
        break;
      }
      case 'PICKED_UP':
        if (progress > 0 || idx !== 0) ignored.push(e);
        else {
          position = { phase: 'AT_FACILITY', stopIndex: 0, at: e.occurredAt };
          progress = 0;
        }
        break;
      case 'ARRIVED_AT_FACILITY':
        if (idx < 0 || idx < progress || (idx === progress && position.phase === 'IN_TRANSIT'))
          ignored.push(e);
        else {
          position = { phase: 'AT_FACILITY', stopIndex: idx, at: e.occurredAt };
          progress = idx;
        }
        break;
      case 'DEPARTED_FACILITY':
        if (idx < 0 || idx < progress || idx === stops.length - 1) ignored.push(e);
        else {
          position = { phase: 'IN_TRANSIT', stopIndex: idx, at: e.occurredAt };
          progress = idx;
        }
        break;
      case 'OUT_FOR_DELIVERY':
        position = { phase: 'OUT_FOR_DELIVERY', stopIndex: stops.length - 1, at: e.occurredAt };
        progress = stops.length - 1;
        break;
      case 'DELIVERY_ATTEMPTED':
        position = { phase: 'ATTEMPT_FAILED', stopIndex: stops.length - 1, at: e.occurredAt };
        break;
      case 'EXCEPTION':
        position = {
          phase: 'HOLD',
          stopIndex: position.stopIndex ?? 0,
          at: e.occurredAt,
          prior: position,
        };
        break;
      case 'DELIVERED':
        position = { phase: 'DELIVERED', stopIndex: stops.length - 1, at: e.occurredAt };
        break;
      default:
        ignored.push(e);
    }
  }
  return { route, stops, position, ignored };
}

/**
 * Compute one ETA snapshot.
 * @param {object} input
 * @param {object} input.shipment       prediction view (see toPredictionShipment)
 * @param {number|Date} input.predictionAt
 * @param {Array}  input.events          tracking events (any superset; engine filters)
 * @param {Map}    input.routesById
 * @param {Map}    input.facilitiesById
 * @param {object|null} input.carrier    null when the reference is broken (factor 1.0 fallback)
 * @param {object} input.serviceLevel
 * @param {object} input.queueSource     { candidates(facilityId, fromMs, toMs) }
 * @param {object} input.weatherIndex    { forFacility(facilityId) }
 */
export function computeEta(input) {
  const {
    shipment,
    events,
    routesById,
    facilitiesById,
    carrier,
    serviceLevel,
    queueSource,
    weatherIndex,
  } = input;
  const cfg = ETA_CONFIG;
  const t = toMs(input.predictionAt);
  const plannedRoute = routesById.get(shipment.plannedRouteId);
  if (!plannedRoute) throw new Error(`ETA: unknown planned route ${shipment.plannedRouteId}`);

  const { eligible, duplicates } = selectEligibleEvents(events, t);
  const { route, stops, position, ignored } = locate(eligible, plannedRoute, routesById);
  const carrierFactor = carrier ? carrier.transitTimeFactor : 1;

  const usedQueue = new Map();
  const appliedWeather = new Map();
  const totals = { queue: 0, weather: 0, hold: 0 };

  function latestQueueObservation(facilityId) {
    let best = null;
    for (const obs of queueSource.candidates(
      facilityId,
      t - cfg.queueLookbackMinutes * MINUTE,
      t,
    )) {
      const observed = toMs(obs.observedAt);
      if (toMs(obs.ingestedAt) > t || observed > t) continue;
      if (!best || observed > toMs(best.observedAt)) best = obs;
    }
    return best;
  }

  /** Per facility: max(queue, weather) so a weather-driven queue surge is never counted twice. */
  function facilityAdjustment(facilityId, expectedAt) {
    let queue = 0;
    let queueObs = null;
    if (expectedAt - t <= cfg.queueHorizonMinutes * MINUTE) {
      queueObs = latestQueueObservation(facilityId);
      if (queueObs)
        queue = Math.max(0, queueObs.estimatedWaitMinutes - queueObs.baselineWaitMinutes);
    }
    let weather = 0;
    let weatherEvent = null;
    for (const ev of weatherIndex.forFacility(facilityId)) {
      if (ev.ingestedAt > t || ev.endAt <= t) continue; // unknown yet, or already over
      if (ev.startAt > expectedAt || expectedAt >= ev.endAt) continue;
      if (appliedWeather.has(ev.weatherEventId)) continue; // each window counted once per shipment
      if (ev.expectedDelayMinutes > weather) {
        weather = ev.expectedDelayMinutes;
        weatherEvent = ev;
      }
    }
    if (queueObs) usedQueue.set(queueObs.queueObservationId, toMs(queueObs.ingestedAt));
    if (weather > queue) {
      appliedWeather.set(weatherEvent.weatherEventId, weatherEvent.ingestedAt);
      totals.weather += weather;
      return weather;
    }
    totals.queue += queue;
    return queue;
  }

  const transitMinutes = (legIndex) =>
    Math.round(legTransitPlan(route.legs[legIndex], serviceLevel).minutes * carrierFactor);
  const dwell = (facilityId) => plannedDwellMinutes(facilitiesById.get(facilityId), serviceLevel);

  function project(useAdjustments) {
    const adjust = (facilityId, at) => (useAdjustments ? facilityAdjustment(facilityId, at) : 0);
    const last = stops.length - 1;
    let pos = position;
    let holdMinutes = 0;
    if (pos.phase === 'DELIVERED') return pos.at;
    if (pos.phase === 'OUT_FOR_DELIVERY') {
      return Math.max(
        t + cfg.minRemainingLastMileMinutes * MINUTE,
        pos.at + cfg.expectedDeliveryOffsetMinutes * MINUTE,
      );
    }
    if (pos.phase === 'ATTEMPT_FAILED') {
      const retry = Math.max(retryWaveAfter(pos.at), t);
      return retry + cfg.expectedDeliveryOffsetMinutes * MINUTE;
    }
    if (pos.phase === 'HOLD') {
      holdMinutes = useAdjustments ? cfg.exceptionHoldMinutes : 0;
      if (useAdjustments) totals.hold += holdMinutes;
      const resumeAt = Math.max(t, pos.at) + holdMinutes * MINUTE;
      pos = { phase: 'AT_FACILITY', stopIndex: pos.stopIndex ?? 0, at: resumeAt };
    }

    let idx;
    let arrival;
    if (pos.phase === 'PRE_PICKUP') {
      idx = 0;
      arrival = Math.max(t, shipment.plannedPickupAt);
    } else if (pos.phase === 'IN_TRANSIT') {
      idx = pos.stopIndex + 1;
      arrival = Math.max(
        t + cfg.minRemainingTransitMinutes * MINUTE,
        pos.at + transitMinutes(pos.stopIndex) * MINUTE,
      );
    } else {
      idx = pos.stopIndex;
      arrival = pos.at;
    }
    // Dead reckoning: without a departure scan the parcel is assumed to have left on its planned
    // schedule (missed/absent departure scans are common), not to be leaving "now".
    while (idx < last) {
      const facilityId = stops[idx];
      const extra = adjust(facilityId, Math.max(arrival, t));
      const departure = arrival + (dwell(facilityId) + extra) * MINUTE;
      arrival = departure + transitMinutes(idx) * MINUTE;
      idx += 1;
    }
    const destination = stops[last];
    const extra = adjust(destination, Math.max(arrival, t));
    // A parcel "due" at the station but not yet scanned there is treated as becoming ready now.
    const ready = Math.max(t, arrival + (dwell(destination) + extra) * MINUTE);
    return Math.max(
      t + cfg.minRemainingLastMileMinutes * MINUTE,
      plannedDeliveryWave(ready) + cfg.expectedDeliveryOffsetMinutes * MINUTE,
    );
  }

  // Once delivery is known the "estimate" is the observed delivery time (may precede t).
  const delivered = position.phase === 'DELIVERED';
  const baseArrival = delivered ? position.at : Math.max(t, project(false));
  const estimatedArrival = delivered ? position.at : Math.max(t, project(true));
  const totalRemaining = Math.round((estimatedArrival - t) / MINUTE);
  const baseRemaining = Math.round((baseArrival - t) / MINUTE);
  const interaction = totalRemaining - baseRemaining - totals.queue - totals.weather - totals.hold;

  const lastEvent = eligible.at(-1) ?? null;
  const maxOf = (values) => (values.length ? Math.max(...values) : null);
  const ignoredAll = [...ignored, ...duplicates];
  let confidence = 'HIGH';
  if (position.phase === 'HOLD' || ignoredAll.length || !carrier) confidence = 'LOW';
  else if (!lastEvent || t - lastEvent.occurredAt > cfg.staleEventHours * 60 * MINUTE)
    confidence = 'MEDIUM';

  const remainingFacilityIds =
    position.phase === 'DELIVERED'
      ? []
      : position.phase === 'PRE_PICKUP'
        ? stops
        : stops.slice(
            position.phase === 'IN_TRANSIT' ? position.stopIndex + 1 : (position.stopIndex ?? 0),
          );
  const queueObservationIds = [...usedQueue.keys()].sort();
  const weatherEventIds = [...appliedWeather.keys()].sort();

  const inputHash = hashObject({
    shipmentId: shipment.shipmentId,
    predictionAt: t,
    plannedRouteId: shipment.plannedRouteId,
    routeId: route.routeId,
    events: eligible.map((e) => [e.eventId, e.occurredAt, e.ingestedAt]),
    ignored: ignoredAll.map((e) => e.eventId).sort(),
    queueObservationIds,
    weatherEventIds,
    carrierKnown: Boolean(carrier),
    configHash: ETA_CONFIG_HASH,
  });

  return {
    shipmentId: shipment.shipmentId,
    predictionAt: t,
    estimatedArrivalAt: estimatedArrival,
    algorithmVersion: cfg.algorithmVersion,
    configHash: ETA_CONFIG_HASH,
    inputHash,
    confidence,
    position: {
      phase: position.phase,
      routeId: route.routeId,
      stopIndex: position.stopIndex ?? null,
      facilityId:
        position.stopIndex === null || position.stopIndex === undefined
          ? null
          : stops[position.stopIndex],
    },
    watermark: {
      eventsConsidered: eligible.length,
      lastEventId: lastEvent?.eventId ?? null,
      lastEventOccurredAt: lastEvent?.occurredAt ?? null,
      maxEventIngestedAt: maxOf(eligible.map((e) => e.ingestedAt)),
      maxQueueIngestedAt: maxOf([...usedQueue.values()]),
      maxWeatherIngestedAt: maxOf([...appliedWeather.values()]),
    },
    inputs: {
      eventIds: eligible.map((e) => e.eventId),
      ignoredEventIds: ignoredAll.map((e) => e.eventId).sort(),
      queueObservationIds,
      weatherEventIds,
      remainingFacilityIds,
      carrierKnown: Boolean(carrier),
    },
    adjustments: {
      baseRemainingMinutes: baseRemaining,
      queueMinutes: totals.queue,
      weatherMinutes: totals.weather,
      holdMinutes: totals.hold,
      interactionMinutes: interaction,
      totalRemainingMinutes: totalRemaining,
    },
  };
}

const dateOrNull = (ms) => (ms === null || ms === undefined ? null : new Date(ms));

/** Convert an engine result into an ETAEstimate document (evaluation is attached separately). */
export function toEtaDocument(result, partition) {
  return {
    etaId: etaId(result.shipmentId, result.predictionAt),
    shipmentId: result.shipmentId,
    partition,
    predictionAt: new Date(result.predictionAt),
    estimatedArrivalAt: new Date(result.estimatedArrivalAt),
    algorithmVersion: result.algorithmVersion,
    configHash: result.configHash,
    inputHash: result.inputHash,
    confidence: result.confidence,
    position: result.position,
    watermark: {
      ...result.watermark,
      lastEventOccurredAt: dateOrNull(result.watermark.lastEventOccurredAt),
      maxEventIngestedAt: dateOrNull(result.watermark.maxEventIngestedAt),
      maxQueueIngestedAt: dateOrNull(result.watermark.maxQueueIngestedAt),
      maxWeatherIngestedAt: dateOrNull(result.watermark.maxWeatherIngestedAt),
    },
    inputs: result.inputs,
    adjustments: result.adjustments,
    evaluation: null,
  };
}

/** Evaluation-only metrics, computed after the outcome is known. */
export function evaluateEta(estimatedArrivalAt, predictionAt, actualArrivalAt) {
  if (actualArrivalAt === null || actualArrivalAt === undefined) return null;
  const actual = toMs(actualArrivalAt);
  const errorMinutes = Math.round((toMs(estimatedArrivalAt) - actual) / MINUTE);
  return {
    actualArrivalAt: new Date(actual),
    errorMinutes,
    absErrorMinutes: Math.abs(errorMinutes),
    horizonMinutes: Math.round((actual - toMs(predictionAt)) / MINUTE),
  };
}

/** Standard prediction schedule: createdAt + 1h, 24h, 48h, 96h, plus the dataset snapshot time. */
export const PREDICTION_OFFSETS_MINUTES = Object.freeze([60, 1440, 2880, 5760]);

/**
 * Prediction times for a shipment. Stops once a DELIVERED event has been *ingested*
 * (the system knows the outcome), which uses only information available at each time.
 */
export function predictionTimes(createdAt, asOf, events) {
  const created = toMs(createdAt);
  const asOfMs = toMs(asOf);
  const delivered = events.find((e) => e.eventType === 'DELIVERED');
  const knownDeliveredAt = delivered ? toMs(delivered.ingestedAt) : Infinity;
  const times = new Set();
  for (const offset of PREDICTION_OFFSETS_MINUTES) {
    const at = created + offset * MINUTE;
    if (at <= asOfMs && at < knownDeliveredAt) times.add(at);
  }
  if (asOfMs > created && asOfMs < knownDeliveredAt) times.add(asOfMs);
  return [...times].sort((a, b) => a - b);
}
