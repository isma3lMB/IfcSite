import { mapPlacementOf } from '@/lib/geo/georef';
import { treeProxy, triangulate } from '@/lib/geo/mesh';
import { dedupe, ensureCCW } from '@/lib/geo/rings';
import { cutTerrain } from '@/lib/geo/voids';
import { APPLICATION_NAME, APPLICATION_VERSION, ORIGINATING_SYSTEM } from '@/lib/ifc/writer';
import { cutRings, plinthOf } from '@/lib/scene/cut';
import { layerAlpha, layerColor } from '@/lib/scene/layers';
import { TREE_CANOPY_COLOR, TREE_TRUNK_COLOR } from '@/lib/scene/stack';
import { buildingColors } from '@/lib/scene/xf';
import { DATA_SOURCES, type DataSource, sourceOf } from '@/lib/sources/licence';
import { DEFAULT_SITE_NAME, defaultProjectName } from '@/lib/types';
import type {
  Building,
  LayerId,
  PropBag,
  RoadFace,
  SceneData,
  SiteMeta,
  SurfaceLayer,
  Tree,
  Vec2,
  Vec3,
} from '@/lib/types';
import { type Extras, type GltfFormat, type GltfPart, GltfDoc, eulerQuat } from '@/lib/gltf/writer';

/* =====================================================================
   The scene → glTF pass: what lib/ifc/emit is for the IFC.

   Element for element the same model. Every colour, opacity, plinth, cut and
   layer offset is read through the same helpers the IFC emitter reads, so the
   two downloads cannot disagree about what the site looks like. What differs is
   only what the formats can say: glTF has no georeferencing and no property
   sets, so both go into `extras` — the slot the spec reserves for application
   data — and a reader that ignores them still gets the right geometry in the
   right colours.

   Coordinates. The IFC's model coordinates, unchanged: site metres re-based on
   the origin marker, then the project base and angle, all inside one node that
   turns the Z-up model into glTF's Y-up — (x, y, z) → (x, z, -y), north running
   down -Z, which is the mapping Blender and three undo on import. So model
   (0,0,0) is the same point in both files, and a .glb dropped beside the .ifc
   lines up with it.
   ===================================================================== */

/** The export's file name, beside ifcFileName: the same stem, so the two land
 *  next to each other in a downloads folder and say which site they are. */
export const gltfFileName = (m: { lon: number; lat: number }, format: GltfFormat): string =>
  `IFCSITE_${m.lon.toFixed(4)}_${m.lat.toFixed(4)}.${format}`;

/** The media type each container is registered under. */
export const GLTF_MIME: Record<GltfFormat, string> = {
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
};

/** The group nodes' names. English and untranslated, like the licence notices:
 *  a file's structure must not change with the page's language. */
const GROUP_NAME: Record<LayerId, string> = {
  terrain: 'Terrain',
  buildings: 'Buildings',
  roads: 'Roads',
  railways: 'Railways',
  trees: 'Trees',
  vegetation: 'Vegetation',
  hedge: 'Hedges',
  water: 'Water',
  parcel: 'Parcels',
};

/** Z-up to Y-up: -90° about X. */
const Z_UP_TO_Y_UP: [number, number, number, number] = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** A copy of a property bag, or nothing when it is empty — an empty `extras`
 *  is noise on every one of four thousand nodes. */
const extrasOf = (props?: PropBag, more?: Extras): Extras | undefined => {
  const o = { ...(props ?? {}), ...(more ?? {}) };
  return Object.keys(o).length ? o : undefined;
};

/**
 * A building's prism, at its own local origin: the walls in one part and the
 * roof and floor in the other, since those are the two colours buildingColors
 * gives. The same solid addBuilding in lib/ifc/writer writes — X/Y scale in the
 * profile, Z scale in the depth, the plinth below the base — with the position
 * and rotation left to the node, exactly as the IFC leaves them to the placement.
 *
 * Every face gets vertices of its own, so the shading comes out flat, as the
 * preview's ExtrudeGeometry does.
 */
