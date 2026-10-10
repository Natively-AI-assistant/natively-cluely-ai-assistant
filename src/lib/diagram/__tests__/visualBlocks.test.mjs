// Chart and notation blocks through the same block machinery as Mermaid:
// the fence scanner, the streaming gates, the saved-answer splitter, the
// refinement guard and the session's artifact state.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFencedBlocks, createFencedBlockTracker, isVisualBlock, hasVisualFence, hasMermaidFence, extractVisualBlocks, extractMermaidBlocks, mentionsVisualTag, VISUAL_FENCE_LANGS, VISUAL_FENCE_TAG } from '../fencedBlocks.mjs';
import { hasOpeningMermaidFence, mayHoldMermaidFence, isMermaidOpeningTail, shouldUseStreamingDiagramUi, fastForwardDiagramReveal, completedDiagramCount, previousVersionFor } from '../diagramStreamUi.mjs';
import { splitAnswerForDiagrams } from '../diagramSegments.mjs';
import { preserveDiagramsInRefinement, refinementTouchesDesign, refineRuleFor, REFINE_DIAGRAM_RULE, REFINE_VISUAL_RULE } from '../diagramRefine.mjs';
import { createActiveDesignState, latestDiagramInAnswer, activeDesignFromHistory } from '../activeDesign.mjs';

const fence = (tag, body) => '```' + tag + '\n' + body + '\n```';
const chartJson = (ratePercent, title = 'Monthly revenue') => JSON.stringify({ v: 1, type: 'line', title, y: { label: 'Revenue', unit: 'USD' }, compute: { kind: 'compound_growth', baseline: 10000, ratePercent, period: 'month', periods: 3 } });
const CHART = fence('natively-chart', chartJson(5));
const CHEN = fence('natively-diagram', JSON.stringify({ kind: 'chen-er', entities: ['Customer', 'Order'], relationships: [{ name: 'places', participants: [{ entity: 'Customer', cardinality: '1' }, { entity: 'Order', cardinality: 'N' }] }] }));
const MERMAID = fence('mermaid', 'flowchart LR\n    a["API"] --> b["Queue"]');
const ANSWER = `A scenario at 5%.\n\n${CHART}\n\nIt rests on one assumption.`;

describe('the fence scanner', () => {
  test('three tags are visual artifacts; everything else is code', () => {
    assert.deepEqual(VISUAL_FENCE_LANGS, { mermaid: 'mermaid', 'natively-chart': 'chart', 'natively-diagram': 'notation' });
    assert.deepEqual(VISUAL_FENCE_TAG, { mermaid: 'mermaid', chart: 'natively-chart', notation: 'natively-diagram' });
    const kinds = (text) => parseFencedBlocks(text).blocks.filter((b) => b.kind !== 'prose').map((b) => b.kind);
    assert.deepEqual(kinds(`${CHART}\n\n${CHEN}\n\n${MERMAID}\n\n${fence('json', '{"a":1}')}\n\n${fence('', 'x')}`), ['chart', 'notation', 'mermaid', 'code', 'code']);
  });

  test('a JSON block that merely LOOKS like a chart is code: only the tag decides', () => {
    const blocks = parseFencedBlocks(fence('json', chartJson(5))).blocks;
    assert.equal(blocks[0].kind, 'code');
    assert.equal(hasVisualFence(fence('json', chartJson(5))), false);
    assert.equal(parseFencedBlocks(fence('natively-charts', '{}')).blocks[0].kind, 'code', 'a near-miss tag is not a chart');
  });

  test('visual blocks share one ordinal; ordinary code has none', () => {
    const blocks = parseFencedBlocks(`${MERMAID}\n\n${fence('ts', 'x')}\n\n${CHART}\n\n${CHEN}`).blocks.filter((b) => b.kind !== 'prose');
    assert.deepEqual(blocks.map((b) => b.diagramIndex), [0, -1, 1, 2]);
    assert.ok(blocks.filter(isVisualBlock).length === 3);
  });

  test('helpers', () => {
    assert.equal(hasVisualFence(ANSWER), true);
    assert.equal(hasMermaidFence(ANSWER), false, 'a chart is not Mermaid');
    assert.equal(extractVisualBlocks(ANSWER).length, 1);
    assert.equal(extractMermaidBlocks(ANSWER).length, 0);
    assert.equal(mentionsVisualTag('no fences here'), false);
    assert.equal(mentionsVisualTag('talks about natively-chart in prose'), true);
    assert.equal(hasVisualFence('talks about natively-chart in prose'), false);
  });

  test('a chart split at every possible chunk boundary is one closed block with the same bytes', () => {
    const want = parseFencedBlocks(ANSWER, { final: true }).blocks;
    for (let cut = 1; cut < ANSWER.length; cut += 1) {
      const tracker = createFencedBlockTracker();
      tracker.update(ANSWER.slice(0, cut));
      const got = tracker.update(ANSWER, { final: true }).blocks;
      assert.deepEqual(got, want, `cut at ${cut}`);
    }
    assert.equal(want.find((b) => b.kind === 'chart').source, chartJson(5));
  });

  test('a chart is never treated as complete before its closing fence has arrived', () => {
    const open = ANSWER.indexOf('```natively-chart');
    const close = ANSWER.indexOf('```', open + 5);
    for (let cut = open + 20; cut <= close + 2; cut += 1) {
      const block = parseFencedBlocks(ANSWER.slice(0, cut), { final: false }).blocks.find((b) => b.kind === 'chart');
      assert.equal(block.closed, false, `cut at ${cut}`);
    }
  });
});

