'use client';

import { useT } from '@/lib/i18n/context';
import type { Dict } from '@/lib/i18n/en';
import type { Params } from '@/lib/i18n/keys';
import type { BuildSummary } from '@/lib/types';

type StringKey = Exclude<keyof Dict, 'notes'>;

/**
 * The status is held as a key plus params, never as a formatted string —
 * otherwise flipping the language would leave a stale sentence on screen.
 */
export type StatusState =
  /**
   * `cause` is resolved into a `{detail}` param at render time rather than
   * being formatted when the failure happened — that way a message already on
   * screen still follows the language toggle.
   */
  | { kind: 'msg'; key: StringKey; params?: Params; tone?: 'err' | 'ok'; cause?: unknown }
  | { kind: 'summary'; summary: BuildSummary }
  | { kind: 'error'; error: unknown };

/** Proper nouns — deliberately not translated. */
const PROVIDER_NAME = { osm: 'OpenStreetMap', ign: 'IGN BD TOPO' } as const;

export function StatusLine({
  status,
  variant,
}: {
  status: StatusState;
  /** 'bar' renders it as one inline line inside the status bar, clamped. */
  variant?: 'bar';
}) {
  const { t, n, errorText } = useT();

  /* The three kinds converge on one return rather than each building their own
     JSX: the bar clamps this to two lines, so the full sentence has to be
     available for the title — and computing it three times over would be three
     places for that to be forgotten. */
  let text: string;
  let tone: 'err' | 'ok' | undefined;

  if (status.kind === 'error') {
    text = errorText(status.error);
    tone = 'err';
  } else if (status.kind === 'msg') {
    const params =
      status.cause === undefined
        ? status.params
        : { ...status.params, detail: errorText(status.cause) };
    text = t(status.key, params);
    tone = status.tone;
  } else {
    // The closing summary is six conditional clauses. It is composed here rather
    // than stored as one template so each language can order them naturally.
    const s = status.summary;
    const parts = [
      t('sum.built', {
        buildings: n(s.buildings),
        provider: PROVIDER_NAME[s.provider],
        tagged: n(s.tagged),
        kind: t(s.provider === 'ign' ? 'sum.kindSurveyed' : 'sum.kindTagged'),
        estimated: n(s.buildings - s.tagged),
        fallback: n(s.fallbackH),
      }),
    ];
    if (s.capped) parts.push(t('sum.capped', { cap: n(s.capAt) }));
    if (s.treesCapped) parts.push(t('sum.treesCapped', { cap: n(s.treeCap) }));
    if (s.reused) parts.push(t('sum.reused', { n: n(s.reused) }));
    if (s.skipped.length)
      parts.push(t('sum.skipped', { layers: s.skipped.map((k) => t(k)).join(', ') }));
    // No "click a building to edit it" tail: the build lands in the 3D view with
    // the element editor beside it, and the building under the cursor says it.

    text = parts.join(' ');
    tone = !s.capped && !s.skipped.length ? 'ok' : undefined;
  }

  // The bar keeps a fixed height, so a long summary is cut — the tail has to be
  // reachable somewhere, and the title is the only place that costs nothing.
  return (
    <div
      className={variant === 'bar' ? 'statusline statusline--bar' : 'statusline'}
      title={text}
    >
      {tone ? <span className={tone}>{text}</span> : text}
    </div>
  );
}
