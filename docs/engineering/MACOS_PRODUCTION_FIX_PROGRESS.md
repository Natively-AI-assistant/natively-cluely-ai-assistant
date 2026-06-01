# macOS Production Fix — Restart-Safe Progress Tracker

**Purpose:** If a Claude Code session hits a limit, crashes, or stops, ANOTHER session must be able to resume safely from this file alone. Updated after every phase/sub-phase.

> **⚠️ SIGNING/NOTARIZATION SUPERSEDED (2026-05-30): NOW LIVE.** The "pending Apple Developer Program / wired-but-unverified / opt-in" signing language below is HISTORICAL. As of 2026-05-30, Natively v2.7.0 is **really signed (Developer ID) + notarized + stapled** on both arches (apps + DMGs + ZIPs all `spctl` "accepted / Notarized Developer ID"). Entitlements moved to `build/`; notarization uses an App Store Connect **API key**; app via `afterSign` (`scripts/notarize.js`), DMGs rebuilt via `create-dmg` (`scripts/afterAllArtifactBuild.cjs`). **`apple-signing-report.md` (repo root) is the authoritative signing record.**

**Last updated:** 2026-05-29 (Phase 0 complete, Phase 1 starting)
**Branch:** main (NO PR — direct edits per instructions)
**App version:** 2.6.0 (signing work below later completed against 2.7.0)

---

## RESUME PROMPT (paste this to continue)

> Continue the macOS production-readiness autopilot for Natively. Read `docs/engineering/MACOS_PRODUCTION_FIX_PROGRESS.md` and `docs/engineering/MACOS_PRODUCTION_READINESS_AUDIT.md` first. Work in strict priority order (P0 premium/API, P0 signing/notarization, P0 toggle/visibility, P0 audio, P1 startup/window, P2 telemetry, P2 tests). Confirm each bug before fixing, add a regression test, run targeted + surrounding tests, run code-reviewer + test-engineer agents per phase, then update all three docs (this tracker, the audit, and root `fixreport.md`). Do not weaken premium gating, do not log secrets, do not break Windows/Linux, no magic sleeps. Pick up at the "NEXT RECOMMENDED STEP" below.

---

## Global guardrails (do not violate)
- No PR. Direct edits to working tree.
- Do NOT weaken premium/license/security checks to ease UX or tests.
- Do NOT log API keys, license keys, tokens, transcripts, screen text, or audio content.
- Do NOT break Windows/Linux code paths (preserve `process.platform` guards).
- No arbitrary `sleep`/magic delays; use deterministic state machines, locks, queues, timeouts, cancellation.
- Confirm a bug (test/log/trace/repro) before fixing.
- Cannot run full `electron-builder` packaging or real notarization locally (no Apple Developer cert / network upload). Validate structurally + document exact commands.

---

## Build / test commands (verified to exist in package.json)
- Electron transpile: `npm run build:electron` (esbuild, fast)
- Electron typecheck: `npm run typecheck:electron`
- Unit tests: `npm test` (builds electron, runs node --test over services/llm/audio `__tests__`)
- Modes tests: `npm run test:modes`
- E2E (Playwright): `npm run test:e2e` / `:parity`
- Full mac build (needs cert/network): `npm run app:build`

---

## PHASE 0 — Repo scan + docs  ✅ COMPLETE (2026-05-29)

**Inspected:** repo tree, `package.json` build block, `assets/entitlements.mac.plist`, `scripts/{ad-hoc-sign,build-electron,patch-electron-plist}.js`, `electron/premium/featureGate.ts`, `src/premium/index.tsx`, `.gitmodules`, premium submodule file listing, `natively-api`/`natively` top-level.

**Confirmed (facts, not yet fixed):**
- Signing gaps S1–S7 (see audit §2.1). Most critical: `hardenedRuntime: false`, `identity: null`, ad-hoc afterPack, no notarize hook.
- Premium is a git submodule with clean optional-load pattern (require-probe + Vite glob, null fallbacks).
- `premium/electron/services/LicenseManager.ts` is the license core; `premium/electron/knowledge/*` are paid engines.
- `natively-api/` is the Railway backend (authoritative license/plan source).

