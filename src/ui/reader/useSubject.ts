import { useEffect, useRef, useState } from 'react';
import { articleCache } from '../../data/articleCache';
import { fetchSubject } from '../../media/wikipedia';
import { SUBJECT_VERSION, type Subject } from '../../model/subjects';

export type SubjectState =
  | { status: 'loading' }
  /** Offline, and not looked up on this device before. Tried again when the connection returns. */
  | { status: 'offline' }
  /** No Wikidata item, or Wikidata didn't answer. */
  | { status: 'unknown' }
  | { status: 'ready'; subject: Subject };

const LOADING: SubjectState = { status: 'loading' };

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

/**
 * What a page is about: from the device cache, else from Wikidata (then kept
 * beside the articles). A subject cached by an older version is looked up
 * again when online, and still used offline or when Wikidata doesn't answer.
 */
async function loadSubject(key: string, online: boolean, signal: AbortSignal): Promise<SubjectState> {
  const cached = await articleCache().getSubject(key);
  const fromCache = cached && (cached.subject ? { status: 'ready', subject: cached.subject } as const : { status: 'unknown' } as const);
  if (fromCache && (cached.v === SUBJECT_VERSION || !online)) return fromCache;
  if (!online) return { status: 'offline' };
  try {
    const subject = await fetchSubject(key, signal);
    if (!signal.aborted) await articleCache().putSubject({ key, ...(subject ? { subject } : {}), fetchedAt: Date.now(), v: SUBJECT_VERSION });
    return subject ? { status: 'ready', subject } : { status: 'unknown' };
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    if (fromCache) return fromCache;
    // Busy or unreachable: say nothing now, and look again next time.
    return navigator.onLine ? { status: 'unknown' } : { status: 'offline' };
  }
}

/** What an article is about. */
export function useSubject(key: string): SubjectState {
  return useSubjects([key])[key] ?? LOADING;
}

/**
 * What each of several pages is about, looked up one at a time (Wikipedia and
 * Wikidata turn away bursts). Pages already known in this session aren't asked again.
 */
export function useSubjects(keys: string[]): Record<string, SubjectState> {
  const [known, setKnown] = useState<Record<string, SubjectState>>({});
  const seen = useRef(known);
  const online = useOnline();
  const wanted = keys.join('|');

  useEffect(() => {
    const ctl = new AbortController();
    void (async () => {
      for (const key of wanted ? wanted.split('|') : []) {
        const s = seen.current[key]?.status;
        if (s === 'ready' || s === 'unknown' || (s === 'offline' && !online)) continue;
        try {
          const state = await loadSubject(key, online, ctl.signal);
          if (ctl.signal.aborted) return;
          seen.current = { ...seen.current, [key]: state };
          setKnown(seen.current);
        } catch {
          return; // aborted: a different passage, or the connection changed
        }
      }
    })();
    return () => ctl.abort();
  }, [wanted, online]);

  return known;
}
