# Answer-quality loop with the external judge (gpt-6-astra) — iteration log

Branch `fix/aq-astra` (from main `61bb0956`). Engine worktree `.claude/worktrees/aq-fix`; baseline app worktree
`.claude/worktrees/aq-astra` (detached, code = main + harness only).

## Judge status

| when (UTC) | step | result |
|---|---|---|
| 2026-09-30 06:48 | `GET https://co.agentrouter.org/v1/models` (Bearer, key from `.env` var `AGENTROUTER_API_KEY`, 51 chars, `sk-`) | **401 `{"code":401,"msg":"Invalid API Key!"}`** |
| 06:48 | `POST https://co.agentrouter.org/v1/chat/completions` model `gpt-6-astra` | 401 Invalid API Key |
| 06:48 | `https://agentrouter.org/v1/*` (alternate host) | 401 `unauthorized client detected` (a client allowlist; not bypassed by design) |
| 06:56, 07:39 | `astra/probe.mjs` re-probes | 401 Invalid API Key |

`gpt-6-astra` availability could not be checked. **No substitute judge was used.** Every keep/revert below is
therefore provisional on objective evidence only (deterministic validators, evidence-reaching-prompt, lexical
classes, latency); the external judge runs are queued (see "Pending judge runs").

## Harness added (commit 238e3244 + follow-ups)

* `astra/` — client (retries, jittered backoff, concurrency, key scrubbing, model-identity capture), probe gate,
  charter (spec §25 system prompt verbatim + §26 mode contracts + §27–§33), evidence envelope + mechanical oracle,
  official score (§30 caps, §31 weights, validator failures cap), blind absolute judge with cache + one JSON repair,
  blind pairwise A/B with private label mapping (`ab.mjs`), calibration gate (`calibrate.mjs`, 20 pairs, ≥18 required).
* `validators/` — spoken-number normaliser, check language, lexical detectors (epistemic, source exposure, coaching,
  meta). Oracle sidecars: `dataset/oracles-objective-v1.json` (22 items, dev/holdout/final), `oracles-conflict-dev-v1.json`.
* `tools/` — `replay.mjs` (exact recorded prompts → same model, optional transform, N samples), `compare.mjs`,
  `redetect.mjs`, `show.mjs`.

## Iterations

### I1 — small reference corpus is read whole (b4e9f29c)
* Root cause: retrieval/probe. ~10% of reference-file turns never put the answering text in the prompt (final 20/188,
  holdout 6/64, dev 10/86): FAST path when the small-pool probe found one content word ("What's the crash-free bar?"),
  and chunk choice dropping the answering chunk ("What would Enterprise run us?").
* Change: corpus ≤ 1,400 tokens → port returns every file whole, no embed/rerank; FAST turns read it without a claim
  (the Seminar/Lecture source-primary rule, now for any mode with a small corpus); plan budget holds it.
* Tests: SmallReferenceCorpusReadWhole (21), intelligence suites 2727/0, retriever-seam fixtures opted out.
* Decision: provisional keep — pending in-app dev run (needles→prompt) and judge.

### I2 — arithmetic turns work it out first, hidden (ccceeebb)
* Root cause: set-up errors in live arithmetic (gap vs half-gap; per-warehouse vs total gateways) that an
  expression checker on the spoken answer cannot see.
* Evidence (replay of recorded prompts, deepseek-flash, 6 samples × 9 items, deterministic validators):
  as prompted 23/54, "double-check" line 29/54, hidden named-step scratch 43/54.
* Change: `calculationNotice` (quantity ask + ≥2 figures, never code/complexity) → `[[CALC]]` block; transport-level
  `StreamingCalcFilter` in `_streamChatTracked` (every surface), tolerant of `[/CALC]` drift (10/54 replays);
  `verifyCalcScratch` observe-only with a recursive-descent parser (no eval).
* Caveat: FGENH-008 / FSALES-001 / FCC-005 are FINAL-set items named by the reviewer and were used for diagnosis;
  tuning continues on the blind supplementary set `supp-quant`.
* Decision: provisional keep — pending in-app latency (hidden tokens delay first visible token) and judge.

### I3 — the user's own life is remembered, not checked (8c0ba3f2)
* Root cause: the no-context rule's status/commitment half ("what they would check") applied to biography.
* Evidence (replay, dev LFW, 3 samples): epistemic/source-exposure phrasing 12/120 → 4/120; résumé cited as a
  document 6 → 0; no rise in claimed specifics on no-profile turns; Recruiting unchanged (20 vs 20 across repeats).
* Also: gap questions route to the heard-commitment notice (invented "deliberate pause" reasons).
* Decision: provisional keep — pending judge (naturalness vs truthfulness trade-off is subjective).

### I4 — the recruiting hotkey is the interviewer's spoken words (35d548bf)
* Root cause: the recruiting contract asked for "at most one short observation" before the probe on the spoken
  surface too.
* Evidence (replay, dev Recruiting hotkey probe answers, 3 samples): coaching/meta wrappers 18/66 → 2/66; typed
  asks keep the advisor overlay.
* Decision: provisional keep — pending judge.

### Rejected — conflict wording ("two values within one document")
* Replay on dev Seminar/Lecture + conflict items: no change (dev Seminar conflict items already pass; remaining
  dev failures are retrieval/expiry). Not made.

## Pending judge runs (execute when the probe passes)
1. `node astra/calibrate.mjs` (must be ≥ 18/20).
2. Absolute: `astra/judge.mjs --set cur --runs results/aq2-dev-cur` and the fix run(s); holdout/final later.
3. Pairwise: `astra/ab.mjs --set dev-cur-vs-fix --a results/aq2-dev-cur --b results/<fix run>`; ×3 on borderline items.

## Environment caveat (found 2026-09-30 07:50Z)
Both app worktrees (`aq-astra` baseline, `aq-fix`) lack the downloaded ONNX weights for the bundled local embedder
(`resources/models/Xenova/multilingual-e5-small`), and with only a DeepSeek key there is no cloud embedder. Every
reference-file index logged `file was not found locally` (baseline app log: 854 lines), so **both runs retrieved
lexically only**. The current-vs-fix comparison is like-for-like, but a packaged build ships the weights: in
production the baseline's chunk retrieval would be stronger than measured here, so the small-corpus gain (I1) is
likely overstated by this setup. Not changed mid-experiment, to keep the pair comparable.

### Rejected — past-event/reason notice ("why did you leave", "what happened in the gap")
* Root cause of the class: the heard-commitment notice fires (verified in the DJOB-012 prompt) but its guidance
  ("open or conditional, naming what they would weigh") fits preferences, not a past fact, so the model supplies one.
* Variant: a separate notice — no reason/activity/characterisation; say what the evidence records as memory; if
  nothing, one short opener and stop. Replay, 5 samples each on DJOB-004/012/037 (dev) and SBJOB-007/012 (blind):
  invented-reason proxy unchanged or worse (DJOB-012 5/5 → 5/5, SBJOB-012 4/5 → 5/5), and DJOB-037 regressed to
  "The résumé has… I don't have the details". Not shipped.
* **Architectural blocker:** the model's prior to supply a motive for "why did you leave / what were you doing"
  survives every prompt formulation tried. Proposed design (not implemented): a deterministic personal-reason
  route in LFW/TI — when the classifier sees a USER_* reason/past-event claim AND profile retrieval returns no
  evidence for it, skip generation and render a short truthful opener (or a private one-line cue on the typed
  surface). Needs: a precise trigger (false positives would silence real answers), product sign-off on showing a
  near-empty answer, and judge A/B against the current behaviour.
* Also observed: the bridge strip (planningPreamble "no-story bridge", parked as a patch until the fix1 runs end)
  cut blind LFW/TI epistemic phrasing from 8 to 4 of 84 replayed answers on top of the prompt rules.

