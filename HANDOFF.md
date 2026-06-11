# Handoff: Natively Live Zoom Audio Test

## Context
- Repo: `/Users/david/Code/05 Tools & Utilities/natively-cluely-ai-assistant`
- Date: 2026-06-11
- User is testing the dev app with a Zoom meeting.
- Setup used during test:
  - Zoom meeting started on Mac.
  - AirPods were initially connected to the Mac.
  - Same Zoom meeting joined from iPhone using another account.
  - iPhone had no headphones.
  - User then tested YouTube playback on Mac.

## Important Current Git State
- There was already a dirty worktree before this handoff.
- Do not assume these changes were made in the handoff session:
  - `electron/LLMHelper.ts`
  - `electron/ipcHandlers.ts`
  - `electron/llm/AnswerLLM.ts`
  - `electron/llm/BrainstormLLM.ts`
  - `electron/llm/ClarifyLLM.ts`
  - `electron/llm/CodeHintLLM.ts`
  - `electron/llm/FollowUpLLM.ts`
  - `electron/llm/FollowUpQuestionsLLM.ts`
  - `electron/llm/WhatToAnswerLLM.ts`
  - `electron/services/InterviewContextManager.ts`
  - `src/components/interview/InterviewWorkspace.tsx`
  - `src/components/ui/ModelSelector.tsx`
  - `src/utils/modelUtils.ts`
- This handoff intentionally only updates `HANDOFF.md`.

## What We Learned
- Natively separates channels:
  - `interviewer` = system audio, shown in the right rail.
  - `user` = Mac microphone, ignored by the interviewer rail unless using manual Answer recording.
- Initial failure:
  - User asked the question, but terminal showed `STT transcript (user)`.
  - UI right rail stayed empty.
  - App showed `System Audio Not Detected`.
  - Diagnosis: Mac mic heard the speech, but system audio was silent/zero-filled.
- YouTube test:
  - YouTube audio produced `STT transcript (interviewer)` and appeared in the right rail.
  - This proved system audio capture can work.
- After switching away from AirPods / restarting:
  - Zoom interviewer audio started appearing as `STT transcript (interviewer)`.
  - The right rail showed the final question:
    `Hey, David. How do you handle situation where the AI generated code breaks or produces an extra output?`
- The terminal also showed duplicate mic/user capture at times. That likely means the Mac mic was hearing the iPhone speaker. For clean tests, keep the iPhone farther away or lower volume.

## Current Runtime Evidence
- Main debug log is:
  - `/Users/david/Documents/natively_debug.log`
- High-signal entries from latest test:
  - `2026-06-11T14:21:19.719Z [LOG] [Main] Audio pipeline start completed. systemStarted=true, micStarted=false`
  - `2026-06-11T14:21:41.748Z [LOG] [Main] STT transcript (interviewer) final conf=1.00: "Hey, David."`
  - `2026-06-11T14:21:46.803Z [LOG] [Main] STT transcript (interviewer) final conf=0.99: "What how do you handle a situation where the AI generated code breaks?"`
  - `2026-06-11T14:21:49.090Z [LOG] [Main] STT transcript (interviewer) final conf=1.00: "Or produces unexpected output?"`
- Latest log also showed mic init failures:
  - Requested `David’s AirPods Pro` and output `70-AE-D5-C0-FE-9A:output` were unavailable, so app fell back to default.
  - Mic failed with CoreAudio default input config errors.
  - System audio still started and captured interviewer audio.

## Product Behavior Confirmed
- The visible `Answer` button is the practical trigger for generating what David should say.
- There is an auto-answer code path in `electron/IntelligenceEngine.ts`, but in the observed test the UI did not auto-fill the answer after the final interviewer question.
- Guidance given to user:
  - Click `Answer` after the interviewer question appears in the right rail.
  - `Clarify` gives a clarifying question.
  - `Brainstorm` helps think through options.
  - `Follow Up` is useful after Natively already answered and the interviewer pushes back.

## Open Issues / Next Checks
- Decide whether auto-answer should reliably trigger without clicking `Answer`.
  - If yes, inspect `looksLikeInterviewerQuestion`, `activeMode === 'idle'`, and the renderer event path for `what_to_say`.
  - Relevant files:
    - `electron/IntelligenceEngine.ts`
    - `electron/IntelligenceManager.ts`
    - `electron/main.ts`
    - `src/components/NativelyInterface.tsx`
- Investigate why the app still shows `System Audio Not Detected` even after later `interviewer` transcripts arrive.
  - Likely stale warning state after zero-filled detection.
  - Relevant UI state is in `src/components/NativelyInterface.tsx` around `systemAudioWarning`.
- Investigate mic/CoreAudio failures if David needs mic/manual-answer capture.
  - Latest log says `micStarted=false`, even though system audio worked.

## Recommended Next Step
First clarify the desired behavior:
- If David wants hands-free operation, fix/verify auto-answer.
- If clicking `Answer` is acceptable, continue QA with MacBook speakers/default output and focus on transcript quality plus stale warning cleanup.

## Exact Prompt For Next Chat
```text
Continue from the handoff in `/Users/david/Code/05 Tools & Utilities/natively-cluely-ai-assistant/HANDOFF.md`.

I was testing Natively with a Zoom meeting. Please inspect the current repo state and the latest `/Users/david/Documents/natively_debug.log` evidence first. Preserve the existing dirty worktree.

Main question: should Natively auto-generate the answer when an interviewer question appears, or is clicking the `Answer` button expected? If auto-answer is supposed to work, diagnose and fix the smallest reliable path. Also check why the stale `System Audio Not Detected` banner can remain after interviewer transcripts start appearing.

Do not commit or push unless I explicitly ask.
```
