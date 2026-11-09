# Auto Answer decider: progress log

Governing plan: `docs/autopilot/CLAUDE_CODE_PROMPT_auto_answer_decider.md`. Decisions waiting
on Evin: `docs/autopilot/decider-decisions.md`. Branch `feat/auto-answer-decider`, worktree
`/Volumes/ExternalSSD/natively-decider`. The system disk has about 3 GB free, so the venv,
the HF cache and the ONNX artifacts all live on the ExternalSSD.

Every number below comes from a run recorded in `ml/auto-answer-decider/results/ledger.jsonl`,
with its command. "Estimate" marks anything that was not measured.

---

## Phase 0: Forensics and baselines (2026-11-09) — DONE except D2 (Windows)

### Step 1. Miss forensics → `docs/autopilot/decider-forensics.md`

- **No real user logs exist here, and none were sought.** The only real telemetry is one
  developer session from 2026-10-16: 9 judge calls, 8 verdicts and 1 stale, judge latency
  715 to 1127 ms. Live-harness results are gitignored and absent.
- **70 documented failures** were classified from the live-round history, the eval notes and
  commits. A sample of citations was re-checked by hand.

  | class | documented | still open |
  |---|---|---|
  | (a) judge ruled wrongly | 29 | 8 |
  | (b) pipeline dropped it | 30 | 1 |
  | (c) endpointing | 11 | 3 |

- What remains open is mostly class (a): the prompt-rule dead ends, which is what the decider
  targets. Many class (b) fixes exist because the judge takes about 1 s; a local decision makes
  that family rarer.

### Step 2. Current judge baseline

See "Judge gate run" below.

### Step 3. Python workspace → `ml/auto-answer-decider/`

- `requirements.txt` (pinned), `README.md`, `.gitignore` (`.venv/`, `artifacts/`, `results/runs/`),
  and `results/ledger.jsonl`, which is committed.
- `optimum` is not used: the export traces laya's own `DecisionModel`.
- Packaging: `build.files` is an allowlist that already leaves out `ml/`. An explicit `!ml/**`
  was added, pinned by `scripts/__tests__/ml-workspace-not-packaged.test.mjs` (2/2 pass).
  No `mac`/`win` override touches `files`.

### Step 4. Latency and zero-shot bench → `bench/laya_m4_bench.py`

The existing script was extended, as instructed. The five fixes:

1. **QUESTIONS** is now the exact §4 `respond` question. It lives once in
   `decider/state.py` and in `deciderState.ts`, and the TS test asserts the two are byte-identical.
2. **The state** is the shared §4 schema. The fields are built by the app's TypeScript builder
   (`electron/intelligence/autoAnswer/decider/deciderState.ts`) through
   `bench/emit_eval_states.mjs`, so `addressed_to` comes from the judge's real
   `judgeUserFirstName` / `userNameSlipsIn` / `addressedNamesIn`. The script's old state shape is gone.
   - Check: all 15 named team-meet cases resolve correctly, including the "Alec", "Evan" and
     "Kevin" slips for a user named Evin.
   - Mode: eval sets carry display names, mapped to template ids. "System Design Interview"
     maps to `technical-interview`, and a missing name defaults to `technical-interview`, as
     `judgeEval.mjs` does.
3. **`LAYA_THREADS` removed.** Only `laya/serve.py` reads it; the `Agent` API does not.
   `torch.set_num_threads` is kept, and `--threads` now caps onnxruntime too.
4. **Result shape fixed.** `system_one` returns `{"model", "answers": {qid: …}, "usage": {…}}`
   (laya 0.4.30 `agent.py`). The script now reads `out["answers"]["respond"]` strictly and
   records `choice`, `probabilities`, `confidence`, `answer_confidence`, `act_probability` and
   `usage.truncated`.
5. **Added:**
   - token-length distribution;
   - truncation stats via `return_truncation_stats`, raw and fitted;
   - int8 and fp32 ONNX CPU timing (`export/export_onnx.py`);
   - the CoreML EP (and DirectML on Windows);
   - one ledger line per run.

The old zero-shot numbers are discarded, as instructed.

