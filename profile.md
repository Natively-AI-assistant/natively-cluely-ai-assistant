You are working on Natively’s Profile Intelligence / Context Intelligence system.

The current system is seriously broken.

During a live meeting, profile intelligence responses take around 7+ seconds, and the answers are often completely wrong or context-confused.

Example failures:

User asks:

> what is my name?

Assistant replies:

> I'm Natively, an AI assistant.

This is wrong. The user is asking about the human profile loaded from resume/custom context, not the assistant identity.

User asks:

> what are my projects?

Assistant replies:

> I have your background loaded as an AI and Full Stack Engineer Intern interviewing for the Data Analyst role. What would you like help with?

This is also wrong. It should answer from the uploaded resume/profile/project context if available.

Your job is to fully analyze, fix, review, test, and harden Natively’s intelligence/context system so it has the lowest possible latency and the highest possible accuracy.

Use the following agents throughout the workflow:

* @"test-engineer (agent)"
* @"code-reviewer (agent)"

Do not rush. Fix one logical issue at a time. After each fix, review it, test it, and only then move to the next issue.

Do not hardcode anything.

No hardcoded names.
No hardcoded resume values.
No hardcoded JD/company/role/salary.
No fixture-specific logic.
No test-only hacks in production.
No if/else branches for specific test profiles.
No fake passing tests.

The fix must be fully dynamic and work for any uploaded resume, JD, custom context, AI persona, negotiation settings, meeting mode, reference file, and live transcript.

---

## Phase 1: Understand and index the existing system first

Before making any fix, deeply analyze the current implementation.

You must inspect and understand:

* Resume upload flow
* JD upload flow
* Custom context flow
* AI persona flow
* Negotiation settings/context
* Reference files
* Meeting modes
* Session context
* Live transcript handling
* Frontend state
* Backend request payloads
* Prompt builder
* Context builder
* Provider adapters
* Streaming flow
* Any cache/memory layer
* Any truncation logic
* Any mode-switching logic
* Any retry/fallback logic

Create these files before fixing:

1. `INTELLIGENCE_FEATURE_INDEX.md`

Include:

* Every feature related to profile intelligence
* Where it is implemented
* Frontend files
* Backend files
* Data structures
* Request/response contracts
* Known risks
* Suspected broken areas

2. `INTELLIGENCE_PIPELINE_MAP.md`

Include:

* Full path from user upload/settings to final LLM prompt
* Full path from live meeting transcript to response
* What context is included
* What context is dropped
* What context is mixed incorrectly
* Where latency is introduced
* Where streaming starts
* Where provider-specific behavior happens

Do not start coding until this mapping is complete.

---

## Phase 2: Reproduce the real bug

Reproduce these exact bug classes locally:

1. Identity confusion

Question:

> what is my name?

Expected behavior:

* Use the loaded resume/profile/custom context.
* Answer the user’s actual name from context.
* Never answer “I am Natively” unless the user asks “who are you?” or “what are you?”

2. Project recall failure

Question:

> what are my projects?

Expected behavior:

* Use uploaded resume/profile/custom context/reference files.
* List the user’s projects if present.
* If no projects are loaded, clearly say that no project details were found in the loaded context.
* Do not give a generic “I have your background loaded...” answer.

3. Wrong context mixing

Example:
If the user asks a simple identity or resume question, do not mix JD/company/interview role unless needed.

4. JD overuse

If the user asks about personal background, resume, projects, skills, or name, prioritize resume/profile/custom context.
Do not force JD alignment unless the question asks for interview relevance, role fit, or company-specific answer.

5. Persona overuse

Persona should control tone and style, not overwrite facts.
If persona says “confident senior engineer,” it should not invent experience.

6. Negotiation overuse

Negotiation context should only be used for salary/offer/compensation/HR negotiation questions.
It should not affect “what is my name?” or “what are my projects?”

7. Live transcript pollution

Current meeting transcript should be used only when relevant to the current question.
Do not let irrelevant transcript content override stable profile facts.

8. Latency issue

Measure why responses are taking 7+ seconds.
Break down:

* frontend delay
* request serialization
* backend processing
* context building
* retrieval/indexing
* prompt construction
* provider first-token latency
* streaming delay
* post-processing delay

