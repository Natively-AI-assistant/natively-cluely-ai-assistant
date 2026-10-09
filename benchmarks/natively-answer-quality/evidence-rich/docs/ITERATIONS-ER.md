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

### E16b — result and verdict (2026-10-05; er-dev-e16b + er-dev2-e16b = `cand/e16b` b5684a62 against er-dev-e13c + er-dev2-e13c; direct DeepSeek, no fallback answer; 8 turns over 5 s to the first word against 0 in the control)
| # | Line | Measured | Holds |
|---|---|---|---|
| 1 | Résumé loaded but not in the prompt ≤ 3 of 103 | 24 → 1 | yes |
| 2 | Rows with every needed fact ≥ 494 of 499 | 490 → 497 (seven gained, none lost) | yes |
| 3 | Rows that gain the résumé: mean change ≥ +0.5 | n 23: 8.26 → 8.70, **+0.44** | **no** |
| 4 | Profile modes: mean ≥ −0.10; flagged rows ≤ control + 2 | n 140: 8.48 → 8.63; flagged 5 → 7 | yes |
| 5 | All rows: mean ≥ −0.10; hard ≤ control + 3 | 8.774 → 8.820; hard 48 → 45 | yes |
| 6 | First word, profile modes, median ≤ control + 150 ms | 882 → 950 ms | yes |
**Verdict by the rule: not kept** (line 3, by 0.06). Not landed; main is unchanged.
What line 3 is made of: 5 of the 23 rows rose by 4.8 to 7.5 points (TI-024, LFW-015, TI-027, D2-TI-002, D2-TI-006: the
turns that had no profile to answer from); 12 moved by less than half a point; 6 fell, four of them by 1.8 to 5.6
(TI-007 9.6 → 4.0 arithmetic and factual error; LFW-013 9.8 → 5.2 deferral on a conflict; LFW-009 7.7 → 4.9 unsupported
personal claim on a missing-evidence question; LFW-010 9.4 → 7.3; TI-011 9.7 → 7.9). Those were answered well without
the résumé and worse with it in view. One run each, so run-to-run variation is inside these numbers (same build, 30
rows: ± 0.7); the rule does not ask for a second run and none was made.
Autopilot paused here at Evin's word (2026-10-05). E17's rule and variant are committed; its replay was not started.

### E17 — note written 2026-10-05 11:30 UTC, after the replay and before any judgment of it
**E17 retests the idea of E6 v1** (2026-10-03: "a current document against an older one is not a conflict"). I wrote
E17's rule from the 630-row loss analysis without rereading E6, and found the overlap afterwards. E6 v1 was not kept
because its rule asked for a gain on ALL rows with an interval excluding zero (+0.06 ±0.08 on 333 rows); its other
lines held (hard fails 32 → 27, resolved conflicts +0.22, unresolved conflicts +0.71). E17 differs in wording (it also
names "the general rule against the specific case asked about", and rule 3 forbids adding a second value when there is
no conflict), in the set (630 rows of the build now on main, where the "two ways" edits cost 8.39 → 6.11 on twelve
rows), in the judge (Astra, the judge of record) and in the rule, which is built for a targeted change. The rule stands
as committed in 4d5866a7; nothing in it is changed by this note. Reported beside it, not part of it: the rows whose
oracle holds an UNRESOLVED conflict (E6's line 3), because that is where a weaker conflict line could do harm.
**Replay (judge-free):** the pass ran on 472 of the 630 turns; the rebuilt request equals the recorded one on 472 of
472 and every rebuilt system prompt matches its recorded hash. Edited: control arm 101, E17 arm 99. Edits that ADD
"two ways": 8 → 1 (line 1: −87.5 %, holds). Pass time p50 1,252 → 1,397 ms, p90 1,572 → 1,842 ms.
**Judge:** Astra only from here (Evin, 2026-10-05: "dont use claude code as judge since we are low on quota"; "judge
with astra as much as possible"). Astra reopened 11:00 UTC; calibration 38/38 on charter er1-ebec3e9a021e.

### E17 — how it is read under Astra, and a second sample (written 2026-10-05 11:20 UTC, before any E17 judgment is read)
* Astra's time is short (the pool has closed after about an hour in each batch), so only the rows where the two arms
  show DIFFERENT text are judged, both sides: 91 rows, 182 judgments. Rows where the arms show the same text differ by
  0 and are not judged. Denominators are the rows whose turn ran the pass (472; conflict_stale 77), as the rule says.
  Check: `ER_JUDGE=astra node evidence-rich/report/rule-e17.mjs`.
* **Second sample:** the same two wordings replayed on the drafts of er-dev-e16b + er-dev2-e16b (arms `e17b-ctl`,
  `e17b-conflict`) — other drafts of the same 630 questions. It is read with the same five lines. The rule's verdict
  is the first sample's, as committed. The second sample is confirmation: E17 goes into the app only if the second
  sample does not contradict it on line 3 (all rows: effect not below the control arm, hard fails not above). It also
  shows what E16b and E17 do together without an app run (disk: 3.2 GB free, no app run possible now).
* Judging order, three streams at once: the 23 rows of E16b's line 3 (both builds), the 182 E17 judgments, then the
  rest of E16b's two profile modes, then the second sample, then the other seven modes of the E16b pair.

### E16b — line 3 under Astra, the judge of record (2026-10-05 11:30 UTC)
The 23 rows that gain the résumé, both builds, judged by gpt-6-astra (charter er1-ebec3e9a021e, calibration 38/38):
**8.76 → 9.12, +0.36** against a bar of +0.5 (Claude Code judge: 8.26 → 8.70, +0.44). **The verdict stands: not kept.**
The two judges agree row by row: five rows rise by 3.3 to 6.3 (TI-024, TI-027, D2-TI-006, LFW-015, D2-TI-002), three
fall by 3.9 to 6.0 (TI-007 10.0 → 4.0 arithmetic_error; LFW-013 9.9 → 5.7 deferral; LFW-009 8.7 → 4.8
unsupported_personal_claim), fifteen move by less than one point. The rest of the pair was not judged by Astra: line 3
decides, and Astra's time went to E17.
What the falls are, for the next attempt: LFW-013's draft was right and the claim pass turned it into "I'll confirm a
number and come back" (replayed with E17's wording, the pass keeps the draft); TI-007 is an arithmetic slip in the
draft; LFW-009 is a personal claim attached to a question the profile does not answer — the caveat recorded with E2
(absent-fact questions get a nearby fact attached more often with whole documents in view).

### E17 — first sample, result and verdict under Astra (2026-10-05 11:38 UTC; arms e17-ctl / e17-conflict on the drafts of er-dev-e13c + er-dev2-e13c; the 91 rows where the arms differ, both sides judged; 472 rows whose turn ran the pass)
| # | Line | Measured | Holds |
|---|---|---|---|
| 1 | Edits that ADD "two ways" fall by at least 70 % | 8 → 1 | yes |
| 2 | conflict_stale rows: effect ≥ control arm + 0.30; hard fails ≤ control arm | **+0.08** on 77 rows (the 17 that differ: 8.15 → 8.52); hard 3 → 3 | **no** |
| 3 | All rows: effect ≥ control arm; hard fails ≤ control arm | +0.040 on 472 rows (the 91 that differ: 8.33 → 8.54); hard 15 → 10 | yes |
| 4 | Rows flagged source_conflict_ignored / stale_source_preferred ≤ control arm + 1 | 2 → 2 | yes |
| 5 | missing_evidence rows: effect ≥ control arm − 0.10 | +0.10 on 50 rows | yes |
**Verdict by the rule: not kept** (line 2). Not built into the app.
Beside the rule: the bar of line 2 was mine and asked for +0.30 averaged over all 77 conflict rows the pass ran on,
which the 17 rows that differ could only reach by gaining 1.4 points each; they gained 0.37. In this replay the control
arm adds "two ways" on 8 rows, where the app's own run added it on 12. No row with an unresolved conflict in its
oracle is among the 91. Twice now (E6 v1, E17) the same idea has removed five hard fails and moved the mean by a few
hundredths; whether a wording change with that profile is worth making is Evin's call, as recorded for E6.
The second sample (the E16b drafts) is being judged and is reported when complete.

### E17 — second sample under Astra (2026-10-05 12:03 UTC; arms e17b-ctl / e17b-conflict on the drafts of er-dev-e16b + er-dev2-e16b; 95 rows differ, all judged; 467 rows whose turn ran the pass)
Edits that add "two ways": 16 → 3. Line 2: +0.29 on 77 conflict rows (the 23 that differ: 7.24 → 8.20), hard 3 → 4:
no. Line 3: +0.069 on 467 rows, hard 10 → 10: yes. **Line 4: rows flagged source_conflict_ignored /
stale_source_preferred 1 → 5: no.** Line 5: +0.01: yes. By condition, rows that differ: conflict_stale +0.96,
irrelevant_source +0.64, grounded_single +0.29, missing_evidence +0.01, multi_source −0.16.
**E17 is not kept, and the second sample says why it should not be:** the wording trades the hedge for the opposite
error. With "do not add a second value", replies that had named the superseded value as superseded lose that clause
and are flagged for ignoring the conflict (CC-021 9.7 → 8.7, D2-CC-028 9.0 → 7.9), and one reply took the stale value
(D2-REC-025 5.2 → 2.9).

## E18 — the claim pass says whether a conflict is settled (rule written 2026-10-05 12:06 UTC, before any replay)
**Change:** the CONFLICT line ends with "settled: <the one that holds now>" or "open". Open: as today (neither value
asserted, "given two ways", needs confirming). Settled: the reply gives the value that holds now, corrects a draft that
gave the other, keeps a draft that gave the right one, leaves nothing "to confirm", and may name the earlier value in
one clause as no longer in force. Wording fixed in `replay-variants/e18-settled.mjs`. No app code reads the line.
**Measured by** `replay-claim-pass.mjs`, arm `e18` on the drafts of er-dev-e13c + er-dev2-e13c and arm `e18b` on those
of er-dev-e16b + er-dev2-e16b, each against the control arm already replayed on the same drafts (`e17-ctl`,
`e17b-ctl`). Astra; rows where the two arms show different text, both sides. **The two samples are pooled** (939 rows
whose turn ran the pass).
| # | Line | Bar |
|---|---|---|
| 1 | Edits that add "two ways" | fall by at least 60 % against the control arms (24 pooled) |
| 2 | conflict_stale rows that differ: mean change; hard fails | ≥ +0.5; ≤ control arms |
| 3 | All rows: effect of the pass; hard fails | ≥ control arms; ≤ control arms |
| 4 | Rows flagged source_conflict_ignored or stale_source_preferred | ≤ control arms + 1 |
| 5 | missing_evidence rows: effect of the pass | ≥ control arms − 0.10 |
| 6 | Pass time, p90 | ≤ control arms + 400 ms |
Every line must hold on the pooled samples. If it does, the wording is built into the app and confirmed on the next
app run.

### Astra batch of 2026-10-05, 11:00 – 12:05 UTC (65 minutes; closed with HTTP 402 on both keys)
Calibration 38/38. Judged in this batch: E16b's line 3 (46), E17's first sample (182), E17's second sample (190), 60
rows of the E16b pair's profile modes before that was stopped, and part of E10 (72 → 132 of 524 judgments; **three
turns have all four of their judgments, so E10 still has no Astra verdict**). Twelve calls at once gave "fetch failed"
on about a third of them; nine was fine; the retries at six were clean.
* **E16b: not kept** (line 3: +0.36 against +0.5). Confirmed by the judge of record.
* **E17: not kept** (line 2 on the first sample; line 4 on the second: conflict flags 1 → 5).
* **E18** (rule above): replayed on both draft sets, not judged. Judge-free lines: edits that add "two ways" 24 → 1
  (line 1 holds); pass time p90 1,572 → 1,743 ms and 1,570 → 1,753 ms (line 6 holds); rebuilt request equals the
  recorded one on 939 of 939. Rows where it differs from the control arm: 102 and 111; 220 judgments still needed
  (the control side is half judged already).
**Next batch:** `evidence-rich/results/astra-next.sh` — probe, calibration, then two streams: E18 on both samples, then
the rest of E10. Read with `ER_JUDGE=astra node evidence-rich/report/rule-e17.mjs --e18 [--sample-b]` (pool the two
by hand: the rule is on the pooled samples) and `ER_JUDGE=astra node evidence-rich/replay-repair-judge.mjs verdict`.
No app run is possible until the disk has about 6 GB free (3.2 GB now; other sessions' installs).

### E18 — result and verdict under Astra (2026-10-06 02:29 UTC; batch opened 02:00 UTC, calibration passed; arms e18 / e18b against e17-ctl / e17b-ctl; 102 + 111 rows differ, all judged; 939 rows whose turn ran the pass)
| # | Line (pooled over the two samples) | Sample 1 | Sample 2 | Pooled | Holds |
|---|---|---|---|---|---|
| 1 | Edits that add "two ways" fall by at least 60 % | 8 → 0 | 16 → 1 | 24 → 1 | yes |
| 2 | conflict_stale rows that differ: mean change ≥ +0.5; hard fails ≤ control | 21 rows +0.01; 3 → 5 | 25 rows +1.29; 5 → 5 | 46 rows +0.71; **8 → 10** | **no** |
| 3 | All rows: effect ≥ control; hard fails ≤ control | −0.046; 14 → 18 | +0.051; 13 → 16 | +0.002; **27 → 34** | **no** |
| 4 | Rows flagged source_conflict_ignored / stale_source_preferred ≤ control + 1 | 1 → 5 | 2 → 8 | **3 → 13** | **no** |
| 5 | missing_evidence rows: effect ≥ control − 0.10 | −0.05 | −0.03 | −0.04 | yes |
| 6 | Pass time p90 ≤ control + 400 ms | +171 ms | +183 ms | | yes |
**Verdict: not kept.** Told to decide whether a conflict is settled, the pass states one value as current and drops
the other; the judge of record flags that as a conflict ignored or a stale source preferred four times as often, and
hard fails rise by seven.
**Conclusion for the conflict line of the claim pass (E6 v1, E6 v2, E17, E18 — four wordings, three of them under
Astra or re-read by it):** every wording that lets the pass treat a conflict as settled raises the conflict-ignored
errors; the wording in the app ("given two ways … needs confirming") is the one Astra penalises least. The Claude Code
judge had scored that hedge at −2.3 on twelve rows; Astra does not see it that way (the 17–25 conflict rows that
differ gain 0.0 to 1.3, with new hard fails). **This line is closed: do not re-propose a conflict rewording.**

### The build on main, on the blind holdout, by the judge of record (2026-10-06 02:44 UTC; aggregates only)
er-holdout-e13 is the holdout run of `cand/e13` (main `efc126a9` plus the fixes pushed on 2026-10-05 as far as E13;
the two later corrections, which restored the awaited rerank, are not in this run). 180 rows, gpt-6-astra, charter
er1-ebec3e9a021e, calibration passed in the same batch.
| Blind holdout, Astra | Mean | Hard fails | Rows at 9.5 or more |
|---|---|---|---|
| Kept build before this work (er-holdout-base) | 7.725 | 42 (23.3 %) | 78 |
| E1 (er-holdout-e1) | 8.585 | 18 (10.0 %) | 100 |
| main on 2026-10-04 (er-holdout-m1) | 8.674 | 28 (15.6 %) | 109 |
| **main with the 2026-10-05 fixes (er-holdout-e13)** | **8.990** | **19 (10.6 %)** | **118** |
By mode, m1 → e13: call-center 7.68 → 8.30, general 8.91 → 9.31, lecture 8.90 → 9.20, looking-for-work 8.50 → 9.50,
recruiting 9.08 → 9.01, sales 7.98 → 8.93, seminar 9.54 → 9.42, team-meet 8.92 → 9.26, **technical-interview
8.54 → 7.98** (20 rows; one run each, and a mode moves ±0.7 between runs of the same build, but it is the one mode
that fell and the next thing to look at). The Claude Code judge gave the same run 8.759 with 14 hard fails: the two
series are not pooled.
Targets from the report's section 2 (9.2 mean, under 1 % hard fails): not met.

### E10 under Astra — partial (2026-10-06 02:40 UTC)
58 of 131 turns have all four judgments (every turn of er-dev-m1 and er-holdout-m1): cut 8.289 → whole 8.902
(+0.613 ±0.597), hard fails 10.5 → 7.0, needed-fact strings 134 → 169, first useful median 1,160 → 1,231 ms. All four
lines hold on these turns. The rest (er-dev-m1r, er-dev-m2) is being judged; the verdict is stated when it is whole.

### E10 — verdict under Astra, the judge of record (2026-10-06 03:10 UTC; all 131 turns, both repetitions, both arms)
| | cut (24,000) | whole (96,000) |
|---|---|---|
| Mean | 8.079 | 8.872 |
| Hard fails (mean of two repetitions) | 29.0 | 17.0 |
| Needed-fact strings in the reply | 314 | 378 |
| First useful text, median | 1,193 ms | 1,267 ms |
whole − cut = **+0.793 (±0.391)**. Lines 1–4 all hold. **Verdict: KEEP — confirmed.** The provisional verdict of
2026-10-04 (Opus: 7.896 → 8.773, hard 26 → 12) stands; E10 is commit `bc878adc`, on main since 2026-10-05.

### Astra batch of 2026-10-06, 02:00 – 03:16 UTC (76 minutes, about 900 judgments, three streams of three calls, no failed call until the pool closed)
Calibration passed. Judged, in this order: E18 on both samples (verdict: not kept), the blind holdout of the build on
main (8.990, 19 hard fails), E10 on all 131 turns (verdict: KEEP, confirmed), then as filler the dev runs of the build
on main (er-dev-e13c, er-dev2-e13c: the control every later candidate is read against under Astra) — partly judged
when the pool closed with HTTP 402 at 03:16 UTC; the drafts of the pass-edited rows were queued behind them and not
reached. Nothing new is kept from this batch; nothing was landed.
Standing by the judge of record: main with the 2026-10-05 fixes 8.990 on the blind holdout (was 8.674); E10 confirmed;
E16b, E17, E18 not kept; the conflict line of the claim pass is closed.

## E16c — E16b measured again, on the rows it changes, with repetitions (rule written 2026-10-06 04:00 UTC, before any replay)
**Why:** E16b missed one line of its rule (rows that gain the résumé: +0.36 under Astra against +0.5) on ONE app run
per build. Five rows rose by 3 to 6 points and three fell by 4 to 6; an arithmetic slip and a deferral are among the
falls, and one run cannot say whether they come from the résumé being in view or from the generator's own variation
(same build, same prompt: a row can move by several points between runs). Astra's dev scores of the build on main put
four of the eight weak Technical Interview rows down to the same cause E16b removes (no résumé in the prompt).
E16b's verdict stands as recorded. E16c is a new measurement of the same build (`cand/e16b`, on GitHub), with its own rule.
**What is measured:** the 80 development rows whose answer prompt differs by more than 200 characters between the
control runs (er-dev-e13c, er-dev2-e13c) and the E16b runs (er-dev-e16b, er-dev2-e16b): 60 grew, 20 shrank; 76 are in
the two profile modes. On the other 550 rows the two builds send the same prompt bar timestamps. For each of the 80
rows the generator is replayed twice on each build's RECORDED prompt (`replay-generator.mjs`, the app's own request;
arms `e16c-ctl`, `e16c-new`), and Astra judges the drafts, like with like (no post-answer pass in either arm).
| # | Line | Bar |
|---|---|---|
| 1 | Mean over the 80 rows of (new − control), each row the mean of its two replays | ≥ +0.25 |
| 2 | Hard fails (sum over rows of the share of a row's replays that hard-fail) | ≤ control |
| 3 | Rows whose two-replay mean falls by more than 1.5 | at most half the number that rise by more than 1.5 |
| 4 | Replays flagged unsupported_personal_claim or wrong_profile_used | ≤ control + 2 |
Judge-free lines already measured in the app and unchanged: résumé loaded but not in the prompt 24 → 1 of 103; rows
with every needed fact 490 → 497 of 499; first word in the profile modes +68 ms.
**If every line holds:** E16b is a keep candidate; Evin is told before anything is landed, and the claim pass's part
(LFW-013's deferral) is checked on the first app run. **If line 1 or 3 fails:** the falls are real and E16b is closed.

### E16b on today's main — the blind-holdout safety rule (written 2026-10-06 09:30 UTC, before either holdout run exists)
The disk has room again (43 GB), so the hour before Astra's next window is used for two app runs of the blind holdout:
**control `er-holdout-m3`** = main as it stands today (`73cf34e6`, which also carries other sessions' work since the
2026-10-05 fixes) and **candidate `er-holdout-e16b3`** = the same commit plus the two E16b commits (taken as patches
from GitHub: e3cb8ba7 and b5684a62 of the old history). One run each, direct DeepSeek, fresh profile, one app at a time.
The control also gives main's own number by the judge of record (the 8.990 run was the build just before the last two
corrections).
E16c decides whether E16b helps (rule above). The holdout is the SAFETY check, with margins from the measured
run-to-run variation (a set of 180: about ±0.16; one mode of 20: about ±0.7). Aggregates only.
| # | Line | Bar |
|---|---|---|
| 1 | Profile modes, turns with a résumé loaded and none in the prompt (judge-free) | at most a quarter of the control's count |
| 2 | Rows with every needed fact in the prompt (judge-free) | ≥ control |
| 3 | All 180 rows: mean; hard fails | ≥ control − 0.15; ≤ control + 3 |
| 4 | The two profile modes (40 rows): mean; rows flagged unsupported_personal_claim / wrong_profile_used | ≥ control − 0.30; ≤ control + 2 |
| 5 | First word, profile modes, median (judge-free) | ≤ control + 150 ms |
**E16b is a keep candidate only if E16c holds on every line AND this holds on every line.** Then Evin is told; nothing
is landed without his word. If E16c fails, the candidate's holdout is not judged (the control's still is).

### E16c — amended 2026-10-06 11:02 UTC, before any E16c measurement exists: the recorded runs are gone
At about 10:40 UTC the whole `.claude/worktrees/` folder of the repository was deleted by something other than this
session (with `release/` and the home backup folder; no local snapshot). Lost: every run folder (rows, recorded
prompts), every judgment file, the judge caches, the E16c replays, and the two holdout runs that were in progress.
What git held survives: the harness, datasets, oracles, the evidence files, this log and the id lists.
E16c is therefore measured on FRESH runs, same 80 ids (`results/replay/e16c-ids.json`), same rule, same two replays
per row and build: **control = today's main (`73cf34e6`), runs er3-dev-ctl + er3-dev2-ctl; candidate = today's main +
the two E16b commits (branch `cand/e16b-main`), runs er3-dev-new + er3-dev2-new**; the app is run on the 80 rows to
record each build's prompt, then `replay-generator.mjs` (arms `e16c3-ctl`, `e16c3-new`, k 2), Astra on the 320 drafts.
The control is today's main, not the 2026-10-05 build; both arms share it. The blind-holdout safety pair is run after
this if the window allows; its rule is unchanged.

### E16c — result and verdict under Astra (2026-10-06 11:48 UTC; fresh runs on today's main `73cf34e6` against `cand/e16b-main`; the 80 rows, two generator replays per row and build, 320 drafts; calibration 38/38 in the same batch)
Judge-free, from the app runs of the 80 rows: résumé loaded and none in the prompt 23 → 0 of 67; every needed fact in
the prompt 56 → 63 of 63; first word median 1,113 → 1,106 ms; no turn over 5 s and no fallback answer in either run;
the candidate's prompt differs from the control's by more than 200 characters on 79 of the 80 rows.
| # | Line | Measured | Holds |
|---|---|---|---|
| 1 | Mean of (new − control) ≥ +0.25 | 8.35 → 8.70, **+0.34** (95 % interval ±0.42) | yes |
| 2 | Hard fails ≤ control | 17.0 → 14.0 | yes |
| 3 | Rows falling by more than 1.5 ≤ half the rows rising by more than 1.5 | rise 12, fall 4 | yes |
| 4 | Replays flagged unsupported_personal_claim / wrong_profile_used ≤ control + 2 | 23 → 18 | yes |
**Every line holds.** What it says and does not say: with two replays per row the falls are a third of the rises and
the personal-claim flags go down, not up — the three falls of the single-run measurement do not repeat as a pattern
(TI-007, an arithmetic slip last time, rises here). The mean gain's interval still includes zero: 12 rows gain 2 to 6
points, 4 lose 3 to 6, 64 barely move. The blind-holdout safety rule decides the rest.

### E16b on today's main — the blind-holdout safety rule under Astra (2026-10-06 12:07 UTC; aggregates only)
Control er-holdout-m3 = main `73cf34e6`; candidate er-holdout-e16b3 = `cand/e16b-main`. One run each, direct DeepSeek.
Astra judged all 180 candidate rows and 150 of the 180 control rows before the pool closed (HTTP 402, 12:07 UTC); the
30 missing control rows are call-center 20, recruiting 8, seminar 2. Both profile modes are fully judged on both sides.
| # | Line | Measured | Holds |
|---|---|---|---|
| 1 | Résumé loaded, none in the prompt: at most a quarter of the control (judge-free, 180 rows) | 10 → 0 of 34 | yes |
| 2 | Rows with every needed fact ≥ control (judge-free, 180 rows) | 141 → 143 of 143 | yes |
| 3 | All rows: mean ≥ control − 0.15; hard fails ≤ control + 3 | on the 150 judged pairs 8.846 → 8.983; hard 20 → 16 | yes on 150 of 180 |
| 4 | Profile modes (40 rows): mean ≥ control − 0.30; flagged rows ≤ control + 2 | 8.32 → 8.63; flagged 6 → 5 | yes |
| 5 | First word, profile modes, median ≤ control + 150 ms | 1,237 → 1,286 ms | yes |
Line 3 is complete on 150 pairs. The candidate's 30 unpaired rows score 8.09 with 7 hard fails (candidate, all 180:
8.835, 23 hard). The hard-fail half of the line cannot fail whatever the control scores there (23 ≤ 20 + 3). The mean
half fails only if the control scores above 9.68 on those 30 rows, which are in modes whose prompt E16b does not
change. The 30 judgments are the first thing in the next Astra window; until then line 3 is stated as "holds on 150
of 180".
By mode, 150 pairs: looking-for-work 8.68 → 9.07, technical-interview 7.97 → 8.19, sales 7.67 → 9.02, lecture
9.55 → 9.53, recruiting 8.87 → 8.88, general 9.41 → 9.13, team-meet 9.32 → 9.03, seminar 9.37 → 8.97 (20 rows a mode,
one run each: a mode moves by about ±0.7 between runs of the same build).
**Standing: E16c holds on every line; the holdout safety rule holds on every line, line 3 on 150 of 180 pairs. E16b is
a keep candidate. Evin is told; nothing is landed without his word.** Main's own blind-holdout score by Astra, today's
main: 8.846 on the 150 rows judged so far.

