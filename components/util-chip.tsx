'use client';

import type { RefObject } from 'react';
import { IconOrigin } from '@/components/icons';
import { LangToggle } from '@/components/lang-toggle';
import { useT } from '@/lib/i18n/context';
import type { ViewTab } from '@/lib/types';

export type UtilChipProps = {
  view: ViewTab;
  compassRef: RefObject<HTMLDivElement | null>;
  showOrigin: boolean;
  onShowOrigin: (v: boolean) => void;
  infoOpen: boolean;
  onInfo: () => void;
};

/**
 * The things that are always available, and the compass.
 *
 * The compass used to live over the stage, pinned to the right edge of the free
 * space between the panels. That space now changes width every time the element
 * editor appears and disappears, which would slide the needle ~300 px sideways
 * on every click — so it is docked here instead, in a corner that never moves.
 */
export function UtilChip(p: UtilChipProps) {
  const { t } = useT();
  const isMap = p.view === 'map';

  return (
    <div className="utilChip floating">
      {/* Hidden rather than unmounted, and rendered at every view: the viewer is
          handed this element once, on mount, and the page boots into the map —
          an element that only existed in the 3D tab would never reach it, and
          the needle would never turn. */}
      <div
        className="compassChip"
        ref={p.compassRef}
        aria-hidden="true"
        style={{ display: isMap ? 'none' : 'flex' }}
      >
        N
      </div>

      {/* Only means anything with the 3D view up — it toggles a marker in the
          scene, and the origin it belongs to reads out in the status bar. */}
      {!isMap && (
        <button
          type="button"
          className={`iconBtn${p.showOrigin ? ' on' : ''}`}
          title={t('ui.originMarker')}
          aria-label={t('ui.originMarker')}
          aria-pressed={p.showOrigin}
          onClick={() => p.onShowOrigin(!p.showOrigin)}
        >
          <IconOrigin />
        </button>
      )}

      <button
        type="button"
        className={`iconBtn${p.infoOpen ? ' on' : ''}`}
        title={t('ui.info')}
        aria-label={t('ui.info')}
        aria-expanded={p.infoOpen}
        onClick={p.onInfo}
      >
        i
      </button>

      <LangToggle />
    </div>
  );
}
