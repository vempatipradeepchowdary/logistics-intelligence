import { compareEvents, deriveStatus } from '../domain/lifecycle.js';
import { toMs } from '../utils/time.js';

const iso = (v) => (v ? new Date(v).toISOString() : null);
const sameTime = (a, b) => (a ? toMs(a) : null) === (b ? toMs(b) : null);

export function checkShipmentLifecycle(collector, { shipment: s, events }) {
  const sid = s.shipmentId;
  const sorted = [...events].sort(compareEvents);

  // Duplicates: same type, facility and occurrence time under different event IDs.
  const seen = new Map();
  for (const e of sorted) {
    const key = `${e.eventType}|${e.facilityId}|${toMs(e.occurredAt)}`;
    const original = seen.get(key);
    collector.check('EVENT_DUPLICATE', !original, () => ({
      entityType: 'TrackingEvent',
      recordId: e.eventId,
      shipmentId: sid,
      expected: 'unique (type, facility, occurredAt)',
      actual: `duplicates ${original} (${e.eventType} at ${e.facilityId} ${iso(e.occurredAt)})`,
    }));
    if (!original) seen.set(key, e.eventId);
  }

  // State machine replay.
  const derived = deriveStatus(sorted);
  const illegalIds = new Set(derived.illegal.map((i) => i.event.eventId));
  for (const e of sorted) {
    const bad = derived.illegal.find((i) => i.event.eventId === e.eventId);
    collector.check('LIFECYCLE_ILLEGAL_TRANSITION', !illegalIds.has(e.eventId), () => ({
      entityType: 'TrackingEvent',
      recordId: e.eventId,
      shipmentId: sid,
      expected: 'legal transition per the shipment state machine',
      actual: `${bad.from} -> ${bad.to ?? '?'} via ${e.eventType} at ${iso(e.occurredAt)}`,
    }));
  }

  // Recorded status vs. event-derived status.
  const deliveredEvent = sorted.find(
    (e) => e.eventType === 'DELIVERED' && !illegalIds.has(e.eventId),
  );
  const expectedDeliveredAt = deliveredEvent?.occurredAt ?? null;
  collector.check(
    'SHIPMENT_STATUS_EVENT_MISMATCH',
    derived.status === s.status && sameTime(expectedDeliveredAt, s.deliveredAt),
    () => ({
      entityType: 'Shipment',
      recordId: sid,
      shipmentId: sid,
      expected: `status=${derived.status}, deliveredAt=${iso(expectedDeliveredAt)}`,
      actual: `status=${s.status}, deliveredAt=${iso(s.deliveredAt)}`,
    }),
  );

  // Other milestone fields.
  const pickup = sorted.find((e) => e.eventType === 'PICKED_UP');
  const reroute = sorted.find((e) => e.eventType === 'ROUTE_CHANGED');
  const problems = [];
  if (!sameTime(pickup?.occurredAt ?? null, s.pickedUpAt))
    problems.push(`pickedUpAt ${iso(s.pickedUpAt)} != PICKED_UP ${iso(pickup?.occurredAt)}`);
  if (!sameTime(derived.statusUpdatedAt, s.statusUpdatedAt))
    problems.push(`statusUpdatedAt ${iso(s.statusUpdatedAt)} != ${iso(derived.statusUpdatedAt)}`);
  const rerouted = s.currentRouteId !== s.plannedRouteId;
  if (rerouted !== Boolean(s.routeChange))
    problems.push('routeChange record inconsistent with currentRouteId');
  if (rerouted && reroute?.routeChange?.toRouteId !== s.currentRouteId)
    problems.push('no ROUTE_CHANGED event to currentRouteId');
  if (!rerouted && reroute)
    problems.push('ROUTE_CHANGED event but currentRouteId == plannedRouteId');
  collector.check('SHIPMENT_MILESTONE_RECONCILIATION', problems.length === 0, () => ({
    entityType: 'Shipment',
    recordId: sid,
    shipmentId: sid,
    expected: 'milestone fields derived from events',
    actual: problems.join('; '),
  }));
}
