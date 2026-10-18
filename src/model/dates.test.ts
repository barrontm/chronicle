import { describe, expect, it } from 'vitest';
import {
  formatItemDates,
  axisTicks,
  compareHistDate,
  moveDates,
  precisionOf,
  shiftHistDate,
  formatTickYear,
  toDecimalYear,
  formatYear,
  fromOwidYear,
  formatAxisYear,
  formatHistDate,
  formatRange,
  fromJsDate,
  fromWikidataTime,
  isValidHistDate,
  jsDateToDecimalYear,
  decimalYearToJsDate,
  parseHistDate,
  toAstronomical,
  toInputString,
  toJsDate,
} from './dates';

describe('era conversion', () => {
  it('maps BCE years to astronomical numbering with no year zero gap', () => {
    expect(toAstronomical(1, 'BCE')).toBe(0);
    expect(toAstronomical(431, 'BCE')).toBe(-430);
    expect(toAstronomical(1, 'CE')).toBe(1);
  });
});

describe('parseHistDate', () => {
  it.each([
    ['1914-07-28', { y: 1914, m: 7, d: 28 }],
    ['1914-07', { y: 1914, m: 7 }],
    ['1914', { y: 1914 }],
    ['476 CE', { y: 476 }],
    ['AD 476', { y: 476 }],
    ['431 BCE', { y: -430 }],
    ['431 bc', { y: -430 }],
    ['431 B.C.', { y: -430 }],
    ['-431', { y: -430 }],
    ['c. 1440', { y: 1440, approx: true }],
    ['ca 550 BCE', { y: -549, approx: true }],
    ['circa 1760', { y: 1760, approx: true }],
    ['~1760', { y: 1760, approx: true }],
    ['  1 BCE ', { y: 0 }],
  ])('parses %s', (input, expected) => {
    expect(parseHistDate(input)).toEqual(expected);
  });

  it.each(['', 'sometime', '0', '1914-13', '1914-02-30', '1914/07/28', '0 BCE'])('rejects %j', (input) => {
    expect(parseHistDate(input)).toBeNull();
  });

  it('round-trips through toInputString', () => {
    for (const s of ['1914-07-28', '431 BCE', 'c. 1440', '1 BCE', '33']) {
      const d = parseHistDate(s)!;
      expect(parseHistDate(toInputString(d))).toEqual(d);
    }
  });
});

describe('formatting', () => {
  it('formats dates for reading', () => {
    expect(formatHistDate({ y: -430 })).toBe('431 BCE');
    expect(formatHistDate({ y: 1914, m: 7, d: 28 })).toBe('28 Jul 1914');
    expect(formatHistDate({ y: 1440, approx: true })).toBe('c. 1440');
  });
  it('labels round axis ticks with the numbers people expect', () => {
    expect(formatAxisYear(-500)).toBe('500 BCE');
    expect(formatAxisYear(0)).toBe('1 CE');
    expect(formatAxisYear(1500)).toBe('1500');
  });
  it('labels year 0 as the round "1 CE" between centuries, and as 1 BCE when the ticks are single years', () => {
    expect(axisTicks(-250, 250, 1000).ticks.find((t) => t.y === 0)?.label).toBe('1 CE');
    expect(axisTicks(-6, 6, 1000).ticks.find((t) => t.y === 0)?.label).toBe('1 BCE');
    expect(axisTicks(-6, 6, 1000).ticks.find((t) => t.y === -2)?.label).toBe('3 BCE');
  });
  it('reads deep time in words', () => {
    expect(formatTickYear(-2_800_000, 1e5)).toBe('2.8 million BCE');
    expect(formatTickYear(-250_000, 5e4)).toBe('250,000 BCE');
    expect(formatTickYear(-5000, 1000)).toBe('5000 BCE');
  });
  it('collapses plain BCE ranges', () => {
    expect(formatRange({ y: -430 }, { y: -403 })).toBe('431–404 BCE');
    expect(formatRange({ y: -30 }, { y: 14 })).toBe('31 BCE – 14');
  });
});

describe('JS Date conversion', () => {
  it('handles years 0–99 without the 1900s bug', () => {
    expect(toJsDate({ y: 33 }).getUTCFullYear()).toBe(33);
    expect(toJsDate({ y: 0 }).getUTCFullYear()).toBe(0);
  });
  it('round-trips BCE dates', () => {
    const d = { y: -430, m: 3, d: 15 };
    expect(fromJsDate(toJsDate(d))).toEqual(d);
  });
  it('converts decimal years both ways', () => {
    for (const x of [-430, 0, 1914.5, 2022]) {
      expect(jsDateToDecimalYear(decimalYearToJsDate(x))).toBeCloseTo(x, 3);
    }
  });
});

