import { axisTicks, formatRange, formatYear, toDecimalYear } from '../../model/dates';
import { ELSEWHERE, type Era, type EraRegion, type EraTheme } from '../../model/eras';
import type { LensMarks } from '../../model/lenses';
import type { OGroup, OPolity, Overview } from '../../model/overview';
import { areaWeight, strengthAt, strengthKnown, stripShare, UNKNOWN_SHARE } from '../../model/strength';
import { describeEffect, laneInfluences, type LaneInfluence } from '../../model/doc';
import { LANES, type DatedItem, type Lane, type Relation } from '../../model/types';
import { anchors, arcCurve, loopCurve, type Box as Edges } from '../influenceLinks';
import { markOf, representationOf, type Representation } from '../representations';
import { chipLines, chipPrims, CHIP_LINE, innerPrims, packChips, themeKey, washPrims, type ChipBox } from '../representations/era';
import { ARROW, arrowPrims, RIBBON, ribbonPrims, type ArrowIn, type RibbonIn } from '../representations/influence';
import { threadLabel, threadsAround, type Thread } from '../../model/threads';
import { stripPrims, type StripLook } from '../representations/polity';
import type { YearWindow } from '../timeNav';
import { LANE_LABEL, PIGMENT } from '../util';
import { tint, type Box, type Link, type MarkKind, type Measure, type Prim, type Scene, type Target } from './scene';

/**
 * The timeline's layout: pure. `prepare` runs once per data change (sorted indexes, bands);
 * `layout` runs every frame and returns only what is visible.
 *
 * The timeline is the overview: a band per region with its polities as strips
 * (`representations/polity.ts`) over its eras (`representations/era.ts`), world events in gold, and
 * the entries Bob shows at the top. Opening a polity, a world event or an era unfurls its six lanes
 * (`polityLanes`, `eraLanes`) right under it, in the same years; several can be open at once.
 */

export const AXIS_H = 44;
/** Every row is a hit target at least this tall (spans and points need 24 px to tap). */
export const ROW_H = 28;
export const MIN_HIT = 24;
/** A moment drawn as its kind's glyph is this many px across. */
export const GLYPH = 16;
/** The open entry's ends can be dragged within this many px of them. */
export const GRIP_PX = 8;
const PAD_BOTTOM = 8;
const LANE_MIN = 44;
/** Labels shorter than this are hidden rather than cut short (docs/design.md, Density). */
const MIN_LABEL = 48;
const UMBER = 'var(--pig-umber)';

/** A category shown: entries in a hidden one leave the timeline. */
export interface LaneInput { id: string; label: string; color: string }

export interface PItem {
  id: string;
  /** Its mark: a moment, a span or a life. */
  kind: MarkKind;
  /** How its kind of thing is drawn. */
  rep: Representation;
  title: string;
  /** Its dates in words, for the tooltip; `dates` without "c." for where a dashed edge already says so. */
  when: string;
  dates: string;
  s: number;
  e: number;
  approx: boolean;
  endApprox: boolean;
  /** A life without an end yet (drawn to today): its end can't be dragged. */
  open: boolean;
  /** Claude's draft, waiting for Bob: a dashed umber ghost that can't be opened or moved. */
  draft: boolean;
  /** A world event (gold on the overview). */
  world?: boolean;
}

/** An era: the row it sits in inside its region. */
export interface PEra extends Era { row: number }
export interface PRegion {
  name: string;
  /** Its name, or "Elsewhere". */
  label: string;
  highlights: number;
  eras: PEra[];
  rows: number;
}

/** A polity, whether anything is known of its strength, and which of its tone's two shades it takes. */
export interface PPolity extends OPolity { unknown: boolean; alt: boolean }
/** A group of city-states, folded into one strip until it's clicked. */
export interface PGroup extends Omit<OGroup, 'members'> { members: PPolity[]; alt: boolean }
export type Slot = { pol: PPolity; group?: undefined } | { group: PGroup; pol?: undefined };
/** A world event gilding a band: named there if it's its home. */
export interface PWorld { it: PItem; home: boolean }
/** A region's band. */
export interface PBand {
  name: string;
  label: string;
  parent?: string;
  /** The first band under its parent carries the parent's rule. */
  parentHead: boolean;
  tone: number;
  /** Sub-rows, with groups folded: a succession shares one. */
  subs: Slot[][];
  /** Its eras, outer ones first: the backdrop. */
  eras: PEra[];
  worlds: PWorld[];
  /** Whether any world event is named here, which gives it a line of its own. */
  named: boolean;
  /** Lenses: the entries in each lane here, earliest first, for a lens's ticks. */
  lens: ReadonlyMap<Lane, PItem[]>;
}
export interface Prepared {
  byId: Map<string, PItem>;
  prominence: (id: string) => number;
  /** Regions with their eras. */
  regions: PRegion[];
  /** Bands in their order, the top row, and the years they cover. */
  bands: PBand[];
  top: PItem[];
  polById: Map<string, PPolity>;
  groupById: Map<string, PGroup>;
  overviewExtent?: YearWindow;
  /** Every connection, for the influences between lanes. */
  relations: readonly Relation[];
  /** Connections rolled up by polity or era (`threads`), heaviest first. */
  threads: readonly Thread[];
}

export interface PrepareOptions {
  /** Where lives without an end stop: today, as a decimal year. */
  now: number;
  prominence?: (id: string) => number;
  /** Claude's drafts waiting for Bob, drawn as ghosts in the lanes they'd sit in. */
  drafts?: DatedItem[];
  relations?: Relation[];
  /** The eras in their regions (`eraRegions`). */
  eras?: EraRegion[];
  /** The overview (`overview` in `src/model/overview.ts`). */
  overview?: Overview;
  /** Threads between polities and eras (`threads` in `src/model/threads.ts`). */
  threads?: readonly Thread[];
  /** Each region's entries per lane, for the lenses (`lensMarks` in `src/model/lenses.ts`). */
  lenses?: LensMarks;
}

export function prepare(items: DatedItem[], shown: LaneInput[], o: PrepareOptions): Prepared {
  const byId = new Map<string, PItem>();
  const cats = new Set(shown.map((l) => l.id));
  const add = (ref: DatedItem, draft: boolean) => {
    if (!cats.has(ref.categoryId) || byId.has(ref.id)) return;
    const s = toDecimalYear(ref.start);
    // A living person, or a place still there, has no end; draw them up to today.
    const e = ref.kind === 'event' ? s : ref.end ? toDecimalYear(ref.end) : o.now;
    byId.set(ref.id, {
      id: ref.id, kind: markOf(ref), rep: representationOf(ref), title: ref.title, when: formatRange(ref.start, ref.end),
      dates: formatRange({ ...ref.start, approx: undefined }, ref.end && { ...ref.end, approx: undefined }),
      s, e: Math.max(e, s), approx: !!ref.start.approx, endApprox: !!ref.end?.approx, open: ref.kind !== 'event' && !ref.end, draft,
      world: ref.overview === 'world' || undefined,
    });
  };
  for (const ref of items) add(ref, false);
  for (const ref of o.drafts ?? []) add(ref, true);
  const prominence = o.prominence ?? (() => 0);
  const eras = prepareEras(o.eras ?? [], byId);
  return { byId, prominence, relations: o.relations ?? [], threads: o.threads ?? [], ...eras, ...prepareOverview(o.overview, eras.regions, byId, o.lenses) };
}

/** The eras in each region. Inside one, eras pack into rows by time only, outer eras above the eras inside them. */
function prepareEras(input: EraRegion[], byId: Map<string, PItem>): Pick<Prepared, 'regions'> {
  const regions = input.map((r): PRegion => {
    const shown = r.eras.filter((e) => byId.has(e.id) && !byId.get(e.id)!.draft);
    const ids = new Set(shown.map((e) => e.id));
    const byEra = new Map(shown.map((e) => [e.id, e]));
    const depth = (e: Era) => { let d = 0; for (let p = e.parent; p && ids.has(p) && d < 50; p = byEra.get(p)!.parent) d++; return d; };
    const eras = shown.map((e): PEra => ({ ...e, row: 0 }));
    const rowEnd: number[] = [];
    const levels = [...new Set(eras.map(depth))].sort((a, b) => a - b);
    for (const d of levels) {
      const first = rowEnd.length;
      for (const e of eras) {
        if (depth(e) !== d) continue;
        let row = rowEnd.findIndex((end, i) => i >= first && end <= e.s);
        if (row < 0) row = rowEnd.length;
        rowEnd[row] = e.e;
        e.row = row;
      }
    }
    return { name: r.name, label: r.name === ELSEWHERE ? 'Elsewhere' : r.name, highlights: r.highlights, eras, rows: rowEnd.length };
  }).filter((r) => r.eras.length);
  return { regions };
}

/**
 * The bands, in the overview's order. Inside a band, polities (and folded groups) pack
 * into sub-rows by time only, so a succession shares one and rows stay put while zooming.
 */
function prepareOverview(O: Overview | undefined, regions: PRegion[], byId: Map<string, PItem>, lenses?: LensMarks): Pick<Prepared, 'bands' | 'top' | 'polById' | 'groupById' | 'overviewExtent'> {
  const polById = new Map<string, PPolity>(), groupById = new Map<string, PGroup>();
  let lo = Infinity, hi = -Infinity;
  const span = (s: number, e: number) => { lo = Math.min(lo, s); hi = Math.max(hi, e); };
  for (const R of regions) for (const e of R.eras) span(e.s, e.e);
  const top = (O?.top ?? []).map((id) => byId.get(id)).filter((p): p is PItem => !!p && !p.draft);
  for (const it of top) span(it.s, it.e);
  if (!O) return { bands: [], top, polById, groupById, overviewExtent: lo <= hi ? { start: lo, end: hi } : undefined };
  for (const p of O.polities) { polById.set(p.id, { ...p, unknown: !strengthKnown(p.t), alt: false }); span(p.s, p.e); }
  for (const g of O.groups) groupById.set(g.id, { ...g, members: g.members.map((id) => polById.get(id)!), alt: false });
  const eraRegion = new Map(regions.map((R) => [R.name, R]));
  let lastParent: string | undefined;
  const bands = O.regions.map((r, i): PBand => {
    const slots: Slot[] = [
      ...[...groupById.values()].filter((g) => g.region === r.name).map((group) => ({ group })),
      ...[...polById.values()].filter((p) => p.region === r.name && !p.group).map((pol) => ({ pol })),
    ];
    const s0 = (x: Slot) => (x.pol ?? x.group).s, e0 = (x: Slot) => (x.pol ?? x.group).e;
    slots.sort((a, b) => s0(a) - s0(b) || e0(b) - e0(a) || (a.pol ?? a.group).id.localeCompare((b.pol ?? b.group).id));
    const subs: Slot[][] = [], ends: number[] = [];
    for (const x of slots) {
      let k = ends.findIndex((end) => end <= s0(x));
      if (k < 0) { k = subs.length; subs.push([]); }
      // Neighbours in a succession take the two shades in turn.
      const alt = subs[k].length % 2 === 1;
      if (x.pol) x.pol.alt = alt; else { x.group.alt = alt; x.group.members.forEach((m, j) => (m.alt = j % 2 === 1)); }
      subs[k].push(x);
      ends[k] = e0(x);
    }
    const worlds = O.worlds.filter((w) => w.touches.includes(r.name) && byId.has(w.id)).map((w) => ({ it: byId.get(w.id)!, home: w.home === r.name }));
    for (const w of worlds) span(w.it.s, w.it.e);
    const eras = [...(eraRegion.get(r.name)?.eras ?? [])].sort((a, b) => a.row - b.row || a.s - b.s);
    const parentHead = !!r.parent && (i === 0 || r.parent !== lastParent);
    lastParent = r.parent;
    const lens = new Map([...(lenses?.get(r.name) ?? [])].map(([l, ids]) => [l, ids.flatMap((id) => byId.get(id) ?? [])] as const));
    return { name: r.name, label: r.label, parent: r.parent, parentHead, tone: r.tone, subs, eras, worlds, named: worlds.some((w) => w.home), lens };
  });
  return { bands, top, polById, groupById, overviewExtent: lo <= hi ? { start: lo, end: hi } : undefined };
}

/* ---------- the overview's geometry ---------- */

/** Below this width levels 0 and 1 have no gutter: each region's name sits on its band. */
export const PHONE_W = 600;
/** The top row: entries Bob shows in the overview, in up to three rows. */
const TOP_ROWS = 3;
const TOP_ROW_H = 20;
const TOP_PAD = 6;
const PARENT_H = 24;
/** A band, top to bottom: the gold of world events, the line with its eras' names, a line naming its world events, then its sub-rows. */
const GOLD_H = 9;
const HEAD_LINE = 18;
const WORLD_LINE = 16;
const SUB_H = 32;
const SUB_H_PHONE = 30;
const EMPTY_H = 22;
const BAND_PAD = 6;
/** A lens's strip under a band's rows. */
export const LENS_H = 10;
/** The gap between bands, kept free for threads (Phase 4b). */
const BAND_GAP = 10;
/** A region focused from the map: its rows grow by this, and the other bands fade to `REGION_FADE`. */
export const REGION_GROW = 1.3;
const REGION_FADE = 0.4;

/** A sub-row on screen: what's in it, how tall and how faded (a group's members while it unfolds), and the group whose members it holds. */
interface SubGeo { slots: Slot[]; y: number; h: number; a: number; group?: PGroup; folding?: number }
/** Lanes unfurled in place: what's open (`key`), where they start, how tall they are now and once open, and how far open. */
interface BlockGeo { key: string; EL: EraLanes; y: number; h: number; full: number; t: number }
interface BandGeo { B: PBand; top: number; bottom: number; empty: boolean; headY: number; worldY: number; subs: SubGeo[]; blocks: BlockGeo[]; chips: ChipBox[]; chipY: number; lensY: number }
/** What the geometry needs of the screen: band heights depend on how many lines their theme chips take. */
export type Fit = Pick<Env, 'w' | 'gutter' | 'measure'>
/** What the geometry needs of the view. */
export type GeoView = Pick<View, 'win' | 'unfolded' | 'region' | 'lenses' | 'opened' | 'openT' | 'openFade' | 'theme'>;
interface Geo { topH: number; topBlocks: BlockGeo[]; bands: BandGeo[]; H: number }

const inWin = (x: { s: number; e: number }, win: YearWindow) => x.e >= win.start && x.s <= win.end;
const unfoldOf = (V: Pick<View, 'unfolded'>, id: string) => V.unfolded?.get(id) ?? 0;

/** Outer eras in a band (the backdrop's washes); inner ones are drawn as rules. */
const outerEras = (B: PBand) => B.eras.filter((e) => !e.parent || !B.eras.some((o) => o.id === e.parent));

/** A band's theme chips: each outer era's in view, then its inner eras', packed inside the era's years (as much of them as is in view). */
function bandChips(B: PBand, win: YearWindow, F: Fit): ChipBox[] {
  const x0 = F.gutter, x1 = F.w, ppy = (x1 - x0) / (win.end - win.start);
  const X = (y: number) => x0 + (y - win.start) * ppy;
  const out: ChipBox[] = [];
  for (const e of outerEras(B)) {
    if (!inWin(e, win)) continue;
    const inner = (id: string): PEra[] => B.eras.filter((o) => o.parent === id).flatMap((o) => [o, ...inner(o.id)]);
    const chips = [e, ...inner(e.id)].flatMap((x) => x.themes.map((theme) => ({ era: x.id, theme })));
    if (chips.length) out.push(...packChips(chips, Math.max(X(e.s), x0) + 6, Math.min(X(e.e), x1) - 6, F.measure));
  }
  return out;
}

/** Open lanes: their head (name, dates, theme chips), the lanes, and a little room under them. */
const BLOCK_PAD = 8;
export const blockH = (EL: EraLanes, F: Fit, picked?: string) => head1H(EL, F, picked) + lanesH(EL, F.w < PHONE_W) + BLOCK_PAD;

