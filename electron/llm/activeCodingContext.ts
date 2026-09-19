// Active coding-problem resolution for live What-to-Answer turns.
//
// The hot transcript is intentionally short, but a coding follow-up often arrives
// after the original problem has left that window. This module combines an
// explicitly retained, session-scoped problem with only those new messages that
// are demonstrably continuations of it. It is deterministic and dependency-light
// so routing can be regression-tested without an LLM.

import {
  durableCodingConstraintStart,
  isCodingContinuation,
  isCodingPresentationDirective,
  isDurableCodingConstraintFragment,
} from './codingFollowup';

export interface ActiveCodingContextResolution {
  /** The question that should drive planning and prompting for this turn. */
  resolvedQuestion: string;
  /** True only when the retained problem was joined to the current request. */
  usedActiveProblem: boolean;
  /** A context-dependent coding fragment had no problem/screen to resolve against. */
  needsClarification: boolean;
  /** Whether the current message has the shape of a coding continuation. */
  isContinuation: boolean;
}

const MAX_ACTIVE_PROBLEM_CHARS = 2_400;
const ACTIVE_PROBLEM_TRUNCATION_MARKER = ' … [latest requirements] … ';

// Families are deliberately narrow. They are used only to decide whether a short
// explicit implementation request belongs to the retained problem; they do not
// classify an arbitrary turn as coding on their own.
const CODING_TOPIC_FAMILIES: RegExp[] = [
  /\b(?:encryp\w*|encrpt\w*|decryp\w*|descrypt\w*|cipher\w*|cryptograph\w*|key\s*(?:rotation|version|id)|rotate\w*\s+(?:the\s+)?(?:active\s+)?key)\b/i,
  /\b(?:lru|lfu|cache|evict\w*|capacity)\b/i,
  /\b(?:linked\s+list|binary\s+search|two\s*sum|hash\s*(?:map|set|table)|tree|graph|bfs|dfs|heap|trie)\b/i,
  /\b(?:queue|stream|producer|consumer|broker|kafka|pubsub)\b/i,
  /\b(?:endpoint|rest\s+api|graphql|http\s+(?:handler|route|server))\b/i,
  /\b(?:database|sql|transaction|index|query|schema)\b/i,
];

const SHORT_CONTEXTUAL_IMPLEMENTATION_RE =
  /\b(?:write|implement|code|show|give|provide|build|create|refactor)\b|\b(?:function|method|solution|implementation)\b/i;
const SHORT_CODING_CONSTRAINT_RE =
  /\b(?:assume|constraint|requirement|must|should|need(?:s|ed)?|retain|support|handle|rotate|encryp\w*|encrpt\w*|decryp\w*|descrypt\w*|every hour|top of (?:each|the) hour|at least|at most|capacity|edge case|input|output|whole|entire|instead of|character by character)\b/i;
const OBVIOUS_NON_CODING_CONTEXT_RE =
  /\b(?:meeting\s+(?:agenda|notes?|summary)|resume|previous\s+experience|project\s+requirements?|shared\s+document|capacity\s+planning|write\s+a\s+summary|message\s+to\s+(?:the\s+)?(?:client|customer))\b/i;
const STANDALONE_CODING_LEAD_RE =
  /^(?:(?:please\s+)?(?:(?:can|could|would)\s+you\s+|how\s+(?:would|do)\s+you\s+)?)(?:implement|write|code|solve|design|build|create|reverse|merge|traverse|insert|delete|remove|serialize|deserialize|parse|validate|encrypt|decrypt|handle|explain|analy[sz]e|show|give|provide|find|return|count|check|determine|calculate|maximi[sz]e|minimi[sz]e|sort)\b/i;
