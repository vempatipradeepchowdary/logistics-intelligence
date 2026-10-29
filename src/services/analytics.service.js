import {
  DATASET_ENTITIES,
  DatasetManifest,
  DelayReason,
  ETAEstimate,
  GroundTruth,
  Shipment,
  ValidationRun,
} from '../models/index.js';
import { AppError } from '../utils/appError.js';
import { shipmentAttributes } from './insights.service.js';

const countBy = async (model, field, match) => {
  const rows = await model.aggregate([
    { $match: match },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id ?? 'null', r.count]));
};

export async function getSummary({ partition }) {
  const match = partition === 'ALL' ? {} : { partition };
  const collections = {};
  for (const { name, model, partitioned } of DATASET_ENTITIES) {
    collections[name] =
      partitioned && partition !== 'ALL'
        ? await model.countDocuments(match)
        : await model.estimatedDocumentCount();
  }
  const manifest = await DatasetManifest.findOne({ status: 'COMPLETED' }, { _id: 0, checkpoint: 0 })
    .sort({ createdAt: -1 })
    .lean();
  return {
    partition,
    collections,
    shipmentStatus: await countBy(Shipment, 'status', match),
    serviceLevelMix: await countBy(Shipment, 'serviceLevelId', match),
    carrierMix: await countBy(Shipment, 'carrierId', match),
    delayClasses: await countBy(GroundTruth, 'delayClass', match),
    dataset: manifest
      ? {
          manifestId: manifest.manifestId,
          seed: manifest.seed,
          profile: manifest.profile,
          simulationWindow: manifest.simulationWindow,
          datasetChecksum: manifest.datasetChecksum,
          generatedAt: manifest.generationCompletedAt,
          targetCounts: manifest.targetCounts,
        }
      : null,
  };
}

export async function getDelayAnalytics({ partition }) {
  const match = partition === 'ALL' ? {} : { partition };
  const delivered = await GroundTruth.aggregate([
    { $match: { ...match, deliveryOutcome: 'DELIVERED' } },
    {
      $group: {
        _id: null,
        delivered: { $sum: 1 },
        onTime: { $sum: { $cond: [{ $eq: ['$delayClass', 'ON_TIME'] }, 1, 0] } },
        avgDelayMinutes: {
          $avg: { $cond: [{ $gt: ['$delayMinutes', 0] }, '$delayMinutes', null] },
        },
      },
    },
  ]);
  const reasons = await DelayReason.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$reasonCode',
        shipmentsAffected: { $sum: 1 },
        primaryCount: { $sum: { $cond: ['$isPrimary', 1, 0] } },
        totalAttributedMinutes: { $sum: '$attributedMinutes' },
        avgAttributedMinutes: { $avg: '$attributedMinutes' },
      },
    },
    { $sort: { primaryCount: -1 } },
  ]);
  // Join service level from the cached shipment-attribute map (avoids a per-document $lookup).
  const attrs = await shipmentAttributes();
  const slRows = new Map();
  const gtCursor = GroundTruth.find(
    { ...match, deliveryOutcome: 'DELIVERED' },
    { _id: 0, shipmentId: 1, delayClass: 1 },
  )
    .lean()
    .cursor({ batchSize: 5000 });
  for await (const g of gtCursor) {
    const sl = attrs.get(g.shipmentId)?.serviceLevelId ?? 'UNKNOWN';
    if (!slRows.has(sl)) slRows.set(sl, { _id: sl, delivered: 0, onTime: 0 });
    const row = slRows.get(sl);
    row.delivered += 1;
    if (g.delayClass === 'ON_TIME') row.onTime += 1;
  }
  const byServiceLevel = [...slRows.values()].sort((a, b) => (a._id < b._id ? -1 : 1));
  const d = delivered[0] ?? { delivered: 0, onTime: 0, avgDelayMinutes: null };
  return {
    partition,
    delayClasses: await countBy(GroundTruth, 'delayClass', match),
    deliveredShipments: d.delivered,
    onTimeRate: d.delivered ? Number((d.onTime / d.delivered).toFixed(4)) : null,
    avgLatenessMinutesOfLateDeliveries:
      d.avgDelayMinutes === null ? null : Math.round(d.avgDelayMinutes),
    reasons: reasons.map((r) => ({
      reasonCode: r._id,
      ...r,
      _id: undefined,
      avgAttributedMinutes: Math.round(r.avgAttributedMinutes),
    })),
    onTimeByServiceLevel: byServiceLevel.map((r) => ({
      serviceLevelId: r._id,
      delivered: r.delivered,
      onTimeRate: Number((r.onTime / r.delivered).toFixed(4)),
    })),
  };
}

