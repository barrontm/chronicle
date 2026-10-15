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
  | { type: 'library'; tab: 'notes' | 'sources' | 'trends' };

export interface Nav {
  /** Open a panel on top of the current one. */
  open: (p: Panel) => void;
  /** Swap the current panel (e.g. view ↔ edit) without growing the stack. */
  replace: (p: Panel) => void;
  back: () => void;
  close: () => void;
  canGoBack: boolean;
}
