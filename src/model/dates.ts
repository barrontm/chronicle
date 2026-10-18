import type { HistDate } from './types';

/**
 * The ONLY place that converts between historian-style years ("431 BCE") and
 * astronomical years (-430). Everything else works with HistDate.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** JS Date can represent roughly ±271,821 years. Deep time needs a custom renderer (see ROADMAP). */
export const MIN_YEAR = -271_000;
export const MAX_YEAR = 271_000;

/** Historian year (431 BCE → 431, era 'BCE') to astronomical (-430). */
export function toAstronomical(year: number, era: 'BCE' | 'CE'): number {
  if (!Number.isInteger(year) || year < 1) throw new Error(`Year must be a whole number of 1 or more, got ${year}`);
  return era === 'BCE' ? 1 - year : year;
}

/** Astronomical year to historian form: -430 → { year: 431, era: 'BCE' }. */
export function fromAstronomical(y: number): { year: number; era: 'BCE' | 'CE' } {
  return y <= 0 ? { year: 1 - y, era: 'BCE' } : { year: y, era: 'CE' };
}

export function formatYear(y: number): string {
  const { year, era } = fromAstronomical(y);
  return era === 'BCE' ? `${year} BCE` : `${year}`;
}

/**
 * Label for a round-numbered axis tick (step of 10+ years). Ticks fall on
 * astronomical years like -500, which is strictly 501 BCE; at decade-or-wider
 * zoom that one-year offset is invisible, so we show the round number people
 * expect ("500 BCE"). Year 0 is the BCE/CE boundary and is labeled "1 CE".
 */
export function formatAxisYear(y: number): string {
  if (y < 0) return `${-y} BCE`;
  if (y === 0) return '1 CE';
  return String(y);
}

export function formatHistDate(d: HistDate): string {
  let s = formatYear(d.y);
  if (d.m) s = `${MONTHS[d.m - 1]} ${s}`;
  if (d.m && d.d) s = `${d.d} ${s}`;
  return d.approx ? `c. ${s}` : s;
}

export function formatRange(start: HistDate, end?: HistDate): string {
  if (!end) return formatHistDate(start);
  const a = formatHistDate(start);
  const b = formatHistDate(end);
  // "431–404 BCE" reads better than "431 BCE – 404 BCE" when both are plain BCE years.
  if (start.y <= 0 && end.y <= 0 && !start.m && !end.m && !start.approx && !end.approx) {
    return `${1 - start.y}–${1 - end.y} BCE`;
  }
  return `${a} – ${b}`;
}

function daysInMonth(y: number, m: number): number {
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

export function isValidHistDate(d: HistDate): boolean {
  if (!Number.isInteger(d.y) || d.y < MIN_YEAR || d.y > MAX_YEAR) return false;
  if (d.m === undefined) return d.d === undefined;
  if (!Number.isInteger(d.m) || d.m < 1 || d.m > 12) return false;
  if (d.d === undefined) return true;
  return Number.isInteger(d.d) && d.d >= 1 && d.d <= daysInMonth(d.y, d.m);
}

/**
 * Parse what a person types. Accepted forms (case-insensitive):
 *   1914-07-28   1914-07   1914   476 CE   AD 476   431 BCE   431 BC   -431 (= 431 BCE)
 *   any of the above prefixed with "c.", "ca.", "circa" or "~" for approximate dates.
 * A leading minus means BCE in the historian sense (-431 = 431 BCE), NOT ISO astronomical.
 * Returns null when the text isn't a date we understand.
 */
export function parseHistDate(input: string): HistDate | null {
  let s = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  let approx = false;
  const approxMatch = s.match(/^(circa|ca\.?|c\.?|~)\s*/);
  if (approxMatch) {
    approx = true;
    s = s.slice(approxMatch[0].length);
  }

  let era: 'BCE' | 'CE' = 'CE';
  const suffix = s.match(/\s*(bce|bc|b\.c\.e?\.?|ce|ad|a\.d\.|c\.e\.)$/);
  if (suffix) {
    era = /^(bce|bc|b\.c)/.test(suffix[1]) ? 'BCE' : 'CE';
    s = s.slice(0, suffix.index).trim();
  }
  const prefix = s.match(/^(ad|a\.d\.)\s*/);
  if (prefix) s = s.slice(prefix[0].length);
  if (s.startsWith('-') || s.startsWith('−')) {
    era = 'BCE';
    s = s.slice(1);
  }

  const m = s.match(/^(\d{1,6})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/);
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 1) return null;
  const d: HistDate = { y: toAstronomical(year, era) };
  if (m[2]) d.m = Number(m[2]);
  if (m[3]) d.d = Number(m[3]);
  if (approx) d.approx = true;
  return isValidHistDate(d) ? d : null;
}

