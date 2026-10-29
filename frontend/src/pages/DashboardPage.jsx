import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CloudLightning,
  Gauge,
  Package,
  Radio,
  ShieldCheck,
  TrendingDown,
  Warehouse,
} from 'lucide-react';
import { analyticsApi, disruptionApi, etaApi, facilityApi, qualityApi, trackingApi } from '../api/index.js';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useUrlState } from '../hooks/useUrlState.js';
import { PageHeader, Panel } from '../components/common/Panel.jsx';
import { MetricCard } from '../components/common/MetricCard.jsx';
import { QueryState, ErrorState } from '../components/common/States.jsx';
import { SelectFilter } from '../components/common/Filters.jsx';
import { StatusBadge, Tag, ToneIcon } from '../components/common/StatusBadge.jsx';
import { DataTable } from '../components/common/DataTable.jsx';
import { FacilityLink, Mono, ShipmentLink } from '../components/common/Links.jsx';
import { CHART, ChartFrame, ColumnChart, HBarChart, hoursTick, TimeAreaChart } from '../components/charts/ChartKit.jsx';
import {
  formatDateTime,
  formatDayTick,
  formatDuration,
  formatNumber,
  formatPercent,
  humanize,
} from '../utils/format.js';

const PARTITIONS = [
  { value: 'BASELINE', label: 'Baseline dataset' },
  { value: 'ALL', label: 'Baseline + anomalies' },
  { value: 'ANOMALY', label: 'Anomaly partition only' },
];

function Kpis({ summary, delays, eta }) {
  const s = summary.data;
  const d = delays.data;
  const e = eta.data?.overall;
  const delivered = d?.deliveredShipments;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <MetricCard
        label="Shipments"
        icon={Package}
        loading={summary.loading && !s}
        error={Boolean(summary.error)}
        value={formatNumber(s?.collections.shipments)}
        context={s ? `${formatNumber(s.shipmentStatus?.IN_TRANSIT ?? 0)} in transit at snapshot` : ''}
        info="Shipment records in the selected partition of the current dataset."
      />
      <MetricCard
        label="On-time rate"
        icon={CheckCircle2}
        tone="good"
        loading={delays.loading && !d}
        error={Boolean(delays.error)}
        value={formatPercent(d?.onTimeRate)}
        context={delivered !== undefined ? `of ${formatNumber(delivered)} delivered` : ''}
        info="Delivered shipments whose ground-truth delivery time was on or before the SLA deadline, divided by all delivered shipments."
      />
      <MetricCard
        label="Delayed"
        icon={TrendingDown}
        tone="crit"
        loading={summary.loading && !s}
        error={Boolean(summary.error)}
        value={formatNumber(s?.delayClasses?.DELAYED ?? 0)}
        context="delivered late or overdue"
        info="Ground-truth label DELAYED: delivered after the SLA deadline, or undelivered and already past it."
      />
      <MetricCard
        label="At risk"
        icon={AlertTriangle}
        tone="warn"
        loading={summary.loading && !s}
        error={Boolean(summary.error)}
        value={formatNumber(s?.delayClasses?.AT_RISK ?? 0)}
        context="ETA within buffer of deadline"
        info="Undelivered shipments whose ETA at the snapshot time falls within the service level's at-risk buffer of (or past) the deadline."
      />
      <MetricCard
        label="ETA error (MAE)"
        icon={Gauge}
        loading={eta.loading && !eta.data}
        error={Boolean(eta.error)}
        value={formatDuration(e?.maeMinutes)}
        context={e ? `median ${formatDuration(e.p50AbsErrorMinutes)} · ${formatNumber(e.snapshots, { compact: true })} snapshots` : ''}
        info="Mean absolute difference between estimated and actual delivery over ETA snapshots whose shipment has been delivered."
      />
      <MetricCard
        label="Tracking events"
        icon={Radio}
        loading={summary.loading && !s}
        error={Boolean(summary.error)}
        value={formatNumber(s?.collections.tracking_events)}
        context="ingested by snapshot time"
        info="Tracking events in the selected partition (only events ingested by the dataset snapshot time exist)."
      />
    </div>
  );
}

