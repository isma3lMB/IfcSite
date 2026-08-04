'use client';

import type { RefObject } from 'react';
import { useT } from '@/lib/i18n/context';
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

export type StageHudProps = {
  compassRef: RefObject<HTMLDivElement | null>;
  view: ViewTab;
};

/**
 * The read-only labels drawn over the viewer. They live in the overlay grid's
 * centre cell, not on the stage, so they track the free space between the dock
 * and the element editor instead of hiding beneath them.
 */
export function StageHud(p: StageHudProps) {
  const { t } = useT();
  const isMap = p.view === 'map';

  return (
    <div className="hudlayer">
      {/* The compass stays mounted and is hidden rather than unmounted: the
          viewer is handed this element once, on mount, and the page boots into
          the map — an element that only existed in the 3D tab would never
          reach it, and the needle would never turn. */}
      <div
        className="hud hud-compass"
        ref={p.compassRef}
        style={{ display: isMap ? 'none' : 'flex' }}
      >
        N
      </div>

      {/* Nothing else over the map: the flow bar already carries the drawing
          prompt, and a second copy competed with the basemap for the corner. */}
      {!isMap && (
        <>
          <div className="hud hud-legend">{t('sheet.hudLegend')}</div>
          <div className="hud hud-hint">{t('sheet.hudHint')}</div>
        </>
      )}
    </div>
  );
}
