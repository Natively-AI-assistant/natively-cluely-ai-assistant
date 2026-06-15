import type { AnswerType } from './AnswerPlanner';
import { CODING_SECTIONS as CANONICAL_CODING_SECTIONS } from './codingContract';

export interface CodingAnswer {
  approach: string;
  technique: string;
  language: string;
  code: string;
  dryRun: string;
  complexity: string;
  interviewerFollowUpPoints: string[];
}

export interface AnswerValidationResult {
  ok: boolean;
  missingSections: string[];
  hasCodeBlock: boolean;
  hasComplexity: boolean;
  repaired?: string;
}

// Single source of truth — shared with every prompt surface via codingContract.
const CODING_SECTIONS = [...CANONICAL_CODING_SECTIONS];

const REQUIRED_MARKDOWN_HEADINGS = CODING_SECTIONS.map(section => `## ${section}`);

const sectionHeader = (label: string): RegExp =>
  new RegExp(`^\\s*#{0,3}\\s*(?:\\*\\*)?\\s*(?:${label})\\s*(?:\\*\\*)?\\s*(?::|[-–—])?\\s*$`, 'im');

const SECTION_ALIASES: Record<string, RegExp[]> = {
  Approach: [sectionHeader('Approach')],
  'Technique / Data Structure / Algorithm Used': [
    sectionHeader('Technique|Data Structure|Algorithm Used|Technique \\/ Data Structure \\/ Algorithm Used'),
  ],
  Code: [sectionHeader('Code')],
  'Dry Run': [sectionHeader('Dry Run')],
  Complexity: [sectionHeader('Complexity')],
  'Interviewer Follow-up Points': [
    sectionHeader('Interviewer Follow-up Points|Follow-up Points|Follow-ups'),
  ],
};

const hasSection = (answer: string, section: string): boolean =>
  SECTION_ALIASES[section]?.some(pattern => pattern.test(answer)) ?? false;

