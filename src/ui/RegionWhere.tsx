import { useState } from 'react';
import type { Region, Territory } from '../model/types';

/** A region's outline in words: "a shape you drew", "Athens and Sparta", or none yet. */
export function outlineInWords(outline: Region['outline'], territories: readonly Territory[]): string | undefined {
  if (outline?.geometry) return 'a shape you drew';
  const names = (outline?.territoryIds ?? []).flatMap((id) => territories.find((t) => t.id === id)?.title ?? []);
  if (!names.length) return undefined;
  return names.length < 2 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * Where a region is on the map: tick some of Bob's territories, or draw it. Its own territories
 * come first. With nothing picked, it's where its territories are, as before.
 */
export function RegionWhere({ region, outline, territories, disabled, onSave, onDraw, onCancel }: {
  region: string;
  outline: Region['outline'];
  territories: readonly Territory[];
  disabled?: boolean;
  onSave: (outline: Region['outline']) => void;
  /** Draw the outline on the map instead; the caller saves what's drawn. */
  onDraw: () => void;
  onCancel: () => void;
}) {
  const [ids, setIds] = useState<string[]>(() => outline?.territoryIds ?? []);
  const sorted = [...territories].sort((a, b) => Number(b.region?.trim() === region) - Number(a.region?.trim() === region) || a.title.localeCompare(b.title));
  const drawn = !!outline?.geometry;
  const toggle = (id: string, on: boolean) => setIds((xs) => (on ? [...xs, id] : xs.filter((x) => x !== id)));
  return (
    <form className="region-where" aria-label={`Where ${region} is on the map`} onSubmit={(e) => { e.preventDefault(); onSave(ids.length ? { territoryIds: ids } : undefined); }}>
      <p className="hint">
        {drawn ? `${region} is drawn on the map. Tick territories instead, or draw it again.` : `Tick the territories that make up ${region}, or draw it. With none, it’s where its territories are.`}
      </p>
      {sorted.length > 0 ? (
        <fieldset className="region-where-list" aria-label={`Territories in ${region}`}>
          {sorted.map((t) => (
            <label key={t.id} className="check">
              <input type="checkbox" checked={ids.includes(t.id)} disabled={disabled} onChange={(e) => toggle(t.id, e.target.checked)} /> {t.title}
            </label>
          ))}
        </fieldset>
      ) : <p className="hint">You have no territories yet: draw it instead.</p>}
      <div className="actions">
        <button className="btn small primary" disabled={disabled || (!ids.length && !outline)}>{ids.length || !outline ? 'Save' : 'Clear outline'}</button>
        <button type="button" className="btn small" disabled={disabled} onClick={onDraw}>{drawn ? 'Draw it again' : 'Draw it'}</button>
        <button type="button" className="btn small quiet" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
