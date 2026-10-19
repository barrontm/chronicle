// Builds the overview stress appendix (TEST DATA ONLY, never shipped in the app).
//   node tests/fixtures/overview/build.mjs
// Writes stress.json next to this file: the Classical Greece fixture (with its Phase 4 shapes from next.json) plus a
// generated world of about 120 polities in 16 regions under 3 parents, 3000 BCE to 1700 CE, with eras, world events,
// about 2,000 entries, contacts (war, alliance, trade, peace) and threads between entries. Then it inlines the same data
// and a simplified land map into docs/prototypes/polities.html, between the `overview-data` script tags.
// Polity names, dates and eras are real; extents are present-day countries or circles, a rough stand-in for test data,
// not a historical map. Generated entries ("gen": 1) have made-up generic titles and random dates, places and weights.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => JSON.parse(readFileSync(here(p), 'utf8'));
const doc = read('../greece/classical-greece.json');
const next = read('../greece/next.json').overview;
const countries = read('../../../public/geo/countries.json');

// Years below are written as historians do (-550 is 550 BCE); ast() turns them into astronomical years.
const ast = (y) => (y < 0 ? y + 1 : y);
const round = (n, k = 0) => Math.round(n * 10 ** k) / 10 ** k;

// ---------- seeded randomness ----------
let seed = 20261019;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + rnd() * (b - a);

// ---------- the land map: present-day countries, simplified and projected ----------
const BOX = [-20, -2, 150, 62];
const KX = Math.cos((30 * Math.PI) / 180);
const S = 1000 / ((BOX[2] - BOX[0]) * KX);
const proj = ([lon, lat]) => [(lon - BOX[0]) * KX * S, (BOX[3] - lat) * S];
const R = 6371;
function ringAreaKm2(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [l1, p1] = ring[i], [l2, p2] = ring[i + 1];
    a += ((l2 - l1) * Math.PI / 180) * (2 + Math.sin(p1 * Math.PI / 180) + Math.sin(p2 * Math.PI / 180));
  }
  return Math.abs((a * R * R) / 2);
}
function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let md = 0, mi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len; if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// A closed ring starts and ends on one point, so split it at the point farthest from the start.
function simplifyRing(ring, tol) {
  let m = 0, md = -1;
  ring.forEach(([x, y], i) => { const d = Math.hypot(x - ring[0][0], y - ring[0][1]); if (d > md) { md = d; m = i; } });
  return [...simplify(ring.slice(0, m + 1), tol), ...simplify(ring.slice(m), tol).slice(1)];
}
const pathOf = (rings) => rings.map((r) => 'M' + r.map((p) => proj(p).map((v) => v.toFixed(1)).join(' ')).join('L') + 'Z').join('');
const LAND = {}, AREA = {}, CENTRE = {}, LBOX = {};
const boxOf = (rings) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const r of rings) for (const p of r) { const [x, y] = proj(p); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return [x0, y0, x1, y1].map((v) => round(v, 1)); };
for (const f of countries.features) {
  const g = f.geometry, iso = f.properties.iso3;
  const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
  const rings = [];
  let area = 0, best = 0;
  for (const poly of polys) {
    const outer = poly[0];
    const a = ringAreaKm2(outer); area += a;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of outer) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (x1 < BOX[0] || x0 > BOX[2] + 40 || y1 < BOX[1] || y0 > BOX[3] + 20) continue;
    if (a > best) { best = a; CENTRE[iso] = [(x0 + x1) / 2, (y0 + y1) / 2]; }
    if (a < 900) continue;
    const s = simplifyRing(outer, 0.09);
    if (s.length >= 4) rings.push(s);
  }
  AREA[iso] = area;
  if (rings.length) { LAND[iso] = pathOf(rings); LBOX[iso] = boxOf(rings.filter((r) => ringAreaKm2(r) > area * 0.15 || ringAreaKm2(r) > 40000)); }
}
// Points that sit badly at a bounding-box centre.
Object.assign(CENTRE, { ITA: [12.5, 42.5], CHN: [110, 33], RUS: [45, 55], NOR: [10, 61], GRC: [22.3, 39.3], HRV: [16, 45.3], VNM: [106, 18], JPN: [137, 36], TUR: [33, 39], FRA: [2.5, 46.8], GBR: [-1.8, 52.8] });

// ---------- regions and their parents ----------
const PARENTS = [{ id: 'europe', label: 'Europe' }, { id: 'neareast', label: 'Near East and North Africa' }, { id: 'asia', label: 'South and East Asia' }];
const REGIONS = [
  ['Iberia', 'europe'], ['Western Europe', 'europe'], ['Italy', 'europe'], ['Greece', 'europe'], ['Macedon and the Balkans', 'europe'],
  ['North Africa', 'neareast'], ['Egypt', 'neareast'], ['Levant', 'neareast'], ['Anatolia', 'neareast'], ['Mesopotamia', 'neareast'], ['Persia', 'neareast'],
  ['India', 'asia'], ['Steppe and Central Asia', 'asia'], ['China', 'asia'], ['Korea', 'asia'], ['Japan', 'asia'],
].map(([id, parent]) => ({ id, label: id, parent }));
// The Greece fixture names its regions shorter.
const FIX_REGION = { Greece: 'Greece', Macedon: 'Macedon and the Balkans', Italy: 'Italy' };

