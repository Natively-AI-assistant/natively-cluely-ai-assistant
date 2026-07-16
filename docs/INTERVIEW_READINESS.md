# Interview Readiness and Troubleshooting

This is the practical checklist for using this local Natively build in a real interview. Run the dry test before the interview day; audio permissions and device routing are the most common failure points.

## Five-minute readiness check

1. Quit any other copy of Natively so only one instance is running.
2. In **System Settings → Privacy & Security**, confirm Natively is enabled for:
   - Microphone
   - Screen & System Audio Recording
   - Accessibility
3. Quit and reopen Natively after changing a macOS permission.
4. Open **Settings → Audio**:
   - Select the microphone you will actually use.
   - Select the same output device used by Zoom, Teams, or Meet.
   - Run the microphone-level test and confirm the meter moves.
5. Confirm one streaming transcription provider and one AI provider are configured.
6. Open the interview setup and confirm the company, role, AI model, resume, and optional context are correct.
7. Start a short practice session:
   - Speak one sentence and confirm your microphone channel transcribes it.
   - Play spoken audio through the meeting output and confirm it appears as the interviewer channel.
   - Ask for one answer and confirm the response is relevant to the selected role.
   - Stop the session and confirm it appears in history.

Provider connection tests and a live practice session can make small billable API requests. Use them only when you intend to test the configured service.

## Interview-day checklist

- Plug the Mac into power and use a stable network.
- Open the meeting app first and verify its microphone and speaker choices.
- Open Natively and verify the same devices under **Settings → Audio**.
- Confirm the intended interview setup is selected before starting.
- Start Natively a few minutes early and watch for both audio-channel status indicators.
- Keep the show/hide shortcut available. The current shortcut is shown in **Settings → Hotkeys** and **Help**; do not rely on a memorized default if it has been customized.

## What the screenshot shortcuts do

- **Take Screenshot** queues the current screen as context. It does not contact the AI by itself.
- **Process Screenshots** asks the AI about screenshots already in the queue.
- **Capture Screen & Ask AI** captures and processes in one step.

Use **Settings → Hotkeys** as the source of truth for the actual keys.

## Troubleshooting

### The microphone meter does not move

1. Confirm the correct microphone is selected in both macOS and Natively.
2. Check **Privacy & Security → Microphone**.
3. Quit and reopen Natively after granting permission.
4. Disconnect and reconnect Bluetooth audio if the device disappeared or changed modes.

### The interviewer channel is empty

1. Confirm the meeting app and Natively use the same output device.
2. Check **Privacy & Security → Screen & System Audio Recording**.
3. Quit and reopen Natively after changing the permission.
4. Play spoken audio through that output device and watch for a system-audio warning.
5. If macOS is returning silent audio, switch both the meeting app and Natively to the Mac speakers for a controlled test.

### Transcription starts and then stops

1. Check the network connection.
2. Confirm the configured transcription provider is still selected.
3. Stop the session cleanly, wait a few seconds, and start a new practice session.
4. If it repeats, enable **Settings → General → Verbose debug logging**, reproduce once, and note the time of the failure.

### Audio transcribes but no useful answer appears

1. Confirm the selected AI provider has a valid model and API key.
2. Confirm the intended interview setup is active.
3. Check that the role, company, resume, and optional context are not stale.
4. Try a direct **What to Answer** action. If that fails too, inspect the debug log for a provider status code.

### A global shortcut does nothing

1. Check its current binding under **Settings → Hotkeys**.
2. Confirm Accessibility permission is enabled.
3. Change the binding if macOS or another app already uses it.
4. Keep Natively visible until the replacement shortcut is confirmed.

### The app will not close cleanly

Use **Quit Natively** from the app rather than only closing a window. During development, press `Ctrl+C` in the terminal that launched `npm run app:dev` after Electron exits.

## Local data and privacy

Natively keeps its database, recordings, screenshots, settings, encrypted credentials, and model-routing state under:

```text
~/Library/Application Support/natively/
```

The main debug log is:

```text
~/Documents/natively_debug.log
```

Do not post either location publicly without reviewing the contents. Logs can contain interview text, file paths, model names, and provider error messages. API credentials are stored in `credentials.enc` using Electron safe storage; do not copy or edit that file manually.

## Developer verification

From the repository root:

```bash
npm ci
npm test
npm run typecheck:electron
npm exec -- tsc --noEmit
npm run build
npm run app:dev
```

`npm run app:build` also rebuilds the native Rust audio module. That step requires Rust/Cargo and is separate from the TypeScript/Electron build.

## When reporting a problem

Include:

- whether the development app or `/Applications/Natively.app` was used;
- the meeting app;
- selected microphone and output device;
- whether your voice, interviewer audio, or both failed;
- the approximate failure time;
- the exact visible error message.

Never include API keys or the encrypted credentials file.
