# CBA iPhone live validation

This runbook validates the final chain without exposing the admin listener or placing secrets in Git. Never paste API keys into Codex, chat, screenshots, or diagnostic reports.

## A. Obtain keys

Create a Groq API key with access to `whisper-large-v3-turbo` and a DeepSeek API key with access to `deepseek-v4-flash`. Search remains disabled.

## B. Configure `.env`

Copy `.env.example` to the ignored `.env`, then set:

```dotenv
PROJECT_ID=cba-import-candidate-ranking
PROJECT_DISPLAY_NAME=Ranking Potential CBA Import Candidates Using Public Player Season Data from Multiple Leagues
PROJECT_SOURCE_PATH=E:/Project cba
PROJECT_INDEX_PATH=E:/code/interview/.defence-data/projects/cba-import-candidate-ranking
PROJECTS_CONFIG_PATH=.defence-data/projects.json
RETRIEVAL_TOP_K=6

STT_PROVIDER=openai-compatible
STT_BASE_URL=https://api.groq.com/openai/v1
STT_API_KEY=<set locally>
STT_MODEL=whisper-large-v3-turbo
STT_LANGUAGE=auto

LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=<set locally>
LLM_MODEL=deepseek-v4-flash
LLM_THINKING=false

SEARCH_PROVIDER=none
STORE_AUDIO=false
DEFENCE_HOST=127.0.0.1
DEFENCE_PORT=4317
DEFENCE_PUBLIC_MODE=companion-only
DEFENCE_COMPANION_HOST=127.0.0.1
DEFENCE_COMPANION_PORT=4318
DEFENCE_COMPANION_PUBLIC_URL=https://<trusted-companion-host>
```

Keep `.env`, certificates and private keys outside Git. `STT_LANGUAGE=auto` deliberately omits the Provider language field so mixed Chinese/English audio is not forced into one language.

## C. Run Provider smoke

Record three short real speech fixtures and store them under the ignored `real-audio-fixtures` directory with `zh`, `en`, and `mixed` in their filenames, or set `CBA_STT_ZH_FIXTURE`, `CBA_STT_EN_FIXTURE`, and `CBA_STT_MIXED_FIXTURE` to local files. Supported formats include M4A/MP4, WebM, OGG and WAV.

```powershell
npm.cmd run defence:provider-smoke
npm.cmd run defence:cba-live-provider-smoke
```

The CBA command tests three STT recordings and three grounded LLM questions. Reports under `provider-smoke-output` contain only timings, status, request IDs and validation booleans—not audio, transcripts, full answers, keys, tokens or absolute CBA paths. Missing keys return `BLOCKED_MISSING_LIVE_PROVIDER_CONFIG`.

## D. Start admin

```powershell
npm.cmd run defence:doctor
npm.cmd run defence:start
```

Open `http://127.0.0.1:4317/admin` on the computer. Select the CBA project and confirm the index is available. Port 4317 is the local admin listener and must never be forwarded to a tunnel.

## E. Start companion-only listener

`defence:start` starts `127.0.0.1:4318` automatically when `DEFENCE_PUBLIC_MODE=companion-only`. This listener serves only the Companion PWA, pairing verification and authenticated defence session/audio/WebSocket routes. `/admin`, indexing, project/source manifests and Provider configuration routes return 404.

## F. Configure trusted HTTPS

Terminate trusted TLS at a reverse proxy or tunnel that forwards **only** to `127.0.0.1:4318`. Example Caddy configuration:

```text
defence.example.test {
  reverse_proxy 127.0.0.1:4318
}
```

The certificate must be trusted by the iPhone and cover the hostname. Set the exact public origin in `DEFENCE_COMPANION_PUBLIC_URL`. Do not proxy port 4317. Re-run `defence:doctor`; verify companion-only mode, `adminNotExposed=true`, an HTTPS companion URL, `STORE_AUDIO=false`, and retrieval Top-K of at least 3.

## G. Pair the iPhone

From the local admin page, generate a new one-time QR code and scan it in iPhone Safari. Confirm the page uses HTTPS, the socket becomes WSS, and the old QR cannot be reused after pairing.

## H. Ask the three real-device questions

Tap **Start listening** yourself, grant microphone permission, and ask:

1. `这个项目是在预测某位球员一定会加盟 CBA 吗？`
2. `How do you prove that the shortlist is more useful than random selection?`
3. `你的 learning-to-rank 和 baseline ranking 有什么区别？`

Check Chinese/English/mixed transcription, one generation per question, at least three retrieved candidates, real relative evidence paths, VERIFIED metrics, correct baseline-versus-experimental status, and no deterministic signing claim. Repeat one question to confirm duplicate suppression.

## I. Export the sanitized report

Stop listening, open **真机诊断与测试向导**, run the checks, then choose **下载脱敏报告**. The browser downloads `cba-iphone-live-validation-<timestamp>.json`. Inspect it before sharing: it must not contain keys, tokens, pairing secrets, raw audio, transcripts, full answers, source code, or `E:\Project cba`.

## J. Stop and revoke access

Use **取消配对**, clear transcript/history, stop `defence:start`, and stop the reverse proxy/tunnel. Confirm ports 4317/4318 are no longer listening. Revoke or rotate temporary Provider keys if they were created only for validation, and delete local fixture/report files when no longer needed.
