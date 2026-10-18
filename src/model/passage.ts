import type { SubjectKind } from './subjects';

/**
 * What a highlight could become: the article's own subject, then the pages
 * the passage links to. Pure: the reader's text model supplies where each
 * wiki link sits in the article's text.
 */

/** A wiki link in the article's text: characters [start, end) and the page it opens. */
export interface WikiLink { start: number; end: number; key: string }

/** A page title or key as a page key: underscores, first letter capitalised (Wikipedia ignores its case). */
export function pageKey(title: string): string {
  const k = title.trim().replace(/ /g, '_');
  return k.charAt(0).toUpperCase() + k.slice(1);
}

/** Year, decade and century pages ("429 BC", "5th century BC"): they say when, not what. */
const DATE_PAGE = /^(\d+s?(_(BC|BCE|AD|CE))?|(AD|CE)_\d+|\d+(st|nd|rd|th)_(century|millennium)(_(BC|BCE|AD|CE))?)$/i;
export const isDatePage = (key: string) => DATE_PAGE.test(key);

/** Most pages a passage offers besides the article's own, so the tray stays short and Wikidata isn't asked too often. */
export const MAX_LINKED = 6;

/**
 * The candidates for a highlight over [start, end): the article's own key
 * first, then the pages linked inside or overlapping the passage, in reading
 * order, each once, leaving out date pages and links back to the article.
 */
export function passageCandidates(articleKey: string, links: WikiLink[], start: number, end: number, max = MAX_LINKED): string[] {
  const own = pageKey(articleKey);
  const out = [own];
  for (const l of links) {
    if (l.start >= end || l.end <= start) continue;
    const k = pageKey(l.key);
    if (!k || out.includes(k) || isDatePage(k)) continue;
    out.push(k);
    if (out.length > max) break;
  }
  return out;
}

/** Kinds that can't be drawn from Wikipedia yet, and why (docs/design.md, Becomes). */
export const CANT_ADD: Partial<Record<SubjectKind, string>> = {
  idea: 'Ideas can’t be drawn on the map and timeline yet. Keep the highlight.',
  polity: 'Polities come from the territory tools for now. Keep the highlight.',
};

const FIRST: SubjectKind[] =['event', 'war', 'battle'];

/** The candidate chosen at first: the first event, war or battle the passage links, else the article's subject (index 0). */
export function firstChoice(kinds: (SubjectKind | undefined)[]): number {
  const i = kinds.findIndex((k, n) => n > 0 && !!k && FIRST.includes(k));
  return i < 0 ? 0 : i;
}
