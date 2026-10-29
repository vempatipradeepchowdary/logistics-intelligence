import { DAY, MINUTE, startOfUtcDay, toMs } from '../utils/time.js';

// Operational rules shared by the physical simulator and the ETA engine.

/** Advisory processing delay (minutes) per weather severity, before per-event impact jitter. */
export const WEATHER_DWELL_DELAY_BY_SEVERITY = Object.freeze({
  1: 20,
  2: 60,
  3: 180,
  4: 420,
  5: 900,
});
/** Linehaul slowdown percentage per severity point. */
export const WEATHER_TRANSIT_SLOWDOWN_PCT_PER_SEVERITY = 8;

/** Last-mile dispatch waves (UTC minute of day). */
export const FIRST_WAVE_MINUTE = 8 * 60;
export const SECOND_WAVE_CUTOFF_MINUTE = 12 * 60;

/**
 * Planned out-for-delivery time for a parcel ready at `readyMs`:
 * ready before 08:00 -> 08:00 wave; ready 08:00-12:00 -> dispatched on readiness; later -> next day 08:00.
 */
export function plannedDeliveryWave(readyMs) {
  const dayStart = startOfUtcDay(readyMs);
  const first = dayStart + FIRST_WAVE_MINUTE * MINUTE;
  if (readyMs <= first) return first;
  if (readyMs <= dayStart + SECOND_WAVE_CUTOFF_MINUTE * MINUTE) return readyMs;
  return dayStart + DAY + FIRST_WAVE_MINUTE * MINUTE;
}

/** Next-day first wave after a failed delivery attempt. */
export const retryWaveAfter = (attemptMs) =>
  startOfUtcDay(attemptMs) + DAY + FIRST_WAVE_MINUTE * MINUTE;

/**
 * Index of disruption windows per facility. Works with generator objects or DB documents
 * (Date or epoch-ms fields); all times are normalised to epoch ms.
 */
export function buildWeatherIndex(weatherEvents) {
  const byFacility = new Map();
  const byId = new Map();
  for (const raw of weatherEvents) {
    const ev = {
      weatherEventId: raw.weatherEventId,
      severity: raw.severity,
      startAt: toMs(raw.startAt),
      endAt: toMs(raw.endAt),
      issuedAt: toMs(raw.issuedAt),
      ingestedAt: toMs(raw.ingestedAt),
      expectedDelayMinutes: raw.expectedDelayMinutes,
      transitSlowdownPct: raw.transitSlowdownPct,
      affectedFacilityIds: raw.affectedFacilityIds,
    };
    byId.set(ev.weatherEventId, ev);
    for (const facilityId of ev.affectedFacilityIds) {
      if (!byFacility.has(facilityId)) byFacility.set(facilityId, []);
      byFacility.get(facilityId).push(ev);
    }
  }
  for (const list of byFacility.values()) {
    list.sort((a, b) => a.startAt - b.startAt || (a.weatherEventId < b.weatherEventId ? -1 : 1));
  }
  return {
    byId,
    forFacility: (facilityId) => byFacility.get(facilityId) ?? [],
    /** All windows active at a facility at time ms (physical truth, ignores advisory timing). */
    activeAt(facilityId, ms) {
      return (byFacility.get(facilityId) ?? []).filter((ev) => ev.startAt <= ms && ms < ev.endAt);
    },
  };
}

/** Physical weather dwell delay at a facility: the strongest active window applies (no stacking). */
export function weatherDwellAt(weatherIndex, facilityId, ms) {
  let best = null;
  for (const ev of weatherIndex.activeAt(facilityId, ms)) {
    if (!best || ev.expectedDelayMinutes > best.expectedDelayMinutes) best = ev;
  }
  return best
    ? { minutes: best.expectedDelayMinutes, eventId: best.weatherEventId }
    : { minutes: 0, eventId: null };
}

/** Max transit slowdown (%) from windows active at either end of a leg. */
export function weatherTransitSlowdown(weatherIndex, fromId, departMs, toId, plannedArriveMs) {
  let pct = 0;
  const ids = new Set();
  for (const ev of [
    ...weatherIndex.activeAt(fromId, departMs),
    ...weatherIndex.activeAt(toId, plannedArriveMs),
  ]) {
    pct = Math.max(pct, ev.transitSlowdownPct);
    ids.add(ev.weatherEventId);
  }
  return { pct, eventIds: [...ids] };
}
