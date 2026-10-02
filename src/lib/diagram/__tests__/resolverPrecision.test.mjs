// The visual resolver decides, for every turn, whether the answer is told to
// draw. A wrong "yes" puts a diagram contract on a question that wanted words —
// in a live interview — so this suite is mostly about what must NOT draw.
//
// Everything here was reproduced as a wrong decision in the 2026-10-01 review
// before the rules were rewritten (tests/diagram/resolver-cases.mjs: 29 of 141
// right before; tests/diagram/talk-corpus.mjs: 150 ordinary lines drew).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDiagramRequest, visualInputStatus, VISUAL_MODES } from '../diagramRequest.mjs';
import { CASES, ARCH, CHART } from '../../../../tests/diagram/resolver-cases.mjs';
import { CORPUS, EXPLICIT, CODING_QUESTIONS, UNRELATED_FOLLOW_UPS } from '../../../../tests/diagram/talk-corpus.mjs';

const resolve = (question, extra = {}) => resolveDiagramRequest({ question, featureEnabled: true, ...extra });
const MODES = [...VISUAL_MODES, 'custom', 'unknown'];

describe('the reviewed decisions', () => {
  test(`all ${CASES.length} come out as they should`, () => {
    const wrong = [];
    for (const [question, ctx, want] of CASES) {
      const r = resolve(question, { mode: ctx.mode, answerType: ctx.answerType, activeDesign: ctx.active || null, userInstructions: ctx.instructions || null });
      let ok;
      if (want === 'off') ok = !r.enabled;
      else if (typeof want === 'string') ok = r.enabled && r.view === want;
      else {
        ok = r.enabled;
        for (const [key, value] of Object.entries(want)) ok = ok && (key === 'parent' ? Boolean(r.parentArtifactId) === value : r[key] === value);
      }
      if (!ok) wrong.push(`${question} → ${r.enabled ? `${r.view}/${r.operation}/${r.output}/${r.basis}` : 'off'} (${r.reason}); wanted ${JSON.stringify(want)}`);
    }
    assert.deepEqual(wrong, []);
  });
});

describe('ordinary talk draws nothing', () => {
  // In every mode, on every non-design route.
  const quiet = ['behavioural', 'trivia', 'smallTalk', 'statements', 'garbled', 'runOn'];
  for (const category of quiet) {
    test(`${category}: ${CORPUS[category].length} lines, eleven modes`, () => {
      const drew = [];
      for (const question of CORPUS[category]) {
        for (const mode of MODES) {
          for (const answerType of [undefined, 'general_meeting_answer', 'behavioral_interview_answer']) {
            const r = resolve(question, { mode, answerType });
            if (r.enabled) drew.push(`${mode}: ${question} → ${r.view} (${r.reason})`);
          }
        }
      }
      assert.deepEqual(drew, []);
    });
  }

  test('meeting talk draws only where a task implies it in that mode, and never as an explicit request', () => {
    // What is left is the catalog working as designed: "where are leads
    // dropping?", "when do we break even?", "who owns what on this project?".
    const allowed = new Set([
      'When does it pay for itself?', 'When do we break even on this?', 'Where are leads dropping?', 'Can we compare the plans?', 'Compare the two plans for me.',
      'How has the market changed over the last year?', 'How has our usage changed?', 'What happens if this decision changes?', 'How does compensation compare to market?',
      'Who owns what on this project?', 'How has the error rate changed since the deploy?', 'Compare the two approaches quickly.', 'How do these ideas fit together?',
      'Why is my bill higher this month?', 'Can you explain the bill?', 'Can you help me troubleshoot this?', 'Can you diagnose the problem remotely?', 'Please diagnose this issue.',
      'How do these concepts relate?',
    ]);
    const unexpected = [];
    for (const category of ['sales', 'recruiting', 'teamMeet', 'support', 'lecture']) {
      for (const question of CORPUS[category]) {
        for (const mode of MODES) {
          const r = resolve(question, { mode, answerType: 'general_meeting_answer' });
          if (r.enabled && !allowed.has(question)) unexpected.push(`${mode}: ${question} → ${r.view} (${r.reason})`);
        }
      }
    }
    assert.deepEqual(unexpected, []);
    // Lecture and Seminar are listening modes: nothing is implied there at all.
    for (const question of allowed) {
      for (const mode of ['lecture', 'seminar', 'unknown']) {
        const r = resolve(question, { mode });
        assert.ok(!r.enabled || r.explicit, `${mode}: ${question}`);
      }
    }
  });
});

describe('coding questions stay coding questions', () => {
  test(`${CODING_QUESTIONS.length} questions on both coding routes: a picture only for a product, a data model or an object model`, () => {
    const drawn = new Set();
    for (const question of CODING_QUESTIONS) {
      for (const answerType of ['dsa_question_answer', 'coding_question_answer']) {
        const r = resolve(question, { mode: 'technical-interview', answerType });
        if (r.enabled) drawn.add(`${question} → ${r.view}`);
      }
    }
    assert.deepEqual([...drawn].sort(), [
      'Design Twitter. → architecture',
      'Design the classes for a chess game. → class',
      'Design the objects for an elevator. → class',
      'How would you design a cache with TTL eviction, code it up. → architecture',
      'How would you model users and their friends? → er',
      'Model the entities for a library system. → er',
      'Model the tables for a food delivery app. → er',
    ]);
  });

  test('with a design on the table, the next coding question is still a coding question', () => {
    for (const question of ['Merge two sorted arrays', 'Remove nth node from end of linked list', 'Delete node in a linked list', 'Insert into a binary search tree', 'Use a hash map to find two numbers that add up to a target', 'Why did you use a hash map here?', 'What is the time complexity of this?']) {
      for (const answerType of ['dsa_question_answer', 'coding_question_answer']) {
        const r = resolve(question, { mode: 'technical-interview', answerType, activeDesign: ARCH });
        assert.equal(r.enabled, false, `${question} [${answerType}] → ${r.reason}`);
      }
    }
  });
});

describe('what is said after a diagram is usually not about the diagram', () => {
  for (const [name, active, allowed] of [
    ['an architecture', ARCH, ['Make it more fun.']],
    // "Make it more fun" rewords the answer; "what about 3 months…" reads as a new horizon for the forecast.
    ['a forecast chart', CHART, ['Make it more fun.', 'What about 3 months of notice?']],
  ]) {
    test(`${UNRELATED_FOLLOW_UPS.length} unrelated lines after ${name}`, () => {
      const claimed = UNRELATED_FOLLOW_UPS.filter((question) => {
        const r = resolve(question, { mode: 'looking-for-work', activeDesign: active });
        return r.enabled || r.attachActiveDesign;
      });
      assert.deepEqual([...claimed].sort(), [...allowed].sort());
    });
  }

  test('once the conversation has moved on, only naming the design or a part of it brings it back', () => {
    const behind = { ...ARCH, foreground: false };
    for (const question of ['Add a cache', 'Make this multi-region', 'Why is this better?', 'Make it shorter', 'Draw this again']) {
      const r = resolve(question, { mode: 'technical-interview', activeDesign: behind });
      assert.ok(!r.parentArtifactId, `${question} → ${r.reason}`);
    }
    for (const [question, operation] of [['Why do we need the queue?', 'explain'], ['Add a cache in front of the delivery worker', 'update'], ['Change the diagram to use two workers', 'update']]) {
      const r = resolve(question, { mode: 'technical-interview', activeDesign: behind });
      assert.equal(r.operation, operation, question);
      assert.equal(r.followUp, 'strong', question);
    }
  });

  test('a follow-up says how sure it is', () => {
    assert.equal(resolve('Why do we need the queue?', { activeDesign: ARCH }).followUp, 'strong');
    assert.equal(resolve('Make this multi-region', { activeDesign: ARCH }).followUp, 'weak');
    assert.equal(resolve('Design a URL shortener', { activeDesign: ARCH }).followUp, undefined);
  });
});

describe('a request is a request', () => {
  test(`${EXPLICIT.length} explicit phrasings are honoured in every mode, bar the notations this app does not draw`, () => {
    const refused = EXPLICIT.filter((question) => !['unknown', 'general', 'technical-interview', 'lecture'].every((mode) => resolve(question, { mode }).enabled));
    assert.deepEqual(refused, [
      'Tables please, comparing A and B.',
      'Roadmap this for me visually.',
      'Could you colour-code that in a table?',
    ]);
  });
});

describe('nothing here can be made slow', () => {
  test('a very long or degenerate utterance is decided in milliseconds', () => {
    const inputs = ['a '.repeat(40000), '1'.repeat(60000), 'one '.repeat(30000), `${'the '.repeat(20000)}draw a chart of revenue`, ' '.repeat(80000), 'can you '.repeat(20000)];
    for (const text of inputs) {
      const started = Date.now();
      resolve(text, { mode: 'sales', activeDesign: ARCH });
      visualInputStatus(text, 'forecast', text);
      assert.ok(Date.now() - started < 400, `${text.slice(0, 12)}… took ${Date.now() - started} ms`);
    }
    // The end of a long turn is where the ask is.
    assert.equal(resolve(`${'so anyway we talked about many things. '.repeat(400)}Can you draw the architecture?`, { mode: 'general' }).enabled, true);
  });
});

// Review follow-ups (2026-10-01).
describe('a new kind of visual OF what is on the table', async () => {
  const { resolveDiagramRequest } = await import('../diagramRequest.mjs');
  const CHART_ON_TABLE = { artifactId: 'design-2.v1', artifact: 'chart', view: 'chart', version: 1, foreground: true, source: JSON.stringify({ v: 1, type: 'line', title: 'Monthly revenue at 5% net growth', compute: { kind: 'compound_growth', baseline: 10000, ratePercent: 5, period: 'month', periods: 6 } }) };
  const ARCH_ON_TABLE = { artifactId: 'design-1.v1', artifact: 'mermaid', view: 'architecture', version: 1, foreground: true, source: 'flowchart LR\n    producer["Producer"] --> queue["Notification Queue"]\n    queue --> worker["Delivery Worker"]' };
  const ask = (question, activeDesign, mode = 'sales') => resolveDiagramRequest({ question, activeDesign, featureEnabled: true, mode });

  test('"show it as a table" is handed the chart to tabulate, as a fresh artifact', () => {
    const r = ask('Show it as a table.', CHART_ON_TABLE);
    assert.deepEqual([r.enabled, r.view, r.operation, r.attachActiveDesign, r.parentArtifactId], [true, 'matrix', 'create', true, 'design-2.v1']);
  });

  test('a visual of something else is not', () => {
    for (const q of ['Add a comparison table.', 'Add a DFA.', 'Draw an ER diagram of customers and orders.']) {
      const r = ask(q, ARCH_ON_TABLE, 'technical-interview');
      assert.equal(r.enabled, true, q);
      assert.equal(r.parentArtifactId, undefined, q);
      assert.equal(r.attachActiveDesign, false, q);
    }
  });

  test('a fresh drawing of another subject is not a view of the design on the table', () => {
    for (const q of ['Show the TCP handshake sequence.', 'Draw a diagram of how DNS works, I need to explain it.', 'Just draw the OAuth login flow.']) {
      const r = ask(q, ARCH_ON_TABLE, 'technical-interview');
      assert.deepEqual([r.enabled, r.parentArtifactId, r.attachActiveDesign], [true, undefined, false], q);
    }
  });

  test('with a chart on the table, a new rate or horizon redraws it', () => {
    for (const q of ['What would revenue look like at 8% monthly growth?', 'What does it look like at 3%?', 'Now do it with churn of 2%.', 'And at 8%?']) {
      const r = ask(q, CHART_ON_TABLE);
      assert.deepEqual([r.enabled, r.operation, r.parentArtifactId], [true, 'update', 'design-2.v1'], q);
    }
  });
});

describe('the names of the visuals as people hyphenate them', async () => {
  const { resolveDiagramRequest } = await import('../diagramRequest.mjs');
  const view = (question) => resolveDiagramRequest({ question, featureEnabled: true, mode: 'general' }).view;

  test('mind-map, state-machine, flow-chart, sequence-diagram, decision-tree', () => {
    assert.equal(view('Draw a mind-map of the topics.'), 'mindmap');
    assert.equal(view('Draw a state-machine for orders'), 'state');
    assert.equal(view('Draw a flow-chart of the refund process'), 'flowchart');
    assert.equal(view('Draw a sequence-diagram of the login'), 'sequence');
    assert.equal(view('Draw a decision-tree for the outage'), 'decision');
  });

  test('"break-even" keeps its hyphen and its meaning', () => {
    const r = resolveDiagramRequest({ question: 'Show the break-even over eight months.', featureEnabled: true, mode: 'sales' });
    assert.deepEqual([r.enabled, r.view, r.chartIntent], [true, 'chart', 'breakeven']);
  });
});

