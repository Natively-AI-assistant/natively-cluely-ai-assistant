// electron/llm/answerStyle.ts
//
// Adaptive answer-style engine (release 2026-06-08). Best-in-class copilots don't
// answer every question with the same template — "quickly introduce yourself" wants a
// 20-second answer, "walk me through your background" wants 60-90 seconds, "give me
// only the code" wants code with no prose, "explain BFS to a beginner" wants a simple
// concept explanation. This module detects the REQUESTED style/length from the
// question's phrasing (deterministic, no LLM) and produces a STYLE DIRECTIVE the
// prompt contract appends, plus a length hint. It never changes routing, voice,
// grounding, or the leak boundaries — it only shapes FORM (length + format).
//
// Pure + deterministic. Fully dynamic: no profile-/fixture-specific strings.

export type AnswerStyle =
  | 'default'            // no explicit style cue — answer naturally per the answer type
  | 'one_liner'          // "in one line", "one sentence", "tl;dr"
  | 'short'              // "quickly", "briefly", "in short", "keep it short"
  | 'detailed'           // "in detail", "walk me through", "deep dive", "elaborate"
  | 'bullets'            // "bullet points", "list", "as bullets"
  | 'code_only'          // "just the code", "code only", "only give code"
  | 'approach_first'     // "explain your approach", "how would you approach", "intuition first"
  | 'star'               // "tell me about a time", behavioral STAR
  | 'beginner'           // "explain like I'm 5", "to a beginner", "simply"
  | 'exam'               // "6-mark answer", "for the exam", "exam format"
  | 'notes';             // "make notes", "summarize as notes"

export interface AnswerStyleResult {
  style: AnswerStyle;
  /** Soft target for spoken length, in seconds (0 = no explicit constraint). */
  targetSeconds: number;
  /** A short directive appended to the answer contract. '' for default. */
  directive: string;
  /** Why (marker for telemetry — no raw content). */
  reason: string;
}

const lc = (s?: string) => (s || '').toLowerCase();

