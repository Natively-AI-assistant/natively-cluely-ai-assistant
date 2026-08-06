# InterviewMan listen parity (desktop)

Glossary for desktop listen/transcript/transport UX that mirrors InterviewMan: always-on live STT, red-square transport, triangle end-meeting, Ask/submit separate, plus Settings live-STT sandbox. Phone may be a **phone-stt-source** and **phone-control-surface** over Phone Mirror; desktop remains the LLM/planner host (see `docs/standalone-ios/CONTEXT.md`, ADR 0015). Manual QA: [QA-CHECKLIST.md](./QA-CHECKLIST.md).

## Language

### Visibility

**always-on live transcript**:
Continuous live STT text of what is being heard — interviewer (system-audio) and user-mic — shown while red-square transport is listening, without requiring Answers to enable visibility.
_Avoid_: Answers-as-STT-start; single-channel-only as the full live transcript; InterviewMan retention-timer assumptions

**live-transcript-surfaces**:
Two places that show live STT text: (1) in-meeting overlay while transport is listening; (2) Settings Audio live-STT sandbox that streams real transcript (not levels meter or credential ping). Overlay ships first if sequenced.
_Avoid_: Treating Audio level meter or `test-stt-connection` as the live transcript test; reusing no-audio SD overlay e2e harness as this sandbox

### Controls

**interviewman-control-map**:
Three distinct overlay jobs: **red-square transport** starts/stops listening + voice dictation (STT capture on/off); **Ask/submit** turns spoken or typed words into an AI turn; **triangle end-meeting** ends the active meeting/session.
_Avoid_: Red square ending the meeting; triangle pausing listen; Answers chip as listen start; red-square Stop auto-submitting a chat turn

**listen-transport-arming**:
Meeting start auto-engages red-square transport (start→hear). Red square pauses/resumes; triangle ends meeting. Ambient AI Chat skips capture. If STT is unready (`none` / missing model / permissions), show a setup/unready state — never a fake empty “listening” transcript — and point at the Settings sandbox.
_Avoid_: Silent empty transcript when provider is none; Answers arming listen; auto-listen while Ambient is on

### Scope

**interviewman-parity-scope**:
This effort ships desktop listen UX (terms above) + InterviewMan-like **phone-control-surface** work in the same effort + visual layout/chrome parity on listen / transcript / transport surfaces only. Desktop remains **desktop-session-host** for LLM/planner. Out unless separately locked: InterviewMan retention timers; full App Store native rewrite; whole-product pixel match.
_Avoid_: Behavior-only without visual clone on those surfaces; treating phone remote as out of scope here; importing retention timers by default; unbounded whole-app pixel clone; phone-hosted full answer loop (LLM/RAG on phone — still rejected; see ADR 0015)

**phone-stt-source**:
The phone may run STT (mic / phone-captured audio) as an alternate capture source under the same listen-transport model. Transcript text feeds the desktop session; desktop remains LLM/planner host (ADR 0015 amending 0011).
_Avoid_: Treating phone STT as phone-hosted What-to-Answer; requiring desktop mic for all user speech when phone STT is armed

## Example dialogue

**Dev:** So we delete the Answers button since listening auto-starts?  
**Expert:** No. **always-on live transcript** shows both channels while **listen-transport-arming** has transport on. **Ask/submit** is still how you turn what you said into an AI question — that is not the red square.  
**Dev:** And the TopPill red square still ends the meeting?  
**Expert:** That mapping flips under **interviewman-control-map**. Red square is transport; **triangle** ends the meeting.  
**Dev:** Settings already has an audio test — is that the sandbox?  
**Expert:** Not today. Levels and credential ping are not **live-transcript-surfaces**. The sandbox must stream real STT text.  
**Dev:** Does the phone run STT itself for parity?  
**Expert:** Yes as a **phone-stt-source** when armed — transcript merges into the desktop session. Desktop stays LLM/planner host (ADR 0015). Phone can also be a **phone-control-surface** for transport / end / Ask.

## Flagged ambiguities

**Answers / Answer chip**:
Historically both “listen gate” (UI) and “voice ask → submit.” After this context, only the ask/submit job remains; listen is red-square transport.
_Resolution_: Prefer **Ask/submit** in new copy; keep Answer label only if product keeps the chip name.

**Stop**:
Today: Answer-chip Stop (finalize mic + submit) vs TopPill square Stop (end meeting). After remap: red-square Stop = pause transport; triangle = end meeting; Ask/submit owns send.
_Resolution_: Never say “Stop” alone in specs — name the control (red-square vs triangle vs Ask).

**Session**:
Speakable-sd “sticky SD session” is answerType stickiness, not listen transport.
_Resolution_: Prefer **meeting** for listen lifecycle; sticky SD stays in speakable-sd context.
