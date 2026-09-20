# 9Router provider integration — design

Date: 2026-09-20
Branch: `feat/ninerouter-provider`
Status: approved in chat; Phase 1 in progress

## What 9Router is

[9Router](https://github.com/decolua/9router) (MIT, `decolua/9router`) is a
self-hosted fallback proxy. It fronts 40+ upstream providers behind one
OpenAI-compatible surface and fails over between them internally — subscription
tier, then cheap tier, then free tier.

There is **no hosted 9Router API**. The user runs it themselves
(`npm i -g 9router`, Docker, or from source), default port 20128, optionally
exposed through a Cloudflare tunnel. That makes its integration shape
**LiteLLM's, not OpenRouter's**: a user-supplied base URL, not a vendor key
against a fixed host.

### Verified endpoint surface

Confirmed live against a running instance on 2026-09-20.

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/health` | none | `{"ok":true}` |
| GET | `/v1/models` | **none** | chat/LLM list, carries capabilities |
| GET | `/v1/models/<kind>` | **none** | `embedding`, `image-to-text`, `stt`, `tts`, `image`, `web` |
| GET | `/v1/models/info?id=…` | **none** | per-model metadata |
| POST | `/v1/chat/completions` | **required** | OpenAI format, SSE streaming |
| POST | `/v1/messages` | **required** | Anthropic format |
| POST | `/v1/embeddings` | **required** | OpenAI shape |
| POST | `/v1/messages/count_tokens` | **none** | answers 200 unauthenticated |

No rerank endpoint exists.

### Live catalogue on the reference instance

47 chat models across 6 aliases — `cx` (14), `nvidia` (8), `alicode` (8),
`minimax` (6), `gemini` (6), `cc` (5). **30 of 47 report
`capabilities.vision === true`.** 6 embedding models, 4 STT, 13 TTS, 7 image.

`/v1/models` entries carry, per model:

```json
{ "id": "gemini/gemini-3.6-flash", "object": "model", "owned_by": "gemini",
  "capabilities": { "vision": true, "reasoning": true, "tools": true,
                    "contextWindow": 1048576, "maxOutput": 512000, … },
  "context_length": 1048576, "max_completion_tokens": 512000 }
```

Capability defaults come from `open-sse/providers/capabilities.js`
(`contextWindow` 200000, `maxOutput` 64000, `tools` true, rest false).

## Three facts that make this more than a LiteLLM clone

### 1. Auth is split by HTTP verb — the probe must be a POST

Every `GET` on the reference instance answers without a key; every `POST`
returns `{"error":{"message":"Missing API key","type":"authentication_error"}}`.
A bogus key on a POST returns a distinguishable `"Invalid API key"`.

Fluxion's Test Connection is `GET /v1/models`
(`FluxionProvider2026_09_18.test.mjs:410-440`). Copying that here produces a
**false green**: the test passes with an empty key on a config that cannot
answer a single question. This is the failure shape recorded in
`elevenlabs-probe-false-green-2026-09-09`.

**Probe design:** `POST /v1/chat/completions` with a deliberately invalid model
id. Auth is evaluated before model validation — proven, since a POST of `{}`
with no `model` at all returns 401 rather than a validation error. Therefore:

- `401` → key missing or invalid
- `400` → key valid (request reached model validation)
- anything else → surface verbatim

This spends zero upstream provider quota. `/v1/messages/count_tokens` is **not**
usable as a probe: it answers 200 unauthenticated.

> Open: the exact `400` body for an invalid model is unconfirmed — it needs one
> live call with a real key. Treat "not 401" as key-valid until confirmed.

### 2. `/v1/models` already carries capabilities

LiteLLM needs a second `/model/info` round-trip for token budgets
(`LLMHelper.ts:1505-1574`) and still assumes `supportsVision: true` for all
gateway models (`LLMHelper.ts:11533-11541`).

9Router returns budgets **and** per-model vision in the single `/v1/models`
call. So:

- the model-budget map is fed from one fetch, not two;
- the vision seat is gated on that model's own `capabilities.vision` instead of
  a blanket `true`. 17 of the 47 live models are text-only; assuming vision
  would route screenshots into models that cannot read them.

### 3. Vendor-namespaced ids collide with vendor catch-alls

Ids are `{alias}/{model}` — `openai/gpt-5`, `cc/claude-opus-5`,
`gemini/gemini-3.6-flash`. This is the collision that
`OpenRouterProvider2026_09_17.test.mjs:66-113` and
`FluxionProvider2026_09_18.test.mjs:96-238` exist to pin.

Consequences:

- the `ninerouter/` prefix must be classified **above** every vendor predicate
  in `providerFamily` (`ipcHandlers.ts:347-384`), `modelAvailable`
  (`:386-440`), the direct-assist classifier (`LLMHelper.ts:11307-11327`) and
  `isOpenAiModel`;
- the **wire** strips one segment, the **capability lookup** strips two
  (`ninerouter/gemini/gemini-3.6-flash` → `gemini-3.6-flash`);
- `ROUTING_PREFIX_RE` (`modelCapabilities.ts:69`) must name it or every
  capability lookup silently misses.

## Decision: the internal id is `ninerouter`

`9router` is not a legal JavaScript identifier. `{ 9router: … }` is a syntax
error, `creds.9routerPreferredModel` does not parse, and `CredentialsManager`
builds its preferred-model key by interpolation
(`` `${provider}PreferredModel` ``, `CredentialsManager.ts:1769-1780`). Every
touched file would need quoted-key access and the first dot-notation access
written by anyone later is a parse error.

**Internal id: `ninerouter`.** Model prefix `ninerouter/`. Family
`ninerouter`. Credential fields `ninerouterBaseURL`, `ninerouterApiKey`,
`ninerouterMaxTokens`, `ninerouterPreferredModel`, `ninerouterModels`.

**Display name: "9Router"** in every user-visible string. Precedent:
`nvidia_nim` / "NVIDIA NIM".

## Placement

Settings tab **Local & Gateways** (`AIProvidersSettings.tsx:1799-1803`, panel
`:4598-4865`), as a sibling card to LiteLLM — because it is a user-supplied
base URL, the same shape as LiteLLM and Ollama. OpenRouter, Fluxion and NIM sit
in the Cloud tab because they are hosted keys; 9Router is not.

Consequences of being a user endpoint:

- added to `isUsingUserEndpoint()` (`LLMHelper.ts:10928-10934`), which routes it
  to the adaptive `userEndpointBudgetMs(observed)` deadline rather than a fixed
  one, and classifies its route type as `'user_endpoint'`;
- added to `answerLatencyKey()` (`LLMHelper.ts:647-661`) so latency is tracked
  per model rather than per provider;
- **opt-in allow-list**, like LiteLLM: empty selection means *no* models, not
  all. This requires `modelUtils.ts:222` **and** `ipcHandlers.ts:408` changed
  together — `OptInModelAllowList2026_08_06.test.mjs:77` is a drift guard that
  pins them to each other.

Presence gate is the **base URL**, not the key (`modelAvailable`,
`ipcHandlers.ts:418`), matching LiteLLM — a 9Router instance with
`REQUIRE_API_KEY=false` is legitimately keyless.

## Phases

### Phase 1 — Chat (this change)

- `CredentialsManager`: `StoredCredentials` fields, accessors,
  `setNinerouterConfig()`, `PreferredModelProvider` union member.
- `RateLimiter.ts:110-130`: a `ninerouter` bucket at `(120, 2.0)`. Without it
  `rateLimiters.ninerouter.acquire()` throws.
- `modelCapabilities.ts:69`: `ROUTING_PREFIX_RE`.
- `LLMHelper`: client field + disabled-aware getter, `setNinerouterConfig`,
  `isNinerouterModel`, model-budget map fed from `/v1/models`,
  `generateWithNinerouter`, `streamWithNinerouter`, the text rung in
  `_streamChatInner` ordered above the vendor branches,
  `PROVIDER_LABEL_FAMILY`, `answerLatencyKey`, `isUsingUserEndpoint`.
- `ipcHandlers`: `providerFamily`, `modelAvailable`, opt-in family,
  `set-ninerouter-config` + model discovery/refresh channels,
  `get-stored-credentials` payload, `set-provider-preferred-model` union.
- `ProcessingHelper.ts:117-121`: boot-time config load, or the client is never
  constructed at startup.
- `preload.ts` + `src/types/electron.d.ts`: impls, types, unions.
- `AIProvidersSettings.tsx`: the card, state, handlers, `effectiveModels`,
  active-model options. `aiProviderMarks.ts`: brand + mark.
- Tests (see below).

### Phase 2 — Vision

`VisionProviderRegistry` builder + `buildVisionProviders()` seat, selected-only
like every gateway (`isConfigured: !!baseURL && isSelected`), plus the
front-load at `LLMHelper.ts:6812` and the streaming vision rung at `:6718`.
Gated on per-model `capabilities.vision` rather than assumed true.

### Phase 3 — Embeddings

LiteLLM has **no** first-class embedding provider — it rides the generic custom
embedding URL (`EmbeddingProviderResolver.ts:60-68`). 9Router gets a real one,
because `/v1/models/embedding` gives a discoverable model list the generic path
cannot offer. Also `embeddingStatus.ts:105` `THIRD_PARTY_GENERATION`.

### Phase 4 — Direct Assist, overlay picker, contract tests

`DIRECT_ASSIST_PROVIDERS`, the classify/configured/vision-support/capability-
strip/dispatch arms, and `ModelSelectorWindow.tsx:212-222`.

## Testing

Modelled on `FluxionDispatchExecutes2026_09_18.test.mjs:103-165`, which
**executes** the cascade, not `FluxionProvider2026_09_18.test.mjs`, which greps
source. The Fluxion campaign's own record is that 27 source-grep tests passed
while a dispatch arm was missing and Gemini silently answered the question
(`fluxion-provider-2026-09-18`). `DIRECT_ASSIST_PROVIDERS` has no exhaustiveness
test, so a missing arm fails silently by default.

Phase 1 assertions:

1. A selected `ninerouter/…` model reaches `streamWithNinerouter` — and is not
   answered by Gemini on the user's own key.
2. A 9Router-only profile is not told "No AI provider configured".
3. No base URL → no vendor fall-through.
4. A disabled provider is never dispatched.
5. `ninerouter/openai/gpt-5` classifies as `ninerouter`, never as `openai`, in
   `providerFamily`, `modelAvailable`, `isOpenAiModel` and the direct-assist
   classifier.
6. Wire strip is one segment; capability strip is two.
7. `ROUTING_PREFIX_RE` names `ninerouter`.
8. Empty allow-list means no models (opt-in), and the two halves agree.
9. Test Connection rejects a keyless config — the false-green guard.
10. Budgets parse from `/v1/models`; malformed and empty responses degrade to
    defaults rather than throwing.

## Cross-platform

HTTP-only against a user-supplied base URL. **No process management** — 9Router
is a server the user runs; nothing here spawns, detects or kills a binary, so
no executable-extension, path-separator or signal-vs-taskkill divergence
arises. The change is platform-neutral by construction, and should stay that
way: adding auto-launch later would pull the whole cross-platform contract in.

Default base URL `http://localhost:20128/v1` is a literal string, not a
filesystem path.

## Risks

- **No live dispatch verification.** Verification was deferred pending an API
  key. `/v1/models`, the capability payload and the discovery path are
  verifiable unauthenticated and will be. Streaming SSE, the dispatch cascade
  and the probe's `400` body are not, and are marked
  `Requires live verification` until a key is available.
- **Fallback attribution is unresolved.** 9Router fails over internally, so the
  model that serves a request may not be the one requested. Whether the
  response's `model` field reports requested or served is unknown without a
  key. It decides what `answer-trace.ts` records. Until then, record the
  requested id and treat the response's `model` as advisory.
