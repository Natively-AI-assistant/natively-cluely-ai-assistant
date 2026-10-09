// electron/context-intelligence/retrieval/mode-retrieval-port.ts
//
// THE factory for a RetrievalPort over the live mode-reference store.
//
// Before this existed, the construction lived inline in ipcHandlers (manual
// chat), and the second adopting surface (WTA) would have copied it — a
// declared registry, the fail-closed defaults, the retrieveHybridRaw call shape.
// Two copies of a security-relevant construction is how the two tokenizer
// copies drifted, and this one decides what evidence a turn may see.
//
// Everything is injected structurally: no import of ModesManager or the legacy
// stack, so the module stays testable without Electron, a DB, or an embedding
// model — the same rule the rest of this directory follows.

import type { EvidenceScope, SourceType } from '../contracts/types';
import type { RetrievalPort } from '../orchestration/orchestrator';
import { createLegacyRetrievalPort } from './legacy-retrieval-port';

/** The slice of ModesManager this factory actually uses. Structural on purpose. */
export interface ModeRetrieverLike {
  retrieveHybridRaw?: (modeInfo: unknown, files: unknown[], opts: {
    query: string; topK: number; tokenBudget: number; allowRerank: boolean;
    forceDocumentGrounding?: boolean;
    rerankSurface?: 'live' | 'manual';
    meetingActive?: boolean;
    rerankPoolMultiplier?: number;
    queryEmbedRetryBudgetMs?: number;
    perItemOverheadTokens?: number;
  }) => Promise<{ chunks?: Array<Record<string, unknown>> } | null | undefined>;
  /** Corpus arbitration: do these files hold the question's distinctive terms together? */
  probeReferenceAnchors?: (modeInfo: unknown, files: unknown[], question: string) => boolean;
}

export interface ModeFileLike { id: string; fileName?: string; content?: string }

/**
 * What KIND of document is this, structurally?
 *
 * The legacy mode-reference store records only a filename and content — there is
 * no file-kind column — so the type must be inferred. Getting this wrong is not
 * cosmetic: the port previously stamped EVERY file `REFERENCE_FILE`, so a résumé
 * uploaded to Looking-for-Work was retrieved, admitted, and then discarded by the
 * claim-authority filter because the turn authorized `[RESUME, PROFILE_FACT]`.
 * The user saw "not covered in the available evidence" for facts sitting in their
 * own résumé.
 *
 * Filename first (a deliberate user signal), then content shape. Both must agree
 * with a real structural marker before a file is called a résumé or a JD —
 * mislabelling a JD as a résumé is precisely the JD-as-experience contamination
 * the whole source-authority layer exists to prevent, so ambiguity fails to
 * REFERENCE_FILE rather than guessing.
 */
type DocShape = 'resume' | 'job_description' | 'other';

const RESUME_NAME = /\b(resume|cv|curriculum[\s_-]?vitae)\b/i;
const JD_NAME = /\b(job[\s_-]?description|jd|job[\s_-]?post(ing)?|role[\s_-]?spec)\b/i;

// Headings a résumé has and a JD does not, and vice versa. Counted, not matched
// singly: one stray word must not retype a document.
//
// Heading markers accept a bare heading LINE as well as a markdown `#` heading
// (2026-09-07). A plain-text résumé whose sections are just "Experience" /
// "Education" on their own lines scored ZERO, was typed REFERENCE_FILE, and
// every plan that named RESUME dropped it. Same for a JD whose title line is
// "# Job description — …" with "Compensation range:" and "Role:" lines: none
// of those were markers, so a JOB_REQUIREMENT question about the attached JD
// planned JOB_DESCRIPTION and never saw the file (measured live: "What is the
// compensation range for the Helio Labs role?" → "the job posting doesn't
// list a compensation range" while the profile's OTHER JD was quoted instead).
const RESUME_MARKERS = [
  /^\s*#{0,3}\s*(work\s+)?experience\s*:?\s*$/im, /^\s*#{0,3}\s*education\s*:?\s*$/im, /^\s*#{0,3}\s*(notable\s+)?projects?\s*:?\s*$/im,
  /\bcgpa\b|\bgpa\b/i, /^\s*#{0,3}\s*(technical\s+)?skills?\s*:?\s*$/im, /^\s*#{0,3}\s*(professional\s+)?summary\s*:?\s*$/im,
  /\bportfolio\b/i, /\bgithub\.com\/|\bgithub:/i,
];
const JD_MARKERS = [
  /minimum\s+qualifications/i, /preferred\s+qualifications/i, /^\s*#{0,3}\s*responsibilities\s*:?\s*$/im,
  /about\s+the\s+role/i, /what\s+you.{0,3}ll\s+do/i, /\byears?\s+of\s+(professional\s+)?experience\b/i,
  /we\s+are\s+looking\s+for/i, /^\s*#{0,3}\s*compensation\b/im,
  /^\s*#{0,3}\s*job\s+description\b/im, /\bcompensation\s+(range|band)\s*:/i, /^\s*(role|position)\s*:/im,
  /^\s*#{0,3}\s*(must[\s-]+haves?|nice[\s-]+to[\s-]+haves?|requirements)\s*:?\s*$/im,
];

