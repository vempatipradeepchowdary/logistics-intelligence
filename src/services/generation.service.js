import mongoose from 'mongoose';
import { GENERATOR_VERSION } from '../config/generation.js';
import { ANOMALY_SEQUENCE_START } from '../config/constants.js';
import {
  AnomalyCase,
  Carrier,
  DATASET_ENTITIES,
  DatasetManifest,
  DelayReason,
  ETAEstimate,
  Facility,
  FacilityQueue,
  GroundTruth,
  Route,
  ServiceLevel,
  Shipment,
  ShipmentLeg,
  TrackingEvent,
  WeatherEvent,
  ensureIndexes,
} from '../models/index.js';
import { buildGenerationContext } from '../generators/context.js';
import { generateQueueObservations } from '../generators/disruption.generator.js';
import { simulateShipment } from '../generators/shipment.generator.js';
import {
  applyAdjustment,
  calibrateEventCounts,
  countEmitted,
  finalizeEvents,
  planEvents,
} from '../generators/event.generator.js';
import { buildShipmentRecords } from '../generators/records.builder.js';
import { generateAnomalies } from '../generators/anomaly.generator.js';
import { ETA_CONFIG, ETA_CONFIG_HASH } from './eta.service.js';
import { computeDatasetChecksums, computeRecordCounts } from './checksum.service.js';
import { insertBatch, insertStream } from '../utils/bulk.js';
import { AppError } from '../utils/appError.js';
import { hashObject } from '../utils/hash.js';
import { delayId, shipmentId as makeShipmentId } from '../utils/idGenerator.js';
import { logger } from '../utils/logger.js';
import { SOFTWARE_VERSION } from '../utils/version.js';

export const PHASES = Object.freeze([
  'MASTER_DATA',
  'DISRUPTIONS',
  'FACILITY_QUEUES',
  'CALIBRATION',
  'SHIPMENTS',
  'ANOMALIES',
  'FINALIZE',
]);

const SHIPMENT_SCOPED = [
  Shipment,
  ShipmentLeg,
  TrackingEvent,
  ETAEstimate,
  GroundTruth,
  DelayReason,
];

async function dropDataset() {
  for (const { model } of DATASET_ENTITIES) {
    await model.collection.drop().catch((err) => {
      if (err?.codeName !== 'NamespaceNotFound') throw err;
    });
  }
}

async function mongoVersion() {
  try {
    const info = await mongoose.connection.db.admin().buildInfo();
    return info.version;
  } catch {
    return 'unknown';
  }
}

/** Remove BASELINE records of shipments >= fromSeq (partial batch left by an interrupted run). */
async function cleanupFromSequence(year, fromSeq) {
  const fromId = makeShipmentId(year, fromSeq);
  const toId = makeShipmentId(year, ANOMALY_SEQUENCE_START);
  for (const model of SHIPMENT_SCOPED) {
    await model.deleteMany({ partition: 'BASELINE', shipmentId: { $gte: fromId, $lt: toId } });
  }
}

/**
 * Generate (or resume) a full dataset.
 * @param {object} options
 * @param {object} options.config     resolved generation config
 * @param {boolean} options.reset     drop existing dataset collections first
 * @param {boolean} options.resume    continue the latest IN_PROGRESS run with the same config
 * @param {Function} options.onProgress  ({ phase, processed, total, message }) => void
 */
