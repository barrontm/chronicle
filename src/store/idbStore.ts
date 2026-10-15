import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { newId } from '../model/doc';
import type { TimelineDoc } from '../model/types';
import type { DocStore } from './store';

interface ChronicleDB extends DBSchema {
  docs: { key: string; value: TimelineDoc };
  media: { key: string; value: { id: string; blob: Blob; createdAt: number } };
  meta: { key: string; value: string };
}

const DB_NAME = 'chronicle';
const DB_VERSION = 1;

/** IndexedDB-backed store. One active doc for now; the schema allows several. */
export class IdbStore implements DocStore {
  private dbp: Promise<IDBPDatabase<ChronicleDB>>;

  constructor(name = DB_NAME) {
    this.dbp = openDB<ChronicleDB>(name, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('docs', { keyPath: 'id' });
        db.createObjectStore('media', { keyPath: 'id' });
        db.createObjectStore('meta');
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
    await tx.objectStore('docs').put(doc);
    await tx.objectStore('meta').put(doc.id, 'activeDocId');
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
