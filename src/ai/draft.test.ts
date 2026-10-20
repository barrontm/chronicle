import { describe, expect, it } from 'vitest';
import { createEmptyDoc, upsert } from '../model/doc';
import type { Highlight, TimelineDoc, TimelineItem } from '../model/types';
import { acceptConnection, acceptEntry, addBecoming, pendingOnTimeline, statusIn, undoBecoming, undoConnection, undoEntry, waiting, type DraftConnection, type DraftEntry, type DraftSet } from './draft';

const item = (id: string, over: Partial<TimelineItem> = {}): TimelineItem => ({ id, kind: 'event', title: id, start: { y: -448 }, categoryId: 'politics', updatedAt: 0, ...over });
const highlight: Highlight = { id: 'h1', sourceId: 's1', text: 'In 449 BC Pericles proposed a decree.', lanes: ['economy', 'politics'], usedBy: ['i_old'], updatedAt: 1 };

function setup() {
  let doc: TimelineDoc = createEmptyDoc();
  doc = upsert(doc, 'items', item('i_delian', { kind: 'span' }), 1);
  doc = upsert(doc, 'highlights', highlight, 1);
  const decree: DraftEntry = { item: item('i_decree'), newSources: [], why: '', problems: [], quote: 'In 449 BC', status: 'pending' };
  const funded: DraftConnection = { relation: { id: 'r1', fromId: 'i_delian', toId: 'i_decree', type: 'caused', effect: 'funded', highlightIds: [], updatedAt: 0 }, status: 'pending' };
  const set: DraftSet = { feature: 'highlight', request: highlight.text, provenance: { model: 'm', prompt: 'highlight@3', draftedAt: 1 }, highlightId: 'h1', entries: [decree], connections: [funded], dropped: [] };
  return { doc, decree, funded, set };
}

describe('accepting drafts from a highlight', () => {
  it('adds the records to the highlight’s usedBy, cites it on the connection, and lends the entry its lanes', () => {
    const { doc, decree, funded, set } = setup();
    expect(waiting(doc, set)).toBe(2);
    let d = acceptEntry(doc, decree, 5, 'h1');
    d = acceptConnection(d, funded, 5, 'h1');
    expect(d.items.find((i) => i.id === 'i_decree')?.lanes).toEqual(['economy', 'politics']);
    expect(d.relations[0]).toMatchObject({ effect: 'funded', highlightIds: ['h1'] });
    expect(d.highlights[0].usedBy).toEqual(['i_old', 'i_decree', 'r1']);
    expect(waiting(d, set)).toBe(0);
    expect(statusIn(d, decree)).toBe('accepted');
  });

  it('accepts twice without listing a record twice', () => {
    const { doc, decree, set } = setup();
    const d = acceptEntry(acceptEntry(doc, decree, 5, set.highlightId), decree, 6, set.highlightId);
    expect(d.highlights[0].usedBy).toEqual(['i_old', 'i_decree']);
  });

  it('keeps an entry’s own lanes', () => {
    const { doc, decree } = setup();
    const d = acceptEntry(doc, { ...decree, item: { ...decree.item, lanes: ['war'] } }, 5, 'h1');
    expect(d.items.find((i) => i.id === 'i_decree')?.lanes).toEqual(['war']);
  });

  it('undoing an entry takes its accepted connections with it, and the highlight lets go of both', () => {
    const { doc, decree, funded, set } = setup();
    let d = acceptConnection(acceptEntry(doc, decree, 5, 'h1'), funded, 5, 'h1');
    d = undoEntry(d, set, decree, 7);
    expect(d.items.map((i) => i.id)).toEqual(['i_delian']);
    expect(d.relations).toEqual([]);
    expect(d.highlights[0].usedBy).toEqual(['i_old']);
    expect(d.deleted).toMatchObject({ i_decree: 7, r1: 7 });
    expect(statusIn(d, decree)).toBe('pending');
    expect(waiting(d, set)).toBe(2);
  });

  it('undoing a connection leaves the entry', () => {
    const { doc, decree, funded } = setup();
    let d = acceptConnection(acceptEntry(doc, decree, 5, 'h1'), funded, 5, 'h1');
    d = undoConnection(d, funded, 7);
    expect(d.relations).toEqual([]);
    expect(d.highlights[0].usedBy).toEqual(['i_old', 'i_decree']);
    expect(undoConnection(d, funded, 8)).toBe(d);
  });

  it('counts rejected records as decided', () => {
    const { doc, decree, funded, set } = setup();
    const decided = { ...set, entries: [{ ...decree, status: 'rejected' as const }], connections: [{ ...funded, status: 'rejected' as const }] };
    expect(waiting(doc, decided)).toBe(0);
    expect(waiting(doc, null)).toBe(0);
  });
});

