import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describeEffect, effectsOf, effectWords, laneInfluence, laneInfluences, parseDoc } from './doc';
import { entryLanes } from './lanes';
import { polityMembers } from './polities';
import type { Lane, Relation } from './types';

const greece = () => parseDoc(readFileSync(new URL('../../tests/fixtures/greece/classical-greece.json', import.meta.url), 'utf8'));
const rel = (fromId: string, toId: string, o: Partial<Relation> = {}): Relation => ({ id: `${fromId}>${toId}`, fromId, toId, type: 'caused', updatedAt: 1, ...o });

describe('effects', () => {
  it('offers the usual words first, then Bob’s own, each once', () => {
    const words = effectWords([rel('a', 'b', { effect: 'weakened' }), rel('b', 'c', { effect: 'Starved' }), rel('c', 'd', { effect: 'starved ' })]);
    expect(words.slice(0, 8)).toEqual(['caused', 'enabled', 'prompted', 'funded', 'strengthened', 'weakened', 'legitimised', 'ended']);
    expect(words.slice(8)).toEqual(['starved']);
  });

  it('reads an effect from either end', () => {
    expect(describeEffect({ type: 'caused', effect: 'weakened' }, 'out')).toBe('Weakened');
    expect(describeEffect({ type: 'caused', effect: 'weakened' }, 'in')).toBe('Weakened by');
    expect(describeEffect({ type: 'caused', effect: 'starved' }, 'in')).toBe('Starved by');
    expect(describeEffect({ type: 'caused' }, 'in')).toBe('Caused by');
  });
});

describe('influences between lanes', () => {
  const lanes = new Map<string, Lane[]>([
    ['war', ['war']], ['owls', ['economy']], ['battle', ['war']], ['treasury', ['politics', 'economy']], ['parthenon', ['economy', 'ideas']], ['loose', []],
  ]);

  it('joins entries in different lanes, from the cause’s first lane to a lane it isn’t in', () => {
    expect(laneInfluence(rel('war', 'owls'), lanes)).toMatchObject({ from: 'war', to: 'economy' });
    expect(laneInfluence(rel('treasury', 'parthenon'), lanes)).toMatchObject({ from: 'politics', to: 'ideas' });
  });

  it('leaves out links inside one lane, “part of”, and entries in no lane', () => {
    expect(laneInfluence(rel('war', 'battle'), lanes)).toBeUndefined();
    expect(laneInfluence(rel('owls', 'war', { type: 'part-of' }), lanes)).toBeUndefined();
    expect(laneInfluence(rel('loose', 'war'), lanes)).toBeUndefined();
  });

  it('lists an entry’s effects both ways', () => {
    const rs = [rel('war', 'owls', { effect: 'weakened' }), rel('treasury', 'war', { effect: 'funded' }), rel('war', 'battle')];
    const { on, by } = effectsOf(rs, lanes, 'war');
    expect(on.map((x) => x.r.toId)).toEqual(['owls']);
    expect(by.map((x) => x.r.fromId)).toEqual(['treasury']);
  });

  it('finds the war acting on Athens’ economy in the Greece fixture, inside Athens', () => {
    const d = greece();
    const L = entryLanes(d.items, d.highlights);
    const athens = new Set(polityMembers(d).get('t_athens'));
    const inAthens = laneInfluences(d.relations, L, athens);
    const decelea = inAthens.find((x) => x.r.fromId === 'i_decelean' && x.r.toId === 'i_owls');
    expect(decelea).toMatchObject({ from: 'war', to: 'economy', r: { effect: 'weakened', highlightIds: ['h_decelea', 'h_mines_lost'] } });
    expect(inAthens.find((x) => x.r.fromId === 'i_treasury_moved' && x.r.toId === 'i_parthenon_built')).toMatchObject({ to: 'ideas' });
    expect(inAthens.length).toBeGreaterThanOrEqual(12);
    // Every highlight a connection cites is in the doc.
    const hs = new Set(d.highlights.map((h) => h.id));
    expect(d.relations.flatMap((r) => r.highlightIds ?? []).filter((h) => !hs.has(h))).toEqual([]);
  });
});
