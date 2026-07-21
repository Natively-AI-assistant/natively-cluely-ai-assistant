# Enable speaker diarization in the UI

**Labels:** `wayfinder:task`  
**Map:** [Natively Pro Features — Open Source Reimplementation](../map.md)  
**Blocked by:** 01

## Question

Speaker diarization is fully implemented in `DeepgramStreamingSTT` (`this.diarize` flag, `setDiarize(enabled)` method) but there is no settings toggle to enable it. What IPC channel and settings UI change is needed to wire the toggle end-to-end?

## Scope

- Find or create an IPC handler that calls `sttProvider.setDiarize(enabled)` on the active DeepgramStreamingSTT instance
- Add a toggle in the appropriate settings panel (likely `IntelligenceSettings.tsx` or `AIProvidersSettings.tsx`)
- Persist the setting via `SettingsManager` so it survives restart
- Verify: enable diarization, start a meeting with two audio sources, confirm speaker labels appear in the transcript

## Answer

**Resolution: no new IPC channel needed — the toggle rides the existing intelligence-flag plumbing.**

Diarization already has a fully-wired, persisted feature flag:

- `electron/intelligence/intelligenceFlags.ts:247` registers `speakerDiarizationV1` with persistence
  key `speakerDiarizationV1Enabled` (persisted via `SettingsManager.set`, survives restart).
- `electron/main.ts:2698` (createSTTProvider, NOT edited) already reads
  `isIntelligenceFlagEnabled('speakerDiarizationV1')` at STT construction and calls
  `dg.setDiarization(true)` on the `interviewer` (system-audio) Deepgram instance when on. So the
  flag takes effect on the next meeting start.
- The generic IPC handlers `intelligence-flags:get` / `intelligence-flags:set`
  (`electron/ipcHandlers.ts:4262` / `:4275`) already persist the flag via `setIntelligenceFlag`,
  and are already exposed in `preload.ts` / `electron.d.ts` as
  `getIntelligenceFlags` / `setIntelligenceFlag`. `IntelligenceSettings.tsx` already renders a
  toggle for every flag returned by `intelligence-flags:get`.

**The only missing piece was that `speakerDiarizationV1` had no `FLAG_META` entry, so it fell into
the hidden "dev" tier with a raw key and no description.** Fix (renderer only):

- `src/components/settings/IntelligenceSettings.tsx`:
  - Added a `FLAG_META['speakerDiarizationV1']` entry: label "Separate remote speakers",
    group `Speakers`, tier `advanced`.
  - Added `'Speakers'` to `ADVANCED_GROUP_ORDER` (the render loop at ~line 926 only renders groups
    present in that list — an advanced flag in an unlisted group is silently dropped).

Method name note: the actual method is `setDiarization(enabled)` (not `setDiarize`) at
`DeepgramStreamingSTT.ts:54`.

**Persistence key:** `speakerDiarizationV1Enabled` (via `setIntelligenceFlag('speakerDiarizationV1', …)`).

**Files changed:** `src/components/settings/IntelligenceSettings.tsx` only.

**Verify:** `tsc -p tsconfig.json --noEmit` and `tsc -p electron/tsconfig.json --noEmit` both report
"No errors found".

**How the active STT was reached without touching main.ts:** it was NOT reached live — see blocker.

### Blocker: mid-meeting live toggle requires a main.ts edit (not done)

The ticket also asked for a handler that calls `setDiarization(enabled)` on the *currently-active*
STT instance so a toggle applies mid-meeting. That is not possible without editing `electron/main.ts`,
which is owned by another agent this run:

- The live instances are `AppState.googleSTT` / `AppState.googleSTT_User` — both `private`
  (`main.ts:2645-2646`), and `STTProvider` is a private type in main.ts.
- There is no separate audio-service module holding them, and no existing public accessor exposes
  them (only single-purpose `setRecognitionLanguage`, and private `reconfigureAudio`, neither of
  which is a general STT accessor and neither is IPC-reachable).
- Exposing the instance (a getter or a `setDiarization` fan-out method like the existing
  `setRecognitionLanguage`) is the natural fix but lives in main.ts.

Chosen behavior without that edit: the setting is persisted and applied on the next meeting start,
which satisfies "persist so the STT can read it on init." Follow-up when main.ts is free: add
`public setDiarization(enabled: boolean)` on AppState mirroring `setRecognitionLanguage` (fan out to
`this.googleSTT?.setDiarization?.(enabled)`), and have `intelligence-flags:set` (or a dedicated
`stt:set-diarization`) call it so the toggle also applies to an in-progress meeting.
