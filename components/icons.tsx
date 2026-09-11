import type { ReactElement, ReactNode } from 'react';
import type { LayerId } from '@/lib/types';

/**
 * The icon set, drawn rather than imported.
 *
 * lucide-react is a dependency, but its stroke language — round caps on a 24
 * grid at 2 px — reads foreign beside the wordmark's dashed plate and the
 * crosshair this set grew out of. Everything here is 16×16 with square caps and
 * joins, to match `--radius: 0`; a rounded cap on a 1.3 stroke is visible at
 * this size.
 *
 * Each icon is decoration: the label lives on the button that holds it, so the
 * svg is always aria-hidden.
 */

const Svg = ({ children }: { children: ReactNode }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.3}
    strokeLinecap="square"
    strokeLinejoin="miter"
  >
    {children}
  </svg>
);

/* Sliders rather than a gear: a cog's teeth silt up at 16 px on a 1.3 stroke,
   and these say what the panel actually holds. */
export const IconOptions = () => (
  <Svg>
    <path d="M2 4h12M2 8h12M2 12h12" />
    <rect x="4.6" y="2.6" width="2.8" height="2.8" fill="currentColor" stroke="none" />
    <rect x="9.6" y="6.6" width="2.8" height="2.8" fill="currentColor" stroke="none" />
    <rect x="3.6" y="10.6" width="2.8" height="2.8" fill="currentColor" stroke="none" />
  </Svg>
);

/* The wrench, for the settings the *file* carries rather than the ones the build
   does. It has to be told apart from IconOptions above at a glance, since the
   two panels open in the same session and one is not the other.

   The one icon here not drawn on the 16 grid: it is public/wrench.svg, which is
   a 24-grid path, so it keeps its own viewBox rather than being redrawn a third
   of a pixel at a time. The stroke is 1.95, which is 1.3 at this scale — the
   same weight as everything above. Caps are square like the rest and it makes no
   difference: the path is closed, so it has no ends. */
export const IconWrench = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.95}
    strokeLinecap="square"
    strokeLinejoin="miter"
  >
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" />
  </svg>
);

/* A magnifying glass — the one pictogram for "find a place" that needs no
   caption of its own. */
export const IconSearch = () => (
  <Svg>
    <circle cx="6.6" cy="6.6" r="4.4" />
    <path d="M9.8 9.8 14 14" />
  </Svg>
);

/* Literally the gesture: a dashed rectangle and the two corners you click. */
export const IconDrawSite = () => (
  <Svg>
    <rect x="2.5" y="3.5" width="11" height="9" strokeDasharray="2.4 1.8" />
    <rect x="1.3" y="2.3" width="2.4" height="2.4" fill="currentColor" stroke="none" />
    <rect x="12.3" y="11.3" width="2.4" height="2.4" fill="currentColor" stroke="none" />
  </Svg>
);

/* The theme pair. Both are filled rather than outlined: at 16 px on a 1.3
   stroke a hollow disc reads as a ring, and the ring is what the origin marker
   already means in this set. The sun's rays are square-capped like everything
   else here, so they read as ticks rather than as a lens flare. */
export const IconSun = () => (
  <Svg>
    <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" />
    <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M12.9 3.1l-1.4 1.4M4.5 11.5l-1.4 1.4" />
  </Svg>
);

/* One path, not a disc with a bite taken out: an overlapping second circle
   would need a fill matching the button's background, which changes on hover. */
export const IconMoon = () => (
  <Svg>
    <path
      d="M13.4 9.9A6 6 0 0 1 6.1 2.6a6 6 0 1 0 7.3 7.3Z"
      fill="currentColor"
      stroke="none"
    />
  </Svg>
);

/* Three bars on a baseline, for the readout of site figures. Filled for the same
   reason as the theme pair: hollow bars at this size read as a row of slots. */
