/**
 * The build's version, stamped by next.config.ts from git at build time.
 *
 * Both are empty strings when nothing was stamped — vitest, or a build with
 * neither git nor a host-provided SHA — so a caller checks before displaying.
 */

/** Short commit SHA, e.g. "5e285d0". */
export const COMMIT = process.env.NEXT_PUBLIC_COMMIT ?? '';

/** That commit's date, ISO 8601. */
export const COMMIT_DATE = process.env.NEXT_PUBLIC_COMMIT_DATE ?? '';
