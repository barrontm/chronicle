import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyUndo, bulkEdit, bulkRemove } from './bulk';
import { mergeDocs, parseDoc } from './doc';

const greece = () => parseDoc(readFileSync(new URL('../../tests/fixtures/greece/classical-greece.json', import.meta.url), 'utf8'));
const item = (d: ReturnType<typeof greece>, id: string) => d.items.find((i) => i.id === id);

describe('bulkEdit', () => {
  it('sets only the fields asked for, on every entry picked', () => {
    const doc = greece();
    const { doc: next, changed } = bulkEdit(doc, ['i_marathon', 'i_pericles', 'i_classical'], { lanes: ['nature', 'economy'], overview: 'shown' }, 5);
    expect(changed).toBe(3);
    expect(item(next, 'i_marathon')!.lanes).toEqual(['economy', 'nature']);
    expect(item(next, 'i_pericles')!.overview).toBe('shown');
    // Left alone: the category, the title, the dates.
    expect(item(next, 'i_marathon')!.categoryId).toBe('war');
    expect(item(next, 'i_pericles')!.title).toBe('Pericles');
    expect(item(next, 'i_salamis')).toBe(item(doc, 'i_salamis'));
  });
  it('gives a region to the periods only, and empty lanes mean automatic', () => {
    const doc = greece();
    const { doc: next } = bulkEdit(doc, ['i_marathon', 'i_classical'], { region: ' Aegean ', lanes: [] });
    expect(item(next, 'i_classical')!.region).toBe('Aegean');
    expect(item(next, 'i_marathon')!.region).toBeUndefined();
    expect(item(next, 'i_marathon')!.lanes).toBeUndefined();
  });
  it('leaves an entry that already has the fields untouched, and null takes them out of the overview', () => {
    const doc = bulkEdit(greece(), ['i_marathon'], { overview: 'world' }).doc;
    const same = bulkEdit(doc, ['i_marathon'], { categoryId: 'war' });
    expect(same.changed).toBe(0);
    expect(same.undo.saved).toEqual([]);
    expect(item(bulkEdit(doc, ['i_marathon'], { overview: null }).doc, 'i_marathon')!.overview).toBeUndefined();
  });
  it('undoes in one step', () => {
    const doc = greece();
    const { doc: next, undo } = bulkEdit(doc, ['i_marathon', 'i_salamis'], { categoryId: 'politics' }, 5);
    expect(undo.saved.map((s) => s.record.id).sort()).toEqual(['i_marathon', 'i_salamis']);
    const back = applyUndo(next, undo, 6);
    expect(item(back, 'i_marathon')!.categoryId).toBe('war');
    expect(item(back, 'i_salamis')!.categoryId).toBe('war');
  });
});

describe('bulkRemove', () => {
  it('deletes them with their connections, keeps the notes, and Undo brings everything back', () => {
    const doc = greece();
    const ids = ['i_salamis', 'i_pelop', 'i_thermopylae'];
    const { doc: next, undo, removed } = bulkRemove(doc, ids, 5);
    expect(removed).toBe(3);
    expect(next.items.some((i) => ids.includes(i.id))).toBe(false);
    expect(next.relations.some((r) => ids.includes(r.fromId) || ids.includes(r.toId))).toBe(false);
    expect(next.notes.length).toBe(doc.notes.length);
    for (const id of ids) expect(next.deleted[id]).toBe(5);

    const back = applyUndo(next, undo, 6);
    expect(back.items.length).toBe(doc.items.length);
    expect(back.relations.length).toBe(doc.relations.length);
    for (const id of ids) expect(back.deleted[id]).toBeUndefined();
    const linked = (d: typeof doc) => d.notes.filter((n) => n.linkedIds.some((x) => ids.includes(x))).length;
    expect(linked(back)).toBe(linked(doc));
    const used = (d: typeof doc) => d.highlights.filter((h) => h.usedBy.some((x) => ids.includes(x))).length;
    expect(used(back)).toBe(used(doc));
  });
  it('an undone delete survives a merge with the copy from before', () => {
    const doc = greece();
    const { doc: next, undo } = bulkRemove(doc, ['i_pelop'], 5);
    const back = applyUndo(next, undo, 6);
    expect(item(mergeDocs(back, next), 'i_pelop')).toBeDefined();
  });
});
