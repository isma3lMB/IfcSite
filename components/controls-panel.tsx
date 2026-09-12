'use client';

import { useState } from 'react';
import { CrsField } from '@/components/crs-field';
import { LAYER_ICON } from '@/components/icons';
import { Checkbox } from '@/components/ui/checkbox';
import {
  SELECT_CONTENT,
  SELECT_ITEM,
  SELECT_TRIGGER,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import {
  DEFAULT_TUNABLES,
  TUNE_RANGE,
  type Tunables,
  isDefaultTunables,
} from '@/lib/build/tunables';
import { ACCURACY_CELL, gridSize } from '@/lib/geo/grid';
import { rectCentre, rectSize } from '@/lib/geo/rect';
import { VERTICAL_DATUMS } from '@/lib/geo/vertical';
import { type StringKey, useT } from '@/lib/i18n/context';
import { terrariumN } from '@/lib/sources/terrain';
import type {
  BuildOptions,
  DrapeLayer,
  FormPatch,
  LayerId,
  Provider,
  SiteRect,
  TerrainAccuracy,
} from '@/lib/types';

/**
 * The layer's glyph, on an Include row.
 *
 * Same mark the model tree puts on the row this checkbox builds, so what you
 * tick here and what you find there are recognisably the same thing. Decoration
 * either way: the label is the text beside it, and the svg is aria-hidden.
 *
 * Takes a LayerId rather than the BuildOptions field name, because the two do
 * not quite line up — the form says `veg` and `parcels` where the scene says
 * `vegetation` and `parcel`, and hedges have no checkbox of their own at all.
 */
const Glyph = ({ id }: { id: LayerId }) => {
  const Icon = LAYER_ICON[id];
  return (
    <span className="layerIcon">
      <Icon />
    </span>
  );
};

export type ControlsPanelProps = {
  form: BuildOptions;
  onChange: (patch: FormPatch) => void;
  rect: SiteRect | null;
  onClose: () => void;
};

/**
 * One row of the Advanced group: eyebrow, live value, slider, optional hint.
 *
 * Every advanced control is one of these, and that is the whole design. These
 * numbers feed fetch deadlines and geometry loops, where a bad one is a wedged
 * tab rather than a wrong pixel — and a slider cannot emit a value outside its
 * range, a NaN, or an empty string. There is no draft state to commit, no clamp
 * policy to get wrong, and nothing to test. The exact figure stays legible in
 * `.rangeval` beside the label, the same way the height slider above shows its
 * metres, so not being able to type one costs nothing.
 */
function TuneRow(q: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  range: [number, number];
  step: number;
  disabled?: boolean;
  /** How the live value reads. Defaults to the bare number. */
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="field dimmed" aria-disabled={q.disabled || undefined}>
      <label className="eyebrow block mb-1.5" htmlFor={q.id}>
        {q.label}
        <span className="rangeval">{q.format(q.value)}</span>
      </label>
      <Slider
        id={q.id}
        min={q.range[0]}
        max={q.range[1]}
        step={q.step}
        disabled={q.disabled}
        value={[q.value]}
        onValueChange={(v) => q.onChange(Array.isArray(v) ? v[0] : (v as number))}
        className="mt-1.5"
      />
      {q.hint && <div className="fieldHint">{q.hint}</div>}
    </div>
  );
}

/**
 * The boolean sibling of TuneRow, for the one advanced group that is not a
 * number.
 *
 * Reuses the `.check` row the Include group is built from rather than inventing
 * a switch: these tick a layer the same way those do, and a second control
 * idiom inside one panel would be the only thing distinguishing them. What it
 * adds over a bare `<label className="check">` is the `.field dimmed` wrapper
 * and `aria-disabled`, so a disabled row reads the same as a disabled TuneRow
 * beside it.
 */
function TuneToggle(q: {
  label: string;
  icon: LayerId;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="check" aria-disabled={q.disabled || undefined}>
      <Checkbox
        checked={q.checked}
        disabled={q.disabled}
        onCheckedChange={(v) => q.onChange(v === true)}
      />
      <Glyph id={q.icon} />
      {q.label}
    </label>
  );
}