describe('the streaming gates', () => {
  test('an opening chart or notation fence switches the stream to the card path', () => {
    assert.equal(hasOpeningMermaidFence('Here it is.\n\n```natively-chart\n{'), true);
    assert.equal(hasOpeningMermaidFence('Here it is.\n\n```natively-diagram\n{'), true);
    assert.equal(hasOpeningMermaidFence('Here it is.\n\n```json\n{'), false);
    assert.equal(hasOpeningMermaidFence('we could use natively-chart for this'), false, 'the tag in prose is not a fence');
    assert.equal(shouldUseStreamingDiagramUi('-chart\n', 'Scenario.\n\n```natively'), true);
    assert.equal(shouldUseStreamingDiagramUi('on\n', 'Code.\n\n```pyth'), false);
  });

  test('a fence line that is turning into a visual tag stays hidden; any other shows at once', () => {
    const tail = (text) => parseFencedBlocks(text, { final: false }).tail;
    for (const partial of ['```n', '```nat', '```natively', '```natively-', '```natively-c', '```natively-d', '```m', '```merm']) {
      assert.equal(isMermaidOpeningTail(tail(`Lead.\n\n${partial}`)), true, partial);
      assert.equal(mayHoldMermaidFence(`Lead.\n\n${partial}`, true), true, partial);
    }
    for (const partial of ['```p', '```json', '```native', '```natively-x', '```nix']) {
      assert.equal(isMermaidOpeningTail(tail(`Lead.\n\n${partial}`)), partial === '```native' ? true : false, partial);
    }
    assert.equal(mayHoldMermaidFence('Lead.\n\n```py', true), false);
    assert.equal(mayHoldMermaidFence('Lead.\n\n```nat', false), false, 'only while streaming');
  });

  test('the reveal jumps over a chart payload, and only over it', () => {
    const { blocks } = parseFencedBlocks(ANSWER, { final: false });
    const chart = blocks.find((b) => b.kind === 'chart');
    assert.equal(fastForwardDiagramReveal(blocks, chart.start + 3, ANSWER.length), chart.end);
    assert.equal(fastForwardDiagramReveal(blocks, chart.start - 5, ANSWER.length), chart.start - 5, 'text before it keeps its pace');
    assert.equal(fastForwardDiagramReveal(blocks, chart.end + 2, ANSWER.length), chart.end + 2, 'text after it keeps its pace');
    assert.equal(completedDiagramCount(blocks), 1);
  });

  test('the previous chart stays up while its update is written, and not for an unrelated one', () => {
    const previous = chartJson(5);
    const partialUpdate = chartJson(3).slice(0, 90);
    assert.equal(previousVersionFor(partialUpdate, previous), previous);
    const unrelated = JSON.stringify({ v: 1, type: 'funnel', title: 'Hiring stages', stages: [{ label: 'Applied', value: 90 }] }).slice(0, 80);
    assert.equal(previousVersionFor(unrelated, previous), undefined);
  });
});

describe('saved answers and meeting chat', () => {
  test('a chart and a notation block are cut out for the card; the rest stays Markdown', () => {
    const segments = splitAnswerForDiagrams(`Lead.\n\n${CHART}\n\nMiddle with a table:\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n${CHEN}\n\nTail.`);
    assert.deepEqual(segments.map((s) => (s.type === 'diagram' ? `${s.type}:${s.artifact}:${s.complete}` : s.type)), ['markdown', 'diagram:chart:true', 'markdown', 'diagram:notation:true', 'markdown']);
    assert.equal(segments[1].source, chartJson(5));
    assert.ok(segments[2].text.includes('| 1 | 2 |'), 'an ordinary Markdown table is left to the Markdown renderer');
    assert.equal(segments[1].description, 'Lead.');
  });

  test('an answer with none is one untouched chunk', () => {
    const text = 'Plain answer with `natively-chart` mentioned in prose and a ```json\n{}\n``` block.';
    assert.deepEqual(splitAnswerForDiagrams(text), [{ type: 'markdown', key: 'm0', text }]);
  });
});

