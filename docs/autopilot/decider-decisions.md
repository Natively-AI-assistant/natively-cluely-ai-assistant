# Auto Answer decider: decisions waiting on Evin

Each entry: the question, what I found, my recommendation, and what stays blocked until you
answer. Work that does not depend on an answer continues meanwhile.

---

## D1. Gate on `answer_confidence`, not `confidence`? (opened 2026-11-09, Phase 0)

**Conflict.** The campaign prompt (§1, §3 Phase 2.6) and the decider skill say to gate on
Laya's `confidence` (normalized entropy). The installed package says the opposite. In
laya 0.4.30 source, `laya/common.py` `confidence_from_probs` says: *"Useful, but not
calibrated: it is not what temperature scaling fits and not what the reported ECE
measures"*. `answer_confidence` (max p) *"is the quantity temperature scaling fits, and the
quantity every calibration figure in this repository is computed on"*. In `agent.py`
`_decode_answers`: *"`answer_confidence` is the calibrated one, on every question type"*.
Laya's own abstention gate (`laya/confidence.py`) gates on `answer_confidence` first.

The prompt's other point, never gating on `action.act_probability`, is not in dispute.

**Recommendation.** Fit temperatures, then gate on `answer_confidence`. Record both
numbers in every run so the Phase 2.6 curves can compare them on calib. The bench already
records both.

**Blocks.** Nothing until Phase 2.6 threshold fitting.

---

## D2. Windows low-end laptop latency (opened 2026-11-09, Phase 0)

Gate G0 was measured only on the M4 Air. Please run `ml/auto-answer-decider/bench/windows_bench.md`
on the slowest Windows laptop we support and send back the ledger lines.

**Blocks.** The final local-model size choice (Laya-large int8 or a distilled student).
Phases 1 to 3 continue meanwhile.

---

## D3. Phase 1 data generation and teacher labeling: provider, budget and key (opened 2026-11-09)

Phase 1 needs a strong LLM twice:
1. to write about 1,000 synthetic meeting transcripts across the 9 modes;
2. to label about 25,000 production-shaped candidates with a 6-call teacher ensemble
   (the judge prompt plus a rubric prompt, 3 samples each).

Both cost well over the $5 line, so I've stopped and am asking.

**Terms on training with outputs (read 2026-11-09):**

- **DeepSeek Open Platform ToS** (effective 2026-04-29), §4.2: *"You may apply the Inputs and
  Outputs of the Services to a wide range of use cases … training other models (such as model
  distillation)"*. No clause restricts competing products. **Explicitly allowed.**
  https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html
- **Gemini API / AI Studio terms** (effective 2026-03-23), Use Restrictions: *"You may not use
  the Services to develop models that compete with the Services"*. A 3-way meeting-turn
  classifier arguably doesn't compete with Gemini, but that's a reading, not a grant.
  On unpaid tiers Google also trains on the prompts. https://aistudio.google.com/docs/terms
- Not checked yet: OpenAI and Anthropic. Both have similar "competing model" clauses as far
  as I know, which is unverified. I'd check them only if you want one as a second teacher.

**Cost (ESTIMATES, not measured).** Assumed DeepSeek Flash list price is about $0.30/M input
and $1.10/M output. The exact current rate wasn't on the pricing pages I could fetch;
natively-api's own pack test uses a $0.347/M blended "bad day" rate.

| item | tokens (estimate) | DeepSeek Flash | DeepSeek V4 Pro (assume about 4x) |
|---|---|---|---|
| 1,000 transcripts | ~2M in / ~4M out | ~$5 | ~$20 |
| teacher, full 6-call ensemble on 25k candidates | ~450M in / ~25M out | ~$160 | ~$600+ |
| teacher, lean: 2 calls at temp 0, 3-sample only on disagreement (~25%) | ~190M in / ~10M out | ~$70 | ~$270 |
| teacher, lean, 12k candidates | ~90M in / ~5M out | ~$35 | ~$130 |

Prompt caching would cut input cost. The rubric prompt can put its fixed rules first and hit
DeepSeek's cache. The judge prompt cannot: its rules sit after the transcript on purpose,
because that ordering was measured as load-bearing.

**Important: do not use the prod keys in `.env`.** `DEEPSEEK_API_KEY`, `GEMINI_API_KEY` and
`NATIVELY_API_KEY` there are the production keys serving users (DeepSeek balance $60.75 on
11-09; the Gemini prepay ran dry on 11-08). A labeling run would drain them mid-day. I need a
**separate key** in an env var you set, for example `DECIDER_TEACHER_DEEPSEEK_KEY`, with its
own budget.

(Phase 0's judge gate did run on the Natively key, as the gate always does: 3 × 187 calls,
about 1.4M tokens, about $0.50 by estimate.)

**Recommendation:**

- DeepSeek, because its terms explicitly allow distillation.
- Transcripts on V4 Pro (quality matters most there, and the cost is small).
- Teacher with the **lean ensemble on Flash, thinking on, for ~12k candidates first (~$35
  estimate)**. Measure the agreement rate and the adjudication volume, then decide whether
  to scale to 25k.
- A hard spend cap in the script (it stops at a $ figure you set) and a separate key.

**What I need from you:** (1) provider OK? (2) budget cap? (3) a separate key in an env var.

**Blocks:** Phase 1 steps 3 and 6 (generation, teacher labeling), and so Phase 2 training on
real data. Meanwhile, unblocked: schema, taxonomy, segmentation through the real engine, the
leakage check, the adjudication tool, plus Phase 3 and 4 plumbing on the zero-shot checkpoint.

---

## Answers from Evin (2026-11-10)

- **D3 → AgentRouter, `gpt-6.1-sol`, no spending limit.** Use the AgentRouter key in the
  main checkout's `.env` (`AGENTROUTER_API_KEY`). It is exported into the process env at
  run time and never written into the repo. DeepSeek is dropped.
  - Facts the scripts must handle, from `electron/llm/agentRouter.ts`:
    - GPT is Responses-API only.
    - Requests need the `originator: codex_cli_rs` header (Evin's 2026-09-30 decision).
    - GPT is rationed in daily batches (`402 Budget pool quota has been exhausted`) and
      gpt-6.1-sol rate-limits.
    - A canned probe phrase is content-blocked.
  - **Risk, noted rather than blocking:** AgentRouter's terms name heavy automated Q&A use
    as grounds for suspension. A bulk labeling run is exactly that. The scripts pace
    requests, back off on 402/429, and stop after repeated 401s rather than hammering.
    OpenAI's usage terms also restrict using outputs to build competing models. Evin chose
    this provider knowing a 3-way meeting-turn classifier is the use.
- **D1 → mine to decide; the requirement is that it decides correctly.** Decision: fit
  per-question temperatures on calib, then gate on calibrated **`answer_confidence`**
  (laya's own calibrated quantity). Accept the decider's verdict only above a threshold set
  so that accepted verdicts reach ≥99% accuracy on calib. Everything below that escalates
  to the LLM judge. Raw `confidence` (entropy) is logged and plotted for comparison but
  does not gate. "Without error" is met by the cascade: the model answers only what it is
  sure of, and the judge takes the rest. Phase 7 checks this on gold against the judge's
  36/36 and 3 false-fire bar.
- **D2 → later.** The Windows bench is deferred. Model-size choice stays provisional until then.
