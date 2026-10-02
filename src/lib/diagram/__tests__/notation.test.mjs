// Notation that has to be RIGHT, not just drawable: crow's-foot ER read in both
// directions, Chen ER with its real symbols, and formal automata.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseErDiagram, describeErDiagram, cardinalityWords } from '../erSemantics.mjs';
import { validateChenEr, renderChenErSvg, describeChenEr } from '../chenEr.mjs';
import { validateAutomaton, automatonAccepts, automatonToMermaid, automatonTable, describeAutomaton, EPSILON } from '../automaton.mjs';
import { compileVisualSource, checkVisualSource } from '../visualArtifact.mjs';
import { checkDiagramSource, isSafeDiagramSvg } from '../diagramPolicy.mjs';

const count = (text, needle) => text.split(needle).length - 1;

// ── crow's-foot (Mermaid erDiagram) ─────────────────────────────────────────

describe("crow's-foot ER: the fixture", () => {
  // A customer can have zero or many orders; each order belongs to exactly one
  // customer. Order has its own key, so the relationship is non-identifying.
  const FIXTURE = [
    'erDiagram',
    '    CUSTOMER ||..o{ ORDER : places',
    '    CUSTOMER {',
    '        int customer_id PK',
    '        string name',
    '    }',
    '    ORDER {',
    '        int order_id PK',
    '        int customer_id FK',
    '        decimal total',
    '    }',
  ].join('\n');

  test('each end is read from the other side', () => {
    const [r] = analyseErDiagram(FIXTURE).relationships;
    assert.deepEqual({ left: r.left, right: r.right }, { left: 'CUSTOMER', right: 'ORDER' });
    assert.deepEqual(r.leftPerRight, [1, 1], 'one ORDER has exactly one CUSTOMER');
    assert.deepEqual(r.rightPerLeft, [0, Infinity], 'one CUSTOMER has zero or many ORDERs');
    assert.equal(r.identifying, false, 'dashed: ORDER has its own key');
    assert.equal(r.label, 'places');
  });

  test('it is read back in both directions, in words', () => {
    assert.equal(
      describeErDiagram(analyseErDiagram(FIXTURE)),
      'Each ORDER relates to exactly one CUSTOMER; each CUSTOMER relates to zero or many ORDER (places).',
    );
  });

  test('nothing beyond the fixture is inferred', () => {
    const a = analyseErDiagram(FIXTURE);
    assert.deepEqual(a.notes, []);
    assert.deepEqual(a.entities.map((e) => e.name), ['CUSTOMER', 'ORDER']);
    assert.deepEqual(a.entities[1].attributes.map((x) => `${x.name}:${x.keys.join('+')}`), ['order_id:PK', 'customer_id:FK', 'total:']);
  });

  test('the fixture passes policy and is drawn by Mermaid as written', () => {
    const p = checkDiagramSource(FIXTURE);
    assert.equal(p.ok, true);
    assert.equal(p.type, 'er');
    assert.deepEqual(p.neutralised, []);
  });
});

