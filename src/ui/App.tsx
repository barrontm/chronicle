import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { docYearRange, presenceAt } from '../model/atYear';
import { formatRange, toDecimalYear } from '../model/dates';
import { applyUndo, bulkRemove, type Undo } from '../model/bulk';
import { mergeDocs, parseDoc, serializeDoc, upsert } from '../model/doc';
import { highlightProminence } from '../model/prominence';
import type { HistDate, MediaRef, TimelineDoc, TimelineItem } from '../model/types';
import type { Area } from '../data/geo';
import type { DocStore } from '../store/store';
import { DocProvider, useDoc } from './DocContext';
import type { Nav, Panel } from './nav';
import { ItemEditor, ItemView } from './panels/ItemPanels';
import { Help } from './panels/Help';
import { Library } from './panels/Library';
import { BulkEdit } from './panels/BulkEdit';
import { WikiImport } from './panels/WikiImport';
import { pendingOnTimeline, pendingWithPlaces, type DraftSet } from '../ai/draft';
import { NoteEditor, NoteView } from './panels/NotePanels';
import { SeriesEditor } from './panels/SeriesEditor';
import { SourceEditor, SourceView } from './panels/SourcePanels';
import { MapPane, YearBar, type FlowOptions, type MapCamera, type MapFit, type MapOptions } from './MapPane';
import { FlowEditor, FlowView } from './panels/FlowPanels';
import { applyUpdate, useUpdateReady } from './updates';
import { TerritoryEditor, TerritoryImport, TerritoryView } from './panels/TerritoryPanels';
import { TimeBar } from './TimeBar';
import { TimelineView, type TimelineControl, type VisibleWindow } from './TimelineView';
import { TrendStrips } from './TrendStrips';
import { ReaderPane, type ArticleRef } from './reader/ReaderPane';
import { HighlightDraftsContext, useHighlightDraftStore } from './reader/highlightDrafts';
import { downloadText } from './util';
import { useStored } from './useStored';
import { Splitter } from './Splitter';
import { Search } from './Search';
import type { SearchHit } from '../model/search';

export function App({ store }: { store: DocStore }) {
  return (
    <DocProvider store={store}>
      {(ready) => (ready ? <Workspace /> : <div className="empty-state" role="status">Opening your timeline…</div>)}
    </DocProvider>
  );
}

type View = 'timeline' | 'map' | 'split';

/** The least room the map keeps beside the reader, and the least height the map and the timeline each keep (px). */
const STAGE_MIN = 360;
const PANE_MIN = 160;

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

