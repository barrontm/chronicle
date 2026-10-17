import { useEffect, useState } from 'react';
import { articleCache } from '../../data/articleCache';
import { fetchSubject } from '../../media/wikipedia';
import type { Subject } from '../../model/subjects';

export type SubjectState =
  | { status: 'loading' }
  /** Offline, and not looked up on this device before. Tried again when the connection returns. */
  | { status: 'offline' }
  /** No Wikidata item, or Wikidata didn't answer. */
  | { status: 'unknown' }
  | { status: 'ready'; subject: Subject };

/** What an article is about: from the device cache, else from Wikidata (then kept). */
export function useSubject(key: string): SubjectState {
  const [state, setState] = useState<SubjectState>({ status: 'loading' });
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    void (async () => {
      const cached = await articleCache().getSubject(key);
      if (ctl.signal.aborted) return;
      if (cached) { setState(cached.subject ? { status: 'ready', subject: cached.subject } : { status: 'unknown' }); return; }
      if (!online) { setState({ status: 'offline' }); return; }
      setState({ status: 'loading' });
      try {
        const subject = await fetchSubject(key, ctl.signal);
        if (ctl.signal.aborted) return;
        setState(subject ? { status: 'ready', subject } : { status: 'unknown' });
        await articleCache().putSubject({ key, ...(subject ? { subject } : {}), fetchedAt: Date.now() });
      } catch (e) {
        // Busy or unreachable: say nothing now, and look again next time the article opens.
        if ((e as Error).name !== 'AbortError') setState(navigator.onLine ? { status: 'unknown' } : { status: 'offline' });
      }
    })();
    return () => ctl.abort();
  }, [key, online]);

  return state;
}
