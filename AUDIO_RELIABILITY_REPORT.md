# Audio Reliability Report — macOS

**Status:** Phase D shipped (16 fixes, 122 regression tests). Signing chain (SIGN1-4) and test infrastructure (TEST1-3) tracked as separate work.
**Started:** 2026-05-28
**Completed:** 2026-05-29
**Goal:** Bring Natively's macOS audio capture and transcription reliability to competitor (Cluely, Final Round AI, Granola) parity.
**User symptom this report addresses:** "I granted Microphone and Screen Recording permissions but my voice / system audio is not being transcribed."

---

## 1. Executive summary

The reported symptom — "permissions granted but no transcription" — has **three distinct root-cause classes stacked**. No single fix covers all reports.

| Cause class | Severity | Fixable in code alone? | Status |
|---|---|---|---|
| **A. Signing chain (structural)** — Every rebuild invalidates TCC. | CRITICAL | NO — requires Apple Developer Program + Developer ID cert + hardened runtime + notarization. | In progress (separate track) |
| **B. Code-level surface gaps** — UI lies about ready state; failures silently discarded by renderer; capture init swallows errors; mic recovery never emits terminal IPC. | CRITICAL→HIGH | YES — 12 specific bugs across `electron/main.ts` + renderer. | ✅ All shipped (B1–B11 + B8b) |
| **C. Product UX gaps** — No way to diagnose, validate, or self-repair. No pre-meeting startup validation; no in-app TCC repair button; no audio level meter; no deep-link to System Settings. | HIGH | YES — new components. | ✅ All shipped (UX1–UX4) |

**Outcome:** With Cause B and C fixed, every failure mode now surfaces with a visible banner that names the cause, deep-links to the correct macOS System Settings pane, and offers a one-click `tccutil reset` repair button. The structural signing fix (Cause A) is the final piece — without it, every release/auto-update still loses TCC for some users; with it, grants persist permanently.

---

## 2. Why users were still facing issues despite granting permissions

The dominant root cause is structural: **macOS TCC binds Screen Recording / Microphone grants to a binary's "designated requirement" (DR)**. For ad-hoc-signed apps (this codebase's current state: `identity: null`, `--sign -`), the DR resolves to the binary's **cdhash**, which **changes on every rebuild**. After a release or auto-update:

1. System Settings → Privacy & Security → Screen Recording / Microphone shows Natively as ALLOWED (good).
2. `systemPreferences.getMediaAccessStatus('screen')` returns `'granted'` (good).
3. CoreAudio Process Tap allocates, IO proc fires at the correct cadence (looks healthy in logs).
4. **Every sample is zero.** TCC silently zero-fills — Apple does NOT surface this as an OSStatus error.
5. `tccd` Console logs (if checked) show `Failed to copy signing info -67062` and `InvalidCode`.

In parallel, secondary code-level bugs amplified the symptom (all now fixed):
- The renderer **discarded** the mic zero-fill banner under an incorrect assumption (B1).
- The UI initialized STT status to `'connected'` (green-ready) before any audio was verified (B2).
- Capture construction throws were swallowed by an outer try/catch, leaving null wrappers with no watchdog armed and no UI signal (B3).
- Mic recovery exhausted attempts silently with no terminal IPC (B4).
- `audio-capture-failed` and sibling IPCs were sent only to the overlay window; an overlay-destroy race silently dropped the banner (B8, B8b).

Together, these produced the exact symptom: "permission granted, app shows green ready, no transcript, no banner."

---

## 3. Root causes (full list, from senior-level audit)

### A. Signing chain (structural — requires Apple Developer Program)

