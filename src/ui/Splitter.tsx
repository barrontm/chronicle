import { useLayoutEffect, useRef, useState } from 'react';

type Props = {
  /** 'columns' sits between two side-by-side panes (moves left and right); 'rows' between stacked ones. */
  between: 'columns' | 'rows';
  label: string;
  /** The size of the pane before the handle (left or above), in px, as laid out now. */
  measure: () => number;
  /** The smallest and largest that size may be, worked out when a move starts. */
  limits: () => [number, number];
  /** Applies a size while the handle moves, without a React render. */
  apply: (px: number) => void;
  /** Keeps the size once the move ends. */
  commit: (px: number) => void;
  testId?: string;
};

const STEP = 16;

/** A drag handle between two panes: a `role=separator` the pointer drags and the arrow keys move. */
export function Splitter({ between, label, measure, limits, apply, commit, testId }: Props) {
  const drag = useRef<{ start: number; from: number; lim: [number, number]; at: number } | null>(null);
  const [aria, setAria] = useState<{ now: number; min: number; max: number } | null>(null);
  const clamp = (v: number, [lo, hi]: [number, number]) => Math.round(Math.min(Math.max(v, lo), Math.max(lo, hi)));
  const show = (now: number, [min, max]: [number, number]) => setAria({ now, min, max: Math.max(min, max) });

  useLayoutEffect(() => {
    const lim = limits();
    show(clamp(measure(), lim), lim);
    // Only on mount: later values come from moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pos = (e: React.PointerEvent) => (between === 'columns' ? e.clientX : e.clientY);

  return (
    <div
      className={`splitter ${between}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={between === 'columns' ? 'vertical' : 'horizontal'}
      aria-valuenow={aria?.now}
      aria-valuemin={aria?.min}
      aria-valuemax={aria?.max}
      data-testid={testId}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const from = measure();
        drag.current = { start: pos(e), from, lim: limits(), at: from };
        e.currentTarget.classList.add('dragging');
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        d.at = clamp(d.from + pos(e) - d.start, d.lim);
        apply(d.at);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d) return;
        drag.current = null;
        e.currentTarget.classList.remove('dragging');
        commit(d.at);
        show(d.at, d.lim);
      }}
      onLostPointerCapture={(e) => {
        const d = drag.current;
        if (!d) return;
        drag.current = null;
        e.currentTarget.classList.remove('dragging');
        commit(d.at);
        show(d.at, d.lim);
      }}
      onKeyDown={(e) => {
        const back = between === 'columns' ? 'ArrowLeft' : 'ArrowUp';
        const fwd = between === 'columns' ? 'ArrowRight' : 'ArrowDown';
        const lim = limits();
        const now = measure();
        const step = e.shiftKey ? STEP * 4 : STEP;
        let to: number | null = null;
        if (e.key === back) to = now - step;
        else if (e.key === fwd) to = now + step;
        else if (e.key === 'Home') to = lim[0];
        else if (e.key === 'End') to = lim[1];
        if (to === null) return;
        e.preventDefault();
        to = clamp(to, lim);
        apply(to);
        commit(to);
        show(to, lim);
      }}
    />
  );
}
