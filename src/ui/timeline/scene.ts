/**
 * The scene is the contract between the layout (pure) and the painter. Every frame the layout
 * turns (entries, window, size, level) into flat lists of primitives in screen pixels, already
 * culled to what is visible, plus the hit targets. The painter only draws them.
 */

/** Fonts as CSS shorthand: the painter sets them on text, the layout measures with them. */
export const FONTS = {
  span: '13px Spectral, Georgia, serif',
  spanI: 'italic 13px Spectral, Georgia, serif',
  ui: '12px "Public Sans", system-ui, sans-serif',
  lane: '600 13px "Public Sans", system-ui, sans-serif',
  tick: '11.5px "Public Sans", system-ui, sans-serif',
  tickB: '600 11.5px "Public Sans", system-ui, sans-serif',
  head: 'italic 12px Spectral, Georgia, serif',
  count: '600 11px "Public Sans", system-ui, sans-serif',
  play: '12px Spectral, Georgia, serif',
} as const;
export type FontKey = keyof typeof FONTS;

/** Width of `s` in `font`, in px. The app measures with a canvas; tests pass a stub. */
export type Measure = (font: FontKey, s: string) => number;

interface Base {
  /** Stable key, so the painter reuses the same element from frame to frame. */
  k: string;
  /** Opacity. */
  a: number;
  /** Classes, and the entry it draws, for styling and tests. */
  cls?: string;
  id?: string;
}
/** Colors are CSS colors, so `var(--ink)` and `color-mix()` follow the theme without a redraw. */
export interface Rect extends Base { t: 0; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; dash?: boolean; r?: number; sw?: number }
export interface Dot extends Base { t: 1; x: number; y: number; r: number; fill?: string; stroke?: string; dash?: boolean; sw?: number }
export interface Txt extends Base { t: 2; x: number; y: number; s: string; f: FontKey; fill: string; anchor?: 'start' | 'middle' | 'end' }
export interface Ln extends Base { t: 3; x1: number; y1: number; x2: number; y2: number; stroke: string; dash?: boolean; sw?: number }
export interface Img extends Base { t: 4; x: number; y: number; w: number; h: number; href: string }
export type Prim = Rect | Dot | Txt | Ln | Img;

export type MarkKind = 'event' | 'span' | 'person';

/** Marks of one kind that would overlap in one row, drawn as one badge led by the most prominent. */
export interface Cluster {
  kind: MarkKind;
  count: number;
  /** Entry ids, earliest first. */
  members: string[];
  lead: string;
  lane: string;
  /** Decimal years the members cover. */
  s: number;
  e: number;
}

export interface Target {
  /** An entry id, or "cluster" for a cluster, or "playhead". */
  id: string;
  x: number; y: number; w: number; h: number;
  lane?: string;
  cluster?: Cluster;
}

export interface Box { x: number; y: number; w: number; h: number }

export interface Scene {
  /** Lane washes and gridlines, marks, text: clipped to the plot. */
  z: [Prim[], Prim[], Prim[]];
  /** Lane names, clipped to the gutter. */
  gutter: Prim[];
  /** Axis, "now" and the playhead: clipped to the right of the gutter, full height. */
  axis: Prim[];
  targets: Target[];
  clusters: Cluster[];
  plot: Box;
  gutterBox: Box;
  /** Height of all lanes, for vertical scroll limits. */
  contentH: number;
}

export const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, var(--panel))`;
