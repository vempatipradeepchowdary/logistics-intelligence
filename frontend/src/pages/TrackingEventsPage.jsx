import { trackingApi } from '../api/index.js';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useUrlState } from '../hooks/useUrlState.js';
import { PageHeader } from '../components/common/Panel.jsx';
import { DataTable, Pagination } from '../components/common/DataTable.jsx';
import { DateRangeFilter, FilterBar, SearchInput, SelectFilter, ToggleFilter } from '../components/common/Filters.jsx';
import { StatusBadge, Tag } from '../components/common/StatusBadge.jsx';
import { FacilityLink, Mono, ShipmentLink } from '../components/common/Links.jsx';
import { InfoTip } from '../components/common/InfoTip.jsx';
import { EVENT_SOURCES, EVENT_TYPES, SEVERITY_TONE } from '../utils/domain.js';
import { formatDateTime, formatDuration, humanize, toIsoEnd, toIsoStart } from '../utils/format.js';

const DEFAULTS = {
  page: 1,
  limit: 50,
  eventType: '',
  source: '',
  shipmentId: '',
  facilityId: '',
  partition: '',
  timeField: 'occurredAt',
  from: '',
  to: '',
  late: '',
  flagged: '',
  sort: '-occurredAt',
};
const SHIPMENT_ID = /^SHP-\d{4}-\d{6}$/;
const FACILITY_ID = /^FAC-\d{3}$/;

