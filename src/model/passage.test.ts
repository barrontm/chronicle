import { describe, expect, it } from 'vitest';
import { defaultChoices, ownEntry, isDatePage, pageKey, passageCandidates, type Choice, type WikiLink } from './passage';

const link = (start: number, end: number, key: string): WikiLink => ({ start, end, key });

describe('passageCandidates', () => {
  const links = [link(0, 5, 'Sparta'), link(10, 20, 'Delian_League'), link(30, 40, 'Peloponnesian War'), link(50, 60, 'Sparta')];

  it('puts the article first, then the links inside or overlapping the passage in reading order', () => {
    expect(passageCandidates('Pericles', links, 12, 35)).toEqual(['Pericles', 'Delian_League', 'Peloponnesian_War']);
    // Overlapping either edge counts; touching doesn't.
    expect(passageCandidates('Pericles', links, 4, 10)).toEqual(['Pericles', 'Sparta']);
    expect(passageCandidates('Pericles', links, 20, 30)).toEqual(['Pericles']);
  });

  it('lists each page once and leaves out the article itself and date pages', () => {
    const more = [...links, link(61, 65, 'pericles'), link(66, 70, '429_BC'), link(71, 75, '5th century BC')];
    expect(passageCandidates('Pericles', more, 0, 80)).toEqual(['Pericles', 'Sparta', 'Delian_League', 'Peloponnesian_War']);
  });

  it('stops after a handful of linked pages', () => {
    const many = Array.from({ length: 12 }, (_, i) => link(i * 10, i * 10 + 5, `Page_${i}`));
    expect(passageCandidates('Pericles', many, 0, 200, 3)).toEqual(['Pericles', 'Page_0', 'Page_1', 'Page_2']);
  });
});

describe('pageKey and isDatePage', () => {
  it('normalises titles to keys', () => {
    expect(pageKey('battle of Salamis')).toBe('Battle_of_Salamis');
    expect(pageKey('Peloponnesian_War')).toBe('Peloponnesian_War');
  });
  it('knows year, decade and century pages', () => {
    for (const k of ['429_BC', '1450s', 'AD_79', '5th_century_BC', '2nd_millennium']) expect(isDatePage(k)).toBe(true);
    for (const k of ['Battle_of_Marathon', 'Year_of_the_Four_Emperors', '300_(film)']) expect(isDatePage(k)).toBe(false);
  });
});

describe('defaultChoices', () => {
  const k = (...kinds: (Choice['kind'])[]) => kinds.map((kind) => ({ kind }));

  it('ticks the first event, war or battle linked, else the article', () => {
    expect(defaultChoices(k('person', 'polity', 'war', 'battle'))).toEqual([2]);
    expect(defaultChoices(k('war', 'polity'))).toEqual([0]);
    expect(defaultChoices(k('person', undefined, 'place'))).toEqual([0]);
    expect(defaultChoices(k('person'))).toEqual([0]);
  });

  it('ticks nothing when the article is a kind that can’t be added and nothing else comes first', () => {
    // Classical Athens (a polity), the mines of Laurion (a place), Themistocles.
    expect(defaultChoices(k('polity', 'place', 'person'))).toEqual([]);
    expect(defaultChoices(k('idea'))).toEqual([]);
  });

  it('keeps what the highlight is on, then what Bob ticked last', () => {
    expect(defaultChoices([{ kind: 'person' }, { kind: 'war', linked: true }, { kind: 'polity' }, { kind: 'place', linked: true }])).toEqual([1, 3]);
    expect(defaultChoices([{ kind: 'person' }, { kind: 'war' }, { kind: 'place', remembered: true }])).toEqual([2]);
    // The article's own subject is remembered by default, so it doesn't count.
    expect(defaultChoices([{ kind: 'person', remembered: true }, { kind: 'war' }])).toEqual([1]);
  });
});

describe('ownEntry', () => {
  const h = { sourceId: 's_athens', anchor: { section: 'Athenian democracy', exact: '', prefix: '', suffix: '' } } as unknown as Parameters<typeof ownEntry>[1];
  const form = { title: ' Silver of Laurion pays for the fleet ', kind: 'event' as const, start: '483 BCE', end: '', lanes: ['economy' as const] };

  it('cites the article and section the highlight is in, with its lanes and its pin', () => {
    const r = ownEntry({ ...form, place: { name: 'Lavrio', lat: 37.7, lon: 24.05 } }, h, 'society');
    expect(r).toMatchObject({ item: {
      kind: 'event', title: 'Silver of Laurion pays for the fleet', start: { y: -482 }, categoryId: 'society', lanes: ['economy'],
      places: [{ name: 'Lavrio', lat: 37.7, lon: 24.05, role: 'site' }],
      citations: [{ sourceId: 's_athens', locator: 'Athenian democracy' }],
    } });
    expect('item' in r && r.item.end).toBeUndefined();
  });

  it('keeps a period’s end, and an event never has one', () => {
    expect(ownEntry({ ...form, kind: 'span', start: 'c. 500 BCE', end: '401 BCE' }, h, 'x')).toMatchObject({ item: { start: { y: -499, approx: true }, end: { y: -400 } } });
    expect(ownEntry({ ...form, end: '400 BCE' }, h, 'x')).not.toHaveProperty('item.end');
  });

  it('says what’s wrong in Bob’s words', () => {
    expect(ownEntry({ ...form, title: ' ' }, h, 'x')).toEqual({ problem: 'Give it a title.' });
    expect(ownEntry({ ...form, start: '' }, h, 'x')).toEqual({ problem: 'Give a date, such as 483 BCE.' });
    expect(ownEntry({ ...form, start: 'the 480s' }, h, 'x')).toEqual({ problem: 'Chronicle can’t read “the 480s” as a date. Try 483 BCE or c. 450 BCE.' });
    expect(ownEntry({ ...form, kind: 'span' }, h, 'x')).toEqual({ problem: 'A period needs an end date.' });
    expect(ownEntry({ ...form, kind: 'span', end: '490 BCE' }, h, 'x')).toEqual({ problem: 'It ends before it starts.' });
  });
});