// Ordered most-specific-first. The FIRST match wins.
const STYLE_RULES: Array<{ style: AnswerStyle; re: RegExp; seconds: number; reason: string }> = [
  // code-only — strongest coding constraint
  { style: 'code_only', re: /\b(just|only)\s+(the\s+)?code\b|\bcode[- ]?only\b|\bonly\s+give\s+(me\s+)?code\b|\bno\s+explanation,?\s+just\b|\bgive\s+me\s+(only\s+)?the\s+code\b/i, seconds: 0, reason: 'code_only' },
  // one-liner
  { style: 'one_liner', re: /\bone[- ]?(line(?:r)?|sentence)\b|\bin\s+(a\s+)?single\s+(line|sentence)\b|\btl;?dr\b|\bin\s+one\s+word\b/i, seconds: 10, reason: 'one_liner' },
  // explicit bullets
  { style: 'bullets', re: /\bbullet(?:s| points| list)?\b|\bas\s+(?:a\s+)?(?:list|bullets)\b|\bin\s+bullet\b|\blist\s+(?:them|the|out)\b/i, seconds: 0, reason: 'bullets' },
  // exam format
  { style: 'exam', re: /\b\d+[- ]?marks?\s+answer\b|\bexam\s+(answer|format|style)\b|\bfor\s+(?:the|my)\s+exam\b|\bwrite\s+(?:a|an)\s+answer\s+for\b.{0,20}\bmarks?\b/i, seconds: 0, reason: 'exam' },
  // notes
  { style: 'notes', re: /\bmake\s+notes\b|\bnote[- ]?form\b|\bas\s+notes\b|\bsummari[sz]e\s+(?:this|that|the).{0,20}\bnotes?\b|\btake\s+notes\b/i, seconds: 0, reason: 'notes' },
  // beginner / ELI5
  { style: 'beginner', re: /\blike\s+i'?m\s+(?:5|five)\b|\beli5\b|\bdumb\s+it\s+down\b|\b(?:to|for)\s+a\s+(?:beginner|newbie|non[- ]?technical|five[- ]?year[- ]?old|layman)\b|\bin\s+simple\s+terms\b|\bexplain\s+(?:it\s+)?simply\b/i, seconds: 0, reason: 'beginner' },
  // approach-first (coding intuition before code)
  { style: 'approach_first', re: /\bexplain\s+(?:your|the)\s+approach\b|\bhow\s+would\s+you\s+approach\b|\b(?:intuition|approach|strategy)\s+first\b|\bwalk\s+me\s+through\s+(?:your|the)\s+(?:approach|thinking|logic)\b|\bbefore\s+(?:you\s+)?coding\b/i, seconds: 0, reason: 'approach_first' },
  // STAR (behavioral) — "tell me about a time" etc.
  { style: 'star', re: /\btell\s+me\s+about\s+a\s+time\b|\bdescribe\s+a\s+(?:situation|time)\b|\bgive\s+(?:me\s+)?an?\s+example\s+of\s+a\s+time\b|\bwalk\s+me\s+through\s+a\s+(?:time|situation)\b|\b(?:using|use|in|with)\s+(?:the\s+)?star\b|\bstar\s+(?:format|method|structure)\b/i, seconds: 60, reason: 'star' },
  // detailed / long
  { style: 'detailed', re: /\bin\s+(?:full\s+)?detail\b|\bwalk\s+me\s+through\b|\bdeep[- ]?dive\b|\belaborate\b|\bgo\s+deep(?:er)?\b|\bin[- ]?depth\b|\bcomprehensive(?:ly)?\b|\bthoroughly\b|\bgive\s+me\s+(?:the\s+)?(?:full|complete|detailed)\b/i, seconds: 75, reason: 'detailed' },
  // short / quick / brief. "short" excludes "short-term" (a goals phrase, not a length cue).
  { style: 'short', re: /\b(?:quick(?:ly)?|brief(?:ly)?|short(?:ly)?(?!\s?-?\s?term)|concise(?:ly)?|in\s+short|keep\s+it\s+(?:short|brief|quick|tight)|in\s+a\s+nutshell|short\s+version|give\s+me\s+the\s+gist|just\s+(?:the\s+)?(?:gist|highlights|summary))\b/i, seconds: 25, reason: 'short' },
];

/**
 * Detect the requested answer style from the question's phrasing. Returns 'default'
 * when no explicit cue is present (the answer type's own template governs).
 */
export function detectAnswerStyle(question: string): AnswerStyleResult {
  const q = lc(question);
  if (!q.trim()) return { style: 'default', targetSeconds: 0, directive: '', reason: 'empty' };
  for (const rule of STYLE_RULES) {
    if (rule.re.test(q)) {
      return { style: rule.style, targetSeconds: rule.seconds, directive: directiveFor(rule.style, rule.seconds), reason: rule.reason };
    }
  }
  return { style: 'default', targetSeconds: 0, directive: '', reason: 'no_cue' };
}

/** The STYLE directive appended to the answer contract (form only — never grounding/voice). */
function directiveFor(style: AnswerStyle, seconds: number): string {
  switch (style) {
    case 'one_liner':
      return 'STYLE: Answer in ONE short sentence. No preamble, no list, no headers.';
    case 'short':
      return `STYLE: Keep it SHORT and speakable — about ${seconds || 25} seconds (2-3 sentences). Lead with the answer; cut filler.`;
    case 'detailed':
      return `STYLE: Give a fuller, structured answer (about ${seconds || 75} seconds). Cover the key points in order, but stay speakable — no walls of text.`;
    case 'bullets':
      return 'STYLE: Answer as a short bulleted list (3-6 bullets), each one line. No long paragraphs.';
    case 'code_only':
      return 'STYLE: Output ONLY the code in a single fenced block. No prose before or after, no explanation.';
    case 'approach_first':
      // Code-agnostic: this style fires on coding ("approach before coding") AND on
      // strategy/behavioral ("how would you approach a stakeholder") — so the directive
      // must not assume code (code-review 2026-06-08).
      return 'STYLE: Explain the APPROACH/intuition first in 2-3 sentences, THEN the specifics. Lead with the idea, not the implementation.';
    case 'star':
      return 'STYLE: Use the STAR shape — Situation, Task, Action, Result — in first person, concise and speakable (about 60 seconds). Name a concrete, grounded example; do not invent metrics.';
    case 'beginner':
      return 'STYLE: Explain simply, for a beginner — plain words, one concrete analogy if helpful, no jargon dumps.';
    case 'exam':
      return 'STYLE: Write an exam-style answer — structured points matched to the marks, each point a complete statement. Define key terms.';
    case 'notes':
      return 'STYLE: Produce concise structured NOTES — short headed bullets capturing the key facts. No conversational filler.';
    case 'default':
    default:
      return '';
  }
}

/**
 * Some styles imply a different FORMAT than the answer type's default scaffold. A
 * code-only request on a coding answer should suppress the six-section scaffold;
 * bullets/notes shouldn't get a prose template. The caller uses this to decide
 * whether to keep the structured scaffold.
 */
export function styleSuppressesScaffold(style: AnswerStyle): boolean {
  return style === 'code_only' || style === 'one_liner';
}
