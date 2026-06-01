# Real UI Testing Approach (Natively Profile Intelligence)

## Automation stack: Playwright Electron

Natively is an Electron app (`electron@33`, main = `dist-electron/electron/main.js`).
The suite uses **Playwright's `_electron` API** (`playwright-core@1.60`) to launch
the *real* packaged main process — the same app a user runs. Verified: the app
launches in ~700ms and renders the real React renderer (`dist/index.html`,
window routes `?window=settings` / `?window=overlay`).

This is NOT browser automation of a dev server and NOT a renderer mock. It is the
production Electron binary, real IPC, real `KnowledgeOrchestrator`, real
`/v1/chat` streaming.

## How the app is launched
`helpers/launch-natively.ts` → `_electron.launch({ args: ['.'], cwd: REPO_ROOT, env: { NODE_ENV: 'test', NATIVELY_TEST_API_KEY } })`.
Windows are obtained by route query: `settingsWindow()` waits for `?window=settings`,
`overlayWindow()` for `?window=overlay`.

## API key injection
Read from `process.env.NATIVELY_TEST_API_KEY` ONLY. `requireApiKey()` /
`global-setup.ts` hard-fail if absent (no fabrication). The key is set into the
launched app's env and activated through the real UI path (below). It is never
hardcoded, never written to any report (only a `natively_sk_****` fingerprint),
and `helpers/secret-redactor.ts` masks key-shaped + PII tokens in every artifact.

## Pro activation (required — Profile Intelligence is gated)
`isPremium()` reads a hardware-locked, encrypted license — there is **no test
bypass**, and we do not forge one. Instead `helpers/auth-helper.ts` calls the real
preload bridge `setNativelyApiKey(key)` → `LicenseManager.activateWithApiKey` →
`POST /v1/pro/verify`. If the key's plan includes Pro, the UI unlocks genuinely.
If not, the suite reports a hard precondition failure (it cannot test a gated UI).

## How test data is loaded (through the real UI)
`helpers/profile-loader-ui.ts`:
- **Resume / JD**: the upload buttons call `profileSelectFile()` (a native OS
  dialog) then `profileUploadResume/JD(path)` (the real ingest + LLM extraction).
  Playwright can't click a native OS picker, so `launch-natively.primeFileDialog()`
  stubs `dialog.showOpenDialog` (main process) to return the fixture path for the
  next call. **Only the OS picker is stubbed** — the real upload IPC, extraction,
  chunking, and indexing all run. We then poll `profileGetStatus()` until the UI
  reports the profile loaded.
- **Custom context / AI persona**: typed into the real textareas (located by
  production placeholder text); the debounced save IPC fires as for a human.
- **Negotiation**: the current UI has no dedicated negotiation upload control;
  negotiation context is delivered via custom-context (documented gap below).

Fixtures are real text files under `fixtures/<profile>/` (resume.txt, jd.txt,
custom-context.txt, persona.txt, negotiation.txt), generated from the 10 synthetic
canonical profiles via `scripts-generate-fixtures.mjs`. Each profile also keeps a
`profile.json` for the grader's expected values.

## How transcript is simulated
`helpers/transcript-injector-ui.ts` → preload bridge `__evalInjectTranscript`
(test-only) → the app's shipped `test-inject-transcript` IPC (gated to
`NODE_ENV==='test'`) → `intelligenceManager.addTranscript` — the **same** method
the live STT pipeline calls. Turns are timestamped within the last ~180s so the
what-to-answer path treats them as the recent window. This is the production
transcript ingestion path, not a mock.

## How "What to answer?" is clicked
`helpers/what-to-answer-ui.ts` finds the real button (text "What to answer?" /
"What should I answer?") in the overlay and clicks it. The button calls
`window.electronAPI.generateWhatToSay`, which streams via
`onIntelligenceSuggestedAnswerToken` / `onIntelligenceSuggestedAnswer`. We tap
those production events for timing AND read the rendered DOM for visual confirmation.

## How streaming response timing is measured
`helpers/response-observer-ui.ts` arms a tap on the SAME IPC stream events the UI
binds to (`onGeminiStreamToken/Done/Error` for manual; suggested-answer events for
what-to-answer), recording first-useful-token and completion against `performance.now()`,
then cross-checks that the answer text is actually visible in the DOM
(`visibleConfirmed`). `helpers/network-recorder-ui.ts` captures request/response
timing from Playwright page events where the renderer observes them.

## Limitations of the chosen approach
1. **The /v1/chat call originates in the MAIN process** (Node fetch), so renderer
   `page.on('response')` may not see it; precise network first-byte is captured via
   the IPC stream tap instead, and provider/model from the stream's `model` field.
2. **Native file picker is stubbed** (unavoidable — Playwright can't drive an OS
   dialog). Everything downstream of the picker is real.
3. **Token usage isn't in the SSE deltas**, so cost is `estimated` (char/4 + a
   pricing table) unless usage metadata appears — labeled honestly per test.
4. **Negotiation has no dedicated UI control** — delivered via custom context.
5. **Pro gating is real** — without a Pro-entitled key the Profile Intelligence UI
   stays locked and the suite reports a precondition failure rather than bypassing.
6. **A GUI window-server session is required** to launch Electron windows; in a
   pure-headless CI without one, the launch step will fail (documented, not faked).

## What makes this NOT a fake test
Real Electron main process • real IPC • real KnowledgeOrchestrator routing • real
`/v1/chat` streaming • real DOM-visible answer assertion • real per-test latency •
real Pro activation. The only stubs are the OS file picker and the test-gated
transcript-injection IPC the app already ships — neither bypasses the intelligence
layer, the prompt builder, or the provider.
