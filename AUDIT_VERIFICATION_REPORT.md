# Natively — Verification Report (Phase 10)

_Production-hardening audit, 2026-07-11._

## Operational note: shared multi-agent working directory

Partway through this audit, the repo's working directory was found to be in
active concurrent use by other automated agents (confirmed via unfamiliar
commits in `git log`/`git reflog`, an unexpected branch switch from
`context-os-evidence-execution-repair` to `main`, and — during this
verification phase — multiple simultaneous `electron --test` processes
running test suites dated as late as 2026-07-16). See
`shared-workspace-branch-hazard-2026-07-11` in the session's memory notes.

This materially affected verification strategy:
- A full-suite background test run was abandoned mid-flight after files
  changed underneath it from another agent's concurrent edits.
- Final verification instead ran narrowly-scoped test batches (exactly the
  files created/modified this session) rather than the full multi-thousand-test
  suite, which is more resistant to interference from concurrent file changes.
- Every fix from this session was re-verified present in the current working
  tree by direct `grep`/`git diff` inspection immediately before writing this
  report (not assumed from earlier tool output), after discovering one fix
  (`package.json` `build.files` exclusions) had been silently lost and had to
  be reapplied.
- Two files belonging to another agent's in-progress work
  (`electron/LLMHelper.ts`, `electron/intelligence/context-os/*`) were
  identified precisely and left untouched throughout, including through a
  stash/pop cycle used to isolate a false-positive typecheck error that
  turned out to be from their mid-edit state, not a real regression.

## Commands run

```
npm run build                          # tsc (typecheck, noEmit) + vite build
npm run build:electron                 # esbuild bundle of electron/*
npx tsc -p electron/tsconfig.json --noEmit
node --check natively-api/server.js    # backend syntax check
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <scoped files>
node --test src/lib/__tests__/ragStreamChunkCoalescing.test.mjs
npm audit / npm ls prismjs / npm ls diff
```

## Pass/fail status

| Command | Result |
|---|---|
| `npm run build` (tsc + vite) | ✅ Clean, no errors |
| `npm run build:electron` (esbuild) | ✅ Clean |
| `npx tsc -p electron/tsconfig.json --noEmit` | ✅ Clean (0 errors) when only my files are in the working tree; transient 2 errors observed once, traced to another agent's mid-edit `LLMHelper.ts` state — confirmed absent from both committed HEAD and my own file set |
| `node --check natively-api/server.js` | ✅ Clean |
| All 10 new/modified test files (104 tests) | ✅ 104/104 pass |
| `ragStreamChunkCoalescing.test.mjs` (renderer) | ✅ 5/5 pass |
| Full `electron/intelligence/__tests__` suite (754 tests) | ✅ 754/754 pass (verified mid-session, before the branch disruption; re-confirmed the specific files I touched still pass post-disruption) |
| `npm audit` | 7 vulnerabilities → 2 remaining (both dev-server-only vite/esbuild, confirmed unreachable in the packaged app) |

## What was fixed (cross-reference to phase reports)

