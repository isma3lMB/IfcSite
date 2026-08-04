import { xfAxes } from '@/lib/geo/euler';
import { dedupe, ensureCCW } from '@/lib/geo/rings';
import { defaultColors } from '@/lib/scene/xf';
import type { Building, PropBag, SiteMeta, Vec2, Vec3 } from '@/lib/types';

/* =====================================================================
   ifc-writer — dependency-free IFC4 SPF serialiser
   ===================================================================== */

type Real = { __t: 'real'; v: number };
type Int = { __t: 'int'; v: number };
type EnumV = { __t: 'enum'; v: string };
type StrV = { __t: 'str'; v: string };
type BoolV = { __t: 'bool'; v: boolean };
type TypedV = { __t: 'typed'; type: string; inner: Attr };
type DerivedV = { __t: 'derived' };

/** A `#123` entity reference. */
type Ref = string;

export type Attr =
  | Real
  | Int
  | EnumV
  | StrV
  | BoolV
  | TypedV
  | DerivedV
  | Ref
  | null
  | undefined
  | Attr[];

export const R = (v: number): Real => ({ __t: 'real', v });
export const I = (v: number): Int => ({ __t: 'int', v });
export const E = (v: string): EnumV => ({ __t: 'enum', v });
export const S = (v: string): StrV => ({ __t: 'str', v });
export const DERIVED: DerivedV = { __t: 'derived' };
export const TYPED = (t: string, i: Attr): TypedV => ({ __t: 'typed', type: t, inner: i });

const GC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

export function ifcGuid(): string {
  let s = GC[Math.floor(Math.random() * 4)]; // leading char holds only 2 bits
  for (let i = 0; i < 21; i++) s += GC[Math.floor(Math.random() * 64)];
  return s;
}

function formatReal(v: number): string {
  if (!Number.isFinite(v)) throw new Error('non-finite real');
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return v + '.';
  let s = String(v);
  if (s.includes('e')) s = s.replace('e', 'E');
  if (!s.includes('.') && !s.includes('E')) s += '.';
  return s;
}

// ISO-10303-21 string literals are ASCII. IGN attribute values are full of
// accents ("Forêt fermée de conifères"), so every non-ASCII run is emitted as
// an \X2\ block of UTF-16BE code units, closed by \X0\. Writing raw UTF-8 here
// produces a file that strict readers reject.
export const esc = (s: string): string =>
  String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
    .replace(/[^\x20-\x7E]+/g, (m) => {
      let h = '';
      for (const ch of m) {
        let c = ch.codePointAt(0)!;
        if (c > 0xffff) {
          // surrogate pair
          c -= 0x10000;
          h += (0xd800 + (c >> 10)).toString(16).toUpperCase().padStart(4, '0');
          h += (0xdc00 + (c & 0x3ff)).toString(16).toUpperCase().padStart(4, '0');
        } else h += c.toString(16).toUpperCase().padStart(4, '0');
      }
      return '\\X2\\' + h + '\\X0\\';
    });

function fmt(a: Attr): string {
  if (a === null || a === undefined) return '$';
  if (typeof a === 'string') {
    if (a[0] === '#') return a;
    throw new Error('wrap literals with S()');
  }
  if (Array.isArray(a)) return '(' + a.map(fmt).join(',') + ')';
  switch (a.__t) {
    case 'real':
      return formatReal(a.v);
    case 'int':
      return String(Math.round(a.v));
    case 'enum':
      return '.' + a.v + '.';
    case 'str':
      return "'" + esc(a.v) + "'";
    case 'bool':
      return a.v ? '.T.' : '.F.';
    case 'typed':
      return a.type.toUpperCase() + '(' + fmt(a.inner) + ')';
    case 'derived':
      return '*';
  }
  throw new Error('unknown value');
}

export class IfcFile {
  readonly lines: string[] = [];
  private nextId = 1;

  constructor(public readonly name: string) {}

  add(type: string, attrs: Attr[]): Ref {
    const ref = '#' + this.nextId++;
    this.lines.push(ref + '=' + type.toUpperCase() + '(' + attrs.map(fmt).join(',') + ');');
    return ref;
  }

  get count(): number {
    return this.nextId - 1;
  }

  toString(): string {
    const ts = new Date().toISOString().replace(/\.\d+Z$/, '');
    return [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
      "FILE_NAME('" +
        esc(this.name) +
        "','" +
        ts +
        "',(''),(''),'IFC Site','IFC Site','');",
      "FILE_SCHEMA(('IFC4'));",
      'ENDSEC;',
      'DATA;',
      ...this.lines,
      'ENDSEC;',
      'END-ISO-10303-21;',
      '',
    ].join('\n');
  }
}

/** Every member of IfcGeographicElementTypeEnum in IFC4. Anything outside it is
 *  not a value the schema knows, whatever it reads like. */
