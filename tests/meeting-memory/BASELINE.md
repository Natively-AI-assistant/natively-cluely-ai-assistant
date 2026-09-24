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
  2,400 characters of the rolling context (asked for only its last 90 s), and 57% of those characters (avg
  over 114 prompts) are the assistant's own previous suggestions. (Not duplicates, as first written here:
  the bridge leaves a history exchange out when the window already holds its answer.) About 2 minutes of
  speech survive: "retries for up to twenty four hours", said 2.5 minutes earlier, was not in the prompt, and the
  answer capped retries at "a few minutes".
- Typed T2 "What numbers did she give for the webhook service?" was annotated "(follow-up to: 'Is there
  anything you would change in your design…')" and answered about the candidate's own design; the numbers
  were in its evidence.

## Confirm, then fix: the mock interview's four causes (2026-09-24, evening)

**Wrong referent notes: confirmed offline, fixed.** Replaying the mock run's question sequence through
`advance()` + `resolveReference()` reproduced 110/118 prompt questions byte for byte. 23 got a note and about
20 were wrong. Causes: an STT segment's capitalised first word taken as an entity ("Balance", "Between",
"Step", "Suppose"), a topic slot that outlived ten unrelated questions ("Postgres"), and she/he anchored to
the previous question. After the fix, the junk-word and stale-topic notes are gone and most notes point at
the question just before. `LiveReferentNotes2026_09_24` (17 tests) failed 11 before and passes after.
Separately, the session memory rewrote "How big is your team, and what is your role on it?" as "…role on
MySQL?" even when the question arrived unclipped: `SessionFollowupLocalAntecedent2026_09_24`.

Remaining: a note still comes from the immediately previous question, so after a digression ("What is
MVCC?") the return question "How would you key the Kafka topic for this?" goes out "(referring to: MVCC)".
The model ignored it in 4 of 5 answers.

**Constraints said long ago: confirmed in the app, fixed.** New `constraints` scenario (injected design
round, unguessable requirements 26 minutes back, questions that need them without pointing back, concept
controls). Hand-checked:

| | before | after |
|---|---|---|
| general, 4 constraint questions × 2 | 4/8 (misses absent from the prompt) | 7/8 (the miss is the MVCC note) |
| technical-interview, × 1 completed rep | 0/4 | 4/4 |
| concept controls clean (no design numbers, no hedging) | 6/6 | 6/6 |

A design or coding question took the fast path and retrieved nothing. In technical-interview a value lookup
claimed documents only, and an ambiguous question retrieved nothing. Now in a live meeting those read the
meeting (a fast turn gets the MEETING pool with no claim, so it stays FULL with no absence notice), and the
what-to-answer speech window is speech only, whole lines, 180 s.

**Clipped question starts: traced; mostly the rig.** Level probe through the app's own native system
capture (`.agent/level-probe.cjs`, RMS per WebSocket message as the relay computes it): with `say -a
"BlackHole 16ch"` the questions peaked at RMS 438-553 (p50 ~350), because the tap averages the device's 16
channels to mono. The relay VAD gate (natively-api `lib/vadGate.js`: reopens only on one chunk ≥ 450,
replays 400 ms) then dropped "How does a circuit breaker work?" and "What does the high-level architecture
look like?" whole, and cut "What causes a deadlock," from Q12. Those are exactly the live misses. The same
voice at full level measures p50 ~5,000 and loses nothing. The live rig now plays the interviewer on all 16
channels. The product exposure is real but narrower: any source under ~−37 dBFS (quiet participant, low
call volume, multichannel output) is gated out. The natively-api branch `fix/stt-vad-gate-quiet-onset`
lets a run of 3 system-audio chunks ≥ 150 within 500 ms reopen the gate and keeps an open gate open on
quiet voice (18 gate tests pass). It is not deployed.

**The 118-question live mock interview, re-run on all fixes.** The two columns are NOT a fix measurement:
the "before" run had the interviewer 24 dB quiet (the rig), so every transcription row and most of the
right-question gain are the rig. Q12, Q24, Q43, Q44, Q82, Q95 and Q117's number were transcription. What the
app fixes bought, shown end to end, is Q86 ("capped by the 24-hour window", was "a few minutes"), T2 ("She
set the load at 50 million events a day… up to 24 hours", was about the candidate's own design) and Q08 (no
"…role on MySQL?" rewrite). The measurements that isolate the app are the replay and the `constraints`
scenario above. (`mock-interview-fixed-1790261296474`, interviewer at full level). Hand-checked:

| | before (`mock-interview-1790250804024`) | after |
|---|---|---|
| right question and on topic | 107/118 | 113/118 |
| refused | 1 | 0 (the scorer flagged 3 full answers) |
| memory-dependent questions with the earlier detail | 16/21 | 19/21 (Q117: "did I say" answered as the candidate's six, not Maya's 45; Q06 gives no number) |
| typed questions | 2/3 | 3/3 |
| live-index probes | miss, rank 3 | miss, rank 1 |
| interviewer questions missing from the transcript (<30% of words) / partial | 4 / 11 | 0 / 1 |
| what-to-answer median / p90 | 4.0 s / 4.7 s | 4.5 s / 5.1 s |

The 5 remaining misses:
- Late finals (Q10, Q73, Q74). The question's final arrived 5 s and 23 s after the interviewer stopped, and
  the press at +2.5 s saw "What is the difference between" and "Good. Good. Let us do a second…".
- One clipped opening clause at full level (Q31, "What is idempotency," never arrived). The note then made
  it "(referring to: TLS)". Not traced.
- One incomplete answer (Q28, partitions: said ordering "stays intact").
- Plus, on the right question: Q117 above; Q08 still went out "(referring to: Postgres)" (the model
  ignored it). Self-contained questions now often carry "(follow-up to: <previous question>)" instead of a
  junk note (Q84, Q89).

Cost: the 35 questions that now read the meeting went from a 3.4 s to a 4.5 s median; questions that
already read it went up 0.3 s. So the lookup costs about 0.7 s per general question in a live meeting
(retrieval timeout 1.2 s).

**The earlier reference scenarios, re-run on the final build** (`ref-final-*`, injected, 2 reps each).
Hand-checked; the scorer's "denied" was a recall with a provenance hedge in 5 of 6 cases:

| scenario | previous final build (hand) | this build (hand) |
|---|---|---|
| 13 typed turns, 5 facts | 10/10 | 10/10 |
| 32 typed turns | 8/8 | 12/12 (3 runs; a CDP disconnect retried one) |
| what-to-answer follow-up after 110 s | 2/2 | 2/2 |
| one-hour meeting, typed + what-to-answer | 12/12 | 12/12 |
| live interview, details said aloud 13-29 min earlier | 14/16 + 2 partial | 15/16 (1 write-load answer never named Elixir) |
| a new meeting leaks the previous one | 0/2 | 0/2 |

The "that came from you, not the call" hedge on typed facts is not new: 6/10 and 6/8 before, 7/10 and 8/12
now. Not measured: a live meeting with files attached. A document question that does not name its
document now shares evidence slots with the meeting.

## One-hour session, every kind of content (2026-09-24, late)

`session-hour`: speech from both sides backdated across an hour (facts at minutes 1-2); then live, in order:
a typed fact, a screenshot (Pillow-rendered, unguessable ERR-7Q41 / reconcileLedgerV3()), a manual
question, a what-to-answer suggestion and a follow-up chain; then 42 unrelated exchanges; then a follow-up
about each through typed chat and what-to-answer. Hand-checked:

| item (asked ~45 exchanges later) | before | after, rep 1 | after, rep 2 |
|---|---|---|---|
| interviewer's speech (pager SLA 7 min) | ✓ | ✓ | ✓ |
| interviewee's speech (build 40 → 6 min), what-to-answer | ✓ | ✓ | ✓ |
| typed fact (offer band 212k) | ✓ | ✓ | ✓ |
| screenshot error code, typed | ✗ "I don't have a screenshot" | ✓ ERR-7Q41 | ✓ |
| screenshot function, what-to-answer | ✗ "never came through" | ✓ reconcileLedgerV3() | ✓ |
| manual answer (backpressure one-liner) | ✗ re-invented | ✓ verbatim | not measured (quota) |
| what-to-answer suggestion (URL shortener storage) | partial (from a gist) | ✓ | not measured (quota) |
| follow-up chain (top-10 terms) | ✗ "I never gave you an answer" | ✓ | not measured (quota) |

Control with 6 filler exchanges before the fix: 8/8, all in the prompt. The loss was eviction (ring at
40) and screen text carried only for the newest turns. Timings from the `[V3]` line after the fix: meeting
lookup median 703 ms / p90 1,095 ms (typed), 812 / 1,228 ms (what-to-answer); the recall tier itself is
under 20 ms at 400 exchanges and fired on 17 typed and 10 what-to-answer turns.

**The account's AI quota ran out mid-run** (`ai_quota_exceeded`, 6,500,333 / 6,500,000 ai_tokens, resets
2026-10-21). Every live run here spends the real account's quota; the last 3 probes of rep 2 and the
control run after the fix answered "the model failed before generating an answer".

