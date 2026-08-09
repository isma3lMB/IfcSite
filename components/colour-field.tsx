'use client';

import { useEffect, useRef } from 'react';

/**
 * The colour swatch.
 *
 * React maps onChange on an <input type="color"> to the DOM `input` event, which
 * fires continuously while the picker is open. The undo boundary is the native
 * `change` event, which React does not surface — so it is bound directly, the
 * way the original's onchange handler was. Committing on blur instead would
 * miss a picker dismissed without moving focus.
 *
 * Its own module because the element editor and the model tree both need it, and
 * that live/commit split is exactly the part that would go wrong if the second
 * one were written again from scratch.
 */
export function ColourField({
  id,
  value,
  ariaLabel,
  className = 'colorInput',
  onColor,
}: {
  id?: string;
  value: number;
  ariaLabel?: string;
  className?: string;
  onColor: (hex: number, commit: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const latest = useRef(onColor);
  latest.current = onColor;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const commit = () => latest.current(parseInt(el.value.slice(1), 16), true);
    el.addEventListener('change', commit);
    return () => el.removeEventListener('change', commit);
  }, []);

  return (
    <input
      id={id}
      ref={ref}
      type="color"
      className={className}
      aria-label={ariaLabel}
      value={'#' + value.toString(16).padStart(6, '0')}
      onChange={(e) => onColor(parseInt(e.target.value.slice(1), 16), false)}
    />
  );
}
