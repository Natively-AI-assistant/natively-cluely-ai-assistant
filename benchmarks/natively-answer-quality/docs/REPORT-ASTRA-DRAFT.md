# 9-mode answer quality, judged by gpt-6-astra — final report (DRAFT)

Status: DRAFT. Sections marked **[judge]** fill in from the 02:00 / 11:00 UTC 2026-10-01 batches
(`astra/out/logs/report-after-*.md`, `astra/paired.mjs`). Everything else is measured and final.

## 1. AgentRouter integration (judge only)

* Base `https://agentrouter.org/v1` (OpenAI-compatible). `co.agentrouter.org` rejects this key (401 Invalid API Key).
* The gateway answers only allow-listed coding clients: one header `originator: codex_cli_rs`, approved by Evin on
  2026-09-30 ("Yes, full volume") with the terms-of-service risk stated. No other identity spoofing.
* Key: `AGENTROUTER_API_KEY` read from the main checkout's `.env` by file parsing (never argv, never logged, scrubbed
  from every stored record and error). Stub tests use a fake key file and `ASTRA_BASE_URL`, never the real key.
* Model integrity: `/v1/models` lists `gpt-6-astra`; every call records the returned model id and is checked against
  it (0 mismatches so far). No substitute judge has been used at any point.
* Parameters: `temperature: 0` is rejected on some routes (400 "Only the default (1) value is supported"); per spec
  §19 only that parameter is dropped, and each call records it.
* Rationing: GPT calls come from a budget pool refilled in batches at 02:00 and 11:00 UTC (≈850 calls per batch
  observed); a 402 "Budget pool quota has been exhausted" ends a batch. The client fails fast after the first 402,
  failures are never cached, every judgment is cached by (charter, model, mode, question, envelope, answer, repeat),
  so a later batch continues where the last one stopped (`astra/queue3.mjs` priority tiers).
* Calibration gate: 19/20 (≥18 required) — the one miss was the temperature 400, not a wrong preference.
* Charter version `6dd53845a51c` for every judgment.

## 2. Architecture of the answer path (what was changed, where)

* Hotkey (what-to-answer): IntelligenceEngine → V3 prompt composer (+ promptSystemV2 persona) → streamed answer →
  post-stream repairs → claim verifier (I8) → final event replaces the streamed text.
* Typed (manual chat): ipcHandlers V3 path → stream → claim verifier (typed wording) → final text.
* Retrieval: mode-retrieval-port (document status: retired / expired / outdated / draft, I14) → evidence block.
* Changes by layer: retrieval (I1, I14), prompt composer (I2 CALC, I11 TODAY, I14 precedence), personas (I3–I5,
  I10, I13), planner (I9), post-stream deterministic (I5 bridge strip, I15 access-lead strip), post-stream LLM edit
  (I8 / I8b / I8c / I16 claim verifier).

## 3. Root causes and iterations

| # | root cause | change | objective evidence | judge | decision |
|---|---|---|---|---|---|
| I1 | ~10% of reference turns never put the answering text in the prompt | small corpus read whole | needles in prompt dev 76→83/86, final 168→185/188 | [judge] | keep (objective) |
| I2 | live arithmetic set-up errors | hidden [[CALC]] scratch | replay 23→43/54; supp-quant 25→31/32 | [judge] | keep (objective) |
| I3/I5 | biography treated as "something to check" | own-life rule, LFW/TI only | epistemic 12→4/120 | [judge] | |
| I4 | recruiting hotkey wrapped in coaching | words-only probe | coaching 18→2/66 | [judge] | |
| I8 | invented personal / product / policy claims | claim verifier pass | offline Sales 6.93→8.29 (judged) | [judge] fix4 | |
| I8b | product claims with no product document | no-document clause | 46/80 edited offline | [judge] | |
| I8c | verifier dropped **highlights** | keep highlights; format-only = no edit | DSALES-023 | — | keep |
| I9 | recruiting heard turns routed as coding | planner gate + narrow `check if` | W1-5 invariant kept | [judge] | |
| I10 | Call Center repeated identity checks, never said the rule | rule-then-verify clause | replay states 30-day / $20 rules | [judge] | |
| I11+I14 | expired / outdated documents treated as current | TODAY line + freshness statuses | conflict 0/3→3/3 replay; dev validators Sales 3/3 | [judge] | |
| I13 | Team Meet narrates its own access | prompt wording | no in-app effect | — | replaced by I15 |
| I15 | same | deterministic access-lead strip | TM epistemic 8→3 | [judge] | |
| I16 | verifier appended interviewer questions | narrowed hand-back | LFW appended 12→1 | [judge] | |
| rejected | conflict wording; past-event notice; specifics nudge | — | no effect / noise | — | not shipped |

## 4. 9-mode scorecard [judge]

Starting = main `61bb0956` (aq2-dev-cur); Final = candidate. Columns per spec: mean, p10, hard-fail %, grounding,
correctness, role, usefulness.

| mode | Starting | Final | p10 | hard fails | grounding | correctness | role | usefulness |
|---|---:|---:|---:|---:|---:|---:|---:|---:|

## 5. Deterministic correctness (objective validators outrank the judge)

| set | baseline | fix6 |
|---|---:|---:|
| dev validators | 5/9 | 8/9 |
| supp-quant validators | 25/32 | 31/32 |
| supp-behavior validators | 9/9 | 8/9 (SBLEC-002: the handout's own error, present in both prompts) |
| holdout validators | 2/2 | 2/2 |
| final validators (aggregate only) | 10/16 | 14/16 |
| final: reference needles in prompt | 168/188 | 185/188 |
| final: epistemic lines | 85 | 51 |
| final: coaching lines | 31 | 17 |

## 6. Worst answers (≥10) [judge]

## 7. Latency (median / p95, ms)

Recorded runs, hours apart (network drift not controlled):

| set | TTFT before | TTFT after | total before | total after |
|---|---:|---:|---:|---:|
| dev 360 | 990 / 2020 | 854 / 1337 | 1495 / 2828 | 1555 / 2753 |
| holdout 270 | 964 / 1648 | 778 / 1360 | 1438 / 2607 | 1483 / 2805 |
| final 1038 | 889 / 1371 | 728 / 1194 | 1279 / 2046 | 1374 / 2401 |

* The verifier adds ~0.7 s to the total in its modes (dev total p50: Call Center 1223 → 1984, Sales 1313 → 2004,
  LFW 1823 → 2429; fix7 LFW 2140). Time to first word is unchanged by design.
* **User-visible trade-off:** on the spoken path the draft streams, then the verified text replaces it 0.74–1.0 s
  after the last token, on 75 of 245 dev hotkey turns (LFW 28/32). An edit in the first sentence may already have
  been read aloud. The judge scores the replaced text.
* Paired same-time latency run: [pending, final candidate].

## 8. Holdout evidence [judge]

## 9. Generator ceiling [judge]

deepseek-v4-pro vs deepseek-flash on the same recorded prompts, same 15 items per mode. v4-pro full response p50
5.2 s vs 1.2 s, so it is not a live-path option; the read says how much of the gap to 9.5 the generator explains.

## 10. Weaknesses and recommendation [judge]

* Known open classes: invented personal facts in General small talk; capability claims with no product document
  (DSALES-001); a heard computed statement is never re-checked (SBLEC-002 class); "why did you leave" motives
  (architectural blocker, deterministic route proposed, not built).
* Environment caveat: no ONNX embedder weights in the worktrees, so retrieval was lexical in every run (both sides).
