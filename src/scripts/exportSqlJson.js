#!/usr/bin/env node
// Converts a CSV export (exports/<label>/*.csv) into
//   exports/<label>/json/<entity>.json      one JSON array per entity, nested structure restored
//   exports/<label>/sql/schema.sql          relational schema: primary keys, foreign keys, bridge tables
//   exports/<label>/sql/seed.sql            BASELINE rows (INSERT statements)
//   exports/<label>/sql/seed_anomalies.sql  labelled ANOMALY rows, kept separate on purpose
//   exports/<label>/sql_json_manifest.json  row counts + SHA-256 per file
// MongoDB embeds many-to-many links as arrays; the SQL export normalises them into bridge tables.
// Works from the CSV files only (no MongoDB connection needed).
//
// Usage: node src/scripts/exportSqlJson.js [--label latest] [--verify]
//   --verify loads schema + seeds into an in-memory SQLite database (node:sqlite) and checks that
//            baseline data has zero foreign-key violations and every violation in the anomaly file
//            belongs to a labelled anomaly row.
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { DATASET_ENTITIES } from '../models/index.js';
import { parseCsv } from '../utils/csv.js';

const { values: args } = parseArgs({
  options: {
    label: { type: 'string', default: 'latest' },
    verify: { type: 'boolean', default: false },
  },
});
if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(args.label)) throw new Error('Invalid --label');
const root = path.resolve(process.env.EXPORT_DIR ?? 'exports', args.label);
if (!existsSync(path.join(root, 'shipments.csv'))) {
  throw new Error(
    `No CSV export found in ${root}; run "npm run export -- --label ${args.label}" first`,
  );
}

