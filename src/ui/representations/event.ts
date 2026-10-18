import { F, type Representation } from './types';

/** A point, or a short span; a pin at its place on the map. */
export const event: Representation = {
  kind: 'event',
  glyph: `<circle cx="9" cy="9" r="5" ${F}/>`,
  point: 'dot',
  bar: 'bar',
};
