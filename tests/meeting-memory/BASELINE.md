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

Raw result files are gitignored (they carry full prompts). Baseline files:
`baseline-nomode-typed-1790216608515`, `baseline-typed-long-1790215021308`,
`baseline-interview-1790195707929`, `baseline-interview-technical-interview-1790195894414`,
`baseline-nomode-wta-followup-1790216737093`, `baseline-hour-1790215346935`,
`baseline-cross-meeting-1790216514894`. After: `postfix-*` (cross-meeting, wta-followup,
typed-long, hour) and `postfix3-*` (interview ×2 modes, typed) from the final build.
