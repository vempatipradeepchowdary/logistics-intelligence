import { useParams } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Clock,
  CloudLightning,
  Flag,
  MapPin,
  OctagonAlert,
  Route as RouteIcon,
  ShieldAlert,
  Truck,
} from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import { shipmentApi } from '../api/index.js';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { KeyValueList, PageHeader, Panel } from '../components/common/Panel.jsx';
import { ErrorState, LoadingBlock, QueryState } from '../components/common/States.jsx';
import { StatusBadge, Tag } from '../components/common/StatusBadge.jsx';
import { DisruptionLink, EtaLink, FacilityLink, Mono } from '../components/common/Links.jsx';
import { DataTable } from '../components/common/DataTable.jsx';
import { CHART, ChartFrame } from '../components/charts/ChartKit.jsx';
import { CONFIDENCE_TONE, DELAY_LABEL, DELAY_TONE, SEVERITY_TONE, STATUS_TONE, weatherSeverityTone } from '../utils/domain.js';
import { formatDateTime, formatDuration, formatNumber, humanize } from '../utils/format.js';

const LATE_MINUTES = 360;

const EVENT_ICON = {
  PICKED_UP: Truck,
  ARRIVED_AT_FACILITY: MapPin,
  DEPARTED_FACILITY: ArrowRight,
  ROUTE_CHANGED: RouteIcon,
  OUT_FOR_DELIVERY: Truck,
  DELIVERY_ATTEMPTED: OctagonAlert,
  EXCEPTION: OctagonAlert,
  DELIVERED: CheckCircle2,
};

function facilityLabel(facilities, id) {
  const f = facilities.find((x) => x.facilityId === id);
  return f ? `${f.facilityId} · ${f.city}` : id;
}

