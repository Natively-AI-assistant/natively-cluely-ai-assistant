# 问答小助手

问答小助手识别 Windows 电脑语音，使用可定制的本地项目知识库生成精简的中英文回答，并通过安全 WSS 将结果显示在手机浏览器中。手机端是只读提词器，不请求麦克风权限；原始音频默认不保存。

This module is independently implemented. It does not unlock or copy the paid Phone Link or Reference Files product. It deliberately does not implement hidden recording, capture evasion, or access to audio from other iOS apps.

## What works without an API key

- Incremental indexing of Git-visible source files and project documents.
- PDF, DOCX, PPTX, Markdown, text, JSON/YAML, CSV, configuration, and common source-code formats.
- Secret, binary, build-output, ignored-file, symlink, and oversized-file exclusion.
- Local hybrid keyword/vector retrieval, evidence paths and real line ranges, question-boundary detection, duplicate suppression, pairing, and the iPhone PWA.
- A conservative extractive answer. When project evidence is absent, the response explicitly says so.

STT, natural answer synthesis, and external search are independent optional capabilities. A missing key disables only that capability. Translation is performed by the configured LLM; there is no translation API.

## Start

```powershell
Copy-Item .env.example .env
# Fill PROJECT_SOURCE_PATH. Add provider keys only for capabilities you need.
npm.cmd run defence:start
```

Open `http://127.0.0.1:4317/admin` on the computer, index a project, select a Windows input source, and create a one-time pairing code. The production default remains `INPUT_MODE=specific-process-loopback`, `DUAL_SOURCE_ENABLED=false`, and `IPHONE_OUTPUT_ONLY=true`; the phone does not request microphone permission. The dual-source framework is feature-gated until both real inputs pass validation.

On iPhone, open the address in Safari and pair. In the default mode it is a read-only display for live transcript, current question, transcript/question source, fast hint, full answer, and project evidence. The Companion can switch among `remote-interview`, `in-person-defence`, and `hybrid`; it still never opens the iPhone microphone in output-only mode. Set `INPUT_MODE` to `specific-process-loopback`, `system-loopback`, or `windows-microphone` for a single Windows source, and to `iphone-microphone` only for the existing fallback. Raw audio is not saved.

## HTTPS on iPhone

Safari microphone capture requires a secure context. `localhost` is trusted only on the computer, not when an iPhone opens a private IP. Put the service behind a TLS reverse proxy whose certificate is trusted by the iPhone, then use HTTPS/WSS. Example Caddy configuration:

```text
defence.example.test {
  reverse_proxy 127.0.0.1:4317
}
```

Use a private DNS name and a certificate trusted on the device. Do not expose the HTTP service directly to the public internet. The service has one-time pairing, hashed session tokens, request/payload limits, same-origin delivery, WebSocket authentication, loopback-only index management, and no wildcard CORS; TLS remains the deployment operator's responsibility.

### Windows trusted development certificate

