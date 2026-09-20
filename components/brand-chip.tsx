'use client';

import { useT } from '@/lib/i18n/context';
import type { ViewTab } from '@/lib/types';

export type BrandChipProps = {
  view: ViewTab;
  onView: (v: ViewTab) => void;
};

/**
 * Identity and the one switch that changes what the window is showing.
 *
 * This is what is left of the masthead: it used to be a strip across the whole
 * window carrying a readout and three utility buttons as well, which put a bar
 * between the user and the viewer for the sake of two controls. The readout
 * moved to the status bar, the utilities to the opposite corner, and what
 * remains shrink-wraps into the top-left corner.
 *
 * The lockup is now one drawn asset rather than type in a bordered span: the
 * words and the site rectangle around them are vector paths, so the plate and
 * the letterforms hold their exact relationship at any size.
 *
 * Two files, swapped on html.dark. The names describe the *ink*, not the
 * theme: public/logo.svg is dark letters for light ground, and
 * public/logo_light.svg is light (white) letters for dark ground — so the one
 * that reads "light" is the one dark mode wants. The swap is a class and not a
 * <picture media> query, because this app's theme is a stored class that the
 * OS preference knows nothing about; a media query would desync the moment
 * anyone used the toggle.
 *
 * The words are drawn rather than set, so they are no longer text to a screen
 * reader: alt carries the name, built from the same two i18n keys the display
 * lockup in the info overlay uses, which is what stops the two drifting apart.
 *
 * Each tab carries both its labels and CSS picks one — `Carte 2D` down to `2D`
 * on a phone, where the chip shares a 375 px row with nothing to spare. Two
 * spans rather than a breakpoint read in JS, deliberately: the page is
 * prerendered, so a JS answer would be the desktop one for the first paint and
 * the tabs would visibly re-label themselves on arrival.
 */
export function BrandChip(p: BrandChipProps) {
  const { t } = useT();
  const isMap = p.view === 'map';
  // The name still comes from the two lockup keys, so the accessible name of
  // the mark and the h1's in the info overlay cannot drift from each other or
  // from the product name.
  const mark = `${t('app.h1a')} ${t('app.h1b')}`;

  return (
    <div className="brandChip floating">
      <div className="wordmark">
        <img className="markLight" src="/logo.svg" alt={mark} />
        <img className="markDark" src="/logo_light.svg" alt="" aria-hidden="true" />
      </div>

      <div className="sep" />

      <div className="viewtabs">
        <button type="button" className={isMap ? 'on' : undefined} onClick={() => p.onView('map')}>
          <span className="tabLong">{t('sheet.tabMap')}</span>
          <span className="tabShort">{t('sheet.tabMapShort')}</span>
        </button>
        <button type="button" className={!isMap ? 'on' : undefined} onClick={() => p.onView('3d')}>
          <span className="tabLong">{t('sheet.tab3d')}</span>
          <span className="tabShort">{t('sheet.tab3dShort')}</span>
        </button>
      </div>
    </div>
  );
}
