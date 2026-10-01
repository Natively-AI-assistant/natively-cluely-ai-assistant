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
