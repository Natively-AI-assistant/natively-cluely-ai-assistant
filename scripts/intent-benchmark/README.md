# Intent benchmark harness

Phase 2 and 3 of the interaction-router campaign. Builds the dataset, and (Phase 3) will run every candidate against it through one interface.

## Layout

```
analyze-telemetry.mjs   real production priors from the local marker-only log
generate.mjs            corpus generation, gated on STT realism and the schema
handcheck.mjs           export a 20% founder review file, and score it back
lib/schema.mjs          the row contract, the validator, the held-out split
lib/modeSpecs.mjs       per-mode roles, label sets and grounding defaults
lib/prompts.mjs         generation prompt, category briefs, required traps
lib/sttRealism.mjs      the gate that decides if the corpus is worth building on
lib/gemini.mjs          minimal JSON client, standalone from the app stack
dataset/                the corpus (gitignored where large; v1 is committed)
reports/                hand-check files and generation summaries
__tests__/              contract tests for the schema and the realism gate
```

## The two decisions that shape everything else

### Balanced generation, production-weighted reporting

The corpus is generated BALANCED across modes and categories, not weighted to the production distribution measured in `docs/natively-router-production-priors-2026-09.md`.

The reason is that the two weightings answer different questions and only one of them can be baked into a corpus. Production weighting measures what ships today. Balanced weighting measures what a model could learn. If the corpus were production weighted, `follow_up` would get about three rows out of 1,500 and the held-out split would contain none, because that label fires on 0.2% of real turns. A per label F1 computed on zero examples is not a number.

So: generate balanced, and apply the production weights at REPORTING time as a separate weighted slice. Phase 5 reports both, and says which is which. The acceptance bar in the brief is read against the balanced split, because it is a statement about model capability.

### The split is hashed over the ID, never the content

`splitFor(id)` hashes the row id, which is a synthetic key of mode abbreviation plus sequence.

This looks like a detail and is not. Phase 6 regenerates this corpus at 20,000 rows for distillation. If the split hashed row content, then relabelling a row, fixing a typo in `input`, or regenerating at a different temperature would move rows across the split boundary. Rows held out for the Phase 5 decision would drift into Phase 6 training, and the rule that nothing may train on the held-out split would break silently, via an edit that looked cosmetic.

## STT realism is the gate everything else depends on

A cloud LLM asked for "transcript lines" produces clean prose with the capitals stripped. That failure is invisible by inspection at 1,500 rows and fatal: every Phase 4 candidate would be scored on an input distribution that does not occur in production, and the winner would be whichever model likes tidy text most. Labelling cannot repair it.

`lib/sttRealism.mjs` measures it objectively and `generate.mjs` refuses batches that fail. A rejected batch is retried once with an explicit critique of what it got wrong, then dropped and reported. It is never silently accepted, because a corpus padded with clean prose is worse than a smaller honest one.

Two things about the gate were wrong in the first smoke run and are worth recording, because both would have looked like generator problems.

**Rates need a sample.** The gate was applied per cell, and cells were as small as one row. A single row is either 0% or 100% short. Nineteen of twenty-four cells were rejected on statistical noise. Rate checks are now skipped below `MIN_SAMPLE_FOR_RATES` and the per-row hard checks (any punctuation, any capital, exact duplicates) still apply at any n. The rates are then re-evaluated over each mode's full output, where n is in the hundreds and they actually bite.

**Targets are per category.** A multi-intent turn is never five words, so demanding that 15% of that category be short rejected correct output. `CATEGORY_PROFILES` sets expectations per category, and `minShortRate: null` means the check does not apply.

The `no_response` short-turn floor was also set by intuition at 0.45 and rejected spec-conformant output measured at 33% and 42%. It is now 0.30, derived from the category's own composition: the brief asks for six kinds of event and only two of them are inherently short.

### What "realistic" measured out at

From a smoke run over team-meet and recruiting, n=108: punctuation 0.0%, uppercase 0.0%, fillers 41.7%, repairs 16.7 to 22.9%, short turns 22.9 to 30.0%, median 8 to 11 words.

Sampled inputs, unedited:

```
so uh what is your status on the auth logic
what was the the the final decision on the latency target for the q three rollout
im kind of wondering if we could uh use a redis cash instead of
how come the the q quarry failed
what was the the reason we chose sql instead of the no sequel
why
yeah exactly
```

