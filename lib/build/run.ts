import proj4 from 'proj4';
import { sanitizeTunables } from '@/lib/build/tunables';
import { AppError } from '@/lib/errors';
import type { SplitPolygon } from '@/lib/geo/boolean';
import { resolveCRS } from '@/lib/geo/crs';
import { ACCURACY_CELL } from '@/lib/geo/grid';
import { VERTICAL_DATUMS } from '@/lib/geo/vertical';
import { resetReuseCount, reuseCount } from '@/lib/sources/cache';
import {
  IGN_LAYERS,
  LAYER_IFC_NAME,
  fetchThemeLayer,
  isOutsideFrance,
  parseIGN,
  rgeAltiGrid,
  siteDatumZ,
  type ThemeKey,
} from '@/lib/sources/ign';
import { osmTrees, overpass, parseOSM } from '@/lib/sources/overpass';
import { terrariumGrid } from '@/lib/sources/terrain';
import { finishRailways, finishRoads } from '@/lib/scene/push';
import { emptyScene, newIfcMeta } from '@/lib/types';
import { paint } from '@/lib/ui/yield';
import type { LayerKey } from '@/lib/i18n/keys';
import type {
  BuildOptions,
  BuildSummary,
  SampleZ,
  SceneData,
  Site,
  SiteMeta,
  SiteRect,
  StatusFn,
  ToGeo,
  ToLocal,
  Vec2,
} from '@/lib/types';

export type BuildResult =
  | {
      ok: true;
      scene: SceneData;
      site: Site;
      meta: SiteMeta;
      summary: BuildSummary;
      /** The proj4 definition the scene was projected through.
       *
       *  Carried out rather than dropped because a saved site has to rebuild its
       *  terrain lattice on reopening, and resolveCRS would otherwise have to be
       *  called again — which for anything outside the curated four means
       *  fetching the generated EPSG index. Handing the string back is what
       *  keeps opening a draft an offline operation. See lib/io/draft. */
      crsDef: string;
    }
  | { ok: false; error: AppError | Error };

/** What a degraded step reports as its cause: the i18n code when we raised it
 *  ourselves, and whatever the network said when we did not. */
const detailOf = (e: unknown): string =>
  e instanceof AppError ? e.code : e instanceof Error ? e.message : String(e);

/**
 * The whole fetch-and-build pass, lifted out of the DOM: inputs arrive as
 * arguments rather than being read back out of form controls, and a fresh
 * SceneData is returned rather than a module-global being mutated.
 */
