# IFC Site — Technical Overview

**IFC Site** is a browser-only tool that turns a rectangle drawn on a map into a
georeferenced **IFC4** file of the buildings, roads, terrain and context layers inside it.

There is no backend. `next build` emits a static site (`output: 'export'`), and every
request — Overpass, IGN Géoplateforme, Nominatim, Terrarium DEM — goes straight from the
browser to a service that sends `Access-Control-Allow-Origin: *`. The whole pipeline
(projection, geometry, IFC serialisation, download) runs in the tab.

> **Serve `out/` over HTTP.** Opening `out/index.html` via `file://` gives the page a null
> origin, which Overpass rejects — the result is an empty response rather than an error,
> which is far harder to diagnose. See [next.config.ts](next.config.ts).

---

## 1. Stack and tooling

| Concern | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router), static export, Turbopack |
| UI | React 19, Tailwind CSS 4, shadcn (`base-nova` style) over `@base-ui/react` primitives |
| 3D | three.js 0.160 — `OrbitControls`, `TransformControls`, `InstancedMesh`, a custom sky shader |
| 2D map | Leaflet 1.9 over OSM raster tiles |
| Projection | proj4 |
| IFC | hand-written IFC4 / ISO-10303-21 serialiser — no IFC library |
| Types | TypeScript 7 in `strict` mode; type checking routed through the TS CLI (`experimental.useTypeScriptCli`) |

Scripts (`package.json`):

```
npm run dev        next dev
npm run build      next build  →  out/
npm run start      npx serve out
npm run typecheck  tsc --noEmit
```

Path alias `@/*` maps to the repo root.

---

## 2. Directory map

```
app/                 Next.js shell — layout, page, all CSS
components/          React UI (the "what to do" layer)
  ui/                shadcn primitives over @base-ui/react
lib/
  build/             the fetch-and-build orchestration + IFC emitter lifecycle
  geo/               pure geometry: CRS, rings, meshes, rectangles, Euler decomposition
  i18n/              FR/EN dictionaries, key vocabulary, React context
  ifc/               IFC4 SPF serialiser and the scene → IFC pass
  scene/             scene-record construction and the per-element transform type
  sources/           network adapters: Overpass, IGN, Nominatim, Terrarium
  viewer/            imperative three.js Viewer and Leaflet MapController
context-ifc-browser.html         the original single-file page this was ported from
context_48.8566_2.3522.ifc       a sample export
```

---

## 3. Architecture at a glance

Three layers, with a strict rule between them:

```
                React (declarative)              components/, app/
                        │  props / callbacks
                        ▼
        Imperative controllers (mutable, hot)     lib/viewer/*
                        │  scene objects
                        ▼
                 Pure logic (no DOM)              lib/build, lib/geo, lib/ifc,
                                                  lib/scene, lib/sources
```

**Nothing below the React layer builds a user-facing sentence.** The pure logic and the
controllers emit an i18n *key* plus a params bag ([lib/i18n/keys.ts](lib/i18n/keys.ts)),
and React looks it up in the active dictionary. That is what lets the language toggle
re-translate a status line that is already on screen, and why every thrown failure is an
`AppError` carrying a code rather than an English `message`.

The other structural rule: **React never owns the scene.** A build can produce thousands
of buildings, each with its own ring, and the viewer mutates those records in place during
a gizmo drag. React only sees derived numbers (counts, stats) and a *clone* of the selected
element's transform.

---

## 4. The application shell

### [app/layout.tsx](app/layout.tsx)
Loads IBM Plex Sans/Mono as CSS variables and sets static metadata in the default language
(`fr`). `LangProvider` rewrites `<html lang>`, `document.title` and the description meta
client-side once the stored/URL preference is known — the page is prerendered at build
time, so reading `localStorage` during render would be a hydration mismatch.

### [app/page.tsx](app/page.tsx)
Just `<LangProvider><IfcSite /></LangProvider>`. The provider sits *above* everything
so switching language never remounts the WebGL canvas or the Leaflet map — both are
imperative and would lose camera, selection and undo stack.

### [app/globals.css](app/globals.css) (~1000 lines)
Tailwind 4 with `@theme` tokens (the ink/yellow/paper palette), shadcn's semantic tokens
retuned to it, and a `@layer components` block holding the hand-written chrome: the
floating dock, flow bar, element editor, HUD, info overlay, readout strip, Leaflet
overrides and the narrow-viewport rules. Layout is one full-bleed viewer with everything
else floating over it on a grid, so panels can never cover one another and the gaps stay
transparent to map/orbit gestures.

