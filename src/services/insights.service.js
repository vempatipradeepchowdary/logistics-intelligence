import { DelayReason, ETAEstimate, GroundTruth, Shipment, TrackingEvent } from '../models/index.js';
import { cached } from '../utils/datasetCache.js';

const partitionMatch = (partition) => (partition === 'ALL' ? {} : { partition });
const round = (v, d = 0) => (v === null || v === undefined ? null : Number(v.toFixed(d)));
const DAY_FORMAT = { format: '%Y-%m-%d', timezone: 'UTC' };

/** shipmentId -> { carrierId, serviceLevelId, promised } for the whole dataset (cached). */
export function shipmentAttributes() {
  return cached('shipment-attributes', async () => {
    const map = new Map();
    const cursor = Shipment.find(
      {},
      { _id: 0, shipmentId: 1, carrierId: 1, serviceLevelId: 1, promisedDeliveryAt: 1 },
    )
      .lean()
      .cursor({ batchSize: 5000 });
    for await (const s of cursor) {
      map.set(s.shipmentId, {
        carrierId: s.carrierId,
        serviceLevelId: s.serviceLevelId,
        promised: s.promisedDeliveryAt.getTime(),
      });
    }
    return map;
  });
}

// ---- ETA error accumulation (streamed; exact median via sorted absolute errors) ----
const errorAccumulator = () => ({ n: 0, abs: 0, sq: 0, err: 0, callOk: 0, absList: [] });

function accumulate(acc, error, callOk) {
  acc.n += 1;
  acc.abs += Math.abs(error);
  acc.sq += error * error;
  acc.err += error;
  acc.callOk += callOk ? 1 : 0;
  acc.absList.push(Math.abs(error));
}

function shapeErrors(acc) {
  const sorted = acc.absList.sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    snapshots: acc.n,
    maeMinutes: Math.round(acc.abs / acc.n),
    rmseMinutes: Math.round(Math.sqrt(acc.sq / acc.n)),
    biasMinutes: Math.round(acc.err / acc.n),
    medianAbsErrorMinutes: Math.round(median),
    slaCallAccuracy: round(acc.callOk / acc.n, 4),
  };
}

function groupInto(map, key) {
  if (!map.has(key)) map.set(key, errorAccumulator());
  return map.get(key);
}

const sortedEntries = (map) => [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));

const HIST_BOUNDS = [-Infinity, -48, -24, -12, -6, -2, 0, 2, 6, 12, 24, 48];
const HIST_LABELS = [
  '< -48h',
  '-48..-24h',
  '-24..-12h',
  '-12..-6h',
  '-6..-2h',
  '-2..0h',
  '0..2h',
  '2..6h',
  '6..12h',
  '12..24h',
  '24..48h',
  '> 48h',
];
const SCATTER_TARGET = 600;

