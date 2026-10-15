import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mergeDocs, parseDoc, serializeDoc } from '../model/doc';
import type { MediaRef, TimelineDoc } from '../model/types';
import type { DocStore } from '../store/store';
import { DocProvider, useDoc } from './DocContext';
import type { Nav, Panel } from './nav';
import { ItemEditor, ItemView } from './panels/ItemPanels';
import { Library } from './panels/Library';
import { WikiImport } from './panels/WikiImport';
import { NoteEditor, NoteView } from './panels/NotePanels';
import { SeriesEditor } from './panels/SeriesEditor';
import { SourceEditor, SourceView } from './panels/SourcePanels';
import { TimelineView, type VisibleWindow } from './TimelineView';
import { TrendStrips } from './TrendStrips';
import { downloadText } from './util';

export function App({ store }: { store: DocStore }) {
  return (
    <DocProvider store={store}>
      {(ready) => (ready ? <Workspace /> : <div className="empty-state" role="status">Opening your timeline…</div>)}
    </DocProvider>
  );
}

const SAVE_LABEL = { loading: 'Opening…', saving: 'Saving…', saved: 'Saved on this device', error: 'Couldn’t save. Export a backup now.' } as const;

function Workspace() {
  const { doc, update, replace, saveState, mediaUrl } = useDoc();
  const [stack, setStack] = useState<Panel[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [win, setWin] = useState<VisibleWindow | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const [menu, setMenu] = useState<'add' | 'file' | null>(null);
  const [pendingImport, setPendingImport] = useState<TimelineDoc | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const panel = stack.at(-1);
  const nav: Nav = useMemo(() => ({
    open: (p) => setStack((s) => [...s, p]),
    replace: (p) => setStack((s) => [...s.slice(0, -1), p]),
    back: () => setStack((s) => s.slice(0, -1)),
    close: () => setStack([]),
    canGoBack: stack.length > 1,
  }), [stack.length]);

  const categories = useMemo(() => doc.categories.filter((c) => !hidden.has(c.id)), [doc.categories, hidden]);
  const thumbFor = useCallback((m: MediaRef) => mediaUrl(m, true), [mediaUrl]);
  const selectedId = panel?.type === 'item' ? panel.id : undefined;

  // Escape closes menus first, then the drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      if (menu) setMenu(null);
      else if (stack.length) setStack([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, stack.length]);

  const startNew = (p: Panel) => { setMenu(null); setStack([p]); };

  const onImportFile = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    try {
      const incoming = parseDoc(await file.text());
      if (doc.items.length + doc.notes.length + doc.sources.length + doc.series.length === 0) replace(incoming);
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
        <span className="save-state" role="status" data-testid="save-state">{SAVE_LABEL[saveState]}</span>
        <span className="spacer" />
        <div className="menu">
          <button className="btn primary" aria-expanded={menu === 'add'} onClick={() => setMenu(menu === 'add' ? null : 'add')}>Add</button>
          {menu === 'add' && (
            <div className="menu-pop" role="menu">
              <button role="menuitem" onClick={() => startNew({ type: 'new-item', kind: 'event' })}>Event</button>
              <button role="menuitem" onClick={() => startNew({ type: 'new-item', kind: 'span' })}>Period, war or movement</button>
              <button role="menuitem" onClick={() => startNew({ type: 'new-item', kind: 'person' })}>Person</button>
              <button role="menuitem" onClick={() => startNew({ type: 'wiki-import' })}>From Wikipedia…</button>
              <hr />
              <button role="menuitem" onClick={() => startNew({ type: 'new-note', linkedIds: [] })}>Note</button>
              <button role="menuitem" onClick={() => startNew({ type: 'new-source' })}>Source</button>
              <button role="menuitem" onClick={() => startNew({ type: 'series', id: null })}>Trend over time</button>
            </div>
          )}
        </div>
        <button className="btn" onClick={() => { setMenu(null); setStack([{ type: 'library', tab: 'notes' }]); }}>Library</button>
        <div className="menu">
          <button className="btn quiet" aria-expanded={menu === 'file'} onClick={() => setMenu(menu === 'file' ? null : 'file')}>More</button>
          {menu === 'file' && (
            <div className="menu-pop" role="menu">
              <button role="menuitem" onClick={() => { setMenu(null); setFitSignal((n) => n + 1); }}>Show everything</button>
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

      <div className={`workspace ${panel ? 'with-drawer' : ''}`}>
        <main className="stage">
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
          {importError && <div className="notice bad" role="alert" style={{ margin: '0 16px 8px' }}>{importError}</div>}
          {isEmpty && (
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
          <TimelineView
            items={doc.items}
            categories={categories}
            selectedId={selectedId}
            thumbFor={thumbFor}
            onSelect={(id) => (id ? setStack([{ type: 'item', id }]) : setStack((s) => (s.at(-1)?.type === 'item' ? [] : s)))}
            onAddAt={(year, categoryId) => setStack([{ type: 'new-item', year, categoryId }])}
            onWindow={setWin}
            fitSignal={fitSignal}
          />
          <TrendStrips
            series={doc.series}
            categories={categories}
            window={win}
            onOpen={(id) => setStack([{ type: 'series', id }])}
            onAdd={() => setStack([{ type: 'series', id: null }])}
          />
        </main>

        {panel && (
          <aside className="drawer" aria-label="Details">
            <div className="drawer-head">
              {nav.canGoBack && <button className="btn small quiet" onClick={nav.back}>Back</button>}
              <span className="spacer" />
              <button className="btn small quiet" onClick={nav.close} aria-label="Close panel">Close</button>
            </div>
            <PanelBody panel={panel} nav={nav} />
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

function PanelBody({ panel, nav }: { panel: Panel; nav: Nav }) {
  // `key` resets editor state when switching between records.
  switch (panel.type) {
    case 'item': return panel.edit ? <ItemEditor key={`e-${panel.id}`} id={panel.id} nav={nav} /> : <ItemView key={panel.id} id={panel.id} nav={nav} />;
    case 'new-item': return <ItemEditor key={`new-${panel.draft?.item.id ?? `${panel.year}-${panel.kind}-${panel.categoryId}`}`} id={null} init={panel} draft={panel.draft} nav={nav} />;
    case 'wiki-import': return <WikiImport nav={nav} />;
    case 'note': return panel.edit ? <NoteEditor key={`e-${panel.id}`} id={panel.id} nav={nav} /> : <NoteView key={panel.id} id={panel.id} nav={nav} />;
    case 'new-note': return <NoteEditor key="new-note" id={null} linkedIds={panel.linkedIds} nav={nav} />;
    case 'source': return panel.edit ? <SourceEditor key={`e-${panel.id}`} id={panel.id} nav={nav} /> : <SourceView key={panel.id} id={panel.id} nav={nav} />;
    case 'new-source': return <SourceEditor key="new-source" id={null} nav={nav} />;
    case 'series': return <SeriesEditor key={panel.id ?? 'new-series'} id={panel.id} nav={nav} />;
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
