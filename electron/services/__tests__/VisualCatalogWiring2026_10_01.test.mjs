// electron/services/__tests__/VisualCatalogWiring2026_10_01.test.mjs
//
// The nine-mode visual catalog in the MAIN process (built bundles).
//
// MODE IDENTITY. Which visuals a mode makes relevant is decided by the mode's
// TEMPLATE — the key of the mode policy registry — never by its display name.
// A user mode called "Sales" built on the General template is a custom mode.
//
// ROUTING. A visual turn that the keyword planner reads as CODING ("model
// users, orders and payments") must not be streamed, validated and verified as
// code — and it must not become a system-design answer either.
//
// PROMPT. One contract per request, in the registered system prompt, holding
// only the rules of the one kind the turn needs plus what the mode adds.
//
// PHONE. Charts and Chen diagrams are drawn in the main process (the adapters
// are pure); an automaton goes to the broker as Mermaid this app wrote. Under
// every picture sits the readable form of the same thing.
//
// EXPORT. JSON and CSV are validated here before a byte is written.
//
// ACTIONS. Visual offers fire only on the structure or data they need, under
// the real mode ids, and an accepted one is an explicit visual request.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.NATIVELY_PROMPT_SYSTEM_V2 = '1';
delete process.env.NATIVELY_SYSTEM_DESIGN_DIAGRAMS;
delete process.env.NATIVELY_DIAGRAM_EXAMPLES;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/', p)).href;
const dps = await import(dist('llm/diagramPromptSignals.js'));
const { buildSystemPromptV2, getV2PromptDescriptor, resolveV2SystemPrompt } = await import(dist('llm/promptSystemV2.js'));
const planner = await import(dist('llm/AnswerPlanner.js'));
const { renderPhoneAnswer, setPhoneDiagramProvider } = await import(dist('services/phoneMirrorMarkdown.js'));
const { diagramExportBytes, isDiagramExportFormat, DIAGRAM_EXPORT_FILTERS } = await import(dist('services/diagram/diagramExport.js'));
const { SessionTracker } = await import(dist('SessionTracker.js'));
const { DynamicActionDetector, MODE_TRIGGERS } = await import(dist('services/dynamic-actions/DynamicActionDetector.js'));
const actions = await import(dist('llm/systemDesignAction.js'));
const { MODE_IDS } = await import(dist('context-intelligence/policies/mode-policy-registry.js'));
const { prepareDirectAssistPrompt } = await import(dist('direct-assist/requestBuilder.js'));

const count = (text, needle) => text.split(needle).length - 1;
const fence = (tag, body) => '```' + tag + '\n' + body + '\n```';
const turn = (question, extra = {}) => dps.resolveDiagramTurn({ question, userInstructions: null, activeDesign: null, ...extra });
const FORECAST = JSON.stringify({ v: 1, type: 'line', title: 'Monthly revenue at 5% net growth', x: { label: 'Month' }, y: { label: 'Revenue', unit: 'USD' }, compute: { kind: 'compound_growth', baseline: 10000, ratePercent: 5, period: 'month', periods: 3 } });
const CHART_ANSWER = `At 5% net growth this is a scenario.\n\n${fence('natively-chart', FORECAST)}\n\nIt rests on one assumption.`;

beforeEach(() => {
  dps.registerActiveDesignProvider(null);
  dps.registerVisualModeProvider(null);
  dps.registerConversationTextProvider(null);
  delete process.env.NATIVELY_SYSTEM_DESIGN_DIAGRAMS;
});

