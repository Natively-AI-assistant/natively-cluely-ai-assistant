# Context truncation tests — runtime results (2026-10-04)

App: local main `efc126a9` (worktree `er-main`), one `dev:agent` instance, fresh profile, `NATIVELY_E2E=1`,
`NATIVELY_PROMPT_DEBUG=1`. Generator: AgentRouter → DeepSeek (`deepseek-v4-flash`, `/v1/messages`, temperature 0.2,
`max_tokens` 65,536, thinking off) on every app probe; the route answered throughout, no fallback was needed.
Provider limit probes: direct DeepSeek. Harness: `evidence-rich/limits/probe.mjs` (+ `typed-diff.mjs`,
`typed-filler.mjs`, `token-ratio.mjs`, `provider-size.mjs`, `transcript-bm25.mjs`). Raw rows:
`evidence-rich/results/limits/*.jsonl`. All content synthetic; probe files live in `evidence/limits-probe/`, outside
the frozen manifest (the benchmark corpus is unchanged).

States: **A** parsed (fact in the extracted text) · **B** indexed (status `ready`, chunk count) · **E** sent (the exact
fact sentence is in the request the provider received) · answered (the fact's code is in the shown answer). C
(retrieved) and D (packed) are not separately observable without new instrumentation; when E holds, C and D held.
Checks are exact string matches, judge-free.

**Needle difficulty.** Unless stated, each question names an invented subject that appears only next to its fact
("What code opens the gate at the Quenby depot?"). That is the EASIEST retrieval case: a pass means "a uniquely named
fact is found", not "large files are fine". §2 (aggregate) and §4 (many files) are the harder cases.

## 1. One reference file, size × position (7 facts at 0, 10, 25, 50, 75, 90, 99.5 %)

Typed, General (`ref-size-general-typed.jsonl`); heard (hotkey), General and Sales; typed, Sales.

| File (est. tokens) | chars | A parsed | B chunks | General typed: E / answered | General heard: E / answered | Sales heard | Sales typed | How it reached the prompt | user msg chars (median) |
|---|---|---|---|---|---|---|---|---|---|
| 500 | 2,498 | 7/7 | 2 | 7/7 · 7/7 | — | — | — | whole file | 5,472 |
| 1,000 | 4,506 | 7/7 | 3 | 7/7 · 7/7 | 7/7 · 7/7 | 7/7 · 7/7 | — | whole | 7,484 |
| 1,350 | 5,906 | 7/7 | 5 | 7/7 · 7/7 | — | — | — | whole | 8,883 |
| 1,450 | 6,306 | 7/7 | 5 | 7/7 · 7/7 | 7/7 · 7/7 | 7/7 · 7/7 | 7/7 · 7/7 | whole | 9,380 |
| 2,000 | 8,506 | 7/7 | 6 | 7/7 · 7/7 | — | — | — | whole | 11,770 |
| 4,000 | 16,506 | 7/7 | 11 | 7/7 · 7/7 | 7/7 · 7/7 | 7/7 · 7/7 | 7/7 · 7/7 | whole | 19,484 |
| 8,000 | 32,506 | 7/7 | 21 | 7/7 · 7/7 | — | — | — | whole | 35,484 |
| 11,800 | 47,714 | 7/7 | 31 | 7/7 · 7/7 | 7/7 · 7/7 | 7/7 · 7/7 | — | whole | 50,696 |
| 12,500 | 50,514 | 7/7 | 33 | 7/7 · 7/7 | 7/7 · 7/7 | 7/7 · 7/7 | 7/7 · 7/7 | 3–5 retrieved chunks | 7,300 |
| 16,000 | 64,514 | 7/7 | 41 | 7/7 · 7/7 | — | — | — | chunks | 6,721 |
| 32,000 | 128,514 | 7/7 | 81 | 7/7 · 7/7 | — | — | — | chunks | 7,644 |
| 64,000 | 256,514 | 7/7 | 161 | 7/7 · 7/7 | — | — | — | chunks | 7,006 |

- Files are **never truncated**: every size parsed whole (A = 7/7, extracted chars = file chars) and indexed whole.
- The fact at 99.5 % (the end) is found at every size.
- Below 12,000 the whole file is in the prompt (the request grows with the file); above it the request drops to
  ~7k chars: 3–5 chunks of a file that may be 256k chars. Nothing cut — the model sees a different thing.
- The heard path reads the whole file too, for 1,450–11,800 in General and Sales. A code trace predicted FAST heard
  turns between 1,400 and 12,000 would read nothing; these questions did not hit that case (they were not FAST
  turns). NOT VERIFIED for a FAST-classified turn.
- Provider tokens (heard, General): 1,000-token file → 7,140–7,769 prompt tokens; 11,800 → 15,252–15,767;
  12,500 → 7,369–7,621.

## 2. One question needing all seven facts (aggregate)

"List the gate release code for every depot mentioned in the operations reference." (`aggregate-*.jsonl`)

| File (est. tokens) | General: facts in request / in answer | Sales |
|---|---|---|
| 4,000 | 7/7 · 7/7 (whole) | — |
| 11,800 | 7/7 · 7/7 (whole) | 7/7 · 7/7 |
| 12,500 | **2/7 · 2/7** (3 chunks) | **3/7 · 3/7** (4 chunks) |
| 32,000 | **3/7 · 3/7** (4 chunks) | — |

**The 12,000 whole-pack threshold is a cliff.** 700 tokens more and a question over the whole document loses 4–5 of
7 facts; the answer lists what it got. This is the measured cost of "selective retrieval" for list, comparison, and
"what does the document say about all X" questions.

## 3. Typed message size (`typed-input*.jsonl`, `typed-diff.mjs`, `typed-filler.mjs`)

| Sent chars | head | 3 middle markers | tail line | in the answer | request user chars | provider prompt tokens | chars/4 estimate |
|---|---|---|---|---|---|---|---|
| 1,000 | yes | 3/3 | yes | yes | 4,225 | 5,830 | 6,804 |
| 10,000 | yes | 3/3 | yes | yes | 13,024 | 7,498 | 9,003 |
| 25,000 | yes | — | yes | yes | 27,689 | 10,307 | 12,682 |
| 50,000 | yes | — | yes | yes | 52,246 | 14,897 | 18,821 |
| 100,000 | yes | 3/3 | yes | yes | 101,398 | 23,928 | 31,096 |
| 200,000 | yes | — | yes | yes | 199,139 | 42,711 | 55,544 |
| 400,000 | yes | 3/3 | yes | yes | 395,744 | 80,427 | 104,682 |

- **No size limit on the typed path**: 400,000 chars reached DeepSeek with head, middle and the last line, and the
  answer used the last line. Nothing in the renderer, IPC, handler or composer cuts it.
- **But the text is altered before it reaches the model:**
  1. **Line breaks are removed** (the overlay input is a single-line `<input>`): pasted structure is flattened.
  2. **The speech cleaner runs on typed text** (`question-resolver.ts` `cleanUtterance`): repeated words are merged
     ("rota rota" → "rota", "the the" → "the") and "filler" words are deleted. Measured:
     typed `I would like the right answer: is the policy basically kind of strict, or is it actually strict? I mean the the travel policy.`
     → sent `I would like the answer: is the policy kind of strict, or is it actually strict? the travel policy.`
     ("right", "basically", "I mean", one "the" gone). The user's exact words appear nowhere in the request.
  This is why the 10,000+ messages did not match even after whitespace collapse (the first difference is at char
  659: "rota rota migration" → "rota migration").

## 4. Number of files (each file holds ONE fact about a subject only it names, at its middle)

`ref-count-*.jsonl`. Asked: the first, middle and last file's fact.

| Files × est. tokens | corpus | path | first | middle | last | files whose fact was in the request |
|---|---|---|---|---|---|---|
| 12 × 100 (General) | 1,200 | small corpus, whole | yes | yes | yes | 12 of 12 |
| 1 × 600 (Sales) | 600 | whole | yes | — | — | 1 |
| 2 × 600 | 1,200 | whole | yes | — | yes | 2 |
| 5 × 600 | 3,000 | whole pack | yes | yes | yes | 5 |
| 10 × 600 | 6,000 | whole pack | yes | yes | yes | 10 |
| 20 × 600 | 12,000+ | retrieval | yes | yes | yes | 4 |
| 5 × 3,000 | 15,000 | retrieval | yes | yes | yes | 3–4 |
| **10 × 3,000** (Sales, run twice; General once) | 30,000 | retrieval | **no** | yes | **no** | 4 |
| 20 × 3,000 | 60,000 | retrieval | yes | yes | yes | 4 |

- The code trace predicted that with more than 8 small files the files past the 8-item cap are lost. **Not seen**:
  12 small files all reached the request.
- **A reproducible retrieval miss** at 10 × 3,000: the first and last files' uniquely named facts were not retrieved,
  in three runs across two modes; the same four other files came back every time, and the answer offered those
  depots instead ("The depot codes I can give you are for Elmbrook, Falbrook, Ivobrook, and Belbrook"). Typed queries
  ran on the lexical fallback (`Local ONNX provider active for manual query; using lexical fallback`, 49 times in the
  log). Cause NOT YET IDENTIFIED — 5 and 20 files of the same size did not miss. Repro:
  `node evidence-rich/limits/probe.mjs ref-count --mode sales --counts 10 --file-tokens 3000`.

## 5. Realtime transcript (heard path; lines injected through the real `handleTranscript`)

`transcript*.jsonl`. Three facts said at line 1, the middle, and three lines from the end; ~160 chars per line;
asked: "remind me what the project codename is, when we are launching, and who owns it?"

| Lines (chars) | General: line 1 / middle / near end | Team Meet | Call Center | user msg chars |
|---|---|---|---|---|
| 10 (1,307) | yes / yes / yes | yes / yes / yes | — | 4,184 |
| 20 (2,907) | **no** / yes / yes | **no** / yes / yes | **no** / yes / yes | 5,141 |
| 40 (6,107) | no / no / yes | no / no / yes | — | 5,221 |
| 80 (12,507) | no / no / yes | no / no / yes | no / no / yes | 5,218 |
| 160 (25,310) | no / no / yes | no / no / yes | — | 5,224 |

- The spoken window is **2,400 chars** (`SPEECH_WINDOW_MAX_CHARS`): a 20-line exchange (~3,000 chars, about a minute
  and a half of talk) already loses its first line. Answers then say "I'll confirm the codename and come back to you".
- Older speech is supposed to come back through the live-transcript retrieval port (600-char windows, BM25). It
  admitted ONE window per turn, never a fact window. Offline replay of the same lines through the app's own
  `chunkLiveTranscript` + `Bm25Index.scoreNormalized` (`transcript-bm25.mjs`): the window containing the asked
  question scores 1.00 against itself; the windows holding the codename and the owner score 0.15–0.16, under the
  0.2 relative floor (`LIVE_TRANSCRIPT_MIN_NORMALIZED_SCORE`), so they are filtered out. "launching" does not match
  "launch" (no stemming): the launch window scored 0.00–0.04.
- The 180-second horizon was NOT exercised (the injection stamps every line with the current time): NOT VERIFIED.

## 6. Token estimates vs provider counts (`token-ratio.mjs`, direct DeepSeek)

| Text | chars | chars/4 | DeepSeek tokens | provider ÷ estimate |
|---|---|---|---|---|
| English filler (app prompts, §3) | — | — | — | 0.77–0.86 |
| Markdown lecture notes (corpus) | 4,291 | 1,073 | 1,041 | 0.97 |
| CSV, risk register (corpus) | 3,127 | 782 | 844 | 1.08 |
| Spanish prose | 6,480 | 1,620 | 1,799 | 1.11 |
| Russian prose | 5,400 | 1,350 | 1,799 | 1.33 |
| CSV, budget numbers (corpus) | 4,041 | 1,011 | 1,472 | 1.46 |
| JSON, quote-heavy | 9,752 | 2,438 | 3,661 | 1.50 |
| Chinese prose | 3,660 | 915 | 2,039 | **2.23** |
| Japanese prose | 3,960 | 990 | 2,579 | **2.61** |

Every app threshold (1,400 / 12,000 / 6,000 / evidence budgets) is in chars/4, so its real size depends on the
language: the 12,000 whole-pack is ~10,000 real tokens of English and ~31,000 of Japanese.

## 7. Conversation history (typed, General; `history.jsonl`)

Three facts said in turns 1, the middle and the last turn, then "Remind me: the venue, the budget cap and the
caterer?" All three were in the request at 5, 10, 20, 40 and **80** turns (request 6,255 → 24,676 chars). The ring
keeps 400 turns; older turns are condensed (question ≤ 600 chars) — short facts survive condensing.

## 8. Profile (résumé) size — see PI-LIMITS.md
Whole at 1,500 / 3,000 / 5,500; passages at 6,500 / 12,000; 7/7 facts reached the request at every size.

## 9. Output length (`output-cap.jsonl`)
Asked to copy back a 900-entry list. The shown answer stopped at **16,001 chars**, mid-entry ("689. R068"): the
`MAX_STREAM_OUTPUT_CHARS` cap, not the provider (`max_tokens` 65,536 was not reached; the stream was closed by the
app). The text itself carries no marker; whether the overlay showed an "incomplete" state was not captured.

## 10. Provider limits (direct DeepSeek, `provider-size.mjs`)
`GET /models`: `deepseek-flash` = DeepSeek-V4.1-Flash, `context_window` 1,048,576, `max_output_tokens` 393,216.
Progressive requests 40k / 400k / 1.2M chars: all HTTP 200, 7,939 / 79,292 / 237,849 prompt tokens. The app's own
table says 128,000 for every cloud model and never uses it to cut (`fitContextForCurrentModel` returns at ≥ 100k).
The largest real prompt in the benchmark is ~16k provider tokens: the provider window is ~65× larger than anything
the app sends.

## 11. Claim pass parity — see CLAIM-VERIFIER-CONTEXT-PARITY.md
Current main: the pass saw the generator's whole user message on 536 of 536 passes; 0 context-loss edits. The
heard path's separate "corrected answer" repair (≈ 13 % of turns) still inherits a 24,000-char cut.

## Not tested (and why)
- FAST-classified heard turns with a 1,400–12,000 corpus (none of these questions were FAST).
- 180-second transcript eviction (injection time stamps).
- Ollama / local models (not installed on this machine; Evin: no large downloads). The code removes the TOP of the
  user message — the question first — when a local model's window is exceeded. NOT VERIFIED at runtime.
- Unsplit tables / huge CSV rows vs the packer, escaping overrun of the whole-file reserve: code risks, not measured.
- Windows: none of this was run on Windows. The limits are in shared TypeScript; the `<input>` newline loss and the
  cleaner are renderer/shared code and expected identical — Requires physical Windows verification.
