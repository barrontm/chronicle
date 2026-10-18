import { F, P, S, type Representation } from './types';

const coin = (y: number) => `<path d="M2.5 ${y}v2.1a6.5 2.2 0 0 0 13 0V${y}" ${P} ${S} stroke-width="1.3"/><ellipse cx="9" cy="${y}" rx="6.5" ry="2.2" ${P} ${S} stroke-width="1.3"/>`;

/** A stack of coins at the start of its bar (the economic lane's streamgraph is Phase 4). */
export const economy: Representation = {
  kind: 'economy',
  glyph: [12.6, 9.4, 6.2].map(coin).join('') + `<ellipse cx="9" cy="6.2" rx="3.2" ry=".9" ${F} opacity=".55"/>`,
  point: 'glyph',
  bar: 'bar',
  badge: true,
};