const hasCodeBlock = (answer: string): boolean => /```[a-zA-Z0-9+#-]*\n[\s\S]+?```/.test(answer);
const hasLanguageTaggedCodeBlock = (answer: string): boolean => /```[a-zA-Z0-9+#-]+\n[\s\S]+?```/.test(answer);
// Big-O may be wrapped in LaTeX ($O(n)$ / \(O(n)\)), backticks (`O(n)`), or bare.
// Allow an optional opener (`$`, `\(`, backtick) between the label and the O(.
const hasComplexity = (answer: string): boolean =>
  /\bTime(?:\s+Complexity)?\s*:?\s*(?:`|\$|\\\()?\s*O\s*\(/i.test(answer)
  && /\bSpace(?:\s+Complexity)?\s*:?\s*(?:`|\$|\\\()?\s*O\s*\(/i.test(answer);

const isCodingType = (answerType: AnswerType): boolean =>
  answerType === 'coding_question_answer' || answerType === 'dsa_question_answer';

const startsWithCodeLikeContent = (answer: string): boolean => {
  const trimmed = answer.trimStart();
  return /^```/.test(trimmed)
    || /^(def|function|class|const|let|var|public|private|import|from|SELECT\b|WITH\b)\b/i.test(trimmed);
};

const headingPositions = (answer: string): number[] => REQUIRED_MARKDOWN_HEADINGS.map(heading => answer.indexOf(heading));

const hasExactMarkdownSectionOrder = (answer: string): boolean => {
  const positions = headingPositions(answer);
  if (positions.some(position => position < 0)) return false;
  return positions.every((position, index) => index === 0 || positions[index - 1] < position);
};

const containsForbiddenCodingContext = (answer: string): boolean =>
  /\b(resume|job description|salary|compensation|negotiation|OpenOffer|as an AI|AI assistant)\b/i.test(answer);

/**
 * Deterministic, content-free coding scaffold for IMMEDIATE display while the
 * model streams. Paints the six canonical headings with neutral "working…"
 * placeholders so the user sees correct structure in <500ms and NEVER a raw
 * code-first stream (REPORT hypothesis C1 / Phase 8). The live path replaces
 * this with the validated final answer once the stream completes. Pure & local.
 */
export const buildCodingScaffold = (): string => `## Approach

_Working on the approach…_

## Technique / Data Structure / Algorithm Used

_Identifying the core technique…_

## Code

_Writing the solution…_

## Dry Run

_Preparing a sample walkthrough…_

## Complexity

_Analyzing time and space complexity…_

## Interviewer Follow-up Points

_Gathering likely follow-ups…_`;

export const renderCodingAnswerMarkdown = (answer: CodingAnswer): string => {
  const language = (answer.language || 'python').trim() || 'python';
  const followUps = answer.interviewerFollowUpPoints.length > 0
    ? answer.interviewerFollowUpPoints.map(point => `- ${point.trim()}`).join('\n')
    : '- Clarify edge cases and assumptions with the interviewer.';

  return `
## Approach

${answer.approach.trim()}

## Technique / Data Structure / Algorithm Used

${answer.technique.trim()}

## Code

\`\`\`${language}
${answer.code.trim()}
\`\`\`

## Dry Run

${answer.dryRun.trim()}

## Complexity

${answer.complexity.trim()}

## Interviewer Follow-up Points

${followUps}
`.trim();
};

const extractFirstCodeBlock = (answer: string): { language: string; code: string; block: string } | null => {
  const match = answer.match(/```([a-zA-Z0-9+#-]*)\n([\s\S]+?)```/);
  if (!match) return null;
  return {
    language: match[1]?.trim() || 'python',
    code: match[2]?.trim() || '',
    block: match[0],
  };
};

const stripCodeBlock = (answer: string, block?: string): string => block ? answer.replace(block, '').trim() : answer.trim();

const inferLanguage = (answer: string, explicit?: string): string => {
  if (explicit && explicit.trim()) return explicit.trim();
  if (/\b(javascript|js)\b/i.test(answer)) return 'javascript';
  if (/\btypescript|\bts\b/i.test(answer)) return 'typescript';
  if (/\bjava\b/i.test(answer)) return 'java';
  if (/\bc\+\+|cpp\b/i.test(answer)) return 'cpp';
  if (/\bsql\b/i.test(answer)) return 'sql';
  return 'python';
};

// Presentable fallbacks for genuinely-absent sections. These are written as
// real, candidate-speakable content — NOT italic self-instructions — because a
// repaired answer is shown directly to the user and an instruction like
// "_Name the data structure used._" reads as leaked prompt scaffolding. Repair
// still fabricates no problem-specific FACT (no invented Big-O, no canned code).
const MISSING_COMPLEXITY_MARKER =
  'Time Complexity: O(?) — state the actual time bound and why.\n\nSpace Complexity: O(?) — state the actual space bound and why.';
// A neutral but presentable dry-run line. Reads as a sentence, not an instruction.
const MISSING_DRY_RUN_MARKER = 'Trace a small sample input through the code step by step to confirm it produces the expected output.';
const MISSING_TECHNIQUE_MARKER = 'See the approach above for the core technique.';
const MISSING_APPROACH_MARKER = 'Solve the problem with the most direct correct method, then optimize.';
const MISSING_CODE_MARKER = '// The model did not return code. Regenerate for a complete solution.';

/**
 * Pull whatever complexity text the model actually wrote, so a correct answer
 * that merely lacked the exact `## Complexity` heading keeps ITS complexity —
 * we never overwrite a real O(...) with a fabricated one. Captures a line that
 * mentions Time/Space + O(...), plus an adjacent Space line when present.
 * Returns null when the model gave no complexity at all (→ neutral marker).
 */
// Optional leading connector that introduces a complexity clause mid-sentence
// ("…, which is O(n) time", "…running in O(n)", "…giving O(n log n)"). Captured
// as part of the complexity span so that BOTH halves of the rewrite agree: the
// connector + Big-O moves to the Complexity section, and the Approach is left
// with the clean lead clause (no dangling "which is and").
// An optional leading "This/It/That [is]" subject lets a standalone clause like
// "This runs in O(n) time." be removed whole (no stranded "This.").
const COMPLEXITY_CONNECTOR = `(?:(?:\\b(?:this|it|that)\\b\\s+(?:is\\s+)?)?,?\\s*(?:which is|which runs? in|running in|that runs? in|runs? in|giving|yielding|for a|with|in)\\s+)?`;
// Trailing complementary term so "O(n) time and O(1) space" is captured whole.
const COMPLEXITY_TAIL = `(?:\\s*(?:time|space))?(?:\\s*(?:and|,)\\s*`+'`?'+`O\\s*\\([^)]*\\)`+'`?'+`(?:\\s*(?:time|space))?)?(?:[^.\\n]*?(?:because|due to)[^.\\n]*)?`;

// Matches the full complexity CLAUSE (connector + Big-O(s) + tail), not a whole
// line and not a bare token. Two entry shapes: a labelled "Time/Space …O(...)"
// statement, or an inline "…<connector> O(...) time/space" clause.
const COMPLEXITY_FRAGMENT_RE = new RegExp(
  `(?:(?:time|space)\\s*(?:complexity)?\\s*[:=]?\\s*\`?O\\s*\\([^)]*\\)\`?${COMPLEXITY_TAIL})`
  + `|(?:${COMPLEXITY_CONNECTOR}\`?O\\s*\\([^)]*\\)\`?${COMPLEXITY_TAIL})`,
  'gi',
);
const BARE_BIGO_WITH_KIND_RE = /\bO\s*\([^)]*\)\s*(?:time|space)\b|\b(?:time|space)\s+O\s*\([^)]*\)/gi;

