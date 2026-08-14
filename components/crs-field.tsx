'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import { candidatesAt, loadEpsgIndex, type CrsRecord } from '@/lib/geo/epsg';
import { rectCentre } from '@/lib/geo/rect';
import { useT } from '@/lib/i18n/context';
import type { SiteRect } from '@/lib/types';

/** What the list holds. `value`/`label` are the shape the combobox reads
 *  automatically; `area` rides along for the second line of the row. */
type Item = { value: string; label: string; area: string };

const AUTO = 'auto';

/**
 * The projected CRS, as the systems that are valid where the site actually is.
 *
 * It carries its own data loading rather than sitting in the options dock,
 * because the list is a function of the rectangle and the rectangle is drawn
 * on the other side of the app.
 *
 * Nothing is offered before the rectangle exists. A CRS list is meaningless
 * without a place to evaluate it at, and a choice made before there is a site is
 * a choice the first drawn rectangle invalidates.
 */
export function CrsField(p: {
  rect: SiteRect | null;
  value: string;
  disabled?: boolean;
  onChange: (epsg: string) => void;
}) {
  const { t, n } = useT();
  const [index, setIndex] = useState<CrsRecord[] | null>(null);
  const [failed, setFailed] = useState(false);

  // Fetching starts with the first rectangle, not on mount: 1.2 MB is not worth
  // spending on a session that never gets as far as drawing one.
  useEffect(() => {
    if (!p.rect || index || failed) return;
    let live = true;
    loadEpsgIndex().then(
      (list) => live && setIndex(list),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [p.rect, index, failed]);

  const items = useMemo<Item[]>(() => {
    const auto: Item = { value: AUTO, label: t('ctl.crsAuto'), area: '' };
    if (!p.rect || !index) return [auto];
    const { lat, lon } = rectCentre(p.rect);
    return [
      auto,
      // Names and areas of use are published proper nouns and stay in the form
      // EPSG gives them, like the datum names beside them in the header.
      ...candidatesAt(index, lat, lon).map((r) => ({
        value: String(r.c),
        label: `EPSG:${r.c} — ${r.n}`,
        area: r.a,
      })),
    ];
  }, [p.rect, index, t]);

  const selected = useMemo(
    () => items.find((i) => i.value === p.value) ?? null,
    [items, p.value],
  );

  const hint = !p.rect
    ? t('ctl.crsNeedsSite')
    : failed
      ? t('ctl.crsError')
      : !index
        ? t('ctl.crsLoading')
        : t('ctl.crsValidHere', { n: n(items.length - 1) });

  return (
    <div className="field">
      <label className="eyebrow block mb-1.5" htmlFor="epsg">
        {t('ctl.crs')}
      </label>
      <Combobox
        items={items}
        value={selected}
        disabled={p.disabled || !p.rect}
        // The items are rebuilt whenever the rectangle moves, so the selected
        // one is a different object each time and Object.is would drop it.
        isItemEqualToValue={(a: Item, b: Item) => a.value === b.value}
        onValueChange={(item: Item | null) => item && p.onChange(item.value)}
      >
        <ComboboxInput id="epsg" placeholder={t('ctl.crsSearch')} />
        <ComboboxContent className="max-w-[min(92vw,26rem)]">
          <ComboboxEmpty>{t('ctl.crsNone')}</ComboboxEmpty>
          <ComboboxList>
            {(item: Item) => (
              <ComboboxItem key={item.value} value={item}>
                <span className="font-mono text-[13px] whitespace-normal">{item.label}</span>
                {item.area && (
                  <span className="text-[11px] leading-tight text-muted-foreground whitespace-normal">
                    {item.area}
                  </span>
                )}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <div className="fieldHint">{hint}</div>
    </div>
  );
}
