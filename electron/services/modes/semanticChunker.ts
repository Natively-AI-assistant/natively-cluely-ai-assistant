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
// 3 (2026-09-19): plain-text heading detection — extracted PDFs/DOCX now chunk
// on their headings. Markdown output is unchanged, but the version is part of
// the index hash, so every file re-indexes once (owner-approved).
// 4 (2026-09-20): sentence-case plain-text headings. v3 never shipped, so users
// still re-index ONCE (v2 → v4); the bump is for machines that ran a v3 build,
// where unchanged version + changed chunking would pair old vectors with new
// chunks — the stale-index defect the version exists to prevent.
export const CHUNKER_VERSION = 4;

// ── Line endings ────────────────────────────────────────────────────────────
//
// WINDOWS LINE ENDINGS BROKE HEADING DETECTION (found 2026-09-19). Everything
// below splits on "\n". A file authored on Windows ends its lines "\r\n", the
// "\r" stays on the line, and `HEADING_RE`'s `(.*)$` cannot cross it (`.` does
// not match a line terminator) — so a CRLF markdown file had NO headings: one
// section, size-only cuts, no `[context: …]` on any chunk. Measured on the same
// 5k-token résumé: LF → 36 chunks, 35 with a heading path; CRLF → 12 chunks, 0
// with one. Nothing upstream normalised it (the extractor returns a text file's
// bytes as they are). A bare "\r" (classic Mac) is treated the same way.
export function normalizeLineEndings(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}

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

// ── Plain-text headings ─────────────────────────────────────────────────────
//
// A PDF or DOCX extracts to plain text: no `#`, no bold. With no heading the
// whole document was ONE section, chunks were cut on size alone, and a chunk
// routinely held the tail of one project and the head of the next with nothing
// saying which was which. Measured 2026-09-19 (experiments/retrieval-scale, the
// same résumé and job description as markdown vs as extracted text): the chunk
// that answers reached the prompt for 85% of questions vs 74–76% at 15k–70k
// tokens.
//
// Runs ONLY when the document has no ATX heading at all, so a markdown file
// chunks exactly as before. Deliberately conservative — a missed heading is
// the status quo, a false one splits a paragraph:
//   • the line stands alone: blank (or start / page marker) before it, and
//     after it a blank line or a bullet;
//   • 2–80 characters, at most 10 words, contains a letter, starts with a
//     letter or digit;
//   • not a bullet, table row, key: value pair, e-mail/URL line, and no
//     sentence punctuation (`.` `;` `?` `!`, or more than one comma);
//   • ALL CAPS, or Title Case (most significant words capitalised).
//
// Plain text has no levels, so structure is read from REPETITION: a title that
// recurs ("Highlights", "Team", "SLOs") is a label INSIDE an entry and stays
// body text; a title that occurs once or twice ("Project Drift-102 — Pellucid
// Health") opens a section. That reproduces what the markdown form of the same
// document yields — `### Project …` is the section, the bold labels are body —
// and puts the project's name on the chunk that holds its team line. Promoting
// the recurring labels to sub-headings was tried first and rejected: a
// 15k-token résumé became 237 fragments ("Project X / Stack: …" as a chunk of
// its own) against 87 for the markdown form — nearly three times the embedding
// cost, and six evidence slots that hold almost no text.

const ATX_RE = /^\s*#{1,6}\s+\S/;
const BULLET_RE = /^\s*(?:[-*•–·▪◦]|\d+[.)])\s+/;
/** `Label: rest` — a field ("Stack: Go") or a labelled entry title ("Service: atlas-api-3"). */
const LABELLED_RE = /^([^:]{1,40}):\s+\S/;
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'via', 'with']);
/** A title occurring this often is a recurring label inside entries, not a section heading. */
const REPEATED_HEADING_MIN = 3;

function looksLikePlainHeading(line: string, allowLabelled = false): boolean {
  const t = line.trim();
  if (t.length < 2 || t.length > 80) return false;
  if (!/[A-Za-z]/.test(t) || !/^[A-Za-z0-9]/.test(t)) return false;
  if (BULLET_RE.test(line) || TABLE_ROW_RE.test(line) || PAGE_MARKER_RE.test(line)) return false;
  if (/[.;?!]$/.test(t) || /[;?!]/.test(t) || /\.\s/.test(t)) return false;
  if ((t.match(/,/g) ?? []).length > 1) return false;
  if (/[@]|https?:|www\./i.test(t)) return false;
  if (!allowLabelled && LABELLED_RE.test(t)) return false;      // "Stack: Go, Rust" is a field, not a title
  const words = t.replace(/:$/, '').split(/\s+/);
  if (words.length > 10) return false;
  // A labelled title's NAME has whatever case the thing has ("Service:
  // quasar-ingest-api"); only the label is expected to read like a title.
  const labelOnly = allowLabelled ? LABELLED_RE.exec(t)?.[1] : undefined;
  if (labelOnly !== undefined) return /^[A-Z]/.test(labelOnly.trim());
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 3 && letters === letters.toUpperCase()) return true;
  const significant = words.filter((w) => /^[A-Za-z]/.test(w) && !SMALL_WORDS.has(w.toLowerCase()));
  if (significant.length === 0) return false;
  const capitalised = significant.filter((w) => /^[A-Z]/.test(w)).length;
  return capitalised / significant.length >= 0.6;
}

