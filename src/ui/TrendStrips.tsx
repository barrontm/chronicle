import { useMemo, useState, type PointerEvent } from 'react';
import { formatYear } from '../model/dates';
import type { Category, Series } from '../model/types';
import type { VisibleWindow } from './TimelineView';
import { formatValue } from './util';

/**
 * Quantities over time (population, literacy, transistor counts…) drawn as thin
 * strips that share the timeline's time axis: pan or zoom the timeline and the
 * strips follow. Each strip has its own y-scale; they're for shape, not for
 * comparing magnitudes across series.
 */

const H = 64;
const PAD = 6;

interface Props {
  series: Series[];
  categories: Category[];
  window: VisibleWindow | null;
  onOpen: (id: string) => void;
  onAdd: () => void;
}

export function TrendStrips({ series, categories, window: win, onOpen, onAdd }: Props) {
  const colorOf = useMemo(() => new Map(categories.map((c) => [c.id, c.color])), [categories]);
  const visible = series.filter((s) => colorOf.has(s.categoryId));

  return (
    <section className="strips" aria-label="Trends over time" style={win ? ({ '--strip-cols': `${Math.max(0, win.left - 8)}px ${win.width}px` } as React.CSSProperties) : undefined}>
      <div className="strips-head">
        <span>Trends</span>
        <button className="btn small quiet" onClick={onAdd}>Add a trend</button>
      </div>
      {visible.length === 0 && (
        <p className="strips-head" style={{ fontWeight: 400 }}>
          Track something measured over time, like population or literacy, and it will line up under your timeline.
        </p>
      )}
      {win && visible.map((s) => <Strip key={s.id} s={s} color={colorOf.get(s.categoryId)!} win={win} onOpen={onOpen} />)}
    </section>
  );
}

function Strip({ s, color, win, onOpen }: { s: Series; color: string; win: VisibleWindow; onOpen: (id: string) => void }) {
  const [hoverX, setHoverX] = useState<number | null>(null);
  const width = Math.max(1, win.width);
  const tx = (x: number) => ((x - win.start) / (win.end - win.start)) * width;
  const tv = s.scale === 'log' ? (v: number) => Math.log10(v) : (v: number) => v;

  const geom = useMemo(() => {
    const pts = s.points;
    if (pts.length < 2) return null;
    const vs = pts.map((p) => tv(p.v));
    const lo = s.scale === 'log' ? Math.min(...vs) : Math.min(0, ...vs);
    const hi = Math.max(...vs);
    const ty = (v: number) => H - PAD - ((tv(v) - lo) / (hi - lo || 1)) * (H - 2 * PAD);
    return { ty, pts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  if (!geom) return null;
  const { ty, pts } = geom;
  const first = pts[0].x;
  const last = pts[pts.length - 1].x;
  const inView = last >= win.start && first <= win.end;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${tx(p.x).toFixed(1)},${ty(p.v).toFixed(1)}`).join(' ');
  const area = `${line} L${tx(last).toFixed(1)},${H - PAD} L${tx(first).toFixed(1)},${H - PAD} Z`;

  // Interpolated readout under the pointer (geometric interpolation on log strips).
  let readout: { x: number; y: number; text: string } | null = null;
  if (hoverX !== null) {
    const year = win.start + (hoverX / width) * (win.end - win.start);
    if (year >= first && year <= last) {
      const i = pts.findIndex((p) => p.x >= year);
      const a = pts[Math.max(0, i - 1)];
      const b = pts[i];
      const t = b.x === a.x ? 0 : (year - a.x) / (b.x - a.x);
      const v = s.scale === 'log' ? 10 ** (Math.log10(a.v) + t * (Math.log10(b.v) - Math.log10(a.v))) : a.v + t * (b.v - a.v);
      readout = { x: hoverX, y: ty(v), text: `${formatYear(Math.round(year))}: ${formatValue(v, s.unit)}` };
    }
  }

  const onMove = (e: PointerEvent<SVGSVGElement>) => setHoverX(e.clientX - e.currentTarget.getBoundingClientRect().left);

  return (
    <div className="strip" style={{ '--c': color } as React.CSSProperties} data-testid={`strip-${s.id}`}>
      <button className="strip-label" onClick={() => onOpen(s.id)} title="Edit this trend">
        <strong>{s.title}</strong>
        <small>{s.unit}{s.scale === 'log' ? ' · log scale' : ''}</small>
      </button>
      <svg viewBox={`0 0 ${width} ${H}`} preserveAspectRatio="none" onPointerMove={onMove} onPointerLeave={() => setHoverX(null)} role="img" aria-label={`${s.title} from ${formatYear(Math.round(first))} to ${formatYear(Math.round(last))}`}>
        <defs>
          <clipPath id={`clip-${s.id}`}><rect x="0" y="0" width={width} height={H} /></clipPath>
        </defs>
        {inView ? (
          <g clipPath={`url(#clip-${s.id})`}>
            <path className="area" d={area} />
            <path className="line" d={line} />
            {pts.map((p) => (
              <circle key={p.x} className="pt" cx={tx(p.x)} cy={ty(p.v)} r={2.5}>
                <title>{`${formatYear(Math.round(p.x))}: ${formatValue(p.v, s.unit)}`}</title>
              </circle>
            ))}
          </g>
        ) : (
          <text className="out-of-range" x={8} y={H / 2 + 4}>
            {`Data covers ${formatYear(Math.round(first))} to ${formatYear(Math.round(last))}; ${last < win.start ? 'scroll back' : 'scroll forward'} to see it.`}
          </text>
        )}
        {readout && (
          <g>
            <line className="cursor" x1={readout.x} x2={readout.x} y1={0} y2={H} />
            <circle className="pt" cx={readout.x} cy={readout.y} r={3.5} />
            {(() => {
              // Flip the label to the left of the cursor near the right edge.
              const w = readout.text.length * 6.2 + 8;
              const x = readout.x + 6 + w > width ? readout.x - 6 - w : readout.x + 6;
              return (
                <>
                  <rect className="readout-bg" x={x} y={2} width={w} height={16} rx={3} />
                  <text className="readout" x={x + 4} y={14}>{readout.text}</text>
                </>
              );
            })()}
          </g>
        )}
      </svg>
    </div>
  );
}