describe('rewording an answer leaves its numbers and its notation alone', () => {
  test('"make it shorter" does not touch a chart', () => {
    assert.equal(refinementTouchesDesign('shorten'), false);
    assert.equal(refinementTouchesDesign('make it more casual'), false);
    assert.equal(refineRuleFor(ANSWER), REFINE_VISUAL_RULE);
    assert.equal(refineRuleFor(`Design.\n\n${MERMAID}`), REFINE_DIAGRAM_RULE, 'a Mermaid-only answer keeps the original wording');
    assert.equal(refineRuleFor('No visual here.'), '');
    assert.match(REFINE_VISUAL_RULE, /Do not change, round, rename, reorder or drop anything inside it/);
  });

  test('a request about the numbers or the notation is not "just wording"', () => {
    for (const request of ['change growth to 3%', 'make it 3%', 'use a bar chart instead', 'make the relationship optional', 'change the baseline', 'extend the forecast']) {
      assert.equal(refinementTouchesDesign(request), true, request);
    }
  });

  test('a shortened answer that changed the rate gets the original chart back', () => {
    const refined = `Scenario at 5%.\n\n${fence('natively-chart', chartJson(6))}\n\nOne assumption.`;
    const out = preserveDiagramsInRefinement(ANSWER, refined);
    assert.equal(out.changed, true);
    assert.equal(extractVisualBlocks(out.text)[0].source, chartJson(5));
    assert.ok(out.text.includes('```natively-chart\n'), 'restored under its own tag');
    assert.ok(out.text.startsWith('Scenario at 5%.'));
  });

  test('a shortened answer that dropped the chart gets it back after the lead', () => {
    const out = preserveDiagramsInRefinement(ANSWER, 'Scenario at 5%.\n\nOne assumption.');
    assert.equal(out.restored, 1);
    assert.equal(out.text, `Scenario at 5%.\n\n${CHART}\n\nOne assumption.`);
  });

  test('an untouched chart is left byte for byte', () => {
    const refined = `Short.\n\n${CHART}\n\nDone.`;
    assert.deepEqual(preserveDiagramsInRefinement(ANSWER, refined), { text: refined, changed: false, restored: 0 });
  });
});