export const IconStats = () => (
  <Svg>
    <path d="M2 14h12" />
    <rect x="3.5" y="8" width="2" height="5" fill="currentColor" stroke="none" />
    <rect x="7" y="3" width="2" height="10" fill="currentColor" stroke="none" />
    <rect x="10.5" y="6" width="2" height="7" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconPan = () => (
  <Svg>
    <path d="M8 1.5v13M1.5 8h13" />
    <path d="M5.7 3.8 8 1.5l2.3 2.3M5.7 12.2 8 14.5l2.3-2.3M3.8 5.7 1.5 8l2.3 2.3M12.2 5.7 14.5 8l-2.3 2.3" />
  </Svg>
);

export const IconZoomSite = () => (
  <Svg>
    <path d="M1.5 5V1.5H5M11 1.5h3.5V5M14.5 11v3.5H11M5 14.5H1.5V11" />
    <rect x="6" y="6" width="4" height="4" />
  </Svg>
);

/* Solid, like IconCompass and for the same reason — a hollow arrow reads as a
   shape rather than as a pointer at this size. */
export const IconSelect = () => (
  <Svg>
    <path
      d="M4 2.2 12 8.6 8.3 9.2 10.4 13.3 8.8 14 6.7 9.9 4 12.6Z"
      fill="currentColor"
      stroke="none"
    />
  </Svg>
);

export const IconBox = () => (
  <Svg>
    <rect x="2.5" y="4.5" width="11" height="7" />
    <rect x="1.4" y="3.4" width="2.2" height="2.2" fill="currentColor" stroke="none" />
    <rect x="12.4" y="10.4" width="2.2" height="2.2" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconPolygon = () => (
  <Svg>
    <path d="M8 2 14 6.4 11.7 13.5H4.3L2 6.4Z" />
    <circle cx="8" cy="2" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="14" cy="6.4" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="2" cy="6.4" r="1.5" fill="currentColor" stroke="none" />
  </Svg>
);

/* Shared with the trees *layer* glyph below, which is the same canopy without the
   click dot. One string rather than two so the two cannot drift apart at the pixel
   level — the same reason IconRedo mirrors IconUndo instead of redrawing it. */
const TREE_CANOPY = 'M8 2 11.6 7.6 9.4 7.6 12 11.6H4L6.6 7.6H4.4Z';

/* A faceted canopy over a trunk, and the solid dot every other draw tool here
   uses to mark where a click lands — this one takes just the one. */
export const IconTree = () => (
  <Svg>
    <path d={TREE_CANOPY} />
    <path d="M8 11.6V13.2" />
    <circle cx="8" cy="14" r="1.4" fill="currentColor" stroke="none" />
  </Svg>
);

/* A dimension line: the run, its two end ticks, and the solid dots the draw
   tools use to mark where a click lands. Diagonal rather than horizontal so it
   cannot be read as a divider at 16 px. */
export const IconMeasure = () => (
  <Svg>
    <path d="M2.6 13.4 13.4 2.6" />
    <path d="M1.4 11.2 4.8 14.6M11.2 1.4 14.6 4.8" />
    <circle cx="3.1" cy="12.9" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12.9" cy="3.1" r="1.4" fill="currentColor" stroke="none" />
  </Svg>
);

/* The same language one dimension up: a closed region rather than a run, hatched
   so the enclosed part is what reads first. Deliberately a different silhouette
   from IconMeasure — the two sit side by side, and a rule beside a rule with a
   tick on it would be two of the same glyph. */
export const IconMeasureArea = () => (
  <Svg>
    <path d="M2.6 5.2 8 2.2l5.4 3V10.8L8 13.8 2.6 10.8Z" />
    <path d="M4.6 7.4 8 5.5M4.6 9.9 11.4 6.1M7.4 11.5l4-2.2" opacity="0.55" />
  </Svg>
);

/* An axis gizmo, not the four-arrow cross — that one is Pan, and the two sit
   four buttons apart on the same rail. */
export const IconMove = () => (
  <Svg>
    <path d="M3 13V4M3 13h9" />
    <path d="M1.5 5.5 3 4l1.5 1.5M10.5 11.5 12 13l-1.5 1.5" />
  </Svg>
);

export const IconRotate = () => (
  <Svg>
    <path d="M13.2 8a5.2 5.2 0 1 1-1.9-4" />
    <path d="M13.4 1.4v3.4H10" />
  </Svg>
);

export const IconScale = () => (
  <Svg>
    <rect x="2.5" y="7.5" width="6" height="6" />
    <path d="M9.6 6.4 14 2M14 2h-4M14 2v4" />
  </Svg>
);

/* Two squares, the back one drawn only where it shows — an L hugging the front
   square's corner rather than a whole rect behind it. Two full outlines crossing
   at 1.3 px is a lattice at this size, and the copy has to read as the thing in
   front. Distinct from IconBox, which is one volume seen in projection, and from
   IconScale above, whose square is anchored to an arrow instead. */
export const IconDuplicate = () => (
  <Svg>
    <rect x="2.2" y="6.2" width="7.6" height="7.6" />
    <path d="M6.2 6.2V2.4h7.4v7.4H9.8" />
  </Svg>
);

export const IconUndo = () => (
  <Svg>
    <path d="M5.2 3.6 2.2 6.6l3 3" />
    <path d="M2.2 6.6h6.4a3.9 3.9 0 1 1 0 7.8H5.4" />
  </Svg>
);

/* The same paths, mirrored — drawing a second set by hand would let the two
   drift apart at the pixel level, which is exactly where it would show. */
export const IconRedo = () => (
  <Svg>
    <g transform="translate(16,0) scale(-1,1)">
      <path d="M5.2 3.6 2.2 6.6l3 3" />
      <path d="M2.2 6.6h6.4a3.9 3.9 0 1 1 0 7.8H5.4" />
    </g>
  </Svg>
);

/* A box drawn in parallel projection — every edge that is parallel in the model
   is parallel here, which is the whole of what the toggle does. A perspective
   icon would have to converge, and two vanishing points do not survive 16 px. */
export const IconProjection = () => (
  <Svg>
    <rect x="2.5" y="5.5" width="7" height="7" />
    <path d="M2.5 5.5 6 2h7v7l-3.5 3.5" />
    <path d="M9.5 5.5 13 2" />
  </Svg>
);

export const IconOrigin = () => (
  <Svg>
    <circle cx="8" cy="8" r="3.4" />
    <path d="M8 .5v3.4M8 12.1v3.4M.5 8h3.4M12.1 8h3.4" />
  </Svg>
);

/* An orbit seen edge-on, with the thing it goes round solid at the centre — the
   planetary reading, which is what the mode does and is legible at 16 px where a
   film clapper or a play triangle would only say "video".

   The ellipse is drawn as two arcs split at the sides so the near half can carry
   the chevron and the far half stays a plain line: an unbroken ring reads as
   static, and the arrowhead is the only part of this that says it keeps going.
   The chevron sits on the near sweep, where the direction is unambiguous. */
export const IconPresentation = () => (
  <Svg>
    <path d="M1.3 8a6.7 3.6 0 0 1 13.4 0" />
    <path d="M14.7 8a6.7 3.6 0 0 1-7.5 3.57" />
    <path d="M9.07 12.73 7.2 11.57 9.2 10.67" />
    <rect x="6.7" y="6.7" width="2.6" height="2.6" fill="currentColor" stroke="none" />
  </Svg>
);

/* Stacked plates rather than the usual indented-list tree: the panel's subject
   is the layers of the model, and a list glyph would read as an outline of the
   document. The filled top plate is the one you are looking at. */
export const IconLayers = () => (
  <Svg>
    <path d="M8 1.8 14.4 5 8 8.2 1.6 5Z" fill="currentColor" stroke="none" />
    <path d="M1.6 8.3 8 11.5l6.4-3.2" />
    <path d="M1.6 11.5 8 14.7l6.4-3.2" />
  </Svg>
);

/* The surveyor's north arrow: apex, two base corners, and a notch back up to the
   centre. The notch is what makes it read as a needle pointing somewhere rather
   than as a plain triangle — and it survives being turned to any angle, which is
   the whole job here. Solid for the same reason IconSelect is.

   Sized past the 16 grid on purpose: it sits alone inside a 28 px ring with no
   other glyph to line up with, and a needle inset to the usual margins looks
   lost in it. */
export const IconCompass = () => (
  <Svg>
    <path d="M8 .8 12.6 15.2 8 12.2 3.4 15.2Z" fill="currentColor" stroke="none" />
  </Svg>
);

/* The lens as two arcs rather than an ellipse element, to keep the corners
   square like everything else in the set — an ellipse's own curvature already
   reads as round without help from the stroke join. */
export const IconEye = () => (
  <Svg>
    <path d="M1 8s2.6-4.6 7-4.6S15 8 15 8s-2.6 4.6-7 4.6S1 8 1 8Z" />
    <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
  </Svg>
);

/* The same lens, struck through — the slash reads at this size where closing
   the lids into a line would not. */
export const IconEyeOff = () => (
  <Svg>
    <path d="M1 8s2.6-4.6 7-4.6S15 8 15 8s-2.6 4.6-7 4.6S1 8 1 8Z" />
    <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
    <path d="M2 14 14 2" />
  </Svg>
);

/* Drafts: a disk with a reload arc turning back into it — the panel's two halves
   in one glyph, save and pick up again. The arc is open at the top-right with a
   solid arrowhead, which is the only part of a circular arrow that still reads at
   16 px on a 1.3 stroke; a full ring with a thin barb turns to mush. */
export const IconDrafts = () => (
  <Svg>
    {/* The disk, bottom-anchored: body, then the shutter that makes it a disk
        rather than a plain box. */}
    <path d="M3.5 7.5h9v6h-9z" />
    <path d="M6 7.5v2.5h4V7.5" />
    {/* The reload arc riding over it, open at the right so the arrowhead has
        somewhere to sit. */}
    <path d="M3.4 5.6A5 5 0 0 1 12 3.9" />
    <path d="M12.9 1.2v3.9l-3.4-1Z" fill="currentColor" stroke="none" />
  </Svg>
);

/* A disk, kept because nothing else says "write this down" as quickly, drawn as
   the shutter and the label rather than the whole outline. */
export const IconSave = () => (
  <Svg>
    <path d="M2.5 2.5h9l2 2v9h-11z" />
    <path d="M5 2.5v4h5v-4M5 13.5v-4h6v4" />
  </Svg>
);

/* A sheet coming up out of the stack — the mirror of IconExport below, which
   sends one down into it. */
export const IconOpen = () => (
  <Svg>
    <path d="M8 10.5v-8M5 5.5 8 2.5l3 3" />
    <path d="M2.5 9.5v4h11v-4" />
  </Svg>
);

export const IconExport = () => (
  <Svg>
    <path d="M8 2.5v8M5 7.5 8 10.5l3-3" />
    <path d="M2.5 9.5v4h11v-4" />
  </Svg>
);

/* A bin. The lid is a separate stroke so it still reads at 16 px once the body
   tapers. */
export const IconTrash = () => (
  <Svg>
    <path d="M2.5 4.5h11M6 4.5v-2h4v2" />
    <path d="M4 4.5l.7 9h6.6l.7-9" />
  </Svg>
);

/* A pencil, for rename. Nib at the bottom-left so it points at the row it
   edits. */
export const IconRename = () => (
  <Svg>
    <path d="M11 2.5 13.5 5 5.5 13H3v-2.5z" />
  </Svg>
);

/* =====================================================================
   The layer glyphs.

   One per LayerId, for the model tree's rows. Everything above is a verb — a
   thing the rail or a panel does — and these are the only nouns in the set:
   they name what a row *is*, so that scanning nine layers is recognising nine
   marks rather than reading nine words that the panel is too narrow to finish.

   They are drawn as the layer looks in plan or in section, not as a symbol of
   it — a road is two kerbs and a centre line, a hedge is a clipped run. The
   whole set is decoration beside a label that already says the name, so the
   bar they have to clear is being told apart from each other at 16 px, and
   nothing finer than that survives a 1.3 stroke anyway. Three pairs are the
   ones that actually collide, and each is separated by silhouette rather than
   by detail: terrain's angular peaks against water's waves, the three green
   layers by mass (one tall, several small, one long), and parcel against the
   dashed IconDrawSite it would otherwise be a copy of.
   ===================================================================== */

/* Two peaks closed onto a ground line. Angular on purpose — the contour-line
   reading of terrain is three stacked curves, which is water with an extra
   stroke. */
export const IconLayerTerrain = () => (
  <Svg>
    <path d="M1.5 12.5 5.5 5 8.5 9.5 10.8 6.8 14.5 12.5Z" />
  </Svg>
);

/* Two blocks of unequal height sharing a party wall, open at the bottom where
   the ground line closes them — the massing the layer actually builds. */
export const IconLayerBuildings = () => (
  <Svg>
    <path d="M2.5 13.5V5.5h5.5v8" />
    <path d="M8 13.5V8.5h5.5v5" />
    <path d="M1.5 13.5h13" />
  </Svg>
);

/* A carriageway in plan: two kerbs, splayed just enough to read as running away
   from you, and the dashed centre line that makes it a road rather than a pair
   of lines.

   The gap is wider than the dash in the array and narrower than it on screen —
   the set's square caps add half a stroke to each end of every dash, so 1.4/2.3
   paints as roughly 2.7 on, 1.0 off. Which is what a centre line looks like,
   but it has to be worked backwards from the cap to get there. */
export const IconLayerRoads = () => (
  <Svg>
    <path d="M4.4 1.5 2.5 14.5" />
    <path d="M11.6 1.5 13.5 14.5" />
    <path d="M8 2.5v11" strokeDasharray="1.4 2.3" />
  </Svg>
);

/* The map-maker's ladder: two rails and the sleepers running past them. Kept
   parallel where the road splays, which is most of what tells the two apart at
   a glance. */
export const IconLayerRailways = () => (
  <Svg>
    <path d="M5.5 1.5v13M10.5 1.5v13" />
    <path d="M3.4 4.2h9.2M3.4 8h9.2M3.4 11.8h9.2" />
  </Svg>
);

/* IconTree's canopy on a full trunk. The draw tool's dot is gone: it marks
   where a click lands, and a row is not a click target in that sense. */
export const IconLayerTrees = () => (
  <Svg>
    <path d={TREE_CANOPY} />
    <path d="M8 11.6v2.9" />
  </Svg>
);

/* Two sprigs on a ground line — scrub, at the scale below a tree and above
   nothing. Small and repeated, against the single tall mass of trees and the
   single long one of hedge. */
export const IconLayerVegetation = () => (
  <Svg>
    <path d="M1.5 13.5h13" />
    <path d="M4.3 13.5V9.2M4.3 11.2 2.4 9.3M4.3 11.2 6.2 9.3" />
    <path d="M10.6 13.5V7.6M10.6 9.8 8.7 7.9M10.6 9.8 12.5 7.9" />
  </Svg>
);

/* A clipped run: one low mass the width of the frame, scalloped along the top.
   The scallops are what keep it from reading as a fence — a flat-topped bar
   with uprights is exactly that, and the site has no fence layer to confuse it
   with, which is precisely why it must not look like one. */
export const IconLayerHedge = () => (
  <Svg>
    <path d="M1.5 13.5h13" />
    <path d="M2.2 13.5V9.6a1.9 1.9 0 0 1 3.8 0 1.9 1.9 0 0 1 3.8 0 1.9 1.9 0 0 1 3.8 0v3.9" />
  </Svg>
);

/* Two waves. Curved where terrain is angular, and that is the entire
   distinction — so they are drawn shallow and long, with no peak sharp enough
   to be mistaken for a summit. */
export const IconLayerWater = () => (
  <Svg>
    <path d="M2 6.2q3-2.4 6 0t6 0" />
    <path d="M2 10.6q3-2.4 6 0t6 0" />
  </Svg>
);

/* A plot and the line that splits it in two. Slanted because a cadastral
   boundary never is axis-aligned, and solid because the dashed rectangle is
   already taken by IconDrawSite — the tool that draws the site, not the layer
   that comes back from the register. */
export const IconLayerParcel = () => (
  <Svg>
    <path d="M2.2 5 9 2.2 13.8 6 7 13.8Z" />
    <path d="M5.6 3.6 10.4 9.9" />
  </Svg>
);

/* A hole through the ground, in section: the ground line drops into a pit and
   comes back up. The floor of the pit is dashed because it is not ground — it is
   where the terrain stops, which is the whole of what a void is. Not a layer of
   its own (a void is listed under the terrain), so it is not in LAYER_ICON. */
export const IconVoid = () => (
  <Svg>
    <path d="M1.5 6.5h3.5v6.5M11 13V6.5h3.5" />
    <path d="M5 13h6" strokeDasharray="1 1.6" />
  </Svg>
);

/**
 * Layer to glyph.
 *
 * Here rather than beside LAYER_LABEL in lib/scene/layers, which is the file
 * this belongs with by subject: that module is read by the viewer and the IFC
 * emitter, neither of which is React, and neither of which should have to grow
 * a JSX build step to answer what a layer is called.
 *
 * Exhaustive by type, so a tenth entry in LAYER_IDS fails the typecheck rather
 * than rendering a row with a hole in it.
 */
export const LAYER_ICON: Record<LayerId, () => ReactElement> = {
  terrain: IconLayerTerrain,
  buildings: IconLayerBuildings,
  roads: IconLayerRoads,
  railways: IconLayerRailways,
  trees: IconLayerTrees,
  vegetation: IconLayerVegetation,
  hedge: IconLayerHedge,
  water: IconLayerWater,
  parcel: IconLayerParcel,
};
