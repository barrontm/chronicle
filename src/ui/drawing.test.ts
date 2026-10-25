import { describe, expect, it } from 'vitest';
import type { MultiPolygon, Polygon } from 'geojson';
import { addPoint, canDelete, canFinish, closePart, deleteVertex, draftFeatures, EMPTY_DRAFT, insertVertex, moveVertex, shapeFeatures, toGeometry, undo, type Draft } from './drawing';

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

describe('changing a border’s points', () => {
  const square: Polygon = { type: 'Polygon', coordinates: [[[23, 37], [24, 37], [24, 38], [23, 38], [23, 37]]] };
  const two: MultiPolygon = { type: 'MultiPolygon', coordinates: [square.coordinates, [[[25, 37], [26, 37], [25, 38], [25, 37]]]] };

  it('moves a point, rounded, and keeps the ring closed', () => {
    expect(moveVertex(square, { part: 0, ring: 0, i: 2 }, [24.512345, 38.5]).coordinates).toEqual([[[23, 37], [24, 37], [24.5123, 38.5], [23, 38], [23, 37]]]);
    // The first point is also the ring's closing one.
    expect(moveVertex(square, { part: 0, ring: 0, i: 0 }, [22.5, 36.5]).coordinates[0]).toEqual([[22.5, 36.5], [24, 37], [24, 38], [23, 38], [22.5, 36.5]]);
  });

  it('adds a point on the edge after one, in the part it belongs to', () => {
    const g = insertVertex(two, { part: 1, ring: 0, i: 0 }, [25.5, 36.8]) as MultiPolygon;
    expect(g.coordinates[0]).toEqual(square.coordinates);
    expect(g.coordinates[1][0]).toEqual([[25, 37], [25.5, 36.8], [26, 37], [25, 38], [25, 37]]);
    expect(insertVertex(square, { part: 0, ring: 0, i: 3 }, [22.5, 37.5]).coordinates[0]).toEqual([[23, 37], [24, 37], [24, 38], [23, 38], [22.5, 37.5], [23, 37]]);
  });

  it('deletes a point, but never below three', () => {
    expect(deleteVertex(square, { part: 0, ring: 0, i: 0 }).coordinates[0]).toEqual([[24, 37], [24, 38], [23, 38], [24, 37]]);
    const triangle = { part: 1, ring: 0, i: 1 };
    expect(canDelete(two, triangle)).toBe(false);
    expect(deleteVertex(two, triangle)).toBe(two);
  });

  it('shows the points, the picked one, and a dot halfway along each edge long enough', () => {
    const f = shapeFeatures(square, { part: 0, ring: 0, i: 1 }).features;
    const points = f.filter((x) => x.properties?.handle === 'point'), mids = f.filter((x) => x.properties?.handle === 'mid');
    expect(points).toHaveLength(4);
    expect(points.filter((x) => x.properties?.picked).map((x) => x.properties?.i)).toEqual([1]);
    expect(mids.map((x) => (x.geometry as { coordinates: number[] }).coordinates)).toEqual([[23.5, 37], [24, 37.5], [23.5, 38], [23, 37.5]]);
    expect(shapeFeatures(insertVertex(square, { part: 0, ring: 0, i: 0 }, [23.1, 37]), undefined, 0.5).features.filter((x) => x.properties?.handle === 'mid')).toHaveLength(4);
  });
});