describe("crow's-foot ER: every endpoint, both sides", () => {
  const rel = (line) => analyseErDiagram(`erDiagram\n    ${line}`).relationships[0];

  test('right-end markers', () => {
    assert.deepEqual(rel('A ||--|| B : r').rightPerLeft, [1, 1]);
    assert.deepEqual(rel('A ||--o| B : r').rightPerLeft, [0, 1]);
    assert.deepEqual(rel('A ||--o{ B : r').rightPerLeft, [0, Infinity]);
    assert.deepEqual(rel('A ||--|{ B : r').rightPerLeft, [1, Infinity]);
  });

  test('left-end markers mirror them', () => {
    assert.deepEqual(rel('A ||--|| B : r').leftPerRight, [1, 1]);
    assert.deepEqual(rel('A |o--|| B : r').leftPerRight, [0, 1]);
    assert.deepEqual(rel('A }o--|| B : r').leftPerRight, [0, Infinity]);
    assert.deepEqual(rel('A }|--|| B : r').leftPerRight, [1, Infinity]);
  });

  test('swapping the two entities swaps the reading, not the meaning', () => {
    const a = rel('CUSTOMER ||..o{ ORDER : places');
    const b = rel('ORDER }o..|| CUSTOMER : "placed by"');
    assert.deepEqual(a.rightPerLeft, b.leftPerRight);
    assert.deepEqual(a.leftPerRight, b.rightPerLeft);
  });

  test('many-to-many stays one line', () => {
    const r = rel('STUDENT }o..o{ COURSE : enrols');
    assert.deepEqual([r.leftPerRight, r.rightPerLeft], [[0, Infinity], [0, Infinity]]);
    assert.equal(analyseErDiagram('erDiagram\n    STUDENT }o..o{ COURSE : enrols').entities.length, 2, 'no junction table is invented');
  });

  test('optional is not the same as many', () => {
    assert.equal(cardinalityWords([0, 1]), 'zero or one');
    assert.equal(cardinalityWords([0, Infinity]), 'zero or many');
    assert.equal(cardinalityWords([1, Infinity]), 'one or many');
    assert.equal(cardinalityWords([1, 1]), 'exactly one');
  });
});

describe("crow's-foot ER: identifying versus non-identifying", () => {
  test('a solid line on a child that has its own key is flagged', () => {
    const a = analyseErDiagram('erDiagram\n    CUSTOMER ||--o{ ORDER : places\n    ORDER {\n        int order_id PK\n        int customer_id FK\n    }');
    assert.equal(a.relationships[0].identifying, true);
    assert.deepEqual(a.notes, ['ORDER has its own key, so its relationship to CUSTOMER is non-identifying: a dashed line (..), not a solid one.']);
  });

  test('a composite key that includes the parent key IS identifying', () => {
    const a = analyseErDiagram('erDiagram\n    ORDER ||--|{ LINE_ITEM : contains\n    LINE_ITEM {\n        int order_id PK, FK\n        int line_no PK\n    }');
    assert.deepEqual(a.notes, []);
  });

  test('a dashed line on a child keyed only by the parent is flagged the other way', () => {
    const a = analyseErDiagram('erDiagram\n    USER ||..|| PROFILE : has\n    PROFILE {\n        int user_id PK, FK\n        string bio\n    }');
    assert.match(a.notes[0], /makes the relationship identifying: a solid line/);
  });

  test('referential integrity is not inferred from a matching field name', () => {
    // customer_id appears in both, but nothing marks it as a foreign key and no relationship is drawn.
    const a = analyseErDiagram('erDiagram\n    CUSTOMER {\n        int customer_id PK\n    }\n    ORDER {\n        int order_id PK\n        int customer_id\n    }');
    assert.equal(a.relationships.length, 0);
    assert.deepEqual(a.notes, []);
  });

  test('a declared entity with no primary key is noted, an undeclared one is not', () => {
    const a = analyseErDiagram('erDiagram\n    A ||..o{ B : r\n    B {\n        string label\n    }');
    assert.deepEqual(a.notes, ['No primary key is marked for B.']);
  });

  test('text that is not an ER diagram is left alone', () => {
    assert.equal(analyseErDiagram('flowchart LR\n  a --> b').isEr, false);
    assert.equal(describeErDiagram(analyseErDiagram('flowchart LR\n  a --> b')), '');
  });
});

// ── Chen ────────────────────────────────────────────────────────────────────

const CHEN = {
  kind: 'chen-er',
  title: 'Orders',
  entities: [
    { name: 'Order', attributes: [{ name: 'order_id', key: true }, { name: 'total', derived: true }, { name: 'ship_to', components: ['street', 'city'] }] },
    { name: 'Line Item', weak: true, attributes: [{ name: 'line_no', partialKey: true }, 'quantity'] },
    { name: 'Product', attributes: [{ name: 'sku', key: true }, { name: 'tags', multivalued: true }] },
  ],
  relationships: [
    { name: 'contains', identifying: true, participants: [{ entity: 'Order', cardinality: '1', participation: 'partial' }, { entity: 'Line Item', cardinality: 'N' }] },
    { name: 'refers to', attributes: ['unit_price'], participants: [{ entity: 'Line Item', cardinality: 'N', participation: 'total' }, { entity: 'Product', cardinality: '1' }] },
  ],
};