/** The drape rows, in the order the Include group lists the same layers, with
 *  the LayerId each one's glyph and label come from. DrapeLayer is keyed in the
 *  form's vocabulary; LAYER_ICON is keyed in the scene's. */
const DRAPE_ROWS: { key: DrapeLayer; icon: LayerId; label: StringKey }[] = [
  { key: 'roads', icon: 'roads', label: 'ctl.roads' },
  { key: 'railways', icon: 'railways', label: 'ctl.railways' },
  { key: 'veg', icon: 'vegetation', label: 'ctl.veg' },
  { key: 'water', icon: 'water', label: 'ctl.water' },
  { key: 'parcels', icon: 'parcel', label: 'ctl.parcels' },
];

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
  /* Buildings, roads and railways all come from whichever provider is selected —
     IGN BD TOPO or Overpass. Mirrors scene.vectorSource in lib/build/run.ts. */
  const vectorSrc = ign ? 'IGN' : 'OSM';
  /* The panel unmounts with the flyout, so this is born false every time it is
     opened — which is exactly the "collapsed by default" we want, without
     anything having to reset it. Deliberately not persisted for the same
     reason: a group that remembered being open would stop being advanced. */
  const [advOpen, setAdvOpen] = useState(false);

  const tune = p.form.tune;
  const setTune = (patch: Partial<Tunables>) => p.onChange({ tune: patch });

  /* Which datum comes from VERTICAL_DATUMS, the same table runBuild reads.
     Whether there is one at all is decided differently here on purpose: runBuild
     knows whether heights were actually sampled, and this can only predict it
     from the checkbox. IGN is not conditional on that checkbox because its
     absolute heights fall back to a single-post probe with terrain off (see
     siteDatumZ in lib/build/run); OSM gets a datum only once a mesh is sampled. */
  const vDatum = ign || p.form.terrain ? VERTICAL_DATUMS[p.form.provider].name : null;

  /* The trigger shows the label of the selected option rather than the bare
     value ("osm") only if the root is handed the whole map, so the list and the
     trigger both read their text from these. */
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
      ? gridSize(span, cell, tune.maxGridN)
      : terrariumN(p.rect, rectCentre(p.rect).lat, span, cell, tune.maxGridN);
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

      {/* The CRS is a build input: changing it reprojects every coordinate, so
          the scene on screen goes stale and this panel says so. The IFC schema
          used to sit under it and is not one — nothing is fetched and nothing
          moves — so it has gone to the wrench beside Download, with the rest of
          what the file says about itself. See IfcMeta in lib/types. */}
      <CrsField
        rect={p.rect}
        value={p.form.epsg}
        onChange={(epsg) => p.onChange({ epsg })}
      />

      <div className="field">
        <label className="eyebrow block mb-1.5">{t('ctl.verticalDatum')}</label>
        <span className="tag">{vDatum ?? t('ctl.verticalDatumNone')}</span>
        <div className="fieldHint">{t('ctl.verticalDatumHint')}</div>
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
            checked={p.form.terrain}
            onCheckedChange={(v) => p.onChange({ terrain: v === true })}
          />
          <Glyph id="terrain" />
          {t('ctl.terrain')}
          <span className="src">{ign ? t('ctl.terrainSrcIgn') : t('ctl.terrainSrcOsm')}</span>
        </label>

        <label className="check">
          <Checkbox
            checked={p.form.buildings}
            onCheckedChange={(v) => p.onChange({ buildings: v === true })}
          />
          <Glyph id="buildings" />
          {t('ctl.buildings')}
          <span className="src">{vectorSrc}</span>
        </label>

        <label className="check">
          <Checkbox
            checked={p.form.roads}
            onCheckedChange={(v) => p.onChange({ roads: v === true })}
          />
          <Glyph id="roads" />
          {t('ctl.roads')}
          <span className="src">{vectorSrc}</span>
        </label>

        <label className="check">
          <Checkbox
            checked={p.form.railways}
            onCheckedChange={(v) => p.onChange({ railways: v === true })}
          />
          <Glyph id="railways" />
          {t('ctl.railways')}
          <span className="src">{vectorSrc}</span>
        </label>

        <label className="check">
          <Checkbox
            checked={p.form.trees}
            onCheckedChange={(v) => p.onChange({ trees: v === true })}
          />
          <Glyph id="trees" />
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
            <Glyph id="vegetation" />
            {t('ctl.veg')}
            <span className="src">IGN</span>
          </label>
          <label className="check">
            <Checkbox
              checked={p.form.water}
              disabled={!ign}
              onCheckedChange={(v) => p.onChange({ water: v === true })}
            />
            <Glyph id="water" />
            {t('ctl.water')}
            <span className="src">IGN</span>
          </label>
          <label className="check">
            <Checkbox
              checked={p.form.parcels}
              disabled={!ign}
              onCheckedChange={(v) => p.onChange({ parcels: v === true })}
            />
            <Glyph id="parcel" />
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

      {/* Everything above says what to build; this says what the builder is
          allowed to spend doing it. Ruled off with .editSection for the same
          reason the element editor's placement block is — it is a second
          subject, not more fields belonging to the accuracy control above.

          The wrapper is always rendered so aria-controls always resolves to
          something, but what is inside it mounts only while open. An
          edge-aligned Base UI thumb measures its control on mount, and one
          mounted under `display:none` measures 0 and stays invisible until
          its value next changes. The tunables live in the form, so unmounting
          on collapse loses nothing. */}
      <div className="field editSection">
        <button
          type="button"
          className="advHead"
          aria-expanded={advOpen}
          aria-controls="advBody"
          aria-label={advOpen ? t('ctl.advHide') : t('ctl.advShow')}
          onClick={() => setAdvOpen((v) => !v)}
        >
          <span className="treeTwisty" aria-hidden="true">
            {advOpen ? '▾' : '▸'}
          </span>
          <span className="eyebrow">{t('ctl.advanced')}</span>
        </button>

        <div id="advBody" hidden={!advOpen}>
          {advOpen && (
            <>
              <div className="fieldHint">{t('ctl.advancedHint')}</div>

              <span className="eyebrow block mb-1.5 advGroup">{t('ctl.advFetch')}</span>

              <TuneRow
                id="advBuildingCap"
                label={t('ctl.advBuildingCap')}
                hint={t('ctl.advBuildingCapHint')}
                value={tune.buildingCap}
                range={TUNE_RANGE.buildingCap}
                step={100}
                disabled={!p.form.buildings}
                format={(v) => n(v)}
                onChange={(buildingCap) => setTune({ buildingCap })}
              />

              <TuneRow
                id="advTreeCap"
                label={t('ctl.advTreeCap')}
                value={tune.treeCap}
                range={TUNE_RANGE.treeCap}
                step={100}
                disabled={!p.form.trees}
                format={(v) => n(v)}
                onChange={(treeCap) => setTune({ treeCap })}
              />

              <TuneRow
                id="advSiteMax"
                label={t('ctl.advSiteMax')}
                hint={t('ctl.advSiteMaxHint')}
                value={tune.siteMax}
                range={TUNE_RANGE.siteMax}
                step={100}
                format={(v) => `${n(v)} m`}
                onChange={(siteMax) => setTune({ siteMax })}
              />

              {/* Held in ms because that is what AbortSignal.timeout takes, but
                  nobody thinks in milliseconds — so the slider steps in whole
                  seconds and converts at the boundary. */}
              <TuneRow
                id="advTimeout"
                label={t('ctl.advTimeout')}
                hint={t('ctl.advTimeoutHint')}
                value={tune.overpassTimeoutMs / 1000}
                range={[TUNE_RANGE.overpassTimeoutMs[0] / 1000, TUNE_RANGE.overpassTimeoutMs[1] / 1000]}
                step={5}
                format={(v) => `${n(v)} s`}
                onChange={(s) => setTune({ overpassTimeoutMs: s * 1000 })}
              />

              <span className="eyebrow block mb-1.5 advGroup">{t('ctl.advTerrainSec')}</span>

              <TuneRow
                id="advGridMax"
                label={t('ctl.advGridMax')}
                hint={t('ctl.advGridMaxHint')}
                value={tune.maxGridN}
                range={TUNE_RANGE.maxGridN}
                step={1}
                disabled={!p.form.terrain}
                format={(v) => t('ctl.advGridCells', { n: v })}
                onChange={(maxGridN) => setTune({ maxGridN })}
              />

              <TuneRow
                id="advConformStep"
                label={t('ctl.advConformStep')}
                hint={t('ctl.advConformStepHint')}
                value={tune.conformStep}
                range={TUNE_RANGE.conformStep}
                step={1}
                disabled={!p.form.terrain}
                format={(v) => `${n(v)} m`}
                onChange={(conformStep) => setTune({ conformStep })}
              />

              {/* Ticked means draped, which is what every one of these layers did
                  before the group existed. Unticking asks for the elevation the
                  source geometry carries instead — a bridge deck at its surveyed
                  height rather than flattened onto the ground it crosses.

                  IGN-gated, and not merely as a courtesy: OSM ways are 2D, so there
                  would be nothing to fall back to. The layers whose BD TOPO
                  geometry turns out to be flat as well are handled at build time
                  rather than here — that cannot be known before the fetch, so they
                  stay draped and say so in the element editor's z_source. */}
              <span className="eyebrow block mb-1.5 advGroup">{t('ctl.advDrape')}</span>

              <div className="field dimmed ign-only" aria-disabled={!ign}>
                {DRAPE_ROWS.map((r) => (
                  <TuneToggle
                    key={r.key}
                    label={t(r.label)}
                    icon={r.icon}
                    checked={p.form.drape[r.key]}
                    disabled={!ign}
                    onChange={(v) => p.onChange({ drape: { ...p.form.drape, [r.key]: v } })}
                  />
                ))}
                <div className="fieldHint">{t('ctl.advDrapeHint')}</div>
              </div>

              {/* None of these three is provider-gated: each was written down twice,
                  once for OSM and once for BD TOPO, and now is not. */}
              <span className="eyebrow block mb-1.5 advGroup">{t('ctl.advGeometry')}</span>

              <TuneRow
                id="advStoreyHeight"
                label={t('ctl.advStoreyHeight')}
                hint={t('ctl.advStoreyHeightHint')}
                value={tune.storeyHeight}
                range={TUNE_RANGE.storeyHeight}
                step={0.1}
                disabled={!p.form.buildings}
                format={(v) => `${n(v)} m`}
                onChange={(storeyHeight) => setTune({ storeyHeight })}
              />

              <TuneRow
                id="advLaneWidth"
                label={t('ctl.advLaneWidth')}
                value={tune.laneWidth}
                range={TUNE_RANGE.laneWidth}
                step={0.25}
                disabled={!p.form.roads}
                format={(v) => `${n(v)} m`}
                onChange={(laneWidth) => setTune({ laneWidth })}
              />

              <TuneRow
                id="advTrackWidth"
                label={t('ctl.advTrackWidth')}
                value={tune.railTrackWidth}
                range={TUNE_RANGE.railTrackWidth}
                step={0.25}
                disabled={!p.form.railways}
                format={(v) => `${n(v)} m`}
                onChange={(railTrackWidth) => setTune({ railTrackWidth })}
              />

              {/* The one setting here that changes nothing a build fetches or
                  produces, and the only one whose effect you can watch while you
                  drag it — the orbit changes pace under a camera that stays put. */}
              <span className="eyebrow block mb-1.5 advGroup">{t('ctl.advPresentation')}</span>

              {/* Held in ms because that is what the viewer's clock is in, shown in
                  whole seconds for the same reason the timeout above is. */}
              <TuneRow
                id="advOrbitCycle"
                label={t('ctl.advOrbitCycle')}
                hint={t('ctl.advOrbitCycleHint')}
                value={tune.orbitCycleMs / 1000}
                range={[TUNE_RANGE.orbitCycleMs[0] / 1000, TUNE_RANGE.orbitCycleMs[1] / 1000]}
                step={5}
                format={(v) => `${n(v)} s`}
                onChange={(s) => setTune({ orbitCycleMs: s * 1000 })}
              />

              {/* Always present, disabled at defaults, rather than appearing when
                  something is customised — a control that comes and goes moves
                  every slider above it. DEFAULT_TUNABLES is complete, so this one
                  patch resets all ten. */}
              <div className="presets">
                <button
                  type="button"
                  disabled={isDefaultTunables(tune)}
                  onClick={() => p.onChange({ tune: { ...DEFAULT_TUNABLES } })}
                >
                  {t('ctl.advReset')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
