import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDb, disconnectTestDb, dropTestDb } from '../helpers/db.js';
import { ensureIndexes, Shipment, TrackingEvent } from '../../src/models/index.js';
import { insertBatch } from '../../src/utils/bulk.js';
import { DataWriteError } from '../../src/utils/appError.js';

// Uses its own isolated database so schema experiments never touch the shared test dataset.
const DB = 'logistics_eta_models_test';

const event = (overrides = {}) => ({
  eventId: 'EVT-SHP-2026-000001-000001',
  shipmentId: 'SHP-2026-000001',
  partition: 'BASELINE',
  legId: 'LEG-SHP-2026-000001-01',
  sequence: 1,
  eventType: 'PICKED_UP',
  facilityId: 'FAC-031',
  occurredAt: new Date('2026-01-01T10:00:00Z'),
  ingestedAt: new Date('2026-01-01T10:05:00Z'),
  source: 'DRIVER_APP',
  ...overrides,
});

beforeAll(async () => {
  await connectTestDb(DB);
  await dropTestDb();
  await ensureIndexes();
});
afterAll(async () => {
  await dropTestDb();
  await disconnectTestDb();
});

describe('Mongoose model validation', () => {
  it('accepts a valid document', async () => {
    await expect(new TrackingEvent(event()).validate()).resolves.toBeUndefined();
  });

  it('rejects invalid enum values, malformed IDs and missing required fields', async () => {
    await expect(new TrackingEvent(event({ eventType: 'TELEPORTED' })).validate()).rejects.toThrow(
      /eventType/,
    );
    await expect(new TrackingEvent(event({ facilityId: 'FAC-1' })).validate()).rejects.toThrow(
      /facilityId/,
    );
    await expect(new TrackingEvent(event({ ingestedAt: undefined })).validate()).rejects.toThrow(
      /ingestedAt/,
    );
  });

  it('rejects unknown fields (strict schemas)', () => {
    expect(() => new TrackingEvent(event({ surprise: true }))).toThrow(/surprise/);
  });

  it('rejects non-integer minute fields', async () => {
    const shipment = new Shipment({ lastMile: { queueMinutes: 1.5 } });
    const err = shipment.validateSync();
    expect(err.errors['lastMile.queueMinutes']).toBeDefined();
  });
});

describe('indexes', () => {
  it('enforces unique business IDs', async () => {
    await insertBatch(TrackingEvent, [event()]);
    await expect(insertBatch(TrackingEvent, [event({ sequence: 2 })])).rejects.toBeInstanceOf(
      DataWriteError,
    );
  });

  it('enforces the unique compound (shipmentId, sequence) index', async () => {
    const err = await insertBatch(TrackingEvent, [
      event({ eventId: 'EVT-SHP-2026-000001-000002' }),
    ]).catch((e) => e);
    expect(err).toBeInstanceOf(DataWriteError);
    expect(err.code).toBe('DUPLICATE_KEY');
  });

  it('declares indexes for the main lookup patterns', async () => {
    const indexes = await TrackingEvent.collection.indexes();
    const keys = indexes.map((i) => JSON.stringify(i.key));
    expect(keys).toEqual(
      expect.arrayContaining([
        '{"eventId":1}',
        '{"shipmentId":1,"sequence":1}',
        '{"shipmentId":1,"occurredAt":1}',
        '{"ingestedAt":1}',
      ]),
    );
  });
});
