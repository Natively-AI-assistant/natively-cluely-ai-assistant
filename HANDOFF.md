# Handoff: Natively Dev App QA And Smoke Test

## Latest Status: Installed App Works, Right-Rail Fallback Confirmed - 2026-06-23

### What changed after install

The rebuilt `/Applications/Natively.app` launched and worked for the live test. Auto-answer generated useful SailPoint-specific responses.

One issue remained: when David asked test questions from his wife's MacBook, the app heard them through the microphone channel and logged them as `user`, not `interviewer`. Because the right-side rail only displayed `interviewer` system-audio transcripts, the answers worked but the right rail stayed blank.

Fix applied:

- `src/components/NativelyInterface.tsx`
  - Added a narrow direct-question fallback for microphone transcripts.
  - Short question-shaped mic transcripts now appear in the right-side Interviewer rail.
  - This avoids dumping normal candidate speech into the right rail.

Rebuilt and reinstalled:

```bash
npx tsc --noEmit
npm run build
node scripts/ensure-sharp-mac-deps.js && npx electron-builder --mac dir --arm64
mv /Applications/Natively.app /Applications/Natively.app.backup-20260623T091708-question-rail
ditto release/mac-arm64/Natively.app /Applications/Natively.app
codesign --verify --deep --strict --verbose=2 /Applications/Natively.app
/usr/bin/open /Applications/Natively.app
git diff --check
```

Confirmed user-visible result:

- Right rail showed mic-fallback interviewer questions, including:
  - `Tell me why you applied`
  - `some things some examples that you've built? Can you share those?`
- The answer panel generated appropriate responses.

### Remaining caveat

The yellow `System Audio Not Detected` banner is still valid. System audio capture is running, but the incoming system-audio stream is silent/zero-filled in this test route. The app now has a useful mic-question fallback, but this does not prove true system-audio capture is fixed.

If system audio needs to work without fallback, check macOS Screen Recording permission and the meeting app output route first.

## Latest Status: `/Applications/Natively.app` Rebuilt And Replaced - 2026-06-23

### What changed

Rebuilt the production Electron app from this working repo and replaced the installed Applications bundle.

Commands run:

```bash
npx tsc --noEmit
npm run app:build
node scripts/ensure-sharp-mac-deps.js && npx electron-builder --mac dir --arm64
mv /Applications/Natively.app /Applications/Natively.app.backup-20260623T091110
ditto release/mac-arm64/Natively.app /Applications/Natively.app
codesign --verify --deep --strict --verbose=2 /Applications/Natively.app
/usr/bin/open /Applications/Natively.app
git diff --check
```

### Build note

`npm run app:build` rebuilt the web app and Electron files, but stopped at the native Rust step because `cargo` and `rustup` were not available on PATH in this shell. The repo already had the needed local Apple Silicon artifact:

- `native-module/index.darwin-arm64.node`

So the successful local packaging command was:

```bash
node scripts/ensure-sharp-mac-deps.js && npx electron-builder --mac dir --arm64
```

This produced:

- `release/mac-arm64/Natively.app`

### Install result

The old installed app was preserved at:

- `/Applications/Natively.app.backup-20260623T091110`

The new installed app is now:

- `/Applications/Natively.app`

`codesign --verify --deep --strict --verbose=2 /Applications/Natively.app` passed.

The installed app launched successfully from `/Applications/Natively.app`.

Fresh production log evidence from `/Users/david/Documents/natively_debug.log`:

- Start URL is now `file:///Applications/Natively.app/Contents/Resources/app.asar/dist/index.html`.
- Stored OpenAI key loaded without printing the key.
- Default model loaded as `gpt-5.4-mini`.
- LLM switched to `gpt-5.4-mini`.
- App reached launcher state.

### Still needs David/manual verification

Run one short real call/audio smoke test from the installed app:

1. Confirm macOS output and system output are `Mac mini Speakers`.
2. Launch Natively from Applications.
3. Confirm the SailPoint profile loads.
4. Start a short Zoom/Teams-style audio test.
5. Confirm Zoom/system audio appears as `STT transcript (interviewer)`.
6. Confirm auto-answer produces a visible answer.

Log caution: the fresh launch reported `Screen recording permission status at startup: denied`. If interviewer/system capture does not work, first check macOS Screen Recording permission for the rebuilt `/Applications/Natively.app`.

