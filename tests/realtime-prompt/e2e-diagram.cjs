// tests/realtime-prompt/e2e-diagram.cjs — run: npm run test:diagram:wiring
//
// REAL-WIRING E2E for system-design diagrams (no network, no keys).
//
// Real: DatabaseManager (isolated dir), ModesManager, IntelligenceEngine,
// WhatToAnswerLLM, AnswerLLM, FollowUpLLM, BrainstormLLM, the V3 bridge and
// composer, AnswerPlanner, AnswerValidator, SessionTracker.
// Stubbed: ONLY the provider call (LLMHelper.streamChat). It records the exact
// (userMessage, systemPrompt) that would leave the process and streams back a
// canned answer in small chunks.
//
// What it proves, per route, for the prompt that is actually dispatched:
//   - a design question carries the diagram contract EXACTLY ONCE, with one
//     reference example, and without the old seven-section template beside it;
//   - a coding question, a concept question and small talk carry none;
//   - a follow-up on the design gets the update / explain contract and the
//     design on the table (its Mermaid arrows unescaped);
//   - one provider call per answer — the diagram is not a second generation;
//   - the committed answer keeps its Mermaid block byte for byte;
//   - a refinement that drops or mutates the diagram is corrected;
//   - a speculative run records nothing; a new meeting and a mode switch start clean;
//   - Mermaid is never sent to the code-verification path.
//
// `--v3=0` runs the same scenarios on the legacy / Prompt System v2 fallback.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const root = path.resolve(__dirname, '..', '..');
const V3 = (process.argv.find((a) => a.startsWith('--v3=')) || '--v3=1').slice(5);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-e2e-diagram-'));
process.env.NATIVELY_TEST_USERDATA = userData;
process.env.NATIVELY_CONTEXT_INTELLIGENCE_V3 = V3;
delete process.env.NATIVELY_SYSTEM_DESIGN_DIAGRAMS;
delete process.env.NATIVELY_DIAGRAM_EXAMPLES;
const d = (p) => path.join(root, 'dist-electron/electron', p);

const realLog = console.log.bind(console);
const quiet = () => {};
console.log = quiet; console.warn = quiet; console.info = quiet; console.debug = quiet;
const out = (...a) => realLog(...a);

const fence = (src, tag = 'mermaid') => '```' + tag + '\n' + src + '\n```';
const NOTIFY = [
  'flowchart LR',
  '    producer["Producer Service"] -->|"enqueue"| queue["Notification Queue"]',
  '    queue --> worker["Delivery Worker"]',
  '    worker -->|"send"| provider["Email / SMS Provider"]',
  '    worker -->|"record"| log[("Delivery Log")]',
].join('\n');
const NOTIFY_V2 = NOTIFY + '\n    worker -->|"failed"| retry["Retry Queue"]\n    worker -->|"exhausted"| dlq["Dead-Letter Queue"]';
const DESIGN_ANSWER = `I'd put a queue between producers and delivery, assuming at-least-once sends with an idempotency key.\n\n${fence(NOTIFY)}\n\nProducers only enqueue. The worker owns delivery and records every attempt, so a slow provider never blocks a producer. The tradeoff is duplicate sends under retry, which the idempotency key absorbs.`;
const UPDATE_ANSWER = `Adding a retry queue with backoff and a dead-letter queue for exhausted attempts.\n\n${fence(NOTIFY_V2)}\n\nRetries stay off the hot path, and anything that keeps failing is parked for inspection.`;
const EXPLAIN_ANSWER = 'The queue decouples producers from a slow or failing provider, so a spike in sends never blocks the service that created them.';
const SHORT_NO_DIAGRAM = 'A queue sits between producers and the delivery worker.\n\nIt keeps a slow provider from blocking producers.';
const CODING_ANSWER = '## Approach\nUse a hash map.\n\n## Technique\nHashing\n\n## Code\n```python\ndef two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i\n```\n\n## Dry Run\nnums=[2,7], target=9 returns [0,1].\n\n## Complexity\nTime O(n), space O(n).\n\n## Interviewer Follow-up Points\n- Sorted input variant.';
const PROSE = 'Caching keeps a copy of expensive results close to where they are needed, so repeated reads skip the slow path.';
const MIXED_ANSWER = `I'd make the payment write idempotent at the API edge.\n\n${fence('flowchart LR\n    client["Client"] -->|"POST /pay + key"| api["Payment API"]\n    api --> store[("Idempotency Store")]\n    api --> ledger[("Ledger")]')}\n\nThe key is checked before the ledger write.\n\n${fence('export async function handle(key: string) {\n  return key;\n}', 'ts')}\n`;