The homophone errors are the tell that this is not stripped prose: `cash` for cache, `q quarry` for query, `no sequel` for NoSQL. Those are CTC acoustic confusions, not typos.

## Cross-batch dedup

Batches are generated independently and cannot see their siblings, so common short turns recur. Measured at 5% of one smoke run. Duplicates are worthless in a benchmark: identical inputs add no information, and if two copies receive different labels they actively corrupt the score. Dedup is keyed on `(mode, input)` so the same backchannel may appear in a different mode, where its correct labels genuinely differ.

## `voice` is derived, not labelled

Two LLM labelling passes both failed, in opposite directions, which is the tell that this was never a judgement call.

The first collapsed to `advisor`: 103 of 104 responding Sales turns and 102 of 102 Seminar turns, in modes whose entire contract is that the output is what the user says aloud. The cause was the definition, not the model. `voice` was handed over as a bare enum with no statement of which mode implies which value, so the labeller chose the most neutral-sounding option.

The definition was rewritten to name each mode's default, and the second pass over-corrected the other way: 86 of 89 Team Meet turns became `first_person_script` in a mode whose primary job is capture, and 51 Recruiting turns became `first_person_script` in a mode where the user is the interviewer. That second one mattered. Labelling those first person instructs the system to hand the recruiter the candidate's words, which is precisely the channel inversion the whole campaign exists to fix. Shipping a corpus that taught it would have been self-defeating.

So `voice` is now computed by `lib/deriveVoice.mjs` from mode, `mode_intent` and `needs_response`. That is not a shortcut. The Phase 1 audit had already established that voice is fixed per mode by the prompt, with exactly two documented deviations: Team Meet switches to first person when the user is called on, and Lecture switches when the student is answering. The router's per-mode `default_voice` config will compute it the same way in production, so the corpus derives the label the way the product will derive it.

The consequence has to be stated rather than buried. Because `voice` is a deterministic function of two other labelled fields, a candidate scored on it is being measured on whether it can learn that function, not on independent judgement. It must not be counted as an independent axis in the acceptance bar. Scoring it as if it were would inflate any model that already gets `mode_intent` right.

## What v1 actually contains

1,813 rows, generated 2026-09-04, `dataset/v1.jsonl`.

| Property | Value | Requirement |
|---|---|---|
| rows | 2,008 (1,813 English + 195 code-switched) | 1,500 for the first benchmark run |
| held out | 377, 20.8% | 20% |
| `needs_response = no` | 775, 42.7% | at least 40% |
| rows per built-in mode | 151 to 200 | at least 150 |
| custom-mode rows | 277 across three modes | at least 150 |
| within-mode duplicate inputs | 0.0% | near zero |
| copies of a generation-prompt example | 0 | zero |
| `grounding = mode_files` with no files attached | 0 | zero, by contract |
| punctuation / uppercase in `input` | 0.0% / 0.0% | near zero |
| fillers / repairs / short turns | 42.4% / 23.8% / 20.0% | plausible speech |

The legacy control labels are present on every row and are balanced by construction: `follow_up` has 95 rows here against 0.2% of production traffic. That is the balanced-versus-weighted decision doing its job. A production-weighted corpus would have given it three rows and a held-out split with none, and its per-label F1 would have been unmeasurable.

`reports/handcheck-v1.tsv` holds the 373-row founder review sample, spread across every mode.

## Candidate P: punctuation and truecasing restoration

The brief assumed an off-the-shelf ONNX restoration model existed. None does in a transformers.js layout. `1-800-BAD-CODE/punctuation_fullstop_truecase_english` ships a raw `.onnx` but pairs it with a SentencePiece model and no `tokenizer.json`, which would mean adding a native SentencePiece dependency to an Electron app that already carries a lot of native-module surface.

So the model is exported here instead, which is the path the brief explicitly allows. `tools/export_punctuation_onnx.py` exports `unikei/distilbert-base-re-punctuate`, whose 24 labels fuse a casing decision and a trailing-punctuation decision into one token (`{UPPER|Upper|lower}{_|.|,|!|?|:|;|-}`). That fusion is why one model covers both halves of what the brief calls punctuation and truecasing.