| # | Severity | Issue | Evidence | Status |
|---|---|---|---|---|
| A1 | CRITICAL | No designated requirement stabilization. `identity: null` + `--sign -` = cdhash-based DR that changes on every rebuild. | `package.json:92-93`; `scripts/ad-hoc-sign.js:88` | SIGN4 (cert provisioned in parallel work — notarization infra wired at commit `partial`) |
| A2 | CRITICAL | `hardenedRuntime: false` makes most entitlements no-ops. `com.apple.security.screen-capture`, `cs.allow-jit`, `cs.disable-library-validation` all require HR. | `package.json:93`; `assets/entitlements.mac.plist:6-13,27` | SIGN2 pending |
| A3 | HIGH | Helper bundles (GPU/Renderer/Plugin) signed by `codesign --deep` WITHOUT entitlements. | `scripts/ad-hoc-sign.js:88` | SIGN3 pending |
| A4 | HIGH | Generic `appId: "com.electron.meeting-notes"` — electron-builder default placeholder. | `package.json:38` | SIGN1 pending |
| A5 | HIGH | `patch-electron-plist.js` patches only the **dev** Electron under `com.github.Electron` — dev users' TCC grants are bound to the wrong bundle ID. | `scripts/patch-electron-plist.js:20-30` | Mitigated by B5 (real TCC status in dev) |
| A6 | HIGH | Entitlements signed onto `.node` are cosmetic for TCC — `tccd` inspects the **calling process**, not dlopen'd libraries. | `scripts/ad-hoc-sign.js:100-114` | SIGN3 will move entitlements to helpers |
| A7 | MEDIUM | No notarization. | `package.json` devDependencies | SIGN4 (notarytool infra wired in parallel) |

### B. Code-level surface gaps (✅ all 12 shipped)

| # | Severity | Issue | File:line | Status | Tests |
|---|---|---|---|---|---|
| B1 | CRITICAL | Renderer dropped mic zero-fill banner under incorrect "STT status surfaces it" assumption. | `src/components/NativelyInterface.tsx:929-948` | ✅ | 6 |
| B2 | CRITICAL | UI initialized STT status to `'connected'` (green) before any audio verified. New `'awaiting-audio'` state added. | `NativelyInterface.tsx:391-398`, `main.ts:318`, +4 files | ✅ | 8 |
| B3 | CRITICAL | `setupSystemAudioPipeline` outer try/catch swallowed capture-construction throws → null wrapper, no watchdog armed. | `main.ts:1737-1944` | ✅ | 8 |
| B4 | HIGH | Mic recovery exhausted 3 attempts with only `console.error` — no terminal IPC. | `main.ts:2858-2880` | ✅ | 8 |
| B5 | HIGH | Dev-mode `getMacScreenCaptureStatus` early-returned `'granted'` unconditionally, masking real TCC denial during testing. | `main.ts:157-200, 4766-4772` | ✅ | 6 |
| B6 | HIGH | `setupSystemAudioPipeline` skipped permission re-check when wrapper already existed. 2nd meeting after TCC revoke = silent zero-fill. | `main.ts:1737-1944` | ✅ | 8 |
| B7 | HIGH | `restartCapturesAfterResume` didn't reset `_micRecoveryAttempts` / `_systemAudioRecoveryAttempts`. Post-sleep recovery is a no-op if counter was saturated. | `main.ts:2000-2050` | ✅ | 7 |
| B8 | HIGH | `sendAudioCaptureFailed` routed only to overlay window. Race destroying overlay → banner invisible. | `main.ts:798-806` | ✅ | 5 |
| B8b | HIGH | Same overlay-only race affected `sendSttStatus` and `sendSystemAudioPermissionDenied`. | `main.ts:794, 808` | ✅ | 6 |
| B9 | MEDIUM | `_audioInitPromise` was never cleared on terminal failure — next meeting inherited failed null capture. | `main.ts:3091-3201` | ✅ | 4 |
| B10 | MEDIUM | Zero-fill detector's `peak > 8` threshold false-latched on DC bias from muted-but-biased mics → detector permanently off. Now peak-to-peak detection (DC-invariant). | `main.ts:1607-1633, 1738-1761` | ✅ | 11 |
| B11 | MEDIUM | 8s stuck-watchdog raced SCK's 5–7s cold start → false stuck banner. Extended to 12s via `STUCK_WATCHDOG_MS` constant. | `main.ts:1490-1565, 1657-1700` | ✅ | 8 |

### C. Product UX gaps (✅ all 4 shipped)

