import { SCHEMA_VERSION, type TimelineDoc } from '../model/types';

/**
 * The single seam between the app and persistence. UI code never touches
 * IndexedDB directly. A future sync layer (see ROADMAP "Sync") wraps an
 * implementation of this interface rather than changing callers.
 */
export interface DocStore {
  /** The most recently saved doc as stored (any schema version), or null on first run. */
  load(): Promise<TimelineDoc | null>;
  /** Refuses (NewerDataError) to overwrite a doc saved by a newer version of the app. */
  save(doc: TimelineDoc): Promise<void>;
  /** Keep an untouched copy of a stored doc (before upgrading it); only the last few are kept. */
  keepCopy(doc: unknown, label: string): Promise<void>;
  /** Store an uploaded image; returns its local id. */
  putMedia(blob: Blob): Promise<string>;
  getMedia(id: string): Promise<Blob | undefined>;
}

/** Saving was refused because a newer version of the app has saved data here. */
export class NewerDataError extends Error {
  constructor() {
    super('This data was saved by a newer version of Chronicle.');
  }
}

export const KEPT_COPIES = 5;

/** True if writing `doc` over `stored` would lose fields only a newer app knows about. */
export const wouldDowngrade = (stored: { schemaVersion?: number } | null | undefined) =>
  (stored?.schemaVersion ?? 0) > SCHEMA_VERSION;

export class MemoryStore implements DocStore {
  private doc: TimelineDoc | null = null;
  private media = new Map<string, Blob>();
  copies: Array<{ label: string; doc: unknown }> = [];
  async load() {
    return this.doc ? structuredClone(this.doc) : null;
  }
  async save(doc: TimelineDoc) {
    if (wouldDowngrade(this.doc)) throw new NewerDataError();
    this.doc = structuredClone(doc);
  }
  async keepCopy(doc: unknown, label: string) {
    this.copies = [...this.copies, { label, doc: structuredClone(doc) }].slice(-KEPT_COPIES);
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