// ---------- polities ----------
// [id, title, region, from, to, snapshots, extra]. A snapshot is [year, spec]: present-day ISO codes, '@lon,lat,km'
// circles, and a leading '+' to keep the previous snapshot's parts.
const P = [
  // Iberia
  ['tartessos', 'Tartessos', 'Iberia', -1100, -550, [[-1100, '@-6.3,37.3,90']], { approx: true }],
  ['visigoths', 'Visigothic Kingdom', 'Iberia', 418, 711, [[418, '@0.5,44,220'], [507, 'ESP PRT']]],
  ['andalus', 'Al-Andalus', 'Iberia', 711, 1031, [[711, 'ESP PRT'], [900, '@-4.5,38.5,420']]],
  ['castile', 'Castile', 'Iberia', 1035, 1479, [[1035, '@-4,42,160'], [1250, '@-4,40.3,330']]],
  ['aragon', 'Crown of Aragon', 'Iberia', 1035, 1479, [[1035, '@-0.9,42.3,90'], [1300, '@0,41,220']]],
  ['granada', 'Emirate of Granada', 'Iberia', 1238, 1492, [[1238, '@-3.6,37,110']]],
  ['portugal', 'Portugal', 'Iberia', 1139, 1700, [[1139, 'PRT']]],
  ['spain', 'Spain', 'Iberia', 1479, 1700, [[1479, 'ESP']], { strength: [[1479, 3], [1580, 5], [1648, 3], [1700, 2]] }],
  // Western Europe
  ['gauls', 'Gauls', 'Western Europe', -500, -50, [[-500, 'FRA BEL']], { approx: true }],
  ['franks', 'Frankish kingdom', 'Western Europe', 481, 843, [[481, '@2,49.5,220'], [511, 'FRA BEL'], [768, 'FRA BEL NLD DEU CHE AUT']]],
  ['hre', 'Holy Roman Empire', 'Western Europe', 962, 1700, [[962, 'DEU AUT CZE NLD BEL CHE'], [1648, 'DEU AUT CZE']]],
  ['france', 'France', 'Western Europe', 987, 1700, [[987, '@2.3,48.8,120'], [1214, '@2,47.5,360'], [1500, 'FRA']]],
  ['england', 'England', 'Western Europe', 927, 1700, [[927, '@-1.5,52.5,240']]],
  ['burgundy', 'Burgundian State', 'Western Europe', 1363, 1477, [[1363, '@4.6,47.5,140'], [1430, '@4.5,49.5,230']]],
  ['dutch', 'Dutch Republic', 'Western Europe', 1581, 1700, [[1581, 'NLD']], { strength: [[1581, 2], [1650, 4], [1700, 3]] }],
  // Italy
  ['etruscans', 'Etruscans', 'Italy', -900, -264, [[-900, '@11.5,43,120']], { approx: true }],
  ['rome_rep', 'Roman Republic', 'Italy', -509, -27, [[-509, '@12.5,41.9,40'], [-338, '@13,41.8,130'], [-264, 'ITA'], [-146, 'ITA TUN GRC ESP'], [-60, 'ITA TUN GRC ESP FRA TUR SYR']]],
  ['rome_emp', 'Roman Empire', 'Italy', -27, 395, [[-27, 'ITA FRA ESP PRT GRC TUR SYR EGY TUN DZA LBY ISR LBN JOR PSE ALB MKD BGR CHE'], [117, '+ ROU IRQ ARM GBR BEL AUT HUN SRB HRV SVN BIH MNE']]],
  ['wrome', 'Western Roman Empire', 'Italy', 395, 476, [[395, 'ITA FRA ESP PRT TUN DZA CHE AUT SVN HRV'], [439, 'ITA FRA AUT SVN HRV']]],
  ['ostrogoths', 'Ostrogothic Kingdom', 'Italy', 493, 553, [[493, 'ITA SVN HRV']]],
  ['lombards', 'Lombard Kingdom', 'Italy', 568, 774, [[568, '@10.5,45,200']]],
  ['papal', 'Papal States', 'Italy', 754, 1700, [[754, '@12.5,42.6,110']]],
  ['venice', 'Venice', 'Italy', 697, 1700, [[697, '@12.3,45.4,40'], [1400, '@13.5,45,140']], { strength: [[697, 1], [1000, 2], [1204, 4], [1500, 3], [1700, 1]] }],
  ['sicily', 'Kingdom of Sicily', 'Italy', 1130, 1700, [[1130, '@14.5,38.6,230']]],
  ['florence', 'Florence and Tuscany', 'Italy', 1115, 1700, [[1115, '@11.25,43.77,45'], [1569, '@11.2,43.4,85']]],
  ['milan', 'Duchy of Milan', 'Italy', 1395, 1700, [[1395, '@9.2,45.5,85']]],
  // Greece: the fixture's city-states join these
  ['mycenae', 'Mycenaean Greece', 'Greece', -1600, -1100, [[-1600, '@22.5,38,170']], { approx: true }],
  ['achaean', 'Achaean League', 'Greece', -280, -146, [[-280, '@22.2,37.9,110']]],
  ['byzantine', 'Byzantine Empire', 'Greece', 395, 1453, [[395, 'GRC TUR SYR LBN ISR JOR PSE EGY BGR MKD ALB'], [555, '+ ITA TUN'], [650, 'GRC TUR BGR MKD ALB @14,38,150'], [1025, 'GRC TUR BGR MKD ALB SRB'], [1180, 'GRC @29,40,350'], [1300, '@28,40.5,250'], [1400, '@28.9,41,60']]],
  // Macedon and the Balkans
  ['odrysian', 'Odrysian Thrace', 'Macedon and the Balkans', -480, -46, [[-480, '@25.5,42.3,200']]],
  ['dacia', 'Dacia', 'Macedon and the Balkans', -82, 106, [[-82, 'ROU']]],
  ['bulgaria1', 'First Bulgarian Empire', 'Macedon and the Balkans', 681, 1018, [[681, 'BGR'], [900, 'BGR MKD SRB ROU']]],
  ['bulgaria2', 'Second Bulgarian Empire', 'Macedon and the Balkans', 1185, 1396, [[1185, 'BGR']]],
  ['serbia', 'Serbia', 'Macedon and the Balkans', 1166, 1459, [[1166, 'SRB MNE'], [1346, 'SRB MNE MKD ALB']]],
  ['wallachia', 'Wallachia', 'Macedon and the Balkans', 1310, 1700, [[1310, '@25.5,44.5,170']]],
  // North Africa
  ['carthage', 'Carthage', 'North Africa', -814, -146, [[-814, '@10.3,36.85,30'], [-600, '@10,36,180'], [-264, 'TUN'], [-201, '@10,36.5,90']], { strength: [[-814, 1], [-480, 3], [-264, 4], [-201, 2], [-146, 1]] }],
  ['numidia', 'Numidia', 'North Africa', -202, -46, [[-202, '@6,36,300']]],
  ['vandals', 'Vandal Kingdom', 'North Africa', 435, 534, [[435, 'TUN']]],
  ['almoravids', 'Almoravids', 'North Africa', 1040, 1147, [[1040, 'MAR MRT ESH']]],
  ['almohads', 'Almohads', 'North Africa', 1121, 1269, [[1121, 'MAR'], [1160, 'MAR DZA TUN']]],
  ['marinids', 'Marinids', 'North Africa', 1244, 1465, [[1244, 'MAR']]],
  ['hafsids', 'Hafsids', 'North Africa', 1229, 1574, [[1229, 'TUN']]],
  ['saadi', 'Saadi Morocco', 'North Africa', 1510, 1659, [[1510, 'MAR']]],
  ['alaouite', 'Alaouite Morocco', 'North Africa', 1631, 1700, [[1631, 'MAR']]],
  // Egypt
  ['egypt_ok', 'Old Kingdom', 'Egypt', -2686, -2181, [[-2686, '@31.2,27,250']], { approx: true }],
  ['egypt_mk', 'Middle Kingdom', 'Egypt', -2055, -1650, [[-2055, '@31.2,27,260']], { approx: true }],
  ['egypt_nk', 'New Kingdom', 'Egypt', -1550, -1069, [[-1550, '@31.5,26,330'], [-1450, '@33,28,600']], { approx: true }],
  ['egypt_late', 'Late Period Egypt', 'Egypt', -664, -332, [[-664, '@31.2,27,260']]],
  ['ptolemaic', 'Ptolemaic Egypt', 'Egypt', -305, -30, [[-305, '@31,27.5,300 @35,33,110'], [-200, '@31,27.5,300']]],
  ['fatimid', 'Fatimid Caliphate', 'Egypt', 909, 1171, [[909, 'TUN LBY'], [969, 'EGY ISR LBN PSE JOR']]],
  ['ayyubid', 'Ayyubid Sultanate', 'Egypt', 1171, 1250, [[1171, 'EGY SYR ISR LBN JOR PSE']]],
  ['mamluk', 'Mamluk Sultanate', 'Egypt', 1250, 1517, [[1250, 'EGY SYR ISR LBN JOR PSE']]],
  // Levant
  ['phoenicia', 'Phoenician cities', 'Levant', -1500, -539, [[-1500, '@35.5,33.8,60']], { approx: true }],
  ['israel', 'Israel and Judah', 'Levant', -1050, -586, [[-1050, '@35.2,31.8,70']], { approx: true }],
  ['nabataea', 'Nabataean Kingdom', 'Levant', -400, 106, [[-400, '@35.5,30.3,140']], { approx: true }],
  ['hasmonean', 'Hasmonean Judea', 'Levant', -140, -37, [[-140, '@35.2,31.8,90']]],
  ['umayyad', 'Umayyad Caliphate', 'Levant', 661, 750, [[661, 'SYR LBN ISR PSE JOR IRQ IRN EGY LBY TUN'], [711, '+ DZA MAR ESP PRT SAU AFG UZB TKM PAK']]],
  ['jerusalem', 'Kingdom of Jerusalem', 'Levant', 1099, 1291, [[1099, '@35.2,32,80'], [1187, '@34.9,33,50']]],
  // Anatolia
  ['hittites', 'Hittites', 'Anatolia', -1650, -1180, [[-1650, '@34,40,200'], [-1350, '@34.5,39,430']], { approx: true }],
  ['phrygia', 'Phrygia', 'Anatolia', -1200, -675, [[-1200, '@31,39.5,220']], { approx: true }],
  ['lydia', 'Lydia', 'Anatolia', -1200, -546, [[-1200, '@28,38.5,110'], [-600, '@30,39,300']], { approx: true }],
  ['urartu', 'Urartu', 'Anatolia', -860, -590, [[-860, '@43,39.5,200']]],
  ['pergamon', 'Pergamon', 'Anatolia', -282, -133, [[-282, '@27.2,39.1,60'], [-188, '@29,39,250']]],
  ['pontus', 'Pontus', 'Anatolia', -281, -63, [[-281, '@36,41,220']]],
  ['rum', 'Sultanate of Rum', 'Anatolia', 1077, 1308, [[1077, '@32,39,350']]],
  ['ottoman', 'Ottoman Empire', 'Anatolia', 1299, 1700, [[1299, '@30,40,80'], [1400, '@30,39.5,350'], [1453, 'TUR BGR GRC MKD ALB SRB'], [1520, 'TUR BGR GRC MKD ALB SRB SYR LBN ISR JOR PSE EGY IRQ ROU HUN'], [1580, '+ DZA TUN LBY']]],
  // Mesopotamia
  ['akkad', 'Akkadian Empire', 'Mesopotamia', -2334, -2154, [[-2334, '@44.5,33,280']], { approx: true }],
  ['ur3', 'Third Dynasty of Ur', 'Mesopotamia', -2112, -2004, [[-2112, '@45.5,31.5,220']], { approx: true }],
  ['babylon1', 'Old Babylonian Empire', 'Mesopotamia', -1894, -1595, [[-1894, '@44.4,32.5,90'], [-1755, '@44.5,33,320']], { approx: true }],
  ['kassite', 'Kassite Babylonia', 'Mesopotamia', -1595, -1155, [[-1595, '@44.5,32.5,280']], { approx: true }],
  ['assyria', 'Neo-Assyrian Empire', 'Mesopotamia', -911, -609, [[-911, '@43.2,36.4,150'], [-745, 'IRQ SYR'], [-671, 'IRQ SYR LBN ISR PSE JOR EGY']]],
  ['neobab', 'Neo-Babylonian Empire', 'Mesopotamia', -626, -539, [[-626, '@44.4,32.5,200'], [-605, 'IRQ SYR LBN ISR PSE JOR']]],
  ['seleucid', 'Seleucid Empire', 'Mesopotamia', -312, -63, [[-312, 'IRQ IRN SYR AFG TKM'], [-281, '+ TUR'], [-200, 'IRQ SYR IRN'], [-129, 'SYR']]],
  ['abbasid', 'Abbasid Caliphate', 'Mesopotamia', 750, 1258, [[750, 'IRQ IRN SYR LBN ISR PSE JOR EGY LBY TUN SAU AFG UZB TKM'], [945, '@44.4,33.3,220']]],
  // Persia
  ['elam', 'Elam', 'Persia', -2700, -539, [[-2700, '@48.5,31.5,180']], { approx: true }],
  ['medes', 'Medes', 'Persia', -678, -549, [[-678, '@48.5,34.8,250'], [-600, 'IRN ARM AZE']]],
  ['achaemenid', 'Achaemenid Persia', 'Persia', -550, -330, [[-550, 'IRN AFG'], [-539, 'IRN IRQ SYR TUR AFG TKM ARM AZE LBN ISR PSE JOR'], [-525, '+ EGY PAK UZB'], [-512, '+ @24,41.5,110']]],
  ['parthia', 'Parthia', 'Persia', -247, 224, [[-247, '@58,37.5,200'], [-141, 'IRN IRQ TKM'], [-50, 'IRN IRQ TKM AFG ARM']]],
  ['sasanian', 'Sasanian Empire', 'Persia', 224, 651, [[224, 'IRN IRQ AFG TKM ARM AZE GEO'], [619, '+ SYR ISR LBN JOR PSE EGY'], [628, 'IRN IRQ AFG TKM ARM AZE GEO']]],
  ['samanid', 'Samanids', 'Persia', 819, 999, [[819, 'UZB TJK TKM AFG']]],
  ['seljuk', 'Great Seljuk Empire', 'Persia', 1037, 1194, [[1037, 'TKM'], [1092, 'IRN IRQ TKM UZB SYR TUR AFG ARM AZE']]],
  ['ilkhanate', 'Ilkhanate', 'Persia', 1256, 1335, [[1256, 'IRN IRQ AZE ARM GEO TKM AFG TUR']]],
  ['timurid', 'Timurid Empire', 'Persia', 1370, 1507, [[1370, 'UZB TKM IRN AFG'], [1405, 'UZB TKM IRN AFG IRQ'], [1450, 'UZB TKM AFG @54,33,400']]],
  ['safavid', 'Safavid Iran', 'Persia', 1501, 1700, [[1501, 'IRN AZE ARM'], [1623, 'IRN AZE ARM IRQ AFG'], [1639, 'IRN AZE ARM AFG']]],
  // India
  ['harappa', 'Indus civilisation', 'India', -2600, -1900, [[-2600, '@69,27,450']], { approx: true }],
  ['magadha', 'Magadha', 'India', -684, -322, [[-684, '@85.5,25,200'], [-450, '@85,25,330']], { approx: true }],
  ['maurya', 'Maurya Empire', 'India', -322, -185, [[-322, '@84,25,500'], [-260, 'IND PAK BGD NPL AFG']]],
  ['gupta', 'Gupta Empire', 'India', 320, 550, [[320, '@83,25.5,350'], [400, '@80,24,800']]],
  ['chola', 'Chola dynasty', 'India', 848, 1279, [[848, '@79.5,11,300'], [1030, '@79.5,12,600']]],
  ['delhi', 'Delhi Sultanate', 'India', 1206, 1526, [[1206, '@77,29,400'], [1330, 'IND PAK BGD'], [1400, '@77,28.5,350']]],
  ['vijayanagara', 'Vijayanagara', 'India', 1336, 1646, [[1336, '@77,14,500']]],
  ['mughal', 'Mughal Empire', 'India', 1526, 1700, [[1526, '@76,29,450'], [1605, 'IND PAK BGD AFG']]],
  // Steppe and Central Asia
  ['scythians', 'Scythians', 'Steppe and Central Asia', -900, -200, [[-900, '@40,47,500'], [-600, 'UKR KAZ']], { approx: true }],
  ['xiongnu', 'Xiongnu', 'Steppe and Central Asia', -209, 91, [[-209, 'MNG']]],
  ['kushan', 'Kushan Empire', 'Steppe and Central Asia', 30, 375, [[30, 'AFG TJK UZB'], [127, 'AFG PAK TJK UZB @77,28,350']]],
  ['huns', 'Huns', 'Steppe and Central Asia', 370, 469, [[370, '@35,48,700'], [434, '@22,47,600']], { approx: true }],
  ['gokturks', 'Göktürks', 'Steppe and Central Asia', 552, 744, [[552, 'MNG KAZ KGZ']]],
  ['khazars', 'Khazars', 'Steppe and Central Asia', 650, 969, [[650, '@46,47,450']]],
  ['mongols', 'Mongol Empire', 'Steppe and Central Asia', 1206, 1294, [[1206, 'MNG'], [1227, 'MNG KAZ UZB TKM KGZ TJK @114,40,600'], [1260, 'MNG KAZ UZB TKM KGZ TJK IRN IRQ AFG UKR CHN']]],
  ['goldenhorde', 'Golden Horde', 'Steppe and Central Asia', 1242, 1502, [[1242, 'KAZ UKR @45,52,600']]],
  ['chagatai', 'Chagatai Khanate', 'Steppe and Central Asia', 1225, 1370, [[1225, 'UZB KGZ TJK @80,43,300']]],
  ['kazakh', 'Kazakh Khanate', 'Steppe and Central Asia', 1465, 1700, [[1465, 'KAZ']]],
  // China
  ['shang', 'Shang', 'China', -1600, -1046, [[-1600, '@114,35,350']], { approx: true }],
  ['zhou', 'Zhou', 'China', -1046, -256, [[-1046, '@112,35,550'], [-770, '@112.5,34.7,180']]],
  ['qin_state', 'Qin', 'China', -475, -221, [[-475, '@108,34.5,300'], [-260, '@109,33,550']]],
  ['chu', 'Chu', 'China', -475, -223, [[-475, '@113,30.5,550']]],
  ['qi', 'Qi', 'China', -475, -221, [[-475, '@118,36.5,300']]],
  ['zhao', 'Zhao', 'China', -403, -228, [[-403, '@114.5,37.5,280']]],
  ['qin', 'Qin dynasty', 'China', -221, -206, [[-221, '@112,32,1100']]],
  ['han', 'Han', 'China', -206, 220, [[-206, '@112,33,1150'], [-100, '@108,33,1350']]],
  ['cao_wei', 'Cao Wei', 'China', 220, 266, [[220, '@114,36,700']]],
  ['shu_han', 'Shu Han', 'China', 221, 263, [[221, '@104,30,550']]],
  ['wu', 'Eastern Wu', 'China', 222, 280, [[222, '@117,28,650']]],
  ['jin', 'Jin', 'China', 266, 420, [[266, '@112,32,1150'], [317, '@115,29,700']]],
  ['nwei', 'Northern Wei', 'China', 386, 535, [[386, '@111,38,700']]],
  ['sui', 'Sui', 'China', 581, 618, [[581, '@112,32,1200']]],
  ['tang', 'Tang', 'China', 618, 907, [[618, '@110,33,1250'], [660, '@100,36,1700'], [760, '@112,32,1100']]],
  ['liao', 'Liao', 'China', 916, 1125, [[916, '@120,43,800']]],
  ['song', 'Song', 'China', 960, 1279, [[960, '@114,30,1050'], [1127, '@115,28,800']]],
  ['jurchen_jin', 'Jurchen Jin', 'China', 1115, 1234, [[1115, '@124,44,600'], [1127, '@119,39,950']]],
  ['yuan', 'Yuan', 'China', 1271, 1368, [[1271, 'CHN MNG']]],
  ['ming', 'Ming', 'China', 1368, 1644, [[1368, '@112,31,1250']]],
  ['qing', 'Qing', 'China', 1644, 1700, [[1644, 'CHN'], [1691, 'CHN MNG']]],
  // Korea
  ['gojoseon', 'Gojoseon', 'Korea', -400, -108, [[-400, '@125.5,40,200']], { approx: true }],
  ['goguryeo', 'Goguryeo', 'Korea', -37, 668, [[-37, '@126,41,150'], [400, 'PRK @125,42.5,220']]],
  ['baekje', 'Baekje', 'Korea', -18, 660, [[-18, '@127,36.3,120']]],
  ['silla', 'Silla', 'Korea', -57, 935, [[-57, '@129.2,35.8,100'], [668, 'KOR @127,38.7,110']]],
  ['goryeo', 'Goryeo', 'Korea', 918, 1392, [[918, 'KOR PRK']]],
  ['joseon', 'Joseon', 'Korea', 1392, 1700, [[1392, 'KOR PRK']]],
  // Japan
  ['yamato', 'Yamato', 'Japan', 250, 710, [[250, '@135.5,34.6,250']], { approx: true }],
  ['heian', 'Nara and Heian court', 'Japan', 710, 1185, [[710, '@136,35.5,450']]],
  ['kamakura', 'Kamakura shogunate', 'Japan', 1185, 1333, [[1185, 'JPN']]],
  ['ashikaga', 'Ashikaga shogunate', 'Japan', 1336, 1573, [[1336, 'JPN'], [1467, '@135.7,35,120']]],
  ['tokugawa', 'Tokugawa shogunate', 'Japan', 1603, 1700, [[1603, 'JPN']]],
];
const GROUPS = [
  { id: 'g_warring', title: 'Warring States', region: 'China', members: ['qin_state', 'chu', 'qi', 'zhao'] },
  { id: 'g_three_kingdoms', title: 'Three Kingdoms', region: 'China', members: ['cao_wei', 'shu_han', 'wu'] },
  { id: 'g_korea', title: 'Three Kingdoms of Korea', region: 'Korea', members: ['goguryeo', 'baekje', 'silla'] },
];

