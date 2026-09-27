import { describe, expect, it } from 'vitest';
import { emitIFC } from '@/lib/ifc/emit';
import { IFC_SCHEMAS, type IfcSchema } from '@/lib/ifc/writer';
import { newXf } from '@/lib/scene/xf';
import { emptyScene, newIfcMeta, type SceneData, type SiteMeta } from '@/lib/types';

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

/** One 10 m square block; `color` set gives it a separate roof cap. */
const withBuilding = (color: number | null = null): SceneData => ({
  ...emptyScene(),
  buildings: [
    {
      id: 'b',
      name: 'Block',
      props: {},
      ring: [
        [-5, -5],
        [5, -5],
        [5, 5],
        [-5, 5],
      ],
      center: [0, 0],
      h: 12,
      baseZ: 0,
      src: 'tag:height',
      xf: { ...newXf(), color },
    },
  ],
});

describe('Building body (IFC430)', () => {
  for (const color of [null, 0x886644]) {
    const label = color === null ? 'one body' : 'body and roof cap';

    it(`is tessellated under IFC4X3, ${label}`, () => {
      const text = emitIFC(withBuilding(color), meta('IFC4X3')).text;
      expect(bodies(text, 'IFCEXTRUDEDAREASOLID').size).toBe(0);
      expect(bodies(text, 'IFCARBITRARYCLOSEDPROFILEDEF').size).toBe(0);
      const sets = [...bodies(text, 'IFCPOLYGONALFACESET').keys()];
      expect(sets).toHaveLength(color === null ? 1 : 2);
      const reps = [...bodies(text, 'IFCSHAPEREPRESENTATION').values()].map(topLevel);
      const rep = reps.find((r) => sets.some((s) => (r[3] as string).includes(s)));
      expect(rep?.[2]).toBe("'Tessellation'");
      // Each item keeps its own colour.
      const styled = [...bodies(text, 'IFCSTYLEDITEM').values()].map((s) => topLevel(s)[0]);
      for (const s of sets) expect(styled).toContain(s);
    });

    for (const schema of ['IFC2X3', 'IFC4'] as const) {
      it(`stays a swept solid under ${schema}, ${label}`, () => {
        const text = emitIFC(withBuilding(color), meta(schema)).text;
        expect(bodies(text, 'IFCEXTRUDEDAREASOLID').size).toBe(color === null ? 1 : 2);
        const reps = [...bodies(text, 'IFCSHAPEREPRESENTATION').values()].map(topLevel);
        expect(reps.some((r) => r[2] === "'SweptSolid'")).toBe(true);
      });
    }
  }
});
