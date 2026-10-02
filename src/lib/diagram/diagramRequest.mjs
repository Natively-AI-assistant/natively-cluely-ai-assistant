// One decision, used by every route: does THIS turn want a diagram, of what
// kind, and how does it relate to the design already on the table?
//
// The decision is semantic and mode-independent. A mode changes voice and what
// may be read; it never decides whether "design a URL shortener" is a design
// task. Detection of the question's *route* stays with AnswerPlanner — this
// module takes its verdict (`answerType`) as the primary signal and adds only
// what the planner does not model: explicit diagram asks, output constraints,
// the diagram view, and follow-ups that refer to an existing design.
//
// Mermaid is an artifact language, not a programming task: nothing here ever
// marks a turn as coding, and a coding turn is never turned into a design
// turn — a mixed ask ("design X and implement Y") keeps both.
//
// Pure and synchronous. No model call, no I/O.

/**
 * What is drawn. The first four are the original system-design views; the rest
 * were added for the nine meeting modes (see visualCatalog.mjs for what each
 * one is written in and drawn by).
 * @typedef {'architecture' | 'sequence' | 'flowchart' | 'state'
 *   | 'decision' | 'er' | 'class' | 'mindmap' | 'timeline' | 'gantt' | 'dependency' | 'responsibility'
 *   | 'matrix' | 'chart' | 'chen' | 'automaton'} DiagramView
 */
/** @typedef {'create' | 'update' | 'explain' | 'refine' | 'none'} DiagramOperation */
/** @typedef {'text-and-diagram' | 'diagram-only' | 'source-only' | 'text-only'} DiagramOutput */
/**
 * What the visual's content rests on.
 * @typedef {'proposed-design' | 'meeting-reconstruction' | 'source-reconstruction' | 'evidence' | 'observed-data' | 'calculated' | 'scenario' | 'illustrative'} DiagramBasis
 */
/** @typedef {'explain' | 'compare' | 'reconstruct' | 'propose' | 'calculate' | 'forecast' | 'update'} VisualIntent */

/**
 * @typedef {object} DiagramRequest
 * @property {boolean} enabled        the diagram contract applies to this turn
 * @property {DiagramView} view
 * @property {DiagramOperation} operation
 * @property {DiagramOutput} output
 * @property {DiagramBasis} basis
 * @property {string} [parentArtifactId]  the design this turn updates or re-views
 * @property {boolean} withCode       the turn also asks for code; keep both
 * @property {boolean} explicit       the user asked for a diagram in so many words
 * @property {boolean} attachActiveDesign  give the model the current design as context
 * @property {string} reason          short machine-readable why (for tests and traces)
 * @property {VisualIntent} [intent]   what the answer is doing with the visual
 * @property {string} [chartIntent]    for view 'chart': forecast | breakeven | funnel | trend | breakdown | comparison | function | quadrant | generic
 * @property {string} [mode]           the resolved built-in mode template, 'custom', or 'unknown'
 * @property {boolean} [contextual]    eligible because of the task and the mode, not an explicit ask
 * @property {{ needed: string[], inRequest: string[] }} [inputs]  what a calculation needs, and which of those the request itself states
 */

import { resolveOtherLanguageRequest, undecidedOtherLanguageTurn, saysNoDrawing } from './diagramRequestI18n.mjs';

const DISABLED = Object.freeze({
  enabled: false,
  view: 'architecture',
  operation: 'none',
  output: 'text-only',
  basis: 'proposed-design',
  withCode: false,
  explicit: false,
  attachActiveDesign: false,
});

function disabled(reason, extra = {}) {
  return { ...DISABLED, ...extra, reason };
}

// What is decided on is one turn's worth of speech. Anything longer is read
// by its end (a run-on utterance ends in the ask), and no pattern here is ever
// run over an unbounded string.
const MAX_QUESTION_CHARS = 2400;
const MAX_MATERIAL_CHARS = 16000;