### Regression found in I3 (own-life rule) — scope it to LFW/TI (queued as I5)
* DTEAM-009 (Team Meet, colleague: "You did a payments migration at your last company, right? How long did it
  take?", no evidence): replay 6 samples — without the rule 0/6 denials; with the shipped rule 6/6 "I don't have a
  payments migration in my background" (an invented negative claim). The old answer ("let me pull the actual
  timeline from that migration") presumes the premise, which the colleague stated; the denial is worse.
* Tried and failed: adding "no denial" to the rule (6/6), triggering the existing experience notice (6/6).
* LFW/TI do not show it (DJOB-006/014 0/6, DTECH-017 1/6 either way).
* Decision: scope the rule to looking-for-work and technical-interview (where it was measured to help). Applied
  after the fix1 chain (the running app must stay = c3e951f3), together with the parked no-story bridge strip.

## Run-integrity incidents (2026-09-30)
* 08:07 and 08:34 UTC: every Electron dev instance on the machine received `user-quit` (not a crash) while other
  sessions were building/testing; cause outside this session. tools/supervise.mjs now restarts and resumes.
* After the first restart the saved DeepSeek key was loaded at startup, so Profile Intelligence extraction switched
  from the deterministic heuristic (baseline, all runs so far) to the LLM path — ~7-minute profile switches and
  different structured profiles. 68 post-restart LFW/TI rows of aq2-dev-fix1 were moved to
  `results/aq2-dev-fix1/moved_llm_pi_rows.jsonl` and re-run; the supervisor now wipes userdata before every start
  (`--fresh-userdata`), so every row runs with the baseline's extraction mode.
* The disk fell to 2.4 GB free (other sessions); the idle baseline build output was deleted (rebuildable).

### I5 — own-life rule scoped to the job modes + no-story bridge strip (44418214, branch fix/aq-astra-i5)
* Own-life rule emitted only for looking-for-work / technical-interview (Team Meet denial regression, above).
* planningPreamble removes a pure leading "I don't have a specific story…, so let me…" bridge (blind replay: LFW/TI
  epistemic 8 → 4 of 84 on top of the prompt rules).
* Tests: OwnLifeRule 18, NoStoryBridge 11, intelligence 2743/0, llm 5372/0. In-app runs aq2-dev-fix2, aq2-sb-fix2.
* aq2-dev-fix1 keeps 12 llm-extracted rows (DSALES-005/006/009, DREC-006/022/023, DTEAM-009/010/011,
  DLEC-008/009/010): all are PI-leak probes in modes that must not read the profile at all, so the extraction mode
  cannot legitimately affect them. Extraction mode proved not fully deterministic even on a fresh start (first LLM
  extraction can succeed), which is a harness caveat for PI-mode comparisons.

## External judge (gpt-6-astra) — batch 2026-09-30 11:00 UTC
* Probe 11:00:16Z: models list contains gpt-6-astra; chat 200, `returned_model: gpt-6-astra`, content at
  choices[0].message.content, usage incl. reasoning_tokens (~1,300 per pairwise call; ~43 s latency).
* Some routes reject `temperature: 0` (400 "Only the default (1) value is supported"); per spec §19 the client drops
  only that parameter and retries; each stored call records `temperature` / `temperature_dropped`.
* Calibration: **19/20** (gate ≥ 18) — all 19 judged pairs correct and decisive/clear; the one miss (CAL-07) was the
  temperature API error, not a wrong preference.
* First absolute read, dev set (I5 = aq2-dev-fix2, 360/360 judged): General 7.91, Sales 6.93, Recruiting 8.58,
  Team Meet 8.76, Looking for work 6.73, Lecture 8.86, Technical interview 8.09, Seminar 8.55, Call Center 6.35;
  ALL 7.86. Ration exhausted 11:58Z (402); aq2-dev-cur absolute 232/360, A/B dev 233 pairs.
* **Ceiling finding.** Even the answers with no hard flag and no cap average 9.0–9.4 per mode (General 9.01,
  Team Meet 9.09, Seminar 9.15, LFW 9.21, Sales 9.30, TI 9.37, Recruiting 9.37, Lecture 9.38, Call Center 8.61).
  9.5 per mode therefore needs BOTH near-zero hard fails AND a better typical answer; removing invented claims
  alone cannot reach it.

### I6 — a heard question about the user's own life (791eb9e8, 00c6565e)
* General/Sales/Team Meet/Call Center: personal-life notice with claim-free example shapes (game/show branch needs an
  event object). In-app run aq2-dev-fix3 (with I7).

### I7 — no product material → no product facts (a8afe122)
* Sales/Call Center with nothing attached: no price, discount, refund, credit, feature, integration, customer base,
  ROI, timeline, guarantee, SLA or term; "whether we connect", never "how the integration works".

### I8 — claim verifier after the stream (electron/llm/claimVerifier.ts)
* Why: four prompt formulations moved invented-claim hard fails by 0–0.5 points; a second pass that sees the
  answer's own material moved them offline (judged: Sales 6.93 → 8.29, hard fails 18 → 5; LFW 6.73 → 7.5–7.8).
* Gate: LFW, Sales and Call Center every turn; TI, Seminar and General when the question is personal OR the draft
  itself speaks about the speaker's past ("I've", "I built", "in my experience", "my co-authors", "we migrated") —
  judged failures DTECH-017 / DSEM-019 invented history on non-personal questions. On the I5 hotkey answers the gate
  fires TI 8/29 (covers 6/6 judged claim failures), Seminar 4/32 (3/4), General 7/19 (7/8). Never code answers,
  sentinels, non-V3 turns. Kill switch NATIVELY_CLAIM_VERIFIER=0.
* Both surfaces: hotkey (IntelligenceEngine, replayed answer call) and typed manual chat (ipcHandlers V3 path,
  V3 user message as material, typed prompt wording, skipped on screenshot turns). Typed claim failures on I5:
  Sales 4, Call Center 5 (typed turns cost those modes 0.88 and 1.0 points of the mode mean).
* Call: the answer's replayed call (same model/route/material) under the verifier system prompt, TOTAL budget
  3.5 s (6 s with a screenshot), fail-open. Rails: non-empty, ≥25% of the original, no code, no echoed prompt, no
  number absent from answer+material, no introduced epistemic line, no introduced denial; an edited body drops the
  stale [[GIST]] chip (a missing chip is not penalised; a stale one can repeat a removed claim).
* Rails vs the offline edits that produced the gain: 2/120 rejected, both correctly (an introduced "I can't speak
  to…", and a [[CALC]] block that the stream filter would strip anyway). Offline edit latency p50 ~0.8 s, p90 1.2 s.
* Replace-after-stream: TTFT unchanged; the final text can differ from what streamed (existing repair contract).

### I9 — two coding-contract misroutes (planner)
* Recruiting heard turns never plan as coding/DSA (the candidate saying "production code" or "queue depth" is not a
  task): DREC-017 7.0, DREC-025 7.5 were both routed to the coding contract and came back as advice.
* `check if` needs a data object within 60 chars ("check if my dog's okay" — DCC-012 — was a coding problem).
* Committed 323b7aa4 (branch fix/aq-astra-i5, aq-fix2). In-app run aq2-dev-fix4 + aq2-sb-fix4 (fresh userdata).
  First in-app outcomes: edits 535–800 ms, no timeouts in the first 22 checks.

### I10 — Call Center: a gated ask gets the rule, then the verification (promptSystemV2 call-center mode)
* Judge: DCC-018/027/028/029 repeated the identity checklist and never said the refund/credit/goodwill rule.
* Replay (40 CC items ×2, tools/variants/cc-answer-v1.mjs): the answers state the 30-day refund / warranty
  replacement rule and the $20-per-12-months goodwill cap before asking to verify; words 56 → 63.

### I11 — TODAY line (prompt-composer), only when the material mentions a date
* The prompt had no date. Alone it barely helped (replay today-v1: expired-sheet answers 0/3 → 0/3; DJOB-018
  tenure "two years" → "about five"); kept as the base for I14.

### I13 — Team Meet: ask or propose the check, never narrate access
* Judge: DTEAM-006/021/027/028 "mainly explains why it cannot answer" (8.0–8.3); lexical epistemic 8/40, and in a
  chain the next answers copy the phrase from the user's own prior line. Replay tm-no-access-v1: epistemic 18 → 12
  of 80 (replay keeps the recorded prior lines, so chains understate it).

### I14 — document freshness statuses (mode-retrieval-port detectDocumentStatus + precedence contract)
* expired (validity date passed), outdated ("check … current version before relying"), draft only with an
  unreviewed/unapproved marker. Old "last updated" dates and a thesis "draft" / a spec "v0.3 DRAFT" are NOT marked
  (the user's own material; first version flagged them and was narrowed). expired/outdated rank with retired.
* Across all dataset contexts: dev conflicting 3 of 9 marked; 0 grounded marked except FTECH-CTX-G2, which already
  declares "Status: draft".
* Replay freshness-v1 (I11+I14) on 16 conflict items ×3: DSALES-023 0/3 → 3/3, DSALES-024 0/3 → 3/3, DSALES-026
  0/3 → 2/3, DJOB-032 1/3 → 3/3, DTEAM-024 0/3 → 2/3 naming the stale/draft source.

### I9+I10+I11+I13+I14 → one app run (aq2-dev-fix5): different modes/sections; attribution by mode and A/B.

### I8 in-app (aq2-dev-fix4, build 323b7aa4 = I8 only) — objective read, judge pending
* Verifier: 107 edited / 52 unchanged / 1 rejected (too_short) of 160 gated turns; p50 807 ms, p90 992 ms, max 1.2 s.
* Total latency on gated modes +0.7–0.8 s (Sales p50 1177 → 1986 ms, CC 1127 → 1908, LFW 1632 → 2285); TTFT unchanged.
* Validators (after the number-scale fix): fix3 8/9, fix4 6/9 — the two extra fails are not the verifier's: DSALES-023
  already lacked the $300 add-on in the streamed text (fix3 passed it by sampling), DTEAM-034 is not a gated mode.
* Found: the verifier dropped **highlights** (DSALES-023's only "edit"). Fixed in 73156d89 (I8c): keep highlights; a
  formatting-only edit ships the original.
* I8b (f7f70a16): Sales/CC with no evidence block — product statements unsupported unless the conversation states
  them. Offline on I5 Sales/CC: 46/80 edited (44). DSALES-001 ("what does it do day to day?") still keeps capability
  sentences: the verifier will not empty an answer.
* fix5 = 2943c1be (I8 + I8b + I9 + I10 + I11 + I13 + I14); I9 amended so an explicit coding ask heard in Recruiting
  ("solve two sum in python") keeps its routing (W1-5 invariant). llm 5604/0, intelligence 2783/0.

### Generator ceiling (prepared, judge pending)
* The I5 dev prompts replayed through deepseek-v4-pro (results/replay/dev-fix2-pro.jsonl) and deepseek-flash
  (dev-fix2-flash.jsonl), 360 each, same params. v4-pro full-response p50 5.2 s vs flash 1.2 s; words 59 vs 68.
* supp-behavior objective: cur 9/9, fix2 8/9, fix4 8/9; epistemic 8 → 6 → 5. The one fail (SBLEC-002) is the
  handout's own error ("SE = 12 / 36 = 0.33") present in BOTH baseline and fix prompts; the baseline passed by
  sampling. A heard STATEMENT of a computed figure ("comes out to about a third of a minute") never triggers the
  calculation step (asks only). Candidate class for a later iteration; not tuned on this blind item.

### Run-integrity incident: network outage during aq2-dev-fix5 (2026-09-30 ~14:40Z)
* 52 rows (run order 195–277, Lecture/TI mostly) got no real answer: 27 "Connection error." (success=false) and 25
  of the APP'S OWN canned lines ("The answer didn't come through from the AI provider. Press again to retry.") that the
  app reports as success. First re-run pass only caught the 27; the canned ones were found by their 5 s TTFT.
* Harness fixed (f865e919): run.mjs --resume sets failed rows (either kind) aside with their chains and re-runs them;
  the supervisor keeps resuming while any remain. No other run had any such row (checked all aq2 runs).
* Decision: fix6 (= fix5 + I8c + I15, clean full run) is the dev candidate for the judge; fix5's supp-behavior 9/9,
  supp-quant and holdout 2/2 runs were clean and stand for the same code minus I8c/I15.
* fix5 objective (excluding the outage rows): Sales conflict validators 3/3 (fix2 2/3, fix4 1/3) — freshness statuses
  work in-app; supp-behavior 9/9 (fix2 8/9).

### I13 did not work in-app; I15 replaces it (f0cf5ad6)
* Team Meet epistemic lines fix4 7 → fix5 10 of 40 with the I13 clause in the prompt (the clause quoted the phrases it
  forbade). A non-quoting rewording (tm-no-access-v2) replayed 23 → 21 of 120: wording is not the lever.
* I15 strips a leading notes/records sentence in spoken Team Meet / Recruiting replies when what follows asks or
  proposes the check and the sentence carries no commitment of its own (fix5 dev: 9 TM + 1 REC would change; DREC-031/
  032, DCC-036, DTEAM-014 excluded as measured false positives).

### fix6 objective read (all clean, 0 failed rows)
* dev: validators 8/9 (after the stale-sheet oracle fix; fix2 7/9), epistemic 23 → 11 (Team Meet 8 → 3), coaching 2 → 0,
  TTFT p50 875 → 854 ms, total p50 1282 → 1555 ms (verifier on the gated modes).
* supp-quant validators: cur 25/32 → fix1 29 → fix5 29 → fix6 31/32. supp-behavior 8/9 (SBLEC-002 handout error),
  epistemic 6 → 3. holdout 2/2, epistemic 14 → 8, total p50 1372 → 1483 ms.
* Final set (1038) run on fix6 started 18:25Z as a measurement only (no per-item inspection; used for the final
  regression once the judge has read dev/holdout).

### Inconclusive — "use the specifics" (tools/variants/specifics-v1.mjs), not built
* Judge's suggestions on uncapped sub-9.5 I5 answers: 47 of 131 ADD a specific the material held (±0.3, 92.0%, 48-hour
  wait, 3–5 business days, v6.3 + clear cache, 10 business days); 15 cut; 56 replace wording.
* Replay on fix6 prompts (evidence-bearing items, n=2 per arm): dataset needles in answers 312 → 327 of 522, but Call
  Center 27 → 23 and Lecture 30 → 27. Within sampling noise; not worth judge budget yet.

### Final set on fix6 (aq2-final-fix6, 1038 rows, 0 failed) — AGGREGATE ONLY, no per-item inspection
* vs the previous campaign's final run (aq-final-fix2 @ d327f6a8): validators 10/16 → 14/16; reference needles in
  prompt 168 → 185/188; epistemic 85 → 51; coaching 31 → 17; TTFT p50 889 → 728 ms; total p50 1279 → 1374 ms.

### Latency from the recorded runs (2026-09-30 23:20Z) — astra/out/latency/existing-runs.md
* Runs were hours apart (network drift not controlled; a paired run is the stronger read).

| set | baseline → fix6 | TTFT p50/p95 ms | total p50/p95 ms |
|---|---|---:|---:|
| dev 360 | aq2-dev-cur → aq2-dev-fix6 | 990/2020 → 854/1337 | 1495/2828 → 1555/2753 |
| holdout 270 | aq-holdout-fix2 (= main code) → aq2-holdout-fix6 | 964/1648 → 778/1360 | 1438/2607 → 1483/2805 |
| final 1038 | aq-final-fix2 → aq2-final-fix6 | 889/1371 → 728/1194 | 1279/2046 → 1374/2401 |
| supp-behavior 72 | aq2-sb-cur → aq2-sb-fix6 | 934/1595 → 889/1307 | 1241/2809 → 1562/2709 |
| supp-quant 32 | aq2-sq-cur → aq2-sq-fix6 | 1097/1677 → 1120/1516 | 1595/4317 → 1859/3759 |

* Per mode (dev), total p50: Call Center 1223 → 1984, Sales 1313 → 2004, LFW 1823 → 2429 (the verifier's modes);
  Recruiting 1239 → 1020, Team Meet 1330 → 1192, Lecture 1595 → 1334, Seminar 1728 → 1352.

### What the user sees when the verifier edits (hotkey path) — a trade-off to report, not hide
* The draft streams as usual; the verified text replaces it on the final event (NativelyInterface
  onIntelligenceSuggestedAnswer → finalizeStreamingByIntent). The judge scores the replaced text.
* fix6 dev hotkey turns whose visible text changes after the stream: 75 of 245. The swap lands 0.74–1.0 s after
  the last token (p50 by mode). LFW 28 of 32 turns change, first changed word p50 = 15 (10 change within the first
  8 words); Call Center 14/30 (p50 word 21); Sales 10/28 (p50 word 3, 7 within 8 words); Team Meet 3/28 (I15 strip:
  word 0 by design, but that strip is deterministic and lands with the stream's end, 0 ms).
* A user who starts reading aloud at the first token has spoken roughly 3–6 words by the swap, so edits past the
  first sentence are usually seen before they are said; LFW/Sales edits in the first sentence may already be spoken.

### I16 — verifier hands back a question only when nothing answers (aq-fix2 57e21fdf), run aq2-dev-fix7
* Why: the hand-back clause carried an example and was over-applied. fix6 LFW answers ending in a question 3 (fix2)
  → 18 of 40, 12 appended by the verifier, some copying the example verbatim ("I'd want to talk that through
  properly. What does the timeline look like on your side?"), also on "tell me about yourself".
* Replay on fix6's own drafts (tools/verifier-replay.mjs --draft raw): appended questions LFW 14 → 3, Sales 1 → 0,
  Call Center 3 → 1; edit rates unchanged (LFW 33 → 30 of 40, Sales 14 → 22, CC 23 → 26 — sampling).
* In-app fix7 (6 verifier modes, 240 rows, 0 failed): LFW appended questions 12 → 1, LFW answers ending in a question
  18 → 8; validators Sales 3/3, General 1/1, Seminar 2/2 unchanged; LFW total p50 2429 → 2140 ms, CC 1984 → 1875.
  Call Center "+Q" 2 → 5 is not appending: the verifier dropped a trailing product claim after an existing question.
* Judge: replay read queued (queue3 tier 3, control = fix6 in-app on the same drafts), in-app fix7 in the last tier.

### Paired same-time latency (partial) + run-integrity incident 2026-10-01 00:42Z
* Baseline (aq-astra, main 61bb0956) and fix7 (aq-fix2 57e21fdf) answered the same dev items at the same time
  (`tools/latency-paired.mjs results/lat-cur-1 results/lat-fix7-1`). 35 paired rows before the incident:
  TTFT p50 661 → 640 ms (median per-item Δ −67), total p50 971 → 1117 ms (median Δ +109); Sales total median Δ +842,
  LFW +490 (n=3), General −114, Recruiting +109, Team Meet −43.
* Incident: two Electron apps + two electron builds at once pushed the load average past 9 and the user session went
  down at 00:42Z — every process of the session was killed (both apps, both supervisors, the two `nohup` judge
  chains, the user's own apps). Evin: "dont run too many session making the lap turn off".
* Rule from here: ONE app instance at a time, no parallel builds. The paired run is not repeated; the latency
  deliverable is the recorded runs + these 35 paired rows.
* Judge chains re-armed with `astra/arm.mjs` (own session via detached spawn, wall-clock sleeps): 0200 and 1100.

## External judge — batch 2026-10-01 02:00 UTC (calibration 20/20)
Paired per-mode reads with `astra/paired.mjs` (same items, official score, 95% interval on the per-item difference).

### fix6 (I8–I15) vs I5 on dev, 359/360 judged — KEEP the bundle
| mode | I5 | fix6 | Δ (95%) | hard fails |
|---|---:|---:|---:|---:|
| General | 7.87 | 8.53 | +0.66 (±0.65) | 10 → 5 |
| Sales | 6.93 | 8.02 | +1.09 (±0.73) | 18 → 8 |
| Recruiting | 8.58 | 8.83 | +0.25 (±0.36) | 6 → 5 |
| Team Meet | 8.77 | 8.63 | −0.14 (±0.50) | 3 → 5 |
| Looking for work | 6.73 | 7.33 | +0.60 (±0.52) | 22 → 18 |
| Lecture | 8.86 | 9.03 | +0.17 (±0.38) | 4 → 3 |
| Technical interview | 8.09 | 8.00 | −0.09 (±0.50) | 10 → 10 |
| Seminar | 8.55 | 8.64 | +0.09 (±0.45) | 5 → 3 |
| Call Center | 6.35 | 7.07 | +0.72 (±0.74) | 20 → 14 |
| ALL | 7.86 | 8.23 | +0.37 (±0.19) | 98 → 71 |

* I8 alone (fix4 vs I5, 25 per mode on its modes): LFW +0.84, Sales +0.74, Call Center +0.53, Seminar +0.43,
  General −0.01, Technical interview −0.84 (±0.73; fix6 on the same items is back at +0.72 over fix4 — TI's capped
  answers are reasoning/factual errors of the generator and swing ±0.8 between runs). ALL +0.28 (±0.32). KEEP I8.
* I16 hand-back (replay on fix6 drafts, 137 gated rows): +0.09 (±0.17). Neutral; kept (removes the copied example).

### Judge-date artefact found and fixed (harness, 55c00a33)
* Team Meet first read −0.39 with hard fails 3 → 7. Two were replies that used a relative day ("1 October, so
  that's tomorrow", generated 30 September, judged 1 October as a factual error). The envelope now states the
  generation date when a reply uses a relative day (3–5 items per run; all other cached judgments stand):
  DTEAM-031 4.0 → 10.0, DTEAM-016 4.0 → 8.4. The TODAY line (I11) stays; replay without it lost DSALES-026 (0/2).

### Generator ceiling — NOT generator-bound
* Same recorded I5 prompts, same 15 items per mode: deepseek-flash replay 7.80, deepseek-v4-pro 7.61
  (−0.20 ±0.34), hard fails 37 → 44; flash replay vs the in-app I5 answers −0.08 (±0.25), so replay is a fair
  proxy. A larger DeepSeek model with the same prompts does not close the gap; the capped classes are structural.

### I18 — the verifier LISTS the unsupported phrases, then rewrites; Team Meet and Recruiting are verified too
* Root cause: after the verifier, 18 of 40 LFW answers were still capped (16 unsupported_personal_claim): "Twice a
  year sounds manageable", "I'd be looking at a few weeks", "level and ownership matter more to me". A longer
  description of what to remove (reframe-v1) left them unchanged — the edit model does not see them when asked only
  to output the edited reply.
* Variant scratch-v1: one hidden line `UNSUPPORTED: … | …`, a `---` line, then the reply. Replay on fix6's drafts,
  judged: LFW 7.33 → 8.20 (+0.87 ±0.49, hard fails 18 → 5); Call Center 7.07 → 7.46 (+0.39 ±0.38, 14 → 10);
  Sales 8.02 → 7.93 (−0.09 ±0.50). ~96 output tokens, p50 0.95 s (0.8 s before).
* scratch-v2 (more rules per claim kind): 7.99 vs 8.20 (−0.21 ±0.39) — sampling noise; the same item swings
  9.7 ↔ 5.0 between samples. Structure is the lever, not the extra wording; v1 kept.
* scratch-v3 = v1 + Team Meet and Recruiting verified on every turn: Team Meet 8.37 → 8.93 (+0.56 ±0.49, hard
  fails 7 → 2), Recruiting 8.83 → 9.11 (+0.27 ±0.36, 5 → 2).
* What it leaves in LFW: questions about the candidate's own past with no evidence ("why did you leave", the gap)
  now deflect ("What would you like to know about that stretch?" 6.0–7.7, important_question_unanswered). The judge
  wants neither an invented reason nor a counter-question — the architectural blocker noted earlier.
* Cost: Team Meet and Recruiting now pay the verifier's ~0.9 s on the total and the replace-after-stream.

### I18 as built (aq-fix2 1bb90a65 + 13b649c7) — run aq2-dev-fix8
* On top of the replayed variants: Call Center with no document treats procedures / verification steps / what the
  agent can see or do as unsupported ("say you will check how that is handled"): replay 7.46 → 8.25 (hard fails
  10 → 4; vs fix6 +1.18 ±0.61). Sales with no document: what the price depends on, terms, promises: 7.98 → 8.22
  (8 → 5).
* OBJECTIVE REGRESSION CAUGHT: list-then-rewrite listed the reply's stale-sheet caution as "unsupported" and
  confirmed the expired price (DSALES-023 validator pass → fail). Rail `freshness_dropped` + a prompt line; with the
  real module the dev validators equal fix6's (DSALES-023 pass). Ratio rail lifted only when there is no document
  (DSALES-001's one-question edit was rejected as too_short).
* The real module on the 131 rows that have documents (LFW/Sales/CC/Team Meet/Recruiting): 8.11 → 8.40
  (+0.30 ±0.25), hard fails 30 → 16.
* BUG FOUND (in fix6 and fix7 too): the verifier sometimes REPLACED an English reply with a Hindi one — 3 of 360 dev
  answers in each run (DCC-008/009/010; DSALES-002, DCC-004, DCC-009). Cause: the transport appends the app's
  language instruction ("If the user writes in Hindi, respond in Hindi…") to the verifier's system prompt too. Fix
  13b649c7: the prompt pins the draft's language; an edit whose script differs from the draft's is never shipped
  (`language_changed`). The same suffix rides on every other secondary call — not changed here, worth a look.

### Rejected in this batch
* I19 technical second look (`ERRORS:` list, then fix; tools/variants/techcheck-v1.mjs): on the 40 TI answers it
  found 2 of the 7 judged technical errors and one of its two fixes was itself wrong; ~1.2 s. Technical-interview
  caps (an LRU on a list, Θ(n) called O(n log n), debit/credit reversed) are the generator's; deepseek-v4-pro was no
  better on TI either (7.38 vs 7.32).
* I20 `MISSING:` line (facts the material holds that the draft left out): −0.01 (±0.20) on 131 rows. Not built.
* scratch-v2 (per-kind rules): noise (above).

### I21 / I22 — every spoken General turn and every Seminar turn is verified (source written, next build)
* General, every turn: 8.53 → 8.80 (+0.27 ±0.37), hard fails 5 → 1; the gain is on spoken turns, one typed answer
  got worse → spoken only; typed keeps the narrow gate.
* Seminar, every turn, subject = the research: 8.64 → 8.99 (+0.35 ±0.37), hard fails 3 → 1.
* Cost to state plainly: with I18 + I21 + I22 every spoken answer except Lecture and non-personal Technical
  interview pays the ~0.9 s pass and the replace-after-stream.

### fix8 in-app (I18 + language rail, aq-fix2 13b649c7) — objective read; judge at 11:00Z
* 360 rows, 0 failed, 0 non-English answers. Validators 8/9 (= fix6; DTEAM-034 still fails). Epistemic lines 11 → 5.
* Verifier: ran on 220 of 360 turns; 144 edited, 71 unchanged, 5 rejected by rails (3 epistemic_introduced,
  1 denial_introduced, 1 too_short); p50 951 ms, p90 1354 ms, max 2357 ms (budget 3500).
* Latency vs fix6: TTFT p50 854 → 908 ms; total p50 1555 → 1907 ms, p95 2753 → 3415 ms. Team Meet total p50
  1192 → 2133, Recruiting 1020 → 1987 (newly verified).
* Spoken turns whose text is replaced after streaming: Sales 22/28, Call Center 23/30, LFW 27/32, Team Meet 17/28,
  Recruiting 13/27, General 7/19, TI 6/29, Seminar 2/32, Lecture 0/20. This is the product trade-off of the pass.
* Two defects of the new code found by reading the edits, fixed in 8e30ca40: a trailing quotation mark was stripped
  from replies ending on a quoted line (6 of 149 edits; for 5 the only change → a pointless swap that dropped the
  GIST chip); doubled spaces where a dash was normalised (35 of 149).
* 02:00Z ration: ~2,160 judgments, 402 at 03:30Z. Blind pairwise cur vs fix6 stopped at 155 of 360 pairs: fix6 76,
  ties 17, cur 62 (decisive 12 vs 2); Sales 30–9; General 13–18 (cur's wins 17 slight / 1 clear, fix6's 9 of 13
  clear or decisive); Team Meet 12–17.

### Candidate fix9 = aq-fix2 8e30ca40 (I18 + language rail + I21 + I22 + tidy)
* Chain (one app): dev → holdout → supp-behavior → supp-quant → final (1038, aggregate only). 11:00Z queue:
  fix9 dev + holdout → supp-behavior + blind pairwise cur vs fix9 → final-set sample 40 per mode for fix9 and the
  baseline run → fix8 / supp-quant / leftovers.
* I24 (verifier stops after "UNSUPPORTED: none"): no latency gain (unchanged turns 864 vs 876 ms p50 — the cost is
  the second request's round trip, not its output). Not built.

## Phase 3 (2026-10-01 04:45Z) — claim kinds; charter v2
Evin's continuation spec: the verifier is now strong enough to damage answers. It must tell a historical/evidence
claim and an existing personal preference (verify) from a current decision, a recommendation and an ordinary
commitment (leave), verify consequential promises, and SURFACE a conflict inside the material instead of picking a
side. The judge charter gets the same distinction. fix8/fix9 need their own full judge + holdout read before any
promotion; replay gains are evidence, not a verdict.

### Charter v2 (c725615a54f6; v1 kept as astra/CHARTER.v1-6dd53845a51c.md)
* "CLAIMS AND EVIDENCE" now defines the six kinds with Evin's examples (pads vs rotors) and says to penalise
  evasiveness, deferral, question-backs and removed decisions; a truthful fallback when personal information was
  unavailable is neither fabrication nor excellent. Caps and weights unchanged. Wording taken from the spec, not tuned
  on any judged answer.
* Calibration v2: +5 pairs (current decision; over-deferral "who's taking it"; a decision vs invented history; a
  source conflict; a consequential commitment). Gate = 90% → 23 of 25.
* Every judgment is re-keyed by the charter, so all comparisons from here use `abs-dev-c2` / `abs-holdout-c2` /
  `abs-sb-c2`. Charter-v1 numbers (baseline 7.78, fix6 8.23 …) are NOT comparable with c2 numbers.
* Honest status of fix6: on holdout (charter v1) it is +0.12 (±0.23) over main with Call Center −0.74. That is not a
  holdout confirmation; fix6 is the provisional reference, not a promoted build.

### Over-verification, measured (tools/oververify.mjs) — the I18 prompt caused it
* I18's list step named "a yes or a no, an 'it works for me'… what they want" and its rewrite said "acknowledge and
  ask the one thing about the other side".
* In-app edits: fix6 86 edits → 15 end in a question the draft did not ask, 1 decision lost, 4 cut to under half.
  fix8 149 edits → 36 / 26 / 21. Examples: "Who's grabbing this one?" — "I can take this one…" → "…I'll come back on
  who's picking it up" (DTEAM-002); "Let's do the pads today, and hold off on the rotors" → a question to the
  mechanic (DGEN-023); "I'll stay on this with you until it's actually fixed" removed (DCC-023).

### fix10 — claim kinds in the verifier (source written; build after fix9's holdout run)
* List step: only [past], [self], [promise]; an explicit "never list" for a decision made now, taking a task, a
  recommendation, an ordinary small commitment. A `CONFLICT:` line names two values the material gives for what was
  asked. Rewrite step, in order: listed phrases gone; everything else word for word; a conflict is surfaced and
  neither value asserted; an emptied answer gets a short "will confirm and come back" line (preference /
  availability) or what the material records (own past) — never a question back. I16's hand-back sentence removed.
* Replay on fix8's 256 verified drafts (fix9 verifier → kinds): edited 156 → 116; turned into a question 37 → 4;
  decisions lost 28 → 10; cut to under half 18 → 15; document-grounded replies edited 33 → 13 of 72; profile-grounded
  edits keep 67% of the draft's words (58%).
* Conflicts: the list step names them (DSALES-023's included-vs-$300 Salesforce line, DGEN-035's two rents); the
  rewrite acted on 6 of 10.
* NOT enforced in code: ~18% of listed phrases stay in the model's own reply, and most are listing mistakes it then
  corrects (résumé facts such as "about 2.3 million a day"). Deleting listed sentences would remove grounded facts.
  A shorter rewrite step did not change the survival rate (80 vs 61 of ~350).
* Call Center holdout drop, root cause: the persona ALREADY says "without a stated procedure, say you will check the
  right process rather than describing a typical one"; the generator ignores it. The lever is the verifier's
  no-document clause (I18), not more prompt text. No I10 change.
* Technical interview: verified code execution exists (`electron/llm/codeVerification`, sandboxed subprocess, 3 s)
  but `isCodeVerificationEnabled` defaults OFF ("temporarily disabled"), so no benchmark run ever executed a code
  answer. Measured next with NATIVELY_CODE_VERIFY=on on a TI-only run; the production default is Evin's decision.

### fix10 in-app (aq-fix2 497c9ba9) — objective read (judge at 11:00Z, charter v2)
| | fix6 | fix8 | fix10 |
|---|---:|---:|---:|
| dev validators | 8/9 | 8/9 | 8/9 |
| dev edits by the verifier | 86 | 149 | 115 |
| … turned into a question | 15 | 36 | 3 |
| … lost a decision or ownership | 1 | 26 | 13 |
| dev spoken turns whose text is replaced (of 245) | – | 117 | 95 |
| dev total p50 / p95 ms | 1555 / 2761 | 1907 / 3447 | 2065 / 3432 |
| holdout validators | 2/2 | – | 2/2 |
| holdout total p50 ms | 1485 | – | 2048 |
| supp-behavior validators | 8/9 | – | 9/9 |

* Verifier in fix10: runs on 74% of turns (dev 268/360, holdout 201/270), replaces the text on 32% of dev and 27%
  of holdout turns. TTFT p50 880 ms (fix6 854).
* DTEAM-034's validator ("surfaces the 28 October customer date") fails in fix4 and later and passes on the baseline:
  not a code regression — the notes hold several conflicts and the answers surface another real one (two freeze
  dates); pass/fail follows the sample (cur pass, fix2 fail, fix3 pass).
* Defects read off the edits: the pass says its prompt's word aloud ("The material gives both…", "The material I have
  on Project Tern records…", 3 of 61 edits) and gives motive questions an awkward holding line.
* INCIDENT 05:40Z: the disk filled (other sessions' build output), the app died, and the supervisor's restart REBUILT
  dist-electron from the working tree, which held the unbuilt fix10 edits: the last 15 rows of aq2-holdout-fix9 ran
  fix10 code. Removed (kept in removed_fix10_build_rows.jsonl); the clean fix9 holdout is 207 rows without Seminar
  and Call Center. Source is never edited while a run chain is alive.

### fix11 (aq-fix2 ab264bb3) — source-word rail; the candidate for the 11:00Z batch
* `SOURCE_WORD_RE` rail (`source_exposed`): an edit that introduces "the material", "my résumé says", "on record"…
  is never shipped. Rules 3 and 4 no longer make "the material" the subject of a spoken sentence. Replay: introduced
  source words 4 → 0.
* A broader rewording of rule 4 ("then stop: no promise to come back, no question") was NOT taken: it cut more
  replies to under half (15 → 26) and still produced "Why I'm looking, I'll confirm and come back to you on".
  Motive questions are documented as an architectural blocker (docs/BLOCKERS-ASTRA.md) instead.
* Runs: aq2-dev-fix11, aq2-holdout-fix11, aq2-sb-fix11 (started 08:28Z).

### Verified code execution (Technical interview) — cannot change the judged answer as built
* `maybeVerifyCoding` runs in the BACKGROUND after the answer is shown ("strictly additive, fire-and-forget"): a
  pass adds a badge, a failed-then-fixed run adds a separate `code_correction` message. The answer text the user
  first reads — and the benchmark records — is never changed by it. It is also off by default.
* A TI-only run with NATIVELY_CODE_VERIFY=on (aq2-dev-fix10-cv) produced the same 9 code answers, no
  verification_spec in any V3 prompt and no verification line in the app log; whether the switch reached the app was
  not confirmed. To count for answer quality the check would have to gate or replace the shown answer — an
  architecture change (docs/BLOCKERS-ASTRA.md §2), not a setting.

### fix11 in-app, dev (aq2-dev-fix11, 360 rows, 0 failed) — objective read, written 10:05Z BEFORE any charter-v2 score
* Validators 8/9 (DTEAM-034, the sampling case above). No non-English reply, no "the material" in a shown answer.
* Verifier: passes its gate on 267/360 turns (74%), replaces the text on 110 (31%); spoken turns 92/245; Looking for
  work 24/32, Call Center 15/30, Team Meet 15/28.
* Latency vs fix6: TTFT p50 845 ms (854), p95 1549 (1386); TOTAL p50 1997 ms (1555), p95 3386 (2761). The first word
  is not later; the answer settles ~0.45 s later at the median and the text is swapped on about a third of turns.
* Over-verification (tools/oververify.mjs): 110 edits → 3 end in a question, 13 flagged "decision lost", 22 cut to
  under half. Same level as fix10 (115 / 3 / 13); the source-word rail did not touch this class.

### Keep / revert rule for fix11, fixed before the scores exist
fix11 is a BUNDLE over fix6: I16 hand-back, I18 list-then-rewrite (+ Team Meet, Recruiting, no-document clauses,
freshness rail), language rail, I21 General spoken, I22 Seminar, claim kinds, source-word rail. Each part was
replay-tested on its own; in-app and on holdout only the bundle is read. A pass confirms the bundle, not each part.
Priority in the spec puts realtime usability above p10 and the mean, so the latency above is part of the rule.
* PROMOTE fix11 over fix6 only if ALL hold on the holdout set (charter v2, paired on common items):
  1. aggregate fix11 − fix6 ≥ +0.25 and the 95% interval excludes 0 (the price is +0.44 s to the settled answer and
     a text swap on a third of turns; less than a quarter point does not pay for that);
  2. hard fails do not go up in total;
  3. no mode drops by more than 0.4 (the per-mode noise floor on 30 items) with its interval excluding 0;
  4. Call Center does not drop at all beyond noise (fix6 lost 0.74 there on spoken no-document turns; the no-policy
     clause exists to repair it, so a further loss means it failed);
  5. objective validators are not worse than fix6 on dev, holdout and supp-behavior.
  Dev must agree in sign; a dev gain alone promotes nothing.
* Gain positive but interval includes 0 → NOT promoted; fix6 stays the reference, fix11 stays a candidate and the
  report says so.
* One mode fails rule 3 or 4 while the aggregate passes → the verifier is switched off for that mode (the gate is per
  mode) and that build needs its own holdout read before promotion; nothing else is tuned on holdout items.
* Aggregate ≤ 0 → revert to fix6; fix9 is read as the fallback (207 holdout rows, no Seminar / Call Center).
* The swap itself (show then replace, vs hold until verified) stays Evin's decision either way.

### What the 13 "decision lost" and 22 "cut to under half" edits in fix11 dev actually are (read 10:05Z, before scores)
* "Decision lost" is mostly the heuristic: 8 of 13 matched "I'd rather …" inside a hedge the edit removed ("I don't
  have the reporting line in front of me, so I'd rather get you the accurate answer than guess" → "I'll confirm who
  this role reports to and follow up with you directly"). Those edits are shorter and no worse.
* Real losses, 3–4 items:
  - Call Center, no document: the agent's own honest answer to a yes-or-no ask is removed with the invented process
    around it. DCC-036 "am I getting money back for today or not?" → draft "I can't confirm a credit on this call…"
    → shown "I'll get the outage documented… Can I get your account number": the question is no longer answered.
    DCC-013 loses the refusal to hand over a neighbour's name. Cause: the no-policy clause lists "what the agent can
    or cannot see or do" as unsupported.
  - DREC-014: "Mid-November works on our side, so let's plan around that" → "I'll confirm the mid-November timing on
    our side". Defensible (a start date is the hiring team's to accept) but it defers.
  - DJOB-010 (typed prep): "a tight answer if I get asked why I want to work here" → "I'll confirm that and come back
    to you on it". The motive blocker on the typed surface, where the holding line makes no sense.
  - DJOB-003: the rewrite turned "how you're leveling the role" into "how I'm leveling the role".
* Cuts to under half: most remove an invented self-claim or product behaviour (genuine). The cost shows in General
  small talk with no profile: DGEN-027 "where do you see yourself in five years?" → "That's a big one, where do you
  even start. What about you…", DGEN-028 "Biggest weakness?" → "Ha, depends who you ask. What's yours?" — deflections.
  This is I21 (every spoken General turn verified); under the rule above General is the mode to watch.
* Replay-only variant `tools/variants/_cv-cc-keep-v1.mjs` (keep "cannot confirm or promise on this call" and a refusal
  to hand over another person's details): on the 40 dev Call Center drafts it kept the honest answer in DCC-008, 013,
  015 but ALSO kept invented restrictions the clause exists to remove ("I can't send a password reset by text",
  DCC-032) and still dropped DCC-036's answer. Mixed; NOT built. Kept as a variant in case the judged Call Center
  result points at this class.

### fix11 in-app, holdout (aq2-holdout-fix11, 270 rows, 0 failed) — aggregate objective read, 10:31Z, before scores
* Validators 2/2 (fix6 2/2, main 2/2). No source word, no non-English reply in a shown answer.
* Verifier: passes its gate on 203/270 turns (75%), replaces the text on 66 (24%); spoken turns 52/189.
  Over-verification flags: 0 edits end in a question, 6 "decision lost" (heuristic), 6 cut to under half.
* Latency vs fix6: TTFT p50 854 ms (779), p95 1644 (1363); TOTAL p50 2114 ms (1485), p95 3612 (2811).
  The run restarted once (app exit at row 51, resumed on the same committed build).

### fix11 supp-behavior (aq2-sb-fix11, 72 rows, 0 failed) — validators 6/9 vs fix6 8/9: rule 5 is NOT met as built
* Fails: SBLEC-002 (Lecture, no verifier there: the draft itself missed the lecturer's error — sampling, passes in
  fix6 and fix10), SBSEM-002 (source conflict 23 vs 32 minutes: fails in fix6 too; the edit swapped one value for the
  other instead of naming both — blocker 4), SBSEM-007 (VERIFIER-CAUSED: the draft said "We didn't measure anything
  about colonies or nests", which is what the validator requires; the edit removed it).
* Repeated 6 times in replay: SBSEM-007 passes 2/6 with the fix11 verifier. So this one is a defect, not a sample.
* Latency on this set: total p50 2281 ms (fix6 1581), p95 4509 (2741).

### I25 — an honest limit is not a claim (aq-fix2 e7325287 = fix12 candidate; replay only so far)
* Class (tools/limits-lost.mjs): drafts that state a limit ("I can't confirm a credit on this call", "we didn't
  measure that", "I can't confirm that was agreed") and lose it in the edit. fix11 dev 21 of 41 such drafts (fix6: 8
  of 38), supp-behavior 3 of 6, holdout 7 of 18 (fix6: 4 of 19). Read one by one on dev + supp-behavior: about half
  are harmless (a hedge before "I'll confirm and follow up"); 8 leave the question unanswered or imply a yes
  (DCC-036 "am I getting money back or not?" → "I'll get the outage documented…"; DCC-011 "can you delete them now?"
  → "I can help with that."; DTEAM-006 / DTEAM-026 a claimed past agreement no longer challenged; SBSEM-006 / 007).
* Cause, from the pass's own list: it files the limit as a claim — "I can't confirm a credit on this call [promise]",
  "I can't confirm it as a freeze [past]", "We didn't measure anything about colonies [past]".
* Change — three narrowings of existing rules, no new step: (1) the never-list names an honest limit (not knowing,
  cannot confirm or promise yet) and what the request itself states; (2) "Never say you cannot speak to…" → "Never
  add…" (a rule for the edit; the `epistemic_introduced` rail still refuses an edit that adds one); (3) Seminar only:
  a study's scope is closed, "we did not measure X" is supported when the material describes the study without X.
  Capability / policy limits ("I can't send a reset by text") stay listed — the cc-keep-v1 variant showed that a
  blanket "keep every can't" brings the invented restrictions back.
* Replay on the same drafts (base = fix11 verifier re-sampled, variant = tools/variants/_cv-limits-v1.mjs, whose
  prompts are byte-identical to the built source for every mode / surface):
  | | fix11 | I25 |
  |---|---:|---:|
  | dev: limits lost (of 41 drafts) | 19 | 10 |
  | supp-behavior: limits lost (of 6) | 3 | 1 |
  | dev edits | 109 | 94 |
  | dev: decisions lost / cut to under half | 11 / 21 | 11 / 20 |
  | dev validators | 8/9 | 8/9 |
  | SBSEM-007 validator, 6 repeats | 2/6 | 6/6 |
  | DCC-036, DTEAM-006, SBSEM-006 keep the limit, 6 repeats | 0/6 | 6/6 |
  | DCC-032 invented "can't reset by text" still removed, 6 repeats | 5/6 | 6/6 |
  | DSALES-023 stale-sheet validator, 6 repeats | 6/6 | 6/6 |
  | SBSEM-002 conflict validator, 6 repeats | 1/6 | 2/6 |
* Not fixed by it: the source-conflict rewrite (blocker 4), DSEM-005 ("I didn't run quantization-aware training"
  still removed), DJOB-021 (kept 3/6).
* Tests: `npm run test:llm` on e7325287 (electron build + suite, 11:07Z once the load fell): 5,673 tests, 5,645
  pass, 0 fail, 28 skipped. The verifier's own file is 63/63.
* Status: NOT judged, NOT run in the app. It is built only if fix11's holdout read keeps fix11 as the base; then it
  needs its own dev + holdout + supp-behavior runs and the 02:00Z batch.
* Harness: tools/verifier-replay.mjs now passes the surface to the gate (spoken General turns were skipped in replay).

## External judge — batch 2026-10-01 11:00 UTC, CHARTER v2 (calibration 25/25, gate 23)
Probe OK 11:00:15Z. All 25 pairs correct, including the five claim-kind pairs (CAL-21 current decision, CAL-22
over-deferral, CAL-23 decision vs invented history, CAL-24 source conflict, CAL-25 consequential commitment); 22
decisive, 3 clear. Result sets: abs-dev-c2, abs-holdout-c2, abs-sb-c2; nothing from charter v1 is mixed in.

### Dev, charter v2: fix11 vs fix6 (360/360 judged each, paired) — 11:30Z
| mode | fix6 | fix11 | Δ (95%) | hard fails | p10 |
|---|---:|---:|---:|---:|---:|
| General | 8.68 | 8.57 | −0.11 (±0.54) | 3 → 4 | 6.1 → 5.5 |
| Sales | 7.82 | 8.31 | +0.49 (±0.62) | 9 → 3 | 4.0 → 6.5 |
| Recruiting | 8.73 | 9.01 | +0.28 (±0.34) | 5 → 1 | 4.7 → 7.7 |
| Team Meet | 8.56 | 9.12 | +0.56 (±0.48) | 5 → 1 | 5.0 → 8.4 |
| Looking for work | 7.40 | 7.88 | +0.49 (±0.44) | 16 → 7 | 4.4 → 5.0 |
| Lecture | 9.01 | 8.71 | −0.30 (±0.46) | 3 → 5 | 8.1 → 4.2 |
| Technical interview | 8.01 | 8.21 | +0.20 (±0.76) | 10 → 9 | 4.0 → 4.0 |
| Seminar | 8.67 | 8.76 | +0.09 (±0.53) | 3 → 2 | 6.8 → 6.6 |
| Call Center | 7.29 | 7.62 | +0.34 (±0.58) | 12 → 7 | 4.0 → 4.0 |
| ALL | 8.24 | 8.47 | +0.23 (±0.18) | 66 → 39 | 4.0 → 5.0 |
* Attribution: on the 110 answers the verifier edited the mean change is +0.66; on the 250 it did not touch, +0.04.
  Lecture has no verifier: its −0.30 is the generator's own arithmetic / reasoning errors on this sample (DLEC-028,
  -038, -012), as are 12 of the 18 drops of 2.5 points or more.
* Hard fails by flag in fix11 (39): unsupported_personal_claim 13, major_reasoning_error 10,
  important_question_unanswered 7, missed_available_evidence 6, major_factual_error 6, unsupported_policy_claim 5,
  unsupported_company_claim 5, arithmetic_error 4, reference_conflict_ignored 3, unsafe_commitment 2,
  fabricated_behavioral_story 2.
* What the verifier costs, read off its 6 large drops:
  - DCC-036 9.2 → 4.0: the honest "I can't confirm a credit on this call" removed, question unanswered — the I25 class,
    confirmed by the judge ("The money-back question goes unanswered").
  - DREC-014 8.5 → 5.9 and DREC-020 (fix6 said "We do sponsor and transfer H-1B"): the pass listed a fact the role
    brief DOES state as unsupported and deferred. A precision error of the list step on a supported fact.
  - DJOB-031 10.0 → 7.3: two résumé versions, one explicitly older; the reply says the figure "is given two ways"
    where the judge wants the newer one reported. The conflict rule is too eager when one source is marked older.
  - DSALES-024, DTECH-014, DGEN-013: the edit itself was wrong or coached.
* The judge flags a question left unanswered on 34 fix11 answers, 28 of them verifier-edited: the motive / own-past
  items in Looking for work (blocker 1), introductions in Seminar and Sales with no profile, and Call Center
  no-document turns. Deflection is now the main cost of the pass; invented claims were the main cost before it.
* Dev agrees in sign with the rule; the decision waits for holdout.

### What the pass trades, counted on dev (judge flags, charter v2, fix6 → fix11)
| flag | fix6 | fix11 |
|---|---:|---:|
| unsupported_personal_claim | 32 | 13 |
| unsupported_company_claim | 14 | 5 |
| unsupported_policy_claim | 9 | 5 |
| missed_available_evidence | 27 | 21 |
| important_question_unanswered | 11 | 34 |
Invented claims −32, questions left unanswered +23. The net is positive (+0.66 on edited answers) and the remaining
cost is deflection.

### Rejected — "an explicitly older version is not a conflict" (tools/variants/_cv-conflict-newer-v1.mjs, replay only)
* Reason to try: DJOB-031 (10.0 → 7.3) and DJOB-032 — two résumé versions, one marked older; the draft reported the
  newer figure and the edit re-opened it as "given two ways".
* Six repeats per item, fix12 → with the rule: DJOB-031 hedged 5/6 → 2/6 (better), but the list step stopped naming
  GENUINE conflicts: SBSEM-002 (abstract vs results) 3/6 → 0/6, DSALES-023 (two prices on one sheet) 5/6 → 0/6, and
  DJOB-032 got worse (hedged 0/6 → 5/6). The model does not separate "older version" from "two values". Not built.

### HOLDOUT, charter v2: fix11 vs fix6 (270/270 judged each, paired, aggregate only) — 11:48Z
| mode | fix6 | fix11 | Δ (95%) | hard fails | p10 |
|---|---:|---:|---:|---:|---:|
| General | 8.44 | 8.92 | +0.47 (±0.52) | 4 → 1 | 5.0 → 7.7 |
| Sales | 8.10 | 8.49 | +0.39 (±0.66) | 5 → 3 | 4.0 → 6.9 |
| Recruiting | 8.71 | 8.86 | +0.15 (±0.41) | 3 → 2 | 5.5 → 7.6 |
| Team Meet | 8.43 | 8.45 | +0.02 (±0.50) | 6 → 4 | 5.0 → 4.9 |
| Looking for work | 7.31 | 7.74 | +0.43 (±0.70) | 11 → 7 | 5.0 → 5.0 |
| Lecture | 8.66 | 8.73 | +0.08 (±0.72) | 4 → 3 | 5.0 → 5.8 |
| Technical interview | 8.24 | 8.46 | +0.21 (±0.92) | 6 → 3 | 4.0 → 6.6 |
| Seminar | 7.65 | 8.39 | +0.74 (±0.69) | 7 → 3 | 3.0 → 6.3 |
| Call Center | 6.66 | 7.93 | +1.27 (±0.73) | 14 → 5 | 4.0 → 4.0 |
| ALL | 8.02 | 8.44 | +0.42 (±0.22) | 60 → 31 | 4.0 → 5.0 |
Hard fails left in fix11 on holdout (31): unsupported_personal_claim 10, unsupported_company_claim 5,
major_reasoning_error 5, unsupported_policy_claim 5, unsupported_research_claim 3, important_question_unanswered 2,
and nine single flags.

### DECISION on fix11 against the rule written at 10:05Z
| rule | result | verdict |
|---|---|---|
| 1. holdout gain ≥ +0.25, interval excludes 0 | +0.42 (±0.22) | pass |
| 2. hard fails not up | 60 → 31 | pass |
| 3. no mode drops more than 0.4 | no mode drops | pass |
| 4. Call Center not down | +1.27 (±0.73) | pass |
| 5. validators not worse than fix6 | dev 8/9 = 8/9, holdout 2/2 = 2/2, supp-behavior 6/9 vs 8/9 | FAIL |
| dev agrees in sign | +0.23 (±0.18) | yes |
* Rule 5 fails and stays failed with the ungated Lecture item set aside: SBSEM-007 is caused by the verifier and
  reproduces (2 of 6). The rule is not rewritten after the fact.
* So: **fix11 is NOT promoted. fix6 stays the reference on paper.** fix11 is the BASE for the next build, because its
  judged gain on holdout is large and consistent (no mode down, Call Center repaired, hard fails halved) and its one
  objective regression is exactly what I25 targets. It is a holdout confirmation of the bundle (I16, I18, language
  rail, I21, I22, claim kinds, source-word rail), not of each part.
* Latency paid for it: settled answer +0.44 s (dev) / +0.63 s (holdout) at the median; text swapped on 24–31% of turns.

### Promotion rule for fix12 (aq-fix2 e7325287 = fix11 + I25), written 11:50Z before any fix12 run exists
fix12 is promoted over fix6 only if ALL hold (charter v2, holdout, paired):
1. vs fix6: aggregate ≥ +0.25 with the interval excluding 0; hard fails not up; no mode down more than 0.4 with its
   interval excluding 0; Call Center not down.
2. vs fix11: the paired aggregate is not below −0.15 (I25 keeps text the pass used to remove; it must not give back
   the bundle's gain), and Call Center, Seminar and Team Meet — the modes it changes — are each not below −0.4.
3. vs fix11: `important_question_unanswered` (all judge flags, dev and holdout) does not go up.
4. Validators: a failure counts against the build when its mode is gated or the verifier edited the shown answer;
   a failure on an unedited answer in an ungated mode is reported as sampling. Counted that way fix12 must not be
   worse than fix6 on dev, holdout and supp-behavior. (This reading would not have saved fix11: SBSEM-007 is gated
   and edited.)
5. Objective, in the app: drafts that state a limit and lose it (tools/limits-lost.mjs) go down against fix11.
Otherwise fix6 stays; if only rule 2 or 3 fails, fix11's verifier without I25 is the one to carry forward and the
validator defect is reported as open.

### I25 judged (replay, 44 limit-stating drafts, charter v2) — the general exemption is TAKEN BACK — 11:52Z
* Paired, variant − fix11 verifier: −0.02 (±0.24) on all 44; −0.04 (±0.43) on the 25 whose reply differs.
  Call Center +0.13 (n 14, hard fails 2 → 1), Sales +0.21 (4), Recruiting +0.04 (7), Seminar −0.15 (10),
  Team Meet −0.30 (8).
* The judge does not reward the kept hedge: DTEAM-026 9.6 → 8.1 and DTEAM-006 9.8 → 9.0 with "I don't have that in my
  notes, so I can't confirm it was agreed" kept; it prefers "Can we check the notes before we treat export as out of
  scope?" alone. My reading of those two as harmful was wrong.
* Side effect: with the exemption the list step returned "UNSUPPORTED: none" for DCC-036 and the invented process
  beside the limit ("route it to the team that handles billing adjustments") stayed: 6.3 → 4.0.
* What survives: the Seminar study-scope clause. Alone (tools/variants/_cv-study-scope-only.mjs) it passes SBSEM-007's
  validator 6/6 (fix11 2/6) and keeps SBSEM-006's "bare roofs weren't part of the study" 6/6.
* Built as aq-fix2 f0c3a263 (= fix12): e7325287's general exemption and the "Never add" rewording reverted, the
  Seminar clause kept. Every non-Seminar prompt is byte-identical to fix11 (checked for all modes × surfaces ×
  with / without documents). `npm run test:llm`: 5,672 tests, 5,644 pass, 0 fail, 28 skipped.

### fix12 evaluation plan and rule (amended 11:57Z, before any fix12 result; replaces the 11:50Z rule's rule 2–5)
* Only Seminar's verifier prompt differs from fix11, so only Seminar is re-run: aq2-dev-fix12 (40), aq2-holdout-fix12
  (30), aq2-sb-fix12 (10), Seminar rows only, started 11:56Z. For the other eight modes fix11's runs and judgments
  stand; the fix12 aggregate is fix11's eight modes plus fix12's Seminar, and the report says so.
* fix12 is promoted over fix6 if: (1) the combined holdout aggregate still clears rule 1–4 of the fix11 rule;
  (2) Seminar on holdout is not below fix11's Seminar by more than 0.4 with the interval excluding 0, and its hard
  fails are not up; (3) validators, counted on gated modes and edited answers, are not worse than fix6 on dev,
  holdout and supp-behavior — i.e. SBSEM-007 passes; (4) `important_question_unanswered` in Seminar is not up
  against fix11.
* One Seminar sample of 10 supp-behavior rows decides a validator: if SBSEM-007 fails in the app the replay is
  re-checked before concluding either way.

### Rejected — verifying the ungated turns that still carry a personal claim (replay only, 12:06Z)
* Signal: in Lecture the draft-personal pattern matches 1 of 40 dev and 2 of 30 holdout drafts; every match is
  judge-capped for an unsupported personal claim (4.2–5.0 against ~9.0 for the rest) and no capped one is missed.
  The lecturer addresses the room ("who here has worked with messy real-world data?") and the draft answers AS the
  student, against the persona ("a quiet study partner, not the student or lecturer"). In Technical interview,
  DTECH-017 ("tell me honestly how much Go you've written in production") matches neither gate pattern.
* `tools/variants/_cv-gate-v2.mjs` (gate Lecture on that pattern, widen the TI question pattern): the pass LISTS the
  claims and then keeps them — DLEC-008 unchanged or still first-person in 5 of 6 replays, DTECH-017's "side
  projects and coursework" kept in 4 of 6 and replaced by "I'll confirm that and come back to you" in the others.
* `tools/variants/_cv-lecture-voice.mjs` (a dedicated "do not speak as the student" rewrite for those Lecture turns):
  5 of 6 rewrites were refused by the `source_exposed` rail; the one shipped was good. Not a clean fit for the pass.
* Not built. It is a persona-compliance error of the generator on 2–3% of Lecture turns (≈ +0.03 on the aggregate if
  fully repaired); a proper fix belongs in the response-contract validator of that mode, not in the claim pass.

### fix12 (aq-fix2 f0c3a263) — Seminar rows in the app and judged; PROMOTED — 12:27Z
* Runs (Seminar rows only): aq2-dev-fix12 40, aq2-holdout-fix12 30, aq2-sb-fix12 10; 0 failed rows. The holdout run
  hung twice on a profile step (the app's structured generation went to the Codex CLI and never returned); the run
  process and then the app were restarted, the rows are from the same committed build.
* Objective: supp-behavior Seminar validators 5/5 (fix11 3/5, fix6 4/5) — SBSEM-007 and SBSEM-002 both pass; holdout
  1/1, dev 2/2. Seminar edits: sb 1 of 10 (fix11 3), holdout 5 of 30 (5), dev 8 of 40 (9). Seminar total p50
  2534 / 2545 / 3217 ms (dev / holdout / sb), fix11 2409 / 2450 / 3572.
* Judged, Seminar, charter v2 (paired):
  | set | vs fix11 | vs fix6 | hard fails fix6 → fix11 → fix12 | question unanswered |
  |---|---:|---:|---:|---:|
  | holdout (30) | −0.10 (±0.23) | +0.64 (±0.74) | 7 → 3 → 3 | 0 → 1 → 1 |
  | dev (38 of 40; 2 lost to the quota) | +0.21 (±0.45) | +0.34 (±0.48) | 3 → 2 → 1 | 0 → 3 → 3 |
* fix12 as a whole = fix11's runs for the eight unchanged modes + fix12's Seminar rows:
  holdout 8.02 → 8.43, +0.41 (±0.23), hard fails 60 → 31; dev 8.23 → 8.49, +0.25 (±0.18), hard fails 66 → 38 (358).
* Against the rule amended at 11:57Z: (1) holdout aggregate clears rules 1–4 — yes; (2) Seminar on holdout not below
  fix11 by more than 0.4, hard fails not up — yes; (3) validators on gated / edited answers not worse than fix6 on
  dev (8/9 = 8/9), holdout (2/2 = 2/2) and supp-behavior (Seminar 5/5; the one remaining failure, SBLEC-002, is an
  unedited answer in an ungated mode) — yes; (4) question-unanswered in Seminar not up against fix11 — yes.
* **DECISION: fix12 is promoted over fix6. The kept build is aq-fix2 f0c3a263 (branch fix/aq-astra-i5).** Holdout
  confirms the bundle (I16, I18, language rail, I21, I22, claim kinds, source-word rail, Seminar study scope), not
  each part. It is NOT landed on main.

### fix9 (I18 + I21 + I22, no claim kinds) under charter v2 — attribution
* dev (360): fix6 8.24 → fix9 8.37 (+0.13 ±0.18, hard fails 66 → 40) → fix11 8.47 (fix11 − fix9 = +0.09 ±0.16).
* holdout (207 clean rows, no Seminar / Call Center): fix6 8.29 → fix9 8.59 (+0.30 ±0.25, hard fails 38 → 21);
  fix11 − fix9 = −0.07 (±0.25).
* So the gain of the bundle is I18's list-then-rewrite; claim kinds are judged NEUTRAL (kept for what they do
  objectively: edits 149 → 115, replies turned into a question 36 → 3, fewer text swaps).
* One per-mode disagreement, not actionable: Team Meet fix11 − fix9 is −0.81 (±0.71) on holdout and +0.15 (±0.22) on
  dev. Looking for work is −0.28 / −0.23 on both (inside the noise) with hard fails 3 → 7 and 4 → 7: read on dev,
  the kinds-aware pass LISTS the invented motive or weakness and then keeps a reworded version of it ("What I want
  is to be somewhere the platform work is still the main event"), where fix9 removed it and asked a question back
  ("What does the work look like on your side right now?") — which the judge scores higher (7.5 vs 5.0) and the
  phase-3 spec forbids. Neither is a good answer: this is blocker 1 (no stored answer for motive / own-past asks).

### The batch ended on the ACCOUNT's quota, not the ration — 12:26Z
`{"error":{"message":"user quota is not enough","code":"insufficient_user_quota"}}` — a different error from the
402 "Budget pool quota has been exhausted" that ends a ration batch. About 2,770 judgments were made in this batch.
The client now fails fast on it (it was not a 402, so every remaining row failed one by one); the queue was stopped.
Judged before it: calibration, dev and holdout for fix11 / fix6 / fix9, the I25 read, fix12 Seminar (holdout 30,
dev 38). NOT judged: the starting baseline is partial (dev 201 of 360: General, Sales, Recruiting, Team Meet, 36 of
Looking for work; holdout 202 of 270: six modes and 21 of Technical interview), supp-behavior under charter v2, the
blind A/B, fix10. No judging is possible until the AgentRouter account has quota again.

### Where the remaining distance to 9.5 is (astra/headroom.mjs, kept build, no new judge calls) — 12:38Z
Every judged answer is put in one class by its flags: generator (reasoning / arithmetic / wrong fact), no-source
(a company, policy, product or research claim nothing supports), no-answer (an invented personal claim or story, or
the question left unanswered), evidence (the material had it and the answer missed it), or clean (none).
| | dev (358) | holdout (270) |
|---|---:|---:|
| mean | 8.49 | 8.43 |
| clean answers: share, mean | 78%, 9.23 | 78%, 9.23 |
| clean answers at 9.5 or above | 128 of 280 | 95 of 210 |
| if "generator" answers scored like clean ones | 8.70 | 8.57 |
| if "no-source" did | 8.63 | 8.69 |
| if "no-answer" did | 8.82 | 8.74 |
| if "evidence" did | 8.53 | 8.53 |
* **Even with every flagged class fully repaired, the modes land at their clean mean: 9.2 overall** — General 9.2–9.3,
  Sales 8.8–9.1, Recruiting 9.3–9.4, Team Meet 9.35–9.4, Looking for work 9.2, Lecture 9.4–9.5, Technical interview
  9.3–9.55, Seminar 9.2–9.4, Call Center 8.5–8.9. 9.5 on every mode needs the clean answers to improve too.
* What the judge takes off a clean answer below 9.5 (152 on dev, 115 on holdout, mean 8.7): the lowest dimensions are
  intent fulfilment (7.5 / 7.8) and direct usefulness (7.6 / 7.8), then information density (8.0 / 8.2), in every
  mode; correctness and grounding are at 9.0–9.3. The answers are right and grounded and do not fully do what was
  asked: a part of a multi-part ask left out, a fallback where a provisional answer was possible, a too-generic line.

### I26 — a typed "shorter" / "simpler" / "another one" revises the previous reply (aq-fix2 e000db4a = fix13)
* Found in the clean answers: typed refinement follow-ups come back as near-copies. DSALES-033 "shorter": 50 → 49
  words (the same sentences minus one word), judged 6.8; DSEM-040 "shorter" 94 → 94, 7.0; DSALES-037 "another one,
  less pushy" 98% word overlap, 6.5; DLEC-027 "simpler please" 132 → 130, 7.0; DTEAM-037 "shorter" 46 → 44, 7.9.
  Present since the baseline (3 of 11 short typed follow-ups are near-copies in the main-code run, 1–6 in later runs).
* Cause: the resolver marks the turn `shorter (rephrasing request: how to phrase the answer to "…")` and nothing tells
  the model that the PREVIOUS REPLY is the thing to change, or by how much; it answers the earlier question again.
* Change (prompt-composer.ts `refinementNotice`): on a typed turn the resolver marked as a rephrasing request, whose
  request is shorter / simpler / another one, and whose previous reply has 8+ words and no code: a notice naming the
  last reply and its length, with a budget — half the words for shorter, 70% for simpler, "a DIFFERENT one" for
  another. Every other prompt is byte-identical (7 dev rows, 4 holdout rows, 0 supp-behavior rows get it).
* Replay, 3 samples each, recorded prompts (words, previous → base → with the notice at the app's position):
  DSALES-033 50 → 49 → 31–33 · DSEM-040 112 → 97–101 → 38–41 · DTEAM-037 46 → 35–47 → 27–28 · DJOB-030 49 → 44 →
  27–31 · DLEC-027 "simpler please" 132 → 129–146 → 88–100 · DGEN-033 "Simpler." 59 → 57–66 → 33–41 · DSALES-037
  "another one" overlap 0.51–0.76 → 0.41–0.46.
* Tests: `npm run typecheck:electron` clean; `npm run test:intelligence` 2,807 tests, 2,796 pass, 0 fail (2 skipped,
  9 todo); llm suite 5,672 tests, 5,643 pass, 1 fail — LocalRunner "temp dirs are cleaned up" counted another
  session's temp directories; the file passes alone (14/14). New file RefinementNotice2026_10_01.test.mjs.
* Runs queued (one app, behind the quiet-machine guard): the affected conversations only on dev and holdout
  (`aq2-dev-fix13`, `aq2-holdout-fix13`), then the full final set on fix13 (`aq2-final-fix13`).
* Decision rule, written before the runs: KEEP if, in the app, every affected "shorter" reply is at most 75% of the
  previous reply's words and every "simpler" one at most 85% (objective, dev and holdout), no affected row fails, and
  when the judge is available the affected rows are not below fix12's by more than their noise. It is a contract
  repair, not a score play: 7 of 360 dev rows.

### fix13 (aq-fix2 e000db4a) in the app — affected conversations only — KEPT on the objective rule — 12:52Z
* Runs: aq2-dev-fix13 (17 rows: the 7 conversations whose follow-up gets the notice), aq2-holdout-fix13 (10 rows,
  4 conversations); 0 failed rows. `tools/refine-check.mjs` (reply against the previous reply of the same run):
  | run | refinement follow-ups | request met | "shorter": median share of the previous reply |
  |---|---:|---:|---:|
  | main, dev | 8 | 2 | 0.92 |
  | fix6, dev | 8 | 4 | 0.92 |
  | fix11, dev | 8 | 1 | 0.96 |
  | **fix13, dev** | 8 | **8** | **0.52** |
  | fix6, holdout | 6 | 1 | 0.85 |
  | fix11, holdout | 6 | 2 | 0.90 |
  | **fix13, holdout** (the 4 that get the notice) | 4 | **4** | **0.51** |
  dev per item: "shorter" 49 → 33, 71 → 37, 62 → 19, 85 → 35 words; "simpler" 59 → 34, 138 → 101; "another one, less
  pushy" shares 42% of its words with the last reply (98% before).
* Composite for reporting (`aq2-*-fix13c` = fix12c with those rows replaced by id): 0 failed rows, validators dev 8/9,
  holdout 2/2, total p50 2023 / 2138 ms — unchanged.
* Rule check: every "shorter" ≤ 75% and every "simpler" ≤ 85% of the previous reply, on dev and holdout — yes; no
  affected row failed — yes. The judged half of the rule (affected rows not below fix12's) waits for judge quota; the
  27 rows are queued for the 02:00Z batch. **fix13 is kept; the judged scores quoted for the kept build are fix12's.**
* Full final-set run on fix13 (`aq2-final-fix13`, 1,038 rows) started 12:52Z behind the stall watchdog.

### Looked for one more mechanical class in the clean answers under 9.5 — none found
The judge's "minimal improvement" on the 152 clean dev answers under 9.5 is item-specific ("use …" 22, "replace one
sentence" 18, "add a detail" 11, the rest spread over twenty verbs). Replies that end in a question score 0.3 lower
(8.23 vs 8.57) but those are mostly the no-information fallbacks. Apart from the refinement follow-ups there is no
recurring, rule-shaped defect left in the clean answers.

### Prepared, not built — a length STATED in the message should replace the app's default (replay, 12:58Z)
* "give me a 60 second version of the Dockhand story" is sent with the app default "aim for about 22s spoken —
  roughly 40 to 60 words … Hard ceiling: never go past 75 words": the answer is 63–88 words, half the time asked for.
  User instructions already outrank that default; a length stated in the message does not.
* `tools/variants/stated-length-v2.mjs` (durations only, the default block replaced by the user's own target with a
  hard ceiling), 4 samples: "60 second" 63–88 → 169–209 words (wanted 120–162); "thirty seconds on my background"
  112–170 → 56–75 (wanted 60–81); "thirty second thank-you" 55–67 → 50–58. Closer on all three, still ±30%.
* v1 also forced line counts ("a two-line text": 1 line → 2 lines, 3 of 3) but broke multi-part requests ("3
  discovery questions, a one line …": 3 lines → 8). Durations only is the safe part.
* Not built: 3 of 360 dev rows, and every production change restarts the final-set run. `tools/shape-check.mjs`
  measures it. Listed as a next step.

### Measured in replay — the generator's reasoning is switched OFF on every turn; switching it on (13:00Z)
* The app sends `thinking: {type: "disabled"}` on every DeepSeek call (time to first word). The earlier "generator
  ceiling" test (flash vs v4-pro) used the recorded parameters, so it compared two models with reasoning off; reasoning
  itself was never measured.
* Probe: DTECH-021 (Θ(n) reported as O(n log n) in every build) with `thinking: enabled, reasoning_effort: low`
  states the tight bound in 4 of 5 samples, 0 of 5 with reasoning off.
* Dev Technical interview + Lecture prompts replayed both ways (80 rows each, results/replay/think-off-til and
  think-low-til): no errors; answer length 78 vs 85–89 words; total time p50 3.1 s / 2.7 s with reasoning against
  1.4 s / 1.5 s without (p95 5.4 / 7.7 s against 2.6 / 2.0 s). The reasoning comes before the first word, so on those
  turns the first word would arrive about 1.3–1.7 s later at the median.
* Both sets are queued for the judge (02:00Z, 160 judgments). That is the measurement blocker 2 lacked: what
  reasoning buys on the modes where the generator's own errors are 11 of the 15 dev hard fails of that class. If it is
  large, the product change is a routing decision (reasoning on for typed Technical interview and Lecture turns),
  which is Evin's to make because of the delay; nothing is built.
* The other seven modes replayed the same way (280 rows each, think-off-rest / think-low-rest): total time p50 1.24 s
  → 2.54 s (p95 1.7 → 5.5 s), validators 6 of 7 both ways, drafts carrying a first-person past claim 34 vs 33. No
  objective sign that reasoning helps where the failures are invented claims rather than wrong reasoning; queued
  last for the judge.

### Final set on fix13 (aq2-final-fix13, 1,038 rows) — AGGREGATE ONLY — 14:15Z
* One pass, 0 failed rows, no stall (watchdog made no intervention).
* Validators 14 of 16 (fix6 14 of 16, main 13 of 16). The two failures — arithmetic_conflict in Lecture and
  policy_reasoning in Call Center — are answers the verifier did not edit and whose draft already failed.
* Latency: TTFT p50 908 ms, p95 1336 (fix6 728 / 1196, main 825 / 1338 — run-to-run spread); total p50 2068 ms, p95
  3003 (fix6 1381 / 2404, main 1249 / 2017). Text replaced on 220 rows (21%), 183 of 681 spoken turns (fix6 18%).
* Refinement follow-ups met 9 of 9 (fix6 5 of 9); "shorter" at a median 37% of the previous reply.
* Over-verification signs: 220 edits, 13 end in a question (fix6 35), 15 "decision lost" by the heuristic (7), 19 cut
  to under half (3).
* Requests that state a spoken duration (strict detector): 2 of 1,038 here, 3 on holdout, 3 on dev — rare, which is
  why the stated-length change stays a next step.
* App stopped, aq-fix2/dist-electron deleted.

### First answer token with reasoning on, measured with streaming (tools/ttft-thinking.mjs) — 14:55Z
30 dev Technical interview + Lecture prompts, same messages, deepseek-flash: reasoning off 783 ms p50 / 1004 ms p95;
reasoning on (effort low) 2220 ms p50 / 6551 ms p95 (one Technical interview turn took 18.8 s). Total 1.6 s → 3.0 s
at the median. So the lever costs about 1.4 s to the first word at the median and has a long tail.

### Prepared for the judge — the Looking-for-work fallback reworded after the judge's own expected behaviour (15:45Z)
* The 13 dev Looking-for-work answers in the "no stored answer" class average 5.70 (the other 27: about 9.2). The
  dataset lists these facts as deliberately absent (reason for leaving, the gap, a weakness), so the ceiling here is
  the quality of the truthful fallback, not an answer bank.
* The judge's `expected_behavior` and `minimal_improvement` on all of them describe one recipe: the documented facts
  closest to the question, then one sentence that carries the answer forward without claiming a past event or a wish
  — "connect the settlement work to this role's payments and ledger ownership", "describe it as an approach you
  would take, not as documented events", "a natural next step rather than an established ambition", "acknowledge
  the gap and bridge to the documented work since". Today's rule 4 produces a holding line ("I'll come back to you on
  that", 6.2) or a bare restatement ("I finished at Cindervale in January and started at Hollowbrook in June", 8.1).
* Two wordings of rule 4 for this mode only, replayed on the same 40 drafts (results/replay/lfw-base, -bridge-v1,
  -bridge-v2): holding lines 6 → 0 (v1) / 1 (v2); edits 29 → 29 / 27; cut to under half 4 → 1 / 1; replies ending in a
  question 7 in all three. v1's quoted example ("the way I'd handle that is…") was copied into 8 replies, also where
  it makes no sense; v2 has no template phrase and names a gap as a gap ("…started at Hollowbrook in June, so there
  is a gap there. Since then I've been on the Hollowbrook contract, moving 23 Terraform root modules…").
* Different from I23 (rejected under charter v1): that reframed the motive as a desire ("what draws me to this
  role") and was capped; this states a comparison with the role or a conditional approach.
* Not built. All three sets are queued for the 02:00Z judge batch (tier 2). Rule, written now: build v2 (or v1) as a
  Looking-for-work-only change if its paired gain over lfw-base on these 40 drafts is at least +0.3 with the interval
  excluding 0 and its hard fails are not up; then it needs its own app runs (that mode only) and a holdout read.

### Prepared for the judge — Call Center with no policy document: a "no policy on file" notice to the GENERATOR (15:52Z)
* 21 of 40 dev Call Center answers score under 8.5; 16 of them have no document. The judge's expected behaviour on
  those is one shape: name what the customer asked, say plainly what cannot be confirmed yet, say exactly what will
  be checked ("I can't confirm a refund for today yet. I'll check whether a refund or credit is available for this
  issue"), and no verification step, team, time or access claim.
* First tried in the verifier (`_cv-cc-check-v1.mjs`, rule 4 reworded for this case): it does not get there — the
  pass makes minimal edits, so the invented verification ask stays (9 → 7 of 29 replies), and its own
  `epistemic_introduced` rail refuses the edits that add "cannot be confirmed yet" (4 refusals). Not the place.
* Generator side (`tools/variants/cc-nopolicy-v1.mjs`, a notice at the end of the user message on Call Center turns
  with no reference file), then the UNCHANGED fix12 verifier (tools/verifier-replay.mjs --answers), 24 no-document
  dev rows: replies asking for a verification detail 7 → 1; replies naming what will be checked 8 → 17; median
  length 41 → 36 words. "I want to cancel. Today." → "I hear you. Let me check on the cancellation and come back to
  you right away." (was: "Before I do anything, I need to verify the account with you…").
* Open risk the judge has to settle: every no-document reply now has the same check-and-come-back shape.
* Not built. ccfin-base and ccfin-nopolicy-v1 (40 rows each) are queued for 02:00Z. Rule, written now: build it as a
  Call Center-only composer notice if the paired gain on dev is at least +0.3 with the interval excluding 0 and hard
  fails are not up; then that mode's app runs and a holdout read.
* Harness: tools/verifier-replay.mjs takes `--answers <replay.jsonl>` (verify a generator replay's output).

### Prepared for the judge — Sales with no reference file: "how to say it when nothing can be stated" (15:56Z)
* 18 of 40 dev Sales answers score under 8.6; 14 have no document. The existing notice (I7) holds the product facts
  back, and what is left is long and indirect: a preamble about not wanting to guess, an invented pricing driver
  ("it depends on how many people would be using it", capped at 4.0), a discovery detour, "on our next call". The
  judge's improvement lines are the same short shape each time: "Let me confirm the price so I can give you an
  accurate number." / "Let me confirm whether invoicing is built in so I can give you a clear yes or no." / for a
  "why you" ask, a clearly conditional line.
* `tools/variants/sales-noshape-v1.mjs`: a notice to the generator on Sales turns with no reference file, then the
  unchanged fix12 verifier. 24 such dev rows: preamble 7 → 2; replies that say what will be confirmed 8 → 14; "it
  depends on" 1 → 0; median 50 → 44 words; verifier edits 8 → 6.
* Not built. salesfin-base and salesfin-shape-v1 are queued for 02:00Z with the same rule as the other two (paired
  dev gain at least +0.3, interval excluding 0, hard fails not up; then that mode's app runs and a holdout read).
* The three prepared changes (Looking for work, Call Center, Sales) are one idea: when the material cannot answer,
  the judge rewards a short reply that names the ask and says exactly what will be confirmed (or, for a personal
  question, the nearest documented facts plus one conditional sentence) — and penalises both the invented detail and
  the long deflection. If they hold on dev they would be built together as one change and read on holdout once.

### The 02:00Z batch reordered: decisions first, one whole pair per tier (2026-10-01 22:15Z, no row of it judged yet)
* The old tier 2 started fifteen steps at once. On a short budget (the 11:00Z batch ended on the account quota after
  80 minutes) every pair would be half judged and none of the three written rules could be applied. New order in
  `astra/queue3.mjs`: calibration → fix13's 27 rows (+ the 2 fix12 Seminar rows) → lfw-base + lfw-bridge-v2 →
  ccfin-base + ccfin-nopolicy-v1c → salesfin-base + salesfin-shape-v1c → the Starting-column gaps → reasoning on/off
  and supp-behavior → pairwise → fix10 → the rest. The trade is stated: the Starting column may stay partial (it is
  already reported as partial); a half-judged pair would be worth nothing.
* lfw-bridge-v1 moved to the last tier: its copied opening phrase is a known defect and v2 is the candidate.
* Design correction, made before any score: in the Call Center and Sales pairs 16 of 40 rows do not get the notice,
  yet both arms had been regenerated and verified separately, so 39 of 40 answers differed by sampling alone. The
  judge would have scored two samples of one prompt on those rows: noise against a rule only 24 rows can move.
  `tools/replay-carry.mjs` re-applies the variant's transform to the recorded messages and, where it changes
  nothing, carries base's answer into the variant (`ccfin-nopolicy-v1c`, `salesfin-shape-v1c`: 24 touched, 16
  carried each). Those pairs now differ by exactly 0 and cost no judge call (the cache is keyed by answer text). The
  rule is unchanged and stays on all 40 rows. Looking for work is left alone: the verifier prompt changes on every
  row and 14 of 40 outputs are already byte-identical.
* `astra/decide.mjs` applies the written rules mechanically after the tiers (gain ≥ +0.3, interval excludes 0, hard
  fails not up; a pair with any row unjudged gets no verdict) and compares fix13's re-run rows with fix12's. Output:
  `astra/out/logs/decide.md`.

### fix14 candidate built ahead of the verdict (aq-fix2 99bedc65 on `fix/aq-astra-i6`, 22:22Z) — NOT a kept build
* Built now so that a BUILD verdict at about 02:20Z can go straight to app runs instead of waiting a batch. One
  mechanism per layer, no new rule family: the claim pass's "left unanswered" rule becomes a per-mode entry (Looking
  for work gets the v2 wording); the composer gets one per-mode notice for a turn with no reference file among the
  evidence (Call Center, Sales). A part whose pair does not say BUILD is deleted from the branch before any app run.
* Identity, checked offline against the replayed variants: the verifier prompt equals `_cv-lfw-bridge-v2` for 10
  modes × 2 surfaces × with / without documents (40 of 40) and differs from fix12 only in the 4 Looking-for-work
  prompts; both notices equal the variants' strings; a reference file, another mode or a custom mode adds nothing.
* `npm run typecheck:electron` clean. llm suite 5,678 tests, 5,650 pass, 0 fail, 28 skipped. Intelligence suite 2,817
  tests, 2,805 pass, 1 fail (2 skipped, 9 todo): `HindsightRetainQueue — enqueue returns immediately`, a timing test
  unrelated to this change; alone it passes 3 of 3 (machine load 9 during the full run).
* Not yet run in the app. Seen in the replay and left for the judge: a typed question from the agent themselves
  ("when am I supposed to escalate this to tier 2?") now gets a customer-facing line ("Let me check how escalation
  to tier 2 is handled and get back to you"); multi-part typed Sales asks ("give me 3 discovery questions…") keep
  their parts. Untested interaction: the replay wires pre-date fix13, so a typed "shorter" in Sales has never carried
  both the refinement notice and the shape notice — `tools/refine-check.mjs` on the app rows decides that.

### Promotion rule for fix14, written 22:24Z before any of its rows or its replay pairs has a score
fix14 = fix13 (e000db4a) + the parts with a BUILD verdict. Each part changes only its own mode, so only those modes
are re-run (dev and holdout) and compared by item with the kept build's rows (the fix13c composites).
fix14 is promoted over fix13 only if ALL hold (charter v2, paired):
1. holdout, pooled over the built modes: the gain is positive and its 95% interval excludes 0. (No latency or text
   swap is added by these parts, so the +0.25 price bar of the fix11 rule does not apply; a real effect still has to
   show.)
2. holdout hard fails on those modes are not up in total.
3. no built mode is down by more than 0.4 with its interval excluding 0 on holdout. A mode that fails this alone is
   removed and the pooled test is recomputed once on the remaining modes — the parts are independent by mode, so the
   other rows stay valid; nothing is re-worded after a holdout read.
4. the dev app rows, pooled, agree in sign.
5. objective validators on those modes are not worse than fix13 (dev and holdout).
6. `important_question_unanswered` (judge flag) is not up on those modes.
7. typed refinement requests are still met (`tools/refine-check.mjs`: dev 8 of 8, holdout 4 of 4 in fix13).
Positive but interval includes 0 → not promoted; fix13 stays the kept build and fix14 is reported as a candidate.
* App runs need a quiet machine (one app), and free disk: at 22:20Z the volume had 2.9 GB free after I deleted my own
  1.3 GB build output; other sessions took about 1.5 GB in 40 minutes. No run starts under 4 GB free.

### Two design corrections to the Call Center / Sales notice, made 22:32Z before any score (aq-fix2 44a40b0c)
* **Heard turns only.** Of the 7 typed Call Center rows the notice touched, 3 are the agent asking the assistant
  (DCC-008 escalation, DCC-009 own experience, DCC-015 "can I offer her a discount"); the notice describes a reply
  to the customer and turned them into customer-facing lines. In Sales 10 of the 24 touched rows are typed ("give
  me 3 discovery questions", "summarize their situation in one line"). Role fidelity ranks above usefulness, so the
  build applies both notices only when the question was HEARD (the hotkey). Side effect: a typed "shorter" can
  never carry this notice next to the refinement notice (one is typed-only, the other heard-only).
* **"No document" has to be true.** The first build fired whenever the evidence held no reference chunk — also when
  the mode has a policy file that retrieval missed this turn, or a screenshot of a price sheet is the evidence. Now
  withheld unless the mode's attached-file count is a known zero, no screenshot was read earlier in the
  conversation, and the evidence holds nothing but the conversation. Both call paths pass the count (typed:
  `files.length`; spoken: the mode's `_files.length`).
* On dev the gate selects exactly the heard-only replay rows: 17 Call Center and 14 Sales, none with a file attached
  (`reference_attached` false on all), and the notice sits where the replay put it on all 31 (30 have one layout
  block after it, 1 has none). So the claim is: same notice text, same turns, same position on dev — not
  "byte-identical prompts", which only an app run can show.
* The deciding pairs are therefore `ccfin-nopolicy-v1h` and `salesfin-shape-v1h` (typed rows carry base's answer:
  23 and 26 of 40 carried). The rule is unchanged and stays on all 40 rows, so the touched rows have to move further
  than before for it to pass (about +0.7 on 17 rows, +0.86 on 14). The all-turns sets ("c") go to the last tier and
  are reported, not built.
* The heard rows counted with the instrument of the original measurement (`tools/nodoc-shape.mjs`, which reproduces
  the all-turns figures 7 → 1, 8 → 17 and 7 → 2, 8 → 14): Call Center, 17 rows — asks for a verification detail
  4 → 0, names what will be checked 6 → 11, median 40 → 36 words. Sales, 14 rows — preamble 5 → 1, "depends on"
  1 → 0, says what it will confirm 5 → 11, median 52 → 42 words. So most of Call Center's 7 → 1 was on typed rows
  the gate now leaves alone. A wider pattern that also counts the softer justification ("rather than a guess",
  "can't stand behind") reads 2 → 4 on the Sales rows: the notice's own example ("…so I can give you an accurate
  number") invites it. "Says what it will confirm" is the notice's own phrase, so it shows the model followed the
  notice, not that the reply is better — that is the judge's question. The notice text is not changed.
* `npm run typecheck:electron` clean; intelligence suite 2,823 tests, 2,812 pass, 0 fail (2 skipped, 9 todo); llm
  suite 5,678 tests, 5,650 pass, 0 fail, 28 skipped. Build output deleted afterwards (3.3 GB free).
* Rule 7 of the fix14 promotion rule (typed refinement still met) stays as a check, though no typed turn changes now.

### One more correction to the batch, 22:36Z: a pair's two arms are judged one after the other
* Both arms of a pair ran in the same tier. The judge writes its cache file only after the response arrives, so a
  variant row carrying base's answer was usually sent before base's score existed: the same answer judged twice,
  two scores for one answer, exactly the noise the carried rows were meant to remove (and a second call paid for).
  Each deciding pair is now two consecutive tiers, base then variant, at concurrency 8.
* `astra/decide.mjs` counts rows whose answer is the same in both arms but whose scores differ; it must print 0.
* aq-fix2 c399f399: the notice's code comment now cites the heard-turn counts. Candidate head is c399f399.
* For the app run (runbook): if the dev wires show the notice on no heard Call Center / Sales row, check first
  whether the hotkey path passed the attached-file count as undefined — the gate stays closed on an unknown count.

## The judge changes: Fable (claude-fable-5-1), by Evin's instruction — 2026-10-01 23:50Z
* gpt-6-astra has been unavailable since 12:26Z (AgentRouter account quota). Evin: "use fable model as the judge and
  continue optimisations". This replaces the earlier "no Claude as judge" rule from here on, by his decision.
* What stays the same: charter v2 (`c725615a54f6`), the envelope, the JSON schema, the official score, the
  validators' precedence, every pre-registered rule. What is new is only who reads the envelope.
* **Separate series, never pooled.** The cache key carries the judge; absolute sets are `abs-dev-f1`,
  `abs-holdout-f1`, `abs-sb-f1`; replay judgments go to `<name>.judged-fable.jsonl`. A comparison is always made
  within one judge. The gpt-6-astra numbers in docs/REPORT-ASTRA.md stand as they are; its 02:00Z chain stays armed
  and fills its own gaps if the quota returns.
* **Isolation.** The session doing the optimising runs on the same model, so a judgment must not see it. Each
  judgment is a fresh headless `claude` process with every customisation off (`--safe-mode`: no CLAUDE.md, memory,
  hooks, skills, MCP servers), no tools, the charter as the whole system prompt, a temporary working directory,
  `--effort medium`, no session persistence (`astra/client.mjs`, AQ_JUDGE=fable). The answers come from
  deepseek-flash, so judge and generator are still different models. Open bias that cannot be removed: the fixes
  under test were designed from gpt-6-astra's notes by a Fable session; a Fable judge may share that session's
  taste. Mitigation: the objective validators keep precedence, and the two judges are compared on the same answers
  (`astra/agreement.mjs`) before the Fable series is relied on.
* **Calibration, Fable:** 25 of 25 (gate 23), 24 "decisive" and 1 "clear", 68 s
  (`astra/out/calibration/calibration-fable-*.json`).
* Plan (`astra/queue-f.mjs`, decisions first): the three replay pairs (base, then variant) → the kept build on dev
  (aq2-dev-fix13c, 360) and its fix13-vs-fix12 rows → the same on holdout → fix6 on holdout and dev → reported-only
  sets. `AQ_JUDGE=fable node astra/decide.mjs` applies the rules written on 2026-10-01 unchanged.

### Fable verdicts on the three prepared changes (dev replay pairs, 00:00Z 2026-10-02) — rule applied as written
| change | base | variant | gain (95%) | hard fails | verdict |
|---|---:|---:|---:|---:|---|
| Looking for work — fallback rule reworded (v2) | 7.50 | 7.81 | +0.30 (±0.26) | 4 → 3 | BUILD (at the threshold) |
| Call Center — "no policy on file", heard turns | 7.70 | 7.77 | +0.07 (±0.22) | 5 → 4 | DO NOT BUILD |
| Sales — "how to say it", heard turns | 8.08 | 8.08 | +0.00 (±0.10) | 0 → 0 | DO NOT BUILD |

40 of 40 rows judged on both sides of each pair; same-answer rows scored differently: 0.
* **Call Center:** one capped answer repaired (DCC-032 4.0 → 7.9, an invented policy gone), but the "check how … is
  handled and come back to you" line reads as an agent unsure of their own process (DCC-004 9.1 → 8.3) and repeats
  across turns of one call (DCC-033 8.8 → 7.8). The uniform shape I flagged as the open risk is what the judge
  marked down.
* **Sales:** small gains where a preamble went (DSALES-002 8.2 → 8.9, DSALES-005 6.6 → 7.4) cancelled by a direct
  yes/no question bounced into discovery (DSALES-006 7.9 → 6.3, important_question_unanswered).
* **Looking for work:** gains where a holding line or a deflection was replaced (DJOB-032 4.9 → 8.9, DJOB-024
  4.3 → 6.1, DJOB-016 6.2 → 7.4, DJOB-013 7.0 → 8.2); small losses on four answers that were fine (−0.3 to −0.9).
  The conditional sentence is still read as a dodge when it follows a recital of the résumé ("Facing that kind of
  situation, I'd…", 6.1), and one edit introduced a false detail (DJOB-037: "a contract" for a role the résumé does
  not mark as one, 3.8). So the gain is real on this sample but thin: it goes to app runs and a holdout read under
  the fix14 promotion rule, not straight into the kept build.
* aq-fix2 `2a2caed0`: the composer notice and its tests are deleted (composer byte-identical to e000db4a); the
  candidate is the Looking-for-work rule alone. App runs started 00:01Z: `aq2-dev-fix14`, `aq2-holdout-fix14`
  (Looking for work only, guarded by when-quiet and the stall watchdog).
* First reading of the Fable scale: stricter at the top. Best of the 40 Looking-for-work replies 9.44; "No material
  issue" still comes with a concrete nit and 9.3–9.4. A 9.5 mode mean is further away under this judge than under
  gpt-6-astra; the agreement table on the kept build's dev rows will say by how much.

### The kept build under the Fable judge, and the two judges compared (00:28Z 2026-10-02)
| | dev (360) | holdout (270) |
|---|---:|---:|
| kept build (fix13), Fable | 8.29, p10 5.63, 23 hard fails | 8.35, p10 5.82, 13 hard fails |
| same answers, gpt-6-astra vs Fable | 8.49 vs 8.27 (342 shared) | 8.45 vs 8.34 (260 shared) |
| rank correlation (Spearman) / hard-fail kappa | 0.88 / 0.67 | 0.83 / 0.54 |

* The judges order answers alike; Fable is 0.1–0.2 lower on the mean, flags fewer hard fails (dev 23 vs 37) and is
  stricter at the top: 67 of 360 dev answers reach 9.5. Per mode on dev: Lecture 8.86, Team Meet 8.72, Seminar 8.53,
  Recruiting 8.45, General 8.33, Sales 8.27, Technical interview 8.25, Call Center 7.65, Looking for work 7.57.
  No mode is near 9.5 under either judge.
* Where Fable takes the points: intent fulfilment 7.8 and direct usefulness 7.6 against correctness 8.6 and grounding
  8.6. Flags on dev: insufficient_answer 23, important_question_unanswered 20, missed_available_evidence 15,
  unsupported_personal_claim 9. The remaining cost is replies that do not answer, not invented claims.
* **fix13 (typed refinement notice) is confirmed by the judge:** its re-run rows against fix12's, dev +1.52 (±0.84)
  on 17, holdout +1.61 (±1.65) on 10; hard fails 1 → 0 and 1 → 1.

### fix14 (Looking-for-work fallback, aq-fix2 2a2caed0) — app runs judged: NOT promoted
* dev (40 app rows vs the kept build's): −0.01 (±0.39), hard fails 5 → 4. holdout (30): +0.09 (±0.24), 3 → 3.
* Rule 1 (holdout gain with the interval excluding 0) and rule 4 (dev app rows agree in sign) are not met. fix13
  stays the kept build; the rule change stays a candidate on `fix/aq-astra-i6`.
* Why the replay said +0.30 and the app said 0: the replay ran ONE set of drafts through two verifier prompts; the
  app runs compare two different samples of the generator's drafts, and that sampling alone moves a 40-row mode by
  about ±0.4 (the same closing sentence scored 8.8 in one sample and 5.0 in the other, DJOB-026). An app re-run
  cannot see an effect of this size. For a change that touches only the claim pass, the same-draft comparison is the
  instrument with the power to decide; the app run is for what it alone shows (validators, latency, breakage).

### The claim pass itself, measured without sampling: draft vs shown on the same rows (dev, Fable, 00:28Z)
`tools/edit-pairs.mjs` writes, for every row the pass edited, the streamed draft and the shown answer; both are
judged against the same recorded conversation. 111 of 360 dev rows were edited.
| | edits | draft | shown | change (95%) | hard fails |
|---|---:|---:|---:|---:|---:|
| all | 111 | 7.23 | 7.32 | +0.10 (±0.31) | 31 → 12 |
| heard | 91 | 7.27 | 7.47 | +0.20 (±0.36) | 27 → 9 |
| typed | 20 | 7.06 | 6.67 | −0.39 (±0.51) | 4 → 3 |
| draft had a hard fail | 31 | | | +1.56 | |
| draft had none | 80 | | | −0.47 (20 worse by a point or more, 3 better) | |

Heard, by mode: Team Meet +0.48 (±0.42, 15), Call Center +0.67 (15, 5 → 2), Technical interview +0.71 (4),
Looking for work +0.22 (24, 12 → 4), General −0.05 (8), Sales −0.13 (12), Seminar −0.32 (5), Recruiting −0.46 (8,
2 → 0).
* The pass does what it was built for (hard fails 31 → 12) and pays for it on the 80 drafts that had nothing to cap:
  it removes supported or harmless content and leaves a thinner reply. An oracle that edited only the capped drafts
  would add about +0.10 to the dev mean — that is the whole ceiling of verifier tuning.
* Kinds of harm seen: a résumé in two versions re-opened as "given two ways" although the draft had used the
  current one (DJOB-031 9.6 → 5.1, DJOB-032 8.9 → 5.6) — while the same rule helps a genuine conflict (two prices on
  one sheet +1.3, two refund rules +1.1); a drafted thank-you cut to 27 words (DSEM-020 9.5 → 7.1); a plan question
  turned back on the interviewer (DJOB-017 8.4 → 5.6).

### Rules written 00:28Z, BEFORE the holdout draft-vs-shown pairs are judged
**I27a — typed turns.** The claim pass is switched off on typed turns if, on holdout, the typed edits' change is
≤ 0 and the pass removes at most one hard fail there. (Dev: −0.39, 4 → 3.) Otherwise typed keeps it.
**I27b — a mode's heard turns.** A mode keeps the pass unless dev and holdout BOTH show a negative change AND the
pass removes at most one hard fail in that mode over dev and holdout together. Hard-fail reduction ranks first, so
a mode where the pass removes two or more hard fails keeps it whatever the mean says.
**I27c — Looking for work: no conflict step, plus the v2 fallback.** A candidate does not tell an interviewer that
their own résumé "gives it two ways"; the generator already follows the current version. Evaluated on the SAME
drafts (the kept build's Looking-for-work drafts through the fix12 verifier and through the variant): build if the
dev gain is at least +0.3 with the interval excluding 0 and hard fails are not up; promote if the holdout same-draft
gain is positive with the interval excluding 0 and hard fails are not up.
**Protocol for a change that touches only the claim pass:** same-draft pairs on dev, then on holdout (aggregates
only), then ONE app regression run for validators, latency and breakage. App re-runs are not used to measure it.

### Holdout draft-vs-shown pairs: the claim pass pays on every surface and mode — I27a and I27b change nothing
| holdout (66 edited rows of 270) | edits | draft | shown | change (95%) | hard fails |
|---|---:|---:|---:|---:|---:|
| all | 66 | 6.69 | 7.21 | +0.52 (±0.45) | 25 → 6 |
| heard | 52 | 6.87 | 7.31 | +0.44 (±0.41) | 18 → 6 |
| typed | 14 | 6.02 | 6.85 | +0.83 (±1.51) | 7 → 0 |
| draft had a hard fail | 25 | 4.36 | 6.36 | +2.00 (±0.71) | 25 → 5 |
| draft had none | 41 | 8.11 | 7.72 | −0.38 (±0.37) | 0 → 1 |
* I27a (typed off): not met — holdout typed is positive and removes 7 hard fails. Dev's −0.39 did not hold.
* I27b (a mode off): not met — every mode's heard change is positive on holdout.
* What holds on both sets: +1.6 to +2.0 where the draft had a cappable claim, −0.4 to −0.5 where it had none. The
  claim pass is confirmed by a second judge with no sampling in the comparison; its residual cost is editing drafts
  that needed no edit (about 0.06–0.10 on the overall mean). The replayed lists do not separate the two groups by
  kind or count ([self]-only lists: 6 of 21 drafts cappable; lists naming a past fact: 19 of 55), so there is no
  code-side gate to add.

### I27c (Looking for work: v2 fallback, no conflict step) — same-draft on dev: NOT built
* The kept build's 40 dev drafts through the fix12 verifier and through `_cv-lfw-i27.mjs`: 7.63 → 7.76,
  +0.13 (±0.39), hard fails 4 → 3. Under the written rule (+0.3, interval excluding 0): not built.
* The conflict case moved both ways: DJOB-031 4.7 → 9.6 (no more "given two ways"), DJOB-032 8.9 → 4.7 (this
  sample's edit hedged on its own). The verifier's own sampling moves one draft by several points (DJOB-032: 5.6
  shown in the app, 8.9 and 4.7 in two replays), so a single-sample same-draft pair on 40 rows cannot resolve an
  effect under about ±0.4 either. Looking-for-work wording is at its noise floor; no further wording is tried.

### Reasoning on for the generator (Technical interview + Lecture, dev prompts, Fable) — the first material lever
The app sends `thinking: disabled` on every DeepSeek turn. Same 80 recorded dev prompts, reasoning off vs
`thinking: enabled, reasoning_effort: low`, one sample each (two independent generations, so sampling is included):
| | n | off | low | change (95%) | hard fails |
|---|---:|---:|---:|---:|---:|
| Technical interview | 40 | 8.26 | 8.87 | +0.62 (±0.48) | 7 → 2 |
| Lecture | 40 | 8.66 | 9.11 | +0.44 (±0.45) | 3 → 0 |
| both, heard | 49 | 8.50 | 8.98 | +0.48 (±0.41) | 6 → 1 |
| both, typed | 31 | 8.40 | 9.01 | +0.61 (±0.56) | 4 → 1 |
| both | 80 | 8.46 | 8.99 | +0.53 (±0.33) | 10 → 2 |
* Largest where an answer has to be worked out: complexity-only +1.3, dry run +1.6, leetcode +1.8, formula +1.0.
* Cost, measured on the same prompts (2026-10-01): first answer token 0.78 s → 2.22 s at the median, 1.0 s → 6.6 s
  at p95; total 1.4 s → 2.6–3.3 s. The repo's earlier decision to keep thinking off was measured on a Gemini
  model with executed LeetCode answers (12 of 12 at budget 0); this is a different model and a different result.
* **Rule, written before the holdout prompts are replayed:** the lever is confirmed if, on the 60 holdout Technical
  interview + Lecture prompts, low − off is positive with the interval excluding 0 and hard fails are not up. If
  confirmed, I28 is built for TYPED turns of those two modes on DeepSeek models (the user typed and is waiting for a
  written answer); the heard turns, where a first word at 2 s instead of 0.8 s is a product trade, are put to Evin
  with these numbers. If not confirmed, nothing is built.

### Reasoning lever CONFIRMED on holdout; I28 built for typed turns (aq-fix2 3b0c1a4f, branch `fix/aq-astra-i7`)
| holdout, 60 Technical interview + Lecture prompts | n | off | low | change (95%) | hard fails |
|---|---:|---:|---:|---:|---:|
| Technical interview | 30 | 8.16 | 8.97 | +0.82 (±0.64) | 5 → 0 |
| Lecture | 30 | 8.54 | 8.90 | +0.36 (±0.80) | 3 → 0 |
| typed | 21 | 8.19 | 9.04 | +0.85 (±0.74) | 3 → 0 |
| heard | 39 | 8.43 | 8.88 | +0.45 (±0.68) | 5 → 0 |
| all | 60 | 8.35 | 8.94 | +0.59 (±0.51) | 8 → 0 |
* The rule is met (positive, interval excludes 0, hard fails 8 → 0). Where the off answer had a hard fail the gain
  is +4.36 (8 rows); where it had none, +0.01 (52 rows): reasoning repairs wrong answers and leaves right ones alone.
* Total time on these prompts: 1.37 s → 2.84 s at the median, 2.3 s → 8.5 s at p95; 1 of 60 reasoning replies came
  back empty at a 6,000-token cap (the app's cap is 8,192).
* **Built (I28):** `electron/llm/answerReasoning.ts` — a typed question in Technical interview or Lecture sends
  `thinking: enabled, reasoning_effort: low` on DeepSeek; every other turn is byte-identical. The selected-provider
  turn adds 12 s to the first-token budget on those turns (default 8 s, parallel retry at 60%): without it a
  request that is still reasoning would be hedged or failed over as a stalled one. Kill switch
  `NATIVELY_ANSWER_REASONING=0`. Heard turns are not changed: +0.45–0.48 is on offer there for about 1.4 s more to
  the first word (p95 6.6 s) — Evin's decision.
* Tests: `npm run typecheck:electron` clean; llm suite 5,689 tests, 0 fail (28 skipped) with the new file's 17 —
  including the real compiled stream method over a recording stub (request carries the fields; reasoning chunks are
  never yielded); intelligence suite 2,807 / 0 fail; the three services suites that drive the DeepSeek stream
  111 / 0 fail.
* **What the app run is for, written before it starts (00:54Z).** The effect was measured on identical prompts
  on both sets; an app re-run resamples every draft and cannot measure it better. The run (dev and holdout,
  Technical interview + Lecture) has to show: (1) wiring — every typed row of those modes carries
  `thinking: enabled`, no heard row does; (2) nothing breaks — 0 failed rows, no empty answers, no more requests
  per turn than the kept build (a hedge would show as an extra request); (3) latency on the typed rows, first token
  and total, against the kept build; (4) the judged typed rows are not below the kept build's: fix15 is promoted if
  the typed-row change is positive on holdout with hard fails not up, and positive on dev. If (1)–(3) fail it is
  fixed or reverted; if (4) fails it stays a candidate.

### The reference build (fix6) against the kept build under Fable — the mean gain is NOT confirmed, the hard-fail cut is
| | fix6 | kept build (fix13) | change (95%) | hard fails |
|---|---:|---:|---:|---:|
| holdout (270), Fable | 8.28 | 8.35 | +0.07 (±0.14) | 24 → 13 |
| dev (360), Fable | 8.34 | 8.29 | −0.05 (±0.12) | 28 → 23 |
| holdout, gpt-6-astra (fix6 → fix12) | 8.02 | 8.43 | +0.41 (±0.23) | 60 → 31 |
| dev, gpt-6-astra (fix6 → fix12) | 8.24 | 8.49 | +0.25 (±0.18) | 66 → 38 |

* Both judges see the claim pass roughly halve hard fails on holdout. They disagree on what that is worth on the
  mean: gpt-6-astra caps an invented claim more often (60 hard fails on fix6 against Fable's 24) and so rewards its
  removal; Fable marks the thinner reply that is left about as low as the claim it replaced. Same-draft pairs say
  the same thing (dev +0.10, 31 → 12; holdout +0.52, 25 → 6 on the edited rows only).
* What this changes: nothing in the build — hard-fail reduction ranks first and holds under both judges. What it
  changes in the report: "holdout +0.41" is one judge's reading; under the other the kept build is mean-neutral
  against fix6 with half the hard fails, for +0.45–0.7 s to the settled answer and a text swap on a fifth of turns.
  Per mode on holdout under Fable no difference is outside its interval; Sales is the lowest at −0.22 (±0.38).
* Reported only: the Call Center and Sales notices on typed turns too — +0.10 (±0.36) and +0.08 (±0.19). Not built.

## The judge is gpt-6-astra ONLY again — Evin, 2026-10-02 01:00Z ("use gpt astra 6 only revert from using fable model")
* The Fable judge is withdrawn: `AQ_JUDGE=fable` now refuses to run (`astra/client.mjs`). No Fable call was in flight.
  Its series (`abs-dev-f1`, `abs-holdout-f1`, `*.judged-fable.jsonl`, the sections above dated 23:50Z–00:55Z) stays
  in the repository as a record and is NOT a result: no number from it goes into the report, and no decision rests
  on it.
* **Every decision it touched is re-opened and waits for gpt-6-astra:**
  | decision made on Fable scores | state now |
  |---|---|
  | fix13 (typed refinement notice) "confirmed by the judge" | kept on its objective rule, as before; its rows are unjudged |
  | Call Center / Sales notices "do not build" | undone: `fix/aq-astra-i6` is back at c399f399 (all three parts), pending |
  | Looking-for-work rule: replay "build", app runs "not promoted" | pending; the app rows (aq2-dev-fix14, aq2-holdout-fix14) are kept for gpt-6-astra to read |
  | claim pass on/off by surface or mode (I27a/b), no change | no change was made, so nothing to undo; the draft/shown pairs are queued |
  | Looking for work without the conflict step (I27c), not built | not built; not queued (a Fable-suggested variant) |
  | reasoning on, "confirmed", I28 built for typed turns | aq-fix2 3b0c1a4f on `fix/aq-astra-i7` is a CANDIDATE; both replay pairs are queued |
  | "the kept build's mean gain is not confirmed" | withdrawn; the gpt-6-astra reading stands (holdout +0.41 ±0.23, hard fails 60 → 31) |
* What does not depend on a judge and stays: the harness changes (decisions-first queue, base-before-variant,
  carried rows, `astra/decide.mjs`, `tools/edit-pairs.mjs`, out files named after the run directory), the app runs
  themselves, and every objective count.
* The rules stay as written; where a rule was written during the Fable hours it is restated here for gpt-6-astra,
  before any of these rows has a gpt-6-astra score:
  - **Reasoning lever (I28):** dev pair (80 prompts) gain ≥ +0.3 with the interval excluding 0 and hard fails not
    up; holdout pair (60 prompts, aggregate) gain > 0 with the interval excluding 0 and hard fails not up. Both met →
    fix15 is promoted if its app run is clean (wiring, no failures or extra requests, latency reported). Otherwise
    it stays a candidate and is not part of the kept build.
  - **The three "material cannot answer" parts:** as written on 2026-10-01 (dev pair ≥ +0.3, interval excluding 0,
    hard fails not up → build that part; then holdout).
  - **Looking-for-work app rows (fix14):** the fix14 promotion rule as written.
* `astra/queue3.mjs` (armed for 02:00Z, pid 58884): calibrate → fix13 rows → reasoning dev pair → reasoning holdout
  pair → Looking for work → Call Center → Sales → the candidates' app rows → Starting-column gaps → draft/shown
  pairs → the rest. The probe still fails at 01:01Z (account quota); if it has not come back by the end of the
  wait, nothing can be judged and the account needs a top-up.

### fix15 (I28, reasoning on typed Technical interview / Lecture turns) in the app — objective checks, no judge (01:28Z)
aq-fix2 3b0c1a4f, runs `aq2-dev-fix15` (80 rows) and `aq2-holdout-fix15` (60 rows), against the kept build's rows for
the same items (`tools/reasoning-check.mjs`, `tools/validators-paired.mjs`). Holdout: aggregates only.
| | dev | holdout |
|---|---|---|
| typed rows sending `thinking: enabled` | 31 of 31 | 21 of 21 |
| heard rows sending it | 0 of 49 | 0 of 39 |
| failed rows / empty answers | 0 / 0 | 0 / 0 |
| requests per typed turn | 1 on all 31 (kept build: same) | 1 on 20, 2 on 1 (kept build: same) |
| typed first token, p50 / p95 / max | 1.67 s / 5.39 s / 5.51 s (kept: 0.70 / 1.17 / 1.41) | 1.72 s / 6.34 s / 10.49 s (kept: 0.81 / 1.15 / 1.17) |
| typed total, p50 / p95 | 2.30 s / 6.06 s (kept: 1.39 / 2.77) | 2.52 s / 7.54 s (kept: 1.43 / 2.62) |
| heard first token, p50 | 0.99 s (kept: 1.03) | 0.86 s (kept: 0.96) |
| deterministic validators | 2 of 2 pass, as before | none apply; 0 verdicts changed |
* Wiring is as built: only typed turns of the two modes reason; heard turns are untouched in request and in latency.
* No turn was hedged or failed over: request counts equal the kept build's. One typed turn took 10.5 s to its first
  token; without the 12 s allowance the parallel retry would have fired at 4.8 s and the turn would have been
  abandoned at 8 s.
* The wire capture stores `thinking` but not `reasoning_effort`; that the effort sent is `low` is shown by the unit
  test over the compiled stream method, not by these rows.
* The validators say nothing here (they cover 2 of 140 rows). Whether the answers are better is the judge's question:
  the two replay pairs and these app rows are queued for gpt-6-astra. fix15 is a candidate until then.
* App stopped through its launcher, build output deleted (5.2 GB free).

### Corrections to the 02:00Z plan, written 01:32Z before any of these rows has a gpt-6-astra score
* **The reasoning pair that decides is now the change that was built.** fix15 reasons on typed turns only, but the
  queued pair regenerated every turn, heard ones included (49 of 80 dev, 39 of 60 holdout) — the same mismatch
  already corrected for the Call Center and Sales notices. New deciding sets `think-low-til-typed` and
  `think-low-til-hold-typed`: typed rows keep the reasoning answer, heard rows carry the reasoning-off answer (no
  judge call, a difference of exactly 0). The all-turns sets are judged afterwards and reported only: they are the
  evidence for the heard-turn question, which is Evin's.
* **The rule is not changed to fit.** As restated at 01:02Z it is on all 80 dev prompts (gain ≥ +0.3, interval
  excluding 0, hard fails not up) and on all 60 holdout prompts (gain > 0, interval excluding 0, hard fails not up).
  With 49 rows fixed at 0 that asks for about +0.77 on the 31 typed rows — harder than before, and accepted, as it
  was for Call Center and Sales. The typed rows alone are printed next to the verdict (`astra/decide.mjs`) so a real
  gain on the touched turns is visible even if the mode-level bar is not cleared; in that case fix15 stays a
  candidate and goes to Evin with the heard-turn numbers, not into the kept build.
* **Condition (4) of the 00:54Z rule is restored.** The 01:02Z restatement left it out, which made promotion easier
  between two writings. fix15 is promoted only if ALL hold: the dev pair and the holdout pair pass as above; the app
  run is clean (shown at 01:28Z); and the judged typed APP rows are not below the kept build's — positive on holdout
  with hard fails not up, and positive on dev (`aq2-*-fix15` against the fix13c composites, typed rows).
* Checked: every fix13 row has a judged fix12 counterpart in the composites (17 of 17 dev, 10 of 10 holdout), so
  that comparison cannot come back incomplete; every queued run's id equals its directory name, so the renamed out
  files are the ones the readers open.

### Reasoning turns and the output cap — checked 01:36Z, nothing to change
* Reasoning and answer share `max_tokens` (8,192 in the app). Across the 420 reasoning replays the completion size is
  407–490 tokens at the median, 955–1,907 at p95, 3,393 at most: the cap is not near.
* The one empty reply (1 of 420; holdout, a heard prompt) was not a cap stop: 111 completion tokens, 573 characters
  of reasoning, then no visible text. In the app a stream that closes before any visible text is an `empty-stream`
  failure to the fallback engine (`llm/streamFallbackEngine.ts`), so the turn goes to the parallel retry or the next
  provider instead of showing nothing. The 52 typed app rows had no empty answer.
