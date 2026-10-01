# Natively answer quality — report after phase 3 (judge gpt-6-astra, charter v2)

Status 2026-10-01 12:35 UTC. Generator: deepseek-flash. Judge: gpt-6-astra through AgentRouter, charter v2
`c725615a54f6` (claim kinds), calibration 25 of 25. Every score in this report is under charter v2; nothing from
charter v1 is mixed in. Holdout is reported in aggregate only.

## 1. Outcome

* **Kept build: `fix12` = app commit `f0c3a263` on branch `fix/aq-astra-i5`. Not landed on main.**
* Holdout, paired against the previous reference (fix6): **8.02 → 8.43, +0.41 (±0.23)**, hard fails **60 → 31**,
  no mode down. Dev: 8.24 → 8.49, +0.25 (±0.18), hard fails 66 → 38.
* Against main as it was at the start (partial: the judge account ran out of quota before the baseline was fully
  re-judged under charter v2): holdout +0.52 (±0.27) on 202 common items, dev +0.86 (±0.27) on 201.
* **No mode is at 9.5.** Highest: Team Meet 9.12 and Recruiting 9.01 on dev; on holdout General 8.92. Lowest:
  Looking for work 7.74–7.88, Call Center 7.62–7.93. Section 9 says why local fixes do not close the gap.
* Price of the gain: the answer settles about 0.45–0.65 s later at the median (time to first word unchanged) and the
  text shown is replaced after streaming on 24–30% of turns. That trade is Evin's to accept or change (section 9).

fix12 is a composite for reporting: its only difference from fix11 is one Seminar-only clause in the verifier
prompt (every other mode's prompt is byte-identical, checked), so only Seminar was re-run and re-judged; the other
eight modes are fix11's runs and judgments (`tools/compose-run.mjs`, runs `aq2-*-fix12c`).

## 2. Iterations: attempted, kept, reverted

41 changes were tried; 25 are in the kept build, 16 were rejected or taken back. Every one is described, with its
evidence, in `docs/ITERATIONS-ASTRA.md`; every dev question with each run's answer is in `docs/ITERATIONS-QA.md`.

**In the kept build (25):** I1 small corpus read whole · I2 hidden arithmetic scratch block · I3 the user's own
life is remembered, not checked · I4 the recruiting hotkey is the interviewer's spoken words · I5 own-life rule
only in the job modes · I6 a heard question about the user's own life is theirs to answer · I7 no product material
→ no product facts · I8 claim verifier · I8b no-document product clause ·
I8c highlights kept, formatting-only edit is no edit · I9 Recruiting heard turns never plan as coding · I10 Call
Center states the rule, then verifies · I11 "Today" line · I13 Team Meet wording (superseded by I15) · I14 document
freshness status · I15 spoken replies do not open by reporting their notes · I16 no question handed back when
something answers · I18 the verifier lists, then rewrites; Team Meet and Recruiting verified · language rail ·
I21 every spoken General turn verified · I22 every Seminar turn verified · tidy edits · claim kinds (decisions,
ownership, small commitments are not claims; a conflict is surfaced) · source-word rail · I25 Seminar study scope.

**Rejected or taken back (16):** conflict wording · past-event notice · "use the specifics" · I13 wording in
the app · I17 removing the Today line · scratch-v2 · I19 technical second look · I20 missing-facts line · I23 "what
to say instead" · I24 early stop · a larger generator · the general honest-limit exemption (built as `e7325287`,
judged −0.02 ±0.24, reverted) · "an older version is not a conflict" · "keep every can't" in Call Center · gate-v2
(verify Lecture / Technical interview turns that carry a personal claim) · a Lecture voice rewrite.

**Promotion history under charter v2.** fix6 was the provisional reference. fix11 (fix6 + I16, I18, language rail,
I21, I22, claim kinds, source rail) cleared holdout by +0.42 (±0.22) and failed one pre-registered rule: a
supp-behavior validator the verifier itself broke. fix12 repairs that with one clause and was promoted on its own
holdout read. The holdout result confirms the bundle, not each part: by attribution on dev and holdout, the gain is
I18's list-then-rewrite (fix9: +0.30 ±0.25 on holdout over fix6); claim kinds are judged neutral and are kept for
what they do objectively (fewer edits, no decision turned into a question).

## 3. Scores, p10 and hard fails per mode

### Dev set

