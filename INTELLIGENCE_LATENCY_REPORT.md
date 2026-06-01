> **Real UI eval (2026-06-01):** A real UI Playwright/Electron eval has been added (`intelligence-eval-real-ui/`). Backend-only and API-only evals are not enough for release validation. It drives the REAL Natively Electron app (launch → load resume/JD/custom/persona through the UI → inject transcript via the shipped test IPC → press the real "What to answer?" button / type manual questions → grade real DOM-visible streamed answers), recording latency, cost, accuracy, context usage, screenshots, videos, traces, network. Verified runnable here (app launches, all windows render, all preload bridges + real transcript injection work); the full keyed 100-case run needs NATIVELY_TEST_API_KEY (Pro-entitled) + a GUI session. See `REAL_UI_TESTING_APPROACH.md` and `intelligence-eval-real-ui/README.md`.

> **Production-proof status (2026-06-01):** The deterministic backend-only eval (`intelligence-eval/`) is **NOT accepted as production proof** — it never calls a provider (sub-millisecond first-token is the tell). A **real API eval** (`intelligence-eval-real-api/`) has been added that hits the real Natively `/v1/chat` streaming endpoint with `NATIVELY_TEST_API_KEY`, records real first-token/total latency, and validates real context usage. Real API eval is the release-validation gate. See `intelligence-eval-real-api/README.md` and `results/real-api-summary.md`.
>
> **REAL measured latency (live Natively `/v1/chat`, gemini-3.5-flash, 71 streaming calls):**
> - Manual factual recall (deterministic fast path, NO provider call): p50/p95 **< 1ms**. ✅ <1000/2000ms.
> - Manual LLM-backed answers: first-useful-token p50 **~6.2s**, p95 **~9.3s**. ❌ exceeds spec <3000/5000ms.
> - What-to-answer (transcript): first-useful-token p50 **~3.8s**, p95 **~8.1s**. Extraction p95 **~1ms** ✅ (<500ms).
>
> **Bottleneck attribution:** the deterministic intelligence prefix
> (extract → route → ground → assemble) is <1ms; ALL of the 6–9s is the
> **provider's first-token (gemini-3.5-flash prefill + network)** — confirmed by
> per-stage timing. The intelligence layer is not the bottleneck. To meet the
> live-interview LLM latency targets, Natively needs a faster model tier or
> prompt-cache warming on the LLM-backed paths; the identity/skills/projects
> fast paths already meet target by answering deterministically (no provider).
> Source: `intelligence-eval-real-api/results/real-api-latency-report.md`.

# Intelligence Latency Report

Covers the live "What to answer?" path and the interviewer-perspective grounding
added this session. Provider/network first-token latency is not measured here
(requires live credentials); this report measures the deterministic, in-process
stages that precede the provider call — the part this work changed.

## Pipeline (What to answer?)

```
transcript turns (last ~180s)
  → prepareTranscriptForWhatToAnswer()      deterministic clean+sparsify (existing)
  → extractLatestQuestion()                 NEW deterministic extractor
  → classifyIntent()                        regex fast-path, SLM fallback (existing)
  → [grounding] toCandidateFraming()         NEW pronoun normalize
  → [grounding] orchestrator.processQuestion EXISTING; fast-path/structured-pack
  → WhatToAnswerLLM.generateStream()         assemble prompt + stream
  → provider first token                     (network — not measured here)
```

## Measured (deterministic stages, 2026-05-31)

Apple Silicon, dev build, warm process. Bench: 2000 iters (extractor), 500 iters
(extract+ground), synthetic Backend Engineer fixture, NO embedder/LLM (the
normal what-to-answer configuration — grounding uses the orchestrator's
deterministic identity fast-path / structured pack).

| Stage | p50 | p95 | p99 | Target | Status |
|-------|-----|-----|-----|--------|--------|
| `extractLatestQuestion` (latest interviewer question) | 0.003 ms | 0.004 ms | 0.010 ms | <500 ms p95 | ✅ ~100,000× under |
| `extract + toCandidateFraming + processQuestion` (full deterministic grounding) | 0.027 ms | 0.053 ms | 0.134 ms | <500 ms p95 | ✅ far under |

The extractor and grounding add **negligible** wall-clock to the hot path —
they are pure string work plus an in-memory structured-data read. No embedding
round-trip, no network, no model call on the common factual-recall path.

## Why grounding does NOT add provider latency

