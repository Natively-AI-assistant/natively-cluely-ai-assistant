# Auto Answer miss forensics (campaign Phase 0, step 1), 2026-11-09

## What data exists

**No real user logs are in the repo or on this Mac, and none were sought.** (Natively is
local-first, and user transcripts are never collected.) What does exist:

1. **One real developer telemetry session**, from `telemetry.jsonl` in the main checkout
   (untracked), 2026-10-16. It has 9 `auto_answer_judged` events: 8 `verdict` and 1 `stale`
   (`supersededBy: interim`, a new candidate that was then judged and answered). Judge
   latency on the 8 verdicts was **715 to 1127 ms**. All 6 answers got `feedback: kept`.
   Telemetry carries no text, so this shows the pipeline worked, not whether the verdicts
   were right.
2. **`tests/auto-answer-live/results/`** is gitignored and absent on this machine. No
   live-harness outputs survive locally.
3. **The documented live rounds** in `docs/autopilot/auto-answer-v3-progress.md`, the `note`
   fields of the judge-eval sets, the dated tests, and the commit history. This is the
   evidence used below. Each row cites a line or commit. I re-checked a sample:
   google-mock-interview.json:1317, live-tech-interview-followups.json:192,
   team-meet-lecture-named.json:247, progress.md:1401, and commits 03d33772, f3c33d64 and
   a154ed31 all say what the table says.

So the counts below are **documented failures**, not a rate. They come from the developer's
own live test rounds (videos over speakers, `say` scripts, mock interviews), 2026-08-23 to
2026-09-27.

## Classes

- **(a) judge ruled wrongly:** the judge, or the heuristic before it, saw a reasonable
  candidate and returned the wrong verdict.
- **(b) pipeline dropped it:** a correct decision was lost or mangled by the plumbing
  (stale, superseded, timeout, error, unparseable, `superseded_while_parked`,
  `engine_busy_or_cooling`, a held verdict not reapplied, dedup, cooldown, echo gate).
- **(c) endpointing:** the candidate was judged too early (a fragment or clipped word) or
  too late.

Where a failure mixes classes, it is filed under the class whose fix resolved it.

## Counts

| class | documented | fixed | still open |
|---|---|---|---|
| a (judge ruled wrongly) | 29 | 20, plus 1 partial (video-testing artefact) | **8** |
| b (pipeline dropped it) | 30 | 28, plus 1 moot (old engine retired) | **1** |
| c (endpointing) | 11 | 8 | **3** |
| **total** | **70** | 56, plus 2 | **12** |

Four of the 70 (#67 to #70) were found by code review, not in a live meeting.

### Still open

| # | class | what | source |
|---|---|---|---|
| 31 | a | "transition to coding… share your screen" logistics fires | senior-swe-strings #1 |
| 32 | a | "discuss nonfunctional requirements" transition fires | system-design-leetcode #5 |
| 41 | a | screen-share suggestion fired at answerability 0.4 | progress.md:1710; fd6dd33d |
| 51 | a | follow-up ruled a restatement (DeepSeek rung) | live-tech-interview-followups #0 |
| 52 | a | challenge follow-up read as rhetorical (DeepSeek rung) | live-tech-interview-followups #1 |
| 53 | a | hypothetical setup fires before its question | live-tech-interview-followups #12; a154ed31 |
| 54 | a | session agenda answered | live-tech-interview-followups #16; a154ed31 |
| 62 | a | homework logistics fires (Natively rung) | team-meet-lecture-named #13 |
| 40 | b | two near-identical greetings both answered (exact-string dedup) | progress.md:1707 |
| 30 | c | candidate cut mid-phrase fires | google-mock-interview #43 |
| 34 | c | NativelyPro relay strips `<end>`, so no provider endpoint on the default path | progress.md:1304, 1415 |
| 64 | c | relay backlog with no interim at all | f3c33d64 (live L14) |

Rows 51 and 52 are marked open by inference: the README reports recall 1.000 only for the
Natively rung, and nothing records whether the DeepSeek-rung misses still happen.

## What this means for the decider

1. **Class b was the largest historical class (30), and nearly all of it is fixed.** Many
   of those fixes exist because the judge is slow: verdicts went stale while new speech
   arrived (#35: 25 of 28 verdicts stale in one round), timeouts (#46, #49, #57), the judge
   asked only after the window (#37), and prefetch plumbing. A local decision in the low
   hundreds of ms makes that whole family rarer. It does not make the held/stale machinery
   removable: the campaign keeps it (rule 4), and only shadow data can justify simplifying
   it later.
2. **What remains open is mostly class a (8 of 12).** These are exactly the cases where the
   prompt rules ran out: each documented fix for them broke a different case (a154ed31,
   P:1086). That is what a fine-tuned, calibrated classifier with an escalation band is
   for. The gold test must keep these 8 cases, and they are already in the judge-eval sets.
3. **Rung dependence is real** (#51, #52, #55, #62): the same candidate gets different
   verdicts on Natively, DeepSeek and OpenRouter. A single decider model gives every user
   the same behaviour regardless of their LLM provider, which is the third success criterion.
4. **Class c open items are out of the decider's reach.** #34 and #64 are relay transport
   limits that need a natively-api change. #30 (a mid-phrase cut) is partly in reach: the
   `wait` label is trained for it.
5. **Taxonomy feed for Phase 1:** rows 4, 6 to 8, 10, 12, 14 to 16, 20 to 23, 25 to 29, 31,
   32, 41 and 51 to 62 are the hard-case tags (declarative task, merged reply, comprehension
   check, logistics versus produce, permission and deferral, paraphrase, announced
   structure, name-addressed, restatement, setup-before-question, agenda).
