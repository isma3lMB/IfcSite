import { AppError } from '@/lib/errors';
import type { Provider } from '@/lib/types';

/* =====================================================================
   Saved drafts, in this browser.

   IndexedDB rather than localStorage, which every other preference here uses:
   localStorage is capped around 5 MB of UTF-16, i.e. ~2.5 MB of JSON, and a site
   with a max-accuracy terrain is comfortably past that. The typical draft would
   have fitted and the interesting one would not, which is the worst of the two
   failure modes — it would have worked until it mattered.

   Two object stores rather than one, because the panel lists every slot the
   moment it opens and must not deserialise megabytes of scene to draw six rows.
   The metadata is small enough to read eagerly; the payload is fetched only when
   a draft is actually opened.
   ===================================================================== */

const DB_NAME = 'ifcsite';
const DB_VERSION = 1;
const META = 'slotMeta';
const DATA = 'slotData';

/** What a row in the panel needs, and nothing more. */
export type SlotMeta = {
  name: string;
  savedAt: number;
  bytes: number;
  lat: number;
  lon: number;
  buildings: number;
  provider: Provider;
};

/** Whether this browser will store anything at all. Firefox in a private window
 *  rejects indexedDB.open outright, and the panel offers file export instead of
 *  pretending Save is available. */
export const slotsSupported = (): boolean => typeof indexedDB !== 'undefined';

/** Promise over an IDBRequest. The two callbacks are the whole of IndexedDB's
 *  ergonomics problem, and wrapping them once is cheaper than a dependency. */
const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!slotsSupported()) return Promise.reject(new AppError('err.slotsUnavailable'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'name' });
      if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA, { keyPath: 'name' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    // Another tab holding an old version open. Rare, and not worth a retry loop:
    // the panel says drafts are unavailable and file export still works.
    r.onblocked = () => reject(new AppError('err.slotsUnavailable'));
  }).catch((e) => {
    // Do not cache a rejected promise — a later attempt (a different tab closing,
    // say) should be allowed to succeed.
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

/**
 * Run `fn` inside one transaction over both stores.
 *
 * Every failure below comes back as err.slotsUnavailable rather than as whatever
 * IndexedDB threw: from the panel's point of view there is one useful
 * distinction — storage works or it does not — and the remedy is the same either
 * way. The transaction is awaited to completion, not just to the last request,
 * so a quota failure on write surfaces here instead of silently rolling back.
 */
async function tx<T>(
  mode: IDBTransactionMode,
  fn: (meta: IDBObjectStore, data: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    let out: T;
    let settled = false;
    const t = db.transaction([META, DATA], mode);
    t.oncomplete = () => {
      if (!settled) resolve(out);
    };
    t.onerror = t.onabort = () => {
      settled = true;
      reject(new AppError('err.slotsUnavailable'));
    };
    fn(t.objectStore(META), t.objectStore(DATA)).then(
      (v) => {
        out = v;
        // Read-only transactions can complete before this resolves; guard so the
        // value is not lost either way round.
        if (mode === 'readonly') {
          settled = true;
          resolve(v);
        }
      },
      (e) => {
        settled = true;
        try {
          t.abort();
        } catch {
          // already finished
        }
        reject(e instanceof AppError ? e : new AppError('err.slotsUnavailable'));
      },
    );
  });
}

/** Newest first — the one you were just working on is the one you want back. */
export async function listSlots(): Promise<SlotMeta[]> {
  const rows = await tx('readonly', (meta) => req(meta.getAll() as IDBRequest<SlotMeta[]>));
  return rows.sort((a, b) => b.savedAt - a.savedAt);
}

export async function readSlot(name: string): Promise<string> {
  const row = await tx('readonly', (_m, data) =>
    req(data.get(name) as IDBRequest<{ name: string; json: string } | undefined>),
  );
  if (!row) throw new AppError('err.draftCorrupt');
  return row.json;
}

export async function writeSlot(name: string, json: string, meta: SlotMeta): Promise<void> {
  await tx('readwrite', async (m, d) => {
    await req(m.put(meta));
    await req(d.put({ name, json }));
  });
}

export async function deleteSlot(name: string): Promise<void> {
  await tx('readwrite', async (m, d) => {
    await req(m.delete(name));
    await req(d.delete(name));
  });
}

/** Rename is a copy and a delete: the name is the key in both stores. */
export async function renameSlot(from: string, to: string): Promise<void> {
  await tx('readwrite', async (m, d) => {
    const meta = await req(m.get(from) as IDBRequest<SlotMeta | undefined>);
    const row = await req(d.get(from) as IDBRequest<{ name: string; json: string } | undefined>);
    if (!meta || !row) throw new AppError('err.draftCorrupt');
    await req(m.put({ ...meta, name: to }));
    await req(d.put({ name: to, json: row.json }));
    await req(m.delete(from));
    await req(d.delete(from));
  });
}