const countMatches = (text: string, pats: RegExp[]) => pats.reduce((n, p) => n + (p.test(text) ? 1 : 0), 0);

// A filename is tested as WORDS: `lfw_jd.md` and `evinjohn_resume.pdf` carry
// the signal in a token that `\b` cannot see behind an underscore (a word
// character). Tested against the raw name too, so `job-description.md` and
// `Job Description.pdf` keep matching as before.
const nameWords = (fileName: string) => `${fileName} ${fileName.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[^a-z0-9]+/gi, ' ')}`;

export function classifyDocShape(fileName = '', content = ''): DocShape {
  const head = String(content).slice(0, 6000);   // structure lives near the top
  const resumeScore = countMatches(head, RESUME_MARKERS);
  const jdScore = countMatches(head, JD_MARKERS);
  const name = nameWords(fileName);

  // An explicit filename wins, but only when the content does not clearly
  // contradict it — a file called `resume.md` containing "Minimum
  // Qualifications" is a JD someone named badly.
  if (JD_NAME.test(name) && resumeScore <= jdScore) return 'job_description';
  if (RESUME_NAME.test(name) && jdScore <= resumeScore) return 'resume';

  // Otherwise require a clear structural margin.
  if (jdScore >= 2 && jdScore > resumeScore) return 'job_description';
  if (resumeScore >= 2 && resumeScore > jdScore) return 'resume';
  return 'other';
}

/**
 * Map a shape onto a source type the MODE actually authorizes.
 *
 * Mode-aware on purpose: the same résumé is a RESUME in Looking-for-Work (it is
 * the user's own) and a CANDIDATE_FILE in Recruiting (it is someone else's). A
 * single global mapping cannot express that, and getting it backwards is how
 * Recruiting ended up telling the user to "switch to a mode that enables that
 * source" about a file it had just indexed.
 *
 * Falls back to REFERENCE_FILE whenever the mode does not authorize the specific
 * type — never upgrades a file into a source the mode forbids.
 */
const CODE_FILE_RE = /\.(py|js|jsx|ts|tsx|mjs|cjs|go|rs|java|c|cc|cpp|h|hpp|rb|swift|kt|kts|scala|sql|sh|bash|zsh|pl|php|cs|m|mm)$/i;

export function sourceTypeForFile(
  fileName: string | undefined,
  content: string | undefined,
  allowed: readonly SourceType[],
): SourceType {
  const can = (t: SourceType) => allowed.includes(t);
  const shape = classifyDocShape(fileName, content);

  if (shape === 'resume') {
    if (can('RESUME')) return 'RESUME';
    if (can('CANDIDATE_FILE')) return 'CANDIDATE_FILE';
  }
  if (shape === 'job_description' && can('JOB_DESCRIPTION')) return 'JOB_DESCRIPTION';

  // Unclassified content NEVER becomes an identity-bearing type (deep-test D7,
  // 2026-08-01). The old fallback was `allowed[0]`, and technical-interview's
  // allowed[0] is RESUME — so every project note, code sample, PDF and incident
  // postmortem in that mode was stamped "the user's résumé": telemetry lied
  // about roles, DOCUMENT_FACT turns had their evidence dropped by the
  // planned-type filter, and arbitrary file text became eligible to evidence
  // USER_* claims (a contamination hazard, not a cosmetic bug). RESUME,
  // CANDIDATE_FILE and JOB_DESCRIPTION are reachable ONLY via positive shape
  // detection above.
  if (CODE_FILE_RE.test(fileName ?? '') && can('CODING_SAMPLE')) return 'CODING_SAMPLE';
  if (can('REFERENCE_FILE')) return 'REFERENCE_FILE';
  if (can('PROJECT_FILE')) return 'PROJECT_FILE';
  if (can('CODING_SAMPLE')) return 'CODING_SAMPLE';
  return 'REFERENCE_FILE';
}

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};
const monthOf = (w: string): number | undefined => MONTH_INDEX[w.toLowerCase().slice(0, w.toLowerCase().startsWith('sept') ? 4 : 3)];

