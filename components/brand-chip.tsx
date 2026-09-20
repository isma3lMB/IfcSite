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
 * The wordmark is split on the same two i18n keys the display lockup in the
 * info overlay uses, so the plated half is the same word in both and the two
 * cannot drift apart. There is no separate icon: the lockup is the mark.
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

  return (
    <div className="brandChip floating">
      <div className="wordmark">
        {t('app.h1a')} <span>{t('app.h1b')}</span>
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
