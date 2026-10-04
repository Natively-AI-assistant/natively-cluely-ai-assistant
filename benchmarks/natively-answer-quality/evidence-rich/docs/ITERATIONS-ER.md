# evidence-rich-v1 — changes tried, each with its rule written first

One entry per candidate: root cause, the change, the rule (written and committed before any of its rows existed),
then the data and the verdict. A candidate that fails its rule is not kept, whatever else it shows.

---

## E1 — a pack that fits the prompt is read whole on a turn that reads the files

**Written 2026-10-03, committed 14:57 UTC (`da60373d`). No E1 row existed; the app had not been run on this branch.**

**Root cause it addresses (class B, retrieval / context selection).** Baseline dev, 199 reference-evidence cases:
files uploaded, parsed and indexed in 100 %; the right file in the prompt in 82.6 %; every needed fact in the prompt
in 49.7 %. A turn packs at most 8 evidence items and 1,500–2,400 evidence tokens; the packs are 2,300–9,800 tokens
in 6–9 files. On the 111 evidence-required rows that missed, 104 carried 6 or more items (90 carried 8) and the
retriever had offered more candidates than were packed on 92. Typed turns (hybrid retrieval) and heard turns
(lexical, reranked) missed at the same rate, so the ranking mode is not the difference; the capacity is. Judged
(provisional): 8.98 with the facts in the prompt, 5.69 without.

**The change.** Branch `fix/er-pack-whole` from `e000db4a`, worktree `er-fix1`. Two files:
`mode-retrieval-port.ts`: new `WHOLE_PACK_MAX_TOKENS = 12000`; between the existing small-corpus size (1,400) and
this, the port returns every file whole, as it already does for a small corpus, and skips the retriever.
`orchestrator.ts`: on a turn that retrieves with such a pack, the item cap grows by the number of files and the
evidence-token budget by the pack's size (plus 120 per file for tags), on top of what the turn had, so résumé, JD
and meeting evidence keep their room. Unchanged: a turn the classifier answers from general knowledge reads
nothing from a pack this size; a corpus above 12,000 tokens is retrieved as before; a small corpus keeps its plan.
No prompt wording is changed. Tests: `WholePackReadOnRetrievingTurn2026_10_03.test.mjs` (new),
`SmallReferenceCorpusReadWhole2026_09_30.test.mjs` (one fixture enlarged past the new threshold).

**What it costs, known before measuring.** The prompt grows by the pack (up to about 10,000 tokens on these packs),
so the first word may come later and each turn costs more input tokens; the claim pass's request grows the same
way. Against that, the local embed and rerank round trip is skipped on these turns. All outdated and draft files are
now in the prompt on every such turn, so precedence is exercised on every turn instead of on the turns where
retrieval happened to pick both.

**Rule (dev 270 + counterfactual 63, same provisional judge, same charter, paired by case with the baseline rows;
the app run with no judging in parallel so that latency is comparable to the baseline dev run).** E1 is kept only
if every line holds:

1. Delivery: on evidence-required reference cases every needed fact is in the prompt in at least 90 %.
2. Quality: on evidence-required rows the paired gain is at least +1.0 with a 95 % interval that excludes 0.
3. No harm where no document is needed: on missing-evidence and irrelevant-source rows the paired change is not
   below −0.3.
4. Precedence: on conflict / stale rows the paired change is not below −0.3, and the count of rows flagged
   `stale_source_preferred` or `draft_source_preferred` does not rise.
5. Hard fails in total, and critical flags in total, do not rise.
6. Latency, heard turns of the dev run: first word at the median not more than 300 ms later than the baseline dev
   run, and at the 90th percentile not more than 500 ms later.

If lines 1–5 hold and line 6 does not, E1 is not kept as it is: it goes to Evin as a trade of latency for quality,
with both numbers. If kept, it is confirmed on the holdout (aggregates only): paired gain on evidence-required rows
at least +0.5 with an interval that excludes 0, and hard fails not up; a failure there reverts it.

Nothing is landed on main either way.

### E1 — data, dev + counterfactual (2026-10-03, committed 16:15 UTC; provisional judge, Claude Opus 5.5)

Runs `er-dev-e1`, `er-cf-e1` on `bab77f33` (270 + 63 rows, all answered), paired with `er-dev-base`, `er-cf-base`.

| Rule line | Measured | Holds |
|---|---|---|
| 1. Every needed reference fact in the prompt ≥ 90 % | 127 / 244 → **232 / 244 (95.1 %)** | yes |
| 2. Evidence-required rows: paired gain ≥ +1.0, interval excludes 0 | 7.30 → 8.36, **+1.06 (±0.33)**, n 257 | yes, by 0.06 |
| 3. Missing-evidence + irrelevant-source rows: change not below −0.3 | 7.99 → 7.91, −0.07 (±0.47), n 74 | yes |
| 4. Conflict / stale rows: change not below −0.3; stale / draft flags not up | 6.52 → 8.04, +1.52 (±0.83), n 53; flagged rows 24 → 6 | yes |
| 5. Hard fails and critical flags not up | hard 61 → 38; critical 42 → 21 | yes |
| 6. Heard first word (dev): median not more than +300 ms, p90 not more than +500 ms | median 2,249 → 1,826 ms; p90 3,552 → 2,507 ms | yes (faster) |

All rows: 7.46 → 8.26 (+0.80 ±0.28), n 333.

What else it shows:
* The rows that had missed in the baseline (dev, 111): 5.69 → 7.87 (+2.18 ±0.56). The rows that had been delivered
  in both (101): 8.98 → 8.92 (−0.06 ±0.36).
* By mode on dev: General +2.01, Recruiting +1.34, Call Center +1.20, Technical Interview +0.79, Seminar +0.78,
  Team Meet +0.68, Looking for work +0.65, Sales +0.36 (±1.03), Lecture −0.16 (±0.93; hard fails 0 → 4).
* Cost: input tokens per turn, median 8,216 → 15,127 (p90 17,462). Typed first word 924 → 1,047 ms at the median.
  The heard first word is earlier because the local embed and rerank step is skipped (request sent after 677 →
  324 ms at the median). The E1 runs shared the machine with another session's packaging build, the baseline dev
  run did not, so E1's latency is if anything overstated.
* The claim pass replaced the shown text on 91 dev rows (66 in the baseline).
* Rule line 3 holds on the mean, but hard fails on the rows that need no document rose 10 → 14.
* With the facts in the prompt on 233 of 257 rows, those rows average 8.60 (p10 4.9, 18 hard fails, 10 critical =
  4.3 %). The targets (9.2 / 8.5 / under 1 %) are not met by delivery alone.

**Verdict on dev + counterfactual: every line holds. E1 goes to the holdout confirmation** (aggregates only; rule
written above: evidence-required rows gain at least +0.5 with an interval that excludes 0, hard fails not up).

### E1 — holdout confirmation and verdict (2026-10-03, 16:38 UTC; aggregates only; provisional judge)

Run `er-holdout-e1` on `bab77f33` (180 rows, all answered), paired with `er-holdout-base`.

| Holdout rule | Measured | Holds |
|---|---|---|
| Evidence-required rows: paired gain ≥ +0.5, interval excludes 0 | 7.15 → 8.16, **+1.01 (±0.49)**, n 143 | yes |
| Hard fails not up | 39 → 15 (critical 19 → 8) | yes |

All holdout rows: 7.40 → 8.17 (+0.77 ±0.41). Every needed reference fact in the prompt: 66 / 135 → 132 / 135.
Conflict / stale rows: 6.04 → 7.81 (+1.77 ±1.17); rows flagged stale / draft preferred 8 → 2. Missing-evidence and
irrelevant-source rows: 8.38 → 8.16 (−0.23 ±0.52). Isolation set on the E1 build (46 rows): 7.42 → 8.25, and by code
on all 559 rows of the E1 runs: no file of another mode in any prompt, no profile evidence in a mode that may not
use it, no string of the other profile in any prompt or answer.

**Verdict: E1 is kept**, as commit `bab77f33` on branch `fix/er-pack-whole` (from `e000db4a`). Landed on LOCAL main
on 2026-10-03 at 17:10 UTC on Evin's word ("Land now on local main"): `9fce990b`, a cherry-pick onto `75eb98d6`, not
pushed; tests on that commit 2,858 pass / 0 fail, typecheck clean; main + E1 was not benchmarked. Undo: `git revert
9fce990b`. Known costs: about 7,000 more input tokens per turn at the median on these packs;
typed first word about 120 ms later; more wrong-attribution answers where the asked fact is absent but a
neighbouring one is now in view (hard fails on rows that need no document, dev + counterfactual: 10 → 14). The
judge was the provisional one; the gpt-6-astra chain re-judges these rows when its batch opens.

---

## E3 — a number the material states is not an unsupported claim (a rail on the claim pass's edit)

(E2, handing the résumé and job description over whole, is described in the report as a proposal; it was not built.)

**Written 2026-10-03, committed 16:15 UTC (`1ba9036e`), before the rail's effect was computed on any row.** What had been seen: per-category
means of "shown minus draft" on the 91 dev rows of the E1 run whose shown text the claim pass replaced (drafts
judged by the same judge): all 91 rows −0.66 (±0.45); the 57 with the evidence in the prompt −1.19 (±0.60); edits
that drop a number −1.36 (25 rows) and −3.33 when they also add a deferral (4 rows); edits that keep every number
−0.22 (57 rows). In the baseline run the same split was −1.74 on the 11 delivered rows and +0.54 on the 34 rows
where the evidence was missing. Examples read on dev: a reservation number that is in the loaded trip plan replaced
by "I'll pull up the reservation number"; a go / no-go date that is in the decision log replaced by "I'll confirm
and come back to you".

**Root cause it addresses (class I, claim verifier).** The pass lists a statement as unsupported although the
material states it, and the rewrite then removes the specific and defers. The existing rails reject an edit that
ADDS a number the material lacks; nothing rejects an edit that REMOVES a number the material holds.

