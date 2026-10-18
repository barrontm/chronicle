import type { Relation, TimelineItem } from '../../model/types';
import { N, S, type Representation } from './types';

/** A page with a folded corner: a point at its making, joined to its maker's lifeline. */
export const work: Representation = {
  kind: 'work',
  glyph: `<path d="M4 2h7l4 4v10H4z" ${N} ${S} stroke-width="1.6" stroke-linejoin="round"/><path d="M11 2v4h4" ${N} ${S} stroke-width="1.4" stroke-linejoin="round"/>`,
  point: 'glyph',
  bar: 'bar',
  badge: true,
};

type Dated = Pick<TimelineItem, 'id' | 'kind' | 'subject'> & { s: number; e: number };

/**
 * The lifeline each work is joined to: a person connected to it (either way, any kind of
 * connection), preferring one alive when it was made, then the first connected.
 */
export function makerOf(items: Dated[], relations: Relation[]): Map<string, string> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const life = (i: Dated | undefined) => !!i && i.kind === 'person' && (i.subject ?? 'person') === 'person';
  const out = new Map<string, string>();
  for (const w of items) {
    if (w.subject !== 'work') continue;
    const people = relations
      .flatMap((r) => (r.fromId === w.id ? [r.toId] : r.toId === w.id ? [r.fromId] : []))
      .map((id) => byId.get(id))
      .filter(life) as Dated[];
    const maker = people.find((p) => p.s <= w.s && w.s <= p.e) ?? people[0];
    if (maker) out.set(w.id, maker.id);
  }
  return out;
}
