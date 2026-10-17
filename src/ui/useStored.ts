import { useCallback, useState } from 'react';

/** A per-device preference in localStorage. Storage can be unavailable (private mode), so failures are ignored. */
export function useStored<T>(key: string, initial: () => T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch { /* fall through */ }
    return initial();
  });
  const set = useCallback((v: T) => {
    setValue(v);
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* not saved; fine */ }
  }, [key]);
  return [value, set];
}
