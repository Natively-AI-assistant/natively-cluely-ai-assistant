// tests/realtime-prompt/e2e-visual-catalog.cjs — run: npm run test:diagram:wiring
//
// REAL-WIRING E2E for the nine-mode visual catalog (no network, no keys).
//
// Real: DatabaseManager (isolated dir), ModesManager with its built-in modes
// (so the mode identity comes from the real template machinery), the
// IntelligenceEngine, WhatToAnswerLLM, AnswerLLM, FollowUpLLM, the V3 bridge
// and composer, AnswerPlanner, AnswerValidator, SessionTracker.
// Stubbed: ONLY the provider call. It records the exact (user, system) that
// would leave the process and streams back a canned answer.
//
// What it proves, for the prompt that is actually dispatched:
//   - in each of the nine built-in modes, a representative request carries
//     exactly ONE visual contract, of the right kind, with that mode's note —
//     and a request that should be answered in words carries none;
//   - a custom mode named "Sales" does not behave as Sales;
//   - a chart, an ER diagram or a table is never routed, streamed or validated
//     as code, and never given the system-design template;
//   - one provider call per answer;
//   - the committed answer keeps its chart / notation block byte for byte, and
//     the block becomes the artifact on the table;
//   - "make it 3%" updates that artifact (v2), "why …" explains it without a
//     block, and "shorten" cannot change its numbers;
//   - an accepted visual action card is the request for its turn;
//   - a speculative run records nothing; the feature switch turns it all off.
//
// `--v3=0` runs the same scenarios on the legacy / Prompt System v2 fallback.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const root = path.resolve(__dirname, '..', '..');
const V3 = (process.argv.find((a) => a.startsWith('--v3=')) || '--v3=1').slice(5);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-e2e-visual-'));
process.env.NATIVELY_TEST_USERDATA = userData;
process.env.NATIVELY_CONTEXT_INTELLIGENCE_V3 = V3;
delete process.env.NATIVELY_SYSTEM_DESIGN_DIAGRAMS;
delete process.env.NATIVELY_DIAGRAM_EXAMPLES;
const d = (p) => path.join(root, 'dist-electron/electron', p);

const realLog = console.log.bind(console);
const quiet = () => {};
console.log = quiet; console.warn = quiet; console.info = quiet; console.debug = quiet;
const out = (...a) => realLog(...a);

const fence = (tag, body) => '```' + tag + '\n' + body + '\n```';
const chart = (ratePercent) => JSON.stringify({ v: 1, type: 'line', title: `Monthly revenue at ${ratePercent}% net growth`, x: { label: 'Month' }, y: { label: 'Revenue', unit: 'USD' }, compute: { kind: 'compound_growth', baseline: 10000, ratePercent, period: 'month', periods: 3 }, assumptions: [`Net growth stays at ${ratePercent}% every month`] });
const FORECAST_ANSWER = `At 5% net growth a month from $10,000 this is a scenario, not a prediction.\n\n${fence('natively-chart', chart(5))}\n\nThe chart shows each month under that one assumption.`;
const FORECAST_3 = `Dropping the rate to 3%.\n\n${fence('natively-chart', chart(3))}\n\nGrowth compounds more slowly.`;
const EXPLAIN = 'Each month is 5% above the one before, so the last month is the highest.';
const SHORT_CHANGED = `A scenario at 5%.\n\n${fence('natively-chart', chart(6))}\n\nOne assumption.`;
const ER_SOURCE = 'erDiagram\n    USER ||..o{ ORDER : places\n    ORDER ||..|| PAYMENT : "paid by"\n    USER {\n        int user_id PK\n        string email\n    }\n    ORDER {\n        int order_id PK\n        int user_id FK\n    }\n    PAYMENT {\n        int payment_id PK\n        int order_id FK\n    }';
const ER_ANSWER = `Three entities, with orders hanging off users and one payment per order.\n\n${fence('mermaid', ER_SOURCE)}\n\nEach order belongs to exactly one user; a user has zero or many orders.`;
const TREE_SOURCE = 'flowchart TD\n    start(["Connection drops"]) --> lights{"Internet light on?"}\n    lights -->|"no"| cable["Reseat the cable"]\n    lights -->|"yes"| reboot["Restart the router"]\n    cable --> done(["Resolved or escalate"])\n    reboot --> done';
const TREE_ANSWER = `Start with the light, then work down.\n\n${fence('mermaid', TREE_SOURCE)}\n\nThe light decides which branch you are on.`;
const TABLE_ANSWER = 'Here is where the evidence stands.\n\n| Requirement | Evidence | Status | Source |\n| --- | --- | --- | --- |\n| Kubernetes | Ran a cluster for two years | supported | CV |\n| On-call | Not discussed | unknown | — |\n\nOn-call still needs a question.';
const TIMELINE_ANSWER = `Three roles so far.\n\n${fence('mermaid', 'timeline\n    title Career so far\n    2018 : Junior engineer at Acme\n    2023 : Staff engineer at Globex')}\n\nEach move added scope.`;
const DEP_ANSWER = `The API is what everything waits on.\n\n${fence('mermaid', 'flowchart LR\n    schema["Schema migration"] -->|"blocks"| api["Orders API"]\n    api -->|"blocks"| mobile["Mobile checkout"]')}\n\nAn arrow means the tail must finish first.`;
const MINDMAP_ANSWER = `Three groups.\n\n${fence('mermaid', 'mindmap\n  Indexing\n    Structures\n      B-tree\n    Costs\n      Slower writes')}\n\nStructures and costs trade off.`;
const PROSE = 'Happy to help with that. The short answer is that it depends on the plan you are on.';
const CODING_ANSWER = '## Approach\nUse a hash map.\n\n## Technique\nHashing\n\n## Code\n```python\ndef two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i\n```\n\n## Complexity\nO(n) time, O(n) space.';

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
  const mode = custom ? mm.createMode({ name: custom, templateType: template }) : mm.getModes().find((m) => m.templateType === template && m.isBuiltin !== false && (template !== 'general' || m.name === 'General'));
  if (!mode) throw new Error(`no mode for template ${template}`);
  mm.updateMode(mode.id, { customContext: '' });
  mm.setActiveMode(mode.id);
  return mode;
}

