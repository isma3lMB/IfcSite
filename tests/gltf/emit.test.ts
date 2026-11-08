import { describe, expect, it } from 'vitest';
import { gridFaces } from '@/lib/geo/grid';
import { GLTF_MIME, buildingParts, emitGLTF, gltfFileName } from '@/lib/gltf/emit';
import { eulerQuat, hexToLinear, srgbToLinear, vertexNormals } from '@/lib/gltf/writer';
import { emitIFC } from '@/lib/ifc/emit';
import { ifcFileName } from '@/lib/ifc/writer';
import { newXf } from '@/lib/scene/xf';
import {
  type Building,
  type Grid,
  type SceneData,
  type SiteMeta,
  type Vec3,
  emptyScene,
  newIfcMeta,
} from '@/lib/types';

/* -------------------------------------------------------------------------
   The glTF export, read back the way a reader reads it: the GLB container
   split into its chunks, the JSON parsed, and the binary buffer indexed through
   the accessors. What is pinned is the contract — the same model the IFC
   describes, in glTF's own conventions — rather than the bytes.
   ------------------------------------------------------------------------- */

const meta = (over: Partial<SiteMeta> = {}): SiteMeta => ({
  origin: [652000, 6862000],
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
  fetched: '2026-08-27',
  ...over,
});

const N = 4;
const terrain: Grid = (() => {
  const verts: Vec3[] = [];
  for (let j = 0; j <= N; j++)
    for (let i = 0; i <= N; i++) verts.push([-20 + i * 10, -20 + j * 10, 30 + i]);
  return { n: N, verts, faces: gridFaces(N), sample: () => 30 };
})();

const building = (over: Partial<Building> = {}): Building => ({
  id: 'b1',
  name: 'Building 1',
  props: { 'building:levels': 3 },
  ring: [
    [-5, -4],
    [5, -4],
    [5, 4],
    [-5, 4],
  ],
  center: [2, 3],
  h: 12,
  baseZ: 30,
  src: 'tag:height',
  xf: newXf(),
  ...over,
});

const fullScene = (): SceneData => {
  const s = emptyScene();
  s.terrain = terrain;
  s.datumZ = 30;
  s.buildings = [building()];
  s.roads = [
    [
      [-20, -1, 30.1],
      [20, -1, 30.1],
      [20, 1, 30.1],
    ],
  ];
  s.surfaces = [
    {
      verts: [
        [0, 0, 30.2],
        [4, 0, 30.2],
        [4, 4, 30.2],
      ],
      faces: [[0, 1, 2]],
      name: 'Pond',
      type: 'WATER',
      layer: 'water',
    },
  ];
  s.trees = [
    { id: 't1', x: 8, y: -6, z: 30, h: 8, cr: 2, tr: 0.2, name: 'Tree 1', props: {}, xf: newXf(), src: 'osm' },
    { id: 't2', x: -8, y: 6, z: 30, h: 8, cr: 2, tr: 0.2, name: 'Tree 2', props: {}, xf: newXf(), src: 'osm' },
  ];
  return s;
};

type Json = Record<string, any>;

/** A GLB split back into its JSON and its binary chunk. */
function readGLB(glb: Uint8Array): { json: Json; bin: Uint8Array } {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  expect(dv.getUint32(0, true)).toBe(0x46546c67); // 'glTF'
  expect(dv.getUint32(4, true)).toBe(2);
  expect(dv.getUint32(8, true)).toBe(glb.byteLength);
  const jsonLen = dv.getUint32(12, true);
  expect(dv.getUint32(16, true)).toBe(0x4e4f534a); // 'JSON'
  expect(jsonLen % 4).toBe(0);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen)));
  const at = 20 + jsonLen;
  if (at === glb.byteLength) return { json, bin: new Uint8Array() };
  const binLen = dv.getUint32(at, true);
  expect(dv.getUint32(at + 4, true)).toBe(0x004e4942); // 'BIN\0'
  expect(binLen % 4).toBe(0);
  return { json, bin: glb.subarray(at + 8, at + 8 + binLen) };
}

/** An accessor's numbers, read through its buffer view. */
function readAccessor(json: Json, bin: Uint8Array, i: number): number[] {
  const acc = json.accessors[i];
  const view = json.bufferViews[acc.bufferView];
  const width = acc.type === 'VEC3' ? 3 : 1;
  const start = bin.byteOffset + view.byteOffset;
  const n = acc.count * width;
  const buf = bin.buffer as ArrayBuffer;
  switch (acc.componentType) {
    case 5126:
      return [...new Float32Array(buf.slice(start, start + n * 4))];
    case 5123:
      return [...new Uint16Array(buf.slice(start, start + n * 2))];
    case 5125:
      return [...new Uint32Array(buf.slice(start, start + n * 4))];
  }
  throw new Error('unexpected component type');
}

