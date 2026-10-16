import { fromOwidYear, parseHistDate, toDecimalYear } from '../model/dates';
import type { SeriesPoint } from '../model/types';

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export interface PointsResult {
  points: SeriesPoint[];
  errors: string[];
}

/**
 * Parse what someone pastes into the series editor: one "year, value" pair per
 * line. Years accept anything parseHistDate does ("431 BCE", "1914-07").
 * Values may use thousands separators. Blank lines and #comments are skipped.
 */
export function parsePointsText(text: string): PointsResult {
  const points: SeriesPoint[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const m = line.match(/^(.+?)\s*[,;\t]\s*(.+)$/);
    if (!m) { errors.push(`Line ${idx + 1}: expected "year, value"`); return; }
    const d = parseHistDate(m[1]);
    const v = Number(m[2].replace(/[,_\s]/g, ''));
    if (!d) { errors.push(`Line ${idx + 1}: "${m[1]}" isn't a date`); return; }
    if (!Number.isFinite(v)) { errors.push(`Line ${idx + 1}: "${m[2]}" isn't a number`); return; }
    points.push({ x: toDecimalYear(d), v });
  });
  points.sort((a, b) => a.x - b.x);
  return { points, errors };
}

export function pointsToText(points: SeriesPoint[]): string {
  return points
    .map((p) => {
      const y = Math.round(p.x);
      const year = y <= 0 ? `${1 - y} BCE` : String(y);
      return `${year}, ${p.v}`;
    })
    .join('\n');
}

/** A downloaded dataset: values per entity (country or region) and indicator. */
export interface TrendTable {
  entities: string[];
  indicators: string[];
  /** Points for one entity and indicator. */
  pointsFor(entity: string, indicator: string): SeriesPoint[];
  /**
   * Points for every country, keyed by ISO 3166-1 alpha-3 code, for coloring
   * the map. Aggregates (world, continents, income groups) are left out.
   */
  countriesFor(indicator: string): Record<string, SeriesPoint[]>;
}

export type OwidTable = TrendTable;

/**
 * Read an Our World in Data grapher CSV (columns: Entity, Code, Year, …indicators).
 * OWID writes BCE years as plain negatives (-10000 is 10,000 BCE); they're converted to astronomical.
 */
export function parseOwidCsv(text: string): TrendTable {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('The file has no data rows.');
  const header = rows[0].map((h) => h.trim());
  const ei = header.indexOf('Entity');
  const yi = header.findIndex((h) => h === 'Year' || h === 'Day');
  if (ei < 0 || yi < 0) throw new Error('This doesn’t look like an Our World in Data CSV (no Entity and Year columns).');
  const ci = header.indexOf('Code');
  const skip = new Set([ei, yi, ci]);
  const indicatorCols = header.map((h, i) => ({ h, i })).filter(({ i }) => !skip.has(i));
  if (!indicatorCols.length) throw new Error('The file has no indicator columns.');
  const data = rows.slice(1);
  const entities = [...new Set(data.map((r) => r[ei]))].sort();
  const table: TrendTable = {
    entities,
    indicators: indicatorCols.map((c) => c.h),
    countriesFor(indicator) {
      if (ci < 0) return {};
      const out: Record<string, SeriesPoint[]> = {};
      const codes = new Map<string, string>();
      for (const r of data) if (/^[A-Z]{3}$/.test(r[ci] ?? '')) codes.set(r[ei], r[ci]);
      for (const [entity, code] of codes) {
        const pts = table.pointsFor(entity, indicator);
        if (pts.length) out[code] = pts;
      }
      return out;
    },
    pointsFor(entity, indicator) {
      const col = indicatorCols.find((c) => c.h === indicator);
      if (!col) return [];
      return data
        .filter((r) => r[ei] === entity && r[col.i] !== '' && r[col.i] !== undefined)
        // "Year" columns hold integers; "Day" columns hold ISO dates like 2020-01-22.
        .map((r) => ({ x: /^-?\d+$/.test(r[yi]) ? fromOwidYear(Number(r[yi])) : Number(r[yi].slice(0, 4)), v: Number(r[col.i]) }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.v))
        .sort((a, b) => a.x - b.x);
    },
  };
  return table;
}

/** Accept a chart page URL and return its CSV URL (append ".csv"). */
export function owidCsvUrl(input: string): string {
  const url = new URL(input.trim());
  if (!url.hostname.endsWith('ourworldindata.org') || !url.pathname.startsWith('/grapher/')) {
    throw new Error('Paste a link to an Our World in Data chart, like https://ourworldindata.org/grapher/population');
  }
  if (!url.pathname.endsWith('.csv')) url.pathname += '.csv';
  url.search = '?v=1&csvType=full&useColumnShortNames=false';
  return url.toString();
}

interface WorldBankRow {
  indicator: { id: string; value: string };
  country: { id: string; value: string };
  countryiso3code: string;
  date: string;
  value: number | null;
}

/**
 * Read a World Bank API response (`/v2/country/all/indicator/<id>?format=json`):
 * `[meta, rows]`, or `[{ message }]` on error. `aggregates` are the codes of regions
 * and income groups, which stay choosable by name but don't color the map.
 */
export function parseWorldBankJson(body: unknown, aggregates: Iterable<string>): TrendTable {
  if (!Array.isArray(body)) throw new Error('The World Bank sent something unexpected.');
  const [meta, rows] = body as [{ message?: { value?: string }[] }, WorldBankRow[] | null];
  if (meta?.message?.length) throw new Error(`The World Bank says: ${meta.message[0].value ?? 'unknown error'}`);
  const data = (rows ?? []).filter((r) => r.value !== null && Number.isFinite(r.value) && /^\d{4}$/.test(r.date));
  if (!data.length) throw new Error('The World Bank has no values for this indicator.');
  const skip = new Set(aggregates);
  const indicator = data[0].indicator.value;
  const byEntity = new Map<string, SeriesPoint[]>();
  const codes = new Map<string, string>();
  for (const r of data) {
    const name = r.country.value;
    if (!byEntity.has(name)) byEntity.set(name, []);
    byEntity.get(name)!.push({ x: Number(r.date), v: r.value as number });
    if (/^[A-Z]{3}$/.test(r.countryiso3code) && !skip.has(r.countryiso3code)) codes.set(name, r.countryiso3code);
  }
  for (const pts of byEntity.values()) pts.sort((a, b) => a.x - b.x);
  return {
    entities: [...byEntity.keys()].sort(),
    indicators: [indicator],
    pointsFor: (entity, ind) => (ind === indicator ? byEntity.get(entity) ?? [] : []),
    countriesFor(ind) {
      if (ind !== indicator) return {};
      return Object.fromEntries([...codes].map(([name, code]) => [code, byEntity.get(name)!]));
    },
  };
}
