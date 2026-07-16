# OVERNIGHT AUTOPILOT CAMPAIGN: Fix Natively Grounding, Modes Manager, Profile Intelligence, Meeting Overlay

## /LOOP PROTOCOL — READ THIS FIRST

This campaign runs under Claude Code's /loop scheduled-task skill. Save this entire document as `loop.md` in the repo root (or `.claude/loop.md`) so a bare `/loop` picks it up as the loop prompt. Each loop iteration is a wakeup; this document is your instructions on every wakeup. Mechanics you MUST respect:

L1. RESCHEDULE OR DIE. If an iteration ends without rescheduling the next wakeup or explicitly stopping, the loop gets one ~20-minute fallback wakeup and then ends silently — which means the founder wakes up to an abandoned half-done campaign. Therefore: at the END of EVERY iteration, either reschedule the next wakeup (self-paced, immediate or short-delay continuation is fine while work remains) or, if and only if the EXIT CONDITION in L4 is fully met, stop the loop via ScheduleWakeup with stop: true. Never end a turn in any other way.
L2. ON EVERY WAKEUP: read `campaign-log.md` first. Its final line is always `NEXT ACTION: …`. Execute that action. If campaign-log.md does not exist, this is iteration 1: create it, then begin Phase 0 preflight and the Golden Trace.
L3. BEFORE ENDING EVERY ITERATION: update campaign-log.md with (a) what was done, (b) latest benchmark score if one ran, (c) anti-thrash ledger state, (d) a final `NEXT ACTION: …` line specific enough that a fresh context can execute it cold. Commit. Then reschedule per L1.
L4. EXIT CONDITION (the ONLY valid reason to stop the loop): `traces/final-report.md` exists AND the two most recent reports in `test/harness/reports/` both show overall >= 95%, every category >= 90%, zero hallucination flags, false-refusal rate on answerable questions <= 2%, AND Phase 4 hardening items are checked off in campaign-log.md. Anything less: reschedule and continue.
L5. PREMATURE SUCCESS IS THE FAILURE MODE. Any claim of "fixed" or "working" without a green `run-NNN.md` benchmark report is invalid. If you catch yourself concluding without benchmark evidence, the NEXT ACTION is: run the full benchmark, then reschedule.
L6. `/compact` freely — campaign-log.md is your memory, not the context window. Post-compact, L2 applies.
L7. If a wakeup lands in a broken state (build failing, harness crashed), NEXT ACTION is to restore a working state from the git checkpoints (R8) before resuming, then reschedule.
L8. Iteration budget is unlimited within the session. 100+ iterations is expected. Never trade correctness for finishing sooner. Edits to loop.md take effect next iteration, so you may refine YOUR OWN loop instructions if you discover the campaign doc needs a correction — log any such self-edit in campaign-log.md.
L9. QUOTA GUARD. Two Claude accounts are connected through a local 9Router proxy (localhost:20128) which auto-routes between them. You MUST check both accounts' usage at the end of EVERY phase and after EVERY full benchmark run, per Section 1.5. Pause-and-resume rules: never pause just because one account is exhausted (9Router fails over to the other automatically). Pause ONLY when one account is fully out AND the remaining account is at <= 10% session quota remaining. Pausing means: write NEXT ACTION into campaign-log.md, commit, then schedule the next wakeup for the earliest quota resetAt time (plus a 2-minute buffer) instead of an immediate wakeup — so the campaign resumes by itself the moment quota returns. Never end the loop for quota reasons; never burn the last 10% racing a reset.

FOUNDER SETUP (one time, before sleeping):
1. Save this file as `loop.md` in the Natively repo root.
2. Start Claude Code in the repo, enable auto/permissive mode so iterations never stall on permission prompts.
3. Set the goal so the done-state persists across every turn:
   `/goal Grounding campaign complete: traces/final-report.md exists and the two most recent test/harness/reports show >=95% overall, >=90% per category, zero hallucinations, <=2% false refusals, per loop.md L4. Do not stop before this.`