const CONTEXT_ONLY_OBJECT_RE =
  /^(?:it|this|that|the\s+(?:same|previous|prior|above|current|solution|approach|algorithm|function|method|problem|code|implementation))(?:\s+(?:in|using)\s+(?:python|javascript|typescript|java|c\+\+|c#|csharp|go|golang|rust|swift|kotlin|ruby|php|sql))?(?:\s+please)?[?.!]*$/i;
const LANGUAGE_ONLY_OBJECT_RE =
  /^(?:(?:it|this|that|the\s+(?:code|solution|implementation))\s+)?(?:in|using)\s+(?:python|javascript|typescript|java|c\+\+|c#|csharp|go|golang|rust|swift|kotlin|ruby|php|sql)(?:\s+please)?[?.!]*$/i;
const GENERIC_OUTPUT_OBJECT_RE =
  /^(?:me\s+)?(?:the\s+)?(?:code|solution|implementation)(?:\s+(?:in|using)\s+(?:python|javascript|typescript|java|c\+\+|c#|csharp|go|golang|rust|swift|kotlin|ruby|php|sql))?(?:\s+please)?[?.!]*$/i;
const PRESENTATION_ONLY_OBJECT_RE =
  /^(?:me\s+)?(?:the\s+)?(?:code|solution|implementation)(?:\s+only|\s+and\s+nothing\s+else)(?:\s+please)?[?.!]*$/i;
const IMPLEMENTATION_ELLIPSIS_OBJECT_RE =
  /^(?:me\s+)?how\s+(?:you\s+)?(?:would\s+)?implement(?:\s+(?:it|this|that|the\s+(?:solution|approach)))?(?:\s+(?:in|using)\s+(?:python|javascript|typescript|java|c\+\+|c#|csharp|go|golang|rust|swift|kotlin|ruby|php|sql))?(?:\s+please)?[?.!]*$/i;
const FORMAT_ONLY_OBJECT_RE =
  /^(?:me\s+)?(?:(?:the|an?|a)\s+)?(?:O\([^)]*\)(?:\s+(?:time|space))?\s+complexit(?:y|ies)|time\s*(?:and|&|\/)\s*space\s+complexit(?:y|ies)|space\s*(?:and|&|\/)\s*time\s+complexit(?:y|ies)|(?:time|space)\s+complexit(?:y|ies)|complexit(?:y|ies)|big[- ]?o|dry[- ]?run|execution\s+trace|trace|edge\s+cases?)(?:\s+(?:of|for)\s+(?:it|this|that|the\s+(?:code|solution|algorithm|approach)))?(?:\s+please)?[?.!]*$/i;
const VAGUE_OPERATION_LIST_RE =
  /^(?:an?\s+)?(?:function|method)\s+for\s+(?:rotate|encryp\w*|encrpt\w*|decryp\w*|descrypt\w*)(?:(?:\s*[,/]\s*|\s+(?:and|or)\s+)(?:rotate|encryp\w*|encrpt\w*|decryp\w*|descrypt\w*))*[?.!]*$/i;
const CONSTRAINT_LIKE_COMMAND_RE =
  /^(?:the\s+)?(?:entire|whole|full)\s+(?:text|message|payload|input|string)\b|\b(?:instead\s+of|not)\s+(?:doing\s+it\s+)?character\s+by\s+character\b/i;
const GIVEN_PROBLEM_RE =
  /^(?:(?:you\s+are\s+)?given|for)\s+(?:(?:an?|the)\s+)?(?:array|string|list|linked\s+list|tree|graph|matrix|number|integer|node|stack|queue|heap|trie|cache|stream|set|map)\b[^.?!]{0,220}\b(?:return|find|count|check|determine|calculate|maximi[sz]e|minimi[sz]e|sort|implement|write)\b/i;
const PAIRED_CRYPTO_NARRATIVE_RE =
  /\b(?:service|component|client|sender|producer|application|app|system)\s+[a-z0-9_-]+\b[^.?!]{0,120}\bencryp\w*\b[\s\S]{0,180}?\b(?:service|component|client|receiver|consumer|application|app|system)\s+[a-z0-9_-]+\b[^.?!]{0,120}\b(?:decryp\w*|descrypt\w*)\b/i;
// A paired actor/operation sentence is only a safe planner-bypass when it is a
// declarative problem statement. Conceptual questions can contain the exact
// same nouns and verbs ("Does Service A encrypt before Service B decrypts?")
// but must not replace the active coding problem. Explicit implementation asks
// such as "How would you implement ..." remain covered by
// isSelfContainedCodingRequest + AnswerPlanner.
const CONCEPTUAL_QUESTION_LEAD_RE =
  /^(?:do|does|did|should|can|could|would|will|why|how|what|which|who|when|where|is|are|was|were|has|have|had)\b/i;
const EXPLICIT_PRIOR_PROBLEM_REFERENCE_RE =
  /\b(?:same|previous|prior|above|current)\s+(?:code|solution|approach|algorithm|function|method|problem|implementation)\b/i;
const CLEAR_NEW_CODING_PROBLEM_RE =
  /^(?:please\s+|can you\s+|could you\s+|would you\s+)?(?:implement|write|code|solve|design|build|create|reverse|merge|traverse|insert|delete|remove|serialize|deserialize|parse|validate|encrypt|decrypt|explain|analy[sz]e)\s+(?:(?:an?|the)\s+)?(?:lru|lfu|cache|two\s*sum|three\s*sum|binary\s+search|linked\s+list|tree|graph|array|string|stack|queue|heap|trie|parser|endpoint|rest\s+api|graphql|database|sql|service|cipher|encryption)|\b(?:code|solution|implementation)\b[^.?!]{0,32}\bfor\s+(?:(?:an?|the)\s+)?(?:lru|lfu|cache|two\s*sum|three\s*sum|binary\s+search|linked\s+list|tree|graph|array|string|stack|queue|heap|trie|parser|endpoint|rest\s+api|graphql|database|sql|service|cipher|encryption)\b/i;
const SPECIFIC_TOPIC_MARKERS: Array<[string, RegExp]> = [
  ['crypto', /\b(?:encryp\w*|encrpt\w*|decryp\w*|descrypt\w*|cipher|key\s+rotation)\b/i],
  ['lru', /\blru\b/i], ['lfu', /\blfu\b/i],
  ['two_sum', /\btwo\s*sum\b/i], ['three_sum', /\bthree\s*sum\b/i],
  ['binary_search', /\bbinary\s+search\b/i], ['linked_list', /\blinked\s+list\b/i],
  ['bfs', /\bbfs\b/i], ['dfs', /\bdfs\b/i],
  ['tree', /\btree\b/i], ['graph', /\bgraph\b/i], ['heap', /\bheap\b/i], ['trie', /\btrie\b/i],
  ['queue', /\bqueue\b/i], ['kafka', /\bkafka\b/i],
  ['rest_api', /\b(?:rest\s+api|http\s+(?:endpoint|route))\b/i], ['graphql', /\bgraphql\b/i],
  ['database', /\b(?:database|sql)\b/i],
];

/**
 * Whether a coding-shaped turn supplies its own problem subject rather than only
 * pointing at an earlier solution. This is intentionally syntactic: callers
 * that classify arbitrary speech as coding still apply their own domain gate.
 */
export function isSelfContainedCodingRequest(question: string): boolean {
  const current = (question || '').replace(/\s+/g, ' ').trim();
  if (!current) return false;
  if (GIVEN_PROBLEM_RE.test(current)) return true;
  if (isDurableCodingConstraintFragment(current)) return false;
  if (durableConstraintAfterPresentationPrefix(current)) return false;

  const lead = current.match(STANDALONE_CODING_LEAD_RE);
  if (!lead) return false;
  const object = current.slice(lead[0].length).trim();
  if (!object || CONTEXT_ONLY_OBJECT_RE.test(object)) return false;
  if (LANGUAGE_ONLY_OBJECT_RE.test(object)
      || GENERIC_OUTPUT_OBJECT_RE.test(object)
      || PRESENTATION_ONLY_OBJECT_RE.test(object)
      || IMPLEMENTATION_ELLIPSIS_OBJECT_RE.test(object)
      || FORMAT_ONLY_OBJECT_RE.test(object)) return false;
  // The issue's split crypto prompt names operations but not the object/state
  // they apply to, so it is a refinement of the retained service requirements.
  if (VAGUE_OPERATION_LIST_RE.test(object) || CONSTRAINT_LIKE_COMMAND_RE.test(object)) return false;
  return /[a-z0-9]/i.test(object);
}

/** High-confidence standalone problem safe to persist even when AnswerPlanner
 * does not recognize a declarative requirement. Keep this deliberately narrow:
 * normal imperative coding asks are already covered by the planner, while broad
 * technical-domain matching can mistake meeting prose for a coding problem. */
export function isHighConfidenceStandaloneCodingProblem(question: string): boolean {
  const current = (question || '').replace(/\s+/g, ' ').trim();
  if (!current || /\?\s*$/.test(current) || CONCEPTUAL_QUESTION_LEAD_RE.test(current)) return false;
  return PAIRED_CRYPTO_NARRATIVE_RE.test(current);
}

function durableConstraintAfterPresentationPrefix(question: string): string | null {
  const start = durableCodingConstraintStart(question);
  if (start <= 0) return null;
  const before = question.slice(0, start);
  const split = before.match(/^(.*?)(?:,?\s+(?:and|but|then)\s+|,\s*)$/i);
  if (!split) return null;
  const prefix = split[1].trim();
  if (!prefix || !isCodingPresentationDirective(prefix) || isSelfContainedCodingRequest(prefix)) return null;
  return question.slice(start).trim();
}

function hasPriorProblemReference(question: string): boolean {
  const current = (question || '').replace(/\s+/g, ' ').trim();
  if (EXPLICIT_PRIOR_PROBLEM_REFERENCE_RE.test(current)) return true;
  const lead = current.match(STANDALONE_CODING_LEAD_RE);
  return Boolean(lead && CONTEXT_ONLY_OBJECT_RE.test(current.slice(lead[0].length).trim()));
}

function boundActiveCodingProblem(value: string): string {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= MAX_ACTIVE_PROBLEM_CHARS) return text;

  // Preserve both the original problem statement and the newest constraints.
  // A head-only slice silently discarded precisely the follow-ups issue #539
  // needs to keep once a long problem reached the cap.
  const headBudget = Math.floor(MAX_ACTIVE_PROBLEM_CHARS * 0.55);
  const tailBudget = MAX_ACTIVE_PROBLEM_CHARS - headBudget - ACTIVE_PROBLEM_TRUNCATION_MARKER.length;
  let head = text.slice(0, headBudget).replace(/\s+\S*$/, '').trimEnd();
  let tail = text.slice(-tailBudget).replace(/^\S*\s+/, '').trimStart();
  if (!head) head = text.slice(0, headBudget);
  if (!tail) tail = text.slice(-tailBudget);
  return `${head}${ACTIVE_PROBLEM_TRUNCATION_MARKER}${tail}`.slice(0, MAX_ACTIVE_PROBLEM_CHARS);
}

function hasConflictingSpecificTopic(current: string, active: string): boolean {
  const currentTopics = SPECIFIC_TOPIC_MARKERS.filter(([, re]) => re.test(current)).map(([name]) => name);
  if (currentTopics.length === 0) return false;
  const activeTopics = new Set(SPECIFIC_TOPIC_MARKERS.filter(([, re]) => re.test(active)).map(([name]) => name));
  return activeTopics.size > 0 && currentTopics.some(topic => !activeTopics.has(topic));
}

export function sharesCodingTopic(leftText: string, rightText: string): boolean {
  const left = leftText || '';
  const right = rightText || '';
  return CODING_TOPIC_FAMILIES.some((family) => family.test(left) && family.test(right));
}

function normalizeRetainedFragment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A short coding request can be self-contained even while an older coding problem
 * exists ("implement a binary search tree"). Only inherit the retained problem
 * when the message is already a continuation shape, or when it is a short
 * implementation/clarification request that shares a concrete coding family.
 */
export function shouldUseActiveCodingProblem(currentQuestion: string, activeProblem: string): boolean {
  const current = (currentQuestion || '').replace(/\s+/g, ' ').trim();
  const active = (activeProblem || '').replace(/\s+/g, ' ').trim();
  if (!current || !active) return false;
  const priorReference = hasPriorProblemReference(current);
  if (OBVIOUS_NON_CODING_CONTEXT_RE.test(current) && !priorReference) return false;
  // A complete declarative coding prompt can share the same broad family as
  // Q1 while naming a different system (Service C/D after Service A/B). Treat
  // that as a replacement, not another constraint to merge into the old task.
  if (isHighConfidenceStandaloneCodingProblem(current) && !priorReference) {
    // Duplex STT can repeat the base statement after later requirements have
    // already been appended. Treat an already-contained statement as the same
    // problem so the repeat cannot erase those newer constraints.
    const normalizedCurrent = normalizeRetainedFragment(current);
    if (normalizedCurrent && normalizeRetainedFragment(active).includes(normalizedCurrent)) return true;
    return false;
  }
  const selfContained = isSelfContainedCodingRequest(current);
  const contextualConstraint = isDurableCodingConstraintFragment(current)
    || VAGUE_OPERATION_LIST_RE.test(current.replace(STANDALONE_CODING_LEAD_RE, '').trim());
  if (contextualConstraint) {
    const currentHasCodingTopic = CODING_TOPIC_FAMILIES.some(family => family.test(current));
    if ((currentHasCodingTopic && !sharesCodingTopic(current, active))
        || hasConflictingSpecificTopic(current, active)) return false;
    return true;
  }
  if (isCodingContinuation(current)) {
    // A context-dependent refinement about a different named problem cannot
    // attach merely because some stale active problem exists.
    const currentHasCodingTopic = CODING_TOPIC_FAMILIES.some(family => family.test(current));
    if ((currentHasCodingTopic && !sharesCodingTopic(current, active))
        || hasConflictingSpecificTopic(current, active)) return false;
    // A formatting phrase may also carry its own complete subject (for example,
    // "write code only for Two Sum"). Do not let an unrelated stale problem
    // override that explicit subject.
    if (selfContained && !priorReference) return false;
    return true;
  }

  // A complete Q2 replaces Q1 even when both happen to share a broad family
  // ("Implement an LRU cache" → "Implement a cache that supports TTL").
  if ((CLEAR_NEW_CODING_PROBLEM_RE.test(current) || selfContained)
      && !priorReference) return false;

  // SessionTracker may already have merged this exact generic constraint into
  // the durable problem. Containment is evidence only after complete/new-problem
  // guards run, and only for a coding-constraint shape. Preserve `-`, `+`, and
  // `#` so corrections such as -1→1 and C++→C# are never deduplicated.
  const normalizedCurrent = normalizeRetainedFragment(current);
  if (normalizedCurrent.length >= 8
      && (SHORT_CODING_CONSTRAINT_RE.test(current) || isCodingContinuation(current))
      && normalizeRetainedFragment(active).includes(normalizedCurrent)) return true;

  const words = current.split(/\s+/).filter(Boolean).length;
  if (words > 24 || (!SHORT_CONTEXTUAL_IMPLEMENTATION_RE.test(current) && !SHORT_CODING_CONSTRAINT_RE.test(current))) return false;

  if (isSelfContainedCodingRequest(current)
      && !priorReference
      && hasConflictingSpecificTopic(current, active)) return false;

  return sharesCodingTopic(current, active);
}

/**
 * Resolve one live turn against the retained active coding problem.
 *
 * The prefix is intentional: it gives AnswerPlanner an explicit coding verb even
 * when the original spoken problem is phrased only as requirements (for example,
 * "Service A encrypts and Service B decrypts"). The current request remains last
 * so language/format constraints retain recency.
 */
export function resolveActiveCodingContext(
  currentQuestion: string | null | undefined,
  activeProblem: string | null | undefined,
): ActiveCodingContextResolution {
  const current = (currentQuestion || '').replace(/\s+/g, ' ').trim();
  const active = boundActiveCodingProblem(activeProblem || '');
  const continuation = isCodingContinuation(current);
  const selfContained = isSelfContainedCodingRequest(current);
  const contextDependentFragment = continuation
    || isDurableCodingConstraintFragment(current)
    || VAGUE_OPERATION_LIST_RE.test(current.replace(STANDALONE_CODING_LEAD_RE, '').trim());
  const shouldUse = Boolean(active) && shouldUseActiveCodingProblem(current, active);

  if (shouldUse) {
    return {
      resolvedQuestion: [
        'Implement or refine this active coding problem, preserving every requirement:',
        active,
        '',
        'Current coding request:',
        current,
      ].join('\n'),
      usedActiveProblem: true,
      needsClarification: false,
      isContinuation: true,
    };
  }

  return {
    resolvedQuestion: current,
    usedActiveProblem: false,
    needsClarification: contextDependentFragment && !selfContained,
    isContinuation: contextDependentFragment,
  };
}

/** Append one new requirement without duplicating an echoed/repeated fragment. */
export function mergeActiveCodingProblem(activeProblem: string, fragment: string): string {
  const active = (activeProblem || '').replace(/\s+/g, ' ').trim();
  const rawNext = (fragment || '').replace(/\s+/g, ' ').trim();
  const next = durableConstraintAfterPresentationPrefix(rawNext) ?? rawNext;
  if (!next) return boundActiveCodingProblem(active);
  if (!active) return boundActiveCodingProblem(next);
  if (isCodingPresentationDirective(rawNext)) return boundActiveCodingProblem(active);

  const normalize = (value: string) => value
    .toLowerCase()
    .replace(/[^a-z0-9+#\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const normalizedNext = normalize(next);
  const activeClauses = active.split(/[.!?;]+/).map(normalize).filter(Boolean);
  if (activeClauses.includes(normalizedNext)) return boundActiveCodingProblem(active);
  return boundActiveCodingProblem(`${active}; ${next}`);
}
