---
name: ai-eval
description: Run Chronicle's AI test cases against the live model, compare with the committed baseline, look at the drafts on the map, and propose a prompt change. Use when tuning an AI feature's prompt or model, or before committing any change under src/ai/.
---

# AI eval

AI output varies from run to run, so `check:quiet` (which must stay free, offline and repeatable) can't judge it. This skill does, on demand. The harness itself arrives with the "AI foundation" ticket in `ROADMAP.md`; until then this page is its spec.

## Layout
```
tests/ai-evals/<feature>/
  cases.yaml        requests plus properties that must hold (Promptfoo format)
  results.json      the committed baseline: score per case, model, prompt version
  recordings/       raw responses from passing runs; unit and e2e tests replay these
```
Prompts live in `src/ai/<feature>/prompt.md` with a version line at the top.

## 1. Run
Costs money and needs a network, so it is never in `check:quiet` and never auto-allowed: confirm with Bob before the first run in a session.
```bash
npm run eval:ai -- <feature>            # all cases, the feature's default model
npm run eval:ai -- <feature> --model claude-haiku-5-5   # try a cheaper model
```
It runs each case, then the feature's `validate.ts`, then the case's property checks, then (if the case asks) a plausibility grade by a cheap model. It writes `tests/ai-evals/<feature>/report.md` and draws each draft on the map into `screenshots/sheet.png`.

## 2. Read
Read `report.md` (scores against the baseline, and failures with their reasons) and the sheet only. Open a recording only to understand a specific failure.

## 3. Judge
- **Worse on any case than the baseline:** don't commit. Explain which case and why.
- **Same or better:** update `results.json`, refresh `recordings/` for changed cases, and commit them with the prompt.
- **A validator caught something the prompt should prevent:** fix the prompt, not the validator. Loosen a validator only when Bob agrees the rule was wrong.
- Look at the sheet as a historian would: borders in the right place, routes in the right direction, nothing in a year it shouldn't be.

## 4. Propose
Suggest one prompt change at a time and say which failing case it targets. Bigger changes (a new tool, a new source to fetch first, a different model) are a ticket, not a tuning session.
