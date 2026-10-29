# YottaFlex Intelligence — Logistics Intelligence & Synthetic Data Engineering Platform

YottaFlex.ai Round 2 challenge · Associate AI Forward Deployed Engineer

*Logistics visibility. Predictive decisions. Operational clarity.*

This repository contains a complete, working logistics data-engineering platform:

* a **MongoDB** database holding a realistic, fully related synthetic logistics dataset
  (**50,000 shipments, 300,000 tracking events, 100 facilities, 1,000 disruption windows**);
* a **Node.js / Express backend** that deterministically generates that dataset, computes
  **leakage-free ETA estimates**, labels delays from documented rules, injects **labelled anomalies**,
  validates everything with a **standalone validation engine**, exports CSV/JSON deliverables and
  serves a REST API;
* a **React + Vite frontend** ("YottaFlex Intelligence") for inspecting, operating and validating the
  data;
* automated **tests** for all three (unit, integration, acceptance, component and end-to-end).

Everything described below was built and run on the development machine; the measured results in
[section 14](#14-measured-results) are real outputs, not estimates.

## Requirements checklist

| Brief requirement | Where it is / how to check it |
|---|---|
| 11 related entities with keys and relationships | `src/models/`, [docs/DATA_DICTIONARY.md](docs/DATA_DICTIONARY.md), cardinality table in [docs/ARCHITECTURE.md §10](docs/ARCHITECTURE.md#10-relational-model-cardinality-bridge-tables-effective-dates-calendars) |
| 50,000 shipments · 300,000 tracking events · 100 facilities · 1,000 disruption windows | `npm run generate:full` → counts in [section 14](#14-measured-results); asserted by `npm run test:full` |
| Realistic lifecycle, timestamps, queues, weather, reroutes | `src/generators/`, `src/domain/` ([section 7](#7-the-dataset-what-gets-generated-and-how)) |
| ETA estimates without future-data leakage | `src/services/eta.service.js`; rule `ETA_FUTURE_DATA_LEAKAGE`; leakage unit tests in `tests/unit/` ([section 8](#8-eta-engine)) |
| Ground truth and delay reasons kept separate from predictions | `ground_truth`, `delay_reasons` collections ([section 9](#9-ground-truth-and-delay-classification)) |
| Labelled anomalies + validation that separates them from real defects | `src/generators/anomaly.generator.js`, `src/validators/`; `npm run validate` → PASS, 0 unexpected, 60/60 detected ([section 10](#10-validation-engine-and-anomaly-scenarios)) |
| CSV / JSON deliverables | `npm run export` → `exports/<label>/` ([section 11](#11-csv--json-exports-and-reproducibility)) |
| SQL export: schema with PK/FK, bridge tables, seeds, separate anomaly seed | `npm run export:sql -- --label <label> --verify` → `sql/schema.sql`, `sql/seed.sql`, `sql/seed_anomalies.sql`, `json/<entity>.json` |
| Data you can inspect without installing anything | [`exports/sample/`](exports/sample/) (see below) |
| Reproducibility (same seed → identical data) | `npm run verify:repro` → `exports/reproducibility_report.json` |
| Cardinality, effective dates, lifecycle states, calendars | [docs/ARCHITECTURE.md §10](docs/ARCHITECTURE.md#10-relational-model-cardinality-bridge-tables-effective-dates-calendars) |
| API + UI | `src/routes/` ([section 12](#12-rest-api)), `frontend/` ([section 13](#13-frontend-yottaflex-intelligence)) |
| Tests | `npm test`, `npm run test:full`, `npm run frontend:test` ([section 15](#15-testing)) |

## See the data without installing anything

[`exports/sample/`](exports/sample/) is a committed, fully validated export of the **tiny** profile
(same seed `20261022`, same code as the full run). Open it straight from GitHub:

| What | Size |
|---|---|
| 12 CSV files (one per entity) | 600 shipments (+28 anomaly), 3,600 events (+183), 100 facilities, 120 disruption windows, 9,326 routes, 12,600 queue observations, 1,600 ETA snapshots (+96) |
| `json/<entity>.json` | the same rows as JSON with nested objects restored |
| `sql/schema.sql` | 27 tables: 12 entities + 13 bridge tables + `route_stops` / `route_legs`, with primary and foreign keys |
| `sql/seed.sql` / `sql/seed_anomalies.sql` | baseline rows, and the 30 labelled anomaly cases kept in a separate file |
| `anomaly_manifest.json` | every injected anomaly with the rule that must catch it |
| `validation_report.json` | **PASS**, 0 unexpected errors, 30/30 anomaly cases detected |
| `dataset_manifest.json`, `sql_json_manifest.json` | seed, config, row counts and SHA-256 of every file; SQLite verification result |

Load it into SQLite (any SQLite ≥ 3.35):

```bash
cd exports/sample/sql
sqlite3 sample.db ".read schema.sql" ".read seed.sql" "PRAGMA foreign_key_check;"   # no output = 0 violations
sqlite3 sample.db ".read seed_anomalies.sql" "PRAGMA foreign_key_check;"            # 8 rows: the intentional bad references
```

Foreign keys are `DEFERRABLE INITIALLY DEFERRED`, so `seed.sql` also loads with enforcement on
(`PRAGMA foreign_keys = ON`, or PostgreSQL). `seed_anomalies.sql` holds the deliberate bad references,
so with enforcement on it is rejected at COMMIT; load it with enforcement off (the `sqlite3` default) to
inspect the anomalies.

The full-volume export is not committed (CSV 201 MB, SQL 268 MB, JSON 451 MB; GitHub rejects files
over 100 MB). It is byte-for-byte reproducible with the commands in [section 4](#4-how-to-run-everything--step-by-step).

---

## Contents

1. [What is in this repository](#1-what-is-in-this-repository)
2. [How everything fits together](#2-how-everything-fits-together)
3. [Prerequisites](#3-prerequisites)
4. [How to run everything — step by step](#4-how-to-run-everything--step-by-step)
5. [Command reference](#5-command-reference)
6. [Configuration (.env)](#6-configuration-env)
7. [The dataset: what gets generated and how](#7-the-dataset-what-gets-generated-and-how)
8. [ETA engine](#8-eta-engine)
9. [Ground truth and delay classification](#9-ground-truth-and-delay-classification)
10. [Validation engine and anomaly scenarios](#10-validation-engine-and-anomaly-scenarios)
11. [CSV / JSON exports and reproducibility](#11-csv--json-exports-and-reproducibility)
12. [REST API](#12-rest-api)
13. [Frontend (YottaFlex Intelligence)](#13-frontend-yottaflex-intelligence)
14. [Measured results](#14-measured-results)
15. [Testing](#15-testing)
16. [Project structure](#16-project-structure)
17. [Troubleshooting](#17-troubleshooting)
18. [Build log: what was done, in order](#18-build-log-what-was-done-in-order)
19. [Limitations and assumptions](#19-limitations-and-assumptions)

---

## 1. What is in this repository

| Part | Technology | Location | What it does |
|---|---|---|---|
| Database | MongoDB 8.0 (works with ≥ 7.0) | your local or remote MongoDB server | stores 13 dataset collections + jobs, validation runs and manifests |
| Backend | Node.js 22, Express 5, Mongoose 8, Zod | `src/` | generation engine, ETA engine, validation engine, exports, REST API, background job worker |
| Frontend | React 18, Vite 6, Tailwind CSS 4, Recharts, React Router, Axios | `frontend/` | 12-section web UI over the API |
| CLI scripts | Node.js | `src/scripts/` | generate, validate, export, verify reproducibility, build data dictionary |
| Tests | Vitest, Supertest, Testing Library, Playwright | `tests/`, `frontend/src/**/*.test.*`, `frontend/e2e/` | 95 backend + 33 frontend + 9 end-to-end tests |
| Docs | Markdown | `README.md` (this file), `docs/ARCHITECTURE.md`, `docs/DATA_DICTIONARY.md`, `frontend/README.md` | design, field-level dictionary (generated from the schemas), frontend details |
| Deliverables | CSV, JSON, SQL | `exports/<label>/` (generated, git-ignored); `exports/sample/` (committed) | 12 CSV files + anomaly manifest + validation report + dataset manifest; per-entity JSON and a relational SQL schema + seeds |

---

## 2. How everything fits together

```
        ┌──────────────────────────────┐
        │  Browser                     │
        │  YottaFlex Intelligence UI   │  React + Vite (frontend/)
        └──────────────┬───────────────┘
                       │  HTTP  /api/*   (same origin; Vite proxies it in development)
        ┌──────────────▼───────────────┐         fork          ┌─────────────────────────┐
        │  Express API  (src/app.js)   │ ────────────────────▶ │ Job worker              │
        │  routes → controllers →      │                       │ src/jobs/worker.js      │
        │  services → models           │ ◀── job status ────── │ generate/validate/export│
        │  also serves frontend/dist   │      (in MongoDB)     └───────────┬─────────────┘
        └──────────────┬───────────────┘                                   │
                       │ Mongoose                                          │
        ┌──────────────▼───────────────────────────────────────────────────▼─┐
        │  MongoDB  database "logistics_eta"                                 │
        │  carriers · service_levels · facilities · routes · weather_events  │
        │  facility_queues · shipments · shipment_legs · tracking_events     │
        │  eta_estimates · delay_reasons · ground_truth · anomaly_cases      │
        │  jobs · validation_runs · dataset_manifests                        │
        └────────────────────────────────────────────────────────────────────┘
                       │ streamed export
                       ▼
                 exports/latest/*.csv, *.json
```

* **One process serves both UI and API in production mode.** After `npm run frontend:build`, the
  Express server serves `frontend/dist` at `http://localhost:3000` and the API at `/api`.
* **Long work never blocks the API.** Generation, validation and export run in a forked worker process;
  progress is written to the `jobs` collection and polled by the UI. Only one data job runs at a time.
* **One set of domain rules.** SLA deadlines, lifecycle transitions, planned durations, the queue model
  and the delivery-wave rule live in `src/domain/` and are shared by the simulator, the ETA engine and
  the validator, so the validator recomputes every derived value with the exact logic that produced it.

Data flow inside the generator:

```
master data → weather disruption windows → facility queue observations → event-count calibration
→ shipments in batches (shipment → legs → tracking events → ETA snapshots → ground truth → delay reasons)
→ labelled anomaly partition → manifest (counts, checksums, edge-case catalogue)
→ validate → export
```

---

## 3. Prerequisites

| Tool | Version | Check with | Notes |
|---|---|---|---|
| Node.js | ≥ 20 (developed on **22.17**) | `node -v` | includes npm |
| npm | ≥ 10 | `npm -v` | |
| MongoDB server | ≥ **7.0** (developed on **8.0**) | see below | `$percentile` is used by the ETA-accuracy analytics |
| Git | any | `git --version` | only to clone |
| Disk | ~1 GB free for the full dataset + ~200 MB for exports | | measured: 95 MB compressed DB storage + 63 MB indexes |
| Browser | Chrome / Edge / Firefox | | for the UI |

### Getting MongoDB running

**Windows (what this project was developed on)** — install *MongoDB Community Server* (MSI) with the
"Install MongoDB as a Service" option. It then starts automatically. Check it in PowerShell:

```powershell
Get-Service MongoDB          # Status should be "Running"
Start-Service MongoDB        # start it if it is stopped (admin PowerShell)
Test-NetConnection 127.0.0.1 -Port 27017   # TcpTestSucceeded : True
```

**macOS (Homebrew)**

```bash
brew tap mongodb/brew && brew install mongodb-community@8.0
brew services start mongodb-community@8.0
```

**Linux** — install `mongodb-org` from the official MongoDB repository, then
`sudo systemctl start mongod`.

**Docker (any OS)**

```bash
docker run -d --name mongo -p 27017:27017 mongo:8
```

**Remote / Atlas** — put the connection string in `MONGODB_URI` in `.env` (never commit credentials).

You do **not** need to create databases or collections by hand: the application creates the database,
collections and all indexes itself.

---

## 4. How to run everything — step by step

Commands are shown for **PowerShell (Windows)**; on macOS/Linux use the same npm commands and `cp`
instead of `Copy-Item`.

### Step 1 — Get the code and install backend dependencies

```powershell
git clone https://github.com/vempatipradeepchowdary/logistics-intelligence.git
cd logistics-intelligence
npm install
```

### Step 2 — Create the backend configuration

```powershell
Copy-Item .env.example .env
```

Open `.env` and set at least:

```ini
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB_NAME=logistics_eta
ADMIN_API_KEY=<any random string of 16+ characters>
```

`ADMIN_API_KEY` protects the admin operations (generate / validate / export). You will paste the same
value into the UI later. All other variables have working defaults ([section 6](#6-configuration-env)).

### Step 3 — Make sure MongoDB is running

See [section 3](#getting-mongodb-running). Nothing else needs preparing.

### Step 4 — Generate the dataset

Pick one:

```powershell
npm run generate:small     # 5,000 shipments / 30,000 events — about 40 seconds (good for a first try)
npm run generate:full      # 50,000 / 300,000 / 100 / 1,000 — the challenge volume, about 4 minutes
```

You will see progress lines, then a record-count table, a **target verification** table (all `ok`),
the event-count calibration and the **dataset checksum**. Both commands use `--reset`, which replaces any
existing dataset.

### Step 5 — Validate the dataset

```powershell
npm run validate
```

Expected ending: `Validation VAL-…: PASS`, a summary table with **unexpectedErrors 0**, a per-rule
table, and `Anomaly coverage: 60/60 detected` (45/45 for the small profile). Exit code is 0 on PASS,
2 on FAIL.

### Step 6 — Export the CSV/JSON deliverables

```powershell
npm run export
```

Writes 12 CSV files and 3 JSON manifests to `exports\latest\`. To make the bundled validation report
include the export cross-check, run this sequence once:

```powershell
npm run validate
npm run export
node src/scripts/validateData.js --report exports/latest/validation_report.json
npm run export
```

### Step 7 — Build the frontend (one time, and after frontend changes)

```powershell
npm run frontend:install
npm run frontend:build
```

This installs the frontend's own dependencies (in `frontend/node_modules`) and builds it to
`frontend/dist`.

### Step 8 — Start the application

```powershell
npm start
```

Open **http://localhost:3000**. The Express server now serves the UI and the API together.
Stop it with **Ctrl + C** (it shuts down gracefully and closes the MongoDB connection).

### Step 9 — Unlock admin features in the UI

Go to **Settings → Admin access**, paste your `ADMIN_API_KEY`, click **Verify & save**. The key is
checked against the backend and kept only for this browser tab. Without it the UI is read-only;
**Dataset Generator**, **Run validation** and **Create export** need it.

### Optional — Frontend development mode (hot reload)

Use two terminals:

```powershell
# terminal 1 — backend API on :3000
npm start

# terminal 2 — Vite dev server on :5173, proxies /api to :3000
npm run frontend:dev
```

Open **http://localhost:5173**. Edits under `frontend/src` reload instantly.

### Optional — Backend auto-restart while editing

```powershell
npm run dev        # node --watch src/server.js
```

### Optional — Use the API directly

```powershell
curl.exe http://localhost:3000/api/health
curl.exe "http://localhost:3000/api/shipments?limit=2&status=DELIVERED"
$KEY = (Select-String -Path .env -Pattern '^ADMIN_API_KEY=').Line.Split('=')[1]
curl.exe -X POST http://localhost:3000/api/admin/validate -H "x-api-key: $KEY" -H "content-type: application/json" -d "{}"
curl.exe http://localhost:3000/api/admin/jobs/<jobId> -H "x-api-key: $KEY"
```

### Running order at a glance

| # | Command | Needed when |
|---|---|---|
| 1 | `npm install` | first time |
| 2 | `Copy-Item .env.example .env` + set `ADMIN_API_KEY` | first time |
| 3 | MongoDB running | always |
| 4 | `npm run generate:full` (or `:small`) | first time / to regenerate |
| 5 | `npm run validate` | after each generation |
| 6 | `npm run export` | when you need CSV/JSON files |
| 7 | `npm run frontend:install` + `npm run frontend:build` | first time / after frontend changes |
| 8 | `npm start` → http://localhost:3000 | every time you want to use it |

Generation, validation and export can also be started from the UI once the server is running.

---

## 5. Command reference

All commands run from the repository root.

| Command | What it does |
|---|---|
| `npm start` | start the API (and the built UI) on `PORT` (default 3000) |
| `npm run dev` | same, restarting on backend file changes |
| `npm run generate:small` / `generate:full` | generate the small / full dataset, replacing the current one |
| `npm run generate -- --profile tiny --reset` | generic generator; flags: `--profile tiny\|small\|full`, `--seed N`, `--batch-size N`, `--reset`, `--resume`, `--db name` |
| `node src/scripts/generateData.js --profile full --resume` | continue an interrupted generation with the same config |
| `npm run validate` | standalone validation; `-- --report <file>` writes the full JSON report, `-- --export-dir <dir>` cross-checks an export |
| `npm run export` | export to `exports/latest`; `-- --label name` writes to `exports/name` |
| `npm run export:sql -- --label name [--verify]` | turn `exports/name/*.csv` into `json/<entity>.json` and `sql/schema.sql` + `seed.sql` + `seed_anomalies.sql`; `--verify` loads them into SQLite and checks foreign keys and row counts. Re-run it after every `npm run export` (the export replaces the whole folder) |
| `npm run verify:repro` | generate the same seed twice into separate DBs and compare all checksums (`-- --profile full --control` to also prove a different seed differs) |
| `npm run docs:dictionary` | regenerate `docs/DATA_DICTIONARY.md` from the Mongoose schemas |
| `npm test` | backend unit + integration + acceptance tests (uses `logistics_eta_test`) |
| `npm run test:unit` / `test:integration` / `test:acceptance` | one backend layer only |
| `npm run test:full` | full-volume acceptance test (50k/300k) in a separate `_test` database, ~8 min |
| `npm run lint` / `npm run format` | ESLint / Prettier for the backend |
| `npm run frontend:install` | install frontend dependencies |
| `npm run frontend:dev` | Vite dev server on :5173 |
| `npm run frontend:build` | production build to `frontend/dist` |
| `npm run frontend:test` | frontend component/unit tests |
| `npm run frontend:e2e` | Playwright end-to-end tests (see [section 15](#15-testing)) |
| `npm run frontend:lint` | ESLint for the frontend |

Any CLI script accepts `--db <name>` to work on a different database.

---

## 6. Configuration (.env)

### Backend — `.env` in the repository root (copy of `.env.example`, git-ignored)

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` or `production` (production hides error details) |
| `PORT` | `3000` | HTTP port for API + UI |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` (structured JSON logs) |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017` | MongoDB connection string (no credentials in source control) |
| `MONGODB_DB_NAME` | `logistics_eta` | application database |
| `MONGODB_DB_NAME_TEST` | `logistics_eta_test` | test database — **must end in `_test`** (enforced so tests can never wipe real data) |
| `ADMIN_API_KEY` | — (required, ≥ 16 chars) | `x-api-key` for `/api/admin/*` |
| `REQUEST_BODY_LIMIT` | `100kb` | JSON body size limit |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `60000` / `300` | general API rate limit |
| `ADMIN_RATE_LIMIT_MAX` | `20` | limit for generate/validate/export requests |
| `GENERATION_SEED` | `20261022` | default seed |
| `GENERATION_PROFILE` | `small` | default profile for `npm run generate` |
| `BATCH_SIZE` | `1000` | shipments per bulk-write batch |
| `EXPORT_DIR` | `exports` | export root; every export path is confined to it |

All variables are validated with Zod at start-up; an invalid value stops the server with a clear message.

### Frontend — `frontend/.env` (optional, copy of `frontend/.env.example`)

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `/api` | API base used by the browser |
| `VITE_BACKEND_ORIGIN` | `http://localhost:3000` | where the Vite dev/preview proxy forwards `/api` |

---

## 7. The dataset: what gets generated and how

### Profiles

| Profile | Shipments | Tracking events | Facilities | Disruption windows | Simulated days | Anomaly cases |
|---|---|---|---|---|---|---|
| `tiny` | 600 | 3,600 | 100 | 120 | 21 | 30 |
| `small` | 5,000 | 30,000 | 100 | 400 | 45 | 45 |
| `full` | **50,000** | **300,000** | **100** | **1,000** | 120 | 60 |

Baseline counts are **exact**. Anomaly records are additional and kept in a separate
`partition: "ANOMALY"`. The simulation starts 2026-01-01; the dataset snapshot time (`asOf`) is the end
of the window (2026-05-01 for `full`), so recent shipments are still in transit.

### The 11 required entities (+ supporting collections)

| Collection | Business ID | Key relationships | Notes |
|---|---|---|---|
| `carriers` | `CAR-001` | → service levels | 8 fictional carriers: transit factor, variability, scan compliance, EDI share, pickup reliability |
| `service_levels` | `SL-EXPRESS` | | Express / Priority / Standard / Economy; zone-based transit days, cut-off, at-risk buffer |
| `facilities` | `FAC-001` | `parentHubId` → facility | 14 hubs, 16 sort centers, 70 delivery stations in 50 US metros |
| `routes` | `RTE-00001` | stops/legs → facilities; alternate → primary | 4,830 primary + 4,496 alternate routes; stops/legs embedded; `routeId+version` unique |
| `shipments` | `SHP-2026-000001` | carrier, service level, origin/destination, planned/current route | observed status derived from events |
| `shipment_legs` | `LEG-<shipmentId>-01` | shipment, route, facilities | planned vs actual, delay breakdown (queue/weather/carrier), cancelled legs kept after reroutes |
| `tracking_events` | `EVT-<shipmentId>-000001` | shipment, leg, facility | append-only; separate `occurredAt` and `ingestedAt` |
| `facility_queues` | `FQ-<facilityId>-<ts>` | facility | 4-hourly observations with ingestion time |
| `weather_events` | `WX-2026-00001` | affected facilities | disruption windows; forecast/nowcast advisory issue and ingestion times |
| `eta_estimates` | `ETA-<shipmentId>-20260103T1200Z` | shipment; inputs → events/queues/weather | immutable snapshots + separate evaluation |
| `delay_reasons` | `DLY-2026-000001` | shipment; evidence → legs/facilities/weather | exactly one primary reason per delayed shipment |
| `ground_truth` | `GT-<shipmentId>` | shipment (1:1) | evaluation labels, kept apart from prediction inputs |
| `anomaly_cases` | `ANM-2026-0001` | shipment, affected records | expected validation rule IDs per anomaly |
| `jobs`, `validation_runs`, `dataset_manifests` | | | operational records (background jobs, validation history, generation provenance) |

Every field, type, constraint and index is listed in [docs/DATA_DICTIONARY.md](docs/DATA_DICTIONARY.md)
(generated from the schemas). MongoDB has no foreign keys, so integrity is enforced three ways: strict
schemas (unknown fields rejected, ID formats, enums, integer minutes), unique and compound indexes, and
the validator's reference checks (including orphan detection).

### How generation works

* **Deterministic.** A seeded PRNG (mulberry32 seeded through a cyrb53 hash) gives every record family
  its own keyed stream, e.g. `rngFor(seed, 'shipment', 42)`. A shipment is a pure function of
  `(seed, sequence)`, so batches are independent, generation is resumable and two runs are byte-identical.
  No dataset field uses wall-clock time or `Math.random`.
* **Simulate what happened, then what was observed.** Each shipment is first simulated physically
  (pickup, dwell, queues, weather, carrier performance, reroutes at the origin hub, last-mile delivery
  waves, failed attempts, damage holds). Then the scans the platform *saw* are derived: ingestion lag
  (scanner, driver app, EDI batches, delayed scans of 1–5 h), occasionally missed scans, and a snapshot
  cut-off. Shipment status, `pickedUpAt` and `deliveredAt` are derived from those observed events.
* **Exact event count.** A first pass counts natural scan volume; the difference to the target is
  distributed one optional departure scan at a time over a seeded shuffle of shipments (full: 320,147
  natural → 300,000). The manifest records this.
* **Bulk and bounded.** Inserts go in validated batches; failures abort loudly. A checkpoint is saved
  after each batch, so `--resume` continues an interrupted run and produces the same checksum.
* **Manifest.** Every run stores seed, config, versions, Node/MongoDB versions, record counts, target
  verification, per-collection SHA-256 checksums, the overall dataset checksum and a catalogue of valid
  edge-case shipments.

Realism levers: weighted city demand and business-hour tenders; service mix Express 14 % / Priority 24 %
/ Standard 46 % / Economy 16 %; regional weather climatology with severity 1–5 (70 % forecast 6–72 h
ahead, 30 % nowcast); queues with type-specific peak hours, Monday surge and 5 % congestion spikes;
0.3 % never picked up, 0.4 % damaged holds, 3 % failed first delivery attempts; reroutes when a known
severe advisory covers the downstream hub.

---

## 8. ETA engine

A transparent, deterministic, **rule-based** estimator (`eta-rules-v1.0.0`) — not a trained model.

```
ETA = predictionAt
    + base remaining duration   (planned dwell + planned transit × carrier factor + delivery-wave rule)
    + Σ per remaining facility  max(queue adjustment, weather adjustment)
    + hold adjustment           (open exception)
```

* **No future data.** Only events with `ingestedAt ≤ predictionAt` **and** `occurredAt ≤ predictionAt`
  are used; queue observations and weather advisories likewise by their ingestion time. Forecast
  advisories count because they were published before the window. Exact duplicate scans are dropped.
* **Reroutes** are honoured only once the `ROUTE_CHANGED` event itself is eligible.
* **No double counting.** Queue and weather are combined with `max` per facility (queue observations
  already include weather surge) and each weather window is applied at most once per shipment.
* **Dead reckoning.** Without a departure scan the parcel is assumed to have left on its planned
  schedule (missing departure scans are common).
* **Only creation-time shipment facts are inputs** (IDs, route, created/pickup/deadline times). Status,
  `deliveredAt`, current route and ground truth are never passed in; a test proves mutating them does
  not change an estimate.
* **Auditable snapshots.** Each stored snapshot has a source watermark (events considered, last event,
  latest ingestion time per source), the exact input IDs, an adjustment breakdown that sums to the
  total, `configHash`, `inputHash` and a confidence level. Evaluation (`estimated − actual`) is a separate
  sub-document added afterwards and never read by the engine.
* **Schedule.** Snapshots at tender + 1 h, 24 h, 48 h, 96 h and at the dataset snapshot time, stopping
  once a delivery scan has been ingested. Snapshots are immutable.

---

## 9. Ground truth and delay classification

Rules (`gt-rules-v1.0.0`), evaluated in order:

| # | Condition | Label |
|---|---|---|
| R1 | delivered by the snapshot | `ON_TIME` if on/before the SLA deadline, otherwise `DELAYED` |
| R2 | open DAMAGED exception | `OPERATIONAL_EXCEPTION` |
| R3 | no pickup scan more than 24 h after tender | `INSUFFICIENT_DATA` (outcome not guessed) |
| R4 | undelivered and past the deadline | `DELAYED` |
| R5 | no ETA available | `INSUFFICIENT_DATA` |
| R6 | ETA at snapshot within the service buffer of (or past) the deadline | `AT_RISK` |
| R7 | otherwise | `ON_TRACK` |

Delay reasons (`WEATHER_DISRUPTION`, `FACILITY_CONGESTION`, `CARRIER_DELAY`, `ROUTE_CHANGE`,
`DELIVERY_EXCEPTION`, `MISSING_TRACKING_INFO`, `UNATTRIBUTED`) are attributed from the recorded leg and
last-mile delay components, with a 30-minute materiality threshold and exactly one primary reason.

---

## 10. Validation engine and anomaly scenarios

`npm run validate` (or **Data Quality → Run validation** in the UI) runs **39 rules** without needing
the web server:

| Area | Rules |
|---|---|
| Schema | `SCHEMA_REQUIRED_FIELD`, `SCHEMA_ENUM_VALUE`, `SCHEMA_ID_FORMAT`, `UNIQUE_BUSINESS_ID` |
| References & structure | `REF_INTEGRITY` (incl. orphans), `FACILITY_HIERARCHY`, `ROUTE_STRUCTURE`, `SHIPMENT_ROUTE_CONSISTENCY`, `LEG_SEQUENCE`, `LEG_CHAIN_CONTINUITY` |
| Route order | `ROUTE_FACILITY_NOT_ON_ROUTE`, `ROUTE_SEQUENCE_VIOLATION` |
| Temporal | `TEMPORAL_INGESTED_BEFORE_OCCURRED`, `TEMPORAL_LATE_INGESTION`, `TEMPORAL_EVENT_BEFORE_CREATION`, `TEMPORAL_AFTER_SNAPSHOT`, `TEMPORAL_MILESTONE_ORDER`, `LEG_TIME_ORDER`, `WEATHER_WINDOW_VALID`, `QUEUE_OBSERVATION_VALID`, `TRACKING_STALLED` |
| Lifecycle | `LIFECYCLE_ILLEGAL_TRANSITION`, `SHIPMENT_STATUS_EVENT_MISMATCH`, `SHIPMENT_MILESTONE_RECONCILIATION`, `EVENT_DUPLICATE` |
| ETA | `ETA_FUTURE_DATA_LEAKAGE`, `ETA_REPRODUCIBILITY_MISMATCH` (every snapshot recomputed), `ETA_TIME_ORDER`, `ETA_ADJUSTMENT_RECONCILIATION`, `ETA_EVALUATION_RECONCILIATION`, `ETA_SNAPSHOT_COVERAGE` |
| Derived values | `SLA_DEADLINE_RECONCILIATION`, `LEG_DURATION_RECONCILIATION`, `GROUND_TRUTH_LABEL_RECONCILIATION`, `GROUND_TRUTH_DELIVERY_CONSISTENCY`, `DELAY_RECORD_RECONCILIATION` |
| Dataset | `RECORD_COUNT_TARGET`, `EXPORT_COUNT_CONSISTENCY`, `ANOMALY_DETECTION_COVERAGE` |

How it works: one aggregation scan per collection for schema checks; reference data in memory; then a
merge-join of six cursors sorted by shipment ID, so memory stays bounded by one shipment's records.

Every failure is reported as `ruleId, severity, entityType, recordId, shipmentId, status,
classification (INTENTIONAL_ANOMALY | UNEXPECTED), anomalyId, expected, actual, explanation,
recommendedCorrection`. A failure is **intentional** only when its shipment carries a labelled anomaly
case that expects that rule; everything else is **unexpected**. A run **passes** only with zero
unexpected ERROR/CRITICAL failures and every labelled anomaly detected. Nothing is suppressed.

### Labelled anomaly scenarios

Each case is a dedicated shipment (`SHP-2026-9xxxxx`) built clean and then given exactly one documented
mutation, so baseline records are never touched. Expected outcome for every case: **DETECTED**.

| Scenario | Variant | Expected rule(s) |
|---|---|---|
| A Ingestion-time confusion | scan ingested 30 h after it happened | `TEMPORAL_LATE_INGESTION` (historical ETAs provably exclude it) |
| A | ingested 3 h *before* it happened | `TEMPORAL_INGESTED_BEFORE_OCCURRED` |
| B Impossible route order | hub arrivals swapped | `ROUTE_SEQUENCE_VIOLATION` |
| B | scan at a hub not on the route | `ROUTE_FACILITY_NOT_ON_ROUTE` |
| B | leg 2 does not start where leg 1 ended | `LEG_CHAIN_CONTINUITY` |
| C Future-data leakage | ETA computed with a 30 h-later cut-off | `ETA_FUTURE_DATA_LEAKAGE` (CRITICAL), `ETA_REPRODUCIBILITY_MISMATCH`, `ETA_ADJUSTMENT_RECONCILIATION` |
| C | ETA uses a weather advisory published later | `ETA_FUTURE_DATA_LEAKAGE`, `ETA_REPRODUCIBILITY_MISMATCH` |
| D Delivered still in transit | DELIVERED event but status IN_TRANSIT | `SHIPMENT_STATUS_EVENT_MISMATCH` |
| E Duplicate events | same scan twice | `EVENT_DUPLICATE` |
| F Invalid references | unknown facility / unknown carrier / orphan event | `REF_INTEGRITY` (+ `ROUTE_FACILITY_NOT_ON_ROUTE`) |
| G Invalid timestamps | pickup before creation | `TEMPORAL_EVENT_BEFORE_CREATION`, `TEMPORAL_MILESTONE_ORDER` |
| H Illegal lifecycle | scan after DELIVERED | `LIFECYCLE_ILLEGAL_TRANSITION` |
| I Missing event gap | no scans for 12 days after pickup | `TRACKING_STALLED` |

Valid edge cases that must **not** be flagged are catalogued with example shipment IDs: on-time and
late deliveries, reroutes, delayed scans, failed first attempts, damaged holds, never-picked-up
tenders, at-risk shipments, weather-delayed deliveries and missed scans.

---

## 11. CSV / JSON exports and reproducibility

`npm run export [-- --label name]` (or **Exports → Start export** in the UI) streams every collection,
sorted by business ID, into `exports/<label>/`:

```
carriers.csv  service_levels.csv  facilities.csv  routes.csv  weather_events.csv  facility_queues.csv
shipments.csv  shipment_legs.csv  tracking_events.csv  eta_estimates.csv  delay_reasons.csv  ground_truth.csv
anomaly_manifest.json     labelled anomaly cases, expected rules, valid edge-case catalogue
validation_report.json    latest validation run
dataset_manifest.json     seed, config, versions, record counts, checksums, per-file rows/bytes/SHA-256
```

Format: RFC 4180 CSV, UTF-8, header row, CRLF; ISO-8601 UTC timestamps; string arrays pipe-joined;
nested arrays JSON-encoded in one cell; empty cell = null. Files are written to a staging folder and
swapped in atomically, and each file's row count is checked against its collection. Exports are
git-ignored (~201 MB at full volume) because they are fully reproducible; the tiny-profile export in
`exports/sample/` is the one exception.

**SQL and per-entity JSON:** `npm run export:sql -- --label <label> --verify` reads the CSV files (no
MongoDB connection needed) and adds:

```
json/<entity>.json        one JSON array per entity, nested objects restored
sql/schema.sql            27 tables with PRIMARY KEY / FOREIGN KEY constraints
sql/seed.sql              BASELINE rows, in one transaction
sql/seed_anomalies.sql    labelled ANOMALY rows only; they contain the deliberate bad references
sql_json_manifest.json    row counts per table and partition, SHA-256 per file, verification result
```

MongoDB embeds many-to-many links as ID arrays; the SQL export normalises each array into a bridge
table with a composite primary key (`carrier_service_levels`, `weather_event_facilities`,
`eta_input_events` with a `position` column, `delay_evidence_*`, and 9 more), and turns route stops and
legs into `route_stops` / `route_legs`. `--verify` loads everything into SQLite with
`foreign_keys = OFF`, runs `PRAGMA foreign_key_check` after the baseline seed and again after the
anomaly seed, and compares every table's row count with the seed and the CSV. Measured:

| Export | Rows (27 tables) | Baseline FK violations | Anomaly FK violations (intentional) | Time |
|---|---|---|---|---|
| `sample` (tiny) | 108,229 | **0** | 8 (`shipments`, `tracking_events`) | 4 s |
| `latest` (full) | 1,761,212 | **0** | 16 (`shipments`, `tracking_events`) | 42 s; SQL 268 MB, JSON 451 MB |

The script streams one CSV line at a time, so memory stays flat at full volume. The SQL is portable:
types are PostgreSQL-compatible and it was tested on SQLite 3.50.

**Reproducibility:** `npm run verify:repro` generates the same seed and config into two separate
databases, compares the per-collection content checksums (from MongoDB, excluding `_id`) and the SHA-256
of every exported CSV, and with `--control` confirms that a different seed changes the checksum. It
writes `exports/reproducibility_report.json`.

---

## 12. REST API

Base URL: `http://localhost:3000/api`. Responses: `{ "success": true, "data": …, "meta": {…} }` or
`{ "success": false, "error": { "code", "message", "details" } }`. Unknown query keys are rejected and
IDs are format-validated.

| Method & path | Description |
|---|---|
| `GET /api/health` | service + database health (503 when degraded) |
| `GET /api/system/config` | non-sensitive configuration: versions, generator profiles/defaults, rule count, API limits, latest manifest |
| `GET /api/shipments` | `page, limit≤200, status, carrierId, serviceLevelId, originFacilityId, destinationFacilityId, partition, delayClass, q (ID prefix), createdFrom, createdTo, sort`; rows include latest ETA, last event, ground-truth label |
| `GET /api/shipments/:id` | shipment, legs, facilities, related disruption windows, validation findings, and (separately) evaluation-only ground truth + delay reasons |
| `GET /api/shipments/:id/events?asOf=` | chronological events; `asOf` shows only what was ingested by then |
| `GET /api/shipments/:id/eta` | all ETA snapshots |
| `GET /api/shipments/:id/timeline` | merged lifecycle timeline with status transitions |
| `GET /api/events` | tracking-event explorer: `eventType, source, shipmentId, facilityId, partition, timeField (occurredAt/ingestedAt), from, to, late, flagged, sort` |
| `GET /api/etas`, `GET /api/etas/:id` | ETA snapshot explorer; detail adds a plain-language explanation of the calculation |
| `GET /api/facilities`, `GET /api/facilities/:id?days=` | facilities with volumes, queue statistics, latest observation, disruption counts; detail with queue history |
| `GET /api/disruptions`, `/timeline`, `/:id` | disruption windows with recorded shipment impact; daily active windows by severity; detail with impacted legs |
| `GET /api/analytics/summary?partition=` | counts, status/service/carrier mix, labels, dataset manifest |
| `GET /api/analytics/delays` | label counts, on-time rate, reasons, on-time by service level |
| `GET /api/analytics/delays/breakdowns` | delay rate by carrier and by deadline day; most-cited facilities |
| `GET /api/analytics/delays/shipments` | shipments by ground-truth class with reason/carrier/service/status/date filters |
| `GET /api/analytics/eta-accuracy` | MAE, bias, p50/p90, within 2/6/24 h, by horizon and position |
| `GET /api/analytics/eta-accuracy/breakdowns` | MAE, RMSE, bias, median, SLA-call accuracy overall / by carrier / service level / week; error histogram; deterministic predicted-vs-actual sample |
| `GET /api/analytics/event-volume` | daily event counts and ingestion lag, by type and source |
| `GET /api/analytics/data-quality` | latest validation run |
| `GET /api/analytics/data-quality/violations` | latest run's failures, filterable and paginated, with facets |
| `GET /api/exports`, `GET /api/exports/:label/files/:file` | completed exports; downloads only files listed in that export's manifest |
| `POST /api/admin/generate` | `{ profile, seed?, batchSize?, reset?, resume?, overrides? }` → 202 job (config validated first) |
| `POST /api/admin/validate` | `{ exportLabel? }` → 202 job |
| `POST /api/admin/export` | `{ label? }` → 202 job |
| `GET /api/admin/jobs?type=&limit=` | recent jobs and the active one |
| `GET /api/admin/jobs/:jobId`, `GET /api/admin/exports/:jobId` | job status, progress, result or error |

`/api/admin/*` requires the header `x-api-key: <ADMIN_API_KEY>`. Only one data job runs at a time
(`409 JOB_CONFLICT` otherwise). Heavy analytics are cached per dataset version and recompute
automatically after a new generation or validation.

Security: helmet headers, body size limit, rate limits, `simple` query parser (blocks `?status[$ne]=`
style operator injection), Zod validation on every input, anchored/escaped ID search, constant-time key
comparison, export paths confined to `EXPORT_DIR`, no stack traces in responses, graceful shutdown.

---

## 13. Frontend (YottaFlex Intelligence)

React 18 · Vite 6 · React Router 6 · Tailwind CSS 4 · Recharts · Axios · Lucide icons · Sonner toasts ·
React Hook Form + Zod · Inter font (bundled, no external requests). JavaScript/JSX.

### Pages

| Section | What you can do |
|---|---|
| **Overview** | 6 KPIs (shipments, on-time rate, delayed, at risk, ETA MAE, tracking events); on-time vs delayed by day; operational alerts; shipment status; delay reasons; facility congestion; event volume; ETA error histogram; recent events; switch between baseline / all / anomaly data |
| **Shipments** | server-paginated table with ID search, status, delay class, carrier, service level, origin, destination, partition and date filters; sortable; filters kept in the URL |
| **Shipment detail** | overview, current ETA vs deadline, route progression with per-leg queue/weather/carrier delay, event timeline (event vs ingestion time, late arrivals, illegal transitions, validation flags), ETA history chart, related disruptions, validation findings; ground truth in a separate *evaluation* panel |
| **Tracking Events** | explore all 300k events by type, source, shipment, facility, partition, time range on event *or* ingestion time; late-arrival and validation-flagged filters |
| **ETA Intelligence** | predictions, evaluated count, MAE, median, RMSE, SLA-call accuracy; error by horizon, week, carrier, service level; predicted vs actual scatter; snapshot explorer; snapshot detail with watermark, inputs and step-by-step explanation |
| **Delay Analysis** | delay count, rate and average; reasons; rate by carrier and over time; most-cited facilities; tabs for actual delays, at-risk predictions, operational exceptions, insufficient data |
| **Facilities** | all 100 facilities with latest queue state, averages, disruption counts and volumes; detail with queue history (7–120 days), disruptions, recent scans, delay attributions |
| **Disruptions** | daily active windows by severity; filterable table with advisory timing and shipment impact; detail with affected facilities and impacted legs |
| **Data Quality** | run status, checks, intentional vs unexpected, rule families, all rules, anomaly coverage, filterable violation table, **run validation** |
| **Dataset Generator** | presets (tiny / development / full challenge), validated form, replace vs resume, confirmation, live job progress, records generated, recent jobs |
| **Exports** | create an export, export jobs, completed exports with rows, size, SHA-256 and real download links |
| **Settings** | API and database health, versions, API base URL, admin key, dataset and generator configuration |

### Design and behaviour

* Midnight-navy sidebar, cobalt primary actions, cool neutral surfaces; status is always icon + text,
  never colour alone. Chart and status colours were checked for contrast and colour-vision separation.
* Every chart has hover tooltips, an accessible summary and a **Table** toggle.
* Responsive: collapsible sidebar on desktop, slide-in drawer on tablet/mobile, filters collapse behind
  a button on phones. Keyboard accessible: skip link, labelled controls, visible focus, Escape-closable
  dialogs. Reduced-motion respected.
* Honest data: every number comes from the API (no mock data in the app); no invented trends; synthetic
  disruptions are labelled as historical records, not live weather; job progress is the backend's job
  record; downloads appear only for files that really exist.
* Requests are cancelled when filters change, stale responses are ignored, GETs retry on network errors,
  POSTs never retry; large collections are always paginated on the server.

More detail: [frontend/README.md](frontend/README.md).

---

## 14. Measured results

Real outputs on the development machine (Windows 11, Node 22.17, local MongoDB 8.0, seed `20261022`).
Timings apply to this machine only.

**Generation (full profile)** — 222 s. Dataset checksum
`e8a4ec8640c1b999e20a41950e2aceedbfb2e276f5066122887ba7742ae834ac`.

| Collection | Baseline | Anomaly partition | Target |
|---|---|---|---|
| shipments | **50,000** | 56 | 50,000 ✔ |
| tracking_events | **300,000** | 367 | 300,000 ✔ |
| facilities | **100** | – | 100 ✔ |
| weather_events (disruption windows) | **1,000** | – | 1,000 ✔ |
| shipment_legs | 152,483 | 168 | |
| eta_estimates | 137,146 | 188 | |
| facility_queues | 72,000 | – | |
| ground_truth | 50,000 | 56 | |
| delay_reasons | 4,924 | 3 | |
| routes / carriers / service_levels | 9,326 / 8 / 4 | – | |
| anomaly_cases | 60 | | |

Database size: 440 MB data, 95 MB on disk (compressed), 63 MB indexes.

**Validation** — 63 s, **PASS**: 777,889 records, 26,456,735 checks, 81 failures, all 81 intentional
(labelled anomalies); **0 unexpected errors, 0 unexpected warnings; 60/60 anomaly cases detected**;
12/12 export files count-consistent.

**Exports** — 12 CSV + 3 JSON files, 201 MB; every SHA-256 in the manifest verified.

**Reproducibility** — two runs of the same seed produced identical checksums for all 13 collections and
all 12 CSV files; a different seed produced a different checksum; an interrupted-then-resumed run
reproduced the uninterrupted checksum.

**Labels (baseline)** — ON_TIME 46,619 · DELAYED 2,008 · ON_TRACK 1,009 · OPERATIONAL_EXCEPTION 211 ·
INSUFFICIENT_DATA 149 · AT_RISK 4. On-time rate 95.9 % (Express 90.9 %, Priority 96.4 %, Standard
96.2 %, Economy 98.8 %). Primary delay reasons: weather 1,281, delivery exception 499, carrier 158,
congestion 43, route change 20, unattributed 7. 3,004 shipments rerouted.

**ETA accuracy (132,354 evaluated snapshots)** — MAE 395 min, median 151 min, RMSE 695 min, bias
−258 min, SLA-call accuracy 96.9 %, 78.0 % within 6 h.

| Time to delivery | Snapshots | MAE (min) | Bias (min) | Median (min) | p90 (min) | Within 6 h |
|---|---|---|---|---|---|---|
| 0–12 h | 19,945 | 125 | −38 | 103 | 227 | 98.7 % |
| 12–24 h | 18,826 | 166 | +27 | 112 | 244 | 95.4 % |
| 24–48 h | 42,425 | 313 | −154 | 148 | 1,268 | 84.5 % |
| 48–96 h | 43,587 | 576 | −445 | 201 | 1,540 | 66.5 % |
| 96 h+ | 7,033 | 1,180 | −1,150 | 1,388 | 2,716 | 35.0 % |

The negative bias at long horizons is a selection effect: shipments still undelivered days later are
mostly the ones hit by unforecast weather, failed attempts or slow carriers.

---

## 15. Testing

### Backend

```powershell
npm test                 # unit + integration + acceptance, ~95 s
npm run test:full        # full-volume acceptance, ~8 min
npm run lint
```

Tests only use databases whose names end in `_test` (enforced in code) and drop the test database at
the start of each run, so they never touch `logistics_eta`.

* **Unit** — RNG determinism, ID formats, CSV escaping, lifecycle state machine, SLA rules, delivery
  waves, delay classification and attribution, calibration, ETA determinism and leakage properties
  (future events, late-arriving events, clock-skewed events, future weather advisories, outcome fields
  and duplicates cannot change an estimate).
* **Integration** — schema validation, unique/compound indexes, every API endpoint including the
  explorer endpoints (pagination, filters, injection attempts, 400/401/404/409/413), background jobs,
  export correctness, cross-file reference integrity, path-traversal protection.
* **Acceptance** — exact counts, PASS with zero unexpected findings, every anomaly detected and
  classified intentional, valid edge cases not flagged, Scenario A/C/D proofs, two-run reproducibility,
  seed sensitivity, interrupted-then-resumed generation.

### Frontend

```powershell
npm run frontend:test    # component/unit tests (API mocked)
npm run frontend:lint
```

End-to-end tests run in a real browser against the real backend and dataset. With the server running:

```powershell
cd frontend
npx playwright install chromium            # first time only
$env:E2E_BASE_URL = "http://localhost:3000"
$env:E2E_ADMIN_KEY = "<your ADMIN_API_KEY>" # optional: enables the admin workflow test
npm run test:e2e
```

### Results

| Suite | Result |
|---|---|
| Backend `npm test` | **95 / 95 passed** (10 files, ~71 s) |
| Backend `npm run test:full` | **3 / 3 passed** (full 50k/300k generation, validation and export in `logistics_eta_full_test`, 458 s) |
| `npm run verify:repro` | **REPRODUCIBLE: YES** — two runs of the same seed gave identical collection checksums and identical SHA-256 for all 12 CSV files |
| `npm run export:sql -- --verify` | **passed** on `sample` and full `latest`: 0 baseline foreign-key violations, row counts match seeds and CSVs |
| Frontend component/unit | **33 / 33 passed** |
| Frontend end-to-end (Playwright, real backend, full dataset) | **9 / 9 passed** |
| ESLint (backend and frontend), Prettier (backend) | clean |
| Frontend production build | succeeds |

---

## 16. Project structure

```
logistic-etaAi/
├── README.md                     this file
├── package.json                  backend scripts + frontend:* helper scripts
├── .env.example                  backend configuration template (copy to .env)
├── eslint.config.js, .prettierrc.json, vitest.config.js, vitest.full.config.js
├── docs/
│   ├── ARCHITECTURE.md           design decisions, ER diagram, time semantics
│   └── DATA_DICTIONARY.md        every field/type/constraint/index (generated)
├── exports/                      generated deliverables (git-ignored except README and sample/)
│   └── sample/                   committed tiny-profile export: CSV, JSON, SQL, manifests, validation report
├── src/
│   ├── app.js, server.js         Express app (API + built UI), start/shutdown
│   ├── config/                   env (Zod), database, constants, generation profiles
│   ├── domain/                   shared rules: sla, lifecycle, network, operations, queueModel
│   ├── models/                   Mongoose schemas (11 entities + GroundTruth, AnomalyCase, Job, ValidationRun, DatasetManifest)
│   ├── generators/               rng, masterData, disruption, shipment, event, records.builder, groundTruth, anomaly, context
│   ├── services/                 generation, eta, etaInsight, delay, validation, quality, export, analytics,
│   │                             insights, shipment, event, facility, job, checksum, system
│   ├── validators/               rules, collector, schema, relationship, temporal, lifecycle, leakage, reconciliation
│   ├── routes/, controllers/     REST layer (+ request schemas)
│   ├── middleware/               auth, error handler, request validation, request logging
│   ├── jobs/worker.js            background worker for generate/validate/export
│   ├── scripts/                  generateData, validateData, exportData, exportSqlJson, verifyReproducibility, generateDataDictionary
│   └── utils/                    logger, time, ids, hashing, csv, bulk writes, dataset cache, errors
├── tests/
│   ├── unit/  integration/  acceptance/  helpers/
└── frontend/
    ├── README.md, package.json, vite.config.js, playwright.config.js, .env.example
    ├── e2e/                      Playwright specs
    └── src/
        ├── app/                  App, router (lazy-loaded pages)
        ├── api/                  Axios client + API modules
        ├── context/              health, config, admin key
        ├── hooks/                useApiQuery, useUrlState, useDebouncedValue, useJobPoller
        ├── components/           layout, common UI, charts, jobs, generator
        ├── pages/                one file per screen
        ├── styles/index.css      design tokens
        ├── utils/                formatting, domain labels
        └── test/                 test setup, mocks, component tests
```

---

## 17. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Invalid environment configuration: ADMIN_API_KEY …` on start | `.env` missing or key shorter than 16 characters — create `.env` from `.env.example` and set it |
| `MongoServerSelectionError` / `ECONNREFUSED 127.0.0.1:27017` | MongoDB is not running — `Start-Service MongoDB` (Windows) or start it as in [section 3](#getting-mongodb-running); check `MONGODB_URI` |
| UI shows **"API offline"** banner | backend not running or unreachable — run `npm start`; in dev mode also check `VITE_BACKEND_ORIGIN` |
| `http://localhost:3000` returns `NOT_FOUND` JSON for `/` | the frontend is not built — run `npm run frontend:build`, then restart `npm start` |
| Overview says "No completed dataset found" | generate one: `npm run generate:small` (or from the Dataset Generator page) |
| `A dataset already exists; pass reset=true` | use `--reset` (the `generate:small/full` scripts already do) |
| Admin buttons disabled / `401 UNAUTHORIZED` | paste `ADMIN_API_KEY` in **Settings → Admin access** (or send `x-api-key`) |
| `409 JOB_CONFLICT` | another generate/validate/export job is running — wait for it (see Dataset Generator → Recent jobs) |
| Data Quality page: "No validation run yet" | run `npm run validate` or click **Run validation now** |
| First Overview / ETA load is slow | the server is computing analytics for a new dataset (~7–15 s on full volume); later loads are cached |
| Port 3000 already in use | set `PORT=3100` in `.env` (and `VITE_BACKEND_ORIGIN=http://localhost:3100` for dev mode) |
| `EPERM` while exporting on Windows/OneDrive | a sync client briefly locked the folder; the export retries automatically, re-run if it still fails |
| `Cannot calibrate event count` | custom counts outside 5.2–6.8 events per shipment — adjust the tracking-event target |
| `$percentile` aggregation error | MongoDB older than 7.0 — upgrade |
| Interrupted generation (crash, Ctrl+C) | `node src/scripts/generateData.js --profile <same> --resume` |

---

## 18. Build log: what was done, in order

**Backend and data platform**

1. Turned the challenge into an architecture: shared domain rules, keyed RNG, physical simulation
   followed by observation, a standalone validator, background jobs.
2. Configuration (Zod-validated `.env`), MongoDB connection with a guard that refuses destructive test
   operations on non-`_test` databases, constants and generation profiles.
3. 16 Mongoose models (11 required entities + ground truth, anomaly cases, jobs, validation runs,
   manifests) with strict schemas, business-ID formats, enums and indexes.
4. Master data: 100-facility network, 8 carriers, 4 service levels, 9,326 routes.
5. Weather disruption windows and a deterministic facility queue model with 4-hourly observations.
6. Shipment simulator (pickup, legs, dwell, queues, weather, carrier noise, reroutes, last mile,
   failed attempts, damage holds) and event emission with ingestion lag, missed scans and exact-count
   calibration.
7. Rule-based ETA engine with ingestion-time eligibility, watermarks, input hashes and evaluation kept
   separate; delay classification and attribution; ground truth.
8. Labelled anomaly injector (15 variants, scenarios A–I) and a 39-rule validation engine that separates
   intentional anomalies from unexpected defects.
9. Streaming CSV/JSON exports with checksums; reproducibility verifier; data dictionary generator.
10. Express API with consistent envelopes, error handling, rate limits, security headers, admin key,
    background job worker and a single-active-job lock.
11. Tests: unit, integration, acceptance and full-volume acceptance.
12. Generated, validated and exported the full 50k/300k dataset and recorded the results above.

Problems found and fixed during this work: SLA commitments were first unrealistically lenient for
ground services, so they were retuned to realistic on-time rates. The ETA engine assumed parcels
without a departure scan were leaving "now", which made estimates about 4.5 h late, so it was switched
to dead reckoning. The engine also clamped already-delivered estimates to the prediction time. An
export rename hit `EPERM` on OneDrive, so retries were added. The rule count in the docs was corrected
to 39.

**Frontend and the endpoints it needed**

13. Added read-only backend endpoints: tracking-event explorer, facilities and facility detail,
    disruptions (list, timeline, detail), ETA snapshot explorer with explanations, ETA and delay
    breakdowns, delayed-shipment lists, event volume, filterable violations, export listing and safe
    download, recent jobs, system config; generator overrides; per-dataset caching; three supporting
    indexes. Two slow aggregations were rewritten (69 s → 7 s and 21 s → 0.9 s). The strict admin rate
    limit was limited to the actions, so status polling is not throttled.
14. Built the React + Vite application: design tokens, app shell (sidebar, top bar, breadcrumbs, global
    search, live API status), reusable components (tables, pagination, filters, metric cards, dialogs,
    charts), 12 sections plus detail pages, and job progress tracking.
15. Served the built UI from Express so one `npm start` runs everything.
16. Checked every page in a real browser at desktop and mobile size. Fixed: charts rendering empty,
    truncated KPI labels, raw-minute chart axes, a job panel that vanished after validation finished, a
    status label read twice by screen readers, filters taking too much room on phones.
17. Frontend component tests, Playwright end-to-end tests against the real backend, and documentation.

---

## 19. Limitations and assumptions

* Synthetic US-like network with fictional carriers. All times are UTC; local business hours, weekends
  and holidays are not modelled (calendar-day SLAs).
* The ETA engine is a transparent rule-based estimator, not a learned model. It does not model linehaul
  weather slowdown or per-lane history; long-horizon estimates for slow shipments are biased early.
* Leg actuals are treated as linehaul manifest data; the ETA engine and lifecycle use the event feed.
  Ground truth uses the physical delivery time; the observed `deliveredAt` can lag it if the delivery
  scan was not yet ingested at the snapshot time.
* The exact event count is reached by toggling optional departure scans; the adjustment is recorded.
* Validation stores up to 5,000 violations in the database (all are counted; the CLI `--report` file
  contains every one).
* Admin access is a single shared API key, suitable for a challenge deployment; there is no user login.
* Frontend: light theme only; no resolution workflow for data-quality findings (the backend does not
  track resolution); no "recalculate ETA" action because snapshots are immutable by design.
* Requires MongoDB ≥ 7.0.