**Fixed:** none (scan phase).
**Files changed:** created this tracker, the audit doc, and `fixreport.md`.
**Tests added/run:** none.
**Remaining risks:** none for scan.

---

## PHASE 1 — Signing / Notarization / Entitlements  ✅ COMPLETE (reviewed)

### Phase 1 REVIEW OUTCOME + REDESIGN (2026-05-29)
Senior code-reviewer (opus, cross-checked vendored `app-builder-lib` source) found a **CRITICAL**: removing `identity: null` makes electron-builder's arm64 ad-hoc fallback (`macPackager.js:215,249`) sign the bundle itself on the DEFAULT path → fragile double-sign + a footgun where stray Apple env vars fail a plain `npm run dist`. **All findings fixed by redesign:**
- **`package.json` reverted to byte-identical original** (`identity: null`, `hardenedRuntime: false`, no top-level `afterSign`, `app:build` unchanged). Verified via `node -e` that default path == original. → fixes CRITICAL + HIGH + "afterSign fires on dev" MEDIUM.
- **NEW `electron-builder.signed.cjs`** — opt-in production config used ONLY by `app:build:signed`/`dist:signed` via `--config`. Spreads `package.json.build`; overrides mac: `hardenedRuntime:true`, `entitlements`, `entitlementsInherit:assets/entitlements.mac.inherit.plist`, `gatekeeperAssess:false`, `notarize:false`, `identity` from env (undefined→auto-discover). Sets `process.env.NATIVELY_PRODUCTION_SIGN=1`.
- **NEW `assets/entitlements.mac.inherit.plist`** — minimal helper entitlements (JIT/unsigned-mem/disable-library-validation/dyld-env only; no mic/screen/apple-events) per MEDIUM finding.
- **`scripts/notarize.js`** — api-key strategy now requires only `APPLE_API_KEY`+`APPLE_API_KEY_ID`, forwards `APPLE_API_ISSUER` only if present (fixes Individual-key 401 MEDIUM).
- **`scripts/ad-hoc-sign.js`** — guard now also stands down on `NATIVELY_PRODUCTION_SIGN==='1'` (covers keychain-only auto-discovery, LOW finding).

GO/NO-GO: default dev build is **provably unchanged**; signed path is structurally sound (live notarization still requires Apple cert — external blocker).

### Original Phase 1 plan/impl notes (superseded by redesign above where they conflict)

**Plan:**
1. Add `scripts/notarize.js` (afterSign) that no-ops without `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` (or `APPLE_API_KEY`) → dev builds unaffected; production notarizes + staples.
2. Make `ad-hoc-sign.js` run ONLY when no real Developer ID identity is present (so it never clobbers a proper signature). Detect via env (`CSC_LINK`/`CSC_NAME`/`NATIVELY_SIGN_IDENTITY`).
3. Update `package.json` `build.mac`: env-driven identity, `hardenedRuntime` true for prod (gated), `gatekeeperAssess: false`, wire `afterSign`, keep ad-hoc dev fallback. Entitlements unchanged unless notarization needs more.
4. Decision flagged for user: appId `com.electron.meeting-notes` → professional id (TCC-reset + backend implications — DO NOT auto-change without confirming backend keying).
5. Produce: post-Apple-Developer-Program checklist + exact verify commands (codesign, spctl, stapler).