/**
 * SENTENCE-CASE headings (2026-09-20): "Minimum qualifications", "Reporting
 * line", "Location and working pattern", "Outside work". The Title-Case ratio
 * above rejects every one of them (1 capital in 2–4 words), and they are how
 * most documents written this decade title their sections. Measured on the
 * fixtures as a PDF extracts them: 7 of a job description's 80 headings and 2
 * of a résumé's 87 were lost — and they were the sections that held the
 * requirements, the reporting line, the working pattern and the volunteer
 * work, each glued to the tail of whatever 1,000-character entry preceded it.
 * The vector stack then missed "How many years of experience does the role
 * require?", a purely lexical question, at every document size.
 *
 * Case cannot carry the decision here, so STRUCTURE does: the line passes every
 * other test in looksLikePlainHeading, starts with a capital, and — the part
 * Title Case never needed — is followed by a real BODY: a bullet, or prose
 * (terminal punctuation, a sentence break, or too long to be a title). A run
 * of short unpunctuated lines separated by blanks (a résumé's achievement
 * lines, an address block) therefore heads nothing.
 */
function looksLikeSentenceCaseHeading(line: string): boolean {
  const t = line.trim();
  if (!/^[A-Z][a-z]/.test(t)) return false;
  const words = t.replace(/:$/, '').split(/\s+/);
  return words.length >= 2 && words.length <= 6;
}

function looksLikeBody(line: string | undefined): boolean {
  if (line === undefined) return false;
  const t = line.trim();
  if (!t) return false;
  return BULLET_RE.test(line) || TABLE_ROW_RE.test(line) || /[.;?!:]$/.test(t) || /[.?!]\s/.test(t) || t.length > 80;
}

/** A sentence-case title at `i`: passes the shared shape tests with case relaxed, and a body follows. */
function sentenceCaseCandidate(lines: string[], i: number): boolean {
  if (!looksLikeSentenceCaseHeading(lines[i])) return false;
  // Every non-case test of looksLikePlainHeading, by asking it about the line in Title Case.
  const titled = lines[i].replace(/\b([a-z])/g, (m) => m.toUpperCase());
  if (!looksLikePlainHeading(titled)) return false;
  let j = i + 1;
  while (j < lines.length && (lines[j].trim() === '' || PAGE_MARKER_RE.test(lines[j]))) j++;
  return looksLikeBody(lines[j]);
}

function plainTextHeadings(lines: string[]): Map<number, Heading> {
  const out = new Map<number, Heading>();
  if (lines.some((l) => ATX_RE.test(l))) return out;
  const blank = (i: number) => i < 0 || i >= lines.length || lines[i].trim() === '' || PAGE_MARKER_RE.test(lines[i]);
  const found: Array<{ i: number; text: string }> = [];
  const labelled: Array<{ i: number; text: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (!blank(i - 1) || blank(i)) continue;
    if (!(blank(i + 1) || BULLET_RE.test(lines[i + 1]))) continue;
    if (i + 1 >= lines.length) continue;                          // a last line heads nothing
    if (HEADING_RE.test(lines[i])) continue;                       // numbered sections keep their own rule
    if (looksLikePlainHeading(lines[i])) found.push({ i, text: lines[i].trim().replace(/:$/, '') });
    else if (looksLikePlainHeading(lines[i], true)) labelled.push({ i, text: lines[i].trim() });
    else if (sentenceCaseCandidate(lines, i)) found.push({ i, text: lines[i].trim().replace(/:$/, '') });
  }
  // LABELLED ENTRY TITLES: "Team profile: Growth Platform", "Service: atlas-
  // api-3". One such line is indistinguishable from a field; a label that
  // recurs on standalone lines with a DIFFERENT title each time is a list of
  // entries. Without this a plain-text job description or handbook had no
  // entry boundaries at all, and a detected section ("Minimum qualifications")
  // ran on through every entry after it (measured: the one cell that got
  // worse, 5k, 86% → 84%).
  const byLabel = new Map<string, Set<string>>();
  for (const f of labelled) {
    const label = LABELLED_RE.exec(f.text)![1].toLowerCase();
    (byLabel.get(label) ?? byLabel.set(label, new Set()).get(label)!).add(f.text.toLowerCase());
  }
  for (const f of labelled) {
    const label = LABELLED_RE.exec(f.text)![1].toLowerCase();
    if ((byLabel.get(label)?.size ?? 0) >= REPEATED_HEADING_MIN) found.push(f);
  }
  found.sort((a, b) => a.i - b.i);
  const counts = new Map<string, number>();
  for (const f of found) counts.set(f.text.toLowerCase(), (counts.get(f.text.toLowerCase()) ?? 0) + 1);
  for (const f of found) {
    if ((counts.get(f.text.toLowerCase()) ?? 0) >= REPEATED_HEADING_MIN) continue;   // a recurring label, not a section
    out.set(f.i, { level: 2, text: f.text });
  }
  return out;
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

  const lines = content.split('\n');
  const plain = plainTextHeadings(lines);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (PAGE_MARKER_RE.test(line)) { body.push(line); continue; }
    const h = plain.get(li) ?? headingOf(line);
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

  content = normalizeLineEndings(content);
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
