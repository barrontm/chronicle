import { describe, expect, it } from 'vitest';
import type { Relation } from '../model/types';
import { anchors, arcCurve, draftArrows, influenceArrows, influenceClasses, loopCurve } from './influenceLinks';

const r = (fromId: string, toId: string, type: Relation['type'] = 'influenced'): Relation => ({ id: `${fromId}-${toId}`, fromId, toId, type, updatedAt: 1 });
const rels = [r('socrates', 'plato'), r('plato', 'aristotle'), r('plato', 'academy', 'caused')];

describe('influenceClasses', () => {
  it('lights up who influenced the selection, whom it influenced, and its other connections', () => {
    expect(Object.fromEntries(influenceClasses(rels, 'plato')!)).toEqual({ socrates: 'infl-by', aristotle: 'infl-on', academy: 'linked', plato: 'infl-self' });
    expect(Object.fromEntries(influenceClasses(rels, 'academy')!)).toEqual({ plato: 'linked', academy: 'infl-self' });
  });

  it('changes nothing without a selection or without connections', () => {
    expect(influenceClasses(rels, undefined)).toBeUndefined();
    expect(influenceClasses(rels, 'socrates-pupil')).toBeUndefined();
  });

  it('keeps the influence role when an entry is also connected another way', () => {
    expect(influenceClasses([...rels, r('socrates', 'plato', 'related')], 'plato')!.get('socrates')).toBe('infl-by');
  });
});

describe('influenceArrows', () => {
  it('points from influencer to influenced', () => {
    expect(influenceArrows(rels, 'plato')).toEqual([
      { fromId: 'socrates', toId: 'plato', role: 'infl-by' },
      { fromId: 'plato', toId: 'aristotle', role: 'infl-on' },
      { fromId: 'plato', toId: 'academy', role: 'linked' },
    ]);
    expect(influenceArrows(rels, undefined)).toEqual([]);
  });
});

describe('arrow geometry', () => {
  it('lands on the start of the influenced item, leaving the influencer just before', () => {
    // Teacher lane above, student starts partway through the teacher's life.
    const { a, b } = anchors({ left: 0, right: 200, top: 0, bottom: 20 }, { left: 120, right: 300, top: 40, bottom: 60 });
    expect(b).toEqual({ x: 120, y: 50 });
    expect(a).toEqual({ x: 80, y: 20 });
  });

  it('leaves from the influencer’s end when the influenced came later', () => {
    const { a } = anchors({ left: 0, right: 100, top: 40, bottom: 60 }, { left: 300, right: 400, top: 0, bottom: 20 });
    expect(a).toEqual({ x: 92, y: 40 });
  });

  it('stays on the row when both are on the same one', () => {
    const { a, b } = anchors({ left: 0, right: 100, top: 0, bottom: 20 }, { left: 150, right: 250, top: 0, bottom: 20 });
    expect(a).toEqual({ x: 92, y: 10 });
    expect(b).toEqual({ x: 150, y: 10 });
  });

  it('draws a bowed curve between the points', () => {
    expect(arcCurve({ x: 0, y: 0 }, { x: 100, y: 0 }).d).toBe('M0 0 Q50 32 100 0');
  });

  it('puts a label halfway along the curve', () => {
    expect(arcCurve({ x: 0, y: 0 }, { x: 100, y: 0 }).mid).toEqual({ x: 50, y: 16 });
  });

  it('loops out to the left when both ends share a year', () => {
    const c = loopCurve({ x: 200, y: 10 }, { x: 200, y: 50 });
    expect(c.d).toBe('M200 10 C164 10 164 50 200 50');
    expect(c.mid.x).toBeLessThan(200);
    expect(c.mid.y).toBe(30);
  });
});

describe('drafted connections', () => {
  it('are labelled with their effect, or else their kind, and a question mark', () => {
    const r = (fromId: string, toId: string, extra: object = {}) => ({ id: `${fromId}-${toId}`, fromId, toId, type: 'caused' as const, updatedAt: 0, ...extra });
    expect(draftArrows([r('tribute', 'parthenon', { effect: 'funded' }), r('a', 'b'), r('c', 'c')])).toEqual([
      { fromId: 'tribute', toId: 'parthenon', role: 'draft', label: 'funded ?' },
      { fromId: 'a', toId: 'b', role: 'draft', label: 'led to ?' },
    ]);
  });
});
