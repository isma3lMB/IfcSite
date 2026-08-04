import type { ErrorCode, Params } from '@/lib/i18n/keys';

/**
 * A failure the user is meant to read. Carries a translation key rather than a
 * sentence, because the data layer has no idea what language the page is in.
 *
 * `message` is still populated with the code so that an AppError escaping into
 * a console or a stack trace is legible during development.
 */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly params?: Params,
  ) {
    super(code);
    this.name = 'AppError';
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
