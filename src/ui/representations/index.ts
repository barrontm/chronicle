import type { ItemKind, SubjectKind, TimelineItem } from '../../model/types';
import { battle } from './battle';
import { economy } from './economy';
import { event } from './event';
import { idea } from './idea';
import { migration } from './migration';
import { period } from './period';
import { person } from './person';
import { place } from './place';
import { polity } from './polity';
import { technology } from './technology';
import type { Representation } from './types';
import { war } from './war';
import { work } from './work';

export type { Representation } from './types';
export { warOf } from './war';
export { makerOf } from './work';

/** One representation per kind of thing. Two kinds never share a glyph (docs/design.md). */
export const REPRESENTATIONS: Record<SubjectKind, Representation> = {
  person, polity, period, war, battle, event, idea, technology, economy, work, place, migration,
};

/** What an entry with no kind of thing draws as: its `kind`, as the timeline always has. */
const BY_KIND: Record<ItemKind, SubjectKind> = { event: 'event', span: 'period', person: 'person' };

export function representationOf(item: Pick<TimelineItem, 'kind' | 'subject'>): Representation {
  return REPRESENTATIONS[item.subject ?? BY_KIND[item.kind]];
}

/** The timeline's mark: a moment (any entry with one date), a life, or a span. Rows hold one of these each. */
export function markOf(item: Pick<TimelineItem, 'kind' | 'subject'>): 'event' | 'span' | 'person' {
  if (item.kind === 'event') return 'event';
  return representationOf(item).bar === 'life' ? 'person' : 'span';
}
