# Vision Capability Phase 5b: The Screen Pre-pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the screen pre-pass (`VisionProviderRegistry` → `ScreenUnderstandingService`) truthful and private: it never sends a screenshot to a text-only model, it never sends one to a cloud provider when the user selected a local model, and a selected DeepSeek Flash or cURL provider can run it.

**Architecture:** The registry keeps its design (rungs built from the credential store plus the live selection, each invoked through `LLMHelper.runVisionRequest`). It learns the full selection through one new accessor. Cloud rungs keep today's fixed order. A local selection removes the cloud rungs for that turn. Two selected-only rungs are added at the end. Breaker memory is reset when the selection changes, through one pure helper shared with the chat path.

**Tech Stack:** TypeScript (Electron main), esbuild per-file bundles, `node:test` `.mjs` tests against `dist-electron/`.

**Spec:** `docs/plans/2026-10-01-vision-capability-design.md` (section 3; defects 7, 8, 9), amended by Evin's two decisions below.

## Evin's decisions (2026-10-01), which amend section 3 for this path

1. **"Local selection leads; cloud stays fast."** The pre-pass does NOT put a cloud selection first. Measured full pre-pass reply on a real screenshot (4 runs each): Flash-Lite ~1.5 s, Flash ~2.2 s, Pro ~4.0 s, against a first-rung slot of 3.6 s inside a 6 s total budget. Since phase 5a the selected model reads the screenshot in the answer itself.
2. **"No cloud pre-pass for a local selection."** With Ollama, a local custom endpoint or a local cURL provider selected, the pre-pass uses local rungs only. A local custom or cURL endpoint that reads images runs it. Ollama gets no pre-pass: it reads the screenshot in the answer itself, as it already does in "Keep screenshots on this device" mode.

## Facts found during orientation

- **The pre-pass has never used Ollama.** `ollama()` reads `ollamaBaseUrl` / `ollamaModel` from the credential store; nothing in the app writes either field, so the rung is never configured. `codex()` reads `codexCliPath` from the same store; that setting lives in `SettingsManager`. Both rungs are dead.
- **Defect 9 is real.** `runVisionRequest('openai')` calls `generateWithOpenai(…, [image])` with no model, so the screenshot goes to `currentModelId` whenever that is an OpenAI id, text-only or not. `'claude'` does the same (harmless: every Claude model reads images, but the label is wrong).
- **The non-streaming image paths are unreachable**: `gemini-chat` (non-stream) and `analyze-image-file` have no renderer caller; RAG passes no images to `streamChatWithGemini`. They are out of scope here.
- The pre-pass chain skips a rung whose breaker is open (it does not reorder), and its health has no speed measurement. So `orderVisionCandidates` is not used here; only the breaker reset is shared.

## Global Constraints

- macOS and Windows: no OS-specific code; no new process is spawned by the registry (every rung goes through `runVisionRequest`).
- `private_vision` keeps only rungs with `isLocal === true`. No change may make a cloud destination eligible there. Task 5 enumerates this.
- Cloud order for a cloud selection is unchanged. The only allowed differences from the Task 1 baseline: (a) a local selection removes cloud rungs; (b) a `deepseek` or `curl` rung appended for that selection.
- Never send blind: the DeepSeek rung is seated only when the resolver says the selected model reads images (`readsImages(…, false)`).
- Not built, by ruling: Codex and Antigravity pre-pass rungs. Both are slow reasoning routes that could not be measured here (no sign-in in a script), a Codex-only or Antigravity-only user gets an instant skip today, and a rung that cannot answer inside 6 s would add that wait before every screenshot answer. Reported to Evin.
- One build and one suite at a time (`$SP/gate.sh`). No dev app. Check `df -h /` before the full suite; delete this worktree's `dist-electron` when the phase is done (1.3 GB).
- Keys never printed. Land on local `main` only. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. With a local selection, no cloud rung is eligible in any mode, including a hosted custom endpoint saved but not selected.
2. With a hosted custom or hosted cURL selection, nothing changes except the cURL rung existing.
3. A text-only selected OpenAI model never receives the pre-pass screenshot.
4. `private_vision` eligibility: only `isLocal === true` rungs, for every key set and selection in the matrix.
5. A breaker opened for one selection does not skip the next selection's rung.

