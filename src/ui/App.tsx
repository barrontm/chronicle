import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { docYearRange, presenceAt } from '../model/atYear';
import { toDecimalYear } from '../model/dates';
import { mergeDocs, parseDoc, serializeDoc } from '../model/doc';
import type { MediaRef, TimelineDoc } from '../model/types';
import type { Area } from '../data/geo';
import type { DocStore } from '../store/store';
import { DocProvider, useDoc } from './DocContext';
import type { Nav, Panel } from './nav';
import { ItemEditor, ItemView } from './panels/ItemPanels';
import { Help } from './panels/Help';
import { Library } from './panels/Library';
import { WikiImport } from './panels/WikiImport';
import { pendingWithPlaces, type DraftSet } from '../ai/draft';
import { NoteEditor, NoteView } from './panels/NotePanels';
import { SeriesEditor } from './panels/SeriesEditor';
import { SourceEditor, SourceView } from './panels/SourcePanels';
import { MapPane, YearBar, type FlowOptions, type MapCamera, type MapOptions } from './MapPane';
import { FlowEditor, FlowView } from './panels/FlowPanels';
import { applyUpdate, useUpdateReady } from './updates';
import { TerritoryEditor, TerritoryImport, TerritoryView } from './panels/TerritoryPanels';
import { TimeBar } from './TimeBar';
import { TimelineView, type TimelineControl, type VisibleWindow } from './TimelineView';
import { TrendStrips } from './TrendStrips';
import { ReaderPane, type ArticleRef } from './reader/ReaderPane';
import { downloadText } from './util';
import { useStored } from './useStored';

export function App({ store }: { store: DocStore }) {
  return (
    <DocProvider store={store}>
      {(ready) => (ready ? <Workspace /> : <div className="empty-state" role="status">Opening your timeline…</div>)}
    </DocProvider>
  );
}

type View = 'timeline' | 'map' | 'split';

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

// The Anthropic SDK is only downloaded when Bob opens Draft with AI.
const DraftReview = lazy(() => import('./panels/DraftReview').then((m) => ({ default: m.DraftReview })));

const SAVE_LABEL = { loading: 'Opening…', saving: 'Saving…', saved: 'Saved on this device', error: 'Couldn’t save. Export a backup now.' } as const;

