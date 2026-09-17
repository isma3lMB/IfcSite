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

/* The GitHub mark (Octicons' mark-github, MIT). The one glyph not drawn in this
   set's stroke language: it is a logo, and a logo is reproduced, not redrawn —
   so it is a filled silhouette on the same 16 grid. */
export const IconGitHub = () => (
  <Svg>
    <path
      fill="currentColor"
      stroke="none"
      d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"
    />
  </Svg>
);

/* The Buy Me a Coffee mark, for the support link beside the repo link in the
   info panel's footer. The second glyph here not drawn in this set's stroke
   language, and the only one that also keeps its own colours: the mark is
   two-tone by design — a #FFDD00 cup inside a #0D0C22 outline — and the
   one-colour reduction IconGitHub gets away with is, for this logo, simply not
   the Buy Me a Coffee mark. It therefore ignores currentColor, and the chip
   that holds it carries a light ground in both themes so the dark outline has
   something to read against (.bmcBtn in globals.css).

   The official file is 35x50 with fourteen paths, twelve of them sub-pixel
   anti-alias specks that are invisible at this size; only the cup and the
   outline survive. The viewBox pads that 35 out to 50 so the icon keeps the
   set's square 16 footprint without being squashed — the art then spans
   -7.5 to 42.5, centred on the box's own centre at 17.5. */
