import { beforeAll, describe, expect, it } from 'vitest';
import { resolveGenerationConfig } from '../../src/config/generation.js';
import { buildGenerationContext } from '../../src/generators/context.js';
import { simulateShipment } from '../../src/generators/shipment.generator.js';
import { finalizeEvents, planEvents } from '../../src/generators/event.generator.js';
import { buildShipmentDoc } from '../../src/generators/records.builder.js';
import {
  computeEta,
  ETA_CONFIG_HASH,
  PREDICTION_SHIPMENT_FIELDS,
  selectEligibleEvents,
  toPredictionShipment,
} from '../../src/services/eta.service.js';
import { HOUR, MINUTE } from '../../src/utils/time.js';

let ctx;
let fixture;

/** A delivered, cross-hub shipment with all its observed events. */
function buildFixture() {
  for (let seq = 1; seq < 500; seq += 1) {
    const plan = simulateShipment(ctx, seq);
    if (!plan.deliveredAt || plan.deliveredAt > ctx.asOfMs || plan.plannedRoute.stops.length < 4)
      continue;
    const events = finalizeEvents(planEvents(ctx, plan).raw, plan.shipmentId, 'BASELINE').map(
      (f) => f.doc,
    );
    if (events.length < 5) continue;
    const shipment = buildShipmentDoc(plan, events, 'BASELINE', ctx.asOfMs);
    return { plan, events, shipment };
  }
  throw new Error('no fixture shipment found');
}

const inputFor = (overrides = {}) => ({
  shipment: toPredictionShipment(fixture.shipment),
  events: fixture.events,
  routesById: ctx.routeIndex.byId,
  facilitiesById: ctx.facilitiesById,
  carrier: ctx.carriersById.get(fixture.shipment.carrierId),
  serviceLevel: ctx.serviceLevelsById.get(fixture.shipment.serviceLevelId),
  queueSource: ctx.queueModel.source,
  weatherIndex: ctx.weatherIndex,
  ...overrides,
});

beforeAll(() => {
  ctx = buildGenerationContext(resolveGenerationConfig({ profile: 'tiny', seed: 20261022 }));
  fixture = buildFixture();
});

describe('ETA engine determinism', () => {
  it('returns identical output for identical inputs', () => {
    const t = fixture.events[1].ingestedAt.getTime() + 30 * MINUTE;
    const a = computeEta(inputFor({ predictionAt: t }));
    const b = computeEta(inputFor({ predictionAt: t }));
    expect(a).toEqual(b);
    expect(a.configHash).toBe(ETA_CONFIG_HASH);
  });

  it('reconciles adjustment components with the total', () => {
    for (const e of fixture.events) {
      const r = computeEta(inputFor({ predictionAt: e.ingestedAt.getTime() + MINUTE }));
      const a = r.adjustments;
      expect(
        a.baseRemainingMinutes +
          a.queueMinutes +
          a.weatherMinutes +
          a.holdMinutes +
          a.interactionMinutes,
      ).toBe(a.totalRemainingMinutes);
      if (r.position.phase !== 'DELIVERED')
        expect(r.estimatedArrivalAt).toBeGreaterThanOrEqual(r.predictionAt);
    }
  });

  it('returns the delivery time once DELIVERED is known', () => {
    const delivered = fixture.events.find((e) => e.eventType === 'DELIVERED');
    const r = computeEta(inputFor({ predictionAt: delivered.ingestedAt.getTime() }));
    expect(r.position.phase).toBe('DELIVERED');
    expect(r.estimatedArrivalAt).toBe(delivered.occurredAt.getTime());
  });
});

