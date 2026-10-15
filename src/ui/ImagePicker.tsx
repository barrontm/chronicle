import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { newId } from '../model/doc';
import type { MediaRef } from '../model/types';
import { resultToMedia, searchCommons, type CommonsResult } from '../media/commons';
import { shrinkImage } from '../media/localImage';
import { useDoc } from './DocContext';
import { Field } from './fields';

type Tab = 'commons' | 'link' | 'upload';

/**
 * Add a picture of an artifact, monument, person or artwork. Three ways:
 * search Wikimedia Commons (credit and license come along), paste an image
 * link, or upload a file (stored on this device).
 */
export function ImagePicker({ open, initialQuery, onClose, onAdd }: {
  open: boolean;
  initialQuery: string;
  onClose: () => void;
  onAdd: (m: MediaRef) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { putMedia } = useDoc();
  const [tab, setTab] = useState<Tab>('commons');
  const [q, setQ] = useState(initialQuery);
  const [results, setResults] = useState<CommonsResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState({ url: '', caption: '', credit: '', license: '', sourceUrl: '' });

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setQ(initialQuery);
      setResults(null);
      setError(null);
    }
    if (!open && d.open) d.close();
  }, [open, initialQuery]);

  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setResults(await searchCommons(q.trim()));
    } catch (e) {
      setError(navigator.onLine ? (e as Error).message : 'You’re offline. Searching Wikimedia Commons needs a connection; you can still upload a file.');
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await shrinkImage(file);
      const localId = await putMedia(blob);
      onAdd({ id: newId('md'), source: 'local', localId, caption: file.name.replace(/\.[^.]+$/, '') });
      onClose();
    } catch (e) {
      setError((e as Error).message || 'That file couldn’t be read as an image.');
    } finally {
      setBusy(false);
    }
  };

  // Portal: the picker opens from inside the entry form, and forms can't nest.
  // React also bubbles synthetic events through portals, so inner submits stop propagation.
  return createPortal(
    <dialog ref={ref} onClose={onClose} aria-labelledby="img-title">
      <h2 id="img-title">Add a picture</h2>
      <div className="segmented" role="group" aria-label="Where the picture comes from">
        <button type="button" aria-pressed={tab === 'commons'} onClick={() => setTab('commons')}>Wikimedia Commons</button>
        <button type="button" aria-pressed={tab === 'link'} onClick={() => setTab('link')}>Image link</button>
        <button type="button" aria-pressed={tab === 'upload'} onClick={() => setTab('upload')}>Upload</button>
      </div>

      {tab === 'commons' && (
        <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void search(); }} style={{ marginTop: 12 }}>
          <div className="editor-row">
            <input className="input grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rosetta Stone, Parthenon, bust of Aristotle…" aria-label="Search Wikimedia Commons" autoFocus />
            <button className="btn primary" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
          </div>
          <small className="hint" style={{ color: 'var(--muted)' }}>Free-licensed images from museums, archives and photographers. Credit and license are saved with the picture.</small>
          {results && results.length === 0 && <div className="notice">No pictures found for “{q}”. Try a shorter or different name.</div>}
          {results && results.length > 0 && (
            <div className="results" data-testid="commons-results">
              {results.map((r) => (
                <button type="button" className="result" key={r.sourceUrl} onClick={() => { onAdd(resultToMedia(r)); onClose(); }} title={r.description ?? r.title}>
                  <img src={r.thumbUrl} alt="" loading="lazy" />
                  <span>{r.title}</span>
                  <span>{r.license ?? 'License unknown'}</span>
                </button>
              ))}
            </div>
          )}
        </form>
      )}

      {tab === 'link' && (
        <form
          style={{ marginTop: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation(); // React bubbles portal events to the entry form behind us
            if (!link.url.trim()) return;
            onAdd({
              id: newId('md'), source: 'url', url: link.url.trim(),
              caption: link.caption || undefined, credit: link.credit || undefined,
              license: link.license || undefined, sourceUrl: link.sourceUrl || undefined,
            });
            onClose();
          }}
        >
          <Field label="Image address"><input type="url" required value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} placeholder="https://…/image.jpg" /></Field>
          <Field label="Caption"><input value={link.caption} onChange={(e) => setLink({ ...link, caption: e.target.value })} /></Field>
          <div className="row">
            <Field label="Credit"><input value={link.credit} onChange={(e) => setLink({ ...link, credit: e.target.value })} placeholder="Photographer, museum…" /></Field>
            <Field label="License"><input value={link.license} onChange={(e) => setLink({ ...link, license: e.target.value })} placeholder="CC BY 4.0" /></Field>
          </div>
          <Field label="Page it came from"><input type="url" value={link.sourceUrl} onChange={(e) => setLink({ ...link, sourceUrl: e.target.value })} /></Field>
          <button className="btn primary">Add picture</button>
        </form>
      )}

      {tab === 'upload' && (
        <div style={{ marginTop: 12 }}>
          <Field label="Choose an image file" hint="Stored on this device and shrunk to a sensible size. Works offline.">
            <input type="file" accept="image/*" onChange={(e) => void upload(e.target.files?.[0])} disabled={busy} />
          </Field>
        </div>
      )}

      {error && <div className="notice bad" role="alert">{error}</div>}
      <div className="actions"><button type="button" className="btn" onClick={onClose}>Close</button></div>
    </dialog>,
    document.body,
  );
}
