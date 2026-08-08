'use client';

import { type StatusState, StatusLine } from '@/components/status-line';
import { rectSize } from '@/lib/geo/rect';
import { useT } from '@/lib/i18n/context';
import type { IfcStats, SiteRect } from '@/lib/types';
import type { DrawTool } from '@/lib/viewer/Viewer';

export type StatusBarProps = {
  rect: SiteRect | null;
  busy: boolean;
  hasScene: boolean;
  /** The rectangle moved since the last build, so the scene is stale. */
  siteDirty: boolean;
  status: StatusState;
  buildings: number | null;
  stats: IfcStats | null;
  originLabel: string | null;
  drawTool: DrawTool | null;
  /** Corners placed so far in the current polygon, for the live hint. */
  drawPoints: number;
  drawHeight: number;
  onDrawHeight: (h: number) => void;
  onBuild: () => void;
  onDownload: () => void;
};

type Step = 'draw' | 'sited' | 'busy' | 'ready';

/**
 * The one place anything is stated.
 *
 * What the model is, what just happened, and the two actions that end the
 * sequence. Before this the same facts were spread across a masthead readout, a
 * box in the options dock, a HUD over the stage and a flow bar — the site size
 * appeared three times, and the flow bar carried a hand-written check whose only
 * job was to suppress one of the duplicates.
 *
 * The step is derived from state that already exists; nothing new is stored.
 */
export function StatusBar(p: StatusBarProps) {
  const { t, n } = useT();

  const step: Step = p.busy
    ? 'busy'
    : p.hasScene && !p.siteDirty
      ? 'ready'
      : p.rect
        ? 'sited'
        : 'draw';

  const m = p.rect ? rectSize(p.rect) : null;

  // The dimensions are in the readout the moment there is a rectangle, so
  // repeating them as a sentence would say the same thing twice in one bar.
  const echoesTheSite = p.status.kind === 'msg' && p.status.key === 'status.siteSet';

  const drawHint = !p.drawTool
    ? null
    : p.drawTool === 'rect'
      ? t('bar.drawHintRect')
      : p.drawTool === 'tree'
        ? t('bar.drawHintTree')
        : p.drawPoints > 0
          ? t('bar.drawHintPoints', { n: p.drawPoints })
          : t('bar.drawHintPoly');

  const fileSize = (): string | null => {
    if (!p.stats) return null;
    const kb = p.stats.bytes / 1024;
    return kb > 1024
      ? `${n(Math.round((kb / 1024) * 10) / 10)} ${t('unit.mb')}`
      : `${n(Math.round(kb))} ${t('unit.kb')}`;
  };

  // Each cell renders only when its datum exists, so the row grows as the model
  // does rather than standing there full of em dashes.
  const cell = (label: string, value: string) => (
    <span key={label}>
      <b>{value}</b>
      <span className="eyebrow">{label}</span>
    </span>
  );

  const size = fileSize();

  return (
    <div className="statusbar floating">
      {/* A build is twenty seconds of fetching with no other feedback, so this
          is a live region: the progress chatter is the point. */}
      <div className="barStatus" role="status">
        {drawHint ? (
          // While a tool is armed the bar says what the next click does; that
          // outranks a status line about the build that produced the scene.
          <div className="statusline statusline--bar">{drawHint}</div>
        ) : step === 'sited' && p.hasScene ? (
          // The scene on screen no longer matches the rectangle: say so rather
          // than letting Download quietly export the old one.
          <div className="statusline statusline--bar">
            <span className="err">{t('bar.stale')}</span>
          </div>
        ) : (
          !echoesTheSite && <StatusLine status={p.status} variant="bar" />
        )}
      </div>

      <div className="barReadout">
        {m && cell(t('bar.site'), `${n(Math.round(m.w))} × ${n(Math.round(m.h))} m`)}
        {p.buildings !== null && cell(t('read.buildings'), n(p.buildings))}
        {p.stats && cell(t('read.entities'), n(p.stats.entities))}
        {size && cell(t('read.file'), size)}
        {p.originLabel && (
          // The one cell long enough to need cutting; the whole of it is on the
          // title, since it is the number you would copy out.
          <span className="origin" title={p.originLabel}>
            <b>{p.originLabel}</b>
            <span className="eyebrow">{t('bar.origin')}</span>
          </span>
        )}
      </div>

      {/* Not information, but the bar is the only horizontal surface left and
          the field is short-lived — it exists only while a tool is armed. */}
      {p.drawTool && (
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

      {/* Nothing at all in the 'draw' step: the next thing to do is a rail
          button beside the map it acts on, and the bar is one sentence saying
          so. */}
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
