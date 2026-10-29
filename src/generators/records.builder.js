import { legId } from '../utils/idGenerator.js';
import { MINUTE } from '../utils/time.js';
import { deriveStatus } from '../domain/lifecycle.js';
import {
  computeEta,
  evaluateEta,
  predictionTimes,
  toEtaDocument,
  toPredictionShipment,
} from '../services/eta.service.js';
import { buildDelayRecords, buildGroundTruth } from './groundTruth.generator.js';

const dateOrNull = (ms, asOfMs) =>
  ms !== null && ms !== undefined && ms <= asOfMs ? new Date(ms) : null;

/** Leg documents as recorded at asOf (actuals only for what has happened by then). */
export function buildLegDocs(plan, partition, asOfMs) {
  return plan.legs.map((leg, i) => {
    const startAt = dateOrNull(leg.startAt, asOfMs);
    const departureAt = dateOrNull(leg.departureAt, asOfMs);
    const arrivalAt = dateOrNull(leg.arrivalAt, asOfMs);
    let status = 'PLANNED';
    if (leg.cancelledAt !== null) status = 'CANCELLED';
    else if (arrivalAt) status = 'COMPLETED';
    else if (startAt) status = 'IN_PROGRESS';
    const completed = status === 'COMPLETED';
    return {
      legId: legId(plan.shipmentId, i + 1),
      shipmentId: plan.shipmentId,
      partition,
      sequence: i + 1,
      routeId: leg.routeId,
      routeLegSequence: leg.routeLegSequence,
      fromFacilityId: leg.fromFacilityId,
      toFacilityId: leg.toFacilityId,
      transportMode: leg.transportMode,
      status,
      distanceKm: leg.distanceKm,
      plannedDwellMinutes: leg.plannedDwellMinutes,
      plannedTransitMinutes: leg.plannedTransitMinutes,
      actualStartAt: startAt,
      actualDepartureAt: departureAt,
      actualArrivalAt: arrivalAt,
      actualDwellMinutes:
        startAt && departureAt ? Math.round((leg.departureAt - leg.startAt) / MINUTE) : null,
      actualTransitMinutes:
        departureAt && arrivalAt ? Math.round((leg.arrivalAt - leg.departureAt) / MINUTE) : null,
      delayBreakdown: completed
        ? {
            queueMinutes: leg.queueMinutes,
            weatherMinutes: leg.weatherMinutes,
            carrierMinutes: leg.carrierMinutes,
          }
        : null,
      weatherEventIds: completed ? leg.weatherEventIds : [],
      cancelledAt: leg.cancelledAt !== null ? new Date(leg.cancelledAt) : null,
    };
  });
}

/** Shipment document as recorded at asOf. Observed fields are derived from observed events. */
export function buildShipmentDoc(plan, events, partition, asOfMs) {
  const derived = deriveStatus(events);
  const pickup = events.find((e) => e.eventType === 'PICKED_UP');
  const delivered = events.find((e) => e.eventType === 'DELIVERED');
  const rerouted = plan.routeChange && plan.routeChange.occurredAt <= asOfMs;
  const lastMileDone = plan.lastMile && plan.deliveredAt <= asOfMs;
  return {
    shipmentId: plan.shipmentId,
    sequence: plan.seq,
    partition,
    carrierId: plan.carrier.carrierId,
    serviceLevelId: plan.serviceLevel.serviceLevelId,
    originFacilityId: plan.origin.facilityId,
    destinationFacilityId: plan.destination.facilityId,
    plannedRouteId: plan.plannedRoute.routeId,
    currentRouteId: rerouted ? plan.routeChange.toRouteId : plan.plannedRoute.routeId,
    distanceZone: plan.zone,
    createdAt: new Date(plan.createdAt),
    plannedPickupAt: new Date(plan.plannedPickupAt),
    promisedDeliveryAt: new Date(plan.promisedDeliveryAt),
    pickedUpAt: pickup ? pickup.occurredAt : null,
    deliveredAt: delivered ? delivered.occurredAt : null,
    status: derived.status,
    statusUpdatedAt: derived.statusUpdatedAt,
    weightKg: plan.weightKg,
    pieces: plan.pieces,
    routeChange: rerouted
      ? { ...plan.routeChange, occurredAt: new Date(plan.routeChange.occurredAt) }
      : null,
    lastMile: lastMileDone
      ? {
          ...plan.lastMile,
          arrivedAtStationAt: new Date(plan.lastMile.arrivedAtStationAt),
          readyAt: new Date(plan.lastMile.readyAt),
          firstOutForDeliveryAt: new Date(plan.lastMile.firstOutForDeliveryAt),
        }
      : null,
    dataAsOf: new Date(asOfMs),
  };
}

/** Compute every scheduled ETA snapshot with the production engine (eligible inputs only). */
export function buildEtaDocs(ctx, shipmentDoc, events, partition) {
  const prediction = toPredictionShipment(shipmentDoc);
  const serviceLevel = ctx.serviceLevelsById.get(shipmentDoc.serviceLevelId);
  const carrier = ctx.carriersById.get(shipmentDoc.carrierId) ?? null;
  return predictionTimes(shipmentDoc.createdAt, ctx.asOfMs, events).map((t) =>
    toEtaDocument(
      computeEta({
        shipment: prediction,
        predictionAt: t,
        events,
        routesById: ctx.routeIndex.byId,
        facilitiesById: ctx.facilitiesById,
        carrier,
        serviceLevel,
        queueSource: ctx.queueModel.source,
        weatherIndex: ctx.weatherIndex,
      }),
      partition,
    ),
  );
}

/**
 * Assemble every record for one shipment. Optional mutation hooks are used only by the
 * anomaly generator; they run in dependency order (shipment -> legs -> ETAs) so derived
 * records are computed from the (possibly mutated) recorded data.
 */
export function buildShipmentRecords(
  ctx,
  plan,
  eventDocs,
  { partition, nextDelayId, mutate = {} },
) {
  const asOfMs = ctx.asOfMs;
  const shipment = buildShipmentDoc(plan, eventDocs, partition, asOfMs);
  mutate.shipment?.(shipment);
  const legs = buildLegDocs(plan, partition, asOfMs);
  mutate.legs?.(legs);
  const etas = buildEtaDocs(ctx, shipment, eventDocs, partition);
  const actualDeliveredAt =
    plan.deliveredAt !== null && plan.deliveredAt <= asOfMs ? plan.deliveredAt : null;
  for (const eta of etas)
    eta.evaluation = evaluateEta(eta.estimatedArrivalAt, eta.predictionAt, actualDeliveredAt);
  mutate.etas?.(etas, { shipment, events: eventDocs });
  const groundTruth = buildGroundTruth({
    shipment,
    events: eventDocs,
    etaDocs: etas,
    actualDeliveredAt,
    serviceLevel: ctx.serviceLevelsById.get(shipment.serviceLevelId),
    asOf: asOfMs,
    partition,
  });
  const delays = buildDelayRecords({
    groundTruth,
    shipment,
    legs,
    events: eventDocs,
    asOf: asOfMs,
    partition,
    nextDelayId,
  });
  return { shipment, legs, events: eventDocs, etas, groundTruth, delays };
}
