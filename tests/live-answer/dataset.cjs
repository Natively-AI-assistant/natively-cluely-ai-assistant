// Benchmark questions for the live-answer investigation (2026-09-29).
// B = the user's 10 benchmark questions (verbatim). X = 10+ added coverage items.
// R = regression (short stays short, lists/steps still possible, depth on request).
module.exports.BENCH = [
  { id: 'B01', kind: 'explanation', q: 'What is the difference between a process and a thread?' },
  { id: 'B02', kind: 'explanation', q: 'Explain REST APIs and how they work.' },
  { id: 'B03', kind: 'spoken', q: 'Tell me about a time you faced a difficult challenge while working on a project.' },
  { id: 'B04', kind: 'spoken', q: 'Why should we hire you?' },
  { id: 'B05', kind: 'spoken', q: 'What do you think we should prioritize for the next release?' },
  { id: 'B06', kind: 'spoken', q: 'Do you think this project can realistically be completed by Friday?' },
  { id: 'B07', kind: 'spoken', q: 'Tell me about yourself.' },
  { id: 'B08', kind: 'spoken', q: 'How do you handle conflict within a team?' },
  { id: 'B09', kind: 'spoken', q: 'How would you decide between shipping now or delaying for quality?' },
  { id: 'B10', kind: 'spoken', q: 'What do you think about this proposal?' },
  // Added coverage
  { id: 'X01', kind: 'explanation', tag: 'simple factual', q: 'What does ACID stand for in databases?' },
  { id: 'X02', kind: 'explanation', tag: 'deeply technical', q: 'How does a database index work internally, and when can it hurt performance?' },
  { id: 'X03', kind: 'spoken', tag: 'behavioral', q: 'Tell me about a time you made a mistake at work and how you handled it.' },
  { id: 'X04', kind: 'spoken', tag: 'HR', q: 'Why are you leaving your current job?' },
  { id: 'X05', kind: 'spoken', tag: 'leadership', q: 'How would you motivate a team that keeps missing its deadlines?' },
  { id: 'X06', kind: 'spoken', tag: 'disagreement', q: "What would you do if you disagreed with your manager's technical decision?" },
  { id: 'X07', kind: 'spoken', tag: 'meeting update', q: 'Can you give us a quick update on where things stand with the integration?' },
  { id: 'X08', kind: 'spoken', tag: 'ambiguous workplace', q: 'How do you feel about the new process?' },
  { id: 'X09', kind: 'spoken', tag: 'negotiation', q: 'What are your salary expectations for this role?' },
  { id: 'X10', kind: 'spoken', tag: 'insufficient context', q: 'What did the client say about the budget on last week\'s call?' },
  { id: 'X11', kind: 'spoken', tag: 'HR', q: "What's your greatest weakness?" },
  { id: 'X12', kind: 'spoken', tag: 'behavioral', q: 'Describe a situation where you had to learn something new very quickly.' },
];

module.exports.REGRESSION = [
  { id: 'R01', kind: 'explanation', expect: 'short', q: 'What does HTTP stand for?' },
  { id: 'R02', kind: 'explanation', expect: 'short', q: 'What is dependency injection?' },
  { id: 'R03', kind: 'spoken', expect: 'short', q: 'Are we on schedule?' },
  { id: 'R04', kind: 'spoken', expect: 'short', q: 'Do you agree with this approach?' },
  { id: 'R05', kind: 'spoken', expect: 'short', q: "What's the biggest risk here?" },
  { id: 'R06', kind: 'spoken', expect: 'list3', q: 'Give me three reasons we should use TypeScript instead of plain JavaScript.' },
  { id: 'R07', kind: 'explanation', expect: 'steps', q: 'Walk me through the steps to safely deploy a change to production.' },
  { id: 'R08', kind: 'explanation', expect: 'long', q: 'Can you explain in detail, step by step, how the TLS handshake works?' },
  { id: 'R09', kind: 'code', expect: 'code', q: 'Write a function to reverse a singly linked list.' },
];

