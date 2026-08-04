import type { ReactNode } from 'react';

/**
 * The icon set, drawn rather than imported.
 *
 * lucide-react is a dependency, but its stroke language — round caps on a 24
 * grid at 2 px — reads foreign beside the clip-path wordmark and the crosshair
 * this set grew out of. Everything here is 16×16 with square caps and joins, to
 * match `--radius: 0`; a rounded cap on a 1.3 stroke is visible at this size.
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

/* Literally the gesture: a dashed rectangle and the two corners you click. */
export const IconDrawSite = () => (
  <Svg>
    <rect x="2.5" y="3.5" width="11" height="9" strokeDasharray="2.4 1.8" />
    <rect x="1.3" y="2.3" width="2.4" height="2.4" fill="currentColor" stroke="none" />
    <rect x="12.3" y="11.3" width="2.4" height="2.4" fill="currentColor" stroke="none" />
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

/* The one solid glyph in the set — a hollow arrow reads as a shape rather than
   as a pointer at this size. */
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

export const IconOrigin = () => (
  <Svg>
    <circle cx="8" cy="8" r="3.4" />
    <path d="M8 .5v3.4M8 12.1v3.4M.5 8h3.4M12.1 8h3.4" />
  </Svg>
);