describe('the artifact on the table', () => {
  test('a chart answer becomes the active artifact, with its kind', () => {
    const found = latestDiagramInAnswer(ANSWER);
    assert.deepEqual({ artifact: found.artifact, view: found.view, type: found.type }, { artifact: 'chart', view: 'chart', type: 'line' });
    assert.equal(found.source, chartJson(5));
    assert.deepEqual({ ...latestDiagramInAnswer(`x\n\n${CHEN}`), source: undefined }, { artifact: 'notation', view: 'chen', type: 'chen-er', source: undefined });
    assert.equal(latestDiagramInAnswer(`ER.\n\n${fence('mermaid', 'erDiagram\n    A ||..o{ B : r')}`).view, 'er');
  });

  test('a chart that fails its own checks never becomes the active artifact', () => {
    const noBaseline = fence('natively-chart', JSON.stringify({ v: 1, type: 'line', compute: { kind: 'compound_growth', ratePercent: 5, period: 'month', periods: 3 } }));
    assert.equal(latestDiagramInAnswer(`x\n\n${noBaseline}`), null);
    assert.equal(latestDiagramInAnswer(`x\n\n\`\`\`natively-chart\n${chartJson(5)}`), null, 'an unclosed block is not an artifact');
  });

  test('"make it 3%" is version 2 of the same chart, pointing at version 1', () => {
    const state = createActiveDesignState();
    const v1 = state.observeAnswer(ANSWER);
    assert.deepEqual([v1.artifactId, v1.version, v1.artifact, v1.view], ['design-1.v1', 1, 'chart', 'chart']);
    const v2 = state.observeAnswer(`Now at 3%.\n\n${fence('natively-chart', chartJson(3, 'Monthly revenue at 3%'))}`);
    assert.deepEqual([v2.artifactId, v2.version, v2.parentArtifactId], ['design-1.v2', 2, 'design-1.v1']);
    assert.ok(v2.source.includes('"ratePercent":3'));
  });

  test('a chart never continues a diagram, and a diagram never continues a chart', () => {
    const state = createActiveDesignState();
    state.observeAnswer(`Design.\n\n${fence('mermaid', 'flowchart LR\n    revenue["Monthly Revenue Service"] --> usd["USD Ledger"]')}`);
    const chart = state.observeAnswer(ANSWER);
    assert.deepEqual([chart.artifactId, chart.version, chart.parentArtifactId], ['design-2.v1', 1, undefined], 'shared words do not make it the same artifact');
  });

  test("another customer's numbers are a new artifact, not a new version", () => {
    const state = createActiveDesignState();
    state.observeAnswer(ANSWER);
    state.noteDesignQuestion('Show the hiring funnel for the Berlin office.');
    const next = state.observeAnswer(`Stages.\n\n${fence('natively-chart', JSON.stringify({ v: 1, type: 'funnel', title: 'Berlin hiring', status: 'observed', sources: ['ATS export'], cohort: 'applicants in Q3', stages: [{ label: 'Applied', value: 90 }, { label: 'Hired', value: 4 }] }))}`);
    assert.deepEqual([next.artifactId, next.version], ['design-2.v1', 1]);
    assert.equal(next.question, 'Show the hiring funnel for the Berlin office.');
  });

  test('an answer about it leaves it in focus; code moves the focus; reset and TTL clear it', () => {
    let clock = 1000;
    const state = createActiveDesignState({ now: () => clock, ttlMs: 60_000 });
    state.observeAnswer(ANSWER);
    state.touch();
    assert.equal(state.observeAnswer('It rests on the growth assumption.').foreground, true);
    assert.equal(state.observeAnswer(`Here is the script.\n\n${fence('python', 'print(1)')}`).foreground, false);
    assert.equal(state.get().artifact, 'chart');
    clock += 61_000;
    assert.equal(state.get(), null, 'expires after its quiet period');
    state.observeAnswer(ANSWER);
    state.clear();
    assert.equal(state.get(), null);
  });

  test('a Mermaid repair is never applied to a chart', () => {
    const state = createActiveDesignState();
    state.observeAnswer(ANSWER);
    assert.equal(state.applyRepair(chartJson(5), 'flowchart LR\n    a --> b'), false);
    assert.equal(state.get().source, chartJson(5));
  });

  test('Direct Assist derives the same thing from its history', () => {
    const derived = activeDesignFromHistory([
      { role: 'user', content: 'forecast at 5%' },
      { role: 'assistant', content: ANSWER },
      { role: 'user', content: 'make it 3%' },
      { role: 'assistant', content: `Now 3%.\n\n${fence('natively-chart', chartJson(3))}` },
    ]);
    assert.deepEqual([derived.artifact, derived.view, derived.version, derived.foreground], ['chart', 'chart', 2, true]);
    assert.ok(derived.source.includes('"ratePercent":3'));
    assert.equal(activeDesignFromHistory([{ role: 'assistant', content: `x\n\n${MERMAID}` }, { role: 'assistant', content: ANSWER }]).version, 1, 'a chart after a diagram starts at version 1');
  });
});

describe('size estimates for data models and class diagrams', () => {
  test('an ER diagram is counted in entities and relationships, not attribute lines', async () => {
    const { estimateDiagramComplexity } = await import('../diagramPolicy.mjs');
    const er = 'erDiagram\n    USER ||..o{ ORDER : places\n    ORDER ||..|{ PAYMENT : "is paid by"\n    USER {\n        int user_id PK\n        string email UK\n    }\n    ORDER {\n        int order_id PK\n        int user_id FK\n    }\n    AUDIT_LOG {\n        int id PK\n    }';
    const c = estimateDiagramComplexity(er);
    assert.equal(c.nodes, 4);
    assert.equal(c.edges, 2);
  });

  test('a class diagram is counted in classes and relationships, not members', async () => {
    const { estimateDiagramComplexity } = await import('../diagramPolicy.mjs');
    const cls = 'classDiagram\n    class ParkingLot {\n        +park(Vehicle v) Ticket\n        -levels List~Level~\n    }\n    class Level\n    ParkingLot "1" *-- "1..*" Level : has\n    Spot <|-- CompactSpot\n    Level o-- Spot';
    const c = estimateDiagramComplexity(cls);
    assert.equal(c.nodes, 4);
    assert.equal(c.edges, 3);
  });
});