function makeEngine(answers, session) {
  const { IntelligenceEngine } = require(d('IntelligenceEngine.js'));
  const { SessionTracker } = require(d('SessionTracker.js'));
  const captured = [];
  const s = session || new SessionTracker();
  const engine = new IntelligenceEngine(makeHelper([...answers], captured), s);
  const events = { tokens: [], answers: [], refined: [] };
  engine.on('suggested_answer_token', (t) => events.tokens.push(String(t)));
  engine.on('suggested_answer', (a) => events.answers.push(String(a)));
  engine.on('refined_answer', (a) => events.refined.push(String(a)));
  return { engine, session: s, captured, events };
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
  out(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        -> ${String(detail ?? '').slice(0, 700)}`}`);
};
const all = (c) => `${c.system}\n${c.context}\n${c.user}`;
const count = (text, needle) => text.split(needle).length - 1;
const contracts = (c) => count(all(c), '<diagram_contract>');
const contractOf = (c) => {
  const text = all(c);
  const a = text.indexOf('<diagram_contract>');
  const b = text.indexOf('</diagram_contract>');
  return a === -1 ? '' : text.slice(a, b === -1 ? undefined : b);
};
const OLD_TEMPLATE = /Clarify Requirements:|High-Level Design:|Core Components:/;
const notCoding = (c) => !/<coding_contract>/.test(c.system) && !/verification_spec/.test(all(c));

