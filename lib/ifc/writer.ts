import proj4 from 'proj4';
import { xfAxes } from '@/lib/geo/euler';
import { treeProxy } from '@/lib/geo/mesh';
import { dedupe, ensureCCW } from '@/lib/geo/rings';
import { TREE_CANOPY_COLOR, TREE_TRUNK_COLOR } from '@/lib/scene/stack';
import { buildingColors } from '@/lib/scene/xf';
import { DATA_SOURCES, type DataSource, sourceOf } from '@/lib/sources/licence';
import { DEFAULT_SITE_NAME, defaultProjectName } from '@/lib/types';
import type { Building, PropBag, Provider, SiteMeta, Tree, Vec2, Vec3 } from '@/lib/types';

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

/**
 * A user-typed attribute, or the `$` an unset one has to be.
 *
 * Every string on IfcMeta means "leave it out" when it is empty — an IFC file
 * with `''` in Description says the description is the empty string, which is
 * not the same claim as saying nothing. One helper rather than the ternary at
 * each of the seven optional slots.
 */
export const sOrNull = (v: string): Attr => (v ? S(v) : null);

/**
 * Who wrote the file, as against who the model is about.
 *
 * Fixed rather than typed into the panel: the author is a person and varies,
 * these two are the tool and do not. They go to the STEP header — organization
 * and originating_system — and to IfcOrganization/IfcApplication wherever the
 * file carries an owner history.
 */
export const ORGANISATION = 'bim-lane';
export const APPLICATION = 'ifcsite.app';

/* ---------------------------------------------------------------------
   Schemas
   --------------------------------------------------------------------- */

export type IfcSchema = 'IFC2X3' | 'IFC4' | 'IFC4X3';

export const IFC_SCHEMAS: IfcSchema[] = ['IFC2X3', 'IFC4', 'IFC4X3'];

export const isIfcSchema = (v: unknown): v is IfcSchema =>
  v === 'IFC2X3' || v === 'IFC4' || v === 'IFC4X3';

/**
 * Which root the IFC2X3 georeferencing property sets hang off.
 *
 * Only read under that schema — IFC4 and IFC4X3 have IfcMapConversion, which
 * names its own source context and leaves nothing to choose. See the
 * georeferencing block in ContextModel for why the choice exists at all.
 */
export type IfcGeorefTarget = 'site' | 'project' | 'both';

export const IFC_GEOREF_TARGETS: IfcGeorefTarget[] = ['site', 'project', 'both'];