const ACCURACY_FIELDS = {
  n: { $sum: 1 },
  mae: { $avg: '$evaluation.absErrorMinutes' },
  bias: { $avg: '$evaluation.errorMinutes' },
  pct: {
    $percentile: { input: '$evaluation.absErrorMinutes', p: [0.5, 0.9], method: 'approximate' },
  },
  within2h: { $sum: { $cond: [{ $lte: ['$evaluation.absErrorMinutes', 120] }, 1, 0] } },
  within6h: { $sum: { $cond: [{ $lte: ['$evaluation.absErrorMinutes', 360] }, 1, 0] } },
  within24h: { $sum: { $cond: [{ $lte: ['$evaluation.absErrorMinutes', 1440] }, 1, 0] } },
};

const shapeAccuracy = (r) =>
  r
    ? {
        snapshots: r.n,
        maeMinutes: Math.round(r.mae),
        biasMinutes: Math.round(r.bias),
        p50AbsErrorMinutes: Math.round(r.pct[0]),
        p90AbsErrorMinutes: Math.round(r.pct[1]),
        within2h: Number((r.within2h / r.n).toFixed(4)),
        within6h: Number((r.within6h / r.n).toFixed(4)),
        within24h: Number((r.within24h / r.n).toFixed(4)),
      }
    : null;

/** ETA error metrics over snapshots whose outcome is known (evaluation-only data). */
export async function getEtaAccuracy({ partition }) {
  const match = { ...(partition === 'ALL' ? {} : { partition }), evaluation: { $ne: null } };
  const [overall] = await ETAEstimate.aggregate([
    { $match: match },
    { $group: { _id: null, ...ACCURACY_FIELDS } },
  ]);
  const horizon = await ETAEstimate.aggregate([
    { $match: match },
    {
      $bucket: {
        groupBy: '$evaluation.horizonMinutes',
        boundaries: [-1e9, 0, 720, 1440, 2880, 5760, 1e9],
        output: ACCURACY_FIELDS,
      },
    },
  ]);
  const labels = {
    '-1000000000': 'already delivered (<0h)',
    0: '0-12h',
    720: '12-24h',
    1440: '24-48h',
    2880: '48-96h',
    5760: '96h+',
  };
  const byPhase = await ETAEstimate.aggregate([
    { $match: match },
    { $group: { _id: '$position.phase', ...ACCURACY_FIELDS } },
    { $sort: { _id: 1 } },
  ]);
  return {
    partition,
    algorithm:
      (await ETAEstimate.findOne(match, { _id: 0, algorithmVersion: 1 }).lean())
        ?.algorithmVersion ?? null,
    overall: shapeAccuracy(overall),
    byHorizon: horizon.map((h) => ({
      horizon: labels[h._id] ?? String(h._id),
      ...shapeAccuracy(h),
    })),
    byPositionPhase: byPhase.map((p) => ({ phase: p._id, ...shapeAccuracy(p) })),
    note: 'errorMinutes = estimated - actual (positive = estimate later than actual delivery)',
  };
}

export async function getDataQuality({ includeViolations, limit }) {
  const run = await ValidationRun.findOne(
    {},
    { _id: 0, ...(includeViolations ? {} : { violations: 0 }) },
  )
    .sort({ finishedAt: -1 })
    .lean();
  if (!run)
    throw new AppError('NOT_FOUND', 'No validation run yet; POST /api/admin/validate first', 404);
  if (includeViolations) run.violations = run.violations.slice(0, limit);
  return run;
}
