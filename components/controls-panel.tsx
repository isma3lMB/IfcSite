'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { ACCURACY_CELL, MAX_GRID_N, gridSize } from '@/lib/geo/grid';
import { rectCentre, rectSize } from '@/lib/geo/rect';
import { useT } from '@/lib/i18n/context';
import { terrariumN } from '@/lib/sources/terrain';
import type { BuildOptions, Provider, SiteRect, TerrainAccuracy } from '@/lib/types';

/**
 * CRS option labels are proper names (EPSG codes, datum names) and stay in
 * their published form; only the automatic-zone entry is translated.
 */
const CRS_OPTIONS: { value: string; label?: string; i18n?: boolean }[] = [
  { value: '2154', label: 'EPSG:2154 — RGF93 / Lambert-93 (FR)' },
  { value: 'auto', i18n: true },
  { value: '27700', label: 'EPSG:27700 — OSGB36 / British National Grid' },
  { value: '25832', label: 'EPSG:25832 — ETRS89 / UTM 32N (DE)' },
  { value: '28992', label: 'EPSG:28992 — Amersfoort / RD New (NL)' },
];

/*
 * EPSG lines and provider labels are longer than the 330px dock, so the closed
 * trigger ellipsises on one line and the open list — free to grow past the dock
 * — carries the full text. The shadcn defaults leave the selected label as a
 * flex box, where the clamp is inert and the text is cut with no ellipsis at
 * all; block + truncate is what puts the "…" back. cn() is tailwind-merge, so
 * passing the same utility group here drops the default instead of stacking.
 */
const SELECT_TRIGGER =
  'ctl-input w-full *:data-[slot=select-value]:block *:data-[slot=select-value]:truncate';
const SELECT_CONTENT = 'w-auto min-w-(--anchor-width) max-w-[min(92vw,26rem)]';
/* Wraps only once a label is too long for the cap above — a phone, in practice. */
const SELECT_ITEM = 'font-mono text-[13px] **:whitespace-normal';

export type ControlsPanelProps = {
  form: BuildOptions;
  onChange: (patch: Partial<BuildOptions>) => void;
  rect: SiteRect | null;
  onClose: () => void;
};

/**
 * Everything that describes *how* to build, as a flyout off the rail's first
 * button. These are settings you touch once before a build and then leave alone,
 * which is a poor reason to hold 330 px of the window open for the rest of the
 * session — so the panel is closed by default and slides out over the viewer.
 *
 * It is a disclosure, not a dialog: no backdrop and no focus trap, because the
 * map underneath has to stay draggable while you read it.
 */
