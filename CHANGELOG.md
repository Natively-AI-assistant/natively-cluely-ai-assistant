# Changelog

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
## [2.0.1] - 2026-03-06

### New Features

- **Premium Profile Intelligence**: Job Description (JD) and Resume context awareness, company research, and negotiation assistance.
- **Live Meeting RAG**: Instant intelligent retrieval of context directly during a live meeting using local vectors.
- **Soniox Speech Provider**: Added support for ultra-fast and highly accurate streaming STT with Soniox.
- **Multilingual Support**: Choose from various response languages, set speech recognition matching specific accents and dialects.

### Improvements & Fixes

- Fixed numerous issues and merged 3 community pull requests to improve overall stability.

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