function makeHelper(queue, captured) {
  const base = {
    setNegotiationCoachingHandler() {}, isUsingOllama() { return false; }, canUseLocalFallback() { return false; },
    getPromptTier() { return 'cloud'; }, getCapabilities() { return { contextWindow: 128000, supportsVision: true }; },
    fitContextForCurrentModel(x) { return x; }, rememberAnswerCall() {},
    async *streamChat(...args) {
      const canned = queue.length > 1 ? queue.shift() : queue[0];
      captured.push({ user: String(args[0] ?? ''), context: String(args[2] ?? ''), system: String(args[3] ?? '') });
      for (const part of String(canned).match(/[\s\S]{1,7}/g) || []) yield part;
    },
  };
  return new Proxy(base, { get(t, k) { return k in t ? t[k] : undefined; }, has() { return true; }, ownKeys(t) { return Reflect.ownKeys(t); } });
}

function setMode(template, custom) {
  const { ModesManager } = require(d('services/ModesManager.js'));
  const mm = ModesManager.getInstance();
  const mode = custom ? mm.createMode({ name: custom, templateType: template }) : mm.getModes().find((m) => m.templateType === template);
  if (!mode) throw new Error(`no mode for template ${template}`);
  mm.updateMode(mode.id, { customContext: '' });
  mm.setActiveMode(mode.id);
  return mode;
}

/** A fresh engine + session with a provider stub that answers from `answers` in order. */
function makeEngine(answers) {
  const { IntelligenceEngine } = require(d('IntelligenceEngine.js'));
  const { SessionTracker } = require(d('SessionTracker.js'));
  const captured = [];
  const queue = [...answers];
  const session = new SessionTracker();
  const engine = new IntelligenceEngine(makeHelper(queue, captured), session);
  const events = { tokens: [], answers: [], refined: [] };
  engine.on('suggested_answer_token', (t) => events.tokens.push(String(t)));
  engine.on('suggested_answer', (a) => events.answers.push(String(a)));
  engine.on('refined_answer', (a) => events.refined.push(String(a)));
  return { engine, session, captured, events };
}

async function ask(ctx, question, options) {
  ctx.session.addTranscript({ speaker: 'system', text: question, timestamp: Date.now(), final: true });
  const before = ctx.captured.length;
  const returned = await ctx.engine.runWhatShouldISay(question, 0.9, undefined, { skipCooldown: true, ...(options || {}) });
  const calls = ctx.captured.slice(before);
  return { returned, calls, sent: calls[0] || { user: '', context: '', system: '' } };
}

const results = [];
const check = (scenario, name, ok, detail) => {
  results.push({ scenario, name, ok });
  out(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        -> ${String(detail ?? '').slice(0, 600)}`}`);
};
const all = (c) => `${c.system}\n${c.context}\n${c.user}`;
const count = (text, needle) => text.split(needle).length - 1;
const contracts = (c) => count(all(c), '<diagram_contract>');
const OLD_TEMPLATE = /Clarify Requirements:|High-Level Design:|Core Components:/;