## File structure

- Modify `electron/llm/activeCustomProvider.ts`: `readActiveSelection()`, `readActiveCurlProvider()`, `readFixedVisionModels()`.
- Modify `electron/LLMHelper.ts`: `getActiveCurlProvider()`, `getFixedVisionModels()`, `runVisionRequest` (fixed models for `openai` / `claude`; new `deepseek` and `curl` cases); the breaker-reset loop in `buildVisionChain` moves to the shared helper.
- Modify `electron/llm/visionOrdering.ts`: `forgetBreakersOfOtherSelections`.
- Modify `electron/services/screen/VisionProviderRegistry.ts`: local-selection rule, truthful model ids, `deepseek()` and `curl()` rungs, Codex `isLocal: false`, honest comments on the dead Ollama rung.
- Modify `electron/services/screen/ScreenUnderstandingService.ts`: breaker reset on selection change; the unavailable message no longer offers Codex as a local option.
- Tests: `electron/services/__tests__/ScreenPrepassRegistry2026_10_01.test.mjs` (new) + fixture `fixtures/screenPrepassRungs2026_10_01.json`; `electron/llm/__tests__/VisionOrdering2026_10_01.test.mjs` (extend).

Commands run from the worktree `.claude/worktrees/vision-phase5b`. `SP` = the session scratchpad.

---

### Task 1: Record what the pre-pass would try, before changing it

**Files:** create the test and its fixture.

**Interfaces:** produces the harness used by every later task: `rungs({ keys, selection, mode })` → the ELIGIBLE rungs in order, each `id` plus `modelId`, where eligible = `isConfigured && supportsVision && scopeAllowsScreenshots && (mode !== 'private_vision' || isLocal)`.

- [ ] **Step 1: Harness.** Load `dist-electron/electron/services/screen/VisionProviderRegistry.js` under the electron stub. Replace `CredentialsManager.getInstance` with a fake exposing the getters the registry calls (`getNativelyApiKey`, `getOpenaiApiKey`, `getGeminiApiKey`, `getClaudeApiKey`, `getGroqApiKey`, `getLitellmBaseURL`, `getNinerouterBaseURL`, `getNinerouterVisionModels`, `getNvidiaNimApiKey`, `getOpenrouterApiKey`, `getFluxionApiKey`, `getAgentRouterApiKey`, `getDeepseekApiKey`, `getAllCredentials`). Install a fake helper on `globalThis.__nativelyGetLLMHelper` with `getCurrentModelId`, `getActiveCustomProvider`, and (for later tasks) `getDirectAssistSelection`, `getActiveCurlProvider`, `getFixedVisionModels`. Reset the capability store per case.
- [ ] **Step 2: Matrix.** Key sets: none; Gemini; OpenAI; Natively + OpenAI + Gemini + Claude + Groq; everything. Selections: `gemini-3.8-flash`, `gpt-3.5-turbo`, `gpt-5.5`, `claude-opus-5`, `natively`, `deepseek-v4-flash`, `deepseek-v4-pro`, `openrouter/openai/gpt-4o`, `litellm/internal`, `fluxion/claude-opus-5`, `agentrouter/claude-opus-5`, `ninerouter/openai/gpt-5`, Ollama selected, local custom with an image placeholder, hosted custom with one, local custom without one, local cURL with one, hosted cURL with one. Modes: `vision_first`, `private_vision`.
- [ ] **Step 3: Write the baseline** (`PREPASS_BASELINE_WRITE=1`), run again without the flag: PASS. Read cases by eye: with Ollama selected and Gemini keyed, the eligible list is the Gemini cloud rungs (the screenshot goes to the cloud); in `private_vision` with Ollama it is empty.
- [ ] **Step 4: The comparison rule** (in the same test): for every case, `now` equals `before`, except (a) local selection (Ollama, local custom, local cURL) → every cloud rung gone; (b) a `deepseek` rung appended when DeepSeek Flash is selected and keyed; (c) a `curl` rung where a cURL provider that reads images is selected (local: both modes; hosted: `vision_first` only, last); (d) `modelId` of `openai` / `claude` changing from the stale label to the fixed vision model. Each exception names its rule; anything else fails.
- [ ] **Step 5: Commit** `test(vision): record which providers the screen pre-pass would try, before changing it`.