const GEO_TYPES = new Set(['TERRAIN', 'USERDEFINED', 'NOTDEFINED']);

export class ContextModel {
  readonly f: IfcFile;
  private readonly origin: Vec2;
  private readonly off: Vec3;
  private readonly base: Vec3;
  private readonly elements: Ref[] = [];

  private readonly o3: Ref;
  private readonly dz: Ref;
  private readonly dx: Ref;
  private readonly world: Ref;
  private readonly ctx: Ref;
  private readonly body: Ref;
  private readonly project: Ref;
  private readonly sitePlacement: Ref;
  private readonly site: Ref;

  constructor(o: SiteMeta) {
    this.f = new IfcFile('context.ifc');
    this.origin = o.origin;
    this.off = o.exportOffset;
    this.base = o.projectBase;
    const f = this.f;

    /* ---- the local project coordinate system --------------------------
       Site coordinates p become model coordinates q as q = R(-th)·p + L.
       The rotation is -th, not th: the angle says how far the project's axes
       are turned counter-clockwise from the grid, and world content expressed
       in turned axes appears turned the other way.

       The two halves of that live on different entities. The chosen origin is
       the file's (0,0,0), so the -off half is subtracted in placement() and
       rides on each element; the site placement carries only the project base
       and angle. Factored the other way round it would be the same product, but
       IfcSite would sit at -off instead of on the project's own zero.

       Everything below falls back to what this wrote before when the base is
       zero and the angle is zero. */
    const off = this.off;
    const base = this.base;
    const th = (o.projectAngle * Math.PI) / 180;
    const cos = Math.cos(th);
    const sin = Math.sin(th);
    const basedOut = base[0] !== 0 || base[1] !== 0 || base[2] !== 0;
    const placed = basedOut || th !== 0;

    const metre = f.add('IfcSIUnit', [DERIVED, E('LENGTHUNIT'), null, E('METRE')]);
    const units = f.add('IfcUnitAssignment', [
      [
        metre,
        f.add('IfcSIUnit', [DERIVED, E('AREAUNIT'), null, E('SQUARE_METRE')]),
        f.add('IfcSIUnit', [DERIVED, E('VOLUMEUNIT'), null, E('CUBIC_METRE')]),
      ],
    ]);
    this.o3 = f.add('IfcCartesianPoint', [[R(0), R(0), R(0)]]);
    this.dz = f.add('IfcDirection', [[R(0), R(0), R(1)]]);
    this.dx = f.add('IfcDirection', [[R(1), R(0), R(0)]]);
    this.world = f.add('IfcAxis2Placement3D', [this.o3, this.dz, this.dx]);
    // TrueNorth is expressed in the context's own coordinate system, so turning
    // the project axes turns it too: R(-th) applied to grid north. Leaving this
    // at (0,1,0) would georeference correctly and still tell every viewer that
    // north runs up the model's +Y.
    const north = f.add('IfcDirection', [[R(sin), R(cos), R(0)]]);
    this.ctx = f.add('IfcGeometricRepresentationContext', [
      null,
      S('Model'),
      I(3),
      R(1e-5),
      this.world,
      north,
    ]);
    this.body = f.add('IfcGeometricRepresentationSubContext', [
      S('Body'),
      S('Model'),
      DERIVED,
      DERIVED,
      DERIVED,
      DERIVED,
      this.ctx,
      null,
      E('MODEL_VIEW'),
      null,
    ]);
    this.project = f.add('IfcProject', [
      S(ifcGuid()),
      null,
      S(o.projectName || 'Site context'),
      null,
      null,
      null,
      null,
      [this.ctx],
      units,
    ]);
    // Where the model sits in the project's own grid, and nothing else — the
    // origin re-base is on the elements. With no project placement asked for,
    // this stays the shared identity, so IfcSite reads as a clean (0,0,0).
    this.sitePlacement = f.add('IfcLocalPlacement', [
      null,
      placed
        ? f.add('IfcAxis2Placement3D', [
            basedOut
              ? f.add('IfcCartesianPoint', [[R(base[0]), R(base[1]), R(base[2])]])
              : this.o3,
            this.dz,
            // The site's +X in model coordinates. Reuses the shared axis when the
            // project is square to the grid, as it always was before.
            th === 0 ? this.dx : f.add('IfcDirection', [[R(cos), R(-sin), R(0)]]),
          ])
        : this.world,
    ]);
    this.site = f.add('IfcSite', [
      S(ifcGuid()),
      null,
      S('Site'),
      null,
      null,
      this.sitePlacement,
      null,
      null,
      E('ELEMENT'),
      null,
      null,
      // RefElevation: the site's ground level above the vertical datum named on
      // the IfcProjectedCRS. Only set when the build established a datum — a flat
      // scene has no altitude to declare, and declaring zero would claim one.
      o.refElevation === null ? null : R(o.refElevation),
      null,
      null,
    ]);
    f.add('IfcRelAggregates', [S(ifcGuid()), null, null, null, this.project, [this.site]]);

    const crs = f.add('IfcProjectedCRS', [
      S(o.epsg),
      o.crsName ? S(o.crsName) : null,
      o.geodeticDatum ? S(o.geodeticDatum) : null,
      o.verticalDatum ? S(o.verticalDatum) : null,
      null,
      null,
      metre,
    ]);
    f.add('IfcMapConversion', [
      this.ctx,
      crs,
      // Eastings/Northings are the map coordinates of model (0,0,0). Working back
      // through the site placement puts that point at site (off - R(th)·base), and
      // site coordinates are metres east/north of the projected origin. Whatever
      // the user moved zero to and however far they turned the axes, a point at
      // site x still comes out on origin[0] + x — the two cancel exactly, which is
      // the whole reason this can be offered without touching the georeferencing.
      R(this.origin[0] + off[0] - (base[0] * cos - base[1] * sin)),
      R(this.origin[1] + off[1] - (base[0] * sin + base[1] * cos)),
      // OrthogonalHeight. Zero while the origin is unmoved and the base is flat —
      // eastings and northings are shifted to the site origin, but model z is the
      // vertical datum's own altitude, so there is nothing to add back. Raising the
      // origin, or basing the project above zero, takes that much off every
      // exported height, and this is what puts it back.
      R(off[2] - base[2]),
      // XAxisAbscissa/XAxisOrdinate: the model's +X direction in map coordinates.
      // The angle is defined as exactly that — counter-clockwise from grid east —
      // so the pair reads straight off it. Scale stays 1: the projected CRS is
      // already in metres and nothing here rescales.
      R(cos),
      R(sin),
      R(1),
    ]);
  }

