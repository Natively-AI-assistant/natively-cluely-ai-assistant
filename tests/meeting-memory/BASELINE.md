# Meeting-overlay memory — reference level (2026-09-24)

Measured in the real app (`npm run dev:agent`, isolated profile, macOS) against the real
model (`natively` → `deepseek-flash`), no active mode (the default state), with
`tests/meeting-memory/live-memory-harness.mjs`. **Baseline** = `main` at a4cb8ff1 plus this
harness. **After** = this branch. Each cell is runs × probes; "hand" is my reading of every
answer, because the lexical scorer misfires both ways (it reads "Nothing in the call audio
mentions it" as a denial, and misses "I don't actually know how you deploy").

| what is asked | baseline (hand) | after (hand) | after (scorer) |
|---|---|---|---|
| 13 typed turns in a live meeting, 5 facts probed 2-12 turns later | **5/10** | **10/10** | 8/10 |
| 32 typed turns (~an hour of use), facts probed 13-31 turns later | **4/8** | **8/8** | 8/8 |
| live interview, details said ALOUD 13-29 min earlier, interviewer follow-up via what-to-answer | **2/16** | **14/16** + 2 partial | 12/16 |
| what-to-answer follow-up 110 s later ("which algorithm did you pick?") | **0/2** ("I don't have the earlier detail") | **2/2** | 2/2 |
| one-hour meeting, facts said at minutes 2/20/45, typed and what-to-answer | 12/12 | 12/12 | 12/12 |
| a NEW meeting must not know the previous meeting's conversation | leaked **2/2** (answer repeated it 1/2) | **0/2** | 0/2 |

Cost, median per probe (answer time = send → stream done):

| scenario | answer time before → after | composed user prompt before → after |
|---|---|---|
| 13 typed turns | 4.0 s → 3.6 s | 3.9k → 10.4k chars |
| 32 typed turns | 4.4 s → 4.0 s | 9.8k → 14.0k chars |
| interview | 5.8 s → 5.0 s | 3.5k → 7.7k chars |
| one-hour meeting | 3.4 s → 3.2 s | 3.3k → 4.0k chars |

## What each loss was (all reproduced before fixing)

1. **The history reset when the meeting index came online.** The ring was keyed by one
   conversation but reset on any change of the turn's *evidence* scope, which gains a
   `meetingId` the moment JIT indexing starts — a few messages into every meeting.
2. **The user's words were cut at 280 characters** in history, so context-first messages lost
   the fact at the end.
3. **History past the budget was dropped** (10 turns max); older turns now stay condensed —
   the user's words plus the answer's one-line gist.
4. **What-to-answer never saw the ring** — it assumed its 90-second speech window "already
   covered the conversation".
5. **Interview follow-ups never read the transcript** — personal / follow-up / "what I told
   you" questions planned the résumé or nothing.
6. **Every meeting shared one history when no mode was active** (the conversation key came
   from a session id minted only with a mode), and nothing cleared it at meeting end.
7. **The prompt fenced the user's own statements as unverified**, so the model denied facts
   that were in front of it (owner decision 2026-09-24: spoken facts and typed facts about the
   meeting/client/deal are usable; typed self-experience still needs the résumé).

Still open: the model often adds "that came from your note, not the call" when repeating a
typed fact, and still pushes back when a fact is FIRST typed ("the $83,700 figure isn't in
anything I can see") — it uses the figure anyway in most cases.

After rebasing onto main (b4cf71af) one rep of each was re-run as a smoke (`rebased-*`), hand-checked:
cross-meeting no leak; typed 5/5; follow-up recalled; interview 3/4 (the "our setup" question answered
from the user's own project instead of the interviewer's stack — the remaining weak spot).

## One-hour live meeting, real capture and real STT (2026-09-24)

`tests/meeting-memory/live-audio/`: the interviewer spoken into BlackHole 16ch (the meeting's output
device, taken by the CoreAudio tap), the candidate into BlackHole 2ch (the meeting's mic), Soniox via the
Natively relay, nothing injected. Details planted at known minutes, asked 14-58 minutes later. Hand-checked.

| route | first hour | final hour (all fixes) |
|---|---|---|
| typed question about a detail 20-58 min back | 6/6 | 6/6 |
| What-to-answer on the interviewer's follow-up (details from min 1-6, asked 47-56 min later) | 3/4 | 4/4 |
| live-index semantic search, top 3 | 4/4 | 4/4 (all rank 1) |
| 3 injected embedding failures at min ~26 | pending 3 → 0 in ~2 min | pending 3 → 0 in ~2 min |
| the hour's real transcript through the chunker: Q/A in one chunk, before → after | 0/167 → 167/167 | 0/188 → 188/188 |

Found by the live run and fixed on this branch: the hosted STT path never finalized an interviewer
STATEMENT followed by silence within 15 s (4/4) — after the fix 0.5-2.0 s (4/4); and an STT-truncated
"…told you about our setup…" missed the transcript.

Still open (STT relay / native capture, not memory): the first words of an utterance are clipped
("What does good code review…" → "Code review…"), words split mid-word ("man aged", "cach ing"), and an
open question asked before any story was told can get an invented one (W1/W3).

Raw result files are gitignored (they carry full prompts). Baseline files:
`baseline-nomode-typed-1790216608515`, `baseline-typed-long-1790215021308`,
`baseline-interview-1790195707929`, `baseline-interview-technical-interview-1790195894414`,
`baseline-nomode-wta-followup-1790216737093`, `baseline-hour-1790215346935`,
`baseline-cross-meeting-1790216514894`. After: `postfix-*` (cross-meeting, wta-followup,
typed-long, hour) and `postfix3-*` (interview ×2 modes, typed) from the final build.

## Mock technical interview, 118 questions, real capture and real STT (2026-09-24)

`live-audio/mock-tech-interview.mjs`, 45 minutes: background, fundamentals with pushback, a merge-intervals
problem broken down by the interviewer (clarify → approach → walkthrough → complexity → code → tests → edge cases
→ stream variant), top-k, a webhook system design with the interviewer's numbers, behavioural, and a recall
wrap-up. What-to-answer pressed after every interviewer question, 3 typed questions, 2 index probes. Scored
by `analyze-mock.mjs`, then every miss hand-checked (`mock-interview-1790250804024`).

| measure | scored | hand-checked |
|---|---|---|
| answered | 118/118 | 118/118, median 4.0 s, p90 4.7 s |
| answered the question just asked, on topic | 106/118 | 107/118 (Q42, Q88, Q106 were scorer misses; Q86 was a wrong answer) |
| memory-dependent questions with the earlier detail | 15/21 | 16/21 (Q76 was a scorer miss) |
| recall wrap-up (details from min 1-35, asked min 38-45) | 9/10 | 9/10 |
| coding ask produced code | 1/1 | 1/1 |
| typed | 2/3 | 2/3 |

The 11 wrong answers, by cause (each checked against the transcript around the press, question end + 2.5 s):
- The question's start, or all of it, never reached the transcript (7). Short interviewer questions right
  after the candidate stopped were lost whole (Q43 "How does a circuit breaker work?", Q63 "How would you
  test your function?", Q82 "What does the high-level architecture look like?", 2.4-3.4 s each), so
  What-to-answer answered the previous question. Others lost their opening clause: "What causes a deadlock,
  and how do you prevent one?" arrived as "And how do you prevent one?" (Q12, Q24, Q44), "How big is your
  team…" as "Is your team…" (Q08). The referent annotation then filled the gap wrongly ("(referring to:
  Balance)", "role on MySQL?").
- Transcribed after the press (1, Q68): "Suppose interval" arrived on time; the rest of the sentence was
  finalized 20 s later.
- Misheard (2): "idempotency" → "What potency … (referring to: URL)" (Q95); "about forty five engineers"
  split into two finals "about 4" / "5 engineers", answered "Fifteen" (Q117; typed T3 read the same
  transcript as 45; the scorer's "in evidence" flag for Q117 matched the evidence id "live-45", not the fact).
- Meeting speech fell out of the prompt (1, Q86): the What-to-answer "Conversation so far" window is the last
  2,400 characters of the rolling context, and 57% of those characters (avg over 114 prompts) are the
  assistant's own previous suggestions, which the history section repeats. About 2 minutes of speech
  survive: "retries for up to twenty four hours", said 2.5 minutes earlier, was not in the prompt, and the
  answer capped retries at "a few minutes".
- Typed T2 "What numbers did she give for the webhook service?" was annotated "(follow-up to: 'Is there
  anything you would change in your design…')" and answered about the candidate's own design; the numbers
  were in its evidence.
