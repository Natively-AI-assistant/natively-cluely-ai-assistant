<div align="center">
  <img src="assets/icon.png" width="150" alt="Natively AI Assistant Logo">

  # Natively – Open Source AI Meeting Assistant & Cluely Alternative

  [![License](https://img.shields.io/badge/License-AGPL--3.0-blue?style=flat-square)](LICENSE)
  [![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-lightgrey?style=flat-square)](https://github.com/evinjohnn/natively-cluely-ai-assistant/releases)
  [![Downloads](https://img.shields.io/github/downloads/evinjohnn/natively-cluely-ai-assistant/total?style=flat-square&color=success)](https://github.com/evinjohnn/natively-cluely-ai-assistant/releases)
  ![Repo Views](https://img.shields.io/badge/Views-19.4k-lightgrey?style=flat-square)
  [![Stars](https://img.shields.io/github/stars/evinjohnn/natively-cluely-ai-assistant?style=flat-square)](https://github.com/evinjohnn/natively-cluely-ai-assistant)
  ![Status](https://img.shields.io/badge/Status-active-success?style=flat-square)
 

</div>

---

<div align="center">

> **Natively** is a **free, privacy-first AI Copilot** for **Google Meet, Zoom, and Teams**. It serves as an open-source alternative to Cluely, providing **real-time transcription**, **interview assistance**, and **automated meeting notes** completely locally.

Unlike cloud-only tools, Natively uses **Local RAG (Retrieval Augmented Generation)** to remember past conversations, giving you instant answers during **technical interviews**, **sales calls**, and **daily standups**.

</div>

---

## Why Natively?

While other tools focus on being "lightweight" wrappers, Natively is a complete intelligence system.

- **Local Vector Database (RAG):** We embed your meetings locally so you can ask, "What did John say about the API last week?"
- **Rich Dashboard:** A full UI to manage, search, and export your history—not just a floating window.
- **Rolling Context:** We don't just transcribe; we maintain a "memory window" of the conversation for smarter answers.

---

<div align="center">

[![Portfolio](https://img.shields.io/badge/Portfolio-evinjohn.vercel.app-blueviolet?style=flat-square&logo=vercel&logoColor=white)](https://evinjohn.vercel.app/)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Connect-0077B5?style=flat-square&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/evinjohn/)
[![X](https://img.shields.io/badge/X-@evinjohnn-black?style=flat-square&logo=x&logoColor=white)](https://x.com/evinjohnn)
[![Hire Me](https://img.shields.io/badge/Hire_Me-Contact-success?style=flat-square&logo=gmail&logoColor=white)](mailto:evinjohnn@gmail.com?subject=Natively%20-%20Hiring%20Inquiry)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-FFDD00?style=flat-square&logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/evinjohn)

</div>

## Demo

![Natively AI Assistant Demo - Real-time Interview Helper and Transcription](assets/natively-ai-meeting-assistant-demo.gif)

This demo shows **a complete live meeting scenario**:
- Real-time transcription as the meeting happens  
- Rolling context awareness across multiple speakers  
- Screenshot analysis of shared slides  
- Instant generation of what to say next  
- Follow-up questions and concise responses  
- All happening live, without recording or post-processing  

---

<div align="center">

### Download Natively
*The privacy-first AI assistant for meetings.*

[![Website](https://img.shields.io/badge/Website-nativelyai.vercel.app-blue?style=flat-square&logo=google-chrome&logoColor=white))
[![Download for macOS](https://img.shields.io/badge/Download_for-macOS-white?style=for-the-badge&logo=apple&logoColor=black)](https://github.com/evinjohnn/natively-cluely-ai-assistant/releases/latest)
[![Download for Windows](https://img.shields.io/badge/Download_for-Windows-0078D4?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/evinjohnn/natively-cluely-ai-assistant/releases/latest)

<small>Requires macOS 12+ or Windows 10/11</small>
</div>

> [!NOTE]
> **macOS Users:**
> 
> 1.  **"Unidentified Developer"**: If you see this, Right-click the app > Select **Open** > Click **Open**.
> 2.  **"App is Damaged"**: If you see this (common with DMGs), run this in Terminal:
>     ```bash
>     xattr -cr /Applications/Natively.app
>     ```
>     *(Or point to wherever you installed the app)*

### What's New in v1.1.6
- **Expanded Speech Providers:** First-class support for **Google, Groq, OpenAI, Deepgram, ElevenLabs, Azure, and IBM Watson**.
- **Custom Key Bindings:** Fully customizable global shortcuts for window actions.
- **Stealth Mode 2.0:** Enhanced masquerading (Terminal, Activity Monitor) and "undetectable" dock mode.
- **Markdown Rendering:** Improved formatting and code highlighting in the Usage View.
- **Performance:** Optimized image analysis with `sharp` and lower latency interactions.
- **Models:** Support for **Gemini 3**, **GPT-5.2**, **Groq Llama 3.3**, **Claude 4.5** or any other LLM provider.

---


## Table of Contents

- [Why Natively?](#why-natively)
- [Privacy & Security](#privacy--security-core-design-principle)
- [Quick Start (End Users)](#quick-start-end-users)
- [Installation (Developers)](#installation-developers--contributors)
- [AI Providers](#ai-providers)
- [Key Features](#key-features)
- [Meeting Intelligence Dashboard](#meeting-intelligence-dashboard)
- [Use Cases](#use-cases)
- [Comparison](#comparison)
- [FAQ](#faq)
- [Architecture Overview](#architecture-overview)
- [Technical Details](#technical-details)
- [Known Limitations](#known-limitations)
- [Responsible Use](#responsible-use)
- [Contributing](#contributing)
- [License](#license)

---

## What Is Natively?

**Natively** is a **desktop AI assistant for live situations**:
- Meetings
- Interviews
- Presentations
- Classes
- Professional conversations

It provides:
- Live answers
- Rolling conversational context
- Screenshot and document understanding
- Real-time speech-to-text
- Instant suggestions for what to say next

All while remaining **invisible, fast, and privacy-first**.

---

## Privacy & Security (Core Design Principle)

- 100% open source (AGPL-3.0)
- Bring Your Own Keys (BYOK)
- Local AI option (Ollama)
- All data stored locally
- No telemetry
- No tracking
- No hidden uploads

You explicitly control:
- What runs locally
- What uses cloud AI
- Which providers are enabled

---

## Installation (Developers & Contributors)

### Prerequisites
- Node.js (v20+ recommended)
- Git
- Rust (required for native audio capture)

### AI Credentials & Speech Providers

**Natively is 100% free to use with your own keys.**  
Connect **any** speech provider and **any** LLM. No subscriptions, no markups, no hidden fees. All keys are stored locally.

### Unlimited Free Transcription (Whisper, Google, Deepgram)
- **Google Cloud Speech-to-Text** (Service Account)
- **Groq** (API Key)
- **OpenAI Whisper** (API Key)
- **Deepgram** (API Key)
- **ElevenLabs** (API Key)
- **Azure Speech Services** (API Key + Region)
- **IBM Watson** (API Key + Region)

### AI Engine Support (Bring Your Own Key)
Connect Natively to **any** leading model or local inference engine.

| Provider | Best For |
| :--- | :--- |
| **Gemini 3 Pro/Flash** | Recommended: Massive context window (2M tokens) & low cost. |
| **OpenAI (GPT-5.2)** | High reasoning capabilities. |
| **Anthropic (Claude 4.5)** | Coding & complex nuanced tasks. |
| **Groq / Llama 3** | insane speed (near-instant answers). |
| **Ollama / LocalAI** | 100% Offline & Private (No API keys needed). |
| **OpenAI-Compatible** | Connect to *any* custom endpoint (vLLM, LM Studio, etc.) |

> **Note:** You only need ONE speech provider to get started. We recommend **Google STT** ,**Groq** or **Deepgram** for the fastest real-time performance.  

---
#### To Use Google Speech-to-Text (Optional)

Your credentials:
- Never leave your machine
- Are not logged, proxied, or stored remotely
- Are used only locally by the app

What You Need:
- Google Cloud account
- Billing enabled
- Speech-to-Text API enabled
- Service Account JSON key

Setup Summary:
1. Create or select a Google Cloud project  
2. Enable Speech-to-Text API  
3. Create a Service Account  
4. Assign role: `roles/speech.client`  
5. Generate and download a JSON key  
6. Point Natively to the JSON file in settings 

---

## Development Setup

### Clone the Repository
```bash
git clone https://github.com/evinjohnn/natively-cluely-ai-assistant.git
cd natively-cluely-ai-assistant
```

### Install Dependencies
```bash
npm install
```

### Environment Variables
Create a `.env` file:

```env
# Cloud AI
GEMINI_API_KEY=your_key
GROQ_API_KEY=your_key
OPENAI_API_KEY=your_key
CLAUDE_API_KEY=your_key
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json

# Speech Providers (Optional - only one needed)
DEEPGRAM_API_KEY=your_key
ELEVENLABS_API_KEY=your_key
AZURE_SPEECH_KEY=your_key
AZURE_SPEECH_REGION=eastus
IBM_WATSON_API_KEY=your_key
IBM_WATSON_REGION=us-south

# Local AI (Ollama)
USE_OLLAMA=true
OLLAMA_MODEL=llama3.2
OLLAMA_URL=http://localhost:11434

# Default Model Configuration
DEFAULT_MODEL=gemini-3-flash-preview
```

### Run (Development)
```bash
npm start
```

### Build (Production)
```bash
npm run dist
```

---

### AI Providers
- **Custom (BYO Endpoint):** Paste any cURL command to use OpenRouter, DeepSeek, or private endpoints.
- **Ollama (Local):** Zero-setup detection of local models (Llama 3, Mistral, Gemma).
- **Google Gemini:** First-class support for Gemini 3.0 Pro/Flash.
- **OpenAI:** GPT-5.2 support with optimized system prompts.
- **Anthropic:** Claude 4.5 Sonnet support for complex reasoning.
- **Groq:** Ultra-fast inference with Llama 3 models.

---

## Key Features

### Invisible Desktop Assistant
- Always-on-top translucent overlay
- Instantly hide/show with shortcuts
- Works across all applications

### Real-time Interview Copilot & Coding Help
- Real-time speech-to-text
- Context-aware Memory (RAG) for Past Meetings
- Instant answers as questions are asked
- Smart recap and summaries

### Instant Screen & Slide Analysis (OCR)
- Capture any screen content
- Analyze slides, documents, code, or problems
- Immediate explanations and solutions

### Contextual Actions
- What should I answer?
- Shorten response
- Recap conversation
- Suggest follow-up questions
- Manual or voice-triggered prompts

### Dual-Channel Audio Intelligence
Natively understands that *listening* to a meeting and *talking* to an AI are different tasks. We treat them separately:

- **System Audio (The Meeting):** Captures high-fidelity audio directly from your OS (Zoom, Teams, Meet). It "hears" what your colleagues are saying without interference from your room noise.
- **Microphone Input (Your Voice):** A dedicated channel for your voice commands and dictation. Toggle it instantly to ask Natively a private question without muting your meeting software.

### Spotlight Search & Calendar
- Global activation shortcut
- Instant answer overlay
- Upcoming meeting readiness

### Local RAG & Long-Term Memory
- **Full Offline RAG:** All vector embeddings and retrieval happen locally (SQLite).
- **Semantic Search:** innovative "Smart Scope" detects if you are asking about the current meeting or a past one.
- **Global Knowledge:** Ask questions across *all* your past meetings ("What did we decide about the API last month?").
- **Automatic Indexing:** Meetings are automatically chunked, embedded, and indexed in the background.

### Advanced Privacy & Stealth
- **Undetectable Mode:** Instantly hide from dock/taskbar.
- **Masquerading:** Disguise process names and window titles as harmless system utilities.
- **Local-Only Processing:** All data stays on your machine.

---

## Meeting Intelligence Dashboard
Natively includes a powerful, local-first meeting management system to review, search, and manage your entire conversation history.

![Dashboard Preview](assets/dashboard-preview.png)

- **Meeting Archives:** Access full transcripts of every past meeting, searchable by keywords or dates.
- **Smart Export:** One-click export of transcripts and AI summaries to **Markdown, JSON, or Text**—perfect for pasting into Notion, Obsidian, or Slack.
- **Usage Statistics:** Track your token usage and API costs in real-time. Know exactly how much you are spending on Gemini, OpenAI, or Claude.
- **Audio Separation:** Distinct controls for **System Audio** (what they say) vs. **Microphone** (what you dictate).
- **Session Management:** Rename, organize, or delete past sessions to keep your workspace clean.

---

## Use Cases

### Academic & Learning
- **Live Assistance:** Get explanations for complex lecture topics in real-time.
- **Translation:** Instant language translation during international classes.
- **Problem Solving:** Immediate help with coding or mathematical problems.

### Professional Meetings
- **Interview Support:** Context-aware prompts to help you navigate technical questions.
- **Sales & Client Calls:** Real-time clarification of technical specs or previous discussion points.
- **Meeting Summaries:** Automatically extract action items and core decisions.

### Development & Technical Work
- **Code Insight:** Explain unfamiliar blocks of code or logic on your screen.
- **Debugging:** Context-aware assistance for resolving logs or terminal errors.
- **Architecture:** Guidance on system design and integration patterns.

---

## Comparison

**Natively is built on a simple promise: Any speech provider, any API key, 100% free to use, and universally compatible.**

| Feature | Natively | Commercial Tools (Cluely, etc.) | Other OSS |
| :--- | :--- | :--- | :--- |
| **Price** | **Free (BYOK)** | $20 - $50 / month | Free |
| **Speech Providers** | **Any (Google, Groq, Deepgram, etc.)** | Locked to Vendor | Limited |
| **LLM Choice** | **Any (Local or Cloud)** | Locked to Vendor | Limited |
| **Privacy** | **Local-First & Private** | Data stored on servers | Depends |
| **Latency** | **Real-Time (<500ms)** | Variable | Often Slow |
| **Universal Mode** | **Works over ANY app** | often limited to browser | No |
| **Meeting History** | **Full Dashboard & Search** | Limited | None |
| **Data Export** | **JSON / Markdown / Text** | Proprietary Format | None |
| **Audio Channels** | **Dual (System + Mic)** | Single Stream | Single Stream |
| **Screenshot Analysis** | **Yes (Native)** | Limited | Rare |
| **Stealth Mode** | **Yes (Undetectable)** | No | No |

---

## Architecture Overview

Natively processes audio, screen context, and user input locally, maintains a rolling context window, and sends only the required prompt data to the selected AI provider (local or cloud).

No raw audio, screenshots, or transcripts are stored or transmitted unless explicitly enabled by the user. 

---

## Technical Details

### Tech Stack
- **React, Vite, TypeScript, TailwindCSS**
- **Electron**
- **Rust** (native audio)
- **SQLite** (local storage)

### Supported Models
- **Gemini 3** (Flash / Pro)
- **OpenAI** (GPT-5.2)
- **Claude** (Sonnet 4.5)
- **Ollama** (Llama, Mistral, CodeLlama)
- **Groq** (Llama, Mixtral)

### System Requirements
- **Minimum:** 4GB RAM
- **Recommended:** 8GB+ RAM
- **Optimal:** 16GB+ RAM for local AI

---

## Responsible Use

Natively is intended for:
- Learning
- Productivity
- Accessibility
- Professional assistance

Users are responsible for complying with:
- Workplace policies
- Academic rules
- Local laws and regulations

This project does not encourage misuse or deception.

---

## Known Limitations
- Linux support is limited and looking for maintainers

---

## Contributing

Contributions are welcome:
- Bug fixes
- Feature improvements
- Documentation
- UI/UX enhancements
- New AI integrations

Quality pull requests will be reviewed and merged.

---

## License

Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).

If you run or modify this software over a network, you must provide the full source code under the same license.

> **Note:** This project is available for sponsorships, ads, or partnerships – perfect for companies in the AI, productivity, or developer tools space.

---

**Star this repo if Natively helps you succeed in meetings, interviews, or presentations!**

---

---

## FAQ

#### Is Natively really free?
Yes. Natively is an open-source project. You only pay for what you use by bringing your own API keys (Gemini, OpenAI, Anthropic, etc.), or use it **100% free** by connecting to a local Ollama instance.

#### Does Natively work with Zoom, Teams, and Google Meet?
Yes. Natively uses a Rust-based system audio capture that works universally across any desktop application, including Zoom, Microsoft Teams, Google Meet, Slack, and Discord.

#### Is my data safe?
Natively is built on **Privacy-by-Design**. All transcripts, vector embeddings (Local RAG), and keys are stored locally on your machine. We have no backend and collect zero telemetry.

#### Can I use it for technical interviews?
Natively is a powerful assistant for any professional situation. However, users are responsible for complying with their company policies and interview guidelines.

#### How do I use local models?
Simply install **Ollama**, run a model (e.g., `ollama run llama3`), and Natively will automatically detect it. Enable "Ollama" in the AI Providers settings to switch to offline mode.

---

### Tags
`ai-assistant` `meeting-notes` `interview-helper` `presentation-support` `ollama` `gemini-ai` `electron-app` `cross-platform` `privacy-focused` `open-source` `local-ai` `screenshot-analysis` `academic-helper` `sales-assistant` `coding-companion` `cluely` `cluely alternative` `interview coder` `final round ai` `claude skills` `moltbot`

---

## Star History

<a href="https://star-history.com/#evinjohnn/natively-cluely-ai-assistant&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=evinjohnn/natively-cluely-ai-assistant&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=evinjohnn/natively-cluely-ai-assistant&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=evinjohnn/natively-cluely-ai-assistant&type=Date" />
 </picture>
</a>