**The change.** One more deterministic rail in `acceptVerifiedAnswer` (`electron/llm/claimVerifier.ts`): the edit is
not accepted (the streamed answer stays, with its summary chip) when it removes at least one number of the draft
that occurs in the material and brings no number the draft did not have. `nums()` and `material` are the ones the
existing rails use (the turn's own evidence and conversation). No model call, no latency, no prompt change.

**What it cannot do.** It does not protect a computed result (a total, a date) that is not itself in the material,
nor a name or a non-numeric fact. It keeps a draft that quoted an outdated number which the edit only removed.

**Rule.** Offline first, at no model cost, because the rail is deterministic given the draft, the edit and the
material: for every row whose shown text was replaced, the rail is applied to the recorded draft, shown text and
prompt; a row it rejects takes its DRAFT's judgment, every other row keeps its shown judgment.

On the E1 dev + counterfactual rows the rail is kept only if:
1. it flips at least 15 rows and on those rows the paired gain (draft − shown) is at least +1.0 with a 95 %
   interval that excludes 0;
2. hard fails on the flipped rows do not rise;
3. on flipped rows that need no document (missing-evidence, irrelevant-source) the mean change is not below −0.3
   (the rail must not bring an invention back).

If kept, the same computation on the E1 holdout rows (aggregates only; their drafts judged first): flipped rows
gain at least +0.5 with an interval that excludes 0, hard fails not up. Then it is implemented with unit tests
and one app run confirms that the implementation rejects the same rows the offline computation rejected. A
failure at any step: not kept.

### E3 — data and verdict (2026-10-03, committed 16:18 UTC; offline, provisional judge)

`node evidence-rich/rail-offline.mjs --runs evidence-rich/results/er-dev-e1,evidence-rich/results/er-cf-e1`.
333 rows; the shown text was replaced on 113 (all 113 drafts judged); the rail would reject the edit on 45.

| Rule line | Measured | Holds |
|---|---|---|
| 1. At least 15 flipped rows, gain ≥ +1.0, interval excludes 0 | 45 rows, 7.08 → 8.33, +1.25 (±0.57); 22 better by more than 0.5, 4 worse | yes |
| 2. Hard fails on flipped rows not up | 6 → 6 | yes |
| 3. Flipped rows that need no document: change not below −0.3 | 4 rows, −0.54 | **no** |

All rows with the rail: 8.26 → 8.43 (+0.17 ±0.09). On the 39 flipped rows with the evidence in the prompt: +1.46.

**Verdict: not kept.** Line 3 fails, on four rows. On those rows the draft itself said things like "Nothing in what
I've got says…" and the edit had improved it; the rail put the worse draft back because the edit had also removed a
number. The direction is supported (the pass removes specifics the material states, and that costs about 1.2 on a
sixth of the rows), the rail as specified is not the fix. Nothing was implemented.

---

## E4 — with the files in the prompt, the claim pass does not run (measured offline; a recommendation, not a build)

**Written 2026-10-03, committed 16:18 UTC (`cb41785f`), before any holdout row of the E1 build was judged.**

**What was measured first (dev + counterfactual, drafts judged for every replaced row, so "pass off" is exact: the
pass's kill switch shows the draft).**

| Build | Claim pass | Mean | Hard fails | Critical |
|---|---|---:|---:|---:|
| baseline `e000db4a` | on every turn (as built) | 7.46 | 61 | 42 |
| baseline | off | 7.46 (±0.09 against as built) | 79 | 56 |
| E1 `bab77f33` | on every turn (as built) | 8.26 | 38 | 21 |
| E1 | off | 8.50 (+0.23 ±0.14) | 40 | 22 |
| E1 | only on turns with no reference-file evidence in the prompt | 8.50 (+0.24 ±0.14) | 38 | 20 |

On the baseline build the pass does what it was kept for: it does not move the mean and it removes 18 hard fails,
almost all on turns where the needed evidence had not reached the prompt and the draft had invented or half-quoted.
On the E1 build, where the evidence is in the prompt, the pass has little left to remove (40 → 38) and its edits cost
0.38 (±0.18) on the 233 rows with the evidence delivered: it lists as unsupported what the files state, and the
rewrite defers ("I'll confirm and come back to you") or, twice on dev, replaces the current value with the outdated
file's.

**The gate.** The claim pass is skipped on a turn whose prompt holds reference-file evidence, and runs as today on
every other turn (no file loaded, or profile / conversation only). It is only meaningful together with E1: on the
baseline build the same gate gives back 15 of the 18 hard fails the pass removes (61 → 76).

**Rule (offline composition on the E1 holdout rows, aggregates only; their drafts are judged first).** The gate is
recommended only if, against the E1 build as built: the mean rises by at least +0.15 with a 95 % interval that
excludes 0, hard fails do not rise, critical flags do not rise. It changes a component Evin decided to keep, so
whatever the result it is his decision; it is not implemented or run in the app in this session unless the rule
holds, and never landed.

### E4 — data and verdict (2026-10-03, 16:38 UTC; offline composition on the E1 holdout rows, aggregates only)

180 rows; shown text replaced on 57 (all 57 drafts judged); 161 rows have reference-file evidence in the prompt.

| | Mean | against as built | Hard fails | Critical |
|---|---:|---:|---:|---:|
| E1 as built (pass on every turn) | 8.17 | | 15 | 8 |
| pass off | 8.54 | +0.37 (±0.24) | 21 | 9 |
| the gate (pass only where no reference file is in the prompt) | 8.56 | **+0.39 (±0.23)** | **19** | 8 |

| Rule line | Holds |
|---|---|
| Mean rises by at least +0.15, interval excludes 0 | yes (+0.39 ±0.23) |
| Hard fails do not rise | **no** (15 → 19) |
| Critical flags do not rise | yes (8 → 8) |

**Verdict: not recommended as specified.** On the holdout the gate raises the mean and also lets four more hard
fails through; on dev + counterfactual it had raised the mean by +0.24 with hard fails unchanged. It was not
implemented. What stands as a measurement, on both sets: once the files are in the prompt, the claim pass lowers
the average answer (dev + counterfactual −0.23 ±0.14, holdout −0.37 ±0.24) while still removing a few capped
failures (dev + counterfactual 40 → 38, holdout 21 → 15). That is a trade for Evin to decide, with a better design
of the pass (one that does not delete what the files state) as the alternative to switching it off.

---

## E5 — the claim pass is shown the whole prompt (heard and typed)

**Rule written before any replay arm was run or judged (commit time of this section is the record).**

**What was found (judge-free, from the recorded requests; `report/claim-pass-cut.mjs`).** The claim pass never sees
more than the first 24,000 characters of the answer's prompt, on either surface: the typed pass cuts the material in
`claimVerifierStandaloneMessage`, and the heard pass inherits the answer's prompt through `LLMHelper.replayAnswerCall`,
which trims it at `REPLAYED_ANSWER_PROMPT_MAX_CHARS = 24000`. The earlier report named only the typed surface; that
was incomplete. On the kept build the prompt exceeded 24,000 characters on 1 of 252 passes. With E1 it does on 302 of
384 (median prompt 35,171 characters, max 48,716), so the pass judged most answers against a pack it could not see.

| E1 runs, replaced rows (drafts judged) | n | shown − draft |
|---|---:|---:|
| the pass saw the whole prompt | 36 | +0.20 (±0.66) |
| the pass saw a cut prompt | 130 | −1.09 (±0.40) |
| edit dropped a number the prompt states, and the pass had not been shown that number | 39 | −2.25 (±0.87) |
| edit dropped a number the pass had been shown | 40 | −1.47 (±0.61) |

**Change.** A cap of its own for the claim pass, 96,000 characters, on both surfaces. The other repairs that inherit
the answer's prompt (regeneration, document-grounded repair) keep 24,000. No prompt wording changes.

**How it is measured.** Offline first, with `replay-claim-pass.mjs`: the pass is re-run on the drafts the E1 dev and
counterfactual runs recorded, with the app's own function, system prompt (hash-checked), model, parameters, budget
and rails. Two arms through the same harness, cut at 24,000 and at 96,000; a replay is never compared with what the
app itself produced. Each arm's shown texts are judged where they are new (a text equal to the draft or to an
already judged text reuses that judgment). Then one run in the app for confirmation.

**Rule, offline (dev + counterfactual, 333 rows; "effect of the pass" = shown − draft, rows it did not change count 0).**

1. Effect of the pass on the set's mean, 96,000 arm minus 24,000 arm: at least +0.10 with a 95 % interval that
   excludes 0.
2. Hard fails of the 96,000 arm not above the 24,000 arm's.
3. Rows that need no document (missing evidence, irrelevant source): 96,000 arm not more than 0.15 below the 24,000 arm.
4. The pass finishes inside its 3,500 ms budget at least as often as in the 24,000 arm, less 3 points at most (a
   pass that times out keeps the draft, which would read as a gain without being one).

**Rule, in the app (dev + counterfactual on the candidate branch; its drafts judged), read against the E1 runs.**

5. Effect of the pass on the set's mean is not below −0.10 (E1 as built: −0.23 ±0.14).
6. All rows, paired with E1: not below −0.15.
7. Time from the last streamed token to the settled text, median, not more than 300 ms above E1's dev run.

**Holdout (aggregates only):** line 5, and hard fails not above E1's 15 by more than 2. A failure at any step: not kept.

### E5 — offline data and verdict (2026-10-03, provisional judge; `replay-claim-pass.mjs`, `replay-judge.mjs effect`)

Both arms through the same harness on the 251 dev + counterfactual turns of the E1 runs that ran the pass (k 2 for
the outcome mix, k 0 judged). The rebuilt request equals the recorded one on 502 of 502 replays of the 24,000 arm
and the rebuilt system prompt matches the recorded hash on every row, so the harness sends what the app sent.

| | 24,000 arm | 96,000 arm |
|---|---:|---:|
| Mean, 333 rows | 8.29 | 8.50 |
| Effect of the pass (shown − draft) | −0.21 (±0.13) | +0.01 (±0.09) |
| Hard fails (drafts: 40) | 33 | 32 |
| Critical | 19 | 17 |
| Passes that changed the text | 116 of 251 | 62 of 251 |
| Finished inside the budget | 100 % | 100 % |
| Pass time, median / p90 | 1,118 / 1,469 ms | 1,199 / 1,743 ms |

| Rule line (offline) | Measured | Holds |
|---|---|---|
| 1. 96,000 − 24,000 on the set's mean ≥ +0.10, interval excludes 0 | +0.21 (±0.14) | yes |
| 2. Hard fails not above the 24,000 arm's | 33 → 32 | yes |
| 3. Rows that need no document: not more than 0.15 lower | +0.16 (±0.22) | yes |
| 4. Finishes inside the budget as often (−3 points at most) | 100 % and 100 % | yes |

The 24,000 arm reproduces what the app did (−0.21 here, −0.23 in the app). Shown the whole prompt, the pass costs
nothing on the mean and still removes 8 of the drafts' 40 hard fails. **Offline: E5 passes; it goes to the app.**

What is left in the 96,000 arm (`report/replay-edits.mjs e5-whole96 …`, 62 edits): the 9 edits where the pass named
a CONFLICT cost 2.22 (±1.17) each, 8 of the 9 made the answer worse; the 53 edits where it named none gain 0.42
(±0.43) and take hard fails from 14 to 5. In those 9 the two "conflicting" sources were a current document and an
older or informal one ("Version 4.1, effective 1 March 2026 vs Version 3.2, effective 1 February 2025"), and the
correct answer from the current one was rewritten to "it is given two ways, that needs confirming".

---

## E6 — the claim pass: a current document against an older one is not a conflict

**Rule written before any E6 arm was run (commit time of this section is the record).** This is the redesign Evin
asked for ("cannot remove a fact the loaded files state"): with the cut lifted (E5), the facts the pass still
removes from grounded answers are removed by its CONFLICT step.

**Change (wording of the pass's own prompt only; replayed offline with the 96,000 cap).**
* v1: the CONFLICT line fires only for two sources of equal standing. A current, final, signed or later-dated
  version against an older, superseded or expired one, a draft or proposal, or an informal note or message is not a
  conflict: the one that holds is what the material states.
* v2: v1, and a value the draft took from the older / draft / informal source while the material holds a current
  one is listed as unsupported and replaced by the current value.
Each is one replay arm on the dev + counterfactual drafts of the E1 runs, read against the 96,000 arm of E5.

**Rule (dev + counterfactual, paired with the E5 96,000 arm; oracle's `known_conflicts.resolution` splits the rows).**

1. All rows: arm − E5 arm above 0 with a 95 % interval that excludes 0.
2. Hard fails and critical flags not above the E5 arm's.
3. Rows whose oracle holds an `unresolved` conflict (the sources really disagree and the answer must say so): not
   more than 0.3 below the E5 arm, and no new hard fail on them.
4. Rows whose oracle resolves the conflict (current / final / authoritative wins): not below the E5 arm.
5. Rows that need no document: not more than 0.15 below the E5 arm.
If both pass, the one with the higher all-rows mean is taken; within 0.03 of each other, v1 (the smaller change).

**Holdout (aggregates only):** E5 and E6 are confirmed together by one run of the candidate build in the app:
effect of the pass on the set's mean not below −0.10, hard fails not above E1's 15 by more than 2. If that fails,
the two are separated by offline replays of the holdout drafts.

### E6 — offline data and verdict (2026-10-03, provisional judge)

Arms `e6-v1`, `e6-v2` (variants in `replay-variants/`), 96,000 cap, same 251 turns, read against the E5 96,000 arm.
Replays that hit the 3.5 s budget in the first pass (5 in v1, 25 in v2, during a slow spell of the provider) were
run again once at the comparison arm's concurrency; v1 then finished every pass, v2 still lost 9 (7 over budget, 2
errors), which count as the draft kept, as they would in the app.

| | E5 arm | v1 | v2 |
|---|---:|---:|---:|
| Mean, 333 rows | 8.50 | 8.56 | 8.51 |
| Effect of the pass | +0.01 (±0.09) | +0.06 (±0.09) | +0.02 (±0.08) |
| Hard fails / critical (drafts: 40) | 32 / 17 | 27 / 14 | 31 / 17 |
| Passes naming a conflict | 13 | 5 | 3 |
| Pass time, median / p90 | 1,199 / 1,743 ms | 1,239 / 1,814 ms | 1,342 / 2,054 ms |

| Rule line | v1 | v2 |
|---|---|---|
| 1. All rows above the E5 arm, interval excludes 0 | +0.06 (±0.08): **no** | +0.01 (±0.09): **no** |
| 2. Hard fails and critical not above | 32 → 27, 17 → 14: yes | 32 → 31, 17 → 17: yes |
| 3. Unresolved conflicts (9 rows): not more than 0.3 lower, no new hard fail | +0.71, 2 → 0: yes | 0.00, 2 → 2: yes |
| 4. Resolved conflicts (66 rows): not lower | +0.22 (±0.28): yes | +0.28 (±0.24): yes |
| 5. Rows that need no document: not more than 0.15 lower | −0.03: yes | −0.15: yes (at the line) |

**Verdict: neither is kept.** Line 1 fails for both: the gain on the mean is not distinguishable from zero on 333
rows. v1 fails nothing else and takes five hard fails out (three of them critical); whether that is worth a wording
change to a component Evin decided to keep is his call. It was not built into the app. v2 is not worth pursuing.

---

## E7 — a reference file's own date and version in the prompt (Evin: "App labels dates in the prompt")

**Rule written before the candidate build was run in the app (commit time of this section is the record).**

**Change (`fix/er-followups`, commit `9b8c99fa`).** The kept build already renders `status="…"` on evidence when a
file declares itself retired, expired, a draft or outdated. A file's own date and version are now read too (the
date next to a word that says so in the head, or from the file name; the version from the file name, else the title
block) and rendered as `dated="…"` / `version="…"`; the precedence notice says that between two final documents the
later one holds, and that a draft or an informal note never overrides a final document.

*Contamination, stated plainly.* The detector was written against invented documents (its tests), then run once
over the benchmark's 72 reference files to see what it yields: 28 dated, every date equal to the one the corpus
authors recorded. That look showed versions read from a mention of another document, and one date read from an
identifier in a file name; both were corrected by general rules (file name first for the version, title block only,
no bare year from a file name), with tests on invented documents. Holdout questions run over these same files, so
the labels were tuned with sight of the holdout's documents, though of none of its questions or answers.

**What runs.** One run of the stack in the app, `fix/er-followups` = E1 + the markup fix + E5 + E7 (E6 is not in
it), on dev + counterfactual, then holdout. Read against the E1 runs. "Draft" = the streamed answer before the
claim pass (the shown answer where the pass changed nothing), judged on both builds.

**Rule for E7 (the generator's drafts, dev + counterfactual).**
1. Conflict / stale rows (53): hard fails of the drafts below E1's drafts (8), and the drafts' mean not more than
   0.2 lower.
2. All rows: drafts paired with E1's drafts not below −0.15.
3. Rows that need no document: drafts not below −0.25.

**Rule for the stack (E5 in the app; lines 5–7 of E5's rule).** Effect of the pass on the set's mean not below
−0.10; all rows (shown) paired with E1 not below −0.15; last streamed token to settled text, median, not more than
300 ms above E1's dev run.

**Holdout (aggregates only).** E7: conflict / stale drafts' hard fails not above E1's drafts', all-rows drafts not
below −0.15. Stack: effect of the pass not below −0.10, hard fails (shown) not above E1's 15 by more than 2.
A failure of E7's lines drops E7 from the stack (it is its own commit); a failure of the stack's lines drops E5.

### E7 — data and verdict (2026-10-03 18:30 UTC; run `s2` = E1 + markup fix + E5 + E7; provisional judge)

`report/stack-vs.mjs e1 s2 dev cf`. 271 of 333 prompts carried a date or version label; none had before.

| Drafts (what the generator wrote), paired with E1's drafts | n | E1 | s2 | change | hard fails |
|---|---:|---:|---:|---:|---:|
| All rows | 333 | 8.50 | 8.41 | −0.09 (±0.16) | 40 → 44 |
| Conflict / stale | 53 | 8.23 | 7.67 | −0.55 (±0.46) | 8 → 10 |
| Need no document | 74 | 7.81 | 7.67 | −0.15 (±0.34) | 17 → 19 |
| Single source | 134 | 8.92 | 8.98 | +0.06 (±0.21) | 9 → 8 |

| Rule line (E7) | Measured | Holds |
|---|---|---|
| 1. Conflict / stale drafts: hard fails below E1's 8, mean not more than 0.2 lower | 10; −0.55 | **no** |
| 2. All rows, drafts: not below −0.15 | −0.09 | yes |
| 3. Rows that need no document, drafts: not below −0.25 | −0.15 | yes |

**Verdict: not kept; E7 is dropped from the stack** (commit `9b8c99fa` reverted on `fix/er-followups`). The labels
were delivered and the conflict cases got worse, not better. Read on the dev cases: where the two sources really
disagree and the later word is an undated informal note (the lecturer's notes against the dated syllabus), the new
notice's "give it plainly" made the draft state the dated document's value and drop the flag (two Lecture cases,
9.0 → 4.9 and 7.5 → 4.5); the other large drops were not about dates at all. A date on a tag does not tell the
model which document governs, and telling it "the later one holds" is wrong exactly where the benchmark's hard
cases are. What Evin was offered as the alternative (a per-file "outdated" switch the user sets) is untested.

The holdout run of `s2` was started before this verdict to save time and stopped at 32 rows when the verdict was
known; none of its rows was judged or read.

Because `s2` contained E7, its numbers do not settle E5's lines in the app (effect of the pass −0.09 ±0.11, all
rows +0.06 ±0.22, last token to settled 1,074 ms against 1,172). E5 is run again without E7 as `s3`
(= E1 + markup fix + E5) and read by the same lines 5–7 and the same holdout rule.

### E5 — in the app, dev + counterfactual (2026-10-03 19:15 UTC; run `s3` = E1 + markup fix + E5; provisional judge)

`report/stack-vs.mjs e1 s3 dev cf`. Branch `fix/er-followups` at `742a7170` (the labels reverted). The dev run was
killed from outside at 130 rows while the machine's load average was above 20 (another session's build) and
resumed; 333 rows answered, none unverified.

| | E1 | s3 | change |
|---|---:|---:|---:|
| Drafts, all rows (same generator: a check on run-to-run noise) | 8.50 | 8.52 | +0.03 (±0.15) |
| Shown, all rows | 8.26 | 8.52 | +0.25 (±0.19) |
| Shown, evidence required | 8.36 | 8.68 | +0.32 (±0.22) |
| Hard fails / critical (shown) | 38 / 21 | 31 / 18 | |
| Effect of the claim pass (shown − draft) | −0.23 (±0.14) | −0.01 (±0.10) | |
| Hard fails, drafts → shown | 40 → 38 | 39 → 31 | |
| Answers the pass replaced | 113 | 71 | |
| Last streamed token → settled text, median (dev) | 1,172 ms | 1,068 ms | |

| Rule line (in the app) | Measured | Holds |
|---|---|---|
| 5. Effect of the pass on the set's mean not below −0.10 | −0.01 (±0.10) | yes |
| 6. All rows, paired with E1: not below −0.15 | +0.25 (±0.19) | yes |
| 7. Last token → settled, median, not more than 300 ms above E1's | 104 ms lower | yes |

The offline replay had predicted +0.01 for the pass's effect; the app measured −0.01. **Dev + counterfactual: E5
passes. It goes to the holdout.**

### E5 — holdout confirmation and verdict (2026-10-03 19:50 UTC; aggregates only; provisional judge)

Run `er-holdout-s3` on `742a7170` (180 rows, all answered, none unverified), judged blind, read against
`er-holdout-e1` with `report/stack-vs.mjs e1 s3 holdout --blind`.

| | E1 | s3 |
|---|---:|---:|
| Shown, all rows | 8.17 | 8.71 (+0.54 ±0.28) |
| Drafts, all rows (same generator: run-to-run noise) | 8.54 | 8.70 (+0.16 ±0.20) |
| Effect of the claim pass (shown − draft) | −0.37 (±0.24) | 0.00 (±0.12) |
| Hard fails / critical (shown) | 15 / 8 | 15 / 5 |
| Hard fails, drafts → shown | 21 → 15 | 16 → 15 |
| Answers the pass replaced | 57 | 32 |
| Conflict / stale rows (shown) | 7.81 | 8.86 |
| Last streamed token → settled text, median | 1,156 ms | 986 ms |

| Holdout rule | Measured | Holds |
|---|---|---|
| Effect of the pass on the set's mean not below −0.10 | 0.00 (±0.12) | yes |
| Hard fails (shown) not above E1's 15 by more than 2 | 15 | yes |

About 0.16 of the +0.54 is the two runs' drafts differing; the pass's own share is the −0.37 → 0.00.
Against the kept build `e000db4a` on the same blind set: 7.40 → 8.71 (+1.30 ±0.39), hard fails 39 → 15, critical
19 → 5.

**Verdict: E5 is kept**, as commit `441ed80a` on `fix/er-followups` (with the markup fix `d503ae4f`; the branch
head `742a7170` has the labels reverted). Tests on the head: `test:intelligence` 2,806 pass / 0 fail, the llm suite
5,472 pass / 0 fail, `typecheck:electron` clean. **Not on main.** On main `d503ae4f` cherry-picks cleanly;
`441ed80a` conflicts in `LLMHelper.replayAnswerCall` (main carries a later change to the same lines); resolved and
tested on branch `fix/er-followups-on-main` (`be676d88` on main `6f00e104`: typecheck clean, `test:intelligence`
2,858 pass / 0 fail, llm suite 5,768 pass / 0 fail), not benchmarked there, not landed. The judge was the provisional one; the gpt-6-astra chain is armed to re-judge these runs.

---

## Evin's second set of answers (2026-10-03 19:55 UTC), and the rule for "after Astra confirms"

1. The two fixes (E5 `441ed80a`, markup `d503ae4f`; on main as `fix/er-followups-on-main`): **land after gpt-6-astra
   confirms.** 2. E6: leave it out. 3. Outdated files: nothing in the product now. 4. E2 (résumé and JD handed over
   whole): build and measure.

**What "Astra confirms" means, written before gpt-6-astra has judged anything in this benchmark.** Read with
`ER_JUDGE=astra` from the chain's files, holdout only, the same lines E5 was kept by:
* `report/stack-vs.mjs e1 s3 holdout --blind`: effect of the claim pass in `s3` not below −0.10, and hard fails
  (shown) of `s3` not above E1's by more than 2;
* and E1 itself still stands: `report/paired-builds.mjs base e1 holdout`: evidence-required rows gain at least +0.5
  with an interval that excludes 0, hard fails not up.
Both hold → land `fix/er-followups-on-main` on local main (re-applied and re-tested if main has moved), not pushed.
E5's lines fail → the fixes stay on their branch. E1's lines fail → tell Evin before anything else (`git revert
9fce990b` is the way back). The chain judges these three holdout runs and their drafts first; if its batch closes
before they are complete, nothing is decided and it continues from the cache on the next batch.

---

## E2 — the résumé and the job description are handed over whole (Evin: "Build and measure")

**Rule written before any E2 code existed and before any E2 row (commit time of this section is the record).**

**Why.** In the two profile modes a turn gets at most six profile passages out of about seventy. On the control
(`s3` = E1 + markup fix + E5), of the 20 dev + counterfactual rows whose oracle rests on a résumé or JD fact, every
needed fact was in the prompt on 8; on the holdout 5 of 13. With the fact in the prompt those rows score 9.5,
without it 6.6 (section 15 of the quality report). The two documents together are about 2,700 tokens.

**Change (branch `fix/er-profile-whole`, from `742a7170`).** When every registered résumé / JD has its raw text
and together they are at most 6,000 tokens, a turn that reads the profile gets each planned document as ONE item
holding its whole text, in place of that document's raw-text passages and the semantic arm; the plan's item cap
grows by the number of documents and its token budget by their size, on top of E1's room for the pack. Unchanged:
structured sections, cards, the complete-inventory sections that license "X is not listed" answers, derived facts,
the planned-type gate (a turn that plans only the résumé still gets no JD), modes that do not hydrate the profile,
and a profile above 6,000 tokens. 6,000 keeps a full pack plus the profile under the claim pass's 96,000 characters.

**Control.** The `s3` runs, including an isolation run made for this purpose on `742a7170` before any edit
(`er-iso-s3`). **Candidate:** run tag `s4`; dev and counterfactual restricted to Looking for work and Technical
Interview (74 rows; no other mode builds a profile port), the isolation set whole (46 rows), then the holdout's
40 rows of those two modes.

**Rule, judge-free (dev + counterfactual; `report/profile-rows.mjs s3 s4 dev cf`).**
1. Rows that need a profile fact: every needed fact in the prompt on at least 17 of 20 (control: 8).
2. No claim-pass request cut (control: 0).
3. Isolation set, by code: no string of the other profile in any prompt or answer, no profile evidence in a mode
   that may not use it, no profile text in a prompt after the user deleted it.

**Rule, judged (provisional judge), paired with `s3`.**
4. Rows that need a profile fact: gain at least +1.0 with a 95 % interval that excludes 0.
5. All Looking-for-work and Technical-Interview rows: not below −0.15; hard fails not up.
6. Rows of those modes that need no profile fact (missing personal evidence included): not below −0.3; hard fails
   not up.
7. Isolation set against `er-iso-s3`: not below −0.3; hard fails not up.
8. Heard first word in the two modes, median: not more than 150 ms above the control's.

**Holdout (aggregates only, 40 rows):** rows that need a profile fact gain more than +0.5; all rows not below
−0.15; hard fails not up. A failure at any step: not kept. Nothing lands without Evin; E2 is its own decision,
outside the "after Astra" gate.

### E2 — data and verdict (2026-10-03 20:40 UTC; run `s4` = `s3` + E2, commit `fea39964`; provisional judge)

`report/profile-rows.mjs s3 s4 dev cf`, `report/profile-drafts.mjs s3 s4 dev cf`, `report/paired-builds.mjs s3 s4 iso`.
74 rows of the two profile modes (dev 60, counterfactual 14) and the isolation set (46), all answered.

| Rule line | Measured | Holds |
|---|---|---|
| 1. Every needed profile fact in the prompt on at least 17 of 20 rows | 8 → 19 of 20 | yes |
| 2. No claim-pass request cut | 0 of 48 | yes |
| 3. Isolation by code | 0 strings of the other profile in any prompt or answer; 0 profile evidence in the 8 forbidden-mode rows; 0 after deletion (2 rows); whole documents only in the profile modes with a profile loaded | yes |
| 4. Rows that need a profile fact: gain ≥ +1.0, interval excludes 0 | 7.63 → 8.27, **+0.63 (±1.13)** | **no** |
| 5. All rows of the two modes: not below −0.15; hard fails not up | +0.20 (±0.41); 9 → 6 | yes |
| 6. Rows that need no profile fact: not below −0.3; hard fails not up | +0.04; 5 → 4 | yes |
| 7. Isolation set against the control: not below −0.3; hard fails not up | +0.23 (±0.41); 6 → 5 | yes |
| 8. Heard first word, median, not more than 150 ms above the control | 1,477 → 928 ms (request sent after 28 ms instead of 532) | yes |

**Verdict: not kept by its rule.** Line 4 fails: on 20 rows the gain in the shown answers is +0.63 and its interval
includes 0. The holdout was not run. The branch `fix/er-profile-whole` (`fea39964`) stays as it is, not landed.

What the measurement shows besides the verdict, for Evin's decision:

| The two profile modes, dev + counterfactual | Control `s3` | `s4` |
|---|---:|---:|
| Drafts (what the generator wrote), all 74 rows | 8.21 | 8.73 (+0.53 ±0.33), hard fails 13 → 8 |
| Drafts, the 20 rows that need a profile fact | 7.64 | 8.59 (+0.94 ±0.92) |
| Effect of the claim pass (shown − draft), all rows | +0.10 (±0.20) | −0.22 (±0.30) |
| Shown, all 74 rows | 8.31 | 8.51, hard fails 9 → 6, critical 3 → 1 |
| Technical Interview (shown) | 8.71 | 9.03 (+0.33 ±0.26) |

The change delivered what it was built to deliver (the facts, and a first word about half a second sooner, because
the profile's search and rerank step is skipped), and the generator's answers improved. About a third of a point
was then taken back by the claim pass: in this run it rewrote two correct answers about the candidate's own stated
preferences ("I'm staying in Porto, so remote within Europe is what I'm working with" → "I'll confirm where I stand
on Rotterdam and remote and come back to you"; 9.3 → 3.4 and 9.9 → 6.2), which it had left alone in the control
run. Whether that is this change's doing (more material in view of the pass) or the pass's run-to-run variation is
not established: 19 answers were replaced here against 20 in the control.

### E2 — a second rule, for the blind holdout (Evin, 2026-10-03 20:50 UTC: "Run the blind holdout")

E2 failed line 4 of its first rule and by that rule the holdout was not to be run. Evin chose to run it anyway. This
rule replaces nothing: the first verdict stands as recorded. It is written before any holdout row of E2 exists, on
what the change itself controls (delivery and the generator's drafts), with the shown answers as a guard.

Run `er-holdout-s4`: the holdout's 40 rows of Looking for work and Technical Interview, branch
`fix/er-profile-whole` (`fea39964`). Control: the same 40 rows of `er-holdout-s3`. Aggregates only, judged blind.

1. Rows that need a profile fact (13): every needed fact in the prompt on at least 11 (control: 5).
2. No claim-pass request cut; no string of the other profile in any prompt or answer.
3. Drafts, all 40 rows, paired with the control's drafts: not below −0.15; the profile-fact rows' drafts not lower.
4. Shown answers, all 40 rows, paired: not below −0.15; hard fails not up.
5. Heard first word, median: not more than 150 ms above the control's.

All five hold → E2 is confirmed on the holdout for what it controls, and stays on its branch for Evin's decision.
Any line fails → E2 is not kept, finally.

### E2 — holdout data and verdict under the second rule (2026-10-03 21:35 UTC; aggregates only; provisional judge)

Run `er-holdout-s4` (40 rows, all answered), judged blind with its drafts; `report/profile-rows.mjs s3 s4 holdout
--blind`, `report/profile-drafts.mjs s3 s4 holdout`.

| Rule line | Measured | Holds |
|---|---|---|
| 1. Every needed profile fact in the prompt on at least 11 of 13 rows | 5 → 11 | yes |
| 2. No claim-pass request cut; no string of the other profile | 0 of 23; 0 | yes |
| 3. Drafts, all rows not below −0.15; profile-fact rows' drafts not lower | +0.21 (±0.60); +0.98 (±1.25), hard fails 2 → 0 | yes |
| 4. Shown, all rows not below −0.15; hard fails not up | +0.09 (±0.58); 5 → 5 | yes |
| 5. Heard first word, median, not more than 150 ms above the control | 1,354 → 1,184 ms | yes |

**Verdict under the second rule: confirmed on the holdout for what it controls.** The first rule's verdict (not
kept: line 4, dev + counterfactual) stands as recorded; both are reported. E2 stays on `fix/er-profile-whole`
(`fea39964`), not landed, for Evin's decision.

Outside the rule's lines, and against it: on the holdout the 27 rows that need no profile fact went 8.65 → 8.34
(−0.31 ±0.60) with hard fails 3 → 5, and the 4 missing-evidence rows 7.34 → 5.79 (hard fails 1 → 3). On dev +
counterfactual the same slices had moved +0.04 and +0.37. The holdout's direction is the one E1 showed for packs:
with the whole document in view, an answer to a question the document does not cover more often attaches something
nearby. On 4 and 27 rows this is not established either way.

### gpt-6-astra, first batch (2026-10-04 02:00–03:04 UTC): incomplete, nothing decided

The chain ran while E2's holdout was being judged. Calibration 38 of 38 on the new charter; the 45-row agreement
sample; the baseline holdout (180); then 106 of 180 rows of E1's holdout before the batch closed (402). It did not
reach E1's drafts or the `s3` holdout, so by the rule above nothing is decided and nothing was landed. The chain
is re-armed for the next batch (not before 10:00 UTC) and continues from its cache.

What the canonical judge has said so far (`ER_JUDGE=astra node evidence-rich/report/paired-builds.mjs base e1 holdout`,
the 106 pairs it finished; a partial set in the order the rows were processed, not a sample):

| Baseline → E1, holdout | gpt-6-astra, 106 pairs | Opus, 180 pairs |
|---|---:|---:|
| All rows | 7.64 → 8.77 (+1.13 ±0.51) | 7.40 → 8.17 (+0.77 ±0.41) |
| Evidence required | +1.20 (±0.60) | +1.01 (±0.49) |
| Hard fails | 23 → 6 | 39 → 15 |

Agreement between the two judges on the same answers: correlation 0.84 (45 dev rows), 0.91 (baseline holdout,
180), 0.96 (E1 holdout, 106); gpt-6-astra scores 0.2 to 0.5 higher on average; 73–81 % of rows within one point;
hard fails 42 against 39 on the baseline holdout, 34 of them the same rows.

### Evin, 2026-10-04 03:15 UTC: "continue on cc opus 5.5 for now, after astra comeback rereview things"

gpt-6-astra was still closed (402 on both keys at 03:10 UTC). Evin lifted the "after Astra confirms" condition: the
provisional judge's results decide for now, and gpt-6-astra re-reviews them when it returns.

**Landed on LOCAL main: `be676d88`** (the markup fix `be5b9edd` and E5, fast-forward from `6f00e104`; not pushed).
Tests on that commit: `typecheck:electron` clean, `test:intelligence` 2,858 pass / 0 fail, llm suite 5,768 pass /
0 fail. Main + these commits was not benchmarked (E5 was measured on the `e000db4a` base). Other sessions'
uncommitted files in the main checkout were untouched (status identical before and after).

**Re-review when gpt-6-astra returns** (the chain probes every 10 minutes): the same two holdout readings as in the
rule above, with `ER_JUDGE=astra`. Agreement is reported; a disagreement is reported with the commit that would be
reverted (E1 `9fce990b`, E5 `be676d88`), and nothing is reverted without Evin's word.
E2 (`fix/er-profile-whole`, `fea39964`) is not landed; that decision is still open.

### E2 landed on LOCAL main (Evin, 2026-10-04: "Land it now")

`73a2f89f` (a clean cherry-pick of `fea39964`; fast-forward; not pushed). The first attempt, as `3540ed27` on
`be676d88`, did not land: another session committed to main (`ac97c043`, renderer CSS only) between the check and
the merge, and my note of that moment said it had landed when it had not. It was re-applied on `ac97c043`,
re-tested there (`typecheck:electron` clean, `test:intelligence` 2,874 pass / 0 fail, llm suite 5,768 pass / 0 fail)
and then fast-forwarded and verified on main. Not benchmarked on main. Landed with its caveat on record: on the
holdout the rows that need no profile fact fell 0.31 (±0.60), hard fails 3 → 5. Undo: `git revert 73a2f89f`. gpt-6-astra has not judged any E2 run; they are added to its chain.

---

## M1 — main as it now stands, measured (2026-10-04; Evin: "continue")

**Rule written before main was run (commit time of this section is the record).**

**Why.** E1, the markup fix, E5 and E2 are on local main, each measured on the `e000db4a` base. Main is more than
300 commits past that base; only the test suites vouch for the combination there. Before anything else is built on
main, main itself is run: `54606ef2`, unchanged, in a fresh worktree.

**What runs.** dev (270) and counterfactual (63) as run tag `m1`, then the holdout (180), judged blind. Control:
`s3` (E1 + markup fix + E5 on the old base) for all rows, and `s4` (`s3` + E2) for the two profile modes'
profile-fact delivery. Generator: direct DeepSeek as before, recorded per row.

**Rule (dev + counterfactual; the landed stack must carry over to main, not improve).**
1. Every needed reference fact in the prompt on at least 93 % of the rows that need one (`s3`: 95 %).
2. Rows of the two profile modes that need a profile fact: every needed fact in the prompt on at least 17 of 20
   (`s4`: 19).
3. No claim-pass request cut; no file of another mode in any prompt; no string of the other profile in any prompt
   or answer.
4. All rows, paired with `s3` (shown): not below −0.25.
5. Hard fails not above `s3`'s 31 by more than 5; critical not above its 18 by more than 4.
6. Heard first word, median, not more than 250 ms above `s3`'s dev run.
Holdout (aggregates only): lines 1, 3, 4 and 5 against `s3`'s holdout (hard fails 15, critical 5; the same margins).
All hold → the measured results carry over to main. A line fails → Evin is told which, with the numbers, before
anything else is built or landed; nothing is reverted without his word.

### M1 — dev + counterfactual on main `54606ef2` (2026-10-04, committed 04:38 UTC as `61ee2c39`; provisional judge)

`report/stack-vs.mjs s3 m1 dev cf`, `report/paired-builds.mjs s3 m1 dev cf`, `report/profile-rows.mjs s4 m1 dev cf`.
333 rows, all answered, none unverified; generator direct DeepSeek on every row.

| Rule line | Measured | Holds |
|---|---|---|
| 1. Needed reference fact in the prompt on at least 93 % | 232 of 244 (95.1 %; `s3`: the same 232) | yes |
| 2. Profile-fact rows of the two profile modes: at least 17 of 20 | 19 of 20 (`s4`: 19) | yes |
| 3. No claim-pass request cut; no cross-mode file; no other-profile string | 0 of 252 passes cut; 0; 0 | yes |
| 4. All rows, paired with `s3` (shown): not below −0.25 | 8.52 → 8.59, +0.08 (±0.16) | yes |
| 5. Hard fails ≤ 36, critical ≤ 22 | 26, 11 (`s3`: 31, 18) | yes |
| 6. Heard first word, median, not more than 250 ms above `s3`'s dev run | 1,484 ms against 1,772 ms | yes |

The effect of the claim pass on main is −0.05 (±0.10), with hard fails 33 in the drafts and 26 shown. On the two
profile modes main matches `s4`: 8.51 → 8.53. **Dev + counterfactual: the results carry over to main.**

### M1 — holdout on main and verdict (2026-10-04, committed 05:00 UTC as `bd01379a`; aggregates only; provisional judge)

`er-holdout-m1` on `54606ef2` (180 rows, all answered, none unverified), judged blind with its drafts;
`report/stack-vs.mjs s3 m1 holdout --blind`, `report/paired-builds.mjs s3 m1 holdout`.

| Holdout line | Measured | Holds |
|---|---|---|
| 1. Needed reference fact in the prompt on at least 93 % | 132 of 135 (97.8 %) | yes |
| 3. No claim-pass request cut; no cross-mode file; no other-profile string | 0 of 133; 0; 0 | yes |
| 4. All rows, paired with `s3` (shown): not below −0.25 | 8.71 → 8.54, −0.17 (±0.24) | yes |
| 5. Hard fails ≤ 20, critical ≤ 9 | 20, 8 (`s3`: 15, 5) | yes, hard fails at the limit |

**Verdict: the measured results carry over to main.** Every line holds on both sets. They hold comfortably on dev
+ counterfactual (+0.08, hard fails 31 → 26) and at the margin on the holdout (−0.17, hard fails 15 → 20). Over all
513 rows main and `s3` are level: 8.58 and 8.58, 46 hard fails each, critical 19 against 23.

Against the kept build `e000db4a`, on the blind holdout: **7.40 → 8.54 (+1.14 ±0.42)**, hard fails 39 → 20, critical
19 → 8; evidence-required rows 7.15 → 8.65 (+1.51 ±0.48). The rows that need no document went the other way:
8.38 → 8.06 (−0.32 ±0.65), hard fails 4 → 7, critical 2 → 5.

Where the holdout is lower than `s3` (drafts and shown alike, so it is the generator and not the claim pass):
conflict / stale −0.71 (±0.65), multi-source −0.45 (±0.63), rows that need no document −0.39 (±0.44) with hard
fails 3 → 7. Single-source rows +0.21. Main differs from `s3` by E2 and by the 300 other commits; which of the two
moved these slices is not established, and on dev + counterfactual the same slices moved the other way (+0.21,
−0.14, +0.26).

Main, all 513 rows (`report/mode-table.mjs m1 dev cf holdout`): General 8.44, Sales 8.17, Recruiting 8.47, Team Meet
8.82, Looking for work 8.11, Lecture 8.77, Technical Interview 8.89, Seminar 9.25, Call Center 8.26; all 8.58.
Rows with the evidence in the prompt (382 of 400): mean 8.81 (±0.17), 10th percentile 6.1, critical 2.1 %, hard
fails 7.1 %. Targets (9.2, 8.5, under 1 %) not met; the verdict by the rule of the report's section 2 stays A.

What remains on main, dev + counterfactual (`analyze.mjs`, 26 hard fails): something invented where the evidence is
absent 7; answer wrong with the evidence in the prompt 6; arithmetic 4; addressed to the wrong party 3; an outdated
or draft source preferred 3; needed fact not in the prompt 2; profile evidence 1. Thirteen evidence-required rows
still miss their evidence (mean 5.27 against 8.87 for the 244 that have it): 7 are turns the classifier answers
without reading the loaded pack, 3 are heard Recruiting turns on which the claim-authority gate removes the hiring
job description from the pack (it is present on typed turns), and 3 are planning misses in the profile modes.

---

## E8 — the loaded pack reaches every turn of its mode (Evin, 2026-10-04: "Both delivery gaps")

**Rule written before any E8 code existed (commit time of this section is the record).**

**What main does today** (`m1`, dev + counterfactual, judge-free; the prompt's evidence tags against the files loaded):

| | Turns | Whole pack in the prompt | Some files missing | No file read |
|---|---:|---:|---:|---:|
| Recruiting, heard | 27 | 13 | 13 | 1 |
| Recruiting, typed | 9 | 8 | 1 | 0 |
| Technical Interview, heard | 22 | 20 | 2 | 0 |
| Turns the classifier answers without retrieval, in General, Sales, Team Meet, Recruiting, Looking for work | 10 | 0 | 0 | 10 |
| Every other mode and surface | 238 | 237 | 0 | 1 |

* **(a)** In `legacy-retrieval-port.ts` the claim-authority gate keeps only items that can evidence a claim the turn
  needs. On a heard Recruiting turn the needed claims are about the candidate, so the mode's own hiring job
  description (typed `JOB_DESCRIPTION`) is removed from the pack, also when the candidate asks what the role pays or
  how much travel it has. The planned-type gate already admits a mode's own attachments; this one does not.
* **(b)** A turn the classifier answers from general knowledge reads a small corpus (≤ 1,400 tokens) and, since E1,
  nothing of a larger pack. "Can both be had on Operations?" gets "I'll confirm" with the matrix unread.

**Change (branch `fix/er-pack-always`, from the measured main `54606ef2`; two commits).**
* (a) A file of the mode handed over whole (`MODE_REFERENCE_FILE`, `wholeDocument`) is not removed by the
  claim-authority gate. What it may SUPPORT is unchanged (`acceptedFor`, `evidenceSupportsClaim`): a job description
  still cannot be counted as support for a claim about the candidate or the user.
* (b) On such a turn a pack that fits (≤ 12,000 tokens) is read, as a small corpus already is. This reverses E1's
  choice for those turns and costs its input tokens on every one of them.
Not in it: the planning misses in the profile modes (3 rows).

**Control:** `m1`. **Candidate:** run tag `m2`, dev + counterfactual (all modes), then the holdout.

**Rule, judge-free (dev + counterfactual).**
1. Every needed reference fact in the prompt on at least 240 of 244 rows (`m1`: 232).
2. Turns with a pack loaded: every loaded file in the prompt on at least 298 of the 306 (`m1`: 279).
   *Corrected 2026-10-04 before any `m2` row was judged: this line first read "325 of the 333 (`m1`: 305)". 27 of
   the 333 turns have no file loaded, and I had counted them as turns with the whole pack. The margin (all but 8)
   is unchanged; `report/pack-in-prompt.mjs` is the count.*
3. No claim-pass request cut; no file of another mode in any prompt; no profile evidence in a mode that may not use
   it; no string of the other profile.

**Rule, judged (provisional judge), paired with `m1`.**
4. The 12 rows that missed their reference evidence in `m1`: mean gain at least +1.0.
5. All rows: not below −0.15; hard fails not above `m1`'s 26 by more than 2.
6. Rows that need no document (74): not below −0.3; hard fails not above `m1`'s by more than 2. These include the
   general-knowledge turns that now carry a pack.
7. Recruiting (37 rows): not below −0.2, and the rows flagged for a claim about the candidate that nothing supports
   (`unsupported_personal_claim`, `role_confusion`) not above `m1`'s.
8. Heard first word, median over the dev run: not more than 100 ms above `m1`'s. The turns of (b) are reported on
   their own.

**Holdout (aggregates only):** lines 1, 3, 5 and 6 with `m1`'s holdout as the control (hard fails 20; the same
margins). A failure of line 7 drops (a); a failure of line 6 or 8 drops (b); any other failure drops both.
Nothing lands without Evin.

### E8 — dev + counterfactual data and verdict (2026-10-04; run `m2` = main `54606ef2` + `dfe2cf5b` + `e1cb7f9b`; provisional judge)

`report/pack-in-prompt.mjs m1 m2 -- dev cf`, `report/missed-rows.mjs m1 m2 recruiting -- dev cf`,
`report/stack-vs.mjs m1 m2 dev cf`, `report/paired-builds.mjs m1 m2 dev cf`. The run was paused at Evin's request at
115 of 270 dev rows and resumed 20 minutes later on the same build; 333 rows answered, none unverified.

| Rule line | Measured | Holds |
|---|---|---|
| 1. Needed reference fact in the prompt on at least 240 of 244 | 232 → 242 | yes |
| 2. Every loaded file in the prompt on at least 298 of 306 turns | 279 → 305 (fast-path turns 2 → 12 of 12; Recruiting heard 13 → 27 of 27) | yes |
| 3. No claim-pass cut, no cross-mode file, no profile evidence where forbidden, no other-profile string | 0 of 251; 0; 0; 0 | yes |
| 4. The 12 rows that missed their reference evidence in `m1`: gain ≥ +1.0 | 5.58 → 8.62, +3.04 (±1.60); hard fails 2 → 0 | yes |
| 5. All rows not below −0.15; hard fails not above 28 | −0.07 (±0.20); **33** (critical 11 → 17) | **no** |
| 6. Rows that need no document: not below −0.3; hard fails not above 11 | −0.12 (±0.42); 11 | yes, at the limit |
| 7. Recruiting not below −0.2; unsupported-claim / role flags not up | +0.08 (heard +0.50); 1 → 1 | yes |
| 8. Heard first word, dev median, not more than 100 ms above `m1` | 1,484 → 1,589 ms (+105) | **no**, by 5 ms |

**Verdict by the rule: not kept** (line 5, and line 8 by 5 ms). The holdout was not run.

What the failed lines are made of, split by whether the change could have touched the row (the set of evidence
items in the prompt is the same in both runs, or not):

| | Rows | `m1` | `m2` | Hard fails | Newly failing / newly fine |
|---|---:|---:|---:|---:|---:|
| Evidence set changed (what E8 does) | 28 | 7.48 | 8.62 (+1.14 ±1.14) | 3 → 2 | 2 / 3 |
| Evidence set identical in both runs | 305 | 8.70 | 8.51 (−0.19 ±0.18) | 23 → 31 | 15 / 7 |

The whole rise in hard fails is on rows E8 did not touch, where the two runs sent the same evidence and got
different answers. The first-word difference is the same: the fast-path turns E8 changed went 1,207 → 1,188 ms
with the pack in the prompt; the other turns, unchanged, went 1,622 → 1,721 ms. So the two failed lines measure the
difference between two runs, not the change. I set line 5's margin (2 hard fails) without having measured how much
two runs of one build differ; `s3` against `m1` had already shown swings of five. That is my calibration error, and
the verdict above stands as written. To put a number on it, the control build is run a second time (`m1r`).

Of the two rows E8 touched that newly fail: one general-knowledge turn that now carries the pack attached a
personal claim (9.5 → 5.0), and one Recruiting turn deferred with the job description in view (9.3 → 2.6). The five
fast-path turns that need no document went 9.26 → 7.69 (−1.57 ±1.80): the cost side of (b), on five rows.

### Run-to-run variation, measured (`m1r`): written before the run

The control build `54606ef2` is run a second time on dev + counterfactual as `m1r`, judged the same way. Nothing is
decided by it. It answers one question: when the build and the prompts are the same, how far apart are two runs
in mean, in hard fails and in first word? It will be reported as `m1` against `m1r` on all 333 rows, and it is the
yardstick for every paired line in this file whose margin was set without it (E8 line 5 first of all). E8's
verdict by its rule is not changed by it.

### Run-to-run variation, measured (`m1` against `m1r`, the same build twice; 2026-10-04 07:30 UTC; provisional judge)

`report/run-noise.mjs m1 m1r dev cf`. 333 rows, both runs complete.

| Two runs of main `54606ef2` | First | Second |
|---|---:|---:|
| Mean, 333 rows | 8.59 | 8.52 (−0.08 ±0.16) |
| Hard fails | 26 | 28 (11 newly failing, 9 newly fine, 17 in both) |
| Critical | 11 | 13 |
| Heard first word, dev median | 1,484 ms | 1,628 ms |
| Shown answers identical in both runs | 3 of 333 | |
| Per-row difference | sd 1.47; 71 % within half a point; 9 % more than two points apart | |

So, for this benchmark and this judge: a row's score from one run is a sample, not a property of the build (one row
in eleven moves by more than two points between runs of the same build); a set's mean repeats within about ±0.16;
the hard-fail COUNT repeats within a few, but its membership turns over (20 of 37 failing rows fail in only one of
the two runs); and the heard first word moved by 144 ms between two runs of one build on a shared machine. Every
earlier line in this file that set a margin of 2 hard fails, or 100–150 ms, was tighter than the instrument.

*Not a clean repeat in the two profile modes.* In `m1r` the app structured some profile documents with the model
instead of the built-in parser (job descriptions parsed by the model on six loads, one résumé; each load took 15 to
440 s against 1 to 4 s, because the model call timed out at 45 s and was retried before the fallback). The
other runs never did, for a reason I have not established (probably which credentials the app found at start). The
seven modes without a profile: 8.61 → 8.57 (−0.04 ±0.17), hard fails 22 → 22. The two profile modes: 8.53 → 8.33
(−0.20 ±0.37), which is this study's only measurement of the model-structured path, and it is 74 rows with a mixed
state.

**E8 read against both control runs.** Hard fails: 26 and 28 in the two control runs, 33 in `m2`. Against the
second control, rows whose evidence set did not change: 23 → 30 (14 newly failing, 7 newly fine); rows whose
evidence changed: 7.75 → 8.56 (+0.81 ±0.76), hard fails 5 → 3; the rows that had missed their evidence: +3.14
(±1.54). `m2`'s excess of 5 to 7 hard fails sits on rows E8 did not touch and is larger than the 2 between the two
control runs, without being separable from run-to-run turnover on these numbers (flips 14 against 7 where two
control runs give 10 against 9). `m2` was also the run that was paused and resumed. E8's verdict by its rule
stands (not kept). To see whether the excess repeats, the candidate is run a second time (`m2r`).

### E8 — the candidate run a second time (`m2r`; 2026-10-04 08:03 UTC; provisional judge)

`report/run-noise.mjs m2 m2r dev cf`, `… m1 m2r …`, `… m1r m2r …`, `report/missed-rows.mjs m1 m2r recruiting -- dev cf`.

| dev + counterfactual, 333 rows | Control, run 1 | Control, run 2 | Candidate, run 1 | Candidate, run 2 |
|---|---:|---:|---:|---:|
| Mean | 8.59 | 8.52 | 8.52 | 8.62 |
| Hard fails | 26 | 28 | 33 | 27 |
| Critical | 11 | 13 | 17 | 12 |
| Heard first word, dev median | 1,484 ms | 1,628 ms | 1,589 ms | 1,732 ms |
| Whole pack in the prompt (306 turns with one) | 279 | 279 | 305 | 305 |

The excess of hard fails in the candidate's first run did not repeat (33, then 27, against 26 and 28). What does
repeat, in every pairing of a control run with a candidate run:

| | Run 1 against control 1 | Run 1 against control 2 | Run 2 against control 1 | Run 2 against control 2 |
|---|---:|---:|---:|---:|
| Rows whose evidence set changed | +1.14 (±1.14) | +0.81 (±0.76) | +1.29 (±1.00) | +0.94 (±0.67) |
| Hard fails on those rows | 3 → 2 | 5 → 3 | 3 → 0 | 5 → 1 |
| The 12 rows that had missed their reference evidence | +3.04 (±1.60) | +3.14 (±1.54) | +3.18 (±1.27) | |
| Fast-path turns that need no document (5 rows) | −1.57 (±1.80) | −1.35 (±1.93) | −0.82 (±0.57) | |
| Recruiting, 37 rows | +0.08 (±0.70) | | +0.59 (±0.54) | |

So: the delivery gain is real and repeats; the hard-fail line that failed was run-to-run variation; and (b) has a
repeatable cost on the general-knowledge turns that now carry a pack (five rows, about a point).
**E8's verdict by its first rule stands as recorded: not kept (lines 5 and 8, on run 1).**

### E8 — a second rule, for the blind holdout, with margins taken from the measured variation

Written before any holdout row of E8 exists. It follows what Evin chose for E2 (run the blind holdout under a rule
written first); it replaces nothing above. Run `er-holdout-m2` on `fix/er-pack-always` (`e1cb7f9b`), 180 rows,
judged blind. Control: `er-holdout-m1`. Margins: two runs of one build differed by 0.08 (±0.16) on the mean and by
2 to 7 hard fails on 333 rows.

1. Turns with a pack loaded: every loaded file in the prompt on at least 97 % (`m1` holdout: 153 of 163).
2. No claim-pass request cut; no file of another mode; no profile evidence where forbidden; no other-profile string.
3. Rows whose evidence set changed against `m1`: mean gain at least +0.5.
4. All rows, paired: not below −0.25.
5. Hard fails not above `m1`'s 20 by more than 6.
All five hold → E8 is confirmed on the holdout and stays on its branch for Evin's decision, with the cost of (b)
stated. Any line fails → not kept, finally.

### E8 — holdout data and verdict under the second rule (2026-10-04 08:40 UTC; aggregates only; provisional judge)

`er-holdout-m2` on `e1cb7f9b` (180 rows, all answered, none unverified), judged blind. 60 of the 180 judgments
first failed with "Your organization has disabled Claude subscription access for Claude Code"; two retried a few
minutes later went through, and the other 58 were then judged normally. No row was left unjudged.

| Holdout line | Measured | Holds |
|---|---|---|
| 1. Every loaded file in the prompt on at least 97 % of turns with a pack | 153 → 163 of 163 | yes |
| 2. No claim-pass cut; no cross-mode file; no profile evidence where forbidden; no other-profile string | 0 of 132; 0; 0; 0 | yes |
| 3. Rows whose evidence set changed against `m1`: mean gain at least +0.5 | 11 rows, 8.24 → 8.64, **+0.40** (±1.34); hard fails 0 → 1 | **no** |
| 4. All rows, paired: not below −0.25 | 8.54 → 8.82, +0.28 (±0.25) | yes |
| 5. Hard fails not above 26 | 13 (`m1`: 20); critical 8 → 5 | yes |

**Verdict under the second rule: not kept** (line 3, by 0.10 on 11 rows). As written, that is final for E8. The
branch `fix/er-pack-always` (`dfe2cf5b`, `e1cb7f9b`) stays as it is, not landed.

For the record, beside the verdict: the three holdout rows that had missed their reference evidence went 6.72 →
9.28; the whole holdout scored 8.82 against main's 8.54 and the kept build's 7.40 (+1.42 ±0.39, hard fails 39 → 13,
critical 19 → 5), most of the difference to main on rows E8 did not touch (+0.27 ±0.26), which is the size of
run-to-run variation measured above.

### E8 (a) landed on LOCAL main (Evin, 2026-10-04: "Land the Recruiting fix only")

`efc126a9` on `88d4e7a0`: the claim-authority change alone (cherry-pick of `e1cb7f9b`), its test file trimmed to
that change. On that commit: `typecheck:electron` clean, `test:intelligence` 2,881 pass / 0 fail, llm suite 5,768
pass / 0 fail; verified on main with `git merge-base --is-ancestor`. Not pushed; not benchmarked alone (it was
measured together with (b): Recruiting +0.08 and +0.59 over two runs, the hiring job description in the prompt on
27 of 27 heard Recruiting turns instead of 13). Undo: `git revert efc126a9`. (b), the fast-path change, stays on
`fix/er-pack-always` (`dfe2cf5b`), not landed.

---

## E9 — the claim pass names the two shapes of invention seen when the asked fact is absent

**Rule written before any E9 arm was run (commit time of this section is the record).** Evin: "continue".

**What main does.** Across the two control runs of main (`m1`, `m1r`, dev + counterfactual), 11 rows that need no
document hard-failed in at least one run. On 7 of them the claim pass ran and left the invention in: "Your
friend's right" about a topic absent from the slides; the networks final's date given for the economics final; "the
handles and knobs are part of the cabinetry" with no quote saying so; a connector's cost as "a separate line" with no
price list saying so; an invented story about a manager. The pass's list step has three kinds ([past], [self],
[promise]); these two shapes (a yes / no about whether something absent was covered, and another item's value
given as the asked one) are not named in it. The other 4 rows are on turns the pass does not run (Lecture; one
Technical Interview turn the personal pattern misses); they are not addressed here.

**Change (wording of the pass's own prompt only, `replay-variants/e9-v1.mjs`).** The [past] kind also names: a yes
or a no about whether something was covered, included, mentioned, allowed or offered when the material never names
it; and a value, date, rule or result the material gives for a different item, presented as the one asked about.
Nothing else changes.

**How it is measured.** Offline, on the drafts `m1` recorded (dev + counterfactual, main `54606ef2`), with main's
own pass (`results/.cv/cv-main-54606ef2.mjs`, system prompt hash-checked on 203 of 203 dev rows), cap 96,000, k 2:
a control arm (main's wording) and the v1 arm, both through the same harness; new texts judged.

**Rule (offline; paired on the same drafts, so the generator's run-to-run variation is out of it).**
1. Hard fails: v1 at least 2 below the control arm.
2. All rows: v1 not below the control arm by more than 0.05.
3. Rows with the evidence in the prompt: not below the control arm by more than 0.1 (the pass must not start
   deleting what the files state).
4. Answers the pass changes: not more than 25 % above the control arm (deferral is the known cost).
5. The control arm's two repetitions agree with each other within half of whatever line 1 or 2 measures; if they do
   not, the replay itself is too noisy to decide and nothing is concluded.
All hold → one app run of main + E9 on dev + counterfactual and the holdout, under the rule written then.

### E9 — offline data and verdict (2026-10-04 09:46 UTC; provisional judge)

Arms `e9-ctl` (main's wording) and `e9-v1`, k 2 each, on the 252 turns of `m1` (dev + counterfactual) where the
pass ran; the rebuilt request equals the recorded one on 504 of 504 replays per arm. New texts judged (153).

| | Control, rep. 0 | Control, rep. 1 | v1, rep. 0 | v1, rep. 1 |
|---|---:|---:|---:|---:|
| Mean, 333 rows | 8.59 | 8.63 | 8.65 | 8.66 |
| Hard fails (drafts: 33) | 27 | 26 | 24 | 25 |
| Critical | 15 | 12 | 11 | 13 |
| Answers the pass changed | 59 | 56 | 65 | 59 |

| Rule line | Measured | Holds |
|---|---|---|
| 1. Hard fails at least 2 below the control | −3 and −1 (average −2) | at the line |
| 2. All rows not more than 0.05 below | +0.05 and +0.03 | yes |
| 3. Evidence-in-prompt rows not more than 0.1 below | +0.05 and −0.02 | yes |
| 4. Changed answers not more than 25 % above | +10 % and +5 % | yes |
| 5. The control's two repetitions agree within half of what lines 1 and 2 measure | hard fails differ by 1 (half of 2: yes); the mean differs by 0.04, against an effect of 0.04 (half: 0.02): **no** | **no** |

**Verdict: nothing concluded; not taken to the app.** The new wording points the right way in both repetitions
(three and one fewer hard fails, the no-document rows +0.08 and +0.19), but the effect is the size of the
replay's own spread, which line 5 was written to catch. At this size a change can no longer be resolved by this
benchmark with one judge: the 333 dev + counterfactual rows hold about 11 rows of this failure class, and the pass
replayed twice on the same drafts already differs by one hard fail and 0.04 of a point.

## E10 — the heard "corrected answer" repair inherits the whole prompt (96,000), like the claim pass (E5)
Written 2026-10-04, BEFORE any replay or judgment. Owner's pick ("let it read everything").

**Change (branch `fix/typed-verbatim` in er-main, one argument):** the document-grounded repair on the heard path
(`IntelligenceEngine.ts`, the `repairCallArgs(... ['reference_files'])` call) passes
`CLAIM_VERIFIER_MATERIAL_MAX_CHARS` (96,000) as its inherited-prompt cap instead of the 24,000 default.

**Measurement: offline replay of the repair call** (`evidence-rich/replay-repair.mjs`), on every recorded turn where
the repair ran in er-dev-m1, er-dev-m1r, er-dev-m2 and er-holdout-m1 (131 turns, all heard, all cut at 24,000).
- Arm `cut` = the repair message exactly as recorded (inherited prompt cut at 24,000 + marker + repair text).
- Arm `whole` = the generator's recorded user message whole (≤ 96,000) + `\n\n---\n` + the same repair text.
- Same system prompt in both arms: the app's live v2 answer prompt + the language suffix. The recorded hashes
  carry each mode's own instruction layer, which could not be rebuilt offline — identical across arms, so the
  comparison is controlled; absolute scores are not the app's.
- Direct DeepSeek (`deepseek-flash`, temperature 0.2, seed 7, thinking off), the provider these runs used; the
  app's own stops mirrored: first useful text (≥ 5 chars) within 7,000 ms, output cap `repairCapReached(…, 1800)`.
- k = 2 repetitions per arm.

**Rule (KEEP = land on the branch for Evin; otherwise REVERT the one argument):** all of
1. Needed-fact strings (oracle `doc_needles`/`answer_needles`) present in the repair output, summed over both
   repetitions: `whole` ≥ `cut`.
2. Judge mean over the 131 repair outputs (the repair text judged as the answer), averaged over k:
   `whole` − `cut` ≥ −0.05.
3. Hard fails (averaged over k): `whole` ≤ `cut` + 1.
4. First useful text, median: `whole` ≤ `cut` + 600 ms; and outputs inside the 7,000 ms deadline:
   `whole` ≥ `cut` − 2 percentage points.
Judge: gpt-6-astra (canonical, back since 11:02 UTC). If Astra stops answering mid-way, the rest is judged by Opus
5.5 (provisional, never pooled) and the verdict waits for Astra.
Descriptive only (not part of the rule): the 11 turns where `cut` lacked a needed fact the generator had.

**E10 result (2026-10-04).** Replay: 524 calls, all finished inside the deadline. Astra answered 72 judgments before its
budget pool closed (HTTP 402, 12:08 UTC) — no turn has all four arm × k judgments, so there is no Astra verdict.
Per the rule, judged by Opus 5.5 (provisional, 524/524, never pooled):

| arm | mean | hard fails | needed-fact strings in the output | first useful median | inside 7 s |
|---|---|---|---|---|---|
| cut (24,000, as today) | 7.896 | 26.0 | 314 | 1,193 ms | 100 % |
| whole (≤ 96,000) | 8.773 | 12.0 | 378 | 1,267 ms | 100 % |

Lines 1–4 all PASS (whole − cut +0.877 ±0.340). **Provisional verdict: KEEP** (commit `bc878adc` on
`fix/typed-verbatim`). The verdict waits for Astra, as written. Caveat stated in the rule: the system prompt lacked each
mode's own instruction layer in both arms, so the absolute scores are not the app's.

## E11 — a named fact is ranked above pieces that share only common words; the retriever picks only what fits; typed questions use the embedding search
Written 2026-10-04, BEFORE any app measurement of this change. Owner's picks: "fix the scoring", "fit what's
picked", "smart search for typed too".

**Measured cause (CONTEXT-TRUNCATION-TESTS §4).** Typed, 6 × 2,100-token files: the right chunk was retrieved, but
`computeDocumentAnswerabilityScore` gave it 0.07 (entity boost capped at 0.25 with common words — code, gate, depot —
counted like the name; −0.18 "generic overview" because the word "summary" appeared in its first 220 chars) while
five wrong chunks got 0.24; it ranked 5th and the packer fitted 4. A run with the embedding search on missed the
same facts, so the typed lexical fallback was NOT the cause (my first explanation was wrong).

**Change (branch `fix/typed-verbatim` in er-main):**
(a) names in the question (capitalised phrases minus sentence-opening question words; tokens with digits) score
0.15 per hit (cap 0.30), other shared words 0.05 (cap 0.15); (b) the overview penalty fires on an overview SECTION
— section title, or a line in the first 220 chars that is itself an overview heading — not on the word inside a
sentence; (c) the V3 mode port counts 120 est. tokens per item (the packer's tag) against the retriever's budget;
(d) typed questions query the bundled embedder in a meeting too (env `NATIVELY_KEYLESS_LEXICAL_MANUAL_RETRIEVAL=1`
restores the July hotfix).

**Measurement.**
1. Probes (`evidence-rich/limits/probe.mjs`, judge-free, AgentRouter → DeepSeek as for the main-build probes):
   ref-count typed AND heard — sales 6×2100, 10×3000, 6×1900, 20×600, 5×3000; general 10×3000; ref-size typed general
   12500/32000/64000 (7 positions); aggregate general 4000/11800/12500/32000.
2. One dev run of the branch (`er-dev-e11`, 270 rows) — direct DeepSeek, because the main baselines er-dev-m1/m1r
   used direct DeepSeek (recorded reason); another route would confound both delivery and first-word time.
   Judge: Opus 5.5 (provisional), because m1/m1r were judged by Opus; never pooled; Astra re-review later.
   Note: the branch also carries #2 (typed verbatim), #3 (output cap/notice) and E10 (repair cap); none changes what
   retrieval puts in the generator's prompt except #2, which changes the typed question text.

**Rule (KEEP = stays on the branch for Evin):**
1. Probes: the typed named-fact misses (sales 6×2100: 2/3, sales 10×3000: 2/3, general 10×3000: 2/3 on main) → 0;
   and no new miss anywhere in the probe set (heard and typed). Aggregate: not worse than main at any size.
2. Dev run: needed-fact strings delivered to the generator prompt ≥ min(m1, m1r).
3. Typed first word, median: ≤ max(m1, m1r) typed median + 150 ms.
4. Opus quality: mean ≥ min(m1, m1r) − 0.05; hard fails ≤ max(m1, m1r) + 2.
Failing 1, 2 or 4 → revert (a)–(c) and report; failing 3 alone → revert (d) only.

## E12 — older speech comes back for long questions; the live speech window keeps four to five minutes
Written 2026-10-04, BEFORE any app measurement of this change. Owner's pick: "fix the search + keep more speech".

**Measured cause (CONTEXT-TRUNCATION-TESTS §5).** The prompt held the last 2,400 chars of speech, read from 60–90 s
of a rolling context evicted at 180 s: a 20-line exchange had lost its first line. Older speech is retrieved by BM25
over 600-char windows with a floor of 0.2 × the best window; the best window was the one holding the asked question
(1.00), the fact windows scored 0.15–0.16, and "launching" never met "launch".

**Change (branch `fix/older-speech` in er-fix1, on top of `fix/typed-verbatim`, commit c6b1bc59):** the asked
question's own line is removed before scoring and never returned as evidence; speech is matched on light stems (this
port only); `SPEECH_WINDOW_MAX_CHARS` 2,400 → 6,000 from the durable transcript (600 s) on both answer paths; the
conversation budget is charged at most the old 2,400 for it.

**Measurement.**
1. Transcript probe (`probe.mjs transcript`, heard, judge-free): General, Team Meet and Call Center at 10, 20, 40,
   80, 160 lines (three facts each: line 1, the middle, three lines from the end).
2. The `pressure` probe (résumé + large file + 80-line meeting): unchanged or better.
3. Dev run: see the amendment below.

**Rule (KEEP = stays on the branch for Evin):**
1. Fact checks present in the request across the transcript probe: ≥ 90 % (main: 3/3 only at 10 lines; 2/3 at 20;
   1/3 from 40 up). The question's own line never appears as an evidence item.
2. Pressure probe: every target that reached the request on main still does.
3. Heard first word, median over the probe's heard turns: ≤ the main-build probe's + 150 ms.
4. Dev run (below): Opus mean on heard rows ≥ min(m1, m1r) − 0.05; hard fails on heard rows ≤ max(m1, m1r) + 2.
Failing 1 → revert the search half; failing 3 or 4 → revert the window half (6,000 → 2,400) and re-measure.

### Amendment to E11 and E12, 2026-10-04, written before any dev run
One dev run, not two. The machine was out of memory twice today with the app, the judge and builds running together
(the app was killed mid-probe; free memory 52 MB of 16 GB). So E11's lines 2–4 and E12's line 4 are measured on a
single dev run of `fix/older-speech` (E11 + E12 together), named `er-dev-e12`, direct DeepSeek, judged by Opus. If any
of those lines fails, the run is repeated on `fix/typed-verbatim` alone to attribute the failure before anything is
reverted. E11's probe line (1) was measured on `fix/typed-verbatim` alone and stands on its own.
From here on, one heavy job at a time: an app run, OR a judge batch, OR a build + test suite.

**E11 probe line (1), measured 2026-10-04 on `fix/typed-verbatim` (results/limits-e11): PASS.** Typed misses → 0
(sales 6 × 2,100: 3/3; sales 10 × 3,000: 3/3; general 10 × 3,000: 3/3; main had 2/3 missed in each). No new miss:
heard and typed, sales 6 × 2,100, 10 × 3,000, 5 × 3,000, 6 × 1,900, 20 × 600 and general 10 × 3,000 all 3/3; ref-size
typed 12,500 / 32,000 / 64,000 all 7/7. Aggregate equal to main in facts reaching the request (4,000: 7/7; 11,800: 7/7;
12,500: 2/7; 32,000: 3/7) with one item fewer above 12,000 (the retriever now counts the tag). One 32,000 answer was a
provider timeout ("did not produce an answer in time"); rerun: 3/7 in request and answer, as on main.
The app was killed twice during these probes by memory pressure on the machine (not by the change): results were
collected over three app launches.

**E12 probe lines (1) and (2), measured 2026-10-04 on `fix/older-speech` (results/limits-e12): PASS.** Transcript
probe: 36 of 36 fact checks in the request (General 10/20/40/80/160, Team Meet 10/20/40/80/160, Call Center 20/80;
main: 3/3 only at 10 lines, 2/3 at 20, 1/3 from 40 up), and the answers state all three facts at every size (main:
"I'll confirm the codename and come back to you"). Pressure probe: all five targets in the request, as on main.
**Line (3) cannot be read from the probe:** `probe.mjs` did not record the first-word time, on main or here (my
omission). Amendment, written before the dev run and before looking at any first-word figure: line 3 is read from the
dev run's heard rows — first word, median ≤ max(m1, m1r) heard median + 150 ms.

## Autopilot series (Evin, 2026-10-04): judge = Claude Code (Opus 5.5, `ER_JUDGE_ROLE=cc`), continue toward 10
"since the claude code and astra are similar in judging continue with claude code as judge, update the judge character
… be specific to claude code that you are the judge and not act like claude code. after it reaches above 9.5 still
continue till you reach 10 or i stop manually so you are on autopilot".
- Judge: `AQ_JUDGE=opus ER_JUDGE_ROLE=cc` — the unchanged charter behind a preamble (CHARTER-ER.claude-code.md) that
  says the model is the judge, not Claude Code. Charter version `er1-f81f1c4730f0`, files `<run>.cc.jsonl`, calibration
  38/38. On the same 270 answers (er-dev-e12) it tracks the earlier Opus series: r 0.990, mean abs difference 0.10,
  hard-fail verdict equal on 269 of 270; means 8.696 (cc) vs 8.687. A separate series all the same: never pooled.
- Every iteration keeps the method: cause measured first, rule written before measuring, keep/revert by the rule, the
  holdout touched only to confirm. One heavy job at a time on this machine. Kept changes accumulate on a candidate
  branch; nothing lands on main without Evin.
- Honest ceiling: two runs of one build differ by about ±0.1 in the mean and by ~4 hard fails; a mean of 10.0 on 270
  rows is not a reachable measurement. The series continues until Evin stops it.

## E13 — a turn answered without retrieval still reads a pack that fits (E8 b, re-measured on the candidate)
Written 2026-10-04, BEFORE any measurement of this build.

**Measured cause (er-dev-e12, cc judge).** Of the 8 rows whose needed evidence was not in the prompt, 5 took the FAST
path: the classifier called the question general knowledge and nothing of the loaded pack was read — "can both be had
on operations?" (Sales, 9,023-token pack) → "I'll confirm how the NetSuite link and SSO are handled" (3.1); "can we
bring ~4 yrs of trip records" → deferral (3.8). These rows carry `missed_available_evidence`, the most frequent flag
(22). The change is E8 (b) (`dfe2cf5b`), cherry-picked onto the candidate as `cand/e13` (0c04c519). In E8 its target
rows gained +3.04; it was not kept on an all-rows hard-fail count later shown to be inside run-to-run turnover.

**Control:** er-dev-e12b (`fix/older-speech`, direct DeepSeek). **Candidate:** er-dev-e13 (`cand/e13`), same route.
Judge: cc.

**Rule (KEEP on the candidate branch):**
1. Rows with every needed fact in the prompt: ≥ control + 3.
2. Rows whose needed evidence was missing from the control's prompt and is in the candidate's: mean gain ≥ +1.0.
3. Rows that need no document (missing_evidence + irrelevant_source): mean ≥ control − 0.30; hard fails ≤ control + 2.
4. All rows: mean ≥ control − 0.10; hard fails ≤ control + 3.
5. First word, median: heard ≤ control + 100 ms; typed ≤ control + 150 ms.
A failure of ONLY the hard-fail part of line 3 or 4 triggers one repeat of the candidate run; the count is then the
mean of the two runs. Any other failure → not kept.

### E11 + E12 — dev run and verdict (2026-10-04)
`er-dev-e12` went through AgentRouter by my mistake (the supervisor was started without `--fresh-userdata`; the profile
left by the limits probes still held an AgentRouter key, while the run header said deepseek-direct). It does not meet
the rule's conditions and is not used for the verdict. The runner now refuses to start on any route but direct DeepSeek.
`er-dev-e12b` is the valid run (`fix/older-speech` c6b1bc59, fresh profile, 270/270 on deepseek-direct), judged with the
earlier Opus series for comparison with m1 / m1r (`report/rule-e11-e12.mjs e12b`):

| | m1 | m1r | e12b |
|---|---|---|---|
| needed-fact strings in the prompt (of 1,225) | 404 | 401 | 405 |
| rows with every needed fact (of 212) | 201 | 200 | 204 |
| Opus mean / hard fails | 8.678 / 20 | 8.576 / 24 | 8.681 / 20 |
| heard mean / hard fails | 8.648 / 13 | 8.524 / 16 | 8.687 / 12 |
| first word, median: typed / heard | 899 / 1,484 ms | 1,096 / 1,628 ms | 1,111 / 1,157 ms |

E11.2 PASS, E11.3 PASS (1,111 ≤ 1,096 + 150), E11.4 PASS, E12.3 PASS, E12.4 PASS. With the probe lines:
**E11 KEEP, E12 KEEP.** The benchmark mean does not move (its packs are all under 12,000 tokens and its meetings short):
what these two changes buy is in the probes (typed multi-file misses 6 of 9 → 0; older speech 36/36 facts).
Observation, not explained: on heard turns in the document-grounded modes the time from the hotkey to the provider
request fell from a median of ~500 ms (p90 1,222) on m1/m1r/m2 to 24 ms; prompt size and quality are unchanged. The
step that used to take that time was not identified from the logs.

### E13 — data and verdict (2026-10-04; er-dev-e13 = `cand/e13` 0c04c519, direct DeepSeek; cc judge; `report/rule-pair.mjs er-dev-e12b er-dev-e13`)
| Rule line | Measured | Holds |
|---|---|---|
| 1. Rows with every needed fact in the prompt ≥ control + 3 | 204 → 209 of 212 | yes |
| 2. Rows that gained their evidence: gain ≥ +1.0 | n 5: 5.66 → 8.70, +3.03; hard 1 → 0 | yes |
| 3. Need no document: mean ≥ −0.30; hard ≤ +2 | 8.36 → 8.45; 7 → 5 | yes |
| 4. All rows: mean ≥ −0.10; hard ≤ +3 | 8.66 → 8.72; 20 → 19 | yes |
| 5. First word: heard ≤ +100 ms; typed ≤ +150 ms | 1,157 → 1,085; 1,111 → 1,046 | yes |

**Verdict: KEEP.** Candidate branch is now `cand/e13`.
Noise reading under the cc judge (same build twice, er-dev-e12 vs er-dev-e12b): all rows 8.70 vs 8.66, hard 23 vs 20;
single modes swing by up to ±0.7 on 30 rows. Sales alternates between ~8.6 / 1 hard fail and ~7.85 / 7 hard fails
across runs (e12 7.87, e12b 8.58, e13 7.84) on character-identical prompts: the same pricing or which-list-is-current
question is computed right in one run and wrong in the next (SALES-012, -020, -022, -028, -029). That is the
generator's own variance on multi-step sums and source precedence, not state; it is the next class to work on.

## E14 — a post-answer edit may remove or soften, never add a figure the draft did not have
Written 2026-10-04, BEFORE the holdout run it is decided on.

**Measured (dev, cc judge; er-dev-e12b + er-dev-e13, 95 edited rows judged as draft and as shown;
`report/edit-rails.mjs`).** Edits are net −0.10 on the rows they touch (7.88 as drafts, 7.78 as shown) while cutting
hard fails (18 → 10). They help when the fact is absent (missing_evidence +0.4 / +0.8) and hurt when it is present.
The largest repeatable harm: on conflict/stale turns the draft answered from the CURRENT source and the claim pass
added the superseded figure back as a live alternative ("30 days in one document and 45 in another": 8.4 → 4.0;
REC-018 9.8 → 6.5; TI-026 9.8 → 7.0; LFW-007 8.0 → 4.1). Today's rail (`new_number`) lets any number through that is
in the draft OR anywhere in the material — the superseded figure is in the material.
Rail A — reject an edit that contains a figure the draft did not have — on those 95 rows: rejects 11, saves more than
half a point on 8, loses on 1 (SALES-020, a real unresolved conflict the edit surfaced); edited-row mean 7.780 → 7.972,
hard fails 10 → 9. The softer A′ (allow a one-for-one correction) saves 6 and loses 1. Rails on removed figures, new
deferrals or shrinkage were mixed (B 5/3, C 4/2, D 8/8).

**Change:** in `acceptVerifiedAnswer`, a number in the edit must already be in the draft (`new_number` no longer
admits numbers that are only in the material).

**Decided on the blind holdout, offline:** one holdout run of the candidate WITHOUT the rail (`er-holdout-e13`,
`cand/e13`, direct DeepSeek), shown answers and drafts judged by cc; the rail is applied to the recorded draft/edit
pairs with the app's own number extractor.

**Rule (KEEP → the rail goes on the candidate branch):** on the holdout's edited rows judged both ways,
1. mean with the rail ≥ mean without + 0.05;
2. hard fails with the rail ≤ without;
3. rejections that save more than half a point > rejections that lose more than half a point.
All three, or it is not kept. The holdout rows are read in aggregate only.

### E14 — holdout verdict (2026-10-04; er-holdout-e13, cc; `report/edit-rails.mjs er-holdout-e13`, aggregates only)
25 edited rows judged as draft and as shown. Without the rail 7.607, 4 hard fails; with it (7 edits rejected) 7.846,
5 hard fails; rejections that save more than half a point 4, that lose 1.
Line 1 PASS (+0.239), line 2 **FAIL** (5 > 4), line 3 PASS. **Verdict by the rule: not kept.** The rail helps on
average and blocks one edit that was removing a hard fail. The source edits were reverted; the rail is not re-tuned
against the holdout. Holdout baseline of the series: er-holdout-e13 (cand/e13), cc: 8.759, 14 hard fails, 180 rows.

### Correction to E11 (2026-10-04): the rerank gate must not move
Found while explaining a faster heard path: on m1 / m1r / m2 the time from the hotkey to the provider request on
heard turns in the document-grounded modes had a median of ~500 ms (p90 1,222); on er-dev-e12 / e12b / e13 it is
24–30 ms. docs/ITERATIONS-ASTRA.md (2026-10-03) had already traced that wait to the bundled rerank, awaited when the
retriever's confidence gate reads "low", and records Evin's decision: "keep as today". E11's higher answerability for
a named match also raised the gate's top score, so the gate stopped firing — E11 had switched the rerank off on most
heard turns, against that decision. My error: E11's rule had no line for it and I did not check the gate.
Fix (`cand/e13b` 7734955d in er-fix1): `computeDocumentAnswerabilityScore` also returns `gateScore`, the pre-E11
formula; the confidence gate reads it (best two over the whole list); the ranking keeps the new score.
Check, written before the run: on `er-dev-e13b` the heard hotkey-to-request median in sales, recruiting, team-meet,
lecture, seminar and call-center must be back within 150 ms of m1 / m1r (502 / 536 ms), and the E11 probe line must
still hold (typed 6 × 2,100 and 10 × 3,000: no miss). `er-dev-e13b` (cc) then replaces e13 as the series baseline.

## E15 — a typed question in a live mode is answered to the user, not phrased as a line to the other person
Written 2026-10-04, BEFORE any replay or judgment of it.

**Measured (er-dev-e13, cc).** 10 of the 91 typed rows are marked by the judge for who the reply addresses (mean 7.49,
25 points lost; Sales 5, Call Center 3, General 1, Recruiting 1): the seller privately types "they need the netsuite
link and sso. can both be had on operations?" and the reply is voiced to the prospect ("your customers", "tell me"), or
is a deferral line to say aloud ("I'll confirm … and come back to you"). The composer attaches a perspective note to a
HEARD question (`heardQuestionPerspective`: who said it, whose "I" and "you") and nothing to a typed one; the overlay's
typed box also keeps the spoken-delivery rules (`readingSurface` unset).

**Change:** `typedQuestionPerspective(modeId)` appended to `# Question` when the question was typed in the overlay (not
heard, not the user's own spoken line, not the launcher's reading surface): typed privately by the user, the other
person cannot see it, answer the user ("you" = the user; the other person is spoken about, not to); if words to say are
needed, the fact first, then the line, marked as what to say.

**Measurement 1 — replay (no app):** the 91 typed dev prompts recorded in er-dev-e13, replayed to direct DeepSeek,
k = 2, with and without the note inserted (`replay-generator.mjs --select typed`, variant
`replay-variants/e15-typed-note.mjs`); the replayed answers judged by cc.
The ten rows fixed now, before the replay: GEN-028, SALES-002, SALES-009, SALES-015, SALES-016, SALES-021, REC-009,
CC-006, CC-015, CC-016.
**Rule to take it to the app:** (1) the ten rows: mean gain ≥ +0.5; (2) all 91 rows: note − base ≥ +0.05;
(3) hard fails (mean of k): note ≤ base.
**Measurement 2 — in the app:** a dev run of the candidate with the note; against the series baseline (er-dev-e13b):
all rows ≥ baseline − 0.10, hard fails ≤ baseline + 3, typed rows ≥ baseline + 0.05. Both, or it is not kept.

**E15, amended 2026-10-04 before any judgment.** The judge-free read of the replay (fixed strings: 90.8 % base, 91.5 %
note) showed the first wording lengthens answers (median 435 → 524 chars) and is echoed ("let me give you the facts
first"): its last sentence ("give the fact first and then the line") is the cause. The candidate is therefore the
shorter note, v2 — "(Typed to you privately by the seller you are helping; the prospect cannot see or hear it. Reply to
the user, not to the prospect: "you" means the user.)" — and the rule above is applied to v2. v1 is judged as a
reference only.

### E11 correction, second pass (2026-10-04) — the gate was not the cause; the hotfix covered heard turns too
`er-dev-e13b` (`cand/e13b` 7734955d, the gateScore fix): the check FAILS — heard hotkey-to-request in the
document-grounded modes is still p50 22 ms / p90 27 ms (m1 700 / 1,225; m1r 761 / 1,226). So the gate score was not
what switched the rerank off.
The cause: E11 (d). `shouldUseLexicalForLocalManualQuery` returned true for EVERY V3 turn in a meeting while the bundled
embedder is the provider (under forceDocumentGrounding `hasTranscript` is always false — its own comment says so), heard
turns included. Keyword-only scores are low, the confidence gate read "low", and the bundled rerank was awaited: that is
the wait main has. (d) lifted the rule for every turn; heard turns gained vector scores and the gate stopped firing.
Fix (`cand/e13b` 91de17d1): in a meeting only a TYPED retrieval (`rerankSurface: 'manual'`) queries the vectors; heard
turns keep the keyword search. The gateScore fix stays (it keeps the gate's inputs as on main for the ranking change).
The same check applies to the next run (`er-dev-e13c`): heard hotkey-to-request back within 150 ms of m1 / m1r.

`er-dev-e13b` itself is SPOILED as a quality run and is not used: 29 turns took more than 5 s to the first word
(none in m1, e12b, e13 or the holdout), 9 answers are the app's fallback lines ("The model did not produce an answer
in time", "I don't have enough context from the conversation"), total p95 15.7 s against ~4.5 s; prompts are
character-identical to e13. All slow turns fall between 15:50 and 16:15 UTC, when I was also running the E15 replay
(540 calls) on the same DeepSeek key. From here on no replay runs on that key while an app run is in progress.
Its cc score (8.28, 25 hard fails) is the provider's stall, not the build.
Also found by running the services suite (which I had not run after E12): `WtaActiveCodingProblem` failed because the
larger live window now carries a five-minute-old problem statement as speech; the test now excludes
"# Conversation so far" the way it already excludes transcript evidence, and still forbids it as the question.

## E16 — a turn that retrieves reads the whole profile and the whole pack whenever they fit, whatever the plan named
Written 2026-10-04, BEFORE any E16 code or measurement.

**Measured (er-dev-e13, cc; three runs of the candidate for stability).** 33 rows score under 7 in at least two of
three runs (about 150 of the ~344 points lost per run). Among them the planning misses E8 left out:
- ER-D-TI-024 (2.1 / 2.5 / 2.1): heard "How often are you carrying the pager these days…". Classified DOCUMENT_FACT; the
  plan names reference files, project files, coding samples, the job description and the meeting — not the RÉSUMÉ.
  The profile port's whole résumé is dropped by the planned-type gate and the answer presents another company's
  on-call checklist as the candidate's own rota.
- ER-D-LFW-015 (5.8 / 6.0 / 5.7): typed "why am I leaving lumenquay". Planned PROFILE_FACT only; the user's own
  interview-notes file (2,254 tokens, the whole pack) is not read; zero evidence items.
- 19 of the profile-mode turns with a profile loaded have no résumé in the prompt (mean 8.24 against 8.72 overall),
  among them LFW-009 (4.6), LFW-013 (5.5), LFW-023 (6.9), LFW-010.
E1/E13 made the pack reach every turn; E2 hands the résumé and job description over whole "on a turn that reads the
profile". The gap is a turn that retrieves SOMETHING ELSE: what fits is still filtered out for not being planned.

**Change (to be built on the candidate):** in `decide()`, when the turn retrieves and (i) the profile fits
(`wholeProfile`) and the mode's policy allows RESUME / JOB_DESCRIPTION, those types are added to the plan's source
types; (ii) a pack fits and the policy allows REFERENCE_FILE, REFERENCE_FILE is added. No claim is added (what the
evidence may SUPPORT is unchanged), and the item cap and token budget already grow with whole documents.

**Control:** er-dev-e13c (`cand/e13b`). **Candidate:** er-dev-e16, direct DeepSeek, cc judge, nothing else on the key.
**Rule (KEEP on the candidate branch):**
1. Profile-mode turns with a profile loaded and no résumé in the prompt: control (≈ 19) → at most 3.
2. Rows with every needed fact in the prompt: ≥ control + 1.
3. The profile-mode rows that gain the résumé: mean gain ≥ +0.5.
4. Profile modes (looking-for-work + technical-interview, 60 rows): mean ≥ control − 0.10; rows flagged
   `unsupported_personal_claim`, `wrong_profile_used` or `evidence_overload`: ≤ control + 2.
5. All rows: mean ≥ control − 0.10; hard fails ≤ control + 3 (a failure of only the hard-fail count triggers one repeat
   of the candidate; the count is then the mean of the two).
6. First word, median, profile modes: ≤ control + 150 ms.

### E15 — replay verdict (2026-10-04; 91 typed dev prompts, k = 2, cc; `replay-generator-judge.mjs effect --a e15-base --b e15-note2`)
| Rule line | Measured | Holds |
|---|---|---|
| 1. The ten listed rows: gain ≥ +0.5 | 8.314 → 8.725, +0.411 (±0.357) | no |
| 2. All 91 rows: note − base ≥ +0.05 | 8.875 → 8.720, −0.155 (±0.274) | no |
| 3. Hard fails (mean of k): note ≤ base | 6.0 → 9.0 | no |
**Verdict: not kept; not taken to the app.** The short note moves the answers it was written for (+0.41) and costs the
other 81 typed rows −0.22 with three more hard fails. The source on `cand/e15` (dea38e99) is left unbuilt and unmerged.
The reference arm (first wording) was not judged to the end: the batch was stopped to free the machine for the
baseline run; it decides nothing.

**Evin, 2026-10-04:** "you can increase the questions per mode instead of 30 if needed, no cap". The dev set's
resolution is the limit now (modes swing ±0.7 on 30 rows between runs of one build; E14 and E8 turned on one or two
hard fails). The set will be extended; see the next section.

### E11 correction — check on the clean run (2026-10-04; er-dev-e13c = `cand/e13b` 91de17d1, direct DeepSeek, nothing else on the key)
Heard hotkey-to-request in the document-grounded modes: p50 675 ms, p90 1,226 ms (m1 700 / 1,225; m1r 761 / 1,226;
e13 23 / 30). **The awaited rerank is back as on main.** First word: heard 1,508 ms, typed 898 ms (m1 1,484 / 899). No turn
over 5 s, no fallback answer. cc: 8.84, 17 hard fails; every needed fact in the prompt on 209 of 212 rows.
**er-dev-e13c is the dev baseline of the autopilot series** (er-dev-e13 8.72 / 19 was the same build without the two
corrections; the difference is inside run-to-run variation).

## dev2 — 360 more development items (2026-10-04)
Evin: "you can increase the questions per mode instead of 30 if needed, no cap". `datasets/dev2.json`: 40 items per
mode (15 grounded_single, 8 multi_source, 7 conflict_stale, 4 irrelevant_source, 4 missing_evidence, 2 followup), ids
`ER-D2-<PFX>-NNN`, on the SAME documents and manifest (sha 8aa245098a93, 104 evidence files). Written per mode by nine
agents that were given only AUTHORING-ER.md, AUTHORING-ER-DEV2.md and the mode's authoring folder, and told not to read
results, judgments or analysis; they read dev and holdout only to avoid repeats. Lint: 0 errors. Frozen 0886c10b084e;
dev, holdout and the two supp sets hash exactly as before. Development decisions are read on dev + dev2 (630 rows) from
here on; the holdout stays a confirmation set.
Known differences from dev, reported by the authors: the two profile modes spread `pi_state` over all seven values
(dev never used B-RESUME / B-JD) and run more items on the empty config; conflict items in call-center, general and
looking-for-work reuse declared conflicts from new angles (the packs declare few).

**E16 amended 2026-10-04, before any E16 measurement:** control = er-dev-e13c + er-dev2-e13c (`cand/e13b`); candidate =
er-dev-e16 + er-dev2-e16 (`cand/e16` on top of it); every line is read on the two partitions pooled. Line 1 becomes:
profile-mode turns with a profile loaded and no résumé in the prompt fall to at most 15 % of the control's count.

### E16 — judge-free lines and verdict (2026-10-05; er-dev-e16 + er-dev2-e16 = `cand/e16` e3cb8ba7 against er-dev-e13c + er-dev2-e13c; all four runs clean: direct DeepSeek, no turn over 5 s, no fallback answer)
| Rule line | Measured | Holds |
|---|---|---|
| 1. Résumé loaded but not in the prompt: ≤ 15 % of control | 24 → 4 of 103 (bar: 3) | no, by one |
| 2. Rows with every needed fact ≥ control + 1 | 490 → 488 of 499 | **no** |
| 6. First word, profile modes, median ≤ control + 150 ms | 882 → 869 ms (input tokens 10,909 → 11,230) | yes |
**Verdict by the rule: not kept as built** (lines 1 and 2; the judged lines were not read — the judging of the two E16
runs was stopped, they decide nothing).
What line 2 is made of: 4 rows GAINED their evidence (LFW-015, TI-024, D2-TI-002, D2-TI-006: the planning misses the
change was written for) and 6 LOST the job description (LFW-012, TI-014, TI-023, D2-TI-008, D2-TI-009, D2-TI-025).
Cause of the loss, from the traces: on "do I clear their experience bar? count it from my CV" the control's first
pass came back PARTIAL and a second pass, classified with DOCUMENT_FACT as well, admitted the job description; with
E16 the first pass already holds the whole résumé, answerability is FULL, there is no second pass, and the whole job
description — planned, retrieved — is removed by the claim-authority gate because it cannot evidence a personal-skill
claim. Whole MODE files are exempt from that gate since efc126a9; whole PROFILE documents are not.

### E16 — the four turns still without the résumé, and the three that never gained it (2026-10-05, read from the traces)
* D2-LFW-030 went down the FAST path with nothing planned; E16 widens only a plan that already retrieves. Not a target.
* LFW-015, TI-002, TI-011: résumé and job description planned (by E16), returned whole by the profile port, admitted,
  and absent from the evidence — the same claim-authority gate. One cause covers nine of the ten affected rows.

## E16b — whole profile documents are present whenever they are planned (rule written 2026-10-05, before the code)
**Change (on top of `cand/e16`):** the claim-authority gate in `legacy-retrieval-port.ts` keeps an item the profile port
handed over WHOLE (`PROFILE_RESUME` / `PROFILE_JOB_DESCRIPTION` with `wholeDocument`), exactly as it keeps a whole mode
file since efc126a9. Presence in the prompt only: `acceptedFor`, `evidenceSupportsClaim` and the claim pass are not
touched, so a job description still cannot SUPPORT a claim about the candidate.
**Risk the gate exists for:** a requirement from the job description answered as the candidate's own experience.
**Control** er-dev-e13c + er-dev2-e13c (`cand/e13b`). **Candidate** er-dev-e16b + er-dev2-e16b. Pooled, cc judge.
| # | Line | Bar |
|---|---|---|
| 1 | Résumé loaded but not in the prompt | ≤ 3 of 103 (control 24) |
| 2 | Rows with every needed fact in the prompt | ≥ 494 of 499 (control 490 + the four E16 gained) |
| 3 | Rows that gain the résumé: mean change | ≥ +0.5 |
| 4 | Profile modes: mean; rows flagged unsupported_personal_claim / wrong_profile_used / evidence_overload | ≥ control − 0.10; ≤ control + 2 |
| 5 | All rows: mean; hard fails | ≥ control − 0.10; ≤ control + 3 |
| 6 | First word, profile modes, median | ≤ control + 150 ms |
Every line must hold. Lines 3–5 need the judge; this time they are read whatever lines 1–2 say.
Unit tests before any app run: the shapes of D2-TI-009 ("count it from my CV … their experience bar") and TI-023 keep
the whole job description and a non-zero item count; efc126a9's claim-authority tests still pass.

## Autopilot baseline on 630 development rows (2026-10-05; `cand/e13b`, cc judge)
| Partition | Rows | Mean | Hard fails |
|---|---|---|---|
| dev (er-dev-e13c) | 270 | 8.843 | 17 |
| dev2 (er-dev2-e13c) | 360 | 8.722 | 31 |
| pooled | 630 | 8.774 | 48 |
772 points are lost in all; the 54 rows under 5 lose 333 of them. By condition: grounded_single 8.96, multi_source
8.51, conflict_stale 8.76, missing_evidence 8.12, irrelevant_source 9.14, followup 9.11. Heard 8.70, typed 8.91.
Every needed fact is in the prompt on 490 of 499 rows that need one; those 490 still hold 34 of the hard fails.
**The claim pass on these runs** (120 rows edited, draft and shown both judged): 8.19 → 8.11, hard 17 → 11.
missing_evidence 7.69 → 8.19 (hard 8 → 2); conflict_stale 8.48 → 7.37; multi_source 8.16 → 7.78; grounded_single
8.29 → 8.04. **Twelve of the edits added "given two ways … needs confirming": 8.39 → 6.11.** In each the documents
say which value is current (a version, an effective date, "supersedes") and the draft had given it: "30 days" became
"45 days in one, 30 days in another"; "$47 per van" became "$47 on the current price list and $42 on the earlier one".
The other 108 edits: 8.16 → 8.34.

## E17 — the claim pass names a conflict only when the material does not settle it (rule written 2026-10-05, before any replay)
**Change:** in `LIST_THEN_REWRITE` (claimVerifier.ts) the CONFLICT line asks for a conflict only when nothing in the
material says which value holds now (not when one is marked current / newer / later, or the other earlier / superseded
/ retired / draft, or one is the general rule and the other the specific case asked about); rule 3 adds that with no
conflict the pass does not add a second value or turn a stated value into something to confirm. Wording:
`replay-variants/e17-conflict.mjs`, fixed before the replay.
**Measured by** `replay-claim-pass.mjs` on every row of er-dev-e13c + er-dev2-e13c whose turn ran the pass, cap 96,000
(the app's), k 1: arm `e17-ctl` (the app's prompt) against arm `e17-conflict`. Both arms come from the replay; cc judge;
a text equal to the draft or to what the app showed reuses that judgment.
| # | Line | Bar |
|---|---|---|
| 1 | Replies in which the pass ADDS "two ways" | falls by at least 70 % against the control arm |
| 2 | conflict_stale rows: effect of the pass (shown − draft) | ≥ control arm + 0.30; hard fails ≤ control arm |
| 3 | All rows: effect of the pass | ≥ control arm; hard fails ≤ control arm |
| 4 | Rows flagged source_conflict_ignored or stale_source_preferred | ≤ control arm + 1 |
| 5 | missing_evidence rows: effect of the pass | ≥ control arm − 0.10 (the part of the pass that works is untouched) |
Every line must hold; then the wording goes into the app and is confirmed on the next app run with the other candidates.
