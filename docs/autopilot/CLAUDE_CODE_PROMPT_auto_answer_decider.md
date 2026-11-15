# CLAUDE CODE AUTOPILOT PROMPT: Auto Answer Decision Layer (Laya local, hosted tier, fine-tuned on device)

Paste everything below the line into Claude Code, run from the root of
`natively-cluely-ai-assistant` on a clean checkout of `main`, on the MacBook Air M4 (16 GB).
Install the companion skill first so the rules survive context compaction:

```
.claude/skills/auto-answer-decider/SKILL.md
```

---

## 0. Mission

Replace the LLM judge in Auto Answer's hot path with a fast, calibrated decision model.
Generative AI should only write the answer, not decide whether to answer.

The target system:

```
interviewer speech stops (existing endpointing + Smart Turn)
  → DecisionBackend.decide(state)          ← NEW, tens to hundreds of ms
       high confidence "answer"  → dispatch the answer now
       high confidence "silent"  → nothing
       "wait"                    → hold for more speech
       low confidence            → escalate to the existing LLM judge (unchanged code)
```

DecisionBackend has three implementations, selected by entitlement and settings:

1. **LocalLaya.** A fine-tuned Laya checkpoint, exported to ONNX, running in the
   onnxruntime-node that the app already ships. CoreML execution provider on macOS,
   DirectML or CPU on Windows, with CPU fallback on both.
