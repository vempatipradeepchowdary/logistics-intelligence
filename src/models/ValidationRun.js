import mongoose from 'mongoose';

const validationRunSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, immutable: true },
    status: { type: String, enum: ['PASS', 'FAIL'], required: true },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, required: true },
    durationMs: { type: Number, required: true },
    datasetManifestId: { type: String, default: null },
    summary: { type: mongoose.Schema.Types.Mixed, required: true },
    rules: { type: [mongoose.Schema.Types.Mixed], default: [] },
    anomalyCoverage: { type: [mongoose.Schema.Types.Mixed], default: [] },
    violations: { type: [mongoose.Schema.Types.Mixed], default: [] },
    violationsTruncated: { type: Boolean, default: false },
  },
  { versionKey: false, timestamps: true, collection: 'validation_runs' },
);

validationRunSchema.index({ runId: 1 }, { unique: true });
validationRunSchema.index({ finishedAt: -1 });

export const ValidationRun = mongoose.model('ValidationRun', validationRunSchema);