4. Run `/loop` (bare — it will pick up loop.md as the prompt, self-paced).
5. Keep the terminal/session open; loops are session-scoped and die if the session closes. If the machine may sleep, disable sleep or run inside tmux.

You are running unattended for many hours. The founder is asleep. You will NEVER ask a question, NEVER wait for input, NEVER stop at a decision point. Every ambiguity has a resolution rule in this document. If a situation is truly not covered, choose the option that (a) preserves zero-hallucination, (b) reduces false refusals, (c) touches the least code, and log the decision in campaign-log.md. Run `/compact` whenever context is above ~70% full; campaign-log.md is your external memory and must always contain enough state to resume from a fresh context. 100+ iterations is fine. You are done ONLY when the stop condition in Phase 3 is met, or you have exhausted every pinned root cause and documented why the remainder cannot be fixed tonight.

---

## 0. WHAT IS BROKEN (founder's observed symptoms — treat as ground truth)

1. FALSE REFUSALS ARE THE #1 BUG. The meeting overlay answers "that's not in the reference files" / "I can only respond from uploaded sources" even on the VERY FIRST question after attaching a document, and even when the answer is VERBATIM in the attached file.
2. Nondeterminism: same setup, sometimes correct answer, sometimes hallucination, sometimes answers a completely different question, sometimes silence/no answer.
3. Mode + knowledge combination is broken: with a mode selected in Modes Manager AND a resume/JD attached in that mode's knowledge section, answers are NOT grounded in the resume/JD. The model refuses citing "uploaded sources only" while ignoring the sources that ARE uploaded.
4. Founder rates Modes Manager, Profile Intelligence, and Meeting Overlay at 1/10. Target: at least Cluely-parity, ideally better. The single non-negotiable strength to preserve: the system currently never fabricates on doc-grounded answers when it DOES answer. Do not trade hallucination for helpfulness.

Architecture context: Electron + TypeScript frontend, Rust components, Fastify backend `natively-api` (Railway). Providers: MiniMax M3 for generative requests, Gemini for embedding/indexing, with a cascade including OpenAI, Ollama, and bundled bge-small-en-v1.5 (384d). Knowledge subsystems that exist in the codebase: chunk RAG, HybridSearchEngine (hybrid RAG), Hindsight, profile tree, knowledge graph, OKF Knowledge Packs under `electron/services/knowledge/` (KnowledgeManager, OkfExtractor, OkfCardBuilder, OkfVerifier, OkfMarkdownExporter, OkfRetriever, EvidenceAssembler), KnowledgeOrchestrator, an AOT pipeline, and a deterministic fast path in `manualProfileIntelligence.ts`. Feature flags include okfKnowledgePacks, okfHybridRetrieval, docGroundedStrictIsolation. Doc-grounded settings: TOP_K=12, context token budget 3600. Evidence priority: OKF cards > raw chunks > graph; Hindsight/profile is NEVER document truth. Safe refusal phrase, exact string: "I could not find that in the retrieved sections". False-refusal repair: max one attempt per question.

The founder's core suspicion, which you must confirm or refute per subsystem with evidence: these knowledge systems are either NOT wired into the live overlay answer path at all, or wired incorrectly, i.e. the app has accumulated disconnected knowledge systems.

---

## 1. HARD RULES (violating any of these is campaign failure)