## Latest Status: Dev App Works, Installed App Needs Rebuild/Replacement - 2026-06-23

### What happened

David quit the installed `/Applications/Natively.app` after the installed app repeatedly failed to capture Zoom interviewer/system audio.

Installed app behavior:

- SailPoint profile loaded.
- `gpt-5.4-mini` loaded.
- OpenAI key was present and connection test had worked.
- Zoom questions from the other Mac were transcribed as `user`, not `interviewer`.
- System audio/interviewer channel showed zero-filled audio chunks.
- Even after changing macOS output and system output to `Mac mini Speakers`, the installed app still did not produce interviewer transcript or answers.

The repo dev app was then launched with:

```bash
npm run app:dev
```

Dev app behavior:

- Loaded the same local DB at `/Users/david/Library/Application Support/natively/natively.db`.
- Loaded the SailPoint profile: `ictx_sailpoint_ai_workflow_architect_20260623_1000`.
- Loaded the stored OpenAI key without printing it.
- Used default/session model `gpt-5.4-mini`.
- Started with audio `{ inputDeviceId: null, outputDeviceId: null }`, then resolved to `input=default`, `output=default`.
- CoreAudio tap targeted `BuiltInSpeakerDevice`.
- Zoom/system audio was captured correctly as `STT transcript (interviewer)`.
- Auto-answer worked and displayed a SailPoint-specific answer in the overlay.

Confirmed working user-visible result:

- Interviewer transcript showed: `Hey, David. Can you tell me why you applied for the position at SailPoint?`
- Generated answer began: `It stood out to me because it sits right in the lane I've been moving toward...`

### Key learning

Use the repo dev app for the SailPoint call if needed. The installed app in `/Applications` appears stale or behaviorally different from the repo build that contains the latest audio route fixes.

Working audio state during the successful dev-app test:

- macOS output: `Mac mini Speakers`
- macOS system output: `Mac mini Speakers`
- input: `David's AirPods Pro`
- Natively dev app system capture: `BuiltInSpeakerDevice`

### Shutdown note

After documenting this, the dev session should be shut down so the next chat starts cleanly. Confirm with:

```bash
lsof -nP -iTCP:5180 -sTCP:LISTEN
ps aux | rg -i "(electron|vite|npm run app:dev|natively)"
```

### Exact prompt for the next chat

```text
Continue in `/Users/david/Code/05 Tools & Utilities/natively-cluely-ai-assistant`.

Read the top section of `HANDOFF.md` titled "Latest Status: Dev App Works, Installed App Needs Rebuild/Replacement - 2026-06-23".

Goal:
Update or replace `/Applications/Natively.app` so David can launch Natively normally from Applications and get the same behavior that worked in `npm run app:dev`.

Known working dev-app result:
- `npm run app:dev` worked.
- SailPoint profile loaded from the local SQLite DB.
- `gpt-5.4-mini` loaded from stored OpenAI credentials.
- Zoom/system audio captured as `interviewer`.
- Auto-answer generated a SailPoint-specific answer.

Known installed-app failure:
- `/Applications/Natively.app` did not capture interviewer/system audio correctly.
- It transcribed Zoom questions as `user`, not `interviewer`.
- It showed zero-filled system audio chunks.

Start with:
- `git status --short --branch`
- `lsof -nP -iTCP:5180 -sTCP:LISTEN`
- `ps aux | rg -i "(electron|vite|npm run app:dev|natively)"`
- inspect `package.json` build scripts and current release/app packaging paths

Preserve dirty work. Do not reset, delete, commit, push, expose secrets, or overwrite `/Applications/Natively.app` without first making a backup of the current app bundle. The likely task is to build/package this repo's current app and install/replace the Applications bundle, then verify launched-from-Applications behavior matches the successful dev app test.

After updating the installed app, verify:
- Launch from `/Applications/Natively.app`.
- SailPoint profile loads.
- `gpt-5.4-mini` is active.
- macOS output and system output are `Mac mini Speakers`.
- Zoom/system audio appears as `STT transcript (interviewer)`.
- Auto-answer generates a visible answer.
- Run `npx tsc --noEmit` and `git diff --check`.
- Update `HANDOFF.md` with exact install/build steps and result.
```

