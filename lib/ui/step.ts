import type { SiteRect } from '@/lib/types';

/**
 * Where the sequence has got to: nothing drawn yet, a rectangle waiting to be
 * built, a build running, or a scene that matches its rectangle.
 *
 * Derived from state that already exists; nothing new is stored. It lives here
 * rather than in the status bar because the bar and the toast both branch on it
 * and they have to agree — the bar shows Rebuild in the same step the toast
 * calls the scene stale, and two copies of this ladder would eventually not.
 */
export type Step = 'draw' | 'sited' | 'busy' | 'ready';

export function buildStep(p: {
  busy: boolean;
  hasScene: boolean;
  siteDirty: boolean;
  rect: SiteRect | null;
}): Step {
  return p.busy
    ? 'busy'
    : p.hasScene && !p.siteDirty
      ? 'ready'
      : p.rect
        ? 'sited'
        : 'draw';
}
