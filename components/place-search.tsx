'use client';

import { type RefObject, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/context';
import { type Place, searchPlaces } from '@/lib/sources/nominatim';

export type PlaceSearchProps = {
  onPickPlace: (p: Place) => void;
  onSearchFailed: (error: unknown) => void;
  /** So the options flyout can put the caret here when it opens. */
  inputRef?: RefObject<HTMLInputElement | null>;
};

export function PlaceSearch({ onPickPlace, onSearchFailed, inputRef }: PlaceSearchProps) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against an earlier, slower request overwriting a later one.
  const seq = useRef(0);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const run = async (query: string) => {
    const mine = ++seq.current;
    try {
      const list = await searchPlaces(query);
      if (mine !== seq.current) return;
      setResults(list);
      setOpen(list.length > 0);
    } catch (e) {
      // Search is a convenience; drawing by hand must keep working regardless.
      if (mine === seq.current) onSearchFailed(e);
    }
  };

  const onChange = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    const query = v.trim();
    if (query.length < 3) {
      seq.current++;
      setOpen(false);
      return;
    }
    timer.current = setTimeout(() => run(query), 500); // Nominatim asks for restraint
  };

  return (
    <div className="field searchWrap" ref={wrapRef}>
      {/* <label className="eyebrow block mb-1.5" htmlFor="placeSearch">
        {t('ctl.findPlace')}
      </label> */}
      <input
        id="placeSearch"
        ref={inputRef}
        type="text"
        className="ctl-input"
        placeholder={t('ctl.findPlacePlaceholder')}
        autoComplete="off"
        spellCheck={false}
        value={q}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
          else if (e.key === 'Enter') {
            e.preventDefault();
            if (timer.current) clearTimeout(timer.current);
            const query = q.trim();
            if (query.length >= 2) run(query);
          }
        }}
      />
      {open && (
        <div className="searchResults">
          {results.map((r, i) => (
            <button
              key={`${r.lat},${r.lon},${i}`}
              type="button"
              onClick={() => {
                setOpen(false);
                onPickPlace(r);
              }}
            >
              {r.display_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