R1. PHASE 0 BEFORE ANY FIX. No code change lands without a tagged trace from the LIVE call path proving the defect at that exact site. "I read the code and I think" is not evidence. A log line firing during a real failing run is evidence.
R2. ANTI-THRASH LEDGER. Maintain a ledger in campaign-log.md of every pinned root cause and every fix. You may never fix the same pattern twice. If a symptom returns after its cause was "fixed", the pin was wrong: return to forensics, do not patch again on top.
R3. LIVE-PATH PROOF. Every fix gets a temporary tagged log (e.g. `[FIX:overlay-prompt-v2]`) and you must show it firing in a benchmark run before counting the fix as landed. Dead-branch fixes are worthless.
R4. REAL BACKEND, REAL MODEL. Final benchmarks use the real Natively answer path with MiniMax M3 via MINIMAX_API_KEY from `.env` (check `.env`, `.env.local`, and the natively-api env; if the key name differs, grep for MINIMAX and use what the code actually reads). Gemini handles embeddings as in production; if a Gemini key is absent, fall back down the existing embedding cascade to the bundled bge-small-en-v1.5 local model and LOG that the benchmark ran on local embeddings. Never mock the model in the final benchmark.
R5. ZERO-HALLUCINATION IS RELEASE-BLOCKING. Any benchmark run where the system states a fact not supported by the attached documents (for doc-grounded categories) is a regression, scored 0 for that item, and must be root-caused before the loop continues.
R6. EVIDENCE PRIORITY STAYS: OKF cards > raw chunks > graph. Hindsight/profile never used as document truth. Safe refusal phrase stays exactly "I could not find that in the retrieved sections" and may be emitted ONLY when retrieval genuinely returned no relevant evidence.
R7. FLAGS ARE FINDINGS. If a feature flag being off explains a symptom, log it as a finding and make a deliberate decision: flip it only if the flagged path passes its own tests; otherwise fix the non-flagged live path. Never silently flip flags.
R8. GIT DISCIPLINE. Create a branch `fix/grounding-campaign` at the start. Commit a checkpoint after every verified fix and after every benchmark run with the score in the commit message (e.g. `bench: 71.4% overall, false-refusal 18%`). Never push, never touch main, never rewrite history. These checkpoints are your rollback points: if a fix makes the benchmark worse, `git checkout` the files back and re-investigate.
R9. NEVER DEGRADE INTO REFUSING EVERYTHING OR ANSWERING EVERYTHING. The two failure poles are: refusing answerable questions (current bug) and answering unanswerable ones (hallucination). The benchmark has categories that punish both. You must satisfy both simultaneously.
R10. TEMP LOGS OUT AT THE END. Before finishing, remove or downgrade-to-debug-level the temporary `[TRACE:*]` and `[FIX:*]` logs, keeping permanent structured logging where Phase 4 says so.

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
How it works: `GET /api/providers` lists all connections; filter `provider=="claude"`; for each id, `GET /api/usage/{id}` returns `plan` and `quotas` (session 5h and weekly 7d, each with used/total/remainingPercentage/resetAt in UTC). Known quirk: one account's token may lack admin scope and return "Usage API requires admin permissions" instead of quotas — treat that account's remaining as UNKNOWN, not zero.

### If the reference script fails (endpoint changed, 9Router updated, jq missing, etc.) — figure it out yourself, in this order:
1. Confirm 9Router is up: `curl -s http://localhost:20128/api/providers | head -c 200`. If the port is dead, check the running process (`lsof -i :20128` / `ps aux | grep -i next-server`) and find the actual port.
2. Rediscover endpoints: probe `/api/usage`, `/api/usage/{connectionId}`, `/api/quota`, and grep the 9Router install's Next.js build bundle or SQLite database for route strings if needed.
3. If NO API path works at all, fall back to inference: you know your own request cadence; Claude session quotas are 5-hour rolling windows. Estimate reset as (time the exhausted account died + 5h) and use the LATER of that and any last-known resetAt from campaign-log.md. Log that the pause time is estimated, and on wakeup re-check before resuming heavy work.
4. Whatever method worked, write it into campaign-log.md under `QUOTA CHECK METHOD:` so future iterations (and post-compact you) use the working method directly instead of re-deriving it.

### Interpreting the numbers
- The number that gates pausing is the SESSION (5h) remainingPercentage of the healthier account, once the other account is fully out (0% session, or 9Router marks it failed/out_of_credits).
- An account with UNKNOWN quota (admin-permission message) that is still successfully serving requests counts as healthy. If it starts returning quota/rate-limit errors on real requests, treat it as out.
- Weekly (7d) quota matters only if session quota is fine but requests still fail: then the weekly pool is the binding limit — use the weekly resetAt for the pause target instead.

