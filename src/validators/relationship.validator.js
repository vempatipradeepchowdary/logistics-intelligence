import { compareEvents } from '../domain/lifecycle.js';
import { distanceZone } from '../domain/sla.js';
import { effectivePath, plannedGroundMinutes } from '../domain/network.js';
import { toMs } from '../utils/time.js';

const refViolation = (entityType, recordId, shipmentId, field, value, target) => ({
  entityType,
  recordId,
  shipmentId,
  expected: `${field} references an existing ${target}`,
  actual: `${field}=${value} not found`,
});

/** Reference/master-data checks for small collections (loaded fully in memory by the caller). */
export function validateMasterData(collector, ref) {
  const { facilitiesById, serviceLevelsById, carriers, routes, weatherEvents, facilities } = ref;

  for (const f of facilities) {
    const parent = f.parentHubId ? facilitiesById.get(f.parentHubId) : null;
    const ok = f.type === 'HUB' ? f.parentHubId === null : Boolean(parent) && parent.type === 'HUB';
    collector.check('FACILITY_HIERARCHY', ok, () => ({
      recordId: f.facilityId,
      expected: f.type === 'HUB' ? 'parentHubId null' : 'parentHubId references a HUB',
      actual: `parentHubId=${f.parentHubId}`,
    }));
  }

  for (const c of carriers) {
    for (const sl of c.supportedServiceLevelIds) {
      collector.check('REF_INTEGRITY', serviceLevelsById.has(sl), () =>
        refViolation('Carrier', c.carrierId, null, 'supportedServiceLevelIds', sl, 'ServiceLevel'),
      );
    }
  }

  const routesById = new Map(routes.map((r) => [r.routeId, r]));
  for (const r of routes) {
    const problems = [];
    for (const s of r.stops)
      if (!facilitiesById.has(s.facilityId)) problems.push(`stop ${s.facilityId} unknown`);
    r.legs.forEach((leg, i) => {
      if (
        leg.fromFacilityId !== r.stops[i]?.facilityId ||
        leg.toFacilityId !== r.stops[i + 1]?.facilityId
      ) {
        problems.push(`leg ${leg.sequence} does not connect stops ${i}->${i + 1}`);
      }
      if (leg.plannedGroundMinutes !== plannedGroundMinutes(leg.distanceKm)) {
        problems.push(`leg ${leg.sequence} planned ground minutes do not match distance`);
      }
    });
    if (r.legs.length !== r.stops.length - 1) problems.push('leg count != stops - 1');
    if (r.originFacilityId !== r.stops[0]?.facilityId) problems.push('origin != first stop');
    if (r.destinationFacilityId !== r.stops.at(-1)?.facilityId)
      problems.push('destination != last stop');
    const total = r.legs.reduce((s, l) => s + l.distanceKm, 0);
    if (total !== r.totalDistanceKm)
      problems.push(`totalDistanceKm ${r.totalDistanceKm} != sum ${total}`);
    if (distanceZone(r.totalDistanceKm) !== r.distanceZone) problems.push('distanceZone mismatch');
    if (r.routeType === 'ALTERNATE' && routesById.get(r.primaryRouteId)?.routeType !== 'PRIMARY') {
      problems.push(`primaryRouteId ${r.primaryRouteId} is not a PRIMARY route`);
    }
    collector.check('ROUTE_STRUCTURE', problems.length === 0, () => ({
      recordId: r.routeId,
      expected: 'consistent stops, legs, distances and zone',
      actual: problems.join('; '),
    }));
  }

  for (const w of weatherEvents) {
    for (const fid of [w.centerFacilityId, ...w.affectedFacilityIds]) {
      collector.check('REF_INTEGRITY', facilitiesById.has(fid), () =>
        refViolation(
          'WeatherEvent',
          w.weatherEventId,
          null,
          'affectedFacilityIds',
          fid,
          'Facility',
        ),
      );
    }
    const start = toMs(w.startAt);
    const issued = toMs(w.issuedAt);
    const ok =
      start < toMs(w.endAt) &&
      issued <= toMs(w.ingestedAt) &&
      (w.advisoryType === 'FORECAST' ? issued < start : issued >= start);
    collector.check('WEATHER_WINDOW_VALID', ok, () => ({
      recordId: w.weatherEventId,
      expected:
        'startAt < endAt, issuedAt <= ingestedAt, FORECAST issued before start / NOWCAST after',
      actual: `start=${w.startAt.toISOString()} end=${w.endAt.toISOString()} issued=${w.issuedAt.toISOString()} type=${w.advisoryType}`,
    }));
  }
}