// Fictional candidate résumé (context B). Deliberately specific so grounded
// answers are checkable and fabrications stand out.
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

// Context scenarios. mode: which mode template; resume: attach the résumé to
// that mode; prior: transcript lines injected before the question.
const T = (speaker, text) => ({ speaker, text });
module.exports.CONTEXT = [
  // B — résumé present
  { id: 'CB1', ctx: 'B', mode: 'cv', kind: 'spoken', q: 'Tell me about yourself.' },
  { id: 'CB2', ctx: 'B', mode: 'cv', kind: 'spoken', q: 'Tell me about a time you faced a difficult challenge while working on a project.' },
  { id: 'CB3', ctx: 'B', mode: 'cv', kind: 'spoken', q: 'Why should we hire you?' },
  { id: 'CB4', ctx: 'B', mode: 'cv', kind: 'spoken', q: 'Tell me about a time you made a mistake at work and how you handled it.' },
  { id: 'CB5', ctx: 'B', mode: 'cv', kind: 'spoken', q: 'Tell me about a time you had to deal with a difficult stakeholder.' },
  { id: 'CB6', ctx: 'B', mode: 'cv', kind: 'spoken', q: 'What are your salary expectations for this role?' },
  // C — relevant meeting transcript
  { id: 'CC1', ctx: 'C', mode: 'general', kind: 'spoken', q: 'Do you think this project can realistically be completed by Friday?', prior: [
    T('interviewer', 'Quick status check on the checkout redesign.'),
    T('user', 'The new UI is done. What is left is the payment provider integration and a full QA pass.'),
    T('interviewer', 'And the provider still has not given us sandbox credentials, right?'),
    T('user', 'Right, we are still waiting on that.') ] },
  { id: 'CC2', ctx: 'C', mode: 'general', kind: 'spoken', q: 'What do you think about this proposal?', prior: [
    T('interviewer', 'The proposal is to move the reporting service to a nightly batch job.'),
    T('interviewer', 'It should cut compute costs by about thirty percent, but reports would be up to a day stale.') ] },
  { id: 'CC3', ctx: 'C', mode: 'general', kind: 'spoken', q: 'What do you think we should prioritize for the next release?', prior: [
    T('interviewer', 'Most support tickets this month are about slow search.'),
    T('interviewer', 'We also had a spike in Android crashes after the last update, and sales keeps asking for CSV export.') ] },
  // D — irrelevant transcript
  { id: 'CD1', ctx: 'D', mode: 'general', kind: 'spoken', q: 'What do you think we should prioritize for the next release?', prior: [
    T('interviewer', 'Did anyone catch the game last night?'), T('user', 'Yeah, what a finish.'),
    T('interviewer', 'Anyway, the office is closed on Monday for the holiday.') ] },
  { id: 'CD2', ctx: 'D', mode: 'general', kind: 'spoken', q: 'How do you handle conflict within a team?', prior: [
    T('interviewer', 'Sorry I am a few minutes late, the traffic was terrible.'), T('user', 'No worries at all.') ] },
  // E — conflicting context
  { id: 'CE1', ctx: 'E', mode: 'general', kind: 'spoken', q: 'So can we realistically finish the migration by the deadline?', prior: [
    T('interviewer', 'The deadline for the database migration is this Friday.'),
    T('user', 'We still have the data backfill and the cutover rehearsal left.'),
    T('interviewer', 'Actually, the client just emailed. They pushed the deadline to next Wednesday.') ] },
  { id: 'CE2', ctx: 'E', mode: 'cv', kind: 'spoken', q: 'What kind of latency improvement did you get on the order tracking API?', prior: [
    T('interviewer', 'Tell me about the order tracking work.'),
    T('user', 'At Tessellate I worked on the order tracking API, and we got latency down to around 250 milliseconds at p95.') ] },
];

