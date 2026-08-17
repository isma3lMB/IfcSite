import proj4 from 'proj4';
import { xfAxes } from '@/lib/geo/euler';
import { treeProxy } from '@/lib/geo/mesh';
import { dedupe, ensureCCW } from '@/lib/geo/rings';
import { TREE_CANOPY_COLOR } from '@/lib/scene/stack';
import { defaultColors } from '@/lib/scene/xf';
import type { Building, PropBag, SiteMeta, Tree, Vec2, Vec3 } from '@/lib/types';

/* =====================================================================
   ifc-writer — IFC2X3 / IFC4 / IFC4X3 SPF serialiser

   Framework-free: no renderer, no DOM, nothing that needs a browser — the whole
   emit path runs under plain Node. proj4 is here for one job, inverting the
   origin marker's projected position back to WGS84 for IfcSite's RefLatitude
   and RefLongitude, and is pure arithmetic like the rest.

   Three schemas out of one emitter. Everything that differs between them is a
   field of SCHEMA_CAPS below rather than a version test in the emitters, so the
   differences can be read in one place and a fourth schema is a row rather than
   a sweep. The IFC4 column is what this wrote before any of it existed, so an
   IFC4 export is entity-for-entity what it always was.
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
export const B = (v: boolean): BoolV => ({ __t: 'bool', v });
export const DERIVED: DerivedV = { __t: 'derived' };
export const TYPED = (t: string, i: Attr): TypedV => ({ __t: 'typed', type: t, inner: i });

/* ---------------------------------------------------------------------
   Schemas
   --------------------------------------------------------------------- */

export type IfcSchema = 'IFC2X3' | 'IFC4' | 'IFC4X3';

export const IFC_SCHEMAS: IfcSchema[] = ['IFC2X3', 'IFC4', 'IFC4X3'];

export const isIfcSchema = (v: unknown): v is IfcSchema =>
  v === 'IFC2X3' || v === 'IFC4' || v === 'IFC4X3';

/**
 * What one schema can be told, as capabilities rather than as a version number.
 *
 * Read as "what does this schema have", not "which schema is this": every
 * emitter below asks for the thing it needs — can it tessellate, is there an
 * IfcMapConversion — so adding a schema means filling in a row and no emitter
 * changes. The alternative, `if (schema === 'IFC2X3')` at each of the eight
 * sites that care, spreads one decision over the whole file and hides how few
 * real differences there are.
 */
type SchemaCaps = {
  /** The FILE_SCHEMA token. */
  fileSchema: string;
  /** The MVD named in FILE_DESCRIPTION. */
  view: string;
  /** IfcPolygonalFaceSet / IfcCartesianPointList3D / IfcIndexedPolygonalFace,
   *  all IFC4 additions. Without them a mesh goes out as a Brep — see mesh(). */
  tessellation: boolean;
  /** IfcMapConversion + IfcProjectedCRS, IFC4 additions. Without them the same
   *  numbers go onto IfcSite as the conventional ePset_* property sets. */
  mapConversion: boolean;
  /** IFC4X3 gave IfcMapConversion a ScaleY and a ScaleZ: ten attributes where
   *  IFC4 has eight, and a reader handed eight fails on the count. */
  mapScaleXYZ: boolean;
  /** IfcGeographicElement, an IFC4 addition. Without it, a proxy. */
  geoElement: boolean;
  /** The members of IfcGeographicElementTypeEnum this schema actually defines.
   *  Anything outside it is not a value the schema knows, whatever it reads
   *  like, and a strict reader is entitled to drop the element rather than
   *  guess — so addSurface demotes to USERDEFINED and says what it meant in
   *  ObjectType, which is the slot provided for exactly that. */
  geoTypes: Set<string>;
  /** IFC2X3's IfcStyledItem.Styles holds IfcPresentationStyleAssignment, not
   *  the IfcSurfaceStyle itself. IFC4 deprecated the wrapper. */
  styleAssignment: boolean;
  /** IfcRoot.OwnerHistory is mandatory in IFC2X3 and optional from IFC4 on.
   *  A 2X3 file with `$` there is one validators reject and some importers
   *  refuse outright. */
  ownerHistory: boolean;
};