// ── the second review (2026-10-02) ──────────────────────────────────────────
// Sentences the rules had never seen. See tests/diagram/review-round2.mjs.
describe('the second review: sentences the rules were not written against', async () => {
  const R2 = await import('../../../../tests/diagram/review-round2.mjs');
  const { resolveDiagramRequest } = await import('../diagramRequest.mjs');
  const ask = (question, extra = {}) => resolveDiagramRequest({ question, featureEnabled: true, mode: 'general', ...extra });
  const background = (design) => ({ ...design, foreground: false });

  test('a statement, an idiom or a question about a thing asks for no drawing — in any mode', () => {
    const wrong = [];
    for (const mode of ['general', 'sales', 'recruiting', 'team-meet', 'technical-interview', 'looking-for-work', 'call-center', 'lecture', 'seminar', 'custom', undefined]) {
      for (const q of R2.NOT_REQUESTS) if (ask(q, { mode }).enabled) wrong.push(`${mode}: ${q}`);
    }
    assert.deepEqual(wrong, []);
  });

  test('a request for a drawing gets one, however it is led into', () => {
    const wrong = [];
    for (const q of R2.REQUESTS) {
      const r = ask(q);
      if (!r.enabled || r.output === 'text-only') wrong.push(`${q} → ${r.enabled ? r.output : 'off'} (${r.reason})`);
    }
    assert.deepEqual(wrong, []);
  });

  test('"plot y = …" and "graph the function …" are computed curves; "graph revenue by quarter" is a chart of data', () => {
    for (const q of ['Plot y = x^2 from -3 to 3.', 'Can you plot y = sin(x)?', 'Graph the function sin(x).']) {
      const r = ask(q);
      assert.deepEqual([r.view, r.chartIntent, r.basis], ['chart', 'function', 'calculated'], q);
    }
    assert.deepEqual([ask('Graph revenue by quarter.').view, ask('Graph revenue by quarter.').chartIntent], ['chart', 'generic']);
  });

  test('a question ABOUT a thing draws nothing unasked; the task itself still does', () => {
    for (const [q, mode] of R2.ABOUT_NOT_FOR) assert.equal(ask(q, { mode }).enabled, false, `${mode}: ${q}`);
    for (const [q, mode] of R2.STILL_IMPLIED) assert.equal(ask(q, { mode }).contextual, true, `${mode}: ${q}`);
  });

  test('with an artifact in focus, what is said about something else is not a follow-up', () => {
    const wrong = [];
    for (const [name, design] of [['architecture', R2.ORDER_SYSTEM], ['chart', R2.FORECAST_CHART], ['data model', R2.ORDER_MODEL], ['architecture, background', background(R2.ORDER_SYSTEM)]]) {
      for (const q of R2.UNRELATED_IN_FOCUS) if (ask(q, { activeDesign: design }).enabled) wrong.push(`${name}: ${q}`);
    }
    for (const q of R2.NOT_ABOUT_THE_CHART) if (ask(q, { activeDesign: R2.FORECAST_CHART, mode: 'sales' }).enabled) wrong.push(`chart (sales): ${q}`);
    assert.deepEqual(wrong, []);
  });

  test('real follow-ups are recognised, each as the right kind', () => {
    const wrong = [];
    const check = (list, design, name) => {
      for (const [q, operation] of list) {
        const r = ask(q, { activeDesign: design });
        if (!r.enabled || r.parentArtifactId !== design.artifactId || r.operation !== operation) wrong.push(`${name}: ${q} → ${r.enabled ? r.operation : 'off'} (${r.reason})`);
      }
    };
    check(R2.ARCHITECTURE_FOLLOW_UPS, R2.ORDER_SYSTEM, 'architecture');
    check(R2.CHART_FOLLOW_UPS, R2.FORECAST_CHART, 'chart');
    check(R2.MODEL_FOLLOW_UPS, R2.ORDER_MODEL, 'data model');
    assert.deepEqual(wrong, []);
  });

  test('a chart that is only reshaped keeps its kind and its basis', () => {
    for (const q of ['Make it a bar chart.', 'Show it as a bar chart.', 'Switch to a line chart']) {
      const r = ask(q, { activeDesign: R2.FORECAST_CHART, mode: 'sales' });
      assert.deepEqual([r.operation, r.chartIntent, r.basis], ['update', 'forecast', 'scenario'], q);
    }
  });

  test('another KIND of drawing of the same thing is a view of it, not an edit that keeps every node', () => {
    for (const [q, view] of [['Change this to a sequence diagram.', 'sequence'], ['Turn it into a sequence diagram.', 'sequence'], ['Convert this to Chen notation.', 'chen']]) {
      const r = ask(q, { activeDesign: R2.ORDER_SYSTEM });
      assert.deepEqual([r.operation, r.view, r.parentArtifactId, r.attachActiveDesign], ['create', view, 'design-1.v1', true], q);
    }
  });

  test('on a coding route a component word is a variable unless it is being changed as a component', () => {
    for (const [q, followsUp] of R2.CODING_WITH_A_DESIGN) {
      assert.equal(ask(q, { activeDesign: R2.ORDER_SYSTEM, answerType: 'coding_question_answer', mode: 'technical-interview' }).enabled, followsUp, q);
    }
  });

  test('the router saying "system design" never restarts a design that is on the table', () => {
    for (const [q, inFocus, operation] of R2.ROUTE_SAYS_DESIGN) {
      const design = inFocus ? R2.ORDER_SYSTEM : background(R2.ORDER_SYSTEM);
      const r = ask(q, { activeDesign: design, answerType: 'system_design_answer', mode: 'technical-interview' });
      assert.equal(r.operation, operation, q);
      assert.equal(Boolean(r.parentArtifactId), operation !== 'create', q);
    }
  });
});


// ── the held-out measurement (2026-10-02) ───────────────────────────────────
// 501 sentences by a reviewer who had not seen the rules. See the header of
// tests/diagram/heldout-2026-10-02.mjs for what it scored when it WAS held out.
describe('the sentences of the held-out measurement, now regression data', async () => {
  const { LISTS } = await import('../../../../tests/diagram/heldout-2026-10-02.mjs');
  const { resolveDiagramRequest } = await import('../diagramRequest.mjs');

  const judge = (expect, out, activeDesign) => {
    const enabled = out.enabled === true;
    if (expect === 'no') return !enabled && !out.parentArtifactId;
    if (expect === 'draw') return enabled;
    if (expect === 'ctx') return enabled && out.contextual === true;
    const ops = expect.slice('claim:'.length).split('|');
    const claimed = enabled && out.parentArtifactId === activeDesign.artifactId;
    return claimed && (ops.includes('any') ? out.operation !== 'none' : ops.includes(out.operation) || ops.includes('refine') && out.operation === 'update');
  };

  // Lookups: "what's the X?" is answered in words, not drawn unasked.
  const DELIBERATE = new Set(["What's the critical path for the release?", "What's the escalation path for a billing dispute?"]);
  // Operation only: an explicit redraw of the design is a new drawing of it.
  const OPERATION_ONLY = new Set(['Could you redraw the architecture left to right?']);

  for (const list of LISTS) {
    test(`${list.id} ${list.name} (${list.rows.length})`, () => {
      const wrong = [];
      for (const [question, mode, expect] of list.rows) {
        const input = { question, featureEnabled: true, mode };
        if (list.activeDesign) input.activeDesign = list.activeDesign;
        if (list.answerType) input.answerType = list.answerType;
        const out = resolveDiagramRequest(input);
        if (judge(expect, out, list.activeDesign) || DELIBERATE.has(question)) continue;
        if (OPERATION_ONLY.has(question) && out.enabled && out.parentArtifactId) continue;
        wrong.push(`${question} → ${out.enabled ? out.operation : 'off'} (${out.reason}); wanted ${expect}`);
      }
      assert.deepEqual(wrong, []);
    });
  }

  test('the two deliberate exceptions are still exceptions (a lookup is answered in words)', () => {
    for (const q of DELIBERATE) assert.equal(resolveDiagramRequest({ question: q, featureEnabled: true, mode: 'team-meet' }).enabled, false, q);
  });
});

// A starred group of overlapping lead-ins ("could you please" is one prefix or
// two) took time doubling with every repetition: 12 seconds on 476 characters.
describe('no input makes the decision slow', async () => {
  const { resolveDiagramRequest } = await import('../diagramRequest.mjs');
  const ARCH = { artifactId: 'a.v1', artifact: 'mermaid', view: 'architecture', version: 1, foreground: true, source: 'flowchart LR\n    a["API Gateway"] --> b["Order Service"]\n    b --> c["Notification Queue"]' };
  const CHART = { artifactId: 'c.v1', artifact: 'chart', view: 'chart', version: 1, foreground: true, source: '{"v":1,"type":"line","title":"Revenue","compute":{"kind":"compound_growth","baseline":10000,"ratePercent":5,"period":"month","periods":6}}' };
  const PHRASES = [
    'could you please ', 'can you just ', 'we need to ', 'i think we should ', 'would you also ', 'can you please please ', 'what if we ', 'how about we ',
    "i'd like you to ", 'okay so now ', 'please kindly just ', 'hey, first, ', "let's just ", 'draw ', 'show me a ', 'design a ', 'add a ', 'make it ', 'the the ',
    'a ', ' ', ',', '12% ', 'and then ', 'someone please ', 'i would ', 'we should also ', 'why why ', 'how does this ', 'walk me through ', 'x', 'as a diagram ',
    'with a chart, ', 'timeline of ', 'plot y = x ', 'in the diagram, ', '. ', '? ', 'the diagram, ', 'what is the ', 'compare ', 'how do the a, b and c ',
  ];

  test(`2,400 characters of one phrase, ${PHRASES.length} phrases, four contexts: each under 250 ms`, () => {
    resolveDiagramRequest({ question: 'warm up', featureEnabled: true });
    let worst = [0, ''];
    for (const phrase of PHRASES) {
      const text = phrase.repeat(Math.ceil(2400 / phrase.length)).slice(0, 2400);
      for (const extra of [{}, { activeDesign: ARCH }, { activeDesign: CHART, mode: 'sales' }, { activeDesign: ARCH, answerType: 'coding_question_answer' }]) {
        const started = performance.now();
        resolveDiagramRequest({ question: text, featureEnabled: true, mode: 'general', material: text, ...extra });
        const ms = performance.now() - started;
        if (ms > worst[0]) worst = [ms, phrase];
      }
    }
    assert.ok(worst[0] < 250, `${JSON.stringify(worst[1])}: ${worst[0].toFixed(0)} ms`);
  });
});

// ── the second held-out measurement (2026-10-02) ────────────────────────────
// 675 sentences by another reviewer who had seen neither the rules nor the
// first measurement. Frozen (SHA-256 0232fc72…ae0b) before the rules were run:
// 353 of 357 "must not" lines right (1.1% wrong), 259 of 318 "must" lines
// right (18.6% missed), nothing slow. Its misses drove the fourth pass
// (speech-to-text noise, spelled-out numbers, data-model follow-ups, tasks
// asked as questions). Now regression data.
describe('the sentences of the second held-out measurement, now regression data', async () => {
  const { readFileSync } = await import('node:fs');
  const data = JSON.parse(readFileSync(new URL('../../../../tests/diagram/heldout-2-2026-10-02.json', import.meta.url), 'utf8'));
  const { resolveDiagramRequest } = await import('../diagramRequest.mjs');
  const fx = data.fixtures;
  const context = {
    none: () => ({}),
    arch: () => ({ activeDesign: { ...fx.arch, foreground: true } }),
    'arch-bg': () => ({ activeDesign: { ...fx.arch, foreground: false } }),
    'arch-coding': () => ({ activeDesign: { ...fx.arch, foreground: true }, answerType: 'coding_question_answer' }),
    chart: () => ({ activeDesign: { ...fx.chart, foreground: true } }),
    er: () => ({ activeDesign: { ...fx.er, foreground: true } }),
  };
  const LISTS = {
    L1_noartifact_no: ['none', 'no'], L2_noartifact_draw: ['none', 'draw'], L3_arch_focus_unclaimed: ['arch', 'unclaimed'], L4_arch_focus_claim: ['arch', 'claim'],
    L5a_chart_focus_unclaimed: ['chart', 'unclaimed'], L5b_chart_focus_claim: ['chart', 'claim'], L6a_er_focus_unclaimed: ['er', 'unclaimed'], L6b_er_focus_claim: ['er', 'claim'],
    L7a_arch_background_unclaimed: ['arch-bg', 'unclaimed'], L7b_arch_background_claim: ['arch-bg', 'claim'], L8a_coding_arch_focus_unclaimed: ['arch-coding', 'unclaimed'],
    L8b_coding_arch_focus_claim: ['arch-coding', 'claim'], L9a_contextual: ['none', 'contextual'], L9b_contextual_no: ['none', 'no'],
  };
  const judge = (expect, out) => {
    const claimed = Boolean(out.parentArtifactId);
    if (expect === 'no') return out.enabled === false && !claimed;
    if (expect === 'draw') return out.enabled === true;
    if (expect === 'unclaimed') return !claimed && !(out.enabled && out.operation !== 'create');
    if (expect === 'claim') return claimed && out.enabled === true;
    // Drawn is what matters; whether the verb made it "explicit" is a detail ("lay out the phases …").
    return out.enabled === true;
  };
  // Left as they are, each for a stated reason.
  const DELIBERATE = new Map([
    ['What would you change if the budget were halved?', 'nothing in the words refers to the design'],
    ['Show me the SQL for these tables.', 'a request for code'],
    ['For the system we designed, where would the cache go?', '"the system" is not a name for the design once the conversation has moved on'],
    ['Walk me through the steps of your procurement process.', 'said to a person about their own process: theirs to answer (the reviewer withdrew this label)'],
    ['How many seats do they need for the tool to pay for itself at 40 dollars a seat versus the 5,000 they spend now?', 'a lookup (the reviewer withdrew this label)'],
  ]);

  const run = (name, rows, ctx, expect) => {
    const wrong = [];
    for (const row of rows) {
      const [q, mode] = Array.isArray(row) ? row : [row.q, row.mode];
      const out = resolveDiagramRequest({ question: q, featureEnabled: true, mode, ...context[Array.isArray(row) ? ctx : row.ctx]() });
      const want = Array.isArray(row) ? expect : row.expect;
      if (!judge(want, out) && !DELIBERATE.has(q)) wrong.push(`${q} → ${out.enabled ? out.operation : 'off'} (${out.reason}); wanted ${want}`);
    }
    return wrong;
  };

  for (const [name, [ctx, expect]] of Object.entries(LISTS)) {
    test(`${name} (${data[name].length})`, () => assert.deepEqual(run(name, data[name], ctx, expect), []));
  }
  test(`speech-to-text style (${data.L10_speech.length})`, () => assert.deepEqual(run('L10_speech', data.L10_speech), []));

  test('none of it draws or claims where it must not', () => {
    for (const [name, [ctx, expect]] of Object.entries(LISTS)) {
      if (expect !== 'no' && expect !== 'unclaimed') continue;
      for (const [q, mode] of data[name]) {
        const out = resolveDiagramRequest({ question: q, featureEnabled: true, mode, ...context[ctx]() });
        assert.ok(judge(expect, out), `${name}: ${q}`);
      }
    }
  });
});