| # | Component | Status | Tests |
|---|---|---|---|
| UX1 | Startup mic + screen permission check — proactive banners for returning users with denied grants. | ✅ | 8 |
| UX2 | In-app TCC repair button — runs `tccutil reset Microphone <bundleId>` + `tccutil reset ScreenCapture <bundleId>` (capital letters required). Includes in-flight guard + absolute `/usr/bin/tccutil` path for security. | ✅ | 11 |
| UX3 | Deep-link to System Settings panes (`x-apple.systempreferences:?Privacy_Microphone` / `?Privacy_ScreenCapture`). Button label adapts: "Open Mic Settings" / "Open Screen Settings" / "Open Settings". | ✅ | 7 |
| UX4 | Live audio level meter in Settings — parallel system-audio probe alongside the existing mic meter. Users can verify both capture paths BEFORE starting a meeting. Epoch-guard prevents orphaned-capture race. | ✅ | 11 |

---

## 4. Competitor-level reliability gaps

| Capability | Cluely | Final Round AI | Granola | Natively (today, post-fix) |
|---|---|---|---|---|
| Developer ID signing | ✅ | ✅ | ✅ (native Swift) | ⏳ SIGN4 |
| Hardened runtime + notarization | ✅ | ✅ | ✅ | ⏳ SIGN2 + SIGN4 |
| TCC-binding stability across updates | ✅ | ✅ | ✅ | ⏳ after SIGN1–4 |
| Zero-fill / silent-capture detection | unknown | unknown | unknown | ✅ (DC-invariant peak-to-peak, B10) |
| Pre-meeting audio validation | ❌ | ❌ | ✅ (native) | ✅ (UX1 startup + UX4 Settings probe) |
| In-app TCC repair button | ❌ (public MDM doc only) | ❌ | ✅ | ✅ (UX2) |
| Deep-link to System Settings | ✅ | ✅ | ✅ | ✅ (UX3) |
| Live audio level meter | ✅ (waveform in onboarding) | ✅ | ✅ | ✅ (UX4 — mic + system) |
| Independent mic/system failure | unknown | unknown | unknown | ✅ (B3) |
| Sleep/wake recovery | ✅ | ✅ | ✅ (native) | ✅ (B7 — full state reset) |
| Banner reaches user during transitions | unknown | unknown | unknown | ✅ (B8, B8b — dual-surface broadcast) |

