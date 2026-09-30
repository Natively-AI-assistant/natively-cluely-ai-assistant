# Authoring brief v2 — Natively answer-quality datasets

You write INPUTS ONLY for a benchmark of Natively, a real-time meeting copilot. A separate, blind judge
reads the answers later. Never write an expected answer, model answer, outline, or rubric.

Read the v1 brief first for the base rules and the JSON item format:
`/Users/evin/natively-cluely-ai-assistant/benchmarks/natively-answer-baseline/dataset/AUTHORING.md`.
Everything there applies EXCEPT the counts and the extra fields defined below.
DO NOT read anything else under `benchmarks/` (no results, no other datasets): your set must be independent.

## The nine modes and who the user is

| key | user (the person using Natively) | other party | what Natively gives |
|---|---|---|---|
| general | anyone, no specialised role | whoever they talk to | the most useful next thing; no forced persona |
| sales | seller / account executive | prospect / customer | words the seller can say next |
| recruiting | recruiter / interviewer | candidate | the recruiter's next probe, an evaluation, or the recruiter's answer when the CANDIDATE asks the recruiter something |
| team-meet | team member / lead in a meeting | colleagues | constructive words for the user in the meeting |
| looking-for-work | job candidate | interviewer / recruiter | what the candidate says, in first person |
| lecture | student / learner | professor (lecture audio) | explanation for the student (private, need not be speakable) |
| technical-interview | candidate | technical interviewer | explanation, reasoning, code, complexity, system design |
| seminar | presenter / researcher / student defending work | examiner / audience | presenter's answer grounded in the attached material |
| call-center | support agent | customer | words the agent says next |

Surfaces (same as v1): `speaker: "other"` = a line HEARD from the other party (user presses a hotkey for
what to say next). `speaker: "user"` = the user TYPES a request to the copilot privately.

## Extra fields (add to every item)

* `claim_trap`: which kind of claim a careless answer would invent, one of:
  `none` | `personal_preference` (relocation, remote, salary expectation, likes/dislikes) |
  `personal_history` (stories, metrics, employers, projects) | `company_fact` (product capability, integration,
  SLA, pricing, support contact, security/compliance) | `meeting_history` (what was decided/said before) |
  `support_policy` (refunds, verification, escalation powers, timelines) | `research_claim` (results, numbers,
  methods not in the material) | `role_confusion` (who is speaking / who is addressed is easy to get wrong) |
  `code_correctness` (the code or complexity is easy to get subtly wrong)
* `needles`: for items whose good answer DEPENDS on attached material (grounded doc, prior transcript, or
  profile), 1–3 SHORT exact substrings copied verbatim from that material (a number, a name, a term, 1–6 words)
  that the answer needs. Otherwise `[]`. These measure whether the right evidence reached the model.
* `evidence_required`: true when a correct answer must come from the supplied material rather than general
  knowledge; false otherwise.
* `pi_ref`: `null` or a Profile Intelligence id (see below).

## Profile Intelligence (PI) — résumé + job description

PI is the user's uploaded résumé and target job description. It is ONLY supposed to be used in
`looking-for-work` and `technical-interview`. Profiles live in
`/Users/evin/natively-cluely-ai-assistant/benchmarks/natively-answer-quality/dataset/pi/profiles.json`
(ids like `PI-A`, `PI-A-RESUME` = résumé only, `PI-A-JD` = JD only, `PI-B`). Read it if your mode needs it.

* looking-for-work / technical-interview: mix PI conditions — `null` (no PI), résumé only, JD only, both,
  both + a relevant reference doc, both + an irrelevant doc, both + a conflicting doc. Include questions the
  profile CAN answer (needles from it) and questions it CANNOT (e.g. relocation, a conflict story, salary
  expectation, reason for leaving when the résumé does not say) — those are `claim_trap` traps. For
  technical-interview, include pure DSA/coding questions WITH PI loaded (PI must not hijack them).
  Include at least 2 items that switch profile (`PI-B` after `PI-A` items) so stale-profile leakage shows.
* every OTHER mode: a few items (count in your addendum) set `pi_ref: "PI-A"` with a question where a careless
  system might pull in the résumé (e.g. "tell them a bit about my background", "what's my experience with X")
  and tag them `pi_leak_probe`. The correct behaviour is to NOT use the résumé.

## Context mix (per set, approximately)

~50–60% `none`, 20–25% `grounded` (doc and/or prior_transcript; give needles), ~10% `irrelevant`,
5–10% `conflicting`. Chains (multi-turn, same rules as v1) count toward these. Keep difficulty ~25/45/30
easy/normal/hard; ≥15% very_short; ≥10% long_multipart. Tag ambiguous / insufficient_info / adversarial
generously. Write NEW contexts (synthetic, fictional companies/people/numbers). Grounded docs 350–800 words,
irrelevant 150–300, conflicting 250–500 with ≥3 deliberate contradictions listed in `notes`.

Stress the things a real-time copilot gets wrong: inventing personal facts, preferences, stories and metrics;
promising product capabilities, SLAs, integrations, prices, discounts or contract terms the material doesn't
state; inventing support procedures and refund/verification rules; claiming prior meeting decisions
("as we agreed last week") that no material records; confusing who is speaking (e.g. a candidate asking the
recruiter a question); coaching the user ("focus on…", "you could say…") when the moment needs the words
themselves; wrong code or complexity; ignoring or contradicting the attached material; answering from an
irrelevant attachment; a follow-up ("why?", "simpler", "another one") that needs the previous turn.
Also include plenty of ordinary, easy, realistic turns — the set must not be only traps.

## Output

Write exactly the file(s) named in your addendum, same top-level shape as v1: `{ "mode", "partition",
"contexts": [...], "items": [...] }`. Context ids and local_ids must be prefixed as your addendum says so they
never collide with other sets. Validate JSON with node and print counts by category, context_condition,
speaker, claim_trap, pi_ref, chains. Reply with a compact counts table only.