const SCHEMA_CAPS: Record<IfcSchema, SchemaCaps> = {
  IFC2X3: {
    fileSchema: 'IFC2X3',
    view: 'CoordinationView_V2.0',
    tessellation: false,
    mapConversion: false,
    mapScaleXYZ: false,
    geoElement: false,
    geoTypes: new Set(),
    styleAssignment: true,
    ownerHistory: true,
  },
  IFC4: {
    fileSchema: 'IFC4',
    view: 'CoordinationView',
    tessellation: true,
    mapConversion: true,
    mapScaleXYZ: false,
    geoElement: true,
    geoTypes: new Set(['TERRAIN', 'USERDEFINED', 'NOTDEFINED']),
    styleAssignment: false,
    ownerHistory: false,
  },
  IFC4X3: {
    // The released schema calls itself IFC4X3_ADD2 and some strict readers hold
    // it to that; this is the plainer name, and it is one token to change.
    fileSchema: 'IFC4X3',
    view: 'ReferenceView',
    tessellation: true,
    mapConversion: true,
    mapScaleXYZ: true,
    geoElement: true,
    // IFC4X3 is the schema that finally has somewhere to put a tree: VEGETATION
    // is a real predefined type here, where IFC4 has to demote it.
    geoTypes: new Set(['TERRAIN', 'VEGETATION', 'SOIL_BORING_POINT', 'USERDEFINED', 'NOTDEFINED']),
    styleAssignment: false,
    ownerHistory: false,
  },
};

/**
 * Decimal degrees as an IfcCompoundPlaneAngleMeasure — LIST[3:4] OF INTEGER,
 * being degrees, minutes, seconds and millionths of a second.
 *
 * Every component carries the angle's own sign, which is what the schema asks
 * for and what readers expect: a western longitude is (-2,-21,-7,-920000), not
 * a negative degree followed by three positive parts. Split on the absolute
 * value and signed at the end, so that falls out rather than being special-cased.
 *
 * The carry matters. Rounding the millionths can land exactly on 1e6, and a
 * naive split then emits 60 seconds — legal integers that no reader accepts as
 * an angle. Each overflow is carried up in turn.
 */
export function dms(deg: number): Attr[] {
  const sign = deg < 0 ? -1 : 1;
  const a = Math.abs(deg);
  let d = Math.floor(a);
  let m = Math.floor((a - d) * 60);
  let s = Math.floor(((a - d) * 60 - m) * 60);
  let us = Math.round((((a - d) * 60 - m) * 60 - s) * 1e6);
  if (us >= 1e6) (us -= 1e6), s++;
  if (s >= 60) (s -= 60), m++;
  if (m >= 60) (m -= 60), d++;
  return [I(sign * d), I(sign * m), I(sign * s), I(sign * us)];
}

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

  readonly caps: SchemaCaps;

  constructor(
    public readonly name: string,
    public readonly schema: IfcSchema = 'IFC4',
  ) {
    this.caps = SCHEMA_CAPS[schema];
  }

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
      "FILE_DESCRIPTION(('ViewDefinition [" + this.caps.view + "]'),'2;1');",
      "FILE_NAME('" +
        esc(this.name) +
        "','" +
        ts +
        "',(''),(''),'IFC Site','IFC Site','');",
      "FILE_SCHEMA(('" + this.caps.fileSchema + "'));",
      'ENDSEC;',
      'DATA;',
      ...this.lines,
      'ENDSEC;',
      'END-ISO-10303-21;',
      '',
    ].join('\n');
  }
}

/**
 * The highlight knee for exported colours, on a 0..255 channel. Nothing below
 * EXPORT_KNEE moves; everything above it is compressed into the headroom up to
 * EXPORT_CEILING.
 *
 * The two knobs for "the export comes out too bright". Raise the ceiling toward
 * 255 to get closer to what the preview draws, lower it if a viewer still blows
 * out; the knee decides how much of the palette is left alone on the way.
 *
 * This exists because the preview and a BIM viewer light a scene differently and
 * there is no way to state a lighting rig in IFC. The palette is tuned against
 * the preview's hemisphere fill, which lands a flat surface at about ×1.11;
 * point the same near-white at a viewer with more ambient gain and it clips to
 * paper. Terrain at 0xe8e7e4 and massing at 0xf4f1ec sit within 5% of white, so
 * they have nowhere to go — and they are also the two largest areas on screen,
 * which is why the whole model reads washed out rather than just a hot spot.
 *
 * A knee rather than a flat multiplier because the complaint is highlights
 * clipping, not everything being too light: scaling every colour equally would
 * drag the saturated layers — trees, hedges, water — down with the whites they
 * are supposed to read against. A knee rather than a hard clamp because a clamp
 * is not monotonic once it bites. Terrain and roofs both sit above any useful
 * ceiling, so a clamp lands them on the same value and the roofs disappear into
 * the ground in the flat-lit plan view this is meant to fix. Compressing keeps
 * them apart, just closer together.
 */
