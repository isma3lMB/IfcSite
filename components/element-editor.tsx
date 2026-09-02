'use client';

import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { ColourField } from '@/components/colour-field';
import { Slider } from '@/components/ui/slider';
import { useT } from '@/lib/i18n/context';
import type { StringKey } from '@/lib/i18n/context';
import { rnd } from '@/lib/scene/xf';
import type { SiteMeta, Vec3 } from '@/lib/types';
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
  disabled,
  ariaLabel,
  onLive,
  onCommit,
}: {
  axis: string;
  value: number;
  step: number;
  min?: number;
  /** Read-only and dimmed, for a value the panel is deriving rather than taking
   *  — see the match-global checkbox below. */
  disabled?: boolean;
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
        disabled={disabled}
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
 * The opacity slider.
 *
 * Same split as the colour swatch, and for the same reason: `onValueChange`
 * fires continuously through the drag so the building ghosts live, while
 * `onValueCommitted` fires once when the thumb is released, which is the undo
 * boundary. Stored 0..1, shown 0..100.
 */
function OpacityField({
  value,
  onOpacity,
}: {
  value: number;
  onOpacity: (a: number, commit: boolean) => void;
}) {
  const { t } = useT();
  const pct = Math.round(value * 100);
  // The value goes in as a one-element array, the way the dock's height slider
  // does: components/ui/slider renders one thumb per entry, and a bare number
  // falls through to [min, max] and draws two.
  const read = (v: number | readonly number[]): number =>
    (Array.isArray(v) ? v[0] : (v as number)) / 100;

  return (
    <>
      <label className="eyebrow block mb-1.5" htmlFor="edOpacity">
        {t('ed.opacity')}
        <span className="rangeval">{t('unit.percent', { v: pct })}</span>
      </label>
      <Slider
        id="edOpacity"
        min={0}
        max={100}
        step={1}
        value={[pct]}
        onValueChange={(v) => onOpacity(read(v), false)}
        onValueCommitted={(v) => onOpacity(read(v), true)}
      />
    </>
  );
}

export type ElementEditorProps = {
  visible: boolean;
  selection: Selection | null;
  /** False for terrain, which is not a movable layer — the position row is
   *  dropped rather than shown dead. Meaningless unless the selection is one. */
  layerMovable: boolean;
  uniform: boolean;
  onUniform: (v: boolean) => void;
  onAxis: (key: AxisKey, i: number, v: number, commit: boolean) => void;
  onColor: (hex: number, commit: boolean) => void;
  onColorReset: () => void;
  onOpacity: (a: number, commit: boolean) => void;
  onHeight: (h: number, commit: boolean) => void;
  onDelete: () => void;
  onReset: () => void;
  onResetOrigin: () => void;
  onDeselect: () => void;
  /* Lets the origin's position row show the marker's absolute projected
     position (site CRS easting/northing) instead of its raw local offset from
     the site centre — see ed.originPosition. Null before a scene exists, which
     is also when the origin can't be selected. */
  siteMeta: SiteMeta | null;
  /* The local project coordinate system. Export metadata rather than a scene
     edit, so it lives outside the selection and outside the undo stack — see
     ed.projectHint. */
  projectBase: Vec3;
  projectAngle: number;
  /** Whether the project coordinates are being held equal to the global position
   *  above instead of typed. It drives the checkbox, greys the three fields out,
   *  and is what the warning under them hangs on — see ed.matchGlobalWarn. */
  matchGlobal: boolean;
  onMatchGlobal: (v: boolean) => void;
  onProjectBase: (i: number, v: number) => void;
  onProjectAngle: (v: number) => void;
  onResetPlacement: () => void;
};

/**
 * The selection inspector.
 *
 * It renders nothing at all without a selection. It used to stay on screen as a
 * header and a line of prose telling you to click a building — which is what the
 * empty 3D view already communicates, and which held a 296 px column open to say
 * it. The gizmo modes and undo/redo left too: both are global, both are on the
 * tool rail, and neither had any business appearing and disappearing with the
 * selection the way this panel does.
 */
export function ElementEditor(p: ElementEditorProps) {
  const { t } = useT();
  if (!p.visible || !p.selection) return null;

  const sel = p.selection;
  const xf = sel.xf;
  const colour = xf.color === null ? sel.defaultColor : xf.color;
  const opacity = xf.opacity;
  // The origin is a bare point: no ring to recolour, nothing to turn or stretch.
  // It reuses the position row and drops the rest rather than greying it out.
  const isOrigin = sel.kind === 'origin';
  // A layer is the same idea one level up: a colour that stamps every element in
  // it and, for the linear and surface layers, an offset. Rotation, scale,
  // opacity, height and delete are all element-level and are dropped, not
  // disabled — see selectTarget in lib/viewer/Viewer for why the gizmo refuses
  // the other two modes as well.
  const isLayer = sel.kind === 'layer';
  // Several elements at once. Only buildings and trees group, so this is never
  // true beside the two branches above.
  const many = sel.count > 1;

  /* `write` rather than p.onAxis directly, so the project-coordinate row can
     reuse AxisInput's draft/commit behaviour without pretending to be an xf. */
  const axisRow = (
    name: string,
    values: number[],
    step: number,
    write: (i: number, v: number, commit: boolean) => void,
    min?: number,
    disabled?: boolean,
  ) => (
    <div className="axes">
      {(['X', 'Y', 'Z'] as const).map((ax, i) => (
        <AxisInput
          key={ax}
          axis={ax}
          value={values[i]}
          step={step}
          min={min}
          disabled={disabled}
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
    <div className="floating editPanel">
      <div className="editHead">
        <div>
          <div className="eyebrow">{isLayer ? t('ed.layer') : t('ed.selected')}</div>
          {/* The origin and every layer report a dictionary key rather than a
              name of their own — the viewer has no language. See ORIGIN_NAME.

              With several selected there is no one name to show, so the count
              stands in and the ids go on the tooltip. Every field below still
              reads the anchor — the element clicked last — and writes to all of
              them; see editables in lib/viewer/Viewer. */}
          <div
            className={`editName${isOrigin || isLayer ? ' capFirst' : ''}`}
            title={sel.ids.join('\n')}
          >
            {many
              ? t('ed.nSelected', { n: sel.count })
              : isOrigin || isLayer
                ? t(sel.name as StringKey)
                : sel.name}
          </div>
        </div>
        {/* The one deselect affordance. There were three — this, a preset in
            each branch below, and Escape — for an action nothing rides on. */}
        <div className="presets m-0! flex-none flex-nowrap">
          <button type="button" title={t('ed.close')} onClick={p.onDeselect}>
            ✕
          </button>
        </div>
      </div>

      {isOrigin && (
        <div>
          <div className="field">
            <span className="eyebrow block mb-1.5">
              {t('ed.originPosition', { epsg: p.siteMeta?.epsg ?? '' })}
            </span>
            {axisRow(
              'pos',
              xf.pos.map((v, i) => rnd(i < 2 && p.siteMeta ? v + p.siteMeta.origin[i] : v, 2)),
              0.5,
              (i, v, commit) =>
                p.onAxis('pos', i, i < 2 && p.siteMeta ? v - p.siteMeta.origin[i] : v, commit),
            )}
          </div>

          <div className="presets">
            <button type="button" onClick={p.onResetOrigin}>
              {t('ed.resetOrigin')}
            </button>
          </div>

          <p className="editHint">{t('ed.originHint')}</p>

          {/* Where that point lands in the project's own grid. Separated by a rule
              because it answers a different question from the row above: not
              "which point is the origin" but "what does the origin get called". */}
          <div className="field editSection">
            <span className="eyebrow block mb-1.5">{t('ed.projectPlacement')}</span>

            <span className="eyebrow block mb-1.5">{t('ed.projectCoords')}</span>

            {/* The shortcut out of typing six-digit eastings by hand — and the
                one option in this panel that deliberately makes the file worse,
                which is why it carries the paragraph below rather than a hint.
                Ticked, these fields are the global position rather than an entry
                of their own, so they are shown dead and follow the marker. */}
            <label className="check mb-2">
              <Checkbox
                checked={p.matchGlobal}
                onCheckedChange={(v) => p.onMatchGlobal(v === true)}
              />
              {t('ed.matchGlobal')}
            </label>

            {axisRow(
              'project',
              p.projectBase.map((v) => rnd(v, 3)),
              1,
              (i, v) => p.onProjectBase(i, v),
              undefined,
              p.matchGlobal,
            )}
            {p.matchGlobal && <p className="editHint editWarn">{t('ed.matchGlobalWarn')}</p>}

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

      {isLayer && (
        <div>
          <div className="field">
            <label className="eyebrow block mb-1.5" htmlFor="edColor">
              {t('ed.colour')}
            </label>
            <ColourField id="edColor" value={colour} onColor={p.onColor} />

            {/* Beneath the swatch, the same pairing the element branch makes:
                colour and how solid it draws are one decision, and both are
                carried into the exported file — see ed.layerStyleHint. */}
            <div className="mt-3">
              <OpacityField value={opacity} onOpacity={p.onOpacity} />
            </div>

            <div className="presets">
              <button type="button" onClick={p.onColorReset}>
                {t('ed.defaultColour')}
              </button>
              <button type="button" onClick={() => p.onOpacity(1, true)}>
                {t('ed.solid')}
              </button>
            </div>

            <p className="editHint">{t('ed.layerStyleHint')}</p>
          </div>

          {p.layerMovable && (
            <div className="field editSection">
              <span className="eyebrow block mb-1.5">{t('ed.layerPosition')}</span>
              {xfRow(
                'pos',
                xf.pos.map((v) => rnd(v, 2)),
                0.5,
              )}
              <p className="editHint">{t('ed.layerMoveHint')}</p>
            </div>
          )}
        </div>
      )}

      {!isOrigin && !isLayer && (
        <div>
          <div className="field">
            <label className="eyebrow block mb-1.5" htmlFor="edColor">
              {t('ed.colour')}
            </label>
            <ColourField id="edColor" value={colour} onColor={p.onColor} />

            <div className="mt-3">
              <OpacityField value={opacity} onOpacity={p.onOpacity} />
            </div>

            <div className="presets">
              <button type="button" onClick={p.onColorReset}>
                {t('ed.defaultColour')}
              </button>
              <button type="button" onClick={() => p.onOpacity(1, true)}>
                {t('ed.solid')}
              </button>
            </div>
          </div>

          {/* Height is the building's own dimension, not a transform, so it sits
              above the xf rows rather than among them — but it commits the same
              way, and lands on the same undo step as the transform beside it. */}
          <div className="field">
            <span className="eyebrow block mb-1.5">{t('ed.height')}</span>
            <div className="axes">
              <AxisInput
                axis="H"
                value={rnd(sel.h, 2)}
                step={0.5}
                min={0.5}
                ariaLabel={t('ed.height')}
                onLive={(v) => p.onHeight(v, false)}
                onCommit={(v) => p.onHeight(v, true)}
              />
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

          {/* No shortcut list under this: G/R/S and D are on the rail's
              tooltips, Esc on the ✕ above, Ctrl+Z on the rail's undo, and Del
              is on the button beside this comment. */}
          <div className="presets">
            <button type="button" onClick={p.onReset}>
              {t('ed.resetElement')}
            </button>
            <button
              type="button"
              className="danger"
              title={t('ed.deleteTitle')}
              onClick={p.onDelete}
            >
              {t('ed.delete')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
