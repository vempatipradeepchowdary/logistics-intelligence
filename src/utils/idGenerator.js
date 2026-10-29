import { randomBytes } from 'node:crypto';
import { compactTimestamp } from './time.js';

// Deterministic, immutable, human-readable business identifiers.
const pad = (n, width) => String(n).padStart(width, '0');

function assertSeq(seq, max, label) {
  if (!Number.isInteger(seq) || seq < 1 || seq > max) {
    throw new RangeError(`${label} sequence must be an integer in [1, ${max}], got ${seq}`);
  }
}

export function shipmentId(year, seq) {
  assertSeq(seq, 999999, 'shipment');
  return `SHP-${year}-${pad(seq, 6)}`;
}
export function legId(shipment, seq) {
  assertSeq(seq, 99, 'leg');
  return `LEG-${shipment}-${pad(seq, 2)}`;
}
export function eventId(shipment, seq) {
  assertSeq(seq, 999999, 'event');
  return `EVT-${shipment}-${pad(seq, 6)}`;
}
export const etaId = (shipment, predictionAt) =>
  `ETA-${shipment}-${compactTimestamp(predictionAt)}`;
export function delayId(year, seq) {
  assertSeq(seq, 999999, 'delay');
  return `DLY-${year}-${pad(seq, 6)}`;
}
export const facilityId = (n) => `FAC-${pad(n, 3)}`;
export const carrierId = (n) => `CAR-${pad(n, 3)}`;
export const routeId = (n) => `RTE-${pad(n, 5)}`;
export const weatherEventId = (year, n) => `WX-${year}-${pad(n, 5)}`;
export const queueObservationId = (facility, observedAt) =>
  `FQ-${facility}-${compactTimestamp(observedAt)}`;
export const groundTruthId = (shipment) => `GT-${shipment}`;
export const anomalyId = (year, n) => `ANM-${year}-${pad(n, 4)}`;

/** Job IDs are operational (not part of the dataset) and therefore random. */
export const jobId = (type) =>
  `JOB-${type}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
