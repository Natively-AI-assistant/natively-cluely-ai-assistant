# iPhone Project Defence Copilot

This module is an independently implemented companion PWA for project demonstrations, defences, and accessibility prompting. It does not unlock or copy the paid Phone Link or Reference Files product. It deliberately does not implement hidden recording, capture evasion, or access to audio from other iOS apps.

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

Open `http://127.0.0.1:4317/admin` on the computer, index a project, and create a one-time pairing code. To let a phone connect on a trusted LAN, set `DEFENCE_HOST=0.0.0.0`, restart, and use the displayed private-network address.

On iPhone, open the address in Safari, enter the pairing ID and six-digit code, choose languages/depth/search policy, then press **Start listening**. The microphone indicator remains visible and capture only starts after an explicit tap. Raw audio is not saved.

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
iPhone microphone -> browser/STT provider -> stable transcript
  -> question detector -> local hybrid retrieval -> evidence gate
  -> optional LLM structured answer -> authenticated WebSocket -> iPhone cards
```

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

## Known limitations

- Live cloud-provider validation needs real user keys and was not asserted by automated tests.
- HTTPS certificates and public DNS are not provisioned by this repository.
- PPTX extraction reads visible slide text; speaker notes and scanned images need OCR or manual export.
- The local fallback is grounded but less fluent than an LLM. Bilingual alternate answers require an LLM.
- Browser speech APIs and MediaRecorder formats vary by iOS release; the UI reports actionable permission/provider errors.

## License

The parent repository uses the Natively Personal Use Source License v1.0. It permits personal, educational, research, and non-commercial modification and local running. Public forks must retain that license and attribution; commercial use and relicensing require written permission. This module is a modification in that repository, so it has the same distribution constraints.