function weekStart(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

/**
 * ETA error breakdowns over evaluated snapshots (those with a known actual delivery).
 *  - RMSE = sqrt(mean(error^2)) in minutes
 *  - slaCallAccuracy = share of snapshots whose on-time call (estimate <= deadline) matched the
 *    actual outcome (delivered <= deadline)
 * Streams the evaluated snapshots once and joins shipment attributes from an in-memory map.
 */
export function getEtaBreakdowns(partition) {
  return cached(`eta-breakdowns:${partition}`, async () => {
    const attrs = await shipmentAttributes();
    const filter = { ...partitionMatch(partition), evaluation: { $ne: null } };
    const total = await ETAEstimate.countDocuments(filter);
    const stride = Math.max(1, Math.floor(total / SCATTER_TARGET));
    const overall = errorAccumulator();
    const byCarrier = new Map();
    const byServiceLevel = new Map();
    const byWeek = new Map();
    const histogram = new Array(HIST_BOUNDS.length).fill(0);
    const scatter = [];
    let i = 0;
    const cursor = ETAEstimate.find(filter, {
      _id: 0,
      etaId: 1,
      shipmentId: 1,
      predictionAt: 1,
      estimatedArrivalAt: 1,
      'evaluation.actualArrivalAt': 1,
      'evaluation.errorMinutes': 1,
      'evaluation.horizonMinutes': 1,
    })
      .sort({ etaId: 1 })
      .lean()
      .cursor({ batchSize: 5000 });
    for await (const e of cursor) {
      const s = attrs.get(e.shipmentId);
      if (!s) continue;
      const error = e.evaluation.errorMinutes;
      const callOk =
        e.estimatedArrivalAt.getTime() <= s.promised ===
        e.evaluation.actualArrivalAt.getTime() <= s.promised;
      accumulate(overall, error, callOk);
      accumulate(groupInto(byCarrier, s.carrierId), error, callOk);
      accumulate(groupInto(byServiceLevel, s.serviceLevelId), error, callOk);
      accumulate(groupInto(byWeek, weekStart(e.predictionAt)), error, callOk);
      const hours = error / 60;
      let b = HIST_BOUNDS.length - 1;
      while (b > 0 && hours < HIST_BOUNDS[b]) b -= 1;
      histogram[b] += 1;
      if (i % stride === 0 && scatter.length < SCATTER_TARGET) {
        const t = e.predictionAt.getTime();
        scatter.push({
          etaId: e.etaId,
          shipmentId: e.shipmentId,
          horizonHours: round(e.evaluation.horizonMinutes / 60, 1),
          predictedHours: round((e.estimatedArrivalAt.getTime() - t) / 3600000, 1),
          actualHours: round((e.evaluation.actualArrivalAt.getTime() - t) / 3600000, 1),
        });
      }
      i += 1;
    }
    return {
      definitions: {
        maeMinutes: 'mean |estimated - actual| over snapshots with a known delivery time',
        rmseMinutes: 'sqrt(mean((estimated - actual)^2))',
        biasMinutes: 'mean(estimated - actual); positive = estimates later than actual',
        medianAbsErrorMinutes: 'exact median of |estimated - actual|',
        slaCallAccuracy:
          'share of snapshots whose on-time/late call vs the SLA deadline matched the actual outcome',
      },
      overall: overall.n ? shapeErrors(overall) : null,
      byCarrier: sortedEntries(byCarrier).map(([carrierId, acc]) => ({
        carrierId,
        ...shapeErrors(acc),
      })),
      byServiceLevel: sortedEntries(byServiceLevel).map(([serviceLevelId, acc]) => ({
        serviceLevelId,
        ...shapeErrors(acc),
      })),
      overTime: sortedEntries(byWeek).map(([week, acc]) => ({ weekStart: week, ...shapeErrors(acc) })),
      errorHistogram: HIST_LABELS.map((bucket, k) => ({ bucket, count: histogram[k] })),
      predictedVsActualSample: scatter,
      sampleMethod: `every ${stride}th evaluated snapshot in etaId order (deterministic)`,
    };
  });
}

export function getDelayBreakdowns(partition) {
  return cached(`delay-breakdowns:${partition}`, async () => {
    const match = partitionMatch(partition);
    const attrs = await shipmentAttributes();
    const carrierRows = new Map();
    const cursor = GroundTruth.find(
      { ...match, deliveryOutcome: 'DELIVERED' },
      { _id: 0, shipmentId: 1, delayClass: 1, delayMinutes: 1 },
    )
      .lean()
      .cursor({ batchSize: 5000 });
    for await (const g of cursor) {
      const carrierId = attrs.get(g.shipmentId)?.carrierId ?? 'UNKNOWN';
      if (!carrierRows.has(carrierId)) carrierRows.set(carrierId, { delivered: 0, delayed: 0, delaySum: 0 });
      const row = carrierRows.get(carrierId);
      row.delivered += 1;
      if (g.delayClass === 'DELAYED') {
        row.delayed += 1;
        row.delaySum += g.delayMinutes;
      }
    }
    const [overTime, byFacility] = await Promise.all([
      GroundTruth.aggregate([
        { $match: { ...match, deliveryOutcome: 'DELIVERED' } },
        {
          $group: {
            _id: { $dateToString: { date: '$promisedDeliveryAt', ...DAY_FORMAT } },
            delivered: { $sum: 1 },
            delayed: { $sum: { $cond: [{ $eq: ['$delayClass', 'DELAYED'] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      DelayReason.aggregate([
        { $match: { ...match, isPrimary: true } },
        { $unwind: '$evidence.facilityIds' },
        {
          $group: {
            _id: { facilityId: '$evidence.facilityIds', reason: '$reasonCode' },
            n: { $sum: 1 },
          },
        },
        {
          $group: {
            _id: '$_id.facilityId',
            total: { $sum: '$n' },
            reasons: { $push: { k: '$_id.reason', v: '$n' } },
          },
        },
        { $sort: { total: -1, _id: 1 } },
        { $limit: 15 },
      ]),
    ]);
    return {
      byCarrier: sortedEntries(carrierRows).map(([carrierId, r]) => ({
        carrierId,
        delivered: r.delivered,
        delayed: r.delayed,
        delayRate: round(r.delayed / r.delivered, 4),
        avgDelayMinutes: r.delayed ? Math.round(r.delaySum / r.delayed) : null,
      })),
      overTime: overTime.map((r) => ({
        date: r._id,
        delivered: r.delivered,
        delayed: r.delayed,
        delayRate: round(r.delayed / r.delivered, 4),
      })),
      byFacility: byFacility.map((r) => ({
        facilityId: r._id,
        primaryAttributions: r.total,
        reasons: Object.fromEntries(r.reasons.map((x) => [x.k, x.v])),
      })),
      note: 'byFacility counts primary delay attributions whose evidence names the facility (weather and congestion reasons carry facility evidence)',
    };
  });
}

export function getEventVolume(partition) {
  return cached(`event-volume:${partition}`, async () => {
    const match = partitionMatch(partition);
    const lag = { $divide: [{ $subtract: ['$ingestedAt', '$occurredAt'] }, 60000] };
    const [daily, byType, bySource] = await Promise.all([
      TrackingEvent.aggregate([
        { $match: match },
        {
          $group: {
            _id: { $dateToString: { date: '$occurredAt', ...DAY_FORMAT } },
            events: { $sum: 1 },
            avgLagMinutes: { $avg: lag },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      TrackingEvent.aggregate([
        { $match: match },
        { $group: { _id: '$eventType', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
      ]),
      TrackingEvent.aggregate([
        { $match: match },
        { $group: { _id: '$source', n: { $sum: 1 }, avgLag: { $avg: lag } } },
        { $sort: { n: -1 } },
      ]),
    ]);
    return {
      daily: daily.map((d) => ({
        date: d._id,
        events: d.events,
        avgLagMinutes: round(d.avgLagMinutes, 1),
      })),
      byType: byType.map((t) => ({ eventType: t._id, count: t.n })),
      bySource: bySource.map((s) => ({
        source: s._id,
        count: s.n,
        avgLagMinutes: round(s.avgLag, 1),
      })),
    };
  });
}

const CLASSIFIED_SORTS = {
  '-delayMinutes': { delayMinutes: -1, shipmentId: 1 },
  delayMinutes: { delayMinutes: 1, shipmentId: 1 },
  promisedDeliveryAt: { promisedDeliveryAt: 1, shipmentId: 1 },
  '-promisedDeliveryAt': { promisedDeliveryAt: -1, shipmentId: 1 },
  shipmentId: { shipmentId: 1 },
};

/** Ground-truth classified shipments (e.g. DELAYED, AT_RISK) joined with shipment facts. */
export async function listClassifiedShipments(query) {
  const gtMatch = { ...partitionMatch(query.partition), delayClass: { $in: query.delayClass } };
  if (query.reasonCode) gtMatch.primaryReasonCode = query.reasonCode;
  if (query.from || query.to) {
    gtMatch.promisedDeliveryAt = {};
    if (query.from) gtMatch.promisedDeliveryAt.$gte = query.from;
    if (query.to) gtMatch.promisedDeliveryAt.$lte = query.to;
  }
  const shipMatch = {};
  if (query.carrierId) shipMatch['s.carrierId'] = query.carrierId;
  if (query.serviceLevelId) shipMatch['s.serviceLevelId'] = query.serviceLevelId;
  if (query.status) shipMatch['s.status'] = query.status;
  const skip = (query.page - 1) * query.limit;
  const [result] = await GroundTruth.aggregate([
    { $match: gtMatch },
    {
      $lookup: {
        from: 'shipments',
        localField: 'shipmentId',
        foreignField: 'shipmentId',
        as: 's',
        pipeline: [
          {
            $project: {
              _id: 0,
              carrierId: 1,
              serviceLevelId: 1,
              originFacilityId: 1,
              destinationFacilityId: 1,
              status: 1,
              createdAt: 1,
              deliveredAt: 1,
            },
          },
        ],
      },
    },
    { $unwind: '$s' },
    { $match: shipMatch },
    {
      $facet: {
        items: [
          { $sort: CLASSIFIED_SORTS[query.sort] },
          { $skip: skip },
          { $limit: query.limit },
          { $project: { _id: 0 } },
        ],
        total: [{ $count: 'n' }],
      },
    },
  ]);
  const total = result.total[0]?.n ?? 0;
  return {
    items: result.items.map(({ s, ...gt }) => ({ ...gt, shipment: s })),
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
      sort: query.sort,
    },
  };
}
