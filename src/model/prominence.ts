import type { Highlight, Note, Relation, TimelineItem } from './types';

/** The weights Bob kept in the overview prototype (docs/design.md, Long range). */
export const WEIGHTS = { highlight: 3, connection: 2, note: 2, shown: 10, world: 20 } as const;

/**
 * Prominence, from Bob's own work: highlights × 3 + connections × 2 + notes × 2, plus 10 for
 * "Show in the overview" (20 for a world event). It decides the overview's top row, which
 * entry leads a cluster, and which labels win when they collide.
 */
export function prominence(doc: { items: TimelineItem[]; highlights: Highlight[]; relations: Relation[]; notes: Note[] }): (id: string) => number {
  const score = new Map<string, number>();
  const add = (id: string, v: number) => score.set(id, (score.get(id) ?? 0) + v);
  for (const h of doc.highlights) for (const id of h.usedBy) add(id, WEIGHTS.highlight);
  for (const r of doc.relations) { add(r.fromId, WEIGHTS.connection); add(r.toId, WEIGHTS.connection); }
  for (const n of doc.notes) for (const id of n.linkedIds) add(id, WEIGHTS.note);
  for (const i of doc.items) if (i.overview) add(i.id, i.overview === 'world' ? WEIGHTS.world : WEIGHTS.shown);
  return (id) => score.get(id) ?? 0;
}