The export writes only `onnx/model_quantized.onnx`, 65MB. It deliberately deletes the fp32 graph, because torch 2.12's exporter puts weights in a sidecar `.data` file and shipping both would add 265MB of dead weight that nothing loads: every ONNX consumer in this repo passes `dtype: 'q8'`.

The model is gitignored, like every other model in `resources/models`. The export script is the reproducible way to obtain it.

The decoder is production code, `electron/llm/punctuationRestoration.ts`, not a harness copy, so the benchmark measures what would ship. It is pure, so the whole subword problem is testable without loading anything. Restoration runs in its own worker, because the worker rule applies here as everywhere else.

### What restoration actually buys, measured

Over all 2,008 rows, restoration ran at p50 3.0ms and p95 5.3ms inside the worker, and zero rows were rejected by the faithfulness guard.

| Language | rows | questions | question mark recovered | false positive |
|---|---|---|---|---|
| English | 1,813 | 514 | 42.4% | 13.2% |
| Hinglish | 88 | 35 | 34.3% | 15.1% |
| Manglish | 107 | 28 | 10.7% | 10.1% |

The English number is modest and the Manglish number is close to useless, which is expected: the model is English-only, and Malayalam code-switching is outside its training distribution entirely. This is exactly the measurement candidate P exists to produce. Whether restoration helps a given candidate is now an empirical question the harness can answer per provider, rather than an assumption baked into the corpus.

Two caveats on reading the recall figure. Some rows labelled `question` are mid-sentence cuts where the endpointer fired early, so no sentence-final mark is correct for them and a miss is not an error. And the false-positive rate matters as much as recall here, because the downstream scorer treats `restored` as weaker evidence than a provider mark precisely so a wrong question mark cannot do the damage the LocalWhisper mis-stamp once did.

Raw text is never overwritten. `input_punctuated` is a second field, and a restoration that changes any WORD rather than only marks and casing is rejected outright.

## Hinglish and Manglish

88 Hinglish and 107 Manglish rows, across team-meet, technical-interview, sales and call-center. Latin script only, because that is what an English-trained STT model emits when it hears Hindi or Malayalam: it transliterates rather than switching alphabet, and mangles the non-English words characteristically.

These were generated but NOT verified by a speaker of either language. They are in `reports/handcheck-v1.tsv` with a `lang` column so the review can cover them, and they are reported separately and never gated on. A synthetic guess at code-switching can look plausible to someone who does not speak the language and still be wrong about which words switch and where, so a review verdict of "unnatural" is a useful answer rather than a failure.

## Running it

```bash
export GEMINI_API_KEY=...            # generation only; nothing else needs it

node scripts/intent-benchmark/analyze-telemetry.mjs
node scripts/intent-benchmark/generate.mjs --smoke --per-mode 60 --modes team-meet,recruiting
node scripts/intent-benchmark/generate.mjs --all --per-mode 150 --out dataset/v1.jsonl

node scripts/intent-benchmark/handcheck.mjs export --in dataset/v1.jsonl
# fill WRONG_AXES in a spreadsheet, save as TSV
node scripts/intent-benchmark/handcheck.mjs score --in reports/handcheck-v1.filled.tsv

node --test "scripts/intent-benchmark/__tests__/*.test.mjs"
```

`handcheck score` exits non-zero when any axis exceeds 10% disagreement. Per the brief that means the axis DEFINITION is wrong rather than the labels, and it gets rewritten and relabelled before Phase 4 spends anything on adapters.

## Known gaps

`input_punctuated` is not yet populated. It is produced by the restoration step (candidate P), which extends `electron/llm/punctuationProvenance.ts` rather than sitting beside it. Until then every candidate is scored on raw input only, and the with-and-without comparison the brief asks for cannot run.

Hinglish and Manglish rows are not generated yet. They need a native speaker to verify the code-switching and the STT error patterns are real; synthetic ones would measure a guess at the language. Reported separately and not gated on, per the brief.

Real transcripts were looked for and do not exist in a usable form. `logs/main.log` carries no speaker-tagged lines. `logs/telemetry.jsonl` is marker-only, which is what makes the priors analysis privacy-safe, and also means it contains no utterances to mine. So sourcing falls to synthetic, which is step three of the brief's order rather than step one.
