'use client';

import type { RefObject } from 'react';
import { IconCompass, IconMoon, IconOrigin, IconProjection, IconSun } from '@/components/icons';
import { LangToggle } from '@/components/lang-toggle';
import { useT } from '@/lib/i18n/context';
import { useTheme } from '@/lib/theme/context';
import type { ViewTab } from '@/lib/types';

export type UtilChipProps = {
  view: ViewTab;
  compassRef: RefObject<HTMLDivElement | null>;
  showOrigin: boolean;
  onShowOrigin: (v: boolean) => void;
  ortho: boolean;
  onOrtho: (v: boolean) => void;
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
  const { theme, toggle } = useTheme();
  const isMap = p.view === 'map';
  const dark = theme === 'dark';

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
        <IconCompass />
      </div>

      {/* Both only mean anything with the 3D view up: one toggles a marker in
          the scene, the other the projection it is drawn with. */}
      {!isMap && (
        <>
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

          <button
            type="button"
            className={`iconBtn${p.ortho ? ' on' : ''}`}
            title={t('ui.projection')}
            aria-label={t('ui.projection')}
            aria-pressed={p.ortho}
            onClick={() => p.onOrtho(!p.ortho)}
          >
            <IconProjection />
          </button>
        </>
      )}

      {/* Outside the !isMap block above: the theme is the whole window, not the
          3D scene, so it is as available over the map as over the stage. It
          carries no `on` state — the icon is the state, and it shows the theme
          the press would move to rather than the one in force. */}
      <button
        type="button"
        className="iconBtn"
        title={t(dark ? 'ui.themeLight' : 'ui.themeDark')}
        aria-label={t(dark ? 'ui.themeLight' : 'ui.themeDark')}
        onClick={toggle}
      >
        {dark ? <IconSun /> : <IconMoon />}
      </button>

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
