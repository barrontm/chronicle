import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatYear, toAstronomical } from '../model/dates';
import { bordersFor, seshatBordersFor } from './basemaps';
import { matchCliopatria, type CliopatriaIndex } from './cliopatria';

// A slice of the real build (Cliopatria v0.2.1): the polities around Classical Greece, two with their files.
const fixture = (name: string) => readFileSync(new URL(`../../tests/fixtures/cliopatria/${name}`, import.meta.url), 'utf8');
const index = JSON.parse(fixture('index.json')) as CliopatriaIndex;
const bce = (y: number) => ({ y: toAstronomical(y, 'BCE') });

describe('matching a polity in Cliopatria', () => {
  it('finds Achaemenid Persia and Macedon by Wikidata id, whatever they are called', () => {
    expect(matchCliopatria(index, { wikidataId: 'Q389688', names: ['Achaemenid Persia'] }, bce(550), bce(330))?.id).toBe('achaemenid-empire');
    // Macedon is in Cliopatria twice, alone and as the group it led; the polity itself wins.
    expect(matchCliopatria(index, { wikidataId: 'Q83958', names: ['Macedon'] }, bce(808), bce(168))?.id).toBe('macedonian-empire');
  });

  it('has none of the Greek city-states: Sparta, Athens, Corinth and Thebes are one "Greek City-States"', () => {
    for (const [qid, name] of [['Q5690', 'Sparta'], ['Q844930', 'Classical Athens'], ['Q1074997', 'Corinth'], ['Q1290563', 'Thebes']]) {
      expect(matchCliopatria(index, { wikidataId: qid, titles: [name], names: [name] }, bce(900), bce(146))).toBeUndefined();
    }
  });

  it('falls back on the Wikipedia title, then the name', () => {
    expect(matchCliopatria(index, { titles: ['Odrysian_kingdom'], names: [] }, bce(480), bce(340))?.id).toBe('odrysian-kingdom');
    expect(matchCliopatria(index, { names: ['the Peloponnesian league'] }, bce(550), bce(366))?.id).toBe('peloponnesian-league');
  });

  it('only counts polities with borders in its years', () => {
    // Assyria and modern Syria share a Wikidata id in Cliopatria.
    expect(matchCliopatria(index, { wikidataId: 'Q41137', names: [] }, bce(1500), bce(900))?.name).toBe('Assyria');
    expect(matchCliopatria(index, { wikidataId: 'Q41137', names: [] }, { y: 1980 })?.name).toBe('Syria');
    expect(matchCliopatria(index, { wikidataId: 'Q389688', names: [] }, { y: 100 })).toBeUndefined();
    // Two Antigonid rows share an id; the one with more years in common wins.
    expect(matchCliopatria(index, { wikidataId: 'Q237325', names: [] }, bce(306), bce(168))?.name).toBe('Antigonid Macedonia');
  });
});

describe('borders from Seshat', () => {
  afterEach(() => vi.unstubAllGlobals());
  const serve = (basemap?: object) => vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/data/borders/')) {
      try { return new Response(fixture(url.split('/').pop()!)); } catch { return new Response('missing', { status: 404 }); }
    }
    return basemap ? Response.json(basemap) : new Response('down', { status: 503 });
  }));

  // First, before the index and maps are kept for the session.
  it('says why when neither can be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    await expect(bordersFor({ names: ['Sparta'] }, bce(500), bce(400))).rejects.toThrow('Seshat’s borders couldn’t be loaded (503)');
  });

  it('gives Macedon its own snapshots, in historian’s years, cut to its lifetime and credited', async () => {
    serve();
    const found = await seshatBordersFor({ wikidataId: 'Q83958', names: ['Macedon'] }, bce(600), bce(323));
    expect(found.name).toBe('Macedonian Empire');
    expect(found.source?.name).toBe('Cliopatria, Seshat Global History Databank (CC BY 4.0), simplified');
    const s = found.snapshots;
    // Cliopatria's 450–405 BCE row (inclusive) runs until 404 BCE, when the next one starts.
    expect(s.map((x) => formatYear(x.from.y))).toContain('450 BCE');
    expect(s.find((x) => formatYear(x.from.y) === '450 BCE')?.to).toEqual(bce(404));
    expect(formatYear(s[0].from.y)).toBe('600 BCE');
    expect(s.at(-1)!.to).toEqual(bce(323));
    // Its borders grow with Alexander.
    expect(s.at(-1)!.areaKm2).toBeGreaterThan(50 * s[0].areaKm2!);
  });

  it('tries the historical maps when Seshat doesn’t have it', async () => {
    serve({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { NAME: 'Sparta' }, geometry: { type: 'Polygon', coordinates: [[[22, 36], [23, 36], [23, 37], [22, 36]]] } }] });
    const found = await bordersFor({ wikidataId: 'Q5690', titles: ['Sparta'], names: ['Sparta'] }, bce(500), bce(400));
    expect(found.name).toBe('Sparta');
    expect(found.source?.name).toContain('historical-basemaps');
    expect(found.snapshots.length).toBeGreaterThan(0);
  });
});