/** Where every band, sub-row and open set of lanes sits, in px from the top of the content (under the axis). */
function overviewGeo(D: Prepared, V: GeoView, F: Fit): Geo {
  const phone = F.w < PHONE_W;
  const base = phone ? SUB_H_PHONE : SUB_H;
  const topH = D.top.length ? TOP_PAD * 2 + Math.min(TOP_ROWS, D.top.length) * TOP_ROW_H : 0;
  let y = topH;
  /** Lanes open for `key` go here, pushing what's under them down as they unfurl. */
  const block = (out: BlockGeo[], key: string) => {
    const EL = V.opened?.get(key);
    if (!EL) return;
    const t = V.openT?.get(key) ?? 1, full = blockH(EL, F, V.theme?.key);
    const h = V.openFade ? full : full * t;
    out.push({ key, EL, y, h, full, t });
    y += h;
  };
  // A world event no polity places opens under the top row.
  const topBlocks: BlockGeo[] = [];
  for (const it of D.top) if (it.world && !D.bands.some((B) => B.worlds.some((w) => w.home && w.it.id === it.id))) block(topBlocks, it.id);
  const bands = D.bands.map((B): BandGeo => {
    // The region Bob clicked on the map: its rows grow.
    const sub = B.name === V.region ? base * REGION_GROW : base;
    if (B.parentHead) y += PARENT_H;
    const top = y;
    const headY = top + GOLD_H + 13;
    y += GOLD_H + HEAD_LINE;
    // Theme chips never hide: the band grows a line for each line they need.
    const chips = bandChips(B, V.win, F), chipY = y;
    y += chipLines(chips) * CHIP_LINE;
    const worldY = y + 12;
    if (B.named) y += WORLD_LINE;
    // An era or a world event at home here opens under the band's head.
    const blocks: BlockGeo[] = [];
    for (const e of B.eras) block(blocks, e.id);
    for (const w of B.worlds) if (w.home) block(blocks, w.it.id);
    // A band with no polities in the years in view is one thin row that says so.
    const empty = !B.subs.some((row) => row.some((x) => inWin(x.pol ?? x.group, V.win)));
    const subs: SubGeo[] = [];
    if (empty) {
      y += EMPTY_H;
      for (const row of B.subs) for (const x of row) for (const p of x.pol ? [x.pol] : x.group.members) block(blocks, `pol:${p.id}`);
    } else for (const row of B.subs) {
      const groups = row.flatMap((x) => (x.group ? [x.group] : []));
      const most = Math.max(0, ...groups.map((g) => unfoldOf(V, g.id)));
      // A row of folded groups only gives way to their members as they unfold.
      const h = groups.length === row.length ? sub * (1 - most) : sub;
      subs.push({ slots: row, y, h, a: 1 });
      y += h;
      // A polity's lanes open right under its strip; a member's under its own row once its group unfolds.
      for (const x of row) if (x.pol) block(blocks, `pol:${x.pol.id}`);
      for (const g of groups) {
        const f = unfoldOf(V, g.id);
        if (f <= 0) { for (const m of g.members) block(blocks, `pol:${m.id}`); continue; }
        for (const m of g.members) {
          subs.push({ slots: [{ pol: m }], y, h: sub * f, a: f, group: g, folding: f });
          y += sub * f;
          block(blocks, `pol:${m.id}`);
        }
      }
    }
    // Lenses: a thin strip each under the rows; they never move what's above them.
    const lensY = y + 2;
    if (V.lenses?.length) y += 2 + V.lenses.length * LENS_H;
    y += BAND_PAD;
    const bottom = y;
    y += BAND_GAP;
    return { B, top, bottom, empty, headY, worldY, subs, blocks, chips, chipY, lensY };
  });
  return { topH, topBlocks, bands, H: y };
}

/** Every set of open lanes, top to bottom. */
const blocksOf = (G: Geo) => [...G.topBlocks, ...G.bands.flatMap((g) => g.blocks)];

/** How far down an era's band is, in px from the top of the content. */
export function eraSpan(D: Prepared, V: GeoView, id: string, F: Fit): [number, number] | undefined {
  const g = overviewGeo(D, V, F).bands.find((b) => b.B.eras.some((e) => e.id === id));
  return g && [g.top, g.bottom];
}

/** How far down a region's band is, in px from the top of the content. */
export function regionSpan(D: Prepared, V: GeoView, name: string, F: Fit): [number, number] | undefined {
  const g = overviewGeo(D, V, F).bands.find((b) => b.B.name === name);
  return g && [g.top - (g.B.parentHead ? PARENT_H : 0), g.bottom];
}

/** How far down a polity's strip is (its folded group's while folded), in px from the top of the content. */
export function stripSpan(D: Prepared, V: GeoView, polId: string, F: Fit): [number, number] | undefined {
  for (const g of overviewGeo(D, { ...V, openT: undefined }, F).bands) for (const sg of g.subs) {
    if (sg.h < 2) continue;
    if (sg.slots.some((x) => x.pol?.id === polId || (x.group && unfoldOf(V, x.group.id) < 0.5 && x.group.members.some((m) => m.id === polId)))) return [sg.y, sg.y + sg.h];
  }
  return undefined;
}

/** How far down the open lanes for `key` are once open, in px from the top of the content. */
export function blockSpan(D: Prepared, V: GeoView, key: string, F: Fit): [number, number] | undefined {
  const b = blocksOf(overviewGeo(D, { ...V, openT: undefined }, F)).find((x) => x.key === key);
  return b && [b.y, b.y + b.full];
}

/** Where an entry sits in the open lanes (the first set that has it), in px from the top of the content, as drawn once open. */
export function openSpan(D: Prepared, V: GeoView, id: string, F: Fit): [number, number] | undefined {
  for (const b of blocksOf(overviewGeo(D, { ...V, openT: undefined }, F))) {
    const ys = lane1Span(b.EL, id, F.w < PHONE_W);
    if (!ys) continue;
    const off = b.y + head1H(b.EL, F, V.theme?.key);
    return [off + ys[0], off + ys[1]];
  }
  return undefined;
}

/** The arrow keys on the overview's eras: ←/→ the era before or after in its region, ↑/↓ the nearest in time in the region above or below. */
export function stepEra(D: Prepared, activeId: string | undefined, key: StepKey, win: YearWindow): string | undefined {
  const nearest = (list: PEra[], y: number) => list.reduce<PEra | undefined>((b, e) => (!b || Math.abs(e.s - y) < Math.abs(b.s - y) ? e : b), undefined);
  const ri = D.regions.findIndex((R) => R.eras.some((e) => e.id === activeId));
  if (ri < 0) return nearest(D.regions.flatMap((R) => R.eras), (win.start + win.end) / 2)?.id;
  const list = D.regions[ri].eras;
  const i = list.findIndex((e) => e.id === activeId);
  switch (key) {
    case 'ArrowLeft': return list[Math.max(0, i - 1)].id;
    case 'ArrowRight': return list[Math.min(list.length - 1, i + 1)].id;
    case 'Home': return list[0].id;
    case 'End': return list[list.length - 1].id;
    default: {
      const R = D.regions[ri + (key === 'ArrowUp' ? -1 : 1)];
      return R ? nearest(R.eras, list[i].s)!.id : activeId;
    }
  }
}

/** What a screen reader says for an era: "Classical Greece, 480–323 BCE, Greece, 38 highlights, 2 of 6". */
export function describeEra(D: Prepared, id: string): string {
  for (const R of D.regions) {
    const i = R.eras.findIndex((e) => e.id === id);
    if (i < 0) continue;
    const e = R.eras[i];
    return `${e.title}, ${e.when}, ${R.label}, ${e.highlights} ${e.highlights === 1 ? 'highlight' : 'highlights'}, ${i + 1} of ${R.eras.length}`;
  }
  return '';
}

/* ---------- the arrow keys ---------- */

export type StepKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

/** The arrow keys through lanes of entries, each in time order; `li` is the active entry's lane. */
function stepThrough(lanes: PItem[][], li: number | undefined, activeId: string | undefined, key: StepKey, win: YearWindow): string | undefined {
  const nearest = (list: PItem[], y: number) => list.reduce<PItem | undefined>((b, it) => (!b || Math.abs(it.s - y) < Math.abs(b.s - y) ? it : b), undefined);
  const list = li === undefined ? undefined : lanes[li];
  const i = list ? list.findIndex((x) => x.id === activeId) : -1;
  if (!list || i < 0) return nearest(lanes.flat(), (win.start + win.end) / 2)?.id;
  switch (key) {
    case 'ArrowLeft': return list[Math.max(0, i - 1)].id;
    case 'ArrowRight': return list[Math.min(list.length - 1, i + 1)].id;
    case 'Home': return list[0].id;
    case 'End': return list[list.length - 1].id;
    default: {
      const dir = key === 'ArrowUp' ? -1 : 1;
      for (let j = li! + dir; j >= 0 && j < lanes.length; j += dir) {
        const hit = nearest(lanes[j], list[i].s);
        if (hit) return hit.id;
      }
      return activeId;
    }
  }
}

/* ---------- the frame ---------- */

export interface View {
  win: YearWindow;
  scrollY: number;
  selected?: string;
  hover?: string;
  /** The map's year, drawn as a playhead. */
  playYear?: number;
  /** Today, as a decimal year. */
  now: number;
  /** When an entry is open and has connections: each lit entry's role; everyone else fades. */
  roles?: Map<string, string>;
  /** Arrows between entries, drawn when both ends are in view. */
  links?: Link[];
  /** The open entry's dates can be dragged. */
  editable?: boolean;
  /** The open entry while it's dragged: where it would go, its new dates in words, the top of its row and its lane's color. */
  drag?: { id: string; s: number; e: number; label: string; y: number; color: string };
  /** The entry the arrow keys are on, and whether to ring it (only while the timeline has keyboard focus). */
  active?: string;
  ring?: boolean;
  /** What's unfurled in place (`pol:<territory>`, a world event's id or an era's id), in the order opened. */
  opened?: ReadonlyMap<string, EraLanes>;
  /** How far each is open (0 to 1) while it unfurls or folds; 1 when missing. */
  openT?: ReadonlyMap<string, number>;
  /** With reduced motion lanes only fade in and out, already at their full height. */
  openFade?: boolean;
  /** Entries box-selected for bulk edit, each ringed. */
  picked?: ReadonlySet<string>;
  /** The strip or world event picked (`pol:<territory>`, or a world event's id), outlined in ink. */
  pick?: string;
  /** How far open each group is (0 folded, 1 open), while it unfolds and after. */
  unfolded?: ReadonlyMap<string, number>;
  /** The box Bob is drawing with ⌘ or Ctrl held, in px. */
  box?: Box;
  /** The region Bob clicked on the map; its rows grow and the other bands fade. */
  region?: string;
  /** The theme chip picked in open lanes (`<era>:<theme>`) and what's in it; everything else fades. */
  theme?: { key: string; ids: ReadonlySet<string> };
  /** The strip, group or era hovered for its threads (it stays while the pointer moves onto them). */
  threadHover?: string;
  /** "Show all threads", every ribbon faintly (laptop only). */
  allThreads?: boolean;
  /** The lenses on, in pigment order: a strip of each lane's ticks under every band. */
  lenses?: readonly Lane[];
}

export interface Env {
  w: number;
  h: number;
  /** Width of the lane names on the left. */
  gutter: number;
  measure: Measure;
}

interface Ctx { D: Prepared; V: View; E: Env; S: Scene; X: (y: number) => number; x0: number; x1: number; top: number; bottom: number; involved?: ReadonlySet<string> }

/** A screen `w` px wide with no gutter, measuring about 7 px a character: for callers that only know the width. */
const roughFit = (w: number): Fit => ({ w, gutter: 0, measure: (_, t) => t.length * 7 });

/** How far the overview (with whatever lanes are open) can scroll. */
export function maxScroll(D: Prepared, h: number, fit: Fit | number, V: GeoView): number {
  const F = typeof fit === 'number' ? roughFit(fit) : fit;
  return Math.max(0, overviewGeo(D, V, F).H - (h - AXIS_H) + 8);
}

/** Text cut short with an ellipsis to fit `avail` px, or '' when even that won't fit. */
function fit(M: Measure, font: Parameters<Measure>[0], s: string, avail: number): string {
  if (M(font, s) <= avail) return s;
  const ell = M(font, '…');
  if (avail <= ell) return '';
  let n = s.length - 1;
  while (n > 0 && M(font, s.slice(0, n)) + ell > avail) n--;
  return n > 0 ? `${s.slice(0, n).trimEnd()}…` : '';
}

/** A label of `lw` px in `room` px: whole, cut short, or hidden below 48 px. */
function placeLabel(M: Measure, font: Parameters<Measure>[0], s: string, room: number): string {
  if (M(font, s) <= room) return s;
  return room >= MIN_LABEL ? fit(M, font, s, room) : '';
}

/** A draft's name says it's waiting for Bob. */
const titleOf = (it: PItem) => (it.draft ? `${it.title} ?` : it.title);

/** The extra class an entry gets while an entry with connections is open: its role, or faded. */
function roleOf(V: View, it: PItem): string {
  if (it.draft) return '';
  if (V.theme && !V.theme.ids.has(it.id)) return ' dimmed';
  if (!V.roles) return '';
  return ` ${V.roles.get(it.id) ?? 'dimmed'}`;
}
/** The outline that lights up an influence: amber for who influenced, blue for whom. */
const ROLE_STROKE: Record<string, string> = { 'infl-by': 'var(--glow-by)', 'infl-on': 'var(--glow-on)', linked: 'var(--muted)' };

export function layout(D: Prepared, V: View, E: Env): Scene {
  const x0 = E.gutter, x1 = E.w;
  const S: Scene = {
    z: [[], [], [], []], gutter: [], axis: [], targets: [], boxes: new Map(), laneBoxes: new Map(),
    plot: { x: x0, y: AXIS_H, w: Math.max(0, x1 - x0), h: Math.max(0, E.h - AXIS_H) },
    gutterBox: { x: 0, y: AXIS_H, w: x0, h: Math.max(0, E.h - AXIS_H) },
    contentH: overviewGeo(D, V, E).H,
    adds: [],
  };
  const span = V.win.end - V.win.start;
  const ppy = (x1 - x0) / span;
  const X = (y: number) => x0 + (y - V.win.start) * ppy;
  const c: Ctx = { D, V, E, S, X, x0, x1, top: AXIS_H, bottom: E.h };
  overviewRows(c);
  // An influence between lanes is drawn as its own arrow, not again as the open entry's connection.
  arrows(c, new Set([...(V.opened?.values() ?? [])].flatMap((EL) => EL.influences.map((x) => `${x.r.fromId}>${x.r.toId}`))));
  picks(c);
  focusRing(c);
  dragPreview(c);
  axis(c);
  return S;
}

/* ---------- the overview ---------- */

/** A world event's gold: a bar along the band's top (thinner away from home), or a dot for a moment. */
function gold(c: Ctx, w: PItem, y: number, home: boolean, k: string, h = home ? 7 : 3) {
  const { V, S, X } = c;
  const xa = X(w.s), xb = Math.max(xa + 2, X(w.e));
  const picked = V.pick === w.id || V.selected === w.id;
  const sw = picked ? 1.6 : 0.6;
  const role = roleOf(V, w);
  if (xb - xa > 6) S.z[1].push({ t: 0, k: `wg${k}`, a: 1, cls: `tl-world${role}`, id: w.id, x: xa, y, w: xb - xa, h, r: 1.5, fill: 'gilt', stroke: 'var(--gold-ink)', sw });
  else S.z[1].push({ t: 1, k: `wg${k}`, a: 1, cls: `tl-world${role}`, id: w.id, x: xa, y: y + h / 2, r: home ? 4.5 : 2.5, fill: 'gilt', stroke: 'var(--gold-ink)', sw: picked ? 1.6 : 0.8 });
  return [xa, xb] as const;
}

