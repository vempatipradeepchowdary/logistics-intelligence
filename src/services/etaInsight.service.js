import { ETAEstimate, Shipment } from '../models/index.js';
import { ETA_CONFIG } from './eta.service.js';
import { AppError } from '../utils/appError.js';

const NO_ID = { _id: 0 };
const SORTS = {
  predictionAt: { predictionAt: 1, etaId: 1 },
  '-predictionAt': { predictionAt: -1, etaId: -1 },
  '-absError': { 'evaluation.absErrorMinutes': -1, etaId: 1 },
  etaId: { etaId: 1 },
};

/** Paginated ETA snapshot explorer. */
export async function listEtas(query) {
  const filter = {};
  if (query.shipmentId) filter.shipmentId = query.shipmentId;
  if (query.partition) filter.partition = query.partition;
  if (query.confidence) filter.confidence = query.confidence;
  if (query.phase) filter['position.phase'] = query.phase;
  if (query.evaluated === true) filter.evaluation = { $ne: null };
  if (query.evaluated === false) filter.evaluation = null;
  if (query.minAbsErrorMinutes !== undefined) {
    filter['evaluation.absErrorMinutes'] = { $gte: query.minAbsErrorMinutes };
  }
  const skip = (query.page - 1) * query.limit;
  const projection = { _id: 0, 'inputs.eventIds': 0, 'inputs.remainingFacilityIds': 0 };
  const [items, total] = await Promise.all([
    ETAEstimate.find(filter, projection)
      .sort(SORTS[query.sort])
      .skip(skip)
      .limit(query.limit)
      .lean(),
    ETAEstimate.countDocuments(filter),
  ]);
  return {
    items,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
      sort: query.sort,
    },
  };
}

const fmtMin = (m) => {
  const sign = m < 0 ? '-' : '';
  const a = Math.abs(m);
  const h = Math.floor(a / 60);
  return `${sign}${h ? `${h}h ` : ''}${a % 60}m`;
};

/** Plain-language account of how a stored snapshot was produced (from its own audit fields). */
export function explainEta(eta) {
  const a = eta.adjustments;
  const w = eta.watermark;
  const steps = [
    `Information cut-off: ${eta.predictionAt.toISOString()}. Only tracking events with ingestedAt and occurredAt at or before this time were eligible (${w.eventsConsidered} events considered${eta.inputs.ignoredEventIds.length ? `, ${eta.inputs.ignoredEventIds.length} ignored as duplicate/out-of-sequence` : ''}).`,
    w.lastEventId
      ? `Latest eligible event: ${w.lastEventId} (occurred ${w.lastEventOccurredAt.toISOString()}), placing the shipment in phase ${eta.position.phase}${eta.position.facilityId ? ` at ${eta.position.facilityId}` : ''} on route ${eta.position.routeId}.`
      : `No eligible events yet; the shipment was treated as awaiting pickup on route ${eta.position.routeId}.`,
    `Base remaining duration from planned dwell, planned transit x carrier factor and the delivery-wave rule: ${fmtMin(a.baseRemainingMinutes)}.`,
    a.queueMinutes
      ? `Facility queue adjustment from ${eta.inputs.queueObservationIds.length} observation(s) ingested before the cut-off: +${fmtMin(a.queueMinutes)}.`
      : 'No queue adjustment (no above-baseline queue observation within the 6h horizon).',
    a.weatherMinutes
      ? `Weather adjustment from advisories ${eta.inputs.weatherEventIds.join(', ')} (published before the cut-off): +${fmtMin(a.weatherMinutes)}.`
      : 'No weather adjustment (no known advisory covering the expected arrival at a remaining facility).',
    a.holdMinutes ? `Exception hold: +${fmtMin(a.holdMinutes)}.` : null,
    a.interactionMinutes
      ? `Delivery-wave interaction (adjustments shifting the parcel into a different dispatch wave): ${a.interactionMinutes > 0 ? '+' : ''}${fmtMin(a.interactionMinutes)}.`
      : null,
    `Estimated arrival = prediction time + ${fmtMin(a.totalRemainingMinutes)} = ${eta.estimatedArrivalAt.toISOString()} (confidence ${eta.confidence}).`,
  ].filter(Boolean);
  return steps;
}

export async function getEta(etaId) {
  const eta = await ETAEstimate.findOne({ etaId }, NO_ID).lean();
  if (!eta) throw new AppError('NOT_FOUND', `ETA snapshot ${etaId} not found`, 404);
  const shipment = await Shipment.findOne(
    { shipmentId: eta.shipmentId },
    {
      _id: 0,
      shipmentId: 1,
      carrierId: 1,
      serviceLevelId: 1,
      originFacilityId: 1,
      destinationFacilityId: 1,
      promisedDeliveryAt: 1,
    },
  ).lean();
  return {
    eta,
    shipment,
    explanation: explainEta(eta),
    engine: { algorithmVersion: ETA_CONFIG.algorithmVersion, parameters: ETA_CONFIG },
  };
}
