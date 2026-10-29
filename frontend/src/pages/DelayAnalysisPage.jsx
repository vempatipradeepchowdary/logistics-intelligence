import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Clock, Percent, TrendingDown } from 'lucide-react';
import { analyticsApi } from '../api/index.js';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useUrlState } from '../hooks/useUrlState.js';
import { PageHeader, Panel } from '../components/common/Panel.jsx';
import { MetricCard } from '../components/common/MetricCard.jsx';
import { QueryState } from '../components/common/States.jsx';
import { DataTable, Pagination } from '../components/common/DataTable.jsx';
import { DateRangeFilter, FilterBar, SelectFilter } from '../components/common/Filters.jsx';
import { StatusBadge, Tag } from '../components/common/StatusBadge.jsx';
import { Mono, ShipmentLink } from '../components/common/Links.jsx';
import { CHART, ChartFrame, HBarChart, TimeLineChart } from '../components/charts/ChartKit.jsx';
import { DELAY_LABEL, DELAY_REASONS, DELAY_TONE, SHIPMENT_STATUSES, STATUS_TONE } from '../utils/domain.js';
import { formatDateTime, formatDayTick, formatDuration, formatNumber, formatPercent, humanize, toIsoEnd, toIsoStart } from '../utils/format.js';

const CLASS_TABS = [
  { value: 'DELAYED', label: 'Actual delays', hint: 'Delivered late, or undelivered past the SLA deadline' },
  { value: 'AT_RISK', label: 'At-risk predictions', hint: 'Undelivered; ETA within the service buffer of the deadline' },
  { value: 'OPERATIONAL_EXCEPTION', label: 'Operational exceptions', hint: 'Open DAMAGED exception hold' },
  { value: 'INSUFFICIENT_DATA', label: 'Insufficient data', hint: 'Outcome cannot be established (e.g. never picked up)' },
];
const DEFAULTS = { page: 1, limit: 25, class: 'DELAYED', reason: '', carrierId: '', serviceLevelId: '', status: '', from: '', to: '', sort: '-delayMinutes' };

