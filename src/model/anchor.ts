import search from 'approx-string-match';
import type { TextAnchor } from './types';

/**
 * Finding a highlight again after its Wikipedia article is edited. Pure: it
 * works on the article's text as the reader's text model gives it (footnote
 * markers left out, whitespace collapsed, a "\n" between blocks), never the DOM.
 *
 * Tiers: the exact quote in its section (by heading text, since section numbers
 * shift), then exact anywhere in the article, then a fuzzy match
 * (`approx-string-match`) in the section and then the article. Each candidate
 * is scored on the quote and its prefix and suffix, the way Hypothesis does.
 */

/** A section of the article text: its heading ("" for the lead) and where it runs. */
export interface TextSection {
  title: string;
  start: number;
  end: number;
}

export interface ArticleText {
  text: string;
  /** In order; the first is the lead, starting at 0. */
  sections: TextSection[];
}

/** Where a highlight landed in the current text. */
export interface Placement {
  start: number;
  end: number;
  /** "fuzzy" when the words changed. */
  match: 'exact' | 'fuzzy';
  /** Not found word for word in its section, and little of its context matches: it may be in the wrong place. */
  uncertain: boolean;
}

/** Characters of context kept on each side of the quote. */
export const CONTEXT = 32;
const ACCEPT = 0.55;
const UNSURE = 0.4;

export function sectionAt(t: ArticleText, i: number): TextSection {
  let lo = 0;
  let hi = t.sections.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t.sections[mid].start <= i) lo = mid;
    else hi = mid - 1;
  }
  return t.sections[lo] ?? { title: '', start: 0, end: t.text.length };
}

/** An anchor for the text [start, end), trimmed of spaces and block breaks. Null when nothing is left. */
export function makeAnchor(t: ArticleText, start: number, end: number, revisionId?: number): TextAnchor | null {
  [start, end] = trim(t.text, start, end);
  if (end <= start) return null;
  return {
    ...(revisionId ? { revisionId } : {}),
    section: sectionAt(t, start).title,
    exact: t.text.slice(start, end),
    prefix: t.text.slice(Math.max(0, start - CONTEXT), start),
    suffix: t.text.slice(end, end + CONTEXT),
    pos: start,
  };
}

export function trim(text: string, s: number, e: number): [number, number] {
  while (s < e && (text[s] === ' ' || text[s] === '\n')) s++;
  while (e > s && (text[e - 1] === ' ' || text[e - 1] === '\n')) e--;
  return [s, e];
}

/** Where the anchor's quote is in this text now, or null when it can't be placed (usually: it was deleted). */
export function findAnchor(t: ArticleText, a: TextAnchor): Placement | null {
  const r = place(t, a);
  if (!r) return null;
  return { start: r.start, end: r.end, match: r.errors ? 'fuzzy' : 'exact', uncertain: !(r.inSection && !r.errors) && r.context < UNSURE };
}

interface Candidate { start: number; end: number; errors: number; inSection: boolean; quote: number; context: number; score: number }

function place(t: ArticleText, a: TextAnchor): Candidate | null {
  const { text } = t;
  const q = a.exact;
  if (!q) return null;
  const title = a.section ?? '';
  const sec = title ? t.sections.find((s) => s.title === title) : t.sections[0];

  const best = (spans: { start: number; end: number; errors: number }[], inSection: boolean) => {
    let top: Candidate | null = null;
    for (const c of spans) {
      const s = score(text, a, c);
      if (!top || s.score > top.score) top = { ...c, inSection, ...s };
    }
    return top;
  };
  const exactIn = (from: number, to: number) => indexesOf(text, q, from, to).map((i) => ({ start: i, end: i + q.length, errors: 0 }));

  // 1. Exact, in the same section.
  if (sec) {
    const r = best(exactIn(sec.start, sec.end), true);
    if (r) return r;
  }
  // 2. Exact anywhere. A short common phrase elsewhere isn't the same highlight, so it needs matching context.
  {
    const r = best(exactIn(0, text.length), false);
    if (r && (q.length >= 40 || r.context >= 0.45)) return r;
  }
  // 3. Fuzzy: one wrong letter is too much of a very short quote.
  if (q.length < 12) return null;
  const fuzzy = (from: number, to: number) => {
    const spans = search(text.slice(from, to), q, maxErrors(q.length))
      .sort((x, y) => x.errors - y.errors)
      .slice(0, 40)
      .map((c) => ({ start: c.start + from, end: c.end + from, errors: c.errors }));
    return spans;
  };
  if (sec) {
    const r = best(fuzzy(sec.start, sec.end), true);
    if (r && r.score >= ACCEPT) return r;
  }
  const r = best(fuzzy(0, text.length), false);
  return r && r.score >= ACCEPT ? r : null;
}

const maxErrors = (len: number) => Math.min(256, Math.floor(len * 0.35));

function indexesOf(text: string, q: string, from: number, to: number): number[] {
  const out: number[] = [];
  let i = text.indexOf(q, from);
  while (i >= 0 && i + q.length <= to) {
    out.push(i);
    i = text.indexOf(q, i + 1);
  }
  return out;
}

// Weights follow Hypothesis' match-quote: quote 50, prefix and suffix 40, position 2.
function score(text: string, a: TextAnchor, c: { start: number; end: number; errors: number }) {
  const quote = Math.max(0, 1 - c.errors / Math.max(1, a.exact.length));
  const prefix = a.prefix ?? '';
  const suffix = a.suffix ?? '';
  const before = text.slice(Math.max(0, c.start - prefix.length), c.start);
  const after = text.slice(c.end, c.end + suffix.length);
  // An empty context (the start or end of the article) matches an empty context.
  const ps = !prefix && !before ? 1 : similarity(prefix, before);
  const ss = !suffix && !after ? 1 : similarity(suffix, after);
  const context = (ps + ss) / 2;
  const pos = a.pos === undefined ? 1 : 1 - Math.min(1, Math.abs(c.start - a.pos) / Math.max(1, text.length));
  return { quote, context, score: (50 * quote + 40 * context + 2 * pos) / 92 };
}

/** 1 − normalized Levenshtein distance, for short strings (context windows). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const n = a.length;
  const m = b.length;
  if (!n || !m) return 0;
  let prev = new Uint16Array(m + 1);
  let cur = new Uint16Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    for (let j = 1; j <= m; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return 1 - prev[m] / Math.max(n, m);
}
