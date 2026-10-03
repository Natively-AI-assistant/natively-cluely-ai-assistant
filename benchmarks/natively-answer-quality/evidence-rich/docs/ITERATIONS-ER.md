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