## Latest Status: SailPoint Interview Setup + OpenAI GPT 5.4 Mini - 2026-06-23

### What changed

Created a new SailPoint interview setup in the local Natively database:

- Role: `AI Workflow Architect`
- Company: `SailPoint`
- Interview time: Tuesday, June 23, 2026, 10:00-10:30 AM Mountain
- Interviewer: Michelle Herbert, Senior Technical Recruiter
- Format: Microsoft Teams video call
- Model: `gpt-5.4-mini`
- Answer length: `Balanced`
- Tone: `Confident`
- Resume PDF: `/Users/david/Code/05 Tools & Utilities/job_search_hq/resumes/tailored/sailpoint_ai_workflow_architect/David_Burgess_SailPoint_AI_Workflow_Architect_Resume.pdf`

Database rows:

- `interview_roles.id`: `role_sailpoint_ai_workflow_architect_20260623_1000`
- `interview_contexts.id`: `ictx_sailpoint_ai_workflow_architect_20260623_1000`
- `is_last_used`: `1`

The previous Cresta and Workstream profiles were preserved. Only the last-used flag was moved to SailPoint.

Backup created before the write:

- `/Users/david/Library/Application Support/natively/natively.db.backup-before-sailpoint-medium-20260623T141836Z`

### Source context used

SailPoint context came from `job_search_hq`:

- `jobs/postings/sailpoint - ai_workflow_architect.md`
- `jobs/meeting_prep/sailpoint/SAILPOINT_MICHELLE_HERBERT_RECRUITER_SCREEN.md`
- `resumes/tailored/sailpoint_ai_workflow_architect/resume.md`
- `resumes/tailored/sailpoint_ai_workflow_architect/reviewer_note.md`
- `resumes/tailored/sailpoint_ai_workflow_architect/criteria_map.md`

The optional interview context includes the recruiter-screen guidance, compensation language, risks to avoid, claims guardrails, and the criteria/reviewer notes. It should steer live answers toward workflow architecture, ROI prioritization, validation, stakeholder adoption, and honest AI-assisted technical framing.

### OpenAI status

Installed Natively app evidence from `/Users/david/Documents/natively_debug.log`:

- OpenAI API key was saved in the app without exposing the key.
- OpenAI connection test was run from Settings.
- OpenAI preferred model was set to `gpt-5.4-mini`.
- Default model was set to `gpt-5.4-mini`.
- Runtime switched to `gpt-5.4-mini`.

I did not print or inspect plaintext API keys.

### Validation

Current DB verification shows SailPoint as the only last-used profile:

- `SailPoint / AI Workflow Architect`
- context `ictx_sailpoint_ai_workflow_architect_20260623_1000`
- model `gpt-5.4-mini`
- answer length `Balanced`
- tone `Confident`
- resume file `David_Burgess_SailPoint_AI_Workflow_Architect_Resume.pdf`

Still needed before the actual call:

1. In the installed Natively app, confirm the role dropdown/current setup shows SailPoint.
2. Run one quick manual answer smoke test with OpenAI `gpt-5.4-mini`.
3. If the app still shows Cresta, quit and reopen Natively so it reloads the updated SQLite profile.

Do not use Gemini for this interview unless OpenAI fails. The current Gemini project still has the earlier prepay/billing block.

## Latest Status: Gemini Paid-Key Model Options - 2026-06-23

### What changed

David has Google AI Pro plus Google Developer Program credits active on `My Billing Account 1`.
Screenshots showed a `$10 monthly Gen AI & Cloud credits` benefit available and a Cloud Billing credit row with `$10.00` remaining.
David created a new Google AI Studio API key under a new project linked to that billing account.

Repo changes made in this session:
- `src/utils/modelUtils.ts`
  - Added selectable Gemini model IDs:
    - `gemini-3-flash-preview`
    - `gemini-3.1-flash-lite`
    - `gemini-2.5-flash`
    - `gemini-2.5-flash-lite`
  - Kept existing Gemini options:
    - `gemini-3.5-flash`
    - `gemini-3.1-flash-lite-preview`
    - `gemini-3.1-pro-preview`
  - Added practical labels/descriptions for interview use.
