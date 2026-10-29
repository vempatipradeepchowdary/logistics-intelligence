import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { env } from '../config/env.js';
import { AnomalyCase, DatasetManifest, entityByName, ValidationRun } from '../models/index.js';
import { csvCell, getPath } from '../utils/csv.js';
import { AppError } from '../utils/appError.js';
import { logger } from '../utils/logger.js';
import { ANOMALY_VARIANTS } from '../generators/anomaly.generator.js';

/**
 * Stable CSV column definitions (header = dotted source path). Timestamps are ISO-8601 UTC;
 * string arrays are pipe-joined; nested object arrays are JSON-encoded inside one cell.
 */
export const EXPORT_COLUMNS = Object.freeze({
  carriers: [
    'carrierId',
    'name',
    'code',
    'mode',
    'supportedServiceLevelIds',
    'transitTimeFactor',
    'transitVariability',
    'scanComplianceRate',
    'ediBatchShare',
    'onTimePickupRate',
    'marketShareWeight',
    'active',
  ],
  service_levels: [
    'serviceLevelId',
    'name',
    'transportMode',
    'transitDaysByZone.Z1',
    'transitDaysByZone.Z2',
    'transitDaysByZone.Z3',
    'transitDaysByZone.Z4',
    'pickupCutoffMinuteUtc',
    'deadlineMinuteUtc',
    'handlingFactor',
    'atRiskBufferMinutes',
    'priority',
    'mixWeight',
  ],
  facilities: [
    'facilityId',
    'name',
    'type',
    'city',
    'stateCode',
    'region',
    'latitude',
    'longitude',
    'timezone',
    'parentHubId',
    'capacityPerHour',
    'baseProcessingMinutes',
    'baselineQueueWaitMinutes',
    'operatingStatus',
  ],
  routes: [
    'routeId',
    'version',
    'routeType',
    'primaryRouteId',
    'originFacilityId',
    'destinationFacilityId',
    'totalDistanceKm',
    'distanceZone',
    'effectiveFrom',
    'stops',
    'legs',
  ],
  weather_events: [
    'weatherEventId',
    'weatherType',
    'severity',
    'advisoryType',
    'centerFacilityId',
    'affectedFacilityIds',
    'radiusKm',
    'startAt',
    'endAt',
    'issuedAt',
    'ingestedAt',
    'expectedDelayMinutes',
    'transitSlowdownPct',
  ],
  facility_queues: [
    'queueObservationId',
    'facilityId',
    'observedAt',
    'ingestedAt',
    'windowMinutes',
    'queueLength',
    'throughputPerHour',
    'utilizationPct',
    'estimatedWaitMinutes',
    'baselineWaitMinutes',
    'congestionLevel',
    'activeWeatherEventIds',
  ],
  shipments: [
    'shipmentId',
    'sequence',
    'partition',
    'carrierId',
    'serviceLevelId',
    'originFacilityId',
    'destinationFacilityId',
    'plannedRouteId',
    'currentRouteId',
    'distanceZone',
    'createdAt',
    'plannedPickupAt',
    'promisedDeliveryAt',
    'pickedUpAt',
    'deliveredAt',
    'status',
    'statusUpdatedAt',
    'weightKg',
    'pieces',
    'routeChange.occurredAt',
    'routeChange.atFacilityId',
    'routeChange.reason',
    'routeChange.fromRouteId',
    'routeChange.toRouteId',
    'routeChange.extraPlannedMinutes',
    'lastMile.arrivedAtStationAt',
    'lastMile.readyAt',
    'lastMile.plannedDwellMinutes',
    'lastMile.queueMinutes',
    'lastMile.weatherMinutes',
    'lastMile.weatherEventIds',
    'lastMile.firstOutForDeliveryAt',
    'lastMile.attemptFailed',
    'lastMile.attemptDelayMinutes',
    'dataAsOf',
  ],
  shipment_legs: [
    'legId',
    'shipmentId',
    'partition',
    'sequence',
    'routeId',
    'routeLegSequence',
    'fromFacilityId',
    'toFacilityId',
    'transportMode',
    'status',
    'distanceKm',
    'plannedDwellMinutes',
    'plannedTransitMinutes',
    'actualStartAt',
    'actualDepartureAt',
    'actualArrivalAt',
    'actualDwellMinutes',
    'actualTransitMinutes',
    'delayBreakdown.queueMinutes',
    'delayBreakdown.weatherMinutes',
    'delayBreakdown.carrierMinutes',
    'weatherEventIds',
    'cancelledAt',
  ],
  tracking_events: [
    'eventId',
    'shipmentId',
    'partition',
    'legId',
    'sequence',
    'eventType',
    'facilityId',
    'occurredAt',
    'ingestedAt',
    'source',
    'exceptionCode',
    'routeChange.fromRouteId',
    'routeChange.toRouteId',
    'routeChange.reason',
  ],
  eta_estimates: [
    'etaId',
    'shipmentId',
    'partition',
    'predictionAt',
    'estimatedArrivalAt',
    'algorithmVersion',
    'configHash',
    'inputHash',
    'confidence',
    'position.phase',
    'position.routeId',
    'position.stopIndex',
    'position.facilityId',
    'watermark.eventsConsidered',
    'watermark.lastEventId',
    'watermark.lastEventOccurredAt',
    'watermark.maxEventIngestedAt',
    'watermark.maxQueueIngestedAt',
    'watermark.maxWeatherIngestedAt',
    'inputs.eventIds',
    'inputs.ignoredEventIds',
    'inputs.queueObservationIds',
    'inputs.weatherEventIds',
    'inputs.remainingFacilityIds',
    'inputs.carrierKnown',
    'adjustments.baseRemainingMinutes',
    'adjustments.queueMinutes',
    'adjustments.weatherMinutes',
    'adjustments.holdMinutes',
    'adjustments.interactionMinutes',
    'adjustments.totalRemainingMinutes',
    'evaluation.actualArrivalAt',
    'evaluation.errorMinutes',
    'evaluation.absErrorMinutes',
    'evaluation.horizonMinutes',
  ],
  delay_reasons: [
    'delayId',
    'shipmentId',
    'partition',
    'reasonCode',
    'attributedMinutes',
    'shipmentDelayMinutes',
    'isPrimary',
    'evidence.legIds',
    'evidence.facilityIds',
    'evidence.weatherEventIds',
    'ruleVersion',
  ],
  ground_truth: [
    'groundTruthId',
    'shipmentId',
    'partition',
    'deliveryOutcome',
    'delayClass',
    'actualDeliveredAt',
    'promisedDeliveryAt',
    'delayMinutes',
    'primaryReasonCode',
    'hasOpenException',
    'hasPickupScan',
    'etaAtAsOfId',
    'etaAtAsOf',
    'asOf',
    'labelRuleVersion',
    'rationale',
  ],
});

