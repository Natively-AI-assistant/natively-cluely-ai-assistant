// scripts/humanized-answers-dataset.mjs
//
// Question set for verify:humanized-answers. 80+ paraphrased prompts across the spoken
// surfaces, plus coding-format and follow-up cases. These are GENERIC interview/sales/
// coding prompts — NO Evin-specific facts, no expected fixed answers. Each item only
// declares the STYLE properties the real backend's answer must satisfy (rubric-based,
// anti-hardcoding compliant).
//
// `expect` flags (all optional):
//   spoken         — answer must be first-person spoken voice with no corporate filler
//   firstPerson    — answer must read in first person
//   maxSentences   — soft cap; a spoken answer over this is flagged (not auto-fail)
//   codeOnly       — answer must be ONLY code (no ## headings, no prose)
//   complexityOnly — answer must give complexity, no fresh code block
//   noCode         — answer must contain no code block
//   sixSection     — a full coding answer (## headings expected)
//   followupOf     — index of the prior question this one continues (same session)

export const QUESTIONS = [
  // ── looking-for-work / fit / gap (20) ──
  { id: 'lfw-01', mode: 'looking-for-work', q: 'Why should we hire you?', expect: { spoken: true, firstPerson: true, maxSentences: 5 } },
  { id: 'lfw-02', mode: 'looking-for-work', q: 'Why should we hire you, in one sentence?', expect: { spoken: true, firstPerson: true, maxSentences: 2 } },
  { id: 'lfw-03', mode: 'looking-for-work', q: 'What makes you a good fit for this role?', expect: { spoken: true, firstPerson: true } },
  { id: 'lfw-04', mode: 'looking-for-work', q: 'What is your weakest match for this job description?', expect: { spoken: true, firstPerson: true } },
  { id: 'lfw-05', mode: 'looking-for-work', q: 'Give me a confident but honest answer about a gap you have.', expect: { spoken: true, firstPerson: true } },
  { id: 'lfw-06', mode: 'looking-for-work', q: 'You seem more full-stack than a data analyst. Convince me you fit.', expect: { spoken: true, firstPerson: true } },
  { id: 'lfw-07', mode: 'looking-for-work', q: 'Tell me about yourself.', expect: { spoken: true, firstPerson: true } },
  { id: 'lfw-08', mode: 'looking-for-work', q: 'Introduce yourself.', expect: { spoken: true, firstPerson: true } },
  { id: 'lfw-09', mode: 'looking-for-work', q: 'Walk me through your background.', expect: { spoken: true, firstPerson: true } },
  { id: 'lfw-10', mode: 'looking-for-work', q: 'Why are you leaving your current role?', expect: { spoken: true, firstPerson: true } },
  { id: 'lfw-11', mode: 'looking-for-work', q: 'Why do you want to work here?', expect: { spoken: true, firstPerson: true } },
  { id: 'lfw-12', mode: 'looking-for-work', q: 'What is your biggest strength for this position?', expect: { spoken: true, firstPerson: true } },
  { id: 'lfw-13', mode: 'looking-for-work', q: 'What is your biggest weakness?', expect: { spoken: true, firstPerson: true } },
  { id: 'lfw-14', mode: 'looking-for-work', q: 'Where do you see the overlap between your experience and this role?', expect: { spoken: true, firstPerson: true } },
  { id: 'lfw-15', mode: 'looking-for-work', q: 'What would you bring to the team in your first 90 days?', expect: { spoken: true, firstPerson: true } },
  { id: 'lfw-16', mode: 'looking-for-work', q: 'How do you handle feedback you disagree with?', expect: { spoken: true, firstPerson: true } },
  { id: 'lfw-17', mode: 'looking-for-work', q: 'Tell me about a time you had a tight deadline.', expect: { spoken: true, firstPerson: true } },
  { id: 'lfw-18', mode: 'looking-for-work', q: 'Tell me about a project you are proud of.', expect: { spoken: true, firstPerson: true } },
  { id: 'lfw-19', mode: 'looking-for-work', q: 'Why should we pick you over other candidates?', expect: { spoken: true, firstPerson: true } },
  { id: 'lfw-20', mode: 'looking-for-work', q: 'What is one thing you would want to learn quickly in this role?', expect: { spoken: true, firstPerson: true } },

  // ── technical interview spoken (non-code concept) (15) ──
  { id: 'ti-01', mode: 'technical-interview', q: 'Explain BFS without code.', expect: { spoken: true, noCode: true } },
  { id: 'ti-02', mode: 'technical-interview', q: 'In plain words, what is a hash map and when would you use one?', expect: { spoken: true, noCode: true } },
  { id: 'ti-03', mode: 'technical-interview', q: 'Explain the difference between a stack and a queue conceptually.', expect: { spoken: true, noCode: true } },
  { id: 'ti-04', mode: 'technical-interview', q: 'What is the idea behind dynamic programming, in plain English?', expect: { spoken: true, noCode: true } },
  { id: 'ti-05', mode: 'technical-interview', q: 'Explain what an index does in a database, without code.', expect: { spoken: true, noCode: true } },
  { id: 'ti-06', mode: 'technical-interview', q: 'Conceptually, how does a binary search work?', expect: { spoken: true, noCode: true } },
  { id: 'ti-07', mode: 'technical-interview', q: 'What is the tradeoff between time and space complexity?', expect: { spoken: true, noCode: true } },
  { id: 'ti-08', mode: 'technical-interview', q: 'Explain eventual consistency in plain terms.', expect: { spoken: true, noCode: true } },
  { id: 'ti-09', mode: 'technical-interview', q: 'Why would you pick a queue over a list for a job worker?', expect: { spoken: true, noCode: true } },
  { id: 'ti-10', mode: 'technical-interview', q: 'Explain what caching buys you and what it costs you.', expect: { spoken: true, noCode: true } },
  { id: 'ti-11', mode: 'technical-interview', q: 'Describe how you would debug a slow API endpoint.', expect: { spoken: true } },
  { id: 'ti-12', mode: 'technical-interview', q: 'Explain the difference between SQL and NoSQL conceptually.', expect: { spoken: true, noCode: true } },
  { id: 'ti-13', mode: 'technical-interview', q: 'What does idempotent mean and why does it matter for retries?', expect: { spoken: true, noCode: true } },
  { id: 'ti-14', mode: 'technical-interview', q: 'Explain what a load balancer does in plain words.', expect: { spoken: true, noCode: true } },
  { id: 'ti-15', mode: 'technical-interview', q: 'Why are immutable data structures useful, in plain terms?', expect: { spoken: true, noCode: true } },

  // ── sales (10) ──
  { id: 'sa-01', mode: 'sales', q: 'Why is your product so expensive?', expect: { spoken: true } },
  { id: 'sa-02', mode: 'sales', q: 'We already use a competitor. Why switch?', expect: { spoken: true } },
  { id: 'sa-03', mode: 'sales', q: 'The prospect says the budget is only $20k. How do I respond?', expect: { spoken: true } },
  { id: 'sa-04', mode: 'sales', q: 'They are happy with their current tier and not blocked. What do I say?', expect: { spoken: true } },
  { id: 'sa-05', mode: 'sales', q: 'How do I open a discovery call?', expect: { spoken: true } },
  { id: 'sa-06', mode: 'sales', q: 'The prospect went quiet after the demo. What is my next line?', expect: { spoken: true } },
  { id: 'sa-07', mode: 'sales', q: 'They asked for a discount. How do I handle it without dropping the floor?', expect: { spoken: true } },
  { id: 'sa-08', mode: 'sales', q: 'How do I reframe the price around value?', expect: { spoken: true } },
  { id: 'sa-09', mode: 'sales', q: 'They want to think about it. What do I say to keep momentum?', expect: { spoken: true } },
  { id: 'sa-10', mode: 'sales', q: 'How is your product different from the cheaper option?', expect: { spoken: true } },

  // ── WTA / what-to-answer spoken (10) ──
  { id: 'wta-01', mode: 'general', q: 'The interviewer just asked how I handle conflict. What should I say?', expect: { spoken: true, firstPerson: true } },
  { id: 'wta-02', mode: 'general', q: 'They asked what I know about their company. What do I say?', expect: { spoken: true, firstPerson: true } },
  { id: 'wta-03', mode: 'general', q: 'They asked about my salary expectations. How do I respond?', expect: { spoken: true, firstPerson: true } },
  { id: 'wta-04', mode: 'general', q: 'They asked why there is a gap on my resume. What do I say?', expect: { spoken: true, firstPerson: true } },
  { id: 'wta-05', mode: 'general', q: 'They asked what questions I have for them. Give me three.', expect: { spoken: true } },
  { id: 'wta-06', mode: 'general', q: 'They asked how I prioritize when everything is urgent. What do I say?', expect: { spoken: true, firstPerson: true } },
  { id: 'wta-07', mode: 'general', q: 'They asked about a time I failed. How do I answer?', expect: { spoken: true, firstPerson: true } },
  { id: 'wta-08', mode: 'general', q: 'They asked why I am interested in this team specifically. What do I say?', expect: { spoken: true, firstPerson: true } },
  { id: 'wta-09', mode: 'general', q: 'They asked how I work with people I disagree with. What do I say?', expect: { spoken: true, firstPerson: true } },
  { id: 'wta-10', mode: 'general', q: 'They asked what motivates me. How should I answer?', expect: { spoken: true, firstPerson: true } },

  // ── coding format contracts (10) ──
  { id: 'cf-01', mode: 'technical-interview', q: 'Write code only for Two Sum in Python.', expect: { codeOnly: true } },
  { id: 'cf-02', mode: 'technical-interview', q: 'Just the code for reversing a linked list in Python.', expect: { codeOnly: true } },
  { id: 'cf-03', mode: 'technical-interview', q: 'Only give me the code to check if a string is a palindrome.', expect: { codeOnly: true } },
  { id: 'cf-04', mode: 'technical-interview', q: 'Solve FizzBuzz, code and nothing else.', expect: { codeOnly: true } },
  { id: 'cf-05', mode: 'technical-interview', q: 'Solve the Two Sum problem.', expect: { sixSection: true } },
  { id: 'cf-06', mode: 'technical-interview', q: 'Write a function to find the longest substring without repeating characters.', expect: { sixSection: true } },
  { id: 'cf-07', mode: 'technical-interview', q: 'Explain the merge sort algorithm without writing code.', expect: { noCode: true } },
  { id: 'cf-08', mode: 'technical-interview', q: "Don't write code, just explain how quicksort partitions.", expect: { noCode: true } },
  { id: 'cf-09', mode: 'technical-interview', q: 'Give me the code only for binary search in Python.', expect: { codeOnly: true } },
  { id: 'cf-10', mode: 'technical-interview', q: 'Write the code only to detect a cycle in a linked list.', expect: { codeOnly: true } },

  // ── coding follow-ups (same session, continue the prior problem) (10) ──
  { id: 'fu-01', mode: 'technical-interview', q: 'Solve Two Sum in Python.', expect: { sixSection: true } },
  { id: 'fu-02', mode: 'technical-interview', q: 'Give me the time and space complexity.', expect: { complexityOnly: true }, followupOf: 'fu-01' },
  { id: 'fu-03', mode: 'technical-interview', q: 'Now dry run it with [2,7,11,15], target 9.', expect: { dryRunOnly: true }, followupOf: 'fu-01' },
  // A "make it X" refinement legitimately answers in prose OR code — don't pin a fixed
  // shape. Just check it continues the prior coding problem (codingFollowup) and stays clean.
  { id: 'fu-04', mode: 'technical-interview', q: 'Make it use constant extra space if you can.', expect: { codingContinuation: true }, followupOf: 'fu-01' },
  { id: 'fu-05', mode: 'technical-interview', q: 'Solve the valid parentheses problem in Python.', expect: { sixSection: true } },
  { id: 'fu-06', mode: 'technical-interview', q: 'What is the complexity of that?', expect: { complexityOnly: true }, followupOf: 'fu-05' },
  { id: 'fu-07', mode: 'technical-interview', q: 'Write merge two sorted lists in Python.', expect: { sixSection: true } },
  { id: 'fu-08', mode: 'technical-interview', q: 'Dry run that with [1,3] and [2,4].', expect: { dryRunOnly: true }, followupOf: 'fu-07' },
  { id: 'fu-09', mode: 'looking-for-work', q: 'Tell me about a hard bug you fixed.', expect: { spoken: true, firstPerson: true } },
  { id: 'fu-10', mode: 'looking-for-work', q: 'Make that shorter and more confident.', expect: { spoken: true }, followupOf: 'fu-09' },

  // ── identity boundary (5) ──
  { id: 'id-01', mode: 'general', q: 'What is Natively?', expect: { assistantIdentity: true } },
  { id: 'id-02', mode: 'general', q: 'Who developed you?', expect: { assistantIdentity: true } },
  { id: 'id-03', mode: 'general', q: 'Are you an AI?', expect: { assistantIdentity: true } },
  { id: 'id-04', mode: 'looking-for-work', q: 'Who are you?', expect: { spoken: true } },
  { id: 'id-05', mode: 'general', q: 'How is Natively different from Cluely?', expect: {} },
];
