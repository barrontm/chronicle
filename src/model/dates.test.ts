import { describe, expect, it } from 'vitest';
import {
  compareHistDate,
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
