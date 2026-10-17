import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Article } from '../media/article';

/**
 * Articles Bob has opened, kept for offline rereading. A separate database from
 * the doc: articles are Wikipedia's text, not Bob's work, so they never go into
 * backups and can be cleared without loss.
 */
interface ArticleDB extends DBSchema {
  articles: { key: string; value: Article };
}

const DB_NAME = 'chronicle-articles';

export class ArticleCache {
  private dbp: Promise<IDBPDatabase<ArticleDB>>;

  constructor(name = DB_NAME) {
    this.dbp = openDB<ArticleDB>(name, 1, {
      upgrade(db) { db.createObjectStore('articles', { keyPath: 'key' }); },
    });
  }

  async get(key: string): Promise<Article | undefined> {
    try { return await (await this.dbp).get('articles', key); } catch { return undefined; }
  }

  /** Storage can be full or unavailable; the article still shows, it just isn't kept. */
  async put(a: Article): Promise<void> {
    try { await (await this.dbp).put('articles', a); } catch { /* not kept; fine */ }
  }

  async keys(): Promise<string[]> {
    try { return await (await this.dbp).getAllKeys('articles'); } catch { return []; }
  }
}

let shared: ArticleCache | null = null;
export const articleCache = (): ArticleCache => (shared ??= new ArticleCache());
