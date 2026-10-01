# Remaining weaknesses that local fixes do not solve

Status 2026-10-01. Each entry: the blocker, why prompt or verifier changes are not enough (with the measurements),
a proposed design, the expected benefit and the risk. Nothing here is built.

## 1. Looking for work: questions only the candidate can answer

**Blocker.** Motivation, reasons for leaving, an employment gap, salary expectation, relocation, notice period,
weaknesses and behavioural stories ("a project that didn't go the way you wanted") need facts that exist nowhere in
what Natively is given. The résumé and job description hold roles, dates, projects and metrics; they do not hold why
the candidate left or what they want.

**Why local fixes are insufficient.**
- The generator invents a plausible answer every time ("I took that time deliberately…", "the first cut of the
  service boundaries was wrong"). Five prompt formulations moved this by 0–0.5 points (I3, I5, I6, the past-event
  notice, the own-life rule).
- The claim verifier can only take the invention away. What is left is a deflection ("What would you like to know
  about that stretch?") or a holding line ("Why I'm looking, I'll confirm and come back to you on"). The judge scored
  both the invention (cap 5) and the deflection (6.0–7.7) below a real answer; rules for "what to say instead" scored
  +0.13 (±0.44) and the judge capped a reframed motive ("what draws me to this role") as well.
- Three rewordings of the verifier's rewrite step (scratch-v2, kinds-v3, kinds-v4) changed which fallback appears, not
  whether the question is answered. About 9 of 40 dev Looking-for-work items are of this kind; they hold the mode
  near 8.0–8.3 however the rest is tuned.

**Proposed architecture: a personal answer bank in Profile Intelligence.**
- A structured section of the profile the user fills once (or Natively drafts from a short interview and the user
  confirms): why I'm looking / why I left each role; what I did in a gap; salary range and what it depends on;
  relocation, travel, on-site, notice period; two or three strengths and a real development area; three to five
  stories (situation, action, result) tagged by theme (conflict, failure, leadership, ambiguity).
- Retrieval: the question classifier that already detects these asks (the personal-commitment notice, `TI_PERSONAL_RE`,
  `LIFE_RE`) routes them to the bank first. A hit is evidence like any résumé line, so the verifier keeps it.
- A miss is explicit: the answer is a short truthful line plus a private cue to the user ("no saved answer for
  'reason for leaving' — add one in Profile"), instead of an invented or evasive reply. Typed surface: offer to
  draft the entry.
- No new model call on the live path; one more retrieval source.

**Expected benefit.** These items go from capped (4–5) or evasive (6–7.7) to grounded answers; on the dev mix that is
roughly +0.8 to +1.2 on the mode mean and most of its remaining hard fails. It also removes most verifier edits in
this mode (27 of 32 spoken turns are replaced today).

**Risk.** Needs UI and onboarding work and the user's time; a stale bank answers wrongly with confidence (needs a
"last reviewed" date); stories are personal data and must stay local with the rest of the profile.

## 2. Technical interview: errors of the generator itself

**Blocker.** The capped answers are wrong technical statements: an LRU cache built on a list where O(1) was asked, a
Θ(n) sum reported as O(n log n), debit and credit reversed, a dry run with the wrong parameter, repeatable-read
described as preventing write skew.

**Why local fixes are insufficient.**
- A second look by the same model found 2 of 7 known errors and one of its two corrections was itself wrong (I19).
- A larger model of the same family scored 7.38 vs 7.32 on this mode with the same prompts.
- The mode's mean swings ±0.8 between runs because which answers fail changes with sampling.

**Proposed architecture.**
- Deterministic first: the verified-code-execution module already in the app (`electron/llm/codeVerification`:
  extract tests, run in a sandboxed subprocess, one correction) is switched off by default. Measured separately
  (run `aq2-dev-fix10-cv`). It can catch wrong output, not a missed complexity requirement or a wrong explanation.
- For reasoning (complexity, isolation levels, system design): route the Technical interview and Lecture modes to a
  stronger reasoning model with a small thinking budget, on the typed surface first where latency allows, and keep
  the fast model for the first spoken words.
- A requirement check that is generic, not per problem: when the ask states a bound ("constant time", "O(log n)"),
  ask the model for the bound of its own code as a separate short call and compare the two strings.

**Expected benefit.** Unknown until measured; the hard fails here are 7–10 of 40 on dev and holdout.

**Risk.** Latency and cost of a second model; executing generated code (already sandboxed, was disabled for a
reason that should be confirmed with its author).

## 3. The verifier replaces text the user is already reading

**Blocker.** The verifier runs after the stream (time to first word is unchanged) and replaces the answer when it
edits it. In fix8 that happened on 117 of 245 spoken turns, 0.7–1.0 s after the last word.

**Why local fixes are insufficient.** The pass cannot start before the draft exists, and its cost is the second
request's round trip (stopping early on "nothing to change" saved nothing).

**Options (a product decision).**
- Hold the answer until it is verified in the modes where it runs: nothing changes on screen, first word ~1 s later.
- Keep streaming, mark the answer as "checking" and apply the edit as a visible, minimal diff.
- Verify only when the draft trips a cheap local detector (first-person past tense, a price, a policy word).
  Fewer swaps, but the judged gain came from the claims such detectors miss.

## 4. A conflict inside the material is found but not always surfaced

The verifier's list step names the conflict reliably (10 of 10 in replay), the rewrite acted on 6. Deleting or
rewriting in code is not safe (about a fifth of what the model lists is a listing mistake it then corrects itself).
A structured alternative: carry the `CONFLICT:` line out of the pass and show it as its own chip next to the answer
("the sheet gives two prices for Salesforce: included / $300 a month"), so the user sees it even when the sentence
did not change.

## 5. Measurement limits

- The judge's own scatter on one answer is large (the same reply 9.7 and 5.0 across samples of the edit; asking for
  the account e-mail scored 10.0 on one item and 4.0 on another). A per-mode difference under about ±0.4 on 40 items
  is not a result.
- A charter change re-keys everything; v1 and v2 numbers must not be compared.
- No embedder weights in the worktrees: retrieval was lexical in every run, on both sides of every comparison.
