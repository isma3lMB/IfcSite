'use client';

import { type Ref, useState } from 'react';
import { AxisInput } from '@/components/element-editor';
import { Checkbox } from '@/components/ui/checkbox';
import { Radio, RadioGroup } from '@/components/ui/radio-group';
import { type TerrainView, heatGradientCss } from '@/lib/geo/relief';
import { useT } from '@/lib/i18n/context';
import type { StringKey } from '@/lib/i18n/context';
import {
  SCULPT_FALLOFFS,
  SCULPT_MODES,
  SCULPT_RANGE,
  type SculptBrush,
  type SculptFalloff,
  type SculptMode,
} from '@/lib/scene/sculpt';
import { rnd } from '@/lib/scene/xf';

const FALLOFF_NAME: Record<SculptFalloff, StringKey> = {
  smooth: 'sculpt.falloffSmooth',
  linear: 'sculpt.falloffLinear',
  flat: 'sculpt.falloffFlat',
};

const VIEW_ROWS: [keyof TerrainView, StringKey][] = [
  ['xray', 'sculpt.xray'],
  ['vertices', 'sculpt.vertices'],
  ['contours', 'sculpt.contours'],
  ['heatmap', 'sculpt.heatmap'],
];

export type SculptPanelProps = {
  brush: SculptBrush;
  onBrush: (b: SculptBrush) => void;
  /** The terrain lattice's spacing in metres — what decides when the brush is
   *  a single vertex. Null without a terrain. */
  cell: number | null;
  /** How many vertices stand away from their surveyed height. */
  edited: number;
  onReset: () => void;
  /** How the ground is shown while the tool is open, and what the legend under
   *  the toggles says: the contour interval and the heatmap's height range. */
  terrainView: TerrainView;
  onTerrainView: (v: TerrainView) => void;
  contourStep: number | null;
  terrainRange: { min: number; max: number } | null;
  /** Where the viewer writes the elevation under the brush, every frame — a
   *  ref rather than state, the compass's route, so hovering does not
   *  re-render the page. */
  readoutRef: Ref<HTMLSpanElement>;
  /** Leave the tool: the panel is the tool's, so its ✕ is the same as Esc. */
  onClose: () => void;
};

/**
 * The terrain brush: what the next click or drag on the ground does to it.
 *
 * The draw panel's sibling, in its corner and its type, for the reason that
 * panel gives — the properties of an action before it is taken. Stateless like
 * it: the brush is ifc-site's and reaches the viewer through setSculptOptions.
 */
