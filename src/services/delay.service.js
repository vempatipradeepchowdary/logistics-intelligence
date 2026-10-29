import { DELAY_REASON_CODES } from '../config/constants.js';
import { compareEvents } from '../domain/lifecycle.js';
import { HOUR, MINUTE, toMs } from '../utils/time.js';

export const LABEL_RULE_VERSION = 'gt-rules-v1.0.0';
export const DELAY_RULE_VERSION = 'delay-attribution-v1.0.0';
export const MIN_ATTRIBUTED_MINUTES = 30;
export const MISSING_TRACKING_HOURS = 48;
export const INSUFFICIENT_DATA_HOURS = 24;

const minutesLate = (fromMs, toMsValue) => Math.max(0, Math.ceil((toMsValue - fromMs) / MINUTE));

/**
 * Ground-truth delay classification (documented business rules, evaluated in order):
 *  1. Delivered by asOf             -> ON_TIME if deliveredAt <= promised, else DELAYED
 *  2. Open DAMAGED exception        -> OPERATIONAL_EXCEPTION
 *  3. No pickup scan 24h+ after tender -> INSUFFICIENT_DATA (outcome cannot be established)
 *  4. asOf past the deadline        -> DELAYED (overdue)
 *  5. No ETA available              -> INSUFFICIENT_DATA
 *  6. ETA at asOf > deadline - buffer -> AT_RISK
 *  7. otherwise                     -> ON_TRACK
 */
export function classifyShipment({
  actualDeliveredAt,
  promisedDeliveryAt,
  asOf,
  createdAt,
  hasOpenException,
  hasPickupScan,
  etaAtAsOf,
  atRiskBufferMinutes,
}) {
  const promised = toMs(promisedDeliveryAt);
  const asOfMs = toMs(asOf);
  if (actualDeliveredAt) {
    const delivered = toMs(actualDeliveredAt);
    const delayMinutes = minutesLate(promised, delivered);
    return {
      deliveryOutcome: 'DELIVERED',
      delayClass: delivered <= promised ? 'ON_TIME' : 'DELAYED',
      delayMinutes,
      rationale:
        delivered <= promised
          ? 'R1: delivered on or before the SLA deadline'
          : `R1: delivered ${delayMinutes} min after the SLA deadline`,
    };
  }
  const overdue = minutesLate(promised, asOfMs);
  const base = { deliveryOutcome: 'NOT_DELIVERED', delayMinutes: overdue };
  if (hasOpenException) {
    return {
      ...base,
      delayClass: 'OPERATIONAL_EXCEPTION',
      rationale: 'R2: open DAMAGED exception hold',
    };
  }
  if (!hasPickupScan && asOfMs - toMs(createdAt) > INSUFFICIENT_DATA_HOURS * HOUR) {
    return {
      ...base,
      delayClass: 'INSUFFICIENT_DATA',
      rationale: 'R3: no pickup scan more than 24h after tender; outcome cannot be established',
    };
  }
  if (asOfMs > promised) {
    return {
      ...base,
      delayClass: 'DELAYED',
      rationale: `R4: not delivered, ${overdue} min past the SLA deadline`,
    };
  }
  if (etaAtAsOf === null || etaAtAsOf === undefined) {
    return { ...base, delayClass: 'INSUFFICIENT_DATA', rationale: 'R5: no ETA available at asOf' };
  }
  if (toMs(etaAtAsOf) > promised - atRiskBufferMinutes * MINUTE) {
    return {
      ...base,
      delayClass: 'AT_RISK',
      rationale: `R6: ETA at asOf is within ${atRiskBufferMinutes} min of (or past) the deadline`,
    };
  }
  return {
    ...base,
    delayClass: 'ON_TRACK',
    rationale: 'R7: ETA at asOf comfortably before the deadline',
  };
}

/**
 * Attribute a delayed shipment's lateness to reasons, using only recorded source data:
 * leg delay breakdowns, last-mile record, route change record, pickup times and tracking events.
 * Reasons below MIN_ATTRIBUTED_MINUTES are dropped; if none remain the delay is UNATTRIBUTED.
 * Contributions may overlap with schedule slack, so they are not forced to sum to the lateness.
 */