export async function runGeneration({
  config,
  reset = false,
  resume = false,
  onProgress = () => {},
}) {
  const configHash = hashObject(config);
  const progress = (phase, processed, total, message) =>
    onProgress({ phase, processed, total, message });

  let manifest;
  if (resume) {
    manifest = await DatasetManifest.findOne({
      status: { $in: ['IN_PROGRESS', 'FAILED'] },
      configHash,
    }).sort({
      createdAt: -1,
    });
    if (!manifest)
      throw new AppError(
        'NO_RESUMABLE_RUN',
        'No interrupted run with this configuration exists',
        409,
      );
    manifest.status = 'IN_PROGRESS';
    manifest.error = null;
    await manifest.save();
    logger.info('generation.resume', {
      manifestId: manifest.manifestId,
      checkpoint: manifest.checkpoint,
    });
  } else {
    const existing = await Shipment.estimatedDocumentCount();
    if (existing && !reset) {
      throw new AppError(
        'DATASET_EXISTS',
        'A dataset already exists; pass reset=true to regenerate',
        409,
      );
    }
    if (reset) await dropDataset();
    await ensureIndexes();
    manifest = await DatasetManifest.create({
      manifestId: `MAN-${Date.now().toString(36)}-${config.seed}`,
      status: 'IN_PROGRESS',
      seed: config.seed,
      profile: config.profile,
      config,
      configHash,
      softwareVersion: SOFTWARE_VERSION,
      generatorVersion: GENERATOR_VERSION,
      etaAlgorithmVersion: ETA_CONFIG.algorithmVersion,
      etaConfigHash: ETA_CONFIG_HASH,
      environment: {
        node: process.version,
        mongodb: await mongoVersion(),
        platform: process.platform,
      },
      simulationWindow: {},
      generationStartedAt: new Date(),
      checkpoint: { completed: [], nextBatch: 0, nextDelaySeq: 1 },
    });
  }

  const checkpoint = {
    completed: [],
    nextBatch: 0,
    nextDelaySeq: 1,
    ...(manifest.checkpoint ?? {}),
  };
  const isDone = (phase) => checkpoint.completed.includes(phase);
  const saveCheckpoint = async () => {
    manifest.checkpoint = { ...checkpoint };
    manifest.markModified('checkpoint');
    await manifest.save();
  };
  const complete = async (phase) => {
    if (!isDone(phase)) checkpoint.completed.push(phase);
    await saveCheckpoint();
    logger.info('generation.phase.completed', { phase });
  };

  try {
    const ctx = buildGenerationContext(config);
    manifest.simulationWindow = {
      start: new Date(ctx.startMs).toISOString(),
      asOf: new Date(ctx.asOfMs).toISOString(),
      days: config.simulationDays,
    };
    const B = config.batchSize;

    // ---- Phase 1: master data (reference data first) ----
    if (!isDone('MASTER_DATA')) {
      progress('MASTER_DATA', 0, 4, 'Generating carriers, service levels, facilities, routes');
      for (const model of [Carrier, ServiceLevel, Facility, Route]) await model.deleteMany({});
      await insertBatch(Carrier, ctx.carriers);
      await insertBatch(ServiceLevel, ctx.serviceLevels);
      await insertBatch(Facility, ctx.facilities);
      for (let i = 0; i < ctx.routes.length; i += B)
        await insertBatch(Route, ctx.routes.slice(i, i + B));
      await complete('MASTER_DATA');
    }

    // ---- Phase 2: disruption windows ----
    if (!isDone('DISRUPTIONS')) {
      progress('DISRUPTIONS', 0, ctx.weatherEvents.length, 'Generating weather disruption windows');
      await WeatherEvent.deleteMany({});
      for (let i = 0; i < ctx.weatherEvents.length; i += B) {
        await insertBatch(WeatherEvent, ctx.weatherEvents.slice(i, i + B));
      }
      await complete('DISRUPTIONS');
    }

    // ---- Phase 3: facility queue observations (streamed) ----
    if (!isDone('FACILITY_QUEUES')) {
      await FacilityQueue.deleteMany({});
      await insertStream(
        FacilityQueue,
        generateQueueObservations({ queueModel: ctx.queueModel, facilities: ctx.facilities }),
        B,
        (n) => progress('FACILITY_QUEUES', n, null, `${n} queue observations`),
      );
      await complete('FACILITY_QUEUES');
    }

    // ---- Phase 4: event-count calibration (pass 1; cheap, recomputed on resume) ----
    const N = config.shipments;
    const counts = new Int32Array(N);
    const departureOn = new Uint8Array(N);
    const departureOff = new Uint8Array(N);
    for (let i = 0; i < N; i += 1) {
      const plan = simulateShipment(ctx, i + 1);
      const planned = planEvents(ctx, plan);
      counts[i] = countEmitted(planned.raw);
      departureOn[i] = planned.departureOn;
      departureOff[i] = planned.departureOff;
      if (i % 10000 === 0) progress('CALIBRATION', i, N, 'Counting natural scan volume');
    }
    const calibration = calibrateEventCounts({
      seed: config.seed,
      target: config.trackingEvents,
      counts,
      departureOn,
      departureOff,
    });
    manifest.calibration = {
      naturalEventCount: calibration.naturalCount,
      targetEventCount: calibration.target,
      adjustment: calibration.target - calibration.naturalCount,
      shipmentsAdjusted: calibration.shipmentsAdjusted,
      method: 'Optional departure scans toggled round-robin over a seeded permutation of shipments',
    };
    if (!isDone('CALIBRATION')) await complete('CALIBRATION');
    else await saveCheckpoint();

    // ---- Phase 5: shipments, legs, events, ETA snapshots, ground truth, delay reasons ----
    if (!isDone('SHIPMENTS')) {
      const batches = Math.ceil(N / B);
      if (checkpoint.nextBatch > 0)
        await cleanupFromSequence(ctx.year, checkpoint.nextBatch * B + 1);
      let delaySeq = checkpoint.nextDelaySeq;
      const nextDelayId = () => delayId(ctx.year, delaySeq++);
      for (let b = checkpoint.nextBatch; b < batches; b += 1) {
        const acc = { shipments: [], legs: [], events: [], etas: [], groundTruth: [], delays: [] };
        for (let seq = b * B + 1; seq <= Math.min(N, (b + 1) * B); seq += 1) {
          const plan = simulateShipment(ctx, seq);
          const { raw } = planEvents(ctx, plan);
          applyAdjustment(raw, calibration.adjustments[seq - 1]);
          const eventDocs = finalizeEvents(raw, plan.shipmentId, 'BASELINE').map((f) => f.doc);
          const records = buildShipmentRecords(ctx, plan, eventDocs, {
            partition: 'BASELINE',
            nextDelayId,
          });
          acc.shipments.push(records.shipment);
          acc.legs.push(...records.legs);
          acc.events.push(...records.events);
          acc.etas.push(...records.etas);
          acc.groundTruth.push(records.groundTruth);
          acc.delays.push(...records.delays);
        }
        // Parents before children: shipments, then legs, then events and derived records.
        await insertBatch(Shipment, acc.shipments);
        await insertBatch(ShipmentLeg, acc.legs);
        await insertBatch(TrackingEvent, acc.events);
        await insertBatch(ETAEstimate, acc.etas);
        await insertBatch(GroundTruth, acc.groundTruth);
        await insertBatch(DelayReason, acc.delays);
        checkpoint.nextBatch = b + 1;
        checkpoint.nextDelaySeq = delaySeq;
        await saveCheckpoint();
        progress('SHIPMENTS', Math.min(N, (b + 1) * B), N, `batch ${b + 1}/${batches}`);
      }
      await complete('SHIPMENTS');
    }

    // ---- Phase 6: labelled anomalies (separate partition) ----
    if (!isDone('ANOMALIES')) {
      for (const model of SHIPMENT_SCOPED) await model.deleteMany({ partition: 'ANOMALY' });
      await AnomalyCase.deleteMany({});
      const anomalies = generateAnomalies(ctx);
      await insertBatch(Shipment, anomalies.shipments);
      await insertBatch(ShipmentLeg, anomalies.legs);
      await insertBatch(TrackingEvent, anomalies.events);
      await insertBatch(ETAEstimate, anomalies.etas);
      await insertBatch(GroundTruth, anomalies.groundTruth);
      await insertBatch(DelayReason, anomalies.delays);
      await insertBatch(AnomalyCase, anomalies.cases);
      progress(
        'ANOMALIES',
        anomalies.cases.length,
        anomalies.cases.length,
        'Anomaly cases injected',
      );
      await complete('ANOMALIES');
    }

    // ---- Phase 7: manifest (counts, target verification, checksums, edge-case catalog) ----
    progress('FINALIZE', 0, 1, 'Computing record counts and checksums');
    const recordCounts = await computeRecordCounts();
    const targetCounts = {
      shipments: { target: config.shipments, actual: recordCounts.shipments.baseline },
      trackingEvents: {
        target: config.trackingEvents,
        actual: recordCounts.tracking_events.baseline,
      },
      facilities: { target: config.facilities, actual: recordCounts.facilities.total },
      disruptionWindows: {
        target: config.weatherEvents,
        actual: recordCounts.weather_events.total,
      },
    };
    for (const entry of Object.values(targetCounts)) entry.ok = entry.actual === entry.target;
    const checksums = await computeDatasetChecksums();
    manifest.recordCounts = recordCounts;
    manifest.targetCounts = targetCounts;
    manifest.checksums = checksums.collections;
    manifest.datasetChecksum = checksums.datasetChecksum;
    manifest.edgeCaseCatalog = await buildEdgeCaseCatalog();
    const failedTargets = Object.entries(targetCounts).filter(([, v]) => !v.ok);
    if (failedTargets.length) {
      throw new AppError(
        'TARGET_COUNT_MISMATCH',
        `Baseline counts do not match targets: ${JSON.stringify(failedTargets)}`,
        500,
      );
    }
    manifest.status = 'COMPLETED';
    manifest.generationCompletedAt = new Date();
    await complete('FINALIZE');
    logger.info('generation.completed', {
      manifestId: manifest.manifestId,
      datasetChecksum: manifest.datasetChecksum,
    });
    return manifest.toObject();
  } catch (err) {
    manifest.status = 'FAILED';
    manifest.error = err.message;
    await manifest.save().catch(() => {});
    throw err;
  }
}