**Implemented (2026-05-29):**
- **NEW `scripts/notarize.js`** — electron-builder `afterSign` hook. No-ops on non-mac, when `NATIVELY_SKIP_NOTARIZE=1`, or when no Apple credentials in env. Supports 3 credential strategies (API key / Apple ID+app-pw / keychain profile). Uses `@electron/notarize@3.1.1` `notarize({appPath, ...creds})` which submits via notarytool AND staples. Never logs secrets. Throws on real failure (no silent skip of a release).
- **`scripts/ad-hoc-sign.js`** — added guard: when `CSC_LINK`/`CSC_NAME`/`NATIVELY_SIGN_IDENTITY` present, skip the ad-hoc `codesign --sign -` (so it never clobbers a real Developer ID signature); helper-plist disguise still runs in all paths. Added opt-in `NATIVELY_ADHOC_HARDENED=1` to add `--options runtime` for local hardened-runtime testing (default OFF = unchanged dev behavior).
- **`package.json`** — added top-level `afterSign: ./scripts/notarize.js`; in `build.mac`: removed `identity: null`, set `hardenedRuntime: true`, added `gatekeeperAssess: false`, `entitlements`/`entitlementsInherit: assets/entitlements.mac.plist`, `notarize: false`. Default `app:build` now runs `cross-env CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder` (preserves exact ad-hoc dev behavior). Added `app:build:signed` + `dist:signed` for the production path.
- **NEW `docs/engineering/MACOS_SIGNING_NOTARIZATION_CHECKLIST.md`** — operator steps, exact build + verify (codesign/spctl/stapler) commands, appId decision, post-notarization xattr cleanup.

**Confirmed (facts):** S1–S4 were real blockers (hardenedRuntime false, identity null, ad-hoc afterPack, no notarize hook). Now wired.

**Files changed:** `package.json`, `scripts/ad-hoc-sign.js`, `scripts/notarize.js` (new), `docs/engineering/MACOS_SIGNING_NOTARIZATION_CHECKLIST.md` (new).

**Tests added:** none yet (build-config; cannot unit-test electron-builder packaging locally). Validation done: `node -e require('./package.json')` parses; `node --check` on both scripts passes; `@electron/notarize` v3 API confirmed against installed `lib/types.d.ts`.

**Tests that could NOT be run + why:** full `electron-builder` packaging and real notarization — needs Apple Developer cert + network upload (hard external dependency). Documented in checklist.

**Remaining risks:**
- Cannot verify electron-builder runtime behavior of `CSC_IDENTITY_AUTO_DISCOVERY=false` + omitted `identity` on THIS machine without a packaging run. Mitigation: this is the documented electron-builder way to disable signing; default path should skip builder signing exactly as `identity:null` did.
- `entitlementsInherit` reuses the full entitlements plist (common Electron pattern); verify helper signing during the first real notarized run.
- appId still `com.electron.meeting-notes` — DEFERRED to user decision (TCC reset + backend keying). NOT auto-changed.
- xattr install instructions remain (correct for current ad-hoc builds) — cleanup deferred until first notarized build (documented).

**Pending:** senior code-reviewer pass on Phase 1 changes (dispatched, opus). Incorporate findings, then move to Phase 3 (toggle state machine — root cause already mapped, see below) or Phase 2 (premium).

---