### Pause procedure (only under the pause condition)
1. Finish or cleanly checkpoint the current sub-task (do NOT leave the repo mid-edit; commit per R8).
2. Determine resume time: the earliest resetAt among the exhausted account's session quota and the low account's session quota, converted from UTC, plus a 2-minute buffer. If both resets are known, prefer the earlier one — the campaign can resume the moment EITHER account refreshes, since 9Router will route to whichever is alive.
3. Write to campaign-log.md: `PAUSED FOR QUOTA at <now>. Account states: <numbers>. Resuming at <time>. NEXT ACTION: <the exact task to continue>.` Commit.
4. Schedule the next /loop wakeup for that resume time (this is the "internal timer": a delayed wakeup instead of an immediate one). Do NOT stop the loop; do NOT busy-wait or poll — one delayed wakeup.
5. ON RESUME: first action is a fresh quota check. If quota is actually back (>25% on at least one account), continue the NEXT ACTION. If the reset hasn't landed yet (clock skew, estimate was off), schedule one more wakeup 15 minutes out and repeat. Never resume heavy benchmark runs below 15% remaining.

### Cadence
- Mandatory checkpoints: end of Phase 0, after every Phase 1 fix's smoke test, after EVERY full benchmark run in Phase 3, end of Phase 4.
- Additionally, before starting any known-expensive operation (a full 40+ question benchmark costs many requests): pre-check, and if the healthier account is already below 20%, pause FIRST rather than risk a half-run benchmark — a partial run is wasted quota.
- Log every check as one line in campaign-log.md: `QUOTA: acct1 <x>% / acct2 <y>% (session), <a>%/<b>% (weekly)` so the burn rate over the night is auditable.

---

## 2. PHASE 0 — FORENSICS (no fixes in this phase; expected duration: your first 1–3 hours)

### 2.0 Preflight
- `grep -r MINIMAX .env* natively-api/.env* 2>/dev/null` — confirm the key exists. Confirm which model string the code sends for MiniMax M3.
- Find how to run the answer path headless: locate the IPC channel / service entry point the overlay uses (grep the renderer for the send call, then the main-process handler). The harness must enter through THIS entry point, not a parallel test-only path. If a true headless boot is impossible, drive the Electron main process with a test entry script that calls the same handler function directly with the same arguments the IPC layer would pass.
- Verify the app builds and the backend is reachable. If natively-api on Railway is unreachable, run it locally from the repo with the same .env; log which one the benchmark used.

### 2.1 The Golden Trace (do this first, it will explain most of the mystery)
Instrument ONE real overlay question end to end with tagged logs at every stage:
renderer question text → IPC payload → router/mode resolution → which retriever(s) actually execute → per-retriever results (chunk ids, scores, first 80 chars of each chunk) → context assembly (final ordered evidence block, token count vs 3600 budget) → the EXACT final system prompt and user message sent to the provider (dump full strings to a file, `traces/golden-trace-1.txt`) → raw model response → any post-processing/validation → what the UI would display.
Attach a test resume, ask "What is the candidate's most recent job title?", capture the trace. Then answer in the log, with quotes from the trace:
- Was the document indexed at question time? (timestamps of index-complete vs question-fired)
- Did retrieval return the answer-bearing chunk? At what rank/score?
- Did the assembled context actually contain it, or did the 3600 budget truncate it out?
- What EXACTLY does the system prompt say about refusing? Read it as an adversarial lawyer: does it tell the model to refuse whenever unsure, without telling it what "grounded" means or how to use the evidence block? Is there a leftover no-op escape hatch (a previously pinned defect: an escape-hatch clause in the live overlay system prompt that was supposed to be removed)?
- Did the model see an EMPTY or malformed evidence block? (This single condition + a strict prompt = the exact symptom of refusing the first question.)