**Design note: state fitting.** Laya right-truncates a JSON state, which would cut the
candidate, the one field that matters. The builder fits the state itself: it drops the oldest
context turns first, then shrinks `last_answered` to 120 chars, then drops the candidate's
leading words. The tail is always kept. TS and Python implement the same algorithm, checked
by golden fixtures written by Python (`decider/make_state_fixtures.py` →
`__tests__/decider-fixtures/state-parity.json`). The TS test reproduces those bytes; 6/6 pass,
and three mutation probes (separator, which turn drops first, ignoring STT slips) each turn it red.

**Tokens** (English checkpoint, `max_len` 512, `head_max_len` 192):

- the question head costs 139 tokens, leaving 372 for the state;
- 0/187 raw states would be truncated;
- fitted sequence length: min 195, p50 313, p90 397, max 428.

The 6-turn context fits every eval candidate. Phase 1's longer synthetic turns will exercise
the fit path.

**Latency**, MacBook Air M4 (4P+6E, 16 GB), macOS 27.0, laya 0.4.30, torch 2.15.0,
onnxruntime 1.31.1. Measured at the normal desktop load of this Mac (Chrome, a dev Electron and
Natively running; load average 4 to 6). One forward per candidate over 187 candidates, after 5
warm-up calls. Tokenization is under 0.5 ms (p90 0.47 ms), so these numbers are the model.

| backend | threads | p50 ms | p90 ms | max ms | run |
|---|---|---|---|---|---|
| torch fp32 CPU | 4 | 258 / 268 / 293 | 329 / 332 / 373 | 411 / 406 / 407 | b39f1a, 6bcf9e, 8df07c |
| torch fp32 MPS | — | 145 / 163 | 180 / 230 | 296 / 295 | b39f1a, 6abcc1 |
| **ONNX int8 CPU** | 4 | 216 / 243 | **319 / 316** | 367 / 381 | 6bcf9e, 8df07c |
| ONNX fp32 CPU | 4 | 338 / 309 | 441 / 432 | 535 / 519 | 6bcf9e, 8df07c |
| ONNX int8 CPU | ORT default (10) | 333 | 439 | 674 | d6009e (heavier load, torch p90 545 same run) |
| ONNX fp32 + CoreML EP, MLProgram | 4 | build fails (error -7, ALL and CPUAndGPU) | | | coreml-probe |
| ONNX fp32 + CoreML EP, NeuralNetwork, dynamic | 4 | 1839 | 3191 | 3791 | coreml-probe, 40 cands |
| ONNX fp32 + CoreML EP, NeuralNetwork, static shapes | 4 | 356 | 403 | 469 | coreml-probe, 40 cands |

- **CoreML partitioning:** with dynamic shapes, CoreML takes 1051 of 2208 nodes in 277
  partitions. The constant CPU/CoreML hand-offs make it about 6x slower than CPU. With static
  shapes it takes only 220 of 2208 nodes, which is CPU speed.
- **MPS:** driver memory 2.16 GB after the run. MPS isn't available to onnxruntime-node, so
  it is reference only.
- **Thread count matters:** onnxruntime's default spreads over all 10 cores, efficiency cores
  included. The app must pin the performance-core count, so Phase 4's EP adapter takes a
  thread count.
- **int8 vs fp32:** argmax agrees with torch on only **164/187 (87.7%)**, against fp32's
  187/187. The zero-shot head is near-uniform, so argmax flips easily. This is re-measured on
  the fine-tuned model against the Phase 3 target (≥99%). If it stays low, exclude the
  attention/rotary ops from quantization.
- int8 file 442 MB, fp32 1.69 GB.

**Zero-shot accuracy** (baseline only; it decides nothing). Identical on torch CPU, torch MPS
and ONNX fp32: recall **23/36** asks, false fires **94/151** non-asks, 7 waits (1 on an ask).
ONNX int8: recall 21/36, false fires 86/151. The docs call the checkpoint "a fast base to
specialise", and it is not usable zero-shot.

