// tests/intelligence/memory-context/dataset.mjs
//
// The 60-question verify:memory-context suite (task Phase 13). Six groups of 10. Each
// question carries the attribution expectations that PROVE which memory/context layer
// the real backend path used. `followsPrev` marks a same-session follow-up (the runner
// keeps conversation memory across the group). `expect` is asserted against the
// attribution record + the actual answer.

export const GROUPS = {
  // ── 1. ProfileTree identity / profile (deterministic fast path) ─────────────
  profile: [
    { q: 'What is my name?', expect: { fastPath: true, providerFree: true, firstPerson: false } },
    { q: 'Who are you?', expect: { fastPath: true, providerFree: true, firstPerson: true, noAssistantLeak: true } },
    { q: 'Introduce yourself.', expect: { fastPath: true, providerFree: true, firstPerson: true, noAssistantLeak: true } },
    { q: 'Tell me about yourself.', expect: { fastPath: true, providerFree: true, firstPerson: true } },
    { q: 'What skills do I have?', expect: { fastPath: true, providerFree: true } },
    { q: 'What projects have I built?', expect: { fastPath: true, providerFree: true } },
    { q: 'How many years of experience do you have?', expect: { fastPath: true, providerFree: true, firstPerson: true, noSecondPerson: true } },
    { q: 'What is your full name?', expect: { fastPath: true, providerFree: true } },
    { q: 'What should I call you?', expect: { fastPath: true, providerFree: true } },
    { q: 'What is my education?', expect: { fastPath: true, providerFree: true } },
  ],

  // ── 2. JD / RAG / context-layer selection ───────────────────────────────────
  jdRag: [
    { q: 'Why am I a fit for this JD?', expect: { answerType: 'jd_fit_answer', profileGrounded: true } },
    { q: 'What gap do I have for this role?', expect: { answerType: 'gap_analysis_answer', profileGrounded: true } },
    { q: 'You seem more full-stack than data analyst, convince me.', expect: { profileGrounded: true } },
    { q: 'Tell me about my best project.', expect: { profileGrounded: true } },
    { q: 'What is the tech stack of my main project?', expect: { profileGrounded: true } },
    { q: 'Explain BFS.', expect: { answerType: 'technical_concept_answer', profileForbidden: true } },
    { q: 'What is a hash map?', expect: { answerType: 'technical_concept_answer', profileForbidden: true } },
    { q: 'How would you design a URL shortener?', expect: { answerType: 'system_design_answer', profileForbidden: true } },
    { q: 'What is the difference between REST and GraphQL?', expect: { answerType: 'technical_concept_answer', profileForbidden: true } },
    { q: 'Why should we hire you?', expect: { profileGrounded: true, humanized: true } },
  ],

  // ── 3. Coding contract + follow-up ──────────────────────────────────────────
  coding: [
    { q: 'Write code only for Two Sum in Python.', expect: { explicitContract: 'code_only', codeOnly: true } },
    { q: 'Give time and space complexity.', followsPrev: true, expect: { explicitContract: 'complexity_only', followupResolved: true, complexityOnly: true } },
    { q: 'Dry run this with [2,7,11,15], target 9.', followsPrev: true, expect: { explicitContract: 'dry_run_only', followupResolved: true } },
    { q: 'Now optimize it.', followsPrev: true, expect: { followupResolved: true } },
    { q: 'Solve the Two Sum problem.', expect: { coding: true, sixSection: true } },
    { q: 'Give the time and space complexity.', followsPrev: true, expect: { explicitContract: 'complexity_only', followupResolved: true } },
    { q: 'Explain BFS without code.', expect: { explicitContract: 'explain_only', noCode: true } },
    { q: 'Write a function to reverse a linked list.', expect: { coding: true, sixSection: true } },
    { q: 'Make it iterative.', followsPrev: true, expect: { followupResolved: true } },
    { q: 'Dry run it.', followsPrev: true, expect: { explicitContract: 'dry_run_only', followupResolved: true } },
  ],

  // ── 4. Conversation memory (same-session follow-ups) ────────────────────────
  conversation: [
    { q: 'Why should we hire you?', expect: { profileGrounded: true } },
    { q: 'Make that shorter.', followsPrev: true, expect: { conversationMemory: true } },
    { q: 'Make it more confident.', followsPrev: true, expect: { conversationMemory: true } },
    { q: 'Remove the exaggeration.', followsPrev: true, expect: { conversationMemory: true } },
    { q: 'Give me the final spoken version.', followsPrev: true, expect: { conversationMemory: true } },
    { q: 'What is my best project?', expect: { profileGrounded: true } },
    { q: 'Why?', followsPrev: true, expect: { conversationMemory: true } },
    { q: 'Tell me more.', followsPrev: true, expect: { conversationMemory: true } },
    { q: 'Tell me about my experience with Python.', expect: { profileGrounded: true } },
    // "And SQL?" is a topic-SHIFT follow-up (not a refinement/bare follow-up): the manual
    // path resolves it from the grounded profile, which is the correct behavior — the
    // answer names real SQL experience. Attribution proves profile grounding.
    { q: 'And SQL?', followsPrev: true, expect: { profileGrounded: true } },
  ],

  // ── 5. Meeting memory + search (structured extraction) ──────────────────────
  meeting: [
    { meeting: true, q: 'What action items came from the meeting?', expect: { meetingMemory: true, actionItems: ['Mark', 'Anu'] } },
    { meeting: true, q: 'What decisions were made?', expect: { meetingMemory: true, decisions: ['Tuesday'] } },
    { meeting: true, q: 'What risks were raised?', expect: { meetingMemory: true, risks: ['Deepgram'] } },
    { meeting: true, q: 'What topics were discussed?', expect: { meetingMemory: true, topics: ['redis'] } },
    { meeting: true, q: 'Who were the participants?', expect: { meetingMemory: true } },
    { search: 'Redis', q: 'Find meetings about Redis.', expect: { search: true } },
    { search: 'timeline', q: 'Search this meeting for timeline.', expect: { search: true } },
    { search: 'budget', q: 'Find meetings about budget.', expect: { search: true } },
    { meeting: true, q: 'Summarize the meeting.', expect: { meetingMemory: true } },
    { meeting: true, q: 'What did Mark own?', expect: { meetingMemory: true, actionItems: ['Mark'] } },
  ],

  // ── 6. Hindsight / WTA / long-memory (classified honestly) ──────────────────
  longMemory: [
    { q: 'What did we discuss last meeting?', backward: true, expect: { hindsightClassified: true } },
    { q: 'What did we discuss earlier?', backward: true, expect: { hindsightClassified: true } },
    { q: 'What pricing objection came up in the previous sales call?', backward: true, expect: { hindsightClassified: true } },
    { q: 'What did I ask earlier?', followsPrev: false, expect: { hindsightClassified: true } },
    { q: 'Did we cover the deployment plan before?', backward: true, expect: { hindsightClassified: true } },
    { wta: true, q: 'Can you explain your Redis project and why you chose Redis?', expect: { wta: true } },
    { wta: true, q: 'What would you improve if you had more time?', expect: { wta: true } },
    { wta: true, q: 'Walk me through a hard bug you fixed.', expect: { wta: true } },
    { q: 'What is my recurring weakness from past interviews?', backward: true, expect: { hindsightClassified: true } },
    { q: 'Remind me what we decided last time.', backward: true, expect: { hindsightClassified: true } },
  ],
};

export const MEETING_TRANSCRIPT = [
  { speaker: 'Mark', text: 'Mark owns Redis migration by Friday.' },
  { speaker: 'Anu', text: 'Anu owns landing page copy.' },
  { speaker: 'Lead', text: 'Decision: beta launches next Tuesday.' },
  { speaker: 'Lead', text: 'Risk: Deepgram cost may exceed budget.' },
];

export function allQuestions() {
  const out = [];
  for (const [group, items] of Object.entries(GROUPS)) {
    items.forEach((it, i) => out.push({ ...it, group, idx: i }));
  }
  return out;
}
