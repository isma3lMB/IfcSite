import { useEffect } from 'react';

/**
 * The browser's own "leave site?" dialog, for work that exists nowhere else.
 *
 * A built site is an Overpass fetch, a terrain lattice and however many drawn
 * footprints and gizmo drags on top, and all of it lives in memory only. Saving
 * a draft is opt-in, so a refresh or a closed tab throws the lot away without
 * asking. This is the only place that can ask: the page is a static export with
 * one route, so there is no client-side navigation to intercept — `beforeunload`
 * is the whole surface.
 *
 * Two things about the dialog are the browser's and not ours:
 *
 * - Its wording is fixed and generic. Every engine has ignored the returned
 *   string for a decade, so there is nothing here to put through `lib/i18n` —
 *   the browser writes it in the user's own language regardless of ours.
 * - It only appears once the page has been interacted with. That is never a
 *   problem here: `armed` follows a scene, and there is no scene without a
 *   rectangle someone drew.
 *
 * `unsaved` is read at unload time rather than passed as a boolean, so the
 * answer can live in a ref and cost nothing to keep current — the caller has no
 * reason to re-render over a question only ever asked while the page is being
 * torn down. `armed` is the boolean, so nothing is bound at all until there is
 * something to lose; that also keeps the listener — and the bfcache eviction it
 * can cause — off the page in its opening state.
 */
export function useUnloadGuard(armed: boolean, unsaved: () => boolean): void {
  useEffect(() => {
    if (!armed) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!unsaved()) return;
      // preventDefault is what current browsers act on; returnValue is the
      // older path, still required by some. Both, or the dialog is a coin toss.
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [armed, unsaved]);
}
