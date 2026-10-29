import { DAY, MINUTE, minuteOfDay, startOfUtcDay, toMs } from '../utils/time.js';

/** Planned pickup offset after tender when the tender is before cutoff. */
export const SAME_DAY_PICKUP_OFFSET_MINUTES = 180;
/** Planned pickup minute-of-day for tenders after cutoff (next day). */
export const NEXT_DAY_PICKUP_MINUTE = 10 * 60;

export function distanceZone(totalDistanceKm) {
  if (totalDistanceKm < 500) return 'Z1';
  if (totalDistanceKm < 1500) return 'Z2';
  if (totalDistanceKm < 3000) return 'Z3';
  return 'Z4';
}

const beforeCutoff = (createdMs, serviceLevel) =>
  minuteOfDay(createdMs) < serviceLevel.pickupCutoffMinuteUtc;

/** Day on which the SLA clock starts: tender day if before cutoff, otherwise the next day. */
export function serviceStartDay(createdAt, serviceLevel) {
  const createdMs = toMs(createdAt);
  return startOfUtcDay(createdMs) + (beforeCutoff(createdMs, serviceLevel) ? 0 : DAY);
}

/** SLA deadline = service start day + committed zone days, at the service level's deadline minute. */
export function computePromisedDeliveryAt(createdAt, serviceLevel, zone) {
  const days = serviceLevel.transitDaysByZone[zone];
  if (!Number.isInteger(days))
    throw new Error(`No transit days for zone ${zone} on ${serviceLevel.serviceLevelId}`);
  return (
    serviceStartDay(createdAt, serviceLevel) + days * DAY + serviceLevel.deadlineMinuteUtc * MINUTE
  );
}

export function computePlannedPickupAt(createdAt, serviceLevel) {
  const createdMs = toMs(createdAt);
  if (beforeCutoff(createdMs, serviceLevel))
    return createdMs + SAME_DAY_PICKUP_OFFSET_MINUTES * MINUTE;
  return startOfUtcDay(createdMs) + DAY + NEXT_DAY_PICKUP_MINUTE * MINUTE;
}
