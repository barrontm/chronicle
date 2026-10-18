import type { SubjectKind } from '../../model/subjects';
import { REPRESENTATIONS } from '../representations';

/**
 * One glyph per kind of thing (docs/design.md, Glyphs), from the kind's representation, so the
 * tray draws what the timeline draws. Drawn in `currentColor`.
 */
const OTHER: Record<'connection' | 'claude' | 'none', string> = {
  none: '<path d="M4 12c0-3 1-5 3-6M10 12c0-3 1-5 3-6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  // Not a kind of subject: a connection between two records, and Claude, who drafts them.
  connection: '<path d="M2 9h12" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 5.5 14 9l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  claude: '<path d="M9 2v14M2 9h14M4 4l10 10M14 4 4 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
};

export type GlyphKind = SubjectKind | 'connection' | 'claude';

export function Glyph({ kind }: { kind?: GlyphKind }) {
  const k = kind ?? 'none';
  // The markup is the app's own constants, never data.
  const markup = k in REPRESENTATIONS ? REPRESENTATIONS[k as SubjectKind].glyph : OTHER[k as keyof typeof OTHER];
  return <svg className="glyph" viewBox="0 0 18 18" aria-hidden="true" data-glyph={k} dangerouslySetInnerHTML={{ __html: markup }} />;
}
