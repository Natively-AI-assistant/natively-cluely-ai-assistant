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
   **Void (found in phase 5c-2):** that lane cannot be selected from the UI;
   saved cURL providers run as custom providers, which have a rung.
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
  provider. Direct DeepSeek's adapter dropped images until phase 3b; it now
  attaches them (OpenAI `image_url` parts, measured live). Which DeepSeek model
  may be sent one is the second question: Flash is known to read images, and
  any other DeepSeek model is tested once first, because V4 Pro answers HTTP
  200 without seeing the image.
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
| OpenRouter | `architecture.input_modalities` includes `image` | In use since phase 2, trusted both ways (OpenRouter refuses images to models it lists as text-only) |
| 9Router | `capabilities.vision` | In use (catalogue kept with the 9Router credentials, not in the capability store) |
| Ollama | `/api/show` → `capabilities` includes `vision` | In use, in memory per session; saved, and used by the screen-reading path and private-vision check, in phase 5 |
| Gemini | Family rule: every Gemini model takes images | Verified 2026-09-30 by name only (44/44 Gemini ids on the key), not a published field |
| Anthropic | Models API `capabilities` | Not needed: the name list covers every Claude model |
| LiteLLM | `/model/info` → `model_info.supports_vision` | Confirmed in LiteLLM's docs (admin-set per model). Only `true` is trusted: absence and `false` also mean "not set". Used from phase 3, where it lets the test skip a model |
| OpenAI, DeepSeek, AgentRouter, Fluxion, Groq, NVIDIA | none | One-time test |

The one-time test:

- Runs through the **production adapter** for that provider, never a raw client,
  so a pass means a real screenshot will work.
- Draws a **random 4-digit number** into a small generated image, asks naturally
  ("What number is shown in this image?"), and passes only if the answer
  contains it. A 200 without the number is **no**, but only after a second
  miss with a different number (built in phase 3a: one misread must not block
  a capable model for a month). The question must read like real use:
  AgentRouter's content filter rejects canned probe text.
- The image uses digits from the repo's Inter Bold, embedded as bitmaps and
  composed in pure Node. Measured: a 5x7 block font was misread by GPT-4o mini
  and Claude Haiku 4.5; Inter Bold was read 28 times out of 28 across seven
  model families, plus Gemini.
- Transient failures leave the model **unknown** and retry later with backoff:
  402 (empty daily pool), 429, 5xx, timeouts, `content-blocked`, network errors.
  They never mark a model "no".
- Once per model: concurrent attempts are merged; nothing re-runs on boot, key
  save or catalogue refresh. Re-test after 30 days, or after a real screenshot
  on that model is rejected as image-unsupported.
- Only the model the user selects, never a whole catalogue.
- Respects switched-off providers, private-vision mode and the screenshots
  outbound scope: no cloud test when screenshots may not leave the device. It
  goes through Direct Assist's own boundary, so those gates are the real ones.
  (Local-only mode is nominal app-wide: the flag has no production setter.)
- Tested providers: OpenAI, Claude, Gemini, NVIDIA NIM, OpenRouter, Fluxion,
  AgentRouter, LiteLLM, 9Router. Not tested: providers decided by their route,
  Groq (its own table), Ollama (`/api/show`), custom/cURL (their template).

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
   9Router's answers where they are held today. Known gap left open: with
   Code Hint's gate removed, a SELECTED LiteLLM / NVIDIA NIM / OpenRouter /
   Fluxion model gets Code Hint screenshots whatever its upstream reads,
   exactly as Ask AI already did. Phase 2 closed it for OpenRouter; phase 3a
   closes it for any LiteLLM, NVIDIA NIM or Fluxion model once its one-time
   test has run (an untested one behaves as before until then).
2. **Provider data**: the saved capability store (`userData/vision-capabilities.json`)
   and OpenRouter's catalogue, fetched in the background when an OpenRouter
   model is selected and on Settings' Refresh. A model OpenRouter lists as
   text-only no longer gets screenshots on either path or in Direct Assist.
   9Router and Ollama were already wired in phase 1; Gemini and Claude are
   covered by the name list.
3. **One-time test** (phase 3a, built): the engine, saved results, a background
   test when an unknown model is selected, seats and Direct Assist following a
   result, a re-test when a real screenshot is refused, and LiteLLM's
   `supports_vision: true`. An image refusal is no longer mistaken for a
   retired model. **Phase 3b** (built): the direct DeepSeek adapter attaches
   images; a selected DeepSeek Flash reads its own screenshots in the chat path
   and Direct Assist. The screen-reading path gets its DeepSeek rung in phase 5.
