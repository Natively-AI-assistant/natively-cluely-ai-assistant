# Baseline of evidence-rich-v1 — how it will be read (written before any row was judged)

Written 2026-10-03 14:00 UTC, while the first run was in progress and before any judgment existed. The only data
seen before this was a 21-row rehearsal on a scratch copy of seven packs (rig check; its numbers are not results).

## What runs

* Build under test: `e000db4a` (fix13, the kept build), app worktree `aq-fix2`, no change.
* Generator: `deepseek-flash` on the direct DeepSeek key, thinking off. The AgentRouter → DeepSeek route asked for
  first cannot run on this build (no AgentRouter provider in it); recorded per row as a fallback.
* Local models as a packaged app has them: bundled embedder and reranker weights copied into the worktree.
* Profile Intelligence extraction: whatever the app does from an empty profile with the key set after start (the
  rig of the earlier series). The mode is recorded per profile load.
* Sets, in this order: dev (270), counterfactual (63), isolation (46), holdout (180). Every mode's base pack stays
  loaded throughout.
* Judge: Claude Opus 5.5 through the Claude Code CLI, charter `er1-ebec3e9a021e`, focused envelope. Provisional.
  gpt-6-astra was closed (402) on both keys at 12:13 UTC; it is the canonical judge and re-judges when it reopens.

## Definitions fixed now

* **Evidence required**: the oracle names at least one document or profile fact (required facts, plus the document
  values a calculation is computed from).
* **Evidence delivered**: every such fact is in the prompt that was sent, by its recorded strings (whitespace and
  the parser's page markers ignored; a fact none of whose strings survived parsing is left out, not counted missing).
* **Hard fail**: a flag that carries a cap (judge or deterministic check). **Critical**: the subset listed in
  `judge/score-er.mjs`.
* A row that was not asked (state unverified) or that got no real answer (timeout, the app's provider-failure line)
  is counted separately and never scored as answer quality.
* Dev, counterfactual and isolation rows may be read. Holdout: aggregates only.

## Targets (from the brief, section 63)

When the required evidence reached the prompt: mean ≥ 9.2, 10th percentile ≥ 8.5, critical hard-fail rate < 1 %.

## How the bottleneck will be named (section 78)

With D = mean score of evidence-delivered rows, N = mean of evidence-required rows where it was not delivered,
s = share of evidence-required rows where it was delivered, M = mean of missing-evidence rows, all on dev +
counterfactual, and the same read again on holdout:

| Verdict | Condition |
|---|---|
| A. Answer engine | D < 9.0, or hard fails on more than 5 % of delivered rows |
| B. Retrieval | D ≥ 9.0, s < 90 %, and N at least 1.5 below D |
| C. Knowledge | D ≥ 9.0, s ≥ 90 %, and the losses sit in missing-evidence rows |
| D. Mixed | anything else; each part is then given with its share of the hard fails |

The hard fails are attributed by the same order the brief gives (ingestion → retrieval → wrong source → precedence →
profile → isolation → generation), from the prompt that was actually sent, by `analyze.mjs`. A retrieval failure is
never to be fixed with prompt wording.

## What may follow

Fixes only for a root cause the baseline shows, each with its keep/revert rule written and committed before its
rows are judged, on a branch from `e000db4a`, never landed on main. If delivered rows already meet the targets and
the remaining loss is evidence that never reaches the prompt or was never supplied, the result is the finding and
no answer-prompt change is made.
