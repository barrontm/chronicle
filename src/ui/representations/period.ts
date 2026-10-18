import { N, S, type Representation } from './types';

/** An open bar: today's span bar (an era band at level 0, Phase 3 ticket 5). */
export const period: Representation = {
  kind: 'period',
  glyph: `<rect x="1.5" y="6" width="15" height="6" rx="1" ${N} ${S} stroke-width="1.6"/>`,
  point: 'dot',
  bar: 'bar',
};