**Clean re-run, silent devices** (`sess-clean`, 2 reps, hand-checked): 15/16 exact, 1 partial. That rep's
URL-shortener recall added "something like Redis", which the original never named. The `sess-final`
reps before it were contaminated: the meeting captured the Mac's default output device, where a football
stream was playing, so What-to-answer resolved "It's Dani Olmo" as the question. Injected scenarios now
start meetings on BlackHole.

**Live-audio mock interview with session probes** (`mock-session2-1790284761913`, 119 questions, 0 playback failures, real STT).
Four typed items were planted at minute 5 and asked about at minutes 47-49 (~110 exchanges later); a
screenshot question was also spoken at minute 47:

| probe | result |
|---|---|
| offer band typed at min 5 | ✓ 212k base |
| screenshot, typed | ✓ "ERR-7Q41 … reconcileLedgerV3() at ledger/sync.go:88" |
| screenshot, spoken, what-to-answer | ✓ reconcileLedgerV3() |
| manual one-liner | ✓ verbatim |
| follow-up chain (top-10 terms) | ✓ |
| what the overlay suggested for "what does your team work on" (min 1.5) | ✓ quotes the suggestion (was the spoken reply before a3924c02) |
| T1 constraints / T2 design numbers / T3 team summary | ✓ ✓ ✓ |

Right question 116/119, on topic 117/119, memory-dependent 20/22. Of the 5 scorer "refusals", 4 are full
answers and 1 correctly declines to invent a mentoring story. Misses: Q06 (no number) and Q117 ("did I
say… our team" answered with the candidate's six, fixed after this run). Two opening clauses were clipped
at full level (Q40 "page 99", Q66).

**"Did I say… our team", after 5de7ba26** (`persp-interview-*`, injected interview, both modes × 2): the
interviewer's twelve-person team is recalled 4/4 ("You said twelve people on the platform team"). The
three live mock interviews before the fix answered with the candidate's own team every time. The write-load
answer uses the interviewer's setup in 4/4 (it denied the setup once in the earlier reference run).