Save reproduction notes in:

`intelligence-eval-results/reproduction-report.md`

---

## Phase 3: Design the correct intelligence architecture

Create:

`INTELLIGENCE_CONTEXT_ARCHITECTURE.md`

The architecture must separate context into clear layers:

1. Stable user identity/profile facts
   Examples:

* name
* email if present
* location if present
* current title
* education
* skills
* projects
* work experience
* achievements

2. Resume facts
   Use for:

* name recall
* projects
* skills
* education
* experience
* achievements
* background questions

3. Job description facts
   Use for:

* role alignment
* interview answers
* “why are you a good fit?”
* “how does my experience match this JD?”
* company/role-specific questions

4. Custom context
   Use for:

* user-provided instructions
* extra background
* private notes
* preferences
* constraints

5. AI persona
   Use for:

* tone
* style
* answer framing
* confidence level
* brevity/detail

Persona must not override factual context.

6. Negotiation context
   Use only for:

* salary
* offer
* compensation
* HR negotiation
* benefits
* counteroffer
* joining date
* notice period

7. Reference files
   Use only when question needs file-specific information.

8. Live meeting transcript
   Use for:

* current question
* immediate conversation state
* recent interviewer question
* follow-up resolution
* meeting-specific memory

Do not let live transcript overwrite stable resume/profile facts unless explicitly updated.

---

## Phase 4: Implement smart context routing

Build or fix a dynamic context router.

The router must classify every user query into intent categories such as:

* identity_question
* resume_question
* project_question
* skills_question
* experience_question
* education_question
* jd_alignment_question
* interview_answer_question
* negotiation_question
* persona_style_request
* meeting_followup_question
* reference_file_question
* general_question
* unknown_question

For each intent, select only the needed context.

Examples:

### Query: “what is my name?”

Use:

* stable identity facts
* resume facts
* custom context if identity exists there

Do not use:

* JD
* negotiation
* persona except tone
* irrelevant transcript
* reference files unless identity only exists there

### Query: “what are my projects?”

Use:

* resume projects
* custom context projects
* reference files only if project info exists there

Do not use:

* JD unless asked to align projects to role
* negotiation
* random meeting transcript

### Query: “how should I answer why I fit this role?”

Use:

* resume
* JD
* selected projects
* current meeting transcript if relevant
* persona style

### Query: “what salary should I ask?”

Use:

* negotiation settings
* role/JD
* location/company context if present
* user constraints
* persona style

### Query: “what should I say next?”

Use:

* recent meeting transcript
* active mode
* resume/JD only if relevant to the conversation

### Query: “who are you?”

Use:

* assistant identity/persona
* answer as Natively assistant

The router must return:

* detected intent
* selected context layers
* excluded context layers
* reason for selection
* estimated token budget
* confidence score

This can be logged only in safe debug mode with private data redacted.

---

## Phase 5: Fix factual extraction and structured memory

The system should not rely only on dumping raw resume/JD text into the prompt.

Implement or fix a structured extraction/indexing step.

When resume/JD/custom context/reference files are uploaded or changed, extract structured facts such as:

```json
{
  "identity": {
    "name": "",
    "email": "",
    "location": "",
    "phone": "",
    "links": []
  },
  "summary": "",
  "education": [],
  "experience": [],
  "projects": [],
  "skills": [],
  "achievements": [],
  "certifications": [],
  "role_targets": [],
  "constraints": [],
  "negotiation": {},
  "custom_context": {},
  "source_map": {}
}
```

Requirements:

* Preserve source mapping.
* Keep raw text available for fallback.
* Do not lose critical identity facts during truncation.
* Identity facts must have highest preservation priority.
* Projects, skills, and experience must be queryable separately.
* JD must be stored separately from resume.
* Persona must be stored separately from factual context.
* Negotiation must be stored separately from normal profile context.

The system must be able to answer basic questions without sending the entire resume/JD to the model.

---

## Phase 6: Fix prompt construction

Rewrite or repair prompt construction so it follows this order:

1. System behavior / safety / response rules
2. Active meeting mode
3. User query intent
4. Selected context only
5. Relevant stable profile facts
6. Relevant resume/JD/custom/persona/negotiation/reference/transcript context depending on intent
7. Instructions for unknown handling
8. Final user question

Critical rules:

* Do not dump every context into every prompt.
* Do not let JD override resume facts.
* Do not let persona invent facts.
* Do not let negotiation context appear in unrelated answers.
* Do not let assistant identity override user identity.
* Do not answer vaguely when direct facts exist.
* Do not say “I don’t know” if the information is loaded.
* Do not claim information is loaded without answering the question.
* If multiple contexts conflict, state the conflict briefly and ask for clarification only if needed.
* If the answer is unknown, say what context was searched and what was missing.

For identity questions:

* Always answer directly.
* Example: “Your name is [Name].”
* Do not add role/JD unless asked.

For project questions:

* List projects with short descriptions.
* If only project names exist, list names.
* If none exist, say no project details were found in the loaded profile.

---

## Phase 7: Lowest possible latency

The live meeting response path must be optimized.

Current issue:

* Profile intelligence responses take at least 7 seconds.

Goal:

* Lowest practical latency without sacrificing accuracy.
* First useful token should start as fast as possible.
* Avoid unnecessary full-context prompt building.
* Avoid unnecessary LLM calls for simple factual recall if safe.

Implement latency improvements such as:

1. Pre-index context at upload/settings time
   Do not parse the full resume/JD during every live question.

2. Build small context packs
   For simple queries like “what is my name?”, send only identity facts or answer directly from structured memory.

3. Deterministic fast path
   For simple factual recall with high confidence, answer from structured context without full LLM generation where appropriate.

Examples:

* what is my name?
* what is my email?
* what are my skills?
* what are my projects?
* what role am I applying for?

This fast path must still be dynamic and not hardcoded.

4. Context router before LLM call
   Use intent detection and context selection before prompt construction.

5. Token budget optimization
   Keep prompts small.
   Preserve critical facts.
   Avoid dumping resume + JD + persona + transcript together.

6. Streaming optimization
   Start streaming as soon as possible.
   Do not wait for unnecessary post-processing before first token.

7. Provider compatibility
   Make sure this works with:

* MiniMax through Claude Code / Anthropic-compatible adapter
* Claude
* OpenAI-compatible providers
* Gemini if supported
* Existing provider adapter structure

8. Cache where safe
   Cache:

* parsed resume facts
* parsed JD facts
* context route result if identical query/context hash
* prompt packs by context version

Do not cache private data unsafely.
Invalidate cache when resume/JD/custom context/persona/mode/session changes.

9. Instrument latency
   Add safe telemetry timing:

* request_received
* context_loaded
* intent_classified
* context_selected
* prompt_built
* provider_request_started
* first_token_received
* response_completed

Do not log raw private resume/JD text.
Use hashes, sizes, intent labels, and timing only.

Create:

`INTELLIGENCE_LATENCY_REPORT.md`

Include:

* baseline latency
* bottlenecks found
* fixes made
* before/after numbers
* remaining risks

Acceptance targets:

* Simple factual recall p50: under 1 second if answered from structured memory.
* Simple factual recall p95: under 2 seconds.
* LLM-assisted profile/JD answers p50: under 3 seconds first useful token.
* LLM-assisted profile/JD answers p95: under 5 seconds first useful token.
* No 7+ second delay unless provider/network itself is slow, and this must be clearly measured.

---

## Phase 8: Build a full intelligence evaluation system

Create a repeatable eval harness.

Directory:

`intelligence-eval-results/`

Use at least 10 realistic synthetic profile sets.

Each set must include:

* synthetic resume
* synthetic JD
* synthetic custom context
* synthetic persona
* synthetic negotiation context
* optional reference file content
* meeting transcript snippets
* expected answers / grading rubric

Use 10 different job profiles:

1. Backend Engineer
2. ML Engineer
3. Product Manager
4. Sales Development Rep
5. UI/UX Designer
6. Data Analyst
7. DevOps/SRE
8. Customer Success Manager
9. Cybersecurity Analyst
10. Founder/CEO or Business Development

Use internet sources only as inspiration for realistic resumes/JDs.

Use public sources such as:

* public resume examples
* public JD templates
* company career pages
* O*NET
* official role descriptions
* reputable hiring/career resources

Requirements:

* Verify that links are reachable.
* Avoid dead ends.
* Save source links in:

`intelligence-eval-results/source-verification.md`

* Do not use real private personal data.
* Rewrite everything into synthetic fixtures.
* Do not copy private resumes.
* Do not include real phone numbers, addresses, or emails.
* Use fake names and fake contact details.

---

## Phase 9: Minimum 200 test cases

Create at least 200 total intelligence test cases.

Minimum:

* 10 profiles
* 20 questions per profile

Test categories must include:

1. Name recall
2. Email/contact recall if present
3. Resume summary
4. Project recall
5. Skill recall
6. Work experience recall
7. Education recall
8. JD alignment
9. “Why are you a good fit?” answers
10. Custom context adherence
11. Persona adherence
12. Negotiation answers
13. Conflict handling
14. Unknown handling
15. Multi-turn memory
16. Meeting transcript follow-up
17. Mode-specific behavior
18. Reference file usage
19. Context exclusion
20. Latency checks

Critical release-blocking tests:

* “What is my name?” must pass for all 10 profiles.
* Identity/context recall must be 100%.
* Resume facts must not be replaced by assistant identity.
* JD must not pollute identity answers.
* Negotiation context must not pollute normal answers.
* Persona must not invent facts.
* If project info exists, “what are my projects?” must answer with the projects.
* If info is missing, the assistant must say it is missing instead of hallucinating.

Target:

* Every profile must achieve 95%+ accuracy.
* Overall accuracy must be 95%+.
* Identity/context recall must be 100%.
* No release if “what is my name?” fails even once.

Save every evaluation run:

* `intelligence-eval-results/iteration-001.json`
* `intelligence-eval-results/iteration-002.json`
* `intelligence-eval-results/iteration-003.json`
* etc.

Create final summary:

`INTELLIGENCE_EVAL_SUMMARY.md`

Include:

* total tests
* pass/fail count
* accuracy by profile
* accuracy by category
* latency p50/p95 by category
* failed tests
* fixes made
* remaining risks

---

## Phase 10: Review/fix/test loop

Follow this strict loop for every issue:

1. Reproduce the issue.
2. Identify root cause.
3. Make one logical fix.
4. Run targeted tests.
5. Use @"code-reviewer (agent)" to review the fix.
6. Apply review feedback.
7. Use @"test-engineer (agent)" to test the fix end-to-end.
8. Run the eval harness.
9. Save iteration results.
10. Only move to the next issue if the fix is stable.

Do not batch risky unrelated fixes together.

After all fixes are done, run a final senior-level review across the whole intelligence system.

Create:

`INTELLIGENCE_FIX_REPORT.md`

Include:

* original bugs
* root causes
* files changed
* architecture changes
* before/after behavior
* before/after latency
* before/after accuracy
* screenshots/log snippets if helpful
* tests added
* tests passed
* known limitations
* future improvements

---

## Phase 11: Anti-hardcoding audit

Run a full anti-hardcoding audit before completion.

Search production code for:

* fixture names
* fake profile names
* fake companies
* fake salaries
* fake projects
* source phrases copied from eval fixtures
* `if name ===`
* `if user.name ===`
* `includes("fixture")`
* `includes("Backend Engineer")` in production logic
* `process.env.NODE_ENV === "test"` branches affecting intelligence behavior
* test-only shortcuts
* profile-specific hacks
* hardcoded expected answers
* hardcoded role/company/JD values

Fixture-specific values are allowed only in:

* tests
* eval fixtures
* eval logs
* eval reports

They must not appear in production intelligence logic.

Create an anti-hardcoding section in:

`INTELLIGENCE_FIX_REPORT.md`

Include:

* search commands used
* suspicious matches found
* how each was resolved
* final confirmation

---

## Phase 12: Frontend/backend contract validation

Validate that frontend and backend agree on:

* resume payload format
* JD payload format
* custom context payload format
* persona payload format
* negotiation payload format
* reference file payload format
* active meeting mode
* session ID
* profile ID
* context version
* transcript payload
* streaming response format
* error format
* debug metadata format