export function buildingParts(
  b: Building,
  plinth: number,
  wallMat: number,
  capMat: number,
): GltfPart[] {
  const [sx, sy, sz] = b.xf.scale;
  const r = ensureCCW(dedupe(b.ring.map((p): Vec2 => [p[0] * sx, p[1] * sy])));
  const N = r.length;
  if (N < 3) return [];
  const top = Math.max(b.h * sz, 0.1);
  const bot = plinth > 0 ? -plinth : 0;

  const walls: GltfPart = { verts: [], faces: [], material: wallMat };
  for (let i = 0; i < N; i++) {
    const a = r[i];
    const c = r[(i + 1) % N];
    const k = walls.verts.length;
    walls.verts.push([a[0], a[1], bot], [c[0], c[1], bot], [c[0], c[1], top], [a[0], a[1], top]);
    // Counter-clockwise ring, so this winding faces out.
    walls.faces.push([k, k + 1, k + 2, k + 3]);
  }

  const caps: GltfPart = { verts: [], faces: [], material: capMat };
  const tris = triangulate(r);
  for (const z of [top, bot]) {
    const k = caps.verts.length;
    for (const p of r) caps.verts.push([p[0], p[1], z]);
    for (const t of tris) {
      // Wound by its own area rather than trusted from the triangulator: the
      // roof faces up and the floor faces down, whatever order earcut chose.
      const [p, q, s] = [r[t[0]], r[t[1]], r[t[2]]];
      const up = (q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]) > 0;
      const wantUp = z === top;
      caps.faces.push(up === wantUp ? [k + t[0], k + t[1], k + t[2]] : [k + t[0], k + t[2], k + t[1]]);
    }
  }
  return [walls, caps];
}

/** A run of road or railway faces as one vertex list, fanned the way emitIFC
 *  fans them. */
const ribbon = (quads: RoadFace[]): { verts: Vec3[]; faces: number[][] } => {
  const verts: Vec3[] = [];
  const faces: number[][] = [];
  for (const q of quads) {
    const b = verts.length;
    for (const p of q) verts.push(p);
    for (let k = 2; k < q.length; k++) faces.push([b, b + k - 1, b + k]);
  }
  return { verts, faces };
};

/**
 * The scene as a glTF document, in either container.
 *
 * Re-runnable and cheap enough to call at download time: unlike the IFC this is
 * not kept warm behind a debounce, since nothing on screen reads from it.
 */
