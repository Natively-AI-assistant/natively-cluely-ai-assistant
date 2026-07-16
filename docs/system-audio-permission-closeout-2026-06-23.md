# System Audio Permission Closeout - 2026-06-23

## Outcome

Natively system audio capture was rebuilt, reinstalled, granted macOS system-audio permission, and smoke-tested successfully.

## Installed App

- Installed app: `/Applications/Natively.app`
- Bundle id: `com.electron.meeting-notes`
- Previous install backup: `/Applications/Natively.app.backup-20260623-111127`
- Installed plist now includes:
  - `NSAudioCaptureUsageDescription`
  - `NSScreenCaptureUsageDescription`
  - `NSMicrophoneUsageDescription`

## Permissions

Verified TCC grants:

```text
kTCCServiceAudioCapture | com.electron.meeting-notes | auth_value=2
kTCCServiceMicrophone   | com.electron.meeting-notes | auth_value=2
```

System Settings showed Natively enabled under Screen & System Audio Recording. Adding it through the lower System Audio Recording Only picker caused macOS to create the `kTCCServiceAudioCapture` grant.

## Validation

Static checks passed before install:

```text
npm run typecheck:electron
npx tsc --noEmit
git diff --check
```

Installed-app checks passed:

```text
codesign --verify --deep --strict --verbose=2 /Applications/Natively.app
```

Packaged native module exports verified:

```text
SystemAudioCapture: function
getOutputDevices: function
getDefaultOutputDeviceId: function
```

## Smoke Test

Test flow:

- Reopened `/Applications/Natively.app`
- Started a short interview session
- Played synthetic system speech using `say`
- Stopped the session
- Checked `~/Documents/natively_debug.log`
- Checked `~/Library/Application Support/natively/natively.db`

Evidence:

- `SystemAudioCapture` chunks flowed.
- No `zero-filled for 12s` warning appeared.
- Deepgram produced non-empty `STT transcript (interviewer)` events.
- Saved meeting `8f7267da-d6c9-4a45-b1ef-2639e07ac6d4` persisted:
  - `interviewer`: 1 row
  - `user`: 2 rows

The synthetic transcript was imperfect, but the core failure is fixed: system audio was not zero-filled and interviewer rows persisted.

## Remaining Manual Check

Run a real Teams/Zoom/Meet smoke test with the meeting output set to the same device David is listening through, especially AirPods if that is the real interview setup.
