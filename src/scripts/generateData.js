#!/usr/bin/env node
// Usage: node src/scripts/generateData.js --profile full --reset [--seed 20261022] [--batch-size 1000] [--resume] [--db name]
import { env } from '../config/env.js';
import { resolveGenerationConfig } from '../config/generation.js';
import { runGeneration } from '../services/generation.service.js';
import { runCli } from './cli.js';

await runCli(
  {
    profile: { type: 'string' },
    seed: { type: 'string' },
    'batch-size': { type: 'string' },
    reset: { type: 'boolean', default: false },
    resume: { type: 'boolean', default: false },
  },
  async (args) => {
    const config = resolveGenerationConfig({
      profile: args.profile ?? env.GENERATION_PROFILE,
      seed: args.seed !== undefined ? Number(args.seed) : env.GENERATION_SEED,
      batchSize: args['batch-size'] !== undefined ? Number(args['batch-size']) : env.BATCH_SIZE,
    });
    console.log(
      `Generating profile=${config.profile} seed=${config.seed} shipments=${config.shipments} events=${config.trackingEvents}`,
    );
    let lastPrinted = 0;
    const started = Date.now();
    const manifest = await runGeneration({
      config,
      reset: args.reset,
      resume: args.resume,
      onProgress: ({ phase, processed, total, message }) => {
        const now = Date.now();
        if (now - lastPrinted < 2000 && processed !== total) return;
        lastPrinted = now;
        const pct = total ? ` (${Math.round((processed / total) * 100)}%)` : '';
        console.log(`[${((now - started) / 1000).toFixed(1)}s] ${phase}: ${message ?? ''}${pct}`);
      },
    });
    console.log('\nRecord counts:');
    console.table(manifest.recordCounts);
    console.log('Target verification:');
    console.table(manifest.targetCounts);
    console.log(`Calibration: ${JSON.stringify(manifest.calibration)}`);
    console.log(`Dataset checksum: ${manifest.datasetChecksum}`);
    console.log(
      `Manifest: ${manifest.manifestId}  (${((Date.now() - started) / 1000).toFixed(1)}s)`,
    );
    return 0;
  },
);
