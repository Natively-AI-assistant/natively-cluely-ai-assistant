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

/** @typedef {'architecture' | 'sequence' | 'flowchart' | 'state'} DiagramView */
/** @typedef {'create' | 'update' | 'explain' | 'refine' | 'none'} DiagramOperation */
/** @typedef {'text-and-diagram' | 'diagram-only' | 'source-only' | 'text-only'} DiagramOutput */
/** @typedef {'proposed-design' | 'meeting-reconstruction' | 'source-reconstruction'} DiagramBasis */

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
 */

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

function normalise(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ── output constraints ──────────────────────────────────────────────────────

const NO_DIAGRAM_RE =
  /\b(?:no|without(?: a| any)?|skip(?: the)?|don'?t (?:draw|include|add|give me|show)(?: a| any| the)?|do not (?:draw|include|add|show)(?: a| any| the)?|not? need(?: a| any)?) (?:diagrams?|mermaid|drawings?|charts?|visuals?)\b|\b(?:explain|explanation|prose|text|words) only\b|\b(?:just|only) (?:explain|describe|tell me|talk (?:me )?through)\b|\bin words only\b/;

const SOURCE_ONLY_RE =
  /\b(?:just|only)(?: give me| show me| output| return)?(?: the)? (?:raw )?mermaid\b|\bmermaid (?:source|code|syntax|text|markup)\b|\b(?:source|code|syntax) only\b|\bas (?:raw )?mermaid\b|\bgive me (?:the )?mermaid\b/;

const DIAGRAM_ONLY_RE =
  /\bdiagram only\b|\b(?:only|just)(?: give me| show me)? (?:the|a) (?:diagram|flowchart|chart|picture|drawing)\b|\bno (?:explanation|prose|text|commentary|description)\b|\bwithout (?:any )?(?:explanation|prose|text|commentary)\b/;

// ── explicit diagram asks ───────────────────────────────────────────────────

// A verb that can only mean "produce a picture".
const DRAW_VERB_RE = /\b(?:draw|sketch|visuali[sz]e|illustrate|map out|chart out|whiteboard)\b|(?:^|[.,;:!?]\s*|\b(?:please|can you|could you|now|then|and|ok(?:ay)?|let'?s)\s+)diagram\b(?!s)/;
// A neutral verb that asks for a picture only when paired with a diagram noun.
const SHOW_VERB_RE = /\b(?:show|give|make|create|generate|produce|render|turn|convert|redo|redraw|present|put|lay out|display|build)\b/;
const DIAGRAM_NOUN_RE =
  /\b(?:diagrams?|flow ?charts?|sequence(?: diagram)?|state (?:machine|diagram|chart)|mermaid|lifecycle|life cycle|architecture diagram|block diagram|(?:request|call|data|message|write|read|delivery|auth\w*|login|payment|control) (?:flow|path|sequence))\b/;
// "Show the write path only", "show it as …" — a new view of the design on the table.
const VIEW_OF_DESIGN_RE = /\b(?:show|give me|just)\b[^.?!]*\b(?:path|flow|sequence|view|part|side|layer)\b|\bas an? (?:sequence|state|flow|architecture)\b/;

// "What is a sequence diagram?", "Have you used flowcharts?" — about diagrams, not asking for one.
const ABOUT_DIAGRAMS_RE =
  /^(?:what(?:'s| is| are)|define|explain what|have you|do you|did you|are you|when (?:would|should|do) (?:you|i|we))\b[^.?!]*\b(?:diagrams?|flow ?charts?|state machines?|uml|mermaid)\b/;

// ── view cues ───────────────────────────────────────────────────────────────

const VIEW_SEQUENCE_RE =
  /\bsequence\b|\b(?:request|call|message|delivery|auth\w*|login|payment|handshake) (?:flow|sequence)\b|\bhandshake\b|\bround[- ]?trip\b|\bwho calls (?:who|whom|what)\b|\binteractions? between\b/;
const VIEW_STATE_RE = /\bstate (?:machine|diagram|chart|transitions?)\b|\blife ?cycle\b|\bstates? and transitions?\b|\bstatus (?:flow|transitions?)\b/;
const VIEW_FLOWCHART_RE = /\bflow ?chart\b|\bdecision (?:tree|flow)\b|\bprocess (?:flow|diagram)?\b|\bworkflow\b|\bstep[- ]by[- ]step\b|\bpipeline stages\b|\balgorithm\b/;
const VIEW_ARCHITECTURE_RE = /\barchitecture\b|\bcomponents?\b|\bhigh[- ]level\b|\bblock diagram\b|\bsystem (?:design|diagram|overview)\b|\bdeployment\b|\btopology\b/;

/** @returns {DiagramView | null} */
export function detectDiagramView(question) {
  const q = normalise(question);
  if (VIEW_STATE_RE.test(q)) return 'state';
  if (VIEW_SEQUENCE_RE.test(q)) return 'sequence';
  if (VIEW_FLOWCHART_RE.test(q)) return 'flowchart';
  if (VIEW_ARCHITECTURE_RE.test(q)) return 'architecture';
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
const DESIGN_ASK_RE = new RegExp(
  [
    String.raw`\bsystem design\b`,
    String.raw`\b(?:design|architect|re-?design|re-?architect)\s+(?:an?\s+|the\s+)?(?:something like\s+|a clone of\s+|a version of\s+|your own\s+)?${KNOWN_PRODUCT}\b`,
    String.raw`\b(?:design|architect|re-?design|re-?architect)\b[^.?!]{0,60}\b${SOFTWARE_OBJECT}\b`,
    String.raw`\bhow (?:would|do|could|should) (?:you|we|i|one) (?:design|architect|build|structure|scale)\b[^.?!]{0,60}\b${SOFTWARE_OBJECT}\b`,
    String.raw`\b(?:high[- ]level|overall) (?:design|architecture) (?:for|of)\b`,
    String.raw`\barchitecture for\b[^.?!]{0,60}\b${SOFTWARE_OBJECT}\b`,
  ].join('|'),
);

// Someone asking about the user's past, not asking for a design.
const EXPERIENCE_RE =
  /\b(?:have|had|did|do) you (?:ever |personally |actually )?(?:built|build|designed?|architected?|worked|work|used?|scaled?|run|led|owned?|shipped?)\b|\btell me about (?:a time|your|the time)\b|\b(?:your|any) (?:experience|background) (?:with|in|building|designing)\b|\bwhat(?:'s| is) your experience\b|\bhave you been\b/;

const CODE_VERB_RE = /\b(?:implement|code(?: up| it| this)?|write(?: me)?(?: the| a| an| some)? (?:code|function|class|method|handler|worker|script|program|implementation|module|service|endpoint|query)|program|(?:a|an|the|this|that|helper|utility) (?:function|method)|unit tests?|test cases?|snippet|pseudo-?code|in (?:python|java|javascript|typescript|go|golang|rust|c\+\+|c#|kotlin|swift|ruby|php|scala)\b)/;

const CODING_ANSWER_TYPES = new Set(['dsa_question_answer', 'coding_question_answer']);

function isDesignAsk(q, answerType) {
  if (EXPERIENCE_RE.test(q)) return false;
  if (answerType === 'system_design_answer') return true;
  return DESIGN_ASK_RE.test(q);
}

// ── follow-ups on an existing design ────────────────────────────────────────

const LEAD_IN = String.raw`(?:(?:ok(?:ay)?|now|and|also|then|next|so|please|actually|great|cool|alright|right)[, ]+|(?:can|could|would) (?:you|we)(?: please)? |let'?s |i(?:'d| would) like (?:you )?to |we (?:should|need to|could) )*`;
const UPDATE_RE = new RegExp(
  String.raw`^${LEAD_IN}(?:add|remove|replace|swap|switch|change|use|introduce|insert|put|move|split|merge|drop|delete|make|include|handle|support|scale|shard|partition|replicate|extend|update|modify|rename|redo|rework|simplify the (?:design|diagram|architecture)|expand the (?:design|diagram|architecture))\b`,
);
const UPDATE_PHRASE_RE =
  /\binstead of\b|\bwhat if we (?:add|use|remove|replace|put|had|switch)\b|\bmulti[- ]region\b|\bhow (?:does|would|will|do|can|could) (?:this|that|it|the (?:system|design|architecture)|we)\b[^.?!]*\b(?:scale|handle|cope|support|survive|hold up|work (?:at|with|for))\b/;
const REFINE_PROSE_RE =
  /\b(?:shorter|shorten|more concise|briefer|trim (?:it|that|this)|tighten|rephrase|reword|say (?:it|that) (?:differently|again)|simpler words|more (?:casual|formal|confident)|make (?:it|that|this|your answer|the answer|the explanation) (?:shorter|longer|simpler|clearer|more \w+))\b/;
const QUESTION_LEAD_RE =
  /^(?:(?:ok(?:ay)?|now|and|but|so|wait)[, ]+)*(?:why|what|when|where|which|who|how|is|are|does|do|can|could|would|should|will|explain|tell me|walk me through|talk me through)\b/;
const DEICTIC_RE = /\b(?:this|that|it|these|those|the (?:system|design|diagram|architecture|flow|picture|above)|our (?:design|system|architecture)|here)\b/;
// Words that can only mean the design ("the diagram"), as opposed to a bare
// pronoun, which means whatever was answered LAST — and that may be code.
const DESIGN_NOUN_RE = /\b(?:the|this|that|our|your) (?:system|design|diagram|architecture|flow ?chart|picture)\b/;

// "Redesign this for multi-region": the design verb's object is the design on the table.
const DESIGN_OF_ACTIVE_RE =
  /\b(?:design|architect|re-?design|re-?architect|rework|rebuild|scale)\s+(?:this|that|it|the (?:system|design|architecture|diagram)|our (?:system|design|architecture))\b/;

const LABEL_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'service', 'services', 'system', 'app', 'api', 'store', 'data', 'user', 'users', 'client',
  'server', 'request', 'response', 'path', 'flow', 'yes', 'no', 'end', 'start', 'new', 'old', 'all', 'any', 'via', 'per', 'not', 'left',
]);

/** Distinctive lower-case words from the labels of a Mermaid diagram. */
export function designVocabulary(mermaidSource) {
  const words = new Set();
  const text = String(mermaidSource ?? '');
  const labelRe = /"([^"\n]{1,80})"|\[([^\]"\n]{1,60})\]|\(([^)"\n]{1,60})\)|(?:participant|actor)\s+\S+\s+as\s+([^\n]{1,60})|^\s*([A-Z][A-Za-z]+)(?=\s*-->)|-->\s*([A-Z][A-Za-z]+)\b/gm;
  for (const m of text.matchAll(labelRe)) {
    const label = m[1] || m[2] || m[3] || m[4] || m[5] || m[6] || '';
    // Split CamelCase state names ("PaymentFailed") as well as spaced labels.
    for (const raw of label.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length >= 3 && !LABEL_STOPWORDS.has(raw)) words.add(raw);
    }
  }
  return words;
}

/**
 * Does the question point at the design on the table?
 *  - by naming it ("the diagram", "this design") or one of its components — always;
 *  - by a bare pronoun ("this", "it") — only while the design is the latest
 *    thing answered. Once a code answer has followed it (`foreground: false`),
 *    "why is this O(n)?" is about the code.
 */
export function refersToDesign(question, activeDesign) {
  if (!activeDesign || !activeDesign.source) return false;
  const q = normalise(question);
  if (DESIGN_NOUN_RE.test(q)) return true;
  if (activeDesign.foreground !== false && DEICTIC_RE.test(q)) return true;
  const vocab = designVocabulary(activeDesign.source);
  if (vocab.size === 0) return false;
  for (const word of q.split(/[^a-z0-9]+/)) {
    if (word.length < 3) continue;
    if (vocab.has(word)) return true;
    // "queues" ↔ "queue", "retries" ↔ "retry"
    if (word.endsWith('s') && vocab.has(word.slice(0, -1))) return true;
    if (vocab.has(`${word}s`)) return true;
  }
  return false;
}

// ── basis ───────────────────────────────────────────────────────────────────

const MEETING_BASIS_RE =
  /\b(?:we|they|you all|everyone|the team)(?: have| had|'ve)? (?:just |already )?(?:discussed|described|talked about|agreed(?: on)?|decided(?: on)?|went over|covered|outlined|proposed)\b|\bfrom (?:this|the|today'?s) (?:meeting|call|conversation|discussion|session)\b|\bwhat (?:was|we|they) (?:said|discussed|described|agreed)\b|\bas discussed\b/;
const SOURCE_BASIS_RE =
  /\b(?:actual|current|existing|real|as[- ]is|present)\b[^.?!]{0,40}\b(?:architecture|system|design|setup|infrastructure|flow|pipeline|stack)\b|\b(?:our|my|natively'?s)\b[^.?!]{0,30}\b(?:actual|current|existing|real)\b|\b(?:from|based on|according to|in|using) (?:the|this|that|my|our) (?:docs?|documents?|files?|spec|screenshot|screen|page|code(?:base)?|repo(?:sitory)?|readme|slides?|deck|attachment)\b/;

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
 * }} input
 * @returns {DiagramRequest}
 */
export function resolveDiagramRequest(input = {}) {
  if (input.featureEnabled === false) return disabled('feature_off');
  const q = normalise(input.question);
  const instructions = normalise(input.userInstructions);
  const active = input.activeDesign && input.activeDesign.source ? input.activeDesign : null;
  const answerType = input.answerType || null;
  const types = Array.isArray(input.questionTypes) ? input.questionTypes : [];

  if (!q && !input.forceDesign) return disabled('empty');

  const saysNoDiagram = NO_DIAGRAM_RE.test(q) || (instructions ? NO_DIAGRAM_RE.test(instructions) : false);
  const aboutDiagrams = ABOUT_DIAGRAMS_RE.test(q) && !DRAW_VERB_RE.test(q);
  const explicit =
    !aboutDiagrams && !saysNoDiagram && (DRAW_VERB_RE.test(q) || (SHOW_VERB_RE.test(q) && DIAGRAM_NOUN_RE.test(q)) || /\bmermaid\b/.test(q));
  const designAsk = input.forceDesign === true || isDesignAsk(q, answerType);
  const codingRoute = CODING_ANSWER_TYPES.has(answerType || '') || types.includes('CODING_TASK');
  const wantsCode = CODE_VERB_RE.test(q);
  const refers = active ? refersToDesign(q, active) : false;
  let basis = detectBasis(q);
  // "Draw this" / "diagram what's here" over a screenshot or captured page: the
  // picture is the source, so draw what it shows rather than inventing a design.
  if (input.hasVisualContext === true && basis === 'proposed-design' && VISUAL_REFERENCE_RE.test(q)) {
    basis = 'source-reconstruction';
  }

  /** @type {DiagramOutput} */
  let output = 'text-and-diagram';
  if (saysNoDiagram) output = 'text-only';
  else if (SOURCE_ONLY_RE.test(q)) output = 'source-only';
  else if (DIAGRAM_ONLY_RE.test(q)) output = 'diagram-only';

  const viewCue = detectDiagramView(q);
  const parent = active?.artifactId;

  // What kind of follow-up the words describe, when a design is on the table.
  // While the design is the latest thing answered, an imperative ("add …",
  // "make this …") is a change to it; once a code answer has followed, it has
  // to name the design or one of its components to count.
  const inFocus = Boolean(active) && (active.foreground !== false || refers);
  const updateAsk = inFocus && (UPDATE_RE.test(q) || UPDATE_PHRASE_RE.test(q));
  const viewAsk = Boolean(active) && VIEW_OF_DESIGN_RE.test(q) && (refers || viewCue !== null) && !QUESTION_LEAD_RE.test(q);
  const explainAsk = Boolean(active) && QUESTION_LEAD_RE.test(q) && refers;
  const refineAsk = Boolean(active) && REFINE_PROSE_RE.test(q) && !/\b(?:diagram|design|architecture)\b/.test(q);
  // The router can call a follow-up "system design" (its patterns include
  // "scale to", "notification system", and it is told about design follow-ups).
  // That verdict alone must not restart the design: only the WORDS of a fresh
  // design ask ("design a …") do.
  const saysDesignAsk = input.forceDesign === true || (!EXPERIENCE_RE.test(q) && DESIGN_ASK_RE.test(q));
  const followUpWords = updateAsk || viewAsk || explainAsk || refineAsk;

  // 1. A design ask that names its own subject starts a fresh design, whatever
  //    is on the table. One that only points at the current design updates it.
  if (designAsk && (saysDesignAsk || !followUpWords)) {
    const pointsAtActive = active && DESIGN_OF_ACTIVE_RE.test(q);
    if (pointsAtActive) {
      return {
        enabled: true,
        view: viewCue || /** @type {DiagramView} */ (active.view) || 'architecture',
        operation: saysNoDiagram ? 'explain' : 'update',
        output,
        basis,
        parentArtifactId: parent,
        withCode: codingRoute || wantsCode,
        explicit,
        attachActiveDesign: true,
        reason: 'design_follow_up',
      };
    }
    return {
      enabled: true,
      view: viewCue || 'architecture',
      operation: 'create',
      output,
      basis,
      withCode: codingRoute || wantsCode,
      explicit,
      attachActiveDesign: false,
      reason: answerType === 'system_design_answer' || input.forceDesign ? 'design_route' : 'design_ask',
    };
  }

  // 2. An explicit diagram request about anything: a process, a lifecycle, a
  //    protocol, or a new view of the design on the table.
  if (explicit) {
    const derived = Boolean(active && (refers || VIEW_OF_DESIGN_RE.test(q) || basis === 'proposed-design' && !/\b(?:of|for) (?:a|an)\b/.test(q) && DEICTIC_RE.test(q)));
    return {
      enabled: true,
      view: viewCue || (derived ? /** @type {DiagramView} */ (active.view) : null) || 'flowchart',
      operation: 'create',
      output,
      basis,
      ...(derived ? { parentArtifactId: parent } : {}),
      withCode: codingRoute && wantsCode,
      explicit: true,
      attachActiveDesign: derived,
      reason: derived ? 'explicit_view_of_design' : 'explicit_request',
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
      reason: 'refine_prose',
    };
  }

  // 4. A coding turn: an explicit request for code, or a turn the router calls
  //    coding that is NOT one of the design follow-ups above. The router's
  //    verdict alone is not enough here — it is keyword-based, and "queue",
  //    "cache" and "add" trip it on plain design talk. No diagram; the code is
  //    grounded in the design when the request points at it.
  if (wantsCode || (codingRoute && !updateAsk && !viewAsk && !explainAsk)) {
    return disabled('coding_turn', { attachActiveDesign: refers });
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
      reason: 'view_of_design',
    };
  }
  if (updateAsk) {
    return {
      enabled: true,
      view: viewCue || /** @type {DiagramView} */ (active.view) || 'architecture',
      operation: saysNoDiagram ? 'explain' : 'update',
      output,
      basis: 'proposed-design',
      parentArtifactId: parent,
      withCode: false,
      explicit: false,
      attachActiveDesign: true,
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
      reason: 'explain_design',
    };
  }

  return disabled('unrelated_turn');
}

/** The view a Mermaid block's header implies, in product terms. */
export function viewFromDiagramType(type) {
  if (type === 'sequence') return 'sequence';
  if (type === 'state') return 'state';
  return 'architecture';
}