const extractComplexityText = (prose: string): string | null => {
  const fragments = new Set<string>();
  for (const m of prose.matchAll(COMPLEXITY_FRAGMENT_RE)) {
    // Trim a leading subject + connector/comma so the lifted Complexity text
    // reads cleanly ("This runs in O(n) time" → "O(n) time", "which is O(n)"
    // → "O(n)"). Kept in sync with COMPLEXITY_CONNECTOR (which the capture uses).
    const frag = m[0].replace(/^[\s,]*(?:(?:this|it|that)\s+(?:is\s+)?)?(?:which is|which runs? in|running in|that runs? in|runs? in|giving|yielding|for a|with|in)\s+/i, '').trim();
    if (frag) fragments.add(frag);
  }
  if (fragments.size === 0) {
    for (const m of prose.matchAll(BARE_BIGO_WITH_KIND_RE)) {
      const frag = m[0].trim();
      if (frag) fragments.add(frag);
    }
  }
  if (fragments.size > 0) return [...fragments].join('\n\n');
  // Last resort: a bare "O(n)" with no time/space label is still the model's own
  // estimate — preserve it (labelled as unverified) rather than fabricate.
  const bareBigO = prose.match(/O\s*\([^)]*\)/i);
  return bareBigO ? `Time Complexity: ${bareBigO[0]} (as stated by the model — verify).` : null;
};

export const repairCodingAnswer = (answer: string, question?: string, language?: string): string => repairCodingMarkdown(answer, question, language);

// ── Section-aware parsing ────────────────────────────────────────────────────
// The model usually DID write the right sections — just under a heading style
// the strict validator didn't accept (e.g. "Iteration with Step / List
// Comprehension" instead of "## Technique …", or `## Complexity` with LaTeX
// inside). Rather than shred the prose, repair PARSES the model's own sections
// by ANY heading style and maps them to the six canonical ones, preserving each
// section's content VERBATIM (math `$O(n)$`, code, everything). This is
// non-destructive: nothing is fabricated, nothing is corrupted.

type CanonicalKey = 'approach' | 'technique' | 'code' | 'dryRun' | 'complexity' | 'followUps';

