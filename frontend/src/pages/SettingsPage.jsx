import { useState } from 'react';
import { toast } from 'sonner';
import { KeyRound, RefreshCw } from 'lucide-react';
import { jobApi } from '../api/index.js';
import { useApp } from '../context/AppContext.jsx';
import { KeyValueList, PageHeader, Panel } from '../components/common/Panel.jsx';
import { Button } from '../components/common/Button.jsx';
import { StatusBadge, Tag } from '../components/common/StatusBadge.jsx';
import { Mono } from '../components/common/Links.jsx';
import { formatDateTime, formatNumber } from '../utils/format.js';

function AdminKeyForm() {
  const { adminKey, setAdminKey } = useApp();
  const [draft, setDraft] = useState('');
  const [checking, setChecking] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    const value = draft.trim();
    if (value.length < 16) {
      toast.error('The admin key is at least 16 characters long');
      return;
    }
    setChecking(true);
    setAdminKey(value);
    try {
      await jobApi.list({ limit: 1 });
      toast.success('Admin key accepted by the backend');
      setDraft('');
    } catch (err) {
      setAdminKey('');
      toast.error(err.status === 401 ? 'The backend rejected this key' : `Could not verify the key: ${err.message}`);
    } finally {
      setChecking(false);
    }
  };
  return (
    <form onSubmit={save} className="space-y-3">
      <p className="text-[12.5px] text-ink-2">
        Generation, validation and export are admin operations protected by the backend's <span className="id-mono">ADMIN_API_KEY</span> (sent as the
        <span className="id-mono"> x-api-key</span> header). The key is kept in this tab's session storage only and is never part of the build. There is no user
        authentication in this platform.
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor="admin-key" className="text-[12px] font-medium text-ink-2">
          Admin API key
        </label>
        <input
          id="admin-key"
          type="password"
          autoComplete="off"
          className="field max-w-md"
          placeholder={adminKey ? '•••••••• (set for this session)' : 'Paste ADMIN_API_KEY from the backend .env'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" icon={KeyRound} loading={checking} disabled={!draft.trim()}>
          Verify &amp; save
        </Button>
        {adminKey && (
          <Button
            onClick={() => {
              setAdminKey('');
              toast.info('Admin key cleared');
            }}
          >
            Clear key
          </Button>
        )}
      </div>
      <p className="text-[12px] text-muted">Status: {adminKey ? <StatusBadge tone="good" label="Key set for this session" /> : <StatusBadge tone="neutral" label="Read-only" />}</p>
    </form>
  );
}

export default function SettingsPage() {
  const { health, checkHealth, config, apiBaseUrl } = useApp();
  const m = config?.latestManifest;
  return (
    <>
      <PageHeader title="Settings & system health" description="Connection status, configuration exposed by the backend (no secrets), and the admin key for this session." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title="System health"
          actions={
            <Button size="sm" icon={RefreshCw} onClick={() => checkHealth()}>
              Re-check
            </Button>
          }
        >
          <KeyValueList
            columns={2}
            items={[
              {
                label: 'Backend API',
                value: (
                  <StatusBadge
                    tone={{ online: 'good', degraded: 'warn', offline: 'crit', checking: 'neutral' }[health.status]}
                    label={{ online: 'Online', degraded: 'Degraded', offline: 'Unreachable', checking: 'Checking…' }[health.status]}
                  />
                ),
              },
              {
                label: 'MongoDB',
                value: health.data ? `${health.data.database.state} · ping ${health.data.database.pingMs ?? '—'} ms` : 'Unknown (health not verified)',
              },
              { label: 'API base URL', value: <Mono>{apiBaseUrl}</Mono> },
              { label: 'Backend version', value: health.data?.version ?? config?.version ?? 'Unknown' },
              { label: 'Backend uptime', value: health.data ? `${formatNumber(Math.round(health.data.uptimeSeconds / 60))} min` : '—' },
              { label: 'Last checked (UTC)', value: <span className="num">{formatDateTime(health.checkedAt, { seconds: true })}</span> },
              { label: 'Environment', value: config?.environment ?? '—' },
              { label: 'Frontend', value: `YottaFlex Intelligence ${import.meta.env.MODE}` },
            ]}
          />
          {health.error && <p className="mt-3 text-[12px] text-crit-ink">{health.error.message}</p>}
        </Panel>
        <Panel title="Admin access">
          <AdminKeyForm />
        </Panel>
        <Panel title="Dataset configuration" subtitle="Latest generation manifest">
          {m ? (
            <KeyValueList
              columns={2}
              items={[
                { label: 'Manifest', value: <Mono>{m.manifestId}</Mono> },
                { label: 'Status', value: <StatusBadge tone={m.status === 'COMPLETED' ? 'good' : m.status === 'FAILED' ? 'crit' : 'info'} value={m.status} /> },
                { label: 'Profile / seed', value: `${m.profile} · ${m.seed}` },
                { label: 'Simulation window', value: `${m.simulationWindow?.start?.slice(0, 10)} → ${m.simulationWindow?.asOf?.slice(0, 10)}` },
                { label: 'Generator', value: m.generatorVersion },
                { label: 'ETA algorithm', value: m.etaAlgorithmVersion },
                { label: 'Software version', value: m.softwareVersion },
                { label: 'Environment', value: m.environment ? `Node ${m.environment.node} · MongoDB ${m.environment.mongodb}` : '—' },
              ]}
            />
          ) : (
            <p className="text-[12.5px] text-muted">{config ? 'No generation manifest yet.' : 'Configuration unavailable.'}</p>
          )}
        </Panel>
        <Panel title="Generator & API defaults">
          {config ? (
            <div className="space-y-4">
              <KeyValueList
                columns={2}
                items={[
                  { label: 'Default seed', value: config.generator.defaultSeed },
                  { label: 'Default profile', value: config.generator.defaultProfile },
                  { label: 'Default batch size', value: formatNumber(config.generator.defaultBatchSize) },
                  { label: 'Validation rules', value: config.validation.rules },
                  { label: 'Late-ingestion threshold', value: `${config.validation.lateIngestionThresholdMinutes} min` },
                  { label: 'Page size (default / max)', value: `${config.api.defaultPageSize} / ${config.api.maxPageSize}` },
                  { label: 'Rate limit', value: `${config.api.rateLimitPerMinute}/min (admin writes ${config.api.adminRateLimitPerMinute}/min)` },
                  { label: 'Theme', value: 'Light (single theme)' },
                ]}
              />
              <div>
                <p className="eyebrow mb-1.5">Profiles</p>
                <ul className="space-y-1 text-[12.5px]">
                  {Object.entries(config.generator.profiles).map(([name, p]) => (
                    <li key={name} className="flex flex-wrap items-center gap-2">
                      <Tag>{name}</Tag>
                      <span className="num text-ink-2">
                        {formatNumber(p.shipments)} shipments · {formatNumber(p.trackingEvents)} events · {p.facilities} facilities · {formatNumber(p.weatherEvents)} disruption windows · {p.simulationDays} days
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-[12px] text-muted">{config.generator.behaviour}</p>
            </div>
          ) : (
            <p className="text-[12.5px] text-muted">Configuration unavailable.</p>
          )}
        </Panel>
      </div>
    </>
  );
}