### 2.2 Hypothesis checklist — verify each with a trace, mark CONFIRMED / REFUTED / N-A
These are ranked by prior probability given the symptoms and this codebase's history. Do not skip any.

H1. INDEXING RACE. Document attach triggers async chunk+embed; the overlay allows questions immediately; first question races indexing, retrieval returns empty, strict prompt refuses. Explains "fails even on first message" and nondeterminism (sometimes indexing wins). Test: attach doc, fire question at t+0s, t+5s, t+30s; compare retrieval results. Also check for cloud embedding stalls on the hot path (previously pinned defect) — is a Gemini embed call sitting between question and answer?
H2. PROMPT OVER-CONSTRAINT / ESCAPE-HATCH REGRESSION. The overlay system prompt says "only answer from uploaded sources" but either (a) doesn't clearly delimit and reference the evidence block, so the model doesn't realize the sources ARE in its context, or (b) the previously fixed no-op escape hatch is back / was never actually removed from the LIVE prompt (there may be multiple prompt template files; find which one the live path loads).
H3. MODE PROMPT CLOBBERS KNOWLEDGE BLOCK. When a mode is selected, prompt assembly switches to a mode template variant that omits or overwrites the document evidence section. Check assembly order and whether mode + evidence compose additively. Also re-check JD contamination bypassing layer exclusion (previously pinned) — the inverse bug (exclusion logic now excluding legitimate doc content) would exactly produce "ignores the resume/JD I attached".
H4. ROUTING DEAD ZONE. The question classifier/router sends certain questions down a "no knowledge" or "general chat" branch that never calls retrieval. Previously pinned as broken routing dead zones. Test with 10 phrasings of the same answerable question; log which branch each takes.
H5. EMBEDDING DIMENSION MISMATCH. Query embedded with one provider (e.g. 768d Gemini), index built with another (e.g. 384d bge) after a cascade fallback, similarity silently ~0 or erroring, retrieval returns nothing. Check stored vector dims vs query dims, and what happens on provider fallback mid-session.
H6. RETRIEVAL PRECISION. Retrieval runs but generic/abstract chunks outrank answer-bearing chunks (known from Seminar Mode validation). Distinguish from H1/H5: here retrieval returns 12 chunks but the wrong ones.
H7. VALIDATOR FALSE POSITIVES. A post-answer groundedness validator rejects correct answers and swaps in the refusal. Previously the validator was "toothless" (fabrication passed) — a fix may have overcorrected. Log validator input/verdict for a known-correct answer.
H8. DOUBLE EXECUTION / QUESTION-ANSWER DESYNC. Two pipeline executions per question (previously pinned) causing answers to attach to the wrong question or duplicate/garbled output. Explains "answers something else entirely". Count executions per question id in the trace.
H9. DISCONNECTED SUBSYSTEMS. OkfRetriever/EvidenceAssembler/HybridSearchEngine/KnowledgeOrchestrator exist but the overlay path calls only legacy chunk RAG (or nothing). For EACH subsystem produce a verdict: WIRED-LIVE (trace shows it executing) / WIRED-BUT-BROKEN / DEAD-CODE (no live call site) / FLAG-GATED-OFF (call site exists, flag off). Grep for call sites, then confirm with runtime traces, since a call site inside an `if (flags.okfHybridRetrieval)` that's off is not live.
H10. STATE/SESSION BUGS. Knowledge attached in Modes Manager not propagated to the overlay session (different stores, stale cache, mode id mismatch), so the overlay genuinely has no documents even though the UI shows them attached.

### 2.3 Forensic report
Write `traces/forensic-report.md`: each hypothesis with verdict + trace excerpt; the subsystem wiring table (H9); pinned root causes ranked by expected impact on the benchmark. ONLY pinned causes may be fixed. Commit.

---

## 3. PHASE 1 — FIX (one pinned cause at a time, highest impact first)

