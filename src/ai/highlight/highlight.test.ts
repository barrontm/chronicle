import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { replayFetch, type Recording } from '../../../tests/ai-evals/replay';
import { parse } from 'yaml';
import { runCase, type HighlightVars } from '../../../tests/ai-evals/highlight/run';
import { createEmptyDoc, parseDoc, serializeDoc } from '../../model/doc';
import type { Subject } from '../../model/subjects';
import type { Highlight, TimelineItem } from '../../model/types';
import { acceptConnection, acceptEntry } from '../draft';
import { draftFromHighlight, matchingEntries, PROMPT_ID, userMessage } from './index';
import { checkHighlightAnswer, numbersIn, quoteHolds, scopeOf, unstatedNumbers, type HighlightContext } from './validate';

const scope = {
  highlight: 'In 454–453 BC Athens transferred the treasury of the alliance from Delos to Athens.',
  section: 'Athens’s rule over its alliance\nBy 450–449 BC the revolts were quelled. In 449 BC Pericles proposed a decree allowing the use of 9,000 talents.\n',
};
const ctx = (over: Partial<HighlightContext> = {}): HighlightContext => ({
  scope,
  existing: new Map([['i_delian', 'Delian League'], ['i_pericles', 'Pericles']]),
  candidates: new Map([['Pericles', 'Pericles'], ['Delos', 'Delos'], ['Treasury_of_the_Delian_League', 'Treasury of the Delian League']]),
  categoryIds: new Set(['politics', 'war']),
  ...over,
});
const entry = (over: Record<string, unknown> = {}) => ({
  ref: 'e1', title: 'Treasury moved to Athens', kind: 'event', start: '454 BCE', category: 'politics',
  quote: 'Athens transferred the treasury of the alliance', why: 'When the league’s money came to Athens.', ...over,
});
const answer = (over: Record<string, unknown> = {}) => ({ dimension: { value: 'political', quote: 'transferred the treasury of the alliance' }, entries: [], connections: [], ...over });

describe('quoteHolds', () => {
  it('finds the words in the highlight or its section, however the quotes and dashes are typed', () => {
    expect(quoteHolds('transferred the treasury of the alliance', scope)).toBe(true);
    expect(quoteHolds('Athens’s rule over its alliance', { highlight: '', section: "Athens's rule over its alliance" })).toBe(true);
    expect(quoteHolds('In 454-453 BC Athens', scope)).toBe(true);
    expect(quoteHolds('“the use of 9,000 talents.”', scope)).toBe(true);
  });

  it('checks each piece of a quote joined by an ellipsis', () => {
    expect(quoteHolds('transferred the treasury … from Delos to Athens', scope)).toBe(true);
    expect(quoteHolds('transferred the treasury … to Sparta', scope)).toBe(false);
  });

  it('turns down words that aren’t there, and quotes too short to show anything', () => {
    expect(quoteHolds('Athens stole the treasury', scope)).toBe(false);
    expect(quoteHolds('Athens', scope)).toBe(false);
    expect(quoteHolds('', scope)).toBe(false);
  });
});

describe('numbers', () => {
  it('reads numbers without thousands separators', () => {
    expect([...numbersIn('as many as 20,000 slaves, 1.5 talents, in 413 BC')]).toEqual(['20000', '1.5', '413']);
  });

  it('lists numbers the passage never states', () => {
    expect(unstatedNumbers('9000 talents in 449, and 200 ships', scope)).toEqual(['200']);
  });
});

describe('scopeOf', () => {
  it('is the highlight and the section its anchor lands in', () => {
    const text = 'Lead.\nEarly life\nBorn in Athens.\nCareer\nHe moved the treasury.\n';
    const sections = [{ title: '', start: 0, end: 6 }, { title: 'Early life', start: 6, end: 33 }, { title: 'Career', start: 33, end: text.length }];
    const h: Highlight = { id: 'h', sourceId: 's', text: 'He moved the treasury.', anchor: { section: 'Career', exact: 'He moved the treasury.' }, usedBy: [], updatedAt: 0 };
    expect(scopeOf({ text, sections }, h)).toEqual({ highlight: 'He moved the treasury.', section: 'Career\nHe moved the treasury.\n' });
    expect(scopeOf({ text, sections }, { ...h, anchor: { section: 'Early life', exact: 'not in the text' } }).section).toBe('Early life\nBorn in Athens.\n');
  });
});

