// electron/services/knowledge/QuestionClassifier.ts
//
// OKF Phase 3 — lightweight deterministic question-type classifier used to
// decide OKF card retrieval strategy (return all cards for synthesis
// questions vs. score individual cards for entity lookups) and to compute
// the answer-policy tier alongside EvidenceAssembler.

export type QuestionType =
  | 'main_topic'
  | 'summary'
  | 'problem_statement'
  | 'research_questions'
  | 'objectives'
  | 'definition'
  | 'comparison'
  | 'method'
  | 'result'
  | 'conclusion'
  | 'entity_lookup'
  | 'metadata'
  | 'follow_up'
  | 'unknown';

const SYNTHESIS_TYPES: ReadonlySet<QuestionType> = new Set([
  'main_topic', 'summary', 'problem_statement', 'research_questions', 'objectives', 'conclusion',
]);

export interface QuestionClassification {
  type: QuestionType;
  isSynthesis: boolean;
  /** High-signal entity/term candidates extracted from the question (capitalized phrases, acronyms, quoted terms). */
  targetEntities: string[];
  /**
   * Entities that name the QUERIED CATEGORY rather than a constraint the answer
   * must literally contain — a bare uppercase acronym in interrogative-subject
   * position ("what LLM performs…", "which GPU was used…", "what VRAM size…").
   * These are useful for retrieval scoring but must NOT gate answerability: the
   * answer chunk that names the specific instance ("uses LLaMA 3.2 7B as its
   * backbone") frequently never repeats the category token itself, so requiring
   * it verbatim produces a false insufficient-evidence refusal. Generic English
   * interrogative grammar only; no document terms.
   */
  softEntities: string[];
}

const PATTERNS: Array<{ type: QuestionType; re: RegExp }> = [
  // Document-identity / title-page metadata. Generic label vocabulary — a
  // question ABOUT the document's own metadata (author, title, date, language,
  // advisor, supervisor, keywords, page count, degree, institution). Placed
  // first so it wins over the broader main_topic/definition patterns. It must
  // reference the document's OWN identity, not a same-named body concept, so
  // "language" requires a document-scoped subject (thesis/paper/document/it) to
  // avoid catching "what programming language was used" (a software question).
  { type: 'metadata', re: /\b(who\s+(?:is|wrote|are)\s+the\s+(?:author|writer)|author\s+of\s+the|title\s+of\s+the\s+(?:thesis|paper|document|report|dissertation)|full\s+title|(?:name|list)\s+(?:an?\s+|the\s+|one\s+|two\s+)?(?:advisors?|supervisors?|examiners?)|advisors?\s+listed|supervisors?\s+listed|(?:what|which)\s+(?:date|language|institution|university|degree|department|keywords?)\s+(?:is|are|does|listed|written)|number\s+of\s+pages|how\s+many\s+pages|(?:what|which)\s+language\s+(?:is|was)\s+the\s+(?:thesis|paper|document|report|it)|keywords?\s+(?:listed|for\s+the))/i },
  { type: 'main_topic', re: /\b(main topic|what is .*(thesis|paper|document|project) about|overview)\b/i },
  { type: 'summary', re: /\b(simple words|summari[sz]e|explain .* (simply|briefly)|tl;?dr)\b/i },
  { type: 'problem_statement', re: /\b(problem (is|does|are).*(solv|address)|what problem)\b/i },
  { type: 'research_questions', re: /\b(research questions?|RQ\d)\b/i },
  { type: 'objectives', re: /\b(objectives?|goals?|aims?|phases?)\b/i },
  { type: 'comparison', re: /\b(difference|different from|compare|versus|vs\.?|better than)\b/i },
  { type: 'method', re: /\b(how (is|does|was)|method|approach|implementation|technique)\b/i },
  { type: 'result', re: /\b(result|finding|benchmark|evaluation|success rate|outcome)\b/i },
  { type: 'conclusion', re: /\b(conclusion|future work|limitation|takeaway)\b/i },
  { type: 'definition', re: /\b(what (is|are|does)\b.*\bmean|define|definition of)\b/i },
];