---

## 5. The React layer (`components/`)

### [ifc-site.tsx](components/ifc-site.tsx) — the orchestrator (393 lines)
The single stateful component. It owns:

- **Imperative refs** (deliberately outside React): the `Viewer`, the `MapController`, the
  `IfcEmitter` (which holds the live scene the viewer mutates), the `SiteMeta`, a deferred
  map action, and a mirror of `infoOpen` for the mount-only key handler.
- **React state**: build form, site rectangle, armed/busy flags, view tab, status, stats,
  selection snapshot, undo/redo availability, gizmo mode, dock/info visibility, and
  `siteDirty` (the rectangle moved since the last build, so the scene — and the IFC behind
  Download — no longer describes it).
- **Two mount effects** that construct the `Viewer` and the `MapController` and wire their
  callbacks back into `setState`. The map arms drawing immediately: drawing is the first
  thing anyone does here.
- **`runOnMap`** — Leaflet measures its container, and a tab switch is a state change that
  has not committed yet when the handler runs. Anything that moves the map is queued until
  the map is actually laid out; `fitBounds` against a `display:none` container frames
  against zero size.
- **Global keyboard**: `Ctrl/Cmd+Z / Y / Shift+Z` for undo/redo (deferring to native undo
  inside text fields), `W/E/R` for translate/rotate/scale, and `Escape` unwinding
  outermost-first — info card, then a drawing gesture, then the 3D selection.
- **Provider coupling**: switching to IGN forces EPSG:2154 (Lambert-93, the datum IGN
  publishes in); switching away clears the IGN-only layers, which have no OSM equivalent.
- **`onBuild`** calls `runBuild`, then feeds the result to the emitter and the viewer and
  flips to the 3D tab. **`onDownload`** flushes the emitter's debounce window and triggers
  a Blob download named `context_<lat>_<lon>.ifc`.

### Panels

| Component | Role |
| --- | --- |
| [stage.tsx](components/stage.tsx) | The two viewer hosts. Both stay mounted; the map is an overlay toggled with `display`, never unmounted. `StageHud` holds the compass (also permanently mounted — the viewer is handed the element once, on mount) plus the legend and hint. |
| [top-bar.tsx](components/top-bar.tsx) | Wordmark, Map/3D tabs, the projected origin of the current build, the readout strip (buildings, tagged %, road faces, trees, layers, entities, file size), the info button and the language toggle. |
| [controls-panel.tsx](components/controls-panel.tsx) | The options dock: place search, site extent readout, CRS select, default-height slider, provider select, and the include checkboxes. IGN-only layers are dimmed and inert under OSM. **Holds no actions** — settings only. |
| [flow-bar.tsx](components/flow-bar.tsx) | The whole path from empty map to `.ifc` as one bar that only ever offers the next thing. The step (`draw → sited → busy → ready`) is *derived* from existing state; nothing new is stored. Also surfaces the stale-scene warning rather than letting Download quietly export the old model. |
| [element-editor.tsx](components/element-editor.tsx) | Selection name, gizmo mode buttons, colour swatch, and X/Y/Z fields for position/rotation/scale, plus uniform-scale lock, reset and undo/redo. |
| [status-line.tsx](components/status-line.tsx) | Renders a `StatusState` — a *key plus params*, a `BuildSummary`, or an error. The closing summary is composed from clauses here, not stored as one template, because the clauses order differently in French. |
| [place-search.tsx](components/place-search.tsx) | Debounced (500 ms) Nominatim search with a sequence guard against out-of-order responses, plus four city presets that also set the matching EPSG. Failure is reported and drawing keeps working. |
| [site-extent.tsx](components/site-extent.tsx) | The rectangle's metres, centre and km². |
| [info-overlay.tsx](components/info-overlay.tsx) / [notes.tsx](components/notes.tsx) | The header prose and notes, behind the (i) button. Note bodies mark code spans with backticks so prose stays a plain string in the dictionary — no `dangerouslySetInnerHTML`. |
| [lang-toggle.tsx](components/lang-toggle.tsx) | FR/EN select. Flags are inline SVG, not emoji: Chrome and Edge on Windows render regional-indicator pairs as bare letter boxes. |

