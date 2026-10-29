import mongoose from 'mongoose';
import { JOB_STATUSES, JOB_TYPES } from '../config/constants.js';

// Persistent job model for long-running generation / validation / export work.
// `activeLock` is present only while a job is QUEUED/RUNNING; its partial unique index
// guarantees at most one active data job at a time (bounded concurrency without a broker).
const jobSchema = new mongoose.Schema(
  {
    jobId: { type: String, required: true, immutable: true },
    type: { type: String, enum: JOB_TYPES, required: true },
    status: { type: String, enum: JOB_STATUSES, required: true },
    params: { type: mongoose.Schema.Types.Mixed, default: {} },
    progress: {
      phase: { type: String, default: null },
      processed: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      percent: { type: Number, default: 0 },
      message: { type: String, default: null },
    },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    error: {
      type: new mongoose.Schema({ code: String, message: String }, { _id: false }),
      default: null,
    },
    activeLock: { type: String },
    pid: { type: Number, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    heartbeatAt: { type: Date, default: null },
  },
  { versionKey: false, timestamps: true, collection: 'jobs' },
);

jobSchema.index({ jobId: 1 }, { unique: true });
jobSchema.index(
  { activeLock: 1 },
  { unique: true, partialFilterExpression: { activeLock: { $exists: true } } },
);
jobSchema.index({ type: 1, createdAt: -1 });

export const Job = mongoose.model('Job', jobSchema);