function parts(spec, prev) {
  const tok = spec.trim().split(/\s+/);
  const out = tok[0] === '+' ? { iso: [...prev.iso], circ: [...prev.circ] } : { iso: [], circ: [] };
  for (const t of tok) {
    if (t === '+') continue;
    if (t[0] === '@') out.circ.push(t.slice(1).split(',').map(Number));
    else if (!AREA[t]) throw new Error(`no country ${t}`);
    else out.iso.push(t);
  }
  return out;
}
const polities = [];
for (const [id, title, region, from, to, snaps, extra = {}] of P) {
  let prev = { iso: [], circ: [] };
  const s = snaps.map(([y, spec]) => {
    prev = parts(spec, prev);
    const area = prev.iso.reduce((a, c) => a + AREA[c], 0) + prev.circ.reduce((a, [, , km]) => a + Math.PI * km * km, 0);
    return { from: ast(y), ...(prev.iso.length ? { iso: prev.iso } : {}), ...(prev.circ.length ? { circ: prev.circ } : {}), areaKm2: round(area, -2) };
  });
  polities.push({
    id, title, region, from: ast(from), to: ast(to), ...(extra.approx ? { approxFrom: true } : {}), snapshots: s,
    ...(extra.strength ? { strength: extra.strength.map(([y, level]) => ({ at: ast(y), level })) } : {}),
  });
}
// The fixture's city-states, with their hand-drawn outlines and Bob's strength points.
const FIX_END = { t_athens: -86, t_sparta: -192, t_corinth: -146, t_thebes: -335, t_macedon: -168, t_syracuse: -212 };
const fixTerr = doc.territories.filter((t) => !next.alliances[t.id]);
for (const t of fixTerr) {
  polities.push({
    id: t.id, title: t.title.replace(/ \(.*\)$/, ''), region: FIX_REGION[next.regions[t.id]], fixture: true,
    from: Math.min(...t.snapshots.map((s) => s.from.y)), to: ast(FIX_END[t.id]),
    snapshots: t.snapshots.map((s) => ({ from: s.from.y, path: pathOf(s.geometry.coordinates), box: boxOf(s.geometry.coordinates), areaKm2: round(ringAreaKm2(s.geometry.coordinates[0]), -1), centre: centreOf(s.geometry.coordinates[0]) })),
    ...(next.strength[t.id] ? { strength: next.strength[t.id].map((p) => ({ at: p.at.y, level: p.level, ...(p.highlightIds ? { highlightIds: p.highlightIds } : {}) })) } : {}),
  });
}
const delian = doc.territories.find((t) => next.alliances[t.id]);
const reach = { [next.alliances[delian.id].leader]: delian.snapshots.map((s) => ({ from: s.from.y, to: s.to?.y, path: pathOf(s.geometry.coordinates), title: delian.title })) };
function centreOf(ring) { const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]); return [round((Math.min(...xs) + Math.max(...xs)) / 2, 2), round((Math.min(...ys) + Math.max(...ys)) / 2, 2)]; }
const groups = [...next.groups.map((g) => ({ ...g, region: FIX_REGION[g.region] })), ...GROUPS];
const polById = new Map(polities.map((p) => [p.id, p]));
for (const g of groups) for (const m of g.members) polById.get(m).group = g.id;