| Mode | Main mean | p10 | hard fails | fix6 mean | p10 | hard fails | fix12 mean | p10 | hard fails |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| General | 7.88 | 4.3 | 11/40 | 8.68 | 6.1 | 3/40 | 8.57 | 5.5 | 4/40 |
| Sales | 6.89 | 4.0 | 17/40 | 7.82 | 4.0 | 9/40 | 8.31 | 6.5 | 3/40 |
| Recruiting | 8.34 | 5.7 | 3/40 | 8.73 | 4.7 | 5/40 | 9.01 | 7.7 | 1/40 |
| Team Meet | 8.38 | 5.0 | 6/40 | 8.56 | 5.0 | 5/40 | 9.12 | 8.4 | 1/40 |
| Looking for work | 7.01 | 4.0 | 15/36 | 7.40 | 4.4 | 16/40 | 7.88 | 5.0 | 7/40 |
| Lecture | — | — | (4 judged) | 9.01 | 8.1 | 3/40 | 8.71 | 4.2 | 5/40 |
| Technical interview | — | — | (1 judged) | 8.01 | 4.0 | 10/40 | 8.21 | 4.0 | 9/40 |
| Seminar | — | — | — | 8.67 | 6.8 | 3/40 | 8.95 | 7.0 | 1/38 |
| Call Center | — | — | — | 7.29 | 4.0 | 12/40 | 7.62 | 4.0 | 7/40 |
| **All** | 7.73† | 4.0 | 53/201 | 8.24 | 4.0 | 66/360 | 8.49 | 5.0 | 38/358 |

† partial: judged on fewer than 90% of that mode's items (the judge batch ran out). Use the paired lines below, which compare common items only.

Paired on 201 common items, fix12 (dev) − aq2-dev-cur: +0.86 (±0.27).

Paired on 358 common items, fix12 (dev) − aq2-dev-fix6: +0.25 (±0.18).

### Holdout (aggregate only)

| Mode | Main mean | p10 | hard fails | fix6 mean | p10 | hard fails | fix12 mean | p10 | hard fails |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| General | 8.46 | 5.0 | 5/30 | 8.44 | 5.0 | 4/30 | 8.92 | 7.7 | 1/30 |
| Sales | 7.38 | 4.0 | 9/30 | 8.10 | 4.0 | 5/30 | 8.49 | 6.9 | 3/30 |
| Recruiting | 7.95 | 5.0 | 4/30 | 8.71 | 5.5 | 3/30 | 8.86 | 7.6 | 2/30 |
| Team Meet | 8.79 | 5.0 | 4/30 | 8.43 | 5.0 | 6/30 | 8.45 | 4.9 | 4/30 |
| Looking for work | 6.53 | 4.8 | 16/30 | 7.31 | 5.0 | 11/30 | 7.74 | 5.0 | 7/30 |
| Lecture | 8.87 | 6.1 | 2/30 | 8.66 | 5.0 | 4/30 | 8.73 | 5.8 | 3/30 |
| Technical interview | 8.14† | 4.0 | 5/21 | 8.24 | 4.0 | 6/30 | 8.46 | 6.6 | 3/30 |
| Seminar | — | — | — | 7.65 | 3.0 | 7/30 | 8.29 | 6.3 | 3/30 |
| Call Center | — | — | (1 judged) | 6.66 | 4.0 | 14/30 | 7.93 | 4.0 | 5/30 |
| **All** | 7.99† | 4.0 | 46/202 | 8.02 | 4.0 | 60/270 | 8.43 | 5.0 | 31/270 |

† partial: judged on fewer than 90% of that mode's items (the judge batch ran out). Use the paired lines below, which compare common items only.

Paired on 202 common items, fix12 (holdout) − aq-holdout-fix2: +0.52 (±0.27).

Paired on 270 common items, fix12 (holdout) − aq2-holdout-fix6: +0.41 (±0.23).

### Hard-fail categories, dev (kept build)

