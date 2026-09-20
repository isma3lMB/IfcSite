'use client';

import { type RefObject, useCallback, useEffect, useState } from 'react';

/** Whether there is more content past each end of a horizontal scroller. */
export type ScrollEdges = { start: boolean; end: boolean };

/**
 * What a scroller cannot say for itself.
 *
 * A strip that scrolls sideways with no scrollbar — which is what the tool rail
 * becomes on a phone, deliberately — looks exactly like a strip that does not
 * scroll at all. The only honest signal is the content beyond each end, and the
 * element knows where that is; nothing but this reads it out.
 *
 * Three things move the answer and all three are watched: the scroll position,
 * the element's own box (rotating a phone), and its children — the rail's
 * contents change with the view and with what is selected, which changes how
 * far it scrolls without its box moving at all, so a ResizeObserver alone would
 * go stale on every tab switch.
 *
 * State is only written when a boolean actually flips, so a scroll through the
 * middle of a long strip costs one comparison a frame and no renders.
 */
export function useScrollEdges(ref: RefObject<HTMLElement | null>): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ start: false, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // A pixel of slack at each end. scrollLeft is fractional wherever the device
    // pixel ratio is not a whole number, so neither end is ever exactly 0 or
    // exactly scrollWidth - clientWidth, and an arrow that refuses to go out at
    // the very end of a swipe is worse than no arrow.
    const max = el.scrollWidth - el.clientWidth;
    const next = { start: el.scrollLeft > 1, end: el.scrollLeft < max - 1 };
    setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    // Passive: this only reads, and a non-passive scroll listener on a strip
    // being flicked by a thumb is the classic way to make one feel heavy.
    el.addEventListener('scroll', measure, { passive: true });
    const box = new ResizeObserver(measure);
    box.observe(el);
    const contents = new MutationObserver(measure);
    contents.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener('scroll', measure);
      box.disconnect();
      contents.disconnect();
    };
  }, [measure, ref]);

  return edges;
}