### Task 2: A text-only selected OpenAI model never gets the pre-pass screenshot (defect 9)

**Files:** `electron/LLMHelper.ts` (`runVisionRequest`, `getFixedVisionModels`), `electron/llm/activeCustomProvider.ts` (`readFixedVisionModels`), the registry's `openai()` / `claude()` `modelId`.

**Interfaces:** `public getFixedVisionModels(): { openai: string; claude: string }` (version-manager tier 1, else the constants); `readFixedVisionModels(): { openai?: string; claude?: string }`.

- [ ] **Step 1: Failing test.** A bare-prototype helper with `currentModelId: 'gpt-3.5-turbo'`, `generateWithOpenai` / `generateWithClaude` replaced by recorders: `runVisionRequest('openai', …)` must pass the fixed vision model as the model argument, never `undefined` and never `gpt-3.5-turbo`; same for `claude` with `claude-opus-5` selected (expects the fixed Claude model). RED: today the fourth argument is `undefined`.
- [ ] **Step 2: Implement**, rebuild, GREEN. The registry shows the same model id (baseline exception d).
- [ ] **Step 3: Check Groq's default** (`generateWithGroqMultimodal`) is the Groq vision model; add an assertion.
- [ ] **Step 4: Commit** `fix(vision): the screen pre-pass sends to each vendor's vision model, not the selected one`.

### Task 3: A local selection keeps the pre-pass off the cloud

**Files:** `electron/llm/activeCustomProvider.ts` (`readActiveSelection`, `readActiveCurlProvider`), `electron/LLMHelper.ts` (`getActiveCurlProvider`), the registry.