/**
 * A date as documents write it: "December 31, 2025", "31 December 2025",
 * "2025-12-31", or a bare "November 2022" (→ that month's LAST day when
 * `end`, its first otherwise). Slash dates are ambiguous across locales and
 * are not read.
 */
export function parseDocumentDate(text: string, end = false): Date | undefined {
  const t = String(text ?? '');
  let m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = t.match(/\b([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})\b/);
  if (m && monthOf(m[1]) !== undefined) return new Date(+m[3], monthOf(m[1])!, +m[2]);
  m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)? (?:of )?([A-Za-z]{3,9})\.?,? (\d{4})\b/);
  if (m && monthOf(m[2]) !== undefined) return new Date(+m[3], monthOf(m[2])!, +m[1]);
  m = t.match(/\b([A-Za-z]{3,9})\.? (\d{4})\b/);
  if (m && monthOf(m[1]) !== undefined) return end ? new Date(+m[2], monthOf(m[1])! + 1, 0) : new Date(+m[2], monthOf(m[1])!, 1);
  return undefined;
}

/**
 * Document status declared by the file itself ("Status: RETIRED. …"), read from
 * the head of the content. This is the provenance the precedence answer needs
 * (deep-test D8): the value resolver picked current-over-retired by ranking
 * luck, and when asked WHY, the model invented a rationale because no status
 * ever reached the prompt.
 *
 * FRESHNESS (2026-09-30). Documents also say it without a "Status:" line, and
 * the model read them as current: a price sheet "Valid through December 31,
 * 2025" quoted as today's price in September 2026, a "DRAFT, not reviewed"
 * meeting note stated as settled, a policy that says "check the Knowledge Base
 * for the current version before relying on this document" relied on, a
 * résumé "last updated November 2022" taken over the profile (external judge,
 * dev set: all capped). Read here as `expired` (a validity date that has
 * passed), `draft` (only with an unreviewed/unapproved marker) and `outdated`
 * (the document says to check for a current version); a validity date still
 * in the future marks nothing.
 */
export function detectDocumentStatus(content: string | undefined, now: Date = new Date()): string | undefined {
  const head = String(content ?? '').slice(0, 600);
  const m = head.match(/\bstatus\s*[:\-]\s*(retired|deprecated|archived|superseded|legacy|obsolete|current|active|draft|expired)\b/i);
  if (m) return m[1].toLowerCase();
  const firstLines = head.split('\n').slice(0, 3).join('\n');
  if (/\b(retired|deprecated|superseded|obsolete)\b/i.test(firstLines)) return 'retired';
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const validity = head.match(/\b(?:valid|good|effective)\s+(?:through|thru|until|till)\s+([^\n.;]{3,40})|\bexpires?\s+(?:on\s+)?([^\n.;]{3,40})/i);
  if (validity) {
    const until = parseDocumentDate(validity[1] ?? validity[2] ?? '', true);
    if (until && until < today) return 'expired';
  }
  // A draft of the user's own thesis or spec is still their material; only a
  // draft whose CONTENT is unconfirmed ("not reviewed by attendees") is marked.
  if (/\bdraft\b/i.test(firstLines) && /\b(?:not (?:yet )?(?:been )?(?:reviewed|approved|confirmed|signed off)|unreviewed|unapproved|unconfirmed|pending (?:review|approval))\b/i.test(head)) return 'draft';
  if (/\bcheck\b[^\n.]{0,60}\bcurrent version\b|\bmay (?:be|have) (?:out ?of ?date|outdated|changed)\b/i.test(head)) return 'outdated';
  // An old "last updated" date is NOT marked: past events stay true, and a
  // design doc from 2024 is not wrong for being from 2024.
  return undefined;
}