// A doc saved by a newer version opens read-only and unparsed, so it may lack fields this version expects.
const NO_HIGHLIGHTS: TimelineDoc['highlights'] = [];
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
  // Claude's drafts from highlights; the map shows the open highlight's.
  const highlightDrafts = useHighlightDraftStore(doc.highlights ?? NO_HIGHLIGHTS);
  const shownDraft = highlightDrafts.shown ? highlightDrafts.sets[highlightDrafts.shown] : null;
  const { ghosts } = highlightDrafts;
  const draftItems = useMemo(() => {
    const drafted = [...pendingWithPlaces(aiDraft), ...pendingWithPlaces(shownDraft)].filter((i) => !doc.items.some((x) => x.id === i.id));
    // What the open highlight could become, where each was: a ghost pin until Bob adds it.
    const candidates: TimelineItem[] = ghosts
      .filter((g) => !doc.items.some((i) => i.wikidataId === g.qid))
      .map((g) => ({ id: `ghost-${g.qid}`, kind: 'event', title: g.title, start: { y: 0 }, categoryId: '', places: [{ lat: g.lat, lon: g.lon }], updatedAt: 0 }));
    return [...drafted, ...candidates];
  }, [aiDraft, shownDraft, doc.items, ghosts]);
  const timelineDrafts = useMemo(() => pendingOnTimeline(doc, [aiDraft, shownDraft]), [doc, aiDraft, shownDraft]);
  // The last entry Bob dragged to new dates, so he can take it back.
  const [moved, setMoved] = useState<{ before: TimelineItem; title: string; when: string } | null>(null);
  useEffect(() => {
    if (!moved) return;
    const t = setTimeout(() => setMoved(null), 8000);
    return () => clearTimeout(t);
  }, [moved]);
  const moveItem = (id: string, dates: { start: HistDate; end?: HistDate }) => {
    const before = doc.items.find((i) => i.id === id);
    if (!before) return;
    update((d) => upsert(d, 'items', { ...before, start: dates.start, ...(dates.end ? { end: dates.end } : {}) }));
    // Several quick moves (Alt + arrow) undo back to where it was before the first.
    setMoved((m) => ({ before: m?.before.id === id ? m.before : before, title: before.title, when: formatRange(dates.start, dates.end) }));
  };
  const undoMove = () => {
    if (!moved) return;
    const back = moved.before;
    update((d) => upsert(d, 'items', back));
    setMoved(null);
  };

  // Entries box-selected on the timeline (Ctrl or ⌘ and drag), for editing or deleting them together.
  const [picked, setPicked] = useState<string[]>([]);
  const pickedNow = useMemo(() => picked.filter((id) => doc.items.some((i) => i.id === id)), [picked, doc.items]);
  // The last bulk edit or delete, so Bob can take it back in one step.
  const [bulkDone, setBulkDone] = useState<{ undo: Undo; msg: string } | null>(null);
  useEffect(() => {
    if (!bulkDone) return;
    const t = setTimeout(() => setBulkDone(null), 10000);
    return () => clearTimeout(t);
  }, [bulkDone]);
  const deletePicked = () => {
    const n = pickedNow.length;
    if (!n || !confirm(`Delete ${n} ${n === 1 ? 'entry' : 'entries'}? Their connections are removed; notes about them are kept.`)) return;
    const now = Date.now();
    const { undo } = bulkRemove(doc, pickedNow, now);
    update((d) => bulkRemove(d, pickedNow, now).doc);
    setStack((s) => s.filter((p) => !(p.type === 'item' && pickedNow.includes(p.id)) && p.type !== 'bulk-edit'));
    setPicked([]);
    setBulkDone({ undo, msg: `Deleted ${n} ${n === 1 ? 'entry' : 'entries'}.` });
  };
  const undoBulk = () => {
    if (!bulkDone) return;
    const { undo } = bulkDone;
    update((d) => applyUndo(d, undo));
    setBulkDone(null);
  };

  // ----- Map and the shared current year -----
  const narrow = useMedia('(max-width: 860px)');
  const [view, setView] = useStored<View>('chronicle.view', () => 'timeline');
  // The layout: the reader beside the map over the timeline (on a phone, the map is a sheet over the reader),
  // unless Bob chose "Use the classic layout". A new key, so everyone starts on the reader layout, including whoever had tried it under "Try the new layout".
  const [classic, setClassic] = useStored<boolean>('chronicle.classicLayout', () => false);
  const next = !classic;
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
  // Bob's pane sizes in the reader layout on a laptop, per device: the reader's width and the map's height (null = the default).
  const [readerWidth, setReaderWidth] = useStored<number | null>('chronicle.readerWidth', () => null);
  const [mapHeight, setMapHeight] = useStored<number | null>('chronicle.mapHeight', () => null);
  const workspaceEl = useRef<HTMLDivElement>(null);
  const stageEl = useRef<HTMLElement>(null);
  const resizable = next && !narrow;
  const readerEl = () => workspaceEl.current?.querySelector<HTMLElement>('.reader') ?? null;
  const mapEl = () => stageEl.current?.querySelector<HTMLElement>('.map-pane') ?? null;
  const readerLimits = (): [number, number] => {
    // The reader keeps about 28em of text; the map keeps room to be a map.
    const min = 28 * parseFloat(getComputedStyle(readerEl() ?? document.body).fontSize);
    const ws = workspaceEl.current?.clientWidth ?? 0;
    const drawer = workspaceEl.current?.querySelector<HTMLElement>('.drawer')?.offsetWidth ?? 0;
    return [min, ws - drawer - STAGE_MIN];
  };
  const mapLimits = (): [number, number] => {
    // The map and the timeline each keep about 160 px.
    const map = mapEl()?.offsetHeight ?? 0;
    const tl = stageEl.current?.querySelector<HTMLElement>('.timeline-host')?.offsetHeight ?? 0;
    return [PANE_MIN, map + tl - PANE_MIN];
  };
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

  // Bring the map into view for a panel action: a split on the laptop, the sheet on a phone in the reader layout.
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
      if (y !== undefined) setYearState(y);
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

  // A search result: open it, and bring the timeline, the year and the map to it.
  const [mapFit, setMapFit] = useState<MapFit | undefined>();
  const pickResult = (hit: SearchHit) => {
    setMenu(null);
    if (hit.type === 'note' || hit.type === 'source') { setStack([{ type: hit.type, id: hit.id }]); return; }
    // A highlight opens the entry it's on, if any; otherwise the highlights in the Library.
    let h: Pick<SearchHit, 'id' | 'year' | 'bounds'> & { type: 'item' | 'territory' };
    if (hit.type === 'highlight') {
      const on = doc.highlights.find((x) => x.id === hit.id)?.usedBy.map((id) => doc.items.find((i) => i.id === id)).find((i) => i !== undefined);
      if (!on) { setStack([{ type: 'library', tab: 'highlights' }]); return; }
      const place = on.places?.[0];
      h = { type: 'item', id: on.id, year: on.start ? toDecimalYear(on.start) : undefined, bounds: place ? [place.lon, place.lat, place.lon, place.lat] : undefined };
    } else h = { ...hit, type: hit.type };
    setStack([{ type: h.type, id: h.id }]);
    setPlaying(false);
    if (h.year !== undefined) setYearState(h.year);
    if (h.bounds) setMapFit({ bounds: h.bounds, at: Date.now() });
    if (h.type === 'item') nav.showTime(h.id);
    else revealMap();
  };
  const categories = useMemo(() => doc.categories.filter((c) => !hidden.has(c.id)), [doc.categories, hidden]);
  const prominence = useMemo(() => highlightProminence(doc.highlights ?? []), [doc.highlights]);
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
    if (showMap && item?.start && !playing && presenceAt(item, year, fadeYears, mapOptions.keepPast) === 0) setYearState(toDecimalYear(item.start));
  };

  // Escape closes menus first, then the drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      if (drawing) setDrawing(null);
      else if (picking) setPicking(null);
      else if (menu) setMenu(null);
      else if (stack.length) setStack([]);
      else if (picked.length) setPicked([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, stack.length, drawing, picking, picked.length]);

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
    <HighlightDraftsContext.Provider value={highlightDrafts}>
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
        <Search narrow={narrow} onPick={pickResult} />
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
              <button role="menuitemcheckbox" aria-checked={classic} onClick={() => { setMenu(null); setMapSheet(false); setClassic(!classic); }}>Use the classic layout</button>
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

      <div
        ref={workspaceEl}
        className={`workspace ${next ? 'next' : ''} ${panel ? 'with-drawer' : ''} ${resizable && readerWidth !== null ? 'sized' : ''}`}
        style={resizable && readerWidth !== null ? { '--reader-w': `${readerWidth}px` } as React.CSSProperties : undefined}
      >
        {next && !(narrow && mapSheet) && (
          <ReaderPane article={article} searching={searching} onOpen={openArticle} onSearching={setSearching} onBack={trail.at > 0 ? () => setTrail({ ...trail, at: trail.at - 1 }) : undefined} onShowMap={narrow ? () => setMapSheet(true) : undefined} onOpenRecord={(r) => nav.open(r.type === 'item' ? { type: 'item', id: r.id } : { type: 'territory', id: r.id })} onDraft={(draft) => nav.open({ type: 'new-item', draft })} onShowYear={setYear} onOpenDrafting={() => nav.open({ type: 'ai-draft' })} onDraw={nav.draw} />
        )}
        {resizable && (
          <Splitter
            between="columns"
            label="Resize the reader"
            testId="reader-splitter"
            measure={() => readerEl()?.offsetWidth ?? 0}
            limits={readerLimits}
            apply={(px) => { const ws = workspaceEl.current; if (ws) { ws.classList.add('sized'); ws.style.setProperty('--reader-w', `${px}px`); } }}
            commit={setReaderWidth}
          />
        )}
        {(!next || !narrow || mapSheet) && (
        <main
          ref={stageEl}
          className={`stage view-${shownView} ${next && narrow ? 'sheet' : ''} ${resizable && mapHeight !== null ? 'sized' : ''}`}
          style={resizable && mapHeight !== null ? { '--map-h': `${mapHeight}px` } as React.CSSProperties : undefined}
        >
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
                fitTo={mapFit}
                onCamera={setMapCamera}
                drawing={drawing ? { onDone: (g) => { drawing.onDone(g, Math.round(year)); setDrawing(null); }, onCancel: () => setDrawing(null) } : undefined}
                picking={picking ? { onDone: (pt) => { picking.onDone(pt); setPicking(null); }, onCancel: () => setPicking(null) } : undefined}
              />
              <YearBar year={year} range={range} onYear={(y) => { setPlaying(false); setYear(y); }} playing={playing} onPlaying={setPlaying} speed={speed} onSpeed={setSpeed} />
              {resizable && (
                <Splitter
                  between="rows"
                  label="Resize the map and the timeline"
                  testId="map-splitter"
                  measure={() => mapEl()?.offsetHeight ?? 0}
                  limits={mapLimits}
                  apply={(px) => { const st = stageEl.current; if (st) { st.classList.add('sized'); st.style.setProperty('--map-h', `${px}px`); } }}
                  commit={setMapHeight}
                />
              )}
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
            prominence={prominence}
            drafts={timelineDrafts}
            onMove={readOnly ? undefined : moveItem}
            highlights={doc.highlights}
            picked={pickedNow}
            onPick={setPicked}
          />
          {(pickedNow.length > 0 || bulkDone) && (
            // One bar under the timeline: what's selected, and what the last bulk change did, with Undo.
            <div className="notice moved-note pick-bar" role="region" aria-label="Selected entries" data-testid="pick-bar">
              {pickedNow.length > 0 && (
                <>
                  <span className="pick-count" role="status">{pickedNow.length} selected</span>
                  <button type="button" className="btn small" disabled={!!readOnly} onClick={() => setStack([{ type: 'bulk-edit', ids: pickedNow }])}>Edit</button>
                  <button type="button" className="btn small danger" disabled={!!readOnly} onClick={deletePicked}>Delete</button>
                  <button type="button" className="btn small quiet" onClick={() => setPicked([])} aria-label="Clear the selection">Clear</button>
                </>
              )}
              {bulkDone && (
                <span className="bulk-note" role="status" data-testid="bulk-note">
                  {bulkDone.msg} <button type="button" className="btn small" onClick={undoBulk}>Undo</button>
                </span>
              )}
            </div>
          )}
          {moved && (
            <div className="notice moved-note" role="status" data-testid="moved-note">
              <span>Moved {moved.title} to {moved.when}.</span>
              <button type="button" className="btn small" onClick={undoMove}>Undo</button>
            </div>
          )}
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
            <PanelBody panel={panel} nav={nav} aiDraft={aiDraft} onAiDraft={setAiDraft} onBulkDone={(undo, msg) => setBulkDone({ undo, msg })} />
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
    </HighlightDraftsContext.Provider>
  );
}

function PanelBody({ panel, nav, aiDraft, onAiDraft, onBulkDone }: { panel: Panel; nav: Nav; aiDraft: DraftSet | null; onAiDraft: (d: DraftSet | null) => void; onBulkDone: (undo: Undo, msg: string) => void }) {
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
    case 'bulk-edit': return <BulkEdit key={panel.ids.join()} ids={panel.ids} nav={nav} onDone={onBulkDone} />;
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
