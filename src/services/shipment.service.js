import {
  DelayReason,
  ETAEstimate,
  Facility,
  GroundTruth,
  Shipment,
  ShipmentLeg,
  TrackingEvent,
  WeatherEvent,
} from '../models/index.js';
import { latestViolationIndex } from './quality.service.js';
import { compareEvents, deriveStatus } from '../domain/lifecycle.js';
import { AppError } from '../utils/appError.js';

const NO_ID = { _id: 0 };
const SORTS = {
  createdAt: { createdAt: 1, shipmentId: 1 },
  '-createdAt': { createdAt: -1, shipmentId: -1 },
  shipmentId: { shipmentId: 1 },
  '-shipmentId': { shipmentId: -1 },
  promisedDeliveryAt: { promisedDeliveryAt: 1, shipmentId: 1 },
  '-promisedDeliveryAt': { promisedDeliveryAt: -1, shipmentId: -1 },
};

/**
 * Per-row context for a page of shipments (bounded by the page size): latest ETA snapshot,
 * latest tracking event and the ground-truth delay class (evaluation data, labelled as such).
 */
async function enrichPage(items) {
  const ids = items.map((s) => s.shipmentId);
  if (!ids.length) return items;
  const [etas, events, labels] = await Promise.all([
    ETAEstimate.aggregate([
      { $match: { shipmentId: { $in: ids } } },
      { $sort: { shipmentId: 1, predictionAt: -1 } },
      {
        $group: {
          _id: '$shipmentId',
          etaId: { $first: '$etaId' },
          predictionAt: { $first: '$predictionAt' },
          estimatedArrivalAt: { $first: '$estimatedArrivalAt' },
          confidence: { $first: '$confidence' },
        },
      },
    ]),
    TrackingEvent.aggregate([
      { $match: { shipmentId: { $in: ids } } },
      { $sort: { shipmentId: 1, occurredAt: -1, sequence: -1 } },
      {
        $group: {
          _id: '$shipmentId',
          eventId: { $first: '$eventId' },
          eventType: { $first: '$eventType' },
          facilityId: { $first: '$facilityId' },
          occurredAt: { $first: '$occurredAt' },
        },
      },
    ]),
    GroundTruth.find(
      { shipmentId: { $in: ids } },
      { _id: 0, shipmentId: 1, delayClass: 1, delayMinutes: 1 },
    ).lean(),
  ]);
  const byId = (rows, key = '_id') => new Map(rows.map((r) => [r[key], r]));
  const etaMap = byId(etas);
  const eventMap = byId(events);
  const labelMap = byId(labels, 'shipmentId');
  return items.map((s) => {
    const { _id: _e, ...latestEta } = etaMap.get(s.shipmentId) ?? {};
    const { _id: _v, ...lastEvent } = eventMap.get(s.shipmentId) ?? {};
    const label = labelMap.get(s.shipmentId);
    return {
      ...s,
      latestEta: latestEta.etaId ? latestEta : null,
      lastEvent: lastEvent.eventId ? lastEvent : null,
      evaluation: label ? { delayClass: label.delayClass, delayMinutes: label.delayMinutes } : null,
    };
  });
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Paginated listing. Filters are exact-match on indexed fields; `q` is an anchored ID prefix. */
export async function listShipments(query) {
  const filter = {};
  for (const field of [
    'status',
    'carrierId',
    'serviceLevelId',
    'originFacilityId',
    'destinationFacilityId',
    'partition',
  ]) {
    if (query[field] !== undefined) filter[field] = query[field];
  }
  if (query.q) filter.shipmentId = { $regex: `^${escapeRegex(query.q.toUpperCase())}` };
  if (query.delayClass) {
    const labelled = await GroundTruth.distinct('shipmentId', { delayClass: query.delayClass });
    filter.shipmentId = { ...(filter.shipmentId ?? {}), $in: labelled };
  }
  if (query.createdFrom || query.createdTo) {
    filter.createdAt = {};
    if (query.createdFrom) filter.createdAt.$gte = query.createdFrom;
    if (query.createdTo) filter.createdAt.$lte = query.createdTo;
  }
  const skip = (query.page - 1) * query.limit;
  const [items, total] = await Promise.all([
    Shipment.find(filter, NO_ID).sort(SORTS[query.sort]).skip(skip).limit(query.limit).lean(),
    Shipment.countDocuments(filter),
  ]);
  return {
    items: await enrichPage(items),
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
      sort: query.sort,
    },
  };
}

async function requireShipment(shipmentId) {
  const shipment = await Shipment.findOne({ shipmentId }, NO_ID).lean();
  if (!shipment) throw new AppError('NOT_FOUND', `Shipment ${shipmentId} not found`, 404);
  return shipment;
}

