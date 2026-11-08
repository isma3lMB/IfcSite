import type { Vec3 } from '@/lib/types';

/* =====================================================================
   gltf-writer — glTF 2.0 serialiser, binary (.glb) and JSON (.gltf)

   The mesh-exchange sibling of lib/ifc/writer, and framework-free for the same
   reason: no renderer, no DOM, nothing that needs a browser, so the whole emit
   path runs under plain Node and is tested there. three's own GLTFExporter was
   the obvious alternative and was passed over on purpose — it exports whatever
   the viewer happens to have in its scene graph (the sky dome, the gizmo, the
   edge overlays, the origin marker, the measure lines), in whatever colours the
   current theme lit it with. This writes from the scene records, as the IFC
   does, so the two deliverables describe the same model.

   Deliberately small. One buffer, one scene, positions and normals, a matte
   material per distinct colour. No textures, no animation, no extensions — the
   glTF core is what every reader handles, and nothing here needs more.
   ===================================================================== */

/** Which of the two containers the same document goes out in. */
export type GltfFormat = 'glb' | 'gltf';

export const GLTF_FORMATS: GltfFormat[] = ['glb', 'gltf'];

/** What Download writes: the IFC, or the same model as glTF in either container.
 *  Here rather than beside the IFC writer because this module imports nothing
 *  at runtime, and the export panel reads the list. */
export type ExportFormat = 'ifc' | GltfFormat;

export const EXPORT_FORMATS: ExportFormat[] = ['ifc', 'glb', 'gltf'];

/** JSON a glTF `extras` slot can hold. */
export type Extras = Record<string, unknown>;

/** The colour space conversion glTF asks for: baseColorFactor is LINEAR, and
 *  every colour in this app is an sRGB hex. The same transfer function three's
 *  ColorManagement applies, so the file is lit the way the preview was. */
export const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

/** An sRGB hex as linear 0..1 RGB. */
export const hexToLinear = (hex: number): [number, number, number] => [
  srgbToLinear(((hex >> 16) & 255) / 255),
  srgbToLinear(((hex >> 8) & 255) / 255),
  srgbToLinear((hex & 255) / 255),
];

/**
 * An XYZ Euler (radians) as a unit quaternion [x, y, z, w].
 *
 * Transcribed from three's Quaternion.setFromEuler 'XYZ' branch for the reason
 * xfAxes in lib/geo/euler is: the preview poses every mesh with
 * `rotation.set(x, y, z, 'XYZ')`, and the file has to agree with what the user
 * was shown. Null when unrotated, so the node can leave the field out.
 */
export function eulerQuat(rot: Vec3): [number, number, number, number] | null {
  if (!rot || (!rot[0] && !rot[1] && !rot[2])) return null;
  const c1 = Math.cos(rot[0] / 2);
  const c2 = Math.cos(rot[1] / 2);
  const c3 = Math.cos(rot[2] / 2);
  const s1 = Math.sin(rot[0] / 2);
  const s2 = Math.sin(rot[1] / 2);
  const s3 = Math.sin(rot[2] / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

/**
 * Area-weighted vertex normals over an indexed triangle list.
 *
 * The same rule three's computeVertexNormals applies to the indexed geometry the
 * viewer builds (facesetGeometry in lib/viewer/Viewer), so a vertex shared
 * between faces — the terrain lattice, a tree trunk's sides — is shaded smooth
 * and one that is not — a building wall, a canopy facet — comes out flat. Which
 * of the two a part gets is therefore decided by how its vertices are shared,
 * exactly as on screen, and not by a flag here.
 *
 * glTF requires a unit NORMAL, so a vertex only degenerate faces touch gets +Z
 * rather than the zero vector it would otherwise normalise to.
 */
export function vertexNormals(pos: Float32Array, idx: Uint32Array): Float32Array {
  const n = new Float32Array(pos.length);
  for (let k = 0; k < idx.length; k += 3) {
    const a = idx[k] * 3;
    const b = idx[k + 1] * 3;
    const c = idx[k + 2] * 3;
    const ux = pos[b] - pos[a];
    const uy = pos[b + 1] - pos[a + 1];
    const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a];
    const vy = pos[c + 1] - pos[a + 1];
    const vz = pos[c + 2] - pos[a + 2];
    // Unnormalised: its length is twice the triangle's area, which is the weight.
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) {
      n[i] += nx;
      n[i + 1] += ny;
      n[i + 2] += nz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]);
    if (l > 1e-12) {
      n[i] /= l;
      n[i + 1] /= l;
      n[i + 2] /= l;
    } else {
      n[i] = 0;
      n[i + 1] = 0;
      n[i + 2] = 1;
    }
  }
  return n;
}