const nodeNamed = (json: Json, name: string): Json => {
  const n = json.nodes.find((x: Json) => x.name === name);
  expect(n, name).toBeTruthy();
  return n;
};

describe('emitGLTF — container', () => {
  it('writes a GLB whose chunks are where the header says', () => {
    const { json, bin } = readGLB(emitGLTF(fullScene(), meta(), 'glb'));
    expect(json.asset.version).toBe('2.0');
    expect(json.buffers).toHaveLength(1);
    expect(json.buffers[0].uri).toBeUndefined();
    expect(json.buffers[0].byteLength).toBeLessThanOrEqual(bin.byteLength);
  });

  it('writes a .gltf that is the same document with the buffer inlined', () => {
    const text = emitGLTF(fullScene(), meta(), 'gltf');
    const json = JSON.parse(text);
    expect(json.buffers[0].uri).toMatch(/^data:application\/octet-stream;base64,/);
    const glb = readGLB(emitGLTF(fullScene(), meta(), 'glb')).json;
    // Everything but the buffer's URI is the same.
    delete json.buffers[0].uri;
    expect(json).toEqual(glb);
  });

  it('still writes a valid, empty document for an empty scene', () => {
    const { json } = readGLB(emitGLTF(emptyScene(), meta(), 'glb'));
    expect(json.meshes).toBeUndefined();
    expect(json.buffers).toBeUndefined();
    expect(json.scenes[0].nodes).toEqual([0]);
  });

  it('keeps every buffer view on a 4-byte boundary', () => {
    const { json } = readGLB(emitGLTF(fullScene(), meta(), 'glb'));
    for (const v of json.bufferViews) expect(v.byteOffset % 4).toBe(0);
  });

  it('names the file after the site, beside the IFC', () => {
    const m = meta();
    expect(gltfFileName(m, 'glb')).toBe(ifcFileName(m).replace(/\.ifc$/, '.glb'));
    expect(gltfFileName(m, 'gltf')).toBe(ifcFileName(m).replace(/\.ifc$/, '.gltf'));
    expect(GLTF_MIME.glb).toBe('model/gltf-binary');
  });
});

