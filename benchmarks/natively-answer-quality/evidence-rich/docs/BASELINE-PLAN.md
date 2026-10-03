# Baseline of evidence-rich-v1 — how it will be read (written before any row was judged)

Written 2026-10-03, committed 13:54 UTC (`e66e92a7`), as the first run was being started and before any judgment existed. The only data
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

---

# Addendum, 2026-10-03, committed 14:45 UTC (`86e31940`) — three checks added after the dev rows were judged

Written after the dev set (270 rows) and the counterfactual and isolation sets had been judged by the provisional
judge, and before any of the three checks below was run or judged. What had been seen: dev overall 7.47; 8.98
(±0.27, n 101) on rows whose needed evidence was in the prompt, 5.69 (±0.45, n 111) on rows where it was not; 36 of
51 hard fails attributed to retrieval or a wrong file. The comparison "delivered vs not delivered" is between
different questions (delivered rows are more often single-source), so it is a correlation. These checks turn it
into a measurement.

## 1. The question held fixed: `supp-oracle-sources`

Every dev case whose oracle names a reference file is asked again with only the files its oracle names loaded in
its mode (223 cases, built by `build-supp.mjs` from the frozen dev set; same question, oracle, profile state and
upload path). Paired by case id with the baseline dev row.

* P = the cases that were evidence-required and NOT delivered in the baseline.
* **Retrieval is the cause** if, on P, the mean under `supp-oracle-sources` is at least 8.5 and the paired gain is
  at least +2.0 with a 95 % interval that excludes 0.
* **The answer engine is the cause** if, on P, the needed facts are in the prompt in at least 90 % of the cases under
  `supp-oracle-sources` and the mean stays under 8.0.
* Anything else is mixed and is reported with both numbers.
* Control: on the cases delivered in both runs the paired difference should be within ±0.4. A larger change means
  the smaller file set changes answers for another reason, and the read on P is then discounted by it.
* Whether the corpus was read whole (≤ 1,400 tokens) or retrieved is recorded per row and reported for both.

## 2. What the claim pass did to the drafts

Among the dev rows that scored low although the evidence was in the prompt, several had a correct streamed draft
that the claim pass replaced with a worse text (a computed figure removed; an outdated file presented as a live
conflict). Measurement only, no change to the pass: every row of dev, counterfactual and isolation whose shown text
differs from the streamed draft gets its DRAFT judged by the same judge, and "shown minus draft" is reported paired,
overall and for conflict / stale cases.

## 3. What counts as a leak

A profile or cross-mode leak is counted only when the other profile's or the other mode's text was in the prompt
that was sent. An answer that states such a fact with none of it in the prompt is an invented claim and is counted
as fabrication. (Observed before this was written: the one `wrong_profile_used` flag in the isolation set,
ER-ISO-015, had none of profile B's text in its prompt; its needle strings "NVDA" / "VoiceOver" are generic terms,
an item defect of v1 that is reported, not edited.)

## Latency

Only the dev run is quoted for latency. The counterfactual, isolation and holdout runs overlapped with judge
processes on the same machine.
