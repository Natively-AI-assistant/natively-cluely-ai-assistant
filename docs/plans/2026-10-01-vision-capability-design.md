# Vision capability: use every model that can read images

Design, 2026-10-01. Agreed with Evin section by section (brainstorming session).
Status: designed, not yet built.

## The problem

Natively decides whether a model can receive a screenshot mostly from a
hand-written list of model-name prefixes (`getModelCapabilities().supportsImages`
in `electron/llm/modelCapabilities.ts`). Anything not on the list is treated as
text-only. Every new model family is therefore blocked until someone edits code,
and several providers already publish the answer that Natively ignores.

### Evidence (measured 2026-09-30)

| Source | Models that accept images | Natively says text-only |
|---|---|---|
| OpenRouter catalogue (`architecture.input_modalities`, 464 models) | 296 | **142**, of which: Qwen 20, Mistral 15, OpenAI 11, Google 9, xAI 8, Z.ai 6, Meta 6 |
| The same models judged by bare name (direct-provider judgement) | | **85** (Grok 4.x, Qwen 3.x, GLM 5.3 Flash, DeepSeek V4.1 Flash, Kimi K3, …) |
| OpenAI key's model list | | 19, incl. **o1, o1-pro, o3, o4-mini, gpt-4-turbo** (vision per OpenAI) |
| Gemini key's model list | | 0 Gemini; Gemma 4 marked text-only |
| Direct DeepSeek, live | `deepseek-flash` read the test screenshot correctly | Excluded from screenshots entirely |

False "reads images" answers: **0**. The list only errs toward blocking.

Real-app reproduction (AgentRouter-only profile, before the 2026-09-30 fix): a
screenshot on the default `agentrouter/deepseek-v4-flash` and on `gpt-6-astra`
failed in under 80 ms with "all vision models are unavailable … check your API
keys (OpenAI, Claude, Gemini, or Groq)", while both models read the same image
when it was sent to them.

**The constraint that shapes the design:** some models answer HTTP 200 without
seeing the image. `deepseek-v4-pro` replied "images aren't supported in this
chat" as a normal answer, and 9Router upstreams do the same (see its provider
notes). "Try it and fall back on error" therefore returns blind answers. The
capability must be known before a screenshot is sent.

### Related defects (code review, 2026-10-01; read-only review, each to be reproduced with a failing test first)

1. Code Hint (`CodeHintLLM.ts`) refuses a screenshot when the *selected* model
   is text-only, although the chat path answers the same screenshot through any
   configured vision provider.
2. `getCapabilities()` classifies `getCurrentModel()`, a display string (custom
   provider name, cURL UUID, `codex-cli:…`), and ignores the answers LLMHelper
   already holds (`customProviderSupportsVision`, `ollamaVisionCache`,
   9Router's catalogue).
3. A second, drifted copy of the Ollama vision-name regex lives in
   `modelCapabilities.ts`; neither copy matches `qwen2.5vl`, `llama4`, `qwen3-vl`,
   `mistral-small3.1`, `granite3.2-vision`.
4. `probeOllama(needsVision)` uses the name regex on the active model only,
   ignoring `/api/show` and other installed vision models, so "Keep screenshots
   on this device" refuses valid local vision.
5. OpenAI gaps: o1/o3/o4-mini, chatgpt-4o-latest, gpt-4-turbo, gpt-4.5 are text-only; bare `o1`/`o3` are
   not even treated as cloud; `models/gemini-*` is cloud but not vision.
6. The streaming vision chain has no rung for a selected cURL provider.
7. The screen-reading registry (`VisionProviderRegistry.ts`) decides Ollama by
   name only, hard-codes Codex to no vision, and has no Antigravity rung.
8. The registry never moves the user's selected model to the front (so a
   selected local model can be bypassed for the cloud).
9. The registry's OpenAI rung claims `gpt-4o` but `generateWithOpenai` uses the
   selected OpenAI model, which may be text-only.
10. The streaming chain front-loads gateways, Codex and local picks but not a
    selected *direct* model (Claude, Gemini, Natively), so OpenAI (priority 0)
    wins another vendor's turn.

## Decisions (Evin)

1. **Routing:** the selected model first when it reads images, then fall back.
2. **New models:** ask the provider first, then a one-time image test; the name
   list only as a last resort.
3. **Test timing:** in the background when the model is selected.
4. **Override:** Auto / On / Off per model.

## 1. One resolver

Every consumer asks one synchronous function: the streaming vision chain, the
screen-reading registry, Code Hint, Direct Assist, `getCapabilities`, the
performance capability view, and the gateway seats (AgentRouter, 9Router).

It answers **yes / no / unknown** plus the source (`override`, `provider`,
`test`, `names`), and it combines two separate questions, both of which must be
yes:

- **Can this route carry an image?** A static property of Natively's adapter per
  provider. Direct DeepSeek's adapter drops images today, so this work adds image
  parts to it (Flash only).
- **Does this model read images?** First answer wins:
  1. user override;
  2. provider data;
  3. one-time test result;
  4. name list (today's table, consolidated: one Ollama list, OpenAI o-series,
     `chatgpt-4o-latest`, `gpt-4-turbo`, `models/gemini-*`, and the 2026-09-30
     AgentRouter DeepSeek and gpt-6 entries folded in);
  5. otherwise unknown.

