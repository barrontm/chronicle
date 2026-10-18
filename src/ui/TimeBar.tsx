import { useEffect, useRef, useState, type RefObject } from 'react';
import { formatYear } from '../model/dates';
import type { TimelineControl, VisibleWindow } from './TimelineView';
import { currentStop, sliderToSpan, spanLabel, spanToSlider, SLIDER_MAX, TIME_MAX, TIME_MIN, windowAround, ZOOM_STOPS } from './timeNav';

/** Dragging the thumbwheel moves the timeline this many times as far as the finger. */
const WHEEL_RATE = 2;
/** How quickly a flick of the thumbwheel slows down, per frame, and its top speed in px per ms. */
const GLIDE_FRICTION = 0.92;
const GLIDE_MAX = 2;
/** Anything else Bob does stops a flick's glide, so it doesn't fight the zoom bar or a click. */
const INTERRUPTS = ['pointerdown', 'wheel', 'keydown'] as const;

/**
 * Under the timeline: a thumbwheel to spin through time, and a zoom bar with
 * stops from a year to a millennium (and, on the new timeline, the eras).
 */
export function TimeBar({ win, control }: { win: VisibleWindow; control: RefObject<TimelineControl | null> }) {
  const span = win.end - win.start;
  const center = (win.start + win.end) / 2;
  const stop = currentStop(span);
  const eras = win.level === 0;
  /** The stops show the entries; at the eras, or inside one, they come back to them first. */
  const entries = () => { if (win.level !== undefined && win.level !== 2) control.current?.setLevel?.(2); };
  const zoomTo = (years: number) => { entries(); control.current?.setWindow(windowAround(center, years), true); };

  return (
    <div className="time-bar" data-testid="time-bar">
      <Thumbwheel win={win} control={control} />
      <div className="zoom-bar" role="group" aria-label="Zoom">
        <button className="btn small quiet" aria-label="Zoom the timeline out" onClick={() => control.current?.zoomBy(2)}>−</button>
        <input
          type="range"
          aria-label="Zoom"
          aria-valuetext={`${spanLabel(span)} in view`}
          min={0}
          max={SLIDER_MAX}
          value={spanToSlider(span)}
          onChange={(e) => control.current?.setWindow(windowAround(center, sliderToSpan(Number(e.target.value))))}
        />
        <button className="btn small quiet" aria-label="Zoom the timeline in" onClick={() => control.current?.zoomBy(0.5)}>+</button>
        <div className="zoom-stops">
          {win.level !== undefined && <button className="chip" aria-pressed={eras} onClick={() => control.current?.setLevel?.(0)}>Eras</button>}
          {ZOOM_STOPS.map((s) => (
            <button key={s.label} className="chip" aria-pressed={!eras && stop === s.label} onClick={() => zoomTo(s.years)}>{s.label}</button>
          ))}
          <button className="chip" aria-pressed={false} onClick={() => { entries(); control.current?.fit(); }}>All</button>
        </div>
        <span className="zoom-span" data-testid="zoom-span">{spanLabel(span)} in view</span>
      </div>
    </div>
  );
}

function Thumbwheel({ win, control }: { win: VisibleWindow; control: RefObject<TimelineControl | null> }) {
  const span = win.end - win.start;
  const center = (win.start + win.end) / 2;
  // The ridges' offset, so the wheel looks like it turns with the timeline.
  const [turn, setTurn] = useState(0);
  const drag = useRef<{ x: number; t: number; v: number } | null>(null);
  const glide = useRef<number | null>(null);
  const latest = useRef({ span, width: win.width });
  latest.current = { span, width: win.width };

  const stopGlide = () => {
    if (glide.current !== null) cancelAnimationFrame(glide.current);
    glide.current = null;
    for (const t of INTERRUPTS) window.removeEventListener(t, stopGlide, true);
  };
  useEffect(() => stopGlide, []);

  /** Turning the wheel right by `px` moves back in time, like dragging the timeline. */
  const turnBy = (px: number) => {
    const { span, width } = latest.current;
    if (!width) return;
    setTurn((t) => t + px);
    control.current?.panBy((-px * WHEEL_RATE * span) / width);
  };

  return (
    <div className="thumbwheel-wrap">
      <span className="thumbwheel-year" aria-hidden="true">{formatYear(Math.round(center))}</span>
      <div
        className="thumbwheel"
        role="slider"
        tabIndex={0}
        aria-label="Scroll through time"
        aria-valuemin={TIME_MIN}
        aria-valuemax={TIME_MAX}
        aria-valuenow={Math.round(center)}
        aria-valuetext={`Around ${formatYear(Math.round(center))}`}
        data-testid="thumbwheel"
        style={{ '--turn': `${turn % 12}px` } as React.CSSProperties}
        onPointerDown={(e) => {
          stopGlide();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, t: e.timeStamp, v: 0 };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dt = Math.max(1, e.timeStamp - d.t);
          drag.current = { x: e.clientX, t: e.timeStamp, v: dx / dt };
          if (dx) turnBy(dx);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          // A flick keeps the wheel spinning for a moment, unless the finger stopped first.
          if (!d || e.timeStamp - d.t > 80 || Math.abs(d.v) < 0.3) return;
          let v = Math.max(-GLIDE_MAX, Math.min(GLIDE_MAX, d.v)) * 16;
          const step = () => {
            v *= GLIDE_FRICTION;
            if (Math.abs(v) < 0.5) { stopGlide(); return; }
            turnBy(v);
            glide.current = requestAnimationFrame(step);
          };
          glide.current = requestAnimationFrame(step);
          for (const t of INTERRUPTS) window.addEventListener(t, stopGlide, true);
        }}
        onPointerCancel={() => { drag.current = null; }}
        onKeyDown={(e) => {
          const steps: Record<string, number> = { ArrowLeft: -0.1, ArrowRight: 0.1, PageUp: -1, PageDown: 1 };
          const k = steps[e.key];
          if (k === undefined) return;
          e.preventDefault();
          control.current?.panBy(k * span);
          setTurn((t) => t - k * 40);
        }}
      />
    </div>
  );
}
