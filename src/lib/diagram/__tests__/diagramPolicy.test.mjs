import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkDiagramSource,
  detectDiagramType,
  estimateDiagramComplexity,
  isSafeDiagramSvg,
  diagramSourceKey,
  diagramViewLabel,
  diagramCardLabel,
  describeDiagramRejection,
  DIAGRAM_LIMITS,
  DIAGRAM_SVG_MAX_CHARS,
  renameReservedFlowchartIds,
  RESERVED_FLOWCHART_IDS,
} from '../diagramPolicy.mjs';
import { VISUAL_CATALOG, VISUAL_VIEWS, visualKind, fenceTagForView } from '../visualCatalog.mjs';
import { compileVisualSource } from '../visualArtifact.mjs';
import { DIAGRAM_EXAMPLES, selectDiagramExamples, renderDiagramExamplesBlock, DIAGRAM_EXAMPLE_TOKEN_BUDGET } from '../diagramExamples.mjs';

const FLOW = 'flowchart LR\n    client["Client"] -->|"HTTPS"| api["API Service"]\n    api --> db[("Store")]';

describe('checkDiagramSource — supported families', () => {
  test('flowchart, graph, sequence, state, class and ER are accepted', () => {
    const cases = {
      flowchart: FLOW,
      graph: 'graph TD\n    a --> b',
      sequence: 'sequenceDiagram\n    participant A\n    A->>B: hi',
      state: 'stateDiagram-v2\n    [*] --> Placed\n    Placed --> [*]',
      class: 'classDiagram\n    class Lot\n    Lot --> Spot',
      er: 'erDiagram\n    ORDER ||--o{ ITEM : contains',
    };
    for (const [name, source] of Object.entries(cases)) {
      const r = checkDiagramSource(source);
      assert.equal(r.ok, true, `${name}: ${r.rejection}`);
    }
    assert.equal(checkDiagramSource(cases.sequence).view, 'sequence');
    assert.equal(checkDiagramSource(cases.state).view, 'state');
  });

  test('other families are rejected with a readable reason', () => {
    // Numeric Mermaid families are refused on purpose: numbers go through `natively-chart`.
    for (const source of ['pie title Pets\n    "Dogs" : 3', 'xychart-beta\n    bar [1, 2]', 'quadrantChart\n    title x', 'sankey-beta\nA,B,1', 'journey\n    title x', 'architecture-beta\n    group api', 'C4Context\n  title x', 'just some prose']) {
      const r = checkDiagramSource(source);
      assert.equal(r.ok, false, source);
      assert.equal(r.rejection, 'unsupported_type');
      assert.ok(r.message.length > 10);
    }
  });

  test('an empty block is rejected', () => {
    assert.equal(checkDiagramSource('').rejection, 'empty');
    assert.equal(checkDiagramSource('  \n\n ').rejection, 'empty');
    assert.equal(checkDiagramSource('%%{init: {"theme":"dark"}}%%').rejection, 'empty');
  });

  test('comment lines before the header are skipped', () => {
    assert.equal(detectDiagramType('%% a comment\n\nflowchart LR\n  a --> b').type, 'flowchart');
  });
});