Answers live in a persisted cache (as 9Router's vision list is persisted today),
keyed by provider + wire model, plus base URL for self-hosted endpoints
(LiteLLM, Ollama, custom, 9Router). Catalogue fetches and tests write to the
cache asynchronously; nothing on the answer path waits on them.

**Unknown when a screenshot arrives:** another vision provider answers if one is
configured. If nothing else can, the test runs inline and the screenshot is sent
only if it passes. A screenshot is never sent blind.

## 2. Provider data and the one-time test

| Provider | Field | Status |
|---|---|---|
| OpenRouter | `architecture.input_modalities` includes `image` | Verified 2026-09-30 |
| 9Router | `capabilities.vision` | In use |
| Ollama | `/api/show` → `capabilities` includes `vision` | In use (streaming chain only) |
| Gemini | Family rule: every Gemini model takes images | Verified 2026-09-30 by name only (44/44 Gemini ids on the key), not a published field |
| Anthropic | Models API `capabilities` | **Unconfirmed**: no key available; name list covers Claude meanwhile |
| LiteLLM | `/model/info` → `supports_vision` | **Unconfirmed**: check during the build |
| OpenAI, DeepSeek, AgentRouter, Fluxion, Groq, NVIDIA | none | One-time test |

The one-time test:

- Runs through the **production adapter** for that provider, never a raw client,
  so a pass means a real screenshot will work.
- Draws a **random 4-digit number** into a small generated image, asks naturally
  ("What number is shown in this image?"), and passes only if the answer
  contains it. A 200 without the number is **no**. The question must read like
  real use: AgentRouter's content filter rejects canned probe text.
- Transient failures leave the model **unknown** and retry later with backoff:
  402 (empty daily pool), 429, 5xx, timeouts, `content-blocked`, network errors.
  They never mark a model "no".
- Once per model: concurrent attempts are merged; nothing re-runs on boot, key
  save or catalogue refresh. Re-test after 30 days, or after a real screenshot
  on that model is rejected as image-unsupported.
- Only the model the user selects, never a whole catalogue.
- Respects local-only mode, switched-off providers and the screenshots outbound
  scope: no cloud test when screenshots may not leave the device.

## 3. Routing: the selected model first, one ordering for both paths

The streaming chain (`streamVisionWithFallback`) and the screen-reading chain
(`VisionProviderRegistry` / `VisionProviderFallbackChain`) share one ordering
function:

1. the selected model, if the resolver says yes, whatever its provider (direct
   OpenAI/Claude/Gemini/DeepSeek, gateways, Codex, Antigravity, Ollama, custom,
   cURL);
2. then the fallbacks, health/speed sorted as today.

- Direct providers read screenshots with the selected model; each vendor's fixed
  vision model remains a fallback only, and a fallback always uses a model known
  to read images (fixes defect 9).
- A selected local model leads; the cloud follows only if it fails and privacy
  settings allow.
- Gaps closed: cURL rung (6), Codex and Antigravity in the registry (7), the
  local-only check reads `/api/show` and any installed vision model (4).
- Code Hint asks "will anything configured read this screenshot", using the same
  ordering (1).
- When nothing can read the screenshot, the message says which of these
  applies: the model can't read images (pick one that can), no vision provider
  is set up, or the privacy setting keeps screenshots on this device and no
  local vision model is installed.

## 4. Override and visibility

In Settings › AI Providers, each model row gets **Reads images: Auto / On / Off**.

- **Auto** (default) shows the source: "Yes · from OpenRouter", "Yes · tested",
  "No · tested", "Checking…", "Unknown · will test when selected".
- **On** forces yes; **Off** forces no and also stops the background test for
  that model.
- Per model **and** provider (`claude-opus-5` on AgentRouter vs on Claude are
  separate).
- **On** beats the test but not the route check: it cannot enable images on a
  route whose adapter cannot carry them (the control is disabled, with the reason).
- The overlay model picker shows an image marker next to models that read
  images. No other UI changes.

## 5. Testing

- Each review defect is reproduced with a failing test first, executing the
  real routing (as the AgentRouter dispatch tests do), not source greps.
- Resolver: precedence, the three states, keying, 30-day re-test.
- Test image, against a local replay server: pass needs the number; a 200
  "images aren't supported" is no; 402/429/5xx/timeout/content-blocked stay
  unknown; concurrent attempts merge; nothing is sent in local-only mode, for a
  disabled provider, or when the screenshots scope is denied.
- Provider data from saved real catalogue samples (OpenRouter, 9Router, Ollama
  `/api/show`).
- Routing: shared ordering in both chains; selected first per provider kind;
  fallback on failure; local first; Code Hint consistent with the chat path.
- Live in the real app after each phase: an OpenRouter vision model, direct
  DeepSeek Flash, the AgentRouter models. OpenAI o-series cannot be tested live
  (the OpenAI key has no credits); Ollama is not running on this machine.
- Cross-platform: no OS-specific code is involved; still requires physical
  Windows verification before release.

## Delivery: five phases, each landable on its own

1. **Resolver and consolidated name list**, all phase-1 consumers moved onto
   it, proven unchanged by a characterization test over ~2,400 real ids.
   Fixes defects 1, 2, 3, 5. The persisted cache moves to phase 2, with its
   first new writer (OpenRouter modalities); phase 1 reads Ollama's and
   9Router's answers where they are held today.
2. **Provider data**: OpenRouter, 9Router, Ollama, Gemini family; Anthropic and
   LiteLLM once confirmed.
3. **One-time test** plus image support in the direct DeepSeek adapter (Flash).
4. **Auto / On / Off override** plus the picker marker.
5. **Selected model first in both chains**, the cURL / Codex / Antigravity rungs,
   the local-only fix and the clearer messages. Fixes defects 4, 6, 7, 8, 9, 10.

## Out of scope

- Other modalities (audio, PDF input).
- Choosing *which* vision model is best for a screenshot beyond "selected first,
  then health order".
- Removing the name list: it stays as the last-resort source for offline starts
  and providers that publish nothing.