| Mode | hard fails | by flag |
|---|---:|---|
| General | 4 | arithmetic_error 2, major_reasoning_error 2, reference_conflict_ignored 2, unsupported_policy_claim 1, unsupported_personal_claim 1, missed_available_evidence 1, important_question_unanswered 1 |
| Sales | 3 | unsupported_company_claim 2, major_factual_error 1, missed_available_evidence 1, unsafe_commitment 1 |
| Recruiting | 1 | unsupported_personal_claim 1, important_question_unanswered 1 |
| Team Meet | 1 | unsupported_personal_claim 1 |
| Looking for work | 7 | unsupported_personal_claim 6, fabricated_behavioral_story 2, important_question_unanswered 1, major_factual_error 1 |
| Lecture | 5 | major_reasoning_error 2, arithmetic_error 2, unsupported_personal_claim 1, major_factual_error 1, missed_available_evidence 1 |
| Technical interview | 9 | major_reasoning_error 4, major_factual_error 3, unsupported_personal_claim 3, missed_available_evidence 2, important_question_unanswered 1, unsupported_company_claim 1 |
| Seminar | 1 | unsupported_personal_claim 1, insufficient_answer 1 |
| Call Center | 7 | unsupported_policy_claim 4, important_question_unanswered 3, unsupported_company_claim 2, reference_conflict_ignored 1, unsafe_commitment 1 |
| **All** | 38 | unsupported_personal_claim 14, major_reasoning_error 8, important_question_unanswered 7, major_factual_error 6, unsupported_policy_claim 5, missed_available_evidence 5, unsupported_company_claim 5, arithmetic_error 4, reference_conflict_ignored 3, unsafe_commitment 2, fabricated_behavioral_story 2, insufficient_answer 1 |

### Hard-fail categories, holdout (kept build)

| Mode | hard fails | by flag |
|---|---:|---|
| General | 1 | unsupported_personal_claim 1 |
| Sales | 3 | unsupported_company_claim 2, fabricated_meeting_history 1 |
| Recruiting | 2 | unsupported_company_claim 1, unsupported_personal_claim 1, ai_epistemic_leak 1 |
| Team Meet | 4 | unsupported_personal_claim 2, unsupported_company_claim 2 |
| Looking for work | 7 | unsupported_personal_claim 4, important_question_unanswered 2, major_reasoning_error 2, role_confusion 1, coaching_instead_of_answer 1 |
| Lecture | 3 | unsupported_personal_claim 2, major_factual_error 1, fabricated_behavioral_story 1 |
| Technical interview | 3 | major_reasoning_error 2, code_incorrect 1 |
| Seminar | 3 | unsupported_research_claim 3, major_reasoning_error 1 |
| Call Center | 5 | unsupported_policy_claim 5, unsafe_commitment 1, reference_conflict_ignored 1 |
| **All** | 31 | unsupported_personal_claim 10, unsupported_company_claim 5, major_reasoning_error 5, unsupported_policy_claim 5, unsupported_research_claim 3, important_question_unanswered 2, fabricated_meeting_history 1, ai_epistemic_leak 1, role_confusion 1, coaching_instead_of_answer 1, major_factual_error 1, fabricated_behavioral_story 1, code_incorrect 1, unsafe_commitment 1, reference_conflict_ignored 1 |

## 4. Objective validators, time to first word and total latency

| Run | rows | validators pass | TTFT p50 / p95 ms | total p50 / p95 ms |
|---|---:|---:|---:|---:|
| Starting `aq2-dev-cur` | 360 | 5/9 (fails: DSALES-031, DSALES-026, DTECH-022, DTECH-023) | 990 / 2043 | 1498 / 2834 |
| Kept `aq2-dev-fix6` | 360 | 8/9 (fails: DTEAM-034) | 854 / 1386 | 1555 / 2761 |
| Final `fix12 (dev)` | 360 | 8/9 (fails: DTEAM-034) | 867 / 1593 | 2007 / 3413 |
| Starting `aq-holdout-fix2` | 270 | 2/2 | 965 / 1650 | 1438 / 2615 |
| Kept `aq2-holdout-fix6` | 270 | 2/2 | 779 / 1363 | 1485 / 2811 |
| Final `fix12 (holdout)` | 270 | 2/2 | 868 / 1644 | 2143 / 3665 |

## 5. Claim verifier: invocation rate and replacement rate

Invocation = the turn passes the verifier's gate (mode, surface, question, draft). Replacement = the shown text differs from the streamed draft.

**fix12 (dev)**

| Mode | turns | verifier runs | text replaced | spoken turns replaced |
|---|---:|---:|---:|---:|
| General | 40 | 19 (48%) | 8 (20%) | 8/19 |
| Sales | 40 | 40 (100%) | 14 (35%) | 12/28 |
| Recruiting | 40 | 40 (100%) | 11 (28%) | 8/27 |
| Team Meet | 40 | 40 (100%) | 16 (40%) | 15/28 |
| Looking for work | 40 | 40 (100%) | 27 (68%) | 24/32 |
| Lecture | 40 | 0 (0%) | 0 (0%) | 0/20 |
| Technical interview | 40 | 8 (20%) | 4 (10%) | 4/29 |
| Seminar | 40 | 40 (100%) | 8 (20%) | 5/32 |
| Call Center | 40 | 40 (100%) | 21 (53%) | 15/30 |
| **All** | 360 | 267 (74%) | 109 (30%) | 91/245 |