describe('checkDiagramSource — config and interaction are neutralised', () => {
  test('an init directive is removed from what gets rendered, not from what was written', () => {
    const source = "%%{init: {'theme':'forest','securityLevel':'loose'}}%%\n" + FLOW;
    const r = checkDiagramSource(source);
    assert.equal(r.ok, true);
    assert.deepEqual(r.neutralised, ['directive']);
    assert.ok(!r.renderSource.includes('%%{'));
    assert.ok(r.renderSource.startsWith('flowchart LR'));
  });

  test('a multi-line directive and frontmatter are both removed', () => {
    const source = '---\nconfig:\n  theme: forest\n---\n%%{\n  init: { "flowchart": { "htmlLabels": true } }\n}%%\n' + FLOW;
    const r = checkDiagramSource(source);
    assert.equal(r.ok, true);
    assert.deepEqual(r.neutralised.sort(), ['directive', 'frontmatter']);
    assert.equal(r.renderSource, FLOW);
  });

  test('click and link statements are removed', () => {
    const r = checkDiagramSource(FLOW + '\n    click client call doThing()\n    click api "x" "tip"');
    assert.equal(r.ok, true);
    assert.deepEqual(r.neutralised, ['interaction']);
    assert.ok(!/click/.test(r.renderSource));
    const seq = checkDiagramSource('sequenceDiagram\n    participant A\n    links A: {"Docs": "x"}\n    A->>B: hi');
    assert.equal(seq.ok, true);
    assert.ok(!/links/.test(seq.renderSource));
  });

  test('a node merely NAMED like a keyword is not removed', () => {
    const r = checkDiagramSource('flowchart LR\n    clicker["Click Tracker"] --> linker["Link Service"]');
    assert.equal(r.ok, true);
    assert.deepEqual(r.neutralised, []);
    assert.ok(r.renderSource.includes('clicker'));
  });
});

describe('checkDiagramSource — active or remote content is rejected', () => {
  const rejected = {
    'http image shape': 'flowchart LR\n    a@{ img: "https://example.com/x.png" } --> b',
    'icon shape': 'flowchart LR\n    a@{ icon: "fa:user" } --> b',
    'remote url in a style': 'flowchart LR\n    a --> b\n    style a fill:url(https://example.com/x.svg#p)',
    'javascript url': 'flowchart LR\n    a["javascript:alert(1)"] --> b',
    'data url': 'flowchart LR\n    a["data:text/html;base64,AAAA"] --> b',
    'css url()': 'flowchart LR\n    a --> b\n    style a fill:url(x)',
  };
  for (const [name, source] of Object.entries(rejected)) {
    test(`${name} → remote_resource`, () => {
      assert.equal(checkDiagramSource(source).rejection, 'remote_resource');
    });
  }

  for (const [name, label] of Object.entries({
    script: '<script>alert(1)</script>',
    'img onerror': '<img src=x onerror=alert(1)>',
    iframe: '<iframe src="x"></iframe>',
    'handler attribute': '<b onclick="x()">hi</b>',
    'anchor href': '<a href="x">y</a>',
    foreignObject: '<foreignObject></foreignObject>',
  })) {
    test(`${name} → raw_html`, () => {
      assert.equal(checkDiagramSource(`flowchart LR\n    a["${label}"] --> b`).rejection, 'raw_html');
    });
  }

  test('ordinary label text is NOT mistaken for active content', () => {
    for (const label of ['Upload file: 5 MB', 'data: user row', 'List<String> items', 'x <br/> y', 'a < b and b > c', 'retry once = ok', 'cost is $5 * 2', 'GET /users/{id}']) {
      const r = checkDiagramSource(`flowchart LR\n    a["${label}"] --> b`);
      assert.equal(r.ok, true, `${label}: ${r.rejection}`);
    }
    assert.equal(checkDiagramSource('stateDiagram-v2\n    state check <<choice>>\n    [*] --> check').ok, true);
  });
});

