// Formal finite automata (DFA / NFA), checked and then drawn in the standard
// notation: a start arrow into the start state, circles for states, double
// circles for accepting states, labelled transitions.
//
// A generic state diagram is not an automaton: it has no alphabet, no notion
// of acceptance, and its terminal marker means "the lifecycle ends", not "the
// input is accepted". So an automaton is written as a small model, validated
// against the definition of its kind, and only then turned into a drawing:
//
//   DFA  every (state, symbol) has at most one target, no ε-moves, and every
//        symbol is in the alphabet. A missing (state, symbol) pair is reported
//        as an incomplete transition function (an implied dead state), not
//        invented.
//   NFA  a (state, symbol) may have several targets, and ε-moves are allowed.
//
// The drawing is produced by compiling the validated model to Mermaid
// flowchart source that THIS module writes (never the model's own text), so it
// goes through the same local renderer, sanitiser and export path as every
// other diagram.
//
// Pure: no DOM, no I/O.

import { clipText } from './svgText.mjs';

export const AUTOMATON_SPEC_VERSION = 1;
export const AUTOMATON_LIMITS = Object.freeze({ maxStates: 12, maxTransitions: 60, maxAlphabet: 12, maxNameChars: 16 });

/** How an ε-move may be written in a payload. */
const EPSILON_WORDS = new Set(['ε', 'epsilon', 'eps', 'lambda', 'λ', '']);
export const EPSILON = 'ε';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const label = (v) => (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? clipText(String(v).replace(/\s+/g, ' ').trim(), AUTOMATON_LIMITS.maxNameChars) : '');
/** Names as written, before they are shortened: two that shorten to the same label are one state too few. */
const collides = (list) => {
  const written = new Set(list.filter((v) => typeof v === 'string' || typeof v === 'number').map((v) => String(v).replace(/\s+/g, ' ').trim()).filter(Boolean));
  return written.size !== new Set([...written].map(label)).size;
};

function fail(code, message) {
  return { ok: false, code, message };
}

/**
 * @param {object} spec parsed `natively-diagram` payload with kind "automaton"
 * @returns {{ ok: true, model: object } | { ok: false, code: string, message: string }}
 */