const LABEL_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

function cellValue(doc, column) {
  const value = getPath(doc, column);
  if (Array.isArray(value) && value.every((v) => typeof v !== 'object' || v === null))
    return value.join('|');
  return value;
}

/** Resolve the export directory, refusing anything outside the configured export root. */
export function resolveExportDir(label = 'latest', root = env.EXPORT_DIR) {
  if (!LABEL_PATTERN.test(label)) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Export label must match ^[a-z0-9][a-z0-9-]{0,39}$',
      400,
    );
  }
  const base = path.resolve(root);
  const target = path.resolve(base, label);
  if (path.dirname(target) !== base)
    throw new AppError('VALIDATION_ERROR', 'Invalid export path', 400);
  return target;
}

/** Completed exports present on disk (directories under EXPORT_DIR with a dataset manifest). */
export async function listExports() {
  const root = path.resolve(env.EXPORT_DIR);
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !LABEL_PATTERN.test(entry.name)) continue;
    const manifestPath = path.join(root, entry.name, 'dataset_manifest.json');
    if (!existsSync(manifestPath)) continue;
    try {
      const m = JSON.parse(await readFile(manifestPath, 'utf8'));
      const { size } = await stat(manifestPath);
      out.push({
        label: entry.name,
        exportedAt: m.exports?.exportedAt ?? null,
        manifestId: m.manifestId,
        seed: m.seed,
        profile: m.profile,
        datasetChecksum: m.datasetChecksum,
        validationRunId: m.exports?.validationRunId ?? null,
        files: [
          ...(m.exports?.files ?? []),
          { file: 'dataset_manifest.json', collection: null, format: 'json', rows: null, bytes: size, sha256: null },
        ],
      });
    } catch {
      out.push({ label: entry.name, error: 'dataset_manifest.json is unreadable' });
    }
  }
  return out.sort((a, b) => String(b.exportedAt).localeCompare(String(a.exportedAt)));
}

/**
 * Resolve a downloadable file. Only files listed in that export's manifest (plus the manifest
 * itself) can be served, and the path must stay inside the export directory.
 */
export async function resolveExportFile(label, file) {
  const dir = resolveExportDir(label);
  const manifestPath = path.join(dir, 'dataset_manifest.json');
  if (!existsSync(manifestPath)) throw new AppError('NOT_FOUND', `Export "${label}" not found`, 404);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const allowed = new Set([...(manifest.exports?.files ?? []).map((f) => f.file), 'dataset_manifest.json']);
  if (!allowed.has(file)) throw new AppError('NOT_FOUND', `File "${file}" is not part of export "${label}"`, 404);
  const target = path.resolve(dir, file);
  if (path.dirname(target) !== dir || !existsSync(target)) {
    throw new AppError('NOT_FOUND', `File "${file}" is missing from export "${label}"`, 404);
  }
  return target;
}

