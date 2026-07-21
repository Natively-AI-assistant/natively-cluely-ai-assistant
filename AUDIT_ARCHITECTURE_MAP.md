# Natively — Architecture Map (Phase 0)

_Production-hardening audit, 2026-07-11. Read-only inventory. No code changed in this phase._

> **Reconstruction note**: this file was lost mid-session to a shared-workspace
> branch switch (see `AUDIT_VERIFICATION_REPORT.md`'s operational note and the
> `shared-workspace-branch-hazard-2026-07-11` memory entry). Rebuilt from
> session notes; content matches the original.

This map was produced by a parallel read-only sweep of every subsystem (9
mapper agents over the knowledge graph + source), then key findings were
**verified inline against the real code** before being recorded here. Where a
mapper agent's claim did not survive verification, it is marked **[REFUTED]**
or **[RECLASSIFIED]** so later phases don't chase ghosts.

## 1. Repo shape

Monorepo-ish layout with git submodules and several vestigial trees.

| Path | Role | Notes |
|------|------|-------|
| `electron/` | **Electron main process** (TS→`dist-electron/`) | main.ts (~7.7k LOC), ipcHandlers.ts (~10.3k LOC), preload.ts (~2.6k LOC), LLMHelper.ts (~7.4k LOC) |
| `src/` | **Renderer** (React 19 + Vite) | entry `src/main.tsx` → `src/App.tsx`; giant `components/NativelyInterface.tsx` |
| `natively-api/` | **Backend** (Fastify, Railway) — **git submodule** (`github.com/evinjohnn/natively-api`) | server.js ~10.7k LOC; STT relay in `services/stt-relay/` + `packages/stt-relay-core/` |
| `premium/` | **Premium/license** — git submodule (`Natively-AI-assistant/natively-premium`) | LicenseManager lives here; **absent in source-available builds → license gate fails closed** |
| `native-module/` | Rust audio capture (cpal/CoreAudio) → `.node` | packaged in asar.unpacked |
| `natively-browser/` | Browser extension (esbuild, separate pipeline) | byte-identical to gold per prior audit history |
| `worker-script/` | Node worker stubs | `worker-script/node/index.js` is an empty stub — NOT the audio path |
| `natively/`, `renderer/`, `cluely/` | **Legacy / vestigial** | `natively/` = old "Initial commit" tree with its own `api_keys.json` (gitignored, local only) |
| `scripts/` | ~63 build/verify/smoke scripts | signing, notarization, native rebuild, model download, release gate |
| `benchmarks/`, `tests/`, `intelligence-eval-*` | eval harnesses | |

### Build / entry
- **Main entry**: `dist-electron/electron/main.js` (built by `scripts/build-electron.js` esbuild).
- **Renderer entry**: `index.html` → `src/main.tsx` (Vite; base `./`).
- **Electron**: `^33.2.0`; **electron-builder**: `^26.8.1`. **better-sqlite3** `12.11.1` (pinned).
- **postinstall chain**: patch-package → sharp rebuild → native rebuild → HF model download (~280MB) → sqlite-vec ensure → plist patch → arch verify.

## 2. Runtime processes

1. **Electron main** — orchestrator singleton `AppState`; owns windows, audio, IPC, DB, updater, tray/dock, stealth mode.
2. **Renderer(s)** — Launcher + Overlay (one BrowserWindow reused / switched), Settings panel, Model-selector dropdown, Cropper overlay. All `nodeIntegration:false`, `contextIsolation:true`, shared `preload.js`.
3. **Native module** — Rust mic capture loaded in **main** process (no renderer getUserMedia).
4. **Worker threads** — vector search, whisper STT, intent classifier, local embedding, local reranker, reranker download (all `asarUnpack`ed `*.js` workers).
5. **Child processes** — Ollama (optional), Hindsight memory server (optional), Codex OAuth (direct-HTTPS, no CLI subprocess).
6. **Backend** — Fastify server on Railway + a separate STT-relay service (own Dockerfile).

## 3. Windows & webPreferences (verified)

| Window | File:line | nodeIntegration | contextIsolation | webSecurity | sandbox |
|--------|-----------|-----------------|------------------|-------------|---------|
| Launcher/Overlay | `WindowHelper.ts:286,454` | false | true | `!isDev` | (default) |
| Settings | `SettingsWindowHelper.ts:171` | false | true | default | (default) |
| Model selector | `ModelSelectorWindowHelper.ts:136` | false | true | default | (default) |
| Cropper | `CropperWindowHelper.ts:421` | false | true | default | (default) |

- ✅ Electron baseline correct everywhere.
- ⚠️ No `setWindowOpenHandler`/`will-navigate`/`will-redirect` guard on any window — flagged for Phase 2, ultimately left as a documented deferred item (see AUDIT_ELECTRON_SECURITY.md).
- ✅ CSP present in `index.html`.

## 4. Core modules by subsystem

