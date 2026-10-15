import type { TimelineDoc } from '../model/types';

/**
 * The single seam between the app and persistence. UI code never touches
 * IndexedDB directly. A future sync layer (see ROADMAP "Sync") wraps an
 * implementation of this interface rather than changing callers.
 */
export interface DocStore {
  /** The most recently saved doc, or null on first run. */
  load(): Promise<TimelineDoc | null>;
  save(doc: TimelineDoc): Promise<void>;
  /** Store an uploaded image; returns its local id. */
  putMedia(blob: Blob): Promise<string>;
  getMedia(id: string): Promise<Blob | undefined>;
}

export class MemoryStore implements DocStore {
  private doc: TimelineDoc | null = null;
  private media = new Map<string, Blob>();
  async load() {
    return this.doc ? structuredClone(this.doc) : null;
  }
  async save(doc: TimelineDoc) {
    this.doc = structuredClone(doc);
  }
  async putMedia(blob: Blob) {
    const id = `m_${this.media.size + 1}`;
    this.media.set(id, blob);
    return id;
  }
  async getMedia(id: string) {
    return this.media.get(id);
  }
}
