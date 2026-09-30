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
