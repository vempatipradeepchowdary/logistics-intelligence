import { hasOpenException } from '../domain/lifecycle.js';
import { legTransitPlan, plannedDwellMinutes } from '../domain/network.js';
import { computePlannedPickupAt, computePromisedDeliveryAt } from '../domain/sla.js';
import { attributeDelay, classifyShipment } from '../services/delay.service.js';
import { evaluateEta } from '../services/eta.service.js';
import { canonicalJson } from '../utils/hash.js';
import { MINUTE, toMs } from '../utils/time.js';

const iso = (v) => (v === null || v === undefined ? null : new Date(v).toISOString());
const msOrNull = (v) => (v ? toMs(v) : null);

/** Derived-value arithmetic and label reconciliation for one shipment's records. */
export function checkShipmentReconciliation(
  collector,
  { shipment: s, legs, events, etas, groundTruth, delays },
  ref,
) {
  const sid = s.shipmentId;
  const sl = ref.serviceLevelsById.get(s.serviceLevelId);

  if (sl) {
    const promised = computePromisedDeliveryAt(s.createdAt, sl, s.distanceZone);
    const pickup = computePlannedPickupAt(s.createdAt, sl);
    collector.check(
      'SLA_DEADLINE_RECONCILIATION',
      promised === toMs(s.promisedDeliveryAt) && pickup === toMs(s.plannedPickupAt),
      () => ({
        entityType: 'Shipment',
        recordId: sid,
        shipmentId: sid,
        expected: `promisedDeliveryAt=${iso(promised)} plannedPickupAt=${iso(pickup)}`,
        actual: `promisedDeliveryAt=${iso(s.promisedDeliveryAt)} plannedPickupAt=${iso(s.plannedPickupAt)}`,
      }),
    );
  }

  // Leg arithmetic: actual = planned + queue + weather + carrier, planned values from the route.
  for (const leg of legs) {
    if (leg.status !== 'COMPLETED' || !sl) continue;
    const routeLeg = ref.routesById.get(leg.routeId)?.legs[leg.routeLegSequence - 1];
    const origin = routeLeg ? ref.facilitiesById.get(routeLeg.fromFacilityId) : null;
    const b = leg.delayBreakdown;
    const problems = [];
    if (!b) problems.push('completed leg without delayBreakdown');
    else {
      const dwell = Math.round((toMs(leg.actualDepartureAt) - toMs(leg.actualStartAt)) / MINUTE);
      const transit = Math.round(
        (toMs(leg.actualArrivalAt) - toMs(leg.actualDepartureAt)) / MINUTE,
      );
      if (dwell !== leg.actualDwellMinutes)
        problems.push(`actualDwellMinutes ${leg.actualDwellMinutes} != ${dwell}`);
      if (transit !== leg.actualTransitMinutes)
        problems.push(`actualTransitMinutes ${leg.actualTransitMinutes} != ${transit}`);
      const lhs = leg.actualDwellMinutes + leg.actualTransitMinutes;
      const rhs =
        leg.plannedDwellMinutes +
        leg.plannedTransitMinutes +
        b.queueMinutes +
        b.weatherMinutes +
        b.carrierMinutes;
      if (lhs !== rhs) problems.push(`actual ${lhs} != planned + delays ${rhs}`);
    }
    if (routeLeg && origin) {
      if (legTransitPlan(routeLeg, sl).minutes !== leg.plannedTransitMinutes)
        problems.push('plannedTransitMinutes != route plan');
      if (plannedDwellMinutes(origin, sl) !== leg.plannedDwellMinutes)
        problems.push('plannedDwellMinutes != facility plan');
    }
    collector.check('LEG_DURATION_RECONCILIATION', problems.length === 0, () => ({
      entityType: 'ShipmentLeg',
      recordId: leg.legId,
      shipmentId: sid,
      expected: 'actual dwell + transit = planned dwell + transit + queue + weather + carrier',
      actual: problems.join('; '),
    }));
  }

  // Ground truth existence and delivery consistency.
  collector.check(
    'GROUND_TRUTH_DELIVERY_CONSISTENCY',
    Boolean(groundTruth) &&
      (!s.deliveredAt || msOrNull(groundTruth.actualDeliveredAt) === toMs(s.deliveredAt)),
    () => ({
      entityType: 'GroundTruth',
      recordId: groundTruth?.groundTruthId ?? sid,
      shipmentId: sid,
      expected: groundTruth
        ? `actualDeliveredAt = observed deliveredAt ${iso(s.deliveredAt)}`
        : 'a ground-truth record',
      actual: groundTruth ? `actualDeliveredAt=${iso(groundTruth.actualDeliveredAt)}` : 'missing',
    }),
  );
  if (!groundTruth || !sl) return;

  // Label recomputation from the documented rules.
  const etaAtAsOf = etas.find((e) => toMs(e.predictionAt) === ref.asOfMs) ?? null;
  const open = hasOpenException(events);
  const pickupScan = events.some((e) => e.eventType === 'PICKED_UP');
  const expected = classifyShipment({
    actualDeliveredAt: groundTruth.actualDeliveredAt,
    promisedDeliveryAt: s.promisedDeliveryAt,
    asOf: ref.asOfMs,
    createdAt: s.createdAt,
    hasOpenException: open,
    hasPickupScan: pickupScan,
    etaAtAsOf: etaAtAsOf?.estimatedArrivalAt ?? null,
    atRiskBufferMinutes: sl.atRiskBufferMinutes,
  });
  const labelProblems = [];
  if (expected.delayClass !== groundTruth.delayClass)
    labelProblems.push(`delayClass ${groundTruth.delayClass} != ${expected.delayClass}`);
  if (expected.deliveryOutcome !== groundTruth.deliveryOutcome)
    labelProblems.push('deliveryOutcome differs');
  if (expected.delayMinutes !== groundTruth.delayMinutes)
    labelProblems.push(`delayMinutes ${groundTruth.delayMinutes} != ${expected.delayMinutes}`);
  if (toMs(groundTruth.promisedDeliveryAt) !== toMs(s.promisedDeliveryAt))
    labelProblems.push('promisedDeliveryAt differs from shipment');
  if (groundTruth.hasOpenException !== open || groundTruth.hasPickupScan !== pickupScan)
    labelProblems.push('evidence flags differ from events');
  if ((groundTruth.etaAtAsOfId ?? null) !== (etaAtAsOf?.etaId ?? null))
    labelProblems.push('etaAtAsOfId differs');
  collector.check('GROUND_TRUTH_LABEL_RECONCILIATION', labelProblems.length === 0, () => ({
    entityType: 'GroundTruth',
    recordId: groundTruth.groundTruthId,
    shipmentId: sid,
    expected: `${expected.delayClass} (${expected.rationale})`,
    actual: labelProblems.join('; '),
  }));

  // Delay attribution recomputation.
  let expectedReasons = [];
  if (groundTruth.delayClass === 'DELAYED') {
    expectedReasons = attributeDelay({
      shipment: s,
      legs,
      events,
      delayMinutes: groundTruth.delayMinutes,
      delivered: groundTruth.deliveryOutcome === 'DELIVERED',
      asOf: ref.asOfMs,
    });
  }
  const norm = (list) =>
    canonicalJson(
      list
        .map((r) => ({
          reasonCode: r.reasonCode,
          minutes: r.attributedMinutes,
          isPrimary: r.isPrimary,
        }))
        .sort((x, y) => (x.reasonCode < y.reasonCode ? -1 : 1)),
    );
  const primary = expectedReasons.find((r) => r.isPrimary)?.reasonCode ?? null;
  const delayOk =
    norm(expectedReasons) === norm(delays) &&
    (groundTruth.primaryReasonCode ?? null) === primary &&
    delays.every((d) => d.shipmentDelayMinutes === groundTruth.delayMinutes);
  collector.check('DELAY_RECORD_RECONCILIATION', delayOk, () => ({
    entityType: 'DelayReason',
    recordId: delays[0]?.delayId ?? groundTruth.groundTruthId,
    shipmentId: sid,
    expected: norm(expectedReasons),
    actual: `${norm(delays)} primaryReasonCode=${groundTruth.primaryReasonCode}`,
  }));

  // ETA evaluation arithmetic against ground truth.
  for (const eta of etas) {
    const expectedEval = evaluateEta(
      eta.estimatedArrivalAt,
      eta.predictionAt,
      groundTruth.actualDeliveredAt,
    );
    collector.check(
      'ETA_EVALUATION_RECONCILIATION',
      canonicalJson(expectedEval) === canonicalJson(eta.evaluation),
      () => ({
        entityType: 'ETAEstimate',
        recordId: eta.etaId,
        shipmentId: sid,
        expected: canonicalJson(expectedEval),
        actual: canonicalJson(eta.evaluation),
      }),
    );
  }
}