### E16b landed on main (Evin, 2026-10-06: "Land and push")
Main `73cf34e6` → `e9f5ceef`, local and GitHub, as its two commits (`83d3962f` a retrieving turn plans the whole
profile and pack when they fit; `e9f5ceef` a résumé or job description handed over whole is not removed by the
claim-authority gate). The tree is identical to the measured candidate (`cand/e16b-main`). On a fresh build:
type-check clean; context-intelligence 1,882, intelligence 983, llm 5,828 tests pass; services 5,507 pass with the two
failures main already had (RetrievalScaleLexical:173, a todo; TrialCampaignIpc:97). Not run on Windows.
Still owed: the 30 control judgments of the holdout pair (next Astra window), which complete line 3 of the safety rule.

## Window of 2026-10-07 (~02:00 UTC) — plan written 2026-10-06 19:20 UTC
Evin: "start iterating again at 7:30 am till astra goes out again". Main is `f4cd986d` (E16b plus another session's
funnel fix). Every earlier development run is gone (2026-10-06), so the night is used for a fresh development
baseline of main: er4-dev-main (270) and er4-dev2-main (360), direct DeepSeek, fresh profile. Run data is copied to
`~/natively-er-backup/` (outside the repository) and rows and judgments are committed.
Astra, in this order (`results/astra-next4.sh`): a candidate's steps if one is ready → the 30 control rows left of the
holdout pair (line 3 of E16b's safety rule) → the 630 baseline rows → the drafts of the rows the pass edited.
The baseline under Astra is what the next candidates are chosen from and read against.

### E16b — the blind-holdout safety rule, complete (2026-10-07 02:20 UTC; all 180 pairs judged by Astra)
Line 3 on all 180 rows: 8.853 → 8.835, hard fails 22 → 23 (bars: ≥ control − 0.15; ≤ control + 3): holds. Lines 1, 2,
4, 5 as recorded. **Every line of the safety rule holds; E16b (on main since 2026-10-06) stands.** On the blind holdout
its effect is +0.31 in the two profile modes and nil overall; call-center moved 8.68 → 7.71 on 20 rows, one run each.

### Baseline of main `f4cd986d` on dev, first 184 rows under Astra (2026-10-07 02:22 UTC)
9.03, 20 hard fails. missing_evidence items are the weakest condition (18 rows, 7.28, 7 hard fails). Rows the claim
pass edited: 8.26 against 9.18 for the rest. On the worst of them the pass's own scratch line shows what happened:
* SEM-028 ("do we say anywhere what hardware it runs on or what it costs per building?"): the draft said neither is in
  the paper; the pass listed "there's no cost per building anywhere in the material" as UNSUPPORTED and removed it.
* TEAM-027 ("has legal signed off on the privacy wording?"): the pass listed "Nothing in the status notes or the risk
  register says legal has signed off" as UNSUPPORTED, removed it, and the reply reads as a status report (4.0).
* SALES-028: "I don't want to give you a number I haven't verified" and "let me confirm … and come back" listed as
  [self] and [promise] and removed; what is left opens with "The evidence doesn't state …" (4.0).
A statement that something is ABSENT from the material is being treated as a claim that needs a record.

## E19 — the claim pass does not list a statement of absence (rule written 2026-10-07 02:28 UTC, before any replay of it)
**Change:** the "Never list these" sentence of `LIST_THEN_REWRITE` also names a statement that the material does not
contain, state or settle something, and declining to give a figure they cannot verify. Wording fixed in
`replay-variants/e19-absence.mjs`.
**Measured by** `replay-claim-pass.mjs` on the 470 turns of er4-dev-main + er4-dev2-main whose turn ran the pass, arm
`e19` against the control arm `e19-ctl` (replayed before this rule, same bundle, requests identical to the app's on
470 of 470). Astra, the rows where the two arms show different text, both sides.
| # | Line | Bar |
|---|---|---|
| 1 | missing_evidence rows that differ: mean change; hard fails | ≥ +0.30; ≤ control arm |
| 2 | All rows that differ: mean change; hard fails | ≥ 0; ≤ control arm |
| 3 | Rows flagged with any unsupported_* or fabricated_* flag | ≤ control arm + 1 |
| 4 | Rows flagged important_question_unanswered or missed_available_evidence | ≤ control arm |
| 5 | Pass time, p90 (judge-free) | ≤ control arm + 300 ms |
Every line must hold. Then the wording is built into the app on a candidate branch, Evin is told, and it is confirmed
on an app run. The risk the rule guards: an invention slipping through dressed as a statement of absence (line 3).

### E19 — replay done, timing line read before any judgment (2026-10-07 02:26 UTC)
Arm `e19`: 470 of 470 requests identical to the app's bar the one sentence; edited 87 (control 90). 88 rows differ
between the arms (missing_evidence 35, conflict_stale 18, multi_source 17, grounded_single 10, irrelevant_source 6,
followup 2): 176 judgments. **Line 5:** the control arm had been replayed six hours earlier (p90 1,339 ms); replayed
again in the same quarter-hour as `e19` it gives p90 1,474 ms against 1,698 ms: +224 ms, holds. Pass time is read on
arms replayed together; that is the only reading that compares the wordings and not the provider's hour.

### E19 — result and verdict under Astra (2026-10-07 02:37 UTC; arm `e19` against `e19-ctl`, the 88 rows where they differ, both sides judged; calibration 38/38 in the same batch)
| # | Line | Measured | Holds |
|---|---|---|---|
| 1 | missing_evidence rows that differ: mean change ≥ +0.30; hard fails ≤ control | n 35: 8.19 → 8.63, +0.44; hard 8 → 5 | yes |
| 2 | All rows that differ: mean change ≥ 0; hard fails ≤ control | n 88: 8.29 → 8.68, +0.39; hard 12 → 7 | yes |
| 3 | Rows flagged unsupported_* or fabricated_* ≤ control + 1 | 11 → 6 | yes |
| 4 | Rows flagged important_question_unanswered / missed_available_evidence ≤ control | 21 → 18 | yes |
| 5 | Pass time p90 ≤ control + 300 ms (same-hour arms) | +224 ms | yes |
**Every line holds. E19 is kept by its rule.** By condition, rows that differ: missing_evidence +0.44, conflict_stale
+0.50, irrelevant_source +1.00, multi_source +0.10, grounded_single −0.27 (10 rows), followup +2.43 (2 rows). 14 rows
rise by more than 1.5, 5 fall.
**Prior art, found when the app's own test failed on the change:** on 2026-10-01 a general exemption for "an honest
limit" ("I can't confirm a credit on this call") was tried in every mode and taken back — the judge of that day scored
44 limit-stating drafts −0.02 (±0.24), and the pass stopped removing an invented process next to the limit. E19 is
narrower (what the MATERIAL does not contain; declining an unverifiable figure), is measured on 88 rows by Astra, and
the invention flags fall (11 → 6), which is the harm the earlier note recorded. The old test now pins both facts.
Built into the app: branch `cand/e19` (`73b18d97`, on main `bce8e47a`); type-check clean, llm suite 5,849 pass.

**App confirmation — rule written before the run (2026-10-07 02:43 UTC):** the candidate build is run in the app on
the 88 ids (runs er5-dev-e19, er5-dev2-e19); Astra judges the shown answers against the baseline's shown answers on the
same ids (er4 runs; one app run each, so the generator's own variation is inside it). Lines: (a) judge-free — every
pass request of the run carries the new clause; (b) mean ≥ baseline − 0.15; (c) hard fails ≤ baseline + 2.
If it holds, Evin is told and asked before anything is landed.

### E19 — app confirmation (2026-10-07 03:02 UTC; `cand/e19` 73b18d97 run in the app on the 88 ids, runs er5-dev-e19 + er5-dev2-e19; shown answers judged by Astra against the baseline's shown answers on the same ids)
| Line | Measured | Holds |
|---|---|---|
| (a) every pass request of the run carries the new clause | 90 of 90 (the recorded system-prompt hash equals the new wording's; 0 equal the old) | yes |
| (b) mean ≥ baseline − 0.15 | 8.499 → 8.616 | yes |
| (c) hard fails ≤ baseline + 2 | 12 → 7 | yes |
missing_evidence rows (35): 7.84 → 8.45. One app run each, so the generator's own variation is in these numbers; the
replay (same drafts, both wordings) is the cleaner measure and says +0.39 on these rows.
**E19 is a keep candidate: rule held on every line, app confirmation held on every line.** Evin is asked before it
is landed. Not measured: the blind holdout (the pass runs on about three quarters of turns there too); Windows.

### E19 — blind-holdout replay, rule written before the replay (2026-10-07 03:14 UTC)
Both wordings are replayed on the recorded drafts of er-holdout-e16b3 (main's code on the blind holdout; arms
`e19h-ctl`, `e19h`), Astra judges the rows where they differ, aggregates only. Lines: mean change ≥ 0; hard fails ≤
control arm; rows flagged unsupported_* or fabricated_* ≤ control arm + 1. If any line fails, E19 is not landed.

### Astra window of 2026-10-07, 02:01 – 03:14 UTC (73 minutes; three streams of three calls; no failed call until the pool closed)
Judged: the 30 control rows of the holdout pair; the whole development baseline of main `f4cd986d` (630 shown answers
and the 81 drafts of the rows the pass edited); E19's 176 replay judgments; E19's app confirmation (88 + baseline).
**Baseline of main under Astra, 630 development rows: 8.923, 71 hard fails (11.3 %), 414 rows at 9.5 or above.** By
condition: grounded_single 9.16, irrelevant_source 9.12, conflict_stale 9.02, multi_source 8.84, followup 8.63,
missing_evidence 8.04. By mode: general 9.18, lecture 9.10, looking-for-work 9.02, technical-interview 8.90,
recruiting 8.90, team-meet 8.88, call-center 8.85, seminar 8.84, sales 8.63. Heard 8.92, typed 8.93.
**The claim pass on main, by Astra** (99 rows it edited, draft and shown both judged): 8.23 → 8.47, hard fails 22 → 11;
multi_source 8.23 → 9.04, missing_evidence 7.69 → 8.10, conflict_stale 8.82 → 8.44, followup 8.11 → 6.41 (4 rows).
Of the 71 hard fails, E19 changes the reply on 12; 57 of the other 59 are answers the pass did not edit: the
generator's own errors with the facts in the prompt (major_factual_error 21, missed_available_evidence 20,
major_reasoning_error 10, arithmetic_error 8, unsupported claims 26).
**E19's blind-holdout replay** was run (132 passes, requests identical to the app's on 132 of 132; 25 rows differ) but
the pool closed (HTTP 402, 03:14 UTC) before any of its 50 judgments: it is first in the next window.

### Window of 2026-10-08 — E19 blind-holdout checkpoint (02:07–02:21 UTC; aggregates only)
Exact gpt-6-astra probe passed at 02:07 UTC. Calibration completed at 02:16 UTC: **38/38**, every returned model
exact gpt-6-astra. Used three streams, at most three calls per stream. Successful prior judgments were retained:
the requested shown-control stream needed no new calls; new draft judgments 3/3, replay candidate 17/20 and replay
control 12/14 succeeded, with zero returned-model mismatches. Five calls returned HTTP 403: the provider says its
resource is temporarily blocked for a possible content-policy violation. This is an access-block error, not the
usual quota exhaustion. No substitute judge, repeat submission of the denied calls, generator replay or app run
was started afterwards.

**Incomplete, not a keep/revert verdict.** 20 of 25 differing-text pairs are complete. Their aggregate mean is
8.3354 control → 8.27615 candidate (−0.05925, 95% interval half-width 0.59569); hard fails 3 → 3; rows carrying any
unsupported_* or fabricated_* flag 2 → 2. On this partial subset the mean line does not hold; the remaining five
pairs may change it. Do not extrapolate or declare the full rule failed/passed. All three prewritten lines still
must hold on the complete pair set. E19 stays off main, and landing still requires Evin's explicit approval.

Successful and failed-call receipts are committed in the three existing `.astra.jsonl` judgment files. Safe
aggregate checkpoint: `results/replay/e19h-checkpoint-2026-10-08.json`; no holdout questions, answers or judge
explanations were read to design a change. Outputs also copied to `~/natively-er-backup/judge-out/` before committing.
Next resume: inspect the provider's current access state through the existing exact-model probe after availability
is restored; do not bypass an access block. Resume only missing successful judgments via the existing saved plan
and `judge-er.mjs --blind`, and read aggregates only. `astra-next5.sh` is not safe to execute blindly: its blanket
staging/automatic commit lacks current attribution, and its failure detection covers quota but not this 403.

A read-only development exploration suggested inline component arithmetic as a possible E20. **Not declared,
implemented or measured.** The proposed commands, latency assertions and applicability must be verified against
the existing harness before a rule is written; no claim of zero first-word delay has been established. Existing
conflict-wording experiments remain rejected. No application code or platform-specific behavior changed in this
window; neither macOS nor Windows was physically tested.

### Judge-free exploration before the window of 2026-10-09 (development rows only; nothing here is a verdict)
Read from main's Astra judgments of er4-dev-main + er4-dev2-main (630 rows, 8.923, 71 hard fails):
- The pass ran on 470 rows and wrote "UNSUPPORTED: none" on 21 of the 34 answers capped for an invented detail
  (median 1.0 s on a 45,000-character prompt). **Tried, not declared, dropped:** a "CHECK:" line that makes the pass
  quote the material for each statement before it lists anything (two wordings, 52 drafts, arms `x20-check1`,
  `x20-check2`). It finds the flagged detail on about two thirds of the 24 capped drafts, and it edits 12 of 28
  drafts scored 9.5 or above: worked-out figures, conclusions drawn from stated numbers, statements of absence and
  questions are listed as "NOT STATED" and removed, and one careful two-values answer was rewritten into a flat
  assertion. Pass time p50 1.27 → 1.67–1.86 s, p90 1.56 → 2.11–2.41 s. Do not re-propose a per-statement check on this
  model without a way to protect inference.
- 13 answers contradict themselves (a verdict in the first sentence, the working ends elsewhere): 12 hard fails.
  **Tried, not declared, dropped:** a notice beside "# Today" asking for the deciding fact before the verdict
  (arms `gen-x20-base`, `gen-x20-v1`, 13 rows, k 4). It fixed two rows in 4 of 4 samples and turned a third, right in
  4 of 4 base samples, wrong in 4 of 4. About 1 % of rows are of this kind; an effect that size cannot be read on a
  replay of all 630 rows, so it is not worth a window.
- The gist chip repeats the body's error; it is the lone error on 3 rows. Not a lever.

## E20 — two dated versions of one document are not put to the other person as a conflict (rule written 2026-10-09 00:18 UTC, before the rail is applied to any holdout row)
**What was seen (development, in-sample):** of the 10 edits the control arm `e19-ctl` made under a CONFLICT line, the
6 whose line labels its values with a version or a date score 6.65 against 9.75 for their drafts; the 4 without such
labels 7.97 against 8.03, and two of those (CC-021, D2-CC-028) are the true two-document conflicts E17 broke.
**Change:** no wording changes (the conflict line stays closed to rewording, see E18). A rail on the pass's own output:
when its CONFLICT line labels EVERY value it names with a version number or an effective date, those labels differ,
and it listed nothing unsupported, the edit is dropped and the draft stands. Trigger fixed in
`replay-variants/e20-version-conflict.mjs` (`conflictIsBetweenVersions`), self-tested 9/9 before this was written.
**Why this is not E6/E17/E18 again:** those told the model to decide whether a conflict is settled, and it then
dropped or picked values on other rows. Here the model is asked nothing new; the pass runs as on main, and code keeps
the generator's draft on the rows where the pass itself labelled the two values as versions of one thing.
**Measured by** `derive-arm.mjs` (the rail applied to recorded pass outputs; no model call) and
`replay-judge.mjs effect`; Astra; a text equal to the draft or to what the app showed reuses that judgment.
| # | Line | Bar |
|---|---|---|
| 1 | Blind holdout (`e19h-ctl` → `e20h`), rows where the arms differ: mean change; hard fails | ≥ 0; ≤ control arm |
| 2 | Blind holdout: rows flagged source_conflict_ignored or stale_source_preferred | ≤ control arm |
| 3 | Judge-free, both sets: rows whose oracle holds an UNRESOLVED conflict and whose text the rail changes | 0 |
| 4 | Second development sample: the control pass replayed on the drafts of er5-dev-e19 + er5-dev2-e19 (another app run, 88 questions), arm `e20s-ctl` → `e20s`; rows that differ: mean change; hard fails; the two conflict flags | ≥ 0; ≤ control; ≤ control |
| 5 | Development, in-sample (`e19-ctl` → `e20`), reported for size, not a test | — |
Lines 1 to 4 must hold for E20 to be a keep candidate. A set with no row that differs makes its line vacuous, and
the report says so; with fewer than 5 rows that differ across lines 1 and 4 together, E20 is reported as "not harmful
on what could be measured", not as confirmed. Holdout: aggregates only. Nothing is landed without Evin.

### E20 — judge-free lines and verdict (2026-10-09 00:21 UTC; no Astra call spent)
The rail applied to recorded pass outputs (`derive-arm.mjs`): it changes 4 of 470 rows on the development arm
(`e19-ctl` → `e20`), 3 of 90 on the second development sample (`e20s-ctl` → `e20s`) and 2 of 132 on the blind
holdout (`e19h-ctl` → `e20h`; counts only).
| # | Line | Measured | Holds |
|---|---|---|---|
| 3 | Rows whose oracle holds an UNRESOLVED conflict and whose text the rail changes: 0 | development 0 of 4; second sample **1 of 3**; holdout 0 of 2 | **no** |
| 5 | Development, in-sample, for size | 4 rows, 6.35 → 9.71 (+3.36), hard 0 → 0, conflict flags 0 → 0; +0.02 on all rows | — |
**Verdict by the rule: not kept** (line 3). Lines 1, 2 and 4 were not judged: the rule cannot hold whatever they say.
The row that fails it (CC-021, second sample): the pass wrote "up to 5 business days [Account Verification Standard
v4.2] vs up to 3 business days [Password and Account Recovery Procedure v2.3]". Two different documents, each with its
own version number, both current: a true conflict the oracle wants surfaced, and the trigger reads it as two versions
of one thing. Version labels in the pass's line do not say whether the two values come from one document or two, so no
text rule on that line can separate the cases. What would: the identity of the source each value came from
(`source_id` / `version_id` of the evidence items), which the pass's line does not carry. Not pursued; the size of
the prize is about +0.02 on the development mean. **The conflict line stays closed, to rails on its text as well.**

