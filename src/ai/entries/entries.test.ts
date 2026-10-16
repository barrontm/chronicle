import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { replayFetch, type Recording } from '../../../tests/ai-evals/replay';
import { createEmptyDoc, parseDoc, serializeDoc } from '../../model/doc';
import type { TimelineDoc } from '../../model/types';
import { AiError } from '../client';
import { acceptConnection, acceptEntry, canAcceptConnection, pendingWithPlaces, promptId } from '../draft';
import { draftEntries, PROMPT_ID, userMessage } from './index';
import { checkProposal } from './validate';

const recording: Recording = JSON.parse(readFileSync(new URL('../../../tests/ai-evals/entries/recordings/handmade-persian-wars.json', import.meta.url), 'utf8'));

const ctx = (over: Partial<Parameters<typeof checkProposal>[1]> = {}) => ({
  seenPages: new Map([['Battle_of_Marathon', 'Battle of Marathon'], ['Greco-Persian_Wars', 'Greco-Persian Wars']]),
  categoryIds: new Set(['war', 'politics']),
  existing: new Map([['i_pelop', 'Peloponnesian War'], ['i_plato', 'Plato']]),
  ...over,
});

describe('checkProposal', () => {
  it('keeps pages Claude found and drops ones it never searched for', () => {
    const r = checkProposal({
      entries: [
        { page: 'Battle of Marathon', category: 'war', why: 'a' },
        { page: 'Battle_of_Marathon', category: 'war', why: 'again' },
        { page: 'Battle_of_Atlantis', category: 'war', why: 'b' },
      ],
      connections: [],
    }, ctx());
    expect(r.entries).toEqual([{ page: 'Battle_of_Marathon', categoryId: 'war', why: 'a' }]);
    expect(r.dropped).toEqual(['“Battle of Atlantis”: not a page Claude found by searching, so it may not exist.']);
  });

  it('falls back to a real category', () => {
    expect(checkProposal({ entries: [{ page: 'Battle_of_Marathon', category: 'sport', why: '' }], connections: [] }, ctx()).entries[0].categoryId).toBe('war');
  });

  it('caps the number of entries', () => {
    const r = checkProposal({ entries: [{ page: 'Battle_of_Marathon', category: 'war', why: '' }, { page: 'Greco-Persian_Wars', category: 'war', why: '' }], connections: [] }, ctx({ maxEntries: 1 }));
    expect(r.entries).toHaveLength(1);
    expect(r.dropped[0]).toMatch(/more than 1 entries/);
  });

  it('keeps connections between new and existing entries only', () => {
    const r = checkProposal({
      entries: [{ page: 'Battle_of_Marathon', category: 'war', why: '' }, { page: 'Greco-Persian_Wars', category: 'war', why: '' }],
      connections: [
        { from: 'Battle of Marathon', to: 'Greco-Persian_Wars', type: 'part-of' },
        { from: 'Battle_of_Marathon', to: 'Greco-Persian_Wars', type: 'part-of' },
        { from: 'Greco-Persian_Wars', to: 'i_pelop', type: 'caused' },
        { from: 'i_plato', to: 'i_pelop', type: 'related' },
        { from: 'Battle_of_Marathon', to: 'Battle_of_Marathon', type: 'related' },
        { from: 'Battle_of_Marathon', to: 'Battle_of_Troy', type: 'related' },
        { from: 'Battle_of_Marathon', to: 'i_pelop', type: 'conquered' },
      ],
    }, ctx());
    expect(r.connections).toEqual([
      { from: 'Battle_of_Marathon', to: 'Greco-Persian_Wars', type: 'part-of' },
      { from: 'Greco-Persian_Wars', to: 'i_pelop', type: 'caused' },
    ]);
    expect(r.dropped).toEqual(['A connection from “Battle of Marathon” to “Battle of Troy”: one end isn’t in the draft or on your timeline.']);
  });

  it('survives a malformed answer', () => {
    expect(checkProposal('nonsense', ctx()).dropped).toHaveLength(1);
    expect(checkProposal({ entries: [null, 3, { page: '' }] }, ctx()).entries).toEqual([]);
  });
});

describe('prompt versions', () => {
  it('reads the version line', () => {
    expect(promptId('entries', 'Version: 7\n\nHello')).toBe('entries@7');
    expect(() => promptId('entries', 'Hello')).toThrow();
    expect(PROMPT_ID).toMatch(/^entries@\d+$/);
  });
});

describe('userMessage', () => {
  it('lists existing entries so Claude can skip and connect to them', () => {
    const doc = { ...createEmptyDoc(), items: [{ id: 'i_1', kind: 'event' as const, title: 'Marathon', start: { y: -489 }, categoryId: 'war', updatedAt: 0 }] };
    expect(userMessage(' Persian Wars ', doc)).toContain("Bob's request: Persian Wars");
    expect(userMessage('x', doc)).toContain('i_1 | Marathon');
  });
});

