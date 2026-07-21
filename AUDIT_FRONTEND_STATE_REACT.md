# Natively — Frontend React/State Audit (Phase 6)

_Production-hardening audit, 2026-07-11._

> **Reconstruction note**: rebuilt after a shared-workspace branch switch lost
> the original working-tree file (see `AUDIT_VERIFICATION_REPORT.md`). Content
> matches the original; the cited fix was independently re-verified present
> and passing (5/5) in the final working tree before this file was rewritten.

## Method

Verified every Phase 0 renderer candidate against the real current code
before acting — several turned out to be false positives once read in
context (the codebase has its own documented bug-fix history for exactly
these patterns). One real, fixable perf inconsistency was found and fixed.

## Fixed

### [P2 — FIXED] `onRAGStreamChunk` was the one sibling stream handler NOT rAF-coalesced

**Problem.** `NativelyInterface.tsx`'s Gemini token stream
(`onGeminiStreamToken`) was already rewritten to an imperative, rAF-coalesced
DOM-write pipeline specifically because per-token `setMessages()` calls
(200-400 tok/sec) caused a full messages-array clone + re-render per token.
`MeetingChatOverlay.tsx`'s RAG stream handler was similarly fixed via the
reusable `useStreamBuffer` hook. But `NativelyInterface.tsx`'s **own**
`onRAGStreamChunk` handler — which streams from the exact same
async-generator-over-SSE mechanism (`ipcHandlers.ts`: `for await (const
chunk of stream) event.sender.send('rag:stream-chunk', ...)`) — still called
`setMessages()` synchronously on every chunk. For a long meeting-recall RAG
answer this meant one full array-clone re-render per chunk.

**Fix.** Added `ragChunkBufRef`/`ragChunkRafRef` (matching the existing
`streamingRafRef` pattern already used elsewhere in this file) so chunks
accumulate in a ref and flush to state at most once per animation frame.
`onRAGStreamComplete`/`onRAGStreamError` explicitly flush any buffered
trailing chunk **before** finalizing (so the last frame's text is never
dropped), and the effect's cleanup cancels any pending RAF and clears the
buffer on unmount/deps-change. `isCode` fence-detection behavior is
preserved exactly.

**Test:** `src/lib/__tests__/ragStreamChunkCoalescing.test.mjs` — 5
source-structural assertions (buffer accumulation, single-RAF scheduling,
flush-before-finalize on both complete/error paths, cleanup). 5/5 pass.
`npm run build` (tsc + vite build) passes clean.

## Verified — Phase 0 candidates that did NOT hold up on inspection

- **`App.tsx`'s 250-line mount effect "no cleanup gated on all listeners"** —
  false. Every one of the 9 registered listeners is torn down in the
  effect's own `return () => {...}`. Genuinely large (maintainability
  concern), but not a leak.
- **`SettingsOverlay.tsx` direct DOM writes "may leak on unmount race"** —
  false. Deliberate, already-hardened perf optimization for the
  opacity-preview drag gesture; code comments reference "Bug fix #3
  (close-during-drag)" and "Bug fix #5 (rapid repeated calls)" — a dedicated
  effect already calls `stopPreviewingOpacity()` if the panel closes mid-drag,
  every DOM read is null-guarded.
- **`MeetingChatOverlay.tsx` "self-reference race" on
  `oldDoneCleanup`/`oldErrorCleanup`** — false. IPC callbacks fire
  asynchronously, strictly after the enclosing `const` assignments complete;
  standard, correct self-referencing-closure pattern.
- **Streamed-LLM-HTML XSS via `innerHTML`** — refuted in Phase 2 (DOMPurify
  correctly imported and used with safe defaults).
- **`dangerouslySetInnerHTML`** — zero uses anywhere in `src/`.
- **Secrets in `localStorage`** — checked every `localStorage.setItem` call
  site across the renderer; all are UI-state cache flags (theme, onboarding
  dismissal, toaster gating, a **boolean** premium cache) — no API
  keys/tokens/credentials. Actual secrets stay in the main process via
  `CredentialsManager`.

## Verified — already well-hardened, no fix needed

- **Error boundaries**: every major window/section (`Launcher`, `Overlay`,
  `SettingsPopup`, `ModelSelector`) wrapped in `<ErrorBoundary context="...">`
  in `App.tsx`.
- **`rollingTranscript`/`voiceInput`/`messages` bounds** — covered in Phase 1:
  capped/cleared correctly, not a leak.
- **19+ IPC subscriptions across separate `useEffect`s** — inconsistent
  cleanup *pattern* but every site checked DOES have a real cleanup;
  style/maintainability note, not a functional gap.

## Not actioned (documented, lower priority)

`App.tsx`'s single 250-line mount effect could be split into several
smaller, named effects for readability — pure refactor, no behavior change,
deferred per the audit rule against cosmetic changes that don't reduce risk.
