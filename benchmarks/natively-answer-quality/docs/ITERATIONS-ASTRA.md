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