### E19 — blind holdout, a second repetition of both arms (rule written 2026-10-09 00:21 UTC, before that replay exists)
Written knowing the first repetition's partial reading (20 of 25 pairs: 8.335 → 8.276, hard 3 → 3, invention 2 → 2),
and said so: this is not a second chance for the first rule. **The first rule's verdict stands as written, on its 25
pairs, and is reported first.**
Why a second repetition: the pass is not deterministic. The same draft gets a different edit on a second call, so one
replay of 132 passes shows one draw of which rows differ (25), and five more judgments cannot narrow a ±0.6 interval.
Both wordings are replayed once more on the same holdout drafts (`--k 2`: repetition 1 of arms `e19h-ctl` and
`e19h`, same bundle, same cap), Astra judges the rows where they differ, aggregates only.
| # | Line, on the two repetitions pooled (a pair = one row in one repetition) | Bar |
|---|---|---|
| 1 | Mean change | ≥ 0 |
| 2 | Hard fails | ≤ control arm |
| 3 | Rows flagged unsupported_* or fabricated_* | ≤ control arm + 2 |
| 4 | Pass time p90 of repetition 1, same-hour arms (judge-free) | ≤ control arm + 300 ms |
Reported beside the first rule's verdict, never instead of it. If the two disagree, Evin is told both. Nothing is
landed without him either way.

### E19 — second repetition replayed, judge-free lines read (2026-10-09 00:23 UTC; no judgment of it exists yet)
Repetition 1 of both arms on the holdout drafts: 132 passes each, requests identical to the app's on 264 of 264 (bar
the one sentence in arm `e19h`). Edited: control 24, new wording 27 (repetition 0: 23, 27). Rows where the arms
differ: 27 (repetition 0: 25); 54 judgments needed, 39 still to do. **Line 4:** pass p90 1,495 ms → 1,583 ms, +88 ms,
same quarter-hour: holds. Pooled, 52 pairs; 20 judged so far (all from repetition 0).
Tools added for this: `plan-pair.mjs` (which judgments a paired comparison still needs; counts only) and
`report/pair-aggregate.mjs` (aggregates over one plan or several pooled; no ids or text). Run on repetition 0 they
give the checkpoint of 2026-10-08 to the last digit (20 of 25, 8.3354 → 8.27615, ±0.5957).

### E19 — blind holdout, first rule read on all 25 pairs (2026-10-09 02:13 UTC)
Window of 02:02 UTC: probe answered as exact gpt-6-astra, calibration 38 of 38 (`calibration-astra-1791511846741.json`),
the five missing judgments sent (three new wording, two control), none failed, no wrong-model return, no access block.
Repetition 0, the 25 rows where the arms differ (aggregates only; `/tmp/er-e19h-aggregate.json`, copy in the backup):
| # | Line (rule of 2026-10-07) | Control | New wording | Holds |
|---|---|---|---|---|
| 1 | Mean change ≥ 0 | 8.105 | 8.135 (+0.031, 95 % half-width ±0.499) | yes |
| 2 | Hard fails ≤ control | 5 | 5 | yes |
| 3 | Rows flagged unsupported_* or fabricated_* ≤ control + 1 | 4 | 4 | yes |
**Verdict by the rule as written: holds. E19 stays a keep candidate.** What it does and does not say: on the blind
holdout the new wording did no measurable harm (the change is +0.03 inside ±0.50, hard fails and invention rows level).
It does not show the development gain (+0.39 on 88 rows) repeating there. The five late pairs moved the partial
reading of 2026-10-08 (20 pairs, −0.059, hard 3 → 3) to this one: both arms gained two hard fails among them.
Landing on main is Evin's decision; nothing is landed.

### E19 — second repetition judged, pooled rule read (2026-10-09 02:16 UTC)
Same window, same calibration. 39 judgments sent (20 new wording, 15 control, 4 drafts), none failed, no wrong-model
return, no access block. Aggregates only (`report/pair-aggregate.mjs`; copies in `results/replay/`).
| Reading | Pairs | Control | New wording | Change (95 % half-width) | Hard fails | Invention rows | Up ≥ 1 / down ≥ 0.5 |
|---|---|---|---|---|---|---|---|
| Repetition 0 | 25 | 8.105 | 8.135 | +0.031 (±0.499) | 5 → 5 | 4 → 4 | 2 / 3 |
| Repetition 1 | 27 | 8.208 | 8.615 | +0.407 (±0.558) | 4 → 3 | 3 → 2 | 5 / 3 |
| Pooled | 52 | 8.158 | 8.384 | +0.226 (±0.376) | 9 → 8 | 7 → 6 | 7 / 6 |
| # | Line (rule of 2026-10-09, pooled) | Measured | Holds |
|---|---|---|---|
| 1 | Mean change ≥ 0 | +0.226 | yes |
| 2 | Hard fails ≤ control | 8 vs 9 | yes |
| 3 | Invention rows ≤ control + 2 | 6 vs 7 | yes |
| 4 | Pass p90 of repetition 1 ≤ control + 300 ms | +88 ms | yes |
**Both rules hold; they do not disagree.** The first rule's verdict (above) is the one of record; this one sits
beside it. Limits, said plainly: the pooled interval still includes zero, so the holdout shows "no harm, probably a
small gain", not a confirmed gain; the two repetitions share the same 132 drafts, so the 52 pairs are not 52
independent questions; rows where the arms give the same text (about 105 of 132 per repetition) contribute no change,
so the effect on all 180 holdout questions is roughly +0.226 × 52 / (2 × 180) ≈ +0.03. No row with an unresolved
oracle conflict is among the 52. E19 remains a keep candidate on branch `cand/e19` (`73b18d97`); nothing is landed.

### Judge-free look for the next candidate, inside the window of 2026-10-09 (02:20–02:40 UTC; development rows only; no Astra call, no generator call)
Baseline of main `f4cd986d`, 630 rows. By condition: grounded_single 9.16 (21 hard of 232), multi_source 8.84 (16 of
126), conflict_stale 9.02 (9 of 108), irrelevant_source 9.12 (5 of 63), missing_evidence 8.04 (15 of 65), followup
8.63 (5 of 36). Three leads checked, none worth a rule:
- **"Says it is not in the material when it is."** Idea: give the claim pass one more sentence only on drafts that
  contain a denial. Of the 21 hard fails flagged missed_available_evidence, the draft contains a denial on 1 to 4.
  They are not denials; they are answers that use one source and leave out another. Dropped before any call.
- **Multi-source omissions.** 126 rows, 20 with a required fact missing from the answer (mean 7.53), but the oracle's
  fixed strings see only 5 of the 16 hard fails, so a generator notice could not be measured without the judge, and
  the 20 rows lose about 50 points between them (at most +0.08 on the mean if every one were fixed). The misses are
  different mistakes row by row (a wrong total, a wrong count of days, one panel slot left out). Not pursued.
- **Edits that remove a fact the draft had.** 5 of 99 edited rows (2 of them deferrals that score under 6); 1 edit
  adds one. Too few for a rail, and E19 already changes which of these the pass edits.
Also read: of 792 required facts with fixed strings, 73 have no string in the prompt, on 70 rows (mean 8.65); in 53
of those rows the answer has the value anyway, because it is a computed figure, not a retrieval miss. The 17 rows
where it is also missing from the answer (mean 6.04, 6 hard) are mostly Sales pricing sums and deferrals.
**Where this leaves the work:** missing_evidence is the weakest condition and is what E19 addresses. After E19 no
single cause covers more than about 1 % of rows; the rest is the generator's own mistakes with the facts in front of
it, at a setting (no thinking, fast model) Evin has chosen to keep. No further experiment is declared.

### E19 — landed on local main (2026-10-09 05:08 UTC)

Evin's word in chat: "do 1", answering "Land E19 on main?". Local `main` fast-forwarded `bce8e47a` → `73b18d97`
(one commit: `electron/llm/claimVerifier.ts`, a new test, one updated assertion). Files other sessions had changed in
the main checkout were not touched. **Not pushed**: GitHub `main` stays at `bce8e47a` until Evin says so.

Checked on a fresh build of `73b18d97` in worktree `er-main` (macOS, plain `node --test`, no app run):
- `typecheck:electron`: clean.
- The three claim-verifier test files and the two engine tests that read it: 111 pass, 0 fail.
- `electron/llm` and `electron/llm/codeVerification`: 6064 tests, 6036 pass, 0 fail, 28 skipped.
- `electron/intelligence` and `electron/context-intelligence`: 2917 tests, 0 fail.
- `electron/services`: 5730 tests, 5557 pass, 122 fail. The same suite on `bce8e47a` gives the same counts and the
  same 298 failing lines, none only on one side. They come from this way of running it (native modules built for
  Electron loaded by Node 25, and two files this worktree lacks), not from E19.

The change is one sentence of prompt text in shared code with no platform branch, so macOS and Windows get the same
text. Nothing was executed on Windows. No app run and no judging followed the landing; the evidence for E19 is the
replay, the app confirmation of 2026-10-07 and the two blind-holdout readings above.

**Pushed 2026-10-09 09:05 UTC.** Evin's word in chat: "push main to github". GitHub `main` had not moved (`bce8e47a`),
so the push was a plain fast-forward of the one commit: `bce8e47a..73b18d97`. Read back from GitHub: `73b18d97`.
Only `main` was pushed. `bench/evidence-rich` was not (GitHub `df815379`, local ahead from `99001d3b` on); that
push is still Evin's separate yes.

## Session of 2026-10-09, 10:00 UTC onward (new session, started from HANDOFF-ER.md)

### Baseline of main `73b18d97` (E19 included) — declared 2026-10-09 10:06 UTC, a measurement, no keep rule
No full run of main with E19 had been made or judged. Runs `er6-dev-main` (270) and `er6-dev2-main` (360): worktree
`er-main` clean at `73b18d97`, fresh profile, direct DeepSeek, started 10:06 UTC after another session's app had
exited (one app at a time). To be judged by gpt-6-astra in the next window (calibration first), shown answers then the
drafts of edited rows. It is compared with `er4-dev-main` + `er4-dev2-main` (main `f4cd986d`, 8.923, 71 hard fails) as
two single runs of two builds: run-to-run variation is about ±0.16 on 180 rows, so a difference of that order between
them says nothing about E19; E19's evidence stays the paired replay and holdout readings above.