## TOGGLE/VISIBILITY ROOT CAUSE (pre-investigated for Phase 3)
Background debugger agent produced a precise map (saved here so Phase 3 can start cold):
- **RC-1 (HIGH):** No serialization/single-flight guard across `renderer → IPC → AppState → WindowHelper → native`. Early-returns `if (=== state) return` in `AppState.setUndetectable` (`electron/main.ts:3914`), `WindowHelper.setContentProtection` (`electron/WindowHelper.ts:71`), `AppState.setOverlayMousePassthrough` (`electron/main.ts:4027`). Heavy macOS work deferred behind a **150ms `_dockDebounceTimer`** (`main.ts:3957`) that reads settled state — rapid toggles desync boolean vs OS effect. The "wait 5s" symptom = debounce clears + 10s shortcut health-check re-registers dropped hotkeys.
- **RC-2 (HIGH):** Renderer optimistic state never reconciles; IPC `{success:true}` ignored. Call sites fire-and-forget without await/rollback: `SettingsPopup.tsx:214-216`, `SettingsOverlay.tsx:1459-1460`, `Launcher.tsx:258`, passthrough `NativelyInterface.tsx:3417-3420/4779-4781`. Reconcile only via `undetectable-changed` broadcast (`main.ts:3943` → `NativelyInterface.tsx:890-895`); a no-op early-return emits NO broadcast → permanent desync.
- **RC-3 (MED):** `general:toggle-visibility` shortcut (`toggleMainWindow` `main.ts:3564`, IPC `ipcHandlers.ts:357`) and `set-undetectable` mutate the same windows with no shared lock.
- **~1s invisible flicker:** deferred macOS block `main.ts:3981-4004` — `app.dock.hide()` deactivates app + drops focus, then `targetFocusWindow.focus()` round-trip, plus `setContentProtection(true)` reapplying `NSWindowSharingNone` (`WindowHelper.ts:81`, native `stealth_window.rs:185`) and `switchToOverlay/Launcher` hide/show (`WindowHelper.ts:774-776/812-814`). Windows analogue: `setOpacity(0)`→60ms→`setOpacity(1)` (`WindowHelper.ts:737-751`).
- **Fire-and-forget / untimed:** `toggle-window`/`show-window`/`hide-window`/`show-overlay`/`hide-overlay` (`ipcHandlers.ts:357-374`) return undefined. `applyStealthToWindow` (`stealth_window.rs:51`, `index.d.ts:70`) and `StealthKeyboardTap.start/stop` (`index.d.ts:24,43`) are **synchronous + untimed** (can block main thread), called `WindowHelper.ts:385`, `StealthKeyboardManager.ts:239,311`.
- **Fix shape:** add a single-flight op queue in `AppState` (`private opChain: Promise<void>`); wrap `setUndetectable`/`setOverlayMousePassthrough`/`toggleMainWindow`; dedupe against latest desired-state instead of early-return; ALWAYS emit `undetectable-changed` at end of serialized op; make `set-undetectable`/`set-overlay-mouse-passthrough` return actual final state and have renderer `await` + rollback on mismatch; drop the 150ms debounce (queue coalesces); fold dock.hide()+focus() into the same serialized step to kill the second deactivation round-trip; revalidate shortcuts at end of op.

---

## PREMIUM / NATIVELY API AUDIT (pre-investigated for Phase 2)
Background audit agent (opus) read `premium/electron/services/LicenseManager.ts`, settings components, `CredentialsManager.ts`, `RateLimiter.ts`, `NativelyProSTT.ts`, and `natively-api/server.js`. **Verdict: money path is fundamentally sound — no P0 lock-out or bypass, no secret leaks.**
- **Plan separation [CONFIRMED OK]:** Server is authority. `activateWithApiKey` stores license only when `GET /v1/pro/verify` returns `has_pro` (`LicenseManager.ts:268-273`); server `PRO_PLANS={pro,max,ultra}` (`server.js:3202,3211`). Standard API plan → `has_pro:false` → rejected. Lifetime Pro (`natively_pro_lifetime`) unlocks desktop Pro via `isPremium()` file presence, no API credits implied. Correct.
- **Offline degradation [CONFIRMED OK]:** `isPremiumAsync` fails-OPEN on network errors (`LicenseManager.ts:441-483`); sync `isPremium()` is offline file+HWID. No permanent lock-out of valid users.
- **F4 [SUSPECTED P1 — the one real risk]:** natively_api branch calls `removeLocalLicenseFile()` whenever body isn't `{ok:true,has_pro:true}` (`LicenseManager.ts:472-478`). A transient `429 ip_blocked` / `account_suspended` (HTTP success, ok:false) thus DELETES a paying user's cached license → transient downgrade. **Fix: only revoke on explicit lost-entitlement signal (`subscription_inactive` or `has_pro===false`); fail-open on 429/ip_blocked/account_suspended/missing body.** This TIGHTENS protection, weakens no gate.
- **F5 [P1]:** `getLicenseDetails` returns only `{isPremium,plan,provider}` — no expired/revoked/suspended distinction; `NativelyProSettings.tsx:677` shows binary active/upgrade-wall. Lapsed Pro users see a bare upgrade screen with no explanation. Fix: thread a `reason` field + distinct copy.
- **F6 redaction [CONFIRMED OK]:** No raw key/license/token logs. STT files redact (e.g. `ElevenLabsStreamingSTT.ts:240`). `x-natively-key` header never logged.
- **F7 [P2]:** Launcher ad layer renders free→premium flip on load (license is async, non-blocking — good, but ad UI flickers). `NativelyProSettings` already guards with `isPremium===null` spinner (`:663`).
- **F8 [CONFIRMED OK]:** Gates resolve through main-process IPC → LicenseManager; HWID-bound in compiled Rust; no client-forgeable gate.

