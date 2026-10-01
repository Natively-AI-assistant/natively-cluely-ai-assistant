# Vision Capability Phase 5c-1: Ollama Makes the Screen Record, and "Keep on Device" Uses the Model That Reads Images — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) After a screenshot answer, the Ollama model writes the screen's text record when no cloud provider made one, and always in "Keep screenshots on this device" mode. (2) In that mode, and when the screenshots scope is denied, a screenshot goes to the installed Ollama model that actually reads images, instead of being refused because the selected text model does not.

**Architecture:** One resolver already exists in `LLMHelper` (`refreshOllamaVisionModel` / `resolveOllamaVisionModelForChain`: `/api/tags` + `/api/show`, cached). Both parts use it. The record rung lives in the screen registry, is fed by the live helper, and is invoked through `runVisionRequest('ollama')`, which collects the existing `streamWithOllama` with the resolved model. The service runs it as a second stage with its own time limit, so the cloud record keeps its 6 s envelope unchanged.

**Tech Stack:** TypeScript (Electron main), esbuild per-file bundles, `node:test` `.mjs` tests against `dist-electron/`, a fake Ollama HTTP server in tests.

**Spec:** `docs/plans/2026-10-01-vision-capability-design.md` — Evin's record rule (5b note), defect 4.

## Evin's rule (2026-10-01)

"If user has selected keep it on device [it stays there]; if not, send it to cloud if available, else send it to the Ollama model and keep the response stored for later turns."

## Global Constraints

- macOS and Windows: no OS-specific code; no process is started. The rung is seated only when Ollama is the SELECTED provider (`useOllama`), so a daemon the user did not choose is never probed or started.
- The pre-pass does not change: Ollama still gets no pre-pass (Evin, 5b). The 5b pre-pass baseline must pass untouched.
- "Local" is earned from the URL host (`customProviderIsLocal`), as for custom and cURL rungs: the Ollama URL can be set to another machine (`OLLAMA_URL`, `switchToOllama(model, url)`). A remote Ollama is not eligible in "keep on device" mode. (The chat path hardcodes Ollama as local: pre-existing, recorded, not copied.)
- Never send blind: the rung is seated only when the resolver names a model that reads images (`/api/show`, else the name list). No model → no rung.
- The record must not block the user's next answer: an Ollama answer cancels an in-flight record request.
- One adapter: the registry's own never-run `/v1/chat/completions` fetch is removed.
- Not measurable on this machine (no Ollama): tests use a fake Ollama HTTP server and assert the request on the wire. Reported as such.
- One build and one suite at a time (`$SP/gate.sh`); check `df -h /` before the full suite; remove the worktree when done.
- Keys never printed. Land on local `main` only. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. The pre-pass (every action except `transcribe`) never reaches Ollama.
2. In "keep on device" mode the record goes only to a rung on a loopback or private host.
3. The model named by the check is the model the request is sent to, at every keep-on-device and scope-denied site. The user's selected text model is never overwritten by the vision model.
4. A user whose selected Ollama model is text-only and who has no installed vision model is refused exactly as before.
5. A record in flight is cancelled when an Ollama answer starts, and a cancelled record stores nothing.

## Sites that check for local vision, and what they dispatch to (before → after)

| Site (`LLMHelper.ts`) | Path | Checks | Dispatches to (before) | After |
|---|---|---|---|---|
| `resolveOutboundVisionDecision` | all | `ensureOllamaModelSelected(true)`: the SELECTED model's name | — | the resolver's vision model; returns it |
| `_streamChatInner` keep-on-device (~10090) | live | above | `streamWithOllama(…)` → selected model | `streamWithOllama(…, visionModel)` |
| `_streamChatInner` scope-denied (~10057) | live | `ensureOllamaModelSelected(screenshotsDenied)` | `streamWithOllama(…)` → selected model | the vision model when the turn carries images |
| `chatWithGemini` (~4751, ~4782) | unreachable with images | same | `callOllama(…)` → selected model | `callOllama(…, visionModel)` |
| `generateWithVisionFallback` (~7918) | unreachable | same | `callOllama(…)` | `callOllama(…, visionModel)` |
| `streamChatWithGemini` (~8313, ~8335) | unreachable with images | same | `callOllama(…)` | `callOllama(…, visionModel)` |
| `scopeFallbackAvailable(true)` | Privacy panel indicator | `checkOllamaAvailable(true)` | — | true when a vision model resolves |

## File structure

- Modify `electron/LLMHelper.ts`: `resolveLocalVisionModel()`, `probeOllama` (vision branch), `ensureOllamaModelSelected`, `resolveOutboundVisionDecision`, the dispatch sites, `callOllama` (model override), `runVisionRequest('ollama')`, `resolveOllamaRecordTarget()` / `getOllamaRecordTarget()`, record cancellation in `streamWithOllama`.
- Modify `electron/llm/activeCustomProvider.ts`: `readOllamaRecordTarget()`, `resolveOllamaRecordTarget()`.
- Modify `electron/services/screen/VisionProviderRegistry.ts`: the `ollama()` rung rebuilt on the live helper; `callOllamaVision` removed.
- Modify `electron/services/screen/ScreenUnderstandingService.ts`: resolve before building for record calls; second stage with `OLLAMA_RECORD_BUDGET_MS`; fenced-JSON unwrap in `extractStructured`.
- Tests: `electron/services/__tests__/OllamaLocalVision2026_10_01.test.mjs` (new, with the fake server); `ScreenPrepassRegistry2026_10_01.test.mjs` (record rule for the Ollama rung).