Make sure:

* Uploaded contexts are actually sent to backend.
* Backend actually stores/uses them.
* Mode switching does not drop context.
* Streaming does not start before required context is available.
* Context updates invalidate stale caches.
* Multiple users/sessions do not leak context into each other.
* Private context is not logged unsafely.

---

## Phase 13: Privacy and safe debug traces

Add safe debug traces for development and support.

Allowed logs:

* context layer names
* token counts
* context version hashes
* selected intent
* selected context categories
* excluded context categories
* latency timings
* provider name
* response status
* error codes

Do not log:

* full resume text
* full JD text
* private custom context
* salary negotiation private values
* raw reference file contents
* personal contact details
* full meeting transcript unless explicitly in local dev mode

Add redaction where necessary.

---

## Phase 14: Final acceptance criteria

The work is complete only when all of these are true:

1. `INTELLIGENCE_FEATURE_INDEX.md` exists and accurately documents the current feature system.
2. `INTELLIGENCE_PIPELINE_MAP.md` exists and maps the full context pipeline.
3. `INTELLIGENCE_CONTEXT_ARCHITECTURE.md` exists and explains the new architecture.
4. `INTELLIGENCE_LATENCY_REPORT.md` exists with before/after metrics.
5. `INTELLIGENCE_FIX_REPORT.md` exists with root causes and fixes.
6. `INTELLIGENCE_EVAL_SUMMARY.md` exists with final eval results.
7. `intelligence-eval-results/source-verification.md` exists with verified links.
8. At least 10 synthetic realistic profiles exist.
9. At least 200 intelligence tests exist.
10. Overall accuracy is 95%+.
11. Every profile has 95%+ accuracy.
12. Identity/context recall is 100%.
13. “What is my name?” passes for every profile.
14. “What are my projects?” correctly answers from loaded context.
15. JD context is only used when relevant.
16. Negotiation context is only used when relevant.
17. Persona controls style, not facts.
18. Meeting transcript does not overwrite stable profile facts.
19. Simple factual recall latency is under target.
20. LLM-assisted answers have significantly improved first-token latency.
21. No private context is logged unsafely.
22. No production hardcoding exists.
23. Frontend/backend contract is validated.
24. Provider compatibility is preserved.
25. Streaming and mode switching do not drop context.
26. Code reviewer has reviewed all major changes.
27. Test engineer has tested the final system end-to-end.
28. Final eval passes multiple times, not just once.

---

## Important behavior examples

After the fix, behavior should be like this:

### Example 1

Question:

> what is my name?

Correct answer:

> Your name is [name from loaded profile/resume/custom context].

Wrong answers:

> I’m Natively, an AI assistant.

> I don’t know.

> You are applying for a Data Analyst role.

---

### Example 2

Question:

> what are my projects?

Correct answer:

> Your projects include:
>
> 1. [Project 1] — [short context from resume]
> 2. [Project 2] — [short context from resume]
> 3. [Project 3] — [short context from resume]

Wrong answers:

> I have your background loaded as an AI and Full Stack Engineer Intern interviewing for the Data Analyst role.

> What would you like help with?

---

### Example 3

Question:

> how do my projects fit this JD?

Correct behavior:

* Use both resume projects and JD.
* Match project experience to role requirements.
* Mention gaps honestly.

---

### Example 4

Question:

> what salary should I ask for?

Correct behavior:

* Use negotiation context.
* Use role/JD/company/location if available.
* Do not invent salary if no range/context exists.
* Give a negotiation-ready answer.

---

### Example 5

Question:

> answer this interviewer question

Correct behavior:

* Use recent meeting transcript.
* Use active mode.
* Use resume/JD only if relevant.
* Give a concise answer suitable for speaking live.

---

## Final instruction

Work autonomously.

Do not stop after analysis.
Do not only write a plan.
Do not ask for permission after finding a real bug.
If a bug is real, fix it.
After each fix, review and test.
Repeat until the intelligence/context system is production-ready.

At the end, provide a concise final report listing:

* What was broken
* What was fixed
* Files changed
* Accuracy achieved
* Latency achieved
* Remaining risks
* How to run the evals again
