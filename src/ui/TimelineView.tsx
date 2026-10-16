import moment from 'moment';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { DataSet } from 'vis-data/peer';
import { Timeline, type TimelineOptions } from 'vis-timeline/peer';
import { decimalYearToJsDate, formatAxisYear, formatYear, jsDateToDecimalYear, toJsDate } from '../model/dates';
import type { Category, MediaRef, Relation, TimelineItem } from '../model/types';
import { anchors, arcPath, influenceArrows, influenceClasses } from './influenceLinks';
import { axisLabelEvery, axisStepYears, labelWidthPx, narrowLabels } from './labels';
import { focusWindow, panBy as panWindow, TIME_MAX, TIME_MIN, zoomAround, ZOOM_MAX_YEARS, ZOOM_MIN_YEARS, type YearWindow } from './timeNav';
import { escapeHtml } from './util';

/**
 * Adapter around vis-timeline. This is the ONLY file that imports vis-timeline,
 * so the renderer can be swapped (e.g. for deep time) without touching the rest.
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
  onWindow: (w: VisibleWindow) => void;
  /** Whether there's a window from before the first focus to go back to. */
  onCanGoBack: (can: boolean) => void;
  /** The map's current year as a draggable playhead. Omit when the map is hidden. */
  year?: number;
  onYear?: (year: number) => void;
}

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

type VisDate = moment.Moment;

function yearOf(d: VisDate | Date): number {
  return moment.isMoment(d) ? d.year() : d.getUTCFullYear();
}

/** `every`: label only every n-th tick (see `axisLabelEvery`), so crowded year labels don't run together. */
function minorLabel(date: Date, scale: string, step: number, every = 1): string {
  const d = date as unknown as VisDate;
  switch (scale) {
    case 'year':
      if (every > 1 && yearOf(d) % (step * every) !== 0) return '';
      return step >= 10 ? formatAxisYear(yearOf(d)) : formatYear(yearOf(d));
    case 'month': return d.format('MMM');
    case 'week': case 'day': case 'weekday': return d.format('D');
    default: return d.format('HH:mm');
  }
}

function majorLabel(date: Date, scale: string): string {
  const d = date as unknown as VisDate;
  switch (scale) {
    case 'year': return '';
    case 'month': return formatYear(yearOf(d));
    case 'week': case 'day': case 'weekday': return `${d.format('MMMM')} ${formatYear(yearOf(d))}`;
    default: return `${d.format('D MMM')} ${formatYear(yearOf(d))}`;
  }
}

