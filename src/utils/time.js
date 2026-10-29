// All timestamps are UTC. Internally the simulator works in integer epoch milliseconds that are
// always whole minutes, so derived durations reconcile exactly.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const toMs = (value) => (value instanceof Date ? value.getTime() : Number(value));
export const toDate = (ms) => new Date(ms);
export const toIso = (value) =>
  value === null || value === undefined ? null : new Date(toMs(value)).toISOString();

export const floorToMinute = (ms) => Math.floor(ms / MINUTE) * MINUTE;
export const startOfUtcDay = (ms) => Math.floor(ms / DAY) * DAY;
export const minuteOfDay = (ms) => Math.floor((ms - startOfUtcDay(ms)) / MINUTE);
export const minutesBetween = (fromMs, toMsValue) => Math.round((toMsValue - fromMs) / MINUTE);

/** Compact sortable timestamp used inside business IDs, e.g. 20260103T1200Z. */
export function compactTimestamp(value) {
  const iso = new Date(toMs(value)).toISOString(); // 2026-01-03T12:00:00.000Z
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}Z`;
}