describe('validity and ordering', () => {
  it('validates leap days', () => {
    expect(isValidHistDate({ y: 2000, m: 2, d: 29 })).toBe(true);
    expect(isValidHistDate({ y: 1900, m: 2, d: 29 })).toBe(false);
    expect(isValidHistDate({ y: 1900, d: 3 })).toBe(false);
  });
  it('orders BCE before CE', () => {
    expect(compareHistDate({ y: -430 }, { y: 476 })).toBeLessThan(0);
    expect(compareHistDate({ y: 1914, m: 7 }, { y: 1914, m: 1 })).toBeGreaterThan(0);
  });
});

describe('fromWikidataTime', () => {
  it('reads day, month and year precision', () => {
    expect(fromWikidataTime('+1815-12-10T00:00:00Z', 11)).toEqual({ y: 1815, m: 12, d: 10 });
    expect(fromWikidataTime('+1815-12-00T00:00:00Z', 10)).toEqual({ y: 1815, m: 12 });
    expect(fromWikidataTime('+1815-00-00T00:00:00Z', 9)).toEqual({ y: 1815 });
  });

  it('turns historical BCE years into astronomical ones', () => {
    expect(fromWikidataTime('-0490-00-00T00:00:00Z', 9)).toEqual({ y: -489 });
    expect(fromWikidataTime('-0001-00-00T00:00:00Z', 9)).toEqual({ y: 0 });
    expect(fromWikidataTime('-0384-01-01T00:00:00Z', 9)).toEqual({ y: -383 });
  });

  it('keeps years 1–99 as themselves', () => {
    expect(fromWikidataTime('+0079-08-24T00:00:00Z', 11)).toEqual({ y: 79, m: 8, d: 24 });
  });

  it('marks decades, centuries and circa values as approximate', () => {
    expect(fromWikidataTime('+1450-00-00T00:00:00Z', 8)).toEqual({ y: 1450, approx: true });
    expect(fromWikidataTime('-0500-00-00T00:00:00Z', 7)).toEqual({ y: -499, approx: true });
    expect(fromWikidataTime('+1440-00-00T00:00:00Z', 9, true)).toEqual({ y: 1440, approx: true });
  });

  it('keeps real leap days and drops a Julian 29 February the Gregorian calendar lacks', () => {
    expect(fromWikidataTime('+2000-02-29T00:00:00Z', 11)).toEqual({ y: 2000, m: 2, d: 29 });
    expect(fromWikidataTime('+1500-02-29T00:00:00Z', 11)).toEqual({ y: 1500, m: 2 });
  });

  it('returns null for values it cannot read', () => {
    expect(fromWikidataTime('soon', 11)).toBeNull();
    expect(fromWikidataTime('+0000-00-00T00:00:00Z', 9)).toBeNull();
  });
});

describe('fromOwidYear', () => {
  it('reads OWID negatives as BCE years', () => {
    expect(formatYear(fromOwidYear(-10000))).toBe('10000 BCE');
    expect(formatYear(fromOwidYear(-1))).toBe('1 BCE');
    expect(fromOwidYear(0)).toBe(0);
    expect(fromOwidYear(1)).toBe(1);
    expect(fromOwidYear(2023)).toBe(2023);
  });
});

describe('axis ticks', () => {
  const steps = (s: number, e: number, w = 1200) => axisTicks(s, e, w);
  it('spans deep time with sensible steps', () => {
    const t = steps(-3_000_000, 2100);
    expect(t.unit).toBe('year');
    expect(t.step).toBe(200_000);
    expect(t.ticks[1].label).toBe('2.8 million BCE');
    expect(t.ticks[0].label).toBe('3 million BCE');
    expect(t.ticks.at(-1)!.label).toBe('1 CE');
  });
  it('steps down through millennia, centuries and decades', () => {
    expect(steps(-800, 2030).step).toBe(200);
    expect(steps(-500, -400).step).toBe(10);
    expect(steps(-500, -400).ticks.map((t) => t.label).slice(0, 3)).toEqual(['500 BCE', '490 BCE', '480 BCE']);
    expect(steps(1900, 1920).step).toBe(2);
  });
  it('switches to months with the year as a heading', () => {
    const t = steps(1914, 1916);
    expect(t.unit).toBe('month');
    expect(t.ticks[0]).toEqual({ y: 1914, label: 'Jan', major: true });
    expect(t.heads.map((h) => h.label)).toEqual(['1914', '1915', '1916']);
  });
  it('goes down to days, with the month as a heading', () => {
    const start = toDecimalYear({ y: 1944, m: 6, d: 3 });
    const end = toDecimalYear({ y: 1944, m: 6, d: 10 });
    const t = steps(start, end);
    expect(t.unit).toBe('day');
    expect(t.ticks.map((x) => x.label)).toEqual(['3', '4', '5', '6', '7', '8', '9', '10']);
    expect(t.heads[0].label).toBe('June 1944');
  });
  it('counts days across a leap February in a BCE year', () => {
    const t = steps(toDecimalYear({ y: -4, m: 2, d: 25 }), toDecimalYear({ y: -4, m: 3, d: 2 }));
    expect(t.ticks.map((x) => x.label)).toEqual(['25', '26', '27', '28', '29', '1', '2']);
    expect(t.heads.map((h) => h.label)).toEqual(['February 5 BCE', 'March 5 BCE']);
  });
  it('never makes more than a few hundred ticks', () => {
    expect(steps(-3_200_000, 2200, 20_000).ticks.length).toBeLessThanOrEqual(401);
  });
});

