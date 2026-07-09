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
}

const PATTERNS: Array<{ type: QuestionType; re: RegExp }> = [
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
  if (!q) return { type: 'unknown', isSynthesis: false, targetEntities: [] };

  if (FOLLOW_UP_RE.test(q) && q.split(/\s+/).length <= 6) {
    return { type: 'follow_up', isSynthesis: false, targetEntities: extractTargetEntities(q) };
  }

  for (const { type, re } of PATTERNS) {
    if (re.test(q)) {
      return { type, isSynthesis: SYNTHESIS_TYPES.has(type), targetEntities: extractTargetEntities(q) };
    }
  }

  const targetEntities = extractTargetEntities(q);
  if (targetEntities.length > 0) {
    return { type: 'entity_lookup', isSynthesis: false, targetEntities };
  }

  return { type: 'unknown', isSynthesis: false, targetEntities: [] };
}

function extractTargetEntities(question: string): string[] {
  const matches = question.match(ENTITY_TOKEN_RE) || [];
  return [...new Set(matches.map((m) => m.trim()).filter((m) => m.length >= 2 && m.length <= 40))];
}
