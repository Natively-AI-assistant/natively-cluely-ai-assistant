# Natively — Production Hardening Final Report

_Full-repo production audit, 2026-07-11. Branch: `context-os-evidence-execution-repair` → `main` (see operational note below)._

## 1. Executive summary

An 11-phase, verification-first production-hardening audit of the Natively
Electron app: main process, IPC/preload, LLM providers, RAG/intelligence
(Context OS), audio/STT pipeline, backend (`natively-api` submodule),
renderer, dependencies/packaging, and error/crash resilience.

**Methodology**: every candidate finding — whether from an automated
architecture sweep or manual inspection — was verified against the real,
current code (often with a direct benchmark or a standalone render test)
before any fix was written. This repeatedly mattered: several
loudly-plausible "P0/P1" claims from the initial sweep turned out to be
false on inspection (refuted below), while some genuinely severe bugs were
found only by tracing actual runtime behavior rather than trusting
docstrings or comments.

**Headline finding**: `unhandledRejection` was unconditionally closing the
main SQLite database on its **first** occurrence, with the app continuing to
run silently for the rest of the session — a P0, session-wide, silent
permanent data-loss bug triggered by any routine missing `.catch()`
anywhere in the codebase. Fixed.

**Operational note**: partway through this audit, the repo's working
directory was discovered to be in active concurrent use by other automated
agents — a branch switch happened mid-session, unfamiliar commits appeared
in the log, and multiple simultaneous test runs (dated up to 5 days ahead)
were observed. This was navigated carefully: every fix from this session was
individually re-verified present and correct in the final working tree by
direct inspection (not assumed), two files belonging to another agent's
in-progress work were identified precisely and never touched, and one
fix that was transiently lost (`package.json` `build.files` exclusions) was
caught and reapplied before this report was written. See
`AUDIT_VERIFICATION_REPORT.md` for the full account.

## 2. Files changed (this session's own work)

| File | Change |
|---|---|
| `electron/main.ts` | `unhandledRejection` handler no longer unconditionally kills the DB (P0 fix) |
| `electron/utils/curlUtils.ts` | +`isValidSttRegion()`, +`validateSttBaseUrl()` (SSRF guards) |
| `electron/ipcHandlers.ts` | STT region/base-URL IPC setters + test-connection now validate before storing/using |
| `electron/audio/RestSTT.ts` | constructor drops malformed region (defense in depth) |
| `electron/LLMHelper.ts`* | `generateWithNatively` read-phase timeout; `chatWithCurl` axios timeout |
| `electron/audio/LocalWhisperSTT.ts` | spawn-failure teardown (no more zombie streaming loop) |
| `electron/db/DatabaseManager.ts` | `PRAGMA foreign_keys = ON` independent of premium module |
| `electron/rag/EmbeddingPipeline.ts` | space-label race fix (capture provider before await) |
| `electron/intelligence/ContextRouter.ts` | 6 JD-source answer types now correctly routed |
| `electron/llm/ProfileIntelligenceRouter.ts` | 3 resume+JD-mix types added to `PROFILE_ANSWER_TYPES` |
| `electron/intelligence/ProfileTreeService.ts` | stale `getRoleFit()` docstring corrected |
| `electron/utils/redactForLog.ts` | redaction regex covers `answer`/`content`/`text`/`output`/etc. |
| `src/components/NativelyInterface.tsx` | `onRAGStreamChunk` rAF-coalesced (perf) |
| `electron/audio/whisper/modelPreloader.ts` | `takeWarmWorker()` removes ALL stale listeners, not just `message` |
| `package.json` | removed unused `react-code-blocks`/`diff`; `react-syntax-highlighter` 15→16 (security); `build.files` excludes `.env`/logs/PDFs |
| `vite.config.mts` | removed dead `react-code-blocks`/`diff` chunk entries |
| `natively-api/server.js`** | WS `maxPayload` bounded to 1MB |
| 10 new/updated test files | see AUDIT_VERIFICATION_REPORT.md for the full list |

\* `electron/LLMHelper.ts`'s diff in the current working tree is a mix of my
Phase 1 fix (already committed, verified present) plus unrelated concurrent
edits from another agent — not touched further by me.
\*\* Separate git submodule; verified independently.

## 3. Critical issues found

1. **`unhandledRejection` → permanent silent database death** (P0) — the
   headline finding. See §1 and `AUDIT_ERROR_OBSERVABILITY.md`.
