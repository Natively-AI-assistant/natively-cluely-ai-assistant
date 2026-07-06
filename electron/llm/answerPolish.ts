// electron/llm/answerPolish.ts
//
// FINAL-BOUNDARY ANSWER POLISH + DIVERSITY GUARD (manual regression 2026-06-12).
//
// Two real-session product-feel failures live here:
//   1. EMPTY BULLET MARKERS — models emit "* " lines with no content; the
//      streaming path has no markdown post-processing, so lone "*" lines reach
//      the UI. cleanAnswerArtifacts() runs at the final-answer boundary (cheap,
//      regex-only) and never touches code blocks.
//   2. REPEATED ANSWERS — over a 200-question session the same intro/scaffold/
//      first-sentence reappears across unrelated prompts and reads as canned.
//      AnswerDiversityGuard keeps the last N answer fingerprints per session
//      and classifies a new answer as repeated (same first sentence, same
//      visible template labels, near-duplicate token overlap). Callers use the
//      verdict to pick an alternate deterministic variant or run one short
//      LLM repair ("rewrite naturally, don't reuse the previous shape").
//
// Pure logic, no I/O, no LLM — callers own any regeneration.

// ── Artifact cleanup ─────────────────────────────────────────────────────────

const CODE_FENCE_RE = /```[\s\S]*?```/g;

/**
 * Remove rendering artifacts from a final answer:
 *  - lines that are ONLY a bullet marker ("*", "* ", "-", "•", "+")
 *  - duplicate blank lines left behind by removed bullets
 *  - a trailing orphan bullet at the very end ("...text *")
 * Code blocks are preserved byte-for-byte.
 */
/** A whole answer that is nothing but a JSON-schema stub the model leaked instead
 *  of prose — e.g. ```json\n{"type":"object"}\n``` or a bare {"type":"object",
 *  "properties":{}}. Observed on the live MiniMax path (E2E campaign p08 Q3).
 *  Matching means the generation failed to produce an answer; we blank it so the
 *  caller's empty-answer path (retry / fallback) takes over instead of surfacing
 *  the stub. Deliberately narrow: only fires when the ENTIRE payload is the stub,
 *  never when JSON is part of a real answer. */
const SCHEMA_STUB_RE = /^\s*(?:```(?:json)?\s*)?\{\s*"(?:type|\$schema|properties|required)"\s*:[\s\S]*?\}\s*(?:```)?\s*$/i;
export function isLeakedSchemaStub(text: string): boolean {
  if (!text) return false;
  const t = text.trim();
  if (t.length > 240) return false; // real answers with JSON are longer than a bare stub
  if (!SCHEMA_STUB_RE.test(t)) return false;
  // Confirm it parses (or nearly) to an object with only schema-ish keys and no
  // human-facing string values — i.e. it carries no actual answer content.
  const inner = t.replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  try {
    const o = JSON.parse(inner);
    if (o && typeof o === 'object') {
      const keys = Object.keys(o);
      const schemaKeys = new Set(['type', '$schema', 'properties', 'required', 'items', 'additionalProperties', 'title', 'description']);
      return keys.length > 0 && keys.every((k) => schemaKeys.has(k));
    }
  } catch { /* not valid JSON but matched the stub shape → still a leak */ return true; }
  return false;
}

/** A leading META-COMMENTARY preamble the model sometimes emits before the real
 *  answer — narrating the task instead of just answering. Observed live (E2E
 *  campaign): "No identity question was actually asked. If I'm asking for a
 *  self-introduction, here it is: I'm a critical care nurse…", "The interviewer
 *  is asking about your interest in the role, so you should respond as the
 *  candidate…". We strip a SINGLE leading meta sentence ONLY when substantive
 *  content clearly follows (a colon hand-off, or ≥60 chars of answer after it),
 *  so a real answer that happens to start with a clause is never truncated. */
