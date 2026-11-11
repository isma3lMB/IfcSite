import { describe, expect, it } from 'vitest';
import { conformToTerrain } from '@/lib/geo/conform';
import { gridFrom } from '@/lib/geo/grid';
import { skirtInto } from '@/lib/geo/mesh';
import { emitIFC } from '@/lib/ifc/emit';
import { IFC_SCHEMAS, type IfcSchema } from '@/lib/ifc/writer';
import { LAYER_DZ, skirtDepth } from '@/lib/scene/stack';
import { newXf } from '@/lib/scene/xf';
import { emptyScene, newIfcMeta, type SceneData, type SiteMeta, type Vec2 } from '@/lib/types';

/* -------------------------------------------------------------------------
   Schema rules a validator holds the file to — the ones an attribute count or
   a where rule catches, and a viewer usually forgives.

   On the raw SPF text, like ifc-meta.test: what a strict reader receives.
   ------------------------------------------------------------------------- */

const meta = (schema: IfcSchema, projectAngle = 0): SiteMeta => ({
  origin: [0, 0],
  exportOffset: [0, 0, 0],
  projectBase: [0, 0, 0],
  projectAngle,
  projectBaseFromGlobal: false,
  lat: 48.8566,
  lon: 2.3522,
  epsg: 'EPSG:2154',
  crsName: 'RGF93 / Lambert-93',
  geodeticDatum: 'RGF93',
  verticalDatum: null,
  verticalDatumEpsg: null,
  crsDef:
    '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs',
  ifc: { ...newIfcMeta(), schema },
  provider: 'osm',
  fetched: '2026-08-27',
});

/** One tree: the smallest scene that sends a mesh through the writer. */
const withTree = (): SceneData => ({
  ...emptyScene(),
  trees: [
    { id: 't', x: 0, y: 0, z: 0, h: 8, cr: 2, tr: 0.2, name: 'Tree', props: {}, xf: newXf(), src: 'user' },
  ],
});

/** Entity lines of one type, keyed by id, as the text between the outer parens. */
const bodies = (text: string, type: string): Map<string, string> => {
  const out = new Map<string, string>();
  for (const l of text.split('\n')) {
    const m = l.match(new RegExp(`^(#\\d+)=${type}\\((.*)\\);$`));
    if (m) out.set(m[1], m[2]);
  }
  return out;
};