describe('draftEntries (replayed)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const run = async (doc: TimelineDoc) => {
    const fetch = replayFetch(recording);
    vi.stubGlobal('fetch', fetch);
    return draftEntries({ request: 'The main battles of the Greco-Persian Wars', doc, apiKey: 'sk-ant-test', today: '2026-10-16', now: 42, fetch });
  };

  it('drafts entries with facts from Wikipedia and provenance', async () => {
    const set = await run(createEmptyDoc());
    expect(set.entries.map((e) => e.item.title)).toEqual(['Greco-Persian Wars', 'Battle of Marathon', 'Battle of Salamis']);
    const marathon = set.entries[1].item;
    expect(marathon).toMatchObject({ kind: 'event', start: { y: -489 }, categoryId: 'war', wikidataId: 'Q99999920', drafted: { model: 'claude-opus-5-5', prompt: PROMPT_ID, draftedAt: 42 } });
    expect(marathon.places).toEqual([{ name: 'Battle of Marathon', lat: 38.118, lon: 23.978, role: 'site' }]);
    expect(set.entries[0].item).toMatchObject({ kind: 'span', start: { y: -498 }, end: { y: -448 } });
    expect(set.entries.every((e) => !e.problems.length && e.newSources.length === 1)).toBe(true);
    expect(set.dropped).toEqual(['“Battle of Atlantis”: not a page Claude found by searching, so it may not exist.']);
    expect(set.connections.map((c) => [c.relation.fromId, c.relation.type, c.relation.toId])).toEqual([
      [marathon.id, 'part-of', set.entries[0].item.id],
      [set.entries[2].item.id, 'part-of', set.entries[0].item.id],
    ]);
    expect(pendingWithPlaces(set).map((i) => i.title)).toEqual(['Battle of Marathon', 'Battle of Salamis']);
  });

  it('skips entries already on the timeline and connects to them instead', async () => {
    const doc = { ...createEmptyDoc(), items: [{ id: 'i_war', kind: 'span' as const, title: 'Persian Wars', start: { y: -498 }, end: { y: -448 }, categoryId: 'war', wikidataId: 'Q99999922', updatedAt: 1 }] };
    const set = await run(doc);
    expect(set.entries.map((e) => e.item.title)).toEqual(['Battle of Marathon', 'Battle of Salamis']);
    expect(set.dropped).toContain('“Persian Wars”: already on your timeline.');
    expect(set.connections.every((c) => c.relation.toId === 'i_war')).toBe(true);
  });

  it('accepting puts the record and its source in a doc that still imports', async () => {
    let doc = createEmptyDoc();
    const set = await run(doc);
    const conn = set.connections[0];
    expect(canAcceptConnection(doc, conn)).toBe(false);
    expect(acceptConnection(doc, conn)).toBe(doc);
    doc = acceptEntry(doc, set.entries[0], 100);
    doc = acceptEntry(doc, set.entries[1], 100);
    doc = acceptConnection(doc, conn, 100);
    expect(doc.items).toHaveLength(2);
    expect(doc.sources).toHaveLength(2);
    expect(doc.relations[0].drafted?.prompt).toBe(PROMPT_ID);
    expect(parseDoc(serializeDoc(doc)).items[1].drafted?.draftedAt).toBe(42);
  });

  it('says clearly when there is no key or no connection', async () => {
    await expect(draftEntries({ request: 'x', doc: createEmptyDoc(), apiKey: ' ', today: '2026-10-16' })).rejects.toMatchObject({ problem: 'no-key' });
    vi.stubGlobal('navigator', { onLine: false });
    await expect(draftEntries({ request: 'x', doc: createEmptyDoc(), apiKey: 'k', today: '2026-10-16' })).rejects.toBeInstanceOf(AiError);
  });
});

describe('live recordings (from npm run eval:ai -- entries --save)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const dir = new URL('../../../tests/ai-evals/entries/recordings/', import.meta.url);
  const cases = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('handmade-'));
  const requests = new Map<string, string>([['greco-persian-battles', 'The main battles of the Greco-Persian Wars']]);

  it.each(cases.length ? cases : ['(none yet)'])('%s still drafts sourced entries when replayed', async (file) => {
    if (!cases.length) return;
    const rec: Recording = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
    const fetch = replayFetch(rec);
    vi.stubGlobal('fetch', fetch);
    const set = await draftEntries({ request: requests.get(rec.case) ?? rec.case, doc: createEmptyDoc(), apiKey: 'sk-ant-test', today: '2026-10-16', fetch });
    expect(set.entries.length).toBeGreaterThan(0);
    expect(set.entries.every((e) => e.item.citations?.length && e.item.drafted)).toBe(true);
  });
});
