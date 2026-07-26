# Implement: Cloud Provider Data Scope → Local Model Fallback

## Context

The **Cloud provider data scopes** UI (in `AIProvidersSettings.tsx`) allows users to disable specific data types from being sent to cloud LLM providers:

- `transcript` — Meeting transcripts
- `screenshots` — Screen captures
- `reference_files` — Uploaded reference documents
- `profile_history` — User profile/history context
- `embeddings` — Vector embeddings for RAG
- `post_call_summary` — Post-call summaries

The UI currently shows: *"When a data type is disabled, Natively falls back to the best available local model to keep that data on-device."*

**This is currently UI-only.** The goal of this task is to wire up the actual backend fallback logic so that when a scope is disabled, the corresponding data is handled by a local provider (Ollama) instead of being dropped or erroring.

---

## Current Architecture (understand before touching anything)

### Data flow for each scope

| Scope | Entry point | Where policy is read |
|---|---|---|
| `transcript` | `IntelligenceManager` LLM calls | `ProcessingHelper` → `LLMHelper` |
| `screenshots` | `generate-what-to-say` IPC → `ScreenUnderstandingService` | `ipcHandlers.ts:2928` |
| `reference_files` | `RAGManager` → `EmbeddingProviderResolver` | `EmbeddingProviderResolver.ts:26,34` |
| `embeddings` | `EmbeddingProviderResolver` | already uses `assertProviderDataScopes` |
| `profile_history` | `PromptAssembler` / `IntelligenceManager` context | not yet gated |
| `post_call_summary` | `MeetingPersistence` post-meeting summary call | `MeetingPersistence.ts:219` |

### Key files

- `electron/llm/ProviderRouter.ts` — `ProviderDataScopePolicy`, `assertProviderDataScopes`, `getDeniedDataScopes`, `routeLLMProviders`. **Currently throws `ProviderScopeError` when a scope is denied — there is NO local fallback path.**
- `electron/rag/EmbeddingProviderResolver.ts` — Already calls `assertProviderDataScopes` for `embeddings` scope; throws on deny.
- `electron/services/SettingsManager.ts` — Stores `providerDataScopes`.
- `electron/ipcHandlers.ts:2928` — Reads `providerDataScopes` for screenshot scope (`allowScreenshots: providerScopes.screenshots !== false`).
- `electron/MeetingPersistence.ts:212-219` — Reads `providerDataScopes` for post-call summary scope.
- `electron/LLMHelper.ts` — The main LLM dispatch class. Contains Ollama integration.

---

## What needs to be implemented

### 1. Add a `localFallback` path to `ProviderRouter.ts`

Instead of throwing `ProviderScopeError` when a scope is denied, `routeLLMProviders` should:
- Mark cloud providers as `unavailable` (reason: `'disabled'`) when their scopes are denied — **this already happens** via `statusFor`.
- Ensure that **Ollama** (local) is always appended to the ordered provider list so it acts as a fallback.
- Add a helper function `hasLocalFallbackAvailable(ollamaModels: string[]): boolean`.

### 2. Wire local fallback in `EmbeddingProviderResolver.ts`

Currently catches nothing — `assertProviderDataScopes` throws and the embedding fails. Instead:
- Catch `ProviderScopeError` for `embeddings` scope.
- If Ollama is available (`ollamaUrl` present and reachable), route embedding generation through Ollama's embedding API (`/api/embeddings`).
- If Ollama is not available, skip embeddings silently (log a warning, return empty/null rather than crashing).

### 3. Wire local fallback in `IntelligenceManager` for `transcript` scope

When the intelligence manager assembles its prompt with transcript context and `transcript` scope is disabled:
- Strip the transcript from the cloud provider payload.
- If Ollama is available, route the entire request to Ollama with the full transcript included.
- If Ollama is not available, route to cloud without transcript (current behavior, but now explicit and logged).

### 4. Wire local fallback for `profile_history` scope

In `PromptAssembler` (or wherever profile/history context is appended to prompts):
- Check `providerDataScopes.profile_history !== false`.
- If disabled and Ollama available → include full profile in Ollama call.
- If disabled and Ollama not available → omit profile from cloud call.

### 5. Wire local fallback in `MeetingPersistence` for `post_call_summary`

Already reads `providerDataScopes` (`MeetingPersistence.ts:219`). Check whether it already routes to local when denied. If not, add the same Ollama fallback.

### 6. Update `screenshots` scope handling in `ipcHandlers.ts`

`ipcHandlers.ts:2940` already reads `allowScreenshots: providerScopes.screenshots !== false`. Verify that when `allowScreenshots` is false and local vision is available, `ScreenUnderstandingService` routes to the local vision model (Ollama with a multimodal model like `llava`). The `localVisionAvailable` flag at line 2942 already exists — confirm it propagates correctly.

### 7. Add `reference_files` scope gate

Search where reference files are chunked and sent to the embedding/chat pipeline. When `reference_files` scope is disabled:
- If Ollama available → process reference files via local embedding.
- If Ollama not available → skip reference file injection into cloud context.

---

## Implementation rules

1. **Do NOT break existing `assertProviderDataScopes` callers.** The function must remain available. Add a sibling `routeWithScopeFallback()` function instead of modifying the existing one.
2. **Ollama availability check**: use `CredentialsManager.getInstance().anyLocalVisionProviderConfigured?.()` for vision, and check for Ollama URL + reachability for text/embeddings.
3. **Never crash on scope denial.** All fallback paths must be try/catch with graceful degradation.
4. **Log every fallback clearly**: `[ScopeFallback] <scope> denied for cloud; routing to Ollama` or `[ScopeFallback] <scope> denied; Ollama unavailable, omitting from context`.
5. **Existing tests must still pass.** Run `node --test 'electron/services/__tests__/ProviderGatewayPolicy.test.mjs'` before and after.

---

## Tests to write

Create `electron/services/__tests__/ScopeLocalFallback.test.mjs`:

```js
// Tests to write:
// 1. When embeddings scope is denied and Ollama is available → EmbeddingProviderResolver uses Ollama
// 2. When embeddings scope is denied and Ollama is unavailable → returns null/empty, no throw
// 3. When transcript scope is denied and Ollama is available → IntelligenceManager routes full context to Ollama
// 4. When transcript scope is denied and Ollama is unavailable → cloud call proceeds without transcript
// 5. routeLLMProviders with denied scope marks all cloud providers disabled but Ollama remains available
// 6. MeetingPersistence post_call_summary falls back to local when scope denied
```

---

## Code review checklist (use code-reviewer agent after implementation)

Run the following review pass after implementing:

- [ ] No `assertProviderDataScopes` calls silently swallowed without logging
- [ ] Every `catch(ProviderScopeError)` block logs the denial reason and the fallback action taken
- [ ] No `any` types added in the fallback paths
- [ ] Ollama availability is checked lazily (not on every call) — cache the result or check CredentialsManager
- [ ] `ScopeLocalFallback.test.mjs` covers all 6 cases above
- [ ] Existing `ProviderGatewayPolicy.test.mjs` still passes
- [ ] No cloud API key is ever sent in a request routed to Ollama

---

## Acceptance criteria

After implementation, toggling off any scope in the UI and triggering the corresponding AI action should:
1. Not throw `ProviderScopeError` to the renderer
2. Log `[ScopeFallback]` in the Electron main process console
3. If Ollama is running: receive an answer from the local model
4. If Ollama is not running: receive an answer from cloud without the gated data type

Run existing tests to verify: `node --test 'electron/services/__tests__/ProviderGatewayPolicy.test.mjs'`