describe('what a live transcript does to a sentence is undone before the rules read it', async () => {
  const { resolveDiagramRequest } = await import('../diagramRequest.mjs');
  const ask = (question, extra = {}) => resolveDiagramRequest({ question, featureEnabled: true, mode: 'general', ...extra });

  test('fillers, repeated words, false starts and dropped apostrophes', () => {
    for (const q of [
      'um can you like draw out the the login flow for me',
      'okay so uh design a design a no sorry design a video streaming service like netflix',
      'so um id like to see like an er diagram for uh a school you know students teachers classes',
      'okay lets um lets do a sequence diagram of how the the checkout talks to the payment provider',
    ]) {
      assert.equal(ask(q, { mode: 'technical-interview' }).enabled, true, q);
    }
  });

  test('"er" is a diagram, not a filler', () => {
    assert.equal(ask('Draw an ER diagram for a library').view, 'er');
    assert.equal(ask('What is the ER diagram for a library system?').view, 'er');
  });

  test('"what kind of chart" and "some sort of queue" are not hedges', () => {
    const design = { artifactId: 'd.v1', artifact: 'mermaid', view: 'architecture', version: 1, foreground: true, source: 'flowchart LR\n    a["API Gateway"] --> b["Order Service"]' };
    assert.equal(ask('Add some sort of queue between them', { activeDesign: design }).operation, 'update');
  });

  test('ordinary talk with the same noise still draws nothing', () => {
    for (const q of ['um so yeah we kind of drew the line at like three revisions and they still wanted more', 'so so like i mean the chart was fine you know', 'uh the the timeline is is tight sorry I mean really tight']) {
      assert.equal(ask(q).enabled, false, q);
    }
  });
});

// ── the third held-out measurement (2026-10-02) ─────────────────────────────
// 509 sentences by a third reviewer, with fixtures of their own (a clinic
// scheduling system, a sequence diagram), frozen before the rules were run
// (SHA-256 e2358e15…fc4d): 255 of 262 "must not" lines right (2.7% wrong; 1.2%
// without the rows the reviewer marked borderline), 215 of 247 "must" lines
// right (13.0% missed), nothing over 100 ms. Now regression data.
describe('the sentences of the third held-out measurement, now regression data', async () => {
  const { ROWS, FIXTURES } = await import('../../../../tests/diagram/heldout-3-2026-10-02.mjs');
  const { resolveDiagramRequest } = await import('../diagramRequest.mjs');
  const run = (row) => resolveDiagramRequest({
    question: row.q,
    featureEnabled: true,
    mode: row.mode,
    ...(row.ctx !== 'none' ? { activeDesign: { ...FIXTURES[row.ctx] } } : {}),
    ...(row.coding ? { answerType: 'coding_question_answer' } : {}),
  });
  const right = (row, out) => {
    const claimed = Boolean(out.parentArtifactId);
    if (row.expect === 'draw') return out.enabled === true;
    if (row.expect === 'nodraw') return out.enabled !== true;
    if (row.expect === 'claim') return out.enabled === true && claimed;
    return !claimed;
  };
  // Left as they are, each for a stated reason.
  const DELIBERATE = new Map([
    ['Show me the SQL for these tables.', 'a request for code'],
    ['Is the lock released after the insert?', 'two everyday words of the diagram in a yes-or-no question: the same shape as "is the payment due before the order ships?"'],
    ['Lay out the steps of the scientific method.', '"lay out" asks for it to be laid out, in any mode (the reviewer marked this borderline)'],
  ]);
  // The operation the reviewer expected, where the rules deliberately differ.
  const OTHER_OPERATION = new Map([
    ['How would this scale to ten million patients?', 'update: asked of the design, it is redrawn for that scale'],
    ['Show the failure case where the database times out.', 'create: another view of the same diagram, never an edit of it'],
  ]);

  for (const expect of ['nodraw', 'noclaim', 'draw', 'claim']) {
    const rows = ROWS.filter((row) => row.expect === expect);
    test(`${expect} (${rows.length})`, () => {
      const wrong = [];
      for (const row of rows) {
        const out = run(row);
        if (!right(row, out) && !DELIBERATE.has(row.q)) wrong.push(`#${row.id} ${row.q} → ${out.enabled ? out.operation : 'off'} (${out.reason})`);
      }
      assert.deepEqual(wrong, []);
    });
  }

  test('a follow-up comes back as the operation it is', () => {
    const wrong = [];
    for (const row of ROWS) {
      if (row.expect !== 'claim' || !row.op || DELIBERATE.has(row.q) || OTHER_OPERATION.has(row.q)) continue;
      const out = run(row);
      if (out.operation !== row.op) wrong.push(`#${row.id} ${row.q} → ${out.operation}, wanted ${row.op}`);
    }
    assert.deepEqual(wrong, []);
  });

  test('the exceptions are still exceptions (a rule that starts meeting one should drop it from the list)', () => {
    for (const row of ROWS) {
      if (DELIBERATE.has(row.q)) assert.equal(right(row, run(row)), false, row.q);
    }
  });
});

describe('what the third measurement found', async () => {
  const { resolveDiagramRequest } = await import('../diagramRequest.mjs');
  const arch = { artifactId: 'd.v1', artifact: 'mermaid', view: 'architecture', version: 1, foreground: true, source: 'flowchart LR\n    app["Patient App"] --> gw["API Gateway"]\n    gw --> appt["Appointment Service"]\n    appt --> db[("Scheduling Database")]\n    appt --> q["Reminder Queue"]' };
  const chart = { artifactId: 'c.v1', artifact: 'chart', view: 'chart', version: 1, foreground: true, source: '{"v":1,"type":"line","title":"Bookings","compute":{"kind":"compound_growth","baseline":48000,"ratePercent":3,"period":"month","periods":18}}' };
  const ask = (question, activeDesign, mode = 'team-meet') => resolveDiagramRequest({ question, featureEnabled: true, mode, ...(activeDesign ? { activeDesign } : {}) });

  test('a number at the head of a sentence about something else does not redraw the chart', () => {
    for (const q of [
      'Can you do 20 percent off if we sign this week?',
      'Over 18 months we hired forty people.',
      'For 12 months I worked in Berlin.',
      'With 5 percent of the team out sick we are behind.',
    ]) {
      assert.equal(Boolean(ask(q, chart, 'sales').parentArtifactId), false, q);
    }
    for (const q of ['Over 24 months instead.', 'Run it for twelve months only.', 'What if we grow twice as fast?', 'Start from fifteen thousand instead of twelve and a half.', 'Bump it up to four and a half percent.', 'Shorten the horizon to a year and a half.', 'Do it quarterly instead of monthly.']) {
      const out = ask(q, chart, 'sales');
      assert.equal(out.operation, 'update', q);
      assert.equal(out.parentArtifactId, 'c.v1', q);
    }
  });

  test('an edit that goes somewhere else is not an edit of the diagram, whatever word of the diagram it holds', () => {
    for (const q of [
      'Add a reminder for me to email finance.',
      'Add Sarah to the patient advisory panel invite.',
      'Add a step to the onboarding checklist for badge pickup.',
    ]) {
      assert.equal(Boolean(ask(q, arch).parentArtifactId), false, q);
    }
    for (const q of ['Add the reminder queue too.', 'Add a cache to the appointment service.', 'Add a queue to the left of the gateway.', 'Move the reminder queue to the scheduling database side.']) {
      assert.equal(ask(q, arch).operation, 'update', q);
    }
  });

  test('"we don\'t need it" after an edit is a reason, not "no diagram"', () => {
    const out = ask("Drop the reminder queue, we don't need it for the MVP.", arch);
    assert.equal(out.operation, 'update');
    assert.notEqual(out.output, 'text-only');
    assert.equal(ask("I don't need a diagram, just tell me how the queue works.", arch).output, 'text-only');
    assert.equal(ask("Don't draw it, just explain the reminder queue.", arch).output, 'text-only');
  });

  test('a view asked for in other words, of the design on the table', () => {
    for (const [q, view] of [
      ['Can you give me the data model for this?', 'er'],
      ['Can I see the database schema for the scheduling database?', 'er'],
      ['Show me the database schema for the scheduling database.', 'er'],
      ['Give me a table of the components and their responsibilities.', 'matrix'],
      ['Can you show me the sequence for booking?', 'sequence'],
    ]) {
      const out = ask(q, arch, 'technical-interview');
      assert.equal(out.operation, 'create', q);
      assert.equal(out.view, view, q);
      assert.equal(out.parentArtifactId, 'd.v1', q);
    }
    assert.equal(ask("Let's see the deployment view of this architecture.", arch).parentArtifactId, 'd.v1');
    // A behaviour of ANOTHER system is its own drawing.
    assert.equal(Boolean(ask('Draw the sequence for logging in to a banking app.', arch).parentArtifactId), false);
  });

  test('requests said with "I\'d like", "would you mind putting together", "take me through"', () => {
    assert.equal(ask("I'd like a CDN in front of the patient app.", arch).operation, 'update');
    assert.equal(ask('Would you mind putting together a comparison table of the three vendors?', null, 'sales').enabled, true);
    assert.equal(ask('Take me through the stages a refund goes through before it hits the card.', null, 'call-center').enabled, true);
    assert.equal(ask('Walk me through the escalation stages for a chargeback.', null, 'call-center').enabled, true);
    assert.equal(ask('Which tasks depend on which for the Q3 launch?', null, 'team-meet').enabled, true);
    assert.equal(ask('Where in the pipeline are candidates dropping out?', null, 'recruiting').enabled, true);
    // The same shapes in a lecture, and about the person spoken to, stay words.
    assert.equal(ask('Take me through the stages of mitosis.', null, 'lecture').enabled, false);
    assert.equal(ask('Take me through the stages of your interview process.', null, 'sales').enabled, false);
  });

  test('a topic-first question, and one after a dash, still asks about the part it names', () => {
    const bg = { ...arch, foreground: false };
    assert.equal(ask('the the scheduling database is that a single point of failure', bg).operation, 'explain');
    assert.equal(ask("Back to the architecture — where's the bottleneck?", bg).operation, 'explain');
    // Asked in general once the conversation has moved on, it is a general question.
    assert.equal(Boolean(ask('What is an API gateway?', bg).parentArtifactId), false);
  });

  test('"whats whats blocking what": a doubled word is collapsed before its apostrophe is restored', () => {
    assert.equal(ask('whats whats blocking what on the release').enabled, true);
  });
});

