## Summary

Version 2.0.6 introduces critical stealth mode enhancements, an upgraded model roster with massive token limit increases for Groq, and a thorough senior-level code audit fixing multiple race conditions, memory leaks, and silent tracking drops.

## What's New

- **Multimodal Groq Support**: Integrated `meta-llama/llama-4-scout-17b-16e-instruct` into the ecosystem for screenshot analysis capability.
- **Model Roster Update**: Updated baseline architecture natively to default to `gpt-5.4-chat`, `gemini-3.1`, and `claude-sonnet-4-6`.
- **Token Limits**: Increased Groq max completion tokens to 8192 (the API maximum for context windows) to better support full code generation while preventing `BadRequestError`.
- **Model Rotation Engine**: Fortified the 3-tier fallback mechanisms and auto-upgrade logic for Gemini, Claude, GPT, and Groq models.
- **OpenAI Streaming STT**: Implemented a brand new low-latency WebSocket integration via the OpenAI Realtime API. Uses a 3-tier priority rotation (`gpt-4o-transcribe` → `gpt-4o-mini-transcribe` → `whisper-1` REST) with server-side VAD, noise reduction, and uninterrupted audio buffering.

## Improvements

- **SEO & Documentation**: Optimized `README.md` for search engines with hidden targeted keywords.
- **Code Quality**: Performed a senior-level code review across modified files to address potential race conditions, edge cases, and empty references.
- **STT Providers Architecture**: Refactored Google, Deepgram, Soniox, and ElevenLabs streaming implementations. Specifically engineered the OpenAI module with custom ring-buffers, a 10s dark-drop timeout, a 5s zombie-session timeout, and 250ms audio chunk limiters to eradicate API rate-limits.
- **Stealth Boot Refactor**: Centralized platform disguise and dock icon management into `AppState` for consistent stealth behavior across reboots.

## Fixes

- **Critical Race Condition**: Eliminated dangerous `this.geminiModel` global state mutations during API fallback loops.
- **Silent Fallback Failure**: Rewired the `generateWithVisionFallback` chains for Gemini to correctly inject auto-discovered Tier models instead of defaulting back to generic UI settings.
- **Groq Multimedia Drop**: Repaired the "Front Door" routing bug in `streamChat` where image attachments bypassed the Groq engine completely and threw a "No LLM provider available" error.
- **App Boot Race Condition**: Wrapped `SettingsManager.getInstance()` constructor file-system access in `app.isReady()` checks to prevent early-import fatal crashes.
- **Settings State Persistence**: Added validation to `SettingsManager`'s JSON parser so corrupted `settings.json` files default to `{}` safely.
- **Opacity Shield Memory Leak**: Saved references to the 60ms `setTimeout` Windows flash-shield timers in Windows Helpers and properly cleared them.
- **Settings/ModelSelector Crash Risk**: Appended `.catch()` blocks to the `loadURL()` directives in Windows Helpers to handle React dev-server drops gracefully.
- **Disguise Timer Memory Leak**: Rewrote `main.ts`'s process title disguise implementation to immediately strip timer IDs when completed.
- **Ollama Initialization Risk**: Wrapped the `OllamaBootstrap.bootstrap()` floating promise in a tracked class property.
- **Windows Icon Pathing**: Rewrote the `icon` constructor option mapping to dynamically resolve `natively.icns` for `darwin`, `icon.ico` for `win32`, and `icon.png` for Linux.
- **Cross-Platform Disguise**: Verified mapping `Terminal` to `Command Prompt` on Windows and isolating `CFBundleName` safely to macOS environments.
- **SQLite-Vec Per-Dimension Table Fix (v8 Migration)**: Fixed a critical silent data-corruption bug by provisioning three per-dimension table pairs (`vec_chunks_768`, `1536`, `3072`) and updating the VectorStore write path and native search payloads.
- **Permanent Hide & State Clear Trap**: Repaired a critical IPC routing flaw in `WindowHelper.this.getMainWindow()` where hiding the session UI dynamically misrouted all subsequent `Cmd+B` / "Toggle Visibility" commands to the background Launcher. This invisible interface trap caused users to repeatedly Force Quit the application via macOS dock. The forceful ungraceful exits during background syncing rounds led to truncated (wiped out) JSON files, erasing STT API keys and Disguise Settings. Atomic writes (implemented prior) prevent corruption during sudden exits, and this IPC fix completely solves the actual interface disappearance bug.

## Technical

- **PR Integration**: Safely integrated changes from PR #64 ("Build stealth-mode enhancements") and PR #71, conducted code reviews, and ensured build compatibility without modifying git history.
- **SettingsManager**: Created `SettingsManager` to securely persist boot-critical settings (`isUndetectable`).
- **Initialization**: Refactored `initializeApp` sequence in `main.ts` to immediately read cached `isUndetectable` state on boot via `SettingsManager` for instant stealth. Migrated dock icon and process title management to a unified `applyInitialDisguise` lifecycle method.

## ⚠️macOS Installation (Unsigned Build)

Download the correct architecture .zip or .dmg file for your device (Apple Silicon or Intel).

If you see "App is damaged":

- **For .zip downloads:**
  1. Move the app to your Applications folder.
  2. Open Terminal and run: `xattr -cr /Applications/Natively.app`

- **For .dmg downloads:**
  1. Open Terminal and run:
     ```bash
     xattr -cr ~/Downloads/Natively-2.0.6-arm64.dmg
     # Or for Intel Macs:
     xattr -cr ~/Downloads/Natively-2.0.6-x64.dmg
     ```
  2. Install the natively.dmg
  3. Open Terminal and run: `xattr -cr /Applications/Natively.app`

## ⚠️Windows Installation (Unsigned Build)

When running the installer on Windows, you might see a "Windows protected your PC" warning from Microsoft Defender SmartScreen saying it prevented an unrecognized app from starting.

Since this is an unsigned build, this is expected. You can safely ignore it by clicking **More info** and then **Run anyway**.

\\ refer to change.md for detailed changes
