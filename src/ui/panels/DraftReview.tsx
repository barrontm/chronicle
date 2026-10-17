import { useEffect, useRef, useState } from 'react';
import { AiError } from '../../ai/client';
import { acceptConnection, acceptEntry, statusIn, undoConnection, undoEntry, waiting, type DraftSet, type DraftStatus } from '../../ai/draft';
import { draftEntries } from '../../ai/entries';
import { maskKey, readApiKey, saveApiKey } from '../../ai/key';
import { toDecimalYear } from '../../model/dates';
import { useDoc } from '../DocContext';
import { Field } from '../fields';
import type { Nav } from '../nav';
import { useOnline } from '../useAi';
import { DraftConnectionRow, DraftEntryRow, DroppedList } from './DraftRows';

const OFFLINE = 'You’re offline. Drafting with AI needs a connection; you can still add entries by hand.';

/**
 * Draft with AI: Bob describes a topic, Claude picks Wikipedia pages for it,
 * the app reads their facts, and Bob accepts or rejects each record. The
 * pending entries show on the map as dashed pins until he decides.
 */
export function DraftReview({ nav, draft, onDraft }: { nav: Nav; draft: DraftSet | null; onDraft: (d: DraftSet | null) => void }) {
  const { doc, update } = useDoc();
  const online = useOnline();
  const [key, setKey] = useState(readApiKey);
  const [editingKey, setEditingKey] = useState(() => !readApiKey());
  const [keyInput, setKeyInput] = useState('');
  const [request, setRequest] = useState(draft?.request ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const storeKey = () => {
    saveApiKey(keyInput);
    setKey(readApiKey() || keyInput.trim());
    setKeyInput('');
    setEditingKey(false);
  };
  const forgetKey = () => {
    saveApiKey('');
    setKey('');
    setEditingKey(true);
  };

  const run = async () => {
    if (!request.trim() || busy) return;
    if (!navigator.onLine) { setError(OFFLINE); return; }
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    setError(null);
    try {
      onDraft(await draftEntries({ request, doc, apiKey: key, today: new Date().toISOString().slice(0, 10), signal: ctl.signal }));
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      if (e instanceof AiError && e.problem === 'bad-key') setEditingKey(true);
      setError(navigator.onLine ? (e as Error).message : OFFLINE);
    } finally {
      if (abort.current === ctl) setBusy(false);
    }
  };

  const setEntry = (id: string, status: DraftStatus) => draft && onDraft({ ...draft, entries: draft.entries.map((e) => (e.item.id === id ? { ...e, status } : e)) });
  const setConnection = (id: string, status: DraftStatus) => draft && onDraft({ ...draft, connections: draft.connections.map((c) => (c.relation.id === id ? { ...c, status } : c)) });
  const firstOnMap = draft?.entries.find((e) => statusIn(doc, e) === 'pending' && e.item.places?.length && e.item.start);
  const pending = waiting(doc, draft);

  return (
    <div data-testid="draft-review">
      <h2>Draft with AI</h2>
      <p className="lede">
        Say what you’re studying and Claude picks Wikipedia pages for it. Dates, places and pictures come from Wikipedia and Wikidata, not from Claude.
        Nothing is added until you accept it.
      </p>

      {!online && <div className="notice bad" role="alert">{OFFLINE}</div>}

      {editingKey ? (
        <form className="editor-row" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); storeKey(); }}>
          <div className="grow">
            <Field label="Your Anthropic API key">
              <input type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="sk-ant-…" autoComplete="off" spellCheck={false} />
            </Field>
          </div>
          <button className="btn" disabled={!keyInput.trim()}>Save key</button>
        </form>
      ) : (
        <p className="meta" data-testid="ai-key">
          <span>Using your key {maskKey(key)}</span>
          <button className="btn small quiet" onClick={() => setEditingKey(true)}>Change</button>
          <button className="btn small quiet" onClick={forgetKey}>Forget</button>
        </p>
      )}
      {editingKey && (
        <p className="notice subtle">
          The key stays in this browser only. It’s never in your backups or exports. Drafts are billed to your Anthropic account
          (a draft usually costs a few cents). Get a key at console.anthropic.com.
        </p>
      )}

      <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void run(); }}>
        <Field label="What should Claude draft?">
          <textarea value={request} onChange={(e) => setRequest(e.target.value)} rows={2} placeholder="The main battles of the Greco-Persian Wars" />
        </Field>
        <div className="actions">
          <button className="btn primary" disabled={!request.trim() || busy || !key || !online}>{draft ? 'Draft again' : 'Draft'}</button>
          {busy && <button type="button" className="btn" onClick={() => { abort.current?.abort(); setBusy(false); }}>Stop</button>}
        </div>
      </form>
      {!key && !editingKey && <div className="notice">Add your Anthropic API key first.</div>}
      {busy && <div className="notice" role="status">Claude is choosing pages, then the facts are read from Wikipedia…</div>}
      {error && <div className="notice bad" role="alert">{error}</div>}

      {draft && (
        <section data-testid="draft-results" aria-label="Draft">
          <h3>Entries</h3>
          {draft.entries.length === 0 && <div className="notice">Claude didn’t find anything to add. Try describing it differently.</div>}
          <ul className="drows">
            {draft.entries.map((e) => (
              <DraftEntryRow
                key={e.item.id}
                entry={e}
                status={statusIn(doc, e)}
                onAccept={() => update((d) => acceptEntry(d, e))}
                onEdit={() => nav.open({ type: 'new-item', draft: { item: e.item, newSources: e.newSources, highlight: e.highlight } })}
                onReject={() => setEntry(e.item.id, 'rejected')}
                onRestore={() => setEntry(e.item.id, 'pending')}
                onUndo={() => update((d) => undoEntry(d, draft, e))}
                onOpen={() => nav.open({ type: 'item', id: e.item.id })}
              />
            ))}
          </ul>

          {draft.connections.length > 0 && (
            <>
              <h3>Connections</h3>
              <ul className="drows">
                {draft.connections.map((c) => (
                  <DraftConnectionRow
                    key={c.relation.id}
                    c={c}
                    status={statusIn(doc, c)}
                    entries={draft.entries}
                    onAccept={() => update((d) => acceptConnection(d, c))}
                    onReject={() => setConnection(c.relation.id, 'rejected')}
                    onRestore={() => setConnection(c.relation.id, 'pending')}
                    onUndo={() => update((d) => undoConnection(d, c))}
                  />
                ))}
              </ul>
            </>
          )}

          <DroppedList dropped={draft.dropped} />

          <div className="actions">
            {firstOnMap && <button className="btn" onClick={() => nav.showOnMap(Math.round(toDecimalYear(firstOnMap.item.start)))}>Show on map</button>}
            <button className="btn quiet" onClick={() => { onDraft(null); setRequest(''); }}>{pending ? 'Discard the rest' : 'Done'}</button>
          </div>
          <p className="notice subtle">Drafted by {draft.provenance.model} ({draft.provenance.prompt}). Dashed pins on the map are waiting for you.</p>
        </section>
      )}
    </div>
  );
}
