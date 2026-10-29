import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connectTestDb,
  disconnectTestDb,
  dropTestDb,
  ensureTinyDataset,
  tinyConfig,
} from '../helpers/db.js';
import { env } from '../../src/config/env.js';
import { resolveGenerationConfig } from '../../src/config/generation.js';
import { ANOMALY_SCENARIOS } from '../../src/config/constants.js';
import {
  AnomalyCase,
  Carrier,
  DatasetManifest,
  ETAEstimate,
  Facility,
  FacilityQueue,
  Route,
  ServiceLevel,
  Shipment,
  TrackingEvent,
  WeatherEvent,
} from '../../src/models/index.js';
import { runGeneration } from '../../src/services/generation.service.js';
import { runValidation } from '../../src/services/validation.service.js';
import { computeEta, toPredictionShipment } from '../../src/services/eta.service.js';
import { buildWeatherIndex } from '../../src/domain/operations.js';
import { createQueueSourceFromDocs } from '../../src/domain/queueModel.js';
import { HOUR } from '../../src/utils/time.js';

let manifest;
let report;

beforeAll(async () => {
  await connectTestDb();
  manifest = await ensureTinyDataset();
  report = await runValidation({ persist: false });
});
afterAll(disconnectTestDb);

describe('clean baseline dataset', () => {
  it('generates exact baseline counts', () => {
    const t = manifest.targetCounts;
    expect(t.shipments).toMatchObject({ target: 600, actual: 600, ok: true });
    expect(t.trackingEvents).toMatchObject({ target: 3600, actual: 3600, ok: true });
    expect(t.facilities).toMatchObject({ target: 100, actual: 100, ok: true });
    expect(t.disruptionWindows).toMatchObject({ target: 120, actual: 120, ok: true });
  });

  it('passes validation with no unexpected errors or warnings', () => {
    expect(report.status).toBe('PASS');
    expect(report.summary.unexpectedErrors).toBe(0);
    expect(report.summary.unexpectedWarnings).toBe(0);
    expect(report.summary.totalChecks).toBeGreaterThan(100000);
  });

  it('validates all required relationships with zero baseline failures', () => {
    const baselineFailures = report.violations.filter(
      (v) => v.shipmentId && !v.shipmentId.startsWith('SHP-2026-9'),
    );
    expect(baselineFailures).toEqual([]);
    const refRule = report.rules.find((r) => r.ruleId === 'REF_INTEGRITY');
    expect(refRule.checked).toBeGreaterThan(10000);
  });

  it('does not flag valid edge cases (reroutes, delayed scans, failed attempts, exceptions...)', () => {
    const flagged = new Set(
      report.violations
        .filter((v) => ['ERROR', 'CRITICAL'].includes(v.severity))
        .map((v) => v.shipmentId),
    );
    const covered = manifest.edgeCaseCatalog.filter((c) => c.shipmentIds.length);
    expect(covered.length).toBeGreaterThanOrEqual(6);
    for (const category of covered)
      for (const id of category.shipmentIds) expect(flagged.has(id)).toBe(false);
  });
});

