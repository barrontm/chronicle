import type { useHighlighting } from './useHighlighting';

type Marks = ReturnType<typeof useHighlighting>;

/** "Highlight" for a selection: above it on the laptop, docked at the bottom on the phone. What to do with a highlight is in the tray. */
export function HighlightTool({ marks }: { marks: Marks }) {
  const spot = marks.toolSpot;
  if (!spot) return null;
  const docked = spot === 'docked';
  // Hidden while its mark is scrolled out of view.
  if (!docked && (spot.y < 48 || spot.y > window.innerHeight)) return null;
  return (
    <div
      className={`highlight-tool ${docked ? 'docked' : ''}`}
      style={docked ? undefined : { left: Math.min(window.innerWidth - 90, Math.max(90, spot.x)), top: spot.y }}
      // Keeps the selection when the button is pressed with a mouse.
      onMouseDown={(e) => e.preventDefault()}
    >
      <button className="btn primary" onClick={marks.highlightSelection}>Highlight{!docked && <kbd aria-hidden="true">H</kbd>}</button>
    </div>
  );
}

/** The marks are paint only, so screen readers get them as a list, and hear each new one. */
export function HighlightsForScreenReaders({ marks }: { marks: Marks }) {
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">{marks.announce}</div>
      {marks.placed.length > 0 && (
        <section className="sr-only" aria-label="Your highlights in this article">
          <ul>
            {marks.placed.map((p) => (
              <li key={p.highlight.id}>
                “{p.highlight.text}”{' '}
                {!p.at ? '(couldn’t be found in this version)' : p.at.uncertain ? '(may have moved)' : p.state === 'added' ? '(on your map and timeline)' : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