describe('mode identity comes from the template, never the name', () => {
  test('the nine built-in templates are the nine modes of the policy registry', () => {
    assert.deepEqual([...MODE_IDS].sort(), ['call-center', 'general', 'lecture', 'looking-for-work', 'recruiting', 'sales', 'seminar', 'team-meet', 'technical-interview']);
    for (const id of MODE_IDS) assert.equal(dps.visualModeOf({ templateType: id, name: id === 'general' ? 'General' : 'Anything' }), id);
  });

  test('a custom mode named "Sales" is not the Sales mode', () => {
    assert.equal(dps.visualModeOf({ templateType: 'general', name: 'Sales' }), 'custom');
    assert.equal(dps.visualModeOf({ templateType: 'general', name: 'My standup' }), 'custom');
    assert.equal(dps.visualModeOf({ templateType: 'general', name: 'General' }), 'general');
    // A mode built on the Sales template IS the Sales policy, whatever it is called.
    assert.equal(dps.visualModeOf({ templateType: 'sales', name: 'Enterprise calls' }), 'sales');
  });

  test('an unusable template is unknown, and unknown keeps the explicit-only behaviour', () => {
    for (const bad of [{ templateType: 'thesis', name: 'x' }, { templateType: 'Sales', name: 'x' }, { templateType: '', name: 'x' }, {}, null, undefined]) {
      assert.equal(dps.visualModeOf(bad), 'unknown');
    }
    assert.equal(dps.getRegisteredVisualMode(), 'unknown', 'no provider registered');
    assert.equal(turn('Where are deals dropping out?').request.enabled, false);
  });

  test('the registered provider is asked for the PINNED mode of the turn', () => {
    const asked = [];
    dps.registerVisualModeProvider((pinned) => {
      asked.push(pinned);
      return pinned === 'mode-sales' ? 'sales' : 'custom';
    });
    const sales = turn('Where are deals dropping out?', { pinnedModeId: 'mode-sales' });
    assert.deepEqual([sales.request.enabled, sales.request.view, sales.request.mode, sales.request.contextual], [true, 'chart', 'sales', true]);
    const custom = turn('Where are deals dropping out?', { pinnedModeId: 'mode-custom-named-sales' });
    assert.equal(custom.request.mode, 'custom');
    assert.deepEqual(asked, ['mode-sales', 'mode-custom-named-sales']);
  });

  test('a surface with no mode passes null and gets explicit requests only', () => {
    dps.registerVisualModeProvider(() => 'sales');
    assert.equal(turn('Where are deals dropping out?', { mode: null }).request.enabled, false);
    assert.equal(turn('Draw an ER diagram of customers and orders.', { mode: null }).request.view, 'er');
  });

  test('a throwing provider never breaks a turn', () => {
    dps.registerVisualModeProvider(() => {
      throw new Error('db closed');
    });
    assert.equal(dps.getRegisteredVisualMode(), 'unknown');
    assert.equal(turn('Draw an ER diagram of customers and orders.').request.enabled, true);
  });
});