export function SculptPanel(p: SculptPanelProps) {
  const { t, n } = useT();
  const b = p.brush;
  const set = (patch: Partial<SculptBrush>) => p.onBrush({ ...b, ...patch });
  const half = p.cell !== null ? p.cell / 2 : null;
  const single = half !== null && b.radius < half;
  const viewOn = VIEW_ROWS.filter(([key]) => p.terrainView[key]).length;
  const [viewOpen, setViewOpen] = useState(viewOn > 0);
  const [rLo, rHi] = SCULPT_RANGE.radius;
  const [sLo, sHi] = SCULPT_RANGE.strength;

  return (
    <div className="floating editPanel drawPanel" role="region" aria-label={t('sculpt.title')}>
      <div className="editHead">
        <div>
          <div className="eyebrow">{t('sculpt.title')}</div>
          <div className="editName">{t('sculpt.tool')}</div>
        </div>
        <div className="presets m-0! flex-none flex-nowrap">
          <button type="button" title={t('draw.close')} onClick={p.onClose}>
            ✕
          </button>
        </div>
      </div>

      <div className="field">
        <span className="eyebrow block mb-1.5" id="sculptMode">
          {t('sculpt.mode')}
        </span>
        <RadioGroup
          aria-labelledby="sculptMode"
          value={b.mode}
          onValueChange={(v) => set({ mode: v as SculptMode })}
        >
          {SCULPT_MODES.map((m) => (
            <label key={m} className="check">
              <Radio value={m} />
              {t(`sculpt.${m}` as StringKey)}
            </label>
          ))}
        </RadioGroup>
      </div>

      <div className="field">
        <span className="eyebrow block mb-1.5">{t('sculpt.radius')}</span>
        <div className="axes">
          <AxisInput
            axis="R"
            value={rnd(b.radius, 2)}
            step={1}
            min={rLo}
            ariaLabel={t('sculpt.radiusTitle')}
            onLive={(v) => {
              if (v >= rLo && v <= rHi) set({ radius: v });
            }}
            onCommit={(v) => set({ radius: Math.min(rHi, Math.max(rLo, v)) })}
          />
        </div>
        {half !== null && (
          <p className="editHint mt-1!">
            {t('sculpt.vertexHint', { half: n(rnd(half, 1)), cell: n(rnd(p.cell!, 1)) })}
          </p>
        )}
      </div>

      {(b.mode === 'raise' || b.mode === 'lower') && (
        <div className="field">
          <span className="eyebrow block mb-1.5">{t('sculpt.strength')}</span>
          <div className="axes">
            <AxisInput
              axis="Δ"
              value={rnd(b.strength, 2)}
              step={0.1}
              min={sLo}
              ariaLabel={t('sculpt.strengthTitle')}
              onLive={(v) => {
                if (v >= sLo && v <= sHi) set({ strength: v });
              }}
              onCommit={(v) => set({ strength: Math.min(sHi, Math.max(sLo, v)) })}
            />
          </div>
        </div>
      )}

      {b.mode === 'set' && (
        <div className="field">
          <span className="eyebrow block mb-1.5">{t('sculpt.target')}</span>
          <div className="axes">
            <AxisInput
              axis="Z"
              value={rnd(b.target, 2)}
              step={0.1}
              ariaLabel={t('sculpt.targetTitle')}
              onLive={(v) => set({ target: v })}
              onCommit={(v) => set({ target: v })}
            />
          </div>
          <p className="editHint mt-1!">{t('sculpt.targetHint')}</p>
        </div>
      )}

      {b.mode === 'flatten' && <p className="editHint">{t('sculpt.flattenHint')}</p>}

      {/* A single vertex is moved whole, so how the effect fades has nothing to
          act on there. */}
      {!single && (
        <div className="field">
          <span className="eyebrow block mb-1.5" id="sculptFalloff">
            {t('sculpt.falloff')}
          </span>
          <RadioGroup
            aria-labelledby="sculptFalloff"
            value={b.falloff}
            onValueChange={(v) => set({ falloff: v as SculptFalloff })}
          >
            {SCULPT_FALLOFFS.map((f) => (
              <label key={f} className="check">
                <Radio value={f} />
                {t(FALLOFF_NAME[f])}
              </label>
            ))}
          </RadioGroup>
        </div>
      )}

      <div className="field">
        <span className="eyebrow block mb-1.5">{t('sculpt.under')}</span>
        <span ref={p.readoutRef} className="tabular-nums">
          —
        </span>
      </div>

      {/* How the ground is looked at while it is shaped: see through it, see its
          vertices, read its height as lines or as colour. Beside the brush, not
          in the options, because sculpting is where you need them — the
          vertices are what the brush moves and the colours are what it changes. */}
      {/* A disclosure, closed until asked for: most strokes never need it. The
          count beside the title says what a closed group is still doing to the
          ground, and it opens by itself when the panel comes back with a view
          already on — the tool remembers the choice, so hiding the controls of
          a see-through ground would leave nothing to turn it off with. */}
      <div className="field editSection">
        <button
          type="button"
          className="advHead"
          aria-expanded={viewOpen}
          aria-controls="sculptViewBody"
          onClick={() => setViewOpen((v) => !v)}
        >
          <span className="treeTwisty" aria-hidden="true">
            {viewOpen ? '▾' : '▸'}
          </span>
          <span className="eyebrow">
            {t('sculpt.view')}
            {!viewOpen && viewOn > 0 && ` (${viewOn})`}
          </span>
        </button>

        <div id="sculptViewBody" hidden={!viewOpen} className="mt-2">
          {viewOpen && (
            <>
              {VIEW_ROWS.map(([key, label]) => (
                <label key={key} className="check dimmed">
                  <Checkbox
                    checked={p.terrainView[key]}
                    onCheckedChange={(v) =>
                      p.onTerrainView({ ...p.terrainView, [key]: v === true })
                    }
                  />
                  {t(label)}
                </label>
              ))}
              {p.terrainView.contours && p.contourStep !== null && (
                <p className="editHint mt-1!">
                  {t('sculpt.contoursHint', { step: n(p.contourStep) })}
                </p>
              )}
              {p.terrainView.heatmap && p.terrainRange && (
                <div className="mt-1.5">
                  <div
                    aria-hidden="true"
                    className="h-2 rounded-sm"
                    style={{ background: heatGradientCss() }}
                  />
                  <p className="editHint mt-1!">
                    {t('sculpt.heatmapRange', {
                      min: n(rnd(p.terrainRange.min, 1)),
                      max: n(rnd(p.terrainRange.max, 1)),
                    })}
                  </p>
                </div>
              )}
              <p className="editHint mt-1!">{t('sculpt.viewHint')}</p>
            </>
          )}
        </div>
      </div>

      <p className="editHint">{t('sculpt.follows')}</p>

      <div className="presets">
        <button
          type="button"
          title={t('sculpt.resetTitle')}
          disabled={p.edited === 0}
          onClick={p.onReset}
        >
          {t('sculpt.reset')}
        </button>
      </div>
      {p.edited > 0 && <p className="editHint">{t('sculpt.edited', { n: n(p.edited) })}</p>}
    </div>
  );
}
