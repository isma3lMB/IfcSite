'use client';

import type { Ref } from 'react';
import { AxisInput } from '@/components/element-editor';
import { Radio, RadioGroup } from '@/components/ui/radio-group';
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

export type SculptPanelProps = {
  brush: SculptBrush;
  onBrush: (b: SculptBrush) => void;
  /** The terrain lattice's spacing in metres — what decides when the brush is
   *  a single vertex. Null without a terrain. */
  cell: number | null;
  /** How many vertices stand away from their surveyed height. */
  edited: number;
  onReset: () => void;
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
