import { ID_PATTERNS, PARTITIONS } from '../config/constants.js';

// Dataset entities carry no Mongoose auto-timestamps: every stored time is a deterministic
// business time, so two generations with the same seed produce identical documents.
export const datasetSchemaOptions = { versionKey: false, strict: 'throw', id: false };

export const businessId = (pattern, description) => ({
  type: String,
  required: true,
  immutable: true,
  match: pattern,
  description,
});

export const ref = (pattern, description, { required = true } = {}) => ({
  type: String,
  required,
  match: pattern,
  description,
  default: required ? undefined : null,
});

export const partitionField = {
  type: String,
  enum: PARTITIONS,
  required: true,
  description: 'BASELINE = clean generated data; ANOMALY = explicitly labelled injected test cases',
};

export const requiredDate = (description) => ({ type: Date, required: true, description });
export const optionalDate = (description) => ({ type: Date, default: null, description });
export const intMinutes = (description, { min, required = true } = {}) => ({
  type: Number,
  required,
  min,
  validate: { validator: Number.isInteger, message: '{PATH} must be an integer number of minutes' },
  description,
});

export { ID_PATTERNS };
