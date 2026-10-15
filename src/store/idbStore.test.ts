import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createEmptyDoc } from '../model/doc';
import { IdbStore } from './idbStore';

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
});
