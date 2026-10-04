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
