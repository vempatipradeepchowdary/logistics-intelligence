// Formatting helpers. All dataset timestamps are UTC; they are displayed in UTC to match the
// backend, exports and validation reports (labelled "UTC" where shown).

const nf = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export function formatNumber(value, { compact: useCompact = false, digits } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (useCompact && Math.abs(value) >= 10000) return compact.format(value);
  if (digits !== undefined) {
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  }
  return nf.format(value);
}

export function formatPercent(ratio, digits = 1) {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Mar 04, 14:05" (UTC) */
export function formatDateTime(value, { seconds = false, year = false } = {}) {
  const d = toDate(value);
  if (!d) return '—';
  const date = `${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCDate())}${year ? ` ${d.getUTCFullYear()}` : ''}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${seconds ? `:${pad(d.getUTCSeconds())}` : ''}`;
  return `${date}, ${time}`;
}

/** "Mar 04 2026" (UTC) */
export function formatDate(value, { year = true } = {}) {
  const d = toDate(value);
  if (!d) return '—';
  return `${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCDate())}${year ? ` ${d.getUTCFullYear()}` : ''}`;
}

/** Short axis label for ISO day strings ("2026-03-04" -> "Mar 4"). */
export function formatDayTick(iso) {
  const d = toDate(`${iso}T00:00:00Z`);
  return d ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` : iso;
}

/** Minutes -> "2d 4h", "3h 05m", "45m"; signed when `signed` is true. */
export function formatDuration(minutes, { signed = false } = {}) {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return '—';
  const sign = minutes < 0 ? '−' : signed && minutes > 0 ? '+' : '';
  let m = Math.round(Math.abs(minutes));
  const d = Math.floor(m / 1440);
  m -= d * 1440;
  const h = Math.floor(m / 60);
  m -= h * 60;
  if (d) return `${sign}${d}d ${h}h`;
  if (h) return `${sign}${h}h ${pad(m)}m`;
  return `${sign}${m}m`;
}

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}

export const toIsoStart = (date) => (date ? `${date}T00:00:00.000Z` : undefined);
export const toIsoEnd = (date) => (date ? `${date}T23:59:59.999Z` : undefined);

export const humanize = (value) =>
  value === null || value === undefined
    ? '—'
    : String(value)
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/^\w/, (c) => c.toUpperCase());
