import { describe, expect, it } from 'vitest';
import { buildStep } from '@/lib/ui/step';
import type { SiteRect } from '@/lib/types';

const RECT: SiteRect = { minLat: 48.85, maxLat: 48.86, minLon: 2.34, maxLon: 2.35 };

/**
 * The ladder the status bar and the toast both branch on. They have to agree —
 * the bar shows Rebuild in the same step the toast calls the scene stale — so
 * what is pinned here is the precedence between the branches, not just the four
 * outputs.
 */
describe('buildStep', () => {
  it('is draw with nothing drawn', () => {
    expect(buildStep({ busy: false, hasScene: false, siteDirty: false, rect: null })).toBe('draw');
  });

  it('is sited once a rectangle exists but no scene does', () => {
    expect(buildStep({ busy: false, hasScene: false, siteDirty: false, rect: RECT })).toBe('sited');
  });

  it('is ready when the scene matches its rectangle', () => {
    expect(buildStep({ busy: false, hasScene: true, siteDirty: false, rect: RECT })).toBe(
      'ready',
    );
  });

  it('falls back to sited when the scene is stale', () => {
    expect(buildStep({ busy: false, hasScene: true, siteDirty: true, rect: RECT })).toBe('sited');
  });

  it('is busy whatever else is true', () => {
    expect(buildStep({ busy: true, hasScene: true, siteDirty: false, rect: RECT })).toBe('busy');
    expect(buildStep({ busy: true, hasScene: false, siteDirty: true, rect: null })).toBe('busy');
  });

  /** A scene with no rectangle cannot happen through the UI, but the ladder is
   *  read by two surfaces and must not fall through to a fifth answer. */
  it('is draw for a stale scene with no rectangle', () => {
    expect(buildStep({ busy: false, hasScene: true, siteDirty: true, rect: null })).toBe('draw');
  });
});