(async () => {
  out(`\n##### diagrams · V3=${V3}  userData=${userData}`);

  // ── D1 ────────────────────────────────────────────────────────────────
  out('\nD1  Technical interview · spoken "Design a notification service with retries"');
  setMode('technical-interview');
  let ctx = makeEngine([DESIGN_ANSWER]);
  let r = await ask(ctx, 'Design a notification service with retries.');
  check('D1', 'exactly ONE provider call (the diagram is not a second generation)', r.calls.length === 1, `calls=${r.calls.length}`);
  check('D1', 'the diagram contract is dispatched exactly once', contracts(r.sent) === 1, `count=${contracts(r.sent)}`);
  check('D1', 'the contract is on the SYSTEM channel', count(r.sent.system, '<diagram_contract>') === 1, 'not in system');
  check('D1', 'asks for a fenced mermaid block early, then a brief explanation', /fenced code block tagged `mermaid`/.test(r.sent.system) && /It comes early/.test(r.sent.system), 'order rule missing');
  check('D1', 'architecture view → flowchart LR', /Type: `flowchart LR`/.test(r.sent.system), 'type rule missing');
  check('D1', 'exactly one reference example, framed as style', count(r.sent.system, 'Reference 1') === 1 && !/Reference 2/.test(r.sent.system) && /NOT facts about this conversation/.test(r.sent.system), 'example block wrong');
  check('D1', 'the picked example is the notification one', /Design a notification service with retries\./.test(r.sent.system.split('DIAGRAM REFERENCE')[1] || ''), 'wrong example');
  check('D1', 'the old seven-section template is NOT sent beside it', !OLD_TEMPLATE.test(all(r.sent)), (all(r.sent).match(/.{0,80}(Clarify Requirements:|High-Level Design:).{0,80}/) || [''])[0]);
  check('D1', 'no coding contract and no verification spec for a diagram turn', !/<coding_contract>/.test(r.sent.system) && !/verification_spec/.test(all(r.sent)), 'coding machinery attached');
  check('D1', 'the "exact words to say" action is not used for an artifact turn', !/Output only the exact words the user should say next/.test(r.sent.system), 'what_to_say action attached');
  check('D1', 'committed answer keeps the Mermaid block byte for byte', String(r.returned).includes(fence(NOTIFY)), String(r.returned).slice(0, 300));
  check('D1', 'the prose around it survives too', String(r.returned).includes("I'd put a queue between") && String(r.returned).includes('idempotency key absorbs'), String(r.returned).slice(-200));
  const streamed = ctx.events.tokens.join('');
  check('D1', 'the block streams live, before the explanation finishes', streamed.indexOf('```mermaid') > 0 && streamed.indexOf('```mermaid') < streamed.indexOf('Producers only enqueue'), 'order in stream');
  let design = ctx.session.getActiveDesign();
  check('D1', 'the answer became the design on the table (v1, with its question)', design && design.version === 1 && design.source === NOTIFY && /notification service/i.test(design.question || ''), JSON.stringify(design));
  if (V3 === '1') {
    check('D1', 'the turn note rides the user message, after any length line', /<presentation_instruction note="Diagram for this turn\./.test(r.sent.user) && /never the block itself/.test(r.sent.user), r.sent.user.slice(-400));
  }

  // ── D2 ────────────────────────────────────────────────────────────────
  out('\nD2  Same session · "Add retry handling and a dead-letter queue" → update that design');
  ctx.captured.length = 0;
  ctx = Object.assign(ctx, { });
  const queue2 = makeEngine([UPDATE_ANSWER]);
  // Same SESSION (the design lives on the tracker), fresh provider stub.
  const { IntelligenceEngine } = require(d('IntelligenceEngine.js'));
  const cap2 = [];
  const engine2 = new IntelligenceEngine(makeHelper([UPDATE_ANSWER], cap2), ctx.session);
  void queue2;
  let ctx2 = { engine: engine2, session: ctx.session, captured: cap2, events: { tokens: [], answers: [], refined: [] } };
  r = await ask(ctx2, 'Add retry handling and a dead-letter queue');
  check('D2', 'one provider call', r.calls.length === 1, `calls=${r.calls.length}`);
  check('D2', 'the UPDATE contract is dispatched exactly once', contracts(r.sent) === 1 && /changes the design already on the table/.test(r.sent.system), `count=${contracts(r.sent)}`);
  check('D2', 'asks for the FULL updated diagram, same node ids', /FULL updated diagram/.test(r.sent.system) && /keep every node id/.test(r.sent.system), 'update rules missing');
  check('D2', 'no reference example on an update', !/DIAGRAM REFERENCE/.test(r.sent.system), 'example attached to an update');
  const sentAll = all(r.sent);
  check('D2', 'the design on the table is in the turn, exactly once', count(sentAll, '<active_design view=') === 1, `count=${count(sentAll, '<active_design view=')}`);
  check('D2', 'its Mermaid is NOT XML-escaped (arrows intact)', sentAll.includes('producer["Producer Service"] -->|"enqueue"| queue["Notification Queue"]') && !/--&gt;/.test(sentAll.slice(sentAll.indexOf('<active_design view='))), sentAll.slice(sentAll.indexOf('<active_design view='), sentAll.indexOf('<active_design view=') + 300));
  check('D2', 'the design block is NOT in the system prompt (bounded prompt registry)', !/<active_design/.test(r.sent.system) || V3 !== '1' ? !/<active_design[^>]*>[\s\S]*Producer Service/.test(r.sent.system) : true, 'design text in system prompt');
  design = ctx.session.getActiveDesign();
  check('D2', 'the update is version 2 of the SAME design, pointing at v1', design && design.version === 2 && design.parentArtifactId === 'design-1.v1' && design.source === NOTIFY_V2, JSON.stringify(design));

  // ── D3 ────────────────────────────────────────────────────────────────
  out('\nD3  Same session · "Why do we need the queue?" → explain, no new diagram');
  const cap3 = [];
  const engine3 = new IntelligenceEngine(makeHelper([EXPLAIN_ANSWER], cap3), ctx.session);
  r = await ask({ engine: engine3, session: ctx.session, captured: cap3 }, 'Why do we need the queue?');
  check('D3', 'the EXPLAIN contract: prose, no diagram', contracts(r.sent) === 1 && /Do NOT output a mermaid block/.test(r.sent.system), r.sent.system.slice(r.sent.system.indexOf('<diagram_contract>'), r.sent.system.indexOf('<diagram_contract>') + 300));
  check('D3', 'the design is supplied as context', count(all(r.sent), '<active_design view=') === 1, 'no design block');
  design = ctx.session.getActiveDesign();
  check('D3', 'an answer without a diagram leaves the design untouched (still v2)', design && design.version === 2 && design.source === NOTIFY_V2, JSON.stringify(design));

  // ── D4 ────────────────────────────────────────────────────────────────
  out('\nD4  Same session · refine "shorten" where the model DROPS the diagram');
  const cap4 = [];
  const engine4 = new IntelligenceEngine(makeHelper([SHORT_NO_DIAGRAM], cap4), ctx.session);
  // The answer being refined is the last assistant message; make it the v2 design answer.
  ctx.session.addAssistantMessage(UPDATE_ANSWER, undefined, 'what_to_answer');
  const refinedEvents = [];
  engine4.on('refined_answer', (a) => refinedEvents.push(String(a)));
  const refined = await engine4.runFollowUp('shorten');
  check('D4', 'one provider call', cap4.length === 1, `calls=${cap4.length}`);
  check('D4', 'the model is told to carry the block over unchanged', /reproduce the mermaid block exactly as it is/i.test(cap4[0]?.system || ''), (cap4[0]?.system || '').slice(-300));
  check('D4', 'the dropped diagram is put back, unchanged', String(refined).includes(fence(NOTIFY_V2)), String(refined).slice(0, 400));
  check('D4', 'the shortened prose is what the model wrote', String(refined).startsWith('A queue sits between producers') && String(refined).includes('It keeps a slow provider'), String(refined).slice(0, 200));
  check('D4', 'the renderer receives the corrected text as the authoritative final', refinedEvents[0] === refined, 'event text differs');
  design = ctx.session.getActiveDesign();
  check('D4', 'a refinement is not a new version', design && design.version === 2, JSON.stringify(design));

  out('\nD4b refine that is ABOUT the diagram is left to the model');
  const cap4b = [];
  const engine4b = new IntelligenceEngine(makeHelper([SHORT_NO_DIAGRAM], cap4b), ctx.session);
  ctx.session.addAssistantMessage(UPDATE_ANSWER, undefined, 'what_to_answer');
  const refinedB = await engine4b.runFollowUp('simplify', 'simplify the diagram and drop the log');
  check('D4b', 'no preservation rule and no forced restore', !/reproduce the mermaid block exactly/i.test(cap4b[0]?.system || '') && !String(refinedB).includes('```mermaid'), String(refinedB).slice(0, 200));

  // ── D5 ────────────────────────────────────────────────────────────────
  out('\nD5  Same session · brainstorm with a design on the table → alternatives + one diagram');
  ctx.session.addAssistantMessage(UPDATE_ANSWER, undefined, 'what_to_answer');
  const cap5 = [];
  const engine5 = new IntelligenceEngine(makeHelper([DESIGN_ANSWER], cap5), ctx.session);
  await engine5.runBrainstorm(undefined, 'Design a notification service with retries');
  check('D5', 'the ALTERNATIVE contract is dispatched once', cap5.length === 1 && contracts(cap5[0]) === 1 && /asks for alternatives to it/.test(cap5[0].system), `calls=${cap5.length} count=${cap5[0] ? contracts(cap5[0]) : 0}`);
  check('D5', 'with the current design in the turn', count(all(cap5[0] || { system: '', context: '', user: '' }), '<active_design view=') === 1, 'no design block');

  // ── D6 ────────────────────────────────────────────────────────────────
  out('\nD6  New task in the same session · "Design a parking lot" → fresh design, not a continuation');
  const cap6 = [];
  const PARKING = 'flowchart LR\n    gate["Entry Gate"] --> allocator["Spot Allocator"]\n    allocator --> floors[("Floor Map")]\n    gate --> tickets["Ticket Printer"]';
  const engine6 = new IntelligenceEngine(makeHelper([`A gate hands out spots from a floor map.\n\n${fence(PARKING)}\n\nThe allocator owns the map.`], cap6), ctx.session);
  r = await ask({ engine: engine6, session: ctx.session, captured: cap6 }, 'Design a parking lot');
  check('D6', 'a CREATE contract with no design block from the previous task', contracts(r.sent) === 1 && !/<active_design view=/.test(all(r.sent)) && /asks for a system design or a diagram/.test(r.sent.system), 'treated as a follow-up');
  design = ctx.session.getActiveDesign();
  check('D6', 'a new lineage, version 1, no parent', design && design.version === 1 && !design.parentArtifactId && design.lineageId !== 'design-1' && design.source === PARKING, JSON.stringify(design));

  // ── D7 ────────────────────────────────────────────────────────────────
  out('\nD7  Turns that must NOT get a diagram');
  for (const [label, question, canned, modeTemplate] of [
    ['coding question', 'Write a function to solve two sum.', CODING_ANSWER, 'technical-interview'],
    ['concept question', 'What is caching?', PROSE, 'technical-interview'],
    ['experience question', 'Have you built distributed systems?', PROSE, 'technical-interview'],
    ['small talk', 'How was your weekend?', PROSE, 'general'],
  ]) {
    setMode(modeTemplate);
    const c = makeEngine([canned]);
    const res = await ask(c, question);
    check('D7', `${label}: no diagram contract, no design block`, res.calls.length >= 1 ? contracts(res.sent) === 0 && !/<active_design view=/.test(all(res.sent)) : true, `count=${contracts(res.sent)}`);
    check('D7', `${label}: nothing became a design`, c.session.getActiveDesign() === null, JSON.stringify(c.session.getActiveDesign()));
  }
  setMode('technical-interview');
  let c7 = makeEngine([CODING_ANSWER]);
  r = await ask(c7, 'Write a function to solve two sum.');
  check('D7', 'the coding contract is still attached to a coding turn', /<coding_contract>/.test(r.sent.system), 'coding contract missing');

  // ── D8 ────────────────────────────────────────────────────────────────
  out('\nD8  Other modes · the diagram capability is semantic, not a Technical Interview feature');
  for (const template of ['general', 'team-meet', 'lecture']) {
    setMode(template);
    const c = makeEngine([DESIGN_ANSWER]);
    const res = await ask(c, 'Design a notification service with retries.');
    check('D8', `${template}: contract dispatched exactly once`, res.calls.length === 1 && contracts(res.sent) === 1, `calls=${res.calls.length} count=${contracts(res.sent)}`);
  }
  setMode('technical-interview', 'Diagram E2E custom');
  let c8 = makeEngine([DESIGN_ANSWER]);
  r = await ask(c8, 'Design a notification service with retries.');
  check('D8', 'custom mode: contract dispatched exactly once', r.calls.length === 1 && contracts(r.sent) === 1, `count=${contracts(r.sent)}`);

  // ── D9 ────────────────────────────────────────────────────────────────
  out('\nD9  Explicit output constraints');
  setMode('technical-interview');
  let c9 = makeEngine([PROSE]);
  r = await ask(c9, 'Design a notification service, no diagram please.');
  check('D9', '"no diagram" → the text-only contract', contracts(r.sent) === 1 && /asked for NO diagram/.test(r.sent.system) && !/fenced code block tagged `mermaid` holding/.test(r.sent.system), 'wrong variant');
  c9 = makeEngine([fence(NOTIFY)]);
  r = await ask(c9, 'Design a notification service, diagram only.');
  check('D9', '"diagram only" → no prose asked for', /asked for the diagram only/.test(r.sent.system), 'wrong variant');
  c9 = makeEngine([fence(NOTIFY, 'mermaid source')]);
  r = await ask(c9, 'Design a notification service, just give me the Mermaid source.');
  check('D9', '"just Mermaid source" → source-only, tagged so it is not drawn', /info string is `mermaid source`/.test(r.sent.system), 'wrong variant');
  c9 = makeEngine([DESIGN_ANSWER]);
  r = await ask(c9, 'Show the authentication sequence for a web app.');
  check('D9', 'an explicit sequence ask → sequenceDiagram contract + the sequence example', /Type: `sequenceDiagram`/.test(r.sent.system) && /Show the login sequence/.test(r.sent.system), 'view not honoured');

  // ── D10 ───────────────────────────────────────────────────────────────
  out('\nD10 Mixed design + code keeps both artifact families');
  let c10 = makeEngine([MIXED_ANSWER]);
  r = await ask(c10, 'Design a payment system and implement the idempotency handler in TypeScript.');
  check('D10', 'both the diagram contract and the coding contract are attached, once each', contracts(r.sent) === 1 && count(r.sent.system, '<coding_contract>') === 1, `diagram=${contracts(r.sent)} coding=${count(r.sent.system, '<coding_contract>')}`);
  check('D10', 'the diagram contract says where the code goes and that Mermaid is not code', /The turn ALSO asks for code/.test(r.sent.system) && /never code to run or test/.test(r.sent.system), 'mixed rule missing');
  check('D10', 'the committed answer still has the Mermaid block', String(r.returned).includes('```mermaid\nflowchart LR'), String(r.returned).slice(0, 300));
  check('D10', 'and the TypeScript block', String(r.returned).includes('export async function handle'), String(r.returned).slice(-300));

  // ── D11 ───────────────────────────────────────────────────────────────
  out('\nD11 Accepting the system-design action card is a design ask');
  const { SYSTEM_DESIGN_ACTION_INSTRUCTION } = require(d('llm/diagramPromptSignals.js'));
  let c11 = makeEngine([DESIGN_ANSWER]);
  r = await ask(c11, 'How would you handle that many messages?', { promptInstruction: SYSTEM_DESIGN_ACTION_INSTRUCTION });
  check('D11', 'contract dispatched once for a line that is not a design ask by itself', contracts(r.sent) === 1, `count=${contracts(r.sent)}`);
  c11 = makeEngine([PROSE]);
  r = await ask(c11, 'How would you handle that many messages?');
  check('D11', 'control: the same line without the action carries none', contracts(r.sent) === 0, `count=${contracts(r.sent)}`);

  // ── D12 ───────────────────────────────────────────────────────────────
  out('\nD12 Speculative (Auto Answer prefetch) runs record nothing until adopted');
  let c12 = makeEngine([DESIGN_ANSWER]);
  c12.session.addTranscript({ speaker: 'system', text: 'Design a notification service with retries.', timestamp: Date.now(), final: true });
  await c12.engine.runWhatShouldISay('Design a notification service with retries.', 0.9, undefined, { skipCooldown: true, speculative: true });
  check('D12', 'no token reached the renderer', c12.events.tokens.length === 0 && c12.events.answers.length === 0, `tokens=${c12.events.tokens.length} answers=${c12.events.answers.length}`);
  check('D12', 'no design was recorded from an unadopted run', c12.session.getActiveDesign() === null, JSON.stringify(c12.session.getActiveDesign()));
  check('D12', 'and the answer is not session history', !c12.session.getLastAssistantMessage(), String(c12.session.getLastAssistantMessage()).slice(0, 80));

  // ── D13 ───────────────────────────────────────────────────────────────
  out('\nD13 Session boundaries');
  let c13 = makeEngine([DESIGN_ANSWER]);
  await ask(c13, 'Design a notification service with retries.');
  check('D13', 'precondition: a design is on the table', c13.session.getActiveDesign() !== null, 'none');
  c13.engine.beginMeetingConversation('conv_test');
  check('D13', 'a new meeting does not inherit it', c13.session.getActiveDesign() === null, JSON.stringify(c13.session.getActiveDesign()));
  await ask(c13, 'Design a notification service with retries.');
  c13.session.clearSessionContext();
  check('D13', 'a mode switch (clearSessionContext) clears it', c13.session.getActiveDesign() === null, 'still set');
  await ask(c13, 'Design a notification service with retries.');
  c13.session.reset();
  check('D13', 'a session reset clears it', c13.session.getActiveDesign() === null, 'still set');
  const cap13 = [];
  const engine13 = new IntelligenceEngine(makeHelper([PROSE], cap13), c13.session);
  r = await ask({ engine: engine13, session: c13.session, captured: cap13 }, 'Add retry handling and a dead-letter queue');
  check('D13', 'after the reset the same follow-up phrase is an ordinary turn', contracts(r.sent) === 0 && !/<active_design view=/.test(all(r.sent)), `count=${contracts(r.sent)}`);

  // ── D14 ───────────────────────────────────────────────────────────────
  out('\nD14 Manual answer fallback (runManualAnswer)');
  setMode('technical-interview');
  let c14 = makeEngine([DESIGN_ANSWER]);
  const manual = await c14.engine.runManualAnswer('Design a notification service with retries.');
  const m = c14.captured[0] || { system: '', context: '', user: '' };
  check('D14', 'contract dispatched exactly once', c14.captured.length === 1 && contracts(m) === 1, `calls=${c14.captured.length} count=${contracts(m)}`);
  check('D14', 'the old seven-section template is not sent beside it', !OLD_TEMPLATE.test(all(m)), (all(m).match(/.{0,60}Clarify Requirements:.{0,60}/) || [''])[0]);
  check('D14', 'the answer keeps its diagram', String(manual).includes(fence(NOTIFY)), String(manual).slice(0, 200));

  // ── D15 ───────────────────────────────────────────────────────────────
  out('\nD15 Feature switch OFF restores ordinary answers');
  process.env.NATIVELY_SYSTEM_DESIGN_DIAGRAMS = '0';
  let c15 = makeEngine([DESIGN_ANSWER]);
  r = await ask(c15, 'Design a notification service with retries.');
  check('D15', 'no diagram contract anywhere', contracts(r.sent) === 0, `count=${contracts(r.sent)}`);
  check('D15', 'no diagram turn note or design block', !/Diagram for this turn/.test(all(r.sent)) && !/<active_design view=/.test(all(r.sent)), 'diagram text present');
  if (V3 !== '1') check('D15', 'the original seven-section template is back', OLD_TEMPLATE.test(all(r.sent)), 'template missing');
  check('D15', 'a Mermaid block the model wrote anyway is still stored verbatim (source stays accessible)', String(r.returned).includes(fence(NOTIFY)), String(r.returned).slice(0, 200));
  const cap15 = [];
  c15.session.addAssistantMessage(UPDATE_ANSWER, undefined, 'what_to_answer');
  const engine15 = new IntelligenceEngine(makeHelper([SHORT_NO_DIAGRAM], cap15), c15.session);
  const refinedOff = await engine15.runFollowUp('shorten');
  check('D15', 'and a refinement is not corrected when the feature is off', !String(refinedOff).includes('```mermaid') && !/reproduce the mermaid block/i.test(cap15[0]?.system || ''), String(refinedOff).slice(0, 120));
  delete process.env.NATIVELY_SYSTEM_DESIGN_DIAGRAMS;

  // ── D16 ───────────────────────────────────────────────────────────────
  out('\nD16 Zero / two reference examples (evaluation knob)');
  process.env.NATIVELY_DIAGRAM_EXAMPLES = '0';
  let c16 = makeEngine([DESIGN_ANSWER]);
  r = await ask(c16, 'Design a URL shortener.');
  const zeroLen = r.sent.system.length;
  check('D16', 'NATIVELY_DIAGRAM_EXAMPLES=0 → contract without examples', contracts(r.sent) === 1 && !/DIAGRAM REFERENCE/.test(r.sent.system), 'examples present');
  process.env.NATIVELY_DIAGRAM_EXAMPLES = '2';
  c16 = makeEngine([DESIGN_ANSWER]);
  r = await ask(c16, 'Design a URL shortener.');
  const twoLen = r.sent.system.length;
  check('D16', 'NATIVELY_DIAGRAM_EXAMPLES=2 → two examples', /Reference 1/.test(r.sent.system) && /Reference 2/.test(r.sent.system), 'not two');
  delete process.env.NATIVELY_DIAGRAM_EXAMPLES;
  c16 = makeEngine([DESIGN_ANSWER]);
  r = await ask(c16, 'Design a URL shortener.');
  const oneLen = r.sent.system.length;
  check('D16', 'example cost is bounded (two examples under ~1,000 tokens)', (twoLen - zeroLen) / 4 < 1000 && oneLen > zeroLen && twoLen > oneLen, `zero=${zeroLen} one=${oneLen} two=${twoLen}`);
  out(`        system prompt chars: 0 examples=${zeroLen}, 1=${oneLen} (+~${Math.round((oneLen - zeroLen) / 4)} tokens), 2=${twoLen} (+~${Math.round((twoLen - zeroLen) / 4)} tokens)`);

  const failed = results.filter((x) => !x.ok);
  out(`\n##### diagrams · V3=${V3}: ${results.length - failed.length}/${results.length} passed${failed.length ? `  FAILED: ${failed.map((f) => `${f.scenario}:${f.name}`).join(' | ')}` : ''}`);
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* temp dir */ }
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  out('e2e-diagram crashed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
