import { bbox } from '../data/geo';
import { formatHistDate, formatItemDates, formatRange, toDecimalYear } from './dates';
import type { ItemKind, SubjectKind, TimelineDoc } from './types';

/** One thing a search found: what to show in the list, and where to take Bob when he picks it. */
export interface SearchHit {
  type: 'item' | 'territory' | 'note' | 'source' | 'highlight';
  id: string;
  title: string;
  /** Entries and territories: their kind of thing, for the glyph. */
  subject?: SubjectKind;
  /** Their dates in words (a source: its authors and year). */
  when?: string;
  /** The year to show on the map and the timeline. */
  year?: number;
  /** [west, south, east, north] to fit the map to. */
  bounds?: [number, number, number, number];
  /** The words around a match in the text, when the title didn't match. */
  snippet?: string;
  /** Highlights: the source they were made in. */
  sourceId?: string;
}

export const SEARCH_LIMIT = 20;

/** What an entry with no kind of thing draws as (the same as `representationOf`). */
const BY_KIND: Record<ItemKind, SubjectKind> = { event: 'event', span: 'period', person: 'person' };

/** Folds case and accents: "Perikles", "PÉRIKLÈS" and "périklès" are the same. Keeps a map back to the original. */
function fold(text: string): { s: string; at: number[] } {
  let s = '';
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const f = text[i].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (const c of f) { s += c; at.push(i); }
  }
  return { s, at };
}
const words = (q: string) => fold(q).s.split(/\s+/).filter(Boolean);

/**
 * How well a title matches, best first: 0 it starts with the query, 1 a word in it starts with the
 * query, 2 it has every word somewhere. Null when it doesn't match.
 */
function titleRank(title: string, query: string, ws: string[]): number | null {
  const t = fold(title).s;
  if (t.startsWith(query)) return 0;
  if (new RegExp(`(^|[^\\p{L}\\p{N}])${escape(query)}`, 'u').test(t)) return 1;
  return ws.every((w) => t.includes(w)) ? 2 : null;
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The words around the first match in a text, or null when it doesn't have every word. */
function snippetOf(text: string | undefined, ws: string[], room = 40): string | null {
  if (!text) return null;
  const f = fold(text);
  if (!ws.every((w) => f.s.includes(w))) return null;
  const hit = f.s.indexOf(ws[0]);
  const from = f.at[hit] ?? 0;
  const to = f.at[Math.min(hit + ws[0].length, f.at.length) - 1] + 1;
  let a = Math.max(0, from - room), b = Math.min(text.length, to + room * 2);
  // Whole words at the ends.
  if (a > 0) { const sp = text.indexOf(' ', a); if (sp !== -1 && sp < from) a = sp + 1; }
  if (b < text.length) { const sp = text.lastIndexOf(' ', b); if (sp > to) b = sp; }
  return `${a > 0 ? '…' : ''}${text.slice(a, b).replace(/\s+/g, ' ').trim()}${b < text.length ? '…' : ''}`;
}

/** The order kinds come in at the same rank: entries, territories, notes, sources, highlights. */
const ORDER: SearchHit['type'][] = ['item', 'territory', 'note', 'source', 'highlight'];

/**
 * Searches Bob's entries, territories, notes, sources and highlights. Ignores case and accents.
 * Titles that match come first, then text that does (descriptions, notes, sources, highlights).
 * Every word of the query has to be there. At most `limit` results.
 */
export function search(doc: TimelineDoc, query: string, limit = SEARCH_LIMIT): SearchHit[] {
  const q = fold(query.trim()).s.replace(/\s+/g, ' ');
  const ws = words(query);
  if (!ws.length) return [];
  const found: Array<{ hit: SearchHit; rank: number }> = [];
  const add = (hit: Omit<SearchHit, 'snippet'>, text: Array<string | undefined>) => {
    const r = titleRank(hit.title, q, ws);
    if (r !== null) { found.push({ hit, rank: r }); return; }
    for (const t of text) {
      const snippet = snippetOf(t, ws);
      if (snippet) { found.push({ hit: { ...hit, snippet }, rank: 3 }); return; }
    }
  };

  for (const i of doc.items) {
    const place = i.places?.[0];
    add({
      type: 'item', id: i.id, title: i.title, subject: i.subject ?? BY_KIND[i.kind], when: formatItemDates(i),
      year: i.start ? toDecimalYear(i.start) : undefined,
      bounds: place ? [place.lon, place.lat, place.lon, place.lat] : undefined,
    }, [i.description, i.tags?.join(' '), i.region]);
  }
  for (const t of doc.territories) {
    const byYear = [...t.snapshots].sort((a, b) => toDecimalYear(a.from) - toDecimalYear(b.from));
    const first = byYear[0];
    const shape = byYear.find((x) => x.geometry)?.geometry;
    add({
      type: 'territory', id: t.id, title: t.title, subject: 'polity',
      when: !first ? undefined : byYear.at(-1)?.to ? formatRange(first.from, byYear.at(-1)!.to) : `From ${formatHistDate(first.from)}`,
      year: first ? toDecimalYear(first.from) : undefined,
      bounds: shape ? bbox(shape) : undefined,
    }, []);
  }
  for (const n of doc.notes) add({ type: 'note', id: n.id, title: n.title || 'Untitled note' }, [n.body]);
  for (const s of doc.sources) add({ type: 'source', id: s.id, title: s.title, when: [s.authors, s.year].filter(Boolean).join(', ') || undefined }, [s.authors, s.remarks, s.publisher]);
  const sourceTitle = new Map(doc.sources.map((s) => [s.id, s.title]));
  for (const h of doc.highlights) {
    const snippet = snippetOf(h.text, ws);
    if (snippet) found.push({ hit: { type: 'highlight', id: h.id, title: sourceTitle.get(h.sourceId) ?? 'Highlight', snippet, sourceId: h.sourceId }, rank: 3 });
  }

  return found
    .sort((a, b) => a.rank - b.rank || ORDER.indexOf(a.hit.type) - ORDER.indexOf(b.hit.type) || a.hit.title.length - b.hit.title.length || a.hit.title.localeCompare(b.hit.title))
    .slice(0, limit)
    .map((f) => f.hit);
}