export function ControlsPanel(p: ControlsPanelProps) {
  const { t, n } = useT();
  const ign = p.form.provider === 'ign';

  /* The trigger shows the label of the selected option rather than the bare
     value ("2154", "osm") only if the root is handed the whole map, so the list
     and the trigger both read their text from these. */
  const crsLabel = (o: (typeof CRS_OPTIONS)[number]) => (o.i18n ? t('ctl.crsAuto') : o.label!);
  const crsItems = Object.fromEntries(CRS_OPTIONS.map((o) => [o.value, crsLabel(o)]));
  const providerItems: Record<Provider, string> = {
    ign: t('ctl.sourceIgn'),
    osm: t('ctl.sourceOsm'),
    
  };
  const accuracyItems: Record<TerrainAccuracy, string> = {
    coarse: t('ctl.accuracyCoarse'),
    standard: t('ctl.accuracyStandard'),
    fine: t('ctl.accuracyFine'),
    max: t('ctl.accuracyMax'),
  };

  /* What the chosen level will actually deliver on the rectangle as drawn. The
     level names a target, and neither provider can always meet it — RGE ALTI
     runs out of point budget above ~200 m of span, and Terrarium has nothing
     below ~3 m in the tiles at all. Reporting the real grid is what stops
     "Maximum" from reading as a promise of 1 m on a kilometre-wide site. Both
     branches go through the same functions the builder does, so the two cannot
     drift apart. */
  const grid = (() => {
    if (!p.rect) return null;
    const cell = ACCURACY_CELL[p.form.terrainAccuracy];
    const { w, h } = rectSize(p.rect);
    const span = Math.max(w, h);
    const N = ign
      ? gridSize(span, cell, MAX_GRID_N)
      : terrariumN(p.rect, rectCentre(p.rect).lat, span, cell);
    return { n: N, m: span / N };
  })();

  return (
    <div className="flyout floating" id="optionsFlyout" aria-label={t('ui.options')}>
      <div className="dockHead">
        <span className="eyebrow">{t('ui.options')}</span>
        <button
          type="button"
          className="iconBtn"
          title={t('ui.close')}
          aria-label={t('ui.close')}
          onClick={p.onClose}
        >
          ✕
        </button>
      </div>

      {/* No site-extent box here any more: the rectangle's size is in the status
          bar the moment there is one, and stating it twice is what made the
          old flow bar suppress its own copy by hand. */}

      <div className="field">
        <label className="eyebrow block mb-1.5" htmlFor="epsg">
          {t('ctl.crs')}
        </label>
        <Select
          items={crsItems}
          
          value={p.form.epsg}
          onValueChange={(v) => typeof v === 'string' && p.onChange({ epsg: v })}
        >
          <SelectTrigger id="epsg" className={SELECT_TRIGGER}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={SELECT_CONTENT}>
            {CRS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className={SELECT_ITEM}>
                {crsLabel(o)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="field">
        <label className="eyebrow block mb-1.5" htmlFor="defh">
          {t('ctl.defaultHeight')}
          <span className="rangeval">{n(p.form.defaultHeight)} m</span>
        </label>
        <Slider
          id="defh"
          min={3}
          max={24}
          step={1}
          value={[p.form.defaultHeight]}
          onValueChange={(v) =>
            p.onChange({ defaultHeight: Array.isArray(v) ? v[0] : (v as number) })
          }
          className="mt-1.5"
        />
      </div>

      <div className="field">
        <label className="eyebrow block mb-1.5" htmlFor="provider">
          {t('ctl.dataSource')}
        </label>
        <Select
          items={providerItems}
          value={p.form.provider}
          onValueChange={(v) => p.onChange({ provider: v as Provider })}
        >
          <SelectTrigger id="provider" className={SELECT_TRIGGER}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={SELECT_CONTENT}>
            {(Object.keys(providerItems) as Provider[]).map((v) => (
              <SelectItem key={v} value={v} className={SELECT_ITEM}>
                {providerItems[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="field">
        <span className="eyebrow block mb-1.5">{t('ctl.include')}</span>

        <label className="check">
          <Checkbox
            checked={p.form.roads}
            onCheckedChange={(v) => p.onChange({ roads: v === true })}
          />
          {t('ctl.roads')}
        </label>

        <label className="check">
          <Checkbox
            checked={p.form.terrain}
            onCheckedChange={(v) => p.onChange({ terrain: v === true })}
          />
          {t('ctl.terrain')}
          <span className="src">{ign ? t('ctl.terrainSrcIgn') : t('ctl.terrainSrcOsm')}</span>
        </label>

        <label className="check">
          <Checkbox
            checked={p.form.trees}
            onCheckedChange={(v) => p.onChange({ trees: v === true })}
          />
          {t('ctl.trees')}
          <span className="src">OSM</span>
        </label>

        {/* IGN-only layers: dimmed and inert under the OSM provider. */}
        <div className="ign-only" aria-disabled={!ign}>
          <label className="check">
            <Checkbox
              checked={p.form.veg}
              disabled={!ign}
              onCheckedChange={(v) => p.onChange({ veg: v === true })}
            />
            {t('ctl.veg')}
            <span className="src">IGN</span>
          </label>
          <label className="check">
            <Checkbox
              checked={p.form.water}
              disabled={!ign}
              onCheckedChange={(v) => p.onChange({ water: v === true })}
            />
            {t('ctl.water')}
            <span className="src">IGN</span>
          </label>
          <label className="check">
            <Checkbox
              checked={p.form.parcels}
              disabled={!ign}
              onCheckedChange={(v) => p.onChange({ parcels: v === true })}
            />
            {t('ctl.parcels')}
            <span className="src">IGN</span>
          </label>
        </div>
      </div>

      {/* Below Include rather than above it: you tick "Terrain mesh" first, then
          say how finely to sample it. Inert without it, since it drives nothing
          else. */}
      <div className="field">
        <label className="eyebrow block mb-1.5" htmlFor="accuracy">
          {t('ctl.accuracy')}
          {grid && p.form.terrain && (
            <span className="rangeval">
              {t('ctl.accuracyCell', { n: grid.n, m: grid.m.toFixed(grid.m < 10 ? 1 : 0) })}
            </span>
          )}
        </label>
        <Select
          items={accuracyItems}
          value={p.form.terrainAccuracy}
          disabled={!p.form.terrain}
          onValueChange={(v) => p.onChange({ terrainAccuracy: v as TerrainAccuracy })}
        >
          <SelectTrigger id="accuracy" className={SELECT_TRIGGER}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={SELECT_CONTENT}>
            {(Object.keys(accuracyItems) as TerrainAccuracy[]).map((v) => (
              <SelectItem key={v} value={v} className={SELECT_ITEM}>
                {accuracyItems[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="fieldHint">{t('ctl.accuracyHint')}</div>
      </div>
    </div>
  );
}
