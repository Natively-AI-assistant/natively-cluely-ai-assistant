# Fast Model picker — design

**Date:** 2026-09-23
**Status:** design approved, not yet planned or implemented
**Branch:** `feat/fast-model-picker`

---

## Intent

Add a **Fast Model** picker beside Active Model in Settings, and use the picked model for the
app's cheap internal LLM calls — the ones the user never reads.

Today those calls have no user control: the Auto Answer judge runs a hardcoded per-provider
ladder, `generateQueryRewrite` hand-rolls its own three-rung chain, and
`generateContentStructured`'s `preferFast` flag is vestigial. A user who knows their setup is
fastest on a particular small model has no way to say so.

**Success looks like:** a user picks a fast model; Auto Answer's judge, the query rewrite and
browser-metadata classification all use it; if they pick nothing, behaviour is byte-identical to
today.

### Explicitly decided during design

- **Fast-path only, not a fallback.** Retry-after-failure wants a *different provider* (another
  OpenAI model does not help when OpenAI is down); the fast path wants a *small cheap* model.
  These are different goals, so this setting serves only the fast path. The existing provider
  ladders keep owning outage resilience.
- **Invisible calls only.** Judge, query rewrite, browser-metadata classification. Not meeting
  titles, summaries, or general structured extraction — those are text the user reads or that
  grounds answers, where a weak model degrades output in a way that is hard to attribute back
  to this setting.
- **List everything, warn on a slow pick.** The dropdown offers the same models as Active Model.
  A hand-maintained "fast tiers only" allow-list would go stale (this repo has been burned by
  model retirements) and would hide good new options. Instead an inline hint fires when the pick
  is not a known-fast tier — the same pattern used for the Fast Response Mode hint.

### Not in scope

- **Fast Response Mode is a different feature and is not touched.** It routes the user's *answer
  stream* to Codex CLI or Groq (`LLMHelper.ts` `fastModeApplies`). It is not an internal-call
  setting and must not be merged with this one.
- Retry and fallback ladders, meeting titles/summaries, general extraction quality paths.
- Per-provider fast models; a latency "Test" button. Both are addable later without rework.

### Dependency

The judge ladder this design falls back to is the per-provider ladder from PR #597
(Gemini flash-lite → Groq → `OPENAI_JUDGE_MODEL` → DeepSeek → Claude). **That work must land
first.** If it does not, the judge's fallback is the pre-597 behaviour (fall through to
`generateContentStructured`, which runs on the user's chat model) and the fast rung becomes the
only fast path rather than an override of a measured one.

---

## Storage

`fastModel?: string` on CredentialsManager's credentials record, mirroring `defaultModel`.

CredentialsManager is where Active Model already lives. It is an odd home for a non-secret, but
following the existing pattern beats inventing a second one for a sibling setting.

```ts
/** The user's chosen fast model, or null when unset. Null MUST mean "use the measured ladder". */
public getFastModel(): string | null

/** @returns false when the write was refused (degraded store). */
public setFastModel(model: string | null): boolean
```

`getFastModel()` returns **null when unset — never a default**. Unset is a first-class state
meaning "behave exactly as before". `setFastModel` returns a boolean per the settings-persistence
contract (a refused write must never be reported as success).

IPC mirrors the existing default-model channels, and the handler must propagate the boolean
rather than discarding it.

---

## The seam

One private method on `LLMHelper` owns "what is the fast model, and how do I call it once".

```ts
private async callFastModel(
  message: string,
  opts: { signal?: AbortSignal; timeoutMs?: number; json?: boolean },
): Promise<string | null>
```

**Contract**

| Situation | Result |
|---|---|
| No fast model configured | `null` |
| Its provider client is not initialised | `null` |
| Its provider family is disabled (`isProviderDisabled`) | `null` |
| `isLocalOnlyMode` and the pick is a cloud model | `null` |
| The call fails | `null` (caller falls through) |
| `opts.signal` aborts | **throws** |

`null` means "not available — use your existing path". Only abort throws, so a caller can tell a
missing setting from a user cancellation. That distinction matters for the judge, whose deadline
and supersede must propagate rather than be swallowed as a fallthrough.

**Per-provider dispatch** reuses the existing classifiers (`isGroqModel`, `isOpenAiModel`,
`isClaudeModel`, `isDeepseekModel`, `isOpenRouterModel`, `isGeminiModel`, …). Each branch does
what every other call in this file does, in this order:

1. `assertOutboundScopes(family, message)`
2. `await this.rateLimiters[family].acquire()` where a limiter exists for that family
   (keys today: `groq`, `gemini`, `openai`, `claude`, `deepseek`, `litellm`, `nvidia_nim`,
   `openrouter`). A family with no limiter skips this step rather than throwing.