Commands run from the worktree `.claude/worktrees/vision-phase5c1`. `SP` = the session scratchpad.

---

### Task 1: "Keep on device" and scope-denied screenshots use the Ollama model that reads images (defect 4)

**Interfaces:**
- `private async resolveLocalVisionModel(): Promise<string | null>` — `useOllama` and not disabled → `this.ollamaVisionModel ?? await this.resolveOllamaVisionModelForChain()`.
- `probeOllama(needsVision)` returns `{ ok, model?, visionModel? }`; with `needsVision`, `ok` iff `resolveLocalVisionModel()` names a model. `model` stays the text model.
- `resolveOutboundVisionDecision` returns `{ decision, localAvailable, localVisionModel }`.
- `callOllama(prompt, imagePath?, systemPrompt?, modelOverride?)`.

- [ ] **Step 1: Fake Ollama server + failing tests** (`OllamaLocalVision2026_10_01.test.mjs`). The server implements `/api/tags`, `/api/show` (per-model `capabilities`), `/api/chat` (streaming NDJSON and non-streaming), and records every request. A REAL `LLMHelper` constructed with `useOllama = true` and the server's URL; the screen-understanding mode forced through the helper's reader (find how `readScreenUnderstandingMode` gets its value and stub that seam).
  - Selected `qwen2.5:4b` (text-only by `/api/show`), installed `llava:7b` (vision): a keep-on-device screenshot turn through `streamChat` → `/api/chat` carries `model: 'llava:7b'` and the base64 image. RED today: refused with the "no local vision" message.
  - A model whose name is not on the list but `/api/show` reports `vision` → used.
  - No installed vision model → refused as today; no `/api/chat` request.
  - After the turn, `getCurrentModel()` / `ollamaModel` is still `qwen2.5:4b`.
  - Screenshots scope denied (not keep-on-device), Ollama selected, image attached → the vision model; no image → the selected text model as before.
  - `scopeFallbackAvailable(true)` is true with the text-only selection plus an installed vision model; false with none.
- [ ] **Step 2: Implement** per the table. Rebuild; GREEN; the existing scope/vision suites pass (`ScreenUnderstandingModeEnforcement`, `ScopeFallback*`, `OllamaVisionChainProbeBudget`, `PrivateVision*`).
- [ ] **Step 3: Commit** `fix(vision): "keep on device" sends a screenshot to the Ollama model that reads images`.

### Task 2: The Ollama model writes the screen record

**Interfaces:**
- `public async resolveOllamaRecordTarget(): Promise<{ model: string; url: string } | null>` and sync `public getOllamaRecordTarget()` (cached model only). `runVisionRequest('ollama', …)` collects `streamWithOllama(user, undefined, system, [image], signal, target.model)`.
- `readOllamaRecordTarget()` / `resolveOllamaRecordTarget()` in `activeCustomProvider.ts`.
- Registry `ollama()`: seated only for `purpose === 'record'` with a target; `isLocal` from the URL host; `modelId` the vision model; `timeoutMs` `OLLAMA_RECORD_TIMEOUT_MS`.
- Service: `OLLAMA_RECORD_BUDGET_MS = 45_000`. For a record call: `await resolveOllamaRecordTarget()`, build, run stage 1 over every rung except `ollama` with the 6 s budget as today; if it produced nothing and the Ollama rung is eligible, run stage 2 over that rung alone with the record budget.

- [ ] **Step 1: Failing tests.**
  - Registry (existing harness): record + Ollama selected with a target → `ollama=<model> (local)` last in `vision_first`, alone in `private_vision`; a remote Ollama URL → seated in `vision_first`, not eligible in `private_vision`; no target → no rung; the PRE-PASS never seats it; the 5b baseline passes untouched, with one new named rule in its record half.
  - Helper, on the wire with the fake server: `runVisionRequest('ollama', …)` sends `model: <vision model>`, the image and the system prompt; throws when no target.
  - Service: Ollama selected, no cloud key → `understand({ userAction: 'transcribe' })` returns the fake server's text, `providerUsed: 'ollama'`; with a working cloud rung (provider override) the cloud answers and Ollama is not called; the same call with `userAction: 'what_to_say'` never calls Ollama.
  - Replies: valid JSON, prose, and JSON inside a code fence each produce a non-empty stored description.
  - Cancellation: a record whose `/api/chat` is held open is aborted when an Ollama answer starts; nothing is stored for it.
- [ ] **Step 2: Implement.** Remove `callOllamaVision` and the dead credential reads. Rebuild; GREEN.
- [ ] **Step 3: Commit** `feat(vision): the Ollama model writes the screen record when no cloud provider does`.

### Task 3: Docs, validation, review, landing

- [ ] Design doc: 5c-1 built (what, the unmeasured parts, the remote-URL rule); the remaining 5c items unchanged.
- [ ] `df -h /`; typecheck + `npm test` via `$SP/fullsuite.sh`.
- [ ] Fresh review (most capable model), one fix pass RED→GREEN, re-run the suite.
- [ ] Landing recipe; remove the worktree; do not push.
- [ ] Completion report in CLAUDE.md's categories. `Reviewed but not executed` for everything that needs a real Ollama.
