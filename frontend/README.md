# YottaFlex Intelligence — frontend

*Logistics visibility. Predictive decisions. Operational clarity.*

React + Vite single-page application for the logistics intelligence backend in the repository root.
Every number on screen comes from the Express API: there is no mock or demo data in the application
(mocks exist only inside the component tests).

## Stack

React 18.3 · Vite 6 · React Router 6 · Tailwind CSS 4 (`@tailwindcss/vite`) · Recharts 2 · Axios ·
Lucide icons · Sonner toasts · React Hook Form + Zod · Inter (self-hosted via `@fontsource-variable`) ·
Vitest + Testing Library · Playwright. JavaScript/JSX only.

## Run it

Prerequisites: the backend running with a generated dataset (see the root README).

**Development (hot reload)** — Vite proxies `/api` to the backend, so no CORS setup is needed:

```bash
# terminal 1 (repo root)
npm start                      # Express API on http://localhost:3000
# terminal 2
cd frontend
cp .env.example .env           # optional; defaults work
npm install
npm run dev                    # http://localhost:5173
```

**Production-style (single server)** — build once; the Express server then serves the app and the API
from the same origin:

```bash
cd frontend && npm install && npm run build      # writes frontend/dist
cd .. && npm start                               # open http://localhost:3000
```

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `/api` | API base path/URL used by the browser |
| `VITE_BACKEND_ORIGIN` | `http://localhost:3000` | target of the Vite dev/preview proxy |

### Admin key

Generation, validation and export are admin operations. Open **Settings → Admin access** and paste the
backend's `ADMIN_API_KEY`; it is verified against the API, kept in `sessionStorage` for the tab only and
never bundled. Without it the UI is read-only and admin buttons explain why they are disabled. The
backend has no user authentication, so the UI shows no signed-in user.

## Pages

| Route | What it shows | Backend data |
|---|---|---|
| `/` Overview | 6 KPIs, on-time vs delayed by deadline day, alerts, status, delay reasons, facility congestion, event volume, ETA error histogram, recent events; partition switch | summary, delays, delay breakdowns, ETA accuracy & breakdowns, event volume, facilities, disruptions active at snapshot, latest validation run |
| `/shipments` | Server-paginated table: search by ID prefix, status, delay class, carrier, service level, origin, destination, partition, created range; sortable; URL-synced | `GET /api/shipments` (rows enriched with latest ETA, last event, ground-truth label) |
| `/shipments/:id` | Overview, current ETA vs deadline, route progression with per-leg queue/weather/carrier delay, event timeline (event vs ingestion time, late arrivals, illegal transitions, validation flags), ETA history chart, related disruptions, validation findings; ground truth in a separate *evaluation* panel | detail, timeline, ETA snapshots |
| `/tracking` | 300k-event explorer: type, source, shipment, facility, partition, range on event *or* ingestion time, late-arrivals and validation-flagged toggles | `GET /api/events` |
| `/eta`, `/eta/:id` | Predictions, evaluated count, MAE, median, RMSE, SLA-call accuracy; error by horizon / week / carrier / service level; predicted-vs-actual scatter; snapshot explorer; snapshot detail with watermark, inputs, adjustment composition and a step-by-step explanation | ETA accuracy & breakdowns, `GET /api/etas[/:id]` |
| `/delays` | Delay count/rate/average, reasons, rate by carrier, rate over time, most-cited facilities; tabs separating actual delays, at-risk predictions, operational exceptions and insufficient data | delays, breakdowns, classified shipments |
| `/facilities`, `/facilities/:id` | 100 facilities with latest queue observation, averages, disruption counts, volumes; detail with queue history (7–120 days), disruptions, recent scans, delay attributions | `GET /api/facilities[/:id]` |
| `/disruptions`, `/disruptions/:id` | Daily active windows by severity; filterable window table with advisory timing and recorded shipment impact; detail with affected facilities and impacted legs | `GET /api/disruptions[/timeline|/:id]` |
| `/data-quality` | Run status, records/checks/failures, intentional vs unexpected, rule-family counts, all rules, anomaly detection coverage, filterable violation table; run validation as a job | data quality, violations, `POST /api/admin/validate` |
| `/generator` | Presets (tiny / development / full challenge = 50k/300k/100/1,000), validated form, replace vs resume, confirmation, live job progress, records generated, recent jobs | `POST /api/admin/generate`, jobs |
| `/exports` | Create export (label), export jobs, completed exports with rows, size, SHA-256 and real download links | `GET /api/exports`, file download, `POST /api/admin/export` |
| `/settings` | API/DB health, version, base URL, admin key, latest manifest, generator/API defaults | health, system config |

