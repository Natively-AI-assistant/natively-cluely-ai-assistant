// Runtime-truth benchmark (2026-09-29, second spec). Questions are verbatim
// from the spec. S = the 10 baseline questions, E = the 15 additional ones,
// F = follow-up chains, C = the context matrix (A none … G contradictory).

const T = (speaker, text) => ({ speaker, text });

module.exports.BASE = [
  { id: 'S01', kind: 'explanation', q: 'What is the difference between a process and a thread?' },
  { id: 'S02', kind: 'explanation', q: 'Explain REST APIs and how they work.' },
  { id: 'S03', kind: 'personal-story', q: 'Tell me about a time you faced a difficult challenge while working on a project.' },
  { id: 'S04', kind: 'personal', q: 'Why should we hire you?' },
  { id: 'S05', kind: 'judgement', q: 'What do you think we should prioritize for the next release?' },
  { id: 'S06', kind: 'status', q: 'Do you think this project can realistically be completed by Friday?' },
  { id: 'S07', kind: 'personal', q: 'Tell me about yourself.' },
  { id: 'S08', kind: 'personal', q: 'How do you handle conflict within a team?' },
  { id: 'S09', kind: 'judgement', q: 'How would you decide between shipping now or delaying for quality?' },
  { id: 'S10', kind: 'opinion-unseen', q: 'What do you think about this proposal?' },
];

module.exports.EXTRA = [
  { id: 'E01', kind: 'fact-short', q: 'What does HTTP stand for?' },
  { id: 'E02', kind: 'explanation', q: 'What is dependency injection?' },
  { id: 'E03', kind: 'status', q: 'Are we on schedule?' },
  { id: 'E04', kind: 'opinion-unseen', q: 'Do you agree with this approach?' },
  { id: 'E05', kind: 'judgement', q: "What's the biggest risk here?" },
  { id: 'E06', kind: 'set', q: 'Give me three reasons we should delay.' },
  { id: 'E07', kind: 'steps', q: 'Walk me through how you would debug this.' },
  { id: 'E08', kind: 'explanation', q: 'Explain database indexing.' },
  { id: 'E09', kind: 'personal', q: 'Why are you leaving your current role?' },
  { id: 'E10', kind: 'negotiation', q: 'What salary are you expecting?' },
  { id: 'E11', kind: 'personal', q: "What's your biggest weakness?" },
  { id: 'E12', kind: 'personal', q: 'What would you do if a teammate strongly disagreed with you?' },
  { id: 'E13', kind: 'commitment', q: 'Can we promise this to the customer?' },
  { id: 'E14', kind: 'status', q: 'What went wrong?' },
  { id: 'E15', kind: 'status', q: 'Give me a quick project update.' },
];

// Follow-up chains: the parent is asked, the user "speaks" the suggested
// answer (injected as the user's own speech on the Cmd+Enter surface), then
// the follow-up arrives. The follow-up answer must continue, not restart.
module.exports.FOLLOWUPS = [
  { id: 'F01', kind: 'deeper', parent: 'Explain REST APIs and how they work.', follow: 'Why is statelessness useful?', restartCue: /\b(a )?rest (api|apis) (is|are)\b/i },
  { id: 'F02', kind: 'why', parent: 'How would you decide between shipping now or delaying for quality?', follow: 'Why?' },
  { id: 'F03', kind: 'example', parent: 'What is dependency injection?', follow: 'Can you give me an example?', restartCue: /\bdependency injection is\b/i },
  { id: 'F04', kind: 'challenge', parent: 'How would you roll out a risky database migration?', follow: "But isn't that risky?" },
  { id: 'F05', kind: 'deeper', parent: 'Explain REST APIs and how they work.', follow: 'What about scalability?', restartCue: /\b(a )?rest (api|apis) (is|are)\b/i },
  { id: 'F06', kind: 'simpler', parent: 'Explain database indexing.', follow: 'Can you explain that more simply?' },
  { id: 'F07', kind: 'yes-no', parent: 'Do you think this project can realistically be completed by Friday?', follow: 'Yes or no?' },
  { id: 'F08', kind: 'clarification', parent: 'How do you handle conflict within a team?', follow: 'What do you mean?' },
  { id: 'F09', kind: 'interruption', parent: 'Tell me about yourself.', follow: 'Sorry to cut in, what are you working on right now?', interrupt: true },
];

// Fictional candidate (checkable facts; fabrication stands out).
module.exports.RESUME = `Priya Raman — Senior Backend Engineer
Email: priya.raman@example.com

EXPERIENCE
Brightlane (fintech payments), Senior Backend Engineer, Mar 2022 – present
- Led the migration of the payment reconciliation service from a nightly batch job to event-driven processing on Kafka; reconciliation lag dropped from about 24 hours to under 5 minutes.
- Mentored three junior engineers; ran the on-call rotation for the payments platform.
- Introduced contract tests between the ledger and payouts services, which caught two breaking API changes before release.

Tessellate Labs (logistics SaaS), Backend Engineer, Jul 2019 – Feb 2022
- Built REST APIs in Go for the order-tracking platform.
- Cut p95 latency of the order-tracking API from 800 ms to 180 ms with Redis caching and query optimisation.
- A schema migration I shipped locked the orders table for 40 minutes in production; I led the rollback, wrote the postmortem, and introduced online migration tooling (gh-ost) so migrations no longer lock tables.

SKILLS
Go, Python, PostgreSQL, Kafka, Redis, AWS, Kubernetes, Terraform

EDUCATION
B.Tech Computer Science, NIT Trichy, 2019`;

