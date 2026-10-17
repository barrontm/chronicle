import { draftFromWikipedia } from '../../media/wikipedia';
import { newId, validateItem } from '../../model/doc';
import type { Provenance, Source, TimelineDoc } from '../../model/types';
import type { DraftConnection, DraftEntry, DraftSet } from '../draft';
import type { CheckedProposal } from './validate';

/**
 * Turn Claude's checked choice of pages into draft records. Every fact comes
 * from Wikipedia and Wikidata through the same path as Add from Wikipedia:
 * kind and dates, places (so coordinates come from the gazetteer, never the
 * model), the picture, the quoted intro and the cited page.
 */
export async function toDraft(args: {
  proposal: CheckedProposal;
  doc: TimelineDoc;
  request: string;
  provenance: Provenance;
  today: string;
  signal?: AbortSignal;
}): Promise<DraftSet> {
  const { proposal, doc, provenance, today, signal } = args;
  const dropped = [...proposal.dropped];
  const catIds = new Set(doc.categories.map((c) => c.id));
  const pageToId = new Map<string, string>();
  const entries: DraftEntry[] = [];
  const known: Source[] = [...doc.sources];

  // A few at a time, so Wikipedia isn't flooded and the order stays Claude's.
  const results: Array<Awaited<ReturnType<typeof draftFromWikipedia>> | Error> = [];
  for (let i = 0; i < proposal.entries.length; i += 4) {
    const batch = proposal.entries.slice(i, i + 4);
    results.push(...await Promise.all(batch.map((e) => draftFromWikipedia(e.page, {
      existingItems: doc.items, existingSources: known, categoryId: e.categoryId, today, signal,
    }).catch((err: Error) => {
      if (err.name === 'AbortError') throw err;
      return err;
    }))));
  }

  const qids = new Set<string>();
  proposal.entries.forEach((e, i) => {
    const r = results[i];
    const name = e.page.replace(/_/g, ' ');
    if (r instanceof Error) { dropped.push(`“${name}”: couldn’t read it from Wikipedia (${r.message}).`); return; }
    if ('duplicateOf' in r) {
      pageToId.set(e.page, r.duplicateOf);
      dropped.push(`“${doc.items.find((it) => it.id === r.duplicateOf)?.title ?? name}”: already on your timeline.`);
      return;
    }
    const { item, newSources, highlight } = r.draft;
    if (item.wikidataId && qids.has(item.wikidataId)) { dropped.push(`“${item.title}”: the same thing as another entry in this draft.`); return; }
    if (item.wikidataId) qids.add(item.wikidataId);
    item.drafted = provenance;
    pageToId.set(e.page, item.id);
    entries.push({ item, newSources, ...(highlight ? { highlight } : {}), why: e.why, problems: problemsOf(item, catIds), status: 'pending' });
  });

  const connections: DraftConnection[] = [];
  for (const c of proposal.connections) {
    const fromId = pageToId.get(c.from) ?? (doc.items.some((i) => i.id === c.from) ? c.from : undefined);
    const toId = pageToId.get(c.to) ?? (doc.items.some((i) => i.id === c.to) ? c.to : undefined);
    if (!fromId || !toId || fromId === toId) continue;
    if (doc.relations.some((r) => r.fromId === fromId && r.toId === toId && r.type === c.type)) continue;
    connections.push({ relation: { id: newId('r'), fromId, toId, type: c.type, drafted: provenance, updatedAt: 0 }, status: 'pending' });
  }

  return { feature: 'entries', request: args.request, provenance, entries, connections, dropped };
}

function problemsOf(item: DraftEntry['item'], catIds: Set<string>): string[] {
  if (!item.start) return ['Wikidata has no date for it. Edit it to add one.'];
  return validateItem(item, catIds);
}
