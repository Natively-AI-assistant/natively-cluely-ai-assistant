// electron/context-intelligence/retrieval/profile-derived-support.ts
//
// Derived-evidence hygiene for Profile Intelligence (2026-09-30).
//
// THE PROBLEM
// The résumé's structured extraction is an LLM call, and one of its fields is
// allowed to be WRITTEN rather than extracted: the premium StructuredExtractor
// prompt says "if a description is not explicitly provided, generate a concise
// 1-sentence summary based on the project name, technologies used, and any
// available context clues". That sentence then renders as RESUME evidence —
// the highest-authority source for claims about the user — so a model-invented
// "used by 2,000 students" is indistinguishable from a line the candidate wrote.
// The extractor also fills missing identity with placeholders ("Unknown
// Candidate", "Unknown Role", "Unknown Location") that are not in any document.
//
// THE RULE
// A derived field is kept only if the raw document text SUPPORTS it:
//   1. every number it states appears in the raw text (after the tokenizer's
//      numeral canonicalisation, so "16k" and "16,000" are the same quantity) —
//      an invented figure is the costliest fabrication in an interview answer,
//      so one unsupported number rejects the field outright; and
//   2. at least DERIVED_SUPPORT_MIN_COVERAGE of its distinctive content words
//      (function words removed, light suffix folding) occur in the raw text.
// No raw text ⇒ nothing can be verified ⇒ the derived field is dropped (fail
// closed). Only DERIVED fields are tested; extracted fields (names, bullets,
// highlights, skills) and the lossless raw-text chunks are untouched, so the
// facts a generated summary was paraphrasing stay reachable.
//
// WHY THIS IS ROBUST
// It asks one question — "does the candidate's own document say this?" — with
// the same tokenizer the retrieval ranker uses, so there is no second notion of
// a "word". It needs no model and no list of suspicious phrasings; a summary
// that paraphrases the résumé in the résumé's own vocabulary passes, while a
// sentence built from "context clues" (a purpose, an audience, a metric the
// document never states) fails on the words it had to add. Coverage is a
// fraction, so a stray connective does not sink a faithful summary.
//
// Pure: no Electron, no DB — importable from the V3 port and the legacy JIT.

import { wordsOf, isProbeFunctionWord } from '../../services/modes/lexicalTokens';

/** Fraction of a derived field's distinctive content words the raw text must contain. */
export const DERIVED_SUPPORT_MIN_COVERAGE = 0.75;

/** Values the extractor substitutes when a field is missing. Never document facts. */
const EXTRACTOR_PLACEHOLDERS = new Set(['unknown', 'unknown candidate', 'unknown role', 'unknown location', 'n/a']);

export function isExtractorPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && EXTRACTOR_PLACEHOLDERS.has(value.trim().toLowerCase());
}