// ── the fourth held-out measurement (2026-10-02) ────────────────────────────
// 456 sentences by a fourth reviewer (a greenhouse monitoring system, a claim
// state machine, an office-move Gantt chart; turns of several sentences),
// frozen before the rules were run (SHA-256 58e3ebb6…fe40): 215 of 222 "must
// not" lines right (3.2% wrong), 188 of 234 "must" lines right (19.7% missed),
// nothing over 100 ms. Now regression data.
describe('the sentences of the fourth held-out measurement, now regression data', async () => {
  const { ROWS, FIXTURES } = await import('../../../../tests/diagram/heldout-4-2026-10-02.mjs');
  const { resolveDiagramRequest } = await import('../diagramRequest.mjs');
  const run = (row) => resolveDiagramRequest({
    question: row.q,
    featureEnabled: true,
    mode: row.mode,
    ...(row.ctx !== 'none' ? { activeDesign: { ...FIXTURES[row.ctx] } } : {}),
    ...(row.coding ? { answerType: 'coding_question_answer' } : {}),
  });
  const right = (row, out) => {
    const claimed = Boolean(out.parentArtifactId);
    if (row.expect === 'draw') return out.enabled === true;
    if (row.expect === 'nodraw') return out.enabled !== true;
    if (row.expect === 'claim') return out.enabled === true && claimed;
    return !claimed && out.enabled !== true;
  };
  // Left as they are, each for a stated reason.
  const DELIBERATE = new Map([
    ['What is a message queue, in general terms?', 'with a queue on the table and in focus, the answer may use it (the reviewer marked this borderline)'],
    ['Zoom in on the ingestion path and draw just that.', 'drawn, as a fresh request (the reviewer marked this borderline)'],
    ['What would you change to make it cheaper to run?', 'a pronoun and nothing a design is discussed in (the reviewer marked this borderline)'],
    ['I spoke to finance this morning. Make it 5% instead of 4.', 'a pronoun-only follow-up straight after a sentence about a person or a calendar is not taken'],
    ['Can you add a line to the minutes about the budget? The architecture can wait.', 'the design is named, so the answer is given with it attached; it is NOT redrawn, because the edit goes to the minutes (the reviewer marked this borderline)'],
    ["Who's waiting on whom for the launch — design, legal, and engineering?", 'unasked visuals stay conservative (the reviewer marked this borderline)'],
    ['Lay out the stages of the French Revolution in order.', '"lay out" asks for it to be laid out, in any mode'],
  ]);
  const OTHER_OPERATION = new Map([
    ['How would this scale to ten thousand greenhouses?', 'update: asked of the design, it is redrawn for that scale'],
    ['Make it more detailed.', 'refine: read as an instruction about the answer'],
  ]);

  for (const expect of ['nodraw', 'noclaim', 'draw', 'claim']) {
    const rows = ROWS.filter((row) => row.expect === expect);
    test(`${expect} (${rows.length})`, () => {
      const wrong = [];
      for (const row of rows) {
        const out = run(row);
        if (!right(row, out) && !DELIBERATE.has(row.q)) wrong.push(`#${row.id} ${row.q} → ${out.enabled ? out.operation : 'off'} (${out.reason})`);
      }
      assert.deepEqual(wrong, []);
    });
  }

  test('a follow-up comes back as the operation it is', () => {
    const wrong = [];
    for (const row of ROWS) {
      if (row.expect !== 'claim' || !row.op || DELIBERATE.has(row.q) || OTHER_OPERATION.has(row.q)) continue;
      const out = run(row);
      if (out.operation !== row.op) wrong.push(`#${row.id} ${row.q} → ${out.operation}, wanted ${row.op}`);
    }
    assert.deepEqual(wrong, []);
  });

  test('the exceptions are still exceptions', () => {
    for (const row of ROWS) {
      if (DELIBERATE.has(row.q)) assert.equal(right(row, run(row)), false, row.q);
    }
  });
});

describe('what the fourth measurement found', async () => {
  const { resolveDiagramRequest, designVocabulary } = await import('../diagramRequest.mjs');
  const arch = { artifactId: 'd.v1', artifact: 'mermaid', view: 'architecture', version: 1, foreground: true, source: 'flowchart LR\n    s["Sensor Gateway"] --> q["Ingest Queue"]\n    q --> t[("Time Series Store")]\n    t --> d["Grower Dashboard"]' };
  const chartSource = '{"v":1,"type":"line","title":"Subscribers","compute":{"kind":"compound_growth","baseline":48000,"ratePercent":4,"period":"month","periods":18}}';
  const chart = { artifactId: 'c.v1', artifact: 'chart', view: 'chart', version: 1, foreground: true, source: chartSource };
  const state = { artifactId: 's.v1', artifact: 'mermaid', view: 'state', version: 1, foreground: true, source: 'stateDiagram-v2\n    [*] --> Submitted\n    Submitted --> UnderReview\n    UnderReview --> Approved\n    UnderReview --> Rejected\n    Rejected --> Appealed\n    Appealed --> UnderReview\n    Approved --> PaidOut\n    PaidOut --> [*]' };
  const gantt = { artifactId: 'g.v1', artifact: 'mermaid', view: 'gantt', version: 1, foreground: true, source: 'gantt\n    title Office move\n    dateFormat YYYY-MM-DD\n    section Build\n    Fit-out :a1, 2026-04-01, 30d\n    Network Cabling :a2, after a1, 14d\n    section Move\n    Furniture Delivery :b1, after a2, 7d\n    Old Office Handback :b2, after b1, 5d' };
  const ask = (question, activeDesign, mode = 'team-meet') => resolveDiagramRequest({ question, featureEnabled: true, mode, ...(activeDesign ? { activeDesign } : {}) });

  test('a turn of several sentences: each is heard when the turn as a whole asks for nothing', () => {
    for (const [q, design, operation] of [
      ['Okay, that makes sense. Add a cache in front of the Time Series Store.', arch, 'update'],
      ['Sorry, my dog is barking. Why do we need the Ingest Queue at all?', arch, 'explain'],
      ['Right. Add a Withdrawn state after Submitted. Then we can break for coffee.', state, 'update'],
      ['Drop the rate to three. Actually, also, can you email me the deck afterwards?', chart, 'update'],
      ['Okay I see it. How long until it doubles? Roughly is fine.', chart, 'explain'],
    ]) {
      const out = ask(q, design);
      assert.equal(out.operation, operation, q);
      assert.equal(out.parentArtifactId, design.artifactId, q);
    }
    assert.equal(ask('So that covers the causes. Now, timeline of the main events from 1789 to 1799, please.', null, 'lecture').view, 'timeline');
    assert.equal(ask('Sorry I am late, traffic was awful. Where were we? Right — plot monthly revenue of 10, 12, 15 and 19 thousand as a line chart.', null, 'sales').view, 'chart');
  });

  test('…and a turn of several sentences that asks for nothing still asks for nothing', () => {
    for (const q of [
      'Thanks for joining. We drew the short straw on the venue. Anyway, how was the weekend?',
      'The chart in the deck was wrong. I already told marketing. What time is lunch?',
      'My shift moved again. Can you move it back?',
      'I saw the diagram they sent. It was fine. Did you get my email?',
    ]) {
      assert.equal(ask(q, chart, 'sales').enabled, false, q);
    }
    // "No diagram" said anywhere in the turn still holds for all of it.
    assert.notEqual(ask('No diagram please. Just tell me why we need the Ingest Queue.', arch).output, 'text-and-diagram');
  });

  test('a schedule is edited and asked about in its own words', () => {
    for (const q of ['Push Furniture Delivery back by a week.', 'Start the whole plan two weeks earlier.', 'Shorten cabling to a week and a half.']) {
      assert.equal(ask(q, gantt).operation, 'update', q);
    }
    for (const q of ["What's on the critical path?", 'Which tasks overlap in May?', 'How long is the whole project?', 'Is there any slack between the fit-out and the cabling?']) {
      assert.equal(ask(q, gantt).operation, 'explain', q);
    }
    // The same words about something that is not the schedule.
    for (const q of ['Push the dentist to next week.', 'Is there any slack in the budget?', 'Start the call without me.', 'Postpone my review to Friday.']) {
      assert.equal(Boolean(ask(q, gantt).parentArtifactId), false, q);
    }
  });

  test('a state machine is asked about in its own words', () => {
    for (const q of ['Can a claim go from Submitted directly to Approved?', 'Which states are terminal?', 'Explain the appeal loop.', 'How many states are there in total?']) {
      assert.equal(ask(q, state).operation, 'explain', q);
    }
    assert.equal(ask('Give me the class diagram that would implement this.', state).view, 'class');
    assert.equal(Boolean(ask('What state is the kitchen in after the party?', state, 'general').parentArtifactId), false);
    assert.equal(Boolean(ask('Remove the paid tier from the comparison slide.', state, 'sales').parentArtifactId), false);
  });

  test('a chart is not named by its own machinery, or by a rate of something else', () => {
    assert.equal(designVocabulary(chartSource).has('compound'), false);
    assert.equal(designVocabulary(chartSource).has('line'), false);
    const bg = { ...chart, foreground: false };
    for (const q of ['How many months of runway do we have?', "What's the growth plan for the Berlin office?", 'How many months until the kids go back to school?']) {
      assert.equal(Boolean(ask(q, bg, 'sales').parentArtifactId), false, q);
    }
    for (const q of ["What's the VAT rate in Germany, is it 19%?", 'The interest rate on the loan, is it 7%?']) {
      assert.equal(Boolean(ask(q, chart, 'sales').parentArtifactId), false, q);
    }
    assert.equal(ask('Why is the last month higher?', chart, 'sales').operation, 'explain');
    assert.equal(ask('In the chart, start from 15,000 instead.', bg, 'sales').operation, 'update');
    assert.equal(ask('Now the same thing but at one percent a month.', chart, 'sales').operation, 'update');
    assert.equal(ask('Put the numbers in a table as well.', chart, 'sales').parentArtifactId, 'c.v1');
  });

  test('a transcript without commas still finds the request after the artifact is named', () => {
    const bg = { ...arch, foreground: false };
    assert.equal(ask('so on the diagram uh add a cache next to the dashboard', bg).operation, 'update');
    assert.equal(ask('going back to the architecture um why is there a a queue', bg).operation, 'explain');
    assert.equal(ask('remove the the ingest queue i dont i dont think we need it', arch).operation, 'update');
    assert.equal(ask('run it for for like a year and a half', chart, 'sales').operation, 'update');
  });

  test('other forms the fourth set asked in', () => {
    assert.equal(ask('State machine for a vending machine, please.', null, 'general').enabled, true);
    assert.equal(ask('Can you please to draw the flow how the ticket is escalated?', null, 'call-center').enabled, true);
    assert.equal(ask('Draw the deployment view of the same system.', arch).parentArtifactId, 'd.v1');
    assert.equal(ask('Does the dashboard read straight from the store?', arch).operation, 'explain');
    assert.equal(ask('Give me the break-even on a 30k implementation fee against 4k monthly savings.', null, 'sales').enabled, true);
    assert.equal(ask('Where do candidates drop off between the phone screen and the on-site?', null, 'recruiting').enabled, true);
  });

  test('many short sentences are not slow', () => {
    for (const unit of ['a. ', 'Okay. Add a cache. ', 'Right. Why? ', 'can you. draw it. ']) {
      const q = unit.repeat(Math.ceil(2400 / unit.length));
      const started = performance.now();
      ask(q, arch);
      assert.ok(performance.now() - started < 400, `${JSON.stringify(unit)} took ${Math.round(performance.now() - started)} ms`);
    }
  });
});

