// electron/llm/speakableSd.ts
//
// Pure speakable-SD strip: turn a system-design answer string into read-aloud
// Delivery Framework prose by removing DSA scaffolds and impl-language code
// fences while keeping SPEC 10 ASCII HLD fences (```text / ```ascii).
//
// Dependency-free so ticket 04 can wire it from IE/WTA without cycles.
// No Electron / Gemini — unit-testable on strings alone.

/** Fence language tags that are SPEC 10 ASCII HLD diagrams — always keep. */
const KEEP_FENCE_LANGS = new Set(['text', 'ascii']);

/**
 * DSA RESPONSE CONTRACT headings and AnswerValidator aliases.
 * Matches ## / ### / bold / trailing colon forms on their own line.
 */
const DSA_HEADING_RE =
  /^[ \t]*#{1,3}[ \t]*(?:\*\*)?[ \t]*(?:Approach|Technique(?:[ \t]*\/[ \t]*Data Structure(?:[ \t]*\/[ \t]*Algorithm Used)?)?|Data Structure|Algorithm Used|Code|Dry Run|Complexity|Interviewer Follow-up Points|Follow-up Points|Follow-ups)(?:\*\*)?[ \t]*(?::|[-–—])?[ \t]*$/gim;

function fenceLang(info: string): string {
  return (info || '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
}

function looksLikeImplCode(body: string): boolean {
  const t = body.trim();
  if (!t) return false;
  if (/^(?:def|function|class|const|let|var|public|private|import|from|SELECT\b|WITH\b|package\b|#include\b)\b/im.test(t)) {
    return true;
  }
  const lines = t.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return false;
  // ASCII HLD boxes often use braces / ==== / arrows — not impl code.
  const hldLike = lines.filter((l) =>
    /(?:-->|->|<-|==+|--+|\|[^|]+\||\[[^\]]+\]|\{[^}]+\}|<[^>]+>)/.test(l),
  ).length;
  if (hldLike / lines.length >= 0.35) return false;
  const codey = lines.filter((l) => /[{};=]|=>|::/.test(l) && !/(?:-->|->|==+|--+|\[[^\]]+\])/.test(l)).length;
  return codey / lines.length >= 0.4;
}

function shouldStripFence(info: string, body: string): boolean {
  const lang = fenceLang(info);
  if (KEEP_FENCE_LANGS.has(lang)) return false;
  // Untagged: only strip when the body looks like impl code (keep prose boxes).
  if (!lang) return looksLikeImplCode(body);
  // Any other tag (python/js/…, mermaid, …) is non-speakable on SD — SPEC 10
  // allows only text/ascii HLD fences on candidate system_design_answer turns.
  return true;
}

function hasRemovableFence(answer: string): boolean {
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    if (shouldStripFence(m[1], m[2])) return true;
  }
  return false;
}

function hasDsaHeading(answer: string): boolean {
  DSA_HEADING_RE.lastIndex = 0;
  return DSA_HEADING_RE.test(answer);
}

/** Numbered markdown sections typical of architecture-blog dumps (not DF speech). */
const NUMBERED_MD_SECTION_RE = /^[ \t]*#{1,3}[ \t]*\d+\.[ \t]+\S/gm;

const ARCH_BLOG_MARKER_RE =
  /\b(?:Core Architecture Components|Technology Stack Recommendation|Data Storage Strategy|High-Level Workflow|Key Challenges\s*(?:&|and)\s*Solutions|URL Generation|Handling (?:Concurrency|Analytics))\b/i;

/**
 * Multi-section architecture essays the model emits when it ignores the DF
 * one-slice contract (dogfood: Ticketmaster / Bit.ly chat dumps).
 */
export function looksLikeArchitectureBlogDump(answer: string): boolean {
  if (typeof answer !== 'string' || !answer) return false;
  NUMBERED_MD_SECTION_RE.lastIndex = 0;
  const sections = answer.match(NUMBERED_MD_SECTION_RE) || [];
  if (sections.length >= 2) return true;
  return ARCH_BLOG_MARKER_RE.test(answer) && sections.length >= 1;
}

/**
 * Keep the lead-in prose before the first numbered ### section so a blog dump
 * collapses to a short spoken opener instead of a 6-part essay.
 */
function stripArchitectureBlogDump(answer: string): string {
  if (!looksLikeArchitectureBlogDump(answer)) return answer;
  NUMBERED_MD_SECTION_RE.lastIndex = 0;
  const m = NUMBERED_MD_SECTION_RE.exec(answer);
  if (m && typeof m.index === 'number') {
    return answer.slice(0, m.index).trim();
  }
  return answer;
}

function stripImplFences(answer: string): string {
  return answer.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (full, info: string, body: string) =>
    shouldStripFence(info, body) ? '' : full,
  );
}

function stripDsaHeadings(answer: string): string {
  DSA_HEADING_RE.lastIndex = 0;
  return answer.replace(DSA_HEADING_RE, '');
}

function collapseBlankLines(answer: string): string {
  return answer.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * Turn a system-design answer into speakable text: drop DSA scaffold headings
 * and impl-language (or code-like untagged) fences; keep ```text / ```ascii HLD.
 * Also collapse multi-section architecture blog dumps to the lead-in prose.
 * Empty string and already-speakable prose are returned unchanged (identity).
 */
export function toSpeakableSd(answer: string): string {
  if (typeof answer !== 'string') return '';
  if (answer === '') return answer;

  const dirty =
    hasDsaHeading(answer) ||
    hasRemovableFence(answer) ||
    looksLikeArchitectureBlogDump(answer);
  if (!dirty) {
    return answer;
  }

  const stripped = collapseBlankLines(
    stripArchitectureBlogDump(stripDsaHeadings(stripImplFences(answer))),
  )
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
  return stripped;
}

/** True when WTA/polish should treat this turn as speakable system design. */
export function isSystemDesignAnswerType(answerType: string | null | undefined): boolean {
  return answerType === 'system_design_answer';
}

/**
 * Apply {@link toSpeakableSd} for `system_design_answer`; identity for all other types.
 * Wire from IE / ipcHandlers / OutputShapeNormalizer post-stream polish.
 */
export function applySpeakableSdIfNeeded(
  answerType: string | null | undefined,
  text: string,
): string {
  if (!isSystemDesignAnswerType(answerType)) return text;
  return toSpeakableSd(text);
}

/**
 * `compressToSpeakable` must not run on SD — it telegram-compresses tradeoff prose.
 * Coding still uses its own path (callers typically skip polish entirely when coding).
 */
export function mayCompressToSpeakable(answerType: string | null | undefined): boolean {
  return !isSystemDesignAnswerType(answerType);
}
