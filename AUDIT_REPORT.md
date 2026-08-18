# Natively Full-App Audit — Autopilot Campaign

Started: 2026-08-14
Branch for fixes: `audit/autopilot-2026-08-14` (created lazily at first verified fix; working dir is shared with in-flight work on `fix/answer-policy-and-conversation-state`, 51 dirty files at campaign start — commits will be scoped to audit-touched files only)
Live LLM testing: DeepSeek `deepseek-chat` via `DEEPSEEK_API_KEY` in `.env` (verified present)


# ═══ CAMPAIGN SUMMARY (as of 2026-08-18) ═══

## Scope completed
All 7 phases EXPLORED. 40 findings triaged. **31 fixed and verified**, each with a
re-runnable repro under scripts/audit/ that fails before the fix and passes after,
plus a regression pin. Branch: `audit/autopilot-2026-08-18` in the isolated worktree
`/Users/evin/natively-audit-wt` (tag `audit-autopilot-phase1-2-final` marks the
Phase 1+2 line).

| Phase | Explored | Fixed | Notable |
|---|---|---|---|
| 1 Core runtime & IPC | ✅ | 18 | 2 P0 (quit zombie after destructive teardown; GPU restart killing the DB forever) |
| 2 STT pipeline | ✅ | 5 | P0 ws-CONNECTING crash class; stale-connection guards for 3 providers |
| 3 LLM routing & Answer Policy | ✅ | 3 | client gave up 3s before the server rotates; blank bubbles; cross-surface bubble corruption |
| 4 Knowledge/RAG/OKF | ✅ | 2 | **vec0 L2 read as cosine** (silent under-retrieval on every query); cross-meeting transcript leak |
| 5 Modes & Profile Intelligence | ✅ | 0 | 6 findings documented (Seminar strictness dead; mode pin missing) |
| 6 Backend & licensing | ✅ | 1 (client half) | 3 security-sensitive, REPORT-ONLY by design (production submodule) |
| 7 Settings/persistence/updater | ✅ | 2 | migration writing a global-MAX page count to every row + repair migration |

## The three findings I'd read first
1. **F-410 vec0 L2-as-cosine** — every RAG/meeting search silently under-retrieved. Measured: a chunk whose direction is IDENTICAL to the query (true cosine 1.0) scored 0.0 and was dropped. Ranking order was unaffected, which is why it never looked wrong. All existing tests forced the JS path, so the shipped native path was uncovered.
2. **F-701 v22 migration** — permanently wrote the table-wide MAX page count into every reference file on upgrade; not self-healing. Fixed, plus a v27 repair migration for installs already hit.
3. **F-602 rotating-key DoS bypass (backend, NOT fixed)** — a rotating fake key gets a fresh rate-limit AND DDoS bucket every request, each a guaranteed uncached DB query. Matches the documented outage trigger.

## Deliberately NOT fixed (with reasons)
- **All natively-api backend findings (F-602..F-606)** — a production submodule that deploys from main and is shared with another active agent. Auth/billing/rate-limit changes made unattended could lock out real users or open a hole. Documented with patch directions for owner review.
- **F-401 semantic admission gate** — its two tests have never passed since their introducing commit; fixing the flag-OFF contract on a guess would silently change retrieval admission for every mode. Needs the feature owner's intent.
- **F-206 OpenAI turn-coalescer ordering** — settling it needs a live OpenAI Realtime event capture; DeepSeek cannot stand in for another vendor's event stream, and a synthetic ordering would only re-assert the assumption under test.
- **F-114 dev-mode Windows zombie** — win32-only branch, not reproducible on this machine. Fix proposed for a Windows session.
- **Phase 5 findings (F-501..F-506)** — documented, not yet fixed; F-506 sits behind the premium symlink.

## Verification posture (honest)
- Every fix: macOS-verified via its own repro against the real code path or the repo's harnesses.
- Regression: full-suite failing test NAMES diffed against a committed pre-audit baseline (scripts/audit/BASELINE-failures.txt, 165 names) — **not** by assertion. This practice was adopted after it caught 5 failures my own Phase 1 refactor had introduced.
- Compile gate: `build:electron` (esbuild) + targeted suites. Full-project typecheck is NOT reproducible in the worktree (shared node_modules' TypeScript drifted past this branch's tsconfig); stated rather than glossed.
- Windows: reviewed but NOT executed. All fixes are platform-neutral orchestration/state changes; no Windows-only branch was modified.

## Two mistakes I made and caught
1. **Phase 1 close-out over-claimed.** It said all suite failures were pre-existing after spot-checking one. A real baseline proved my F-105 refactor broke 5 tests (stale source-assertion tests, not behavioural). Repaired; the baseline-diff practice now prevents a repeat.
2. **A build break I hid from myself.** SQL comments containing backticks terminated a JS template literal. I missed it because I ran the build with output redirected to /dev/null and then re-ran tests against a stale bundle. Fixed, all affected repros re-verified against a fresh build, and I stopped suppressing build output.

## For the branch owner — two decisions only you can make
1. **Forward-merge `main`.** This branch predates main's `21c4e22f`, which fixed the same ws crash class plus MeetingLifecycleQueue and FatalMainProcessCoordinator. My F-201 fix mitigates the crash locally but is not a substitute for that infrastructure.
2. **The `premium` submodule pointer in the MAIN checkout is rewound** to a strict ancestor (uncommitted). None of this campaign's 44 commits touch any submodule pin — verified — but that working-tree state can silently drop merged work if committed.

## Campaign status

| Phase | Area | Status |
|-------|------|--------|
| 1 | Core runtime & IPC (main/renderer/preload, windows, overlay, audio bridge) | COMPLETE — 18 fixes landed (see phase summary) |
| 2 | STT pipeline | pending |
| 3 | LLM routing & Answer Policy | pending |
| 4 | Knowledge / RAG / OKF | pending |
| 5 | Modes & Profile Intelligence | pending |
| 6 | Backend & licensing | pending |
| 7 | Settings, persistence, updater, packaging | pending |

## Architecture snapshot (from code-review-graph)

29 communities, dominant ones: `electron/services` (915 nodes), `electron` root (611 — main/windows/IPC), `src/components` (391), `electron/audio` (308), `electron/rag` (257), `native-module/src` (195, Rust audio bridge), `electron/llm` (192). No cross-community coupling warnings reported by the graph.

---

## CAMPAIGN-WIDE REGRESSION VERDICT (full suite, 2026-08-18)
Baseline (c2ad3133, throwaway worktree): 7312 tests / 7114 pass / 135 fail / 63 skipped — 165 unique failing names, pinned in scripts/audit/BASELINE-failures.txt.
Audit branch: 7368 tests / 7168 pass / 137 fail / 63 skipped — 167 unique failing names (test count is higher because the campaign ADDED 20 test files).
Name-level diff: **zero regressions attributable to this campaign.** The two names present in mine but absent from the baseline list belong to a test file that does not exist at c2ad3133 at all, so it could not have failed there — see F-401 below.

