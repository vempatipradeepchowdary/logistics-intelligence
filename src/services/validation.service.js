import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
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
  ValidationRun,
  WeatherEvent,
} from '../models/index.js';
import { buildWeatherIndex } from '../domain/operations.js';
import { createQueueSourceFromDocs } from '../domain/queueModel.js';
import { ValidationCollector } from '../validators/collector.js';
import { validateSchemas } from '../validators/schema.validator.js';
import {
  checkQueueObservation,
  checkShipmentRelationships,
  validateMasterData,
} from '../validators/relationship.validator.js';
import { checkShipmentTemporal } from '../validators/temporal.validator.js';
import { checkShipmentLifecycle } from '../validators/lifecycle.validator.js';
import { checkShipmentEtas } from '../validators/leakage.validator.js';
import { checkShipmentReconciliation } from '../validators/reconciliation.validator.js';
import { AppError } from '../utils/appError.js';
import { logger } from '../utils/logger.js';

/** Groups a cursor sorted by `key` into [key, docs[]] with one-group lookahead. */
class GroupedCursor {
  constructor(cursor, key) {
    this.iterator = cursor[Symbol.asyncIterator]();
    this.key = key;
    this.pendingDoc = null;
    this.done = false;
    this.buffered = undefined;
  }

  async peek() {
    if (this.buffered !== undefined) return this.buffered;
    if (this.done && !this.pendingDoc) return (this.buffered = null);
    let first = this.pendingDoc;
    if (!first) {
      const next = await this.iterator.next();
      if (next.done) {
        this.done = true;
        return (this.buffered = null);
      }
      first = next.value;
    }
    const group = [first];
    this.pendingDoc = null;
    for (;;) {
      const next = await this.iterator.next();
      if (next.done) {
        this.done = true;
        break;
      }
      if (next.value[this.key] !== first[this.key]) {
        this.pendingDoc = next.value;
        break;
      }
      group.push(next.value);
    }
    return (this.buffered = { key: first[this.key], docs: group });
  }

  async take() {
    const group = await this.peek();
    this.buffered = undefined;
    return group;
  }
}

const stream = (model, sort) =>
  model.find({}, { _id: 0 }).sort(sort).lean().cursor({ batchSize: 2000 });

async function loadReference(asOfMs) {
  const [facilities, carriers, serviceLevels, routes, weatherEvents] = await Promise.all([
    Facility.find({}, { _id: 0 }).lean(),
    Carrier.find({}, { _id: 0 }).lean(),
    ServiceLevel.find({}, { _id: 0 }).lean(),
    Route.find({}, { _id: 0 }).lean(),
    WeatherEvent.find({}, { _id: 0 }).lean(),
  ]);
  const queueDocs = await FacilityQueue.find(
    {},
    {
      _id: 0,
      queueObservationId: 1,
      facilityId: 1,
      observedAt: 1,
      ingestedAt: 1,
      estimatedWaitMinutes: 1,
      baselineWaitMinutes: 1,
    },
  ).lean();
  return {
    asOfMs,
    facilities,
    carriers,
    routes,
    weatherEvents,
    facilitiesById: new Map(facilities.map((f) => [f.facilityId, f])),
    carriersById: new Map(carriers.map((c) => [c.carrierId, c])),
    serviceLevelsById: new Map(serviceLevels.map((s) => [s.serviceLevelId, s])),
    routesById: new Map(routes.map((r) => [r.routeId, r])),
    weatherIndex: buildWeatherIndex(weatherEvents),
    queueSource: createQueueSourceFromDocs(queueDocs),
    queueIngestedById: new Map(
      queueDocs.map((q) => [q.queueObservationId, q.ingestedAt.getTime()]),
    ),
  };
}

function orphan(collector, entityType, idField, docs, parentId) {
  for (const doc of docs) {
    collector.fail('REF_INTEGRITY', {
      entityType,
      recordId: doc[idField],
      shipmentId: parentId,
      expected: 'shipmentId references an existing Shipment',
      actual: `shipmentId=${parentId} not found`,
    });
  }
}

function checkRecordCounts(collector, manifest, counts) {
  const targets = [
    ['shipments', manifest.config.shipments, counts.shipments],
    ['tracking_events', manifest.config.trackingEvents, counts.tracking_events],
    ['facilities', manifest.config.facilities, counts.facilities],
    ['weather_events', manifest.config.weatherEvents, counts.weather_events],
  ];
  for (const [name, target, actual] of targets) {
    collector.check('RECORD_COUNT_TARGET', target === actual, () => ({
      entityType: 'Dataset',
      recordId: name,
      expected: `${target} baseline records`,
      actual: `${actual} baseline records`,
    }));
  }
}

function checkExportConsistency(collector, exportDir, totals) {
  const manifestPath = path.join(exportDir, 'dataset_manifest.json');
  if (!existsSync(manifestPath))
    return { checked: false, reason: `no export found at ${manifestPath}` };
  const exported = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const file of exported.exports?.files ?? []) {
    if (!file.collection) continue;
    collector.check('EXPORT_COUNT_CONSISTENCY', file.rows === totals[file.collection], () => ({
      entityType: 'Export',
      recordId: file.file,
      expected: `${totals[file.collection]} rows (collection ${file.collection})`,
      actual: `${file.rows} rows`,
    }));
  }
  return { checked: true, exportDir: manifestPath };
}

/**
 * Run the complete validation suite against the current database. Standalone: it needs only a
 * MongoDB connection (no Express server).
 */
