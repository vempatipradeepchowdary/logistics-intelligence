import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { analyticsApi, facilityApi, shipmentApi } from '../api/index.js';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useUrlState } from '../hooks/useUrlState.js';
import { PageHeader } from '../components/common/Panel.jsx';
import { DataTable, Pagination } from '../components/common/DataTable.jsx';
import { DateRangeFilter, FilterBar, SearchInput, SelectFilter } from '../components/common/Filters.jsx';
import { StatusBadge } from '../components/common/StatusBadge.jsx';
import { FacilityLink, Mono, ShipmentLink } from '../components/common/Links.jsx';
import { InfoTip } from '../components/common/InfoTip.jsx';
import { DELAY_CLASSES, DELAY_LABEL, DELAY_TONE, SHIPMENT_STATUSES, STATUS_TONE } from '../utils/domain.js';
import { formatDateTime, formatDuration, humanize, toIsoEnd, toIsoStart } from '../utils/format.js';

const DEFAULTS = {
  page: 1,
  limit: 25,
  q: '',
  status: '',
  carrierId: '',
  serviceLevelId: '',
  originFacilityId: '',
  destinationFacilityId: '',
  delayClass: '',
  partition: '',
  from: '',
  to: '',
  sort: 'shipmentId',
};

export default function ShipmentsPage() {
  const [f, update, reset] = useUrlState(DEFAULTS);
  const params = {
    page: f.page,
    limit: f.limit,
    q: f.q,
    status: f.status,
    carrierId: f.carrierId,
    serviceLevelId: f.serviceLevelId,
    originFacilityId: f.originFacilityId,
    destinationFacilityId: f.destinationFacilityId,
    delayClass: f.delayClass,
    partition: f.partition,
    createdFrom: toIsoStart(f.from),
    createdTo: toIsoEnd(f.to),
    sort: f.sort,
  };
  const key = JSON.stringify(params);
  const shipments = useApiQuery(key, (signal) => shipmentApi.list(params, { signal }), { keepPreviousData: true });
  const summary = useApiQuery('summary-ALL', (signal) => analyticsApi.summary({ partition: 'ALL' }, { signal }));
  const facilities = useApiQuery('facilities', (signal) => facilityApi.list({}, { signal }));

  const carriers = Object.keys(summary.data?.carrierMix ?? {}).filter((c) => c !== 'null');
  const serviceLevels = Object.keys(summary.data?.serviceLevelMix ?? {});
  const stations = (facilities.data ?? [])
    .filter((x) => x.type === 'DELIVERY_STATION')
    .map((x) => ({ value: x.facilityId, label: `${x.facilityId} · ${x.city}` }));
  const activeCount = Object.entries(f).filter(([k, v]) => !['page', 'limit', 'sort'].includes(k) && v !== DEFAULTS[k]).length;

  const columns = [
    { key: 'shipmentId', header: 'Shipment', sortKey: 'shipmentId', render: (s) => <ShipmentLink id={s.shipmentId} /> },
    { key: 'origin', header: 'Origin', render: (s) => <FacilityLink id={s.originFacilityId} />, hideBelow: 'md' },
    { key: 'destination', header: 'Destination', render: (s) => <FacilityLink id={s.destinationFacilityId} />, hideBelow: 'md' },
    { key: 'carrierId', header: 'Carrier', render: (s) => <Mono>{s.carrierId}</Mono>, hideBelow: 'lg' },
    { key: 'status', header: 'Status', render: (s) => <StatusBadge tone={STATUS_TONE[s.status]} value={s.status} /> },
    {
      key: 'promised',
      header: 'Planned delivery',
      sortKey: 'promisedDeliveryAt',
      render: (s) => <span className="num">{formatDateTime(s.promisedDeliveryAt)}</span>,
      hideBelow: 'sm',
    },
    {
      key: 'eta',
      header: (
        <span className="inline-flex items-center gap-1">
          Latest ETA <InfoTip text="Most recent ETA snapshot (its prediction time is shown below the estimate). Delivered shipments show the last pre-delivery estimate." />
        </span>
      ),
      render: (s) =>
        s.latestEta ? (
          <span className="flex flex-col leading-4">
            <span className="num">{formatDateTime(s.latestEta.estimatedArrivalAt)}</span>
            <span className="num text-[11px] text-faint">as of {formatDateTime(s.latestEta.predictionAt)}</span>
          </span>
        ) : (
          '—'
        ),
      hideBelow: 'lg',
    },
    {
      key: 'delay',
      header: (
        <span className="inline-flex items-center gap-1">
          Delay status <InfoTip text="Ground-truth evaluation label at the dataset snapshot (not an operational prediction)." />
        </span>
      ),
      render: (s) =>
        s.evaluation ? (
          <StatusBadge
            tone={DELAY_TONE[s.evaluation.delayClass]}
            label={`${DELAY_LABEL[s.evaluation.delayClass]}${s.evaluation.delayMinutes ? ` ${formatDuration(s.evaluation.delayMinutes, { signed: true })}` : ''}`}
          />
        ) : (
          '—'
        ),
    },
    {
      key: 'last',
      header: 'Last event',
      render: (s) =>
        s.lastEvent ? (
          <span className="flex flex-col leading-4">
            <span>{humanize(s.lastEvent.eventType)}</span>
            <span className="num text-[11px] text-faint">{formatDateTime(s.lastEvent.occurredAt)}</span>
          </span>
        ) : (
          <span className="text-faint">No scans</span>
        ),
      hideBelow: 'xl',
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      render: (s) => (
        <Link
          to={`/shipments/${s.shipmentId}`}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-cobalt-700 hover:bg-cobalt-50"
          aria-label={`Open ${s.shipmentId}`}
        >
          Details <ArrowRight className="size-3" aria-hidden />
        </Link>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Shipments"
        description="Every shipment with its latest ETA snapshot, last tracking event and ground-truth delay label. Filters, sort and page are kept in the URL."
      />
      <section className="card animate-in" aria-label="Shipments table">
        <FilterBar onReset={reset} activeCount={activeCount}>
          <SearchInput
            label="Shipment ID"
            value={f.q}
            onChange={(q) => update({ q })}
            placeholder="SHP-2026-0001…"
            pattern={/^[A-Za-z0-9-]{0,20}$/}
            className="w-52"
          />
          <SelectFilter label="Status" value={f.status} onChange={(status) => update({ status })} options={SHIPMENT_STATUSES} className="w-40" />
          <SelectFilter
            label="Delay status"
            value={f.delayClass}
            onChange={(delayClass) => update({ delayClass })}
            options={DELAY_CLASSES.map((c) => ({ value: c, label: DELAY_LABEL[c] }))}
            className="w-44"
          />
          <SelectFilter label="Carrier" value={f.carrierId} onChange={(carrierId) => update({ carrierId })} options={carriers} format={(x) => x} className="w-32" />
          <SelectFilter label="Service level" value={f.serviceLevelId} onChange={(serviceLevelId) => update({ serviceLevelId })} options={serviceLevels} format={(x) => x} className="w-36" />
          <SelectFilter label="Origin" value={f.originFacilityId} onChange={(originFacilityId) => update({ originFacilityId })} options={stations} className="w-44" />
          <SelectFilter label="Destination" value={f.destinationFacilityId} onChange={(destinationFacilityId) => update({ destinationFacilityId })} options={stations} className="w-44" />
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
          <DateRangeFilter label="Created (UTC)" from={f.from} to={f.to} onChange={({ from, to }) => update({ from, to })} />
        </FilterBar>
        <DataTable
          caption="Shipments"
          columns={columns}
          rows={shipments.data}
          rowKey={(s) => s.shipmentId}
          loading={shipments.loading}
          error={shipments.error}
          onRetry={shipments.refetch}
          sort={f.sort}
          onSortChange={(sort) => update({ sort })}
          emptyTitle="No shipments match these filters"
          emptyDescription="Try clearing a filter or widening the date range."
        />
        <Pagination
          page={f.page}
          limit={f.limit}
          total={shipments.meta.total}
          totalPages={shipments.meta.totalPages}
          onPageChange={(page) => update({ page })}
          onLimitChange={(limit) => update({ limit })}
        />
      </section>
    </>
  );
}