/** Symmetric light suffix folding so "expenses"/"expense" and "managed"/"manage" meet. */
function fold(word: string): string {
  if (/\d/.test(word)) return word;
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

const tokensOf = (text: string): string[] => wordsOf(text, { shortNumerics: true })
  .filter((w) => !isProbeFunctionWord(w))
  .map(fold);

export interface SupportIndex {
  readonly tokens: ReadonlySet<string>;
}

/** Index the raw document text once per document; null when there is no text. */
export function buildSupportIndex(rawText: string | null | undefined): SupportIndex | null {
  if (typeof rawText !== 'string' || !rawText.trim()) return null;
  return { tokens: new Set(tokensOf(rawText)) };
}

export type DerivedSupportReason = 'supported' | 'no_raw_text' | 'unsupported_number' | 'low_coverage';

export interface DerivedSupportVerdict {
  supported: boolean;
  reason: DerivedSupportReason;
  /** Share of distinctive non-numeric words found in the raw text (1 when there are none). */
  coverage: number;
}

/** Does the raw document support this derived text? See the file header for the rule. */
export function assessDerivedSupport(
  text: string,
  index: SupportIndex | null,
  minCoverage: number = DERIVED_SUPPORT_MIN_COVERAGE,
): DerivedSupportVerdict {
  if (!index) return { supported: false, reason: 'no_raw_text', coverage: 0 };
  const distinct = [...new Set(tokensOf(text))];
  // Pure digit strings only: "16k" also yields its canonical "16000", which is
  // the form compared, so the notation a summary chose cannot fail it.
  const numbers = distinct.filter((t) => /^\d+$/.test(t));
  if (numbers.some((n) => !index.tokens.has(n))) {
    return { supported: false, reason: 'unsupported_number', coverage: 0 };
  }
  const words = distinct.filter((t) => !/\d/.test(t));
  if (words.length === 0) return { supported: true, reason: 'supported', coverage: 1 };
  const found = words.filter((w) => index.tokens.has(w)).length;
  const coverage = found / words.length;
  return coverage >= minCoverage
    ? { supported: true, reason: 'supported', coverage }
    : { supported: false, reason: 'low_coverage', coverage };
}

/**
 * A copy of a structured résumé with its UNSUPPORTED derived content removed:
 * project descriptions the raw text does not support, and extractor
 * placeholder identity values. Everything else is returned as-is. Never throws;
 * a non-object input is returned unchanged.
 */
export function stripUnsupportedDerivedResumeFields<T>(structured: T, rawText: string | null | undefined): T {
  if (!structured || typeof structured !== 'object') return structured;
  try {
    const sd = structured as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = { ...sd };
    const identity = sd.identity;
    if (identity && typeof identity === 'object') {
      const id = { ...(identity as Record<string, unknown>) };
      for (const key of ['name', 'location']) {
        if (isExtractorPlaceholder(id[key])) id[key] = '';
      }
      out.identity = id;
    }
    if (Array.isArray(sd.projects)) {
      const index = buildSupportIndex(rawText);
      out.projects = sd.projects.map((p) => {
        if (!p || typeof p !== 'object') return p;
        const proj = p as Record<string, unknown>;
        const desc = typeof proj.description === 'string' ? proj.description.trim() : '';
        if (!desc) return p;
        if (assessDerivedSupport(desc, index).supported) return p;
        const { description: _dropped, ...rest } = proj;
        return rest;
      });
    }
    return out as unknown as T;
  } catch {
    return structured;
  }
}

// ── experience pairings (2026-10-09) ────────────────────────────────────────
//
// THE PROBLEM
// The rule above tests the WORDS of a derived field. An experience entry can be
// built entirely from the résumé's own words and still state something the
// résumé does not: a job title paired with the wrong employer. Measured on the
// evidence-rich benchmark, where the extraction ran in its rule-based fallback
// (a DeepSeek-only user has no model for structured extraction): a résumé with
// two titles at one employer rendered "Senior Frontend Engineer at Ondaverde
// Health (2022-06 to 2023-12)" — the title belongs to the employer above, the
// name to the one below — and "Frontend Engineer at Patient portal and
// appointment tools for private clinics." (the employer's description line). A
// PDF with wrapped lines rendered "Software Engineer II at ships.", "Software
// Engineer at [Page 2]" and two bullet lines as jobs. These went into the
// prompt as RESUME evidence beside the résumé itself, and the answers repeated
// them: a project placed at the wrong employer, time at the employer counted
// from the promotion (three of the 71 capped answers of the 7 October baseline).
//
// THE RULE
// An entry is rejected only on evidence:
//   shape    the company is a page marker, has more than 10 words, or ends in
//            a sentence period that is not a corporate abbreviation; or the
//            title has more than 12 words;
//   position title and company both occur verbatim in the résumé text, and for
//            every line that starts with the title the company first appears
//            more than 2 text lines below it, or another entry's company
//            stands alone on a line between the two.
// A title or company that cannot be found verbatim (an extractor that
// normalised "Sr." to "Senior") is kept: nothing shows it is wrong. With no
// résumé text nothing is checked, because nothing could replace the entries.
//
// WHAT A CALLER DOES WITH IT
// The V3 profile port renders none of a résumé's derived experience statements
// when any entry is rejected (a partial list reads as the whole history); the
// résumé's own text, whole and in heading-aware pieces, is then the only
// statement of who worked where and when. Replayed on 52 development prompts,
// four samples each: answers right by the fixed checks 90.4 % → 96.6 %, none
// worse; "how long have I been at …" 0 of 4 → 4 of 4.

const PAGE_MARK_RE = /^(?:\[\s*page\s*\d+\s*\]|-{2,}\s*\d+\s*of\s*\d+\s*-{2,}|page\s*\d+(?:\s*of\s*\d+)?)$/i;
const CORPORATE_ABBREVIATION_RE = /\b(?:inc|ltd|llc|llp|co|corp|plc|gmbh|pvt|pte|bv|ag|oy|ab|sa|srl|kk|s\.a|s\.l|s\.r\.l)\.$/i;

export const EXPERIENCE_MAX_COMPANY_WORDS = 10;
export const EXPERIENCE_MAX_TITLE_WORDS = 12;
/** A company named at most this many text lines BELOW the title line still belongs to it ("Title\nCompany | dates"). */
export const EXPERIENCE_COMPANY_BELOW_TITLE_MAX_LINES = 2;
/** Another entry's company "stands alone" on a line when it makes up at least this share of the line. */
export const EXPERIENCE_STANDALONE_SHARE = 0.6;

export type ExperiencePairingProblem =
  | 'company_is_page_marker' | 'company_too_long' | 'company_ends_a_sentence' | 'title_too_long' | 'pairing_not_in_the_text';

export interface ExperienceEntryLike { role?: unknown; company?: unknown }

const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;
const normLine = (s: string): string => s.toLowerCase()
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
  .replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const stripListMarker = (line: string): string => line.replace(/^(?:[•·▪◦*\-–—]|\d+[.)])\s+/, '');
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The résumé's text as the lines the position rule counts: empty lines and page markers are not lines. */
export function resumeTextLines(rawText: string | null | undefined): string[] | null {
  if (typeof rawText !== 'string' || !rawText.trim()) return null;
  return rawText.split('\n').map(normLine).filter((l) => l && !PAGE_MARK_RE.test(l));
}

