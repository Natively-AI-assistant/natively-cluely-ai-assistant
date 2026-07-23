# Campaign 2 — Long-session degradation — Final State (2026-07-23)

## Headline

The L4-gap "answer-quality 41% / recall 50% / desync 47%" reported at iteration 87 (run-063) has been **partially closed** via iter88's chunking fix and live-verified in iter89. The remaining G3-fail footprint on script-b is now **provider-error literals (B5, B6 — Gemini embedding rate-limit, infra)** + **M3 literal-adherence overcaution (B7 — model-side, not retrieval)**, **not retrieval** — confirmed via `NATIVELY_RETRIEVAL_DIAGNOSTICS=1` dump that shows the live prompt for B7 now leads with `[Section 5.2 | p7] 5.2 Hardware and Schedule We trained our models on one machine with 8 NVIDIA P100 GPUs… 12 hours… 100,000 steps.`

## Pinned cause + fix commits

| iter | Symptom | Pinned cause | Fix commit | Status |
|---|---|---|---|---|
| 47-50 | A4/A5/C9-class scaffold-contamination | model-invented headings trapping real content | `AnswerValidator.ts hasUnrecoveredScaffoldContamination` | SHIPPED |
| 52 | C8/A13/A17/B13 fabricated transcript preamble | leading `[SPEAKER]:` fabricated dialogue | `answerPolish.ts stripFabricatedTranscriptPreamble + isFabricatedTranscriptOnly` | SHIPPED |
| 55-57 | script-b answer quality mid-band | model mid-band refusals irrelevant to context | `answer-relevance guard` NATIVELY_ANSWER_RELEVANCE_GUARD_LIVE=1 threshold 0.15 + `isProviderTransportError` | SHIPPED |
| 84-85 | B14/B16 `**Label:**` header noise | leading bold-label pseudo-headers | `BOLD_PSEUDO_HEADER_RE` widen gate to `compressToSpeakable` | SHIPPED |
| 88 | **B7 retrieval-recall (the L4-gap) chunking root cause** | `tabularChunks()` in `DocumentMap.ts` false-positived on comma-rich academic prose (copyright banner as header, ≥80% prose lines with stable comma count). Whole paper chunked as 86 `[Table rows N-M]` UNTAGGED chunks with zero `[Section N.N]` tags, defeating the hybrid retriever's section-target restore (matches `/^\[Section\s+([\d.]+)\s*\|/` could never fire) and starving §5.2-type answers in hybrid paths. | `DocumentMap.ts`: field-shape guard — reject as tabular when ≥30% of fields are 3+ words (real CSV/TSV = 1.0 words/field, 0% multi-word; prose = 5.21 words/field, 53% multi-word). Generic, least-code, zero-hallucination preserved. | `7847dcb0` SHIPPED + LIVE-VERIFIED in iter89 |

## Scoreboard progression