- `src/components/ui/ModelSelector.tsx`
  - Added display labels for the new Gemini model IDs.
- `src/components/interview/InterviewWorkspace.tsx`
  - Added display labels for the new Gemini model IDs in the overlay command bar.

Validation already passed:
- `npx tsc --noEmit`

### Key learnings

- The Cresta interview failure was not audio capture. It was Gemini free-tier quota exhaustion on `gemini-3.5-flash`, with `429 RESOURCE_EXHAUSTED` and free-tier `generate_content` limit `20`.
- Google documentation says API keys inherit the billing tier/status of their project. If the new AI Studio project is correctly linked to the billing account, the key should use paid-tier Gemini limits rather than the free-tier limit that failed.
- The Google Developer Program / AI Pro credit should be enough for occasional interview use. The best budget/default model from the attached pricing is likely `gemini-3-flash-preview`, with `gemini-3.1-flash-lite` or `gemini-2.5-flash-lite` as cheaper fallbacks.
- `gemini-3.5-flash` may be higher quality, but it is meaningfully more expensive than `gemini-3-flash-preview` for output-heavy live interview answers.
- Avoid `gemini-3.1-pro-preview` as the live-interview default unless deep reasoning is clearly needed.

### Recommended manual test now

1. Start with `git status --short --branch` and preserve all dirty work.
2. Confirm the app is not already running:
   - `lsof -nP -iTCP:5180 -sTCP:LISTEN`
   - `ps aux | rg -i "(electron|vite|npm run app:dev|natively)"`
3. Launch the app with `npm run app:dev`.
4. In Natively Settings, add the new paid Google AI Studio API key under Gemini. Do not print or expose the key in logs or chat.
5. Select `Gemini 3 Flash` / `gemini-3-flash-preview`.
6. Run a short manual live-answer smoke test:
   - Start an interview session.
   - Ask an interview-style question, for example: "Tell me about a time you used AI to improve a messy workflow."
   - Confirm the answer generates.
   - Check `/Users/david/Documents/natively_debug.log` for the selected model ID and absence of `429 RESOURCE_EXHAUSTED`.
7. If `gemini-3-flash-preview` fails due to model availability, try in order:
   - `gemini-3.1-flash-lite`
   - `gemini-2.5-flash`
   - `gemini-2.5-flash-lite`
   - `gemini-3.5-flash`
8. After testing, run:
   - `npx tsc --noEmit`
   - `git diff --check`
9. Summarize which Gemini model actually works with the paid key, whether any 429/quota errors appear, and whether answer quality is acceptable for live interviews.

### Manual test result - 2026-06-23

Test path:
- Launched the dev app with `npm run app:dev`, then relaunched the same dev app pieces with Electron remote debugging enabled so the renderer loaded `http://localhost:5180`.
- Confirmed encrypted Gemini credentials were present; no API key was printed or copied into this handoff.
- Used the real renderer IPC bridge:
  - `window.electronAPI.setModel('gemini-3-flash-preview')`
  - `window.electronAPI.submitManualQuestion('Tell me about a time you used AI to improve a messy workflow.')`

Outcome:
- `gemini-3-flash-preview` selected successfully in the running app.
- The manual live-answer smoke test did not generate an answer.
- `/Users/david/Documents/natively_debug.log` showed Gemini `429 RESOURCE_EXHAUSTED` with this billing message: `Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing.`
- This is not a model-availability failure. It means the new AI Studio project/key is still blocked by billing/prepay state, even though Google credits appear attached at the billing-account level.
- Because the failure is billing/prepay, fallback Gemini models were not tested; they would likely hit the same project billing gate.

Safety note:
- The existing Settings "Test connection" path can log Axios request headers when Gemini returns a 429. Key-shaped Gemini values were redacted from `/Users/david/Documents/natively_debug.log` after this was observed.

Validation after this test:
- `npx tsc --noEmit` passed.
- `git diff --check` passed.
- Port `5180` was clear after stopping the dev app.
- No Natively/Electron dev process was left running.

Next recommendation:
- In AI Studio, open the project used by the current Gemini API key and resolve the prepay/billing state. Look specifically for `Set up Prepay`, an inactive/zero prepay balance, or credits not attached to the selected project.
- After the project shows usable paid/prepay balance, rerun the same smoke test with `gemini-3-flash-preview`.
- Before using Settings "Test connection" again, patch its error logging so Axios request headers are not written to stdout or `natively_debug.log`.