**fix12 (holdout)**

| Mode | turns | verifier runs | text replaced | spoken turns replaced |
|---|---:|---:|---:|---:|
| General | 30 | 17 (57%) | 7 (23%) | 6/16 |
| Sales | 30 | 30 (100%) | 7 (23%) | 5/21 |
| Recruiting | 30 | 30 (100%) | 7 (23%) | 5/21 |
| Team Meet | 30 | 30 (100%) | 6 (20%) | 3/21 |
| Looking for work | 30 | 30 (100%) | 16 (53%) | 15/24 |
| Lecture | 30 | 0 (0%) | 0 (0%) | 0/16 |
| Technical interview | 30 | 6 (20%) | 5 (17%) | 4/23 |
| Seminar | 30 | 30 (100%) | 5 (17%) | 5/24 |
| Call Center | 30 | 30 (100%) | 13 (43%) | 9/23 |
| **All** | 270 | 203 (75%) | 66 (24%) | 52/189 |



## 6. Latency impact in one line

Time to first word: unchanged (dev 854 → 867 ms, holdout 779 → 868 ms at the median; the verifier runs after the stream). Total time to the settled answer: dev 1555 → 2007 ms (+0.45 s), holdout 1485 → 2143 ms (+0.66 s) at the median; p95 2761 → 3413 and 2811 → 3665 ms. The verifier passes its gate on 74–75% of turns and replaces the shown text on 30% (dev) / 24% (holdout); on spoken turns 91 of 245 and 52 of 189.

## 7. The 20 worst remaining dev answers (kept build)

**DGEN-036** — General — 3.9 — arithmetic_error, major_reasoning_error, reference_conflict_ignored, missed_available_evidence, important_question_unanswered

> Q: And just so you're aware, if you weren't planning to renew you needed to give us sixty days, so that window's pretty much closed.
>
> A: The notice window doesn't change the rent number. The lease caps any renewal increase at 3%, and 3% of my current rent is two thousand two hundred sixty-five, not two thousand two fifty. So let's settle the increase first, and then we can talk about whether I'm renewing.

*Judge:* Instead of addressing the notice dispute, it repeats incorrect arithmetic and treats a cap as an exact required price, while ignoring conflicting notice periods, end dates, and rent figures.

**DLEC-028** — Lecture — 4.0 — arithmetic_error, major_reasoning_error

> Q: another one, different numbers
>
> A: Same method, new numbers. Take [_, 8, 3, 9, 5, 1, 7, 2], n = 8, so start at floor(8/2) = 4. Sift-down(4): 5 vs child 2 (i=8). Swap. Array: [_, 8, 3, 9, 2, 1, 7, 5]. Sift-down(3): 9 vs children 1 (i=6) and 7 (i=7). Swap with 1. Array: [_, 8, 3, 1, 2, 9, 7, 5]. Sift-down(2): 3 vs children 2 (i=4) and 9 (i=5). Swap with 2. Array: [_, 8, 2, 1, 3, 9, 7, 5]. Sift-down(1): 8 vs children 2 (i=2) and 1 (i=3). Swap with 1, the

*Judge:* The array has seven keys, not eight. The trace invents index 8, uses incorrect child indices, follows the wrong subtree, and produces a final array that violates min-heap order. The five-swap gist is also wrong.

**DGEN-012** — General — 4.0 — unsupported_policy_claim

> Q: Hi, this is Maria from the fraud team at your bank. We've blocked a suspicious charge of eight hundred forty dollars. To reverse it I just need you to read me the six digit code we just texted you.
>
> A: I'm not going to read out that code. My bank doesn't ask for one-time codes over the phone, and a real fraud team wouldn't need it to reverse a charge. I'll hang up and call the number on the back of my card to check this directly.

*Judge:* The refusal and independent callback are appropriate, but the claims about this bank's code policy and what its fraud team would need assert procedures that were not supplied.

**DGEN-035** — General — 4.0 — arithmetic_error, major_reasoning_error, reference_conflict_ignored

> Q: Hi Sam, it's Doug from Brightwater, just calling about your renewal. Rent's going to two thousand two fifty starting next term, which is in line with your lease.
>
> A: Two thousand two fifty is a 4.5% increase on my current rent, and the lease caps any renewal increase at 3%, which would put it at two thousand two hundred sixty-five. Can you walk me through how you got to that number?