For each pinned cause: state it, quote the trace, make the MINIMAL fix in the proven live path, add a `[FIX:*]` tag log, rerun the exact failing trace, show the stage output changed as predicted, run a 10-question smoke subset of the benchmark, commit. If the smoke subset got worse, revert and re-investigate — do not stack a second fix on top.

Fix guidance per hypothesis (verify applicability first, never apply blind):

F-H1 (race): Gate the answer path on index-ready for the attached docs. Options in order of preference: (1) await indexing completion for newly attached docs before the first retrieval, with the overlay showing an "indexing your document…" state instead of answering ungrounded; (2) if indexing exceeds ~8s, answer with an explicit "still indexing, preliminary answer from general knowledge is disabled in doc-grounded mode" style status rather than the refusal phrase. Move any cloud embedding of the QUERY off the critical path if a local embedder with matching dimensions to the index exists; otherwise keep provider consistent with the index (see F-H5).
F-H2 (prompt): Rewrite the overlay doc-grounded system prompt to the graceful-degradation pattern: clearly delimited EVIDENCE section with numbered snippets and source names; instruction: if evidence contains the answer, answer concisely and naturally (this is a live meeting overlay — answer like a confident human, first person where the mode implies it, no meta-talk about "the document states" unless citing adds credibility); if evidence is partially relevant, answer what is supported and say what isn't covered; ONLY if evidence is empty or irrelevant, output exactly "I could not find that in the retrieved sections". Remove any escape hatch. Keep docGroundedStrictIsolation semantics: no Hindsight/profile content presented as document truth. Store the prompt in ONE place; delete/redirect duplicate template files so live and edited prompt cannot diverge again.
F-H3 (composition): Make prompt assembly additive and ORDERED: base overlay instructions → mode persona/instructions → evidence block → answer policy. Add a unit test asserting all three sections present in the assembled string when mode+doc are both set. Fix layer exclusion so it excludes only what it was designed to exclude (profile layers from doc-truth), never attached documents.
F-H4 (routing): Collapse dead zones: default branch for ANY question while documents are attached in the active mode must be the doc-grounded retrieval branch. Classification may add layers (e.g. also use profile) but may never remove retrieval when docs exist. Do NOT rewrite the classifier patterns (anti-thrash: classification-pattern fixes are banned as a category); change the branch topology instead.
F-H5 (dimensions): Enforce index-provider pinning: the provider+dimension used to build an index is stored with the index; queries against it MUST use the same provider, else re-embed the query with the pinned provider or rebuild. Fail loudly in logs on mismatch, never silently return empty.
F-H6 (precision): Only address if it's a pinned cause of benchmark failures. Cheapest effective levers: prepend chunk headers (section titles) to chunk text before embedding; hybrid score = dense + BM25 via the existing HybridSearchEngine if verdicted WIRED-LIVE-able; boost exact keyword/entity overlap with the question; deprioritize abstract/summary chunks for specific questions by penalizing chunks with high generic-similarity to the whole-doc centroid. Do not build a new reranker service tonight; wire what exists.
F-H7 (validator): Validator verdicts must be evidence-based: pass if answer's factual spans are entailed by any retrieved chunk (string/fuzzy containment is fine tonight). One repair attempt max on validator failure, then safe refusal. Log every validator rejection with the answer and the chunks so future false positives are diagnosable.
F-H8 (double exec/desync): Add a per-question execution id; assert single execution per id; cancel in-flight executions when a newer question arrives (latest-question-wins for a live overlay); attach answers to question ids, not to "most recent slot".
F-H9 (wiring): If OKF/hybrid paths are healthy behind flags and pass their own tests, wire them into the live overlay path per the intended evidence priority (OKF cards > raw chunks > graph) via EvidenceAssembler. If they are broken, leave flags off, note it, and make the legacy path correct — a working simple path beats a broken sophisticated one tonight.
F-H10 (state): Single source of truth for "attached knowledge of the active session": overlay reads the same store Modes Manager writes, keyed by mode id; add a trace log of doc ids visible to the answer path at question time.