function placeIn(p, y) {
  const s = [...p.snapshots].reverse().find((s) => s.from <= y) ?? p.snapshots[0];
  if (s.centre) return s.centre.map((v) => round(v + between(-0.25, 0.25), 2));
  const opts = [...(s.iso ?? []).map((c) => [...CENTRE[c], 2.2]), ...(s.circ ?? []).map(([lon, lat, km]) => [lon, lat, (km / 111) * 0.6])];
  const [lon, lat, r] = pick(opts);
  return [round(lon + between(-r, r), 2), round(lat + between(-r, r) * 0.7, 2)];
}

// ---------- eras: the backdrop, per region ----------
const E = {
  Iberia: [['Iron Age Iberia', -1200, -218, 1], ['Roman Hispania', -218, 409], ['Visigothic Spain', 409, 711], ['Al-Andalus and the Reconquista', 711, 1492], ['Spanish Golden Age', 1492, 1700]],
  'Western Europe': [['Iron Age Gaul', -800, -50, 1], ['Roman Gaul', -50, 486], ['Early Middle Ages', 486, 1000], ['High Middle Ages', 1000, 1300], ['Late Middle Ages', 1300, 1500], ['Early modern Europe', 1500, 1700]],
  Italy: [['Etruscan Italy', -900, -509, 1], ['Republican Italy', -509, -27], ['Imperial Italy', -27, 476], ['Early medieval Italy', 476, 1000], ['Italian communes', 1000, 1300], ['Renaissance', 1300, 1600], ['Baroque Italy', 1600, 1700]],
  Greece: [['Bronze Age Greece', -3000, -1100, 1], ['Greek Dark Ages', -1100, -800, 1], ['Roman Greece', -30, 330], ['Byzantine Greece', 330, 1453], ['Ottoman Greece', 1453, 1700]],
  'Macedon and the Balkans': [['Bronze Age Balkans', -3000, -1100, 1], ['Iron Age Thrace and Macedon', -1100, -168, 1], ['Roman Balkans', -168, 395], ['Byzantine and Slavic Balkans', 395, 1371], ['Ottoman Balkans', 1371, 1700]],
  'North Africa': [['Punic Africa', -814, -146], ['Roman Africa', -146, 429], ['Vandal and Byzantine Africa', 429, 698], ['Islamic Maghreb', 698, 1700]],
  Egypt: [['Early Dynastic Egypt', -3100, -2686, 1], ['Pharaonic Egypt', -2686, -332, 1], ['Greek and Roman Egypt', -332, 641], ['Islamic Egypt', 641, 1700]],
  Levant: [['Bronze Age Canaan', -3000, -1200, 1], ['Iron Age Levant', -1200, -539], ['Persian, Greek and Roman Levant', -539, 634], ['Early Islamic Levant', 634, 1099], ['Crusades', 1099, 1291], ['Mamluk and Ottoman Levant', 1291, 1700]],
  Anatolia: [['Bronze Age Anatolia', -3000, -1180, 1], ['Iron Age kingdoms', -1180, -546, 1], ['Persian and Hellenistic Anatolia', -546, -133], ['Roman Anatolia', -133, 395], ['Byzantine Anatolia', 395, 1071], ['Turkish Anatolia', 1071, 1700]],
  Mesopotamia: [['Sumer and Akkad', -3000, -2004, 1], ['Babylon and Assyria', -2004, -539, 1], ['Persian and Hellenistic Mesopotamia', -539, 224], ['Sasanian Mesopotamia', 224, 637], ['Islamic Golden Age', 750, 1258], ['Mongol and Turkic rule', 1258, 1534], ['Ottoman Iraq', 1534, 1700]],
  Persia: [['Elamite Iran', -2700, -550, 1], ['Classical Iran', -550, 651], ['Islamic Iran', 651, 1501], ['Safavid Iran', 1501, 1700]],
  India: [['Indus civilisation', -2600, -1900, 1], ['Vedic period', -1500, -500, 1], ['Classical India', -500, 550], ['Early medieval India', 550, 1206], ['Age of sultanates', 1206, 1526], ['Mughal era', 1526, 1700]],
  'Steppe and Central Asia': [['Bronze Age steppe', -3000, -900, 1], ['Scythian steppe', -900, -200, 1], ['Age of nomad empires', -200, 1206], ['Mongol age', 1206, 1502], ['Later khanates', 1502, 1700]],
  China: [['Neolithic China', -3000, -1600, 1], ['Bronze Age China', -1600, -771, 1], ['Spring and Autumn', -771, -476], ['Warring States', -475, -221], ['Early imperial China', -221, 220], ['Era of division', 220, 589], ['Middle imperial China', 589, 1279], ['Late imperial China', 1279, 1700]],
  Korea: [['Gojoseon era', -2333, -108, 1], ['Proto–Three Kingdoms', -108, -57], ['Three Kingdoms', -57, 668], ['North–South States', 668, 935], ['Goryeo era', 935, 1392], ['Joseon era', 1392, 1700]],
  Japan: [['Jōmon', -3000, -300, 1], ['Yayoi', -300, 250, 1], ['Kofun', 250, 538], ['Asuka', 538, 710], ['Nara', 710, 794], ['Heian', 794, 1185], ['Kamakura', 1185, 1333], ['Muromachi', 1336, 1573], ['Azuchi–Momoyama', 1573, 1603], ['Edo', 1603, 1700]],
};
const eras = [];
for (const [region, list] of Object.entries(E)) for (const [title, from, to, approx] of list) eras.push({ id: `e_${eras.length}`, title, region, from: ast(from), to: ast(to), ...(approx ? { approxFrom: true } : {}) });
// The fixture's eras: Archaic, Classical and Hellenistic sit between the Dark Ages and Roman Greece; the rest are inside them.
for (const i of doc.items.filter((i) => i.subject === 'period')) {
  const top = ['i_archaic', 'i_classical', 'i_hellenistic'].includes(i.id);
  eras.push({ id: i.id, title: i.title, region: 'Greece', from: i.start.y, to: i.end.y, fixture: true, ...(top ? {} : { inner: true }), ...(i.start.approx ? { approxFrom: true } : {}) });
}

