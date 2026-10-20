// Builds the Classical Greece fixture (TEST DATA ONLY, never shipped in the app).
//   node tests/fixtures/greece/build.mjs
// Writes, next to this file:
//   classical-greece.json  a schema-9 doc the app imports today (entries, eras in a region, highlights, themes, territories, a migration, trends, notes, sources, connections)
//   next.json              the shapes the schema does not have yet (regimes, economy, campaign routes, goods flows),
//                          taken from Bob's chosen prototypes in docs/prototypes. Each phase that adds a shape moves its part into the doc.
// Dates are astronomical years (431 BCE = -430). In this file BCE years are written positive and '~' marks approximate.
// Facts come from the author's knowledge and the prototypes, not from live Wikidata/Pleiades lookups; coordinates are
// city centres, good to a few km. Territory outlines are rough hand-drawn shapes.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const proto = (n) => readFileSync(here(`../../../docs/prototypes/${n}.html`), 'utf8');
const NOW = 1760000000000;
const bce = (n) => 1 - n;
const t = (y, f) => 1 - y + f;

// ---------- pull sample data out of the prototypes ----------
function grab(src, name, scope = {}) {
  const at = src.indexOf(`const ${name} =`);
  if (at < 0) throw new Error(`no ${name}`);
  let i = src.indexOf('=', at) + 1;
  while (/\s/.test(src[i])) i++;
  const open = src[i], close = open === '[' ? ']' : '}';
  let depth = 0, q = null, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === open) depth++;
    if (c === close && --depth === 0) break;
  }
  const keys = Object.keys(scope);
  return new Function('bce', 't', ...keys, `return (${src.slice(i, j + 1)});`)(bce, t, ...keys.map((k) => scope[k]));
}

const war = proto('war'), pol = proto('polity'), eco = proto('economy'), ovw = proto('overview');
const BATTLES = grab(war, 'BATTLES'), PHASES = grab(war, 'PHASES');
const WPL = grab(war, 'PL'), SEA = grab(war, 'SEA'), LAND = grab(war, 'LAND');
const ROUTES = grab(war, 'ROUTES', { RANGE_ATTICA: grab(war, 'RANGE_ATTICA') });
const INST = grab(pol, 'INST'), RADICAL = grab(pol, 'RADICAL');
const REGIMES = grab(pol, 'REGIMES', { RADICAL }), SPARTA = grab(pol, 'SPARTA');
const EPL = grab(eco, 'PL'), ESEA = grab(eco, 'SEA'), EATT = grab(eco, 'ATT_SEA');
const SECTORS = grab(eco, 'SECTORS'), SNAPS = grab(eco, 'SNAPS'), MOMENTS = grab(eco, 'MOMENTS'), SITES = grab(eco, 'SITES');
const GOODS = grab(eco, 'FLOWS', { SEA: ESEA, ATT_SEA: EATT, PL: EPL });
const OITEMS = grab(ovw, 'ITEMS'), OTHEMES = grab(ovw, 'CLASSICAL_THEMES');