const FOLLOW_UP_RE = /\b(it|that|this|those|these|the(?:m|y))\b.{0,20}$|^(and|also|what about|tell me more)\b/i;

const ENTITY_TOKEN_RE = /\b(?:[A-Z][a-z0-9]+(?:[-\s][A-Z][A-Za-z0-9]+){1,3}|[A-Z][a-zA-Z]*[A-Z][a-zA-Z0-9-]*|[A-Z]{2,6})\b/g;

export function classifyQuestion(question: string): QuestionClassification {
  const q = (question || '').trim();
  if (!q) return { type: 'unknown', isSynthesis: false, targetEntities: [], softEntities: [] };

  const softEntities = extractSoftCategoryEntities(q);

  if (FOLLOW_UP_RE.test(q) && q.split(/\s+/).length <= 6) {
    return { type: 'follow_up', isSynthesis: false, targetEntities: extractTargetEntities(q, softEntities), softEntities };
  }

  for (const { type, re } of PATTERNS) {
    if (re.test(q)) {
      return { type, isSynthesis: SYNTHESIS_TYPES.has(type), targetEntities: extractTargetEntities(q, softEntities), softEntities };
    }
  }

  const targetEntities = extractTargetEntities(q, softEntities);
  if (targetEntities.length > 0) {
    return { type: 'entity_lookup', isSynthesis: false, targetEntities, softEntities };
  }

  return { type: 'unknown', isSynthesis: false, targetEntities: [], softEntities };
}

// Sentence-initial interrogatives / imperatives that ENTITY_TOKEN_RE wrongly
// fuses onto a following capitalized acronym: "What VRAM", "Which GPU", "Name
// MoveIt", "List ROS". These are NOT part of the entity — leaving them in makes
// the downstream sufficiency gate require the evidence to literally contain
// "What VRAM", which no answer chunk does, causing a false insufficient-evidence
// refusal. Generic English question words only; no document terms.
const LEADING_QUESTION_WORD_RE = /^(?:What|Which|Who|Whom|Whose|Where|When|Why|How|Name|List|Give|Tell|Does|Did|Do|Is|Are|Was|Were|Can|Could|Would|Should|The|A|An)\s+/;

// A bare uppercase acronym (2–5 letters) that is the interrogative SUBJECT —
// the first token after "What/Which/Whose" — and is followed by a predicate
// (NOT a copula). That grammar means the acronym is the CATEGORY being asked
// for ("what LLM performs…", "which GPU was used…", "what VRAM size…"), not a
// constraint the answer text must literally contain. Copula-followed acronyms
// ("what is VLA", "what does ROS mean") are genuine entity lookups and are left
// as hard entities. Generic English grammar only; no document vocabulary.
const CATEGORY_SUBJECT_ACRONYM_RE = /^(?:What|Which|Whose)\s+([A-Z]{2,5})\s+(\w+)/;
// Only DEFINITIONAL copulas — asking what the acronym ITSELF is/means — keep the
// acronym a hard entity ("what is VLA", "what does ROS mean", "what VLA stands
// for"). Passive auxiliaries ("what MRSE did X have", "what VLM does Y extend")
// are category questions whose answer is a specific value/instance, so their
// acronym is soft. Generic grammar; no document terms.
const CATEGORY_SUBJECT_COPULA_RE = /^(?:is|are|means?|stands?|stood|refers?|denotes?)$/i;

function extractSoftCategoryEntities(question: string): string[] {
  const m = question.match(CATEGORY_SUBJECT_ACRONYM_RE);
  if (!m) return [];
  if (CATEGORY_SUBJECT_COPULA_RE.test(m[2])) return [];
  return [m[1]];
}

function extractTargetEntities(question: string, softEntities: string[] = []): string[] {
  const soft = new Set(softEntities.map((s) => s.toLowerCase()));
  const matches = question.match(ENTITY_TOKEN_RE) || [];
  const cleaned = matches
    .map((m) => m.trim().replace(LEADING_QUESTION_WORD_RE, '').trim())
    .filter((m) => m.length >= 2 && m.length <= 40)
    .filter((m) => !soft.has(m.toLowerCase()));
  return [...new Set(cleaned)];
}