/** Streamed check for facility queue observations. */
export function checkQueueObservation(collector, obs, ref) {
  const facility = ref.facilitiesById.get(obs.facilityId);
  collector.check('REF_INTEGRITY', Boolean(facility), () =>
    refViolation(
      'FacilityQueue',
      obs.queueObservationId,
      null,
      'facilityId',
      obs.facilityId,
      'Facility',
    ),
  );
  const ok =
    toMs(obs.observedAt) <= toMs(obs.ingestedAt) &&
    toMs(obs.ingestedAt) <= ref.asOfMs &&
    obs.estimatedWaitMinutes >= obs.baselineWaitMinutes &&
    (!facility || facility.baselineQueueWaitMinutes === obs.baselineWaitMinutes);
  collector.check('QUEUE_OBSERVATION_VALID', ok, () => ({
    recordId: obs.queueObservationId,
    expected: 'observedAt <= ingestedAt <= asOf, wait >= baseline, baseline = facility baseline',
    actual: `observed=${obs.observedAt.toISOString()} ingested=${obs.ingestedAt.toISOString()} wait=${obs.estimatedWaitMinutes} baseline=${obs.baselineWaitMinutes}`,
  }));
}

/** Per-shipment reference, route and leg-structure checks. */
export function checkShipmentRelationships(collector, { shipment: s, legs, events }, ref) {
  const sid = s.shipmentId;
  const refs = [
    ['carrierId', ref.carriersById, 'Carrier'],
    ['serviceLevelId', ref.serviceLevelsById, 'ServiceLevel'],
    ['originFacilityId', ref.facilitiesById, 'Facility'],
    ['destinationFacilityId', ref.facilitiesById, 'Facility'],
    ['plannedRouteId', ref.routesById, 'Route'],
    ['currentRouteId', ref.routesById, 'Route'],
  ];
  for (const [field, map, target] of refs) {
    collector.check('REF_INTEGRITY', map.has(s[field]), () =>
      refViolation('Shipment', sid, sid, field, s[field], target),
    );
  }

  const planned = ref.routesById.get(s.plannedRouteId);
  const current = ref.routesById.get(s.currentRouteId);
  if (planned && current) {
    const ok =
      planned.routeType === 'PRIMARY' &&
      planned.originFacilityId === s.originFacilityId &&
      planned.destinationFacilityId === s.destinationFacilityId &&
      current.originFacilityId === s.originFacilityId &&
      current.destinationFacilityId === s.destinationFacilityId &&
      planned.distanceZone === s.distanceZone;
    collector.check('SHIPMENT_ROUTE_CONSISTENCY', ok, () => ({
      entityType: 'Shipment',
      recordId: sid,
      shipmentId: sid,
      expected: `routes connect ${s.originFacilityId} -> ${s.destinationFacilityId}, zone ${planned.distanceZone}`,
      actual: `planned ${planned.originFacilityId}->${planned.destinationFacilityId} (${planned.routeType}), current ${current.originFacilityId}->${current.destinationFacilityId}, zone ${s.distanceZone}`,
    }));
  }

  // ---- Legs ----
  const legIds = new Set(legs.map((l) => l.legId));
  const seqs = legs.map((l) => l.sequence).sort((a, b) => a - b);
  collector.check('LEG_SEQUENCE', legs.length > 0 && seqs.every((q, i) => q === i + 1), () => ({
    entityType: 'ShipmentLeg',
    recordId: legs[0]?.legId ?? sid,
    shipmentId: sid,
    expected: 'leg sequences 1..n',
    actual: `sequences [${seqs.join(',')}]`,
  }));
  for (const leg of legs) {
    collector.check('REF_INTEGRITY', ref.routesById.has(leg.routeId), () =>
      refViolation('ShipmentLeg', leg.legId, sid, 'routeId', leg.routeId, 'Route'),
    );
    for (const field of ['fromFacilityId', 'toFacilityId']) {
      collector.check('REF_INTEGRITY', ref.facilitiesById.has(leg[field]), () =>
        refViolation('ShipmentLeg', leg.legId, sid, field, leg[field], 'Facility'),
      );
    }
  }
  const active = legs
    .filter((l) => l.status !== 'CANCELLED')
    .sort((a, b) => a.sequence - b.sequence);
  const chainProblems = [];
  if (active[0]?.fromFacilityId !== s.originFacilityId)
    chainProblems.push('first active leg does not start at origin');
  if (active.at(-1)?.toFacilityId !== s.destinationFacilityId)
    chainProblems.push('last active leg does not end at destination');
  for (let i = 1; i < active.length; i += 1) {
    if (active[i].fromFacilityId !== active[i - 1].toFacilityId) {
      chainProblems.push(
        `${active[i].legId} starts at ${active[i].fromFacilityId} but previous leg ended at ${active[i - 1].toFacilityId}`,
      );
    }
  }
  for (const leg of legs) {
    const routeLeg = ref.routesById.get(leg.routeId)?.legs[leg.routeLegSequence - 1];
    if (
      routeLeg &&
      (routeLeg.fromFacilityId !== leg.fromFacilityId || routeLeg.toFacilityId !== leg.toFacilityId)
    ) {
      chainProblems.push(`${leg.legId} does not match ${leg.routeId} leg ${leg.routeLegSequence}`);
    }
  }
  collector.check('LEG_CHAIN_CONTINUITY', chainProblems.length === 0, () => ({
    entityType: 'ShipmentLeg',
    recordId:
      active.find((l, i) => i > 0 && l.fromFacilityId !== active[i - 1].toFacilityId)?.legId ??
      legs[0]?.legId ??
      sid,
    shipmentId: sid,
    expected: 'active legs form a continuous chain origin -> destination matching their route legs',
    actual: chainProblems.join('; '),
  }));

  // ---- Events: references and route order ----
  const path = planned ? effectivePath(planned, current ?? planned) : [];
  for (const e of events) {
    collector.check('REF_INTEGRITY', ref.facilitiesById.has(e.facilityId), () =>
      refViolation('TrackingEvent', e.eventId, sid, 'facilityId', e.facilityId, 'Facility'),
    );
    collector.check('REF_INTEGRITY', legIds.has(e.legId), () =>
      refViolation(
        'TrackingEvent',
        e.eventId,
        sid,
        'legId',
        e.legId,
        'ShipmentLeg of the same shipment',
      ),
    );
    if (planned) {
      collector.check('ROUTE_FACILITY_NOT_ON_ROUTE', path.includes(e.facilityId), () => ({
        entityType: 'TrackingEvent',
        recordId: e.eventId,
        shipmentId: sid,
        expected: `facility on path [${path.join(' > ')}]`,
        actual: `${e.eventType} at ${e.facilityId}`,
      }));
    }
  }
  if (!planned) return;
  let maxIdx = 0;
  for (const e of [...events].sort(compareEvents)) {
    const idx = path.indexOf(e.facilityId);
    if (idx < 0) continue;
    let problem = null;
    if (e.eventType === 'PICKED_UP' && idx !== 0) problem = 'pickup not at the origin station';
    else if (
      ['OUT_FOR_DELIVERY', 'DELIVERY_ATTEMPTED', 'DELIVERED'].includes(e.eventType) &&
      idx !== path.length - 1
    ) {
      problem = 'last-mile event not at the destination station';
    } else if (idx < maxIdx)
      problem = `moves back from stop ${maxIdx} (${path[maxIdx]}) to stop ${idx}`;
    collector.check('ROUTE_SEQUENCE_VIOLATION', problem === null, () => ({
      entityType: 'TrackingEvent',
      recordId: e.eventId,
      shipmentId: sid,
      expected: 'non-decreasing position along the route',
      actual: `${e.eventType} at ${e.facilityId} (${e.occurredAt.toISOString()}): ${problem}`,
    }));
    maxIdx = Math.max(maxIdx, idx);
  }
}