/** Split an attribute list on its top-level commas only. */
const topLevel = (body: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = '';
  for (const c of body) {
    if (c === "'") inStr = !inStr;
    if (!inStr && c === '(') depth++;
    if (!inStr && c === ')') depth--;
    if (!inStr && depth === 0 && c === ',') {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  parts.push(cur);
  return parts;
};

describe('TrueNorth', () => {
  for (const schema of IFC_SCHEMAS) {
    for (const angle of [0, 30]) {
      it(`is a 2D direction under ${schema}, project angle ${angle}`, () => {
        // North2D: NOT EXISTS(TrueNorth) OR HIINDEX(TrueNorth.DirectionRatios) = 2.
        const text = emitIFC(emptyScene(), meta(schema, angle)).text;
        const [ctx] = [...bodies(text, 'IFCGEOMETRICREPRESENTATIONCONTEXT').values()];
        const north = topLevel(ctx).at(-1) as string;
        const ratios = bodies(text, 'IFCDIRECTION').get(north);
        expect(ratios).toBeTruthy();
        expect(topLevel((ratios as string).slice(1, -1))).toHaveLength(2);
      });
    }
  }
});

describe('IfcCartesianPointList3D', () => {
  const counts = (schema: IfcSchema): number[] =>
    [...bodies(emitIFC(withTree(), meta(schema)).text, 'IFCCARTESIANPOINTLIST3D').values()].map(
      (b) => topLevel(b).length,
    );

  it('has CoordList alone under IFC4', () => {
    const c = counts('IFC4');
    expect(c.length).toBeGreaterThan(0);
    expect(c.every((n) => n === 1)).toBe(true);
  });

  it('adds the TagList under IFC4X3', () => {
    const c = counts('IFC4X3');
    expect(c.length).toBeGreaterThan(0);
    expect(c.every((n) => n === 2)).toBe(true);
  });
});

/** Two triangles sharing nothing: a sheet in two pieces, as a parcel or a road
 *  network often is. */
const withSplitSurface = (): SceneData => ({
  ...emptyScene(),
  surfaces: [
    {
      verts: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [5, 5, 0],
        [6, 5, 0],
        [5, 6, 0],
      ],
      faces: [
        [0, 1, 2],
        [3, 4, 5],
      ],
      name: 'Parcel',
      type: 'USERDEFINED',
      layer: 'parcel',
      src: 'user',
    },
  ],
});

/** Each face of a shell as the coordinate text of its loop's points — what a
 *  validator compares, rather than the point entities. */
const shellLoops = (text: string, shell: string): string[][] => {
  const faces = bodies(text, 'IFCFACE');
  const bounds = bodies(text, 'IFCFACEOUTERBOUND');
  const loops = bodies(text, 'IFCPOLYLOOP');
  const points = bodies(text, 'IFCCARTESIANPOINT');
  const refs = (s: string) => s.match(/#\d+/g) ?? [];
  return refs(shell).map((fc) => {
    const bound = refs(faces.get(fc) as string)[0] as string;
    const loop = refs(bounds.get(bound) as string)[0] as string;
    return refs(loops.get(loop) as string).map((p) => points.get(p) as string);
  });
};

const edgeKey = (a: string, b: string) => (a < b ? a + '|' + b : b + '|' + a);

describe('IfcMapConversion', () => {
  for (const schema of ['IFC4', 'IFC4X3'] as const) {
    it(`has eight attributes under ${schema}`, () => {
      const convs = [...bodies(emitIFC(emptyScene(), meta(schema)).text, 'IFCMAPCONVERSION').values()];
      expect(convs).toHaveLength(1);
      expect(topLevel(convs[0] as string)).toHaveLength(8);
    });
  }
});

describe('IFC2X3 Brep topology', () => {
  it('uses every closed-shell edge exactly twice (GEM001)', () => {
    const text = emitIFC(withTree(), meta('IFC2X3')).text;
    const shells = [...bodies(text, 'IFCCLOSEDSHELL').values()];
    expect(shells).toHaveLength(2);
    for (const s of shells) {
      const uses = new Map<string, number>();
      for (const loop of shellLoops(text, s))
        loop.forEach((p, i) => {
          const k = edgeKey(p, loop[(i + 1) % loop.length]);
          uses.set(k, (uses.get(k) ?? 0) + 1);
        });
      expect([...uses.values()].every((n) => n === 2)).toBe(true);
    }
  });

  it('writes one connected open shell per piece (BRP002)', () => {
    const text = emitIFC(withSplitSurface(), meta('IFC2X3')).text;
    const shells = [...bodies(text, 'IFCOPENSHELL').values()];
    expect(shells).toHaveLength(2);
    for (const s of shells) {
      const loops = shellLoops(text, s);
      const seen = new Set(loops[0]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const l of loops)
          if (l.some((p) => seen.has(p)) && l.some((p) => !seen.has(p))) {
            l.forEach((p) => seen.add(p));
            grew = true;
          }
      }
      expect(loops.every((l) => l.every((p) => seen.has(p)))).toBe(true);
    }
  });
});

describe('IfcBuildingElementProxy under IFC2X3', () => {
  it('writes a CompositionType, never a predefined type', () => {
    const text = emitIFC(withSplitSurface(), meta('IFC2X3')).text;
    const proxies = [...bodies(text, 'IFCBUILDINGELEMENTPROXY').values()];
    expect(proxies.length).toBeGreaterThan(0);
    for (const p of proxies) expect(['.ELEMENT.', '.COMPLEX.', '.PARTIAL.']).toContain(topLevel(p).at(-1));
  });
});

describe('IfcBuilding (SPS001)', () => {
  it('is one, aggregated under the site, under IFC2X3', () => {
    const text = emitIFC(emptyScene(), meta('IFC2X3')).text;
    const buildings = [...bodies(text, 'IFCBUILDING').keys()];
    expect(buildings).toHaveLength(1);
    const [site] = [...bodies(text, 'IFCSITE').keys()];
    const aggs = [...bodies(text, 'IFCRELAGGREGATES').values()].map(topLevel);
    expect(aggs.some((a) => a[4] === site && a[5] === `(${buildings[0]})`)).toBe(true);
  });

  for (const schema of ['IFC4', 'IFC4X3'] as const) {
    it(`is not written under ${schema}`, () => {
      expect(bodies(emitIFC(emptyScene(), meta(schema)).text, 'IFCBUILDING').size).toBe(0);
    });
  }
});

/* A road and a forest with a clearing, draped over a bumpy 2 m lattice at an
   8 m step — the coarse-block path of conformToTerrain, with the skirt hung
   under each as lib/scene/push and lib/sources/ign do. What that path hands the
   writer is the thing a validator reads, so it is checked on the file. */
const withCoarseDrape = (): SceneData => {
  const n = 40;
  const h = n; // 2 m cells
  const box = { minLat: -h, maxLat: h, minLon: -h, maxLon: h };
  const zn: number[] = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) zn.push(1.2 * Math.sin(0.5 * i) * Math.cos(0.6 * j) + 0.15 * i);
  const terrain = gridFrom(box, n, zn, (lo, la) => [lo, la]);
  const toGeo = (x: number, y: number): Vec2 => [x, y];
  const s: SceneData = { ...emptyScene(), terrain };

  const centre: Vec2[] = [];
  for (let k = 0; k <= 20; k++) {
    const t = k / 20;
    centre.push([-32 + 64 * t, -20 + 40 * t + 4 * Math.sin(t * 9)]);
  }
  const road: Vec2[] = [
    ...centre.map(([x, y]): Vec2 => [x - 2.4, y + 3.2]),
    ...centre.map(([x, y]): Vec2 => [x + 2.4, y - 3.2]).reverse(),
  ];
  const r = conformToTerrain(road, terrain, toGeo, terrain.sample, LAYER_DZ.road, [], 8);
  const skirt = skirtInto(r.verts, r.faces, skirtDepth('road'));
  r.faces.forEach((f, i) => (i < skirt ? s.roads : s.roadWalls).push(f.map((k) => r.verts[k])));

  const forest: Vec2[] = [];
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * 2 * Math.PI;
    const rad = 18 + 4 * Math.sin(5 * a);
    forest.push([-6 + rad * Math.cos(a), 12 + rad * Math.sin(a)]);
  }
  const clearing: Vec2[] = [
    [-9, 9],
    [-9, 15],
    [-3, 15],
    [-3, 9],
  ];
  const v = conformToTerrain(forest, terrain, toGeo, terrain.sample, LAYER_DZ.vegetation, [clearing], 8);
  skirtInto(v.verts, v.faces, skirtDepth('vegetation'));
  s.surfaces.push({ verts: v.verts, faces: v.faces, name: 'Forest', type: 'VEGETATION', layer: 'vegetation' });
  return s;
};