// ---------- ids, sources, small helpers ----------
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const CAT = { pol: 'politics', war: 'war', ideas: 'ideas', sci: 'science', tech: 'technology', soc: 'society', arts: 'arts' };
const DIM_LANE = { political: ['politics'], economic: ['economy'], intellectual: ['ideas'], religious: ['ideas'], technological: ['technology'], social: [] };
const DIMTAG = { pol: 'political', eco: 'economic', soc: 'social', tec: 'technological', int: 'intellectual', rel: 'religious' };
const sources = [
  { id: 's_thuc', kind: 'book', title: 'History of the Peloponnesian War', authors: 'Thucydides; trans. Rex Warner', year: '1972', publisher: 'Penguin', remarks: 'Our main source for 431–411 BCE; breaks off mid-sentence.' },
  { id: 's_hdt', kind: 'book', title: 'The Histories', authors: 'Herodotus; trans. Aubrey de Sélincourt', year: '1954', publisher: 'Penguin', remarks: 'Our main source for the Persian Wars; a good storyteller, not always a careful one.' },
  { id: 's_xen', kind: 'book', title: 'A History of My Times (Hellenica)', authors: 'Xenophon; trans. Rex Warner', year: '1966', publisher: 'Penguin', remarks: 'Picks up where Thucydides stops (411) and runs to 362.' },
  { id: 's_ath', kind: 'book', title: 'The Athenian Constitution', authors: 'Aristotle (attributed); trans. P. J. Rhodes', year: '1984', publisher: 'Penguin', remarks: 'How Athens’ government changed, from Draco to Aristotle’s day.' },
  { id: 's_hansen', kind: 'book', title: 'The Athenian Democracy in the Age of Demosthenes', authors: 'Mogens Herman Hansen', year: '1991', publisher: 'Blackwell', remarks: 'The standard account of how the fourth-century machinery worked.' },
  { id: 's_ober', kind: 'book', title: 'The Rise and Fall of Classical Greece', authors: 'Josiah Ober', year: '2015', publisher: 'Princeton University Press' },
  { id: 's_lecture', kind: 'lecture', title: 'Classical Greece, lecture 6: the Athenian empire', authors: 'A made-up lecture series (test data)', year: '2026', remarks: 'Stands in for a lecture Bob watched.' },
];
const wpIds = new Map();
function wp(title) {
  const id = `s_wp_${slug(title)}`;
  if (!wpIds.has(id)) wpIds.set(id, { id, kind: 'web', title, publisher: 'Wikipedia', url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_')).replace(/%28/g, '(').replace(/%29/g, ')')}` });
  return id;
}
const hd = (y) => {
  const approx = typeof y === 'string' && y.startsWith('~');
  const n = Number(approx ? y.slice(1) : y);
  return approx ? { y: bce(n), approx: true } : { y: bce(n) };
};

// ---------- entries ----------
const rows = [];
const add = (kind) => (id, title, a, b, cat, dim, o = {}) => rows.push({ id, kind, title, a, b, cat, dim, o });
const ev = (id, title, y, cat, dim, o) => add('event')(id, title, y, null, cat, dim, o);
const sp = add('span');
const pe = add('person');
const at = (name, lat, lon) => ({ name, lat, lon, role: 'site' });

// Eras
sp('archaic', 'Archaic Greece', '~800', 480, 'pol', 'pol', { d: 'City-states, colonies, tyrants and the alphabet.', tags: ['era'] });
sp('classical', 'Classical Greece', 480, 323, 'pol', 'pol', { d: 'From Salamis to the death of Alexander.', tags: ['era'], w: 'Classical Greece' });
sp('pentecontaetia', 'The Fifty Years', 479, 431, 'pol', 'pol', { d: 'Athens grows from leader of an alliance into an empire.', tags: ['era'] });
sp('hegemonies', 'Spartan and Theban supremacy', 404, 362, 'pol', 'pol', { tags: ['era'] });
sp('macedon_rises', 'Macedon rises', 359, 323, 'pol', 'pol', { tags: ['era'] });
sp('hellenistic', 'Hellenistic period', 323, 31, 'pol', 'pol', { tags: ['era'] });

// Persian Wars
sp('persian', 'Greco-Persian Wars', 499, 449, 'war', 'pol', { d: 'Persia against the Greek cities, first in Ionia and then in Greece itself.', w: 'Greco-Persian Wars', src: ['s_hdt'] });
sp('ionian', 'Ionian Revolt', 499, 493, 'war', 'pol', { par: 'persian', at: at('Miletus', 37.53, 27.28), w: 'Ionian Revolt' });
ev('lade', 'Battle of Lade', 494, 'war', 'pol', { par: 'ionian', at: at('Lade', 37.5, 27.3), w: 'Battle of Lade' });
ev('marathon', 'Battle of Marathon', 490, 'war', 'pol', { par: 'persian', d: 'Athenians and Plataeans beat the first Persian landing.', at: at('Marathon', 38.117, 23.96), w: 'Battle of Marathon', src: ['s_hdt'] });
pe('darius', 'Darius I', 550, 486, 'pol', 'pol', { w: 'Darius the Great' });
pe('xerxes', 'Xerxes I', 518, 465, 'pol', 'pol', { w: 'Xerxes I' });
sp('xerxes_invasion', 'Xerxes’ invasion', 480, 479, 'war', 'pol', { par: 'persian', d: 'A great army and fleet cross the Hellespont.', src: ['s_hdt'] });
ev('thermopylae', 'Battle of Thermopylae', 480, 'war', 'pol', { par: 'xerxes_invasion', at: at('Thermopylae', 38.797, 22.536), w: 'Battle of Thermopylae', src: ['s_hdt'] });
ev('artemisium', 'Battle of Artemisium', 480, 'war', 'pol', { par: 'xerxes_invasion', at: at('Cape Artemisium', 39.05, 23.2), w: 'Battle of Artemisium' });
ev('salamis', 'Battle of Salamis', 480, 'war', 'pol', { par: 'xerxes_invasion', d: 'The Greek fleet wins in the narrow strait.', at: at('Salamis', 37.95, 23.5), w: 'Battle of Salamis', src: ['s_hdt'] });
ev('plataea', 'Battle of Plataea', 479, 'war', 'pol', { par: 'xerxes_invasion', at: at('Plataea', 38.215, 23.27), w: 'Battle of Plataea', src: ['s_hdt'] });
ev('mycale', 'Battle of Mycale', 479, 'war', 'pol', { par: 'xerxes_invasion', at: at('Mycale', 37.68, 27.15), w: 'Battle of Mycale' });

// The Fifty Years
ev('delian_founded', 'Delian League founded', 478, 'pol', 'pol', { d: 'Greek cities pool ships and money against Persia, with Athens in the lead.', at: at('Delos', 37.4, 25.27), w: 'Delian League', src: ['s_thuc'] });
ev('themistocles_ostracised', 'Themistocles ostracised', '~471', 'pol', 'pol', { at: at('Athens', 37.972, 23.727) });
ev('eurymedon', 'Battle of the Eurymedon', '~466', 'war', 'pol', { par: 'persian', at: at('Eurymedon river', 36.9, 31.1), w: 'Battle of the Eurymedon' });
ev('sparta_quake', 'Earthquake at Sparta', '~464', 'soc', 'soc', { at: at('Sparta', 37.075, 22.43) });
sp('helot_revolt', 'Helot revolt in Messenia', 464, 460, 'soc', 'soc', { d: 'The helots rise after the earthquake; Sparta asks Athens for help, then sends it home.', at: at('Mount Ithome', 37.18, 21.92) });
ev('ephialtes', 'Ephialtes’ reforms', 462, 'pol', 'pol', { d: 'The Areopagus loses most of its powers to the Council, the Assembly and the courts.', at: at('Athens', 37.972, 23.727), w: 'Athenian democracy', src: ['s_ath'] });
ev('cimon_ostracised', 'Cimon ostracised', 461, 'pol', 'pol', {});
sp('long_walls', 'Long Walls built', '~461', '~456', 'tech', 'tec', { d: 'Walls join Athens to its harbour at Piraeus.', at: at('Piraeus', 37.942, 23.636), w: 'Long Walls' });
sp('egypt_expedition', 'Athenian expedition to Egypt', '~460', 454, 'war', 'pol', { d: 'A fleet sent to help an Egyptian revolt is destroyed.', src: ['s_thuc'] });
ev('tanagra', 'Battle of Tanagra', 457, 'war', 'pol', { at: at('Tanagra', 38.32, 23.53) });
ev('treasury_moved', 'League treasury moves to Athens', 454, 'pol', 'eco', { d: 'The money moves from Delos to the Acropolis, and the alliance becomes an empire.', at: at('Athens', 37.972, 23.727), src: ['s_lecture'] });
ev('citizenship_law', 'Pericles’ citizenship law', 451, 'soc', 'soc', { d: 'Citizenship needs an Athenian mother as well as father.', src: ['s_ath'] });
ev('callias', 'Peace of Callias', '~449', 'pol', 'pol', { d: 'A peace with Persia, if it happened; ancient writers disagree.', w: 'Peace of Callias' });
sp('juror_pay', 'Pay for jurors begins', '~450', '~449', 'soc', 'soc', { d: 'Poorer citizens can afford to sit on juries.' });
sp('parthenon_built', 'Parthenon built', 447, 432, 'arts', 'rel', { d: 'A marble temple to Athena, paid for from the empire’s tribute.', at: at('Acropolis', 37.9715, 23.7257), w: 'Parthenon', src: ['s_ober'] });
sp('propylaea', 'Propylaea built', 437, 432, 'arts', 'rel', { at: at('Acropolis', 37.9715, 23.7257) });
ev('thirty_years_peace', 'Thirty Years’ Peace', 446, 'pol', 'pol', {});
ev('thurii', 'Thurii founded', 444, 'pol', 'eco', { d: 'A panhellenic colony in southern Italy.', at: at('Thurii', 39.72, 16.48), w: 'Thurii' });
sp('samian_war', 'Samian War', 440, 439, 'war', 'pol', { at: at('Samos', 37.69, 26.94) });
ev('corcyra', 'Dispute over Epidamnus and Corcyra', 435, 'pol', 'pol', {});
ev('sybota', 'Battle of Sybota', 433, 'war', 'pol', { at: at('Sybota', 39.45, 20.25) });
ev('potidaea_revolt', 'Potidaea revolts', 432, 'war', 'pol', { at: at('Potidaea', 40.195, 23.33) });
ev('megarian_decree', 'Megarian decree', 432, 'pol', 'eco', { d: 'Megarian merchants are shut out of Athens’ harbours and markets.' });

// Peloponnesian War
sp('pelop', 'Peloponnesian War', 431, 404, 'war', 'pol', { d: 'Athens and its empire against Sparta and the Peloponnesian League.', w: 'Peloponnesian War', src: ['s_thuc'] });
const PHASE_ID = { 'Archidamian War': 'archidamian', 'Sicilian Expedition': 'sicilian', 'Decelean War': 'decelean' };
sp('archidamian', 'Archidamian War', 431, 421, 'war', 'pol', { par: 'pelop', d: 'Sparta invades Attica each summer; Athens raids the coast.' });
ev('peace_nicias', 'Peace of Nicias', 421, 'pol', 'pol', { par: 'pelop', w: 'Peace of Nicias', src: ['s_thuc'] });
sp('sicilian', 'Sicilian Expedition', 415, 413, 'war', 'pol', { par: 'pelop', d: 'The greatest fleet Athens ever sent out is lost at Syracuse.', w: 'Sicilian Expedition', src: ['s_thuc'] });
sp('decelean', 'Decelean War', 413, 404, 'war', 'pol', { par: 'pelop' });
ev('funeral_oration', 'Pericles’ funeral oration', 431, 'ideas', 'pol', { d: 'A speech over the first year’s dead, praising Athens and its way of life.', at: at('Athens', 37.972, 23.727), src: ['s_thuc'] });
sp('plague', 'Plague of Athens', 430, 426, 'soc', 'soc', { d: 'Crowded behind the walls, perhaps a quarter of the people die.', at: at('Athens', 37.972, 23.727), w: 'Plague of Athens', src: ['s_thuc'] });
ev('herms', 'Herms mutilated', 415, 'ideas', 'rel', { d: 'In one night the stone herms of Athens are defaced, just before the fleet sails.', at: at('Athens', 37.972, 23.727) });
ev('alcibiades_defects', 'Alcibiades defects to Sparta', 415, 'pol', 'pol', {});
ev('four_hundred', 'Rule of the Four Hundred', 411, 'pol', 'pol', { d: 'An oligarchic coup replaces the democracy for a few months.', at: at('Athens', 37.972, 23.727), src: ['s_ath'] });
ev('arginusae_trial', 'Trial of the generals', 406, 'pol', 'soc', { d: 'Six victorious generals are executed together for not rescuing the sailors.', at: at('Athens', 37.972, 23.727) });
ev('thirty', 'The Thirty take power', 404, 'pol', 'pol', { d: 'A pro-Spartan oligarchy rules for about eight months.', at: at('Athens', 37.972, 23.727), w: 'Thirty Tyrants', src: ['s_xen'] });
ev('democracy_restored', 'Democracy restored', 403, 'pol', 'pol', { d: 'Thrasybulus leads exiles back from Phyle; an amnesty follows.', at: at('Piraeus', 37.942, 23.636), src: ['s_ath'] });
const phaseOf = (y) => (PHASES.find((p) => y >= p.from && y < p.to && PHASE_ID[p.name]) ? PHASE_ID[PHASES.find((p) => y >= p.from && y < p.to && PHASE_ID[p.name]).name] : 'pelop');
for (const b of BATTLES) {
  const y = Math.floor(b.t);
  const o = { par: phaseOf(b.t), d: `${b.res}. ${b.note}`, at: at(b.name.replace(/^Battle (of|in) (the )?/, ''), b.at[1], b.at[0]), src: ['s_thuc'] };
  if (b.q) { o.excerpt = { text: b.q[0], article: b.q[1] }; }
  rows.push({ id: `b_${b.id}`, kind: 'event', title: b.name, a: String(1 - y), b: null, cat: 'war', dim: 'pol', o, _y: y });
}

// The fourth century
sp('anabasis', 'March of the Ten Thousand', 401, 399, 'war', 'pol', { d: 'Greek mercenaries fight their way home from the heart of Persia.', w: 'Anabasis (Xenophon)', src: ['s_xen'] });
ev('trial_socrates', 'Trial of Socrates', 399, 'ideas', 'int', { d: 'Condemned for impiety and corrupting the young.', at: at('Athens', 37.972, 23.727), w: 'Trial of Socrates' });
ev('catapult', 'First catapults', 399, 'tech', 'tec', { d: 'Engineers working for Dionysius of Syracuse.', at: at('Syracuse', 37.07, 15.285) });
sp('corinthian_war', 'Corinthian War', 395, 387, 'war', 'pol', { w: 'Corinthian War' });
ev('kings_peace', 'The King’s Peace', 387, 'pol', 'pol', { d: 'Persia dictates terms to the quarrelling Greek cities.', w: 'King\'s Peace' });
ev('academy', 'Plato founds the Academy', 387, 'ideas', 'int', { at: at('Academy', 37.9925, 23.7083), src: ['s_hansen'] });
ev('cadmea', 'Sparta seizes the Cadmea', 382, 'war', 'pol', { at: at('Thebes', 38.32, 23.32) });
ev('second_league', 'Second Athenian League', 378, 'pol', 'pol', {});
ev('leuctra', 'Battle of Leuctra', 371, 'war', 'pol', { d: 'Thebes breaks Sparta’s army and its reputation.', at: at('Leuctra', 38.19, 23.18), w: 'Battle of Leuctra', src: ['s_xen'] });
ev('messene', 'Messene founded', 369, 'pol', 'soc', { d: 'The helots are freed; Sparta loses half its land.', at: at('Messene', 37.18, 21.92) });
ev('mantinea362', 'Battle of Mantinea (362)', 362, 'war', 'pol', { d: 'Thebes wins, but Epaminondas is killed.', at: at('Mantinea', 37.617, 22.393), w: 'Battle of Mantinea (362 BC)' });
sp('social_war', 'Social War', 357, 355, 'war', 'pol', { d: 'Athens’ allies break away.' });
sp('sacred_war', 'Third Sacred War', 356, 346, 'war', 'rel', { d: 'Phocis seizes the sanctuary at Delphi.', at: at('Delphi', 38.482, 22.501), w: 'Third Sacred War' });
ev('philip_king', 'Philip II becomes king', 359, 'pol', 'pol', { at: at('Pella', 40.76, 22.52) });
ev('amphipolis357', 'Philip takes Amphipolis', 357, 'war', 'pol', { at: at('Amphipolis', 40.822, 23.845) });
sp('sarissa', 'Philip’s pike phalanx', 359, 336, 'tech', 'tec', { d: 'Infantry with pikes five or six metres long.', w: 'Sarissa' });
ev('olynthus', 'Olynthus destroyed', 348, 'war', 'pol', { at: at('Olynthus', 40.29, 23.36), w: 'Olynthus' });
ev('philocrates', 'Peace of Philocrates', 346, 'pol', 'pol', {});
ev('chaeronea', 'Battle of Chaeronea', 338, 'war', 'pol', { d: 'Philip beats Athens and Thebes; his son Alexander leads the cavalry.', at: at('Chaeronea', 38.49, 22.85), w: 'Battle of Chaeronea (338 BC)', src: ['s_hansen'] });
ev('corinth_league', 'League of Corinth', 337, 'pol', 'pol', { at: at('Corinth', 37.906, 22.88) });
ev('philip_dies', 'Philip II assassinated', 336, 'pol', 'pol', { at: at('Aigai', 40.49, 22.32) });
ev('lyceum', 'Aristotle opens the Lyceum', 335, 'ideas', 'int', { at: at('Lyceum', 37.975, 23.745) });
ev('thebes_destroyed', 'Thebes destroyed', 335, 'war', 'pol', { at: at('Thebes', 38.32, 23.32) });
sp('alexander_persia', 'Alexander’s conquest of Persia', 334, 323, 'war', 'pol', { w: 'Wars of Alexander the Great' });
ev('issus', 'Battle of Issus', 333, 'war', 'pol', { par: 'alexander_persia', at: at('Issus', 36.83, 36.2) });
ev('gaugamela', 'Battle of Gaugamela', 331, 'war', 'pol', { par: 'alexander_persia', at: at('Gaugamela', 36.55, 43.4) });
ev('alexander_dies', 'Alexander dies in Babylon', 323, 'pol', 'pol', { at: at('Babylon', 32.54, 44.42) });
sp('lamian', 'Lamian War', 323, 322, 'war', 'pol', { d: 'Athens and its allies rise against Macedon and lose.', w: 'Lamian War' });
ev('macedon_garrison', 'Macedonian garrison at Munychia', 322, 'pol', 'pol', { d: 'Citizenship is limited to men worth 2,000 drachmas.', at: at('Munychia', 37.935, 23.65) });

// Other happenings
ev('laurion', 'Silver strike at Laurion', 483, 'soc', 'eco', { d: 'A rich vein pays for the fleet that wins at Salamis.', at: at('Laurion', 37.72, 24.05), w: 'Laurion', src: ['s_ath'] });
sp('owls', 'Athenian silver “owls”', '~510', 322, 'soc', 'eco', { d: 'Coins stamped with Athena’s owl become a common currency around the Aegean.' });
sp('trireme', 'Trireme fleets', 600, 322, 'tech', 'tec', { d: 'A warship with 170 oarsmen in three banks.', w: 'Trireme' });
sp('hoplite', 'Hoplite phalanx', '~700', 338, 'tech', 'tec', { d: 'Citizens in bronze armour fighting shoulder to shoulder.', w: 'Hoplite' });
ev('piraeus_plan', 'Piraeus laid out on a grid', '~470', 'tech', 'soc', { d: 'Planned by Hippodamus of Miletus.', at: at('Piraeus', 37.942, 23.636) });
ev('asclepius', 'Cult of Asclepius comes to Athens', 420, 'ideas', 'rel', { at: at('Athens', 37.972, 23.727) });
ev('thespis', 'Thespis wins the first tragedy contest', '~534', 'arts', 'int', { at: at('Athens', 37.972, 23.727) });
ev('oresteia', 'Aeschylus’ Oresteia staged', 458, 'arts', 'int', {});
ev('medea', 'Euripides’ Medea staged', 431, 'arts', 'int', {});
ev('oedipus', 'Sophocles’ Oedipus the King', '~429', 'arts', 'int', {});
ev('clouds', 'Aristophanes’ Clouds', 423, 'arts', 'int', { d: 'A comedy that makes fun of Socrates.' });
ev('histories', 'Herodotus’ Histories', '~430', 'arts', 'int', { d: 'The first long prose account of a war and the peoples in it.', src: ['s_hdt'] });
ev('thucydides_history', 'Thucydides begins his History', 431, 'arts', 'int', { src: ['s_thuc'] });
ev('city_dionysia', 'City Dionysia', '~500', 'ideas', 'rel', { d: 'The spring festival where tragedies and comedies compete.' });

// People
pe('cleisthenes', 'Cleisthenes', '~570', '~508', 'pol', 'pol', { d: 'His reforms of 508 BCE founded Athenian democracy.', w: 'Cleisthenes' });
pe('themistocles', 'Themistocles', 524, 459, 'pol', 'pol', { w: 'Themistocles', src: ['s_hdt'] });
pe('aristides', 'Aristides', '~530', 468, 'pol', 'pol', {});
pe('leonidas', 'Leonidas I', '~540', 480, 'war', 'pol', { w: 'Leonidas I' });
pe('cimon', 'Cimon', 510, 450, 'pol', 'pol', {});
pe('pericles', 'Pericles', 495, 429, 'pol', 'pol', { d: 'The leading voice in Athens for thirty years.', w: 'Pericles', src: ['s_thuc'] });
pe('aspasia', 'Aspasia', '~470', '~400', 'soc', 'soc', {});
pe('phidias', 'Phidias', '~480', '~430', 'arts', 'rel', { w: 'Phidias' });
pe('anaxagoras', 'Anaxagoras', '~500', 428, 'ideas', 'int', {});
pe('protagoras', 'Protagoras', '~490', '~420', 'ideas', 'int', {});
pe('herodotus', 'Herodotus', '~484', '~425', 'arts', 'int', { w: 'Herodotus' });
pe('thucydides', 'Thucydides', '~460', '~400', 'arts', 'int', { d: 'General, exile and historian of the war.', w: 'Thucydides' });
pe('aeschylus', 'Aeschylus', 525, 456, 'arts', 'int', { w: 'Aeschylus' });
pe('sophocles', 'Sophocles', 497, 406, 'arts', 'int', { w: 'Sophocles' });
pe('euripides', 'Euripides', 480, 406, 'arts', 'int', { w: 'Euripides' });
pe('aristophanes', 'Aristophanes', '~446', '~386', 'arts', 'int', { w: 'Aristophanes' });
pe('pindar', 'Pindar', '~518', '~438', 'arts', 'int', {});
pe('hippocrates', 'Hippocrates', '~460', '~370', 'sci', 'int', { w: 'Hippocrates' });
pe('democritus', 'Democritus', '~460', '~370', 'sci', 'int', {});
pe('hippodamus', 'Hippodamus of Miletus', '~498', '~408', 'sci', 'tec', {});
pe('socrates', 'Socrates', '~470', 399, 'ideas', 'int', { d: 'Asked questions in the marketplace until Athens had had enough.', at: at('Athens', 37.972, 23.727), w: 'Socrates' });
pe('plato', 'Plato', '~428', '~348', 'ideas', 'int', { w: 'Plato' });
pe('aristotle', 'Aristotle', 384, 322, 'ideas', 'int', { d: 'Student of Plato, tutor of Alexander.', w: 'Aristotle' });
pe('gorgias', 'Gorgias', '~483', '~375', 'ideas', 'int', {});
pe('diogenes', 'Diogenes of Sinope', '~412', 323, 'ideas', 'int', {});
pe('xenophon', 'Xenophon', '~430', '~354', 'arts', 'int', { w: 'Xenophon' });
pe('alcibiades', 'Alcibiades', 450, 404, 'pol', 'pol', { d: 'Brilliant, vain and loyal to whoever was winning.', w: 'Alcibiades', src: ['s_thuc'] });
pe('nicias', 'Nicias', '~470', 413, 'war', 'pol', {});
pe('lysander', 'Lysander', '~454', 395, 'war', 'pol', { w: 'Lysander' });
pe('agesilaus', 'Agesilaus II', '~444', 360, 'pol', 'pol', {});
pe('thrasybulus', 'Thrasybulus', '~445', 388, 'pol', 'pol', {});
pe('epaminondas', 'Epaminondas', '~418', 362, 'war', 'pol', { w: 'Epaminondas' });
pe('pelopidas', 'Pelopidas', '~410', 364, 'war', 'pol', {});
pe('lysias', 'Lysias', '~445', '~380', 'arts', 'soc', {});
pe('isocrates', 'Isocrates', 436, 338, 'arts', 'int', {});
pe('praxiteles', 'Praxiteles', '~395', '~330', 'arts', 'int', {});
pe('polykleitos', 'Polykleitos', '~480', '~420', 'arts', 'int', {});
pe('dionysius', 'Dionysius I of Syracuse', '~432', 367, 'pol', 'pol', { at: at('Syracuse', 37.07, 15.285) });
pe('demosthenes', 'Demosthenes', 384, 322, 'pol', 'pol', { d: 'Spent his career warning Athens about Philip.', w: 'Demosthenes' });
pe('philip', 'Philip II of Macedon', 382, 336, 'pol', 'pol', { w: 'Philip II of Macedon' });
pe('alexander', 'Alexander the Great', 356, 323, 'war', 'pol', { w: 'Alexander the Great' });

// ---------- build the doc ----------
const items = [];
const wpSrc = wp;
for (const r of rows) {
  const it = { id: `i_${r.id}`, kind: r.kind, title: r.title, start: hd(r.a), categoryId: CAT[r.cat], updatedAt: NOW };
  if (r.kind !== 'event') it.end = hd(r.b);
  if (r.o.d) it.description = r.o.d;
  const cites = (r.o.src ?? []).map((sourceId) => ({ sourceId }));
  if (r.o.w) cites.push({ sourceId: wpSrc(r.o.w) });
  if (cites.length) it.citations = cites;
  if (r.o.at) it.places = [r.o.at];
  const tags = [...(r.o.tags ?? []), ...(DIMTAG[r.dim] ? [DIMTAG[r.dim]] : [])];
  if (tags.length) it.tags = tags;
  // Eras are periods in the Greece row of the overview (level 0).
  if (r.o.tags?.includes('era')) Object.assign(it, { subject: 'period', region: 'Greece' });
  items.push(it);
}
const byId = new Set(items.map((i) => i.id));
const relations = [];
let rn = 0;
const rel = (from, to, type, note) => {
  if (!byId.has(`i_${from}`) || !byId.has(`i_${to}`)) throw new Error(`relation ${from} → ${to}`);
  relations.push({ id: `r_${++rn}`, fromId: `i_${from}`, toId: `i_${to}`, type, ...(note ? { note } : {}), updatedAt: NOW });
};
for (const r of rows) if (r.o.par) rel(r.id, r.o.par, 'part-of');
rel('socrates', 'plato', 'influenced'); rel('plato', 'aristotle', 'influenced'); rel('aristotle', 'alexander', 'influenced', 'tutored him at Mieza');
rel('anaxagoras', 'pericles', 'influenced'); rel('isocrates', 'demosthenes', 'related');
rel('cleisthenes', 'ephialtes', 'related', 'democracy built in two steps');
rel('laurion', 'salamis', 'caused', 'the silver built the fleet'); rel('laurion', 'trireme', 'related');
rel('salamis', 'delian_founded', 'caused'); rel('delian_founded', 'treasury_moved', 'caused'); rel('treasury_moved', 'parthenon_built', 'caused', 'paid for from the tribute');
rel('megarian_decree', 'pelop', 'caused'); rel('plague', 'pericles', 'caused', 'he died of it in 429');
rel('herms', 'alcibiades_defects', 'caused'); rel('alcibiades_defects', 'decelean', 'caused');
rel('b_aegospotami', 'thirty', 'caused'); rel('thirty', 'democracy_restored', 'caused'); rel('sicilian', 'decelean', 'caused');
rel('leuctra', 'messene', 'caused'); rel('chaeronea', 'corinth_league', 'caused'); rel('philip', 'alexander', 'influenced');
rel('trial_socrates', 'academy', 'caused'); rel('thucydides', 'thucydides_history', 'related'); rel('herodotus', 'histories', 'related');

// ---------- territories: rough hand-drawn outlines ----------
const ring = (pts) => ({ type: 'Polygon', coordinates: [[...pts, pts[0]]] });
const snap = (from, to, pts) => ({ from: hd(from), ...(to ? { to: hd(to) } : {}), geometry: ring(pts) });
const TSRC = { name: 'Rough hand-drawn outline (test data), not a historical map' };
const territories = [
  { id: 't_athens', title: 'Athens (Attica)', categoryId: 'politics', itemId: 'i_classical',
    snapshots: [snap(700, 86, [[23.35, 38.15], [23.6, 38.22], [23.95, 38.25], [24.05, 38.05], [24.03, 37.7], [23.9, 37.65], [23.6, 37.85], [23.35, 37.95]])] },
  { id: 't_delian', title: 'Delian League (Athenian empire)', categoryId: 'politics', itemId: 'i_delian_founded',
    snapshots: [
      snap(477, 454, [[23.5, 40.6], [26.0, 40.9], [27.0, 40.3], [27.4, 38.0], [27.0, 36.9], [25.0, 36.2], [23.8, 36.6], [24.0, 37.7], [24.2, 38.3]]),
      snap(454, 412, [[23.3, 40.9], [25.5, 41.3], [28.3, 41.2], [28.2, 40.2], [27.3, 39.5], [27.9, 37.1], [28.3, 36.5], [26.5, 35.9], [24.5, 36.0], [23.9, 36.6], [24.3, 37.7], [24.0, 38.4]]),
      snap(412, 404, [[23.3, 40.9], [25.5, 41.3], [28.0, 41.1], [27.6, 40.3], [26.4, 40.0], [26.7, 38.9], [26.3, 38.0], [26.0, 36.9], [24.5, 36.2], [23.9, 36.6], [24.3, 37.7], [24.0, 38.4]]),
    ] },
  { id: 't_sparta', title: 'Sparta (Laconia and Messenia)', categoryId: 'war',
    snapshots: [
      snap(700, 369, [[21.65, 37.2], [21.95, 37.5], [22.7, 37.5], [23.0, 37.2], [23.2, 36.45], [22.5, 36.4], [22.15, 36.5], [21.7, 36.8]]),
      snap(369, 192, [[22.2, 37.45], [22.7, 37.5], [23.0, 37.2], [23.2, 36.45], [22.5, 36.4], [22.4, 36.8], [22.1, 37.0]]),
    ] },
  { id: 't_corinth', title: 'Corinth', categoryId: 'politics',
    snapshots: [snap(700, 146, [[22.7, 38.05], [23.0, 38.05], [23.2, 37.95], [23.05, 37.8], [22.8, 37.75], [22.65, 37.9]])] },
  { id: 't_thebes', title: 'Thebes (Boeotia)', categoryId: 'war',
    snapshots: [snap(700, 335, [[22.85, 38.4], [23.3, 38.5], [23.9, 38.45], [23.8, 38.26], [23.4, 38.22], [23.0, 38.2]])] },
  { id: 't_macedon', title: 'Macedon', categoryId: 'politics', itemId: 'i_macedon_rises',
    snapshots: [
      snap(700, 358, [[21.7, 40.3], [22.5, 40.0], [23.4, 40.1], [23.2, 40.7], [22.9, 41.0], [21.9, 40.9]]),
      snap(358, 336, [[20.8, 40.2], [22.4, 39.7], [23.8, 40.0], [24.8, 40.8], [25.5, 41.1], [24.0, 41.5], [22.2, 41.5], [20.8, 41.2]]),
      snap(336, 322, [[19.5, 39.0], [22.5, 38.4], [24.2, 38.6], [25.8, 40.2], [26.8, 41.6], [24.0, 42.0], [22.2, 42.2], [20.0, 41.8]]),
    ] },
  { id: 't_syracuse', title: 'Syracuse', categoryId: 'politics',
    snapshots: [
      snap(733, 405, [[14.9, 37.0], [15.3, 37.35], [15.5, 37.0], [15.1, 36.7]]),
      snap(405, 367, [[14.0, 37.6], [15.6, 37.9], [15.7, 36.7], [14.4, 36.7]]),
    ] },
  // The overview's neighbour to the east: one big outline, so its strip's width comes from its area.
  { id: 't_persia', title: 'Achaemenid Persia', categoryId: 'politics',
    snapshots: [
      snap(550, 525, [[27.0, 38.0], [36.0, 41.5], [45.0, 41.0], [55.0, 40.0], [62.0, 37.5], [66.0, 30.0], [58.0, 25.5], [50.0, 29.0], [44.0, 30.0], [36.0, 31.5], [30.0, 36.5]]),
      snap(525, 330, [[26.5, 38.5], [36.0, 42.0], [45.0, 41.5], [55.0, 40.5], [64.0, 39.0], [71.0, 36.0], [72.0, 29.0], [66.0, 24.5], [57.0, 25.5], [50.0, 29.0], [44.0, 30.0], [36.0, 30.0], [32.0, 29.0], [30.5, 31.5], [30.5, 36.5]]),
    ] },
].map((x) => ({ ...x, snapshots: x.snapshots.map((sn) => ({ ...sn, areaKm2: Math.round(ringAreaKm2(sn.geometry.coordinates[0])) })), source: TSRC, updatedAt: NOW }));

/** A ring's area in km² (spherical excess, as `src/data/geo.ts` reckons it). */
function ringAreaKm2(ring) {
  const R = 6371.0088, rad = Math.PI / 180;
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    a += (x2 - x1) * rad * (2 + Math.sin(y1 * rad) + Math.sin(y2 * rad));
  }
  return Math.abs((a * R * R) / 2);
}

// ---------- migration: colonists abroad ----------
const place = (name, lon, lat) => ({ name, lon, lat });
const flows = [{
  id: 'f_colonies', title: 'Greek colonists in Sicily and Italy', categoryId: 'society', cause: 'settlement', measure: 'living', itemId: 'i_archaic',
  routes: [
    { from: place('Corinth', 22.88, 37.906), to: place('Syracuse', 15.285, 37.07), points: [{ x: bce(733), v: 500 }, { x: bce(600), v: 8000 }, { x: bce(480), v: 25000 }] },
    { from: place('Chalcis', 23.6, 38.46), to: place('Naxos (Sicily)', 15.28, 37.82), points: [{ x: bce(734), v: 300 }, { x: bce(600), v: 4000 }] },
    { from: place('Megara', 23.345, 37.996), to: place('Megara Hyblaea', 15.19, 37.2), points: [{ x: bce(728), v: 300 }, { x: bce(600), v: 5000 }] },
    { from: place('Athens', 23.727, 37.972), to: place('Thurii', 16.48, 39.72), points: [{ x: bce(444), v: 1000 }, { x: bce(430), v: 4000 }] },
  ],
  source: { name: 'Illustrative values for the fixture, not estimates' }, note: 'Numbers are made up to give the arrows widths. The dates are the traditional founding dates.', updatedAt: NOW,
}];

// ---------- trends ----------
const mid = (r) => (r[0] + r[1]) / 2;
const series = [
  { id: 'sr_athens_pop', title: 'People living in Athens’ state', unit: 'people', categoryId: 'society', scale: 'linear',
    points: SNAPS.map((s) => ({ x: s.c, v: mid(s.pop) })), source: { name: 'Midpoints of the ranges in the economy prototype (test data)' },
    note: 'Ancient population figures are estimates with wide ranges; this plots the middle of each range.', updatedAt: NOW },
  { id: 'sr_spartiates', title: 'Full Spartan citizens', unit: 'men', categoryId: 'war', scale: 'log',
    points: [{ x: bce(480), v: 8000 }, { x: bce(371), v: 1500 }, { x: bce(330), v: 1000 }],
    source: { name: 'Round figures from the overview prototype (test data)' }, note: 'About 8,000 in 480 BCE, fewer than a thousand in Aristotle’s day.', updatedAt: NOW },
];

// ---------- notes (Bob’s words, test data) ----------
const L = (...ids) => ids.map((i) => `i_${i}`);
const notes = [
  { id: 'n_why_lost', title: 'Why did Athens lose?', body: 'Thucydides blames the Sicilian Expedition more than anything. But the plague had already cost a quarter of the people, Decelea cut the farms off, and Aegospotami lost the last fleet.\n\nIt wasn’t one defeat. It was the money and the men running out.', linkedIds: L('pelop', 'sicilian', 'plague', 'decelean', 'b_aegospotami'), citations: [{ sourceId: 's_thuc', locator: 'bk. 7–8' }], updatedAt: NOW },
  { id: 'n_fleet_money', title: 'Where the fleet’s money came from', body: 'Silver from Laurion paid for the ships at Salamis. After 454 the league’s tribute paid for the Parthenon and for rowers.\n\nSo the same money explains the navy, the temple and the pay for jurors.', linkedIds: L('laurion', 'salamis', 'treasury_moved', 'parthenon_built', 'juror_pay'), citations: [{ sourceId: 's_ober' }], updatedAt: NOW },
  { id: 'n_teachers', title: 'Socrates, Plato, Aristotle, Alexander', body: 'Four generations of teacher and student. Socrates wrote nothing; Plato wrote him into dialogues; Aristotle left the Academy and tutored Alexander.', linkedIds: L('socrates', 'plato', 'aristotle', 'alexander'), updatedAt: NOW },
  { id: 'n_end_freedom', title: 'How Greece lost its independence', body: 'Demosthenes saw it coming. Chaeronea in 338 ended the argument, and the Lamian War in 322 was the last try.', linkedIds: L('demosthenes', 'chaeronea', 'philip', 'lamian'), citations: [{ sourceId: 's_hansen' }], updatedAt: NOW },
  { id: 'n_sparta_shrinks', title: 'Sparta ran out of Spartans', body: 'After Leuctra and the loss of Messenia, Sparta had few citizens and no helots to feed them.', linkedIds: ['sr_spartiates', 't_sparta', ...L('leuctra', 'messene')], updatedAt: NOW },
];

// ---------- highlights: the overview's and the war's quotes, on the entries they support ----------
// The overview prototype's items mostly have an entry here; the rest are highlights on the Classical period itself.
const HIGHLIGHT_ON = {
  delian: 'treasury_moved', democracy: 'ephialtes', pelwar: 'pelop', sparta: 'hegemonies', thebes: 'mantinea362', macedon: 'macedon_rises',
  salamis: 'salamis', thirty: 'thirty', chaeronea: 'chaeronea', silver: 'laurion', decelea: 'decelean', treasure: 'alexander_persia',
  citlaw: 'citizenship_law', plague: 'plague', triremes: 'trireme', longwalls: 'long_walls', sarissa: 'sarissa', catapult: 'catapult',
  tragedy: 'oresteia', sophists: 'protagoras', history: 'thucydides_history', academy: 'academy', trial: 'trial_socrates', lyceum: 'lyceum',
  festivals: 'city_dionysia', parthenon: 'parthenon_built', sacredwar: 'sacred_war', herms: 'herms',
};
const highlights = [
  ...OITEMS.filter((i) => i.q).map((i) => ({ id: `h_${i.id}`, q: i.q, dim: i.dim, on: `i_${HIGHLIGHT_ON[i.id] ?? 'classical'}` })),
  ...BATTLES.filter((b) => b.q).map((b) => ({ id: `h_${b.id}`, q: b.q, dim: 'pol', on: `i_b_${b.id}` })),
].map(({ id, q, dim, on }) => {
  if (!byId.has(on)) throw new Error(`highlight ${id} on ${on}`);
  return { id, sourceId: wp(q[1]), text: q[0], ...(q[2] ? { anchor: { section: q[2], exact: q[0] } } : {}), dim: DIMTAG[dim], usedBy: [on], updatedAt: NOW };
});
// Bob's themes for the Classical period, over those highlights; each takes the dimension most of its highlights have.
const hdim = new Map(highlights.map((h) => [h.id, h.dim]));
items.find((i) => i.id === 'i_classical').themes = OTHEMES.map((th) => {
  const highlightIds = th.items.map((x) => `h_${x}`).filter((h) => hdim.has(h));
  const n = {};
  for (const h of highlightIds) n[hdim.get(h)] = (n[hdim.get(h)] ?? 0) + 1;
  return { id: th.id, label: th.label, dimension: Object.entries(n).sort((a, b) => b[1] - a[1])[0][0], highlightIds };
});

// v9: lanes, the overview mark, strength, regions and their parents, a group, and who took part in what.
const dimOf = new Map(rows.map((r) => [`i_${r.id}`, DIMTAG[r.dim]]));
const ov = overviewShapes();
for (const it of items) {
  if (ov.lanes[it.id]) it.lanes = ov.lanes[it.id];
  if (ov.marks[it.id]) it.overview = ov.marks[it.id];
}
for (const h of highlights) {
  // A highlight is in its entry's lanes; on an era (which has none), its dimension's lane.
  const lanes = ov.lanes[h.usedBy[0]] ?? DIM_LANE[h.dim] ?? [];
  delete h.dim;
  if (lanes.length) h.lanes = lanes;
}
for (const t of territories) {
  if (ov.regions[t.id]) t.region = ov.regions[t.id];
  if (ov.strength[t.id]) t.strength = ov.strength[t.id];
}
for (const p of ov.participants) {
  p.sides.forEach((side, i) => {
    for (const tid of side) relations.push({ id: `r_${tid}_${p.entryId}`, fromId: tid, toId: p.entryId, type: 'related', ...(p.sides.length > 1 && p.sides[1].length ? { side: i + 1 } : {}), updatedAt: NOW });
  });
}

const usedWp = [...wpIds.values()].map((s) => ({ ...s }));
const doc = {
  schemaVersion: 9, id: 'doc_classical_greece', title: 'Classical Greece (test fixture)', updatedAt: NOW,
  categories: [
    { id: 'politics', label: 'Politics & government', color: 'var(--pig-lapis)' },
    { id: 'war', label: 'War & conflict', color: 'var(--pig-cinnabar)' },
    { id: 'ideas', label: 'Philosophy & religion', color: 'var(--pig-umber)' },
    { id: 'science', label: 'Science', color: 'var(--pig-verdigris)' },
    { id: 'technology', label: 'Technology', color: 'var(--pig-ochre)' },
    { id: 'society', label: 'Society & economy', color: 'var(--pig-madder)' },
    { id: 'arts', label: 'Art & literature', color: 'var(--pig-indigo)' },
  ],
  items, series, territories, flows, notes, highlights,
  sources: [...sources, ...usedWp].map((s) => ({ ...s, updatedAt: NOW })),
  relations, deleted: {},
  groups: ov.groups.map((g) => ({ id: g.id, title: g.title, territoryIds: g.members, updatedAt: NOW })),
  regionParents: ov.regionParents,
};

// ---------- the sidecar: shapes the schema does not have yet ----------
const pt = (v) => (typeof v === 'string' ? EPL[v] ?? WPL[v] : v);
const resolveLand = (names) => names.map((n) => (typeof n === 'string' ? WPL[n] : n));
const itemOf = (id) => (byId.has(`i_${id}`) ? `i_${id}` : undefined);
const next = {
  note: 'Test data for shapes the schema does not have yet. Years are decimal astronomical years. Each part moves into the doc when its phase adds the shape (see docs/vision.md).',
  // Highlights and the Classical period's themes are in the doc now. Phase 4: the six dimensions.
  dimensions: ['pol', 'eco', 'soc', 'tec', 'int', 'rel'].map((d) => ({ id: d, tag: DIMTAG[d] })),
  highlightedItems: OITEMS.map(({ q, ...i }) => ({ ...i, highlightId: q ? `h_${i.id}` : undefined })),
  themes: OTHEMES,
  // Phase 5: regimes with their institutions, for Athens (many) and Sparta (one).
  regimes: {
    athens: REGIMES.map(regime),
    sparta: [regime(SPARTA)],
  },
  // Phase 5: campaign routes and the phases of the war.
  war: {
    phases: PHASES,
    routes: ROUTES.map((r) => ({ id: r.id, name: r.name, side: r.side, from: r.from, to: r.to, force: r.force ?? null, points: r.sea ? SEA[r.id] : resolveLand(LAND[r.land]), sea: !!r.sea })),
  },
  // Phase 5b: economy.
  economy: {
    athens: {
      sectors: SECTORS.map(({ q, sites, ...s }) => s),
      snapshots: SNAPS.map(({ v, ...s }) => ({ ...s, sectors: v })),
      moments: MOMENTS,
      sites: SITES.map((s) => ({ ...s, lon: s.at[0], lat: s.at[1] })),
    },
    goods: GOODS.map(({ q, pts, ...g }) => ({ ...g, points: pts.map(pt) })),
  },
  // Phase 4: the overview. Lanes, marks, strength, regions, groups and participants are in the doc (v9); what's left is ticket 8's.
  overview: { alliances: ov.alliances },
};

// Lanes, the overview mark, strength points, regions and their parents, a group of city-states, and the polities
// that took part in wars and alliances (territories as connection ends, with a side).
function overviewShapes() {
  const WAR = /Battle|War\b|Wars\b|Siege|invasion|[Ee]xpedition|[Rr]evolt|surrenders|falls|taken|attack|victories|destroyed|conquest|March of|seizes|takes|garrison|^Delium$|^Mantinea$|^Notium$|^Arginusae$|^Assinarus$|^Cynossema$|^Cyzicus$|^Aegospotami$|^Pylos/;
  // What Bob set by hand, which the automatic sort never overrides.
  const SET = {
    i_sparta_quake: ['nature'], i_plague: ['nature', 'ideas'], i_helot_revolt: ['war', 'politics'], i_citizenship_law: ['politics'],
    i_juror_pay: ['politics', 'economy'], i_piraeus_plan: ['technology', 'economy'], i_aspasia: ['ideas'], i_arginusae_trial: ['politics'],
    i_messene: ['politics'], i_lysias: ['ideas'], i_trireme: ['technology', 'war'], i_hoplite: ['technology', 'war'], i_sarissa: ['technology', 'war'],
    i_catapult: ['technology', 'war'], i_long_walls: ['technology', 'war'], i_megarian_decree: ['economy', 'politics'], i_treasury_moved: ['economy', 'politics'],
    i_parthenon_built: ['ideas', 'economy'], i_thurii: ['economy', 'politics'], i_sacred_war: ['war', 'ideas'], i_herms: ['ideas', 'politics'],
    i_trial_socrates: ['ideas', 'politics'], i_pericles: ['politics', 'war'], i_themistocles: ['politics', 'war'], i_leonidas: ['war'],
    i_lysander: ['war'], i_epaminondas: ['war', 'politics'], i_alexander: ['war', 'politics'], i_philip: ['politics', 'war'],
    i_hippocrates: ['ideas', 'nature'], i_hippodamus: ['technology'], i_laurion: ['economy', 'nature'], i_owls: ['economy'],
  };
  const lanes = {};
  for (const i of items) {
    if (i.subject === 'period') continue;
    const auto = WAR.test(i.title) || i.id.startsWith('i_b_') ? ['war'] : DIM_LANE[dimOf.get(i.id)] ?? [];
    const l = SET[i.id] ?? auto;
    if (l.length) lanes[i.id] = l;
  }
  const y = (n) => ({ y: bce(n) });
  const at = (n, level, ...highlightIds) => ({ at: y(n), level, ...(highlightIds.length ? { highlightIds } : {}) });
  return {
    lanes,
    set: SET,
    marks: { i_persian: 'shown', i_pelop: 'shown', i_plague: 'shown', i_delian_founded: 'shown', i_alexander_persia: 'world', i_academy: 'shown' },
    strength: {
      t_athens: [at(600, 1), at(490, 2), at(479, 3), at(454, 5, 'h_delian'), at(431, 5), at(413, 4, 'h_decelea'), at(404, 2, 'h_thirty'), at(377, 3), at(338, 1, 'h_chaeronea')],
      t_sparta: [at(700, 3), at(480, 4), at(404, 5, 'h_sparta'), at(371, 2, 'h_thebes'), at(338, 1)],
      t_thebes: [at(700, 1), at(395, 2), at(371, 4, 'h_thebes'), at(362, 3), at(338, 1, 'h_chaeronea')],
      t_macedon: [at(700, 1), at(359, 2, 'h_macedon'), at(338, 5, 'h_chaeronea'), at(323, 5)],
    },
    // A territory's region, and each region's parent (Mediterranean › Greece).
    regions: { t_athens: 'Greece', t_sparta: 'Greece', t_corinth: 'Greece', t_thebes: 'Greece', t_delian: 'Greece', t_macedon: 'Macedon', t_syracuse: 'Italy', t_persia: 'Persia' },
    regionParents: { Greece: 'Mediterranean', Macedon: 'Mediterranean', Italy: 'Mediterranean', Persia: 'Near East' },
    groups: [{ id: 'g_classical_greece', title: 'Classical Greece', region: 'Greece', members: ['t_athens', 't_sparta', 't_corinth', 't_thebes'] }],
    // The Delian League is Athens' reach, not a polity of its own: it draws as Athens' alliance on the map.
    alliances: { t_delian: { leader: 't_athens' } },
    // Who took part, and on which side: the contacts the map marks when a polity is picked.
    participants: [
      { entryId: 'i_persian', how: 'war', sides: [['t_athens', 't_sparta', 't_corinth'], ['t_persia']] },
      { entryId: 'i_pelop', how: 'war', sides: [['t_athens'], ['t_sparta', 't_corinth', 't_thebes']] },
      { entryId: 'i_sybota', how: 'war', sides: [['t_athens'], ['t_corinth']] },
      { entryId: 'i_sicilian', how: 'war', sides: [['t_athens'], ['t_syracuse', 't_sparta', 't_corinth']] },
      { entryId: 'i_corinthian_war', how: 'war', sides: [['t_thebes', 't_athens', 't_corinth'], ['t_sparta']] },
      { entryId: 'i_leuctra', how: 'war', sides: [['t_thebes'], ['t_sparta']] },
      { entryId: 'i_mantinea362', how: 'war', sides: [['t_thebes'], ['t_sparta', 't_athens']] },
      { entryId: 'i_chaeronea', how: 'war', sides: [['t_macedon'], ['t_athens', 't_thebes']] },
      { entryId: 'i_lamian', how: 'war', sides: [['t_athens'], ['t_macedon']] },
      { entryId: 'i_alexander_persia', how: 'war', sides: [['t_macedon'], ['t_persia']] },
      { entryId: 'i_kings_peace', how: 'peace', sides: [['t_persia'], ['t_sparta']] },
      { entryId: 'i_delian_founded', how: 'alliance', sides: [['t_athens', 't_delian']] },
      { entryId: 'i_second_league', how: 'alliance', sides: [['t_athens', 't_thebes']] },
      { entryId: 'i_corinth_league', how: 'alliance', sides: [['t_macedon', 't_corinth']] },
      { entryId: 'i_thirty_years_peace', how: 'peace', sides: [['t_athens'], ['t_sparta']] },
    ],
  };
}
function regime(r) {
  return {
    id: r.id, title: r.title, form: r.form, from: r.from, to: r.to, ...(r.client ? { client: r.client } : {}), ...(r.approxFrom ? { approxFrom: true } : {}),
    institutions: Object.entries(r.inst).map(([id, v]) => ({ id, name: v.name ?? INST[id].name, size: v.n, note: v.sub, ...(v.nominal ? { nominal: true } : {}) })),
    links: r.links.map(([from, to, kind, label]) => ({ from, to, kind, ...(label ? { label } : {}) })),
    say: r.say, changes: r.changes,
  };
}

writeFileSync(here('classical-greece.json'), JSON.stringify(doc, null, 1) + '\n');
writeFileSync(here('next.json'), JSON.stringify(next) + '\n');
console.log(`${items.length} entries, ${territories.length} territories, ${relations.length} connections, ${doc.sources.length} sources, ${highlights.length} highlights`);