// Seen live: asked for a paper's method with no paper, and for a career with
// no history, a model drew the gap itself.
describe('a diagram made only of placeholders', () => {
  const PAPER = 'flowchart TD\n    paper["Paper (not retrieved)"] -->|"steps unknown"| method["Method (unknown)"]\n    method -->|"inputs unknown"| inputs["Inputs (unknown)"]\n    method -->|"outputs unknown"| outputs["Outputs (unknown)"]';
  const CAREER = 'timeline\n    title Career progression\n    Dates not provided : Roles and dates needed';

  test('is recognised: flowchart, timeline, mind map', async () => {
    const { isPlaceholderDiagram } = await import('../diagramPolicy.mjs');
    assert.equal(isPlaceholderDiagram(PAPER), true);
    assert.equal(isPlaceholderDiagram(CAREER), true);
    assert.equal(isPlaceholderDiagram('mindmap\n  root((Career))\n    unknown\n    not provided'), true);
    assert.equal(isPlaceholderDiagram('flowchart TD\n    paper["Paper (not retrieved)"] -->|"method unknown"| unknown["Method diagram unavailable"]'), true);
  });

  test('one real node keeps the drawing', async () => {
    const { isPlaceholderDiagram } = await import('../diagramPolicy.mjs');
    for (const source of [
      'timeline\n    title Release milestones\n    October 12 : Beta goes out\n    November 2 : Public launch',
      'flowchart LR\n    api["API"] --> auth["Auth (unknown)"]\n    api --> kafka["Kafka (proposed)"]',
      'flowchart TD\n    input["Input data"] --> pre["Preprocess (details not given)"]\n    pre --> out["Report results"]',
      // "unknown" on an arrow is a branch, not a missing box.
      'flowchart LR\n    c["Client"] --> u{"Known host?"}\n    u -->|"unknown"| deny["Deny"]',
      'flowchart LR\n    a --> b',
      'sequenceDiagram\n    A->>B: unknown',
      'erDiagram\n    UNKNOWN ||--o{ ORDER : places',
    ]) {
      assert.equal(isPlaceholderDiagram(source), false, source);
    }
  });

  // Found in review: the first version hid real diagrams. It removes content
  // from the screen, so each of these must stay.
  test('what looks like a gap and is not', async () => {
    const { isPlaceholderDiagram } = await import('../diagramPolicy.mjs');
    for (const source of [
      // nodes drawn by id alone are nodes
      'flowchart LR\n    Client --> LB\n    LB --> App\n    App --> DB[("Database: TBD")]',
      // "needed" in a step is a step
      'flowchart TD\n    q{"Approval needed?"} -->|"yes"| m["Manager sign-off needed"]\n    q -->|"no"| n["No action needed"]',
      // a map of open questions: the unknowns are the content
      'mindmap\n  root((Open questions))\n    Budget unknown\n    Owner TBD\n    Launch date not stated',
      // an arrow that says something real
      'flowchart LR\n    o1["Owner: unknown"] -->|"owns"| o2["Approver: unknown"]',
      'flowchart LR\n    Order -->|"paid"| Ship\n    Order --> X["N/A"]',
    ]) {
      assert.equal(isPlaceholderDiagram(source), false, source);
    }
  });

  test('a very large source is never scanned', async () => {
    const { isPlaceholderDiagram } = await import('../diagramPolicy.mjs');
    const started = Date.now();
    assert.equal(isPlaceholderDiagram(`flowchart TD\n${'['.repeat(60000)}`), false);
    assert.equal(isPlaceholderDiagram(`flowchart TD\n${'[('.repeat(30000)}`), false);
    assert.ok(Date.now() - started < 100);
  });

  test('it never becomes the design on the table', async () => {
    const { latestDiagramInAnswer } = await import('../activeDesign.mjs');
    assert.equal(latestDiagramInAnswer(`I do not have the paper.\n\n\`\`\`mermaid\n${PAPER}\n\`\`\`\n\nPoint me at it.`), null);
    const kept = latestDiagramInAnswer('x\n\n```mermaid\nflowchart LR\n    api["API"] --> auth["Auth (unknown)"]\n```');
    assert.equal(kept.artifact, 'mermaid');
  });
});