2. **STT region/base-URL SSRF** (P1) — renderer could redirect the app's own
   key-bearing STT request to an attacker host via Azure/IBM region or
   OpenAI base URL. See `AUDIT_ELECTRON_SECURITY.md`.
3. **6 JD-source answer types invisible to context routing** (P1) — a
   context-ownership bug corrupting shadow-mode telemetry ahead of a planned
   flag flip; would have caused real profile-grounding failures once
   `contextRouterV2` goes live. See `AUDIT_AI_CONTEXT_OWNERSHIP.md`.
4. **Vulnerable `prismjs`/`refractor` chain in production code-rendering
   path** (P1, supply chain) — moderate CVSS DOM-clobbering vuln reachable
   via 3 production rendering surfaces. See `AUDIT_DEPENDENCIES_PACKAGING.md`.
5. **`DatabaseManager` foreign-key enforcement silently premium-dependent**
   (P2) — cascade deletes would orphan rows if the premium submodule ever
   failed to load. See `AUDIT_MEMORY_AND_LOOPS.md`.
6. **ModelPreloader stale listeners double-firing post-handoff** (P2) — a
   transient in-recording error could silently poison the next meeting's
   pre-warm for 5 minutes. Notably: the fix and its test already existed in
   comment/test form but were never actually applied to the source — found
   by tracing actual behavior, not trusting the comment. See
   `AUDIT_AUDIO_REALTIME_PIPELINE.md`.

## 4. Critical issues fixed

All 6 above, plus: LLM provider read-phase timeouts (P1), backend WS
`maxPayload` (P2), RAG embedding space-label race (P3), `onRAGStreamChunk`
perf inconsistency (P2), redaction regex hardening (P3), packaging
`.env`/log/PDF exclusion (P1). Full detail + evidence in each phase's
`AUDIT_*.md`.

## 5. Security fixes

- STT endpoint SSRF (region + base-URL validation at 3 layers).
- Vulnerable `prismjs`/`refractor` supply-chain chain removed (major-version
  upgrade, verified with a real render test, not just `npm audit` output).
- 2 dead dependencies (`react-code-blocks`, `diff`) removed, closing their
  own independent vulnerable-nested-copy exposure.
- Packaging exclusions for `.env`/logs/PDFs added as defense-in-depth.
- **Refuted, not fixed** (verified as false positives): committed backend
  secrets, custom-curl "shell injection," streamed-answer XSS via innerHTML,
  admin-endpoint key exposure, forgeable trial tokens. See each phase report
  for the evidence trail — worth reading if revisiting any of these areas,
  since the refutation evidence is specific and re-checkable.

## 6. Memory/performance fixes

LocalWhisperSTT zombie streaming loop (leaked timer + silently-dead STT),
LLM request timeouts (2 sites), RAG embedding space-label race,
`onRAGStreamChunk` rAF coalescing. **Refuted** (benchmarked, not assumed):
`RestSTT` chunk buffer, `MeetingPersistence` transcript-write "seconds"
claim (real number: 1.1ms for 1800 rows), `OpenAIStreamingSTT` key-rotation
leak, VectorStore worker leak, renderer unbounded state.

## 7. AI context ownership fixes

6 JD-source answer types wired into `ContextRouter`/`ProfileIntelligenceRouter`
to match `AnswerPlanner`'s already-correct policy (verified type-by-type
against the source of truth, not invented). 16 stale context-os tests
rewritten to assert the current, verified-correct JIT-prompt contract
(a stronger ownership guarantee than the literal-string contract they
originally asserted). Full contamination-suite regression run (79/79 pass).
Deliberately did NOT expand WTA's retrieval unification mid-audit — flagged
for the next `context-os` session instead, given the active, careful
in-flight work already underway there.

## 8. Audio/realtime fixes

LocalWhisperSTT spawn-failure teardown, ModelPreloader stale-listener fix,
STT SSRF (cross-referenced from Phase 2). Verified `RestSTT` and
`OpenAIStreamingSTT` claims were false via direct code tracing rather than
accepting the initial sweep's severity assessment.

## 9. Backend fixes

WS `maxPayload` bounded on the main `natively-api/server.js` server (was
inheriting the `ws` library's 100MB default; now matches the STT relay's
1MB). Refuted 3 other claimed backend vulnerabilities with specific evidence
(admin gating, trial-token fatal-exit coverage, `.env` tracking status).

## 10. Frontend fixes

