import { useEffect, useState } from 'react';
import { findPolitiesAt, type CliopatriaFile, type CliopatriaPolity } from '../data/cliopatria';
import { formatYear } from '../model/dates';
import { havePolity, seshatPolity } from '../model/passage';
import type { TimelineItem } from '../model/types';
import type { Tied } from '../ai/draft';
import { useDoc } from './DocContext';
import { regionAt } from './mapData';
import { useOnline } from './useAi';

/** Who held an entry's place in its year, in Seshat's maps, as far as Chronicle has found out. */
type Held =
  | { status: 'idle' | 'looking' | 'offline' | 'nobody' }
  | { status: 'failed'; message: string }
  | { status: 'found'; polity: CliopatriaPolity; file: CliopatriaFile };

/** Where an entry is and when: a place with its coordinates and the year it's looked up in (`placeYear`). */
export interface PlaceAt { name?: string; lat: number; lon: number; year: number }

/**
 * The polity that held a place in a year, looked up in Seshat's maps whenever the place or year
 * changes (and again on reconnecting), and whether Bob wants it added: ticked unless he already has
 * it or unticks it.
 */
export function usePlacePolity(at: PlaceAt | undefined) {
  const { doc } = useDoc();
  const online = useOnline();
  const [held, setHeld] = useState<Held>({ status: 'idle' });
  const [skip, setSkip] = useState<string>();
  const key = at ? `${at.lon},${at.lat},${at.year}` : '';
  useEffect(() => {
    if (!at) { setHeld({ status: 'idle' }); return; }
    if (!online) { setHeld({ status: 'offline' }); return; }
    const c = new AbortController();
    setHeld({ status: 'looking' });
    findPolitiesAt([at.lon, at.lat], at.year, c.signal).then(
      ([first]) => setHeld(first ? { status: 'found', polity: first.polity, file: first.file } : { status: 'nobody' }),
      (e: Error) => { if (!c.signal.aborted) setHeld(navigator.onLine ? { status: 'failed', message: e.message } : { status: 'offline' }); },
    );
    return () => c.abort();
    // `key` stands for `at`.
  }, [key, online]);
  const have = held.status === 'found' ? havePolity(held.polity, doc.items, doc.territories) : undefined;
  const ticked = held.status === 'found' && !have && skip !== held.polity.id;
  return {
    at, held, have, ticked,
    setTicked: (on: boolean) => held.status === 'found' && setSkip(on ? undefined : held.polity.id),
    /**
     * The polity to add with the entry, when it's ticked: made once, as the entry is saved. It starts
     * in the region whose outline holds the place, if any.
     */
    toAdd: (categoryId: string): { item: TimelineItem; territory: Tied } | undefined => {
      if (!ticked || held.status !== 'found' || !at) return undefined;
      const made = seshatPolity(held.polity, held.file, categoryId);
      const region = regionAt(at.lon, at.lat, doc.regions, doc.territories, at.year);
      return region ? { ...made, territory: { next: { ...made.territory.next, region } } } : made;
    },
  };
}

export type PlacePolityState = ReturnType<typeof usePlacePolity>;

/** "In Achaemenid Empire in 499 BCE", with "Also add…" ticked, or named as linked when Bob has it. */
export function PlacePolity({ state, disabled }: { state: PlacePolityState; disabled?: boolean }) {
  const { at, held, have, ticked, setTicked } = state;
  if (!at || held.status === 'idle') return null;
  const when = formatYear(Math.floor(at.year));
  const where = at.name ?? 'this place';
  const line = (body: React.ReactNode) => <div className="place-polity" data-testid="place-polity" role="status">{body}</div>;
  if (held.status === 'failed') return line(<p className="tray-note">Couldn’t check who held {where} in {when}. {held.message}</p>);
  if (held.status !== 'found') {
    return line(<p className="tray-note">{held.status === 'looking' ? `Looking up who held ${where} in ${when}…`
      : held.status === 'offline' ? `You’re offline. Chronicle will check who held ${where} in ${when} when you’re back online.`
      : `Seshat’s maps have no polity at ${where} in ${when}.`}</p>);
  }
  const name = have?.title ?? held.polity.name;
  return line(
    <>
      <p className="pp-in">In {name} in {when}{have && <span className="tag linked">Linked</span>}</p>
      {!have && (
        <label className="check">
          <input type="checkbox" checked={ticked} disabled={disabled} onChange={(e) => setTicked(e.target.checked)} />
          Also add {held.polity.name}, with its borders over time
        </label>
      )}
    </>,
  );
}
