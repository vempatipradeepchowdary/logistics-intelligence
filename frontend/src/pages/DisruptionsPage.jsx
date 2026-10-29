import { disruptionApi } from '../api/index.js';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useUrlState } from '../hooks/useUrlState.js';
import { PageHeader, Panel } from '../components/common/Panel.jsx';
import { QueryState } from '../components/common/States.jsx';
import { DataTable, Pagination } from '../components/common/DataTable.jsx';
import { DateRangeFilter, FilterBar, SearchInput, SelectFilter } from '../components/common/Filters.jsx';
import { StatusBadge, Tag } from '../components/common/StatusBadge.jsx';
import { DisruptionLink, FacilityLink } from '../components/common/Links.jsx';
import { InfoTip } from '../components/common/InfoTip.jsx';
import { CHART, ChartFrame, ColumnChart } from '../components/charts/ChartKit.jsx';
import { WEATHER_TYPES, weatherSeverityTone } from '../utils/domain.js';
import { formatDateTime, formatDayTick, formatDuration, formatNumber, humanize, toIsoEnd, toIsoStart } from '../utils/format.js';

const DEFAULTS = { page: 1, limit: 25, weatherType: '', severity: '', advisoryType: '', facilityId: '', from: '', to: '', sort: '-startAt' };
const SEVERITY_SERIES = [1, 2, 3, 4, 5].map((s, i) => ({ key: String(s), name: `Severity ${s}`, color: CHART.sequential[i] }));

export default function DisruptionsPage() {
  const [f, update, reset] = useUrlState(DEFAULTS);
  const facilityOk = !f.facilityId || /^FAC-\d{3}$/.test(f.facilityId);
  const params = {
    page: f.page,
    limit: f.limit,
    weatherType: f.weatherType,
    severity: f.severity,
    advisoryType: f.advisoryType,
    facilityId: facilityOk ? f.facilityId : undefined,
    from: toIsoStart(f.from),
    to: toIsoEnd(f.to),
    sort: f.sort,
  };
  const list = useApiQuery(JSON.stringify(params), (signal) => disruptionApi.list(params, { signal }), { keepPreviousData: true });
  const timeline = useApiQuery('disruption-timeline', (signal) => disruptionApi.timeline({ signal }));
  const activeCount = ['weatherType', 'severity', 'advisoryType', 'facilityId', 'from', 'to'].filter((k) => f[k]).length;

  const columns = [
    { key: 'id', header: 'Window', sortKey: 'weatherEventId', render: (w) => <DisruptionLink id={w.weatherEventId} /> },
    { key: 'type', header: 'Type', render: (w) => humanize(w.weatherType) },
    { key: 'severity', header: 'Severity', sortKey: 'severity', render: (w) => <StatusBadge tone={weatherSeverityTone(w.severity)} label={`S${w.severity}`} /> },
    { key: 'center', header: 'Center', render: (w) => <FacilityLink id={w.centerFacilityId} />, hideBelow: 'md' },
    { key: 'affected', header: 'Facilities', align: 'right', render: (w) => w.affectedFacilityIds.length, hideBelow: 'sm' },
    { key: 'start', header: 'Start (UTC)', sortKey: 'startAt', render: (w) => <span className="num">{formatDateTime(w.startAt)}</span> },
    { key: 'duration', header: 'Duration', align: 'right', render: (w) => formatDuration(w.durationMinutes), hideBelow: 'md' },
    {
      key: 'advisory',
      header: (
        <span className="inline-flex items-center gap-1">
          Advisory <InfoTip text="FORECAST advisories were issued before the window started; NOWCASTs only after it began. The ETA engine may use an advisory only once it was ingested." />
        </span>
      ),
      render: (w) => (
        <span className="flex flex-col leading-4">
          <Tag>{humanize(w.advisoryType)}</Tag>
          <span className="num mt-0.5 text-[11px] text-faint">
            {w.advisoryLeadMinutes > 0 ? `${formatDuration(w.advisoryLeadMinutes)} ahead` : `${formatDuration(-w.advisoryLeadMinutes)} after start`}
          </span>
        </span>
      ),
      hideBelow: 'lg',
    },
    {
      key: 'impact',
      header: (
        <span className="inline-flex items-center gap-1">
          Shipments impacted <InfoTip text="Distinct shipments whose completed legs recorded weather delay attributed to this window." />
        </span>
      ),
      align: 'right',
      render: (w) => formatNumber(w.impact.shipments),
    },
    { key: 'minutes', header: 'Weather delay', align: 'right', render: (w) => formatDuration(w.impact.weatherMinutes), hideBelow: 'xl' },
  ];

  return (
    <>
      <PageHeader
        title="Disruptions"
        description="Weather disruption windows of the synthetic dataset (historical records, not a live weather feed), with their recorded impact on shipment legs."
      />
      <Panel title="Active disruption windows per day" subtitle="Windows overlapping each UTC day, stacked by severity (1 = minor, 5 = severe)">
        <QueryState query={timeline} isEmpty={(t) => !t?.length}>
          {(t) => (
            <ChartFrame
              height={220}
              summary={`Active disruption windows per day across ${t.length} days, by severity.`}
              table={{ columns: ['Date', 'S1', 'S2', 'S3', 'S4', 'S5'], rows: t.map((d) => [d.date, d[1], d[2], d[3], d[4], d[5]]) }}
            >
              <ColumnChart data={t} xKey="date" xFormatter={formatDayTick} stacked series={SEVERITY_SERIES} />
            </ChartFrame>
          )}
        </QueryState>
      </Panel>
      <section className="card animate-in mt-4" aria-label="Disruption windows">
        <FilterBar onReset={reset} activeCount={activeCount}>
          <SelectFilter label="Type" value={f.weatherType} onChange={(weatherType) => update({ weatherType })} options={WEATHER_TYPES} className="w-40" />
          <SelectFilter label="Severity" value={f.severity} onChange={(severity) => update({ severity })} options={['1', '2', '3', '4', '5'].map((s) => ({ value: s, label: `Severity ${s}` }))} className="w-32" />
          <SelectFilter label="Advisory" value={f.advisoryType} onChange={(advisoryType) => update({ advisoryType })} options={['FORECAST', 'NOWCAST']} className="w-32" />
          <SearchInput label="Affected facility" value={f.facilityId} onChange={(v) => update({ facilityId: v.toUpperCase() })} placeholder="FAC-001" className="w-32" />
          <DateRangeFilter label="Active between (UTC)" from={f.from} to={f.to} onChange={({ from, to }) => update({ from, to })} />
        </FilterBar>
        <DataTable
          columns={columns}
          rows={list.data}
          rowKey={(w) => w.weatherEventId}
          loading={list.loading}
          error={list.error}
          onRetry={list.refetch}
          sort={f.sort}
          onSortChange={(sort) => update({ sort: sort === 'severity' ? '-severity' : sort === '-weatherEventId' ? 'weatherEventId' : sort })}
          emptyTitle="No disruption windows match these filters"
          dense
        />
        <Pagination page={f.page} limit={f.limit} total={list.meta.total} totalPages={list.meta.totalPages} onPageChange={(page) => update({ page })} onLimitChange={(limit) => update({ limit })} />
      </section>
    </>
  );
}
