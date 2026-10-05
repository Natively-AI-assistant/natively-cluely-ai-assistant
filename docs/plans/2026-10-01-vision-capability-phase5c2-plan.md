# Vision Capability Phase 5c-2: Local Endpoints in "Keep on Device", the Retry Cap, and the On-the-spot Test — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three changes to the chat screenshot path. (1) With "Keep screenshots on this device" on, a selected LOCAL custom endpoint that reads images answers the screenshot instead of being refused. (2) A leading selected rung is retried less, so an unreachable selected provider costs seconds, not ~16 s, before the fallback. (3) When nothing can read a screenshot and the selected model has never been tested, test it on the spot and send only if it passes.

**Architecture:** All three live in `electron/LLMHelper.ts` around `resolveOutboundVisionDecision` and `buildVisionChain`, reusing what exists: `streamWithCustom`, the fallback engine's per-rung `maxAttempts`, and `VisionProbe.ensure`.

**Tech Stack:** TypeScript (Electron main), esbuild per-file bundles, `node:test` `.mjs` tests against `dist-electron/`, a fake HTTP endpoint in tests.

**Spec:** `docs/plans/2026-10-01-vision-capability-design.md`, section 3 and Delivery item 5 ("Phase 5c (remaining)").

## Facts found during orientation

- **Defect 6 is void.** The cURL lane (`activeCurlProvider`) cannot be selected in the running app: only the `switch-to-curl-provider` IPC sets it, the preload does not expose that channel, and nothing in the renderer calls it. Saved cURL providers are merged into the custom lane at startup (`ProcessingHelper.ts`) and by `switch-to-custom-provider`, so they reach the screenshot chain through the existing `custom` rung. No cURL rung is built. The 5b pre-pass `curl` rung is therefore unreachable too; it stays, annotated.
- **A local custom endpoint is refused in keep-on-device mode.** `resolveOutboundVisionDecision` counts only Ollama as local vision, and the `local_only` branch dispatches only to `streamWithOllama`. The pre-pass (5b) already treats a local custom endpoint as local.
- **Retries.** The engine retries a transient failure up to `maxAttempts` (3) per rung and opens the breaker only on the last attempt. Measured in 5a with Natively unreachable: 3 × 4 s connect timeouts ≈ 16 s before the fallback.
- **The chain can only be empty for an untested selection** with a DeepSeek id that is not Flash by name, or an AgentRouter id the name list does not know: a keyed direct vendor always has its fixed rung, and the other gateways seat on unknown.

## Global Constraints

- macOS and Windows: no OS-specific code.
- Keep-on-device: a screenshot may go only to Ollama (5c-1 rules) or to the SELECTED custom endpoint when its host is loopback or private (`customProviderIsLocal`), it can carry an image (`customProviderSupportsVision`) and it is not switched off. A hosted endpoint stays refused. Never to any other rung.
- The on-the-spot test goes through the existing probe boundary (all privacy gates run), never in local-only or keep-on-device mode, and never sends the screenshot unless the result is "yes". A timeout is not a "no".
- Retry caps apply only when another rung follows; a rung that is the user's only provider keeps the full attempts.
- One build and one suite at a time (`$SP/gate.sh`); `df -h /` before the full suite (it aborts under 1.5 GB); remove the worktree when done.
- Keys never printed. Land on local `main` only. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Keep-on-device: no state sends a screenshot to a hosted custom endpoint or to any cloud rung.
2. A custom endpoint that fails in that mode produces a clear error, and nothing falls through to the cloud.
3. The retry cap never applies to a rung that is alone in the chain; a `<vendor>_selected` rung's single attempt is followed by the vendor's fixed rung.
4. The on-the-spot test never runs when the chain has any rung, never in the two private modes, and a failed or timed-out test leaves today's message and sends nothing.

---

### Task 1: A selected local custom endpoint answers a keep-on-device screenshot

**Files:** `electron/LLMHelper.ts` (`resolveOutboundVisionDecision`, the `_streamChatInner` keep-on-device branch); test `electron/services/__tests__/LocalEndpointKeepOnDevice2026_10_01.test.mjs`.

**Interfaces:** `resolveOutboundVisionDecision` returns `{ decision, localAvailable, localTarget: 'ollama' | 'custom' | null }`. `private localCustomVisionProvider(): CustomProvider | null` — the selected custom provider when it is local, reads images and is not disabled.