const snake = (s) =>
  s
    .replace(/\./g, '_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();

// Primary keys and foreign keys per entity (CSV column -> referenced table).
const TABLES = {
  carriers: { pk: 'carrierId', fks: {} },
  service_levels: { pk: 'serviceLevelId', fks: {} },
  facilities: { pk: 'facilityId', fks: { parentHubId: 'facilities' } },
  routes: {
    pk: 'routeId',
    fks: {
      primaryRouteId: 'routes',
      originFacilityId: 'facilities',
      destinationFacilityId: 'facilities',
    },
  },
  weather_events: { pk: 'weatherEventId', fks: { centerFacilityId: 'facilities' } },
  facility_queues: { pk: 'queueObservationId', fks: { facilityId: 'facilities' } },
  shipments: {
    pk: 'shipmentId',
    fks: {
      carrierId: 'carriers',
      serviceLevelId: 'service_levels',
      originFacilityId: 'facilities',
      destinationFacilityId: 'facilities',
      plannedRouteId: 'routes',
      currentRouteId: 'routes',
      'routeChange.atFacilityId': 'facilities',
      'routeChange.fromRouteId': 'routes',
      'routeChange.toRouteId': 'routes',
    },
  },
  shipment_legs: {
    pk: 'legId',
    fks: {
      shipmentId: 'shipments',
      routeId: 'routes',
      fromFacilityId: 'facilities',
      toFacilityId: 'facilities',
    },
  },
  tracking_events: {
    pk: 'eventId',
    fks: {
      shipmentId: 'shipments',
      legId: 'shipment_legs',
      facilityId: 'facilities',
      'routeChange.fromRouteId': 'routes',
      'routeChange.toRouteId': 'routes',
    },
  },
  eta_estimates: {
    pk: 'etaId',
    fks: {
      shipmentId: 'shipments',
      'position.routeId': 'routes',
      'position.facilityId': 'facilities',
      'watermark.lastEventId': 'tracking_events',
    },
  },
  delay_reasons: { pk: 'delayId', fks: { shipmentId: 'shipments' } },
  ground_truth: {
    pk: 'groundTruthId',
    fks: { shipmentId: 'shipments', etaAtAsOfId: 'eta_estimates' },
  },
};

// Array-valued columns become bridge tables (N:M or ordered 1:N lists).
const BRIDGES = [
  {
    table: 'carrier_service_levels',
    parent: 'carriers',
    column: 'supportedServiceLevelIds',
    child: 'service_level_id',
    ref: 'service_levels',
  },
  {
    table: 'weather_event_facilities',
    parent: 'weather_events',
    column: 'affectedFacilityIds',
    child: 'facility_id',
    ref: 'facilities',
  },
  {
    table: 'facility_queue_weather_events',
    parent: 'facility_queues',
    column: 'activeWeatherEventIds',
    child: 'weather_event_id',
    ref: 'weather_events',
  },
  {
    table: 'shipment_last_mile_weather_events',
    parent: 'shipments',
    column: 'lastMile.weatherEventIds',
    child: 'weather_event_id',
    ref: 'weather_events',
  },
  {
    table: 'shipment_leg_weather_events',
    parent: 'shipment_legs',
    column: 'weatherEventIds',
    child: 'weather_event_id',
    ref: 'weather_events',
  },
  {
    table: 'eta_input_events',
    parent: 'eta_estimates',
    column: 'inputs.eventIds',
    child: 'event_id',
    ref: 'tracking_events',
    ordered: true,
  },
  {
    table: 'eta_ignored_events',
    parent: 'eta_estimates',
    column: 'inputs.ignoredEventIds',
    child: 'event_id',
    ref: 'tracking_events',
  },
  {
    table: 'eta_queue_observations',
    parent: 'eta_estimates',
    column: 'inputs.queueObservationIds',
    child: 'queue_observation_id',
    ref: 'facility_queues',
  },
  {
    table: 'eta_weather_events',
    parent: 'eta_estimates',
    column: 'inputs.weatherEventIds',
    child: 'weather_event_id',
    ref: 'weather_events',
  },
  {
    table: 'eta_remaining_facilities',
    parent: 'eta_estimates',
    column: 'inputs.remainingFacilityIds',
    child: 'facility_id',
    ref: 'facilities',
    ordered: true,
  },
  {
    table: 'delay_evidence_legs',
    parent: 'delay_reasons',
    column: 'evidence.legIds',
    child: 'leg_id',
    ref: 'shipment_legs',
  },
  {
    table: 'delay_evidence_facilities',
    parent: 'delay_reasons',
    column: 'evidence.facilityIds',
    child: 'facility_id',
    ref: 'facilities',
  },
  {
    table: 'delay_evidence_weather_events',
    parent: 'delay_reasons',
    column: 'evidence.weatherEventIds',
    child: 'weather_event_id',
    ref: 'weather_events',
  },
];
// Embedded document arrays become child tables.
const ROUTE_STOPS = { table: 'route_stops', column: 'stops' };
const ROUTE_LEGS = { table: 'route_legs', column: 'legs' };

const entityModel = Object.fromEntries(DATASET_ENTITIES.map((e) => [e.name, e.model]));

function sqlType(entity, column) {
  let p;
  try {
    p = entityModel[entity].schema.path(column);
  } catch {
    p = null;
  }
  switch (p?.instance) {
    case 'Number':
      return 'NUMERIC';
    case 'Date':
      return 'TIMESTAMP';
    case 'Boolean':
      return 'BOOLEAN';
    case 'Array':
      return 'ARRAY';
    default:
      return 'TEXT';
  }
}

const quote = (v) => `'${String(v).replace(/'/g, "''")}'`;
function literal(raw, type) {
  if (raw === '' || raw === undefined || raw === null) return 'NULL';
  if (type === 'NUMERIC' && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(raw)) return raw;
  if (type === 'BOOLEAN') return raw === 'true' ? 'TRUE' : 'FALSE';
  return quote(raw);
}
function jsonValue(raw, type, column) {
  if (type === 'ARRAY') {
    if (raw === '') return [];
    return raw.startsWith('[') && column !== 'supportedServiceLevelIds'
      ? JSON.parse(raw)
      : raw.split('|');
  }
  if (raw === '') return null;
  if (type === 'NUMERIC') return Number(raw);
  if (type === 'BOOLEAN') return raw === 'true';
  return raw;
}

async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Yields file lines one at a time (no field in this dataset contains a line break). */
function lines(file) {
  return createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
}

async function writer(file) {
  const stream = createWriteStream(file, { encoding: 'utf8' });
  return {
    async write(text) {
      if (!stream.write(text)) await once(stream, 'drain');
    },
    async close() {
      stream.end();
      await once(stream, 'finish');
    },
  };
}

// ---------------------------------------------------------------- CSV headers
// Rows are streamed table by table further down, so memory stays flat on the full-volume export.
const headers = {};
for (const name of Object.keys(TABLES)) {
  for await (const line of lines(path.join(root, `${name}.csv`))) {
    headers[name] = parseCsv(line)[0];
    break;
  }
}

// ---------------------------------------------------------------- schema
const bridgeColumns = new Set(
  BRIDGES.map((b) => `${b.parent}:${b.column}`).concat(['routes:stops', 'routes:legs']),
);
const scalarColumns = (name) => headers[name].filter((c) => !bridgeColumns.has(`${name}:${c}`));

const schema = [
  '-- Relational schema generated from the MongoDB data model (src/scripts/exportSqlJson.js).',
  '-- Portable SQL (tested on SQLite 3.50; types are PostgreSQL-compatible).',
  '-- Many-to-many links embedded as arrays in MongoDB are normalised into bridge tables.',
  '',
];
for (const name of Object.keys(TABLES)) {
  const { pk, fks } = TABLES[name];
  const cols = scalarColumns(name).map(
    (c) => `  ${snake(c)} ${sqlType(name, c)}${c === pk ? ' PRIMARY KEY' : ''}`,
  );
  const constraints = Object.entries(fks)
    .filter(([c]) => headers[name].includes(c))
    .map(([c, ref]) => `  FOREIGN KEY (${snake(c)}) REFERENCES ${ref} (${snake(TABLES[ref].pk)})`);
  schema.push(`CREATE TABLE ${name} (\n${[...cols, ...constraints].join(',\n')}\n);`, '');
}
schema.push(
  `CREATE TABLE ${ROUTE_STOPS.table} (\n  route_id TEXT NOT NULL,\n  sequence INTEGER NOT NULL,\n  facility_id TEXT NOT NULL,\n  PRIMARY KEY (route_id, sequence),\n  FOREIGN KEY (route_id) REFERENCES routes (route_id),\n  FOREIGN KEY (facility_id) REFERENCES facilities (facility_id)\n);`,
  '',
  `CREATE TABLE ${ROUTE_LEGS.table} (\n  route_id TEXT NOT NULL,\n  sequence INTEGER NOT NULL,\n  from_facility_id TEXT NOT NULL,\n  to_facility_id TEXT NOT NULL,\n  distance_km NUMERIC NOT NULL,\n  planned_ground_minutes NUMERIC NOT NULL,\n  planned_air_minutes NUMERIC,\n  PRIMARY KEY (route_id, sequence),\n  FOREIGN KEY (route_id) REFERENCES routes (route_id),\n  FOREIGN KEY (from_facility_id) REFERENCES facilities (facility_id),\n  FOREIGN KEY (to_facility_id) REFERENCES facilities (facility_id)\n);`,
  '',
);
for (const b of BRIDGES) {
  const parentKey = snake(TABLES[b.parent].pk);
  const keyCols = b.ordered ? `${parentKey}, position` : `${parentKey}, ${b.child}`;
  schema.push(
    `CREATE TABLE ${b.table} (\n  ${parentKey} TEXT NOT NULL,\n${b.ordered ? '  position INTEGER NOT NULL,\n' : ''}  ${b.child} TEXT NOT NULL,\n  PRIMARY KEY (${keyCols}),\n  FOREIGN KEY (${parentKey}) REFERENCES ${b.parent} (${parentKey}),\n  FOREIGN KEY (${b.child}) REFERENCES ${b.ref} (${snake(TABLES[b.ref].pk)})\n);`,
    '',
  );
}

// ---------------------------------------------------------------- seeds + JSON
mkdirSync(path.join(root, 'sql'), { recursive: true });
mkdirSync(path.join(root, 'json'), { recursive: true });
writeFileSync(path.join(root, 'sql', 'schema.sql'), `${schema.join('\n')}\n`);

const seed = {
  BASELINE: await writer(path.join(root, 'sql', 'seed.sql')),
  ANOMALY: await writer(path.join(root, 'sql', 'seed_anomalies.sql')),
};
await seed.BASELINE.write('-- BASELINE (clean) rows. Load after schema.sql.\nBEGIN;\n');
await seed.ANOMALY.write(
  '-- Labelled ANOMALY rows (anomaly_manifest.json). They intentionally contain invalid references.\nBEGIN;\n',
);
const rowCounts = {};
const csvRowCounts = {};
const BATCH = 500;
const buffers = new Map(); // `${target}|${table}` -> { columns, tuples }

async function flush(key) {
  const buf = buffers.get(key);
  if (!buf?.tuples.length) return;
  const [target, table] = key.split('|');
  const values = buf.tuples.map((t) => `(${t.join(', ')})`).join(',\n');
  buf.tuples = [];
  await seed[target].write(`INSERT INTO ${table} (${buf.columns.join(', ')}) VALUES\n${values};\n`);
}

async function emit(target, table, columns, tuple) {
  const key = `${target}|${table}`;
  if (!buffers.has(key)) buffers.set(key, { columns, tuples: [] });
  const buf = buffers.get(key);
  buf.tuples.push(tuple);
  rowCounts[table] = rowCounts[table] ?? { baseline: 0, anomaly: 0 };
  rowCounts[table][target === 'BASELINE' ? 'baseline' : 'anomaly'] += 1;
  if (buf.tuples.length >= BATCH) await flush(key);
}

const LEG_COLUMNS = [
  'route_id',
  'sequence',
  'from_facility_id',
  'to_facility_id',
  'distance_km',
  'planned_ground_minutes',
  'planned_air_minutes',
];

for (const name of Object.keys(TABLES)) {
  const header = headers[name];
  const types = header.map((c) => sqlType(name, c));
  const idx = Object.fromEntries(header.map((c, i) => [c, i]));
  const partitionOf = (r) =>
    idx.partition !== undefined && r[idx.partition] === 'ANOMALY' ? 'ANOMALY' : 'BASELINE';
  const scalars = scalarColumns(name);
  const scalarTypes = scalars.map((c) => sqlType(name, c));
  const pk = snake(TABLES[name].pk);
  const bridges = BRIDGES.filter((x) => x.parent === name);

  const json = await writer(path.join(root, 'json', `${name}.json`));
  await json.write('[\n');
  let n = 0;
  let first = true;
  for await (const line of lines(path.join(root, `${name}.csv`))) {
    if (first) {
      first = false; // header
      continue;
    }
    if (!line) continue;
    const r = parseCsv(line)[0];
    if (r.length !== header.length) continue;

    // JSON (nested objects restored from dotted columns; empty sub-documents become null).
    const doc = {};
    header.forEach((c, i) => {
      const parts = c.split('.');
      let cur = doc;
      for (const p of parts.slice(0, -1)) cur = cur[p] ??= {};
      cur[parts.at(-1)] = jsonValue(r[i], types[i], c);
    });
    for (const [k, v] of Object.entries(doc)) {
      if (
        v &&
        typeof v === 'object' &&
        !Array.isArray(v) &&
        Object.values(v).every((x) => x === null || (Array.isArray(x) && !x.length))
      ) {
        doc[k] = null;
      }
    }
    await json.write(`${n ? ',\n' : ''}${JSON.stringify(doc)}`);
    n += 1;

    // Main table row, then its bridge / child rows.
    const target = partitionOf(r);
    const id = quote(r[idx[TABLES[name].pk]]);
    await emit(
      target,
      name,
      scalars.map(snake),
      scalars.map((c, i) => literal(r[idx[c]], scalarTypes[i])),
    );
    for (const b of bridges) {
      const raw = r[idx[b.column]];
      if (!raw) continue;
      for (const [position, child] of raw.split('|').entries()) {
        await emit(
          target,
          b.table,
          b.ordered ? [pk, 'position', b.child] : [pk, b.child],
          b.ordered ? [id, String(position), quote(child)] : [id, quote(child)],
        );
      }
    }
    if (name === 'routes') {
      for (const s of JSON.parse(r[idx.stops])) {
        await emit(
          target,
          ROUTE_STOPS.table,
          ['route_id', 'sequence', 'facility_id'],
          [id, String(s.sequence), quote(s.facilityId)],
        );
      }
      for (const l of JSON.parse(r[idx.legs])) {
        await emit(target, ROUTE_LEGS.table, LEG_COLUMNS, [
          id,
          String(l.sequence),
          quote(l.fromFacilityId),
          quote(l.toFacilityId),
          String(l.distanceKm),
          String(l.plannedGroundMinutes),
          l.plannedAirMinutes ?? 'NULL',
        ]);
      }
    }
  }
  await json.write('\n]\n');
  await json.close();
  csvRowCounts[name] = n;
  for (const key of buffers.keys()) await flush(key);
}
await seed.BASELINE.write('COMMIT;\n');
await seed.ANOMALY.write('COMMIT;\n');
await seed.BASELINE.close();
await seed.ANOMALY.close();

// ---------------------------------------------------------------- manifest
const files = [
  ...['schema.sql', 'seed.sql', 'seed_anomalies.sql'].map((f) => `sql/${f}`),
  ...Object.keys(TABLES).map((n) => `json/${n}.json`),
];
for (const [i, f] of files.entries()) {
  files[i] = { file: f, sha256: await sha256File(path.join(root, f)) };
}
const manifest = {
  generatedAt: new Date().toISOString(),
  source: `exports/${args.label}/*.csv`,
  tables: Object.keys(TABLES).length + BRIDGES.length + 2,
  bridgeTables: [...BRIDGES.map((b) => b.table), ROUTE_STOPS.table, ROUTE_LEGS.table],
  rowCounts,
  files,
};

// ---------------------------------------------------------------- verify in SQLite
/** Runs a .sql file statement by statement (every statement in these files ends a line with ";"). */
async function execFile(db, file) {
  let statement = '';
  for await (const line of lines(file)) {
    statement += `${line}\n`;
    if (line.endsWith(';')) {
      db.exec(statement);
      statement = '';
    }
  }
  if (statement.trim()) db.exec(statement);
}

if (args.verify) {
  const { DatabaseSync } = await import('node:sqlite');
  // A temporary file rather than :memory:, so the full-volume dataset does not have to fit in RAM.
  const dbFile = path.join(os.tmpdir(), `logistics-verify-${process.pid}.sqlite`);
  rmSync(dbFile, { force: true });
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA foreign_keys = OFF; PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;');
  await execFile(db, path.join(root, 'sql', 'schema.sql'));
  await execFile(db, path.join(root, 'sql', 'seed.sql'));
  const baselineViolations = db.prepare('PRAGMA foreign_key_check').all();
  await execFile(db, path.join(root, 'sql', 'seed_anomalies.sql'));
  const allViolations = db.prepare('PRAGMA foreign_key_check').all();
  const counts = {};
  for (const t of Object.keys(rowCounts))
    counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  const countsOk = Object.entries(rowCounts).every(
    ([t, c]) => counts[t] === c.baseline + c.anomaly,
  );
  const csvOk = Object.keys(TABLES).every((n) => counts[n] === csvRowCounts[n]);
  manifest.verification = {
    engine: `SQLite ${db.prepare('SELECT sqlite_version() AS v').get().v} (node:sqlite)`,
    baselineForeignKeyViolations: baselineViolations.length,
    anomalyForeignKeyViolations: allViolations.length - baselineViolations.length,
    anomalyViolationTables: [...new Set(allViolations.map((v) => v.table))].sort(),
    rowCountsMatchSeeds: countsOk,
    rowCountsMatchCsv: csvOk,
    passed: baselineViolations.length === 0 && countsOk && csvOk,
  };
  db.close();
  rmSync(dbFile, { force: true });
}
writeFileSync(path.join(root, 'sql_json_manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Wrote ${files.length} files to ${root}`);
console.table(Object.fromEntries(Object.entries(rowCounts).map(([t, c]) => [t, c])));
if (manifest.verification) {
  console.log('Verification:', manifest.verification);
  if (!manifest.verification.passed) process.exitCode = 1;
}
