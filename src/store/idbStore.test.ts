import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createEmptyDoc } from '../model/doc';
import { IdbStore } from './idbStore';
import { KEPT_COPIES, NewerDataError } from './store';

describe('IdbStore', () => {
  it('returns null before anything is saved', async () => {
    expect(await new IdbStore('t1').load()).toBeNull();
  });

  it('persists the active doc across instances', async () => {
    const doc = createEmptyDoc('Persisted');
    await new IdbStore('t2').save(doc);
    expect((await new IdbStore('t2').load())?.title).toBe('Persisted');
  });

  it('stores uploaded media blobs', async () => {
    const store = new IdbStore('t3');
    const id = await store.putMedia(new Blob(['hello'], { type: 'text/plain' }));
    const blob = await store.getMedia(id);
    expect(blob).toBeDefined();
    expect(blob!.size).toBe(5);
  });

  it('refuses to save over data from a newer version of the app', async () => {
    const store = new IdbStore('t4');
    const doc = createEmptyDoc('Mine');
    await store.save(doc);
    // Simulate a newer app writing the same doc.
    const db = await (store as unknown as { dbp: Promise<import('idb').IDBPDatabase> }).dbp;
    await db.put('docs', { ...doc, schemaVersion: 99, title: 'Newer' });
    await expect(store.save({ ...doc, title: 'Older tab' })).rejects.toBeInstanceOf(NewerDataError);
    expect((await store.load())?.title).toBe('Newer');
  });

  it('keeps the last few copies from before upgrades', async () => {
    const store = new IdbStore('t5');
    for (let i = 0; i < KEPT_COPIES + 2; i++) await store.keepCopy({ n: i }, `copy ${i}`);
    const db = await (store as unknown as { dbp: Promise<import('idb').IDBPDatabase> }).dbp;
    const kept = await db.getAll('backups');
    expect(kept.map((b) => b.label).sort()).toEqual(Array.from({ length: KEPT_COPIES }, (_, i) => `copy ${i + 2}`).sort());
  });
});
