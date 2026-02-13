# Changelog

## [1.1.5] - 2026-02-13

### The Stealth & Intelligence Update
Focusing on versatility, local AI integration, and discreet usage.

#### New Features
- **Expanded Speech Providers:** Native support for Deepgram, Groq, and OpenAI.
- **Custom LLM Providers:** Connect to any OpenAI-compatible API (OpenRouter, DeepSeek) using cURL.
- **Smart Local AI:** Auto-detection of available Ollama models.
- **Global Spotlight Search:** Toggle chat overlay with Cmd+K (macOS) or Ctrl+K (Windows/Linux).
- **Masquerading:** Disguise as system processes like Terminal or Activity Monitor.
- **Stealth Mode:** Improved activation and window focus transitions.

#### Improvements
- **Refined Persona:** System prompts updated for concise, human-like responses.
- **Logic Updates:** Reduced robotic preambles and over-explanations.
- **Performance:** Better UI scaling and reduced STT latency.

#### macOS Installation (Unsigned Build)
If you see "Unidentified Developer":
1. Right-click the app and select **Open**.
2. Click **Open** again in the dialog.

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