### Failure-cause look at the last judged baseline (`er4-*`, main before E19; judge-free, before 10:11 UTC)
- The 71 hard fails hold 64 % of all lost points (435 of 679). The mean moves mostly by removing hard fails.
- Questions with a calculation oracle (131): 8.78, 16 hard (12 %); without (499): 8.96, 55 hard (11 %). Arithmetic is
  not a disproportionate class on these sets. The calculation notice reached 72 of the 131 (8.83, 9 hard) and not the
  other 59 (8.72, 7 hard): its trigger is a regular expression on the question's wording ("how much", "total", …) and
  misses dates ("when would I hear", "last day"), scores ("does that clear the bar") and follow-ups.
- Date and calendar arithmetic (21 rows whose oracle expression has a date): 7.84, 4 hard, 8 under 7. Read row by row,
  the first cause is the calendar on four (REC-005 business days, D2-SALES-011 thirty September plus 45 days given as
  15 November, D2-CC-014 a weekday "snag" that does not exist, D2-TEAM-040 not computed), a wrong start date taken
  from the résumé on two (LFW-020, D2-TI-009), and a document conflict on two. Four rows of 630.
- Both answers capped for wrong code (TI-015, D2-TI-033) are the same task, top-k words with a heap and a tie rule.
  The app's own code verification (`electron/llm/codeVerification`, extract → run → one correction) is switched off
  app-wide since 2026-07-18 (`verificationEnabled.ts`, "temporarily disabled"); it was not designed or measured here.
- `ER-D2-LFW-036` is capped at 2 by the deterministic profile-leak check while the judge reads the answer as right:
  to be checked as a possible defect of the check, not of the answer.

## X1 — whole-pack threshold, 12,000 against 24,000 and 48,000 (plan and lines written 2026-10-09 10:11 UTC, before any run)
Evin's pick #6 of 2026-10-04 ("Test 24k and 48k first"), never started. The frozen sets cannot show it: every pack is
under 12,000 estimated tokens. This is a separate controlled condition on synthetic probe files outside the frozen
corpus (`limits/probe.mjs ref-threshold`, added today; `ref-count` for several files).

**Build.** An experiment branch from main `73b18d97` whose only change is that `WHOLE_PACK_MAX_TOKENS` is read from an
environment variable (default 12,000). It exists to run three arms on one build; it is not a landing candidate.
**Arms.** 12,000 (main), 24,000, 48,000. General mode, spoken (hotkey) and typed, direct DeepSeek, one app at a time.
**Files.** One file whose size, as the app estimates it, is 11,900 / 12,100 / 16,000 / 23,900 / 24,100 / 32,000 /
47,900 / 48,100. Seven uniquely named facts at 0, 10, 25, 50, 75, 90 and 99.5 %; two figures to add at 20 % and 85 %;
a value stated in March at 30 % and replaced in September at 80 %. Ten turns per size: seven named facts, one list of
all seven, the sum, the current value. Several files: 6 files of 2,100, 4,000 and 7,900 (one named fact each).
**Recorded per turn, judge-free:** fact sentence in the request; answer correct by exact string; draft correct;
whether the fix-up pass changed the text; request size and provider prompt tokens with cache hits; time to the first
word and to the end; resident memory of the app's processes (macOS `ps`).

**Lines for calling a higher threshold T worth proposing**, read on the sizes above 12,000 and at most T, against the
12,000 arm on the same sizes:
1. The list question gives at least 6 of the 7 facts on every such size.
2. The sum is right and the current value is given (never the March value alone) on every such size.
3. Named facts: on no size fewer right answers than the 12,000 arm.
4. Spoken turns: median time to the first word over those sizes at most 400 ms above the 12,000 arm, and no turn over
   5 s to the first word.
5. The fix-up pass (its material is capped at 96,000 characters): no more final answers that lost a correct fact their
   draft had than in the 12,000 arm.
6. No error, timeout or provider refusal in the arm.
If 1 to 3 hold and 4 or 5 does not, it is reported as an accuracy gain with its cost, not as a proposal. Whatever the
outcome nothing lands from X1: a change of the default would need a quality run on realistic packs above 12,000,
which do not exist yet, and Evin's word.

### Deterministic checks, version obj-2 (2026-10-09 10:12 UTC): a string the mode's own files state is not a profile leak
`objective.mjs` flagged any identity string of a profile that is not the loaded one as `pi_leak` or
`wrong_profile_used`. In Looking for work with no profile loaded, the candidate's own prep notes are still loaded and
name his employers. `ER-D2-LFW-036` ("the job before your current one, why did you leave that?") has an oracle that
requires the Tessarine answer from those notes; the answer gave it, Astra scored it 10 with the remark that the string
check contradicts the answer, and the check capped it at 2. The oracle and the question are unchanged. The check now
skips a string that the files of the row's own evidence configuration state; `OBJECTIVE_VERSION = 'obj-2'` is written
into every new check result (results without a version are obj-1).
Re-applied to stored judgments without a judge call (`report/rescore-objective.mjs`): baseline of main `f4cd986d`,
630 rows: 8.923 / 71 hard as stored, **8.935 / 70 hard under obj-2** (one row changes, 2 → 10). The E19 app rows
(88) and the blind holdout of main (180, aggregates only): no row changes. From here on a comparison with that
baseline quotes the obj-2 figure, and says so.

