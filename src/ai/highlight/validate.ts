import { findAnchor, sectionAt, type ArticleText } from '../../model/anchor';
import { fromAstronomical, parseHistDate } from '../../model/dates';
import { RELATION_TYPES } from '../../model/doc';
import { pageKey } from '../../model/passage';
import { DIMENSIONS, type Dimension, type Highlight, type HistDate, type ItemKind, type RelationType } from '../../model/types';

/**
 * Checks Claude's answer about a highlight before anything is looked up or
 * shown. Pure, so the rules are unit-tested. Every claim must rest on words
 * of the highlight or its section; dates must parse and be stated there, and
 * so must any number in a title or an effect. What's left out is explained in
 * `dropped`, in Bob's words.
 */

/** What every claim must rest on: the highlight and the section it's in. */
export interface Scope { highlight: string; section: string }

/** A connection end: one of Bob's entries, a page the passage links, or an entry in this draft. */
export type End = { item: string } | { page: string } | { ref: string };

export interface ProposedEntry {
  ref: string;
  title: string;
  kind: ItemKind;
  start: HistDate;
  end?: HistDate;
  place?: string;
  categoryId: string;
  quote: string;
  why: string;
}

export interface ProposedConnection { from: End; to: End; type: RelationType; effect: string; quote: string }

export interface CheckedHighlight {
  dimension?: { value: Dimension; quote: string };
  entries: ProposedEntry[];
  connections: ProposedConnection[];
  dropped: string[];
}

export interface HighlightContext {
  scope: Scope;
  /** Ids (and titles, for messages) of Bob's entries. */
  existing: Map<string, string>;
  /** Page key → title of the article's subject and the pages the passage links. */
  candidates: Map<string, string>;
  categoryIds: Set<string>;
  maxEntries?: number;
}

/** The highlight's text and its section's, found in the article by its anchor (or, failing that, by its section's title). */
export function scopeOf(article: ArticleText, h: Highlight): Scope {
  const placed = h.anchor ? findAnchor(article, h.anchor) : null;
  const sec = placed
    ? sectionAt(article, placed.start)
    : article.sections.find((s) => s.title === (h.anchor?.section ?? '')) ?? article.sections[0];
  return { highlight: h.text, section: sec ? article.text.slice(sec.start, sec.end) : '' };
}

/** Lowercase, straight quotes, plain hyphens, single spaces: so a quote matches however the article typed it. */
export function normalize(s: string): string {
  return s.toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'").replace(/[“”«»]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ').trim();
}