Two input details worth knowing, both mirroring the original page's `oninput`/`onchange`
split — which is also the **undo boundary**:

- `AxisInput` renders its own draft string while focused, so a value being typed is never
  rewritten under the cursor (rounding `1.05` every keystroke makes the decimal
  unenterable). On blur the draft is dropped and the clamped model value takes over.
- `ColourField` binds the native `change` event directly. React maps `onChange` on
  `<input type="color">` to the DOM `input` event, which fires continuously while the
  picker is open; `change` is the commit point React does not surface.

`components/ui/` holds the shadcn primitives (button, checkbox, input, label, select,
slider, tabs) built on `@base-ui/react`, styled through `cn()` = clsx + tailwind-merge.

---

## 6. The imperative controllers (`lib/viewer/`)

### [MapController.ts](lib/viewer/MapController.ts) (386 lines)
Leaflet over OSM tiles. **The rectangle drawn here is the only description of the site** —
there is no centre point to type and no radius; every fetch reads this rectangle.

Kept out of react-leaflet because the drawing gesture is hand-written on raw
`mousedown`/`mousemove` listeners with `map.dragging.disable()` and
`DomUtil.disableTextSelection()`, which a declarative wrapper would fight.

- Leaflet is **dynamically imported** in the static `create()` factory: it touches `window`
  at import time, and a static export prerenders this page where there is no `window`.
- **One gesture, two ways through it.** Press-drag-release sweeps the rectangle in one go;
  a press-release under 6 px is read as the first of two corner clicks and hands over to a
  second phase where the map still pans (the rubber band only tracks a cursor with no
  button held).
- Corner handles resize with the opposite corner `(i+2)%4` as anchor; the rectangle body
  drags to translate. Mid-draw the rectangle gets no handles — they would swallow the
  closing click.
- Every exit — finished, cancelled, disarmed — funnels through `endDraw()`, so no phase can
  leave a listener attached or the map undraggable. `cancelDraw()` restores the pre-draw
  rectangle.
- Two separate callbacks, `onSite` and `onArmed`: finishing a gesture sets the rectangle
  *before* it disarms, so deriving one from the other would leave the Draw button lit.
- A `ResizeObserver` re-invalidates size, skipping while hidden (measuring a
  `display:none` element would cache a zero size).

### [Viewer.ts](lib/viewer/Viewer.ts) (651 lines)
The three.js preview. Deliberately **not** react-three-fiber: it carries TransformControls
drag arbitration against OrbitControls, raycast picking with a click-versus-orbit
threshold, InstancedMesh trees, and an undo stack keyed on live mesh state.

- **Z-up.** Data is E/N/height, so `camera.up` is set to `(0,0,1)` *before* OrbitControls is
  constructed, imported three geometries (cylinders, cones) are rotated into the
  convention, and the `HemisphereLight` is told its up axis (it reads one off its own
  position, which defaults to +Y).
- **Sky dome** ([sky.ts](lib/viewer/sky.ts)) — a `ShaderMaterial` sphere parented to the
  *camera*, so orbit distance can never escape it. The gradient keys on the world-space Z
  of the view ray, so the horizon does not tilt with the camera. Below the horizon it
  brightens to white rather than going black.
- **Scene construction** (`setScene`): the site outline (the drawn rectangle, readable in
  3D too), roads as a translucent double-sided mesh plus edges, one
  `ExtrudeGeometry` mesh per building with a two-material side/top split and an outline as
  a *child* (so it inherits every edit), the terrain mesh — or a plain plane at the datum
  when the build carries no DEM, so a flat scene still sits on something — context surfaces
  with polygon offset against z-fighting, draped vegetation volumes, and trees as two
  `InstancedMesh`es
  (shared trunk cone/cylinder geometry — a dense quarter runs to 1200 trees). Terrain,
  surfaces and volumes all arrive as vertex/face pairs and share one `facesetGeometry`.
- **Depth priority**: everything in the scene is draped on the ground within centimetres,
  which is far inside the depth buffer's resolution at site distances. The terrain material
  carries a *positive* polygon offset so it loses every tie, and roads carry a negative one
  plus `renderOrder = 2` so they always win against it. `depthTest` stays on throughout —
  turning it off would draw roads straight through buildings.
- **Only buildings enter `buildingMeshes`**, so the raycaster can never select scenery and
  the gizmo never latches onto context.
