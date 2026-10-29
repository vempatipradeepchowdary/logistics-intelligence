import { rngFor } from './rng.js';
import { eventId, legId } from '../utils/idGenerator.js';
import { MINUTE } from '../utils/time.js';

// Converts a simulated shipment's scan opportunities into observed tracking events.
//
// * Ingestion lag: each event is received after it happens (driver app, facility scanner,
//   carrier EDI batches, occasional delayed scans of 1-5 h). Lags stay below the 6 h
//   late-arrival threshold in the clean baseline.
// * Missed scans: intermediate arrival scans are missed at (1 - carrier scan compliance).
// * Optional departure scans are emitted ~18% of the time; the exact-count calibration
//   (see calibrateEventCounts) toggles a few of these to hit the configured event total.
// * Snapshot cut: only events ingested by the dataset asOf time exist in the dataset.

export const DEPARTURE_SCAN_RATE = 0.18;

const SOURCE_BY_TYPE = {
  PICKED_UP: 'DRIVER_APP',
  OUT_FOR_DELIVERY: 'DRIVER_APP',
  DELIVERY_ATTEMPTED: 'DRIVER_APP',
  DELIVERED: 'DRIVER_APP',
  ROUTE_CHANGED: 'SYSTEM',
};

function drawLag(rng, type, carrier) {
  const source = SOURCE_BY_TYPE[type];
  if (source === 'SYSTEM') return { source, minutes: rng.int(0, 2) };
  if (source === 'DRIVER_APP') {
    return { source, minutes: rng.chance(0.95) ? rng.int(1, 15) : rng.int(60, 240) };
  }
  if (rng.chance(carrier.ediBatchShare)) return { source: 'EDI_BATCH', minutes: rng.int(15, 120) };
  return {
    source: 'FACILITY_SCANNER',
    minutes: rng.chance(0.97) ? rng.int(1, 10) : rng.int(120, 300),
  };
}

/**
 * @returns {{ raw: object[], departureOn: number, departureOff: number }}
 * raw events carry `include`, `emittable` and `optional` flags; use selectEmitted() to finalise.
 */
export function planEvents(ctx, plan) {
  const rng = rngFor(ctx.seed, 'events', plan.seq);
  const raw = plan.milestones.map((m, ord) => {
    const lag = drawLag(rng, m.type, plan.carrier);
    let include = true;
    if (m.optional === 'DEPARTURE') include = rng.chance(DEPARTURE_SCAN_RATE);
    else if (m.optional === 'ARRIVAL') include = !rng.chance(1 - plan.carrier.scanComplianceRate);
    else rng.next(); // keep stream alignment identical for every milestone
    const ingestedAt = m.at + lag.minutes * MINUTE;
    return {
      ord,
      eventType: m.type,
      facilityId: m.facilityId,
      legSeq: m.legSeq,
      occurredAt: m.at,
      ingestedAt,
      source: lag.source,
      exceptionCode: m.exceptionCode ?? null,
      routeChange: m.routeChange ?? null,
      optional: m.optional,
      include,
      emittable: ingestedAt <= ctx.asOfMs,
    };
  });
  const slots = raw.filter((r) => r.optional === 'DEPARTURE' && r.emittable);
  return {
    raw,
    departureOn: slots.filter((r) => r.include).length,
    departureOff: slots.filter((r) => !r.include).length,
  };
}

/** Apply a calibration adjustment (+n: enable n more departure scans, -n: drop n). */
export function applyAdjustment(raw, adjustment) {
  if (!adjustment) return raw;
  const slots = raw.filter((r) => r.optional === 'DEPARTURE' && r.emittable);
  let remaining = Math.abs(adjustment);
  for (const slot of slots) {
    if (!remaining) break;
    if (adjustment > 0 && !slot.include) {
      slot.include = true;
      remaining -= 1;
    } else if (adjustment < 0 && slot.include) {
      slot.include = false;
      remaining -= 1;
    }
  }
  if (remaining) throw new Error(`Calibration adjustment ${adjustment} could not be applied`);
  return raw;
}

export const countEmitted = (raw) =>
  raw.reduce((n, r) => n + (r.include && r.emittable ? 1 : 0), 0);

/** Finalise: keep emitted events, order by occurrence, assign immutable sequence and IDs. */
export function finalizeEvents(raw, shipmentIdValue, partition) {
  const emitted = raw
    .filter((r) => r.include && r.emittable)
    .sort((a, b) => a.occurredAt - b.occurredAt || a.ord - b.ord);
  return emitted.map((r, i) => ({
    doc: {
      eventId: eventId(shipmentIdValue, i + 1),
      shipmentId: shipmentIdValue,
      partition,
      legId: legId(shipmentIdValue, r.legSeq),
      sequence: i + 1,
      eventType: r.eventType,
      facilityId: r.facilityId,
      occurredAt: new Date(r.occurredAt),
      ingestedAt: new Date(r.ingestedAt),
      source: r.source,
      exceptionCode: r.exceptionCode,
      routeChange: r.routeChange,
    },
    raw: r,
  }));
}

/**
 * Exact-count calibration. Pass 1 counted each shipment's natural events; this distributes the
 * difference to the configured target one departure scan at a time, round-robin over a seeded
 * permutation of shipments, so adjustments are spread thinly and deterministically.
 */
export function calibrateEventCounts({ seed, target, counts, departureOn, departureOff }) {
  const n = counts.length;
  let natural = 0;
  for (let i = 0; i < n; i += 1) natural += counts[i];
  const adjustments = new Int8Array(n);
  let diff = target - natural;
  const order = rngFor(seed, 'calibration').shuffle(Int32Array.from({ length: n }, (_, i) => i));
  while (diff !== 0) {
    let changed = false;
    for (const i of order) {
      if (diff === 0) break;
      if (diff > 0 && departureOff[i] - adjustments[i] > 0) {
        adjustments[i] += 1;
        diff -= 1;
        changed = true;
      } else if (diff < 0 && departureOn[i] + adjustments[i] > 0) {
        adjustments[i] -= 1;
        diff += 1;
        changed = true;
      }
    }
    if (!changed) {
      throw new Error(
        `Cannot calibrate event count: natural=${natural}, target=${target}, residual=${diff}`,
      );
    }
  }
  let adjusted = 0;
  for (let i = 0; i < n; i += 1) if (adjustments[i]) adjusted += 1;
  return { adjustments, naturalCount: natural, target, shipmentsAdjusted: adjusted };
}
