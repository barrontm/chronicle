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

export function compareHistDate(a: HistDate, b: HistDate): number {
  return toDecimalYear(a) - toDecimalYear(b);
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