| set | asks recalled | false fires |
|---|---|---|
| google-islands | 3/5 | 5/7 |
| google-mock-interview | 3/3 | 35/41 |
| live-tech-interview-followups | 6/6 | 10/13 |
| senior-swe-strings | 1/3 | 5/12 |
| system-design-leetcode | 1/4 | 5/17 |
| team-meet-lecture-named | 7/11 | 9/11 |
| wordle-coding-round | 2/4 | 25/50 |

### Step 5. Gate G0

- **Path L (Laya-large int8 p90 ≤ 250 ms on M4 CPU, or ≤ 60 ms on CoreML): NOT MET.**
  - Measured int8 CPU p90 is 316 to 319 ms at normal desktop load, about 70 ms over.
  - CoreML through onnxruntime is either not buildable (MLProgram) or no faster than CPU
    (NeuralNetwork).
- **→ Path S: plan the distilled student in Phase 2.7 / 3**, a ModernBERT-base or
  DeBERTa-v3-small with the same sequence format.
- Laya-large stays the teacher and the hosted model, so Phase 1 and 2 are unchanged.
- **Caveats:**
  - These numbers are under real desktop load. An idle M4 would likely be faster (an
    estimate; not measured, because the machine is never idle in a meeting either).
  - The latency comes from the model's size, not its weights, so fine-tuning will not change
    it. A student will.
- **Phase 3 CoreML retry list:** fixed-shape export padded to 512; fp16; direct coremltools
  conversion instead of ORT's EP; splitting the ModernBERT encoder from laya's head.
- **A low-end Windows laptop has NOT been measured.** `bench/windows_bench.md` runs the same
  script there (CPU int8 / fp32, plus DirectML if `onnxruntime-directml` is installed).
  Open question D2.

### Judge gate run (step 2)

Run 2026-11-09 22:26–22:37 IST:

    NATIVELY_API_KEY=<natively-api/.env, never printed> node electron/intelligence/autoAnswer/__tests__/judgeEvalGate.mjs

The Natively decision tier, 3 passes, 561 calls, one at a time. Exit 0: **no set regressed**.

- **Recall 36/36** in every pass, on every set.
- **False fires: 3 per pass (3/151)**, all already documented: google-mock-interview #43,
  live-tech-interview-followups #12 and senior-swe-strings #1.
- system-design-leetcode #5 and team-meet-lecture-named #13, which the 09-27 baseline counted
  as false fires, did not fire in any of the 3 passes.
- Wall time was 181 to 224 s per pass of 187 sequential calls, about 1.0 to 1.2 s per call
  including client overhead.
- This spent production credit through the Natively key: about 1.4M tokens, roughly $0.50 by
  estimate.

**This is the Phase 7 bar for "the current judge": 36/36 asks, 3 false fires.**
`judge-eval-baseline.json` was NOT re-baselined (rule 8).

### Files (Phase 0)

- `electron/intelligence/autoAnswer/decider/deciderState.ts`: the §4 question and state
  builder. Pure, and not wired into anything yet, so app behaviour is unchanged.
- `electron/intelligence/autoAnswer/__tests__/DeciderState2026_11_09.test.mjs` and
  `decider-fixtures/state-parity.json`.
- `ml/auto-answer-decider/`:
  - `requirements.txt`, `README.md`, `.gitignore`
  - `decider/state.py`, `decider/make_state_fixtures.py`
  - `bench/laya_m4_bench.py`, `bench/emit_eval_states.mjs`, `bench/coreml_probe.py`, `bench/windows_bench.md`
  - `export/export_onnx.py`
  - `results/ledger.jsonl`
- `package.json` (`!ml/**`) and `scripts/__tests__/ml-workspace-not-packaged.test.mjs`.
- `docs/autopilot/`: this log, `decider-forensics.md`, `decider-decisions.md`, and the campaign prompt.

