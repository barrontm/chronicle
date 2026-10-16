import { describe, expect, it } from 'vitest';
import { labelWidthPx, narrowIds, rangeWidthPx } from './labels';

describe('readable names when zoomed out', () => {
  const measure = (t: string) => t.length * 7;

  it('measures a label with its padding and thumbnail', () => {
    expect(labelWidthPx('Plato', false, measure)).toBe(35 + 16);
    expect(labelWidthPx('Plato', true, measure)).toBe(35 + 16 + 28);
  });

  it('works out how wide a range is drawn', () => {
    expect(rangeWidthPx(0, 80, { start: 0, end: 800 }, 1000)).toBe(100);
    expect(rangeWidthPx(0, 80, { start: 0, end: 0 }, 1000)).toBe(0);
  });

  it('picks the bars too narrow for their names, and only those', () => {
    const ranges = [
      { id: 'plato', start: -427, end: -347, labelPx: 51 },
      { id: 'rome', start: -753, end: 476, labelPx: 120 },
    ];
    // 5000 years across 1000px: Plato is 16px wide, Rome 246px.
    expect([...narrowIds(ranges, { start: -3000, end: 2000 }, 1000)]).toEqual(['plato']);
    // 500 years across 1000px: both fit.
    expect(narrowIds(ranges, { start: -500, end: 0 }, 1000).size).toBe(0);
  });
});