describe('checkHighlightAnswer', () => {
  it('keeps a dimension that rests on the passage and drops one that doesn’t', () => {
    expect(checkHighlightAnswer(answer(), ctx()).dimension).toEqual({ value: 'political', quote: 'transferred the treasury of the alliance' });
    const r = checkHighlightAnswer(answer({ dimension: { value: 'economic', quote: 'the league grew rich' } }), ctx());
    expect(r.dimension).toBeUndefined();
    expect(r.dropped).toEqual(['The suggested dimension (economic): the words it rests on aren’t in the passage.']);
    expect(checkHighlightAnswer(answer({ dimension: { value: 'military', quote: 'transferred the treasury' } }), ctx()).dimension).toBeUndefined();
  });

  it('reads dates through dates.ts, and keeps entries whose date the passage gives', () => {
    const r = checkHighlightAnswer(answer({ entries: [entry({ place: 'Delos', category: 'sport' })] }), ctx());
    expect(r.entries).toEqual([{
      ref: 'e1', title: 'Treasury moved to Athens', kind: 'event', start: { y: -453 }, place: 'Delos', categoryId: 'politics',
      quote: 'Athens transferred the treasury of the alliance', why: 'When the league’s money came to Athens.',
    }]);
    expect(r.dropped).toEqual([]);
  });

  it('drops dates it can’t read or the passage doesn’t give, and spans that end before they start', () => {
    const r = checkHighlightAnswer(answer({
      entries: [
        entry({ ref: 'a', start: 'the 450s' }),
        entry({ ref: 'b', title: 'Treasury reaches Athens', start: '452 BCE' }),
        entry({ ref: 'c', title: 'Revolts quelled', kind: 'span', start: '449 BCE', end: '450 BCE', quote: 'the revolts were quelled' }),
      ],
    }), ctx());
    expect(r.entries).toEqual([]);
    expect(r.dropped).toEqual([
      '“Treasury moved to Athens”: its date (“the 450s”) isn’t one Chronicle can read.',
      '“Treasury reaches Athens”: the passage doesn’t give its date.',
      '“Revolts quelled”: it ends before it starts.',
    ]);
  });

  it('keeps a span’s end, and makes a span without one an event', () => {
    const r = checkHighlightAnswer(answer({
      entries: [
        entry({ ref: 'a', title: 'Revolts in the league', kind: 'span', start: '450 BCE', end: '449 BCE', quote: 'the revolts were quelled' }),
        entry({ ref: 'b', kind: 'span' }),
      ],
    }), ctx());
    expect(r.entries.map((e) => [e.kind, e.start, e.end])).toEqual([['span', { y: -449 }, { y: -448 }], ['event', { y: -453 }, undefined]]);
  });

  it('drops claims without words of the passage, numbers it lacks, and what Bob already has', () => {
    const r = checkHighlightAnswer(answer({
      entries: [
        entry({ ref: 'a', quote: 'the Athenians seized the money by force' }),
        entry({ ref: 'b', title: '200 talents moved to Athens' }),
        entry({ ref: 'c', title: 'Delian league' }),
        entry({ ref: 'd', title: 'Treasury of the Delian League' }),
        entry({ ref: 'e', title: 'Decree on 9,000 talents', start: '449 BCE', quote: 'a decree allowing the use of 9,000 talents', why: 'Worth 50 triremes.' }),
      ],
    }), ctx());
    expect(r.entries.map((e) => [e.title, e.why])).toEqual([['Decree on 9,000 talents', '']]);
    expect(r.dropped).toEqual([
      '“Treasury moved to Athens”: the words it rests on aren’t in the passage.',
      '“200 talents moved to Athens”: the passage doesn’t give the number 200.',
      '“Delian league”: you already have it, or it has its own article.',
      '“Treasury of the Delian League”: you already have it, or it has its own article.',
    ]);
  });

  it('keeps at most three entries', () => {
    const many = ['A', 'B', 'C', 'D'].map((t) => entry({ ref: t, title: `Treasury moved ${t}` }));
    const r = checkHighlightAnswer(answer({ entries: many }), ctx());
    expect(r.entries).toHaveLength(3);
    expect(r.dropped).toEqual(['“Treasury moved D”: more than 3 entries from one highlight.']);
  });

  it('connects Bob’s entries, linked pages and drafted entries, each with an effect', () => {
    const r = checkHighlightAnswer(answer({
      entries: [entry()],
      connections: [
        { from: 'i_delian', to: 'e1', type: 'caused', effect: 'Moved', quote: 'transferred the treasury of the alliance' },
        { from: 'e1', to: 'Treasury of the Delian League', type: 'related', effect: 'relocated', quote: 'from Delos to Athens' },
        { from: 'i_delian', to: 'e1', type: 'influenced', effect: 'again', quote: 'from Delos to Athens' },
        { from: 'e1', to: 'e1', type: 'caused', effect: 'itself', quote: 'from Delos to Athens' },
        { from: 'e1', to: 'i_pericles', type: 'conquered', effect: 'strengthened', quote: 'from Delos to Athens' },
      ],
    }), ctx());
    expect(r.connections).toEqual([
      { from: { item: 'i_delian' }, to: { ref: 'e1' }, type: 'caused', effect: 'moved', quote: 'transferred the treasury of the alliance' },
      { from: { ref: 'e1' }, to: { page: 'Treasury_of_the_Delian_League' }, type: 'related', effect: 'relocated', quote: 'from Delos to Athens' },
      { from: { ref: 'e1' }, to: { item: 'i_pericles' }, type: 'caused', effect: 'strengthened', quote: 'from Delos to Athens' },
    ]);
  });

  it('drops connections with an unknown end, no effect, a number the passage lacks, or no words of the passage', () => {
    const r = checkHighlightAnswer(answer({
      connections: [
        { from: 'Sparta', to: 'i_delian', type: 'caused', effect: 'weakened', quote: 'from Delos to Athens' },
        { from: 'i_pericles', to: 'i_delian', type: 'caused', effect: '', quote: 'from Delos to Athens' },
        { from: 'i_pericles', to: 'Delos', type: 'caused', effect: 'took the money away from it', quote: 'from Delos to Athens' },
        { from: 'Delos', to: 'i_delian', type: 'caused', effect: 'cost 300', quote: 'from Delos to Athens' },
        { from: 'Pericles', to: 'i_delian', type: 'caused', effect: 'ruled', quote: 'Pericles ruled the league' },
      ],
    }), ctx());
    expect(r.connections).toEqual([]);
    expect(r.dropped).toEqual([
      'A connection from “Sparta” to “Delian League”: one end isn’t in the draft, the passage or your Chronicle.',
      'A connection from “Pericles” to “Delian League”: it doesn’t say what the one did to the other.',
      'A connection from “Pericles” to “Delos”: it doesn’t say what the one did to the other.',
      'A connection from “Delos” to “Delian League”: its effect has a number the passage doesn’t give.',
      'A connection from “Pericles” to “Delian League”: the words it rests on aren’t in the passage.',
    ]);
  });

  it('says so when the answer isn’t in the expected shape', () => {
    expect(checkHighlightAnswer('nope', ctx()).dropped).toEqual(['Claude’s answer wasn’t in the expected shape.']);
  });
});

