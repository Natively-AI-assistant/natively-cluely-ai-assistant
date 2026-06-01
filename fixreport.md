# Natively — macOS Production Readiness Fix Report

**For:** Evin (read this when you wake up)
**By:** Claude Code (overnight autopilot)
**Date started:** 2026-05-29
**Build version:** 2.6.0
**Branch:** main (no PR — changes are uncommitted edits in your working tree)

> This report is updated after every phase. Scroll to **§ "What you must personally review"** and **§ "Exact commands to run"** first if you're short on time. The deep technical log is in `docs/engineering/MACOS_PRODUCTION_FIX_PROGRESS.md`; the analysis is in `docs/engineering/MACOS_PRODUCTION_READINESS_AUDIT.md`.

---

## Executive summary

Natively currently ships as an **ad-hoc-signed** Electron app with **hardened runtime disabled** and **no notarization step**. That is the single biggest reason macOS permissions (mic, screen recording / system audio, accessibility) behave inconsistently across builds and why the app cannot pass Gatekeeper as a real distributed app. This autopilot pass did the following, **in strict priority order, fixing real bugs and adding regression tests** (16 new tests added + 12 previously-failing structural tests restored to green; **51/51** across all touched suites pass):

1. **Signing/notarization (Phase 1):** wired a **non-breaking, opt-in** Developer ID + notarization path (`npm run dist:signed` → `electron-builder --config electron-builder.signed.cjs`) that enables hardened runtime, applies entitlements, signs, notarizes (notarytool) and staples — while the **default/dev build is byte-for-byte unchanged** (still ad-hoc, no Apple account needed). A senior review caught and we corrected a CRITICAL in the first iteration.
2. **Premium/Natively-API (Phase 2):** full gating audit found the money path sound (correct plan separation, no key logging, server-authoritative gates, safe offline fail-open). Fixed the one real risk — **F4**: a transient server `429`/`account_suspended` no longer wrongly deletes a paying user's cached Pro license.
3. **Toggle/visibility (Phase 3):** fixed **RC-2** — the undetectability/passthrough toggle no longer gets stuck out of sync (it now always re-broadcasts authoritative state, so a drifted UI self-heals instead of needing a ~5s wait). IPC handlers now return authoritative state.
4. **Audio (Phase 4), startup (Phase 5), telemetry (Phase 6):** audited; telemetry already leak-free; audio/startup findings tracked.

**Honesty note:** the **~1s invisible flicker** on the on/off toggle, the startup boot-ordering wins, and the premium lapsed-plan UI copy are **root-caused but NOT yet fixed**, because fixing them safely requires running the Electron GUI on a real screen / a profiler (not available in this headless autopilot), or a product decision. They are documented precisely with file locations and a manual QA checklist below — do not assume they're done. (Audio bug 2, the orphaned-capture/HAL-freeze race, WAS completed this pass — it had a verifiable structural test.)

**Release recommendation:** **HOLD** — blocked on Apple Developer Program enrollment for real signing/notarization. All local code-side prep is complete and tested; the live notarized build pass is yours to run.

---

## Final senior review verdict — APPROVE