function itemHtml(item: TimelineItem, thumb?: string): string {
  // onerror hides the picture when it can't load (e.g. offline before it was ever cached).
  const img = thumb ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<span class="it">${img}<span>${escapeHtml(item.title)}</span></span>`;
}

function toVisItem(item: TimelineItem, color: string, thumbFor: Props['thumbFor']) {
  const firstMedia = item.media?.[0];
  const thumb = firstMedia ? thumbFor(firstMedia) : undefined;
  const base = {
    id: item.id,
    group: item.categoryId,
    content: itemHtml(item, thumb),
    title: item.title,
    // Approximate dates get a softer, dashed edge instead of a "c." prefix that eats label space.
    className: `kind-${item.kind}${item.start.approx || item.end?.approx ? ' approx' : ''}`,
    style: `--c: ${color}`,
    start: toJsDate(item.start),
  };
  if (item.kind === 'event') return { ...base, type: 'box' as const };
  // A living person has no end; draw them up to today.
  const end = item.end ? toJsDate(item.end) : new Date();
  return { ...base, end, type: 'range' as const };
}

const PLAYHEAD = 'year';
const yearsToDate = (y: number) => decimalYearToJsDate(y);
/** Wheel events we pass on to vis-timeline ourselves, so our own handler lets them through. */
const forwarded = new WeakSet<Event>();
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** setCustomTimeMarker exists at runtime but is missing from the Timeline class typings. */
type WithMarker = Timeline & { setCustomTimeMarker(title: string, id?: string, editable?: boolean): void };

const SVG = 'http://www.w3.org/2000/svg';

/** Measures label text in the timeline's font (13px), with one shared canvas. */
let measureCtx: CanvasRenderingContext2D | null | undefined;
function measureLabel(text: string): number {
  if (measureCtx === undefined) {
    measureCtx = document.createElement('canvas').getContext('2d');
    if (measureCtx) measureCtx.font = `13px ${getComputedStyle(document.body).fontFamily}`;
  }
  return measureCtx ? measureCtx.measureText(text).width : text.length * 7;
}

/** Resolves once the label font has loaded; until then the canvas measures a fallback font. */
function labelFontLoaded(): Promise<unknown> {
  return document.fonts?.load(`13px ${getComputedStyle(document.body).fontFamily}`) ?? Promise.resolve();
}

/** The overlay that holds influence arrows, inside the timeline's plotting area so it clips and scrolls with it. */
function makeArrowLayer(center: Element): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.classList.add('influence-arrows');
  svg.setAttribute('aria-hidden', 'true');
  const defs = document.createElementNS(SVG, 'defs');
  for (const role of ['infl-by', 'infl-on', 'linked']) {
    const marker = document.createElementNS(SVG, 'marker');
    marker.id = `arrow-${role}`;
    for (const [k, v] of Object.entries({ viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' })) marker.setAttribute(k, v);
    const head = document.createElementNS(SVG, 'path');
    head.setAttribute('d', 'M0 0 L10 5 L0 10 z');
    head.classList.add(role);
    marker.append(head);
    defs.append(marker);
  }
  svg.append(defs);
  center.append(svg);
  return svg;
}

export const TimelineView = forwardRef<TimelineControl, Props>(function TimelineView({ items, categories, relations, selectedId, thumbFor, onSelect, onAddAt, onWindow, onCanGoBack, year, onYear }, ref) {
  const host = useRef<HTMLDivElement>(null);
  // Names are measured again once the font arrives, so long names aren't cut off at the edge.
  const [fontReady, setFontReady] = useState(false);
  useEffect(() => {
    let live = true;
    labelFontLoaded().then(() => live && setFontReady(true), () => {});
    return () => { live = false; };
  }, []);
  const tl = useRef<Timeline | null>(null);
  const itemSet = useRef(new DataSet<ReturnType<typeof toVisItem>>());
  const groupSet = useRef(new DataSet<{ id: string; content: string; style: string }>());
  // Keep latest callbacks without re-creating the timeline.
  const cb = useRef({ onSelect, onAddAt, onWindow, onYear, onCanGoBack });
  cb.current = { onSelect, onAddAt, onWindow, onYear, onCanGoBack };
  /** The window from before the first focus, for "Back to where I was". */
  const beforeFocus = useRef<YearWindow | null>(null);
  const hasPlayhead = useRef(false);
  // Influence highlighting reads the latest values from vis-timeline's redraw events.
  const infl = useRef({ items, relations, selectedId });
  infl.current = { items, relations, selectedId };
  const baseClass = useRef(new Map<string, string>());
  const baseStyle = useRef(new Map<string, string>());
  /** Width of the plotting area, kept for spacing the axis labels. */
  const panelPx = useRef(0);
  /**
   * Handed to vis-timeline once as `timeAxis`; it keeps the reference and reads
   * it on every redraw, so setting `scale` forces a step and clearing it
   * hands the choice back to vis-timeline.
   */
  const axisStep = useRef<{ scale?: 'year'; step?: number }>({});
  /** Ranges (periods, lives) with how wide their names are, to spot bars too narrow for them. */
  const ranges = useRef<Array<{ id: string; start: number; end: number; labelPx: number }>>([]);
  const arrowLayer = useRef<SVGSVGElement | null>(null);

  /** Redraw arrows from current item positions. Items off-screen aren't rendered, so they get no arrow. */
  const drawArrows = () => {
    const svg = arrowLayer.current;
    const center = svg?.parentElement;
    if (!svg || !center) return;
    for (const p of [...svg.querySelectorAll('path.arc')]) p.remove();
    const origin = center.getBoundingClientRect();
    const boxOf = (id: string) => {
      const el = center.querySelector(`.vis-item[data-id="${CSS.escape(id)}"]:not(.vis-line):not(.vis-dot)`);
      if (!el) return undefined;
      const b = el.getBoundingClientRect();
      return { left: b.left - origin.left, right: b.right - origin.left, top: b.top - origin.top, bottom: b.bottom - origin.top };
    };
    for (const { fromId, toId, role } of influenceArrows(infl.current.relations, infl.current.selectedId)) {
      const from = boxOf(fromId);
      const to = boxOf(toId);
      if (!from || !to) continue;
      const { a, b } = anchors(from, to);
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', arcPath(a, b));
      path.setAttribute('marker-end', `url(#arrow-${role})`);
      path.classList.add('arc', role);
      path.dataset.from = fromId;
      path.dataset.to = toId;
      svg.append(path);
    }
  };

  /**
   * Classes that depend on more than the item: names that run past a bar too
   * narrow for them at this zoom, and the selection's influences lit up with
   * the rest dimmed.
   */
  const applyClasses = () => {
    const roles = influenceClasses(infl.current.relations, infl.current.selectedId);
    const t = tl.current;
    const width = host.current?.querySelector('.vis-panel.vis-center')?.clientWidth ?? 0;
    const w = t?.getWindow();
    const narrow = w && width ? narrowLabels(ranges.current, { start: w.start.getTime(), end: w.end.getTime() }, width) : new Map<string, number>();
    const set = itemSet.current;
    const updates = set.getIds().map((key) => {
      const id = key as string;
      const pull = narrow.get(id);
      const extra = `${pull !== undefined ? ' label-out' : ''}${roles ? ` ${roles.get(id) ?? 'dimmed'}` : ''}`;
      // A name near the right edge is pulled left so it isn't cut off.
      const style = `${baseStyle.current.get(id) ?? ''}${pull ? `; --pull: ${pull}px` : ''}`;
      return { id, className: `${baseClass.current.get(id) ?? ''}${extra}`, style };
    });
    if (updates.some((u) => { const cur = set.get(u.id); return cur?.className !== u.className || cur?.style !== u.style; })) set.update(updates);
    drawArrows();
  };

  useEffect(() => {
    if (!host.current) return;
    const options: TimelineOptions = {
      moment: (d: moment.MomentInput) => moment(d).utc(),
      zoomMin: ZOOM_MIN_YEARS * YEAR_MS,
      zoomMax: ZOOM_MAX_YEARS * YEAR_MS,
      min: toJsDate({ y: TIME_MIN }),
      max: toJsDate({ y: TIME_MAX }),
      // The wheel moves through time (see onWheel); vis-timeline zooms only with Ctrl, which is also a trackpad pinch.
      zoomKey: 'ctrlKey',
      stack: true,
      orientation: { axis: 'top', item: 'top' },
      margin: { item: { horizontal: 4, vertical: 6 } },
      showCurrentTime: true,
      selectable: true,
      dataAttributes: ['id'], // lets the influence arrows find each item's element
      xss: { disabled: true }, // every string we inject goes through escapeHtml
      timeAxis: axisStep.current,
      format: {
        minorLabels: (date: Date, scale: string, step: number) => {
          const w = tl.current?.getWindow();
          const years = w ? (w.end.getTime() - w.start.getTime()) / YEAR_MS : 0;
          return minorLabel(date, scale, step, scale === 'year' && years > 0 ? axisLabelEvery(step, panelPx.current / years) : 1);
        },
        majorLabels: majorLabel,
      },
      groupTemplate: (g?: { content: string; style: string } | null) => {
        if (!g) return '';
        const el = document.createElement('div');
        el.className = 'lane-label';
        el.setAttribute('style', g.style);
        const sw = document.createElement('span');
        sw.className = 'swatch';
        const label = document.createElement('span');
        label.textContent = g.content;
        el.append(sw, label);
        return el;
      },
      start: toJsDate({ y: -800 }),
      end: toJsDate({ y: 2030 }),
      height: '100%',
      verticalScroll: true,
    };
    const t = new Timeline(host.current, itemSet.current, groupSet.current, options);
    tl.current = t;
    const center = host.current.querySelector('.vis-panel.vis-center');
    if (center) arrowLayer.current = makeArrowLayer(center);

    const report = () => {
      const w = t.getWindow();
      const center = host.current?.querySelector('.vis-panel.vis-center') as HTMLElement | null;
      const hostBox = host.current?.getBoundingClientRect();
      const box = center?.getBoundingClientRect();
      if (!box || !hostBox) return;
      panelPx.current = box.width;
      const years = (w.end.getTime() - w.start.getTime()) / YEAR_MS;
      const step = years > 0 ? axisStepYears(box.width / years) : undefined;
      if (step) Object.assign(axisStep.current, { scale: 'year', step });
      else { delete axisStep.current.scale; delete axisStep.current.step; }
      cb.current.onWindow({
        start: jsDateToDecimalYear(w.start),
        end: jsDateToDecimalYear(w.end),
        left: box.left - hostBox.left,
        width: box.width,
      });
    };
    t.on('rangechange', report);
    // After each zoom or pan, let names out of bars that got too narrow for them (and back in).
    t.on('rangechanged', applyClasses);
    t.on('changed', report);
    // Fires after every redraw (zoom, pan, scroll), so arrows follow their items.
    t.on('changed', drawArrows);
    t.on('select', (p: { items: string[] }) => cb.current.onSelect(p.items[0]));
    // Drag the playhead, or click empty space, to move the map through time.
    t.on('timechange', (p: { id: string; time: Date }) => {
      if (p.id === PLAYHEAD) cb.current.onYear?.(jsDateToDecimalYear(p.time));
    });
    t.on('click', (p: { item: string | null; time: Date; what: string | null }) => {
      if (hasPlayhead.current && !p.item && p.what === 'background') cb.current.onYear?.(Math.round(jsDateToDecimalYear(p.time)));
    });
    t.on('doubleClick', (p: { item: string | null; time: Date; group: string | null; what: string }) => {
      if (p.item || p.what === 'axis') return;
      cb.current.onAddAt(Math.round(jsDateToDecimalYear(p.time)), p.group ?? undefined);
    });
    window.addEventListener('resize', report);

    /**
     * Plain wheel or trackpad swipe: move through time. Shift: scroll the lanes
     * (vis-timeline's plain wheel). ⌘: zoom (vis-timeline's Ctrl wheel). Ctrl
     * and pinch go straight to vis-timeline.
     */
    const onWheel = (e: WheelEvent) => {
      if (forwarded.has(e) || e.ctrlKey) return;
      const scale = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
      const dx = e.deltaX * scale;
      const dy = e.deltaY * scale;
      if (e.shiftKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        // Browsers turn Shift + wheel sideways; turn it back so vis-timeline scrolls the lanes.
        const d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
        const fwd = new WheelEvent('wheel', { deltaY: d, deltaMode: 0, ctrlKey: e.metaKey, clientX: e.clientX, clientY: e.clientY, bubbles: true, cancelable: true });
        forwarded.add(fwd);
        e.target?.dispatchEvent(fwd);
        return;
      }
      const d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
      if (!d || !panelPx.current) return;
      e.preventDefault();
      e.stopPropagation();
      const w = t.getWindow();
      const span = (w.end.getTime() - w.start.getTime()) / YEAR_MS;
      const next = panWindow({ start: jsDateToDecimalYear(w.start), end: jsDateToDecimalYear(w.end) }, (d / panelPx.current) * span);
      t.setWindow(yearsToDate(next.start), yearsToDate(next.end), { animation: false });
    };
    const hostEl = host.current;
    hostEl.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => {
      hostEl.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('resize', report);
      t.destroy();
      tl.current = null;
      arrowLayer.current = null;
    };
  }, []);

  useEffect(() => {
    const colorOf = new Map(categories.map((c) => [c.id, c.color]));
    groupSet.current.clear();
    groupSet.current.add(categories.map((c) => ({ id: c.id, content: c.label, style: `--c: ${c.color}` })));
    const visItems = items.filter((i) => colorOf.has(i.categoryId)).map((i) => toVisItem(i, colorOf.get(i.categoryId)!, thumbFor));
    baseClass.current = new Map(visItems.map((v) => [v.id, v.className]));
    baseStyle.current = new Map(visItems.map((v) => [v.id, v.style]));
    const visById = new Map(visItems.map((v) => [v.id, v]));
    ranges.current = items.flatMap((i) => {
      const v = visById.get(i.id);
      if (!v || v.type !== 'range') return [];
      return [{ id: i.id, start: v.start.getTime(), end: v.end.getTime(), labelPx: labelWidthPx(i.title, !!i.media?.length && !!thumbFor(i.media[0]), measureLabel) }];
    });
    itemSet.current.clear();
    itemSet.current.add(visItems);
    applyClasses();
    // Rebuilding the items drops vis-timeline's selection; put it back.
    tl.current?.setSelection(infl.current.selectedId ? [infl.current.selectedId] : []);
  }, [items, categories, thumbFor, fontReady]);

  useEffect(() => {
    applyClasses();
  }, [relations]);

  const currentWindow = (): YearWindow | undefined => {
    const w = tl.current?.getWindow();
    return w && { start: jsDateToDecimalYear(w.start), end: jsDateToDecimalYear(w.end) };
  };
  const setWindow = (w: YearWindow, animate = false) => {
    tl.current?.setWindow(yearsToDate(w.start), yearsToDate(w.end), { animation: animate && !reducedMotion() ? { duration: 400, easingFunction: 'easeInOutQuad' } : false });
  };
  /** Frame an entry and its connections; the first focus remembers where Bob was. */
  const focus = (id: string) => {
    const { items, relations } = infl.current;
    const item = items.find((i) => i.id === id);
    const now = currentWindow();
    if (!item || !now || !itemSet.current.get(id)) return;
    const otherIds = new Set(relations.flatMap((r) => (r.fromId === id ? [r.toId] : r.toId === id ? [r.fromId] : [])));
    const target = focusWindow(item, items.filter((i) => otherIds.has(i.id) && itemSet.current.get(i.id)));
    if (!beforeFocus.current) {
      beforeFocus.current = now;
      cb.current.onCanGoBack(true);
    }
    setWindow(target, true);
  };

  useImperativeHandle(ref, () => ({
    setWindow,
    zoomBy: (factor) => { const w = currentWindow(); if (w) setWindow(zoomAround(w, factor), true); },
    panBy: (years) => { const w = currentWindow(); if (w) setWindow(panWindow(w, years)); },
    fit: () => { if (tl.current && itemSet.current.length) tl.current.fit({ animation: !reducedMotion() }); },
    focus,
    back: () => {
      if (beforeFocus.current) setWindow(beforeFocus.current, true);
      beforeFocus.current = null;
      cb.current.onCanGoBack(false);
    },
  }));

  useEffect(() => {
    applyClasses();
    tl.current?.setSelection(selectedId ? [selectedId] : []);
    // Opening an entry, from the timeline or a link, zooms to its time with its connections in view.
    if (selectedId) focus(selectedId);
  }, [selectedId]);

  useEffect(() => {
    const t = tl.current;
    if (!t) return;
    if (year === undefined) {
      if (hasPlayhead.current) t.removeCustomTime(PLAYHEAD);
      hasPlayhead.current = false;
      return;
    }
    const at = decimalYearToJsDate(year);
    if (!hasPlayhead.current) {
      t.addCustomTime(at, PLAYHEAD);
      hasPlayhead.current = true;
    } else {
      t.setCustomTime(at, PLAYHEAD);
    }
    (t as WithMarker).setCustomTimeMarker(formatYear(Math.floor(year)), PLAYHEAD, false);
  }, [year]);

  return <div ref={host} className="timeline-host" data-testid="timeline" />;
});
