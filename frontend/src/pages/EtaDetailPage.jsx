import { useParams } from 'react-router-dom';
import { etaApi } from '../api/index.js';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { KeyValueList, PageHeader, Panel } from '../components/common/Panel.jsx';
import { ErrorState, LoadingBlock } from '../components/common/States.jsx';
import { StatusBadge, Tag } from '../components/common/StatusBadge.jsx';
import { DisruptionLink, FacilityLink, Mono, ShipmentLink } from '../components/common/Links.jsx';
import { CONFIDENCE_TONE } from '../utils/domain.js';
import { formatDateTime, formatDuration, humanize } from '../utils/format.js';

function AdjustmentBar({ adjustments }) {
  const parts = [
    { key: 'baseRemainingMinutes', label: 'Base remaining', cls: 'bg-cobalt-600' },
    { key: 'queueMinutes', label: 'Queue', cls: 'bg-warn' },
    { key: 'weatherMinutes', label: 'Weather', cls: 'bg-crit' },
    { key: 'holdMinutes', label: 'Hold', cls: 'bg-navy-600' },
  ].filter((p) => adjustments[p.key] > 0);
  const total = parts.reduce((s, p) => s + adjustments[p.key], 0) || 1;
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-sm" role="img" aria-label="Composition of the remaining duration">
        {parts.map((p) => (
          <span key={p.key} className={p.cls} style={{ width: `${(adjustments[p.key] / total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-3">
        {[
          ['Base remaining', adjustments.baseRemainingMinutes, 'bg-cobalt-600'],
          ['Queue adjustment', adjustments.queueMinutes, 'bg-warn'],
          ['Weather adjustment', adjustments.weatherMinutes, 'bg-crit'],
          ['Exception hold', adjustments.holdMinutes, 'bg-navy-600'],
          ['Wave interaction', adjustments.interactionMinutes, 'bg-line-strong'],
          ['Total remaining', adjustments.totalRemainingMinutes, null],
        ].map(([label, value, cls]) => (
          <li key={label} className="flex items-center gap-2">
            {cls ? <span className={`size-2 rounded-[2px] ${cls}`} aria-hidden /> : <span className="size-2" />}
            <span className="text-ink-2">{label}</span>
            <span className="num ml-auto font-medium text-ink">{formatDuration(value, { signed: label === 'Wave interaction' })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function EtaDetailPage() {
  const { id } = useParams();
  const q = useApiQuery(`eta-${id}`, (signal) => etaApi.get(id, { signal }));
  if (q.loading && !q.data) return <LoadingBlock rows={10} label="Loading ETA snapshot" />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const { eta, shipment, explanation } = q.data;
  const w = eta.watermark;
  const leaked = [w.maxEventIngestedAt, w.maxQueueIngestedAt, w.maxWeatherIngestedAt].some((t) => t && new Date(t) > new Date(eta.predictionAt));

  return (
    <>
      <PageHeader
        title={<span className="id-mono text-[18px]">{eta.etaId}</span>}
        description="One immutable ETA snapshot: what was known at its prediction time and how the estimate was built."
        meta={
          <>
            <ShipmentLink id={eta.shipmentId} />
            <StatusBadge tone={CONFIDENCE_TONE[eta.confidence]} label={`${humanize(eta.confidence)} confidence`} />
            <Tag>{eta.algorithmVersion}</Tag>
            {eta.partition === 'ANOMALY' && <StatusBadge tone="warn" label="Anomaly partition" />}
            {leaked && <StatusBadge tone="crit" label="Uses data ingested after prediction time" />}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Prediction" className="xl:col-span-2">
          <KeyValueList
            columns={3}
            items={[
              { label: 'Prediction time (cut-off)', value: <span className="num">{formatDateTime(eta.predictionAt, { year: true })} UTC</span> },
              { label: 'Estimated arrival', value: <span className="num font-medium">{formatDateTime(eta.estimatedArrivalAt, { year: true })} UTC</span> },
              { label: 'SLA deadline', value: <span className="num">{formatDateTime(shipment?.promisedDeliveryAt, { year: true })}</span> },
              { label: 'Position', value: `${humanize(eta.position.phase)}${eta.position.facilityId ? ` at ${eta.position.facilityId}` : ''}` },
              { label: 'Route', value: <Mono>{eta.position.routeId}</Mono> },
              { label: 'Carrier / service', value: shipment ? `${shipment.carrierId} · ${shipment.serviceLevelId}` : '—' },
            ]}
          />
          <div className="mt-5">
            <p className="eyebrow mb-2">Remaining duration composition</p>
            <AdjustmentBar adjustments={eta.adjustments} />
          </div>
        </Panel>
        <Panel title="Evaluation" subtitle="Filled in after the outcome is known; never an engine input">
          {eta.evaluation ? (
            <KeyValueList
              columns={1}
              items={[
                { label: 'Actual arrival', value: <span className="num">{formatDateTime(eta.evaluation.actualArrivalAt, { year: true })} UTC</span> },
                { label: 'Error (estimated − actual)', value: <span className="num">{formatDuration(eta.evaluation.errorMinutes, { signed: true })}</span> },
                { label: 'Absolute error', value: <span className="num">{formatDuration(eta.evaluation.absErrorMinutes)}</span> },
                { label: 'Horizon (actual − prediction)', value: <span className="num">{formatDuration(eta.evaluation.horizonMinutes)}</span> },
              ]}
            />
          ) : (
            <p className="text-[12.5px] text-muted">The shipment had not been delivered by the dataset snapshot, so this prediction cannot be scored yet.</p>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="How this estimate was calculated" className="xl:col-span-2">
          <ol className="list-decimal space-y-2 pl-5 text-[13px] text-ink-2 marker:text-faint">
            {explanation.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </Panel>
        <Panel title="Source watermark" subtitle="Latest information each input source contributed" info="Every watermark must be at or before the prediction time; the validator flags snapshots where it is not as future-data leakage.">
          <KeyValueList
            columns={1}
            items={[
              { label: 'Events considered', value: `${w.eventsConsidered}${eta.inputs.ignoredEventIds.length ? ` (+${eta.inputs.ignoredEventIds.length} ignored)` : ''}` },
              { label: 'Last eligible event', value: w.lastEventId ? <Mono>{w.lastEventId}</Mono> : 'None' },
              { label: 'Max event ingestion', value: <span className="num">{formatDateTime(w.maxEventIngestedAt)}</span> },
              { label: 'Max queue ingestion', value: <span className="num">{formatDateTime(w.maxQueueIngestedAt)}</span> },
              { label: 'Max weather ingestion', value: <span className="num">{formatDateTime(w.maxWeatherIngestedAt)}</span> },
            ]}
          />
          <div className="mt-4 space-y-2 text-[12.5px]">
            <p className="eyebrow">Inputs</p>
            <p className="text-ink-2">
              Remaining facilities:{' '}
              {eta.inputs.remainingFacilityIds?.length
                ? eta.inputs.remainingFacilityIds.map((fid, i) => (
                    <span key={fid}>
                      {i > 0 && ' → '}
                      <FacilityLink id={fid} />
                    </span>
                  ))
                : 'none'}
            </p>
            <p className="text-ink-2">Queue observations: {eta.inputs.queueObservationIds.length ? eta.inputs.queueObservationIds.map((x) => <Mono key={x} className="mr-1 block">{x}</Mono>) : 'none'}</p>
            <p className="text-ink-2">
              Weather advisories:{' '}
              {eta.inputs.weatherEventIds.length
                ? eta.inputs.weatherEventIds.map((x) => (
                    <span key={x} className="mr-1.5">
                      <DisruptionLink id={x} />
                    </span>
                  ))
                : 'none'}
            </p>
            <p className="id-mono break-all text-faint">inputHash {eta.inputHash}</p>
          </div>
        </Panel>
      </div>
    </>
  );
}