// ── the fifth held-out measurement (2026-10-02): the final one ──────────────
// 451 sentences by a fifth reviewer (a public-library lending system: an
// architecture, a forecast, an ER diagram, a state diagram), frozen before the
// rules were run (SHA-256 41a44a45…00a2): 212 of 224 "must not" lines right
// (5.4% wrong; 3.7% without the rows marked borderline), 203 of 227 "must"
// lines right (10.6% missed), nothing over 100 ms. That is the figure for the
// rules as they stood before this set was seen.
//
// Afterwards the false claims that would have REDRAWN a diagram were fixed (an
// edit is judged by its own object: "remove the HOLD music", "put the caller
// ON HOLD", "I need a COPY of the signed contract", "remove Dan from the EMAIL
// thread"), with a few cheap misses. The rows below are still wrong, and are
// listed as what they are: known misses, not decisions.
describe('the sentences of the fifth held-out measurement, now regression data', async () => {
  const { ROWS, FIXTURES } = await import('../../../../tests/diagram/heldout-5-2026-10-02.mjs');
  const { resolveDiagramRequest } = await import('../diagramRequest.mjs');
  const run = (row) => resolveDiagramRequest({
    question: row.q,
    featureEnabled: true,
    mode: row.mode,
    ...(row.ctx !== 'none' ? { activeDesign: { ...FIXTURES[row.ctx] } } : {}),
    ...(row.coding ? { answerType: 'coding_question_answer' } : {}),
  });
  const right = (row, out) => {
    const claimed = Boolean(out.parentArtifactId);
    if (row.expect === 'draw') return out.enabled === true;
    if (row.expect === 'nodraw') return out.enabled !== true;
    if (row.expect === 'claim') return out.enabled === true && claimed;
    return !claimed;
  };
  // All but one of the 22 rows this list held were met on 2026-10-02 by general
  // rules (see "what the last pass over the known misses changed" below).
  const KNOWN_MISSES = new Map([
    ["What's 4% of 12,500?", "claimed: it quotes the chart's own rate and baseline, so the answer is given with the chart attached and its computed values (the reviewer withdrew this label)"],
  ]);
  const OTHER_OPERATION = new Map([
    ["Simplify it.", "came back as update, labelled refine"],
  ]);

  for (const expect of ['nodraw', 'noclaim', 'draw', 'claim']) {
    const rows = ROWS.filter((row) => row.expect === expect);
    test(`${expect} (${rows.length})`, () => {
      const wrong = [];
      for (const row of rows) {
        const out = run(row);
        if (!right(row, out) && !KNOWN_MISSES.has(row.q)) wrong.push(`#${row.id} ${row.q} → ${out.enabled ? out.operation : 'off'} (${out.reason})`);
      }
      assert.deepEqual(wrong, []);
    });
  }

  test('nothing said with no artifact on the table draws when it must not', () => {
    for (const row of ROWS) {
      if (row.expect === 'nodraw') assert.notEqual(run(row).enabled, true, row.q);
    }
  });

  test('none of the lines that must not be claimed redraws a diagram', () => {
    const redraws = ROWS.filter((row) => row.expect === 'noclaim').filter((row) => { const out = run(row); return out.operation === 'update' && Boolean(out.parentArtifactId); }).map((row) => row.q);
    assert.deepEqual(redraws, []);
  });

  test('a follow-up comes back as the operation it is', () => {
    const wrong = [];
    for (const row of ROWS) {
      if (row.expect !== 'claim' || !row.op || KNOWN_MISSES.has(row.q) || OTHER_OPERATION.has(row.q)) continue;
      const out = run(row);
      if (out.operation !== row.op) wrong.push(`#${row.id} ${row.q} → ${out.operation}, wanted ${row.op}`);
    }
    assert.deepEqual(wrong, []);
  });

  test('the known misses are still misses (a rule that starts meeting one should drop it from the list)', () => {
    for (const row of ROWS) {
      if (KNOWN_MISSES.has(row.q)) assert.equal(right(row, run(row)), false, row.q);
    }
  });
});

describe('what the fifth measurement found: an edit is judged by its own object', async () => {
  const { resolveDiagramRequest } = await import('../diagramRequest.mjs');
  const state = { artifactId: 's.v1', artifact: 'mermaid', view: 'state', version: 1, foreground: true, source: 'stateDiagram-v2\n    [*] --> Available\n    Available --> OnHold: hold placed\n    OnHold --> CheckedOut: picked up\n    CheckedOut --> Returned: returned\n    Returned --> Available: reshelved' };
  const er = { artifactId: 'e.v1', artifact: 'mermaid', view: 'er', version: 1, foreground: true, source: 'erDiagram\n    PATRON ||--o{ LOAN : takes\n    BOOK_COPY ||--o{ LOAN : lent\n    PATRON {\n        string email\n        string name\n    }\n    LOAN {\n        date due_date\n    }' };
  const arch = { artifactId: 'd.v1', artifact: 'mermaid', view: 'architecture', version: 1, foreground: true, source: 'flowchart LR\n    k["Self-Service Kiosk"] --> gw["API Gateway"]\n    gw --> loan["Loan Service"]\n    gw --> trip["Trip Service"]\n    trip --> pay["Payment Service"]\n    loan --> q["Hold Queue"]' };
  const ask = (question, activeDesign, mode = 'team-meet') => resolveDiagramRequest({ question, featureEnabled: true, mode, ...(activeDesign ? { activeDesign } : {}) });

  test('a sentence that only shares a word or a name with the diagram does not edit it', () => {
    for (const [q, design] of [
      ['Put the caller on hold while I check.', state],
      ["Remove the hold music, it's dreadful.", state],
      ['I need a copy of the signed contract.', er],
      ['Remove Dan from the email thread.', er],
      ['Add the patron to the mailing list.', er],
      ['Put the gateway invoice on my desk.', arch],
    ]) {
      assert.equal(Boolean(ask(q, design, 'call-center').parentArtifactId), false, q);
    }
    assert.equal(Boolean(ask('Can we go from the airport straight to the venue?', state).parentArtifactId), false);
  });

  test('…and a real edit of it is still an edit', () => {
    for (const [q, design] of [
      ['Add a renewal count to loan.', er],
      ['Add a phone number to patron.', er],
      ['Add an Expired state after OnHold.', state],
      ['Remove the hold queue.', arch],
      ['uh remove remove the kiosk we dont need it', arch],
      ['Add a fraud check between Trip Service and Payment Service.', arch],
      ['Could you add a rate limiter at the gateway?', arch],
      ['Would you mind adding monitoring to this?', arch],
      ['Swap the loan service and the trip service.', arch],
    ]) {
      const out = ask(q, design, 'technical-interview');
      assert.equal(out.operation, 'update', q);
      assert.equal(out.parentArtifactId, design.artifactId, q);
    }
    assert.equal(ask('Can a loan go from OnHold straight to Returned?', state).operation, 'explain');
    assert.equal(ask('Why is there no renewed state?', state).operation, 'explain');
  });

  test('a follow-up that names nothing needs nothing but an acknowledgement before it', () => {
    const chart = { artifactId: 'c.v1', artifact: 'chart', view: 'chart', version: 1, foreground: true, source: '{"v":1,"type":"line","title":"Members","compute":{"kind":"compound_growth","baseline":12500,"ratePercent":4,"period":"month","periods":12}}' };
    for (const q of ['Sarah is on leave until the 12th. Make it 5%.', 'The dentist moved my appointment to the 9th. Change it to four percent.', "Tom's flight is delayed. Make it shorter."]) {
      assert.equal(Boolean(ask(q, chart, 'sales').parentArtifactId), false, q);
    }
    for (const q of ['Okay I see it. Make it 5%.', 'Right. Change it to four percent.', 'Hmm. Make it 5% instead.']) {
      assert.equal(ask(q, chart, 'sales').operation, 'update', q);
    }
    assert.equal(ask('Nice. Now show me the same thing as a sequence diagram.', arch).parentArtifactId, 'd.v1');
  });

  test('speech: a leading "er" and "like why"', () => {
    assert.equal(ask('er lay out the the steps of uh of the onboarding', null, 'general').enabled, true);
    assert.equal(ask('so like why why do we need the the hold queue', arch).operation, 'explain');
    assert.equal(ask('ER diagram for a library, please.', null, 'general').view, 'er');
  });
});

// ── swimlanes, trees, and the chart as a table (2026-10-02) ─────────────────
// Three things that were not drawn at all. Swimlanes and trees are ordinary
// Mermaid flowcharts laid out a particular way, so nothing new reaches the
// renderer or the source policy; the chart as a table copies the values the
// app computed, so the table cannot disagree with the chart beside it.
describe('swimlanes and trees are flowcharts with a layout', async () => {
  const { resolveDiagramRequest } = await import('../diagramRequest.mjs');
  const ask = (question, extra = {}) => resolveDiagramRequest({ question, featureEnabled: true, mode: 'general', ...extra });

  test('a swimlane request draws a flowchart in lanes', () => {
    for (const q of [
      'Show the swimlanes for this process.',
      "Let's see a swimlane of who does what in the handoff from sales to success.",
      'Draw a swim lane diagram of the refund process.',
      'Can you draw the onboarding as swimlanes?',
      'Swimlane diagram of the hiring process, please.',
      'Map it as a cross-functional flowchart.',
    ]) {
      const out = ask(q, { mode: 'team-meet' });
      assert.deepEqual([out.enabled, out.view, out.layout], [true, 'flowchart', 'lanes'], q);
    }
  });

  test('a tree request draws a flowchart as a tree', () => {
    for (const q of [
      'Show the org structure as a tree: CEO, then CTO and CFO, then their teams.',
      'Can you show the hierarchy?',
      'Show the hierarchy as a tree.',
      'Draw the category hierarchy.',
      'Show me the folder structure as a tree diagram.',
    ]) {
      const out = ask(q);
      assert.deepEqual([out.enabled, out.view, out.layout], [true, 'flowchart', 'tree'], q);
    }
  });

  test('the words in their other senses draw nothing', () => {
    for (const q of [
      'We put each team in its own swim lane at the pool.',
      'Stay in your lane on this one.',
      "You're barking up the wrong tree.",
      'There is a big tree outside the office.',
      'The hierarchy here is very flat.',
      'What is a swimlane diagram?',
      'Build the index as a tree.',
      'Store the categories as a tree.',
      'We organised the files as a tree last year.',
    ]) {
      assert.equal(ask(q).enabled, false, q);
    }
  });

  test('in a coding question a tree is data, not a picture', () => {
    for (const q of ['Print the hierarchy as a tree.', 'Show the directory structure as a tree.', 'Convert this sorted array into a balanced tree.', 'Return the categories as a tree.']) {
      assert.equal(ask(q, { answerType: 'coding_question_answer', mode: 'technical-interview' }).enabled, false, q);
    }
  });

  test('the views that have their own name keep it', () => {
    assert.equal(ask('Draw a decision tree for refund eligibility.').view, 'decision');
    assert.equal(ask('Draw a decision tree for refund eligibility.').layout, undefined);
    assert.equal(ask('Show the class hierarchy.').view, 'class');
    assert.equal(ask('Draw the org chart.').view, 'responsibility');
    assert.equal(ask('Draw the login flow.').layout, undefined);
  });
});

describe('the chart on the table, as a table', async () => {
  const { resolveDiagramRequest } = await import('../diagramRequest.mjs');
  const chart = { artifactId: 'c.v1', artifact: 'chart', view: 'chart', version: 1, foreground: true, source: '{"v":1,"type":"line","title":"Members","compute":{"kind":"compound_growth","baseline":12500,"ratePercent":4,"period":"month","periods":12}}' };
  const ask = (question, activeDesign) => resolveDiagramRequest({ question, featureEnabled: true, mode: 'sales', ...(activeDesign ? { activeDesign } : {}) });

  test('it is a table OF that chart, in focus or not', () => {
    for (const design of [chart, { ...chart, foreground: false }]) {
      for (const q of ['Show the chart as a table.', 'Turn the chart into a table.', 'Can you put the forecast in a table?', 'Give me the chart as a table, please.']) {
        const out = ask(q, design);
        assert.deepEqual([out.view, out.operation, out.parentArtifactId, out.parentFamily], ['matrix', 'create', 'c.v1', 'chart'], q);
      }
    }
    for (const q of ['Put the numbers in a table.', 'Put the same numbers in a table.', 'Show it as a table.']) {
      const out = ask(q, chart);
      assert.deepEqual([out.view, out.parentArtifactId, out.parentFamily], ['matrix', 'c.v1', 'chart'], q);
    }
  });

  test('another form of the same chart is still an edit of it, and a chart word alone is still a chart', () => {
    assert.deepEqual([ask('Show it as a bar chart.', chart).view, ask('Show it as a bar chart.', chart).operation], ['chart', 'update']);
    assert.equal(ask('Show me a chart of signups by month.').view, 'chart');
    assert.equal(ask('Plot revenue as a function of time.').view, 'chart');
    // With no chart on the table, "as a table" is still a table.
    assert.equal(ask('Show the results as a table.').view, 'matrix');
  });

  test('a table of something else is not a table of the chart', () => {
    assert.equal(Boolean(ask('Put the vendor comparison in a table.', chart).parentArtifactId), false);
    assert.equal(Boolean(ask('Make a table of the three options.', { ...chart, foreground: false }).parentArtifactId), false);
  });
});

