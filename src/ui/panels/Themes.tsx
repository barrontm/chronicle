import { useState } from 'react';
import { jsDateToDecimalYear } from '../../model/dates';
import { eraTerritory, newId, setEraTerritory, upsert } from '../../model/doc';
import { eraHighlights, eraRegions } from '../../model/eras';
import type { Highlight, Theme, TimelineItem } from '../../model/types';
import { useDoc } from '../DocContext';
import { Field } from '../fields';
import { LANE_LABEL, PIGMENT } from '../util';

/**
 * A period's themes (docs/design.md, Overview): what Bob read about in it, each a short label over
 * some of its highlights. They are its chips on the overview and along the top of its lanes.
 */
export function ThemesSection({ item }: { item: TimelineItem }) {
  const { doc, update } = useDoc();
  const [editing, setEditing] = useState<Theme | 'new' | null>(null);
  const now = jsDateToDecimalYear(new Date());
  const chips = eraRegions(doc.items, doc.highlights, doc.relations, now).flatMap((R) => R.eras).find((e) => e.id === item.id)?.themes ?? [];
  const themes = item.themes ?? [];
  const save = (next: Theme[]) => update((d) => {
    const cur = d.items.find((i) => i.id === item.id);
    return cur ? upsert(d, 'items', { ...cur, themes: next.length ? next : undefined }) : d;
  });

  return (
    <section data-testid="themes">
      <h3>Themes</h3>
      {themes.length === 0 && editing === null && <p className="hint" style={{ color: 'var(--muted)' }}>None yet. Group what you highlighted here under a short label, such as “The Parthenon”.</p>}
      <ul className="linklist">
        {themes.map((t) => {
          const c = chips.find((x) => x.id === t.id);
          return editing !== null && editing !== 'new' && editing.id === t.id ? (
            <li key={t.id}><ThemeForm item={item} theme={t} onSave={(x) => { save(themes.map((o) => (o.id === t.id ? x : o))); setEditing(null); }} onCancel={() => setEditing(null)} onRemove={() => { save(themes.filter((o) => o.id !== t.id)); setEditing(null); }} /></li>
          ) : (
            <li key={t.id}>
              <button onClick={() => setEditing(t)} aria-label={`Edit the theme ${t.label}`}>
                <strong><span className="lane-square" style={{ background: `var(--pig-${PIGMENT[c?.lane ?? 'none']})` }} />{t.label}</strong>
                <small>{t.highlightIds.length === 1 ? '1 highlight' : `${t.highlightIds.length} highlights`}{c?.lane ? ` · mostly ${LANE_LABEL[c.lane].toLowerCase()}` : ''}</small>
              </button>
            </li>
          );
        })}
      </ul>
      {editing === 'new'
        ? <ThemeForm item={item} onSave={(x) => { save([...themes, x]); setEditing(null); }} onCancel={() => setEditing(null)} />
        : editing === null && <button className="btn small" onClick={() => setEditing('new')}>Add a theme</button>}
      <EraPlace item={item} />
    </section>
  );
}

function ThemeForm({ item, theme, onSave, onCancel, onRemove }: { item: TimelineItem; theme?: Theme; onSave: (t: Theme) => void; onCancel: () => void; onRemove?: () => void }) {
  const { doc } = useDoc();
  const [label, setLabel] = useState(theme?.label ?? '');
  const [picked, setPicked] = useState<string[]>(theme?.highlightIds ?? []);
  const inEra = eraHighlights(doc.items, doc.highlights, doc.relations, item.id, jsDateToDecimalYear(new Date()));
  const toggle = (h: Highlight) => setPicked((p) => (p.includes(h.id) ? p.filter((x) => x !== h.id) : [...p, h.id]));
  const ok = label.trim().length > 0;
  return (
    <form className="theme-form" data-testid="theme-form" onSubmit={(e) => { e.preventDefault(); if (ok) onSave({ ...theme, id: theme?.id ?? newId('t'), label: label.trim(), highlightIds: inEra.filter((h) => picked.includes(h.id)).map((h) => h.id) }); }}>
      <Field label="Theme"><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="The Parthenon" autoFocus /></Field>
      <Field label="Highlights in it">
        {inEra.length === 0
          ? <p className="hint" style={{ color: 'var(--muted)' }}>Nothing highlighted in this period yet. Highlights you add while reading show here.</p>
          : (
            <ul className="theme-highlights">
              {inEra.map((h) => (
                <li key={h.id}>
                  <label>
                    <input type="checkbox" checked={picked.includes(h.id)} onChange={() => toggle(h)} />
                    <span>“{h.text.length > 110 ? `${h.text.slice(0, 110)}…` : h.text}”</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
      </Field>
      <div className="row">
        <button className="btn small primary" type="submit" disabled={!ok}>{theme ? 'Save theme' : 'Add theme'}</button>
        <button className="btn small quiet" type="button" onClick={onCancel}>Cancel</button>
        {onRemove && <button className="btn small quiet danger" type="button" onClick={onRemove}>Remove theme</button>}
      </div>
    </form>
  );
}

/** Where the period is tinted on the map: where its entries are, or one of Bob's territories. */
function EraPlace({ item }: { item: TimelineItem }) {
  const { doc, update } = useDoc();
  const picked = eraTerritory(doc, item.id);
  return (
    <Field label="Where on the map" hint="The map tints this period over its place in its years.">
      <select value={picked?.id ?? ''} onChange={(e) => update((d) => setEraTerritory(d, item.id, e.target.value || undefined))}>
        <option value="">Where its entries are</option>
        {[...doc.territories].sort((a, b) => a.title.localeCompare(b.title)).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
      </select>
    </Field>
  );
}