describe('Chen notation: the symbols', () => {
  const { model } = validateChenEr(CHEN);
  const svg = renderChenErSvg(model).svg;

  test('entities are rectangles; a weak entity is a double rectangle', () => {
    assert.equal(count(svg, 'class="chen-entity"'), 2);
    assert.equal(count(svg, 'class="chen-entity chen-weak"'), 1);
    assert.equal(count(svg, 'class="chen-weak-inner"'), 1);
  });

  test('relationships are diamonds; an identifying one is a double diamond', () => {
    assert.equal(count(svg, '<polygon class="chen-relationship'), 2);
    assert.equal(count(svg, 'class="chen-relationship chen-identifying"'), 1);
    assert.equal(count(svg, 'class="chen-identifying-inner"'), 1);
  });

  test('attributes are ovals: key underlined, partial key dashed-underlined, derived dashed, multivalued double', () => {
    // order_id, total, ship_to (+ street, city), line_no, quantity, sku, tags, unit_price
    assert.equal(count(svg, '<ellipse class="chen-attribute'), 10);
    assert.equal(count(svg, 'class="chen-key-underline"'), 2);
    assert.equal(count(svg, 'class="chen-partial-key-underline"'), 1);
    assert.match(svg, /class="chen-partial-key-underline"[^>]*stroke-dasharray/);
    assert.match(svg, /class="chen-attribute chen-derived"[^>]*stroke-dasharray/);
    assert.equal(count(svg, 'class="chen-multivalued-inner"'), 1);
  });

  test('a composite attribute carries its components', () => {
    assert.equal(count(svg, 'chen-component'), 2);
    assert.ok(svg.includes('>street<') && svg.includes('>city<'));
  });

  test('total participation is a double line; partial is a single one', () => {
    // Line Item in "contains" (total, by definition of a weak entity) and in "refers to" (stated): 2 × 2 lines.
    assert.equal(count(svg, 'chen-link chen-total'), 4);
  });

  test('cardinality is written beside each participant that has one', () => {
    assert.equal(count(svg, 'class="chen-cardinality"'), 4);
  });

  test('a relationship attribute hangs off the diamond', () => {
    assert.ok(svg.includes('>unit_price<'));
  });

  test('the drawing is inert and has a real size', () => {
    assert.equal(isSafeDiagramSvg(svg), true);
    const drawn = renderChenErSvg(model);
    assert.ok(drawn.width > 300 && drawn.height > 120);
    assert.ok(!/NaN|undefined/.test(svg));
  });
});