// ── what the last pass over the known misses changed (2026-10-02) ───────────
// The fifth measurement left 22 rows wrong. Each was fixed as a rule about a
// KIND of sentence, with sentences of the same kind that were never in any
// measurement, and with the nearby sentences that must keep meaning something
// else. (One row was a label its reviewer withdrew.)
describe('requests in forms the rules did not know', async () => {
  const { resolveDiagramRequest } = await import('../diagramRequest.mjs');
  const ask = (question, mode = 'general') => resolveDiagramRequest({ question, featureEnabled: true, mode });

  test('"we need / we\'d like" a visual, "prepare" one, "it would be nice to see" one', () => {
    for (const q of [
      'We need a diagram of the on-call escalation path.',
      "We'd like a flowchart of the returns process.",
      'Kindly prepare a flow chart of the approval process.',
      'Prepare a sequence diagram of the login handshake.',
      'It would be nice to see the rollout as a timeline.',
      'wouldnt it be nice to see the handshake as a as a sequence diagram can you do that',
      'The handshake as a sequence diagram, can you do that?',
    ]) {
      assert.equal(ask(q, 'team-meet').enabled, true, q);
    }
  });

  test('…and the same words where nothing is asked to be drawn here', () => {
    for (const q of [
      'We need a table for six at eight.',
      'We need a plan for Q3.',
      'We need to talk about the diagram.',
      'Prepare the room for the board meeting.',
      'It would be nice to see you at the offsite.',
      'It would be nice to have a break.',
      'The handshake failed again, can you do that call for me?',
      // Wanted somewhere else: a remark about the document.
      'We want a pie chart in the QBR deck, do you have a template?',
      'We need a flowchart for the onboarding doc.',
      'I want a timeline in the proposal by Friday.',
    ]) {
      assert.equal(ask(q, 'sales').enabled, false, q);
    }
  });

  test('a visual named inside another thing\'s phrase is one that exists, not one to draw', () => {
    for (const q of [
      'Create a ticket about the diagram.',
      'Make a summary of the chart for Friday.',
      'Give me a summary of the chart.',
      'Send me a copy of the diagram.',
      'Write a note on the timeline for the client.',
      'Give me the owner of the flowchart.',
    ]) {
      assert.equal(ask(q).enabled, false, q);
    }
    // The visual as the head of what is asked for still draws.
    for (const q of ['Give me a diagram of the login flow.', 'Make a chart of signups by month.', 'Show me a picture of how the queue works.', 'Create a flowchart of the ticket lifecycle.']) {
      assert.equal(ask(q).enabled, true, q);
    }
  });

  test('a structure asked for in other words draws where the mode makes it relevant, and only there', () => {
    for (const [q, mode] of [
      ['Give me the steps from code freeze to launch day.', 'team-meet'],
      ['Walk through the stages of our interview loop from recruiter screen to offer.', 'recruiting'],
      ['Break down the stages of the product launch and what each one needs.', 'general'],
      ['Run through the steps for issuing a refund.', 'call-center'],
      ['At what volume does the annual plan pay for itself versus monthly?', 'sales'],
      ['At what volume does the annual plan beat the monthly one?', 'sales'],
    ]) {
      const out = ask(q, mode);
      assert.deepEqual([out.enabled, out.contextual], [true, true], q);
    }
    for (const [q, mode] of [
      ['Give me the steps to reset my password.', 'lecture'],
      ['Break down the stages of grief.', 'seminar'],
      ['Walk through the stages of your interview loop.', 'recruiting'],
      ['At what point does it break?', 'sales'],
    ]) {
      assert.equal(ask(q, mode).enabled, false, q);
    }
    // "Map the …" asks for the map, in any mode.
    assert.equal(ask('Map the stages of the nitrogen cycle process.', 'lecture').explicit, true);
  });
});

describe('follow-ups in forms the rules did not know, and their look-alikes', async () => {
  const { resolveDiagramRequest } = await import('../diagramRequest.mjs');
  const arch = { artifactId: 'd.v1', artifact: 'mermaid', view: 'architecture', version: 1, foreground: true, source: 'flowchart LR\n    kiosk["Self-Service Kiosk"] --> gw["API Gateway"]\n    gw --> search["Search Service"]\n    gw --> loan["Loan Service"]\n    loan --> q["Hold Queue"]\n    loan --> db[("Catalogue Database")]' };
  const chart = { artifactId: 'c.v1', artifact: 'chart', view: 'chart', version: 1, foreground: true, source: '{"v":1,"type":"line","title":"Members","compute":{"kind":"compound_growth","baseline":12500,"ratePercent":4,"period":"month","periods":12}}' };
  const er = { artifactId: 'e.v1', artifact: 'mermaid', view: 'er', version: 1, foreground: true, source: 'erDiagram\n    PATRON ||--o{ LOAN : takes\n    TITLE ||--o{ BOOK_COPY : has\n    BOOK_COPY ||--o{ LOAN : lent\n    PATRON {\n        string email\n    }\n    LOAN {\n        date due_date\n    }' };
  const state = { artifactId: 's.v1', artifact: 'mermaid', view: 'state', version: 1, foreground: true, source: 'stateDiagram-v2\n    [*] --> Available\n    Available --> OnHold: hold placed\n    OnHold --> CheckedOut: picked up\n    CheckedOut --> Overdue: due date passed\n    CheckedOut --> Returned: returned\n    Overdue --> Returned: returned late\n    Returned --> Available: reshelved' };
  const ask = (question, activeDesign, mode = 'team-meet') => resolveDiagramRequest({ question, featureEnabled: true, mode, activeDesign });
  const claimed = (question, design, mode) => Boolean(ask(question, design, mode).parentArtifactId);

  test('"it" that stands for the weather or the time is not the design', () => {
    for (const q of ['What happens if it rains on the day of the offsite?', 'What happens if it rains tomorrow?', "It's getting late, can we wrap up?"]) assert.equal(claimed(q, arch), false, q);
    assert.equal(ask('What happens if it fails over during the migration?', arch).operation, 'explain');
  });

  test('scaling the TEAM is not scaling the system', () => {
    for (const q of ['How would this scale to a team of fifty people?', 'How would this scale to forty engineers?', 'Can this grow to sixty employees?']) assert.equal(claimed(q, arch), false, q);
    for (const q of ['How would this scale to ten million patients?', 'How would this scale to fifty million people?', 'How would this handle ten thousand kiosks?']) assert.equal(ask(q, arch).operation, 'update', q);
  });

  test('a why-question with its verb left out is about what is on the table', () => {
    for (const q of ['Why two entry points?', 'Why no cache?', 'Why a separate queue?', 'Why is there no queue in front of search?']) assert.equal(ask(q, arch, 'technical-interview').operation, 'explain', q);
    assert.equal(ask('Why is there no table for fines?', er, 'technical-interview').operation, 'explain');
    for (const q of ['Why not Friday?', 'Why two meetings a week?', 'Why no reply yet?']) assert.equal(claimed(q, arch), false, q);
  });

  test('a part of the design, said of something else, is something else', () => {
    for (const q of ['Why is the queue for the lift so long every morning?', 'Why is the queue at the canteen so slow?', 'Is the gateway at the airport still closed?']) {
      assert.equal(claimed(q, { ...arch, foreground: false }), false, q);
      assert.equal(claimed(q, arch), false, q);
    }
    assert.equal(ask('Why do we need the queue for the search service?', arch).operation, 'explain');
    assert.equal(ask('Does the search need its own datastore?', arch, 'technical-interview').operation, 'explain');
  });

  test('a chart: how its line behaves, what its axes show, where it starts', () => {
    for (const q of ['Why does it speed up towards the end?', 'Why does it flatten out after month nine?', 'What does the y-axis show?', 'What is on the horizontal axis?']) assert.equal(ask(q, chart, 'sales').operation, 'explain', q);
    for (const q of ['Double the starting figure.', 'Halve the initial amount.', 'Double the starting value.']) assert.equal(ask(q, chart, 'sales').operation, 'update', q);
    for (const q of ['Why does it slow down when I open the laptop?', 'What does the y-axis mean in your experience?', 'Double the order.', 'Double check the starting figure with finance.']) assert.equal(claimed(q, chart, 'sales'), false, q);
  });

  test('a data model: how many of one thing another may have, and a field given to an entity', () => {
    assert.equal(ask('Can a patron have more than one loan at a time?', er, 'general').operation, 'explain');
    assert.equal(ask('Can a title have several copies?', er, 'general').operation, 'explain');
    for (const q of ['Give title an ISBN attribute.', 'Give loan a status field.', 'Give each patron a membership tier column.']) assert.equal(ask(q, er, 'technical-interview').operation, 'update', q);
    for (const q of ['Can I have more than one slice?', 'Can we do several of these today?', 'Give me a second.', 'Give the patron a call back.', 'Give it a rest.']) assert.equal(claimed(q, er, 'general'), false, q);
  });

  test('a state machine: what triggers a state and how one is reached', () => {
    for (const q of ['What triggers overdue?', 'How many ways are there to reach returned?', 'How does a copy get out of OnHold?', 'What causes Overdue?']) assert.equal(ask(q, state, 'general').operation, 'explain', q);
    for (const q of ['How do I get to the venue?', 'What triggers the fire alarm test?', 'What causes the delay?']) assert.equal(claimed(q, state, 'general'), false, q);
  });
});

describe('naming the design does not make an edit of something else an edit of it', async () => {
  const { resolveDiagramRequest } = await import('../diagramRequest.mjs');
  const arch = { artifactId: 'd.v1', artifact: 'mermaid', view: 'architecture', version: 1, foreground: true, source: 'flowchart LR\n    gw["API Gateway"] --> q["Ingest Queue"]\n    q --> db[("Time Series Store")]' };
  const ask = (question, design = arch) => resolveDiagramRequest({ question, featureEnabled: true, mode: 'team-meet', activeDesign: design });

  test('the diagram is not redrawn when the edit goes to the minutes, the deck or the ticket', () => {
    for (const q of [
      'Can you add a line to the minutes about the budget? The architecture can wait.',
      'Add a note to the ticket, the diagram is fine as it is.',
      'Put a reminder in the calendar about the design review.',
    ]) {
      assert.notEqual(ask(q).operation, 'update', q);
    }
  });

  test('an edit of the design that names it, in any clause order, is still an edit', () => {
    for (const q of [
      'Going back to the design we drew, drop the queue.',
      'In the diagram, add a cache to the gateway.',
      'Add a cache to the diagram.',
      'Add a dead-letter queue to the architecture.',
    ]) {
      const out = ask(q, { ...arch, foreground: false });
      assert.equal(out.operation, 'update', q);
      assert.equal(out.parentArtifactId, 'd.v1', q);
    }
  });
});

// ── the sixth held-out measurement (2026-10-02) ─────────────────────────────
// 599 sentences by a sixth reviewer (a ferry operator's booking system, a
// forecast, an ER diagram, a sequence diagram and a Gantt chart), frozen
// before the rules were run (SHA-256 cd1b17ad…0430) and measured on the rules
// as they stood after the 22 known misses were fixed and swimlanes, trees and
// the chart table were added: 301 of 309 "must not" lines right (2.6% wrong;
// four of the eight would have REDRAWN a diagram), 255 of 290 "must" lines
// right (12.1% missed), nothing over 100 ms. Now regression data.
describe('the sentences of the sixth held-out measurement, now regression data', async () => {
  const { ROWS, FIXTURES } = await import('../../../../tests/diagram/heldout-6-2026-10-02.mjs');
  const { resolveDiagramRequest } = await import('../diagramRequest.mjs');
  const run = (row) => resolveDiagramRequest({
    question: row.q,
    featureEnabled: true,
    mode: row.mode,
    ...(row.ctx !== 'none' ? { activeDesign: { ...FIXTURES[row.ctx] } } : {}),
    ...(row.coding ? { answerType: 'coding_question_answer' } : {}),
  });
  const right = (row, out) => {
    const claimed = Boolean(out.parentArtifactId);
    if (row.expect === 'draw') return out.enabled === true;
    if (row.expect === 'nodraw') return out.enabled !== true;
    if (row.expect === 'claim') return out.enabled === true && claimed;
    return !claimed;
  };
  const KNOWN_MISSES = new Map([
    ['I am having one doubt, why the queue is needed here?', 'not taken as a follow-up: "I am …" reads as about the speaker, and the question word is not at the head'],
    ['Colour the external systems differently.', 'not taken as a follow-up: names no part and no design word (the reviewer marked this borderline)'],
    ['One vessel can have many sailings, yes?', 'not taken as a follow-up: a statement with a tag, not a question (the reviewer marked this borderline)'],
    ['Make the confirmation asynchronous.', 'not taken as a follow-up: "confirmation" is not matched to the message "Confirm"'],
    ['How long is the probation period for new staff?', 'claimed: "staff" is a word of a task on the chart; answered in words with the chart attached, never redrawn'],
    ['In the system we drew, the gateway should also do authentication.', 'not taken as a follow-up: "should also do" is not read as an edit (the reviewer marked this borderline)'],
    ['Sequence the work for the data centre exit: what has to happen first, second and third.', 'not drawn: no step or stage word (the reviewer called this a judgement call)'],
  ]);

  for (const expect of ['nodraw', 'noclaim', 'draw', 'claim']) {
    const rows = ROWS.filter((row) => row.expect === expect);
    test(`${expect} (${rows.length})`, () => {
      const wrong = [];
      for (const row of rows) {
        const out = run(row);
        if (!right(row, out) && !KNOWN_MISSES.has(row.q)) wrong.push(`#${row.id} ${row.q} → ${out.enabled ? out.operation : 'off'} (${out.reason})`);
      }
      assert.deepEqual(wrong, []);
    });
  }

  test('none of the lines that must not be claimed redraws a diagram', () => {
    const redraws = ROWS.filter((row) => row.expect === 'noclaim').filter((row) => { const out = run(row); return out.operation === 'update' && Boolean(out.parentArtifactId); }).map((row) => row.q);
    assert.deepEqual(redraws, []);
  });

  test('a follow-up comes back as one of the operations it may be, and a layout as asked', () => {
    const wrong = [];
    for (const row of ROWS) {
      if (KNOWN_MISSES.has(row.q)) continue;
      const out = run(row);
      if (row.expect === 'claim' && row.op && !String(row.op).split('|').includes(out.operation)) wrong.push(`#${row.id} ${row.q} → ${out.operation}, wanted ${row.op}`);
      if (row.expect === 'draw' && row.layout && out.layout !== row.layout) wrong.push(`#${row.id} ${row.q} → layout ${out.layout}, wanted ${row.layout}`);
    }
    assert.deepEqual(wrong, []);
  });

  test('the known misses are still misses (a rule that starts meeting one should drop it from the list)', () => {
    for (const row of ROWS) {
      if (KNOWN_MISSES.has(row.q)) assert.equal(right(row, run(row)), false, row.q);
    }
  });
});