const sample = async (model, filter, field = 'shipmentId', limit = 3) =>
  (
    await model
      .find(filter, { [field]: 1, _id: 0 })
      .sort({ [field]: 1 })
      .limit(limit)
      .lean()
  ).map((d) => d[field]);

/** Valid-but-unusual baseline cases that the validator must NOT flag as errors. */
export async function buildEdgeCaseCatalog() {
  const base = { partition: 'BASELINE' };
  const delayedScans = await TrackingEvent.aggregate([
    { $match: base },
    {
      $match: { $expr: { $gte: [{ $subtract: ['$ingestedAt', '$occurredAt'] }, 60 * 60 * 1000] } },
    },
    { $sort: { eventId: 1 } },
    { $limit: 3 },
    { $project: { _id: 0, shipmentId: 1 } },
  ]);
  const entry = (category, description, shipmentIds) => ({
    category,
    description,
    shipmentIds,
    expectedOutcome: 'VALID: no ERROR or CRITICAL validation failures',
  });
  return [
    entry(
      'ON_TIME_DELIVERY',
      'Delivered on or before the SLA deadline',
      await sample(GroundTruth, { ...base, delayClass: 'ON_TIME' }),
    ),
    entry(
      'LATE_DELIVERY',
      'Delivered after the SLA deadline (with delay attribution)',
      await sample(GroundTruth, { ...base, delayClass: 'DELAYED', deliveryOutcome: 'DELIVERED' }),
    ),
    entry(
      'ROUTE_CHANGE',
      'Rerouted at the origin hub (weather avoidance or linehaul capacity)',
      await sample(Shipment, { ...base, routeChange: { $ne: null } }),
    ),
    entry(
      'DELAYED_SCAN',
      'Scans ingested 1-5h after they occurred (below the 6h late-arrival threshold)',
      delayedScans.map((d) => d.shipmentId),
    ),
    entry(
      'DELIVERY_ATTEMPT_FAILED',
      'Failed first delivery attempt followed by a successful retry',
      await sample(Shipment, { ...base, 'lastMile.attemptFailed': true }),
    ),
    entry(
      'OPEN_OPERATIONAL_EXCEPTION',
      'Package held after a DAMAGED exception',
      await sample(GroundTruth, { ...base, delayClass: 'OPERATIONAL_EXCEPTION' }),
    ),
    entry(
      'INSUFFICIENT_DATA',
      'Tendered but never picked up; outcome cannot be established',
      await sample(GroundTruth, { ...base, delayClass: 'INSUFFICIENT_DATA' }),
    ),
    entry(
      'AT_RISK',
      'In transit with an ETA close to or past the deadline',
      await sample(GroundTruth, { ...base, delayClass: 'AT_RISK' }),
    ),
    entry(
      'WEATHER_DELAY',
      'Late delivery primarily attributed to a weather disruption',
      await sample(DelayReason, { ...base, reasonCode: 'WEATHER_DISRUPTION', isPrimary: true }),
    ),
  ];
}
