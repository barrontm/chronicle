# Spike (b): the reader

Phase 0, ticket 4, run on 2026-10-17. Code, data and demo are on branch `spike/reader` under `spikes/reader/` and are not merged. Machine: Apple M2; Chromium 156, and WebKit 27.2 as the Safari stand-in.

## Recommendation
- **Endpoint:** `/w/rest.php/v1/page/{title}/html`, and `/w/rest.php/v1/revision/{id}/html` for a pinned revision.
  - A plain GET sends no preflight and returns ACAO `*`.
  - RESTBase `rest_v1/page/html` already 307-redirects there.
  - The revision id comes from `<html about=".../Special:Redirect/revision/N">`; `dc:modified` and `mw:pageId` are also in the page.
  - Skip `Api-User-Agent`.
- **Sanitizer:** our own DOMParser walker with allowlists, 3 KB gzipped.
  - It builds a new tree and does the Wikipedia-specific reshaping as it goes.
  - DOMPurify as a second pass changed nothing (11 KB).
  - The Sanitizer API is missing in WebKit.
  - 24 hostile inputs ran nothing in Chromium or WebKit.
  - Sanitized HTML is 28–41% of the raw size. Sanitizing takes 7 ms on the desktop and 26 ms on the phone at 4× CPU.
- **Anchoring:** a TextQuote selector `{exact, prefix, suffix, section}` plus a position hint, over a normalized text model.
  - Footnote markers are skipped; sections are matched by heading text.
  - Tiers: exact in the section, then exact in the article, then fuzzy with `approx-string-match`.
  - A match is flagged `uncertain` when it's outside its section and the context score is under 0.4.
- **Marks:** the CSS Custom Highlight API (Chrome 105, Safari 17.2, Firefox 140).
  - All three mark strengths work with `color-mix` on the pigments.
  - Wrapping text in `<mark>` stalled taps for up to 150 ms on the throttled phone; the Highlight API had no stalls.
- **Selection:** native selection plus a button (H on the laptop), docked at the bottom on touch screens.
  - Tap-a-sentence uses `Intl.Segmenter` plus a merge for abbreviations ("c.", "p.", "Mt.").
- **Cache:** an IndexedDB record `{key, title, revisionId, modified, pageId, fetchedAt, html}`.
  - 25–42 KB gzipped per article.
  - Images use the service worker's `upload.wikimedia.org` cache. Thumbnail URLs are rewritten to upload.wikimedia.org with `crossorigin=anonymous`, so the cache stores real responses rather than opaque ones.

## Anchoring results
5 articles, 200 highlights each per gap, old revision against the latest. About 38% of the highlights cross an inline element.

| Gap | exact | fuzzy | orphaned | wrong place (auto) | wrong place (hand-checked) |
|---|---|---|---|---|---|
| 1 week | 97.6% | 1.4% | 1.0% | 0% | 0 |
| 6 months | 94.2% | 4.4% | 1.4% | 0% | 0 |
| 2 years | 85.7% | 10.2% | 4.1% | 0.2% | 0 of 2 |
| 5 years | 73.1% | 17.4% | 9.5% | 0.4% | 3 of 4 |

- Each anchor takes 0.02–0.13 ms.
- All the wrong matches were 2–3-word fuzzy phrases with a context score under 0.4, so the `uncertain` flag catches them.
- Orphans are almost all real deletions.
- Skipping footnote markers is worth about 10 points of exact matches.
- Taking the first occurrence would put 3–4% in the wrong place.
- diff-match-patch was no better.

## Performance
The article is the Peloponnesian War, served locally.

| | desktop | phone, 4× CPU |
|---|---|---|
| First contentful paint | 108 ms | 276 ms |
| JS heap | 4 MB | 4 MB |
| Scroll with 50 marks | 0% of frames over 20 ms | 0% of frames over 20 ms |
| Tap sentences with `<mark>` wrapping | n/a | p95 50 ms, max 150 ms |

A live fetch takes about 1.4 s cold and 130 ms warm, for 50 KB gzipped.

## Risks for the Phase 1 tickets
- **Not verified on a real device:**
  - iOS long-press and the selection callout
  - dragging the selection handles
  - double-tap vs tap-a-sentence
  - Android's toolbar
  - Firefox
- **Touch clicks in WebKit:** `pointerdown.preventDefault()` on the docked button suppresses the click. Use click, and remember the selection on touch.
- **Screen readers:** they don't see Highlight API marks, so the marks need a parallel description.
- **Math:** it is MathML plus an image from rest_v1. Only one sample was checked.
- **Rate limit:** Wikipedia returned 429s at about 3 requests a second. Fetch serially and cache.
- **Images:** the rewrite to upload.wikimedia.org isn't verified in a running service worker.

## Dependencies
- `approx-string-match` 2.0.1, MIT, 0.9 KB: the one to adopt.
- `dompurify` 3.4.17 and `diff-match-patch` 1.0.5 were used for comparison only.