Phase 2 plan: implement F4 (P1, safe, high-value) + regression test; then F5/F7 if time. Do NOT touch backend.

### PHASE 2 — Premium / API gating  ✅ F4 DONE (2026-05-29)
**Implemented F4** (the one real P1 risk): extracted the revoke decision into a pure module **NEW `premium/electron/services/licenseVerifyPolicy.ts`** (`classifyProVerify(status, data) → 'active'|'revoke'|'keep'`) and wired it into `LicenseManager.isPremiumAsync` natively_api branch (`premium/electron/services/LicenseManager.ts:463-505`). Verified the server contract directly (`natively-api/server.js:3197-3214` + `validateKey` 2009-2032): only revoke on CONFIRMED loss (`has_pro:false` / `subscription_inactive` / `key_not_found` / `invalid_key_format`); FAIL-OPEN on transient `ip_blocked`(429) / `account_suspended`(403 payment hold) / 5xx / network / unparseable. **No gate weakened — this tightens protection for paying users.**
- **Test:** NEW `electron/services/__tests__/LicenseVerifyPolicy.test.mjs` — 11 cases incl. F4 regressions (account_suspended/ip_blocked/5xx/network → keep). `npm run build:electron` OK; `node --test` → **11/11 pass**.
- **Files changed:** `premium/electron/services/licenseVerifyPolicy.ts` (new), `premium/electron/services/LicenseManager.ts`, `electron/services/__tests__/LicenseVerifyPolicy.test.mjs` (new). (premium is a submodule → local working-tree edits.)
- **Deferred (documented follow-ups, not blockers):** F5 (thread `reason` through `getLicenseDetails`/`license-status-changed` for distinct lapsed/suspended/expired copy in `NativelyProSettings.tsx`); F7 (gate launcher ad layer behind `hasLoadedLicense` to remove free→premium flip). Both are UX-copy/flicker improvements; gating itself is correct.
- **Not run:** full `tsc` typecheck (working tree has 40+ in-flight modified files; esbuild build passed; change is isolated + well-typed). Pending: background code-review of F4.

---

### PHASE 3 — Toggle / visibility / stealth  ✅ CORE FIX DONE (2026-05-29)
**Implemented RC-2** (the concrete, verifiable cause of "fast toggle does nothing until ~5s"):
- NEW `electron/services/toggleStateReducer.ts` — pure `decideToggle(current,requested)` with INVARIANT `broadcast:true` always; `changed` gates side-effects.
- `electron/main.ts` `setUndetectable` (~L4103) + `setOverlayMousePassthrough` (~L4218): replaced silent `if (=== state) return` with **re-broadcast authoritative state on no-op** so renderer drift self-heals. Side-effects (content protection, 150ms-debounced dock op) still gated on real change.
- `electron/ipcHandlers.ts` `set-undetectable` (L833) + `set-overlay-mouse-passthrough` (L848): now return authoritative `{success, state/enabled}` for renderer reconciliation.
- Confirmed all 4 toggle UIs (Launcher, NativelyInterface, SettingsPopup, SettingsOverlay) subscribe to `undetectable-changed` (preload `ipcRenderer.on` L1608) → always-broadcast heals them all.
- **Tests:** NEW `electron/services/__tests__/ToggleStateReducer.test.mjs` (5, incl. no-op-still-broadcasts regressions). Ran with existing stealth suites → **39/39 pass**, no regressions. `npm run build:electron` OK.

