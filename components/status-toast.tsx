'use client';

import { useEffect, useRef, useState } from 'react';
import { type StatusState, StatusLine } from '@/components/status-line';
import { type Step, buildStep } from '@/lib/ui/step';
import { useT } from '@/lib/i18n/context';
import type { SiteRect } from '@/lib/types';
import type { DrawTool } from '@/lib/viewer/Viewer';

export type StatusToastProps = {
  rect: SiteRect | null;
  busy: boolean;
  hasScene: boolean;
  siteDirty: boolean;
  status: StatusState;
  drawTool: DrawTool | null;
  /** Corners placed so far in the current polygon, for the live hint. */
  drawPoints: number;
};

/**
 * What just happened, over the viewer, for as long as it is worth saying.
 *
 * This was the left third of the status bar, which meant a strip of permanent
 * chrome existed to hold a sentence that is blank most of the time. Two
 * lifetimes share the slot, and the distinction is the whole design:
 *
 * - Pinned — the draw hint and the stale-scene warning. These are not events,
 *   they are conditions: true for exactly as long as a tool is armed or the
 *   rectangle is ahead of the scene. A timer on them would take the hint away
 *   mid-polygon.
 * - Transient — everything routed through setStatus. It appears, and it leaves
 *   on its own.
 *
 * Errors are the exception inside the transient half: they do not fade. A
 * failure that erases itself before it is read is worse than one that lingers,
 * so they wait to be superseded or dismissed.
 */

/** How long a message stays up, or null for "until something replaces it". */
function holdFor(s: StatusState): number | null {
  if (s.kind === 'error') return null;
  if (s.kind === 'msg') return s.tone === 'err' ? null : 5000;
  // The closing summary is six clauses long and is the report on a twenty-second
  // build — it gets read, so it gets nearly twice as long.
  return 9000;
}

export function StatusToast(p: StatusToastProps) {
  const { t } = useT();

  const step: Step = buildStep(p);

  const drawHint = !p.drawTool
    ? null
    : p.drawTool === 'rect'
      ? t('bar.drawHintRect')
      : p.drawTool === 'tree'
        ? t('bar.drawHintTree')
        : p.drawPoints > 0
          ? t('bar.drawHintPoints', { n: p.drawPoints })
          : t('bar.drawHintPoly');

  // The scene on screen no longer matches the rectangle: say so rather than
  // letting Download quietly export the old one.
  const stale = step === 'sited' && p.hasScene;

  // The dimensions are in the readout the moment there is a rectangle, so
  // repeating them as a sentence would say the same thing twice on one screen.
  const echoesTheSite = p.status.kind === 'msg' && p.status.key === 'status.siteSet';

  const [shown, setShown] = useState(false);
  // The status starts at status.ready, which is a resting state and not news —
  // without this the page would boot with a toast already fading.
  const booted = useRef(false);

  useEffect(() => {
    if (!booted.current) {
      booted.current = true;
      return;
    }
    if (echoesTheSite) {
      setShown(false);
      return;
    }
    setShown(true);
    const ms = holdFor(p.status);
    if (ms === null) return;
    const id = window.setTimeout(() => setShown(false), ms);
    return () => window.clearTimeout(id);
    // Keyed on the status object, not on its contents: setStatus always builds a
    // fresh literal, so the same message twice still restarts the timer — which
    // is what keeps the toast up across a build's run of progress lines.
  }, [p.status, echoesTheSite]);

  const pinned = drawHint ?? (stale ? t('bar.stale') : null);
  // Only the kinds that do not fade are worth a dismiss control; everything else
  // is already leaving.
  const dismissible = !pinned && shown && holdFor(p.status) === null;

  /* The live region is mounted for the life of the app and emptied rather than
     unmounted. A role="status" element that appears at the same moment as its
     text is announced unreliably — screen readers watch a region they already
     know about. */
  return (
    <div className="statusToast" role="status">
      {pinned ? (
        <div className="toastBody">
          <div className="statusline statusline--bar" title={pinned}>
            {drawHint ? pinned : <span className="err">{pinned}</span>}
          </div>
        </div>
      ) : (
        <div className={`toastBody${shown ? '' : ' out'}`}>
          <StatusLine status={p.status} variant="bar" />
          {dismissible && (
            <button
              type="button"
              className="toastX"
              title={t('ui.dismiss')}
              aria-label={t('ui.dismiss')}
              onClick={() => setShown(false)}
            >
              ×
            </button>
          )}
        </div>
      )}
    </div>
  );
}