| # | Fix | Phase report |
|---|---|---|
| 1 | STT region/base-URL SSRF (Azure/IBM/OpenAI) | AUDIT_ELECTRON_SECURITY.md |
| 2 | `generateWithNatively` unbounded read-phase timeout | AUDIT_MEMORY_AND_LOOPS.md |
| 3 | `chatWithCurl` missing axios timeout | AUDIT_MEMORY_AND_LOOPS.md |
| 4 | LocalWhisperSTT zombie loop on spawn failure | AUDIT_MEMORY_AND_LOOPS.md / AUDIT_AUDIO_REALTIME_PIPELINE.md |
| 5 | `DatabaseManager` foreign_keys pragma (premium-independent) | AUDIT_MEMORY_AND_LOOPS.md |
| 6 | Backend main WS `maxPayload` missing | AUDIT_BACKEND_SECURITY_STABILITY.md |
| 7 | EmbeddingPipeline space-label race | AUDIT_MEMORY_AND_LOOPS.md |
| 8 | `redactForLog` missing answer/content/text/output coverage | AUDIT_PRIVACY_SECRETS_LOGGING.md |
| 9 | `electron-builder` `files` missing `.env`/log/PDF excludes | AUDIT_PRIVACY_SECRETS_LOGGING.md / AUDIT_DEPENDENCIES_PACKAGING.md |
| 10 | 6 JD-source answer types invisible to ContextRouter/ProfileIntelligenceRouter | AUDIT_AI_CONTEXT_OWNERSHIP.md |
| 11 | 16 stale context-os tests rewritten to match verified-current behavior | AUDIT_AI_CONTEXT_OWNERSHIP.md |
| 12 | `onRAGStreamChunk` not rAF-coalesced (perf) | AUDIT_FRONTEND_STATE_REACT.md |
| 13 | ModelPreloader stale error/exit listeners double-fired post-handoff | AUDIT_AUDIO_REALTIME_PIPELINE.md |
| 14 | Vulnerable nested prismjs/refractor chain (+ 2 dead dependencies removed) | AUDIT_DEPENDENCIES_PACKAGING.md |
| 15 | **`unhandledRejection` permanently killed the DB on first occurrence (P0)** | AUDIT_ERROR_OBSERVABILITY.md |

## What remains (documented, not fixed — see phase reports for full reasoning)

- Vite/esbuild dev-server CVEs — accepted, unreachable in production, major-version-bump risk not worth it for zero production exposure.
- No `setWindowOpenHandler`/`will-navigate` guard on BrowserWindows — deferred, needs care around dev-server URL retry + OAuth flows.
- No integrity/checksum verification on HuggingFace model downloads — recommend dedicated follow-up (real feature work, not a quick patch).
- No stage-2 update signature verification beyond electron-updater's built-in sha512 — inherent to the GitHub provider, not a code bug.
- WTA's pre-provider retrieval not yet unified through `EvidenceResolver` (manual chat is; WTA isn't yet) — flagged for the next `context-os` session, not freelanced mid-audit given the active, careful in-flight work already underway there.

## Manual verification performed (not just automated tests)

- **react-syntax-highlighter v16 upgrade**: built a standalone Vite+Playwright
  harness importing the exact production module paths
  (`registerPrismLanguages`, `prism-light`, `styles/prism`), rendered real
  JavaScript and Python code blocks, confirmed zero console/page errors and
  visually verified (screenshot) correct syntax-color highlighting in both
  the dark (VS Code Dark Plus) and light (One Light) themes actually used by
  the app.
- All 44 language-grammar subpath imports used by `registerPrismLanguages.ts`
  were individually verified to exist in the v16 npm tarball before
  upgrading, not assumed from changelogs.
- Benchmarked the `MeetingPersistence`/`saveMeeting` transaction cost with a
  realistic 1800-row synthetic transcript under the real Electron
  `better-sqlite3` ABI (not Node's) to refute a claimed "blocks the main
  process for seconds" finding with a real number (1.1ms).

## Production rollout risk assessment

- **Low risk**: all fixes are narrowly scoped, behavior-preserving except
  where the old behavior was the bug (SSRF, silent DB death, stale test
  contracts). Every fix has a passing regression test.
- **Medium risk, flagged for extra review**: the `react-syntax-highlighter`
  major-version bump — verified thoroughly (all import paths, real render
  test) but is the largest single-dependency change in this pass and touches
  a UI surface used constantly (every code block in every chat).
- **No risk found from the shared-workspace incident**: every one of this
  session's fixes was re-verified present and correct in the final working
  tree after the branch disruption; nothing was silently lost except the
  intermediate `.md` audit-report files (pure documentation, now
  reconstructed) and one config array that was caught and reapplied before
  this report was written.