describe('emitGLTF — coordinates', () => {
  /** The root turns Z-up into Y-up, -90° about X. */
  it('wraps the model in one Z-up → Y-up turn', () => {
    const { json } = readGLB(emitGLTF(fullScene(), meta(), 'glb'));
    const root = json.nodes[json.scenes[0].nodes[0]];
    expect(root.rotation[0]).toBeCloseTo(-Math.SQRT1_2);
    expect(root.rotation[3]).toBeCloseTo(Math.SQRT1_2);
  });

  /** The IFC's placement: centre plus the edit, minus the origin marker. */
  it('places a building where the IFC does, re-based on the origin marker', () => {
    const s = fullScene();
    s.buildings[0].xf.pos = [1, 2, 0.5];
    const { json } = readGLB(emitGLTF(s, meta({ exportOffset: [10, 20, 30] }), 'glb'));
    const n = nodeNamed(json, 'Building 1');
    expect(n.translation[0]).toBeCloseTo(2 + 1 - 10);
    expect(n.translation[1]).toBeCloseTo(3 + 2 - 20);
    expect(n.translation[2]).toBeCloseTo(30 + 0.5 - 30);
  });

  it('re-bases sheet vertices onto the origin marker, as addSurface does', () => {
    const { json, bin } = readGLB(emitGLTF(fullScene(), meta({ exportOffset: [0, 0, 30] }), 'glb'));
    const pond = nodeNamed(json, 'Pond');
    const pos = readAccessor(json, bin, json.meshes[pond.mesh].primitives[0].attributes.POSITION);
    expect(pos[2]).toBeCloseTo(0.2, 4);
  });

  it('carries the project placement on the site node', () => {
    const { json } = readGLB(
      emitGLTF(fullScene(), meta({ projectBase: [100, 200, 5], projectAngle: 90 }), 'glb'),
    );
    const site = nodeNamed(json, 'Site');
    expect(site.translation).toEqual([100, 200, 5]);
    // R(-90°) about Z.
    expect(site.rotation[2]).toBeCloseTo(-Math.SQRT1_2);
    expect(site.rotation[3]).toBeCloseTo(Math.SQRT1_2);
  });

  it('states the same map conversion the IFC does', () => {
    const m = meta({ exportOffset: [10, 20, 35], projectBase: [3, 4, 1], projectAngle: 30 });
    const { json } = readGLB(emitGLTF(fullScene(), m, 'glb'));
    const mc = json.scenes[0].extras.mapConversion;
    const conv = emitIFC(fullScene(), m).text.match(/IFCMAPCONVERSION\(#\d+,#\d+,([^,]+),([^,]+),([^,]+),/);
    expect(conv).toBeTruthy();
    expect(mc.eastings).toBeCloseTo(Number(conv![1]), 3);
    expect(mc.northings).toBeCloseTo(Number(conv![2]), 3);
    expect(mc.orthogonalHeight).toBeCloseTo(Number(conv![3]), 3);
    expect(json.scenes[0].extras.projectedCRS.name).toBe('EPSG:2154');
  });

  it('writes POSITION bounds that match the stored floats', () => {
    const { json, bin } = readGLB(emitGLTF(fullScene(), meta(), 'glb'));
    for (const m of json.meshes)
      for (const p of m.primitives) {
        const acc = json.accessors[p.attributes.POSITION];
        const v = readAccessor(json, bin, p.attributes.POSITION);
        for (let k = 0; k < 3; k++) {
          const axis = v.filter((_, i) => i % 3 === k);
          expect(Math.min(...axis)).toBe(acc.min[k]);
          expect(Math.max(...axis)).toBe(acc.max[k]);
        }
      }
  });
});

describe('emitGLTF — appearance', () => {
  /** baseColorFactor is linear; every colour here is an sRGB hex. */
  it('converts sRGB to linear', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214, 3);
    expect(hexToLinear(0xff0000)).toEqual([1, 0, 0]);
  });

  /** A PBR default is metallic 1 — dark metal — and the preview is matte. */
  it('writes matte, non-metallic materials', () => {
    const { json } = readGLB(emitGLTF(fullScene(), meta(), 'glb'));
    for (const m of json.materials) {
      expect(m.pbrMetallicRoughness.metallicFactor).toBe(0);
      expect(m.pbrMetallicRoughness.roughnessFactor).toBe(1);
    }
  });

  it('shares one material between elements of the same colour', () => {
    const s = fullScene();
    s.buildings = [building(), building({ id: 'b2', name: 'Building 2', center: [-10, -10] })];
    const { json } = readGLB(emitGLTF(s, meta(), 'glb'));
    const mats = (n: string) =>
      json.meshes[nodeNamed(json, n).mesh].primitives.map((p: Json) => p.material);
    expect(mats('Building 1')).toEqual(mats('Building 2'));
  });

  /** One primitive at the default colours, two once the roof differs. */
  it('splits walls and roof only when their colours differ', () => {
    const s = fullScene();
    s.buildings = [building(), building({ id: 'b2', name: 'Drawn', src: 'user' })];
    const { json } = readGLB(emitGLTF(s, meta(), 'glb'));
    expect(json.meshes[nodeNamed(json, 'Building 1').mesh].primitives).toHaveLength(1);
    expect(json.meshes[nodeNamed(json, 'Drawn').mesh].primitives).toHaveLength(2);
  });

  it('blends a ghosted element and leaves the rest opaque', () => {
    const s = fullScene();
    s.buildings[0].xf.opacity = 0.4;
    const { json } = readGLB(emitGLTF(s, meta(), 'glb'));
    const m = json.materials[json.meshes[nodeNamed(json, 'Building 1').mesh].primitives[0].material];
    expect(m.alphaMode).toBe('BLEND');
    expect(m.pbrMetallicRoughness.baseColorFactor[3]).toBeCloseTo(0.4);
  });

  it('shares one mesh between identical trees', () => {
    const { json } = readGLB(emitGLTF(fullScene(), meta(), 'glb'));
    expect(nodeNamed(json, 'Tree 1').mesh).toBe(nodeNamed(json, 'Tree 2').mesh);
  });
});

