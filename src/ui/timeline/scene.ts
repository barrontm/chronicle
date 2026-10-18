import type { SubjectKind } from '../../model/types';

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
  arc: 'italic 600 12px "Public Sans", system-ui, sans-serif',
  // Level 0: era and region names in spaced small caps, dates and the axis in old-style numerals.
  era: '600 15px "Spectral SC", Spectral, Georgia, serif',
  region: '600 14px "Spectral SC", Spectral, Georgia, serif',
  eraDates: '12.5px Spectral, Georgia, serif',
  tick0: '12.5px Spectral, Georgia, serif',
  tick0B: '600 12.5px Spectral, Georgia, serif',
  // Level 1: lane names in spaced capitals with their counts, an empty lane's note, the phone's list.
  dim: '600 11.5px "Public Sans", system-ui, sans-serif',
  dimCount: '11px "Public Sans", system-ui, sans-serif',
  note: 'italic 14px Spectral, Georgia, serif',
  item: '14px Spectral, Georgia, serif',
} as const;
export type FontKey = keyof typeof FONTS;
/** Letter spacing in px, which the font shorthand can't carry: the painter sets it and the layout measures with it. */
export const SPACING: Partial<Record<FontKey, number>> = { era: 0.75, region: 1.7, dim: 0.7 };
/** Fonts drawn with old-style numerals. */
export const OLDSTYLE = new Set<FontKey>(['eraDates', 'tick0', 'tick0B']);

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
/** An arrow between two entries: its ends' ids, and the arrowhead (a marker per role). */
export interface Arc extends Base { t: 5; d: string; stroke: string; sw?: number; dash?: boolean; head?: ArcRole; from?: string; to?: string }
/** A kind's glyph (its representation's), or level 1's diamond for a key moment, `w` px square, drawn in `color`. */
export interface Use extends Base { t: 6; x: number; y: number; w: number; g: SubjectKind | Diamond; color: string }
/** Level 1's key moment: solid, or hollow with a dashed edge when its date is approximate. */
export type Diamond = 'diamond' | 'diamond-approx';
/** A filled path, such as a migration's bar ending in an arrow point. */
export interface Shape extends Base { t: 7; d: string; fill: string; stroke?: string; sw?: number }
export type Prim = Rect | Dot | Txt | Ln | Img | Arc | Use | Shape;

/** Who an arrow links: influenced by, influenced, otherwise connected, or Claude's draft. */
export type ArcRole = 'infl-by' | 'infl-on' | 'linked' | 'draft';
export const ARC_ROLES: ArcRole[] = ['infl-by', 'infl-on', 'linked', 'draft'];

/** An arrow to draw when both ends are in view. `label` is written halfway along it. */
export interface Link { fromId: string; toId: string; role: ArcRole; label?: string }

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
  /** An entry id, or "cluster" for a cluster, "playhead", or an open entry's handle. */
  id: string;
  /** On the open entry: which part a drag moves. */
  grip?: 'body' | 'start' | 'end';
  x: number; y: number; w: number; h: number;
  lane?: string;
  cluster?: Cluster;
  /** It sits in the gutter (level 1's "All eras"), where nothing else answers. */
  gutter?: boolean;
}

export interface Box { x: number; y: number; w: number; h: number }

export interface Scene {
  /** Lane washes and gridlines, marks, text, then arrows: clipped to the plot. */
  z: [Prim[], Prim[], Prim[], Prim[]];
  /** Lane names, clipped to the gutter. */
  gutter: Prim[];
  /** Axis, "now" and the playhead: clipped to the right of the gutter, full height. */
  axis: Prim[];
  targets: Target[];
  clusters: Cluster[];
  /** Where each entry in view is drawn (a cluster's members share its box), for arrows and keyboard focus. */
  boxes: Map<string, Box>;
  plot: Box;
  gutterBox: Box;
  /** Height of all lanes, for vertical scroll limits. */
  contentH: number;
}

export const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, var(--panel))`;