  // loc is [x,y,z] in site coordinates. axis/refDir are the local Z and X unit
  // vectors — pass null for an unrotated element and the shared world axes are
  // reused, which keeps unedited files as small as they were before.
  //
  // The chosen origin is subtracted here, so every element is placed relative to
  // it and the file's (0,0,0) is the point the user picked. This is also right
  // for addSurface, whose geometry is absolute site coordinates in a point list:
  // it passes loc null, which becomes -off, and its points resolve against that.
  // The cost of re-basing here rather than on the site is that elements which
  // used to share the world placement now each need a point of their own.
  private placement(loc: Vec3 | null, axis?: Vec3 | null, refDir?: Vec3 | null): Ref {
    const f = this.f;
    const [lx, ly, lz] = loc || [0, 0, 0];
    const x = lx - this.off[0];
    const y = ly - this.off[1];
    const z = lz - this.off[2];
    const moved = Math.abs(x) > 1e-9 || Math.abs(y) > 1e-9 || Math.abs(z) > 1e-9;
    const turned = !!(axis && refDir);
    let ax = this.world;
    if (moved || turned) {
      ax = f.add('IfcAxis2Placement3D', [
        moved ? f.add('IfcCartesianPoint', [[R(x), R(y), R(z)]]) : this.o3,
        turned ? f.add('IfcDirection', [[R(axis![0]), R(axis![1]), R(axis![2])]]) : this.dz,
        turned ? f.add('IfcDirection', [[R(refDir![0]), R(refDir![1]), R(refDir![2])]]) : this.dx,
      ]);
    }
    return f.add('IfcLocalPlacement', [this.sitePlacement, ax]);
  }

  // IFC4 lets IfcSurfaceStyle sit directly in IfcStyledItem.Styles, so the
  // deprecated IfcPresentationStyleAssignment wrapper is not needed.
  private style(item: Ref, hex: number, transparency?: number): void {
    const f = this.f;
    const c = f.add('IfcColourRgb', [
      null,
      R(((hex >> 16) & 255) / 255),
      R(((hex >> 8) & 255) / 255),
      R((hex & 255) / 255),
    ]);
    const rend = f.add('IfcSurfaceStyleRendering', [
      c,
      // IFC counts transparency, not opacity: 0 is solid. Left null the file
      // always claimed opaque, so a layer the preview draws as a faint overlay
      // came back as a solid slab in any other viewer.
      transparency ? R(transparency) : null,
      null,
      null,
      null,
      null,
      null,
      null,
      E('NOTDEFINED'),
    ]);
    const st = f.add('IfcSurfaceStyle', [S('Colour'), E('BOTH'), [rend]]);
    f.add('IfcStyledItem', [item, [st], null]);
  }

