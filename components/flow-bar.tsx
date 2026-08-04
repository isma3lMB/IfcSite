'use client';

import { type StatusState, StatusLine } from '@/components/status-line';
import { rectSize } from '@/lib/geo/rect';
import { useT } from '@/lib/i18n/context';
import type { SiteRect } from '@/lib/types';

export type FlowBarProps = {
  rect: SiteRect | null;
  armed: boolean;
  busy: boolean;
  hasScene: boolean;
  /** The rectangle moved since the last build, so the scene is stale. */
  siteDirty: boolean;
  status: StatusState;
  onDraw: () => void;
  onPan: () => void;
  onZoom: () => void;
  onBuild: () => void;
  onDownload: () => void;
};

type Step = 'draw' | 'sited' | 'busy' | 'ready';

/**
 * The whole path from an empty map to an .ifc on disk, as one bar that only
 * ever offers the next thing to do. The controls it replaces were spread across
 * the sidebar — draw at the top, build and download at the bottom — which left
 * the order of operations to be inferred.
 *
 * The step is derived from state that already exists; nothing new is stored.
 */
export function FlowBar(p: FlowBarProps) {
  const { t, n } = useT();

  const step: Step = p.busy
    ? 'busy'
    : p.hasScene && !p.siteDirty
      ? 'ready'
      : p.rect
        ? 'sited'
        : 'draw';

  const m = p.rect ? rectSize(p.rect) : null;

  // The dimensions are on screen the moment there is a rectangle, so repeating
  // them as a sentence would say the same thing twice in one bar.
  const echoesTheSite = p.status.kind === 'msg' && p.status.key === 'status.siteSet';

  const stepper = (
    <div className="steps" aria-hidden="true">
      <span className={step === 'draw' ? 'on' : 'done'}>{t('flow.stepDraw')}</span>
      <span className="arrow">›</span>
      <span className={step === 'sited' || step === 'busy' ? 'on' : p.hasScene ? 'done' : ''}>
        {t('flow.stepBuild')}
      </span>
      <span className="arrow">›</span>
      <span className={step === 'ready' ? 'on' : ''}>{t('flow.stepExport')}</span>
    </div>
  );

  return (
    <div className="flowbar floating">
      {stepper}

      <div className="grow flowMain">
        {(step === 'sited' || step === 'ready') && m && (
          <div className="flowSite">
            {n(Math.round(m.w))} × {n(Math.round(m.h))} m
            <small>{((m.w * m.h) / 1e6).toFixed(2)} km²</small>
          </div>
        )}

        {step === 'sited' && p.hasScene ? (
          // The scene on screen no longer matches the rectangle: say so rather
          // than letting Download quietly export the old one.
          <div className="flowStale">{t('flow.stale')}</div>
        ) : (
          !echoesTheSite && <StatusLine status={p.status} variant="flow" />
        )}
      </div>

      <div className="flowActions">
        {step === 'draw' && (
          <div className="segmented" role="group" aria-label={t('flow.mode')}>
            <button
              type="button"
              className={p.armed ? 'on' : undefined}
              aria-pressed={p.armed}
              onClick={p.onDraw}
            >
              {t('flow.draw')}
            </button>
            <button
              type="button"
              className={!p.armed ? 'on' : undefined}
              aria-pressed={!p.armed}
              onClick={p.onPan}
            >
              {t('flow.pan')}
            </button>
          </div>
        )}

        {step === 'sited' && (
          <>
            <div className="presets !m-0 flex-nowrap">
              <button type="button" onClick={p.onZoom}>
                {t('ctl.zoomSite')}
              </button>
              <button type="button" className={p.armed ? 'on' : undefined} onClick={p.onDraw}>
                {t('flow.redraw')}
              </button>
            </div>
            {p.hasScene && (
              <button type="button" className="btn-ghost" onClick={p.onDownload}>
                {t('ctl.download')}
              </button>
            )}
            <button type="button" className="btn-primary" onClick={p.onBuild}>
              {p.hasScene ? t('flow.rebuild') : t('ctl.build')}
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
              {t('flow.rebuild')}
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
