// The live-answer contract (2026-09-29).
//
// Measured on the real app (isolated dev:agent profile, gemini-3.1-flash-lite
// and deepseek-flash, no résumé, General mode): typed questions came back as
// coaching cards ("**Good interview answer:**" in quotes, labeled bullet
// sections, "the shape that works", "if you tell me the real situation I'll
// help you tighten it"), and the What-to-answer path either disclaimed ("I
// don't have the release scope in front of me") or invented shared context
// ("the goals we discussed", "the recent latency issues"). Every one of those
// shapes was an INSTRUCTION in the prompt. These tests pin the instructions
// that replaced them, not model output.
//
// Platform: pure string composition — identical on macOS and Windows.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron');
const ci = path.join(base, 'context-intelligence');
const { composePrompt } = await import(pathToFileURL(path.join(ci, 'generation/prompt-composer.js')).href);
const { decide } = await import(pathToFileURL(path.join(ci, 'orchestration/orchestrator.js')).href);
const { MODE_POLICIES } = await import(pathToFileURL(path.join(ci, 'policies/mode-policy-registry.js')).href);
const { createLiveTranscriptRetrievalPort, windowOnlyRestatesQuery } =
  await import(pathToFileURL(path.join(ci, 'retrieval/live-transcript-port.js')).href);
const v2 = await import(pathToFileURL(path.join(base, 'llm/promptSystemV2.js')).href);
const { adaptLegacyChunks } = await import(pathToFileURL(path.join(ci, 'retrieval/legacy-adapter.js')).href);
const { isEnumerableAsk, ENUMERABLE_FORM_LINE, ENUMERABLE_DETAIL_FORM_LINE } = await import(pathToFileURL(path.join(base, 'llm/answerStyle.js')).href);

const typed = (q, modeId = 'general') => decide({
  requestId: 'r1', requestSequence: 1, surface: 'manual-chat', modeId,
  scope: { userId: 'u1' }, sessionId: 's1', manualQuestion: q,
});
const heard = (q, modeId = 'general') => decide({
  requestId: 'r2', requestSequence: 1, surface: 'what-to-answer', modeId,
  scope: { userId: 'u1', sessionId: 's2' }, sessionId: 's2', transcriptQuestion: q,
});
const compose = (d, modeId, extra = {}) => composePrompt({
  decision: d, policy: MODE_POLICIES[modeId], evidence: [], attachedSourceCount: 0, profileSourceCount: 0, ...extra,
});

const COACHING_MANDATES = [
  /fill-in shape/i,
  /say it is not on file/i,
  /introduce it explicitly, e\.g\. "A possible way to phrase this:"/,
  /offer a clearly-labelled likely rationale/,
  /say plainly that it is not available before answering the general part/,
  /You may note in one short sentence that adding a résumé/,
];

describe('the composer no longer mandates coaching layers', () => {
  const cases = [
    ['General, typed', typed('Tell me about a time you faced a difficult challenge on a project.'), 'general', {}],
    ['General, heard', heard('Why should we hire you?'), 'general', { heardQuestion: true }],
    ['Looking for work, typed', typed('Tell me about yourself.', 'looking-for-work'), 'looking-for-work', {}],
    ['Looking for work, heard', heard('Tell me about yourself.', 'looking-for-work'), 'looking-for-work', { heardQuestion: true }],
    ['Technical interview, heard', heard('What was your team size on that project?', 'technical-interview'), 'technical-interview', { heardQuestion: true }],
  ];
  for (const [label, d, modeId, extra] of cases) {
    test(label, () => {
      const p = compose(d, modeId, extra);
      const all = `${p.system}\n${p.user}`;
      for (const re of COACHING_MANDATES) assert.doesNotMatch(all, re, `${label}: ${re}`);
    });
  }

  test('the answer is never introduced or labelled', () => {
    const p = compose(typed('Why should we hire you?'), 'general');
    assert.match(p.system, /never introduce or label it \("A possible way to phrase this:", "Suggested answer:", "Good interview answer:"\)/);
  });

  test('the no-context rule turns missing context into uncertainty inside the answer', () => {
    const p = compose(typed('Do you think we can finish by Friday?'), 'general');
    assert.match(p.system, /answer as the user would without it/);
    assert.match(p.system, /for a status or commitment, what they would check and the next step, never a promised outcome/);
    assert.match(p.system, /Never say the information is missing, never hand the question back/);
  });

  test('invented shared context is forbidden', () => {
    const p = compose(heard('What do you think about this proposal?'), 'general', { heardQuestion: true });
    assert.match(p.system, /Never refer to anything as already said, discussed, planned or known/);
  });

  test('the anti-fabrication rules are all still present', () => {
    const p = compose(typed('What is my CGPA?', 'looking-for-work'), 'looking-for-work');
    assert.match(p.system, /Never fabricate personal experience, employment, projects, skills or education\./);
    assert.match(p.system, /unless the evidence states it or the user told you it/);
    assert.match(p.user, /Do not invent source-specific facts/);
  });
});