  private poly2d(ring: Vec2[]): Ref {
    const f = this.f;
    const pts = ring.map((p) => f.add('IfcCartesianPoint', [[R(p[0]), R(p[1])]]));
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) pts.push(pts[0]);
    return f.add('IfcPolyline', [pts]);
  }

  private pset(el: Ref, name: string, props?: PropBag): void {
    const ks = Object.keys(props || {});
    if (!ks.length) return;
    const f = this.f;
    const singles = ks.map((k) => {
      const v = props![k];
      const nv = typeof v === 'number' ? TYPED('IfcReal', R(v)) : TYPED('IfcLabel', S(v));
      return f.add('IfcPropertySingleValue', [S(k), null, nv, null]);
    });
    const ps = f.add('IfcPropertySet', [S(ifcGuid()), null, S(name), null, singles]);
    f.add('IfcRelDefinesByProperties', [S(ifcGuid()), null, null, null, [el], ps]);
  }

  // b is a scene.buildings record: ring is local to b.center, and b.xf holds the
  // user's edits. X/Y scale is baked into the profile and Z scale into the
  // extrusion depth; position and rotation ride on the placement. three.js
  // composes M = T·R·S, so this is exactly the transform the preview shows.
  addBuilding(b: Building): Ref | null {
    const f = this.f;
    const xf = b.xf;
    const [sx, sy, sz] = xf.scale;
    const r = ensureCCW(dedupe(b.ring.map((p): Vec2 => [p[0] * sx, p[1] * sy])));
    if (r.length < 3) return null;
    const prof = f.add('IfcArbitraryClosedProfileDef', [E('AREA'), null, this.poly2d(r)]);
    const solid = f.add('IfcExtrudedAreaSolid', [
      prof,
      this.world,
      this.dz,
      R(Math.max(b.h * sz, 0.1)),
    ]);
    const shp = f.add('IfcShapeRepresentation', [this.body, S('Body'), S('SweptSolid'), [solid]]);
    const pds = f.add('IfcProductDefinitionShape', [null, null, [shp]]);
    const ax = xfAxes(xf.rot);
    const el = f.add('IfcBuildingElementProxy', [
      S(ifcGuid()),
      null,
      S(b.name),
      null,
      null,
      this.placement(
        [b.center[0] + xf.pos[0], b.center[1] + xf.pos[1], (b.baseZ || 0) + xf.pos[2]],
        ax && ax.axis,
        ax && ax.refDir,
      ),
      pds,
      null,
      E('ELEMENT'),
    ]);
    // Transparency needs a surface style to hang on, so a ghosted building
    // writes one even where its colour is the source-derived default — and then
    // that default has to be written out too, or the file would claim a colour
    // the preview never showed.
    const transparency = 1 - xf.opacity;
    if (xf.color !== null || transparency > 0)
      this.style(
        solid,
        xf.color ?? defaultColors(b).wall,
        transparency > 0 ? transparency : undefined,
      );
    this.pset(el, 'Pset_SiteContext', b.props);
    this.elements.push(el);
    return el;
  }

  addSurface(
    verts: Vec3[],
    faces: number[][],
    name: string,
    type?: string,
    color?: number | null,
    props?: PropBag,
    transparency?: number,
  ): Ref | null {
    const f = this.f;
    if (!verts.length || !faces.length) return null;
    const coords = f.add('IfcCartesianPointList3D', [
      verts.map((v) => [R(v[0]), R(v[1]), R(v[2])]),
      null,
    ]);
    const fr = faces.map((t) => f.add('IfcIndexedPolygonalFace', [t.map((i) => I(i + 1))]));
    const fs = f.add('IfcPolygonalFaceSet', [coords, null, fr, null]);
    const shp = f.add('IfcShapeRepresentation', [this.body, S('Body'), S('Tessellation'), [fs]]);
    const pds = f.add('IfcProductDefinitionShape', [null, null, [shp]]);
    // IfcGeographicElementTypeEnum only defines these three. VEGETATION and
    // WATER read well but are not in the schema, and a strict reader is
    // entitled to drop the element rather than guess — so anything else is
    // demoted to USERDEFINED and says what it is in ObjectType, which is the
    // slot the schema provides for exactly that.
    const pre = type && GEO_TYPES.has(type) ? type : 'USERDEFINED';
    const el = f.add('IfcGeographicElement', [
      S(ifcGuid()),
      null,
      S(name),
      null,
      pre === 'USERDEFINED' && type ? S(type) : null,
      this.placement(null),
      pds,
      null,
      E(pre),
    ]);
    if (color !== undefined && color !== null) this.style(fs, color, transparency);
    if (props) this.pset(el, 'Pset_SiteContext', props);
    this.elements.push(el);
    return el;
  }

  build(): string {
    if (this.elements.length) {
      this.f.add('IfcRelContainedInSpatialStructure', [
        S(ifcGuid()),
        null,
        null,
        null,
        this.elements,
        this.site,
      ]);
    }
    return this.f.toString();
  }
}