const EXPORT_KNEE = 170;
const EXPORT_CEILING = 205;

/**
 * Put a colour through that knee, as 0..1 components ready for IfcColourRgb.
 *
 * The knee is computed on the brightest channel and the whole triple moves by
 * that one factor, so hue and saturation are untouched — a pale warm grey stays
 * a pale warm grey, it just stops being nearly white.
 *
 * Export-only, and on purpose: lib/scene/stack keeps one colour per thing so the
 * preview and the file cannot drift, and that still holds — this is not a second
 * palette but one rendering allowance applied to the single palette on its way
 * out. Every colour in the file passes through style(), including one the user
 * picked in the editor, so nothing escapes it and the model stays internally
 * consistent.
 */
function toneForExport(hex: number): [number, number, number] {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  const peak = Math.max(r, g, b);
  if (peak <= EXPORT_KNEE) return [r / 255, g / 255, b / 255];
  const squeezed =
    EXPORT_KNEE + ((peak - EXPORT_KNEE) * (EXPORT_CEILING - EXPORT_KNEE)) / (255 - EXPORT_KNEE);
  const k = squeezed / peak;
  return [(r * k) / 255, (g * k) / 255, (b * k) / 255];
}

export class ContextModel {
  readonly f: IfcFile;
  private readonly caps: SchemaCaps;
  /** The shared IfcOwnerHistory every IfcRoot points at, or null on a schema
   *  where the attribute is optional and this file leaves it out. */
  private readonly owner: Ref | null;
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
  /** Shared black, for the specular of every matte style. Lazy so a file with
   *  nothing styled in it does not carry a colour it never references. */
  private black: Ref | null = null;

