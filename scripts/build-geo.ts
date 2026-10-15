// Builds the bundled, offline basemap in public/geo/ from Natural Earth (public domain).
// Run once, or after changing tolerances:  node scripts/build-geo.ts
// Outputs are committed so the app never needs this at runtime.
import { writeFileSync } from 'node:fs';
import { simplifyArea, simplifyLine, isArea } from '../src/data/geo.ts';

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const OUT = new URL('../public/geo/', import.meta.url);

type FC = { type: 'FeatureCollection'; features: Array<{ type: 'Feature'; properties: Record<string, unknown>; geometry: any }> };

async function get(name: string): Promise<FC> {
  const res = await fetch(`${NE}/${name}`);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.json() as Promise<FC>;
}

function write(name: string, fc: FC) {
  const text = JSON.stringify(fc);
  writeFileSync(new URL(name, OUT), text);
  console.log(`${name}: ${fc.features.length} features, ${(text.length / 1024).toFixed(0)} KB`);
}

const areas = (fc: FC, tol: number, props: (p: Record<string, unknown>) => Record<string, unknown>): FC => ({
  type: 'FeatureCollection',
  features: fc.features.flatMap((f) => {
    const g = isArea(f.geometry) ? simplifyArea(f.geometry, tol, 2) : null;
    return g ? [{ type: 'Feature' as const, properties: props(f.properties), geometry: g }] : [];
  }),
});

const round2 = (n: number) => Math.round(n * 100) / 100;
const lines = (fc: FC, tol: number): FC => ({
  type: 'FeatureCollection',
  features: fc.features.flatMap((f) => {
    const parts: number[][][] = f.geometry?.type === 'LineString' ? [f.geometry.coordinates] : f.geometry?.type === 'MultiLineString' ? f.geometry.coordinates : [];
    const out = parts.map((l) => simplifyLine(l, tol).map(([x, y]) => [round2(x), round2(y)])).filter((l) => l.length >= 2);
    return out.length ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'MultiLineString', coordinates: out } }] : [];
  }),
});

// Natural Earth marks a few countries' ISO_A3 as -99 (France, Norway…); ADM0_A3 has the code.
const iso3 = (p: Record<string, unknown>) => {
  const a = p.ISO_A3 as string;
  return a && a !== '-99' ? a : (p.ADM0_A3 as string);
};

write('countries.json', areas(await get('ne_50m_admin_0_countries.geojson'), 0.03, (p) => ({ iso3: iso3(p), name: p.NAME as string })));
write('lakes.json', areas(await get('ne_50m_lakes.geojson'), 0.02, () => ({})));
write('rivers.json', lines(await get('ne_50m_rivers_lake_centerlines.geojson'), 0.03));