describe('who is asking decides whether the gap is named', () => {
  test('a user looking up their OWN records still hears that no source has it, with the fix', () => {
    const p = compose(typed('What is my CGPA?', 'looking-for-work'), 'looking-for-work');
    assert.match(p.user, /If the question asks what a source or the user's own records say/);
    assert.match(p.user, /not established by any available source/);
    assert.ok(p.user.includes('Profile Intelligence'), 'the settings hint is kept for a records lookup');
  });

  test('a HEARD question never gets the settings hint or a note about sources', () => {
    const p = compose(heard('Tell me about yourself.', 'looking-for-work'), 'looking-for-work', { heardQuestion: true });
    if (p.sections.includes('no_evidence')) {
      assert.ok(!p.user.includes('Profile Intelligence'), p.user);
      assert.match(p.user, /do not mention sources, notes, or what is missing/);
    }
  });

  test('"Only answer from references" keeps its refusal wording (a user setting, unchanged)', () => {
    const d = decide({
      requestId: 'r9', requestSequence: 1, surface: 'manual-chat', modeId: 'looking-for-work',
      scope: { userId: 'u1' }, sessionId: 's9', manualQuestion: 'What is my CGPA?',
      userAnswerPolicy: 'only_answer_from_references',
    });
    const p = compose(d, 'looking-for-work');
    assert.ok(p.user.includes('NO reference material attached'), p.user);
  });
});

describe('nothing attached + a question about the user\'s past', () => {
  test('the zero-attachment notice forbids telling any story', () => {
    const d = typed('Tell me about a time you made a mistake at work.', 'looking-for-work');
    const p = compose(d, 'looking-for-work');
    if (!/No reference material is attached/.test(p.user)) return; // a different branch owns this turn
    assert.match(p.user, /tell no story: no "I once", no project, incident, employer or date/);
  });
  test('Looking for work tells a story only from the résumé or profile', () => {
    const p = v2.buildSystemPromptV2({ mode: 'looking-for-work', action: 'what_to_say', tier: 'cloud' });
    assert.match(p, /one compact story from the résumé or profile/);
    assert.match(p, /never an invented event or employer/);
    assert.doesNotMatch(p, /one compact grounded story/);
  });
});

describe('a personal story told from evidence cannot be embellished', () => {
  const resumeEvidence = adaptLegacyChunks([{
    sourceId: 'resume-1', chunkIndex: 0, score: 0.9,
    text: 'Tessellate Labs, Backend Engineer. A schema migration I shipped locked the orders table for 40 minutes; I led the rollback and wrote the postmortem.',
  }], {
    scope: { userId: 'u1' }, sourceTypes: new Map([['resume-1', 'RESUME']]),
    activeVersions: new Map([['resume-1', 'v1']]), chunkVersions: new Map([['resume-1', 'v1']]), assumeInScopeWhenUnknown: true,
  }).evidence;
  test('evidence + a question about the user renders the guard after the evidence', () => {
    const d = typed('Tell me about a time you had to deal with a difficult stakeholder.', 'looking-for-work');
    const p = composePrompt({ decision: d, policy: MODE_POLICIES['looking-for-work'], evidence: resumeEvidence, attachedSourceCount: 1, profileSourceCount: 0 });
    assert.ok(p.sections.includes('evidence'), `fixture must pack: ${p.sections.join(',')}`);
    assert.ok(p.sections.includes('evidence_story'), p.sections.join(','));
    assert.ok(p.sections.indexOf('evidence_story') > p.sections.indexOf('evidence'), 'must follow the evidence');
    assert.match(p.user, /Do not add a stakeholder, a disagreement, a colleague, a reaction or a result the evidence does not name/);
  });
  test('no evidence → no guard (the no-context rules own that case)', () => {
    const p = compose(typed('Tell me about a time you had to deal with a difficult stakeholder.', 'looking-for-work'), 'looking-for-work');
    assert.ok(!p.sections.includes('evidence_story'));
  });
  test('a general question with evidence gets no guard', () => {
    const d = typed('What is the difference between a process and a thread?');
    const p = composePrompt({ decision: d, policy: MODE_POLICIES.general, evidence: resumeEvidence, attachedSourceCount: 1, profileSourceCount: 0 });
    assert.ok(!p.sections.includes('evidence_story'), p.sections.join(','));
  });
});

describe('a question is not evidence for its own answer', () => {
  test('a window holding only the current question is dropped', () => {
    assert.equal(windowOnlyRestatesQuery('THEM: Why should we hire you?', 'Why should we hire you?'), true);
    assert.equal(windowOnlyRestatesQuery('THEM: why should we hire you', 'Why should we hire you?'), true);
  });
  test('any other line keeps the window', () => {
    assert.equal(windowOnlyRestatesQuery('ME: The UI is done.\nTHEM: Can we ship Friday?', 'Can we ship Friday?'), false);
  });
  test('a statement of record is evidence of itself, not a question to drop', () => {
    // Team meet capture: dropping this window told DeepSeek "nothing has been
    // said about this" and it replied in prose instead of Action/Decision lines
    // (captured prompt, 5/5 at HEAD → 0/5 with the window dropped).
    const said = "Okay, so Priya owns the vendor contract review, due Thursday, and we've decided to drop the legacy CSV export.";
    assert.equal(windowOnlyRestatesQuery(`THEM: ${said}`, said), false);
    assert.equal(windowOnlyRestatesQuery('THEM: Tell me about yourself.', 'Tell me about yourself.'), true);
  });
  test('a rewritten retrieval query keeps today\'s behaviour', () => {
    assert.equal(windowOnlyRestatesQuery('THEM: Why should we hire you?', 'hire reasons candidate strengths'), false);
    assert.equal(windowOnlyRestatesQuery('THEM: Why should we hire you?', ''), false);
  });
  test('end to end: the first question of a meeting retrieves nothing from itself', async () => {
    const q = 'Why should we hire you?';
    const port = createLiveTranscriptRetrievalPort({
      segments: [{ speaker: 'interviewer', text: q, timestamp: 1, final: true }],
      userId: 'u1', sessionId: 's2',
    });
    const d = heard(q);
    // Planned, so a zero below is the new filter, not the type filter.
    assert.ok(d.retrievalPlan.sourceTypes.includes('MEETING_TRANSCRIPT'), JSON.stringify(d.retrievalPlan.sourceTypes));
    const r = await port.retrieve({ decision: d });
    assert.equal(r.evidence.length, 0, JSON.stringify(r.evidence.map((e) => e.content)));
  });
  test('end to end: a decision said aloud in team meet stays evidence', async () => {
    const said = "Okay, so Priya owns the vendor contract review, due Thursday, and we've decided to drop the legacy CSV export.";
    const port = createLiveTranscriptRetrievalPort({
      segments: [{ speaker: 'interviewer', text: said, timestamp: 1, final: true }],
      userId: 'u1', sessionId: 's2',
    });
    const d = heard(said, 'team-meet');
    assert.ok(d.retrievalPlan.sourceTypes.includes('MEETING_TRANSCRIPT'), JSON.stringify(d.retrievalPlan.sourceTypes));
    const r = await port.retrieve({ decision: d });
    assert.ok(r.evidence.length > 0, 'the decision itself is what the capture lines come from');
    assert.match(r.evidence[0].content, /legacy CSV export/);
  });
  test('end to end: earlier speech around the question is still evidence', async () => {
    const q = 'What is left before we can ship on Friday?';
    const port = createLiveTranscriptRetrievalPort({
      segments: [
        { speaker: 'user', text: 'The UI is done, what is left is the payment integration and QA before Friday.', timestamp: 1, final: true },
        { speaker: 'interviewer', text: q, timestamp: 2, final: true },
      ],
      userId: 'u1', sessionId: 's2',
    });
    const d = heard(q, 'team-meet');
    assert.ok(d.retrievalPlan.sourceTypes.includes('MEETING_TRANSCRIPT'), JSON.stringify(d.retrievalPlan.sourceTypes));
    const r = await port.retrieve({ decision: d });
    assert.ok(r.evidence.length > 0, 'the window with real speech must survive');
    assert.match(r.evidence[0].content, /payment integration and QA/);
  });
});

describe('steps and counted sets get the list line at recency', () => {
  // The numbered-list rule in the system prompt lost to the recency sections:
  // "walk me through the steps" was listed 0/5 on both models (HEAD too), 5/5
  // with this line at the end of the user message.
  test('sequence and set asks are enumerable', () => {
    for (const q of [
      'Walk me through the steps to safely deploy a change to production.',
      'Give me three reasons we should use TypeScript instead of plain JavaScript.',
      'Can you explain in detail, step by step, how the TLS handshake works?',
      'What are the pros and cons of microservices?',
      'List the tradeoffs as bullet points.',
    ]) assert.equal(isEnumerableAsk(q), true, q);
  });
  test('stories, one-liners, judgement and plain questions are not', () => {
    for (const q of [
      'Tell me about yourself.',
      'Tell me about a time you took steps to rescue a failing project.',
      'In one sentence, what are the steps to deploy?',
      'What steps would you take to motivate a team that keeps missing deadlines?',
      'How does a REST API work?',
      'Why should we hire you?',
    ]) assert.equal(isEnumerableAsk(q), false, q);
  });
  test('rendered on both surfaces, after the notices, before the user\'s own instructions', () => {
    for (const d of [heard('Walk me through the steps to safely deploy a change to production.'), typed('Give me three reasons we should use TypeScript.')]) {
      const r = compose(d, 'general', { realtimeInstruction: 'Keep answers under 50 words.' });
      assert.ok(r.user.includes(ENUMERABLE_FORM_LINE), d.surface);
      const i = r.sections.indexOf('list_form');
      assert.ok(i > r.sections.indexOf('question'), r.sections.join(','));
      assert.ok(i < r.sections.indexOf('user_instructions'), r.sections.join(','));
    }
  });
  test('a statement or a preamble that counts things is not a list ask', () => {
    for (const [q, m] of [
      ['Just a few points before we wrap: Priya owns the contract review.', 'team-meet'],
      ['I handled the migration in three steps.', 'recruiting'],
      ["We've got three things to cover today. First, tell me about yourself.", 'general'],
    ]) assert.ok(!compose(heard(q, m), m).sections.includes('list_form'), q);
  });
  test('an explicit depth ask keeps its depth inside the list', () => {
    const r = compose(heard('Can you explain in detail, step by step, how the TLS handshake works?'), 'general');
    assert.ok(r.user.includes(ENUMERABLE_DETAIL_FORM_LINE));
    assert.ok(!r.user.includes(ENUMERABLE_FORM_LINE));
    assert.ok(compose(heard('Walk me through the steps to safely deploy a change to production.'), 'general').user.includes(ENUMERABLE_FORM_LINE));
  });
  test('absent for a non-enumerable question and for a coding turn', () => {
    assert.ok(!compose(heard('Why should we hire you?'), 'general').user.includes(ENUMERABLE_FORM_LINE));
    const d = heard('Walk me through the steps to reverse a linked list.');
    const coding = { ...d, questionTypes: [...d.questionTypes, 'CODING_TASK'] };
    assert.ok(!compose(coding, 'general').user.includes(ENUMERABLE_FORM_LINE));
  });
});

describe('Prompt System v2 carries the same contract', () => {
  // The SURFACE axis (2026-09-29): the caller declares where the answer is
  // used, so General mode no longer asks the model to guess whether it is a
  // chatbot. Measured on the wire before: a live Cmd+Enter turn in General got
  // "In direct chat, answer as an assistant", and the overlay's typed box got
  // the reading layout with a quoted "Good interview answer" close.
  test('live: General speaks as the user, with no chat layout and no "as an assistant"', () => {
    for (const tier of ['cloud', 'local']) {
      const p = v2.buildSystemPromptV2({ mode: 'general', action: 'answer', tier, surface: 'live' });
      assert.doesNotMatch(p, /<chat_layout>/, `${tier}: live surface got the reading layout`);
      assert.doesNotMatch(p, /In direct chat, answer as an assistant/, `${tier}`);
      assert.doesNotMatch(p, /the assistant in direct chat/, `${tier}`);
      // the core may NAME it in its ban list; nothing may mandate it
      assert.doesNotMatch(p, /close with the label \*\*Good interview answer|end with \*\*Good interview answer/i, `${tier}`);
      assert.match(p, /says it aloud next/, `${tier}: live mode text missing`);
      assert.match(p, /words they will say aloud to the other person/, `${tier}: live speaker missing`);
      assert.match(p, /never with advice about how to answer it/, `${tier}: live answer action missing`);
    }
  });
  test('chat: the launcher keeps its reading layout (coaching is allowed off the live surface)', () => {
    const p = v2.buildSystemPromptV2({ mode: 'general', action: 'answer', tier: 'cloud', surface: 'chat' });
    assert.match(p, /<chat_layout>/);
    assert.match(p, /Good interview answer:/);
    assert.match(p, /This is direct chat: the user reads the answer themselves/);
    // the legacy spelling still means chat
    assert.equal(v2.buildSystemPromptV2({ mode: 'general', action: 'answer', tier: 'cloud', chatSurface: true }), p);
  });
  test('no surface declared: byte-identical to the pre-surface text (callers not yet classified)', () => {
    const p = v2.buildSystemPromptV2({ mode: 'general', action: 'answer', tier: 'cloud' });
    assert.match(p, /In a live conversation, give the user the words they need or a concise explanation\. In direct chat, answer as an assistant\./);
    assert.match(p, /In a live role mode, output the exact words that role should say\. In direct chat or an explanatory mode, answer the user directly\./);
    assert.doesNotMatch(p, /<chat_layout>/);
  });
  test('surface only resolves General: Lecture keeps its study-partner speaker live', () => {
    const p = v2.buildSystemPromptV2({ mode: 'lecture', action: 'answer', tier: 'cloud', surface: 'live' });
    assert.match(p, /a quiet study partner explaining to the student/);
    assert.doesNotMatch(p, /words they will say aloud to the other person/);
  });
  test('wiring: every live call site declares the live surface, and the manual handler decides it per sender', async () => {
    const fs = await import('node:fs');
    const src = (f) => fs.readFileSync(path.resolve(process.cwd(), f), 'utf8');
    const ipc = src('electron/ipcHandlers.ts');
    assert.doesNotMatch(ipc, /chatSurface: true,/, 'a hardcoded chatSurface came back');
    assert.match(ipc, /const answerSurface: 'live' \| 'chat' = options\?\.surface \?\?/);
    assert.match(ipc, /getOverlayWindow\?\.\(\)\?\.webContents\?\.id === senderId \? 'live' : 'chat'/);
    assert.match(ipc, /surface: answerSurface,/, 'V3 persona no longer takes the resolved surface');
    assert.match(ipc, /readingSurface: answerSurface === 'chat'/);
    assert.match(ipc, /defaultLengthDirective: answerSurface === 'live' \?/, 'the live typed box lost the spoken-length default');
    assert.match(ipc, /question: message \}\), 'live'\), false, false/, 'phone mirror lost the live surface');
    const engine = src('electron/IntelligenceEngine.ts');
    assert.match(engine, /action: \(_liveCoding \|\| _explanatoryMode\) \? 'answer' : 'what_to_say',\s*\/\/[^\n]*\n(\s*\/\/[^\n]*\n)*\s*surface: 'live',/);
    const wta = src('electron/llm/WhatToAnswerLLM.ts');
    assert.match(wta, /action: 'what_to_say',\s*surface: 'live',/);
  });

  test('"tell me about yourself" can never be read as a question about Natively', () => {
    const cloud = v2.buildSystemPromptV2({ mode: 'general', action: 'answer', tier: 'cloud' });
    assert.doesNotMatch(cloud, /If asked who you are, say: "I'm Natively/);
    assert.match(cloud, /Only when the user asks what YOU are/);
    assert.match(cloud, /"tell me about yourself", "introduce yourself", "why should we hire you"\) is about the user, never about you/);
    const local = v2.buildSystemPromptV2({ mode: 'general', action: 'answer', tier: 'local' });
    assert.match(local, /"Tell me about yourself" means the user, never Natively/);
  });

  test('no-story personal questions are answered as the user\'s approach, never as a disclaimer', () => {
    const p = v2.buildSystemPromptV2({ mode: 'looking-for-work', action: 'what_to_say', tier: 'cloud' });
    assert.doesNotMatch(p, /I haven't handled that exact situation directly/);
    assert.match(p, /never claim the user lacks the experience \(you do not know that\)/);
  });

  test('one cohesive paragraph, but steps and sets still get a numbered list', () => {
    // Measured 2026-09-29: without the exception, "walk me through the steps"
    // lost its numbered list on the typed box (3/3 → 0/3 on both models).
    const p = v2.buildSystemPromptV2({ mode: 'general', action: 'answer', tier: 'cloud', surface: 'live' });
    assert.match(p, /write one cohesive paragraph/);
    assert.match(p, /A request for steps or a set \("walk me through the steps", "three reasons"\) is the exception: use the numbered list/);
  });

  test('a normal live answer targets ~30 seconds', () => {
    const p = v2.buildSystemPromptV2({ mode: 'general', action: 'what_to_say', tier: 'cloud' });
    assert.match(p, /a normal live answer is 40 to 80 words, about 30 seconds spoken/);
    assert.doesNotMatch(p, /80 to 160 words/);
  });
});

