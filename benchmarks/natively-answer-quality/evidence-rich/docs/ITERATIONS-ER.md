# evidence-rich-v1 — changes tried, each with its rule written first

One entry per candidate: root cause, the change, the rule (written and committed before any of its rows existed),
then the data and the verdict. A candidate that fails its rule is not kept, whatever else it shows.

---

## E1 — a pack that fits the prompt is read whole on a turn that reads the files

**Written 2026-10-03 15:00 UTC. No E1 row existed; the app had not been run on this branch.**

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

### E1 — data, dev + counterfactual (2026-10-03 16:20 UTC; provisional judge, Claude Opus 5.5)

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

---

## E3 — a number the material states is not an unsupported claim (a rail on the claim pass's edit)

(E2, handing the résumé and job description over whole, is described in the report as a proposal; it was not built.)

**Written 2026-10-03 16:22 UTC, before the rail's effect was computed on any row.** What had been seen: per-category
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

### E3 — data and verdict (2026-10-03 16:25 UTC; offline, provisional judge)

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

**Written 2026-10-03 16:27 UTC, before any holdout row of the E1 build was judged.**

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