(async () => {
  out(`\n##### visual catalog · V3=${V3}  userData=${userData}`);

  // ── V1 ────────────────────────────────────────────────────────────────
  out('\nV1  Sales · heard "What would revenue look like at 5% monthly growth?" (not an explicit chart request)');
  setMode('sales');
  let ctx = makeEngine([FORECAST_ANSWER]);
  ctx.session.addTranscript({ speaker: 'system', text: 'We are at ten thousand dollars a month right now.', timestamp: Date.now() - 4000, final: true });
  let r = await ask(ctx, 'What would revenue look like at 5% monthly growth over the next three months?');
  check('V1', 'exactly ONE provider call (the chart is not a second generation)', r.calls.length === 1, `calls=${r.calls.length}`);
  check('V1', 'the visual contract is dispatched exactly once', contracts(r.sent) === 1, `count=${contracts(r.sent)}`);
  check('V1', 'it is the CHART contract, with the forecast rule', /Rules for the chart:/.test(contractOf(r.sent)) && /This turn is a projection/.test(contractOf(r.sent)), contractOf(r.sent).slice(0, 300));
  check('V1', 'inputs, never results; no chart without its numbers', /you give inputs, never computed results/.test(r.sent.system) && /do NOT output a chart/.test(r.sent.system), 'rule missing');
  check('V1', 'labelled a scenario, never a promise', /This is a SCENARIO/.test(r.sent.system) && /never a promise of results/.test(r.sent.system), 'honesty rule missing');
  check('V1', 'the Sales note rides with it', /Never invent a price, an uplift or a commitment/.test(contractOf(r.sent)), 'mode note missing');
  check('V1', 'one reference example, the forecast one, framed as made up', count(contractOf(r.sent), 'Reference 1') === 1 && !/Reference 2/.test(contractOf(r.sent)) && /Any number, name or date inside a reference is made up/.test(contractOf(r.sent)), 'example block wrong');
  check('V1', 'NOT the system-design contract or its template', !/This turn asks for a system design or a diagram/.test(r.sent.system) && !OLD_TEMPLATE.test(all(r.sent)) && !/Follow the diagram contract in the system prompt: the approach and its assumptions first/.test(all(r.sent)), 'system-design shape attached');
  check('V1', 'no coding contract and no verification spec', notCoding(r.sent), 'coding machinery attached');
  check('V1', 'the committed answer keeps the chart block byte for byte', String(r.returned).includes(fence('natively-chart', chart(5))), String(r.returned).slice(0, 300));
  check('V1', 'and the prose around it', String(r.returned).startsWith('At 5% net growth') && String(r.returned).includes('under that one assumption'), String(r.returned).slice(-200));
  const streamed = ctx.events.tokens.join('');
  check('V1', 'the block streams live, before the explanation finishes', streamed.indexOf('```natively-chart') > 0 && streamed.indexOf('```natively-chart') < streamed.indexOf('The chart shows'), 'order in stream');
  let design = ctx.session.getActiveDesign();
  check('V1', 'the chart became the artifact on the table (v1)', design && design.artifact === 'chart' && design.view === 'chart' && design.version === 1 && design.source === chart(5), JSON.stringify(design));

  // ── V2 ────────────────────────────────────────────────────────────────
  out('\nV2  Same session · "Make it 3%" → update THAT chart');
  let c2 = makeEngine([FORECAST_3], ctx.session);
  r = await ask(c2, 'Make it 3%');
  check('V2', 'one provider call', r.calls.length === 1, `calls=${r.calls.length}`);
  check('V2', 'the UPDATE contract for a chart, once', contracts(r.sent) === 1 && /This turn changes the chart already on the table/.test(r.sent.system), contractOf(r.sent).slice(0, 200));
  check('V2', 'change the one input, nothing else', /change the one input that was asked about, nothing else/.test(r.sent.system), 'rule missing');
  check('V2', 'no reference example on an update', !/DIAGRAM REFERENCE/.test(r.sent.system), 'example attached');
  const sent2 = all(r.sent);
  check('V2', 'the chart on the table is in the turn exactly once, under its own tag', count(sent2, '<active_design view="chart"') === 1 && sent2.includes('```natively-chart\n' + chart(5)), sent2.slice(sent2.indexOf('<active_design'), sent2.indexOf('<active_design') + 300));
  check('V2', 'its JSON is not XML-escaped', !/&quot;ratePercent/.test(sent2), 'escaped');
  check('V2', 'not routed as a system design, and not as code', !OLD_TEMPLATE.test(sent2) && !/Follow the diagram contract in the system prompt: the approach/.test(sent2) && notCoding(r.sent), 'wrong route');
  design = ctx.session.getActiveDesign();
  check('V2', 'version 2 of the SAME chart, pointing at v1', design && design.version === 2 && design.parentArtifactId === 'design-1.v1' && design.source === chart(3), JSON.stringify(design));

  // ── V3 ────────────────────────────────────────────────────────────────
  out('\nV3  Same session · "Why is the last month higher?" → explain, no new chart');
  let c3 = makeEngine([EXPLAIN], ctx.session);
  r = await ask(c3, 'Why is the last month higher?');
  check('V3', 'the EXPLAIN contract: prose, no block', contracts(r.sent) === 1 && /Do NOT output a `natively-chart` block/.test(r.sent.system), contractOf(r.sent).slice(0, 240));
  check('V3', 'the chart is supplied as context', count(all(r.sent), '<active_design view="chart"') === 1, 'no chart block');
  design = ctx.session.getActiveDesign();
  check('V3', 'an answer without a chart leaves it untouched (still v2)', design && design.version === 2 && design.source === chart(3), JSON.stringify(design));

  // ── V4 ────────────────────────────────────────────────────────────────
  out('\nV4  Same session · refine "shorten" where the model CHANGES the rate');
  ctx.session.addAssistantMessage(FORECAST_ANSWER, undefined, 'what_to_answer');
  let c4 = makeEngine([SHORT_CHANGED], ctx.session);
  const refined = await c4.engine.runFollowUp('shorten');
  check('V4', 'the model is told to leave the chart alone', /reproduce every such block exactly as it is/i.test(c4.captured[0]?.system || ''), (c4.captured[0]?.system || '').slice(-320));
  check('V4', 'the changed chart is put back as it was (5%, not 6%)', String(refined).includes(fence('natively-chart', chart(5))) && !String(refined).includes('"ratePercent":6'), String(refined).slice(0, 300));
  check('V4', 'the shortened prose is what the model wrote', String(refined).startsWith('A scenario at 5%.') && String(refined).includes('One assumption.'), String(refined).slice(0, 120));
  let c4b = makeEngine([SHORT_CHANGED], ctx.session);
  ctx.session.addAssistantMessage(FORECAST_ANSWER, undefined, 'what_to_answer');
  const refinedB = await c4b.engine.runFollowUp('custom', 'change the growth rate to 6%');
  check('V4', 'a refinement ABOUT the numbers is left to the model', String(refinedB).includes('"ratePercent":6') && !/reproduce every such block exactly/i.test(c4b.captured[0]?.system || ''), String(refinedB).slice(0, 200));

  // ── V5 ────────────────────────────────────────────────────────────────
  out('\nV5  Sales · a request that should be answered in words');
  let c5 = makeEngine([PROSE]);
  r = await ask(c5, 'How do I handle the pricing objection in one sentence?');
  check('V5', 'no visual contract and nothing on the table', contracts(r.sent) === 0 && c5.session.getActiveDesign() === null, `count=${contracts(r.sent)}`);
  c5 = makeEngine([PROSE]);
  r = await ask(c5, 'No charts please, what would revenue look like at 5% monthly growth?');
  check('V5', '"no charts" wins over the mode', contracts(r.sent) === 0, `count=${contracts(r.sent)}`);

  // ── V6 ────────────────────────────────────────────────────────────────
  out('\nV6  Mode identity is the template, never the name');
  // A user mode called "Sales" on the General template: General's behaviour, and no Sales note.
  setMode('general', 'Sales');
  let c6 = makeEngine([TREE_ANSWER]);
  r = await ask(c6, 'Help navigate this objection.');
  check('V6', 'a custom mode named "Sales" never carries the Sales note', !/Never invent a price, an uplift or a commitment/.test(all(r.sent)), 'Sales note leaked into a custom mode');
  check('V6', 'it behaves as the General template it is built on (the decision tree is still drawn)', contracts(r.sent) === 1 && /Rules for the decision tree:/.test(contractOf(r.sent)) && !/\nMode: /.test(contractOf(r.sent)), `count=${contracts(r.sent)}`);
  setMode('sales');
  c6 = makeEngine([TREE_ANSWER]);
  r = await ask(c6, 'Help navigate this objection.');
  check('V6', 'control: the built-in Sales mode does carry it', contracts(r.sent) === 1 && /Never invent a price, an uplift or a commitment/.test(contractOf(r.sent)), `count=${contracts(r.sent)}`);
  // The reverse: a user mode called "Lecture" is not the (listening) Lecture mode.
  setMode('general', 'Lecture');
  c6 = makeEngine([FORECAST_ANSWER]);
  r = await ask(c6, 'Where are deals dropping out?');
  const customLecture = contracts(r.sent);
  setMode('lecture');
  c6 = makeEngine([PROSE]);
  r = await ask(c6, 'Where are deals dropping out?');
  check('V6', 'a custom mode named "Lecture" draws what General draws; the built-in Lecture mode stays quiet', customLecture === 1 && contracts(r.sent) === 0, `custom=${customLecture} builtin=${contracts(r.sent)}`);

  // ── V7 ────────────────────────────────────────────────────────────────
  out('\nV7  Technical Interview · "Model users, orders, and payments." → an ER diagram, not code, not a system design');
  setMode('technical-interview');
  let c7 = makeEngine([ER_ANSWER]);
  r = await ask(c7, 'Model users, orders, and payments.');
  check('V7', 'one call, one contract', r.calls.length === 1 && contracts(r.sent) === 1, `calls=${r.calls.length} count=${contracts(r.sent)}`);
  check('V7', 'the ER contract: both reading directions, dashed for an independent key', /each marker describes the entity NEXT TO IT/.test(r.sent.system) && /`\.\.` \(dashed\) when the child has its own key/.test(r.sent.system), contractOf(r.sent).slice(0, 300));
  check('V7', 'no minimum size, and no system-design size target', /There is no minimum size/.test(r.sent.system) && !/5 to 10 meaningful components/.test(contractOf(r.sent)), 'size rule wrong');
  check('V7', 'NOT the coding contract (it was not streamed or validated as code)', notCoding(r.sent), 'coding machinery attached');
  check('V7', 'NOT the system-design contract or template', !/This turn asks for a system design or a diagram/.test(r.sent.system) && !OLD_TEMPLATE.test(all(r.sent)), 'system-design shape attached');
  check('V7', 'the committed answer keeps the erDiagram block byte for byte', String(r.returned).includes(fence('mermaid', ER_SOURCE)), String(r.returned).slice(0, 200));
  design = c7.session.getActiveDesign();
  check('V7', 'the data model is on the table as an ER view', design && design.artifact === 'mermaid' && design.view === 'er' && design.type === 'er', JSON.stringify(design));
  let c7b = makeEngine([CODING_ANSWER]);
  r = await ask(c7b, 'Write a function to solve two sum.');
  check('V7', 'control: a coding question keeps the coding contract and gets no visual', /<coding_contract>/.test(r.sent.system) && contracts(r.sent) === 0, `diagram=${contracts(r.sent)}`);
  c7b = makeEngine([PROSE]);
  r = await ask(c7b, 'What is a DFA?');
  check('V7', 'control: a concept question about a notation gets no visual', contracts(r.sent) === 0, `count=${contracts(r.sent)}`);

  // ── V8 ────────────────────────────────────────────────────────────────
  out('\nV8  The other modes · one positive and one negative each');
  const perMode = [
    ['call-center', 'Walk me through diagnosing this issue.', TREE_ANSWER, /Rules for the decision tree:/, /Drawing a status does not change the ticket/, 'What is your return policy for opened items?'],
    ['recruiting', "Map this candidate's experience to the role.", TABLE_ANSWER, /Write an ordinary Markdown table, not a fenced block/, /never from the user's own résumé or profile/, 'What should I ask about their leadership experience?'],
    ['looking-for-work', 'Summarize my career progression.', TIMELINE_ANSWER, /Rules for the timeline:/, /Never invent a title, a date, an employer or an achievement number/, 'Tell me about a time you disagreed with a teammate.'],
    ['team-meet', 'Show which work blocks which.', DEP_ANSWER, /Rules for the dependency map:/, /Keep decided, proposed, rejected and open items distinct/, 'Can you give us a status update on the migration?'],
    ['general', 'Organize the ideas we discussed.', MINDMAP_ANSWER, /Rules for the mind map:/, null, 'What time works for everyone next week?'],
    ['lecture', 'Draw a mind map of these concepts.', MINDMAP_ANSWER, /Rules for the mind map:/, /Anything added that was not in the lecture is labelled as an illustration/, 'There are three stages in this process.'],
    ['seminar', 'Draw the method described in this paper.', TREE_ANSWER, /Type: `flowchart TD`/, /A detail the source does not give stays missing/, 'What is the main contribution of this paper?'],
  ];
  for (const [template, question, canned, rule, note, negative] of perMode) {
    setMode(template);
    const c = makeEngine([canned]);
    const res = await ask(c, question);
    check('V8', `${template}: "${question}" → one contract of the right kind`, res.calls.length === 1 && contracts(res.sent) === 1 && rule.test(contractOf(res.sent)), `calls=${res.calls.length} count=${contracts(res.sent)} :: ${contractOf(res.sent).slice(0, 160)}`);
    if (note) check('V8', `${template}: the mode's note rides with it`, note.test(contractOf(res.sent)), 'mode note missing');
    else check('V8', `${template}: no mode note for this mode`, !/\nMode: /.test(contractOf(res.sent)), 'unexpected mode note');
    check('V8', `${template}: not coding, not a system-design template`, notCoding(res.sent) && !OLD_TEMPLATE.test(all(res.sent)), 'wrong machinery');
    const n = makeEngine([PROSE]);
    const neg = await ask(n, negative);
    check('V8', `${template}: "${negative}" → no visual`, neg.calls.length >= 1 ? contracts(neg.sent) === 0 : true, `count=${contracts(neg.sent)}`);
  }
  setMode('recruiting');
  const cTable = makeEngine([TABLE_ANSWER]);
  r = await ask(cTable, "Map this candidate's experience to the role.");
  check('V8', 'recruiting: the committed answer keeps its Markdown table', String(r.returned).includes('| Requirement | Evidence | Status | Source |') && String(r.returned).includes('| On-call | Not discussed | unknown | — |'), String(r.returned).slice(0, 300));
  check('V8', 'recruiting: a table is not an artifact "on the table" (nothing to redraw)', cTable.session.getActiveDesign() === null, JSON.stringify(cTable.session.getActiveDesign()));

  // ── V9 ────────────────────────────────────────────────────────────────
  out('\nV9  An accepted visual action card is the request for its turn');
  setMode('team-meet');
  const { VISUAL_ACTIONS } = require(d('llm/systemDesignAction.js'));
  let c9 = makeEngine([DEP_ANSWER]);
  r = await ask(c9, 'yeah and that is still waiting on the API team', { promptInstruction: VISUAL_ACTIONS.dependencies.instruction });
  check('V9', 'the heard line asked for nothing; the card draws the dependency map', contracts(r.sent) === 1 && /Rules for the dependency map:/.test(contractOf(r.sent)), `count=${contracts(r.sent)}`);
  check('V9', 'as a reconstruction of what was said', /This RECONSTRUCTS what was said in the conversation/.test(contractOf(r.sent)), 'basis wrong');
  c9 = makeEngine([PROSE]);
  r = await ask(c9, 'yeah and that is still waiting on the API team');
  check('V9', 'control: the same line without the card carries none', contracts(r.sent) === 0, `count=${contracts(r.sent)}`);

  // ── V10 ───────────────────────────────────────────────────────────────
  out('\nV10 Speculative (Auto Answer prefetch) runs record nothing until adopted');
  setMode('sales');
  let c10 = makeEngine([FORECAST_ANSWER]);
  const q10 = 'What would revenue look like at 5% monthly growth from $10,000 over three months?';
  c10.session.addTranscript({ speaker: 'system', text: q10, timestamp: Date.now(), final: true });
  await c10.engine.runWhatShouldISay(q10, 0.9, undefined, { skipCooldown: true, speculative: true });
  check('V10', 'no token reached the renderer', c10.events.tokens.length === 0 && c10.events.answers.length === 0, `tokens=${c10.events.tokens.length}`);
  check('V10', 'no chart was recorded from an unadopted run', c10.session.getActiveDesign() === null, JSON.stringify(c10.session.getActiveDesign()));
  check('V10', 'the prefetch itself carried the same single contract (so an adopted answer has it)', c10.captured.length === 1 && contracts(c10.captured[0]) === 1, `calls=${c10.captured.length}`);

  // ── V11 ───────────────────────────────────────────────────────────────
  out('\nV11 Session boundaries');
  let c11 = makeEngine([FORECAST_ANSWER]);
  await ask(c11, q10);
  check('V11', 'precondition: a chart is on the table', c11.session.getActiveDesign()?.artifact === 'chart', JSON.stringify(c11.session.getActiveDesign()));
  c11.session.clearSessionContext();
  check('V11', 'a mode switch clears it', c11.session.getActiveDesign() === null, 'still there');
  const after = makeEngine([PROSE], c11.session);
  r = await ask(after, 'Make it 3%');
  check('V11', 'after the reset the same follow-up phrase is an ordinary turn', contracts(r.sent) === 0 && !/<active_design view=/.test(all(r.sent)), `count=${contracts(r.sent)}`);

  // ── V12 ───────────────────────────────────────────────────────────────
  out('\nV12 Manual answer fallback (runManualAnswer)');
  setMode('sales');
  let c12 = makeEngine([FORECAST_ANSWER]);
  const manual = await c12.engine.runManualAnswer(q10);
  const m = c12.captured[0] || { system: '', context: '', user: '' };
  check('V12', 'contract dispatched exactly once, as a chart', c12.captured.length === 1 && contracts(m) === 1 && /Rules for the chart:/.test(contractOf(m)), `calls=${c12.captured.length} count=${contracts(m)}`);
  check('V12', 'the answer keeps its chart', String(manual).includes(fence('natively-chart', chart(5))), String(manual).slice(0, 200));

  // ── V13 ───────────────────────────────────────────────────────────────
  out('\nV13 Feature switch OFF restores ordinary answers');
  process.env.NATIVELY_SYSTEM_DESIGN_DIAGRAMS = '0';
  let c13 = makeEngine([FORECAST_ANSWER]);
  r = await ask(c13, q10);
  check('V13', 'no visual contract anywhere', contracts(r.sent) === 0 && !/natively-chart/.test(all(r.sent)), `count=${contracts(r.sent)}`);
  check('V13', 'a chart block the model wrote anyway is stored verbatim', String(r.returned).includes(fence('natively-chart', chart(5))), String(r.returned).slice(0, 200));
  setMode('technical-interview');
  c13 = makeEngine([ER_ANSWER]);
  r = await ask(c13, 'Model users, orders, and payments.');
  check('V13', 'and the planner route is exactly what it was before the catalog', contracts(r.sent) === 0, `count=${contracts(r.sent)}`);
  delete process.env.NATIVELY_SYSTEM_DESIGN_DIAGRAMS;

  // ── V14 ───────────────────────────────────────────────────────────────
  out('\nV14 Sales · a forecast whose starting value nobody stated');
  setMode('sales');
  const ASKS = 'I can model that, but I need a starting point. What is your monthly revenue today?';
  let c14 = makeEngine([ASKS]);
  r = await ask(c14, 'What would revenue look like at 5% monthly growth?');
  check('V14', 'one provider call, one contract', r.calls.length === 1 && contracts(r.sent) === 1, `calls=${r.calls.length} contracts=${contracts(r.sent)}`);
  check('V14', 'the model is told, last in the contract, that no starting value was stated anywhere', /CHECKED BEFORE THIS TURN: the request does not state a starting value, and none was found in the conversation so far\./.test(contractOf(r.sent)) && /Never supply one of your own, not even as an illustration, a sample or a placeholder\.\s*<\/diagram_contract>/.test(r.sent.system), contractOf(r.sent).slice(-420));
  check('V14', 'and again in the turn itself', /Nobody has stated a starting value: unless the material above states it, ask for it and output no chart\./.test(all(r.sent)), 'turn note missing');
  check('V14', 'no reference example whose numbers could be borrowed', !/DIAGRAM REFERENCE/.test(r.sent.system) && !/"baseline":48200/.test(r.sent.system), 'example attached');
  check('V14', 'an answer that asks for it leaves nothing on the table', c14.session.getActiveDesign() === null && String(r.returned).startsWith('I can model that'), JSON.stringify(c14.session.getActiveDesign()));
  // Said earlier in the meeting, in words: the ordinary forecast contract.
  let c14b = makeEngine([FORECAST_ANSWER]);
  c14b.session.addTranscript({ speaker: 'system', text: 'We are at ten thousand dollars a month right now.', timestamp: Date.now() - 4000, final: true });
  r = await ask(c14b, 'What would revenue look like at 5% monthly growth?');
  check('V14', 'a starting value said earlier in the meeting lifts it: the ordinary contract, with its reference', !/CHECKED BEFORE THIS TURN/.test(r.sent.system) && /DIAGRAM REFERENCE/.test(r.sent.system) && !/Nobody has stated/.test(all(r.sent)), 'gate still applied');
  // A different engine and session: the reader follows the session that is asking.
  let c14c = makeEngine([ASKS]);
  r = await ask(c14c, 'What would revenue look like at 5% monthly growth?');
  check('V14', 'another session does not inherit what was said in the first', /CHECKED BEFORE THIS TURN/.test(r.sent.system), 'conversation leaked across sessions');

  // ── V15 ───────────────────────────────────────────────────────────────
  out('\nV15 Sales · the chart on the table, as a table');
  setMode('sales');
  const TABLE_OF_CHART = 'Here are the numbers behind the chart.\n\n| Period | Projection |\n| --- | --- |\n| Now | 10,000 |\n| Month 1 | 10,500 |\n| Month 2 | 11,025 |\n| Month 3 | 11,576.25 |\n\nIt is a scenario at 5%, not a result.';
  let c15 = makeEngine([FORECAST_ANSWER]);
  c15.session.addTranscript({ speaker: 'system', text: 'We are at ten thousand dollars a month right now.', timestamp: Date.now() - 4000, final: true });
  await ask(c15, 'What would revenue look like at 5% monthly growth over the next three months?');
  const c15b = makeEngine([TABLE_OF_CHART], c15.session);
  r = await ask(c15b, 'Show the chart as a table.');
  const sent15 = all(r.sent);
  check('V15', 'one provider call, one contract', r.calls.length === 1 && contracts(r.sent) === 1, `calls=${r.calls.length} contracts=${contracts(r.sent)}`);
  check('V15', 'the contract says COPY the computed values, and not the comparison-table rules', /copy them exactly\. The same column names, the same row labels, the same numbers/.test(contractOf(r.sent)) && !/At most eight rows/.test(contractOf(r.sent)), contractOf(r.sent).slice(0, 400));
  check('V15', 'the values the app computed are in the turn, with the chart, once', count(sent15, '<active_design view="chart"') === 1 && count(sent15, 'Values (what the app computed') === 1 && sent15.includes('| Month 3 | 11,576.25 |'), sent15.slice(sent15.indexOf('<active_design'), sent15.indexOf('<active_design') + 500));
  check('V15', 'the committed answer keeps the table', String(r.returned).includes('| Month 3 | 11,576.25 |'), String(r.returned).slice(0, 200));
  design = c15b.session.getActiveDesign();
  check('V15', 'the chart is still the artifact on the table, unchanged (a table of it is not a new version)', design && design.artifact === 'chart' && design.version === 1 && design.source === chart(5), JSON.stringify(design));
  // A question about it quotes the same values; an edit of it is not handed them.
  const c15c = makeEngine([EXPLAIN], c15.session);
  r = await ask(c15c, 'Where do we end up after three months?');
  check('V15', 'a question about the chart is handed the computed values and told not to recalculate', /Do not recalculate them/.test(contractOf(r.sent)) && all(r.sent).includes('| Month 3 | 11,576.25 |'), contractOf(r.sent).slice(0, 300));
  const c15d = makeEngine([FORECAST_3], c15.session);
  r = await ask(c15d, 'Make it 3%');
  check('V15', 'an edit of the chart is NOT handed the values that are about to change', count(all(r.sent), '<active_design view="chart"') === 1 && !/Values \(what the app computed/.test(all(r.sent)), 'old values quoted on an update');

  // ── V16 ───────────────────────────────────────────────────────────────
  out('\nV16 Team meet · swimlanes and a tree');
  setMode('team-meet');
  const LANES_SOURCE = 'flowchart LR\n    subgraph sales["Sales"]\n        close["Close deal"] --> brief["Write handoff brief"]\n    end\n    subgraph success["Customer Success"]\n        kickoff["Kickoff call"]\n    end\n    brief -->|"account notes"| kickoff';
  const LANES_ANSWER = `Sales closes and hands over; success takes it from the kickoff.\n\n${fence('mermaid', LANES_SOURCE)}\n\nThe one handoff is the brief.`;
  let c16 = makeEngine([LANES_ANSWER]);
  r = await ask(c16, 'Show the swimlanes for the handoff from sales to success.');
  check('V16', 'one call, one contract', r.calls.length === 1 && contracts(r.sent) === 1, `calls=${r.calls.length} contracts=${contracts(r.sent)}`);
  check('V16', 'the swimlane instruction: one subgraph per lane', /drawn as SWIMLANES\. One `subgraph` per lane/.test(contractOf(r.sent)) && /An arrow that crosses lanes is a handoff/.test(contractOf(r.sent)), contractOf(r.sent).slice(0, 500));
  check('V16', 'not the plain process rule, the system-design contract, or code', !/Type: `flowchart TD`\. One box per step/.test(contractOf(r.sent)) && !OLD_TEMPLATE.test(all(r.sent)) && notCoding(r.sent), 'wrong shape attached');
  check('V16', 'the committed answer keeps the block byte for byte', String(r.returned).includes(fence('mermaid', LANES_SOURCE)), String(r.returned).slice(0, 200));
  design = c16.session.getActiveDesign();
  check('V16', 'the swimlane diagram is on the table', design && design.artifact === 'mermaid' && design.source === LANES_SOURCE, JSON.stringify(design));
  const ORG_ANSWER = `The CEO has two reports.\n\n${fence('mermaid', 'flowchart TD\n    ceo["CEO"] --> cto["CTO"]\n    ceo --> cfo["CFO"]')}\n\nEach has a team under them.`;
  let c16b = makeEngine([ORG_ANSWER]);
  r = await ask(c16b, 'Show the org structure as a tree: CEO, then CTO and CFO, then their teams.');
  check('V16', 'a tree: one root, one parent each', contracts(r.sent) === 1 && /drawn as a TREE\. One root at the top; every other node has exactly one parent/.test(contractOf(r.sent)), contractOf(r.sent).slice(0, 400));
  let c16c = makeEngine([PROSE]);
  r = await ask(c16c, 'We put each team in its own swim lane at the pool.');
  check('V16', 'control: the pool idiom gets no contract', contracts(r.sent) === 0, `count=${contracts(r.sent)}`);

  // ── V17 ───────────────────────────────────────────────────────────────
  out('\nV17 Technical interview · the same requests in Spanish, Russian, Chinese and Japanese');
  setMode('technical-interview');
  const SHORTENER = 'flowchart LR\n    client["Cliente"] --> api["Servicio de enlaces"]\n    api --> db[("Tabla de enlaces")]';
  const SHORTENER_ANSWER = `Un servicio que escribe códigos cortos y redirige.\n\n${fence('mermaid', SHORTENER)}\n\nLas lecturas dominan, así que conviene una caché.`;
  const SHORTENER_2 = 'flowchart LR\n    client["Cliente"] --> api["Servicio de enlaces"]\n    api --> cache["Caché"]\n    api --> db[("Tabla de enlaces")]';
  const SHORTENER_ANSWER_2 = `La caché queda delante de la tabla.\n\n${fence('mermaid', SHORTENER_2)}\n\nLas lecturas van primero a la caché.`;
  let englishContract = '';
  {
    const cEn = makeEngine([SHORTENER_ANSWER]);
    const rEn = await ask(cEn, 'Design a URL shortener');
    englishContract = contractOf(rEn.sent);
  }
  for (const [lang, q] of [['Spanish', 'Diseña un acortador de URLs'], ['Russian', 'Спроектируй сервис сокращения ссылок'], ['Chinese', '设计一个短链接系统'], ['Japanese', 'URL短縮サービスを設計して']]) {
    const c = makeEngine([SHORTENER_ANSWER]);
    r = await ask(c, q);
    check('V17', `${lang}: one call, the design contract once, the same one an English ask gets`, r.calls.length === 1 && contracts(r.sent) === 1 && contractOf(r.sent) === englishContract && englishContract.length > 500, `calls=${r.calls.length} contracts=${contracts(r.sent)} same=${contractOf(r.sent) === englishContract}`);
    design = c.session.getActiveDesign();
    check('V17', `${lang}: the drawing becomes the design on the table`, design && design.source === SHORTENER && design.version === 1, JSON.stringify(design));
  }
  // A follow-up in the same language reaches that design.
  const c17 = makeEngine([SHORTENER_ANSWER]);
  await ask(c17, 'Diseña un acortador de URLs');
  const c17b = makeEngine([SHORTENER_ANSWER_2], c17.session);
  r = await ask(c17b, 'Añade una caché delante de la tabla de enlaces');
  check('V17', 'a Spanish follow-up: the update contract, with the design in the turn once', contracts(r.sent) === 1 && /This turn changes the design already on the table/.test(contractOf(r.sent)) && count(all(r.sent), '<active_design view=') === 1 && all(r.sent).includes('Servicio de enlaces'), contractOf(r.sent).slice(0, 300));
  design = c17b.session.getActiveDesign();
  check('V17', 'version 2 of the same design, pointing at v1', design && design.version === 2 && design.source === SHORTENER_2 && /\.v1$/.test(String(design.parentArtifactId || '')), JSON.stringify(design));
  for (const [lang, q] of [['Spanish', '¿Qué es un diagrama de secuencia?'], ['Russian', 'Объясни без схемы, просто словами, как работает очередь'], ['Chinese', '我昨天画了一个架构图'], ['Japanese', '図はいらないので言葉で説明して']]) {
    const c = makeEngine([PROSE]);
    r = await ask(c, q);
    check('V17', `control, ${lang}: no contract for a question about one, a refusal, or the past`, contracts(r.sent) === 0, `count=${contracts(r.sent)} · ${q}`);
  }

  // ── V18 ───────────────────────────────────────────────────────────────
  out('\nV18 Sales · what an independent read found: the chart as a table in four languages, lanes kept on an edit, recall');
  setMode('sales');
  for (const [lang, q] of [['Spanish', 'Muestra este gráfico como tabla'], ['Russian', 'Покажи этот график в виде таблицы'], ['Chinese', '把这个图表转成表格'], ['Japanese', 'このグラフを表にしてください']]) {
    const base = makeEngine([FORECAST_ANSWER]);
    base.session.addTranscript({ speaker: 'system', text: 'We are at ten thousand dollars a month right now.', timestamp: Date.now() - 4000, final: true });
    await ask(base, 'What would revenue look like at 5% monthly growth over the next three months?');
    const next = makeEngine([TABLE_OF_CHART], base.session);
    r = await ask(next, q);
    const sent = all(r.sent);
    check('V18', `${lang}: the copy-the-values contract, with the computed rows in the turn once`, r.calls.length === 1 && contracts(r.sent) === 1 && /copy them exactly\. The same column names, the same row labels, the same numbers/.test(contractOf(r.sent)) && count(sent, 'Values (what the app computed') === 1 && sent.includes('| Month 3 | 11,576.25 |'), `calls=${r.calls.length} contracts=${contracts(r.sent)} · ${contractOf(r.sent).slice(0, 200)}`);
    design = next.session.getActiveDesign();
    check('V18', `${lang}: the chart stays the artifact on the table, unchanged`, design && design.artifact === 'chart' && design.version === 1 && design.source === chart(5), JSON.stringify(design));
  }
  // An edit of a swimlane diagram is told it is one.
  setMode('team-meet');
  const LANES = 'flowchart LR\n    subgraph Customer\n        a["Request refund"]\n    end\n    subgraph Support\n        b["Review request"]\n    end\n    a --> b';
  const LANES_2 = 'flowchart LR\n    subgraph Customer\n        a["Request refund"]\n    end\n    subgraph Support\n        b["Review request"]\n    end\n    subgraph Finance\n        f["Approve over 500"]\n    end\n    a --> b\n    b --> f';
  const c18 = makeEngine([`Who does what in a refund.\n\n${fence('mermaid', LANES)}\n\nSupport reviews every request.`]);
  await ask(c18, 'Draw a swimlane diagram of the refund process');
  const c18b = makeEngine([`Finance now approves the large ones.\n\n${fence('mermaid', LANES_2)}\n\nAnything over 500 goes to Finance.`], c18.session);
  r = await ask(c18b, 'Add a finance lane that approves anything over 500');
  check('V18', 'an edit of a swimlane diagram: the update contract, still with the lane rules', contracts(r.sent) === 1 && /This turn changes the swimlane diagram already on the table/.test(contractOf(r.sent)) && /drawn as SWIMLANES\. One `subgraph` per lane/.test(contractOf(r.sent)) && count(all(r.sent), '<active_design view=') === 1, contractOf(r.sent).slice(0, 500));
  design = c18b.session.getActiveDesign();
  check('V18', 'version 2 of the swimlane diagram, with the new lane', design && design.version === 2 && design.source === LANES_2, JSON.stringify(design));
  // What was SAID is not a question about the design: no contract, no design block.
  const c18c = makeEngine([PROSE], c18.session);
  r = await ask(c18c, 'What did Maria say about the refund review?');
  check('V18', 'a question about what was said gets no contract and no design block', contracts(r.sent) === 0 && count(all(r.sent), '<active_design view=') === 0, `contracts=${contracts(r.sent)} blocks=${count(all(r.sent), '<active_design view=')}`);

  const failed = results.filter((x) => !x.ok);
  out(`\n##### visual catalog · V3=${V3}: ${results.length - failed.length}/${results.length} passed${failed.length ? `  FAILED: ${failed.map((f) => `${f.scenario}:${f.name}`).join(' | ')}` : ''}`);
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* temp dir */ }
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  out('e2e-visual-catalog crashed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
