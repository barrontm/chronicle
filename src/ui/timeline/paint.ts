import { REPRESENTATIONS } from '../representations';
import { ARC_ROLES, FONTS, OLDSTYLE, SPACING, type Box, type Prim, type Scene } from './scene';

/**
 * The SVG painter. Every primitive has a stable key, so each frame updates the same elements
 * (only attributes that changed are touched); elements no longer drawn go back to a pool.
 * Colors go in `style`, so CSS variables and color-mix() follow the theme by themselves.
 *
 * The timeline spike measured SVG at 60 fps on a throttled phone with 2,000 entries. If Bob's
 * iPhone shows otherwise, the hybrid (canvas marks, DOM labels) replaces this file only.
 */
export interface Painter {
  el: SVGSVGElement;
  resize(w: number, h: number): void;
  draw(scene: Scene): void;
  dispose(): void;
}

const NS = 'http://www.w3.org/2000/svg';
const TAGS = ['rect', 'circle', 'text', 'line', 'image', 'path', 'use', 'path'] as const;
type Tag = (typeof TAGS)[number];

interface Rec { el: SVGElement; tag: Tag; gen: number; last: Map<string, string | number>; text?: string }

let uid = 0;

export function svgPainter(): Painter {
  const id = `tl${++uid}`;
  const svg = document.createElementNS(NS, 'svg');
  svg.classList.add('tl-svg');
  svg.setAttribute('aria-hidden', 'true');
  const defs = document.createElementNS(NS, 'defs');
  const clip = (name: string) => {
    const cp = document.createElementNS(NS, 'clipPath');
    cp.id = `${id}-${name}`;
    const r = document.createElementNS(NS, 'rect');
    cp.append(r);
    defs.append(cp);
    return r;
  };
  const plotClip = clip('plot'), gutterClip = clip('gutter'), rightClip = clip('right');
  // One arrowhead per kind of arrow; its color comes from CSS (`.tl-head.<role>`), so it follows the theme.
  for (const role of ARC_ROLES) {
    const m = document.createElementNS(NS, 'marker');
    m.id = `${id}-head-${role}`;
    for (const [k, v] of Object.entries({ viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' })) m.setAttribute(k, v);
    const head = document.createElementNS(NS, 'path');
    head.setAttribute('d', 'M0 0 L10 5 L0 10 z');
    head.setAttribute('class', `tl-head ${role}`);
    m.append(head);
    defs.append(m);
  }
  // Each kind's glyph once, as a symbol the marks <use>: the same markup the tray draws.
  for (const [kind, rep] of Object.entries(REPRESENTATIONS)) {
    const sym = document.createElementNS(NS, 'symbol');
    sym.id = `${id}-g-${kind}`;
    sym.setAttribute('viewBox', '0 0 18 18');
    sym.setAttribute('overflow', 'visible');
    sym.innerHTML = rep.glyph;
    defs.append(sym);
  }
  // Level 1's key moments, in the lane's pigment (`color`), with a ring of the panel's colour so overlapping ones stay apart.
  const diamonds = {
    diamond: '<path d="M9 1.5 16.5 9 9 16.5 1.5 9Z" fill="currentColor" stroke="var(--panel)" stroke-width="1.5"/>',
    'diamond-approx': '<path d="M9 2.5 15.5 9 9 15.5 2.5 9Z" fill="var(--panel)" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.2 1.6"/>',
  };
  for (const [name, markup] of Object.entries(diamonds)) {
    const sym = document.createElementNS(NS, 'symbol');
    sym.id = `${id}-g-${name}`;
    sym.setAttribute('viewBox', '0 0 18 18');
    sym.innerHTML = markup;
    defs.append(sym);
  }
  // World events' gold leaf: lighter at the top, with an ink edge drawn by the mark.
  const gilt = document.createElementNS(NS, 'linearGradient');
  gilt.id = `${id}-gilt`;
  for (const [k, v] of Object.entries({ x1: '0', y1: '0', x2: '0', y2: '1' })) gilt.setAttribute(k, v);
  for (const [offset, color] of [['0', 'var(--gold-2)'], ['0.55', 'var(--gold)'], ['1', 'var(--gold)']]) {
    const stop = document.createElementNS(NS, 'stop');
    stop.setAttribute('offset', offset);
    stop.style.setProperty('stop-color', color);
    gilt.append(stop);
  }
  defs.append(gilt);
  const fillOf = (f: string | undefined) => (f === 'gilt' ? `url(#${id}-gilt)` : f);
  const group = (clipName: string) => {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('clip-path', `url(#${id}-${clipName})`);
    return g;
  };
  const plot = group('plot');
  const z = [0, 1, 2, 3].map(() => { const g = document.createElementNS(NS, 'g'); plot.append(g); return g; });
  const gutter = group('gutter');
  const axis = group('right');
  svg.append(defs, plot, gutter, axis);

  const live = new Map<string, Rec>();
  const pool = new Map<Tag, SVGElement[]>();
  let gen = 0;

  const set = (r: Rec, name: string, v: string | number | undefined) => {
    if (r.last.get(name) === v) return;
    if (v === undefined) r.el.removeAttribute(name);
    else r.el.setAttribute(name, String(v));
    r.last.set(name, v as string | number);
  };
  const style = (r: Rec, name: string, v: string | undefined) => {
    const key = `style:${name}`;
    if (r.last.get(key) === v) return;
    if (v === undefined) r.el.style.removeProperty(name);
    else r.el.style.setProperty(name, v);
    r.last.set(key, v as string);
  };
  const tagOf = (p: Prim): Tag => TAGS[p.t];
  /** The element painted just before in the current layer: each layer keeps the scene's order. */
  let prev: Element | null = null;

  const paint = (p: Prim, parent: SVGGElement, layer: string) => {
    const key = `${layer}${p.t}${p.k}`;
    let r = live.get(key);
    if (!r) {
      const tag = tagOf(p);
      const el = pool.get(tag)?.pop() ?? document.createElementNS(NS, tag);
      r = { el, tag, gen, last: new Map() };
      live.set(key, r);
    }
    // Each layer is drawn in the scene's order (arrows under the header row that scrolls over them,
    // for one); an element only moves when it's out of place.
    const want = prev ? prev.nextSibling : parent.firstChild;
    if (r.el !== want) parent.insertBefore(r.el, want);
    prev = r.el;
    r.gen = gen;
    set(r, 'opacity', p.a === 1 ? undefined : p.a);
    set(r, 'class', p.cls);
    set(r, 'data-id', p.id);
    switch (p.t) {
      case 0:
        set(r, 'x', p.x); set(r, 'y', p.y); set(r, 'width', Math.max(0, p.w)); set(r, 'height', Math.max(0, p.h));
        set(r, 'rx', p.r);
        style(r, 'fill', fillOf(p.fill) ?? 'none');
        style(r, 'stroke', p.stroke ?? 'none');
        set(r, 'stroke-width', p.stroke ? p.sw ?? 1 : undefined);
        set(r, 'stroke-dasharray', p.stroke && p.dash ? '4 3' : undefined);
        break;
      case 1:
        set(r, 'cx', p.x); set(r, 'cy', p.y); set(r, 'r', p.r);
        style(r, 'fill', fillOf(p.fill) ?? 'none');
        style(r, 'stroke', p.stroke ?? 'none');
        set(r, 'stroke-width', p.stroke ? p.sw ?? 1 : undefined);
        set(r, 'stroke-dasharray', p.stroke && p.dash ? '2 2' : undefined);
        break;
      case 2:
        set(r, 'x', p.x); set(r, 'y', p.y);
        set(r, 'text-anchor', p.anchor);
        style(r, 'fill', p.fill);
        style(r, 'font', FONTS[p.f]);
        style(r, 'letter-spacing', SPACING[p.f] ? `${SPACING[p.f]}px` : undefined);
        style(r, 'font-variant-numeric', OLDSTYLE.has(p.f) ? 'oldstyle-nums' : undefined);
        if (r.text !== p.s) { r.el.textContent = p.s; r.text = p.s; }
        break;
      case 3:
        set(r, 'x1', p.x1); set(r, 'y1', p.y1); set(r, 'x2', p.x2); set(r, 'y2', p.y2);
        style(r, 'stroke', p.stroke);
        set(r, 'stroke-width', p.sw ?? 1);
        set(r, 'stroke-dasharray', p.dash ? '4 3' : undefined);
        break;
      case 4:
        set(r, 'x', p.x); set(r, 'y', p.y); set(r, 'width', p.w); set(r, 'height', p.h);
        set(r, 'href', p.href);
        set(r, 'preserveAspectRatio', 'xMidYMid slice');
        break;
      case 5:
        set(r, 'd', p.d);
        style(r, 'fill', 'none');
        style(r, 'stroke', p.stroke);
        set(r, 'stroke-width', p.sw ?? 1.5);
        set(r, 'stroke-linecap', 'round');
        set(r, 'stroke-dasharray', p.dash ? '5 4' : undefined);
        set(r, 'marker-end', p.head ? `url(#${id}-head-${p.head})` : undefined);
        set(r, 'data-from', p.from);
        set(r, 'data-to', p.to);
        break;
      case 6:
        set(r, 'x', p.x); set(r, 'y', p.y); set(r, 'width', p.w); set(r, 'height', p.w);
        set(r, 'href', `#${id}-g-${p.g}`);
        style(r, 'color', p.color);
        break;
      case 7:
        set(r, 'd', p.d);
        style(r, 'fill', fillOf(p.fill));
        style(r, 'stroke', p.stroke ?? 'none');
        set(r, 'stroke-width', p.stroke ? p.sw ?? 1 : undefined);
        set(r, 'stroke-dasharray', p.stroke && p.dash ? '2 3' : undefined);
        break;
    }
  };

  const fitClip = (r: SVGRectElement, b: Box) => {
    r.setAttribute('x', String(b.x)); r.setAttribute('y', String(b.y));
    r.setAttribute('width', String(Math.max(0, b.w))); r.setAttribute('height', String(Math.max(0, b.h)));
  };

  return {
    el: svg,
    resize(w, h) {
      svg.setAttribute('width', String(w));
      svg.setAttribute('height', String(h));
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    },
    draw(scene) {
      gen++;
      fitClip(plotClip, scene.plot);
      fitClip(gutterClip, scene.gutterBox);
      fitClip(rightClip, { x: scene.plot.x, y: 0, w: scene.plot.w, h: scene.plot.y + scene.plot.h });
      for (let i = 0; i < z.length; i++) { prev = null; for (const p of scene.z[i]) paint(p, z[i], `z${i}`); }
      prev = null;
      for (const p of scene.gutter) paint(p, gutter, 'g');
      prev = null;
      for (const p of scene.axis) paint(p, axis, 'a');
      // What wasn't drawn this frame goes back to the pool, stripped, for reuse.
      for (const [k, r] of live) {
        if (r.gen === gen) continue;
        live.delete(k);
        r.el.remove();
        for (const a of Array.from(r.el.attributes)) r.el.removeAttribute(a.name);
        if (r.tag === 'text') r.el.textContent = '';
        let list = pool.get(r.tag);
        if (!list) pool.set(r.tag, (list = []));
        list.push(r.el);
      }
    },
    dispose() { svg.remove(); },
  };
}
