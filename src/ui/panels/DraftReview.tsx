import { useEffect, useRef, useState } from 'react';
import { AiError } from '../../ai/client';
import { acceptConnection, acceptEntry, canAcceptConnection, type DraftEntry, type DraftSet } from '../../ai/draft';
import { draftEntries } from '../../ai/entries';
import { maskKey, readApiKey, saveApiKey } from '../../ai/key';
import { describeRelation } from '../../model/doc';
import { formatRange, toDecimalYear } from '../../model/dates';
import { useDoc } from '../DocContext';
import { Field } from '../fields';
import type { Nav } from '../nav';
import { titleOf } from '../util';

const OFFLINE = 'You’re offline. Drafting with AI needs a connection; you can still add entries by hand.';

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on); };
  }, []);
  return online;
}

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

  const onTimeline = new Set(doc.items.map((i) => i.id));
  const statusOf = (e: DraftEntry) => (onTimeline.has(e.item.id) ? 'accepted' : e.status);
  const setEntry = (id: string, status: DraftEntry['status']) => draft && onDraft({ ...draft, entries: draft.entries.map((e) => (e.item.id === id ? { ...e, status } : e)) });
  const setConnection = (id: string, status: DraftEntry['status']) => draft && onDraft({ ...draft, connections: draft.connections.map((c) => (c.relation.id === id ? { ...c, status } : c)) });
  const nameOf = (id: string) => titleOf(doc, id) ?? draft?.entries.find((e) => e.item.id === id)?.item.title ?? 'Missing entry';
  const firstOnMap = draft?.entries.find((e) => statusOf(e) === 'pending' && e.item.places?.length && e.item.start);
  const pending = draft ? draft.entries.filter((e) => statusOf(e) === 'pending').length + draft.connections.filter((c) => c.status === 'pending' && !doc.relations.some((r) => r.id === c.relation.id)).length : 0;

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
          <ul className="draft-list">
            {draft.entries.map((e) => {
              const status = statusOf(e);
              const item = e.item;
              return (
                <li key={item.id} className={`draft-row ${status}`} data-testid="draft-entry">
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.start ? formatRange(item.start, item.end) : 'No date'}{item.places?.length ? ' · on the map' : ''}</small>
                    {e.why && <small className="why">Claude: {e.why}</small>}
                    {e.problems.map((p) => <small key={p} className="bad">{p}</small>)}
                  </div>
                  <div className="draft-actions">
                    {status === 'pending' && (
                      <>
                        {!e.problems.length && <button className="btn small primary" onClick={() => update((d) => acceptEntry(d, e))}>Accept</button>}
                        <button className="btn small" onClick={() => nav.open({ type: 'new-item', draft: { item, newSources: e.newSources, highlight: e.highlight } })}>Edit first</button>
                        <button className="btn small quiet" onClick={() => setEntry(item.id, 'rejected')}>Reject</button>
                      </>
                    )}
                    {status === 'accepted' && <button className="btn small quiet" onClick={() => nav.open({ type: 'item', id: item.id })}>Added · Open</button>}
                    {status === 'rejected' && <button className="btn small quiet" onClick={() => setEntry(item.id, 'pending')}>Left out · Undo</button>}
                  </div>
                </li>
              );
            })}
          </ul>

          {draft.connections.length > 0 && (
            <>
              <h3>Connections</h3>
              <ul className="draft-list">
                {draft.connections.map((c) => {
                  const r = c.relation;
                  const added = doc.relations.some((x) => x.id === r.id);
                  const ready = canAcceptConnection(doc, c);
                  return (
                    <li key={r.id} className={`draft-row ${added ? 'accepted' : c.status}`} data-testid="draft-connection">
                      <div>
                        <strong>{nameOf(r.fromId)}</strong>
                        <small>{describeRelation(r.type, 'out')} {nameOf(r.toId)}</small>
                        {!added && c.status === 'pending' && !ready && <small>Accept both entries first.</small>}
                      </div>
                      <div className="draft-actions">
                        {!added && c.status === 'pending' && (
                          <>
                            {ready && <button className="btn small primary" onClick={() => update((d) => acceptConnection(d, c))}>Accept</button>}
                            <button className="btn small quiet" onClick={() => setConnection(r.id, 'rejected')}>Reject</button>
                          </>
                        )}
                        {added && <small>Added</small>}
                        {!added && c.status === 'rejected' && <button className="btn small quiet" onClick={() => setConnection(r.id, 'pending')}>Left out · Undo</button>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {draft.dropped.length > 0 && (
            <details className="draft-dropped">
              <summary>Left out by the checker ({draft.dropped.length})</summary>
              <ul>{draft.dropped.map((d) => <li key={d}>{d}</li>)}</ul>
            </details>
          )}

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
