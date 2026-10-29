import mongoose from 'mongoose';
import {
  assertTestDatabase,
  connectDatabase,
  disconnectDatabase,
} from '../../src/config/database.js';
import { env } from '../../src/config/env.js';
import { resolveGenerationConfig } from '../../src/config/generation.js';
import { DatasetManifest } from '../../src/models/index.js';
import { runGeneration } from '../../src/services/generation.service.js';
import { hashObject } from '../../src/utils/hash.js';

export const TEST_SEED = 20261022;

/** Connect to an isolated *_test database (guarded: refuses any other name). */
export async function connectTestDb(dbName = env.MONGODB_DB_NAME_TEST) {
  assertTestDatabase(dbName);
  await connectDatabase({ dbName });
  assertTestDatabase(mongoose.connection.name);
  return mongoose.connection;
}

export async function dropTestDb() {
  assertTestDatabase(mongoose.connection.name);
  await mongoose.connection.dropDatabase();
}

export const disconnectTestDb = () => disconnectDatabase();

export const tinyConfig = (seed = TEST_SEED) =>
  resolveGenerationConfig({ profile: 'tiny', seed, batchSize: 500 });

/**
 * Ensure the connected test DB holds a completed tiny dataset for `seed`.
 * Reuses an existing identical dataset (same config hash) to keep the suite fast.
 */
export async function ensureTinyDataset(seed = TEST_SEED) {
  assertTestDatabase(mongoose.connection.name);
  const config = tinyConfig(seed);
  const existing = await DatasetManifest.findOne({ status: 'COMPLETED' })
    .sort({ createdAt: -1 })
    .lean();
  if (existing && existing.configHash === hashObject(config)) return existing;
  return runGeneration({ config, reset: true });
}