/** Inverse of parseHistDate for editing forms: always produces text parseHistDate accepts. */
export function toInputString(d: HistDate): string {
  const { year, era } = fromAstronomical(d.y);
  let s = String(year);
  if (d.m) s += `-${String(d.m).padStart(2, '0')}`;
  if (d.m && d.d) s += `-${String(d.d).padStart(2, '0')}`;
  if (era === 'BCE') s += ' BCE';
  return d.approx ? `c. ${s}` : s;
}

/** Convert for rendering libraries. Handles years 0–99 and negatives, which `new Date(y, …)` mangles. */
export function toJsDate(d: HistDate): Date {
  const dt = new Date(Date.UTC(2000, (d.m ?? 1) - 1, d.d ?? 1));
  dt.setUTCFullYear(d.y);
  return dt;
}

/** Convert back from a rendering library (e.g. after a drag). Keeps day precision. */
export function fromJsDate(dt: Date): HistDate {
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** An entry's dates in words: a range, "Born …" for the living, "Founded …" for a place still there, or what's known of a place. */
export function formatItemDates(i: { kind: string; subject?: string; start?: HistDate; end?: HistDate }): string {
  if (!i.start) return i.end ? `Abandoned ${formatHistDate(i.end)}` : 'Dates not known';
  if (!i.end && i.kind === 'person') return `Born ${formatHistDate(i.start)}`;
  if (!i.end && i.subject === 'place') return `Founded ${formatHistDate(i.start)}`;
  return formatRange(i.start, i.end);
}

/** Has a start date, so it can go on the timeline (only a place may lack one). */
export const isDated = <T extends { start?: HistDate }>(i: T): i is T & { start: HistDate } => !!i.start;

/** Fractional astronomical year, for positioning series points and comparing dates. */
export function toDecimalYear(d: HistDate): number {
  if (!d.m) return d.y;
  const start = Date.UTC(2000, 0, 1);
  const dayOfYear = (Date.UTC(2000, d.m - 1, d.d ?? 1) - start) / 86_400_000;
  return d.y + dayOfYear / 366;
}

export function decimalYearToJsDate(x: number): Date {
  const y = Math.floor(x);
  const dt = new Date(Date.UTC(2000, 0, 1) + (x - y) * 366 * 86_400_000);
  dt.setUTCFullYear(y);
  return dt;
}

export function jsDateToDecimalYear(dt: Date): number {
  // Mirror decimalYearToJsDate: measure the offset inside a fixed leap year (2000).
  const inYear2000 = Date.UTC(2000, dt.getUTCMonth(), dt.getUTCDate(), dt.getUTCHours(), dt.getUTCMinutes(), dt.getUTCSeconds());
  return dt.getUTCFullYear() + (inYear2000 - Date.UTC(2000, 0, 1)) / (366 * 86_400_000);
}

/* ---------- Axis ticks (the new timeline: no JS Date, so deep time works) ---------- */

export interface AxisTick {
  /** Decimal year. */
  y: number;
  label: string;
  major: boolean;
}

export interface AxisTicks {
  ticks: AxisTick[];
  /** Month or year headings for a second row when the ticks are days or months. */
  heads: AxisTick[];
  unit: 'day' | 'week' | 'month' | 'quarter' | 'year';
  /** Years between ticks when the unit is 'year'. */
  step: number;
}

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const YEAR_STEPS = [1e6, 5e5, 2e5, 1e5, 5e4, 2e4, 1e4, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number) => (m === 2 ? (isLeap(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31);

/**
 * A tick's year label. Steps of 10 years or more use round numbers (`formatAxisYear`);
 * finer steps name the exact year. Deep time reads in words: "2.8 million BCE".
 */
export function formatTickYear(y: number, step = 1): string {
  const a = Math.abs(y);
  if (a >= 10_000) {
    const era = y < 0 ? 'BCE' : 'CE';
    if (a >= 1_000_000) return `${+(a / 1e6).toFixed(1)} million ${era}`;
    return `${a.toLocaleString('en-US')} ${era}`;
  }
  return step >= 10 ? formatAxisYear(y) : formatYear(y);
}

/**
 * Ticks for the window `start`..`end` (decimal years) drawn `widthPx` wide: the finest
 * unit whose ticks are still at least `minPx` apart, from a million years down to a day.
 */
export function axisTicks(start: number, end: number, widthPx: number, minPx = 74): AxisTicks {
  const span = end - start;
  const ppy = widthPx / Math.max(span, 1e-9);
  const ticks: AxisTick[] = [];
  const heads: AxisTick[] = [];
  const y0 = Math.floor(start), y1 = Math.floor(end);
  // Days (a day is 1/366 of a year in toDecimalYear).
  const dayPx = ppy / 366;
  if (span < 3 && dayPx * 7 >= minPx * 0.6) {
    const step = dayPx >= 28 ? 1 : 7;
    for (let y = y0; y <= y1; y++) {
      for (let m = 1; m <= 12; m++) {
        const first = toDecimalYear({ y, m, d: 1 });
        if (first > end || first + 32 / 366 < start) continue;
        heads.push({ y: first, label: `${MONTHS_LONG[m - 1]} ${formatYear(y)}`, major: true });
        for (let d = 1; d <= daysIn(y, m); d += step) {
          const t = toDecimalYear({ y, m, d });
          if (t >= start && t <= end) ticks.push({ y: t, label: String(d), major: d === 1 });
        }
      }
    }
    return { ticks, heads, unit: step === 1 ? 'day' : 'week', step: 0 };
  }
  // Months, then quarters.
  for (const step of [1, 3]) {
    if (span < 60 && (ppy / 12) * step >= minPx * 0.55) {
      for (let y = y0; y <= y1; y++) {
        for (let m = 1; m <= 12; m += step) {
          const t = toDecimalYear({ y, m, d: 1 });
          if (t >= start && t <= end) ticks.push({ y: t, label: MONTHS[m - 1], major: m === 1 });
        }
        heads.push({ y, label: formatYear(y), major: true });
      }
      return { ticks, heads, unit: step === 1 ? 'month' : 'quarter', step: 0 };
    }
  }
  // Years: the finest round step that leaves room for the labels.
  const step = YEAR_STEPS.slice().reverse().find((s) => s * ppy >= minPx) ?? YEAR_STEPS[0];
  for (let y = Math.ceil(start / step) * step; y <= end && ticks.length <= 400; y += step) {
    ticks.push({ y, label: formatTickYear(y, step), major: y % (step * 5) === 0 });
  }
  return { ticks, heads, unit: 'year', step };
}

export function compareHistDate(a: HistDate, b: HistDate): number {
  return toDecimalYear(a) - toDecimalYear(b);
}

/* ---------- Moving dates (dragging an entry on the timeline) ---------- */

/** How finely a date is known: to the year, the month or the day. */
export type Precision = 'year' | 'month' | 'day';
const FINENESS: Record<Precision, number> = { year: 0, month: 1, day: 2 };

export function precisionOf(d: HistDate): Precision {
  return d.m ? (d.d ? 'day' : 'month') : 'year';
}

/** The coarser of two precisions. */
export function coarser(a: Precision, b: Precision): Precision {
  return FINENESS[a] <= FINENESS[b] ? a : b;
}

const clampYear = (y: number) => Math.min(MAX_YEAR, Math.max(MIN_YEAR, y));

/**
 * Move a date by about `years`, in whole steps of `unit` (never finer than the
 * date itself is known), keeping its precision and its "c.": a year stays a
 * year, a month a month. A day that the new month lacks becomes its last day.
 */
export function shiftHistDate(d: HistDate, years: number, unit: Precision = precisionOf(d)): HistDate {
  const step = coarser(unit, precisionOf(d));
  const fitDay = (y: number, m?: number) => (m && d.d ? Math.min(d.d, daysInMonth(y, m)) : undefined);
  const out = (y: number, m?: number, day?: number): HistDate => ({
    y, ...(m ? { m } : {}), ...(day ? { d: day } : {}), ...(d.approx ? { approx: true } : {}),
  });
  if (step === 'year') {
    const y = clampYear(d.y + Math.round(years));
    return out(y, d.m, fitDay(y, d.m));
  }
  if (step === 'month') {
    const total = d.y * 12 + (d.m! - 1) + Math.round(years * 12);
    const y = clampYear(Math.floor(total / 12));
    const m = y === Math.floor(total / 12) ? total - y * 12 + 1 : d.m!;
    return out(y, m, fitDay(y, m));
  }
  const dt = toJsDate(d);
  dt.setUTCDate(dt.getUTCDate() + Math.round(years * 365.25));
  const moved = fromJsDate(dt);
  return moved.y < MIN_YEAR || moved.y > MAX_YEAR ? d : out(moved.y, moved.m, moved.d);
}

/** A date cut back to `p`: 12 Mar 431 BCE to the year is 431 BCE. */
function trimTo(d: HistDate, p: Precision, approx?: boolean): HistDate {
  return { y: d.y, ...(p !== 'year' && d.m ? { m: d.m } : {}), ...(p === 'day' && d.d ? { d: d.d } : {}), ...(approx ? { approx: true } : {}) };
}

/**
 * New dates for an entry dragged by `years`. The whole entry ('body') moves
 * both dates by the same whole number of the coarser unit, so its length is
 * kept; one end moves on its own, and never past the other end.
 */
export function moveDates<T extends { start: HistDate; end?: HistDate }>(item: T, years: number, part: 'body' | 'start' | 'end' = 'body'): T {
  const { start, end } = item;
  if (part === 'body') {
    const unit = end ? coarser(precisionOf(start), precisionOf(end)) : precisionOf(start);
    return { ...item, start: shiftHistDate(start, years, unit), ...(end ? { end: shiftHistDate(end, years, unit) } : {}) };
  }
  if (part === 'start') {
    const s = shiftHistDate(start, years);
    return { ...item, start: end && compareHistDate(s, end) > 0 ? trimTo(end, precisionOf(start), start.approx) : s };
  }
  if (!end) return item;
  const e = shiftHistDate(end, years);
  return { ...item, end: compareHistDate(e, start) < 0 ? trimTo(start, precisionOf(end), end.approx) : e };
}

/**
 * Read a Wikidata time value ("+1815-12-10T00:00:00Z" with a precision code).
 * Wikidata's JSON writes BCE years in historical numbering ("-0490" = 490 BCE),
 * so they're converted to astronomical here. Precision: 11 day, 10 month,
 * 9 year; anything coarser (decade, century…) becomes an approximate year.
 * Dates before 1582 are usually Julian; the day and month are kept as written,
 * which is how historians cite them. A day the Gregorian calendar lacks
 * (29 Feb 1500) is dropped, keeping the month. Returns null if unreadable.
 */
/**
 * Our World in Data year to astronomical. OWID counts BCE years as plain negatives
 * (-10000 is 10,000 BCE) with no year 0 between them, so negatives shift by one.
 * A stray year 0 is kept as is.
 */
export function fromOwidYear(y: number): number {
  return y < 0 ? y + 1 : y;
}

export function fromWikidataTime(time: string, precision: number, approx = false): HistDate | null {
  const m = time.match(/^([+-])(\d+)-(\d{2})-(\d{2})T/);
  if (!m) return null;
  const year = Number(m[2]);
  if (year < 1) return null;
  const d: HistDate = { y: toAstronomical(year, m[1] === '-' ? 'BCE' : 'CE') };
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (precision >= 10 && month >= 1) d.m = month;
  if (precision >= 11 && d.m && day >= 1) d.d = day;
  if (precision < 9 || approx) d.approx = true;
  if (d.d && !isValidHistDate(d)) delete d.d;
  return isValidHistDate(d) ? d : null;
}
