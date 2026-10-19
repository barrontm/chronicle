import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { DraftSet } from '../../ai/draft';
import type { Highlight } from '../../model/types';

/**
 * Claude's drafts from Bob's highlights, waiting for him to accept or reject
 * each record. They aren't in the doc (nothing is until he accepts it), so
 * they're kept on this device, one set per highlight, and survive a reload.
 */
export interface HighlightDrafts {
  sets: Record<string, DraftSet>;
  put: (highlightId: string, set: DraftSet | null) => void;
  /** The highlight whose drafts the map shows: the one open in the tray. */
  shown: string | null;
  show: (highlightId: string | null) => void;
  /** What the open highlight could become, ticked and not yet in Chronicle: a dashed ghost on the map where each was. */
  ghosts: Ghost[];
  setGhosts: (g: Ghost[]) => void;
}

export interface Ghost { qid: string; title: string; lat: number; lon: number }

const KEY = 'chronicle.highlightDrafts';
const ghostKey = (g: Ghost[]) => g.map((x) => `${x.qid}@${x.lat},${x.lon}`).join('|');

export const HighlightDraftsContext = createContext<HighlightDrafts>({ sets: {}, put: () => {}, shown: null, show: () => {}, ghosts: [], setGhosts: () => {} });
export const useHighlightDrafts = () => useContext(HighlightDraftsContext);

/** The store, owned by the workspace. Sets whose highlight is gone are dropped. */
export function useHighlightDraftStore(highlights: Highlight[]): HighlightDrafts {
  const [sets, setSets] = useState<Record<string, DraftSet>>(() => {
    try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, DraftSet>; } catch { return {}; }
  });
  const [shown, show] = useState<string | null>(null);
  const [ghosts, setGhostState] = useState<Ghost[]>([]);
  // Only different ghosts re-render (and move the map to them).
  const setGhosts = useCallback((g: Ghost[]) => setGhostState((cur) => (ghostKey(cur) === ghostKey(g) ? cur : g)), []);

  const put = useCallback((id: string, set: DraftSet | null) => setSets((s) => {
    const { [id]: _old, ...rest } = s;
    return set ? { ...rest, [id]: set } : rest;
  }), []);

  useEffect(() => {
    const ids = new Set(highlights.map((h) => h.id));
    if (Object.keys(sets).some((id) => !ids.has(id))) setSets((s) => Object.fromEntries(Object.entries(s).filter(([id]) => ids.has(id))));
  }, [highlights, sets]);

  useEffect(() => {
    try {
      if (Object.keys(sets).length) localStorage.setItem(KEY, JSON.stringify(sets));
      else localStorage.removeItem(KEY);
    } catch { /* not kept past this visit; fine */ }
  }, [sets]);

  return useMemo(() => ({ sets, put, shown, show, ghosts, setGhosts }), [sets, put, shown, ghosts, setGhosts]);
}
