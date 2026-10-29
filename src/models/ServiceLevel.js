import mongoose from 'mongoose';
import { TRANSPORT_MODES } from '../config/constants.js';
import { businessId, datasetSchemaOptions, ID_PATTERNS, intMinutes } from './common.js';

const zoneDays = { type: Number, required: true, min: 1, max: 14, validate: Number.isInteger };

const serviceLevelSchema = new mongoose.Schema(
  {
    serviceLevelId: businessId(ID_PATTERNS.serviceLevelId, 'Service level ID (SL-EXPRESS)'),
    name: { type: String, required: true },
    transportMode: {
      type: String,
      enum: TRANSPORT_MODES,
      required: true,
      description: 'Linehaul mode for long hub-to-hub legs',
    },
    transitDaysByZone: {
      type: new mongoose.Schema(
        { Z1: zoneDays, Z2: zoneDays, Z3: zoneDays, Z4: zoneDays },
        { _id: false, strict: 'throw' },
      ),
      required: true,
      description: 'Committed calendar transit days per distance zone',
    },
    pickupCutoffMinuteUtc: intMinutes(
      'Tender cutoff (minute of UTC day); later tenders start next day',
      {
        min: 0,
      },
    ),
    deadlineMinuteUtc: intMinutes(
      'Minute of UTC day by which delivery is promised on the due day',
      {
        min: 0,
      },
    ),
    handlingFactor: { type: Number, required: true, min: 0.1, max: 3 },
    atRiskBufferMinutes: intMinutes('ETA within this buffer of the deadline counts as at-risk', {
      min: 0,
    }),
    priority: { type: Number, required: true, min: 1, max: 10 },
    mixWeight: { type: Number, required: true, min: 0 },
  },
  { ...datasetSchemaOptions, collection: 'service_levels' },
);

serviceLevelSchema.index({ serviceLevelId: 1 }, { unique: true });

export const ServiceLevel = mongoose.model('ServiceLevel', serviceLevelSchema);
