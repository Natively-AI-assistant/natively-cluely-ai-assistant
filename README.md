# Natively ·   1000+ Downloads


Natively - The invisible desktop assistant that provides real-time insights, answers, and support during meetings, interviews, presentations, and professional conversations.

## 🎬 Demo

![Natively Demo](demo.gif)

## 🚀 Quick Start Guide
**For Personal Use:**
Download the latest version from [Releases](https://github.com/evinjohnn/natively-cluely-ai-assistant/releases)

### Prerequisites (For Development)
- **Node.js**: Installed on your computer (v20+ recommended)
- **Git**: Installed on your computer
- **Rust**: Required for building the native audio capture module

- **AI Credentials**:
  - **Gemini API Key**: Get it from [Google AI Studio](https://makersuite.google.com/app/apikey)
  - **Google Service Account**: Required for real-time speech-to-text accuracy.
### Bring Your Own Google Speech-to-Text (BYOK)

**CRITICAL: Google Service Account is REQUIRED for transcription.**
Natively relies on Google Speech-to-Text for real-time transcription. Without a valid Google Service Account, the application's core transcription features will NOT function.

You must provide your own Google Cloud Service Account JSON key.
**Your credentials never leave your machine and are used only locally.** We do not proxy, log, upload, or store your keys — ever.

#### Why BYOK?
- You control billing & quotas
- No shared keys, no rate limits
- No hidden usage or tracking
- Works offline (except for Google STT calls)

#### What You Need
- A Google Cloud account
- Billing enabled
- A Service Account with Speech-to-Text access
- A JSON key file

#### Create a Google STT Service Account

**1. Create / Select a Google Cloud Project**
- Go to [Google Cloud Console](https://console.cloud.google.com/)
- Create a new project or select an existing one
- Enable billing

**2. Enable Speech-to-Text API**
- Go to **APIs & Services** -> **Library**
- Search for and enable **Cloud Speech-to-Text API**

**3. Create a Service Account**
- Go to **IAM & Admin** -> **Service Accounts** -> **Create Service Account**
- Name: `natively-stt` (or similar)
- Description: Optional

**4. Assign Permission**
- Add this specific role: **Speech-to-Text User** (`roles/speech.client`)
- *Do NOT use Owner or Editor roles unless testing*

**5. Create a JSON Key**
- Open the newly created service account
- Go to **Keys** -> **Add Key** -> **Create new key**
- Choose **JSON**
- Download the file and save it safely.
- **Action**: Set the Service Account location in the Natively settings to this file.

#### How to Claim the $300 Credit

1. Go to [cloud.google.com](https://cloud.google.com)
2. Click "Get started for free"
3. Sign in with a Google account
4. Enter billing details (card required for verification)
5. Accept the free trial
6. You will instantly receive $300 credit valid for 90 days

### Installation Steps

1. Clone the repository:
```bash
git clone https://github.com/evinjohnn/natively-cluely-ai-assistant.git
cd natively-cluely-ai-assistant
```

2. Install dependencies:
```bash
npm install
# Note: This automatically builds the Rust native audio module
```

3. Set up environment variables:
   - Create a file named `.env` in the root folder
   
   **For Gemini (Cloud AI) & Speech-to-Text:**
   ```env
   GEMINI_API_KEY=your_api_key_here
   GROQ_API_KEY=your_groq_key_here
   GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/your-service-account.json
   ```
   
   **For Ollama (Local/Private AI):**
   ```env
   USE_OLLAMA=true
   OLLAMA_MODEL=llama3.2
   OLLAMA_URL=http://localhost:11434
   ```
   
   - Save the file

### Running the App

#### Method 1: Development Mode (Recommended for first run)
1. Start the development server:
```bash
npm start
```

This command automatically:
- Starts the Vite dev server on port 5180
- Waits for the server to be ready
- Launches the Electron app

#### Method 2: Production Build
```bash
npm run dist
```
The built app will be in the `release` folder.

## 🤖 AI Provider Options

### Ollama (Recommended for Privacy)
**Pros:**
- 100% private - data never leaves your computer
- No API costs
- Works offline
- Supports many models: `llama3.2`, `codellama`, `mistral`, etc.

**Setup:**
1. Install Ollama from [ollama.ai](https://ollama.ai)
2. Pull a model: `ollama pull llama3.2`
3. Set environment variables as shown above

### Google Gemini
**Pros:**
- Latest AI technology (Gemini 3.0 Flash/Pro)
- Fast responses
- Best accuracy for complex tasks and multimodal analysis

**Cons:**
- Requires API key and internet
- Data sent to Google servers
- Usage costs may apply (though free tier is generous)

### Groq
**Pros:**
- Super fast inference
- Free tier available

**Cons:**
- No multimodal (vision) responses via Groq directly in this implementation context (usually text-only)

## ⚠️ Important Notes

1. **Closing the App**: 
   - Press `Cmd + Q` (Mac) or `Ctrl + Q` (Windows/Linux) to quit
   - Or use Activity Monitor/Task Manager to close `Natively`
   - The X button currently doesn't work (known issue)

2. **If the app doesn't start**:
   - Make sure no other app is using port 5180
   - Try killing existing processes:
     ```bash
     # Find processes using port 5180
     lsof -i :5180
     # Kill them (replace [PID] with the process ID)
     kill [PID]
     ```
   - For Ollama users: Make sure Ollama is running (`ollama serve`)

3. **Keyboard Shortcuts**:
   - `Cmd/Ctrl + B`: Toggle window visibility
   - `Cmd/Ctrl + H`: Take screenshot (Smart Analysis)
   - `Cmd/Ctrl + Shift + H`: Take selective screenshot
   - `Cmd + Enter`: Get solution / Send message
   - `Cmd/Ctrl + Arrow Keys`: Move window

#### General Installation Issues
If you see other errors:
1. Delete the `node_modules` folder
2. Delete `package-lock.json` 
3. Run `npm install` again
4. Try running with `npm start`

### Platform-Specific Notes
- **Windows**: Looking for maintainers
- **Ubuntu/Linux**: Looking for maintainers
- **macOS**: Native support with proper window management

## Key Features

### **Invisible AI Assistant**
- Translucent, always-on-top window that's barely noticeable
- Hide/show instantly with global hotkeys
- Works seamlessly across all applications

### **Smart Screenshot Analysis** 
- Take screenshots of any content with `Cmd/Ctrl + H`
- AI analyzes images, documents, presentations, or problems
- Get instant explanations, answers, and solutions

### **Audio Intelligence**
- **Native Rust Module**: High-performance, low-latency audio capture
- Process audio files and recordings
- Real-time transcription and analysis
- Perfect for meeting notes and content review

### **Contextual Chat**
- Chat with AI about anything you see on screen
- Maintains conversation context
- Ask follow-up questions for deeper insights

### **Interface Features (Quick Actions)**
Control your interactions instantly with 5 powerful tools:
- **✏️ What to answer?**: Instantly generates a context-aware response to the current topic.
- **💬 Shorten**: Refines the last suggested answer to be more concise and natural.
- **🔄 Recap**: Generates a comprehensive summary of the conversation so far.
- **❓ Follow Up Question**: Suggests strategic questions you can ask to drive the conversation.
- **⚡ Answer**: Manually trigger a response or use voice input to ask specific questions.

### **Live Meeting Intelligence**
- **🧠 Rolling Context Window**: Maintains a smart, sliding window of conversation history. This allows the AI to "remember" what was just said, enabling instant, highly relevant answers as soon as a question is asked.
- **Rolling Transcript**: View real-time speech-to-text as the meeting progresses.
- **Smart Note Taking**: Automatically captures key points and summaries (via Recap).
- **Usage Tracking**: Monitor your interaction history and AI usage.

### **Privacy-First Design**
- **Local AI Option**: Use Ollama for 100% private processing
- **Cloud Option**: Google Gemini for maximum performance
- **Data Control**: All data stored locally in SQLite
- No data tracking or storage on external servers (unless using Cloud AI)

## Use Cases

### **Academic & Learning**
```
✓ Live presentation support during classes
✓ Quick research during online exams  
✓ Language translation and explanations
✓ Math and science problem solving
```

### **Professional Meetings**
```
✓ Sales call preparation and objection handling
✓ Technical interview coaching
✓ Client presentation support
✓ Real-time fact-checking and data lookup
```

### **Development & Tech**
```
✓ Debug error messages instantly
✓ Code explanation and optimization
✓ Documentation and API references
✓ Algorithm and architecture guidance
```

## Why Choose Natively?

| Feature | Natively | Commercial Alternatives |
|---------|-------------|------------------------|
| **Cost** | 100% Free | $29-99/month |
| **Privacy** | Local AI Option | Cloud-only |
| **Open Source** | Full transparency | Closed source |
| **Customization** | Fully customizable | Limited options |
| **Data Control** | You own your data | Third-party servers |
| **Offline Mode** | Yes (with Ollama) | No |

## Technical Details

### **Tech Stack**
- **Frontend**: [React](https://react.dev/), [Vite](https://vitejs.dev/), [TypeScript](https://www.typescriptlang.org/), [TailwindCSS](https://tailwindcss.com/)
- **Backend/Desktop**: [Electron](https://www.electronjs.org/)
- **Native Performance**: **Rust** (via N-API) for system audio capture
- **Database**: [Better-SQLite3](https://github.com/WiseLibs/better-sqlite3) for local storage
- **State Management**: React Query

### **AI Models Supported**
- **Google Gemini**: `gemini-3-flash-preview` (Fast, Multimodal), `gemini-3-pro-preview` (Reasoning)
- **Ollama (Local)**: `llama3.2`, `mistral`, `codellama`, etc.
- **Groq**: High-speed inference for open models (Llama 3, Mixtral)

### **System Requirements**
```bash
Minimum:  4GB RAM, Dual-core CPU, 2GB storage
Recommended: 8GB+ RAM, Quad-core CPU, 5GB+ storage
Optimal: 16GB+ RAM (Apple Silicon M1/M2/M3) for local AI models
```

## 🤝 Contributing

This project welcomes contributions! While I have limited time for active maintenance, I'll review and merge quality PRs.

**Ways to contribute:**
- 🐛 Bug fixes and stability improvements
- ✨ New features and AI model integrations  
- 📚 Documentation and tutorial improvements
- 🌍 Translations and internationalization
- 🎨 UI/UX enhancements

For commercial integrations or custom development, reach out.

## 📄 License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).

If you use, modify, or run this software as a service over a network,
you must make the complete source code available under the same license.

---

**⭐ Star this repo if Natively helps you succeed in meetings, interviews, or presentations!**

### 🏷️ Tags
`ai-assistant` `meeting-notes` `interview-helper` `presentation-support` `ollama` `gemini-ai` `electron-app` `cross-platform` `privacy-focused` `open-source` `local-ai` `screenshot-analysis` `academic-helper` `sales-assistant` `coding-companion`
