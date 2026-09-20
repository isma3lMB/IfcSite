'use client';

import { IconBuyMeACoffee, IconGitHub } from '@/components/icons';
import { Notes } from '@/components/notes';
import { useT } from '@/lib/i18n/context';
import { DATA_SOURCES, type SourceLicence } from '@/lib/sources/licence';
import { COMMIT, COMMIT_DATE } from '@/lib/version';

export type InfoOverlayProps = {
  open: boolean;
  onClose: () => void;
};

/** Not dictionary keys: proper nouns and URLs, the same in every language. */
const REPO_URL = 'https://github.com/isma3lMB/IfcSite';
const AUTHOR_NAME = 'isma3lMB';
const AUTHOR_URL = 'https://www.bim-lane.blog/about';
const SUPPORT_URL = 'https://buymeacoffee.com/isma3lmb';

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
  const { t, lang } = useT();
  if (!open) return null;

  // Formatted here rather than at build time so it follows the language toggle.
  // No hydration concern: the overlay only renders after a click.
  const date = COMMIT_DATE
    ? new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(new Date(COMMIT_DATE))
    : '';

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
          <div className="infoTitle">
            <div className="tag">{t('app.tag')}</div>
            <h1 className="h1">
              {t('app.h1a')} <span>{t('app.h1b')}</span>
            </h1>
            <p className="sub">{t('app.sub')}</p>
          </div>
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
          <div className="credits">
            <h2>{t('info.disclaimerTitle')}</h2>
            <p>{t('info.disclaimer')}</p>
          </div>
        </div>

        {/* Outside the scroller, like the head: who made it, where the source
            is and which build this is stay in view however far the prose runs. */}
        <div className="infoFoot">
          {/* Grouped, so the footer keeps the two children its space-between
              expects: a third one would be pushed into the middle of the row. */}
          <div className="infoActions">
            <a className="btn-ghost" href={REPO_URL} target="_blank" rel="noopener noreferrer">
              <IconGitHub />
              {t('info.github')}
            </a>
            {/* Deliberately wordless: the mark is the label. Which means the
                link has no accessible name of its own — the svg is aria-hidden
                like every icon in the set — so it carries both the title for
                the pointer and the aria-label for everything else. */}
            <a
              className="iconBtn bmcBtn"
              href={SUPPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
              title={t('info.support')}
              aria-label={t('info.support')}
            >
              <IconBuyMeACoffee />
            </a>
          </div>
          <p className="infoMeta">
            <span>
              {t('info.madeBy')}{' '}
              <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer">
                {AUTHOR_NAME}
              </a>
            </span>
            {(COMMIT || date) && (
              <span>
                {t('info.version')}
                {COMMIT && (
                  <>
                    {' '}
                    <a
                      href={`${REPO_URL}/commit/${COMMIT}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {COMMIT}
                    </a>
                  </>
                )}
                {date && `${COMMIT ? ' ·' : ''} ${date}`}
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