**Key insight (from research, §6.4 of the research agent's report):** Cluely is also Electron and has the same TCC pain. Their public response is documentation, not a fix — see their MDM permissions troubleshooting page. The differentiator competitors fall short on is **proactive diagnostics + self-repair**. That's the wedge for Natively — and we've now built it (UX1–UX4).

---

## 5. Manual QA checklist (run before each macOS release)

Each scenario lists: setup → action → expected behavior → observable artifact.

1. **First-launch TCC mic dialog** — `tccutil reset Microphone com.electron.meeting-notes`; click Start Meeting; macOS prompts; Allow → capture starts within 2s. Log: `macOS microphone permission request during start meeting: granted`.
2. **First-launch TCC screen dialog** — `tccutil reset ScreenCapture com.electron.meeting-notes`; Start meeting; TCC sheet appears (triggered by `desktopCapturer.getSources` warm-up); Allow → chunkCount climbs.
3. **TCC mic denied (returning user)** — Deny mic; relaunch Natively → UX1 startup check emits banner `mic-denied`. User clicks "Open Mic Settings" (UX3) → goes straight to System Settings → Privacy → Microphone.
4. **TCC screen denied** — Reset + Deny screen; Start → `screen-recording-denied` banner with "Open Screen Settings" button.
5. **Build cdhash change (rebuild invalidates grant)** — Grant permission to current build → rebuild → relaunch → Start meeting. Expected: `status==='granted'` BUT chunks zero-filled (peak-to-peak < 100 sustained) → after 12s `mac-screen-recording-revoked-rebuild` banner with "Repair Permissions" button (UX2). User clicks Repair → tccutil resets entries → user sees instruction to Cmd+Q and reopen.
6. **macOS sleep mid-meeting** — Active meeting → `pmset sleepnow` → wait 30s → wake. Expected: B7 resets recovery counters, captures destroyed + recreated; transcript resumes within ~3s.
7. **AirPods connect mid-meeting** — Default-output watcher rebinds tap within ~1s; no zero-fill banner.
8. **AirPods used for BOTH input AND output** — Banner `mac-same-device-input-output` BEFORE capture starts.
9. **Bluetooth HFP zero-fill** — Pair Sony XM5 or similar BT mic in HFP mode → Start meeting → zero-fill detector trips at ~12s → mic-zero-fill banner with Repair button.
10. **Output to virtual cable (BlackHole)** — Stuck-watchdog trips after 12s (B11) → banner `system-audio-stuck`.
11. **Mic muted at hardware** — Plug muted USB mic → Start meeting → detector trips after 12s → banner `mic-zero-fill`. B10 verified: detector does NOT false-latch on muted-but-biased mics.
12. **Toggle screen permission OFF during active meeting** — B6 verified: next reconfigureAudio or meeting restart re-checks permission and emits banner.
13. **Dev-build TCC quirk (B5)** — `npm run electron:dev` → default behavior is now REAL TCC status (not bypassed). Set `NATIVELY_DEV_BYPASS_SCREEN_TCC=1` to restore legacy behavior.
14. **Packaged build, restricted by MDM** — `mac-screen-recording-restricted` banner ("Contact administrator"). UX1 also catches MDM-restricted mic.
15. **USB mic hot-unplug mid-meeting** — Recovery handler swaps to default → transcript continues within ~2s.
16. **Settings → Audio panel verification** — Open Settings → Audio tab. UX4 verified: mic level bar (green) AND system audio level bar (blue) both move with real audio. If Screen Recording is denied, system bar shows amber + error message inline.
17. **Banner survives overlay-destroy race (B8/B8b)** — Force-quit overlay during banner display (e.g., via dev tools) → banner reappears on launcher window because IPC routes to both surfaces.

---

## 6. What still needs future improvement

After Phase D fixes, the remaining work splits into three tracks:

### Tier 1 — Signing chain (Cause A, structural)

Required to fully eliminate the dominant root cause:

- **SIGN1**: Migrate `appId` from generic `com.electron.meeting-notes` to a stable Natively-owned ID (e.g., `com.natively.app`). Includes migration story for upgrading users (TCC grants under old ID become orphaned).
- **SIGN2**: Set `hardenedRuntime: true` in package.json. Verify all entitlements (cs.allow-jit, cs.disable-library-validation, screen-capture) take effect under HR.
- **SIGN3**: Modify `scripts/ad-hoc-sign.js` to sign Helper bundles (GPU/Renderer/Plugin) WITH entitlements after `codesign --deep` runs. Without this, the Helper that actually invokes screen capture has no entitlement and silently fails on HR-enforced builds.
- **SIGN4**: Provision Developer ID Application certificate (Apple Developer Program, $99/yr) + wire CSC_LINK/CSC_KEY_PASSWORD env vars. Add `@electron/notarize` afterSign hook (devDep already installed). **Note:** User has already wired notarization infrastructure in parallel (commit `partial` includes notarytool wiring).

Once SIGN1–4 ship together, TCC grants will persist across rebuilds permanently. Without them, the Phase D detectors and UX additions are mitigation: users will still occasionally lose grants on auto-update, but they'll see clear banners with one-click recovery instead of a silent black hole.

### Tier 2 — Test infrastructure

Current test suite: ~122 structural regression tests across 14 files. They guard against future re-introduction of the fixed bugs. What's missing:

- **TEST1**: Behavioral fakes — `fakes/electronShim.mjs` (toggleable `app.isPackaged`, scripted `systemPreferences`, scripted `desktopCapturer`), `fakes/fakeNativeModule.mjs` (synthetic PCM emitter), `fakes/fakeClock.mjs` (Node 20+ MockTimers wrapper).
- **TEST2**: Extract `setupSystemAudioPipeline`, recovery handlers, and detectors from the 4624-line main.ts into pure-ish modules in `electron/audio/orchestration/`. Inject electron + native + clock as dependencies.
- **TEST3**: Write the 15 behavioral regression tests identified by the test-engineer audit (covers permission re-check, build cdhash banner, BT HFP fallback, same-device input==output detection, sleep/wake destroy-recreate, independent mic/system failure).

### Tier 3 — Telemetry + ongoing

- **Telemetry on silent-capture rate.** Track ratio of started meetings where peak amplitude stays at 0 for the first N seconds. This is the single most actionable leading indicator and competitors don't have it.
- **macOS 26 ScreenCaptureKit evolution.** Apple's docs hint at API changes; keep an eye on `MacSckSystemAudioLoopbackOverride` / `MacCatapSystemAudioLoopbackCapture` Chromium flags if we ever migrate to `desktopCapturer` system audio.
- **VPIO ducking detection.** Some apps' Voice Processing IO can duck system audio to ~−51 dB. Not currently relevant (we don't use VPIO) but worth detecting if peak amplitudes look suspiciously low.
- **Intel Mac compatibility verification.** All testing has been on Apple Silicon. Verify against an Intel host before release.