/**
 * Source types a GENERAL/custom mode gains from what is actually attached
 * (deep-test D10). Custom modes are coerced to the `general` policy, whose
 * allowlist has no CANDIDATE_FILE/JOB_DESCRIPTION — so a custom mode holding a
 * candidate résumé and a JD planned [] for every job-comparison question and
 * refused with STRICT_NOT_FOUND while both files sat indexed. The extension is
 * derived ONLY from the mode's own attachments (never profile pools, never
 * another mode's files) and only for `general`, so built-in mode contracts and
 * source isolation are unchanged. A résumé attached to a custom mode is a
 * CANDIDATE_FILE — someone the mode is ABOUT — never the operator's RESUME.
 */
export function attachmentSourceTypeExtensions(
  modeId: string,
  files: Array<{ fileName?: string; content?: string }>,
): SourceType[] {
  if (modeId !== 'general') return [];
  const out = new Set<SourceType>();
  for (const f of files) {
    const shape = classifyDocShape(f.fileName, f.content);
    if (shape === 'resume') out.add('CANDIDATE_FILE');
    if (shape === 'job_description') out.add('JOB_DESCRIPTION');
  }
  return [...out];
}

export interface ModePortInput {
  modesManager: ModeRetrieverLike;
  modeInfo: unknown;
  files: ModeFileLike[];
  /**
   * The source types this mode authorizes (policy.allowedSourceTypes). Required
   * for correct typing — without it every file was stamped REFERENCE_FILE and
   * résumé/JD modes retrieved evidence they then discarded.
   */
  allowedSourceTypes?: readonly SourceType[];
  /** Evidence token budget from the mode policy (policy.contextBudget.evidenceTokens). */
  tokenBudget: number;
  /** MUST match the userId the caller puts on the turn's scope, or containment
   *  rejects every source. Callers pass one constant to both. */
  userId: string;
  /**
   * Which deadline this turn races — sizes the reranker's budget (3000ms live,
   * 8000ms manual for a reranker the user selected; 1200ms for the bundled
   * default). Absent means live, the tighter of the two.
   */
  rerankSurface?: 'live' | 'manual';
  /**
   * Is a meeting / STT session running? A FUNCTION, evaluated at retrieval time —
   * the live engine only learns it after the port is built. Absent = unknown = the
   * bundled embedder stays lexical-only (see ModeHybridRetriever).
   */
  meetingActive?: () => boolean;
  /** Read a corpus that fits whole instead of retrieving chunks (default on; see SMALL_CORPUS_MAX_TOKENS, WHOLE_PACK_MAX_TOKENS). */
  wholeSmallCorpus?: boolean;
}

/**
 * A fail-closed RetrievalPort over the active mode's reference files.
 *
 * Every source this port can retrieve from gets a DECLARED type, version and
 * scope — no `assume*` opt-ins — so the adopting surface runs the same
 * comparison the benchmarks measure, with a registry that is merely degenerate
 * (one synthetic version, user scope) until ingestion carries real versions and
 * meeting ids. A chunk whose sourceId is outside the declared file set fails
 * closed as UNKNOWN_SOURCE_TYPE rather than riding in on a stale index row.
 */
// ── A SMALL REFERENCE CORPUS IS READ WHOLE (2026-09-30) ─────────────────────
//
// Measured on the 9-mode benchmark (every attached file is 245–652 words):
// 20 of 188 reference-file turns on the final set, 6 of 64 on the holdout and
// 10 of 86 on dev never put the answering text in the prompt, and the answers
// said "I don't have that number in front of me" over a decision log that
// held it. Two mechanisms, both artefacts of choosing chunks from a document
// the prompt could simply hold:
//   • "What's the crash-free bar?" — one content word matched the file, the
//     small-pool probe wanted two, the turn stayed FAST and read nothing;
//   • "What would Enterprise run us for forty techs?" — the hybrid pass
//     returned the one-pager's Add-ons and header chunks and not the Plans
//     chunk ("Enterprise: custom pricing, 100 seat minimum").
// Below this size the whole corpus costs less prompt than the retriever's own
// multi-file budget, so every file is handed over entire, in order, and the
// embed/rerank round trip is skipped. Larger corpora keep retrieval unchanged.
/** Whole-corpus threshold, in the packer's estimateTokens units (~4 chars/token). */
export const SMALL_CORPUS_MAX_TOKENS = 1400;

