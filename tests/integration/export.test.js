import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDb, disconnectTestDb, ensureTinyDataset } from '../helpers/db.js';
import { DATASET_ENTITIES } from '../../src/models/index.js';
import { EXPORT_COLUMNS, resolveExportDir, runExport } from '../../src/services/export.service.js';
import { runValidation } from '../../src/services/validation.service.js';
import { parseCsv } from '../../src/utils/csv.js';

let dir;
const readCsv = (name) => parseCsv(readFileSync(path.join(dir, `${name}.csv`), 'utf8'));

beforeAll(async () => {
  await connectTestDb();
  await ensureTinyDataset();
  await runValidation();
  dir = (await runExport({ label: 'integration' })).directory;
});
afterAll(disconnectTestDb);

describe('CSV/JSON export', () => {
  it('exports every collection with exact row counts and stable headers', async () => {
    for (const name of Object.keys(EXPORT_COLUMNS)) {
      const rows = readCsv(name);
      expect(rows[0]).toEqual(EXPORT_COLUMNS[name]);
      const { model } = DATASET_ENTITIES.find((e) => e.name === name);
      expect(rows.length - 1).toBe(await model.countDocuments());
      expect(rows.slice(1).every((r) => r.length === EXPORT_COLUMNS[name].length)).toBe(true);
    }
  });

  it('keeps references valid across exported files (only labelled orphans differ)', () => {
    const shipmentIds = new Set(
      readCsv('shipments')
        .slice(1)
        .map((r) => r[0]),
    );
    const events = readCsv('tracking_events').slice(1);
    const orphans = events.filter((r) => !shipmentIds.has(r[1]));
    const anomalies = JSON.parse(readFileSync(path.join(dir, 'anomaly_manifest.json'), 'utf8'));
    const orphanCases = new Set(
      anomalies.cases.filter((c) => c.variant === 'ORPHAN_EVENT').map((c) => c.shipmentId),
    );
    expect(orphans.every((r) => orphanCases.has(r[1]))).toBe(true);
    for (const name of ['shipment_legs', 'eta_estimates', 'ground_truth', 'delay_reasons']) {
      expect(
        readCsv(name)
          .slice(1)
          .every((r) => shipmentIds.has(r[1])),
      ).toBe(true);
    }
  });

  it('writes ISO-8601 UTC timestamps and sorted business IDs', () => {
    const events = readCsv('tracking_events').slice(1);
    expect(events[0][7]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
    const ids = events.map((r) => r[0]);
    expect(ids).toEqual([...ids].sort());
  });

  it('writes manifests with counts, checksums, seed and validation report', () => {
    const manifest = JSON.parse(readFileSync(path.join(dir, 'dataset_manifest.json'), 'utf8'));
    expect(manifest.seed).toBe(20261022);
    expect(manifest.datasetChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.targetCounts.trackingEvents).toMatchObject({
      target: 3600,
      actual: 3600,
      ok: true,
    });
    const csv = manifest.exports.files.filter((f) => f.format === 'csv');
    expect(csv).toHaveLength(12);
    for (const f of csv) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    const report = JSON.parse(readFileSync(path.join(dir, 'validation_report.json'), 'utf8'));
    expect(report.status).toBe('PASS');
  });

  it('confines export paths to the export root', () => {
    expect(() => resolveExportDir('../escape')).toThrow(/label/);
    expect(() => resolveExportDir('a/b')).toThrow();
    expect(resolveExportDir('ok-label')).toBe(path.resolve(process.env.EXPORT_DIR, 'ok-label'));
  });

  it('validator cross-checks export counts against collections', async () => {
    const run = await runValidation({ exportDir: dir, persist: false });
    const rule = run.rules.find((r) => r.ruleId === 'EXPORT_COUNT_CONSISTENCY');
    expect(rule.checked).toBe(12);
    expect(rule.failed).toBe(0);
  });
});
