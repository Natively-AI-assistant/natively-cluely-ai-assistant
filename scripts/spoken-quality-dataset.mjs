// scripts/spoken-quality-dataset.mjs
//
// Question set for verify:spoken-quality. Generic, paraphrased prompts — NO Evin-specific
// facts, no expected fixed answers. Each item declares only the STYLE/length/coding
// properties the real backend output must satisfy (rubric-based, anti-hardcoding compliant).
//
// `expect` flags:
//   spoken         — first-person spoken answer, no corporate filler, under the word cap
//   maxWords       — hard word cap for this spoken answer (default 100)
//   maxSentences   — soft sentence cap
//   shortTech      — generic tech answer: short (<100 words), no tutorial list/analogy
//   codeOnly       — only code, no headings, and COMPLETE (no truncation)
//   complexityOnly — complexity for the active coding problem, no fresh code
//   sixSection     — full coding answer
//   followupOf     — same-session continuation of the referenced id
//   recallsOriginal— answer must reference the ORIGINAL coding problem, not the latest
//   detailAllowed  — long answer is allowed (exempt from the word cap)

export const QUESTIONS = [
  // ── interview spoken, length-bounded (12) ──
  { id: 'iv-01', mode: 'looking-for-work', q: 'Why should we hire you?', expect: { spoken: true, maxWords: 100 } },
  { id: 'iv-02', mode: 'looking-for-work', q: 'Why are you a good fit for this role?', expect: { spoken: true, maxWords: 100 } },
  { id: 'iv-03', mode: 'looking-for-work', q: 'What gap do you have for this job?', expect: { spoken: true, maxWords: 100 } },
  { id: 'iv-04', mode: 'looking-for-work', q: 'You seem more full-stack than a data analyst, convince me.', expect: { spoken: true, maxWords: 100 } },
  { id: 'iv-05', mode: 'looking-for-work', q: 'Why should we trust you with this?', expect: { spoken: true, maxWords: 100 } },
  { id: 'iv-06', mode: 'looking-for-work', q: 'Tell me about yourself.', expect: { spoken: true, maxWords: 110 } },
  { id: 'iv-07', mode: 'looking-for-work', q: 'Why do you want to work here?', expect: { spoken: true, maxWords: 100 } },
  { id: 'iv-08', mode: 'looking-for-work', q: 'What is your biggest strength?', expect: { spoken: true, maxWords: 100 } },
  { id: 'iv-09', mode: 'looking-for-work', q: 'Why are you leaving your current job?', expect: { spoken: true, maxWords: 100 } },
  { id: 'iv-10', mode: 'looking-for-work', q: 'Give me a confident but honest answer about a weakness.', expect: { spoken: true, maxWords: 100 } },
  { id: 'iv-11', mode: 'looking-for-work', q: 'What would you bring in your first month?', expect: { spoken: true, maxWords: 100 } },
  { id: 'iv-12', mode: 'looking-for-work', q: 'Why you over other candidates?', expect: { spoken: true, maxWords: 100 } },

  // ── one-sentence / shorter requests (4) ──
  { id: 'sh-01', mode: 'looking-for-work', q: 'Why should we hire you, in one sentence?', expect: { spoken: true, maxSentences: 2, maxWords: 60 } },
  { id: 'sh-02', mode: 'looking-for-work', q: 'In one line, what is your strongest skill?', expect: { spoken: true, maxSentences: 2, maxWords: 50 } },
  { id: 'sh-03', mode: 'looking-for-work', q: 'Give me a quick, brief answer: why this role?', expect: { spoken: true, maxWords: 70 } },
  { id: 'sh-04', mode: 'looking-for-work', q: 'TL;DR your background.', expect: { spoken: true, maxWords: 60 } },

  // ── generic technical concepts — short, not tutorials (10) ──
  { id: 'tc-01', mode: 'technical-interview', q: 'What is Redis?', expect: { shortTech: true } },
  { id: 'tc-02', mode: 'technical-interview', q: 'What is JWT?', expect: { shortTech: true } },
  { id: 'tc-03', mode: 'technical-interview', q: 'What is CORS?', expect: { shortTech: true } },
  { id: 'tc-04', mode: 'technical-interview', q: 'Explain REST API.', expect: { shortTech: true } },
  { id: 'tc-05', mode: 'technical-interview', q: 'Explain caching.', expect: { shortTech: true } },
  { id: 'tc-06', mode: 'technical-interview', q: 'What is database indexing?', expect: { shortTech: true } },
  { id: 'tc-07', mode: 'technical-interview', q: 'Explain the JavaScript event loop.', expect: { shortTech: true } },
  { id: 'tc-08', mode: 'technical-interview', q: 'What is a message queue?', expect: { shortTech: true } },
  { id: 'tc-09', mode: 'technical-interview', q: 'What is a load balancer?', expect: { shortTech: true } },
  { id: 'tc-10', mode: 'technical-interview', q: 'Explain idempotency.', expect: { shortTech: true } },

  // ── detail explicitly requested — long allowed (3) ──
  { id: 'dt-01', mode: 'technical-interview', q: 'Explain database indexing in detail, walk me through how it works.', expect: { detailAllowed: true } },
  { id: 'dt-02', mode: 'technical-interview', q: 'Design a URL shortener, step by step.', expect: { detailAllowed: true } },
  { id: 'dt-03', mode: 'technical-interview', q: 'Explain caching in depth with the tradeoffs.', expect: { detailAllowed: true } },

  // ── refinement follow-ups (3) ──
  { id: 'rf-01', mode: 'looking-for-work', q: 'Why should we hire you?', expect: { spoken: true } },
  { id: 'rf-02', mode: 'looking-for-work', q: 'Make that more natural.', expect: { spoken: true, maxWords: 110 }, followupOf: 'rf-01' },
  { id: 'rf-03', mode: 'looking-for-work', q: 'Make it less polished and shorter.', expect: { spoken: true, maxWords: 80 }, followupOf: 'rf-01' },

  // ── coding format + completeness (6) ──
  { id: 'cd-01', mode: 'technical-interview', q: 'Write code only for Valid Parentheses in Python.', expect: { codeOnly: true, complete: true } },
  { id: 'cd-02', mode: 'technical-interview', q: 'Write code only for Two Sum in Python.', expect: { codeOnly: true, complete: true } },
  { id: 'cd-03', mode: 'technical-interview', q: 'Just the code for reversing a linked list in Python.', expect: { codeOnly: true, complete: true } },
  { id: 'cd-04', mode: 'technical-interview', q: 'Code only: detect a cycle in a linked list.', expect: { codeOnly: true, complete: true } },
  { id: 'cd-05', mode: 'technical-interview', q: 'Solve the longest substring without repeating characters.', expect: { sixSection: true } },
  { id: 'cd-06', mode: 'technical-interview', q: 'Write the merge intervals solution in Python.', expect: { sixSection: true } },

  // ── coding memory thread (5, sequential same session) ──
  { id: 'cm-01', mode: 'technical-interview', q: 'Solve Two Sum in Python.', expect: { sixSection: true } },
  { id: 'cm-02', mode: 'technical-interview', q: 'Now optimize it.', expect: {}, followupOf: 'cm-01' },
  { id: 'cm-03', mode: 'technical-interview', q: 'Give time and space complexity.', expect: { complexityOnly: true }, followupOf: 'cm-01' },
  { id: 'cm-04', mode: 'technical-interview', q: 'Solve Valid Parentheses in Python.', expect: { sixSection: true } },
  { id: 'cm-05', mode: 'technical-interview', q: 'What was the original problem I asked?', expect: { recallsOriginal: 'two sum' }, followupOf: 'cm-01' },
];
