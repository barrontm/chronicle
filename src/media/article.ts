import { newId } from '../model/doc';
import type { Source } from '../model/types';
import { sanitizeParsoid } from './sanitize';

const WIKI = 'https://en.wikipedia.org';

/** A Wikipedia article, cleaned for the reader. Cached on the device, never part of the doc. */
export interface Article {
  /** Page key for URLs, e.g. "Battle_of_Marathon". */
  key: string;
  title: string;
  revisionId: number | null;
  /** When the revision was made (ISO), from the page's `dc:modified`. */
  modified: string | null;
  pageId: number | null;
  /** Epoch ms when Chronicle fetched it. */
  fetchedAt: number;
  /** Sanitized HTML (`sanitizeParsoid`). */
  html: string;
}

/** Parsoid HTML for a page; RESTBase's `rest_v1/page/html` redirects here anyway. */
export function buildArticleUrl(key: string): string {
  return `${WIKI}/w/rest.php/v1/page/${encodeURIComponent(key)}/html`;
}

/** A page key from a title or key ("Battle of Marathon" → "Battle_of_Marathon"). */
export function articleKey(titleOrKey: string): string {
  return titleOrKey.trim().replace(/ /g, '_');
}

/** The page's address, as Wikipedia gives it and as sources store it. */
export function articleUrl(key: string): string {
  return `${WIKI}/wiki/${encodeURIComponent(articleKey(key))}`;
}

/** The source an article's highlights cite: the one Bob already has for the page, or a new one (not yet saved). */
export function articleSource(sources: Source[], article: { key: string; title: string }, today: string): { source: Source; isNew: boolean } {
  const url = articleUrl(article.key);
  const found = sources.find((s) => s.url === url || s.url === `${WIKI}/wiki/${articleKey(article.key)}`);
  if (found) return { source: found, isNew: false };
  return { source: { id: newId('s'), kind: 'web', title: article.title, authors: 'Wikipedia contributors', publisher: 'Wikipedia', url, accessed: today, updatedAt: 0 }, isNew: true };
}

export function parseArticle(key: string, raw: string, now = Date.now()): Article {
  const s = sanitizeParsoid(raw, { pageTitle: key });
  const title = s.title && s.title !== key ? s.title : key.replace(/_/g, ' ');
  return { key, title, revisionId: s.revisionId, modified: s.modified, pageId: s.pageId, fetchedAt: now, html: s.html };
}

// Wikipedia answers 429 at about 3 requests a second, so article fetches wait their turn.
let queue: Promise<unknown> = Promise.resolve();

export function fetchArticle(key: string, signal?: AbortSignal): Promise<Article> {
  const run = async () => {
    signal?.throwIfAborted();
    const res = await fetch(buildArticleUrl(key), { signal });
    if (res.status === 404) throw new Error('Wikipedia has no article by that name.');
    if (!res.ok) throw new Error(`Wikipedia didn’t answer (${res.status}). Try again in a moment.`);
    return parseArticle(key, await res.text());
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}
