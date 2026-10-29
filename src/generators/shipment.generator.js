import { rngFor } from './rng.js';
import { shipmentId as makeShipmentId } from '../utils/idGenerator.js';
import { DAY, HOUR, MINUTE, startOfUtcDay } from '../utils/time.js';
import { computePlannedPickupAt, computePromisedDeliveryAt } from '../domain/sla.js';
import { legTransitPlan, plannedDwellMinutes, plannedRemainingMinutes } from '../domain/network.js';
import {
  FIRST_WAVE_MINUTE,
  SECOND_WAVE_CUTOFF_MINUTE,
  weatherDwellAt,
  weatherTransitSlowdown,
} from '../domain/operations.js';

// Physical simulation of one shipment. Produces the true timeline (pickup, every leg, last mile)
// with every delay component recorded, plus the ordered list of scan opportunities ("milestones").
// What the platform later *observes* (events, statuses) is derived from this in event.generator.

const CREATION_HOUR_WEIGHTS = [
  1, 1, 1, 1, 1, 1, 2, 4, 6, 8, 9, 9, 9, 9, 8, 8, 7, 6, 4, 3, 2, 2, 1, 1,
];
const HOURS = [...Array(24).keys()];

export const FATE_RATES = Object.freeze({
  neverPickedUp: 0.003,
  damaged: 0.004,
  attemptFailed: 0.03,
});
export const REROUTE = Object.freeze({
  severeWeatherProbability: 0.7,
  capacityProbability: 0.012,
  minSeverity: 3,
});

function baselineCreatedAt(ctx, seq, rng) {
  const { config, startMs, asOfMs } = ctx;
  const day = Math.floor(((seq - 1) * config.simulationDays) / config.shipments);
  const hour = rng.weighted(HOURS, CREATION_HOUR_WEIGHTS);
  let created = startMs + day * DAY + hour * HOUR + rng.int(0, 59) * MINUTE;
  const latest = asOfMs - 2 * HOUR;
  if (created > latest) created = latest - rng.int(0, 600) * MINUTE;
  return created;
}

function pickStations(ctx, rng) {
  const { stations, stationWeights } = ctx;
  const origin = rng.weighted(stations, stationWeights);
  let destination = origin;
  while (destination.facilityId === origin.facilityId)
    destination = rng.weighted(stations, stationWeights);
  return [origin, destination];
}

/**
 * @param {object} ctx        generation context
 * @param {number} seq        shipment sequence number (baseline 1..N, anomalies 900001+)
 * @param {object} overrides  forced attributes (used to build controlled anomaly cases)
 */