**Interfaces:** `readActiveSelection(): { provider: string; model: string } | null` (wraps the helper's public `getDirectAssistSelection()`, null when it throws or the helper is absent). In the registry: `selectionIsLocal()` = provider `ollama`, or `custom` with `customProviderIsLocal(active custom)`, or `curl` with `customProviderIsLocal(active curl)`.

- [ ] **Step 1: Failing tests** (harness from Task 1): Ollama selected + all cloud keys, `vision_first` → no eligible cloud rung; local custom with an image placeholder → `['custom']` only; local custom without one → `[]`; hosted custom → unchanged from baseline; helper absent or throwing → unchanged (fails open to today's behaviour).
- [ ] **Step 2: Implement:** `const cloudAllowed = inputs.mode !== 'private_vision' && !selectionIsLocal();`. Rebuild, GREEN, baseline passes with exception (a) only.
- [ ] **Step 3: Commit** `feat(vision): with a local model selected, the screen pre-pass stays off cloud providers`.

### Task 4: Selected DeepSeek Flash and cURL providers can run the pre-pass

**Files:** the registry (`deepseek()`, `curl()`), `electron/LLMHelper.ts` (`runVisionRequest` cases `deepseek`, `curl`).

**Interfaces:** rung ids `deepseek` (cloud, last among cloud) and `curl` (`isLocal` from the host; after `custom`). `runVisionRequest('deepseek')` collects `streamWithDeepseek(user, system, currentModelId, signal, [image])`; `runVisionRequest('curl')` collects `streamWithDirectCurl(activeCurl, user, system, [image], signal)`.

- [ ] **Step 1: Failing tests.** Registry: DeepSeek Flash selected + key → `deepseek` eligible, last; Pro selected → not seated; Flash not selected → not seated; a passed test for an unknown DeepSeek id seats it, a failed one unseats Flash. cURL: local with an image placeholder → eligible in both modes; hosted → `vision_first` only; no placeholder and no `messages` body → not seated; not selected → not seated. Helper: both new cases call the right adapter with the image and return the joined text; `curl` with no active provider throws.
- [ ] **Step 2: Implement**, rebuild, GREEN; baseline passes with exceptions (b), (c).
- [ ] **Step 3: Live** (`$SP/vp5b-live.mjs`, DeepSeek key only): the real registry + real helper + `runVisionFallback` on a real screenshot with the 6 s budget. Before (Task 3 build): no eligible rung. After: `deepseek` answers; record the duration (must sit well inside 6 s).
- [ ] **Step 4: Commit** `feat(vision): a selected DeepSeek Flash or cURL provider can run the screen pre-pass`.

### Task 5: Privacy enumeration, the Codex trap, breaker reset

**Files:** the registry, the service, `electron/llm/visionOrdering.ts`, `electron/LLMHelper.ts`.

**Interfaces:** `forgetBreakersOfOtherSelections(ledFor: Map<string, string>, health: { delete(id: string): unknown }, rungIds: readonly string[], selectionKey: string): void` — a rung that last ran for a different selection starts clean; one never seen keeps its breaker.

- [ ] **Step 1: Failing tests.**
  - `private_vision`, every key set × selection: every eligible rung has `isLocal === true` (passes today; a guard for the new rungs).
  - The Codex rung reports `isLocal: false` (RED today): it sends to chatgpt.com, and a later change that enables its vision must not make it a "local" destination.
  - `forgetBreakersOfOtherSelections` unit tests (RED: missing export), and the 5a chain tests still pass with `buildVisionChain` calling it.
  - Service: `rungHealth` has `openrouter` cooling from model A; the selection changes to model B; the next `understand()` tries `openrouter` instead of skipping it as `circuit_open` (RED today). Uses `__providersOverride`-free path or a registry stub; if the service cannot be driven without Electron, test the small pure function that maps a selection to its rung id plus the helper above.
- [ ] **Step 2: Implement.** Service: before `runVisionFallback`, compute the selection key and the selection's rung id (`litellm`, `nvidia_nim`, `openrouter`, `fluxion`, `agentrouter`, `ninerouter`, `deepseek`, `custom`, `curl`), call the helper. Unavailable message for `private_vision`: remove "or enable Codex CLI vision". Comments on `ollama()` and `codex()` say plainly that nothing writes the fields they read, and why no Ollama pre-pass exists.
- [ ] **Step 3: Rebuild, GREEN, commit** `fix(vision): the pre-pass forgets a breaker when the selection changes; Codex is not a local destination`.

### Task 6: Docs, validation, review, landing

- [ ] Design doc: section 3 gains a "Screen pre-pass" note with Evin's two decisions and the measurements; Delivery item 5 gets **5b (built)** and **5c (not built)**: the streaming cURL rung (defect 6), `probeOllama` via `/api/show` (defect 4), the on-the-spot test, a cap on the leading selected rung's attempts.
- [ ] `df -h /`, then typecheck + `npm test` via `$SP/fullsuite.sh`.
- [ ] Fresh review (most capable model), one fix pass with RED→GREEN, re-run the suite.
- [ ] Landing recipe (temp worktree merge, compare trees, compare-and-swap, sync root, dirty set unchanged). Remove the worktree (its `dist-electron` with it). Do not push.
- [ ] Completion report in CLAUDE.md's categories, with rulings and deferred minors.
