'use client';

import { Notes } from '@/components/notes';
import { useT } from '@/lib/i18n/context';
import { DATA_SOURCES, type SourceLicence } from '@/lib/sources/licence';

export type InfoOverlayProps = {
  open: boolean;
  onClose: () => void;
};

/** Not a dictionary key: it is the one string on this surface that is the same
 *  in every language. */
const REPO_URL = 'https://github.com/isma3lMB/IfcSite';

/**
 * The credits, in the order the pipeline uses them.
 *
 * DATA_SOURCES covers what reaches the IFC. Nominatim never does — it answers
 * the place search and nothing it returns is written to the file — but ODbL
 * asks a work that *displays* OSM data to credit it, and a searched-for place
 * name is displayed data, so it is credited here and not there. The basemap
 * tiles are attributed by Leaflet itself, in the corner of the map.
 */
const CREDITS: SourceLicence[] = [
  DATA_SOURCES.osm,
  DATA_SOURCES.terrarium,
  DATA_SOURCES.bdtopo,
  DATA_SOURCES.rgealti,
  DATA_SOURCES.pci,
  {
    source: 'Nominatim',
    licence: 'ODbL 1.0',
    url: 'https://www.openstreetmap.org/copyright',
    attribution: '© OpenStreetMap contributors.',
  },
];

/**
 * What used to be the page header and the footer notes. Full-bleed viewers left
 * no room for prose, and none of it is needed to draw a rectangle — so it waits
 * behind the (i) button instead of taking a third of the window forever.
 */
export function InfoOverlay({ open, onClose }: InfoOverlayProps) {
  const { t } = useT();
  if (!open) return null;

  return (
    // The backdrop closes on click; the card stops the click travelling so
    // selecting text inside it does not dismiss the panel.
    <div className="infoOverlay" onClick={onClose} role="presentation">
      <div
        className="infoCard floating"
        role="dialog"
        aria-modal="true"
        aria-label={t('ui.info')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="infoHead">
          <div>
            <div className="tag">{t('app.tag')}</div>
            <h1 className="h1">
              {t('app.h1a')} <span>{t('app.h1b')}</span>
            </h1>
            <p className="sub">{t('app.sub')}</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="eyebrow text-right whitespace-pre-line">{t('app.badge')}</div>
            <button
              type="button"
              className="iconBtn"
              title={t('ui.close')}
              aria-label={t('ui.close')}
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>

        {/* The head stays outside the scroller so the close button is always
            reachable — and so the h1's dashed border is not clipped by an
            overflow ancestor. Only the prose below scrolls. */}
        <div className="infoBody">
          <Notes />
          <div className="credits">
            <h2>{t('info.credits')}</h2>
            <p>{t('info.creditsLead')}</p>
            <ul>
              {CREDITS.map((c) => (
                <li key={c.source}>
                  <a href={c.url} target="_blank" rel="noopener noreferrer">
                    {c.source}
                  </a>
                  <span> — {c.licence}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="infoFoot">
            <p>{t('info.openSource')}</p>
            <a
              className="btn-ghost"
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('info.github')}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
