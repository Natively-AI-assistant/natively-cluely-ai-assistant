# Data card: Auto Answer decider training data

Status: being generated (run started 2026-11-10). The numbers below are filled from
`data/work/dataset/stats.json` when the build runs. Every figure here comes from a recorded
command (see the progress log).

## What it is

Production-shaped Auto Answer candidates, each labeled **answer / silent / wait** for the §4
`respond` question. One record is one moment at which the app's judge would have been asked.

## How it is made

1. **Transcripts (synthetic).**
   - Script: `generate_transcripts.mjs`, written by AgentRouter `gpt-6.1-sol` (decision D3).
   - 1,000 meetings across the 9 modes.
   - Each is steered to 5 hard-case tags from `taxonomy.md`, least-covered first, each asked
     for twice.
   - 2 to 4 other participants; the USER is named in about 40% (always in team meetings,
     lectures and seminars).
   - Half are stripped of punctuation and casing, like STT providers without punctuation.
2. **Candidates.**
   - Script: `segment_via_replay.mjs`. Each transcript is replayed through the REAL
     `SimpleAutoAnswerEngine` on a fake clock with one of three STT profiles (streaming with
     endpoints, bursty relay with lag and stalls, REST batch).
   - Every judge request the engine makes is a record. Records include merged finals,
     stall-promoted clipped interims, mid-word cuts and the engine's own `last_answered`.
3. **Labels.**
   - Script: `teacher_label.mjs`, using `gpt-6.1-sol` with two views: the app's judge prompt,
     parsed by the app's own parser and router; and a §4 rubric.
   - The views agree → 2 votes. They disagree → both re-asked at higher effort (4 votes). A
     tie gets a 5th judge vote at high effort.
   - `soft` is the vote share, so contested records train toward uncertainty.
   - No majority at all → human adjudication (`adjudicate.html`).
4. **Splits.** 80/10/10 train/dev/calib by transcript (sha256 of the id), never by candidate.
5. **Leakage.** `leakage_check.py` runs on every build and fails it on any near-copy:
   - against every judge-eval case (gold);
   - between splits, and within a split across transcripts.
   - The test: word containment ≥ 0.8, or multilingual-e5-small cosine ≥ 0.92 for texts of 5+
     words.

## Teacher quality (measured, eval only)

The teacher was measured on the 187 gold cases, 2026-11-10: **recall 32/36, false fires
1/151**. The production decision tier scores 36/36 and 3/151. The teacher prompts were not
tuned on gold.

## What it is not

- **No real user data.** Nothing here comes from a user's meeting. Natively's telemetry carries
  lengths and reasons only, and no path from the app feeds this directory.
- **No gold.** Judge-eval sets are test-only. The leakage check enforces this on every build.
- **Not diarized.** Production candidates carry no speaker labels today, so neither does this
  data.
- **English only.** The checkpoint is the English Laya; multilingual is out of scope for this
  campaign.

## Known limits

- The transcripts are model-written, so their style is narrower than real meetings. The gold
  sets (real recordings) are what Phase 7 measures on.
- The teacher leans toward silence on asks cut off at the end (3 of its 4 gold misses). The
  student inherits this unless the cascade escalates those cases. Clipped asks have low
  confidence by construction, so it should.
- The generator's `ask` annotation drives only the replay's fake judge (engine state). It is
  never a label.
