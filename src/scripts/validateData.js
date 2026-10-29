#!/usr/bin/env node
// Standalone validation (no Express server needed).
// Usage: node src/scripts/validateData.js [--report exports/latest/validation_report.json] [--export-dir exports/latest] [--db name]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { runValidation } from '../services/validation.service.js';
import { runCli } from './cli.js';

await runCli(
  {
    report: { type: 'string' },
    'export-dir': { type: 'string' },
  },
  async (args) => {
    const exportDir = path.resolve(args['export-dir'] ?? path.join(env.EXPORT_DIR, 'latest'));
    const run = await runValidation({
      exportDir,
      onProgress: ({ phase, message }) => console.log(`[validate] ${phase}: ${message}`),
    });
    console.log(
      `\nValidation ${run.runId}: ${run.status} (${(run.durationMs / 1000).toFixed(1)}s)`,
    );
    const {
      recordsCheckedByEntity: _byEntity,
      unexpectedViolationSample,
      ...summary
    } = run.summary;
    console.table(summary);
    console.table(
      run.rules
        .filter((r) => r.checked > 0)
        .map(({ ruleId, severity, checked, passed, failed, intentional, unexpected }) => ({
          ruleId,
          severity,
          checked,
          passed,
          failed,
          intentional,
          unexpected,
        })),
    );
    const missed = run.anomalyCoverage.filter((c) => !c.detected);
    console.log(
      `Anomaly coverage: ${run.anomalyCoverage.length - missed.length}/${run.anomalyCoverage.length} detected`,
    );
    for (const m of missed)
      console.log(`  MISSED ${m.anomalyId} ${m.variant}: missing ${m.missingRuleIds.join(', ')}`);
    if (unexpectedViolationSample.length)
      console.log('Unexpected sample:', unexpectedViolationSample);
    if (args.report) {
      const file = path.resolve(args.report);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(run, null, 2));
      console.log(`Report written to ${file}`);
    }
    return run.status === 'PASS' ? 0 : 2;
  },
);
