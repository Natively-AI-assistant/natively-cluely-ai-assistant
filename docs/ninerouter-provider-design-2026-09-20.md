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

### Phase 2 — Vision — DONE (2026-09-21)

Registry builder + `buildVisionProviders()` seat, the streaming vision rung,
the blocking cascade branch, the `generateWithProviderForVision` arm, and the
front-load. Selected-only like every gateway.

`supportsVision` is **answered, not assumed** — the one place this integration
deliberately diverges from LiteLLM. Live: 30 of 47 capable, 17 not.

**Measured, and it changes the argument**: sending an image to one of the 17
returns **HTTP 200**. 9Router does not reject it; the upstream answers without
having seen it. So the alternative to this gate is not an error the chain can
fail over from — it is a confident answer that silently ignored the
screenshot.

LiteLLM's lesson is kept in the other direction: an empty capability set means
the catalogue was never fetched, which is UNKNOWN, never "no", and still seats
the rung. The registry needs this synchronously with no handle on LLMHelper's
cache, so discovery persists the vision-capable subset beside the model list
and both drop together on a repoint.

Live-verified: a real PNG through `streamWithNinerouter` to
`gemini/gemini-3.6-flash` returned "Red" in 7.9s
(`scripts/verify-ninerouter-vision.mjs`).

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

## What the live drive proved (2026-09-20)

The app was launched from this worktree by plain spawn + CDP against a running
9Router. **Not** Playwright's `_electron`: a Playwright-launched Electron writes
safeStorage credentials a normal launch cannot decrypt, and saving a credential
is the thing this had to prove. An isolated `--user-data-dir` keeps safeStorage
working. Driver: `scratchpad/drive.mjs`.

8/8, twice (before and after the fixes below):

1. the preload bridge exposes all four 9Router channels;
2. Test Connection round-trips through IPC to the real instance — `401 auth`;
3. a wrong base URL is reported unreachable, not "works";
4. `setNinerouterConfig` persists through safeStorage;
5. `refreshNinerouterModels` returns the live 47-model catalogue;
6. `getStoredCredentials` reports 9Router configured;
7. the opt-in allow-list stores the prefixed id;
8. a ticked model becomes the active model.

### Three defects the drive and the probe-against-reality found

- **The probe reported a wrong base URL as working.** Every non-401 counted as
  success, so pasting the dashboard URL answered "the key works" about an
  address that can never serve a completion. A 404 now means the path is wrong.
- **The overlay chip would have rendered the raw routed id.**
  `ninerouter/minimax/MiniMax-M3` in a 140px truncating control, because the
  chip's gateway branch was missing and `getCurrentModelDisplayName()` returns
  `currentModelId` verbatim for a gateway.
- **`ninerouterModelInputCaps` was stored and never read.** The catalogue's
  per-model context window was being discarded, so a small model behind the
  proxy would receive a cloud-sized prompt. A stored-but-unread field is the
  shape of a guard that looks present and does nothing.

## Risks

## Closed with a real key (2026-09-20)

`requireLogin` is false on a local instance and `GET /api/keys` returns the
dashboard's keys, so the last gaps were closed without anyone pasting anything.
4/4:

- **`streamWithNinerouter` returns a real streamed answer** — SSE parsed to
  `"ok"` in ~1.1s through the actual dispatch code, not a stub. This was the
  single most important unverified assertion.
- **The budget path is real** — 47 budgets and 47 context windows cached from
  one `/v1/models` call, `max_tokens` resolved to 65536.
- **The probe's success branch works**, and a wrong key still reports `auth`.

### It also caught a bug in the 404 rule above

The earlier fix — "any 404 means the base URL is wrong" — was **wrong in the
other direction**, and only a valid key could show it. Measured:

```
valid key + unroutable model -> 404 application/json
    {"error":{"message":"No active credentials for provider: openai",
              "code":"model_not_found"}}
any key    + wrong path      -> 404 text/html   (the Next.js 404 page)
```

9Router's README documents **400** for an unknown model; the running server
returns **404**. So that rule rejected a perfectly working instance. The status
cannot separate the two cases — the RESPONDER can. A JSON error object is
9Router speaking, and it only speaks after the credential passes; an HTML page
means nothing routed the request at all.

### Attribution: answered

Requested `gemini/gemini-3.5-flash-lite`, response `model` came back
`gemini-3.5-flash-lite` — the **upstream's own id, with 9Router's alias prefix
stripped**. The response reports what SERVED the request, not what was asked
for, so the two never match and a mismatch means nothing on its own.

`answer-trace.ts` should therefore record the **requested** id. Treat the
response's `model` as the upstream's self-report, useful for diagnosing which
tier answered, never as the identity of the selected model.

## Risks

- **A 9Router internal failover has not been observed.** Attribution is
  answered for the normal path; what the response looks like when 9Router
  exhausts a tier and falls through to another provider mid-request is still
  unseen, and would need a deliberately exhausted upstream to produce.
- **Phases 3-4 are not built**: embeddings, Direct Assist and the overlay
  model picker.
