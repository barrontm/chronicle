import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Article } from '../media/article';
import type { Subject } from '../model/subjects';

/**
 * Articles Bob has opened, kept for offline rereading. A separate database from
 * the doc: articles are Wikipedia's text, not Bob's work, so they never go into
 * backups and can be cleared without loss. What each article is about (its
 * Wikidata subject) is kept beside it, so the reader's header shows offline too.
 */
interface ArticleDB extends DBSchema {
  articles: { key: string; value: Article };
  /** `subject` is absent when the page has no Wikidata item. */
  subjects: { key: string; value: CachedSubject };
}

/** `v`: the `SUBJECT_VERSION` it was read with; missing before versions were kept. */
export interface CachedSubject { key: string; subject?: Subject; fetchedAt: number; v?: number }

const DB_NAME = 'chronicle-articles';

export class ArticleCache {
  private dbp: Promise<IDBPDatabase<ArticleDB>>;

  constructor(name = DB_NAME) {
    this.dbp = openDB<ArticleDB>(name, 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) db.createObjectStore('articles', { keyPath: 'key' });
        if (oldVersion < 2) db.createObjectStore('subjects', { keyPath: 'key' });
      },
    });
  }

  async get(key: string): Promise<Article | undefined> {
    try { return await (await this.dbp).get('articles', key); } catch { return undefined; }
  }

  /** Storage can be full or unavailable; the article still shows, it just isn't kept. */
  async put(a: Article): Promise<void> {
    try { await (await this.dbp).put('articles', a); } catch { /* not kept; fine */ }
  }

  async getSubject(key: string): Promise<CachedSubject | undefined> {
    try { return await (await this.dbp).get('subjects', key); } catch { return undefined; }
  }

  async putSubject(s: CachedSubject): Promise<void> {
    try { await (await this.dbp).put('subjects', s); } catch { /* not kept; fine */ }
  }

  async keys(): Promise<string[]> {
    try { return await (await this.dbp).getAllKeys('articles'); } catch { return []; }
  }
}

let shared: ArticleCache | null = null;
export const articleCache = (): ArticleCache => (shared ??= new ArticleCache());
