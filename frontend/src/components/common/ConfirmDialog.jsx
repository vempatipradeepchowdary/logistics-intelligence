import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button.jsx';

/** Accessible modal confirmation (focus moves in, Escape cancels, focus returns on close). */
export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', tone = 'primary', onConfirm, onCancel, busy = false }) {
  const titleId = useId();
  const confirmRef = useRef(null);
  const previousFocus = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    previousFocus.current = document.activeElement;
    confirmRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previousFocus.current?.focus?.();
    };
  }, [open, busy, onCancel]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-navy-950/45" onClick={busy ? undefined : onCancel} aria-hidden />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="card animate-in relative w-full max-w-md p-5 shadow-[var(--shadow-pop)]"
      >
        <div className="flex gap-3">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-warn-soft text-warn-ink">
            <AlertTriangle className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-[15px] font-semibold text-ink">
              {title}
            </h2>
            <div className="mt-1.5 text-[13px] text-ink-2">{children}</div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button ref={confirmRef} variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