Honesty rules the UI follows: KPIs show no trend arrows (the dataset is one snapshot, no comparison
period); disruption data is labelled as synthetic historical records, not live weather; ground-truth
labels are marked as evaluation data; downloads appear only for files listed in a real export
manifest; job progress is the backend job record, never a client-side animation; the backend does
not track issue resolution, so no "resolved" state is shown.

## Design system

* Tokens in `src/styles/index.css` (`@theme`): midnight navy shell, cobalt primary actions, cool
  neutral surfaces, slate text, 4–8 px radii, restrained shadows; Inter with tabular numerals for
  IDs, metrics and timestamps.
* Status is always icon + text (`StatusBadge`), never colour alone. Status colours (good `#00977F`,
  warning `#C77D0A`, critical `#D23F57`) and the primary series colour (`#315CF5`) were run through a
  colour-vision / contrast validator (all checks pass); the severity ramp is single-hue sequential.
* Charts: one axis per chart, legends for multi-series charts, hover tooltips, an accessible text
  summary and a **Table** toggle on every chart.
* Accessibility: skip link, landmarks, labelled controls, visible focus, `aria-sort` on sortable
  columns, keyboard-operable tooltips and dialogs (focus moves in, Escape closes, focus returns),
  reduced-motion respected. Light theme only.
* Responsive: collapsible sidebar on desktop, drawer below 1024 px, filters collapse behind a toggle
  below 768 px, tables scroll horizontally and hide secondary columns progressively.

## Architecture

```
src/
  app/            App.jsx, router.jsx (lazy-loaded routes)
  api/            apiClient.js (Axios, error normalisation, GET retry, admin header), index.js (one module per area)
  context/        AppContext.jsx (health polling, system config, admin key)
  hooks/          useApiQuery (abort + stale-response guard), useUrlState, useDebouncedValue, useJobPoller
  components/     layout/, common/ (DataTable, Pagination, Filters, MetricCard, ConfirmDialog, ...), charts/ChartKit.jsx, jobs/, generator/
  pages/          one file per route
  utils/          format.js (UTC formatting), domain.js (labels and tones)
e2e/              Playwright specs (real backend)
```

Data fetching: every request goes through `useApiQuery`, which aborts the previous request when inputs
change and ignores stale responses. GETs retry twice on network/502–504 errors; POSTs (generate,
validate, export) are never retried. Large collections are always paginated and filtered on the server.

## Backend endpoints used

`/api/health`, `/api/system/config`, `/api/shipments`, `/api/shipments/:id`, `/:id/eta`,
`/:id/timeline`, `/api/events`, `/api/etas`, `/api/etas/:id`, `/api/facilities`, `/api/facilities/:id`,
`/api/disruptions`, `/api/disruptions/timeline`, `/api/disruptions/:id`, `/api/analytics/summary`,
`/api/analytics/delays`, `/api/analytics/delays/breakdowns`, `/api/analytics/delays/shipments`,
`/api/analytics/eta-accuracy`, `/api/analytics/eta-accuracy/breakdowns`, `/api/analytics/event-volume`,
`/api/analytics/data-quality`, `/api/analytics/data-quality/violations`, `/api/exports`,
`/api/exports/:label/files/:file`, `/api/admin/generate`, `/api/admin/validate`, `/api/admin/export`,
`/api/admin/jobs`, `/api/admin/jobs/:jobId`.

The endpoints added to the backend for this UI are listed in the root README (section 12).

## Tests

```bash
npm test                 # Vitest + Testing Library (API module mocked)
npm run lint
npm run build
E2E_BASE_URL=http://localhost:3000 E2E_ADMIN_KEY=<key> npm run test:e2e   # Playwright vs real backend
npx playwright install chromium                                           # first time only
```

* **Component/unit (33 tests):** formatting, Zod generator schema and request building, API error
  normalisation, `useApiQuery` stale-response and abort behaviour, dashboard KPIs from the API,
  health states, sidebar navigation and breadcrumbs, mobile drawer via keyboard, global search,
  shipments search/filters/URL state, server pagination and sorting, loading → error → retry, empty
  state, shipment detail, data-quality summary and violation filters, admin gating, generator
  validation, confirmation, job progress and failure, export downloads and empty state.
* **End-to-end (9 tests, real backend + full dataset):** live KPIs and charts, search → shipment
  detail, server pagination with URL state, late-arrival filter, live validation report, CSV download,
  skip link, mobile drawer and collapsible filters, and (with `E2E_ADMIN_KEY`) running validation as
  a background job from the UI. Every test also fails on any browser console error.

## Limitations

* Light theme only; no theme switcher.
* The first Overview load after a new dataset triggers server-side aggregations (about 7–15 s cold on the
  full dataset, then cached per dataset version).
* No resolution workflow for data-quality findings (not supported by the backend).
* ETA recalculation is not offered: snapshots are immutable by design and new ones are created only by
  the generator's prediction schedule.