- **Picking**: `pointerdown` records the position and whether the gizmo was hovered;
  `pointerup` ignores the event if the pointer travelled more than 5 px — that was an orbit.
- **Undo/redo**: each command is a before/after snapshot of one `Xf` record (100-deep). The
  data is small and plain, so inverse-command machinery buys nothing; what matters is that
  one gesture produces exactly one command — hence `beginEdit()` on `dragging-changed` true
  and `commitEdit()` on false. A new edit truncates the redo branch.
- `applyXf` writes data → mesh, `readMeshInto` reads mesh → data after a drag, clamping
  scale to `MIN_SCALE` (no mirroring: a negative scale would flip ring winding).
- `frameCamera` preserves the user's orbit direction across rebuilds and rescales near/far
  and the dome to the new site radius.
- `setActive(false)` short-circuits the render loop while the map covers the viewport.
- `dispose()` unwinds everything, including the dome, which `disposeGroup` never sees
  because it is parented to the camera.

---

## 7. The build pipeline (`lib/build/`)

### [run.ts](lib/build/run.ts) — `runBuild(rect, opts, onStatus)`
The whole fetch-and-build pass, lifted out of the DOM: inputs arrive as arguments and a
fresh `SceneData` is returned rather than a module global being mutated. Returns a
discriminated `BuildResult`.

Order of operations:

1. **Guard** — under IGN, every corner of the rectangle must be inside `FR_BOUNDS`
   (a rectangle can straddle the border).
2. **Projection first**, because every parse path needs `toLocal` and theme layers need the
   inverse to look elevation back up after clipping. `proj4` is configured from
   `resolveCRS`, and the site centre becomes the local origin.
3. **Local extent** — the drawn rectangle is a WGS84 one, so in a projected CRS it is
   slightly rotated by grid convergence. `halfX`/`halfY` take the *larger* corner magnitude,
   giving a local box that contains what was drawn rather than cropping a sliver off it.
   `radius` is only what the camera frames on.
4. **Terrain first**, so everything else can sit on it. Failure is non-fatal: the status
   line says so, the build continues with `sampleZ = () => 0`.
5. **Buildings and roads** from the chosen provider. Failure here *is* fatal.
6. **Theme layers** (IGN vegetation, hedges, water, parcels), then **trees** (always OSM —
   BD TOPO has no individual-tree layer). Each is reported and skipped on its own: context
   must never cost you the build.
7. **Empty result** → an error, distinguishing IGN (likely off coverage — a bounding box
   cannot tell France from its neighbours) from OSM.

### [emitter.ts](lib/build/emitter.ts) — `IfcEmitter`
Owns the live scene and the serialised text. Edits are cheap but re-serialising a few
hundred buildings is not, so `markDirty()` debounces re-emission by 250 ms and `flush()`
gives the download handler a synchronous way to pick up an edit still inside that window.
Held outside React because the gizmo produces changes far faster than a render pass should
run.

---

## 8. Data sources (`lib/sources/`)

### [overpass.ts](lib/sources/overpass.ts) — OSM, worldwide
- Three mirrors tried in order, each with a **client-side 45 s deadline**: `[timeout:40]`
  only binds the server's own work, so an overloaded mirror sits on the connection and 504s
  much later — without a client deadline, three wedged mirrors stall a build for minutes.
- One query for `way["building"]`, building multipolygon relations and (optionally)
  highways of ten classes, straight against the drawn bbox.
- `parseHeight`: `height` / `building:height` → `building:levels × 3` → the form fallback,
  recording which one won as `HeightSource`.
- Relations contribute their `outer` rings only (holes are dropped, matching the IGN path).
- Roads: lane count → width (`lanes × 3.25`, min 3 m), buffered into flat quads.
- `osmTrees` is a second round trip, capped at `TREE_CAP = 1500`, deriving crown radius from
  `diameter_crown` and trunk radius from `circumference`.

### [ign.ts](lib/sources/ign.ts) — IGN Géoplateforme, France only (516 lines)
No API key, CORS-open. Four WFS layers are declared in a table (`IGN_LAYERS`) with their
type name, geometry field, requested properties, IFC enum, colour and drape/extrude flags.

Hard-won details captured in the code:
- The geometry field name **differs between BD TOPO (`geometrie`) and the cadastre
  (`geom`)** — `PROPERTYNAME` silently returns nothing if it is wrong.