export function validateAutomaton(spec) {
  if (!isObj(spec)) return fail('syntax', 'The diagram data could not be read.');
  const type = String(spec.type ?? '').toLowerCase();
  if (type !== 'dfa' && type !== 'nfa') return fail('missing_input', 'The automaton must say whether it is a DFA or an NFA.');

  const states = Array.isArray(spec.states) ? [...new Set(spec.states.map(label).filter(Boolean))] : [];
  if (states.length === 0) return fail('missing_input', 'The automaton has no states.');
  // Shortening must never merge two states into one.
  if (collides(spec.states)) return fail('too_large', `Two state names are the same in their first ${AUTOMATON_LIMITS.maxNameChars} characters. Use shorter state names.`);
  if (states.length > AUTOMATON_LIMITS.maxStates) return fail('too_large', 'This automaton has too many states to draw here.');

  const alphabet = Array.isArray(spec.alphabet) ? [...new Set(spec.alphabet.map(label).filter(Boolean))] : [];
  if (alphabet.length === 0) return fail('missing_input', 'The automaton has no alphabet.');
  if (alphabet.length > AUTOMATON_LIMITS.maxAlphabet) return fail('too_large', 'This alphabet is too large to draw here.');
  if (alphabet.some((s) => EPSILON_WORDS.has(s.toLowerCase()))) return fail('epsilon_in_alphabet', 'ε is not a symbol of the alphabet.');

  const start = label(spec.start);
  if (!start) return fail('missing_input', 'The automaton has no start state.');
  if (!states.includes(start)) return fail('unknown_state', `The start state "${start}" is not one of the states.`);

  // One accepting state may be written as a plain name.
  const acceptingIn = Array.isArray(spec.accepting) ? spec.accepting : typeof spec.accepting === 'string' || typeof spec.accepting === 'number' ? [spec.accepting] : [];
  const accepting = [...new Set(acceptingIn.map(label).filter(Boolean))];
  for (const a of accepting) if (!states.includes(a)) return fail('unknown_state', `The accepting state "${a}" is not one of the states.`);

  const raw = Array.isArray(spec.transitions) ? spec.transitions : [];
  if (raw.length > AUTOMATON_LIMITS.maxTransitions) return fail('too_large', 'This automaton has too many transitions to draw here.');
  const transitions = [];
  const seen = new Map(); // "from\u0000symbol" → Set(targets)
  for (const t of raw) {
    if (!isObj(t)) return fail('syntax', 'The diagram data could not be read.');
    const from = label(t.from);
    if (!states.includes(from)) return fail('unknown_state', `A transition leaves "${from || '?'}", which is not one of the states.`);
    // The symbol, under the names a model uses for it. A transition that names
    // no symbol at all is an incomplete transition, never a silent ε-move.
    const given = t.symbol ?? t.on ?? t.input ?? t.label ?? t.symbols;
    if (given === undefined || given === null) return fail('missing_input', `A transition from "${from}" does not say which symbol it reads.`);
    const symbolsIn = Array.isArray(given) ? given : [given];
    if (symbolsIn.length === 0 || symbolsIn.some((v) => typeof v !== 'string' && !(typeof v === 'number' && Number.isFinite(v)))) {
      return fail('missing_input', `A transition from "${from}" does not say which symbol it reads.`);
    }
    const targets = (Array.isArray(t.to) ? t.to : [t.to]).map(label).filter(Boolean);
    if (targets.length === 0) return fail('missing_input', `A transition from "${from}" has no target.`);
    for (const one of symbolsIn) {
      const rawSymbol = String(one).trim();
      const isEpsilon = EPSILON_WORDS.has(rawSymbol.toLowerCase());
      if (isEpsilon && type === 'dfa') return fail('epsilon_in_dfa', `A DFA has no ε-moves (from "${from}").`);
      const symbol = isEpsilon ? EPSILON : label(rawSymbol);
      if (!isEpsilon && !alphabet.includes(symbol)) return fail('symbol_not_in_alphabet', `"${symbol}" on a transition from "${from}" is not in the alphabet.`);
      for (const to of targets) {
        if (!states.includes(to)) return fail('unknown_state', `A transition from "${from}" goes to "${to}", which is not one of the states.`);
        const key = `${from}\u0000${symbol}`;
        const set = seen.get(key) || new Set();
        if (set.has(to)) continue; // the same move written twice
        set.add(to);
        seen.set(key, set);
        transitions.push({ from, symbol, to });
      }
    }
  }
  const notes = [];
  if (type === 'dfa') {
    for (const [key, set] of seen) {
      if (set.size > 1) {
        const [from, symbol] = key.split('\u0000');
        return fail('nondeterministic', `From "${from}" on "${symbol}" there is more than one target, so this is not a DFA.`);
      }
    }
    const missing = [];
    for (const s of states) for (const a of alphabet) if (!seen.has(`${s}\u0000${a}`)) missing.push(`(${s}, ${a})`);
    if (missing.length) notes.push(`The transition function is incomplete: no move for ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ` and ${missing.length - 6} more` : ''}. Those inputs are rejected (an implied dead state).`);
  }
  if (accepting.length === 0) notes.push('No accepting state was given, so this automaton accepts nothing.');
  const reachable = new Set([start]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const t of transitions) {
      if (reachable.has(t.from) && !reachable.has(t.to)) {
        reachable.add(t.to);
        changed = true;
      }
    }
  }
  const unreachable = states.filter((s) => !reachable.has(s));
  if (unreachable.length) notes.push(`Not reachable from the start state: ${unreachable.join(', ')}.`);

  return { ok: true, model: { v: AUTOMATON_SPEC_VERSION, type, title: typeof spec.title === 'string' || typeof spec.title === 'number' ? clipText(String(spec.title).replace(/\s+/g, ' ').trim(), 80) : '', states, alphabet, start, accepting, transitions, notes } };
}

