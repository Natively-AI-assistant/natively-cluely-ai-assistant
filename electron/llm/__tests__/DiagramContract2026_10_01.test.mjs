// electron/llm/__tests__/DiagramContract2026_10_01.test.mjs
//
// The system-design diagram contract in the composed system prompt, and the
// routing that decides it.
//
// The contract attaches SEMANTICALLY, like the coding contract: when the turn
// is a design / diagram turn (diagramPromptSignals), in any mode — never from
// a mode alone, and never on an action whose output is not an answer.
//
// Pinned here (the real-wiring E2E in tests/realtime-prompt/e2e-diagram.cjs
// pins the same things on the dispatched prompt, per route):
//   - exactly one <diagram_contract>, after the coding contract and the chat
//     layout, before the final check;
//   - the signals survive the cloud → local rebuild (the prompt registry);
//   - nothing per-turn enters the system prompt (bounded registry key space);
//   - Mermaid is never a coding answer type, and never validated as code;
//   - the planner routes a follow-up on the design as system design, and a
//     fresh question, a code ask and an unrelated turn as before.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.NATIVELY_PROMPT_SYSTEM_V2 = '1';
delete process.env.NATIVELY_SYSTEM_DESIGN_DIAGRAMS;
delete process.env.NATIVELY_DIAGRAM_EXAMPLES;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/', p)).href;
const { buildSystemPromptV2, getV2PromptDescriptor, resolveV2SystemPrompt } = await import(dist('llm/promptSystemV2.js'));
const dps = await import(dist('llm/diagramPromptSignals.js'));
const planner = await import(dist('llm/AnswerPlanner.js'));
const { validateAnswerStructure } = await import(dist('llm/AnswerValidator.js'));
const { prepareDirectAssistPrompt, DIRECT_ASSIST_SYSTEM_PROMPT } = await import(dist('direct-assist/requestBuilder.js'));

const NOTIFY = 'flowchart LR\n    producer["Producer Service"] -->|"enqueue"| queue["Notification Queue"]\n    queue --> worker["Delivery Worker"]\n    worker -->|"send"| provider["Email / SMS Provider"]';
const DESIGN = { artifactId: 'design-1.v1', lineageId: 'design-1', version: 1, view: 'architecture', type: 'flowchart', source: NOTIFY, foreground: true, updatedAt: Date.now() };
const count = (text, needle) => text.split(needle).length - 1;
const turn = (question, extra = {}) => dps.resolveDiagramTurn({ question, userInstructions: null, activeDesign: null, ...extra });

beforeEach(() => {
  dps.registerActiveDesignProvider(null);
  delete process.env.NATIVELY_SYSTEM_DESIGN_DIAGRAMS;
});