describe('one contract per request, in the registered system prompt', () => {
  test('a chart turn carries exactly one contract in every mode persona', () => {
    const { signals } = turn('What would revenue look like at 5% monthly growth?', { mode: 'sales' });
    assert.equal(signals.view, 'chart');
    for (const mode of ['general', 'technical-interview', 'team-meet', 'lecture', 'sales', 'custom', 'looking-for-work', 'recruiting', 'seminar', 'call-center']) {
      const p = buildSystemPromptV2({ mode, action: 'answer', tier: 'cloud', diagram: signals });
      assert.equal(count(p, '<diagram_contract>'), 1, mode);
      assert.equal(count(p, '</diagram_contract>'), 1, mode);
      assert.match(p, /Rules for the chart:/, mode);
    }
  });

  test('the registered prompt is found again by identity, with its signals', () => {
    const { signals } = turn('Model users, orders, and payments.', { mode: 'technical-interview' });
    const resolved = resolveV2SystemPrompt({ mode: 'technical-interview', action: 'answer', tier: 'cloud', diagram: signals });
    assert.ok(resolved, 'the v2 prompt resolves');
    const descriptor = getV2PromptDescriptor(resolved);
    assert.ok(descriptor, 'and is recognised as a v2 prompt');
    assert.deepEqual(descriptor.diagram, signals);
    assert.equal(count(dps.withDiagramContract(resolved, { request: {}, signals, turnBlock: '' }), '<diagram_contract>'), 1, 'never appended twice');
  });

  test('the same turn resolves to the same signals (a bounded prompt registry)', () => {
    const a = turn('What would revenue look like at 5% monthly growth?', { mode: 'sales' });
    const b = turn('What would revenue look like at 5% monthly growth?', { mode: 'sales' });
    assert.deepEqual(a.signals, b.signals);
    assert.ok(!JSON.stringify(a.signals).toLowerCase().includes('revenue'));
  });

  test('a follow-up carries the chart on the table in the TURN, quoted with its own tag', () => {
    const active = { artifactId: 'design-1.v1', artifact: 'chart', view: 'chart', version: 1, source: FORECAST, foreground: true };
    const t = turn('Make it 3%', { mode: 'sales', activeDesign: active });
    assert.deepEqual([t.request.operation, t.request.view, t.request.chartIntent], ['update', 'chart', 'forecast']);
    assert.ok(t.turnBlock.includes('```natively-chart\n' + FORECAST));
    assert.ok(!t.turnBlock.includes('```mermaid'));
    const system = buildSystemPromptV2({ mode: 'sales', action: 'answer', tier: 'cloud', diagram: t.signals });
    assert.ok(!system.includes(FORECAST), 'the chart itself is not in the system prompt');
    assert.ok(!system.includes('"baseline":10000'));
    assert.deepEqual(t.signals.exampleIds, [], 'no reference example on an update');
  });

  test('brainstorm alternatives are a system-design exercise: a chart on the table leaves brainstorm alone', () => {
    assert.equal(dps.alternativeDesignTurn({ artifactId: 'd.v1', artifact: 'chart', view: 'chart', source: FORECAST }), null);
    assert.equal(dps.alternativeDesignTurn({ artifactId: 'd.v1', artifact: 'mermaid', view: 'er', source: 'erDiagram\n A ||..o{ B : r' }), null);
    assert.ok(dps.alternativeDesignTurn({ artifactId: 'd.v1', artifact: 'mermaid', view: 'architecture', source: 'flowchart LR\n a["A"] --> b["B"]' }));
  });

  test('Direct Assist (no mode) draws an explicitly requested visual, once', () => {
    const prepared = prepareDirectAssistPrompt({ requestId: 'r1', source: 'typed', selection: { provider: 'gemini', model: 'gemini-2.5-flash' }, currentRequest: 'Draw an ER diagram of customers and orders.' });
    const system = prepared.systemPrompt;
    assert.equal(count(system, '<diagram_contract>'), 1);
    assert.match(system, /Rules for the entity–relationship diagram:/);
  });

  test('with the feature off there is no contract and no turn block', () => {
    process.env.NATIVELY_SYSTEM_DESIGN_DIAGRAMS = '0';
    const t = turn('What would revenue look like at 5% monthly growth?', { mode: 'sales' });
    assert.equal(t.signals, null);
    assert.equal(t.turnBlock, '');
  });
});

