import moment from 'moment';
import { useEffect, useRef } from 'react';
import { DataSet } from 'vis-data/peer';
import { Timeline, type TimelineOptions } from 'vis-timeline/peer';
import { formatAxisYear, formatYear, jsDateToDecimalYear, toJsDate } from '../model/dates';
import type { Category, MediaRef, TimelineItem } from '../model/types';
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

interface Props {
  items: TimelineItem[];
  categories: Category[];
  selectedId?: string;
  thumbFor: (m: MediaRef) => string | undefined;
  onSelect: (id: string | undefined) => void;
  onAddAt: (year: number, categoryId?: string) => void;
  onWindow: (w: VisibleWindow) => void;
  /** Bumped by the parent to request "fit everything in view". */
  fitSignal: number;
}

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

type VisDate = moment.Moment;

function yearOf(d: VisDate | Date): number {
  return moment.isMoment(d) ? d.year() : d.getUTCFullYear();
}

function minorLabel(date: Date, scale: string, step: number): string {
  const d = date as unknown as VisDate;
  switch (scale) {
    case 'year': return step >= 10 ? formatAxisYear(yearOf(d)) : formatYear(yearOf(d));
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

export function TimelineView({ items, categories, selectedId, thumbFor, onSelect, onAddAt, onWindow, fitSignal }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const tl = useRef<Timeline | null>(null);
  const itemSet = useRef(new DataSet<ReturnType<typeof toVisItem>>());
  const groupSet = useRef(new DataSet<{ id: string; content: string; style: string }>());
  // Keep latest callbacks without re-creating the timeline.
  const cb = useRef({ onSelect, onAddAt, onWindow });
  cb.current = { onSelect, onAddAt, onWindow };

  useEffect(() => {
    if (!host.current) return;
    const options: TimelineOptions = {
      moment: (d: moment.MomentInput) => moment(d).utc(),
      zoomMin: 7 * 24 * 3600 * 1000,
      zoomMax: 12_000 * YEAR_MS,
      min: toJsDate({ y: -12_000 }),
      max: toJsDate({ y: 2200 }),
      stack: true,
      orientation: { axis: 'top', item: 'top' },
      margin: { item: { horizontal: 4, vertical: 6 } },
      showCurrentTime: true,
      selectable: true,
      xss: { disabled: true }, // every string we inject goes through escapeHtml
      format: { minorLabels: minorLabel, majorLabels: majorLabel },
      groupTemplate: (g: { content: string; style: string }) => {
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

    const report = () => {
      const w = t.getWindow();
      const center = host.current?.querySelector('.vis-panel.vis-center') as HTMLElement | null;
      const hostBox = host.current?.getBoundingClientRect();
      const box = center?.getBoundingClientRect();
      if (!box || !hostBox) return;
      cb.current.onWindow({
        start: jsDateToDecimalYear(w.start),
        end: jsDateToDecimalYear(w.end),
        left: box.left - hostBox.left,
        width: box.width,
      });
    };
    t.on('rangechange', report);
    t.on('changed', report);
    t.on('select', (p: { items: string[] }) => cb.current.onSelect(p.items[0]));
    t.on('doubleClick', (p: { item: string | null; time: Date; group: string | null; what: string }) => {
      if (p.item || p.what === 'axis') return;
      cb.current.onAddAt(Math.round(jsDateToDecimalYear(p.time)), p.group ?? undefined);
    });
    window.addEventListener('resize', report);
    return () => {
      window.removeEventListener('resize', report);
      t.destroy();
      tl.current = null;
    };
  }, []);

  useEffect(() => {
    const colorOf = new Map(categories.map((c) => [c.id, c.color]));
    groupSet.current.clear();
    groupSet.current.add(categories.map((c) => ({ id: c.id, content: c.label, style: `--c: ${c.color}` })));
    itemSet.current.clear();
    itemSet.current.add(items.filter((i) => colorOf.has(i.categoryId)).map((i) => toVisItem(i, colorOf.get(i.categoryId)!, thumbFor)));
  }, [items, categories, thumbFor]);

  useEffect(() => {
    tl.current?.setSelection(selectedId ? [selectedId] : []);
    if (selectedId && itemSet.current.get(selectedId)) {
      // Bring the item into view without changing zoom if it's off-screen.
      const it = itemSet.current.get(selectedId)!;
      const w = tl.current!.getWindow();
      const s = it.start as Date;
      if (s < w.start || s > w.end) tl.current?.moveTo(s, { animation: false });
    }
  }, [selectedId]);

  useEffect(() => {
    if (fitSignal && tl.current && itemSet.current.length) tl.current.fit({ animation: false });
  }, [fitSignal]);

  return <div ref={host} className="timeline-host" data-testid="timeline" />;
}