- The grounding lookup runs the orchestrator's deterministic paths only:
  identity fast-path (`isIdentityDirect`), direct project match, and the
  structured category pack — all of which set `fastPathNodes` and **bypass
  vector retrieval** (no query embedding).
- `jd_alignment`/company questions are deliberately **excluded** from grounding
  (see `INTELLIGENCE_FIX_REPORT.md` §"Review fixes") precisely because they
  could trigger a live company-research LLM call. Excluding them keeps the
  grounding path embedding- and network-free.
- The candidate-profile facts are injected into the SAME single provider call
  the path already made — grounding adds context, not an extra round-trip.

## Acceptance targets (from spec) vs status

| Target | Status |
|--------|--------|
| Latest interviewer question extraction p95 < 500 ms (local/deterministic) | ✅ 0.004 ms |
| "What to answer?" first useful token p50 < 3 s | Bounded by provider; deterministic prefix adds <0.1 ms |
| "What to answer?" first useful token p95 < 5 s | Bounded by provider; deterministic prefix adds <0.1 ms |
| No unnecessary 7+ s delay from transcript handling | ✅ transcript handling is sub-millisecond |

## How to reproduce

```bash
npm run build:electron
node --input-type=module -e "
import { extractLatestQuestion, toCandidateFraming } from './dist-electron/electron/llm/transcriptQuestionExtractor.js';
import { createRequire } from 'module'; const require = createRequire(import.meta.url);
const { KnowledgeOrchestrator } = require('./dist-electron/premium/electron/knowledge/KnowledgeOrchestrator.js');
import { backendEngineer } from './tests/intelligence-fixtures/fixture-set.mjs';
const doc={id:1,type:'resume',structured_data:backendEngineer.resume};
const db={initializeSchema(){},getDocumentByType(t){return t==='resume'?doc:null},getAllNodes(){return[]},getNodeCount(){return 0},getIntro:()=>null,getGapAnalysis:()=>null,getNegotiationScript:()=>null,getMockQuestions:()=>null,getCultureMappings:()=>null};
const o=new KnowledgeOrchestrator(db); o.setKnowledgeMode(true);
const turns=[{role:'interviewer',text:'so, tell me about your projects.',timestamp:3}];
let t=[]; for(let i=0;i<2000;i++){const s=process.hrtime.bigint(); extractLatestQuestion(turns); t.push(Number(process.hrtime.bigint()-s)/1e6);} t.sort((a,b)=>a-b);
console.log('extractor p95=', t[Math.floor(t.length*0.95)].toFixed(4)+'ms');
"
```

## Remaining latency work (not in this session's scope)

- End-to-end provider first-token timing with real credentials (the
  `MEASURE_LATENCY=true` hooks in `WhatToAnswerLLM` already log per-stage + per-
  token timing; needs a live run to populate).
- The manual-chat path (`runManualAnswer` → orchestrator) already benefits from
  the deterministic structured pack added earlier this session (removes the
  embed round-trip for factual recall).

---

## E2E eval suite latency (intelligence-100-e2e, iteration-001)

Measured across all 100 e2e cases (real deterministic routing/grounding stages;
no live provider). Source: `intelligence-eval/results/latency-report.md`.

| Metric | Manual | What-to-answer | Target | Status |
|--------|-------:|---------------:|-------:|:------:|
| Question extraction p95 | ~0.0ms | ~0.27ms | <500ms | ✅ |
| First token p50 | ~0.05ms | ~0.06ms | <1000/3000ms | ✅ |
| First token p95 | ~0.26ms | ~0.45ms | <2000/5000ms | ✅ |

The deterministic intelligence prefix (transcript clean → latest-question
extraction → intent → routing/grounding → answer compose) is **sub-millisecond
end-to-end**. Identity/projects/skills/experience all resolve via the
deterministic structured pack / identity fast-path — no query embedding, no
vector retrieval, no network. In a live run, first-token latency is therefore
dominated entirely by **provider prefill/network**, not by anything the
intelligence layer does (it adds <1ms). The historical 7s+ delays came from
avoidable LLM/embedding round-trips on the hot path, which the structured-pack +
fast-path routing removed.

Per-prompt latency fields recorded for every test in
`intelligence-eval/results/iteration-001.json`: `questionExtractionMs`,
`intentDetectionMs`, `contextBuildMs`, `providerRequestStartMs`, `firstTokenMs`,
`totalResponseMs`, `contextReadyMs`.
