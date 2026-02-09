<div align="center">
  <img src="assets/icon.png" width="150" alt="Natively Logo">

  # Natively – Open Source Cluely Alternative

  ![License](https://img.shields.io/badge/license-AGPL--3.0-blue)
  ![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)
  ![GitHub all releases](https://img.shields.io/github/downloads/evinjohnn/natively-cluely-ai-assistant/total)
  ![Repo Views](https://img.shields.io/badge/views-12k-lightgrey)
  ![Status](https://img.shields.io/badge/status-active-success)
  [![Stars](https://img.shields.io/github/stars/evinjohnn/natively-cluely-ai-assistant?style=flat)](https://github.com/evinjohnn/natively-cluely-ai-assistant)



 </div>

---
> Natively is a **free, open-source, privacy-first AI assistant** designed to help you **in real time during meetings, interviews, presentations, and conversations**.


Unlike traditional AI tools that work *after* the conversation, Natively works **while the conversation is happening**. It runs as an **invisible, always-on-top desktop overlay**, listens when you want it to, sees what’s on your screen, and delivers **instant, context-aware assistance**.

Natively is fully transparent, customizable, and gives you complete control over **local vs cloud AI**, your data, and your credentials.

---

## Demo

![Natively Demo](demo.gif)

This demo shows **a complete live meeting scenario**:
- Real-time transcription as the meeting happens  
- Rolling context awareness across multiple speakers  
- Screenshot analysis of shared slides  
- Instant generation of what to say next  
- Follow-up questions and concise responses  
- All happening live, without recording or post-processing  

---

## Quick Start (End Users)

Download the latest prebuilt version from **[Releases](https://github.com/evinjohnn/natively-cluely-ai-assistant/releases)**.

### [Windows (v1.1.3)](https://github.com/evinjohnn/natively-cluely-ai-assistant/releases/tag/v1.1.2)
### [macOS (v1.1.3)](https://github.com/evinjohnn/natively-cluely-ai-assistant/releases/tag/v1.1.3)

No build steps required.

### What's New in v1.1.3
- **Smarter AI Fallback:** The system now intelligently rotates through all configured providers (Gemini, OpenAI, Claude, Groq) to ensure you always get an answer.
- **Improved Reliability:** Added a relentless retry mechanism with exponential backoff—if one provider fails, Natively automatically tries the next.
- **Better Response Quality:** Optimized prompts and message formatting for OpenAI and Claude to ensure higher quality, more consistent responses.
- **Multimodal Upgrades:** Enhanced handling for image-based queries with improved stability.
- **Reduced Latency:** Optimized token streaming for faster real-time responses.

---


## Table of Contents

- [What Is Natively?](#what-is-natively)
- [Key Capabilities](#key-capabilities)
- [Privacy & Security](#privacy--security-core-design-principle)
- [Quick Start (End Users)](#quick-start-end-users)
- [Installation (Developers)](#installation-developers--contributors)
- [AI Providers](#ai-providers)
- [Key Features](#key-features)
- [Use Cases](#use-cases)
- [Comparison](#comparison)
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

## Key Capabilities

- Live answers during meetings and interviews
- Rolling context memory (understands what was just said)
- Screenshot and screen content analysis
- Real-time transcription
- Context-aware replies and follow-ups
- Global keyboard shortcuts across all applications
- Local AI support for offline and private use

> **Note:** Real-time transcription requires a Google Speech-to-Text service account. This is a hard dependency.

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

### AI Credentials
- Google Gemini API Key
- Google Cloud Service Account (required for speech-to-text)

---

## Bring Your Own Google Speech-to-Text (Required)

**Important:**  
Natively relies on **Google Speech-to-Text** for real-time transcription.  
Without a valid Google Service Account, transcription will not function.

Your credentials:
- Never leave your machine
- Are not logged, proxied, or stored remotely
- Are used only locally by the app

### What You Need
- Google Cloud account
- Billing enabled
- Speech-to-Text API enabled
- Service Account JSON key

### Setup Summary
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
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json

# Local AI (Ollama)
USE_OLLAMA=true
OLLAMA_MODEL=llama3.2
OLLAMA_URL=http://localhost:11434
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

## AI Providers

### Ollama (Local / Offline)
- Fully private
- No API costs
- Works offline
- Recommended for privacy

### Google Gemini
- Multimodal (text + vision)
- Fast and accurate
- Requires internet and API key

### Groq
- Extremely fast inference
- Text-only in this implementation

---

## Key Features

### Invisible Desktop Assistant
- Always-on-top translucent overlay
- Instantly hide/show with shortcuts
- Works across all applications

### Live Meeting Intelligence
- Real-time speech-to-text
- Rolling context memory
- Instant answers as questions are asked
- Smart recap and summaries

### Screenshot & Screen Analysis
- Capture any screen content
- Analyze slides, documents, code, or problems
- Immediate explanations and solutions

### Contextual Actions
- What should I answer?
- Shorten response
- Recap conversation
- Suggest follow-up questions
- Manual or voice-triggered prompts

### Native Audio Performance
- Rust-based audio capture
- Low latency
- System audio support

---

## Use Cases

### Academic & Learning
- Live class assistance
- Concept explanations
- Language translation
- Problem solving

### Professional Meetings
- Interview support
- Sales calls
- Client presentations
- Real-time clarification

### Development & Technical Work
- Code explanation
- Debugging assistance
- Architecture guidance
- Documentation lookup

---

## Comparison

| Feature | Natively | Commercial Tools | Other OSS |
| :--- | :--- | :--- | :--- |
| **Price** | **Free** | Paid | Free |
| **Open Source** | **Yes** | No | Partial |
| **Local AI** | **Yes** | No | Limited |
| **Privacy-First** | **Yes** | No | Depends |
| **Real-Time Focus** | **Yes** | Partial | Rare |
| **Rolling Context** | **Yes** | Limited | No |
| **Screenshot Analysis** | **Yes** | Limited | Rare |
| **Always-On-Top UI** | **Yes** | No | No |

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
- **Gemini 3.0** (Flash / Pro)
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

- Requires Google Speech-to-Text for live transcription
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

**⭐ Star this repo if Natively helps you succeed in meetings, interviews, or presentations!**

### 🏷️ Tags
`ai-assistant` `meeting-notes` `interview-helper` `presentation-support` `ollama` `gemini-ai` `electron-app` `cross-platform` `privacy-focused` `open-source` `local-ai` `screenshot-analysis` `academic-helper` `sales-assistant` `coding-companion` `cluely` `cluely alternative` `interview coder` `final round ai` `claude skills` `moltbot`