function overviewRows(c: Ctx) {
  const { D, V, E, S, x0, x1 } = c;
  if (!D.bands.length && !D.top.length) {
    const cx = (x0 + x1) / 2, cy = AXIS_H + Math.min(120, (E.h - AXIS_H) / 3);
    S.z[2].push({ t: 2, k: 'empty', a: 1, cls: 'tl-empty', x: cx, y: cy, s: 'Nothing on the timeline yet', f: 'era', fill: 'var(--ink-2)', anchor: 'middle' });
    S.z[2].push({ t: 2, k: 'empty2', a: 1, cls: 'tl-empty', x: cx, y: cy + 22, s: 'Polities and periods you add show here, in a band for each region. Open one to see what’s in it.', f: 'ui', fill: 'var(--muted)', anchor: 'middle' });
    return;
  }
  const phone = E.w < PHONE_W;
  const G = overviewGeo(D, V, E);
  const base = AXIS_H - V.scrollY;
  // The widest polity in view fills its row: the rest are scaled to it.
  let widest = 0;
  for (const p of D.polById.values()) {
    if (!inWin(p, V.win) || p.t.strength?.length) continue;
    const a = Math.max(p.s, V.win.start), b = Math.min(p.e, V.win.end);
    for (let k = 0; k <= 24; k++) {
      const st = strengthAt(p.t, a + ((b - a) * k) / 24);
      if (st.by === 'area') widest = Math.max(widest, areaWeight(st.km2));
    }
  }
  const shareOf = (p: PPolity) => (p.unknown ? () => UNKNOWN_SHARE : (y: number) => stripShare(strengthAt(p.t, y), widest));
  if (G.topH) topRow(c, base, G.topH);
  for (const b of G.topBlocks) inlineBlock(c, b, base);
  const ribbons = threadRibbons(c, G, base);
  if (ribbons.involved) c.involved = ribbons.involved;
  const focus = V.region && D.bands.some((B) => B.name === V.region) ? V.region : undefined;
  for (const g of G.bands) {
    const top = base + g.top, bottom = base + g.bottom;
    if (g.B.parentHead) parentRule(c, g.B, top - PARENT_H, phone);
    if (bottom < AXIS_H || top > E.h) continue;
    // Every band but the focused region's fades, still there to read.
    const from = [...S.z.map((z) => z.length), S.gutter.length];
    band(c, g, base, phone, shareOf);
    for (const b of g.blocks) inlineBlock(c, b, base);
    if (focus && g.B.name !== focus) {
      S.z.forEach((z, i) => { for (let k = from[i]; k < z.length; k++) z[k] = { ...z[k], a: z[k].a * REGION_FADE }; });
      for (let k = from[4]; k < S.gutter.length; k++) S.gutter[k] = { ...S.gutter[k], a: S.gutter[k].a * REGION_FADE };
    }
  }
  // Threads over the strips, their labels with the text.
  const names = ribbons.list.some((r) => r.focus) ? S.z[2].flatMap((p) => { const b = textBox(E.measure, p); return b ? [b] : []; }) : [];
  const { marks, labels, targets } = ribbonPrims(ribbons.list, E.measure, { x0, x1, y0: AXIS_H, y1: E.h }, names);
  S.z[1].push(...marks);
  S.z[2].push(...labels);
  S.targets.push(...targets);
  if (ribbons.list.length) S.ribbons = ribbons.ids;
}

/** Strips the threads don't touch fade to this. */
const THREAD_FADE = 0.35;
/** A row a thread end is drawn in: its key (`pol:`, `grp:` or an era's id), its middle and band, and its name. */
interface ThreadRow { key: string; y: number; band: number; title: string }

/** The thread ends a hovered or picked strip, group or era stands for (an inner era's are its outer era's). */
function threadFocus(D: Prepared, id: string | undefined): string[] | undefined {
  if (!id) return undefined;
  if (id.startsWith('pol:')) return [id];
  if (id.startsWith('grp:')) return D.groupById.get(id.slice(4))?.members.map((m) => `pol:${m.id}`);
  for (const B of D.bands) {
    let e = B.eras.find((x) => x.id === id);
    if (!e) continue;
    for (let n = 0; e.parent && n < 20; n++) e = B.eras.find((x) => x.id === e!.parent) ?? e;
    return [e.id];
  }
  return undefined;
}

/** Whether a strip, group or era has threads to light up. */
export function hasThreads(D: Prepared, id: string | undefined): boolean {
  const ends = threadFocus(D, id);
  return !!ends && D.threads.some((t) => ends.includes(t.a) || ends.includes(t.b));
}

/**
 * The threads (docs/design.md, Long range: Threads): the focused strip's connections to other
 * polities and eras, one ribbon per pair of rows as drawn (a folded group is one row), and with "Show
 * all threads" every ribbon faintly. The focus is the strip, group or era hovered, else the one picked.
 */
function threadRibbons(c: Ctx, G: Geo, base: number): { list: RibbonIn[]; ids: Map<string, { ids: string[]; title: string }>; involved?: Set<string> } {
  const { D, V, E, X, x0, x1 } = c;
  const ids = new Map<string, { ids: string[]; title: string }>();
  if (!D.threads.length) return { list: [], ids };
  const all = !!V.allThreads && E.w >= PHONE_W;
  const on = [V.threadHover, V.pick].find((id) => hasThreads(D, id));
  const focus = threadFocus(D, on);
  if (!focus && !all) return { list: [], ids };
  // Where each end is drawn: its strip's row (its folded group's while folded), or its era's band.
  const rows = new Map<string, ThreadRow>();
  G.bands.forEach((g, bi) => {
    for (const sg of g.subs) {
      if (sg.h < 4) continue;
      const y = base + sg.y + sg.h / 2;
      for (const x of sg.slots) {
        if (x.pol && sg.a > 0.5) rows.set(`pol:${x.pol.id}`, { key: `pol:${x.pol.id}`, y, band: bi, title: x.pol.title });
        if (x.group && unfoldOf(V, x.group.id) < 0.5) for (const m of x.group.members) rows.set(`pol:${m.id}`, { key: `grp:${x.group.id}`, y, band: bi, title: x.group.title });
      }
    }
    for (const e of outerEras(g.B)) if (!rows.has(e.id)) rows.set(e.id, { key: e.id, y: base + g.headY - 4, band: bi, title: e.title });
  });
  const strong = new Set(focus ? threadsAround(D.threads, focus) : []);
  const shown = all ? D.threads : [...strong];
  // One ribbon per pair of rows: its links summed, its look the heaviest thread's.
  const merged = new Map<string, { ra: ThreadRow; rb: ThreadRow; ya: number; yb: number; t: Thread; count: number; ids: string[]; focus: boolean }>();
  for (const t of shown) {
    let ra = rows.get(t.a), rb = rows.get(t.b), ya = t.ya, yb = t.yb;
    if (!ra || !rb || ra.key === rb.key) continue;
    if (rb.key < ra.key) { [ra, rb, ya, yb] = [rb, ra, yb, ya]; }
    const key = `${ra.key}|${rb.key}`;
    const m = merged.get(key);
    const on = strong.has(t);
    if (!m) merged.set(key, { ra, rb, ya, yb, t, count: t.count, ids: t.links.map((l) => l.r.id), focus: on });
    else { m.count += t.count; m.ids.push(...t.links.map((l) => l.r.id)); m.focus ||= on; }
  }
  const list: RibbonIn[] = [];
  const involved = focus ? new Set<string>() : undefined;
  let lane = 0;
  for (const [key, m] of merged) {
    const ax = X(m.ya), bx = X(m.yb);
    if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1) continue;
    const clampX = (x: number) => Math.min(x1 - 4, Math.max(x0 + 4, x));
    const gy = m.ra.band === m.rb.band ? undefined : base + G.bands[Math.min(m.ra.band, m.rb.band)].bottom + BAND_GAP / 2 + ((lane++ % 3) - 1) * 2;
    list.push({ key, a: { x: clampX(ax), y: m.ra.y }, b: { x: clampX(bx), y: m.rb.y }, gy, count: m.count, label: threadLabel({ count: m.count, effect: m.t.effect }), color: m.t.lane ? `var(--pig-${PIGMENT[m.t.lane]})` : UMBER, focus: m.focus });
    ids.set(RIBBON + key, { ids: m.ids, title: `${m.ra.title} and ${m.rb.title}` });
    if (m.focus) { involved!.add(m.ra.key); involved!.add(m.rb.key); }
  }
  if (focus && involved) for (const f of focus) { const r = rows.get(f); if (r) involved.add(r.key); }
  return { list, ids, involved };
}

function parentRule(c: Ctx, B: PBand, y: number, phone: boolean) {
  const { E, S, x0, x1 } = c;
  if (y + PARENT_H < AXIS_H || y > E.h) return;
  const label = B.parent!.toUpperCase();
  const ry = y + PARENT_H - 8.5;
  if (phone) {
    const w = E.measure('parent', label);
    S.z[2].push({ t: 2, k: `pr${B.name}`, a: 1, cls: 'tl-parent', x: x0 + 12, y: ry + 4, s: label, f: 'parent', fill: 'var(--muted)' });
    S.z[0].push({ t: 3, k: `prl${B.name}`, a: 1, x1: x0 + 20 + w, y1: ry, x2: x1, y2: ry, stroke: 'var(--rule)' });
  } else {
    S.gutter.push({ t: 2, k: `pr${B.name}`, a: 1, cls: 'tl-parent', x: 14, y: ry + 4, s: fit(E.measure, 'parent', label, E.gutter - 20), f: 'parent', fill: 'var(--muted)' });
    S.z[0].push({ t: 3, k: `prl${B.name}`, a: 1, x1: x0, y1: ry, x2: x1, y2: ry, stroke: 'var(--rule)' });
  }
}

function band(c: Ctx, g: BandGeo, base: number, phone: boolean, shareOf: (p: PPolity) => (y: number) => number) {
  const { D, V, E, S, X, x0, x1 } = c;
  const M = E.measure;
  const B = g.B;
  const top = base + g.top, bottom = base + g.bottom, headY = base + g.headY;
  S.z[0].push({ t: 0, k: `bb${B.name}`, a: 1, cls: 'tl-band', x: x0, y: top, w: x1 - x0, h: bottom - top, fill: 'var(--band)' });
  // The region's name: on the band on a phone, in the gutter (staying in view while it scrolls past) otherwise.
  let after = x0 + 6;
  if (phone) {
    const name = fit(M, 'region', B.label, x1 - x0 - 24);
    S.z[2].push({ t: 2, k: `rn${B.name}`, a: 1, cls: 'tl-region', x: x0 + 12, y: headY, s: name, f: 'region', fill: 'var(--ink)' });
    after = x0 + 12 + M('region', name) + 14;
  } else {
    // It stays in view only down to the first lanes open in the band, which name themselves.
    const ny = Math.min(Math.max(headY, AXIS_H + 18), (g.blocks.length ? base + g.blocks[0].y : bottom) - 6);
    S.gutter.push({ t: 2, k: `rn${B.name}`, a: 1, cls: 'tl-region', x: 14, y: ny, s: fit(M, 'region', B.label, E.gutter - 24), f: 'region', fill: 'var(--ink)' });
    const gy = bottom + BAND_GAP / 2 - 0.5;
    S.gutter.push({ t: 3, k: `gr${B.name}`, a: 1, x1: 0, y1: gy, x2: E.gutter, y2: gy, stroke: 'var(--rule-soft)' });
  }
  // Eras are the backdrop: a wash across the band each, inner ones a rule along its foot.
  const outer = outerEras(B);
  outer.forEach((e, i) => {
    if (e.e < V.win.start || e.s > V.win.end) return;
    const xa = X(e.s), xb = Math.max(X(e.e), xa + 1);
    const role = roleOf(V, D.byId.get(e.id)!);
    const { marks, text } = washPrims(e, { xa, xb, x0, x1, top, bottom, nameY: headY, after, alt: i % 2 === 1, selected: V.selected === e.id, role }, M);
    S.z[0].push(...marks);
    S.z[2].push(...text);
    const rx = Math.max(xa, x0), rw = Math.min(xb, x1) - rx;
    if (rw > 0) S.targets.push({ id: e.id, x: rx, y: top, w: Math.max(rw, 4), h: bottom - top });
  });
  for (const e of B.eras) {
    if (outer.includes(e) || e.e < V.win.start || e.s > V.win.end) continue;
    const { marks, text } = innerPrims(e, { xa: X(e.s), xb: X(e.e), x0, x1, bottom, role: roleOf(V, D.byId.get(e.id)!) }, M);
    S.z[0].push(...marks);
    S.z[2].push(...text);
  }
  // Theme chips on the wash, under the eras' names.
  for (const b of g.chips) {
    const cy = base + g.chipY + b.line * CHIP_LINE, id = themeKey(b.era, b.theme.id);
    if (b.x > x1 || b.x + b.w < x0) continue;
    S.z[2].push(...chipPrims(b, cy, { hot: V.hover === id, picked: false, role: roleOf(V, D.byId.get(b.era)!) }));
    S.targets.push({ id, x: b.x, y: cy, w: b.w, h: CHIP_LINE - 4 });
  }
  if (g.empty) S.z[2].push({ t: 2, k: `be${B.name}`, a: 1, cls: 'tl-band-empty', x: x0 + 12, y: top + GOLD_H + HEAD_LINE + (B.named ? WORLD_LINE : 0) + 15, s: 'No polities in these years', f: 'ui', fill: 'var(--muted)' });
  // World events: gold along the top of every band they touched, named on a line of their own at home.
  const named: [number, number][] = [];
  for (const { it, home } of B.worlds) {
    if (it.e < V.win.start || it.s > V.win.end) continue;
    const [xa, xb] = gold(c, it, top + 1, home, `${B.name}:${it.id}`);
    S.targets.push({ id: it.id, x: xa - 4, y: top, w: Math.max(8, xb - xa + 8), h: GOLD_H + 3 });
    if (!S.boxes.has(it.id)) S.boxes.set(it.id, { x: xa, y: top + 1, w: Math.max(2, xb - xa), h: 7 });
    if (!home) continue;
    // From where it starts, slid left if it would run off the right edge.
    const w = M('world', it.title), lx = Math.max(Math.min(xa, x1 - 4 - w), x0 + 12);
    if (lx + w > x1 - 4 || named.some(([a, b]) => lx < b && lx + w > a)) continue;
    named.push([lx - 4, lx + w + 10]);
    S.z[2].push({ t: 2, k: `wn${B.name}:${it.id}`, a: 1, cls: `tl-world-name${roleOf(V, it)}`, id: it.id, x: lx, y: base + g.worldY, s: it.title, f: 'world', fill: 'var(--gold-text)' });
    S.targets.push({ id: it.id, x: lx - 2, y: base + g.worldY - 13, w: w + 4, h: 17 });
  }
  // Polities: strips in their sub-rows.
  const tone = `var(--tone-${(B.tone % 3) + 1}`;
  for (const sg of g.subs) {
    const y = base + sg.y;
    if (sg.h < 2 || y + sg.h < AXIS_H || y > E.h) continue;
    const cy = y + sg.h / 2, T = Math.max(0, sg.h - 8);
    const pad = (V.win.end - V.win.start) * 0.02;
    for (const x of sg.slots) {
      const o = x.pol ?? x.group;
      const a = Math.max(o.s, V.win.start - pad), b = Math.min(o.e, V.win.end + pad);
      if (b <= a) continue;
      const fold = x.group ? 1 - unfoldOf(V, x.group.id) : sg.a;
      if (fold <= 0.01) continue;
      const tid = x.pol ? `pol:${x.pol.id}` : `grp:${x.group.id}`;
      const fill = `${tone}${o.alt ? '-2' : ''})`;
      const look: StripLook = {
        a, b, X, cy, T, fill, left: x0, right: x1,
        share: x.pol ? shareOf(x.pol) : groupShare(x.group, shareOf),
        unknown: !!x.pol?.unknown,
        picked: V.pick === tid || (!!x.pol?.itemId && V.selected === x.pol.itemId),
        hot: V.hover === tid,
        approxAt: x.pol?.approx && X(o.s) >= x0 ? X(o.s) : undefined,
        name: x.pol ? x.pol.title : `▸ ${x.group.title}`,
        sub: x.group?.members.map((m) => m.title).join(' · '),
      };
      const strip = stripPrims(tid, tid, look, M, fold);
      // Threads in focus: the strips they don't touch fade.
      const fade = c.involved && !c.involved.has(tid) ? THREAD_FADE : 1;
      const marks = fade < 1 ? strip.marks.map((p) => ({ ...p, a: p.a * fade })) : strip.marks;
      const text = fade < 1 ? strip.text.map((p) => ({ ...p, a: p.a * fade })) : strip.text;
      S.z[1].push(...marks);
      S.z[2].push(...text);
      // The whole row is its hit area, so a sliver can still be picked.
      if (fold > 0.5) S.targets.push({ id: tid, x: X(a), y: y + 2, w: Math.max(4, X(b) - X(a)), h: Math.max(4, sg.h - 4) });
    }
    // The bracket that folds a group back, along its members' rows.
    if (sg.group && sg.group.members[0] === sg.slots[0].pol) {
      const n = sg.group.members.length, h = sg.h * n;
      S.z[2].push({ t: 7, k: `gb${sg.group.id}`, a: sg.a, cls: 'tl-bracket', d: `M${x0 + 9} ${y + 3}H${x0 + 3}V${y + h - 3}H${x0 + 9}`, fill: 'none', stroke: 'var(--ink-2)', sw: 1.3 });
      if (sg.a > 0.5) S.targets.push({ id: `grp:${sg.group.id}`, x: x0, y, w: 12, h });
    }
  }
  lensStrips(c, g, base, phone);
  // Inner eras answer along the foot, over the strips.
  for (const e of B.eras) {
    if (outer.includes(e) || e.e < V.win.start || e.s > V.win.end || X(e.e) - X(e.s) < 70) continue;
    S.targets.push({ id: e.id, x: Math.max(X(e.s), x0), y: bottom - 9, w: Math.min(X(e.e), x1) - Math.max(X(e.s), x0), h: 9 });
  }
}