// HELD-OUT (2026-09-29, added after all iteration): never used in any A/B or
// prompt edit, and chosen not to overlap the worked examples in the prompts.
module.exports.HELDOUT = [
  { id: 'H01', kind: 'spoken', tag: 'behavioral', q: 'Tell me about a time you had to meet a very tight deadline.' },
  { id: 'H02', kind: 'spoken', tag: 'behavioral', q: 'Give me an example of a time you persuaded someone who disagreed with you.' },
  { id: 'H03', kind: 'spoken', tag: 'HR', q: 'Where do you see yourself in five years?' },
  { id: 'H04', kind: 'spoken', tag: 'status', q: 'Is the new onboarding flow ready to launch?' },
  { id: 'H05', kind: 'spoken', tag: 'opinion on unseen', q: 'What do you think of the plan to move our standups to written async updates?' },
  { id: 'H06', kind: 'explanation', tag: 'knowledge', q: 'What is the difference between SQL and NoSQL databases?' },
  { id: 'H07', kind: 'explanation', tag: 'knowledge, short', q: 'What is a race condition?' },
  { id: 'H08', kind: 'explanation', tag: 'steps', q: 'Walk me through how you would debug a slow API endpoint.' },
  { id: 'H09', kind: 'spoken', tag: 'commitment', q: 'Can you take over the billing dashboard project starting next week?' },
  { id: 'H10', kind: 'spoken', tag: 'leadership', q: 'How do you keep a remote team aligned?' },
];

// Other-mode smoke tests: the speaker and shape each mode must keep.
module.exports.MODESMOKE = [
  { id: 'M1', mode: 'recruiting', surface: 'hotkey', kind: 'spoken', expect: 'a probe for the interviewer, never a candidate answer',
    prior: [T('user', 'Tell me about a system you scaled.')], q: 'I led our payments migration to Kafka and we cut the reconciliation lag a lot.' },
  { id: 'M2', mode: 'recruiting', surface: 'typed', kind: 'spoken', expect: 'advice to the interviewer about the candidate',
    prior: [T('user', 'Tell me about a system you scaled.'), T('interviewer', 'I led our payments migration to Kafka and we cut the reconciliation lag a lot.')], q: 'What should I ask the candidate next?' },
  { id: 'M3', mode: 'lecture', surface: 'hotkey', kind: 'explanation', expect: 'a concise explanation for the student',
    prior: [T('interviewer', 'So backpropagation is just the chain rule applied layer by layer, from the output back to the inputs.')], q: 'Can anyone tell me why we need a learning rate?' },
  { id: 'M4', mode: 'lecture', surface: 'typed', kind: 'explanation', expect: 'a plain explanation', q: 'What is gradient descent?' },
  { id: 'M5', mode: 'team-meet', surface: 'hotkey', kind: 'capture', expect: 'capture lines (Action / Decision), not a speech',
    q: "Okay, so Priya owns the vendor contract review, due Thursday, and we've decided to drop the legacy CSV export." },
  { id: 'M6', mode: 'team-meet', surface: 'typed', kind: 'task', expect: 'the action items as a short list',
    prior: [T('interviewer', "Okay, so Priya owns the vendor contract review, due Thursday, and we've decided to drop the legacy CSV export.")], q: 'What are the action items so far?' },
  { id: 'M7', mode: 'seminar', surface: 'hotkey', kind: 'spoken', expect: 'the 12% recall@10 figure, citing section 4.2', seminarFile: true,
    q: 'What improvement did your study find with hybrid retrieval?' },
  { id: 'M8', mode: 'seminar', surface: 'typed', kind: 'spoken', expect: 'the 12% recall@10 figure, citing section 4.2', seminarFile: true,
    q: 'What improvement did your study find with hybrid retrieval?' },
];
module.exports.SEMINAR_PAPER = `Hybrid Retrieval for Internal Question Answering
1. Introduction. We compare dense retrieval with a hybrid of BM25 and dense retrieval on our internal QA benchmark.
3. Method. The hybrid ranks candidates by reciprocal rank fusion of BM25 and a dense embedding retriever.
4.2 Results. Combining BM25 with dense retrieval improved recall@10 by 12% over dense retrieval alone. Latency rose by 9 ms at p50.
5. Limitations. The benchmark covers English only.`;