- [ ] **Step 1: Failing tests**, with a fake OpenAI-compatible endpoint on 127.0.0.1 and a custom provider whose cURL template has a `messages` body, driven through `_streamChatInner` in `private_vision`:
  - local + reads images → the endpoint receives one request carrying the image; the answer is its reply; no cloud adapter and no Ollama request. RED today: `PRIVATE_VISION_NO_LOCAL_MESSAGE`.
  - hosted (same server behind a `fetch` redirect) → refused, no request.
  - local but text-only template → refused, no request.
  - local, reads images, provider switched off → refused, no request.
  - the endpoint answers HTTP 500 → an error is shown, and nothing cloud is tried.
  - Ollama selected (no custom) → unchanged (5c-1 tests still pass).
- [ ] **Step 2: Implement.** In the keep-on-device branch, when `localTarget === 'custom'`: `streamWithCustom(message, context, imagePaths, prompt, abortSignal)` with the same error shaping as the custom text branch; return. Rebuild; GREEN; run `ScreenUnderstandingModeEnforcement`, `OutboundBoundaryUniversality`, `PrivacyIndicatorParity` serially.
- [ ] **Step 3: Commit** `fix(vision): a selected local endpoint answers a keep-on-device screenshot`.

### Task 2: A leading selected rung is retried less

**Files:** `electron/LLMHelper.ts` (`buildVisionChain`); test: append to `electron/services/__tests__/VisionChainOrder2026_10_01.test.mjs`.

**Rule:** after ordering, when the chain has more than one rung: a leading `<vendor>_selected` rung gets `maxAttempts: 1` (the vendor's fixed rung follows on the same key); any other rung the selection front-loaded gets `maxAttempts: 2`. A chain of one rung is left at the engine default. Fallback rungs are untouched.

- [ ] **Step 1: Failing tests**: `maxAttempts` per case from `buildVisionChain` (`gpt-5.5` + vendors → 1 on `openai_selected`, undefined on `openai`; `natively` + vendors → 2; `openrouter/...` + everything → 2; `deepseek-v4-flash` with only the DeepSeek key → undefined); and one engine-level run: a leading rung that always times out is tried the capped number of times, then the next rung answers.
- [ ] **Step 2: Implement**, rebuild, GREEN; the 5a order baseline passes untouched (ids only).
- [ ] **Step 3: Live** if `api.natively.software` is still unreachable: Natively selected + Gemini key, before and after. Otherwise record that it could not be reproduced.
- [ ] **Step 4: Commit** `perf(vision): a leading selected rung is retried once, not twice, before the fallback`.

### Task 3: Test the selected model on the spot when nothing else can read the screenshot

**Files:** `electron/LLMHelper.ts` (`buildVisionChain` empty-chain block, `testSelectedVisionNow`); test: `electron/services/__tests__/VisionProbeWiring2026_10_01.test.mjs` (append).

**Interfaces:** `private async testSelectedVisionNow(): Promise<boolean>` — false at once unless probing is enabled, the selection is testable and untested, and neither local-only nor keep-on-device mode is on; otherwise `VisionProbe.ensure(selection)` raced against `VISION_INLINE_TEST_BUDGET_MS` (10 s); true only for "yes".

- [ ] **Step 1: Failing tests** (fake probe via the existing wiring test's harness): an untested DeepSeek id with only the DeepSeek key → the chain is built with a `deepseek` rung after a passing test, and the screenshot is sent; a failing test → today's message, nothing sent; a test slower than the budget → today's message, nothing sent, and no "no" is saved; a non-empty chain → the test is never started; keep-on-device and local-only → never started.
- [ ] **Step 2: Implement** (one rebuild of the chain after a pass, no recursion beyond that). Rebuild; GREEN.
- [ ] **Step 3: Live** with the DeepSeek key: an id the name list does not know but the API serves, if one exists; otherwise record that no such id is available.
- [ ] **Step 4: Commit** `feat(vision): test the selected model on the spot when nothing else can read the screenshot`.

### Task 4: Docs, validation, review, landing

- [ ] Design doc: defect 6 marked void with the evidence; 5c-2 built; what remains (Codex / Antigravity measurement, phase 4).
- [ ] `df -h /`; typecheck + `npm test` via `$SP/fullsuite.sh`.
- [ ] Fresh review (most capable model), one fix pass RED→GREEN, re-run the suite.
- [ ] Landing recipe (check the overlap list against the root checkout's dirty files; three-way merge any overlap). Remove the worktree. Do not push.
- [ ] Completion report in CLAUDE.md's categories.