/** Lenses: under the band's rows, a faint strip of each lane's pigment with a tick for each entry in it here (a period's years as a thread). */
function lensStrips(c: Ctx, g: BandGeo, base: number, phone: boolean) {
  const { V, E, S, X, x0, x1 } = c;
  const B = g.B;
  (V.lenses ?? []).forEach((lane, i) => {
    const y = base + g.lensY + i * LENS_H, h = LENS_H - 2, color = `var(--pig-${PIGMENT[lane]})`;
    if (y + h < AXIS_H || y > E.h) return;
    S.z[0].push({ t: 0, k: `lz${B.name}:${lane}`, a: 1, cls: 'tl-lens', id: `lens:${lane}`, x: x0, y, w: x1 - x0, h, fill: tint(color, 12) });
    if (!phone) S.gutter.push({ t: 2, k: `ln${B.name}:${lane}`, a: 1, cls: 'tl-lens-name', x: E.gutter - 10, y: y + h - 0.5, s: LANE_LABEL[lane], f: 'lensName', fill: color, anchor: 'end' });
    for (const it of B.lens.get(lane) ?? []) {
      if (it.e < V.win.start || it.s > V.win.end) continue;
      const xa = X(it.s), xb = X(it.e);
      const role = roleOf(V, it);
      if (xb - xa > 3) S.z[1].push({ t: 0, k: `ls${B.name}:${lane}:${it.id}`, a: 0.45, cls: `tl-lens-span${role}`, id: it.id, x: xa, y: y + h / 2 - 1, w: Math.min(xb, x1) - xa, h: 2, fill: color });
      S.z[1].push({ t: 0, k: `lt${B.name}:${lane}:${it.id}`, a: 1, cls: `tl-lens-tick${role}`, id: it.id, x: xa - 0.75, y, w: 1.5, h, fill: color });
      S.targets.push({ id: it.id, x: xa - 3, y, w: Math.max(6, Math.min(xb, x1) - xa + 6), h });
    }
  });
}

/** A folded group is as thick as its members together: each adds its share, overlapping a little. */
const groupShare = (g: PGroup, shareOf: (p: PPolity) => (y: number) => number) => {
  const fs = g.members.map((m) => [m, shareOf(m)] as const);
  return (y: number) => 1 - fs.reduce((acc, [m, f]) => (y >= m.s && y <= m.e ? acc * (1 - f(y) * 0.7) : acc), 1);
};

/** The top row: entries Bob shows in the overview as their kind's glyph and name, most prominent first, in up to three rows. */
function topRow(c: Ctx, base: number, h: number) {
  const { D, V, E, S, X, x0, x1 } = c;
  const M = E.measure;
  const y0 = base + TOP_PAD;
  if (y0 + h < AXIS_H) return;
  const taken: [number, number][][] = Array.from({ length: TOP_ROWS }, () => []);
  for (const it of D.top) {
    if (it.e < V.win.start || it.s > V.win.end) continue;
    const xa = X(it.s), xb = Math.max(xa, X(it.e));
    const label = titleOf(it), lw = M('ui', label);
    const gx = xa - GLYPH / 2;
    const span: [number, number] = [gx - 4, xb + 8 + lw + 6];
    if (span[1] < x0 || span[0] > x1) continue;
    const row = taken.findIndex((t) => !t.some(([a, b]) => span[0] < b && span[1] > a));
    if (row < 0) continue;
    taken[row].push(span);
    const cy = y0 + row * TOP_ROW_H + TOP_ROW_H / 2;
    const role = roleOf(V, it);
    const hot = V.hover === it.id;
    // A world event no polity places is gold up here.
    if (it.world) gold(c, it, cy - 4, true, `top:${it.id}`, 8);
    else {
      if (xb - xa > 2) S.z[1].push({ t: 3, k: `tl${it.id}`, a: 1, cls: `tl-top-span${role}`, id: it.id, x1: xa, y1: cy, x2: xb, y2: cy, stroke: 'var(--ink-2)', sw: 2 });
      if (hot) S.z[2].push({ t: 1, k: `th${it.id}`, a: 1, x: xa, y: cy, r: GLYPH / 2 + 2, fill: 'var(--panel)', stroke: 'var(--ink)', sw: 1.5 });
      S.z[2].push({ t: 6, k: `tg${it.id}`, a: 1, cls: `tl-top${role}`, id: it.id, x: gx, y: cy - GLYPH / 2, w: GLYPH, g: it.rep.kind, color: 'var(--ink-2)' });
    }
    S.z[2].push({ t: 2, k: `tt${it.id}`, a: 1, cls: `tl-top-name${role}`, id: it.id, x: xb + 8, y: cy + 4, s: label, f: 'ui', fill: 'var(--ink)' });
    S.boxes.set(it.id, { x: gx, y: cy - GLYPH / 2, w: Math.max(GLYPH, xb - gx), h: GLYPH });
    S.targets.push({ id: it.id, x: gx - 2, y: cy - TOP_ROW_H / 2, w: span[1] - gx, h: TOP_ROW_H });
  }
}

/* ---------- six lanes, unfurled in place under a polity, a world event or an era ---------- */

/** The lane under the six for entries in no lane yet. */
export const NO_LANE = 'none';
/** Open lanes' background, so a tap on empty space there lands on nothing under it (an era's wash). */
export const INERT = '__inert';
/**
 * Inside open lanes: a lane's name (or a closed lane), which opens or closes it, as
 * `__lane:<open key>|<lane>`. The layout draws each set of lanes with the bare `__lane:<lane>`.
 */
export const LANE_TOGGLE = '__lane:';
/** The head's "Fold", as `__fold:<open key>`. */
export const FOLD = '__fold:';
/** The row above the lanes with the name and dates. */
export const HEAD1_H = 38;

/** The head's "+3 more" and "Show fewer" chip, as `__themes_more:<open key>`. */
export const THEMES_MORE = '__themes_more:';

/** A lane toggle's open key and lane: `__lane:pol:athens|war` → `['pol:athens', 'war']`. */
export function parseToggle(id: string): [string, string] | undefined {
  if (!id.startsWith(LANE_TOGGLE)) return undefined;
  const rest = id.slice(LANE_TOGGLE.length), bar = rest.lastIndexOf('|');
  return bar < 0 ? undefined : [rest.slice(0, bar), rest.slice(bar + 1)];
}
const MORE_PAD = 16;

/**
 * The theme chips in open lanes' head, packed under the name across the whole width: one line, ending in
 * "+3 more" when there are more, unless Bob opened them all (or the theme picked is past the line).
 */
function headChips(EL: EraLanes, F: Fit, picked?: string): { chips: ChipBox[]; more?: { x: number; w: number; line: number; label: string } } {
  if (!EL.themes.length) return { chips: [] };
  const left = F.gutter + 12, right = F.w - 12, M = F.measure;
  const all = packChips(EL.themes, left, right, M);
  if (chipLines(all) <= 1) return { chips: all };
  const open = EL.allThemes || all.some((b) => b.line > 0 && `${b.era}:${b.theme.id}` === picked);
  if (open) {
    const last = all[all.length - 1], w = M('chipN', 'Show fewer') + MORE_PAD;
    const fits = last.x + last.w + 4 + w <= right;
    return { chips: all, more: { x: fits ? last.x + last.w + 4 : left, w, line: fits ? last.line : last.line + 1, label: 'Show fewer' } };
  }
  const first = all.filter((b) => b.line === 0);
  for (;;) {
    const label = `+${all.length - first.length} more`, w = M('chipN', label) + MORE_PAD;
    const end = first.length ? first[first.length - 1].x + first[first.length - 1].w + 4 : left;
    if (end + w <= right || !first.length) return { chips: first, more: { x: end, w, line: 0, label } };
    first.pop();
  }
}
/** The head of open lanes: the name's line, then a line for each line of theme chips. */
export function head1H(EL: EraLanes, F: Fit, picked?: string): number {
  const { chips, more } = headChips(EL, F, picked);
  const n = Math.max(chipLines(chips), more ? more.line + 1 : 0);
  return HEAD1_H + (n ? n * CHIP_LINE + 4 : 0);
}
const PAD1 = 6;
const MOMENT_ROW = 26;
const DIAMOND = 12;
const LANE1_EMPTY = 52;
/** A lane's "+ Add" button. */
const ADD_W = 50, ADD_H = 22;
// On a phone each lane is its name, its bars without labels, then a dated list.
const P_HEAD = 30, P_MOMENT = 14, P_ROW = 12, P_ITEM = 30, P_YEAR = 92;

export interface Lane1 {
  id: Lane | typeof NO_LANE;
  label: string;
  color: string;
  /** Highlights in the era in this lane, or (in a polity) how many entries it has. */
  count: number;
  /** The count in words, under its name: "12 highlights", "5 entries". */
  countLabel: string;
  /** Spans of change (periods, lives) and key moments, each by start. */
  spans: PItem[];
  moments: PItem[];
  /** Every entry by start: the arrow keys' order, and the phone's list. */
  order: PItem[];
  /** Every entry, most prominent first: a closed lane names the first that fit. */
  ranked: PItem[];
  rows: number;
}

/** What's open: an era, a polity or a world event. */
export interface Head1 {
  /** The era's id, or the overview's pick (`pol:<territory>`, or a world event's id). */
  id: string;
  title: string;
  /** Its years, washed behind the lanes. */
  s: number;
  e: number;
  when: string;
  /** After its dates: "38 highlights", "49 entries". */
  sub: string;
  /** The entry its name opens, if any. */
  opens?: string;
}

export interface EraLanes {
  head: Head1;
  /** The era, when an era is open. */
  era?: PEra;
  lanes: Lane1[];
  /** In a polity or world event, lanes start closed (ticks, and the most prominent named) and one opens to all of it. */
  compact: boolean;
  /** The lane opened to all its entries. */
  open?: Lane1['id'];
  /** Each entry's first lane, a span's row in its lanes, and where the next span in its row starts. */
  laneOf: Map<string, number>;
  rowOf: Map<string, number>;
  nextOf: Map<string, number>;
  /** Connections between entries here in different lanes, drawn as arrows. */
  influences: LaneInfluence[];
  /** On a phone: the effect lines under an entry in a lane (`<lane>:<id>`), each an influence it's at an end of there. */
  effLines: Map<string, LaneInfluence[]>;
  /** Theme chips along the top: the era's and its inner eras', or those of the eras a polity lived through in its region. */
  themes: { era: string; theme: EraTheme }[];
  /** Whether Bob opened the chips past their first line ("+3 more"). */
  allThemes?: boolean;
}

/** Entries by start into the six lanes, in pigment order, then "No lane yet" when anything has none. An entry is in each of its lanes. */
function buildLanes(D: Prepared, ids: Iterable<string>, lanesOf: ReadonlyMap<string, readonly Lane[]>, count: (l: Lane1['id'], n: number) => [number, string]): Pick<EraLanes, 'lanes' | 'laneOf' | 'rowOf' | 'nextOf' | 'influences' | 'effLines'> {
  // Claude's drafts are in it too, as ghosts.
  const items = [...new Set(ids)].map((id) => D.byId.get(id)).filter((p): p is PItem => !!p)
    .sort((a, b) => a.s - b.s || b.e - a.e || a.id.localeCompare(b.id));
  const defs = [
    ...LANES.map((d) => ({ id: d as Lane1['id'], label: LANE_LABEL[d], color: `var(--pig-${PIGMENT[d]})` })),
    { id: NO_LANE as Lane1['id'], label: 'No lane yet', color: UMBER },
  ];
  const laneOf = new Map<string, number>(), rowOf = new Map<string, number>(), nextOf = new Map<string, number>();
  const lanes = defs.map((l, li): Lane1 => {
    const mine = items.filter((it) => (lanesOf.get(it.id)?.length ? lanesOf.get(it.id)!.includes(l.id as Lane) : l.id === NO_LANE));
    for (const it of mine) if (!laneOf.has(it.id)) laneOf.set(it.id, li);
    const spans = mine.filter((it) => it.kind !== 'event');
    // Packed into rows by time only, so rows stay put while zooming. An entry in two lanes packs the same in both.
    const rowEnd: number[] = [], rowLast: PItem[] = [];
    for (const it of spans) {
      let r = rowEnd.findIndex((end) => end <= it.s);
      if (r < 0) r = rowEnd.length;
      if (rowLast[r]) nextOf.set(`${l.id}:${rowLast[r].id}`, it.s);
      rowEnd[r] = it.e;
      rowLast[r] = it;
      rowOf.set(`${l.id}:${it.id}`, r);
    }
    const [n, countLabel] = count(l.id, mine.filter((it) => !it.draft).length);
    const ranked = [...mine].sort((a, b) => D.prominence(b.id) - D.prominence(a.id) || a.s - b.s);
    return { ...l, count: n, countLabel, spans, moments: mine.filter((it) => it.kind === 'event'), order: mine, ranked, rows: rowEnd.length };
  });
  const influences = laneInfluences(D.relations, lanesOf, new Set(items.map((it) => it.id)));
  const effLines = new Map<string, LaneInfluence[]>();
  const line = (k: string, x: LaneInfluence) => (effLines.get(k) ?? effLines.set(k, []).get(k)!).push(x);
  for (const x of influences) { line(`${x.from}:${x.r.fromId}`, x); line(`${x.to}:${x.r.toId}`, x); }
  // "No lane yet" is last, so leaving it out moves no other lane.
  return { lanes: lanes.filter((l) => l.id !== NO_LANE || l.order.length), laneOf, rowOf, nextOf, influences, effLines };
}

/**
 * An era's six lanes. What's in it is what the overview counts (`eraRegions`): its members and its
 * inner eras' members, plus the inner eras themselves. `lanesOf` is each entry's lanes
 * (`entryLanes`); an entry in several is drawn in each.
 */
