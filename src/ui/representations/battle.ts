import { F, type Representation } from './types';

/** A circled ×: a tick on its war's bar, or a point of its own when it has no war in Chronicle. */
export const battle: Representation = {
  kind: 'battle',
  glyph: `<circle cx="9" cy="9" r="7.5" ${F}/><path d="M6 6l6 6M12 6l-6 6" style="stroke:var(--panel)" stroke-width="1.8"/>`,
  point: 'glyph',
  bar: 'bar',
  badge: true,
};
