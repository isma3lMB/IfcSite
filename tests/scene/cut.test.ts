import { describe, expect, it } from 'vitest';
import { gridFaces } from '@/lib/geo/grid';
import { emitIFC } from '@/lib/ifc/emit';
import { cutRings, plinthOf } from '@/lib/scene/cut';
import { pushBuilding } from '@/lib/scene/push';
import { newXf } from '@/lib/scene/xf';
import { emptyScene, newIfcMeta, type Grid, type SceneData, type SiteMeta, type Vec2, type Vec3 } from '@/lib/types';

/* -------------------------------------------------------------------------
   The terrain cut a building can ask for, and the plinth it earns: a slope
   rising 0.2 m per metre east, so a building's lowest ground is on its west
   side and known in closed form.
   ------------------------------------------------------------------------- */

const N = 10;
const zAt = (x: number) => 100 + 0.2 * x;

const terrain: Grid = (() => {
  const verts: Vec3[] = [];
  for (let j = 0; j <= N; j++)
    for (let i = 0; i <= N; i++) {
      const x = -50 + i * 10;
      const y = -50 + j * 10;
      verts.push([x, y, zAt(x)]);
    }
  return { n: N, verts, faces: gridFaces(N), sample: () => 0 };
})();

const square = (h: number): Vec2[] => [
  [-h, -h],
  [h, -h],
  [h, h],
  [-h, h],
];

/** One 10 m building at (cx, 0), its base at `baseZ`. */
const sceneWith = (cx: number, baseZ: number, cut: boolean): SceneData => {
  const s = emptyScene();
  s.terrain = terrain;
  s.datumZ = 100;
  pushBuilding(
    s,
    square(5).map(([x, y]): Vec2 => [x + cx, y]),
    12,
    'user',
    baseZ,
    'b1',
    'B1',
    { Source: 'drawn' },
  );
  if (cut) s.buildings[0].xf.cut = true;
  return s;
};

describe('plinthOf', () => {
  it('is zero for a building that does not cut', () => {
    const s = sceneWith(0, 105, false);
    expect(plinthOf(s.buildings[0], terrain)).toBe(0);
  });

  /* Base at 105 over ground running from 99 (west edge, x = -5) to 101: the
     building has to reach down six metres for nothing to hang over the hole. */
  it('reaches down to the lowest ground under the footprint', () => {
    const s = sceneWith(0, 105, true);
    expect(plinthOf(s.buildings[0], terrain)).toBeCloseTo(6, 9);
  });

  it('adds nothing when the base is already at or below that ground', () => {
    const s = sceneWith(0, 90, true);
    expect(plinthOf(s.buildings[0], terrain)).toBe(0);
  });

  /* It is measured where the building stands now, so a move re-answers it. */
  it('follows the building when it moves', () => {
    const s = sceneWith(0, 105, true);
    s.buildings[0].xf.pos = [20, 0, 0];
    // Now spanning x 15..25: lowest ground 103, base still 105.
    expect(plinthOf(s.buildings[0], terrain)).toBeCloseTo(2, 9);
  });

  it('is zero in a scene with no terrain', () => {
    const s = sceneWith(0, 105, true);
    expect(plinthOf(s.buildings[0], null)).toBe(0);
  });
});

describe('cutRings', () => {
  it('holds the footprint of every cutting building and nothing else', () => {
    expect(cutRings(sceneWith(0, 105, false))).toEqual([]);
    const rings = cutRings(sceneWith(0, 105, true));
    expect(rings).toHaveLength(1);
    expect(rings[0].map(([x]) => x).sort((a, b) => a - b)).toEqual([-5, -5, 5, 5]);
  });

  it('places a moved void where it now is', () => {
    const s = sceneWith(0, 105, false);
    s.voids.push({ id: 'v', name: 'V', ring: square(2), xf: { ...newXf(), pos: [30, 0, 0] } });
    const [r] = cutRings(s);
    expect(Math.min(...r.map(([x]) => x))).toBeCloseTo(28, 9);
  });

  it('cuts nothing in a scene with no terrain', () => {
    const s = sceneWith(0, 105, true);
    s.terrain = null;
    expect(cutRings(s)).toEqual([]);
  });
});

/* What reaches the file: the terrain faceset loses the footprint, and the
   building's wall solid starts at the lowest ground and is that much deeper. */
describe('emitIFC with a cutting building', () => {
  const meta: SiteMeta = {
    origin: [0, 0],
    exportOffset: [0, 0, 0],
    projectBase: [0, 0, 0],
    projectAngle: 0,
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
    ifc: newIfcMeta(),
    provider: 'osm',
    fetched: '',
  };

  const solids = (text: string) =>
    text.split('\n').filter((l) => l.includes('IFCEXTRUDEDAREASOLID('));

  it('writes the plinth into the extrusion, keeping the roof where it was', () => {
    const text = emitIFC(sceneWith(0, 105, true), meta).text;
    const [wall] = solids(text);
    // Depth: 12 m of building plus 6 m of plinth, less the drawn cap band.
    const depth = Number(wall.match(/,([\d.]+)\);$/)![1]);
    const cap = Number(solids(text)[1].match(/,([\d.]+)\);$/)![1]);
    expect(depth + cap).toBeCloseTo(18, 6);
    expect(text).toMatch(/IFCCARTESIANPOINT\(\(0\.,0\.,-6\.?0*\)\)/);
  });

  it('writes an uncut building exactly as before, on the shared axes', () => {
    const text = emitIFC(sceneWith(0, 105, false), meta).text;
    const depth = solids(text).reduce((s, l) => s + Number(l.match(/,([\d.]+)\);$/)![1]), 0);
    expect(depth).toBeCloseTo(12, 6);
    expect(text).not.toMatch(/IFCCARTESIANPOINT\(\(0\.,0\.,-/);
  });

  it('takes the footprint out of the terrain faceset', () => {
    const faceCount = (s: SceneData) =>
      (emitIFC(s, meta).text.match(/IFCINDEXEDPOLYGONALFACE\(/g) ?? []).length;
    const plain = faceCount(sceneWith(0, 105, false));
    const cut = faceCount(sceneWith(0, 105, true));
    expect(cut).not.toBe(plain);
  });
});
