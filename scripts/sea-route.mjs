// Finds a sea route between ports that never crosses land, for drafting campaign routes and flows of goods.
//   node scripts/sea-route.mjs --stops "23.64,37.94;23.3,36.4;21.67,36.93" [--land file.geojson] [--cell 0.02] [--carve "29.12,41.22;29.05,41.1;28.98,41.0"]
// Stops are lon,lat separated by ";": the first and last are the ports, the ones between are capes or waters
// to pass by (Piraeus, Cape Malea, Pylos above). Land defaults to the bundled 50m countries (offline); pass
// Natural Earth's ne_10m_land for coastlines fine enough for the Aegean islands. A strait narrower than a
// cell can be closed on the raster: open it with --carve, a line of water that follows the strait (it turns
// land into sea, so a line across a peninsula opens a canal). Repeatable. Prints [[lon, lat], …].
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Outer and inner rings of every polygon in a GeoJSON FeatureCollection that touch the box [w, s, e, n]. */
export function landRings(geojson, [w, s, e, n]) {
  const rings = [];
  for (const f of geojson.features) {
    const g = f.geometry;
    const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      for (const ring of poly) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        if (x1 >= w && x0 <= e && y1 >= s && y0 <= n) rings.push(ring);
      }
    }
  }
  return rings;
}

/**
 * Shortest route through water from stop to stop on a raster of the land, kept a little off the coast
 * (`buffer` cells, as ancient ships hugged coasts but not rocks), then straightened where the line of
 * sight is clear. Coordinates are [lon, lat]; `cell` is in degrees of latitude.
 */
export function seaRoute(rings, stops, { cell = 0.02, buffer = 2, carve = [], pad = 1.5 } = {}) {
  if (stops.length < 2) throw new Error('A route needs at least two stops.');
  const lons = stops.map((p) => p[0]), lats = stops.map((p) => p[1]);
  const box = [Math.min(...lons) - pad, Math.min(...lats) - pad, Math.max(...lons) + pad, Math.max(...lats) + pad];
  const kx = Math.cos((((box[1] + box[3]) / 2) * Math.PI) / 180);
  const W = Math.ceil(((box[2] - box[0]) * kx) / cell), H = Math.ceil((box[3] - box[1]) / cell);
  const toGrid = ([lon, lat]) => [((lon - box[0]) * kx) / cell, (box[3] - lat) / cell];
  const toLonLat = (i) => [round3(box[0] + (((i % W) + 0.5) * cell) / kx), round3(box[3] - (Math.floor(i / W) + 0.5) * cell)];

  // land raster: scanline fill of each ring on its own, so neighbouring countries that overlap at their
  // borders stay land, and lakes count as land too (a fleet can't reach them)
  const land = new Uint8Array(W * H);
  const grid = rings.map((r) => r.map(toGrid));
  for (let gy = 0; gy < H; gy++) {
    const y = gy + 0.5;
    for (const r of grid) {
      const xs = [];
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i], [xj, yj] = r[j];
        if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let gx = Math.max(0, Math.ceil(xs[k] - 0.5)); gx < W && gx + 0.5 <= xs[k + 1]; gx++) land[gy * W + gx] = 1;
      }
    }
  }
  for (const [a, b] of carve) {
    const [ax, ay] = toGrid(a), [bx, by] = toGrid(b), n = Math.ceil(Math.hypot(bx - ax, by - ay) * 2) || 1;
    for (let i = 0; i <= n; i++) {
      const gx = Math.floor(ax + ((bx - ax) * i) / n), gy = Math.floor(ay + ((by - ay) * i) / n);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const x = gx + dx, y = gy + dy;
        if (x >= 0 && y >= 0 && x < W && y < H) land[y * W + x] = 0;
      }
    }
  }

  // distance to land in cells, to keep routes off the coast
  const dist = new Int32Array(W * H).fill(-1), queue = [];
  for (let i = 0; i < W * H; i++) if (land[i]) { dist[i] = 0; queue.push(i); }
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h], x = i % W, y = Math.floor(i / W);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (dist[j] < 0) { dist[j] = dist[i] + 1; queue.push(j); }
    }
  }
  const far = (i) => dist[i] < 0 || dist[i] > buffer; // no land at all in the box counts as far
  const cost = (i) => 1 + (far(i) ? 0 : (buffer + 1 - dist[i]) * 2);

  const snap = (p, k) => {
    const [x, y] = toGrid(p), cx = Math.floor(x), cy = Math.floor(y);
    let best = -1, bd = Infinity;
    for (let r = 0; r < 60 && best < 0; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!land[j] && dist[j] !== 1 && dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = j; }
      }
    }
    if (best < 0) throw new Error(`Stop ${k + 1} (${p.join(', ')}) has no open water nearby.`);
    return best;
  };

  const clear = (a, b) => {
    const ax = a % W, ay = Math.floor(a / W), bx = b % W, by = Math.floor(b / W), n = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
    for (let k = 0; k <= n; k++) {
      const j = Math.round(ay + ((by - ay) * k) / n) * W + Math.round(ax + ((bx - ax) * k) / n);
      if (land[j] || (dist[j] >= 0 && dist[j] < Math.min(buffer, 2))) return false;
    }
    return true;
  };

  const out = [stops[0]];
  for (let k = 0; k + 1 < stops.length; k++) {
    const path = astar(land, W, H, snap(stops[k], k), snap(stops[k + 1], k + 1), cost);
    if (!path) throw new Error(`No water route from stop ${k + 1} to stop ${k + 2}; is a strait closed? Open it with --carve.`);
    const pulled = [path[0]];
    for (let i = 0; i < path.length - 1; ) {
      let j = path.length - 1;
      while (j > i + 1 && !clear(path[i], path[j])) j--;
      pulled.push(path[j]);
      i = j;
    }
    out.push(...pulled.slice(k ? 1 : 0).map(toLonLat));
  }
  out.push(stops[stops.length - 1]);
  return out;
}

