import { describe, expect, it } from 'vitest';
import { addPoint, canFinish, closePart, draftFeatures, EMPTY_DRAFT, toGeometry, undo, type Draft } from './drawing';

const triangle = (d: Draft, x: number) => [[x, 38], [x + 1, 38], [x, 39]].reduce(addPoint, d);

describe('drawing a border', () => {
  it('rounds points and closes the ring of a single part', () => {
    const d = triangle(EMPTY_DRAFT, 23.123456);
    expect(d.current[0]).toEqual([23.1235, 38]);
    expect(toGeometry(d)).toEqual({ type: 'Polygon', coordinates: [[[23.1235, 38], [24.1235, 38], [23.1235, 39], [23.1235, 38]]] });
  });

  it('needs three points before a part can close', () => {
    const two = addPoint(addPoint(EMPTY_DRAFT, [23, 38]), [24, 38]);
    expect(closePart(two)).toBe(two);
    expect(canFinish(two)).toBe(false);
    expect(toGeometry(two)).toBeNull();
  });

  it('undoes points, then reopens the last closed part', () => {
    const d = closePart(triangle(EMPTY_DRAFT, 23));
    expect(d.current).toEqual([]);
    const reopened = undo(d);
    expect(reopened).toEqual({ done: [], current: [[23, 38], [24, 38], [23, 39]] });
    expect(undo(reopened).current).toHaveLength(2);
    expect(undo(EMPTY_DRAFT)).toBe(EMPTY_DRAFT);
  });

  it('makes a MultiPolygon from several parts, like a city and its island', () => {
    const d = triangle(closePart(triangle(EMPTY_DRAFT, 23)), 25);
    const g = toGeometry(d);
    expect(g?.type).toBe('MultiPolygon');
    expect(g?.type === 'MultiPolygon' && g.coordinates).toHaveLength(2);
  });

  it('shows filled parts, the open outline and its points', () => {
    const d = addPoint(addPoint(closePart(triangle(EMPTY_DRAFT, 23)), [25, 38]), [26, 38]);
    const types = draftFeatures(d).features.map((f) => f.geometry.type);
    expect(types).toEqual(['Polygon', 'LineString', 'Point', 'Point']);
    expect(draftFeatures(d).features[2].properties).toEqual({ first: true });
  });
});