export async function getShipmentDetail(shipmentId) {
  const shipment = await requireShipment(shipmentId);
  const [legs, groundTruth, delayReasons, eventCount, etaCount] = await Promise.all([
    ShipmentLeg.find({ shipmentId }, NO_ID).sort({ sequence: 1 }).lean(),
    GroundTruth.findOne({ shipmentId }, NO_ID).lean(),
    DelayReason.find({ shipmentId }, NO_ID).sort({ delayId: 1 }).lean(),
    TrackingEvent.countDocuments({ shipmentId }),
    ETAEstimate.countDocuments({ shipmentId }),
  ]);
  const weatherIds = [
    ...new Set([
      ...legs.flatMap((l) => l.weatherEventIds ?? []),
      ...(shipment.lastMile?.weatherEventIds ?? []),
    ]),
  ];
  const [disruptions, facilities, violationIndex] = await Promise.all([
    WeatherEvent.find({ weatherEventId: { $in: weatherIds } }, NO_ID).sort({ startAt: 1 }).lean(),
    Facility.find(
      {
        facilityId: {
          $in: [
            ...new Set([...legs.flatMap((l) => [l.fromFacilityId, l.toFacilityId])]),
            shipment.originFacilityId,
            shipment.destinationFacilityId,
          ],
        },
      },
      { _id: 0, facilityId: 1, name: 1, type: 1, city: 1, stateCode: 1 },
    ).lean(),
    latestViolationIndex(),
  ]);
  return {
    shipment,
    legs,
    facilities,
    disruptions,
    validation: {
      runId: violationIndex.runId,
      violations: violationIndex.byShipment.get(shipmentId) ?? [],
    },
    counts: { events: eventCount, etaSnapshots: etaCount },
    // Evaluation-only data, kept in a separate section from operational/prediction data.
    evaluation: { groundTruth, delayReasons },
  };
}

/** Chronological events; with `asOf`, only events the platform had received by then. */
export async function getShipmentEvents(shipmentId, { asOf } = {}) {
  await requireShipment(shipmentId);
  const filter = { shipmentId };
  if (asOf) filter.ingestedAt = { $lte: asOf };
  const events = await TrackingEvent.find(filter, NO_ID).lean();
  return events.sort(compareEvents);
}

export async function getShipmentEtas(shipmentId) {
  await requireShipment(shipmentId);
  return ETAEstimate.find({ shipmentId }, NO_ID).sort({ predictionAt: 1 }).lean();
}

/** Merged lifecycle timeline: milestones, events (with status transitions), ETA snapshots, SLA. */
export async function getShipmentTimeline(shipmentId) {
  const shipment = await requireShipment(shipmentId);
  const [events, etas] = await Promise.all([
    TrackingEvent.find({ shipmentId }, NO_ID).lean(),
    ETAEstimate.find(
      { shipmentId },
      {
        _id: 0,
        etaId: 1,
        predictionAt: 1,
        estimatedArrivalAt: 1,
        confidence: 1,
        'position.phase': 1,
      },
    ).lean(),
  ]);
  const sorted = events.sort(compareEvents);
  const { illegal } = deriveStatus(sorted);
  const illegalIds = new Set(illegal.map((i) => i.event.eventId));
  const entries = [
    {
      at: shipment.createdAt,
      kind: 'CREATED',
      status: 'CREATED',
      detail: { promisedDeliveryAt: shipment.promisedDeliveryAt },
    },
  ];
  let status = 'CREATED';
  for (const e of sorted) {
    const before = status;
    if (!illegalIds.has(e.eventId))
      status = deriveStatus(sorted.slice(0, sorted.indexOf(e) + 1)).status;
    entries.push({
      at: e.occurredAt,
      kind: 'EVENT',
      status,
      transition: before === status ? null : `${before} -> ${status}`,
      legal: !illegalIds.has(e.eventId),
      detail: {
        eventId: e.eventId,
        eventType: e.eventType,
        facilityId: e.facilityId,
        ingestedAt: e.ingestedAt,
        exceptionCode: e.exceptionCode,
      },
    });
  }
  for (const eta of etas) {
    entries.push({ at: eta.predictionAt, kind: 'ETA_SNAPSHOT', detail: eta });
  }
  entries.push({
    at: shipment.promisedDeliveryAt,
    kind: 'SLA_DEADLINE',
    detail: { serviceLevelId: shipment.serviceLevelId },
  });
  entries.sort((a, b) => new Date(a.at) - new Date(b.at));
  return { shipmentId, currentStatus: shipment.status, recordedAsOf: shipment.dataAsOf, entries };
}
