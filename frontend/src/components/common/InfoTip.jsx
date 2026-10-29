import { useId } from 'react';
import { Info } from 'lucide-react';

/** Keyboard- and hover-accessible explanatory tooltip. */
export function InfoTip({ text, className = '' }) {
  const id = useId();
  return (
    <span className={`group relative inline-flex ${className}`}>
      <button
        type="button"
        className="inline-flex rounded-sm text-faint hover:text-ink-2 focus-visible:text-ink-2"
        aria-describedby={id}
        aria-label="More information"
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      <span
        role="tooltip"
        id={id}
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-30 mb-1.5 w-64 -translate-x-1/2 rounded-md bg-navy-900 px-2.5 py-2 text-[11.5px] font-normal normal-case leading-4 tracking-normal text-white opacity-0 shadow-[var(--shadow-pop)] transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