describe('the reading surface drops the say-it-aloud rules; live keeps them', () => {
  test('manual-chat composed for the launcher (readingSurface) has no spoken-delivery rules', () => {
    const d = typed('What is dependency injection?');
    const live = compose(d, 'general');
    const read = compose(d, 'general', { readingSurface: true });
    assert.match(live.system, /Produce one natural, speakable answer\./);
    assert.match(live.system, /Keep it short enough to say out loud/);
    assert.doesNotMatch(read.system, /speakable answer|say out loud/);
    assert.match(read.system, /Produce one clear answer\./);
  });
});

describe('provider paths no longer swap in a legacy persona', () => {
  test('the Groq failover rung sends the caller\'s prompt, not GROQ_SYSTEM_PROMPT', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(path.resolve(process.cwd(), 'electron/LLMHelper.ts'), 'utf8');
    const i = src.indexOf('private buildTextSpareRungs(');
    const body = src.slice(i, src.indexOf('\n  }\n', i));
    assert.ok(i > 0, 'buildTextSpareRungs moved');
    assert.doesNotMatch(body, /injectLanguageInstruction\(GROQ_SYSTEM_PROMPT\)/);
    assert.match(body, /const groqSystem = finalSystemPrompt;/);
  });
  test('a prompt that already carries a v2 core is recognised (no tiny base stacked in front)', () => {
    const cloud = v2.buildSystemPromptV2({ mode: 'general', action: 'answer', tier: 'cloud', surface: 'live' });
    const local = v2.buildSystemPromptV2({ mode: 'general', action: 'answer', tier: 'local', surface: 'live' });
    assert.equal(v2.carriesV2Core(cloud), true);
    assert.equal(v2.carriesV2Core(local), true);
    // a V3 composition starts with its persona base
    assert.equal(v2.carriesV2Core(`${local}\n\n# Rules\n- x\n\n[LANGUAGE INSTRUCTION — HIGHEST PRIORITY]\n...`), true);
    assert.equal(v2.carriesV2Core('You are a helpful assistant.'), false);
    assert.equal(v2.carriesV2Core(''), false);
  });
});

