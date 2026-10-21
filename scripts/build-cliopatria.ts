// Builds Seshat's polity borders in public/data/borders/ from Cliopatria
// (github.com/Seshat-Global-History-Databank/cliopatria, CC BY 4.0): one file per polity,
// with its snapshots in Chronicle's shape, and index.json to find them by Wikidata id,
// Wikipedia title or name. The app fetches them when needed; they are never precached.
// Run again to pick up a new release:  node scripts/build-cliopatria.ts [--tolerance 0.01]
// The download is kept in node_modules/.cache/cliopatria/.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import type { CliopatriaFile, CliopatriaIndex, CliopatriaPolity } from '../src/data/cliopatria.ts';
import { isArea, simplifyArea, type Area } from '../src/data/geo.ts';
import { fromOwidYear } from '../src/model/dates.ts';
import type { TerritorySnapshot } from '../src/model/types.ts';

const CLIOPATRIA_RELEASE = 'v0.2.1';
const ZIP = `https://raw.githubusercontent.com/Seshat-Global-History-Databank/cliopatria/${CLIOPATRIA_RELEASE}/cliopatria.geojson.zip`;
const CACHE = new URL('../node_modules/.cache/cliopatria/', import.meta.url);
const OUT = new URL('../public/data/borders/', import.meta.url);
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const TOLERANCE = Number(arg('--tolerance') ?? 0.01);

interface Row {
  type: 'Feature';
  geometry: Area | null;
  properties: { Name: string; FromYear: number; ToYear: number; Area: number; Type: 'POLITY' | 'RELATION'; Wikipedia: string; Wikidata: string };
}

async function download(): Promise<URL> {
  mkdirSync(CACHE, { recursive: true });
  const zip = new URL(`${CLIOPATRIA_RELEASE}.zip`, CACHE);
  if (existsSync(zip)) return zip;
  console.log(`Downloading ${ZIP}…`);
  const res = await fetch(ZIP);
  if (!res.ok) throw new Error(`${ZIP}: ${res.status}`);
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  return zip;
}

const zip = await download();
const unzipped = spawnSync('unzip', ['-p', zip.pathname], { maxBuffer: 1024 ** 3 });
if (unzipped.status !== 0) throw new Error(`unzip failed: ${unzipped.stderr}`);
const rows = (JSON.parse(unzipped.stdout.toString('utf8')) as { features: Row[] }).features;

// RELATION rows are alliances, allegiances, vassalage and personal unions drawn over their members,
// with one member's Wikidata id; they're skipped (see docs/decisions.md).
const byName = new Map<string, Row[]>();
for (const r of rows) if (r.properties.Type === 'POLITY' && isArea(r.geometry)) {
  const list = byName.get(r.properties.Name) ?? [];
  list.push(r);
  byName.set(r.properties.Name, list);
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
function bbox(g: Area): [number, number, number, number] {
  const b: [number, number, number, number] = [180, 90, -180, -90];
  for (const poly of g.type === 'Polygon' ? [g.coordinates] : g.coordinates) for (const [x, y] of poly[0]) {
    b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
  }
  // Whole degrees, rounded outwards, so a point inside is always inside its box.
  return [Math.floor(b[0]), Math.floor(b[1]), Math.ceil(b[2]), Math.ceil(b[3])];
}
/** A file name from a polity's name: "Achaemenid Empire" → achaemenid-empire; a group "(Macedonian Empire)" → macedonian-empire-group. */
const cliopatriaId = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + (name.startsWith('(') ? '-group' : '');
const distinct = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

if (existsSync(OUT)) for (const f of readdirSync(OUT)) rmSync(new URL(f, OUT));
mkdirSync(OUT, { recursive: true });

const index: CliopatriaIndex = { release: CLIOPATRIA_RELEASE, polities: [] };
const ids = new Set<string>();
let bytes = 0, largest = { id: '', kb: 0 };
for (const [name, list] of byName) {
  list.sort((a, b) => a.properties.FromYear - b.properties.FromYear);
  // Names that differ only by accents ("Han", "Hàn") are numbered in the order Cliopatria lists them.
  let id = cliopatriaId(name);
  for (let n = 2; ids.has(id); n++) id = `${cliopatriaId(name)}-${n}`;
  ids.add(id);
  const snapshots: TerritorySnapshot[] = [];
  const boxes: CliopatriaPolity['rows'] = [];
  for (const r of list) {
    const geometry = simplifyArea(r.geometry!, TOLERANCE, 3);
    if (!geometry) continue;
    // Inclusive years, historian's negatives; Chronicle's `to` is the first year after.
    const prev = snapshots.at(-1);
    const from = Math.max(fromOwidYear(r.properties.FromYear), prev?.to?.y ?? -Infinity);
    const to = fromOwidYear(r.properties.ToYear) + 1;
    if (to <= from) continue;
    const areaKm2 = Math.round(r.properties.Area);
    // Rows split when Seshat's other data changes; the same borders carry on.
    if (prev && prev.to?.y === from && JSON.stringify(prev.geometry) === JSON.stringify(geometry)) {
      prev.to = { y: to };
      boxes.at(-1)![1] = to;
      continue;
    }
    snapshots.push({ from: { y: from }, to: { y: to }, geometry, areaKm2 });
    boxes.push([from, to, ...bbox(geometry)]);
  }
  if (!snapshots.length) continue;
  const file: CliopatriaFile = { id, name, snapshots };
  const text = JSON.stringify(file);
  writeFileSync(new URL(`${id}.json`, OUT), text);
  bytes += text.length;
  if (text.length / 1024 > largest.kb) largest = { id, kb: Math.round(text.length / 1024) };
  index.polities.push({
    id, name,
    ...(name.startsWith('(') ? { group: true } : {}),
    wikidata: distinct(list.map((r) => r.properties.Wikidata)),
    wikipedia: distinct(list.map((r) => r.properties.Wikipedia)),
    rows: boxes.map((b) => b.map((n) => round(n, 0)) as CliopatriaPolity['rows'][number]),
  });
}
const indexText = JSON.stringify(index);
writeFileSync(new URL('index.json', OUT), indexText);
console.log(`${index.polities.length} polities, ${index.polities.reduce((n, p) => n + p.rows.length, 0)} snapshots at tolerance ${TOLERANCE}`);
console.log(`files: ${(bytes / 1024 / 1024).toFixed(1)} MB in all, largest ${largest.id} ${largest.kb} KB; index.json ${(indexText.length / 1024).toFixed(0)} KB`);
