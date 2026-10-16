// Checks a draft import file (made by the draft-map-data skill) before Bob imports it.
//   node scripts/check-draft.mjs <file.json> [--bbox minLon,minLat,maxLon,maxLat]
// Runs the app's own parseDoc (loaded through Vite, so it never drifts from the app),
// then warns about drafts that would mislead: records without a source, places or
// borders outside the expected area. Exit 1 on errors, 0 with warnings.
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error('usage: node scripts/check-draft.mjs <file.json> [--bbox minLon,minLat,maxLon,maxLat]');
  process.exit(2);
}
const bboxArg = rest[rest.indexOf('--bbox') + 1];
const bbox = rest.includes('--bbox') ? bboxArg.split(',').map(Number) : null;

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
let doc;
try {
  const { parseDoc } = await vite.ssrLoadModule('/src/model/doc.ts');
  try {
    doc = parseDoc(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`✗ ${file} would not import:\n  ${(e.problems ?? [e.message]).join('\n  ')}`);
    process.exit(1);
  }
} finally {
  await vite.close();
}

const warnings = [];
if (doc.updatedAt > 0) warnings.push(`doc updatedAt is ${doc.updatedAt}, not 0: merging would replace Bob's title and categories with the draft's`);
const outside = ([lon, lat]) => bbox && (lon < bbox[0] || lat < bbox[1] || lon > bbox[2] || lat > bbox[3]);
const ringsOf = (g) => (g.type === 'Polygon' ? g.coordinates : g.coordinates.flat());

for (const it of doc.items) {
  if (!it.citations?.length) warnings.push(`entry "${it.title}" cites no source`);
  for (const p of it.places ?? []) if (outside([p.lon, p.lat])) warnings.push(`entry "${it.title}": place ${p.name ?? ''} (${p.lon}, ${p.lat}) is outside the bbox`);
}
for (const t of doc.territories) {
  if (!t.source) warnings.push(`territory "${t.title}" has no source`);
  for (const s of t.snapshots) {
    if (ringsOf(s.geometry).some((ring) => ring.some(outside))) warnings.push(`territory "${t.title}": a snapshot reaches outside the bbox`);
  }
}
for (const f of doc.flows) {
  if (!f.source) warnings.push(`flow "${f.title}" has no source`);
  for (const r of f.routes) for (const end of [r.from, r.to]) if ('lon' in end && outside([end.lon, end.lat])) warnings.push(`flow "${f.title}": ${end.name} is outside the bbox`);
}

const counts = ['items', 'territories', 'flows', 'relations', 'sources'].map((k) => `${doc[k].length} ${k}`).join(', ');
console.log(`✓ ${file} imports: ${counts}`);
for (const w of warnings) console.log(`  ! ${w}`);