// Map a free-form heading title to a canonical section. Returns null when the
// title doesn't clearly correspond to one (then it's treated as body text).
const headingToCanonical = (title: string): CanonicalKey | null => {
  const t = title.toLowerCase().replace(/[*_`#]/g, '').trim();
  if (/^approach\b|^intuition\b|^idea\b|^solution\b|^overview\b/.test(t)) return 'approach';
  if (/technique|data structure|algorithm|pattern|method used/.test(t)) return 'technique';
  if (/^code\b|^implementation\b|^solution code\b/.test(t)) return 'code';
  if (/dry run|walkthrough|walk through|trace|example run|step[- ]by[- ]step/.test(t)) return 'dryRun';
  if (/complexity|time.*space|big[- ]?o|analysis/.test(t)) return 'complexity';
  if (/follow[- ]?up|interviewer|edge case|gotcha|notes?\b/.test(t)) return 'followUps';
  return null;
};

// A heading line: markdown `#{1,3}`, OR bold `**Title**`, OR a short Title-case
// line ending with optional colon (no sentence punctuation). Captures the title.
const HEADING_LINE_RE = /^\s*(?:#{1,3}\s*(.+?)|\*\*(.+?)\*\*\s*:?|([A-Z][^.!?\n]{2,60}?))\s*:?\s*$/;

interface ParsedSections {
  sections: Partial<Record<CanonicalKey, string>>;
  /** Body text that appeared before/between recognized headings (no section). */
  preamble: string;
  /** How many canonical sections were confidently recognized. */
  recognized: number;
}

// Parse the answer into canonical sections by walking lines and switching the
// "current section" whenever a recognized heading appears. Content (including a
// fenced code block, which may contain heading-looking lines) is kept verbatim.
const parseModelSections = (text: string): ParsedSections => {
  const sections: Partial<Record<CanonicalKey, string>> = {};
  const preambleLines: string[] = [];
  let current: CanonicalKey | null = null;
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    const content = buffer.join('\n').trim();
    if (current) {
      sections[current] = sections[current] ? `${sections[current]}\n${content}` : content;
    } else if (content) {
      preambleLines.push(content);
    }
    buffer = [];
  };

  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    // Headings are never inside a fenced code block.
    const headingMatch = !inFence ? line.match(HEADING_LINE_RE) : null;
    const title = headingMatch ? (headingMatch[1] ?? headingMatch[2] ?? headingMatch[3] ?? '') : '';
    const canonical = headingMatch ? headingToCanonical(title) : null;
    if (canonical) {
      flush();
      current = canonical;
      continue;
    }
    buffer.push(line);
  }
  flush();

  return { sections, preamble: preambleLines.join('\n').trim(), recognized: Object.keys(sections).length };
};

/**
 * Deterministic STRUCTURAL repair — NON-DESTRUCTIVE. The model almost always
 * wrote the right content; it just used a heading style the strict validator
 * rejected, or a code-first order. So we:
 *   1. PARSE the model's own sections by any heading style, preserving content
 *      verbatim (LaTeX/math/code untouched — never corrupted into `$$`).
 *   2. Map them to the six canonical sections and re-emit in order.
 *   3. For a genuinely-absent section, use a PRESENTABLE fallback line (never an
 *      italic self-instruction that reads as leaked prompt) and never fabricate
 *      a problem-specific Big-O.
 * Only when no sections can be parsed do we fall back to the legacy prose-dump.
 */
export const repairCodingMarkdown = (rawResponse: string, question?: string, language?: string): string => {
  const trimmed = rawResponse.trim();
  const codeBlock = extractFirstCodeBlock(trimmed);
  const inferredLanguage = inferLanguage(`${question || ''}\n${trimmed}`, language || codeBlock?.language);
  const code = codeBlock?.code || MISSING_CODE_MARKER;

  const parsed = parseModelSections(trimmed);

  // Approach: prefer a parsed Approach section; else the preamble (prose before
  // any heading); else a presentable fallback. Strip any code fence that landed
  // inside it (the code lives in its own section).
  const approachRaw = (parsed.sections.approach || parsed.preamble || '').trim();
  const approach = stripCodeBlock(approachRaw, codeBlock && approachRaw.includes(codeBlock.block) ? codeBlock.block : undefined).trim()
    || MISSING_APPROACH_MARKER;

  // Technique: parsed section, else a short pointer (NOT an instruction).
  const technique = (parsed.sections.technique || '').trim() || MISSING_TECHNIQUE_MARKER;

  // Dry run: parsed section, else a presentable neutral line.
  const dryRun = (parsed.sections.dryRun || '').trim() || MISSING_DRY_RUN_MARKER;

  // Complexity: prefer the model's OWN parsed Complexity section VERBATIM (keeps
  // $O(N)$ / O(n log n) intact — no fragment surgery, no `$$` corruption). Only
  // if there's no complexity section AND no extractable bound do we use the
  // honest O(?) placeholder.
  const complexitySection = (parsed.sections.complexity || '').trim();
  const complexity = complexitySection
    || extractComplexityText(parsed.preamble) // bound stated inline in prose
    || MISSING_COMPLEXITY_MARKER;

  // Follow-ups: parsed section (as lines) or the standard two prompts.
  const followUpsSection = (parsed.sections.followUps || '').trim();
  const interviewerFollowUpPoints = followUpsSection
    ? followUpsSection.split('\n').map(l => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean)
    : [
        'Clarify edge cases such as empty input, duplicates, and boundary values.',
        'Be ready to justify the time and space complexity.',
      ];

  return renderCodingAnswerMarkdown({
    approach,
    technique,
    language: inferredLanguage,
    code,
    dryRun,
    complexity,
    interviewerFollowUpPoints,
  });
};

export const validateCodingMarkdown = (response: string): AnswerValidationResult => {
  const answer = response.trim();
  const missingSections = CODING_SECTIONS.filter(section => !hasSection(answer, section));
  const codeBlock = hasCodeBlock(answer);
  const complexity = hasComplexity(answer);
  const ordered = hasExactMarkdownSectionOrder(answer);
  const startsWithCode = startsWithCodeLikeContent(answer);
  const hasTaggedBlock = hasLanguageTaggedCodeBlock(answer);
  const leaksContext = containsForbiddenCodingContext(answer);

  const ok = missingSections.length === 0
    && codeBlock
    && hasTaggedBlock
    && complexity
    && ordered
    && !startsWithCode
    && !leaksContext;

  return {
    ok,
    missingSections,
    hasCodeBlock: codeBlock,
    hasComplexity: complexity,
    repaired: ok ? undefined : repairCodingMarkdown(answer),
  };
};

export const validateAnswerStructure = (answerType: AnswerType, answer: string): AnswerValidationResult => {
  if (!isCodingType(answerType)) {
    return {
      ok: true,
      missingSections: [],
      hasCodeBlock: hasCodeBlock(answer),
      hasComplexity: hasComplexity(answer),
    };
  }

  return validateCodingMarkdown(answer);
};