### Commands run (Phase 0)

    git worktree add -b feat/auto-answer-decider /Volumes/ExternalSSD/natively-decider main
    git submodule update --init premium natively-api
    python3.12 -m venv ml/auto-answer-decider/.venv && pip install laya torch onnx onnxruntime numpy scikit-learn scipy
    npm run build:electron
    node ml/auto-answer-decider/bench/emit_eval_states.mjs
    HF_HOME=<ssd> ml/auto-answer-decider/.venv/bin/python ml/auto-answer-decider/bench/laya_m4_bench.py --devices cpu mps          # b39f1a (ONNX export failed: fused encoder op; fixed)
    HF_HOME=<ssd> …/laya_m4_bench.py --devices cpu                                                                                  # d6009e (export ok; ORT default threads)
    HF_HOME=<ssd> …/bench/coreml_probe.py                                                                                           # 4 CoreML configs, 40 candidates
    HF_HOME=<ssd> …/laya_m4_bench.py --devices cpu --threads 4 --no-accelerator   (x2)                                              # 6bcf9e, 8df07c
    HF_HOME=<ssd> …/laya_m4_bench.py --devices mps --skip-onnx                                                                      # 6abcc1
    ml/auto-answer-decider/.venv/bin/python ml/auto-answer-decider/decider/make_state_fixtures.py
    node --test electron/intelligence/autoAnswer/__tests__/DeciderState2026_11_09.test.mjs                                          # 6/6, plus 3 mutation probes red
    node --test scripts/__tests__/ml-workspace-not-packaged.test.mjs                                                                # 2/2
    npm run typecheck:electron                                                                                                      # exit 0
    electron --test "electron/intelligence/autoAnswer/__tests__/**/*.test.mjs"  (via scripts/run-with-env.mjs, as test:auto-answer) # 157/157

### Validation categories (Phase 0)

- **Tested physically on macOS:** the bench (torch CPU/MPS, ORT CPU, CoreML EP) on an M4 Air.
- **Requires physical Windows verification:** the bench (D2). `deciderState.ts` is pure TS with
  no platform branch.
- Nothing native, no window, IPC or packaging behaviour changed. The one packaging edit is an
  extra exclusion of a directory that was never packaged.

### Open questions

- **D1:** gate on `answer_confidence`, not `confidence`? The laya source says only the former
  is calibrated.
- **D2:** Windows low-end laptop bench.

---

## Phase 1: Data engine (started 2026-11-09). PARTIAL, generation and labeling blocked on D3

### Done (no spend needed)

- **Step 1: schema** → `ml/auto-answer-decider/data/schema.md`.
  - One record per production-shaped candidate.
  - Splits are by transcript, never by candidate.
  - Includes the judge→label mapping.
- **Step 2: taxonomy** → `ml/auto-answer-decider/data/taxonomy.md`.
  - 32 tags, from every `JUDGE_PROMPT_RULES` rule, the dated tests and the forensics rows.
  - Quotas: ≥300 per tag and ≥20 per applicable (tag, mode) pair.
  - About 50% unpunctuated.
  - No diarization labels, matching production: `main.ts` sends no `speakerId` to the engine.
- **Step 5: segmenter** → `data/segment_via_replay.mjs`.
  - Drives the REAL `SimpleAutoAnswerEngine` on `FakeClock` with a recording host. Every
    `JudgeRequest` the engine emits becomes a candidate.
  - Three STT profiles:
    - `streaming-endpoint`: interims 2 to 4 per word, finals at clauses, a provider endpoint
      and the local VAD hint;
    - `relay-bursty`: bursty finals; 12% mid-word cuts with the remainder as the next
      final's first token; in-order delivery; 25% of last finals lag 3.5 to 8 s and 5% never
      arrive; 60% of stalls freeze the interim on a clipped word;
    - `rest-batch`: no interims, one final 1.0 to 2.5 s after the stop, no hint.
  - A 3.5 to 8 s answer stream parks candidates as the engine does.
  - The generator's `ask` annotation drives a fake judge, so `lastAnsweredText` and the
    held/stale paths evolve realistically. **Labels still come from the teacher.**
  - `--self-test`: 9 / 6 / 4 candidates per profile on a 5-turn script. Stall runs produce
    clipped lagging candidates ("…for enterprise bu"), matching the 09-27 live pattern.
  - Three simulator bugs were found and fixed while building it:
    - interims too sparse, so it judged between words;
    - mid-word remainder glued to the next word;
    - a lagging final overtaken by later finals.
  - Note: the campaign prompt's §1 names a `replay.mjs`. There is none for Auto Answer;
    the engine is driven the way `AutoAnswerSimple.test.mjs` drives it.