- BBOX axis order is lat,lon and the CRS urn must be **repeated as a 5th element**; with a
  bare `EPSG:4326` the service swaps axes and returns nothing.
- WFS caps at 5000 features per call, so `wfs()` **pages** on `numberMatched` (dense Paris
  at 900 m matches 6423 buildings).
- Buildings use the surveyed `hauteur` — the reason to prefer BD TOPO over OSM's
  levels-times-three guess — falling back to `nombre_d_etages × 3`. The polygon Z is the
  *roof* outline, so the base comes from `altitude_minimale_sol`.
- `rgeAltiGrid` is a drop-in replacement for the Terrarium grid: same `{verts, faces,
  sample}` shape, sized to the site (N ≤ 69, so ≤ 4900 points per POST). The service rejects
  real JSON booleans and 500s on form encoding — it wants JSON with the flags as *strings*.
  Off-coverage points return a large negative sentinel; a few are patched with the mean, a
  mostly-bad grid throws. Lookups bilinearly interpolate the grid, since there is no raster
  left to re-query.
- `fetchThemeLayer` runs one road for every layer: fetch → clip to the site rectangle →
  drape onto terrain → triangulate. Vegetation is extruded into a canopy mass using a height
  table keyed on BD TOPO `nature`, flattened through `VEG_SCALE` — real 15–18 m canopies
  dominate a site model and hide everything behind them, so the masses become a thin ground
  skin that keeps the classes' relative ordering. `VEG_SCALE` is the one dial; 1.0 restores
  true heights. Hedges keep their surveyed `hauteur`. Both are **draped**: every prism vertex
  gets its own elevation, because one sample for a polygon hundreds of metres wide leaves it
  floating over every slope. Hedges arrive as centrelines and are buffered per segment, then
  **merged into one faceset** — a single hedge is dozens of segments and one element apiece
  would outnumber the buildings.
- `LAYER_IFC_NAME` is deliberately **not** translated: the exported file is a deliverable,
  and element names must not depend on the page's language.

### [terrain.ts](lib/sources/terrain.ts) — AWS Terrarium tiles
One 256 px zoom-13 PNG with elevation packed into RGB (`R×256 + G + B/256 − 32768`), read
back through a canvas, sampled onto a 16×16 grid.

### [nominatim.ts](lib/sources/nominatim.ts)
A five-result search. Explicitly a convenience — the caller reports failure and carries on.

---

## 9. Geometry (`lib/geo/`)