export function emitGLTF(scene: SceneData, meta: SiteMeta, format: 'glb'): Uint8Array<ArrayBuffer>;
export function emitGLTF(scene: SceneData, meta: SiteMeta, format: 'gltf'): string;
export function emitGLTF(
  scene: SceneData,
  meta: SiteMeta,
  format: GltfFormat,
): Uint8Array<ArrayBuffer> | string;
export function emitGLTF(
  scene: SceneData,
  meta: SiteMeta,
  format: GltfFormat,
): Uint8Array<ArrayBuffer> | string {
  const doc = new GltfDoc();
  const off = meta.exportOffset;
  const a = meta.ifc;
  /** Which datasets were actually written — see attribute() in lib/ifc/writer,
   *  whose rule this follows: driven off the elements, not the provider. */
  const credits = new Set<DataSource>();

  const projectName = a.projectName || defaultProjectName(meta.lat, meta.lon);
  const root = doc.node({ name: projectName, rotation: Z_UP_TO_Y_UP });
  // The project placement: q = R(-th)·(p - off) + base, the elements carrying
  // the -off half the way they do in the IFC.
  const th = (meta.projectAngle * Math.PI) / 180;
  const site = doc.node({
    name: a.siteName || DEFAULT_SITE_NAME,
    translation: [...meta.projectBase] as Vec3,
    rotation: eulerQuat([0, 0, -th]) ?? undefined,
    extras: extrasOf(
      Object.fromEntries(
        (
          [
            ['LongName', a.siteLongName],
            ['Description', a.siteDescription],
            ['LandTitleNumber', a.siteLandTitle],
          ] as const
        ).filter(([, v]) => v),
      ),
    ),
  });
  doc.adopt(root, [site]);

  /** A group under the site, holding what `fill` returns — or nothing at all
   *  when that is empty, so a layer the build skipped leaves no trace. Made
   *  after its children for the same reason: a node nothing points at is one a
   *  validator reports. */
  const group = (id: LayerId, fill: () => number[], offset?: Vec3): void => {
    const kids = fill();
    if (!kids.length) return;
    doc.adopt(site, [
      doc.node({ name: GROUP_NAME[id], children: kids, translation: offset && ([...offset] as Vec3) }),
    ]);
  };

  /** One open sheet as one node: re-based onto the model origin in its vertex
   *  list, the way addSurface writes it. */
  const sheet = (
    verts: Vec3[],
    faces: number[][],
    name: string,
    color: number,
    opacity: number,
    extras?: Extras,
  ): number[] => {
    const mat = doc.material(color, opacity, true);
    const mesh = doc.mesh([{ verts: verts.map((v) => sub(v, off)), faces, material: mat }], name);
    return mesh === null ? [] : [doc.node({ name, mesh, extras })];
  };

  if (scene.terrain) {
    group('terrain', () => {
      // Cut by the same rings as the preview's ground and the IFC's — see emitIFC.
      const ground = cutTerrain(scene.terrain!, cutRings(scene));
      const kids = sheet(
        ground.verts,
        ground.faces,
        `Terrain (${scene.terrainSource || 'Terrarium DEM'})`,
        layerColor(scene, 'terrain'),
        layerAlpha(scene, 'terrain'),
      );
      if (kids.length) credits.add(sourceOf('terrain', meta.provider));
      return kids;
    });
  }

  group('buildings', () =>
    scene.buildings.flatMap((b) => {
      const { wall, cap } = buildingColors(b);
      const parts = buildingParts(
        b,
        plinthOf(b, scene.terrain),
        doc.material(wall, b.xf.opacity),
        doc.material(cap, b.xf.opacity),
      );
      const mesh = doc.mesh(parts, b.name);
      if (mesh === null) return [];
      // Hand-drawn footprints carry no source licence — see addBuilding.
      if (b.props.Source !== 'drawn') credits.add(sourceOf('vector', meta.provider));
      return [
        doc.node({
          name: b.name,
          mesh,
          translation: sub(
            [b.center[0] + b.xf.pos[0], b.center[1] + b.xf.pos[1], (b.baseZ || 0) + b.xf.pos[2]],
            off,
          ),
          rotation: eulerQuat(b.xf.rot) ?? undefined,
          extras: extrasOf(b.props),
        }),
      ];
    }),
  );

  // Ribbon and skirt as one element, as in the IFC. The layer offset rides on
  // the group, which is where the preview applies it too.
  for (const [id, top, walls] of [
    ['roads', scene.roads, scene.roadWalls],
    ['railways', scene.railways, scene.railwayWalls],
  ] as const) {
    if (!top.length && !walls.length) continue;
    group(
      id,
      () => {
        const { verts, faces } = ribbon([...top, ...walls]);
        const kids = sheet(
          verts,
          faces,
          `${GROUP_NAME[id]} (${scene.vectorSource || 'OSM'})`,
          layerColor(scene, id),
          layerAlpha(scene, id),
        );
        if (kids.length) credits.add(sourceOf('vector', meta.provider));
        return kids;
      },
      scene.layers[id].offset,
    );
  }

  // The draped layers, one group per layer so each carries its own offset.
  const byLayer = new Map<SurfaceLayer, typeof scene.surfaces>();
  for (const s of scene.surfaces) {
    const l = s.layer ?? 'parcel';
    const list = byLayer.get(l);
    if (list) list.push(s);
    else byLayer.set(l, [s]);
  }
  for (const [layer, list] of byLayer) {
    group(
      layer,
      () =>
        list.flatMap((s) => {
          const kids = sheet(
            s.verts,
            s.faces,
            s.name,
            // `?? layerColor` for the reason emitIFC gives.
            s.color ?? layerColor(scene, layer),
            layerAlpha(scene, layer),
            extrasOf(s.props, { type: s.type }),
          );
          if (kids.length && s.src !== 'user') credits.add(sourceOf(layer, meta.provider));
          return kids;
        }),
      scene.layers[layer].offset,
    );
  }

  // One node per tree, as the IFC has one element per tree. The shape is a
  // function of the scaled dimensions and the two colours alone, so trees that
  // agree on all of them — every untouched tree of a given height — share one
  // mesh rather than each carrying a copy.
  const treeMeshes = new Map<string, number | null>();
  group('trees', () =>
    scene.trees.flatMap((t: Tree) => {
      const [sx, sy, sz] = t.xf.scale;
      const dims = {
        h: Math.max(t.h * sz, 0.1),
        cr: Math.max(t.cr * sx, 0.05),
        tr: Math.max(t.tr * sy, 0.02),
      };
      // A per-tree colour recolours the canopy alone — see addTree.
      const trunkMat = doc.material(TREE_TRUNK_COLOR, t.xf.opacity);
      const canopyMat = doc.material(t.xf.color ?? TREE_CANOPY_COLOR, t.xf.opacity);
      const key = `${dims.h}|${dims.cr}|${dims.tr}|${trunkMat}|${canopyMat}`;
      let mesh = treeMeshes.get(key);
      if (mesh === undefined) {
        const { trunk, canopy } = treeProxy(dims);
        mesh = doc.mesh([
          { ...trunk, material: trunkMat },
          { ...canopy, material: canopyMat },
        ]);
        treeMeshes.set(key, mesh);
      }
      if (mesh === null) return [];
      if (t.src !== 'user') credits.add(sourceOf('trees', meta.provider));
      return [
        doc.node({
          name: t.name,
          mesh,
          translation: sub([t.x + t.xf.pos[0], t.y + t.xf.pos[1], t.z + t.xf.pos[2]], off),
          rotation: eulerQuat(t.xf.rot) ?? undefined,
          extras: extrasOf(t.props),
        }),
      ];
    }),
  );

  /* ---- what the file says about itself --------------------------------
     The licence notice in asset.copyright, which is the field every reader
     shows; the per-source detail and the authorship beside it in extras. */
  const used = [...credits].map((k) => DATA_SOURCES[k]);
  const asset: Extras = {
    version: '2.0',
    generator: `${APPLICATION_NAME} ${APPLICATION_VERSION}`,
  };
  if (used.length) asset.copyright = used.map((l) => l.attribution).join(' ');
  const assetExtras: Extras = { originatingSystem: ORIGINATING_SYSTEM };
  if (a.author) assetExtras.author = a.author;
  if (a.organization) assetExtras.organization = a.organization;
  if (used.length) {
    assetExtras.sources = used.map((l) => ({
      source: l.source,
      license: l.licence,
      licenseUrl: l.url,
      attribution: l.attribution,
      // Omitted rather than guessed, as in the IFC — see SiteMeta.fetched.
      ...(meta.fetched ? { retrieved: meta.fetched } : {}),
    }));
  }
  asset.extras = assetExtras;

  /* The georeferencing, as the IFC states it in IfcMapConversion and
     IfcProjectedCRS. glTF has nowhere of its own to put a CRS, so the same
     numbers go in the scene's extras under the IFC's own names — a reader that
     knows one knows what these are. */
  const mp = mapPlacementOf(meta);
  const sceneExtras: Extras = {
    units: 'metre',
    upAxis: 'Y',
    projectedCRS: {
      name: meta.epsg,
      ...(meta.crsName ? { description: meta.crsName } : {}),
      ...(meta.geodeticDatum ? { geodeticDatum: meta.geodeticDatum } : {}),
      ...(meta.verticalDatumEpsg ? { verticalDatum: meta.verticalDatumEpsg } : {}),
    },
    mapConversion: {
      eastings: mp.eastings,
      northings: mp.northings,
      orthogonalHeight: mp.orthogonalHeight,
      xAxisAbscissa: mp.xAxisAbscissa,
      xAxisOrdinate: mp.xAxisOrdinate,
      scale: 1,
    },
    refLatitude: mp.markerLat,
    refLongitude: mp.markerLon,
    refElevation: off[2],
    ...Object.fromEntries(
      (
        [
          ['longName', a.projectLongName],
          ['description', a.projectDescription],
          ['phase', a.projectPhase],
        ] as const
      ).filter(([, v]) => v),
    ),
  };

  return format === 'glb'
    ? doc.toGLB([root], asset, projectName, sceneExtras)
    : doc.toGLTF([root], asset, projectName, sceneExtras);
}