// ---------- entries ----------
const LANES = ['politics', 'war', 'economy', 'ideas', 'technology', 'nature'];
const T = {
  politics: ['New law code', 'Succession crisis', 'Council reformed', 'Revolt of the nobles', 'A new capital', 'Royal marriage', 'Provinces reorganised', 'Usurper takes the throne', 'Assembly gains power', 'Regency', 'Civil service exams', 'Rival claimants', 'Census of the people'],
  war: ['Border war', 'Siege of the capital', 'Rebellion put down', 'Raid across the frontier', 'Fleet lost at sea', 'Great victory', 'Army reformed', 'Fortress line built', 'Mercenaries hired', 'Pitched battle'],
  economy: ['Coinage reformed', 'Grain shortage', 'Land survey and new taxes', 'Silver mines opened', 'Markets regulated', 'State granaries built', 'Debts cancelled', 'Trade fair founded', 'Price controls', 'New harbour'],
  ideas: ['New temple cult', 'Scriptures collected', 'A teacher founds a school', 'Schism among the priests', 'Court historians at work', 'Monasteries founded', 'Philosophers expelled', 'Pilgrimage centre grows', 'Library founded', 'Great poem written'],
  technology: ['Iron ploughs spread', 'New canal dug', 'Road network built', 'Water mills appear', 'Bigger warships', 'Paper made locally', 'Better bronze casting', 'Calendar reformed', 'Aqueduct built', 'Printing workshop'],
  nature: ['Drought', 'Plague', 'Earthquake', 'River floods', 'Locusts', 'Harsh winters', 'Forests cleared', 'Volcanic winter', 'Famine', 'Coast silts up'],
};
const PEOPLE = {
  politics: ['A reforming minister', 'Founder of the dynasty', 'A long-reigning ruler', 'A queen regent', 'A lawgiver'],
  war: ['A great general', 'An admiral', 'A rebel leader'],
  ideas: ['A court poet', 'A philosopher', 'A religious reformer', 'A historian', 'A court astronomer'],
  technology: ['An engineer', 'A physician'],
  economy: ['A merchant prince', 'A treasurer'],
};
const entries = [];
const add = (e) => { entries.push(e); return e; };

