# Natively — Privacy, Secrets & Logging Audit (Phase 4)

_Production-hardening audit, 2026-07-11._

> **Reconstruction note**: rebuilt after a shared-workspace branch switch lost
> the original working-tree file (see `AUDIT_VERIFICATION_REPORT.md`). Content
> matches the original; both cited fixes were independently re-verified
> present in the final working tree before this file was rewritten.

Scope: every place sensitive data (transcripts, resumes/JD, API keys, license
data, provider credentials) is stored, logged, sent, cached, or exposed.

## Baseline (verified — already well-hardened, no fix needed)

The codebase has an unusually disciplined logging posture for a vibe-coded app:

- **`electron/utils/redactForLog.ts`** — centralized redactor wired into a
  global `console.log/warn/error` monkeypatch (`main.ts`). Every line written
  to `~/Documents/natively_debug.log` goes through `redactArgsForLog()`:
  sensitive keys are `[REDACTED]`/`[REMOVED]`, credential-shaped substrings
  (Bearer, sk-, gsk_, AIza, JWT triples, `natively_sk_…`) are scrubbed from
  free text, every string value capped at 120 chars. (Terminal echo is
  intentionally NOT redacted — a local dev terminal isn't a persistence sink.)
- **Crash reports** (`writeProcessReport`) explicitly strip
  `environmentVariables` from Node's `process.report`, and **deletes** the
  file rather than shipping it unredacted if the strip itself fails.
- **`electron/llm/piTelemetry.ts`** — Profile Intelligence telemetry is
  marker-only by design (`scrubTelemetry()` drops any field whose key/value
  looks like content), gated behind `NATIVELY_PI_TELEMETRY_DEBUG` for console
  echo.
- **`src/lib/analytics/analytics.service.ts`** — every GA4 event is
  marker-only (event name + short enum/duration fields); no transcript/resume/
  answer content in any `trackX()` call.
- **`electron/services/CredentialsManager.ts`** — API keys/trial tokens via
  OS keyring with AES-256 fallback; salt + blob files at `0600`.
- **`.env.example`** contains only placeholder values.
- Spot-checked LLM/RAG/IntelligenceEngine/knowledge-service call sites — no
  direct content logging found. Existing debug lines log only
  lengths/marker fields, never raw content.

## Fixed

### [P3 — FIXED] Redaction regex didn't cover generic answer/content field names

**Problem.** `SENSITIVE_KEY_RE` covered `transcript`, `prompt`, `reference*`,
etc., but not bare `answer`, `content`, `text`, `output`, `aiResponse`. No
current call site actually logs an object with those keys (verified by
repo-wide search) — not an active leak, but exactly the shape of field an
LLM-heavy codebase adds later.

**Fix.** Extended `SENSITIVE_KEY_RE` in `redactForLog.ts` to also match
`answer`, exact `content`/`text`/`output`, `ai[_-]?response`,
`full[_-]?answer`, `full[_-]?prompt`, `full[_-]?text` — while leaving
substring-adjacent safe keys (`contentType`, `textColor`, `outputPath`,
`modelId`) untouched.

**Test:** extended `electron/services/__tests__/RedactForLog.test.mjs` — 7/7
pass in that file.

### [P1 — FIXED] Packaged app had no explicit exclude for `.env` / logs / PDFs

**Problem.** `package.json` `build.files` is a **whitelist** (`dist`,
`dist-electron`, `native-module`, `package.json`, `node_modules`), so a stray
root-level secret file wasn't packaged today — but there was no explicit,
documented exclusion, meaning a future build-tool change that copies extra
files into `dist`/`dist-electron` could silently start shipping
`.env`/`*.log`/`*.pdf` inside `app.asar`.

**Fix.** Added explicit excludes: `!**/.env`, `!**/.env.*`, `!**/*.log`,
`!**/*.pdf`, `!**/.git`. Verified `electron-builder.signed.cjs` inherits this
array via `{ ...base }`, so the fix applies to both the dev and
signed/production build paths. Did **not** exclude `*.map` — no evidence the
team doesn't use them for crash symbolication.

## Noted (ops, not a code fix)

- `~/Documents/natively_debug.log` has no explicit file-mode restriction
  (relies on OS default umask under the user's own home directory). Low
  severity given write-time redaction is solid — not prioritized.
- `natively-api/.env` (backend submodule) holds live production secrets
  locally but is git-ignored and not in history (confirmed in Phase 3).
