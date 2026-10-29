import { describe, expect, it } from 'vitest';
import { resolveGenerationConfig } from '../../src/config/generation.js';
import { buildGenerationContext } from '../../src/generators/context.js';
import { simulateShipment } from '../../src/generators/shipment.generator.js';
import {
  applyAdjustment,
  calibrateEventCounts,
  countEmitted,
  planEvents,
} from '../../src/generators/event.generator.js';
import { buildLegDocs } from '../../src/generators/records.builder.js';
import { ValidationCollector } from '../../src/validators/collector.js';
import { deriveFieldChecks } from '../../src/validators/schema.validator.js';
import { Shipment } from '../../src/models/index.js';

const ctx = buildGenerationContext(resolveGenerationConfig({ profile: 'tiny', seed: 20261022 }));

describe('master data', () => {
  it('builds 100 facilities with a valid hub hierarchy and connected routes', () => {
    expect(ctx.facilities).toHaveLength(100);
    const hubs = new Set(ctx.facilities.filter((f) => f.type === 'HUB').map((f) => f.facilityId));
    for (const f of ctx.facilities)
      if (f.type !== 'HUB') expect(hubs.has(f.parentHubId)).toBe(true);
    for (const r of ctx.routes.slice(0, 500)) {
      r.legs.forEach((l, i) => {
        expect(l.fromFacilityId).toBe(r.stops[i].facilityId);
        expect(l.toFacilityId).toBe(r.stops[i + 1].facilityId);
      });
    }
  });

  it('is deterministic for a seed', () => {
    const again = buildGenerationContext(
      resolveGenerationConfig({ profile: 'tiny', seed: 20261022 }),
    );
    expect(again.weatherEvents).toEqual(ctx.weatherEvents);
    expect(again.facilities).toEqual(ctx.facilities);
  });
});

describe('shipment simulation', () => {
  it('is reproducible per shipment sequence (order independent)', () => {
    const a = simulateShipment(ctx, 42);
    simulateShipment(ctx, 7); // unrelated work in between must not matter
    expect(simulateShipment(ctx, 42)).toEqual(a);
  });

  it('derives leg durations from recorded delay components', () => {
    for (let seq = 1; seq <= 200; seq += 1) {
      const plan = simulateShipment(ctx, seq);
      for (const leg of buildLegDocs(plan, 'BASELINE', ctx.asOfMs).filter(
        (l) => l.status === 'COMPLETED',
      )) {
        const b = leg.delayBreakdown;
        expect(leg.actualDwellMinutes + leg.actualTransitMinutes).toBe(
          leg.plannedDwellMinutes +
            leg.plannedTransitMinutes +
            b.queueMinutes +
            b.weatherMinutes +
            b.carrierMinutes,
        );
      }
      expect(plan.promisedDeliveryAt).toBeGreaterThan(plan.createdAt);
    }
  });

  it('emits events no later than the snapshot and with ingestion >= occurrence', () => {
    for (let seq = 1; seq <= 200; seq += 1) {
      const { raw } = planEvents(ctx, simulateShipment(ctx, seq));
      for (const r of raw.filter((x) => x.include && x.emittable)) {
        expect(r.ingestedAt).toBeGreaterThanOrEqual(r.occurredAt);
        expect(r.ingestedAt).toBeLessThanOrEqual(ctx.asOfMs);
      }
    }
  });
});

describe('exact-count calibration', () => {
  it('hits the target exactly in both directions', () => {
    const counts = Int32Array.from([5, 6, 7, 5, 6]);
    const on = Uint8Array.from([1, 1, 2, 0, 1]);
    const off = Uint8Array.from([2, 1, 0, 3, 1]);
    for (const target of [25, 32]) {
      const { adjustments } = calibrateEventCounts({
        seed: 1,
        target,
        counts,
        departureOn: on,
        departureOff: off,
      });
      expect(counts.reduce((s, c, i) => s + c + adjustments[i], 0)).toBe(target);
    }
    expect(() =>
      calibrateEventCounts({ seed: 1, target: 100, counts, departureOn: on, departureOff: off }),
    ).toThrow(/Cannot calibrate/);
  });

  it('applies adjustments only to optional departure scans', () => {
    const plan = simulateShipment(ctx, 3);
    const { raw, departureOff } = planEvents(ctx, plan);
    const before = countEmitted(raw);
    applyAdjustment(raw, departureOff);
    expect(countEmitted(raw)).toBe(before + departureOff);
    expect(() => applyAdjustment(raw, 1)).toThrow();
  });
});

describe('validation collector', () => {
  it('separates intentional anomalies from unexpected defects', () => {
    const c = new ValidationCollector([
      {
        anomalyId: 'ANM-2026-0001',
        shipmentId: 'SHP-2026-900001',
        scenario: 'X',
        variant: 'Y',
        expectedRuleIds: ['EVENT_DUPLICATE'],
      },
    ]);
    c.fail('EVENT_DUPLICATE', { recordId: 'EVT-a', shipmentId: 'SHP-2026-900001' });
    c.fail('EVENT_DUPLICATE', { recordId: 'EVT-b', shipmentId: 'SHP-2026-000001' });
    c.pass('EVENT_DUPLICATE', 10);
    const r = c.report();
    expect(r.summary).toMatchObject({
      failedChecks: 2,
      intentionalAnomalies: 1,
      unexpectedErrors: 1,
      missedAnomalies: 0,
    });
    expect(r.status).toBe('FAIL');
    expect(r.violations[0]).toMatchObject({
      classification: 'INTENTIONAL_ANOMALY',
      anomalyId: 'ANM-2026-0001',
      severity: 'ERROR',
    });
    expect(Object.keys(r.violations[1])).toEqual(
      expect.arrayContaining([
        'ruleId',
        'severity',
        'entityType',
        'recordId',
        'status',
        'expected',
        'actual',
        'explanation',
        'recommendedCorrection',
      ]),
    );
  });

  it('reports anomalies that were not detected', () => {
    const c = new ValidationCollector([
      {
        anomalyId: 'ANM-1',
        shipmentId: 'S',
        scenario: 'X',
        variant: 'Y',
        expectedRuleIds: ['EVENT_DUPLICATE'],
      },
    ]);
    expect(c.report().summary.missedAnomalies).toBe(1);
  });

  it('derives required/enum/format checks from the Mongoose schema', () => {
    const checks = deriveFieldChecks(Shipment.schema);
    const has = (ruleId, path) => checks.some((c) => c.ruleId === ruleId && c.path === path);
    expect(has('SCHEMA_REQUIRED_FIELD', 'shipmentId')).toBe(true);
    expect(has('SCHEMA_ENUM_VALUE', 'status')).toBe(true);
    expect(has('SCHEMA_ID_FORMAT', 'carrierId')).toBe(true);
    expect(has('SCHEMA_REQUIRED_FIELD', 'lastMile.attemptFailed')).toBe(true);
  });
});