- **Main core**: `main.ts` (lifecycle, crash handlers, auto-updater, dock/stealth), `WindowHelper`, `SettingsWindowHelper`, `ModelSelectorWindowHelper`, `CropperWindowHelper`, `ThemeManager`, `nativeArchGate`, `DonationManager`.
- **IPC/preload**: `ipcHandlers.ts` (hundreds of `safeHandle(...)` channels), `preload.ts` (contextBridge surface).
- **LLM**: `LLMHelper.ts` + `electron/llm/*` (Gemini/Groq/Ollama/Codex-OAuth/MiniMax/natively-cloud), streaming SSE, fallback ladders, breakers/cooldowns.
- **RAG/Intelligence**: `rag/` (RAGManager, EmbeddingPipeline, EmbeddingProviderResolver, VectorStore, ModeHybridRetriever), `IntelligenceEngine.ts`, `IntelligenceManager.ts`, `intelligence/context-os/` (Source Authority Kernel — active development, see AUDIT_AI_CONTEXT_OWNERSHIP.md), `intelligence/memory/`, `services/knowledge/` (OKF).
- **Audio/STT**: `audio/` (MicrophoneCapture, SystemAudioCapture, LocalWhisperSTT, OpenAIStreamingSTT, RestSTT, whisper/modelPreloader), native-module.
- **Services**: meeting/ (Meeting Notes V3), modes/, post-call/, screen/, skills/, telemetry/, browser-context/, PhoneMirrorService, HindsightManager, CredentialsManager.
- **DB**: `db/DatabaseManager.ts` (better-sqlite3, WAL, migrations v1→v24+, sqlite-vec), `MeetingPersistence.ts`, `CredentialsManager`.
- **Backend**: `server.js` (auth, Dodo webhooks, provider proxies, trial JWT, admin endpoints), `lib/*`, `services/stt-relay/`.

## 5. Where secrets & config load

- **App**: API keys via `CredentialsManager` → OS keyring (keytar/safeStorage) with AES-256 app-managed fallback.
- **Telemetry** (`main.ts`): POSTHOG_API_KEY/SENTRY_DSN/AXIOM_TOKEN read from env into sink config — verified in Phase 4 the config never reaches disk unredacted.
- **Backend** (`natively-api/.env`, ~75 keys): confirmed NOT git-tracked, NOT in git history; `.gitignore` covers it. Root `.env` likewise gitignored.
- **Signing**: Apple Team ID (non-secret) in `electron-builder.signed.cjs`; real creds in macOS keychain/CI secrets.

## 6. External network calls

App → Gemini/Groq/OpenAI/Ollama(local)/natively-cloud proxy (LLM); STT providers (Deepgram/Soniox/Google/ElevenLabs/Azure/IBM WS+REST); api.natively.software (trial+license+cloud LLM); GitHub Releases (updater); HuggingFace CDN (model download). Renderer → googletagmanager.com (GA4), Google Fonts. Backend → Supabase, Dodo, provider pools, Google OAuth, Resend, Sentry/PostHog/Axiom.

## 7. Timers / listeners / long-running

Auto-updater 10s initial-check timer + persistent listeners (fine, process-lifetime). STT streaming/reconnect/safety-net timers (Phase 7 focus). Renderer `App.tsx` mount effect with 9+ IPC listeners (verified fully cleaned up, Phase 6). VectorStore worker (verified `destroy()` wired into `before-quit`, Phase 1).

## 8. IPC boundaries (high-risk channels — resolved in later phases)

- `open-external` — verified hardened (https + macOS `x-apple.systempreferences:` only).
- `set-azure-region`/`set-ibmwatson-region`/`set-openai-stt-base-url` — SSRF-shaped gap, **fixed** in Phase 2.
- `save-custom-provider`/`save-curl-provider` — "shell injection" claim **refuted** (curlCommand is parsed, never exec'd); real gap was a missing timeout, **fixed** in Phase 1.
- `__e2e__:*` — env-gated behind `NATIVELY_E2E==='1'`, verified never set in any build path.

## 9. File read/write & sensitive data at rest

`~/Documents/natively_debug.log` (redacted at write time, Phase 4 verified). userData: SQLite DB, electron-store prefs, credentials blob, salt file. Reference-file uploads (resume/JD/thesis) into RAG+DB. `MeetingPersistence.saveMeeting`'s "unbounded transcript write" claim **refuted** with a real benchmark in Phase 7 (1800-row transaction: 1.1ms, bounded by SessionTracker's own compaction).

## 10. Legacy / dead / duplicated

`natively/` (old OSS tree), `renderer/` (unused CRA app), `cluely/` (2 markdown files), `worker-script/node/index.js` (empty stub). `react-code-blocks` and `diff` npm packages found **completely unused** and removed in Phase 8.

## Cross-cutting P0/P1 candidate register — final disposition

| # | Area | Claim | Final disposition |
|---|------|-------|--------------------|
| A/B | Backend | admin-key exposure / forgeable trial tokens | REFUTED (Phase 3) |
| C | Backend | main WS missing `maxPayload` | CONFIRMED, FIXED (Phase 3/8) |
| D | IPC | STT region/URL SSRF | CONFIRMED, FIXED (Phase 2) |
| E | LLM | missing read-phase timeouts | CONFIRMED, FIXED (Phase 1) |
| F | Renderer | DOMPurify streaming XSS | REFUTED (Phase 2/6) |
| G | Renderer | GA gtag.js injection, no SRI | confirmed low-risk, CSP-constrained, not actioned |
| H | Renderer | unbounded messages/rollingTranscript | REFUTED (Phase 1) |
| I | Updater | no stage-2 signature verify | confirmed inherent to electron-updater's GitHub provider, documented (Phase 8) |
| J | Packaging | no `.env`/log/pdf excludes | CONFIRMED, FIXED (Phase 4/8) |
| K | DB | FK pragma off unless premium loads | CONFIRMED, FIXED (Phase 1) |
| L | Audio | unbounded chunks / orphaned VAD loop | PARTIAL — chunks bound REFUTED, VAD-loop CONFIRMED+FIXED (Phase 1/7) |
| M | RAG | provider-promotion race; worker leak | PARTIAL — worker-leak REFUTED, space-label race CONFIRMED+FIXED (Phase 1) |
| N | Main | telemetry sink secrets in local sink | REFUTED (Phase 4) |
| — | Main | `unhandledRejection` unconditional DB close | **NOT in original register — found independently in Phase 9, P0, FIXED** |