describe('Chen notation: meaning', () => {
  test('a weak entity takes part totally in its identifying relationship, by definition', () => {
    const { model } = validateChenEr(CHEN);
    const weak = model.relationships[0].participants.find((p) => p.entity === 'Line Item');
    assert.equal(weak.participation, 'total');
  });

  test('a constraint nobody stated is listed as unknown, never defaulted', () => {
    const { model } = validateChenEr(CHEN);
    assert.deepEqual(model.unknowns, ['Whether every Product takes part in "refers to"']);
    const product = model.relationships[1].participants.find((p) => p.entity === 'Product');
    assert.equal(product.participation, 'unknown');
    const compiled = compileVisualSource('notation', JSON.stringify(CHEN));
    assert.match(compiled.notes[0], /^Not stated, so not drawn: Whether every Product takes part/);
  });

  test('an unstated cardinality draws no mark', () => {
    const { model } = validateChenEr({ kind: 'chen-er', entities: ['A', 'B'], relationships: [{ name: 'r', participants: [{ entity: 'A' }, { entity: 'B', cardinality: 'N' }] }] });
    assert.equal(count(renderChenErSvg(model).svg, 'class="chen-cardinality"'), 1);
    assert.ok(model.unknowns.includes('Cardinality of A in "r"'));
  });

  test('a ternary relationship keeps all three participants', () => {
    const r = validateChenEr({ kind: 'chen-er', entities: ['Supplier', 'Part', 'Project'], relationships: [{ name: 'supplies', attributes: ['quantity'], participants: [{ entity: 'Supplier', cardinality: 'M' }, { entity: 'Part', cardinality: 'N' }, { entity: 'Project', cardinality: 'M', participation: 'total' }] }] });
    assert.equal(r.ok, true);
    assert.equal(r.model.relationships[0].participants.length, 3);
    const svg = renderChenErSvg(r.model).svg;
    assert.equal(count(svg, 'class="chen-cardinality"'), 3);
    assert.equal(count(svg, '<polygon class="chen-relationship'), 1);
  });

  test('a relationship of an entity with itself keeps both roles', () => {
    const r = validateChenEr({ kind: 'chen-er', entities: [{ name: 'Employee', attributes: [{ name: 'id', key: true }] }], relationships: [{ name: 'manages', participants: [{ entity: 'Employee', cardinality: '1', role: 'manager' }, { entity: 'Employee', cardinality: 'N', role: 'report' }] }] });
    assert.equal(r.ok, true);
    const svg = renderChenErSvg(r.model).svg;
    assert.equal(count(svg, 'class="chen-role"'), 2);
    assert.ok(svg.includes('>manager<') && svg.includes('>report<'));
  });

  test('it is read back in words', () => {
    const text = describeChenEr(validateChenEr(CHEN).model);
    assert.match(text, /Weak entity Line Item \(partial key line_no\)/);
    assert.match(text, /Identifying relationship "contains" connects one Order, and taking part is optional; many Line Item, and every one takes part/);
  });
});

