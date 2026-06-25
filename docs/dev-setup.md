# Development Setup Guide

This guide is for contributors who want a repeatable local setup for the Electron app, Rust native audio module, and native Node dependencies. The quick start in the README is enough for a first run; use this page when you need exact commands or need to recover from install and native rebuild failures.

## Prerequisites

- Node.js 22 LTS is recommended for new contributor machines. The repo currently documents Node.js 20+ as the minimum, and the Electron build targets Node 20 runtime semantics.
- npm from the same Node.js install.
- Git.
- Rust stable with `cargo` and `rustup` available on your PATH.
- A C/C++ build toolchain:
  - macOS: Xcode Command Line Tools (`xcode-select --install`).
  - Windows: Visual Studio Build Tools with the Desktop development with C++ workload.
- Network access for the initial install. `postinstall` downloads local model files and may fetch platform packages for native dependencies.

## Clone And Install

```bash
git clone https://github.com/natively-ai-assistant/natively-cluely-ai-assistant.git
cd natively-cluely-ai-assistant
npm ci
```

Use `npm install` instead of `npm ci` only when you intentionally need to update `package-lock.json`.

The root `postinstall` script does more than a normal web app install:

1. Rebuilds `sharp`.
2. Rebuilds Electron native addons (`better-sqlite3`, `keytar`) for the Electron ABI.
3. Downloads local model assets into `resources/models`.
4. Ensures macOS `sqlite-vec` platform packages are present.
5. Patches the development Electron app plist for microphone, audio capture, and screen capture permissions.
6. Verifies native addon architecture on macOS.

If any of those steps fail, fix the underlying cause and rerun `npm ci` or the specific command from the troubleshooting section below.

## Environment

Copy the example environment file and fill only the providers you plan to use:

```bash
cp .env.example .env
```

Do not commit `.env`, API keys, service-account files, user transcripts, local databases, screenshots, or real meeting fixtures.

For a minimal cloud-backed development run, one LLM key such as `GEMINI_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, or `CLAUDE_API_KEY` is enough for chat features. Speech-to-text providers are optional unless you are testing live transcription.

## Native Audio Module

The Rust native audio module lives in `native-module/`. Build it from the repo root:

```bash
npm run build:native
```

On macOS this builds the current machine architecture by default:

- Apple Silicon -> `native-module/index.darwin-arm64.node`
- Intel -> `native-module/index.darwin-x64.node`

For release-style macOS packaging, build both architectures:

```bash
NATIVELY_BUILD_ALL_MAC_ARCHES=1 npm run build:native
```

The app also uses native Node addons that must match Electron's ABI. `npm ci` runs this automatically, but you can rerun it after Node, Electron, or architecture changes:

```bash
npm run rebuild:native
```

## Run The App

Start the full desktop development loop:

```bash
npm start
```

This is an alias for the app development workflow. It starts Vite on port 5180 and launches Electron after the renderer is ready.

Useful narrower commands:

```bash
npm run dev
npm run electron:dev
npm run build:electron
```

Use `npm run dev` only for renderer work that does not require the Electron shell. Use `npm run electron:dev` when the renderer is already running and you only need to relaunch Electron.

## Verification Commands

Pick the smallest relevant check for your change:

```bash
npm run build:electron
npm run typecheck:electron
npm run build
npm run test:llm
npm run test:services
npm test
```

Suggested scope:

- Electron main-process or service changes: `npm run build:electron`, `npm run typecheck:electron`, and the relevant `node --test` file or package script.
- LLM helper changes: `npm run test:llm`.
- Renderer-only changes: `npm run build`.
- Native audio changes: `npm run build:native`, `npm run rebuild:native`, and the affected audio tests.
- Broad changes before a PR: `npm run test:ci` if time and machine resources allow it.

Most `electron/**/__tests__/*.test.mjs` files import compiled files from `dist-electron`, so run `npm run build:electron` before executing them directly.

## Common Install Failures

### Native addon has the wrong architecture on Apple Silicon

Symptom:

```text
ERR_DLOPEN_FAILED
incompatible architecture (have 'x86_64', need 'arm64')
```

Cause: install or rebuild ran from a Rosetta/x64 terminal on arm64 hardware.

Fix:

```bash
npm run rebuild:native
```

If it still fails, open a native arm64 terminal and rerun the command. On macOS, the rebuild script detects the true hardware architecture and the verifier fails loudly if `better-sqlite3` or `keytar` is still wrong.

### Rust or napi build fails

Check that Rust and the platform toolchain are installed:

```bash
rustc --version
cargo --version
```

Then rebuild the Rust module:

```bash
npm run build:native
```

On macOS, `scripts/build-native.js` adds the needed Rust target and uses `clang -print-resource-dir` to find the active clang runtime. If clang is missing, install Xcode Command Line Tools.

### `sharp` or libvips fails during install

The root `postinstall` rebuilds `sharp` with `SHARP_IGNORE_GLOBAL_LIBVIPS=1`. Rerun the sharp rebuild first:

```bash
npm rebuild sharp
```

For macOS universal packaging, ensure both Darwin sharp optional packages are present:

```bash
node scripts/ensure-sharp-mac-deps.js
```

### `sqlite-vec` package is missing

The install script ensures both macOS sqlite-vec platform packages are present for packaging:

```bash
node scripts/ensure-sqlite-vec.js
```

If npm cannot fetch the package, retry after network access is restored and then rerun `npm run rebuild:native`.

### Local model download fails

`scripts/download-models.js` downloads local embedding, classifier, and reranker assets into `resources/models`. Retry the download directly:

```bash
node scripts/download-models.js
```

If you are offline or behind a restrictive network, use cloud providers for unrelated development work and rerun the download before testing local RAG or packaged builds.

### macOS does not show microphone or screen recording prompts

The development Electron app needs plist usage descriptions for macOS permissions. `postinstall` patches the local Electron app, but you can rerun the patch:

```bash
node scripts/patch-electron-plist.js
```

Then relaunch the app. If macOS has cached an old permission decision, remove and re-add the app in System Settings.

## Build Artifacts And Generated Files

Common generated paths:

- `dist/`
- `dist-electron/`
- `resources/models/`
- `native-module/index.*.node`
- Electron builder release output

Do not include generated artifacts in a PR unless the repository explicitly expects them for the change.

## Fixture And Privacy Hygiene

Use synthetic fixtures for tests and screenshots. Do not add real meeting transcripts, resumes, job descriptions, emails, screenshots, local database rows, or application support files. When debugging context or hallucination bugs, reduce the case to synthetic text that preserves the routing behavior without preserving personal content.