// Found in review: the policy deleted lines it mistook for click / link statements,
// and renamed words inside link text.
describe('only interaction statements are removed, and only ids are renamed', () => {
  test('a node, an entity, a period or a task that is called "click" or "link" stays', async () => {
    const { checkDiagramSource } = await import('../diagramPolicy.mjs');
    const flow = checkDiagramSource('flowchart LR\n    user["User"] --> click\n    click --> api\n    click --> log');
    assert.equal(flow.ok, true);
    assert.equal(flow.complexity.edges, 3);
    assert.ok(!flow.neutralised.includes('interaction'));
    assert.equal(checkDiagramSource('erDiagram\n    link ||--o{ click : receives\n    click }o--|| device : from').complexity.edges, 2);
    const timeline = checkDiagramSource('timeline\n    title Links\n    link created : first share\n    link expired : cleanup');
    assert.match(timeline.renderSource, /link created : first share/);
    assert.match(checkDiagramSource('gantt\n    title Checks\n    dateFormat YYYY-MM-DD\n    link checker :a1, 2026-01-01, 3d').renderSource, /link checker/);
  });

  test('real click and link statements are still removed', async () => {
    const { checkDiagramSource } = await import('../diagramPolicy.mjs');
    for (const source of ['flowchart LR\n    a --> b\n    click a href "https://e.com"', 'flowchart LR\n    a --> b\n    click a call alert()', 'flowchart LR\n    a --> b\n    click a "https://e.com" "tip"', 'sequenceDiagram\n    A->>B: hi\n    link A: Dashboard @ https://e.com', 'sequenceDiagram\n    A->>B: hi\n    links A: {"Docs": "https://e.com"}']) {
      const r = checkDiagramSource(source);
      assert.ok(r.neutralised.includes('interaction') || !r.ok, source);
      assert.doesNotMatch(r.renderSource || '', /e\.com|alert/, source);
    }
  });

  test('words in link text and a closing "end;" are left alone', async () => {
    const { renameReservedFlowchartIds } = await import('../diagramPolicy.mjs');
    assert.deepEqual(renameReservedFlowchartIds('flowchart LR\n    a["A"] -- end of flow --> b["B"]').renamed, []);
    assert.deepEqual(renameReservedFlowchartIds('flowchart LR\n    web -- call --> api').renamed, []);
    assert.deepEqual(renameReservedFlowchartIds('flowchart LR\n    subgraph core\n    a --> b\n    end;\n    c --> d').renamed, []);
    const commented = renameReservedFlowchartIds('flowchart LR\n    subgraph core\n    a --> b\n    end %% core\n    graph --> d');
    assert.deepEqual(commented.renamed, ['graph']);
    assert.match(commented.text, /\n    end %% core\n    graph_node --> d/);
  });
});

describe('label text is not a link (the source check)', () => {
  test('"URL (", "JavaScript:" and friends are drawn', async () => {
    const { checkDiagramSource } = await import('../diagramPolicy.mjs');
    for (const source of [
      'flowchart LR\n    gen["Short URL (base62)"] --> b["Long URL(original)"]',
      'flowchart LR\n    a["API"] --> b["JavaScript: React app"]',
      'sequenceDiagram\n    participant API\n    participant JavaScript\n    API-->>JavaScript: JSON response',
    ]) {
      assert.equal(checkDiagramSource(source).ok, true, source);
    }
  });

  test('a real remote reference is still refused', async () => {
    const { checkDiagramSource } = await import('../diagramPolicy.mjs');
    for (const source of [
      'flowchart LR\n    a["x"] --> b["y"]\n    style a fill:url(https://e.com/x.svg#p)',
      'flowchart LR\n    a@{ img: "https://e.com/a.png" } --> b',
      'flowchart LR\n    a["<a href=\'javascript:alert(1)\'>x</a>"] --> b',
    ]) {
      assert.equal(checkDiagramSource(source).ok, false, source);
    }
  });
});

describe('the repair budget (found in review: a manual request was unlimited)', () => {
  test('manual presses skip the one-per-diagram rule and still have a window of their own', async () => {
    const { createRepairBudget, DIAGRAM_REPAIR_LIMITS } = await import('../diagramRepair.mjs');
    let now = 1_000_000;
    const budget = createRepairBudget({ now: () => now });
    assert.equal(budget.take('flowchart LR\n a-->b').allowed, true);
    assert.deepEqual(budget.take('flowchart LR\n a-->b'), { allowed: false, reason: 'already_tried' });
    for (let i = 0; i < DIAGRAM_REPAIR_LIMITS.manualPerWindow; i += 1) assert.equal(budget.take('flowchart LR\n a-->b', { manual: true }).allowed, true, String(i));
    assert.deepEqual(budget.take('flowchart LR\n a-->b', { manual: true }), { allowed: false, reason: 'rate_limited' });
    now += DIAGRAM_REPAIR_LIMITS.windowMs + 1;
    assert.equal(budget.take('flowchart LR\n a-->b', { manual: true }).allowed, true);
  });
});

