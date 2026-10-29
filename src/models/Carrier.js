import mongoose from 'mongoose';
import { CARRIER_MODES } from '../config/constants.js';
import { businessId, datasetSchemaOptions, ID_PATTERNS } from './common.js';

const carrierSchema = new mongoose.Schema(
  {
    carrierId: businessId(ID_PATTERNS.carrierId, 'Carrier business ID (CAR-001)'),
    name: { type: String, required: true, trim: true, maxlength: 120 },
    code: {
      type: String,
      required: true,
      match: /^[A-Z]{4}$/,
      description: 'Four-letter synthetic carrier code',
    },
    mode: { type: String, enum: CARRIER_MODES, required: true },
    supportedServiceLevelIds: {
      type: [{ type: String, match: ID_PATTERNS.serviceLevelId }],
      validate: { validator: (v) => v.length > 0, message: 'carrier must support a service level' },
      description: 'Service levels the carrier is contracted for (refs ServiceLevel)',
    },
    transitTimeFactor: {
      type: Number,
      required: true,
      min: 0.8,
      max: 1.5,
      description:
        'Configured historical multiplier on planned transit time; used by the ETA engine',
    },
    transitVariability: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      description: 'Lognormal sigma of actual transit noise (simulation only, not used for ETA)',
    },
    scanComplianceRate: { type: Number, required: true, min: 0.5, max: 1 },
    ediBatchShare: { type: Number, required: true, min: 0, max: 1 },
    onTimePickupRate: { type: Number, required: true, min: 0, max: 1 },
    marketShareWeight: { type: Number, required: true, min: 0 },
    active: { type: Boolean, required: true },
  },
  { ...datasetSchemaOptions, collection: 'carriers' },
);

carrierSchema.index({ carrierId: 1 }, { unique: true });
carrierSchema.index({ code: 1 }, { unique: true });

export const Carrier = mongoose.model('Carrier', carrierSchema);
