import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDoc } from './doc';
import { holds, polityMembers, worldMembers } from './polities';
import type { Relation, Territory, TimelineItem } from './types';

const doc = parseDoc(readFileSync(new URL('../../tests/fixtures/greece/classical-greece.json', import.meta.url), 'utf8'));
const M = polityMembers(doc);

describe('polityMembers', () => {
  it('puts the Peloponnesian War in both Athens and Sparta, through the connections naming them', () => {
    expect(M.get('t_athens')).toContain('i_pelop');
    expect(M.get('t_sparta')).toContain('i_pelop');
    expect(M.get('t_persia')).not.toContain('i_pelop');
  });

  it('puts the silver strike at Laurion in Athens, whose borders hold Laurion that year', () => {
    expect(M.get('t_athens')).toContain('i_laurion');
    expect(M.get('t_sparta')).not.toContain('i_laurion');
  });

  it('gives a battle with nothing of its own the polities of the war it is part of', () => {
    const it = (id: string, extra: Partial<TimelineItem> = {}): TimelineItem => ({ id, kind: 'event', title: id, categoryId: 'c', start: { y: -420 }, updatedAt: 0, ...extra } as TimelineItem);
    const t = (id: string, itemId?: string): Territory => ({ id, title: id, categoryId: 'c', snapshots: [{ from: { y: -500 } }], itemId, updatedAt: 0 });
    const rel = (fromId: string, type: Relation['type'], toId: string): Relation => ({ id: `${fromId}-${toId}`, fromId, toId, type, updatedAt: 0 });
    const m = polityMembers({
      items: [it('war', { kind: 'span', end: { y: -404 } }), it('battle'), it('law'), it('athens-entry')],
      territories: [t('athens', 'athens-entry'), t('sparta')],
      relations: [rel('athens', 'related', 'war'), rel('war', 'related', 'sparta'), rel('battle', 'part-of', 'war'), rel('law', 'part-of', 'athens-entry')],
    });
    expect(m.get('athens')).toEqual(['war', 'battle', 'law']);
    expect(m.get('sparta')).toEqual(['war', 'battle']);
  });

  it('reads holes in borders', () => {
    const square = (a: number, b: number) => [[a, a], [b, a], [b, b], [a, b], [a, a]];
    expect(holds({ type: 'Polygon', coordinates: [square(0, 10)] }, 5, 5)).toBe(true);
    expect(holds({ type: 'Polygon', coordinates: [square(0, 10), square(4, 6)] }, 5, 5)).toBe(false);
    expect(holds({ type: 'MultiPolygon', coordinates: [[square(0, 1)], [square(20, 30)]] }, 25, 25)).toBe(true);
  });
});

describe('worldMembers', () => {
  it('holds what is connected to a world event', () => {
    const ids = worldMembers('i_alexander_persia', doc);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).not.toContain('i_alexander_persia');
  });
});