## E21a — the calculation step on calculation questions that do not get it (rule written 2026-10-09 10:16 UTC, before any replay of it)
**Seen.** On the last judged baseline 59 of the 131 questions whose oracle needs a calculation carried no calculation
notice: its trigger is a list of quantity words in the question ("how much", "total", "per month" …), so a date
counted from another date, a length of service, a weighted score and most follow-ups never get the hidden working
step. Three of the hard fails on those rows are a miscount with the right figures in the prompt (REC-005 business
days, REC-008 weighted score 2.95 for 3.15, D2-SALES-011 fifteenth for fourteenth of November).
**Hypothesis.** Giving those turns the existing step makes more of them right, because the same step took quantity
questions from 23 to 43 right samples of 54 when it was introduced (2026-09-30). It is not a new model call and not
reasoning: the working is written first in the same stream and removed before display.
**How it could make things worse.** The first visible word waits for the working (on main, turns with the notice
show their first word about 200 ms later at the median); the model may write a block for a plain lookup; a block may
set the sum up wrongly and the answer follow it.
**This stage is an upper bound, not a build.** The notice is placed by hand on the recorded prompts of exactly the
rows that need it. If it does not help there, no trigger is worth writing. If it does, the trigger is a second stage
with its own rule (which questions it fires on, what it costs on those that need no calculation).
**Measurement.** Generator replay (`replay-generator.mjs`, direct DeepSeek, deepseek-flash, temperature 0.2, seed 7,
thinking off, the app's request) on the recorded prompts of the fresh baseline of main `73b18d97`
(`er6-dev-main`, `er6-dev2-main`): every row with a calculation oracle whose recorded prompt has no
"# Calculation" section (`report/rule-e21.mjs select`). Arms, 4 samples each: `e21-base` (prompt as recorded),
`e21-n1` (main's notice text, unchanged, placed after "# Today" where the composer puts it), `e21-n2` (the same
with dates, lengths of time and weighted scores named and one sentence on counting them; examples use figures that
are in no benchmark document). All three arms in the same hour; nothing else on the DeepSeek key.
**A sample is right** when the deterministic calculation check finds the oracle's result in the shown text. No judge.
**Lines, each arm against the base** (`report/rule-e21.mjs read`):
1. Right samples rise by at least 8 percentage points, and the 95 % interval of the paired change (bootstrap over
   rows) is above zero.
2. At most 2 rows fall from at least 3 of 4 right to at most 1 of 4.
3. First visible character: median at most 500 ms later, slow end (p90) at most 900 ms later.
4. Samples containing a forbidden string (an outdated or other entity's value): at most base + 2.
If both arms hold, n1 is preferred (no new wording). If neither holds, the trigger is not widened and this is closed.
Nothing lands from this stage.

### A challenge set for the classes that remain (declared 2026-10-09 10:18 UTC; nothing measured on it yet)
The development sets have been read for a week and each remaining failure kind has too few rows in them to measure a
fix. A supplementary set is being authored on the same frozen documents (`AUTHORING-ER-CHALLENGE.md`): per mode 12
items the engineer may read (`authoring/<mode>/challenge.json`, ids `ER-C1-…`, dataset `challenge`) and 6 that
stay unread as its validation part (`authoring-holdout/<mode>/challenge-val.json`, ids `ER-CV1-…`, dataset
`challenge-val`, aggregates only). Kinds: calculation from two or more documents, dates and times counted from
document rules, which value belongs to which thing, version conflicts (one settled, one open), absent policy /
company / personal facts, follow-up chains, and in Technical Interview code with executed tests. Every item must be
checkable by fixed strings or executed tests, so a class can be measured with repetitions and without the judge.
Authors are three agents that have not seen any product answer or analysis, three modes each. `build.mjs` lints and
freezes the two new datasets beside the existing ones; the existing datasets' hashes must not change (to be checked
at the freeze). dev, dev2 and holdout are untouched.

### Deterministic checks, version obj-3 (2026-10-09 10:57 UTC, before any E21a replay output is read): a number matches as a whole number
Needles were matched as plain substrings, so "October 20" was found inside "October 2026", "4 days" inside "24 days"
and "600" inside "1,600". An author of the challenge set reported the trap. Now a needle that starts or ends with a
digit is skipped where a digit touches it, or where a separator joins it to more digits on its left. A separator on
its right is left alone on purpose: authors write "198" for "$198,000" and "199.1" for "199.1k". (A first, stricter
form that also refused "198" before ",000" was tried on stored rows, found to reject intended matches on two items,
and narrowed before use.) Re-applied to 1,336 stored rows of six runs: one check result changes (`ER-D-REC-019` on
the old baseline: "calculation result stated" was a false pass through "4 days" inside "24 days"), and **no official
score or hard-fail flag changes** in any judged run, development or holdout. The baseline of `f4cd986d` stays
8.935 / 70 hard under obj-3. E21a's "a sample is right" is read with obj-3.

### E21a — replay done, judge-free lines read (2026-10-09 11:06 UTC; no judgment of it exists)
Three arms on the recorded prompts of `er6-dev-main` + `er6-dev2-main`, 59 rows × 4 samples, replayed 10:59–11:05
UTC with nothing else on the DeepSeek key, 0 failed calls. Checks obj-3.

| Arm | Right samples | Paired change (95 % interval) | Rose / fell | First visible character, median / p90 | Wrote a block | Forbidden-string samples | Lines |
|---|---|---|---|---|---|---|---|
| `e21-base` (as recorded) | 173 / 236 (73.3 %) | | | 794 / 1,017 ms | 0 | 2 | |
| `e21-n1` (main's notice) | 196 / 236 (83.1 %) | +9.7 points (4.2 to 16.1) | 4 / 0 | 989 / 1,292 ms (+195 / +275) | 127 / 236 | 5 | line 4 fails (5 > 2 + 2) |
| `e21-n2` (dates, time, scores named) | 200 / 236 (84.7 %) | +11.4 points (5.1 to 18.6) | 5 / 0 | 1,071 / 1,381 ms (+277 / +364) | 151 / 236 | 4 | **all four hold** |

Rows that rose under n2: REC-008 (weighted score), SEM-014, CC-013, D2-SALES-011 (the 45-day claim date), D2-TEAM-019.
No row fell in either arm. The forbidden-string samples are D2-LEC-025 in every arm (3 of the 4 under n2, 2 in the
base) and one sample of SALES-013; n1 adds one of D2-SALES-026.
**Reading.** The hidden working step makes calculation questions that do not get it today right more often, at
about a quarter of a second to the first visible word on those turns. n2 is the arm that holds every line. This was
an upper bound with the notice placed by hand: nothing is built and nothing lands. Two things follow, each with its
own lines written before it is measured: Astra's reading of the same drafts (below), and stage two, a trigger that a
build could use, with its cost on turns that need no calculation.

### E21a — Astra's reading of the same replay (lines written 2026-10-09 11:06 UTC, before any judgment of it)
The replayed texts are drafts in both arms (no later pass), so they are compared like with like. Samples k0 and k1 of
`e21-base` and `e21-n2` on the 59 rows are judged one answer at a time, arm unknown to the judge
(`replay-generator-judge.mjs prep`, derived runs `rg-e21-…`), after the baseline's 630 shown answers and in the same
window if the ration lasts. Pairs = row × sample (118).
1. Mean change n2 − base at least +0.15.
2. Hard fails in n2 at most those in base.
3. Samples flagged `arithmetic_error` or `pricing_error` in n2 at most those in base.
If the ration closes early, a complete k0 (59 pairs) is read as a partial reading and said to be one. A line that
fails closes E21 whatever the string counts show.

### Challenge sets frozen (2026-10-09 11:07 UTC; nothing has been run on them)
Authored by four agents that saw no product answer, no judgment and no analysis; lint 0 errors.
| Dataset | Items | Hash | Read by the engineer |
|---|---|---|---|
| `challenge` | 117 (13 per mode: 11 single items and a two-turn chain) | `bb2bad267b68` | yes |
| `challenge-val` | 54 (6 per mode) | `c62fc30c2094` | **no**: aggregates only, like the holdout |
| `code1` | 36 Technical Interview coding items, 485 executed tests, 8 two-turn chains, 6 with a complexity string | `da9562e2ed45` | yes |
dev, holdout, dev2 and the two supplementary sets keep their hashes; every existing dataset and oracle file is
byte-identical before and after the freeze, and `build.mjs verify` passes (104 files, 8 datasets).
Kinds per mode in `challenge`: 3 calculations from two or more sources, 2 dates or times counted from document rules,
2 "which value belongs to which thing" (two coding items with tests in Technical Interview), 2 version conflicts (one
settled, one open), 2 absent facts, one follow-up chain, and one counterfactual pair (the same question under two
configs with different right answers). Authors' notes worth keeping: Lecture items state the date they count from;
where a pack has no two current documents that disagree, the open conflict sets a document against what was just
said in the conversation (Looking for work, Technical Interview) or uses the mode's existing conflict config; in
`code1` a solution that times out is recorded by the harness as "not executed", not as failed, so timeouts are
counted separately when it is read.

## E21 stage two — what a trigger would cost (rule written 2026-10-09 11:10 UTC, before any replay of it)
Stage one showed the step helps where a calculation is needed. A build cannot know that in advance. The trigger on
main reads the question's wording and misses 59 of 131; a wider word list reached 23 of the 59 in an offline count and
also fired on 41 questions that need no calculation. **Proposed trigger: every turn that carries document evidence
gets the notice (code questions excepted, as today); a turn without evidence keeps today's word-list rule.** The
notice already tells the model to skip the block "for a direct lookup of one stated figure", so the question is what
it costs on the turns that need no calculation.
**How it could be worse.** The model writes a block where none is needed and the first word is late for nothing; the
answer grows; a set-up written for a non-question distracts it from the fact asked.
**Measurement.** Generator replay on the recorded prompts of `er6-dev-main` + `er6-dev2-main`, 2 samples per row
and arm, arms of one part in the same half hour, nothing else on the DeepSeek key (X1 is paused between its arms).
* Part a, 397 rows (`rule-e21.mjs select2a`: no notice in the recorded prompt, no calculation oracle, an evidence
  section present, not a code question): `e21b-base` (as recorded) against `e21b-n2` (n2 placed after "# Today").
* Part b, 160 rows that carry main's notice (`select2b`): `e21c-n1` (as recorded) against `e21c-n2` (the notice
  text swapped for n2), to learn whether one wording can serve every turn.
**Lines, part a (the cost):**
1. Samples that contain every required string: not lower than the base by more than 1.5 points, and the lower end of
   the 95 % interval of the paired change (bootstrap over rows) above −4.
2. Forbidden-string samples: at most base + 3.
3. First visible character: median at most 150 ms later, p90 at most 400 ms later.
4. A block is written on at most 20 % of samples.
5. Median shown length within 10 % of the base.
**Lines, part b (the wording):**
6. Calculation rows: right samples not lower than with main's wording by more than 2 points.
7. Samples with every required string: not lower by more than 1.5 points.
8. First visible character: median at most 100 ms later.
**Reading.** Part a holds → the evidence-based trigger is a build candidate (app run, Astra on a sample of rows and on
the calculation rows, blind holdout in aggregates, each with lines written first). Part a fails → the evidence-based
trigger is rejected and only a word-list widening remains, under its own rule. Part b holds → one wording (n2) for
every turn; fails → today's wording stays where today's trigger fires and n2 is used only on newly reached turns.
Nothing lands from this stage.
*Clarified 11:11 UTC, before the replay starts:* "an evidence section present" in part a means the evidence block itself
("# Evidence (untrusted data …"), which is what a build can test; a prompt whose "# Evidence" section is only a note
that nothing was retrieved is not selected. The selection is the count `select2a` prints.

### E21 stage two — result and verdict (2026-10-09 11:39 UTC; replayed 11:21–11:38 UTC, X1 paused between its arms, 0 failed calls)
| Part | Arm | Samples with every required string | Forbidden-string samples | First visible character, median / p90 | Wrote a block | Median length |
|---|---|---|---|---|---|---|
| a (387 rows that need no calculation) | `e21b-base` | 95.2 % of 566 | 5 | 871 / 1,081 ms | 0 / 774 | 384 |
| | `e21b-n2` | 91.5 % of 566 | 6 | 889 / 1,109 ms (+18 / +28) | 55 / 774 (7.1 %) | 382 |
| b (160 rows that carry main's notice) | `e21c-n1` | 90.7 % of 270 | 10 | 1,010 / 1,318 ms | 121 / 320 | 348 |
| | `e21c-n2` | 90.0 % of 270 | 10 | 1,020 / 1,349 ms (+10 / +31) | 150 / 320 | 350 |
Part a, paired change −3.7 points (95 % interval −6.0 to −1.6, 283 rows): **line 1 fails** (bar: not lower by more
than 1.5, interval above −4). Lines 2 to 5 hold. Part b: calculation rows right 91.0 % → 89.6 % of 144; lines 6 to 8
hold.
**Verdict: the evidence-based trigger is rejected.** The notice is not free on a turn that needs no calculation: the
model seldom writes a block there (7 %) and the first word is not late, but the answer leaves out a required fact
more often. That is a finding about the notice itself, on main too: its word-list trigger also fires on 88
development questions that need no calculation.
What remains of E21, each to be decided on its own lines before any further measurement: (i) a word-list widening
for dates and scores, which reached 23 of the 59 and also 41 questions that need no calculation in the offline count
of 10:15 UTC, so its net effect on these sets is of the order of one or two rows; (ii) the opposite question, whether
main's trigger fires too widely. One wording (n2) can serve every turn that gets the notice (part b).

## E21 stage three — a lighter notice for turns the word list does not reach (rule written 2026-10-09 11:40 UTC, before any replay of it)
**Seen in stage two.** On the 387 turns that need no calculation the n2 notice wrote a block on only 7 % of samples and
did not delay the first word, yet six rows lost a required fact in both samples and none gained one. Read: an uptime
commitment that the base states became "I'll confirm the exact uptime commitment"; a retention period and an exam
rule switched to the other document's value. No block was written on any of the six. The notice carries three
sentences written for disputed amounts ("use only numbers stated above", "work out what the stated facts allow and
compare the two", "if the numbers do not reconcile, say so plainly") and the answers move toward doubt.
**Hypothesis.** A notice without those sentences, ending "if the answer is a fact stated above, there is nothing to
work out: answer as you otherwise would, with everything the question needs", keeps the gain on calculation turns and
does not cost on the others. `replay-variants/e21-notice-v3.mjs` (n3).
**How it could be worse.** Without the comparison sentence the gain on disputed-amount turns may shrink; the last
sentence may make the model skip a block it needs.
**Measurement.** As stage two, after X1 has finished, nothing else on the DeepSeek key, arms of a part back to back.
* Part c, the cost: the 387 rows of part a, 2 samples: `e21d-base` (as recorded, run again) against `e21d-n3`.
  Lines 1 to 5 of stage two, unchanged.
* Part d, the gain: the 59 rows of stage one, 4 samples: `e21d-cbase` (as recorded, run again) against `e21d-cn3`.
  Lines 1 to 4 of stage one, unchanged.
**Reading.** Both parts hold → build candidate: a turn that carries document evidence and that the word list does not
reach gets n3; a turn the word list reaches keeps main's notice word for word (so nothing changes where the notice
fires today). One part fails → E21 is closed without a build; the finding that stays is stage one's (the step helps
where it is needed) and stage two's (it costs where it is not).

### Astra window of 2026-10-09, 11:02 UTC — closed by a provider access block after 43 judgments (recorded 11:41 UTC)
Probe: no answer at 10:58, exact gpt-6-astra at 11:02. Calibration 11:02–11:10 UTC: **38/38**, every returned model
exact gpt-6-astra (`calibration-astra-1791544238581.json`). Judging of the baseline of main `73b18d97`
(`er6-dev-main`, three streams of three calls) began 11:10:48. At 11:12:58 three calls in flight returned **HTTP 403**
(the provider's access block, not the 402 ration); the guard stopped every further call at once. Nothing was retried,
and no key, route or content was changed. 43 new judgments exist, plus 6 answers identical to the 7 October run that
came from the judge cache: 49 of 630 (general 13, technical-interview 18, team-meet 16, recruiting 2).
**There is no score for main with E19 from this window.** 49 rows are not a reading and are not quoted as one. The
E21a drafts were not sent. The flag `/tmp/er-access-block-20261008-1630.json` is left in place; it is removed only
after a clean probe by hand in a later window. This is the second block in three days (2026-10-08 02:07 UTC window,
five calls); the window of 2026-10-09 02:02 UTC had none.
To finish in the next window (about 02:00 UTC): `node <scratchpad>/window-er6.mjs` with `ER_SKIP_RUN_WAIT=1` (copy in
`~/natively-er-backup/scripts/`), then `window-e21.mjs`; both judge only what is still missing.

### X1 — a flaw in the probe, found on the 12,000 arm and corrected before any other arm is read (2026-10-09 11:43 UTC)
The 12,000 arm ran 11:07–11:21 UTC (160 turns, no error). Above the threshold its list question shows 2 or 3 of the 7
fact sentences in the request and 7 of 7 codes in the answer on 15 of 16 sizes. The list was asked after the seven
named-fact turns of the same session, so the answer came from the conversation, not from the file. Those list rows
measure nothing about the file and are **not used in any arm**. The named-fact, sum and current-value rows are not
affected (each asks about something no earlier turn stated).
Correction, the same for all three arms: a separate pass (`ref-threshold --kinds list`, file
`threshold-fresh-…jsonl`) asks the list question in a fresh session straight after the upload, spoken and typed, at
every size. Line 1 of the X1 plan is read from that pass only. The main pass keeps its procedure for the two arms
still to run, so the three arms stay alike.

### Failure-cause map of the last fully judged baseline (main `f4cd986d`, before E19; written 2026-10-09 11:44 UTC)
The fresh run of main with E19 could not be judged today (the access block above), so the map is of `er4-*`, the
last run with all 630 answers judged by Astra. Each of the 71 hard-failed answers is put under its FIRST cause, read
from the judge's stated problem, the answer, the oracle and, for edited answers, the judged draft. One cause per row;
the engineer's reading, not a judge output. E19 has since changed the reply on 12 of these rows.

| First cause | Rows | Modes | Examples | In the prompt? | Mitigation today | Candidate | Cost / risk |
|---|---|---|---|---|---|---|---|
| Invented company, policy, research or meeting fact (the brief's H, I) | 15 | call-center 4, sales 4, seminar 4, team-meet 2, recruiting 1 | CC-029 "they'll restore it to you"; D2-SALES-035 denies a driver app the material is silent on; D2-SEM-040 invents two findings | the true facts are; the invented one is absent | the fix-up pass (wrote "UNSUPPORTED: none" on most of them) | none that holds: a per-statement check removed correct inference (dropped 2026-10-09); enforcing the pass's own list would hit 30 answers of which 4 are real inventions | a second look costs latency and correct answers |
| Unsupported inference or over-generalisation (F) | 9 | lecture 2, sales 1, call-center 1, general 1, recruiting 1, seminar 1, LFW 1, TI 1 | D2-CC-020 "any additional item qualifies"; D2-SALES-016 "all water damage excluded"; LEC-030 extends one loss response to every loss | yes | none | none found: each is a different step too far | — |
| Invented personal fact (G) | 7 | LFW 4, TI 3 | LFW-023 the target job's duties as his own; D2-TI-032 two projects from the job description | the profile is, or deliberately is not | the personal-claim notices and the pass (listed and kept on 3) | E19 covers the absent-fact form; the rest untested | — |
| Arithmetic or calendar count with the right inputs (E) | 7 | recruiting 2, sales 1, call-center 1, team-meet 2, TI 1 | REC-005 business days; REC-008 weighted score; D2-SALES-011 fifteenth for fourteenth | yes | the hidden calculation step, which reached 4 of the 7 | E21: the step where it is missing (stage one +11 points on such rows; a usable trigger is the open part) | about 280 ms to the first word on turns that get it; costs completeness on turns that do not need it |
| Right value, wrong thing (C) | 6 | TI 2, LFW 1, lecture 1, seminar 1, team-meet 1 | LFW-020 promotion date taken as start date; D2-TI-026 project placed at the wrong employer | yes | none | none | — |
| Document conflict or outdated source mishandled (the brief's source-precedence class) | 6 | lecture 4, sales 1, recruiting 1 | D2-LEC-026 the superseded exam rule; SALES-020 one of two current thresholds stated as settled | yes, both | the pass's conflict line | closed: four rewordings and a rail all failed (E6, E17, E18, E20) | — |
| Answer contradicts itself: verdict first, working says otherwise | 6 | general 2, lecture 1, sales 1, seminar 1, TI 1 | LEC-015 "served from cache" then the right count; GEN-010 "no phone debt found" then the $46 | yes | none | a "deciding fact first" notice was tried and dropped (fixed 2, broke 1) | a hidden working step would be reasoning, which is out |
| Available fact not used or a required part left out (B, N) | 5 | general 1, recruiting 1, sales 1, seminar 1, TI 1 | D2-GEN-002 ignores the noon car return; SALES-012 never totals | yes | none | none: each omission differs | — |
| Inputs combined or a rule applied wrongly (D) | 2 | general 1, sales 1 | SALES-022 a volume discount below its threshold | yes | the calculation step (present on both) | none | — |
| Wrong code (tie rule) | 2 | TI 2 | TI-015, D2-TI-033: top-k words with a heap | n/a | none (the app's code verification is switched off) | measure on `code1` first | — |
| Role or speaker (L) | 2 | general 1, team-meet 1 | GEN-030 "we place that order"; TEAM-018 the user in the third person | n/a | role notes | none | — |
| The gist chip alone is wrong | 2 | seminar 1, team-meet 1 | D2-SEM-008 chip reverses the F1 finding | n/a | none | none (too few) | — |
| Damaged after generation (J, K): draft fine, shown answer not | 3 of the rows above | sales, team-meet, seminar | SALES-028 7.8 → 4.0; TEAM-027 7.6 → 4.0; SEM-028 9.6 → 3.0 | — | E19 (all three are absent-fact questions) | — | — |
| A check that was wrong, not the answer | 1 | LFW | D2-LFW-036 | — | fixed as obj-2 | — | — |

Not in the prompt at all (A): none of the 71. Provider stall (P): none. Leak between profiles or modes (M): none
(the one flag was the defective check).
**The fix-up pass on that run, by Astra** (99 edited answers, draft and shown both judged): 8.23 → 8.47. It raised 13
answers by more than 1.5 and lowered 11, three of them into a hard fail. Of the 11 hard-failed edited answers, 7 were
already hard fails as drafts.
**What this says about priorities.** The classes with an objective handle are small: arithmetic and calendar 7 rows,
code 2. The largest class, invented facts (22 rows with the personal ones), has no check that separates it from
honest inference at this model setting; that was tested twice and is why the per-statement check was dropped.

### E21 stage three — result and verdict (2026-10-09 12:21 UTC; replayed 12:04–12:20 UTC after X1's three arms, 0 failed calls)
| Part | Arm | Reading | Lines |
|---|---|---|---|
| c, the cost (387 rows that need no calculation, 2 samples) | `e21d-base` → `e21d-n3` | every required string 95.2 % → 94.2 % of 566 (paired −1.1 points, 95 % −3.4 to +1.1); forbidden-string samples 6 → 3; first visible character median 899 → 888 ms, p90 1,113 → 1,095 ms; a block on 28 of 774 samples (3.6 %); median length 382 → 389 | 1 to 5 all hold |
| d, the gain (the 59 calculation rows, 4 samples) | `e21d-cbase` → `e21d-cn3` | right samples 170 / 236 (72.0 %) → 196 / 236 (83.1 %), paired +11.0 points (95 % 3.8 to 19.1); rose 7 (REC-005, REC-008, REC-019, TEAM-012, SEM-014, D2-SALES-011, D2-REC-016), fell 1 (D2-SEM-002); first visible character median 861 → 1,043 ms (+182), p90 1,091 → 1,387 ms (+296); forbidden 1 → 1 | 1 to 4 all hold |
**Verdict: both parts hold. E21 is a build candidate**: a turn that carries document evidence and that the word list
does not reach gets the lighter notice (n3); a turn the word list reaches keeps main's notice word for word. The
lighter notice costs nothing measurable where no calculation is needed (the n2 wording cost 3.7 points there) and
keeps the gain where one is.
What it still owes before anyone is asked to land it, each with lines written first: the build with tests; an app
run to confirm the wiring and the first-word cost; a check on questions that were not used to design it (the
challenge sets, below); Astra's reading, which cannot happen before the provider's block lifts.

## E21 stage four — does it hold on questions that were not used to design it? (rule written 2026-10-09 12:23 UTC, before the challenge sets have been run or replayed)
Stages one to three all read the same 59 + 387 development rows, and the n3 wording was written after reading six of
their failures. The challenge sets were authored blind, frozen at 11:07 UTC, and no answer to them exists yet.
**Measurement.** After `er7-chal-main` and `er7-chalval-main` (main `73b18d97`) exist: generator replay on their
recorded prompts, every row whose prompt carries the evidence block, has no calculation notice and is not a code
question (`rule-e21.mjs select4`, ids to a file), arms `e21e-base` (as recorded) and `e21e-n3`, 4 samples, back to
back, nothing else on the DeepSeek key. Read with `rule-e21.mjs read4`; the validation part with `--blind`
(aggregates only, no id, no text).
**Lines.**
1. `challenge`, rows with a calculation oracle: right samples rise by at least 5 points (paired mean), and at most 2
   rows fall from at least 3 of 4 right to at most 1.
2. `challenge-val`, rows with a calculation oracle: right samples not lower than the base (paired mean at least 0).
3. Both sets, the other rows that have required strings: samples with every required string not lower by more than
   2 points in either set.
4. Forbidden-string samples, both sets pooled: at most base + 2.
**Reading.** All hold → the gain is not an artefact of the rows it was designed on; E21 stays a keep candidate and
waits for Astra and for Evin. Line 1 or 2 fails → the candidate is not proposed; the branch stays as a record.

### E21 — the build, and its app confirmation (lines written 2026-10-09 12:23 UTC, before the candidate has been run in the app)
**Build.** Branch `cand/e21` (worktree `er-e21`) = main `73b18d97` + one change in
`electron/context-intelligence/generation/prompt-composer.ts`: `calculationNoticeForTurn` returns main's notice when
the word list fires (unchanged, word for word) and otherwise the lighter notice `CALCULATION_NOTICE_EVIDENCE` (the
replayed n3 text, checked identical by string) when the turn's evidence block is not empty, the question is not a
code question and at least two figures are in play. The stream filter that hides the block is the existing one, on
every provider's stream. Shared TypeScript, no platform branch.
**App confirmation**: runs `er8-dev-e21` + `er8-dev2-e21` (630 questions, fresh profile, direct DeepSeek, one app)
against `er6-*` (main, this morning). One run per build, so this confirms the wiring and trips on gross harm; the
size of the effect is what the replays measured.
1. Wiring: of the recorded prompts with an evidence block and a non-code question, every one carries exactly one
   "# Calculation" section; the text is main's wherever the word list fires and n3 elsewhere. No prompt without an
   evidence block gains a notice.
2. No answer, shown or as drafted, contains "[[CALC" or "[[/CALC".
3. On the 59 rows of stage one, "calculation result stated" (obj-3) at least er6's count + 3.
4. First word: (median change on rows that newly carry a notice) minus (median change on the 160 rows that carry
   main's notice in both runs) at most +150 ms. The subtraction removes the provider's drift between the two hours.
5. 630 answered, no provider failure; rows over 5 s to the first word at most er6's + 2.
6. Rows with every required string: not more than 12 below er6 (two runs of main differed by 12 this week).
A line that fails stops the candidate until it is understood.

### X1 — result (2026-10-09 12:35 UTC; three arms on one experiment build, main pass 11:07–12:03 UTC, fresh-session list pass 12:20–12:33 UTC; 528 turns, no error or timeout; General mode, direct DeepSeek)
Experiment build `exp/x1-whole-pack-threshold` `237bba1a` (main `73b18d97` + the threshold read from the
environment). One synthetic file per size, sizes as the app estimates them. "List" is the question that needs all
seven facts, asked in a fresh session.

| File size | 12,000 arm (main): what reaches the request · list right | 24,000 arm | 48,000 arm |
|---|---|---|---|
| 11,900 | whole file, 15,800 prompt tokens · 7/7 | same | same |
| 12,100 | 3–5 retrieved pieces, 7,400 tokens · **2/7 spoken, 3/7 typed** | whole, 15,800 · 7/7 | whole · 7/7 |
| 16,000 | pieces, 7,700 · 3/7 | whole, 18,700 · 7/7 | whole · 7/7 |
| 23,900 | pieces, 7,500 · 2/7 spoken, 3/7 typed | whole, 24,700 · 7/7 | whole · 7/7 |
| 24,100 | pieces · 3/7 | pieces, 7,700 · 3/7 | whole, 25,000 · 7/7 |
| 32,000 | pieces · 3/7 | pieces · 3/7 | whole, 30,800 · 7/7 |
| 47,900 | pieces · 2/7 | pieces · 2/7 | whole, 43,100 · 7/7 |
| 48,100 | pieces · 2/7 spoken, 3/7 typed | pieces · 2/7, 3/7 | pieces, 7,600 · 2/7, 3/7 |

Named facts: 7 of 7 right at every size, position and arm, spoken and typed (a uniquely named fact is retrieved
wherever it sits, including the last half per cent of a 48,100-token file). The two-figure sum and the current
value: right in every arm and size **except the 48,000 arm, spoken, at 32,000 (sum 1,340 for 3,615; the outdated
41 for 57) and at 47,900 (41 for 57)**. In all three the draft was right and the fix-up pass replaced it: the pass
reads at most 96,000 characters (`CLAIM_VERIFIER_MATERIAL_MAX_CHARS`), a 32,000-token file is 128,000, so the
second figure (at 85 %) and the September update (at 80 %) were outside what it saw and it "corrected" toward the
part it could see. Typed turns, where the pass did not run, were right at every size.
Several files, six of each size, spoken: the named fact was right in every arm; a pack of 12,600 is read whole from
the 24,000 arm up (6 of 6 files in the request against 4 of 6), 24,000 and 47,400 only in the 48,000 arm.
First word (median over the sizes above 12,000 and at most the arm's threshold, against the 12,000 arm on the same
sizes): 24,000 arm spoken −42 ms, typed +101 ms; 48,000 arm spoken +46 ms, typed **+612 ms** (47,900 typed: 1,744 ms
against 815). App memory showed no trend with file size.

**Lines.** 24,000: all six hold, spoken and typed. 48,000: lines 2 and 5 fail on spoken turns (the pass's cap);
typed turns hold with the first word 0.6 s later.
**Reading.** The 12,000 switch is a cliff for any question over the whole document: 700 tokens more and it gets 2 or
3 facts of 7. Raising it to 24,000 removed the cliff up to that size in this probe with no spoken first-word cost; the
price is the request (about 24,700 prompt tokens against 7,500 on such a turn). 48,000 is not safe as the code
stands: the fix-up pass and the spoken repair would have to read as much as the answer did, exactly the E5 and E10
finding one size up. A file near the top of a 24,000 threshold already fills the pass's 96,000 characters, so a
change to 24,000 should raise that cap with it.
**What this is not.** Synthetic filler with planted facts, one mode, one file or six. It says nothing about answer
quality on realistic packs above 12,000 tokens, which the benchmark does not have. Nothing lands from X1; a proposal
to Evin would be "24,000 with the pass cap raised", measured first on a realistic larger-pack condition.

### Main `73b18d97` on the challenge sets (runs `er7-chal-main`, `er7-code1-main`, `er7-chalval-main`, 12:34–12:53 UTC; read 12:54 UTC; judge-free, checks obj-3)
All 207 answered on direct DeepSeek. "Right" is the row's own deterministic check: the calculation result stated
(and no forbidden string), the code's tests all passing, or every required string present and no forbidden string.
It is a strict lower bound: an answer that gives the right result in a form the oracle's list does not hold counts as
wrong (seen on two rows of `challenge`, e.g. "come to 14" where the forms are longer phrases).

| Set | Rows | Right | Calculation result stated | Dates and times | Version conflict | Absent fact | Code tests pass |
|---|---|---|---|---|---|---|---|
| `challenge` | 117 | 94 (80 %) | 22 / 26 | 34 / 42 | 4 / 9 | 15 / 18 | 2 / 2 |
| `challenge-val` (aggregates only) | 54 | 45 (83 %) | 8 / 11 | 13 / 17 | 6 / 6 | 9 / 9 | 1 / 1 |
| `code1` | 36 | 34 (94 %) | | | | | 34 / 36 |

By mode on `challenge` (13 rows each): recruiting 12, technical-interview 12, general 11, team-meet 11, sales 10,
lecture 10, seminar 10, call-center 10, looking-for-work 8. Spoken 79 %, typed 83 %.
Read on `challenge` (the readable set): the wrong rows are a wrong band or stage applied (SALES-008 an 8 % discount
for the 18 % one; TEAM-001 the wrong rollout stage), a cap or count misapplied (CC-002), a share asked for and the
two counts given instead (LFW-001), an invented referee (LFW-011), a verification step asked for before answering
(CC-001, CC-004), and version conflicts answered with one side (REC-009, LFW-008, LFW-009, TI-009, LEC-010).
`code1`: two failures of 36 on main with code verification switched off.
These are the baselines the candidates are read against on unseen questions.

### E21 stage four — result and verdict (2026-10-09 13:01 UTC; replayed 12:53–13:00 UTC on the recorded prompts of `er7-chal-main` + `er7-chalval-main`, 108 rows × 4 samples per arm, 0 failed calls)
| Set | Calculation rows: right samples | Paired change (95 %) | Rose / fell | Other rows: every required string | Forbidden-string samples |
|---|---|---|---|---|---|
| `challenge` (77 rows, 37 with a calculation) | 109 / 148 (73.6 %) → 109 / 148 (73.6 %) | 0.0 (−10.8 to +10.1) | 2 / 3 | 85.7 % → 84.8 % of 112 | 20 → 34 |
| `challenge-val` (31 rows, 14 with a calculation; aggregates only) | 41 / 56 (73.2 %) → 47 / 56 (83.9 %) | +10.7 (0.0 to +23.2) | 1 / 0 | 100 % → 100 % of 40 | 13 → 14 |
Line 1 (`challenge` calculation rows up by at least 5 points, at most 2 rows falling): **fails** (0.0 points, 3 fell).
Line 2 (`challenge-val` not lower): holds. Line 3 (other rows): holds. Line 4 (forbidden-string samples at most
base + 2, pooled): **fails** (33 → 48).
**Verdict: E21 is not proposed.** The gain measured twice on the 59 development rows (+11 points) did not appear on
37 harder calculation questions written blind (0), and appeared on 14 others (+10.7); pooled over the 51 unseen
calculation rows it is 73.5 % → 76.5 %, an interval that includes zero. And the notice did harm that the
development rows had not shown. Read on the readable set only: on SALES-013 the hidden working set the sum up
wrongly (the monthly fee divided by twelve) and the answer followed it to $16 for $188; on absent-fact questions
(LEC-001, LFW-010, LEC-006) answers that had declined now supplied the missing thing in 3 or 4 of 4 samples.
Branch `cand/e21` (`298b2b5b`, local) stays as a record and is not a landing candidate. The app confirmation
(`er8`) had just started and was stopped; its partial folder is deleted; no Astra call is owed for E21.
**What was learned, in order of how sure it is.** (1) A notice in the answer prompt is never free: main's wording
on turns that need no calculation costs completeness (stage two), and even the lighter one changes what the model
does with an absent fact (stage four). (2) A hidden working step helps a calculation the model would otherwise
attempt in its head, and hurts when the step itself picks the wrong figure: with near-miss figures in the pack it
writes the wrong set-up down and then trusts it. (3) A result on rows that have been read, however clean (two
replays, intervals above zero), did not carry to unseen rows. The challenge sets exist for this and did their job.

## E22 — does the calculation step on main earn its place? (a measurement of an existing mechanism; lines written 2026-10-09 13:02 UTC, before any replay of it)
E21 showed that a calculation notice costs something on turns that need no calculation and can mislead on hard
ones. Main's own notice (since 2026-09-30) was justified on nine development turns. On these sets its word-list
trigger fires on 160 development questions, 72 with a calculation oracle and 88 without, and on part of the
challenge sets, which did not exist then.
**Measurement.** Generator replay on recorded prompts that carry main's notice: `er6-dev-main` + `er6-dev2-main`
(160 rows) and `er7-chal-main` + `er7-chalval-main` (the rows `select2b` finds; ids to a file). Arms, 3 samples
each, back to back, nothing else on the DeepSeek key: `e22-with` (as recorded) and `e22-without` (the notice
section removed, nothing else changed). Read with `rule-e21.mjs read4 --base e22-without --arm e22-with` per set;
the validation part with `--blind`.
**Lines for "it earns its place".**
1. Calculation rows, development and challenge sets pooled: right samples with the notice at least 5 points above
   without.
2. Calculation rows of the two challenge sets alone: with the notice not below without.
3. The other rows that have required strings, pooled: every-required-string samples with the notice not more than
   2 points below without.
**Reading.** All hold → main is confirmed as it is and nothing changes. A line fails → it is reported to Evin with the
numbers; nothing is built from this measurement. Any change to the notice or its trigger would be a new candidate with
its own lines, an unseen-question check and Astra.

### E22 — result (2026-10-09 13:13 UTC; replayed 13:02–13:12 UTC, 222 rows × 3 samples per arm, 0 failed calls)
| Set | Calculation rows: right samples without → with the notice | Paired change (95 %) | Rose / fell | Other rows: every required string | Forbidden-string samples | First visible character, median |
|---|---|---|---|---|---|---|
| development (160 rows, 72 with a calculation) | 175 / 216 (81.0 %) → 199 / 216 (92.1 %) | +11.1 (4.2 to 19.0) | 6 / 1 | 93.2 % → 91.7 % of 192 | 13 → 12 | 939 → 998 ms |
| `challenge` (39 rows, 31 with a calculation) | 73 / 93 (78.5 %) → 81 / 93 (87.1 %) | +8.6 (0.0 to 19.4) | 3 / 0 | 80.0 % → 93.3 % of 15 | 7 → 4 | 938 → 1,062 ms |
| `challenge-val` (23 rows, 14 with a calculation; aggregates only) | 30 / 42 (71.4 %) → 33 / 42 (78.6 %) | +7.1 (−4.8 to 21.4) | 2 / 0 | 85.7 % → 85.7 % of 21 | 6 → 6 | 932 → 1,031 ms |
Pooled calculation rows: 278 / 351 (79.2 %) → 313 / 351 (89.2 %), +10.0 points: line 1 holds. The two challenge sets
alone: 103 / 135 (76.3 %) → 114 / 135 (84.4 %): line 2 holds. Other rows pooled: 209 / 228 (91.7 %) → 208 / 228
(91.2 %): line 3 holds.
**Main is confirmed as it is.** Where the question's own wording asks for a quantity, the hidden working step is worth
about ten points of right answers, on questions written after it as well, for about 60 to 120 ms at the median to
the first visible word and no measurable loss on the other rows it fires on. Set beside E21 this draws the line:
the step helps when the question says it wants a figure, and did not carry to unseen questions when it was added
because documents were present. Nothing changes.

## Session of 2026-10-09, 18:05 UTC onward (same session, new instructions from Evin)
Evin, 2026-10-09: finish the 587 outstanding Astra judgments of the E19 build when access legitimately returns and
keep the HTTP 403 restriction as it stands; establish the actual baseline before proposing another production
change; then investigate a narrow source-aware claim provenance mechanism for invented company, personal and
research facts and wrong source attribution, with an acceptance rule written first and validated on unseen
challenge questions before any Astra call; independently evaluate realistic 24k reference packs. Not to be done:
E21 again, a broader calculation notice, a rewrite of the verifier's conflict instructions. All work stays off main.
State at 18:05 UTC: main = origin/main = `73b18d97`; this branch local `c403010f`, not pushed; the access-block flag
`/tmp/er-access-block-20261008-1630.json` is in place and no judge call has been made since 11:12 UTC; next Astra
window about 02:00 UTC on 10 October.

## X2 — realistic packs of about 21,000 tokens, 12,000 against 24,000 (set declared and lines written 2026-10-09 18:15 UTC, before any of its documents exists)
X1 showed the cliff on synthetic filler. X2 asks the same of realistic packs, and what a user with such a pack gets
from main today.

**Set `pack24`** (new, versioned, separate corpus: `pack24/authoring`, `pack24/evidence`, `pack24/datasets`; built with
`ER_AUTH_DIR` / `ER_EVID_DIR` / `ER_BENCH_DIR`, so no frozen dataset or manifest hash moves). Four modes whose frozen
packs are the largest (sales, call-center, lecture, seminar: 9,400 to 9,900 tokens). Each keeps its frozen documents
unchanged and gains 4 to 6 documents of the same fictional world on adjacent subject matter, to a pack of 82,000 to
90,000 source characters (about 20,500 to 22,500 tokens as the app counts them), written by authors blind to the
product (`AUTHORING-ER-PACK24.md`). The added documents may not restate or change a frozen fact, must stay silent
where the frozen pack is silent on purpose, and are checked mechanically for needle collisions
(`pack24/check-noninterference.mjs`). Items:
* 313 **derived** items: every frozen dev, dev2 and challenge item of these modes that uses the mode's base config,
  re-issued with a new id (`ER-P24-<PFX>-D|D2|C1-nnn`), same question, same oracle, the enlarged config. The same
  questions on the small pack are in `er6-*` and `er7-chal-main` (main, whole pack).
* 48 **new** items (`ER-P24-<PFX>-N-nnn`, 12 per mode) that need an added document: 3 that need the whole pack, 2
  calculations across an old and a new document, 2 facts deep in a long document, 2 version conflicts, 2 absent
  facts, 1 which-value. All checkable without a judge.
No holdout part: this is a measurement of a condition, not a set a fix will be designed on.

**Build and arms.** `exp/x1-whole-pack-threshold` `237bba1a` (main `73b18d97` + the threshold read from the
environment; never for main). Arm A 12,000 (main's behaviour: the pack does not fit, pieces are retrieved), arm B
24,000 (the pack is read whole). Direct DeepSeek, one app at a time, fresh user data per arm, arms back to back.
**Recorded, judge-free, checks obj-3:** rows with every required string; rows with a forbidden string; calculation
results; the new rows by kind; required facts whose document string is in the request; first word and settled
answer by surface; prompt tokens; the fix-up pass (ran, changed the text, over its budget, material over its
96,000-character cap); rows right as drafted and wrong as shown.

**Lines for "24,000 is worth proposing for packs of this size"** (arm B against arm A, same rows):
1. Rows with every required string (all rows that have one): B at least 3 points above A, paired 95 % interval
   above 0.
2. Rows with a forbidden string: B at most A + 2.
3. Calculation results right: B not more than 2 points below A.
4. The 12 whole-pack rows: B right on at least as many as A.
5. Spoken turns: median first word at most 400 ms above A, p90 at most 700 ms above, no turn over 5 s. Typed turns:
   median at most 400 ms above.
6. The fix-up pass: rows right as drafted and wrong as shown, B at most A + 2; passes over budget, B at most A + 2
   points.
7. No error, timeout or provider refusal in the arm.
Also reported, no line: both arms against the same questions on the small pack (what the added volume costs).
Astra: only if the lines are read, the 587 baseline judgments are done and calls remain; then both arms on the 48
new rows and a seeded sample of 120 derived rows. Whatever the outcome nothing lands from X2 without Evin's word,
and X1's note stands: a 24,000 threshold would raise the pass's cap with it.

### Source provenance of invented and misattributed facts: what the recorded prompts show (2026-10-09 18:22 UTC; judge-free, no model call; development rows only)
Read on the prompts of `er4-*` (the last judged baseline) and `er6-*`, for the three target classes of the failure map
(invented company, policy, research or meeting fact 15 rows; invented personal fact 7; right value, wrong thing 6).
1. **The app's own derived résumé sections state wrong employers and dates.** Besides the whole résumé, the prompt
   carries sections rendered from the structured extraction ("Experience: <title> at <company> — (dates) — …",
   "Complete employment history", one card per role). On profile B they pair the second job title held at one
   employer with the NEXT employer on the page ("Senior Frontend Engineer at Ondaverde Health (2022-06 to 2023-12)";
   the résumé has that title at Lumenquay) and take a company's description line as its name ("Frontend Engineer at
   Patient portal and appointment tools for private clinics."). On profile A (a PDF, lines wrapped) the list reads
   "Software Engineer II at ships. (2023-03 to 2024-03); Software Engineer at [Page 2] (2020-07 to 2023-02); Tech lead
   for Dispatch Core, a team of five: … at weekly design review …". Three of the 71 hard fails repeat exactly these
   sections: D2-TI-026 (the TypeScript migration placed at Ondaverde), D-LFW-020 and D2-TI-009 (time at the employer
   and at senior level counted from April 2024). They were filed as generator mistakes; the wrong statement was in
   the prompt, marked `direct_fact`.
2. **Why the benchmark sees this path.** Every profile row of every run has `pi_extraction_mode: heuristic`. The app
   log says why: "LLM structured extraction failed (No reasoning model available. Please configure an API key
   (OpenAI, Claude, Gemini, Groq, Natively) or a custom provider.); falling back to deterministic heuristic
   extractor." A user whose only key is DeepSeek gets the rule-based parser for the profile, as the benchmark does.
   Not changed here (it is a provider-routing decision, Evin's).
3. **An existing rule covers written fields, not pairings.** `profile-derived-support.ts` (2026-09-30) already drops a
   derived résumé field the résumé text does not support (numbers, 75 % of content words). Every word of "Senior
   Frontend Engineer at Ondaverde Health" is in the résumé; the pairing is what is wrong, and nothing checks it.
4. **The story notice treats any evidence as the user's record.** `evidenceStoryGuard` fires on a question about the
   user's own past whenever the prompt has evidence: "Tell it only with what the evidence states … mention a real
   project only for what the evidence says about it." When the only document is the job posting (11 development
   turns with a personal intent, mean 8.36, 3 hard fails: D-LFW-023, D-TI-022, D2-TI-032) the evidence is the
   employer's description of the role, and the answers tell it as the candidate's history. The evidence tag already
   says what each source may establish (`authority="JOB_RESPONSIBILITY,…"`, no `USER_*`); the notice does not read it.
5. **Invented company, policy and research facts (15 rows) have no such handle.** All their sources are reference
   files with the same type and authority, the invented sentence reuses the documents' own words ("native connectors
   are priced as add-ons", "they'll restore it to you"), and the app's answerability signal does not separate them
   (rows flagged for an unsupported claim: 18 of 306 "FULL", 17 of 303 "PARTIAL", 4 of 21 "NONE"). Nothing is
   declared for that class today.

## E23 — a derived experience statement is evidence only when the résumé's own text supports the pairing it states (rule written 2026-10-09 18:22 UTC, before any replay of it)
**Mechanism (deterministic, no model call, nothing before the first word).** An extension of
`stripUnsupportedDerivedResumeFields`. A structured experience entry (title, company) is rejected on evidence only:
* shape: the company is a page marker, has more than 10 words, or ends in a sentence period that is not a corporate
  abbreviation; or the title has more than 12 words;
* position: title and company both occur verbatim in the résumé text, and on every line that starts with the title
  the company first appears more than 2 text lines below it, or another entry's company stands alone on a line
  between the company and the title.
An entry whose title or company cannot be found verbatim is kept (nothing shows it is wrong). **If any entry of a
résumé is rejected, none of that résumé's derived experience statements is rendered** (the per-entry sections, the
"complete employment history" line, the per-role cards): a partial list reads as the whole history. The résumé's own
text (whole, and in heading-aware pieces) stays, and is then the only statement of who worked where and when.
**Replay arm `e23`:** the recorded answer prompt with those blocks removed when the rule, applied to the résumé text
in the same prompt, rejects an entry; base arm = the recorded prompt. Direct DeepSeek, the app's parameters, k = 4.
**Stage 1, development rows** (`er6-dev-main` + `er6-dev2-main`, every row whose prompt changes):
1. samples with every required string: not more than 1.5 points below base, paired 95 % interval above −4;
2. samples with a forbidden string: at most base + 2;
3. rows that fall (right in at least 3 of 4 base samples, at most 1 of 4 with the arm): at most 1.
D-LFW-020, D2-TI-026 and D2-TI-009 are reported; they were read to design this, so they decide nothing.
**Stage 2, unseen rows.** Two new sets, written by authors blind to the product and to this finding
(`AUTHORING-ER-PROV1.md`): `prov1` (24 items, readable) and `prov1-val` (24 items, never read; aggregates only), for
Looking for work and Technical Interview: which employer or title a résumé fact belongs to (8 + 8), a length of time
from résumé dates (6 + 6), the candidate's own history with only the posting loaded (6 + 6), a fact of the posting
with only the posting loaded (4 + 4). Main `73b18d97` is run on both in the app to record the prompts; both arms are
then replayed on them, k = 4. Also replayed: the Looking-for-work and Technical-Interview rows of `challenge` and
`challenge-val` whose prompt changes.
4. "which employer or title" and "length of time" rows of `prov1` + `prov1-val` (28 rows): right samples (every
   required string, no forbidden string, the calculation result where there is one) at least 8 points above base,
   paired interval above 0;
5. every other unseen row whose prompt changes: lines 1 and 2;
6. rows that fall: at most 2.
Only if 4 to 6 hold is a candidate built from main, run in the app on the changed rows, and judged by Astra (the
rows whose shown answer differs, both sides). If stage 1 fails, stage 2 is not run for E23.

## E24 — with the job posting as the only document, the story notice says whose record it is (rule written 2026-10-09 18:22 UTC, before any replay of it)
**Mechanism (deterministic).** `evidenceStoryGuard` reads the packed evidence's own `authority`: when the question is
about the user's own past, a job posting is in the evidence and NO evidence item may establish a fact about the user
(no `USER_*` authority), the notice "# A story from the evidence" is replaced by one that says the posting describes
the role, records nothing the user has done, is not to be told as their work, and that the answer is an opening they
complete with their real history. Every other turn keeps today's notice.
**Replay arm `e24`:** the recorded prompt with that notice swapped on exactly those turns; base = the recorded prompt.
**Judge-free lines** (development rows first; then `prov1`, `prov1-val` and the challenge rows in that state):
1. rows in that state that have required strings (the answer IS in the posting): samples with every required
   string not more than 2 points below base, and no row falls;
2. samples with a forbidden string: at most base + 1.
What the notice is for (an invented history) no fixed string can see on most rows; the oracle entries have no
needles. So its gain is read by Astra only, on the own-history rows (3 development, 12 unseen), both arms, and only
if lines 1 and 2 hold on the unseen rows. The three development rows' replays are read by eye before that and
reported as that, not as a verdict.

### E23 and E24 — stage 1 on development rows (2026-10-09 18:29 UTC; replayed 18:24–18:28 UTC, `er6-dev-main` + `er6-dev2-main` prompts, k = 4, 0 failed calls; `report/rule-e23.mjs`)
The pairing rule on the recorded prompts (123 rows carry résumé evidence; 68 change, about 2,260 characters
removed): profile A keeps "Senior Software Engineer and Tech Lead, Dispatch Core at Quillhaven Freight Systems" and
rejects five entries (a company of "ships.", "[Page 2]", three bullet lines read as jobs); profile B keeps the
Lumenquay lead role and the Plumewright role and rejects "Senior Frontend Engineer at Ondaverde Health" (pairing not
in the text) and the company that is a description line. So on both résumés the derived experience blocks go.
**E23, 52 development rows whose prompt changes, 208 samples per arm:**
| | base | arm |
|---|---|---|
| samples with every required string (41 rows) | 90.9 % | 95.7 % (paired +4.9, 95 % 0.6 to 11.6) |
| samples with a forbidden string | 0 | 1 |
| right samples (required, no forbidden, calculation) | 90.4 % | 96.6 % (paired +6.3, 95 % 2.4 to 12.0) |
| rows that rose / fell | | 3 / 0 |
| first visible character, median | 873 ms | 842 ms |
Lines 1 to 3 hold. Design rows, reported only: D-LFW-020 0 of 4 → 4 of 4 ("joined in March 2023 … three years and
seven months"; the base says "joined in April 2024 … two years and six months" in 4 of 4); D2-TI-009 3 → 4 of 4;
D2-TI-026 has every required string in both arms and its base sample names the right employer (the recorded answer
of 7 October did not). Stage 2 runs.
**E24, the 11 development rows in its state, 44 samples per arm:** every required string 90.6 % → 100 % (8 rows),
forbidden 0 → 0, no row falls: lines 1 and 2 hold. **Read by eye, the notice does not do what it is for:** on the
three own-history rows the arm still tells the posting as the candidate's work in 12 of 12 samples ("I'm a backend
engineer … money-movement … I also carry the pager"; "the ledger write path I owned end to end"; "I've worked with
CRDTs … Yjs over WebSockets"), as the base does (5 of 6 read). No Astra call is spent on this wording.
**E24b, one further wording, declared here before it is replayed:** the same gate; the notice is the app's existing
no-source personal guard (the sentence that already works where no evidence is found: "This question asks for a
fact about the USER themselves … No source establishes it, so do NOT state one …") with one sentence before it that
the document above is the posting and describes the employer's job, not the user. Read by eye on the same three
rows, k = 4: if more than 3 of the 12 samples still tell the posting as the candidate's history, E24 is closed as a
prompt notice and nothing further is tried on it today. Lines 1 and 2 apply as before.

### E24b — result: closed (2026-10-09 18:30 UTC; replayed 18:31 UTC, the same 11 rows, k = 4)
Lines 1 and 2 hold again (every required string 90.6 % → 93.8 %, forbidden 0 → 0, no row falls). By eye on the
three own-history rows, 9 of 12 samples still tell the posting as the candidate's history (D-LFW-023 4 of 4, "I'm a
backend engineer … services that move and record money … I also carry the pager"; D2-TI-032 4 of 4, "I've worked
with CRDTs on the client side, mostly Yjs over WebSockets"; D-TI-022 1 of 4, the other three give a frame, ask which
part matters, or say plainly that no system is on record). More than 3 of 12: **E24 is closed as a prompt notice.**
The guard that works when no evidence is found does not hold once the posting is in the prompt as evidence. What is
left for this class is not a notice: either the posting is not handed over as evidence on a turn that asks only for
the user's own record (a retrieval-plan change, not tried), or the fix-up pass is told the posting is not the
candidate's record (it would then empty these answers rather than repair them). Neither is declared.

### E23 — the candidate, and the unseen challenge rows at k = 4 (2026-10-09 18:35 UTC; replayed 18:33–18:35 UTC on the prompts of `er7-chal-main` and `er7-chalval-main`; challenge-val as aggregates only)
**Candidate (written while the unseen sets were being authored; NOT proposed).** Branch `cand/e23` `9bfff943` from
main `73b18d97`, local only: `unsupportedExperienceEntries` in `profile-derived-support.ts` (the rule of the
replay arm, same constants) and three lines in `profile-retrieval-port.ts` (no experience sections, no
complete-history line and no per-role card for a résumé with a rejected entry). The other five callers of the
shared strip function are unchanged on purpose: they have no résumé text to fall back on. Type check clean; new
test file 18 of 18; intelligence + context-intelligence suites 2,935 tests, 0 failures.
**Stage 2, line 5, first part: the Looking-for-work and Technical-Interview rows of the challenge sets whose prompt
changes** (16 readable + 7 unread rows; none of them asks which employer or how long):
| | challenge (16 rows, 64 samples) | challenge-val (7 rows, 28 samples) | pooled |
|---|---|---|---|
| samples with every required string | 77.1 % → 75.0 % (paired −2.1, 95 % −8.3 to 4.2; 12 rows) | 100 % → 100 % (5 rows) | 83.8 % → 82.4 % (−1.5) |
| samples with a forbidden string | 4 → 5 | 6 → 8 | 10 → 13 |
| rows that rose / fell | 0 / 0 | 0 / 0 | 0 / 0 |
Read as written: the forbidden-string line (at most base + 2) is missed by one sample on the pooled rows, and the
interval of the required-string line reaches below −4 (17 rows of 4 samples cannot give a narrower one). On the
readable rows the differences are in date and number wording on questions that never touch the removed blocks
("around the start of November" for "around the 3rd"; "about 26 hours" for "26 and a half"; a salary answer that
says ninety instead of eighty-eight in 3 of 4 instead of 2 of 4). **At k = 4 line 5 does not hold.**
**A second, larger sample of the same rows, declared here before it is generated** (as for E19 on 9 October): eight
more samples per row and arm on the same 23 rows (k 4 to 11), the lines read on all twelve. Required strings: not
more than 1.5 points below base, paired interval above −4. Forbidden strings: at most base + 6 (the same rate as
+2 on 92 samples). Rows that fall: at most 2. Both readings are reported whatever the second says; if the pooled
reading fails, E23 is not proposed and no Astra call is spent on it.

### E23 — the unseen challenge rows, twelve samples (2026-10-09 18:39 UTC; the eight further samples per row replayed 18:36–18:38 UTC, 0 failed calls)
| 23 rows, 276 samples per arm | base | arm |
|---|---|---|
| samples with every required string (17 rows) | 82.8 % | 82.8 % (paired 0.0, 95 % −1.5 to 1.5) |
| samples with a forbidden string | 31 | 35 |
| right samples | 76.1 % | 74.6 % (paired −1.4, 95 % −6.2 to 2.5) |
| rows that rose / fell | | 1 / 1 |
By part: challenge 75.7 % → 75.7 % required, forbidden 12 → 13; challenge-val 100 % → 100 %, forbidden 19 → 22.
The declared lines of the second reading hold (required not lower; forbidden base + 4, allowed + 6; one row falls,
allowed two). Both readings stand in this log: at four samples the forbidden line was missed by one sample, at
twelve it holds. What these rows say is that E23 does nothing for questions that are not about employers or dates
of employment, and costs them nothing measurable. Its case rests on line 4, the unseen which-employer and
length-of-time rows.

### Sets `prov1` and `prov1-val` frozen (2026-10-09 18:39 UTC; nothing had been run on them)
Two authors blind to the product and to E23, one per mode. `prov1` 24 items (`007fffa2d439`), `prov1-val` 24
items (`46f83196dd68`, never read; aggregates only). Per file and mode: 4 which-employer-or-title, 3 length of
time, 3 own history with only the posting, 2 posting facts; profiles A and B half each. Lint 0 errors. Every
earlier dataset hash and the manifest hash are byte-identical after the freeze (dev `aca272a802a3`, holdout
`6f56606b3ce9`, dev2 `0886c10b084e`, challenge `bb2bad267b68`, challenge-val `c62fc30c2094`, code1
`da9562e2ed45`). `build.mjs verify` lists the X1 probe files under `evidence/limits-probe` as stray, as it has
since X1; no frozen file fails its hash. Main `73b18d97` is being run on both sets in the app
(`er8-prov1-main`, `er8-prov1val-main`) to record the prompts.

### E23 — stage 2, line 4: not met; E23 is not proposed under its rule (2026-10-09 18:47 UTC; main run on the new sets 18:39–18:45 UTC, 48 of 48 answered on direct DeepSeek; replayed 18:45–18:47 UTC, k = 4, 0 failed calls; `prov1-val` as aggregates only)
Of the 28 which-employer and length-of-time rows, the prompt changes on 22 (11 + 11); on the other 6 no derived
experience block was in the prompt, so the arms are the same request.
| 22 rows, 88 samples per arm | base | arm |
|---|---|---|
| right samples (required, no forbidden, calculation) | 86.4 % | 93.2 % (paired +6.8, 95 % −4.5 to 19.3) |
| samples with every required string | 87.5 % | 97.7 % (paired +10.2, 95 % 0.0 to 21.6) |
| samples with a forbidden string | 7 | 6 |
| rows that rose / fell | | 2 / 0 |
By set: `prov1` 100 % → 95.5 % right, `prov1-val` 72.7 % → 90.9 % (paired +18.2, 95 % 0.0 to 38.6; both rows that
rose are there). **Line 4 asked for at least 8 points with the interval above 0: not met.** Lines 5 and 6 hold.
Read on the readable set: all 44 base samples and all 44 arm samples name the right employer and title or give the
right length of time. The two arm samples counted against it are the check, not the answer: "That was at Lumenquay,
and my title then was Lead Frontend Engineer … not the Senior Frontend Engineer period" trips the forbidden string
"Senior Frontend Engineer" (ER-PV1-TI-004; its author had flagged that risk). The item is left as frozen. Counting
those two as right would give +9.1 points; the interval would still reach 0.
**Verdict.** The pairing rule removes statements that are wrong on their face (both benchmark résumés), costs
nothing measurable on rows it is not about (twelve samples, 23 unseen rows), and where base answers were wrong
because of those statements the arm is right (D-LFW-020 0 → 4 of 4; two unseen rows). But main already answers
most such questions correctly from the résumé text in the same prompt, so on 22 unseen rows the gain is +6.8
points with an interval through 0. Under the rule written before the replays, **E23 is not proposed, the
candidate is not run in the app and no Astra call is spent on it.** `cand/e23` `9bfff943` stays as a local
record. Whether to land it anyway, as the removal of a known-wrong statement from the prompt rather than as a
score change, is Evin's decision; so is letting a DeepSeek-only user's profile be extracted by a model at all
(finding 2 above), which would remove the cause on this benchmark.

## E25 — the fix-up pass is shown where each sentence of the draft is closest to the material (rule written 2026-10-09 18:50 UTC, before any replay of it)
For the class with no deterministic handle (finding 5: invented company, policy, research and meeting facts, 15 of
the 71 hard fails). The pass reads about 45,000 characters and wrote "UNSUPPORTED: none" on 21 of 34 answers capped
for an invented detail. A check that made it quote the material for every statement was tried and dropped on
9 October (it removed correct inference). This is a different mechanism and is declared as one experiment:
**Mechanism.** No extra call and nothing before the first word. A program splits the draft into sentences and the
material into passages (each with its document name and the heading above it), matches them by the words they share
weighted by how rare each word is in this material, and puts the two nearest passages of every sentence between the
material and the draft ("# Closest passages"; "no passage shares its terms" when none reaches the bar). The pass's
prompt gains one paragraph saying what that section is and when a statement is listed because of it (the passages
say it of a different product, plan, person, study or date; a narrower rule or a smaller set; or nothing states
it), and that a worked-out figure and everything in the never-list are still not listed. The existing list, the
never-list and the conflict line are unchanged, byte for byte. Only Sales, Call Center, Seminar, Team Meet and
Recruiting turns get it (the modes whose capped answers are of this class).
**Replay** (`replay-claim-pass.mjs`, main's pass `cv-e19-73b18d97`, cap 96,000, k = 2): arm `e25-ctl` against
`e25-sheet` on the same drafts.
**Stage 1, development drafts** (`er6-dev-main` + `er6-dev2-main`, every turn of those modes that ran the pass):
1. drafts that are right by the fixed checks (every required string, no forbidden string, the calculation result)
   and are no longer right as shown: arm at most ctl + 1 point of the right drafts;
2. right drafts whose text the pass changes: arm at most ctl + 3 points;
3. shown answers with a forbidden string: arm at most ctl; drafts with a forbidden string that the pass repairs:
   arm at least ctl;
4. pass time: median at most 150 ms above ctl, p90 at most 300 ms above; passes not finished inside the budget at
   most ctl + 1 point.
Reported, deciding nothing: on the drafts of the last judged run (`er4-*`) that Astra capped for an unsupported
company, policy or research claim or an invented meeting fact, whether each arm's UNSUPPORTED line names the flagged
detail, read by eye.
**Stage 2, unseen** (the same modes' rows of `challenge` and `challenge-val`, drafts of `er7-*`): lines 1 to 4.
Only if both stages hold are Astra calls spent (the rows whose shown answer differs between the arms, both sides).
If stage 1 fails nothing further is run for E25.

### E25 — result: stage 1 holds, stage 2 fails; not proposed (2026-10-09 18:58 UTC; replayed 18:50–18:58 UTC; main's pass, cap 96,000, k = 2; every rebuilt request equals the recorded one; `report/rule-e25.mjs`)
| | development drafts, 346 rows, 692 samples | | unseen drafts (challenge + challenge-val), 95 rows, 190 samples | |
|---|---|---|---|---|
| | ctl | sheet | ctl | sheet |
| right drafts no longer right as shown | 1.9 % | 1.3 % | 5.9 % | 5.9 % |
| right drafts whose text changes | 12.4 % | 14.0 % | 13.2 % | **17.8 %** |
| forbidden string as shown (repaired) | 10 (0) | 9 (0) | 4 (4) | **5** (4) |
| not right as drafted, right as shown | 2 | 4 | 3 | 2 |
| pass time p50 / p90 | 1,322 / 1,817 ms | 1,345 / 1,877 ms | 1,279 / 1,698 ms | 1,353 / 1,874 ms |
| not finished in budget | 1.2 % | 0.9 % | 0.5 % | 0.0 % |
Stage 1: all four lines hold. **Stage 2: line 2 fails (+4.6 points of right drafts changed, 3 allowed) and line 3
fails (one more shown answer with a forbidden string).** No Astra call is spent; nothing is built.
Reported, deciding nothing: on the 30 drafts of the last judged run that Astra capped for an unsupported company,
policy or research claim, an invented meeting fact or an unsafe commitment, the pass's list names something in 12
of 60 samples as it is and in 23 of 60 with the sheet. With the sheet it newly names the flagged detail on six
rows, four of them Seminar (D-SEM-017 the invented provenance of the other groups' data; D2-SEM-006 "the one class
where it beats us"; D2-SEM-040 both invented findings; D-SEM-028), D-REC-022 (the invented precedence) and D-CC-030
("they'll pick up now"). It also lists two honest "let me confirm" sentences as promises (D-SALES-028) and stops
listing on one row. So the sheet does make the pass see more of what the judge flags, most clearly research
claims, and on unseen drafts it pays for that by touching more answers that were right. One lead is left and NOT
taken today: the same sheet for Seminar turns only. The unseen sets hold 19 Seminar rows, too few to decide it.
Also seen while building the sheet: D2-CC-030, counted among the invented company facts, is supported by the
material in its own prompt ("Every charge produces an invoice … listed in the app under Settings > Billing"); that
judgment is a judge error, so the class is at most 14 rows, not 15.

### X2 — result: on packs of about 20,700 tokens main is right on 54 % of the questions; read whole, 87 % (2026-10-09 20:17 UTC; arm A 19:00–19:37 UTC, arm B 19:37–20:14 UTC; experiment build `237bba1a`, direct DeepSeek; 361 turns per arm, all answered; judge-free, checks obj-3; `report/x2-pack24.mjs`)
**The set as frozen** (`pack24` `d3dea0a7c58d`, before any run): sales 13 files / 20,606 tokens as the app counts,
lecture 15 / 20,619, seminar 12 / 20,888, call-center 15 / 20,770; the frozen documents unchanged (byte check,
`pack24/verify-scaffold.mjs`), 22 documents added by four authors blind to the product (44,900 to 46,900
characters per mode; no frozen needle with a digit occurs in an added document); 313 derived items, 48 new ones.
All 55 files built and parsed with no lost needle.
**Arms.** A: threshold 12,000, main's behaviour (the pack does not fit, pieces are retrieved). B: 24,000 (the pack is
read whole). One event in arm A: at 19:23:45 the app was quit from outside (a clean "user-quit" in its log, not a
crash); the supervisor restarted it on fresh user data and re-ran the interrupted turns.

| | A: 12,000 (main) | B: 24,000 |
|---|---|---|
| right (every required string, no forbidden string, calculation) | 196 / 361 (54.3 %) | 314 / 361 (87.0 %) |
| every required string (302 rows) | 47.7 % | 86.8 % (paired +39.1, 95 % 33.4 to 45.4) |
| rows with a forbidden string | 21 | 8 |
| calculation results right (105 rows) | 39 (37 %) | 84 (80 %) |
| required document facts whose string is in the request | 310 / 643 (48 %) | 643 / 643 |
| files in the request, median | 5 | all (12 to 15) |
| prompt tokens, median (cached) | 8,183 (4,992) | 29,759 (5,248) |
| first word, spoken: median / p90 / p95 / max | 3,413 / 3,748 / 3,941 / 7,939 ms | 2,657 / 3,059 / 3,209 / 4,193 ms |
| first word, typed: median / p90 / max | 899 / 1,188 / 1,861 ms | 1,329 / 1,728 / 5,475 ms |
| settled answer, spoken: median / p90 | 5,240 / 7,648 ms | 5,215 / 8,244 ms |
| settled answer, typed: median / p90 | 2,341 / 2,974 ms | 3,145 / 4,131 ms |
| fix-up pass: ran / changed the text | 268 / 75 | 268 / 33 |
| settled 3.5 s or more after the last token (the pass's budget) | 44 (16.4 %) | 71 (26.5 %) |
| pass material over its 96,000-character cap | 0 | 2 |
| right as drafted, not right as shown | 3 | 2 |

By mode (right, A → B): sales 43.8 → 84.3 %, lecture 70.0 → 92.2 %, seminar 54.9 → 87.9 %, call-center 48.4 →
83.5 %. By condition: one document 58.3 → 92.1 %, several documents 27.2 → 78.3 %, version conflict 45.2 → 80.6 %,
follow-up 58.3 → 83.3 %, absent 96.4 → 96.4 %, irrelevant source 100 → 100 %. The 48 new rows: 17 → 39 right (needs
the whole pack 0 → 6 of 9; calculation across an old and a new document 0 → 8 of 11; a fact deep in the long
document or which value 6 → 11 of 12; version conflict 3 → 6 of 8; absent 8 → 8 of 8).
By surface in arm A: spoken 48.9 % right with 42 % of the needed facts in the request; typed 63.8 % with 60 %.
**The same 313 questions on the small frozen pack** (main, read whole; `er6-*`, `er7-chal-main`): 85.9 % right, 3
forbidden-string rows. On the enlarged pack: main 57.2 % and 15, read whole 87.9 % and 8. So the added documents
cost nothing when the pack is read whole, and main loses 29 points when it is not.

**Lines (B against A).** 1 holds (+39.1 points). 2 holds (21 → 8). 3 holds (39 → 84 of 105). 4 holds (0 → 6 of 9).
**5 fails on one part:** spoken first word is 756 ms FASTER at the median and 689 ms faster at p90 (retrieval and
the awaited rerank, 1.2 s on a spoken turn, are not run); typed first word is 430 ms later (400 allowed; 1,329 ms
against 899). **6 fails on one part:** answers the pass broke 3 → 2, but turns that settle 3.5 s or more after the
last token rise from 16.4 % to 26.5 % (2 points allowed): the pass reads the whole request, about 92,000
characters, and 2 requests were over its cap. 7 holds. **So X2 is not "worth proposing as it stands" under its own
lines; it is an accuracy gain of 33 points with two measured costs** (typed first word +0.43 s; the pass out of
budget on a quarter of its turns, which delays the settled answer, typed p90 2.97 → 4.13 s), and a request 3.6
times the size.
**What arm A is.** The benchmark app has no embedding key, so it runs the bundled local embedding model. With that
provider a spoken turn in a meeting uses the keyword search and the awaited bundled rerank
(`shouldUseLexicalForLocalManualQuery`, Evin's decisions of 3 and 4 October); a typed turn queries the vectors.
All 231 spoken turns of arm A carry `degraded: local_lexical`. That is the default configuration, and it is what
a user without a cloud embedding provider gets. **Not measured:** a cloud embedding provider or the managed
reranker, where retrieval on a pack this size may deliver more than 48 % of the needed facts.
**Not yet judged.** A fixed sample (the 48 new rows and 30 derived rows per mode, `pack24/x2-astra-sample.json`,
committed before either arm was read) goes to Astra after the 587 baseline judgments if calls remain.
Nothing lands from X2. The candidate that the data points to is "24,000, with the pass's cap and budget looked at
together, and the pack placed where the provider can cache it" (5,248 of 29,759 prompt tokens are cache hits: the
question comes before the documents in the request, so the pack is never a cached prefix).

### Main moved during this session, by another session (noted 2026-10-09 20:19 UTC)
At 18:05 UTC main = origin/main = `73b18d97`. It is now `4eb4b851` on both: three commits made elsewhere at about
19:40 UTC (`25520180` GGUF models load in a packaged build, `07cce63b` a trial test's date, `4eb4b851`
downloaded models are checked for damage). `git diff --stat 73b18d97..4eb4b851` over `electron/llm`,
`electron/context-intelligence`, `electron/IntelligenceEngine.ts`, `electron/LLMHelper.ts`,
`electron/services/modes` and `premium` is empty: the answer path is unchanged, so the runs of `73b18d97`
(`er6-*`, `er7-*`, `er8-*`) and the experiment build on top of it still describe main. Nothing of this work
touched main. A candidate would be rebased onto the new main before any landing.

## Evin, 2026-10-09 about 21:05 UTC: "yes do all 4 one by one"
His answer to the four decisions put to him at 20:20 UTC: (1) land the résumé-statement fix as a correctness fix,
(2) let DeepSeek do profile extraction, (3) pursue the 24,000 threshold, (4) push `bench/evidence-rich`.

### 1. E23 landed on local main as a correctness fix (2026-10-09 21:24 UTC)
`cand/e23` rebased onto main `4eb4b851` (three commits by another session since `73b18d97`, none in the answer
path), message rewritten with the evidence and the fact that it missed its gain bar: `4675ff0e`. Four suites on a
fresh build of the candidate and of main, run back to back:
| suite | main `4eb4b851` | candidate `4675ff0e` |
|---|---|---|
| intelligence + context-intelligence | 2,917 tests, 0 fail | 2,935 tests (18 new), 1 fail |
| llm | 6,064 tests, 0 fail | 6,064 tests, 1 fail |
| services | 5,791 tests, 121 fail, 12 cancelled | 5,791 tests, 121 fail, 12 cancelled (the same names) |
The candidate's two failures are timing tests that ran while another job of mine loaded the machine (a queue that
must drain within its window in `HindsightMemory.test.mjs`; a C++ compile in `CppRunner.test.mjs`): both files
re-run alone three times, 41 of 41 each time. Neither touches the changed code. Fast-forwarded:
**local main = `4675ff0e`**, one commit ahead of `origin/main` `4eb4b851`. Not pushed (the word was to land).

### 2. E26 — a DeepSeek-only user's profile is extracted by the model (measured and declared 2026-10-09 21:25 UTC, before any app run of it)
**The gap.** `LLMHelper.generateContentStructured` builds its ladder from OpenAI, Claude, Gemini, Codex CLI, Ollama,
a custom provider and the Natively API. There is no DeepSeek rung, so with DeepSeek as the only key the ladder is
empty ("No reasoning model available") and the résumé goes to the rule-based parser.
**Measured before any code** (the app's own extraction prompt and parser, `premium/…/StructuredExtractor.ts`,
bundled; the request `generateWithDeepseek` sends: deepseek-flash, thinking off; the app's raw text of each
document; two runs at the provider default and two at temperature 0.4):
| document | result, 4 of 4 runs | time per call |
|---|---|---|
| résumé A (PDF, wrapped lines) | 3 entries: both titles at Quillhaven with their own dates, Tessarine; 4 projects | 6.1 to 6.3 s |
| résumé B (two titles at one employer) | 4 entries, the second title at Lumenquay, Ondaverde and Plumewright right | 5.1 to 5.8 s |
| posting A / posting B | title, company, level, location, minimum years right | 2.5 to 3.3 s |
The pairing rule of E23 rejects none of those entries. Nothing differed between the two temperatures.
**The change** (branch `cand/e26` from main `4675ff0e`): a DeepSeek rung, LAST in the ladder (after the Natively
API), at 0.4 like the Gemini rungs; `generateWithDeepseek` takes an optional temperature and sends none for its
chat callers. Last so that nobody who has a working rung today is moved to another model. Skipped when the
provider is switched off, when the key failed permanently this session, and in local-only mode. New test file 14 of
14; type check clean.
**App run** (one build of `cand/e26`, direct DeepSeek, fresh user data): the Looking-for-work and
Technical-Interview rows of dev, dev2, challenge, challenge-val, prov1 and prov1-val (224 rows), against main's
recorded runs of the same rows (`er6-*`, `er7-*`, `er8-*`; main before E23, rule-based parser).
**Lines.**
1. Every profile upload reports model extraction; the app log has no "falling back to deterministic heuristic".
2. No derived experience entry in any recorded prompt is rejected by the pairing rule.
3. Rows right by the fixed checks: not more than 2 points below main on all 224; on the 28 which-employer and
   length-of-time rows not below main.
4. First word, spoken: median at most 150 ms above main on the same rows; no turn over 5 s.
5. Every row answered, no provider failure; the time of a profile upload is reported.
If 1, 2 and 5 hold and 3 or 4 does not, it is reported with its cost and not landed without Evin seeing it.

### X2 — correction to line 6: the pass was NOT out of its budget on a quarter of its turns (2026-10-09 21:27 UTC)
The X2 reader counted a pass as over budget when the answer settled 3.5 s or more after the last streamed token.
That interval holds every step after the stream (the spoken repair and the pass, one after the other), not the
pass. The app logs the pass itself (`[ClaimVerifier] … <outcome> <ms>`). From those lines:
| | A: 12,000 | B: 24,000 |
|---|---|---|
| passes logged | 272 | 270 |
| pass time, spoken: median / p90 / max | 1,237 / 1,567 / 2,704 ms | 1,723 / 2,079 / 2,642 ms |
| pass time, typed: median / p90 / max | 1,148 / 1,453 / 2,302 ms | 1,612 / 2,126 / 5,790 ms |
| not finished inside the 3.5 s budget | 0 | 1 (0.4 %) |
| outcomes | 191 unchanged, 74 edited, 7 edits refused by the rails | 238 unchanged, 31 edited, 1 timeout |
So the pass is about 0.5 s slower on the whole pack and ran out of budget once in 270. **Line 6 holds** as it was
written (answers the pass broke 3 → 2; passes over budget 0 % → 0.4 %, 2 points allowed). What the wrong proxy did
measure is real and stays in the table above as the settled-answer time: everything after the stream takes longer
when it reads 92,000 characters (settled, spoken p90 7.6 → 8.2 s; typed p90 2.97 → 4.13 s). X2 therefore fails one
line only, by 30 ms: the typed first word (+430 ms, 400 allowed). The pass's budget does not need raising; its
material cap does (2 requests were over 96,000 characters). The sentence "the pass out of budget on a quarter of
its turns" in the X2 entry above, in the handoff head and in what Evin was told at 20:20 UTC is wrong and is
corrected here; the reader's label is fixed in `report/x2-pack24.mjs`.

### 4. `bench/evidence-rich` pushed (2026-10-09 21:26 UTC, on Evin's yes)
Plain fast-forward, `df815379..7b8050fb`, 52 commits, 296 files, all under `benchmarks/natively-answer-quality/`.
The added lines were scanned for key-like strings first (none). Draft PR #638 now shows it; it stays a draft and is
not merged. Done out of order because items 2 and 3 were waiting for another session's app to stop; later commits
of this session are pushed to the same branch at the end.

### 3. E27 — the 24,000 threshold as a candidate, and arm C with a cloud embedding provider (lines written 2026-10-09 21:34 UTC, before either run)
**Candidate** `cand/e27` (worktree `er-main`, from main `4675ff0e`): `WHOLE_PACK_MAX_TOKENS` 12,000 → 24,000 and
`CLAIM_VERIFIER_MATERIAL_MAX_CHARS` 96,000 → 136,000 (a full pack, the whole profile of 6,000 tokens and 16,000
characters for the rest of the request; an existing test holds the three figures to that relation). The pass's
3.5 s budget is NOT changed: by the app's own log it was missed once in 270 on the whole pack (correction above).
Four tests that built a "too large" pack of 13,500 to 22,000 tokens now build one above 24,000; one new test file
(6 tests). Type check clean; intelligence + context-intelligence 0 failures, llm 0 failures on the candidate
(services is run after the app runs).
**Runs, both on `pack24` (361 questions), direct DeepSeek, fresh user data, one app at a time:**
* **Arm C** (context, no line): the experiment build at main's 12,000 with a cloud embedding provider (Voyage,
  activated by saving its key through the app's own setting before any file is uploaded; `ER_EMBEDDING=voyage`,
  new in `run-er.mjs`). What a user with cloud embeddings gets from main on these packs. Arm A of X2 is the same
  build with the bundled model.
* **The candidate build**, default configuration (bundled embedding model), against X2's arms A and B.
**Lines for the candidate:**
1. right rows at least 84.0 % (arm B minus 3 points) and at least 25 points above arm A;
2. rows with a forbidden string at most arm B + 3 (11);
3. no pass request over the new cap, and passes not finished inside the budget (app log) at most 2 %;
4. first word within 300 ms of arm B at the median, spoken and typed (another hour of the provider);
5. every row answered, no error or timeout.
Packs of 12,000 tokens or less are not re-run: for them neither figure changes anything (whole below both
thresholds, requests under the old cap), which the unit tests hold.
**Landing.** His word was to pursue it. The request on such a turn is 3.6 times the size, which is a cost on the
Natively API and on users' own keys, so the candidate is taken to a measured, tested state and landed only on a
further explicit word, with arm C's result beside it.

## Evin, 2026-10-09 about 21:45 UTC: start the judging by itself at 7:30 IST and use the whole window
"auto start the remaining iterations at 7:30 am ist … gpt astra would be available for roughly over an hour,
maximise the time availability, judge and benchmark as much as possible and as many iterations." He is asleep
until then. Done: the in-session one-shot is moved to 07:30 IST (02:00 UTC) and starts ONE script,
`window-oct10.mjs` (probe, calibration, then in priority order until the pool closes: the 587 baseline judgments;
the 48 new pack24 rows of both X2 arms; the E26 candidate's profile rows with main's side of them; the 120 derived
pack24 rows of both arms; arm C and the 24,000 candidate build; baseline drafts). A 403 stops everything, as
before. Every app run that produces something to judge is made before the window.

## E28 — the documents before the question, so that a whole pack is a prefix the provider can cache (rule written 2026-10-09 21:58 UTC, before any replay of it; replay only, nothing is built)
X2's cost side: a whole 20,700-token pack makes a request of about 29,800 prompt tokens of which 5,248 are cache
hits (the system prompt). The user message starts with the question, so everything after it, the pack included, is
new to the provider on every turn. Inside one meeting the pack's evidence section is byte-identical from turn to
turn (52 of 60 recorded sales turns once the per-row session id is made constant; the benchmark opens a new
session per question, a meeting does not).
**Arms** (`replay-generator.mjs`, the 361 recorded prompts of X2 arm B, k = 1, three at a time, in recorded order):
`e28-base` = the recorded request with the session id constant; `e28-first` = the same with the "# Evidence"
section moved to the top of the user message, before the question and the conversation. Nothing else differs.
**Lines.**
1. rows right by the fixed checks: arm not more than 2 points below base; rows with a forbidden string at most
   base + 3;
2. cached share of the prompt tokens, median over the rows: at least 80 % in the arm;
3. first token: the arm's median at least 300 ms below base.
If all three hold it is a lead for a composer change (which would need its own app runs and a judged reading on
every mode, since it moves the question on every turn that carries documents); nothing is built from the replay
alone. It is run after the app runs of E26 and E27, never beside one.

### 2. E26 — result: all five lines hold; landed on local main (2026-10-09 22:51 UTC; app run 21:32–22:33 UTC, `er9-*`, 226 rows of the two profile modes, direct DeepSeek, all answered; `report/e26-read.mjs`)
| | main (rule-based parser; `er6`, `er7`, `er8`) | candidate |
|---|---|---|
| profile rows extracted by the model | 0 of 163 | 163 of 163 |
| structured calls answered by DeepSeek / failures / rule-based fallbacks (app log) | n/a | 424 / 0 / 0 |
| derived experience entries in the recorded prompts that the pairing rule rejects | 259 | 0 |
| rows right by the fixed checks, all 226 | 201 (88.9 %) | 204 (90.3 %) |
| development (140) | 126 | 124 |
| challenge + challenge-val (38) | 31 | 33 |
| prov1 + prov1-val (48) | 44 | 47 |
| which employer / length of time (28) | 25 | 27 |
| own history with only the posting (12) | 11 | 12 |
| rows with a forbidden string | 4 | 2 |
| first word, spoken: median / p90 | 1,070 / 1,731 ms | 1,058 / 1,801 ms |
| first word, typed: median | 989 ms | 955 ms |
| **profile upload, résumé + posting: median / max** | 3.3 / 4.0 s | **73 / 82 s** |
| profile upload, one document: median / max | 1.3 / 2.2 s | 25 / 29 s |
Lines 1 to 5 hold. The sections that reach the prompt are now the résumé's own ("Achievements", "Leadership",
"Responsibilities", one card per real job); the garbled ones are gone ("on-call engineer starts from. at Owned the
desig…", "disk; about 260 GitHub stars."). No model-written profile artifact is in any recorded prompt. Rows that
changed side, development: 5 right → wrong, 4 wrong → right (among them D-LFW-020, the tenure, now right in the app
as well), the size of ordinary run-to-run change.
**The cost, which no line covered and Evin should see:** a profile upload is slow on DeepSeek. With a model
available the whole profile pipeline runs, as it does on every other provider (extraction, the stories, the
prepared material: about ten structured calls for a résumé and a posting), and on deepseek-flash those take about
6 s each, one after the other: 73 s at the median for a résumé with a posting, against 3 s with the rule-based
parser. The answers do not wait for it; the upload does.
**Suites.** A first llm run failed one source-pinning test (`FastModelPreferFast`: a 3,000-character window of
the function that one added line pushed its target out of); the line was redundant and is removed. Then, on the
candidate rebased onto the main of that moment: intelligence + context-intelligence 2,935 / 0 fail; llm 6,153 /
1 fail; services 5,794 / 121 fail / 12 cancelled with the same names as main's baseline. The one llm failure
(`QuickActionTurnRequest2026_10_09`: "a legacy prompt still gets the mode template") arrived with another
session's commit and fails the same way on main `bbba4a58` built in the same worktree: not this change.
**Main moved again meanwhile.** Another session committed three changes on top of E23 and pushed
(`ac9e3ab0`, `71f718d8`, `bbba4a58`: quick actions, follow-up questions, shortcuts), so **E23 `4675ff0e` is on
GitHub main** as part of that push, and the uncommitted edit to `LLMHelper.ts` in the main checkout is gone.
`cand/e26` rebased onto `bbba4a58`: `67fb1b24`, fast-forwarded. **Local main = `67fb1b24`**, one commit ahead
of `origin/main` `bbba4a58`; not pushed.