export function eraLanes(D: Prepared, eraId: string, lanesOf: ReadonlyMap<string, readonly Lane[]>): EraLanes | undefined {
  const R = D.regions.find((r) => r.eras.some((e) => e.id === eraId));
  if (!R) return undefined;
  const byEra = new Map(R.eras.map((e) => [e.id, e]));
  const era = byEra.get(eraId)!;
  const inside = (e: PEra) => {
    for (let p: PEra | undefined = e, n = 0; p && n < 50; p = p.parent ? byEra.get(p.parent) : undefined, n++) if (p.id === eraId) return true;
    return false;
  };
  const ids = new Set<string>();
  for (const e of R.eras) {
    if (!inside(e)) continue;
    if (e.id !== eraId) ids.add(e.id);
    for (const m of e.members) ids.add(m);
  }
  const built = buildLanes(D, ids, lanesOf, (l) => {
    const n = l === NO_LANE ? era.noLane : era.mix[l];
    return [n, n ? highlightsN(n) : ''];
  });
  const head: Head1 = { id: era.id, title: era.title, s: era.s, e: era.e, when: era.when, sub: highlightsN(era.highlights), opens: era.id };
  const themes = R.eras.filter(inside).sort((a, b) => Number(b.id === eraId) - Number(a.id === eraId) || a.s - b.s).flatMap((e) => e.themes.map((theme) => ({ era: e.id, theme })));
  return { head, era, compact: false, ...built, themes };
}

/**
 * A polity's or world event's six lanes (`pick` as the overview has it: `pol:<territory>`, or the
 * world event's id), holding `members` (`polityMembers`, `worldMembers`). Each lane starts closed.
 */
export function polityLanes(D: Prepared, pick: string, members: readonly string[], lanesOf: ReadonlyMap<string, readonly Lane[]>): EraLanes | undefined {
  const pol = pick.startsWith('pol:') ? D.polById.get(pick.slice(4)) : undefined;
  const world = pol ? undefined : D.byId.get(pick);
  if (!pol && !world?.world) return undefined;
  const own = pol?.itemId ?? world?.id;
  const built = buildLanes(D, members.filter((id) => id !== own), lanesOf, (_, n) => [n, entriesN(n)]);
  const s = pol ? pol.s : world!.s, e = pol ? pol.e : world!.e;
  const n = new Set(built.lanes.flatMap((l) => l.order).filter((x) => !x.draft).map((x) => x.id)).size;
  const head: Head1 = {
    id: pick, title: pol ? pol.fullTitle : world!.title, s, e,
    when: pol ? pol.when : world!.when, sub: `${pol ? '' : 'World event · '}${entriesN(n)}`, opens: own && D.byId.has(own) ? own : undefined,
  };
  // A polity's chips are its region's eras' while it lived, outer eras first.
  const themes = pol ? D.regions.filter((R) => R.name === pol.region).flatMap((R) => R.eras.filter((x) => x.e > s && x.s < e).sort((a, b) => Number(!!a.parent) - Number(!!b.parent) || a.s - b.s)).flatMap((x) => x.themes.map((theme) => ({ era: x.id, theme }))) : [];
  return { head, compact: true, ...built, themes };
}

/** Whether a lane shows all its entries: always in an era, and in a polity once Bob opens it. */
const isOpen = (EL: EraLanes, L: Lane1) => !EL.compact || EL.open === L.id;
/** On a phone a closed lane lists this many, most prominent first. */
const P_CLOSED_LIST = 3;
const P_TICKS = 14;
/** On a phone, each effect line under an entry. */
const P_EFF = 22;

/** An entry's effect lines in a lane. */
const effOf = (EL: EraLanes, L: Lane1, id: string) => EL.effLines.get(`${L.id}:${id}`) ?? [];
/** A closed lane names Claude's drafts and its entries at an end of an arrow, then its `n` most prominent others, most prominent first. */
function namedOf(EL: EraLanes, L: Lane1, n: number): PItem[] {
  const always = (it: PItem) => it.draft || effOf(EL, L, it.id).length > 0;
  return [...L.ranked.filter(always), ...L.ranked.filter((it) => !always(it)).slice(0, n)];
}
/** What a phone's lane lists: all of it, or (closed) its named entries in time order. */
const phoneList = (EL: EraLanes, L: Lane1) => (isOpen(EL, L) ? L.order : namedOf(EL, L, P_CLOSED_LIST).sort((a, b) => a.s - b.s));
/** A line in a phone's list, with its effect lines under it. */
const itemH = (EL: EraLanes, L: Lane1, id: string) => P_ITEM + effOf(EL, L, id).length * P_EFF;
const listH = (EL: EraLanes, L: Lane1, list: readonly PItem[]) => list.reduce((h, it) => h + itemH(EL, L, it.id), 0);

function laneH(EL: EraLanes, L: Lane1, phone: boolean): number {
  const open = isOpen(EL, L);
  if (phone) {
    if (!L.order.length) return P_HEAD + 34;
    const list = phoneList(EL, L), more = EL.compact && L.order.length > P_CLOSED_LIST;
    if (!open) return P_HEAD + P_TICKS + 6 + listH(EL, L, list) + (more && list.length < L.order.length ? P_ITEM : 0) + 10;
    return P_HEAD + (L.moments.length ? P_MOMENT : 0) + L.rows * P_ROW + 6 + listH(EL, L, list) + (more ? P_ITEM : 0) + 10;
  }
  if (!L.order.length) return LANE1_EMPTY;
  if (!open) return closedH(EL, L);
  return Math.max(LANE_MIN, PAD1 + (L.moments.length ? MOMENT_ROW : 0) + L.rows * ROW_H + PAD_BOTTOM);
}
const lanesH = (EL: EraLanes, phone: boolean) => EL.lanes.reduce((h, L) => h + laneH(EL, L, phone), 0);

/** How far down the lanes (under the header row) a lane starts, in px. */
export function laneTop(EL: EraLanes, id: Lane1['id'], phone: boolean): number {
  let top = 0;
  for (const L of EL.lanes) { if (L.id === id) break; top += laneH(EL, L, phone); }
  return top;
}

/** How far down the lanes (under the header row) an entry's row is, in px: on a phone, its line in the list. */
export function lane1Span(EL: EraLanes, id: string, phone: boolean): [number, number] | undefined {
  if (!EL.laneOf.has(id)) return undefined;
  // An entry in several lanes: where it's drawn in full, else where it's named, else its first.
  const mine = EL.lanes.filter((l) => l.order.some((it) => it.id === id));
  const L = mine.find((l) => isOpen(EL, l)) ?? mine.find((l) => namedOf(EL, l, CLOSED_NAMES).some((it) => it.id === id)) ?? mine[0];
  const top = laneTop(EL, L.id, phone);
  if (!isOpen(EL, L)) return [top, top + laneH(EL, L, phone)];
  if (phone) {
    const y = top + P_HEAD + (L.moments.length ? P_MOMENT : 0) + L.rows * P_ROW + 6 + listH(EL, L, L.order.slice(0, L.order.findIndex((x) => x.id === id)));
    return [y, y + itemH(EL, L, id)];
  }
  const rows = top + PAD1 + (L.moments.length ? MOMENT_ROW : 0);
  const row = EL.rowOf.get(`${L.id}:${id}`);
  return row === undefined ? [top + PAD1, top + PAD1 + MOMENT_ROW] : [rows + row * ROW_H, rows + (row + 1) * ROW_H];
}

/**
 * The arrow keys in open lanes: ←/→ through what a lane draws in time order (a closed lane, its named
 * entries), ↑/↓ the nearest in time in the next lane with anything, down through every set of lanes
 * open (`ELs`, top to bottom). Drafts are skipped.
 */
export function stepLane1(ELs: readonly EraLanes[], activeId: string | undefined, key: StepKey, win: YearWindow): string | undefined {
  const drawn = (EL: EraLanes, L: Lane1) => (isOpen(EL, L) ? L.order : namedOf(EL, L, CLOSED_NAMES).sort((a, b) => a.s - b.s));
  const lanes = ELs.flatMap((EL) => EL.lanes.map((l) => drawn(EL, l).filter((it) => !it.draft)));
  let li: number | undefined, base = 0;
  for (const EL of ELs) {
    const i = activeId ? EL.laneOf.get(activeId) : undefined;
    if (i !== undefined && lanes[base + i].some((it) => it.id === activeId)) { li = base + i; break; }
    base += EL.lanes.length;
  }
  return stepThrough(lanes, li, activeId, key, win);
}

/**
 * Make sure open lanes draw an entry: in a polity a closed lane only names a few, so the lane it's
 * in opens unless it's named already. Whether it's in these lanes at all.
 */
export function revealIn(EL: EraLanes, id: string): boolean {
  const li = EL.laneOf.get(id);
  if (li === undefined) return false;
  // An entry in several lanes is drawn in each: any one that shows it will do.
  const mine = EL.lanes.filter((L) => L.order.some((it) => it.id === id));
  const drawn = mine.some((L) => isOpen(EL, L) || namedOf(EL, L, CLOSED_NAMES).some((it) => it.id === id));
  if (!drawn) EL.open = EL.lanes[li].id;
  return true;
}

/** What a screen reader says for an entry in open lanes: "Athenian silver “owls”, c. 510 BCE – 322 BCE, Economic, 1 of 4". */
export function describeLane1(EL: EraLanes, id: string): string {
  const li = EL.laneOf.get(id);
  if (li === undefined) return '';
  const L = EL.lanes[li];
  const i = L.order.findIndex((x) => x.id === id);
  return `${L.order[i].title}, ${L.order[i].when}, ${L.label}, ${i + 1} of ${L.order.length}`;
}

