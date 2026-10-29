import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDb, disconnectTestDb, dropTestDb } from '../helpers/db.js';
import { resolveGenerationConfig } from '../../src/config/generation.js';
import { DATASET_ENTITIES } from '../../src/models/index.js';
import { runGeneration } from '../../src/services/generation.service.js';
import { runValidation } from '../../src/services/validation.service.js';
import { runExport } from '../../src/services/export.service.js';

// Full challenge volume: 50,000 shipments / 300,000 tracking events / 100 facilities / 1,000
// disruption windows. Opt-in (several minutes): npm run test:full
const enabled = process.env.RUN_FULL_VOLUME === '1';
const DB = 'logistics_eta_full_test';

const countLines = (file) => {
  const text = readFileSync(file, 'utf8');
  let n = 0;
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) n += 1;
  return n; // CRLF-terminated rows; no field contains a newline in this dataset
};

describe.skipIf(!enabled)('full-volume acceptance', () => {
  let manifest;
  let report;
  let exportDir;

  beforeAll(async () => {
    await connectTestDb(DB);
    await dropTestDb();
    const started = Date.now();
    manifest = await runGeneration({
      config: resolveGenerationConfig({ profile: 'full', seed: 20261022 }),
      reset: true,
    });
    console.log(`full generation: ${((Date.now() - started) / 1000).toFixed(0)}s`);
    report = await runValidation({ persist: true });
    exportDir = (await runExport({ label: 'full-acceptance' })).directory;
  });
  afterAll(async () => {
    await dropTestDb();
    await disconnectTestDb();
  });

  it('generates exactly the required baseline volumes', () => {
    expect(manifest.recordCounts.shipments.baseline).toBe(50000);
    expect(manifest.recordCounts.tracking_events.baseline).toBe(300000);
    expect(manifest.recordCounts.facilities.total).toBe(100);
    expect(manifest.recordCounts.weather_events.total).toBe(1000);
    expect(Object.values(manifest.targetCounts).every((t) => t.ok)).toBe(true);
  });

  it('passes validation: no unexpected errors and every anomaly detected', () => {
    console.log(
      JSON.stringify(
        { status: report.status, ...report.summary, unexpectedViolationSample: undefined },
        null,
        2,
      ),
    );
    expect(report.summary.unexpectedErrors).toBe(0);
    expect(report.summary.missedAnomalies).toBe(0);
    expect(report.status).toBe('PASS');
  });

  it('exports CSV row counts equal to the source collections', async () => {
    for (const { name, model } of DATASET_ENTITIES.filter((e) => e.name !== 'anomaly_cases')) {
      expect(countLines(path.join(exportDir, `${name}.csv`)) - 1).toBe(
        await model.countDocuments(),
      );
    }
  });
});