script-b G3 (best-of-3 runs, real MiniMax M3 backend):
- iter47 baseline: 64.7%
- iter55 first live-fire guard: 76.5%
- iter57 speaking-style: 88.2%
- iter65 best ever: **94.1% (16/17)**
- iter88 (run-069, PRE-rebuild — chunking fix hadn't propagated to dist-electron yet): 82.4%
- iter89 (run-072, POST-rebuild, real MiniMax M3, retrieval-diagnostics ON): 82.4% (14/17) — but the diag dump proves the §5.2 chunk leads the live prompt for B7, so residual failures are **model-side comprehension** (B7) + **infra provider-error literals** (B5/B6), not retrieval

Gates held at the §7 target across every iter89 run: greeting=0 ✓, hallucination=0 ✓, extraction=100% ✓, injection=100% (still vacuously 100% on script-b — no injection annotations).

## Latency curve

iter72 latency p50/p95 by session-minutes bucket (from G8_latency on the final run):
- 0-10 min: p50=5039ms, p95=10865ms, n=7
- 10-20 min: p50=5686ms, p95=8212ms, n=7
- 20-30 min: p50=4144ms, p95=4589ms, n=3
- superlinear growth flag: **false** (no late-session latency cliff)

This is a clean latency curve — the L4-gap is NOT a latency-induced truncation issue. It is a qualitative answer-comprehension issue.

## Verified long-context prompt composition at minute 24 (B16 warmup-steps, G3=OK)

The prompt for B16 led with §5.2 in the live hybrid retriever's top-12 (selectedCount=12, sec: '5.2', …):
> `<text>[Section 5.2 | p7] 5.2 Hardware and Schedule</text>`
> `We trained our models on one machine with 8 NVIDIA P100 GPUs…`

The model answered B16 correctly (`**4000 warmup steps.**`). The same chunk surface reaches the model for B7 but the model fails to match "hardware" → "P100/12 hours" — corroborated by the fact that B8/B9/B10/B11/B12/B13/B14/B15 all answer correctly despite relying on §5.4 (§5.4 chunks were the only chunks that produced a "tail"; §5.2 chunks were the first/leading snippet).

## Remaining gaps (ranked post-95% improvements)

1. **H14 — M3 literal-adherence overcaution on doc-grounded Qs.** The model sees §5.2 in the prompt, recognizes §5.2 as the answer chunk, yet answers "I could not find that in the retrieved sections" because "what hardware" and "8 NVIDIA P100 GPUs / 12 hours" don't share exact lexical terms. Likely next lever is prompt-side: relax the `<active_mode_retrieved_context>` evidence_use_rule's literal-match strictness, OR add a per-chunk "relevance sniff" that re-anchors M3 to chunks the section-planner boosted (`targetList: ['5.2', ...]`). Route to next session — outside the chunking lever.
2. **H15 — Embedding-provider rate-limit cascade (B5, B6 on script-b).** 5 of 6 Gemini embedding keys cooled simultaneously; the lexical fallback did not produce the §5.2 chunk high enough to win. Two complementary fixes: (a) add Gemini key rotation/health-aware timeout like the subscription-breaker rule (memory `subscription-breaker-generalization-2026-07-02`), (b) `LLMHelper._streamChatInner` exponential backoff for transient provider blips (open from iter87).
3. **Family A — multi-turn conversational gap (H12/H13).** presses C3/C4 (script-a/c). Still FOREIGN-EDIT BLOCKED on `electron/IntelligenceEngine.ts` (+527/-53 mid-edit by another session). Re-check when it settles.
4. **Family C — harness G3 judge rigidity (H-jury).** presses B3 / B6-off-language. Test-harness issue, not product code. Coordinate with the test-engineer agent.

## Anti-thrash ledger (pinned-correct by prior work — DO NOT re-fix)

- `electron/llm/AnswerPlanner.ts:805` + `:863-865` — Category D source-available regex (SHIPPED iter87).
- `electron/intelligence/context-os/finalPromptValidation.ts:33,64,76-86,106-107` — mandatory manifest field (Category C, COMPLETE iter88).
- `electron/llm/manualProfileIntelligence.ts` (Full-JIT `6e6189b4`) — `r.answer` is always `undefined`. Do not restore prose rendering.
- `electron/llm/answerPolish.ts` — `cleanAnswerArtifacts` and `isLeakedAnswerArtifact` are the canonical cleanup/rejection points.
- `electron/llm/modeSourceContract.ts:163-171`, `turnSourceDecision.ts` inv#3, `SourceAuthorityKernel.ts` inv#10 — Campaign 3 anti-thrash (separate campaign, exited 2026-07-20).

## Methodology notes

- `9Router` quota proxy at `localhost:20128` is DOWN; the harness does NOT need it (it goes through the local backend which itself calls MiniMax). The §6 quota rule is unreachable; budget enforcement was done by clean-iteration pre-checks of the local backend's `MINIMAX_API_KEY`.
- Source-string assertion tests (e.g. `OkfPhase1StabilizationFixes.test.mjs:107`, pinned-blocked) drift when foreign sessions refactor files under test. Update them only when the file under test is clean/settled.
- The `NATIVELY_RETRIEVAL_DIAGNOSTICS=1` env (NOT `NATIVELY_RAG_DIAG`) is the diagnostic dump flag in `electron/llm/documentGroundedPrompt.ts:271`.
- Build path matters: `DocumentMap.ts` changes require `npm run build:electron` to take effect in `dist-electron/`. run-069 was at 21:06 IST but dist-electron was rebuilt at 21:21 — run-069 used the OLD chunker.

## Files for next session

- `campaign2-log.md` — full iteration log through iter89
- `traces2/harness-script-b-press-*.txt` — per-press prompt dumps
- `traces2/b7-forensic.mjs` — isolated forensic (lexical vs hybrid retrieval)
- `test/harness-longsession/reports/run-072.json` (+ `.md`) — most recent run scorecard
- `/tmp/b_real_diag.log` — full retrieval-diagnostics dump for run-072 (102 MB if persisted; otherwise regenerate via `NATIVELY_RETRIEVAL_DIAGNOSTICS=1 node test/harness-longsession/run-all.mjs --only=b`)
- `dist-electron/electron/services/modes/DocumentMap.js` — compiled chunker with iter88 fix
