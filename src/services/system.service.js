import { env } from '../config/env.js';
import { GENERATION_PROFILES, GENERATOR_VERSION } from '../config/generation.js';
import { DatasetManifest } from '../models/index.js';
import { ETA_CONFIG } from './eta.service.js';
import { LATE_INGESTION_THRESHOLD_MINUTES } from '../validators/temporal.validator.js';
import { RULES } from '../validators/rules.js';
import { SOFTWARE_VERSION } from '../utils/version.js';

/** Non-sensitive configuration for the UI. No credentials, URIs or secrets are included. */
export async function getSystemConfig() {
  const manifest = await DatasetManifest.findOne({}, { _id: 0, checkpoint: 0, config: 0 })
    .sort({ createdAt: -1 })
    .lean();
  return {
    version: SOFTWARE_VERSION,
    environment: env.NODE_ENV,
    generator: {
      version: GENERATOR_VERSION,
      defaultSeed: env.GENERATION_SEED,
      defaultProfile: env.GENERATION_PROFILE,
      defaultBatchSize: env.BATCH_SIZE,
      profiles: GENERATION_PROFILES,
      constraints: {
        facilities: 'fixed at 100 (network model)',
        eventsPerShipmentRatio: [5.2, 6.8],
        maxShipments: 899999,
      },
      behaviour:
        'Generation with reset=true REPLACES the current dataset; resume continues an interrupted run with the same configuration.',
    },
    eta: { algorithmVersion: ETA_CONFIG.algorithmVersion, parameters: ETA_CONFIG },
    validation: {
      rules: RULES.length,
      lateIngestionThresholdMinutes: LATE_INGESTION_THRESHOLD_MINUTES,
    },
    api: {
      maxPageSize: 200,
      defaultPageSize: 25,
      rateLimitPerMinute: env.RATE_LIMIT_MAX,
      adminRateLimitPerMinute: env.ADMIN_RATE_LIMIT_MAX,
    },
    latestManifest: manifest,
  };
}
