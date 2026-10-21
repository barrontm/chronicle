import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  acceptConnection, acceptEntry, addBecoming, statusIn, undoBecoming, undoConnection, undoEntry, waiting,
  type Became, type Becoming, type DraftConnection, type DraftEntry, type DraftSet, type DraftStatus,
} from '../../ai/draft';
import { bordersFor } from '../../data/basemaps';
import { areaKm2, type Area } from '../../data/geo';
import { lookUpPlace, type ItemDraft } from '../../media/wikipedia';
import { formatItemDates, parseHistDate, toDecimalYear } from '../../model/dates';
import { placeYear } from '../../model/polities';
import { CANT_ADD, defaultChoices, ownEntry, polityTerritory, territoryOf } from '../../model/passage';
import { upsert } from '../../model/doc';
import { describeRelation } from '../../model/doc';
import { KIND_LABEL, factRelations, findInChronicle, subjectFacts, type Subject } from '../../model/subjects';
import type { Highlight, ItemKind, Lane, Place, Relation, Territory, TerritorySnapshot } from '../../model/types';
import { useDoc } from '../DocContext';
import { DraftConnectionRow, DraftEntryRow, DroppedList } from '../panels/DraftRows';
import { useApiKey, useOnline } from '../useAi';
import { lanesInWords, PIGMENT } from '../util';
import { LaneChips } from '../LaneChips';
import { PlacePolity, usePlacePolity } from '../PlacePolity';
import { Glyph } from './Glyph';
import { useHighlightDrafts, type Ghost } from './highlightDrafts';
import type { RecordRef } from './ReaderPane';
import type { useHighlighting } from './useHighlighting';
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
  /** Why it can't be ticked, when it can't. */
  cant?: string;
}

const ITEM_KIND: Record<ItemKind, string> = { event: 'Event', span: 'Period', person: 'Person' };
const NO_FORM = { title: '', kind: 'event' as ItemKind, start: '', end: '', place: '', lanes: undefined as Lane[] | undefined };
const inWords = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

const pigment = (d?: Lane) => `var(--pig-${PIGMENT[d ?? 'none']})`;

/**
 * The capture tray under the reader's text. With a highlight open it shows
 * the card: the quote, what it could become (the article's subject and the
 * pages the passage links, any number ticked, or something Bob fills in
 * himself), the ticked ones' facts, its lanes and what to do with it.
 * Otherwise one line counts the article's highlights. Closing the card, or
 * moving on, keeps the highlight as it is.
 */