/** True when the quote's words are in the highlight or its section. Pieces joined by "…" are each checked. */
export function quoteHolds(quote: string, scope: Scope): boolean {
  const pieces = normalize(quote).split(/\s*(?:…|\.\.\.)\s*/).map((p) => p.replace(/^["'\s.,;:]+|["'\s.,;:]+$/g, '')).filter(Boolean);
  if (!pieces.length || pieces.join(' ').length < 10) return false;
  const hay = `${normalize(scope.highlight)}\n${normalize(scope.section)}`;
  return pieces.every((p) => hay.includes(p));
}

/** The numbers a text states, without thousands separators ("20,000" → "20000"). */
export function numbersIn(s: string): Set<string> {
  return new Set((s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,(?=\d{3}\b)/g, '')));
}

/** Numbers in `text` that the passage never states. */
export function unstatedNumbers(text: string, scope: Scope): string[] {
  const stated = numbersIn(`${scope.highlight}\n${scope.section}`);
  return [...numbersIn(text)].filter((n) => !stated.has(n));
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const KINDS: ItemKind[] = ['event', 'span', 'person'];

export function checkHighlightAnswer(input: unknown, ctx: HighlightContext): CheckedHighlight {
  const dropped: string[] = [];
  if (!isObj(input)) return { entries: [], connections: [], dropped: ['Claude’s answer wasn’t in the expected shape.'] };
  const { scope } = ctx;

  let dimension: CheckedHighlight['dimension'];
  if (isObj(input.dimension)) {
    const value = str(input.dimension.value) as Dimension;
    const quote = str(input.dimension.quote);
    if (!DIMENSIONS.includes(value)) dropped.push('The suggested dimension: not one of the six.');
    else if (!quoteHolds(quote, scope)) dropped.push(`The suggested dimension (${value}): the words it rests on aren’t in the passage.`);
    else dimension = { value, quote };
  }

  const entries: ProposedEntry[] = [];
  const refs = new Set<string>();
  const titles = new Set([...ctx.existing.values(), ...ctx.candidates.values()].map(normalize));
  const max = ctx.maxEntries ?? 3;
  for (const raw of Array.isArray(input.entries) ? input.entries : []) {
    if (!isObj(raw)) continue;
    const title = str(raw.title);
    const ref = str(raw.ref);
    const quote = str(raw.quote);
    if (!title || !ref || refs.has(ref)) continue;
    const name = `“${title}”`;
    if (titles.has(normalize(title))) { dropped.push(`${name}: you already have it, or it has its own article.`); continue; }
    if (!quoteHolds(quote, scope)) { dropped.push(`${name}: the words it rests on aren’t in the passage.`); continue; }
    const start = parseHistDate(str(raw.start));
    const endText = str(raw.end);
    const end = endText ? parseHistDate(endText) : undefined;
    if (!start || end === null) { dropped.push(`${name}: its date (“${[str(raw.start), endText].filter(Boolean).join('–')}”) isn’t one Chronicle can read.`); continue; }
    const years = [start, ...(end ? [end] : [])].map((d) => String(fromAstronomical(d.y).year));
    const stated = numbersIn(`${scope.highlight}\n${scope.section}`);
    if (years.some((y) => !stated.has(y))) { dropped.push(`${name}: the passage doesn’t give its date.`); continue; }
    if (end && end.y < start.y) { dropped.push(`${name}: it ends before it starts.`); continue; }
    const extra = unstatedNumbers(title, scope);
    if (extra.length) { dropped.push(`${name}: the passage doesn’t give the number ${extra[0]}.`); continue; }
    if (entries.length >= max) { dropped.push(`${name}: more than ${max} entries from one highlight.`); continue; }
    let kind = KINDS.includes(str(raw.kind) as ItemKind) ? (str(raw.kind) as ItemKind) : 'event';
    if (kind === 'span' && !end) kind = 'event';
    const cat = str(raw.category);
    const why = str(raw.why);
    const place = str(raw.place);
    refs.add(ref);
    titles.add(normalize(title));
    entries.push({
      ref, title, kind, start, ...(end && kind !== 'event' ? { end } : {}), ...(place ? { place } : {}),
      categoryId: ctx.categoryIds.has(cat) ? cat : [...ctx.categoryIds][0] ?? cat,
      quote,
      why: unstatedNumbers(why, scope).length ? '' : why,
    });
  }

  const pages = new Map([...ctx.candidates.keys()].map((k) => [pageKey(k), k]));
  const endOf = (s: string): End | undefined => {
    if (ctx.existing.has(s)) return { item: s };
    if (refs.has(s)) return { ref: s };
    const page = pages.get(pageKey(s));
    return page ? { page } : undefined;
  };
  const nameOf = (s: string) => ctx.existing.get(s) ?? ctx.candidates.get(pages.get(pageKey(s)) ?? '') ?? entries.find((e) => e.ref === s)?.title ?? s.replace(/_/g, ' ');
  const connections: ProposedConnection[] = [];
  const keys = new Set<string>();
  for (const raw of Array.isArray(input.connections) ? input.connections : []) {
    if (!isObj(raw)) continue;
    const from = endOf(str(raw.from));
    const to = endOf(str(raw.to));
    const label = `A connection from “${nameOf(str(raw.from))}” to “${nameOf(str(raw.to))}”`;
    const effect = str(raw.effect).toLowerCase();
    const type = str(raw.type) as RelationType;
    const quote = str(raw.quote);
    if (!from || !to) { dropped.push(`${label}: one end isn’t in the draft, the passage or your Chronicle.`); continue; }
    const key = `${JSON.stringify(from)}|${JSON.stringify(to)}`;
    if (key.split('|')[0] === key.split('|')[1] || keys.has(key)) continue;
    if (!effect || effect.split(/\s+/).length > 3) { dropped.push(`${label}: it doesn’t say what the one did to the other.`); continue; }
    if (unstatedNumbers(effect, scope).length) { dropped.push(`${label}: its effect has a number the passage doesn’t give.`); continue; }
    if (!quoteHolds(quote, scope)) { dropped.push(`${label}: the words it rests on aren’t in the passage.`); continue; }
    keys.add(key);
    connections.push({ from, to, type: RELATION_TYPES.includes(type) ? type : 'caused', effect, quote });
  }
  return { ...(dimension ? { dimension } : {}), entries, connections, dropped };
}