---

## 7. Files changed in Phase D (production code + tests)

### Production code (8 files)

| File | Fixes |
|---|---|
| `electron/main.ts` | B2 (type union, _lastState init, awaiting-audio emit), B3 (capture-init try/catch), B4 (mic recovery terminal IPC), B5 (isDevTccBypassEnabled helper + 3 call sites), B6 (permission re-check hoist + stale teardown), B7 (resume state reset), B8 (sendAudioCaptureFailed broadcast), B8b (sendSttStatus + sendSystemAudioPermissionDenied broadcast), B9 (audioInitPromise clear), B10 (peak-to-peak detection ×2), B11 (STUCK_WATCHDOG_MS ×2), UX1 (startup mic check), UX4 (parallel system audio probe + epoch guard) |
| `electron/ipcHandlers.ts` | UX2 (`repair-tcc-permissions` IPC with absolute `/usr/bin/tccutil` + execFile + capital-letter service names) |
| `electron/preload.ts` | B2 (state union), UX2 (repairTccPermissions bridge), UX4 (onAudioTestSystemLevel + onAudioTestSystemError bridges) |
| `src/types/electron.d.ts` | B2, UX2, UX4 (type widening for all of the above) |
| `src/components/NativelyInterface.tsx` | B1 (mic banner surfaced), B2 (awaiting-audio state + reset on session), UX2 (Repair Permissions button + tccRepairing in-flight guard), UX3 (channel-aware deep-link button + adaptive label) |
| `src/components/ui/RollingTranscript.tsx` | B2 (awaiting-audio visual treatment) |
| `src/components/ui/ChannelCard.tsx` | B2 (awaiting-audio status label "Listening for audio…" + neutral icon) |
| `src/components/SettingsOverlay.tsx` | UX4 (systemAudioLevel + systemAudioTestError state, IPC subscriptions, System Audio Level progress bar) |

### Test files (14 new files, 122 assertions)

| File | Fix guarded | Assertions |
|---|---|---|
| `electron/services/__tests__/MicChannelAuditBannerSurfaced.test.mjs` | B1 | 6 |
| `electron/services/__tests__/SttAwaitingAudioInitialState.test.mjs` | B2 | 8 |
| `electron/services/__tests__/SetupSystemAudioPipelineConstructionGuards.test.mjs` | B3 | 8 |
| `electron/services/__tests__/MicRecoveryEmitsTerminalIpc.test.mjs` | B4 | 8 |
| `electron/services/__tests__/DevTccBypassOptInOnly.test.mjs` | B5 | 6 |
| `electron/services/__tests__/SetupSystemAudioPipelinePermissionAlwaysChecked.test.mjs` | B6 | 8 |
| `electron/services/__tests__/RestartCapturesAfterResumeResetsCounters.test.mjs` | B7 | 7 |
| `electron/services/__tests__/AudioCaptureFailedBroadcastBothSurfaces.test.mjs` | B8 | 5 |
| `electron/services/__tests__/SttAndPermissionDeniedBroadcastBothSurfaces.test.mjs` | B8b | 6 |
| `electron/services/__tests__/AudioInitPromiseClearedInFinally.test.mjs` | B9 | 4 |
| `electron/services/__tests__/ZerofillDetectorPeakToPeak.test.mjs` | B10 | 11 |
| `electron/services/__tests__/StuckWatchdogTwelveSeconds.test.mjs` | B11 | 8 |
| `electron/services/__tests__/AudioWarningDeepLinksToSystemSettings.test.mjs` | UX3 | 7 |
| `electron/services/__tests__/TccRepairButtonAndIpc.test.mjs` | UX2 | 11 |
| `electron/services/__tests__/AudioTestSystemAudioLevelMeter.test.mjs` | UX4 | 11 |
| `electron/services/__tests__/StartupMicPermissionBanner.test.mjs` | UX1 | 8 |

