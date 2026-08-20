'use client';

import { type Step, buildStep } from '@/lib/ui/step';
import { useT } from '@/lib/i18n/context';
import type { SiteRect } from '@/lib/types';
import type { DrawTool } from '@/lib/viewer/Viewer';

export type StatusBarProps = {
  rect: SiteRect | null;
  busy: boolean;
  hasScene: boolean;
  /** The rectangle moved since the last build, so the scene is stale. */
  siteDirty: boolean;
  drawTool: DrawTool | null;
  drawHeight: number;
  onDrawHeight: (h: number) => void;
  /** How many measurements are on screen. Only ever shown while a measure tool
   *  is armed — the bar is for the tool in hand, not a running tally. */
  measureCount: number;
  onClearMeasures: () => void;
  onBuild: () => void;
  onDownload: () => void;
};

/**
 * The two actions that end the sequence, and nothing else.
 *
 * The bar used to carry four jobs at once — a status sentence, a five-cell
 * readout, this height field and these buttons — which is why it had to span the
 * window at every size. Those four had nothing in common except a row. Split by
 * lifetime, the permanent facts went to <SiteReadout> in the bottom-right corner
 * and the momentary ones to <StatusToast> above this; what is left shrink-wraps
 * to its buttons and sits in the middle.
 */
export function StatusBar(p: StatusBarProps) {
  const { t } = useT();

  const step: Step = buildStep(p);
  // The measure tools take no options and add nothing to the scene, so the
  // height field is not theirs — it would offer to set the height of a building
  // that is never going to be drawn.
  const measuring = p.drawTool === 'measure' || p.drawTool === 'measureArea';
  const clearable = measuring && p.measureCount > 0;

  // 'draw' with no tool armed leaves nothing to draw: the next thing to do is a
  // rail button beside the map it acts on. Returning null rather than an empty
  // element matters now that the bar is shrink-wrapped — a bordered .floating
  // box with no content in it would sit at the bottom of the window as a stray
  // chip. The measure tools cannot reach that branch — the rail only offers them
  // once there is a scene, which is past 'draw'.
  if (step === 'draw' && !p.drawTool) return null;

  return (
    <div className="statusbar floating">
      {clearable && (
        <button type="button" className="btn-ghost" onClick={p.onClearMeasures}>
          {t('bar.measureClear', { n: p.measureCount })}
        </button>
      )}

      {/* Not information, and the only thing here that is not an action — but
          the field is short-lived, existing only while a tool is armed, and this
          is the surface the tool's buttons are already on. */}
      {p.drawTool && !measuring && (
        <label
          className="barHeight"
          title={t(p.drawTool === 'tree' ? 'bar.newTreeHeightTitle' : 'bar.newHeightTitle')}
        >
          <span>{t('bar.drawHeight')}</span>
          <input
            type="number"
            className="ctl-input"
            min={0.5}
            step={0.5}
            value={String(p.drawHeight)}
            aria-label={t(p.drawTool === 'tree' ? 'bar.newTreeHeightTitle' : 'bar.newHeightTitle')}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v)) p.onDrawHeight(v);
            }}
          />
        </label>
      )}

      <div className="barActions">
        {step === 'sited' && (
          <>
            {p.hasScene && (
              <button type="button" className="btn-ghost" onClick={p.onDownload}>
                {t('ctl.download')}
              </button>
            )}
            <button type="button" className="btn-primary" onClick={p.onBuild}>
              {p.hasScene ? t('bar.rebuild') : t('ctl.build')}
            </button>
          </>
        )}

        {step === 'busy' && (
          <button type="button" className="btn-primary" disabled>
            {t('ctl.building')}
          </button>
        )}

        {step === 'ready' && (
          <>
            <button type="button" className="btn-ghost" onClick={p.onBuild}>
              {t('bar.rebuild')}
            </button>
            <button type="button" className="btn-primary" onClick={p.onDownload}>
              {t('ctl.download')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
