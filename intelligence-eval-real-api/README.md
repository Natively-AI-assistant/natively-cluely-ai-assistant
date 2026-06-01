# Real API Intelligence E2E

This suite validates Natively's Profile Intelligence against the **real** Natively
API (`https://api.natively.software/v1/chat`) — real streaming, real latency,
real model output. It is the production-release gate. The earlier
`intelligence-eval/` suite (deterministic backend-only) is **not** accepted as
production proof.

## Why a separate suite

`intelligence-eval/` proves *routing/grounding correctness* on compiled code
without a provider (its first-token latency is sub-millisecond because it never
calls an LLM). That's necessary but not sufficient: it cannot prove the real
provider, over the real streaming API, actually uses the assembled context and
produces a correct candidate answer. This suite closes that gap.

## What is real here

- **Endpoint:** real `POST /v1/chat` with `x-natively-key` (the exact call
  `electron/LLMHelper.ts:streamWithNatively` makes). Verified reachable — an
  invalid key returns the real server's `401 invalid_key_format`.
- **Context assembly:** the prompt sent to the API is built by the REAL compiled
  `KnowledgeOrchestrator` + the same assembly `_streamChatInner` /
  `WhatToAnswerLLM` perform (system prompt injection, persona context, grounded
  `contextBlock`, first-person what-to-answer prompt). No mock intelligence layer.
- **Streaming + latency:** real SSE, with first-byte / first-token /
  first-useful-token / total recorded per test.
- **Grading:** the REAL streamed text must literally contain required facts;
  forbidden facts fail in the answer OR the grounding the model was given.

## What is NOT bypassed / faked

- No mock provider, no stubbed LLM output, no canned answers, no fetch
  interception (mock-detection refuses to certify if any is present).
- Deterministic fast paths are allowed ONLY for the production design's safe
  factual fast answers (identity/intro). They are labelled
  `responsePath: "deterministic_fast_path", providerUsed: false` and still run
  through the real orchestrator routing. Everything else is
  `provider_streaming` and must hit the API.

## Running it

```bash
export NATIVELY_TEST_API_KEY="<your-test-key>"      # never commit / never logged
node scripts/build-electron.js                       # compile production TS
node intelligence-eval-real-api/run-real-api-e2e.ts  # hits the real API for all 100 cases
```

- Without the key, the runner **exits 2** with a setup message — it never
  fabricates results.
- `--dry-run` validates harness wiring offline (assembles prompts, runs routing,
  exercises fast paths) WITHOUT provider calls. Dry-run can NEVER pass the gate;
  it exists only to prove the plumbing.

## Files

| File | Role |
|------|------|
| `run-real-api-e2e.ts` | orchestrates the 100 cases; key/mock guards; writes results |
| `real-api-client.ts` | real `/v1/chat` SSE client; `redactKey`; mock detection |
| `real-api-streaming-client.ts` | streaming wrapper + latency milestones |
| `real-api-session-loader.ts` | loads profile into real orchestrator; reproduces `_streamChatInner` assembly |
| `real-api-transcript-runner.ts` | what-to-answer path (real extractor + grounding) |
| `real-api-grader.ts` | grades the real streamed answer (10 rules) |
| `real-api-context-auditor.ts` | cross-context correctness + pollution audit |
| `real-api-latency-recorder.ts` | hrtime streaming milestones |
| `results/` | iteration JSON + 4 markdown reports |

## Release gate

PASS requires: every case went through the real path (provider or genuine fast
path), ≥99/100 pass, all critical pass, 0 assistant-identity confusion, real-API
usage 100%, no key leakage. `--dry-run` and a missing key cannot pass.

## Key handling

`NATIVELY_TEST_API_KEY` is read from env only. It is never hardcoded, never
written to results/reports (only a non-reversible `len=N:natively_sk_****`
fingerprint), never printed on failure. `redactKey()` masks key-like tokens in
any surfaced text.