export async function runValidation({
  exportDir = null,
  onProgress = () => {},
  persist = true,
} = {}) {
  const startedAt = new Date();
  const manifest = await DatasetManifest.findOne({ status: 'COMPLETED' })
    .sort({ createdAt: -1 })
    .lean();
  if (!manifest)
    throw new AppError(
      'NO_DATASET',
      'No completed dataset generation found; generate data first',
      409,
    );
  const asOfMs = Date.parse(manifest.simulationWindow.asOf);
  const anomalyCases = await AnomalyCase.find({}, { _id: 0 }).lean();
  const collector = new ValidationCollector(anomalyCases);

  onProgress({
    phase: 'SCHEMA',
    processed: 0,
    total: null,
    message: 'Schema, enum, format and uniqueness checks',
  });
  await validateSchemas(collector);

  onProgress({
    phase: 'MASTER_DATA',
    processed: 0,
    total: null,
    message: 'Reference data and disruption checks',
  });
  const ref = await loadReference(asOfMs);
  validateMasterData(collector, ref);
  for await (const obs of FacilityQueue.find({}, { _id: 0 }).lean().cursor({ batchSize: 5000 })) {
    checkQueueObservation(collector, obs, ref);
  }

  onProgress({
    phase: 'SHIPMENTS',
    processed: 0,
    total: null,
    message: 'Per-shipment merge-join checks',
  });
  const children = {
    events: new GroupedCursor(stream(TrackingEvent, { shipmentId: 1, sequence: 1 }), 'shipmentId'),
    legs: new GroupedCursor(stream(ShipmentLeg, { shipmentId: 1, sequence: 1 }), 'shipmentId'),
    etas: new GroupedCursor(stream(ETAEstimate, { shipmentId: 1, predictionAt: 1 }), 'shipmentId'),
    groundTruth: new GroupedCursor(stream(GroundTruth, { shipmentId: 1 }), 'shipmentId'),
    delays: new GroupedCursor(stream(DelayReason, { shipmentId: 1, reasonCode: 1 }), 'shipmentId'),
  };
  const childMeta = {
    events: ['TrackingEvent', 'eventId'],
    legs: ['ShipmentLeg', 'legId'],
    etas: ['ETAEstimate', 'etaId'],
    groundTruth: ['GroundTruth', 'groundTruthId'],
    delays: ['DelayReason', 'delayId'],
  };
  const takeFor = async (name, shipmentIdValue) => {
    const cursor = children[name];
    for (;;) {
      const group = await cursor.peek();
      if (!group || group.key > shipmentIdValue) return [];
      await cursor.take();
      if (group.key === shipmentIdValue) return group.docs;
      orphan(collector, childMeta[name][0], childMeta[name][1], group.docs, group.key);
    }
  };

  let processed = 0;
  for await (const shipment of stream(Shipment, { shipmentId: 1 })) {
    const bundle = { shipment };
    for (const name of Object.keys(children))
      bundle[name] = await takeFor(name, shipment.shipmentId);
    bundle.groundTruth = bundle.groundTruth[0] ?? null;
    checkShipmentRelationships(collector, bundle, ref);
    checkShipmentTemporal(collector, bundle, ref);
    checkShipmentLifecycle(collector, bundle);
    checkShipmentEtas(collector, bundle, ref);
    checkShipmentReconciliation(collector, bundle, ref);
    processed += 1;
    if (processed % 5000 === 0)
      onProgress({ phase: 'SHIPMENTS', processed, total: null, message: `${processed} shipments` });
  }
  for (const name of Object.keys(children)) {
    for (let group = await children[name].take(); group; group = await children[name].take()) {
      orphan(collector, childMeta[name][0], childMeta[name][1], group.docs, group.key);
    }
  }

  onProgress({
    phase: 'DATASET',
    processed: 0,
    total: null,
    message: 'Counts, exports and anomaly coverage',
  });
  const baseline = {};
  const totals = {};
  for (const { name, model, partitioned } of DATASET_ENTITIES) {
    totals[name] = await model.countDocuments({});
    baseline[name] = partitioned
      ? await model.countDocuments({ partition: 'BASELINE' })
      : totals[name];
  }
  checkRecordCounts(collector, manifest, baseline);
  const exportCheck = exportDir
    ? checkExportConsistency(collector, exportDir, totals)
    : { checked: false };
  for (const c of collector.coverage()) {
    collector.check('ANOMALY_DETECTION_COVERAGE', c.detected, () => ({
      entityType: 'AnomalyCase',
      recordId: c.anomalyId,
      shipmentId: null,
      expected: `detected by ${c.expectedRuleIds.join(', ')}`,
      actual: `missing ${c.missingRuleIds.join(', ')}`,
    }));
  }

  const report = collector.report();
  const finishedAt = new Date();
  const run = {
    runId: `VAL-${finishedAt.getTime().toString(36)}`,
    status: report.status,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    datasetManifestId: manifest.manifestId,
    datasetChecksum: manifest.datasetChecksum,
    exportCheck,
    ...report,
  };
  if (persist) {
    const STORED_LIMIT = 5000;
    await ValidationRun.create({
      ...run,
      summary: { ...run.summary, datasetChecksum: manifest.datasetChecksum, exportCheck },
      violations: run.violations.slice(0, STORED_LIMIT),
      violationsTruncated: run.violationsTruncated || run.violations.length > STORED_LIMIT,
    });
  }
  logger.info('validation.completed', { runId: run.runId, status: run.status, ...run.summary });
  return run;
}
