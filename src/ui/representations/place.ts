import { F, N, S, type Representation } from './types';

/**
 * A pin with a dot, standing on a ground line from its founding to its abandonment (to today
 * when it's still there). With no founding date it isn't on the timeline, only the map.
 */
export const place: Representation = {
  kind: 'place',
  glyph: `<path d="M9 2a5 5 0 0 1 5 5c0 4-5 9-5 9s-5-5-5-9a5 5 0 0 1 5-5z" ${N} ${S} stroke-width="1.6"/><circle cx="9" cy="7" r="1.9" ${F}/>`,
  point: 'glyph',
  bar: 'ground',
};
