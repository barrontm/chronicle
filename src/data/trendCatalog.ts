import { formatYear } from '../model/dates';

/**
 * One searchable dataset in the bundled catalogue (public/data/trend-index.json,
 * built by scripts/build-trend-index.ts). Keys are short to keep the file small.
 */
export interface TrendRef {
  /** Source: Our World in Data chart or World Bank indicator. */
  s: 'owid' | 'wb';
  /** Chart slug ("population") or indicator code ("SP.POP.TOTL"). */
  id: string;
  /** Title. */
  t: string;
  /** Unit. */
  u?: string;
  /** First and last year with data (astronomical), when the source says. */
  from?: number;
  to?: number;
  /** One-line description. */
  d?: string;
  /** Citation (OWID). */
  c?: string;
  /** Topics (World Bank). */
  k?: string;
}

export interface TrendIndex {
  built: string;
  /** World Bank codes that are regions or income groups, not countries. */
  wbAggregates: string[];
  items: TrendRef[];
}

export const SOURCE_NAMES: Record<TrendRef['s'], string> = { owid: 'Our World in Data', wb: 'World Bank' };

/** World Bank indicators mostly start in 1960; the API doesn't say per indicator. */
const WB_FROM = 1960;

export interface TrendFilter {
  source?: TrendRef['s'];
  /** Only datasets that go back before this year (astronomical). */
  before?: number;
}

const words = (text: string): string[] => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]+/g) ?? [];

/** Words the sources use for the same thing (World Bank says "female", Bob may type "women"). */
const SYNONYMS: Record<string, string[]> = {
  women: ['female', 'females', 'woman'], woman: ['female', 'women'], female: ['women', 'woman'],
  men: ['male', 'males', 'man'], man: ['male', 'men'], male: ['men', 'man'],
  children: ['child', 'kids'], child: ['children'], kids: ['children', 'child'],
  emigration: ['emigrants', 'migrant', 'migration'], immigration: ['immigrants', 'migrant', 'migration'],
  immigrants: ['migrant', 'immigration'], emigrants: ['migrant', 'emigration'],
  economy: ['gdp', 'economic'], wealth: ['gdp', 'income'], money: ['gdp', 'income'],
  people: ['population'], deaths: ['mortality', 'death'], births: ['fertility', 'birth'],
};

/**
 * Datasets matching every word of the query, best first. A word matches the
 * start of a word in the title (scores most), topics or description.
 */
export function searchTrends(index: TrendIndex, query: string, filter: TrendFilter = {}, limit = 50): TrendRef[] {
  const q = words(query);
  if (!q.length) return [];
  const scored: { r: TrendRef; score: number }[] = [];
  for (const r of index.items) {
    if (filter.source && r.s !== filter.source) continue;
    if (filter.before !== undefined && (r.from ?? (r.s === 'wb' ? WB_FROM : Infinity)) >= filter.before) continue;
    const title = words(r.t);
    const rest = words(`${r.k ?? ''} ${r.d ?? ''} ${r.u ?? ''}`);
    let score = 0;
    for (const w of q) {
      const alts = [w, ...(SYNONYMS[w] ?? [])];
      if (alts.some((a) => title.includes(a))) score += 10;
      else if (alts.some((a) => title.some((t) => t.startsWith(a)))) score += 6;
      else if (alts.some((a) => rest.some((t) => t.startsWith(a)))) score += 2;
      else { score = 0; break; }
    }
    if (!score) continue;
    // Prefer short, focused titles ("Population" over "Population of women aged 15–19"),
    // and long histories for a history app.
    score -= title.length * 0.3;
    if (r.from !== undefined && r.from < 1800) score += 2;
    scored.push({ r, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.r.t.localeCompare(b.r.t)).slice(0, limit).map((x) => x.r);
}

/** "10,000 BCE – 2023", "Since 1960s" for World Bank, or '' when unknown. */
export function yearsLabel(r: TrendRef): string {
  if (r.from !== undefined && r.to !== undefined) return r.from === r.to ? formatYear(r.from) : `${formatYear(r.from)} – ${formatYear(r.to)}`;
  return r.s === 'wb' ? 'Mostly 1960 on' : '';
}

/** Where to fetch the numbers for a dataset. */
export function dataUrl(r: TrendRef): string {
  return r.s === 'owid'
    ? `https://ourworldindata.org/grapher/${r.id}.csv?v=1&csvType=full&useColumnShortNames=false`
    : `https://api.worldbank.org/v2/country/all/indicator/${encodeURIComponent(r.id)}?format=json&per_page=20000`;
}

/** The page a person can visit to read about a dataset (saved as the trend's source link). */
export function pageUrl(r: TrendRef): string {
  return r.s === 'owid'
    ? `https://ourworldindata.org/grapher/${r.id}`
    : `https://data.worldbank.org/indicator/${encodeURIComponent(r.id)}`;
}
