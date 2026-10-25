import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { isDated, jsDateToDecimalYear, toDecimalYear } from '../model/dates';
import { eraRegions } from '../model/eras';
import { entryLanes } from '../model/lanes';
import { lensMarks } from '../model/lenses';
import { bandOrders, moveBand } from '../model/bandOrder';
import { overview } from '../model/overview';
import { polityMembers, worldMembers } from '../model/polities';
import { threads as rollThreads } from '../model/threads';
import type { Category, DatedItem, Highlight, Lane, PolityGroup, Region, Relation, Territory, TimelineItem } from '../model/types';
import { draftArrows, influenceArrows, influenceClasses } from './influenceLinks';
import { createTimeline, type MovedDates, type OverviewFocus, type TimelineHandle } from './timeline/createTimeline';
import { focusWindow, type YearWindow } from './timeNav';

/**
 * The timeline. This is the ONLY file that knows the renderer (`./timeline/`), so the rest of
 * the app talks to it through `TimelineControl`.
 */

export interface VisibleWindow {
  /** Decimal years at the left and right edges of the visible window. */
  start: number;
  end: number;
  /** Pixel geometry of the plotting area, relative to the timeline host element. */
  left: number;
  width: number;
}

/** What the time bar and panels can ask of the timeline. Windows are in decimal years. */
export interface TimelineControl {
  setWindow: (w: YearWindow, animate?: boolean) => void;
  /** 2 = twice as many years in view, around the middle. */
  zoomBy: (factor: number) => void;
  panBy: (years: number) => void;
  fit: () => void;
  /** Frame an entry with its connections, as when it's clicked. */
  focus: (id: string) => void;
  /** Go back to the window from before the first focus. */
  back: () => void;
  /** Move a region's band one place up (-1) or down (1), as ↑ and ↓ on its name do. */
  moveRegion: (region: string, dir: -1 | 1) => void;
  /** What moves when a region's band moves up or down (it, or its larger area's name), or nothing at an end. */
  regionMoves: (region: string) => { up?: string; down?: string };
}

interface Props {
  items: TimelineItem[];
  categories: Category[];
  /** Connections; the selected item's "influenced" ones light up with arrows. */
  relations: Relation[];
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
  onAddAt: (year: number) => void;
  /** A lane's "+ Add" in an era or polity: a new entry in that lane, part of what's open. */
  onAddIn: (lane: Lane, year: number, partOf?: string) => void;
  /** An arrow between lanes was clicked: open that connection. */
  onOpenRelation?: (id: string) => void;
  onWindow: (w: VisibleWindow) => void;
  /** Whether there's a window from before the first focus to go back to. */
  onCanGoBack: (can: boolean) => void;
  /** The map's current year as a draggable playhead. Omit when the map is hidden. */
  year?: number;
  onYear?: (year: number) => void;
  /** How much Bob has made of an entry; a cluster is led by its most prominent member. */
  prominence?: (id: string) => number;
  /** Claude's drafts waiting for Bob, drawn dashed (entries as ghosts, connections as arrows). */
  drafts?: { items: TimelineItem[]; relations: Relation[] };
  /** Bob dragged the open entry to new dates. */
  onMove?: (id: string, dates: MovedDates) => void;
  /** Bob's highlights, counted into the eras. */
  highlights?: Highlight[];
  /** Entries box-selected for bulk edit (Ctrl or ⌘ and drag or click), and the new selection when Bob changes it. */
  picked?: string[];
  onPick?: (ids: string[]) => void;
  /** The overview: polities (territories), their groups, and each region's parent. */
  territories?: Territory[];
  groups?: PolityGroup[];
  regions?: Region[];
  /** What the overview has picked or open, for the map to follow. */
  onFocus?: (f: OverviewFocus) => void;
  /** The region Bob clicked on the map: the overview grows its rows. Esc lets go (`onRegion(undefined)`). */
  region?: string;
  onRegion?: (region: string | undefined) => void;
  /** "Show all threads", and a ribbon clicked (its connections, and the two rows it joins). */
  allThreads?: boolean;
  onOpenThread?: (t: { ids: string[]; title: string }) => void;
  /** The lenses on (a strip of each lane's ticks under every band). */
  lenses?: readonly Lane[];
  /** The groups open, and Bob folding or unfolding one (the groups now open). */
  unfolded?: readonly string[];
  onUnfold?: (ids: string[]) => void;
  /** What's open in place (`pol:<territory>`, world events' and eras' ids), and Bob opening or folding one (what's open now). */
  opened?: readonly string[];
  onOpen?: (keys: string[]) => void;
  /** Bob clicked a band's name: its region's menu, beside `anchor`. */
  onRegionMenu?: (region: string, anchor: DOMRect) => void;
  /** Bob moved a band: where the bands he's moved now sit (`setRegionOrders`), and what moved in words. Without it bands don't move. */
  onRegionOrder?: (orders: Map<string, number>, moved: string) => void;
}