export function attributeDelay({ shipment, legs, events, delayMinutes, delivered, asOf }) {
  const completed = legs.filter((l) => l.status === 'COMPLETED' && l.delayBreakdown);
  const candidates = new Map();
  const add = (code, minutes, evidence) => candidates.set(code, { minutes, evidence });
  const ids = (list) => [...new Set(list)].sort();

  const lastMile = shipment.lastMile;
  const weatherLegs = completed.filter((l) => l.delayBreakdown.weatherMinutes > 0);
  add(
    'WEATHER_DISRUPTION',
    weatherLegs.reduce((s, l) => s + l.delayBreakdown.weatherMinutes, 0) +
      (lastMile?.weatherMinutes ?? 0),
    {
      legIds: ids(weatherLegs.map((l) => l.legId)),
      facilityIds: ids([
        ...weatherLegs.map((l) => l.fromFacilityId),
        ...(lastMile?.weatherMinutes ? [shipment.destinationFacilityId] : []),
      ]),
      weatherEventIds: ids([
        ...weatherLegs.flatMap((l) => l.weatherEventIds ?? []),
        ...(lastMile?.weatherEventIds ?? []),
      ]),
    },
  );
  const queueLegs = completed.filter((l) => l.delayBreakdown.queueMinutes > 0);
  add(
    'FACILITY_CONGESTION',
    queueLegs.reduce((s, l) => s + l.delayBreakdown.queueMinutes, 0) +
      (lastMile?.queueMinutes ?? 0),
    {
      legIds: ids(queueLegs.map((l) => l.legId)),
      facilityIds: ids([
        ...queueLegs.map((l) => l.fromFacilityId),
        ...(lastMile?.queueMinutes ? [shipment.destinationFacilityId] : []),
      ]),
      weatherEventIds: [],
    },
  );
  const carrierLegs = completed.filter((l) => l.delayBreakdown.carrierMinutes > 0);
  const pickupLate = shipment.pickedUpAt
    ? minutesLate(toMs(shipment.plannedPickupAt), toMs(shipment.pickedUpAt))
    : 0;
  add(
    'CARRIER_DELAY',
    carrierLegs.reduce((s, l) => s + l.delayBreakdown.carrierMinutes, 0) + pickupLate,
    {
      legIds: ids(carrierLegs.map((l) => l.legId)),
      facilityIds: [],
      weatherEventIds: [],
    },
  );
  add('ROUTE_CHANGE', Math.max(0, shipment.routeChange?.extraPlannedMinutes ?? 0), {
    legIds: ids(legs.filter((l) => l.status === 'CANCELLED').map((l) => l.legId)),
    facilityIds: shipment.routeChange ? [shipment.routeChange.atFacilityId] : [],
    weatherEventIds: [],
  });
  add('DELIVERY_EXCEPTION', lastMile?.attemptDelayMinutes ?? 0, {
    legIds: [],
    facilityIds: lastMile?.attemptFailed ? [shipment.destinationFacilityId] : [],
    weatherEventIds: [],
  });
  if (!delivered) {
    const lastEvent = [...events].sort(compareEvents).at(-1);
    const silentSince = lastEvent ? toMs(lastEvent.occurredAt) : toMs(shipment.createdAt);
    if (toMs(asOf) - silentSince > MISSING_TRACKING_HOURS * HOUR) {
      add('MISSING_TRACKING_INFO', delayMinutes, {
        legIds: [],
        facilityIds: [],
        weatherEventIds: [],
      });
    }
  }

  let reasons = DELAY_REASON_CODES.filter(
    (code) => candidates.has(code) && candidates.get(code).minutes >= MIN_ATTRIBUTED_MINUTES,
  ).map((code) => ({
    reasonCode: code,
    attributedMinutes: candidates.get(code).minutes,
    evidence: candidates.get(code).evidence,
  }));
  if (!reasons.length) {
    reasons = [
      {
        reasonCode: 'UNATTRIBUTED',
        attributedMinutes: delayMinutes,
        evidence: { legIds: [], facilityIds: [], weatherEventIds: [] },
      },
    ];
  }
  // Primary = largest contribution; ties resolved by catalogue order (stable sort).
  const primary = [...reasons].sort((a, b) => b.attributedMinutes - a.attributedMinutes)[0];
  return reasons.map((r) => ({ ...r, isPrimary: r === primary }));
}