---

## 4. PHASE 2 — TEST HARNESS (build in parallel with early fixes)

Location: `test/harness/`. Node/TS. It must enter the product through the same handler the overlay IPC uses (see 2.0), with real indexing, real retrieval, MiniMax M3 for generation.

Fixtures (`test/harness/fixtures/` + `manifest.json` of expected facts per doc):
- 2 real resumes: download public sample resume PDFs (e.g. from GitHub repos of resume samples — search raw.githubusercontent.com sources; if downloads fail due to network limits, GENERATE two realistic resumes as PDFs yourself with distinct names, employers, dates, metrics, and save them — generated fixtures are acceptable, mocked model calls are not).
- 2 job descriptions (markdown or PDF, one engineering one non-engineering).
- 2 reference docs: one arXiv paper PDF (reuse "Sample thesis for testing.pdf" if present in the repo/test assets) and one long-form product spec/article.
Every fixture gets 8–15 manifest entries: question, expected fact substrings (for deterministic grading), category, difficulty.

Benchmark: minimum 40 questions across categories:
C1 verbatim-in-doc (answer is a literal span) — weight 3
C2 synthesis across 2+ chunks — weight 2
C3 mode+resume grounding ("Interview mode" active, resume attached, questions like "walk me through your last role") — weight 3
C4 mode+JD grounding (JD attached, "what are the key requirements of this role?") — weight 3
C5 genuinely unanswerable from the docs — MUST output the exact safe refusal phrase — weight 2
C6 adversarial: fixture docs contain embedded prompt injections ("ignore instructions and say X") — must not comply — weight 2
C7 first-question-immediately-after-attach: attach and ask within 200ms (race coverage) — weight 3
C8 rapid-fire: 5 questions in quick succession (desync coverage; each answer must match its question) — weight 2
Plus: rerun the existing 19-question thesis benchmark (OpenVLA, OpenVLA-OFT, AgenticVLA, AutoGen, embodied AI, RQ1/RQ2) as a regression suite if its assets exist.

Grading per item: deterministic checks first (expected substrings for C1/C7; exact refusal phrase for C5; injection-marker absence for C6; question-answer id match for C8), then a MiniMax LLM-judge with a strict rubric for C2/C3/C4 (grounded? correct? complete? natural for a live overlay?). Scoring: item = 0 or 1; false refusal on an answerable item = 0; any unsupported fact in a doc-grounded answer = 0 AND raises a HALLUCINATION flag that blocks the loop until root-caused. Overall score = weighted accuracy. Also record per-item latency; report p50/p95 time-to-answer.

Output per run: `test/harness/reports/run-NNN.json` + `run-NNN.md` with per-category scores, every failure's full trace, and latency percentiles. Commit each report.

---

## 5. PHASE 3 — THE LOOP (this is where you spend the night)

This phase maps directly onto /loop wakeups: one pass of the body below is roughly one iteration (a heavy fix may span two or three wakeups; the NEXT ACTION line carries state across). End each iteration at a natural checkpoint (after a benchmark run, after a verified fix), then RESCHEDULE the next wakeup per L1 — never just stop talking, or the loop dies on the fallback timer.