// Found in review (2026-10-01): ways past the stage-1 source check and the
// rendered-SVG check. None was shown to be exploitable (Mermaid runs strict,
// its output is sanitised and shown as an image); they are closed anyway.
describe('source and SVG checks: the gaps that were left', () => {
  test('a click statement after a semicolon is removed, and the rest of the line stays', async () => {
    const { checkDiagramSource } = await import('../diagramPolicy.mjs');
    const r = checkDiagramSource('flowchart LR\n    a --> b; click a call alert()');
    assert.equal(r.ok, true);
    assert.ok(r.neutralised.includes('interaction'));
    assert.equal(r.renderSource, 'flowchart LR\n    a --> b');
    assert.equal(checkDiagramSource('flowchart LR\n    a --> b; b --> c').renderSource, 'flowchart LR\n    a --> b; b --> c');
  });

  test('markup with slash separators, and a bare <style>, are refused', async () => {
    const { checkDiagramSource } = await import('../diagramPolicy.mjs');
    assert.equal(checkDiagramSource('flowchart LR\n    a["<img/src=x/onerror=alert(1)>"] --> b').rejection, 'raw_html');
    assert.equal(checkDiagramSource('flowchart LR\n    a["<style>*{color:red}</style>"] --> b').rejection, 'raw_html');
  });

  test('generics, stereotypes, line breaks and comparisons are label text', async () => {
    const { checkDiagramSource } = await import('../diagramPolicy.mjs');
    for (const source of [
      'classDiagram\n    class Repo {\n      +List<Style> styles\n      +Map<String, Object> cache\n    }',
      'stateDiagram-v2\n    state check <<choice>>\n    [*] --> check',
      'flowchart LR\n    a["line one<br/>line two"] --> b["x < y"]',
    ]) {
      assert.equal(checkDiagramSource(source).ok, true, source);
    }
  });

  test('a directive that is never closed is still removed', async () => {
    const { checkDiagramSource } = await import('../diagramPolicy.mjs');
    const r = checkDiagramSource('%%{init: {"securityLevel":"loose"}\nflowchart LR\n    a --> b');
    assert.equal(r.ok, true);
    assert.ok(r.neutralised.includes('directive'));
    assert.doesNotMatch(r.renderSource, /%%\{|securityLevel/);
  });

  test('rendered SVG: an unquoted link, a src attribute and media elements are refused', async () => {
    const { isSafeDiagramSvg } = await import('../diagramPolicy.mjs');
    const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
    assert.equal(isSafeDiagramSvg(svg('<g href=https://e.com/x><path d="M0 0"/></g>')), false);
    assert.equal(isSafeDiagramSvg(svg('<video src="https://e.com/v"/>')), false);
    assert.equal(isSafeDiagramSvg(svg('<g src="x"/>')), false);
    assert.equal(isSafeDiagramSvg(svg('<audio/>')), false);
    // What a real drawing holds still passes.
    assert.equal(isSafeDiagramSvg(svg('<path d="M0 0" marker-end="url(#arrow)"/><text>href=https://x is text, src=y too</text>')), true);
    assert.equal(isSafeDiagramSvg(svg('<style>.a{fill:#fff}</style><g class="a"><text>source of truth</text></g>')), true);
  });
});

// Second review (2026-10-02): what the source policy refused or silently changed.
describe('source policy: ordinary diagrams are drawn as written', () => {
  test('a web address in a label is text (the drawing is an image), so a URL shortener can be drawn', async () => {
    const { checkDiagramSource } = await import('../diagramPolicy.mjs');
    for (const source of [
      'flowchart LR\n    a["Client"] -->|"GET https://sho.rt/abc"| b["Redirect Service"]',
      'flowchart LR\n    a["Client"] -->|"wss://chat"| b["Chat Server"]',
      'sequenceDiagram\n    participant C\n    participant S\n    C->>S: GET http://example.com/x',
      'flowchart LR\n    a["see https://e.com/docs"] --> b',
    ]) {
      const r = checkDiagramSource(source);
      assert.equal(r.ok, true, source);
      assert.match(r.renderSource, /:\/\//, source);
    }
  });

  test('…and one in a statement that could reference it is still refused', async () => {
    const { checkDiagramSource } = await import('../diagramPolicy.mjs');
    assert.equal(checkDiagramSource('flowchart LR\n    a --> b\n    style a fill:url(https://e.com/x.svg#p)').rejection, 'remote_resource');
    assert.equal(checkDiagramSource('flowchart LR\n    a@{ img: "https://e.com/a.png" } --> b').rejection, 'remote_resource');
    assert.equal(checkDiagramSource('flowchart LR\n    a --> b\n    linkStyle 0 stroke:url(https://e.com/p)').rejection, 'remote_resource');
    const clicked = checkDiagramSource('flowchart LR\n    a --> b\n    click a href "https://e.com"');
    assert.ok(clicked.neutralised.includes('interaction'));
    assert.doesNotMatch(clicked.renderSource, /e\.com/);
  });

  test('a comparison is not an event handler', async () => {
    const { checkDiagramSource } = await import('../diagramPolicy.mjs');
    assert.equal(checkDiagramSource('flowchart TD\n    check{"retries<max and online = true?"} --> ok["Send"]').ok, true);
    assert.equal(checkDiagramSource('classDiagram\n    class Cache {\n      +Map<string, onEvict = fn> items\n    }').ok, true);
    assert.equal(checkDiagramSource('flowchart LR\n    a["<b onclick=alert(1)>x</b>"] --> b').rejection, 'raw_html');
    assert.equal(checkDiagramSource('flowchart LR\n    a["<img src=x onerror=alert(1)>"] --> b').rejection, 'raw_html');
  });

  test('click and link statements are removed only where they are statements', async () => {
    const { checkDiagramSource } = await import('../diagramPolicy.mjs');
    const mindmap = checkDiagramSource('mindmap\n  root\n    click the "Start" button\n    wait');
    assert.match(mindmap.renderSource, /click the "Start" button/);
    const sequence = checkDiagramSource('sequenceDiagram\n    participant link\n    participant A\n    link ->> A: resolve');
    assert.match(sequence.renderSource, /link ->> A: resolve/);
    const flow = checkDiagramSource('flowchart LR\n    click --> call\n    call --> done["Done"]');
    assert.equal(flow.complexity.edges, 2);
    assert.ok(!flow.neutralised.includes('interaction'));
    const gantt = checkDiagramSource('gantt\n    title T\n    dateFormat YYYY-MM-DD\n    Task :a1, 2026-01-01, 3d\n    click a1 href "https://e.com"');
    assert.ok(gantt.neutralised.includes('interaction'));
  });

  test('a renamed keyword id is renamed in the statements that name it too', async () => {
    const { renameReservedFlowchartIds } = await import('../diagramPolicy.mjs');
    const r = renameReservedFlowchartIds('flowchart LR\n    subgraph graph ["Social"]\n    a --> b\n    end\n    user --> graph\n    style graph fill:#f9f\n    class graph,a hot');
    assert.deepEqual(r.renamed, ['graph']);
    assert.match(r.text, /subgraph graph_node \["Social"\]/);
    assert.match(r.text, /user --> graph_node/);
    assert.match(r.text, /style graph_node fill:#f9f/);
    assert.match(r.text, /class graph_node,a hot/);
    assert.match(r.text, /\n    end\n/);
  });

  test('no pattern here is worse than linear on a run of one character, at the size cap', async () => {
    const { checkDiagramSource, isPlaceholderDiagram, DIAGRAM_LIMITS } = await import('../diagramPolicy.mjs');
    const n = DIAGRAM_LIMITS.maxSourceChars - 40;
    for (const ch of [' ', '(', '[', '{', '|', '"', '-', '<', 'x', ';', '%']) {
      for (const lead of ['flowchart LR\n    a -->|', 'mindmap\n  root(', 'sequenceDiagram\n    A->>B: ', 'erDiagram\n    A ||--o{ B : ']) {
        const source = `${lead}${ch.repeat(n - lead.length)}b`;
        const started = Date.now();
        checkDiagramSource(source);
        isPlaceholderDiagram(source);
        const maxAllowedMs = process.platform === 'win32' ? 3000 : 400;
        assert.ok(Date.now() - started < maxAllowedMs, `${JSON.stringify(lead)} + ${JSON.stringify(ch)} × ${n}: ${Date.now() - started} ms`);
      }
    }
  });
});

describe('rendered SVG is judged tag by tag', () => {
  const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

  test('handlers, links and media are refused however the tag is spelled', async () => {
    const { isSafeDiagramSvg } = await import('../diagramPolicy.mjs');
    for (const inner of [
      '<g/onload="alert(1)"/>',
      '<rect/onclick=alert(1) width="1"/>',
      '<g id="a"onload="alert(1)"/>',
      '<feImage/href="https://e.com/x"/>',
      '<s:script>1</s:script>',
      '<s:style>@import url(https://e.com/a.css)</s:style>',
      '<s:image s:href="https://e.com/x"/>',
      '<g href=https://e.com/x/>',
      '<video src="x"/>',
      '<path style="fill:url(https://e.com/p)"/>',
      '<g data-x="a>" onload="x"/>',
      '<a href="#x"><text>t</text></a>',
      '<style>.a{background:url(//e.com/x)}</style>',
    ]) {
      assert.equal(isSafeDiagramSvg(svg(inner)), false, inner);
    }
  });

  test('a local reference is allowed quoted or not, and label text is only text', async () => {
    const { isSafeDiagramSvg } = await import('../diagramPolicy.mjs');
    for (const inner of [
      '<path d="M0 0" marker-end="url(#arrow)"/>',
      '<path style="marker-end: url(&quot;#a&quot;)"/>',
      "<path style=\"fill:url('#g')\"/>",
      '<style>.a{fill:url("#g")}</style><g class="a"/>',
      '<text>retry once = ok; onload = fine; href=https://x; src=y; javascript: the good parts; url(img.png)</text>',
      '<g aria-label="a > b" class="node"><rect width="10" height="10"/></g>',
      '<linearGradient id="g" xlink:href="#base"/><marker id="arrow"/>',
    ]) {
      assert.equal(isSafeDiagramSvg(svg(inner)), true, inner);
    }
  });
});