describe('what the sixth measurement found', async () => {
  const { resolveDiagramRequest } = await import('../diagramRequest.mjs');
  const arch = { artifactId: 'd.v1', artifact: 'mermaid', view: 'architecture', version: 1, foreground: true, source: 'flowchart LR\n    kiosk["Kiosk Terminal"] --> gw["Booking Gateway"]\n    gw --> rules["Fare Rules Engine"]\n    gw --> q["Reservation Queue"]\n    q --> db[("Sailings Database")]' };
  const er = { artifactId: 'e.v1', artifact: 'mermaid', view: 'er', version: 1, foreground: true, source: 'erDiagram\n    PASSENGER ||--o{ BOOKING : makes\n    SAILING ||--o{ BOOKING : has\n    VESSEL ||--o{ SAILING : runs' };
  const chart = { artifactId: 'c.v1', artifact: 'chart', view: 'chart', version: 1, foreground: true, source: '{"v":1,"type":"line","title":"Passengers","compute":{"kind":"compound_growth","baseline":48000,"ratePercent":3,"period":"month","periods":18}}' };
  const seq = { artifactId: 'q.v1', artifact: 'mermaid', view: 'sequence', version: 1, foreground: true, source: 'sequenceDiagram\n    participant App as Passenger App\n    participant GW as Booking Gateway\n    participant Mail as Email Service\n    App->>GW: request fare quote\n    GW-->>App: fare quote\n    GW->>Mail: send e-ticket' };
  const gantt = { artifactId: 'g.v1', artifact: 'mermaid', view: 'gantt', version: 1, foreground: true, source: 'gantt\n    title Summer timetable\n    dateFormat YYYY-MM-DD\n    section Planning\n    Route survey :a1, 2027-01-10, 14d\n    section Launch\n    Staff briefing :b1, after a1, 5d' };
  const ask = (question, activeDesign, mode = 'team-meet', extra = {}) => resolveDiagramRequest({ question, featureEnabled: true, mode, ...(activeDesign ? { activeDesign } : {}), ...extra });
  const claimed = (q, design, mode) => Boolean(ask(q, design, mode).parentArtifactId);

  test('four sentences that would have redrawn a diagram, and their kind', () => {
    for (const [q, design] of [
      ['Update the rules of engagement doc for contractors.', arch],
      ['Update the rules in the staff handbook.', arch],
      ['How would this team scale to three offices?', arch],
      ['How would this company handle a recession?', arch],
      ['Add Priyanka to the reservation for dinner tonight.', arch],
      ['Add Priyanka to the dinner reservation.', arch],
      ["Move our table booking to eight o'clock.", er],
      ['Move our dinner booking to half past seven.', er],
    ]) {
      assert.equal(claimed(q, design), false, q);
    }
    // The same shapes, said of the design, are still edits of it.
    assert.equal(ask('Update the rules engine to cache fares.', arch).operation, 'update');
    assert.equal(ask('How would this scale to ten times the bookings?', arch).operation, 'update');
    assert.equal(ask('Add a passenger loyalty tier to booking.', er, 'technical-interview').operation, 'update');
    assert.equal(ask('Now do it with a baseline of 100k.', chart, 'sales').operation, 'update');
    assert.equal(ask('Use a starting point of 50,000.', chart, 'sales').operation, 'update');
  });

  test('a unit of time names a part of a chart only when it is pointed at', () => {
    for (const q of ['How many months of runway do we have left?', 'How many months until the audit?', 'It has been three years since the last raise.']) assert.equal(claimed(q, chart, 'sales'), false, q);
    for (const q of ['Why is the last month higher?', "What's the value at month twelve?", 'Extend it to 24 months.']) assert.equal(claimed(q, chart, 'sales'), true, q);
  });

  test('wanted in a board pack or a memo is wanted elsewhere; a past break-even is a lookup', () => {
    assert.equal(ask("We'd like a bar chart in the board pack this quarter.", null, 'sales').enabled, false);
    assert.equal(ask('I want a timeline in the memo for the investors.', null, 'sales').enabled, false);
    assert.equal(ask('At what price did we break even last year?', null, 'sales').enabled, false);
    assert.equal(ask('At what price do we break even?', null, 'sales').enabled, true);
    // A ticket is a thing with a lifecycle, not a document.
    assert.equal(ask('Can we get a state diagram for the ticket lifecycle?', null, 'call-center').explicit, true);
  });

  test('requests in forms the sixth set asked in', () => {
    for (const q of [
      'Map the steps of our deployment pipeline.',
      'Could you put the candidate journey in swim lanes: recruiter, hiring manager, candidate?',
      'okay so uh put the approvals in swimlanes for um finance legal and procurement',
      "Let's see a break-even chart: fixed costs 30,000, price 25, unit cost 10.",
      'Would it be possible to have a diagram showing how DNS resolution works?',
      'Can you make a drawing of how is working the load balancer?',
      'I would be grateful if you could produce a diagram of the data flows between the three regional offices.',
      'Gimme a quick flowchart for password resets.',
      'Plot 5% monthly growth from 20,000 users over a year.',
    ]) {
      assert.equal(ask(q, null, 'technical-interview').explicit, true, q);
    }
    assert.equal(ask('Could you put the candidate journey in swim lanes?', null, 'recruiting').layout, 'lanes');
    // "Chart 3 shows revenue" is still a noun with a number.
    assert.equal(ask('Chart 3 shows the revenue by region.', null, 'sales').enabled, false);
    assert.equal(ask('If you could send me the diagram later, that would be great.', null, 'general').enabled, false);
  });

  test('follow-ups in forms the sixth set asked in', () => {
    for (const [q, design, operation] of [
      ['Why does it have two front ends?', arch, 'explain'],
      ['Where would you add redundancy?', arch, 'explain'],
      ['Make the queue durable.', arch, 'update'],
      ['Kindly remove the kiosk terminal only.', arch, 'update'],
      ['Remind me why the system design has the Reservation Queue at all.', { ...arch, foreground: false }, 'explain'],
      ['Make the baseline fifty thousand.', chart, 'update'],
      ['Use seven point five percent, please.', chart, 'update'],
      ['What does the axis on the left measure?', chart, 'explain'],
      ["What does the crow's foot on the booking side mean?", er, 'explain'],
      ['Who sends the e-ticket?', seq, 'explain'],
      ['Is the fare quote call synchronous?', seq, 'explain'],
      ['Add an SMS service next to the email one.', seq, 'update'],
      ['When does the launch section start?', gantt, 'explain'],
      ['Start everything on the first of February.', gantt, 'update'],
    ]) {
      const out = ask(q, design, 'technical-interview');
      assert.equal(out.operation, operation, q);
      assert.equal(out.parentArtifactId, design.artifactId, q);
    }
    for (const [q, view] of [['Could we draw the data model for this as an ER diagram?', 'er'], ['Can I see that as a table?', 'matrix'], ['can i can i get that as a a table', 'matrix']]) {
      const out = ask(q, view === 'er' ? arch : chart, 'technical-interview');
      assert.deepEqual([out.view, out.operation, Boolean(out.parentArtifactId)], [view, 'create', true], q);
    }
    assert.equal(ask('Show the deployment view of this.', arch).parentArtifactId, 'd.v1');
    // …and what must still not be: the same words about something else.
    for (const [q, design] of [['Who sends the invoice to the client?', seq], ['Make the coffee stronger.', arch], ['Remind me to call the vendor.', arch], ['When does the school term start?', gantt], ['Start the call without me.', gantt]]) {
      assert.equal(claimed(q, design), false, q);
    }
  });

  test('a tree or lanes asked to be SHOWN is a picture even when the router calls the turn coding', () => {
    const coding = { answerType: 'dsa_question_answer' };
    for (const q of ['Show the org structure as a tree: CEO, then CTO and CFO, then their teams.', 'Show the hierarchy as a tree.', 'Show the category hierarchy as a tree: root, then children.']) {
      const out = ask(q, null, 'team-meet', coding);
      assert.deepEqual([out.enabled, out.view, out.layout], [true, 'flowchart', 'tree'], q);
    }
    // Where "tree" is the data structure, or the verb is the program's, it is code.
    for (const q of ['Show the binary tree after inserting 5.', 'Print the hierarchy as a tree.', 'Show the directory structure as a tree.', 'Return the categories as a tree.', 'Convert this sorted array into a balanced tree.', 'Show how to implement the hierarchy as a tree.', 'Show the JSON as a tree.']) {
      assert.equal(ask(q, null, 'technical-interview', coding).enabled, false, q);
    }
  });

  test('a turn of several sentences: a one-word "Okay." is what stands before the next one', () => {
    assert.equal(ask('Hold on, let me share my screen. Okay. What does it look like over twenty-four months?', chart, 'general').operation, 'update');
    assert.equal(claimed('I spoke to finance this morning. Make it 5% instead of 4.', chart, 'sales'), false);
  });
});

// ── the seventh held-out measurement (2026-10-02): the last one ─────────────
// 476 sentences by a seventh reviewer (a council's waste and recycling
// collection: an architecture, a forecast, an ER diagram, a state diagram and a
// Gantt chart), frozen before the rules were run (SHA-256 c8102648…a184) and
// measured on the rules as they stood after the sixth measurement's fixes:
// 239 of 244 "must not" lines right (2.0% wrong; two would have REDRAWN a
// diagram), 208 of 232 "must" lines right (10.3% missed), nothing over 100 ms.
// This is the last measurement: what was fixed after it is not measured on
// unseen sentences. Now regression data.
describe('the sentences of the seventh held-out measurement, now regression data', async () => {
  const { ROWS, FIXTURES } = await import('../../../../tests/diagram/heldout-7-2026-10-02.mjs');
  const { resolveDiagramRequest } = await import('../diagramRequest.mjs');
  const run = (row) => resolveDiagramRequest({
    question: row.q,
    featureEnabled: true,
    mode: row.mode,
    ...(row.ctx !== 'none' ? { activeDesign: { ...FIXTURES[row.ctx] } } : {}),
    ...(row.coding ? { answerType: 'coding_question_answer' } : {}),
  });
  const right = (row, out) => {
    const claimed = Boolean(out.parentArtifactId);
    if (row.expect === 'draw') return out.enabled === true;
    if (row.expect === 'nodraw') return out.enabled !== true;
    if (row.expect === 'claim') return out.enabled === true && claimed;
    return !claimed;
  };
  const KNOWN_MISSES = new Map([
    ['Does the app talk to the planner directly?', 'not taken as a follow-up: "talk to" is not read as a data flow, and "app" is too common a word to name a part'],
    ['Shorten it to just the main path.', 'not taken as a follow-up: "shorten it to" with nothing a design is discussed in beside it'],
    ['Where would a missed collection be recorded?', 'not taken as a follow-up: the passive "be recorded" is outside the where-would-you-put form'],
    ["We had a similar setup at my last company. It fell over every Monday. So, where's the single point of failure in this one?", 'not taken: a follow-up that names nothing, after sentences that are not acknowledgements (the stated rule; the reviewer called this a judgement call)'],
    ['Where are we losing people between the demo and the signed contract?', 'not drawn: unasked visuals stay conservative (the reviewer agreed)'],
    ['Which tasks depend on the design sign-off, and which can start now?', 'not drawn: reads close to a lookup (the reviewer called this a judgement call)'],
    ['How many months until the new CRM pays for itself at £900 a month against a £15,000 setup fee?', 'not drawn: a break-even that never says so (the reviewer withdrew this label)'],
    ['Walk through the handoffs between design, engineering and QA for a new feature.', 'not drawn: no step or stage word (the reviewer withdrew this label)'],
    ['Draw the binary tree after inserting 5, 3, 8, 1 and 4.', 'not drawn in a coding turn: the words are about a data structure (the reviewer called this a label judgement)'],
  ]);

  for (const expect of ['nodraw', 'noclaim', 'draw', 'claim']) {
    const rows = ROWS.filter((row) => row.expect === expect);
    test(`${expect} (${rows.length})`, () => {
      const wrong = [];
      for (const row of rows) {
        const out = run(row);
        if (!right(row, out) && !KNOWN_MISSES.has(row.q)) wrong.push(`#${row.id} ${row.q} → ${out.enabled ? out.operation : 'off'} (${out.reason})`);
      }
      assert.deepEqual(wrong, []);
    });
  }

  test('every line that must not draw or be claimed is left alone, none excepted', () => {
    for (const row of ROWS) {
      if (row.expect === 'nodraw' || row.expect === 'noclaim') assert.equal(right(row, run(row)), true, row.q);
    }
  });

  test('a follow-up comes back as one of the operations it may be, and a layout as asked', () => {
    const wrong = [];
    for (const row of ROWS) {
      if (KNOWN_MISSES.has(row.q)) continue;
      const out = run(row);
      if (row.expect === 'claim' && row.op && !String(row.op).split('|').includes(out.operation)) wrong.push(`#${row.id} ${row.q} → ${out.operation}, wanted ${row.op}`);
      if (row.expect === 'draw' && row.layout && out.layout !== row.layout) wrong.push(`#${row.id} ${row.q} → layout ${out.layout}, wanted ${row.layout}`);
    }
    assert.deepEqual(wrong, []);
  });

  test('the known misses are still misses (a rule that starts meeting one should drop it from the list)', () => {
    for (const row of ROWS) {
      if (KNOWN_MISSES.has(row.q)) assert.equal(right(row, run(row)), false, row.q);
    }
  });
});

