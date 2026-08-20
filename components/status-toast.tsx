'use client';

import { useEffect, useRef, useState } from 'react';
import { type StatusState, StatusLine } from '@/components/status-line';
import { type Step, buildStep } from '@/lib/ui/step';
import { useT } from '@/lib/i18n/context';
import type { SiteRect } from '@/lib/types';
import type { DrawTool } from '@/lib/viewer/Viewer';

export type StatusToastProps = {
  rect: SiteRect | null;
  /** A build specifically — this is the step ladder's input, not the toast's. */
  busy: boolean;
  /**
   * Any long operation, build or otherwise. Separate from `busy` because that
   * one drives the ladder to 'Building…', which opening a saved draft is not —
   * but both need the toast to stay put for the duration.
   */
  working: boolean;
  hasScene: boolean;
  siteDirty: boolean;
  status: StatusState;
  drawTool: DrawTool | null;
  /** Corners placed so far in the current polygon, for the live hint. */
  drawPoints: number;
  /** The presentation orbit is running. A condition, like an armed tool, so it
   *  pins rather than fades — and it is the only place the way out is written
   *  down once the chrome has faded. */
  presenting: boolean;
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
 *
 * A running operation is the second exception, and for the opposite reason. Its
 * progress lines are transient in kind but the *operation* is a condition, so
 * while `working` they hold: a step that outlasts five seconds — the Overpass
 * failover walking three mirrors, a paged WFS, the mesh build, a few megabytes
 * of draft coming back out of the browser — used to empty the toast and leave a
 * locked-up viewer with nothing on screen explaining it.
 */

/** How long a message stays up, or null for "until something replaces it". */
function holdFor(s: StatusState, working: boolean): number | null {
  if (s.kind === 'error') return null;
  // Progress, and something is still running: the operation ends the message,
  // not a clock. The fade starts when working drops — see the effect below.
  if (working && s.kind === 'msg') return null;
  if (s.kind === 'msg') return s.tone === 'err' ? null : 5000;
  // The closing summary is six clauses long and is the report on a twenty-second
  // build — it gets read, so it gets nearly twice as long.
  return 9000;
}

export function StatusToast(p: StatusToastProps) {
  const { t } = useT();

  const step: Step = buildStep(p);

  /* Outranks every other pinned condition below: entering presentation disarms
     whatever tool was in hand, and a stale-scene warning is not what a room is
     looking at the model for. */
  const presentHint = p.presenting ? t('bar.presenting') : null;

  const drawHint = !p.drawTool
    ? null
    : p.drawTool === 'rect'
      ? t('bar.drawHintRect')
      : p.drawTool === 'tree'
        ? t('bar.drawHintTree')
        : p.drawTool === 'measure'
          ? // Points here is the leg in progress, not corners placed: one means
            // the second click is the one that completes a distance.
            p.drawPoints > 0
            ? t('bar.measureHintEnd')
            : t('bar.measureHintStart')
          : p.drawTool === 'measureArea'
            ? p.drawPoints > 0
              ? t('bar.areaHintPoints', { n: p.drawPoints })
              : t('bar.areaHintStart')
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
    const ms = holdFor(p.status, p.working);
    if (ms === null) return;
    const id = window.setTimeout(() => setShown(false), ms);
    return () => window.clearTimeout(id);
    // Keyed on the status object, not on its contents: setStatus always builds a
    // fresh literal, so the same message twice still restarts the timer — which
    // is what keeps the toast up across a build's run of progress lines.
    //
    // working is in here so the closing line gets its five seconds from the
    // moment the operation ends rather than from whenever it happened to be set.
  }, [p.status, p.working, echoesTheSite]);

  // A running operation outranks both conditions. The draw hint used to
  // short-circuit this branch entirely, so a status raised with a tool still
  // armed was invisible — and the stale warning is about a scene that is at this
  // moment being replaced.
  const pinned = p.working ? null : (presentHint ?? drawHint ?? (stale ? t('bar.stale') : null));
  // Only the kinds that do not fade are worth a dismiss control; everything else
  // is already leaving. Progress is excluded on top of that: it holds because
  // work is running, and closing it would not stop the work.
  const dismissible = !pinned && !p.working && shown && holdFor(p.status, p.working) === null;

  /* The live region is mounted for the life of the app and emptied rather than
     unmounted. A role="status" element that appears at the same moment as its
     text is announced unreliably — screen readers watch a region they already
     know about. */
  return (
    <div className="statusToast" role="status">
      {pinned ? (
        <div className="toastBody">
          <div className="statusline statusline--bar" title={pinned}>
            {/* Only the stale warning is a warning. The two hints are guidance,
                and the error style would read as something having gone wrong. */}
            {presentHint || drawHint ? pinned : <span className="err">{pinned}</span>}
          </div>
        </div>
      ) : (
        <div className={`toastBody${shown ? '' : ' out'}${p.working ? ' busy' : ''}`}>
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
