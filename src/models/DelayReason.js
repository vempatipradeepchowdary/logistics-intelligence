import mongoose from 'mongoose';
import { DELAY_REASON_CODES } from '../config/constants.js';
import {
  businessId,
  datasetSchemaOptions,
  ID_PATTERNS,
  intMinutes,
  partitionField,
  ref,
} from './common.js';

const evidenceSchema = new mongoose.Schema(
  {
    legIds: [{ type: String, match: ID_PATTERNS.legId }],
    facilityIds: [{ type: String, match: ID_PATTERNS.facilityId }],
    weatherEventIds: [{ type: String, match: ID_PATTERNS.weatherEventId }],
  },
  { _id: false, strict: 'throw' },
);

// One record per (delayed shipment, contributing reason). Exactly one is primary per shipment.
const delayReasonSchema = new mongoose.Schema(
  {
    delayId: businessId(ID_PATTERNS.delayId, 'Delay attribution ID (DLY-2026-000001)'),
    shipmentId: ref(ID_PATTERNS.shipmentId, 'Delayed shipment'),
    partition: partitionField,
    reasonCode: { type: String, enum: DELAY_REASON_CODES, required: true },
    attributedMinutes: intMinutes('Minutes of delay attributed to this reason', { min: 0 }),
    shipmentDelayMinutes: intMinutes('Total lateness versus the SLA deadline', { min: 1 }),
    isPrimary: { type: Boolean, required: true },
    evidence: { type: evidenceSchema, required: true },
    ruleVersion: { type: String, required: true },
  },
  { ...datasetSchemaOptions, collection: 'delay_reasons' },
);

delayReasonSchema.index({ delayId: 1 }, { unique: true });
delayReasonSchema.index({ shipmentId: 1, reasonCode: 1 }, { unique: true });
delayReasonSchema.index({ reasonCode: 1, isPrimary: 1 });

export const DelayReason = mongoose.model('DelayReason', delayReasonSchema);