// The fixture's entries: their lanes, marks and weights from Bob's own work; polities from who took part, else a name.
const hlCount = {}, relCount = {}, noteCount = {};
for (const h of doc.highlights) for (const id of h.usedBy ?? []) hlCount[id] = (hlCount[id] ?? 0) + 1;
for (const r of doc.relations) for (const id of [r.fromId, r.toId]) relCount[id] = (relCount[id] ?? 0) + 1;
for (const n of doc.notes) for (const id of n.linkedIds) noteCount[id] = (noteCount[id] ?? 0) + 1;
const partOf = new Map(doc.relations.filter((r) => r.type === 'part-of').map((r) => [r.fromId, r.toId]));
const takesPart = new Map(next.participants.map((p) => [p.entryId, p.sides.flat()]));
const NAMED = [
  [/Spart|Leonidas|Lysander|Agesilaus|[Hh]elot|Messene|Cadmea/, ['t_sparta']], [/Theb|Epaminondas|Pelopidas|Leuctra/, ['t_thebes']],
  [/Philip|Macedon|sarissa|Olynth|Amphipolis$|Philocrates/, ['t_macedon']], [/Alexander|Issus|Gaugamela|Lamian/, ['t_macedon']],
  [/Dionysius|Syracuse|Great Harbour|Assinarus/, ['t_syracuse']], [/Darius|Xerxes|Ionian|Lade|Anabasis|Ten Thousand|King’s Peace/, ['achaemenid']],
  [/Corinth|Sybota|Corcyra|Epidamnus/, ['t_corinth', 't_athens']],
];
function fixturePolities(i) {
  const out = new Set();
  let at = i.id;
  for (let k = 0; k < 4 && at; k++) { for (const t of takesPart.get(at) ?? []) out.add(t); at = partOf.get(at); }
  for (const [re, ids] of NAMED) if (re.test(i.title)) ids.forEach((t) => out.add(t));
  if (i.id === 'i_persian' || i.id === 'i_alexander_persia' || i.id === 'i_callias') out.add('achaemenid');
  if (!out.size) out.add('t_athens');
  out.delete('t_delian');
  return [...out];
}
const fixPlaceOf = (pid, y) => placeIn(polById.get(pid), y);
for (const i of doc.items) {
  if (i.subject === 'period') continue;
  const pol = fixturePolities(i);
  const [lon, lat] = i.place ? [i.place.lon, i.place.lat] : fixPlaceOf(pol[0], i.start.y);
  add({
    id: i.id, title: i.title, kind: i.kind, start: i.start.y, ...(i.end ? { end: i.end.y } : {}), lanes: next.lanes[i.id] ?? [], polities: pol,
    highlights: hlCount[i.id] ?? 0, connections: relCount[i.id] ?? 0, notes: noteCount[i.id] ?? 0, ...(next.marks[i.id] ? { overview: next.marks[i.id] } : {}),
    place: [round(lon, 2), round(lat, 2)], ...(partOf.has(i.id) ? { partOf: partOf.get(i.id) } : {}),
  });
}