const META_PREAMBLE_RE = /^\s*(?:no (?:identity |actual )?question (?:was|is)[^.:!?]*[.:!?]\s*|(?:the )?interviewer is (?:asking|looking)[^.:!?]*[.:!?]\s*|(?:it )?looks like (?:there'?s|the message)[^.:!?]*[.:!?]\s*|if (?:i'?m|you'?re) asking (?:me )?(?:for|about)[^:]*:\s*|(?:the question|this) (?:is|seems to be)[^.:!?]*[.:!?]\s*)+/i;
export function stripMetaPreamble(text: string): string {
  if (!text) return text;
  const m = text.match(META_PREAMBLE_RE);
  if (!m) return text;
  const rest = text.slice(m[0].length).trim();
  // Only strip if a substantive answer remains (avoid turning a short honest
  // "no question was asked" into an empty string).
  if (rest.length >= 60 || /^(i'?m|i |my |here'?s|sure|yeah|so\b)/i.test(rest)) return rest;
  return text;
}

export function cleanAnswerArtifacts(text: string): string {
  if (!text) return text;
  // A leaked JSON-schema stub carries no answer — blank it so the empty-answer
  // retry/fallback path handles it rather than showing "{"type":"object"}".
  if (isLeakedSchemaStub(text)) return '';
  // Strip a leading meta-commentary preamble when a real answer follows.
  text = stripMetaPreamble(text);
  const fences: string[] = [];
  let out = text.replace(CODE_FENCE_RE, (m) => {
    fences.push(m);
    return `FENCE${fences.length - 1}`;
  });

  // Empty bullet lines (just a marker, optionally repeated: "* *", "- -").
  out = out.replace(/^[ \t]*(?:[-*•+][ \t]*)+$/gm, '');
  // A bullet marker dangling at the end of the whole answer.
  out = out.replace(/(?:\s)[-*•+][ \t]*$/g, '');
  // Bullet lines whose content is only punctuation ("* .", "- :").
  out = out.replace(/^[ \t]*[-*•+][ \t]+[.,:;]*[ \t]*$/gm, '');
  // Collapse the blank-line runs the removals leave behind.
  out = out.replace(/\n{3,}/g, '\n\n');

  fences.forEach((f, i) => { out = out.replace(`FENCE${i}`, f); });
  return out.trim();
}

// ── Diversity guard ──────────────────────────────────────────────────────────

/** Visible scaffold labels users reported as robotic. Used both to DETECT
 *  template reuse and to strip labels in speakable compression. */
export const SCAFFOLD_LABEL_RE = /^[ \t]*(?:\*\*)?(The Honest Gap|Why It'?s Manageable|How I'?d Close It|Speakable Final Answer|Short Fit Summary|Matching Experience|Matching Skills\/Projects|Why This Role|Direct Answer|Strong Example(?:\s*\/\s*STAR)?|Why It Matters For This Role|Short Closing Line|Best \/ Relevant Project|What I Built|Tech Stack|My Role|Impact \/ Why It Matters|Polite Opening|Flexible Range \/ Expectation|Justification)(?:\*\*)?\s*:/gim;

const WORD_RE = /[a-z0-9']+/g;

const firstSentence = (text: string): string => {
  const t = text.trim().replace(CODE_FENCE_RE, '');
  const m = t.match(/^[^.!?\n]{8,200}[.!?]/);
  return (m ? m[0] : t.slice(0, 120)).toLowerCase().replace(/\s+/g, ' ').trim();
};

const tokenSet = (text: string): Set<string> => {
  const set = new Set<string>();
  const lower = text.toLowerCase().replace(CODE_FENCE_RE, '');
  for (const m of lower.match(WORD_RE) || []) if (m.length > 2) set.add(m);
  return set;
};

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
};

// ── Stronger-repetition helpers (spoken-answer-quality sprint, 2026-06-15) ─────

/** The normalized first 8 spoken words (fence-stripped) — the "opening window". Eight
 *  words is the stem two answers share when they "start the same way" even if word 9+
 *  diverges ("I think the useful part of my background is …"). */
const OPENING_WINDOW_WORDS = 8;
const openingWindow = (text: string): string => {
  const t = text.replace(CODE_FENCE_RE, ' ').toLowerCase();
  const words = (t.match(/[a-z0-9']+/g) || []).slice(0, OPENING_WINDOW_WORDS);
  return words.join(' ');
};

/** A coarse sentence skeleton: per sentence (first word + a length bucket), joined. Two
 *  answers with the same skeleton open the same way and run the same lengths — a canned
 *  shape even when the nouns differ. */
const sentenceSkeleton = (text: string): string => {
  const t = text.replace(CODE_FENCE_RE, ' ').trim();
  const sentences = t.split(/[.!?]+\s+/).filter((s) => s.trim().length > 0).slice(0, 6);
  return sentences
    .map((s) => {
      const words = s.toLowerCase().match(/[a-z0-9']+/g) || [];
      const first = words[0] || '';
      const bucket = words.length <= 6 ? 's' : words.length <= 14 ? 'm' : 'l';
      return `${first}:${bucket}`;
    })
    .join('|');
};

/** Corporate-phrase cluster fingerprint (reuses the humanizer's banned-filler set). */
const CORPORATE_CLUSTER_RE: ReadonlyArray<RegExp> = [
  /\bunique blend\b/i, /\btechnical rigor\b/i, /\bdata[- ]driven\b/i, /\bactionable insights?\b/i,
  /\bbusiness objectives\b/i, /\bproven track record\b/i, /\bmove the needle\b/i, /\bbridge the gap\b/i,
  /\bhigh[- ]impact\b/i, /\brobust and scalable\b/i, /\bstrategic mindset\b/i, /\bbest[- ]in[- ]class\b/i,
  /\bhigh[- ]performance\b/i, /\bseamless\b/i, /\bdeep expertise\b/i, /\bresults[- ]oriented\b/i,
];
const corporateCluster = (text: string): string => {
  const hits: string[] = [];
  for (const re of CORPORATE_CLUSTER_RE) { const m = text.match(re); if (m) hits.push(m[0].toLowerCase()); }
  return hits.sort().join('|');
};

/** Which of the known projects this answer leans on (first mention wins). Case-insensitive
 *  whole-word match. Used to detect "same project reused when another was available". */
const projectMentionedIn = (text: string, projects?: string[]): string | undefined => {
  if (!projects || projects.length === 0) return undefined;
  const lower = text.toLowerCase();
  for (const p of projects) {
    const name = (p || '').trim();
    if (name.length < 2) continue;
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(lower)) return name.toLowerCase();
  }
  return undefined;
};

export interface AnswerFingerprint {
  firstSentence: string;
  tokens: Set<string>;
  scaffoldLabels: string;     // sorted labels joined — template signature
  answerType: string;
  question: string;
  // Stronger-repetition signals (2026-06-15):
  opening: string;            // first 8-12 spoken words
  skeleton: string;           // sentence skeleton (first word + length bucket per sentence)
  corporate: string;          // sorted corporate-phrase cluster
  project?: string;           // dominant grounded project leaned on (when projects supplied)
}

export type RepetitionReason =
  | 'same_first_sentence'
  | 'same_scaffold'
  | 'near_duplicate'
  | 'same_opening_window'
  | 'same_skeleton'
  | 'same_corporate_cluster'
  | 'same_project_reused';

export interface RepetitionVerdict {
  repeated: boolean;
  reason?: RepetitionReason;
  /** Jaccard similarity to the closest prior answer (debug only). */
  similarity: number;
  /** When reason==='same_project_reused', an unused grounded project to prefer instead. */
  suggestedProject?: string;
}

export interface DiversityCheckOpts {
  /** Grounded project names available this session (for same_project_reused detection). */
  availableProjects?: string[];
}

const fingerprint = (answer: string, answerType: string, question: string, projects?: string[]): AnswerFingerprint => {
  SCAFFOLD_LABEL_RE.lastIndex = 0;
  const labels = [...answer.matchAll(SCAFFOLD_LABEL_RE)].map(m => m[1].toLowerCase()).sort().join('|');
  return {
    firstSentence: firstSentence(answer),
    tokens: tokenSet(answer),
    scaffoldLabels: labels,
    answerType,
    question: question.toLowerCase().trim(),
    opening: openingWindow(answer),
    skeleton: sentenceSkeleton(answer),
    corporate: corporateCluster(answer),
    project: projectMentionedIn(answer, projects),
  };
};

/** Structured / code-bearing answers are never repetition-checked (their shape is
 *  intentional). Mirrors the fence guard used elsewhere. */
const CODE_OR_STRUCTURED_TYPES = new Set([
  'coding_question_answer', 'dsa_question_answer', 'system_design_answer',
  'debugging_question_answer', 'lecture_answer',
]);
const isStructuredOrCode = (answer: string, answerType: string): boolean => {
  if (CODE_OR_STRUCTURED_TYPES.has(answerType)) return true;
  CODE_FENCE_RE.lastIndex = 0;
  return CODE_FENCE_RE.test(answer);
};

/**
 * Are two questions the SAME ASK phrased differently? ("what are your main
 * skills?" / "what are your technical skills?") A factual answer legitimately
 * repeats for synonymous questions — only flag reuse across genuinely
 * DIFFERENT asks. Token-Jaccard over content words, ≥0.6 = same ask.
 */
export const isSameAsk = (a: string, b: string): boolean => {
  if (a === b) return true;
  const ta = tokenSet(a); const tb = tokenSet(b);
  return jaccard(ta, tb) >= 0.6;
};

/** Near-duplicate threshold — two answers to DIFFERENT questions sharing >72%
 *  of their content words read as the same canned answer. */
const NEAR_DUP_JACCARD = 0.72;

/** How many recent answers the OPENING / SKELETON / CORPORATE / PROJECT checks compare
 *  against (the sprint asks for "last 3 spoken answers"). Near-duplicate keeps the full
 *  window since it benefits from more history. */
const RECENT_WINDOW = 3;

export class AnswerDiversityGuard {
  private history: AnswerFingerprint[] = [];
  constructor(private maxItems = 20) {}

  /**
   * Classify a candidate answer against session history. Does NOT record.
   * `opts.availableProjects` enables the "same project reused when another was available"
   * check. Structured/code answers short-circuit to not-repeated (their shape is intentional).
   */
  check(answer: string, answerType: string, question: string, opts?: DiversityCheckOpts): RepetitionVerdict {
    if (isStructuredOrCode(answer, answerType)) return { repeated: false, similarity: 0 };

    const fp = fingerprint(answer, answerType, question, opts?.availableProjects);
    const recent = this.history.slice(-RECENT_WINDOW);
    let maxSim = 0;

    for (const prev of this.history) {
      // The SAME ASK (exact repeat or a synonymous phrasing) legitimately re-yields the
      // same factual answer. Only flag reuse across genuinely DIFFERENT asks.
      if (isSameAsk(prev.question, fp.question)) continue;
      const sim = jaccard(prev.tokens, fp.tokens);
      if (sim > maxSim) maxSim = sim;
      if (fp.firstSentence.length >= 12 && prev.firstSentence === fp.firstSentence) {
        return { repeated: true, reason: 'same_first_sentence', similarity: sim };
      }
      if (fp.scaffoldLabels && prev.scaffoldLabels === fp.scaffoldLabels && sim >= 0.45) {
        return { repeated: true, reason: 'same_scaffold', similarity: sim };
      }
      if (sim >= NEAR_DUP_JACCARD) {
        return { repeated: true, reason: 'near_duplicate', similarity: sim };
      }
    }

    // Stronger checks against the LAST 3 only. Each requires non-trivial token overlap so
    // two genuinely different answers that merely share a stock opener aren't over-flagged.
    for (const prev of recent) {
      if (isSameAsk(prev.question, fp.question)) continue;
      const sim = jaccard(prev.tokens, fp.tokens);
      // Same opening window (first 8 words) — the "every answer starts the same" tell.
      if (fp.opening && fp.opening === prev.opening && fp.opening.split(' ').length >= OPENING_WINDOW_WORDS) {
        return { repeated: true, reason: 'same_opening_window', similarity: sim };
      }
      // Same sentence skeleton + meaningful overlap — a canned shape.
      if (fp.skeleton && fp.skeleton === prev.skeleton && fp.skeleton.includes('|') && sim >= 0.3) {
        return { repeated: true, reason: 'same_skeleton', similarity: sim };
      }
      // Same corporate-phrase cluster (2+ shared filler phrases) — robotic repetition.
      if (fp.corporate && fp.corporate === prev.corporate && fp.corporate.includes('|')) {
        return { repeated: true, reason: 'same_corporate_cluster', similarity: sim };
      }
      // Same project reused when a DIFFERENT grounded project is available.
      if (fp.project && prev.project === fp.project && opts?.availableProjects?.length) {
        const unused = opts.availableProjects.find(
          (p) => p && p.toLowerCase() !== fp.project && !this.history.some((h) => h.project === p.toLowerCase()),
        );
        if (unused) {
          return { repeated: true, reason: 'same_project_reused', similarity: sim, suggestedProject: unused };
        }
      }
    }

    return { repeated: false, similarity: maxSim };
  }

  /** Record a delivered answer. */
  record(answer: string, answerType: string, question: string, opts?: DiversityCheckOpts): void {
    this.history.push(fingerprint(answer, answerType, question, opts?.availableProjects));
    if (this.history.length > this.maxItems) this.history.splice(0, this.history.length - this.maxItems);
  }

  reset(): void { this.history = []; }
  get size(): number { return this.history.length; }
}

/**
 * Deterministically vary a repeated spoken answer's OPENING so back-to-back answers don't
 * start identically. Rotates the leading clause to a different natural opener based on a
 * stable index, WITHOUT changing any facts after the first sentence. Fence-safe (returns
 * input untouched if a code block is present). Used when an LLM repair isn't worth a
 * round-trip. The goal is just to break the "every answer opens the same" tell.
 */
const NATURAL_OPENERS = [
  'Honestly, ', 'The way I\'d put it, ', 'For me, ', 'In practice, ', 'Realistically, ',
];
export function varySpokenOpening(answer: string, rotation: number): string {
  if (!answer) return answer;
  CODE_FENCE_RE.lastIndex = 0;
  if (CODE_FENCE_RE.test(answer)) return answer;
  const trimmed = answer.trimStart();
  // Don't stack openers: if it already starts with a hedge/opener, leave it.
  if (/^(honestly|the way|for me|in practice|realistically|i think|the honest|i'?d be upfront|what i)\b/i.test(trimmed)) {
    return answer;
  }
  const opener = NATURAL_OPENERS[((rotation % NATURAL_OPENERS.length) + NATURAL_OPENERS.length) % NATURAL_OPENERS.length];
  // Lowercase the first letter of the original lead so the opener reads naturally.
  const rest = trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
  return opener + rest;
}

/** The one-shot LLM repair instruction for a repeated answer. */
export const DIVERSITY_REPAIR_INSTRUCTION =
  'Rewrite the answer naturally. Do not reuse the previous answer\'s shape, opening sentence, or section labels. No headings unless the user asked for structure. Keep the same facts and grounding.';

/**
 * Last-resort compression: strip visible scaffold labels and collapse a
 * templated answer into speakable prose. Deterministic — used when a repair
 * still repeats or no LLM is available.
 */
export function compressToSpeakable(answer: string): string {
  if (!answer) return answer;
  // FENCE SAFETY (2026-06-14): speakable compression strips scaffold labels + bullets +
  // newlines to make prose. If the answer contains a fenced code block (``` … ```) or
  // a Mermaid/diagram block, compressing would DELETE the code (the old behavior:
  // `replace(CODE_FENCE_RE, '')`) and mangle the rest. A code/diagram answer is never
  // "speakable prose" anyway, so leave it untouched.
  CODE_FENCE_RE.lastIndex = 0;
  if (CODE_FENCE_RE.test(answer)) return answer;
  let out = answer;
  // Prefer the "Speakable Final Answer" body when present — it IS the prose form.
  const speakable = out.match(/Speakable Final Answer\s*:?\s*\n?([\s\S]+?)(?=\n[A-Z][\w /]+:|$)/i);
  if (speakable && speakable[1].trim().length >= 40) {
    out = speakable[1];
  } else {
    SCAFFOLD_LABEL_RE.lastIndex = 0;
    out = out.replace(SCAFFOLD_LABEL_RE, '');
  }
  // Audit 2026-06-16 (H2): SCAFFOLD_LABEL_RE is a CLOSED list — a model that invents
  // its OWN markdown structure (`## headers`, `**Summary:**`, markdown tables) slips
  // past it into a "spoken" answer. A spoken answer is read aloud, so headings/tables
  // are never appropriate here. Strip them generically (this runs ONLY after the
  // fence-safety early return above, so real code/diagram answers are untouched):
  //  - ATX headers (`#`..`######` at line start) → drop the marker, keep the text
  //  - markdown table separator rows (`|---|---|`) → drop the row
  //  - table cell rows (`| a | b |`) → flatten the pipes to ", " so the content survives as prose
  //  - leading bold "label:" emphasis the model uses as a pseudo-header (`**Use cases:**`)
  out = out
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')              // ATX header markers
    .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)+\|?[ \t]*$/gm, '') // table separator rows
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_m, cells) => String(cells).split('|').map((c) => c.trim()).filter(Boolean).join(', ')) // table data rows → prose
    .replace(/^[ \t]*\*\*([^*\n]{1,40}?):\*\*[ \t]*/gm, '');  // bold pseudo-header "**Label:**"
  out = out.replace(/^[ \t]*[-*•+][ \t]+/gm, '').replace(/\n{2,}/g, ' ').replace(/\s+/g, ' ').trim();
  return cleanAnswerArtifacts(out);
}
