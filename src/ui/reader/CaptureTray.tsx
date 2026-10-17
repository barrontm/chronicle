import { useLayoutEffect, useRef, useState } from 'react';
import { KIND_LABEL, findInChronicle, subjectFacts } from '../../model/subjects';
import { DIMENSIONS, type Dimension, type Highlight } from '../../model/types';
import { useDoc } from '../DocContext';
import { DIMENSION_LABEL } from '../util';
import { Glyph } from './Glyph';
import type { RecordRef } from './ReaderPane';
import { PIGMENT, type useHighlighting } from './useHighlighting';
import type { SubjectState } from './useSubject';

type Marks = ReturnType<typeof useHighlighting>;

const pigment = (d?: Dimension) => `var(--pig-${PIGMENT[d ?? 'none']})`;

/**
 * The capture tray under the reader's text. With a highlight open it shows
 * the card: the quote, what the article is, its facts, a dimension and what
 * to do with it. Otherwise one line counts the article's highlights. Closing
 * the card, or moving on, keeps the highlight as it is.
 */
export function CaptureTray({ marks, subject, articleTitle, onAdd, onOpenRecord }: {
  marks: Marks;
  subject: SubjectState;
  articleTitle: string;
  /** Draft the article's subject as an entry citing this highlight. Throws with a message Bob can read. */
  onAdd: (h: Highlight) => Promise<void>;
  onOpenRecord?: (r: RecordRef) => void;
}) {
  const { doc } = useDoc();
  const tray = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = marks.open;
  const openId = open?.highlight.id;

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

  let body: React.ReactNode;
  let actions: React.ReactNode;
  const keepOnly = <button type="button" className="btn primary" onClick={() => done('Kept as a highlight.')}>Keep the highlight</button>;
  const justKeep = <button type="button" className="btn" onClick={() => done('Kept as a highlight.')}>Just keep the highlight</button>;

  if (subject.status !== 'ready') {
    body = (
      <p className="tray-note" aria-busy={subject.status === 'loading'}>
        {subject.status === 'loading' && 'Looking up what this article is about…'}
        {subject.status === 'offline' && 'You’re offline. What this article is about will show when you’re back online. Your highlight is saved.'}
        {subject.status === 'unknown' && 'Wikidata doesn’t say what this article is about, so there’s nothing to add to the map from it. Your highlight is saved.'}
      </p>
    );
    actions = keepOnly;
  } else {
    const s = subject.subject;
    const item = findInChronicle(doc.items, s.qid);
    const territory = item ? undefined : findInChronicle(doc.territories, s.qid);
    const have = item ?? territory;
    const ref: RecordRef | undefined = have && { type: item ? 'item' : 'territory', id: have.id };
    const linked = !!have && h.usedBy.includes(have.id);
    const title = have?.title ?? s.label ?? articleTitle;
    const facts = subjectFacts(s);
    const inChronicle = (qid?: string) => !!qid && !!(findInChronicle(doc.items, qid) ?? findInChronicle(doc.territories, qid));
    const kind = s.kind ? KIND_LABEL[s.kind] : 'Not sure what kind';
    body = (
      <>
        <div className="becomes" data-kind={s.kind}>
          <Glyph kind={s.kind} />
          <div>
            <span className="kind">{have ? 'Already in Chronicle' : 'Becomes'} · {kind}</span>
            <strong>{title}</strong>
          </div>
          <span className={`tag ${have ? 'have' : ''}`}>{have ? 'In Chronicle' : 'Wikidata'}</span>
        </div>
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
          {linked ? `This highlight is on ${title}.`
            : s.kind === 'place' && !have ? 'A place on its own isn’t an event. Keep the highlight, or highlight what happened there.'
            : facts.length ? `All of this comes from Wikidata${facts.some((f) => f.values.some((v) => inChronicle(v.qid))) ? '; underlined names are already in Chronicle' : ''}.`
            : 'Wikidata gives no dates or places for this.'}
        </p>
      </>
    );
    if (linked) {
      actions = (
        <>
          {ref && onOpenRecord && <button type="button" className="btn primary" onClick={() => onOpenRecord(ref)}>Open {title}</button>}
          <button type="button" className="btn" onClick={() => marks.keep()}>Done</button>
        </>
      );
    } else if (have) {
      actions = (
        <>
          <button type="button" className="btn primary" onClick={() => { marks.link(have.id); done(`Linked to ${title}.`); }}>Link to {title}</button>
          {justKeep}
        </>
      );
    } else if (!s.kind || s.kind === 'place') {
      actions = keepOnly;
    } else {
      const add = async () => {
        setBusy(true);
        setError(null);
        try { await onAdd(h); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      };
      actions = (
        <>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void add()}>{busy ? 'Reading Wikipedia…' : 'Add to map and timeline'}</button>
          {justKeep}
        </>
      );
    }
  }

  return (
    <div ref={tray} className="tray" data-testid="capture-tray">
      <article className="tray-card" aria-label="Highlight" style={{ '--c': pigment(h.dimension) } as React.CSSProperties}>
        <blockquote className="q">“{h.text}”</blockquote>
        <p className="src">{articleTitle}{section ? ` › ${section}` : ''}</p>
        {body}
        <div className="dimpick" role="group" aria-label="Dimension">
          <span className="lbl">Dimension</span>
          {DIMENSIONS.map((d) => (
            <button
              type="button"
              key={d}
              style={{ '--d': pigment(d) } as React.CSSProperties}
              title={DIMENSION_LABEL[d]}
              aria-label={DIMENSION_LABEL[d]}
              aria-pressed={h.dimension === d}
              disabled={marks.readOnly}
              onClick={() => marks.setDimension(h.dimension === d ? undefined : d)}
            ><i /></button>
          ))}
          <span className="dn">{h.dimension ? DIMENSION_LABEL[h.dimension] : 'None yet'}</span>
        </div>
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
