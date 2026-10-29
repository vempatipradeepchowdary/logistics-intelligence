import { describe, expect, it } from 'vitest';
import { attributeDelay, classifyShipment } from '../../src/services/delay.service.js';

const promised = Date.parse('2026-01-10T23:59:00Z');
const base = {
  promisedDeliveryAt: promised,
  asOf: Date.parse('2026-01-09T00:00:00Z'),
  createdAt: Date.parse('2026-01-05T10:00:00Z'),
  hasOpenException: false,
  hasPickupScan: true,
  etaAtAsOf: Date.parse('2026-01-10T12:00:00Z'),
  atRiskBufferMinutes: 240,
};

describe('ground-truth classification rules', () => {
  it('R1: delivered on time / late', () => {
    expect(classifyShipment({ ...base, actualDeliveredAt: promised - 1 })).toMatchObject({
      delayClass: 'ON_TIME',
      delayMinutes: 0,
      deliveryOutcome: 'DELIVERED',
    });
    expect(classifyShipment({ ...base, actualDeliveredAt: promised + 90 * 60000 })).toMatchObject({
      delayClass: 'DELAYED',
      delayMinutes: 90,
    });
  });
  it('R2: open exception', () => {
    expect(classifyShipment({ ...base, hasOpenException: true }).delayClass).toBe(
      'OPERATIONAL_EXCEPTION',
    );
  });
  it('R3: no pickup scan after 24h is insufficient data, not a guess', () => {
    expect(classifyShipment({ ...base, hasPickupScan: false }).delayClass).toBe(
      'INSUFFICIENT_DATA',
    );
  });
  it('R4: overdue and undelivered', () => {
    const r = classifyShipment({ ...base, asOf: promised + 120 * 60000 });
    expect(r).toMatchObject({
      delayClass: 'DELAYED',
      delayMinutes: 120,
      deliveryOutcome: 'NOT_DELIVERED',
    });
  });
  it('R5-R7: ETA-based forward classification', () => {
    expect(classifyShipment({ ...base, etaAtAsOf: null }).delayClass).toBe('INSUFFICIENT_DATA');
    expect(classifyShipment({ ...base, etaAtAsOf: promised - 60 * 60000 }).delayClass).toBe(
      'AT_RISK',
    );
    expect(classifyShipment(base).delayClass).toBe('ON_TRACK');
  });
});

describe('delay attribution', () => {
  const shipment = {
    destinationFacilityId: 'FAC-050',
    createdAt: base.createdAt,
    plannedPickupAt: Date.parse('2026-01-05T13:00:00Z'),
    pickedUpAt: Date.parse('2026-01-05T13:10:00Z'),
    routeChange: null,
    lastMile: {
      weatherMinutes: 0,
      queueMinutes: 0,
      weatherEventIds: [],
      attemptDelayMinutes: 0,
      attemptFailed: false,
    },
  };
  const leg = (legId, b, weatherEventIds = []) => ({
    legId,
    status: 'COMPLETED',
    fromFacilityId: 'FAC-001',
    delayBreakdown: b,
    weatherEventIds,
  });

  it('selects the largest reason as primary and drops reasons under 30 minutes', () => {
    const legs = [
      leg('L1', { queueMinutes: 20, weatherMinutes: 300, carrierMinutes: 45 }, ['WX-2026-00001']),
      leg('L2', { queueMinutes: 5, weatherMinutes: 0, carrierMinutes: -20 }),
    ];
    const reasons = attributeDelay({
      shipment,
      legs,
      events: [],
      delayMinutes: 200,
      delivered: true,
      asOf: base.asOf,
    });
    expect(reasons.map((r) => r.reasonCode)).toEqual(['WEATHER_DISRUPTION', 'CARRIER_DELAY']);
    expect(reasons.find((r) => r.isPrimary).reasonCode).toBe('WEATHER_DISRUPTION');
    expect(reasons[0].evidence.weatherEventIds).toEqual(['WX-2026-00001']);
    expect(reasons.filter((r) => r.isPrimary)).toHaveLength(1);
  });

  it('falls back to UNATTRIBUTED when no reason is material', () => {
    const reasons = attributeDelay({
      shipment,
      legs: [],
      events: [],
      delayMinutes: 25,
      delivered: true,
      asOf: base.asOf,
    });
    expect(reasons).toEqual([
      expect.objectContaining({
        reasonCode: 'UNATTRIBUTED',
        attributedMinutes: 25,
        isPrimary: true,
      }),
    ]);
  });

  it('flags missing tracking for silent overdue shipments', () => {
    const events = [
      { eventType: 'PICKED_UP', occurredAt: Date.parse('2026-01-05T13:10:00Z'), sequence: 1 },
    ];
    const reasons = attributeDelay({
      shipment,
      legs: [],
      events,
      delayMinutes: 500,
      delivered: false,
      asOf: Date.parse('2026-01-12T00:00:00Z'),
    });
    expect(reasons.map((r) => r.reasonCode)).toContain('MISSING_TRACKING_INFO');
  });
});