- **Step 8 (tool): leakage check** → `data/leakage_check.py`.
  - Containment ≥0.8 OR e5 cosine ≥0.92, using the app's bundled multilingual-e5-small,
    sha256-verified against its manifest.
  - Checks every split against gold, and every pair of splits across transcripts.
  - Exits 1 on any leak.
  - `--self-test` passes: it flags an exact copy, a paraphrase and an exact short string,
    and passes clean text.
  - **Interpretation:** under 5 words, e5 rates "and how?" vs "and why?" above 0.92 (measured
    in the self-test). So short texts leak only on exact normalized equality; otherwise every
    generic follow-up probe would be barred from training.

### Blocked

- **Steps 3 and 6 (generation, teacher labeling): D3.** Provider, budget cap and a separate
  key. Estimated cost is far over $5. The prod keys in `.env` must not be used.
- **Step 4 (public corpora):** optional. Not started; licenses still to be checked (AMI is
  CC BY 4.0; Switchboard needs an LDC license).
- **Step 6 adjudication tool and step 7 gold expansion:** need data first. Gold expansion
  also needs recordings from Evin.

### Commands run (Phase 1 so far)

    node ml/auto-answer-decider/data/segment_via_replay.mjs --self-test
    ml/auto-answer-decider/.venv/bin/python ml/auto-answer-decider/data/leakage_check.py --self-test --e5-dir <main checkout>/resources/models/Xenova/multilingual-e5-small

### 2026-11-10: D3 answered (AgentRouter gpt-6.1-sol, no cap); teacher measured; full run started

- **New scripts:**
  - `data/agentrouter_client.mjs`: Responses API, `originator` header, pacing, 402
    batch-wait, 429 backoff, `response.incomplete` handling.
  - `data/teacher_label.mjs`: the judge-prompt view plus the §4 rubric view at effort `none`;
    on disagreement both re-run at `medium`; majority vote; a tie goes to adjudication.
  - `data/generate_transcripts.mjs`: quota planner from `taxonomy.md`, 5 tags per transcript
    asked for twice each, 50% unpunctuated, `USER_ECHO` speaker for `user_own_voice`.
  - `data/emit_fields.mjs` and `data/build_dataset.py`: by-transcript 80/10/10 split,
    leakage check, Laya rows in the confirmed `target_from_gold` format.
- **Teacher accuracy on gold (EVAL ONLY; no gold text is used for labels or prompts):**

      AGENTROUTER_API_KEY=<.env> node ml/auto-answer-decider/data/teacher_label.mjs --gold --out ml/auto-answer-decider/results/runs/teacher-gold-gpt61sol.jsonl --concurrency 3

  - Ensemble: **recall 32/36, false fires 1/151.** For comparison, the production decision
    tier scores 36/36 and 3/151.
  - First-pass agreement 178/187; 7 ties went to adjudication.
  - The misses are 3 asks cut off at the end (teacher says wait) and 1 case the teacher reads
    as the user's own follow-up.
  - 72 gold "silent" cases came back as **wait**: mid-explanation fragments. Neither label
    fires, so answer-vs-not accuracy is unaffected.
  - **The teacher prompts were NOT tuned on these results.** Doing so would leak gold into
    the labels.
  - Throughput: 20 min for 187 records at 3 workers. 51 upstream token-rate-limit retries,
    so 3 is about the gateway ceiling.
- **Segmenter timing fix.** Interims now arrive every 70 to 110 ms, with real pauses:
  hesitations on ~7% of words and breaths on ~35% of clause ends.
  - Before the fix, gaps of up to 215 ms between interims set off the engine's 120 ms early
    judge mid-word, so 53% of pilot candidates were "incomplete". After: 39%.
  - Pilot: 4 transcripts → 117 candidates.
- **Full run started 2026-11-10 21:10 UTC**, detached, logs in `natively-decider-cache/`:
  - generation: `--n 1000 --seed 1 --concurrency 2` → `data/work/transcripts.jsonl`
    (log `gen.log`);
  - pilot labeling at concurrency 1 (log `pilot-label.log`).
  - Estimate: ~5 min per transcript per worker, so about 40 h for 1,000 at 2 workers.