export const IconBuyMeACoffee = () => (
  <svg width="16" height="16" viewBox="-7.5 0 50 50" aria-hidden="true" fill="none">
    <path
      fill="#FFDD00"
      d="M18.3715 23.0976C16.5857 23.8665 14.5591 24.7382 11.9326 24.7382C10.8339 24.736 9.74049 24.5844 8.68213 24.2875L10.4987 43.0444C10.563 43.8284 10.9181 44.5594 11.4935 45.0923C12.0689 45.6251 12.8225 45.9208 13.6047 45.9207C13.6047 45.9207 16.1804 46.0552 17.0398 46.0552C17.9648 46.0552 20.7385 45.9207 20.7385 45.9207C21.5205 45.9207 22.274 45.6249 22.8493 45.092C23.4245 44.5592 23.7795 43.8283 23.8438 43.0444L25.7895 22.3173C24.92 22.0187 24.0425 21.8203 23.0533 21.8203C21.3424 21.8196 19.964 22.4122 18.3715 23.0976Z"
    />
    <path
      fill="#0D0C22"
      d="M34.1896 13.3639L33.916 11.9762C33.6706 10.7312 33.1134 9.55468 31.8426 9.10468C31.4353 8.96073 30.9732 8.89885 30.6608 8.60086C30.3485 8.30288 30.2562 7.84009 30.1839 7.41094C30.0502 6.62326 29.9244 5.83492 29.7873 5.04859C29.6689 4.37257 29.5753 3.61315 29.267 2.99296C28.8657 2.16022 28.033 1.67322 27.205 1.35102C26.7807 1.19173 26.3477 1.05698 25.9081 0.947426C23.8394 0.398542 21.6644 0.196746 19.5362 0.0817228C16.9817 -0.0600379 14.4204 -0.0173274 11.872 0.209526C9.97525 0.383071 7.97745 0.592939 6.17495 1.25281C5.51616 1.49429 4.8373 1.7842 4.33634 2.29609C3.72169 2.92502 3.52104 3.89768 3.96982 4.68199C4.28886 5.23895 4.82927 5.63245 5.40246 5.89276C6.14906 6.22818 6.92877 6.48341 7.72865 6.65421C9.95585 7.14928 12.2626 7.34368 14.538 7.42641C17.0599 7.52878 19.5859 7.44582 22.0958 7.1782C22.7165 7.10959 23.336 7.0273 23.9545 6.93134C24.6828 6.81901 25.1503 5.86115 24.9356 5.19388C24.6788 4.39611 23.9886 4.08669 23.208 4.2071C23.093 4.22526 22.9786 4.24208 22.8636 4.25889L22.7807 4.271C22.5163 4.30463 22.2518 4.33602 21.9874 4.36517C21.4412 4.42437 20.8937 4.4728 20.3448 4.51046C19.1155 4.59656 17.8828 4.63625 16.6508 4.63827C15.4403 4.63827 14.229 4.60396 13.0211 4.52392C12.47 4.48759 11.9202 4.4414 11.3718 4.38535C11.1223 4.35912 10.8735 4.33154 10.6247 4.3006L10.3879 4.27033L10.3364 4.26293L10.091 4.22728C9.58933 4.15127 9.08771 4.06382 8.59144 3.95822C8.54136 3.94704 8.49657 3.91902 8.46446 3.87879C8.43236 3.83855 8.41486 3.7885 8.41486 3.73691C8.41486 3.68533 8.43236 3.63528 8.46446 3.59504C8.49657 3.55481 8.54136 3.52679 8.59144 3.51561H8.6008C9.03086 3.42346 9.46426 3.34476 9.899 3.27615C10.0439 3.25328 10.1893 3.23086 10.3351 3.20888H10.3391C10.6113 3.19072 10.8849 3.14162 11.1557 3.10933C13.5125 2.86279 15.8832 2.77874 18.2513 2.85776C19.4011 2.89139 20.5501 2.95933 21.6945 3.07637C21.9406 3.10193 22.1854 3.12884 22.4302 3.15911C22.5238 3.17054 22.6181 3.18399 22.7124 3.19543L22.9024 3.22301C23.4562 3.30597 24.0071 3.40664 24.5551 3.52503C25.367 3.70261 26.4097 3.76046 26.7709 4.65508C26.8859 4.93894 26.9381 5.25442 27.0016 5.5524L27.0826 5.93245C27.0847 5.93927 27.0863 5.94624 27.0873 5.9533C27.2785 6.85017 27.4701 7.74704 27.6618 8.64391C27.6758 8.71017 27.6762 8.77862 27.6628 8.84501C27.6493 8.9114 27.6225 8.97429 27.5838 9.02977C27.5451 9.08525 27.4955 9.13212 27.4381 9.16746C27.3806 9.2028 27.3165 9.22585 27.2498 9.23517H27.2444L27.1274 9.25132L27.0117 9.26679C26.6452 9.31477 26.2782 9.35961 25.9108 9.40132C25.1871 9.48428 24.4623 9.55603 23.7364 9.61657C22.294 9.7372 20.8486 9.81635 19.4004 9.85401C18.6625 9.87374 17.9247 9.88294 17.1872 9.88159C14.2517 9.87926 11.3188 9.70768 8.40283 9.36769C8.08714 9.33002 7.77145 9.28966 7.45577 9.24863C7.70056 9.28024 7.27786 9.22441 7.19225 9.2123C6.9916 9.18405 6.79095 9.15468 6.5903 9.12419C5.91679 9.02262 5.24729 8.8975 4.57511 8.78786C3.76249 8.65333 2.98531 8.72059 2.25026 9.12419C1.6469 9.45624 1.15857 9.96544 0.850401 10.5838C0.533376 11.243 0.439071 11.9608 0.297279 12.6691C0.155487 13.3774 -0.0652275 14.1395 0.0183763 14.8666C0.198292 16.4359 1.28915 17.7113 2.85823 17.9965C4.33434 18.2655 5.81847 18.4835 7.30662 18.6691C13.1524 19.3892 19.0582 19.4753 24.9223 18.9261C25.3998 18.8812 25.8767 18.8324 26.3529 18.7794C26.5016 18.763 26.6521 18.7802 26.7934 18.8299C26.9347 18.8795 27.0631 18.9603 27.1693 19.0663C27.2755 19.1724 27.3567 19.3009 27.4071 19.4426C27.4575 19.5843 27.4757 19.7356 27.4605 19.8853L27.312 21.3369C27.0128 24.2701 26.7136 27.2031 26.4144 30.1358C26.1023 33.2157 25.7882 36.2953 25.472 39.3747C25.3829 40.242 25.2937 41.109 25.2045 41.9758C25.1189 42.8294 25.1069 43.7099 24.9457 44.5534C24.6915 45.8799 23.7986 46.6945 22.4957 46.9925C21.3021 47.2657 20.0827 47.4091 18.8586 47.4203C17.5016 47.4277 16.1452 47.3672 14.7881 47.3746C13.3395 47.3826 11.5651 47.2481 10.4468 46.1638C9.46426 45.2113 9.32849 43.72 9.19472 42.4306C9.01637 40.7234 8.83957 39.0164 8.66434 37.3097L7.68116 27.8192L7.0451 21.6786C7.0344 21.577 7.0237 21.4768 7.01367 21.3745C6.93742 20.642 6.42176 19.925 5.60913 19.962C4.91354 19.9929 4.12299 20.5875 4.20458 21.3745L4.67611 25.927L5.65126 35.3442C5.92905 38.0191 6.20617 40.6944 6.48262 43.3703C6.53613 43.8828 6.58628 44.3967 6.64247 44.9093C6.94812 47.7102 9.075 49.2196 11.7089 49.6448C13.2472 49.8936 14.8229 49.9448 16.384 49.9703C18.3851 50.0026 20.4063 50.08 22.3747 49.7154C25.2915 49.1773 27.4799 47.2185 27.7922 44.1801C27.8814 43.303 27.9706 42.4256 28.0597 41.548C28.3563 38.6458 28.6523 35.7433 28.9479 32.8406L29.9151 23.3562L30.3585 19.0095C30.3806 18.794 30.4711 18.5913 30.6166 18.4315C30.7621 18.2717 30.9549 18.1633 31.1665 18.1223C32.0005 17.9588 32.7977 17.6796 33.391 17.0413C34.3354 16.0249 34.5233 14.6998 34.1896 13.3639ZM2.81542 14.3016C2.82813 14.2955 2.80472 14.4052 2.79469 14.4563C2.79268 14.3789 2.7967 14.3103 2.81542 14.3016ZM2.89635 14.9312C2.90304 14.9265 2.9231 14.9534 2.94384 14.9857C2.9124 14.9561 2.89234 14.9339 2.89568 14.9312H2.89635ZM2.97594 15.0368C3.0047 15.0859 3.02009 15.1168 2.97594 15.0368V15.0368ZM3.13579 15.1673H3.1398C3.1398 15.172 3.14716 15.1767 3.14984 15.1814C3.1454 15.1762 3.14048 15.1715 3.13513 15.1673H3.13579ZM31.1277 14.9722C30.828 15.2588 30.3766 15.392 29.9305 15.4586C24.9276 16.2052 19.8519 16.5832 14.7942 16.4164C11.1745 16.292 7.59287 15.8877 4.00928 15.3785C3.65815 15.3287 3.27758 15.2642 3.03614 15.0038C2.58133 14.5128 2.80472 13.524 2.9231 12.9307C3.03145 12.3872 3.23879 11.6628 3.88154 11.5854C4.88478 11.467 6.04989 11.8928 7.04243 12.0442C8.2374 12.2276 9.43684 12.3744 10.6407 12.4848C15.7787 12.9556 21.0029 12.8823 26.1181 12.1935C27.0505 12.0675 27.9795 11.9211 28.9051 11.7543C29.7298 11.6056 30.6441 11.3264 31.1424 12.1854C31.4841 12.7706 31.5296 13.5536 31.4768 14.2148C31.4605 14.5029 31.3354 14.7739 31.127 14.9722H31.1277Z"
    />
  </svg>
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
