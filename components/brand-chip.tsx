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
 */
export function BrandChip(p: BrandChipProps) {
  const { t } = useT();
  const isMap = p.view === 'map';

  return (
    <div className="brandChip floating">
      <div className="mark" />
      <div className="wordmark">{t('app.wordmark')}</div>

      <div className="sep" />

      <div className="viewtabs">
        <button type="button" className={isMap ? 'on' : undefined} onClick={() => p.onView('map')}>
          {t('sheet.tabMap')}
        </button>
        <button type="button" className={!isMap ? 'on' : undefined} onClick={() => p.onView('3d')}>
          {t('sheet.tab3d')}
        </button>
      </div>
    </div>
  );
}