/** Size of the mode's attached text; null when any file has no extracted text (OCR pending, empty). */
export function referenceCorpusTokens(files: ReadonlyArray<{ content?: string | null }>): number | null {
  if (!files.length) return 0;
  let chars = 0;
  for (const f of files) {
    const c = typeof f.content === 'string' ? f.content.trim() : '';
    if (!c) return null;
    chars += c.length;
  }
  return Math.ceil(chars / 4);
}

/** True when the attached corpus is small enough to be read whole (see SMALL_CORPUS_MAX_TOKENS). */
export function isSmallReferenceCorpus(files: ReadonlyArray<{ content?: string | null }>): boolean {
  const t = referenceCorpusTokens(files);
  return t !== null && t > 0 && t <= SMALL_CORPUS_MAX_TOKENS;
}

// ── A PACK THAT FITS THE PROMPT IS READ WHOLE WHEN A TURN READS THE FILES (2026-10-03) ──
//
// Measured on the evidence-rich benchmark (nine modes, each with a realistic
// pack of 6–9 files, 2,300–9,800 tokens, uploaded as PDF / DOCX / text): every
// file parsed and indexed, and the fact the answer needed was in the prompt on
// 99 of 199 reference-file turns. A turn carries at most 8 passages and
// 1,500–2,400 evidence tokens, a quarter to a half of such a pack, and the
// retriever offered more candidates than were packed on 92 of the 111 turns
// that missed. The answers on those turns were "I'll confirm and come back to
// you", or the value of the outdated file that happened to be chosen; with
// the fact in the prompt the same build scored 8.98 against 5.69 without.
//
// So between the small-corpus size and this one the port hands every file
// over entire, exactly as it does for a small corpus, and the embed / rerank
// round trip is skipped. What does NOT change: a turn the classifier answers
// from general knowledge reads nothing from a pack this size (only a SMALL
// corpus is read on a FAST turn, see the orchestrator), and a larger corpus
// keeps retrieval as it was.
//
// 24,000 SINCE 2026-10-09 (was 12,000). The benchmark's packs were all under
// 12,000, so the old figure had never been tested from above. Four realistic
// packs of about 20,700 tokens (the same fictional companies and courses with
// 4 to 6 more documents each, 361 questions, deepseek-flash, the bundled
// embedding model): with pieces retrieved the answer was right on 54.3 % of
// the questions and 48 % of the facts it needed were in the request (42 % on
// a spoken turn, which searches by keyword with that model); read whole, 87.0 %
// and all of them, the same as the small pack scores (85.9 %). Calculations
// 39 -> 84 of 105; questions that need three or more documents 0 -> 6 of 9.
// A spoken turn's first word came 0.76 s EARLIER (no retrieval and no awaited
// rerank), a typed turn's 0.43 s later, and the request is about 30,000 tokens
// instead of 8,000. 48,000 was measured too and is not safe: see X1 in the
// benchmark log. The claim pass's cap (CLAIM_VERIFIER_MATERIAL_MAX_CHARS)
// moves with this figure, so the pass still sees what the answer saw.
/** Whole-pack threshold, in the packer's estimateTokens units (~4 chars/token). */
export const WHOLE_PACK_MAX_TOKENS = 24000;

/**
 * What the prompt packer charges for one evidence item beyond its text: the
 * <evidence …> tag with its attributes (~380 chars) and escaping. The same
 * figure the orchestrator reserves per whole file (WHOLE_PACK_ITEM_OVERHEAD).
 */
export const PACKED_ITEM_OVERHEAD_TOKENS = 120;

/** True when the attached pack is read whole on a turn that reads the files (small corpus included). */
export function isWholePackCorpus(files: ReadonlyArray<{ content?: string | null }>): boolean {
  const t = referenceCorpusTokens(files);
  return t !== null && t > 0 && t <= WHOLE_PACK_MAX_TOKENS;
}

