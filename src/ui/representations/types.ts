import type { SubjectKind } from '../../model/types';

/**
 * How one kind of thing is drawn (docs/vision.md, Representations). For now each kind declares
 * its glyph and its timeline mark; map layers and animation move here in their phases.
 */
export interface Representation {
  kind: SubjectKind;
  /** Its glyph on an 18 px grid, in `currentColor`, as SVG markup: the tray, the editor and the timeline all draw this. */
  glyph: string;
  /** A dated moment: the event's dot, or the glyph itself. */
  point: 'dot' | 'glyph';
  /**
   * A span: a plain bar, a lifeline, a war's bar (its battles are ticks on it), a thread (an
   * idea), a bar ending in an arrow (a migration), or a ground line with a pin (a place).
   */
  bar: 'bar' | 'life' | 'war' | 'thread' | 'arrow' | 'ground';
  /** The glyph sits at the start of its bar, so bars of different kinds can be told apart. */
  badge?: boolean;
}

/** Glyph markup helpers: a stroke in the glyph's colour, a fill in it, and no fill. */
export const S = 'stroke="currentColor"';
export const F = 'fill="currentColor"';
export const N = 'fill="none"';
/** Filled in the panel's colour, so a glyph can sit over a line. */
export const P = 'style="fill:var(--panel)"';