const round3 = (n) => Math.round(n * 1000) / 1000;

function astar(land, W, H, start, goal, cost) {
  const g = new Float64Array(W * H).fill(Infinity), from = new Int32Array(W * H).fill(-1), done = new Uint8Array(W * H);
  const gx = goal % W, gy = Math.floor(goal / W);
  const h = (i) => Math.hypot((i % W) - gx, Math.floor(i / W) - gy);
  const heap = [];
  const push = (f, i) => {
    heap.push([f, i]);
    for (let k = heap.length - 1; k; ) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ; ) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top[1];
  };
  g[start] = 0;
  push(h(start), start);
  while (heap.length) {
    const i = pop();
    if (done[i]) continue;
    done[i] = 1;
    if (i === goal) break;
    const x = i % W, y = Math.floor(i / W);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (land[j] || done[j]) continue;
      const ng = g[i] + Math.hypot(dx, dy) * cost(j);
      if (ng < g[j]) { g[j] = ng; from[j] = i; push(ng + h(j), j); }
    }
  }
  if (start !== goal && from[goal] < 0) return null;
  const path = [];
  for (let i = goal; ; i = from[i]) { path.push(i); if (i === start) break; }
  return path.reverse();
}

const parsePoints = (s) => s.split(';').map((p) => p.split(',').map(Number));

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), opt = (name) => args[args.indexOf(name) + 1];
  if (!args.includes('--stops')) {
    console.error('usage: node scripts/sea-route.mjs --stops "lon,lat;lon,lat;…" [--land file.geojson] [--cell 0.02] [--buffer 2] [--carve "lon,lat;lon,lat"]…');
    process.exit(2);
  }
  const stops = parsePoints(opt('--stops'));
  const carve = args.flatMap((a, i) => (a === '--carve' ? [parsePoints(args[i + 1])] : []));
  const landFile = args.includes('--land') ? opt('--land') : new URL('../public/geo/countries.json', import.meta.url);
  const pad = 1.5, lons = stops.map((p) => p[0]), lats = stops.map((p) => p[1]);
  const box = [Math.min(...lons) - pad, Math.min(...lats) - pad, Math.max(...lons) + pad, Math.max(...lats) + pad];
  try {
    const route = seaRoute(landRings(JSON.parse(readFileSync(landFile, 'utf8')), box), stops, {
      cell: args.includes('--cell') ? Number(opt('--cell')) : undefined,
      buffer: args.includes('--buffer') ? Number(opt('--buffer')) : undefined,
      carve,
      pad,
    });
    console.log(JSON.stringify(route));
    console.error(`${route.length} points`);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}
