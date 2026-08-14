'use client';

import { rectSize } from '@/lib/geo/rect';
import { useT } from '@/lib/i18n/context';
import type { IfcStats, SiteRect } from '@/lib/types';

export type SiteReadoutProps = {
  rect: SiteRect | null;
  buildings: number | null;
  stats: IfcStats | null;
  originLabel: string | null;
};

/**
 * What the model *is*, in the corner it can be read from without being in the
 * way.
 *
 * This was the middle of the status bar, which meant a full-width strip had to
 * exist at every moment for the sake of five numbers that change perhaps twice
 * in a session. Split out by lifetime: these facts are true for as long as the
 * model is, so they sit still and stay; what just happened is momentary and goes
 * to the toast above the bar instead.
 *
 * Not a `.floating` panel — it is text, over whichever viewer is up. It carries
 * no pointer events (see .siteReadout in globals.css): a corner of the map that
 * cannot be dragged because a number is lying on it would be a worse trade than
 * the number.
 */
export function SiteReadout(p: SiteReadoutProps) {
  const { t, n } = useT();

  const m = p.rect ? rectSize(p.rect) : null;

  const fileSize = (): string | null => {
    if (!p.stats) return null;
    const kb = p.stats.bytes / 1024;
    return kb > 1024
      ? `${n(Math.round((kb / 1024) * 10) / 10)} ${t('unit.mb')}`
      : `${n(Math.round(kb))} ${t('unit.kb')}`;
  };

  // Each cell renders only when its datum exists, so the stack grows a line at a
  // time as the model does rather than standing there full of em dashes.
  const cell = (label: string, value: string) => (
    <span key={label}>
      <b>{value}</b>
      <span className="eyebrow">{label}</span>
    </span>
  );

  const size = fileSize();

  // Nothing to say before a site is drawn, and an empty line would still take
  // the row's height off the map.
  if (!m && p.buildings === null && !p.stats && !p.originLabel) return null;

  return (
    <div className="siteReadout">
      {m && cell(t('bar.site'), `${n(Math.round(m.w))} × ${n(Math.round(m.h))} m`)}
      {p.buildings !== null && cell(t('read.buildings'), n(p.buildings))}
      {p.stats && cell(t('read.entities'), n(p.stats.entities))}
      {size && cell(t('read.file'), size)}
      {p.originLabel && (
        // The one cell long enough to need cutting; the whole of it is on the
        // title, since it is the number you would copy out.
        <span className="origin" title={p.originLabel}>
          <b>{p.originLabel}</b>
          <span className="eyebrow">{t('bar.origin')}</span>
        </span>
      )}
    </div>
  );
}
