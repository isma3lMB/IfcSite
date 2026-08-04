'use client';

import { Notes } from '@/components/notes';
import { useT } from '@/lib/i18n/context';

export type InfoOverlayProps = {
  open: boolean;
  onClose: () => void;
};

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

        <Notes />
      </div>
    </div>
  );
}