export type { OverviewFocus };

const NO_DRAFTS: { items: TimelineItem[]; relations: Relation[] } = { items: [], relations: [] };
const NO_HIGHLIGHTS: Highlight[] = [];
const NO_PICKS: string[] = [];
const NO_TERRITORIES: Territory[] = [];
const NO_LANES: Lane[] = [];
const NO_IDS: string[] = [];

/** The window that frames an entry with its connected entries, counting only the ones shown. */
function focusTarget(id: string, items: DatedItem[], relations: Relation[], shown: (id: string) => boolean): YearWindow | undefined {
  const item = items.find((i) => i.id === id);
  if (!item || !shown(id)) return undefined;
  const otherIds = new Set(relations.flatMap((r) => (r.fromId === id ? [r.toId] : r.toId === id ? [r.fromId] : [])));
  return focusWindow(item, items.filter((i) => otherIds.has(i.id) && shown(i.id)));
}

export const TimelineView = forwardRef<TimelineControl, Props>(function TimelineView({ items: allItems, categories, relations, selectedId, onSelect, onAddAt, onAddIn, onWindow, onCanGoBack, year, onYear, prominence, drafts: allDrafts = NO_DRAFTS, onMove, highlights = NO_HIGHLIGHTS, picked = NO_PICKS, onPick, territories = NO_TERRITORIES, groups, regions, onFocus, region, onRegion, onOpenRelation, allThreads = false, onOpenThread, lenses = NO_LANES, unfolded = NO_IDS, onUnfold, opened = NO_IDS, onOpen, onRegionMenu, onRegionOrder }, ref) {
  // Only entries with a start date: a place with none is on the map only.
  const items = useMemo(() => allItems.filter(isDated), [allItems]);
  const drafts = useMemo(() => ({ ...allDrafts, items: allDrafts.items.filter(isDated) }), [allDrafts]);
  const host = useRef<HTMLDivElement>(null);
  const tl = useRef<TimelineHandle | null>(null);
  const cb = useRef({ onSelect, onAddAt, onAddIn, onWindow, onYear, onCanGoBack, onMove, onPick, onFocus, onRegion, onOpenRelation, onOpenThread, onUnfold, onOpen, onRegionMenu, onRegionOrder });
  cb.current = { onSelect, onAddAt, onAddIn, onWindow, onYear, onCanGoBack, onMove, onPick, onFocus, onRegion, onOpenRelation, onOpenThread, onUnfold, onOpen, onRegionMenu, onRegionOrder };
  const latest = useRef({ items, relations, categories });
  latest.current = { items, relations, categories };
  const beforeFocus = useRef<YearWindow | null>(null);

  useEffect(() => {
    const t = createTimeline(host.current!, {
      onSelect: (id) => cb.current.onSelect(id),
      onAddAt: (y) => cb.current.onAddAt(y),
      onAddIn: (lane, y, partOf) => cb.current.onAddIn(lane, y, partOf),
      onWindow: (w) => cb.current.onWindow(w),
      onYear: (y) => cb.current.onYear?.(y),
      onMove: (id, dates) => cb.current.onMove?.(id, dates),
      onPick: (ids) => cb.current.onPick?.(ids),
      onFocus: (f) => cb.current.onFocus?.(f),
      onRegion: (r) => cb.current.onRegion?.(r),
      onOpenRelation: (id) => cb.current.onOpenRelation?.(id),
      onOpenThread: (t) => cb.current.onOpenThread?.(t),
      onUnfold: (ids) => cb.current.onUnfold?.(ids),
      onOpen: (keys) => cb.current.onOpen?.(keys),
      // Read when used, so bands stop moving when the doc can't be changed.
      get onRegionHead() { return cb.current.onRegionMenu && ((r: string, a: DOMRect) => cb.current.onRegionMenu?.(r, a)); },
      get onOrderRegions() { return cb.current.onRegionOrder && saveOrder; },
      get onMoveRegion() { return cb.current.onRegionOrder && moveRegion; },
    }, { window: { start: -800, end: 2030 } });
    tl.current = t;
    return () => { t.dispose(); tl.current = null; };
  }, []);

  // The overview and its eras, from the categories shown: Bob's categories are filters, not rows.
  const { eras, overviewData } = useMemo(() => {
    const shown = new Set(categories.map((c) => c.id));
    const now = jsDateToDecimalYear(new Date());
    const its = items.filter((i) => shown.has(i.categoryId));
    return {
      eras: eraRegions(its, highlights, relations, now),
      overviewData: overview({ items: its, territories: territories.filter((t) => shown.has(t.categoryId)), relations, highlights, groups, regions, prominence: prominence ?? (() => 0), now }),
    };
  }, [items, categories, highlights, relations, territories, groups, regions, prominence]);
  // Each entry's lanes, for the lanes that open in place (Claude's drafts by what they are).
  const laneMap = useMemo(() => entryLanes([...items, ...drafts.items], highlights), [items, drafts.items, highlights]);
  // What's in each polity, for the threads between them.
  const byPolity = useMemo(() => polityMembers({ items, territories, relations }), [items, territories, relations]);
  // What opens under a polity or a world event: Claude's drafts too, by their place or their drafted connections.
  const membersOf = useMemo(() => {
    const all = { items: [...items, ...drafts.items], territories, relations: [...relations, ...drafts.relations] };
    const withDrafts = drafts.items.length ? polityMembers(all) : byPolity;
    return (pick: string): string[] => (pick.startsWith('pol:') ? withDrafts.get(pick.slice(4)) ?? [] : worldMembers(pick, all));
  }, [items, drafts, territories, relations, byPolity]);
  // The threads: connections rolled up by polity, else era.
  const threadList = useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    return rollThreads({
      relations,
      polities: byPolity,
      polityItems: new Map(territories.flatMap((t) => (t.itemId ? [[t.itemId, t.id] as const] : []))),
      polityRegions: new Map(territories.map((t) => [t.id, t.region ?? ''])),
      eras: eras.flatMap((r) => r.eras),
      lanesOf: laneMap,
      prominence: prominence ?? (() => 0),
      years: (id) => { const i = byId.get(id); return i && { s: toDecimalYear(i.start), e: toDecimalYear(i.end ?? i.start) }; },
    });
  }, [items, relations, byPolity, territories, eras, laneMap, prominence]);
  // The lenses: each region's entries per lane.
  const lensList = useMemo(() => lensMarks({
    entries: items.map((i) => ({ id: i.id, s: toDecimalYear(i.start) })),
    polities: byPolity,
    polityItems: new Map(territories.flatMap((t) => (t.itemId ? [[t.itemId, t.id] as const] : []))),
    polityRegions: new Map(overviewData.polities.map((p) => [p.id, p.region])),
    eras: eras.flatMap((r) => r.eras),
    lanesOf: laneMap,
  }), [items, byPolity, territories, overviewData, eras, laneMap]);

  // Moving a band saves where every band Bob has moved now sits, so the rest keep ordering themselves.
  const latestO = useRef({ overviewData, regions });
  latestO.current = { overviewData, regions };
  const parentOfIn = (O: typeof overviewData) => (r: string) => O.regions.find((x) => x.name === r)?.parent;
  function saveOrder(order: string[], moved: string[]) {
    const { overviewData: O, regions: rs } = latestO.current;
    const placed = new Map((rs ?? []).flatMap((r) => (r.order !== undefined ? [[r.name, r.order] as const] : [])));
    const parentOf = parentOfIn(O);
    cb.current.onRegionOrder?.(bandOrders(order, O.auto, (r) => placed.get(r), moved, parentOf), moved.length > 1 ? parentOf(moved[0]) ?? moved[0] : moved[0]);
  }
  function moveRegion(region: string, dir: -1 | 1) {
    const O = latestO.current.overviewData;
    const m = moveBand(O.regions.map((r) => r.name), region, dir, parentOfIn(O));
    if (m) saveOrder(m.order, m.moved);
  }
  const regionMoves = (region: string) => {
    const O = latestO.current.overviewData, parentOf = parentOfIn(O), names = O.regions.map((r) => r.name);
    const what = (dir: -1 | 1) => { const m = moveBand(names, region, dir, parentOf); return m && (m.moved.length > 1 ? parentOf(region) ?? region : region); };
    return { up: what(-1), down: what(1) };
  };

  useEffect(() => {
    tl.current?.setData({
      items,
      lanes: categories.map((c) => ({ id: c.id, label: c.label, color: c.color })),
      prominence,
      drafts: drafts.items,
      relations,
      eras,
      overview: overviewData,
      entryLanes: laneMap,
      membersOf,
      threads: threadList,
      lenses: lensList,
    });
  }, [items, categories, prominence, drafts.items, relations, eras, overviewData, laneMap, membersOf, threadList, lensList]);
  useEffect(() => { tl.current?.setAllThreads(allThreads); }, [allThreads]);
  useEffect(() => { tl.current?.setLenses(lenses); }, [lenses]);
  useEffect(() => { tl.current?.setUnfolded(unfolded); }, [unfolded]);
  useEffect(() => { tl.current?.setOpened(opened); }, [opened]);

  // The open entry's connections light up with arrows; Claude's drafted ones show whenever their highlight is open.
  useEffect(() => {
    tl.current?.setLinks(influenceClasses(relations, selectedId), [...influenceArrows(relations, selectedId), ...draftArrows(drafts.relations)]);
  }, [relations, selectedId, drafts.relations]);

  useEffect(() => { tl.current?.setPlayYear(year); }, [year]);
  useEffect(() => { tl.current?.setPicked(picked); }, [picked]);
  useEffect(() => { tl.current?.setRegion(region); }, [region]);

  const focus = (id: string) => {
    const t = tl.current;
    const { items, relations, categories } = latest.current;
    const shownCats = new Set(categories.map((c) => c.id));
    const byId = new Map(items.map((i) => [i.id, i]));
    const target = t && focusTarget(id, items, relations, (x) => shownCats.has(byId.get(x)?.categoryId ?? ''));
    if (!t || !target) return;
    if (!beforeFocus.current) {
      beforeFocus.current = t.getWindow();
      cb.current.onCanGoBack(true);
    }
    t.setWindow(target, true);
  };

  // Opening an entry, from the timeline or anywhere else, opens what it's in and brings it into view,
  // keeping the years in view as wide as they are.
  useEffect(() => { tl.current?.setSelected(selectedId); }, [selectedId]);

  useImperativeHandle(ref, () => ({
    setWindow: (w, animate) => tl.current?.setWindow(w, animate),
    zoomBy: (f) => tl.current?.zoomBy(f),
    panBy: (years) => tl.current?.panBy(years),
    fit: () => tl.current?.fit(),
    focus,
    back: () => {
      if (beforeFocus.current) tl.current?.setWindow(beforeFocus.current, true);
      beforeFocus.current = null;
      cb.current.onCanGoBack(false);
    },
    moveRegion,
    regionMoves,
  }));

  return <div ref={host} className="timeline-host tl-host" data-testid="timeline" tabIndex={0} aria-label="Timeline. Drag or scroll to move through time; Ctrl or ⌘ and scroll, or pinch, to zoom; Ctrl or ⌘ and drag to select several." />;
});
