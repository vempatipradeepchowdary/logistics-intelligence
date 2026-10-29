import mongoose from 'mongoose';
import { ANOMALY_SCENARIOS } from '../config/constants.js';
import { businessId, datasetSchemaOptions, ID_PATTERNS } from './common.js';

const affectedRecordSchema = new mongoose.Schema(
  {
    entityType: { type: String, required: true },
    recordId: { type: String, required: true },
    field: { type: String, default: null },
  },
  { _id: false, strict: 'throw' },
);

// Explicit label for each intentionally injected anomaly and the validation outcome expected.
const anomalyCaseSchema = new mongoose.Schema(
  {
    anomalyId: businessId(ID_PATTERNS.anomalyId, 'ANM-2026-0001'),
    scenario: { type: String, enum: ANOMALY_SCENARIOS, required: true },
    variant: { type: String, required: true },
    shipmentId: { type: String, required: true, match: ID_PATTERNS.shipmentId },
    affectedRecords: [affectedRecordSchema],
    description: { type: String, required: true },
    expectedRuleIds: {
      type: [String],
      validate: { validator: (v) => v.length > 0, message: 'expectedRuleIds required' },
    },
    expectedOutcome: { type: String, enum: ['DETECTED'], required: true },
  },
  { ...datasetSchemaOptions, collection: 'anomaly_cases' },
);

anomalyCaseSchema.index({ anomalyId: 1 }, { unique: true });
anomalyCaseSchema.index({ shipmentId: 1 });

export const AnomalyCase = mongoose.model('AnomalyCase', anomalyCaseSchema);
