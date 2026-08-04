'use client';

import type { RefObject } from 'react';
import type { ViewTab } from '@/lib/types';

export type StageProps = {
  viewportRef: RefObject<HTMLDivElement | null>;
  mapRef: RefObject<HTMLDivElement | null>;
  view: ViewTab;
};

/**
 * The full-window viewer surface. Both hosts stay mounted at all times and the
 * map is an overlay rather than a replacement: tearing either down on a tab
 * switch would lose the camera, the selection and the undo stack. Neither host
 * carries a size of its own — the stage fills the window and both viewers
 * re-measure through their own ResizeObservers.
 */
export function Stage(p: StageProps) {
  return (
    <div className="stage">
      <div className="viewport" ref={p.viewportRef} />
      <div
        className="map2d"
        ref={p.mapRef}
        style={{ display: p.view === 'map' ? 'block' : 'none' }}
      />
    </div>
  );
}

/* The HUD that used to sit here is gone. Its two labels each restated something
   said elsewhere — the legend repeated the build summary's tagged/estimated
   split, and the hint repeated the element editor's empty state, on screen at
   the same time as it. The compass it hosted moved to the utility cluster,
   which does not change width when the editor opens. */
