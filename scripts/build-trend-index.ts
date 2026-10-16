// Builds the bundled trend catalogue in public/data/trend-index.json: what can be searched
// in "Find a trend". It lists datasets (titles, units, years), never their numbers, which
// are fetched when Bob picks one. Run now and then to pick up new charts:
//   node scripts/build-trend-index.ts
// The output is committed so search works offline.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { TrendIndex, TrendRef } from '../src/data/trendCatalog.ts';
import { fromOwidYear } from '../src/model/dates.ts';

const OUT = new URL('../public/data/', import.meta.url);

async function json<T>(url: string, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

/** Plain text, one line, cut at a word boundary. */
function short(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined;
  const t = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t || undefined;
  return t.slice(0, t.lastIndexOf(' ', max)).replace(/[,;:]$/, '') + '…';
}

const firstSentence = (text: string | undefined) => text?.match(/^.*?[.!?](\s|$)/)?.[0] ?? text;

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  let done = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
      if (++done % 250 === 0) console.log(`  ${done}/${items.length}`);
    }
  }));
  return out;
}

interface OwidMeta {
  chart: { title?: string; subtitle?: string; citation?: string };
  columns: Record<string, { titleShort?: string; unit?: string; shortUnit?: string; timespan?: string; descriptionShort?: string; type?: string }>;
}

async function owid(): Promise<TrendRef[]> {
  const xml = await (await fetch('https://ourworldindata.org/sitemap.xml')).text();
  const slugs = [...new Set([...xml.matchAll(/<loc>https:\/\/ourworldindata\.org\/grapher\/([^<?#]+)<\/loc>/g)].map((m) => m[1]))];
  console.log(`Our World in Data: ${slugs.length} charts`);
  const refs = await pool(slugs, 8, async (slug): Promise<TrendRef | null> => {
    let meta: OwidMeta;
    try { meta = await json<OwidMeta>(`https://ourworldindata.org/grapher/${slug}.metadata.json`); }
    catch { return null; }
    // Skip helper columns like "World region according to OWID".
    const col = Object.values(meta.columns ?? {}).find((c) => c.type !== 'Ordinal' && c.type !== 'Categorical' && !/^World region/.test(c.titleShort ?? ''))
      ?? Object.values(meta.columns ?? {})[0];
    const span = col?.timespan?.match(/^(-?\d+)-(-?\d+)$/);
    const title = meta.chart?.title?.trim();
    if (!title) return null;
    return {
      s: 'owid', id: slug, t: title,
      u: col?.unit || undefined,
      from: span ? fromOwidYear(Number(span[1])) : undefined,
      to: span ? fromOwidYear(Number(span[2])) : undefined,
      d: short(col?.descriptionShort || meta.chart.subtitle, 160),
      c: short(meta.chart.citation, 60),
    };
  });
  // OWID publishes some charts under several slugs; keep the shortest slug of identical ones.
  const seen = new Set<string>();
  return refs
    .filter((r): r is TrendRef => r !== null)
    .sort((a, b) => a.id.length - b.id.length)
    .filter((r) => {
      const key = JSON.stringify([r.t, r.c, r.u, r.from, r.to]);
      return !seen.has(key) && !!seen.add(key);
    });
}

type WbPage<T> = [{ pages: number; total: number }, T[]];

async function worldBank(): Promise<{ refs: TrendRef[]; aggregates: string[] }> {
  const [, indicators] = await json<WbPage<{ id: string; name: string; unit: string; sourceNote: string; sourceOrganization: string; topics: { value?: string }[] }>>(
    'https://api.worldbank.org/v2/source/2/indicator?format=json&per_page=5000',
  );
  console.log(`World Bank: ${indicators.length} indicators`);
  const refs: TrendRef[] = indicators.map((i) => ({
    s: 'wb', id: i.id, t: i.name.trim(),
    u: i.unit || undefined,
    d: short(firstSentence(i.sourceNote), 160),
    k: i.topics.map((t) => t.value?.trim()).filter(Boolean).join(', ') || undefined,
  }));
  const [, countries] = await json<WbPage<{ id: string; region: { value: string } }>>('https://api.worldbank.org/v2/country?format=json&per_page=500');
  const aggregates = countries.filter((c) => c.region.value.trim() === 'Aggregates').map((c) => c.id).sort();
  return { refs, aggregates };
}

const [o, wb] = await Promise.all([owid(), worldBank()]);
const index: TrendIndex = { built: new Date().toISOString().slice(0, 10), wbAggregates: wb.aggregates, items: [...o, ...wb.refs] };
mkdirSync(OUT, { recursive: true });
const text = JSON.stringify(index);
writeFileSync(new URL('trend-index.json', OUT), text);
console.log(`trend-index.json: ${index.items.length} trends, ${(text.length / 1024).toFixed(0)} KB`);