const item = (id: string, title: string, wikidataId?: string): TimelineItem => ({ id, kind: 'event', title, start: { y: -453 }, categoryId: 'politics', ...(wikidataId ? { wikidataId } : {}), updatedAt: 1 });
const subject = (qid: string, label: string, partOf: string[] = []): Subject => ({
  qid, label, kind: 'person', facts: { partOf, follows: [], followedBy: [], participants: [], locations: [], government: [] }, labels: {},
});

describe('matchingEntries and userMessage', () => {
  const doc = { items: [item('i_a', 'Athens'), item('i_dl', 'Delian League', 'Q193235'), item('i_p', 'Pericles', 'Q80398'), item('i_x', 'Battle of Marathon')] };
  const candidates = [{ key: 'Pericles', subject: subject('Q80398', 'Pericles', ['Q193235']) }, { key: 'Delos' }];

  it('finds entries by the candidates’ Wikidata ids and facts, then by name in the passage', () => {
    expect(matchingEntries(doc, candidates, scope).map((i) => i.id)).toEqual(['i_dl', 'i_p', 'i_a']);
    expect(matchingEntries(doc, candidates, scope, 1).map((i) => i.id)).toEqual(['i_dl']);
  });

  it('gives Claude the passage, its pages and Bob’s entries', () => {
    const h: Highlight = { id: 'h', sourceId: 's', text: scope.highlight, anchor: { section: 'Career', exact: scope.highlight }, usedBy: [], updatedAt: 0 };
    const msg = userMessage(h, candidates, matchingEntries(doc, candidates, scope), doc);
    expect(msg).toContain('in the section “Career”');
    expect(msg).toContain(`<highlight>${scope.highlight}</highlight>`);
    expect(msg).toContain('Pericles | Pericles | Person | Bob has it: i_p | the article’s own subject');
    expect(msg).toContain('Delos | Delos | not on Wikidata');
    expect(msg).toContain('i_dl | Delian League | 454 BCE | Q193235');
  });
});

