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
exports/reproducibility_report.json   # written by npm run verify:repro
```

The generated files are not committed (the full CSV/JSON set is ~201 MB). They are fully deterministic:
`npm run generate:full && npm run validate && npm run export` reproduces byte-identical CSVs for
seed `20261022` (verify with the SHA-256 values in `dataset_manifest.json`).
