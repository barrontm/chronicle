import type { Area } from '../data/geo';
import type { ItemDraft } from '../media/wikipedia';
import type { ItemKind } from '../model/types';

/** What the side drawer is showing. The drawer keeps a stack so "Back" works across links. */
export type Panel =
  | { type: 'item'; id: string; edit?: boolean }
  | { type: 'new-item'; year?: number; categoryId?: string; kind?: ItemKind; draft?: ItemDraft }
  | { type: 'wiki-import' }
  | { type: 'note'; id: string; edit?: boolean }
  | { type: 'new-note'; linkedIds: string[] }
  | { type: 'source'; id: string; edit?: boolean }
  | { type: 'new-source' }
  | { type: 'series'; id: string | null }
  | { type: 'territory'; id: string; edit?: boolean }
  | { type: 'territory-import'; year: number }
  | { type: 'library'; tab: 'notes' | 'sources' | 'trends' | 'territories' };

export interface Nav {
  /** Open a panel on top of the current one. */
  open: (p: Panel) => void;
  /** Swap the current panel (e.g. view ↔ edit) without growing the stack. */
  replace: (p: Panel) => void;
  back: () => void;
  close: () => void;
  canGoBack: boolean;
  /** Show the map at a year (e.g. "Show on map" from an entry or territory). */
  showOnMap: (year: number) => void;
  /** Draw a border on the map; `onDone` gets the shape and the map's year when Bob finishes. */
  draw: (onDone: (g: Area, year: number) => void) => void;
}