describe('AnswerPlanner: a visual turn is not a coding turn, and not a system design', () => {
  const plan = (question) => planner.planAnswer({ question, source: 'what_to_answer' });

  test('with no visual in play, routing is exactly what it was', () => {
    assert.equal(planner.isCodingAnswerType(plan('Write a function to solve two sum.').answerType), true);
    assert.equal(plan('Design a scalable notification system').answerType, 'system_design_answer');
  });

  test('visualTurnRoute pulls a catalog visual off a coding route to the neutral route', () => {
    dps.registerVisualModeProvider(() => 'technical-interview');
    assert.equal(dps.visualTurnRoute('Model users, orders, and payments.', 'coding_question_answer'), 'general_meeting_answer');
    assert.equal(dps.visualTurnRoute('Draw the ER diagram for the orders table.', 'dsa_question_answer'), 'general_meeting_answer');
    // Not a coding route: left alone. The contract adds the visual to whatever route it is.
    assert.equal(dps.visualTurnRoute('Model users, orders, and payments.', 'technical_concept_answer'), null);
    assert.equal(dps.visualTurnRoute('Where are deals dropping out?', 'sales_answer'), null);
    // Code was asked for: it stays a coding turn, with the diagram beside it.
    assert.equal(dps.visualTurnRoute('Draw the ER diagram for users and orders and write the SQL to create the tables.', 'coding_question_answer'), null);
    // No visual at all.
    assert.equal(dps.visualTurnRoute('Write a function to solve two sum.', 'dsa_question_answer'), null);
  });

  test('it is never sent to the system-design route', () => {
    dps.registerVisualModeProvider(() => 'sales');
    for (const q of ['Model users, orders, and payments.', 'What would revenue look like at 5% monthly growth?', 'Show the expected savings and break-even.']) {
      for (const type of ['coding_question_answer', 'dsa_question_answer', 'general_meeting_answer', 'sales_answer']) {
        assert.notEqual(dps.visualTurnRoute(q, type), 'system_design_answer', `${q} / ${type}`);
      }
    }
  });

  test('a follow-up on a chart or a schema is not a system-design follow-up', () => {
    dps.registerVisualModeProvider(() => 'sales');
    dps.registerActiveDesignProvider(() => ({ artifactId: 'design-1.v1', lineageId: 'design-1', version: 1, artifact: 'chart', view: 'chart', type: 'line', source: FORECAST, foreground: true, updatedAt: Date.now() }));
    assert.equal(dps.isDesignFollowUpTurn('Make it 3%', 'general_meeting_answer'), false);
    assert.notEqual(plan('Make it 3%').answerType, 'system_design_answer');
    assert.notEqual(plan('Why is the last month higher?').answerType, 'system_design_answer');
  });

  test('a follow-up on a system design still routes as system design (unchanged)', () => {
    dps.registerActiveDesignProvider(() => ({ artifactId: 'design-1.v1', lineageId: 'design-1', version: 1, artifact: 'mermaid', view: 'architecture', type: 'flowchart', source: 'flowchart LR\n    producer["Producer Service"] -->|"enqueue"| queue["Notification Queue"]\n    queue --> worker["Delivery Worker"]', foreground: true, updatedAt: Date.now() }));
    assert.equal(plan('Add retry handling and a dead-letter queue').answerType, 'system_design_answer');
  });

  test('the planner applies the route: a data-model request does not get the coding contract', () => {
    dps.registerVisualModeProvider(() => 'technical-interview');
    const before = plan('Write a function that models users, orders, and payments in Python.').answerType;
    assert.equal(planner.isCodingAnswerType(before), true, 'a real code request keeps its coding route');
    const p = plan('Draw an ER diagram for users, orders, and payments.');
    assert.equal(planner.isCodingAnswerType(p.answerType), false);
    assert.notEqual(p.answerType, 'system_design_answer');
  });
});

describe('a calculation whose input nobody stated', () => {
  const Q = 'What would revenue look like at 5% monthly growth?';

  test('with no reader registered the conversation is unknown and the turn is what it was', () => {
    dps.registerVisualModeProvider(() => 'sales');
    dps.registerConversationTextProvider(null);
    assert.equal(dps.getRegisteredConversationText(), undefined);
    const t = turn(Q);
    assert.equal(t.request.missingInput, undefined);
    assert.equal(t.signals.missingInput, undefined);
    assert.ok(t.signals.exampleIds.length > 0);
  });

  test('the session owner is asked what was said; a starting value stated nowhere is carried to the prompt', () => {
    dps.registerVisualModeProvider(() => 'sales');
    let said = '';
    dps.registerConversationTextProvider(() => said);
    let t = turn(Q);
    assert.equal(t.request.missingInput, 'baseline');
    assert.equal(t.signals.missingInput, 'baseline');
    assert.deepEqual(t.signals.exampleIds, [], 'no reference whose numbers could be borrowed');
    const text = buildSystemPromptV2({ mode: 'sales', action: 'answer', tier: 'cloud', diagram: t.signals });
    assert.equal(count(text, 'CHECKED BEFORE THIS TURN: the request does not state a starting value'), 1);
    assert.equal(count(text, 'DIAGRAM REFERENCE'), 0);

    said = '[INTERVIEWER]: We are at ten thousand dollars a month in revenue right now.';
    t = turn(Q);
    assert.equal(t.request.missingInput, undefined);
    assert.ok(t.signals.exampleIds.length > 0);
  });

  test('a caller that knows the conversation can say so itself; a failing reader changes nothing', () => {
    dps.registerVisualModeProvider(() => 'sales');
    dps.registerConversationTextProvider(() => {
      throw new Error('session closed');
    });
    assert.equal(dps.getRegisteredConversationText(), undefined);
    assert.equal(turn(Q).request.missingInput, undefined);
    assert.equal(turn(Q, { material: '' }).request.missingInput, 'baseline');
    assert.equal(turn(Q, { material: 'MRR is 42,000 dollars.' }).request.missingInput, undefined);
  });

  test('a real session is the reader: what was heard counts', () => {
    dps.registerVisualModeProvider(() => 'sales');
    const session = new SessionTracker();
    dps.registerConversationTextProvider(() => session.getFormattedContext(1800));
    assert.equal(turn(Q).request.missingInput, 'baseline');
    session.addTranscript({ speaker: 'system', text: 'We are at ten thousand dollars a month in revenue right now.', timestamp: Date.now(), final: true });
    assert.equal(turn(Q).request.missingInput, undefined);
  });
});

