import mongoose from 'mongoose';
import { DELAY_CLASSES, DELAY_REASON_CODES, DELIVERY_OUTCOMES } from '../config/constants.js';
import {
  businessId,
  datasetSchemaOptions,
  ID_PATTERNS,
  optionalDate,
  partitionField,
  ref,
  requiredDate,
} from './common.js';

// Evaluation labels, stored apart from every prediction input. The ETA engine never reads this.
const groundTruthSchema = new mongoose.Schema(
  {
    groundTruthId: businessId(ID_PATTERNS.groundTruthId, 'GT-<shipmentId>'),
    shipmentId: ref(ID_PATTERNS.shipmentId, 'Labelled shipment'),
    partition: partitionField,
    deliveryOutcome: { type: String, enum: DELIVERY_OUTCOMES, required: true },
    delayClass: { type: String, enum: DELAY_CLASSES, required: true },
    actualDeliveredAt: optionalDate('Physical delivery time (simulation truth) if <= asOf'),
    promisedDeliveryAt: requiredDate('SLA deadline'),
    delayMinutes: { type: Number, required: true, min: 0 },
    primaryReasonCode: { type: String, enum: [...DELAY_REASON_CODES, null], default: null },
    hasOpenException: { type: Boolean, required: true },
    hasPickupScan: { type: Boolean, required: true },
    etaAtAsOfId: { type: String, default: null, match: ID_PATTERNS.etaId },
    etaAtAsOf: optionalDate('ETA estimate at asOf, used for AT_RISK / ON_TRACK'),
    asOf: requiredDate('Label snapshot time'),
    labelRuleVersion: { type: String, required: true },
    rationale: { type: String, required: true },
  },
  { ...datasetSchemaOptions, collection: 'ground_truth' },
);

groundTruthSchema.index({ groundTruthId: 1 }, { unique: true });
groundTruthSchema.index({ shipmentId: 1 }, { unique: true });
groundTruthSchema.index({ partition: 1, delayClass: 1 });

export const GroundTruth = mongoose.model('GroundTruth', groundTruthSchema);
