import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createEmptyDoc, openStoredDoc } from '../model/doc';
import type { MediaRef, TimelineDoc } from '../model/types';
import { NewerDataError, type DocStore } from '../store/store';

type SaveState = 'loading' | 'saved' | 'saving' | 'error';

interface DocContextValue {
  doc: TimelineDoc;
  /** Apply a pure change (see src/model/doc.ts mutations). Saves automatically. */
  update: (change: (doc: TimelineDoc) => TimelineDoc) => void;
  /** Replace the whole doc (import). */
  replace: (doc: TimelineDoc) => void;
  saveState: SaveState;
  store: DocStore;
  /** Display URL for an image, resolving uploaded files to object URLs. */
  mediaUrl: (m: MediaRef, thumb?: boolean) => string | undefined;
  /** Store an uploaded image and return its local id. */
  putMedia: (blob: Blob) => Promise<string>;
  /** Set when changes can't be saved safely (data from a newer version); edits are ignored. */
  readOnly: string | null;
  /** Save any pending change now (before a reload). */
  flush: () => Promise<void>;
}

const NEWER = 'This data was saved by a newer version of Chronicle, so this copy won’t change it. Reload to update.';

const Ctx = createContext<DocContextValue | null>(null);

export function useDoc(): DocContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDoc must be used inside <DocProvider>');
  return v;
}

const SAVE_DELAY_MS = 250;

export function DocProvider({ store, children }: { store: DocStore; children: (ready: boolean) => ReactNode }) {
  const [doc, setDoc] = useState<TimelineDoc | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [localUrls, setLocalUrls] = useState<Record<string, string>>({});
  const [readOnly, setReadOnly] = useState<string | null>(null);
  const readOnlyRef = useRef<string | null>(null);
  const lock = useCallback((message: string) => { readOnlyRef.current = message; setReadOnly(message); }, []);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef<TimelineDoc | null>(null);

  useEffect(() => {
    let cancelled = false;
    store.load().then(async (loaded) => {
      if (cancelled) return;
      let d = loaded ?? createEmptyDoc();
      if (!loaded) await store.save(d);
      else {
        try {
          const opened = openStoredDoc(loaded);
          d = opened.doc;
          if (opened.status === 'newer') lock(NEWER);
          if (opened.status === 'upgraded') {
            // Keep the data exactly as it was before upgrading it, then save the upgraded doc.
            await store.keepCopy(loaded, `Before upgrading from schema ${loaded.schemaVersion}`);
            await store.save(d);
          }
        } catch (e) {
          lock(`Chronicle couldn’t upgrade your saved data, so it’s left untouched: ${(e as Error).message}`);
        }
      }
      if (cancelled) return;
      setDoc(d);
      latest.current = d;
      setSaveState('saved');
      // Ask the browser not to evict our data under storage pressure.
      navigator.storage?.persist?.().catch(() => undefined);
    }, () => setSaveState('error'));
    return () => { cancelled = true; };
  }, [store, lock]);

  const write = useCallback((d: TimelineDoc) => store.save(d).then(
    () => setSaveState('saved'),
    (e) => { setSaveState('error'); if (e instanceof NewerDataError) lock(NEWER); },
  ), [store, lock]);

  const scheduleSave = useCallback((d: TimelineDoc) => {
    latest.current = d;
    setSaveState('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void write(latest.current!), SAVE_DELAY_MS);
  }, [write]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (latest.current && !readOnlyRef.current) await write(latest.current);
  }, [write]);

  // Flush a pending save if the tab is closed mid-debounce.
  useEffect(() => {
    const onHide = () => { if (latest.current && !readOnlyRef.current) void store.save(latest.current); };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [store]);

  const update = useCallback((change: (d: TimelineDoc) => TimelineDoc) => {
    if (readOnlyRef.current) return;
    setDoc((prev) => {
      if (!prev) return prev;
      const next = change(prev);
      if (next !== prev) scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const replace = useCallback((d: TimelineDoc) => {
    if (readOnlyRef.current) return;
    setDoc(d);
    scheduleSave(d);
  }, [scheduleSave]);

  // Resolve uploaded images to object URLs once, as they appear.
  useEffect(() => {
    if (!doc) return;
    const wanted = new Set<string>();
    for (const it of doc.items) for (const m of it.media ?? []) if (m.source === 'local' && m.localId) wanted.add(m.localId);
    const missing = [...wanted].filter((id) => !localUrls[id]);
    if (!missing.length) return;
    Promise.all(missing.map(async (id) => [id, await store.getMedia(id)] as const)).then((pairs) => {
      const add: Record<string, string> = {};
      for (const [id, blob] of pairs) if (blob) add[id] = URL.createObjectURL(blob);
      if (Object.keys(add).length) setLocalUrls((cur) => ({ ...cur, ...add }));
    });
  }, [doc, store, localUrls]);

  const putMedia = useCallback(async (blob: Blob) => {
    const id = await store.putMedia(blob);
    setLocalUrls((cur) => ({ ...cur, [id]: URL.createObjectURL(blob) }));
    return id;
  }, [store]);

  const mediaUrl = useCallback((m: MediaRef, thumb = false) => {
    if (m.source === 'local') return m.localId ? localUrls[m.localId] : undefined;
    return (thumb && m.thumbUrl) || m.url;
  }, [localUrls]);

  const value = useMemo(
    () => (doc ? { doc, update, replace, saveState, store, mediaUrl, putMedia, readOnly, flush } : null),
    [doc, update, replace, saveState, store, mediaUrl, putMedia, readOnly, flush],
  );

  if (!value) {
    return <>{children(false)}</>;
  }
  return <Ctx.Provider value={value}>{children(true)}</Ctx.Provider>;
}