describe('checkDiagramSource — size', () => {
  test('a source over the character limit is rejected before anything else', () => {
    const big = 'flowchart LR\n' + '    a --> b\n'.repeat(1000);
    assert.ok(big.length > DIAGRAM_LIMITS.maxSourceChars);
    assert.equal(checkDiagramSource(big).rejection, 'too_large');
  });

  test('a graph over the node or edge limit is rejected', () => {
    const nodes = ['flowchart LR', ...Array.from({ length: 80 }, (_, i) => `    n${i}["N${i}"] --> n${i + 1}["N${i + 1}"]`)].join('\n');
    const r = checkDiagramSource(nodes);
    assert.equal(r.rejection, 'too_large');
    assert.ok(r.complexity.nodes > DIAGRAM_LIMITS.maxNodes);
  });

  test('limits are configurable', () => {
    assert.equal(checkDiagramSource(FLOW, { limits: { maxNodes: 2 } }).rejection, 'too_large');
    assert.equal(checkDiagramSource(FLOW, { allowedTypes: ['sequence'] }).rejection, 'unsupported_type');
  });

  test('complexity estimates are in the right neighbourhood', () => {
    assert.deepEqual(estimateDiagramComplexity(FLOW), { nodes: 3, edges: 2, lines: 3 });
    const seq = estimateDiagramComplexity('sequenceDiagram\n    participant A\n    participant B\n    A->>B: hi\n    B-->>A: ok');
    assert.equal(seq.nodes, 2);
    assert.equal(seq.edges, 2);
    const state = estimateDiagramComplexity('stateDiagram-v2\n    [*] --> Placed\n    Placed --> Paid: pay\n    Paid --> [*]');
    assert.equal(state.nodes, 2);
    assert.equal(state.edges, 3);
  });

  test('arrow-like text inside a label is not counted as a connection', () => {
    assert.equal(estimateDiagramComplexity('flowchart LR\n    a["x --> y --> z"] --> b').edges, 1);
  });
});

