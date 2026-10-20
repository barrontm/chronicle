import { describe, expect, it } from 'vitest';
import type { Highlight, Note, Relation, TimelineItem } from './types';
import { prominence } from './prominence';

const hl = (id: string, usedBy: string[]): Highlight => ({ id, sourceId: 's', text: 't', usedBy, updatedAt: 0 });
const rel = (fromId: string, toId: string): Relation => ({ id: `${fromId}-${toId}`, fromId, toId, type: 'related', updatedAt: 0 });
const note = (linkedIds: string[]): Note => ({ id: 'n', title: 'n', body: '', linkedIds, updatedAt: 0 });
const item = (id: string, overview?: 'shown' | 'world') => ({ id, kind: 'event', title: id, categoryId: 'c', overview, updatedAt: 0 }) as TimelineItem;

describe('prominence', () => {
  it('weighs highlights × 3, connections × 2, notes × 2, and the overview mark', () => {
    const p = prominence({
      items: [item('pericles', 'shown'), item('war', 'world'), item('plain')],
      highlights: [hl('a', ['pericles']), hl('b', ['pericles', 'war']), hl('c', [])],
      relations: [rel('pericles', 'war')],
      notes: [note(['war'])],
    });
    expect(p('pericles')).toBe(2 * 3 + 2 + 10);
    expect(p('war')).toBe(3 + 2 + 2 + 20);
    expect(p('plain')).toBe(0);
    expect(p('nobody')).toBe(0);
  });
});