*Judge:* It ignores conflicting rent figures and miscalculates the increase and cap. The actual 3% ceilings are $2,214.50 or $2,266; the gist also contradicts the answer by claiming $2,250 exceeds its stated $2,265 ceiling.

**DSALES-002** — Sales — 4.0 — unsupported_company_claim

> Q: How much?
>
> A: Before I put a number on it, it depends on how many people would be using it and which parts you'd need. Let me confirm the exact pricing for your setup and walk you through it on our next call.

*Judge:* It asserts that pricing depends on user count and required components without supporting evidence, then unnecessarily postpones the price discussion to another call.

**DSALES-035** — Sales — 4.0 — major_factual_error, unsupported_company_claim, missed_available_evidence

> Q: Why not?
>
> A: Because I don't control the date, your data does. Growth onboarding runs 4 to 6 weeks from signature, and that clock only starts once we have clean technician, customer and asset data in the first 10 business days. If we sign this week and your data lands quickly, November 1 is realistic. So the real question is your data readiness. Can we get your data owner on a short call tomorrow to confirm what's ready?

*Judge:* It incorrectly says the onboarding clock starts upon data receipt; the source measures from signature, conditional on timely clean data. This materially changes the timeline. It also largely repeats the previous answer instead of briefly explaining the constraint.

**DSALES-024** — Sales — 4.0 — unsafe_commitment

> Q: This sheet says go-live is guaranteed within thirty days. I'm going to need that written into the contract.
>
> A: I want to be straight with you on that one. The sheet does say go-live within 30 days of signature, but it's marked with an asterisk, and the footnote reads that timelines are estimates and depend on customer data readiness. So I can't put it in the contract as an unconditional guarantee. What I can do is commit to the 30-day target in writing and tie it to a data readiness checklist we agree on upfront, so the clock

*Judge:* It correctly explains the caveat, but offers to commit to a written 30-day target without confirming contractual authority or current terms from this expired sheet.

**DJOB-005** — Looking for work — 4.0 — fabricated_behavioral_story, unsupported_personal_claim, important_question_unanswered

> Q: Tell me about a project that didn't go the way you wanted. Maybe you missed a deadline, or shipped something that had to be rolled back. What happened, what was your part in it, and what did you change afterward?
>
> A: The honest one is Project Tern. I was tech lead on the carrier-settlement rewrite, a working group of 4 engineers and 1 QA analyst over 7 months, moving the Rails monolith into three Go services. What I'd say I took from it is writing the edge cases into the design doc first and getting sign-off before anyone wrote code.

*Judge:* The résumé supports Tern’s scope and leadership, not that it went badly or produced this lesson. The answer invents that framing and takeaway while never explaining what failed or the candidate’s responsibility.

**DJOB-016** — Looking for work — 4.0 — unsupported_personal_claim, fabricated_behavioral_story

> Q: How do you usually work with QA when you're in the middle of a big rewrite and everything's moving?
>
> A: On Project Tern I worked with one QA analyst across the whole seven-month rewrite, and the thing that made it work was keeping her in the loop from the design doc onward, not just at the end. We agreed early on what the contract tests had to cover, so she could build against the new Go services while the old Rails path was still live. That way we weren't saving all the verification for a big-bang cutover.

*Judge:* The résumé supports Tern’s duration and QA staffing, but not early design involvement, agreed contract-test coverage, parallel Rails/Go testing, or cutover practices. These invented details supply most of the behavioral answer.

**DJOB-018** — Looking for work — 4.0 — major_factual_error

> Q: Years of experience?
>
> A: I've been working as a backend engineer since 2020. I started at Brindlecap Labs in 2020 on a Python/Django inventory tool, and since mid-2021 I've been at Quillfeather Health building Kotlin services, mostly around scheduling and reliable messaging.

*Judge:* It treats the November 2022 résumé as current, falsely saying Tobias is still at Quillfeather despite his documented move to Larkspur in March 2023. The unnecessary chronology makes a simple answer misleading.

**DLEC-038** — Lecture — 4.0 — major_reasoning_error

> Q: And that's the same logic behind why cartels like the one we looked at last week keep falling apart.
>
> A: Cartels are the repeated-game version of the dilemma, and the reason they break down is that the conditions for cooperation don't really hold. A cartel works only if every member keeps output low and prices high, but each firm has a short-term gain from undercutting while the others hold the line. That temptation is the defection payoff, and it's always there. What makes it worse is that cartels can't rely on the end