describe('Chen notation: a model that contradicts itself is refused', () => {
  const refuse = (spec) => {
    const r = validateChenEr(spec);
    assert.equal(r.ok, false);
    return r.code;
  };

  test('a weak entity with no identifying relationship', () => {
    assert.equal(refuse({ kind: 'chen-er', entities: [{ name: 'Dependent', weak: true, attributes: [{ name: 'name', partialKey: true }] }, 'Employee'], relationships: [{ name: 'has', participants: ['Employee', 'Dependent'] }] }), 'weak_without_owner');
  });

  test('an identifying relationship with no weak entity, or with no owner', () => {
    assert.equal(refuse({ kind: 'chen-er', entities: ['A', 'B'], relationships: [{ name: 'r', identifying: true, participants: ['A', 'B'] }] }), 'identifying_without_weak');
    assert.equal(refuse({ kind: 'chen-er', entities: [{ name: 'A', weak: true }, { name: 'B', weak: true }], relationships: [{ name: 'r', identifying: true, participants: ['A', 'B'] }] }), 'identifying_without_owner');
  });

  test('a weak entity marked optional in its identifying relationship, or given a full key', () => {
    const base = { kind: 'chen-er', entities: [{ name: 'Room', weak: true, attributes: [{ name: 'number', partialKey: true }] }, { name: 'Building', attributes: [{ name: 'id', key: true }] }] };
    assert.equal(refuse({ ...base, relationships: [{ name: 'in', identifying: true, participants: [{ entity: 'Room', participation: 'partial' }, 'Building'] }] }), 'weak_must_be_total');
    assert.equal(refuse({ kind: 'chen-er', entities: [{ name: 'Room', weak: true, attributes: [{ name: 'id', key: true }] }, 'Building'], relationships: [{ name: 'in', identifying: true, participants: ['Room', 'Building'] }] }), 'weak_with_full_key');
  });

  test('a partial key on a strong entity', () => {
    assert.equal(refuse({ kind: 'chen-er', entities: [{ name: 'A', attributes: [{ name: 'n', partialKey: true }] }] }), 'partial_key_on_strong');
  });

  test('a relationship that names an entity that does not exist, or only one', () => {
    assert.equal(refuse({ kind: 'chen-er', entities: ['A'], relationships: [{ name: 'r', participants: ['A', 'Ghost'] }] }), 'unknown_entity');
    assert.equal(refuse({ kind: 'chen-er', entities: ['A'], relationships: [{ name: 'r', participants: ['A'] }] }), 'bad_relationship');
  });

  test('a cardinality that is not 1, N or M', () => {
    assert.equal(refuse({ kind: 'chen-er', entities: ['A', 'B'], relationships: [{ name: 'r', participants: [{ entity: 'A', cardinality: '0..*' }, 'B'] }] }), 'bad_cardinality');
  });

  test('duplicates and oversize models', () => {
    assert.equal(refuse({ kind: 'chen-er', entities: ['A', 'a'] }), 'duplicate');
    assert.equal(refuse({ kind: 'chen-er', entities: Array.from({ length: 9 }, (_v, i) => `E${i}`) }), 'too_large');
    assert.equal(refuse({ kind: 'chen-er', entities: [] }), 'missing_input');
  });

  test('a missing key or partial key is noted, not refused', () => {
    const r = validateChenEr({ kind: 'chen-er', entities: [{ name: 'A', attributes: ['x'] }] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.model.notes, ['No key was stated for "A".']);
  });
});

// ── automata ────────────────────────────────────────────────────────────────

const ENDS_IN_AB = {
  kind: 'automaton',
  type: 'dfa',
  title: 'Ends in ab',
  alphabet: ['a', 'b'],
  states: ['q0', 'q1', 'q2'],
  start: 'q0',
  accepting: ['q2'],
  transitions: [
    { from: 'q0', symbol: 'a', to: 'q1' }, { from: 'q0', symbol: 'b', to: 'q0' },
    { from: 'q1', symbol: 'a', to: 'q1' }, { from: 'q1', symbol: 'b', to: 'q2' },
    { from: 'q2', symbol: 'a', to: 'q1' }, { from: 'q2', symbol: 'b', to: 'q0' },
  ],
};

describe('DFA', () => {
  test('the model means what it says: it accepts exactly the strings ending in ab', () => {
    const { model } = validateAutomaton(ENDS_IN_AB);
    for (const word of ['ab', 'aab', 'bab', 'abab', 'bbbab']) assert.equal(automatonAccepts(model, [...word]), true, word);
    for (const word of ['', 'a', 'b', 'ba', 'abb', 'aba', 'abc']) assert.equal(automatonAccepts(model, [...word]), false, word);
    assert.deepEqual(model.notes, [], 'the transition function is complete');
  });

  test('standard notation: a start arrow from nowhere, circles, a double circle for accepting', () => {
    const src = automatonToMermaid(validateAutomaton(ENDS_IN_AB).model);
    assert.match(src, /^flowchart LR\n/);
    assert.match(src, /start_marker\[" "\]\n\s+style start_marker fill:none,stroke:none/);
    assert.match(src, /start_marker --> s0\n/, 'the start arrow enters the start state');
    assert.equal(count(src, '((('), 1, 'exactly one accepting state is a double circle');
    assert.match(src, /s2\(\(\("q2"\)\)\)/);
    assert.match(src, /s0\(\("q0"\)\)/);
    assert.equal(count(src, '-->|'), 6);
    assert.equal(checkDiagramSource(src).ok, true, 'the compiled source passes the same policy as any diagram');
  });

  test('more than one target for a state and symbol is not a DFA', () => {
    const r = validateAutomaton({ ...ENDS_IN_AB, transitions: [...ENDS_IN_AB.transitions, { from: 'q0', symbol: 'a', to: 'q2' }] });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'nondeterministic');
    assert.match(r.message, /From "q0" on "a" there is more than one target/);
  });

  test('an ε-move is not allowed in a DFA', () => {
    for (const symbol of ['ε', 'epsilon', '', 'λ']) {
      assert.equal(validateAutomaton({ ...ENDS_IN_AB, transitions: [{ from: 'q0', symbol, to: 'q1' }] }).code, 'epsilon_in_dfa', JSON.stringify(symbol));
    }
  });

  test('an illegal transition: a symbol outside the alphabet, a state that does not exist', () => {
    assert.equal(validateAutomaton({ ...ENDS_IN_AB, transitions: [{ from: 'q0', symbol: 'c', to: 'q1' }] }).code, 'symbol_not_in_alphabet');
    assert.equal(validateAutomaton({ ...ENDS_IN_AB, transitions: [{ from: 'q0', symbol: 'a', to: 'q9' }] }).code, 'unknown_state');
    assert.equal(validateAutomaton({ ...ENDS_IN_AB, transitions: [{ from: 'q9', symbol: 'a', to: 'q0' }] }).code, 'unknown_state');
    assert.equal(validateAutomaton({ ...ENDS_IN_AB, start: 'q9' }).code, 'unknown_state');
    assert.equal(validateAutomaton({ ...ENDS_IN_AB, accepting: ['q9'] }).code, 'unknown_state');
  });

  test('an incomplete transition function is reported as an implied dead state, not invented', () => {
    const r = validateAutomaton({ ...ENDS_IN_AB, transitions: ENDS_IN_AB.transitions.slice(0, 4) });
    assert.equal(r.ok, true);
    assert.match(r.model.notes[0], /incomplete: no move for \(q2, a\), \(q2, b\)/);
    assert.equal(count(automatonToMermaid(r.model), 'dead'), 0);
  });

  test('alphabet, start state and type are required', () => {
    assert.equal(validateAutomaton({ ...ENDS_IN_AB, alphabet: [] }).code, 'missing_input');
    assert.equal(validateAutomaton({ ...ENDS_IN_AB, start: '' }).code, 'missing_input');
    assert.equal(validateAutomaton({ ...ENDS_IN_AB, type: 'pda' }).code, 'missing_input');
    assert.equal(validateAutomaton({ ...ENDS_IN_AB, alphabet: ['a', 'ε'] }).code, 'epsilon_in_alphabet');
  });

  test('an unreachable state and an empty accepting set are noted', () => {
    const r = validateAutomaton({ type: 'dfa', alphabet: ['a'], states: ['q0', 'island'], start: 'q0', accepting: [], transitions: [{ from: 'q0', symbol: 'a', to: 'q0' }, { from: 'island', symbol: 'a', to: 'island' }] });
    assert.ok(r.model.notes.some((n) => /accepts nothing/.test(n)));
    assert.ok(r.model.notes.some((n) => /Not reachable from the start state: island/.test(n)));
  });
});

