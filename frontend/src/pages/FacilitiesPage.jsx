import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { facilityApi } from '../api/index.js';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useUrlState } from '../hooks/useUrlState.js';
import { PageHeader } from '../components/common/Panel.jsx';
import { DataTable } from '../components/common/DataTable.jsx';
import { FilterBar, SearchInput, SelectFilter } from '../components/common/Filters.jsx';
import { StatusBadge, Tag } from '../components/common/StatusBadge.jsx';
import { FacilityLink } from '../components/common/Links.jsx';
import { InfoTip } from '../components/common/InfoTip.jsx';
import { CONGESTION_TONE, FACILITY_TYPES, weatherSeverityTone } from '../utils/domain.js';
import { formatDateTime, formatDuration, formatNumber, formatPercent, humanize } from '../utils/format.js';

const DEFAULTS = { q: '', type: '', region: '', congestion: '', sort: 'facilityId' };
const SORTERS = {
  facilityId: (a, b) => a.facilityId.localeCompare(b.facilityId),
  '-facilityId': (a, b) => b.facilityId.localeCompare(a.facilityId),
  '-avgWait': (a, b) => (b.queue?.avgWaitMinutes ?? 0) - (a.queue?.avgWaitMinutes ?? 0),
  avgWait: (a, b) => (a.queue?.avgWaitMinutes ?? 0) - (b.queue?.avgWaitMinutes ?? 0),
  '-volume': (a, b) => b.shipmentsOriginating + b.shipmentsTerminating - (a.shipmentsOriginating + a.shipmentsTerminating),
  volume: (a, b) => a.shipmentsOriginating + a.shipmentsTerminating - (b.shipmentsOriginating + b.shipmentsTerminating),
  '-disruptions': (a, b) => b.disruptions.disruptions - a.disruptions.disruptions,
  disruptions: (a, b) => a.disruptions.disruptions - b.disruptions.disruptions,
};

export default function FacilitiesPage() {
  const [f, update, reset] = useUrlState(DEFAULTS);
  // 100 facilities: one request, then filter/sort in memory (no large collection involved).
  const facilities = useApiQuery('facilities', (signal) => facilityApi.list({}, { signal }));
  const regions = useMemo(() => [...new Set((facilities.data ?? []).map((x) => x.region))].sort(), [facilities.data]);
  const rows = useMemo(() => {
    const needle = f.q.toLowerCase();
    return (facilities.data ?? [])
      .filter((x) => !f.type || x.type === f.type)
      .filter((x) => !f.region || x.region === f.region)
      .filter((x) => !needle || `${x.facilityId} ${x.name} ${x.city}`.toLowerCase().includes(needle))
      .filter((x) => !f.congestion || (f.congestion === 'HIGH' ? ['HIGH', 'SEVERE'].includes(x.latestQueueObservation?.congestionLevel) : x.latestQueueObservation?.congestionLevel === f.congestion))
      .sort(SORTERS[f.sort] ?? SORTERS.facilityId);
  }, [facilities.data, f]);
  const activeCount = ['q', 'type', 'region', 'congestion'].filter((k) => f[k]).length;

  const columns = [
    { key: 'facilityId', header: 'Facility', sortKey: 'facilityId', render: (x) => <FacilityLink id={x.facilityId} /> },
    { key: 'name', header: 'Name', render: (x) => <span className="text-ink">{x.name}</span> },
    { key: 'type', header: 'Type', render: (x) => <Tag>{humanize(x.type)}</Tag>, hideBelow: 'sm' },
    { key: 'location', header: 'Location', render: (x) => `${x.city}, ${x.stateCode}`, hideBelow: 'md' },
    {
      key: 'latest',
      header: (
        <span className="inline-flex items-center gap-1">
          Latest queue <InfoTip text="Most recent 4-hour observation ingested by the dataset snapshot (not a live feed)." />
        </span>
      ),
      render: (x) =>
        x.latestQueueObservation ? (
          <span className="flex items-center gap-2">
            <StatusBadge tone={CONGESTION_TONE[x.latestQueueObservation.congestionLevel]} value={x.latestQueueObservation.congestionLevel} />
            <span className="num text-ink-2">{formatDuration(x.latestQueueObservation.estimatedWaitMinutes)}</span>
          </span>
        ) : (
          '—'
        ),
    },
    { key: 'avg', header: 'Avg wait', align: 'right', sortKey: 'avgWait', render: (x) => formatDuration(x.queue?.avgWaitMinutes), hideBelow: 'lg' },
    { key: 'congested', header: 'Congested share', align: 'right', render: (x) => formatPercent(x.queue?.congestedShare), hideBelow: 'xl' },
    {
      key: 'disruptions',
      header: 'Disruptions',
      align: 'right',
      sortKey: 'disruptions',
      render: (x) =>
        x.disruptions.disruptions ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="num">{x.disruptions.disruptions}</span>
            <StatusBadge tone={weatherSeverityTone(x.disruptions.maxSeverity)} label={`max S${x.disruptions.maxSeverity}`} icon={false} />
          </span>
        ) : (
          0
        ),
      hideBelow: 'md',
    },
    { key: 'volume', header: 'Shipments (orig/dest)', align: 'right', sortKey: 'volume', render: (x) => `${formatNumber(x.shipmentsOriginating)} / ${formatNumber(x.shipmentsTerminating)}`, hideBelow: 'lg' },
    { key: 'events', header: 'Events', align: 'right', render: (x) => formatNumber(x.trackingEvents), hideBelow: 'xl' },
  ];

  return (
    <>
      <PageHeader
        title="Facilities"
        description="The 100-facility network: 14 hubs, 16 sort centers and 70 delivery stations, with queue statistics from 4-hourly observations and the disruption windows that affected each site."
        meta={facilities.meta.asOf ? <span className="num">Dataset snapshot {formatDateTime(facilities.meta.asOf, { year: true })} UTC</span> : null}
      />
      <section className="card animate-in" aria-label="Facilities">
        <FilterBar onReset={reset} activeCount={activeCount}>
          <SearchInput label="Search" value={f.q} onChange={(q) => update({ q })} placeholder="ID, name or city" className="w-52" delay={150} />
          <SelectFilter label="Type" value={f.type} onChange={(type) => update({ type })} options={FACILITY_TYPES} className="w-40" />
          <SelectFilter label="Region" value={f.region} onChange={(region) => update({ region })} options={regions} className="w-40" />
          <SelectFilter
            label="Latest congestion"
            value={f.congestion}
            onChange={(congestion) => update({ congestion })}
            options={[
              { value: 'HIGH', label: 'High or severe' },
              { value: 'MODERATE', label: 'Moderate' },
              { value: 'LOW', label: 'Low' },
            ]}
            className="w-40"
          />
        </FilterBar>
        <DataTable
          columns={columns}
          rows={facilities.data ? rows : undefined}
          rowKey={(x) => x.facilityId}
          loading={facilities.loading}
          error={facilities.error}
          onRetry={facilities.refetch}
          sort={f.sort}
          onSortChange={(sort) => update({ sort })}
          emptyTitle="No facilities match these filters"
          dense
        />
        {facilities.data && (
          <p className="border-t border-line px-3 py-2.5 text-[12px] text-muted">
            {rows.length} of {facilities.data.length} facilities. <Link to="/disruptions" className="text-cobalt-700 hover:underline">View disruptions</Link>
          </p>
        )}
      </section>
    </>
  );
}
