import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createEmptyDoc } from '../model/doc';
import type { MediaRef, TimelineDoc } from '../model/types';
import type { DocStore } from '../store/store';

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
}

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
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef<TimelineDoc | null>(null);

  useEffect(() => {
    let cancelled = false;
    store.load().then(async (loaded) => {
      if (cancelled) return;
      const d = loaded ?? createEmptyDoc();
      if (!loaded) await store.save(d);
      setDoc(d);
      latest.current = d;
      setSaveState('saved');
      // Ask the browser not to evict our data under storage pressure.
      navigator.storage?.persist?.().catch(() => undefined);
    }, () => setSaveState('error'));
    return () => { cancelled = true; };
  }, [store]);

  const scheduleSave = useCallback((d: TimelineDoc) => {
    latest.current = d;
    setSaveState('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      store.save(latest.current!).then(() => setSaveState('saved'), () => setSaveState('error'));
    }, SAVE_DELAY_MS);
  }, [store]);

  // Flush a pending save if the tab is closed mid-debounce.
  useEffect(() => {
    const flush = () => { if (latest.current) void store.save(latest.current); };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [store]);

  const update = useCallback((change: (d: TimelineDoc) => TimelineDoc) => {
    setDoc((prev) => {
      if (!prev) return prev;
      const next = change(prev);
      if (next !== prev) scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const replace = useCallback((d: TimelineDoc) => {
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
    () => (doc ? { doc, update, replace, saveState, store, mediaUrl, putMedia } : null),
    [doc, update, replace, saveState, store, mediaUrl, putMedia],
  );

  if (!value) {
    return <>{children(false)}</>;
  }
  return <Ctx.Provider value={value}>{children(true)}</Ctx.Provider>;
}
