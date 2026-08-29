'use client';

import type { ReactNode, RefObject } from 'react';
import { IconWrench } from '@/components/icons';
import { IfcFlyout } from '@/components/ifc-flyout';
import { type Step, buildStep } from '@/lib/ui/step';
import { useT } from '@/lib/i18n/context';
import type { IfcMeta, SiteRect } from '@/lib/types';
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
  /* What the exported file says about itself, and the wrench that opens it.
     The panel lives here rather than beside the rail's flyouts because it hangs
     off Download — see IfcFlyout. */
  ifc: IfcMeta;
  ifcOpen: boolean;
  ifcBtnRef: RefObject<HTMLButtonElement | null>;
  defaultProjectName: string;
  onToggleIfc: () => void;
  onIfc: (patch: Partial<IfcMeta>) => void;
  onResetIfc: () => void;
  onCloseIfc: () => void;
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
  // rail button beside the map it acts on, so there is nothing for this row to
  // say. It used to matter more than it does — the bar was a bordered surface,
  // and an empty one sat at the foot of the window as a stray chip. Now that it
  // is a bare layout row an empty one would be invisible, and this is only here
  // so the DOM says so too. The measure tools cannot reach this branch — the
  // rail only offers them once there is a scene, which is past 'draw'.
  if (step === 'draw' && !p.drawTool) return null;

  /* Download, with the wrench pinned to its top-right corner and the panel that
     wrench opens hanging off the same box.

     A badge on the button rather than a sibling beside it: these settings are
     about the file Download writes and nothing else, and a separate round button
     in the row would read as a third action. Yellow because it is the one thing
     here that is neither of the two actions — see .barChip.

     A function rather than a constant because the two branches below hand it a
     different button: Download is the secondary action while the model is stale
     and the primary one once it is not. Written once all the same — a second copy
     is the one that gets forgotten when the panel grows a prop. */
  const withIfcChip = (download: ReactNode) => (
    <div className="barChipWrap">
      {download}
      <button
        ref={p.ifcBtnRef}
        type="button"
        className={`barChip${p.ifcOpen ? ' on' : ''}`}
        title={t('ifc.title')}
        aria-label={t('ifc.title')}
        aria-expanded={p.ifcOpen}
        aria-controls="ifcFlyout"
        onClick={p.onToggleIfc}
      >
        <IconWrench />
      </button>
      {p.ifcOpen && (
        <IfcFlyout
          ifc={p.ifc}
          defaultProjectName={p.defaultProjectName}
          onChange={p.onIfc}
          onReset={p.onResetIfc}
          onClose={p.onCloseIfc}
        />
      )}
    </div>
  );

  return (
    // No .floating: the bar is a layout row, not a surface. Its buttons carry
    // their own — see .statusbar .btn-* in globals.css.
    <div className="statusbar">
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
            {/* Only where Download is — there is no SiteMeta to edit until a
                build has produced one. */}
            {p.hasScene &&
              withIfcChip(
                <button type="button" className="btn-ghost" onClick={p.onDownload}>
                  <img className="ifcLogo" src="/IFC_logo.png" alt="" aria-hidden="true" />
                  {t('ctl.download')}
                </button>,
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
            {withIfcChip(
              <button type="button" className="btn-primary" onClick={p.onDownload}>
                <img className="ifcLogo" src="/IFC_logo.png" alt="" aria-hidden="true" />
                {t('ctl.download')}
              </button>,
            )}
          </>
        )}
      </div>
    </div>
  );
}
