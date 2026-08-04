'use client';

import { useId } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { type Lang, useT } from '@/lib/i18n/context';

/* Flags are drawn inline rather than written as emoji: Chrome and Edge on
   Windows render regional-indicator pairs as bare letter boxes ("FR"), so the
   emoji version is broken for a large share of visitors. */

function FlagFR({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 60 40" className={className} aria-hidden="true" focusable="false">
      <rect width="60" height="40" fill="#fff" />
      <rect width="20" height="40" fill="#002654" />
      <rect x="40" width="20" height="40" fill="#ce1126" />
    </svg>
  );
}

function FlagGB({ className }: { className?: string }) {
  // useId keeps the clip path unique — the trigger and the open list both
  // render this flag, and a hard-coded id would collide in the document.
  const clip = useId();
  return (
    <svg viewBox="0 0 60 40" className={className} aria-hidden="true" focusable="false">
      <clipPath id={clip}>
        <path d="M30,20 h30 v20 z v20 h-30 z h-30 v-20 z v-20 h30 z" />
      </clipPath>
      <rect width="60" height="40" fill="#012169" />
      <path d="M0,0 L60,40 M60,0 L0,40" stroke="#fff" strokeWidth="8" />
      <path d="M0,0 L60,40 M60,0 L0,40" stroke="#c8102e" strokeWidth="5" clipPath={`url(#${clip})`} />
      <path d="M30,0 v40 M0,20 h60" stroke="#fff" strokeWidth="13" />
      <path d="M30,0 v40 M0,20 h60" stroke="#c8102e" strokeWidth="8" />
    </svg>
  );
}

const LANGS: { lang: Lang; Flag: typeof FlagFR; name: string }[] = [
  // Endonyms, deliberately untranslated: a language is listed in its own
  // language so it stays findable when you cannot read the active one.
  { lang: 'fr', Flag: FlagFR, name: 'Français' },
  { lang: 'en', Flag: FlagGB, name: 'English' },
];

/* The shadcn defaults are overridden through className rather than from
   globals.css, because those defaults are Tailwind utilities and would outrank
   a plain component-layer rule. cn() is tailwind-merge, so passing the same
   utility group here drops the default instead of stacking on it. */
const TRIGGER =
  'langTrigger rounded-full border-ink bg-white pr-2 pl-2.5 text-[11px] font-mono tracking-[0.04em] uppercase ' +
  'transition-colors hover:bg-ink hover:text-yellow data-[popup-open]:bg-ink data-[popup-open]:text-yellow';

const MENU = 'langMenu w-auto min-w-[152px] border border-ink bg-white p-0 ring-0 shadow-[0_3px_14px_rgba(15,17,18,0.22)]';

const ITEM =
  'langItem gap-2.5 py-2 pr-7 pl-2.5 text-xs font-mono cursor-pointer ' +
  'hover:bg-yellow hover:text-ink focus:bg-yellow focus:text-ink';

export function LangToggle() {
  const { lang, setLang, t } = useT();
  const { Flag: CurrentFlag } = LANGS.find((l) => l.lang === lang) ?? LANGS[0];

  return (
    <Select value={lang} onValueChange={(v) => setLang(v as Lang)}>
      <SelectTrigger className={TRIGGER} aria-label={t('app.langLabel')}>
        <SelectValue>
          <CurrentFlag className="langFlag" />
          <span>{lang}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent className={MENU} align="end" alignItemWithTrigger={false}>
        {LANGS.map(({ lang: l, Flag, name }) => (
          <SelectItem key={l} value={l} className={ITEM}>
            <Flag className="langFlag" />
            <span>{name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
