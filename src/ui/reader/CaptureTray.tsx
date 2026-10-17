import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  acceptConnection, acceptEntry, statusIn, undoConnection, undoEntry, waiting,
  type DraftConnection, type DraftEntry, type DraftSet, type DraftStatus,
} from '../../ai/draft';
import type { ItemDraft } from '../../media/wikipedia';
import { toDecimalYear } from '../../model/dates';
import { CANT_ADD, firstChoice } from '../../model/passage';
import { describeRelation, upsert } from '../../model/doc';
import { KIND_LABEL, factRelations, findInChronicle, subjectFacts, type Subject } from '../../model/subjects';
import { DIMENSIONS, type Dimension, type Highlight, type Relation } from '../../model/types';
import { useDoc } from '../DocContext';
import { DraftConnectionRow, DraftEntryRow, DroppedList } from '../panels/DraftRows';
import { useApiKey, useOnline } from '../useAi';
import { DIMENSION_LABEL } from '../util';
import { Glyph } from './Glyph';
import { useHighlightDrafts } from './highlightDrafts';
import type { RecordRef } from './ReaderPane';
import { PIGMENT, type useHighlighting } from './useHighlighting';
import type { SubjectState } from './useSubject';

type Marks = ReturnType<typeof useHighlighting>;

const ASK_OFFLINE = 'Asking Claude needs a connection.';

interface Row {
  key: string;
  state: SubjectState;
  subject?: Subject;
  /** The article's own subject. */
  own: boolean;
  have?: { id: string; title: string };
  ref?: RecordRef;
  /** This highlight is already on the record Bob has. */
  linked: boolean;
  title: string;
}

const pigment = (d?: Dimension) => `var(--pig-${PIGMENT[d ?? 'none']})`;

/**
 * The capture tray under the reader's text. With a highlight open it shows
 * the card: the quote, what it could become (the article's subject and the
 * pages the passage links, one chosen), the chosen one's facts, a dimension
 * and what to do with it. Otherwise one line counts the article's highlights. Closing
 * the card, or moving on, keeps the highlight as it is.
 */