3. one non-streaming request, passing `signal` and JSON response format when `opts.json`
4. `stripLeadingReasoningBlock` on the result

An unrecognised model id returns `null` rather than guessing a provider.

---

## Consumers

**1. `generateJudgeVerdict`** — the fast model becomes rung 0. On `null` or failure, PR #597's
measured ladder runs unchanged beneath it.

**2. `generateQueryRewrite`** — refactored *onto* the seam. It already hand-rolls this exact
shape (one rung, abort at a deadline, per-provider dispatch), so this removes duplication rather
than adding any. Its current Gemini → Groq → Natively chain becomes the fallback when the seam
returns `null`.

**3. `generateContentStructured({ preferFast: true })`** — a fast rung 0 on the `preferFast` path
only. This single change covers both `BrowserMetadataClassifierService` and `main.ts`'s
`preferFast` call site, leaving the service's port interface untouched.

It also repairs something: `preferFast` is currently vestigial — the code says *"retained for API
compatibility; ordering no longer depends on it"* over a `void opts`. This gives the flag meaning
again.

> This is a rung placed **before** the cascade on an opt-in flag. It is not a model override
> forced *through* the cascade — that shape was considered and rejected, because
> `generateContentStructured` is a multi-provider resilience ladder and the judge specifically
> wants the fast model ahead of any ladder.

---

## UI

A picker directly beneath Active Model in `AIProvidersSettings.tsx`, populated from the same
options array Active Model already builds, plus an "Auto" entry that is the default and means
"use the measured ladder".

**"Known-fast tier" is an advisory list, not a filter.** A small set of id prefixes the app
believes are small tiers — `gemini-*-flash-lite`, `gemini-*-flash`, `gpt-5.*-mini`,
`gpt-5.*-nano`, `gpt-5.5`, `deepseek-*-flash`, and any Groq model. Because it only drives a hint
and never blocks a choice, a stale entry costs a missing or spurious hint and nothing more. That
is the whole reason it is a hint rather than a filter.

When the pick is not on that list, an inline hint appears using the existing `aip-warn-fg`
class:

> Large models make Auto Answer slower. Pick a small tier for the best results.

The hint is advisory only — it never blocks the selection. Rationale: the footgun is real (a big
pick silently re-creates the latency problem #597 fixed) but a hard filter would need a
hand-maintained list that goes stale.

---

## Error handling

- **Unset / unavailable / disabled** → `null` → the caller's existing path. No user-visible change.
- **Fast call fails** → swallowed, falls to the existing ladder, exactly like any other rung.
- **Abort** → rethrown. The judge's deadline and supersede signals must propagate.
- A failure in the fast rung must never be able to prevent the ladder beneath it from answering.

---

## Telemetry

Add a `fast_model` route value to the judge telemetry #597 introduced, so it is measurable
whether a user's pick is actually being used and whether it helps. Without this the feature ships
unmeasurable and a bad pick is invisible in the data.

Telemetry carries the route and timing only — never transcript text, consistent with the existing
judge events.

---

## Testing

**`callFastModel`**
- returns `null` when unset, when the provider client is missing, and when the family is disabled
- dispatches to the correct client for each supported model-id shape
- returns `null` for an unrecognised model id
- rethrows on abort; returns `null` on provider failure
- calls `assertOutboundScopes` and acquires the rate limiter before the request

**Judge**
- with a fast model set, rung 0 is used
- when rung 0 fails, #597's ladder still produces a verdict
- **when unset, the call sequence is byte-identical to today** — this is the regression guard

**`preferFast`**
- a source-assertion that `preferFast: true` reaches the fast rung, so it cannot silently go
  vestigial again the way it already did once

**Settings**
- `setFastModel` returns `false` on a refused write, and the IPC handler reports that rather than
  success

**Cross-platform** (per CLAUDE.md): this change introduces no `process.platform` branch. It is
provider-routing logic plus a renderer picker, both platform-neutral. Validation categories:
`Covered by automated tests`, `Reviewed but not executed on Windows`. No native module, path,
packaging, or capture surface is touched.

---

## Files expected to change

| File | Change |
|---|---|
| `electron/services/CredentialsManager.ts` | `fastModel` field, `getFastModel`, `setFastModel` |
| `electron/LLMHelper.ts` | `callFastModel` seam; rung 0 in judge, rewrite, preferFast |
| `electron/ipcHandlers.ts` | get/set channels, propagating the boolean |
| `electron/intelligence/autoAnswer/AutoAnswerTypes.ts` | `fast_model` telemetry route value |
| `src/components/settings/AIProvidersSettings.tsx` | picker + inline hint |
| tests | as listed above |
