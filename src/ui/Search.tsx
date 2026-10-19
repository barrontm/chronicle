import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { search, type SearchHit } from '../model/search';
import { useDoc } from './DocContext';
import { Glyph } from './reader/Glyph';

const TYPE_LABEL: Record<SearchHit['type'], string> = { item: 'Entry', territory: 'Territory', note: 'Note', source: 'Source', highlight: 'Highlight' };

const editable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/**
 * The search box in the top bar, over everything in the doc (so it works offline). On a phone it's a
 * Search button that opens the box across the top bar. `/` focuses it on a laptop.
 */
export function Search({ narrow, onPick }: { narrow: boolean; onPick: (hit: SearchHit) => void }) {
  const { doc } = useDoc();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const hits = useMemo(() => search(doc, query), [doc, query]);
  const showList = open && query.trim() !== '';

  useEffect(() => {
    if (narrow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || editable(e.target)) return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [narrow]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const close = () => { setOpen(false); setQuery(''); setPhoneOpen(false); input.current?.blur(); };
  const pick = (h: SearchHit) => { close(); onPick(h); };

  if (narrow && !phoneOpen) {
    return (
      <button className="btn quiet search-open" aria-label="Search Chronicle" title="Search" onClick={() => { setPhoneOpen(true); setOpen(true); }}>
        <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><circle cx="7.5" cy="7.5" r="5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="m11.3 11.3 4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </button>
    );
  }

  return (
    <div ref={box} className={`search ${narrow ? 'phone' : ''}`}>
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-label="Search Chronicle"
        aria-expanded={showList}
        aria-controls={`${id}-list`}
        aria-activedescendant={showList && hits[active] ? `${id}-${active}` : undefined}
        aria-autocomplete="list"
        placeholder={narrow ? 'Search entries, notes, highlights' : 'Search'}
        title={narrow ? undefined : 'Search (press /)'}
        autoFocus={narrow}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); close(); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && hits[active]) { e.preventDefault(); pick(hits[active]); }
        }}
      />
      {narrow && <button className="btn small quiet" onClick={close}>Cancel</button>}
      {showList && (
        <ul className="search-results" role="listbox" id={`${id}-list`} aria-label="Search results" data-testid="search-results">
          {hits.length === 0 && <li className="search-empty">Nothing in Chronicle matches “{query.trim()}”.</li>}
          {hits.map((h, i) => (
            <li
              key={`${h.type}-${h.id}`}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              className="search-hit"
              onPointerDown={(e) => e.preventDefault()}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(h)}
            >
              <span className="search-mark">{h.subject ? <Glyph kind={h.subject} /> : <span className="search-type">{TYPE_LABEL[h.type]}</span>}</span>
              <span className="search-main">
                <span className="search-title">{h.title}</span>
                {h.when && <span className="search-when">{h.when}</span>}
                {h.snippet && <span className="search-snippet">{h.snippet}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
