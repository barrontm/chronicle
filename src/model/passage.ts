import { compareHistDate, parseHistDate } from './dates';
import { newId } from './doc';
import type { SubjectKind } from './subjects';
import type { Highlight, ItemKind, Lane, Place, Territory, TerritorySnapshot, TimelineItem } from './types';

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
};

const FIRST: SubjectKind[] = ['event', 'war', 'battle'];

/** A candidate as the tray sees it when choosing what to tick first. */
export interface Choice {
  kind?: SubjectKind;
  /** The highlight is already on Bob's record for it. */
  linked?: boolean;
  /** Bob ticked it last time (the highlight's `subjectQid`). */
  remembered?: boolean;
}

/**
 * The candidates ticked when a highlight opens (indexes, in order): the ones
 * it's already on; else the one Bob ticked last; else the first event, war or
 * battle the passage links; else the article's subject (index 0), unless it's
 * a kind that can't be added yet or a polity (most passages in a polity's
 * article are about something in it, and adding one reads the historical
 * maps). Bob ticks more or fewer from there.
 */
export function defaultChoices(cands: Choice[]): number[] {
  const linked = cands.flatMap((c, i) => (c.linked ? [i] : []));
  if (linked.length) return linked;
  const remembered = cands.findIndex((c, i) => i > 0 && c.remembered);
  if (remembered > 0) return [remembered];
  const first = cands.findIndex((c, i) => i > 0 && !!c.kind && FIRST.includes(c.kind));
  if (first > 0) return [first];
  const own = cands[0];
  return own && !(own.kind && (CANT_ADD[own.kind] || own.kind === 'polity')) ? [0] : [];
}

/** "Something else…": what Bob fills in by hand for a highlight. Dates as he types them. */
export interface OwnEntryForm {
  title: string;
  kind: ItemKind;
  start: string;
  end: string;
  lanes: Lane[];
  /** Where it happened, once found on the map. */
  place?: Place;
}

/**
 * An entry Bob fills in from a highlight, citing the article it's in (its
 * section as the locator), or what's wrong with the form, in his words.
 */
export function ownEntry(f: OwnEntryForm, h: Pick<Highlight, 'sourceId' | 'anchor'>, categoryId: string): { item: TimelineItem } | { problem: string } {
  const title = f.title.trim();
  if (!title) return { problem: 'Give it a title.' };
  if (!f.start.trim()) return { problem: f.kind === 'person' ? 'Give the year they were born.' : 'Give a date, such as 483 BCE.' };
  const start = parseHistDate(f.start);
  if (!start) return { problem: `Chronicle can’t read “${f.start.trim()}” as a date. Try 483 BCE or c. 450 BCE.` };
  const endText = f.kind === 'event' ? '' : f.end.trim();
  const end = endText ? parseHistDate(endText) : undefined;
  if (end === null) return { problem: `Chronicle can’t read “${endText}” as a date.` };
  if (f.kind === 'span' && !end) return { problem: 'A period needs an end date.' };
  if (end && compareHistDate(end, start) < 0) return { problem: 'It ends before it starts.' };
  const section = h.anchor?.section;
  return {
    item: {
      id: newId('i'), kind: f.kind, title, start, ...(end ? { end } : {}), categoryId,
      ...(f.lanes.length ? { lanes: [...f.lanes] } : {}),
      ...(f.place ? { places: [{ ...f.place, role: f.place.role ?? 'site' }] } : {}),
      citations: [{ sourceId: h.sourceId, ...(section ? { locator: section } : {}) }],
      updatedAt: 0,
    },
  };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The territory a polity entry already has: one with its Wikidata id, else one of Bob's with
 * its name that isn't another entry's yet (borders he imported before he had the entry).
 */
export function territoryOf(item: Pick<TimelineItem, 'id' | 'title' | 'wikidataId'>, territories: Territory[]): Territory | undefined {
  return territories.find((t) => t.itemId === item.id || (!!item.wikidataId && t.wikidataId === item.wikidataId))
    ?? territories.find((t) => !t.itemId && !t.wikidataId && sameName(t.title, item.title));
}

/**
 * A polity added from the tray is its entry (the lifespan bar) and its territory (the map's
 * half), tied by `itemId` and the article's Wikidata id. A territory Bob already has is taken
 * over, keeping its borders; otherwise a new one gets the borders found, or none yet.
 */
export function polityTerritory(
  item: TimelineItem, territories: Territory[], snapshots: TerritorySnapshot[] = [], source?: Territory['source'],
): { next: Territory; before?: Territory } {
  const had = territoryOf(item, territories);
  if (had) {
    return { before: had, next: {
      ...had, itemId: had.itemId ?? item.id,
      ...(had.wikidataId || !item.wikidataId ? {} : { wikidataId: item.wikidataId }),
      ...(had.region || !item.region ? {} : { region: item.region }),
      ...(had.snapshots.length || !snapshots.length ? {} : { snapshots, ...(source ? { source } : {}) }),
    } };
  }
  return { next: {
    id: newId('t'), title: item.title, categoryId: item.categoryId, snapshots, itemId: item.id,
    ...(item.wikidataId ? { wikidataId: item.wikidataId } : {}),
    ...(item.region ? { region: item.region } : {}),
    ...(snapshots.length && source ? { source } : {}),
    updatedAt: 0,
  } };
}
