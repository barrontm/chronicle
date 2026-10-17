import type { DraftConnection, DraftEntry, DraftStatus } from '../../ai/draft';
import { formatRange } from '../../model/dates';
import { describeRelation } from '../../model/doc';
import type { ItemKind } from '../../model/types';
import { useDoc } from '../DocContext';
import { Glyph, type GlyphKind } from '../reader/Glyph';

/**
 * One drafted record waiting for Bob, as a dashed card: what it is, the words
 * it rests on, and Accept, Edit, Reject. Shared by Draft with AI and the
 * reader's tray. Accepted cards turn solid; rejected ones fade, struck through.
 */
interface Acts {
  onAccept: () => void;
  onReject: () => void;
  /** Bring back a rejected record. */
  onRestore: () => void;
  /** Take back an accepted record. */
  onUndo?: () => void;
  onOpen?: () => void;
}

const KIND: Record<ItemKind, { label: string; glyph: GlyphKind }> = {
  event: { label: 'Event', glyph: 'event' },
  span: { label: 'Period', glyph: 'period' },
  person: { label: 'Person', glyph: 'person' },
};

export function DraftEntryRow({ entry, status, onEdit, ...acts }: Acts & { entry: DraftEntry; status: DraftStatus; onEdit?: () => void }) {
  const { item } = entry;
  const place = item.places?.[0];
  return (
    <li className={`drow ${status}`} data-testid="draft-entry">
      <Glyph kind={KIND[item.kind].glyph} />
      <div>
        <div className="t">{item.title}</div>
        <div className="m">
          {KIND[item.kind].label} · {item.start ? formatRange(item.start, item.end) : 'No date'}
          {place && <> · {place.name} <i>({item.wikidataId ? 'from Wikidata' : 'looked up on Wikipedia'})</i></>}
        </div>
        {entry.quote ? <p className="ev"><q>{entry.quote}</q></p> : entry.why && <p className="ev why">Claude: {entry.why}</p>}
        {entry.problems.map((p) => <p key={p} className="bad">{p}</p>)}
        <Actions status={status} what={item.places?.length ? 'Added · on the map and timeline' : 'Added · on the timeline'} acts={acts} blocked={entry.problems.length > 0}>
          {onEdit && <button type="button" onClick={onEdit}>Edit</button>}
        </Actions>
      </div>
    </li>
  );
}

/** A drafted connection: "from ⟨effect⟩ to". Ends Bob has are underlined; drafted ends are dashed until accepted. */
export function DraftConnectionRow({ c, status, entries, ...acts }: Acts & { c: DraftConnection; status: DraftStatus; entries: DraftEntry[] }) {
  const { doc } = useDoc();
  const r = c.relation;
  const end = (id: string) => {
    const have = doc.items.find((i) => i.id === id);
    if (have) return <span className="end have">{have.title}</span>;
    return <span className="end draft">{entries.find((e) => e.item.id === id)?.item.title ?? 'Missing entry'}</span>;
  };
  const missing = [r.fromId, r.toId].filter((id) => !doc.items.some((i) => i.id === id)).length;
  const note = missing === 2 ? 'Accept both entries first.' : missing ? 'Accept the entry first.' : undefined;
  return (
    <li className={`drow ${status}`} data-testid="draft-connection">
      <Glyph kind="connection" />
      <div>
        <div className="t">{end(r.fromId)} <span className="eff">{r.effect || describeRelation(r.type, 'out').toLowerCase()}</span> {end(r.toId)}</div>
        <div className="m">Connection{r.highlightIds?.length ? ' · cites your highlight as evidence' : ''}</div>
        {c.quote && <p className="ev"><q>{c.quote}</q></p>}
        <Actions status={status} what="Added" acts={acts} blocked={!!note} note={note} />
      </div>
    </li>
  );
}

function Actions({ status, what, acts, blocked, note, children }: { status: DraftStatus; what: string; acts: Acts; blocked: boolean; note?: string; children?: React.ReactNode }) {
  if (status === 'accepted') {
    return (
      <div className="acts">
        <span className="state">{what}</span>
        {acts.onOpen && <button type="button" className="quiet" onClick={acts.onOpen}>Open</button>}
        {acts.onUndo && <button type="button" className="quiet" onClick={acts.onUndo}>Undo</button>}
      </div>
    );
  }
  if (status === 'rejected') {
    return (
      <div className="acts">
        <span className="state">Left out</span>
        <button type="button" className="quiet" onClick={acts.onRestore}>Undo</button>
      </div>
    );
  }
  return (
    <div className="acts">
      <button type="button" className="primary" disabled={blocked} onClick={acts.onAccept}>Accept</button>
      {children}
      <button type="button" className="quiet" onClick={acts.onReject}>Reject</button>
      {note && <small>{note}</small>}
    </div>
  );
}

/** What the checker left out of a draft, folded. */
export function DroppedList({ dropped }: { dropped: string[] }) {
  if (!dropped.length) return null;
  return (
    <details className="draft-dropped">
      <summary>Left out by the checker ({dropped.length})</summary>
      <ul>{dropped.map((d) => <li key={d}>{d}</li>)}</ul>
    </details>
  );
}
