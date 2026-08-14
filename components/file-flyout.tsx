'use client';

import { useEffect, useRef, useState } from 'react';
import { IconExport, IconOpen, IconRename, IconSave, IconTrash } from '@/components/icons';
import { useT } from '@/lib/i18n/context';
import { slotsSupported } from '@/lib/io/slots';
import type { SlotMeta } from '@/lib/io/slots';

export type FileFlyoutProps = {
  hasScene: boolean;
  slots: SlotMeta[];
  /** The name the current document was last saved or opened under, so reopening
   *  the panel offers to save over itself rather than starting blank. */
  currentName: string | null;
  /** The fallback the name field shows when nothing has been saved yet. */
  suggestedName: string;
  onSave: (name: string) => void;
  onOpenSlot: (name: string) => void;
  onRenameSlot: (from: string, to: string) => void;
  onDeleteSlot: (name: string) => void;
  onOpenFile: (f: File) => void;
  onExportDraft: () => void;
  onClose: () => void;
};

/** Bytes as something a person can weigh a slot by. */
const size = (n: number): string =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} kB` : `${(n / 1048576).toFixed(1)} MB`;

/**
 * How long ago, coarsely.
 *
 * Intl.RelativeTimeFormat rather than a hand-rolled table because the panel is
 * bilingual and "il y a 2 jours" is not "2 days ago" with the words swapped. The
 * locale comes from the active language, not from the browser: the rest of the
 * page is already in whichever the user picked.
 */
const when = (ts: number, lang: string): string => {
  const s = Math.round((ts - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const a = Math.abs(s);
  if (a < 60) return rtf.format(Math.round(s), 'second');
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
};

export function FileFlyout(p: FileFlyoutProps) {
  const { t, lang } = useT();
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState('');
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  // Storage support is a browser fact, so it is read after mount rather than
  // during render — this page is prerendered and there is no indexedDB there.
  const [canStore, setCanStore] = useState(true);
  useEffect(() => setCanStore(slotsSupported()), []);

  /* Seed the field from whatever the document is already called. Keyed on the
     name rather than run once, so saving under a new name and reopening the
     panel offers that name back instead of the one before it. */
  useEffect(() => {
    setName(p.currentName ?? p.suggestedName);
  }, [p.currentName, p.suggestedName]);

  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);

  const save = () => {
    const v = name.trim();
    if (v && p.hasScene) p.onSave(v);
  };

  const commitRename = () => {
    if (renaming) p.onRenameSlot(renaming, renameTo);
    setRenaming(null);
  };

  return (
    <div
      className={`flyout floating fileFlyout${over ? ' dropOver' : ''}`}
      id="fileFlyout"
      aria-label={t('file.title')}
      /* Panel-scoped rather than window-wide: a drop target over the whole app
         would have to be arbitrated against Leaflet's own drag handling and the
         3D canvas's pointer capture, and this can be widened later without the
         loader changing at all. */
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) p.onOpenFile(f);
      }}
    >
      <div className="dockHead">
        <span className="eyebrow">{t('file.title')}</span>
        <button
          type="button"
          className="iconBtn"
          title={t('ui.close')}
          aria-label={t('ui.close')}
          onClick={p.onClose}
        >
          ✕
        </button>
      </div>

      {/* ---- save ---- */}
      <div className="field">
        <label className="eyebrow block mb-1.5" htmlFor="draftName">
          {t('file.name')}
        </label>
        <input
          id="draftName"
          ref={nameRef}
          type="text"
          className="ctl-input"
          placeholder={t('file.namePlaceholder')}
          value={name}
          disabled={!p.hasScene || !canStore}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              save();
            }
          }}
        />
        <div className="fileActions">
          <button
            type="button"
            className="btn-primary"
            disabled={!p.hasScene || !canStore || !name.trim()}
            onClick={save}
          >
            <IconSave />
            {t('file.save')}
          </button>
        </div>
        <p className="fieldHint">
          {!canStore ? t('file.unavailable') : p.hasScene ? t('file.saveHint') : t('file.needScene')}
        </p>
      </div>

      {/* ---- the slots ---- */}
      {canStore && (
        <div className="field">
          <span className="eyebrow block mb-1.5">{t('file.slots')}</span>
          {p.slots.length === 0 ? (
            <p className="fieldHint">{t('file.noSlots')}</p>
          ) : (
            <ul className="slotList">
              {p.slots.map((s) => (
                <li key={s.name} className="slotRow">
                  {renaming === s.name ? (
                    <input
                      ref={renameRef}
                      type="text"
                      className="ctl-input"
                      aria-label={t('file.renamePrompt')}
                      value={renameTo}
                      onChange={(e) => setRenameTo(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitRename();
                        } else if (e.key === 'Escape') {
                          // Stop the page handler closing the whole flyout — the
                          // local edit is the more specific thing to unwind.
                          e.stopPropagation();
                          setRenaming(null);
                        }
                      }}
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        className="slotName"
                        title={t('file.open')}
                        onClick={() => p.onOpenSlot(s.name)}
                      >
                        <span className="slotTitle">{s.name}</span>
                        <span className="slotMeta">
                          {t('file.slotMeta', {
                            buildings: s.buildings,
                            size: size(s.bytes),
                            when: when(s.savedAt, lang),
                          })}
                        </span>
                      </button>
                      <span className="slotBtns">
                        <button
                          type="button"
                          className="iconBtn"
                          title={t('file.open')}
                          aria-label={`${t('file.open')} ${s.name}`}
                          onClick={() => p.onOpenSlot(s.name)}
                        >
                          <IconOpen />
                        </button>
                        <button
                          type="button"
                          className="iconBtn"
                          title={t('file.rename')}
                          aria-label={`${t('file.rename')} ${s.name}`}
                          onClick={() => {
                            setRenameTo(s.name);
                            setRenaming(s.name);
                          }}
                        >
                          <IconRename />
                        </button>
                        <button
                          type="button"
                          className="iconBtn danger"
                          title={t('file.delete')}
                          aria-label={`${t('file.delete')} ${s.name}`}
                          onClick={() => p.onDeleteSlot(s.name)}
                        >
                          <IconTrash />
                        </button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ---- files ---- */}
      <div className="field">
        <div className="fileActions">
          <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>
            <IconOpen />
            {t('file.openFile')}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={!p.hasScene}
            onClick={p.onExportDraft}
          >
            <IconExport />
            {t('file.exportDraft')}
          </button>
        </div>
        <p className="fieldHint">{t('file.dropHint')}</p>
        <p className="fieldHint">{t('file.exportHint')}</p>
        {/* Owned here rather than behind a promise-returning helper: a file input
            fires no event when the picker is cancelled, so a promise wrapping one
            would never settle. The value is cleared so that picking the same file
            twice in a row still fires a change. */}
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) p.onOpenFile(f);
          }}
        />
      </div>
    </div>
  );
}