*Judge:* An uncertain possibility of cartel breakup is not a known final round. The answer incorrectly invokes backward induction and suggests imperfect monitoring or delayed punishment prevents repeated-game cooperation, although sufficiently credible future penalties can sustain it.

**DLEC-012** — Lecture — 4.0 — arithmetic_error

> Q: using the slides' method, what's the elasticity if the cart cuts the price from 3.60 back to 3.00 and sales go from 400 back up to 500?
>
> A: Same range, so the same answer: |E| = 1.22, elastic. The midpoint formula gives the same number whichever direction the price moves, so cutting from $3.60 back to $3.00 with sales rising from 400 to 500 is just the Slide 5 example run in reverse. The percentage changes are -22.2% for quantity and 18.2% for price, and 22.2 divided by 18.2 is 1.22.

*Judge:* The final elasticity and classification are correct, but both percentage changes have the wrong signs for the requested reversal. This makes the worked explanation mathematically misleading despite its correct conclusion.

**DTECH-005** — Technical interview — 4.0 — major_factual_error

> Q: Here's a quick one. Someone wrote a Java method to check if two strings are anagrams. It turns both into char arrays, sorts both with Arrays.sort, and then returns first dot equals second. It returns false even for liste
>
> A: The bug is that `Arrays.sort` on a `char[]` sorts in place and returns `void`, so `first` and `second` are still the original unsorted arrays. Comparing them with `.equals` on arrays is also reference equality, not content equality, so it returns false even when the contents match. Here's the fix: ```java boolean isAnagram(String a, String b) { if (a.length() != b.length()) return false; char[] first = a.toCharArray(

*Judge:* The opening falsely claims the arrays remain unsorted because Arrays.sort returns void, contradicting Java's in-place behavior and the final explanation. The actual equality diagnosis and supplied code are correct.

**DLEC-023** — Lecture — 4.0 — major_factual_error, missed_available_evidence

> Q: the handout says the coffee cart is unit elastic at -1.00 but I'm pretty sure she said elastic in lecture. which one is right, what should I write on the midterm, and why would they come out different?
>
> A: Write elastic. The handout's own classification line says that for this course, unit elastic counts as elastic, and the coffee cart example lands at E = -1.00, so it's elastic by that rule. That's also why it sounds like a contradiction: -1.00 is the boundary value, and the handout is telling you to file it on the elastic side rather than treat it as its own category. They come out different because "unit elastic" is

*Judge:* The exam label follows the handout, but the answer wrongly endorses identical revenue implications for unit-elastic and elastic demand. It also omits the method distinction: original-value elasticity is -1.00; midpoint elasticity is approximately -1.22.

**DTECH-007** — Technical interview — 4.0 — major_reasoning_error

> Q: Don't write code yet. Count the islands in a grid of ones and zeros, except the grid is huge, millions of rows, and you can only stream it one row at a time with memory for about two rows. How would you approach it?
>
> A: The key constraint is that I can't hold the whole grid, so I can't do a normal flood fill. What I can do is keep a running label for each cell in the current row, and only ever compare it against the row above. So I process one row at a time. For each row, I look at the cells that are 1 and figure out which of them connect to a 1 directly above them in the previous row. Cells that touch a labeled component above inhe

*Judge:* Final root counting conflicts with recycling: closed islands disappear from the result, while retaining every root can exceed the memory limit. Path compression and rank do not fix this. Time complexity is omitted.

**DTECH-035** — Technical interview — 4.0 — major_factual_error

