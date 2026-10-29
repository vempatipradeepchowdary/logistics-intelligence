import { useParams } from 'react-router-dom';
import { facilityApi } from '../api/index.js';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useUrlState } from '../hooks/useUrlState.js';
import { KeyValueList, PageHeader, Panel } from '../components/common/Panel.jsx';
import { ErrorState, LoadingBlock } from '../components/common/States.jsx';
import { SelectFilter } from '../components/common/Filters.jsx';
import { StatusBadge, Tag } from '../components/common/StatusBadge.jsx';
import { DataTable } from '../components/common/DataTable.jsx';
import { DisruptionLink, FacilityLink, Mono, ShipmentLink } from '../components/common/Links.jsx';
import { CHART, ChartFrame, TimeLineChart } from '../components/charts/ChartKit.jsx';
import { CONGESTION_TONE, weatherSeverityTone } from '../utils/domain.js';
import { formatDateTime, formatDuration, formatNumber, formatPercent, humanize } from '../utils/format.js';

export default function FacilityDetailPage() {
  const { id } = useParams();
  const [{ days }, update] = useUrlState({ days: 14 });
  const q = useApiQuery(`facility-${id}-${days}`, (signal) => facilityApi.get(id, { days }, { signal }), { keepPreviousData: true });

  if (q.loading && !q.data) return <LoadingBlock rows={10} label="Loading facility" />;
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const { facility: fac, parentHub, stats, queueHistory, recentEvents, disruptions, delayReasons, asOf } = q.data;
  const latest = queueHistory.at(-1);
  const series = queueHistory.map((o) => ({ t: o.observedAt, wait: o.estimatedWaitMinutes, baseline: o.baselineWaitMinutes }));

  return (
    <>
      <PageHeader
        title={fac.name}
        description={`${fac.city}, ${fac.stateCode} · ${humanize(fac.region)} region`}
        meta={
          <>
            <Mono>{fac.facilityId}</Mono>
            <Tag>{humanize(fac.type)}</Tag>
            {latest && <StatusBadge tone={CONGESTION_TONE[latest.congestionLevel]} label={`Latest: ${humanize(latest.congestionLevel)} congestion`} />}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Facility profile">
          <KeyValueList
            columns={1}
            items={[
              { label: 'Coordinates', value: <span className="num">{fac.latitude.toFixed(3)}, {fac.longitude.toFixed(3)}</span> },
              { label: 'Timezone', value: fac.timezone, hint: 'Informational; all platform times are UTC.' },
              { label: 'Feeds hub', value: parentHub ? <FacilityLink id={parentHub.facilityId} label={`${parentHub.facilityId} · ${parentHub.city}`} /> : 'Is a hub' },
              { label: 'Capacity', value: `${formatNumber(fac.capacityPerHour)} parcels / h` },
              { label: 'Planned processing', value: formatDuration(fac.baseProcessingMinutes) },
              { label: 'Baseline queue wait', value: formatDuration(fac.baselineQueueWaitMinutes) },
            ]}
          />
        </Panel>
        <Panel title="Activity" className="xl:col-span-2">
          <KeyValueList
            columns={3}
            items={[
              { label: 'Shipments originating', value: formatNumber(stats.shipmentsOriginating) },
              { label: 'Shipments terminating', value: formatNumber(stats.shipmentsTerminating) },
              { label: 'Tracking events', value: formatNumber(stats.trackingEvents) },
              { label: 'Average queue wait', value: formatDuration(stats.queue?.avgWaitMinutes) },
              { label: 'p90 queue wait', value: formatDuration(stats.queue?.p90WaitMinutes) },
              { label: 'High/severe observations', value: formatPercent(stats.queue?.congestedShare) },
            ]}
          />
          <div className="mt-5">
            <p className="eyebrow mb-2">Delay attributions citing this facility</p>
            {delayReasons.length ? (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {delayReasons.map((r) => (
                  <li key={r.reasonCode} className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-[12.5px]">
                    <span className="text-ink-2">{humanize(r.reasonCode)}</span>
                    <span className="num text-ink">
                      {formatNumber(r.shipments)} shipments · {formatNumber(r.primary)} primary
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-muted">No delayed shipment cites this facility.</p>
            )}
          </div>
        </Panel>
      </div>

      <Panel
        className="mt-4"
        title="Queue history"
        subtitle={`Observed wait vs facility baseline, last ${days} days before the snapshot (${formatDateTime(asOf)} UTC)`}
        actions={
          <SelectFilter
            label="Window"
            value={String(days)}
            onChange={(v) => update({ days: Number(v) })}
            options={[
              { value: '7', label: '7 days' },
              { value: '14', label: '14 days' },
              { value: '30', label: '30 days' },
              { value: '120', label: '120 days' },
            ]}
            allLabel={null}
            className="w-28"
          />
        }
      >
        {series.length ? (
          <ChartFrame height={250} summary={`${series.length} queue observations.`} table={{ columns: ['Observed (UTC)', 'Wait (min)', 'Baseline (min)'], rows: series.map((r) => [formatDateTime(r.t), r.wait, r.baseline]) }}>
            <TimeLineChart
              data={series}
              xKey="t"
              xFormatter={(t) => formatDateTime(t)}
              valueFormatter={(v) => formatDuration(v)}
              yFormatter={(v) => `${v}m`}
              curve="stepAfter"
              series={[
                { key: 'wait', name: 'Observed wait', color: CHART.primary },
                { key: 'baseline', name: 'Baseline', color: CHART.neutral },
              ]}
            />
          </ChartFrame>
        ) : (
          <p className="text-[12.5px] text-muted">No observations in this window.</p>
        )}
      </Panel>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Disruption windows" subtitle="Weather windows that covered this facility (most recent 50)" bodyClassName="">
          <DataTable
            dense
            columns={[
              { key: 'id', header: 'Window', render: (w) => <DisruptionLink id={w.weatherEventId} /> },
              { key: 'type', header: 'Type', render: (w) => humanize(w.weatherType) },
              { key: 'sev', header: 'Severity', render: (w) => <StatusBadge tone={weatherSeverityTone(w.severity)} label={`S${w.severity}`} /> },
              { key: 'start', header: 'Start (UTC)', render: (w) => <span className="num">{formatDateTime(w.startAt)}</span> },
              { key: 'end', header: 'End', render: (w) => <span className="num">{formatDateTime(w.endAt)}</span>, hideBelow: 'sm' },
            ]}
            rows={disruptions}
            rowKey={(w) => w.weatherEventId}
            emptyTitle="No disruption windows covered this facility"
          />
        </Panel>
        <Panel title="Recent tracking events" subtitle="Latest 25 scans at this facility" bodyClassName="">
          <DataTable
            dense
            columns={[
              { key: 'shipment', header: 'Shipment', render: (e) => <ShipmentLink id={e.shipmentId} /> },
              { key: 'type', header: 'Type', render: (e) => humanize(e.eventType) },
              { key: 'occ', header: 'Occurred (UTC)', render: (e) => <span className="num">{formatDateTime(e.occurredAt)}</span> },
              { key: 'ing', header: 'Ingested', render: (e) => <span className="num">{formatDateTime(e.ingestedAt)}</span>, hideBelow: 'sm' },
            ]}
            rows={recentEvents}
            rowKey={(e) => e.eventId}
            emptyTitle="No events at this facility"
          />
        </Panel>
      </div>
    </>
  );
}