  constructor(o: SiteMeta) {
    this.f = new IfcFile('context.ifc', o.schema);
    this.caps = this.f.caps;
    this.origin = o.origin;
    this.off = o.exportOffset;
    this.base = o.projectBase;
    const f = this.f;
    const caps = this.caps;

    /* Ownership, where the schema insists on it. IFC2X3 declares
       IfcRoot.OwnerHistory mandatory, so `$` there is not a file that happens
       to say nothing about its author — it is an invalid one, and validators
       and the stricter importers treat it as such. IFC4 made the attribute
       optional and this file has always left it out, so nothing is emitted
       there and that output is unchanged.

       One instance, shared by every root entity. The content is the only honest
       thing available: no user is signed in, so the person is unnamed and the
       organisation is the application itself. ChangeAction .ADDED. and a
       creation date are what the schema requires to be present. */
    this.owner = caps.ownerHistory
      ? (() => {
          const person = f.add('IfcPerson', [null, null, null, null, null, null, null, null]);
          const org = f.add('IfcOrganization', [null, S('IFC Site'), null, null, null]);
          const pao = f.add('IfcPersonAndOrganization', [person, org, null]);
          const app = f.add('IfcApplication', [org, S('1.0'), S('IFC Site'), S('IFCSITE')]);
          return f.add('IfcOwnerHistory', [
            pao,
            app,
            null,
            E('ADDED'),
            null,
            null,
            null,
            I(Math.floor(Date.now() / 1000)),
          ]);
        })()
      : null;

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
    // OrthogonalHeight: the elevation, above the vertical datum, of the point the
    // origin marker sits at — which is model z = 0. The vertical half of the
    // georeferencing, and the only place the file states a height in the datum.
    const zHeight = off[2] - base[2];

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
      this.owner,
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
    /* Where the origin marker is on Earth, for RefLatitude/RefLongitude below.
       Site coordinates are metres east/north of the projected site origin, so
       the marker's map position is just that plus the offset — projectBase and
       projectAngle play no part, since they rename coordinates rather than move
       the point. Inverted here at write time rather than stored anywhere: the
       marker moves, and a saved copy of its position is a copy to keep in step.
       A hand-edited draft can carry a definition proj4 rejects, and a bad
       informational attribute must not cost the whole export — so that falls
       back to the site centre, which is where the marker starts anyway. */
    let originLon = o.lon;
    let originLat = o.lat;
    try {
      const g = proj4(o.crsDef, 'EPSG:4326', [
        this.origin[0] + off[0],
        this.origin[1] + off[1],
      ]) as Vec2;
      if (Number.isFinite(g[0]) && Number.isFinite(g[1])) [originLon, originLat] = g;
    } catch {
      /* keep the site centre */
    }

    this.site = f.add('IfcSite', [
      S(ifcGuid()),
      this.owner,
      S('Site'),
      null,
      null,
      this.sitePlacement,
      null,
      null,
      E('ELEMENT'),
      // RefLatitude/RefLongitude/RefElevation all describe the same point — the
      // origin marker — and are informational: the authoritative placement is
      // the IfcMapConversion below, and these are what a properties panel shows
      // when someone asks where in the world this model is.
      //
      // RefElevation is off[2], the marker's own height above the vertical
      // datum. Deliberately not OrthogonalHeight, which is off[2] - base[2] and
      // answers a different question — the elevation of model (0,0,0). The two
      // part company as soon as the project is based off zero vertically, and
      // IfcSite sits on the marker, not on model zero.
      dms(originLat),
      dms(originLon),
      R(off[2]),
      null,
      null,
    ]);
    f.add('IfcRelAggregates', [S(ifcGuid()), this.owner, null, null, this.project, [this.site]]);

    /* ---- georeferencing ------------------------------------------------
       The numbers first, computed once, because both branches below want the
       same six and the arithmetic is the part worth getting right.

       Eastings/Northings are the map coordinates of model (0,0,0). Working back
       through the site placement puts that point at site (off - R(th)·base), and
       site coordinates are metres east/north of the projected origin. Whatever
       the user moved zero to and however far they turned the axes, a point at
       site x still comes out on origin[0] + x — the two cancel exactly, which is
       the whole reason a project placement can be offered without touching the
       georeferencing.

       OrthogonalHeight is zero while the origin is unmoved and the base is flat:
       eastings and northings are shifted to the site origin, but model z is the
       vertical datum's own altitude, so there is nothing to add back. Raising the
       origin, or basing the project above zero, takes that much off every
       exported height, and this is what puts it back.

       XAxisAbscissa/XAxisOrdinate are the model's +X direction in map
       coordinates. The angle is defined as exactly that — counter-clockwise from
       grid east — so the pair reads straight off it. Scale stays 1: the projected
       CRS is already in metres and nothing here rescales. */
    const eastings = this.origin[0] + off[0] - (base[0] * cos - base[1] * sin);
    const northings = this.origin[1] + off[1] - (base[0] * sin + base[1] * cos);

    if (caps.mapConversion) {
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
        R(eastings),
        R(northings),
        R(zHeight),
        R(cos),
        R(sin),
        R(1),
        // ScaleY/ScaleZ, IFC4X3 only. Left null rather than repeating the 1:
        // both default to Scale when absent, which is what this means, and a
        // stated 1 would be an anisotropic scale that happens to be uniform.
        ...(caps.mapScaleXYZ ? [null, null] : []),
      ]);
    } else {
      /* IFC2X3 has neither entity, so the same statement goes on IfcSite as the
         two property sets the buildingSMART georeferencing guidance defines for
         exactly this — the conventional way to say LoGeoRef 50 in a schema that
         cannot. A reader that knows the convention recovers the full placement;
         one that does not still has IfcSite's RefLatitude/RefLongitude/
         RefElevation above, which is LoGeoRef 30 and unaffected by any of this.

         The names are the convention's own, with the `e` prefix that marks a
         pset extending the schema rather than one published in it. */
      this.pset(this.site, 'ePset_ProjectedCRS', {
        Name: o.epsg,
        ...(o.crsName ? { Description: o.crsName } : {}),
        ...(o.geodeticDatum ? { GeodeticDatum: o.geodeticDatum } : {}),
        ...(o.verticalDatum ? { VerticalDatum: o.verticalDatum } : {}),
        MapUnit: 'METRE',
      });
      this.pset(this.site, 'ePset_MapConversion', {
        Eastings: eastings,
        Northings: northings,
        OrthogonalHeight: zHeight,
        XAxisAbscissa: cos,
        XAxisOrdinate: sin,
        Scale: 1,
      });
    }
  }

  // loc is [x,y,z] in site coordinates. axis/refDir are the local Z and X unit
  // vectors — pass null for an unrotated element and the shared world axes are
  // reused, which keeps unedited files as small as they were before.
  //
  // The chosen origin is subtracted here, so every element is placed relative to
  // it and the file's (0,0,0) is the point the user picked. The cost of re-basing
  // here rather than on the site is that elements which used to share the world
  // placement now each need a point of their own.
  //
  // `rebase` is false for a caller that has already put its own geometry into
  // model coordinates — addSurface, which re-bases its vertex list — so `loc`
  // is written through untouched rather than being shifted a second time.
  private placement(
    loc: Vec3 | null,
    axis?: Vec3 | null,
    refDir?: Vec3 | null,
    rebase = true,
  ): Ref {
    const f = this.f;
    const [lx, ly, lz] = loc || [0, 0, 0];
    const x = rebase ? lx - this.off[0] : lx;
    const y = rebase ? ly - this.off[1] : ly;
    const z = rebase ? lz - this.off[2] : lz;
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
  // IfcPresentationStyleAssignment wrapper it deprecated is skipped there.
  // IFC2X3's Styles holds nothing else, so on that schema it goes back in — see
  // the tail of this method.
  private style(item: Ref, hex: number, transparency?: number): void {
    const f = this.f;
    const [cr, cg, cb] = toneForExport(hex);
    const c = f.add('IfcColourRgb', [null, R(cr), R(cg), R(cb)]);
    // Every rendering attribute is spelled out, because .NOTDEFINED. with the
    // rest left null hands the material to the viewer and they all reach for a
    // Phong default with a white specular highlight. That lands on the flat
    // draped layers — water, vegetation, roads — which face straight up and
    // bounce it into the camera at any near-plan angle, while the vertical
    // building walls beside them never catch it. The preview shades with
    // MeshLambert (no specular term at all), so the file was the only place the
    // gloss existed.
    //
    // Said in colours rather than in IfcNormalisedRatioMeasure factors. Both
    // branches of IfcColourOrFactor are legal and the factors are tidier, but a
    // colour is the branch every importer has to handle to read anything at all,
    // and the point here is to be understood by a viewer we cannot inspect.
    if (!this.black) this.black = f.add('IfcColourRgb', [null, R(0), R(0), R(0)]);
    const rend = f.add('IfcSurfaceStyleRendering', [
      c,
      // IFC counts transparency, not opacity: 0 is solid. Left null the file
      // always claimed opaque, so a layer the preview draws as a faint overlay
      // came back as a solid slab in any other viewer.
      transparency ? R(transparency) : null,
      // DiffuseColour: the surface colour itself, reusing the same entity rather
      // than writing it out twice. Importers that prefer DiffuseColour over
      // SurfaceColour — the IfcOpenShell glTF path among them — get an answer
      // instead of a guess, and the two cannot disagree.
      c,
      null, // TransmissionColour
      null, // DiffuseTransmissionColour
      null, // ReflectionColour — no environment reflection
      // SpecularColour: black, which is what actually kills the highlight.
      this.black,
      // Redundant once specular is black, but cheap. IfcSpecularExponent rather
      // than IfcSpecularRoughness because the exponent is what Revit and
      // ArchiCAD emit, so it is the branch of the select viewers are known to
      // read; roughness is rare enough in the wild to be quietly ignored.
      TYPED('IfcSpecularExponent', R(1)),
      // The schema's own word for diffuse-only.
      E('MATT'),
    ]);
    const st = f.add('IfcSurfaceStyle', [S('Colour'), E('BOTH'), [rend]]);
    const styles = this.caps.styleAssignment
      ? [f.add('IfcPresentationStyleAssignment', [[st]])]
      : [st];
    f.add('IfcStyledItem', [item, styles, null]);
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
    const ps = f.add('IfcPropertySet', [S(ifcGuid()), this.owner, S(name), null, singles]);
    f.add('IfcRelDefinesByProperties', [S(ifcGuid()), this.owner, null, null, [el], ps]);
  }

  /**
   * One tessellated body, in whatever the schema can express — the shape a tree
   * or a draped surface is, without the caller having to know which schema it
   * is writing for. Returns the item to hand to style() and the
   * RepresentationType that names it, since those two travel together.
   *
   * `verts` arrives in the coordinates the geometry is to be written in; this
   * does no re-basing of its own (addSurface has already done its own — see
   * there for why it belongs in the coordinates rather than the placement).
   *
   * IFC4 onward this is IfcPolygonalFaceSet, which states the vertices once and
   * then indexes them, and is the reason the export is as small as it is.
   *
   * IFC2X3 has none of that — tessellation arrived with IFC4 — so a mesh has to
   * go out as boundary representation, three entities per face. The vertices are
   * still emitted once each and shared between the loops that touch them, which
   * is what keeps the cost at 3× rather than 9×, but the file is several times
   * the IFC4 one either way and there is no way around that within the schema.
   *
   * `closed` picks between the two honest readings. A tree proxy is a closed
   * volume, so it is an IfcFacetedBrep and a viewer may treat it as a solid.
   * Terrain, roads and the draped layers are open sheets — and the road skirt,
   * though it closes the ribbon on screen, is not provably watertight after the
   * fan triangulation in lib/ifc/emit — so they go out as an
   * IfcShellBasedSurfaceModel, which promises only what they are.
   */
  private mesh(verts: Vec3[], faces: number[][], closed: boolean): { item: Ref; repType: string } {
    const f = this.f;
    if (this.caps.tessellation) {
      const coords = f.add('IfcCartesianPointList3D', [
        verts.map((v) => [R(v[0]), R(v[1]), R(v[2])]),
        null,
      ]);
      const fr = faces.map((t) => f.add('IfcIndexedPolygonalFace', [t.map((i) => I(i + 1))]));
      return { item: f.add('IfcPolygonalFaceSet', [coords, null, fr, null]), repType: 'Tessellation' };
    }
    const pts = verts.map((v) => f.add('IfcCartesianPoint', [[R(v[0]), R(v[1]), R(v[2])]]));
    const fr = faces.map((t) => {
      const loop = f.add('IfcPolyLoop', [t.map((i) => pts[i])]);
      // Orientation .T.: the loop's own winding is the face's, which is what
      // every face in this file is built to be — see ensureCCW in lib/geo/rings
      // and the fan triangulation in lib/ifc/emit.
      return f.add('IfcFace', [[f.add('IfcFaceOuterBound', [loop, B(true)])]]);
    });
    if (closed) {
      const shell = f.add('IfcClosedShell', [fr]);
      return { item: f.add('IfcFacetedBrep', [shell]), repType: 'Brep' };
    }
    const shell = f.add('IfcOpenShell', [fr]);
    return { item: f.add('IfcShellBasedSurfaceModel', [[shell]]), repType: 'SurfaceModel' };
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
      this.owner,
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
    // Always styled, even at the source-derived default. An element with no
    // IfcStyledItem is one every viewer is free to colour its own way, and they
    // all choose grey — which is how an off-white massing arrived in BIM viewers
    // as a grey one while the preview beside it was right. Transparency still
    // only appears on a ghosted building; style() takes a null for the rest.
    const transparency = 1 - xf.opacity;
    this.style(
      solid,
      xf.color ?? defaultColors(b).wall,
      transparency > 0 ? transparency : undefined,
    );
    this.pset(el, 'Pset_SiteContext', b.props);
    this.elements.push(el);
    return el;
  }

  // t is a scene.trees record: cr/tr/h are its own dimensions and t.xf holds
  // the user's edits, same split as addBuilding. A tree has no 2D profile to
  // scale separately from its height, so xf.scale bakes straight into the
  // dimensions treeProxy is given; position and rotation ride on the
  // placement exactly as addBuilding's do. treeProxy builds the shape at the
  // tree's own local origin — the same shape lib/viewer/Viewer draws — so
  // this is one element per tree rather than a single merged mesh, matching
  // how buildings export.
  addTree(t: Tree): Ref | null {
    const f = this.f;
    const xf = t.xf;
    const [sx, sy, sz] = xf.scale;
    const verts: Vec3[] = [];
    const faces: number[][] = [];
    treeProxy(
      { h: Math.max(t.h * sz, 0.1), cr: Math.max(t.cr * sx, 0.05), tr: Math.max(t.tr * sy, 0.02) },
      verts,
      faces,
    );
    if (!verts.length || !faces.length) return null;
    // closed: true — treeProxy builds a sealed volume, so a schema without
    // tessellation can state it as a solid rather than as a bare surface.
    const { item: fs, repType } = this.mesh(verts, faces, true);
    const shp = f.add('IfcShapeRepresentation', [this.body, S('Body'), S(repType), [fs]]);
    const pds = f.add('IfcProductDefinitionShape', [null, null, [shp]]);
    const ax = xfAxes(xf.rot);
    const el = f.add('IfcBuildingElementProxy', [
      S(ifcGuid()),
      this.owner,
      S(t.name),
      null,
      null,
      this.placement(
        [t.x + xf.pos[0], t.y + xf.pos[1], t.z + xf.pos[2]],
        ax && ax.axis,
        ax && ax.refDir,
      ),
      pds,
      null,
      E('ELEMENT'),
    ]);
    const transparency = 1 - xf.opacity;
    this.style(fs, xf.color ?? TREE_CANOPY_COLOR, transparency > 0 ? transparency : undefined);
    this.pset(el, 'Pset_SiteContext', t.props);
    this.elements.push(el);
    return el;
  }

  /**
   * One tessellated context element — terrain, the merged roadway, a draped
   * layer polygon.
   *
   * The vertex list arrives in absolute site coordinates — that is what the
   * builder drapes and what the viewer draws — and is re-based onto the model
   * origin here, so the numbers written to the file are local ones. Doing it in
   * the coordinates rather than in the placement matters: left absolute with a
   * compensating placement, the file resolved to the right spot but every
   * terrain, road and draped-layer vertex still read as the site's altitude
   * above the vertical datum, which is exactly what the model origin exists to
   * take out. Buildings and trees never had this problem — their geometry is
   * local already and only the placement locates them.
   *
   * `offset` is the layer offset from the model tree, and stays on the
   * placement: the viewer applies exactly this vector as its layer group's
   * transform, so keeping it separate is what lets the file agree with the
   * preview. Note that a moved layer no longer satisfies the IfcMapConversion
   * promise for its own geometry — that is inherent to moving it, and the UI
   * says so.
   */
  addSurface(
    verts: Vec3[],
    faces: number[][],
    name: string,
    type?: string,
    color?: number | null,
    props?: PropBag,
    transparency?: number,
    offset?: Vec3,
  ): Ref | null {
    const f = this.f;
    if (!verts.length || !faces.length) return null;
    const [ox, oy, oz] = this.off;
    // closed: false — a draped sheet is not a volume, and the road skirt is not
    // provably watertight. See mesh().
    const { item: fs, repType } = this.mesh(
      verts.map((v): Vec3 => [v[0] - ox, v[1] - oy, v[2] - oz]),
      faces,
      false,
    );
    const shp = f.add('IfcShapeRepresentation', [this.body, S('Body'), S(repType), [fs]]);
    const pds = f.add('IfcProductDefinitionShape', [null, null, [shp]]);
    // What this element is, said as precisely as the schema allows. IFC4 knows
    // only TERRAIN among the things drawn here, so vegetation and water are
    // demoted to USERDEFINED and say what they are in ObjectType; IFC4X3 has a
    // real VEGETATION and keeps it. See geoTypes in SCHEMA_CAPS.
    //
    // IFC2X3 has no IfcGeographicElement at all, so the context layers go out
    // as the same IfcBuildingElementProxy the buildings and trees use — the
    // schema's own catch-all, and the one element every 2X3 reader handles.
    // The type still travels, in the ObjectType it would have used anyway.
    const geo = this.caps.geoElement;
    const pre = type && geo && this.caps.geoTypes.has(type) ? type : 'USERDEFINED';
    const el = f.add(geo ? 'IfcGeographicElement' : 'IfcBuildingElementProxy', [
      S(ifcGuid()),
      this.owner,
      S(name),
      null,
      pre === 'USERDEFINED' && type ? S(type) : null,
      // rebase: false — the vertex list above is already in model coordinates,
      // so this carries the layer offset alone.
      this.placement(offset ?? null, null, null, false),
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
        this.owner,
        null,
        null,
        this.elements,
        this.site,
      ]);
    }
    return this.f.toString();
  }
}