2. **Hosted.** A natively-api endpoint that proxies to either a self-hosted `laya-serve`
   running the same fine-tuned weights on a GPU host, or JEV (TypeSafe AI's hosted model).
   Both upstreams share the `/v1/systemone` request and response shape.
3. **LlmJudge.** Today's `judgeCandidate` path, kept as the escalation target and last fallback.

Auto Answer becomes a paid feature. Hosted is the default paid runtime. Local Laya is the
paid privacy option.

Success means all three of these, measured and not assumed:

- On the gold test set, the new system answers at least every real ask the current judge
  answers, and fires no more often on non-asks, in every mode.
- The decision lands fast enough to hide inside the existing stop-confirmation window.
- Behavior is identical for every user regardless of which LLM provider they configured.

## 1. What already exists (read before touching anything)

Use the code-review-graph tools first, as CLAUDE.md requires.

- `electron/intelligence/autoAnswer/SimpleAutoAnswer.ts` is the engine. It handles the
  stoppage windows (`STABILITY_MS` 900, `EARLY_JUDGE_MS` 120, `ENDPOINT_CONFIRM_MS` 350),
  prefetch, held and stale verdicts, the stall cap, and the fallback to '?' plus an
  interrogative lead when the judge fails.
- `electron/intelligence/autoAnswer/AutoAnswerJudge.ts` holds the prompt, parser, routing,
  and the name helpers `judgeUserFirstName`, `userNameSlipsIn` and `addressedNamesIn`.
  The prompt's rules list is the hard-case taxonomy. Every rule in it came from a live failure.
- `electron/main.ts` around `judgeCandidate` wires the host, and
  `LLMHelper.generateJudgeVerdict` runs the provider ladder.
- `electron/intelligence/autoAnswer/__tests__/judge-eval/*.json` contains 187 labeled real
  candidates across 7 sets: `text`, `ctx`, `lastAnswered`, `mode`/`modeName`, `userName`,
  and `expect` of `ask`, `silent` or `none`. These sets are **TEST ONLY**.
- `judgeEval.mjs`, `judgeEvalGate.mjs` and `judge-eval-baseline.json` provide the nightly gate.
- The replay fixtures, `replay.mjs`, `fakeClock.mjs` and `tests/auto-answer-live/` make up
  the live harness.
- `AutoAnswerUsageTelemetry.ts` and the `auto_answer_*` telemetry events.
  `judgeOutcome` takes the values verdict, stale, timeout, error, unparseable and
  held_applied. The skip reasons include `superseded_while_parked` and
  `engine_busy_or_cooling`.
- `resources/models/pipecat-ai/smart-turn-v3/manifest.json` and
  `electron/services/LocalFallbackAssets.ts` are the existing optional model-download
  pattern (url, sha256, bytes, license). Copy it for the Laya model.
- `onnxruntime-node` 1.22.0 and `@huggingface/transformers` 3.8.1 are already dependencies.
  The ONNX worker isolation lives under `electron/rag/`.
- The `premium/` submodule holds Pro features. The `natively-api/` submodule is the
  Fastify service on Railway.

Laya facts. Verify each against the installed package source; do not trust this list blindly.

- PyPI package `laya` (0.4.30 at the time of writing), Apache 2.0, by Convai Innovations.
- The English checkpoint `convaiinnovations/laya` is ModernBERT-large, 421M parameters,
  512 tokens. A multilingual checkpoint is mmBERT-base, 322M, 1024 tokens.
- A question has the shape
  `{"type":"choice","instructions":"... `field` ...","criteria":{label: description}}`.
- The state is a string or JSON. The sequence is
  `[CLS] type instructions [SEP] [MASK] opt0 [MASK] opt1 ... [SEP] state [SEP]`,
  built by `laya.common.build_sequence`.
- `agent.system_one(state, questions)` returns per question `choice`, `probabilities`,
  `confidence` (normalized entropy) and `answer_confidence`.
- **Gate on `confidence`.** The docs report that `action.act_probability` carries no usable
  signal (AUROC 0.30).
- Checkpoints ship overconfident. Refitting the temperature lowered ECE from 0.466 to 0.081
  in their docs. Use `laya.fit_temperatures` and `fit_abstention_thresholds`.
- Fine-tuning runs through the `laya-train` CLI. Flags: `--data --eval --out --base
  --epochs --micro-batch --grad-accum --encoder-lr --head-lr --loss rlcd|soft-ce
  --label-smoothing --shuffle-options --freeze-encoder --target-error --device
  auto|cpu|cuda|mps --seed --max-len --head-max-len --dry-run`.
- Training rows are JSONL: `{"state":…, "questions":{qid:{…}}, "expected":{qid:"label"}}`,
  or `"gold":{qid:<distribution>}` for soft labels. Confirm the exact `gold` format in
  `laya/train.py` (`target_from_gold`).
- The package has an `ONNXAgent` that consumes an exported `laya.onnx`, but no exporter.
  You will write the export.
- Published latency: about 33 to 40 ms per question on a T4 GPU, and 193 to 464 ms on CPU.
  The docs say it is "a fast base to specialise, not a zero-shot decision engine".

## 2. Hard rules (non-negotiable)

1. **No user data, ever.** Natively is local-first. Do not add any path that sends, stores
   or logs real user transcripts for training. Telemetry stays length-and-reason only.
   The hosted tier must not persist candidate text, and must not log it at info level or
   above.
2. **Eval sets are test-only.** Never put a judge-eval case, a paraphrase of one, or a
   near-duplicate into training data. Enforce this with a leakage check that fails the
   build. Use normalized-text containment of at least 0.8, plus embedding cosine of at
   least 0.92 using the bundled multilingual-e5-small.
3. **Measure, don't assume.** Every latency or accuracy claim in a commit message, doc or
   report comes from a run you executed, with the command recorded. Label estimates
   as estimates.
4. **Do not delete the LLM judge**, its prompt, its tests or the held/stale machinery in
   this campaign. They become the escalation path. Simplification happens only after
   shadow data justifies it, and only with explicit user approval.
5. **Follow the cross-platform contract in CLAUDE.md** for everything native: execution
   providers, model paths, downloads, worker processes. Use an injectable platform, test
   both branches, never mutate `process.platform`, and use the completion-report categories.
6. **Stop and ask the user** (write the question to `docs/autopilot/decider-decisions.md`,
   then continue with unblocked work) before any of these:
   - spending money: teacher-LLM labeling beyond $5, GPU rentals, JEV calls beyond a free
     tier;
   - creating accounts or entering credentials;
   - deploying anything;
   - moving code between the open repo and `premium/`;
   - changing what free users get;
   - flipping any default.

   Never put API keys in the repo. Read them from env vars the user sets.
7. **No Python in the shipped app.** Python lives only under `ml/auto-answer-decider/`.
   Exclude that directory from electron-builder `files` and from asar.
8. **Do not weaken existing tests** or re-baseline the judge gate to make anything pass.

## 3. Phase plan

Work on branch `feat/auto-answer-decider`, one commit or more per phase. Keep the
progress log at `docs/autopilot/auto-answer-decider-progress.md`, updated at the end of
every phase with what was done, the measured numbers, the commands run, and open
questions. Run the existing test suites after each phase that touches app code.

### Phase 0: Forensics and baselines (no app code changes)

1. **Miss forensics.** From the auto answer telemetry schema and any local verbose logs or
   live-harness outputs under `tests/auto-answer-live/`, write
   `docs/autopilot/decider-forensics.md`. It must classify every known miss and false fire
   as one of:
   - (a) judge ruled wrongly;
   - (b) pipeline dropped it (stale or superseded, timeout, error, unparseable,
     `superseded_while_parked`, `engine_busy_or_cooling`, held verdict not reapplied after
     text growth);
   - (c) endpointing (judged too early or too late).

   Report the counts. If real logs are not available in the repo, say so plainly and build
   the classification from the replay harness instead.
2. **Current judge baseline.** Run `npm run test:auto-answer:judge-gate` if a key is
   available. Otherwise record that it could not run and use `judge-eval-baseline.json` as
   the baseline.
3. **Python workspace.** Create `ml/auto-answer-decider/` with `pyproject.toml` or
   `requirements.txt` (pin `laya`, `torch`, `transformers`, `onnx`, `onnxruntime`,
   `optimum` if useful, `numpy`, `scikit-learn`, `scipy`), a `.venv` (gitignored), a
   README, and a `results/ledger.jsonl` where every experiment appends one line: id,
   commit, data hash, config, metrics, latency, hardware.
4. **Latency and zero-shot benchmark** (`bench/laya_bench.py`). Load
   `convaiinnovations/laya`. Build the state for each of the 187 judge-eval candidates with
   the schema in §4. Run one `system_one` per candidate with the §4 question, on `cpu` and
   on `mps`. Report:
   - p50, p90 and max latency;
   - token length distribution;
   - zero-shot recall, false fires and wait count against `expect` (treat `silent` and
     `none` as not-ask).

   Also time an int8 dynamic-quantized ONNX export on onnxruntime CPU, and the CoreML EP if
   the Python onnxruntime build exposes it.
5. **Write gate G0 in the log.** The zero-shot numbers are a baseline only; do not decide
   anything on them. The latency numbers decide the model size path:
   - **Path L:** Laya-large int8 meets p90 ≤ 250 ms on M4 CPU, or ≤ 60 ms on CoreML.
   - **Path S:** it does not, so plan a distilled student in Phase 3.

   Mark clearly that a low-end Windows laptop has not been measured. Write a standalone
   script the user can run there (`bench/windows_bench.md` plus the same script) and add
   it as an open question.

### Phase 1: Data engine

Goal: 15k to 30k production-shaped labeled candidates for training and dev, plus an
expanded human-labeled gold test set. All of it is synthetic or public. None of it comes
from users.

1. **Schema** (`data/schema.md`). One JSONL record per candidate:
   `{id, source, mode, user_name, context:[{speaker, text}], last_answered, candidate,
   label: answer|silent|wait, soft: {answer, silent, wait}, hard_case_tags:[…], split}`.
2. **Hard-case taxonomy** (`data/taxonomy.md`). Derive it from every rule in
   `JUDGE_PROMPT_RULES` and every dated test name under `autoAnswer/__tests__/`. At
   minimum it must cover:
   - declarative tasks;
   - rhetorical and self-answered questions;
   - merged second voice replying;
   - comprehension checks ending in "right?";
   - logistics versus produce-something directives;
   - granting or scoping permission;
   - deferral;
   - interviewer paraphrase;
   - announced structure not yet delivered;
   - mid-sentence fragments and stalled interims with a clipped last word;
   - the user's own voice on the system channel;
   - asks addressed by name to a teammate versus to the user (including STT name slips);
   - restatement of an already answered ask;
   - short follow-up probes ("and why?");
   - report-shaped asks (pain points, error messages);
   - multi-part questions;
   - backchannels;
   - audience-directed speech.

   Set a minimum quota per tag per mode.
3. **Synthetic conversations** (`data/gen_conversations.py`). Generate full multi-speaker
   meeting transcripts across all nine built-in modes (general, technical-interview,
   looking-for-work, sales, recruiting, team-meet, lecture, seminar, call-center) with a
   strong LLM, steered by the taxonomy quotas. Vary accents of phrasing, disfluencies,
   STT-style errors, and missing punctuation (half of them unpunctuated, because several
   STT providers do not guarantee punctuation). Include user names and teammate names.

   **Before generating:** read the chosen provider's terms on using outputs to train
   models and record the relevant clause in the log. Estimate the cost. If it is above $5,
   stop and ask.
4. **Public corpora** (optional, record licenses). Use AMI, ICSI MRDA or Switchboard
   dialogue-act data, only where licensing permits, for pretraining-style
   question/backchannel/statement examples. Map their tags to the three labels
   conservatively, and only for clear cases.
5. **Production-shaped segmentation** (`data/segment_via_replay.mjs`). This is critical.
   Feed every transcript through the real `SimpleAutoAnswerEngine` with `fakeClock` and a
   recording host, so the candidates are exactly what the engine would send to a judge:
   merged finals, interims promoted by the stall cap, mid-word cuts, and `lastAnsweredText`
   at that moment. Clean sentences are not training data. Simulate interim and final
   timing realistically (finals in bursts, provider endpoints on some, none on others).
6. **Teacher labeling** (`data/label_teacher.py`). Label each candidate with an ensemble:
   - the current judge prompt (`buildJudgePrompt`, called through a small Node bridge so
     the exact prompt is used) on a strong model;
   - plus the same strong model at high reasoning with a rubric-only prompt;
   - three samples each.

   Produce soft labels from vote shares. Records where the teachers agree at least 5/6
   are auto-accepted. All others go to `data/adjudicate.jsonl` with both rationales, and
   the user labels them by hand in a small local HTML tool you build
   (`data/adjudicate.html`, offline, keyboard-driven: a = answer, s = silent, w = wait).
   Map the judge's outputs to labels: `complete false` or act `incomplete` → wait;
   route evaluate with action answer → answer; everything else → silent.
7. **Gold test expansion.** The 187 judge-eval cases are the core of the gold test. Add any
   new human-labeled real recordings the user provides (YouTube mock interviews,
   lectures, sales demos transcribed through the live harness), human labels only.
   Stratify by mode. The gold test is never used for training, threshold fitting or
   temperature fitting.
8. **Splits and leakage.** train 80 / dev 10 / calib 10 from synthetic plus public, with
   the gold test separate. Run the §2.2 leakage check across all pairs of splits. Write
   the data card at `data/DATACARD.md` covering counts per label, mode and tag, the
   teacher agreement rate, and adjudication volume.

### Phase 2: Fine-tune Laya on the MacBook Air M4

1. **Convert data to Laya rows** with the §4 question and state. Run
   `laya-train --dry-run` first and report the item counts and any skipped reasons.
2. **Memory plan for 16 GB unified memory.** A full fine-tune of 421M parameters needs
   roughly 6.8 GB in fp32 for weights, gradients and Adam states, plus activations.
   - Start with `--device mps --micro-batch 4 --grad-accum 16 --max-len 512`.
   - On OOM, halve micro-batch and double grad-accum.
   - If `laya-train` exposes no gradient checkpointing, check `laya/train.py` for a hook;
     do not monkeypatch the library silently.
   - Record peak memory with `torch.mps.driver_allocated_memory()`.
3. **Runs, in order:**
   - (a) `--freeze-encoder`, head only. Fast, and gives a sanity floor.
   - (b) full fine-tune with `--loss rlcd` (Laya's default), using the soft labels via
     `gold`.
   - (c) full fine-tune with `--loss soft-ce`.
   - (d) the best of (b) and (c) with `--shuffle-options`.

   Use `--eval` on dev, and log every run to the ledger.
4. **Thermals and time.** The Air is fanless and will throttle under sustained load. Make
   training resumable with checkpoints every N steps and a `--resume` wrapper, and print
   tokens per second every 50 steps. Before the first full run, estimate wall time from a
   200-step probe and write it to the log. If a full run is estimated above 10 hours, also
   produce `train_kaggle.ipynb` (free 2×T4) and `train_gpu.sh` (any CUDA box) that run the
   identical config, and ask the user which to use. Never auto-provision paid compute.
5. **Calibration.** On the calib split, fit temperatures (`laya.fit_temperatures`) and the
   abstention thresholds (`fit_abstention_thresholds`, `--target-error 0.05` for answer,
   tune for silent). Report ECE before and after, and the reliability diagram as a PNG in
   `results/`.
6. **Thresholds for the cascade.** On calib, choose `τ_answer` and `τ_silent` on
   `confidence` and choice:
   - answer when choice = answer and confidence ≥ `τ_answer`;
   - silent when choice = silent and confidence ≥ `τ_silent`;
   - wait when choice = wait and confidence ≥ `τ_wait`;
   - else escalate.

   Objective: on calib, precision on answer ≥ 0.95 and recall on asks ≥ 0.98 for the
   combined system (escalations scored with the current judge's labels), while minimizing
   the escalation rate. Output the precision/recall/escalation curve. Thresholds are per
   mode only if per-mode data has at least 300 calib items. Otherwise use global
   thresholds.
7. **Distilled student** (Path S, or whenever Windows CPU latency is expected to fail).
   Distill the fine-tuned Laya into a ModernBERT-base (about 150M) or DeBERTa-v3-small
   student, using Laya's soft outputs on train plus a KL loss, with the same sequence
   format so the TypeScript builder is shared. Report accuracy and latency side by side.
   The student ships for local if it is within 1 ask of the teacher on gold.

### Phase 3: Export, quantize, parity

1. **Export** `export/export_onnx.py`. Trace the fine-tuned model with dynamic batch and
   sequence axes, opset 17 or higher. Mirror `ONNXAgent`'s input contract: ids, attention,
   marker positions, marker mask, at least 2 marker columns. The comment in
   `onnx_agent.py` explains why.
2. **Variants:**
   - fp32 as the reference;
   - int8 dynamic quantization for CPU on both OSes;
   - fp16 for the CoreML EP.

   Verify that every op lands on CoreML: log the EP partitioning and report the fraction
   of nodes on CoreML. Likely trouble spots are rotary embeddings and alternating local
   attention. If too many fall back to CPU, try a CoreML-friendly re-export or skip CoreML
   and document why.
3. **TypeScript sequence builder** `electron/intelligence/autoAnswer/decider/layaSequence.ts`.
   Port `build_sequence`, `build_head`, `serialize_state` and the marker layout exactly,
   using the tokenizer through `@huggingface/transformers` (`tokenizer.json` from the
   checkpoint).
4. **Golden parity fixtures.** Python writes 300 cases from gold and dev with their exact
   token ids, marker positions and output probabilities. The TS test asserts identical ids,
   and probabilities within 1e-3 (int8 within 2e-2, with the same argmax on at least 99%).
   This test runs in `npm test`.
5. **Model packaging.** Create `resources/models/natively/auto-answer-decider/manifest.json`
   in the Smart Turn manifest format: url, sha256, bytes, license `Apache-2.0` with the
   Laya NOTICE, input contract, and calibration constants (temperatures, thresholds). Ship
   NOTHING large in the repo. Hosting the artifact is a user decision, so ask whether it
   goes on GitHub Releases, R2 or similar.

### Phase 4: DecisionBackend in the app

1. **Interface** `electron/intelligence/autoAnswer/decider/DecisionBackend.ts`. Make it
   pure and injectable, with these types:

   ```
   decide(req: DeciderRequest, signal?) → Promise<DeciderResult>
   DeciderResult = { action: 'answer'|'silent'|'wait'|'escalate', probs, confidence,
                     backend: 'local'|'hosted'|'llm', ms, questionSpan?: string|null }
   ```

   `DeciderRequest` reuses `JudgeRequest` fields. The state builder is shared by local and
   hosted so both see byte-identical input.
2. **LocalLayaBackend.** Run the ONNX session in the existing worker isolation, never on
   the main thread. EP selection goes through a platform adapter per CLAUDE.md:
   - darwin: CoreML then CPU;
   - win32: DirectML then CPU (verify DirectML ships in onnxruntime-node 1.22 on Windows;
     if not, CPU only and document it).

   Throw on unknown platforms. Test both branches with an injected platform. Warm up the
   session at meeting start. Load lazily, and report "model not downloaded" as a typed state.
3. **HostedBackend.** POST to natively-api (Phase 5) with the user's session auth.
   Deadline 600 ms. Abort through the existing `AbortSignal`.
4. **Cascade and fallback** in a new `AutoAnswerDecider.ts`. Pick the primary by
   entitlement and setting (hosted or local). On timeout or error, try the other one if
   available. Escalate to the LLM judge on `escalate` or when both fail. The LLM judge
   keeps its own deadline and fallback exactly as today. Update the doubt policy: when
   escalated and the judge also fails, answer if the decider's top choice was answer,
   instead of using the '?' fallback. That matches the user's "if in doubt, answer" rule,
   and should be logged as a decision.
5. **Wire into `SimpleAutoAnswerEngine`** behind
   `NATIVELY_AUTO_ANSWER_DECIDER=off|shadow|on` (default `shadow` in dev builds, `off` in
   packaged until cutover).
   - **shadow:** the LLM judge stays authoritative; the decider runs in parallel and only
     telemetry records agreement.
   - **on:** the decider is authoritative.

   Because a local decision costs milliseconds, in `on` mode also call the decider on the
   EARLY timer and on every new final. Keep the existing `STABILITY_MS` commit rule.
   Do not remove held/stale logic yet.
6. **Telemetry.** Add `decisionBackend`, `decisionMs`, `decisionAction`,
   `decisionConfidence`, `escalated` and `shadowAgree` to `auto_answer_judged`. Add them to
   the usage allowlist tests (`AutoAnswerUsageAllowlist*`). No text, no names.
7. **Tests** (fake clock, mutation-probe each new guard):
   - confident answer dispatches without calling the LLM;
   - confident silent never calls the LLM;
   - escalation calls the LLM;
   - hosted timeout falls back to local, then to the LLM;
   - shadow mode never changes dispatch;
   - wait re-arms;
   - meeting reset aborts an in-flight decide;
   - both platform branches of EP selection.

### Phase 5: Hosted tier in natively-api

1. **Research JEV first** with web search and fetch only (no signup). Record in
   `docs/autopilot/decider-hosted-options.md`:
   - auth model;
   - pricing per call;
   - rate limits;
   - data retention and processing terms;
   - regions;
   - latency claims;
   - whether custom fine-tuning or uploaded checkpoints are supported;
   - option limits (reported 255);
   - an exact request and response example.

   Compare against a self-hosted fine-tuned Laya on a GPU host: cost per 1k decisions at
   expected volume, latency from Kerala, privacy, and the ability to ship the fine-tuned
   model. **Recommend self-hosted fine-tuned Laya as the default upstream unless JEV
   supports uploading the fine-tuned checkpoint.** The hosted tier must run the same model
   as local, or the tiers behave differently.
2. **natively-api endpoint** (`natively-api/` submodule; follow its existing Fastify
   patterns, auth, rate limiting and error shapes): `POST /v1/auto-answer/decide`.
   - Requires a valid session with the Pro or Auto Answer entitlement.
   - Validates and caps input size.
   - Forwards to the upstream named by env `DECIDER_UPSTREAM=laya|jev` with
     `DECIDER_UPSTREAM_URL` and `DECIDER_UPSTREAM_KEY`.
   - Applies the same calibration constants as local, so hosted returns calibrated
     `confidence`.
   - Upstream deadline 450 ms.
   - Logs no request bodies.
   - Exposes `/health` and per-user rate limits sized for one call per speech pause.

   Tests in the API's own suite. Do not deploy.
3. **Inference server** `ml/auto-answer-decider/serve/`. A Dockerfile running `laya-serve`
   (or a thin FastAPI around `laya.load`) with the fine-tuned checkpoint and calibration
   baked in, `LAYA_API_KEY` required, `/v1/systemone` plus `/health`. Write a deploy guide
   for one GPU host (compare two providers on price, India-adjacent regions and cold
   start), and check whether Railway offers GPUs. Do not create accounts or deploy. Leave
   the exact commands for the user.
4. **Load estimate** in the doc: decisions per active meeting-hour from the replay harness,
   times target concurrent meetings, against measured or published throughput (Laya
   reports 103 to 332 questions per second batched on one T4).

### Phase 6: Entitlement, settings, download, privacy

1. **Gate.** Auto Answer requires the paid entitlement. Find the existing Pro entitlement
   plumbing with the graph (the entitlement reconcile in `main.ts`, `ModesManager`'s
   premium checks) and reuse it. **Ask the user** what free users keep: hotkey-only answer,
   the old judge on their own key, or nothing. Implement the chosen option behind one
   function.
2. **Code location.** Propose, in the decisions doc, exactly which new files move to
   `premium/` and which stay open (interfaces and types open, backends and calibration
   constants premium is the suggested split). **Do not move anything until the user
   approves.**
3. **Settings UI.** Add a decision runtime choice of Hosted (default) or On this device.
   Show the download size and progress for local, using the existing Settings patterns
   and the agent-browser CDP flow from CLAUDE.md for renderer checks. Add copy for the
   privacy difference.
4. **Download flow.** Reuse the `LocalFallbackAssets` and Smart Turn manifest pattern:
   resumable, sha256-verified, stored under `app.getPath('userData')`, removable.
   Check packaged-path behavior on both OSes by code review, and mark physical
   verification as required.
5. **Privacy copy.** Draft the PRIVACY.md and heynatively.com privacy-policy paragraphs for
   the hosted tier: snippets sent per speech pause, not stored, not used for training,
   plus the upstream processor name. Put them in the decisions doc for the user to approve.

### Phase 7: Evaluation and cutover gate

1. **Offline final.** On the gold test, compare three systems: the current judge (the
   baseline file or a fresh run), the cascade with LocalLaya, and the cascade with Hosted.
   Report per mode:
   - ask recall;
   - false fires;
   - escalation rate;
   - decision latency p50 and p90 on M4 (CPU int8 and CoreML);
   - end-to-end time from speech end to dispatch in the replay harness.

   Statistics: McNemar's exact test on paired correctness, and bootstrap 95% CIs
   (10k resamples) on recall and false-fire counts.
2. **Ship criteria** (adjust only with user approval):
   - recall not lower than baseline in any set by more than 0 asks;
   - false fires no higher in any set;
   - decision p90 ≤ 250 ms on M4 CPU int8, or ≤ 60 ms with CoreML;
   - escalation ≤ 25% of candidates.
3. **Shadow report.** Run the live harness (`tests/auto-answer-live`) in shadow mode.
   Report the agreement matrix and every disagreement with the candidate text (dev-only
   content gate, as `logContent` already does).
4. **Write the cutover checklist**, then stop. Flipping the default to `on`, enabling
   hosted for paid users, and deploying are user actions.

## 4. The decision question and state (shared by training, local, hosted)

Question id `respond`. Keep the wording identical everywhere; it is part of the model's
input. If you change it, retrain.

```json
{
  "respond": {
    "type": "choice",
    "instructions": "An assistant drafts answers for the USER in a live meeting. OTHERS is the meeting audio and may hold several voices. Does the latest speech in `candidate` contain a finished question or task aimed at the USER that they must answer or start now and that is not already in `last_answered`?",
    "criteria": {
      "answer": "a finished question or task for the USER, including short or yes/no ones and declarative tasks",
      "silent": "not an ask, aimed at someone else, rhetorical or self-answered, logistics, permission, deferral, or already answered",
      "wait": "an unfinished fragment, or a structure announced but not yet delivered"
    }
  }
}
```

The state is JSON, built by one shared builder (Python for training, TS for runtime,
parity-tested):

```json
{
  "mode": "technical-interview",
  "addressed_to": "user|other|none",
  "transcript_lagging": false,
  "context": ["OTHERS/speaker_1: …", "USER: …"],
  "last_answered": "… or null",
  "candidate": "…"
}
```

`addressed_to` is computed in code with the existing `judgeUserFirstName`,
`userNameSlipsIn` and `addressedNamesIn`, never by the model. The live judge work proved
the model will not resolve STT name slips itself. Context keeps the last 6 turns, tails
kept, and the candidate keeps its tail when truncation is needed. Report how often the
512-token budget truncates, using `return_truncation_stats`.

## 5. Completion report

At the end, write `docs/autopilot/auto-answer-decider-report.md`. Include:

- what shipped, per phase;
- the measured numbers table;
- the commands actually executed;
- the CLAUDE.md validation categories (Tested physically on macOS, Requires physical
  Windows verification, and so on);
- every open decision for the user;
- remaining risks, especially Windows CPU latency, CoreML op coverage, and teacher-label
  bias.

Never write "cross-platform verified" unless both platforms were executed.