// ---------- contacts: who dealt with whom, and how ----------
const contacts = [];
const contact = (a, b, from, to, how, title, entryId) => { contacts.push({ a, b, from: ast(from), to: ast(to), how, ...(title ? { title } : {}), ...(entryId ? { entryId } : {}) }); };
for (const p of next.participants) {
  const e = doc.items.find((i) => i.id === p.entryId);
  const from = e.start.y, to = (e.end ?? e.start).y;
  const sides = p.sides.map((s) => s.filter((t) => t !== 't_delian'));
  if (p.entryId === 'i_persian') sides[1] = ['achaemenid'];
  const push = (a, b, how) => contacts.push({ a, b, from, to, how, entryId: p.entryId });
  if (p.how === 'war' || p.how === 'peace') for (const a of sides[0]) for (const b of sides[1] ?? []) push(a, b, p.how);
  if (p.how === 'alliance') for (const s of sides) for (let x = 0; x < s.length; x++) for (let y = x + 1; y < s.length; y++) push(s[x], s[y], 'alliance');
}
contacts.push({ a: 't_macedon', b: 'achaemenid', from: ast(-334), to: ast(-330), how: 'war', entryId: 'i_alexander_persia' });
contacts.push({ a: 't_athens', b: 'achaemenid', from: ast(-449), to: ast(-449), how: 'peace', entryId: 'i_callias' });
// Famous ones, written out; each war becomes an entry in both polities' War lane.
const KNOWN = [
  ['achaemenid', 't_macedon', -512, -479, 'alliance', 'Macedon a Persian vassal'], ['achaemenid', 't_sparta', -412, -404, 'alliance', 'Persian gold for Sparta'],
  ['achaemenid', 'egypt_late', -525, -525, 'war', 'Cambyses conquers Egypt'], ['achaemenid', 'neobab', -539, -539, 'war', 'Cyrus takes Babylon'], ['achaemenid', 'lydia', -547, -546, 'war', 'Cyrus defeats Croesus'],
  ['achaemenid', 'scythians', -513, -513, 'war', 'Darius against the Scythians'], ['achaemenid', 'odrysian', -480, -479, 'alliance', 'Thrace under Persia'],
  ['rome_rep', 'carthage', -264, -146, 'war', 'Punic Wars'], ['rome_rep', 't_macedon', -214, -168, 'war', 'Macedonian Wars'], ['rome_rep', 'seleucid', -192, -188, 'war', 'Roman–Seleucid War'],
  ['rome_rep', 'parthia', -53, -53, 'war', 'Battle of Carrhae'], ['rome_emp', 'parthia', 58, 217, 'war', 'Roman–Parthian wars'], ['rome_rep', 'etruscans', -509, -264, 'war', 'Rome conquers Etruria'],
  ['rome_rep', 'gauls', -58, -50, 'war', 'Gallic Wars'], ['rome_rep', 't_corinth', -146, -146, 'war', 'Corinth destroyed'], ['rome_rep', 'achaean', -146, -146, 'war', 'Achaean War'],
  ['rome_rep', 'pontus', -89, -63, 'war', 'Mithridatic Wars'], ['rome_emp', 'dacia', 101, 106, 'war', 'Trajan’s Dacian Wars'], ['rome_emp', 'sasanian', 230, 395, 'war', 'Roman–Persian wars'],
  ['rome_emp', 'kushan', 30, 220, 'trade', 'Silk and spices by sea'], ['han', 'parthia', -100, 200, 'trade', 'Silk Road trade'], ['han', 'xiongnu', -133, 89, 'war', 'Han–Xiongnu War'],
  ['han', 'kushan', 30, 220, 'trade', 'Silk Road trade'], ['byzantine', 'sasanian', 502, 628, 'war', 'Byzantine–Sasanian wars'], ['byzantine', 'umayyad', 674, 718, 'war', 'Sieges of Constantinople'],
  ['byzantine', 'bulgaria1', 894, 1018, 'war', 'Byzantine–Bulgarian wars'], ['byzantine', 'rum', 1071, 1176, 'war', 'Byzantine–Seljuk wars'], ['byzantine', 'seljuk', 1071, 1071, 'war', 'Battle of Manzikert'],
  ['byzantine', 'ottoman', 1302, 1453, 'war', 'Byzantine–Ottoman wars'], ['venice', 'byzantine', 992, 1204, 'trade', 'Venetian trade privileges'], ['venice', 'byzantine', 1204, 1204, 'war', 'Sack of Constantinople'],
  ['venice', 'ottoman', 1463, 1479, 'war', 'Ottoman–Venetian War'], ['ottoman', 'safavid', 1514, 1639, 'war', 'Ottoman–Safavid wars'], ['ottoman', 'mamluk', 1516, 1517, 'war', 'Ottoman conquest of Egypt'],
  ['ottoman', 'serbia', 1371, 1459, 'war', 'Ottoman conquest of Serbia'], ['ottoman', 'spain', 1538, 1580, 'war', 'Habsburg–Ottoman wars at sea'], ['ottoman', 'hre', 1526, 1699, 'war', 'Ottoman–Habsburg wars'],
  ['spain', 'dutch', 1568, 1648, 'war', 'Eighty Years’ War'], ['spain', 'france', 1494, 1659, 'war', 'Habsburg–Valois wars'], ['england', 'france', 1337, 1453, 'war', 'Hundred Years’ War'],
  ['franks', 'umayyad', 732, 732, 'war', 'Battle of Tours'], ['castile', 'granada', 1482, 1492, 'war', 'Granada War'],
  ['tang', 'gokturks', 626, 630, 'war', 'Tang conquest of the Eastern Turks'], ['tang', 'abbasid', 751, 751, 'war', 'Battle of Talas'], ['tang', 'silla', 648, 676, 'alliance', 'Silla–Tang alliance'],
  ['song', 'liao', 979, 1005, 'war', 'Song–Liao wars'], ['song', 'jurchen_jin', 1125, 1234, 'war', 'Jin–Song wars'], ['mongols', 'jurchen_jin', 1211, 1234, 'war', 'Mongol conquest of the Jin'],
  ['yuan', 'song', 1271, 1279, 'war', 'Mongol conquest of the Song'], ['mongols', 'goryeo', 1231, 1259, 'war', 'Mongol invasions of Korea'], ['yuan', 'kamakura', 1274, 1281, 'war', 'Mongol invasions of Japan'],
  ['mongols', 'abbasid', 1258, 1258, 'war', 'Siege of Baghdad'], ['ilkhanate', 'mamluk', 1260, 1323, 'war', 'Mamluk–Ilkhanid War'], ['timurid', 'ottoman', 1402, 1402, 'war', 'Battle of Ankara'],
  ['mughal', 'safavid', 1622, 1653, 'war', 'Wars over Kandahar'], ['joseon', 'ming', 1592, 1598, 'alliance', 'Ming help against Japan'], ['maurya', 'seleucid', -305, -303, 'war', 'Seleucid–Mauryan War'],
  ['egypt_nk', 'hittites', -1300, -1259, 'war', 'Egyptian–Hittite wars'], ['assyria', 'israel', -732, -720, 'war', 'Assyria conquers Israel'], ['neobab', 'israel', -597, -587, 'war', 'Siege of Jerusalem'],
  ['assyria', 'elam', -653, -639, 'war', 'Assyria destroys Elam'], ['medes', 'assyria', -615, -609, 'war', 'Fall of Assyria'], ['carthage', 't_syracuse', -480, -307, 'war', 'Sicilian Wars'],
  ['ptolemaic', 'seleucid', -274, -168, 'war', 'Syrian Wars'], ['carthage', 'phoenicia', -814, -539, 'trade', 'Tyre’s colony'], ['phoenicia', 'egypt_nk', -1500, -1069, 'trade', 'Cedar for Egypt'],
  ['t_athens', 'odrysian', -431, -404, 'alliance', 'Athens’ Thracian allies'], ['t_athens', 'scythians', -450, -330, 'trade', 'Black Sea grain'], ['t_athens', 'egypt_late', -460, -454, 'alliance', 'Athens aids the Egyptian revolt'],
  ['venice', 'mamluk', 1250, 1517, 'trade', 'Spice trade at Alexandria'], ['portugal', 'vijayanagara', 1498, 1565, 'trade', 'Sea route to India'], ['abbasid', 'tang', 751, 907, 'trade', 'Paper and silk'],
];
const warEntry = (a, b, title, from, to) => {
  const A = polById.get(a), B = polById.get(b);
  const y = ast(from);
  return add({ id: `w_${entries.length}`, title, kind: to > from ? 'span' : 'event', start: y, ...(to > from ? { end: ast(to) } : {}), lanes: ['war'], polities: [a, b], gen: 1,
    highlights: Math.floor(rnd() ** 4 * 4), connections: 0, notes: rnd() < 0.1 ? 1 : 0, place: placeIn(rnd() < 0.5 ? A : B, y) });
};
for (const [a, b, from, to, how, title] of KNOWN) {
  let entryId;
  if (how === 'war') entryId = warEntry(a, b, title, from, to).id;
  contact(a, b, from, to, how, title, entryId);
}
// And generated ones, between neighbours that overlap in time.
const centreAt = (p, y) => { const s = [...p.snapshots].reverse().find((s) => s.from <= y) ?? p.snapshots[0]; if (s.centre) return s.centre; const pts = [...(s.iso ?? []).map((c) => CENTRE[c]), ...(s.circ ?? []).map((c) => c)]; return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length]; };
const regionOf = new Map(REGIONS.map((r) => [r.id, r]));
for (let x = 0; x < polities.length; x++) for (let y = x + 1; y < polities.length; y++) {
  const A = polities[x], B = polities[y];
  if (A.fixture || B.fixture) continue;
  const from = Math.max(A.from, B.from), to = Math.min(A.to, B.to);
  if (to - from < 10) continue;
  const mid = (from + to) / 2, [ax, ay] = centreAt(A, mid), [bx, by] = centreAt(B, mid);
  const d = Math.hypot((ax - bx) * 0.8, ay - by);
  const same = regionOf.get(A.region).parent === regionOf.get(B.region).parent;
  if (d > (same ? 16 : 9)) continue;
  const wars = rnd() < (same ? 0.55 : 0.25) ? 1 : 0;
  for (let k = 0; k < wars; k++) {
    const s = Math.round(between(from, to - 2)), e = Math.min(to, s + Math.round(rnd() ** 2 * 20));
    const w = warEntry(A.id, B.id, `${A.title} against ${B.title}`, s <= 0 ? s - 1 : s, e <= 0 ? e - 1 : e);
    contacts.push({ a: A.id, b: B.id, from: w.start, to: w.end ?? w.start, how: 'war', entryId: w.id });
  }
  if (rnd() < 0.15) { const s = Math.round(between(from, to - 5)); contacts.push({ a: A.id, b: B.id, from: s, to: Math.min(to, s + 5 + Math.round(rnd() * 40)), how: 'alliance' }); }
  if (rnd() < 0.2) contacts.push({ a: A.id, b: B.id, from, to, how: 'trade' });
}
const cleanContacts = contacts;

