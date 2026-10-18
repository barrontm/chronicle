import { N, S, type Representation } from './types';

/** Chevrons; a bar that ends in an arrow point (flow arrows on the map). */
export const migration: Representation = {
  kind: 'migration',
  glyph: `<path d="M3 4.5l4.5 4.5-4.5 4.5M9.5 4.5L14 9l-4.5 4.5" ${N} ${S} stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  point: 'glyph',
  bar: 'arrow',
  badge: true,
};