4. **Auto / On / Off override** plus the picker marker.
5. **Selected model first in both chains.** Built before phase 4 (Evin,
   2026-10-01: phase 4 is Settings UI and needs the dev app; this is
   main-process routing). In two parts.

   **Phase 5a** (built), the chat screenshot path (`streamVisionWithFallback`):
   - One ordering rule, `orderVisionCandidates` (`electron/llm/visionOrdering.ts`,
     pure): the selection's own rung leads, then cloud rungs by health, then
     local ones. A CLOUD selection that keeps failing stops leading until its
     circuit breaker closes (a hosted custom endpoint counts as cloud). A
     LOCAL selection always leads: the cloud follows only if it fails.
   - A breaker never outlives what it was about: a rung that last led for a
     different selection (another model, an edited custom command) starts
     clean, and every credential setter clears its own rungs. Without this a
     retired model's one-day demotion carried over to the next model picked.
   - A selected direct OpenAI, Claude, Gemini, Groq, Natively or Antigravity
     model reads its own screenshot first when the resolver says it reads
     images. Each vendor's fixed vision model stays as a fallback. A text-only
     or unknown selection gets no rung of its own and the fallback order is
     unchanged, so nothing is sent blind. Fixes defect 10 for this path.
   - The change is held to that by an order baseline: 225 combinations of
     configured providers and selected model, recorded before the change; 34
     differ after it, each by the selection's own rung moving first.
   - Measured cost: Gemini Flash is the default selection, and its first token
     on a screenshot is about 2.8 s where the Flash-Lite rung that led before
     takes about 1.1 s (5 runs each, 2026-10-01).
   - Claude: `thinking: disabled` was sent on every native Claude request, and
     Opus 5.5, Sonnet 5.5, Fable and Mythos answer it with a 400 (Anthropic's
     per-model table). `claudeThinkingParam` sends each model the setting it
     accepts. Request shapes are tested on the wire; not run against Anthropic
     (no key).
   - The clearer "nothing can read this screenshot" messages of section 3 were
     already added in phases 1 to 3b (local-only, OpenRouter text-only,
     DeepSeek Pro, AgentRouter).

   **Phase 5b** (built), the screen pre-pass (`VisionProviderRegistry` →
   `ScreenUnderstandingService`): the quick "describe the screen" step that
   runs before an answer starts, inside a 6 s total budget (first rung 3.6 s).
   Two decisions by Evin (2026-10-01) amend section 3 for this path:
   - **Cloud order stays fast.** A cloud selection does NOT lead the pre-pass.
     Measured full pre-pass reply on a real screenshot (4 runs each):
     Flash-Lite ~1.5 s, Flash ~2.2 s, Pro ~4.0 s. Since 5a the selected model
     reads the screenshot in the answer itself.
   - **No cloud pre-pass for a local selection.** With Ollama, a local custom
     endpoint or a local cURL provider selected, only local rungs remain. A
     local endpoint that reads images runs the pre-pass; Ollama gets none.
   - **The after-the-answer record is exempt** (Evin, 2026-10-01, after the
     review showed the consequence). After each screenshot answer Natively
     stores the screen's text so a later turn can quote it
     (`transcribeScreenForMemory`, the same registry, `userAction:
     'transcribe'`). Evin's rule: in "Keep screenshots on this device" mode it
     stays on the device; otherwise it goes to a cloud provider when one is
     available, else to the Ollama model; the text is kept for later turns.
     Built in 5b: the cloud part (the registry gets `purpose: 'record'` and
     does not apply the local-selection rule to it). The Ollama part is 5c.
   What was built:
   - Defect 9: the OpenAI and Claude rungs name the vendor's fixed vision
     model. Before, the screenshot went to the SELECTED model of that vendor,
     text-only or not.
   - Defect 8, as decided above: a local selection removes the cloud rungs.
   - Defect 7, corrected: the registry's Ollama and Codex rungs read credential
     fields nothing writes, so neither has ever run. Ollama stays without a
     pre-pass by decision. Codex and Antigravity rungs were NOT added: both are
     slow reasoning routes that could not be measured (no sign-in in a script),
     and a rung that cannot answer inside 6 s delays every screenshot answer.
     The Codex rung no longer claims to be local.
   - New selected-only rungs: `deepseek` (when the resolver says the selected
     model reads images; live 1.6–1.9 s) and `curl` (local only on a loopback
     or private host).
   - A breaker never outlives its selection, through one helper shared with
     the chat path (`forgetBreakersOfOtherSelections`).
   - Held by a baseline of 240 (keys × selection × mode) cases recorded before
     the change; every difference matches a named rule.
   - Not in the pre-pass (unreachable today, left alone): the non-streaming
     image paths `generateWithVisionFallback`, `chatWithGemini` with images
     (no renderer caller) and `streamChatWithGemini` (RAG passes no images).

   **Phase 5c-1** (built): Ollama and screenshots that stay on the machine.
   - The Ollama model writes the after-the-answer record when no cloud
     provider produced one, and in "Keep screenshots on this device" mode
     (Evin's rule above). The registry's Ollama rung is rebuilt on the live
     helper: only for the record, only when Ollama is the selected provider
     and an installed model reads images (`/api/show`), and local only when
     the daemon's host is loopback or private (the URL can point at another
     machine). It runs as a second stage with 45 s; the cloud record keeps its
     6 s. An Ollama answer cancels a record in flight. The pre-pass still never
     uses Ollama.
   - Defect 4: "Keep screenshots on this device" and a denied screenshots
     scope asked whether the SELECTED model's name looked like a vision model,
     then sent the image to it. They now ask the same resolver for any
     installed model that reads images and send to that model; the selected
     text model is left alone.
   - A daemon on ANOTHER machine (`OLLAMA_URL`) gets nothing new (Evin,
     2026-10-01: "keep the old behaviour"). In "Keep screenshots on this
     device" mode and for a denied screenshots scope it is admitted exactly as
     before: only when the SELECTED model reads images, judged by its name.
     The "any installed model" rule applies to a loopback or private host
     only, and there the daemon must confirm the model at the moment of the
     check (a name guess or a remembered answer is not enough). The
     after-the-answer record never goes to a remote Ollama in that mode.
   - A live turn is written to the conversation history at once; the screen's
     text is attached to it when the record arrives. It used to wait for the
     record, which a local model can take 45 s to write.
   - Tested against a fake Ollama HTTP server, with the requests asserted on
     the wire. NOT run against a real Ollama (none on the development
     machine): how long a local model takes, and what loading a second model
     costs, are unmeasured.

   **Phase 5c-2** (built), the chat screenshot path:
   - **Defect 6 is void.** The cURL lane (`activeCurlProvider`) cannot be
     selected in the running app: only the `switch-to-curl-provider` IPC sets
     it, the preload does not expose that channel and nothing in the renderer
     calls it. Saved cURL providers are loaded as custom providers and reach
     the chain through the existing `custom` rung. No cURL rung was built; the
     5b pre-pass `curl` rung is unreachable for the same reason.
   - A selected LOCAL custom endpoint (LM Studio, llama.cpp: loopback or
     private host, a template that carries an image, not switched off) answers
     a screenshot in "Keep screenshots on this device" mode. Only Ollama
     counted as local there before. It alone answers; a failure is shown and
     nothing falls through to the cloud. A hosted endpoint stays refused.
   - A leading selected rung is retried less: one attempt for a
     `<vendor>_selected` rung (the vendor's fixed model follows), two for any
     other leading selection, and only when a rung with a closed breaker sits
     behind it. The engine default is three.
   - The on-the-spot test: when the chain would be empty and the selected
     model has never been tested, it is tested first (10 s budget) and the
     screenshot is sent only on a pass. Never in the private modes. Live:
     DeepSeek Pro is tested in 2.4 s, saved as not reading images and refused.

   **Still open after 5c-2:**
   - Codex and Antigravity pre-pass rungs, each only if a measurement in a
     signed-in app shows it answers comfortably inside the 6 s budget (Evin:
     "add them in 5c after measuring"). Needs Evin: the dev instance has its
     own empty profile.
   - Phase 4 (the Auto / On / Off override and the picker marker).

### Verification status

| Phase | Tests | Live, real adapters and keys | In the running app |
| --- | --- | --- | --- |
| 1 | full suite | Code Hint before / after | yes |
| 2 | full suite | OpenRouter text-only model before / after | yes |
| 3a | full suite | one-time test through 7 real models | **not run** (closed by Evin, 2026-10-01: the machine was held by another session's app). Unverified: the app starting the test at startup and writing the `tests` section of `vision-capabilities.json`. Covered instead by the startup-order unit test and the script run. |
| 3b | full suite | DeepSeek Flash reads a real screenshot; Pro refused | **not run**, same reason |
| 5a | full suite | Gemini Flash / Pro / Natively selected, with an OpenAI key present, before / after | not run (no renderer change) |
| 5b | full suite | the real registry + pre-pass chain: DeepSeek Flash answers in 1.6–1.9 s; Pro not tried; cloud order unchanged with Gemini keyed | not run (no renderer change) |
| 5c-1 | full suite | none possible: no Ollama on the development machine; a fake Ollama HTTP server, requests asserted on the wire | not run |
| 5c-2 | full suite | the on-the-spot test with the real DeepSeek adapter (Pro: tested, refused); the local-endpoint path against a fake endpoint on loopback | not run |

Windows: no phase added OS-specific code; none has been run on Windows.

## Out of scope

- Other modalities (audio, PDF input).
- Choosing *which* vision model is best for a screenshot beyond "selected first,
  then health order".
- Removing the name list: it stays as the last-resort source for offline starts
  and providers that publish nothing.