describe('the contract in the composed system prompt', () => {
  const signals = turn('Design a notification service with retries', { answerType: 'system_design_answer' }).signals;

  test('a design turn carries exactly one contract, in every mode', () => {
    for (const mode of ['general', 'technical-interview', 'team-meet', 'lecture', 'sales', 'custom', 'looking-for-work']) {
      const p = buildSystemPromptV2({ mode, action: 'answer', tier: 'cloud', diagram: signals });
      assert.equal(count(p, '<diagram_contract>'), 1, mode);
      assert.equal(count(p, '</diagram_contract>'), 1, mode);
    }
  });

  // Both lines exist because of what a real model wrote (DeepSeek, 2026-10-01):
  // a node called `graph`, and eleven-node diagrams with long connection labels
  // that had to be scaled down until nothing in them could be read.
  test('warns off Mermaid keywords as ids and says the card is small', () => {
    const p = buildSystemPromptV2({ mode: 'technical-interview', action: 'answer', tier: 'cloud', diagram: signals });
    assert.match(p, /never a Mermaid keyword \(end, graph, subgraph, class, style, click, call\)/);
    assert.match(p, /shown in a small card/);
    assert.match(p, /no path longer than five nodes/);
    assert.match(p, /in one to three words/);
  });

  test('no mode attaches it on its own', () => {
    for (const mode of ['general', 'technical-interview', 'team-meet', 'lecture', 'custom']) {
      for (const action of ['answer', 'what_to_say', 'brainstorm', 'followup']) {
        assert.equal(count(buildSystemPromptV2({ mode, action, tier: 'cloud' }), '<diagram_contract>'), 0, `${mode}/${action}`);
      }
    }
  });

  test('it comes after the coding contract and the chat layout, before the final check', () => {
    const mixed = turn('Design a payment system and implement the idempotency handler', { answerType: 'coding_question_answer' }).signals;
    const p = buildSystemPromptV2({ mode: 'technical-interview', action: 'answer', tier: 'cloud', surface: 'chat', codingTask: true, codingTaskKind: 'impl', diagram: mixed });
    const coding = p.indexOf('</coding_contract>');
    const layout = p.indexOf('</chat_layout>');
    const diagram = p.indexOf('<diagram_contract>');
    assert.ok(coding > 0 && layout > coding && diagram > layout, `coding=${coding} layout=${layout} diagram=${diagram}`);
    assert.ok(p.length - p.indexOf('</diagram_contract>') > 200, 'the final check still closes the prompt');
    assert.match(p, /The turn ALSO asks for code/);
  });

  test('attaching it does not change a byte of the coding contract', () => {
    const base = { mode: 'technical-interview', action: 'answer', tier: 'cloud', codingTask: true, codingTaskKind: 'dsa' };
    const without = buildSystemPromptV2(base);
    const withDiagram = buildSystemPromptV2({ ...base, diagram: signals });
    const block = (p) => p.slice(p.indexOf('<coding_contract>'), p.indexOf('</coding_contract>'));
    assert.equal(block(withDiagram), block(without));
  });

  test('actions whose output is not an answer never carry it', () => {
    for (const action of ['title', 'summary_json', 'followup_email', 'follow_up_questions', 'clarify']) {
      assert.equal(count(buildSystemPromptV2({ mode: 'general', action, tier: 'cloud', diagram: signals }), '<diagram_contract>'), 0, action);
    }
  });

  test('the live surface asks for spoken sentences; the reading surface allows short labelled lines', () => {
    const live = buildSystemPromptV2({ mode: 'general', action: 'answer', tier: 'cloud', surface: 'live', diagram: signals });
    const chat = buildSystemPromptV2({ mode: 'general', action: 'answer', tier: 'cloud', surface: 'chat', diagram: signals });
    assert.match(live, /Short enough to say aloud\. No headings\./);
    assert.match(chat, /A few short labelled lines are fine/);
  });

  test('a cloud → local rebuild recomposes the SAME contract from the registry descriptor', () => {
    const cloud = buildSystemPromptV2({ mode: 'general', action: 'answer', tier: 'cloud', diagram: signals });
    const desc = getV2PromptDescriptor(cloud);
    assert.deepEqual(desc.diagram, signals);
    const local = buildSystemPromptV2({ ...desc, tier: 'local' });
    assert.equal(count(local, '<diagram_contract>'), 1);
    assert.match(local, /flowchart LR/);
    assert.ok(local.length < cloud.length, 'the local variant is the compact one');
    assert.doesNotMatch(local, /DIAGRAM REFERENCE/, 'no reference examples on the small local tier');
  });

  test('the system prompt holds nothing per-turn: two different designs on the table compose the same text', () => {
    dps.registerActiveDesignProvider(() => DESIGN);
    const a = dps.resolveDiagramTurn({ question: 'Add a dead-letter queue', userInstructions: null });
    dps.registerActiveDesignProvider(() => ({ ...DESIGN, source: NOTIFY + '\n    worker --> dlq["Dead-Letter Queue"]', version: 2 }));
    const b = dps.resolveDiagramTurn({ question: 'Add a dead-letter queue', userInstructions: null });
    assert.notEqual(a.turnBlock, b.turnBlock, 'the turn blocks differ');
    assert.deepEqual(a.signals, b.signals);
    assert.equal(
      buildSystemPromptV2({ mode: 'general', action: 'answer', tier: 'cloud', diagram: a.signals }),
      buildSystemPromptV2({ mode: 'general', action: 'answer', tier: 'cloud', diagram: b.signals }),
    );
    assert.ok(!buildSystemPromptV2({ mode: 'general', action: 'answer', tier: 'cloud', diagram: a.signals }).includes('Producer Service'));
  });

  test('resolveV2SystemPrompt passes the signals through', () => {
    const p = resolveV2SystemPrompt({ action: 'answer', tier: 'cloud', activeMode: null, diagram: signals });
    assert.equal(count(p, '<diagram_contract>'), 1);
  });
});