describe('NFA', () => {
  const NFA = { kind: 'automaton', type: 'nfa', alphabet: ['0', '1'], states: ['p', 'q', 'r'], start: 'p', accepting: ['r'], transitions: [{ from: 'p', symbol: '0', to: ['p', 'q'] }, { from: 'p', symbol: '1', to: 'p' }, { from: 'q', symbol: 'ε', to: 'r' }] };

  test('several targets and ε-moves are allowed', () => {
    const r = validateAutomaton(NFA);
    assert.equal(r.ok, true);
    assert.equal(r.model.transitions.length, 4);
    assert.equal(r.model.transitions[3].symbol, EPSILON);
  });

  test('acceptance follows ε-closure', () => {
    const { model } = validateAutomaton(NFA);
    assert.equal(automatonAccepts(model, ['1', '0']), true, 'p -0-> q -ε-> r');
    assert.equal(automatonAccepts(model, ['1']), false);
    assert.equal(automatonAccepts(model, []), false);
  });

  test('the transition table shows sets, the start state and the accepting states', () => {
    const table = automatonTable(validateAutomaton(NFA).model);
    assert.deepEqual(table.columns, ['State', '0', '1', 'ε']);
    assert.deepEqual(table.rows, [['→ p', '{p, q}', '{p}', ''], ['q', '', '', '{r}'], ['* r', '', '', '']]);
  });

  test('the same (state, symbol, target) written twice is one transition', () => {
    const r = validateAutomaton({ ...NFA, transitions: [...NFA.transitions, { from: 'p', symbol: '1', to: 'p' }] });
    assert.equal(r.model.transitions.length, 4);
  });

  test('a state named after a Mermaid keyword cannot break the drawing', () => {
    const r = validateAutomaton({ type: 'nfa', alphabet: ['a'], states: ['end', 'graph'], start: 'end', accepting: ['graph'], transitions: [{ from: 'end', symbol: 'a', to: 'graph' }] });
    const src = automatonToMermaid(r.model);
    assert.match(src, /s0\(\("end"\)\)/);
    assert.match(src, /s1\(\(\("graph"\)\)\)/);
    assert.equal(checkDiagramSource(src).neutralised.includes('reserved_id'), false, 'ids are generated, so nothing needs renaming');
  });

  test('it is read back in words', () => {
    assert.match(describeAutomaton(validateAutomaton(NFA).model), /^Nondeterministic finite automaton over \{0, 1\} with states p, q, r\. Start state p\. Accepting: r\./);
  });
});

