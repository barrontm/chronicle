import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { newId } from '../model/doc';
import type { TimelineDoc } from '../model/types';
import { KEPT_COPIES, NewerDataError, wouldDowngrade, type DocStore } from './store';

interface ChronicleDB extends DBSchema {
  docs: { key: string; value: TimelineDoc };
  media: { key: string; value: { id: string; blob: Blob; createdAt: number } };
  meta: { key: string; value: string };
  /** Untouched copies of the doc, kept before each upgrade to a newer schema. */
  backups: { key: string; value: { id: string; label: string; savedAt: number; doc: unknown }; indexes: { savedAt: number } };
}

const DB_NAME = 'chronicle';
const DB_VERSION = 2;

/** IndexedDB-backed store. One active doc for now; the schema allows several. */
export class IdbStore implements DocStore {
  private dbp: Promise<IDBPDatabase<ChronicleDB>>;

  constructor(name = DB_NAME) {
    this.dbp = openDB<ChronicleDB>(name, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('docs', { keyPath: 'id' });
          db.createObjectStore('media', { keyPath: 'id' });
          db.createObjectStore('meta');
        }
        if (oldVersion < 2) db.createObjectStore('backups', { keyPath: 'id' }).createIndex('savedAt', 'savedAt');
      },
    });
  }

  async load(): Promise<TimelineDoc | null> {
    const db = await this.dbp;
    const activeId = await db.get('meta', 'activeDocId');
    if (!activeId) return null;
    return (await db.get('docs', activeId)) ?? null;
  }

  async save(doc: TimelineDoc): Promise<void> {
    const db = await this.dbp;
    const tx = db.transaction(['docs', 'meta'], 'readwrite');
    // A newer version of the app may have saved here since this tab loaded.
    if (wouldDowngrade(await tx.objectStore('docs').get(doc.id))) {
      tx.abort();
      await tx.done.catch(() => undefined);
      throw new NewerDataError();
    }
    await tx.objectStore('docs').put(doc);
    await tx.objectStore('meta').put(doc.id, 'activeDocId');
    await tx.done;
  }

  async keepCopy(doc: unknown, label: string): Promise<void> {
    const db = await this.dbp;
    const tx = db.transaction('backups', 'readwrite');
    // Strictly increasing, so the oldest copies are the ones pruned even within one millisecond.
    const last = await tx.store.index('savedAt').openCursor(null, 'prev');
    await tx.store.put({ id: newId('b'), label, savedAt: Math.max(Date.now(), (last?.value.savedAt ?? 0) + 1), doc });
    const keys = await tx.store.index('savedAt').getAllKeys();
    for (const k of keys.slice(0, Math.max(0, keys.length - KEPT_COPIES))) await tx.store.delete(k);
    await tx.done;
  }

  async putMedia(blob: Blob): Promise<string> {
    const db = await this.dbp;
    const id = newId('m');
    await db.put('media', { id, blob, createdAt: Date.now() });
    return id;
  }

  async getMedia(id: string): Promise<Blob | undefined> {
    const db = await this.dbp;
    return (await db.get('media', id))?.blob;
  }
}