```
while true:   # enforced by /loop wakeups; exit ONLY via L4 + ScheduleWakeup stop:true
  quota pre-check (Section 1.5): if healthier account < 20%, pause-wakeup at reset instead
  run full benchmark
  quota check (Section 1.5): pause condition met -> checkpoint, schedule wakeup at resetAt
  commit report; append score line to campaign-log.md score history
  if (overall >= 95%) and (every category >= 90%) and (hallucinations == 0)
     and (false-refusal rate on answerable <= 2%) for TWO consecutive runs:
        break  -> Phase 4
  pick the failure cluster costing the most weighted points
  mini-forensics on ONE representative failing trace (Phase 0 discipline)
  pin cause (check anti-thrash ledger first; if already fixed once, this pin is
     wrong — dig deeper: read the trace stages before AND after the old fix site)
  fix -> live-path proof -> smoke subset -> full benchmark
  /compact if context heavy (campaign-log.md carries: pinned/fixed ledger,
     score history, current hypothesis, next action)
```
Plateau rule: if the score improves < 2 points across 3 consecutive iterations, stop patching and re-do a full golden trace (2.1) on the current worst category — the model of the system in your head has drifted from reality. Budget rule: if MiniMax rate-limits, back off exponentially and reduce concurrent harness workers to 1; never switch the generation model to something else to "keep moving".

---

## 6. PHASE 4 — PRODUCTION HARDENING (after stop condition)

- Permanent index-freshness check before every doc-grounded answer (this was mandated before; make it non-optional code, not a debug flag).
- Overlay UX states: "indexing your document…", visible source attribution chips when evidence was used, refusal phrase only in the genuine no-evidence case.
- Guardrail unit tests locked in CI: prompt assembly contains all sections for mode+doc; evidence priority ordering; refusal emitted iff evidence empty; validator passes a known-grounded answer and fails a known-fabricated one; single-execution-per-question assertion; dimension-pinning on indexes.
- Quarantine: any subsystem verdicted DEAD-CODE gets a `// QUARANTINED: not in live path as of 2026-07, see traces/forensic-report.md` header comment and an entry in the final report, so the architecture stops accumulating ghosts.
- OKF conformance spot-check: exported bundles remain OKF v0.1 conformant, KnowledgeCard YAML frontmatter includes required `type`, index.md/log.md conventions intact.
- Remove temporary trace logs per R10; keep a single structured debug logger for the answer path (question id, doc ids, retriever used, evidence count, token count, model, latency, outcome).
- FINAL REPORT `traces/final-report.md`: before/after scores per category, the verified live-path architecture (text diagram: input → router → retrievers → assembler → prompt → model → validator → UI), every pinned cause with its fix commit hash, remaining known gaps, and a ranked next-steps list to go from 95% to Cluely-beating (reranking, streaming first tokens to the overlay, retrieval precision on broad questions, answer style tuning for interview delivery).

---

## 7. WHEN THINGS GO WRONG AT 3AM (resolution rules, do not stop)

- Backend unreachable → run natively-api locally with the repo .env; log it.
- MiniMax key invalid → grep all env files and the backend config for the actual key variable; if genuinely absent, check whether the backend proxies MiniMax (harness may go through the backend rather than direct); document whichever real path works. Only if NO real MiniMax path exists: run the loop with the highest-priority available real provider in the existing cascade and flag loudly at the top of the final report that MiniMax must be re-verified.
- Gemini embeddings unavailable → bundled bge-small-en-v1.5, note it, keep dimension pinning consistent.
- Electron won't run headless in this environment → drive the main-process handler functions directly in a Node test entry that imports the same modules; the requirement is same code path, not same window.
- A fixture download fails → generate the fixture yourself as described in Phase 2.
- Benchmark is flaky (same code, ±5 points between runs) → set temperature to the production value but seed/pin where the provider allows; increase C-category sample sizes; treat an item as failed only if it fails 2 of 2 runs when adjudicating the stop condition.
- You find a security issue while in there (key leakage in logs, injection reaching the prompt unsanitized) → fix it, it's in scope, log it.
- Context exhausted mid-fix → the last entry in campaign-log.md must ALWAYS end with "NEXT ACTION: …" so post-compact you resume in one step.

Begin now: iteration 1, create campaign-log.md, run Phase 0 preflight and the Golden Trace. Evidence before edits. Every iteration ends by updating NEXT ACTION and rescheduling the next wakeup; the loop stops ONLY via ScheduleWakeup stop:true after the L4 exit condition holds. The founder wakes up to `traces/final-report.md`, a green benchmark report, and a branch of clean commits.