describe('the notation block as a whole', () => {
  test('an automaton compiles to app-written Mermaid, with its transition table', () => {
    const c = compileVisualSource('notation', JSON.stringify(ENDS_IN_AB));
    assert.equal(c.ok, true);
    assert.equal(c.renderer, 'mermaid');
    assert.equal(c.label, 'DFA');
    assert.equal(c.table.rows.length, 3);
    assert.deepEqual(JSON.parse(c.exports.json), ENDS_IN_AB, 'the export is the semantic model, not Mermaid');
  });

  test('Chen compiles straight to a drawing', () => {
    const c = compileVisualSource('notation', JSON.stringify(CHEN));
    assert.equal(c.renderer, 'svg');
    assert.equal(c.label, 'ER diagram (Chen)');
    assert.equal(c.view, 'chen');
  });

  test('a notation it does not have is said to be unsupported, never approximated', () => {
    for (const kind of ['bpmn', 'circuit', 'venn', 'uml-deployment', undefined]) {
      const c = compileVisualSource('notation', JSON.stringify({ kind, nodes: [] }));
      assert.equal(c.ok, false);
      assert.equal(c.code, 'unsupported_notation');
    }
  });

  test('checkVisualSource says what a block is without drawing it', () => {
    assert.deepEqual(checkVisualSource('notation', JSON.stringify(ENDS_IN_AB)), { ok: true, view: 'automaton', type: 'dfa' });
    assert.deepEqual(checkVisualSource('notation', JSON.stringify(CHEN)), { ok: true, view: 'chen', type: 'chen-er' });
    assert.equal(checkVisualSource('notation', '{').ok, false);
    assert.equal(checkVisualSource('chart', JSON.stringify({ type: 'line' })).ok, false);
  });
});

// Found in review: the notes assumed the right-hand entity was the child, and
// that any borrowed key column was borrowed from every parent.
describe('crow\'s-foot notes are only given where the child is known', () => {
  test('a one-to-one keyed by the other side reads the left entity as the child when it is', () => {
    const a = analyseErDiagram('erDiagram\n    PROFILE ||--|| USER : "belongs to"\n    PROFILE {\n        int user_id PK, FK\n        string bio\n    }\n    USER {\n        int user_id PK\n    }');
    assert.deepEqual(a.notes, []);
  });

  test('a one-to-one with no borrowed key says nothing', () => {
    const a = analyseErDiagram('erDiagram\n    PASSPORT |o--|| PERSON : identifies\n    PASSPORT {\n        int passport_no PK\n    }\n    PERSON {\n        int person_id PK\n    }');
    assert.deepEqual(a.notes, []);
  });

  test('a many-to-many has no child, so no line advice', () => {
    const a = analyseErDiagram('erDiagram\n    STUDENT }o--o{ COURSE : takes\n    STUDENT {\n        int student_id PK\n    }\n    COURSE {\n        int course_id PK\n    }');
    assert.deepEqual(a.notes, []);
  });

  test('a key borrowed from two parents does not make a third, dashed, parent identifying', () => {
    const a = analyseErDiagram('erDiagram\n    STUDENT ||--o{ ENROLLMENT : has\n    COURSE ||--o{ ENROLLMENT : has\n    ADVISOR ||..o{ ENROLLMENT : approves\n    ENROLLMENT {\n        int student_id PK, FK\n        int course_id PK, FK\n        int advisor_id FK\n    }');
    assert.deepEqual(a.notes, []);
  });

  test('"%%" inside a quoted attribute comment is not a comment', () => {
    const a = analyseErDiagram('erDiagram\n    ORDER {\n        int id PK "100%% unique"\n    }');
    assert.deepEqual(a.notes, []);
    assert.equal(a.entities[0].attributes.length, 1);
  });
});

