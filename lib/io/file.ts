import { AppError } from '@/lib/errors';

/**
 * Hand a string to the browser as a download.
 *
 * Lifted out of the IFC download handler once a second caller appeared: the
 * draft export writes JSON where that writes STEP, and the only thing they
 * disagree about is the media type. The revoke is deferred rather than immediate
 * because Safari reads the blob after the click returns and a synchronous revoke
 * hands it a dead URL.
 */
export function downloadText(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * A picked file's text.
 *
 * File.text() is the whole implementation; the wrapper exists to fold the
 * browser's own read failures — a file deleted between the picker and the read,
 * a directory dropped instead of a file — into the one error type the status
 * line knows how to translate. Everything past this point is lib/io/draft's
 * problem, so a file that reads fine but says nothing is *not* rejected here.
 */
export async function readDraftFile(f: File): Promise<string> {
  try {
    return await f.text();
  } catch {
    throw new AppError('err.draftUnreadable');
  }
}

/** Illegal in a Windows filename, and legal on the two Unixes — so the narrower
 *  rule is the one that travels. Written as codepoints rather than as a regex
 *  class because the set includes the quote and the backslash. */
const ILLEGAL = new Set('<>:"/\\|?*'.split(''));

/**
 * A filename stem safe on every platform, from whatever the user typed.
 *
 * A name that reduces to nothing falls back rather than producing a dotfile.
 */
export const safeFileStem = (name: string, fallback: string): string => {
  const cleaned = Array.from(name)
    .map((ch) => (ILLEGAL.has(ch) || ch < ' ' ? '-' : ch))
    .join('')
    // A leading dot makes a hidden file on the Unixes and a trailing one is
    // silently eaten on Windows; neither is what anyone typed.
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .slice(0, 80)
    .trim();
  return cleaned || fallback;
};
