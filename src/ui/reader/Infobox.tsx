import { useLayoutEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useStored } from '../useStored';

/** The article's infobox, wrapped so it can fold to one line. */
interface Box {
  box: HTMLElement;
  /** Where the header goes: inside the article, so it sits where the infobox does. */
  head: HTMLElement;
  picture: string | null;
  rows: number;
}

const BODY_ID = 'reader-infobox';

/**
 * Wraps the first infobox in the article's HTML and gives it a header that
 * folds it. Only classes and wrappers are added, never text, so highlights
 * anchor as before; the header carries `data-ui`, which the text model skips.
 */
function useInfobox(body: RefObject<HTMLElement | null>, html: string | undefined): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    const table = html ? body.current?.querySelector<HTMLTableElement>('table.infobox') : null;
    if (!table) { setBox(null); return; }
    const inner = table.parentElement?.classList.contains('tbl') ? table.parentElement : table;
    inner.id = BODY_ID;
    inner.classList.add('ibox-body');
    const wrap = document.createElement('div');
    wrap.className = 'ibox';
    const head = document.createElement('div');
    head.setAttribute('data-ui', '');
    inner.before(wrap);
    wrap.append(head, inner);

    let picture: string | null = null;
    let rows = 0;
    // Nested tables too: military infoboxes keep their date and place rows in one.
    for (const tr of Array.from(table.querySelectorAll('tr'))) {
      const img = tr.querySelector('img');
      const cells = Array.from(tr.cells);
      if (cells.length === 1) {
        if (img && !picture) { picture = img.currentSrc || img.src; tr.classList.add('ibox-pic'); }
        // The infobox's name repeats the article's title.
        else if (rows === 0 && !picture && cells[0].tagName === 'TH') tr.classList.add('ibox-title');
        else tr.classList.add('ibox-wide');
      } else if (cells[0].tagName === 'TH') rows++;
      else tr.classList.add('ibox-pair'); // side by side, such as a war's two sides
    }
    setBox({ box: wrap, head, picture, rows });
  }, [body, html]);
  return box;
}

function summary(picture: boolean, rows: number): string {
  const r = rows === 1 ? '1 row' : rows > 0 ? `${rows} rows` : '';
  return [picture ? 'picture' : '', r].filter(Boolean).join(' and ');
}

/** The infobox folded to one line (its picture, "Infobox", Show); open, its picture beside its rows. Remembered on this device. */
export function InfoboxFold({ body, html }: { body: RefObject<HTMLElement | null>; html: string | undefined }) {
  const box = useInfobox(body, html);
  const [open, setOpen] = useStored<boolean>('chronicle.infoboxOpen', () => false);
  useLayoutEffect(() => { box?.box.classList.toggle('open', open); }, [box, open]);
  if (!box) return null;
  const what = summary(!!box.picture, box.rows);
  return createPortal(
    <button className="ibox-head" type="button" aria-expanded={open} aria-controls={BODY_ID} onClick={() => setOpen(!open)}>
      {box.picture
        ? <img className="ibox-thumb" src={box.picture} alt="" />
        : (
          <span className="ibox-thumb" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M2 12l4-4 3 3 2-2 3 3" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
          </span>
        )}
      <span><span className="ibox-label">Infobox</span>{what && <span className="ibox-what"> · {what}</span>}</span>
      <span className="ibox-chev">
        {open ? 'Hide' : 'Show'}
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </span>
    </button>,
    box.head,
  );
}