/** Run the automaton on a word. Used by tests to check the model means what the drawing shows. */
export function automatonAccepts(model, word) {
  const closure = (set) => {
    const out = new Set(set);
    for (let changed = true; changed; ) {
      changed = false;
      for (const t of model.transitions) {
        if (t.symbol === EPSILON && out.has(t.from) && !out.has(t.to)) {
          out.add(t.to);
          changed = true;
        }
      }
    }
    return out;
  };
  let current = closure(new Set([model.start]));
  for (const symbol of word) {
    if (!model.alphabet.includes(symbol)) return false;
    const next = new Set();
    for (const t of model.transitions) if (t.symbol === symbol && current.has(t.from)) next.add(t.to);
    current = closure(next);
    if (current.size === 0) return false;
  }
  return [...current].some((s) => model.accepting.includes(s));
}

const quote = (text) => `"${String(text).replace(/"/g, "'").replace(/[<>]/g, '')}"`;
const stateLabel = (name) => quote(name);

/**
 * Mermaid flowchart source for a validated automaton. State ids are generated
 * (s0, s1, …) so a state named after a Mermaid keyword cannot break the
 * drawing; the names appear only as quoted labels.
 */
export function automatonToMermaid(model) {
  const id = new Map(model.states.map((s, i) => [s, `s${i}`]));
  const lines = ['flowchart LR'];
  // The start arrow comes from nowhere: an invisible, unlabelled node.
  lines.push('    start_marker[" "]');
  lines.push('    style start_marker fill:none,stroke:none');
  for (const s of model.states) {
    lines.push(model.accepting.includes(s) ? `    ${id.get(s)}(((${stateLabel(s)})))` : `    ${id.get(s)}((${stateLabel(s)}))`);
  }
  lines.push(`    start_marker --> ${id.get(model.start)}`);
  // One arrow per (from, to), its label listing every symbol that takes it.
  const grouped = new Map();
  for (const t of model.transitions) {
    const key = `${t.from}\u0000${t.to}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(t.symbol);
  }
  for (const [key, symbols] of grouped) {
    const [from, to] = key.split('\u0000');
    lines.push(`    ${id.get(from)} -->|${quote(symbols.join(', '))}| ${id.get(to)}`);
  }
  return lines.join('\n');
}

/** Plain sentences for a screen reader and the phone. */
export function describeAutomaton(model) {
  const kind = model.type === 'dfa' ? 'Deterministic finite automaton' : 'Nondeterministic finite automaton';
  const moves = model.transitions.map((t) => `${t.from} on ${t.symbol} goes to ${t.to}`).join('; ');
  return `${kind} over {${model.alphabet.join(', ')}} with states ${model.states.join(', ')}. Start state ${model.start}. Accepting: ${model.accepting.length ? model.accepting.join(', ') : 'none'}. ${moves ? `${moves}.` : ''}`.trim();
}

/** The transition table: rows are states, columns are symbols (plus ε for an NFA that uses it). */
export function automatonTable(model) {
  const usesEpsilon = model.transitions.some((t) => t.symbol === EPSILON);
  const symbols = usesEpsilon ? [...model.alphabet, EPSILON] : model.alphabet;
  const rows = model.states.map((s) => {
    const mark = `${s === model.start ? '→ ' : ''}${model.accepting.includes(s) ? '* ' : ''}${s}`;
    return [mark, ...symbols.map((a) => {
      const targets = model.transitions.filter((t) => t.from === s && t.symbol === a).map((t) => t.to);
      return model.type === 'dfa' ? targets[0] || '' : targets.length ? `{${targets.join(', ')}}` : '';
    })];
  });
  return { columns: ['State', ...symbols], rows };
}
