---
name: ai-eval
description: Run Chronicle's AI test cases against the live model, compare with the committed baseline, look at the drafts on the map, and propose a prompt change. Use when tuning an AI feature's prompt or model, or before committing any change under src/ai/.
---

# AI eval

AI output varies from run to run, so `check:quiet` (which must stay free, offline and repeatable) can't judge it. This skill does, on demand. The harness is `scripts/eval-ai.mjs`; it needs `ANTHROPIC_API_KEY` in the environment.

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
It runs each case through the feature's own code, including its `validate.ts`, then the built-in checks (every record sourced, provenance kept, the accepted draft imports), then the case's asserts. It writes `tests/ai-evals/<feature>/report.md` and, per case, an import file in `out/` (both gitignored). Add `--save` to update `results.json` and the recordings of cases that scored 100%; it refuses if any case is worse than the baseline. Not built yet: the plausibility grade by a cheap model and a screenshot sheet of each draft on the map. For now, Import → Merge the `out/` file into a dev timeline and look at it there.

## 2. Read
Read `report.md` (scores against the baseline, and failures with their reasons) and the drafts in `out/` only. Open a recording only to understand a specific failure.

## 3. Judge
- **Worse on any case than the baseline:** don't commit. Explain which case and why.
- **Same or better:** rerun with `--save` (updates `results.json` and `recordings/`) and commit them with the prompt. Recordings named `handmade-*` are test data that unit and e2e tests depend on; `--save` never touches them.
- **A validator caught something the prompt should prevent:** fix the prompt, not the validator. Loosen a validator only when Bob agrees the rule was wrong.
- Look at the drafts on the map as a historian would: borders in the right place, routes in the right direction, nothing in a year it shouldn't be.

## 4. Propose
Suggest one prompt change at a time and say which failing case it targets. Bigger changes (a new tool, a new source to fetch first, a different model) are a ticket, not a tuning session.