export function createModeRetrievalPort(input: ModePortInput): RetrievalPort {
  const sourceTypes = new Map<string, SourceType>();
  const activeVersions = new Map<string, string>();
  const chunkVersions = new Map<string, string>();
  const sourceScopes = new Map<string, EvidenceScope>();
  const documentStatuses = new Map<string, string>();
  const allowed = input.allowedSourceTypes ?? (['REFERENCE_FILE'] as const);
  const wholeCorpus = input.wholeSmallCorpus !== false && isWholePackCorpus(input.files);
  for (const f of input.files) {
    sourceTypes.set(f.id, sourceTypeForFile(f.fileName, f.content, allowed));
    activeVersions.set(f.id, 'legacy');
    chunkVersions.set(f.id, 'legacy');
    sourceScopes.set(f.id, { userId: input.userId });
    const status = detectDocumentStatus(f.content);
    if (status) documentStatuses.set(f.id, status);
  }

  const port = createLegacyRetrievalPort({
    registry: { sourceTypes, activeVersions, chunkVersions, sourceScopes },
    retrieve: async (query: string, opts: { topK: number; timeoutMs?: number; exhaustive?: boolean; tokenBudget?: number }) => {
      if (!input.modeInfo || !input.files.length) return [];
      if (wholeCorpus) {
        // Every file, entire, in attachment order. score 1: nothing here was
        // ranked, so no downstream low-confidence rewrite should fire.
        return input.files.map((f) => {
          const status = documentStatuses.get(f.id);
          return {
            sourceId: f.id,
            fileName: f.fileName,
            text: String(f.content ?? '').trim(),
            chunkIndex: 0,
            score: 1,
            provenance: 'MODE_REFERENCE_FILE',
            ...(status ? { metadata: { documentStatus: status, wholeDocument: true } } : { metadata: { wholeDocument: true } }),
          };
        });
      }
      if (!input.modesManager.retrieveHybridRaw) return [];
      // An exhaustive request (RetrievalPlan.exhaustive) needs the RETRIEVER
      // to hand back more than the plan's widened topK can hold at the normal
      // token budget, and the reranker to score a wider pool — otherwise the
      // widened cap downstream just fills with padding.
      const exhaustive = opts.exhaustive === true;
      const res = await input.modesManager.retrieveHybridRaw(input.modeInfo, input.files, {
        // The plan's own budget (multi-file turns) wins over the policy budget the
        // caller constructed this port with, so retriever and packer agree.
        query, topK: opts.topK, tokenBudget: Math.max(input.tokenBudget, opts.tokenBudget ?? 0) * (exhaustive ? 3 : 1),
        // Count each item's <evidence> tag the way the packer will (E11, 2026-10-04).
        perItemOverheadTokens: PACKED_ITEM_OVERHEAD_TOKENS,
        ...(exhaustive ? { rerankPoolMultiplier: 2 } : {}),
        // RERANK ON THE V3 PATH (2026-09-07). This was `allowRerank: false`, and
        // V3 is the default answer path — so a reranker the user selected in
        // Settings (Voyage, OpenRouter, a local cross-encoder) NEVER ran on a
        // live or manual answer; only the legacy validator re-retrieval and the
        // E2E inspect hook reranked. Measured: four V3 turns, zero rerank_gate
        // traces, zero rerank_request telemetry, with a hosted reranker
        // configured and its Test Connection green. The gate inside
        // ModeHybridRetriever still decides (selected → every query, bundled
        // → low-confidence only) and the budget follows the surface.
        allowRerank: true,
        rerankSurface: input.rerankSurface ?? 'live',
        ...(input.meetingActive ? { meetingActive: (() => { try { return input.meetingActive!() === true; } catch { return true; } })() } : {}),
        // The plan's retrieval budget reaches the query embed (2026-09-10). The
        // legacy port has always passed `timeoutMs` here and this port ignored
        // it, so the orchestrator's 1200 ms plan bounded nothing: a slow hosted
        // embed route ran three 3 s attempts plus backoff (13.5 s measured)
        // before the model was asked. Deliberately NOT rerankDeadlineMs — that
        // would skip every rerank whose 3000 ms budget exceeds the 1200 ms plan
        // and silently switch the selected reranker off on the V3 path.
        ...(typeof opts.timeoutMs === 'number' ? { queryEmbedRetryBudgetMs: opts.timeoutMs } : {}),
        // CORRECTED 2026-08-28. This block used to say `deduplicateChunks` keeps
        // the highest-scoring chunk PER FILE by default, so that without this
        // flag a single 66-page reference file returned exactly ONE chunk. That
        // has been FALSE since 2026-07-31: `dedupeGroupKey` keys by
        // `sourceId#chunkIndex` for every caller — exact-duplicate suppression
        // only — and the `forceDocumentGrounding` parameter on
        // `deduplicateChunks` is vestigial.
        //
        // The stale text is worth recording rather than deleting, because it did
        // real damage: it was read as current during the 2026-08-28 retrieval
        // investigation and produced a wrong conclusion about why splitting a
        // combined file helped, which had to be retracted. Verify behaviour
        // against executed code, not docblocks — including this one.
        //
        // The flag is still passed, and still wanted, for its OTHER effects:
        // topK 12 and a 3600-token budget instead of 6/1800, the per-file floor,
        // answerability scoring, section-target and positional restore, and query
        // normalization. Safe here because V3 does not consume
        // `formattedContext` — it takes `chunks` and applies its own source
        // authority, scope and version filtering downstream.
        forceDocumentGrounding: true,
      });
      const chunks = (res?.chunks ?? []) as Array<Record<string, unknown>>;
      // Why the retriever ran without vectors, when it did (2026-09-30). This
      // seam used to read `chunks` only, so an embed that hard-failed mid-turn
      // was invisible in the [V3] line.
      const degraded = typeof (res as { degradedReason?: unknown } | undefined)?.degradedReason === 'string'
        ? String((res as { degradedReason?: unknown }).degradedReason)
        : undefined;
      // THE RERANKER'S ORDER MUST SURVIVE THIS SEAM (2026-09-07). The retriever
      // selects the pool by cross-encoder score when it reranked, but `score`
      // stays the hybrid+answerability value (Context OS reads it as a
      // confidence). Downstream V3 sorts evidence by `finalScore` — the legacy
      // port's accepted-slice fill and the packer's rank() — so handing it the
      // hybrid score silently undid the rerank: measured on a live session,
      // every turn's evidence was ordered by lexical+vector while telemetry
      // showed a billed, successful rerank. When the pool carries rerank
      // scores, they ARE the final score; a chunk the reranker never saw (the
      // un-pooled tail) sinks just below the lowest reranked one, exactly as
      // the retriever's own rankScore(byRerank) orders it.
      const rerankScores = chunks
        .map((c) => c.rerankScore)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      const rerankedPool = rerankScores.length > 0;
      const tailFloor = rerankedPool ? Math.min(...rerankScores) - 1 : 0;
      const mapped = chunks.map((c) => {
        const sid = String(c.sourceId ?? '');
        const status = documentStatuses.get(sid);
        const rerankScore = typeof c.rerankScore === 'number' ? c.rerankScore : undefined;
        return {
          sourceId: sid,
          fileName: c.fileName as string | undefined,
          text: String(c.text ?? ''),
          chunkIndex: c.chunkIndex as number | undefined,
          score: rerankedPool ? (rerankScore ?? tailFloor) : (c.score as number | undefined),
          ftsScore: c.ftsScore as number | undefined,
          vectorScore: c.vectorScore as number | undefined,
          ...(rerankScore !== undefined ? { rerankScore } : {}),
          ...(typeof c.answerabilityScore === 'number' ? { answerabilityScore: c.answerabilityScore } : {}),
          // Provenance (issue 10 / Pattern D): everything this port reads is a
          // file the user attached to the MODE — whatever its name or content
          // claims to be. A reference file named like a transcript stays
          // MODE_REFERENCE_FILE provenance forever.
          provenance: 'MODE_REFERENCE_FILE',
          // Provenance the precedence answer needs (deep-test D8): the file's
          // own declared status, carried as port metadata so the composer can
          // render current-vs-retired instead of letting the model invent why
          // one value won.
          ...(status ? { metadata: { documentStatus: status } } : {}),
        };
      });
      return degraded ? { chunks: mapped, degraded } : mapped;
    },
  });
  return {
    ...port,
    probeAnchors: (question: string): boolean => {
      if (!input.modeInfo || !input.files.length || !input.modesManager.probeReferenceAnchors) return false;
      try { return input.modesManager.probeReferenceAnchors(input.modeInfo, input.files, question) === true; }
      catch { return false; }
    },
  };
}
