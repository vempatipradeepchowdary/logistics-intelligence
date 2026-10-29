# exports/

Generated deliverables are written here by `npm run export` (default label `latest`):

```
exports/latest/
  carriers.csv  service_levels.csv  facilities.csv  routes.csv
  weather_events.csv  facility_queues.csv
  shipments.csv  shipment_legs.csv  tracking_events.csv
  eta_estimates.csv  delay_reasons.csv  ground_truth.csv
  anomaly_manifest.json     # labelled anomaly cases + expected rules + valid edge-case catalogue
  validation_report.json    # latest validation run (rules, coverage, violations)
  dataset_manifest.json     # seed, config, versions, record counts, checksums, per-file SHA-256
  json/<entity>.json        # npm run export:sql: one JSON array per entity
  sql/schema.sql            # npm run export:sql: 27 tables with primary/foreign keys and bridge tables
  sql/seed.sql              # npm run export:sql: BASELINE rows
  sql/seed_anomalies.sql    # npm run export:sql: labelled ANOMALY rows only
  sql_json_manifest.json    # npm run export:sql: row counts, SHA-256, SQLite verification
exports/reproducibility_report.json   # written by npm run verify:repro
```

`sample/` is committed: the complete set above for the **tiny** profile (600 shipments, 3,600 events,
seed `20261022`), so the data can be inspected without installing anything. It was produced with

```bash
npm run generate -- --profile tiny --reset --db logistics_eta_sample
node src/scripts/validateData.js --db logistics_eta_sample --export-dir exports/sample
npm run export -- --db logistics_eta_sample --label sample
npm run export:sql -- --label sample --verify
```

Everything else is not committed (the full CSV set is ~201 MB, SQL 268 MB, JSON 451 MB). It is fully
deterministic: `npm run generate:full && npm run validate && npm run export` reproduces byte-identical
CSVs for seed `20261022` (verify with the SHA-256 values in `dataset_manifest.json`).
