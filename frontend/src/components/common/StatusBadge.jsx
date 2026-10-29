import { AlertTriangle, CheckCircle2, Circle, Info, OctagonAlert } from 'lucide-react';
import { humanize } from '../../utils/format.js';

const TONES = {
  good: { cls: 'bg-good-soft text-good-ink border-good/25', Icon: CheckCircle2 },
  warn: { cls: 'bg-warn-soft text-warn-ink border-warn/30', Icon: AlertTriangle },
  crit: { cls: 'bg-crit-soft text-crit-ink border-crit/25', Icon: OctagonAlert },
  info: { cls: 'bg-info-soft text-cobalt-700 border-cobalt-200', Icon: Info },
  neutral: { cls: 'bg-subtle text-ink-2 border-line-strong', Icon: Circle },
};

/** Status is always communicated with icon + text, never colour alone. */
export function StatusBadge({ tone = 'neutral', label, value, icon = true, className = '' }) {
  const { cls, Icon } = TONES[tone] ?? TONES.neutral;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-[1px] text-[11.5px] font-medium leading-4 whitespace-nowrap ${cls} ${className}`}
    >
      {icon && <Icon className="size-3 shrink-0" aria-hidden />}
      {label ?? humanize(value)}
    </span>
  );
}

/** Icon chip in a tone (the adjacent text carries the meaning). */
export function ToneIcon({ tone = 'neutral', icon: Icon }) {
  const { cls } = TONES[tone] ?? TONES.neutral;
  return (
    <span className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md border ${cls}`}>
      <Icon className="size-3.5" aria-hidden />
    </span>
  );
}

export function Tag({ children, className = '' }) {
  return (
    <span className={`inline-flex items-center rounded-sm bg-subtle border border-line px-1.5 py-[1px] text-[11px] text-ink-2 whitespace-nowrap ${className}`}>
      {children}
    </span>
  );
}