describe('labelled anomalies', () => {
  it('detects every injected anomaly with its expected rules', () => {
    expect(report.summary.missedAnomalies).toBe(0);
    expect(report.summary.anomalyCasesDetected).toBe(report.summary.anomalyCasesExpected);
    expect(report.anomalyCoverage.every((c) => c.detected)).toBe(true);
    const scenarios = new Set(report.anomalyCoverage.map((c) => c.scenario));
    for (const s of ANOMALY_SCENARIOS) expect(scenarios.has(s)).toBe(true);
  });

  it('classifies every anomaly violation as intentional', () => {
    const anomalyViolations = report.violations.filter((v) =>
      v.shipmentId?.startsWith('SHP-2026-9'),
    );
    expect(anomalyViolations.length).toBeGreaterThan(0);
    expect(anomalyViolations.every((v) => v.classification === 'INTENTIONAL_ANOMALY')).toBe(true);
  });

  it('Scenario C: flags future-data leakage as CRITICAL', () => {
    const leak = report.violations.filter((v) => v.ruleId === 'ETA_FUTURE_DATA_LEAKAGE');
    expect(leak.length).toBeGreaterThan(0);
    expect(leak.every((v) => v.severity === 'CRITICAL' && v.entityType === 'ETAEstimate')).toBe(
      true,
    );
  });

  it('Scenario D: a delivered shipment still recorded IN_TRANSIT is detected', async () => {
    const cases = await AnomalyCase.find({ variant: 'DELIVERED_STATUS_IN_TRANSIT' }).lean();
    for (const c of cases) {
      const s = await Shipment.findOne({ shipmentId: c.shipmentId }).lean();
      expect(s.status).toBe('IN_TRANSIT');
      expect(
        await TrackingEvent.countDocuments({ shipmentId: c.shipmentId, eventType: 'DELIVERED' }),
      ).toBe(1);
      expect(
        report.violations.some(
          (v) => v.shipmentId === c.shipmentId && v.ruleId === 'SHIPMENT_STATUS_EVENT_MISMATCH',
        ),
      ).toBe(true);
    }
  });

  it('Scenario A: historical ETAs exclude a late-arriving event until it was ingested', async () => {
    const c = await AnomalyCase.findOne({ variant: 'LATE_ARRIVING_EVENT' }).lean();
    const lateEventId = c.affectedRecords.find((r) => r.entityType === 'TrackingEvent').recordId;
    const late = await TrackingEvent.findOne({ eventId: lateEventId }).lean();
    expect(late.ingestedAt - late.occurredAt).toBeGreaterThan(6 * HOUR);
    // Stored snapshots taken while the event was "in flight" must not reference it.
    const snapshots = await ETAEstimate.find({ shipmentId: c.shipmentId }).lean();
    for (const s of snapshots) {
      if (s.predictionAt < late.ingestedAt) expect(s.inputs.eventIds).not.toContain(lateEventId);
    }
    // Recompute from the database at a time between occurrence and ingestion.
    const t = late.occurredAt.getTime() + 2 * HOUR;
    const shipment = await Shipment.findOne({ shipmentId: c.shipmentId }).lean();
    const [routes, facilities, carriers, sls, weather, queues, events] = await Promise.all([
      Route.find().lean(),
      Facility.find().lean(),
      Carrier.find().lean(),
      ServiceLevel.find().lean(),
      WeatherEvent.find().lean(),
      FacilityQueue.find().lean(),
      TrackingEvent.find({ shipmentId: c.shipmentId }).lean(),
    ]);
    const eta = computeEta({
      shipment: toPredictionShipment(shipment),
      predictionAt: t,
      events,
      routesById: new Map(routes.map((r) => [r.routeId, r])),
      facilitiesById: new Map(facilities.map((f) => [f.facilityId, f])),
      carrier: carriers.find((x) => x.carrierId === shipment.carrierId),
      serviceLevel: sls.find((x) => x.serviceLevelId === shipment.serviceLevelId),
      queueSource: createQueueSourceFromDocs(queues),
      weatherIndex: buildWeatherIndex(weather),
    });
    expect(eta.inputs.eventIds).not.toContain(lateEventId);
    expect(eta.watermark.maxEventIngestedAt).toBeLessThanOrEqual(t);
    expect(
      report.violations.some(
        (v) => v.recordId === lateEventId && v.ruleId === 'TEMPORAL_LATE_INGESTION',
      ),
    ).toBe(true);
  });

  it('every baseline ETA snapshot uses only information available at prediction time', () => {
    const leakRule = report.rules.find((r) => r.ruleId === 'ETA_FUTURE_DATA_LEAKAGE');
    const reproRule = report.rules.find((r) => r.ruleId === 'ETA_REPRODUCIBILITY_MISMATCH');
    expect(leakRule.unexpected).toBe(0);
    expect(reproRule.unexpected).toBe(0);
    expect(leakRule.checked).toBeGreaterThan(1500);
  });
});

describe('reproducibility and resumability', () => {
  const generateInto = async (dbName, config) => {
    await connectTestDb(dbName);
    await dropTestDb();
    const m = await runGeneration({ config, reset: true });
    return m;
  };

  afterAll(async () => {
    for (const db of [
      'logistics_eta_repro1_test',
      'logistics_eta_repro2_test',
      'logistics_eta_resume_test',
    ]) {
      await connectTestDb(db);
      await dropTestDb();
    }
    await connectTestDb(env.MONGODB_DB_NAME_TEST);
  });

  it('produces identical datasets for the same seed and configuration, different ones otherwise', async () => {
    const a = await generateInto('logistics_eta_repro1_test', tinyConfig());
    const b = await generateInto('logistics_eta_repro2_test', tinyConfig());
    expect(b.datasetChecksum).toBe(a.datasetChecksum);
    expect(b.checksums).toEqual(a.checksums);
    expect(b.datasetChecksum).toBe(manifest.datasetChecksum);
    const other = await generateInto('logistics_eta_repro2_test', tinyConfig(20261023));
    expect(other.datasetChecksum).not.toBe(a.datasetChecksum);
  });

  it('resumes an interrupted generation and reproduces the same dataset', async () => {
    const config = resolveGenerationConfig({ profile: 'tiny', seed: 20261022, batchSize: 200 });
    const reference = await generateInto('logistics_eta_repro1_test', config);
    await connectTestDb('logistics_eta_resume_test');
    await dropTestDb();
    const interrupt = ({ phase, processed }) => {
      if (phase === 'SHIPMENTS' && processed >= 400) throw new Error('simulated crash');
    };
    await expect(runGeneration({ config, reset: true, onProgress: interrupt })).rejects.toThrow(
      'simulated crash',
    );
    const failed = await DatasetManifest.findOne().lean();
    expect(failed.status).toBe('FAILED');
    expect(failed.checkpoint.nextBatch).toBe(2);
    // Leave a partial, uncommitted batch behind to prove cleanup on resume.
    await Shipment.collection.insertOne({
      shipmentId: 'SHP-2026-000450',
      partition: 'BASELINE',
      junk: true,
    });
    const resumed = await runGeneration({ config, resume: true });
    expect(resumed.status).toBe('COMPLETED');
    expect(resumed.datasetChecksum).toBe(reference.datasetChecksum);
    expect(mongoose.connection.name).toBe('logistics_eta_resume_test');
  });
});