/** One coloured piece of a mesh: vertices, and faces indexing them. Faces may
 *  be any convex polygon; they are fanned into triangles on the way in. */
export type GltfPart = { verts: Vec3[]; faces: number[][]; material: number };

/** A node as this writer builds it. Indices are into the document's own arrays. */
export type GltfNode = {
  name?: string;
  mesh?: number;
  children?: number[];
  translation?: Vec3;
  rotation?: [number, number, number, number];
  extras?: Extras;
};

type BufferView = { buffer: 0; byteOffset: number; byteLength: number; target?: number };
type Accessor = {
  bufferView: number;
  componentType: number;
  count: number;
  type: 'SCALAR' | 'VEC3';
  min?: number[];
  max?: number[];
};
type Primitive = {
  attributes: { POSITION: number; NORMAL: number };
  indices: number;
  material: number;
  mode: 4;
};

const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

/** GLB chunk types and header magic — the ASCII of 'JSON', 'BIN\0' and 'glTF',
 *  little-endian. */
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const GLB_MAGIC = 0x46546c67;

const pad4 = (n: number): number => (n + 3) & ~3;

/**
 * A glTF document under construction.
 *
 * Materials are deduplicated on what they say, so four thousand buildings at the
 * sourced default share one material rather than carrying four thousand copies
 * of the same off-white. Everything else is appended as it comes.
 */
export class GltfDoc {
  private readonly nodes: GltfNode[] = [];
  private readonly meshes: { name?: string; primitives: Primitive[] }[] = [];
  private readonly materials: unknown[] = [];
  private readonly materialKeys = new Map<string, number>();
  private readonly views: BufferView[] = [];
  private readonly accessors: Accessor[] = [];
  /** The binary payload, as the chunks it will be concatenated from. */
  private readonly chunks: Uint8Array[] = [];
  private byteLength = 0;

  /**
   * A matte material: no metal, full roughness.
   *
   * The preview shades with MeshLambert, which has no specular term at all, and
   * a glTF reader left to the PBR defaults (metallic 1, roughness 1) renders
   * every surface as dark metal. Spelled out for the same reason the IFC writer
   * spells out every rendering attribute — see style() in lib/ifc/writer.
   *
   * `doubleSided` for open sheets: terrain, roads and the draped layers are
   * seen from below as often as from above in an orbiting viewer, and the
   * preview draws them that way.
   */
  material(hex: number, opacity = 1, doubleSided = false): number {
    const a = Math.min(Math.max(opacity, 0), 1);
    const key = `${hex}|${a}|${doubleSided}`;
    const hit = this.materialKeys.get(key);
    if (hit !== undefined) return hit;
    const [r, g, b] = hexToLinear(hex);
    const m: Record<string, unknown> = {
      name: '#' + hex.toString(16).padStart(6, '0') + (a < 1 ? ` ${Math.round(a * 100)}%` : ''),
      pbrMetallicRoughness: {
        baseColorFactor: [r, g, b, a],
        metallicFactor: 0,
        roughnessFactor: 1,
      },
    };
    if (a < 1) m.alphaMode = 'BLEND';
    if (doubleSided) m.doubleSided = true;
    const i = this.materials.push(m) - 1;
    this.materialKeys.set(key, i);
    return i;
  }

