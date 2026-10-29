#!/usr/bin/env node
// Generates the same seed + configuration into two independent databases, then compares
// per-collection content checksums (from MongoDB) and the SHA-256 of every exported CSV.
// Optionally (--control) generates a different seed to prove the checksums are seed-sensitive.
//
// Usage: node src/scripts/verifyReproducibility.js [--profile small] [--seed 20261022] [--control] [--keep]
import { writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { resolveGenerationConfig } from '../config/generation.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { runGeneration } from '../services/generation.service.js';
import { runExport, resolveExportDir } from '../services/export.service.js';

const { values: args } = parseArgs({
  options: {
    profile: { type: 'string', default: 'small' },
    seed: { type: 'string' },
    control: { type: 'boolean', default: false },
    keep: { type: 'boolean', default: false },
  },
});

const seed = args.seed ? Number(args.seed) : env.GENERATION_SEED;
const baseDb = `${env.MONGODB_DB_NAME}_repro`;

async function generateInto(label, runSeed) {
  const dbName = `${baseDb}_${label}`;
  await connectDatabase({ dbName });
  const config = resolveGenerationConfig({
    profile: args.profile,
    seed: runSeed,
    batchSize: env.BATCH_SIZE,
  });
  const started = Date.now();
  const manifest = await runGeneration({ config, reset: true });
  const exported = await runExport({ label: `repro-${label}` });
  if (!args.keep) await mongoose.connection.dropDatabase();
  await disconnectDatabase();
  console.log(
    `[${label}] seed=${runSeed} generated+exported in ${((Date.now() - started) / 1000).toFixed(1)}s checksum=${manifest.datasetChecksum}`,
  );
  return { dbName, manifest, exported };
}

let exitCode = 0;
try {
  const a = await generateInto('a', seed);
  const b = await generateInto('b', seed);
  const collections = Object.keys(a.manifest.checksums).map((name) => ({
    collection: name,
    countA: a.manifest.checksums[name].count,
    countB: b.manifest.checksums[name].count,
    match: a.manifest.checksums[name].sha256 === b.manifest.checksums[name].sha256,
  }));
  const filesB = new Map(b.exported.files.map((f) => [f.file, f]));
  const files = a.exported.files
    .filter((f) => f.format === 'csv')
    .map((f) => ({ file: f.file, rows: f.rows, match: f.sha256 === filesB.get(f.file)?.sha256 }));
  const report = {
    profile: args.profile,
    seed,
    comparedAt: new Date().toISOString(),
    normalizedFields:
      'Excluded from comparison: Mongo _id, manifest IDs/timestamps, export timestamps (not part of the logical dataset). All dataset business timestamps are compared.',
    datasetChecksumA: a.manifest.datasetChecksum,
    datasetChecksumB: b.manifest.datasetChecksum,
    identical:
      a.manifest.datasetChecksum === b.manifest.datasetChecksum &&
      collections.every((c) => c.match) &&
      files.every((f) => f.match),
    collections,
    exportFiles: files,
  };
  if (args.control) {
    const c = await generateInto('control', seed + 1);
    report.control = {
      seed: seed + 1,
      datasetChecksum: c.manifest.datasetChecksum,
      differsFromSeedRun: c.manifest.datasetChecksum !== a.manifest.datasetChecksum,
    };
  }
  console.table(collections);
  console.table(files);
  console.log(
    `\nREPRODUCIBLE: ${report.identical ? 'YES' : 'NO'}${report.control ? ` | control seed differs: ${report.control.differsFromSeedRun}` : ''}`,
  );
  const out = path.resolve(env.EXPORT_DIR, 'reproducibility_report.json');
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`Report: ${out}`);
  if (!args.keep) {
    for (const label of ['repro-a', 'repro-b', 'repro-control'])
      await rm(resolveExportDir(label), { recursive: true, force: true });
  }
  exitCode = report.identical && (!report.control || report.control.differsFromSeedRun) ? 0 : 2;
} catch (err) {
  console.error(`FAILED: ${err.message}`);
  exitCode = 1;
} finally {
  await disconnectDatabase();
}
process.exitCode = exitCode;