const TRANSIENT_FS_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * Directory rename with bounded retries: on Windows, sync clients (OneDrive) and antivirus scanners
 * briefly lock freshly written folders, which surfaces as EPERM/EACCES/EBUSY.
 */
async function renameWithRetry(from, to, attempts = 10) {
  for (let i = 1; ; i += 1) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      if (!TRANSIENT_FS_ERRORS.has(err.code) || i >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 250 * i));
    }
  }
}

/** Stream one collection to CSV with back-pressure; returns row count, bytes and SHA-256. */
async function exportCollection(name, dir) {
  const { model, idField } = entityByName(name);
  const columns = EXPORT_COLUMNS[name];
  const file = path.join(dir, `${name}.csv`);
  const out = createWriteStream(file, { encoding: 'utf8' });
  const hash = createHash('sha256');
  const write = async (text) => {
    hash.update(text);
    if (!out.write(text)) await once(out, 'drain');
  };
  await write(`${columns.map(csvCell).join(',')}\r\n`);
  let rows = 0;
  const cursor = model
    .find({}, { _id: 0 })
    .sort({ [idField]: 1 })
    .lean()
    .cursor({ batchSize: 2000 });
  for await (const doc of cursor) {
    await write(`${columns.map((c) => csvCell(cellValue(doc, c))).join(',')}\r\n`);
    rows += 1;
  }
  out.end();
  await once(out, 'finish');
  const expected = await model.countDocuments({});
  if (rows !== expected) {
    throw new AppError(
      'EXPORT_COUNT_MISMATCH',
      `${name}: exported ${rows} rows but collection has ${expected}`,
      500,
    );
  }
  const { size } = await stat(file);
  return {
    file: `${name}.csv`,
    collection: name,
    format: 'csv',
    rows,
    bytes: size,
    sha256: hash.digest('hex'),
    columns,
  };
}

async function writeJson(dir, fileName, data) {
  const text = `${JSON.stringify(data, null, 2)}\n`;
  await writeFile(path.join(dir, fileName), text, 'utf8');
  return {
    file: fileName,
    collection: null,
    format: 'json',
    rows: null,
    bytes: Buffer.byteLength(text),
    sha256: createHash('sha256').update(text).digest('hex'),
  };
}

/**
 * Export every entity to CSV plus JSON manifests. Files are written to a staging directory and
 * swapped in atomically, so a failed export never leaves a half-written "latest" directory.
 */
export async function runExport({ label = 'latest', onProgress = () => {} } = {}) {
  const target = resolveExportDir(label);
  const manifest = await DatasetManifest.findOne({ status: 'COMPLETED' })
    .sort({ createdAt: -1 })
    .lean();
  if (!manifest) throw new AppError('NO_DATASET', 'No completed dataset to export', 409);
  const staging = `${target}.staging-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    const files = [];
    const names = Object.keys(EXPORT_COLUMNS);
    for (const [i, name] of names.entries()) {
      onProgress({ phase: 'CSV', processed: i, total: names.length, message: `exporting ${name}` });
      files.push(await exportCollection(name, staging));
    }
    const cases = await AnomalyCase.find({}, { _id: 0 }).sort({ anomalyId: 1 }).lean();
    files.push(
      await writeJson(staging, 'anomaly_manifest.json', {
        description:
          'Intentionally injected anomalies (partition ANOMALY) and the validation outcome expected for each',
        variants: ANOMALY_VARIANTS,
        cases,
        validEdgeCases: manifest.edgeCaseCatalog,
      }),
    );
    const validation = await ValidationRun.findOne({}, { _id: 0 }).sort({ finishedAt: -1 }).lean();
    files.push(
      await writeJson(
        staging,
        'validation_report.json',
        validation ?? {
          status: 'NOT_RUN',
          message: 'Run `npm run validate` before exporting to include a report',
        },
      ),
    );
    const { _id, checkpoint: _c, ...cleanManifest } = manifest;
    const datasetManifest = {
      ...cleanManifest,
      exports: {
        exportedAt: new Date().toISOString(),
        label,
        timezone: 'UTC (ISO-8601)',
        encoding: 'UTF-8, RFC 4180 CSV, CRLF line endings, header row',
        conventions:
          'string arrays are pipe-joined; nested object arrays (route stops/legs) are JSON in one cell; empty cell = null',
        validationRunId: validation?.runId ?? null,
        files,
      },
    };
    await writeFile(
      path.join(staging, 'dataset_manifest.json'),
      `${JSON.stringify(datasetManifest, null, 2)}\n`,
      'utf8',
    );
    if (existsSync(target)) await rm(target, { recursive: true, force: true });
    await renameWithRetry(staging, target);
    logger.info('export.completed', { target, files: files.length });
    return {
      directory: target,
      files: [...files, { file: 'dataset_manifest.json', format: 'json' }],
    };
  } catch (err) {
    await rm(staging, { recursive: true, force: true });
    throw err;
  }
}