describe('emitGLTF — structure and credits', () => {
  it('groups elements by layer and leaves out the empty ones', () => {
    const { json } = readGLB(emitGLTF(fullScene(), meta(), 'glb'));
    const names = json.nodes.map((n: Json) => n.name);
    for (const g of ['Terrain', 'Buildings', 'Roads', 'Water', 'Trees']) expect(names).toContain(g);
    expect(names).not.toContain('Railways');
    expect(names).not.toContain('Parcels');
  });

  /** Every node is reachable from the scene — an orphan is a validator warning. */
  it('leaves no node unreferenced', () => {
    const { json } = readGLB(emitGLTF(fullScene(), meta(), 'glb'));
    const seen = new Set<number>();
    const walk = (i: number) => {
      seen.add(i);
      for (const c of json.nodes[i].children ?? []) walk(c);
    };
    for (const r of json.scenes[0].nodes) walk(r);
    expect(seen.size).toBe(json.nodes.length);
  });

  it('carries the layer offset on the layer group', () => {
    const s = fullScene();
    s.layers.roads.offset = [0, 0, 2];
    const { json } = readGLB(emitGLTF(s, meta(), 'glb'));
    expect(nodeNamed(json, 'Roads').translation).toEqual([0, 0, 2]);
  });

  it('carries the element properties in extras', () => {
    const { json } = readGLB(emitGLTF(fullScene(), meta(), 'glb'));
    expect(nodeNamed(json, 'Building 1').extras).toEqual({ 'building:levels': 3 });
  });

  /** ODbL makes the credit a condition of use; it has to travel in the file. */
  it('credits the datasets it actually wrote', () => {
    const { json } = readGLB(emitGLTF(fullScene(), meta(), 'glb'));
    expect(json.asset.copyright).toContain('OpenStreetMap');
    expect(json.asset.copyright).toContain('Terrain Tiles');
    expect(json.asset.extras.sources.every((s: Json) => s.retrieved === '2026-08-27')).toBe(true);
  });

  it('credits nothing for a scene drawn entirely by hand', () => {
    const s = emptyScene();
    s.buildings = [building({ src: 'user', props: { Source: 'drawn' } })];
    const { json } = readGLB(emitGLTF(s, meta(), 'glb'));
    expect(json.asset.copyright).toBeUndefined();
    expect(json.asset.extras.sources).toBeUndefined();
  });

  it('names the scene and site from the IFC panel, with the same fallbacks', () => {
    const { json } = readGLB(emitGLTF(emptyScene(), meta(), 'glb'));
    expect(json.scenes[0].name).toBe('Context 48.8566, 2.3522');
    const named = readGLB(
      emitGLTF(emptyScene(), meta({ ifc: { ...newIfcMeta(), projectName: 'P', siteName: 'S', author: 'A' } }), 'glb'),
    ).json;
    expect(named.scenes[0].name).toBe('P');
    expect(named.nodes.map((n: Json) => n.name)).toContain('S');
    expect(named.asset.extras.author).toBe('A');
  });
});

describe('buildingParts', () => {
  const area = (p: Vec3, q: Vec3, r: Vec3): Vec3 => {
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  };

  /** Every face points away from the prism's centre — out, as a closed solid's must. */
  it('winds every face outward', () => {
    for (const ring of [building().ring, [...building().ring].reverse()]) {
      const parts = buildingParts(building({ ring }), 0, 0, 1);
      for (const p of parts)
        for (const f of p.faces) {
          const [a, b, c] = [p.verts[f[0]], p.verts[f[1]], p.verts[f[2]]];
          const n = area(a, b, c);
          const mid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3 - 6];
          expect(n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2]).toBeGreaterThan(0);
        }
    }
  });

  /** The same solid addBuilding writes: scale in the profile and the depth,
   *  the plinth below the base. */
  it('bakes the scale and reaches down by the plinth', () => {
    const b = building();
    b.xf.scale = [2, 1, 0.5];
    const z = buildingParts(b, 1.5, 0, 0).flatMap((p) => p.verts.map((v) => v[2]));
    const x = buildingParts(b, 1.5, 0, 0).flatMap((p) => p.verts.map((v) => v[0]));
    expect(Math.min(...z)).toBe(-1.5);
    expect(Math.max(...z)).toBe(6);
    expect(Math.max(...x)).toBe(10);
  });
});

describe('writer helpers', () => {
  /** Transcribed from three's 'XYZ' branch — a Z turn alone is the common case. */
  it('turns an XYZ Euler into a quaternion', () => {
    expect(eulerQuat([0, 0, 0])).toBeNull();
    const q = eulerQuat([0, 0, Math.PI / 2])!;
    expect(q[2]).toBeCloseTo(Math.SQRT1_2);
    expect(q[3]).toBeCloseTo(Math.SQRT1_2);
    expect(Math.hypot(...eulerQuat([0.3, -0.7, 1.2])!)).toBeCloseTo(1);
  });

  it('writes unit normals, even for a vertex only degenerate faces touch', () => {
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5]);
    const n = vertexNormals(pos, new Uint32Array([0, 1, 2, 3, 3, 3]));
    expect([...n.subarray(0, 3)]).toEqual([0, 0, 1]);
    expect([...n.subarray(9, 12)]).toEqual([0, 0, 1]);
  });
});
