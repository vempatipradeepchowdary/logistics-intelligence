import { useParams } from 'react-router-dom';
import { disruptionApi } from '../api/index.js';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { KeyValueList, PageHeader, Panel } from '../components/common/Panel.jsx';
import { ErrorState, LoadingBlock } from '../components/common/States.jsx';
import { StatusBadge, Tag } from '../components/common/StatusBadge.jsx';
import { DataTable } from '../components/common/DataTable.jsx';
import { FacilityLink, Mono, ShipmentLink } from '../components/common/Links.jsx';
import { weatherSeverityTone } from '../utils/domain.js';
import { formatDateTime, formatDuration, formatNumber, humanize } from '../utils/format.js';

export default function DisruptionDetailPage() {
  const { id } = useParams();
  const q = useApiQuery(`disruption-${id}`, (signal) => disruptionApi.get(id, { signal }));
  if (q.loading && !q.data) return <LoadingBlock rows={8} label="Loading disruption" />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const { event: w, affectedFacilities, impact, impactedLegs } = q.data;
  const lead = Math.round((new Date(w.startAt) - new Date(w.issuedAt)) / 60000);

  return (
    <>
      <PageHeader
        title={<span className="id-mono text-[20px]">{w.weatherEventId}</span>}
        description={`${humanize(w.weatherType)} centred on ${w.centerFacilityId}, radius ${w.radiusKm} km (synthetic historical record)`}
        meta={
          <>
            <StatusBadge tone={weatherSeverityTone(w.severity)} label={`Severity ${w.severity}`} />
            <Tag>{humanize(w.advisoryType)}</Tag>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Window" className="xl:col-span-2">
          <KeyValueList
            columns={3}
            items={[
              { label: 'Start (UTC)', value: <span className="num">{formatDateTime(w.startAt, { year: true })}</span> },
              { label: 'End (UTC)', value: <span className="num">{formatDateTime(w.endAt, { year: true })}</span> },
              { label: 'Duration', value: formatDuration((new Date(w.endAt) - new Date(w.startAt)) / 60000) },
              { label: 'Advisory issued', value: <span className="num">{formatDateTime(w.issuedAt)}</span>, hint: 'FORECAST: before the window; NOWCAST: after it began.' },
              { label: 'Advisory ingested', value: <span className="num">{formatDateTime(w.ingestedAt)}</span>, hint: 'Earliest time the ETA engine may use this advisory.' },
              { label: 'Lead time', value: lead >= 0 ? `${formatDuration(lead)} before start` : `${formatDuration(-lead)} after start` },
              { label: 'Expected processing delay', value: formatDuration(w.expectedDelayMinutes) },
              { label: 'Transit slowdown', value: `${w.transitSlowdownPct}%` },
            ]}
          />
        </Panel>
        <Panel title="Recorded impact" subtitle="From completed shipment legs citing this window">
          <KeyValueList
            columns={1}
            items={[
              { label: 'Shipments impacted', value: formatNumber(impact.shipments) },
              { label: 'Legs impacted', value: formatNumber(impact.legs) },
              { label: 'Total weather delay on those legs', value: formatDuration(impact.weatherMinutes) },
            ]}
          />
        </Panel>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title={`Affected facilities (${affectedFacilities.length})`} bodyClassName="">
          <ul className="divide-y divide-line">
            {affectedFacilities.map((f) => (
              <li key={f.facilityId} className="flex items-center justify-between gap-2 px-4 py-2 text-[12.5px]">
                <FacilityLink id={f.facilityId} />
                <span className="truncate text-ink-2">{f.city}</span>
                <Tag>{humanize(f.type)}</Tag>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Impacted legs" subtitle="First 100 legs whose recorded delay cites this window" className="xl:col-span-2" bodyClassName="">
          <DataTable
            dense
            columns={[
              { key: 'shipment', header: 'Shipment', render: (l) => <ShipmentLink id={l.shipmentId} /> },
              { key: 'leg', header: 'Leg', render: (l) => <Mono>{l.legId.slice(-2)}</Mono> },
              { key: 'lane', header: 'Lane', render: (l) => `${l.fromFacilityId} → ${l.toFacilityId}`, hideBelow: 'sm' },
              { key: 'dep', header: 'Departed (UTC)', render: (l) => <span className="num">{formatDateTime(l.actualDepartureAt)}</span>, hideBelow: 'md' },
              { key: 'wx', header: 'Weather delay', align: 'right', render: (l) => formatDuration(l.delayBreakdown?.weatherMinutes) },
            ]}
            rows={impactedLegs}
            rowKey={(l) => l.legId}
            emptyTitle="No completed leg recorded delay from this window"
          />
        </Panel>
      </div>
    </>
  );
}
