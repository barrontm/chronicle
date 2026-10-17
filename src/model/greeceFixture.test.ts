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
      if (i.excerpt) expect(sources.has(i.excerpt.sourceId)).toBe(true);
    }
  });

  it('has Athens’ league growing and shrinking, and Sparta losing Messenia', () => {
    const areaAt = (id: string, y: number) => doc.territories.find((t) => t.id === id)!.snapshots.filter((s) => y >= s.from.y && (!s.to || y < s.to.y)).length;
    expect(areaAt('t_delian', -470)).toBe(1);
    expect(areaAt('t_delian', -420)).toBe(1);
    expect(areaAt('t_delian', -400)).toBe(0);
    expect(areaAt('t_sparta', -400)).toBe(1);
    expect(areaAt('t_sparta', -300)).toBe(1);
  });

  it('keeps the shapes the schema lacks in the sidecar, tied to real entries', () => {
    const ids = new Set(doc.items.map((i) => i.id));
    expect(next.regimes.athens.length).toBeGreaterThanOrEqual(8);
    expect(next.regimes.sparta).toHaveLength(1);
    expect(next.economy.athens.snapshots.length).toBeGreaterThanOrEqual(5);
    expect(next.war.routes.length).toBeGreaterThan(15);
    for (const h of next.highlights) if (h.itemId) expect([h.id, ids.has(h.itemId)]).toEqual([h.id, true]);
  });
});
