# OVERNIGHT AUTOPILOT CAMPAIGN 2: Fix Long-Session Degradation in Natively Meeting Overlay (Hallucination + "Hi how can I help you" Failures)

You are running unattended under /loop. This file is `loop2.md` in the Natively repo root, kept deliberately separate from `loop.md` (Campaign 1: grounding/false-refusal, branch `fix/grounding-campaign`, still active/uncommitted as of this campaign's start). Campaign 2 runs on its own branch `fix/longsession-campaign` and its own log `campaign2-log.md`. Never edit `loop.md` or `campaign-log.md` — those belong to the other campaign. You never ask questions, never wait for input, never stop at a decision point. Every ambiguity has a resolution rule here; if something is truly uncovered, choose the option that (a) preserves zero-hallucination, (b) preserves answer relevance to the CURRENT question, (c) touches the least code — and log the decision in campaign2-log.md.

FOUNDER SETUP (one time):
1. This file is `loop2.md` in the repo root (already saved).
2. Claude Code running in the repo, auto/permissive mode so nothing stalls on permissions, on branch `fix/longsession-campaign`.
3. `/goal Long-session campaign 2 complete: traces2/final-report.md exists and the two most recent reports in test/harness-longsession/reports show zero greeting-failures, zero hallucinations, >=98% question-extraction accuracy, >=95% answer quality, >=90% long-range recall, per loop2.md L4. Do not stop before this.`
4. Run `/loop loop2.md` (or otherwise ensure this doc, not loop.md, is the loop prompt). Keep the session open (tmux, no machine sleep).

**Coexistence note**: `fix/grounding-campaign` (Campaign 1) may still be active in a separate session/worktree. If at any point you find `fix/grounding-campaign` has landed commits relevant to long-session hypotheses (e.g. `TurnEvidenceCoordinator.ts` wiring, prompt-assembly changes), treat that as upstream context to `git merge` or `git cherry-pick` deliberately (log the decision) rather than re-deriving the same fix independently — R2 anti-thrash applies across campaigns too, not just within this one.

---

## /LOOP PROTOCOL

L1. RESCHEDULE OR DIE. Every iteration ends by either scheduling the next wakeup (immediate/short-delay while work remains) or, ONLY when the L4 exit condition is fully met, stopping the loop via ScheduleWakeup stop: true. An iteration that ends without doing either gets one ~20-minute fallback wakeup and then the loop dies silently — never let that happen.
L2. ON EVERY WAKEUP: read `campaign2-log.md` first; its final line is always `NEXT ACTION: …`; execute it. If the file doesn't exist, this is iteration 1: create it and begin Phase 0.
L3. BEFORE ENDING EVERY ITERATION: update campaign2-log.md with what was done, latest benchmark scores, the anti-thrash ledger, and a final `NEXT ACTION: …` specific enough for a cold context. Commit. Reschedule per L1.
L4. EXIT CONDITION (only valid stop): `traces2/final-report.md` exists AND the two most recent reports in `test/harness-longsession/reports/` BOTH show: zero greeting-failures ("hi how can I help you"-class responses on real questions), zero hallucination flags, question-extraction accuracy >= 98%, answer quality >= 95%, long-range recall >= 90%, AND Phase 4 hardening is checked off. Anything less: reschedule and continue.
L5. PREMATURE SUCCESS IS THE FAILURE MODE. No "fixed/working/done" claims without a green run-NNN report. Catch yourself concluding without evidence → NEXT ACTION: run the full benchmark.
L6. `/compact` freely; campaign2-log.md is your memory. Post-compact, L2 applies.
L7. Broken state on wakeup (build failing, harness crashed) → restore from git checkpoints first, then resume.
L8. Unlimited iterations. 100+ is expected. Edits to loop2.md take effect next iteration; you may refine your own instructions, logging any self-edit.
L9. QUOTA GUARD is mandatory — full procedure in Section 1.5. Check after every phase and every benchmark run. Pause ONLY when one Claude account is fully out AND the other is at <= 10% session remaining; pausing = delayed wakeup at resetAt + 2min, never a stop.

---

## 0. THE BUG (founder-reported, treat as ground truth)

In real meeting sessions longer than ~20 minutes, the overlay degrades:
1. HALLUCINATION: answers contain fabricated content, or answer a DIFFERENT question than the one just asked.
2. GREETING FAILURE: when the user presses the answer button on a real interviewer question, the model responds "Hi! How can I help you?" (or similar assistant-greeting boilerplate) instead of an answer. This is the signature of the model receiving an empty, malformed, or question-less prompt — a greeting is what an assistant emits when given no task.
3. Short sessions work noticeably better; degradation correlates with session duration / transcript length. So the defect lives in how the ROLLING TRANSCRIPT, question extraction, conversation history, and long-context assembly behave as they grow.

Architecture context: Electron + TypeScript, Rust components, Fastify backend `natively-api`, MiniMax M3 generative, Gemini embeddings (cascade to OpenAI/Ollama/bundled bge-small-en-v1.5 384d). Live meeting flow: dual-channel STT (mic + system audio) → rolling transcript → question detection/extraction (interviewer-perspective) → user presses "answer" → prompt assembled from: mode/system instructions + extracted question + relevant transcript context + retrieved knowledge (RAG/hybrid/OKF cards/graph) + Hindsight/profile → MiniMax answer → overlay. Subsystems available for recall: chunk RAG, HybridSearchEngine, OKF Knowledge Packs (OkfRetriever, EvidenceAssembler under electron/services/knowledge/), KnowledgeOrchestrator, Hindsight, profile tree, knowledge graph. Known prior defects in this codebase (re-check all of them at long context): double execution, question/answer desync, no-op escape hatch in the overlay system prompt, cloud embedding stalls on the hot path, routing dead zones.

---

## 1. HARD RULES

R1. PHASE 0 BEFORE ANY FIX. No change without a tagged trace from the live path, captured AT LONG CONTEXT (20+ min simulated), proving the defect. A bug that only exists at minute 25 cannot be diagnosed with a minute-2 trace.
R2. ANTI-THRASH LEDGER in campaign2-log.md. Never fix the same pattern twice; a returning symptom means the pin was wrong — back to forensics. Classification-pattern rewrites for question detection are a banned fix category unless Phase 0 proves extraction itself (not routing, not truncation) is the root cause, and then only once. This also applies across campaigns: check Campaign 1's campaign-log.md ANTI-THRASH LEDGER (read-only) before pinning a cause already pinned/fixed there.
R3. LIVE-PATH PROOF. Temporary tagged logs (`[TRACE:LONGCTX]`, `[FIX:*]`) must be shown firing during a benchmark run before a fix counts.
R4. REAL BACKEND, REAL MODEL. Final benchmarks run the real Natively answer path via the real `natively-api` backend with MiniMax M3 (key from .env; if the name differs, grep for MINIMAX and use what the code reads). Embeddings per production config; fall down the existing cascade if Gemini is unavailable and log it. Requests route through 9Router as in normal operation. Never mock the model in final benchmarks. Mocks allowed only for unit isolation during investigation.
R5. ZERO-HALLUCINATION IS RELEASE-BLOCKING. Any fabricated fact in a doc/transcript-grounded answer = item score 0 + loop-blocking flag until root-caused.
R6. LATEST-QUESTION-WINS. The answer button answers the MOST RECENT interviewer question at press time. Answering a stale question is a desync failure and scores 0.
R7. GIT DISCIPLINE. Branch `fix/longsession-campaign` (already created, off the dirty tree per founder decision — see campaign2-log.md ITERATION 1 notes). Checkpoint commit after every verified fix and every benchmark run, score in the message. Never push, never touch main, never touch `fix/grounding-campaign`, never rewrite history. Regressions get reverted, not patched over.
R8. DO NOT DEGRADE SHORT SESSIONS. Keep a 5-minute short-session smoke suite; it must stay green after every fix. A fix that helps minute 25 but breaks minute 3 is a regression.
R9. FLAGS ARE FINDINGS. A feature flag explaining a symptom is logged and decided deliberately, never silently flipped.
R10. TEMP LOGS OUT AT THE END; keep only the permanent structured answer-path logger defined in Phase 4.

---

## 1.5 QUOTA GUARD — CLAUDE ACCOUNT USAGE VIA 9ROUTER (check after EVERY phase and EVERY benchmark run)

Two Claude accounts are connected via the 9Router proxy at `http://localhost:20128`. 9Router routes requests automatically and fails over when one account is exhausted, so a single dead account is NOT a reason to pause. The rule:

- One account out + other account > 10% remaining → CONTINUE working normally.
- One account out + other account <= 10% session remaining → PAUSE (procedure below).
- Both healthy → continue, just log the numbers.

### Checking usage (reference script — try this first)
```bash
curl -s "http://localhost:20128/api/providers" | jq -r '.connections[] | select(.provider=="claude") | [.id, .name, .priority] | @tsv' | \
while IFS=$'\t' read -r id name priority; do
  echo "=== $name (priority $priority) ==="
  resp=$(curl -s "http://localhost:20128/api/usage/$id")
  if [ "$(echo "$resp" | jq -r 'if .quotas then "yes" else "no" end')" = "no" ]; then
    echo "$resp" | jq -r '.message // "no quota data"'
  else
    echo "$resp" | jq -r '.quotas | to_entries[] | "\(.key): \(.value.remainingPercentage)% remaining (used \(.value.used)/\(.value.total)) — resets \(.value.resetAt)"'
  fi
  echo
done
```
`GET /api/providers` lists all connections; filter `provider=="claude"`; for each id, `GET /api/usage/{id}` returns `plan` and `quotas` (session 5h and weekly 7d: used/total/remainingPercentage/resetAt in UTC). Known quirk: one account's token lacks admin scope and returns "Usage API requires admin permissions" — treat that account's remaining as UNKNOWN, not zero; if it still serves requests it counts as healthy, and if real requests start failing with quota errors treat it as out. NOTE: this quota pool is SHARED with Campaign 1 if both run concurrently — check campaign-log.md's latest QUOTA line too when deciding whether to start an expensive benchmark.

### If the reference script fails — figure it out yourself, in order:
1. Confirm 9Router is up: `curl -s http://localhost:20128/api/providers | head -c 200`; if the port is dead, `lsof -i :20128` / `ps aux | grep -i next-server` to find the real port.
2. Rediscover endpoints: probe `/api/usage`, `/api/usage/{connectionId}`, `/api/quota`; grep the 9Router Next.js build bundle or its SQLite DB for route strings.
3. If NO API works, infer: Claude session quotas are 5-hour rolling windows; estimate reset = (time exhausted account died + 5h), take the later of that and any last-known resetAt from campaign2-log.md; mark the pause time as estimated and re-check on wakeup.
4. Record whatever worked under `QUOTA CHECK METHOD:` in campaign2-log.md so post-compact iterations reuse it directly.

### Interpreting
- The gating number is the SESSION (5h) remainingPercentage of the healthier account once the other is fully out (0% or marked failed/out_of_credits).
- If session quota looks fine but requests still fail, the WEEKLY (7d) pool is the binding limit — use the weekly resetAt as the pause target.

### Pause procedure (only under the pause condition)
1. Cleanly checkpoint the current sub-task; commit per R7 (never pause mid-edit).
2. Resume time = earliest known resetAt across both accounts' binding quotas, +2min buffer (9Router routes to whichever account revives first).
3. Write to campaign2-log.md: `PAUSED FOR QUOTA at <now>. Account states: <numbers>. Resuming at <time>. NEXT ACTION: <exact task>.` Commit.
4. Schedule the next /loop wakeup for that resume time — one delayed wakeup, no busy-wait, never stop the loop for quota.
5. ON RESUME: fresh quota check first. >25% on at least one account → continue NEXT ACTION. Reset hasn't landed → one more wakeup 15min out, repeat. Never start heavy benchmark runs below 15% remaining.

### Cadence
- Mandatory checks: end of Phase 0, after every Phase 1 fix's smoke test, after EVERY full benchmark run, end of Phase 4.
- Pre-check before every expensive operation: a 30-minute simulated session is MANY model calls — if the healthier account is below 25% before starting a full simulation, pause first; a half-run simulation is wasted quota (this campaign's runs are costlier than normal benchmarks, hence 25% not 20%).
- Log every check: `QUOTA: acct1 <x>% / acct2 <y>% (session), <a>%/<b>% (weekly)`.

---

## 2. PHASE 0 — FORENSICS AT LONG CONTEXT (no fixes; instrument first)

### 2.0 Preflight
- Verify MiniMax key and backend reachability (Railway or local natively-api with same .env; log which).
- Locate the exact code path of: rolling transcript store → question detection → answer-button handler → prompt assembly → provider call. Identify the IPC/service entry point the button press invokes; the harness must enter HERE.
- Find every place the transcript or conversation history is truncated, windowed, summarized, or compacted: grep for slice, substring, token budget constants, maxLength, window, trim, compact, history. List each site with file:line in the forensic report.

### 2.1 The Long-Context Golden Trace (mandatory first artifact)
Build a minimal driver that replays a scripted 25-minute interview transcript into the REAL rolling-transcript store at realistic pace-compressed timing (inject text segments as if STT produced them; timestamps spaced as in a real meeting, but you may fast-forward the clock — do NOT sleep 25 real minutes). At simulated minutes 2, 10, 18, and 24, trigger the answer-button path on a known interviewer question and dump for EACH press, to `traces2/golden-longctx-N.txt`:
- full rolling transcript size (chars + estimated tokens) at press time
- the question detector's raw output: what question text was extracted, from which transcript span, with what confidence
- the COMPLETE final prompt sent to the provider: system message, extracted question, transcript context included, retrieved knowledge blocks, history — full strings, plus per-section token counts and the total vs the provider/context limit
- raw model response and what the UI would show
Compare minute-2 vs minute-24 dumps side by side. The diff between a working press and a failing press IS the diagnosis. Specifically answer in writing: at minute 24, does the extracted question actually appear in the final prompt? Is the system instruction still intact or truncated? What got evicted as the transcript grew?

### 2.2 Hypothesis checklist — verify each with a long-context trace; mark CONFIRMED / REFUTED / N-A

H1. QUESTION LOST IN ASSEMBLY. As the transcript grows, the prompt assembler's token budget evicts or truncates the EXTRACTED QUESTION itself (or appends transcript after the question so the model attends to trailing chatter). A prompt whose final content is ambient transcript with no clear task = the model greets. Check assembly order and what the truncation function cuts from (head vs tail vs middle).
H2. SYSTEM PROMPT EVICTION/DILUTION. The system/mode instructions get truncated, or the ratio of instructions to raw transcript becomes so small the model ignores them. Check whether truncation can EVER touch the system message; check total tokens vs the model's context limit and vs any backend-enforced max — a silent server-side truncation (Fastify body limit, provider max_tokens/context clipping, 9Router limits) would exactly produce garbage-in behavior only at long context.
H3. EXTRACTION DEGRADATION ON ROLLING TRANSCRIPT. The question detector works on short transcripts but at 20+ min: picks an OLD question instead of the latest; concatenates fragments of multiple questions; extracts the user's own words (channel confusion between mic and system audio as buffers grow); or returns empty → empty question → greeting. Log extractor input-window size: does it scan the whole transcript (slow + error-prone at scale) or a recent window (and is the window anchored correctly to press time)?
H4. HISTORY/STATE BLOAT & CONTAMINATION. Prior Q&A pairs accumulate in the conversation sent to the provider; at long context old answers dominate, causing answers to previous questions (the "different answer" symptom). Check whether history is capped, summarized, or unbounded; check whether a stale in-flight request from an earlier press can complete late and render over the current answer (desync at long context because latency grows with prompt size).
H5. LATENCY-INDUCED RACES. Prompt size grows → provider latency grows → timeouts fire → retry/fallback paths produce a fresh no-context call (a bare call with no question = greeting), or a timeout handler falls back to a generic prompt. Grep every timeout/retry/fallback around the provider call; log which path each long-context press took.
H6. RECALL/RAG MISFIRE AT SCALE. Retrieval over transcript/history (Hindsight, hybrid, graph) returns generic early-meeting chunks instead of the relevant recent span, or the embedding of a huge query stalls (known prior defect: cloud embedding stalls on the hot path), or transcript indexing lags real time so recent minutes aren't retrievable. Measure: for a question at minute 24 referencing minute 6 content, does retrieval surface the minute-6 span?
H7. MEMORY/BUFFER DEFECTS. Renderer↔main IPC payload limits, string builders, or circular buffers silently dropping/corrupting transcript at size; check for any fixed-size buffer, JSON payload limit, or SQLite row-size behavior in the transcript store.
H8. TOKENIZATION/COUNTING DRIFT. Token estimates used for budgeting diverge from real tokenization at scale (e.g. char/4 heuristics), so the assembler believes it's under budget while the provider clips the tail — or over-trims and sends almost nothing.
H9. PROVIDER-SIDE BEHAVIOR. MiniMax M3 itself degrading on very long prompts (lost-in-the-middle). Only pin this if H1–H8 are refuted AND the dumped prompt at minute 24 is verifiably well-formed (question present, instructions intact, under context limit) yet the answer is still a greeting/hallucination. The fix then is prompt slimming + question-last positioning, not blaming the model in the report without proof.
H10. SESSION LIFECYCLE. Something resets mid-session (mode state, knowledge attach, auth token refresh through 9Router) wiping context so the next press behaves like a brand-new session — which literally produces "Hi! How can I help you?". Check logs for reconnects/re-inits around the failure times.

### 2.3 Forensic report
`traces2/forensic-report.md`: every hypothesis with verdict + trace excerpt; the truncation-site inventory from 2.0; a table of prompt composition (tokens per section) at minutes 2/10/18/24; pinned root causes ranked by impact. Only pinned causes get fixed. Commit. Quota check.

---

## 3. PHASE 1 — FIX (one pinned cause at a time, highest impact first)

Per fix: state pin + trace quote → minimal change in the proven live path → `[FIX:*]` log shown firing → rerun the exact failing press → SKEPTIC pass (spawn a subagent that tries to falsify the fix: rerun, read the trace, check flags) → short-session smoke suite still green (R8) → commit. If worse, revert and re-investigate.

Fix directions per hypothesis (verify applicability first):
F-H1/H2 (assembly): Enforce an explicit priority-ordered prompt budget that can NEVER evict: (1) system/mode instructions, (2) the extracted question, (3) answer policy. Variable-size sections (transcript context, history, retrieved knowledge) each get a hard cap and are trimmed OLDEST-FIRST/least-relevant-first. Place the extracted question LAST in the user message with an explicit marker ("The interviewer just asked: …") so recency attention works for us. Add an assembly-time assertion: if the final prompt lacks a non-empty question, ABORT the call and emit a visible "couldn't detect the question — tap again" state instead of letting the model greet. That assertion alone permanently kills the greeting failure mode regardless of upstream cause.
F-H3 (extraction): Anchor extraction to a recency window ending at press time (e.g. last 60–90 seconds of interviewer-channel transcript), using channel labels to never extract the user's own speech; prefer the most recent interrogative/request span; fall back to the last interviewer utterance if no explicit question form. Keep it deterministic-first with the LLM only as fallback, so the harness can measure it exactly. Do not rewrite classifier patterns wholesale (R2) — fix windowing/anchoring/channel selection, which Phase 0 must have proven defective.
F-H4 (history): Cap conversation history to the last N Q&A pairs (start N=3) plus a compact running summary of older ones; answers attach to question ids; cancel in-flight requests on a newer press (latest-question-wins, R6).
F-H5 (races/timeouts): No fallback path may ever call the provider without the extracted question. Timeout handling = surface a retry state, never a degraded bare call. Scale the timeout with prompt size.
F-H6 (recall): Ensure the transcript is incrementally indexed within seconds of arrival (measure lag); recency-boost retrieval for meeting context; if a cloud embed sits on the button-press hot path, move it off (local embedder for queries, matching index dimensions) — this was a previously pinned defect class, verify it isn't back.
F-H7/H8: Replace char-based token heuristics with a real tokenizer count at assembly time; fix any fixed-size buffer/IPC limit with chunked transfer or a size increase, with a loud log when near limits.
F-H9: Prompt diet — summarize distant transcript, keep verbatim only the recent window and retrieved relevant spans; question last; instructions restated compactly at the end if needed.
F-H10: Make session state survive token refresh/reconnect; re-attach mode + knowledge automatically on any re-init and log the event.

---

## 4. PHASE 2 — TEST HARNESS: 30-MINUTE SIMULATED INTERVIEW (built by the test-engineer agent)

Spawn the @test-engineer agent to build and own this. The test-engineer never edits product code; a separate fixer agent does. Location: `test/harness-longsession/`.

Design:
- SCRIPTED INTERVIEWS: Author 3 interview scripts (JSON/YAML), each a 30-minute two-channel timeline: `[{t: "00:00:12", channel: "interviewer", text: "..."}, {t: "00:00:31", channel: "user", text: "..."}, ...]`. Script A: software-engineer interview grounded in an attached resume + JD (reuse fixtures from the grounding campaign if present at test/harness/fixtures/, else create per that campaign's rules). Script B: technical deep-dive grounded in a reference PDF (thesis/arXiv paper). Script C: adversarial/messy — interruptions, rephrased questions, questions split across utterances ("So my question is… actually let me rephrase…"), back-references ("earlier you mentioned X, expand on that"), filler small talk, and one embedded prompt injection inside interviewer speech. 15–20 answer-button press points per script, each annotated in the script with: expected extracted question (canonical form), expected answer facts (manifest substrings), and whether it requires LONG-RANGE RECALL (references content >10 simulated minutes older).
- FEEDING: Bypass STT entirely. Inject each timeline segment into the real rolling-transcript store through the same code path STT output uses (the function STT calls with recognized text + channel + timestamp), fast-forwarding simulated time. Everything downstream — transcript store, question detection, button handler, prompt assembly, retrieval, real backend, MiniMax M3 through 9Router — is REAL and untouched.
- PRESSES: At each annotated point, invoke the actual answer-button handler (same IPC/service entry as the UI). Record: extracted question, full final prompt (to a per-press trace file), answer, latency.

Grading (deterministic first, LLM-judge second):
- G1 QUESTION EXTRACTION (target >= 98%): extracted question must match the annotated canonical question (normalized fuzzy match; latest-question identity is exact — extracting any OTHER question in the script = 0). This directly benchmarks extraction quality from the rolling transcript.
- G2 GREETING FAILURE (target = 0 occurrences): any response matching greeting/boilerplate patterns ("hi", "how can I help/assist", "hello!", offers of assistance) on a press that had a real question = automatic 0 + a GREETING flag. Two consecutive final runs must have zero flags.
- G3 ANSWER QUALITY (target >= 95%): MiniMax LLM-judge with strict rubric — answers THE asked question, grounded in resume/JD/reference + transcript, natural first-person interview delivery, no meta-talk. Manifest substring checks where annotated.
- G4 HALLUCINATION (target = 0): any unsupported factual claim = 0 + loop-blocking flag (R5).
- G5 LONG-RANGE RECALL (target >= 90%): the back-reference presses — did the answer correctly use the >10-min-old content? This benchmarks RAG/Hindsight/graph recall of older chat.
- G6 DESYNC (target = 0): answer must correspond to the press-time latest question (question-id match), including under Script C's rapid rephrase sequences.
- G7 INJECTION (must not comply) and G8 LATENCY (report p50/p95 per press at minute buckets 0–10/10–20/20–30; flag if latency grows superlinearly with session time).
- Also run a 5-minute SHORT-SESSION SMOKE version of Script A after every fix (R8).
Output: `reports/run-NNN.json` + `.md` — per-gate scores, per-press traces for every failure, prompt-size-over-time chart data, latency buckets. Commit every report. Quota check after every run (a full 3-script run is expensive — pre-check at 25%, Section 1.5).

---

## 5. PHASE 3 — THE LOOP TO PRODUCTION-READY

```
while true:   # /loop wakeups; exit ONLY via L4 + ScheduleWakeup stop:true
  quota pre-check (1.5): healthier account < 25% -> pause-wakeup at resetAt
  run full 3-script benchmark (+ short-session smoke)
  commit report; append scores to campaign2-log.md
  if L4 exit condition met for TWO consecutive runs: break -> Phase 4 hardening, then stop loop
  pick the failure cluster costing the most (greeting flags first, hallucination second,
     extraction third, recall fourth)
  mini-forensics on ONE representative failing press trace (Phase 0 discipline;
     check anti-thrash ledger — a repeat pin means dig deeper, not re-patch)
  fix -> live-path proof -> skeptic -> smoke -> full benchmark
  quota check (1.5); /compact if context heavy (log carries everything)
```
Plateau rule: < 2 points improvement across 3 iterations → stop patching, re-run the full Golden Trace (2.1) on the worst-failing press; your mental model has drifted. Flaky-run rule: an item counts as failed for the exit condition only if it fails 2 of 2 adjudication runs; but greeting and hallucination flags count on FIRST occurrence — those are never dismissed as flake.

---

## 6. PHASE 4 — PRODUCTION HARDENING

- The no-question assertion (F-H1) becomes permanent: the provider is never called without a non-empty extracted question; UI shows a retry state instead.
- Permanent prompt-budget invariants as unit tests: instructions + question can never be evicted; per-section caps enforced; real-tokenizer counting; assembled-prompt-contains-question assertion.
- Permanent structured logger on the answer path: press id, transcript size, extracted question, per-section token counts, retriever used, model, latency, outcome — sampled traces retained for the last N presses so a future user complaint is diagnosable from logs alone.
- History cap + summary policy locked by tests; latest-question-wins cancellation locked by a test; transcript indexing lag monitored with a warning threshold.
- Session-lifecycle test: simulated token refresh mid-session must not wipe mode/knowledge state.
- Remove `[TRACE:*]`/`[FIX:*]` temp logs (R10).
- `traces2/final-report.md`: before/after per-gate scores, the verified long-context prompt composition at minute 24 (token table), every pinned cause + fix commit hash, latency curve before/after, remaining gaps, and a ranked list of post-95 improvements (streaming first tokens, transcript summarization quality, reranking for recall, extraction confidence UI).

---

## 7. 3AM RESOLUTION RULES (never stop, never ask)

- Backend unreachable → run natively-api locally with the same .env; log it.
- MiniMax key absent under the expected name → grep all env files + backend config; check if the backend proxies the provider; use whichever REAL path works; only if none exists, run on the highest-priority real provider in the existing cascade and flag it at the top of the final report.
- Gemini embeddings down → bundled bge-small-en-v1.5 with dimension pinning; log it.
- Electron won't run headless → drive the main-process handler functions directly from a Node test entry importing the same modules; same code path is the requirement, not same window.
- Fast-forwarding simulated time breaks something that assumes wall-clock → inject a clock abstraction in the harness layer only; if the product code itself hard-depends on wall-clock in a way that matters, that's a finding — log it, and run that one adjudication pass at real-time pace for the affected presses only.
- Harness flake (same code ± wildly different scores) → seed/pin what the provider allows, reduce concurrency to 1, adjudicate 2-of-2 (except greeting/hallucination: first occurrence counts).
- MiniMax rate limits → exponential backoff, single worker; never swap the generation model to keep moving.
- Security finding en route (key in logs, injection reaching the prompt unsanitized) → in scope, fix and log.
- Context exhausted mid-fix → campaign2-log.md's last line is ALWAYS `NEXT ACTION: …`; compact and resume.

Begin now: iteration 1 — create campaign2-log.md, run Phase 0 preflight, then the Long-Context Golden Trace. The minute-2 vs minute-24 prompt diff is your fastest path to the truth. Every iteration reschedules its next wakeup; the loop stops only via ScheduleWakeup stop:true after L4 holds for two consecutive runs. The founder wakes up to traces2/final-report.md, green reports, and a branch of clean commits.
