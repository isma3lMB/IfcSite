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
