import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);
// Indexes are created explicitly (ensureIndexes) so large bulk loads are predictable.
mongoose.set('autoIndex', false);

export async function connectDatabase({ dbName = env.ACTIVE_DB_NAME, uri = env.MONGODB_URI } = {}) {
  if (mongoose.connection.readyState === 1 && mongoose.connection.name === dbName) {
    return mongoose.connection;
  }
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  await mongoose.connect(uri, { dbName, maxPoolSize: 10, serverSelectionTimeoutMS: 10000 });
  logger.info('mongodb.connected', { dbName });
  return mongoose.connection;
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info('mongodb.disconnected');
  }
}

/** Guard used by every destructive test helper: refuse to wipe anything that is not a *_test database. */
export function assertTestDatabase(name = mongoose.connection.name) {
  if (!/_test$/.test(name ?? '')) {
    throw new Error(`Refusing destructive operation on non-test database "${name}"`);
  }
}

export function databaseState() {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return states[mongoose.connection.readyState] ?? 'unknown';
}