describe('what the seventh measurement found', async () => {
  const { resolveDiagramRequest, designVocabulary } = await import('../diagramRequest.mjs');
  const arch = { artifactId: 'd.v1', artifact: 'mermaid', view: 'architecture', version: 1, foreground: true, source: 'flowchart LR\n    sensors["Bin Sensor Gateway"] --> dispatch["Dispatch Queue"]\n    dispatch --> planner["Route Planning Service"]\n    planner --> trucks["Truck Tablet App"]\n    dispatch --> workers["Notification Worker"]' };
  const chart = { artifactId: 'c.v1', artifact: 'chart', view: 'chart', version: 1, foreground: true, source: '{"v":1,"type":"line","title":"Tonnes collected","compute":{"kind":"compound_growth","baseline":5200,"ratePercent":2,"period":"month","periods":18}}' };
  const gantt = { artifactId: 'g.v1', artifact: 'mermaid', view: 'gantt', version: 1, foreground: true, source: 'gantt\n    title Rollout\n    dateFormat YYYY-MM-DD\n    section Procurement\n    Tender :a1, 2027-01-10, 30d\n    section Pilot\n    Pilot ward :b1, after a1, 21d' };
  const ask = (question, activeDesign, mode = 'team-meet', extra = {}) => resolveDiagramRequest({ question, featureEnabled: true, mode, ...(activeDesign ? { activeDesign } : {}), ...extra });
  const claimed = (q, design, mode) => Boolean(ask(q, design, mode).parentArtifactId);

  test('a thing that is no part of the design, put somewhere, does not redraw it', () => {
    for (const q of ['Put that idea in the bin, honestly.', 'Put the report in the queue for review.', 'Stick the invoice in the queue for Monday.', 'We need another support worker on the weekend shift.']) {
      assert.equal(claimed(q, arch), false, q);
    }
    for (const q of ['Put a cache in the gateway.', 'Put the cache in front of the gateway.', 'Move the retry logic into the dispatch queue.', 'We need another worker for the dispatch queue.', 'Drop the direct link between the gateway and the planner.']) {
      assert.equal(ask(q, arch).operation, 'update', q);
    }
  });

  test('things drawn without a pen, and a verb that works on a drawing that exists', () => {
    for (const q of ['Can you draw the curtains, the glare is on my screen?', 'Draw two cards from the deck.', 'Draw a bath for the kids.', 'Draw the blinds, please.', 'Please summarise the diagram Ravi sent round this morning.', 'Summarise the chart for me.', "Compare the diagram with last week's version."]) {
      assert.equal(ask(q, null, 'general').enabled, false, q);
    }
    for (const q of ['Summarise the discussion as a diagram.', 'Compare the three vendors in a table.', 'Draw the card sort layout.', 'Before I go, show the login flow as a sequence diagram.']) {
      assert.equal(ask(q, null, 'general').enabled, true, q);
    }
  });

  test('a node id is a name for the part', () => {
    assert.equal(designVocabulary(arch.source).has('planner'), true);
    assert.equal(ask('Split the planner into a scheduler and an optimiser.', arch, 'technical-interview').operation, 'update');
    assert.equal(ask('Why are there two things feeding the planner?', arch, 'technical-interview').operation, 'explain');
    // Not the ids that are ordinary words of any flowchart.
    assert.equal(designVocabulary('flowchart TD\n    start(["Start"]) --> check{"Paid?"}\n    check --> done(["Done"])').has('start'), false);
  });

  test('a chart: where its line starts, how it bends, a month by its number, its numbers as a table', () => {
    for (const [q, operation] of [
      ['Start from 4,800 rather than 5,200.', 'update'],
      ['Extend it by another six months.', 'update'],
      ['Why is it steeper towards the end?', 'explain'],
      ['What happens at month eighteen?', 'explain'],
      ['How much do we gain between month six and month nine?', 'explain'],
    ]) {
      assert.equal(ask(q, chart, 'sales').operation, operation, q);
    }
    for (const q of ['Could I have those numbers as a table?', 'Can I see those numbers as a table?']) {
      const out = ask(q, chart, 'sales');
      assert.deepEqual([out.view, out.parentArtifactId, out.parentFamily], ['matrix', 'c.v1', 'chart'], q);
    }
    for (const q of ["What's the growth rate of bamboo, out of curiosity?", 'Could I have a word with you?', 'Can I have the bill, please?']) assert.equal(claimed(q, chart, 'sales'), false, q);
    assert.equal(ask("What's the growth rate here?", chart, 'sales').operation, 'explain');
  });

  test('a schedule: an edit that ends in a duration or "earlier", and an object that ends at "across"', () => {
    for (const q of ['Start the procurement section a month earlier.', 'Push the pilot back a fortnight.', 'Push the pilot back by two weeks.']) assert.equal(ask(q, gantt).operation, 'update', q);
    assert.equal(ask('Make the dispatch queue persistent across restarts.', arch).operation, 'update');
  });

  test('in a coding turn a drawing verb with a view named draws; the program\'s own drawing does not', () => {
    const coding = { answerType: 'coding_question_answer' };
    for (const q of ['Sketch the architecture of a task scheduler.', 'Diagram the state transitions of a TCP connection.']) assert.equal(ask(q, null, 'technical-interview', coding).enabled, true, q);
    for (const q of ['Draw the output on the canvas.', 'Draw a rectangle with the turtle library.', 'Draw the binary tree after inserting 5, 3, 8, 1 and 4.']) assert.equal(ask(q, null, 'technical-interview', coding).enabled, false, q);
  });
});

describe('what was SAID in the meeting is not a question about the design (2026-10-02)', () => {
  const design = { artifactId: 'a.v1', artifact: 'mermaid', view: 'architecture', version: 1, foreground: true, source: 'flowchart LR\n  client["Client"] --> gw["API Gateway"]\n  gw --> cache["Redis Cache"]\n  gw --> q["Order Queue"]\n  q --> db[("Postgres")]' };
  const ask = (question, activeDesign = design) => resolveDiagramRequest({ question, activeDesign, answerType: 'general', mode: 'general' });

  test('recall questions go to the meeting, whatever part of the design they mention', () => {
    for (const q of ['What did John say about the API gateway?', 'What did they decide about the cache?', 'Who mentioned Postgres?', 'When did we talk about Redis?', 'What did we agree on for the gateway?', 'What was said about the queue?', 'Did Maria say anything about the cache?']) {
      assert.equal(ask(q).enabled, false, q);
      assert.equal(ask(q, { ...design, foreground: false }).enabled, false, `${q} (background)`);
    }
  });

  test('an edit that cites the meeting is an edit: recall is a question, from its first word', () => {
    for (const q of ['Add the cache that Ana mentioned', 'Add what was agreed for the gateway: a rate limiter', 'Remove the queue we decided to drop']) {
      const r = ask(q);
      assert.deepEqual([r.enabled, r.operation], [true, 'update'], q);
    }
    for (const q of ['So what did John say about the API gateway?', 'Do you remember what they decided about the cache?', 'Remind me who mentioned Postgres']) {
      assert.equal(ask(q).enabled, false, q);
    }
  });

  test('a question about the design stays one, and so does one that names the drawing', () => {
    for (const q of ['Why do we need the queue?', 'What happens if the cache goes down?', 'What does the diagram say about the cache?', 'What did we decide the diagram should show?']) {
      const r = ask(q);
      assert.deepEqual([r.enabled, r.operation, r.followUp], [true, 'explain', 'strong'], q);
    }
  });
});

describe('an edit of a swimlane diagram keeps its lanes (2026-10-02)', () => {
  const lanes = { artifactId: 'l.v1', artifact: 'mermaid', view: 'flowchart', version: 1, foreground: true, source: 'flowchart LR\n  subgraph Customer\n    a["Request refund"]\n  end\n  subgraph Support\n    b["Review"]\n  end\n  a --> b' };
  const plain = { artifactId: 'f.v1', artifact: 'mermaid', view: 'flowchart', version: 1, foreground: true, source: 'flowchart TD\n  a["Request refund"] --> b["Review"]\n  b --> c["Refund"]' };

  test('what it was asked for as is remembered with it: a left-to-right swimlane diagram is stored as an architecture', () => {
    const stored = { ...lanes, view: 'architecture', question: 'Draw a swimlane diagram of the refund process' };
    for (const q of ['Add a finance lane that approves anything over 500', 'Add an approval step after Review']) {
      const r = resolveDiagramRequest({ question: q, activeDesign: stored, answerType: 'general' });
      assert.deepEqual([r.operation, r.view, r.layout], ['update', 'flowchart', 'lanes'], q);
    }
    // In another language too.
    const es = resolveDiagramRequest({ question: 'Add an approval step after Review', activeDesign: { ...stored, question: 'Dibuja un diagrama de carriles del proceso de reembolso' }, answerType: 'general' });
    assert.deepEqual([es.view, es.layout], ['flowchart', 'lanes']);
    // A tree keeps being one.
    const tree = { artifactId: 't.v1', artifact: 'mermaid', view: 'flowchart', version: 1, foreground: true, question: 'Show the org structure as a tree', source: 'flowchart TD\n  co["Company"] --> eng["Engineering"]\n  co --> fin["Finance"]' };
    const t = resolveDiagramRequest({ question: 'Add a Platform node under Engineering', activeDesign: tree, answerType: 'general' });
    assert.deepEqual([t.operation, t.layout], ['update', 'tree']);
    // The way an org chart is really edited: something placed under one of its own names.
    for (const q of ['Add a Platform team under Engineering', 'Add a VP of Sales under Finance', 'Add a Legal group below Finance']) {
      const r = resolveDiagramRequest({ question: q, activeDesign: tree, answerType: 'general' });
      assert.deepEqual([r.enabled, r.operation, r.layout], [true, 'update', 'tree'], q);
    }
    // An architecture with groups, asked for as an architecture, is not lanes; a question about lanes changes nothing either.
    const grouped = { ...lanes, view: 'architecture', question: 'Design a refund system' };
    const g = resolveDiagramRequest({ question: 'Add a cache in front of Review', activeDesign: grouped, answerType: 'general' });
    assert.deepEqual([g.operation, g.view, g.layout], ['update', 'architecture', undefined]);
    const explain = resolveDiagramRequest({ question: 'Why does Support review it?', activeDesign: stored, answerType: 'general' });
    assert.equal(explain.layout, undefined);
  });

  test('the lanes are read back from the source', () => {
    for (const q of ['Add a finance lane that approves anything over 500', 'Add an approval step after Review']) {
      const r = resolveDiagramRequest({ question: q, activeDesign: lanes, answerType: 'general' });
      assert.deepEqual([r.operation, r.layout], ['update', 'lanes'], q);
    }
  });

  test('a flowchart with no lanes gets none, and one subgraph is not lanes', () => {
    assert.equal(resolveDiagramRequest({ question: 'Add an approval step after Review', activeDesign: plain, answerType: 'general' }).layout, undefined);
    const one = { ...plain, source: 'flowchart TD\n  subgraph Flow\n    a["Request refund"] --> b["Review"]\n  end' };
    assert.equal(resolveDiagramRequest({ question: 'Add an approval step after Review', activeDesign: one, answerType: 'general' }).layout, undefined);
  });
});