describe('resolveDiagramTurn (the main-process resolver)', () => {
  test('a fresh design ask: signals with one example, no turn block', () => {
    const t = turn('Design a URL shortener that serves a million redirects', { answerType: 'system_design_answer' });
    assert.equal(t.request.enabled, true);
    assert.deepEqual(t.signals.exampleIds, ['url-shortener-high-traffic']);
    assert.equal(t.turnBlock, '');
  });

  test('the example knob: 0 and 2', () => {
    process.env.NATIVELY_DIAGRAM_EXAMPLES = '0';
    assert.deepEqual(turn('Design a URL shortener', { answerType: 'system_design_answer' }).signals.exampleIds, []);
    process.env.NATIVELY_DIAGRAM_EXAMPLES = '2';
    assert.equal(turn('Design a URL shortener', { answerType: 'system_design_answer' }).signals.exampleIds.length, 2);
    delete process.env.NATIVELY_DIAGRAM_EXAMPLES;
  });

  test('the feature switch turns the whole decision off', () => {
    process.env.NATIVELY_SYSTEM_DESIGN_DIAGRAMS = '0';
    const t = turn('Design a URL shortener', { answerType: 'system_design_answer', activeDesign: DESIGN });
    assert.equal(t.signals, null);
    assert.equal(t.turnBlock, '');
    assert.equal(dps.isSystemDesignDiagramsEnabled(), false);
    assert.equal(dps.alternativeDesignTurn(DESIGN), null);
  });

  test('an update: no examples, the design in the turn block, unescaped', () => {
    const t = turn('Add retry handling and a dead-letter queue', { activeDesign: DESIGN });
    assert.equal(t.signals.operation, 'update');
    assert.deepEqual(t.signals.exampleIds, []);
    assert.match(t.turnBlock, /^<active_design view="architecture" version="1">/);
    assert.ok(t.turnBlock.includes(NOTIFY));
    assert.ok(t.turnBlock.endsWith('</active_design>'));
  });

  test('undefined activeDesign reads the registered provider; null means "none"', () => {
    dps.registerActiveDesignProvider(() => DESIGN);
    assert.equal(dps.resolveDiagramTurn({ question: 'Add a dead-letter queue', userInstructions: null }).signals?.operation, 'update');
    assert.equal(dps.resolveDiagramTurn({ question: 'Add a dead-letter queue', userInstructions: null, activeDesign: null }).signals, null);
  });

  test('a code ask about the design: no contract, but the design rides as context', () => {
    const t = turn('Now write the delivery worker in TypeScript', { answerType: 'coding_question_answer', activeDesign: DESIGN });
    assert.equal(t.signals, null);
    assert.match(t.turnBlock, /The request refers to it: keep component names consistent/);
    assert.deepEqual(dps.v3DiagramTurn(t), { note: '', activeDesignBlock: t.turnBlock });
  });

  test('withDiagramContract is idempotent and a no-op without signals', () => {
    const t = turn('Design a URL shortener', { answerType: 'system_design_answer' });
    const once = dps.withDiagramContract('BASE', t);
    assert.equal(count(once, '<diagram_contract>'), 1);
    assert.equal(dps.withDiagramContract(once, t), once);
    assert.equal(dps.withDiagramContract('BASE', turn('What is caching?')), 'BASE');
    assert.equal(dps.withDiagramContract('BASE', null), 'BASE');
  });

  test('withDiagramTurnBlock appends once', () => {
    const t = turn('Add a cache', { activeDesign: DESIGN });
    const once = dps.withDiagramTurnBlock('CONTEXT', t);
    assert.equal(count(once, '<active_design view='), 1);
    assert.equal(dps.withDiagramTurnBlock(once, t), once);
  });

  test('the accepted action instruction is recognised exactly', () => {
    assert.equal(dps.isSystemDesignActionInstruction(dps.SYSTEM_DESIGN_ACTION_INSTRUCTION), true);
    assert.equal(dps.isSystemDesignActionInstruction('Structure the system design answer'), false);
    assert.equal(dps.isSystemDesignActionInstruction(undefined), false);
  });

  test('brainstorm over a design: the alternative variant; none without a design', () => {
    const t = dps.alternativeDesignTurn(DESIGN);
    assert.equal(t.signals.operation, 'alternative');
    assert.ok(t.turnBlock.includes(NOTIFY));
    assert.match(buildSystemPromptV2({ mode: 'general', action: 'brainstorm', tier: 'cloud', diagram: t.signals }), /asks for alternatives to it/);
    assert.equal(dps.alternativeDesignTurn(null), null);
  });
});

