'use client';

import { useT } from '@/lib/i18n/context';
import { rectCentre, rectSize } from '@/lib/geo/rect';
import type { SiteRect } from '@/lib/types';

export type SiteExtentProps = {
  rect: SiteRect | null;
};

/**
 * The rectangle's numbers. Drawing, zooming and rebuilding all moved to the
 * flow bar — the dock holds settings, not the sequence.
 */
export function SiteExtent({ rect }: SiteExtentProps) {
  const { t, n } = useT();
  const m = rect ? rectSize(rect) : null;
  const c = rect ? rectCentre(rect) : null;

  return (
    <div className="field">
      <span className="eyebrow block mb-1.5">{t('ctl.siteExtent')}</span>
      <div className={`siteBox${rect ? '' : ' empty'}`}>
        <span className="eyebrow">{t('ctl.rectangle')}</span>
        <b>{m ? `${n(Math.round(m.w))} × ${n(Math.round(m.h))} m` : '—'}</b>
        <div className="co">
          {c && m
            ? `${c.lat.toFixed(4)}, ${c.lon.toFixed(4)} · ${((m.w * m.h) / 1e6).toFixed(2)} km²`
            : t('ctl.drawOnMap')}
        </div>
      </div>
      <div className="fieldHint">{t('ctl.siteHint')}</div>
    </div>
  );
}
