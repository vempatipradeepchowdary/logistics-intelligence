import { groundTruthId } from '../utils/idGenerator.js';
import { toMs } from '../utils/time.js';
import { hasOpenException } from '../domain/lifecycle.js';
import {
  attributeDelay,
  classifyShipment,
  DELAY_RULE_VERSION,
  LABEL_RULE_VERSION,
} from '../services/delay.service.js';

/**
 * Ground truth for one shipment, from source records only:
 * physical delivery time (simulation truth, if it happened by asOf), the SLA deadline,
 * observed events (exception / pickup), and the ETA snapshot taken at asOf.
 */
export function buildGroundTruth({
  shipment,
  events,
  etaDocs,
  actualDeliveredAt,
  serviceLevel,
  asOf,
  partition,
}) {
  const etaAtAsOf = etaDocs.find((e) => toMs(e.predictionAt) === toMs(asOf)) ?? null;
  const classification = classifyShipment({
    actualDeliveredAt,
    promisedDeliveryAt: shipment.promisedDeliveryAt,
    asOf,
    createdAt: shipment.createdAt,
    hasOpenException: hasOpenException(events),
    hasPickupScan: events.some((e) => e.eventType === 'PICKED_UP'),
    etaAtAsOf: etaAtAsOf?.estimatedArrivalAt ?? null,
    atRiskBufferMinutes: serviceLevel.atRiskBufferMinutes,
  });
  return {
    groundTruthId: groundTruthId(shipment.shipmentId),
    shipmentId: shipment.shipmentId,
    partition,
    deliveryOutcome: classification.deliveryOutcome,
    delayClass: classification.delayClass,
    actualDeliveredAt: actualDeliveredAt ? new Date(toMs(actualDeliveredAt)) : null,
    promisedDeliveryAt: new Date(toMs(shipment.promisedDeliveryAt)),
    delayMinutes: classification.delayMinutes,
    primaryReasonCode: null,
    hasOpenException: hasOpenException(events),
    hasPickupScan: events.some((e) => e.eventType === 'PICKED_UP'),
    etaAtAsOfId: etaAtAsOf?.etaId ?? null,
    etaAtAsOf: etaAtAsOf ? new Date(toMs(etaAtAsOf.estimatedArrivalAt)) : null,
    asOf: new Date(toMs(asOf)),
    labelRuleVersion: LABEL_RULE_VERSION,
    rationale: classification.rationale,
  };
}

/** Delay attribution records for a DELAYED shipment (empty otherwise). Mutates gt.primaryReasonCode. */
export function buildDelayRecords({
  groundTruth,
  shipment,
  legs,
  events,
  asOf,
  partition,
  nextDelayId,
}) {
  if (groundTruth.delayClass !== 'DELAYED') return [];
  const reasons = attributeDelay({
    shipment,
    legs,
    events,
    delayMinutes: groundTruth.delayMinutes,
    delivered: groundTruth.deliveryOutcome === 'DELIVERED',
    asOf,
  });
  groundTruth.primaryReasonCode = reasons.find((r) => r.isPrimary).reasonCode;
  return reasons.map((r) => ({
    delayId: nextDelayId(),
    shipmentId: shipment.shipmentId,
    partition,
    reasonCode: r.reasonCode,
    attributedMinutes: r.attributedMinutes,
    shipmentDelayMinutes: groundTruth.delayMinutes,
    isPrimary: r.isPrimary,
    evidence: r.evidence,
    ruleVersion: DELAY_RULE_VERSION,
  }));
}
