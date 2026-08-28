// electron/services/modes/semanticChunker.ts
//
// Boundary-driven chunking for reference files: chunk boundaries are SEMANTIC
// UNITS and size is an outcome, not the other way round.
//
// ── WHY (measured) ──────────────────────────────────────────────────────────
//
// The chunkers this replaces are 140-word windows with 30-word overlap (~225
// tokens) that prefix each chunk with its LEAF heading only. Two consequences,
// both measured in experiments/chunk-sweep:
//
//  1. PROJECT IDENTITY IS ABSENT FROM THE CHUNK TEXT. A reference file with five
//     projects x six identically-named sections produces five "Idempotency"
//     chunks that are near-neighbours in embedding space with nothing to tell
//     them apart. Measured: entity anchoring takes top-1-correct-project from
//     1/5 to 5/5 WITH heading-path prefixes, and from 0/5 to 1/5 without them
//     (project precision 0.60 vs 0.08). The two fixes only work as a pair, and
//     production had neither. This is also why splitting the file into
//     per-project files helped the reporter: the FILENAME put back the identity
//     the chunk text had dropped.
//
//  2. Fixed windows cut across semantic units. A 140-word window ending
//     mid-list splits a specification from its values.
//
// Chunk SIZE was measured NOT to be the problem: budget-survival is 25/25 at
// every size up to 1250 tokens, and production's ~225 already sits inside the
// measured 300-512 sweet spot. So this module does not chase a size — it
// chases boundaries, and keeps size inside guardrails.
//
// ── THE THREE GUARDRAILS ────────────────────────────────────────────────────
//
//   MERGE FLOOR (~100 tokens). A semantic unit below it merges with its next
//   sibling under the same heading until the group crosses ~250. Tiny chunks
//   embed as near-noise, yet cosine similarity FAVOURS short focused texts — so
//   an unmerged fragment steals a top-K slot while carrying no evidence. Both
//   halves matter: the floor is not about tidiness, it is about not letting a
//   two-line fragment outrank the paragraph that answers the question.
//
//   SOFT TARGET (~350 tokens). Whole units are packed greedily toward it.
//   Soft, because a unit is never split to hit it.
//
//   HARD CAP (1000 tokens). A single unit above the cap is subdivided at BLANK-
//   LINE PARAGRAPH BOUNDARIES ONLY — never mid-sentence, never at a character
//   offset. Fenced code blocks and tables are ATOMIC and are never split even
//   when that yields one oversized chunk: half a table is not smaller evidence,
//   it is wrong evidence, and a truncated code block is unreadable.
//
// ── THE PREFIX CONTRACT ─────────────────────────────────────────────────────
//
// Every chunk carries its full heading ANCESTOR PATH, not just its leaf.
//
// Five call sites parse the existing `[Section N.N | pX]` token, all anchored at
// the START of the chunk text (`/^\[Section\s+([\d.]+)\s*\|/`):
// ModeHybridRetriever.ts:1118, :1216, :1802, :2020 and
// documentGroundedPrompt.ts:653, :699. So the path is APPENDED after that
// token, never substituted for it:
//
//     [Section 2.3 | p4] [context: Project: FieldServe-CRM Sync > Idempotency]
//
// ── RE-INDEXING ─────────────────────────────────────────────────────────────
//
// See CHUNKER_VERSION. Changing this file without bumping it strands new chunk
// text on old vectors, silently.

/** Rough token count. chars/4 is the same approximation the sweep harness uses. */
export const approxTokens = (s: string): number => Math.ceil(s.length / 4);

export interface SemanticChunkOptions {
  /** Units below this merge forward. */
  minTokens?: number;
  /** Greedy packing target. */
  targetTokens?: number;
  /** A single unit above this is subdivided at paragraph boundaries. */
  maxTokens?: number;
  /** A merged run stops growing once it crosses this. */
  mergeUntilTokens?: number;
}

export const DEFAULT_CHUNK_OPTIONS: Required<SemanticChunkOptions> = {
  minTokens: 100,
  targetTokens: 350,
  maxTokens: 1000,
  mergeUntilTokens: 250,
};

/**
 * Bumping this forces a one-time re-index of every reference file.
 *
 * IT IS LOAD-BEARING, and the reason is a trap worth stating plainly:
 * `needsReindexing` compares `hashContent(file.content)` — the RAW SOURCE. A
 * chunker change does not alter the source, so without a version in that hash
 * the index keeps its old chunk text and old vectors while the query path
 * produces new chunk text. No error, no warning, and every retrieval quietly
 * scored against text that is no longer what the file chunks to.
 *
 *   v1 — 140-word windows, leaf heading only (pre-2026-08-28).
 *   v2 — boundary-driven units with heading-path prefixes.
 */
export const CHUNKER_VERSION = 2;

// ── Parsing ─────────────────────────────────────────────────────────────────

