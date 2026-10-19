import { LANES, type Highlight, type Lane, type SubjectKind, type TimelineDoc, type TimelineItem } from './types';

/**
 * Which of the six lanes an entry sits in (v9): Bob's lanes win; else its kind of thing says
 * (a war is War, an idea Philosophy and religion); else the lanes of the highlights it uses.
 * An entry can be in several. None means it waits for Bob, or a highlight, to place it.
 */

/** The lane a kind of thing belongs to, when Bob hasn't said. Disaster → nature joins in Phase 5d. */
const LANE_OF_SUBJECT: Partial<Record<SubjectKind, Lane>> = {
  war: 'war', battle: 'war', polity: 'politics', economy: 'economy', idea: 'ideas', work: 'ideas', technology: 'technology',
};

/** Lanes in pigment order, each once. */
export function sortLanes(lanes: Iterable<Lane>): Lane[] {
  const set = new Set(lanes);
  return LANES.filter((l) => set.has(l));
}

function lanesFrom(entry: TimelineItem, highlights: readonly Highlight[]): Lane[] {
  if (entry.lanes?.length) return sortLanes(entry.lanes);
  const bySubject = entry.subject && LANE_OF_SUBJECT[entry.subject];
  if (bySubject) return [bySubject];
  return sortLanes(highlights.flatMap((h) => h.lanes ?? []));
}

export function lanesOf(entry: TimelineItem, doc: Pick<TimelineDoc, 'highlights'>): Lane[] {
  return lanesFrom(entry, doc.highlights.filter((h) => h.usedBy.includes(entry.id)));
}

/** `lanesOf` for many entries at once, for the timeline. Entries in no lane are left out. */
export function entryLanes(items: readonly TimelineItem[], highlights: readonly Highlight[]): Map<string, Lane[]> {
  const used = new Map<string, Highlight[]>();
  for (const h of highlights) for (const id of h.usedBy) used.set(id, [...(used.get(id) ?? []), h]);
  const out = new Map<string, Lane[]>();
  for (const it of items) {
    const lanes = lanesFrom(it, used.get(it.id) ?? []);
    if (lanes.length) out.set(it.id, lanes);
  }
  return out;
}