One supported local path is [`mkcert`](https://github.com/FiloSottile/mkcert). Install it separately, create a development CA, and generate a certificate containing the computer's private DNS name and LAN IP. Store all generated files outside the repository (or under ignored `.defence-certs/`). Configure:

```dotenv
DEFENCE_HOST=0.0.0.0
DEFENCE_TLS_ENABLED=true
DEFENCE_TLS_CERT_PATH=C:\private\defence-cert.pem
DEFENCE_TLS_KEY_PATH=C:\private\defence-key.pem
```

The iPhone must trust the same development CA through Settings → General → VPN & Device Management and Certificate Trust Settings. A publicly trusted HTTPS reverse proxy is preferable when available. Never commit the CA or private key. Run `npm.cmd run defence:doctor` before scanning the pairing QR; it checks readability and certificate SAN coverage without printing secrets.

The admin HTML and project-management APIs default to loopback-only (`DEFENCE_ADMIN_LOCAL_ONLY=true`). The QR carries a 192-bit, single-use, hashed-at-rest pairing secret; the six-digit code is a rate-limited fallback. Companion sessions receive only relative evidence paths and relevant excerpts, never full project files.

## Providers

- STT: an OpenAI-compatible transcription endpoint such as Groq Whisper (`STT_*`). Browser speech recognition is used when Safari exposes it.
- LLM: an OpenAI-compatible endpoint, DeepSeek-compatible endpoint, or local Ollama compatibility endpoint (`LLM_*`).
- Search: Tavily-compatible search (`SEARCH_*`). `off` never calls it; `auto` calls it only for current external questions with no project evidence; project-internal questions return no-evidence instead.
- Embedding: the initial implementation uses a local Unicode token-vector plus lexical hybrid ranker and needs no API.

API keys are read only by the backend. They are never returned by `/api/health`, sent to the PWA, or written to the project index.

## Data flow

```text
Windows process loopback ----> independent WASAPI capture/VAD --\
Windows microphone ---------> independent WASAPI capture/VAD ----> SourceArbiter -> Groq STT
  -> CBA retrieval -> fast_hint -> DeepSeek full_answer
  -> authenticated WSS -> read-only iPhone Companion
```

`specific-process-loopback` uses Windows WASAPI application loopback and includes the selected process tree. It never falls back silently to system loopback, so unrelated notification sounds are not accepted in process-only mode. `dual-process-and-microphone` keeps process loopback and microphone PCM, clocks, VAD state, lifecycle, and errors separate; PCM is not mixed at the WASAPI layer. `SourceArbiter` gives the process stream priority, suppresses overlapping microphone echo by timestamp and energy fingerprint before STT, then applies transcript similarity as a second guard. `auto` prefers Teams, Zoom, Chrome, and Edge. This module does not read Windows Live Captions and contains no caption-window scraping, OCR, clipboard capture, or UI Automation path.

The local segmenter uses 20 ms PCM frames, a configurable minimum speech duration, 500–800 ms end silence, short-pause merging, a maximum utterance length, and recent-audio digest suppression. Partial STT results only prewarm retrieval. Only a finalized question can trigger generation, and an automatic question key can trigger the LLM at most once. The first push is `fast_hint` (keywords, structure, early evidence); `full_answer` follows with the complete spoken answer and evidence.

The index stores file hashes and chunk metadata under `PROJECT_INDEX_PATH`. Unchanged files are retained, changed files are replaced, deleted files are removed, and a full rebuild is available from the admin page. Evidence sent to the phone is limited to answer-relevant excerpts.

Index accounting uses mutually exclusive file-object metrics. `discoveredTotal = excludedTotal + eligibleTotal`, while `eligibleTotal = indexedNew + indexedUpdated + skippedUnchanged + failedTotal`. `directoryCount` is reported separately and is not part of `discoveredTotal`; excluded directories such as `.git` and `node_modules` are not recursively enumerated.

## Live validation commands

```powershell
npm.cmd run defence:doctor
npm.cmd run defence:provider-smoke
npm.cmd run defence:index-smoke
npm.cmd run defence:retrieval-eval
npm.cmd run defence:audio-fixture-test
```

Provider smoke returns `BLOCKED_MISSING_PROVIDER_CONFIG` when STT or LLM configuration is absent. That is distinct from implementation-test failure. The PWA's folded diagnostic panel generates a sanitized real-device report without keys, tokens, absolute server paths, or raw audio.

## CBA project-defence knowledge pack

The CBA pack is project-specific and does not change the generic iPhone, HTTPS, STT, LLM, Search, pairing, question-detection, or answer-schema layers. By default it reads `E:\Project cba` and writes only to `.defence-data/projects/cba-import-candidate-ranking`. The source repository is treated as read-only: indexing compares its Git status before and after and fails if it changes.

```powershell
npm.cmd run defence:cba-index
npm.cmd run defence:cba-eval
npm.cmd run defence:cba-answer-smoke
```

Override the source only when necessary with `CBA_PROJECT_SOURCE_PATH`. `PROJECT_ID`, `PROJECT_DISPLAY_NAME`, and `PROJECTS_CONFIG_PATH` control the registered-project identity and registry location. The generated registry lets the loopback-only admin page switch the active source/index to the CBA project without copying source files.

The pack produces a source manifest, verified-fact ledger, persona, 17 defence knowledge cards, retrieval cases/results, and bilingual answer-smoke results. The 42,127-row core CSV is profiled once as a structured summary; its raw rows are never inserted into the retrieval vector index. Large generated CSV outputs, raw/external data, build environments, Git metadata, draft extracts, and other noisy or sensitive paths are excluded.

Verified facts use `VERIFIED`, `CONFLICTING`, or `NOT_FOUND`. Production answers may quote only verified metrics and must describe the system as Top-K candidate ranking and scouting-shortlist decision support, never as a deterministic signing predictor. Experimental learning-to-rank results remain separate from the stable rule-based baseline, and missing private-market variables are stated as limitations.

## Known limitations

- Live cloud-provider validation needs real user keys and was not asserted by automated tests.
- HTTPS certificates and public DNS are not provisioned by this repository.
- PPTX extraction reads visible slide text; speaker notes and scanned images need OCR or manual export.
- The local fallback is grounded but less fluent than an LLM. Bilingual alternate answers require an LLM.
- The iPhone MediaRecorder path remains a fallback and varies by iOS release; Windows input is the default.

## License

The parent repository uses the Natively Personal Use Source License v1.0. It permits personal, educational, research, and non-commercial modification and local running. Public forks must retain that license and attribution; commercial use and relicensing require written permission. This module is a modification in that repository, so it has the same distribution constraints.
