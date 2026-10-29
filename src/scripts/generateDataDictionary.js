#!/usr/bin/env node
// Generates docs/DATA_DICTIONARY.md directly from the Mongoose schemas (no database needed),
// so the documented fields, types, enums, formats and indexes cannot drift from the code.
import { writeFileSync } from 'node:fs';
import { DATASET_ENTITIES } from '../models/index.js';
import { EXPORT_COLUMNS } from '../services/export.service.js';

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');

function describePath(type) {
  const opts = type.options ?? {};
  let kind = type.instance;
  if (kind === 'Array') {
    const inner = type.caster?.instance ?? (type.schema ? 'Object' : 'Mixed');
    kind = `Array<${inner}>`;
  }
  if (kind === 'Embedded') kind = 'Object';
  const constraints = [];
  const enumValues = (type.enumValues ?? []).filter((v) => v !== null);
  if (enumValues.length) constraints.push(`enum: ${enumValues.join(', ')}`);
  if (opts.match) constraints.push(`format: \`${opts.match.source}\``);
  if (opts.min !== undefined) constraints.push(`min ${opts.min}`);
  if (opts.max !== undefined) constraints.push(`max ${opts.max}`);
  if (opts.immutable) constraints.push('immutable');
  if (opts.default === null) constraints.push('nullable');
  return {
    kind,
    required: Boolean(type.isRequired),
    constraints: constraints.join('; '),
    description: opts.description ?? '',
  };
}

function rows(schema, prefix = '') {
  const out = [];
  schema.eachPath((path, type) => {
    if (path === '_id') return;
    out.push({ path: `${prefix}${path}`, ...describePath(type) });
    if (type.schema && (type.instance === 'Embedded' || type.instance === 'Array')) {
      out.push(...rows(type.schema, `${prefix}${path}${type.instance === 'Array' ? '[]' : ''}.`));
    }
  });
  return out;
}

const lines = [
  '# Data Dictionary',
  '',
  '> Generated from the Mongoose schemas by `npm run docs:dictionary`. Do not edit by hand.',
  '',
  'All timestamps are stored as BSON dates in UTC and exported as ISO-8601 (`YYYY-MM-DDTHH:mm:ss.sssZ`).',
  'Duration fields are integer minutes. `partition` separates clean BASELINE data from labelled ANOMALY cases.',
  '',
];
for (const { name, entity, model, idField } of DATASET_ENTITIES) {
  lines.push(`## ${entity} (\`${name}\`)`, '');
  lines.push(
    `Business key: \`${idField}\`${EXPORT_COLUMNS[name] ? ` - export: \`exports/<label>/${name}.csv\`` : ' - export: `anomaly_manifest.json`'}`,
    '',
  );
  lines.push('| Field | Type | Required | Constraints | Description |', '|---|---|---|---|---|');
  for (const r of rows(model.schema)) {
    lines.push(
      `| \`${r.path}\` | ${esc(r.kind)} | ${r.required ? 'yes' : 'no'} | ${esc(r.constraints)} | ${esc(r.description)} |`,
    );
  }
  lines.push('', '**Indexes**', '');
  for (const [keys, options] of model.schema.indexes()) {
    const flags = [
      options.unique ? 'unique' : null,
      options.partialFilterExpression ? 'partial' : null,
    ].filter(Boolean);
    lines.push(`- \`${JSON.stringify(keys)}\`${flags.length ? ` (${flags.join(', ')})` : ''}`);
  }
  lines.push('');
}

const target = new URL('../../docs/DATA_DICTIONARY.md', import.meta.url);
writeFileSync(target, `${lines.join('\n')}\n`);
console.log(`Wrote ${target.pathname} (${DATASET_ENTITIES.length} entities)`);