function Alerts({ summary, asOf, facilities, quality }) {
  const active = useApiQuery(`active-disruptions-${asOf}`, (signal) =>
    disruptionApi.list({ from: asOf, to: asOf, limit: 5, sort: '-severity' }, { signal }),
    { enabled: Boolean(asOf) },
  );
  const items = [];
  const classes = summary.data?.delayClasses ?? {};
  if (classes.DELAYED)
    items.push({ tone: 'crit', icon: TrendingDown, title: `${formatNumber(classes.DELAYED)} delayed shipments`, body: 'Delivered late or overdue against the SLA deadline.', to: '/delays' });
  if (classes.AT_RISK)
    items.push({ tone: 'warn', icon: AlertTriangle, title: `${formatNumber(classes.AT_RISK)} shipments at risk`, body: 'ETA at the snapshot falls within the deadline buffer.', to: '/delays?class=AT_RISK' });
  if (classes.OPERATIONAL_EXCEPTION)
    items.push({ tone: 'warn', icon: Package, title: `${formatNumber(classes.OPERATIONAL_EXCEPTION)} open exceptions`, body: 'Parcels held after a DAMAGED exception scan.', to: '/shipments?delayClass=OPERATIONAL_EXCEPTION' });
  if (active.meta?.total)
    items.push({ tone: active.data?.some((w) => w.severity >= 4) ? 'crit' : 'warn', icon: CloudLightning, title: `${formatNumber(active.meta.total)} disruption windows active at snapshot`, body: `Most severe: ${active.data?.[0]?.weatherEventId} (${humanize(active.data?.[0]?.weatherType)}, severity ${active.data?.[0]?.severity}).`, to: `/disruptions?from=${asOf?.slice(0, 10)}&to=${asOf?.slice(0, 10)}` });
  const congested = (facilities.data ?? []).filter((f) => ['HIGH', 'SEVERE'].includes(f.latestQueueObservation?.congestionLevel));
  if (congested.length)
    items.push({ tone: 'warn', icon: Warehouse, title: `${congested.length} facilities congested in latest observation`, body: congested.slice(0, 4).map((f) => f.facilityId).join(', ') + (congested.length > 4 ? '…' : ''), to: '/facilities?congestion=HIGH' });
  const q = quality.data;
  if (q) {
    if (q.summary.unexpectedErrors > 0)
      items.push({ tone: 'crit', icon: ShieldCheck, title: `${formatNumber(q.summary.unexpectedErrors)} unexpected data-quality errors`, body: `Validation run ${q.runId} failed.`, to: '/data-quality?classification=UNEXPECTED' });
    const seq = (q.rules ?? []).filter((r) => ['ROUTE_SEQUENCE_VIOLATION', 'LIFECYCLE_ILLEGAL_TRANSITION'].includes(r.ruleId)).reduce((s, r) => s + r.failed, 0);
    if (seq)
      items.push({ tone: 'neutral', icon: Activity, title: `${seq} invalid tracking sequences flagged`, body: `${q.summary.intentionalAnomalies} findings in total are labelled challenge anomalies.`, to: '/data-quality' });
  }
  return (
    <Panel title="Operational alerts" subtitle="Derived from ground-truth labels, disruption windows, queue observations and the latest validation run">
      {summary.loading && !summary.data ? (
        <QueryState query={summary}>{() => null}</QueryState>
      ) : items.length === 0 ? (
        <p className="text-[12.5px] text-muted">No alerts for the selected dataset.</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((a) => (
            <li key={a.title}>
              <Link to={a.to} className="-mx-2 flex items-start gap-3 rounded-md px-2 py-2.5 hover:bg-subtle">
                <ToneIcon tone={a.tone} icon={a.icon} />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink">{a.title}</span>
                  <span className="block truncate text-[12px] text-muted">{a.body}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function RecentEvents() {
  const events = useApiQuery('recent-events', (signal) => trackingApi.list({ limit: 8, sort: '-ingestedAt' }, { signal }));
  const columns = [
    { key: 'eventId', header: 'Event', render: (e) => <Mono>{e.eventId.slice(-13)}</Mono> },
    { key: 'shipmentId', header: 'Shipment', render: (e) => <ShipmentLink id={e.shipmentId} /> },
    { key: 'eventType', header: 'Type', render: (e) => humanize(e.eventType) },
    { key: 'facilityId', header: 'Facility', render: (e) => <FacilityLink id={e.facilityId} />, hideBelow: 'md' },
    { key: 'occurredAt', header: 'Occurred (UTC)', render: (e) => <span className="num">{formatDateTime(e.occurredAt)}</span> },
    { key: 'ingestedAt', header: 'Ingested (UTC)', render: (e) => <span className="num">{formatDateTime(e.ingestedAt)}</span>, hideBelow: 'lg' },
    {
      key: 'status',
      header: 'Status',
      render: (e) =>
        e.validation.length ? (
          <StatusBadge tone="crit" label={humanize(e.validation[0].ruleId)} />
        ) : e.isLateArrival ? (
          <StatusBadge tone="warn" label={`Late +${formatDuration(e.lagMinutes)}`} />
        ) : (
          <StatusBadge tone="good" label="Valid" />
        ),
    },
  ];
  return (
    <Panel
      title="Recent tracking activity"
      subtitle="Latest events by ingestion time"
      bodyClassName=""
      actions={
        <Link to="/tracking" className="text-[12px] font-medium text-cobalt-700 hover:underline">
          Explore events
        </Link>
      }
    >
      <DataTable columns={columns} rows={events.data} rowKey={(e) => e.eventId} loading={events.loading} error={events.error} onRetry={events.refetch} skeletonRows={8} dense />
    </Panel>
  );
}

export default function DashboardPage() {
  const [{ partition }, setFilters] = useUrlState({ partition: 'BASELINE' });
  const p = { partition };
  const summary = useApiQuery(`summary-${partition}`, (signal) => analyticsApi.summary(p, { signal }));
  const delays = useApiQuery(`delays-${partition}`, (signal) => analyticsApi.delays(p, { signal }));
  const delayBreak = useApiQuery(`delay-break-${partition}`, (signal) => analyticsApi.delayBreakdowns(p, { signal }));
  const eta = useApiQuery(`eta-acc-${partition}`, (signal) => etaApi.accuracy(p, { signal }));
  const etaBreak = useApiQuery(`eta-break-${partition}`, (signal) => etaApi.breakdowns(p, { signal }));
  const volume = useApiQuery(`volume-${partition}`, (signal) => analyticsApi.eventVolume(p, { signal }));
  const facilities = useApiQuery('facilities', (signal) => facilityApi.list({}, { signal }));
  const quality = useApiQuery('dq-latest', (signal) => qualityApi.latest({}, { signal }));
  const navigate = useNavigate();
  const dataset = summary.data?.dataset;

  if (summary.error && summary.error.network) return <ErrorState error={summary.error} onRetry={summary.refetch} />;

  return (
    <>
      <PageHeader
        title="Operations overview"
        description="Logistics visibility. Predictive decisions. Operational clarity."
        meta={
          dataset ? (
            <>
              <Tag>Seed {dataset.seed}</Tag>
              <Tag>Profile {dataset.profile}</Tag>
              <span className="num">
                Snapshot {formatDateTime(dataset.simulationWindow?.asOf, { year: true })} UTC
              </span>
              <span className="id-mono text-faint" title={dataset.datasetChecksum}>
                checksum {dataset.datasetChecksum?.slice(0, 12)}…
              </span>
            </>
          ) : null
        }
        actions={<SelectFilter label="Dataset partition" value={partition} onChange={(v) => setFilters({ partition: v || 'BASELINE' })} options={PARTITIONS} allLabel={null} className="w-52" />}
      />

      {!summary.loading && !dataset && !summary.error && (
        <div className="card mb-4 border-warn/40 bg-warn-soft px-4 py-3 text-[13px] text-warn-ink">
          No completed dataset found. <Link to="/generator" className="font-medium underline">Generate one</Link> to populate the platform.
        </div>
      )}

      <Kpis summary={summary} delays={delays} eta={eta} />

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="On-time vs delayed deliveries" subtitle="Delivered shipments by SLA deadline date" className="xl:col-span-2" info="Counts come from ground-truth labels of delivered shipments, grouped by the day of their SLA deadline (UTC).">
          <QueryState query={delayBreak} rows={6} isEmpty={(d) => !d?.overTime?.length}>
            {(d) => {
              const rows = d.overTime.map((r) => ({ date: r.date, onTime: r.delivered - r.delayed, delayed: r.delayed }));
              return (
                <ChartFrame
                  height={250}
                  summary={`Daily on-time and delayed deliveries over ${rows.length} days.`}
                  table={{ columns: ['Deadline date', 'On time', 'Delayed'], rows: rows.map((r) => [r.date, formatNumber(r.onTime), formatNumber(r.delayed)]) }}
                >
                  <ColumnChart
                    data={rows}
                    xKey="date"
                    xFormatter={formatDayTick}
                    stacked
                    series={[
                      { key: 'onTime', name: 'On time', color: CHART.good },
                      { key: 'delayed', name: 'Delayed', color: CHART.crit },
                    ]}
                  />
                </ChartFrame>
              );
            }}
          </QueryState>
        </Panel>
        <Alerts summary={summary} asOf={dataset?.simulationWindow?.asOf} facilities={facilities} quality={quality} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Panel title="Shipment status" subtitle="Operational status at snapshot time">
          <QueryState query={summary} isEmpty={(s) => !s || !Object.keys(s.shipmentStatus).length}>
            {(s) => {
              const rows = Object.entries(s.shipmentStatus).map(([status, count]) => ({ status: humanize(status), raw: status, count })).sort((a, b) => b.count - a.count);
              return (
                <ChartFrame height={rows.length * 30 + 30} summary={rows.map((r) => `${r.status}: ${r.count}`).join(', ')} table={{ columns: ['Status', 'Shipments'], rows: rows.map((r) => [r.status, formatNumber(r.count)]) }}>
                  <HBarChart data={rows} labelKey="status" valueKey="count" name="Shipments" labelWidth={118} onBarClick={(r) => navigate(`/shipments?status=${r.raw}`)} />
                </ChartFrame>
              );
            }}
          </QueryState>
        </Panel>
        <Panel title="Delay reasons" subtitle="Primary attributed reason of delayed shipments">
          <QueryState query={delays} isEmpty={(d) => !d?.reasons?.length} empty={<p className="text-[12.5px] text-muted">No delayed shipments.</p>}>
            {(d) => {
              const rows = d.reasons.filter((r) => r.primaryCount > 0).map((r) => ({ reason: humanize(r.reasonCode), raw: r.reasonCode, count: r.primaryCount }));
              return (
                <ChartFrame height={rows.length * 30 + 30} summary={rows.map((r) => `${r.reason}: ${r.count}`).join(', ')} table={{ columns: ['Reason', 'Shipments'], rows: rows.map((r) => [r.reason, formatNumber(r.count)]) }}>
                  <HBarChart data={rows} labelKey="reason" valueKey="count" name="Delayed shipments" labelWidth={136} onBarClick={(r) => navigate(`/delays?reason=${r.raw}`)} />
                </ChartFrame>
              );
            }}
          </QueryState>
        </Panel>
        <Panel title="Facility congestion" subtitle="Highest average queue wait (all observations)" info="Average of observed total queue wait (queue + weather surge) over every 4-hour observation of the facility.">
          <QueryState query={facilities} isEmpty={(f) => !f?.length}>
            {(f) => {
              const rows = [...f].filter((x) => x.queue).sort((a, b) => b.queue.avgWaitMinutes - a.queue.avgWaitMinutes).slice(0, 8).map((x) => ({ label: `${x.facilityId} ${x.city}`, id: x.facilityId, wait: x.queue.avgWaitMinutes }));
              return (
                <ChartFrame height={rows.length * 30 + 30} summary={rows.map((r) => `${r.label}: ${r.wait} minutes`).join(', ')} table={{ columns: ['Facility', 'Avg wait (min)'], rows: rows.map((r) => [r.label, r.wait]) }}>
                  <HBarChart data={rows} labelKey="label" valueKey="wait" name="Avg wait" valueFormatter={(v) => formatDuration(v)} axisFormatter={hoursTick} labelWidth={140} onBarClick={(r) => navigate(`/facilities/${r.id}`)} />
                </ChartFrame>
              );
            }}
          </QueryState>
        </Panel>
        <Panel title="Tracking event volume" subtitle="Events per day by occurrence time (UTC)" className="lg:col-span-2 xl:col-span-2">
          <QueryState query={volume} isEmpty={(v) => !v?.daily?.length}>
            {(v) => (
              <ChartFrame height={220} summary={`Daily tracking events across ${v.daily.length} days.`} table={{ columns: ['Date', 'Events', 'Avg ingestion lag (min)'], rows: v.daily.map((d) => [d.date, formatNumber(d.events), d.avgLagMinutes]) }}>
                <TimeAreaChart data={v.daily} xKey="date" xFormatter={formatDayTick} series={[{ key: 'events', name: 'Events', color: CHART.primary }]} />
              </ChartFrame>
            )}
          </QueryState>
        </Panel>
        <Panel title="ETA error distribution" subtitle="Estimated − actual, evaluated snapshots" info="Negative = estimate earlier than the actual delivery; positive = later. Only snapshots whose shipment has a known delivery time are evaluated.">
          <QueryState query={etaBreak} isEmpty={(d) => !d?.overall}>
            {(d) => (
              <ChartFrame height={220} summary={`ETA error histogram over ${d.overall.snapshots} snapshots.`} table={{ columns: ['Error bucket', 'Snapshots'], rows: d.errorHistogram.map((h) => [h.bucket, formatNumber(h.count)]) }}>
                <ColumnChart data={d.errorHistogram} xKey="bucket" series={[{ key: 'count', name: 'Snapshots', color: CHART.primary }]} />
              </ChartFrame>
            )}
          </QueryState>
        </Panel>
      </div>

      <div className="mt-4">
        <RecentEvents />
      </div>
      <p className="mt-4 text-[11.5px] text-faint">
        Labels such as on-time, delayed and at-risk are ground-truth evaluation data from the synthetic dataset; KPIs show the current snapshot only (no historical comparison period exists).
      </p>
    </>
  );
}
