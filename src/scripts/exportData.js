#!/usr/bin/env node
// Usage: node src/scripts/exportData.js [--label latest] [--db name]
import { runExport } from '../services/export.service.js';
import { runCli } from './cli.js';

await runCli({ label: { type: 'string' } }, async (args) => {
  const result = await runExport({
    label: args.label ?? 'latest',
    onProgress: ({ message }) => console.log(`[export] ${message}`),
  });
  console.log(`\nExported to ${result.directory}`);
  console.table(
    result.files.map(({ file, rows, bytes, sha256 }) => ({
      file,
      rows,
      bytes,
      sha256: sha256?.slice(0, 16),
    })),
  );
  return 0;
});