export async function runBuild(
  rect: SiteRect,
  opts: BuildOptions,
  onStatus: StatusFn,
): Promise<BuildResult> {
  const lat = (rect.minLat + rect.maxLat) / 2;
  const lon = (rect.minLon + rect.maxLon) / 2;
  const ign = opts.provider === 'ign';
  const fallbackH = opts.defaultHeight;
  // Re-checked here rather than trusted from the caller. The panel's sliders
  // cannot produce a bad value, but the panel is not the only way one arrives:
  // these are restored from localStorage, where a hand-edited or stale blob can
  // carry a NaN that would turn every `length >= cap` guard below into a no-op.
  const tune = sanitizeTunables(opts.tune);
  // Counted per build, not per session: the summary is answering "why was THIS
  // one instant", so a running total would be the wrong number.
  resetReuseCount();

  const themes: ThemeKey[] = [];
  if (ign) {
    if (opts.veg) themes.push('veg', 'hedge');
    if (opts.water) themes.push('water');
    if (opts.parcels) themes.push('parcel');
  }

  if (ign && isOutsideFrance(rect)) {
    return { ok: false, error: new AppError('err.ignOutsideFrance') };
  }

  // Projection first: every parse path below needs toLocal, and the theme
  // layers need the inverse as well to look elevation back up after clipping.
  // Resolving a code outside the curated four reads the generated index, so this
  // is the one step here that can fail before any network work is attempted —
  // and a failure has to come back as a result, not a rejection: the caller
  // awaits this and has no catch of its own.
  let crs;
  try {
    // Anything outside the curated four fetches a megabyte of generated index
    // before a single tile is asked for, so this is worth naming.
    onStatus('status.resolvingCrs');
    crs = await resolveCRS(opts.epsg, lat, lon);
  } catch (e) {
    return { ok: false, error: e instanceof AppError ? e : new AppError('err.crsIndexUnavailable') };
  }
  proj4.defs('TARGET', crs.def);
  const fwd = (lo: number, la: number): Vec2 => proj4('EPSG:4326', 'TARGET', [lo, la]) as Vec2;
  const origin = fwd(lon, lat);
  const toLocal: ToLocal = (lo, la) => {
    const p = fwd(lo, la);
    return [p[0] - origin[0], p[1] - origin[1]];
  };
  const toGeo: ToGeo = (x, y) => proj4('TARGET', 'EPSG:4326', [x + origin[0], y + origin[1]]) as Vec2;

  // The drawn rectangle is a WGS84 one, so in the projected CRS it is slightly
  // rotated by grid convergence. Taking the larger corner magnitude gives a
  // local box that contains what was drawn rather than cropping a sliver off it.
  const c1 = toLocal(rect.minLon, rect.minLat);
  const c2 = toLocal(rect.maxLon, rect.maxLat);
  const halfX = Math.max(Math.abs(c1[0]), Math.abs(c2[0]));
  const halfY = Math.max(Math.abs(c1[1]), Math.abs(c2[1]));
  // radius is only what the camera frames on; the extent itself is halfX/halfY.
  const site: Site = { ...rect, lat, lon, halfX, halfY, radius: Math.max(halfX, halfY) };

  const scene = emptyScene();
  scene.vectorSource = ign ? 'IGN BD TOPO' : 'OSM';

  // Terrain first so everything else can sit on it — and, with it, the scene's
  // vertical datum, which decides not just where things sit but whether an
  // absolute altitude off a source may be believed at all.
  let sampleZ: SampleZ = () => 0;
  if (opts.terrain) {
    onStatus(ign ? 'status.samplingAlti' : 'status.readingTerrainTile');
    try {
      const t = await (ign ? rgeAltiGrid : terrariumGrid)(
        site,
        toLocal,
        ACCURACY_CELL[opts.terrainAccuracy],
        onStatus,
        tune,
      );
      scene.terrain = t;
      scene.terrainSource = ign ? 'IGN RGE ALTI' : 'Terrarium DEM';
      scene.datumZ = t.sample(lat, lon);
      sampleZ = (la, lo) => t.sample(la, lo);
    } catch (e) {
      onStatus('status.terrainUnavailable', { detail: detailOf(e) });
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  // BD TOPO hands out an absolute NGF building base whether or not a mesh was
  // asked for, so the IGN path needs a datum either way: without one the roads,
  // the reference grid and the camera stay at sea level while the buildings hang
  // hundreds of metres overhead. A single post buys a flat datum at the site's
  // real altitude. If even that is unreachable the scene stays honestly flat and
  // parseIGN drops the absolute bases along with it — see lib/sources/ign.
  if (ign && scene.datumZ === null) {
    try {
      const z0 = await siteDatumZ(site);
      scene.datumZ = z0;
      sampleZ = () => z0;
    } catch (e) {
      onStatus('status.datumUnavailable', { detail: detailOf(e) });
    }
  }

  const meta: SiteMeta = {
    origin,
    // The origin marker and its placement fields write these after the build; a
    // fresh one starts centred, resting on the ground, square to the grid.
    //
    // The ground height is settled here rather than left for the viewer to fill
    // in, because the emitter serialises the moment it is handed this object —
    // before the viewer has drawn anything. Defaulted to zero and corrected
    // afterwards, that first file would be written with nothing to subtract and
    // every element would carry its absolute altitude. Viewer.setScene puts the
    // marker on this same number, so the two never disagree.
    exportOffset: [0, 0, scene.datumZ ?? 0],
    projectBase: [0, 0, 0],
    projectAngle: 0,
    lat,
    lon,
    epsg: crs.epsg,
    crsName: crs.name,
    geodeticDatum: crs.datum,
    // The vertical datum follows the DEM — see VERTICAL_DATUMS for why it is the
    // elevation source that names it and not the site's country. With no
    // altimetry there is no datum to declare, and naming one would be a claim
    // nothing in the file supports. This is also RefElevation's null rule — see
    // ContextModel in lib/ifc/writer, which derives the actual number from
    // wherever the origin marker sits rather than from anything here.
    verticalDatum: scene.datumZ === null ? null : VERTICAL_DATUMS[opts.provider].name,
    verticalDatumEpsg: scene.datumZ === null ? null : VERTICAL_DATUMS[opts.provider].epsg,
    crsDef: crs.def,
    // Blank, not seeded from the form: the schema, the names and the authorship
    // are the user's and survive a rebuild, so components/ifc-site stamps the
    // bag it has been holding straight into this meta once the build lands. An
    // untouched bag writes the file this wrote before it existed — see IfcMeta.
    ifc: newIfcMeta(),
    provider: opts.provider,
    // The build's own date, for the Licence Ouverte's "date de la dernière mise
    // à jour" — see SiteMeta.fetched. Stamped here rather than per request:
    // the terrain is already down and the vectors follow within seconds, so to
    // the day this is the date every source was queried.
    fetched: new Date().toISOString().slice(0, 10),
  };

  let tagged = 0;
  let capped = false;
  let roadRibbons: SplitPolygon[] = [];
  let railwayRibbons: SplitPolygon[] = [];

  try {
    if (ign) {
      const r = await parseIGN(
        scene,
        site,
        toLocal,
        toGeo,
        sampleZ,
        fallbackH,
        opts.buildings,
        opts.roads,
        opts.railways,
        onStatus,
        tune,
      );
      tagged = r.tagged;
      capped = r.over;
      roadRibbons = r.roadRibbons;
      railwayRibbons = r.railwayRibbons;
    } else {
      onStatus('status.queryingOverpass');
      const data = await overpass(site, opts.buildings, opts.roads, opts.railways, tune, onStatus);
      // Thousands of ways turned into footprints, all of it synchronous: without
      // the yield this line is set and replaced without ever reaching the screen.
      onStatus('status.parsingBuildings');
      await paint();
      const r = parseOSM(
        scene,
        data,
        site,
        toLocal,
        sampleZ,
        fallbackH,
        opts.buildings,
        opts.roads,
        opts.railways,
        tune,
      );
      tagged = r.tagged;
      roadRibbons = r.roadRibbons;
      railwayRibbons = r.railwayRibbons;
      capped = scene.buildings.length >= tune.buildingCap;
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }

  // Theme layers are context: one failing or empty layer must never cost you
  // the build, so each is reported and skipped on its own.
  const skipped: LayerKey[] = [];
  for (const key of themes) {
    const label = IGN_LAYERS[key].label!;
    onStatus('status.fetchingIgnLayer', { layer: label });
    try {
      await fetchThemeLayer(
        scene,
        key,
        site,
        toLocal,
        toGeo,
        sampleZ,
        LAYER_IFC_NAME[key],
        tune,
        onStatus,
      );
    } catch {
      skipped.push(label);
    }
  }

  // Merges every road's own ribbon where they cross, then conforms the result
  // to the terrain and hangs a skirt under it. Polygon booleans over a few
  // hundred ribbons is the longest synchronous stretch in this file.
  if (roadRibbons.length || railwayRibbons.length) {
    onStatus('status.buildingRoads');
    await paint();
  }
  finishRoads(scene, roadRibbons, toGeo, sampleZ, tune);
  finishRailways(scene, railwayRibbons, toGeo, sampleZ, tune);

  if (opts.trees) {
    onStatus('status.queryingTrees');
    try {
      scene.trees = await osmTrees(site, toLocal, sampleZ, tune, onStatus);
    } catch {
      skipped.push('layer.trees');
    }
  }

  if (opts.buildings && !scene.buildings.length) {
    // A bounding box cannot tell France from its neighbours, so an empty IGN
    // result is just as likely to mean "off coverage" as "nothing built here".
    return {
      ok: false,
      error: new AppError(ign ? 'err.noBuildingsIgn' : 'err.noBuildingsOsm'),
    };
  }

  return {
    ok: true,
    scene,
    site,
    meta,
    crsDef: crs.def,
    summary: {
      buildings: scene.buildings.length,
      tagged,
      provider: opts.provider,
      fallbackH,
      capped,
      capAt: tune.buildingCap,
      treesCapped: scene.trees.length === tune.treeCap,
      treeCap: tune.treeCap,
      skipped,
      reused: reuseCount(),
    },
  };
}