// ---------- world events: gold, holding what's part of them ----------
const WORLD = [
  ['wv_bronze', 'Bronze Age collapse', -1200, -1150, 'Levant', ['Greece', 'Anatolia', 'Egypt', 'Mesopotamia', 'Levant'], ['war', 'nature', 'economy']],
  ['wv_buddhism', 'Spread of Buddhism', -260, 700, 'India', ['India', 'Steppe and Central Asia', 'China', 'Korea', 'Japan'], ['ideas']],
  ['wv_silk', 'Silk Road opens', -130, -60, 'China', ['China', 'Steppe and Central Asia', 'Persia', 'Mesopotamia', 'India'], ['economy', 'technology']],
  ['wv_christianity', 'Spread of Christianity', 30, 400, 'Levant', ['Levant', 'Anatolia', 'Greece', 'Italy', 'Egypt', 'North Africa', 'Iberia', 'Western Europe'], ['ideas', 'politics']],
  ['wv_split', 'Split of the Roman Empire', 395, 395, 'Italy', ['Italy', 'Greece', 'Anatolia'], ['politics']],
  ['wv_islam', 'Rise of Islam', 610, 750, 'Levant', ['Levant', 'Mesopotamia', 'Persia', 'Egypt', 'North Africa', 'Iberia', 'Steppe and Central Asia'], ['ideas', 'war', 'politics']],
  ['wv_gunpowder', 'Gunpowder spreads', 1000, 1450, 'China', ['China', 'Steppe and Central Asia', 'Persia', 'Anatolia', 'Western Europe', 'India'], ['technology', 'war']],
  ['wv_mongol', 'Mongol conquests', 1206, 1279, 'Steppe and Central Asia', ['Steppe and Central Asia', 'China', 'Korea', 'Persia', 'Mesopotamia', 'Anatolia'], ['war', 'politics']],
  ['wv_plague', 'Black Death', 1346, 1353, 'Steppe and Central Asia', ['Steppe and Central Asia', 'Italy', 'Iberia', 'Western Europe', 'Greece', 'Egypt', 'Levant', 'Anatolia', 'North Africa'], ['nature', 'economy']],
  ['wv_printing', 'Printing spreads in Europe', 1450, 1500, 'Western Europe', ['Western Europe', 'Italy', 'Iberia'], ['technology', 'ideas']],
  ['wv_constantinople', 'Fall of Constantinople', 1453, 1453, 'Greece', ['Greece', 'Anatolia', 'Italy'], ['war']],
  ['wv_searoute', 'Sea route to India', 1498, 1498, 'Iberia', ['Iberia', 'India'], ['economy', 'technology']],
  ['wv_reformation', 'Reformation', 1517, 1648, 'Western Europe', ['Western Europe', 'Italy', 'Iberia'], ['ideas', 'politics', 'war']],
];
const world = WORLD.map(([id, title, from, to, home, touches, lanes]) => ({ id, title, start: ast(from), ...(to > from ? { end: ast(to) } : {}), home, touches, lanes, highlights: 2 + Math.floor(rnd() * 6), connections: 0, notes: rnd() < 0.4 ? 1 : 0, overview: 'world' }));
// The fixture's own world event.
const alex = entries.find((e) => e.id === 'i_alexander_persia');
world.push({ ...alex, home: 'Macedon and the Balkans', touches: ['Macedon and the Balkans', 'Greece', 'Anatolia', 'Egypt', 'Levant', 'Mesopotamia', 'Persia', 'India'], fixture: true });
entries.splice(entries.indexOf(alex), 1);
const polsIn = (region, y0, y1) => polities.filter((p) => p.region === region && p.from <= y1 && p.to >= y0);
const worldOf = new Map();
for (const w of world) {
  if (w.fixture) continue;
  const y0 = w.start, y1 = w.end ?? w.start + 1, n = 8 + Math.floor(rnd() * 8);
  for (let k = 0; k < n; k++) {
    const region = pick(w.touches), cand = polsIn(region, y0 - 5, y1 + 30);
    if (!cand.length) continue;
    const p = pick(cand), lane = pick(w.lanes), y = Math.round(between(Math.max(y0, p.from), Math.min(y1 + 25, p.to)));
    const e = add({ id: `x_${entries.length}`, title: pick(T[lane]), kind: 'event', start: y, lanes: [lane], polities: [p.id], gen: 1, partOf: w.id,
      highlights: Math.floor(rnd() ** 4 * 5), connections: 0, notes: 0, place: placeIn(p, y) });
    worldOf.set(e.id, w.id);
  }
}

// The generated bulk, spread over polities by how long they lasted.
const TARGET = 2000 - doc.items.length;
const gen = polities.filter((p) => !p.fixture);
const weight = (p) => Math.pow(p.to - p.from, 0.7);
const totalW = gen.reduce((a, p) => a + weight(p), 0);
const left = TARGET - entries.length + doc.items.length - 6;
for (const p of gen) {
  const n = Math.max(3, Math.round((weight(p) / totalW) * left));
  for (let k = 0; k < n; k++) {
    const r = rnd(), kind = r < 0.55 ? 'event' : r < 0.8 ? 'span' : 'person';
    const lane = kind === 'person' ? pick(['politics', 'politics', 'war', 'ideas', 'ideas', 'technology', 'economy']) : pick(LANES);
    const lanes = rnd() < 0.18 ? [lane, pick(LANES.filter((l) => l !== lane))] : [lane];
    const s = Math.round(between(p.from, p.to - 1));
    const len = kind === 'event' ? 0 : kind === 'span' ? 3 + Math.round(rnd() ** 2 * 60) : 40 + Math.round(rnd() * 35);
    const e = Math.min(p.to + (kind === 'person' ? 30 : 0), s + len);
    add({ id: `g_${entries.length}`, title: kind === 'person' ? pick(PEOPLE[lane]) : pick(T[lane]), kind, start: s, ...(len ? { end: e } : {}), lanes, polities: [p.id], gen: 1,
      highlights: Math.floor(rnd() ** 5 * 9), connections: 0, notes: rnd() < 0.06 ? 1 + Math.floor(rnd() * 2) : 0, place: placeIn(p, s) });
  }
}

// ---------- threads: connections between entries in different polities ----------
const EFFECT = { politics: ['legitimised', 'provoked', 'weakened'], war: ['provoked', 'weakened', 'ended'], economy: ['funded', 'enriched', 'ruined'], ideas: ['influenced', 'inspired', 'answered'], technology: ['spread to', 'improved on', 'enabled'], nature: ['weakened', 'drove out', 'ruined'] };
const byPol = new Map();
for (const e of entries) for (const p of e.polities) (byPol.get(p) ?? byPol.set(p, []).get(p)).push(e);
const partners = new Map();
for (const c of cleanContacts) { (partners.get(c.a) ?? partners.set(c.a, []).get(c.a)).push(c.b); (partners.get(c.b) ?? partners.set(c.b, []).get(c.b)).push(c.a); }
const threads = [];
const linked = new Set();
for (let k = 0; k < 520; k++) {
  const a = pick(entries);
  const ps = partners.get(pick(a.polities)) ?? [];
  if (!ps.length) continue;
  const cands = (byPol.get(pick(ps)) ?? []).filter((b) => b.start > a.start && b.start - a.start < 120 && !b.polities.some((p) => a.polities.includes(p)));
  if (!cands.length) continue;
  const b = pick(cands), key = a.id + b.id;
  if (linked.has(key)) continue;
  linked.add(key);
  const lane = a.lanes[0] ?? 'politics';
  threads.push({ from: a.id, to: b.id, effect: pick(EFFECT[lane]), lane });
  a.connections++; b.connections++;
}
// The fixture's own cross-polity connections.
const eById = new Map(entries.map((e) => [e.id, e]));
for (const r of doc.relations) {
  const a = eById.get(r.fromId), b = eById.get(r.toId);
  if (!a || !b || r.type === 'part-of' || a.polities.some((p) => b.polities.includes(p))) continue;
  threads.push({ from: a.id, to: b.id, effect: r.effect ?? r.type, lane: a.lanes[0] ?? 'politics', fixture: true });
}
// A few generated entries are shown in the overview, as Bob would mark them.
for (const p of gen) {
  const list = (byPol.get(p.id) ?? []).filter((e) => e.gen);
  if (!list.length || rnd() > 0.12) continue;
  list.sort((x, y) => y.highlights + y.connections - (x.highlights + x.connections))[0].overview = 'shown';
}

const out = {
  note: 'TEST DATA ONLY, built by tests/fixtures/overview/build.mjs. Years are astronomical (431 BCE = -430). Entries with "gen": 1 are generated: generic titles, random dates, places and weights. Extents are present-day countries (ISO codes) or circles [lon, lat, km], a stand-in, not a historical map.',
  parents: PARENTS, regions: REGIONS, groups, polities, reach, eras, world, entries, threads, contacts: cleanContacts,
};
writeFileSync(here('stress.json'), JSON.stringify(out) + '\n');

// ---------- inline into the prototype ----------
const map = { W: 1000, H: round((BOX[3] - BOX[1]) * S, 1), lon0: BOX[0], lat1: BOX[3], kx: KX, s: S, land: LAND, box: LBOX };
const page = here('../../../docs/prototypes/polities.html');
const html = readFileSync(page, 'utf8');
const open = '<script id="overview-data" type="application/json">', close = '</script>';
const a = html.indexOf(open), b = html.indexOf(close, a);
if (a < 0) throw new Error('no overview-data block in polities.html');
const payload = JSON.stringify({ ...out, map }).replace(/</g, '\\u003c');
writeFileSync(page, html.slice(0, a + open.length) + payload + html.slice(b));
console.log(`${polities.length} polities, ${REGIONS.length} regions, ${eras.length} eras, ${world.length} world events, ${entries.length} entries, ${threads.length} threads, ${cleanContacts.length} contacts; land ${Object.keys(LAND).length} countries, ${(JSON.stringify(LAND).length / 1024).toFixed(0)} KB; page data ${(payload.length / 1024).toFixed(0)} KB`);