describe('isSafeDiagramSvg', () => {
  const ok = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><marker id="m"><path d="M0 0"/></marker></defs><style>.a{fill:#fff}</style><path marker-end="url(#m)" d="M0 0"/><text>retry once = ok</text></svg>';
  test('a plain drawing with a local marker reference passes', () => {
    assert.equal(isSafeDiagramSvg(ok), true);
  });
  test('anything that could load or run is refused', () => {
    const bad = [
      ok.replace('<path marker', '<script>alert(1)</script><path marker'),
      ok.replace('<text>', '<foreignObject><div>x</div></foreignObject><text>'),
      ok.replace('<text>', '<image href="https://example.com/x.png"/><text>'),
      ok.replace('<text>', '<a href="https://example.com"><text>x</text></a><text>'),
      ok.replace('.a{fill:#fff}', '.a{fill:url(https://example.com/x)}'),
      ok.replace('.a{fill:#fff}', '@import "https://example.com/x.css";'),
      ok.replace('<path marker-end', '<path onload="x()" marker-end'),
      ok.replace('<path marker-end', '<use href="other.svg#x"/><path marker-end'),
    ];
    for (const svg of bad) assert.equal(isSafeDiagramSvg(svg), false, svg.slice(0, 160));
  });
  test('non-SVG, truncated and oversized input is refused', () => {
    assert.equal(isSafeDiagramSvg('<div>hi</div>'), false);
    assert.equal(isSafeDiagramSvg('<svg><path d="M0 0"/>'), false);
    assert.equal(isSafeDiagramSvg(null), false);
    assert.equal(isSafeDiagramSvg(''), false);
    assert.equal(isSafeDiagramSvg('<svg>' + 'x'.repeat(DIAGRAM_SVG_MAX_CHARS) + '</svg>'), false);
  });
});

describe('small helpers', () => {
  test('diagramSourceKey ignores line-ending and edge whitespace differences only', () => {
    assert.equal(diagramSourceKey(FLOW), diagramSourceKey(FLOW.replace(/\n/g, '\r\n') + '\n'));
    assert.notEqual(diagramSourceKey(FLOW), diagramSourceKey(FLOW + '\n    api --> cache'));
  });
  test('labels and messages exist for every case', () => {
    assert.equal(diagramViewLabel('sequence'), 'Sequence diagram');
    assert.equal(diagramViewLabel('architecture'), 'Architecture diagram');
    assert.equal(diagramViewLabel(undefined), 'Diagram');
    // The card title is the same on the desktop card and on the phone.
    assert.equal(diagramCardLabel('flowchart'), 'Diagram');
    assert.equal(diagramCardLabel('sequence'), 'Sequence diagram');
    assert.equal(diagramCardLabel(null), 'Diagram');
    assert.match(describeDiagramRejection('too_large'), /too large/);
    assert.match(describeDiagramRejection('nope'), /could not be drawn/);
  });
});

describe('curated examples', () => {
  // The six system-design entries the library started with, and the catalog
  // entries added for the nine meeting modes (version 2).
  const ORIGINAL = DIAGRAM_EXAMPLES.filter((e) => !e.modes);
  const CATALOG = DIAGRAM_EXAMPLES.filter((e) => e.modes);

  test('six system-design entries and sixteen catalog entries, with unique ids and every required field', () => {
    assert.equal(ORIGINAL.length, 6);
    assert.equal(CATALOG.length, 16);
    assert.equal(new Set(DIAGRAM_EXAMPLES.map((e) => e.id)).size, DIAGRAM_EXAMPLES.length);
    for (const e of DIAGRAM_EXAMPLES) {
      for (const field of ['id', 'view', 'question', 'rationale']) assert.ok(e[field], `${e.id}.${field}`);
      assert.ok(e.mermaid || e.body, `${e.id} has no content`);
      assert.ok(Array.isArray(e.constraints) && Array.isArray(e.assumptions) && e.topics.length > 0, e.id);
      assert.ok(VISUAL_CATALOG[e.view], `${e.id}: "${e.view}" is not a view in the capability registry`);
    }
  });

  test('every Mermaid example passes policy and stays inside the size the contract asks for', () => {
    for (const e of DIAGRAM_EXAMPLES.filter((x) => !x.fence || x.fence === 'mermaid')) {
      const r = checkDiagramSource(e.mermaid);
      assert.equal(r.ok, true, `${e.id}: ${r.rejection}`);
      // Gantt gets its "today" line removed and nothing else is ever touched.
      assert.deepEqual(r.neutralised, [], `${e.id} carries config or interaction`);
      assert.ok(r.complexity.nodes <= 12 && r.complexity.edges <= 20, `${e.id}: ${JSON.stringify(r.complexity)}`);
      assert.equal(visualKind(e.view).renderer, 'mermaid', `${e.id} is Mermaid but its view is not drawn by Mermaid`);
    }
  });

  test('every chart and notation example is accepted by the adapter that will draw it', () => {
    const payloads = DIAGRAM_EXAMPLES.filter((e) => e.fence === 'natively-chart' || e.fence === 'natively-diagram');
    assert.ok(payloads.length >= 6);
    for (const e of payloads) {
      const compiled = compileVisualSource(e.fence === 'natively-chart' ? 'chart' : 'notation', e.body);
      assert.equal(compiled.ok, true, `${e.id}: ${compiled.message}`);
      assert.equal(fenceTagForView(e.view), e.fence, `${e.id} is written in the wrong block for its view`);
    }
    for (const e of DIAGRAM_EXAMPLES.filter((x) => x.fence === 'table')) {
      assert.match(e.body, /^\|.+\|\n\| ?-{3}/, `${e.id} is not a Markdown table`);
      assert.equal(visualKind(e.view).renderer, 'table');
    }
  });

  test('a chart example only uses numbers its own question states', () => {
    // Examples teach representation. A number in a reference payload that the
    // reference question never gave would teach a model to make numbers up.
    for (const e of DIAGRAM_EXAMPLES.filter((x) => x.fence === 'natively-chart')) {
      const question = e.question.replace(/,/g, '');
      const numbers = [...e.body.matchAll(/(?<![\w."])\d+(?:\.\d+)?(?![\w"])/g)].map((m) => m[0]).filter((n) => Number(n) >= 10);
      for (const n of numbers) assert.ok(question.includes(n), `${e.id}: ${n} is in the payload but not in the question`);
    }
  });

  test('no original example presents an invented number as a requirement', () => {
    for (const e of ORIGINAL) {
      for (const c of e.constraints) assert.ok(!/\d{2,}/.test(c), `${e.id} constraint carries a number: ${c}`);
      for (const a of e.assumptions) assert.match(a, /^Assumed:|^Traffic|^Assumed/, `${e.id} assumption is not labelled: ${a}`);
    }
  });

  test('every built-in mode and every catalog view has at least one example', () => {
    for (const mode of ['general', 'looking-for-work', 'technical-interview', 'sales', 'recruiting', 'team-meet', 'lecture', 'seminar', 'call-center']) {
      assert.ok(CATALOG.some((e) => e.modes.includes(mode)), `no catalog example for ${mode}`);
    }
    for (const view of VISUAL_VIEWS) assert.ok(DIAGRAM_EXAMPLES.some((e) => e.view === view), `no example for the "${view}" view`);
  });

  test('a catalog view takes examples of its own view only', () => {
    assert.deepEqual(selectDiagramExamples({ question: 'Model customers and orders', view: 'er', mode: 'technical-interview' }).map((e) => e.id), ['er-customer-order']);
    assert.deepEqual(selectDiagramExamples({ question: 'What would revenue look like at 5% monthly growth?', view: 'chart', chartIntent: 'forecast', mode: 'sales' }).map((e) => e.id), ['chart-forecast-net-growth']);
    assert.deepEqual(selectDiagramExamples({ question: 'Where are deals dropping out?', view: 'chart', chartIntent: 'funnel', mode: 'sales' }).map((e) => e.id), ['chart-stage-counts']);
    assert.deepEqual(selectDiagramExamples({ question: 'Show when it pays back', view: 'chart', chartIntent: 'breakeven', mode: 'sales' }).map((e) => e.id), ['chart-break-even']);
    assert.deepEqual(selectDiagramExamples({ question: 'Walk me through diagnosing this issue', view: 'decision', mode: 'call-center' }).map((e) => e.id), ['decision-troubleshooting']);
    // An order-related ER question never borrows the order-lifecycle STATE example, and the reverse.
    assert.ok(selectDiagramExamples({ question: 'Model the order tables', view: 'er' }).every((e) => e.view === 'er'));
    assert.ok(selectDiagramExamples({ question: 'Design an orders service for customers', view: 'architecture' }).every((e) => e.view === 'architecture' || e.view === 'flowchart'));
  });

  test('the selector picks by topic and view, one by default, never more than two', () => {
    assert.deepEqual(selectDiagramExamples({ question: 'Design a URL shortener that handles a million redirects', view: 'architecture' }).map((e) => e.id), ['url-shortener-high-traffic']);
    assert.deepEqual(selectDiagramExamples({ question: 'Design a chat system', view: 'architecture' }).map((e) => e.id), ['chat-realtime']);
    assert.deepEqual(selectDiagramExamples({ question: 'Design a notification service with retries', view: 'architecture' }).map((e) => e.id), ['notification-jobs']);
    assert.deepEqual(selectDiagramExamples({ question: 'Show the authentication sequence', view: 'sequence' }).map((e) => e.id), ['auth-login-sequence']);
    assert.deepEqual(selectDiagramExamples({ question: 'Draw an order lifecycle as a state machine', view: 'state' }).map((e) => e.id), ['order-lifecycle-state']);
    assert.equal(selectDiagramExamples({ question: 'Design a URL shortener', view: 'architecture', max: 2 }).length, 2);
    assert.equal(selectDiagramExamples({ question: 'Design a URL shortener', view: 'architecture', max: 9 }).length, 2);
    assert.deepEqual(selectDiagramExamples({ question: 'Design a URL shortener', view: 'architecture', max: 0 }), []);
  });

  test('an unrelated question still gets a same-view example, by view alone', () => {
    const picked = selectDiagramExamples({ question: 'Design a metrics platform', view: 'architecture' });
    assert.equal(picked.length, 1);
    assert.equal(picked[0].view, 'architecture');
  });

  test('the token budget drops examples that do not fit', () => {
    assert.deepEqual(selectDiagramExamples({ question: 'Design a chat system', view: 'architecture', tokenBudget: 20 }), []);
    const two = selectDiagramExamples({ question: 'Design a URL shortener', view: 'architecture', max: 2 });
    const chars = renderDiagramExamplesBlock(two).length;
    assert.ok(chars / 4 <= DIAGRAM_EXAMPLE_TOKEN_BUDGET + 60, `two examples cost ~${Math.round(chars / 4)} tokens`);
  });

  test('the prompt block frames examples as style, not as facts about the meeting', () => {
    const block = renderDiagramExamplesBlock(selectDiagramExamples({ question: 'Design a chat system', view: 'architecture' }));
    assert.match(block, /style only/i);
    assert.match(block, /NOT facts about this conversation/);
    assert.ok(block.includes('```mermaid'));
    assert.equal(renderDiagramExamplesBlock([]), '');
  });
});

describe('Mermaid keywords used as node ids', () => {
  // Found live (DeepSeek, 2026-10-01): the "Social Graph" node was called
  // `graph`, which the flowchart grammar reads as a keyword. Which words break
  // is measured in tests/diagram/mermaid-render.check.mjs against the pinned Mermaid.
  const LIVE = [
    'flowchart LR',
    '    client["Client"] -->|"GET /timeline"| tl["Timeline Service"]',
    '    fanout["Fan-out Service"] -->|"lookup followers"| graph[("Social Graph")]',
    '    graph -.->|"skip if celebrity"| celebs[("Celebrity List")]',
    '    tl --> graph',
  ].join('\n');

  test('the id is renamed on every line; labels and other ids are untouched', () => {
    const { text, renamed } = renameReservedFlowchartIds(LIVE);
    assert.deepEqual(renamed, ['graph']);
    assert.ok(text.includes('graph_node[("Social Graph")]'));
    assert.ok(text.includes('graph_node -.->|"skip if celebrity"|'));
    assert.ok(text.endsWith('tl --> graph_node'));
    assert.ok(text.startsWith('flowchart LR\n'), 'the header keeps its keyword');
    assert.equal((text.match(/(?<![A-Za-z_])graph(?![A-Za-z_])/g) || []).length, 0, 'no bare `graph` id is left');
    assert.ok(text.includes('"Social Graph"'));
  });

  test('a `graph TD` header is a header, not an id', () => {
    const src = 'graph TD\n    a["A"] --> b["B"]';
    assert.deepEqual(renameReservedFlowchartIds(src), { text: src, renamed: [] });
  });

  test('the word inside a label is never touched: quoted, unquoted, edge label', () => {
    const src = [
      'flowchart LR',
      '    a["the end of the call"] -->|"click to call"| b[class and style]',
      '    b --> c(("graph"))',
      '    c --> d{end}',
    ].join('\n');
    assert.deepEqual(renameReservedFlowchartIds(src), { text: src, renamed: [] });
  });

  test('subgraph … end and style statements keep their keywords', () => {
    const src = [
      'flowchart LR',
      '    subgraph edge ["Edge"]',
      '        direction TB',
      '        lb["Load Balancer"]',
      '    end',
      '    lb --> end',
      '    end --> style["Style Service"]',
      '    style api fill:#fff',
      '    classDef hot fill:#f00',
      '    class lb hot',
    ].join('\n');
    const { text, renamed } = renameReservedFlowchartIds(src);
    assert.deepEqual(renamed.sort(), ['end', 'style']);
    const lines = text.split('\n');
    assert.equal(lines[1], '    subgraph edge ["Edge"]');
    assert.equal(lines[4], '    end', 'the subgraph terminator');
    assert.equal(lines[5], '    lb --> end_node');
    assert.equal(lines[6], '    end_node --> style_node["Style Service"]');
    assert.equal(lines[7], '    style api fill:#fff', 'a style statement, not a node');
    assert.equal(lines[8], '    classDef hot fill:#f00');
    assert.equal(lines[9], '    class lb hot');
  });

  test('longer ids that merely contain a keyword are left alone', () => {
    const src = 'flowchart LR\n    endpoint["Endpoint"] --> graphql["GraphQL"]\n    graphql --> class_a["A"]\n    backend --> call_log["Calls"]';
    assert.deepEqual(renameReservedFlowchartIds(src), { text: src, renamed: [] });
  });

  test('the new id never collides with one the diagram already uses', () => {
    const src = 'flowchart LR\n    graph_node["Existing"] --> graph[("Social Graph")]';
    const { text } = renameReservedFlowchartIds(src);
    assert.ok(text.includes('graph_node["Existing"] --> graph_node_[("Social Graph")]'), text);
  });

  test('the policy check applies it to flowcharts only and says so', () => {
    const flow = checkDiagramSource(LIVE);
    assert.equal(flow.ok, true);
    assert.ok(flow.neutralised.includes('reserved_id'));
    assert.ok(flow.renderSource.includes('graph_node[("Social Graph")]'));
    const clean = checkDiagramSource('flowchart LR\n    a["A"] --> b["B"]');
    assert.deepEqual(clean.neutralised, []);
    // `end` is a real sequence keyword (closes alt/loop): never rewritten there.
    const seq = checkDiagramSource('sequenceDiagram\n    participant a as A\n    alt ok\n        a->>a: done\n    end');
    assert.equal(seq.ok, true);
    assert.deepEqual(seq.neutralised, []);
    assert.ok(seq.renderSource.trimEnd().endsWith('end'));
  });

  test('the keyword list is what the contract warns the model about', () => {
    for (const word of ['graph', 'end', 'subgraph', 'class', 'style', 'click', 'call']) assert.ok(RESERVED_FLOWCHART_IDS.includes(word), word);
  });
});

describe('final review (2026-10-02): what the last pass found in the policy', () => {
  test('a node CALLED link, click or style is a node, even with an address in its label', () => {
    for (const source of [
      'flowchart LR\n    link["Short link https://sho.rt/abc"] --> db[("Links DB")]',
      'flowchart LR\n    client["Browser"] --> link\n    link("Redirect to https://example.com/long") --> db',
      'flowchart LR\n    click["Click event wss://stream.example.com"] --> q["Queue"]',
      'flowchart LR\n    style["Style service https://cdn.example.com"] --> api["API"]',
    ]) {
      assert.equal(checkDiagramSource(source).ok, true, source);
    }
  });

  test('…and a real click, link or style statement with an address is still refused', () => {
    for (const source of [
      'flowchart LR\n    a["A"] --> b["B"]\n    click a href "https://evil.example/x"',
      'flowchart LR\n    a["A"] --> b["B"]\n    click a "https://evil.example/x" _blank',
      'flowchart LR\n    a["A"] --> b["B"]\n    style a fill:url(https://evil.example/x.png)',
      'sequenceDiagram\n    participant A\n    link A: Dashboard @ https://evil.example\n    A->>A: hi',
    ]) {
      const result = checkDiagramSource(source);
      // Either refused outright or the statement is removed before drawing: never kept.
      assert.ok(!result.ok || !/evil\.example/.test(result.source), source);
    }
  });

  test('rendered SVG: an address hidden behind CSS escapes or image-set() is not let through', () => {
    const wrap = (style) => `<svg xmlns="http://www.w3.org/2000/svg"><style>${style}</style><rect width="1" height="1"/></svg>`;
    for (const style of [
      '.a{fill:\\75rl(http://evil.example/x)}',
      '.a{fill:\\75 rl(http://evil.example/x)}',
      '.a{background:image-set("http://evil.example/x" 1x)}',
      '.a{background:-webkit-image-set("http://evil.example/x" 1x)}',
      '.a{background:\\000075\\000072\\00006c(//evil.example/x)}',
      '@\\69mport "http://evil.example/x.css";',
      '.a{behavior:\\65xpression(alert(1))}',
      '.a{fill:u\\rl(http://evil.example/x)}',
    ]) {
      assert.equal(isSafeDiagramSvg(wrap(style)), false, style);
    }
    assert.equal(isSafeDiagramSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:\\75rl(http://evil.example/x)" width="1" height="1"/></svg>'), false);
    // What a drawing's own style looks like stays fine.
    for (const style of ['.node rect{fill:#eef;stroke:#333}', '.edge{marker-end:url(#arrow)}', '.label{font-family:"trebuchet ms",verdana,arial,sans-serif}', '.a::after{content:"\\201C"}']) {
      assert.equal(isSafeDiagramSvg(wrap(style)), true, style);
    }
  });
});