export default function DelayAnalysisPage() {
  const navigate = useNavigate();
  const [f, update, reset] = useUrlState(DEFAULTS);
  const delays = useApiQuery('delays-BASELINE', (signal) => analyticsApi.delays({ partition: 'BASELINE' }, { signal }));
  const breakdowns = useApiQuery('delay-break-BASELINE', (signal) => analyticsApi.delayBreakdowns({ partition: 'BASELINE' }, { signal }));
  const params = {
    page: f.page,
    limit: f.limit,
    delayClass: f.class,
    reasonCode: f.class === 'DELAYED' ? f.reason : undefined,
    carrierId: f.carrierId,
    serviceLevelId: f.serviceLevelId,
    status: f.status,
    from: toIsoStart(f.from),
    to: toIsoEnd(f.to),
    sort: f.sort,
  };
  const list = useApiQuery(JSON.stringify(params), (signal) => analyticsApi.classifiedShipments(params, { signal }), { keepPreviousData: true });

  const d = delays.data;
  const delayedCount = d?.delayClasses?.DELAYED ?? 0;
  const delayRate = d?.deliveredShipments ? (breakdowns.data?.byCarrier ?? []).reduce((s, c) => s + c.delayed, 0) / d.deliveredShipments : null;
  const carriers = (breakdowns.data?.byCarrier ?? []).map((c) => c.carrierId);
  const serviceLevels = (d?.onTimeByServiceLevel ?? []).map((s) => s.serviceLevelId);
  const activeCount = ['reason', 'carrierId', 'serviceLevelId', 'status', 'from', 'to'].filter((k) => f[k]).length;

  const columns = [
    { key: 'shipmentId', header: 'Shipment', sortKey: 'shipmentId', render: (r) => <ShipmentLink id={r.shipmentId} /> },
    { key: 'class', header: 'Classification', render: (r) => <StatusBadge tone={DELAY_TONE[r.delayClass]} label={DELAY_LABEL[r.delayClass]} /> },
    { key: 'reason', header: 'Primary reason', render: (r) => (r.primaryReasonCode ? humanize(r.primaryReasonCode) : '—'), hideBelow: 'sm' },
    { key: 'delay', header: 'Delay', align: 'right', sortKey: 'delayMinutes', render: (r) => (r.delayMinutes ? formatDuration(r.delayMinutes) : '—') },
    { key: 'deadline', header: 'SLA deadline', sortKey: 'promisedDeliveryAt', render: (r) => <span className="num">{formatDateTime(r.promisedDeliveryAt)}</span>, hideBelow: 'md' },
    { key: 'actual', header: 'Delivered', render: (r) => <span className="num">{formatDateTime(r.actualDeliveredAt)}</span>, hideBelow: 'lg' },
    { key: 'carrier', header: 'Carrier', render: (r) => <Mono>{r.shipment.carrierId}</Mono>, hideBelow: 'md' },
    { key: 'sl', header: 'Service', render: (r) => <Tag>{r.shipment.serviceLevelId}</Tag>, hideBelow: 'lg' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge tone={STATUS_TONE[r.shipment.status]} value={r.shipment.status} />, hideBelow: 'xl' },
  ];

  return (
    <>
      <PageHeader
        title="Delay analysis"
        description="Ground-truth delay outcomes from documented rules, with attributed reasons from recorded weather, queue, carrier, reroute and delivery-attempt components. Baseline partition."
      />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard label="Delayed shipments" icon={TrendingDown} tone="crit" loading={delays.loading} error={Boolean(delays.error)} value={formatNumber(delayedCount)} context="delivered late or overdue" info="Ground-truth label DELAYED." />
        <MetricCard label="Delay rate" icon={Percent} tone="crit" loading={breakdowns.loading || delays.loading} error={Boolean(breakdowns.error)} value={formatPercent(delayRate)} context={d ? `of ${formatNumber(d.deliveredShipments)} delivered` : ''} info="Delivered shipments labelled DELAYED divided by all delivered shipments." />
        <MetricCard label="Average delay" icon={Clock} loading={delays.loading} error={Boolean(delays.error)} value={formatDuration(d?.avgLatenessMinutesOfLateDeliveries)} context="late deliveries only" info="Mean lateness versus the SLA deadline across late deliveries." />
        <MetricCard label="At risk (prediction)" icon={AlertTriangle} tone="warn" loading={delays.loading} error={Boolean(delays.error)} value={formatNumber(d?.delayClasses?.AT_RISK ?? 0)} context="not yet late" info="Undelivered shipments whose ETA at the snapshot is within the deadline buffer. A forecast, not an actual delay." />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Delay reasons" subtitle="Primary reason per delayed shipment; click to filter the table">
          <QueryState query={delays} isEmpty={(x) => !x?.reasons?.length}>
            {(x) => {
              const rows = x.reasons.filter((r) => r.primaryCount).map((r) => ({ label: humanize(r.reasonCode), raw: r.reasonCode, count: r.primaryCount, avg: r.avgAttributedMinutes }));
              return (
                <ChartFrame height={rows.length * 30 + 30} summary={rows.map((r) => `${r.label}: ${r.count}`).join(', ')} table={{ columns: ['Reason', 'Primary for', 'Avg attributed'], rows: rows.map((r) => [r.label, formatNumber(r.count), formatDuration(r.avg)]) }}>
                  <HBarChart data={rows} labelKey="label" valueKey="count" name="Shipments" labelWidth={140} onBarClick={(r) => update({ class: 'DELAYED', reason: r.raw })} />
                </ChartFrame>
              );
            }}
          </QueryState>
        </Panel>
        <Panel title="Delay rate by carrier" subtitle="Share of delivered shipments that were late">
          <QueryState query={breakdowns} isEmpty={(b) => !b?.byCarrier?.length}>
            {(b) => (
              <ChartFrame height={b.byCarrier.length * 30 + 30} summary={b.byCarrier.map((c) => `${c.carrierId}: ${formatPercent(c.delayRate)}`).join(', ')} table={{ columns: ['Carrier', 'Delivered', 'Delayed', 'Rate', 'Avg delay'], rows: b.byCarrier.map((c) => [c.carrierId, formatNumber(c.delivered), formatNumber(c.delayed), formatPercent(c.delayRate), formatDuration(c.avgDelayMinutes)]) }}>
                <HBarChart data={b.byCarrier} labelKey="carrierId" valueKey="delayRate" name="Delay rate" valueFormatter={(v) => formatPercent(v)} axisFormatter={(v) => formatPercent(v, 0)} color={CHART.crit} labelWidth={70} onBarClick={(c) => update({ class: 'DELAYED', carrierId: c.carrierId })} />
              </ChartFrame>
            )}
          </QueryState>
        </Panel>
        <Panel title="Delay rate over time" subtitle="By SLA deadline date (UTC)">
          <QueryState query={breakdowns} isEmpty={(b) => !b?.overTime?.length}>
            {(b) => (
              <ChartFrame height={230} summary={`Daily delay rate across ${b.overTime.length} days.`} table={{ columns: ['Date', 'Delivered', 'Delayed', 'Rate'], rows: b.overTime.map((r) => [r.date, formatNumber(r.delivered), formatNumber(r.delayed), formatPercent(r.delayRate)]) }}>
                <TimeLineChart data={b.overTime} xKey="date" xFormatter={formatDayTick} valueFormatter={(v) => formatPercent(v)} yFormatter={(v) => `${Math.round(v * 100)}%`} series={[{ key: 'delayRate', name: 'Delay rate', color: CHART.crit }]} />
              </ChartFrame>
            )}
          </QueryState>
        </Panel>
        <Panel title="Facilities most cited in delays" subtitle="Primary weather / congestion attributions naming the facility" info={breakdowns.data?.note}>
          <QueryState query={breakdowns} isEmpty={(b) => !b?.byFacility?.length}>
            {(b) => (
              <ChartFrame height={Math.min(10, b.byFacility.length) * 28 + 30} summary={b.byFacility.map((r) => `${r.facilityId}: ${r.primaryAttributions}`).join(', ')} table={{ columns: ['Facility', 'Primary attributions'], rows: b.byFacility.map((r) => [r.facilityId, r.primaryAttributions]) }}>
                <HBarChart data={b.byFacility.slice(0, 10)} labelKey="facilityId" valueKey="primaryAttributions" name="Attributions" labelWidth={70} onBarClick={(r) => navigate(`/facilities/${r.facilityId}`)} />
              </ChartFrame>
            )}
          </QueryState>
        </Panel>
      </div>

      <section className="card animate-in mt-4" aria-label="Classified shipments">
        <div className="flex flex-wrap gap-1 border-b border-line px-3 pt-3" role="tablist" aria-label="Classification">
          {CLASS_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={f.class === t.value}
              title={t.hint}
              onClick={() => update({ class: t.value, reason: '' })}
              className={`-mb-px rounded-t-md border px-3 py-1.5 text-[12.5px] font-medium ${
                f.class === t.value ? 'border-line border-b-surface bg-surface text-ink' : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {t.label}
              <span className="num ml-1.5 text-faint">{formatNumber(d?.delayClasses?.[t.value] ?? 0)}</span>
            </button>
          ))}
        </div>
        <FilterBar onReset={() => reset()} activeCount={activeCount}>
          {f.class === 'DELAYED' && <SelectFilter label="Primary reason" value={f.reason} onChange={(reason) => update({ reason })} options={DELAY_REASONS} className="w-48" />}
          <SelectFilter label="Carrier" value={f.carrierId} onChange={(carrierId) => update({ carrierId })} options={carriers} format={(x) => x} className="w-32" />
          <SelectFilter label="Service level" value={f.serviceLevelId} onChange={(serviceLevelId) => update({ serviceLevelId })} options={serviceLevels} format={(x) => x} className="w-36" />
          <SelectFilter label="Shipment status" value={f.status} onChange={(status) => update({ status })} options={SHIPMENT_STATUSES} className="w-40" />
          <DateRangeFilter label="SLA deadline (UTC)" from={f.from} to={f.to} onChange={({ from, to }) => update({ from, to })} />
        </FilterBar>
        <DataTable
          columns={columns}
          rows={list.data}
          rowKey={(r) => r.shipmentId}
          loading={list.loading}
          error={list.error}
          onRetry={list.refetch}
          sort={f.sort}
          onSortChange={(sort) => update({ sort: sort === '-shipmentId' ? 'shipmentId' : sort })}
          emptyTitle="No shipments with this classification match the filters"
        />
        <Pagination page={f.page} limit={f.limit} total={list.meta.total} totalPages={list.meta.totalPages} onPageChange={(page) => update({ page })} onLimitChange={(limit) => update({ limit })} />
      </section>
      <p className="mt-3 text-[11.5px] text-faint">
        Actual delays and at-risk predictions are ground-truth labels; data-quality anomalies are reported separately on the{' '}
        <Link to="/data-quality" className="text-cobalt-700 hover:underline">
          Data Quality
        </Link>{' '}
        page.
      </p>
    </>
  );
}