describe('automata: nothing is silently changed', () => {
  const base = { kind: 'automaton', type: 'nfa', alphabet: ['a', 'b'], states: ['q0', 'q1'], start: 'q0', accepting: ['q1'] };

  test('two long state names that shorten to the same label are refused, not merged', () => {
    const r = validateAutomaton({ ...base, states: ['waiting_for_input_1', 'waiting_for_input_2'], start: 'waiting_for_input_1', accepting: [], transitions: [] });
    assert.equal(r.ok, false);
    assert.match(r.message, /Use shorter state names/);
  });

  test('a transition that names no symbol is incomplete, never an ε-move', () => {
    const r = validateAutomaton({ ...base, transitions: [{ from: 'q0', to: 'q1' }] });
    assert.equal(r.ok, false);
    assert.match(r.message, /does not say which symbol it reads/);
  });

  test('"on" and a list of symbols are read as written', () => {
    const r = validateAutomaton({ ...base, transitions: [{ from: 'q0', on: 'a', to: 'q1' }, { from: 'q1', symbol: ['a', 'b'], to: 'q1' }] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.model.transitions.map((t) => `${t.from}-${t.symbol}-${t.to}`), ['q0-a-q1', 'q1-a-q1', 'q1-b-q1']);
  });

  test('one accepting state may be written as a name; a title keeps its words', () => {
    const r = validateAutomaton({ ...base, title: 'Binary strings that end in 01', accepting: 'q1', transitions: [{ from: 'q0', symbol: 'a', to: 'q1' }] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.model.accepting, ['q1']);
    assert.equal(r.model.title, 'Binary strings that end in 01');
    assert.equal(validateAutomaton({ ...base, title: { text: 'x' }, transitions: [] }).model.title, '');
  });

  test('a control character in a name cannot corrupt the drawing source', () => {
    const r = validateAutomaton({ ...base, states: ['a\u0000b', 'q1'], start: 'a\u0000b', transitions: [{ from: 'a\u0000b', symbol: 'a', to: 'q1' }] });
    assert.equal(r.ok, true);
    assert.ok(!automatonToMermaid(r.model).includes('undefined'));
  });
});

describe('Chen: a weak entity may be owned by another weak entity', () => {
  test('Building → Floor → Room, both relationships identifying', () => {
    const r = validateChenEr({
      kind: 'chen-er',
      entities: [{ name: 'Building', attributes: [{ name: 'id', key: true }] }, { name: 'Floor', weak: true, attributes: [{ name: 'level', partialKey: true }] }, { name: 'Room', weak: true, attributes: [{ name: 'number', partialKey: true }] }],
      relationships: [
        { name: 'has', identifying: true, participants: [{ entity: 'Building', cardinality: '1' }, { entity: 'Floor', cardinality: 'N' }] },
        { name: 'contains', identifying: true, participants: [{ entity: 'Floor', cardinality: '1' }, { entity: 'Room', cardinality: 'N' }] },
      ],
    });
    assert.equal(r.ok, true, r.message);
  });

  test('two weak entities that only own each other still have no owner', () => {
    const r = validateChenEr({
      kind: 'chen-er',
      entities: [{ name: 'A', weak: true }, { name: 'B', weak: true }],
      relationships: [{ name: 'r', identifying: true, participants: ['A', 'B'] }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'identifying_without_owner');
  });
});
