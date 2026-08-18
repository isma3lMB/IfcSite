/**
 * One frame's grace, for the messages that precede synchronous work.
 *
 * Setting a status and then immediately locking the main thread — parsing a few
 * thousand buildings, unioning road ribbons, serialising the IFC, constructing
 * every mesh — means the line is never seen. React renders it, but the browser
 * cannot paint until the task yields, and by then the work is over and the next
 * message has replaced it. rAF alone puts us at the top of the next frame,
 * still before the paint; the nested timeout is what lands us after it.
 */
export const paint = (): Promise<void> =>
  new Promise((r) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(r, 0));
    } else {
      // No document to paint into — a test or a server render. Yield anyway so
      // the shape of the call is the same on both sides.
      setTimeout(r, 0);
    }
  });