export function CaptureTray({ marks, candidates, articleTitle, onAdd, onDraftPage, onAsk, onOpenRecord, onEdit, onShowYear, onOpenDrafting, onDraw }: {
  marks: Marks;
  /** What the open highlight could become: the article's subject first, then the pages its passage links. */
  candidates: { key: string; state: SubjectState }[];
  articleTitle: string;
  /** Draft a page as an entry citing this highlight, and open it in the editor. Throws with a message Bob can read. */
  onAdd: (h: Highlight, key: string) => Promise<void>;
  /** Draft a page as an entry citing this highlight, or say which entry Bob already has for it. Throws like `onAdd`. */
  onDraftPage: (h: Highlight, key: string) => Promise<ItemDraft | { duplicateOf: string }>;
  /** Ask Claude to draft what the passage states. Throws with a message Bob can read. */
  onAsk: (h: Highlight, apiKey: string, signal: AbortSignal) => Promise<DraftSet>;
  onOpenRecord?: (r: RecordRef) => void;
  /** Open a drafted entry in the editor before adding it. */
  onEdit?: (d: ItemDraft) => void;
  onShowYear?: (year: number) => void;
  onOpenDrafting?: () => void;
  /** Draw borders on the map (today's draw tool), for a polity the historical maps don't have. */
  onDraw?: (onDone: (g: Area, year: number) => void) => void;
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
  /** What a slow add is doing now ("Looking for Sparta’s borders…"). */
  const [progress, setProgress] = useState<string | null>(null);
  /** An add held back because a polity has no borders yet, until Bob draws them or adds it without. */
  const [held, setHeld] = useState<{ b: Becoming; names: string[]; ticks: string[]; missing: { id: string; title: string }[]; note?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The candidates Bob ticked, per highlight, this session (until he does, `defaultChoices`). */
  const [ticked, setTicked] = useState<Record<string, string[]>>({});
  /** The candidate whose reason for not being tickable is showing. */
  const [whyNot, setWhyNot] = useState<string | null>(null);
  /** What the last add did, so Undo can take it back. */
  const [last, setLast] = useState<{ became: Became; msg: string; ticks?: string[] } | null>(null);
  /** "Something else…": the form, open or not, and what's wrong with it. */
  const [own, setOwn] = useState<typeof NO_FORM | null>(null);
  const [ownError, setOwnError] = useState<string | null>(null);
  /** Suggested connections Bob unticked, by the other entry's id. */
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  /** Highlights Claude is reading, and what went wrong asking, by highlight id. Asking goes on if Bob moves on. */
  const [asking, setAsking] = useState<Record<string, AbortController>>({});
  const [askError, setAskError] = useState<Record<string, string>>({});
  const open = marks.open;
  const openId = open?.highlight.id;

  // "Something else…": its place, looked up as Bob types it, and who held it in its year.
  const [ownPlace, setOwnPlace] = useState<{ query: string; place?: Place; failed?: true } | null>(null);
  const ownQuery = own?.place.trim() ?? '';
  useEffect(() => {
    if (!ownQuery || !online || ownPlace?.query === ownQuery) return;
    const c = new AbortController();
    const t = setTimeout(() => {
      lookUpPlace(ownQuery, c.signal).then(
        ([hit]) => setOwnPlace({ query: ownQuery, ...(hit ? { place: { name: hit.name, lat: hit.lat, lon: hit.lon, role: 'site' } } : {}) }),
        () => { if (!c.signal.aborted) setOwnPlace({ query: ownQuery, failed: true }); },
      );
    }, 500);
    return () => { clearTimeout(t); c.abort(); };
  }, [ownQuery, online, ownPlace?.query]);
  const ownStart = own?.start.trim() ? parseHistDate(own.start) : undefined;
  const ownEnd = own && own.kind !== 'event' && own.end.trim() ? parseHistDate(own.end) : undefined;
  const ownAt = ownPlace?.query === ownQuery ? ownPlace.place : undefined;
  const ownYear = ownAt && ownStart ? placeYear({ kind: own!.kind, start: ownStart, end: ownEnd ?? undefined }, ownAt) : undefined;
  const ownPolity = usePlacePolity(ownAt && ownYear !== undefined ? { name: ownAt.name, lat: ownAt.lat, lon: ownAt.lon, year: ownYear } : undefined);

  // The map shows the open highlight's drafts, and a ghost of what it could become (set below, once the candidate is known).
  const { show, setGhosts } = drafts;
  useEffect(() => { show(openId ?? null); }, [openId, show]);
  useEffect(() => () => { show(null); setGhosts([]); }, [show, setGhosts]);
  const ghosts = useRef<Ghost[]>([]);
  ghosts.current = [];
  useEffect(() => setGhosts(ghosts.current));

  // A newly opened card starts fresh, and the passage is lifted clear of the tray.
  useLayoutEffect(() => {
    setError(null);
    setBusy(false);
    setWhyNot(null);
    setLast(null);
    setHeld(null);
    setProgress(null);
    setOwn(null);
    setOwnError(null);
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

  // Each candidate, with what Bob already has for it, and why it can't be ticked if it can't.
  const rows: Row[] = candidates.map(({ key, state }, i) => {
    const s = state.status === 'ready' ? state.subject : undefined;
    const item = s && findInChronicle(doc.items, s.qid);
    const territory = s && !item ? findInChronicle(doc.territories, s.qid) : undefined;
    const have = item ?? territory;
    const title = s?.label ?? key.replace(/_/g, ' ');
    const cant = marks.readOnly ? 'This timeline is read-only.'
      : state.status === 'loading' ? 'Still looking it up on Wikidata.'
      : state.status === 'offline' ? 'What it is will show when you’re back online.'
      : !s ? `Wikidata doesn’t say what ${i === 0 ? 'this article' : title} is about, so there’s nothing to add to the map from it.`
      : have ? undefined
      : !s.kind ? 'Wikidata doesn’t say what kind of thing it is, so it can’t be drawn yet.'
      : CANT_ADD[s.kind];
    return {
      key, state, subject: s, own: i === 0, have,
      ref: have && { type: item ? 'item' : 'territory', id: have.id },
      linked: !!have && h.usedBy.includes(have.id),
      title, cant,
    };
  });
  const used = h.usedBy.length > 0;
  const chosenKeys = ticked[h.id]
    ?? defaultChoices(rows.map((r) => ({ kind: r.subject?.kind, linked: r.linked, remembered: !!r.subject && r.subject.qid === h.subjectQid }))).map((i) => rows[i].key);
  const isTicked = (r: Row) => r.linked || (!r.cant && chosenKeys.includes(r.key));
  const toLink = rows.filter((r) => isTicked(r) && !r.linked && r.have);
  const toAdd = rows.filter((r) => isTicked(r) && !r.have);
  for (const r of toAdd) {
    const at = r.subject?.facts.coords;
    if (at) ghosts.current.push({ qid: r.subject!.qid, title: r.title, lat: at.lat, lon: at.lon });
  }

  const toggle = (r: Row) => {
    setError(null);
    if (r.linked) return;
    if (r.cant) { setWhyNot((w) => (w === r.key ? null : r.key)); return; }
    setWhyNot(null);
    const on = chosenKeys.includes(r.key);
    setTicked((t) => ({ ...t, [h.id]: on ? chosenKeys.filter((k) => k !== r.key) : [...chosenKeys, r.key] }));
    if (!on && r.subject) marks.setSubject(r.subject.qid);
  };

  // Linking to an entry Bob has: Wikidata's facts may connect it to others he has, with this highlight as evidence.
  const suggestedFor = (r: Row) => (r.have && !r.linked && r.ref?.type === 'item' ? factRelations(r.have.id, r.subject!.facts, doc, h.id) : []);
  const otherOf = (r: Relation, id: string) => (r.fromId === id ? r.toId : r.fromId);
  const kept = (r: Row) => suggestedFor(r).filter((x) => !unticked.has(otherOf(x, r.have!.id)));

  /** Under a ticked candidate: its facts from Wikidata, and the connections linking it would make. */
  const details = (r: Row) => {
    const s = r.subject!;
    const facts = subjectFacts(s);
    const suggested = suggestedFor(r);
    return (
      <div className="cand-more">
        {facts.length > 0 ? (
          <dl className="facts">
            {facts.map((f) => (
              <div className="fact" key={f.label}>
                <dt>{f.label}</dt>
                <dd>
                  {f.values.map((v, i) => (
                    <span key={i}>{i > 0 && ', '}<span className={inChronicle(v.qid) ? 'have' : undefined}>{v.text}</span></span>
                  ))}
                  {f.pin && !r.have && <span className="pin"> · a pin on the map</span>}
                </dd>
              </div>
            ))}
          </dl>
        ) : <p className="tray-note">Wikidata gives no dates or places for this.</p>}
        {suggested.length > 0 && (
          <div className="suggested" data-testid="suggested-connections">
            <p className="tray-note">Linking also connects, with this highlight as evidence:</p>
            {suggested.map((x) => {
              const other = otherOf(x, r.have!.id);
              const name = `${describeRelation(x.type, x.fromId === r.have!.id ? 'out' : 'in')} ${doc.items.find((i) => i.id === other)?.title ?? ''}`;
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
      </div>
    );
  };

  /**
   * Link what Bob has and add the rest straight away, through the same path as Claude's drafts;
   * one Undo takes it all back. A polity comes with its territory, its borders found in Seshat's
   * maps (else the historical maps); when neither has them, Bob draws them or adds it without.
   */
  const addTicked = async () => {
    setBusy(true);
    setError(null);
    try {
      const b: Becoming = { link: toLink.map((r) => ({ id: r.have!.id, relations: kept(r) })), add: [] };
      const names = toLink.map((r) => r.have!.title);
      const missing: { id: string; title: string }[] = [];
      let note: string | undefined;
      for (const r of toAdd) {
        const d = await onDraftPage({ ...h, subjectQid: r.subject!.qid }, r.key);
        if ('duplicateOf' in d) b.link.push({ id: d.duplicateOf });
        else if (d.item.subject === 'polity') {
          const { item } = d;
          let snaps: TerritorySnapshot[] = [];
          let source: Territory['source'];
          if (!territoryOf(item, doc.territories)?.snapshots.length && item.start) {
            setProgress(`Looking for ${item.title}’s borders on the historical maps…`);
            try {
              const wanted = { wikidataId: item.wikidataId ?? r.subject!.qid, titles: [r.key], names: [r.subject!.label ?? '', item.title] };
              ({ snapshots: snaps, source } = await bordersFor(wanted, item.start, item.end));
            } catch (e) {
              note = navigator.onLine ? (e as Error).message : 'You’re offline, so the historical maps can’t be searched.';
            }
          }
          const territory = polityTerritory(item, doc.territories, snaps, source);
          const bordered = territory.next.snapshots.length > 0;
          if (!bordered) missing.push({ id: territory.next.id, title: item.title });
          // With borders, the territory is where it is on the map; without, its pin stands in for now.
          const { places: _pin, ...rest } = item;
          b.add.push({ item: bordered ? rest : item, newSources: d.newSources, relations: d.relations, territory });
        } else b.add.push({ item: d.item, newSources: d.newSources, relations: d.relations });
        if (!('duplicateOf' in d)) names.push(d.item.title);
        else names.push(doc.items.find((i) => i.id === d.duplicateOf)?.title ?? r.title);
      }
      if (missing.length) setHeld({ b, names, ticks: chosenKeys, missing, note });
      else finish(b, names, chosenKeys);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  /** Put what was ticked in the doc, and show the year where a new polity's borders begin. */
  const finish = (b: Becoming, names: string[], ticks: string[], msg?: string) => {
    const { became } = addBecoming(doc, h.id, b);
    update((d) => addBecoming(d, h.id, b).doc);
    setTicked(({ [h.id]: _done, ...t }) => t);
    setHeld(null);
    setLast({ became, msg: msg ?? `Added ${inWords(names)} to your map and timeline.`, ticks });
    const polity = b.add.find((a) => a.territory);
    const at = polity?.territory?.next.snapshots[0]?.from ?? polity?.item.start;
    if (at) onShowYear?.(Math.round(toDecimalYear(at)));
  };

  /** Add the held polity, then draw its borders on the map: they last its whole life, until Bob edits them. */
  const drawBorders = (p: { id: string; title: string }) => {
    if (!held || !onDraw) return;
    const item = held.b.add.find((a) => a.territory?.next.id === p.id)?.item;
    finish(held.b, held.names, held.ticks, `Added ${inWords(held.names)} to your map and timeline. Draw ${p.title}’s borders on the map.`);
    onDraw((geometry, year) => update((d) => {
      const t = d.territories.find((x) => x.id === p.id);
      if (!t) return d;
      const from = item?.start ?? { y: year };
      const snap = { from, ...(item?.end ? { to: item.end } : {}), geometry, areaKm2: Math.round(areaKm2(geometry)) };
      return upsert(d, 'territories', { ...t, snapshots: [...t.snapshots, snap], source: { name: 'Drawn by me' } });
    }));
  };

  /** "Something else…": Bob's own entry, its place looked up on the map, saved like a ticked one. */
  const addOwn = async () => {
    if (!own) return;
    const lanes = own.lanes ?? h.lanes ?? [];
    const name = own.place.trim();
    const check = ownEntry({ ...own, lanes, place: undefined }, h, doc.categories[0]?.id ?? '');
    if ('problem' in check) { setOwnError(check.problem); return; }
    setBusy(true);
    setOwnError(null);
    // Found already as Bob typed it, or looked up now.
    const known = ownPlace?.query === name ? ownPlace : undefined;
    let place: Place | undefined = known?.place;
    let note = '';
    if (place) note = ` Pinned at ${place.name}.`;
    else if (known && !known.failed) note = ` Couldn’t find ${name} on the map, so it has no pin yet.`;
    else if (name && !navigator.onLine) note = ` You’re offline, so it has no pin yet; add ${name} in the editor later.`;
    else if (name) {
      try {
        const hit = (await lookUpPlace(name))[0];
        if (hit) { place = { name: hit.name, lat: hit.lat, lon: hit.lon, role: 'site' }; note = ` Pinned at ${hit.name}.`; }
        else note = ` Couldn’t find ${name} on the map, so it has no pin yet.`;
      } catch {
        note = ` Couldn’t look up ${name}, so it has no pin yet.`;
      }
    }
    setBusy(false);
    const made = ownEntry({ ...own, lanes, place }, h, doc.categories[0]?.id ?? '');
    if ('problem' in made) return;
    // The polity its place was in comes too, when ticked (only for the place it was looked up for).
    const polity = place && place === ownAt ? ownPolity.toAdd(doc.categories[0]?.id ?? '') : undefined;
    const b: Becoming = { link: [], add: [{ item: made.item }], ...(polity ? { alongside: [polity] } : {}) };
    const { became } = addBecoming(doc, h.id, b);
    update((d) => addBecoming(d, h.id, b).doc);
    setOwn(null);
    setLast({ became, msg: `Added ${inWords([made.item.title, ...(polity ? [polity.item.title] : [])])} to your map and timeline.${note}` });
    if (made.item.start) onShowYear?.(Math.round(toDecimalYear(made.item.start)));
  };

  const undoLast = () => {
    if (!last) return;
    update((d) => undoBecoming(d, last.became));
    // The ticks come back as they were, ready to add again.
    if (last.ticks) setTicked((t) => ({ ...t, [h.id]: last.ticks! }));
    setLast(null);
  };

  let actions: React.ReactNode;
  const keepOnly = used
    ? <button type="button" className="btn primary" onClick={() => marks.keep()}>Done</button>
    : <button type="button" className="btn primary" onClick={() => done('Kept as a highlight.')}>Keep the highlight</button>;
  const justKeep = used
    ? <button type="button" className="btn" onClick={() => marks.keep()}>Done</button>
    : <button type="button" className="btn" onClick={() => done('Kept as a highlight.')}>Just keep the highlight</button>;
  const count = toLink.length + toAdd.length;
  if (count === 0 || own) {
    actions = keepOnly;
  } else if (count === 1 && toLink.length) {
    const r = toLink[0];
    const named = r.have!.title;
    actions = (
      <>
        <button type="button" className="btn primary" onClick={() => {
          marks.setSubject(r.subject!.qid);
          const b: Becoming = { link: [{ id: r.have!.id, relations: kept(r) }], add: [] };
          update((d) => addBecoming(d, h.id, b).doc);
          done(`Linked to ${named}.`);
        }}>Link to {named}</button>
        {justKeep}
      </>
    );
  } else if (held) {
    // Its choices sit with the notice, under the list.
    actions = null;
  } else if (count === 1 && toAdd[0].subject?.kind !== 'polity') {
    const r = toAdd[0];
    const add = async () => {
      setBusy(true);
      setError(null);
      marks.setSubject(r.subject!.qid);
      try { await onAdd({ ...h, subjectQid: r.subject!.qid }, r.key); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    };
    actions = (
      <>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void add()}>{busy ? 'Reading Wikipedia…' : 'Add to map and timeline'}</button>
        {justKeep}
      </>
    );
  } else {
    actions = (
      <>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void addTicked()}>{busy ? 'Reading Wikipedia…' : count === 1 ? 'Add to map and timeline' : `Add ${count} to map and timeline`}</button>
        {justKeep}
      </>
    );
  }

  // ----- Claude, for what has no article of its own -----
  const set = drafts.sets[h.id];
  const suggested = set?.lanes?.map((l) => l.value) ?? [];
  const notPicked = suggested.filter((l) => !h.lanes?.includes(l));
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
                  onEdit={onEdit && (() => onEdit({ item: { ...e.item, ...(h.lanes?.length && !e.item.lanes?.length ? { lanes: h.lanes } : {}) }, newSources: e.newSources, highlight: h }))}
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

  // What the highlight is on besides the candidates and Claude's drafts: what Bob filled in himself.
  const shownIds = new Set([...rows.flatMap((r) => (r.have ? [r.have.id] : [])), ...(set?.entries.map((e) => e.item.id) ?? [])]);
  const others = h.usedBy.flatMap((id) => { const i = doc.items.find((x) => x.id === id); return i && !shownIds.has(id) ? [i] : []; });
  const none = rows.every((r) => !r.subject) && rows[0];
  const n = rows.length;
  const becomes = (
    <div className="becomes">
      <div className="lbl">Becomes <span>· {n === 1 ? 'the article’s subject' : `${n} in this passage`}, tick any</span></div>
      <div className="cands" role="group" aria-label="Becomes">
        {rows.map((r) => {
          const kind = r.subject?.kind;
          const what = r.state.status === 'loading' ? 'Looking up…'
            : r.state.status === 'offline' ? 'Needs a connection'
            : kind ? KIND_LABEL[kind] : 'Not sure what kind';
          const there = r.have && (r.ref?.type === 'territory' ? ' · in Chronicle as a territory' : r.have.title !== r.title ? ` · in Chronicle as ${r.have.title}` : '');
          const line = `${r.own ? `This article · ${what}` : what}${there || ''}${r.subject && r.cant ? ' · can’t be added yet' : ''}`;
          const on = isTicked(r);
          return (
            <div className="cand-item" key={r.key}>
              <div className="cand-row">
                <button
                  type="button"
                  className="cand"
                  role="checkbox"
                  aria-checked={on}
                  aria-disabled={r.linked || undefined}
                  data-cant={(!r.linked && !!r.cant) || undefined}
                  aria-label={`${r.have?.title ?? r.title}, ${line}${r.linked ? ', linked' : r.have ? ', in Chronicle' : ''}`}
                  data-kind={kind}
                  onClick={() => toggle(r)}
                >
                  <span className="tick" aria-hidden="true" />
                  <Glyph kind={kind} />
                  <span className="line">
                    <span className="ct">{r.have?.title ?? r.title}</span>
                    <span className="ck">{line}</span>
                  </span>
                  {r.linked ? <span className="tag linked">Linked</span> : r.have ? <span className="tag have">In Chronicle</span> : null}
                </button>
                {r.linked && r.ref && onOpenRecord && <button type="button" className="link open" onClick={() => onOpenRecord(r.ref!)} aria-label={`Open ${r.have!.title}`}>Open</button>}
              </div>
              {whyNot === r.key && r.cant && <p className="tray-note">{r.cant}{r.subject?.kind && CANT_ADD[r.subject.kind] ? '' : ' Your highlight is saved.'}</p>}
              {on && !r.linked && r.subject && details(r)}
            </div>
          );
        })}
        {others.map((i) => (
          <div className="cand-item" key={i.id}>
            <div className="cand-row">
              <button type="button" className="cand" role="checkbox" aria-checked aria-disabled aria-label={`${i.title}, ${ITEM_KIND[i.kind]}, linked`} data-kind={i.subject}>
                <span className="tick" aria-hidden="true" />
                <Glyph kind={i.subject} />
                <span className="line">
                  <span className="ct">{i.title}</span>
                  <span className="ck">{i.subject ? KIND_LABEL[i.subject] : ITEM_KIND[i.kind]}{i.start ? ` · ${formatItemDates(i)}` : ''}</span>
                </span>
                <span className="tag linked">Linked</span>
              </button>
              {onOpenRecord && <button type="button" className="link open" onClick={() => onOpenRecord({ type: 'item', id: i.id })} aria-label={`Open ${i.title}`}>Open</button>}
            </div>
          </div>
        ))}
        {!marks.readOnly && (
          <button type="button" className="cand other" aria-expanded={!!own} onClick={() => { setOwn((o) => (o ? null : { ...NO_FORM })); setOwnError(null); }}>
            <span className="tick plus" aria-hidden="true" />
            <span aria-hidden="true" />
            <span className="line">
              <span className="ct">Something else…</span>
              <span className="ck">Fill one in yourself</span>
            </span>
          </button>
        )}
      </div>
      {own && (
        <form className="own" aria-label="Something else" onSubmit={(e) => { e.preventDefault(); void addOwn(); }}>
          <label className="own-title">Title<input value={own.title} autoFocus onChange={(e) => setOwn({ ...own, title: e.target.value })} placeholder="Laurion silver pays for the fleet" /></label>
          <div className="segmented" role="group" aria-label="What is it?">
            {(['event', 'span', 'person'] as ItemKind[]).map((k) => (
              <button type="button" key={k} aria-pressed={own.kind === k} onClick={() => setOwn({ ...own, kind: k })}>{ITEM_KIND[k]}</button>
            ))}
          </div>
          <div className="own-dates">
            <label>{own.kind === 'person' ? 'Born' : own.kind === 'span' ? 'Starts' : 'When'}<input value={own.start} onChange={(e) => setOwn({ ...own, start: e.target.value })} placeholder="483 BCE" /></label>
            {own.kind !== 'event' && <label>{own.kind === 'person' ? 'Died' : 'Ends'}<input value={own.end} onChange={(e) => setOwn({ ...own, end: e.target.value })} placeholder={own.kind === 'person' ? 'Blank if living' : '404 BCE'} /></label>}
          </div>
          <label className="own-place">Place<input value={own.place} onChange={(e) => setOwn({ ...own, place: e.target.value })} placeholder="Where it happened, if anywhere" /></label>
          <PlacePolity state={ownPolity} />
          <LaneChips label="Its lanes" value={own.lanes ?? h.lanes} onToggle={(l) => {
            const cur = own.lanes ?? h.lanes ?? [];
            setOwn({ ...own, lanes: cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l] });
          }} />
          {ownError && <div className="notice bad" role="alert">{ownError}</div>}
          <div className="own-acts">
            <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Finding the place…' : 'Add to map and timeline'}</button>
            <button type="button" className="btn" onClick={() => { setOwn(null); setOwnError(null); }}>Cancel</button>
          </div>
        </form>
      )}
      {none && (
        <p className="tray-note" aria-busy={none.state.status === 'loading'}>
          {none.state.status === 'loading' && `Looking up what this article is about…`}
          {none.state.status === 'offline' && `You’re offline. What this article is about will show when you’re back online. Your highlight is saved.`}
          {none.state.status === 'unknown' && n === 1 && `Wikidata doesn’t say what this article is about, so there’s nothing to add to the map from it. Your highlight is saved.`}
        </p>
      )}
      {rows.some((r) => isTicked(r) && !r.linked && r.subject && subjectFacts(r.subject).length) && (
        <p className="tray-note">
          All of this comes from Wikidata{rows.some((r) => isTicked(r) && r.subject && subjectFacts(r.subject).some((f) => f.values.some((v) => inChronicle(v.qid)))) ? '; underlined names are already in Chronicle' : ''}.
        </p>
      )}
      {progress && <p className="tray-note" role="status">{progress}</p>}
      {held && (
        <div className="no-borders" data-testid="no-borders">
          {/* A polity the historical maps don't have: draw its borders, or add it without them for now. */}
          <p className="notice" role="status">
            {held.note ?? `The historical maps don’t have ${inWords(held.missing.map((m) => `${m.title}’s`))} borders.`}
            {' '}{held.missing.length === 1 && onDraw ? 'Draw them on the map, or add it without borders for now.' : 'Add without borders for now, and draw them from the territory later.'}
          </p>
          <div className="own-acts">
            {held.missing.length === 1 && onDraw && <button type="button" className="btn primary" onClick={() => drawBorders(held.missing[0])}>Draw its borders</button>}
            <button type="button" className={held.missing.length === 1 && onDraw ? 'btn' : 'btn primary'} onClick={() => finish(held.b, held.names, held.ticks)}>Add without borders yet</button>
            <button type="button" className="btn" onClick={() => setHeld(null)}>Cancel</button>
          </div>
        </div>
      )}
      {last && (
        <p className="tray-done" role="status">
          {last.msg} <button type="button" className="link" onClick={undoLast}>Undo</button>
        </p>
      )}
    </div>
  );

  return (
    <div ref={tray} className="tray" data-testid="capture-tray">
      <article ref={card} className="tray-card" aria-label="Highlight" style={{ '--c': pigment(h.lanes?.[0]) } as React.CSSProperties}>
        <blockquote className="q">“{h.text}”</blockquote>
        <p className="src">{articleTitle}{section ? ` › ${section}` : ''}</p>
        {becomes}
        <div className="dimpick">
          <span className="lbl">Lanes</span>
          <LaneChips value={h.lanes} suggested={suggested} disabled={marks.readOnly} onToggle={marks.toggleLane} />
          {notPicked.length > 0 && <p className="dn"><em>Claude suggests {lanesInWords(notPicked)}</em> · pick {notPicked.length === 1 ? 'it' : 'them'} to use {notPicked.length === 1 ? 'it' : 'them'}</p>}
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
