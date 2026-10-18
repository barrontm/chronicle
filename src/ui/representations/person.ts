import { F, S, type Representation } from './types';

/** A lifeline; a hollow ring on the map. */
export const person: Representation = {
  kind: 'person',
  glyph: `<path d="M3 9h12" ${S} stroke-width="1.8"/><circle cx="3.5" cy="9" r="2.3" ${F}/><circle cx="14.5" cy="9" r="2.3" ${F}/>`,
  point: 'dot',
  bar: 'life',
};
