import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { undoFor, type Undo } from '../model/bulk';
import { ensureRegion, hasRegionOrder, mergeRegions, regionNamed, renameRegion, setRegionOrders, setRegionOutline, setRegionParent } from '../model/doc';
import { allRegions } from '../model/subjects';
import type { TimelineDoc } from '../model/types';
import { useDoc } from './DocContext';
import { outlineInWords, RegionWhere } from './RegionWhere';

/**
 * A region's menu, right where Bob clicked its name on the timeline: Rename, Part of…, Merge
 * into…, Where on the map…, Move up, Move down, Show on the map, Open in Library, and Back to
 * automatic order. Each change has one Undo in the bar under the timeline.
 */
export function RegionMenu({ region, anchor, moves, onMove, onLibrary, onShow, onDraw, onDone, onClose }: {
  region: string;
  /** The band's name on screen. */
  anchor: DOMRect;
  /** What moves up or down (the region, or its larger area), or nothing at an end. */
  moves: { up?: string; down?: string };
  onMove: (dir: -1 | 1) => void;
  onLibrary: () => void;
  /** Focus the region on the map: its outline edged and fitted. */
  onShow: () => void;
  /** Draw the region's outline on the map. */
  onDraw: () => void;
  onDone: (undo: Undo, msg: string) => void;
  onClose: () => void;
}) {
  const { doc, update, readOnly } = useDoc();
  const [mode, setMode] = useState<'menu' | 'rename' | 'parent' | 'merge' | 'where'>('menu');
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 4 });
  const others = [...new Set([...(doc.regions ?? []).map((r) => r.name), ...allRegions(doc)])].filter((r) => r !== region).sort((a, b) => a.localeCompare(b));
  const parents = [...new Set((doc.regions ?? []).flatMap((r) => (r.parent?.trim() ? [r.parent.trim()] : [])))].sort((a, b) => a.localeCompare(b));
  const parent = regionNamed(doc, region)?.parent ?? '';
  const outline = regionNamed(doc, region)?.outline;
  const [name, setName] = useState(region);
  const [into, setInto] = useState('');
  const [area, setArea] = useState(parent);
  const off = !!readOnly;

  // Kept on screen: below the name, else above it; never past the right edge.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - w - 8));
    const top = anchor.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, anchor.top - 4 - h) : anchor.bottom + 4;
    setPos({ left, top });
  }, [anchor, mode]);
  // Focus goes into the menu, and back to the band's name when it closes.
  useEffect(() => {
    if (mode === 'menu') box.current?.querySelector<HTMLElement>('[role=menuitem]:not([disabled])')?.focus();
  }, [mode]);
  const close = () => {
    onClose();
    document.querySelector<HTMLElement>(`.tl-band-name[data-region="${CSS.escape(region)}"]`)?.focus({ preventScroll: true });
  };
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [onClose]);

  /** One change to the region, with one Undo. */
  const change = (fn: (d: TimelineDoc, id: string, now: number) => TimelineDoc, msg: string) => {
    const now = Date.now();
    const run = (d: TimelineDoc) => { const e = ensureRegion(d, region, now); return fn(e.doc, e.region.id, now); };
    onDone(undoFor(doc, run(doc)), msg);
    update(run);
    close();
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (mode === 'menu') close(); else setMode('menu'); return; }
    if (mode !== 'menu' || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    const items = [...(box.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };
  const n = name.trim();

  return (
    <div ref={box} className="region-menu menu-pop" role={mode === 'menu' ? 'menu' : 'dialog'} aria-label={region} data-testid="region-menu" style={{ left: pos.left, top: pos.top }} onKeyDown={keys}>
      {mode === 'menu' && (
        <>
          <div className="region-menu-title" aria-hidden="true">{region}{parent ? <small> · {parent}</small> : null}</div>
          <button role="menuitem" disabled={off} onClick={() => { setName(region); setMode('rename'); }}>Rename</button>
          <button role="menuitem" disabled={off} onClick={() => { setArea(parent); setMode('parent'); }}>Part of…</button>
          <button role="menuitem" disabled={off || !others.length} onClick={() => { setInto(''); setMode('merge'); }}>Merge into…</button>
          <button role="menuitem" disabled={off} onClick={() => setMode('where')}>Where on the map…</button>
          <hr />
          <button role="menuitem" disabled={off || !moves.up} onClick={() => { onMove(-1); close(); }}>{moves.up && moves.up !== region ? `Move ${moves.up} up` : 'Move up'}</button>
          <button role="menuitem" disabled={off || !moves.down} onClick={() => { onMove(1); close(); }}>{moves.down && moves.down !== region ? `Move ${moves.down} down` : 'Move down'}</button>
          {hasRegionOrder(doc) && (
            <button role="menuitem" disabled={off} onClick={() => change((d, _id, now) => setRegionOrders(d, new Map(), now), 'Bands back in the automatic order.')}>Back to automatic order</button>
          )}
          <hr />
          <button role="menuitem" onClick={() => { close(); onShow(); }}>Show on the map</button>
          <button role="menuitem" onClick={() => { onClose(); onLibrary(); }}>Open in Library</button>
        </>
      )}
      {mode === 'rename' && (
        <form className="region-menu-form" aria-label={`Rename ${region}`} onSubmit={(e) => {
          e.preventDefault();
          if (!n || n === region) return;
          change((d, id, now) => renameRegion(d, id, n, now), others.includes(n) ? `Merged ${region} into ${n}.` : `Renamed ${region} to ${n}.`);
        }}>
          <label htmlFor="region-menu-name">New name for {region}</label>
          <input id="region-menu-name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
          {others.includes(n) && <small className="hint">{n} is already a region: {region} merges into it.</small>}
          <div className="actions">
            <button className="btn small primary" disabled={!n || n === region}>{others.includes(n) ? 'Merge' : 'Rename'}</button>
            <button type="button" className="btn small" onClick={() => setMode('menu')}>Cancel</button>
          </div>
        </form>
      )}
      {mode === 'parent' && (
        <form className="region-menu-form" aria-label={`${region} is part of`} onSubmit={(e) => {
          e.preventDefault();
          const p = area.trim();
          if (p === parent) { setMode('menu'); return; }
          change((d) => setRegionParent(d, region, p || undefined), p ? `${region} is now part of ${p}.` : `${region} is no longer part of ${parent}.`);
        }}>
          <label htmlFor="region-menu-parent">{region} is part of</label>
          <input id="region-menu-parent" value={area} autoFocus list="region-menu-parents" placeholder="A larger area, such as Mediterranean" onChange={(e) => setArea(e.target.value)} />
          <datalist id="region-menu-parents">{parents.map((p) => <option key={p} value={p} />)}</datalist>
          <small className="hint">Its neighbours in the same larger area sit together under that name. Leave it empty for none.</small>
          <div className="actions">
            <button className="btn small primary">Save</button>
            <button type="button" className="btn small" onClick={() => setMode('menu')}>Cancel</button>
          </div>
        </form>
      )}
      {mode === 'where' && (
        <div className="region-menu-form">
          <strong>Where {region} is on the map</strong>
          {outlineInWords(outline, doc.territories) && <small className="hint">Now: {outlineInWords(outline, doc.territories)}.</small>}
          <RegionWhere
            region={region}
            outline={outline}
            territories={doc.territories}
            disabled={off}
            onSave={(o) => change((d) => setRegionOutline(d, region, o), o ? `${region} is now where you picked on the map.` : `${region} is where its territories are again.`)}
            onDraw={() => { onClose(); onDraw(); }}
            onCancel={() => setMode('menu')}
          />
        </div>
      )}
      {mode === 'merge' && (
        <form className="region-menu-form" aria-label={`Merge ${region}`} onSubmit={(e) => {
          e.preventDefault();
          if (!into) return;
          change((d, id, now) => { const e2 = ensureRegion(d, into, now); return mergeRegions(e2.doc, id, e2.region.id, now); }, `Merged ${region} into ${into}.`);
        }}>
          <label htmlFor="region-menu-into">Merge {region} into</label>
          <select id="region-menu-into" value={into} autoFocus onChange={(e) => setInto(e.target.value)}>
            <option value="">Pick a region…</option>
            {others.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <small className="hint">Everything in {region} moves there, and {region} goes.</small>
          <div className="actions">
            <button className="btn small primary" disabled={!into}>Merge</button>
            <button type="button" className="btn small" onClick={() => setMode('menu')}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
