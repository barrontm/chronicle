/**
 * Sentence boundaries in the reader's article text, for tap-a-sentence on the
 * phone. A sentence never crosses a block ("\n"). `Intl.Segmenter` does the
 * work; a fix-up merges the splits it makes after abbreviations ("c. 431 BC",
 * "St. Paul", "No. 5").
 */
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('en', { granularity: 'sentence' }) : null;
const ABBREVIATION = /(?:^|[\s(])(?:c|ca|cf|vs|v|e\.g|i\.e|viz|St|Mr|Mrs|Ms|Dr|Prof|Mt|Ft|No|Nos|Fig|ed|eds|vol|vols|p|pp|ch|r|b|d|fl|approx|esp|Jr|Sr|Gen|Col|Capt|Lt|Sgt|Sen|Rep|Gov|Pres|Rev|al)\.$/;

export function sentencesOf(text: string): [number, number][] {
  const out: [number, number][] = [];
  let pos = 0;
  for (const line of text.split('\n')) {
    if (line) for (const s of segmenter ? lineSentences(line) : fallback(line)) out.push([pos + s[0], pos + s[1]]);
    pos += line.length + 1;
  }
  return out;
}

function lineSentences(line: string): [number, number][] {
  const out: [number, number][] = [];
  let cur: [number, number] | null = null;
  for (const it of segmenter!.segment(line)) {
    const s = it.index;
    let e = s + it.segment.length;
    while (e > s && line[e - 1] === ' ') e--;
    if (e <= s) continue;
    if (cur) {
      // "…in c." + "431 BC…"
      if (ABBREVIATION.test(line.slice(cur[0], cur[1]))) {
        cur[1] = e;
        continue;
      }
      out.push(cur);
    }
    cur = [s, e];
  }
  if (cur) out.push(cur);
  return out;
}

// Browsers without Intl.Segmenter: split at ". " before a capital or digit.
function fallback(line: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /[.!?]["')\]]*\s+(?=[A-Z0-9"'(])/g;
  let s = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    out.push([s, m.index + 1]);
    s = m.index + m[0].length;
  }
  if (s < line.length) out.push([s, line.length]);
  return out.filter(([a, b]) => b - a > 1);
}

/** Index of the sentence holding text index `i`, or -1. */
export function sentenceAt(sentences: [number, number][], i: number): number {
  let lo = 0;
  let hi = sentences.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sentences[mid][0] <= i) lo = mid;
    else hi = mid - 1;
  }
  return sentences.length && i >= sentences[lo][0] && i < sentences[lo][1] ? lo : -1;
}
