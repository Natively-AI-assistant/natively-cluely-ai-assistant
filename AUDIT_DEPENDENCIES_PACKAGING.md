# Natively — Dependency, Build & Packaging Audit (Phase 8)

_Production-hardening audit, 2026-07-11._

## Fixed

### [P1 — FIXED] Vulnerable nested `prismjs`/`refractor` chain in a production rendering path

**Problem.** `npm audit` flagged a moderate-severity DOM Clobbering
vulnerability (CVSS 4.9, GHSA-x7hr-w5r2-h6wg) in `prismjs`. The top-level
`prismjs@1.30.0` was already patched, but a **nested, vulnerable** copy
(`prismjs@1.27.0`) was pulled in transitively via `react-syntax-highlighter@15.6.1`'s
own `refractor@3.6.0` dependency — and `react-syntax-highlighter` is directly
imported and used in 3 production rendering surfaces
(`NativelyInterface.tsx`, `MeetingChatOverlay.tsx`, `MeetingDetails.tsx`) to
render LLM/transcript-derived markdown code blocks. This is a real,
in-production risk surface, not a dev-only transitive dependency.

**Investigation.** `refractor@3.x` (any patch version) permanently pins
`prismjs: ~1.27.0` — there is no non-breaking fix within the `react-syntax-highlighter@15.x`
line (`npm audit`'s `fixAvailable: false` was accurate). `react-syntax-highlighter@16.x`
bumps to `refractor@^5.0.0`, which no longer bundles a legacy `prismjs`
dependency at all. This is a genuine major-version requirement.

Separately found `react-code-blocks` (`^0.1.6`) is a **completely unused**
direct dependency — zero import sites anywhere in the repo (confirmed via
full-tree grep) — that pulled in its own nested, independently-vulnerable
`react-syntax-highlighter@15.6.6 → refractor@3.6.0 → prismjs@1.27.0` copy.
Also found the direct `diff` (`^7.0.0`) dependency (flagged for a low-severity
ReDoS in `parsePatch`/`applyPatch`) has zero call sites anywhere in the
codebase.

**Fix.**
1. Upgraded `react-syntax-highlighter` `^15.6.1` → `16.1.1` (major bump).
   Before upgrading, verified ALL 44 language-grammar subpath imports used by
   `registerPrismLanguages.ts` (`react-syntax-highlighter/dist/esm/languages/prism/*`)
   plus the `prism-light` and `styles/prism` entry points used by the 3
   rendering components still exist under identical paths in the v16 tarball
   (downloaded and inspected directly, not assumed).
2. Removed the unused `react-code-blocks` dependency entirely (also trims
   ~16KB gzipped from the `markdown-vendor` bundle).
3. Removed the unused `diff` dependency entirely.
4. Cleaned up `vite.config.mts`'s `manualChunks` config to drop the two
   removed package names (dead config referencing removed packages).

**Verification (not just "builds clean"):**
- `npm audit`: **7 vulnerabilities → 2** (both remaining are the dev-server-only
  vite/esbuild chain — see below, confirmed unreachable in production).
- `npm ls prismjs`: only one copy remains, `prismjs@1.30.0` (patched), owned
  directly by `react-syntax-highlighter@16.1.1`.
- `npm run build` (runs `tsc` then `vite build`): clean, no type errors, no
  missing-module errors.
- **Real render verification**: built a standalone harness importing the
  exact same `registerPrismLanguages()` + `SyntaxHighlighter` +
  `prism-light`/`styles/prism` subpaths the app uses, served it via the real
  Vite dev server, and drove it with Playwright. Result: zero page errors,
  zero console errors, both a JavaScript and a Python code block rendered
  with real syntax-color token spans (12 and 8 respectively) and correct
  theme styling (VS Code Dark Plus / One Light) — confirmed visually via
  screenshot, not just DOM presence.

### [P1 — FIXED] `electron-builder` `files` had no explicit `.env`/log/PDF exclusion

Already fixed in Phase 4 (`AUDIT_PRIVACY_SECRETS_LOGGING.md`) — recorded here
for packaging-audit completeness. Added `!**/.env`, `!**/.env.*`, `!**/*.log`,
`!**/*.pdf`, `!**/.git` to `package.json` `build.files`. Verified
`electron-builder.signed.cjs` inherits this via `{ ...base }`, so both the
dev and signed/production build paths are covered.

## Verified — not fixed, documented as accepted/out-of-scope

### [Accepted] Vite/esbuild dev-server vulnerabilities (moderate + high)

`npm audit` flags `vite@5.4.21`'s bundled `esbuild` for a dev-server request
CVE, plus 3 vite-specific dev-server CVEs (`server.fs.deny` bypass, path
traversal in optimized-deps `.map` handling, a Windows-only launch-editor NTLM
hash disclosure). The fix requires a major bump to `vite@8.x`.

**Verified unreachable in production**: `electron/WindowHelper.ts:16`
computes `isDev = isEnvDev && !isPackaged` — a packaged app **always** loads
`file://.../dist/index.html` (the pre-built static output), never
`http://localhost:5180` (the dev server). These CVEs require an actively
running `vite dev` server reachable by a hostile website; that only exists on
a developer's own machine while running `npm run dev`, never in a shipped
build. Given the major-version risk (Vite 5→8, config/plugin compatibility)
for a class of bug with zero production reach, this is left as an accepted
risk rather than a rushed major bump — flagging for a dedicated follow-up
when there's time to properly regression-test the dev toolchain.

### [Accepted] `ensure-sqlite-vec.js` shell-string interpolation in `execSync`

Uses `execSync` with template-string interpolation (shell:true) for `npm
pack`/`tar` calls. Verified every interpolated value (`pkg`, `SQLITE_VEC_VERSION`,
`tmpDir`, `pkgDir`, `tarPath`) is a compile-time constant or an OS-provided
path (`os.tmpdir()` + `path.join`) — never attacker- or user-controlled. No
real injection vector exists today; rewriting to `execFileSync` would be
cosmetic churn with no risk reduction, which the audit brief explicitly
discourages.

### [Accepted, recommend follow-up] No integrity/checksum verification on HuggingFace model downloads

`scripts/download-models.js` downloads ~280MB of ONNX model weights via
`@huggingface/transformers`'s `pipeline()` with no SHA-pinning or
post-download hash verification. Downloads are HTTPS (TLS-authenticated to
the HuggingFace CDN), so the realistic threat model is narrow (a compromised
HF account/CDN, not a generic MITM) — but a proper fix (pin expected SHA256
per model file, verify post-download, fail closed on mismatch) is a
meaningful feature addition, not a quick patch, and `pipeline()` doesn't
expose a straightforward hash-pinning hook. Recommending as a dedicated
follow-up rather than attempting under audit time constraints.

### [Verified correct — no fix needed] `dotenv` is not a production dependency despite being imported outside test files

`electron/main.ts:46` and `electron/ProcessingHelper.ts:10` both `require('dotenv').config()`
— but both call sites are gated behind `if (!app.isPackaged)`. Confirmed
`dotenv` never loads in a packaged build; `devDependencies` placement is
correct.

### [Verified — inherent to electron-updater's GitHub provider] No stage-2 update signature verification

`electron-updater`'s GitHub provider validates the downloaded artifact's
sha512 against `latest.yml` (served over HTTPS) but performs no additional
cryptographic signature check beyond that. This is inherent to the provider,
not a code bug in this app — `autoUpdater.autoDownload = false` already
requires user-initiated download, and macOS builds are additionally
Developer-ID-signed + notarized (verified in Phase 0). A custom signature-pinning
layer on top of electron-updater would be new infrastructure, not a fix;
documented here as a known, accepted property of the update mechanism.

## Postinstall / supply-chain surface (unchanged, reviewed)

The `postinstall` chain (`patch-package` → sharp rebuild → native-module
rebuild → HuggingFace model download → sqlite-vec ensure → plist patch →
arch verify) was reviewed for injection/tamper risk — no new findings beyond
what Phase 0 already surfaced. `patch-package`'s two patches
(`better-sqlite3+12.11.1.patch`, `keytar+7.9.0.patch`) correctly re-inject the
preinstall arch-verification gate on every fresh `npm install`.
