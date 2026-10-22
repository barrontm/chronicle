import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { isDated, jsDateToDecimalYear, toDecimalYear } from '../model/dates';
import { eraRegions } from '../model/eras';
import { entryLanes } from '../model/lanes';
import { overview } from '../model/overview';
import { polityMembers, worldMembers } from '../model/polities';
import { threads as rollThreads } from '../model/threads';
import type { Category, DatedItem, Highlight, Lane, MediaRef, PolityGroup, Relation, Territory, TimelineItem } from '../model/types';
import { draftArrows, influenceArrows, influenceClasses } from './influenceLinks';
import { createTimeline, type MovedDates, type OverviewFocus, type TimelineHandle } from './timeline/createTimeline';
import type { Level } from './timeline/layout';
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
  /** The zoom level: 0 the overview, 1 an era's or polity's six lanes, 2 the entries. */
  level?: Level;
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
  /** Show the overview (level 0, fitted to it) or the entries (level 2). */
  setLevel?: (level: 0 | 2) => void;
}

interface Props {
  items: TimelineItem[];
  categories: Category[];
  /** Connections; the selected item's "influenced" ones light up with arrows. */
  relations: Relation[];
  selectedId?: string;
  thumbFor: (m: MediaRef) => string | undefined;
  onSelect: (id: string | undefined) => void;
  onAddAt: (year: number, categoryId?: string) => void;
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
  /** Bob's highlights, counted into the eras at level 0. */
  highlights?: Highlight[];
  /** Entries box-selected for bulk edit (Ctrl or ⌘ and drag or click), and the new selection when Bob changes it. */
  picked?: string[];
  onPick?: (ids: string[]) => void;
  /** Level 0, the overview: polities (territories), their groups, and each region's parent. */
  territories?: Territory[];
  groups?: PolityGroup[];
  regionParents?: Record<string, string>;
  /** What the overview has picked or open, for the map to follow. */
  onFocus?: (f: OverviewFocus) => void;
  /** The region Bob clicked on the map: the overview grows its rows. Esc lets go (`onRegion(undefined)`). */
  region?: string;
  onRegion?: (region: string | undefined) => void;
  /** Level 0: "Show all threads", and a ribbon clicked (its connections, and the two rows it joins). */
  allThreads?: boolean;
  onOpenThread?: (t: { ids: string[]; title: string }) => void;
}

export type { OverviewFocus };

const NO_DRAFTS: { items: TimelineItem[]; relations: Relation[] } = { items: [], relations: [] };
const NO_HIGHLIGHTS: Highlight[] = [];
const NO_PICKS: string[] = [];
const NO_TERRITORIES: Territory[] = [];

/** The window that frames an entry with its connected entries, counting only the ones shown. */
function focusTarget(id: string, items: DatedItem[], relations: Relation[], shown: (id: string) => boolean): YearWindow | undefined {
  const item = items.find((i) => i.id === id);
  if (!item || !shown(id)) return undefined;
  const otherIds = new Set(relations.flatMap((r) => (r.fromId === id ? [r.toId] : r.toId === id ? [r.fromId] : [])));
  return focusWindow(item, items.filter((i) => otherIds.has(i.id) && shown(i.id)));
}

