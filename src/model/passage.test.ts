import { describe, expect, it } from 'vitest';
import { firstChoice, isDatePage, pageKey, passageCandidates, type WikiLink } from './passage';

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

describe('firstChoice', () => {
  it('chooses the first event, war or battle linked, else the article', () => {
    expect(firstChoice(['person', 'polity', 'war', 'battle'])).toBe(2);
    expect(firstChoice(['war', 'polity'])).toBe(0);
    expect(firstChoice(['person', undefined, 'place'])).toBe(0);
    expect(firstChoice(['person'])).toBe(0);
  });
});
