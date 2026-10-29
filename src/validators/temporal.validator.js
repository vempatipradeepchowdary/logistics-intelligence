import { compareEvents, hasOpenException } from '../domain/lifecycle.js';
import { plannedRemainingMinutes } from '../domain/network.js';
import { HOUR, MINUTE, toMs } from '../utils/time.js';

/** Late-arriving event policy threshold: events ingested > 6h after occurrence are flagged. */
export const LATE_INGESTION_THRESHOLD_MINUTES = 360;
export const STALLED_MIN_HOURS = 120;

const iso = (v) => (v ? new Date(v).toISOString() : null);

export function checkShipmentTemporal(collector, { shipment: s, legs, events }, ref) {
  const sid = s.shipmentId;
  const created = toMs(s.createdAt);
  const asOf = ref.asOfMs;

  for (const e of events) {
    const occurred = toMs(e.occurredAt);
    const ingested = toMs(e.ingestedAt);
    const base = { entityType: 'TrackingEvent', recordId: e.eventId, shipmentId: sid };
    collector.check('TEMPORAL_INGESTED_BEFORE_OCCURRED', ingested >= occurred, () => ({
      ...base,
      expected: 'ingestedAt >= occurredAt',
      actual: `occurredAt=${iso(occurred)} ingestedAt=${iso(ingested)}`,
    }));
    collector.check(
      'TEMPORAL_LATE_INGESTION',
      ingested - occurred <= LATE_INGESTION_THRESHOLD_MINUTES * MINUTE,
      () => ({
        ...base,
        expected: `ingestion lag <= ${LATE_INGESTION_THRESHOLD_MINUTES} min`,
        actual: `lag ${Math.round((ingested - occurred) / MINUTE)} min (occurred ${iso(occurred)}, ingested ${iso(ingested)})`,
        explanation:
          'Late-arriving event: retained with its true occurrence time, excluded from any ETA predicted before its ingestion',
      }),
    );
    collector.check('TEMPORAL_EVENT_BEFORE_CREATION', occurred >= created, () => ({
      ...base,
      expected: `occurredAt >= shipment createdAt ${iso(created)}`,
      actual: `occurredAt=${iso(occurred)}`,
    }));
    collector.check('TEMPORAL_AFTER_SNAPSHOT', occurred <= asOf && ingested <= asOf, () => ({
      ...base,
      expected: `occurredAt and ingestedAt <= snapshot ${iso(asOf)}`,
      actual: `occurredAt=${iso(occurred)} ingestedAt=${iso(ingested)}`,
    }));
  }

  // Shipment milestone ordering.
  const picked = s.pickedUpAt ? toMs(s.pickedUpAt) : null;
  const delivered = s.deliveredAt ? toMs(s.deliveredAt) : null;
  const problems = [];
  if (created >= toMs(s.promisedDeliveryAt)) problems.push('createdAt >= promisedDeliveryAt');
  if (created > asOf) problems.push('createdAt after snapshot');
  if (picked !== null && picked < created) problems.push('pickedUpAt before createdAt');
  if (delivered !== null && picked !== null && delivered < picked)
    problems.push('deliveredAt before pickedUpAt');
  if (delivered !== null && delivered > asOf) problems.push('deliveredAt after snapshot');
  collector.check('TEMPORAL_MILESTONE_ORDER', problems.length === 0, () => ({
    entityType: 'Shipment',
    recordId: sid,
    shipmentId: sid,
    expected: 'createdAt <= pickedUpAt <= deliveredAt <= asOf; createdAt < promisedDeliveryAt',
    actual: `${problems.join('; ')} (created ${iso(created)}, picked ${iso(picked)}, delivered ${iso(delivered)})`,
  }));

  // Leg time ordering and continuity.
  const active = legs
    .filter((l) => l.status !== 'CANCELLED')
    .sort((a, b) => a.sequence - b.sequence);
  for (const [i, leg] of active.entries()) {
    const start = leg.actualStartAt ? toMs(leg.actualStartAt) : null;
    const dep = leg.actualDepartureAt ? toMs(leg.actualDepartureAt) : null;
    const arr = leg.actualArrivalAt ? toMs(leg.actualArrivalAt) : null;
    const prevArr =
      i > 0 && active[i - 1].actualArrivalAt ? toMs(active[i - 1].actualArrivalAt) : null;
    const issues = [];
    if (start !== null && dep !== null && dep < start) issues.push('departure before start');
    if (dep !== null && arr !== null && arr < dep) issues.push('arrival before departure');
    if ((dep !== null && start === null) || (arr !== null && dep === null))
      issues.push('later milestone without earlier one');
    if (prevArr !== null && start !== null && start !== prevArr)
      issues.push('start != previous leg arrival');
    collector.check('LEG_TIME_ORDER', issues.length === 0, () => ({
      entityType: 'ShipmentLeg',
      recordId: leg.legId,
      shipmentId: sid,
      expected: 'start <= departure <= arrival; start = previous leg arrival',
      actual: issues.join('; '),
    }));
  }

  // Stalled tracking (missing-event gap) for undelivered, non-held shipments.
  if (
    events.length &&
    !events.some((e) => e.eventType === 'DELIVERED') &&
    !hasOpenException(events)
  ) {
    const last = [...events].sort(compareEvents).at(-1);
    const silentMs = asOf - toMs(last.occurredAt);
    const route = ref.routesById.get(s.currentRouteId);
    const sl = ref.serviceLevelsById.get(s.serviceLevelId);
    const plannedTotal =
      route && sl ? plannedRemainingMinutes(route, 0, ref.facilitiesById, sl) : 0;
    const limitMs = Math.max(STALLED_MIN_HOURS * HOUR, (2 * plannedTotal + 24 * 60) * MINUTE);
    collector.check('TRACKING_STALLED', silentMs <= limitMs, () => ({
      entityType: 'Shipment',
      recordId: sid,
      shipmentId: sid,
      expected: `a scan within ${Math.round(limitMs / HOUR)}h before the snapshot`,
      actual: `last scan ${last.eventType} at ${iso(last.occurredAt)}, silent for ${Math.round(silentMs / HOUR)}h`,
    }));
  }
}