export function CaptureTray({ marks, candidates, articleTitle, onAdd, onAsk, onOpenRecord, onEdit, onShowYear, onOpenDrafting }: {
  marks: Marks;
  /** What the open highlight could become: the article's subject first, then the pages its passage links. */
  candidates: { key: string; state: SubjectState }[];
  articleTitle: string;
  /** Draft a page as an entry citing this highlight. Throws with a message Bob can read. */
  onAdd: (h: Highlight, key: string) => Promise<void>;
  /** Ask Claude to draft what the passage states. Throws with a message Bob can read. */
  onAsk: (h: Highlight, apiKey: string, signal: AbortSignal) => Promise<DraftSet>;
  onOpenRecord?: (r: RecordRef) => void;
  /** Open a drafted entry in the editor before adding it. */
  onEdit?: (d: ItemDraft) => void;
  onShowYear?: (year: number) => void;
  onOpenDrafting?: () => void;
}) {
  const { doc, update } = useDoc();
  const drafts = useHighlightDrafts();
  const online = useOnline();
  const apiKey = useApiKey();
  const tray = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLElement>(null);
  const claudeSection = useRef<HTMLElement>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The candidate Bob picked, per highlight, this session. */
  const [picked, setPicked] = useState<Record<string, string>>({});
  /** Suggested connections Bob unticked, by the other entry's id. */
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  /** Highlights Claude is reading, and what went wrong asking, by highlight id. Asking goes on if Bob moves on. */
  const [asking, setAsking] = useState<Record<string, AbortController>>({});
  const [askError, setAskError] = useState<Record<string, string>>({});
  const open = marks.open;
  const openId = open?.highlight.id;

  // The map shows the open highlight's drafts.
  const { show } = drafts;
  useEffect(() => { show(openId ?? null); }, [openId, show]);
  useEffect(() => () => show(null), [show]);

  // A newly opened card starts fresh, and the passage is lifted clear of the tray.
  useLayoutEffect(() => {
    setError(null);
    setBusy(false);
    if (!openId) return;
    setFlash(null);
    const frame = requestAnimationFrame(() => {
      const r = marks.openRect();
      const t = tray.current?.getBoundingClientRect();
      const scroller = tray.current?.closest('.reader');
      if (!r || !t || !scroller) return;
      const overlap = r.bottom - (t.top - 16);
      const top = scroller.getBoundingClientRect().top;
      if (overlap > 0 && r.top - overlap > top) {
        scroller.scrollBy({ top: overlap, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
    });
    return () => cancelAnimationFrame(frame);
    // Only when a different highlight opens, not on every edit of it.
  }, [openId]);

  // On the phone the docked Highlight button takes the bottom while selecting.
  if (marks.toolSpot === 'docked') return null;

  if (!open) {
    const n = marks.placed.length;
    if (!n && !flash) return null;
    const added = marks.placed.filter((p) => p.highlight.usedBy.length).length;
    return (
      <div ref={tray} className="tray" data-testid="capture-tray">
        <div className="tray-bar" role="status">
          <span className="msg">
            {flash ?? `${n} ${n === 1 ? 'highlight' : 'highlights'} in this article · ${added} on your map and timeline`}
          </span>
        </div>
      </div>
    );
  }

  const h = open.highlight;
  const section = h.anchor?.section;
  const done = (msg: string) => { setFlash(msg); marks.keep(); };
  const inChronicle = (qid?: string) => !!qid && !!(findInChronicle(doc.items, qid) ?? findInChronicle(doc.territories, qid));

  // Each candidate, with what Bob already has for it.
  const rows: Row[] = candidates.map(({ key, state }, i) => {
    const s = state.status === 'ready' ? state.subject : undefined;
    const item = s && findInChronicle(doc.items, s.qid);
    const territory = s && !item ? findInChronicle(doc.territories, s.qid) : undefined;
    const have = item ?? territory;
    return {
      key, state, subject: s, own: i === 0, have,
      ref: have && { type: item ? 'item' : 'territory', id: have.id },
      linked: !!have && h.usedBy.includes(have.id),
      title: s?.label ?? key.replace(/_/g, ' '),
    };
  });
  const used = h.usedBy.length > 0;
  const chosenKey = picked[h.id]
    ?? rows.find((r) => r.linked)?.key
    ?? rows.find((r, i) => i > 0 && r.subject && r.subject.qid === h.subjectQid)?.key
    ?? rows[firstChoice(rows.map((r) => r.subject?.kind))]?.key;
  const chosen = rows.find((r) => r.key === chosenKey) ?? rows[0];

  const choose = (r: Row) => {
    setPicked((p) => ({ ...p, [h.id]: r.key }));
    setError(null);
    if (r.subject) marks.setSubject(r.subject.qid);
  };

  let body: React.ReactNode = null;
  let actions: React.ReactNode;
  const keepOnly = used
    ? <button type="button" className="btn primary" onClick={() => marks.keep()}>Done</button>
    : <button type="button" className="btn primary" onClick={() => done('Kept as a highlight.')}>Keep the highlight</button>;
  const justKeep = used
    ? <button type="button" className="btn" onClick={() => marks.keep()}>Done</button>
    : <button type="button" className="btn" onClick={() => done('Kept as a highlight.')}>Just keep the highlight</button>;
  const named = chosen?.have?.title ?? chosen?.title ?? articleTitle;

  if (!chosen || !chosen.subject) {
    const status = chosen?.state.status ?? 'loading';
    const what = chosen?.own ? 'this article' : named;
    body = (
      <p className="tray-note" aria-busy={status === 'loading'}>
        {status === 'loading' && `Looking up what ${what} is about…`}
        {status === 'offline' && `You’re offline. What ${what} is about will show when you’re back online. Your highlight is saved.`}
        {status === 'unknown' && `Wikidata doesn’t say what ${what} is about, so there’s nothing to add to the map from it. Your highlight is saved.`}
      </p>
    );
    actions = keepOnly;
  } else {
    const s = chosen.subject;
    const { have, ref, linked } = chosen;
    const facts = subjectFacts(s);
    const cantAdd = !have && (!s.kind || CANT_ADD[s.kind]);
    // Linking to an entry Bob has: Wikidata's facts may connect it to others he has, with this highlight as evidence.
    const suggested = have && !linked && ref?.type === 'item' ? factRelations(have.id, s.facts, doc, h.id) : [];
    const otherOf = (r: Relation) => (r.fromId === have?.id ? r.toId : r.fromId);
    body = (
      <>
        {facts.length > 0 && (
          <dl className="facts">
            {facts.map((f) => (
              <div className="fact" key={f.label}>
                <dt>{f.label}</dt>
                <dd>
                  {f.values.map((v, i) => (
                    <span key={i}>{i > 0 && ', '}<span className={inChronicle(v.qid) ? 'have' : undefined}>{v.text}</span></span>
                  ))}
                  {f.pin && !have && <span className="pin"> · a pin on the map</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <p className="tray-note">
          {linked ? `This highlight is on ${named}.`
            : cantAdd && s.kind ? CANT_ADD[s.kind]
            : facts.length ? `All of this comes from Wikidata${facts.some((f) => f.values.some((v) => inChronicle(v.qid))) ? '; underlined names are already in Chronicle' : ''}.`
            : 'Wikidata gives no dates or places for this.'}
        </p>
        {suggested.length > 0 && (
          <div className="suggested" data-testid="suggested-connections">
            <p className="tray-note">Linking also connects, with this highlight as evidence:</p>
            {suggested.map((r) => {
              const other = otherOf(r);
              const name = `${describeRelation(r.type, r.fromId === have!.id ? 'out' : 'in')} ${doc.items.find((i) => i.id === other)?.title ?? ''}`;
              return (
                <label className="check" key={other}>
                  <input
                    type="checkbox"
                    checked={!unticked.has(other)}
                    onChange={(e) => setUnticked((u) => { const n = new Set(u); if (e.target.checked) n.delete(other); else n.add(other); return n; })}
                  /> {name}
                </label>
              );
            })}
          </div>
        )}
      </>
    );
    if (linked) {
      actions = (
        <>
          {ref && onOpenRecord && <button type="button" className="btn primary" onClick={() => onOpenRecord(ref)}>Open {named}</button>}
          <button type="button" className="btn" onClick={() => marks.keep()}>Done</button>
        </>
      );
    } else if (have) {
      actions = (
        <>
          <button type="button" className="btn primary" onClick={() => {
            marks.setSubject(s.qid);
            marks.link(have.id);
            const keep = suggested.filter((r) => !unticked.has(otherOf(r)));
            if (keep.length) update((d) => keep.reduce((next, r) => upsert(next, 'relations', r), d));
            done(`Linked to ${named}.`);
          }}>Link to {named}</button>
          {justKeep}
        </>
      );
    } else if (cantAdd) {
      actions = keepOnly;
    } else {
      const add = async () => {
        setBusy(true);
        setError(null);
        marks.setSubject(s.qid);
        try { await onAdd({ ...h, subjectQid: s.qid }, chosen.key); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      };
      actions = (
        <>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void add()}>{busy ? 'Reading Wikipedia…' : 'Add to map and timeline'}</button>
          {justKeep}
        </>
      );
    }
  }

  // ----- Claude, for what has no article of its own -----
  const set = drafts.sets[h.id];
  const suggestedDim = set?.dimension?.value;
  const ctl = asking[h.id];
  const ask = async () => {
    if (!navigator.onLine) { setAskError((m) => ({ ...m, [h.id]: ASK_OFFLINE })); return; }
    const c = new AbortController();
    setAsking((a) => ({ ...a, [h.id]: c }));
    setAskError(({ [h.id]: _gone, ...m }) => m);
    try {
      drafts.put(h.id, await onAsk(h, apiKey, c.signal));
      // Bring the drafts into view in the tray.
      requestAnimationFrame(() => {
        const s = claudeSection.current?.getBoundingClientRect();
        const t = card.current?.getBoundingClientRect();
        if (s && t) card.current!.scrollBy({ top: s.top - t.top - 8, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setAskError((m) => ({ ...m, [h.id]: navigator.onLine ? (e as Error).message : ASK_OFFLINE }));
    } finally {
      setAsking(({ [h.id]: _done, ...a }) => a);
    }
  };
  const setStatus = (x: DraftEntry | DraftConnection, status: DraftStatus) => set && drafts.put(h.id, {
    ...set,
    entries: set.entries.map((e) => (e === x ? { ...e, status } : e)),
    connections: set.connections.map((c) => (c === x ? { ...c, status } : c)),
  });
  const left = waiting(doc, set);

  let claude: React.ReactNode;
  if (ctl) {
    claude = (
      <div className="ask">
        <p className="busy" role="status">Claude is reading this passage and its section…</p>
        <button type="button" className="link" onClick={() => ctl.abort()}>Stop</button>
      </div>
    );
  } else if (set) {
    claude = (
      <>
        {set.entries.length > 0 && (
          <>
            <div className="dgroup">Entries</div>
            <ul className="drows">
              {set.entries.map((e) => (
                <DraftEntryRow
                  key={e.item.id}
                  entry={e}
                  status={statusIn(doc, e)}
                  onAccept={() => {
                    update((d) => acceptEntry(d, e, Date.now(), h.id));
                    if (e.item.start) onShowYear?.(Math.round(toDecimalYear(e.item.start)));
                  }}
                  onEdit={onEdit && (() => onEdit({ item: { ...e.item, ...(h.dimension && !e.item.dimension ? { dimension: h.dimension } : {}) }, newSources: e.newSources, highlight: h }))}
                  onReject={() => setStatus(e, 'rejected')}
                  onRestore={() => setStatus(e, 'pending')}
                  onUndo={() => update((d) => undoEntry(d, set, e))}
                />
              ))}
            </ul>
          </>
        )}
        {set.connections.length > 0 && (
          <>
            <div className="dgroup">Connections</div>
            <ul className="drows">
              {set.connections.map((c) => (
                <DraftConnectionRow
                  key={c.relation.id}
                  c={c}
                  status={statusIn(doc, c)}
                  entries={set.entries}
                  onAccept={() => update((d) => acceptConnection(d, c, Date.now(), h.id))}
                  onReject={() => setStatus(c, 'rejected')}
                  onRestore={() => setStatus(c, 'pending')}
                  onUndo={() => update((d) => undoConnection(d, c))}
                />
              ))}
            </ul>
          </>
        )}
        {!set.entries.length && !set.connections.length && <p className="tray-note">Claude found nothing in this passage that isn’t already in Chronicle or on Wikipedia.</p>}
        <DroppedList dropped={set.dropped} />
        <p className="dnote">
          Drafted by {set.provenance.model} ({set.provenance.prompt}).{left > 0 && ' Dashed on the map until you decide.'}
          {left > 0 && <> <button type="button" className="link" onClick={() => drafts.put(h.id, null)}>Discard the rest</button></>}
        </p>
      </>
    );
  } else {
    const why = !online ? <span className="why bad">{ASK_OFFLINE}</span>
      : !apiKey ? (
        <span className="why bad">
          Add your Anthropic API key in {onOpenDrafting ? <button type="button" className="link" onClick={onOpenDrafting}>Drafting with AI</button> : 'Drafting with AI'} first.
        </span>
      )
      : <span className="why">Dates, events and connections the passage states, for you to check one by one.</span>;
    claude = (
      <div className="ask">
        <button type="button" className="ask-btn" disabled={!online || !apiKey} onClick={() => void ask()}><Glyph kind="claude" />Ask Claude</button>
        {why}
      </div>
    );
  }

  const n = rows.length;
  const becomes = (
    <div className="becomes">
      <div className="lbl">Becomes <span>· {n === 1 ? 'the article’s subject' : `${n} in this passage, pick one`}</span></div>
      <div className="cands" role="radiogroup" aria-label="Becomes">
        {rows.map((r) => {
          const kind = r.subject?.kind;
          const what = r.state.status === 'loading' ? 'Looking up…'
            : r.state.status === 'offline' ? 'Needs a connection'
            : kind ? KIND_LABEL[kind] : 'Not sure what kind';
          const there = r.have && (r.ref?.type === 'territory' ? ' · in Chronicle as a territory' : r.have.title !== r.title ? ` · in Chronicle as ${r.have.title}` : '');
          const line = `${r.own ? `This article · ${what}` : what}${there || ''}`;
          return (
            <button
              type="button"
              key={r.key}
              className="cand"
              role="radio"
              aria-checked={r === chosen}
              aria-label={`${r.have?.title ?? r.title}, ${line}${r.linked ? ', linked' : r.have ? ', in Chronicle' : ''}`}
              data-kind={kind}
              disabled={marks.readOnly}
              onClick={() => choose(r)}
            >
              <Glyph kind={kind} />
              <span className="line">
                <span className="ct">{r.have?.title ?? r.title}</span>
                <span className="ck">{line}</span>
              </span>
              {r.linked ? <span className="tag linked">Linked</span> : r.have ? <span className="tag have">In Chronicle</span> : null}
            </button>
          );
        })}
      </div>
      {body}
    </div>
  );

  return (
    <div ref={tray} className="tray" data-testid="capture-tray">
      <article ref={card} className="tray-card" aria-label="Highlight" style={{ '--c': pigment(h.dimension) } as React.CSSProperties}>
        <blockquote className="q">“{h.text}”</blockquote>
        <p className="src">{articleTitle}{section ? ` › ${section}` : ''}</p>
        {becomes}
        <div className="dimpick" role="group" aria-label="Dimension">
          <span className="lbl">Dimension</span>
          {DIMENSIONS.map((d) => (
            <button
              type="button"
              key={d}
              className={d === suggestedDim ? 'sug' : undefined}
              style={{ '--d': pigment(d) } as React.CSSProperties}
              title={`${DIMENSION_LABEL[d]}${d === suggestedDim ? ' (suggested by Claude)' : ''}`}
              aria-label={`${DIMENSION_LABEL[d]}${d === suggestedDim ? ', suggested by Claude' : ''}`}
              aria-pressed={h.dimension === d}
              disabled={marks.readOnly}
              onClick={() => marks.setDimension(h.dimension === d ? undefined : d)}
            ><i /></button>
          ))}
          <span className="dn">
            {h.dimension ? <>{DIMENSION_LABEL[h.dimension]}{h.dimension === suggestedDim && <em> · Claude’s suggestion</em>}</>
              : suggestedDim ? <><em>Claude suggests {DIMENSION_LABEL[suggestedDim]}</em> · pick it to use it</>
              : 'None yet'}
          </span>
        </div>
        {!marks.readOnly && (
          <section ref={claudeSection} className="claude" aria-label="Claude">
            <div className="lbl"><Glyph kind="claude" />Claude <span>· for what has no article of its own</span></div>
            {claude}
            {askError[h.id] && <div className="notice bad" role="alert">{askError[h.id]}</div>}
          </section>
        )}
        {error && <div className="notice bad" role="alert">{error}</div>}
        {!marks.readOnly && (
          <div className="cardacts">
            {actions}
            <button type="button" className="link" onClick={marks.removeOpen}>Remove</button>
          </div>
        )}
      </article>
    </div>
  );
}