Exact prompt for the new continuation thread:

```text
Continue in `/Users/david/Code/05 Tools & Utilities/natively-cluely-ai-assistant`.

Read the top section of `HANDOFF.md` titled "Latest Status: Gemini Paid-Key Model Options - 2026-06-23", then proceed with the manual test there.

Context:
- David has Google AI Pro / Google Developer Program `$10 monthly Gen AI & Cloud credits` active in a billing account.
- He created a new Google AI Studio API key under a project linked to that billing account.
- The previous Cresta interview failure was Gemini free-tier `429 RESOURCE_EXHAUSTED`, not audio capture.
- This thread added Gemini selectable model IDs in:
  - `src/utils/modelUtils.ts`
  - `src/components/ui/ModelSelector.tsx`
  - `src/components/interview/InterviewWorkspace.tsx`
- `npx tsc --noEmit` already passed after the model-list edit.

Start by running:
- `git status --short --branch`
- `lsof -nP -iTCP:5180 -sTCP:LISTEN`
- `ps aux | rg -i "(electron|vite|npm run app:dev|natively)"`

Preserve dirty work. Do not reset, delete, commit, push, or expose API keys.

Goal:
Launch `npm run app:dev`, have David enter/select the paid Gemini key if needed, select `gemini-3-flash-preview`, and run a short live-answer smoke test. Confirm the app generates an answer and `/Users/david/Documents/natively_debug.log` does not show `429 RESOURCE_EXHAUSTED`. If `gemini-3-flash-preview` fails due to model availability, test `gemini-3.1-flash-lite`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, then `gemini-3.5-flash`.

After testing, run `npx tsc --noEmit` and `git diff --check`, then update `HANDOFF.md` with the tested model, outcome, errors, and next recommendation.
```

## Latest Status: AirPods Live-Interview QA Fixes - 2026-06-22

### Cresta Zoom Incident Follow-Up - 2026-06-22

David reported that the real Cresta Zoom interview did not appear to work correctly.

Log diagnosis from `/Users/david/Documents/natively_debug.log`:
- This was not primarily an AirPods capture failure.
- The Cresta interview started at `2026-06-22T17:00:12.691Z` with `interviewContextId: ictx_cresta_ai_deployment_manager_20260622_1100`, `modelId: gemini-3.5-flash`, AirPods output `70-AE-D5-C0-FE-9A:output`, and `Audio pipeline start completed. systemStarted=true, micStarted=true`.
- Natively captured both sides: `STT transcript (interviewer)` and `STT transcript (user)` continued through the meeting.
- The first several answer generations worked and logged `[IntelligenceEngine] Temporal RAG` plus `[SessionTracker] addAssistantMessage called with:`.
- The failure started around `2026-06-22T17:07:33Z` with repeated Gemini `429 RESOURCE_EXHAUSTED` errors: free-tier `generate_content` requests exhausted, limit `20`, model `gemini-3.5-flash`.
- After quota exhaustion, the user-question fallback was too broad and treated parts of David's own answers as new interviewer questions, causing repeated failed generation attempts and fallback text like `Could you repeat that?`.

Follow-up fix:
- `electron/IntelligenceEngine.ts`
  - Keeps normal interviewer auto-answer behavior.
  - Narrows the AirPods/user fallback to short, direct question-shaped utterances only.
  - Adds a 60 second quota cooldown after a detected LLM quota/rate-limit error, so auto-answer stops retrying while the provider is rejecting requests.
- `electron/llm/WhatToAnswerLLM.ts`
  - Rethrows quota/rate-limit errors instead of converting them into a normal fallback answer, allowing `IntelligenceEngine` to pause auto-answer.

Validation after this follow-up fix:
- `npm run typecheck:electron`
- `npx tsc --noEmit`
- `git diff --check`

Current branch: `codex/split-interview-setup`

Important constraints for future Codex sessions:
- Preserve dirty work. Do not reset, delete, commit, or push unless David explicitly asks.
- Start every continuation with `git status --short --branch`.
- Use `/Users/david/Documents/natively_debug.log` as the runtime source of truth.
- The current goal is David's real AirPods interview setup: he hears the interviewer through AirPods, the interviewer hears David through the AirPods mic, and Natively captures interviewer/system audio and shows live answer suggestions.

