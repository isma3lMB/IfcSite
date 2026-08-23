import { describe, expect, it } from 'vitest';
import { type Dict, en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * Key parity is already a compile error and is deliberately not re-tested here:
 * `Dict = typeof en` and fr.ts is declared `const fr: Dict`, so a key added to
 * one dictionary and forgotten in the other fails `npm run typecheck`.
 *
 * What the type system cannot see is the inside of the strings. A message whose
 * French translation drops a `{placeholder}` renders a sentence with a hole in
 * it — at runtime, in front of the user, with nothing red anywhere — and the
 * French dictionary is the one the app boots into. That is what this file is
 * for.
 */

const PLACEHOLDER = /\{(\w+)\}/g;

const placeholders = (s: string): string[] =>
  [...s.matchAll(PLACEHOLDER)].map((m) => m[1]).sort();

/** Every key holding a plain string — which is all of them except `notes`. */
const stringKeys = (Object.keys(en) as (keyof Dict)[]).filter(
  (k) => typeof en[k] === 'string',
) as Exclude<keyof Dict, 'notes'>[];

describe('the dictionaries', () => {
  it('agree on which keys hold prose rather than a string', () => {
    expect(typeof en.notes).toBe('object');
    expect(Array.isArray(fr.notes)).toBe(true);
    for (const k of stringKeys) expect(typeof fr[k]).toBe('string');
  });

  it('leave nothing untranslated as an empty string', () => {
    for (const k of stringKeys) {
      expect(en[k], `en.${k} is empty`).not.toBe('');
      expect(fr[k], `fr.${k} is empty`).not.toBe('');
    }
  });
});

describe('placeholder parity', () => {
  it('substitutes the same names in both languages', () => {
    const drifted: string[] = [];
    for (const k of stringKeys) {
      const a = placeholders(en[k] as string);
      const b = placeholders(fr[k]);
      if (a.join(',') !== b.join(',')) {
        drifted.push(`${k}: en {${a.join(', ')}} vs fr {${b.join(', ')}}`);
      }
    }
    expect(drifted).toEqual([]);
  });

  it('never repeats a placeholder in one language but not the other', () => {
    for (const k of stringKeys) {
      const a = placeholders(en[k] as string);
      const b = placeholders(fr[k]);
      expect(a.length, `${k} substitutes a different number of values`).toBe(b.length);
    }
  });

  /**
   * `t()` replaces `{name}` and leaves anything it does not recognise in place,
   * so a stray brace reaches the screen as a brace. A single unmatched one is
   * almost always a typo in a translation.
   */
  it('leaves no unbalanced brace in either language', () => {
    for (const k of stringKeys) {
      for (const [lang, s] of [
        ['en', en[k] as string],
        ['fr', fr[k]],
      ] as const) {
        const opens = (s.match(/\{/g) ?? []).length;
        const closes = (s.match(/\}/g) ?? []).length;
        expect(opens, `${lang}.${k} has an unbalanced brace`).toBe(closes);
        // Every brace that is opened is part of a well-formed placeholder.
        expect(placeholders(s).length, `${lang}.${k} has a malformed placeholder`).toBe(opens);
      }
    }
  });
});

describe('the notes prose', () => {
  it('has the same number of sections in both languages', () => {
    expect(fr.notes).toHaveLength(en.notes.length);
  });

  it('gives every section a title and a body in both languages', () => {
    for (const notes of [en.notes, fr.notes]) {
      for (const note of notes) {
        expect(note.title.trim()).not.toBe('');
        expect(note.body.trim()).not.toBe('');
      }
    }
  });

  /** `body` marks code spans with backticks, and an unclosed one swallows the
   *  rest of the paragraph into a code span when it renders. */
  it('closes every backtick code span', () => {
    for (const [lang, notes] of [
      ['en', en.notes],
      ['fr', fr.notes],
    ] as const) {
      notes.forEach((note, i) => {
        const ticks = (note.body.match(/`/g) ?? []).length;
        expect(ticks % 2, `${lang}.notes[${i}] leaves a code span open`).toBe(0);
      });
    }
  });
});
