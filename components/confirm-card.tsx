'use client';

import { useEffect, useRef } from 'react';

export type ConfirmCardProps = {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * A yes/no card, for the one decision in this app that cannot be taken back
 * with Ctrl+Z.
 *
 * The same backdrop-and-floating-card shape as the info overlay, rather than
 * window.confirm: a native dialog is styled by the browser, sits outside the
 * app's own language, and cannot say which buildings are about to go. It stacks
 * above the info overlay because it is the only thing here that blocks.
 *
 * Escape and the backdrop both cancel — the safe answer is the reachable one.
 * Focus moves to Cancel on open for the same reason: this card appears under a
 * pointer that was just clicking a button, and the destructive action must not
 * be sitting where a stray Enter or second click would land.
 */
export function ConfirmCard(p: ConfirmCardProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (p.open) cancelRef.current?.focus();
  }, [p.open]);

  if (!p.open) return null;

  return (
    <div className="confirmOverlay" onClick={p.onCancel} role="presentation">
      <div
        className="confirmCard floating"
        role="alertdialog"
        aria-modal="true"
        aria-label={p.title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="confirmTitle">{p.title}</h2>
        <p className="confirmBody">{p.body}</p>
        <div className="confirmActions">
          <button ref={cancelRef} type="button" className="btn-ghost" onClick={p.onCancel}>
            {p.cancelLabel}
          </button>
          <button type="button" className="btn-primary" onClick={p.onConfirm}>
            {p.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