describe('AnswerPlanner', () => {
  const plan = (question, source = 'what_to_answer') => planner.planAnswer({ question, source });

  test('Mermaid is never a coding answer type', () => {
    assert.equal(planner.isCodingAnswerType('system_design_answer'), false);
  });

  test('no design on the table: routing is exactly what it was', () => {
    assert.equal(plan('Design a scalable notification system').answerType, 'system_design_answer');
    const before = plan('Why do we need the queue?').answerType;
    assert.notEqual(before, 'system_design_answer');
  });

  test('with a design on the table, a follow-up on it routes as system design', () => {
    dps.registerActiveDesignProvider(() => DESIGN);
    for (const q of ['Add retry handling and a dead-letter queue', 'Why do we need the queue?', 'Replace the queue with Kafka', 'How does this scale to ten million users?']) {
      assert.equal(plan(q).answerType, 'system_design_answer', q);
    }
  });

  test('…but a code ask, an unrelated turn and a profile question keep their own route', () => {
    dps.registerActiveDesignProvider(() => DESIGN);
    assert.equal(planner.isCodingAnswerType(plan('Now write the delivery worker in TypeScript').answerType), true);
    assert.equal(planner.isCodingAnswerType(plan('Write a function to solve two sum').answerType), true);
    assert.notEqual(plan('What are your salary expectations?').answerType, 'system_design_answer');
    assert.notEqual(plan('Tell me about yourself').answerType, 'system_design_answer');
  });

  test('after a code answer, a bare "this" follow-up stays a coding turn', () => {
    dps.registerActiveDesignProvider(() => ({ ...DESIGN, foreground: false }));
    assert.notEqual(plan('Why is this O(n)?').answerType, 'system_design_answer');
  });

  test('the switch off: no re-routing', () => {
    dps.registerActiveDesignProvider(() => DESIGN);
    process.env.NATIVELY_SYSTEM_DESIGN_DIAGRAMS = '0';
    const off = plan('Why do we need the queue?').answerType;
    delete process.env.NATIVELY_SYSTEM_DESIGN_DIAGRAMS;
    dps.registerActiveDesignProvider(null);
    assert.equal(off, plan('Why do we need the queue?').answerType);
  });

  test('the plan template defers to the contract when diagrams are on, and is the seven sections when off', () => {
    const p = plan('Design a scalable notification system');
    const on = planner.formatAnswerPlanForPrompt(p);
    assert.match(on, /Follow the diagram contract in the system prompt/);
    assert.doesNotMatch(on, /Clarify Requirements:/);
    process.env.NATIVELY_SYSTEM_DESIGN_DIAGRAMS = '0';
    const off = planner.formatAnswerPlanForPrompt(p);
    assert.match(off, /Clarify Requirements:/);
    assert.match(off, /Follow-up Points:/);
  });

  test('a design answer with a Mermaid block is not validated or repaired as code', () => {
    const answer = "I'd queue every send.\n\n```mermaid\n" + NOTIFY + '\n```\n\nThe worker owns delivery.';
    const v = validateAnswerStructure(answer, plan('Design a scalable notification system'));
    assert.equal(v.ok, true, JSON.stringify(v));
    assert.deepEqual(v.missingSections, [], 'no coding sections are demanded of a design answer');
  });
});