Dirty files expected after the latest work:
- `HANDOFF.md`
- `electron/main.ts`
- `electron/IntelligenceEngine.ts`
- `electron/WindowHelper.ts`
- `src/App.tsx`
- `src/components/SettingsOverlay.tsx`
- `src/index.css`

Latest fixes made:
- `electron/main.ts`
  - Avoids blocking on stale saved AirPods-style device IDs during meeting start.
  - Falls back to macOS `default` devices for saved AirPods/CoreAudio Bluetooth route IDs that may be stale.
  - Broadcasts `device-selection-applied` when fallback happens.
  - Adds audio pipeline step logging and a 12 second init timeout.
  - Rebuilds native system-audio and microphone captures for each new meeting start, even when selected devices are unchanged. This fixes the restart-after-stop hang where the second meeting got stuck after `MicrophoneCapture Starting native capture...`.
- `src/App.tsx`
  - Clears stale preferred input/output device IDs from `localStorage` when main reports a fallback.
- `src/components/SettingsOverlay.tsx`
  - Clears stale preferred device IDs and resets the settings UI to `default` after fallback.
- `electron/IntelligenceEngine.ts`
  - Lowers the interviewer-question auto-answer confidence floor from `0.70` to `0.50`, so AirPods/system-audio finals around `0.58` still trigger when text looks question-like.
- `electron/WindowHelper.ts`
  - Starts/restores the overlay at a readable default height instead of a 1px/tiny height.
- `src/index.css`
  - Gives the interview workspace/grid stable readable heights instead of relying on startup `100vh` math that collapsed the answer/transcript area.

Validation already passed after these fixes:
- `npm run typecheck:electron`
- `npx tsc --noEmit`
- `git diff --check`

Real QA already completed:
1. AirPods were connected and macOS default input/output reported `David’s AirPods Pro`.
2. `npm run app:dev` launched successfully.
3. Start interview no longer hangs on stale AirPods-style saved device IDs.
4. Logs showed AirPods mic route: `Device: David’s AirPods Pro`, 24kHz.
5. Logs showed AirPods/system-output CoreAudio tap: `70-AE-D5-C0-FE-9A:output`.
6. Controlled `say` audio through AirPods produced `STT transcript (interviewer)` events.
7. Auto-answer triggered after the confidence threshold fix and visible overlay showed a `SAY THIS` answer.
8. David spoke into AirPods during QA; logs showed `STT transcript (user)` with high confidence.
9. Manual `Answer`, `Clarify`, `Brainstorm`, and `Follow Up` were smoke-tested and produced visible/logged responses.
10. Overlay visibility bug was reproduced from David's screenshot and fixed; real Electron visual check confirmed the full workspace is visible: warning banner, question context, answer area, interviewer rail, and action bar.
11. Restart-after-stop bug was reproduced and fixed. Real Electron QA passed: start meeting, end meeting, wait for finalize, start meeting again.
12. The second start rebuilt both captures, connected both STT streams, started the AirPods output watcher, and logged `Audio pipeline start completed. systemStarted=true, micStarted=true`.
13. Post-restart audio flowed: system-audio chunks, mic chunks, and STT transcript events appeared instead of hanging.
14. The dev app was stopped cleanly after QA. Port `5180` was free and no lingering Electron/Vite app process remained.

Known caveats:
- Synthetic `say` audio can transcribe poorly through AirPods and can be contaminated by room speech. Use it to prove capture flow, not answer quality.
- Real meeting routing still needs one final real Zoom/Meet/Teams check. If real meeting audio behaves worse than the controlled AirPods test, inspect meeting-app speaker/mic routing and noise suppression first.
- The app may show a temporary `Microphone Not Available` warning if David is silent for 8 seconds. That warning is not the same as the restart hang if mic chunks/transcripts appear afterward.
- Development mode may log screen recording as denied while still allowing capture; trust the live audio pipeline evidence.