export function simulateShipment(ctx, seq, overrides = {}) {
  const rng = rngFor(ctx.seed, 'shipment', seq);
  const { asOfMs, facilitiesById, routeIndex, weatherIndex, queueModel } = ctx;

  const createdAt = overrides.createdAt ?? baselineCreatedAt(ctx, seq, rng);
  const serviceLevel = ctx.serviceLevelsById.get(
    overrides.serviceLevelId ??
      rng.weighted(
        ctx.serviceLevels.map((s) => s.serviceLevelId),
        ctx.serviceLevels.map((s) => s.mixWeight),
      ),
  );
  const eligibleCarriers = ctx.carriersByServiceLevel.get(serviceLevel.serviceLevelId);
  const carrier = overrides.carrierId
    ? ctx.carriersById.get(overrides.carrierId)
    : rng.weighted(
        eligibleCarriers,
        eligibleCarriers.map((c) => c.marketShareWeight),
      );
  let [origin, destination] = pickStations(ctx, rng);
  if (overrides.originFacilityId) origin = facilitiesById.get(overrides.originFacilityId);
  if (overrides.destinationFacilityId)
    destination = facilitiesById.get(overrides.destinationFacilityId);

  const routes = routeIndex.forPair(origin.facilityId, destination.facilityId);
  const plannedRoute = routes.primary;
  const zone = plannedRoute.distanceZone;
  const promisedDeliveryAt = computePromisedDeliveryAt(createdAt, serviceLevel, zone);
  const plannedPickupAt = computePlannedPickupAt(createdAt, serviceLevel);

  const fates = {
    neverPickedUp: rng.chance(FATE_RATES.neverPickedUp),
    damaged: rng.chance(FATE_RATES.damaged),
    attemptFailed: rng.chance(FATE_RATES.attemptFailed),
    ...(overrides.fates ?? {}),
  };
  const damagedAtStop = rng.int(1, plannedRoute.stops.length - 2);

  const plan = {
    seq,
    shipmentId: makeShipmentId(ctx.year, seq),
    createdAt,
    serviceLevel,
    carrier,
    origin,
    destination,
    plannedRoute,
    finalRoute: plannedRoute,
    zone,
    promisedDeliveryAt,
    plannedPickupAt,
    weightKg: Number(Math.min(999, Math.max(0.2, rng.lognormalFactor(0.9) * 4)).toFixed(2)),
    pieces: rng.weighted([1, 2, 3, 4, 6, 10], [60, 18, 9, 6, 4, 3]),
    fates,
    pickupAt: null,
    routeChange: null,
    legs: [],
    hold: null,
    lastMile: null,
    deliveredAt: null,
    milestones: [],
  };

  // Every leg of the planned route starts as a planned (not yet travelled) leg.
  const plannedLeg = (route, legIndex) => {
    const leg = route.legs[legIndex];
    const transit = legTransitPlan(leg, serviceLevel);
    return {
      routeId: route.routeId,
      routeLegSequence: leg.sequence,
      fromFacilityId: leg.fromFacilityId,
      toFacilityId: leg.toFacilityId,
      transportMode: transit.mode,
      distanceKm: leg.distanceKm,
      plannedDwellMinutes: plannedDwellMinutes(
        facilitiesById.get(leg.fromFacilityId),
        serviceLevel,
      ),
      plannedTransitMinutes: transit.minutes,
      startAt: null,
      departureAt: null,
      arrivalAt: null,
      queueMinutes: 0,
      weatherMinutes: 0,
      carrierMinutes: 0,
      weatherEventIds: [],
      cancelledAt: null,
    };
  };

  if (fates.neverPickedUp) {
    plan.legs = plannedRoute.legs.map((_, i) => plannedLeg(plannedRoute, i));
    return plan;
  }

  // ---- Pickup ----
  const pickupLate = rng.chance(carrier.onTimePickupRate) ? 0 : rng.int(60, 360);
  plan.pickupAt = Math.max(
    createdAt + 15 * MINUTE,
    plannedPickupAt + (rng.int(-60, 60) + pickupLate) * MINUTE,
  );
  const milestones = plan.milestones;
  milestones.push({
    type: 'PICKED_UP',
    facilityId: origin.facilityId,
    at: plan.pickupAt,
    legSeq: 1,
    optional: null,
  });

  // ---- Linehaul legs ----
  let route = plannedRoute;
  let arrival = plan.pickupAt;
  let k = 0;
  const legs = [];
  while (k < route.legs.length) {
    const leg = plannedLeg(route, k);
    legs.push(leg);
    const legSeq = legs.length;
    const facilityId = leg.fromFacilityId;
    leg.startAt = arrival;

    if (fates.damaged && k === damagedAtStop) {
      const at = arrival + rng.int(10, 120) * MINUTE;
      plan.hold = { facilityId, at, legSeq };
      milestones.push({
        type: 'EXCEPTION',
        facilityId,
        at,
        legSeq,
        optional: null,
        exceptionCode: 'DAMAGED',
      });
      // Remaining planned legs stay PLANNED; nothing further happens physically.
      for (let j = k + 1; j < route.legs.length; j += 1) legs.push(plannedLeg(route, j));
      break;
    }

    // Reroute decision at the origin hub (stop 1) for cross-hub routes with an alternate.
    const alternate =
      k === 1 && route.routeType === 'PRIMARY'
        ? routeIndex.forPair(origin.facilityId, destination.facilityId).alternate
        : null;
    if (alternate && overrides.allowReroute !== false) {
      const decisionAt = arrival + rng.int(10, 40) * MINUTE;
      const downstreamHub = route.legs[1].toFacilityId;
      const expectedAtHub =
        decisionAt + (leg.plannedDwellMinutes + leg.plannedTransitMinutes) * MINUTE;
      const knownSevere = weatherIndex
        .forFacility(downstreamHub)
        .some(
          (ev) =>
            ev.ingestedAt <= decisionAt &&
            ev.severity >= REROUTE.minSeverity &&
            ev.startAt <= expectedAtHub &&
            expectedAtHub < ev.endAt,
        );
      const roll = rng.next();
      const reason =
        knownSevere && roll < REROUTE.severeWeatherProbability
          ? 'WEATHER_AVOIDANCE'
          : roll < REROUTE.capacityProbability
            ? 'LINEHAUL_CAPACITY'
            : null;
      // The reroute (and its SYSTEM event, ingested within 2 min) must be inside the snapshot.
      if (reason && decisionAt + 5 * MINUTE <= asOfMs) {
        const extraPlannedMinutes =
          plannedRemainingMinutes(alternate, 1, facilitiesById, serviceLevel) -
          plannedRemainingMinutes(route, 1, facilitiesById, serviceLevel);
        // Cancel the remaining planned legs; they keep their sequence numbers for history.
        legs.pop();
        for (let j = 1; j < route.legs.length; j += 1) {
          const cancelled = plannedLeg(route, j);
          cancelled.cancelledAt = decisionAt;
          legs.push(cancelled);
        }
        plan.routeChange = {
          occurredAt: decisionAt,
          atFacilityId: facilityId,
          reason,
          fromRouteId: route.routeId,
          toRouteId: alternate.routeId,
          extraPlannedMinutes,
        };
        route = alternate;
        plan.finalRoute = alternate;
        Object.assign(leg, plannedLeg(route, k), { startAt: arrival });
        legs.push(leg);
        milestones.push({
          type: 'ROUTE_CHANGED',
          facilityId,
          at: decisionAt,
          legSeq: legs.length,
          optional: null,
          routeChange: {
            fromRouteId: plan.routeChange.fromRouteId,
            toRouteId: alternate.routeId,
            reason,
          },
        });
      }
    }
    const currentLegSeq = legs.length;

    const queue = queueModel.queueExtraMinutes(facilityId, arrival);
    const weatherDwell = weatherDwellAt(weatherIndex, facilityId, arrival);
    const departure = arrival + (leg.plannedDwellMinutes + queue + weatherDwell.minutes) * MINUTE;
    const noise = carrier.transitTimeFactor * rng.lognormalFactor(carrier.transitVariability);
    const slowdown = weatherTransitSlowdown(
      weatherIndex,
      facilityId,
      departure,
      leg.toFacilityId,
      departure + leg.plannedTransitMinutes * MINUTE,
    );
    const weatherTransit = Math.round((leg.plannedTransitMinutes * slowdown.pct) / 100);
    const transit = Math.max(10, Math.round(leg.plannedTransitMinutes * noise) + weatherTransit);
    leg.departureAt = departure;
    leg.arrivalAt = departure + transit * MINUTE;
    leg.queueMinutes = queue;
    leg.weatherMinutes = weatherDwell.minutes + weatherTransit;
    leg.carrierMinutes = transit - leg.plannedTransitMinutes - weatherTransit;
    leg.weatherEventIds = [
      ...new Set([...(weatherDwell.eventId ? [weatherDwell.eventId] : []), ...slowdown.eventIds]),
    ].sort();

    milestones.push({
      type: 'DEPARTED_FACILITY',
      facilityId,
      at: departure,
      legSeq: currentLegSeq,
      optional: 'DEPARTURE',
    });
    const isFinal = k === route.legs.length - 1;
    milestones.push({
      type: 'ARRIVED_AT_FACILITY',
      facilityId: leg.toFacilityId,
      at: leg.arrivalAt,
      legSeq: currentLegSeq,
      optional: isFinal ? null : 'ARRIVAL',
    });
    arrival = leg.arrivalAt;
    k += 1;
  }
  plan.legs = legs;
  if (plan.hold) return plan;

  // ---- Last mile ----
  const lastLegSeq = legs.length;
  const destId = destination.facilityId;
  const dwellPlanned = plannedDwellMinutes(destination, serviceLevel);
  const queue = queueModel.queueExtraMinutes(destId, arrival);
  const weatherDwell = weatherDwellAt(weatherIndex, destId, arrival);
  const readyAt = arrival + (dwellPlanned + queue + weatherDwell.minutes) * MINUTE;
  const dayStart = startOfUtcDay(readyAt);
  let ofd;
  if (readyAt <= dayStart + FIRST_WAVE_MINUTE * MINUTE)
    ofd = dayStart + FIRST_WAVE_MINUTE * MINUTE + rng.int(0, 45) * MINUTE;
  else if (readyAt <= dayStart + SECOND_WAVE_CUTOFF_MINUTE * MINUTE)
    ofd = readyAt + rng.int(15, 45) * MINUTE;
  else ofd = dayStart + DAY + FIRST_WAVE_MINUTE * MINUTE + rng.int(0, 45) * MINUTE;
  const firstOfd = ofd;
  milestones.push({
    type: 'OUT_FOR_DELIVERY',
    facilityId: destId,
    at: ofd,
    legSeq: lastLegSeq,
    optional: null,
  });
  let attemptDelayMinutes = 0;
  if (fates.attemptFailed) {
    const attemptAt = ofd + rng.int(120, 480) * MINUTE;
    milestones.push({
      type: 'DELIVERY_ATTEMPTED',
      facilityId: destId,
      at: attemptAt,
      legSeq: lastLegSeq,
      optional: null,
      exceptionCode: 'DELIVERY_ATTEMPT_FAILED',
    });
    ofd = startOfUtcDay(attemptAt) + DAY + FIRST_WAVE_MINUTE * MINUTE + rng.int(0, 45) * MINUTE;
    attemptDelayMinutes = Math.round((ofd - firstOfd) / MINUTE);
    milestones.push({
      type: 'OUT_FOR_DELIVERY',
      facilityId: destId,
      at: ofd,
      legSeq: lastLegSeq,
      optional: null,
    });
  }
  plan.deliveredAt = ofd + rng.int(60, 540) * MINUTE;
  milestones.push({
    type: 'DELIVERED',
    facilityId: destId,
    at: plan.deliveredAt,
    legSeq: lastLegSeq,
    optional: null,
  });
  plan.lastMile = {
    arrivedAtStationAt: arrival,
    readyAt,
    plannedDwellMinutes: dwellPlanned,
    queueMinutes: queue,
    weatherMinutes: weatherDwell.minutes,
    weatherEventIds: weatherDwell.eventId ? [weatherDwell.eventId] : [],
    firstOutForDeliveryAt: firstOfd,
    attemptFailed: Boolean(fates.attemptFailed),
    attemptDelayMinutes,
  };
  return plan;
}
