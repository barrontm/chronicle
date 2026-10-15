import { cloneElement, isValidElement, useId, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { formatHistDate, parseHistDate, toInputString } from '../model/dates';
import type { Citation, HistDate, TimelineDoc } from '../model/types';
import { formatCitation } from './util';

/**
 * A labeled control. The label is tied to the control by id and the hint by
 * aria-describedby, so assistive tech (and tests) see the label as the name.
 * Pass a single form control as the child; anything else is wrapped as-is.
 */
export function Field({ label, children, hint, hintTone }: { label: string; children: ReactNode; hint?: ReactNode; hintTone?: 'ok' | 'bad' }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const control = isValidElement(children) && typeof children.type === 'string' && ['input', 'select', 'textarea'].includes(children.type)
    ? cloneElement(children as ReactElement<{ id?: string; 'aria-describedby'?: string }>, { id, 'aria-describedby': hint ? hintId : undefined })
    : children;
  const isControl = control !== children;
  return (
    <div className="field">
      {isControl ? <label htmlFor={id}>{label}</label> : <span id={id}>{label}</span>}
      {isControl ? control : <div role="group" aria-labelledby={id}>{children}</div>}
      {hint && <small className={`hint ${hintTone ?? ''}`} id={hintId}>{hint}</small>}
    </div>
  );
}

/** Text input that understands "431 BCE", "c. 1440", "1914-07-28" and shows how it was read. */
export function DateField({ label, value, onChange, optional }: {
  label: string;
  value: HistDate | undefined;
  onChange: (d: HistDate | undefined, valid: boolean) => void;
  optional?: boolean;
}) {
  const [text, setText] = useState(value ? toInputString(value) : '');
  const parsed = text.trim() ? parseHistDate(text) : undefined;
  const bad = text.trim() !== '' && !parsed;
  const hint = bad
    ? 'Try 1914, 1914-07-28, 431 BCE or c. 1440'
    : parsed
      ? `Reads as ${formatHistDate(parsed)}`
      : optional ? 'Leave empty if unknown or ongoing' : 'Required';
  return (
    <Field label={label} hint={hint} hintTone={bad ? 'bad' : parsed ? 'ok' : undefined}>
      <input
        value={text}
        placeholder="e.g. 431 BCE"
        aria-invalid={bad || (!optional && !parsed)}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          const p = t.trim() ? parseHistDate(t) : undefined;
          onChange(p ?? undefined, t.trim() === '' ? !!optional : !!p);
        }}
      />
    </Field>
  );
}

/** Search-as-you-type picker over items (and optionally series). */
export function RecordPicker({ doc, onPick, exclude = [], placeholder = 'Search your timeline…', includeSeries = false }: {
  doc: TimelineDoc;
  onPick: (id: string) => void;
  exclude?: string[];
  placeholder?: string;
  includeSeries?: boolean;
}) {
  const [q, setQ] = useState('');
  const listId = useId();
  const options = useMemo(() => {
    const all = [
      ...doc.items.map((i) => ({ id: i.id, label: i.title, sub: formatHistDate(i.start) })),
      ...(includeSeries ? doc.series.map((s) => ({ id: s.id, label: s.title, sub: 'Trend' })) : []),
    ].filter((o) => !exclude.includes(o.id));
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((o) => o.label.toLowerCase().includes(needle)).slice(0, 12) : [];
  }, [doc, q, exclude, includeSeries]);

  return (
    <div>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-controls={listId} />
      {q.trim() && (
        <div className="picker-pop" id={listId} role="listbox">
          {options.length === 0 && <div className="notice">Nothing matches “{q}”. Add it to your timeline first.</div>}
          {options.map((o) => (
            <button key={o.id} type="button" role="option" aria-selected={false} onClick={() => { onPick(o.id); setQ(''); }}>
              {o.label} <small style={{ color: 'var(--muted)' }}>{o.sub}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Edit a list of citations: pick a source, add pages; or start a new source. */
export function CitationsEditor({ doc, value, onChange, onNewSource }: {
  doc: TimelineDoc;
  value: Citation[];
  onChange: (c: Citation[]) => void;
  onNewSource: () => void;
}) {
  const [pick, setPick] = useState('');
  const byId = new Map(doc.sources.map((s) => [s.id, s]));
  return (
    <div>
      <div className="editor-list">
        {value.map((c, i) => (
          <div className="editor-row" key={`${c.sourceId}-${i}`}>
            <span className="grow citation">{formatCitation(byId.get(c.sourceId), { sourceId: c.sourceId })}</span>
            <input
              className="input"
              style={{ width: 110 }}
              placeholder="pp. 12–15"
              aria-label="Pages or location"
              value={c.locator ?? ''}
              onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, locator: e.target.value || undefined } : x)))}
            />
            <button type="button" className="btn small quiet" aria-label="Remove citation" onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
      </div>
      <div className="editor-row">
        <select className="input grow" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Source to cite">
          <option value="">{doc.sources.length ? 'Cite a source…' : 'No sources yet'}</option>
          {doc.sources.map((s) => <option key={s.id} value={s.id}>{s.title}{s.authors ? ` — ${s.authors}` : ''}</option>)}
        </select>
        <button type="button" className="btn small" disabled={!pick} onClick={() => { onChange([...value, { sourceId: pick }]); setPick(''); }}>Cite</button>
        <button type="button" className="btn small quiet" onClick={onNewSource}>New source</button>
      </div>
    </div>
  );
}
