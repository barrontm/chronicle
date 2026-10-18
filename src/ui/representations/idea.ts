import { N, S, type Representation } from './types';

/** A spark where it starts, on a thread for as long as it lasted (reception threads per region come in Phase 4). */
export const idea: Representation = {
  kind: 'idea',
  glyph: `<path d="M9 1.8l1.7 5.5 5.5 1.7-5.5 1.7L9 16.2l-1.7-5.5L1.8 9l5.5-1.7z" ${N} ${S} stroke-width="1.4" stroke-linejoin="round"/>`,
  point: 'glyph',
  bar: 'thread',
};
