import { F, type Representation } from './types';

/** A solid square at the start of its lifespan bar (split by regime in Phase 5). */
export const polity: Representation = {
  kind: 'polity',
  glyph: `<rect x="4" y="4" width="10" height="10" ${F}/>`,
  point: 'glyph',
  bar: 'bar',
  badge: true,
};