describe('a draped layer at a step coarser than the terrain', () => {
  for (const schema of ['IFC4', 'IFC4X3'] as const) {
    it(`writes no degenerate face, and a closed forest solid, under ${schema}`, () => {
      const text = emitIFC(withCoarseDrape(), meta(schema)).text;
      const faces = bodies(text, 'IFCINDEXEDPOLYGONALFACE');
      const sets = [...bodies(text, 'IFCPOLYGONALFACESET').values()];
      expect(sets.length).toBe(3); // terrain, roads, forest
      for (const set of sets) {
        const uses = new Map<string, number>();
        for (const ref of (set.match(/#\d+/g) ?? []).slice(1)) {
          const idx = (faces.get(ref) as string).match(/\d+/g)!.map(Number);
          expect(new Set(idx).size).toBe(idx.length);
          idx.forEach((a, i) => {
            const b = idx[(i + 1) % idx.length];
            const k = a < b ? `${a},${b}` : `${b},${a}`;
            uses.set(k, (uses.get(k) ?? 0) + 1);
          });
        }
        expect([...uses.values()].every((u) => u <= 2)).toBe(true);
        // The skirted forest shares its vertices across faces (the roads are
        // written one point list per face, so they are checked under IFC2X3,
        // where the writer welds them): skin, walls and floor close exactly.
        if (set === sets[2]) expect([...uses.values()].every((u) => u === 2)).toBe(true);
      }
    });
  }

  /* Every shell but the terrain's — an open sheet by nature, and the one with
     the most faces here — is a skirted layer and has to come back closed. A
     sliver dropped from the skin used to leave a notch that the skirt walked
     through twice, and the solid open. */
  it('writes no degenerate loop, and closed draped solids, under IFC2X3', () => {
    const text = emitIFC(withCoarseDrape(), meta('IFC2X3')).text;
    const shells = [...bodies(text, 'IFCOPENSHELL').values()];
    expect(shells.length).toBeGreaterThanOrEqual(3);
    const size = (sh: string) => (sh.match(/#\d+/g) ?? []).length;
    const terrain = shells.reduce((a, b) => (size(b) > size(a) ? b : a));
    for (const sh of shells) {
      const uses = new Map<string, number>();
      for (const loop of shellLoops(text, sh)) {
        expect(new Set(loop).size).toBe(loop.length);
        loop.forEach((p, i) => {
          const k = edgeKey(p, loop[(i + 1) % loop.length]);
          uses.set(k, (uses.get(k) ?? 0) + 1);
        });
      }
      expect([...uses.values()].every((u) => (sh === terrain ? u <= 2 : u === 2))).toBe(true);
    }
  });
});