- **Internal disk is at 187 MB free.** Claude Code's temp output lives there; everything in
  this campaign writes to the SSD.

### 2026-11-10 (cont.): pilot end to end; Phase 3 sequence port with parity

- **Restart lesson.** The detached runs died with the session at 21:36 UTC; the generator was at
  15/1000 and pilot labeling at 72/117. Both resumed from their outputs. They now start with
  `os.setsid()` (their own session), so a Claude Code restart cannot kill them. Generation
  measures ~97-100 s per transcript at 2 workers, about 27 h for the rest.
- **Teacher tie handling.**
  - The two views split on audio and readiness checks ("can you hear me okay?").
  - The production judge prompt makes those `answer` (rule: "small logistics they still have
    to respond to"), so the rubric now says the same. This comes from the judge prompt, not
    from gold.
  - A 2-2 tie gets a 5th vote: the judge prompt at `high` effort. The soft label keeps the
    3/5 split.
  - `adjudicate.html` (offline; keys a/s/w/x and arrows; exports JSONL) handles any record
    still without a majority. `build_dataset.py --adjudicated` merges the export back with
    one-hot labels.
- **Leakage check: bag-of-words containment was wrong.**
  - On the first pilot build, "and what would you change?" "contained" itself in three
    unrelated long texts, one of them gold.
  - Containment is now over normalized word trigrams, i.e. copying, not shared vocabulary.
  - Self-test adds that exact false positive (must pass) and a gold ask embedded in a longer
    synthetic candidate (must leak). PASSED.
- **Pilot build** (4 transcripts → 117 candidates → 117 labels):

      .venv/bin/python data/build_dataset.py --candidates data/work/pilot-candidates.jsonl --labels data/work/pilot-labels.jsonl --out data/work/pilot-dataset --e5-dir <main>/resources/models/Xenova/multilingual-e5-small

  - 0 leaks; 110 records, 7 to adjudicate.
  - Fit dropped context turns on 15 records; no candidate was cut.
- **`laya-train --dry-run`** on the pilot rows: 21/21 train and 89/89 eval valid, none
  skipped. The row format is accepted by the trainer itself.

      .venv/bin/laya-train --data data/work/pilot-dataset/train.laya.jsonl --eval data/work/pilot-dataset/dev.laya.jsonl --dry-run --device cpu

- **Phase 3, steps 3 and 4 (done early: the input format does not change with fine-tuning).**
  - Files: `decider/layaSequence.ts` (build_head, build_sequence, collate, decode, clamp,
    temp buckets) and `decider/layaTokenizer.ts` (a transformers.js adapter that resolves the
    special ids from the vocabulary, because `cls_token_id` is undefined in transformers.js
    3.8 for this tokenizer).
  - Fixtures: `export/make_sequence_fixtures.py` writes 303 cases (187 gold, 113 pilot,
    3 edge: a mask token, astral characters and U+2028, an over-long candidate) plus 3
    head-cap questions, and ships the checkpoint tokenizer gzipped (637 KB, Apache-2.0
    NOTICE).
  - `DeciderSequence2026_11_10.test.mjs`: 8/8 pass (2 ONNX tests skip without the model).
    The TS fit reproduces Python's serialized state, and ids, markers and truncation are
    IDENTICAL on all 303. Decoded probabilities and both confidences agree within 1e-4.
  - Mutation probes: mask not replaced, option cap 47, K floor 1, per-option budget, and
    no temperature. All red. The first run had 2 probes green, which led to adding the
    head-cap fixtures and a lone one-option collate case.
  - **ONNX through onnxruntime-node 1.22 (the app's runtime), zero-shot export:** fp32 logits
    within 1e-3 of Python on 303/303. **int8 keeps fp32's argmax on only 196/303.** That is
    the known zero-shot int8 problem; the ≥99% bar applies to the fine-tuned export.

      DECIDER_ONNX_DIR=$PWD/ml/auto-answer-decider/artifacts/zero-shot-onnx node --test electron/intelligence/autoAnswer/__tests__/DeciderSequence2026_11_10.test.mjs
