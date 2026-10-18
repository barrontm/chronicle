import { describe, expect, it } from 'vitest';
import type { DatedItem } from '../model/types';
import { currentStop, focusWindow, panBy, sliderToSpan, spanLabel, spanToSlider, SLIDER_MAX, TIME_MAX, TIME_MIN, zoomAround, ZOOM_MAX_YEARS, ZOOM_MIN_YEARS } from './timeNav';

const item = (id: string, kind: DatedItem['kind'], start: number, end?: number): DatedItem => ({
  id, kind, title: id, start: { y: start }, ...(end !== undefined ? { end: { y: end } } : {}), categoryId: 'c', updatedAt: 1,
});

describe('zoom slider', () => {
  it('runs from widest to closest on a log scale', () => {
    expect(spanToSlider(ZOOM_MAX_YEARS)).toBe(0);
    expect(spanToSlider(ZOOM_MIN_YEARS)).toBe(SLIDER_MAX);
    expect(spanToSlider(100)).toBeGreaterThan(spanToSlider(1000));
  });

  it('round-trips a span', () => {
    expect(sliderToSpan(spanToSlider(100))).toBeCloseTo(100, -1);
    expect(sliderToSpan(-5)).toBeCloseTo(ZOOM_MAX_YEARS);
  });
});

describe('zoomAround', () => {
  it('keeps the middle in place by default', () => {
    expect(zoomAround({ start: 0, end: 100 }, 2)).toEqual({ start: -50, end: 150 });
    expect(zoomAround({ start: 0, end: 100 }, 0.5)).toEqual({ start: 25, end: 75 });
  });

  it('keeps the point under the pointer in place', () => {
    expect(zoomAround({ start: 0, end: 100 }, 0.5, 0)).toEqual({ start: 0, end: 50 });
  });

  it('stays within the zoom and time limits', () => {
    const w = zoomAround({ start: 0, end: 10_000 }, 10);
    expect(w.end - w.start).toBe(ZOOM_MAX_YEARS);
    expect(w.start).toBeGreaterThanOrEqual(TIME_MIN);
    expect(w.end).toBeLessThanOrEqual(TIME_MAX);
  });
});

describe('panBy', () => {
  it('moves without zooming, and stops at the edges', () => {
    expect(panBy({ start: 0, end: 100 }, -50)).toEqual({ start: -50, end: 50 });
    expect(panBy({ start: 2000, end: 2100 }, 500)).toEqual({ start: TIME_MAX - 100, end: TIME_MAX });
  });
});

describe('focusWindow', () => {
  const socrates = item('socrates', 'person', -469, -398);
  const plato = item('plato', 'person', -427, -347);
  const aristotle = item('aristotle', 'person', -383, -321);

  it('frames a life and its connections with a margin', () => {
    const w = focusWindow(plato, [socrates, aristotle]);
    expect(w.start).toBeLessThan(-469);
    expect(w.end).toBeGreaterThan(-321);
    expect(w.end - w.start).toBeCloseTo((469 - 321) * 1.2);
  });

  it('frames the entry alone when its connections reach too far', () => {
    const w = focusWindow(plato, [item('nietzsche', 'person', 1844, 1900)]);
    expect(w.start).toBeLessThan(-427);
    expect(w.end).toBeGreaterThan(-347);
    expect(w.end - w.start).toBeCloseTo(80 * 1.2);
  });

  it('gives an event some room around it', () => {
    const w = focusWindow(item('salamis', 'event', -479), []);
    expect(w.end - w.start).toBe(20);
    expect((w.start + w.end) / 2).toBe(-479);
  });

  it('draws a living person up to now', () => {
    const w = focusWindow(item('living', 'person', 1950), [], 2026);
    expect(w.end).toBeGreaterThan(2026);
  });
});

describe('spanLabel and stops', () => {
  it('says how much time is in view', () => {
    expect(spanLabel(7 / 365.25)).toBe('1 week');
    expect(spanLabel(0.25)).toBe('3 months');
    expect(spanLabel(12.4)).toBe('12 years');
    expect(spanLabel(123)).toBe('120 years');
    expect(spanLabel(4012)).toBe('4,000 years');
  });

  it('names the nearest stop only when close to it', () => {
    expect(currentStop(110)).toBe('Century');
    expect(currentStop(300)).toBeUndefined();
  });
});
