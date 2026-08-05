import proj4 from 'proj4';
import { AppError } from '@/lib/errors';
import { cutCovered } from '@/lib/geo/conform';
import { resolveCRS } from '@/lib/geo/crs';
import { ACCURACY_CELL } from '@/lib/geo/grid';
import {
  FR_BOUNDS,
  IGN_LAYERS,
  LAYER_IFC_NAME,
  fetchThemeLayer,
  parseIGN,
  rgeAltiGrid,
  siteDatumZ,
  type ThemeKey,
} from '@/lib/sources/ign';
import { TREE_CAP, osmTrees, overpass, parseOSM } from '@/lib/sources/overpass';
import { terrariumGrid } from '@/lib/sources/terrain';
import { BUILDING_CAP } from '@/lib/scene/push';
import { emptyScene } from '@/lib/types';
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
  | { ok: true; scene: SceneData; site: Site; meta: SiteMeta; summary: BuildSummary }
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

  const themes: ThemeKey[] = [];
  if (ign) {
    if (opts.veg) themes.push('veg', 'hedge');
    if (opts.water) themes.push('water');
    if (opts.parcels) themes.push('parcel');
  }

  // A rectangle can straddle the border, so every corner has to be inside.
  if (
    ign &&
    (rect.minLat < FR_BOUNDS.minLat ||
      rect.maxLat > FR_BOUNDS.maxLat ||
      rect.minLon < FR_BOUNDS.minLon ||
      rect.maxLon > FR_BOUNDS.maxLon)
  ) {
    return { ok: false, error: new AppError('err.ignOutsideFrance') };
  }

  // Projection first: every parse path below needs toLocal, and the theme
  // layers need the inverse as well to look elevation back up after clipping.
  const crs = resolveCRS(opts.epsg, lat, lon);
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
    // fresh one starts centred, on model zero, square to the grid.
    exportOffset: [0, 0, 0],
    projectBase: [0, 0, 0],
    projectAngle: 0,
    lat,
    lon,
    epsg: crs.epsg,
    crsName: crs.name,
    geodeticDatum: crs.datum,
    verticalDatum: ign ? 'NGF-IGN69' : crs.vert,
    refElevation: scene.datumZ,
    projectName: `Context ${lat.toFixed(4)}, ${lon.toFixed(4)}`,
  };

  let tagged = 0;
  let capped = false;

  try {
    if (ign) {
      const r = await parseIGN(
        scene,
        site,
        toLocal,
        toGeo,
        sampleZ,
        fallbackH,
        opts.roads,
        onStatus,
      );
      tagged = r.tagged;
      capped = r.over;
    } else {
      onStatus('status.queryingOverpass');
      const data = await overpass(site, opts.roads);
      tagged = parseOSM(scene, data, site, toLocal, toGeo, sampleZ, fallbackH, opts.roads);
      capped = scene.buildings.length >= BUILDING_CAP;
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }

  // Theme layers are context: one failing or empty layer must never cost you
  // the build, so each is reported and skipped on its own.
  const skipped: LayerKey[] = [];
  // How much of each terrain face the opaque layers end up burying.
  const coverage = new Map<number, number>();
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
        coverage,
      );
    } catch {
      skipped.push(label);
    }
  }

  // Ground that is completely under an opaque layer is ground nobody can see,
  // and leaving it in only gives a viewer's depth buffer an argument to lose.
  // Safe here: nothing reads terrain.faces during the build — conformToTerrain
  // works off verts/n, and sample closes over its own grid.
  if (scene.terrain) scene.terrain = cutCovered(scene.terrain, coverage);

  if (opts.trees) {
    onStatus('status.queryingTrees');
    try {
      scene.trees = await osmTrees(site, toLocal, sampleZ);
    } catch {
      skipped.push('layer.trees');
    }
  }

  if (!scene.buildings.length) {
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
    summary: {
      buildings: scene.buildings.length,
      tagged,
      provider: opts.provider,
      fallbackH,
      capped,
      capAt: BUILDING_CAP,
      treesCapped: scene.trees.length === TREE_CAP,
      treeCap: TREE_CAP,
      skipped,
    },
  };
}
