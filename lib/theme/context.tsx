'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'ifcsite.theme';
export const DEFAULT_THEME: Theme = 'light';

export type ThemeCtx = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
};

const Ctx = createContext<ThemeCtx | null>(null);

const isTheme = (v: unknown): v is Theme => v === 'light' || v === 'dark';

/**
 * The resolution the pre-paint script in app/layout.tsx also performs. Both have
 * to agree or the first frame would carry one theme and the first render the
 * other; keeping the order here — stored override, then the default — is what
 * makes the script's `.dark` guess the same one React arrives at. The OS
 * preference deliberately does not enter into it: light is the app's default and
 * dark is something you opt into with the toggle.
 */
function resolve(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    // Storage disabled: fall through to the default.
  }
  return DEFAULT_THEME;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Resolved in an effect, not in a useState initialiser, for the same reason as
  // LangProvider: this page is prerendered at build time with no `window`, so
  // reading localStorage during render would be a hydration mismatch. The class
  // is already on <html> by then — the script in layout.tsx put it there before
  // paint — so this only brings React's copy of the state into line.
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    setThemeState(resolve());
  }, []);

  // The single writer of the class every `dark:` utility and the html.dark token
  // block key off. Nothing else in the app touches classList on documentElement.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      window.localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // Private mode with storage disabled: the toggle still works for this
      // session, it just will not be remembered.
    }
  }, []);

  const value = useMemo<ThemeCtx>(
    () => ({
      theme,
      setTheme,
      toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    }),
    [theme, setTheme],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme must be used inside <ThemeProvider>');
  return v;
}
