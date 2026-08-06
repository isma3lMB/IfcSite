'use client';

import type { RefObject } from 'react';
import { PlaceSearch } from '@/components/place-search';
import { useT } from '@/lib/i18n/context';
import type { Place } from '@/lib/sources/nominatim';

export type SearchFlyoutProps = {
  inputRef?: RefObject<HTMLInputElement | null>;
  onPickPlace: (p: Place) => void;
  onSearchFailed: (error: unknown) => void;
  onClose: () => void;
};

/**
 * The place search, off its own rail button rather than folded into Options —
 * finding a place is the first thing you do, before there is anything to
 * configure. It opens on arrival while no site rectangle exists yet (see the
 * effect in ifc-site.tsx) and collapses to an icon the moment one does, same
 * as every other rail item.
 */
export function SearchFlyout(p: SearchFlyoutProps) {
  const { t } = useT();
  return (
    <div className="flyout floating searchFlyout" id="searchFlyout" aria-label={t('ctl.findPlace')}>
      <div className="dockHead">
        <span className="eyebrow">{t('ctl.findPlace')}</span>
        <button
          type="button"
          className="iconBtn"
          title={t('ui.close')}
          aria-label={t('ui.close')}
          onClick={p.onClose}
        >
          ✕
        </button>
      </div>

      <PlaceSearch inputRef={p.inputRef} onPickPlace={p.onPickPlace} onSearchFailed={p.onSearchFailed} />
    </div>
  );
}