## F-401 [P2, PRE-EXISTING — found by the regression diff, not introduced here] Semantic admission gate ships with 2 tests that have never passed
Phase: 4 (retrieval) | Area: electron/llm/__tests__/SpaceAwareThresholds2026_08_13.test.mjs + the semantic admission gate it covers
Status: FOUND → CONFIRMED (born failing) → NOT FIXED (out of the audit's change scope; owner decision)
Evidence: the file was introduced by b1e16f59 ("feat(retrieval): Phases 1+3 — semantic admission gate + space-aware thresholds"). Running that exact commit in a clean worktree reproduces 5 pass / 2 fail — identical to the current result. The failures are `telemetry fires in OBSERVE mode (flag OFF) …` and `telemetry reflects enforcement when the gate is ON`, both asserting `flag OFF → observe mode` and getting `true !== false`.
Why it matters: the gate's own regression tests disagree with its behaviour on the OFF path, i.e. the flag-off (observe-only) contract is unverified in CI and may not hold — the exact "flag defaults" hazard this repo has been bitten by before. Two candidate readings (the flag resolution reads a persisted/test-polluted value, or the observe-mode branch genuinely enforces) need the feature owner to disambiguate intent before a fix is safe.
Deliberately NOT fixed by this campaign: changing an admission-gate flag contract on a guess could silently alter retrieval behaviour for every mode; and it is unrelated to any defect this campaign introduced.


# Phase 3 — LLM routing & Answer Policy (exploration complete 2026-08-18)

## F-301 [P1] Manual chat abandons the turn 3s BEFORE the server would rotate providers
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Repro: scripts/audit/F-301-repro.mjs reads AI_TTFT_BUDGET_MS straight out of natively-api/server.js (so the two cannot drift) and compares it against the deadline the manual-chat handler actually uses. PRE-FIX (baseline worktree): server route 7000 vs server budget 10000 → exit 1. POST-FIX: 13000 vs 10000, with direct-provider still 7000 and local still 30000 → exit 0.
Fix: new LLMHelper.isUsingNativelyServerCascade() (mirrors isUsingOllama/isUsingCodexCli) feeds a third `viaServerCascade` argument to firstUsefulDeadlineMs, which returns the EXISTING LIVE_TOTAL_HARD_TIMEOUT_MS (13000) on that route — reusing the constant that already documents this invariant rather than inventing a new number. Deliberately scoped: routes with no server cascade keep 7000/30000, since stretching them would only make users wait longer for a failure that has no rescue behind it.
Pin: electron/llm/__tests__/ManualChatOutlivesServerRotation2026_08_18.test.mjs (3/3 — ordering vs the real server constant, unchanged non-cascade budgets, and the call site actually passing the flag).
Regression check: LLM suite unchanged at 16 failures; the only names absent from the pinned baseline are the F-401 pair that have never passed → zero regressions.
Area: ipcHandlers.ts:3367 + liveDeadlines.ts:151-156 vs natively-api server.js:2142 (AI_TTFT_BUDGET_MS=10_000)
Status: FOUND. firstUsefulDeadlineMs() returns 7000 for every cloud answer type; the client aborts the HTTP request at 7s, while the server rotates to MiniMax-M3 at 10s and would have delivered. The constant that WAS raised to 13000 (LIVE_TOTAL_HARD_TIMEOUT_MS) is used only on the WTA path (IntelligenceEngine 2648/2671) — the manual-chat handler the ordering test's own rationale describes still uses 7000. Repair regens are 7000-8000, also below 10000. User sees "The model did not produce an answer in time…" on a RECOVERABLE turn. Unit-reproducible, no paid call.

## F-302 [P1] Manual-chat "useful" predicate is "any token arrived" → blank bubbles + degraded deadline
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Repro: scripts/audit/F-302-repro.mjs drives the REAL raceStreamWithDeadline with a generator that yields "\n\n" then hangs, and includes a CONTROL using the pre-fix wiring so it self-demonstrates. Measured — pre-fix: outcome 'stall_timeout' at 8003ms, useful=true, fallbackWouldFire=FALSE (empty bubble). Post-fix: 'first_useful_timeout' at 704ms, useful=false, fallbackWouldFire=TRUE.
Fix: the flag is now gated on accumulated trimmed content reaching 5 chars, matching every other call site in the repo.
Pin: electron/llm/__tests__/ManualChatUsefulRequiresContent2026_08_18.test.mjs (2/2 — source contract + a behavioural run through the real driver).
Regression check: LLM suite 3287 pass / 16 fail; the only two names absent from the pinned baseline are the F-401 pair, which have never passed since their own introducing commit → zero regressions.
Area: ipcHandlers.ts:3368/3384/3423
Status: FOUND. Every other call site uses a content threshold (>=5/8/10 chars); the PRIMARY manual-chat path sets manualFirstUseful on any token object, and raceStreamWithDeadline/streamChat never filter whitespace. Two consequences: (a) a "\n\n" first chunk flips the budget from the 7s first-useful to the 8s stall guard; (b) the blank-answer fallback at :3423 requires !manualFirstUseful && !fullResponse.trim(), so a whitespace-only answer skips it and commits an EMPTY bubble — violating the comment 3 lines above ("a live answer is NEVER blank when a safe fallback exists"). Unit-reproducible.

## F-303 [P1] Renderer stream guard supersedes ACROSS surfaces (phone ↔ desktop)
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Repro: scripts/audit/F-303-repro.mjs drives the real guard through the exact interleaving. PRE-FIX (baseline): the phone's done finalized the desktop bubble and the desktop stream could then NOT finalize its own row → exit 1. POST-FIX: the phone token is dropped, desktop tokens keep rendering, the phone done is ignored, the desktop done finalizes, and same-surface supersession still works → exit 0.
Fix: supersession is now SURFACE-SCOPED. The guard takes activeSource/incomingSource (absent → legacy 'desktop', so every existing caller is unchanged) and refuses to let a stream from a different surface adopt or finalize the active bubble. The four phone-path sends in ipcHandlers now tag `source:'phone'`; the renderer tracks the owning surface in a ref alongside the id; the .d.mts declaration was widened to match.
Verification: lib suite 325/325 (the pre-existing guard tests use the 2-arg form and still pass, confirming back-compat); renderer `tsc` shows no errors in the touched files (remaining errors are the pre-existing @types/environment drift); `vite build` and `build:electron` both clean.
Residual: end-to-end confirmation needs a real phone-mirror session on a device — NOT performed. The defect and fix are fully exercised at the guard boundary, which is where the corruption originated.
Area: ipcHandlers.ts:969 & :12504 (one shared ++_chatStreamId) vs src/lib/chatStreamGuard.mjs:30-70
Status: FOUND. Main process comments claim cross-surface false supersession "can't happen"; the renderer guard is strictly newest-numeric-id-wins over a counter BOTH surfaces allocate from. A phone chat started during a live desktop stream adopts the phone id, appends phone text into the desktop bubble, then drops every remaining desktop token; the phone's done (no finalText) finalizes the mixed row, and the desktop's later done is ALSO honored (double finalize). Unit-reproducible in 2 calls.

## F-304 [P2] TurnPlanner regex fallback diverges from AnswerPlanner (JD route hijacks coding/doc)
Area: TurnPlanner.ts:260-285 vs AnswerPlanner.ts:1374/1394/1438
Status: FOUND. TurnPlanner's fallback lacks AnswerPlanner's two gates (coding-verb veto, JD-framing requirement) and evaluates the JD cue FIRST, so "Write a function that returns the required buffer size" routes jd_question — probing profile_jd/profile_resume, never reference_files, and switching on seedCandidateBackground. Same class as the documented technical_concept_answer defect, left open on the text-fallback branch. Unit-reproducible in 1 call.

## F-305 [P2] Meta-retry accepts a hard-truncated regen as the FINAL answer
Area: ipcHandlers.ts:3506-3517 vs the sibling regen at :3597
Status: FOUND. shouldAbort cuts at 4000 chars though the repo sizes this exact six-section artifact at ~8000 (liveDeadlines.ts:130-131); acceptance only needs length>=20 + any closed code fence, so a mid-sentence truncation is accepted and atomically REPLACES the streamed row. The sibling regen 80 lines below uses checkCodeCompleteness — the safe pattern exists in the same function. Unit-reproducible with a fake stream.

## F-306 [P2] ProviderRouter circuit breakers are dead code
Area: ProviderRouter.ts:384-607; only refs are LLMHelper.ts:47/428/853
Status: FOUND. selectProvider/recordSuccess/recordFailure/getProviderHealth have zero production call sites, so there is NO provider-level health tracking in the live cascade; the only real breaker (rateLimitCircuit) is per-model and trips only on consecutive 429s — never on 5xx/timeouts/deadline aborts. A provider that is timing out is retried every turn. Tests exercise the class directly, which is why the dead code passes CI. Static.

Phase 3 coverage gaps (not audited): AnswerValidator/WhatToAnswerLLM internals, codeVerification/**, conversation state (SessionMemory, FollowUpResolver, referent resolution) ENTIRELY uncovered, V3 prompt assembly beyond [[GIST]], composer-absence/refusal branches, vision cascade.

# Phase 6 — Backend & licensing (exploration complete 2026-08-18)

## ⚠ SCOPE DECISION: backend findings are REPORT-ONLY (no autonomous commits)
F-601..F-606 live in the `natively-api` SUBMODULE — a separate repo that deploys to PRODUCTION (Railway deploys main), shared with the other active agent, and governing auth, billing and trials. Changing rate-limiting/trial/webhook logic there unattended could lock out real users or open a hole; per the campaign's own "outward-facing actions" constraint these are documented with precise patches and left for owner review. The CLIENT half of F-601, which lives in THIS repo, is fixed below.

## F-601 [P1, SECURITY] Trial 'unavailable' HWID sentinel shares ONE trial row across machines
Client: electron/ipcHandlers.ts:6762-6774 (THIS repo) · Server: natively-api server.js:5444-5477 · Schema: free_trials.hwid text NOT NULL UNIQUE
Status: FOUND → CONFIRMED (client half read verbatim) → CLIENT HALF FIXED-VERIFIED (see below); server half report-only.
Mechanism: LicenseManager.getHardwareId() returns the literal 'unavailable' when the native module fails to load (its JSDoc scopes that value to support display). The client sent it as the trial-binding identity; it is 11 chars so it passes the server's 4..256 validation; free_trials.hwid is UNIQUE, so exactly one row holds it and the server's idempotent re-issue branch mints a valid signed trial token for THAT STRANGER'S ROW — disclosing their usage counters via /v1/trial/status and billing every request against their quota. First machine to arrive owns the row forever (no purge).
Client fix (this repo): fail closed — refuse to start a trial when no real hardware id is available, returning `hardware_id_unavailable` instead of sending a sentinel.
Server-side patch for owner review: reject sentinel/non-identity hwids at /v1/trial/start (allow-list a format, or explicitly deny 'unavailable' and short/low-entropy values).

## F-602 [P1, SECURITY] Rotating a fake key bypasses BOTH the rate limiter and the DDoS guard
natively-api server.js:455-458, 1907-1952, 2912-2959
Status: FOUND — report-only. The limiter buckets on the CLAIMED x-natively-key (hashIdentity of any string), and checkDDoS records into the identity bucket while only READING the IP bucket. A caller rotating a well-formed nonexistent key per request gets a fresh bucket every time and never increments the shared IP bucket. Each such request is a guaranteed cache miss that issues a PostgREST query against api_keys and returns BEFORE keyCache.set, and the breaker records success on a genuine miss so it never sheds. One unauthenticated request = one DB query, unbounded — the documented outage trigger. Existing regression test pins only the SINGLE-key case, which is why it survived.
Patch direction for owner: bucket unauthenticated/unvalidated callers by IP (only use the identity bucket AFTER validateKey succeeds), and cache negative lookups.

## F-603 [P1] Subscription revocation fails OPEN on a DB error
natively-api server.js:11468-11535, 11035, 11052 (contrast the correct cancel branches at :11442/:11459)
Status: FOUND — report-only. The webhook route 200s to Dodo BEFORE dispatch and retries only on a THROW; the expired/on_hold/failed revocation branches discard the supabase error object entirely, while the grant paths in the same file check theirs. One transient Supabase error during subscription.expired = permanent free service. No reconciliation: sub_period_end has writers but NO readers repo-wide, and sweep_expired_subscriptions() exists only in an incident write-up.
Patch direction: check-and-throw in every revocation branch (matching the cancel branches), plus a period-end sweep.

## F-604 [P2] /v1/trial/status bypasses the resilient auth path
server.js:5569-5584 vs the full policy at :2439-2470. No deadline, no breaker, no stale-serve; a Supabase stall renders as 404 trial_not_found and the client polls it every 30s (src/App.tsx:601), piling unbounded queries onto a stalled dependency where the breaker cannot see them. Client tolerates the 404 (no user-visible breakage) → P2. Report-only.

## F-605 [P2] Trial per-IP cap is LIFETIME, not windowed (CGNAT lockout)
server.js:5485-5503 counts all free_trials rows ever for an ip_hash with no time predicate and nothing purges the table, so a university/office/carrier NAT permanently exhausts its 5 slots. TRIAL_MAX_PER_IP doubles as an hourly attempt cap and this lifetime cap — one knob, two semantics. Also the attempt counter increments BEFORE the idempotent re-issue branch, so a client re-fetching its own trial burns its own budget. Report-only (window length is a product decision).

## F-606 [P3] Unauthenticated review routes leak raw Supabase error messages
natively-api/reviews.js — handlers forward `error.message` verbatim on two unauthenticated routes, bypassing the global opaque-error handler. Report-only.

Phase 6 verified-clean (explicit): calendar routes authed + redirect allow-list; Dodo signature verification fails closed with timing-safe compare and a ±300s window; Resend dedupe:false is idempotent by construction; telegram webhook; checkAdminSecret covers every admin route; no raw key/token logging; trial token HMAC with length-checked compare; LOCAL_TEST_AUTH triple-gated; trustProxy not a hop count. Notably: a DB outage does NOT become "your key is invalid" on the key path (only on /v1/trial/status — F-604).
Phase 6 coverage gaps: the ~3,100-line /v1/transcribe WS handler, /v1/chat|embed|search internals, relay token signing, usage-ledger flush paths, RLS posture (no CREATE POLICY in repo; API uses the service key), and index coverage (schema dump has zero CREATE INDEX).


# Phase 4 — Knowledge / RAG / OKF (exploration complete 2026-08-18)
(Numbered F-41x to avoid colliding with F-401, the pre-existing gate-test finding.)

## F-410 [P1] vec0 returns L2 distance; the code reads it as COSINE → silent under-retrieval on every query
Area: VectorStore.ts:243/:507 (`similarity = 1 - vecRow.distance`) · DatabaseManager.ts:2148-2159 (vec0 DDL with NO distance_metric)
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Repro: scripts/audit/F-410-repro.cjs — reads the REAL DDL out of DatabaseManager.ts (so it tracks the fix, not a copy) and compares `1 - distance` against true cosine. PRE-FIX (baseline worktree): a chunk whose direction is IDENTICAL to the query (true cosine 1.0000) scored 0.0000 and was DROPPED at the 0.25 floor; a 0.7071 match scored 0.2346 and was also dropped → exit 1. POST-FIX: all four vectors match true cosine exactly and retention agrees → exit 0.
Fix: vec0 tables are now declared `distance_metric=cosine` (sqlite-vec 0.1.9 supports it — verified), so `1 - distance` IS the cosine similarity every consumer already assumes. vec0 virtual tables cannot be ALTERed, so migration v27→v28 drops and recreates them and backfills from the embedding BLOBs still held in chunks/chunk_summaries, advancing user_version only on success.
Regression check: RAG suite 256/260, all 7 failing names present in the pinned baseline → zero new.
Mechanism: sqlite-vec 0.1.9 defaults to L2, so `distance` is Euclidean. `1 - L2` is labelled `similarity` and thresholded by consumers that assume cosine in [-1,1]: minSimilarity 0.25 (VectorStore), MEETING_MIN_SIMILARITY 0.3, MEETING_RAG_MIN_SIMILARITY. For unit vectors L2 = sqrt(2-2cos), so t=0.25 really demands cos>=0.719 and t=0.3 demands cos>=0.755. The JS fallback computes TRUE cosine and applies the same t, so the two paths disagree hugely on identical data.
Measured (worktree artifacts, offline): distance matches sqrt(2-2cos) to 4dp and equals vec_distance_l2, not vec_distance_cosine. A chunk at true cosine 0.7071 scores 0.2346 natively and is DROPPED at 0.25, while the JS path keeps it.
Why it survived: L2 is monotonic in cosine for normalized vectors, so RANKING is unchanged — the failure is silent under-retrieval with no wrong-looking output and no log. Every existing test forces useNativeVec=false (ReindexPredicateDriftProof:89, SearchSpaceFilter:194, RequeueReindexAtomicity:11) — the tested path is not the shipped path (migrations v8/v9 always create vec_chunks_768, so production runs native).

## F-411 [P1] 'live-meeting-current' chunks leak ACROSS meetings (cross-meeting transcript disclosure)
Status: FOUND → CONFIRMED → ROOT-CAUSED → FIXED-VERIFIED
Fix: startLiveIndexing now purges the constant live id (deleteMeetingData) BEFORE recreating the meeting row and starting the indexer — the one point every path into a new live session passes through, so it covers the crash, force-quit AND overlapped-drain cases that the end-of-meeting cleanup misses. Wrapped in try/catch so a cleanup failure can never stop a meeting starting. Safe because JIT rows are always disposable (post-meeting RAG re-indexes under the real meeting id).
Pin: electron/rag/__tests__/LiveIndexPurgesStaleSession2026_08_18.test.mjs (2/2 — purge precedes both the row insert and indexer start; purge is fault-tolerant).
Regression check: RAG + services suites, 123 unique failing names ALL present in the pinned baseline → zero new.

## ⚠ SELF-CAUGHT DEFECT IN MY OWN FIX (2026-08-18) — build break masked by suppressed output
While fixing F-701 I wrote SQL comments containing BACKTICKS inside a JS template literal, which terminated the string and broke `build:electron`. I did not notice immediately because I had run the build as `npm run build:electron >/dev/null 2>&1 && <tests>` — the redirect hid the error, and when the `&&` short-circuited I re-ran the tests WITHOUT a build, so they passed against a STALE bundle. The F-701/F-702/F-410 repros also kept passing because they read the .ts source and slice the SQL out of it, so they validated SQL semantics but never compilation.
Caught by the next build, fixed by removing every backtick from those comments, and ALL THREE repros plus the suites were then re-verified against a freshly-built bundle.
Process fixes adopted for the rest of the campaign: (1) NEVER suppress build output — a hidden build failure invalidates every test run after it; (2) a repro that reads source text is not a compile gate, so `build:electron` must be green in the same command whose output I actually read.
Area: main.ts:5697 (constant id for every meeting) · cleanup only at :5966-5976, guarded by !isMeetingActive · no startup sweep · chunks has no UNIQUE(meeting_id, chunk_index)
Status: FOUND. After a crash/force-quit the JIT rows survive; the next meeting appends to the same id, and the live "ask about this meeting" surface (ipcHandlers.ts:10141/10164) filters only on meeting_id — so meeting A's transcript is served as evidence for meeting B. The authors anticipated the overlap case and chose to SKIP deletion ("New meeting started during cleanup — skipping…"), leaving the same state.

## F-412 [P1] False-refusal repair bypasses its own off-topic gate via the tier disjunct
Area: ipcHandlers.ts:4374 (`|| isTier1Or2Evidence`) vs the gate at :4360-4371 and the claim at :4390-4392 · EvidenceAssembler.ts:53-56 (topic-blind tier 2) · OkfRetriever.ts:95-104 (boosts with no overlap precondition)
Status: FOUND (explorer executed an empirical proof: an off-topic "Kyoto Protocol" question against a robotics pack yields hasEntityEvidence:false but isTier1Or2Evidence:true → shouldRepair:true). An honest "not in the document" refusal is discarded and the model is re-prompted with a stronger-synthesis instruction — the exact hallucination pressure the gate exists to prevent. Flag defaults put this in dev/test/benchmark, not packaged production.

## F-413 [P2] OKF confidence boost (0.15) exceeds minScore (0.12) → tier 4 unreachable at the repair gate
Area: OkfRetriever.ts:31/:132/:104 · OkfCardBuilder.ts:22-30 (nearly everything is 'high') · EvidenceAssembler.ts:52-54 · call site ipcHandlers.ts:4219 passes rawChunkText:''
Status: FOUND. A high-confidence card clears the floor on its boost ALONE with zero overlap, so the hard-refusal tier can never fire at that call site. Feeds F-412.

## F-414 [P2] LiveRAGIndexer "final flush" is a no-op when a tick is in flight → dropped transcript tail
Area: LiveRAGIndexer.ts:176 vs the isProcessing guard at :84; stop() then zeroes allSegments/indexedSegmentCount at :179-182
Status: FOUND. The in-flight window is up to ~90s (ForegroundGate.waitUntilIdle 30s + embed 30s primary + 30s fallback), so "ask a question, then stop the meeting" routinely drops every segment since the tick's slice point. MIN_NEW_SEGMENTS=3 also applies to the final flush, so a meeting ending with 1-2 segments always loses them. The resumed tick can then leave hasIndexedChunks() true on a stopped indexer.

## F-415 [P2] Live indexer cannot re-stamp embedding_space after a mid-meeting provider fallback
Area: LiveRAGIndexer.ts:141 → VectorStore.stampMeetingSpaceIfUnset (WHERE embedding_space IS NULL) · EmbeddingPipeline.promoteFallbackProvider
Status: FOUND. The in-file comment's guarantee holds within a batch but not across ticks: after a promotion the meeting still claims the old space while later chunks are in the new one, and the query-time space filter then excludes the meeting entirely — zero live RAG results exactly when the cloud provider is down. The queue path handles this correctly (activateMeetingFallback → clearEmbeddingsForMeeting); the live path has no equivalent. Bounded to the session (REINDEX_PREDICATE re-embeds next launch) → P2.

Phase 4 coverage gaps: PDF/doc extraction + page counting (DocumentMap/FrontMatterExtractor unopened; noted-but-unverified: extractConceptCards records only [pageStart,pageEnd], dropping interior pages), graph layer, LocalReranker worker lifecycle, Context-OS governed path, profile-OKF surface. Verified clean: deleteKnowledgeSource cascade covers all six child tables; knowledge_index_versions pack_id nullable; SemanticChunker overlap.
All Phase 4 findings are reproducible fully OFFLINE — no paid or DeepSeek call needed.


# Phase 5 — Modes & Profile Intelligence (exploration complete 2026-08-18)
Coverage caveat: premium/ and natively-api/ are symlinks into the OTHER checkout, so extraction/orchestrator internals were not inside the isolated worktree; only F-506 touches premium and it is deliberately demoted.

## F-501 [P1] Seminar Mode's entire strictness contract is unreachable (two independent dead links)
Link A: ModeSourceContract has no `templateType` field (modeSourceContract.ts:69-139) yet IntelligenceEngine.ts:965 reads `rawSnapshotSourceContract.templateType` → always undefined, so TurnPlanner.ts:342's seminar check can never be true and groundingProfileFor falls to DEFAULT. No writer ever persists `groundingProfile` either (defaultSourceContractForNewMode / buildUserSelectedSourceContract / every migrate branch omit it; 0 hits in renderer).
Link B: the badge path's planTurn call (IntelligenceEngine.ts:1914-1922) passes NO sourceContract at all, and SourceBadge.ts:104-112's seminar branch additionally requires !evidenceFound while the caller hardcodes evidenceFound:true.
Net: Seminar routes correctly (MODE_CONTEXT_PROFILES → lecture_answer still works) but is NOT strict — no evidence requirement, no "Not in your reference files" preamble. Pure-function repro, no API key.

## F-502 [P1] Manual and phone chat never pin the mode; phone chat also escapes the abort
streamContextPolicy.ts:51-60 documents pinnedModeId as the defence against a mid-request `modes:set-active` leaking another mode's documents. The ONLY producers are WhatToAnswerLLM.ts:781/785 (live path). Desktop manual chat (ipcHandlers.ts:3204-3259) and phone-mirror chat (:12585-12588) both omit it, so every mode read inside streamChat after an await resolves the LIVE active mode (LLMHelper.ts:5417/5428/5475/5628/5682/5874/5890/6069) — :5475 being the doc-grounded hybrid retrieval the comment names as the leak vector.
Asymmetry that makes it P1: modes:set-active aborts desktop streams via _chatStreamsBySender, but the phone stream never registers there (only ipcHandlers.ts:975 does), so the phone surface has NEITHER the pin NOR the abort — phoneDocGrounded is captured pre-switch while retrieval runs post-switch. Static evidence; no paid key needed.

## F-503 [P2] Summary regeneration resolves the mode by templateType, not the persisted id
MeetingPersistence.ts:417-420 persists selectedModeId/Name/TemplateType, but the regenerate path (:888-891) ignores selectedModeId and does `getModes().find(m => m.templateType === templateType)` — getModes() is ORDER BY created_at ASC, so it returns the OLDEST row with that template. Every custom mode is templateType 'general' and the built-in General is seeded first, so regenerating a meeting run under a custom mode silently uses another mode's note sections AND rewrites modeMeta with the wrong identity. Triggers once any custom mode exists.

## F-504 [P3] Unguarded _c3TurnPlan deref defeats its own null guard
IntelligenceEngine.ts:1933 dereferences `_c3TurnPlan.answerDirectives` unguarded (every other use is optional-chained), and the const is never read — dead code. If the TurnPlanner dynamic import fails, this throws inside the fallback and the outer catch discards the whole JIT profile-evidence block, leaving candidateProfile empty: the defensive fallback destroys the grounding it exists to protect.

## F-505 [P3] 'seminar' missing from two mode-prior normalizers
ProfileIntelligenceRouter.ts:85-87 and ContextRouter.ts:117-119 still carry the pre-Campaign-3 7-member template list, so toActiveModeInfo returns null for seminar and planAnswer runs mode-blind. Shadow-only today (contextRouterV2 feeds a telemetry divergence marker), hence P3.

## F-506 [P3] Profile grounding gate classifies with a hardcoded source:'manual_input'
premium KnowledgeOrchestrator.ts:1955 classifies live-transcript questions as manual input, which changes the fallthrough floor (unknown_answer → no forbidden layers, vs general_meeting_answer → resume/jd/negotiation forbidden) and stamps factualRecall. No reachable leak constructed (the upstream wtaDecisionAllowsCandidateProfile gate blocks reference-files authorities), so filed as a classification mismatch, not demonstrated contamination. In premium/ — verify before acting.

Phase 5 explicitly disproved (do not re-litigate): MODE_TEMPLATES does contain 'seminar'; grounding-profile constants are never mutated (spread copies); ModeContextRetriever/ModeHybridRetriever caches are all mode- or file-keyed; ACTIVE_MODE_CACHE is invalidated at all six write choke points; NATIVELY_SEMINAR_MODE has no non-test setter; isProfileGroundingV2Enabled is live.
Phase 5 not covered: ModeReferenceFileIngestion, ModeGenerator, ~95% of ModeContextRetriever, OKF per-mode isolation, Pro gating beyond modes:set-active (note: it gates on templateType !== 'general', so every user-built custom mode is free-tier activatable — untraced).


# Phase 7 — Settings / Persistence / Updater / Packaging (exploration complete 2026-08-18)

## F-701 [P1] Migration v21→v22 writes a GLOBAL MAX page_count to every reference file (permanent, upgrade-only corruption)
Area: DatabaseManager.ts:1153-1208
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Repro: scripts/audit/F-701-repro.cjs — EXTRACTS the phase-1 SQL literal straight out of DatabaseManager.ts and runs it against a two-document fixture on the real better-sqlite3 build. PRE-FIX: small-3page reports 6 pages (exit 1).
Fix (two parts): (1) the seed's inner `FROM mode_reference_files` is removed, so `content` binds to the row being updated — a seed with no FROM is a single-row correlated SELECT, which is what the migration always intended; (2) NEW migration v26→v27 REPAIRS installs that already ran the broken v22, re-deriving page_count from the [Page N] markers (ground truth) unconditionally over marker-bearing rows — deliberately NOT gated on IS NULL, because the corrupt values are non-NULL — and it advances user_version only on success so a failure retries next launch.
E2E verification: F-701 repro → exit 0 (3 and 6 derived correctly). scripts/audit/F-702-repro.cjs simulates an already-damaged install, runs the real v27 SQL, and asserts repair + idempotence → exit 0. RAG/DB suites: all 7 failing names match the pinned baseline exactly (zero new).
Mechanism: the recursive CTE seeds `WHERE mode_reference_files.id = mode_reference_files.id`, which binds to the INNER FROM instance — a tautology — so the subquery is UNCORRELATED and `MAX(page_num)` is the max across ALL rows. Every marker-bearing row gets that one value. Measured: a 3-page document reports 6 pages when a 6-page document exists. Not self-healing (the `page_count IS NULL` predicate is false on re-run), so the wrong value is permanent. Consumed by ModeContextRetriever.ts:615-659, inflating referenceFilePageCount by (n_files × max − true_total). Fresh profiles are unaffected (empty table) — this is upgrade-only.

## F-702 [P2] The same migration never backfills extracted_page_count despite its own title
Status: FOUND → REPRODUCED → FIXED-VERIFIED (fixed together with F-701; the v27 repair fills extracted_page_count from page_count, mirroring the ingestion path which writes both together). Verified by scripts/audit/F-702-repro.cjs.
Phase 1 sets only page_count; Phase 2 sets both but is gated on `page_count IS NULL`, which Phase 1 just falsified for exactly those rows. extracted_page_count stays NULL forever, so ModeContextRetriever's fallback makes ingested-pages == total-pages and the extraction-coverage signal is silently unavailable for all pre-v22 documents. No later migration (v23-v26) backfills it.

## F-703 [P2] A corrupt settings.json is silently replaced with a one-key file on the next set()
SettingsManager.ts:375-378 catches a parse failure with `this.settings = {}` and no degraded flag; the next set() serializes `{}`+1 key over settings.json, destroying ~60 keys. The same codebase treats this exact risk as unacceptable for credentials — CredentialsManager sets keyringUnreadable and REFUSES every write for the session (:1088-1097) with a pre-mutation guard (:1117-1126). SettingsManager has neither. Reachable from ~15 IPC handlers, so it fires on the first toggle.

## F-704 [P2] The credential fallback is NOT machine-bound, contradicting three explicit code claims
credentialFallbackCrypto.ts:17-18 and CredentialsManager.ts:1044-1047/:1275 all assert machine/install binding, but getFallbackKey builds materialParts from a CONSTANT string (no os.userInfo, no MachineGuid) and the salt lives in the SAME userData directory as the ciphertext. Any whole-profile copy (Time Machine restore, Migration Assistant, synced AppData, support bundle) re-derives the key identically. Secondary consequence beyond docs: the stale-fallback logic at :1297-1309 depends on that claim, so on a restored profile decryption SUCCEEDS and the mtime guard DELETES the current keyring file, silently reverting the user to older credentials with no error.

## F-705 [P2] vec0 orphans survive meeting delete (virtual tables get no FK cascade)
deleteMeeting (:2634-2647) and clearAllData (:2686-2706) rely purely on ON DELETE CASCADE, which cannot reach `USING vec0` virtual tables; VectorStore's own delete paths DO issue explicit DELETEs (:321/:641/:689), so the maintainers know. Orphaned vectors consume top-K slots (searchSimilarNative drops unresolvable ids at :242), degrading recall monotonically with every deleted meeting. Downgraded from P1 because fetchLimit = limit*4 gives a 4× buffer.

## F-706 [P2] Windows microphone permission is hardcoded 'granted'
ipcHandlers.ts:11284-11286 returns granted for non-darwin, but Electron's own typings document getMediaAccessStatus('microphone') as @platform win32,darwin. With the Windows privacy toggle off, onboarding never prompts and mic capture yields silence with no diagnosable cause. The macOS branch directly above does a full status query plus a capture probe — a missing platform branch, not a platform limitation. (screen:'granted' on Windows is legitimate.)

## F-707 [P3] Setting autoUpdater.channel silently enables downgrades
electron-updater's channel setter ends with `this.allowDowngrade = true` (verified in the installed 6.x copy), so main.ts:2643 disables exactly the library filter the comment at :2651-2655 says it is belt-and-bracing. No user-visible failure today because AppState.isRealUpgrade catches every downgrade — but that hand-rolled gate is now load-bearing. One-line fix: set allowDowngrade=false after :2643.

## F-708 [P3] isRealUpgrade blocks the legitimate prerelease→stable upgrade
stripPre is applied to BOTH operands, so isRealUpgrade('2.1.0-beta.2','2.1.0') compares equal → false, and a beta user is told "update not available" until the next minor. Prereleases have shipped (tags v2.1.0-beta.1/.2) and generateUpdatesFilesForAllChannels is on.

## F-709 [P3] will-quit clobbers the specific quit reason
lifecycleTracker.ts:110-112 records 'user-quit' with no guard, nine lines above the before-quit handler that deliberately preserves a more specific reason; will-quit fires last, so 'updater-quit-install' and its version metadata are always lost. Diagnostics only (fatal paths use app.exit and skip will-quit).

## F-710 [P3] The unsigned-macOS updater fallback ignores the public path it captured
main.ts:2723 stores info.filePath specifically to avoid private APIs, and :2893-2899 then reads only two undocumented electron-updater internals. The stored value is never read anywhere.

Phase 7 verified clean (negatives worth trusting the report by): settings/credentials writes are tmp+rename atomic (no fsync, but no partial-write corruption); single-process only, so no cross-window write race; asarUnpack covers all five Worker targets and every asar→unpacked rewrite site; the WAL self-heal's broad SQLITE_BUSY trigger is not exploitable behind the single-instance lock; chunk_id reuse refuted (AUTOINCREMENT); crash-path vs clean-path DB close are consistent. A dev-only manual-update-check UI hang was found and deliberately NOT filed (development-only).
Phase 7 gaps: fresh-profile boot end-to-end, first-run permission ORDERING, entitlements/notarize hooks, NSIS behaviour, and migrations v1→v20 + v23→v26 read at header level only (an F-701-class defect could hide in a skimmed block).

# Phase 2 — STT pipeline (exploration complete 2026-08-14; findings in severity order)

## ⚠ WORKSPACE ADVISORY (2026-08-18 04:50) — campaign moved to an isolated worktree
Mid-campaign, a SECOND agent was found actively working in /Users/evin/natively-cluely-ai-assistant (commit 93s old at detection), and it had advanced the `audit/autopilot-2026-08-14` pointer onto its own work (building on top of my commits — my line is intact and is an ancestor of theirs). Continuing in that shared checkout would have meant our `npm run build:electron` runs clobbering each other's `dist-electron/`, making every overnight verification untrustworthy, and my app-launch repros racing their edits.
Actions taken (non-destructive, nothing of theirs touched):
- Tagged my verified Phase 1+2 line as `audit-autopilot-phase1-2-final` (918de598) so it can never be lost.
- Created an isolated worktree `/Users/evin/natively-audit-wt` on branch `audit/autopilot-2026-08-18` from that tag; symlinked node_modules, .env, native-module binaries, and the premium/natively-api submodules (read-only for this audit).
- Verified in isolation: build:electron clean, F-112 repro PASSES → the worktree is a faithful environment.
All Phase 2+ work continues in the worktree. The other agent's branch, index, and working tree are untouched. Phase 1 commits (a9d7ea42…88793025) and F-201 (918de598) remain reachable from BOTH lines.
Note (from an independent code review that ran against the shared checkout): the `premium` submodule pointer there is REWOUND to a strict ancestor (ae7b4ba0 → e5e400d8) and `natively-api` is bumped — both uncommitted. Verified NONE of my 20 audit commits contain a submodule pointer change (scoped `--only` pathspecs throughout). Flagging for the branch owner; the audit does not touch submodule pins.

## RUN-CONTINUITY NOTE (2026-08-18, unattended run)
The machine slept mid-run and killed two in-flight exploration agents (Phases 3 and 7). Mitigation: `caffeinate -dimsu -t 28800` now holds the machine awake for the remainder of the session (non-destructive, self-expiring after 8h, no config changed). Both explorations were re-launched. Phases 3-7 explorations run against the isolated worktree only.
Authoritative regression baselines for the remaining phases are being captured by running the FULL suite at the pre-audit commit in /tmp/natively-baseline-wt; every phase close-out diffs failing test NAMES against it rather than asserting.

## ⚠ MERGE ADVISORY (F-202) — read before shipping this branch
This branch (forked at c2ad3133) does NOT contain main's commit 21c4e22f ("fix(lifecycle): stop rapid meeting start/stop from silently killing the database"): the NativelyProSTT selective-listener-removal fix, its 285-line regression test (NativelyProSTTConnectingCancellation2026_08_07.test.mjs), MeetingLifecycleQueue, and FatalMainProcessCoordinator (incl. terminateAfterFatalError) all exist only on main. Merging/shipping this branch without a forward-merge of main resurrects a found-fixed-and-tested P0 in its WORSE form (no terminate → app runs on with a dead SQLite handle). The audit does not perform that merge (integration decision for the branch owner, conflicts with in-flight work); F-201's fix below patches the vulnerable sites minimally on this branch, but the merge is still required for the coordinator/queue infrastructure.

## F-201 [P0] removeAllListeners() before close() on a CONNECTING ws → uncaughtException → irreversible DB shutdown
Phase: 2 | Area: OpenAIStreamingSTT / ElevenLabsStreamingSTT / NativelyProSTT
Status: FOUND
Hypothesis (explorer, ws-level emit empirically demonstrated): ws@8.21.0 close() on CONNECTING routes to abortHandshake → unconditional nextTick emit('error'); four sites strip ALL listeners then close: OpenAIStreamingSTT.ts:400-409 (10s connection timer — GUARANTEED CONNECTING since dnsHelpers caps handshake at 15s), :766-767 (_closeWs, reachable from setRecognitionLanguage/setApiKey/stop mid-handshake), ElevenLabsStreamingSTT.ts:97-101 (stop; setRecognitionLanguage does stop+start), NativelyProSTT.ts:1036-1048 (closeUpstream — HEAD-only, main has 21c4e22f). Listener-less 'error' → process uncaughtException → main.ts emergencyCloseDatabase (no reopen; on this branch the handler falls through and the process KEEPS RUNNING → silent permanent persistence loss).
Trigger: OpenAI STT + any 10s handshake stall (captive portal/proxy/TLS interception); ElevenLabs/NativelyPro: stop or language change within the handshake window.
Disproof: an 'error' listener surviving at close() time; readyState never CONNECTING at those lines; uncaughtException handler no longer closing the DB.
Confidence: high.
Status update: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Step 1 (own re-read): all five sites confirmed (incl. OpenAI's post-open 5s session timer — OPEN-state strip-then-close still leaks close-handshake socket errors); this branch's uncaughtException handler (main.ts:170-224) closes the DB at :179 and RETURNS for non-arch errors — process keeps running with dead persistence. NativelyProSTT's try/catch around close() does not help: the emit is async (nextTick), not thrown.
Repro: scripts/audit/F-201-repro.mjs — real OpenAIStreamingSTT from the dist bundle; esbuild INLINES ws so the hook intercepts the builtin `https` (which the inlined ws uses for its handshake) and redirects to a local TCP server that never sends a ServerHello → genuine CONNECTING stall → the provider's own 10s timer fires. PRE-FIX: 2 uncaughtExceptions ("WebSocket was closed before the connection was established" — timer path + stop-path) → exit 1. (First harness attempt connected to the REAL OpenAI API with a fake key — auth-failed harmlessly; documented so nobody repeats it.)
Root cause: strip-then-close with no error sink across the async abort emit, at five sites.
Fix: new electron/audio/wsSafeTeardown.ts `safeDetachAndClose()` (strip → attach no-op error sink → close, each guarded) applied at all five sites; NativelyProSTT site carries an explicit note deferring to main's fuller 21c4e22f teardown at merge time.
E2E verification: repro → exit 0 (0 uncaught). Pin: WsTeardownKeepsErrorSink2026_08_14.test.mjs (3/3 — no bare strip-then-close in any provider incl. Soniox/Deepgram, helper usage present, sink ordering inside the helper). Adjacent STT tests green (11/11 combined run). typecheck clean.
Cross-platform: pure JS; both platforms.
Commit: (pending)

## F-202 [P0] Branch regresses main's shipped fix + lifecycle infrastructure
Status: FOUND → CONFIRMED (git-graph evidence above) → ADVISORY (no code fix possible within audit scope; forward-merge required)

## ⚠ CORRECTION to the Phase 1 close-out (2026-08-18) — 5 self-inflicted test failures found and fixed
The Phase 1 close-out claimed the full suite's 127 failures were "all verified as pre-existing baseline red". That claim was NOT rigorous: I spot-checked exactly ONE failing name. Building a TRUE baseline (throwaway worktree at the pre-audit commit c2ad3133, same suite, same runner) proved **my Phase 1 F-105 refactor broke 5 tests**:
- MeetingStartMicBeforeSystemOrder.test.mjs ×3 (startMeeting / reconfigureAudio / reconfigureSttProvider mic-before-system ordering)
- BluetoothHfpAvoidance.test.mjs ×1 (active reconfigure starts replacement captures)
- StartStopRaceDeferredInit.test.mjs ×1 (deferred-init STT/RAG ownership flags)
All five were STALE SOURCE-ASSERTION tests, not behavioral breakage: they scan each method body for literal `microphoneCapture.start()` / `googleSTT?.start()` adjacency, which F-105 moved into the shared `startCaptureChannels()` helper. The HAL-ordering invariant (mic before system) and the ownership-flag invariant both still hold — inside the helper, and now per-channel accurate.
Repairs: the three tests now FOLLOW the delegation (assert the call site delegates, then assert the invariant in the helper body). One product change was needed too — `startCaptureChannels` returned an inline object type `{ mic: boolean; system: boolean }`, whose brace confused the tests' signature-based method-body extractor; it now returns a named `CaptureChannelStartResult` interface (no behavior change).
Verified after repair: audio suite 325 pass / 12 fail, and the 12 match the pre-audit baseline EXACTLY (`comm` diff empty) → zero regressions attributable to this campaign.
Process fix for the rest of the campaign: every phase close-out now diffs failing-test NAMES against a real baseline worktree run, never by assertion.

## F-203 [P1] Google/Soniox/Deepgram lack the stale-connection identity guard
Phase: 2 | Area: GoogleSTT / SonioxStreamingSTT / DeepgramStreamingSTT
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Repro: scripts/audit/F-203-repro.mjs — real GoogleSTT from the dist bundle with its private `client` swapped for a fake gRPC transport (no credentials, no network); `setSampleRate(48000)` drives the same synchronous stop()+start() main.ts triggers on the first audio chunk of every meeting. PRE-FIX: 2 streams created, `this.stream` === NULL and isStreaming=false after the destroyed stream's async 'close' → the live stream#2 orphaned (open, never ended) → exit 1.
Root cause: handlers close over `this` only, so a discarded connection's async events mutate the CURRENT connection's state. Google: 'error'/'end'/'close' each run `this.stream = null`. Soniox: 'close' nulls this.ws, clears the new keepalive, and on a normal 1000 close sets isActive=false (every later chunk dropped, no 'error', no banner — total silent death). Deepgram: stale Open re-registers Transcript on the live connection (doubled finals into handleTranscript AND the RAG feed) and stale Close clears the live timers.
Fix: NativelyProSTT's documented identity-guard pattern applied to all three — bind the connection to a local at creation and bail (`if (x !== this.x) return;`) in every STATE-MUTATING handler. Deepgram's inner Transcript listener now binds to the captured connection so a stale Open cannot double-register. Deliberately NOT guarded: Google's 'data' and Soniox's transcript emission — they mutate no connection state and a late final is still real user speech (only Soniox's `msg.finished` socket-clearing branch is guarded).
E2E verification: repro → exit 0 (live stream#2 intact, isStreaming=true). Pin: StaleSttConnectionGuards2026_08_18.test.mjs (3/3, one per provider). Full audio suite 325/337 with zero regressions vs the true baseline.
Cross-platform: pure JS state machines; both platforms.
Commit: (pending)
Hypothesis: NativelyProSTT installs `if (ws !== this.ws) return;` guards on every handler (documented CRITICAL, :497-511); the other three don't. GoogleSTT: proactive 270s restart + every set* does synchronous stop+start; the destroyed stream's 'close' fires one tick later and nulls the FRESH stream (:422-427) → orphaned gRPC stream + third stream via lazy reconnect; fires at meeting start (setSampleRate on first chunk) and every 270s. Soniox: old socket's close handler clobbers this.ws (:368), kills the new keepalive (:371), and on code 1000 sets isActive=false → every chunk dropped, no error, no banner — total silent death. Deepgram: old handlers set wrong-connection state, register a SECOND Transcript listener (doubled finals into handleTranscript + RAG), clearTimers kills the live keepalive; buffer discarded on restart (Soniox preserves it).
Trigger: any mid-stream setSampleRate/setAudioChannelCount/setRecognitionLanguage; Google additionally every 270s.
Confidence: high (Google/Soniox) / medium (Deepgram SDK timing).

## F-204 [P2] NativelyProSTT setSampleRate gate diverges from its own comment
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Repro: scripts/audit/F-204-repro.mjs — real NativelyProSTT with ws forced to readyState OPEN and isConnected=false (the post-auth-frame, pre-server-confirm window). PRE-FIX: no close, no intentionalClose, no pendingConnectTimer → the rate change was silently dropped → exit 1.
Root cause: gate used `isActive && isConnected`; isConnected only flips on the server's {status:'connected'} frame, a full round-trip after ws.on('open') sent the auth frame that COMMITS sample_rate.
Fix: gate on the states the block's own comment describes — reconnect unless pre-handshake (`!ws || ws.readyState === WebSocket.CONNECTING`).
E2E verification: repro → exit 0. Pin: NativelyProRateGateStates2026_08_18.test.mjs (4/4) covering BOTH directions — OPEN-unconfirmed and confirmed reconnect; CONNECTING and null do NOT (preserving the documented avoidance of a wasted TLS round-trip and the spurious abort log).
Original hypothesis retained below — gate at :258 uses isActive&&isConnected but the auth frame commits the OLD rate at ws 'open' (:521-522), one round-trip BEFORE isConnected (:582); in the OPEN-but-not-connected window a rate change is skipped → server transcodes at the wrong rate (the exact garbled-transcript failure the comment warns about). Window = relay connect latency; setSampleRate fires on first system chunk (~5-7s after start). Confidence: medium.

## F-205 [P2] LocalWhisperSTT drain leak holds the shared ONNX slot forever
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Repro: scripts/audit/F-205-repro.mjs — real LocalWhisperSTT, a fake worker that accepts the job and never replies, drain bound shortened. Demonstrated BOTH ways: unfixed baseline worktree → slot never released (exit 1); fixed → released (exit 0).
Root cause: stop() keeps the worker for draining finals with no bound; all release paths are worker-reply-driven and dispatchFinal() clears the streaming watchdog.
Fix: DRAIN_WATCHDOG_MS (15s) bound armed when the worker is kept for finals; on expiry it force-runs beginWorkerTermination (releases slotRelease + terminates). Cancelled in beginWorkerTermination so a normal drain is unaffected. Timer unref'd so it never pins the event loop at quit.
E2E verification: repro pre/post as above. Pin: WhisperDrainBounded2026_08_18.test.mjs (1/1) — also asserts the slot is NOT dropped while the drain is legitimately in progress. Audio suite: zero regressions vs the true baseline.
Original hypothesis retained below — stop() keeps the worker for draining finals (:278-283) with NO drain timeout; all release paths are worker-reply-driven; dispatchFinal DISARMS the streaming watchdog (:581). A hung inference leaks the worker AND the acquireOnnxSlot('high') semaphore slot (no timeout, onnxThreadConfig:165-191) → next meeting's spawnWorker awaits forever, no error emitted, no banner; embedder/reranker/intent behind the same gate. Confidence: medium-high.

## F-206 [P2/P3] OpenAI turn-coalescer event-order assumption + 2.5s final dedupe
Status: FOUND → CONFIRMED (code reading) → DEFERRED, cannot be honestly reproduced here
Why deferred (not "not a bug"): settling it requires a captured event log from a LIVE OpenAI Realtime `intent=transcription` session to learn whether `.completed` precedes or follows `speech_stopped`. The campaign's live-LLM budget is DeepSeek-only by instruction, and DeepSeek cannot stand in for another vendor's WebSocket event ordering. Fabricating a synthetic ordering would only re-assert the assumption the existing unit test already encodes (openaiTranscriptTurnCoalescer.test.mjs), which is exactly why that test cannot catch this.
What to run when an OpenAI key is available: start a transcription session, log every event type in arrival order for 3-4 utterances, and check whether any turn's `.completed` arrives AFTER its `speech_stopped`. If it does, finals lag by one utterance (answer for turn N triggers only when the speaker begins turn N+1) and the coalescer must finalize on `.completed` as well.
Separate P3 rider (independent of the above, code-confirmed): `_emitTranscript` drops a final whose trimmed text equals the previous final within FINAL_DEDUPE_MS=2500. Real repeated back-channels in an interview ("Yes." / "Right." / "Yes.") are silently discarded. Deliberate trade-off with a real false-positive mode; left as-is because changing the window without live transcript data would be guesswork.
Original hypothesis retained below — finals may lag one utterance if the GA Realtime session emits speech_stopped BEFORE the transcription .completed (the coalescer only finalizes on speech_stopped/next speech_started; unit test encodes the assumed order so can't catch it). Needs one live event-log capture to settle (LOW-MEDIUM). P3 rider: _emitTranscript drops identical finals within 2500ms — real back-channel repetitions ("Yes." "Yes.") discarded.

Explorer-clean areas: relaySession (auth/fallback/expiry/probes), dnsHelpers, NativelyProSTT timer discipline, main.ts drain semantics, RestSTT isActive gating. No platform-branch bugs in provider files. Residual surface not covered: whisper/** internals, RestSTT upload path, GoogleSTT credential resolution, renderer stt-status banner logic, IntelligenceManager duplicate-final behavior.

### PHASE 2 SUMMARY (2026-08-18)
6 findings: 5 FIXED-VERIFIED (F-201 P0, F-203 P1, F-204 P2, F-205 P2 — plus F-202 handled as a merge advisory), 1 deferred (F-206, needs a live OpenAI Realtime event capture; DeepSeek cannot stand in for another vendor's event stream).
Commits: 918de598 (F-201) · 2370c350 (F-203 + 5 self-inflicted test repairs) · c0fded54 (F-204) · <F-205 pending>.
Regression posture: audio suite 330 pass / 12 fail, failures diffed BY NAME against a real pre-audit baseline worktree (/tmp/natively-baseline-wt @ c2ad3133) → zero regressions attributable to this campaign. One F-204 side-effect (NativelyProSTTPendingTimer) was caught by that diff and repaired: its synthetic `isConnected=true, ws=null` state is unreachable in production (closeUpstream clears isConnected before nulling ws), so the test now uses a realistic OPEN socket.
Verification limitation (honest): full-project typecheck is NOT reproducible in the audit worktree — the shared node_modules' typescript7 drifted past this branch's tsconfig (baseUrl/moduleResolution removed upstream), and any override surfaces 78 errors in files this campaign never touched. Compile gate here is esbuild (`build:electron`, clean) plus the test suites. Typecheck was clean for all Phase 1 work when it ran in the main checkout.

Phase 2 processing queue: F-201 (P0, fix here) → F-202 (advisory, done) → F-203 (P1) → F-204, F-205 (P2) → F-206 (needs live capture; DeepSeek not applicable — OpenAI Realtime event order; defer with instructions).

---

# Phase 1 — Core runtime & IPC

Read-only audit pass: 3 parallel explorations dispatched 2026-08-14 —
(a) main process bootstrap / window lifecycle / overlay, (b) IPC contracts / preload / renderer bridge, (c) audio capture native bridge.

Findings will be recorded below in severity order as they are triaged.

Verification baseline (2026-08-14, working tree): `npm run typecheck:electron` → clean (exit 0). Full test-suite baseline deferred until first fix is staged (build mutates `dist/` in a shared workspace).

## Findings — candidate list (audit pass; statuses advance per-finding)

### Sub-area C: audio capture / native bridge (exploration complete)

## F-101 [P1→INVALID] Mic emitted-rate lies when resampler init fails
Phase: 1 | Area: native-module mic DSP / MicrophoneCapture
Status: FOUND → INVALID (2026-08-14)
Verdict reasoning: The code asymmetry is real — the mic DSP thread (lib.rs:516-547) never stores `emitted_rate` back into `self.sample_rate`, unlike the system path (lib.rs:275), and the constructor value is unconditionally 16000. BUT the trigger is unreachable: the passthrough branch only executes when `Resampler::new` fails, and in rubato 0.16.2 (Cargo.lock-pinned) `FftFixedIn::new`'s ONLY fallible check is `validate_sample_rates` (synchro.rs:81-86), which errors solely when input or output rate == 0. cpal never reports a 0 Hz device rate and the output rate is the constant 16000, so `Resampler::new` is total over the real input domain. Every reachable path emits 16 kHz, matching the declared rate. Dead error branch → hypothetical bug → not fixed, per campaign rules.
FOLLOW-UP (hardening, optional): mirror lib.rs:275's store-back in the mic DSP thread so a future rubato upgrade can't resurrect this silently.
Hypothesis: `MicrophoneCapture::new` (native-module/src/lib.rs:435, restart at :481) sets the shared emitted-rate atomic optimistically to 16000; the DSP thread (lib.rs:520-531) can fall back to passthrough at native rate when `Resampler::new` fails but never stores the real rate back to `self.sample_rate` (SystemAudioCapture does at lib.rs:275). `MicrophoneCapture.getSampleRate()` then reports 16000 for 48000 Hz PCM; main.ts:3571-3577 locks STT at 16k → chipmunk audio → garbage user transcript. JS wrapper has no rate poll (unlike SystemAudioCapture.ts:162-163).
Disproof criteria: `Resampler::new` total over all cpal rates; or a mic-DSP writer to `self.sample_rate` missed by the audit.
Confidence: high.

## F-102 [P1] Orphaned capture instance keeps writing into live STT
Phase: 1 | Area: main.ts wireSystemCapture/wireMicCapture + rebuild flows
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Step 1 confirmation refined the reachability: recovery and route-change DO guard each other (recovery defers at :4662, route-change at :4868 — the explorer's proposed pairing is actually mutually excluded at entry). The unguarded third party is restartCapturesAfterResume: no mutex, clears both flags (:3916/:3923), and NONE of the three flows re-validate field ownership after their awaits before assigning. The mic-recovery finally block (:5027-5034) already applies exactly this ownership-revalidation pattern to the paused system capture — the flows' own assignments never did.
Repro: scripts/audit/F-102-repro.mjs — live AppState, fake meeting flags, STT stubs (no network), recovery saturated; handleDefaultOutputChanged + restartCapturesAfterResume fired in ONE synchronous turn (both suspend on the capability await; deterministic interleave). PRE-FIX: '(RouteChanged)' fresh constructed/assigned/wired/started, then '(Resume)' assignment overwrote it → orphanCount 1, both instances alive → exit 1.
Root cause: (a) rebuild flows assign into this.systemAudioCapture after awaits without re-checking the null they left (route-change :4880→:4909; recovery :4718→:4741; resume :3986→:4003); (b) the data write :3487 (mic :3666) has no instance-identity guard, unlike siblings :3424/:3475, so the orphan keeps feeding the live STT socket.
Fix: (1) ownership revalidation in all three flows — after the awaits, a non-null field means another flow rebuilt mid-await; keep theirs and return. (2) Instance-identity guards on the data/sample_rate_changed/speech_ended consumers in wireSystemCapture AND wireMicCapture.
E2E verification: repro re-run → exit 0 (aliveCount 1, orphanCount 0, field owns the survivor). Regression pin: electron/services/__tests__/CaptureOwnershipGuards2026_08_14.test.mjs. Adjacent tests green (ZerofillDetectorPeakToPeak, AudioCaptureFailedBroadcastBothSurfaces); typecheck clean; F-103 repro re-run PASS on top of these changes (same handler touched).
Regression check: normal single-flow rebuilds unaffected (field is null when they construct); the identity guards drop only chunks from a capture that already lost ownership (≤ms of teardown-window audio, previously interleaved garbage).
Cross-platform: pure JS state-machine fix, platform-neutral; macOS live-verified, Windows reviewed but not executed.
Commit: 0d0740fe
Hypothesis: data-path writes are the only consumers NOT gated on instance identity (main.ts:3487 `this.googleSTT?.write(chunk)`, :3666 mic equivalent; guarded siblings at :3424/:3475/:3518/:3571). A capture that loses ownership of the field without being destroyed keeps pumping PCM into the live STT socket. Reachable when `restartCapturesAfterResume` (no own mutex; clears both recovery mutexes at :3916/:3923) races `handleDefaultOutputChanged` (:4856-4871) — both destroy the same old capture, construct fresh, assign; loser never destroyed.
Trigger: wake-from-sleep coinciding with an output route change (AirPods reconnect on lid open).
Disproof: show endMeeting/abort reaches non-field-referenced captures, or the watcher can't tick between resume and :3986.
Confidence: high (guard asymmetry) / medium (orphan reachability).

## F-103 [P1] Route change permanently lost when handler bails
Phase: 1 | Area: main.ts default-output watcher
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Step 1 confirmation sharpened the finding: of the handler's four bails, three (quitting / isCurrentMeeting / switchInProgress) re-check conditions the watcher tick verified synchronously in the same turn and cannot differ — the ONLY reachable swallow path is the recovery mutex at main.ts:4868. The comment above it ("the watcher's setInterval will re-fire and pick up the route change") described intended semantics the code did not have. Only writers of _lastObservedDefaultOutputId: :4804/:4806 (start), :4830 (advance-before-handle), :4842 (stop) — no recovery writer exists.
Repro: scripts/audit/F-103-repro.mjs — drives the LIVE AppState singleton via the main-process module cache (no real devices, no audio, no meeting: fake meeting flags + a spy that lets only the first handler call through, which bails on the held recovery mutex before touching capture state). PRE-FIX: calls=1, observation already advanced at the watcher → route change never retried → exit 1.
Root cause: main.ts:4830 — `_lastObservedDefaultOutputId = currentId` committed BEFORE the fire-and-forget handler ran its bails; nothing rolls it back.
Fix: watcher no longer advances the observation; `handleDefaultOutputChanged(currentId)` receives the observed id and commits it only after passing the recovery-mutex gate (i.e. when the rebuild cycle actually runs). Deferred cycles now re-fire on the next 4s tick, matching the comment's promised semantics.
E2E verification: repro re-run → exit 0 (recovery held: observation NOT consumed; recovery cleared: handler re-fired on subsequent ticks). Regression pin: electron/services/__tests__/RouteChangeNotSwallowed2026_08_14.test.mjs (watcher must not assign after change detection; handler must commit after the recovery gate). 11/11 audit pins + adjacent audio test green; typecheck clean.
Regression check: mid-flight bails after the commit (quit/meeting-gen change at :4886-4888) correctly consume the observation (change moot once the meeting is gone); explicit-device path unaffected (:4815 tick guard precedes everything).
Cross-platform: watcher runs on Windows too (native getDefaultOutputDeviceId exists on both — verified in audit pass); fix is platform-neutral. macOS live-verified; Windows reviewed but not executed.
Commit: d41af23d

### Repro-infrastructure notes (Phase 1)
Bare-file Playwright launches (`electron dist-electron/electron/main.js`) run with app.getAppPath()=dist-electron/electron and userData=~/Library/Application Support/Electron — an ISOLATED scratch profile (user's real data and stored STT/LLM keys are never touched by these repros). Side effect: nativeModuleLoader's dev candidates miss repo/native-module (silent null — F-107's mechanism, observed live); repro scripts that need native audio ensure a gitignored symlink dist-electron/electron/native-module → ../../native-module. AppState singleton is reachable via Module._cache right after boot (the entry is pruned from the cache within seconds — Playwright's electron loader — so stash exports on globalThis immediately).
Hypothesis: watcher advances `_lastObservedDefaultOutputId` (main.ts:4830) BEFORE calling `handleDefaultOutputChanged`, which has four no-work bail-outs (:4856-4868). On bail, the change is swallowed forever by the :4827 equality check; comment at :4866 assumes the watcher will re-fire, but it can't. Loopback stays bound to abandoned device; interviewer transcript dead, no banner (stuck watchdog needs chunkCount===0).
Trigger: output device swap during in-flight system-audio recovery.
Disproof: another writer re-reads the default id into the field after a deferred cycle.
Confidence: high.

## F-104 [P1] Unawaited destroy() races fresh native monitor for HAL lock
Phase: 1 | Area: main.ts recovery + route-change flows
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Step 1 confirmation: resolveMacScreenCaptureCapability's cache-hit (:862-868), dev-bypass (:874-879) and status!=='denied' (:896-901) paths all resolve without leaving the microtask queue; SystemAudioCapture.stop() defers the blocking native monitor.stop() via setImmediate (SystemAudioCapture.ts:248) and destroy() awaits stop (:273-280), so destroy's promise IS the "HAL released" signal — the flows just never awaited it. Native acquisition is lazy (start(), per :234-239), and microtasks drain before the check phase → fresh.start() always precedes the dying monitor's stop on warm-cache paths. The stale comment at the recovery site claimed "no race".
Repro: scripts/audit/F-104-repro.mjs — deterministic ordering assertion through the REAL route-change flow (real wrapper instances; native starts suppressed by the wire interceptor; the old capture's REAL stop() runs the REAL setImmediate deferral against a fake monitor that marks the release moment). PRE-FIX marks: fresh.start → old.nativeStop → exit 1.
Root cause: `oldCapture?.destroy()` fire-and-forget at the recovery flow and route-change flow (every other teardown site awaits — resume :3954/:3982, reconfigure :4363, endMeeting via _pendingTeardown).
Fix: both flows now null the field first (so watcher ticks/other flows observe the teardown) then `await oldCapture?.destroy()`; stale "no race" comment replaced with the actual invariant. Composes with F-102's ownership guards (a flow that loses the field while awaiting defers to the new owner).
E2E verification: repro → exit 0 (old.nativeStop precedes the measured fresh.start). F-102 and F-103 repros re-run PASS on the combined changes (same flows). Pin: electron/services/__tests__/DestroyAwaitedBeforeFreshCapture2026_08_14.test.mjs (1/1). typecheck clean.
Regression check: awaiting adds ≤~300ms (Windows worst case) before a rebuild — inside mutex-held recovery paths where resume/endMeeting already accept the same latency; recovery counter/timer semantics unchanged.
Cross-platform: same deferral exists for WASAPI teardown; fix platform-neutral. macOS live-verified; Windows reviewed but not executed.
Commit: 0d72316a
Hypothesis: `oldCapture?.destroy()` unawaited at main.ts:4717 and :4879; native `monitor.stop()` runs on setImmediate (SystemAudioCapture.ts:248) while the only intervening await (`resolveMacScreenCaptureCapability`, cache-hit path main.ts:862-901, TTL 3s always warm mid-meeting) resolves in microtasks — so `fresh.start()` (:4743/:4911) constructs the new RustAudioCapture while the dying one holds the CoreAudio tap. Repo documents this exact failure at SystemAudioCapture.ts:170-180 and main.ts:5760-5763 ("0 chunks in 8s" / HAL property-listener deadlock). All other teardown sites await (:4363, :3954, :3982, endMeeting :5776-5783).
Disproof: capability resolver always crosses a macrotask boundary on cache hit; or Rust constructor acquires no HAL resource until start().
Confidence: medium-high.

## F-105 [P1] Mic start() throw kills the system-audio channel too
Phase: 1 | Area: main.ts meeting start / reconfigureAudio / HFP auto-switch
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Step 1 confirmation: three bare four-start sequences (meeting start audio block; reconfigureAudio; _doReconfigureSttProvider), each mic-first with user STT / system capture / system STT behind it; MicrophoneCapture.start() rethrows by design (lazy native open). HFP auto-switch (:3624-3626) additionally swallows the reconfigure rejection into console.warn on a LIVE meeting.
Repro: scripts/audit/F-105-repro.mjs — REAL startMeeting() in the isolated scratch app; wire interceptor forces the mic start to throw and records (without running) the system start; spies on sendAudioCaptureFailed/broadcast. PRE-FIX: systemStartCalls=0, watcherArmed=false, genericAudioError=true → exit 1 (both channels dead behind one generic banner; the wired-never-started system capture emits no 'start' so the stuck watchdog never arms).
Root cause: unhandled rethrow crossing channel boundaries in all three bare sequences; the meeting-start catch treats it as a whole-pipeline failure.
Fix: new private startCaptureChannels(context) helper — per-channel try/catch, mic first (HAL ordering preserved), failing channel surfaces a terminal channel-specific sendAudioCaptureFailed banner and the other channel + downstream steps (live indexing, route watcher) proceed. All three sites now call it; the HFP path's swallow is defused because reconfigureAudio no longer rejects on a channel start failure (channel banner surfaces instead).
E2E verification: repro → exit 0 (systemStartCalls=1, watcherArmed=true, specific "Microphone failed to start (AUDIT-FORCED-MIC-FAIL)" banner, no generic broadcast). Pins: CaptureChannelIsolation2026_08_14.test.mjs; all 13 audit pins green; typecheck clean; F-102 and F-104 repros re-run PASS.
Regression check: healthy-path behavior unchanged (both try blocks succeed → identical start order); startedByInit bookkeeping now reflects per-channel outcomes.
Cross-platform: platform-neutral orchestration; macOS live-verified via real startMeeting; Windows reviewed but not executed (WASAPI exclusive-steal is the canonical Windows trigger this fixes).
Commit: (pending — backfilled next update)
Hypothesis: `MicrophoneCapture.start()` rethrows by design (MicrophoneCapture.ts:114, :166), but callers run bare sequences: a throw at main.ts:5579 skips system-audio start at :5584-5586, live indexing :5592, and the output watcher :5607 → wired-but-never-started capture emits no 'start', watchdog never arms, both channels dead behind one generic error. Same shape at :4513-4516; HFP auto-switch (:4610-4616) swallows the rejection into console.warn, silently killing a live meeting.
Trigger: mic open failure (USB device gone, WASAPI exclusive steal, cpal no-supported-format, HFP target unavailable).
Disproof: show start() cannot throw once construction guard at :3762-3776 passed (it can — native open is lazy, happens in start()).
Confidence: high.

## F-106 [P2] MicrophoneCapture leaks an open native handle on start() failure
Phase: 1 | Area: MicrophoneCapture.ts / microphone.rs
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Step 1 confirmation: start()'s catch (MicrophoneCapture.ts:161-167) rethrows leaving this.monitor set; stop() early-returns on !isRecording (:186-188); destroy() awaits that no-op stop then nulls the monitor — the constructed cpal stream (device opened at construction per the wrapper's own lazy-init comment) is dropped without stop. SystemAudioCapture's ORPHAN-HANDLE FIX (:170-199) covers exactly this on the system side; mic never got the mirror.
Repro: scripts/audit/F-106-repro.mjs — the repo's established fake-native-module harness (Module._load hook) against the dist bundle; fake mic native whose start() throws. PRE-FIX: after failed start + stop() + destroy(), native stopCalls === 0 → orphaned open device → exit 1.
Root cause: missing orphan-handle teardown in the mic start-catch; asymmetry with the system wrapper.
Fix: mirrored ORPHAN-HANDLE FIX — the catch nulls this.monitor and stops the dying instance on setImmediate; next start() reconstructs via the lazy-init branch.
E2E verification: repro → exit 0 (stopCalls 1). Suite test added: electron/audio/__tests__/MicFailedStartReleasesHandle2026_08_14.test.mjs (runs under npm test's audio glob; 1/1). Adjacent wrapper tests 10/10 (CaptureStopAwaitable, CaptureRestartRegression, MicRecoveryUsesCanonicalWiring). typecheck clean.
Regression check: retry semantics now match the system wrapper (reconstruct-fresh instead of retry-same-monitor); recovery flows and the audio test already construct new wrappers.
Cross-platform: releases WASAPI device handles deterministically on Windows (exclusive-mode retry unblocked) and clears the macOS orange indicator; platform-neutral JS. macOS-side harness verified; Windows reviewed but not executed.
Commit: (pending — F-110 = 7317b459)
Hypothesis: `MicrophoneStream::new` opens the cpal device at construct (microphone.rs:248). `start()`'s catch (MicrophoneCapture.ts:161-167) rethrows leaving `this.monitor` constructed-but-never-stopped; `destroy()` (:279-290) early-returns from stop() when `!isRecording` then nulls the monitor. SystemAudioCapture has an explicit "ORPHAN-HANDLE FIX" (SystemAudioCapture.ts:189-199); mic has no equivalent. Concrete reachable site: audio test main.ts:5191-5206 — throw after construct → handle unreachable and unstopped (macOS orange dot stays lit; Windows device held against the retry at :5204).
Disproof: napi finalizer runs deterministically at unreachability (it doesn't), or Rust Drop releases device promptly without stop().
Confidence: high.

## F-107 [P2] Absent/wrong-arch native module boots into a silent no-op meeting
Phase: 1 | Area: nativeModuleLoader / SystemAudioCapture / MicrophoneCapture constructors
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Repro: scripts/audit/F-107-repro.mjs — bare-file launch WITHOUT the native-module symlink (the loader's silent-null state observed live during F-103's investigation), real startMeeting(), banner spy. PRE-FIX: zero native-related banners — only unrelated STT-config banners (in a real profile with valid keys there would be NOTHING); watcher unarmed; meeting reports success → exit 1.
Root cause: both wrappers' start() bare-return on missing native class — no 'error', no 'start' (watchdog arms on 'start'), so the degradation had zero surface.
Fix: both start() methods now THROW ('Native audio engine unavailable — …') — matching the mic wrapper's existing construction-failure contract; every call site catches (startCaptureChannels [F-105], recovery, resume, audio test) and surfaces terminal channel banners. Constructors unchanged.
E2E verification: repro → exit 0 (both channels' terminal native banners observed — F-105's helper composing as designed). Adjacent wrapper tests 8/8; typecheck clean. Pin: NativeModuleAbsenceSurfaced2026_08_14.test.mjs (2/2).
FOLLOW-UP: extend the boot arch gate (nativeArch.cjs TARGETS) to verify native-module/index.*.node presence+arch at startup for packaged builds — deferred (packaging-surface change; Phase 7 candidate).
Cross-platform: throw path platform-neutral; the loader's failure modes covered on both (missing binary / wrong arch / asar-unpack regression).
Commit: (pending — F-118 = 3ae78552)
Hypothesis: when `loadNativeModule()` returns null (missing binary, wrong arch, or early-boot `require('electron')` failure which caches null permanently — nativeModuleLoader.ts:180, :220-224, :275-277), both constructors only console.error; both start() methods return without emit('error')/emit('start') → watchdog never arms, device lists empty, meeting reports started (main.ts:5617), zero transcript, zero UI surface. Boot arch gate covers only better-sqlite3 + keytar (nativeArch.cjs:28-31) — native-module/index.*.node unverified.
Trigger: fresh clone without build:native; packaging regression; x64 binary on arm64; early-boot import poisoning the loader cache.
Disproof: a "native available" predicate checked before meeting start that surfaces a banner; or nativeArch.verifyAll covering native-module.
Confidence: high.

### Sub-area C areas verified clean
No child/helper processes in the capture path (all in-process napi threads); nativeModuleLoader path resolution + asar-stub smoke test sound; system-side zero-fill classification intentionally log-only (asserted by tests); default-output watcher works on Windows (eConsole role only — annotated known limitation, not raised); SystemAudioCapture rate-poll teardown correct; peakToPeak stride sampling correct.

### Sub-area A: main process / windows / overlay (exploration complete)

## F-108 [P0] Overlay close handler cancels app quit mid-teardown
Phase: 1 | Area: WindowHelper overlay lifecycle / app quit
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Repro: scripts/audit/F-108-repro.mjs — real app launch (Playwright _electron, existing dist bundle, production file:// renderer). PRE-FIX output: `post-mortem (process STILL ALIVE): {"lifecycle":{"beforeQuit":true,"willQuit":false,"quit":false},"windows":0,"visibleWindows":0}` → exit 1. Overlay visible at quit time asserted inside the script (throws "repro invalid" otherwise).
Root cause: electron/WindowHelper.ts:1168 — overlay 'close' handler preventDefaults purely on `isVisible()`; during quit, Electron's CloseAllWindows sweep hits it AFTER before-quit (main.ts:8149) has closed the DB and scrubbed credentials; the prevented close cancels the quit (is_quitting_ reset), and macOS window-all-closed (main.ts:7996) never quits → windowless post-teardown zombie. The correct flag exists (`setQuitting(true)` at main.ts:8151) — the handler just never consulted it, unlike the launcher handler (:1075).
Fix: overlay close handler now returns early when `appState.isQuitting()` — the close proceeds during quit; user-initiated close (hide, don't destroy) unchanged. Regression test: electron/services/__tests__/OverlayCloseDoesNotCancelQuit2026_08_14.test.mjs pins guard-before-preventDefault for BOTH overlay and launcher handlers.
E2E verification: same repro script, guard disabled via temp edit → exit 1 (reproduced); guard restored → exit 0 (app quits within 12s; before-quit runs once). Adjacent-behavior check inside the script: non-quit overlay close still intercepted (stillExists:true, destroyed:false).
Regression check: 35/35 pass — new test + AudioCaptureFailedBroadcastBothSurfaces + WindowsPlatformParity + CropperWindowHelper.bounds (electron runner); typecheck:electron clean.
Cross-platform: fix is platform-neutral state consultation. macOS: live-verified (repro). Windows: reviewed but not executed — behavior change there is strictly beneficial (single before-quit teardown instead of double; window-all-closed → quit path no longer needed). Requires physical Windows verification for the full quit flow.
Commit: a9d7ea42 (branch audit/autopilot-2026-08-14). Note: first commit attempt swept in another session's staged files (shared index); reset --soft + re-committed with --only pathspec. Foreign staged work preserved.
Hypothesis: overlay 'close' handler (WindowHelper.ts:1168-1179) preventDefaults whenever the overlay is visible with NO isQuitting() guard (launcher's handler at :1075 has one). Quit during a meeting → before-quit (main.ts:8149-8325) runs destructive teardown (DB close :8290, credential scrub :8297-8298, rag.dispose :8254, Ollama stop :8260) → CloseAllWindows hits the visible overlay → preventDefault → Electron resets is_quitting_ → will-quit/quit never fire. Handler's own recovery hides the overlay so remaining windows close → window-all-closed with is_quitting_==false → on macOS (main.ts:7996 only quits off-darwin) a zero-window process survives with nulled SQLite, scrubbed keys, no dock tile; Force Quit required. On Windows window-all-closed → app.quit() recovers but runs before-quit teardown TWICE.
Trigger: tray Quit (main.ts:6673-6677), menu role:quit, or autoUpdater.quitAndInstall (:2871/:2920) while overlay visible — i.e. any quit during a meeting.
Disproof: Electron 43 not delivering 'close' for programmatic close() on the frameless macOS panel; instrument handler + ps for surviving PID.
Confidence: high (mechanism) / medium-high (macOS end state).
Step 1 — CONFIRMED (2026-08-14, own re-read):
- WindowHelper.ts:1168-1179 — overlay 'close' preventDefaults purely on `isVisible()`; no isQuitting() consult. Launcher's handler (:1075) has the guard, and it is only registered off-darwin anyway (:1068).
- main.ts:8151 — before-quit sets `appState.setQuitting(true)` FIRST, so the correct flag exists and is set before any window receives 'close'; the overlay handler simply never reads it. before-quit then synchronously closes the DB (:8286-8293) and scrubs credentials (:8295-8302), with no event.preventDefault() and no app.exit().
- main.ts:7995-7999 — window-all-closed quits only off-darwin. So on macOS a cancelled quit + subsequently-hidden overlay → all windows destroyed → no-op → alive process with closed DB/scrubbed keys.
- Electron semantics: preventing a window close during quit cancels the quit (documented behavior; is_quitting_ reset). Nothing re-issues app.quit() on darwin.
- Extra hazard found during confirmation: overlay recovery calls switchToLauncher() when no meeting is active — i.e. it may CREATE/SHOW a window mid-quit-cancellation, and the launcher 'closed' handler (:1125-1128) itself calls overlayWindow.close(), so the cancellation can arrive via two orderings; both end at the same state.
Disproof criteria NOT met. Proceeding to live reproduction.

## F-109 [P0] child-process-gone / gpu crash permanently kills the DB silently
Phase: 1 | Area: main.ts crash handlers / DatabaseManager
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Step 1 confirmation: render-process-gone (main.ts:8046-8061) inspects reason and keeps the DB open on every recover path, with a comment naming the exact hazard ("irreversible… nulls the singleton DB with no reopen path"); child-process-gone/gpu-process-crashed had no gating at all. DatabaseManager re-read: `openWithWalSelfHeal` (DatabaseManager.ts:258) is only reachable from `init()`/constructor — post-close reopen genuinely impossible. Foreign staged DatabaseManager changes (+193, usage outbox) checked: no reopen path added.
Repro: scripts/audit/F-109-repro.mjs — real app, read `modesGetAll` (8 modes), SIGKILL the GPU child, observe. PRE-FIX: main alive, Chromium relaunched GPU (76757→76810), 'child-process-gone' observed, modesGetAll now 0 → exit 1. Proves the event is recoverable AND the close causes (not prevents) data loss.
Root cause: main.ts:8132-8142 — both handlers call emergencyCloseDatabase unconditionally, inspecting neither details.type nor details.reason, treating a survivable Chromium child restart as app-terminal.
Fix: both handler bodies now gate emergencyCloseDatabase (and stopAppManagedHindsight in the child handler) behind `appState.isQuitting?.()`, matching render-process-gone's "only close the DB on TERMINAL paths" policy. Logging preserved unconditionally.
E2E verification: re-ran repro → exit 0 (GPU killed+relaunched, DB still answers 8 modes). Regression pin: electron/services/__tests__/ChildProcessGoneKeepsDbOpen2026_08_14.test.mjs (asserts isQuitting gate precedes the close call in both handlers). typecheck:electron clean. F-108 pin re-run green (4/4).
Regression check: render-process-gone path untouched; quit path unaffected (before-quit/will-quit still checkpoint+close; the gated close also still fires if a child dies mid-quit).
Cross-platform: platform-neutral policy change; macOS live-verified; Windows reviewed but not executed (same Chromium child-process model applies). FOLLOW-UP logged: SIGHUP handler (main.ts:317-325) closes the DB without exiting — same class, lower reachability; not fixed here (separate finding candidate for Phase 7 signal-handling review).
Commit: e5d72c33
Hypothesis: main.ts:8132-8142 calls emergencyCloseDatabase unconditionally on child-process-gone and gpu-process-crashed, inspecting neither details.type nor details.reason. child-process-gone fires for recoverable/clean child exits (GPU, Utility, clean-exit...); Chromium restarts the child, the main process survives, but closeWithoutCheckpoint (DatabaseManager.ts:196-204) sets db=null with NO reopen path (getInstance returns same instance; all methods `if (!this.db) return;`). Every save/transcript persist silently no-ops thereafter. Repo documents this exact class at main.ts:226-251 and carefully gates render-process-gone (:8046-8061) + unhandledRejection (:269-278) — these two handlers were left ungated. Same class: SIGHUP handler (main.ts:317-325) closes DB but doesn't exit.
Trigger: GPU process restart (driver reset, display sleep/wake, monitor hotplug), any utility-process exit, either platform.
Disproof: child-process-gone never fires in healthy sessions for this app's process set AND gpu crashes always take down main too.
Confidence: high.

## F-110 [P1] Init failure leaves a lock-holding windowless zombie
Phase: 1 | Area: main.ts initializeApp
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Step 1 confirmation: initializeApp().catch closes DB, writes report, logs — never exits (re-read verbatim). Repo names the hazard itself at the verification-flags assert. Injection attempts with realistic external faults documented: corrupted natively-preferences-secure.json SELF-HEALS (CredentialsManager falls through to app-managed fallback with saves disabled — good engineering, noted); read-only userData dir kills Chromium before app code runs (clean exit, not this bug). Neither reaches the catch → added a deterministic env-gated fault hook `NATIVELY_TEST_INIT_FAULT` (inert unless set; same pattern as NATIVELY_E2E / NATIVELY_DEV_BYPASS_SCREEN_TCC hooks) inside the unguarded stretch.
Repro: scripts/audit/F-110-repro.mjs — launch with the fault env. PRE-FIX: process STILL ALIVE 15s after the injected failure with only a hidden helper window (no launcher, no dock tile, single-instance lock held) → exit 1.
Root cause: missing termination in initializeApp's top-level catch; the one guarded fatal path (assertVerificationFlagsOrThrow) exits explicitly and comments why, the generic catch never did.
Fix: catch now ends in app.exit(1) (app.exit, not app.quit — DB already closed, and half-initialized before-quit handlers must not run against missing singletons) + the permanent test hook.
E2E verification: repro → exit 0 (process exits code 1). Healthy-boot regression: F-108 repro (full boot + overlay + quit cycle) re-run PASS. Pin: InitFailureExits2026_08_14.test.mjs (2/2). typecheck clean.
Cross-platform: platform-neutral; the macOS accessory-policy wrinkle makes the zombie invisible there, Windows zombie holds the lock identically. macOS live-verified; Windows reviewed but not executed.
Commit: (pending — backfilled next update; F-105 = f71dc4c8)
Hypothesis: single-instance lock acquired at main.ts:7235; activation policy 'accessory' at :7358 reverted only at :7756. In between, unguarded calls (CredentialsManager.init :7418, AppState.getInstance :7423, initializeIpcHandlers :7438, applyInitialDisguise :7479, createWindow :7690...) unwind to initializeApp().catch (:8334) which logs but never app.exit(). Result: alive process, no window, no dock tile, holds the lock; relaunch hits second-instance → centerAndShowWindow → launcherWindow===null → nothing shows. Repo names this hazard verbatim at :7326-7330 (assertVerificationFlagsOrThrow exits explicitly).
Trigger: any throw in the unguarded init stretch (corrupt credentials store, native load failure in IPC module, disk-full).
Disproof: all those call sites internally exception-proof (missing app.exit in catch is unconditionally true regardless).
Confidence: high.

## F-111 [P2] Quit-time screenshot cleanup is a no-op (privacy/disk leak)
Phase: 1 | Area: main.ts before-quit / ScreenshotHelper
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Repro: scripts/audit/F-111-repro.mjs — live app, marker PNG written into the LIVE helper's screenshotDir and pushed onto its queue, then a normal quit. PRE-FIX: marker survived the quit → exit 1.
Root cause: before-quit constructed a fresh ScreenshotHelper (empty in-memory queues; constructor never scans the dir) and cleared THAT, logging success; the live AppState.screenshotHelper was never touched.
Fix: before-quit now calls `appState.getScreenshotHelper()?.clearQueues()` on the live instance.
E2E verification: repro → exit 0 (queued screenshot deleted during quit). Pin: QuitScreenshotCleanupLiveInstance2026_08_14.test.mjs (1/1). typecheck clean.
FOLLOW-UP: cleanup still deletes only QUEUED files — leftovers from crashed sessions are never swept; a startup directory sweep of userData/screenshots would complete the privacy intent (deferred: redesign beyond minimal fix).
Cross-platform: platform-neutral. macOS live-verified; Windows reviewed but not executed.
Commit: (pending — F-106 = d93ff582)
Hypothesis: before-quit (main.ts:8305-8313) constructs a BRAND-NEW ScreenshotHelper and calls clearQueues(), which deletes only files in the in-memory queue arrays — empty on a fresh instance (constructor never scans the dir, ScreenshotHelper.ts:449-466, 816-839). The real populated instance is AppState.screenshotHelper (main.ts:1476), never cleared. Screenshots of the user's meeting screen accumulate forever in userData/screenshots while the log claims cleared. Constructor also mkdirSync's during shutdown.
Trigger: every clean quit, both platforms.
Disproof: another path (IPC clearQueues :6358, startup sweep) deletes those dirs — none found (no readdirSync in ScreenshotHelper).
Confidence: high.

## F-112 [P3] CropperWindowHelper.dispose() never closes its window
Phase: 1 | Area: CropperWindowHelper
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Repro: scripts/audit/F-112-repro.mjs (fake-electron harness against the dist bundle, fake window in the private field). PRE-FIX: dispose() → 0 close/destroy calls → orphaned window → exit 1.
Root cause: dispose() sets isDisposed=true (:624) then calls closeWindow() (:652) whose guard requires !isDisposed (:606) — guaranteed no-op before the reference drop.
Fix: dispose() destroys the window directly (destroy(), not close() — forced-cleanup path, skips close events; cropper has no close interceptor). Suite test: CropperDisposeClosesWindow2026_08_14.test.mjs (1/1).
Regression handled: the pre-existing CropperWindowHelper.bounds.test.mjs fake window lacked the standard destroy() method — fake completed (6/6 after; it was 5-fail against the fix, caused by the incomplete fake, not the code). typecheck clean.
Cross-platform: platform-neutral.
Commit: (pending — F-117 = 5bd61d39)
Hypothesis: dispose() sets isDisposed=true (:624) then calls closeWindow() (:652) whose guard requires !isDisposed (:606) → guaranteed no-op; window orphaned by `this.cropperWindow = null` (:653). Bounded impact (process exiting) but pollutes window-all-closed accounting during shutdown (interacts with F-108/F-114).
Confidence: high (pure control-flow read).

## F-113 [P2] Cropper bounds frozen at creation; display changes break area capture
Phase: 1 | Area: CropperWindowHelper
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Step 1 confirmation: createWindow computes getCombinedDisplayBounds() once; showCropper's reuse branch recomputed only the HUD position; no display-change listeners repo-wide; the confirm listener reads getBounds() FRESH (so a show-time re-fit fully corrects the mapping — no listener architecture needed).
Repro: scripts/audit/F-113-repro.mjs — fake-electron harness; window carries the old single-display bounds, a monitor appears left of primary, showCropper() runs the reuse branch. PRE-FIX: bounds stay (0,0,1440,900) vs expected (-1920,0,3360,1080) → exit 1.
Root cause: creation-time-only bounds computation on an eternally-reused window.
Fix: showCropper's reuse branch re-fits the window (setBounds) to the fresh combined bounds when they differ, before arming the selection. Minimal: no display-event listeners (checked at the only moment that matters).
E2E verification: repro → exit 0 (re-fit exact). Suite test: CropperRefitsOnShow2026_08_14.test.mjs (1/1); both existing cropper suites 7/7; typecheck clean.
Cross-platform: setBounds path platform-neutral; Windows opacity-shield path unchanged (its no-maximize note still holds — bounds come from the re-fit now).
Commit: (pending — F-112 = 6fb8fdcf)
Hypothesis: createWindow() computes getCombinedDisplayBounds() once (:423); window preloaded at startup (main.ts:1484-1486) and reused forever (hideOrClose only hides; showCropper recomputes only HUD position). No display-added/removed/metrics-changed listeners anywhere in electron/. After monitor/DPI change: uncovered regions unselectable; stale origin makes confirmedListener (:132-136) map coords with stale x/y while validateBounds (:206) checks fresh bounds → :214 rejects → silent no-op on area capture.
Trigger: dock/undock, plug external display, change scaling, then use area screenshot.
Disproof: OS auto-resizes transparent/enableLargerThanScreen windows on reconfiguration (empirical check), or a recreation path exists (none found).
Confidence: medium-high.

## F-114 [P3] Dev-mode launcher close leaves the zombie it claims to prevent
Phase: 1 | Area: WindowHelper dev close path
Status: FOUND → CONFIRMED → BLOCKED-ON-PLATFORM (no fix this pass)
Step 1 confirmation: the dev exception (WindowHelper.ts:1069-1074) sets setQuitting(true) and lets the close proceed, relying on window-all-closed → app.quit(); but hidden preloaded windows (settings + model-selector main.ts:7798-7799 region, cropper, popoverCatcher) are never closed, so window-all-closed cannot fire. Mechanism solid.
Step 2: NOT live-reproducible on this machine — the handler registers only under `process.platform !== 'darwin'` (:1068), and the campaign forbids fixing without reproduction. Proposed fix for the Windows session that picks this up: in the isDev branch, schedule `app.quit()` explicitly (setImmediate, after the close proceeds) instead of relying on window-all-closed; with setQuitting already true and F-108's overlay guard in place the sweep completes. Requires physical Windows verification.
Hypothesis: dev exception (WindowHelper.ts:1069-1074) relies on window-all-closed → app.quit(), but hidden preloaded windows (settings + model selector, main.ts:7798-7799; cropper :1484-1486; popoverCatcher WindowHelper.ts:1464-1510) are never closed, so window-all-closed never fires → dev zombie holding lock, port 5180, DB handles (the exact state the comment says it prevents).
Confidence: high. Dev-only.

## F-115 [P2] Overlay-aux guard loses group listeners on overlay recreate (latent)
Phase: 1 | Area: WindowHelper overlay aux windows
Status: FOUND → RESOLVED-BY-F-108 (re-analysis 2026-08-14; no code change)
Re-analysis: the inconsistent state (overlayWindow nulled while pill/toggle stay alive) requires the overlay close being PREVENTED while its reference is dropped. The overlay's 'closed' handler (WindowHelper.ts:1680-1685) nulls pill/toggle whenever the overlay is actually destroyed, keeping the :1528 guard consistent; every currently-reachable launcher-destruction path (quit post-F-108; macOS Cmd+W between meetings with overlay hidden → close proceeds) destroys the overlay for real. The one concrete trigger — the quit-cancellation sequence — was F-108, now fixed (overlay close proceeds during quit). showOverlay (the only show-without-hiding-launcher path) remains unused by src/.
FOLLOW-UP (hardening): key createOverlayAuxWindows' short-circuit on overlay identity rather than aux existence, so any FUTURE overlay-recreation path re-registers group listeners. Not fixed now per no-hypothetical-fixes rule.
Hypothesis: all group listeners registered only in createOverlayAuxWindows(), which bails at :1528 `if (this.pillWindow || this.toggleWindow) return` — keyed on aux state, not overlay identity. Launcher 'closed' handler (:1125-1128) closes overlay (preventDefault'ed if visible) then nulls the reference regardless → overlay survives unreferenced, aux windows stay alive → next createWindow() builds a new overlay that short-circuits at :1528: no pill/toggle/move-resize sync; stale aux remain AppKit children of the dead overlay.
Trigger: launcher destroyed while overlay visible (macOS launcher has NO close interception — :1068 gates off-darwin; concrete instance today is the F-108 quit sequence).
Disproof: "launcher destroyed while overlay visible" unreachable (showOverlay in ipcHandlers:762 currently unused by src/) — reachability medium.
Confidence: medium.

### Sub-area A areas verified clean
sendToWindow guards every send (main.ts:2126-2135) — no unguarded webContents.send found; macOS weld hide/show asymmetry correctly compensated; content-protection reassert coherent across all five window classes; group-drag re-entrancy sound; single-instance lock loss uses app.exit(0) correctly.
### Sub-area B: IPC contracts / preload (exploration complete)

## F-116 [P2] stealthTapRefreshIme missing from preload — IME re-probe silently dead
Phase: 1 | Area: preload bridge / stealth tap
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Step 1 confirmation: main registers 'stealth-tap:refresh-ime' on all three platform branches (main.ts:1717/:1735/:1747); renderer calls `window.electronAPI?.stealthTapRefreshIme?.()` (NativelyInterface.tsx:7317); electron.d.ts:549 declares it; preload exposes only the other five stealthTap* methods.
Repro: scripts/audit/F-116-repro.mjs — live bridge probe. PRE-FIX: typeof undefined at the real window → exit 1.
Root cause: missing preload link in a three-surface contract; the two existing source-regex tests each pin only one end.
Fix: `stealthTapRefreshIme: () => ipcRenderer.invoke('stealth-tap:refresh-ime')` added to preload impl + interface (with rationale comment).
E2E verification: repro → exit 0 (function, invoked:true against the LIVE darwin handler, returned its real IME decision). Adjacent suites 29/29 (StealthBlockInputFocusGuards, ImeDetectorCache). Pin: PreloadStealthTapBridgeComplete2026_08_14.test.mjs — generic: EVERY renderer-invoked stealthTap* must exist in preload (kills the whole drift class) + channel wiring assert. typecheck clean.
Cross-platform: channel registered on darwin/win32/other — bridge fix serves all.
Commit: (pending — F-111 = e7d41f4b)
Hypothesis: three-way drift — main handler registered on all platform branches (main.ts:1717/:1735/:1747), renderer calls `window.electronAPI?.stealthTapRefreshIme?.()` (NativelyInterface.tsx:7317), declared in electron.d.ts:549, but preload.ts exposes only the other five stealthTap* methods (:2412-2416, interface :777-784) — the `?.()` swallows undefined silently. CJK IME users who add an input source mid-session keep the stale mount-time auto-engage value → tap swallows keystrokes before IME composition (the exact failure main.ts:1704-1719 documents preventing). Two source-regex tests each verify one END (ImeDetectorCache :172 main side; StealthBlockInputFocusGuards :349 renderer side); neither asserts the preload link.
Disproof: alternate spelling/second preload — greps negative.
Confidence: high.

## F-117 [P2] e2eInvoke is an ungated passthrough to all ~349 production channels
Phase: 1 | Area: preload bridge containment
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Repro: scripts/audit/F-117-repro.mjs — two launches. PRE-FIX without NATIVELY_E2E: e2eInvoke exposed AND successfully invoked a production channel (get-meeting-active) → exit 1.
Root cause: the exposure comment assumed NATIVELY_E2E gated the surface; it gates only the __e2e__:* handler REGISTRATION — the channel argument reaches any production handler.
Fix: e2eInvoke now exposed via a conditional spread only when `process.env.NATIVELY_E2E === '1'` (preload reads env); interface made optional; F-118's repro updated to set the env (only consumers are test probes, which already set it — zero shipped-code consumers, verified).
E2E verification: repro → exit 0 (undefined without env; functional with env — probes preserved). F-118 repro re-run PASS under the gate. typecheck clean. Pin: E2eInvokeGated2026_08_14.test.mjs (1/1).
Cross-platform: platform-neutral.
Commit: (pending — F-107 = 5ce9cd87)
Hypothesis: preload.ts:2643-2644 exposes `e2eInvoke(channel, ...args) → ipcRenderer.invoke(channel, ...)` unconditionally; comment claims "no-op in shipped app" but NATIVELY_E2E gates only the `__e2e__:*` HANDLERS (ipcHandlers.ts:12832), not the channel argument. Any renderer code can invoke `quit-app`, `set-openai-api-key`, `delete-meeting`... defeating the curated bridge. No injection vector established (react-markdown; the one innerHTML sink is DOMPurify'd) — containment break, not demonstrated exploit.
Disproof: build-time strip via esbuild define, or main-side channel/sender allow-list — neither found.
Confidence: high.

## F-118 [P2] Live-RAG failure double-signals: error event + fallback → torn UI row
Phase: 1 | Area: ipcHandlers rag:query-live / NativelyInterface
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Repro: scripts/audit/F-118-repro.mjs — fake live-ready RAG manager on the real AppState whose queryMeeting throws a non-fallback error; real handler invoked from a bridge window with an onRAGStreamError subscriber. PRE-FIX: {success:false} return AND {live:true} error event both observed → exit 1.
Root cause: the live catch emitted a terminal error event AND returned the fallback-triggering result; the renderer executes both UI actions (staple error + clear streaming; then stream fallback tokens into the torn row).
Fix: live handler no longer emits rag:stream-error (console.error + comment retained); the {success:false} fallback return owns the UX. Meeting/global handlers unchanged (no fallback exists for those classes — their terminal events are correct).
E2E verification: repro → exit 0 (events:[], fallback return only). Pin: LiveRagSingleSignal2026_08_14.test.mjs (2/2 — live emits none; meeting/global keep theirs). typecheck clean.
Cross-platform: platform-neutral.
Commit: (pending — F-119 = 37acd593)
NOTE (campaign incident, resolved): running bare `npm run build` for F-119's renderer validation triggered `npm run clean`, which deletes dist-electron/ — broke subsequent repro launches until `npm run build:electron` + the native-module symlink were restored. Rule for the rest of the campaign: NEVER run bare `npm run build`; use `vite build` directly if renderer output is needed.
Hypothesis: ipcHandlers.ts:10231-10233 sends terminal `rag:stream-error` {live:true} AND returns {success:false}; renderer error handler (NativelyInterface.tsx:5649-5668) staples `[RAG Error: …]` into the last bubble and clears streaming state, while :5969-5977 reads success:false as "fall through to normal chat" and starts streamGeminiChat into the same torn-down row. Only one signal should fire.
Trigger: live meeting + JIT RAG + provider failure mid-generation (429/network/5xx).
Disproof: a discriminator check dropping {live:true} in onRAGStreamError — none (:5649 destructures only {error}).
Confidence: high.

## F-119 [P2] ollama-error broadcast has zero listeners
Phase: 1 | Area: LLMHelper → renderer error surface
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Step 1 confirmation: LLMHelper.notifyRendererOllamaError (:1832-1837) broadcasts 'ollama-error' from three failure sites (:1791, :1823, :1827); repo-wide the producer was the only reference. The Launcher's pull-status banner union has had a 'failed' state since day one that nothing ever set — the intended surface existed, unwired.
Repro: scripts/audit/F-119-repro.mjs — PRE-FIX (stale bundle): typeof onOllamaError === 'undefined' at the live bridge → exit 1. POST-FIX: bridge exposes it AND a real main-side 'ollama-error' broadcast reaches a renderer subscriber with payload intact → exit 0.
Root cause: producer-only channel; missing preload link + missing renderer consumer.
Fix: preload `onOllamaError` (subscribe/unsubscribe sibling pattern) + interface + electron.d.ts entry; App.tsx consumes it into the existing banner's 'failed' state (8s auto-dismiss), registered/cleaned alongside the pull listeners. LLMHelper untouched (its foreign in-flight diff also untouched).
E2E verification: repro pre/post as above; vite renderer build clean; typecheck:electron clean. Pin: OllamaErrorReachesRenderer2026_08_14.test.mjs (2/2 — preload wiring + App.tsx consumption).
Cross-platform: platform-neutral.
Commit: (pending — F-116 = 4d2726bf)
Hypothesis: LLMHelper.ts:1837 (notifyRendererOllamaError, from fallback-failure path :1827) broadcasts 'ollama-error' to every window; no ipcRenderer.on('ollama-error') in preload, no onOllamaError anywhere in src/. When Ollama is down AND fallback fails, the deliberate user-facing notification goes nowhere — user sees a hang. Pre-existing (not from in-flight diff).
Disproof: dynamic-channel listener — preload's only variable-channel on() is PROCESSING_EVENTS.*, which lacks ollama-error.
Confidence: high.

## F-120 [P3] Orphan broadcast channels (settings sync + embedding degradation invisible)
Phase: 1 | Area: bridge drift
Status: FOUND → CONFIRMED → REPRODUCED → FIXED-VERIFIED (embedding half); FOLLOW-UP (settings-sync half)
Repro: scripts/audit/F-120-repro.mjs — PRE-FIX: onEmbeddingDegraded undefined at the live bridge → exit 1. POST-FIX: both channels ('embedding:fallback-activated', 'embedding:space-persist-failed') reach a renderer subscriber with payloads intact → exit 0.
Fix (embedding half): preload onEmbeddingDegraded (one subscribe method, discriminated kind, unified unsubscribe — sibling pattern of onIncompatibleProviderWarning); App.tsx surfaces both via the generic status banner (fallback → "Semantic search degraded: switched to fallback embeddings (…)"; persist-failed → "may need a re-index"); electron.d.ts entry.
E2E verification: repro pre/post; renderer `tsc --noEmit` clean; `vite build` (direct — NOT `npm run build`) clean; electron typecheck clean. Pin: EmbeddingDegradationSurfaced2026_08_14.test.mjs (2/2).
FOLLOW-UP (settings-sync half, deliberate non-fix): `code-verification-changed` (ipcHandlers) still has no consumer — wiring it requires a Settings-window cross-window state-sync design decision (which surface re-reads the toggle); logged for the Settings phase (Phase 7).
Commit: (pending — F-121 = 2d37a99f)
`code-verification-changed` (ipcHandlers.ts:5473), `embedding:fallback-activated` (EmbeddingPipeline.ts:512), `embedding:space-persist-failed` (EmbeddingPipeline.ts:655) — one producer each, zero consumers. Settings toggle never propagates to other windows; silent embedding degradation invisible despite a working banner pattern for sibling channels (preload.ts:2314-2342).
Confidence: high.

## F-121 [P3] Dead bridge surface (drift generator)
Phase: 1 | Area: preload/ipcHandlers
Status: FOUND → CONFIRMED → FIXED-VERIFIED (hazard half); FOLLOW-UP (inert half)
Reproduction evidence: the repo's own SkillsIpcWiring.test.mjs already enforces "every preload invoke channel has a handler" and had to GRANDFATHER 'toggle-advanced-settings' in a KNOWN_STALE set explicitly labeled "renderer invokes silently reject — pre-existing tech debt, separate cleanup". This is that cleanup.
Fix: deleted the dead toggleAdvancedSettings preload method (impl + interface) and its electron.d.ts entry (zero call sites, verified); emptied KNOWN_STALE so the bridge invoke↔handler contract test is now exemption-free and absolute.
E2E verification: SkillsIpcWiring 21/21 with the empty exemption set (also re-validates F-116's addition and every other channel pairing); typecheck clean.
FOLLOW-UP (inert half, deliberate non-fix): the dead curl-provider CRUD handler cluster (ipcHandlers.ts:7299-7365 — save/get/delete-curl-provider, switch-to-curl-provider, switch-to-custom-provider; no preload invoker) is handlers-without-callers — no silent-failure hazard, and ipcHandlers.ts carries foreign in-flight provider work; deletion deferred to avoid collision.
Commit: (pending — F-113 = 73bc4f03)
`toggle-advanced-settings` invoked by preload (preload.ts:1334) with no main handler (silent "No handler registered" for future callers). 20 handlers with no preload invoker, incl. the dead duplicated curl-provider CRUD set (`save/get/delete-curl-provider`, `switch-to-curl-provider`, `switch-to-custom-provider`) alongside the live custom-provider set (preload.ts:2142-2144).
Confidence: high.

## F-122 [P3] rag:stream-* discriminator populated at every send site, read at none
Phase: 1 | Area: RAG streaming IPC contract
Status: FOUND → CONFIRMED (contract defect) → NOT-REPRODUCED (no user-visible harm path) → FOLLOW-UP
Disposition: the discriminator drift is real (three payload shapes on one channel; preload type omits `live`; all three consumers destructure {chunk} only), and MeetingChatOverlay/GlobalChatOverlay are mount-simultaneous siblings — but no user path forcing overlapping different-class in-flight queries was established (both surfaces clean their listeners in finally, and abortPriorRAGQueriesOfClass supersedes within each class). Per campaign rules (no fixes without reproduction), logged as FOLLOW-UP: consumers should filter by their own scope discriminator, and preload's union should gain `live`. Note: F-118's fix removed the live error emission, shrinking the cross-talk surface further.
Main emits {meetingId,chunk} / {live:true,chunk} / {global:true,chunk} on one channel (ipcHandlers.ts:10137/:10212/:10258); preload type omits `live` (preload.ts:2345); all three consumers destructure {chunk} only (NativelyInterface.tsx:5601, GlobalChatOverlay.tsx:246, MeetingChatOverlay.tsx:342). MeetingChatOverlay and GlobalChatOverlay are siblings in the same Launcher renderer and abortPriorRAGQueriesOfClass supersedes only within a class → cross-class cross-talk possible; no user path forcing overlap established (honest: contract defect, not demonstrated cross-talk).
Confidence: high (contract) / low (user-visible harm).

### Sub-area B disproved during exploration
`unguarded-event-sender-send` — 30 unguarded event.sender.send sites are all contained: sendChunk→sendChunkGated→onToken is awaited inside raceStreamWithDeadline (liveDeadlines.ts:273), so destroyed-sender throws become handled invoke rejections, never reaching the unhandledRejection→emergencyCloseDatabase escalation.

### Sub-area B areas verified clean
345/346 invoke channels have handlers; no duplicate registration (safeHandle/safeOn remove first); preload listener add/remove symmetric (net +1 is a module-scope singleton); contextIsolation+nodeIntegration correct on all five window classes; single exposeInMainWorld; streaming supersession (_chatStreamsBySender + streamId + abort) sound incl. cancellation; uncommitted ipcHandlers/LLMHelper diffs check out (usage instrumentation idempotent via terminated flag).

---

## Phase 1 read-only audit pass — COMPLETE (2026-08-14)

22 candidate findings: 2 P0, 5 P1, 9 P2, 5 P3, 1 already INVALID (F-101).

## PHASE 1 SUMMARY (2026-08-14)

22 candidate findings → all processed through the per-finding lifecycle.

| Outcome | Count | Findings |
|---|---|---|
| FIXED-VERIFIED (live repro + fix + pin + commit) | 16 full + 2 partial | P0: F-108, F-109 · P1: F-102, F-103, F-104, F-105, F-110 · P2: F-106, F-107, F-111, F-113, F-116, F-117, F-118, F-119 · P3: F-112, F-120 (embedding half), F-121 (hazard half) |
| INVALID (disproved in Step 1) | 1 | F-101 (rubato 0.16.2 error branch unreachable) |
| RESOLVED-BY-OTHER-FIX | 1 | F-115 (only trigger was F-108's quit-cancellation state) |
| BLOCKED-ON-PLATFORM | 1 | F-114 (win32-only branch; fix proposed, needs Windows session) |
| FOLLOW-UP only (no repro of user harm) | 1 | F-122 (discriminator drift; surface shrunk by F-118) |

Commit ledger (branch audit/autopilot-2026-08-14, oldest first):
a9d7ea42 F-108 · e5d72c33 F-109 · d41af23d F-103 · 0d0740fe F-102 · 0d72316a F-104 · f71dc4c8 F-105 · 7317b459 F-110 · d93ff582 F-106 · e7d41f4b F-111 · 4d2726bf F-116 · 37acd593 F-119 · 3ae78552 F-118 · 5ce9cd87 F-107 · 5bd61d39 F-117 · 6fb8fdcf F-112 · 73bc4f03 F-113 · 2d37a99f F-121 · a335fe06 F-120

Open FOLLOW-UPs from Phase 1 (carried forward): F-101 store-back hardening (rust); F-109 SIGHUP-closes-DB-without-exit; F-107 boot arch gate for native-module (Phase 7); F-111 startup sweep of screenshot leftovers; F-115 aux-guard identity keying; F-120 code-verification-changed settings sync (Phase 7); F-121 dead curl-provider handler cluster; F-122 scope filters + preload union.

Validation posture (per CLAUDE.md categories): every fix Tested physically on macOS via its repro script against the real app or the repo's harnesses; Covered by automated tests via per-finding pins/suite tests (18 new test files); Reviewed but not executed on Windows — all fixes are platform-neutral orchestration/bridge changes; no Windows-only branch was modified (F-114, the one win32-only finding, was deliberately left unfixed). Requires physical Windows verification: full quit flow (F-108), capture rebuild flows under WASAPI (F-102/104/105/106/107), F-114's proposed fix.

Full-suite regression (clean run, 2026-08-14, worktree = HEAD + foreign in-flight work): 7433 tests, 7244 pass, 127 fail, 62 skipped. All 18 audit test files PASS inside the suite. The 127 failures cluster in areas untouched by the audit (Codex CLI service, credentials/keyring, SettingsOverlay source-regex, Modes migrations, KnowledgeOrchestrator, Hindsight, pdf-parse handlers) and match the historically red baseline (~120 fails as of 2026-08-11). The one suspicious-looking name ("B5: dev-mode TCC bypass" — main.ts machinery) was verified: its extractFunctionBody helper returns an identical 23-char truncated body on the PRE-AUDIT commit (c2ad3133) and the current tree — a pre-existing test-harness defect, not an audit regression (candidate finding for a later cleanup pass: the test's function-body extractor matches the wrong occurrence).

Processing queue (severity order):
1. F-108 [P0] overlay close cancels quit — Step 1 CONFIRMED, Step 2 in progress
2. F-109 [P0] child-process-gone kills DB permanently
3. F-102 [P1] orphan capture double-writes STT
4. F-103 [P1] route change permanently lost
5. F-104 [P1] unawaited destroy races fresh monitor
6. F-105 [P1] mic start() throw kills system channel
7. F-110 [P1] init failure leaves lock-holding zombie
8. F-106..F-119 [P2], then P3s (F-112, F-114, F-120, F-121, F-122)
