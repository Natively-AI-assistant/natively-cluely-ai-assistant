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
    rerankPoolMultiplier?: number;
    queryEmbedRetryBudgetMs?: number;
  }) => Promise<{ chunks?: Array<Record<string, unknown>> } | null | undefined>;
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

/**
 * Document status declared by the file itself ("Status: RETIRED. …"), read from
 * the head of the content. This is the provenance the precedence answer needs
 * (deep-test D8): the value resolver picked current-over-retired by ranking
 * luck, and when asked WHY, the model invented a rationale because no status
 * ever reached the prompt.
 */
export function detectDocumentStatus(content: string | undefined): string | undefined {
  const head = String(content ?? '').slice(0, 600);
  const m = head.match(/\bstatus\s*[:\-]\s*(retired|deprecated|archived|superseded|legacy|obsolete|current|active|draft)\b/i);
  if (m) return m[1].toLowerCase();
  if (/\b(retired|deprecated|superseded|obsolete)\b/i.test(head.split('\n').slice(0, 3).join('\n'))) return 'retired';
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
export function createModeRetrievalPort(input: ModePortInput): RetrievalPort {
  const sourceTypes = new Map<string, SourceType>();
  const activeVersions = new Map<string, string>();
  const chunkVersions = new Map<string, string>();
  const sourceScopes = new Map<string, EvidenceScope>();
  const documentStatuses = new Map<string, string>();
  const allowed = input.allowedSourceTypes ?? (['REFERENCE_FILE'] as const);
  for (const f of input.files) {
    sourceTypes.set(f.id, sourceTypeForFile(f.fileName, f.content, allowed));
    activeVersions.set(f.id, 'legacy');
    chunkVersions.set(f.id, 'legacy');
    sourceScopes.set(f.id, { userId: input.userId });
    const status = detectDocumentStatus(f.content);
    if (status) documentStatuses.set(f.id, status);
  }

  return createLegacyRetrievalPort({
    registry: { sourceTypes, activeVersions, chunkVersions, sourceScopes },
    retrieve: async (query: string, opts: { topK: number; timeoutMs?: number; exhaustive?: boolean }) => {
      if (!input.modeInfo || !input.files.length || !input.modesManager.retrieveHybridRaw) return [];
      // An exhaustive request (RetrievalPlan.exhaustive) needs the RETRIEVER
      // to hand back more than the plan's widened topK can hold at the normal
      // token budget, and the reranker to score a wider pool — otherwise the
      // widened cap downstream just fills with padding.
      const exhaustive = opts.exhaustive === true;
      const res = await input.modesManager.retrieveHybridRaw(input.modeInfo, input.files, {
        query, topK: opts.topK, tokenBudget: input.tokenBudget * (exhaustive ? 3 : 1),
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
      return chunks.map((c) => {
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
    },
  });
}