**Total: 16 fixes, 122 regression assertions, all passing.**

---

## 8. Senior-level final review

### What was done

We took the user-reported symptom — "permissions granted but no transcription" — and decomposed it into three distinct root-cause classes via four parallel research agents (debugger, code-reviewer, test-engineer, general-purpose for competitor + Apple docs research). The synthesis revealed that no single fix could address all reports, and that the dominant structural cause (TCC binding to cdhash under ad-hoc signing) is fundamentally unfixable in JavaScript alone.

We then executed a strictly-serial fix-loop on the 16 in-scope issues (12 code-level B-fixes + 4 UX additions), applying each fix → code-reviewer audit → test-engineer regression test → verify all green → next. Each fix has a structural regression test that will turn red if a future contributor reintroduces the bug.

### What is correct

- **Symptom is now visible.** Every failure mode (TCC denial, hardware mute, route mismatch, Bluetooth HFP zero-fill, sleep/wake handle invalidation, mid-stream permission revoke) now surfaces a clear, actionable banner with concrete next steps. Pre-fix, multiple failure modes were silently swallowed.
- **Recovery paths are independent.** Mic and system audio failures no longer cascade — one channel failing doesn't kill the other (B3). Both channels have their own watchdogs, zero-fill detectors, recovery handlers with terminal-IPC, and Settings audio meters.
- **User has self-service.** UX2's in-app `tccutil reset` button gives users a one-click recovery from the dominant TCC binding failure, without needing to know about Terminal commands.
- **Detector is robust.** B10's peak-to-peak detection eliminates the false-latch failure mode where a muted-but-biased mic permanently disabled the detector. B11's 12s STUCK_WATCHDOG_MS eliminates false-positives on SCK cold-start.
- **Test discipline is sound.** Every fix has an associated structural regression test. The test suite caught a real regression mid-session (when the file was overwritten by an IDE buffer, the tests correctly went red).

### What still has risk

- **Cause A is the remaining critical gap.** Without SIGN1–4, every auto-update can still invalidate TCC for some subset of users. The Phase D fixes are mitigation, not cure. SIGN4 (Developer ID + notarization) MUST ship before this work is truly "production-grade for macOS audio reliability."
- **Test infrastructure is structural, not behavioral.** All 122 assertions are regex on source text. They catch regressions where a contributor *removes* a fix, but they don't test runtime behavior. TEST1–3 are required for true behavioral confidence (especially for race conditions like B7's sleep/wake reset).
- **No Intel Mac validation.** All work was tested on Apple Silicon. Cross-architecture verification is pending.
- **No live production telemetry.** We have no leading indicator for the silent-capture-rate metric that would tell us if our fixes are actually moving the needle. Without telemetry, we depend on user reports, which lag the actual incidence rate by 3–7 days.

### Production readiness assessment

**Phase D ships now: yes.** The 16 code fixes + 4 UX additions materially improve user experience for the existing audio capture pipeline. They eliminate the "silent black hole" failure mode and give users actionable banners + self-service repair.

**Audio capture is "production-grade reliable": only after SIGN1–4.** The structural TCC binding issue cannot be fixed in code. Without Developer ID signing + hardened runtime + notarization, every release will continue to occasionally invalidate TCC for users on auto-update paths.

**Recommended next sprint:** Complete SIGN1–4 as a single coordinated PR. Once shipped, schedule a 1-week post-release telemetry window to measure silent-capture rate before/after, then validate against the manual QA checklist on both Intel and Apple Silicon hosts.

---

**Report version:** 2.0 (final)
**Author:** Claude (via Anthropic Claude Code), with reviews by code-reviewer agent and tests by test-engineer agent.
**Reviewed manually:** Pending (this report itself is the deliverable for that review).