const entriesN = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`;

const highlightsN = (n: number) => `${n} ${n === 1 ? 'highlight' : 'highlights'}`;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const blank = (S: Scene): Scene => ({ ...S, z: [[], [], [], []], gutter: [], axis: [], targets: [], boxes: new Map(), laneBoxes: new Map(), adds: [] });

/** A primitive moved by `Y` and faded: marks by `ma`, words and glyphs by `ta`. Arrows and shapes wait until it's open. */
function squash(p: Prim, Y: (y: number) => number, ma: number, ta: number): Prim | undefined {
  switch (p.t) {
    case 0: case 4: { const y = Y(p.y); return { ...p, y, h: Math.max(0, Y(p.y + p.h) - y), a: p.a * ma }; }
    case 1: return { ...p, y: Y(p.y), a: p.a * ma };
    case 2: return { ...p, y: Y(p.y), a: p.a * ta };
    case 3: return { ...p, y1: Y(p.y1), y2: Y(p.y2), a: p.a * ma };
    case 6: return { ...p, y: Y(p.y + p.w / 2) - p.w / 2, a: p.a * ta };
    default: return undefined;
  }
}

/** Inside one set of open lanes, the head's "Fold" and "+3 more" are drawn with these, then made that set's own. */
const LOCAL_FOLD = '__fold';
const LOCAL_MORE = '__more';
/** An id drawn inside a set of open lanes, made that set's own (`key`), so two sets open don't answer for each other. */
function ownId(id: string | undefined, key: string): string | undefined {
  if (!id) return id;
  if (id === LOCAL_FOLD) return FOLD + key;
  if (id === LOCAL_MORE) return THEMES_MORE + key;
  if (id.startsWith(LANE_TOGGLE) && !id.includes('|')) return `${LANE_TOGGLE}${key}|${id.slice(LANE_TOGGLE.length)}`;
  return id;
}
/** What's hovered, as the set of open lanes `key` draws it. */
function localHover(h: string | undefined, key: string): string | undefined {
  if (!h) return h;
  if (h === FOLD + key) return LOCAL_FOLD;
  if (h === THEMES_MORE + key) return LOCAL_MORE;
  const t = parseToggle(h);
  if (t) return t[0] === key ? LANE_TOGGLE + t[1] : undefined;
  return h;
}

/**
 * A polity's, world event's or era's six lanes, unfurled under it on the same time scale: a head
 * with its name, dates and theme chips, then the lanes. While it unfurls the lanes grow down out of
 * its top and what's under it moves down with them; with reduced motion they fade in at full height.
 */
function inlineBlock(c: Ctx, b: BlockGeo, base: number) {
  const { V, E, S, x0, x1 } = c;
  const top = base + b.y, bottom = top + b.full;
  if (b.h < 1 || top + b.h < AXIS_H || top > E.h) return;
  const phone = E.w < PHONE_W;
  const EL = b.EL;
  const headH = head1H(EL, E, V.theme?.key);
  const sub = blank(S);
  const cb: Ctx = { ...c, V: { ...V, hover: localHover(V.hover, b.key) }, S: sub, top: Math.max(AXIS_H, top + headH), bottom: Math.min(E.h, bottom) };
  // Its own ground over the band's washes, ruled along its top and foot.
  sub.z[0].push({ t: 0, k: 'kbg', a: 1, cls: 'tl-open-lanes', x: x0, y: top, w: x1 - x0, h: b.full, fill: 'var(--panel)' });
  if (E.gutter) sub.gutter.push({ t: 0, k: 'kgbg', a: 1, x: 0, y: top, w: E.gutter, h: b.full, fill: 'var(--panel)' });
  for (const [k, y] of [['kt', top + 0.5], ['kf', bottom - 0.5]] as const) {
    sub.z[0].push({ t: 3, k, a: 1, x1: x0, y1: y, x2: x1, y2: y, stroke: 'var(--rule)' });
    if (E.gutter) sub.gutter.push({ t: 3, k: `g${k}`, a: 1, x1: 0, y1: y, x2: E.gutter, y2: y, stroke: 'var(--rule)' });
  }
  sub.targets.push({ id: INERT, x: x0, y: top, w: x1 - x0, h: b.full });
  lanesInline(cb, EL, top + headH, phone);
  blockHead(cb, EL, top, phone);
  const t = b.t, fade = !!V.openFade;
  const Y = fade ? (y: number) => y : (y: number) => top + (y - top) * t;
  const ma = fade ? t : Math.min(1, t * 1.6), ta = fade ? t : clamp01((t - 0.45) / 0.55);
  const own = (p: Prim): Prim | undefined => {
    const q = { ...p, k: `${b.key}|${p.k}`, id: ownId(p.id, b.key) } as Prim;
    return t >= 1 ? q : squash(q, Y, ma, ta);
  };
  for (let i = 0; i < 4; i++) for (const p of sub.z[i]) { const q = own(p); if (q) S.z[i].push(q); }
  for (const p of sub.gutter) { const q = own(p); if (q) S.gutter.push(q); }
  // Taps wait until it's open: nothing in it is a target in between.
  if (t < 1) return;
  for (const tg of sub.targets) S.targets.push({ ...tg, id: ownId(tg.id, b.key)! });
  for (const [id, box] of sub.boxes) S.boxes.set(id, box);
  for (const a of sub.adds) S.adds.push({ ...a, block: b.key });
}

function lanesInline(c: Ctx, EL: EraLanes, lanesTop: number, phone: boolean) {
  let top = lanesTop;
  for (const L of EL.lanes) {
    const h = laneH(EL, L, phone);
    if (top + h >= c.top && top <= c.bottom) (phone ? phoneLane : lane1)(c, EL, L, top, h);
    else if (!phone && EL.influences.length) {
      // Scrolled out of view: only where its entries would be, so an arrow to one runs off the edge toward it.
      const ghost: Ctx = { ...c, top: -Infinity, bottom: Infinity, S: blank(c.S) };
      lane1(ghost, EL, L, top, h);
      for (const [k, b] of ghost.S.laneBoxes) c.S.laneBoxes.set(k, b);
    }
    top += h;
  }
  if (phone) marginArcs(c, EL, lanesTop);
  else influences1(c, EL);
}

/** An entry's name in the scene, as a box, so an effect's pill can keep off it. */
function textBox(M: Measure, p: Prim): Box | undefined {
  if (p.t !== 2 || !p.s) return undefined;
  const w = M(p.f, p.s), x = p.anchor === 'middle' ? p.x - w / 2 : p.anchor === 'end' ? p.x - w : p.x;
  return { x: x - 2, y: p.y - 12, w: w + 4, h: 16 };
}

/**
 * The arrows between lanes (`representations/influence.ts`). Hovering or focusing an arrow or an
 * entry at an end of one (or opening it) puts it in focus: the other arrows fade, and so do the
 * named entries it doesn't touch.
 */
function influences1(c: Ctx, EL: EraLanes) {
  const { D, V, E, S, X } = c;
  if (!EL.influences.length) return;
  const hover = V.hover?.startsWith(ARROW) ? V.hover.slice(ARROW.length) : V.hover;
  const touches = (x: LaneInfluence, id: string | undefined) => !!id && (x.r.id === id || x.r.fromId === id || x.r.toId === id);
  const focus = [hover, V.active, V.selected].find((id) => EL.influences.some((x) => touches(x, id)));
  const arrows: ArrowIn[] = [];
  for (const x of EL.influences) {
    const a = S.laneBoxes.get(`${x.from}:${x.r.fromId}`), b = S.laneBoxes.get(`${x.to}:${x.r.toId}`);
    const fa = D.byId.get(x.r.fromId), fb = D.byId.get(x.r.toId);
    if (!a || !b || !fa || !fb) continue;
    const on = touches(x, focus);
    arrows.push({
      key: x.r.id, from: { id: fa.id, box: a, s: fa.s, e: fa.e }, to: { id: fb.id, box: b, s: fb.s, e: fb.e },
      label: describeEffect(x.r, 'out').toLowerCase(), color: `var(--pig-${PIGMENT[x.from]})`, focus: on, faded: !!focus && !on,
    });
  }
  // Pills keep off entries' names and marks, bars included, so they never take an entry's clicks.
  const taken = [...S.z[2].flatMap((p) => textBox(E.measure, p) ?? []), ...S.laneBoxes.values()];
  const drawn = arrowPrims(arrows, X, E.measure, taken, { top: c.top, bottom: c.bottom });
  S.z[3].push(...drawn.marks, ...drawn.labels);
  S.targets.splice(S.targets.findIndex((t) => t.id === INERT) + 1, 0, ...drawn.targets.filter((t) => t.lane === 'under'));
  S.targets.push(...drawn.targets.filter((t) => t.lane !== 'under'));
  // In focus, the named entries it doesn't touch fade (while an entry is open its connections already light up).
  if (focus && !V.roles) {
    const near = new Set(EL.influences.filter((x) => touches(x, focus)).flatMap((x) => [x.r.fromId, x.r.toId]));
    for (const z of [S.z[1], S.z[2]]) for (let i = 0; i < z.length; i++) {
      const p = z[i];
      if (p.id && D.byId.has(p.id) && !near.has(p.id)) z[i] = { ...p, a: p.a * 0.38 };
    }
  }
}

/** What an empty lane says, in Bob's words. */
const EMPTY_NOTE: Record<Lane1['id'], string> = {
  politics: 'No politics or law here yet.', war: 'No wars here yet.', economy: 'Nothing on the economy here yet.',
  ideas: 'No philosophy or religion here yet.', technology: 'No technology here yet.', nature: 'Nothing on nature here yet.', none: '',
};
const emptyNote = (L: Lane1) => EMPTY_NOTE[L.id];
/** Under a closed lane's name in a polity: what clicking it does. */
const toggleNote = (EL: EraLanes, L: Lane1) => (isOpen(EL, L) ? 'Show fewer' : `Show all ${L.order.length}`);

function lane1(c: Ctx, EL: EraLanes, L: Lane1, top: number, h: number) {
  const { V, E, S, X, x0, x1 } = c;
  const M = E.measure;
  const bot = top + h;
  // A faint wash of the lane's pigment over the era's (or polity's) years.
  const wa = Math.max(X(EL.head.s), x0 - 2), wb = Math.min(X(EL.head.e), x1 + 2);
  if (wb > wa) S.z[0].push({ t: 0, k: `qw${L.id}`, a: 1, cls: `tl-lane1 ${L.id}`, x: wa, y: top, w: wb - wa, h, fill: tint(L.color, 7) });
  S.z[0].push({ t: 3, k: `qr${L.id}`, a: 1, x1: 0, y1: bot - 0.5, x2: x1, y2: bot - 0.5, stroke: 'var(--rule-soft)' });
  S.gutter.push({ t: 3, k: `qgr${L.id}`, a: 1, x1: 0, y1: bot - 0.5, x2: E.gutter, y2: bot - 0.5, stroke: 'var(--rule-soft)' });
  // Its name stays in view while the lane scrolls past.
  const ny = Math.min(Math.max(top + 9, c.top + 9), bot - 36);
  const toggle = EL.compact && L.order.length > 0;
  const hot = toggle && V.hover === LANE_TOGGLE + L.id;
  S.gutter.push({ t: 0, k: `qgs${L.id}`, a: 1, x: 14, y: ny + 2, w: 9, h: 9, r: 1, fill: L.color });
  S.gutter.push({ t: 2, k: `qgn${L.id}`, a: 1, cls: `tl-lane-name${toggle ? ' tl-lane-toggle' : ''}`, x: 30, y: ny + 11, s: fit(M, 'dim', L.label.toUpperCase(), E.gutter - 38), f: 'dim', fill: 'var(--ink)' });
  // In a polity the line under the name says how many and opens the lane: "Show all 12 ▾".
  const count = toggle ? `${toggleNote(EL, L)} ${isOpen(EL, L) ? '▴' : '▾'}` : L.countLabel;
  // "+ Add" at the end of that line, while the lane's name is in view.
  const add = L.id !== NO_LANE && ny + 14 >= c.top && ny + 14 + ADD_H <= c.bottom;
  if (add) S.adds.push({ lane: L.id as Lane, label: L.label, x: E.gutter - 10 - ADD_W, y: ny + 14, w: ADD_W, h: ADD_H });
  if (count) S.gutter.push({ t: 2, k: `qgc${L.id}`, a: 1, cls: toggle ? 'tl-lane-toggle' : undefined, id: toggle ? LANE_TOGGLE + L.id : undefined, x: 30, y: ny + 27, s: fit(M, 'dimCount', count, E.gutter - 38 - (L.id !== NO_LANE ? ADD_W + 6 : 0)), f: 'dimCount', fill: hot ? 'var(--ink)' : 'var(--muted)' });
  if (toggle) S.targets.push({ id: LANE_TOGGLE + L.id, gutter: true, x: 0, y: Math.max(top, c.top), w: E.gutter, h: Math.max(0, Math.min(bot, c.bottom) - Math.max(top, c.top)) });
  if (!L.order.length) {
    S.z[2].push({ t: 2, k: `qe${L.id}`, a: 1, cls: 'tl-lane-empty', x: Math.max(x0, wa) + 16, y: top + h / 2 + 5, s: emptyNote(L), f: 'note', fill: 'var(--muted)' });
    return;
  }
  if (!isOpen(EL, L)) { closedLane(c, EL, L, top, h); return; }
  let rowsTop = top + PAD1;
  if (L.moments.length) { moments1(c, L, rowsTop); rowsTop += MOMENT_ROW; }
  for (const it of L.spans) phase(c, EL, L, it, rowsTop + EL.rowOf.get(`${L.id}:${it.id}`)! * ROW_H);
}

/** How many a closed lane names besides the entries at an end of an arrow. */
const CLOSED_NAMES = 3;
/** A closed lane: a band of ticks, then its named entries on up to three rows. */
const CLOSED_TICKS = 16, CLOSED_ROW = 20;
/** How many rows a closed lane's names take: neighbours in time go on different rows, so their names don't collide. */
const closedRows = (n: number) => (n <= 1 ? 1 : n <= 4 ? 2 : 3);
const closedH = (EL: EraLanes, L: Lane1) => CLOSED_TICKS + closedRows(namedOf(EL, L, CLOSED_NAMES).length) * CLOSED_ROW + 8;

/**
 * A closed lane: every entry a faint tick; each entry at an end of an arrow is named, then the three
 * most prominent, in time order on up to three rows: a diamond at its start, its years as a thin
 * bar (so an arrow lands at the year it acted), and its name. Clicking the lane opens it.
 */
function closedLane(c: Ctx, EL: EraLanes, L: Lane1, top: number, h: number) {
  const { V, E, S, X, x0, x1 } = c;
  const M = E.measure;
  if (top + h < c.top || top > c.bottom) return;
  S.targets.push({ id: LANE_TOGGLE + L.id, x: x0, y: top, w: x1 - x0, h });
  const named = namedOf(EL, L, CLOSED_NAMES).sort((a, b) => a.s - b.s || a.id.localeCompare(b.id));
  const isNamed = new Set(named.map((it) => it.id));
  for (const it of L.order) {
    const xa = X(it.s), xb = X(it.e);
    if (xb < x0 - 2 || xa > x1 + 2) continue;
    if (!isNamed.has(it.id) && it.kind !== 'event' && xb - xa > 2) {
      const ra = Math.max(xa, x0 - 2);
      S.z[0].push({ t: 0, k: `qk${L.id}${it.id}`, a: 1, x: ra, y: top + 11, w: Math.min(xb, x1 + 2) - ra, h: 2, r: 1, fill: tint(L.color, 28) });
    }
    if (xa >= x0) S.z[0].push({ t: 3, k: `qt${L.id}${it.id}`, a: 1, cls: 'tl-tick1', x1: xa, y1: top + 4, x2: xa, y2: top + 11, stroke: tint(L.color, 55) });
  }
  const R = closedRows(named.length);
  const D1 = 10;
  named.forEach((it, i) => {
    if (it.e < V.win.start || it.s > V.win.end) return;
    const row = i % R;
    const cy = top + CLOSED_TICKS + row * CLOSED_ROW + CLOSED_ROW / 2;
    // A span already under way sticks to the left edge.
    const x = Math.max(X(it.s), x0 + D1 / 2 + 2);
    const lx = x + D1 / 2 + 5;
    // Its name runs until the next one on its row.
    const next = named.slice(i + 1).find((_, j) => (i + 1 + j) % R === row);
    const room = Math.min(x1 - 6, next ? X(next.s) - D1 - 4 : Infinity) - lx;
    const label = fit(M, it.draft ? 'spanI' : 'ui', titleOf(it), room);
    const sel = V.selected === it.id, hot = sel || V.hover === it.id;
    const role = roleOf(V, it);
    const lit = ROLE_STROKE[role.trim()];
    const color = it.draft ? UMBER : L.color;
    const xb = Math.min(X(it.e), x1 + 2);
    const span = it.kind !== 'event' && xb - x > 2;
    if (span) S.z[1].push({ t: 0, k: `qnb${L.id}${it.id}`, a: 1, cls: `tl-named-bar${role}`, id: it.id, x, y: cy + 6, w: xb - x, h: 3, r: 1.5, fill: tint(color, hot ? 75 : 50) });
    if (hot || lit) S.z[1].push({ t: 1, k: `qnh${L.id}${it.id}`, a: 1, cls: role.trim() || undefined, x, y: cy, r: D1 / 2 + 3, fill: 'var(--panel)', stroke: lit ?? 'var(--ink)', sw: lit ? 2.5 : 1.5 });
    S.z[1].push({ t: 6, k: `qn${L.id}${it.id}`, a: 1, cls: `${it.draft ? 'tl-draft' : 'tl-mark'} tl-named${sel ? ' selected' : ''}${role}`, id: it.id, x: x - D1 / 2, y: cy - D1 / 2, w: D1, g: it.approx || it.draft ? 'diamond-approx' : 'diamond', color });
    if (label) S.z[2].push({ t: 2, k: `qnt${L.id}${it.id}`, a: 1, cls: `tl-label${role}`, id: it.id, x: lx, y: cy + 4, s: label, f: it.draft ? 'spanI' : 'ui', fill: it.draft ? UMBER : hot ? 'var(--ink)' : 'var(--ink-2)' });
    const box = span ? { x: x - D1 / 2, y: cy - D1 / 2, w: xb - x + D1 / 2, h: D1 + 4 } : { x: x - D1 / 2, y: cy - D1 / 2, w: D1, h: D1 };
    S.boxes.set(it.id, box);
    S.laneBoxes.set(`${L.id}:${it.id}`, box);
    const right = label ? lx + M('ui', label) + 4 : x + D1 / 2 + 4;
    // At least 24 px to tap, but never over the next one on its row.
    const stop = next ? Math.max(X(next.s), x0 + D1 / 2 + 2) - D1 / 2 - 1 : Infinity;
    const tx = x - D1 / 2 - 4;
    S.targets.push({ id: it.id, lane: L.id, x: tx, y: cy - CLOSED_ROW / 2, w: Math.min(Math.max(MIN_HIT, right - tx), stop - tx), h: CLOSED_ROW, grip: sel && V.editable && !it.draft ? 'body' : undefined });
  });
}

/** Key moments: diamonds on a row above the spans, each named unless its name would run into the one before. */
function moments1(c: Ctx, L: Lane1, rowTop: number) {
  const { V, E, S, X, x0, x1 } = c;
  if (rowTop + MOMENT_ROW < c.top || rowTop > c.bottom) return;
  const M = E.measure;
  const cy = rowTop + MOMENT_ROW / 2;
  const xs = L.moments.map((m) => X(m.s));
  let right = -Infinity;
  L.moments.forEach((it, i) => {
    const x = xs[i];
    if (x < x0 - 240 || x > x1 + DIAMOND) return;
    const sel = V.selected === it.id, hot = sel || V.hover === it.id;
    const role = roleOf(V, it);
    const lit = ROLE_STROKE[role.trim()];
    const w = sel ? DIAMOND + 4 : DIAMOND;
    if (hot || lit) S.z[1].push({ t: 1, k: `qmh${L.id}${it.id}`, a: 1, cls: role.trim() || undefined, x, y: cy, r: w / 2 + 3, fill: 'var(--panel)', stroke: lit ?? 'var(--ink)', sw: lit ? 2.5 : 1.5 });
    S.z[1].push({ t: 6, k: `qm${L.id}${it.id}`, a: 1, cls: `${it.draft ? 'tl-draft' : 'tl-mark'} tl-moment${sel ? ' selected' : ''}${role}`, id: it.id, x: x - w / 2, y: cy - w / 2, w, g: it.approx || it.draft ? 'diamond-approx' : 'diamond', color: it.draft ? UMBER : L.color });
    S.boxes.set(it.id, { x: x - w / 2, y: cy - w / 2, w, h: w });
    S.laneBoxes.set(`${L.id}:${it.id}`, S.boxes.get(it.id)!);
    const hx = x - MIN_HIT / 2;
    let hw = MIN_HIT;
    if (x - DIAMOND / 2 - 4 > right) {
      const next = i + 1 < xs.length ? xs[i + 1] - DIAMOND : Infinity;
      const lx = x + DIAMOND / 2 + 5;
      const label = placeLabel(M, it.draft ? 'spanI' : 'ui', titleOf(it), Math.min(next, x1 - 4) - lx);
      if (label) {
        S.z[2].push({ t: 2, k: `qmt${L.id}${it.id}`, a: 1, cls: `tl-label${role}`, id: it.id, x: lx, y: cy + 4, s: label, f: it.draft ? 'spanI' : 'ui', fill: it.draft ? UMBER : hot ? 'var(--ink)' : 'var(--ink-2)' });
        right = lx + M('ui', label);
        hw = right + 4 - hx;
      } else right = x + DIAMOND / 2;
    }
    // The open entry can be dragged to new dates.
    S.targets.push({ id: it.id, lane: L.id, x: hx, y: rowTop, w: hw, h: MOMENT_ROW, grip: sel && V.editable && !it.draft ? 'body' : undefined });
  });
}

/** A span of change: a named bar in its row, dashed when a date is approximate. */
function phase(c: Ctx, EL: EraLanes, L: Lane1, it: PItem, rowTop: number) {
  const { V, E, S, X, x0, x1 } = c;
  if (it.e < V.win.start || it.s > V.win.end || rowTop + ROW_H < c.top || rowTop > c.bottom) return;
  const M = E.measure;
  const xa = X(it.s), xb = Math.max(X(it.e), xa + 3);
  const rx = Math.max(xa, x0 - 4), rw = Math.max(3, Math.min(xb, x1 + 4) - rx);
  const va = Math.max(xa, x0), vw = Math.min(xb, x1) - va;
  const by = rowTop + 4, bh = 20;
  const sel = V.selected === it.id, hot = sel || V.hover === it.id;
  const role = roleOf(V, it);
  const lit = ROLE_STROKE[role.trim()];
  const k = `${L.id}${it.id}`;
  // Claude's draft is a dashed umber ghost.
  const color = it.draft ? UMBER : L.color;
  S.z[1].push({
    t: 0, k: `qb${k}`, a: 1, cls: `${it.draft ? 'tl-draft' : 'tl-mark'} tl-phase${sel ? ' selected' : ''}${role}`, id: it.id, x: rx, y: by, w: rw, h: bh, r: 2, fill: it.draft ? 'var(--panel)' : tint(color, hot ? 28 : 16),
    stroke: lit ?? (sel ? 'var(--ink)' : `color-mix(in srgb, ${color} 60%, transparent)`), sw: lit ? 2.5 : sel ? 2 : 1, dash: it.draft || (!lit && !sel && (it.approx || it.endApprox)),
  });
  S.boxes.set(it.id, { x: rx, y: by, w: rw, h: bh });
  S.laneBoxes.set(`${L.id}:${it.id}`, S.boxes.get(it.id)!);
  let hx = rx, hw = rw;
  if (hw < MIN_HIT) { hx = rx + rw / 2 - MIN_HIT / 2; hw = MIN_HIT; }
  // Its name: inside, else just after it when there's room before the next in its row, else cut short, else hidden.
  const title = titleOf(it), font = it.draft ? 'spanI' : 'span', ink = it.draft ? UMBER : 'var(--ink)';
  const lw = M(font, title);
  const ty = by + bh / 2 + 4.5;
  if (vw >= 3 && lw + 14 <= vw) {
    S.z[2].push({ t: 2, k: `qbt${k}`, a: 1, cls: `tl-label${role}`, id: it.id, x: va + 7, y: ty, s: title, f: font, fill: ink });
  } else if (vw >= 3) {
    const next = EL.nextOf.get(`${L.id}:${it.id}`);
    const room = (next === undefined ? Infinity : X(next)) - xb - 12;
    if (lw <= room && xb + 6 + lw <= x1) {
      S.z[2].push({ t: 2, k: `qbt${k}`, a: 1, cls: `tl-label${role} out`, id: it.id, x: xb + 6, y: ty, s: title, f: font, fill: it.draft ? UMBER : 'var(--ink-2)' });
      hw = Math.max(hw, xb + 6 + lw - hx);
    } else {
      const s = vw >= MIN_LABEL ? fit(M, font, title, vw - 14) : '';
      if (s) S.z[2].push({ t: 2, k: `qbt${k}`, a: 1, cls: `tl-label${role}`, id: it.id, x: va + 7, y: ty, s, f: font, fill: ink });
    }
  }
  const target: Target = { id: it.id, lane: L.id, x: hx, y: rowTop, w: hw, h: ROW_H };
  S.targets.push(target);
  if (!sel || !V.editable || it.draft) return;
  // The open entry can be dragged: its body moves both dates, an end (when the bar is wide enough to tell them apart) only that one.
  target.grip = 'body';
  if (rw < GRIP_PX * 4) return;
  const grip = (part: 'start' | 'end', x: number) => {
    S.z[2].push({ t: 0, k: `bg${part}${k}`, a: 1, cls: 'tl-grip', x: x - 2, y: by + 4, w: 4, h: bh - 8, r: 2, fill: 'var(--ink)' });
    S.targets.push({ id: it.id, grip: part, lane: L.id, x: x - GRIP_PX, y: rowTop, w: GRIP_PX * 2, h: ROW_H });
  };
  if (xa >= x0) grip('start', xa + 1);
  if (!it.open && xb <= x1) grip('end', xb - 1);
}

/**
 * On a phone: the lane's name, its bars without labels, then a dated list of its spans and moments
 * to tap. A closed lane (in a polity) is its name, a strip of ticks, and its three most prominent.
 */
function phoneLane(c: Ctx, EL: EraLanes, L: Lane1, top: number, h: number) {
  const { V, E, S, X, x0, x1 } = c;
  const M = E.measure;
  const open = isOpen(EL, L);
  S.z[0].push({ t: 0, k: `qw${L.id}`, a: 1, cls: `tl-lane1 ${L.id}`, x: x0, y: top, w: x1 - x0, h, fill: tint(L.color, 6) });
  S.z[0].push({ t: 3, k: `qr${L.id}`, a: 1, x1: x0, y1: top + h - 0.5, x2: x1, y2: top + h - 0.5, stroke: 'var(--rule-soft)' });
  S.z[2].push({ t: 0, k: `qgs${L.id}`, a: 1, x: x0 + 12, y: top + 12, w: 9, h: 9, r: 1, fill: L.color });
  const name = L.label.toUpperCase();
  S.z[2].push({ t: 2, k: `qgn${L.id}`, a: 1, cls: 'tl-lane-name', x: x0 + 28, y: top + 21, s: name, f: 'dim', fill: 'var(--ink)' });
  if (L.countLabel) S.z[2].push({ t: 2, k: `qgc${L.id}`, a: 1, x: x0 + 28 + M('dim', name) + 10, y: top + 21, s: L.countLabel, f: 'dimCount', fill: 'var(--muted)' });
  // "+ Add" at the end of the lane's heading.
  if (L.id !== NO_LANE && top + 4 >= c.top && top + 4 + ADD_H <= c.bottom) S.adds.push({ lane: L.id as Lane, label: L.label, x: x1 - 8 - ADD_W, y: top + 4, w: ADD_W, h: ADD_H });
  if (EL.compact && L.order.length) S.targets.push({ id: LANE_TOGGLE + L.id, x: x0, y: top, w: x1 - x0, h: P_HEAD });
  if (!L.order.length) {
    S.z[2].push({ t: 2, k: `qe${L.id}`, a: 1, cls: 'tl-lane-empty', x: x0 + 12, y: top + P_HEAD + 18, s: emptyNote(L), f: 'note', fill: 'var(--muted)' });
    return;
  }
  let y = top + P_HEAD;
  let list = L.order;
  if (!open) {
    for (const it of L.order) {
      const x = X(it.s);
      if (x < x0 || x > x1) continue;
      S.z[1].push({ t: 3, k: `qt${L.id}${it.id}`, a: 1, cls: 'tl-tick1', x1: x, y1: y + 2, x2: x, y2: y + P_TICKS - 2, stroke: tint(L.color, 55) });
    }
    y += P_TICKS + 6;
    list = phoneList(EL, L);
  } else {
    if (L.moments.length) {
      for (const m of L.moments) {
        const x = X(m.s);
        if (x < x0 - 6 || x > x1 + 6) continue;
        S.z[1].push({ t: 6, k: `qm${L.id}${m.id}`, a: 1, cls: `tl-moment${roleOf(V, m)}`, id: m.id, x: x - 4.5, y: y + P_MOMENT / 2 - 4.5, w: 9, g: m.approx ? 'diamond-approx' : 'diamond', color: L.color });
      }
      y += P_MOMENT;
    }
    for (const it of L.spans) {
      const xa = X(it.s), xb = Math.max(X(it.e), xa + 3);
      if (xb < x0 || xa > x1) continue;
      const rx = Math.max(xa, x0 - 2);
      S.z[1].push({ t: 0, k: `qb${L.id}${it.id}`, a: 1, cls: `tl-phase${roleOf(V, it)}`, id: it.id, x: rx, y: y + EL.rowOf.get(`${L.id}:${it.id}`)! * P_ROW + 2, w: Math.min(xb, x1 + 2) - rx, h: P_ROW - 4, r: 1.5, fill: tint(L.color, 30), stroke: it.approx || it.endApprox ? L.color : undefined, dash: it.approx || it.endApprox });
    }
    y += L.rows * P_ROW + 6;
  }
  let next = y;
  list.forEach((it) => {
    const ry = next;
    next += itemH(EL, L, it.id);
    effectLines(c, EL, L, it, ry + P_ITEM);
    if (ry + P_ITEM < c.top || ry > c.bottom) return;
    const sel = V.selected === it.id, hot = sel || V.hover === it.id;
    const role = roleOf(V, it);
    const k = `${L.id}${it.id}`;
    if (hot) S.z[1].push({ t: 0, k: `qlb${k}`, a: 1, x: x0 + 4, y: ry + 1, w: x1 - x0 - 8, h: P_ITEM - 2, r: 4, fill: tint(L.color, sel ? 24 : 12) });
    const years = fit(M, 'tick', it.dates, P_YEAR - 8);
    S.z[2].push({ t: 2, k: `qly${k}`, a: 1, cls: role.trim() || undefined, x: x0 + 12, y: ry + 19, s: years, f: 'tick', fill: 'var(--muted)' });
    // An approximate date is underlined with a dashed umber rule, as edges are dashed elsewhere.
    if (it.approx || it.endApprox) S.z[2].push({ t: 3, k: `qlu${k}`, a: 1, cls: 'tl-approx', x1: x0 + 12, y1: ry + 23, x2: x0 + 12 + M('tick', years), y2: ry + 23, stroke: UMBER, dash: true });
    let tx = x0 + 12 + P_YEAR;
    if (it.kind === 'event') {
      S.z[2].push({ t: 6, k: `qld${k}`, a: 1, cls: role.trim() || undefined, x: tx, y: ry + P_ITEM / 2 - 4.5, w: 9, g: it.approx ? 'diamond-approx' : 'diamond', color: L.color });
      tx += 15;
    }
    S.z[2].push({ t: 2, k: `qlt${k}`, a: 1, cls: `${it.draft ? 'tl-draft ' : ''}tl-list-item${sel ? ' selected' : ''}${role}`, id: it.id, x: tx, y: ry + 19.5, s: fit(M, 'item', titleOf(it), x1 - 12 - tx), f: 'item', fill: it.draft ? UMBER : 'var(--ink)' });
    S.boxes.set(it.id, { x: x0 + 4, y: ry + 1, w: x1 - x0 - 8, h: P_ITEM - 2 });
    S.targets.push({ id: it.id, lane: L.id, x: x0, y: ry, w: x1 - x0, h: P_ITEM });
  });
  // "Show all 12" under a closed lane's list, "Show fewer" under an open one's.
  if (EL.compact && L.order.length > P_CLOSED_LIST && (open || list.length < L.order.length)) {
    const ry = y + listH(EL, L, list);
    const hot = V.hover === LANE_TOGGLE + L.id;
    S.z[2].push({ t: 2, k: `qls${L.id}`, a: 1, cls: 'tl-lane-toggle', id: LANE_TOGGLE + L.id, x: x0 + 12 + P_YEAR, y: ry + 19.5, s: `${toggleNote(EL, L)} ${open ? '▴' : '▾'}`, f: 'ui', fill: hot ? 'var(--ink)' : 'var(--ink-2)' });
    S.targets.push({ id: LANE_TOGGLE + L.id, x: x0, y: ry, w: x1 - x0, h: P_ITEM });
  }
}

/**
 * On a phone, under an entry at an end of an arrow: a line per effect, the other lane's square, the
 * effect in bold, then the other entry ("weakened by Plague of Athens"). Tapping it opens the connection.
 */
function effectLines(c: Ctx, EL: EraLanes, L: Lane1, it: PItem, top: number) {
  const { D, V, E, S, x0, x1 } = c;
  const M = E.measure;
  effOf(EL, L, it.id).forEach((x, i) => {
    const y = top + i * P_EFF;
    const cause = x.r.fromId === it.id;
    if (y + P_EFF < c.top || y > c.bottom) return;
    const otherLane = cause ? x.to : x.from;
    const other = D.byId.get(cause ? x.r.toId : x.r.fromId);
    const id = ARROW + x.r.id, hot = V.hover === id;
    const k = `qe${L.id}${it.id}${x.r.id}`;
    if (hot) S.z[1].push({ t: 0, k: `${k}b`, a: 1, x: x0 + 4, y: y + 1, w: x1 - x0 - 8, h: P_EFF - 2, r: 4, fill: tint(L.color, 10) });
    let tx = x0 + 12 + P_YEAR;
    S.z[2].push({ t: 0, k: `${k}s`, a: 1, x: tx, y: y + 7, w: 8, h: 8, r: 1, fill: `var(--pig-${PIGMENT[otherLane]})` });
    tx += 14;
    const word = describeEffect(x.r, cause ? 'out' : 'in').toLowerCase();
    S.z[2].push({ t: 2, k: `${k}w`, a: 1, cls: 'tl-effect-line', id, x: tx, y: y + 15, s: word, f: 'effLineB', fill: 'var(--ink)' });
    tx += M('effLineB', word) + 5;
    const name = fit(M, 'effLine', other?.title ?? 'Missing entry', x1 - 12 - tx);
    if (name) S.z[2].push({ t: 2, k: `${k}n`, a: 1, cls: 'tl-effect-line', id, x: tx, y: y + 15, s: name, f: 'effLine', fill: 'var(--ink-2)' });
    S.targets.push({ id, x: x0, y, w: x1 - x0, h: P_EFF });
  });
}

/** On a phone: the middle of each effect line (`<connection>:from` or `:to`), lanes starting at `top`, in view or not. */
function effectLineYs(EL: EraLanes, top: number): Map<string, number> {
  const ys = new Map<string, number>();
  for (const L of EL.lanes) {
    if (L.order.length) {
      let y = top + P_HEAD + (isOpen(EL, L) ? (L.moments.length ? P_MOMENT : 0) + L.rows * P_ROW + 6 : P_TICKS + 6);
      for (const it of phoneList(EL, L)) {
        effOf(EL, L, it.id).forEach((x, i) => ys.set(`${x.r.id}:${x.r.fromId === it.id ? 'from' : 'to'}`, y + P_ITEM + i * P_EFF + P_EFF / 2));
        y += itemH(EL, L, it.id);
      }
    }
    top += laneH(EL, L, true);
  }
  return ys;
}

/** On a phone: arcs in the left margin join each arrow's two effect lines, in the cause's pigment, nested on their own tracks. */
function marginArcs(c: Ctx, EL: EraLanes, top: number) {
  const { S, x0 } = c;
  const ys = effectLineYs(EL, top);
  const spans = EL.influences.flatMap((x) => {
    const ya = ys.get(`${x.r.id}:from`), yb = ys.get(`${x.r.id}:to`);
    return ya !== undefined && yb !== undefined ? [{ x, ya, yb }] : [];
  }).sort((p, q) => Math.abs(p.yb - p.ya) - Math.abs(q.yb - q.ya));
  // The shortest go innermost; each takes the first track free over its whole height.
  const tracks: Array<Array<[number, number]>> = [];
  for (const sp of spans) {
    const lo = Math.min(sp.ya, sp.yb), hi = Math.max(sp.ya, sp.yb);
    let t = tracks.findIndex((tr) => !tr.some(([a, b]) => lo < b + 3 && hi > a - 3));
    if (t < 0) t = tracks.push([]) - 1;
    tracks[t].push([lo, hi]);
    const xt = Math.max(x0 + 1.5, x0 + 9 - (t + 1) * 2.5), xe = x0 + 10;
    const id = ARROW + sp.x.r.id;
    const hot = c.V.hover === id;
    if (hi < c.top || lo > c.bottom) continue;
    S.z[3].push({ t: 5, k: `qma${sp.x.r.id}`, a: 1, cls: 'tl-margin-arc', d: `M${xe} ${sp.ya} C${xt} ${sp.ya} ${xt} ${sp.yb} ${xe} ${sp.yb}`, stroke: `var(--pig-${PIGMENT[sp.x.from]})`, sw: hot ? 2.2 : 1.4 });
  }
}

/** The head of open lanes: "▴ Fold" (in the gutter on a laptop), then the name (which opens its entry), dates and count. */
function blockHead(c: Ctx, EL: EraLanes, top: number, phone: boolean) {
  const { V, E, S, X, x0, x1 } = c;
  const M = E.measure;
  const H = EL.head, h = HEAD1_H, ty = top + 24;
  const fold = '▴ Fold', hotFold = V.hover === LOCAL_FOLD;
  const foldInk = hotFold ? 'var(--ink)' : 'var(--ink-2)';
  let nx: number;
  if (phone) {
    S.z[2].push({ t: 2, k: 'qfold', a: 1, cls: 'tl-fold', id: LOCAL_FOLD, x: x0 + 12, y: ty, s: fold, f: 'ui', fill: foldInk });
    S.targets.push({ id: LOCAL_FOLD, x: x0, y: top, w: M('ui', fold) + 24, h });
    nx = x0 + 12 + M('ui', fold) + 16;
  } else {
    S.gutter.push({ t: 2, k: 'qfold', a: 1, cls: 'tl-fold', id: LOCAL_FOLD, x: 14, y: ty, s: fold, f: 'ui', fill: foldInk });
    S.targets.push({ id: LOCAL_FOLD, gutter: true, x: 0, y: top, w: Math.min(E.gutter, M('ui', fold) + 28), h });
    // The name sits at the start, and stays in view while that scrolls off to the left.
    nx = Math.max(X(H.s), x0) + 12;
  }
  const name = fit(M, 'era', H.title, x1 - nx - 12);
  if (name) {
    const nw = M('era', name);
    const sel = !!H.opens && V.selected === H.opens, hot = sel || (!!H.opens && V.hover === H.opens);
    S.z[2].push({ t: 2, k: 'qhn', a: 1, cls: `tl-era-head${sel ? ' selected' : ''}`, id: H.opens ?? H.id, x: nx, y: ty, s: name, f: 'era', fill: 'var(--ink)' });
    if (hot) S.z[2].push({ t: 3, k: 'qhu', a: 1, x1: nx, y1: ty + 4, x2: nx + nw, y2: ty + 4, stroke: sel ? 'var(--ink)' : 'var(--ink-2)', sw: sel ? 1.5 : 1 });
    // Tagged, so a tap on an era's name opens the era rather than folding its lanes.
    if (H.opens) S.targets.push({ id: H.opens, lane: 'head', x: nx - 4, y: top, w: nw + 8, h });
    const rest = `${H.when} · ${H.sub}`;
    if (nx + nw + 12 + M('eraDates', rest) <= x1 - 8) S.z[2].push({ t: 2, k: 'qhd', a: 1, x: nx + nw + 12, y: ty, s: rest, f: 'eraDates', fill: 'var(--muted)' });
  }
  themeRow(c, EL, top + HEAD1_H - 4);
}

/** The theme chips under the name; picking one fades everything outside it. */
function themeRow(c: Ctx, EL: EraLanes, top: number) {
  const { V, E, S } = c;
  const { chips, more } = headChips(EL, E, V.theme?.key);
  if (!chips.length && !more) return;
  const h = head1H(EL, E, V.theme?.key) - HEAD1_H;
  S.z[2].push({ t: 0, k: 'qtbg', a: 1, x: c.x0, y: top + 4, w: c.x1 - c.x0, h, fill: 'var(--panel)' });
  S.z[2].push({ t: 3, k: 'qtr', a: 1, x1: c.x0, y1: top + 4 + h - 0.5, x2: c.x1, y2: top + 4 + h - 0.5, stroke: 'var(--rule)' });
  if (E.gutter) S.gutter.push({ t: 0, k: 'qtgbg', a: 1, x: 0, y: top + 4, w: E.gutter, h, fill: 'var(--panel)' });
  for (const b of chips) {
    const y = top + 4 + b.line * CHIP_LINE, key = `${b.era}:${b.theme.id}`, id = themeKey(b.era, b.theme.id);
    S.z[2].push(...chipPrims(b, y, { hot: V.hover === id, picked: V.theme?.key === key, a: V.theme && V.theme.key !== key ? 0.55 : 1 }));
    S.targets.push({ id, x: b.x, y, w: b.w, h: CHIP_LINE - 4 });
  }
  if (more) {
    const y = top + 4 + more.line * CHIP_LINE, hot = V.hover === LOCAL_MORE;
    S.z[2].push({ t: 0, k: 'qtm', a: 1, cls: 'tl-chip-more', id: LOCAL_MORE, x: more.x, y, w: more.w, h: CHIP_LINE - 4, r: 3, fill: 'var(--panel)', stroke: hot ? 'var(--ink-2)' : 'var(--rule)', sw: 1 });
    S.z[2].push({ t: 2, k: 'qtmt', a: 1, cls: 'tl-chip-more-label', id: LOCAL_MORE, x: more.x + more.w / 2, y: y + 12, s: more.label, f: 'chipN', fill: hot ? 'var(--ink)' : 'var(--muted)', anchor: 'middle' });
    S.targets.push({ id: LOCAL_MORE, x: more.x, y, w: more.w, h: CHIP_LINE - 4 });
  }
}

/* ---------- arrows, the keyboard's ring and the dragged entry ---------- */

const edges = (b: Box): Edges => ({ left: b.x, right: b.x + b.w, top: b.y, bottom: b.y + b.h });
const ARC_STROKE: Record<string, string> = { ...ROLE_STROKE, draft: UMBER };

/** The open entry's connections, as arrows between where both ends are drawn. */
function arrows(c: Ctx, skip?: ReadonlySet<string>) {
  const { V, S } = c;
  for (const l of V.links ?? []) {
    if (skip?.has(`${l.fromId}>${l.toId}`)) continue;
    const from = S.boxes.get(l.fromId), to = S.boxes.get(l.toId);
    if (!from || !to || from === to) continue;
    const { a, b } = anchors(edges(from), edges(to));
    const curve = Math.abs(a.x - b.x) < 6 ? loopCurve(a, b) : arcCurve(a, b);
    const k = `${l.role}${l.fromId}>${l.toId}`;
    const dash = l.role === 'linked' || l.role === 'draft';
    S.z[3].push({ t: 5, k, a: 0.9, cls: `arc ${l.role}`, d: curve.d, stroke: ARC_STROKE[l.role], sw: dash ? 1.5 : 2, dash, head: l.role, from: l.fromId, to: l.toId });
    if (!l.label) continue;
    // The label stays inside the plot, even when the arrow runs off its edge.
    const half = c.E.measure('arc', l.label) / 2 + 4;
    const lx = Math.min(Math.max(curve.mid.x, c.x0 + half), c.x1 - half);
    const ly = Math.min(Math.max(curve.mid.y + 4, c.top + 16), c.bottom - 6);
    S.z[3].push({ t: 2, k: `${k}t`, a: 1, cls: `tl-arc-label ${l.role}`, x: lx, y: ly, s: l.label, f: 'arc', fill: ARC_STROKE[l.role], anchor: 'middle' });
  }
}

function focusRing(c: Ctx) {
  const { V, S } = c;
  const b = V.ring && V.active ? S.boxes.get(V.active) : undefined;
  if (!b) return;
  S.z[3].push({ t: 0, k: 'ring', a: 1, cls: 'tl-ring', x: b.x - 4, y: b.y - 4, w: b.w + 8, h: b.h + 8, r: 6, stroke: 'var(--focus)', sw: 2 });
}

/** A ring round each picked entry, and the box being drawn. */
function picks(c: Ctx) {
  const { V, S } = c;
  const seen = new Set<Box>();
  for (const id of V.picked ?? []) {
    const b = S.boxes.get(id);
    if (!b || seen.has(b)) continue;
    seen.add(b);
    S.z[3].push({ t: 0, k: `pk${id}`, a: 1, cls: 'tl-picked', id, x: b.x - 3, y: b.y - 3, w: b.w + 6, h: b.h + 6, r: 5, fill: 'color-mix(in srgb, var(--focus) 12%, transparent)', stroke: 'var(--focus)', sw: 1.5 });
  }
  const r = V.box && norm(V.box);
  if (r) S.z[3].push({ t: 0, k: 'box', a: 1, cls: 'tl-box', x: r.x, y: r.y, w: r.w, h: r.h, fill: 'color-mix(in srgb, var(--focus) 8%, transparent)', stroke: 'var(--focus)', sw: 1, dash: true });
}

/** A box drawn in any direction, with a positive width and height. */
const norm = (b: Box): Box => ({ x: Math.min(b.x, b.x + b.w), y: Math.min(b.y, b.y + b.h), w: Math.abs(b.w), h: Math.abs(b.h) });

/** While the open entry is dragged it stays where it was, faded, and a copy shows where it's going, its new dates on the axis. */
function dragPreview(c: Ctx) {
  const { V, D, E, S, X } = c;
  const g = V.drag && D.byId.get(V.drag.id);
  if (!V.drag || !g) return;
  const { s, e, label, y, color } = V.drag;
  const xa = X(s), xb = Math.max(X(e), xa + 3);
  for (const z of [S.z[1], S.z[2]]) for (let i = 0; i < z.length; i++) if (z[i].id === g.id) z[i] = { ...z[i], a: 0.35 };
  if (g.kind === 'event') {
    S.z[3].push({ t: 6, k: 'dragm', a: 1, cls: 'tl-dragged', x: xa - 8, y: y + MOMENT_ROW / 2 - 8, w: 16, g: 'diamond', color });
  } else {
    S.z[3].push({ t: 0, k: 'dragb', a: 1, cls: 'tl-dragged', x: xa, y: y + 4, w: xb - xa, h: 20, r: 2, fill: tint(color, 30), stroke: 'var(--ink)', sw: 2 });
  }
  const w = E.measure('play', label) + 14;
  const cx = Math.min(Math.max((xa + xb) / 2, c.x0 + w / 2), c.x1 - w / 2);
  S.axis.push({ t: 0, k: 'dragc', a: 1, x: cx - w / 2, y: AXIS_H - 22, w, h: 19, r: 4, fill: 'var(--focus)' });
  S.axis.push({ t: 2, k: 'dragt', a: 1, cls: 'tl-drag-date', x: cx, y: AXIS_H - 8.5, s: label, f: 'play', fill: 'var(--panel)', anchor: 'middle' });
}

/* ---------- axis, today and the playhead ---------- */

function axis(c: Ctx) {
  const { V, E, S, X, x0, x1 } = c;
  // The axis keeps Spectral's old-style numerals.
  const [minor, major] = ['tick0', 'tick0B'] as const;
  const ts = axisTicks(V.win.start, V.win.end, x1 - x0, 78);
  S.axis.unshift({ t: 0, k: 'abg', a: 1, x: x0, y: 0, w: x1 - x0, h: AXIS_H, fill: 'var(--panel)' }, { t: 3, k: 'arule', a: 1, x1: x0, y1: AXIS_H - 0.5, x2: x1, y2: AXIS_H - 0.5, stroke: 'var(--rule)' });
  const ax: Prim[] = [];
  for (const t of ts.ticks) {
    const x = X(t.y);
    if (x < x0 - 40 || x > x1 + 40) continue;
    S.z[0].push({ t: 3, k: `g${t.y}`, a: 1, x1: x, y1: AXIS_H, x2: x, y2: E.h, stroke: t.major ? 'var(--rule)' : 'var(--rule-soft)' });
    ax.push({ t: 3, k: `ak${t.y}`, a: 1, x1: x, y1: AXIS_H - (t.major ? 7 : 4), x2: x, y2: AXIS_H, stroke: 'var(--ink-2)' });
    // A label that would be cut off at either edge is left out; its tick stays.
    const half = E.measure(t.major ? major : minor, t.label) / 2;
    if (x - half < x0 || x + half > x1) continue;
    ax.push({ t: 2, k: `at${t.y}`, a: 1, cls: 'tl-tick', x, y: ts.heads.length ? 18 : 26, s: t.label, f: t.major ? major : minor, fill: t.major ? 'var(--ink)' : 'var(--ink-2)', anchor: 'middle' });
  }
  // Month or year headings above day or month ticks, pinned to the left edge while they're in view.
  for (let i = 0; i < ts.heads.length; i++) {
    const h = ts.heads[i];
    const next = i + 1 < ts.heads.length ? X(ts.heads[i + 1].y) : Infinity;
    const x = Math.max(X(h.y), x0) + 4;
    if (next < x0 || x > x1 || next - x < 40) continue;
    ax.push({ t: 2, k: `ah${h.y}`, a: 1, x, y: 34, s: h.label, f: 'head', fill: 'var(--muted)' });
  }
  // Ticks sit under the drag chip, if there is one.
  S.axis.splice(2, 0, ...ax);
  const now = X(V.now);
  if (now >= x0 && now <= x1) S.axis.push({ t: 3, k: 'now', a: 0.5, x1: now, y1: AXIS_H, x2: now, y2: E.h, stroke: 'var(--pig-cinnabar)', sw: 2 });
  if (V.playYear !== undefined) {
    const px = X(V.playYear);
    if (px >= x0 - 1 && px <= x1 + 1) {
      const label = formatYear(Math.floor(V.playYear));
      const w = E.measure('play', label) + 12;
      // The year sits on the axis, over the tick labels, so it never covers an entry.
      S.axis.push({ t: 3, k: 'play', a: 1, cls: 'tl-playhead', x1: px, y1: AXIS_H - 4, x2: px, y2: E.h, stroke: 'var(--ink)', sw: 2 });
      S.axis.push({ t: 0, k: 'playm', a: 1, x: px - w / 2, y: AXIS_H - 22, w, h: 19, r: 4, fill: 'var(--ink)' });
      S.axis.push({ t: 2, k: 'playt', a: 1, cls: 'tl-year', x: px, y: AXIS_H - 8.5, s: label, f: 'play', fill: 'var(--panel)', anchor: 'middle' });
      // The playhead is the top target, so it can be dragged even over an entry.
      S.targets.push({ id: 'playhead', x: px - Math.max(8, w / 2), y: AXIS_H - 22, w: Math.max(16, w), h: 22 });
      S.targets.push({ id: 'playhead', x: px - 6, y: AXIS_H, w: 12, h: E.h - AXIS_H });
    }
  }
}

/** What's under a point: the last target drawn there wins. The gutter hits nothing. */
export function hitTest(S: Scene, x: number, y: number): Target | undefined {
  for (let i = S.targets.length - 1; i >= 0; i--) {
    const t = S.targets[i];
    if (x < S.plot.x && !t.gutter) continue;
    // Over the axis only the playhead's year answers; entries scrolled under it don't.
    if (y < S.plot.y && t.id !== 'playhead') continue;
    if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) return t;
  }
  return undefined;
}

/** The entries a box touches (drawn in any direction), inside the plot: not Claude's drafts. */
export function hitBox(S: Scene, D: Prepared, box: Box): string[] {
  const r = norm(box);
  const x0 = Math.max(r.x, S.plot.x), y0 = Math.max(r.y, S.plot.y);
  const x1 = Math.min(r.x + r.w, S.plot.x + S.plot.w), y1 = Math.min(r.y + r.h, S.plot.y + S.plot.h);
  if (x1 < x0 || y1 < y0) return [];
  const ids: string[] = [];
  for (const [id, b] of S.boxes) {
    const it = D.byId.get(id);
    if (!it || it.draft) continue;
    if (b.x <= x1 && b.x + b.w >= x0 && b.y <= y1 && b.y + b.h >= y0) ids.push(id);
  }
  return ids;
}

export type { Prim, Scene, Target };