describe('the session remembers a chart like it remembers a design', () => {
  test('a chart answer becomes the artifact on the table; a mode switch and a reset clear it', () => {
    const session = new SessionTracker();
    session.addAssistantMessage(CHART_ANSWER);
    const active = session.getActiveDesign();
    assert.deepEqual([active.artifact, active.view, active.version], ['chart', 'chart', 1]);
    assert.equal(active.source, FORECAST);
    session.addAssistantMessage(`Now 3%.\n\n${fence('natively-chart', FORECAST.replace('"ratePercent":5', '"ratePercent":3'))}`);
    assert.deepEqual([session.getActiveDesign().version, session.getActiveDesign().parentArtifactId], [2, 'design-1.v1']);
    session.clearSessionContext();
    assert.equal(session.getActiveDesign(), null);
    session.addAssistantMessage(CHART_ANSWER);
    session.reset();
    assert.equal(session.getActiveDesign(), null);
  });

  test('a chart that fails its own checks is not remembered', () => {
    const session = new SessionTracker();
    session.addAssistantMessage(`x\n\n${fence('natively-chart', JSON.stringify({ v: 1, type: 'line', compute: { kind: 'compound_growth', ratePercent: 5, period: 'month', periods: 3 } }))}`);
    assert.equal(session.getActiveDesign(), null);
  });
});