describe('temporal integrity (no future data)', () => {
  it('ignores events ingested after the prediction time', () => {
    const t = fixture.events[2].ingestedAt.getTime() + MINUTE;
    const known = fixture.events.filter((e) => e.ingestedAt.getTime() <= t);
    const withFuture = computeEta(inputFor({ predictionAt: t }));
    const withoutFuture = computeEta(inputFor({ predictionAt: t, events: known }));
    expect(withFuture).toEqual(withoutFuture);
    expect(withFuture.watermark.maxEventIngestedAt).toBeLessThanOrEqual(t);
  });

  it('excludes a late-arriving event until it is ingested (event time vs ingestion time)', () => {
    const target = fixture.events.find((e) => e.eventType === 'ARRIVED_AT_FACILITY');
    const late = fixture.events.map((e) =>
      e.eventId === target.eventId
        ? { ...e, ingestedAt: new Date(e.occurredAt.getTime() + 30 * HOUR) }
        : e,
    );
    const between = target.occurredAt.getTime() + 2 * HOUR;
    const before = computeEta(inputFor({ predictionAt: between, events: late }));
    expect(before.inputs.eventIds).not.toContain(target.eventId);
    const after = computeEta(
      inputFor({ predictionAt: target.occurredAt.getTime() + 31 * HOUR, events: late }),
    );
    expect(after.inputs.eventIds).toContain(target.eventId);
  });

  it('requires both occurrence and ingestion before the prediction time', () => {
    const e = {
      ...fixture.events[1],
      ingestedAt: new Date(fixture.events[1].occurredAt.getTime() - HOUR),
    };
    const t = e.occurredAt.getTime() - 30 * MINUTE; // ingested (clock-skewed) but not yet occurred
    expect(selectEligibleEvents([e], t).eligible).toHaveLength(0);
  });

  it('ignores weather advisories and queue observations not yet ingested', () => {
    const t = fixture.events[1].ingestedAt.getTime() + MINUTE;
    const r = computeEta(inputFor({ predictionAt: t }));
    for (const id of r.inputs.weatherEventIds)
      expect(ctx.weatherIndex.byId.get(id).ingestedAt).toBeLessThanOrEqual(t);
    expect(r.watermark.maxQueueIngestedAt ?? 0).toBeLessThanOrEqual(t);
    // A future advisory covering every facility must not change the estimate.
    const futureAdvisory = {
      weatherEventId: 'WX-2026-99999',
      severity: 5,
      startAt: t - HOUR,
      endAt: t + 10 * 24 * HOUR,
      issuedAt: t + HOUR,
      ingestedAt: t + HOUR,
      expectedDelayMinutes: 900,
      transitSlowdownPct: 40,
    };
    const weatherIndex = {
      ...ctx.weatherIndex,
      forFacility: (f) => [...ctx.weatherIndex.forFacility(f), futureAdvisory],
    };
    expect(computeEta(inputFor({ predictionAt: t, weatherIndex })).estimatedArrivalAt).toBe(
      r.estimatedArrivalAt,
    );
  });

  it('never sees outcome fields: only creation-time shipment facts are passed', () => {
    const view = toPredictionShipment({
      ...fixture.shipment,
      status: 'DELIVERED',
      deliveredAt: new Date(0),
    });
    expect(Object.keys(view).sort()).toEqual([...PREDICTION_SHIPMENT_FIELDS].sort());
    const t = fixture.events[1].ingestedAt.getTime() + MINUTE;
    const mutated = {
      ...fixture.shipment,
      status: 'EXCEPTION',
      deliveredAt: new Date(t),
      currentRouteId: 'RTE-00001',
    };
    expect(
      computeEta(inputFor({ predictionAt: t, shipment: toPredictionShipment(mutated) })),
    ).toEqual(computeEta(inputFor({ predictionAt: t })));
  });

  it('drops duplicate scans', () => {
    const dup = { ...fixture.events[1], eventId: 'EVT-SHP-2026-000999-000099', sequence: 99 };
    const t = fixture.events[2].ingestedAt.getTime() + MINUTE;
    const r = computeEta(inputFor({ predictionAt: t, events: [...fixture.events, dup] }));
    expect(r.inputs.ignoredEventIds).toContain(dup.eventId);
    expect(r.watermark.eventsConsidered).toBe(
      computeEta(inputFor({ predictionAt: t })).watermark.eventsConsidered,
    );
  });
});