export const TimelineView = forwardRef<TimelineControl, Props>(function TimelineView({ items: allItems, categories, relations, selectedId, thumbFor, onSelect, onAddAt, onAddIn, onWindow, onCanGoBack, year, onYear, prominence, drafts: allDrafts = NO_DRAFTS, onMove, highlights = NO_HIGHLIGHTS, picked = NO_PICKS, onPick, territories = NO_TERRITORIES, groups, regionParents, onFocus, region, onRegion, onOpenRelation, allThreads = false, onOpenThread }, ref) {
  // Only entries with a start date: a place with none is on the map only.
  const items = useMemo(() => allItems.filter(isDated), [allItems]);
  const drafts = useMemo(() => ({ ...allDrafts, items: allDrafts.items.filter(isDated) }), [allDrafts]);
  const host = useRef<HTMLDivElement>(null);
  const tl = useRef<TimelineHandle | null>(null);
  const cb = useRef({ onSelect, onAddAt, onAddIn, onWindow, onYear, onCanGoBack, onMove, onPick, onFocus, onRegion, onOpenRelation, onOpenThread });
  cb.current = { onSelect, onAddAt, onAddIn, onWindow, onYear, onCanGoBack, onMove, onPick, onFocus, onRegion, onOpenRelation, onOpenThread };
  const latest = useRef({ items, relations, categories });
  latest.current = { items, relations, categories };
  const beforeFocus = useRef<YearWindow | null>(null);

  useEffect(() => {
    const t = createTimeline(host.current!, {
      onSelect: (id) => cb.current.onSelect(id),
      onAddAt: (y, lane) => cb.current.onAddAt(y, lane),
      onAddIn: (lane, y, partOf) => cb.current.onAddIn(lane, y, partOf),
      onWindow: (w) => cb.current.onWindow(w),
      onYear: (y) => cb.current.onYear?.(y),
      onMove: (id, dates) => cb.current.onMove?.(id, dates),
      onPick: (ids) => cb.current.onPick?.(ids),
      onFocus: (f) => cb.current.onFocus?.(f),
      onRegion: (r) => cb.current.onRegion?.(r),
      onOpenRelation: (id) => cb.current.onOpenRelation?.(id),
      onOpenThread: (t) => cb.current.onOpenThread?.(t),
    }, { window: { start: -800, end: 2030 }, level: 2 });
    tl.current = t;
    return () => { t.dispose(); tl.current = null; };
  }, []);

  // Level 0, the overview, and its eras, from the categories shown: Bob's categories are filters here, not rows.
  const { eras, overviewData } = useMemo(() => {
    const shown = new Set(categories.map((c) => c.id));
    const now = jsDateToDecimalYear(new Date());
    const its = items.filter((i) => shown.has(i.categoryId));
    return {
      eras: eraRegions(its, highlights, relations, now),
      overviewData: overview({ items: its, territories: territories.filter((t) => shown.has(t.categoryId)), relations, highlights, groups, regionParents, prominence: prominence ?? (() => 0), now }),
    };
  }, [items, categories, highlights, relations, territories, groups, regionParents, prominence]);
  // Level 1's lanes: each entry's lanes.
  const laneMap = useMemo(() => entryLanes(items, highlights), [items, highlights]);
  // What's in each polity, for opening one and for the threads between them.
  const byPolity = useMemo(() => polityMembers({ items, territories, relations }), [items, territories, relations]);
  const membersOf = useMemo(() => (pick: string): string[] => (pick.startsWith('pol:') ? byPolity.get(pick.slice(4)) ?? [] : worldMembers(pick, { relations })), [byPolity, relations]);
  // Level 0's threads: connections rolled up by polity, else era.
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

  useEffect(() => {
    tl.current?.setData({
      items,
      lanes: categories.map((c) => ({ id: c.id, label: c.label, color: c.color })),
      prominence,
      thumbFor: (i) => (i.media?.[0] ? thumbFor(i.media[0]) : undefined),
      drafts: drafts.items,
      relations,
      eras,
      overview: overviewData,
      entryLanes: laneMap,
      membersOf,
      threads: threadList,
    });
  }, [items, categories, thumbFor, prominence, drafts.items, relations, eras, overviewData, laneMap, membersOf, threadList]);
  useEffect(() => { tl.current?.setAllThreads(allThreads); }, [allThreads]);

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

  useEffect(() => {
    tl.current?.setSelected(selectedId);
    // Opening an entry, from the timeline or a link, zooms to its time with its connections in view
    // (inside an open era it's already in view, on the era's time scale).
    if (selectedId && !tl.current?.inEra(selectedId)) focus(selectedId);
  }, [selectedId]);

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
    setLevel: (l) => {
      tl.current?.setLevel(l);
      if (l === 0) tl.current?.fit();
    },
  }));

  return <div ref={host} className="timeline-host tl-host" data-testid="timeline" tabIndex={0} aria-label="Timeline. Drag or scroll to move through time; Ctrl or ⌘ and scroll, or pinch, to zoom; Ctrl or ⌘ and drag to select several." />;
});