function normalise(text, max = MAX_QUESTION_CHARS) {
  const raw = String(text ?? '');
  return (raw.length > max ? raw.slice(-max) : raw)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    // Quotation marks around what was said are not part of it ("“Draw the
    // login flow”" is a request like any other).
    .replace(/[“”"«»]/g, '')
    // The names of the visuals, as people hyphenate them: "mind-map",
    // "state-machine", "flow-chart", "sequence-diagram", "decision-tree".
    // ("break-even" keeps its hyphen: that is how it is spelled.)
    .replace(HYPHENATED_VISUAL_RE, '$1 $2')
    // "Right — plot it", "back to the architecture – where's the bottleneck".
    .replace(/\s+[—–]\s+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\bplease to (?=[a-z])/g, 'please ')
    // "Er, lay out the steps": a filler at the head ("ER diagram" is not one).
    .replace(/^er[, ]+(?!diagrams?\b|models?\b)/, '')
    .replace(SPEECH_FILLER_RE, '')
    // "Would you mind adding monitoring to this?" is "can you add monitoring to this?".
    .replace(/\b(?:would|do) you mind (?:just |quickly |also )?(adding|removing|replacing|swapping|moving|changing|splitting|merging|dropping|renaming|including|switching|using)\b/g, (_, g) => `can you ${MIND_BASE[g]}`)
    .replace(SPEECH_HEDGE_RE, '')
    .replace(SPEECH_FALSE_START_RE, '')
    // A word, or two or three, said twice: "the the", "design a design a".
    // (Before apostrophes are restored: "whats whats" is two plain words.)
    .replace(/\b(\w+(?: \w+){0,2})(?: \1\b)+/g, '$1')
    .replace(/\bgimme\b/g, 'give me')
    .replace(/\blemme\b/g, 'let me')
    .replace(/\bwanna\b/g, 'want to')
    .replace(/\blets\b/g, "let's")
    .replace(/\b(what|where|how|who|that|there|here)s\b/g, "$1's")
    .replace(/\bid (like|love|want|say|put|add|use|go|prefer|rather)\b/g, "i'd $1")
    .replace(/\b(what if|if|so|and|but) its\b/g, "$1 it's")
    .replace(/\b(do|ca|wo|is|does|did|should|would|could)nt\b/g, "$1n't")
    .replace(SPEECH_LIKE_RE, '$1 ')
    .replace(/\b(\w+(?: \w+){0,2})(?: \1\b)+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
// What a live transcript does to a sentence: fillers, hedges, false starts,
// dropped apostrophes, repeated words. They are noise to every rule below, and
// with them in place "um can you like draw out the the login flow" asked for
// nothing.
// ("Er" is not here: it is also what an ER diagram is called.)
const SPEECH_FILLER_RE = /\b(?:um+|uh+|erm+|hmm+|mm+)\b[, ]*/g;
// ("What kind of chart" and "some sort of queue" are not hedges.)
const SPEECH_HEDGE_RE = /\b(?:you know|i mean)\b[, ]*|(?<!\b(?:what|which|some|any|this|that|a|the|every|each|same|different|another|other|one|is|what's) )\b(?:kind|sort) of\b[, ]*/g;
const SPEECH_FALSE_START_RE = /\b(?:no,? )?sorry,? /g;
// "Like" where it can only be a filler: "can you like draw", "what if we like
// add", "to like 24 months", "see like an ER diagram".
const MIND_BASE = { adding: 'add', removing: 'remove', replacing: 'replace', swapping: 'swap', moving: 'move', changing: 'change', splitting: 'split', merging: 'merge', dropping: 'drop', renaming: 'rename', including: 'include', switching: 'switch', using: 'use' };
const SPEECH_LIKE_RE = /\b((?:can|could|would|will) you|what if (?:we|i|it's|it)|so|to|and|see|have|get|add|do|make|draw|it's|at|of|for|about|by) like (?=(?:a|an|the|add|draw|show|make|put|do|design|sketch|plot|chart|map|give|roll|how|why|what|where|can|could|six|\d+|[a-z]+ing)\b)/g;
const HYPHENATED_VISUAL_RE = /\b(mind|state|flow|sequence|class|er|entity|data|decision|org|gantt|pie|bar|line|dependency|swimlane|swim)-(maps?|machines?|charts?|diagrams?|models?|trees?|relationship|flows?|lanes?|graphs?)\b/g;

// ── output constraints ──────────────────────────────────────────────────────

const VISUAL_WORDS = String.raw`(?:diagrams?|mermaid|drawings?|charts?|visuals?|flow ?charts?|tables?|pictures?|graphs?|sketch(?:es)?)`;
// "No diagram", "skip the chart", "don't draw anything", "no need for a
// diagram". Not "there is no diagram in the doc": that is a fact about the doc.
const NO_DIAGRAM_RE = new RegExp(
  [
    // A visual, not a thing named after one: "without a graph database", "no
    // table scans", "no need for a table of components" (a table of something
    // is content, not the output format), "drop the table" (an entity).
    String.raw`(?<!\bthere (?:is|are|was|were) )\b(?:no|without(?: a| an| any)?|skip(?: the)?|leave out(?: the)?|drop(?: the)?(?! tables?\b)) (?:need (?:for|of) (?:a |an |any )?)?${VISUAL_WORDS}\b(?! (?:in|on|at|yet|exists?|available|of|databases?|db|scans?|stores?|lookups?|joins?|locks?|theory|search|traversal|algorithms?|apis?|quer(?:y|ies)|ql|paper|data)\b)`,
    // "It", "one", "anything" stand for a drawing only after a drawing verb.
    String.raw`\b(?:don'?t|do not|never|please don'?t|no need to) (?:draw|sketch)(?: me)?(?: a| an| any| the)? (?:${VISUAL_WORDS}|anything|it|one)\b`,
    String.raw`\b(?:don'?t|do not|never|please don'?t|no need to) (?:want|need|include|add|give me|show|make|create|use|bother with)(?: me)?(?: a| an| any| the)? ${VISUAL_WORDS}\b`,
    String.raw`\b(?:don'?t|do not) need(?: a| an| any)? ${VISUAL_WORDS}\b`,
  ].join('|'),
);
// "Explain only", "just explain it": a softer preference for words. A request
// for a drawing in the same turn wins over it, and it is never read out of the
// user's standing instructions ("just tell me what to say" is about voice).
const WORDS_ONLY_RE =
  /\b(?:explain|explanation|prose) only\b|\bin (?:plain )?(?:words|prose) only\b|(?:^|[.;!?]\s+)(?:(?:ok(?:ay)?|so|now|please)[, ]+)*(?:just|only) (?:explain|describe|tell me|talk (?:me )?through)\b/;

const SOURCE_ONLY_RE =
  /\b(?:just|only)(?: give me| show me| output| return)?(?: the)? (?:raw )?mermaid\b|\b(?:give me|show me|output|return|i want|i need)(?: just)?(?: the)? mermaid (?:source|code|syntax|text|markup)\b|\b(?:mermaid |diagram )(?:source|syntax|code) only\b|\bas (?:raw )?mermaid\b|\bgive me (?:the )?mermaid\b/;

// A constraint on the answer, so it comes at the end of what was said — never
// "users who get no text messages" in the middle of a design question.
const DIAGRAM_ONLY_RE =
  /\bdiagram only\b|\b(?:only|just)(?: give me| show me)? the (?:diagram|flowchart|chart|picture|drawing)\b|\bno (?:explanation|prose|commentary)(?: (?:please|needed|necessary|required))?\s*[.!]?\s*$|\bwithout (?:any |an )?(?:explanation|prose|commentary)\s*[.!]?\s*$/;

// ── requests ────────────────────────────────────────────────────────────────
//
// A visual is ASKED FOR when a request verb governs it: the verb stands where
// a request goes (the start of a sentence, after "can you", "please", "let's",
// "I'd like you to" …) and the thing to draw follows it in the same clause.
// A verb somewhere and a noun somewhere else is not a request: "did you ever
// have to present a forecast?", "give me a second, I'm pulling up the chart",
// "what conclusions did you draw from the data?".

// Words a request can open with before it gets to the point: "hey, draw …",
// "first, draw …", "okay so now just draw …". An open class, kept wide — a
// request refused because it began with "hey" is a worse miss than any gain.
const LEAD_TOKEN = String.raw`(?:ok(?:ay)?|now|and|also|then|next|so|please|actually|great|cool|alright|right|yes|yeah|yep|sure|well|um|uh|hey|hi|hello|first(?:ly)?|second(?:ly)?|third(?:ly)?|finally|lastly|basically|maybe|perhaps|quickly|kindly|just|oh|hmm|listen|look|thanks|thank you|perfect|nice|good|fine|anyway|one more thing|by the way|btw)`;
const LEAD_WORDS = String.raw`(?:${LEAD_TOKEN}[, ]+)*`;
const ASK_ADVERB = String.raw`(?: (?:please|just|quickly|also|maybe|kindly|perhaps|now|then))*`;
const ASK_PREFIX = String.raw`(?:(?:can|could|would|will) (?:you|we|i|someone|somebody|anyone)${ASK_ADVERB} |please |kindly |(?:i|we)(?:'d| would) like (?:you )?to |(?:i|we) (?:want|need) (?:you )?to |help (?:me|us)(?: to)? |go ahead and |feel free to |(?:i(?:'d| would) (?:be grateful|appreciate it) )?if you (?:could|can|would)${ASK_ADVERB} |(?:would it be|is it) possible to |would you be able to )`;
// "Someone draw the architecture please": an imperative with its subject said.
const VOCATIVE = String.raw`(?:(?:someone|somebody|anyone|anybody)(?: please)? )`;
/** Where a request verb can stand. */
const FRAME = String.raw`(?:(?:^|[.;!?]\s+)${LEAD_WORDS}(?:${ASK_PREFIX}|${VOCATIVE})?|\b${ASK_PREFIX})`;
// "Let's draw it" asks for a drawing. "Let's plan the sprint" and "let us
// compare the options offline" say what the meeting will do next.
const LETS_FRAME = String.raw`\b(?:let'?s|let us) (?:just |quickly |also )?`;
// A second request in the same sentence: "design X and draw the flow",
// "explain DNS, then show it as a diagram". It continues a request — it does
// not turn a statement into one: "normally we just show the customer a bar
// chart", "studies also show that pie charts mislead" (see requestSegments).
const AND_FRAME = String.raw`(?:\b(?:and|then|also|plus) (?:then |also |just |please )*|,\s*(?:then |and |also |so |please |just )*)`;
// After a comma a new clause begins, and it can be an instruction whatever
// came before: "there is no diagram in the doc, so draw the architecture",
// "if the deal closes, show me the forecast".
const COMMA_FRAME = String.raw`,\s*(?:(?:then|and|also|so|please|just|now) )*`;

// A verb that can only mean "produce a picture".
const PURE_DRAW = String.raw`(?:draw|sketch(?: (?:this|that|it) out| out)?|visuali[sz]e|illustrate|depict|whiteboard|diagram|redraw|mind[- ]?map|map (?:(?:this|that|it|things|everything) )?out|chart out)`;
// A verb that displays whatever its object names.
const SHOWISH = String.raw`(?:show|display|lay (?:(?:it|this|that|them|these|those) )?out|plot|chart|graph|map)`;
// A verb that produces or arranges: a request for a picture only with a visual
// noun, or as the first word of a task that implies one ("model users, orders
// and payments", "compare these offers").
// ("Use" and "put" are not here. "Do" and "pull up" are, with care: "do a
// diagram" and "pull up a diagram of the flow" produce one; "do we have a Gantt
// chart?" and "pull up the bar chart from last quarter" do not — see
// requestSegments.)
const MAKE = String.raw`(?:give|make|create|generate|produce|prepare|mock up|whip up|render|present|build|construct|turn|convert|change|switch|transform|reconstruct|reproduce|recreate|redo|organi[sz]e|structure|model|plan|compare|outline|summari[sz]e|forecast|project|add|include|design|tabulate|do|pull up|bring up|put together)`;
// What a sentence that asks for something starts with. Only used to tell a
// request from a statement; these are not all verbs that can produce a visual.
const IMPERATIVE_VERB = String.raw`(?:${PURE_DRAW}|${SHOWISH}|${MAKE}|put|use|represent|lay|explain|describe|tell|walk|talk|list|help|write|implement|take|start|answer|respond|reply|state|cover|provide|return|output|format|note|mention|highlight|ensure|make sure|remember|avoid|prefer|figure out|work out|break down|think|consider|imagine|suppose|assume|troubleshoot|diagnose|navigate|handle|go|try|keep|change|switch|replace|remove|update|set|move|rename|simplify|expand|zoom|focus|let|see|check|look at|find)`;
// Words that are a verb only when an object follows ("chart the response
// times"), and a noun otherwise ("chart 3 shows", "project timeline is at risk",
// "plot twist").
const NOUN_VERB_RE = /^(?:plot|chart|graph|map|diagram|model|plan|structure|outline|forecast|project|whiteboard|use)$/;
const OBJECT_START_RE = /^(?:me |us )?(?:the|this|that|these|those|a|an|our|my|your|their|his|her|its|it|out|how|what|which|who|where|all|each|every|some|both)\b/;

const REQUEST_VERB_RE = new RegExp(String.raw`${FRAME}(${PURE_DRAW}|${SHOWISH}|${MAKE})\b`, 'g');
const LETS_VERB_RE = new RegExp(String.raw`${LETS_FRAME}(${PURE_DRAW}|${SHOWISH}|include|add|give|do|make|create|build|put together)\b`, 'g');
// ("…and include a sequence diagram" is the one producing form that follows "and".)
const AND_VERB_RE = new RegExp(String.raw`${AND_FRAME}(${PURE_DRAW}|${SHOWISH}|include|add|give)\b`, 'g');
const COMMA_VERB_RE = new RegExp(String.raw`${COMMA_FRAME}(${PURE_DRAW}|show me|show us|give me|show(?= (?:this|that|it|the) ))\b`, 'g');
/** Does this sentence open as a request or an instruction (as opposed to a statement)? */
const REQUEST_START_RE = new RegExp(String.raw`^${LEAD_WORDS}(?:${ASK_PREFIX}|${VOCATIVE}|(?:let'?s|let us) (?:just |quickly |also )?)?${IMPERATIVE_VERB}\b`);
const REQUEST_INSIDE_RE = new RegExp(String.raw`\b${ASK_PREFIX}\w`);
// "Would you mind drawing the login flow?"
const GERUND_VERB_RE =
  /\b(?:would|do) you mind (?:just |quickly |also )?(drawing|sketching|plotting|charting|graphing|showing|mapping out|diagramming|visuali[sz]ing|illustrating|whiteboarding|putting together|making|creating|building|generating|laying out|giving me|pulling up|mocking up)\b/g;
// "Diagramming the onboarding steps would help", "mapping out the steps as a decision tree, please".
const GERUND_HEAD_RE = new RegExp(String.raw`^${LEAD_WORDS}(drawing|sketching|plotting|charting|graphing|mapping out|diagramming|visuali[sz]ing|illustrating|whiteboarding)\b(?=[^.;!?]*(?:\bwould (?:really |probably )?(?:help|be (?:useful|helpful|good|great|nice))\b|,?\s*(?:please|pls)\b))`);
const GERUND_BASE = { 'putting together': 'put together', making: 'make', creating: 'create', building: 'build', generating: 'generate', 'laying out': 'lay out', 'giving me': 'give me', 'pulling up': 'pull up', 'mocking up': 'make', drawing: 'draw', sketching: 'sketch', plotting: 'plot', charting: 'chart', graphing: 'graph', showing: 'show', 'mapping out': 'map out', diagramming: 'diagram', visualizing: 'visualize', visualising: 'visualise', illustrating: 'illustrate', whiteboarding: 'whiteboard' };
// "Could that be drawn as a state machine?"
const PASSIVE_VERB_RE =
  /\b(?:can|could|should|may|might) (this|that|it|these|those|the [\w-]+(?: [\w-]+){0,3}?) be (drawn|sketched|shown|plotted|charted|graphed|diagrammed|visuali[sz]ed|mapped(?: out)?|laid out|illustrated)\b/g;
// …and in statement order: "the auth flow should be drawn as a sequence diagram".
const PASSIVE_STATEMENT_RE =
  /(?:^|[.;!?]\s+)(this|that|it|these|those|the [\w-]+(?: [\w-]+){0,3}?) (?:should|could|can|needs to|must|ought to) be (drawn|sketched|plotted|charted|graphed|diagrammed|visuali[sz]ed|mapped(?: out)?|laid out|illustrated)\b/g;
const PASSIVE_BASE = { drawn: 'draw', sketched: 'sketch', shown: 'show', plotted: 'plot', charted: 'chart', graphed: 'graph', diagrammed: 'diagram', visualized: 'visualize', visualised: 'visualise', mapped: 'map', 'mapped out': 'map out', 'laid out': 'lay out', illustrated: 'illustrate' };

/** The sentence of `q` that position `at` falls in, and where it starts. */
function sentenceAt(q, at) {
  let start = 0;
  for (const m of q.slice(0, at).matchAll(/[.;!?]\s+/g)) start = m.index + m[0].length;
  const rest = q.slice(start);
  const end = rest.search(/[.;!?](?:\s|$)/);
  return { text: end === -1 ? rest : rest.slice(0, end), start };
}

/**
 * Is position `at` inside a request: a sentence that opens as an instruction
 * ("explain DNS with a diagram"), or the part of one that follows a request
 * frame ("…, can you show it as a chart")? A statement that mentions a chart
 * is not one ("normally we just show the customer a bar chart and they sign"),
 * and neither is what was said BEFORE the request ("we are on a tight
 * timeline, can you start Monday?").
 */
function inRequest(q, at) {
  const sentence = sentenceAt(q, at);
  if (REQUEST_START_RE.test(sentence.text)) return true;
  const frame = REQUEST_INSIDE_RE.exec(sentence.text);
  if (frame && sentence.start + frame.index <= at) return true;
  // "It would be nice to see the handshake as a sequence diagram", and the
  // ask that comes after what it asks for: "…as a sequence diagram, can you
  // do that?".
  const wish = WISH_FRAME_RE.exec(sentence.text);
  if (wish && sentence.start + wish.index <= at) return true;
  return TRAILING_ASK_RE.test(sentence.text);
}
const WISH_FRAME_RE = /\b(?:wouldn't it be|would it not be|it would be|it'd be|would be) (?:really |quite |so )?(?:nice|good|great|helpful|useful|handy|cool) to (?:see|have|get)\b|\b(?:would it be|is it) possible to (?:see|have|get)\b/;
const TRAILING_ASK_RE = /\b(?:can|could|would|will) you (?:please )?(?:do|show|draw|make) (?:that|it|this)(?: for (?:me|us))?(?: please)?\s*[.?!]*$/;

// "What does the login flow look like as a flowchart?": a question that asks
// to be shown something. Not one about the past or about the person asked.
const SHOW_QUESTION_RE = /^(?:(?:ok(?:ay)?|so|and|but|now)[, ]+)*(?:what|how|which|where)\b/;

const PURE_DRAW_RE = new RegExp(String.raw`^${PURE_DRAW}$`);
const SHOWISH_RE = new RegExp(String.raw`^${SHOWISH}$`);

/**
 * Every request verb in the sentence with the rest of its clause.
 * `kind`: 'draw' | 'show' | 'make'. `object`: the clause after the verb.
 */
function requestSegments(q) {
  const out = [];
  const seen = new Set();
  const push = (verb, at, rest) => {
    if (seen.has(at)) return;
    seen.add(at);
    // The clause ends at its punctuation, or where a new subject starts:
    // "give me a second, I am pulling up the chart".
    const end = rest.search(/[.;!?](?:\s|$)|,\s+(?:i|we|you|he|she|they|it|but|because|which|while|although|though)\b/);
    const clause = (end === -1 ? rest : rest.slice(0, end)).slice(0, 160);
    const object = clause.slice(verb.length).trimStart();
    // "Do we have a Gantt chart for this?": the auxiliary, not the verb.
    if (verb === 'do' && /^(?:we|you|they|i|he|she|it|these|those|any|not)\b/.test(object)) return;
    // "Pull up the bar chart from last quarter": one that exists. "Pull up a
    // diagram of the request flow": one to make.
    if (/^(?:pull|bring) up$/.test(verb) && !/^(?:me |us )?(?:a|an|some)\b/.test(object)) return;
    // "uh, draw" — a verb with nothing after it asks for nothing (unless the
    // verb carries its own object: "map this out", "sketch it out").
    if (object.replace(/[^a-z0-9]/g, '').length < 2 && !/ (?:this|that|it|things|everything) /.test(`${verb} `)) return;
    out.push({ verb, kind: PURE_DRAW_RE.test(verb) ? 'draw' : SHOWISH_RE.test(verb) ? 'show' : 'make', clause, object, at });
  };
  for (const re of [REQUEST_VERB_RE, LETS_VERB_RE]) {
    re.lastIndex = 0;
    for (let m = re.exec(q); m; m = re.exec(q)) {
      const verb = m[1];
      const at = m.index + m[0].length - verb.length;
      re.lastIndex = at + verb.length;
      push(verb, at, q.slice(at));
    }
  }
  // "…and draw the flow", "…, then show it as a diagram": a continuation, good
  // only in a sentence that is itself a request.
  AND_VERB_RE.lastIndex = 0;
  for (let m = AND_VERB_RE.exec(q); m; m = AND_VERB_RE.exec(q)) {
    const verb = m[1];
    const at = m.index + m[0].length - verb.length;
    AND_VERB_RE.lastIndex = at + verb.length;
    if (!inRequest(q, at)) continue;
    push(verb, at, q.slice(at));
  }
  COMMA_VERB_RE.lastIndex = 0;
  for (let m = COMMA_VERB_RE.exec(q); m; m = COMMA_VERB_RE.exec(q)) {
    const verb = m[1].replace(/ (?:me|us)$/, '');
    const at = m.index + m[0].length - m[1].length;
    COMMA_VERB_RE.lastIndex = at + verb.length;
    push(verb, at, q.slice(at));
  }
  // "Would you mind drawing the login flow?"
  GERUND_VERB_RE.lastIndex = 0;
  for (let m = GERUND_VERB_RE.exec(q); m; m = GERUND_VERB_RE.exec(q)) {
    const verb = GERUND_BASE[m[1]] || 'draw';
    const at = m.index + m[0].length - m[1].length;
    push(verb, at, verb + q.slice(at + m[1].length));
  }
  // "Could that be drawn as a state machine?": the subject is the object.
  for (const re of [PASSIVE_VERB_RE, PASSIVE_STATEMENT_RE]) {
    re.lastIndex = 0;
    for (let m = re.exec(q); m; m = re.exec(q)) {
      const verb = PASSIVE_BASE[m[2]] || 'draw';
      push(verb, m.index, `${verb} ${m[1]}${q.slice(m.index + m[0].length)}`);
    }
  }
  const gerundHead = GERUND_HEAD_RE.exec(q);
  if (gerundHead) {
    const verb = GERUND_BASE[gerundHead[1]] || 'draw';
    const at = gerundHead[0].length - gerundHead[1].length;
    push(verb, at, verb + q.slice(at + gerundHead[1].length));
  }
  return out.sort((a, b) => a.at - b.at);
}

// What a diagram is called when it is not one of the catalog's own names.
const DIAGRAM_NOUN_RE =
  /\b(?:diagrams?|flow ?charts?|sequence(?: diagram)?|state (?:machine|diagram|chart)|mermaid|lifecycle|life cycle|architecture diagram|block diagram|schematics?|visuals?|(?:quick |rough |simple )?sketch of|drawing of|picture of (?:how|the|this|that|these|those|our|a|an)\b|(?:request|call|data|message|write|read|delivery|auth\w*|login|payment|control) (?:flow|path|sequence))\b/;
// "Explain the water cycle with a diagram", "explain photosynthesis as a
// flowchart", "explain DNS using diagrams": asked for by name, with no drawing
// verb at all.
const DIAGRAM_BY_NAME_RE =
  /\b(?:with|as|in|using|into|use) (?:an? (?:(?!the\b|that\b|this\b)\w+ )?(?:diagram|flow ?chart)|diagrams|flow ?charts)\b(?!\s+(?:\w+\s+)?(?:services?|systems?|apis?|editors?|tools?|engines?|platforms?|apps?|librar(?:y|ies)))/;
// "…as a chart", "…in a table", "design a chart showing …".
const VISUAL_BY_NAME_RE =
  /\b(?:(?:with|as|in|on|using|into) an? (?:\w+ )?(?:diagram|chart|plot|timeline|table|matrix|mind ?map|flow ?chart|visual)|(?:in|into|as|with) swim ?lanes?|design an? (?:\w+ )?(?:diagram|chart|plot|timeline|mind ?map|flow ?chart|visual))\b(?!\s+(?:\w+\s+)?(?:services?|systems?|apis?|editors?|tools?|engines?|platforms?|databases?|apps?|of contents))/;
// "I need a diagram", "can I see a flowchart of the login process?", "a diagram would help".
const WANT_VISUAL_RE =
  /(?:\b(?:i|we)(?:'d| would) (?:like|love)(?: to (?:see|get|have))?|\b(?:would it be|is it) possible to (?:see|get|have)|\b(?:i|we) (?:need|want)(?: to (?:see|get|have))?|\b(?:can|could|may) (?:i|we) (?:see|get|have)|\b(?:let me|let us|let'?s) see|(?:^|[.;!?]\s+)(?:(?:ok(?:ay)?|so|and|hey|well|now)[, ]+)*(?:how|what) about|(?:^|[.;!?]\s+)(?:please )?(?:show me|give me))\s+((?:a|an|the|some)\s+[^.;!?,]{0,70})|(?:^|[.;!?]\s+)((?:a|an)\s+(?:\w+\s+)?(?:diagram|flow ?chart|chart|visual|drawing|sketch))(?: (?:of|for|showing) [^.;!?,]{1,60})? would (?:really |probably )?(?:help|be (?:useful|helpful|good|great|nice|better|ideal))/;
// "Show this graphically", "can you show that visually?".
// "I want to see this as a graph": a graph of THIS, not the data structure.
// (Not "can we view this as a graph problem?": that is the data structure.)
const AS_A_GRAPH_RE = /\b(?:see|show|view|draw|put|display|have|get)(?: me)? (?:this|that|it|these|those|the \w+) (?:as|in|on) an? (?:\w+ )?graph\b(?! (?:problem|theory|search|traversal|algorithm|database|db|structure|question)s?\b)/;
const VISUALLY_RE = /\b(?:show|explain|represent|present|display|put|lay)\b[^.;!?]{0,40}\b(?:graphically|visually)\b/;
// "Quick sketch of the architecture?", "A diagram of the login flow, please".
const DIAGRAM_FRAGMENT_RE = new RegExp(String.raw`^${LEAD_WORDS}(?:(?:an?|the|one) )?(?:(?:[\w-]+ )?(?:sketch|diagram|drawing|flow ?chart|visual|schematic|state machine)(?: (?:of|for|showing)\b|\s*,?\s*(?:please|pls)\b)|(?:high[- ]level )?architecture (?:of|for)\b)`);
// A fragment has no verb of its own: "the org chart for engineering is
// outdated" and "a decision tree for this would be overkill" are statements.
const FINITE_VERB_RE = /\b(?:is|are|was|were|be|been|isn'?t|aren'?t|wasn'?t|has|have|had|would|will|won'?t|should|shall|can|can'?t|could|might|must|does|do|did|doesn'?t|don'?t|seems?|looks?|needs?|gets?|got|went|goes|came|shows?|means?)\b/;
// Mermaid named as the format wanted — not "I used Mermaid at my last job".
const MERMAID_REQUEST_RE = /\b(?:in|as|using|with|give me|show me|write|output|return|generate|make|create|draw)\b[^.;!?]{0,30}\bmermaid\b/g;

// A drawing verb in a sense that is not drawing.
const DRAW_IDIOM_RE =
  /\bdraw (?:(?:a|the|any|your|my|our|some|two|three|four|five) )?(?:own )?(?:curtains?|blinds?|shades?|drapes?|bath\b|cards?\b(?! (?:sort|layout|diagram))|lots\b|straws?|blood|breath|water\b(?! (?:cycle|system|flow))|fire\b|crowds?|salary|pension|swords?|guns?|weapons?|line\b(?! (?:chart|graph|diagram))|conclusions?|comparisons?\b(?! (?:table|chart|matrix|grid|diagram))|parallels?|attention|inspiration|blank|distinction|lessons?)|\bdraw (?:on|from|upon|near|back|to a close)\b|\bdraw (?:out|up)\b(?! (?:(?:the|a|an|this|that|our|your|my) )?(?:[\w-]+ ){0,3}(?:diagrams?|charts?|flow ?charts?|flows?|maps?|trees?|tables?|timelines?|sequences?|state machines?|architectures?|schemas?|models?|graphs?|sketch(?:es)?|plans?\b|matrix|lifecycles?))|\billustrate\b[^.;!?]*\b(?:with|by|using|through) (?:an?|some|a few|a couple of|real|concrete) (?:\w+ )?(?:examples?|stor(?:y|ies)|anecdotes?|instances?|cases?)\b|\bvisuali[sz]e (?:myself|yourself|ourselves|success|the future|working|being)\b|\bwhiteboard(?:ing)? (?:interviews?|sessions?|rounds?|coding|exercises?|problems?|questions?)\b|\b(?:map|sketch|chart) out (?:(?:the|my|your|our|some|a) )?(?:next|career|future|year|quarter|week|day|goals|strategy|plans?|time|details|logistics|agenda)\b/;

// "Show the write path only", "show it as …" — a new view of the design on the table.
const VIEW_OF_DESIGN_RE = /\b(?:show|give me|just|let'?s see|can (?:i|we) see|(?:i|we)(?:'d| would) like to see|(?:i|we) want to see)\b[^.?!]*\b(?:path|flow|sequence|view|part|side|layer)\b|\bshow\b[^.?!]*\b(?:failure|error|unhappy|happy|retry|timeout|fallback|edge) (?:case|scenario)\b|\bas an? (?:sequence|state|flow|architecture)\b|\b(?:zoom in(?:to)? on|zoom into|focus on|drill into)\b/;

// "What is a sequence diagram?", "Have you used flowcharts?" — about diagrams, not asking for one.
const ABOUT_DIAGRAMS_RE =
  /^(?:what(?:'s| is| are)|define|explain what|have you|do you|did you|are you|when (?:would|should|do) (?:you|i|we))\b[^.?!]*\b(?:diagrams?|flow ?charts?|state machines?|uml|mermaid|er diagrams?|class diagrams?|gantt charts?|mind ?maps?|timelines?|dfa|nfa|automat(?:on|a)|pie charts?|bar charts?|line charts?|funnels?|decision trees?)\b/;
// "What is a DFA?", "What's the difference between an NFA and a DFA?": a concept question.
// "What is caching?", "what are abstract classes for?", "what is the cost
// breakdown?", "what does the rollout plan look like?": a question that looks
// something up or asks what a thing is. It is answered in words.
const CONCEPT_QUESTION_RE = /^(?:what(?:'s| is| are)|define|explain what|what does|what do you mean by|difference between|when (?:would|should|do) (?:you|i|we) use)\b/;
// The exception: a "what" question that asks for a STRUCTURE to be laid out —
// the steps, the stages, the process for a case, the order given the
// dependencies, how something looks stage by stage.
const STRUCTURE_QUESTION_RE =
  /^what(?:'s| is| are) the (?:process|steps|stages|phases|milestones|order|sequence of steps|dependency order)\b|^what(?:'s| is) block(?:ing|ed) what\b|^what\b[^.?!]*\b(?:step by step|at each stage|at every stage|by stage|stage by stage|depends? on which|blocks? which)\b/;
// Said to a person about that person: "walk me through your career history",
// "how does your approval process work?". The answer is theirs to say.
const SECOND_PERSON_RE = /\b(?:your|yours|yourself)\b|\b(?:do|did|does|are|were|have|had|would|will) you\b|\byou (?:have|had|did|do|were|are|handle|plan|compare|see|think|feel|know|use|work)\b/;
// A yes-or-no about how things stand: "did someone change the database schema?".
const YES_NO_RE = /^(?:(?:ok(?:ay)?|so|and|but|wait)[, ]+)*(?:did|does|do|is|are|was|were|has|have|had)\b/;
// A question ABOUT the thing — who owns it, why it is so, how long it took,
// where it is kept — does not ask to see it: "who owns the rollout plan?",
// "why is the project schedule slipping?", "where is the schema documented?".
// ("Who owns what?" asks for the whole map and is not this.)
const ABOUT_THE_THING_RE =
  /^(?:(?:ok(?:ay)?|so|and|but)[, ]+)*(?:who (?:owns|wrote|made|created|built|maintains|runs|leads|manages|approved|signed|updated|has) (?:the|this|that|our|your|a)\b|why\b|how (?:long|many|much|often|soon)\b|when (?:is|are|was|were)\b|where (?:is|are|was|were|do|does|did|can) (?:i |we |you )?(?:the|this|that|our|find)\b[^.?!]*\b(?:documented|stored|kept|located|saved|written|find|live|lives)\b)/;
// A recounting of what was: "what were the key milestones on that project?".
const PAST_RE = /^(?:(?:ok(?:ay)?|so|and|but)[, ]+)*(?:what|how|where|when|who|why) (?:were|was|did|had)\b|\bwhat happened\b/;
// Not now: "let's compare the options offline".
// ("Show me a Gantt chart for next sprint" and "show the break-even if we
// start next week" name what the visual is about; they postpone nothing.)
const DEFER_RE = /\b(?:offline|later(?: on)?|afterwards?|another time|some other time|not (?:right )?now|async(?:hronously)?|after (?:the|this) (?:call|meeting|session)|when we(?:'re| are) done)\b/;
// Someone who wants it short wants words: "in one sentence", "quick yes or no".
const BREVITY_RE = /\bin (?:one|a|two|a couple of|a few) (?:sentences?|words?|lines?)\b|\bone[- ]liner\b|\byes or no\b|\btl;?dr\b|\b(?:very )?(?:briefly|quickly)\b|\bquick (?:answer|question|one)\b/;

// ── view cues ───────────────────────────────────────────────────────────────

const VIEW_SEQUENCE_RE =
  /\bsequence\b|\b(?:request|call|message|delivery|auth\w*|login|payment|handshake) (?:flow|sequence)\b|\bhandshake\b|\bround[- ]?trip\b|\bwho calls (?:who|whom|what)\b|\binteractions? between\b/;
const VIEW_STATE_RE = /\bstate (?:machine|diagram|chart|transitions?)\b|\blife ?cycle\b|\bstates? and transitions?\b|\bstatus (?:flow|transitions?)\b/;
const VIEW_FLOWCHART_RE = /\bflow ?chart\b|\bdecision (?:tree|flow)\b|\bprocess (?:flow|diagram)?\b|\bworkflow\b|\bstep[- ]by[- ]step\b|\bpipeline stages\b|\balgorithm\b/;
const VIEW_ARCHITECTURE_RE = /\barchitecture\b|\bcomponents?\b|\bhigh[- ]level\b|\bblock diagram\b|\bsystem (?:design|diagram|overview)\b|\bdeployment\b|\btopology\b/;

// ── the wider catalog (nine modes) ──────────────────────────────────────────
//
// Each entry: a view, the words that name it (`noun`), and the task phrases
// that imply it without naming a picture (`task`).
//   `unamb`  the noun can only mean a picture ("ER diagram", "mind map",
//            "gantt chart"). An everyday word that also names one ("timeline",
//            "forecast", "funnel") is not: "give me a timeline for delivery"
//            asks for a date, so those need a verb that shows or draws.
//   `task`   phrases, never single nouns. "We need to update the schema" and
//            "the handoff went fine" mention a thing; they ask for nothing.
// Order matters: the first match wins, so the specific come before the general.

const VISUAL_DETECTORS = Object.freeze([
  { view: 'automaton', unamb: true, noun: /\b(?:dfa|nfa|finite[- ](?:state )?automat(?:on|a)|automat(?:on|a))\b/ },
  // "Chen" is also a colleague: only the notation counts.
  { view: 'chen', unamb: true, noun: /\bchen(?:'s)? (?:notation|er\b|e-r\b|diagram|model|style)|\bin chen\b|\bchen[- ]style\b/ },
  {
    view: 'er',
    unamb: true,
    noun: /\b(?:er|e-r|e\.r\.|entity[- ]relationship) (?:diagram|model)\b|\bcrow'?s[- ]foot\b|\berd\b/,
    task: /\bdata model\b|\b(?:database|db|table) schema\b|\bschema (?:for|of)\b|\bmodel (?:the )?(?:users?|customers?|orders?|payments?|products?|accounts?|tables?|entities)\b|\b(?:entities|tables) and (?:their )?relationships\b/,
  },
  {
    view: 'class',
    unamb: true,
    noun: /\b(?:uml )?class diagram\b|\buml diagram\b|\bclass hierarchy\b|\bobject model\b/,
    task: /\bdesign the (?:objects|classes)\b|\b(?:the )?(?:objects|classes) for\b|\bclasses and objects\b|\bobject[- ]oriented design\b|\binheritance (?:hierarchy|tree)\b/,
  },
  {
    view: 'chart',
    chartIntent: 'forecast',
    noun: /\b(?:forecast|projection)s?\b|\bproject(?:ed|ing)? (?:revenue|growth|sales|users|cost|costs|usage)\b/,
    // A rate of growth, stated: "at 5% monthly growth", "growing by 3% a month".
    task: /\b\d+(?:\.\d+)?\s?(?:%|percent)[^.?!,]{0,24}\bgrowth\b|\bgrow(?:s|ing)? (?:at|by) \d+(?:\.\d+)?\s?(?:%|percent)|\bgrowth\b[^.?!,]{0,30}\b\d+(?:\.\d+)?\s?(?:%|percent)/,
  },
  // (Said as a kind of chart, it can only be the picture.)
  { view: 'chart', chartIntent: 'breakeven', unamb: true, noun: /\bbreak[- ]?even (?:chart|graph|plot|diagram|curve)\b/ },
  {
    view: 'chart',
    chartIntent: 'breakeven',
    noun: /\bbreak[- ]?even\b|\bpay ?back (?:period|time)\b/,
    task: /\bwhen (?:do|does|will|would) (?:we|they|it|this|you) break[- ]?even\b|\b(?:give me|show me|work out|calculate|run) the break[- ]?even\b|\bat what (?:volume|point|price|usage|level|scale|size|quantity|headcount|number of [\w-]+) (?:does|do|will|would|can|could|should)\b[^.?!]{0,60}\b(?:pays? for itself|breaks? even|beats?|becomes? cheaper|is cheaper|gets cheaper|overtakes?)\b|\bexpected savings\b|\bcumulative (?:savings|costs?)\b|\bwhen (?:does|do|will|would) (?:it|this|that|we|they) pay (?:for itself|back|off)\b|\b(?:roi|return on investment)\b[^.?!]{0,30}\b(?:look like|over (?:the next )?(?:\w+ )?(?:months?|quarters?|years?))\b|\b(?:at what point|when) (?:do|does|will|would) [\w ,'$-]{1,50}? break[- ]?even\b/,
  },
  {
    view: 'chart',
    chartIntent: 'funnel',
    noun: /\bfunnel\b/,
    task: /\bwhere are (?:the )?(?:deals|leads|candidates|users|customers|applicants) dropping\b|\bwhere (?:the )?(?:deals|leads|candidates|users|customers|applicants) are (?:dropping|falling) (?:off|out)\b|\bwhere do (?:the )?(?:deals|leads|candidates|users|customers|applicants) (?:drop|fall) (?:off|out)\b|\bdrop(?:ping)?[- ]?(?:off|out) (?:by|per|at each|at every) stage\b|\bconversion (?:by|per|at each|between) stages?\b|\bmap the (?:recruiting|hiring|sales|deal) pipeline\b|\b(?:recruiting|hiring|sales|deal) pipeline (?:by stage|stages|conversion)\b|\bstage (?:counts|conversion)\b|\bconversion\b[^.?!]{0,30}\b(?:at|by|per|between|for) (?:each|every) stage\b|\beach stage of the (?:funnel|pipeline)\b|\bwhich stage\b[^.?!]{0,40}\b(?:losing|loses|drops?|leaks?|leaking)\b|\bwhere (?:in|along) the [\w -]{0,24}(?:pipeline|funnel|process) (?:are|do) we (?:losing|lose|dropping|drop)\b|\bwhere (?:in|along) the [\w -]{0,24}(?:pipeline|funnel) (?:are|do) (?:the )?(?:deals|leads|candidates|users|customers|applicants|people) (?:dropping|drop|falling|fall|leaking|leak)\b|\bwhere (?:are|do) we (?:losing|lose|dropping|drop)\b[^.?!]{0,40}\bin the (?:funnel|pipeline)\b|\bwhere does the (?:funnel|pipeline) (?:leak|drop|lose|narrow)\b/,
  },
  { view: 'chart', chartIntent: 'quadrant', unamb: true, noun: /\bquadrant (?:chart|diagram|view)?\b|\b2x2\b|\beffort (?:vs\.?|versus) impact\b|\bimpact (?:vs\.?|versus) effort\b/ },
  { view: 'chart', chartIntent: 'function', unamb: true, noun: /\b(?:plot|graph) (?:(?:this|the|that|a) (?:equation|function|curve|parabola)\b|y ?=|y equals\b|f ?\( ?x ?\)|f of x\b|(?:sin|cos|tan|log|ln|exp|sqrt) ?\(|(?:the )?(?:sine|cosine|tangent) of\b|x (?:squared|cubed)\b)|\bgraph of (?:the )?(?:function|equation)\b/ },
  {
    view: 'chart',
    chartIntent: 'breakdown',
    unamb: true,
    noun: /\bpie chart\b|\bwaterfall chart\b/,
    task: /\bbudget (?:is |was |gets )?split\b|\bhow (?:is|was) (?:the|our|this) (?:budget|spend|cost|bill) (?:split|broken down|divided)\b|\b(?:cost|bill|spend|usage) breakdown\b|\bexplain the bill\b|\bbill or usage change\b|\bwhy (?:did|is|was) (?:my|the|this) bill\b/,
  },
  {
    view: 'chart',
    chartIntent: 'trend',
    unamb: true,
    noun: /\b(?:line|bar|area|scatter) (?:chart|graph|plot)\b|(?<!\bplots? an? )(?<!\bplotting an? )\bhistograms?\b|\bburn ?down chart\b|\bpareto chart\b|\bheat ?map\b|\bcohort (?:matrix|chart|table)\b/,
    task: /\bhow (?:has |did |have )?(?:this|that|the|these|our) (?:[\w-]+ ){0,2}(?:metrics?|numbers?|figures?|revenue|usage|traffic|volume|rate|rates|costs?|churn|retention|adoption|conversion|sign-?ups?|tickets?|latency|errors?|sales|headcount|scores?|nps|csat|prices?|spend|budget|performance|backlog|velocity|coverage|times?) (?:changed|trended|moved|grown)\b|\b(?:metric|metrics|numbers|figures) (?:changed|over time)\b|\btrends?\b[^.?!]{0,40}\bover (?:time|the (?:last|past))\b|\b(?:repeat issues|service[- ]level) trends?\b|\b(?:adoption|retention) patterns?\b|\bsprint (?:or incident )?metrics\b/,
  },
  {
    view: 'chart',
    chartIntent: 'comparison',
    task: /\bcompare (?:the |these |our |both )?(?:scenarios|(?:resource|capacity)(?: (?:or|and) (?:resource|capacity))? plans?|numbers|figures|results)\b|\bcompensation\b[^.?!]{0,30}\bcompare\b/,
  },
  // The diagrams that have "chart" or "graph" in their own name come first,
  // or "draw a Gantt chart" and "draw an org chart" would be numeric charts.
  {
    view: 'gantt',
    unamb: true,
    noun: /\bgantt\b/,
    task: /\bplan (?:the |my |our |a )?(?:interview prep(?:aration)?|remaining interviews?|remaining interview schedule|rollout|implementation|release|study|replication|sprint|onboarding)\b|\bimplementation and rollout\b|\bremaining interview schedule\b|\bstudy phases\b|\b(?:turn|convert) (?:the |these |our )?action items into a plan\b|\brollout (?:plan|sequence|order)\b|\brelease (?:plan|schedule)\b|\bproject schedule\b/,
  },
  {
    view: 'responsibility',
    unamb: true,
    noun: /\borg(?:ani[sz]ation(?:al)?)? chart\b|\bstakeholder map\b|\braci\b/,
    // Who does WHICH, across several people — not "who signs off on the budget?", which wants a name.
    task: /\bwho owns what\b|\bwho (?:handles|interviews|approves|owns|covers) which\b|\bwho(?:'s| is) involved in (?:buying|the (?:decision|deal|purchase))\b|\bmap who\b|\bbuying (?:committee|group)\b|\bescalation (?:path|chain|route|ownership)\b/,
  },
  {
    view: 'dependency',
    unamb: true,
    noun: /\bdependency (?:graph|map|diagram)\b|\bargument map\b/,
    task: /\bwhich \w+(?: \w+)? (?:blocks?|depends? on|waits? on|needs?) which\b|\bwhat(?:'s| is) block(?:ing|ed) what\b|\bwho depends on whom\b|\bclaim and (?:its |the )?(?:supporting )?evidence\b|\bdecisions and alternatives\b|\b(?:show|map|draw|break down|lay out|give me|give us) (?:the |our |all )?(?:dependencies|prerequisites)\b|^what (?:depends|is waiting|hinges) on\b|\bcritical path\b|\bgiven the dependencies\b|\border\b[^.?!]{0,40}\bdependenc(?:y|ies)\b|\bdependency order\b|^which (?:of the )?[\w -]{1,30}? (?:are|is) (?:blocked by|blocking)\b/,
  },
  // "graph" alone is a data structure in an interview ("find the shortest path
  // in a weighted graph"), "plots" is a verb in a coding question, and a flow
  // chart, a state chart or a graph of services is not a chart of numbers.
  {
    view: 'chart',
    chartIntent: 'generic',
    generic: true,
    unamb: true,
    noun: /(?<!\b(?:flow|gantt|org|organi[sz]ation|organi[sz]ational|state|sequence|control|pie|bar|line|area|scatter|burn ?down|pareto|waterfall|quadrant) )\b(?:chart|plot)\b(?! (?:of accounts|(?:a|the|our|your|my) (?:path|course|way)\b|twist\b))|(?<!\b(?:flow|gantt|org|state) )\bcharts\b|\bgraphs? (?:of|showing|comparing|that shows?)\b(?! (?:the |our |all )?(?:services|systems?|components|modules|dependencies|calls|classes|tables|entities|nodes|relationships))/,
  },
  // "A timeline OF the events" is a picture; "a timeline FOR delivery" is a date.
  // …and so is one for a span of time ("timeline for the launch from March through August").
  { view: 'timeline', unamb: true, noun: /\btimeline of\b|\b(?:on|as|in|into) a timeline\b|\btimeline for\b(?=[^.?!]*\b(?:from\b[^.?!]*\b(?:to|through|until|till)\b|between\b[^.?!]*\band\b))/ },
  {
    view: 'timeline',
    noun: /\btimeline\b|\bchronolog(?:y|ical)\b/,
    task: /\bcareer progression\b|\b(?:important|key|major|release|project) milestones\b|\bwhat are the milestones\b|\bmilestones (?:between|from|until|before|up to)\b|\bsequence of events\b|\bcareer (?:history|path)\b/,
  },
  {
    view: 'mindmap',
    unamb: true,
    noun: /\bmind[- ]?map\b|\bconcept (?:map|graph)\b/,
    task: /\borgani[sz]e (?:the |these |my |our )?(?:ideas|concepts|topics|thoughts|notes)\b|\bconceptual framework\b|\bhow (?:do )?(?:these|the) (?:ideas|concepts|topics) (?:relate|fit together)\b/,
  },
  {
    view: 'decision',
    unamb: true,
    // Not the machine-learning kind.
    noun: /\bdecision tree\b(?! (?:classifier|regressor|model|algorithm|learning|ensemble)s?\b)/,
    task: /\bwalk me through (?:diagnosing|troubleshooting)\b|\btroubleshoot(?:ing)? (?:steps|flow|path|this|the)\b|\bdiagnos(?:e|ing) (?:this|the|that) (?:issue|problem|fault|error)\b|\b(?:refund|eligibility|return|warranty|cancellation) (?:path|policy path|flow|decision)\b|\b(?:navigate|handle) (?:this|the|that) objection\b|\bwhat happens if (?:this|the|that) decision changes\b|\bmap the troubleshooting\b|\bhow do (?:i|we) (?:diagnose|troubleshoot)\b|\bhow do (?:i|we) decide (?:whether|between|if|when|which)\b|\bwhat should (?:i|we) check first\b/,
  },
  {
    view: 'matrix',
    unamb: true,
    noun: /\b(?:evidence|coverage|comparison|skills?|requirements?|traceability|prioriti[sz]ation|allocation|owner) (?:matrix|table|grid)\b|\b(?:in|as|into|to) an? (?:\w+ )?table\b|\btables? (?:of(?! contents\b)|comparing|that compares?)\b|\bmatrix of\b|\bside[- ]by[- ]side (?:comparison|table|view)\b/,
    // A comparison ASKED OF someone ("compare A, B and C on price and range")
    // is a task: where the mode makes a table relevant it gets one, and in a
    // lecture it is the lecturer's prompt, not a request for a drawing.
    soft: /^compare [\w ,'’&-]{2,80}? (?:on|across|by|in terms of)\b|^compare [\w'’&-]+ (?:against|with|to) [\w ,'’&-]{2,60}? (?:on|across|by)\b/,
    task: /\btabulate\b|\bcompare (?:them|these|those|the two|both) side[- ]by[- ]side\b|\bmap (?:my|this|the|their|her|his) (?:candidate'?s? )?(?:experience|skills|background|resume|résumé) to\b|\bwhich requirements (?:still )?need (?:\w+[- ]?\w* )?evidence\b|\bcompare (?:these|the|both|two|three|my|our) (?:\w+ )?(?:options|offers|baselines|methods|approaches|vendors|plans)\b|\bskill[- ]to[- ]requirement\b|\bcompare the baselines\b|\bcompare effort and impact\b|\bcompare (?:the )?(?:scaling )?(?:costs?|complexity|trade-?offs)\b|^how (?:do|does) [\w ,'’&-]{2,70}? compare (?:with|to|against|on|across|over|in terms of)\b|^how (?:do|does) [\w ,'’&-]{2,70}? (?:differ|stack up)\b|\bstack up against\b/,
  },
  // Swimlanes and trees are flowcharts laid out a particular way (`layoutOf`).
  // Neither name is unambiguous ("each team has its own swim lane at the
  // pool", "store the categories as a tree"), so each is drawn only when a
  // verb that shows or draws governs it — never from a statement, never from
  // "build … as a tree", and never in a coding question.
  // (Said with what it is of, or as a kind of diagram, the name can only mean
  // the picture: "a swimlane of who does what", "a swimlane diagram".)
  { view: 'flowchart', unamb: true, noun: /\bswim ?lanes? (?:diagram|chart|view|map|flow ?chart)\b|\bswim ?lanes? (?:of|for|showing)\b(?! the (?:pool|kids|team|club)\b)|\bcross[- ]functional (?:flow ?chart|diagram|process map)\b/ },
  { view: 'flowchart', noun: /\bswim ?lanes?\b(?! (?:at|in|of) the pool\b)/ },
  {
    view: 'flowchart',
    noun: /\b(?:as|in|into) a tree\b|\btree (?:diagram|chart|view)\b|\bhierarchy (?:diagram|chart|tree)\b|\b(?:the|a|an|our|their|this|that) (?:[\w-]+ )?hierarchy\b(?! of needs\b)/,
  },
  {
    view: 'flowchart',
    soft: /^(?:outline|list|summari[sz]e|give (?:me|us)) the (?:steps|stages|phases) (?:from|to|for|in|of)\b|^map (?:out )?the [\w -]{2,30}? (?:process|journey|workflow)\b|^break (?:it|this|that|the [\w -]{2,30}?) (?:down )?into (?:phases|stages|steps|milestones)\b/,
    task: /\b(?:current|proposed|existing|new) workflow\b|\bhow (?:a|an|the|this) [\w -]{1,30} gets? approved\b|\b(?:application|interview|approval|onboarding) (?:stages|steps|process)\b|\bfollow[- ]up steps\b|\bresolution journey\b|\boffer[- ]to[- ]onboarding\b|\bmethod (?:described|used|proposed) in\b|\bexperimental (?:protocol|sequence|procedure)\b|\bstructure (?:that|my|the|this) behavio(?:u)?ral answer\b|\brecruiting process\b|\bhow (?:this|the|that) process works\b|\bresearch (?:workflow|method|pipeline)\b|\b(?:walk (?:me |us )?through|talk (?:me |us )?through|take (?:me |us )through|go through|run through|what are|show me|lay out|map out|map|break down) the (?:steps|stages|phases) (?:from|to|for|in|of)\b|\b(?:walk|take|talk) me through the (?:[\w-]+ ){0,2}(?:steps|stages|phases) (?:from|to|for|in|of|an?|the|that|we|you)\b|\bwhat(?:'s| is) the (?:process|procedure) (?:if|when|for|to)\b|\bwhat are the (?:stages|steps|phases) (?:of|a|an|the|we|that)\b|\bwhat(?:'s| is) the sequence of steps\b|\bwhat does the [\w -]{2,40}? look like\b[^.?!]{0,40}\bstep by step\b/,
  },
  { view: 'state', task: /\bwhere (?:this|the|that) (?:case|ticket|order|request) stands\b|\bticket (?:state|status)es?\b|\bcase status\b|\b(?:order|ticket|case|application|account) life ?cycle\b/ },
  // Not a "design a …" question, but still a picture of how parts connect.
  {
    view: 'architecture',
    task: /\bdeployment and data (?:movement|flow)\b|\bhow (?:the|our|this|their) (?:product|system|service|platform|app) integrates with\b|\bintegrat(?:es|ion) with (?:their|our|your|the) (?:systems?|stack|tools)\b|\bdata (?:movement|flow) between\b/,
  },
]);

// A word from the catalog that names a SYSTEM, not a picture: "a stock chart
// service", "an event timeline API", "Twitter's home timeline", "a class
// diagram editor". Found by running the original system-design questions
// against a real model after the catalog landed: "Design Twitter's home
// timeline" came back as a Mermaid timeline.
const SYSTEM_AFTER_NOUN_RE =
  /^\s+(?:(?!(?:of|for|in|on|with|to|from|by|at|about|and|or|the|a|an)\b)\w+\s+)?(?:services?|systems?|apis?|editors?|tools?|engines?|platforms?|pipelines?|backends?|databases?|db|stores?|apps?|applications?|calculators?|trackers?|tracking|librar(?:y|ies)|sdks?|renderers?|generators?|builders?|servers?|micro-?services?|feeds?|caches?|dashboards?)\b/;
const PRODUCT_TIMELINE_RE =
  /\b(?:home|news|activity|social|user|users'|feed|tweet|post|event|audit)s? timelines?\b|\b(?:twitter|x\.com|instagram|facebook|tiktok|threads|mastodon|linkedin|bluesky|reddit)(?:'s)? (?:\w+ )?timelines?\b/;
// Drawing words that are not also what one does to a system ("build", "model",
// "structure", "plan" and "create" are all things one does to a service).
const DRAWING_VERB_RE = /\b(?:draw|sketch|visuali[sz]e|illustrate|plot|chart|graph|diagram|whiteboard|redraw)\b|\b(?:show|give|make|add|include|render|present)\b[^.?!]{0,30}\b(?:diagram|chart|graph|plot|timeline|table|matrix|mind ?map|tree)\b|\bas an? \w/;
// In a design ask, the one catalog thing that IS the object being designed.
const DESIGNED_MODEL_RE = /\b(?:data|domain|entity|relational|database|db|object) (?:model|schema)\b(?!\s+(?:\w+\s+)?(?:services?|registry|migrations?|tools?|editors?|engines?))|\b(?:schema|tables|classes|objects) (?:for|of)\b/;
const LEGACY_TASK_VIEWS = new Set(['architecture', 'sequence', 'flowchart', 'state']);
// "Design a real-time analytics dashboard with charts": the classic phrasing,
// whatever the thing is called.
const DESIGN_IMPERATIVE_RE = /^\s*(?:(?:ok(?:ay)?|so|now|next|please|let'?s|can you|could you)[,\s]+)*(?:design|architect)\s+(?:an?|the|your|our)\s/;

function nameIsASystem(text, noun) {
  const m = noun.exec(text);
  if (!m) return false;
  // "graph the tool usage": the match is a verb and its article, not a name.
  if (/\b(?:the|this|these|those|that|our|my|it)$/.test(m[0])) return false;
  return SYSTEM_AFTER_NOUN_RE.test(text.slice(m.index + m[0].length));
}

/**
 * The first catalog visual a piece of text names or implies.
 * `nounText` is where a NAME may stand (for a request: the verb's object);
 * `taskText` is where a task phrase may stand (for a request: the whole
 * clause, verb included — "model users, orders and payments").
 */
/**
 * "A summary OF THE CHART", "a ticket ABOUT THE DIAGRAM", "a note on the
 * timeline": the visual is one that exists, named inside the phrase of the
 * thing that is asked for. Not "a diagram of the system" (the visual is the
 * head) and not "the numbers as a table" (what it is turned into).
 */
const REFERENCE_BEFORE_RE = /\b(?:an?|the|some|my|our|your|their) (?:[\w-]+ ){0,2}(?:summary|recap|overview|description|explanation|review|copy|screenshot|photo|picture|version|export|pdf|ticket|issue|task|note|comment|reminder|email|message|link|slide|page|section|title|caption|name|owner|author|draft|list|analysis|critique|walkthrough) (?:of|about|on|for|regarding|to|from) (?:the|this|that|our|my|your|their) (?:[\w-]+ ){0,2}$/;
function isReference(text, at) {
  return REFERENCE_BEFORE_RE.test(text.slice(0, at));
}

function detectIn(nounText, taskText, systemAsk) {
  const ledTask = stripLeadIn(taskText);
  // "Show the chart as a table", "put the forecast in a table": the chart word
  // names what is being shown, and what it is turned INTO is the visual asked
  // for. The chart match is kept only if no other kind of visual is the target.
  // (One chart as another — "the funnel as a bar chart" — stays the first.)
  let generic = null;
  for (const d of VISUAL_DETECTORS) {
    const nounMatch = d.noun ? d.noun.exec(nounText) : null;
    if (generic) {
      if (nounMatch && d.view !== 'chart' && (TARGET_HEAD_RE.test(nounMatch[0]) || TARGET_BEFORE_RE.test(nounText.slice(0, nounMatch.index))) && !nameIsASystem(nounText, d.noun)) {
        return { view: d.view, ...(d.chartIntent ? { chartIntent: d.chartIntent } : {}), named: true, implied: false, unamb: d.unamb === true, soft: false, taskAt: -1 };
      }
      continue;
    }
    let named = Boolean(nounMatch);
    if (named && nameIsASystem(nounText, d.noun)) named = false;
    if (named && isReference(nounText, nounMatch.index)) named = false;
    if (named && d.view === 'timeline' && PRODUCT_TIMELINE_RE.test(nounText)) named = false;
    let taskMatch = d.task ? d.task.exec(taskText) || (ledTask !== taskText ? d.task.exec(ledTask) : null) : null;
    // A soft task implies the visual and never counts as asking for it.
    const soft = !taskMatch && d.soft ? d.soft.exec(ledTask) : null;
    if (soft) taskMatch = soft;
    const implied = Boolean(taskMatch);
    if (!named && !implied) continue;
    if (systemAsk && !LEGACY_TASK_VIEWS.has(d.view) && !((d.view === 'er' || d.view === 'class') && DESIGNED_MODEL_RE.test(taskText))) continue;
    const found = {
      view: d.view,
      ...(d.chartIntent ? { chartIntent: d.chartIntent } : {}),
      named,
      implied,
      unamb: named && d.unamb === true,
      soft: Boolean(soft),
      taskAt: implied ? taskMatch.index : -1,
    };
    // (Held only when the chart word is not itself the target: "as a chart".)
    if (d.view === 'chart' && named && TARGET_ANYWHERE_RE.test(nounText)
      && !TARGET_HEAD_RE.test(nounMatch[0]) && !TARGET_BEFORE_RE.test(nounText.slice(0, nounMatch.index))) {
      generic = found;
      continue;
    }
    return found;
  }
  return generic;
}

// Where a visual stands as what something is turned into: "as a table",
// "into a timeline", "in a mind map".
const TARGET_HEAD_RE = /^(?:as|into|in|to|on) an? /;
const TARGET_BEFORE_RE = /\b(?:as|into|in|to) an? (?:[\w-]+ )?$/;
const TARGET_ANYWHERE_RE = /\b(?:as|into|in|to) an? [\w-]/;

// How a flowchart is laid out, when the request says: lanes per actor, or a tree.
const LANES_LAYOUT_RE = /\bswim ?lanes?\b|\bcross[- ]functional\b/;
const TREE_LAYOUT_RE = /\b(?:as|in|into) a tree\b|\btree (?:diagram|chart|view)\b|\bhierarch(?:y|ies|ical)\b/;
/** @returns {'lanes' | 'tree' | null} */
function layoutOf(q) {
  if (LANES_LAYOUT_RE.test(q)) return 'lanes';
  if (TREE_LAYOUT_RE.test(q) && !/\bdecision tree\b/.test(q)) return 'tree';
  return null;
}

/** The layout a question asked for, in English or one of the four other languages. */
function layoutAskedFor(question) {
  const text = String(question ?? '');
  if (!text) return null;
  const english = layoutOf(normalise(text));
  if (english) return english;
  const other = resolveOtherLanguageRequest({ question: text });
  return other && other.view === 'flowchart' && other.layout ? other.layout : null;
}

/**
 * What a sentence names or implies that this app can draw, beyond the four
 * system-design views. Says nothing about whether it was ASKED for.
 *
 * @returns {{ view: DiagramView, chartIntent?: string, named: boolean, implied: boolean, unamb: boolean } | null}
 *   `named`: the sentence names the visual (a noun). `implied`: a task phrase implies it.
 *   `unamb`: the name can only mean a picture.
 */
export function detectVisualTask(question) {
  const q = normalise(question);
  if (!q) return null;
  // A system-design ask designs a system. A catalog word inside it names the
  // system's domain ("a funnel tracking system", "a dashboard with charts")
  // unless the sentence also asks for the picture, or the thing designed is
  // itself a data or object model.
  const systemAsk = isSystemAsk(q) && !DRAWING_VERB_RE.test(q);
  const found = detectIn(q, q, systemAsk);
  if (!found) return null;
  const { taskAt: _taskAt, soft: _soft, ...task } = found;
  return task;
}

/**
 * How the sentence asks for a visual, if it does.
 *
 *  - `catalog`: a catalog visual a request verb governs (with the task found
 *    in THAT clause), or one asked for by name / as a fragment.
 *  - `diagram`: a drawing asked for without a catalog name ("draw the OAuth
 *    login flow", "I need a diagram", "explain it with a diagram").
 *  - `drawVerb`: the request used a verb that can only mean a picture — the
 *    one form a coding question may use to get one.
 */
function analyseRequest(q, { coding = false } = {}) {
  const systemAsk = isSystemAsk(q) && !DRAWING_VERB_RE.test(q);
  const out = { catalog: null, diagram: false, drawVerb: false, asQuestion: false };
  // "Plot the complexity in your head": nothing is to appear on a screen.
  if (/\bin (?:your|my|our) (?:head|mind)\b|\bmentally\b/.test(q)) return out;
  const idiom = DRAW_IDIOM_RE.test(q);
  // A visual named without a drawing verb counts only where something is being
  // asked for: inside a request, or in a question that asks to be shown.
  const showQuestion = SHOW_QUESTION_RE.test(q) && !PAST_RE.test(q) && !SECOND_PERSON_RE.test(q);
  // …or stands alone as the whole of what was said: "with a diagram please",
  // "as a flowchart", "in a table, please".
  const standsAlone = (at) => {
    const sentence = sentenceAt(q, at);
    return ONLY_LEADS_RE.test(q.slice(sentence.start, at));
  };
  const asked = (at) => inRequest(q, at) || showQuestion || standsAlone(at);

  for (const seg of requestSegments(q)) {
    // "Chart 3 shows revenue", "project timeline is at risk", "plot twist":
    // a noun at the head of the sentence, not a verb with an object.
    if (NOUN_VERB_RE.test(seg.verb) && HEAD_NOUN_NOT_VERB_RE.test(seg.object)) continue;
    let task = detectIn(seg.object, seg.clause, systemAsk);
    // The verb itself names the picture: "mind map this", "chart it", "can you
    // plot that?", "plot y = x^2", "graph revenue by quarter".
    if (!task && !coding) {
      const plots = /^(?:plot|chart|graph)$/.test(seg.verb);
      if (/^mind[- ]?map$/.test(seg.verb)) task = { view: 'mindmap', named: true, implied: false, unamb: true, taskAt: -1 };
      else if (/^(?:plot|graph)$/.test(seg.verb) && FUNCTION_OBJECT_RE.test(seg.object)) {
        task = { view: 'chart', chartIntent: 'function', named: true, implied: false, unamb: true, taskAt: -1 };
      } else if (plots && (OBJECT_START_RE.test(seg.object) || DATA_BY_RE.test(seg.object) || /^[a-z][\w-]*\s+\S+\s+\S/.test(seg.object)) && !CHART_OBJECT_IDIOM_RE.test(seg.object)) {
        task = { view: 'chart', chartIntent: 'generic', named: true, implied: false, unamb: true, taskAt: -1 };
      } else if (/^forecast$/.test(seg.verb) || (/^project$/.test(seg.verb) && /^(?:the |our |my )?(?:revenue|sales|growth|usage|users?|costs?|spend|mrr|arr|headcount|demand|churn|signups?)\b/.test(seg.object))) {
        if (OBJECT_START_RE.test(seg.object) || /^(?:revenue|sales|growth|usage|users?|costs?|spend|mrr|arr|headcount|demand|churn|signups?)\b/.test(seg.object)) {
          task = { view: 'chart', chartIntent: 'forecast', named: true, implied: false, unamb: true, taskAt: -1 };
        }
      }
    }
    // The task phrase starts at the verb or right after it: "model users …",
    // "map deployment and data movement" — not "summarise the release plan".
    const taskLeads = Boolean(task) && task.implied && !task.soft && task.taskAt <= seg.verb.length + 1;
    const verbNamesIt = Boolean(task) && task.taskAt === -1 && !task.implied;
    if (NOUN_VERB_RE.test(seg.verb) && !OBJECT_START_RE.test(seg.object) && !taskLeads && !verbNamesIt) continue;
    if (seg.kind === 'draw' && idiom) continue;
    // "Design a flowchart tool" names a product, not a picture.
    // "Summarise the diagram Ravi sent round", "compare the chart with last
    // week's": the verb works on a visual that exists (it is named with "the",
    // "that", somebody's). Nothing is asked to be drawn.
    const worksOnExisting = WORKS_ON_RE.test(seg.verb) && EXISTING_OBJECT_RE.test(seg.object);
    if (worksOnExisting && !/\b(?:as|into|in) an? /.test(seg.object)) continue;
    const diagramNoun = DIAGRAM_NOUN_RE.exec(seg.object);
    const hasDiagramNoun = Boolean(diagramNoun) && !nameIsASystem(seg.object, DIAGRAM_NOUN_RE) && !isReference(seg.object, diagramNoun.index);
    // Said to a person about that person ("illustrate how you handled
    // conflict on your team"): theirs to say, nothing to draw — unless the
    // thing named is their design.
    if (!task && !hasDiagramNoun && /\b(?:you|your|yours|yourself)\b/.test(seg.object) && !/\byour (?:architecture|design|system|solution|approach|data model|schema|pipeline|stack|setup|infrastructure)\b/.test(seg.object)) continue;

    if (task && !out.catalog) {
      // ("Give me the steps from A to B" asks for the steps: a visual where
      // the mode makes one relevant, never one that was asked for. "Map the
      // buying process" asks for the map.)
      const governs = task.soft && /^give\b/.test(seg.verb) ? false : seg.kind === 'draw' || seg.kind === 'show' ? true : task.unamb || taskLeads;
      // A coding question gets a picture only from a verb that can mean
      // nothing else, or from the two phrasings the keyword router misreads
      // as code: "model users, orders and payments", "design the objects for …".
      // The keyword router reads any "tree" as data structures: "show the org
      // structure as a tree" came back as a coding turn, and got no drawing.
      // Shown (not built, stored, printed or returned), and with nothing of
      // code in the words, a tree or a set of lanes is a picture.
      const shownLayout = seg.kind === 'show' && /^(?:show|display)\b/.test(seg.verb) && task.view === 'flowchart' && layoutOf(seg.object) !== null && !CODE_TREE_TALK_RE.test(q);
      const allowed = !coding || seg.kind === 'draw' || shownLayout || (taskLeads && (task.view === 'er' || task.view === 'class'));
      if (governs && allowed) {
        out.catalog = task;
        if (seg.kind === 'draw') out.drawVerb = true;
      }
    }
    if (seg.kind === 'draw') {
      // In a coding question "draw the output on the canvas" is the program's
      // job; a picture is asked for only when one is named.
      if (!coding || hasDiagramNoun || (task && task.named) || namesAView(seg.object)) {
        out.diagram = true;
        out.drawVerb = true;
      }
    } else if (hasDiagramNoun && !coding) {
      out.diagram = true;
    }
  }

  // By name: "…as a chart", "…with a diagram", "…in a table".
  const diagramByName = DIAGRAM_BY_NAME_RE.exec(q);
  const diagramNamed = Boolean(diagramByName) && asked(diagramByName.index);
  if (diagramNamed) out.diagram = true;
  // ("Turn this sorted array into a balanced tree", "put the results in a
  // table and return it": in a coding question those name data, not a picture.)
  const visualByName = coding ? null : VISUAL_BY_NAME_RE.exec(q);
  const visualNamed = Boolean(visualByName) && asked(visualByName.index);
  if (!out.catalog && (visualNamed || diagramNamed)) {
    const task = detectIn(q, q, systemAsk);
    if (task && (task.named || task.implied)) out.catalog = task;
    else if (visualNamed) out.diagram = true;
  }

  // "I need a diagram", "can I see a flowchart of the login process?", "how
  // about a diagram?", "a diagram would help here".
  const want = WANT_VISUAL_RE.exec(q);
  if (want && !coding) {
    const tail = WANTED_ELSEWHERE_RE.test(want[1] || '') ? '' : want[1] || want[2] || '';
    const head = tail.split(/\s+/).slice(0, 5).join(' ');
    // ("Give me a picture of what your day looks like": theirs to say.)
    const wanted = DIAGRAM_NOUN_RE.exec(head);
    if (((wanted && !isReference(head, wanted.index)) || /\b(?:drawing|sketch)\b/.test(head)) && !/\b(?:you|your)\b/.test(tail)) out.diagram = true;
    if (!out.catalog) {
      const task = detectIn(head, head, systemAsk);
      if (task && task.unamb) out.catalog = task;
    }
  }

  // A fragment: "DFA for strings ending in ab", "ER diagram for customers and
  // orders", "bar chart of signups by month, please", "timeline of the French
  // Revolution" — and the question form, "what is the ER diagram for a library
  // system?". Never a statement about one ("the class diagram is outdated",
  // "the DFA accepts strings ending in ab", "a decision tree for this would be
  // overkill").
  if (!out.catalog && !coding) {
    for (const d of VISUAL_DETECTORS) {
      if (!d.unamb || !d.noun) continue;
      const m = d.noun.exec(q);
      if (!m || nameIsASystem(q, d.noun)) continue;
      const head = q.slice(0, m.index);
      // "Gantt chart for the release": the kind word belongs to the name.
      const tail = q.slice(m.index + m[0].length).replace(/^\s+(?:chart|diagram|graph|map|plot|view)\b/, '');
      const nameTakesObject = /\b(?:of|for)$/.test(m[0]);
      const fragment = FRAGMENT_HEAD_RE.test(head) && (nameTakesObject ? /\w/.test(tail) : FRAGMENT_TAIL_RE.test(tail)) && !FINITE_VERB_RE.test(tail);
      // ("What's the plot of the movie?": the generic words are not asked for this way.)
      const question = d.chartIntent !== 'generic' && WHAT_IS_HEAD_RE.test(head) && /^\s+(?:for|of)\b|^\s+look like\b/.test(tail) && d.chartIntent !== 'generic';
      if (fragment || question) {
        out.asQuestion = question;
        out.catalog = { view: d.view, ...(d.chartIntent ? { chartIntent: d.chartIntent } : {}), named: true, implied: false, unamb: true, taskAt: -1 };
        break;
      }
    }
  }

  if (!coding) {
    const visually = VISUALLY_RE.exec(q);
    if (visually && asked(visually.index)) out.diagram = true;
    const fragment = DIAGRAM_FRAGMENT_RE.exec(q);
    if (fragment && !FINITE_VERB_RE.test(q.slice(fragment[0].length))) out.diagram = true;
    const asGraph = AS_A_GRAPH_RE.exec(q);
    if (!out.catalog && asGraph && asked(asGraph.index)) out.catalog = { view: 'chart', chartIntent: 'generic', named: true, implied: false, unamb: true, taskAt: -1 };
  }
  // Mermaid named as the format wanted — in a request, not in a recollection.
  MERMAID_REQUEST_RE.lastIndex = 0;
  for (let m = MERMAID_REQUEST_RE.exec(q); m; m = MERMAID_REQUEST_RE.exec(q)) {
    if (asked(m.index)) {
      out.diagram = true;
      break;
    }
  }
  return out;
}

/** "The architecture of …", "the state transitions of …": a view of a system, which only a picture is. */
function namesAView(object) {
  return VIEW_ARCHITECTURE_RE.test(object) || VIEW_STATE_RE.test(object) || VIEW_SEQUENCE_RE.test(object);
}
const WORKS_ON_RE = /^(?:summari[sz]e|compare|outline|present|organi[sz]e|structure)$/;
const EXISTING_OBJECT_RE = /^(?:me |us )?(?:the|that|this|those|these|his|her|their|your|[\w-]+'s) (?:[\w-]+ ){0,2}(?:diagrams?|charts?|graphs?|plots?|flow ?charts?|timelines?|tables?|drawings?|sketch(?:es)?|visuals?|mind ?maps?|schemas?)\b/;
// "We want a pie chart in the QBR deck": wanted somewhere else, not here.
const WANTED_ELSEWHERE_RE = /\b(?:in|into|for|on) (?:the|our|my|their|your|a|an) (?:[\w-]+ ){0,2}(?:deck|slides?|slide deck|report|docs?|documents?|presentation|proposal|appendix|emails?|paper|wiki|readme|handbook|newsletter|website|dashboard|pack|packet|memo|brief|binder|handout|one[- ]pager|write[- ]?up)\b/;
// Where "tree" is the data structure, not a way to lay something out.
const CODE_TREE_TALK_RE = /\b(?:binary|bst|avl|red[- ]black|b[- ]?tree|trie|heap|balanced|sorted|array|linked list|recursi(?:on|ve)|traversal|in[- ]?order|pre[- ]?order|post[- ]?order|inorder|preorder|postorder|leaf nodes?|root node|node values?|algorithm|function|method|implement\w*|return\w*|print\w*|parse\w*|json|xml|dom|ast|syntax|complexity|leetcode|directory|director(?:y|ies)|folders?|files?|code)\b/;
const ONLY_LEADS_RE = new RegExp(String.raw`^${LEAD_WORDS}$`);
// "Plot y = x^2", "graph sin(x)", "plot the function": a curve, computed.
const FUNCTION_OBJECT_RE = /^(?:me )?(?:(?:the|this|that|a) (?:function|equation|curve|parabola)\b|y\s*=|y equals\b|f\s*\(\s*x\s*\)|f of x\b|(?:sin|cos|tan|log|ln|exp|sqrt|abs)\s*\(|(?:the )?(?:sine|cosine|tangent|square root|log(?:arithm)?) of\b|x (?:squared|cubed)\b|\d*\s*x\s*[\^*+\-/]|e\s*\^)/;
// "Chart a path forward", "plot a course": not a chart.
const CHART_OBJECT_IDIOM_RE = /^(?:a|the|our|your|my) (?:path|course|way|route)\b|^(?:holes?|twists?|points?|lines?|armou?r)\b/;
// "Chart signups by month", "graph revenue against headcount": data and what it is set against.
const DATA_BY_RE = /^[a-z][\w -]{1,40}\s(?:by|per|against|versus|vs\.?|over|across|for each|for every)\s+\w/;
// The word after it shows it was a noun: "chart 3 shows", "project timeline is at risk", "plot twist".
const HEAD_NOUN_NOT_VERB_RE = /^\d+(?![\d.,]*\s?(?:%|percent|per cent|k\b|,\d))(?:\b|$)|^(?:[\w-]+ ){0,2}(?:shows?|is|are|was|were|has|have|had|looks?|says?|said)\b|^(?:twist|theory|paper|hole)s?\b/;

/** A system-design ask (see DESIGN_ASK_RE): the frame-anchored forms, or "…and design a …" inside a request. */
function isSystemAsk(q) {
  return DESIGN_ASK_RE.test(q) || DESIGN_IMPERATIVE_RE.test(q) || designAfterAnd(q);
}

const FRAGMENT_HEAD_RE = new RegExp(String.raw`^${LEAD_WORDS}(?:(?:an?|the|one) )?(?:(?:quick|simple|rough|small|basic) )?$`);
// Something has to follow the name: a lone "chart" or "gantt" out of
// speech-to-text asks for nothing.
const FRAGMENT_TAIL_RE = /^\s+(?:for|of|over|showing|comparing)\b|^\s*,?\s*(?:please|pls)\s*[.!?]?\s*$/;
const WHAT_IS_HEAD_RE = new RegExp(String.raw`^${LEAD_WORDS}(?:what(?: is|'s| would be| does)|whats) (?:the|an?) (?:\w+ )?$`);

const IMPERATIVE_LEAD_RE = new RegExp(
  String.raw`^${LEAD_WORDS}(?:${ASK_PREFIX})?(?:help|walk|talk|take me through|run through|go through|break|explain|describe|tell|compare|map|show|plan|organi[sz]e|summari[sz]e|troubleshoot|diagnose|navigate|handle|figure out|work out|break down|lay out|list|structure|turn|convert)\b`,
);

/** Is the sentence a question or a request (as opposed to a statement)? */
function isAsk(q) {
  return /\?\s*$/.test(q) || QUESTION_LEAD_RE.test(q) || IMPERATIVE_LEAD_RE.test(q) || requestSegments(q).length > 0;
}

/** @returns {DiagramView | null} */
export function detectDiagramView(question) {
  const q = normalise(question);
  // A notation or a chart named outright outranks the generic cues below
  // ("draw the ER model" is never an architecture view).
  const task = detectVisualTask(q);
  if (task && task.named) return task.view;
  // A view the sentence names in words ("as a flowchart", "the sequence")
  // outranks one a task phrase only implies.
  if (VIEW_STATE_RE.test(q)) return 'state';
  if (VIEW_SEQUENCE_RE.test(q)) return 'sequence';
  if (/\bflow ?chart\b|\barchitecture\b|\bblock diagram\b/.test(q)) return VIEW_FLOWCHART_RE.test(q) && /\bflow ?chart\b/.test(q) ? 'flowchart' : 'architecture';
  if (task) return task.view;
  if (VIEW_FLOWCHART_RE.test(q)) return 'flowchart';
  if (VIEW_ARCHITECTURE_RE.test(q)) return 'architecture';
  return null;
}

// ── modes ───────────────────────────────────────────────────────────────────
//
// A mode never forces a visual and never forbids one that was asked for. It
// decides one thing: whether a TASK that merely implies a visual ("where are
// deals dropping out?") gets one without being asked. The key is the built-in
// template identity from the mode policy registry — never a mode's display
// name, so a custom mode called "Sales" is not the Sales mode.

export const VISUAL_MODES = Object.freeze(['general', 'looking-for-work', 'technical-interview', 'sales', 'recruiting', 'team-meet', 'lecture', 'seminar', 'call-center']);

const ALL_CHARTS = ['chart'];
const MODE_RELEVANCE = Object.freeze({
  general: ['flowchart', 'decision', 'matrix', 'mindmap', 'timeline', 'gantt', 'dependency', 'responsibility', ...ALL_CHARTS],
  'looking-for-work': ['timeline', 'flowchart', 'matrix', 'gantt', 'state', ...ALL_CHARTS],
  // No charts unasked: "what about when the array grows by 50%?" is not a forecast.
  'technical-interview': ['er', 'class', 'chen', 'automaton', 'state', 'flowchart', 'matrix'],
  sales: ['flowchart', 'decision', 'responsibility', 'gantt', 'timeline', 'matrix', ...ALL_CHARTS],
  recruiting: ['matrix', 'timeline', 'flowchart', 'state', 'responsibility', 'gantt', ...ALL_CHARTS],
  'team-meet': ['dependency', 'gantt', 'flowchart', 'matrix', 'decision', 'er', 'class', 'timeline', 'responsibility', ...ALL_CHARTS],
  // Listening modes: a visual is drawn when asked for, and otherwise offered
  // through an action card. Nothing interrupts a lecture on its own.
  lecture: [],
  seminar: [],
  'call-center': ['decision', 'state', 'responsibility', 'flowchart', 'timeline', 'matrix', ...ALL_CHARTS],
});

/** Normalise a mode identity: one of the nine built-in templates, 'custom', or 'unknown'. */
export function normaliseVisualMode(mode) {
  if (mode === 'custom') return 'custom';
  return VISUAL_MODES.includes(mode) ? mode : 'unknown';
}

/** May this mode draw `view` for a task that implies it, without being asked? */
export function modeSuggestsVisual(mode, view) {
  const list = MODE_RELEVANCE[normaliseVisualMode(mode)];
  return Array.isArray(list) && list.includes(view);
}

// ── what a calculation needs ────────────────────────────────────────────────

const PERCENT_RE = /\d+(?:\.\d+)?\s?(?:%|percent)/;
const MONEY_OR_COUNT_RE = /(?:[$€£₹]\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|bn|million|thousand)?)|\b\d[\d,]*(?:\.\d+)?\s?(?:k|m|bn|million|thousand|dollars|usd|eur|users|customers|seats|units)\b/;
const HORIZON_RE = /\b(?:next|over|for|in|after) (?:the next )?(?:\d+|one|two|three|four|five|six|twelve|a) (?:day|week|month|quarter|year)s?\b|\b\d+ (?:day|week|month|quarter|year)s?\b/;
const PERIOD_RE = /\b(?:daily|weekly|monthly|quarterly|annual(?:ly)?|yearly|per (?:day|week|month|quarter|year)|a (?:day|week|month|quarter|year)|month[- ]over[- ]month|year[- ]over[- ]year)\b/;

// Speech-to-text often spells a number out: "ten thousand dollars a month".
const NUMBER_WORD = '(?:a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|half)';
// (A bounded run: "a a a a …" made an unbounded one scan to the end from
// every word — quadratic on a long transcript.)
const SPOKEN_AMOUNT_RE = new RegExp(`\\b${NUMBER_WORD}(?:[- ]${NUMBER_WORD}){0,5}[- ](?:and a half )?(?:hundred|thousand|million|billion|grand|k)\\b`);
const SPOKEN_PERCENT_RE = new RegExp(`\\b${NUMBER_WORD}(?:[- ]${NUMBER_WORD}){0,5} (?:percent|per cent)\\b`);
// A bare quantity: three or more digits, not a year, not a percentage.
const BARE_AMOUNT_RE = /\b(?!(?:19|20)\d{2}\b)\d{1,3}(?:,\d{3})+(?:\.\d+)?\b(?!\s?(?:%|percent))|\b(?!(?:19|20)\d{2}\b)\d{3,}(?:\.\d+)?\b(?!\s?(?:%|percent))/;

const statesAmount = (text) => MONEY_OR_COUNT_RE.test(text) || SPOKEN_AMOUNT_RE.test(text) || BARE_AMOUNT_RE.test(text);
const statesRate = (text) => PERCENT_RE.test(text) || SPOKEN_PERCENT_RE.test(text);

/** The one missing input a model is told about, as a bounded value. */
export const MISSING_INPUTS = Object.freeze(['baseline', 'rate', 'period', 'amounts']);
// "40 people", "1,200 seats": a count of things, which a projection can start from.
const COUNTED_THINGS_RE = /\b\d[\d,]*(?:\.\d+)? (?!percent\b|per cent\b|days?\b|weeks?\b|months?\b|quarters?\b|years?\b|times\b|x\b)[a-z]{3,}/;

/**
 * For a calculation view: the inputs it needs and which of them the request
 * itself states. With `material` (what was said in the conversation so far, a
 * string, possibly empty) it also reports `missing`: inputs stated neither in
 * the request nor in the conversation. Without `material` nothing is known
 * about the conversation and `missing` is absent.
 *
 * It answers "was ANY such value stated", never "is this the right value": a
 * found number leaves the decision with the model, as before.
 */
export function visualInputStatus(question, chartIntent, material) {
  const q = normalise(question);
  const known = typeof material === 'string';
  const all = known ? `${q}\n${normalise(material, MAX_MATERIAL_CHARS)}` : q;
  if (chartIntent === 'forecast') {
    const inRequest = [];
    if (MONEY_OR_COUNT_RE.test(q) || SPOKEN_AMOUNT_RE.test(q) || COUNTED_THINGS_RE.test(q)) inRequest.push('baseline');
    if (statesRate(q)) inRequest.push('rate');
    if (PERIOD_RE.test(q)) inRequest.push('period');
    if (HORIZON_RE.test(q)) inRequest.push('horizon');
    const status = { needed: ['baseline', 'rate', 'period', 'horizon'], inRequest };
    if (known) {
      status.missing = [];
      if (!inRequest.includes('baseline') && !statesAmount(all)) status.missing.push('baseline');
      if (!statesRate(all)) status.missing.push('rate');
      if (!PERIOD_RE.test(all) && !HORIZON_RE.test(all)) status.missing.push('period');
    }
    return status;
  }
  if (chartIntent === 'breakeven') {
    const inRequest = [];
    if (MONEY_OR_COUNT_RE.test(q) || SPOKEN_AMOUNT_RE.test(q)) inRequest.push('cost');
    if (HORIZON_RE.test(q)) inRequest.push('horizon');
    const status = { needed: ['cost', 'saving per period', 'horizon'], inRequest };
    if (known) status.missing = inRequest.includes('cost') || statesAmount(all) ? [] : ['amounts'];
    return status;
  }
  if (chartIntent === 'funnel') return { needed: ['a count for every stage', 'one cohort'], inRequest: [] };
  return null;
}

// ── design asks ─────────────────────────────────────────────────────────────

// Used when no planner verdict is available, and to see the design half of a
// mixed design-plus-code ask. Deliberately needs a software object: "design a
// logo" and "the architecture of a flower" are not system design.
const SOFTWARE_OBJECT =
  '(?:systems?|services?|micro-?services?|platforms?|apis?|backends?|back[- ]ends?|pipelines?|architectures?|applications?|apps?|databases?|data ?stores?|caches?|queues?|brokers?|limiters?|shorteners?|feeds?|timelines?|schedulers?|crawlers?|gateways?|load balancers?|cdns?|clusters?|storage|infrastructure|search engine|autocomplete|typeahead|leaderboard|marketplace|checkout|payments?|wallet|booking|messenger|chat|notifications?|newsfeed|ride[- ]?sharing|file sharing|video streaming|key[- ]value store|pub[- ]?sub|event bus|workers?|parking lot|elevator|vending machine)';
// "Design Twitter", "design something like Uber": the classic interview phrasing
// names a product instead of a kind of system.
const KNOWN_PRODUCT =
  '(?:twitter|x\\.com|instagram|facebook|whatsapp|messenger|telegram|signal|uber|lyft|doordash|netflix|youtube|spotify|tiktok|reddit|dropbox|google (?:docs|drive|maps|search|photos|calendar)|gmail|tinyurl|bitly|bit\\.ly|pastebin|slack|discord|zoom|airbnb|amazon|ebay|shopify|stripe|paypal|venmo|linkedin|pinterest|quora|yelp|ticketmaster|booking\\.com|github|twitch)';
const DESIGN_VERBS = '(?:design|architect|re-?design|re-?architect)';
// The software noun has to be the HEAD of what is designed. A people pipeline
// is not a data pipeline ("a sales pipeline", "a pipeline of candidates"); a
// checkout PAGE, a payment FORM, an app ICON and an elevator PITCH are things a
// designer makes, not systems; "the application for the grant" is a form.
const NOT_SOFTWARE_BEFORE = String.raw`(?<!\b(?:sales|talent|deal|hiring|recruiting|candidate|lead|content|leadership|product|marketing) )`;
const NOT_SOFTWARE_AFTER = String.raw`(?! of (?:candidates|leads|deals|talent|customers|people|applicants|prospects)\b)(?! (?:page|pages|form|forms|screen|screens|icon|icons|logo|button|buttons|banner|ui|ux|layout|mock-?ups?|wireframes?|email|emails|flyer|poster|pitch|deck|slides?|copy|template|theme|experience|journey|process|strategy|policy)\b)(?! (?:for|to) (?:the|a|an|my|our) (?:grant|job|role|position|visa|loan|program|school|college|scholarship)\b)`;
const SOFTWARE_HEAD = String.raw`${NOT_SOFTWARE_BEFORE}${SOFTWARE_OBJECT}\b${NOT_SOFTWARE_AFTER}`;
// The designed thing is the verb's own object: at most a few words away, in
// the same clause — not "why did you design the API that way" and not "scale
// the team that owns the payments service".
const NEAR = String.raw`(?:[\w'’&/+.-]+ ){0,6}`;
// An ASK to design, never a mention of design: "the system design round is
// tomorrow", "how do you prepare for system design interviews?" and "what is
// the overall architecture of the app?" ask for no design.
const DESIGN_ASK_RE = new RegExp(
  [
    String.raw`(?:${FRAME}|${LETS_FRAME})${DESIGN_VERBS}\s+(?:an?\s+|the\s+|our\s+|your own\s+)?(?:something like\s+|a clone of\s+|a version of\s+)?${KNOWN_PRODUCT}\b`,
    String.raw`(?:${FRAME}|${LETS_FRAME})${DESIGN_VERBS}\s+${NEAR}${SOFTWARE_HEAD}`,
    String.raw`\bhow (?:would|do|could|should|might) (?:you|we|i|one) (?:go about )?(?:design(?:ing)?|architect(?:ing)?)\s+(?:an?\s+|the\s+)?(?:something like\s+)?${KNOWN_PRODUCT}\b`,
    String.raw`\bhow (?:would|could|should|might) (?:you|we|i|one) (?:go about )?build(?:ing)?\s+(?:an?\s+|the\s+)?(?:something like\s+)?${KNOWN_PRODUCT}\b`,
    String.raw`\bhow (?:would|do|could|should|might) (?:you|we|i|one) (?:go about )?(?:design(?:ing)?|architect(?:ing)?)\s+${NEAR}${SOFTWARE_HEAD}`,
    // "Walk me through how you'd architect a ride-sharing backend."
    String.raw`\bhow (?:you|we)(?:'d| would) (?:design|architect|build)\s+${NEAR}${SOFTWARE_HEAD}`,
    // ("How do you build a talent pipeline?" asks about a habit, not for a design.)
    String.raw`\bhow (?:would|could|should|might) (?:you|we|i|one) (?:go about )?build(?:ing)?\s+${NEAR}${SOFTWARE_HEAD}`,
    String.raw`\bhow (?:would|could|should) (?:you|we) scale (?:this|that|it|the|our|a|an) (?:[\w-]+ ){0,2}${SOFTWARE_HEAD}`,
    String.raw`(?:^|[.;!?]\s+)system design(?: question| round| problem| exercise)?\s*[:–-]\s*\S`,
    String.raw`\b(?:do|give me|walk me through|let'?s do) (?:a|the) system design (?:for|of)\b`,
    String.raw`\b(?:give me|walk me through|what would be|propose|suggest|describe|show me|sketch|draw) (?:the |a |an )?(?:high[- ]level|overall) (?:design|architecture) (?:for|of)\b`,
    String.raw`(?:${FRAME}(?:give me|propose|suggest|describe) |\bwhat would be )(?:the |an? )?architecture for\s+${NEAR}${SOFTWARE_HEAD}`,
  ].join('|'),
);

// "Explain the tradeoffs and design a rate limiter": a design ask that follows
// "and" counts only in a sentence that is itself a request — never "I work in
// product and design systems for a living".
const DESIGN_AFTER_AND_RE = new RegExp(
  [
    String.raw`${AND_FRAME}${DESIGN_VERBS}\s+(?:an?\s+|the\s+|our\s+|your own\s+)?(?:something like\s+|a clone of\s+|a version of\s+)?${KNOWN_PRODUCT}\b`,
    String.raw`${AND_FRAME}${DESIGN_VERBS}\s+(?:an?|the|our|your own)\s+${NEAR}${SOFTWARE_HEAD}`,
  ].join('|'),
);
function designAfterAnd(q) {
  const m = DESIGN_AFTER_AND_RE.exec(q);
  return Boolean(m) && inRequest(q, m.index);
}
/** The words of a design ask, in either form. */
function saysDesign(q) {
  return DESIGN_ASK_RE.test(q) || designAfterAnd(q);
}

// Someone asking about the user's past, not asking for a design.
const EXPERIENCE_RE =
  /\b(?:have|had|did|do) you (?:ever |personally |actually )?(?:built|build|designed?|architected?|worked|work|used?|scaled?|run|led|owned?|shipped?)\b|\btell me about (?:a time|your|the time)\b|\b(?:your|any) (?:experience|background) (?:with|in|building|designing)\b|\bwhat(?:'s| is) your experience\b|\bhave you been\b/;

// A request for CODE. "Promo code", "the function of the queue", "loyalty
// program" and "in Swift City" are not.
const CODE_VERB_RE =
  /\b(?:implement(?:s|ed|ing)?\b|code (?:it|this|that|up)|write(?: me| us)?(?: the| a| an| some)? (?:code|function|class|method|handler|worker|script|program|implementation|module|service|endpoint|query|sql|ddl|migration)|(?:write|define|create|add) (?:me )?(?:a|an|the|this|that|some) (?:helper |utility )?(?:function|method)\b|unit tests?|test cases?|code snippet|snippet of code|pseudo-?code|in (?:python|java|javascript|typescript|go|golang|rust|c\+\+|c#|kotlin|swift|ruby|php|scala)(?=\s*(?:[.,;:!?]|$|and\b|with\b|using\b|please\b|code\b)))/;

const CODING_ANSWER_TYPES = new Set(['dsa_question_answer', 'coding_question_answer']);
// When the router has called a turn coding, "design X" is usually a thing to
// implement ("design an LRU cache", "design a rate limiter class with an allow
// method", "design a vending machine"). It is a system to draw only when it is
// a product everyone knows, is talked about at scale, or the sentence asks for
// the design AND the code ("design a payment API and show the handler").
const SYSTEM_SCALE_RE = /\b(?:distributed|scal(?:e|es|able|ability|ing)|at scale|million|billion|high[- ]availability|architecture|micro-?services?|multi[- ]region|qps|throughput|data ?cent(?:er|re)s?|sharding|replication)\b/;
const KNOWN_PRODUCT_RE = new RegExp(String.raw`\b${KNOWN_PRODUCT}\b`);
const DESIGN_AND_CODE_RE = /\b(?:and|then|plus|,)\s+(?:also )?(?:implement|code|write|show|give me)\b/;

function codingDesignIsASystem(q) {
  return KNOWN_PRODUCT_RE.test(q) || SYSTEM_SCALE_RE.test(q) || DESIGN_AND_CODE_RE.test(q);
}

function isDesignAsk(q, answerType, coding) {
  // "Given your experience with distributed systems, how would you design a
  // URL shortener?" asks for a design; "have you designed one?" does not.
  const asks = saysDesign(q);
  if (EXPERIENCE_RE.test(q) && !asks) return false;
  if (coding) return asks && codingDesignIsASystem(q);
  if (answerType === 'system_design_answer') return true;
  return asks;
}

// ── follow-ups on an existing design ────────────────────────────────────────
//
// A turn follows up on the artifact on the table only when it REFERS to it:
//   strong — it names the artifact ("the diagram", "the chart") or one of its
//            own components ("why do we need the queue?"). Good for as long as
//            the artifact is remembered.
//   weak   — a pronoun or a bare edit ("add a cache", "make it 3%", "why is
//            this better?"). Only while the artifact is what the conversation
//            is on (`foreground`), and only with something in the sentence
//            that could be about a design.
// An edit verb alone is nothing: "can you add me on LinkedIn?", "let's move
// on to pricing", "set up a meeting for Tuesday".

// How an edit is led into: "okay so", "can you", "let's", "I want to", "we
// should also", "I think we should", "what if we", "I'd". (First person is
// fine here: "I want to add a cache" is an edit, not a sentence about the
// speaker.)
//
// Stripped by a LOOP, one prefix at a time, never matched as one pattern: as a
// starred group these alternatives overlapped ("could you please" is one
// prefix or two; "we need to" is two different ones), and a run of them took
// time doubling with every repetition — seconds on a few hundred characters.
const LEAD_IN_STEPS = [
  new RegExp(String.raw`^${LEAD_TOKEN}[, ]+`),
  /^(?:can|could|would|will) (?:you|we) /,
  /^let'?s /,
  /^(?:i|we)(?:'d| would) like (?:you )?to /,
  /^(?:i|we) (?:want|need) (?:you )?to /,
  /^we (?:should|could|might|can|have to) /,
  /^i think (?:that )?/,
  /^(?:we|you) should /,
  /^what if (?:we|i|you) /,
  /^how about (?:we|i|you) /,
  // "I'd put a CDN in front of the app", "I would add a cache".
  /^(?:i|we)(?:'d| would) (?:probably |also |just |maybe )?(?=[a-z])/,
];
const LEAD_IN_MAX_STEPS = 10;

/** The sentence with its lead-in removed: "okay so can we just add a cache" → "add a cache". */
function stripLeadIn(q) {
  let rest = q;
  for (let step = 0; step < LEAD_IN_MAX_STEPS; step += 1) {
    let matched = false;
    for (const re of LEAD_IN_STEPS) {
      const m = re.exec(rest);
      if (m && m[0].length > 0) {
        rest = rest.slice(m[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) break;
  }
  return rest;
}
const UPDATE_RE = new RegExp(
  String.raw`^(?:add|remove|replace|swap|switch|change|use|introduce|insert|put|move|split|merge|drop|delete|make|include|handle|support|scale|shard|partition|replicate|extend|update|modify|rename|redo|redraw|rework|set|increase|decrease|raise|lower|bump|assume|try|mark|have(?! (?:a (?:look|nice|good|great|second|minute|moment|seat|break|word|chat|go)\b|fun\b|time\b|you\b|to\b))|get rid of|take out|cache|secure|encrypt|decouple|optimi[sz]e|simplify|expand|connect|link|wire|route|hook up|point|label|annotate|number|colou?r|highlight|group|align|break out|pull out|extract|separate|isolate|consolidate|combine|normali[sz]e|denormali[sz]e|lay (?:it|this|that) out|project (?:it|this|that)|shorten (?:it|this|that) to|run (?:it|this|that) out)\b(?! (?:of\b|on to|on\b|up a|up the|sure|me\b|us\b|yourself|your (?:voice|hand)|again\b))`,
);
// A verb done TO the artifact, with nothing but a pronoun for an object:
// "simplify it", "redraw that", "halve it", "clean it up". (Not "move it to
// Thursday", "try it again", "mark that as done": those verbs need a word a
// design is changed in.)
const ARTIFACT_VERB_RE = new RegExp(
  String.raw`^(?:(?:simplify|redraw|redo|rework|expand|extend|split|scale|shard|partition|replicate|decouple|harden|secure|optimi[sz]e|halve|double|triple|recompute|recalculate|rerun|flip|invert|annotate|label) (?:it|this|that|these|those)\b|(?:clean|tidy|split|scale|break|zoom) (?:it|this|that) (?:up|out|down|in)\b|(?:clean|tidy) up (?:it|this|that|the (?:diagram|design|chart|drawing))\b)`,
);
const UPDATE_PHRASE_RE =
  /\bgive (?!me\b|us\b|him\b|her\b|them\b|it a\b|you\b)(?:the |each |every )?[\w-]+(?: [\w-]+)? (?:a|an|its own|another|a second|two) (?:[\w-]+ ){0,3}(?:attribute|field|column|key|index|property|method|state|replica|cache|queue|label|relationship|timeout|retry|ttl|constraint)\b|\binstead of\b|\bwhat if (?:we|i|you) (?:add|use|remove|replace|put|had|switch)\b|\b(?:it|this|that|the (?:system|design|architecture)) (?:needs|should have|could use|is missing|lacks)\b|\b(?:i|we)(?: want| need| would like|'d like) (?:a|an|another|one more|a second|two|three|more) \w|\b(?:i|we)(?:'d| would) like to (?:see|have|add|put) (?:a|an|another|one more|a second)\b|\bshould (?:be|use|have|go|sit|talk|call|write|read)\b|\bneeds? to (?:be|use|have|go|talk|call)\b|\bmulti[- ]region\b|\bhow (?:does|would|will|do|can|could) we\b[^.?!]*\b(?:scale|handle|cope|support|survive|hold up)\b|\bwhat (?:about|if)\b[^.?!]{0,40}\d+(?:\.\d+)?\s?(?:%|percent)|\bwhat (?:about|if)\b[^.?!]{0,30}\b\d+ (?:day|week|month|quarter|year)s?\b/;
// "Assume revenue is $10,000 …", "a hypothetical example": the content is made
// up on request, and is drawn only when it is labelled as such.
const HYPOTHETICAL_RE =
  /\b(?:hypothetical(?:ly)?|for (?:example|instance)|as an example|an example of|illustrative|illustration|made[- ]up|sample (?:data|numbers)|dummy (?:data|numbers)|suppose|let'?s say)\b|\b(?:an? )?(?:example|sample|dummy|mock) (?:\w+ )?(?:chart|graph|plot|forecast|diagram|timeline|table)\b/;
// An instruction to reword the ANSWER, at the head of the sentence — not
// "shorter hours would be nice".
const REFINE_PROSE_RE = new RegExp(
  String.raw`^(?:(?:make|keep) (?:it|that|this|your answer|the answer|the explanation) (?:shorter|longer|simpler|clearer|briefer|tighter|more \w+|less \w+)|shorten(?: (?:it|that|this|your answer|the answer|the explanation))?\s*[.!]?$|(?:rephrase|reword|trim|tighten)(?: (?:it|that|this|your answer|the answer)(?: up| down)?)?\s*[.!?]?$|say (?:it|that) (?:differently|more \w+)|(?:shorter|more concise|briefer|simpler|in simpler words)(?:,? please)?\s*[.!]?$)`,
);
const QUESTION_LEAD_RE =
  /^(?:(?:ok(?:ay)?|now|and|but|so|wait)[, ]+)*(?:remind me )?(?:(?:why|what|when|where|which|who|how)(?:'?s)?|is|are|was|were|does (?:it|this|that|the|our|your|a|an)|do (?:we|you|they|i|these|those|the)|did|can|could|would|should|will|explain|tell me|walk me through|talk me through)\b/;
/** A pronoun that can stand for the artifact. */
const PRONOUN_RE = /\b(?:this|that|it|these|those)\b/;
const DEICTIC_RE = /\b(?:this|that|it|these|those|the (?:system|design|diagram|architecture|flow|picture|above)|our (?:design|system|architecture)|here)\b/;

// What the artifact is called, by what it is. "The table", "the plan" and "the
// model" mean the design only when the design is one.
// ("The figure for Q3", "the picture", "the system is down" and "the numbers"
// are everyday talk: they do not name the artifact.)
const DESIGN_NOUN_ALWAYS = '(?:design|diagram|drawing|visual)';
const DESIGN_NOUN_BY_VIEW = {
  architecture: '(?:architecture|flow ?chart)',
  sequence: '(?:sequence|flow)',
  flowchart: '(?:flow ?chart|flow|process)',
  state: '(?:state machine|states|lifecycle)',
  decision: '(?:tree|decision tree|flow ?chart)',
  er: '(?:schema|data model|er model|erd|model)',
  class: '(?:class diagram|classes|object model)',
  chen: '(?:er model|model)',
  automaton: '(?:automaton|dfa|nfa|machine)',
  mindmap: '(?:mind ?map|map)',
  timeline: '(?:timeline)',
  gantt: '(?:schedule|plan|gantt)',
  dependency: '(?:dependency (?:map|graph)|map|graph)',
  responsibility: '(?:map|chart)',
  matrix: '(?:table|matrix|comparison)',
  chart: '(?:chart|graph|plot|forecast|projection|curve)',
};
function namesTheDesign(q, view, vocab) {
  const specific = DESIGN_NOUN_BY_VIEW[view] || DESIGN_NOUN_BY_VIEW.architecture;
  // "The diagram", "this design", "the architecture diagram", "that system
  // diagram we drew", "earlier diagram": a determiner (or "earlier/previous"),
  // at most one word between, then what the artifact is called.
  // (Not where the word only says what KIND of meeting or document it is:
  // "the design review", "the architecture team", "the chart room".)
  const re = new RegExp(String.raw`\b(?:the|this|that|our|earlier|previous|last|same|current) (?:(?!${DESIGN_NOUN_ALWAYS}\b)[\w-]+ )?(?:${DESIGN_NOUN_ALWAYS}|${specific})\b(?! (?:reviews?|meetings?|team|teams|docs?|documents?|sprints?|sessions?|sync|workshops?|interviews?|rounds?|phases?|freeze|principles|guidelines|committee|board|office|room|tool|tools|software|agency|budget|deadline)\b)`, 'g');
  for (let m = re.exec(q); m; m = re.exec(q)) {
    // "The forecast for tomorrow's weather", "the chart of accounts", "the
    // plan for Friday": something else of that name.
    if (!ofSomethingElse(q.slice(m.index + m[0].length), vocab)) return true;
  }
  return false;
}

// Words that say a noun phrase is part of a design or a chart, whatever the
// artifact's own vocabulary is.
const DESIGNISH_NOUN_RE =
  /\b(?:participants?|actors?|lifelines?|schemas?|data models?|models?|erds?|sections?|milestones?|phases?|services?|servers?|layers?|tiers?|components?|nodes?|steps?|stages?|states?|transitions?|tables?|class(?:es)?|entit(?:y|ies)|columns?|fields?|attributes?|relationships?|box(?:es)?|arrows?|edges?|branch(?:es)?|lanes?|lines?|bars?|series|axis|axes|titles?|labels?|legends?|systems?|designs?|diagrams?|architectures?|charts?|graphs?|flows?|paths?|views?|regions?|zones?|clusters?|instances?|endpoints?|routes?|pipelines?|databases?|stores?|clients?|apps?|users?|requests?|responses?|messages?|events?|topics?|keys?|ind(?:ex|ices)|scenarios?|assumptions?|periods?)\b/;

function designish(phrase, vocab) {
  if (DESIGNISH_NOUN_RE.test(phrase) || DESIGN_TERM_RE.test(phrase) || CHART_TERM_RE.test(phrase) || MODEL_TERM_RE.test(phrase)) return true;
  if (!vocab) return false;
  for (const word of phrase.split(/[^a-z0-9]+/)) {
    if (word.length >= 3 && (vocab.has(word) || vocab.has(`${word}s`) || (word.endsWith('s') && vocab.has(word.slice(0, -1))))) return true;
  }
  return false;
}

/**
 * The same question asked of the HEAD of a noun phrase — its last word, or its
 * last two. "The patient advisory panel invite" is an invite, whatever word of
 * the diagram stands in front of it; "the owner table" is a table.
 */
function headIsDesignish(phrase, vocab) {
  // ("The reminder queue too", "the cache again": the adverb is not the head.)
  // (So is what the thing is MADE: "make the queue durable", "make the
  // baseline fifty thousand", "the hold music louder" — and the stand-in "one"
  // of "next to the email one".)
  const words = phrase.trim().replace(new RegExp(String.raw`(?: (?:too|also|again|instead|please|here|there|now|first|next|as well|side|only|just|alone|entirely|completely|altogether|ones?|earlier|later|sooner|back|forward|(?:an? |one |two |three |four |five |six |seven |eight |nine |ten |twelve |\d+ )(?:days?|weeks?|fortnights?|months?|quarters?|years?|sprints?)|[a-z]{3,}ly|\d[\w.,%]*|${COMPLEMENT_WORD}))+$`), '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  // "The hold music" is music and "the email thread" is a thread, whatever
  // word of the diagram stands in front; "the owner table" is a table.
  if (designish(words[words.length - 1], vocab)) return true;
  // A term of the trade that is more than one word and ends the phrase: "a
  // rate limiter", "a starting point". (Not one that only starts it — "the
  // gateway invoice" is an invoice — and not the diagram's own words: those
  // count only as the head.)
  return words.length > 1 && endsWithTerm(words.join(' '));
}

// What a thing is made, said after it: a property, a size, a colour, a spoken number.
const COMPLEMENT_WORD = '(?:durable|persistent|optional|mandatory|nullable|unique|synchronous|asynchronous|async|sync|stateless|idempotent|redundant|secure|bigger|smaller|larger|faster|slower|higher|lower|wider|longer|shorter|simpler|cheaper|louder|quieter|thicker|thinner|bold|dashed|dotted|solid|red|green|blue|grey|gray|orange|yellow|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|percent)';
let TERM_RES_G = null;
function endsWithTerm(phrase) {
  // (Built on first use: the term lists are declared further down.)
  if (!TERM_RES_G) TERM_RES_G = [DESIGNISH_NOUN_RE, DESIGN_TERM_RE, CHART_TERM_RE, MODEL_TERM_RE].map((re) => new RegExp(re.source, 'g'));
  for (const re of TERM_RES_G) {
    re.lastIndex = 0;
    for (let m = re.exec(phrase); m; m = re.exec(phrase)) {
      if (m[0].length > 0 && m.index + m[0].length === phrase.length && m[0].includes(' ')) return true;
      if (m[0].length === 0) re.lastIndex += 1;
    }
  }
  return false;
}


const NOUN_PHRASE_END_RE = /\b(?:by|to|for|from|in|on|at|with|of|into|onto|between|before|after|across|during|through|within|under|over|per|until|since|against|via|without|than|and|or|but|if|when|where|while|so|because|that|which|who|as)\b|[,.;:!?]/;

const QUANTITY_PHRASE_RE = /^(?:(?:another|an? (?:extra|further|additional)|the (?:next|last|first)|a|an) )?(?:\d[\d.,]*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen|twenty|twenty[- ]four|thirty|thirty[- ]six|half a|a|an) ?(?:more |extra |further )?(?:percent|per cent|%|days?|weeks?|fortnights?|months?|quarters?|years?|k\b|x\b|times)\b/;

/** Directly after a name: "for/of/about <something that is not part of the artifact>". */
function ofSomethingElse(after, vocab) {
  const m = /^\s+(?:for|of|about|on) (?:(?:our|the|my|their|your|his|her|this|that|a|an|next|another) )?([a-z0-9'’ -]{2,40})/.exec(after);
  if (!m) return false;
  const end = m[1].search(NOUN_PHRASE_END_RE);
  const phrase = (end === -1 ? m[1] : m[1].slice(0, end)).trim();
  if (!phrase || /^(?:this|that|it|these|those|here)\b/.test(phrase)) return false;
  return !designish(phrase, vocab);
}

/**
 * The thing an edit verb acts on is something else: "extend THE TRIAL by 14
 * days", "scale back YOUR HOURS", "use 2 MONITORS". Read from the noun phrase
 * that follows the verb; a pronoun or a bare name ("add auth", "add Redis") is
 * not something else.
 */
function editsSomethingElse(leadIn, vocab, labels = null) {
  // "I need a copy of the signed contract", "we'd like to add a seat": the
  // thing wanted stands where an object stands.
  const lead = leadIn.replace(/^(?:i|we)(?:'d| would)? (?:want|need|like)(?: to (?:see|have|add|put|get))? (?=(?:a|an|another|the|some|two|three|more)\b)/, 'add ');
  const m = /^(?:[a-z']+)(?: (?:back|up|down|out|in|off|over))?(?: (?:it|this|that) (?:to|into|with|by))? ((?:the|a|an|my|our|your|their|his|her|some|any|another|these|those|this|that|\d+|two|three|four|five) [a-z0-9'’ -]{2,60})/.exec(lead);
  if (!m) {
    // No determiner ("add Sarah to the panel invite", "move him to the other
    // team"): only the destination can say.
    const to = /^[a-z']+ [a-z0-9'’-]+ (?:to|into|onto) (?:the|this|that|our|my|their|your) ([a-z0-9'’ -]{2,40})/.exec(lead);
    if (!to) return false;
    const stop = to[1].search(NOUN_PHRASE_END_RE);
    return !headIsDesignish((stop === -1 ? to[1] : to[1].slice(0, stop)).trim(), vocab);
  }
  const [, phrase] = m;
  const words = phrase.split(' ');
  // "this"/"that" alone are pronouns: only a determiner when a noun follows.
  if (/^(?:this|that|these|those)$/.test(words[0]) && (words.length < 2 || NOUN_PHRASE_END_RE.test(` ${words[1]} `) || /^(?:up|out|down|in|off|over|back|again|a|now|please|here|there|too|more|less|left|right|one)$/.test(words[1]))) return false;
  // ("Some sort of queue", "a kind of cache": the thing is what follows.)
  const rest = words.slice(1).join(' ').replace(/^(?:sort|kind|type|form) of /, '');
  // A quantity ("8 percent", "two years", "3 months"), not a thing.
  if (/^(?:\d|two|three|four|five)/.test(words[0]) && /^(?:percent|per cent|%|months?|quarters?|years?|weeks?|k\b|x\b|times)/.test(rest)) return false;
  if (QUANTITY_PHRASE_RE.test(phrase)) return false;
  const end = rest.search(NOUN_PHRASE_END_RE);
  // ("Remove the kiosk we don't need it": the object ends where the next clause starts.)
  // ("Make the line start at 42,500": the object ends at the verb.)
  const head = (end === -1 ? rest : rest.slice(0, end)).replace(/ (?:we|i|you|they|he|she|it|start|begin|end|go|stop|grow|look)s?\b.*$/, '').trim();
  if (!head) return false;
  // "Add a phone number TO PATRON", "add a renewal count to loan": it goes
  // into one of the design's own things, named bare.
  // ("Add a Platform team UNDER ENGINEERING", "add a VP of Sales below
  // Finance": placed by one of them — how an org chart or a tree is edited.)
  for (const d of lead.matchAll(/\b(?:to|into|onto|under|underneath|below|beneath|above|beside|next to|reporting to)(?: the)? ([a-z0-9-]{3,})\b/g)) {
    if (vocab && (vocab.has(d[1]) || vocab.has(`${d[1]}s`) || (d[1].endsWith('s') && vocab.has(d[1].slice(0, -1))))) return false;
  }
  // "Make the Staff Move Weekend a milestone": the object holds one of the
  // design's own names.
  if (labels && namesLabel(head, labels)) return false;
  // "Add a fraud check BETWEEN TRIP SERVICE AND PAYMENT SERVICE": placed by
  // one of the design's own names. (Not "put the caller on hold", where the
  // name is no place.)
  if (labels) {
    for (const label of labels) {
      const at = lead.indexOf(` ${label}`);
      if (at > 0 && /\b(?:between|before|after|behind|in front of|next to|beside|alongside|under|underneath|below|beneath|above|over|reporting to|into|onto|to|from|for|in|on|and|with|at|of)(?: the)?$/.test(lead.slice(0, at))) return false;
    }
  }
  // Where it goes. "Add a step TO THE ONBOARDING CHECKLIST", "add Sarah to
  // the patient advisory panel INVITE": a destination that is not part of the
  // artifact makes the edit one of something else, whatever is being added.
  // "Add a phone number TO THE OWNER TABLE": a destination that is, makes it
  // an edit of the artifact, whatever is being added.
  let destination = null;
  for (const d of lead.matchAll(/\b(?:to|into|onto|from|off|out of) (?:the|this|that|our|my|their|your|every|each|all|both) ([a-z0-9'’ -]{2,40})/g)) {
    // ("To the left of the gateway", "from the top": a place in the drawing.)
    if (/^(?:left|right|top|bottom|front|back|end|start|side|middle|same|other side)\b/.test(d[1])) continue;
    const stop = d[1].search(NOUN_PHRASE_END_RE);
    destination = headIsDesignish((stop === -1 ? d[1] : d[1].slice(0, stop)).trim(), vocab);
    break;
  }
  if (destination !== null) return !destination;
  // "Put THAT IDEA in the bin", "put THE REPORT in the queue for review": what
  // is put is named as a thing that exists ("the", "that", "this") and holds no
  // word of the design — wherever it is put. ("Put a cache in the gateway" adds
  // a new part; "move the retry logic into the worker" holds a design word.)
  // (Only a verb that puts a thing somewhere. "Drop the direct link between
  // the gateway and payments" and "swap the order of the lock and the insert"
  // name what they change by where it is.)
  if (/^(?:put|place|stick|throw|chuck|park|file|leave|keep|pop|add|move)\b/.test(lead)
    && /^(?:the|that|this|these|those|my|our|your|their|his|her)$/.test(words[0]) && !designish(head, vocab)
    && /\b(?:in|into|on|onto|to) (?:the|a|an|our|my|this|that)\b/.test(lead)
    && !/\b(?:in front of|on top of|next to|to the (?:left|right))\b/.test(lead)) return true;
  // "A copy OF THE SIGNED CONTRACT", "the order OF THE LOCK AND THE INSERT":
  // what it is a part of decides.
  if (end !== -1) {
    const of = /^ ?of (?:(?:the|a|an|our|my|their|your|this|that) )?([a-z0-9'’ -]{2,40})/.exec(rest.slice(end));
    // ("A baseline OF 100K", "a rate of five percent": a quantity, not a thing.)
    if (of && !/^(?:[$€£₹]?\d|(?:about|around|roughly|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|a hundred|a thousand|half)\b)/.test(of[1])) {
      const stop = of[1].search(NOUN_PHRASE_END_RE);
      return !headIsDesignish((stop === -1 ? of[1] : of[1].slice(0, stop)).trim(), vocab);
    }
  }
  if (headIsDesignish(head, vocab)) return false;
  for (const d of lead.matchAll(/\b(?:in|on|of|between|before|after|behind|in front of|under|inside|over|above|below|beside|next to|near|around|across|through|via|within) (?:the|this|that|our|every|each|all|both) ([a-z0-9'’ -]{2,40})/g)) {
    const stop = d[1].search(NOUN_PHRASE_END_RE);
    if (designish((stop === -1 ? d[1] : d[1].slice(0, stop)).trim(), vocab)) return false;
  }
  return true;
}

/**
 * An edit whose destination is named and is not part of the artifact: "add a
 * step TO THE ONBOARDING CHECKLIST", "add Sarah TO THE PANEL INVITE". (The
 * narrower half of `editsSomethingElse`, for a sentence that does name one of
 * the artifact's parts: there, only where the edit GOES can say it is not one.)
 */
function editGoesElsewhere(lead, vocab) {
  const d = /^[a-z']+ [^.?!,;]{1,60}? (?:to|into|onto|from|off|out of|in|on) (?:the|this|that|our|my|their|your) ([a-z0-9'’ -]{2,40})/.exec(lead);
  if (!d) return false;
  // "Add a queue to the left of the gateway", "move it to the right".
  if (/^(?:left|right|top|bottom|front|back|end|start|side|middle|same|other side|first|second|third|fourth|fifth|last|next|following|\d+(?:st|nd|rd|th)?|monday|tuesday|wednesday|thursday|friday|week|month|quarter|year|day)\b/.test(d[1])) return false;
  const stop = d[1].search(NOUN_PHRASE_END_RE);
  return !headIsDesignish((stop === -1 ? d[1] : d[1].slice(0, stop)).trim(), vocab);
}

/** A question term said of something else: "where's the bottleneck in OUR HIRING PROCESS?". */
function asksAboutSomethingElse(q, vocab) {
  for (const m of q.matchAll(/\b(?:in|of|for|with|about|on|at|during) (?:our|the|my|their|your|his|her|tomorrow'?s|today'?s|next|another) ([a-z0-9'’ -]{2,40})/g)) {
    if (/^(?:left|right|top|bottom|middle|end|start|far (?:left|right)|other side|x|y)\b/.test(m[1])) continue;
    const end = m[1].search(NOUN_PHRASE_END_RE);
    const phrase = (end === -1 ? m[1] : m[1].slice(0, end)).trim();
    if (phrase && !designish(phrase, vocab)) return true;
  }
  return false;
}

// "Redesign this for multi-region": the design verb's object is the design on the table.
const DESIGN_OF_ACTIVE_RE =
  /\b(?:design|architect|re-?design|re-?architect|rework|rebuild|scale)\s+(?:this|that|it|the (?:system|design|architecture|diagram)|our (?:system|design|architecture))\b/;

// Words a design is changed or questioned in. Not a list of everything
// technical: the design's OWN words are read from its source.
const DESIGN_TERM_RE =
  /\b(?:arrows?|boxes|nodes?|participants?|lifelines?|data ?stores?|entry points?|front[- ]?ends?|back[- ]?ends?|redundancy|high availability|observability|edges?(?! cases?\b)|connections?|shapes?|left to right|top to bottom|top[- ]down|bottom[- ]up|horizontal(?:ly)?|vertical(?:ly)?|cach(?:e|es|ing)|queues?|workers?|consumers?|producers?|schedulers?|auth(?:n|z|entication|orization)?|sso|brokers?|kafka|rabbitmq|sqs|pub[- ]?sub|redis|memcached|databases?|db|sql|nosql|postgres(?:ql)?|mysql|mongo(?:db)?|dynamo(?:db)?|cassandra|s3|buckets?|replicas?|replication|shard(?:s|ing|ed)?|partition(?:s|ing|ed)?|index(?:es|ing)?|load balanc(?:er|ers|ing)|cdn|gateways?|prox(?:y|ies)|micro-?services?|apis?|endpoints?|cron|clusters?|multi[- ]region|regions?|failover|backups?|retr(?:y|ies)|dead[- ]letter|dlq|timeouts?|ttl|rate[- ]limit(?:er|ing)?|throttl\w*|circuit breakers?|oauth|tokens?|websockets?|webhooks?|polling|grpc|encryption|monitoring|logging|metrics|tracing|alerting|scal(?:e|es|ing|ability)|throughput|latency|consistency|availability|durability|idempoten\w*|bottlenecks?|single point of failure|trade-?offs?)\b/;
const ALGORITHM_TALK_RE =
  /\b(?:arrays?|strings?|substrings?|subarrays?|linked lists?|binary|trees?|bst|graphs?|recursi(?:on|ve)|sort(?:ed|ing)?|hash ?(?:map|table|set)s?|stacks?|heaps?|pointers?|palindromes?|bfs|dfs|dynamic programming|complexity|leetcode|functions?|algorithms?|integers?|pseudo-?code|implement(?:ation)?|iterat(?:e|or|ion)|loops?|o\([^)]{1,12}\))\b/;
// "Why is this step here?", "what does that arrow mean?": a part of the drawing, pointed at.
const POINTED_PART_RE =
  /\b(?:this|that|these|those) (?:step|stage|state|box|arrow|node|component|part|piece|layer|service|table|line|edge|branch|relationship|entity|class|bar|point|number|value|month|label|column|row|slice)s?\b/;
// What a data model or a class diagram is changed in.
const MODEL_TERM_RE = /\b(?:crow'?s[- ]?f(?:oo|ee)t|relationships?|entit(?:y|ies)|attributes?|columns?|fields?|tables?|cardinalit(?:y|ies)|optional|mandatory|nullable|unique|one[- ]to[- ](?:one|many)|many[- ]to[- ]many|primary keys?|foreign keys?|composite keys?|join tables?|constraints?|cascade|references?|belongs? to|(?:has|have) (?:many|one|multiple|several)|normal form|normali[sz]\w+|denormali[sz]\w+|index(?:es|ed)?|inherit\w*|subclass(?:es)?|interfaces?|methods?)\b/;
// A structural part added or removed by name: "add a step for approval".
const STRUCTURAL_EDIT_RE = new RegExp(
  String.raw`^(?:add|remove|insert|introduce|drop|delete|include|rename|merge|split)\s+(?:a|an|another|the|one more|a new|a second|a separate)\s+(?:[\w-]+\s+){0,2}(?:service|server|node|layer|tier|step|stage|state|component|table|class|participant|actor|entity|attribute|column|relationship|box|arrow|edge|branch|lane|transition)\b`,
);
// What a chart is changed in.
const CHART_TERM_RE = /\d+(?:\.\d+)?\s?(?:%|percent)|\b(?:rate|growth|churn|compound\w*|monthly|quarterly|annual(?:ly)?|yearly|curves?|lines?|scenarios?|baseline|(?:starting|initial|opening) (?:value|point|number|figure|amount)|horizon|scenario|assumption|months?|quarters?|years?|weeks?|periods?|series|axis|bars?|(?:line|bar|pie|area|scatter|stacked) (?:chart|graph|plot)|legend|label|title|units?|currency|savings?|cost|revenue)\b/;
// What a question about a design sounds like, beyond naming it.
const EXPLAIN_HINT_RE =
  /\b(?:what happens|happen|work(?:s|ing)?|fail(?:s|ure|ing)?|break(?:s|ing)?|goes? down|better|worse|faster|slower|cheaper|simpler|alternative|instead|choose|chose|pick(?:ed)?|need(?:ed)?|purpose|cost|safe|secure|reliable|enough|problem|issue|risk|downside|limit)\b/;
// A question that asks for an explanation (as opposed to a yes or no about how
// things stand: "does that work for everyone?", "is that a problem?").
const WHY_HOW_RE = /^(?:(?:ok(?:ay)?|now|and|but|so|wait)[, ]+)*(?:remind me )?(?:why|how (?:does|do|did|would|will|can|could|is|are|come)|how (?:long|often|many times) (?:does|do|is|are|will|would)|what happens|what if|what does (?:this|that|it) (?:do|mean))\b/;
// "Walk me through it", "explain this to me", "tell me more about this".
const EXPLAIN_IMPERATIVE_RE =
  /^(?:(?:ok(?:ay)?|now|and|but|so|please)[, ]+)*(?:(?:can|could|would) you (?:please )?)?(?:explain|describe|walk me through|talk me through|take me through|tell me (?:more )?about|go over|break down|unpack|clarify|elaborate on|go deeper (?:on|into)|dig into|drill into|say more about|more on|expand on)\b/;
// A property a design or a model run has.
const QUALITY_RE = /\b(?:secure|reliable|scalable|consistent|available|durable|persistent|idempotent|fault[- ]tolerant|resilient|redundant|stateless|synchronous|asynchronous|realistic|accurate|conservative|aggressive|optimistic|pessimistic)\b/;
// What is asked ABOUT a design with no pronoun at all: "where's the
// bottleneck?", "what are the tradeoffs?", "is there a single point of failure?".
const DESIGN_QUESTION_TERM_RE =
  /\b(?:bottlenecks?|trade-?offs?|single point of failure|failure modes?|under (?:heavy |peak )?load|at (?:peak|scale)|fail first|which (?:component|service|part|piece|node|table|entity|field|column|key|index|relationship|class)s?\b|consistency|latency|throughput|availability|durability|scalab\w+|hot ?spots?|back-?pressure|fault tolerance|data loss|race conditions?|idempoten\w*)\b/;
const CHART_QUESTION_TERM_RE = /\b(?:month|week|quarter|year|period) (?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen|twenty|twenty[- ]four|thirty|thirty[- ]six)\b|\b(?:the|each|which|this|that) (?:\w+ )?axis\b|\b[xy][- ]axis\b|\b(?:horizontal|vertical) axis\b|\bthe axes\b|\bthe legend\b|\bthe (?:dotted|dashed) line\b|\bthe shaded (?:area|band|region)\b|\bhow (?:did )?(?:you|we) (?:get|got|arrive(?:d)? at|calculated?|computed?|c[ao]me up with) (?:the|that|this)\b|\b(?:final|end|ending|last) (?:number|figure|value|total)\b|\b(?:assumptions?|baseline|(?:starting|initial|opening) (?:value|point|number|figure|amount)|growth rate|churn rate|inputs?|total (?:increase|growth|change)|percentage (?:increase|change)|increase over)\b/;

// A sentence about the person, not the design: "how would it work with your
// visa?", "can you hear me?", "where do you see yourself?", "I'm on mute".
// Not any sentence with "I" or "me" in it: "walk me through it", "explain this
// to me" and "I want to add a cache" are about the design. And "why did you
// pick this?" / "how would you scale it?" are about it too, whoever "you" is.
const PERSONAL_NOUN = String.raw`(?:role|job|position|salary|pay|visa|resume|résumé|cv|background|experience|manager|boss|notice period|availability|schedule|calendar|family|commute|location|offer|compensation|career|strengths?|weakness(?:es)?|hobbies|name|email|phone|number|address|order|account|bill|subscription|refund|ticket|team|company|degree|education|interests?|goals?|day|week|weekend|time|voice|screen|camera|mic|microphone|audio|connection|opinion|take|thoughts)`;
const PERSONAL_RE = new RegExp(
  [
    String.raw`\b(?:your|my|his|her|their) (?:[\w-]+ )?${PERSONAL_NOUN}\b`,
    String.raw`\b(?:yourself|myself|yours|mine)\b`,
    String.raw`\b(?:are|were|do|did|does|have|had|will|would|can|could|should) you\b`,
    String.raw`\byou (?:have|had|did|do|were|are|feel|think|know|like|want|prefer|live|work|guys|all)\b`,
    String.raw`\b(?:hear|see|call|email|text|ping|message|add|invite|join|meet|remind|send|excuse|forgive|thank|ask|pay|hire|contact) me\b`,
    String.raw`(?<!\b(?:can|could|may|might|should) )\bi(?:'m| am| was|'ve| have| had| will|'ll| can'?t| cannot| don'?t| didn'?t| won'?t) (?!(?:think (?:we|it|that|this|the)\b|thinking|wondering|adding|using|not sure (?:about|why|how) (?:the|this|that)|going to (?:add|use|put|need))\b)`,
    String.raw`\bgive me a (?:second|minute|sec|moment|call|ring|shout|break)\b`,
    String.raw`\bfor (?:me|us|him|her|them) to\b|\bremind (?:me|us|him|her|them)\b(?! (?:why|how|what|where|which)\b)`,
    String.raw`\b(?:told|tell|asked|ask|gave|offer(?:ed)?|paid|sent|owe|owes) you\b`,
  ].join('|'),
);
// About something else entirely — a job, a meeting, somebody's hours. Unlike
// the patterns above this is never excused by "you" being the designer ("can
// you scale back your hours?", "why do we need another meeting about this?").
const ELSEWHERE_RE = new RegExp(
  [
    String.raw`\bthe (?:salary|offer|role(?! of\b)|job|position|commute|visa|interview|recruiter|hiring manager)\b`,
    String.raw`\b(?:salary|visa|commute|paycheck|bonus|pto|vacation|maternity|paternity)\b`,
    // (Unless it is a part of a design: "the call path", "a meeting service".)
    String.raw`\b(?:the|our|this|next|that|every|your|my|a|an) (?:weekend|night|day|morning|evening|late|early|sunday|saturday|monday|friday) shift\b|\bon (?:the )?(?:rota|roster|payroll)\b`,
    String.raw`\b(?:another|a|an|the|our|this|next|that|every|your|my) (?:meeting|call|sync|stand-?up|interview|session|demo|shift)\b(?! from the [\w -]{2,30} to the\b)(?! (?:flow|path|sequence|order|graph|stack|chain|site|rate|volume|service|queue|handler|reminders?|booking|scheduler|recording|api)\b)`,
    String.raw`\b(?:your|my|his|her|their) (?:[\w-]+ )?(?:hours|workload|time off|shift|calendar)\b`,
    // How many people work on it, as opposed to how many use it: "scale to a
    // team of fifty people", "grow to forty engineers".
    String.raw`\b(?:a|our|the|your|their) team of (?:[\w-]+ )?(?:people|engineers|developers|designers|reps|recruiters|analysts|\d+)\b`,
    String.raw`\b(?:scale|grow|expand|get)\b[^.?!]{0,24}\bto (?:[\w-]+ ){1,2}(?:employees|engineers|developers|hires|staff|headcount|reps|recruiters|offices|locations|branches)\b`,
    // A booking or a reservation that is somebody's evening, not an entity:
    // "add Priyanka to the reservation for dinner tonight", "move our table
    // booking to eight o'clock".
    String.raw`\b(?:dinner|lunch|breakfast|brunch|restaurant|hotel|flight|table|taxi|cab|train|room) (?:reservation|booking)s?\b|\b(?:reservation|booking)s? (?:for|at) (?:dinner|lunch|breakfast|brunch|tonight|tomorrow|the restaurant|the hotel)\b`,
    String.raw`\b(?:tonight|for (?:dinner|lunch|breakfast|brunch|drinks|coffee))\b`,
    String.raw`\b(?:at|to|by|until|till|around) (?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?: o'?clock| thirty| fifteen| forty[- ]five)\b|\bhalf past (?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b`,
  ].join('|'),
);
const YOU_AS_DESIGNER_RE =
  /\b(?:do|does|did|would|could|should|didn'?t|wouldn'?t|might|can|will) (?:you|we|i) (?:\w+ )?(?:separate|normali[sz]e|model|reference|link|connect|name|structure|group|index|pick|choose|chose|use|add|go with|design|need|put|include|prefer|decide|select|suggest|propose|recommend|draw|redraw|show|sketch|plot|chart|scale|handle|change|replace|remove|keep|split|store|cache|shard|partition|deploy|secure|test|monitor|explain|describe|walk|simplify|expand|update|make|rename|move|convert|turn|zoom|label|mark|set|switch|swap|drop|delete|extend|try)\b|\bdo (?:you|we) (?:\w+ )?(?:need|think|prefer|recommend|suggest)\b/;
// Talk about a date or a time is talk about a calendar. (A calendar SERVICE or
// a meeting-reminder worker is a component: only scheduling language counts.)
const SCHEDULING_RE =
  /\b(?:on|by|for|at|until|till|before|after|next|this|to) (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|tonight|noon|morning|afternoon|evening|weekend|\d{1,2}(?::\d\d)?\s?(?:am|pm))\b|\b(?:schedule|reschedule|book|set up|move|push|cancel|postpone|send|join|start|end|skip)\b[^.?!]{0,24}\b(?:meeting|call|interview|sync|invite|session|demo|appointment|stand-?up)\b|\b(?:calendar invite|interview slot|call back|notice period)\b/;

function isPersonal(q) {
  const rest = stripLeadIn(q);
  return (PERSONAL_RE.test(rest) && !YOU_AS_DESIGNER_RE.test(q)) || ELSEWHERE_RE.test(q) || SCHEDULING_RE.test(q);
}

const LABEL_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'service', 'services', 'system', 'app', 'api', 'store', 'data', 'user', 'users', 'client',
  'server', 'request', 'response', 'path', 'flow', 'yes', 'no', 'end', 'start', 'new', 'old', 'all', 'any', 'via', 'per', 'not', 'left',
]);

// Mermaid's own words and the usual attribute types: not the subject's vocabulary.
const MERMAID_WORDS = new Set(
  ('erdiagram classdiagram statediagram sequencediagram mindmap timeline gantt title section participant actor note over loop alt opt else par ' +
    'and end class state direction int integer string text varchar char float double decimal number bool boolean date datetime timestamp uuid ' +
    'json void list map set array dateformat axisformat todaymarker off after done active crit milestone root').split(' '),
);

// Words that are the payload's own vocabulary (types, statuses), not the subject's.
const PAYLOAD_MACHINERY_KEYS = new Set(['type', 'kind', 'intent', 'basis', 'orientation', 'format', 'scale', 'mode', 'stack', 'notation']);
const PAYLOAD_STOPWORDS = new Set([
  'observed', 'calculated', 'scenario', 'illustrative', 'line', 'bar', 'grouped', 'stacked', 'scatter', 'waterfall', 'heatmap', 'funnel', 'pie',
  'quadrant', 'time', 'category', 'number', 'partial', 'chen', 'automaton', 'dfa', 'nfa', 'delta', 'compound', 'function',
  'the', 'and', 'for', 'with', 'from',
]);

/**
 * Distinctive lower-case words of an artifact's source: the labels of a
 * Mermaid diagram, or — for a chart / notation payload (JSON) — the labels and
 * names it holds. JSON keys, numbers and status words are not identity.
 */
export function designVocabulary(mermaidSource) {
  const words = new Set();
  const text = String(mermaidSource ?? '');
  if (text.trimStart().startsWith('{')) {
    // String VALUES only (a quoted string followed by ":" is a key). Works on a
    // payload that is still arriving, too.
    // Every string is consumed in turn, key or value, so the quotes stay paired.
    let key = '';
    for (const m of text.matchAll(/"((?:[^"\\\n]|\\.){0,120})"(\s*:)?/g)) {
      if (m[2]) { key = m[1]; continue; } // a key
      // What kind of chart it is ("kind":"compound_growth", "type":"line") is
      // machinery, not what the chart is about.
      if (PAYLOAD_MACHINERY_KEYS.has(key)) continue;
      for (const raw of m[1].toLowerCase().split(/[^a-z0-9]+/)) {
        if (raw.length >= 3 && !PAYLOAD_STOPWORDS.has(raw) && !/^\d+$/.test(raw)) words.add(raw);
      }
    }
    return words;
  }
  // A data model, a class diagram, a state machine: the names are bare words.
  if (/^\s*(?:erDiagram|classDiagram|stateDiagram|sequenceDiagram|mindmap|timeline|gantt)\b/.test(text)) {
    for (const raw of text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length >= 3 && !LABEL_STOPWORDS.has(raw) && !MERMAID_WORDS.has(raw) && !/^\d+$/.test(raw)) words.add(raw);
    }
    return words;
  }
  const labelRe = /"([^"\n]{1,80})"|\[([^\]"\n]{1,60})\]|\(([^)"\n]{1,60})\)|(?:participant|actor)\s+\S+\s+as\s+([^\n]{1,60})|^\s*([A-Z][A-Za-z]+)(?=\s*-->)|-->\s*([A-Z][A-Za-z]+)\b/gm;
  for (const m of text.matchAll(labelRe)) {
    const label = m[1] || m[2] || m[3] || m[4] || m[5] || m[6] || '';
    // Split CamelCase state names ("PaymentFailed") as well as spaced labels.
    for (const raw of label.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length >= 3 && !LABEL_STOPWORDS.has(raw)) words.add(raw);
    }
  }
  // A node's id is the short name its author gave the part — planner["Route
  // Planning Service"] — and is how it gets called: "split the planner".
  // (A real word of five letters or more; "n1", "svc2" and "start" are not names.)
  for (const m of text.slice(0, 12000).matchAll(/(?:^|[\s;>|&-])([a-z][a-z]{4,23})(?=\s*(?:\[|\(|\{|-->|---|-\.|==>))/gm)) {
    const id = m[1];
    if (!LABEL_STOPWORDS.has(id) && !MERMAID_WORDS.has(id) && !NODE_ID_STOPWORDS.has(id)) words.add(id);
  }
  return words;
}
const NODE_ID_STOPWORDS = new Set(['start', 'begin', 'finish', 'done', 'stop', 'check', 'input', 'output', 'other', 'first', 'second', 'third', 'error', 'retry', 'valid', 'invalid', 'success', 'failure', 'failed', 'right', 'wrong', 'yesno', 'true', 'false', 'person', 'people', 'thing', 'things', 'graph', 'chart', 'table', 'order', 'email', 'phone', 'place', 'point', 'group', 'level', 'state', 'event', 'value', 'label', 'title', 'class', 'style', 'click', 'subgraph']);

/**
 * The artifact's own multi-word names, lower-cased: "notification queue",
 * "delivery worker", "payment failed". Naming one of these is naming the
 * artifact — far stronger evidence than one common word ("email", "order").
 */
export function designLabels(source) {
  const text = String(source ?? '');
  const out = new Set();
  const add = (label) => {
    const words = String(label).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
    if (words.length >= 2 && words.length <= 5) out.add(words.join(' '));
  };
  if (text.trimStart().startsWith('{')) {
    let key = '';
    for (const m of text.matchAll(/"((?:[^"\\\n]|\\.){0,80})"(\s*:)?/g)) {
      if (m[2]) key = m[1];
      else if (!PAYLOAD_MACHINERY_KEYS.has(key)) add(m[1]);
    }
    return out;
  }
  for (const m of text.matchAll(/"([^"\n]{1,60})"|\[([^\]"\n]{1,60})\]|\(([^)"\n]{1,60})\)|(?:participant|actor)\s+\S+\s+as\s+([^\n]{1,60})|\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g)) {
    add(m[1] || m[2] || m[3] || m[4] || m[5] || '');
  }
  // A Gantt chart's tasks are named before the colon: "Staff Move Weekend :c1, after b1, 2d".
  if (/^\s*gantt\b/.test(text)) {
    for (const m of text.matchAll(/^[ \t]*(?!title\b|section\b|dateFormat\b|axisFormat\b|excludes\b|todayMarker\b|tickInterval\b)([^:\n]{3,60}?)\s*:/gm)) add(m[1]);
  }
  return out;
}

/**
 * The titles of a diagram's groups or lanes (`subgraph Support`, `subgraph ops
 * ["Ops Team"]`), as lower-case words.
 */
export function designGroups(source) {
  const out = new Set();
  for (const m of String(source ?? '').slice(0, 12000).matchAll(/(?:^|\n)[ \t]*subgraph[ \t]+(?:[^\s\["\n]+[ \t]*\[[ \t]*"?([^"\]\n]{2,60})"?[ \t]*\]|"([^"\n]{2,60})"|([^\["\n]{2,60}))[ \t]*(?=\n|$)/g)) {
    const words = String(m[1] || m[2] || m[3] || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
    if (words.length >= 1 && words.length <= 5) out.add(words.join(' '));
  }
  return out;
}

const LANE_NOUN = '(?:swim ?lanes?|lanes?|columns?|rows?|tracks?|groups?|boxe?s?|sections?|layers?|tiers?)';

/**
 * Is a lane or a group of the diagram named: by its title when that is more
 * than one word ("customer support"), or — a one-word title being a
 * department or a role, an everyday word — when it is called a lane ("the
 * finance lane", "the lane for support")?
 */
function namesLane(q, source) {
  const groups = designGroups(source);
  if (groups.size === 0) return false;
  const flat = ` ${q.replace(/[^a-z0-9]+/g, ' ')} `;
  for (const group of groups) {
    if (group.includes(' ')) {
      if (flat.includes(` ${group} `)) return true;
      continue;
    }
    if (group.length < 3) continue;
    // ("The fast lane for support tickets" is not the Support lane: the noun
    // has to be the lane itself — "a lane for support", "the lane called …".)
    if (new RegExp(` ${group}(?: s)? ${LANE_NOUN} `).test(flat)
      || new RegExp(` (?:the|a|an|that|this|each|every|another|new|its|their|our) ${LANE_NOUN} (?:for|of) (?:the )?${group} `).test(flat)
      || new RegExp(` ${LANE_NOUN} (?:called|named|labell?ed|marked|titled) (?:the )?${group} `).test(flat)) return true;
  }
  return false;
}

function namesLabel(q, labels) {
  if (labels.size === 0) return false;
  const flat = ` ${q.replace(/[^a-z0-9]+/g, ' ')} `;
  for (const label of labels) if (flat.includes(` ${label} `) || flat.includes(` ${label}s `)) return true;
  return false;
}

/**
 * Does the sentence quote a value the chart holds: its rate ("is 5%
 * realistic?") or one of its amounts ("where does 10,000 come from?")?
 * Small bare numbers are everywhere ("give me 5 minutes") and do not count.
 */
function namesChartValue(q, source) {
  const text = String(source ?? '');
  if (!text.trimStart().startsWith('{')) return false;
  const held = new Set();
  for (const m of text.matchAll(/-?\d+(?:\.\d+)?/g)) held.add(String(Number(m[0])));
  for (const m of q.matchAll(/(\d[\d,]*(?:\.\d+)?)\s?(%|percent|k\b)?/g)) {
    let value = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    if (m[2] && m[2].startsWith('k')) value *= 1000;
    const isRate = m[2] === '%' || m[2] === 'percent';
    if ((isRate || value >= 100) && held.has(String(value))) return true;
  }
  return false;
}

/** Does the sentence use one of the artifact's own words — as a thing, not as "your email" or "my order"? */
function namesComponent(q, vocab, { definite = false } = {}) {
  if (vocab.size === 0) return false;
  const tokens = q.split(/[^a-z0-9']+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    const word = tokens[i];
    if (word.length < 3) continue;
    const hit = vocab.has(word) || (word.endsWith('s') && vocab.has(word.slice(0, -1))) || vocab.has(`${word}s`)
      || (word.endsWith('ies') && vocab.has(`${word.slice(0, -3)}y`));
    if (!hit) continue;
    // "What is your email?", "send it to my phone": a person's own thing.
    if (i > 0 && /^(?:your|my|his|her|their|yours|mine)$/.test(tokens[i - 1])) continue;
    // "What's your favourite database?": a person's own, one adjective away.
    if (i > 1 && /^(?:your|my|his|her|their)$/.test(tokens[i - 2])) continue;
    // "How many MONTHS of runway do we have?": a unit of time or of money
    // names a part of a chart only when it is pointed at ("the last month",
    // "that quarter").
    if (TIME_UNIT_RE.test(word) && !tokens.slice(Math.max(0, i - 2), i).some((t) => /^(?:the|this|that|last|first|final|each|every|which|what)$/.test(t))) continue;
    // "The queue FOR THE LIFT", "the table by the window", "the gateway at the
    // airport": the same word, of something that is no part of the design.
    if (/^(?:for|at|outside|near|by|in)$/.test(tokens[i + 1] || '') && /^(?:the|a|an|our|my|your|their)$/.test(tokens[i + 2] || '')) {
      const phrase = [];
      for (let k = i + 3; k < tokens.length && phrase.length < 4 && !NOUN_PHRASE_END_RE.test(` ${tokens[k]} `); k += 1) phrase.push(tokens[k]);
      if (phrase.length > 0 && !headIsDesignish(phrase.join(' '), vocab)) continue;
    }
    if (definite) {
      const before = tokens.slice(Math.max(0, i - 2), i);
      // "Add a cache", "another queue": a NEW one of its kind, not the one drawn.
      if (before.some((t) => /^(?:a|an|another|some|any|new|more|extra|second|third)$/.test(t))) continue;
      // "How do databases handle transactions?": the kind of thing, in general.
      // A common part word means the part only with "the/this/that/our/its"
      // before it; a name ("Stripe", "Redis") can stand alone.
      const generic = GENERIC_PART_RE.test(word);
      if (generic && !before.some((t) => /^(?:the|this|that|our|its|these|those)$/.test(t))) continue;
    }
    return true;
  }
  return false;
}

// Words that say nothing about WHAT is to be shown.
const VIEW_WORDS = new Set(
  ('a an the this that it these those of for in on at to as and or but with from by is are was were be do does did can could would will should please just only now again also then so ok okay ' +
    'me us my our you your we i how what when where which who why ' +
    'show give draw sketch redraw diagram illustrate visualise visualize whiteboard display make see put turn convert render present ' +
    'part parts path paths flow flows sequence view side layer level detail more less whole entire full same different other another ' +
    // How a path or a view is qualified, and how one is asked for.
    'failure error retry success happy hot cold critical slow fast main primary secondary backup fallback zoom focus drill into onto again thing ' +
    'deployment logical physical network component container runtime infrastructure security high low level overview detailed ' +
    'through across within inside between during under over per each every all whole end placing going coming ' +
    'write read request response data delivery message control auth authentication login payment happens works working step steps ' +
    'state states lifecycle architecture flowchart chart graph picture drawing design system version one out up').split(' '),
);

// The thing to show is a bare pronoun: "show it as a table", "turn this into
// an ER diagram", "chart that". Not "show that table" (a determiner).
const PRONOUN_OBJECT_RE =
  /\b(?:show|draw|give|put|turn|convert|change|switch|transform|render|present|make|plot|chart|graph|visuali[sz]e|display|redo|redraw|rework|lay|sketch|diagram|illustrate|see|get|have|view)\s+(?:me\s+)?(?:this|that|it|these|those|the same (?:thing|one|design|system))(?=\s+(?:as|in|into|to|on|out|like|visually|again|with|using|without|but|plus)\b|\s*[.?!,]|\s*$)/;
// "Where would you put the cache?", "where would you add an index?".
const WHERE_PUT_RE = /\bwhere (?:would|should|do|could|does|will) (?:you|we|i|it|that|this|the [\w -]{1,30}?) (?:put|add|place|keep|store|go|sit|live|run)\b/;
const ASKS_NOT_EDITS_RE = /^(?:why|which|who|where|when|is|are|was|were|(?:does|did) (?:it|this|that|we|you|they|i|he|she|the|a|an|our|your|these|those|any)\b|do (?:we|you|they|i|the|a|an|our|your|these|those|any)\b|how (?!about\b)|what (?!if\b|about\b))/;
// "Show the chart as a table", "turn the diagram into a timeline".
const TURNS_NAMED_RE = /\b(?:show|put|turn|convert|give|display|present|render|make|get|see|lay|redo|redraw)\b[^.?!]*\b(?:as|into|in|to) an? [\w-]/;
// "Can I see the data model for this?", "a sequence diagram of that": of the thing on the table.
const OF_THIS_RE = /\b(?:for|of|from|behind) (?:this|that|it|the same (?:system|design|architecture|thing|setup|one))(?:\s*[.?!]?\s*$| (?:as|in|into|with|using) an? )/;
// "A table of the components and their responsibilities": of its parts.
const OF_ITS_PARTS_RE = /\b(?:of|for|listing|with) (?:the|its|all the|all of the|each of the|these|those) (?:components|services|parts|entities|tables|participants|nodes|boxes|modules|layers|classes)\b/;
// "Can I see …", "show me …", "can you give me …": asking to be shown something.
const SHOW_REQUEST_RE = /^(?:(?:can|could|may) (?:i|we) (?:see|get|have)|(?:(?:can|could|would|will) you )?(?:please )?(?:show|give) (?:me|us)|let'?s see|(?:i|we)(?:'d| would) like to see|(?:i|we) want to see)\b/;
// "The sequence for booking", "the state diagram for cancelling an order": a
// behaviour with no system of its own is a behaviour of the one on the table.
const VIEW_FOR_ACTIVITY_RE = /\b(?:sequence|flow|state|lifecycle)(?: diagram| chart)? (?:for|of|when|during|while) \w+ing\b/;
const NAMES_A_SYSTEM_RE = /\b(?:a|an|another|some) (?:[\w-]+ ){0,2}(?:app|application|system|service|platform|site|website|store|shop|bank|marketplace|api|product|tool|game)\b/;
// "Explain the third message", "walk me through the last step".
const ORDINAL_PART_RE = /\bthe (?:first|second|third|fourth|fifth|sixth|seventh|last|final|next) (?:message|step|arrow|hop|call|box|node|participant|stage|transition)\b/;
// What is asked of a schedule: "what's on the critical path?", "which tasks
// overlap in May?", "is there any slack between the fit-out and the cabling?".
const SCHEDULE_QUESTION_RE = /\bcritical path\b|\bslack\b|\boverlap(?:s|ping)?\b|\bwhich (?:tasks?|phases?|milestones?)\b|\bhow long (?:is|does|will) the (?:whole |entire |full )?(?:project|plan|schedule|thing)\b|\bin parallel\b|\b(?:finish|end|start)(?:es|s)? (?:first|last)\b|\bwhat(?:'s| is) the (?:end|finish|start) date\b/;
// "Add a task for IT testing after cabling", "add a section for staff comms".
const SCHEDULE_STRUCTURAL_RE = /^(?:add|remove|insert|drop|delete|rename|merge|split)\s+(?:a|an|another|the|one more|a new)\s+(?:[\w-]+\s+){0,2}(?:task|section|milestone|phase|event|period)\b(?! (?:for|to) (?:me|us|him|her|them)\b)/;
// How a schedule is changed: "push furniture delivery back by a week".
const SCHEDULE_EDIT_RE = /^(?:push|delay|postpone|bring forward|pull (?:in|forward)|start|finish|shorten|lengthen|extend|slip|reschedule|shift)\b/;
// What is asked of a state machine: "can a claim go from Submitted directly to
// Approved?", "which states are terminal?".
const STATE_QUESTION_RE = /\b(?:which|how many) states?\b|\bno [\w-]+ state\b|\bterminal\b|\btransitions?\b|\bloops?\b|\bstuck in\b|\b(?:end|final|initial|start) states?\b/;
const STATE_MOVE_RE = /\bfrom (?:the )?([\w-]+)(?: [\w-]+)? (?:straight |directly |back )?to (?:the )?([\w-]+)/;
// "What triggers Overdue?", "how many ways are there to reach Returned?".
const STATE_TRIGGER_RE = /\b(?:what|which \w+) (?:triggers|causes|leads to|sets off|kicks off|puts (?:it|a \w+) (?:in|into))\s+(?:the |an? )?([\w-]+)/;
const STATE_REACH_RE = /\b(?:reach|get to|gets to|end up in|ends up in|arrive at|land in|lands in|leave|leaves|exit|exits|enter|enters|get out of|gets out of)\s+(?:the |an? )?([\w-]+)/;
/** Of the diagram only when the state it names is one of the diagram's. */
function asksAboutAState(q, vocab) {
  for (const re of [STATE_TRIGGER_RE, STATE_REACH_RE]) {
    const m = re.exec(q);
    if (m && m[1].length >= 3 && vocab.has(m[1])) return true;
  }
  return false;
}
/** "Can a claim go from Submitted directly to Approved?" — of the diagram only when it names one of its states. */
function asksStateMove(q, vocab) {
  const m = STATE_MOVE_RE.exec(q);
  return Boolean(m) && [m[1], m[2]].some((w) => w.length >= 3 && vocab.has(w));
}
// One part of a design said to do something to another: "does the dashboard
// read straight from the store?".
const DATAFLOW_RE = /\b(?:reads?|writes?|publish(?:es)?|subscribes?|quer(?:y|ies)|fetch(?:es)?|polls?|connects?|sits?|depends?) (?:\w+ )?(?:from|to|into|on|behind|between|in front of) (?:the|a|an)\b/;
// How many of one thing another may have, asked of a data model's own
// entities: "can a patron have more than one loan at a time?".
const CARDINALITY_RE = /\b(?:more than one|at most one|at least one|exactly one|only one|one or more|zero or more|any number of|multiple|several)\b/;
// How a line on a chart behaves: "why does it speed up towards the end?".
const CHART_SHAPE_RE = /\b(?:steep(?:er)?|flat(?:ter)?|curved|bend(?:y|ier)|speeds? up|slows? down|flattens?(?: out)?|levels? (?:off|out)|plateaus?|dips?|spikes?|jumps?|climbs?|curves?|bends?|accelerates?|tapers?(?: off)?|peaks?|steepens?|takes? off|shoots? up|go(?:es)? (?:up|down)|drops? off)\b/;
// A why-question with its verb left out, about what is on the table: "why two
// entry points?", "why no cache?", "why is there no table for fines?".
const ELLIPTICAL_WHY_RE = /^(?:(?:ok(?:ay)?|so|and|but|wait)[, ]+)*why (?:(?:is|are|was|were) there )?(?:no|not|two|three|four|\d+|both|so many|only one|only a|just one|a second|another|a separate|separate)\b/;
// (A QUESTION, from its first word: "add what was agreed for the gateway" and
// "add the cache Ana mentioned" are edits that cite the meeting.)
const MEETING_RECALL_RE = /^(?:(?:and|so|but|okay|ok|wait|sorry|um|uh|hey|right|also|actually),? )*(?:(?:do you (?:remember|recall|know)|(?:can|could) you (?:tell|remind) me|remind me|tell me),? )?(?:(?:what|who|when|where|why|how) (?:did|was|were|had|have) (?:[\w']+ ){0,3}(?:say|said|mention(?:ed)?|decided?|agreed?|concluded?|talk(?:ed)? about|discuss(?:ed)?|suggest(?:ed)?|proposed?|ask(?:ed)?|raised?|bring up|brought up|settled? on|promised?)\b|who (?:said|mentioned|suggested|proposed|asked|raised|brought up|decided)\b|what was (?:said|decided|agreed|mentioned|discussed)\b|did (?:[\w']+ ){1,3}(?:say|mention|agree|decide|promise)\b)/;
// "Put the numbers in a table": what a chart holds.
const CHART_DATA_OBJECT_RE = /\b(?:put|show|give|lay|list|get|see|have|view) (?:me |us )?(?:the|these|those)(?: same)? (?:numbers|figures|values|data|results)\b/;
// A rate of something the chart is not about: "the VAT rate", "the interest rate on the loan".
function foreignRate(q, vocab) {
  const m = /\b([a-z-]+) rates?\b/.exec(q);
  if (m && !/^(?:growth|churn|the|a|monthly|annual|yearly|quarterly|weekly|that|this|same|new|higher|lower|compound|percentage|which|what|of|our|its)$/.test(m[1]) && !vocab.has(m[1])) return true;
  if (/\brates? of (?!growth\b|churn\b|change\b|return\b|increase\b|\d)[a-z]+/.test(q)) return true;
  return /\brates? (?:on|for) (?:the|a|an|our|my|your|their)\b/.test(q);
}
// Asked of a sequence: "who initiates the request?".
const SEQUENCE_QUESTION_RE = /^who (?:initiates|triggers|starts|kicks off) the (?:request|flow|sequence|exchange)\b/;
// "Who sends the e-ticket?": asked of a sequence when it names one of its messages or participants.
const SEQUENCE_ACTOR_RE = /^(?:who|what|which \w+) (?:sends|receives|calls|returns|replies|responds|acknowledges|issues|creates|validates|handles)\b/;
/** …and what is sent is one of the diagram's own (the verb itself does not count: "who sends the invoice?"). */
function asksWhoSends(lead, vocab) {
  const m = SEQUENCE_ACTOR_RE.exec(lead);
  return Boolean(m) && namesComponent(lead.slice(m[0].length), vocab);
}
// "When does the launch section start?".
const SCHEDULE_WHEN_RE = /\bwhen (?:does|do|will|is|are|should)\b[^.?!]{0,50}\b(?:start|begin|end|finish|kick off|wrap up|complete|due|done)\b/;
// "Now the deployment view.", "the read path, please": a view asked for by a fragment.
const VIEW_FRAGMENT_RE = /^(?:(?:ok(?:ay)?|now|and|so|then|next|also|just)[, ]+)*(?:(?:show|give) me |show )?(?:the |a )?(?:[\w-]+ ){1,2}(?:view|path|flow|sequence)\s*(?:only|please|,? please)?\s*[.!?]?$/;
// What a design is explained by: one of its paths or parts ("explain the write path").
const VIEW_OF_DESIGN_PART_RE = /\b(?:the|this|that) (?:[\w-]+ ){0,2}(?:path|flow|sequence|layer|side)\b/;
// Asked of the design itself, by a pronoun: "can this handle a spike?", "how does this scale to ten million users?".
// ("Does it support SSO?" is asked of a product: only "how does this support …" counts for that verb.)
const NOT_THE_DESIGN = '(?! (?:team|teams|company|org|organi[sz]ation|group|department|office|business|firm|start-?up|squad|crew|plan|budget|process|role|person|hire|vendor|client|customer|deal|project|meeting|market|campaign|policy|contract|price|pricing|offer)s?\\b)';
const CAPABILITY_RE = new RegExp(String.raw`\bhow (?:does|would|will|do|can|could|well does) (?:(?:this|that)${NOT_THE_DESIGN}|it|the (?:system|design|architecture))\b[^.?!]{0,60}\b(?:scale|handle|cope|support|survive|hold up|keep up|work (?:at|under))\b`);
// The yes-or-no form is a question about it, answered in words.
const CAPABILITY_QUESTION_RE = new RegExp(String.raw`^(?:(?:ok(?:ay)?|so|and|but)[, ]+)*(?:can|could|will|would|does) (?:(?:this|that)${NOT_THE_DESIGN}|it|the (?:system|design|architecture))\b[^.?!]{0,60}\b(?:scale|handle|cope with|survive|hold up|keep up)\b`);
// "Draw it again with a cache", "redraw it with Kafka": the same drawing, changed.
const REDRAW_WITH_RE = /\b(?:(?:re-?draw|redo|rework)\s+(?:it|this|that)|(?:draw|sketch|show|do)\s+(?:it|this|that)\s+again)\b[^.?!]*\b(?:with|using|plus|but|without|minus)\b/;
// "Change this to a sequence diagram", "turn it into a table": another KIND of
// drawing of the same thing — not an edit that keeps every node where it is.
const VIEW_CHANGE_RE = /\b(?:to|into|as) an? (?:[\w-]+ )?(?:diagram|chart|flow ?chart|table|timeline|mind ?map|sequence|state machine|tree|matrix|graph)\b|\b(?:to|into|in) chen\b/;
// With a chart on the table: a change to one of its inputs, said the way a
// change is said. Not every sentence with a number or a duration in it ("the
// contract is for 12 months", "we need 20% more budget").
// A number a chart is changed in: a rate, an amount (three digits or more, or
// money), or a horizon in months, quarters or years. Not "3 o'clock", "9
// tomorrow", "2 monitors", "5 people", "14 days of trial".
const SPOKEN_NUMBER = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|eighteen|twenty|twenty[- ]four|thirty|thirty[- ]six|forty|fifty|sixty|half|a|an)';
const HALF = '(?: and a half| point (?:zero|oh|one|two|three|four|five|six|seven|eight|nine)(?: five)?)?';
const CHART_NUMBER = String.raw`(?:\d+(?:\.\d+)?${HALF}\s?(?:%|percent|per cent)|\b${SPOKEN_NUMBER}${HALF} (?:percent|per cent)\b|[$€£₹]\s?\d|\b\d{1,3}(?:,\d{3})+\b|\b\d{3,}\b|\b\d+(?:\.\d+)?\s?k\b|\b${SPOKEN_NUMBER}(?:[- ]${SPOKEN_NUMBER}){0,2}${HALF} (?:hundred|thousand|million|grand)\b|\b(?:\d+|${SPOKEN_NUMBER})${HALF} (?:more |extra )?(?:months?|quarters?|years?)\b|\ba (?:month|quarter|year) and a half\b|\btwice\b|\bhalf\b|\b(?:quarterly|monthly|annually|yearly|weekly)\b)`;
// What may follow the number in a change: the end of the sentence, or more of
// the change. Not the rest of some other sentence: "can you do 20 percent OFF",
// "over 18 months WE HIRED forty people", "with 5 percent OF THE TEAM out sick".
const CHART_AFTER = String.raw`(?=\s*(?:[.?!,]|$|as\b|only\b|total\b|out\b|now\b|too\b|rather\b|not\b|instead\b|and\b|then\b|but\b|or\b|a (?:month|year|quarter|week)\b|per\b|monthly\b|annual(?:ly)?\b|yearly\b|quarterly\b|growth\b|churn\b|rate\b|net\b|gross\b|baseline\b|for\b|over\b|at\b|with\b|to start\b|please\b|from\b|by\b|side by side\b|compounded\b|of (?:growth|churn)\b|instead of\b))`;
const CHART_WORD = String.raw`\b(?:rate|growth|churn|horizon|baseline|(?:starting|initial|opening) (?:value|point|number|figure|amount))\b`;
// Between the change and its number only words of a change may stand ("try it
// at about 8%", "assume a churn of 2%"). Anything else is another sentence
// that happens to hold a number: "double check the address, it's 221 Baker
// Street", "try calling them at 555 0199", "assume they bring 300 people".
const CHART_GAP = String.raw`(?:(?:it|that|this|a|an|the|rate|growth|churn|baseline|horizon|monthly|annual|yearly|of|at|to|is|be|with|for|over|about|around|roughly|only|just|out|more|another|instead|net|gross)\s+){0,6}`;
const CHART_CHANGE_RE = new RegExp(
  [
    String.raw`^(?:(?:what|how) about|what if (?:it's|it is|it|that|this|we (?:use|try|assume|do|go|grow)|the (?:rate|growth|churn|baseline|horizon|starting \w+) (?:is|was|were)|growth is|churn is)|try|redo|rerun|recompute|make it|change (?:it|that|the (?:rate|growth|churn|baseline|horizon|period|starting \w+)) to|set (?:it|that|the (?:rate|growth|churn|baseline|horizon|period|starting \w+)) to|drop (?:it|that|the rate) to|use|with|at|over|for|start(?:ing)? (?:from|at|with)|go out|(?:extend|stretch|push|shorten|shrink|cut|trim|pull) (?:(?:it|that|this|the (?:horizon|period|forecast|projection|timeline)) )?(?:out |back |down )?(?:to|by)|(?:run|do|redo|show|project|see) (?:it|that|this) (?:again |out )?(?:for|at|with|over|to)|do|(?:bump|raise|lower|increase|decrease) (?:it|that|the (?:rate|growth|churn|baseline))(?: up| down)?(?: to| by)?|assume|grow|(?:the )?same (?:thing|again|chart|idea),? (?:but|except|only)(?: starting| start)?(?: at| from| with)?)\s+${CHART_GAP}${CHART_NUMBER}${CHART_AFTER}`,
    // "Do it quarterly instead of monthly."
    String.raw`^(?:do|make|run|show|redo) (?:it|that|this) (?:quarterly|monthly|annually|yearly|weekly)\b`,
    // "Double the rate", "halve it", "triple the growth".
    String.raw`^(?:double|halve|triple) (?:it|that|this|the (?:rate|growth|churn|baseline|horizon|period|(?:starting|initial|opening|base) (?:value|figure|number|point|amount)))\b`,
    // "Compare that with 4% and 7% side by side."
    String.raw`^compare (?:it|that|this) (?:with|to|against)\s+${CHART_GAP}${CHART_NUMBER}`,
    // "I'd like to see it with 2% instead."
    String.raw`^(?:like|love|want|need) to see (?:it|that|this) (?:with|at|for|over)\s+${CHART_GAP}${CHART_NUMBER}`,
  ].join('|'),
);
const CHART_LOOKS_AT_RE = new RegExp(String.raw`\b(?:looks? like|happens?) (?:at|with|over|after|if)\b[^.?!]{0,60}?${CHART_NUMBER}`);
// What a forecast or a model run is asked, with no pronoun at all: "where do
// we end up after a year?", "when do we hit 30,000?", "how long until we double?".
const CHART_OUTCOME_QUESTION_RE = /^(?:(?:ok(?:ay)?|so|and|but)[, ]+)*(?:where|when|how (?:long|much|high|far|soon)|what)\b[^.?!]{0,60}\b(?:end up|hit|reach|get (?:us |it )?to|cross|doubles?|triples?|break even|land|be at|compound(?:s|ing)?)\b|^(?:(?:ok(?:ay)?|so|and|but)[, ]+)*what(?:'s| is) the (?:number|value|total|figure|amount) (?:at|in|for|after|by) (?:month|year|quarter|week|period|the end)\b/;
// A question ABOUT a number is not a change to it: "where did the 5% come from?".
const ASKS_ABOUT_RE = /^(?:(?:ok(?:ay)?|so|and|but|wait)[, ]+)*(?:where|why|is|are|was|were|(?:does|did) (?:it|this|that|we|you|they|i|the|a|an|our|your)\b|do (?:we|you|they|i|the|a|an|our|your)\b|how come|which|who)\b|\b(?:come from|mean|realistic|net or gross|include[sd]?)\b/;

const GENERIC_PART_RE = /^(?:databases?|dbs?|queues?|caches?|services?|servers?|gateways?|workers?|stores?|apis?|clients?|apps?|brokers?|balancers?|prox(?:y|ies)|buckets?|clusters?|nodes?|tables?|orders?|payments?|users?|customers?|accounts?|emails?|messages?|notifications?|events?|requests?|jobs?|tasks?|files?|images?|videos?|sessions?|tokens?|keys?|logs?|metrics?|search|index(?:es)?|storage|auth|billing|analytics|web|mobile|days?|weeks?|months?|quarters?|years?|growth|plans?|rates?|costs?|revenue|sales|budget|price|prices)$/;

const TIME_UNIT_RE = /^(?:days?|weeks?|months?|quarters?|years?|hours?|minutes?)$/;

/** Is one of the artifact's own words the direct object of a verb that changes structure? */
function editsComponent(q, vocab) {
  for (const m of q.matchAll(/\b(?:replace|swap|remove|drop|delete|rename|take out|get rid of|scale|shard|cache|secure|split|merge|move|duplicate|replicate)\s+(?:(?:the|a|an|our|that|this)\s+)?([a-z0-9]+)(?:\s+([a-z0-9]+))?/g)) {
    for (const word of [m[1], m[2]]) {
      if (word && word.length >= 3 && (vocab.has(word) || vocab.has(`${word}s`) || (word.endsWith('s') && vocab.has(word.slice(0, -1))))) return true;
    }
  }
  return false;
}

/** Does the sentence name a subject of its own — something that is not the artifact on the table? */
function namesAnotherSubject(q, vocab) {
  for (const word of q.split(/[^a-z0-9]+/)) {
    if (word.length < 3 || VIEW_WORDS.has(word)) continue;
    if (vocab.has(word) || (word.endsWith('s') && vocab.has(word.slice(0, -1))) || vocab.has(`${word}s`)) continue;
    return true;
  }
  return false;
}

/**
 * Does the question point at the design on the table?
 *  - by naming it ("the diagram", "this design") or one of its components — always;
 *  - by a bare pronoun ("this", "it") — only while the design is what the
 *    conversation is on. Once something else has been answered
 *    (`foreground: false`), "why is this O(n)?" is about that.
 */
export function refersToDesign(question, activeDesign) {
  if (!activeDesign || !activeDesign.source) return false;
  const q = normalise(question);
  if (namesTheDesign(q, activeDesign.view)) return true;
  if (activeDesign.foreground !== false && PRONOUN_RE.test(q)) return true;
  return namesComponent(q, designVocabulary(activeDesign.source));
}

// ── basis ───────────────────────────────────────────────────────────────────

// The thing to draw is what was SAID: "the system we discussed", "what we
// agreed". Not "design a URL shortener. We discussed scale earlier."
const MEETING_BASIS_RE =
  /\b(?:that|which|what|the [\w-]+(?: [\w-]+)?) (?:we|they|you all|everyone|the team)(?: have| had|'ve)? (?:just |already )?(?:discussed|described|talked about|agreed(?: on)?|decided(?: on)?|went over|covered|outlined|proposed)\b|\bfrom (?:this|the|today'?s) (?:meeting|call|conversation|discussion|session)\b|\bwhat (?:was|we|they) (?:said|discussed|described|agreed)\b|\bas discussed\b/;
// The thing to draw EXISTS: "our current architecture", "from the doc". Not
// "a real-time chat system" and not "an API for our actual customers".
const SOURCE_BASIS_RE =
  /\b(?:our|my|the|their|your|natively'?s) (?:actual|current|existing|as[- ]is|present|real(?![- ]time))\b(?: \w+){0,2} (?:architecture|system|design|setup|infrastructure|flow|pipeline|stack)\b|\b(?:actual|current|existing) (?:architecture|system design|setup|infrastructure|stack)\b|\b(?:from|based on|according to|in|on|using) (?:the|this|that|my|our|their) (?:docs?|documents?|files?|spec|screenshot|screen|page|code(?:base)?|repo(?:sitory)?|readme|slides?|deck|attachment|papers?|article|study|lecture|notes|report|figure|dataset|spreadsheet|export|runbook|manual|r[eé]sum[eé]|cv|job description)(?![a-z0-9])/;

const VISUAL_REFERENCE_RE =
  /\b(?:this|that|these|here|shown|above|on (?:the|my) screen|in (?:the|this) (?:image|picture|screenshot|photo|whiteboard|slide))\b/;

/** @returns {DiagramBasis} */
function detectBasis(q) {
  if (MEETING_BASIS_RE.test(q)) return 'meeting-reconstruction';
  if (SOURCE_BASIS_RE.test(q)) return 'source-reconstruction';
  return 'proposed-design';
}

// ── the resolver ────────────────────────────────────────────────────────────

/**
 * @param {{
 *   question?: string | null,
 *   answerType?: string | null,
 *   questionTypes?: readonly string[] | null,
 *   activeDesign?: { artifactId?: string, view?: string, source?: string } | null,
 *   featureEnabled?: boolean,
 *   userInstructions?: string | null,
 *   forceDesign?: boolean,
 *   hasVisualContext?: boolean,
 *   mode?: string | null,
 *   material?: string | null,
 * }} input  `material` is what was said in the conversation so far, when the
 *   caller can supply it (see visualInputStatus). `mode` is the resolved built-in template ('sales', 'call-center', …),
 *   'custom', or absent/unknown. Unknown keeps the pre-catalog behaviour: only
 *   an explicit request draws.
 * @returns {DiagramRequest}
 */
export function resolveDiagramRequest(input = {}) {
  const whole = resolveCore(input);
  if (!whole.enabled && (whole.reason === 'unrelated_turn' || whole.reason === 'not_a_diagram_turn')) {
    const heard = resolveBySentence(input);
    if (heard) return describeVisual(heard.request, { ...input, question: heard.sentence });
    // The rules above read English. Said in Spanish, Russian, Chinese or
    // Japanese, a request is read by a much smaller set of rules of its own —
    // only here, where the English ones found nothing, so nothing they decide
    // can change because of it.
    const other = resolveOtherLanguageRequest(input);
    if (other) return describeVisual(other, input);
    // Neither set of rules could place it, and in those four languages the
    // rules miss about one real request in three (measured on blind sets; see
    // docs/diagrams/README.md). Where a drawing is plausibly in play the turn
    // is left UNDECIDED: still not a diagram turn for anything that routes,
    // validates or remembers — `enabled` stays false — but it carries the
    // request it would be, and the contract built from that asks the model
    // that answers to say which it is. A standing "no diagrams" holds.
    const instructions = normalise(input.userInstructions);
    const would = instructions && (NO_DIAGRAM_RE.test(instructions) || saysNoDrawing(input.userInstructions)) ? null : undecidedOtherLanguageTurn(input);
    if (would) {
      const described = describeVisual(would, input);
      return { ...describeVisual(whole, input), reason: 'undecided', language: described.language, attachActiveDesign: described.attachActiveDesign === true, undecided: described };
    }
  } else if (whole.enabled && !whole.parentArtifactId && whole.operation === 'create' && input.activeDesign && input.activeDesign.source) {
    // "Nice. Now show me the same thing as a sequence diagram.": the turn as a
    // whole reads as a fresh drawing; the sentence that asks reads as a view of
    // the design on the table.
    const heard = resolveBySentence(input);
    if (heard && heard.request.parentArtifactId && heard.request.operation === 'create') return describeVisual(heard.request, { ...input, question: heard.sentence });
  }
  return describeVisual(whole, input);
}

const SENTENCE_SPLIT_RE = /(?<=[.?!])\s+(?=["'“‘(]?[A-Za-z])/;
const MAX_SENTENCES = 6;

/**
 * "Okay, that makes sense. Add a cache in front of the store." "Sorry, my dog
 * is barking. Why do we need the queue at all?" The rules read a turn from its
 * first word, and a personal remark anywhere marks the whole turn — right for
 * one sentence, wrong for several. So when the turn as a whole asks for
 * nothing, each of its sentences is heard as if it had been said alone.
 *
 * A follow-up that names nothing ("make it 5%") is taken only when nothing but
 * an acknowledgement stands before it ("Okay I see it. …", "Right. …"): after
 * "Sarah is on leave until the 12th." or "My shift moved again.", "it" has
 * something else to mean.
 */
const ACK_RE = /^(?:ok(?:ay)?|right|sure|yes|yeah|yep|yup|got it|i see|makes sense|that makes sense|good|great|fine|nice|perfect|cool|hm+|alright|all right|interesting|thanks|thank you|looks (?:good|fine|great)|fair enough|understood|so|now|well|hold on|one sec(?:ond)?|wait)\b/;
const isAcknowledgement = (sentence) => {
  const q = normalise(sentence);
  return q.split(/\s+/).length <= 6 && ACK_RE.test(q);
};
function resolveBySentence(input) {
  const raw = String(input.question ?? '');
  if (raw.length > MAX_QUESTION_CHARS * 2) return null;
  const all = raw.split(SENTENCE_SPLIT_RE).map((s) => s.trim()).filter(Boolean);
  if (all.length < 2) return null;
  const from = Math.max(0, all.length - MAX_SENTENCES);
  for (let i = from; i < all.length; i += 1) {
    // ("Hmm." and "Right." say nothing to decide on.)
    if (!/\w+\W+\w+/.test(all[i])) continue;
    const request = resolveCore({ ...input, question: all[i] });
    if (!request.enabled) continue;
    const weakFollowUp = Boolean(request.parentArtifactId) && request.followUp !== 'strong';
    // What stands right before it: nothing, a one-word "Okay.", or an
    // acknowledgement — otherwise "it" has something else to mean.
    const before = i > 0 ? all[i - 1] : '';
    if (weakFollowUp && before && /\w+\W+\w+/.test(before) && !isAcknowledgement(before)) continue;
    return { request, sentence: all[i] };
  }
  return null;
}

/** What a chart payload already on the table is, read from its own source. */
export function chartIntentOfSource(source) {
  const text = String(source ?? '');
  if (/"kind"\s*:\s*"(?:compound_growth|growth_with_churn)"/.test(text)) return 'forecast';
  if (/"kind"\s*:\s*"(?:break_even|cumulative_net)"/.test(text)) return 'breakeven';
  if (/"kind"\s*:\s*"function"/.test(text)) return 'function';
  if (/"type"\s*:\s*"funnel"/.test(text)) return 'funnel';
  if (/"type"\s*:\s*"quadrant"/.test(text)) return 'quadrant';
  return 'generic';
}

/** The mode a custom mode behaves as for visuals: it is built on the General template. */
const relevanceMode = (mode) => (mode === 'custom' ? 'general' : mode);

/** Add the visual descriptor (mode, intent, basis for data, required inputs) to a resolved request. */
function describeVisual(request, input) {
  const mode = normaliseVisualMode(input.mode);
  if (!request.enabled) return { ...request, mode };
  const q = normalise(input.question);
  const task = detectVisualTask(q);
  const active = input.activeDesign && input.activeDesign.source ? input.activeDesign : null;
  const out = { ...request, mode };
  // A flowchart drawn fresh may be asked for in lanes or as a tree.
  if (request.view === 'flowchart' && request.operation === 'create') {
    const layout = request.layout || layoutOf(q);
    if (layout) out.layout = layout;
  } else if (request.operation === 'update' && active && (request.view === 'flowchart' || request.view === 'architecture')) {
    // An edit of a swimlane diagram is still one ("add a finance lane" was
    // answered with rules that have no lanes). What it was asked for as is in
    // the question that made it — its source cannot say: lanes are `subgraph`s,
    // and so are the groups of an architecture diagram, which is also what a
    // left-to-right flowchart is stored as. A process flowchart with two
    // subgraphs is read as lanes without being told.
    const madeAs = layoutAskedFor(active.question);
    const lanesInSource = request.view === 'flowchart' && /(?:^|\n)\s*subgraph\b[\s\S]*\n\s*subgraph\b/.test(String(active.source ?? ''));
    const layout = madeAs || (lanesInSource ? 'lanes' : null);
    if (layout) {
      out.view = 'flowchart';
      out.layout = layout;
    }
  }
  let chartIntent;
  if (request.view === 'chart') {
    // A follow-up keeps the kind of chart it is a follow-up ON, unless it names another.
    const parentIsChart = Boolean(request.parentArtifactId) && Boolean(active) && familyOfView(active.view) === 'chart';
    const inherited = parentIsChart ? chartIntentOfSource(active.source) : 'generic';
    // "Make it a bar chart" names a SHAPE, not another calculation: a forecast
    // drawn as bars is still that forecast, on the same stated inputs.
    const named = task && task.view === 'chart' ? task.chartIntent : request.chartIntent || 'generic';
    const namesAnotherCalculation = named !== 'generic' && named !== 'trend' && named !== 'breakdown' && named !== 'comparison';
    chartIntent = parentIsChart && inherited !== 'generic' && !namesAnotherCalculation ? inherited : named !== 'generic' ? named : inherited;
    out.chartIntent = chartIntent;
    // (Which inputs a sentence states is read in English only: for a request
    // in another language nothing is called missing, and the model decides.)
    const inputs = request.language ? null : visualInputStatus(q, chartIntent, input.material);
    if (inputs && request.operation === 'create' && !request.parentArtifactId) {
      out.inputs = inputs;
      // Stated nowhere the app can see: the model is told so, and gets no
      // reference whose numbers it could borrow (see diagramContract).
      if (inputs.missing && inputs.missing.length > 0 && !HYPOTHETICAL_RE.test(q)) out.missingInput = inputs.missing[0];
    }
    // What the numbers are: a made-up example, a model run on stated inputs,
    // or data that has to come from the conversation or its evidence.
    // "Show me a hypothetical forecast" asks for an example, inputs and all;
    // "assume revenue is $10,000 and show 5% growth" is a scenario on stated inputs.
    const calc = chartIntent === 'forecast' || chartIntent === 'breakeven';
    const statesItsInputs = calc && inputs && inputs.inRequest.length >= (chartIntent === 'forecast' ? 2 : 1);
    if (HYPOTHETICAL_RE.test(q) && (!calc || !statesItsInputs)) out.basis = 'illustrative';
    else if (calc) out.basis = 'scenario';
    else if (chartIntent === 'function') out.basis = 'calculated';
    else if (request.basis === 'proposed-design') out.basis = 'observed-data';
  } else if (HYPOTHETICAL_RE.test(q) && request.basis === 'proposed-design' && !LEGACY_VIEWS.has(request.view)) {
    out.basis = 'illustrative';
  } else if (request.basis === 'proposed-design' && EVIDENCE_VIEWS.has(request.view) && (EVIDENCE_MODES.has(mode) || SPECIFIC_SUBJECT_RE.test(q))) {
    // A career timeline, an evidence table, who blocks whom, who owns what:
    // about these people and this work, such a visual shows what IS, and a
    // model has nothing to propose. With no facts to draw from, the right
    // output is no drawing. (A timeline of the French Revolution in a lecture
    // names no one here, so it stays general knowledge.)
    out.basis = 'evidence';
  }
  out.intent =
    request.operation === 'update' ? 'update'
    : request.operation === 'explain' || request.operation === 'refine' ? 'explain'
    : chartIntent === 'forecast' ? 'forecast'
    : chartIntent === 'breakeven' || chartIntent === 'function' || chartIntent === 'funnel' ? 'calculate'
    : request.view === 'matrix' || chartIntent === 'comparison' || /\bcompar(?:e|ing|ison)\b/.test(q) ? 'compare'
    : out.basis === 'meeting-reconstruction' || out.basis === 'source-reconstruction' || out.basis === 'evidence' ? 'reconstruct'
    : out.basis === 'proposed-design' && (request.view === 'architecture' || request.view === 'class' || request.view === 'er' || request.view === 'sequence') ? 'propose'
    : 'explain';
  return out;
}

const LEGACY_VIEWS = new Set(['architecture', 'sequence', 'flowchart', 'state']);
/** Views that, about the people and work in the conversation, state facts. */
const EVIDENCE_VIEWS = new Set(['timeline', 'gantt', 'matrix', 'dependency', 'responsibility']);
/** Modes whose conversations are about specific people, deals, cases and work. */
const EVIDENCE_MODES = new Set(['sales', 'recruiting', 'team-meet', 'call-center', 'looking-for-work']);
const SPECIFIC_SUBJECT_RE = /\b(?:my|our|their|his|her|this|these|those)\b|\bthe (?:candidate|customer|client|buyer|prospect|team|project|deal|account|role|speaker|author|caller)\b/;

/** Mermaid, chart or notation: an edit of one is never an edit of another. */
function familyOfView(view) {
  if (view === 'chart') return 'chart';
  if (view === 'chen' || view === 'automaton') return 'notation';
  if (view === 'matrix') return 'table';
  return 'mermaid';
}

function resolveCore(input) {
  if (input.featureEnabled === false) return disabled('feature_off');
  const q = normalise(input.question);
  const instructions = normalise(input.userInstructions);
  const active = input.activeDesign && input.activeDesign.source ? input.activeDesign : null;
  const answerType = input.answerType || null;
  const types = Array.isArray(input.questionTypes) ? input.questionTypes : [];

  if (!q && !input.forceDesign) return disabled('empty');

  const codingRoute = CODING_ANSWER_TYPES.has(answerType || '') || types.includes('CODING_TASK');
  const wantsCode = CODE_VERB_RE.test(q.replace(/\b(?:diagram|chart|model|view) (?:that|which) (?:would |will |could |should )?implements?\b/g, ' '));
  const request = analyseRequest(q, { coding: codingRoute || wantsCode });
  // "What is an ER diagram?" asks what one is. "What is the ER diagram for a
  // library system?" asks for one.
  const aboutDiagrams = ABOUT_DIAGRAMS_RE.test(q) && !request.drawVerb && !request.asQuestion;
  const conceptQuestion = CONCEPT_QUESTION_RE.test(q) && !STRUCTURE_QUESTION_RE.test(q) && !request.drawVerb && !request.asQuestion;
  const experience = EXPERIENCE_RE.test(q);
  // Asked for in this turn, in so many words. Outranks a soft "just explain"
  // and the user's standing instructions; an outright "no diagram" outranks it.
  const asksForDrawing = !aboutDiagrams && !experience && (request.diagram || (Boolean(request.catalog) && !conceptQuestion));
  const saysNoDiagram =
    NO_DIAGRAM_RE.test(q) || (!asksForDrawing && (WORDS_ONLY_RE.test(q) || (instructions ? NO_DIAGRAM_RE.test(instructions) : false)));
  const explicit = asksForDrawing && !saysNoDiagram && request.diagram;
  const designAsk = input.forceDesign === true || isDesignAsk(q, answerType, codingRoute);
  let basis = detectBasis(q);
  // "Draw this" / "diagram what's here" over a screenshot or captured page: the
  // picture is the source, so draw what it shows rather than inventing a design.
  if (input.hasVisualContext === true && basis === 'proposed-design' && VISUAL_REFERENCE_RE.test(q)) {
    basis = 'source-reconstruction';
  }
  // "Design a …" proposes; it never reconstructs, whatever else the sentence mentions.
  const saysDesignAsk = input.forceDesign === true || (saysDesign(q) && (!codingRoute || codingDesignIsASystem(q)));
  if (saysDesignAsk && basis !== 'proposed-design' && !DESIGN_OF_ACTIVE_RE.test(q) && !/\b(?:our|my|the|their) (?:actual|current|existing)\b/.test(q)) basis = 'proposed-design';

  const withCodeAsk = codingRoute || wantsCode;
  /** @type {DiagramOutput} */
  let output = 'text-and-diagram';
  if (saysNoDiagram) output = 'text-only';
  else if (SOURCE_ONLY_RE.test(q)) output = 'source-only';
  else if (DIAGRAM_ONLY_RE.test(q)) output = 'diagram-only';
  // "Only the diagram" and "and the code" cannot both hold: the code is asked
  // for in so many words, so it is given.
  if (wantsCode && (output === 'source-only' || output === 'diagram-only')) output = 'text-and-diagram';

  let viewCue = detectDiagramView(q);
  const parent = active?.artifactId;

  // ── the wider catalog ────────────────────────────────────────────────────
  const mode = normaliseVisualMode(input.mode);
  const asked = request.catalog && !aboutDiagrams && !experience && (!conceptQuestion || request.drawVerb) && (request.drawVerb || !DEFER_RE.test(q)) ? request.catalog : null;
  const activeIsModel = Boolean(active) && active.foreground !== false && (active.view === 'er' || active.view === 'class' || active.view === 'chen');
  const entityTable = activeIsModel && Boolean(asked) && asked.view === 'matrix'
    && /\b(?:the|this|that|every|each|all|our|a|an) [\w-]+ tables?\b/.test(q) && !/\b(?:comparison|evidence|coverage|skills?|requirements?) (?:matrix|table)\b|\b(?:in|as|into) an? (?:\w+ )?table\b|\btables? (?:of|comparing)\b/.test(q);
  const visualExplicit = Boolean(asked) && !saysNoDiagram && !entityTable;
  // ("The owner table" then names an entity: it is no cue for a table view.)
  if (entityTable && viewCue === 'matrix') viewCue = null;
  // Not asked for, but the task implies it and this mode makes it relevant.
  // Only a TASK implies a visual, only in a question or a request, never in a
  // coding question and never when the answer was asked to be short. In
  // Looking for work, a line addressed to "you" is the interviewer speaking:
  // the answer to that is said aloud, not drawn.
  const implied = visualExplicit ? null : detectVisualTask(q);
  const visualContextual =
    Boolean(implied) && implied.implied && !saysNoDiagram && !aboutDiagrams && !conceptQuestion && !experience
    && !codingRoute && !wantsCode && !BREVITY_RE.test(q) && !DEFER_RE.test(q) && isAsk(q)
    && !YES_NO_RE.test(q) && !PAST_RE.test(q) && !SECOND_PERSON_RE.test(q) && !/\byou\b/.test(q) && !ABOUT_THE_THING_RE.test(q)
    && modeSuggestsVisual(relevanceMode(mode), implied.view);
  const task = visualExplicit ? asked : visualContextual && !entityTable ? implied : null;
  // A design ask keeps its system-design view unless it NAMES another one
  // ("design the objects for …" is a class diagram, "design … with
  // dependencies" is still an architecture).
  const whole = detectVisualTask(q);
  const designViewCue = whole && (whole.named || whole.view === 'class' || whole.view === 'er')
    ? whole.view
    : VIEW_STATE_RE.test(q) ? 'state' : VIEW_SEQUENCE_RE.test(q) ? 'sequence' : VIEW_FLOWCHART_RE.test(q) ? 'flowchart' : VIEW_ARCHITECTURE_RE.test(q) ? 'architecture' : null;

  // ── a follow-up on the artifact on the table ─────────────────────────────
  const family = active ? familyOfView(active.view) : null;
  /** The sentence without its lead-in ("okay so can we just …"): where an edit verb stands. */
  const lead = stripLeadIn(q);
  // The router called this turn a system design without the words of a fresh
  // ask: with a design on the table, that is a turn ABOUT it — it counts as in
  // focus, and never restarts the design (see step 1).
  const routeOnlyDesign = answerType === 'system_design_answer' && !saysDesignAsk && Boolean(active) && family === 'mermaid';
  const fg = Boolean(active) && (active.foreground !== false || routeOnlyDesign);
  const vocab = active ? designVocabulary(active.source) : new Set();
  const namesIt = Boolean(active) && namesTheDesign(q, active.view, vocab);
  // In focus any mention of a component word counts; out of focus only a
  // DEFINITE one does ("the queue", "Stripe" — not "add a cache", which asks
  // for a new one and is said of anything).
  const namesPart = Boolean(active) && namesComponent(q, vocab, { definite: !fg });
  // ("What is an API gateway?" once the conversation has moved on asks about
  // API gateways, not about the one in the design.)
  const namesPhrase = Boolean(active) && (namesLabel(q, designLabels(active.source)) || namesLane(q, active.source))
    && !(active.foreground === false && /^(?:(?:ok(?:ay)?|so|and|but|wait)[, ]+)*what(?:'s| is| are) (?:an? |meant by )/.test(q));
  const namesValue = family === 'chart' && namesChartValue(q, active.source);
  const pronoun = PRONOUN_RE.test(q
    .replace(/\b(?:the|a|an|any|every|which|what|one) [\w-]+ that\b/g, ' ')
    // "If it rains on the day", "it's getting late": the "it" of weather and
    // time stands for nothing.
    .replace(/\bit(?:'s| is| was)? (?:rains?|snows?|pours|raining|snowing|pouring|getting (?:late|dark|cold|hot)|(?:too )?(?:late|early|sunny|cloudy|windy|freezing))\b/g, ' ')
    // "This week", "that time", "these days": a time, not the artifact.
    .replace(/\b(?:this|that|these|those) (?:week|weekend|month|year|quarter|morning|afternoon|evening|time|sprint|days?|monday|tuesday|wednesday|thursday|friday)\b/g, ' '));
  // "The system" is the design only while the design is what is being talked
  // about; so is "here" ("what are the foreign keys here?").
  const pronounLike = pronoun || /\bhere\b/.test(q) || (family === 'mermaid' && /\b(?:the|our) system\b/.test(q));
  const modelView = Boolean(active) && (active.view === 'er' || active.view === 'class' || active.view === 'chen');
  // A system or a model: the kinds of artifact that "how does this work?" is asked of.
  const designLike = Boolean(active) && (LEGACY_VIEWS.has(active.view) || modelView || active.view === 'decision' || active.view === 'automaton');
  // A sentence that NAMES the artifact may get to the point after it: "in the
  // diagram, why do we need the queue?", "go back to the architecture and add
  // a cache", "the diagram from before, make it more detailed". Its clauses are
  // each read as the start of a sentence. (Only then: for a sentence that names
  // nothing, an edit verb in the middle is just a verb.)
  const namedSomehow = namesIt || namesPhrase;
  const clauses = namedSomehow
    ? q.split(/\s*[,:;]\s+|\s+[—–-]\s+|(?<=\b(?:on|in|to|for) the (?:diagram|architecture|design|chart|drawing|schema|model))\s+|\s+(?:and|then|but|so)\s+|\s+(?=(?:can|could|would|will) (?:you|we)\b|please\b|let'?s\b|(?:is|are|was|does|do) (?:that|this|it|those|these|they)\b)/).map(stripLeadIn).filter(Boolean)
    : [lead];
  const anyClause = (re) => clauses.some((c) => re.test(c));
  const term = POINTED_PART_RE.test(q)
    || (family === 'chart'
      ? CHART_TERM_RE.test(q) && !foreignRate(q, vocab)
      : DESIGN_TERM_RE.test(q) || anyClause(STRUCTURAL_EDIT_RE) || (modelView && MODEL_TERM_RE.test(q)) || (namesPart && DATAFLOW_RE.test(q))
        || (modelView && namesPart && CARDINALITY_RE.test(q)));
  const isQuestion = QUESTION_LEAD_RE.test(q) || EXPLAIN_IMPERATIVE_RE.test(q) || (namedSomehow && (anyClause(QUESTION_LEAD_RE) || anyClause(EXPLAIN_IMPERATIVE_RE)));
  // "Can this handle a spike on Black Friday?", "how does this scale to ten
  // million users?": asked of the design itself, by a pronoun.
  const capability = designLike && CAPABILITY_RE.test(q);
  // A why / which / how / is-it question asks; it does not edit, whatever
  // words of an edit it holds ("why does it write to the queue instead of
  // calling the service?", "which fields should be unique?").
  const asksNotEdits = ASKS_NOT_EDITS_RE.test(lead);
  const scheduleView = Boolean(active) && (active.view === 'gantt' || active.view === 'timeline');
  const scheduleStructural = scheduleView && (SCHEDULE_STRUCTURAL_RE.test(lead)
    || (SCHEDULE_EDIT_RE.test(lead) && /\b(?:everything|it all|all (?:of it|the tasks|tasks)|the whole (?:plan|thing|schedule|project))\b/.test(lead)));
  const editVerb = anyClause(UPDATE_RE) || (UPDATE_PHRASE_RE.test(q) && !asksNotEdits) || capability || (scheduleView && anyClause(SCHEDULE_EDIT_RE));
  const explainForm = WHY_HOW_RE.test(q) || EXPLAIN_IMPERATIVE_RE.test(q) || (namedSomehow && (anyClause(WHY_HOW_RE) || anyClause(EXPLAIN_IMPERATIVE_RE)));
  // A sentence about a person or a calendar is not about the design, however
  // many pronouns it holds.
  // …and so is a question about what was SAID: "what did John say about the
  // API gateway?", "what did we decide about the cache?", "who mentioned
  // Postgres?". Its answer is in the meeting's record, whatever part of the
  // design it mentions — unless it names the drawing itself.
  const personal = isPersonal(q) || (MEETING_RECALL_RE.test(q) && !namesIt);
  // STRONG: the sentence names the artifact — as what it is ("the diagram"),
  // by one of its own multi-word names ("the notification queue"), by a value
  // it holds ("is 5% realistic?"), or by one of its component words together
  // with something that shows the component is meant as a component: a word a
  // design is discussed in, an edit, or a question that asks how or why.
  // One common word is not enough: "when is the payment due?", "did the email
  // go out?".
  const partInContext = namesPart
    && (term || editVerb || explainForm || VIEW_OF_DESIGN_RE.test(q) || QUALITY_RE.test(q))
    // In a coding question a component word is usually a variable ("handle the
    // case where the order is empty", "use a queue instead of recursion"): it
    // is the component only with a design word beside it, or as the thing a
    // structural verb acts on ("replace Stripe with Adyen").
    && !(codingRoute && (ALGORITHM_TALK_RE.test(q) || !(term || editsComponent(q, vocab))));
  // An edit whose own object is something else is not an edit of the design,
  // whatever word or name of the design the sentence also holds: "remove the
  // HOLD music", "put the caller ON HOLD", "I need a COPY of the signed
  // contract", "add a step to the onboarding checklist".
  const editElsewhere = editVerb && !explainForm && !capability && (editGoesElsewhere(lead, vocab)
    // (A lane of the diagram, called one, is the diagram's: "rename the
    // Customer swimlane to Client".)
    || (editsSomethingElse(lead, vocab, active ? designLabels(active.source) : null) && !(active && namesLane(q, active.source)) && !anyClause(STRUCTURAL_EDIT_RE) && !scheduleStructural && !(modelView && MODEL_TERM_RE.test(q))));
  const strong = namesIt || namesValue
    || (((namesPhrase || partInContext) && !editElsewhere) && !personal && !(codingRoute && ALGORITHM_TALK_RE.test(q)));
  // WEAK: nothing names the artifact, but it is what the conversation is on,
  // and the sentence is of a kind that is said about a design.
  const weakOk = fg && !personal && !(codingRoute && (!term || ALGORITHM_TALK_RE.test(q)));
  const refers = strong || (fg && pronoun);
  // A view cue of another kind of artifact is a fresh request, never an edit:
  // "add a forecast" does not turn an architecture into a chart.
  const sameFamily = !viewCue || !active || familyOfView(viewCue) === family;
  // With a chart on the table, a new rate or horizon redraws it: "and at 8%?",
  // "what would it look like at 8% monthly growth?", "start from 25,000".
  const changeClause = clauses.find((c) => CHART_CHANGE_RE.test(c));
  const chartChange = family === 'chart' && (weakOk || (namesIt && !personal)) && !codingRoute
    && ((changeClause !== undefined && !editsSomethingElse(changeClause, vocab)) || (CHART_LOOKS_AT_RE.test(q) && !editsSomethingElse(lead, vocab)))
    && !ASKS_ABOUT_RE.test(q);
  // "Draw it again with a cache": the same drawing with a change.
  const redrawUpdate = Boolean(active) && sameFamily && fg && !personal && REDRAW_WITH_RE.test(q);
  // An edit: of something named (strong), or — in focus — said in a word a
  // design is changed in ("add a cache", "make it multi-region"), or done to
  // the drawing itself ("simplify it"), or asked of it ("can this handle a
  // spike?"). "Move it to Thursday", "make it quick" and "add that to the
  // notes" are none of these; neither is an edit of something else ("extend
  // the trial by two weeks", "scale back your hours").
  const artifactVerb = ARTIFACT_VERB_RE.test(lead);
  const weakEdit = weakOk && ((!editsSomethingElse(lead, vocab) && ((editVerb && term) || artifactVerb)) || capability || scheduleStructural);
  const updateAsk = Boolean(active) && sameFamily && !refineLike(q)
    // ("Can you add a line to the minutes about the budget? The architecture
    // can wait." names the design, and edits the minutes.)
    && ((editVerb && strong && !(namesIt && editGoesElsewhere(clauses.find((c) => UPDATE_RE.test(c)) || lead, vocab))) || weakEdit || chartChange || redrawUpdate);
  const anotherSubject = Boolean(active) && namesAnotherSubject(q, vocab);
  // "Show the write path only", "zoom in on the payment service", "now the
  // deployment view".
  const viewWords = VIEW_OF_DESIGN_RE.test(q) || VIEW_FRAGMENT_RE.test(q);
  const showAgain = namesIt && /\b(?:bring|pull|put)\b[^.?!]*\b(?:back|up)\b|\bshow\b[^.?!]*\bagain\b/.test(q);
  const viewAsk = Boolean(active) && sameFamily && !isQuestion && !personal
    && ((viewWords && (strong || (fg && (!anotherSubject || VIEW_FRAGMENT_RE.test(q))))) || showAgain);
  // A question: about something named (strong), or — in focus — one that asks
  // how or why of "this", one in a word a design is discussed in, or one of the
  // things that are asked of a design with no pronoun at all ("where's the
  // bottleneck?", "explain the write path", "where do we end up after a
  // year?"). Not a yes-or-no about how things stand ("does that work for
  // everyone?"), and not the same words said of something else ("where's the
  // bottleneck in our hiring process?").
  const questionTerm = (family === 'chart'
    ? (CHART_QUESTION_TERM_RE.test(q) || CHART_OUTCOME_QUESTION_RE.test(q)) && !foreignRate(q, vocab)
    : family === 'mermaid' && (DESIGN_QUESTION_TERM_RE.test(q) || (EXPLAIN_IMPERATIVE_RE.test(q) && (VIEW_OF_DESIGN_PART_RE.test(q) || ORDINAL_PART_RE.test(q))) || (active.view === 'sequence' && (SEQUENCE_QUESTION_RE.test(lead) || asksWhoSends(lead, vocab))) || (scheduleView && (SCHEDULE_QUESTION_RE.test(q) || (SCHEDULE_WHEN_RE.test(q) && (namesPart || /\b(?:section|task|phase|milestone)\b/.test(q))))) || (active.view === 'state' && (STATE_QUESTION_RE.test(q) || asksStateMove(q, vocab) || asksAboutAState(q, vocab))) || (WHERE_PUT_RE.test(q) && (term || (modelView && /\b(?:store|keep|put)\b/.test(q))))))
    && !asksAboutSomethingElse(q, vocab);
  const explainAsk = Boolean(active) && isQuestion && !chartChange && !capability
    && (strong
      || (weakOk && designLike && CAPABILITY_QUESTION_RE.test(q))
      // ("How does that work with our CRM?" over a chart or a timeline is about the product.)
      || (weakOk && pronounLike && (term || QUALITY_RE.test(q) || EXPLAIN_IMPERATIVE_RE.test(q) || (designLike && WHY_HOW_RE.test(q) && EXPLAIN_HINT_RE.test(q))
        // (Not "why does it slow down when I open the laptop?".)
        || (family === 'chart' && WHY_HOW_RE.test(q) && CHART_SHAPE_RE.test(q) && !/\b(?:when|whenever|if|after|every time) (?:i|we|you)\b/.test(q))))
      || (weakOk && ELLIPTICAL_WHY_RE.test(q) && (term || namesPart) && !asksAboutSomethingElse(q, vocab))
      || (weakOk && questionTerm));
  const refineAsk = fg && REFINE_PROSE_RE.test(lead) && !/\b(?:diagram|design|architecture|chart)\b/.test(q);
  // An explicit drawing request that is about the artifact on the table:
  // "draw this again", "show that as a sequence diagram", "turn it into a
  // sequence diagram", "illustrate how the cache works", "draw the sequence
  // for placing an order" — and not "draw a diagram of how DNS works".
  const pronounObject = PRONOUN_OBJECT_RE.test(q) || OF_THIS_RE.test(q) || OF_ITS_PARTS_RE.test(q) || (family === 'chart' && CHART_DATA_OBJECT_RE.test(q));
  const derived = Boolean(active) && explicit && !personal
    && (strong || (fg && (pronounObject || namesPart || ((pronoun || VIEW_OF_DESIGN_RE.test(q)) && !anotherSubject)
      || (LEGACY_VIEWS.has(active.view) && VIEW_FOR_ACTIVITY_RE.test(q) && !NAMES_A_SYSTEM_RE.test(q)))));
  const followUpWords = updateAsk || viewAsk || explainAsk || refineAsk || derived;
  const followUp = strong ? 'strong' : 'weak';
  // "Change the diagram to use two workers": an edit of the artifact, named as
  // such — not a request for a new drawing because the word "diagram" is in it.
  const plainEdit = updateAsk && namesIt && anyClause(UPDATE_RE) && !VIEW_CHANGE_RE.test(q)
    && (!request.drawVerb || (term && anyClause(/^(?:re-?draw|redo|rework)\b/)));

  // 1. A design ask that names its own subject starts a fresh design, whatever
  //    is on the table. One that only points at the current design updates it.
  //    (The router can call a follow-up "system design": that verdict alone
  //    must not restart the design — only the WORDS of a fresh ask do.)
  if (routeOnlyDesign && !followUpWords && !request.catalog) {
    // Nothing in the words says "fresh design" and nothing names another
    // subject: the planner's verdict is about the design on the table.
    return {
      enabled: true,
      view: /** @type {DiagramView} */ (active.view) || 'architecture',
      operation: saysNoDiagram || isQuestion ? 'explain' : 'update',
      output: saysNoDiagram || isQuestion ? 'text-only' : output,
      basis: 'proposed-design',
      parentArtifactId: parent,
      withCode: withCodeAsk,
      explicit: false,
      attachActiveDesign: true,
      followUp: 'weak',
      reason: isQuestion ? 'explain_design' : 'update_design',
    };
  }
  if (designAsk && !routeOnlyDesign && (saysDesignAsk || !followUpWords)) {
    const pointsAtActive = active && DESIGN_OF_ACTIVE_RE.test(q);
    if (pointsAtActive) {
      return {
        enabled: true,
        view: designViewCue || /** @type {DiagramView} */ (active.view) || 'architecture',
        operation: saysNoDiagram ? 'explain' : 'update',
        output,
        basis,
        parentArtifactId: parent,
        withCode: withCodeAsk,
        explicit,
        attachActiveDesign: true,
        followUp: 'strong',
        reason: 'design_follow_up',
      };
    }
    return {
      enabled: true,
      view: designViewCue || 'architecture',
      operation: 'create',
      output,
      basis,
      withCode: withCodeAsk,
      explicit,
      attachActiveDesign: false,
      reason: answerType === 'system_design_answer' || input.forceDesign ? 'design_route' : 'design_ask',
    };
  }

  // 2. An explicit diagram request about anything: a process, a lifecycle, a
  //    protocol, or a new view of the design on the table.
  if (explicit && !redrawUpdate && !plainEdit && !(visualExplicit && !derived && !LEGACY_TASK_VIEWS.has(asked.view))) {
    return {
      enabled: true,
      view: (visualExplicit ? asked.view : viewCue) || (derived ? /** @type {DiagramView} */ (active.view) : null) || 'flowchart',
      operation: 'create',
      output,
      basis,
      ...(derived ? { parentArtifactId: parent, followUp } : {}),
      withCode: codingRoute && wantsCode,
      explicit: true,
      attachActiveDesign: derived,
      reason: derived ? 'explicit_view_of_design' : 'explicit_request',
    };
  }

  // 2b. A visual from the wider catalog: asked for ("model users, orders and
  //     payments", "show the break-even"), or implied by the task in a mode
  //     where it is relevant ("where are deals dropping out?" in Sales). A
  //     follow-up on the artifact already on the table is not a new visual:
  //     those are decided below.
  // "Can I see the database schema for the scheduling database?", "can you
  // give me the data model for this?": asked to be shown, and of the design.
  const shownOfActive = !visualExplicit && Boolean(active) && Boolean(whole) && whole.implied && !saysNoDiagram && !wantsCode && !codingRoute && !personal
    && !updateAsk && !refineAsk && (SHOW_REQUEST_RE.test(q) || SHOW_REQUEST_RE.test(lead)) && (strong || (fg && (OF_THIS_RE.test(q) || OF_ITS_PARTS_RE.test(q))));
  if (shownOfActive) {
    return {
      enabled: true,
      view: whole.view,
      operation: 'create',
      output,
      basis,
      parentArtifactId: parent,
      followUp,
      withCode: false,
      explicit: false,
      attachActiveDesign: true,
      reason: 'explicit_view_of_design',
    };
  }
  const followsActive = Boolean(active) && (updateAsk || refineAsk || (explainAsk && !visualExplicit));
  if (task && !followsActive) {
    // "Show it as a table", "turn this into an ER diagram": a new kind of
    // visual OF what is on the table. It is a fresh artifact (never an edit of
    // the old one), and it is handed the old one to work from.
    // (So is one that names a part of it by its own name: "show me the
    // database schema for the scheduling database".)
    // (And one that names the artifact as the thing to turn into something
    // else: "show the chart as a table", in focus or not.)
    const turnsNamed = visualExplicit && namesIt && TURNS_NAMED_RE.test(q);
    const ofActive = Boolean(active) && !personal && ((fg && (visualExplicit ? pronounObject : OF_THIS_RE.test(q))) || (visualExplicit && namesPhrase) || turnsNamed);
    // Another form of the SAME kind of artifact ("show it as a bar chart" over
    // a chart) keeps what it holds: that is an edit of it.
    const reshapes = ofActive && familyOfView(task.view) === family && family === 'chart';
    return {
      enabled: true,
      view: task.view,
      operation: reshapes ? 'update' : 'create',
      output,
      basis,
      ...(ofActive ? { parentArtifactId: parent, followUp, parentFamily: family } : {}),
      withCode: codingRoute && wantsCode,
      explicit: visualExplicit,
      contextual: !visualExplicit && !ofActive,
      attachActiveDesign: ofActive,
      reason: reshapes ? 'update_design' : ofActive ? 'explicit_view_of_design' : visualExplicit ? 'explicit_visual' : 'contextual_visual',
    };
  }

  // Everything below needs a design already on the table.
  if (!active) return disabled(saysNoDiagram ? 'no_diagram_requested' : 'not_a_diagram_turn');

  // 3. "Make your answer shorter": prose changes, the diagram does not.
  if (refineAsk) {
    return {
      enabled: true,
      view: /** @type {DiagramView} */ (active.view) || 'architecture',
      operation: 'refine',
      output: saysNoDiagram ? 'text-only' : 'text-and-diagram',
      basis: 'proposed-design',
      parentArtifactId: parent,
      withCode: false,
      explicit: false,
      attachActiveDesign: true,
      followUp: 'weak',
      reason: 'refine_prose',
    };
  }

  // 4. A coding turn: an explicit request for code, or a turn the router calls
  //    coding that is NOT one of the design follow-ups above. The router's
  //    verdict alone is not enough here — it is keyword-based, and "queue",
  //    "cache" and "add" trip it on plain design talk. No diagram; the code is
  //    grounded in the design when the request points at it.
  if (wantsCode || (codingRoute && !updateAsk && !viewAsk && !explainAsk)) {
    // Code that names the design or one of its parts is written against it.
    return disabled('coding_turn', { attachActiveDesign: refers || namesIt || namesPart });
  }

  // 5. A change to the design: add / remove / replace / scale / new view.
  if (viewAsk) {
    return {
      enabled: true,
      view: viewCue || /** @type {DiagramView} */ (active.view) || 'architecture',
      operation: 'create',
      output,
      basis: 'proposed-design',
      parentArtifactId: parent,
      withCode: false,
      explicit: false,
      attachActiveDesign: true,
      followUp,
      reason: 'view_of_design',
    };
  }
  if (updateAsk && viewCue && viewCue !== active.view && VIEW_CHANGE_RE.test(q) && !redrawUpdate) {
    // "Change this to a sequence diagram": another drawing of the same thing.
    return {
      enabled: true,
      view: viewCue,
      operation: 'create',
      output,
      basis: 'proposed-design',
      parentArtifactId: parent,
      withCode: false,
      explicit: false,
      attachActiveDesign: true,
      followUp,
      reason: 'view_of_design',
    };
  }
  if (updateAsk) {
    return {
      enabled: true,
      view: (redrawUpdate ? null : viewCue) || /** @type {DiagramView} */ (active.view) || 'architecture',
      operation: saysNoDiagram ? 'explain' : 'update',
      output,
      basis: 'proposed-design',
      parentArtifactId: parent,
      withCode: false,
      explicit: false,
      attachActiveDesign: true,
      followUp,
      reason: 'update_design',
    };
  }

  // 6. A question about the design: answer it, keep the diagram as it is.
  if (explainAsk) {
    return {
      enabled: true,
      view: /** @type {DiagramView} */ (active.view) || 'architecture',
      operation: 'explain',
      output: 'text-only',
      basis: 'proposed-design',
      parentArtifactId: parent,
      withCode: false,
      explicit: false,
      attachActiveDesign: true,
      followUp,
      reason: 'explain_design',
    };
  }

  return disabled('unrelated_turn');
}

/** "Make it shorter" is about the wording, whatever verb it starts with. */
function refineLike(q) {
  return REFINE_PROSE_RE.test(stripLeadIn(q));
}

/**
 * The view a Mermaid block is, in product terms: from its header, and — for a
 * flowchart, which is the notation of both — from whether it draws a system
 * or a process. A flowchart that runs top-down or branches on a decision
 * (`check{"Paid?"}`) is a process, a troubleshooting tree, a workflow; without
 * its source it was always called an architecture, and a follow-up on a
 * troubleshooting tree was told to keep "5 to 10 components for a first design".
 */
export function viewFromDiagramType(type, source) {
  if (type === 'sequence') return 'sequence';
  if (type === 'state') return 'state';
  if (type === 'er' || type === 'class' || type === 'mindmap' || type === 'timeline' || type === 'gantt') return type;
  if (type === 'flowchart' && typeof source === 'string' && isProcessFlowchart(source)) return 'flowchart';
  return 'architecture';
}

function isProcessFlowchart(source) {
  const text = source.slice(0, 8000);
  if (/^\s*(?:flowchart|graph)\s+(?:TD|TB|BT)\b/m.test(text)) return true;
  // A decision diamond: id{label} (not the hexagon id{{label}}).
  return /[A-Za-z0-9_]\{(?!\{)[^{}\n]{1,120}\}(?!\})/.test(text);
}