function Workspace() {
  const { doc, update, replace, saveState, mediaUrl, readOnly, flush } = useDoc();
  const updateReady = useUpdateReady();
  const [stack, setStack] = useState<Panel[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [win, setWin] = useState<VisibleWindow | null>(null);
  const timeline = useRef<TimelineControl>(null);
  const [canGoBackInTime, setCanGoBackInTime] = useState(false);
  const [menu, setMenu] = useState<'add' | 'file' | null>(null);
  const [pendingImport, setPendingImport] = useState<TimelineDoc | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // An AI draft waiting for review: kept here so the map can show it while the panel is open.
  const [aiDraft, setAiDraft] = useState<DraftSet | null>(null);
  const draftItems = useMemo(() => pendingWithPlaces(aiDraft).filter((i) => !doc.items.some((x) => x.id === i.id)), [aiDraft, doc.items]);

  // ----- Map and the shared current year -----
  const narrow = useMedia('(max-width: 860px)');
  const [view, setView] = useStored<View>('chronicle.view', () => 'timeline');
  // "Try the new layout": the reader beside the map over the timeline; on a phone, the map is a sheet over the reader.
  const [next, setNext] = useStored<boolean>('chronicle.uiNext', () => false);
  const [trail, setTrail] = useStored<{ pages: ArticleRef[]; at: number }>('chronicle.trail', () => ({ pages: [], at: -1 }));
  const article = trail.pages[trail.at] ?? null;
  const [searching, setSearching] = useState(false);
  const [mapSheet, setMapSheet] = useState(false);
  const openArticle = (a: ArticleRef) => {
    setSearching(false);
    const pages = [...trail.pages.slice(0, trail.at + 1).filter((p) => p.key !== a.key), a];
    setTrail({ pages, at: pages.length - 1 });
  };
  const shownView: View = next ? 'split' : narrow && view === 'split' ? 'map' : view;
  const showMap = shownView !== 'timeline';
  const range = useMemo<[number, number]>(() => {
    const r = docYearRange(doc);
    if (!r) return [-3000, 2030];
    const pad = Math.max(10, Math.round((r[1] - r[0]) * 0.03));
    return [r[0] - pad, r[1] + pad];
  }, [doc]);
  const [year, setYearState] = useState<number>(() => {
    try {
      const y = Number(localStorage.getItem('chronicle.year'));
      if (localStorage.getItem('chronicle.year') !== null && Number.isFinite(y)) return y;
    } catch { /* ignore */ }
    return Math.round((range[0] + range[1]) / 2);
  });
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useStored<number>('chronicle.speed', () => 25);
  const [mapOptions, setMapOptions] = useStored<MapOptions>('chronicle.mapOptions', () => ({ backdrop: false, keepPast: false, connections: false }));
  const [mapCamera, setMapCamera] = useStored<MapCamera>('chronicle.mapView', () => ({ center: [20, 35], zoom: 1.6 }));
  const [dataSeriesId, setDataSeriesId] = useStored<string | null>('chronicle.mapData', () => null);
  const setYear = useCallback((y: number) => setYearState(y), []);
  const [drawing, setDrawing] = useState<{ onDone: (g: Area, year: number) => void } | null>(null);
  const [picking, setPicking] = useState<{ onDone: (p: [number, number]) => void } | null>(null);
  const [flowOptions, setFlowOptions] = useStored<FlowOptions>('chronicle.mapFlows', () => ({ show: true, hiddenCauses: [] }));

  // Remember the year between visits, but not on every animation frame.
  useEffect(() => {
    if (playing) return;
    const t = setTimeout(() => { try { localStorage.setItem('chronicle.year', String(Math.round(year))); } catch { /* ignore */ } }, 300);
    return () => clearTimeout(t);
  }, [year, playing]);

  // Play: advance `speed` years per second until the end of the range.
  const yearRef = useRef(year);
  yearRef.current = year;
  useEffect(() => {
    if (!playing) return;
    if (yearRef.current >= range[1]) setYearState(range[0]);
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const next = yearRef.current + (speed * (now - last)) / 1000;
      last = now;
      if (next >= range[1]) {
        setYearState(range[1]);
        setPlaying(false);
        return;
      }
      setYearState(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, range]);

  // Events linger for a while after they happen; longer when playing fast so they can be seen.
  const fadeYears = Math.max(10, speed * 2);

  // Bring the map into view for a panel action: a split on the laptop, the sheet on a phone in the new layout.
  const revealMap = () => {
    if (next) { if (narrow) setMapSheet(true); }
    else if (view === 'timeline') setView(narrow ? 'map' : 'split');
  };

  const panel = stack.at(-1);
  const nav: Nav = useMemo(() => ({
    open: (p) => setStack((s) => [...s, p]),
    replace: (p) => setStack((s) => [...s.slice(0, -1), p]),
    back: () => setStack((s) => s.slice(0, -1)),
    close: () => setStack([]),
    canGoBack: stack.length > 1,
    showTime: (id) => {
      if (next) { if (narrow) setMapSheet(true); } else if (view === 'map') setView('timeline');
      timeline.current?.focus(id);
    },
    showOnMap: (y) => {
      setPlaying(false);
      setYearState(y);
      revealMap();
    },
    draw: (onDone) => {
      setPlaying(false);
      setPicking(null);
      setDrawing({ onDone });
      revealMap();
    },
    pick: (onDone) => {
      setDrawing(null);
      setPicking({ onDone });
      revealMap();
    },
  }), [stack.length, view, narrow, setView, next]);

  const categories = useMemo(() => doc.categories.filter((c) => !hidden.has(c.id)), [doc.categories, hidden]);
  const thumbFor = useCallback((m: MediaRef) => mediaUrl(m, true), [mediaUrl]);
  const selectedId = panel?.type === 'item' ? panel.id : undefined;

  const selectFromTimeline = (id: string | undefined) => {
    if (!id) {
      setStack((s) => (s.at(-1)?.type === 'item' ? [] : s));
      return;
    }
    setStack([{ type: 'item', id }]);
    // With the map open, jump to the entry's year if it isn't on the map right now.
    const item = doc.items.find((i) => i.id === id);
    if (showMap && item && !playing && presenceAt(item, year, fadeYears, mapOptions.keepPast) === 0) setYearState(toDecimalYear(item.start));
  };

  // Escape closes menus first, then the drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      if (drawing) setDrawing(null);
      else if (picking) setPicking(null);
      else if (menu) setMenu(null);
      else if (stack.length) setStack([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, stack.length, drawing, picking]);

  const startNew = (p: Panel) => { setMenu(null); setStack([p]); };

  const onImportFile = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    try {
      const incoming = parseDoc(await file.text());
      if (doc.items.length + doc.notes.length + doc.sources.length + doc.series.length + doc.territories.length + doc.flows.length === 0) replace(incoming);
      else setPendingImport(incoming);
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const isEmpty = doc.items.length === 0;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Chronicle</span>
        <input
          className="doc-title"
          aria-label="Timeline name"
          value={doc.title}
          onChange={(e) => update((d) => ({ ...d, title: e.target.value, updatedAt: Date.now() }))}
        />
        <span className="save-state" role="status" data-testid="save-state">{readOnly ? 'Read-only' : SAVE_LABEL[saveState]}</span>
        <span className="spacer" />
        {next && trail.pages.length > 0 && (
          <nav className="trail" aria-label="Reading trail">
            {trail.pages.map((p, i) => (
              <button key={p.key} className="trail-step" aria-current={i === trail.at ? 'page' : undefined} onClick={() => { setSearching(false); setTrail({ ...trail, at: i }); }}>{p.title}</button>
            ))}
          </nav>
        )}
        {next ? (
          <button className="btn primary" onClick={() => { setMenu(null); setMapSheet(false); setSearching(true); }}>Open an article</button>
        ) : (<>
        <div className="segmented view-switch" role="group" aria-label="View">
          <button aria-pressed={shownView === 'timeline'} onClick={() => setView('timeline')}>Timeline</button>
          <button aria-pressed={shownView === 'map'} onClick={() => setView('map')}>Map</button>
          {!narrow && <button aria-pressed={shownView === 'split'} onClick={() => setView('split')}>Both</button>}
        </div>
        <div className="menu">
          <button className="btn primary" aria-expanded={menu === 'add'} onClick={() => setMenu(menu === 'add' ? null : 'add')}>Add</button>
          {menu === 'add' && (
            <div className="menu-pop" role="menu">
              <button role="menuitem" onClick={() => startNew({ type: 'new-item', kind: 'event' })}>Event</button>
              <button role="menuitem" onClick={() => startNew({ type: 'new-item', kind: 'span' })}>Period, war or movement</button>
              <button role="menuitem" onClick={() => startNew({ type: 'new-item', kind: 'person' })}>Person</button>
              <button role="menuitem" onClick={() => startNew({ type: 'wiki-import' })}>From Wikipedia…</button>
              <button role="menuitem" onClick={() => startNew({ type: 'ai-draft' })}>Draft with AI…</button>
              <hr />
              <button role="menuitem" onClick={() => startNew({ type: 'new-note', linkedIds: [] })}>Note</button>
              <button role="menuitem" onClick={() => startNew({ type: 'new-source' })}>Source</button>
              <button role="menuitem" onClick={() => startNew({ type: 'series', id: null })}>Trend over time</button>
              <button role="menuitem" onClick={() => startNew({ type: 'territory-import', year: Math.round(year) })}>Territory on the map…</button>
              <button role="menuitem" onClick={() => startNew({ type: 'new-flow' })}>Migration on the map…</button>
            </div>
          )}
        </div>
        </>)}
        <button className="btn" onClick={() => { setMenu(null); setStack([{ type: 'library', tab: 'notes' }]); }}>Library</button>
        <button className="btn quiet" onClick={() => { setMenu(null); setStack([{ type: 'help' }]); }}>Help</button>
        <div className="menu">
          <button className="btn quiet" aria-expanded={menu === 'file'} onClick={() => setMenu(menu === 'file' ? null : 'file')}>More</button>
          {menu === 'file' && (
            <div className="menu-pop" role="menu">
              <button role="menuitem" onClick={() => { setMenu(null); timeline.current?.fit(); }}>Show everything</button>
              <button role="menuitemcheckbox" aria-checked={next} onClick={() => { setMenu(null); setMapSheet(false); setNext(!next); }}>Try the new layout</button>
              <hr />
              <button role="menuitem" onClick={() => {
                setMenu(null);
                downloadText(`chronicle-${new Date().toISOString().slice(0, 10)}.json`, serializeDoc(doc));
              }}>Export a backup</button>
              <button role="menuitem" onClick={() => { setMenu(null); fileInput.current?.click(); }}>Import a file…</button>
            </div>
          )}
        </div>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden data-testid="import-input" onChange={(e) => void onImportFile(e.target.files?.[0])} />
      </header>

      <div className={`workspace ${next ? 'next' : ''} ${panel ? 'with-drawer' : ''}`}>
        {next && !(narrow && mapSheet) && (
          <ReaderPane article={article} searching={searching} onOpen={openArticle} onSearching={setSearching} onBack={trail.at > 0 ? () => setTrail({ ...trail, at: trail.at - 1 }) : undefined} onShowMap={narrow ? () => setMapSheet(true) : undefined} onOpenRecord={(r) => nav.open(r.type === 'item' ? { type: 'item', id: r.id } : { type: 'territory', id: r.id })} onDraft={(draft) => nav.open({ type: 'new-item', draft })} />
        )}
        {(!next || !narrow || mapSheet) && (
        <main className={`stage view-${shownView} ${next && narrow ? 'sheet' : ''}`}>
          {next && narrow && (
            <div className="sheet-head">
              <button className="btn small" onClick={() => setMapSheet(false)}>Back to reading</button>
            </div>
          )}
          <div className="lanebar" role="group" aria-label="Show or hide categories">
            {doc.categories.map((c) => (
              <button
                key={c.id}
                className="chip"
                aria-pressed={!hidden.has(c.id)}
                style={{ '--c': c.color } as React.CSSProperties}
                onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}
              >
                <span className="swatch" />{c.label}
              </button>
            ))}
          </div>
          {readOnly && <div className="notice bad" role="alert" data-testid="read-only" style={{ margin: '0 16px 8px' }}>{readOnly}</div>}
          {updateReady && (
            <div className="notice update-ready" role="status" data-testid="update-ready" style={{ margin: '0 16px 8px' }}>
              <span>A new version of Chronicle is ready. Your work is saved first.</span>
              <button className="btn small primary" onClick={() => void flush().then(applyUpdate)}>Reload</button>
            </div>
          )}
          {importError && <div className="notice bad" role="alert" style={{ margin: '0 16px 8px' }}>{importError}</div>}
          {showMap && (
            <>
              <MapPane
                year={year}
                items={doc.items}
                territories={doc.territories}
                categories={categories}
                relations={doc.relations}
                series={doc.series}
                flows={doc.flows}
                draftItems={draftItems}
                flowOptions={flowOptions}
                onFlowOptions={setFlowOptions}
                dataSeriesId={dataSeriesId}
                onDataSeries={setDataSeriesId}
                options={mapOptions}
                onOptions={setMapOptions}
                fadeYears={fadeYears}
                selectedId={selectedId}
                onOpenItem={(id) => setStack([{ type: 'item', id }])}
                onOpenTerritory={(id) => setStack([{ type: 'territory', id }])}
                onOpenFlow={(id) => setStack([{ type: 'flow', id }])}
                onAddTerritory={() => startNew({ type: 'territory-import', year: Math.round(year) })}
                camera={mapCamera}
                onCamera={setMapCamera}
                drawing={drawing ? { onDone: (g) => { drawing.onDone(g, Math.round(year)); setDrawing(null); }, onCancel: () => setDrawing(null) } : undefined}
                picking={picking ? { onDone: (pt) => { picking.onDone(pt); setPicking(null); }, onCancel: () => setPicking(null) } : undefined}
              />
              <YearBar year={year} range={range} onYear={(y) => { setPlaying(false); setYear(y); }} playing={playing} onPlaying={setPlaying} speed={speed} onSpeed={setSpeed} />
            </>
          )}
          <div className="timeline-pane" hidden={shownView === 'map'}>
          {isEmpty && next && (
            <p className="empty-strip" data-testid="empty-state">Your map and timeline fill in as you add what you read.</p>
          )}
          {isEmpty && !next && (
            <div className="empty-state" data-testid="empty-state">
              <h2>Start with what you’re reading about</h2>
              <p>Add an event, a period or a person. Double-click anywhere on the timeline to add something at that date.</p>
              <div className="actions" style={{ justifyContent: 'center' }}>
                <button className="btn primary" onClick={() => startNew({ type: 'new-item', kind: 'event' })}>Add an event</button>
                <button className="btn" onClick={() => startNew({ type: 'new-item', kind: 'person' })}>Add a person</button>
                <button className="btn" onClick={() => startNew({ type: 'new-item', kind: 'span' })}>Add a period</button>
                <button className="btn" onClick={() => startNew({ type: 'wiki-import' })}>Add from Wikipedia</button>
              </div>
            </div>
          )}
          {canGoBackInTime && <button className="btn small focus-chip" onClick={() => timeline.current?.back()}>Back to where I was</button>}
          <TimelineView
            ref={timeline}
            items={doc.items}
            relations={doc.relations}
            categories={categories}
            selectedId={selectedId}
            thumbFor={thumbFor}
            onSelect={selectFromTimeline}
            onAddAt={(year, categoryId) => setStack([{ type: 'new-item', year, categoryId }])}
            onWindow={setWin}
            onCanGoBack={setCanGoBackInTime}
            year={showMap ? year : undefined}
            onYear={(y) => { setPlaying(false); setYear(y); }}
          />
          {win && <TimeBar win={win} control={timeline} />}
          <TrendStrips
            series={doc.series}
            categories={categories}
            window={win}
            onOpen={(id) => setStack([{ type: 'series', id }])}
            onAdd={() => setStack([{ type: 'series', id: null }])}
          />
          </div>
        </main>
        )}

        {panel && (
          // On a phone the drawer covers the map, so step aside while drawing or picking a place (it stays mounted, keeping the form).
          <aside className="drawer" aria-label="Details" hidden={!!(drawing || picking) && narrow}>
            <div className="drawer-head">
              {nav.canGoBack && <button className="btn small quiet" onClick={nav.back}>Back</button>}
              <span className="spacer" />
              <button className="btn small quiet" onClick={nav.close} aria-label="Close panel">Close</button>
            </div>
            <PanelBody panel={panel} nav={nav} aiDraft={aiDraft} onAiDraft={setAiDraft} />
          </aside>
        )}
      </div>

      {pendingImport && (
        <ImportChoice
          incoming={pendingImport}
          onCancel={() => setPendingImport(null)}
          onMerge={() => { update((d) => mergeDocs(d, pendingImport)); setPendingImport(null); }}
          onReplace={() => { replace(pendingImport); setPendingImport(null); setStack([]); }}
        />
      )}
    </div>
  );
}

function PanelBody({ panel, nav, aiDraft, onAiDraft }: { panel: Panel; nav: Nav; aiDraft: DraftSet | null; onAiDraft: (d: DraftSet | null) => void }) {
  // `key` resets editor state when switching between records.
  switch (panel.type) {
    case 'item': return panel.edit ? <ItemEditor key={`e-${panel.id}`} id={panel.id} nav={nav} /> : <ItemView key={panel.id} id={panel.id} nav={nav} />;
    case 'new-item': return <ItemEditor key={`new-${panel.draft?.item.id ?? `${panel.year}-${panel.kind}-${panel.categoryId}`}`} id={null} init={panel} draft={panel.draft} nav={nav} />;
    case 'wiki-import': return <WikiImport nav={nav} />;
    case 'ai-draft': return <Suspense fallback={<div className="notice" role="status">Opening…</div>}><DraftReview nav={nav} draft={aiDraft} onDraft={onAiDraft} /></Suspense>;
    case 'note': return panel.edit ? <NoteEditor key={`e-${panel.id}`} id={panel.id} nav={nav} /> : <NoteView key={panel.id} id={panel.id} nav={nav} />;
    case 'new-note': return <NoteEditor key="new-note" id={null} linkedIds={panel.linkedIds} nav={nav} />;
    case 'source': return panel.edit ? <SourceEditor key={`e-${panel.id}`} id={panel.id} nav={nav} /> : <SourceView key={panel.id} id={panel.id} nav={nav} />;
    case 'new-source': return <SourceEditor key="new-source" id={null} nav={nav} />;
    case 'series': return <SeriesEditor key={panel.id ?? 'new-series'} id={panel.id} nav={nav} />;
    case 'territory': return panel.edit ? <TerritoryEditor key={`e-${panel.id}`} id={panel.id} nav={nav} /> : <TerritoryView key={panel.id} id={panel.id} nav={nav} />;
    case 'flow': return panel.edit ? <FlowEditor key={`e-${panel.id}`} id={panel.id} nav={nav} /> : <FlowView key={panel.id} id={panel.id} nav={nav} />;
    case 'new-flow': return <FlowEditor key={`new-flow-${panel.itemId ?? ''}`} id={null} itemId={panel.itemId} nav={nav} />;
    case 'territory-import': return <TerritoryImport key={`ti-${panel.year}`} year={panel.year} nav={nav} />;
    case 'help': return <Help key={panel.section ?? 'help'} section={panel.section} />;
    case 'library': return <Library tab={panel.tab} nav={nav} />;
  }
}

function ImportChoice({ incoming, onMerge, onReplace, onCancel }: { incoming: TimelineDoc; onMerge: () => void; onReplace: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} onClose={onCancel} aria-labelledby="import-title" data-testid="import-choice">
      <h2 id="import-title">Import “{incoming.title}”</h2>
      <p>
        The file has {incoming.items.length} entries, {incoming.notes.length} notes and {incoming.sources.length} sources.
        Merging keeps the newest version of everything, which is how you bring changes over from another device.
      </p>
      <div className="actions">
        <button className="btn primary" onClick={onMerge}>Merge into my timeline</button>
        <button className="btn danger" onClick={() => { if (confirm('Replace your whole timeline with this file? Export a backup first if unsure.')) onReplace(); }}>Replace my timeline</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </dialog>
  );
}