/** ATX markdown, or a numbered section ("2.1.3 Title"). Mirrors the callers. */
const HEADING_RE = /^\s*(?:(#{1,6})\s+(.*)$|(\d+(?:\.\d+){0,3})\s+(\S.*)$)/;
const PAGE_MARKER_RE = /^\s*\[Page\s+\d+\]\s*$/;
const FENCE_RE = /^\s*(?:```|~~~)/;
/** A markdown table row. Two in a row make a table. */
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;

interface Heading { level: number; text: string }

/** A semantic unit: a paragraph group, a fenced code block, or a table. */
interface Unit { text: string; atomic: boolean }

interface Section { path: Heading[]; headingLine: string | null; units: Unit[] }

function headingOf(line: string): Heading | null {
  const m = HEADING_RE.exec(line);
  if (!m) return null;
  if (m[1]) return { level: m[1].length, text: m[2].trim() };
  // "2.1.3 Title" — depth is the number of dot-separated components.
  const num = m[3]!;
  return { level: num.split('.').length, text: `${num} ${m[4]!.trim()}` };
}

/**
 * Split a section body into semantic units.
 *
 * Blank lines separate paragraph groups. Fenced blocks and tables are captured
 * whole and marked atomic — they are the two structures where a split does not
 * merely lose context but changes meaning.
 */
function unitsOf(body: string[]): Unit[] {
  const units: Unit[] = [];
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) units.push({ text, atomic: false });
    buffer = [];
  };

  for (let i = 0; i < body.length; i++) {
    const line = body[i];

    if (FENCE_RE.test(line)) {
      flush();
      const fenced = [line];
      i++;
      while (i < body.length) {
        fenced.push(body[i]);
        if (FENCE_RE.test(body[i])) break;
        i++;
      }
      units.push({ text: fenced.join('\n'), atomic: true });
      continue;
    }

    if (TABLE_ROW_RE.test(line) && i + 1 < body.length && TABLE_ROW_RE.test(body[i + 1])) {
      flush();
      const rows: string[] = [];
      while (i < body.length && TABLE_ROW_RE.test(body[i])) { rows.push(body[i]); i++; }
      i--;
      units.push({ text: rows.join('\n'), atomic: true });
      continue;
    }

    if (line.trim() === '') { flush(); continue; }
    buffer.push(line);
  }
  flush();
  return units;
}

function parseSections(content: string): Section[] {
  const sections: Section[] = [];
  const stack: Heading[] = [];
  let headingLine: string | null = null;
  let body: string[] = [];

  const flush = () => {
    const units = unitsOf(body);
    if (headingLine !== null || units.length) {
      sections.push({ path: [...stack], headingLine, units });
    }
    body = [];
  };

  for (const line of content.split('\n')) {
    if (PAGE_MARKER_RE.test(line)) { body.push(line); continue; }
    const h = headingOf(line);
    if (!h) { body.push(line); continue; }
    flush();
    // Pop siblings and deeper levels; what remains is this heading's ancestry.
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    stack.push(h);
    headingLine = line.trim();
  }
  flush();
  return sections;
}

// ── Prefixing ───────────────────────────────────────────────────────────────

/**
 * `[context: A > B > C]` for a heading path, or '' when there is nothing to say.
 *
 * The DOCUMENT-level heading is dropped: it is identical on every chunk of the
 * file, so it costs tokens in every chunk and discriminates between none of
 * them. The path exists to separate the five "Idempotency" sections from each
 * other, and "Integration Project History > Project: X > Idempotency" separates
 * them no better than "Project: X > Idempotency" does.
 */
export function contextPrefix(path: Heading[], dropRoot = true): string {
  const visible = dropRoot ? path.slice(1) : path;
  const parts = visible.map((h) => h.text).filter(Boolean);
  return parts.length ? `[context: ${parts.join(' > ')}]` : '';
}

/**
 * Is the outermost heading a document TITLE rather than a peer section?
 *
 * True when the file has exactly one top-level heading — then it is on every
 * chunk's path, discriminates between none of them, and is dropped. A file with
 * several top-level headings ("## Project: A", "## Project: B") has no title,
 * and dropping the first element there would throw away the single most
 * discriminating part of the path — the project name.
 */
function hasSingleRoot(sections: Section[]): boolean {
  const roots = new Set(sections.map((s) => s.path[0]?.text).filter(Boolean));
  return roots.size === 1;
}

// ── Packing ─────────────────────────────────────────────────────────────────

/**
 * Subdivide an oversized non-atomic unit, at the coarsest boundary that works.
 *
 * Three tiers, in order, because the input is not always well-formed prose:
 *
 *   1. LINE boundaries. A paragraph group has no blank lines left by
 *      construction, so lines are the coarsest structure remaining.
 *   2. SENTENCE boundaries, when the unit is one long line. Scan-OCR output,
 *      all-caps policy text and single-paragraph markdown all arrive as one
 *      unbroken line, and tier 1 returns that line unchanged — which is how a
 *      5600-word file became a single chunk that scored identically for every
 *      query. The lexical chunker carries a "round-7 safety net" for exactly
 *      this shape; this is that lesson, applied at the boundary layer instead
 *      of as a post-hoc rescue.
 *   3. WORD boundaries, when even sentences do not split it — no punctuation at
 *      all. Still never a character offset.
 *
 * A sentence is never split by tiers 1-2, and tier 3 only runs when the text
 * offers no sentence to preserve.
 */
function subdivide(unit: Unit, maxTokens: number, targetTokens: number): string[] {
  if (unit.atomic) return [unit.text];

  // An UNSTRUCTURED unit — no line breaks and no sentence terminators — is
  // subdivided at the SOFT target rather than the hard cap. This is not a
  // loosening of the "boundaries first" rule; it follows from it. Scan-OCR
  // output, all-caps policy text and single-paragraph markdown contain no
  // semantic boundary of any kind, so size is the only boundary available, and
  // leaving 800 tokens of undifferentiated text as one chunk reproduces the
  // failure the lexical chunker's round-7 safety net was added for: one chunk
  // that scores identically for every query, so topK cannot SELECT.
  // Well-formed prose is unaffected — it has sentences, so it takes the
  // cap-based path below and keeps whole units intact.
  const unstructured = !unit.text.includes('\n') && !/[.!?]/.test(unit.text);
  const limit = unstructured ? targetTokens : maxTokens;
  if (approxTokens(unit.text) <= limit) return [unit.text];

  const pack = (pieces: string[], joiner: string): string[] => {
    const out: string[] = [];
    let buf: string[] = [];
    for (const piece of pieces) {
      buf.push(piece);
      if (approxTokens(buf.join(joiner)) >= limit) { out.push(buf.join(joiner)); buf = []; }
    }
    if (buf.length) out.push(buf.join(joiner));
    return out;
  };

  const byLine = pack(unit.text.split('\n'), '\n');
  if (byLine.length > 1) return byLine;

  // Keep the terminator with its sentence — a split that strips the full stop
  // changes how the fragment reads and how it embeds.
  const sentences = unit.text.match(/[^.!?]+[.!?]+[\])'"`\u2019\u201d]*\s*|[^.!?]+$/g) ?? [unit.text];
  const bySentence = pack(sentences.map((x) => x.trim()).filter(Boolean), ' ');
  if (bySentence.length > 1) return bySentence;

  const byWord = pack(unit.text.split(/\s+/).filter(Boolean), ' ');
  return byWord.length ? byWord : [unit.text];
}