describe('a status or current-work ask is about the user, not general knowledge', () => {
  // Measured on the wire 2026-09-29: "Give me a quick project update." and
  // "what are you working on right now?" routed GENERAL_TECHNICAL/FAST, so no
  // notice (and no worked status example) reached the model — DeepSeek handed
  // the question back ("tell me which project…"), Gemini invented a project.
  for (const q of [
    'Give me a quick project update.',
    'Where do things stand?',
    "What's the latest status?",
    'Can you give me a status update?',
  ]) {
    test(`a status ask plans the meeting and the documents, like "are we on schedule?": ${q}`, () => {
      const d = heard(q);
      assert.ok(d.questionTypes.includes('MEETING_FACT'), `${q}: ${d.questionTypes.join(',')}`);
      assert.ok(d.claimRequirements.some((c) => c.claimType === 'MEETING_STATEMENT'));
      assert.ok(d.retrievalPlan.sourceTypes.includes('MEETING_TRANSCRIPT'), d.retrievalPlan.sourceTypes.join('/'));
      assert.notEqual(d.retrievalPlan.path, 'FAST');
    });
  }
  for (const [q, modeId] of [['Give me a quick project update.', 'team-meet'], ["What's the latest status?", 'sales'], ['Where do things stand?', 'seminar']]) {
    test(`...in ${modeId} too: ${q}`, () => {
      const d = heard(q, modeId);
      assert.ok(d.retrievalPlan.sourceTypes.includes('MEETING_TRANSCRIPT'), `${modeId}: ${d.retrievalPlan.sourceTypes.join('/')}`);
    });
  }
  test('a current-work ask is the user\'s own work', () => {
    const d = heard('Sorry to cut in, what are you working on right now?');
    assert.ok(d.questionTypes.includes('PERSONAL_PROJECT'), d.questionTypes.join(','));
    assert.ok(d.claimRequirements.some((c) => c.claimType === 'USER_PROJECT'));
  });
  for (const q of [
    'What is dependency injection?',
    'Explain REST APIs and how they work.',
    'Give me three reasons we should use TypeScript instead of plain JavaScript.',
    'Walk me through the steps to safely deploy a change to production.',
    'How does a status code 404 differ from 410?',
  ]) {
    test(`a technical ask stays general: ${q}`, () => {
      const d = heard(q);
      assert.ok(!d.questionTypes.includes('PERSONAL_PROJECT'), `${q}: ${d.questionTypes.join(',')}`);
    });
  }
});
