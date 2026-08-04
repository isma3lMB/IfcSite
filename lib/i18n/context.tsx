'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { type Dict, en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';
import { AppError } from '@/lib/errors';
import type { Params } from '@/lib/i18n/keys';

export type Lang = 'fr' | 'en';

const DICTS: Record<Lang, Dict> = { fr, en: en as unknown as Dict };
const STORAGE_KEY = 'ifcsite.lang';
export const DEFAULT_LANG: Lang = 'fr';

type StringKey = Exclude<keyof Dict, 'notes'>;

export type T = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: StringKey, params?: Params) => string;
  /** The Notes prose for the active language. */
  notes: { title: string; body: string }[];
  /** Locale-aware number formatting: 1 234 in French, 1,234 in English. */
  n: (v: number) => string;
  /** Human-readable text for a thrown error, translated when it carries a code. */
  errorText: (e: unknown) => string;
};

const Ctx = createContext<T | null>(null);

const isLang = (v: unknown): v is Lang => v === 'fr' || v === 'en';

function interpolate(template: string, dict: Dict, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params[name];
    if (v === undefined) return whole;
    // A param whose value is itself a dictionary key is translated first. That
    // is what lets one message nest another — status.undone takes an edit.*
    // label, status.terrainUnavailable takes the err.* code that caused it.
    if (typeof v === 'string' && v in dict) {
      const nested = dict[v as StringKey];
      if (typeof nested === 'string') return nested;
    }
    return String(v);
  });
}

export function LangProvider({ children }: { children: React.ReactNode }) {
  // Resolved in an effect, not in a useState initialiser: this page is
  // prerendered at build time with no `window`, so reading localStorage during
  // render would be a hydration mismatch. First paint is therefore always the
  // default language.
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('lang');
    if (isLang(fromUrl)) return setLangState(fromUrl);
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLang(stored)) setLangState(stored);
  }, []);

  // The document title and lang attribute are rendered statically from the
  // default language at build time, so they are corrected here whenever the
  // active language changes — including on first mount.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = DICTS[lang]['app.title'] as string;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', DICTS[lang]['app.description'] as string);
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // Private mode with storage disabled: the toggle still works for this
      // session, it just will not be remembered.
    }
  }, []);

  const value = useMemo<T>(() => {
    const dict = DICTS[lang];
    const t = (key: StringKey, params?: Params): string => {
      const raw = dict[key];
      if (typeof raw !== 'string') return String(key);
      return interpolate(raw, dict, params);
    };
    const nf = new Intl.NumberFormat(lang);
    return {
      lang,
      setLang,
      t,
      notes: dict.notes,
      n: (v: number) => nf.format(v),
      errorText: (e: unknown) => {
        if (e instanceof AppError) return t(e.code as StringKey, e.params);
        if (e instanceof Error) return e.message;
        return String(e);
      },
    };
  }, [lang, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useT(): T {
  const v = useContext(Ctx);
  if (!v) throw new Error('useT must be used inside <LangProvider>');
  return v;
}
