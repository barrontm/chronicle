import { draftFromWikipedia, lookUpPlace } from '../../media/wikipedia';
import { newId, validateItem } from '../../model/doc';
import { CANT_ADD } from '../../model/passage';
import { findInChronicle, type Subject } from '../../model/subjects';
import type { Highlight, Provenance, Source, TimelineDoc, TimelineItem } from '../../model/types';
import type { DraftConnection, DraftEntry, DraftSet } from '../draft';
import type { CheckedHighlight, End } from './validate';

/**
 * Turn Claude's checked answer about a highlight into draft records. Entries
 * cite the article Bob read (its section as the locator), places come from
 * the gazetteer by name, and a linked page that a connection needs is drafted
 * from Wikipedia the same way as Add from Wikipedia. Every connection cites
 * the highlight.
 */
export async function toDraft(args: {
  checked: CheckedHighlight;
  highlight: Highlight;
  /** Page key → subject (when known) for the article's subject and the passage's links. */
  candidates: Map<string, Subject | undefined>;
  doc: TimelineDoc;
  provenance: Provenance;
  today: string;
  signal?: AbortSignal;
}): Promise<DraftSet> {
  const { checked, highlight, candidates, doc, provenance, today, signal } = args;
  const dropped = [...checked.dropped];
  const catIds = new Set(doc.categories.map((c) => c.id));
  const section = highlight.anchor?.section;
  const entries: DraftEntry[] = [];
  const refToId = new Map<string, string>();

  for (const e of checked.entries) {
    let places: TimelineItem['places'];
    if (e.place) {
      try {
        const hit = (await lookUpPlace(e.place, signal))[0];
        if (hit) places = [{ name: hit.name, lat: hit.lat, lon: hit.lon, role: 'site' }];
        else dropped.push(`“${e.title}”: couldn’t find ${e.place} on the map. Add the place yourself if you want a pin.`);
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
        dropped.push(`“${e.title}”: couldn’t look up ${e.place} (${(err as Error).message}).`);
      }
    }
    const item: TimelineItem = {
      id: newId('i'), kind: e.kind, title: e.title, start: e.start, ...(e.end ? { end: e.end } : {}),
      categoryId: e.categoryId,
      citations: [{ sourceId: highlight.sourceId, ...(section ? { locator: section } : {}) }],
      ...(places ? { places } : {}),
      drafted: provenance,
      updatedAt: 0,
    };
    refToId.set(e.ref, item.id);
    entries.push({ item, newSources: [], why: e.why, problems: validateItem(item, catIds), quote: e.quote, status: 'pending' });
  }

  // Linked pages a connection needs: Bob's entry for it, or a draft from Wikipedia (once each).
  const pageToId = new Map<string, string | Error>();
  const known: Source[] = [...doc.sources];
  const idForPage = async (page: string): Promise<string | Error> => {
    if (pageToId.has(page)) return pageToId.get(page)!;
    const subject = candidates.get(page);
    const have = subject && findInChronicle(doc.items, subject.qid);
    let out: string | Error;
    if (have) out = have.id;
    else if (subject?.kind && CANT_ADD[subject.kind]) out = new Error(CANT_ADD[subject.kind]!.split('.')[0] + '.');
    else {
      try {
        const r = await draftFromWikipedia(page, { existingItems: doc.items, existingSources: known, categoryId: categoryFor(subject, catIds), today, signal, subject });
        if ('duplicateOf' in r) out = r.duplicateOf;
        else {
          const { item, newSources } = r.draft;
          item.drafted = provenance;
          known.push(...newSources);
          entries.push({ item, newSources, why: 'The passage links it, and a connection needs it on your timeline.', problems: item.start ? validateItem(item, catIds) : ['Wikidata has no date for it. Edit it to add one.'], status: 'pending' });
          out = item.id;
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
        out = new Error(`couldn’t read it from Wikipedia (${(err as Error).message})`);
      }
    }
    pageToId.set(page, out);
    return out;
  };
  const idOf = async (end: End): Promise<string | Error> =>
    'item' in end ? end.item : 'ref' in end ? refToId.get(end.ref) ?? new Error('not drafted') : idForPage(end.page);

  const connections: DraftConnection[] = [];
  for (const c of checked.connections) {
    const ends = [c.from, c.to];
    const [fromId, toId] = [await idOf(c.from), await idOf(c.to)];
    const bad = [fromId, toId].findIndex((x) => x instanceof Error);
    if (bad >= 0) {
      const end = ends[bad];
      dropped.push(`A connection (${c.effect})${'page' in end ? ` with “${end.page.replace(/_/g, ' ')}”` : ''}: ${([fromId, toId][bad] as Error).message}`);
      continue;
    }
    if (fromId === toId) continue;
    if (doc.relations.some((r) => r.fromId === fromId && r.toId === toId && r.type === c.type)) continue;
    connections.push({
      relation: { id: newId('r'), fromId: fromId as string, toId: toId as string, type: c.type, effect: c.effect, highlightIds: [highlight.id], drafted: provenance, updatedAt: 0 },
      quote: c.quote,
      status: 'pending',
    });
  }

  return {
    feature: 'highlight', request: highlight.text, provenance, highlightId: highlight.id,
    ...(checked.dimension ? { dimension: checked.dimension } : {}),
    entries, connections, dropped,
  };
}

/** A category for a linked page drafted from Wikipedia: wars and battles under war, else the first. */
function categoryFor(s: Subject | undefined, catIds: Set<string>): string {
  if ((s?.kind === 'war' || s?.kind === 'battle') && catIds.has('war')) return 'war';
  return [...catIds][0] ?? 'politics';
}
