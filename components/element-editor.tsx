'use client';

import { useEffect, useRef, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { useT } from '@/lib/i18n/context';
import { rnd } from '@/lib/scene/xf';
import type { GizmoMode, Vec3 } from '@/lib/types';
import type { Selection } from '@/lib/viewer/Viewer';

export type AxisKey = 'pos' | 'rot' | 'scale';

/**
 * One axis field.
 *
 * While the field has focus it renders its own draft string, so a value being
 * typed is never rewritten under the cursor — round `1.05` on every keystroke
 * and the decimal becomes impossible to enter. The moment focus leaves, the
 * draft is dropped and the (clamped, rounded) value from the model takes over.
 * This is the same split the original made between its oninput and onchange
 * handlers, where onchange was both the undo boundary and the rewrite point.
 */
function AxisInput({
  axis,
  value,
  step,
  min,
  ariaLabel,
  onLive,
  onCommit,
}: {
  axis: string;
  value: number;
  step: number;
  min?: number;
  ariaLabel: string;
  onLive: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <label>
      <span>{axis}</span>
      <input
        type="number"
        className="ctl-input"
        step={step}
        min={min}
        aria-label={ariaLabel}
        value={draft ?? String(value)}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onLive(v);
        }}
        onBlur={(e) => {
          setDraft(null);
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onCommit(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

/**
 * The colour swatch.
 *
 * React maps onChange on an <input type="color"> to the DOM `input` event, which
 * fires continuously while the picker is open. The undo boundary is the native
 * `change` event, which React does not surface — so it is bound directly, the
 * way the original's onchange handler was. Committing on blur instead would
 * miss a picker dismissed without moving focus.
 */
function ColourField({
  value,
  onColor,
}: {
  value: number;
  onColor: (hex: number, commit: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const latest = useRef(onColor);
  latest.current = onColor;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const commit = () => latest.current(parseInt(el.value.slice(1), 16), true);
    el.addEventListener('change', commit);
    return () => el.removeEventListener('change', commit);
  }, []);

  return (
    <input
      id="edColor"
      ref={ref}
      type="color"
      className="colorInput"
      value={'#' + value.toString(16).padStart(6, '0')}
      onChange={(e) => onColor(parseInt(e.target.value.slice(1), 16), false)}
    />
  );
}

const MODES: { mode: GizmoMode; label: 'ed.move' | 'ed.rotate' | 'ed.scale' }[] = [
  { mode: 'translate', label: 'ed.move' },
  { mode: 'rotate', label: 'ed.rotate' },
  { mode: 'scale', label: 'ed.scale' },
];

export type ElementEditorProps = {
  visible: boolean;
  selection: Selection | null;
  gizmoMode: GizmoMode;
  uniform: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onMode: (m: GizmoMode) => void;
  onUniform: (v: boolean) => void;
  onAxis: (key: AxisKey, i: number, v: number, commit: boolean) => void;
  onColor: (hex: number, commit: boolean) => void;
  onColorReset: () => void;
  onReset: () => void;
  onResetOrigin: () => void;
  onDeselect: () => void;
  onUndo: () => void;
  onRedo: () => void;
  /* The local project coordinate system. Export metadata rather than a scene
     edit, so it lives outside the selection and outside the undo stack — see
     ed.projectHint. */
  projectBase: Vec3;
  projectAngle: number;
  onProjectBase: (i: number, v: number) => void;
  onProjectAngle: (v: number) => void;
  onResetPlacement: () => void;
};

export function ElementEditor(p: ElementEditorProps) {
  const { t } = useT();
  if (!p.visible) return null;

  const sel = p.selection;
  const xf = sel?.xf;
  const colour = xf ? (xf.color === null ? sel!.defaultColor : xf.color) : 0;
  // The origin is a bare point: no ring to recolour, nothing to turn or stretch.
  // It reuses the position row and drops the rest rather than greying it out.
  const isOrigin = sel?.kind === 'origin';

  /* `write` rather than p.onAxis directly, so the project-coordinate row can
     reuse AxisInput's draft/commit behaviour without pretending to be an xf. */
  const axisRow = (
    name: string,
    values: number[],
    step: number,
    write: (i: number, v: number, commit: boolean) => void,
    min?: number,
  ) => (
    <div className="axes">
      {(['X', 'Y', 'Z'] as const).map((ax, i) => (
        <AxisInput
          key={ax}
          axis={ax}
          value={values[i]}
          step={step}
          min={min}
          ariaLabel={`${name} ${ax}`}
          onLive={(v) => write(i, v, false)}
          onCommit={(v) => write(i, v, true)}
        />
      ))}
    </div>
  );

  const xfRow = (key: AxisKey, values: number[], step: number, min?: number) =>
    axisRow(key, values, step, (i, v, commit) => p.onAxis(key, i, v, commit), min);

  return (
    <div className={`floating editPanel${sel ? '' : ' collapsed'}`}>
      <div className="editHead">
        <div>
          <div className="eyebrow">{t('ed.selected')}</div>
          <div className="editName" title={sel?.id}>
            {isOrigin ? t('ed.originName') : (sel?.name ?? '—')}
          </div>
        </div>
        <div className="presets !m-0 flex-none flex-nowrap">
          <button type="button" title={t('ed.undo')} disabled={!p.canUndo} onClick={p.onUndo}>
            ↩
          </button>
          <button type="button" title={t('ed.redo')} disabled={!p.canRedo} onClick={p.onRedo}>
            ↪
          </button>
          <button type="button" title={t('ed.close')} onClick={p.onDeselect}>
            ✕
          </button>
        </div>
      </div>

      {!sel && <div className="editEmpty">{t('ed.empty')}</div>}

      {sel && xf && isOrigin && (
        <div>
          <div className="field">
            <span className="eyebrow block mb-1.5">{t('ed.originPosition')}</span>
            {xfRow(
              'pos',
              xf.pos.map((v) => rnd(v, 2)),
              0.5,
            )}
          </div>

          <div className="presets">
            <button type="button" onClick={p.onResetOrigin}>
              {t('ed.resetOrigin')}
            </button>
            <button type="button" onClick={p.onDeselect}>
              {t('ed.deselect')}
            </button>
          </div>

          <p className="editHint">{t('ed.originHint')}</p>

          {/* Where that point lands in the project's own grid. Separated by a rule
              because it answers a different question from the row above: not
              "which point is the origin" but "what does the origin get called". */}
          <div className="field editSection">
            <span className="eyebrow block mb-1.5">{t('ed.projectPlacement')}</span>

            <span className="eyebrow block mb-1.5">{t('ed.projectCoords')}</span>
            {axisRow(
              'project',
              p.projectBase.map((v) => rnd(v, 3)),
              1,
              (i, v) => p.onProjectBase(i, v),
            )}

            <span className="eyebrow mt-2.5 block mb-1.5">{t('ed.projectAngle')}</span>
            <div className="axes">
              <AxisInput
                axis="∠"
                value={rnd(p.projectAngle, 4)}
                step={1}
                ariaLabel="project angle"
                onLive={p.onProjectAngle}
                onCommit={p.onProjectAngle}
              />
            </div>

            <div className="presets">
              <button type="button" onClick={p.onResetPlacement}>
                {t('ed.resetPlacement')}
              </button>
            </div>

            <p className="editHint">{t('ed.projectHint')}</p>
          </div>
        </div>
      )}

      {sel && xf && !isOrigin && (
        <div>
          <div className="field">
            <span className="eyebrow block mb-1.5">{t('ed.gizmo')}</span>
            <div className="presets !mt-0">
              {MODES.map((m) => (
                <button
                  key={m.mode}
                  type="button"
                  className={p.gizmoMode === m.mode ? 'on' : undefined}
                  onClick={() => p.onMode(m.mode)}
                >
                  {t(m.label)}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="eyebrow block mb-1.5" htmlFor="edColor">
              {t('ed.colour')}
            </label>
            <ColourField value={colour} onColor={p.onColor} />
            <div className="presets">
              <button type="button" onClick={p.onColorReset}>
                {t('ed.defaultColour')}
              </button>
            </div>
          </div>

          <div className="field">
            <span className="eyebrow block mb-1.5">{t('ed.position')}</span>
            {xfRow(
              'pos',
              xf.pos.map((v) => rnd(v, 2)),
              0.5,
            )}
          </div>

          <div className="field">
            <span className="eyebrow block mb-1.5">{t('ed.rotation')}</span>
            {xfRow(
              'rot',
              xf.rot.map((v) => rnd((v * 180) / Math.PI, 1)),
              5,
            )}
          </div>

          <div className="field">
            <span className="eyebrow block mb-1.5">{t('ed.scaleLabel')}</span>
            {xfRow(
              'scale',
              xf.scale.map((v) => rnd(v, 3)),
              0.05,
              0.05,
            )}
            <label className="check mt-2.5">
              <Checkbox checked={p.uniform} onCheckedChange={(v) => p.onUniform(v === true)} />
              {t('ed.lockProportions')}
            </label>
          </div>

          <div className="presets">
            <button type="button" onClick={p.onReset}>
              {t('ed.resetElement')}
            </button>
            <button type="button" onClick={p.onDeselect}>
              {t('ed.deselect')}
            </button>
          </div>

          <p className="editHint">{t('ed.hint')}</p>
        </div>
      )}
    </div>
  );
}