| File | Contents |
| --- | --- |
| [crs.ts](lib/geo/crs.ts) | Four proj4 definitions (Lambert-93, British National Grid, ETRS89/UTM32N, RD New) plus an `auto` mode deriving the UTM zone from the site centre. Each carries its datum and vertical datum for the IFC header. |
| [rect.ts](lib/geo/rect.ts) | Site-rectangle arithmetic in degrees, free of any Leaflet import (`boundsOf` takes `{lat,lng}` structurally). Sides are clamped to 100–2000 m — past 2000 m Overpass and the IGN WFS start refusing. Clamping keeps whichever edge the user is *not* moving fixed, so hitting the limit does not drag the opposite corner. |
| [rings.ts](lib/geo/rings.ts) | Pure ring arithmetic, free of three.js so the IFC serialiser does not pull in a renderer. `dedupe`, `signedArea`, `ensureCCW` (IFC profiles need CCW outer curves — skip it and half the buildings render inverted), `clipToBox` (Sutherland–Hodgman against the site square: one BD TOPO forest polygon near Fontainebleau is 3539 vertices spanning 4 km), `densify` (split long edges so a drape has stations to follow the ground between — elevation is only ever looked up *at vertices*, so a 200 m road segment across a valley otherwise dives clean under the terrain), `ringCentre`. |
| [grid.ts](lib/geo/grid.ts) | `gridSampler` — elevation lookup that interpolates the DEM lattice over the *same* two triangles the terrain mesh is drawn from, rather than bilinearly. A bilinear value sags below those triangles on a twisted cell, so anything placed with it sinks into the ground the user actually sees. Both providers return one. |
| [mesh.ts](lib/geo/mesh.ts) | The parts that genuinely need three: `triangulate` (three's own earcut), `drape` (a clipped ring onto terrain, lifted by `dz` against z-fighting), `prismInto` (extrude into shared arrays for merged layers; the base comes from a per-*point* callback, not a number, so the underside can follow the terrain — point rather than index because the ring is reordered and deduplicated inside), `treeProxy` (a 6-sided trunk and canopy cone, ~24 triangles). |
| [euler.ts](lib/geo/euler.ts) | `xfAxes` — an XYZ Euler as the local Z and X unit vectors `IfcAxis2Placement3D` wants, expanded in closed form from three's own `'XYZ'` branch so the serialiser stays renderer-free. Returns `null` when unrotated, which keeps unedited files small. |

---

## 10. Scene model (`lib/scene/`, `lib/types.ts`)

The central data structure is `SceneData`: buildings, road quads, an optional terrain
`Grid`, draped `Surface`s, extruded `Volume`s and `Tree`s.

The key modelling decision is in `Building`:

```ts
type Building = {
  id, name, props,
  ring: Vec2[],      // relative to center
  center: Vec2,      // site coordinates
  h, baseZ, src,
  xf: Xf,            // the user's edit, composed as M = T·R·S
};
```

**`ring` is relative to `center`**, so rotation and scale pivot on the building rather than
on a site origin hundreds of metres away. `pushBuilding` ([push.ts](lib/scene/push.ts))
enforces that, along with dedupe/CCW, and caps at `BUILDING_CAP = 4000` — past that the
browser, not the services, is the bottleneck.

`Xf` ([xf.ts](lib/scene/xf.ts)) holds `pos`/`rot`/`scale`/`color`, where `color: null`
means "use the source-derived default". Those defaults encode provenance quietly:
**near-white = a real height came with the data, a cooler grey = estimated** — read
straight off `HeightSource`. Subtle on purpose: the massing should read as one material
at site zoom and only give the split up close, with the build summary's tagged/estimated
counts as the number to trust.

Roads are stored as raw corner faces (`pushRoadway`), one buffered quad per centreline
segment, **cut to the site box** — three to five corners once the clip has been through it,
always convex, so both the viewer and the IFC writer fan it into triangles without a
triangulator. The clip is what keeps the layer honest: Overpass `out geom` and the IGN WFS
`BBOX` are *intersects* filters, so a motorway catching one corner of the site arrives whole,
tens of kilometres of it. The centreline is filtered against the box first (grown by half a
carriageway, so a road running just outside still contributes the half of its surface that is
inside), and only what survives is densified and draped — the other way round pays thousands
of projection inversions per way to produce a handful of quads.

Crude at junctions, but it needs no buffer/union library. Elevation is sampled at every
**corner**, not at the centreline: a carriageway runs to 13 m wide, so a quad held flat across
its width cuts into the hillside on any cross-slope and the road disappears behind the ground.
Draping every corner banks the ribbon with the terrain — not how a road is built, but at this
level of detail a ribbon that never buries and never floats beats a geometrically honest one
that does both. Draping happens *after* the clip, so the vertices it introduces on the
boundary get their own sample and the cut edge sits flush.

---

## 11. IFC output (`lib/ifc/`)

### [writer.ts](lib/ifc/writer.ts) — dependency-free IFC4 SPF serialiser (444 lines)

A small typed-value layer (`R`, `I`, `E`, `S`, `TYPED`, `DERIVED`) formats attributes
correctly — reals always carry a decimal point, enums get dots, `*` for derived, `$` for
null — and `IfcFile` assigns `#n` ids and wraps the whole thing in the ISO-10303-21
header/footer with `FILE_SCHEMA(('IFC4'))`.

`esc()` matters more than it looks: SPF string literals are ASCII, and IGN attribute values
are full of accents ("Forêt fermée de conifères"). Every non-ASCII run is emitted as an
`\X2\` block of UTF-16BE code units closed by `\X0\`, surrogate pairs included. Raw UTF-8
here produces a file strict readers reject.

`ContextModel` builds the spatial and georeferencing skeleton:

```
IfcProject ──IfcRelAggregates──> IfcSite ──IfcRelContainedInSpatialStructure──> elements
     │
     └─ IfcGeometricRepresentationContext ─ IfcMapConversion ─ IfcProjectedCRS
        (+ "Body" subcontext)                (site origin E/N)   (EPSG, datum, vertical datum)
```

That combination is **LoGeoRef 50** — the model sits at a local origin and the projected
easting/northing of that origin travels in `IfcMapConversion`.

Element mapping:

| Scene item | IFC |
| --- | --- |
| Building | `IfcBuildingElementProxy` + `IfcExtrudedAreaSolid` over an `IfcArbitraryClosedProfileDef` |
| Terrain, roads, draped layers, trees | `IfcGeographicElement` + `IfcPolygonalFaceSet` (`TERRAIN` / `USERDEFINED` / `WATER` / `VEGETATION`) |
| Vegetation volumes | `IfcGeographicElement` + swept solid, so a canopy reads as vegetation rather than a building proxy. A `Volume` therefore carries its geometry twice: the draped `verts`/`faces` the viewer renders, and the flat `ring`/`baseZ`/`h` profile the sweep needs. `baseZ` is the *lowest* point of the drape — a flat solid resting in the hillside beats one hovering over it |
| Source attributes | `Pset_SiteContext` via `IfcPropertySet` / `IfcRelDefinesByProperties` |
| Colour | `IfcStyledItem` → `IfcSurfaceStyle` directly (IFC4 allows it; the deprecated `IfcPresentationStyleAssignment` wrapper is skipped) |

`addBuilding` bakes the edit exactly the way the preview shows it: **X/Y scale into the
profile, Z scale into the extrusion depth, position and rotation onto the placement** —
matching three.js's `M = T·R·S`. Unrotated, unmoved elements reuse the shared world axes so
unedited files stay as small as they were before the editor existed.

### [emit.ts](lib/ifc/emit.ts) — `emitIFC(scene, meta)`
Re-runnable, which is what lets post-build edits reach the download. Walks the scene in
order (terrain, buildings, roads, surfaces, volumes, trees), reconstructs the road surface
mesh from the stored quads, merges *all* trees into a single faceset (1200 separate
elements would cost more than the buildings), and returns the text plus `IfcStats` as data
for React to render.

---

## 12. Internationalisation (`lib/i18n/`)

- [keys.ts](lib/i18n/keys.ts) — the vocabulary the pure logic speaks: `StatusKey`,
  `ErrorCode`, `LayerKey`, `EditLabelKey`, `Params`.
- [en.ts](lib/i18n/en.ts) is the **shape of record** (`Dict = typeof en`) and
  [fr.ts](lib/i18n/fr.ts) is declared as a `Dict`, so a key added to one and forgotten in
  the other is a compile error. ~133 entries each, plus the notes prose.
- [context.tsx](lib/i18n/context.tsx) — `LangProvider` / `useT()`. Resolves the language
  from `?lang=` then `localStorage` in an effect (never in a state initialiser — this page
  is prerendered), exposes `t()`, locale-aware `n()` number formatting, the notes array,
  and `errorText()` which translates an `AppError`'s code and falls back to `e.message`.
- **Nested interpolation**: a `{param}` whose value is itself a dictionary key is translated
  first. That is how `status.undone` takes an `edit.*` label, `status.fetchingIgnLayer`
  takes a `layer.*` name, and `status.terrainUnavailable` takes the `err.*` code that
  caused it.

Proper nouns stay untranslated throughout: EPSG labels, datum names, provider names, city
presets, language endonyms, and IFC element names.

---

## 13. End-to-end flow

```
draw rectangle (MapController)
      └─> SiteRect ──> IfcSite state ──────> FlowBar step = "sited"
                                   │
                              [Build]
                                   ▼
                            runBuild(rect, opts)
        ┌──────────────┬───────────┴────────────┬──────────────┐
   resolveCRS +    terrain grid            buildings/roads   theme layers
   proj4 origin    (RGE ALTI | Terrarium)  (IGN WFS | Overpass)  + trees
        └──────────────┴───────────┬────────────┴──────────────┘
                                   ▼
                              SceneData + SiteMeta + BuildSummary
                          ┌────────┴────────┐
                          ▼                 ▼
                 Viewer.setScene()   IfcEmitter.setSource() ─> emitIFC ─> IfcStats
                          │                 ▲
                    gizmo / editor edits    │ markDirty (250 ms debounce)
                    mutate Building.xf ─────┘
                                            │
                                       [Download] ─> flush() ─> Blob ─> .ifc
```

The same `SceneData` object is held by both the viewer and the emitter. That shared
reference is precisely how a gizmo drag reaches the downloaded file without any copying or
serialisation round trip through React.