Best next test:
1. Confirm macOS default input and output are `David’s AirPods Pro`.
2. Launch `npm run app:dev`.
3. In Zoom/Meet/Teams, set Speaker and Microphone to `David’s AirPods Pro`.
4. Start Natively with the Workstream interview setup.
5. Have real meeting/interviewer audio play through AirPods.
6. Confirm `/Users/david/Documents/natively_debug.log` shows:
   - `[Main] Starting Meeting...`
   - `Audio pipeline step: reconfigureAudio`
   - `Audio pipeline start completed. systemStarted=true, micStarted=true`
   - `DefaultOutputWatcher` initial output `70-AE-D5-C0-FE-9A:output` or the current AirPods output UID
   - `STT transcript (interviewer)` final or stable interim
   - `[IntelligenceEngine] Temporal RAG`
   - `[SessionTracker] addAssistantMessage called with:`
7. Confirm the visible overlay shows transcript context and a suggested answer.
8. End the meeting, wait for finalize, start again, and confirm the second start also reaches `Audio pipeline start completed`.

Exact prompt for a future continuation:

```text
Continue the Natively AirPods/live-interview QA work in `/Users/david/Code/05 Tools & Utilities/natively-cluely-ai-assistant`.

Start by reading the latest section of `HANDOFF.md`, then run:
- `git status --short --branch`
- `lsof -nP -iTCP:5180 -sTCP:LISTEN`
- `ps aux | rg -i "(electron|vite|npm run app:dev|natively)"`
- inspect the newest useful tail of `/Users/david/Documents/natively_debug.log`

Preserve dirty work. Do not reset, delete, commit, or push unless David explicitly asks.

Main goal: verify the real Zoom/Meet/Teams AirPods path. Speaker and microphone should both be `David’s AirPods Pro`; Natively should capture interviewer/system audio, capture David's AirPods mic, show live transcript/answer content in the overlay, and survive start/end/start without hanging.

If a bug appears, fix the smallest reliable path, validate with `npm run typecheck:electron`, `npx tsc --noEmit`, and `git diff --check`, then summarize exactly what changed and what David should manually test.
```

## Context
- Repo: `/Users/david/Code/05 Tools & Utilities/natively-cluely-ai-assistant`
- Branch at handoff creation: `codex/split-interview-setup`
- Closeout commit already created: `095715c fix: stabilize interview auto answer`
- Date: 2026-06-11
- Goal for next chat: run the dev app and verify the recent live-interview fixes end to end.

## Current Repo State At Handoff Creation
- `git status --short` was clean before this handoff file was updated.
- The closeout commit included:
  - auto-answer debounce and multi-segment interviewer-question handling in `electron/IntelligenceEngine.ts`
  - intelligence event delivery to both launcher and overlay in `electron/main.ts`
  - stale system-audio banner clearing when interviewer transcript arrives in `src/components/NativelyInterface.tsx`
  - existing Gemini 3.5 / live interview context changes
  - this repo's previous `HANDOFF.md`
- This new handoff update will make the worktree dirty unless it is committed later. Do not treat other files as dirty unless `git status --short` shows them.

## What Needs Testing
Verify that Natively works after the closeout commit, especially:

1. Dev app starts successfully.
2. Starting an interview session opens the overlay.
3. System audio interviewer transcripts appear in the right rail / rolling transcript.
4. Auto-answer generates without clicking `Answer` when an interviewer question appears.
5. The generated answer appears in the visible overlay, not only in a hidden launcher window.
6. If `System Audio Not Detected` or a similar warning appears, it clears once real interviewer transcript text arrives.
7. Manual `Answer` still works as a fallback.
8. No obvious regressions in `Clarify`, `Brainstorm`, and `Follow Up` buttons.

## Recommended Test Tools
- Use the repo scripts first:
  - `npm run typecheck:electron`
  - `npx tsc --noEmit`
  - `git diff --check`
  - `npm run build`
- Use the dev app:
  - `npm run app:dev`
- Use Browser / in-app browser tools if available to inspect local renderer surfaces.
- Use shell/log inspection for Electron runtime evidence:
  - `/Users/david/Documents/natively_debug.log`
- Use Computer Use or Chrome only if needed for real local app interaction that cannot be tested from logs or Browser.
- If testing with Zoom requires David's live meeting session or credentials, ask David to start/join the Zoom meeting and then continue from logs/screenshots.