export default function TrackingEventsPage() {
  const [f, update, reset] = useUrlState(DEFAULTS);
  const shipmentOk = !f.shipmentId || SHIPMENT_ID.test(f.shipmentId);
  const facilityOk = !f.facilityId || FACILITY_ID.test(f.facilityId);
  const params = {
    page: f.page,
    limit: f.limit,
    eventType: f.eventType,
    source: f.source,
    shipmentId: shipmentOk ? f.shipmentId : undefined,
    facilityId: facilityOk ? f.facilityId : undefined,
    partition: f.partition,
    timeField: f.timeField,
    from: toIsoStart(f.from),
    to: toIsoEnd(f.to),
    late: f.late || undefined,
    flagged: f.flagged || undefined,
    sort: f.sort,
  };
  const events = useApiQuery(JSON.stringify(params), (signal) => trackingApi.list(params, { signal }), { keepPreviousData: true });
  const activeCount = Object.entries(f).filter(([k, v]) => !['page', 'limit', 'sort', 'timeField'].includes(k) && v !== DEFAULTS[k]).length;
  const threshold = events.meta.lateThresholdMinutes ?? 360;

  const columns = [
    { key: 'eventId', header: 'Event ID', render: (e) => <Mono>{e.eventId}</Mono> },
    { key: 'shipmentId', header: 'Shipment', render: (e) => <ShipmentLink id={e.shipmentId} /> },
    { key: 'eventType', header: 'Type', render: (e) => humanize(e.eventType) },
    { key: 'facilityId', header: 'Facility', render: (e) => <FacilityLink id={e.facilityId} />, hideBelow: 'sm' },
    { key: 'leg', header: 'Leg', render: (e) => <Mono>{e.legId.slice(-2)}</Mono>, hideBelow: 'lg' },
    {
      key: 'occurredAt',
      header: (
        <span className="inline-flex items-center gap-1">
          Event time <InfoTip text="When the scan physically happened (occurredAt, UTC)." />
        </span>
      ),
      sortKey: 'occurredAt',
      render: (e) => <span className="num">{formatDateTime(e.occurredAt, { seconds: false })}</span>,
    },
    {
      key: 'ingestedAt',
      header: (
        <span className="inline-flex items-center gap-1">
          Ingestion time <InfoTip text="When the platform received the event (ingestedAt, UTC). ETAs may only use events ingested before their prediction time." />
        </span>
      ),
      sortKey: 'ingestedAt',
      render: (e) => <span className="num">{formatDateTime(e.ingestedAt)}</span>,
      hideBelow: 'md',
    },
    {
      key: 'lag',
      header: 'Lag',
      align: 'right',
      render: (e) =>
        e.lagMinutes < 0 ? (
          <StatusBadge tone="crit" label={formatDuration(e.lagMinutes)} />
        ) : e.isLateArrival ? (
          <StatusBadge tone="warn" label={`+${formatDuration(e.lagMinutes)}`} />
        ) : (
          <span className="text-ink-2">+{formatDuration(e.lagMinutes)}</span>
        ),
    },
    { key: 'source', header: 'Source', render: (e) => <Tag>{humanize(e.source)}</Tag>, hideBelow: 'xl' },
    {
      key: 'validation',
      header: 'Validation',
      render: (e) =>
        e.validation.length ? (
          <span className="flex flex-wrap gap-1">
            {e.validation.map((v) => (
              <StatusBadge key={v.ruleId} tone={SEVERITY_TONE[v.severity]} label={humanize(v.ruleId)} />
            ))}
          </span>
        ) : events.meta.validationRunId ? (
          <StatusBadge tone="good" label="Passed" />
        ) : (
          <span className="text-faint">Not validated</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Tracking events"
        description={`Server-side exploration of every scan. Event time is when it happened; ingestion time is when the platform received it. Lags above ${formatDuration(threshold)} are late arrivals.`}
      />
      <section className="card animate-in" aria-label="Tracking events table">
        <FilterBar onReset={reset} activeCount={activeCount}>
          <SearchInput
            label="Shipment ID (exact)"
            value={f.shipmentId}
            onChange={(v) => update({ shipmentId: v.toUpperCase() })}
            placeholder="SHP-2026-000123"
            pattern={/^[A-Za-z0-9-]{0,15}$/}
            className="w-48"
          />
          <SearchInput
            label="Facility ID"
            value={f.facilityId}
            onChange={(v) => update({ facilityId: v.toUpperCase() })}
            placeholder="FAC-001"
            pattern={/^[A-Za-z0-9-]{0,7}$/}
            className="w-32"
          />
          <SelectFilter label="Event type" value={f.eventType} onChange={(eventType) => update({ eventType })} options={EVENT_TYPES} className="w-48" />
          <SelectFilter label="Source" value={f.source} onChange={(source) => update({ source })} options={EVENT_SOURCES} className="w-40" />
          <SelectFilter
            label="Partition"
            value={f.partition}
            onChange={(partition) => update({ partition })}
            options={[
              { value: 'BASELINE', label: 'Baseline' },
              { value: 'ANOMALY', label: 'Anomaly cases' },
            ]}
            className="w-36"
          />
          <SelectFilter
            label="Range applies to"
            value={f.timeField}
            onChange={(timeField) => update({ timeField: timeField || 'occurredAt' })}
            options={[
              { value: 'occurredAt', label: 'Event time' },
              { value: 'ingestedAt', label: 'Ingestion time' },
            ]}
            allLabel={null}
            className="w-36"
          />
          <DateRangeFilter from={f.from} to={f.to} onChange={({ from, to }) => update({ from, to })} />
          <ToggleFilter label="Late arrivals only" checked={f.late === 'true'} onChange={(v) => update({ late: v ? 'true' : '' })} />
          <ToggleFilter label="Validation-flagged only" checked={f.flagged === 'true'} onChange={(v) => update({ flagged: v ? 'true' : '' })} />
        </FilterBar>
        {(!shipmentOk || !facilityOk) && (
          <p className="border-b border-line bg-warn-soft px-3 py-2 text-[12px] text-warn-ink" role="status">
            {!shipmentOk ? 'Shipment filter needs a full ID like SHP-2026-000123. ' : ''}
            {!facilityOk ? 'Facility filter needs an ID like FAC-001.' : ''} The incomplete filter is not applied.
          </p>
        )}
        <DataTable
          caption="Tracking events"
          columns={columns}
          rows={events.data}
          rowKey={(e) => e.eventId}
          loading={events.loading}
          error={events.error}
          onRetry={events.refetch}
          sort={f.sort}
          onSortChange={(sort) => update({ sort })}
          emptyTitle="No events match these filters"
          dense
        />
        <Pagination
          page={f.page}
          limit={f.limit}
          total={events.meta.total}
          totalPages={events.meta.totalPages}
          onPageChange={(page) => update({ page })}
          onLimitChange={(limit) => update({ limit })}
          pageSizes={[25, 50, 100, 200]}
        />
      </section>
    </>
  );
}
