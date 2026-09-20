'use client';

import type { RefObject } from 'react';
import {
  IconCompass,
  IconMoon,
  IconOrigin,
  IconPresentation,
  IconProjection,
  IconStats,
  IconSun,
} from '@/components/icons';
import { LangToggle } from '@/components/lang-toggle';
import { useT } from '@/lib/i18n/context';
import { useTheme } from '@/lib/theme/context';
import type { ViewTab } from '@/lib/types';

export type UtilChipProps = {
  view: ViewTab;
  /** Phone: keep the compass, hand every button to the rail. See below. */
  compact?: boolean;
  compassRef: RefObject<HTMLDivElement | null>;
  hasScene: boolean;
  showOrigin: boolean;
  onShowOrigin: (v: boolean) => void;
  ortho: boolean;
  onOrtho: (v: boolean) => void;
  presenting: boolean;
  onPresent: (v: boolean) => void;
  showStats: boolean;
  onShowStats: (v: boolean) => void;
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
 *
 * On a phone there is no room for a second cluster in the top row: the brand and
 * its two tabs take the width, and this one wrapped underneath and landed on
 * them. So `compact` empties the chip, and every button below is rendered into
 * the rail's foot dock instead (the `utils` slot in components/tool-rail) — in
 * thumb reach, and already the home of every other control.
 *
 * What stays is the compass, and it stays for the reason the element carries on
 * itself below: the viewer is handed this node once, on mount, and writes the
 * needle into it every frame. So the tree above it has to hold its shape whether
 * or not the buttons are here — emptied and hidden is fine, unmounted is not,
 * which is the same constraint presentation mode works around by fading the
 * overlay rather than taking it away.
 */
export function UtilChip(p: UtilChipProps) {
  const { t } = useT();
  const { theme, toggle } = useTheme();
  const isMap = p.view === 'map';
  const dark = theme === 'dark';

  return (
    <div className={`utilChip${p.compact ? ' utilChip--compact' : ' floating'}`}>
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

      {!p.compact && (
        <>
          {/* All three only mean anything with the 3D view up: one toggles a
              marker in the scene, one the projection it is drawn with, and the
              third flies the camera round it. */}
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

              {/* Disabled rather than hidden without a scene: the 3D tab is
                  reachable before a build, and a button that comes and goes in a
                  fixed row of three moves the two beside it. There is nothing to
                  orbit until there is a model. */}
              <button
                type="button"
                className={`iconBtn${p.presenting ? ' on' : ''}`}
                title={t('ui.presentation')}
                aria-label={t('ui.presentation')}
                aria-pressed={p.presenting}
                disabled={!p.hasScene}
                onClick={() => p.onPresent(!p.presenting)}
              >
                <IconPresentation />
              </button>
            </>
          )}

          {/* Outside the !isMap block above, like the theme beside it: the
              readout sits over whichever viewer is up, so it is as available
              over the map as over the stage. Off by default — the corner stays
              clear until asked. */}
          <button
            type="button"
            className={`iconBtn statsBtn${p.showStats ? ' on' : ''}`}
            title={t('ui.stats')}
            aria-label={t('ui.stats')}
            aria-pressed={p.showStats}
            onClick={() => p.onShowStats(!p.showStats)}
          >
            <IconStats />
          </button>

          {/* The theme is the whole window, not the 3D scene. It carries no `on`
              state — the icon is the state, and it shows the theme the press
              would move to rather than the one in force. */}
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
        </>
      )}
    </div>
  );
}