describe('Direct Assist (its own prompt, the same contract)', () => {
  const selection = { provider: 'gemini', model: 'gemini-2.5-flash' };
  const prep = (extra) => prepareDirectAssistPrompt({ requestId: 'r1', source: 'typed', selection, currentRequest: '', ...extra });

  test('an ordinary request is byte-identical to before', () => {
    const p = prep({ currentRequest: 'What is caching?' });
    assert.equal(p.systemPrompt, DIRECT_ASSIST_SYSTEM_PROMPT);
    assert.ok(!p.userPrompt.includes('<active_design'));
  });

  test('a design request gets the contract appended to its own system prompt, once', () => {
    const p = prep({ currentRequest: 'Design a notification service with retries' });
    assert.ok(p.systemPrompt.startsWith(DIRECT_ASSIST_SYSTEM_PROMPT));
    assert.equal(count(p.systemPrompt, '<diagram_contract>'), 1);
    assert.match(p.systemPrompt, /Reference 1/);
    assert.ok(!p.userPrompt.includes('<active_design view='));
  });

  test('a coding request does not', () => {
    assert.equal(prep({ currentRequest: 'Implement a rate limiter in Python' }).systemPrompt, DIRECT_ASSIST_SYSTEM_PROMPT);
  });

  test('a follow-up finds the design in the history the overlay sent, and carries it unescaped inside a transcript-scoped block', () => {
    const history = [
      { role: 'user', content: 'Design a notification service' },
      { role: 'assistant', content: "I'd queue every send.\n\n```mermaid\n" + NOTIFY + '\n```\n\nThe worker owns delivery.' },
    ];
    const p = prep({ currentRequest: 'Add retry handling and a dead-letter queue', history });
    assert.match(p.systemPrompt, /changes the design already on the table/);
    assert.equal(count(p.userPrompt, '<recent_transcript kind="active_design">'), 1);
    const block = p.userPrompt.slice(p.userPrompt.indexOf('<recent_transcript kind="active_design">'));
    assert.ok(block.includes('producer["Producer Service"] -->|"enqueue"| queue["Notification Queue"]'), 'arrows are not XML-escaped');
    // The transport strips <recent_transcript …>…</recent_transcript> when the
    // transcript scope is denied; the design must go with it.
    const stripped = p.userPrompt.replace(/<recent_transcript\b[\s\S]*?<\/recent_transcript>\s*/gi, '');
    assert.ok(!stripped.includes('Producer Service'));
  });

  test('without history the same words are an ordinary request', () => {
    const p = prep({ currentRequest: 'Add retry handling and a dead-letter queue' });
    assert.equal(p.systemPrompt, DIRECT_ASSIST_SYSTEM_PROMPT);
  });

  test('the accepted system-design action, sent as an output instruction, is a design ask', () => {
    const p = prep({ source: 'stt', currentRequest: `How would you handle that many messages?\n\nANSWER/OUTPUT INSTRUCTION:\n${dps.SYSTEM_DESIGN_ACTION_INSTRUCTION}` });
    assert.equal(count(p.systemPrompt, '<diagram_contract>'), 1);
  });

  test('the switch off: untouched', () => {
    process.env.NATIVELY_SYSTEM_DESIGN_DIAGRAMS = '0';
    assert.equal(prep({ currentRequest: 'Design a notification service with retries' }).systemPrompt, DIRECT_ASSIST_SYSTEM_PROMPT);
  });
});
