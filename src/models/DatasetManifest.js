import mongoose from 'mongoose';

// Provenance of a generation run: seed, config, versions, counts, checksums, resume checkpoint.
const datasetManifestSchema = new mongoose.Schema(
  {
    manifestId: { type: String, required: true, immutable: true },
    status: { type: String, enum: ['IN_PROGRESS', 'COMPLETED', 'FAILED'], required: true },
    seed: { type: Number, required: true },
    profile: { type: String, required: true },
    config: { type: mongoose.Schema.Types.Mixed, required: true },
    configHash: { type: String, required: true },
    softwareVersion: { type: String, required: true },
    generatorVersion: { type: String, required: true },
    etaAlgorithmVersion: { type: String, required: true },
    etaConfigHash: { type: String, required: true },
    environment: { type: mongoose.Schema.Types.Mixed, default: {} },
    simulationWindow: { type: mongoose.Schema.Types.Mixed, required: true },
    generationStartedAt: { type: Date, required: true },
    generationCompletedAt: { type: Date, default: null },
    checkpoint: { type: mongoose.Schema.Types.Mixed, default: {} },
    calibration: { type: mongoose.Schema.Types.Mixed, default: null },
    recordCounts: { type: mongoose.Schema.Types.Mixed, default: null },
    targetCounts: { type: mongoose.Schema.Types.Mixed, default: null },
    checksums: { type: mongoose.Schema.Types.Mixed, default: null },
    datasetChecksum: { type: String, default: null },
    edgeCaseCatalog: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
  },
  { versionKey: false, timestamps: true, collection: 'dataset_manifests' },
);

datasetManifestSchema.index({ manifestId: 1 }, { unique: true });
datasetManifestSchema.index({ createdAt: -1 });

export const DatasetManifest = mongoose.model('DatasetManifest', datasetManifestSchema);