describe('draftFromHighlight', () => {
  afterEach(() => vi.unstubAllGlobals());
  const dir = new URL('../../../tests/ai-evals/highlight/recordings/', import.meta.url);
  const rec = (name: string): Recording => JSON.parse(readFileSync(new URL(`${name}.json`, dir), 'utf8'));
  const cases = new Map<string, HighlightVars>((parse(readFileSync('tests/ai-evals/highlight/cases.yaml', 'utf8')).tests as { description: string; vars: HighlightVars }[]).map((t) => [t.description, t.vars]));
  const replay = async (r: Recording) => {
    const fetch = replayFetch(r);
    vi.stubGlobal('fetch', fetch);
    return runCase(cases.get(r.case)!, { apiKey: 'sk-ant-test', today: '2026-10-17', now: 42, fetch });
  };

  it('drafts a dated entry with its place, and a connection with its effect citing the highlight', async () => {
    const { doc, output } = await replay(rec('handmade-tribute'));
    expect(output).toMatchObject({ feature: 'highlight', highlightId: 'h_case', dimension: { value: 'economic' } });
    expect(output.entries).toHaveLength(1);
    const decree = output.entries[0];
    expect(decree.item).toMatchObject({
      kind: 'event', title: 'Decree funding the rebuilding of Athenian temples', start: { y: -448 }, categoryId: 'arts',
      citations: [{ sourceId: doc.highlights[0].sourceId, locator: 'Athens\'s rule over its alliance' }],
      places: [{ name: 'Acropolis of Athens', role: 'site' }],
      drafted: { model: 'claude-opus-5-5', prompt: PROMPT_ID, draftedAt: 42 },
    });
    expect(decree.problems).toEqual([]);
    expect(decree.quote).toMatch(/^In 449 BC/);
    expect(output.connections.map((c) => c.relation)).toEqual([expect.objectContaining({ fromId: 'i_delian', toId: decree.item.id, effect: 'funded', highlightIds: ['h_case'] })]);
    expect(output.dropped).toHaveLength(4);

    let d = acceptEntry(doc, decree, 100);
    d = acceptConnection(d, output.connections[0], 100);
    expect(parseDoc(serializeDoc(d)).relations[0]).toMatchObject({ effect: 'funded', highlightIds: ['h_case'] });
  });

  it('says why a linked place can’t be connected', async () => {
    const { output } = await replay(rec('handmade-decelea'));
    expect(output.entries.map((e) => e.item.title)).toEqual(['Sparta fortifies Decelea']);
    expect(output.connections.map((c) => c.relation.effect)).toEqual(['escalated', 'drained']);
    expect(output.dropped).toEqual(['A connection (fortified) with “Decelea”: A place on its own isn’t an event.']);
  });

  it('drafts a linked page a connection needs from Wikipedia, once', async () => {
    const { doc, output } = await replay(rec('handmade-plague'));
    expect(output.dimension?.value).toBe('social');
    expect(output.entries.map((e) => [e.item.title, e.item.wikidataId])).toEqual([['Plague of Athens', 'Q758173']]);
    const plague = output.entries[0].item.id;
    expect(output.connections.map((c) => [c.relation.fromId, c.relation.effect, c.relation.toId])).toEqual([[plague, 'killed', 'i_pericles'], [plague, 'weakened', 'i_pelop']]);
    let d = acceptEntry(doc, output.entries[0], 100);
    for (const c of output.connections) d = acceptConnection(d, c, 100);
    expect(parseDoc(serializeDoc(d)).relations).toHaveLength(2);
  });

  it('says clearly when there is no key or no connection', async () => {
    const args = { highlight: { id: 'h', sourceId: 's', text: 'x', usedBy: [], updatedAt: 0 }, article: { key: 'X', title: 'X', text: { text: 'x', sections: [{ title: '', start: 0, end: 1 }] } }, candidates: [], doc: createEmptyDoc(), today: '2026-10-17' };
    await expect(draftFromHighlight({ ...args, apiKey: ' ' })).rejects.toMatchObject({ problem: 'no-key' });
    vi.stubGlobal('navigator', { onLine: false });
    await expect(draftFromHighlight({ ...args, apiKey: 'k' })).rejects.toMatchObject({ problem: 'offline' });
  });

  const live = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('handmade-'));
  it.each(live.length ? live : ['(none yet)'])('live recording %s still validates when replayed', async (file) => {
    if (!live.length) return;
    const r: Recording = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
    if (!cases.has(r.case)) return;
    const { output } = await replay(r);
    expect(output.dropped.filter((x) => /words it rests on|date|number/.test(x))).toEqual([]);
    expect(output.dimension).toBeDefined();
    expect(output.connections.every((c) => c.relation.effect && c.relation.highlightIds?.includes('h_case'))).toBe(true);
    expect(output.entries.every((e) => e.item.citations?.length && e.item.drafted?.prompt === PROMPT_ID)).toBe(true);
  });
});