## Suggested Manual Smoke Test Script
1. Run `npm run app:dev`.
2. Wait for Vite and Electron to finish launching.
3. Confirm the launcher appears and no startup errors are repeating in the terminal.
4. Start an interview session using the Workstream/Revenue Ops context if it is still available.
5. Use Mac speakers/default output for the cleanest system-audio test. Avoid AirPods for the first pass.
6. Play a short spoken YouTube clip or another system-audio source.
7. Confirm `STT transcript (interviewer)` appears in `/Users/david/Documents/natively_debug.log`.
8. Confirm the same interviewer text appears in the overlay transcript UI.
9. Ask or play a clear interviewer-style question, for example:
   - "Hey David, how do you handle a situation where AI-generated code breaks or produces unexpected output?"
10. Wait 1-3 seconds after the transcript finalizes.
11. Confirm auto-answer streams into the overlay without clicking `Answer`.
12. Confirm no stale `System Audio Not Detected` banner remains after interviewer text is visible.
13. Click `Answer` manually once and confirm it still generates.
14. Try `Clarify`, `Brainstorm`, and `Follow Up` once each if there is enough transcript context.
15. End the meeting and confirm the app returns to launcher without errors.

## Runtime Evidence To Check
Read the newest tail of:

```bash
tail -n 300 /Users/david/Documents/natively_debug.log
```

High-signal lines to look for:
- `[Main] Starting Meeting...`
- `Audio pipeline start completed. systemStarted=true`
- `STT transcript (interviewer) final`
- `[IntelligenceEngine] Temporal RAG`
- `[SessionTracker] addAssistantMessage called with:`
- no repeated `Object has been destroyed`
- no repeated STT auth/quota failures
- no repeated audio capture terminal failures after interviewer transcripts begin

## Recent Bug Details
- Before the fix, Deepgram could split one interviewer question into multiple final segments.
- The old auto-answer path could start generation on the first half of the question and miss the second half because the engine was no longer idle.
- The fix added a 1.2 second debounce and builds the question from recent interviewer turns.
- Before the fix, some intelligence events were sent only to `getMainWindow()`, while transcripts went to both launcher and overlay.
- The fix broadcasts intelligence token batches and final intelligence results to both launcher and overlay.
- Before the fix, the system-audio warning could remain after real interviewer transcript text appeared.
- The fix clears that warning when non-empty interviewer transcript arrives in the renderer.

## If Something Fails
- Preserve evidence first:
  - exact command run
  - terminal error
  - newest relevant log lines from `/Users/david/Documents/natively_debug.log`
  - screenshot if UI behavior is wrong
- Do not reset or clean the repo.
- Make the smallest reliable fix.
- Re-run:
  - `npm run typecheck:electron`
  - `npx tsc --noEmit`
  - `git diff --check`
  - `npm run build` if code changed
- If the fix works and David asks for closeout, commit with a short message.

## Known Non-Blockers
- `npm run build` may emit Vite warnings about chunk size or modules that are both dynamic and static imports. These were present during closeout and are not blockers unless a new build error appears.
- Mic capture may fail if the selected AirPods/default input is unavailable. This does not block system-audio interviewer testing if `systemStarted=true` and interviewer transcripts appear.

## Exact Prompt For The New Chat
```text
Continue from the repo handoff in `/Users/david/Code/05 Tools & Utilities/natively-cluely-ai-assistant/HANDOFF.md`.

Run the dev app and do the full QA/smoke test pass described there. Use whatever tools, skills, apps, or connectors are needed. Start by inspecting the current git state and the latest `/Users/david/Documents/natively_debug.log`, then run the validation commands and launch `npm run app:dev`.

Main things to verify:
- Natively auto-generates an answer after an interviewer question appears; I should not have to click `Answer` for the normal hands-free path.
- The answer appears in the visible overlay.
- The `System Audio Not Detected` banner clears once interviewer transcripts start appearing.
- Manual `Answer`, `Clarify`, `Brainstorm`, and `Follow Up` still basically work.

Preserve the worktree. Do not reset, delete, push, or expose secrets. If you need me to join/start a Zoom meeting or provide live audio, tell me exactly what to do and then continue from the runtime logs. If you find a bug, fix the smallest reliable path, validate it, and give me a repo closeout summary. Do not commit unless I explicitly ask in that chat.
```