describe('drafts on the timeline', () => {
  it('shows what is still waiting: dated entries, and connections not made yet', () => {
    const { doc, decree, funded, set } = setup();
    const undated: DraftEntry = { ...decree, item: item('i_undated', { start: { y: NaN } }) };
    const rejected: DraftEntry = { ...decree, item: item('i_no'), status: 'rejected' };
    expect(pendingOnTimeline(doc, [{ ...set, entries: [decree, undated, rejected] }, null])).toEqual({ items: [decree.item], relations: [funded.relation] });
    const d = acceptConnection(acceptEntry(doc, decree, 5, 'h1'), funded, 5, 'h1');
    expect(pendingOnTimeline(d, [set])).toEqual({ items: [], relations: [] });
  });
});

describe('what a highlight becomes, ticked or filled in by hand', () => {
  it('links what Bob has, adds the new ones citing the highlight in its lanes, and connects them once both ends are there', () => {
    const { doc } = setup();
    const linked = { id: 'i_delian', relations: [{ id: 'r_a', fromId: 'i_delian', toId: 'i_mines', type: 'related' as const, updatedAt: 0 }] };
    const mines = item('i_mines', { kind: 'span', subject: 'place', start: undefined });
    const fleet = item('i_fleet', { lanes: ['war'] });
    const dangling = { id: 'r_b', fromId: 'i_fleet', toId: 'i_nowhere', type: 'caused' as const, updatedAt: 0 };
    const { doc: d, became } = addBecoming(doc, 'h1', { link: [linked, { id: 'i_old' }], add: [{ item: mines }, { item: fleet, relations: [dangling] }] }, 5);
    expect(d.highlights[0].usedBy).toEqual(['i_old', 'i_delian', 'i_mines', 'i_fleet']);
    expect(d.items.find((i) => i.id === 'i_mines')?.lanes).toEqual(['economy', 'politics']);
    expect(d.items.find((i) => i.id === 'i_fleet')?.lanes).toEqual(['war']); // its own lanes win
    expect(d.relations.map((r) => r.id)).toEqual(['r_a']);
    // i_old was already linked, so Undo leaves it.
    expect(became).toEqual({ highlightId: 'h1', added: ['i_mines', 'i_fleet'], linked: ['i_delian'], relations: ['r_a'] });

    const back = undoBecoming(d, became, 6);
    expect(back.items.map((i) => i.id)).toEqual(['i_delian']);
    expect(back.relations).toEqual([]);
    expect(back.highlights[0].usedBy).toEqual(['i_old']);
  });

  it('adds a polity with its territory, and Undo takes a new one away and puts back one Bob had', () => {
    const { doc } = setup();
    const sparta = item('i_sparta', { kind: 'span', subject: 'polity', wikidataId: 'Q5690' });
    const fresh = { id: 't_new', title: 'Sparta', categoryId: 'c', snapshots: [], itemId: 'i_sparta', updatedAt: 0 };
    const { doc: d, became } = addBecoming(doc, 'h1', { link: [], add: [{ item: sparta, territory: { next: fresh } }] }, 5);
    expect(d.territories.find((t) => t.id === 't_new')).toMatchObject({ itemId: 'i_sparta' });
    expect(became.territories).toEqual([{ next: fresh }]);
    expect(undoBecoming(d, became, 6).territories.map((t) => t.id)).toEqual([]);

    const had = { id: 't_had', title: 'Sparta', categoryId: 'c', snapshots: [{ from: { y: -500 } }], updatedAt: 1 };
    const withHad = { ...doc, territories: [had] };
    const taken = { next: { ...had, itemId: 'i_sparta', wikidataId: 'Q5690' }, before: had };
    const r = addBecoming(withHad, 'h1', { link: [], add: [{ item: sparta, territory: taken }] }, 5);
    expect(r.doc.territories[0]).toMatchObject({ itemId: 'i_sparta', wikidataId: 'Q5690' });
    const back = undoBecoming(r.doc, r.became, 6);
    expect(back.territories).toHaveLength(1);
    expect(back.territories[0]).toMatchObject({ id: 't_had', snapshots: had.snapshots });
    expect(back.territories[0].itemId).toBeUndefined();
    expect(back.territories[0].wikidataId).toBeUndefined();
  });
});