module.exports.PROJECT_NOTES = `Checkout redesign — project notes (updated Monday)
Owner: the user (engineering lead). Target release: this Friday.
Done: new checkout UI, address autocomplete, analytics events.
Open: payment provider integration — blocked on sandbox credentials the provider promised last Tuesday and has not sent; full QA pass needs 3 working days once the integration lands.
Risk: without credentials by Wednesday, Friday is not achievable; fallback is to ship the UI behind a flag with the old payment flow.
Backlog for next release (from support and sales): slow product search is the top support complaint this month; Android crash rate doubled after the last update; sales asks for CSV export of orders.`;

module.exports.IRRELEVANT_NOTES = `Office notes
The office is closed on Monday for the public holiday. The third-floor coffee machine is being replaced on Thursday.
Parking permits for next quarter can be collected from reception. The team lunch moved to the Italian place on Elm Street.`;

// Context matrix. mode: 'general' | 'looking-for-work' built-in template, or
// a custom mode created by the runner: 'cv' (résumé file), 'notes' (project
// notes file), 'office' (irrelevant notes file). profile: ingest the résumé
// into Profile Intelligence for this row set.
module.exports.CONTEXT = [
  // B — grounded candidate profile (Profile Intelligence), built-in Looking for work
  { id: 'CB-S07', ctx: 'B', mode: 'looking-for-work', profile: true, q: 'Tell me about yourself.' },
  { id: 'CB-S03', ctx: 'B', mode: 'looking-for-work', profile: true, q: 'Tell me about a time you faced a difficult challenge while working on a project.' },
  { id: 'CB-S04', ctx: 'B', mode: 'looking-for-work', profile: true, q: 'Why should we hire you?' },
  // C — résumé attached to the mode as a reference file
  { id: 'CC-S07', ctx: 'C', mode: 'cv', q: 'Tell me about yourself.' },
  { id: 'CC-S03', ctx: 'C', mode: 'cv', q: 'Tell me about a time you faced a difficult challenge while working on a project.' },
  { id: 'CC-S04', ctx: 'C', mode: 'cv', q: 'Why should we hire you?' },
  // D — relevant project notes
  { id: 'CD-S06', ctx: 'D', mode: 'notes', q: 'Do you think this project can realistically be completed by Friday?' },
  { id: 'CD-S05', ctx: 'D', mode: 'notes', q: 'What do you think we should prioritize for the next release?' },
  { id: 'CD-E15', ctx: 'D', mode: 'notes', q: 'Give me a quick project update.' },
  // E — relevant meeting transcript
  { id: 'CE-S06', ctx: 'E', mode: 'general', q: 'Do you think this project can realistically be completed by Friday?', prior: [
    T('interviewer', 'Quick status check on the checkout redesign.'),
    T('user', 'The new UI is done. What is left is the payment provider integration and a full QA pass.'),
    T('interviewer', 'And the provider still has not given us sandbox credentials, right?'),
    T('user', 'Right, we are still waiting on that.') ] },
  { id: 'CE-S05', ctx: 'E', mode: 'general', q: 'What do you think we should prioritize for the next release?', prior: [
    T('interviewer', 'Most support tickets this month are about slow search.'),
    T('interviewer', 'We also had a spike in Android crashes after the last update, and sales keeps asking for CSV export.') ] },
  { id: 'CE-E15', ctx: 'E', mode: 'general', q: 'Give me a quick project update.', prior: [
    T('user', 'The new checkout UI shipped to staging yesterday.'),
    T('interviewer', 'Is the payment integration started?'),
    T('user', 'Started, but we are blocked on sandbox credentials from the provider.') ] },
  // F — irrelevant context
  { id: 'CF-S07', ctx: 'F', mode: 'office', q: 'Tell me about yourself.' },
  { id: 'CF-S05', ctx: 'F', mode: 'general', q: 'What do you think we should prioritize for the next release?', prior: [
    T('interviewer', 'Did anyone catch the game last night?'), T('user', 'Yeah, what a finish.'),
    T('interviewer', 'Anyway, the office is closed on Monday for the holiday.') ] },
  { id: 'CF-S06', ctx: 'F', mode: 'office', q: 'Do you think this project can realistically be completed by Friday?' },
  // G — contradictory context
  { id: 'CG-S06', ctx: 'G', mode: 'notes', q: 'Do you think this project can realistically be completed by Friday?', prior: [
    T('interviewer', 'Heads up, the provider sent the sandbox credentials this morning.'),
    T('interviewer', 'But the client now wants the release moved up to Thursday.') ] },
  { id: 'CG-LAT', ctx: 'G', mode: 'cv', q: 'What kind of latency improvement did you get on the order tracking API?', prior: [
    T('interviewer', 'Tell me about the order tracking work.'),
    T('user', 'At Tessellate I worked on the order tracking API, and we got latency down to around 250 milliseconds at p95.') ] },
];

// Instruction-style asks typed into the overlay (advisor check, 2026-09-29):
// routing the typed box to the LIVE surface must not turn a task addressed to
// the assistant into a first-person spoken reply.
module.exports.TASKS = [
  { id: 'T01', kind: 'task', q: 'Summarize what they said so far.', prior: [
    T('interviewer', 'We need the migration plan by Thursday, and Priya will own the vendor review.'),
    T('user', 'I can have a draft plan by Wednesday for review.'),
    T('interviewer', 'Good. Also, budget approval is still pending from finance.') ] },
  { id: 'T02', kind: 'task', q: 'Draft a short follow-up email to the client confirming the Thursday deadline.' },
  { id: 'T03', kind: 'task', q: 'List three questions I should ask the interviewer at the end.' },
  { id: 'T04', kind: 'task', q: 'Write the SQL to find duplicate emails in a users table.' },
];
