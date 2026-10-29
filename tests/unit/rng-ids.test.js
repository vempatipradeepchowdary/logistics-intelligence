import { describe, expect, it } from 'vitest';
import { hash32, rngFor, seedFor } from '../../src/generators/rng.js';
import * as ids from '../../src/utils/idGenerator.js';
import { ID_PATTERNS } from '../../src/config/constants.js';
import { csvCell, csvRow, parseCsv } from '../../src/utils/csv.js';
import { canonicalJson, hashObject } from '../../src/utils/hash.js';

describe('seeded RNG', () => {
  it('produces identical sequences for identical seeds and keys', () => {
    const a = rngFor(20261022, 'shipment', 7);
    const b = rngFor(20261022, 'shipment', 7);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('separates streams by seed, namespace and key', () => {
    const first = (seed, ...k) => rngFor(seed, ...k).next();
    expect(first(1, 'shipment', 1)).not.toBe(first(2, 'shipment', 1));
    expect(first(1, 'shipment', 1)).not.toBe(first(1, 'events', 1));
    expect(first(1, 'shipment', 1)).not.toBe(first(1, 'shipment', 2));
    expect(seedFor(1, 'a', 2)).toBe(hash32('1|a|2'));
  });

  it('respects ranges and weights', () => {
    const rng = rngFor(42, 'range');
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 10000; i += 1) {
      const v = rng.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      counts[rng.weighted(['a', 'b'], [9, 1])] += 1;
    }
    expect(counts.a / 10000).toBeGreaterThan(0.85);
    expect(counts.a / 10000).toBeLessThan(0.95);
  });

  it('shuffles deterministically and as a permutation', () => {
    const s1 = rngFor(9, 'p').shuffle([...Array(100).keys()]);
    const s2 = rngFor(9, 'p').shuffle([...Array(100).keys()]);
    expect(s1).toEqual(s2);
    expect([...s1].sort((x, y) => x - y)).toEqual([...Array(100).keys()]);
  });
});

describe('business ID generation', () => {
  it('formats every ID family to its documented pattern', () => {
    const shp = ids.shipmentId(2026, 1);
    expect(shp).toBe('SHP-2026-000001');
    expect(ids.legId(shp, 1)).toBe('LEG-SHP-2026-000001-01');
    expect(ids.eventId(shp, 1)).toBe('EVT-SHP-2026-000001-000001');
    expect(ids.etaId(shp, Date.UTC(2026, 0, 3, 12, 0))).toBe('ETA-SHP-2026-000001-20260103T1200Z');
    expect(ids.delayId(2026, 1)).toBe('DLY-2026-000001');
    const samples = {
      shipmentId: shp,
      legId: ids.legId(shp, 2),
      eventId: ids.eventId(shp, 3),
      etaId: ids.etaId(shp, Date.UTC(2026, 0, 3)),
      delayId: ids.delayId(2026, 5),
      facilityId: ids.facilityId(7),
      carrierId: ids.carrierId(1),
      routeId: ids.routeId(12),
      weatherEventId: ids.weatherEventId(2026, 1),
      queueObservationId: ids.queueObservationId('FAC-001', Date.UTC(2026, 0, 1, 4)),
      groundTruthId: ids.groundTruthId(shp),
      anomalyId: ids.anomalyId(2026, 1),
    };
    for (const [key, value] of Object.entries(samples)) expect(value).toMatch(ID_PATTERNS[key]);
  });

  it('rejects out-of-range sequences', () => {
    expect(() => ids.shipmentId(2026, 0)).toThrow(RangeError);
    expect(() => ids.shipmentId(2026, 1_000_000)).toThrow(RangeError);
    expect(() => ids.legId('SHP-2026-000001', 100)).toThrow(RangeError);
  });
});

describe('CSV and canonical hashing', () => {
  it('escapes RFC 4180 special characters and round-trips', () => {
    const values = [
      'plain',
      'has,comma',
      'has "quote"',
      'multi\nline',
      null,
      12.5,
      new Date(Date.UTC(2026, 0, 1)),
    ];
    const parsed = parseCsv(csvRow(values));
    expect(parsed[0]).toEqual([
      'plain',
      'has,comma',
      'has "quote"',
      'multi\nline',
      '',
      '12.5',
      '2026-01-01T00:00:00.000Z',
    ]);
    expect(csvCell('a"b')).toBe('"a""b"');
  });

  it('hashes objects independently of key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
    expect(hashObject({ x: 1, y: 2 })).toBe(hashObject({ y: 2, x: 1 }));
  });
});
