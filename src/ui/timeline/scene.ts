import type { Lane, SubjectKind } from '../../model/types';

/**
 * The scene is the contract between the layout (pure) and the painter. Every frame the layout
 * turns (entries, window, size, what is open) into flat lists of primitives in screen pixels, already
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
  // The overview: era and region names in spaced small caps, dates and the axis in old-style numerals.
  era: '600 15px "Spectral SC", Spectral, Georgia, serif',
  region: '600 14px "Spectral SC", Spectral, Georgia, serif',
  eraDates: '12.5px Spectral, Georgia, serif',
  tick0: '12.5px Spectral, Georgia, serif',
  tick0B: '600 12.5px Spectral, Georgia, serif',
  // The overview: polities' names in small caps on their strips, region parents above their regions,
  // eras' names in italic on their wash, world events' names in Spectral.
  pol: '600 12.5px "Spectral SC", Spectral, Georgia, serif',
  polSub: '11.5px Spectral, Georgia, serif',
  parent: '600 11px "Spectral SC", Spectral, Georgia, serif',
  wash: 'italic 12.5px Spectral, Georgia, serif',
  washIn: 'italic 11px Spectral, Georgia, serif',
  world: '500 12.5px Spectral, Georgia, serif',
  // A theme chip: its label in Spectral, its count in Public Sans.
  chip: '12.5px Spectral, Georgia, serif',
  chipN: '10.5px "Public Sans", system-ui, sans-serif',
  // A lens's lane name in the gutter beside its strip.
  lensName: '600 10px "Public Sans", system-ui, sans-serif',
  // Open lanes: lane names in spaced capitals with their counts, an empty lane's note, the phone's list.
  dim: '600 11.5px "Public Sans", system-ui, sans-serif',
  dimCount: '11px "Public Sans", system-ui, sans-serif',
  note: 'italic 14px Spectral, Georgia, serif',
  item: '14px Spectral, Georgia, serif',
  // An influence's effect in its pill; on the phone, the effect in a line under its entry.
  eff: '600 10.5px "Public Sans", system-ui, sans-serif',
  effLine: '12.5px "Public Sans", system-ui, sans-serif',
  effLineB: '600 12.5px "Public Sans", system-ui, sans-serif',
} as const;
export type FontKey = keyof typeof FONTS;
/** Letter spacing in px, which the font shorthand can't carry: the painter sets it and the layout measures with it. */
export const SPACING: Partial<Record<FontKey, number>> = { era: 0.75, region: 1.7, dim: 0.7, pol: 0.4, parent: 1.6 };
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
/** A kind's glyph (its representation's), or open lanes' diamond for a key moment, `w` px square, drawn in `color`. */
export interface Use extends Base { t: 6; x: number; y: number; w: number; g: SubjectKind | Diamond; color: string }
/** A key moment in open lanes: solid, or hollow with a dashed edge when its date is approximate. */
export type Diamond = 'diamond' | 'diamond-approx';
/** A filled path, such as a migration's bar ending in an arrow point or a polity's strip. `fill: 'gilt'` is a world event's gold leaf. */
export interface Shape extends Base { t: 7; d: string; fill: string; stroke?: string; sw?: number; dash?: boolean }
export type Prim = Rect | Dot | Txt | Ln | Img | Arc | Use | Shape;

/** Who an arrow links: influenced by, influenced, otherwise connected, or Claude's draft. */
export type ArcRole = 'infl-by' | 'infl-on' | 'linked' | 'draft';
export const ARC_ROLES: ArcRole[] = ['infl-by', 'infl-on', 'linked', 'draft'];

/** An arrow to draw when both ends are in view. `label` is written halfway along it. */
export interface Link { fromId: string; toId: string; role: ArcRole; label?: string }

export type MarkKind = 'event' | 'span' | 'person';

export interface Target {
  /** An entry id, "playhead", or a control's id (a lane's toggle, "Fold", a ribbon, an arrow). */
  id: string;
  /** On the open entry: which part a drag moves. */
  grip?: 'body' | 'start' | 'end';
  x: number; y: number; w: number; h: number;
  lane?: string;
  /** It sits in the gutter (open lanes' "Fold" and lane names), where nothing else answers. */
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
  /** Where each entry in view is drawn, for arrows and keyboard focus. */
  boxes: Map<string, Box>;
  /** Open lanes: where each entry is drawn in each of its lanes (`<lane>:<id>`), for the arrows between lanes. */
  laneBoxes: Map<string, Box>;
  plot: Box;
  gutterBox: Box;
  /** Height of all lanes, for vertical scroll limits. */
  contentH: number;
  /** Open lanes: each lane's "Add" under its name, drawn as real buttons so the keyboard reaches them. */
  adds: AddSpot[];
  /** Each band's name (Elsewhere's aside), a real button too: it opens the region's menu, and drags or arrow keys move the band. */
  heads: HeadSpot[];
  /** Each ribbon's target id, with its connections and the two rows it joins in words. */
  ribbons?: Map<string, { ids: string[]; title: string }>;
}

/** Where a band's name is, in px from the host's content edge like the gutter. */
export interface HeadSpot { region: string; label: string; x: number; y: number; w: number; h: number }
/** Where a lane's "Add" button sits, in px from the plot's top left like everything else, and the open lanes it's in. */
export interface AddSpot { lane: Lane; label: string; x: number; y: number; w: number; h: number; block?: string }

export const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, var(--panel))`;
