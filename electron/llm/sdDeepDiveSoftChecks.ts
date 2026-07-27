// electron/llm/sdDeepDiveSoftChecks.ts
//
// Post-stream structural soft checks for spoken post-gate SD answers (SPEC 07).
// Label / flag / rare soft-truncate only — never hard-refuse. Fail-open.
// Identity when sdPhase === 'requirements' (Requirements gate owns that phase).

export interface DeepDiveCheckContext {
  /** false = LESSON was omitted for this turn (no inject block / zero chunks). */
  lessonInjected: boolean;
  /** Committed design-sheet entry texts (active grounding corpus). */
  sheetCommittedTexts: string[];
  /** Texts of LESSON chunks injected this turn. */
  lessonChunkTexts: string[];
  /** Recent SD answer window texts. */
  recentAnswerTexts: string[];
  /**
   * Optional: superseded / interviewer-invalidated commitment texts.
   * Used only for critical soft-truncate when the answer re-asserts them.
   */
  supersededCommittedTexts?: string[];
}

const ASSUMPTION_LABEL = 'As a design assumption: ';
const FIGURE_FLAG = '[figure unverified]';

/**
 * Numeric claim with a unit/scale suffix (cheap deterministic scanner).
 * Bare integers without units are ignored — avoids false positives on counts
 * like "16 partitions" that are not sizing claims in the SPEC sense.
 */
const NUMERIC_CLAIM_RE =
  /\b(\d[\d,]*(?:\.\d+)?)\s*(k|m|b|ms|s|gb|tb|mb|qps|rps|%|requests?|users?|nodes?|replicas?)\b/gi;

function evidenceCorpus(ctx: DeepDiveCheckContext): string {
  return [
    ...(ctx.sheetCommittedTexts || []),
    ...(ctx.lessonChunkTexts || []),
    ...(ctx.recentAnswerTexts || []),
  ].join('\n');
}

function normalizeFigure(raw: string, unit?: string): string {
  const digits = String(raw || '').replace(/,/g, '').toLowerCase();
  const u = String(unit || '').toLowerCase().trim();
  return u ? `${digits}${u}` : digits;
}

function corpusContainsFigure(corpus: string, figure: string, unit?: string): boolean {
  const c = String(corpus || '').toLowerCase().replace(/,/g, '');
  const n = normalizeFigure(figure, unit);
  if (!n) return false;
  if (c.includes(n)) return true;
  // Also accept bare digits when unit-bearing form is claimed but corpus has same digits.
  const bare = normalizeFigure(figure, undefined);
  return bare.length > 0 && c.includes(bare);
}

function isEvidenceMiss(ctx: DeepDiveCheckContext): boolean {
  if (!ctx.lessonInjected) return true;
  const corpus = evidenceCorpus(ctx).trim();
  return corpus.length === 0;
}

function alreadyHasAssumptionLabel(text: string): boolean {
  return (
    /as a design assumption/i.test(text) ||
    /i'?d assume/i.test(text) ||
    /\[assumption/i.test(text)
  );
}

function applyAssumptionLabel(text: string): string {
  const t = String(text || '');
  if (!t.trim() || alreadyHasAssumptionLabel(t)) return t;
  return `${ASSUMPTION_LABEL}${t}`;
}

function applyNumericFlags(text: string, corpus: string): string {
  return String(text || '').replace(NUMERIC_CLAIM_RE, (match, figure, unit) => {
    if (match.includes(FIGURE_FLAG)) return match;
    if (corpusContainsFigure(corpus, figure, unit)) return match;
    return `${match} ${FIGURE_FLAG}`;
  });
}

/**
 * Soft-truncate sentences that re-assert a superseded / invalidated commitment.
 * Removes only the offending sentence when possible; keeps the rest.
 */
function softTruncateSupersededContradictions(
  text: string,
  superseded: string[],
): string {
  if (!superseded?.length) return text;
  const norms = superseded
    .map((s) => String(s || '').trim().toLowerCase())
    .filter(Boolean);
  if (norms.length === 0) return text;

  const parts = String(text || '').split(/(?<=[.!?])\s+/);
  const kept = parts.filter((sentence) => {
    const lower = sentence.toLowerCase();
    return !norms.some((n) => n.length >= 8 && lower.includes(n));
  });
  const joined = kept.join(' ').trim();
  return joined.length > 0 ? joined : text;
}

function runChecks(text: string, ctx: DeepDiveCheckContext): string {
  let out = String(text ?? '');

  if (isEvidenceMiss(ctx)) {
    out = applyAssumptionLabel(out);
  }

  const corpus = evidenceCorpus(ctx);
  out = applyNumericFlags(out, corpus);

  if (ctx.supersededCommittedTexts?.length) {
    out = softTruncateSupersededContradictions(out, ctx.supersededCommittedTexts);
  }

  // Never hard-refuse / blank the answer.
  if (!String(out).trim()) return String(text ?? '');
  return out;
}

/**
 * Post-stream soft checks for post-gate SD spoken output.
 * Identity when sdPhase === 'requirements'. Legacy unset phase runs checks.
 * Fail-open on any internal error.
 */
export function enforceDeepDiveChecks(
  text: string,
  sdPhase: string | undefined | null,
  checkContext: DeepDiveCheckContext,
): string {
  const original = String(text ?? '');
  try {
    if (sdPhase === 'requirements') return original;
    const ctx = checkContext ?? {
      lessonInjected: false,
      sheetCommittedTexts: [],
      lessonChunkTexts: [],
      recentAnswerTexts: [],
    };
    return runChecks(original, ctx);
  } catch {
    return original;
  }
}

/**
 * Trailer emitted AFTER live-streamed tokens when soft checks change the
 * authoritative text. Keeps TTFT intact (tokens yield immediately) while still
 * surfacing assumption / figure annotations to the UI without replaying the body.
 */
export function buildSoftCheckTrailer(raw: string, checked: string): string {
  const r = String(raw ?? '');
  const c = String(checked ?? '');
  if (!c || c === r) return '';

  const notes: string[] = [];
  if (/As a design assumption:/i.test(c) && !/As a design assumption:/i.test(r)) {
    notes.push('As a design assumption: this turn lacked grounded LESSON/sheet evidence.');
  }
  const flagRe = /(\d[\d,]*(?:\.\d+)?\s*(?:k|m|b|ms|s|gb|tb|mb|qps|rps|%|requests?|users?|nodes?|replicas?))\s*\[figure unverified\]/gi;
  const seen = new Set<string>();
  for (const m of c.matchAll(flagRe)) {
    const key = m[1].toLowerCase().replace(/\s+/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    notes.push(`${m[1]} ${FIGURE_FLAG}`);
  }
  // Superseded soft-truncate: body shortened without additive labels — note only.
  if (notes.length === 0 && c.length + 20 < r.length) {
    notes.push('[soft-check] Removed claims that contradicted superseded design commitments.');
  }
  if (notes.length === 0) return '';
  return `\n\n${notes.join('\n')}`;
}