**NOT done (require Electron GUI to verify — doing blind risks unrecoverable window):**
1. ~1s invisible flicker: `app.dock.hide()` deactivates app + drops focus → `targetFocusWindow.focus()` round-trip + `setContentProtection`(NSWindowSharingNone) + overlay/launcher hide→show. In `setUndetectable` darwin block (main.ts ~L4143-4207) + `WindowHelper.switchToOverlay/switchToLauncher`. Fix = resequence dock/focus; eyeball on real screen.
2. Single-flight queue for RC-3 cross-op overlap (toggle vs window-switch). Sync body + 150ms debounce already bound self-overlap.
3. Renderer await+rollback using new IPC return (optional; broadcast already heals).
4. Bounded timeout on sync native `applyStealthToWindow` (needs Rust async change).
5. Emergency un-hide recovery shortcut (recommended).

---

### PHASE 4 — Audio capture lifecycle  ✅ bug 1 fixed; bug 2 DEFERRED (documented) (2026-05-29)
Audit (background agent) found serialization mostly solid (deferred-stop wrappers + idempotent teardown + post-stop chunk drop + real native teardown + distinct error states). Two concrete remaining bugs:
- **Bug 1 [FIXED + tested]:** `__disarmStuckWatchdog` was called by `abortStaleAudioInit`/`endMeeting` but **never attached** to the capture instances (lost in a revert; cf. memory 4182). Restored the `disarmStuckWatchdog` closure + `(capture as any).__disarmStuckWatchdog = disarmStuckWatchdog` in `wireSystemCapture`+`wireMicCapture` (main.ts ~1599/1731), `on('stop')` uses it, and `endMeeting` (~3296) disarms both BEFORE `stop()`. **`StuckWatchdogDisarmOnEndAndAbort.test.mjs` → 5/5 (was failing).** No new code; restored intended design.
- **Bug 2 [FIXED + tested]:** `endMeeting` now aborts+awaits the in-flight init. Added `_audioInitController: AbortController` + `_endMeetingInFlight` re-entry guard; `startMeeting` wraps init in the controller; `isCurrentMeeting` checks `!audioInitSignal.aborted`; catch recognises `audio_init_aborted` sentinel; `endMeeting` `abort()`s then `await this._audioInitPromise` BEFORE disarm/stop, nulls it after. Earlier UX worry resolved: `broadcastMeetingState()` reverts the launcher UI BEFORE the await, so responsiveness is unaffected; await is instant in the common case (`_audioInitPromise` already null) and only blocks in the cold-start-then-immediate-Stop window — exactly when waiting prevents the HAL-lock freeze. **`EndMeetingAbortsInFlightInit.test.mjs` → 7/7 (was failing).** Gotcha fixed mid-impl: a comment containing the literal `await this._audioInitPromise` tripped the source-grep test → reworded.

**Pre-existing failing-test baseline (NOT from this session):** after bug1+bug2 fixes, audio suite is 127/133 — the remaining **6 fails are unrelated pre-existing structural tests** for reverted/unimplemented designs (model-changed targeting ×2, single-instance-lock ×2, intelligence token-batch flush, activation-policy cold-launch). Working tree has 40+ in-flight modified files. My edits are isolated; I flipped **12** previously-failing tests (StuckWatchdog 5 + EndMeeting 7) to green and added 16 new passing tests = **51/51** across all touched suites. The 6 remainders are candidate "lost regressions" to triage separately (a couple — single-instance-lock, activation-policy cold-launch — are app-lifecycle/startup-adjacent and may be quick structural restores for a future in-scope pass).