describe('moving dates', () => {
  it('keeps a year a year, across year 0', () => {
    expect(shiftHistDate({ y: -2 }, 3.4)).toEqual({ y: 1 });
    expect(shiftHistDate({ y: -430, approx: true }, -0.6)).toEqual({ y: -431, approx: true });
    expect(precisionOf({ y: 5 })).toBe('year');
  });
  it('keeps a month a month, across the new year', () => {
    expect(shiftHistDate({ y: 0, m: 11 }, 0.25)).toEqual({ y: 1, m: 2 });
    expect(shiftHistDate({ y: 50, m: 1 }, -1 / 12)).toEqual({ y: 49, m: 12 });
  });
  it('moves a day by days, and a leap day lands on the last of February', () => {
    expect(shiftHistDate({ y: 33, m: 12, d: 31 }, 1 / 365.25)).toEqual({ y: 34, m: 1, d: 1 });
    expect(shiftHistDate({ y: -399, m: 3, d: 1 }, -1 / 365.25)).toEqual({ y: -399, m: 2, d: 28 });
    expect(shiftHistDate({ y: 2000, m: 2, d: 29 }, 1, 'year')).toEqual({ y: 2001, m: 2, d: 28 });
    expect(shiftHistDate({ y: 1999, m: 1, d: 31 }, 1 / 12, 'month')).toEqual({ y: 1999, m: 2, d: 28 });
  });
  it('never moves in steps finer than the date is known', () => {
    expect(shiftHistDate({ y: 10 }, 0.3, 'day')).toEqual({ y: 10 });
  });
  it('stays within the years Chronicle can store', () => {
    expect(shiftHistDate({ y: -270_999 }, -50)).toEqual({ y: -271_000 });
  });
  it('moves a whole entry by one step of its coarser date, keeping its length', () => {
    const war = { start: { y: -430 }, end: { y: -403, m: 4, d: 25 } };
    expect(moveDates(war, 2.6)).toEqual({ start: { y: -427 }, end: { y: -400, m: 4, d: 25 } });
    expect(moveDates({ start: { y: -469 } }, 1)).toEqual({ start: { y: -468 } });
  });
  it('moves one end, never past the other', () => {
    const life = { start: { y: -427 }, end: { y: -347 } };
    expect(moveDates(life, -1, 'start')).toEqual({ start: { y: -428 }, end: { y: -347 } });
    expect(moveDates(life, 200, 'start')).toEqual({ start: { y: -347 }, end: { y: -347 } });
    expect(moveDates(life, -200, 'end')).toEqual({ start: { y: -427 }, end: { y: -427 } });
    expect(moveDates({ start: { y: 1950 } }, 5, 'end')).toEqual({ start: { y: 1950 } });
  });
});

describe('formatItemDates', () => {
  it('says what is known of a place, and when the living were born', () => {
    expect(formatItemDates({ kind: 'span', subject: 'place' })).toBe('Dates not known');
    expect(formatItemDates({ kind: 'span', subject: 'place', end: { y: -347 } })).toBe('Abandoned 348 BCE');
    expect(formatItemDates({ kind: 'span', subject: 'place', start: { y: -330 } })).toBe('Founded 331 BCE');
    expect(formatItemDates({ kind: 'span', subject: 'place', start: { y: -431 }, end: { y: -347 } })).toBe(formatRange({ y: -431 }, { y: -347 }));
    expect(formatItemDates({ kind: 'person', start: { y: 1950 } })).toBe('Born 1950');
    expect(formatItemDates({ kind: 'event', start: { y: 0 } })).toBe('1 BCE');
  });
});
