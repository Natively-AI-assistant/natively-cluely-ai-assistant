# Development

Build, run, debug, and extend Natively. Cross-platform contract lives in
`CLAUDE.md` — read it before touching anything platform-sensitive.

## Prerequisites

- **Node ≥ 22.13** (`engines` in package.json).
- **Rust** (rustup, stable) with `x86_64-apple-darwin` and `aarch64-apple-darwin`
  targets — only for `npm run build:native` (the Rust module in `native-module/`).
- **Platform SDK:**
  - macOS: Xcode Command Line Tools are enough for everything EXCEPT the Rust
    native module — `cidre`'s build script shells out to `xcodebuild`, which
    needs **full Xcode**. On hosts without it (e.g. macOS 12, where Xcode caps
    at 14.2 and cidre's macOS 15 API level likely fails anyway), get the
    prebuilt module from CI instead — see "Native module from CI" below.
  - Windows: VS Build Tools (C++ workload) for the better-sqlite3/keytar rebuilds.
- **Private submodule** `premium/` (Pro code). Without it, every
  `build:electron` run needs `NATIVELY_CORE_SMOKE=1`, which leaves the private
  runtime imports external (the guarded `require`s degrade at runtime). With
  the submodule checked out, builds are unchanged.

## Build and run

```sh
npm ci                     # postinstall: patch-package, sharp, native rebuilds,
                           # model downloads, plist patch, arch verification
npm run dev:agent          # agent-driven instance: isolated userData, CDP port
                           # in ./agent-browser.json (see CLAUDE.md)
npm run app:dev            # developer instance (vite :5180 + electron)
```

On a host without the premium submodule, prefix dev/build/test commands with
`NATIVELY_CORE_SMOKE=1` (npm propagates it through the script chains):

```sh
NATIVELY_CORE_SMOKE=1 npm run app:dev
NATIVELY_CORE_SMOKE=1 npm test
```

### Packaging

- **Windows:** `npm run dist` — unchanged.
- **macOS (release):** `npm run app:build` / `app:build:signed` — needs full
  Xcode (native module), the macOS 26 SDK (Apple Speech helper), and both-arch
  native builds. CI runs these (`.github/workflows/release-macos.yml`).
- **macOS (local x64, no Xcode):** `npm run app:build:mac-x64-local`, output in
  `release/mac/<productName>.app` (electron-builder `--mac dir --x64`). It
  deliberately omits `build:native` — it packs the CI artifact already sitting
  in `native-module/` — and sets two opt-out env vars consumed by the scripts:
  - `NATIVELY_SKIP_APPLE_SPEECH=1` — `scripts/build-apple-speech.js` skips the
    helper (needs the macOS 26 SDK; Apple Speech is runtime-gated to macOS 26
    anyway) and `scripts/verify-packaged-local-assets.mjs` notes instead of
    erroring.
  - `NATIVELY_SKIP_NATIVE_REBUILD=1` — `scripts/rebuild-native-for-target.cjs`
    (beforePack) and `scripts/package-app.js` skip the better-sqlite3/keytar
    source rebuilds. Only safe when the tree already holds correct arch +
    Electron-ABI binaries; the chain runs `scripts/verify-native-arch.js`
    first and the afterPack guard (`scripts/ad-hoc-sign.js`) still file-verifies
    the arch of the binaries inside the packed app. This script also overrides
    `build.mac.icon` to `assets/icon.icns`, because electron-builder 26
    compiles the `.icon` (Icon Composer) format through Xcode 26's `actool`.

### Native module from CI (hosts that cannot compile it)

`.github/workflows/native-macos.yml` (`workflow_dispatch`, no secrets) builds
`native-module/index.darwin-{x64,arm64}.node` on a macOS runner and gates the
x64 artifact on macOS 12 compatibility: `minos 12.0`, CoreAudio +
ScreenCaptureKit as `LC_LOAD_WEAK_DYLIB`, and every undefined symbol from those
frameworks weak. The workflow file must exist on the fork's default branch to
be dispatchable.

```sh
gh workflow run native-macos.yml --repo <fork> --ref <branch>
gh run download <run-id> --repo <fork> -n native-module-darwin -D native-module/
```

Likewise, better-sqlite3/keytar cannot be compiled against Electron's V8
headers without a C++20-capable libc++ (macOS 12: `<source_location>` and
`std::three_way_comparable_with` are missing from every installable SDK, and
better-sqlite3 publishes no Electron-ABI prebuilds). Copy the matching
versions' binaries out of an installed release's
`Contents/Resources/app.asar.unpacked/node_modules/` and load-test them:

```sh
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  -e "const db=require('better-sqlite3')(':memory:');console.log(db.prepare('select 1+1 as x').get().x, typeof require('keytar').getPassword)"
```

### Model assets

`scripts/download-models.js` imports `@huggingface/transformers`, which dlopens
onnxruntime — this fails on macOS 12 (see below). `--verify` checks the files
without importing anything; on such hosts, populate `resources/models/` by
copying from an installed release's `Contents/Resources/models/` and verify
against the pinned manifests' sha256.

## Debug

- **Log:** `~/Documents/natively_debug.log` (macOS) / the documents-dir
  equivalent resolved by `electron/utils/debugLogPath.mjs` (Windows).
  Agent instances (`dev:agent`) keep their own log inside their isolated
  userData. Crash reports: `~/Library/Logs/DiagnosticReports` (macOS).
- **GPU problems** (blank/white window, missing overlay — patched or legacy
  GPUs, OCLP machines, old drivers): launch with `NATIVELY_DISABLE_GPU=1`, or
  use Settings › General › "Turn off GPU acceleration" (next launch). Logic in
  `electron/utils/gpuAcceleration.ts`; `NATIVELY_DISABLE_GPU=0` overrides a
  stored `true` without editing settings.json.
- **Renderer/UI:** the agent-browser CDP flow in `CLAUDE.md` ("Agent UI testing
  via CDP").
- **Native binaries:**
  ```sh
  otool -l native-module/index.darwin-x64.node | grep -A3 LC_BUILD_VERSION   # minos
  nm -m native-module/index.darwin-x64.node | grep 'from ScreenCaptureKit'   # weak binds
  ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
    -e "console.log(Object.keys(require('./native-module/index.darwin-x64.node')).length)"
  ```

## macOS 12 (Monterey) notes

Supported floor (`LSMinimumSystemVersion=12.0`, written explicitly by
`build.mac.minimumSystemVersion`), but a big slice of the local-AI stack needs
newer systems and degrades instead of crashing:

- **Electron must stay ≤ 43.** Chromium 150 is the last line that runs on
  Monterey; Chromium 151 requires macOS 13. Do not bump Electron on a
  12-compatible branch.
- **Unavailable on 12:**
  - Local ONNX embeddings, the reranker, transformers.js — onnxruntime-node's
    dylib needs `std::to_chars(double)` (libc++ of macOS 13.3+). Preflight
    reports this as `unavailable … need macOS 13.3`, not "reinstall".
  - Local Whisper (gated in `modelManager.ts`), Apple Speech STT (macOS 26).
  - CoreAudio process-tap system audio (macOS 14.4) and ScreenCaptureKit
    audio (macOS 13). **Use the BlackHole backend instead:** install
    `brew install blackhole-2ch`, create a Multi-Output Device (speakers +
    BlackHole 2ch) in Audio MIDI Setup, select it as the system output, then
    Settings › Audio › System Audio Capture = "Virtual input device
    (BlackHole)". Meetings capture system audio through it
    (`[SystemAudioCapture] Active backend: input-device`).
  - sqlite-vec's x64 dylib is `minos 15.0` and node-llama-cpp's mac-x64 binary
    is `minos 14.0` — vector retrieval and GGUF features do not load on 12.
    Both are lazy/worker-loaded, so boot is unaffected.
- **Permissions** (System Settings › Privacy & Security, granted per app
  bundle — an ad-hoc-signed local build is a NEW bundle and inherits nothing):
  Microphone (mic + BlackHole), Screen Recording (screenshots; system-audio
  start is gated on it even for BlackHole), Accessibility (stealth typing
  only), optionally Calendars. Keychain prompts once for "… Safe Storage" —
  choose Always Allow.

## Adding an AI provider

**(a) It speaks the OpenAI chat-completions API** (OpenRouter, Ollama, LM
Studio, LiteLLM-style proxies, vendor compat endpoints, a work gateway):
no code. Settings › AI Providers › Gateways › "OpenAI-compatible endpoints" ›
Add endpoint. Presets fill the Base URL (Anthropic `https://api.anthropic.com/v1/`,
Gemini `https://generativelanguage.googleapis.com/v1beta/openai/`, per their
official OpenAI-compat docs); models are whatever wire names you list. They
join the model picker as `compat:<instanceId>/<model>`, keyed by the endpoint
name. The API key lives in the safeStorage blob (Keychain on macOS, DPAPI on
Windows) and never returns to the renderer.
- **QwenCloud presets**: Token Plan
  `https://token-plan.maas.qwencloudapi.com/compatible-mode/v1` (keys
  `sk-sp-…`), Pay-as-you-go `https://maas.qwencloudapi.com/compatible-mode/v1`
  (keys `sk-…`, never `sk-sp-…`), Coding Plan
  `https://coding-intl.dashscope.aliyuncs.com/v1` (keys `sk-sp-…`). Keys come
  from `home.qwencloud.com/api-keys`; the editor warns — advisory only, Save
  still works — when the typed key's prefix belongs to a different plan.
  Coding Plan is a legacy host missing from docs.qwencloud.com but live
  (verified 2026-10-20). QwenCloud's compat endpoints do not publish
  `GET /models` (Token Plan and Pay-as-you-go answer 401/404), so the editor
  offers a labelled fallback list instead: Token Plan's 11 documented ids, and
  qwen-max / qwen-plus / qwen-flash for Pay-as-you-go.
- **Fetch models**: the editor button calls the main-process IPC
  `openai-compat:fetch-models` (`electron/llm/providers/openaiCompatModels.ts`)
  — `GET {baseURL}/models` with a 10 s timeout. It sends the typed key, or the
  stored key only when the request origin matches the origin it was saved for;
  the key never reaches the renderer or logs. Result: sorted deduped ids, or
  `invalid | unauthorized | not_found | timeout | network | http | bad_response`.
  In the checklist, ids matching `audio|image|video|tts|asr|wan|happyhorse` are
  grouped as "Not supported (non-text)". Ticking rows writes the Models field
  (max 20); typing it manually still works.

**(b) It speaks a new protocol:** implement `LLMProvider`
(`electron/llm/providers/types.ts`) — `id`, `name`, `ownsModel`, `stream`,
`generate` — and register it in a `ProviderRegistry` sibling setter next to
`LLMHelper.setOpenAICompatProviders`. Store config with the
`openaiCompatProviders` pattern in `CredentialsManager` (safeStorage blob,
degraded-store guard, keys never logged or returned), add list/save/delete IPC
next to `openai-compat:*` in `ipcHandlers.ts`, preload bindings and
`electron.d.ts` types, and a settings card. **No switch edits are needed:**
`LLMHelper` routes registry-owned models through one lane — text cascade,
streaming selection (with the failover wrapper), `isUsingUserEndpoint`, and
Direct Assist (`classifyCloudModel` → `compat`-style dispatch).

Deliberate limits of the registry lane (both documented on purpose):
- **Text-only.** Screenshots go through Natively's existing vision chain,
  which never recruits a registry provider; Direct Assist refuses images for
  it. Add `buildOpenAiImageParts`-style image parts to the provider when a
  compat model must see images.
- **Never the fast model.** The Background/fast-model family switches are
  untouched (pinned exhaustively by `FastModelGatewayDispatch2026_09_24.test.mjs`).

The legacy providers (OpenAI, Claude, Gemini, Groq, DeepSeek, NVIDIA NIM,
OpenRouter, Fluxion, AgentRouter, LiteLLM, 9Router, Ollama, Codex CLI,
Antigravity, custom/curl) predate the interface and still live as per-provider
adapters plus `case` arms inside `LLMHelper.ts`'s switches. They are not being
migrated; new integrations should not add arms.

If your provider's routed ids can look like another vendor's (a gateway
fronting arbitrary catalogues), exclude them at the PREDICATE level
(`isOpenAiModel` and friends in `LLMHelper.ts`, `providerFamily` in
`ipcHandlers.ts`) — branch ordering alone has misrouted and misbilled requests
three times (Fluxion, AgentRouter, 9Router).