/**
 * Chunk `content` into boundary-driven, heading-path-prefixed chunks.
 *
 * `tagFor` lets a caller supply the leading `[Section N.N | pX]` token for a
 * section; the path is appended after it so the five anchored consumers keep
 * matching. Returning '' (the default) yields path-only prefixes.
 */
export function semanticChunks(
  content: string,
  options: SemanticChunkOptions = {},
  tagFor?: (section: { headingLine: string | null; index: number }) => string,
): string[] {
  const o = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  const chunks: string[] = [];

  const sections = parseSections(content);
  const dropRoot = hasSingleRoot(sections);
  sections.forEach((section, index) => {
    const ctx = contextPrefix(section.path, dropRoot);
    const tag = tagFor?.({ headingLine: section.headingLine, index }) ?? '';
    // Tag FIRST (consumers anchor on it at position 0), then the path, then the
    // heading line itself for the lexical arm to match on.
    const header = [tag, ctx, section.headingLine ?? ''].filter(Boolean).join(' ').trim();

    // Split oversized units first, so packing only ever sees packable pieces.
    const pieces: Unit[] = [];
    for (const u of section.units) {
      for (const part of subdivide(u, o.maxTokens, o.targetTokens)) pieces.push({ text: part, atomic: u.atomic });
    }

    const emit = (bodyText: string) => {
      const text = header ? `${header}\n${bodyText}` : bodyText;
      if (text.trim()) chunks.push(text);
    };

    let group: string[] = [];
    let groupTokens = 0;
    const flushGroup = () => { if (group.length) emit(group.join('\n\n')); group = []; groupTokens = 0; };

    for (const piece of pieces) {
      const t = approxTokens(piece.text);
      // An atomic unit that would overflow the target starts its own chunk
      // rather than being packed on top of unrelated prose.
      if (piece.atomic && groupTokens > 0 && groupTokens + t > o.targetTokens) flushGroup();
      group.push(piece.text);
      groupTokens += t;
      // MERGE FLOOR: keep absorbing siblings while the group is still small.
      if (groupTokens < o.mergeUntilTokens) continue;
      if (groupTokens >= o.targetTokens) flushGroup();
    }
    // The tail may be under the floor; it has no sibling left to merge with, so
    // it ships as-is rather than being dropped.
    flushGroup();

    // A section with a heading and no body still deserves a chunk: the heading
    // itself is retrievable evidence ("is there an Idempotency section?").
    if (!pieces.length && section.headingLine) emit('');
  });

  return chunks;
}