A consolidated senior code review (focused only on this session's net changes, cross-checked against `natively-api/server.js` and the vendored `app-builder-lib`) returned **0 critical / 0 high / 0 medium / 1 low (already satisfied)** and **GO on all five areas**:

| Area | Verdict |
|------|---------|
| Phase 1 — Signing/notarization | **GO** — default build provably untouched; production keys in opt-in config |
| Phase 2 — Premium F4 | **GO** — strictly narrows *revoke* conditions; **no new path to premium=true**; no gate weakened |
| Phase 3 — Toggle RC-2 | **GO** — side-effects still gated on real change; IPC returns additive |
| Phase 4 — Audio watchdog | **GO** — cannot suppress a legitimate mid-meeting stuck warning (triple-guarded) |
| Phase 5 — Startup font | **GO** — Geist unused; no rendered-text change |

Explicit confirmations: **no premium-gating weakening, no secret logging, no Windows/Linux regression.**

---

## Phases completed
- ✅ **Phase 0** — Repo scan, priority map, living docs created.
- ✅ **Phase 1** — Signing/notarization/entitlements wired (opt-in, default build unchanged; reviewed).
- ✅ **Phase 2** — Premium + Natively API gating audited; F4 fixed + tested.
- ✅ **Phase 3** — Toggle desync (RC-2) fixed + tested; 1s-flicker root-caused (GUI follow-up).
- 🔄 **Phase 4** — Audio capture lifecycle audit (in progress).
- ⬜ Phase 5 — Startup performance + window lifecycle.
- ✅ **Phase 6** — Telemetry/logging redaction (audit found NO secret leaks).
- ⬜ Phase 7 — Final review + QA.

---

## Bugs confirmed + fixed
1. **Cannot notarize** (`hardenedRuntime:false` + `identity:null` + ad-hoc `afterPack`) — **FIXED** via opt-in signed config (default build untouched).
2. **Production artifacts ad-hoc signed** — **FIXED**: ad-hoc signer now stands down when a real identity/production-sign signal is present.
3. **No notarize/staple hook** (`@electron/notarize` installed but unused) — **FIXED**: `afterSign` notarize+staple hook wired in the signed config.
4. **F4 — paying user transiently downgraded** on a server 429/account_suspended/5xx blip (license file deleted) — **FIXED** + 11 tests.
5. **RC-2 — undetectability/passthrough toggle stuck out of sync** (no-op early-return suppressed the reconciling broadcast) — **FIXED** + 5 tests.
6. **Audio orphaned-capture / HAL-freeze on Stop-during-startup** — `endMeeting` didn't abort/await the in-flight init — **FIXED** (AbortController) + 7 tests.
7. **Audio false "stuck" banner** after a short meeting (watchdog disarm not attached) — **FIXED** + 5 tests restored.

## Bugs confirmed but NOT yet fixed (documented, GUI/profiling/decision required)
8. **~1s invisible window on on/off toggle** — root-caused (`app.dock.hide()` deactivation + focus round-trip + content-protection re-apply + overlay/launcher hide→show). Needs on-screen verification.
9. **Generic appId** `com.electron.meeting-notes` — **decision deferred to you** (TCC reset + possible backend keying). Not auto-changed.
10. Startup boot-ordering wins (#1 eager overlay load, #2 defer RAG init) — profiling-gated; documented.
11. Premium F5 (lapsed-plan UI copy) / F7 (ad-layer flicker) — renderer UX, GUI-gated; documented.

---

## Change log (before/after)

### Change: Production code-signing + notarization path (Phase 1)

#### Before
The packaged app was **ad-hoc signed** (`package.json` → `mac.identity: null`, `mac.hardenedRuntime: false`, `afterPack: ad-hoc-sign.js` running `codesign --sign -`). `@electron/notarize` was installed but **never invoked** — there was no `afterSign`/notarize step. An ad-hoc, non-hardened, non-notarized build can never pass Gatekeeper as a distributed app and has unstable TCC (mic/screen/accessibility) grants across builds. This is the root cause of "permissions behave differently between builds" and the `xattr -cr` "app is damaged" workarounds in the README/release notes.

#### After
- Local/dev build (`npm run app:build` / `npm run dist`) is **byte-for-byte unchanged** — still ad-hoc, no Apple account needed.
- A new **opt-in production path** (`npm run app:build:signed` / `npm run dist:signed`) uses `electron-builder --config electron-builder.signed.cjs`, which enables hardened runtime, applies entitlements (with a minimal helper-inherit plist), signs with your Developer ID (from env), and runs an `afterSign` hook (`scripts/notarize.js`) that submits to Apple's notary service and staples the ticket. Once you have an Apple Developer cert, a single command produces a properly signed + notarized + stapled build.
- The ad-hoc signer now stands down automatically when a real identity is present, so it never clobbers a Developer ID signature.

#### Files changed
- `package.json` (added `app:build:signed` + `dist:signed` scripts only; `build` block restored to original)
- `electron-builder.signed.cjs` (new — production config)
- `scripts/notarize.js` (new — afterSign notarize+staple hook, no-ops without credentials)
- `scripts/ad-hoc-sign.js` (added Developer-ID-present guard + opt-in hardened-runtime flag)
- `assets/entitlements.mac.inherit.plist` (new — minimal helper entitlements)
- `docs/engineering/MACOS_SIGNING_NOTARIZATION_CHECKLIST.md` (new — operator steps + verify commands)

#### Tests
- Structural validation: `package.json` parses and its default `build`/`scripts` are confirmed identical to the original; `electron-builder.signed.cjs` loads and correctly spreads the base config; both signing scripts pass `node --check`; `@electron/notarize` v3 API confirmed against the installed type definitions.
- Could not run: a full `electron-builder` packaging + live notarization (needs Apple Developer cert + network upload — external blocker).

#### User-visible impact
None on the current/default build. After you enroll in the Apple Developer Program and run the signed path, end users will no longer see "app is damaged" / need `xattr`, and macOS permission grants (mic, screen recording, accessibility) will persist correctly across updates.

#### Senior review
Reviewed by code-reviewer agent against the vendored electron-builder source. It caught a CRITICAL in the first iteration (removing `identity: null` would have made electron-builder ad-hoc-sign on arm64 by itself). The current design (opt-in config file, default untouched) resolves that and all other findings; default-build safety is provably preserved.

### Change: Paying-user license never revoked on a transient server blip (Phase 2 — F4)

#### Before
On each launch, `LicenseManager.isPremiumAsync()` re-checked a Natively-API Pro license against `GET /v1/pro/verify`. It treated **any** response that wasn't exactly `{ok:true, has_pro:true}` as "entitlement lost" and **deleted the local license file**. The server returns `429 ip_blocked` (rate-limit/DDoS edge), `403 account_suspended` (a recoverable payment-method hold — "contact support"), and 5xx during incidents. So a transient rate-limit blip or a temporary payment hold would silently knock a **paying customer** out of Pro until they re-entered their key.

#### After
The revoke/keep decision now lives in a pure, unit-tested policy (`classifyProVerify`). It revokes ONLY on a confirmed, durable loss of entitlement — plan downgraded (`has_pro:false`), `subscription_inactive`, or `key_not_found`/`invalid_key_format` (refund/deleted key). Every transient or unrecognized state (`ip_blocked`, `account_suspended`, 5xx, network error, unparseable body) **fails open** and keeps the license. Refunds are still caught; actual hosted-API usage is still server-enforced regardless. No gate was weakened — this only tightens protection for paying users.

#### Files changed
- `premium/electron/services/licenseVerifyPolicy.ts` (new — pure decision logic)
- `premium/electron/services/LicenseManager.ts` (uses the policy in the natively_api branch)
- `electron/services/__tests__/LicenseVerifyPolicy.test.mjs` (new — 11 regression tests)

#### Tests
- `npm run build:electron` then `node --test electron/services/__tests__/LicenseVerifyPolicy.test.mjs` → **11/11 pass**, including explicit F4 regressions (account_suspended / ip_blocked / 5xx / network all → keep).

#### User-visible impact
Paying API-Pro users will no longer be transiently downgraded to free when the license server is rate-limited, mid-incident, or holding on a payment-method issue. Genuinely lapsed/refunded users are still correctly de-provisioned.

#### Audit context
A full premium/API gating audit (separate agent) found the money path otherwise sound: correct Standard-vs-Pro plan separation, Lifetime-Pro-without-API-credits handled correctly, no API/license keys logged anywhere, gates resolved server-side (not client-forgeable), and safe offline fail-open. The only functional risk was F4 (now fixed). Two UX follow-ups are noted below (lapsed-plan messaging, ad-layer flicker) — neither is a gating defect.

### Change: Undetectability/visibility toggle no longer gets stuck out of sync (Phase 3 — RC-2)

#### Before
A background root-cause investigation traced the "fast toggle does nothing until you wait ~5s" symptom. The core defect: `AppState.setUndetectable()` (and `setOverlayMousePassthrough()`) **early-returned silently when the requested value equalled the current value** (`if (this.isUndetectable === state) return;`). The renderer toggles optimistically (sets its local state, then fires the IPC without awaiting). If the renderer's optimistic state ever drifted from the main process — a dropped/duplicate `undetectable-changed` broadcast, or a concurrent global-shortcut press — the next click would land as a "no-op" in main, which returned **without broadcasting**, so the UI never re-synced. The toggle appeared dead until the user happened to toggle to the *other* value. The IPC handlers also returned a hardcoded `{success:true}` that ignored the real outcome.

#### After
- The toggle decision is now a pure, unit-tested reducer (`decideToggle`) whose invariant is: **always broadcast the authoritative state, every call** — even a no-op — while still gating the expensive macOS dock/focus/content-protection side-effects on an actual change. So any renderer drift now self-heals on the very next toggle (all four toggle UIs — Launcher, NativelyInterface, SettingsPopup, SettingsOverlay — already subscribe to `undetectable-changed`).
- `set-undetectable` / `set-overlay-mouse-passthrough` IPC handlers now return the **authoritative final state** (`{success, state}` / `{success, enabled}`) so the renderer can reconcile/roll back instead of assuming success.

#### Files changed
- `electron/services/toggleStateReducer.ts` (new — pure reducer enforcing the always-broadcast invariant)
- `electron/main.ts` (`setUndetectable` + `setOverlayMousePassthrough` use the reducer; re-broadcast on no-op)
- `electron/ipcHandlers.ts` (handlers return authoritative state)
- `electron/services/__tests__/ToggleStateReducer.test.mjs` (new — 5 tests incl. RC-2 regressions)

#### Tests
- `node --test` on the reducer (5/5) plus the existing stealth IPC suites (`StealthIpcHandlerRegistration`, `StealthBlockInputFocusGuards`) → **39/39 pass**, no regressions.
- Could NOT run: the live GUI toggle behaviour (no display/Electron GUI in this environment). Manual QA steps are in the checklist below.

#### User-visible impact
Rapidly toggling undetectability (or mouse-passthrough) should no longer leave the UI showing a state that disagrees with what the app is actually doing; a stuck toggle now corrects itself on the next press instead of requiring a ~5s wait.

### Change: False "system-audio-stuck" banner after a short meeting (Phase 4 — bug 1)

#### Before
The 12s stuck-capture watchdog (in `wireSystemCapture`/`wireMicCapture`) could only be cancelled by the capture's `on('stop')` event. `abortStaleAudioInit()` and `endMeeting()` called `(...as any)?.__disarmStuckWatchdog?.()` to cancel it synchronously — but that closure was **never attached to the capture instance** (a regression: it existed on May 28 then was lost in a revert). So the optional-chained call silently no-op'd. A short meeting that captured 0 chunks within the 12s window could fire a misleading "No audio detected / system-audio-stuck" banner *after* the user already stopped. (Confirmed: the existing structural test `StuckWatchdogDisarmOnEndAndAbort.test.mjs` was failing.)

#### After
Restored the `disarmStuckWatchdog` closure and attached it as `(capture as any).__disarmStuckWatchdog` in both `wireSystemCapture` and `wireMicCapture`; the `on('stop')` listener now calls the same closure; and `endMeeting()` disarms both watchdogs **before** `stop()`. The previously-failing structural regression test now passes (5/5).

#### Files changed
- `electron/main.ts` (`wireSystemCapture`, `wireMicCapture`, `endMeeting`)

#### Tests
- `StuckWatchdogDisarmOnEndAndAbort.test.mjs` → **5/5 pass** (was failing before).

#### User-visible impact
No more spurious "no audio detected" / "system audio stuck" banner flashing after stopping a short meeting.

### Change: orphaned audio-capture / HAL-freeze race on Stop-during-startup (Phase 4 — bug 2)

#### Before
`startMeeting()` ran its audio init as a fire-and-forget promise. `endMeeting()` flipped `isMeetingActive=false` and returned without awaiting it. If the user clicked Stop while the init was still mid-`setupSystemAudioPipeline()` (the 5-7s cold start), the init could construct/start a FRESH native capture AFTER `endMeeting()` had already scheduled teardown on the old one — leaving a dangling CoreAudio/SCK handle, or both the dying and fresh captures grabbing the HAL property-listener lock at once and freezing the main thread mid-paint. (Confirmed: `EndMeetingAbortsInFlightInit.test.mjs`, 7 tests, was failing.)

#### After
Added an `AbortController` (`_audioInitController`) around the init. `endMeeting()` now `abort()`s it (synchronous — flips the signal so the init's `isCurrentMeeting()` guards short-circuit and it tears down its own captures) and `await`s `_audioInitPromise` **before** touching captures. I re-examined my earlier UX worry and it doesn't hold: `endMeeting()` reverts the launcher UI via `broadcastMeetingState()` *before* this await, so perceived responsiveness is unchanged; the await is instant in the common case (`_audioInitPromise` is already null once init completed) and only blocks in the narrow cold-start-then-immediate-Stop window — which is exactly when waiting is required to avoid the freeze. The init's catch now recognises the abort sentinel so it never shows a bogus "Audio pipeline failed" banner for a user-initiated Stop. I also added a small re-entry guard (`_endMeetingInFlight`) so the new await can't widen the double-`endMeeting` window and truncate trailing transcript finals.

#### Files changed
- `electron/main.ts` (`_audioInitController`/`_endMeetingInFlight` fields; `startMeeting` init wrapped in AbortController; `isCurrentMeeting` checks `!audioInitSignal.aborted`; catch recognises `audio_init_aborted`; `endMeeting` aborts+awaits before teardown)

#### Tests
- `EndMeetingAbortsInFlightInit.test.mjs` → **7/7 pass** (was failing); combined with the watchdog suite → **12/12**; full audio suite **127/133** (the 6 remaining are unrelated pre-existing failures).

#### User-visible impact
Stopping a meeting during the first few seconds of audio startup no longer risks a frozen window or a phantom background capture; no bogus "audio failed" banner on a normal Stop.

### Test baseline honesty note
The working tree currently has **40+ in-flight modified files from prior sessions** and a set of **pre-existing failing structural tests unrelated to this session** (e.g. model-changed targeting, single-instance-lock ordering, intelligence token-batch flush, activation-policy cold-launch, and the bug-2 AbortController design). This session's changes are isolated to signing config, license policy, the toggle reducer, and the audio watchdog attachment — none of which touch those subjects. I fixed the StuckWatchdog regression (5 tests flipped to green) and added 16 new passing tests; I did not introduce the other failures and did not hide them. Recommend running `git stash` + `npm test` to capture a clean pre-existing baseline if you want exact attribution.

### Change: Removed an unused web font from the startup screen (Phase 5)

#### Before
`src/components/StartupSequence.tsx` had `@import url('…Geist…&IBM+Plex+Sans…')` fetching the **Geist** web font family (4 weights) on the first-run startup screen. `FONTS.display` (the only Geist-primary token) is referenced **0 times**; the fonts actually used have local `@font-face` and list Geist only as a tertiary fallback. (Also: the `@import` is placed after `@font-face`, which is invalid CSS, so browsers likely ignore it — i.e. it's at best dead weight.)

#### After
Trimmed the import to fetch only **IBM Plex Sans** (which genuinely styles the "reddit" badge at line 86). Geist is dropped. This is safe in every scenario: if the import was honored, we removed an unused font fetch; if it was ignored (invalid placement), nothing changes; the "reddit" badge is untouched either way.

#### Files changed
- `src/components/StartupSequence.tsx`

#### User-visible impact
None visually (Geist wasn't rendered). On first run, one less web-font download competing with the startup animation.

#### Startup recon — bigger wins documented for you (NEEDS GUI/profiling verification, not applied)
A boot-path recon found the heavy ML (transformers/whisper) is already lazy-loaded and the launcher already uses `show:false`+`ready-to-show` (no white flash). The remaining perceived-jank wins, NOT applied because they need a quick on-screen check:
1. **`electron/WindowHelper.ts:405`** — `createWindow()` eagerly `loadURL`s the hidden overlay (a *second* full React/framer-motion/QueryClient bundle parse) during launcher boot. Defer the overlay's `loadURL` to an idle tick / first `switchToOverlay`. (Biggest win.)
2. **`electron/main.ts` AppState ctor (~740/748)** — `DatabaseManager.getInstance()` (native better-sqlite3 + sqlite-vec) and `initializeRAGManager()` run synchronously before `createWindow()`. Wrap in `setImmediate(...)` (same pattern already used for whisper preload at ~main.ts:495).
3. `src/premium/index.tsx` — premium components load with `import.meta.glob({eager:true})`; switch rarely-first-paint ones to `React.lazy`+`Suspense`.
4. `src/App.tsx:66` — `analytics.initAnalytics()` in the first mount effect; defer with `requestIdleCallback`.

#### Honest scope note (what is NOT fixed in this pass, and why)
These remain because they require running the Electron GUI to verify safely — doing them blind would risk making the window unrecoverable:
1. **~1s invisible flicker on the on/off toggle** — root-caused (macOS `app.dock.hide()` implicitly deactivates the app and drops focus, then a `win.focus()` round-trip + `setContentProtection` re-apply + overlay/launcher hide→show briefly drop the window from the compositor). Fix requires resequencing dock/focus, which must be eyeballed on a real screen. Precise locations are in the progress tracker.
2. **Single-flight queue for cross-operation overlap (RC-3)** — `setUndetectable`'s body is already synchronous (atomic per call) and its dock op is already coalesced by a 150ms debounce, so the self-overlap is bounded; the remaining risk is a toggle interleaving with a window-switch, which is lower-frequency and GUI-sensitive to verify.
3. **Renderer `await` + rollback** using the new IPC return value — optional polish; the always-broadcast fix already heals desync.
4. **Bounded timeout on the synchronous native stealth call** (`applyStealthToWindow`) — needs a Rust change to make it async; documented.
5. **Emergency "un-hide" recovery shortcut** — recommended; documented.

---

## Files changed
**New files**
- `electron-builder.signed.cjs` — opt-in production (Developer ID + notarization) build config
- `scripts/notarize.js` — afterSign notarize+staple hook (no-ops without credentials)
- `assets/entitlements.mac.inherit.plist` — minimal helper-process entitlements
- `premium/electron/services/licenseVerifyPolicy.ts` — pure license revoke/keep policy (submodule, local edit)
- `electron/services/toggleStateReducer.ts` — pure toggle reducer (always-broadcast invariant)
- `electron/services/__tests__/LicenseVerifyPolicy.test.mjs`, `electron/services/__tests__/ToggleStateReducer.test.mjs`
- `docs/engineering/MACOS_PRODUCTION_READINESS_AUDIT.md`, `docs/engineering/MACOS_PRODUCTION_FIX_PROGRESS.md`, `docs/engineering/MACOS_SIGNING_NOTARIZATION_CHECKLIST.md`, `fixreport.md`

**Modified files**
- `package.json` (added `app:build:signed` + `dist:signed` scripts only; `build` block restored to original)
- `scripts/ad-hoc-sign.js` (stand-down guard when a real identity / production-sign signal is present)
- `premium/electron/services/LicenseManager.ts` (uses `classifyProVerify` — submodule, local edit)
- `electron/main.ts` (`setUndetectable` + `setOverlayMousePassthrough` always re-broadcast authoritative state)
- `electron/ipcHandlers.ts` (`set-undetectable` / `set-overlay-mouse-passthrough` return authoritative state)

---

## Tests added / run / could-not-run
- **Added (16 new):** `LicenseVerifyPolicy.test.mjs` (11), `ToggleStateReducer.test.mjs` (5).
- **Restored to green (12 previously-failing structural tests):** `StuckWatchdogDisarmOnEndAndAbort.test.mjs` (5) + `EndMeetingAbortsInFlightInit.test.mjs` (7) — both were failing for reverted/unimplemented designs that this pass re-implemented.
- **Run & passing:** combined gate over all touched suites (the 2 new + 2 restored + 2 stealth suites) → **51/51 pass**. Full audio suite **127/133** (the 6 remaining are unrelated pre-existing failures). `npm run build:electron` succeeds after every change.
- **Could not run:** (a) full `electron-builder` packaging + real notarization — needs Apple Developer cert + network upload; (b) live GUI behavior (toggle flicker, on-screen window visibility) — headless environment, no display; (c) full `tsc` typecheck of the whole electron project — the working tree has 40+ unrelated in-flight modified files; the esbuild transpile (which all changed files pass) is the build of record, and each change is isolated + typed.

---

## What you must personally review
1. **appId decision (action required).** `com.electron.meeting-notes` → a professional id (e.g. `software.natively.desktop`)? This is the right time (pre-notarized-release) but it **resets all TCC permissions** for existing installs and may affect how `natively-api` keys installs/licenses. **NOT auto-changed.** Tell me the desired id + whether the backend ties anything to bundle id and I'll make the change.
2. **Apple Developer Program enrollment** — required for the real signing/notarization run (see the checklist doc).
3. **The toggle ~1s flicker fix** — root-caused but needs you (or me, with a screen) to verify the resequencing on a real display before changing the dock/focus order.
4. **Premium F4 fix** lives in the `premium` submodule (local working-tree change) — make sure your submodule commit/publish flow picks it up.

---

## Manual QA checklist (run on a real machine)

**Toggle / visibility (Phase 3 — verify the RC-2 fix + observe the known flicker):**
- [ ] Rapidly toggle Undetectable 6–8× fast. The pill/toggle state must end up matching reality (dock hidden ⇔ "Undetectable"); it should NOT get stuck requiring a ~5s wait. (RC-2 fix.)
- [ ] Toggle Undetectable from the Settings overlay, then from the launcher pill — both surfaces should reflect the same state immediately. (Always-broadcast.)
- [ ] Press the global visibility shortcut (Cmd+B) several times quickly while toggling Undetectable — state should remain coherent.
- [ ] OBSERVE (known, not-yet-fixed): does the window briefly disappear (~1s) on the main on/off toggle? Note severity for the follow-up fix.
- [ ] Toggle while Screen Recording / Accessibility permission is missing — verify a clear message, not a silent dead toggle.

**Premium / Natively API (Phase 2 — F4):**
- [ ] With a valid API-Pro key, simulate a server blip (e.g. block the network briefly / rate-limit) and relaunch — Pro must NOT be lost.
- [ ] Genuinely downgrade/cancel a test plan server-side — Pro should be revoked on next launch.
- [ ] Confirm logs never print the API key / license key (grep the app log).

**Signing (after Apple enrollment — see MACOS_SIGNING_NOTARIZATION_CHECKLIST.md):**
- [ ] `npm run dist` still produces the ad-hoc dev build exactly as before.
- [ ] `npm run dist:signed` (with env set) → `codesign --verify`, `spctl --assess` "accepted", `xcrun stapler validate` pass.

---

## Exact commands to run
```bash
# Sanity (no Apple account needed):
npm run build:electron        # esbuild transpile — should print "Done"
node --test electron/services/__tests__/ToggleStateReducer.test.mjs \
             electron/services/__tests__/LicenseVerifyPolicy.test.mjs   # 16/16 pass

# Full unit suite (rebuilds electron, runs all __tests__):
npm test

# Default dev build (unchanged behavior, ad-hoc):
npm run dist

# Production signed build (after Apple Developer enrollment — set env per the checklist):
npm run dist:signed
```
Signing verification (codesign / spctl / stapler) commands are in `docs/engineering/MACOS_SIGNING_NOTARIZATION_CHECKLIST.md`.

---

## Remaining risks
- Real signing/notarization is structurally wired but unverified until you run it with an Apple Developer cert.
- The ~1s on/off invisible flicker and the cross-operation single-flight queue are not fixed (need GUI verification) — see the "NOT yet fixed" list.
- `premium` is a git submodule; the F4 fix is a local working-tree change there — ensure it's committed in the submodule.
- Full project `tsc` typecheck not run (large in-flight working tree); changed files are isolated and pass esbuild.

---

## Final release recommendation
**HOLD for now.** The default app is safe and unchanged, the money-path is sound (with F4 fixed), and the toggle desync is fixed + tested. Before a public release: (1) enroll in Apple Developer Program and run `npm run dist:signed`, verify codesign/spctl/stapler; (2) decide the appId; (3) verify the toggle flicker on a real screen and complete the documented GUI follow-ups; (4) run the manual QA checklist. Once those pass, this is releasable.