describe('Phone Mirror', () => {
  const requests = [];
  let images = new Map();
  let enabled = true;
  beforeEach(() => {
    requests.length = 0;
    images = new Map();
    enabled = true;
    setPhoneDiagramProvider({
      enabled: () => enabled,
      lookup: (key) => images.get(key),
      failed: () => false,
      request: (key, source) => requests.push({ key, source }),
    });
  });

  test('a chart is drawn in the main process: an <img>, never inline SVG, with its data underneath', () => {
    const { html } = renderPhoneAnswer(CHART_ANSWER);
    assert.match(html, /<figure class="diagram is-ready" data-label="Forecast">/);
    const src = /<img class="diagram-img" alt="([^"]+)" src="(data:image\/svg\+xml;charset=utf-8,[^"]+)"/.exec(html);
    assert.ok(src, 'the picture is an image with a data URL');
    assert.match(src[1], /^Line chart: Monthly revenue at 5% net growth\. Revenue goes from 10,000 USD to 11,576\.25 USD at Month 3\. Scenario\.$/);
    assert.ok(decodeURIComponent(src[2]).includes('<svg xmlns="http://www.w3.org/2000/svg"'));
    assert.ok(!html.includes('<svg'), 'no inline SVG reaches the phone page');
    assert.match(html, /<details class="diagram-source"><summary>Data<\/summary><div class="table-wrap"><table>/);
    assert.ok(html.includes('<td>Month 3</td><td>11576.25</td>'));
    assert.ok(html.includes('<li>Status: Scenario</li>'));
    assert.ok(html.includes('Constant 5% net growth per month from 10,000 over 3 months.'));
    assert.equal(requests.length, 0, 'no window is asked to draw a chart');
    assert.ok(html.includes('It rests on one assumption.'));
  });

  test('a chart that lacks an input shows what it needs instead of a picture', () => {
    const { html } = renderPhoneAnswer(`x\n\n${fence('natively-chart', JSON.stringify({ v: 1, type: 'line', compute: { kind: 'compound_growth', ratePercent: 5, period: 'month', periods: 3 } }))}`);
    assert.match(html, /<figure class="diagram is-failed">/);
    assert.ok(html.includes('This forecast needs a starting value.'));
    assert.ok(!html.includes('<img'));
  });

  test('a chart still arriving is "Generating chart…", and nothing is drawn from a partial payload', () => {
    const partial = `Scenario.\n\n\`\`\`natively-chart\n${FORECAST.slice(0, 60)}`;
    const { html } = renderPhoneAnswer(partial, { streaming: true });
    assert.match(html, /<figure class="diagram is-pending">/);
    assert.ok(html.includes('Generating chart…'));
    assert.ok(!html.includes('<img'));
  });

  test('Chen is drawn here too; an automaton goes to the broker as Mermaid this app wrote', () => {
    const chen = renderPhoneAnswer(`x\n\n${fence('natively-diagram', JSON.stringify({ kind: 'chen-er', entities: ['Customer', 'Order'], relationships: [{ name: 'places', participants: [{ entity: 'Customer', cardinality: '1' }, { entity: 'Order', cardinality: 'N' }] }] }))}`).html;
    assert.match(chen, /data-label="ER diagram \(Chen\)"/);
    assert.match(chen, /<img class="diagram-img"/);
    assert.equal(requests.length, 0);
    const dfa = renderPhoneAnswer(`x\n\n${fence('natively-diagram', JSON.stringify({ kind: 'automaton', type: 'dfa', alphabet: ['a'], states: ['q0', 'q1'], start: 'q0', accepting: ['q1'], transitions: [{ from: 'q0', symbol: 'a', to: 'q1' }, { from: 'q1', symbol: 'a', to: 'q1' }] }))}`).html;
    assert.match(dfa, /<figure class="diagram is-pending" data-diagram="[a-z0-9-]+" data-label="DFA">/);
    assert.equal(requests.length, 1);
    assert.match(requests[0].source, /^flowchart LR\n    start_marker\[" "\]/);
    assert.ok(dfa.includes('<th>State</th><th>a</th>'), 'the transition table is there before any picture');
  });

  test('a model-written label cannot inject markup into the phone page', () => {
    const hostile = fence('natively-chart', JSON.stringify({ v: 1, type: 'bar', title: '"><script>alert(1)</script>', x: { values: ['<img src=x onerror=1>', 'b'] }, sources: ['</li><script>x</script>'], series: [{ name: 'S', status: 'observed', values: [1, 2] }] }));
    const { html } = renderPhoneAnswer(`x\n\n${hostile}`);
    assert.ok(!/<script|<img src=x|onerror=1>/.test(html.replace(/src="data:image\/svg\+xml[^"]+"/g, '')));
    assert.match(html, /<img class="diagram-img"/);
  });

  test('"source only" stays source on the phone; with the feature off it is an ordinary code block', () => {
    const sourceOnly = renderPhoneAnswer(fence('natively-chart source', FORECAST)).html;
    assert.ok(!sourceOnly.includes('<figure'));
    assert.match(sourceOnly, /<div class="codeblock" data-lang="natively-chart">/);
    enabled = false;
    const off = renderPhoneAnswer(CHART_ANSWER).html;
    assert.ok(!off.includes('<figure'));
    assert.match(off, /<div class="codeblock" data-lang="natively-chart">/);
  });
});

describe('Phone Mirror: a diagram made only of placeholders', () => {
  test('shows nothing: no picture, no request to the desktop, no raw source', () => {
    const requested = [];
    setPhoneDiagramProvider({ enabled: () => true, lookup: () => null, failed: () => false, request: (key, source) => requested.push(source) });
    const gap = 'flowchart TD\n    paper["Paper (not retrieved)"] --> method["Method (unknown)"]';
    const { html } = renderPhoneAnswer(`I do not have the paper.\n\n${fence('mermaid', gap)}\n\nPoint me at it.`, { streaming: false });
    assert.ok(html.includes('I do not have the paper.') && html.includes('Point me at it.'));
    assert.ok(!html.includes('<figure') && !html.includes('not retrieved') && !html.includes('codeblock'), html);
    assert.deepEqual(requested, []);
    const real = renderPhoneAnswer(`x\n\n${fence('mermaid', 'flowchart LR\n    api["API"] --> auth["Auth (unknown)"]')}`, { streaming: false });
    assert.ok(real.html.includes('<figure class="diagram'));
    assert.equal(requested.length, 1);
    setPhoneDiagramProvider(null);
  });
});

describe('export: JSON and CSV', () => {
  test('the formats and their file types', () => {
    for (const f of ['svg', 'png', 'mmd', 'json', 'csv']) assert.equal(isDiagramExportFormat(f), true, f);
    for (const f of ['exe', 'html', 'js', '', null, 'JSON']) assert.equal(isDiagramExportFormat(f), false, String(f));
    assert.deepEqual(DIAGRAM_EXPORT_FILTERS.json.extensions, ['json']);
    assert.match(DIAGRAM_EXPORT_FILTERS.json.name, /JSON/);
    assert.ok(!/mermaid/i.test(DIAGRAM_EXPORT_FILTERS.json.name), 'a chart payload is never labelled Mermaid source');
  });

  test('JSON is written only if it is JSON, and re-serialised', () => {
    const bytes = diagramExportBytes('json', '{"type":"line","computed":{"table":{"rows":[["Month 3",11576.25]]}}}');
    assert.equal(bytes.toString('utf8'), '{\n  "type": "line",\n  "computed": {\n    "table": {\n      "rows": [\n        [\n          "Month 3",\n          11576.25\n        ]\n      ]\n    }\n  }\n}\n');
    assert.equal(diagramExportBytes('json', '{"a":1} <script>'), null);
    assert.equal(diagramExportBytes('json', '"just a string"'), null);
    assert.equal(diagramExportBytes('json', 'null'), null);
    assert.equal(diagramExportBytes('json', `{"a":"${'x'.repeat(100 * 1024)}"}`), null, 'oversize');
  });

  test('CSV is text with CRLF line ends and a byte-order mark; control characters are refused', () => {
    const bytes = diagramExportBytes('csv', 'Month,Revenue (USD)\nNow,10000\nMonth 1,10500\n');
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.equal(bytes.subarray(3).toString('utf8'), 'Month,Revenue (USD)\r\nNow,10000\r\nMonth 1,10500\r\n');
    assert.equal(diagramExportBytes('csv', 'a,b\u0000c'), null);
    assert.equal(diagramExportBytes('csv', ''), null);
    assert.equal(diagramExportBytes('csv', 'x'.repeat(300 * 1024)), null);
  });
});

describe('visual action offers', () => {
  const detector = new DynamicActionDetector();
  const types = (transcript, mode) => detector.detectTriggers({ transcript, modeTemplateType: mode }).map((m) => m.trigger.type);

  test('offered only when the structure or the data is there', () => {
    assert.ok(types('It is blocked by the schema migration and we are waiting on the API team.', 'team-meet').includes('visual_dependencies'));
    assert.ok(types('First we collect the form, then finance reviews it, after that it gets approved by the director.', 'general').includes('visual_workflow'));
    assert.ok(types('We went from 120 tickets in March to 134 tickets in April.', 'call-center').includes('visual_figures'));
    assert.ok(types('My router keeps dropping the connection and I see an error code.', 'call-center').includes('visual_troubleshooting'));
    assert.ok(types('There are three types of index we will cover today.', 'lecture').includes('visual_concepts'));
    assert.ok(types('The orders table has a foreign key to customers, one-to-many.', 'technical-interview').includes('visual_data_model'));
    assert.ok(types('What if we grow 5% a month from 10,000?', 'sales').includes('visual_scenarios'));
    assert.ok(types('I joined Acme in 2018 and moved to Globex in 2023.', 'looking-for-work').includes('visual_timeline'));
  });

  test('ordinary talk offers nothing visual', () => {
    for (const mode of Object.keys(MODE_TRIGGERS)) {
      const offered = types('Thanks everyone, let us pick this up again next week.', mode).filter((t) => t.startsWith('visual_'));
      assert.deepEqual(offered, [], mode);
    }
    assert.deepEqual(types('One figure only: we have 120 tickets.', 'call-center').filter((t) => t.startsWith('visual_')), []);
  });

  // Found in review: each of these offered a card.
  test('a word of the structure is not the structure', () => {
    const visual = (line, mode) => types(line, mode).filter((t) => t.startsWith('visual_'));
    assert.deepEqual(visual('First of all thanks for joining, then we can get started.', 'general'), []);
    assert.deepEqual(visual('First I want to say thanks, then we can look at the numbers.', 'sales'), []);
    assert.deepEqual(visual('It depends on the weather really.', 'general'), []);
    assert.deepEqual(visual('Honestly it depends on what they say.', 'team-meet'), []);
    assert.deepEqual(visual('I was born in 1990 and moved here in 2015.', 'general'), []);
    assert.deepEqual(visual('I was born in 1990 and moved here in 2015.', 'looking-for-work'), []);
    assert.deepEqual(visual('It is $50 a month or $500 a year.', 'sales'), []);
    assert.deepEqual(visual('The process is slow, honestly.', 'general'), []);
  });

  test('the structure itself still is', () => {
    assert.ok(types('The release depends on the billing migration.', 'team-meet').includes('visual_dependencies'));
    assert.ok(types('We are still waiting on the security review.', 'general').includes('visual_dependencies'));
    assert.ok(types('First you submit the form, then your manager approves it, and finally finance pays it.', 'recruiting').includes('visual_workflow'));
    assert.ok(types('Our process is that sales qualifies the lead and then hands it to solutions.', 'sales').includes('visual_workflow'));
    assert.ok(types('Revenue was $40k in Q1, $52k in Q2 and $61k in Q3.', 'sales').includes('visual_figures'));
    assert.ok(types('We shipped v1 in 2019, v2 in 2021 and the rewrite in 2024.', 'general').includes('visual_timeline'));
  });

  test('the system-design card is offered in the technical interview mode, on a design ask', () => {
    const offered = (line) => detector.detectTriggers({ transcript: line, modeTemplateType: 'technical-interview' }).filter((m) => m.trigger.type === 'system_design_prompt');
    for (const line of ['How would you design a URL shortener?', 'Design a rate limiting service for our API.', 'This is the system design round.', 'Give me the high-level design first.']) {
      assert.equal(offered(line).length, 1, line);
      assert.equal(dps.isSystemDesignActionInstruction(offered(line)[0].trigger.promptInstruction), true, line);
    }
    for (const line of ['The architecture team is in Berlin.', 'We deployed a distributed cache last year.', 'I like the design of this office.']) {
      assert.equal(offered(line).length, 0, line);
    }
  });

  test('the offers live under the real mode ids, and never outrank a mode-specific trigger', () => {
    for (const id of ['team-meet', 'call-center', 'technical-interview', 'looking-for-work', 'seminar', 'general', 'sales', 'recruiting', 'lecture']) {
      assert.ok(MODE_IDS.includes(id), id);
      assert.ok((MODE_TRIGGERS[id] || []).some((t) => t.type.startsWith('visual_')), `${id} has no visual offer`);
    }
    const visual = Object.values(MODE_TRIGGERS).flat().filter((t) => t.type.startsWith('visual_'));
    const other = Object.values(MODE_TRIGGERS).flat().filter((t) => !t.type.startsWith('visual_'));
    assert.ok(Math.max(...visual.map((t) => t.priority)) <= Math.min(...other.map((t) => t.priority)), 'a visual offer never displaces a mode-specific one');
  });

  test('accepting one is an explicit visual request, reconstructing what was said', () => {
    const expected = { workflow: 'flowchart', dataModel: 'er', figures: 'chart', scenarios: 'chart', dependencies: 'dependency', troubleshooting: 'decision', timeline: 'timeline', concepts: 'mindmap' };
    for (const [key, action] of Object.entries(actions.VISUAL_ACTIONS)) {
      assert.equal(actions.isVisualActionInstruction(action.instruction), true, key);
      // The heard line asked for nothing; the accepted card is the request.
      const t = turn('yeah so that is where we are', { mode: 'general', actionInstruction: action.instruction });
      assert.deepEqual([t.request.enabled, t.request.view, t.request.explicit, t.request.basis], [true, expected[key], true, 'meeting-reconstruction'], key);
      assert.ok(t.signals, key);
    }
    assert.equal(actions.isVisualActionInstruction('You are in Sales mode. The prospect has raised a pricing concern.'), false);
    assert.equal(turn('yeah so that is where we are', { mode: 'general', actionInstruction: 'Summarize the relevant discussion.' }).request.enabled, false);
  });

  test('the system-design action is unchanged', () => {
    assert.equal(dps.isSystemDesignActionInstruction(actions.SYSTEM_DESIGN_ACTION_INSTRUCTION), true);
    assert.equal(actions.isVisualActionInstruction(actions.SYSTEM_DESIGN_ACTION_INSTRUCTION), false);
  });
});
