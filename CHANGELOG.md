    # Changelog

    ## [Unreleased]

    ### What's New

    - **LiteLLM AI Gateway**: Added LiteLLM as a built-in provider, giving access to 100+ LLM providers (AWS Bedrock, Google Vertex AI, Azure, Cohere, and more) through a single OpenAI-compatible proxy. Configure the proxy URL and optional virtual key under Settings → AI Providers → LiteLLM Proxy; models are auto-discovered from the proxy and listed with a `litellm/` prefix. Max output tokens default to **Auto** — each model's real output budget is read from the proxy's `/model/info` registry (fallback 8,192) — with a manual dropdown override (4K–1M). Routes through the same data-scope gating, rate-limiting, and abort-aware streaming as every other cloud provider.

    ## [2.7.0] - 2026-06-05

    ### What's New

    - **Profile Intelligence Router (v2)**: Advanced domain classification (Coding, System Design, Behavioral, Negotiation) propagating constraints directly to LLM streaming paths.
    - **DeepSeek AI Support**: Native integration of DeepSeek's advanced reasoning models via custom cURL OpenAI-compatible API providers.
    - **Two New Meeting UI Themes**: Beautiful Liquid Glass and Modern Dark themes to completely redefine the real-time overlay visual experience.
    - **Answer-Type Constraints & Follow-Up Resolver**: Context-aware follow-up resolution with strict output formatting layout constraints (short, detailed, bulleted, code-only).
    - **Eager Code UI Expansion**: Growth-holds CSS elements to eagerly size overlays before React code-block mounting to prevent layout shifts.
    - **PI Latency Tracer (`PiLatencyTracer`)**: Telemetry to track reasoning, validation, and routing latencies to guarantee sub-500ms responsiveness.
    - **Evidence Validator & Live Deadlines**: Cross-validates claims made in meetings and displays real-time countdowns for live assessment deadlines.
    - **Single-Click In-App Updates**: Seamless update loops directly inside the desktop application.

    ### Improvements & Fixes

    - **Audio Stack & TCC Permission Hardening**: Hardened credentials management by eliminating racing set-provider IPCs and resolved macOS system audio process tapping/TCC permission gates to guarantee robust capture streams.
    - **Production-Grade API Audit (server.js)**:
      - Resolved ElevenLabs open -> session_started audio gap on failover/reconnect.
      - Fixed mic-only billing bypass with active/recent system presence checks.
      - Fixed stream-abort billing leaks by moving billing triggers to the stream `finally` block.
      - Patched language regex prompt injection security vulnerablities on `/v1/chat/completions`.
      - Implemented webhook processing retries with 3-attempt exponential backoff.
      - Fixed fallback-seconds double counting on STT reconnect-after-failover.
      - Integrated HTTP keep-alive connection pooling via undici agent.
      - Resolved DNS lookup cache thrashing during key-rotation reconnect storms.
      - Sanitized admin endpoint `provider-health` key leak.
      - Added a 34-unit test suite (`unit-fixes.test.mjs`) to verify server logic.

    ## [2.6.0] - 2026-05-15

    ### What's New

    - **Phone Link Integration**: Connect iOS or Android devices as remote mics or companion screens.
    - **TinyPrompts™ Engine**: System prompts optimized for local SLMs (Ollama, Qwen 2.5:4B, Llama 3.2).
    - **Codex CLI Integration**: Sandboxed code execution and terminal tasks via `gpt-5.3-codex`.
    - **Auto-Calendar Sync**: Calendar connectors (Google Calendar, Outlook) for prep context.
    - **Smart Task Sync**: Auto-extract action items and export to Jira, Linear, or Asana.
    - **Speaker Identification**: Real-time speaker diarization tagging transcript names.

    ### Improvements & Fixes

    - **Advanced Stealth Features**: Activity Monitor evasion, process name disguising, and strict timeout management.
    - **Scroll & Layout**: Scroll keybinds for mouse-free navigation and horizontal layout code line rendering fixes.
    - **OpenAI Realtime GA**: Upgraded OpenAI realtime streaming STT connection to the new GA session schema.

    ## [2.5.0] - 2026-04-25

    ### What's New

    - **Modes Manager**: Toggle between 7 tailored personas (General, Technical Interview, Looking for Work, Sales, Recruiting, Team Meet, and Lecture) with custom templates.
    - **Custom Context & Notes**: Paste up to 8,000 characters of instructions, crib sheets, or credentials, auto-injected as XML blocks.
    - **10-Minute Free Trial**: Free trial system with HWID+IP anti-abuse protections.
    - **Permissions Onboarding Toaster**: macOS/Windows onboarding toaster for TCC permissions.

    ### Improvements & Fixes

    - **STT Connection Pools & Key Pools**: Round-robin pools (up to 6 keys for Deepgram and ElevenLabs), failover logic, and shadow-probe watchdogs.
    - **Bluetooth/AirPods Conflict Resolution**: Autodetects macOS CoreAudio conflicts and switches to built-in mic.
    - **Reliable Screenshot Capture**: Hardened multi-screenshot capture with `Cmd+Shift+Enter` single-trigger analysis.
    - **Dodo Webhook Billing Hardening**: Refactored payment processing webhook endpoints, splitting them into `/webhooks/dodo/api` and `/webhooks/dodo/pro`.

    ## [2.4.0] - 2026-04-10

    ### What's New & Improvements

    - **Permissions Check IPC**: IPC bridges for TCC and audio check.
    - **Log Forwarding**: Added `open-log-file` and console logging forwarding to `~/Documents/natively_debug.log`.
    - **Tavily Multi-Key Search Pool**: Tavily search key pool supporting up to 11 keys with round-robin rotation, automatic credit tracking, and exhaustion alerts.
    - **Ad Campaigns Engine**: Cooldown logic and targeting for Pro upgrade campaigns.

    ## [2.0.7] - 2026-03-20

    ### What's New
    
    - **Single-Trigger Analysis**: Added a new global keybind (`Cmd+Shift+Enter`) for "Capture and Process" to instantly take a screenshot and run AI analysis.
    - **Tavily Search Integration**: Replaced Google Custom Search Engine with the Tavily Search API. Features advanced depth and raw content extraction for vastly improved RAG and Company Research.
    - **Enhanced Company Dossiers**: Massively expanded the Premium Profile Intelligence UI. Now includes interview difficulty badges, a 5-star work culture grid with sub-dimensions, employee reviews with sentiment analysis, critics/complaints tracking, and core benefits pills.

    ### Improvements
    
    - **AI Language Strict Enforcement**: Rewrote the AI language enforcement pipeline. Native languages (Spanish, French, etc.) are now strongly prioritized over system prompt defaults using a triple-layer strict injection, guaranteeing the AI never incorrectly defaults back to English.
    - **Model Selection Accuracy**: Rewrote `LLMHelper` routing logic to guarantee your specifically selected cloud provider model (e.g., `gpt-4o`, `claude-3-5-sonnet`) is rigorously respected during vision fallbacks, multimodal processing, and streaming.
    - **Robust AI Fallbacks**: Added Gemini Flash and local Ollama models to the structured generation fallback chains, ensuring features like resume parsing work continuously even when primary models face rate limits or outages.
    - **Smoother Animations**: Mac window transitions now utilize zero-opacity pre-hiding to eliminate jarring animation flashes during rapid screenshot captures.
    
    ### Fixes
    
    - Fixed a bug where custom cURL endpoints and the "What to Say" auto-suggestion path would occasionally bypass the user's language preferences.
    - Fixed the OpenAI API validation ping by upgrading the deprecated connection test model to `gpt-4o-mini`.
    - Fixed UI sync issues where the AI response language dropdown could fall out of sync with the backend upon an IPC failure via a new optimistic playback system.
    - Removed unused dead user interface components and completely sanitized legacy template variables from core system prompts.

    ## [2.0.5] - 2026-03-15

    ### Improvements

    - **Stealth Mode UI**: The Process Disguise selector is now visually disabled and locked while Undetectable mode is active, preventing accidental state mismatches.
    - **State Synchronization**: Greatly improved internal state synchronization across all application windows (Settings, Launcher, Overlay).

    ### Fixes

    - **Infinite Feedback Loops**: Completely eliminated the bug where toggling Undetectable mode would sometimes cause the app to rapidly toggle itself on and off.
    - **Delayed Dock Reappearance**: Fixed a regression where the macOS dock icon would mysteriously reappear several seconds after entering stealth mode if a disguise had recently been changed.
    - **Initial State Loading**: Fixed an issue where the Settings UI would briefly show incorrect toggle states when first opened.
    - **macOS OS-level Events**: Hardened the app against macOS `activate` events (like clicking the app in Finder) accidentally breaking stealth mode.

    ### Technical

    - Refactored IPC (Inter-Process Communication) listeners for `SettingsPopup` and `SettingsOverlay` to use a strict one-way (receive-only) data binding pattern.
    - Added strict management and cancellation of `forceUpdate` timeouts during stealth mode transitions.
    - Added explicit type safety for the new getters in `electron.d.ts`.

    ## [2.0.4] - 2026-03-14

    ### Summary

    Version 2.0.4 introduces a massive architectural overhaul to the native audio pipeline, guaranteeing production-ready stability, true zero-allocation data transfer, and instantaneous STT responsiveness with WebRTC ML-based VAD.

    ### What's New

    - **Two-Stage Silence Processing**: Replaced basic RMS noise gating with a two-stage pipeline combining an adaptive RMS threshold and WebRTC Machine Learning VAD. Rejects typing, fan noise, and non-speech sounds before they bill STT APIs.
    - **Zero-Copy ABI Transfers**: Transitioned the `ThreadsafeFunction` bridging to direct `napi::Buffer` (Uint8Array) allocations, completely eliminating V8 garbage collection pressure during continuous capture.
    - **Sliding-Window RAG**: Implemented a 50-token semantic overlap in `SemanticChunker.ts` to prevent conversational context loss across chunk boundaries.

    ### Improvements

    - **Latency & Responsiveness Tuning**: Stripped redundant TS debouncing, slashed `MIN_BUFFER_BYTES`, and reduced native hangover, achieving a ~300ms reduction in end-to-end transcription latency. short utterances ("Yes", "Stop") no longer sit trapped in the buffer.
    - Removed floating-point division truncation for superior downsampling from 44.1kHz external microphones.

    ### Fixes

    - Fixed a critical bug where the native Rust monitor returned a hardcoded `16000Hz` while actually streaming 48kHz audio. Now syncs true hardware sample rates.
    - Resolved the "Input missing" silent crash bug on microphone restarts by properly recreating the CPAL stream.
    - Restored the 10s continuous speech backstop for REST APIs to prevent unbounded buffer growth.
    - Added missing `notifySpeechEnded()` properties and cleaned up dangerous type casts.

    ### Technical

    - Audio processing transitioned entirely to strict ABI memory bridging (`napi::Buffer`)
    - Re-architected native silence_suppression state machine around WebRTC VAD inputs.

    ## [2.0.3] - 2026-03-13

    ### What's New

    - **Dynamic AI Model Selection:** Replaced static model lists with dynamic dropdowns. Your preferred models synced from providers (like OpenAI, Anthropic, Google) now automatically appear across the entire app.
    - **Multimodal Resilience:** Added a "Smart Dynamic Fallback" using Groq Llama 4 Scout. If default vision models fail or get rate-limited during screen analysis, Natively instantly reroutes the image to ensure uninterrupted performance.
    - **Multiple Screenshot Support:** The Natively Interface can now handle and process multiple attached screenshots simultaneously instead of just one.
    - **Improved Settings UX:** API keys now auto-save after 5 seconds of inactivity, and selecting a preferred model immediately updates the rest of the application without requiring a page reload.

    ### Architecture & Fixes

    - **Better Embeddings:** Migrated from Gemini Embedding to a completely new and more robust embedding architecture.
    - **Claude Fixes:** Resolved max_tokens and context limits issues specific to Anthropic Claude interactions.
    - **DRY Refactoring:** Centralized model configuration strings across the codebase to ensure easier future updates.

    ## [2.0.2] - 2026-03-10

    ### Summary

    v2.0.2 focuses on fixing Windows system audio capture, improving RAG stability, and resolving critical Soniox STT configuration issues.

    ### What's New

    - Fully functional system audio capture for Windows
    - Introduced system for manual transcript finalization and interim/final bridging during recordings

    ### Improvements

    - Migrated to `app.getAppPath()` for reliable cross-platform resource discovery
    - Ensured `sqlite-vec` compatibility and fixed embedding queue management
    - Upgraded `@google/genai` and optimized embedding dimensionality for lower latency

    ### Fixes

    - Improved Soniox STT streaming reliability, manual flushing, and configuration persistence
    - Resolved application entry point and module resolution issues in production builds
    - Fixed transcript bridging for manual recording mode
    - Corrected stealth activation and window focus inconsistencies

    ### Technical

    - Dependency updates for `@google/genai`
    - Cleaned up native compiler warnings for Windows
    - Fixed module resolution for internal Electron paths

    ## [2.0.1] - 2026-03-06

    ### New Features

    - **Premium Profile Intelligence**: Job Description (JD) and Resume context awareness, company research, and negotiation assistance.
    - **Live Meeting RAG**: Instant intelligent retrieval of context directly during a live meeting using local vectors.
    - **Soniox Speech Provider**: Added support for ultra-fast and highly accurate streaming STT with Soniox.
    - **Multilingual Support**: Choose from various response languages, set speech recognition matching specific accents and dialects.

    ### Improvements & Fixes

    - Fixed numerous issues and merged 3 community pull requests to improve overall stability.

    ## [1.1.8] - 2026-02-23

    ### Summary

    Patch update addressing OpenAI GPT 5.x compatibility and increasing token output limits for all providers.

    ### What's New

    - Replaced deprecated `max_tokens` parameter with `max_completion_tokens` required by GPT 5.x models.
    - Increased max output tokens for OpenAI (GPT 5.2) and Claude (Sonnet 4.5) to 65,536.
    - Increased max output tokens for Groq (Llama 3.3 70B) to 32,768.

    ### Improvements

    - Improved response length capabilities across all text-generation AI models.
    - Updated connection test model to use `gpt-5.2-chat-latest` instead of the deprecated `gpt-3.5-turbo`.

    ### Fixes

    - Fixed 400 error when using OpenAI GPT 5.x models for text queries and toggle actions.

    ### Technical

    - Replaced `max_tokens` with `max_completion_tokens` in `LLMHelper.ts` and `ipcHandlers.ts`.

    ## [1.1.7] - 2026-02-20

    ### Summary

    Security hardening, memory optimization, and stability improvements for a more robust and reliable experience.

    ### What's New

    - API rate limiting to prevent 429 errors on free-tier plans (Gemini, Groq, OpenAI, Claude)
    - Cross-platform screenshot support (macOS, Linux, Windows)
    - Official website link added to the About section

    ### Improvements

    - Smarter transcript memory management with epoch summarization instead of hard truncation — no more losing early meeting context
    - API keys are now scrubbed from memory on app quit to minimize exposure window
    - Credentials manager now overwrites key data before disposal for enhanced security
    - Helper process renaming for improved stealth in Activity Monitor

    ### Fixes

    - Fixed V8/Electron entitlements crash on Intel Macs by including entitlements.mac.plist during ad-hoc signing
    - Fixed process disguise not applying correctly when undetectable mode is toggled on
    - Fixed usage array capping with dedicated helper method to prevent unbounded growth

    ### Technical

    - Added `RateLimiter` service (token bucket algorithm with configurable burst and refill rates)
    - Added `PRIVACY.md` and `SECURITY.md` policy documents
    - Refactored ad-hoc signing script with helper renaming and proper entitlements flow
    - Version bump to 1.1.7

    ## [1.1.6] - 2026-02-15

    ### New Features

    - **Speech Providers**: Added support for multiple speech providers including Google, Groq, OpenAI, Deepgram, ElevenLabs, Azure, and IBM Watson.
    - **Fast Response Mode**: Introduced ultra-fast text responses using Groq Llama 3.
    - **Local RAG & Memory**: Full offline vector retrieval for past meetings using SQLite.
    - **Custom Key Bindings**: Added ability to customize global shortcuts for easier control.
    - **Stealth Mode Improvements**: Enhanced disguise modes (Terminal, Settings, Activity Monitor) for better privacy.
    - **Markdown Support**: Improved Markdown rendering in the Usage section for better readability of AI responses.
    - **Image Processing**: Integrated `sharp` for optimized image handling and faster analysis.

    ### Improvements & Fixes

    - Fixed various UI bugs and focus stealing issues.
    - Improved application stability and performance.

    ## [1.1.5] - 2026-02-13

    ### Summary

    The Stealth & Intelligence Update: Enhances stealth capabilities, expands AI provider support, and improves local AI integration.

    ### What's New

    - **Native Speech Provider Support:** Added Deepgram, Groq, and OpenAI speech providers.
    - **Custom LLM Providers:** Connect to any OpenAI-compatible API including OpenRouter and DeepSeek.
    - **Smart Local AI:** Auto-detection of available Ollama models for local AI.
    - **Global Spotlight Search:** Toggle chat overlay with Cmd+K (macOS) and Ctrl+K (Windows/Linux).
    - **Masquerading Mode:** Appear as system processes like Terminal or Activity Monitor.
    - **Improved Stealth Mode:** Enhanced activation and window focus transitions.

    ### Improvements

    - **Natural Responses:** Updated system prompts for more concise and natural responses.
    - **Conversational Logic:** Reduced robotic preambles and unnecessary explanations.
    - **Performance:** Improved UI scaling and reduced speech-to-text latency.

    ### Fixes

    - No critical fixes reported in this release.

    ### Technical

    - Internal logic refinements for improved conversational flow.
    - Updater and background process stability improvements.

    #### macOS Installation (Unsigned Build)

    If you see "App is damaged":

    1. Move the app to your Applications folder.
    2. Open Terminal and run: `xattr -cr /Applications/Natively.app`

    ## [1.1.4] - 2026-02-12

    ### What's New in v1.1.4

    - **Custom LLM Providers:** Connect to any OpenAI-compatible API (OpenRouter, DeepSeek, commercial endpoints) simply by pasting a cURL command.
    - **Smart Local AI:** Enhanced Ollama integration that automatically detects and lists your available local models—no configuration required.
    - **Refined Human Persona:** Major updates to system prompts (`prompts.ts`) to ensure responses are concise, conversational, and indistinguishable from a real candidate.
    - **Anti-Chatbot Logic:** Specific negative constraints to prevent "AI-like" lectures, distinct "robot" preambles, and over-explanation.
    - **Global Spotlight Search:** Access AI chat instantly with `Cmd+K` / `Ctrl+K`.
    - **Masquerading (Undetectable Mode):** Stealth capability to disguise the app as common utility processes (Terminal, Activity Monitor) for discreet usage.