  private bytes(data: Uint8Array, target?: number): number {
    const view: BufferView = { buffer: 0, byteOffset: this.byteLength, byteLength: data.byteLength };
    if (target) view.target = target;
    this.chunks.push(data);
    this.byteLength += data.byteLength;
    // Every view starts on a 4-byte boundary: a float accessor demands it, and
    // a uint16 index view followed by a float view would otherwise misalign it.
    const gap = pad4(this.byteLength) - this.byteLength;
    if (gap) {
      this.chunks.push(new Uint8Array(gap));
      this.byteLength += gap;
    }
    return this.views.push(view) - 1;
  }

  private vec3(data: Float32Array, minMax: boolean): number {
    const view = this.bytes(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), ARRAY_BUFFER);
    const acc: Accessor = { bufferView: view, componentType: FLOAT, count: data.length / 3, type: 'VEC3' };
    // POSITION is required to carry its bounds; the reader frames the model off
    // them. Taken from the float32 values, not the doubles they came from, so
    // the bounds are exactly the stored numbers — the validator checks that.
    if (minMax) {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < data.length; i++) {
        const k = i % 3;
        if (data[i] < min[k]) min[k] = data[i];
        if (data[i] > max[k]) max[k] = data[i];
      }
      acc.min = min;
      acc.max = max;
    }
    return this.accessors.push(acc) - 1;
  }

  private indices(idx: Uint32Array, vertexCount: number): number {
    // Sixteen bits wherever they reach, which is every building and tree: half
    // the index bytes for the elements the file has most of.
    const narrow = vertexCount <= 0xffff;
    const data = narrow ? Uint16Array.from(idx) : idx;
    const view = this.bytes(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      ELEMENT_ARRAY_BUFFER,
    );
    return (
      this.accessors.push({
        bufferView: view,
        componentType: narrow ? UNSIGNED_SHORT : UNSIGNED_INT,
        count: idx.length,
        type: 'SCALAR',
      }) - 1
    );
  }

  /**
   * One mesh from its coloured parts, or null when none of them has a face.
   *
   * A part is one primitive. Two parts on the same material are merged into one
   * first: a building at its default colours has walls and caps in the same
   * off-white, and two draw calls for one colour is the reader's cost for
   * nothing.
   */
  mesh(parts: GltfPart[], name?: string): number | null {
    const byMat = new Map<number, { verts: Vec3[]; faces: number[][] }>();
    for (const p of parts) {
      if (!p.verts.length || !p.faces.length) continue;
      let m = byMat.get(p.material);
      if (!m) byMat.set(p.material, (m = { verts: [], faces: [] }));
      const base = m.verts.length;
      for (const v of p.verts) m.verts.push(v);
      for (const f of p.faces) m.faces.push(f.map((i) => i + base));
    }
    const primitives: Primitive[] = [];
    for (const [material, { verts, faces }] of byMat) {
      const tris: number[] = [];
      for (const f of faces) {
        for (let k = 2; k < f.length; k++) {
          const a = f[0];
          const b = f[k - 1];
          const c = f[k];
          // A face that indexes past its own vertex list is a bug upstream, and
          // writing it would make the whole file invalid rather than one element.
          if (a >= verts.length || b >= verts.length || c >= verts.length) continue;
          if (a === b || b === c || a === c) continue;
          tris.push(a, b, c);
        }
      }
      if (!tris.length) continue;
      const pos = new Float32Array(verts.length * 3);
      verts.forEach((v, i) => {
        pos[i * 3] = v[0];
        pos[i * 3 + 1] = v[1];
        pos[i * 3 + 2] = v[2];
      });
      const idx = Uint32Array.from(tris);
      primitives.push({
        attributes: { POSITION: this.vec3(pos, true), NORMAL: this.vec3(vertexNormals(pos, idx), false) },
        indices: this.indices(idx, verts.length),
        material,
        mode: 4,
      });
    }
    if (!primitives.length) return null;
    return this.meshes.push(name ? { name, primitives } : { primitives }) - 1;
  }

  node(n: GltfNode): number {
    return this.nodes.push(n) - 1;
  }

  /** Add children to a node made earlier — a group is created before what goes
   *  in it, so that the tree reads in the order the file is written. */
  adopt(parent: number, children: number[]): void {
    if (!children.length) return;
    const p = this.nodes[parent];
    p.children = [...(p.children ?? []), ...children];
  }

  /** The document's JSON, given the URI its one buffer is reached by (none for
   *  a GLB, whose buffer is the BIN chunk). */
  private json(roots: number[], asset: Extras, sceneName: string, sceneExtras: Extras | undefined, uri?: string): string {
    const clean = (n: GltfNode) => {
      // Empty arrays and absent fields are left out rather than written empty:
      // the schema forbids a zero-length `children`.
      const o: Record<string, unknown> = {};
      if (n.name) o.name = n.name;
      if (n.mesh !== undefined) o.mesh = n.mesh;
      if (n.children?.length) o.children = n.children;
      if (n.translation && n.translation.some((v) => Math.abs(v) > 1e-12)) o.translation = n.translation;
      if (n.rotation) o.rotation = n.rotation;
      if (n.extras && Object.keys(n.extras).length) o.extras = n.extras;
      return o;
    };
    const doc: Record<string, unknown> = {
      asset,
      scene: 0,
      scenes: [{ name: sceneName, nodes: roots, ...(sceneExtras ? { extras: sceneExtras } : {}) }],
      nodes: this.nodes.map(clean),
    };
    if (this.meshes.length) doc.meshes = this.meshes;
    if (this.materials.length) doc.materials = this.materials;
    if (this.accessors.length) doc.accessors = this.accessors;
    if (this.views.length) doc.bufferViews = this.views;
    if (this.byteLength) doc.buffers = [uri ? { byteLength: this.byteLength, uri } : { byteLength: this.byteLength }];
    return JSON.stringify(doc);
  }

  private bin(): Uint8Array {
    const out = new Uint8Array(this.byteLength);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.byteLength;
    }
    return out;
  }

  /**
   * The binary container: a 12-byte header, the JSON chunk padded with spaces,
   * the BIN chunk padded with zeros — the padding characters are the spec's,
   * not a choice.
   */
  toGLB(roots: number[], asset: Extras, sceneName: string, sceneExtras?: Extras): Uint8Array<ArrayBuffer> {
    const json = new TextEncoder().encode(this.json(roots, asset, sceneName, sceneExtras));
    const jsonLen = pad4(json.byteLength);
    const bin = this.bin();
    const binLen = pad4(bin.byteLength);
    const total = 12 + 8 + jsonLen + (binLen ? 8 + binLen : 0);
    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, GLB_MAGIC, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, total, true);
    dv.setUint32(12, jsonLen, true);
    dv.setUint32(16, CHUNK_JSON, true);
    out.set(json, 20);
    out.fill(0x20, 20 + json.byteLength, 20 + jsonLen);
    if (binLen) {
      const at = 20 + jsonLen;
      dv.setUint32(at, binLen, true);
      dv.setUint32(at + 4, CHUNK_BIN, true);
      out.set(bin, at + 8);
    }
    return out;
  }

  /**
   * The JSON container, with the buffer inlined as a base64 data URI so the one
   * file is the whole model. A .gltf beside a separate .bin is the more usual
   * shape, but a browser download is one file, and a .gltf whose .bin did not
   * come with it opens as nothing at all.
   */
  toGLTF(roots: number[], asset: Extras, sceneName: string, sceneExtras?: Extras): string {
    const uri = this.byteLength
      ? 'data:application/octet-stream;base64,' + base64(this.bin())
      : undefined;
    return this.json(roots, asset, sceneName, sceneExtras, uri);
  }
}

/** btoa over a byte array, chunked: String.fromCharCode spread over a few
 *  megabytes of terrain overflows the argument stack. */
function base64(bytes: Uint8Array): string {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    s += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(s);
}
