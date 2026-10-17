import type { SubjectKind } from '../../model/subjects';

/**
 * One glyph per kind of thing (docs/design.md, Reader and capture). War,
 * battle, event, person, polity and place are the prototype's; the rest are
 * stand-ins until their representations are designed. Drawn in `currentColor`.
 */
const SHAPES: Record<SubjectKind | 'none', React.ReactNode> = {
  war: <><rect x="1.5" y="6" width="15" height="6" rx="1" fill="currentColor" opacity=".35" /><path d="M6 3.5v11M12 3.5v11" stroke="currentColor" strokeWidth="1.8" /></>,
  battle: <><circle cx="9" cy="9" r="7.5" fill="currentColor" /><path d="M6 6l6 6M12 6l-6 6" stroke="var(--panel)" strokeWidth="1.8" /></>,
  event: <circle cx="9" cy="9" r="5" fill="currentColor" />,
  person: <><path d="M3 9h12" stroke="currentColor" strokeWidth="1.8" /><circle cx="3.5" cy="9" r="2.3" fill="currentColor" /><circle cx="14.5" cy="9" r="2.3" fill="currentColor" /></>,
  polity: <rect x="4" y="4" width="10" height="10" fill="currentColor" />,
  place: <path d="M9 2a5 5 0 0 1 5 5c0 4-5 9-5 9s-5-5-5-9a5 5 0 0 1 5-5z" fill="none" stroke="currentColor" strokeWidth="1.6" />,
  period: <rect x="1.5" y="6" width="15" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />,
  migration: <path d="M2 12c4-6 9-6 13-2M12 7l3 3-4 1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />,
  idea: <path d="M9 2.5l6.5 6.5L9 15.5 2.5 9z" fill="none" stroke="currentColor" strokeWidth="1.6" />,
  technology: <path d="M9 3l7 12H2z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />,
  economy: <><circle cx="9" cy="9" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M9 5.5v7" stroke="currentColor" strokeWidth="1.6" /></>,
  work: <><path d="M3 3.5h8.5a3 3 0 0 1 3 3v8H6a3 3 0 0 1-3-3z" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M6 7h5.5" stroke="currentColor" strokeWidth="1.4" /></>,
  none: <path d="M4 12c0-3 1-5 3-6M10 12c0-3 1-5 3-6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />,
};

export function Glyph({ kind }: { kind?: SubjectKind }) {
  return <svg className="glyph" viewBox="0 0 18 18" aria-hidden="true">{SHAPES[kind ?? 'none']}</svg>;
}