function RouteProgress({ legs, facilities }) {
  const columns = [
    { key: 'seq', header: '#', render: (l) => <span className="num text-muted">{l.sequence}</span> },
    {
      key: 'lane',
      header: 'Lane',
      render: (l) => (
        <span className={`inline-flex items-center gap-1.5 ${l.status === 'CANCELLED' ? 'text-faint line-through' : ''}`}>
          <FacilityLink id={l.fromFacilityId} label={facilityLabel(facilities, l.fromFacilityId)} />
          <ArrowRight className="size-3 text-faint" aria-hidden />
          <FacilityLink id={l.toFacilityId} label={facilityLabel(facilities, l.toFacilityId)} />
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (l) => (
        <StatusBadge tone={{ COMPLETED: 'good', IN_PROGRESS: 'info', PLANNED: 'neutral', CANCELLED: 'warn' }[l.status]} value={l.status} />
      ),
    },
    { key: 'mode', header: 'Mode', render: (l) => <Tag>{l.transportMode}</Tag>, hideBelow: 'md' },
    { key: 'planned', header: 'Planned', align: 'right', render: (l) => formatDuration(l.plannedDwellMinutes + l.plannedTransitMinutes), hideBelow: 'sm' },
    {
      key: 'actual',
      header: 'Actual',
      align: 'right',
      render: (l) => (l.actualTransitMinutes !== null ? formatDuration(l.actualDwellMinutes + l.actualTransitMinutes) : '—'),
      hideBelow: 'sm',
    },
    {
      key: 'delay',
      header: 'Queue · Weather · Carrier',
      align: 'right',
      render: (l) =>
        l.delayBreakdown
          ? `${formatDuration(l.delayBreakdown.queueMinutes)} · ${formatDuration(l.delayBreakdown.weatherMinutes)} · ${formatDuration(l.delayBreakdown.carrierMinutes, { signed: true })}`
          : '—',
      hideBelow: 'lg',
    },
    { key: 'arr', header: 'Arrived (UTC)', render: (l) => <span className="num">{formatDateTime(l.actualArrivalAt)}</span>, hideBelow: 'md' },
  ];
  return <DataTable columns={columns} rows={legs} rowKey={(l) => l.legId} dense caption="Shipment legs" />;
}

function EventTimeline({ entries, violations }) {
  const flagged = new Map();
  for (const v of violations) {
    if (!flagged.has(v.recordId)) flagged.set(v.recordId, []);
    flagged.get(v.recordId).push(v);
  }
  return (
    <ol className="relative ml-1">
      {entries.map((entry, i) => {
        if (entry.kind === 'ETA_SNAPSHOT') return null;
        const isEvent = entry.kind === 'EVENT';
        const d = entry.detail;
        const Icon = isEvent ? (EVENT_ICON[d.eventType] ?? CircleDot) : entry.kind === 'SLA_DEADLINE' ? Flag : Clock;
        const lag = isEvent ? Math.round((new Date(d.ingestedAt) - new Date(entry.at)) / 60000) : null;
        const issues = isEvent ? (flagged.get(d.eventId) ?? []) : [];
        const tone = !entry.legal && isEvent ? 'crit' : issues.length ? 'warn' : entry.kind === 'SLA_DEADLINE' ? 'neutral' : 'info';
        const dot = { crit: 'bg-crit-soft text-crit-ink border-crit/30', warn: 'bg-warn-soft text-warn-ink border-warn/30', neutral: 'bg-subtle text-muted border-line-strong', info: 'bg-cobalt-50 text-cobalt-700 border-cobalt-200' }[tone];
        return (
          <li key={`${entry.kind}-${d?.eventId ?? i}`} className="relative flex gap-3 pb-4 last:pb-0">
            {i < entries.length - 1 && <span className="absolute left-[13px] top-7 bottom-0 w-px bg-line" aria-hidden />}
            <span className={`relative z-[1] inline-flex size-[27px] shrink-0 items-center justify-center rounded-full border ${dot}`}>
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[13px] font-medium text-ink">
                  {isEvent ? humanize(d.eventType) : entry.kind === 'SLA_DEADLINE' ? 'SLA deadline' : 'Shipment created'}
                </span>
                {isEvent && d.facilityId && <FacilityLink id={d.facilityId} />}
                {entry.transition && <Tag>{entry.transition.replace('->', '→')}</Tag>}
                {isEvent && !entry.legal && <StatusBadge tone="crit" label="Illegal transition" />}
                {d?.exceptionCode && <StatusBadge tone="warn" value={d.exceptionCode} />}
                {lag !== null && lag > LATE_MINUTES && <StatusBadge tone="warn" label={`Late arrival +${formatDuration(lag)}`} />}
                {lag !== null && lag < 0 && <StatusBadge tone="crit" label="Ingested before occurrence" />}
                {issues.map((v) => (
                  <StatusBadge key={v.ruleId} tone={SEVERITY_TONE[v.severity]} label={humanize(v.ruleId)} />
                ))}
              </div>
              <p className="num mt-0.5 text-[12px] text-muted">
                {isEvent ? 'Occurred' : 'At'} {formatDateTime(entry.at, { year: true })} UTC
                {isEvent && (
                  <>
                    {' · '}ingested {formatDateTime(d.ingestedAt)} ({lag >= 0 ? '+' : ''}
                    {formatDuration(lag)})
                  </>
                )}
              </p>
              {isEvent && <p className="id-mono mt-0.5 text-faint">{d.eventId}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function EtaHistory({ etas, promised, actual }) {
  const rows = etas.map((e) => ({
    t: new Date(e.predictionAt).getTime(),
    eta: new Date(e.estimatedArrivalAt).getTime(),
  }));
  const ys = [...rows.map((r) => r.eta), new Date(promised).getTime(), ...(actual ? [new Date(actual).getTime()] : [])];
  const pad = 6 * 3600000;
  return (
    <ChartFrame
      height={210}
      summary={`${rows.length} ETA snapshots for this shipment.`}
      table={{ columns: ['Predicted at (UTC)', 'Estimated arrival (UTC)'], rows: etas.map((e) => [formatDateTime(e.predictionAt), formatDateTime(e.estimatedArrivalAt)]) }}
    >
      <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v) => formatDateTime(v)} tickLine={false} axisLine={false} minTickGap={30} />
        <YAxis
          type="number"
          domain={[Math.min(...ys) - pad, Math.max(...ys) + pad]}
          tickFormatter={(v) => formatDateTime(v)}
          width={92}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          content={({ active, payload }) =>
            active && payload?.length ? (
              <div className="rounded-md border border-line bg-surface px-2.5 py-2 text-[12px] shadow-[var(--shadow-pop)]">
                <p className="text-muted">Predicted at {formatDateTime(payload[0].payload.t)}</p>
                <p className="num font-medium text-ink">ETA {formatDateTime(payload[0].payload.eta)}</p>
              </div>
            ) : null
          }
        />
        <ReferenceLine y={new Date(promised).getTime()} stroke={CHART.warn} strokeDasharray="4 4" label={{ value: 'SLA deadline', position: 'insideTopRight', fontSize: 11, fill: '#8f5a06' }} />
        {actual && (
          <ReferenceLine y={new Date(actual).getTime()} stroke={CHART.good} strokeDasharray="2 3" label={{ value: 'Actual (evaluation)', position: 'insideBottomRight', fontSize: 11, fill: '#007563' }} />
        )}
        <Line type="stepAfter" dataKey="eta" name="Estimated arrival" stroke={CHART.primary} strokeWidth={2} dot={{ r: 3.5, fill: CHART.primary, stroke: '#fff', strokeWidth: 1.5 }} isAnimationActive={false} />
      </LineChart>
    </ChartFrame>
  );
}

export default function ShipmentDetailPage() {
  const { id } = useParams();
  const detail = useApiQuery(`shipment-${id}`, (signal) => shipmentApi.get(id, { signal }));
  const timeline = useApiQuery(`timeline-${id}`, (signal) => shipmentApi.timeline(id, { signal }));
  const etas = useApiQuery(`etas-${id}`, (signal) => shipmentApi.etas(id, { signal }));

  if (detail.loading && !detail.data) return <LoadingBlock rows={10} label="Loading shipment" />;
  if (detail.error) return <ErrorState error={detail.error} onRetry={detail.refetch} />;

  const { shipment: s, legs, facilities, disruptions, validation, evaluation, counts } = detail.data;
  const gt = evaluation.groundTruth;
  const latest = etas.data?.at(-1);

  return (
    <>
      <PageHeader
        title={<span className="id-mono text-[20px]">{s.shipmentId}</span>}
        description={`${facilityLabel(facilities, s.originFacilityId)} → ${facilityLabel(facilities, s.destinationFacilityId)}`}
        meta={
          <>
            <StatusBadge tone={STATUS_TONE[s.status]} value={s.status} />
            <Tag>{s.carrierId}</Tag>
            <Tag>{s.serviceLevelId}</Tag>
            <Tag>Zone {s.distanceZone}</Tag>
            {s.partition === 'ANOMALY' && <StatusBadge tone="warn" label="Labelled anomaly case" />}
            {s.routeChange && <StatusBadge tone="info" label={`Rerouted: ${humanize(s.routeChange.reason)}`} />}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Shipment overview" className="xl:col-span-2">
          <KeyValueList
            columns={3}
            items={[
              { label: 'Created (UTC)', value: <span className="num">{formatDateTime(s.createdAt, { year: true })}</span> },
              { label: 'Planned pickup', value: <span className="num">{formatDateTime(s.plannedPickupAt)}</span> },
              { label: 'Picked up', value: <span className="num">{formatDateTime(s.pickedUpAt)}</span> },
              { label: 'SLA deadline', value: <span className="num">{formatDateTime(s.promisedDeliveryAt, { year: true })}</span> },
              { label: 'Delivered (observed)', value: <span className="num">{formatDateTime(s.deliveredAt)}</span>, hint: 'From the DELIVERED tracking event ingested by the snapshot time.' },
              { label: 'Status updated', value: <span className="num">{formatDateTime(s.statusUpdatedAt)}</span> },
              { label: 'Planned route', value: <Mono>{s.plannedRouteId}</Mono> },
              { label: 'Current route', value: <Mono>{s.currentRouteId}</Mono> },
              { label: 'Weight / pieces', value: `${formatNumber(s.weightKg, { digits: 1 })} kg · ${s.pieces}` },
              s.routeChange && {
                label: 'Route change',
                value: `${formatDateTime(s.routeChange.occurredAt)} at ${s.routeChange.atFacilityId} (${formatDuration(s.routeChange.extraPlannedMinutes, { signed: true })} planned)`,
              },
              { label: 'Data as of', value: <span className="num">{formatDateTime(s.dataAsOf, { year: true })} UTC</span> },
              { label: 'Records', value: `${counts.events} events · ${counts.etaSnapshots} ETA snapshots` },
            ]}
          />
        </Panel>

        <Panel title="Current ETA" subtitle="Latest snapshot from the rule-based engine" info="Computed only from information ingested before the snapshot's prediction time.">
          <QueryState query={etas} isEmpty={(d) => !d?.length} empty={<p className="text-[12.5px] text-muted">No ETA snapshots.</p>}>
            {() => (
              <div className="space-y-3">
                <p className="num text-[22px] font-semibold tracking-tight text-ink">{formatDateTime(latest.estimatedArrivalAt, { year: true })}</p>
                <div className="flex flex-wrap gap-1.5">
                  <StatusBadge tone={CONFIDENCE_TONE[latest.confidence]} label={`${humanize(latest.confidence)} confidence`} />
                  <Tag>{humanize(latest.position.phase)}</Tag>
                </div>
                <KeyValueList
                  columns={1}
                  items={[
                    { label: 'Predicted at (UTC)', value: <span className="num">{formatDateTime(latest.predictionAt, { year: true })}</span> },
                    {
                      label: 'vs SLA deadline',
                      value:
                        new Date(latest.estimatedArrivalAt) <= new Date(s.promisedDeliveryAt) ? (
                          <StatusBadge tone="good" label={`${formatDuration((new Date(s.promisedDeliveryAt) - new Date(latest.estimatedArrivalAt)) / 60000)} before deadline`} />
                        ) : (
                          <StatusBadge tone="crit" label={`${formatDuration((new Date(latest.estimatedArrivalAt) - new Date(s.promisedDeliveryAt)) / 60000)} after deadline`} />
                        ),
                    },
                    { label: 'Algorithm', value: <Mono>{latest.algorithmVersion}</Mono> },
                  ]}
                />
                <EtaLink id={latest.etaId}>View calculation</EtaLink>
              </div>
            )}
          </QueryState>
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Route progression" subtitle="Shipment legs, planned vs actual, with recorded delay components" className="xl:col-span-2" bodyClassName="">
          <RouteProgress legs={legs} facilities={facilities} />
        </Panel>
        <Panel
          title="Evaluation (ground truth)"
          subtitle="Outcome labels used to score predictions; never an input to the ETA engine"
        >
          {gt ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                <StatusBadge tone={DELAY_TONE[gt.delayClass]} label={DELAY_LABEL[gt.delayClass]} />
                <Tag>{humanize(gt.deliveryOutcome)}</Tag>
              </div>
              <KeyValueList
                columns={1}
                items={[
                  { label: 'Actual delivery', value: <span className="num">{formatDateTime(gt.actualDeliveredAt, { year: true })}</span> },
                  { label: 'Delay vs deadline', value: gt.delayMinutes ? formatDuration(gt.delayMinutes) : 'None' },
                  { label: 'Rule applied', value: <span className="whitespace-normal">{gt.rationale}</span> },
                ]}
              />
              {evaluation.delayReasons.length > 0 && (
                <div>
                  <p className="eyebrow mb-1.5">Delay attribution</p>
                  <ul className="space-y-1 text-[12.5px]">
                    {evaluation.delayReasons.map((r) => (
                      <li key={r.delayId} className="flex items-center justify-between gap-2">
                        <span className="text-ink-2">
                          {humanize(r.reasonCode)} {r.isPrimary && <Tag>Primary</Tag>}
                        </span>
                        <span className="num text-ink">{formatDuration(r.attributedMinutes)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[12.5px] text-muted">No ground-truth record.</p>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Panel title="Tracking timeline" subtitle="Event time vs ingestion time, lifecycle transitions and validation flags" className="xl:col-span-3">
          <QueryState query={timeline} rows={8} isEmpty={(t) => !t?.entries?.length}>
            {(t) => <EventTimeline entries={t.entries} violations={validation.violations} />}
          </QueryState>
        </Panel>
        <div className="flex flex-col gap-4 xl:col-span-2">
          <Panel title="ETA prediction history" subtitle="Each point is an immutable snapshot">
            <QueryState query={etas} isEmpty={(d) => !d?.length} empty={<p className="text-[12.5px] text-muted">No snapshots.</p>}>
              {(list) => (
                <>
                  <EtaHistory etas={list} promised={s.promisedDeliveryAt} actual={gt?.actualDeliveredAt} />
                  <ul className="mt-3 divide-y divide-line text-[12.5px]">
                    {list.map((e) => (
                      <li key={e.etaId} className="flex items-center justify-between gap-2 py-1.5">
                        <EtaLink id={e.etaId}>{formatDateTime(e.predictionAt)}</EtaLink>
                        <span className="num text-ink">{formatDateTime(e.estimatedArrivalAt)}</span>
                        <span className="num w-20 text-right text-muted">
                          {e.evaluation ? formatDuration(e.evaluation.errorMinutes, { signed: true }) : 'n/a'}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[11px] text-faint">Right column: error vs actual delivery (evaluation only).</p>
                </>
              )}
            </QueryState>
          </Panel>
          <Panel title="Related disruptions" subtitle="Weather windows cited by this shipment's recorded delays">
            {disruptions.length ? (
              <ul className="divide-y divide-line">
                {disruptions.map((w) => (
                  <li key={w.weatherEventId} className="flex items-center justify-between gap-2 py-2 text-[12.5px]">
                    <span className="flex items-center gap-2">
                      <CloudLightning className="size-3.5 text-muted" aria-hidden />
                      <DisruptionLink id={w.weatherEventId} />
                      <span className="text-ink-2">{humanize(w.weatherType)}</span>
                    </span>
                    <StatusBadge tone={weatherSeverityTone(w.severity)} label={`Severity ${w.severity}`} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-muted">No weather window contributed to this shipment's recorded delays.</p>
            )}
          </Panel>
          <Panel title="Validation findings" subtitle={validation.runId ? `Latest run ${validation.runId}` : 'No validation run yet'}>
            {validation.violations.length ? (
              <ul className="space-y-2">
                {validation.violations.map((v, i) => (
                  <li key={`${v.ruleId}-${v.recordId}-${i}`} className="rounded-md border border-line p-2.5 text-[12.5px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <ShieldAlert className="size-3.5 text-muted" aria-hidden />
                      <span className="font-medium text-ink">{humanize(v.ruleId)}</span>
                      <StatusBadge tone={SEVERITY_TONE[v.severity]} value={v.severity} />
                      <StatusBadge tone={v.classification === 'UNEXPECTED' ? 'crit' : 'info'} label={v.classification === 'UNEXPECTED' ? 'Unexpected' : 'Intentional anomaly'} />
                    </div>
                    <p className="mt-1 text-ink-2">{v.actual}</p>
                    <p className="id-mono mt-0.5 text-faint">{v.recordId}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-1.5 text-[12.5px] text-muted">
                <CheckCircle2 className="size-3.5 text-good" aria-hidden /> No validation findings for this shipment.
              </p>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
