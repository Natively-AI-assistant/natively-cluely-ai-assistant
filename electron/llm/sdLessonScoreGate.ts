// electron/llm/sdLessonScoreGate.ts
//
// Post-gate LESSON score gate + Deep Dive / NFR section preference (SPEC 02).
// Requirements-phase LESSON allowlisting stays in sdRequirementsGate.ts —
// these helpers are identity when sdPhase === 'requirements'.

export type SdPhase = 'requirements' | 'post_requirements';

/** Post-gate omit threshold (above KnowledgeDatabaseManager floor ~0.25). */
export const POST_GATE_LESSON_SIMILARITY_THRESHOLD = 0.5;

export type ScoredLessonChunk = { text: string; similarity: number };

/**
 * Exclude weak LESSON matches for post-gate (and unset/legacy) turns.
 * Identity when sdPhase=requirements so Requirements allowlisting stays sole owner.
 */
export function applyScoreGate<T extends { similarity: number }>(
  chunks: T[],
  sdPhase: SdPhase | undefined | null,
  threshold: number = POST_GATE_LESSON_SIMILARITY_THRESHOLD,
): T[] {
  if (sdPhase === 'requirements') return chunks;
  return chunks.filter((c) => typeof c.similarity === 'number' && c.similarity >= threshold);
}

const PREFERRED_HEADING_RE =
  /^(?:potential\s+)?deep\s+dives?|non[- ]?functional\s+requirements|nfr|scalability|performance|reliability|trade[- ]?offs?$/i;

const DEPRIORITIZED_HEADING_RE =
  /^understanding\s+the\s+problem|functional\s+requirements$/i;

function normalizeHeading(h: string): string {
  return h.replace(/^#+\s*/, '').trim().toLowerCase();
}

function sliceMarkdownHeadings(markdown: string): string[] {
  const headings: string[] = [];
  for (const line of String(markdown || '').split(/\r?\n/)) {
    const hm = /^(#{1,3})\s+(.+)$/.exec(line);
    if (hm) headings.push(hm[2].trim());
  }
  return headings;
}

/** 0 = preferred, 1 = neutral, 2 = deprioritized-only. */
function chunkPreferenceRank(text: string): number {
  const headings = sliceMarkdownHeadings(text);
  if (headings.length === 0) return 1;
  let hasPreferred = false;
  let hasDeprioritized = false;
  let hasNeutral = false;
  for (const h of headings) {
    const n = normalizeHeading(h);
    if (PREFERRED_HEADING_RE.test(n)) hasPreferred = true;
    else if (DEPRIORITIZED_HEADING_RE.test(n)) hasDeprioritized = true;
    else hasNeutral = true;
  }
  if (hasPreferred) return 0;
  if (hasNeutral) return 1;
  if (hasDeprioritized) return 2;
  return 1;
}

/**
 * Sort preference for post-gate inject: Deep Dive / NFR / scalability-family
 * ahead of Understanding / FR. Not a hard filter — deprioritized-only sets still inject.
 * Identity when sdPhase=requirements.
 */
export function preferDeepDiveSections<T extends { text: string }>(
  chunks: T[],
  sdPhase: SdPhase | undefined | null,
): T[] {
  if (sdPhase === 'requirements') return chunks;
  return chunks
    .map((chunk, index) => ({ chunk, index, rank: chunkPreferenceRank(chunk.text) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.chunk);
}