---

### PHASE 5 — Startup performance  ✅ 1 safe fix; bigger wins documented (2026-05-29)
Recon found ML (transformers/whisper) already lazy-loaded; launcher uses `show:false`+`ready-to-show` (no white flash). Applied 1 SAFE fix:
- **`src/components/StartupSequence.tsx:123`** — trimmed startup `@import` to drop the unused **Geist** web font (FONTS.display 0 uses; also the import is after @font-face = invalid CSS → likely already ignored). Kept IBM Plex Sans (used by "reddit" badge L86). Safe in all scenarios.

Documented (NEED GUI/profiling — not applied): (1) `WindowHelper.ts:405` eager overlay `loadURL` during launcher boot — defer to idle/first switchToOverlay (biggest win); (2) `main.ts` AppState ctor (~740/748) sync `DatabaseManager.getInstance()`+`initializeRAGManager()` before `createWindow()` — wrap in `setImmediate` (cf. whisper preload ~495); (3) `src/premium/index.tsx` eager globs → React.lazy; (4) `src/App.tsx:66` `analytics.initAnalytics()` in first effect → requestIdleCallback.

---

### PHASE 7 — Final review + QA  ✅ COMPLETE (2026-05-29)
- **Senior code review (focused on net changes, cross-checked vs server.js + app-builder-lib): APPROVE.** 0 critical/high/medium, 1 low (already satisfied). GO on all 5 areas. Confirmed: NO premium-gate weakening (F4 only narrows revoke; no new path to premium=true), NO secret logging, NO Windows/Linux regression.
- **Change-presence verification:** all intended edits confirmed in final state (signing scripts/config, F4 policy+wiring, toggle reducer ×3 + IPC returns, watchdog attach ×2 + disarm calls ×4, startup font trim).
- **Tests:** 16 new (LicenseVerifyPolicy 11, ToggleStateReducer 5) all pass; restored StuckWatchdog suite to 5/5; combined gate over all touched suites = 44/44. Audio suite 117/130 (13 = 7 bug-2 spec + 6 unrelated pre-existing). Full `npm test` can't complete in this offline env (`OpenAIRealtimeGAProtocol.test.mjs` is network-dependent and the suite uses `--test-timeout=0`).

## NEXT RECOMMENDED STEP (for a future session)
All 8 planned phases done: 1✅(signing) 2✅(premium F4) 3✅(toggle RC-2) 4✅(audio bug1; bug2 deferred) 5✅(startup font; wins documented) 6✅(no secret leaks) 7✅(review APPROVE). **For a future session with a real screen:** (a) toggle ~1s flicker resequencing; (b) audio bug 2 AbortController + abort-sync/await-in-background design (7 spec tests in `EndMeetingAbortsInFlightInit.test.mjs`); (c) startup wins #1/#2; (d) premium F5 lapsed-plan UI copy + F7 ad-flicker; (e) after Apple enrollment run `npm run dist:signed` + verify codesign/spctl/stapler; (f) decide appId. Also: pre-existing failing structural tests in working tree (model-changed targeting, single-instance-lock, token-batch, activation-policy) are unrelated to this session — triage separately.
**Earlier reference: Phase 4 (audio capture lifecycle)** details above. — verify rapid mic/system-audio start/stop doesn't leak streams or stick UI in "listening"; distinct error states; build on prior `AUDIO_RELIABILITY_REPORT.md` work. OR **Phase 5 (startup perf)**. Then Phase 6 (telemetry redaction — audit already found NO leaks, mostly verification) and Phase 7 (final review + QA). Consider the documented GUI follow-ups for the toggle 1s-flicker once a screen is available. (root cause already mapped above — high user-visible value, fully local, testable) OR **Phase 2 premium audit** (read `premium/electron/services/LicenseManager.ts` + Natively API settings, verify gating + redaction). Recommend Phase 3 next since the investigation is already done.
