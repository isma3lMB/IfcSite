'use client';

import { Fragment } from 'react';
import { useT } from '@/lib/i18n/context';

/**
 * Note bodies mark code spans with backticks, so the prose stays a plain string
 * in the dictionary — one file per language, and no dangerouslySetInnerHTML.
 */
function withCode(body: string) {
  return body.split('`').map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className="inline-code">
        {part}
      </code>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

export function Notes() {
  const { notes } = useT();
  return (
    <div className="notes">
      {notes.map((n) => (
        <p key={n.title}>
          <strong>{n.title}</strong> {withCode(n.body)}
        </p>
      ))}
    </div>
  );
}
