'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * The phone breakpoint, in JS.
 *
 * Layout belongs in CSS and nearly all of it is there — see the phone tier at
 * the foot of app/globals.css, which is where this number is really decided.
 * What CSS cannot do is move a control from one parent to another, and that is
 * exactly what the phone tier needs: the utility cluster leaves the top-right
 * corner and joins the tool rail's dock at the foot of the window. A node has
 * to be rendered into one container or the other, so the breakpoint has to be
 * readable here too.
 *
 * Kept as a constant with the query derived from it so the two spellings cannot
 * drift, and cross-referenced from the media query in globals.css. If one moves,
 * both move.
 */
export const PHONE_MAX = 560;
export const PHONE_QUERY = `(max-width: ${PHONE_MAX}px)`;

/**
 * Whether a media query currently matches, as a re-rendering boolean.
 *
 * useSyncExternalStore rather than useState + an effect: matchMedia is exactly
 * the external mutable source it exists for, and it subscribes during the commit
 * that renders the value rather than one paint later.
 *
 * The server snapshot is always `false`. This page is prerendered at build time
 * with no `window` — the same constraint that keeps the theme and the tunables
 * out of their useState initialisers — so the first paint is unavoidably the
 * desktop arrangement, corrected on mount. Nothing here is load-bearing enough
 * to flash badly: the CSS tiers have already laid the window out by then, and
 * what these booleans move is which container a few buttons are rendered into.
 */
export function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
