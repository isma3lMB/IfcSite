'use client';

import type { ReactElement } from 'react';
import { AxisInput } from '@/components/element-editor';
import { IconVoid, LAYER_ICON } from '@/components/icons';
import { Checkbox } from '@/components/ui/checkbox';
import { Radio, RadioGroup } from '@/components/ui/radio-group';
import { useT } from '@/lib/i18n/context';
import type { StringKey } from '@/lib/i18n/context';
import { type TerrainView, heatGradientCss } from '@/lib/geo/relief';
import { rnd } from '@/lib/scene/xf';
import { DRAPEABLE, DRAW_LAYERS, type DrawLayer } from '@/lib/types';

/** The tools this panel speaks for. The two measure tools take no options and
 *  add nothing to the scene, so they have no panel. */
export type PanelTool = 'rect' | 'polygon' | 'tree';

/** A draw layer's glyph — the model tree's mark for the layer the shape lands
 *  in, so what you pick here and the row it shows up under look the same. A void
 *  is listed under the terrain but is not terrain, so it has its own. */
const GLYPH: Record<DrawLayer, () => ReactElement> = {
  building: LAYER_ICON.buildings,
  vegetation: LAYER_ICON.vegetation,
  roads: LAYER_ICON.roads,
  water: LAYER_ICON.water,
  void: IconVoid,
};

const TOOL_NAME: Record<PanelTool, StringKey> = {
  rect: 'draw.toolRect',
  polygon: 'draw.toolPoly',
  tree: 'draw.toolTree',
};

const VIEW_ROWS: [keyof TerrainView, StringKey][] = [
  ['xray', 'draw.xray'],
  ['vertices', 'draw.vertices'],
  ['contours', 'draw.contours'],
  ['heatmap', 'draw.heatmap'],
];

export type DrawPanelProps = {
  tool: PanelTool;
  layer: DrawLayer;
  onLayer: (l: DrawLayer) => void;
  height: number;
  onHeight: (h: number) => void;
  drape: boolean;
  onDrape: (v: boolean) => void;
  /** Whether the scene has a terrain mesh — without one there is nothing to
   *  drape onto and nothing to cut a void through. */
  hasTerrain: boolean;
  /** How the terrain is shown while the tool is open, and what the legend under
   *  the toggles needs to say: the contour interval and the heatmap's range. */
  terrainView: TerrainView;
  onTerrainView: (v: TerrainView) => void;
  contourStep: number | null;
  terrainRange: { min: number; max: number } | null;
  /** Leave the tool: the panel is the tool's, so its ✕ is the same as Esc. */
  onClose: () => void;
};

/**
 * What the next rectangle, polygon or tree becomes.
 *
 * In the element editor's corner, in the element editor's type, because it is
 * the same kind of thing one step earlier — the properties of an element before
 * it exists rather than after. The two never compete for the spot: arming a tool
 * clears the selection, and ifc-site renders this only while nothing is
 * selected.
 *
 * The height used to be a field in the status bar, alone, while every other
 * choice about the element was implicit. It lives here now beside them, and the
 * bar is back to being the two actions that end the sequence.
 *
 * Holds no state of its own: every value is React's in ifc-site and is pushed to
 * the viewer from there, so the panel closing and reopening loses nothing.
 */
export function DrawPanel(p: DrawPanelProps) {
  const { t } = useT();
  const footprint = p.tool !== 'tree';
  const drapeable = footprint && DRAPEABLE.has(p.layer);
  const needsTerrain = drapeable || (footprint && p.layer === 'void');
  const tallLabel = t(p.tool === 'tree' ? 'draw.treeHeightTitle' : 'draw.heightTitle');

  return (
    <div className="floating editPanel drawPanel" role="region" aria-label={t('draw.title')}>
      <div className="editHead">
        <div>
          <div className="eyebrow">{t('draw.title')}</div>
          <div className="editName">{t(TOOL_NAME[p.tool])}</div>
        </div>
        <div className="presets m-0! flex-none flex-nowrap">
          <button type="button" title={t('draw.close')} onClick={p.onClose}>
            ✕
          </button>
        </div>
      </div>

      {footprint && (
        <div className="field">
          <span className="eyebrow block mb-1.5" id="drawLayer">
            {t('draw.layer')}
          </span>
          <RadioGroup
            aria-labelledby="drawLayer"
            value={p.layer}
            onValueChange={(v) => p.onLayer(v as DrawLayer)}
          >
            {/* The `.check` row the Include group and the IFC panel's radio are
                built from, with the layer's glyph between the dot and the name
                exactly as an Include row carries it. */}
            {DRAW_LAYERS.map((l) => {
              const Icon = GLYPH[l];
              const off = l === 'void' && !p.hasTerrain;
              return (
                <label key={l} className="check dimmed" aria-disabled={off}>
                  <Radio value={l} disabled={off} />
                  <span className="layerIcon">
                    <Icon />
                  </span>
                  {t(`draw.${l}` as StringKey)}
                </label>
              );
            })}
          </RadioGroup>
        </div>
      )}

      {/* A building's extrusion, or a tree's total height. The surfaces are flat
          slabs on the ground like the fetched ones of their layer, and a void
          is a hole — neither has a height to give. */}
      {(!footprint || p.layer === 'building') && (
        <div className="field">
          <span className="eyebrow block mb-1.5">{t('draw.height')}</span>
          <div className="axes">
            <AxisInput
              axis="H"
              value={rnd(p.height, 2)}
              step={0.5}
              min={0.5}
              ariaLabel={tallLabel}
              onLive={(v) => {
                if (v >= 0.5) p.onHeight(v);
              }}
              onCommit={(v) => p.onHeight(Math.max(0.5, v))}
            />
          </div>
        </div>
      )}

      {drapeable && (
        <div className="field">
          <label className="check dimmed" aria-disabled={!p.hasTerrain}>
            <Checkbox
              checked={p.drape}
              disabled={!p.hasTerrain}
              onCheckedChange={(v) => p.onDrape(v === true)}
            />
            {t('draw.drape')}
          </label>
          <p className="editHint mt-1!">{t('draw.drapeHint')}</p>
        </div>
      )}

      {footprint && p.layer === 'void' && <p className="editHint">{t('draw.voidHint')}</p>}

      {footprint && p.hasTerrain && (
        <div className="field">
          <span className="eyebrow block mb-1.5">{t('draw.terrainView')}</span>
          {VIEW_ROWS.map(([key, label]) => (
            <label key={key} className="check dimmed">
              <Checkbox
                checked={p.terrainView[key]}
                onCheckedChange={(v) => p.onTerrainView({ ...p.terrainView, [key]: v === true })}
              />
              {t(label)}
            </label>
          ))}
          {p.terrainView.contours && p.contourStep !== null && (
            <p className="editHint mt-1!">
              {t('draw.contoursHint', { step: String(p.contourStep) })}
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
                {t('draw.heatmapRange', {
                  min: rnd(p.terrainRange.min, 1).toString(),
                  max: rnd(p.terrainRange.max, 1).toString(),
                })}
              </p>
            </div>
          )}
          <p className="editHint mt-1!">{t('draw.terrainViewHint')}</p>
        </div>
      )}

      {needsTerrain && !p.hasTerrain &&<p className="editHint editWarn">{t('draw.noTerrain')}</p>}
    </div>
  );
}
