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