`onRAGStreamChunk` rAF coalescing (the one stream handler in
`NativelyInterface.tsx` that hadn't received the same perf treatment as its
siblings). Refuted 4 other claimed renderer bugs (mount-effect cleanup,
direct-DOM-write race, self-reference closure race, XSS) after reading the
actual code and finding each one already correctly handled.

## 11. Packaging/dependency fixes

`react-syntax-highlighter` 15→16 major upgrade (removes the vulnerable
nested `prismjs`/`refractor` chain) — verified all 44 language-grammar
import paths exist in the new version before upgrading, and **manually
verified the render output** via a standalone Playwright harness (real
JS/Python code blocks, correct syntax colors, zero console errors,
screenshot-confirmed) rather than trusting a clean build alone. Removed 2
completely-unused dependencies. Added `electron-builder` packaging
exclusions. Assessed and **deliberately left** the vite/esbuild dev-server
CVEs (confirmed unreachable in the packaged app; major-bump risk not
justified for zero production exposure).

## 12. Tests added/updated

10 test files, ~150+ new/updated assertions total:
- `sttEndpointValidation.test.mjs` (28 tests)
- `ForeignKeyCascade2026_07_10.test.mjs` (2 tests)
- `LocalWhisperSpawnFailTeardown2026_07_10.test.mjs` (1 test)
- `ModelPreloaderTakeWarmWorker.test.mjs` (2 tests, pre-existing — now passes)
- `UnhandledRejectionDbSurvival2026_07_11.test.mjs` (4 tests)
- `ragStreamChunkCoalescing.test.mjs` (5 tests, renderer)
- `ContextRouterShadowWiring.test.mjs` (+5 new cases, 18 total)
- `ProfileTreeDeterministicFastPath2026_06_15.test.mjs` (rewritten, 18 tests)
- `ProfileTreeService.test.mjs` (rewritten, 15 tests)
- `RedactForLog.test.mjs` (+1 case, 7 total)
- Plus a behavioral race-condition test added to `EmbeddingFallbackSinglePath.test.mjs`

Every test was verified against real compiled/built output before being
trusted — several first drafts had to be corrected against actual runtime
behavior (e.g., exact answer-type classifications, exact `checkedSources`
values) rather than assumed.

## 13. Commands run

```
npm run build                          # tsc + vite build — clean
npm run build:electron                 # esbuild — clean
npx tsc -p electron/tsconfig.json --noEmit  # clean (0 errors, my files)
node --check natively-api/server.js    # clean
ELECTRON_RUN_AS_NODE=1 electron --test <every new/modified file>  # 104/104 + 5/5 pass
npm audit                              # 7 → 2 vulnerabilities (remaining 2 confirmed dev-only)
Real render verification (Playwright)  # syntax-highlighter upgrade
better-sqlite3 benchmark               # refuted a false P1 claim with data
```

## 14. Remaining risks (documented, not fixed — see phase reports for full reasoning)

- No `setWindowOpenHandler`/`will-navigate` guard on BrowserWindows.
- No integrity/checksum verification on HuggingFace model downloads.
- No stage-2 electron-updater signature verification beyond built-in sha512
  (inherent to the GitHub provider).
- Vite/esbuild dev-server CVEs (confirmed unreachable in production).
- WTA's pre-provider retrieval not yet unified through `EvidenceResolver`
  (manual chat is; WTA isn't yet) — next `context-os` phase.
- `uncaughtException`'s non-`[nativeArch]` fallthrough shares the same
  "doesn't exit the process" shape as the fixed `unhandledRejection` bug,
  but is a strictly stronger signal per Node's own guidance and was left
  as-is (documented asymmetry) rather than expanding scope into a larger
  architectural question about whether it should also exit.

## 15. Recommended next phase

1. Address the `setWindowOpenHandler`/`will-navigate` gap with careful
   testing against the dev-server retry and OAuth flows.
2. Continue the in-flight `context-os` WTA/`EvidenceResolver` unification.
3. Add HuggingFace model download integrity verification as a dedicated
   feature (not a quick patch).
4. Revisit the `uncaughtException` exit-vs-survive question as a deliberate
   architectural decision, not a drive-by fix.
5. Given this session's discovery of a genuinely shared, multi-agent working
   directory, any future audit-style session in this repo should read
   `AUDIT_VERIFICATION_REPORT.md`'s operational note and the
   `shared-workspace-branch-hazard-2026-07-11` memory entry before assuming
   `git status` reflects only its own changes.
