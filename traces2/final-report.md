# Campaign 2 — Long-session degradation — Final State (2026-07-23)

## Headline

The L4-gap "answer-quality 41% / recall 50% / desync 47%" reported at iteration 87 (run-063) has been **closed for desync on script-b** via the iter88 chunking fix + iter90 H14 SECTION-TAGGED RELEVANCE rule. Script-b G6 (desync, deterministic on-topic gate) went **14/17 (82.4%) → 17/17 (100%)** after H14. B7's raw answer flipped from `"I could not find that in the retrieved sections"` to correctly citing `"8 NVIDIA P100 GPUs / 12 hours (100,000 steps)"`. The two gap families that remain are: (a) **H15 — provider-error literals on B5/B6/B15** (Gemini embedding key rate-limit cascade, infra), and (b) **H-jury — Family A multi-turn C3/C4 + several script-a/c Qs** have no single root cause (spread across extraction, knowledge contradiction, artifact leakage, infra).

## Pinned cause + fix commits

| iter | Symptom | Pinned cause | Fix commit | Status |
|---|---|---|---|---|
| 47-50 | A4/A5/C9-class scaffold-contamination | model-invented headings trapping real content | `AnswerValidator.ts hasUnrecoveredScaffoldContamination` | SHIPPED |
| 52 | C8/A13/A17/B13 fabricated transcript preamble | leading `[SPEAKER]:` fabricated dialogue | `answerPolish.ts stripFabricatedTranscriptPreamble + isFabricatedTranscriptOnly` | SHIPPED |
| 55-57 | script-b answer quality mid-band | model mid-band refusals irrelevant to context | `answer-relevance guard` NATIVELY_ANSWER_RELEVANCE_GUARD_LIVE=1 threshold 0.15 + `isProviderTransportError` | SHIPPED |
| 84-85 | B14/B16 `**Label:**` header noise | leading bold-label pseudo-headers | `BOLD_PSEUDO_HEADER_RE` widen gate to `compressToSpeakable` | SHIPPED |
| 88 | **B7 retrieval-recall (the L4-gap) chunking root cause** | `tabularChunks()` in `DocumentMap.ts` false-positived on comma-rich academic prose (copyright banner as header, ≥80% prose lines with stable comma count). Whole paper chunked as 86 `[Table rows N-M]` UNTAGGED chunks with zero `[Section N.N]` tags, defeating the hybrid retriever's section-target restore (matches `/^\[Section\s+([\d.]+)\s*\|/` could never fire) and starving §5.2-type answers in hybrid paths. | `DocumentMap.ts`: field-shape guard — reject as tabular when ≥30% of fields are 3+ words (real CSV/TSV = 1.0 words/field, 0% multi-word; prose = 5.21 words/field, 53% multi-word). Generic, least-code, zero-hallucination preserved. | `7847dcb0` SHIPPED + LIVE-VERIFIED in iter89 |
| 90 | **H14 model-side comprehension: B7 (and other section-Qs) refused even when §-tagged chunk is in the prompt** | M3 saw the §5.2 chunk with "8 NVIDIA P100 GPUs / 12 hours" in the prompt, but rule (4) of `EVIDENCE_USE_RULE` ("If the requested item is genuinely absent from all snippets, say so") dominated over rule (3) (synonym matching) because the question's words ("what hardware and how long") don't lexically overlap with the chunk's body. | `documentGroundedPrompt.ts:254` EVIDENCE_USE_RULE: insert rule (3a) — "SECTION-TAGGED RELEVANCE" — between rules (3) and (4). When a question names a section (heading word or §-number), any chunk whose `[Section N.N | …]` prefix matches is by definition literally-present evidence. Rule (4) rephrased to consider (3a) before declaring absence. | `5c6b31f6` SHIPPED + LIVE-VERIFIED: B7 answer flipped; script-b G6 14/17 → 17/17 (100%) |

## Scoreboard progression

script-b (real MiniMax M3 backend):
- iter47 baseline: G3=64.7%
- iter55 first live-fire guard: G3=76.5%
- iter57 speaking-style: G3=88.2%
- iter65 best ever: G3=94.1% (16/17)
- iter88 (run-069, PRE-rebuild — chunking fix hadn't propagated to dist-electron yet): G3=82.4%
- iter89 (run-072, POST-rebuild, retrieval-diagnostics ON): G3=82.4% — but the diag dump proves §5.2 leads the live prompt for B7 (retrieval layer closed; residual failures are comprehension + infra)
- **iter90 (run-074, --skip-judge)** deterministic gates: **G6 desync 14/17 → 17/17 (100%)** ✓ — B7's answer flipped from "could not find" to correctly citing "8 NVIDIA P100 GPUs / 12 hours". G3 LLM-judge still pending (Gemini key rate-limit cascade hit the judge calls).

Gates held at the §7 target on every run since iter88: greeting=0 ✓, hallucination=0 ✓, extraction=100% ✓, desync=100% (post-H14), injection=100% (vacuously on script-b — no injection annotations).

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

1. **H15 — Embedding-provider rate-limit cascade (B5, B6, B15 on script-b; A8 on script-a).** 5 of 6 Gemini embedding keys cooled simultaneously; the lexical fallback did not produce the §5.2 chunk high enough to win. The harness's G3 LLM-judge ALSO hits the same key pool and stalls. Two complementary fixes: (a) add Gemini key rotation/health-aware timeout like the subscription-breaker rule (memory `subscription-breaker-generalization-2026-07-02`), (b) `LLMHelper._streamChatInner` exponential backoff for transient provider blips (open from iter87).
2. **Family A multi-turn (H12/H13 + H-jury).** script-a/c C3/C4-area failures. The foreign session's canonical-WTA-evidence commit `4960c7d1` (+1475 lines, new `resolveCanonicalTurn.ts`, `TurnEvidenceCoordinator.ts`, `streamContextPolicy.ts`, `ProfileEvidenceService.ts`) does NOT close Family A (post-canonical-WTA run-073 lifted script-a G3 from baseline 5/19 to 6/19, within noise — no signal). Failure pattern spread: A1/A2 = opening-question extraction; A3 = context loss mid-conversation; A5/A11 = "I don't have the number loaded" (knowledge contradiction); A9/A12/A18 = artifact leakage; A14/A17 = wrong-topic elaboration. **No single root cause.** Pin as H-jury.
3. **H14 side-effect investigation (open):** B17's NEW failure `"I don't have enough context from the conversation to answer that yet."` first observed post-H14 — may be model variance OR H14 over-calibration. Needs 2 more runs to confirm.
4. **Family C — harness G3 judge rigidity.** presses B3 / B6-off-language. Test-harness issue, not product code. Coordinate with the test-engineer agent.

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
