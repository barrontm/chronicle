import { describe, expect, it } from 'vitest';
import { axisLabelEvery, axisStepYears, labelWidthPx, narrowLabels, rangeWidthPx } from './labels';

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
    expect([...narrowLabels(ranges, { start: -3000, end: 2000 }, 1000).keys()]).toEqual(['plato']);
    // 500 years across 1000px: both fit.
    expect(narrowLabels(ranges, { start: -500, end: 0 }, 1000).size).toBe(0);
  });

  it('pulls a name left so the right edge doesn’t cut it off, but never past the left edge', () => {
    const win = { start: 0, end: 1000 };
    // Starts at 500px, 80px name: fits, no pull.
    expect(narrowLabels([{ id: 'a', start: 500, end: 505, labelPx: 80 }], win, 1000).get('a')).toBe(0);
    // Starts at 960px, 80px name: pulled 48px left (40px plus a margin from the edge).
    expect(narrowLabels([{ id: 'b', start: 960, end: 965, labelPx: 80 }], win, 1000).get('b')).toBe(48);
    // A 200px name on a 100px timeline, starting at 30px: pulled only to the left edge.
    expect(narrowLabels([{ id: 'c', start: 300, end: 301, labelPx: 200 }], win, 100).get('c')).toBe(30);
  });
});

describe('axis labels', () => {
  it('labels every tick when there is room', () => {
    expect(axisLabelEvery(1000, 0.1)).toBe(1); // 100px apart
  });

  it('labels every 2nd, 5th or 10th tick when crowded, on round years', () => {
    expect(axisLabelEvery(1000, 0.05)).toBe(2); // 50px apart
    expect(axisLabelEvery(1000, 0.02)).toBe(5); // 20px apart
    expect(axisLabelEvery(1000, 0.01)).toBe(10); // 10px apart
    expect(axisLabelEvery(1000, 0.002)).toBe(50); // 2px apart
    expect(axisLabelEvery(1000, 0)).toBe(1);
  });
});

describe('axis step', () => {
  it('lets vis-timeline choose while 1000-year steps have room', () => {
    expect(axisStepYears(0.1)).toBeUndefined(); // 1000 years = 100px
    expect(axisStepYears(0)).toBeUndefined();
  });

  it('picks a bigger round step when even 1000 years is too tight, as on a phone', () => {
    // 12,000 years across 270px: labels need 3200 years apart.
    expect(axisStepYears(270 / 12_000)).toBe(5000);
    expect(axisStepYears(0.05)).toBe(2000); // need 1440
    expect(axisStepYears(0.005)).toBe(20_000); // need 14,400
  });
});
