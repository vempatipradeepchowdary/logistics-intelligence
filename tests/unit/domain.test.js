import { describe, expect, it } from 'vitest';
import { canTransition, deriveStatus, hasOpenException } from '../../src/domain/lifecycle.js';
import {
  computePlannedPickupAt,
  computePromisedDeliveryAt,
  distanceZone,
} from '../../src/domain/sla.js';
import { effectivePath } from '../../src/domain/network.js';
import { plannedDeliveryWave } from '../../src/domain/operations.js';
import { SERVICE_LEVELS } from '../../src/generators/masterData.generator.js';

const at = (iso) => new Date(iso);
const ev = (eventType, iso, extra = {}) => ({
  eventId: `E-${iso}`,
  eventType,
  occurredAt: at(iso),
  ...extra,
});
const standard = SERVICE_LEVELS.find((s) => s.serviceLevelId === 'SL-STANDARD');

describe('lifecycle state machine', () => {
  it('allows the normal path and forbids leaving DELIVERED', () => {
    expect(canTransition('CREATED', 'PICKED_UP')).toBe(true);
    expect(canTransition('PICKED_UP', 'IN_TRANSIT')).toBe(true);
    expect(canTransition('OUT_FOR_DELIVERY', 'DELIVERED')).toBe(true);
    expect(canTransition('DELIVERED', 'IN_TRANSIT')).toBe(false);
    expect(canTransition('CREATED', 'DELIVERED')).toBe(false);
  });

  it('derives status by replaying events and reports illegal transitions', () => {
    const events = [
      ev('PICKED_UP', '2026-01-01T10:00:00Z'),
      ev('ARRIVED_AT_FACILITY', '2026-01-01T14:00:00Z'),
      ev('OUT_FOR_DELIVERY', '2026-01-02T08:00:00Z'),
      ev('DELIVERED', '2026-01-02T12:00:00Z'),
      ev('ARRIVED_AT_FACILITY', '2026-01-02T18:00:00Z'),
    ];
    const result = deriveStatus(events);
    expect(result.status).toBe('DELIVERED');
    expect(result.statusUpdatedAt).toEqual(at('2026-01-02T12:00:00Z'));
    expect(result.illegal).toHaveLength(1);
    expect(result.illegal[0].from).toBe('DELIVERED');
  });

  it('supports the failed-attempt exception workflow', () => {
    const events = [
      ev('PICKED_UP', '2026-01-01T10:00:00Z'),
      ev('ARRIVED_AT_FACILITY', '2026-01-01T14:00:00Z'),
      ev('OUT_FOR_DELIVERY', '2026-01-02T08:00:00Z'),
      ev('DELIVERY_ATTEMPTED', '2026-01-02T12:00:00Z', {
        exceptionCode: 'DELIVERY_ATTEMPT_FAILED',
      }),
      ev('OUT_FOR_DELIVERY', '2026-01-03T08:00:00Z'),
      ev('DELIVERED', '2026-01-03T11:00:00Z'),
    ];
    expect(deriveStatus(events)).toMatchObject({ status: 'DELIVERED', illegal: [] });
  });

  it('detects open DAMAGED exceptions', () => {
    expect(
      hasOpenException([
        ev('PICKED_UP', '2026-01-01T10:00:00Z'),
        ev('EXCEPTION', '2026-01-01T12:00:00Z', { exceptionCode: 'DAMAGED' }),
      ]),
    ).toBe(true);
    expect(
      hasOpenException([
        ev('EXCEPTION', '2026-01-01T12:00:00Z', { exceptionCode: 'DAMAGED' }),
        ev('ARRIVED_AT_FACILITY', '2026-01-01T15:00:00Z'),
      ]),
    ).toBe(false);
  });
});

describe('SLA rules', () => {
  it('assigns distance zones', () => {
    expect(distanceZone(100)).toBe('Z1');
    expect(distanceZone(1000)).toBe('Z2');
    expect(distanceZone(2000)).toBe('Z3');
    expect(distanceZone(4000)).toBe('Z4');
  });

  it('starts the SLA clock the next day for tenders after cutoff', () => {
    const before = computePromisedDeliveryAt(at('2026-01-05T10:00:00Z'), standard, 'Z3');
    const after = computePromisedDeliveryAt(at('2026-01-05T17:00:00Z'), standard, 'Z3');
    expect(new Date(before).toISOString()).toBe('2026-01-08T23:59:00.000Z');
    expect(new Date(after).toISOString()).toBe('2026-01-09T23:59:00.000Z');
    expect(
      new Date(computePlannedPickupAt(at('2026-01-05T10:00:00Z'), standard)).toISOString(),
    ).toBe('2026-01-05T13:00:00.000Z');
    expect(
      new Date(computePlannedPickupAt(at('2026-01-05T17:00:00Z'), standard)).toISOString(),
    ).toBe('2026-01-06T10:00:00.000Z');
  });
});

describe('network and last-mile rules', () => {
  it('computes the effective path after a reroute', () => {
    const planned = {
      routeId: 'R1',
      stops: ['A', 'H1', 'H2', 'B'].map((facilityId) => ({ facilityId })),
    };
    const alt = {
      routeId: 'R2',
      stops: ['A', 'H1', 'S', 'B'].map((facilityId) => ({ facilityId })),
    };
    expect(effectivePath(planned, planned)).toEqual(['A', 'H1', 'H2', 'B']);
    expect(effectivePath(planned, alt)).toEqual(['A', 'H1', 'S', 'B']);
  });

  it('dispatches on the documented delivery waves', () => {
    const iso = (ms) => new Date(ms).toISOString();
    expect(iso(plannedDeliveryWave(Date.parse('2026-01-05T03:00:00Z')))).toBe(
      '2026-01-05T08:00:00.000Z',
    );
    expect(iso(plannedDeliveryWave(Date.parse('2026-01-05T10:30:00Z')))).toBe(
      '2026-01-05T10:30:00.000Z',
    );
    expect(iso(plannedDeliveryWave(Date.parse('2026-01-05T15:00:00Z')))).toBe(
      '2026-01-06T08:00:00.000Z',
    );
  });
});
