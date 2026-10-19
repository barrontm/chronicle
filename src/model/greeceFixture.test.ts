import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDoc } from './doc';

const read = (name: string) => readFileSync(new URL(`../../tests/fixtures/greece/${name}`, import.meta.url), 'utf8');
const doc = parseDoc(read('classical-greece.json'));
const next = JSON.parse(read('next.json'));

describe('Classical Greece fixture', () => {
  it('imports and is rich enough to try the redesign on', () => {
    expect(doc.items.length).toBeGreaterThanOrEqual(150);
    expect(new Set(doc.items.map((i) => i.id)).size).toBe(doc.items.length);
    expect(doc.items.filter((i) => i.kind === 'person').length).toBeGreaterThan(30);
    expect(doc.items.filter((i) => i.tags?.includes('era')).length).toBeGreaterThan(3);
    expect(doc.items.filter((i) => i.places?.length).length).toBeGreaterThan(50);
    expect(doc.territories.length).toBeGreaterThanOrEqual(6);
    expect(doc.flows.length).toBeGreaterThanOrEqual(1);
  });

  it('points every connection, note link and citation at something that exists', () => {
    const ids = new Set([...doc.items, ...doc.series, ...doc.territories].map((x) => x.id));
    const sources = new Set(doc.sources.map((s) => s.id));
    for (const r of doc.relations) expect([r.id, ids.has(r.fromId), ids.has(r.toId)]).toEqual([r.id, true, true]);
    for (const n of doc.notes) for (const id of n.linkedIds) expect([n.id, ids.has(id)]).toEqual([n.id, true]);
    for (const i of doc.items) {
      for (const c of i.citations ?? []) expect([i.id, sources.has(c.sourceId)]).toEqual([i.id, true]);
    }
    for (const h of doc.highlights) expect([h.id, sources.has(h.sourceId)]).toEqual([h.id, true]);
  });

  it('has Athens’ league growing and shrinking, and Sparta losing Messenia', () => {
    const areaAt = (id: string, y: number) => doc.territories.find((t) => t.id === id)!.snapshots.filter((s) => y >= s.from.y && (!s.to || y < s.to.y)).length;
    expect(areaAt('t_delian', -470)).toBe(1);
    expect(areaAt('t_delian', -420)).toBe(1);
    expect(areaAt('t_delian', -400)).toBe(0);
    expect(areaAt('t_sparta', -400)).toBe(1);
    expect(areaAt('t_sparta', -300)).toBe(1);
  });

  it('keeps the shapes the schema lacks in the sidecar', () => {
    expect(next.regimes.athens.length).toBeGreaterThanOrEqual(8);
    expect(next.regimes.sparta).toHaveLength(1);
    expect(next.economy.athens.snapshots.length).toBeGreaterThanOrEqual(5);
    expect(next.war.routes.length).toBeGreaterThan(15);
  });

  it('holds v9’s shapes: lanes, the overview mark, strength, regions, a group and who took part in what', () => {
    expect(doc.items.filter((i) => i.lanes?.length).length).toBeGreaterThan(140);
    expect(doc.highlights.filter((h) => h.lanes?.length).length).toBeGreaterThan(40);
    expect(doc.items.find((i) => i.id === 'i_alexander_persia')?.overview).toBe('world');
    const athens = doc.territories.find((t) => t.id === 't_athens')!;
    expect(athens.region).toBe('Greece');
    expect(athens.strength?.map((s) => s.level)).toContain(5);
    expect(doc.regionParents?.Macedon).toBe('Mediterranean');
    expect(doc.groups?.[0].territoryIds).toEqual(['t_athens', 't_sparta', 't_corinth', 't_thebes']);
    const pelop = doc.relations.filter((r) => r.toId === 'i_pelop' && r.side);
    expect(pelop.find((r) => r.fromId === 't_athens')?.side).toBe(1);
    expect(pelop.find((r) => r.fromId === 't_sparta')?.side).toBe(2);
  });

  it('has its eras in the Greece row, with highlights on the entries they support', () => {
    const ids = new Set(doc.items.map((i) => i.id));
    expect(doc.items.filter((i) => i.subject === 'period' && i.region === 'Greece').map((i) => i.id)).toContain('i_classical');
    expect(doc.highlights.length).toBeGreaterThanOrEqual(40);
    for (const h of doc.highlights) {
      for (const id of h.usedBy) expect([h.id, ids.has(id)]).toEqual([h.id, true]);
    }
    const hids = new Set(doc.highlights.map((h) => h.id));
    for (const t of doc.items.find((i) => i.id === 'i_classical')!.themes ?? []) for (const h of t.highlightIds) expect([t.id, hids.has(h)]).toEqual([t.id, true]);
  });
});