export const isIfcGeorefTarget = (v: unknown): v is IfcGeorefTarget =>
  v === 'site' || v === 'project' || v === 'both';

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
   *  numbers go onto a root — IfcSite by default, see IfcGeorefTarget — as the
   *  conventional ePset_* property sets. */
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

  /**
   * Extra descriptions for FILE_DESCRIPTION, whose first attribute is a
   * LIST OF STRING and so takes as many as it is given.
   *
   * This is where the data attribution lands, in the first five lines of the
   * file: a licence notice is no use to anyone if reading it needs an IFC
   * viewer, and a header is what you see opening the thing in a text editor.
   * The per-element property sets are the machine-readable half.
   */
  readonly description: string[] = [];

  readonly caps: SchemaCaps;

  constructor(
    public readonly name: string,
    public readonly schema: IfcSchema = 'IFC4',
    /** FILE_NAME's author list, from IfcMeta.author. Empty stays `('')`, which
     *  is what this header carried before there was anywhere to type one. */
    public readonly author: string = '',
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
      'FILE_DESCRIPTION((' +
        ["ViewDefinition [" + this.caps.view + "]", ...this.description]
          // esc() rather than raw: the attribution lines carry a © and the
          // accents in "Géoplateforme", and a header is still a STEP string.
          .map((d) => "'" + esc(d) + "'")
          .join(',') +
        "),'2;1');",
      // author and organization are LIST OF STRING; preprocessor_version and
      // originating_system are single strings, and both name the tool. esc()
      // throughout — an author is as likely to carry an accent as the
      // attribution lines above are.
      "FILE_NAME('" +
        esc(this.name) +
        "','" +
        ts +
        "',('" +
        esc(this.author) +
        "'),('" +
        esc(ORGANISATION) +
        "'),'" +
        esc(APPLICATION) +
        "','" +
        esc(APPLICATION) +
        "','');",
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
 * A colour as the 0..1 components IfcColourRgb wants.
 *
 * Verbatim, on purpose: lib/scene/stack and lib/scene/xf hold one value per
 * thing and the file carries exactly that, so the preview and the deliverable
 * cannot disagree about what colour something is.
 *
 * There used to be an export-only highlight knee here, on the theory that a BIM
 * viewer with more ambient gain than the preview's hemisphere fill would clip
 * the near-whites to paper. It cost more than the clipping it insured against:
 * terrain left as 0xc3c3c0 and massing as 0xc8c6c2 in every viewer, several
 * shades under the palette they claim, and those are the two largest areas on
 * screen. If an export ever does read blown out, the fix belongs in the palette
 * — where the preview would show it too — not in a second export-only transform.
 */
const rgb01 = (hex: number): [number, number, number] => [
  ((hex >> 16) & 255) / 255,
  ((hex >> 8) & 255) / 255,
  (hex & 255) / 255,
];

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
  /** Which data source each element came from, accumulated as they are written
   *  and flushed once per source in build(). See credit(). */
  private readonly credits = new Map<DataSource, Ref[]>();
  /** Which provider the scene was built from, for sourceOf. */
  private readonly provider: Provider;
  /** The build date, or '' when a draft predates it being recorded. */
  private readonly fetched: string;

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
    // The schema, the names and the authorship, all from one bag — see IfcMeta.
    const a = o.ifc;
    this.f = new IfcFile('context.ifc', a.schema, a.author);
    this.caps = this.f.caps;
    this.origin = o.origin;
    this.off = o.exportOffset;
    this.base = o.projectBase;
    this.provider = o.provider;
    this.fetched = o.fetched;
    const f = this.f;
    const caps = this.caps;

    /* Ownership, where the schema insists on it or the user has claimed it.

       IFC2X3 declares IfcRoot.OwnerHistory mandatory, so `$` there is not a file
       that happens to say nothing about its author — it is an invalid one, and
       validators and the stricter importers treat it as such. IFC4 made the
       attribute optional and this file left it out, which is why the second
       clause is here: someone who types their name into the export panel expects
       it in the file whatever the schema, and with the field blank an IFC4
       export is entity-for-entity what it always was.

       One instance, shared by every root entity. The person is the typed author
       and nothing else — no user is signed in, so a given name would be a guess
       — and the organisation is the tool. ChangeAction .ADDED. and a creation
       date are what the schema requires to be present. */
    this.owner =
      caps.ownerHistory || a.author
        ? (() => {
            const person = f.add('IfcPerson', [
              null,
              sOrNull(a.author),
              null,
              null,
              null,
              null,
              null,
              null,
            ]);
            const org = f.add('IfcOrganization', [null, S(ORGANISATION), null, null, null]);
            const pao = f.add('IfcPersonAndOrganization', [person, org, null]);
            const app = f.add('IfcApplication', [org, S('1.0'), S(APPLICATION), S('IFCSITE')]);
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
      // Name, Description, ObjectType, LongName, Phase — all but ObjectType are
      // the panel's. The fallback is applied here rather than stamped into the
      // meta at build time so that moving the site moves the name with it; see
      // defaultProjectName.
      S(a.projectName || defaultProjectName(o.lat, o.lon)),
      sOrNull(a.projectDescription),
      null,
      sOrNull(a.projectLongName),
      sOrNull(a.projectPhase),
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
      S(a.siteName || DEFAULT_SITE_NAME),
      sOrNull(a.siteDescription),
      null,
      this.sitePlacement,
      null,
      sOrNull(a.siteLongName),
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
      sOrNull(a.siteLandTitle),
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

    /* VerticalDatum carries the registry code rather than the name, so it reads
       EPSG:5773 the way Name two slots up reads EPSG:25830. Both are
       IfcIdentifier, and a code is unambiguous where "EGM96" is a convention. */
    if (caps.mapConversion) {
      const crs = f.add('IfcProjectedCRS', [
        S(o.epsg),
        o.crsName ? S(o.crsName) : null,
        o.geodeticDatum ? S(o.geodeticDatum) : null,
        o.verticalDatumEpsg ? S(o.verticalDatumEpsg) : null,
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
      /* IFC2X3 has neither entity, so the same statement goes out as the two
         property sets the buildingSMART georeferencing guidance defines for
         exactly this — the conventional way to say LoGeoRef 50 in a schema that
         cannot. A reader that knows the convention recovers the full placement;
         one that does not still has IfcSite's RefLatitude/RefLongitude/
         RefElevation above, which is LoGeoRef 30 and unaffected by any of this.

         The names are the convention's own, with the `e` prefix that marks a
         pset extending the schema rather than one published in it.

         Which root they hang off is a setting rather than a constant because
         the convention only settles the names: readers disagree about where
         they look, some at IfcSite and some at IfcProject, and a file that
         lands on the wrong one reads as ungeoreferenced. IfcSite is the
         default — it is what the guidance names, and it is where these sat
         before there was anything to choose. */
      const roots =
        a.georefTarget === 'project'
          ? this.project
          : a.georefTarget === 'both'
            ? [this.site, this.project]
            : this.site;
      this.pset(roots, 'ePset_ProjectedCRS', {
        Name: o.epsg,
        ...(o.crsName ? { Description: o.crsName } : {}),
        ...(o.geodeticDatum ? { GeodeticDatum: o.geodeticDatum } : {}),
        ...(o.verticalDatumEpsg ? { VerticalDatum: o.verticalDatumEpsg } : {}),
        MapUnit: 'METRE',
      });
      this.pset(roots, 'ePset_MapConversion', {
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
    const [cr, cg, cb] = rgb01(hex);
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

  // el takes several elements as readily as one because
  // IfcRelDefinesByProperties.RelatedObjects is a SET in all three schemas —
  // so two roots that want the same properties share one set and one
  // relationship rather than each carrying a byte-identical copy.
  private pset(el: Ref | Ref[], name: string, props?: PropBag): void {
    const ks = Object.keys(props || {});
    if (!ks.length) return;
    const f = this.f;
    const singles = ks.map((k) => {
      const v = props![k];
      const nv = typeof v === 'number' ? TYPED('IfcReal', R(v)) : TYPED('IfcLabel', S(v));
      return f.add('IfcPropertySingleValue', [S(k), null, nv, null]);
    });
    const ps = f.add('IfcPropertySet', [S(ifcGuid()), this.owner, S(name), null, singles]);
    const rel = Array.isArray(el) ? el : [el];
    f.add('IfcRelDefinesByProperties', [S(ifcGuid()), this.owner, null, null, rel, ps]);
  }

  /**
   * Note that this element's geometry came from `src`, for the licence property
   * set flushed in build().
   *
   * Recorded rather than written on the spot because every element from one
   * source gets a byte-identical property set, and
   * IfcRelDefinesByProperties.RelatedObjects is a SET in all three schemas — so
   * one set and one relationship can serve every OSM element in the file.
   * Written per element the way ePset_SiteContext is, a site with two thousand
   * buildings would carry some fourteen thousand entities saying the same
   * sentence over and over.
   *
   * A null source is hand-drawn geometry, which has no third-party licence:
   * `Source: drawn` in its ePset_SiteContext is the whole truth about it, and
   * an attribution there would be a claim about someone else's data that the
   * file has no business making.
   */
  private credit(el: Ref, src: DataSource | null): void {
    if (!src) return;
    const els = this.credits.get(src);
    if (els) els.push(el);
    else this.credits.set(src, [el]);
  }

  /**
   * One ePset_License, as a property set the caller then relates to whatever it
   * likes.
   *
   * Its own builder rather than a widened pset(): the values here want types
   * pset() does not emit — IfcText for an attribution that can run past
   * IfcLabel's nominal 255 characters once several sources are joined, and
   * IfcIdentifier for the URL — and pset() is what every existing export's
   * ePset_SiteContext goes through, so it is left byte-for-byte as it was.
   *
   * The `e` prefix is this file's convention for a set that extends the schema
   * rather than one buildingSMART publishes, the same as ePset_ProjectedCRS.
   */
  private licencePset(rows: [string, Attr][]): Ref {
    const f = this.f;
    const singles = rows.map(([k, v]) =>
      f.add('IfcPropertySingleValue', [S(k), null, v, null]),
    );
    return f.add('IfcPropertySet', [
      S(ifcGuid()),
      this.owner,
      S('ePset_License'),
      null,
      singles,
    ]);
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
  //
  // `plinth` is how far below its base the building reaches, in metres — non-zero
  // only for one set to cut the terrain, whose base drops to the lowest ground
  // under it (plinthOf in lib/scene/cut). The wall solid starts that far down and
  // is that much deeper, so the roof stays exactly where it was and the element
  // is still one SweptSolid over the same profile.
  addBuilding(b: Building, plinth = 0): Ref | null {
    const f = this.f;
    const xf = b.xf;
    const [sx, sy, sz] = xf.scale;
    const r = ensureCCW(dedupe(b.ring.map((p): Vec2 => [p[0] * sx, p[1] * sy])));
    if (r.length < 3) return null;
    const prof = f.add('IfcArbitraryClosedProfileDef', [E('AREA'), null, this.poly2d(r)]);
    const depth = Math.max(b.h * sz, 0.1);
    const { wall, cap } = buildingColors(b);
    // One solid when the two colours agree — every sourced building at its
    // default, where the preview's roof/wall separation is the light's doing
    // rather than the palette's, so there is nothing for a split to carry.
    //
    // When they differ (hand-drawn, or recoloured in the editor) the roof has to
    // be its own geometric item, since an IfcStyledItem attaches to a whole item
    // and cannot pick out the cap face of an extrusion. Two stacked extrusions
    // over the SAME profile rather than a split brep: both stay SweptSolid, the
    // parametric profile that makes these import cleanly survives, the total
    // height is unchanged, and the two never share a plane so there is nothing
    // to z-fight. A brep would have cost all of that on the most numerous
    // element in the file, to say one colour.
    const capD = wall === cap ? 0 : Math.min(0.3, depth * 0.1);
    // The shared world axes when there is no plinth, so every building that does
    // not cut the ground is written exactly as it was before the option existed.
    const drop = plinth > 0 ? plinth : 0;
    const solidAt = drop
      ? f.add('IfcAxis2Placement3D', [f.add('IfcCartesianPoint', [[R(0), R(0), R(-drop)]]), null, null])
      : this.world;
    const solid = f.add('IfcExtrudedAreaSolid', [prof, solidAt, this.dz, R(depth - capD + drop)]);
    const capSolid = capD
      ? f.add('IfcExtrudedAreaSolid', [
          prof,
          f.add('IfcAxis2Placement3D', [
            f.add('IfcCartesianPoint', [[R(0), R(0), R(depth - capD)]]),
            null,
            null,
          ]),
          this.dz,
          R(capD),
        ])
      : null;
    const shp = f.add('IfcShapeRepresentation', [
      this.body,
      S('Body'),
      S('SweptSolid'),
      capSolid ? [solid, capSolid] : [solid],
    ]);
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
    const alpha = transparency > 0 ? transparency : undefined;
    this.style(solid, wall, alpha);
    if (capSolid) this.style(capSolid, cap, alpha);
    this.pset(el, 'ePset_SiteContext', b.props);
    // Hand-drawn footprints carry no source licence — see credit(). The marker
    // is the one lib/viewer/Viewer stamps when it commits a drawn ring, rather
    // than b.src, which is the height's provenance and not the geometry's.
    this.credit(el, b.props.Source === 'drawn' ? null : sourceOf('vector', this.provider));
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
    const { trunk, canopy } = treeProxy({
      h: Math.max(t.h * sz, 0.1),
      cr: Math.max(t.cr * sx, 0.05),
      tr: Math.max(t.tr * sy, 0.02),
    });
    if (!trunk.faces.length || !canopy.faces.length) return null;
    // closed: true — each part is a sealed volume on its own, so a schema
    // without tessellation can state them as solids rather than bare surfaces.
    // Two items rather than one merged mesh because they are two colours: the
    // style below attaches per geometric item, which is the only place the file
    // can say what the preview shows. Both come back with the same repType, so
    // they share the one representation.
    const { item: trunkFs, repType } = this.mesh(trunk.verts, trunk.faces, true);
    const { item: canopyFs } = this.mesh(canopy.verts, canopy.faces, true);
    const shp = f.add('IfcShapeRepresentation', [
      this.body,
      S('Body'),
      S(repType),
      [trunkFs, canopyFs],
    ]);
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
    const alpha = transparency > 0 ? transparency : undefined;
    // A per-tree colour override recolours the canopy alone — the trunk is
    // always TREE_TRUNK_COLOR. Same asymmetry as the preview (see paintTree in
    // lib/viewer/Viewer): the override is there to pick a species' foliage, not
    // to paint the whole proxy one colour.
    this.style(trunkFs, TREE_TRUNK_COLOR, alpha);
    this.style(canopyFs, xf.color ?? TREE_CANOPY_COLOR, alpha);
    this.pset(el, 'ePset_SiteContext', t.props);
    // Always OSM when it was fetched at all: BD TOPO has no individual trees, so
    // lib/build/run queries Overpass for them under both providers. This is the
    // element that makes an IGN export a two-licence file.
    this.credit(el, t.src === 'user' ? null : sourceOf('trees', this.provider));
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
    src?: DataSource,
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
    if (props) this.pset(el, 'ePset_SiteContext', props);
    // Passed in rather than derived here: a merged surface has no per-record
    // provenance to read, and lib/ifc/emit already knows whether it is handing
    // over terrain, the roadway or a theme layer — which is exactly the
    // distinction sourceOf needs and the one this method has deliberately
    // forgotten by the time it is called.
    this.credit(el, src ?? null);
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
    this.attribute();
    return this.f.toString();
  }

  /**
   * The data attribution, in the three places it has to be.
   *
   * OSM's ODbL and IGN's Licence Ouverte both make the credit a condition of
   * use, and an IFC is a deliverable that leaves this app and gets passed on —
   * so the notice has to travel inside the file rather than living on the page
   * that produced it. The OSMF guidelines say as much for a medium nobody
   * browses: the attribution belongs "within the data or metadata".
   *
   * Driven off what was actually written, not off the provider, because those
   * are not the same list. An IGN export with trees in it owes ODbL as well as
   * the Licence Ouverte, and a build with the terrain switched off owes nothing
   * to whoever supplies the elevation.
   */
  private attribute(): void {
    if (!this.credits.size) return;
    const f = this.f;
    const used = [...this.credits.keys()].map((k) => DATA_SOURCES[k]);

    // Per source: one property set, one relationship, every element from it.
    for (const [src, els] of this.credits) {
      const l = DATA_SOURCES[src];
      const ps = this.licencePset([
        ['Source', TYPED('IfcLabel', S(l.source))],
        ['License', TYPED('IfcLabel', S(l.licence))],
        ['Attribution', TYPED('IfcText', S(l.attribution))],
        ['LicenseUrl', TYPED('IfcIdentifier', S(l.url))],
        // Omitted rather than guessed when a draft predates the field being
        // recorded — see SiteMeta.fetched. The Licence Ouverte asks for the date
        // of the last update of the information reused, and a wrong date is a
        // worse answer than none.
        ...(this.fetched
          ? ([['Retrieved', TYPED('IfcLabel', S(this.fetched))]] as [string, Attr][])
          : []),
      ]);
      f.add('IfcRelDefinesByProperties', [S(ifcGuid()), this.owner, null, null, els, ps]);
    }

    // The whole notice once more on IfcSite, so a reader that opens the site's
    // properties and nothing else still sees every source the model draws on.
    const notice = used.map((l) => l.attribution).join(' ');
    const site = this.licencePset([
      ['Source', TYPED('IfcLabel', S(used.map((l) => l.source).join('; ')))],
      ['License', TYPED('IfcLabel', S([...new Set(used.map((l) => l.licence))].join('; ')))],
      ['Attribution', TYPED('IfcText', S(notice))],
      // Deduped, like License above: the three IGN datasets share one licence
      // and one URL, and a summary that repeats it three times reads as three
      // different permissions rather than one.
      [
        'LicenseUrl',
        TYPED('IfcText', S([...new Set(used.map((l) => l.url))].join(' '))),
      ],
      ...(this.fetched
        ? ([['Retrieved', TYPED('IfcLabel', S(this.fetched))]] as [string, Attr][])
        : []),
    ]);
    f.add('IfcRelDefinesByProperties', [
      S(ifcGuid()),
      this.owner,
      null,
      null,
      [this.site],
      site,
    ]);

    // And in the header, where it is readable without an IFC viewer at all.
    this.f.description.push(notice);
  }
}
