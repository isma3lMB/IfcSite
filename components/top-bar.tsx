'use client';

import { LangToggle } from '@/components/lang-toggle';
import { useT } from '@/lib/i18n/context';
import type { IfcStats, ViewTab } from '@/lib/types';

export type TopBarProps = {
  view: ViewTab;
  onView: (v: ViewTab) => void;
  originLabel: string | null;
  buildings: number | null;
  taggedPct: number | null;
  stats: IfcStats | null;
  showOrigin: boolean;
  onShowOrigin: (v: boolean) => void;
  infoOpen: boolean;
  onInfo: () => void;
};

/**
 * The window is the viewer, so the masthead is a strip that floats over it: the
 * wordmark, the two view tabs, the projected origin of the current build, and
 * the two things that are always available — language, and the notes that used
 * to sit under the page as a footer.
 */
export function TopBar(p: TopBarProps) {
  const { t, n } = useT();
  const isMap = p.view === 'map';

  const fileSize = (): string | null => {
    if (!p.stats) return null;
    const kb = p.stats.bytes / 1024;
    return kb > 1024
      ? `${n(Math.round((kb / 1024) * 10) / 10)} ${t('unit.mb')}`
      : `${n(Math.round(kb))} ${t('unit.kb')}`;
  };

  // What the model *is* reads here; what to do next reads in the flow bar. A
  // zero stays dimmed, as in the sheet readout this strip replaces.
  const cell = (label: string, value: string | null, dim = false) => (
    <span key={label}>
      <b className={value === null || dim ? 'muted' : undefined}>{value ?? '—'}</b>
      <span className="eyebrow">{label}</span>
    </span>
  );

  return (
    <div className="topbar floating">
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

      <span className="eyebrow mono origin">{p.originLabel ?? t('sheet.origin')}</span>

      {p.stats && (
        <div className="readout">
          {cell(t('read.buildings'), p.buildings === null ? null : n(p.buildings))}
          {cell(
            t('read.tagged'),
            p.taggedPct === null ? null : t('unit.percent', { v: n(p.taggedPct) }),
          )}
          {cell(t('read.roadFaces'), n(p.stats.roadFaces), p.stats.roadFaces === 0)}
          {cell(t('read.trees'), n(p.stats.trees), p.stats.trees === 0)}
          {cell(t('read.layers'), n(p.stats.layers), p.stats.layers === 0)}
          {cell(t('read.entities'), n(p.stats.entities))}
          {cell(t('read.file'), fileSize())}
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        {/* Sits next to the origin readout it controls, and only means anything
            with the 3D view up. */}
        {!isMap && (
          <button
            type="button"
            className={`iconBtn${p.showOrigin ? ' on' : ''}`}
            title={t('ui.originMarker')}
            aria-label={t('ui.originMarker')}
            aria-pressed={p.showOrigin}
            onClick={() => p.onShowOrigin(!p.showOrigin)}
          >
            {/* Drawn rather than typed: the crosshair codepoints have no glyph
                in the mono stack and fall back to a blank box. */}
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <circle cx="7" cy="7" r="3" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <path
                d="M7 0v3M7 11v3M0 7h3M11 7h3"
                stroke="currentColor"
                strokeWidth="1.3"
                fill="none"
              />
            </svg>
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
    </div>
  );
}