> Q: interviewer says this is wrong for some inputs, fix it: def length_of_longest_substring(s): seen = {} left = 0 best = 0 for right, ch in enumerate(s): if ch in seen: left = seen[ch] + 1 seen[ch] = right best = max(best, 
>
> A: The bug is that `enumerate(s)` yields `(index, char)` tuples, so `ch` is never in `seen`, and `right` is never defined. On `"abcabcbb"` it crashes with a NameError. You want the index as the loop variable and the character as the key. ```python def length_of_longest_substring(s): seen = {} left = 0 best = 0 for right, ch in enumerate(s): if ch in seen and seen[ch] >= left: left = seen[ch] + 1 seen[ch] = right best = 

*Judge:* The patch and final explanation are correct, but the opening falsely claims the already-unpacked loop leaves right undefined and crashes on 'abcabcbb'. The gist repeats the nonexistent unpacking issue.

**DTECH-021** — Technical interview — 4.0 — major_reasoning_error

> Q: What's the time complexity of this: the outer loop runs i from one to n, and inside it j starts at i and doubles each time while j is less than n, doing constant work per step.
>
> A: The outer loop runs n times, and for each i the inner loop doubles j from i up to n, which is about log(n/i) steps. Summing that over i gives O(n log n) overall, and the space is O(1) since it's just the two counters.

*Judge:* O(n log n) is a valid but loose upper bound, not the tight complexity this question calls for. The summation is Θ(n); both the answer and gist miss the central insight.

**DTECH-013** — Technical interview — 4.0 — major_reasoning_error, unsupported_personal_claim, important_question_unanswered

> Q: Tell me about Project Tern. Why split settlement into three services instead of keeping one, and how did you cut over without paying a carrier twice?
>
> A: I led Project Tern, a rewrite of our carrier-settlement service from a Rails monolith into three Go services. I coordinated a working group of 4 engineers and 1 QA analyst over 7 months. On the cutover, the thing that protected us was the reconciliation job. It compares carrier invoices against booked loads nightly. We drove monthly mismatches from 312 down to 41.

*Judge:* It omits the split rationale and invents a cutover role for the reconciliation job; nightly invoice/load comparison does not itself prevent duplicate payouts.

**DTECH-028** — Technical interview — 4.0 — major_factual_error, unsupported_company_claim, missed_available_evidence

> Q: So if you joined and owned this, what would you change first, how would you know it worked, and what would you leave alone?
>
> A: The first thing I'd change is the threshold, not the paging. One percent for five minutes is the same bar for a tier-1 checkout service and a low-traffic internal one, so I'd tier it by service criticality and traffic, and add a deploy-aware suppression window so the half that fire during deploys and clear on their own stop waking people up. I'd know it worked by watching pages per week drop from around 90 while the 

*Judge:* It invents existing multi-window burn-rate alerting despite the stated fixed-threshold setup, then proposes preserving it. Deploy suppression risks hiding real regressions, and “keep their coverage” provides no concrete success measure.

**DTECH-034** — Technical interview — 4.0 — major_reasoning_error

> Q: Now say windows arrive one at a time from a stream, and the pager can ask is minute t quiet at any moment. What changes in your design?
>
> A: The batch design doesn't survive, because there's no full list to sort. I'd keep the merged windows in a structure ordered by start, so each new window is inserted and merged against its neighbors in place, and "is minute t quiet" becomes a lookup for the window containing t. That's O(log n) per insert and per query instead of one O(n log n) pass.

*Judge:* The claimed O(log n) per insertion ignores merging k existing intervals. With ordinary balanced-tree deletions this takes O((k+1) log n); a logarithmic amortized bound needs explicit qualification.

## 8. Final regression set and supplementary sets

* Final set (1,038 items): last full run is fix6 (`aq2-final-fix6`, 0 failed rows, aggregate only). The fix12 run
  (`aq2-final-fix12`, with `aq2-sq-fix12`) is queued behind a quiet-machine guard (`tools/when-quiet.mjs`): another
  session's app instance was running, and two apps at once took the whole session down earlier. It is an objective
  read (failed rows, validators, latency); it is not judged.
* supp-behavior (72): fix12 validators 8 of 9 (fix6 8 of 9). The one failure is an unedited Lecture answer (Lecture
  has no verifier). Seminar: 5 of 5 (fix11 3 of 5, fix6 4 of 5).
* supp-quant (32), arithmetic validators: main 25 of 32; later builds 28–31 of 32 (fix6 31, fix10 29) — the same
  code path since I2, the spread is sampling.
* Not judged under charter v2 because the account quota ran out: supp-behavior, the blind A/B fix6 vs fix11, fix10,
  and about 45% of the starting baseline.

## 9. Remaining architectural weaknesses (stop condition B)

The loop stops changing production code here. What is left needs design work, not another rule; each item is
written up with the measurements, a proposal, expected benefit and risk in `docs/BLOCKERS-ASTRA.md`.

1. **Questions only the user can answer** (why they left, what they want, a weakness, a story; an introduction with
   no profile). The generator invents; the verifier removes the invention and what is left is a deflection. On dev,
   from fix6 to fix11, the judge's "question left unanswered" flag went 11 → 34 while invented-claim flags went
   55 → 23. Proposal: a
   personal answer bank in Profile Intelligence, retrieved before generation. This is the largest remaining lever
   for Looking for work (7.7–7.9) and for the no-profile turns of Sales, Recruiting and Seminar.
2. **The generator's own reasoning errors** (arithmetic, complexity, a wrong trace): 15 of the 38 dev hard fails
   and 7 of the 31 on holdout, mostly Technical interview and Lecture. A second look by the same model did not find them and a larger
   model of the same family scored no better. Proposal: code execution that gates the answer (the module exists but
   runs after the answer is shown and is off), and a stronger reasoning model for those two modes.
3. **The verifier replaces text the user is already reading** (24–30% of turns, ~0.9 s after the last word).
   Options: hold the answer until verified, or show the change as a visible diff. A product decision.
4. **Call Center with no policy document** (5 of 30 holdout hard fails, all `unsupported_policy_claim`): with no
   policy in the material, a helpful agent reply needs one. Proposal: require a policy pack for this mode, or mark
   the answer as "generic procedure — confirm" in the UI instead of in the words.
5. **A conflict inside the material** is found by the list step and surfaced about half the time. Proposal: carry
   the conflict out of the pass as its own chip next to the answer.
6. **Measurement.** Per-mode differences under about ±0.5 on 30–40 items are not results. The judge ran out of
   account quota (`insufficient_user_quota`) mid-batch; nothing more can be judged until it is topped up. Retrieval
   was lexical in every run (no embedder weights in the worktrees), on both sides of every comparison.

## 10. Recommended next step

1. Decide the swap behaviour (item 3) and whether +0.41 on holdout is worth it; then review and land
   `fix/aq-astra-i5` (`f0c3a263`). Kill switch: `NATIVELY_CLAIM_VERIFIER=0`.
2. Build the personal answer bank (item 1) — the only change on the list that moves Looking for work toward 9.
3. Make code verification gate the coding answer (item 2).
4. Top up the AgentRouter quota and re-judge the rest of the starting baseline so the "starting" column is complete.

## 11. Completion report (project format)

### Change summary
* Files changed (app, branch `fix/aq-astra-i5`, since fix6): `electron/llm/claimVerifier.ts`,
  `electron/IntelligenceEngine.ts`, `electron/ipcHandlers.ts`,
  `electron/llm/__tests__/ClaimVerifier2026_09_30.test.mjs`. Harness (branch `fix/aq-astra`):
  `benchmarks/natively-answer-quality/**`.
* Behavior changed: the post-stream claim verifier lists unsupported statements before rewriting, covers Team Meet,
  Recruiting, every spoken General turn and every Seminar turn, leaves decisions / ownership / small commitments
  alone, never ships an edit in another language or one that names its own sources, and in Seminar keeps "we did
  not measure that".
* Shared modules affected: the what-to-answer path (IntelligenceEngine) and the typed chat path (ipcHandlers), both
  through `claimVerifier.ts`. Platform-specific modules affected: none.

### Cross-platform analysis
* Expected macOS behavior and expected Windows behavior are the same: the change is prompt text, regular expressions
  and string handling in TypeScript. No `process.platform` branch, no path, shell, child process, window, audio,
  capture, storage or packaging change.
* Existing platform implementations reviewed: none are touched; the two call sites are shared code.
* Affected flows: live "what to answer" and typed chat in the seven verified modes. Impact radius: the two call
  sites and the renderer's existing replace-after-stream handler (unchanged).
* Potential regressions: the text swap after streaming and +0.45–0.65 s to the settled answer; deflection on
  questions with no stored answer (section 9).

### Validation
* `Covered by automated macOS branch tests`: `npm run test:llm` on `f0c3a263` — 5,672 tests, 5,644 pass, 0 fail,
  28 skipped (no platform branches in the change; the suite ran on macOS only).
* `Tested physically on macOS`: the benchmark drives the real app (`npm run dev:agent`, development build) over CDP;
  renderer and answer pipeline only.
* `Reviewed but not executed on Windows`. `Requires physical Windows verification` for the app as a whole; nothing
  in this change is platform-sensitive.
* Not validated: a packaged build; the swap as a user sees it in the overlay (measured from the pipeline, not
  watched).

### Commands executed
`npm run test:llm` · `node tools/supervise.mjs --root <aq-fix2> --runs dev:…,holdout:…,supp-behavior:… --fresh-userdata`
· `node astra/arm.mjs 1100 …` (calibrate, judge) · `node astra/paired.mjs …` · `node tools/verifier-replay.mjs …` ·
`node tools/oververify.mjs …` · `node tools/limits-lost.mjs …` · `node tools/compose-run.mjs …` ·
`node astra/final-report.mjs --suffix -c2 …` · `node tools/iterations-qa.mjs`.

### Remaining risks
Windows not executed; packaged build not validated; holdout confirms the bundle, not each part; the starting
baseline under charter v2 is partial; the final regression run for fix12 is not finished at the time of writing.