/** A reason this entry cannot be what the résumé says, or null. `lines` null ⇒ shape only. */
export function experiencePairingProblem(
  entry: ExperienceEntryLike,
  others: ReadonlyArray<ExperienceEntryLike>,
  lines: ReadonlyArray<string> | null,
): ExperiencePairingProblem | null {
  const title = text(entry.role);
  const company = text(entry.company);
  if (company) {
    if (PAGE_MARK_RE.test(company)) return 'company_is_page_marker';
    if (wordCount(company) > EXPERIENCE_MAX_COMPANY_WORDS) return 'company_too_long';
    if (/\.$/.test(company) && !CORPORATE_ABBREVIATION_RE.test(company)) return 'company_ends_a_sentence';
  }
  if (title && wordCount(title) > EXPERIENCE_MAX_TITLE_WORDS) return 'title_too_long';
  if (!title || !company || !lines) return null;
  const t = normLine(title);
  const c = normLine(company);
  const titleLines: number[] = [];
  const companyLines: number[] = [];
  lines.forEach((l, i) => {
    if (stripListMarker(l).startsWith(t)) titleLines.push(i);
    if (l.includes(c)) companyLines.push(i);
  });
  if (!titleLines.length || !companyLines.length) return null;
  const otherNames = [...new Set(others.map((o) => normLine(text(o.company))).filter((n) => n && n !== c))];
  const standsAlone = (i: number): boolean =>
    otherNames.some((n) => lines[i].includes(n) && n.length >= EXPERIENCE_STANDALONE_SHARE * lines[i].length);
  for (const r of titleLines) {
    for (const k of companyLines) {
      if (k > r + EXPERIENCE_COMPANY_BELOW_TITLE_MAX_LINES) continue;
      let crossed = false;
      for (let j = k + 1; j < r; j++) if (standsAlone(j)) { crossed = true; break; }
      if (!crossed) return null;
    }
  }
  return 'pairing_not_in_the_text';
}

/**
 * The experience entries of a structured résumé that its own text shows to be
 * wrong (see the rule above), with their position in `experience`. Empty when
 * there is no résumé text, no experience list, or nothing is rejected. Never throws.
 */
export function unsupportedExperienceEntries(
  structured: unknown,
  rawText: string | null | undefined,
): Array<{ index: number; problem: ExperiencePairingProblem }> {
  try {
    const lines = resumeTextLines(rawText);
    if (!lines || !structured || typeof structured !== 'object') return [];
    const list = (structured as Record<string, unknown>).experience;
    if (!Array.isArray(list)) return [];
    const entries = list.map((e) => (e && typeof e === 'object' ? e as ExperienceEntryLike : {}));
    const wellShaped = entries.filter((e) => !experiencePairingProblem(e, [], null));
    const out: Array<{ index: number; problem: ExperiencePairingProblem }> = [];
    entries.forEach((e, index) => {
      const problem = experiencePairingProblem(e, wellShaped.filter((o) => o !== e), lines);
      if (problem) out.push({ index, problem });
    });
    return out;
  } catch {
    return [];
  }
}

/**
 * Is this OKF card LLM-composed rather than rendered from the documents?
 * AOT artifact cards (intro, gap-analysis pivot scripts, mock-interview
 * answer keys, culture mapping, negotiation strategy) are model output about
 * the candidate; serving them as RESUME / JOB_DESCRIPTION evidence gives them
 * the authority of the documents they were generated from.
 */
export function isGeneratedArtifactCard(card: { type?: string; generatedFrom?: string }): boolean {
  return card.generatedFrom === 'aot_artifact'
    || (typeof card.type === 'string' && card.type.startsWith('artifact_'));
}
