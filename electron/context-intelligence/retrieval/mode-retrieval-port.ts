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
const RESUME_MARKERS = [
  /^#{1,3}\s*(work\s+)?experience\b/im, /^#{1,3}\s*education\b/im, /^#{1,3}\s*projects?\b/im,
  /\bcgpa\b|\bgpa\b/i, /^#{1,3}\s*(technical\s+)?skills?\b/im, /^#{1,3}\s*summary\b/im,
  /\bportfolio\b/i, /\bgithub\.com\/|\bgithub:/i,
];
const JD_MARKERS = [
  /minimum\s+qualifications/i, /preferred\s+qualifications/i, /^#{1,3}\s*responsibilities\b/im,
  /about\s+the\s+role/i, /what\s+you.{0,3}ll\s+do/i, /\byears?\s+of\s+(professional\s+)?experience\b/i,
  /we\s+are\s+looking\s+for/i, /^#{1,3}\s*compensation\b/im,
];

const countMatches = (text: string, pats: RegExp[]) => pats.reduce((n, p) => n + (p.test(text) ? 1 : 0), 0);

export function classifyDocShape(fileName = '', content = ''): DocShape {
  const head = String(content).slice(0, 6000);   // structure lives near the top
  const resumeScore = countMatches(head, RESUME_MARKERS);
  const jdScore = countMatches(head, JD_MARKERS);

  // An explicit filename wins, but only when the content does not clearly
  // contradict it — a file called `resume.md` containing "Minimum
  // Qualifications" is a JD someone named badly.
  if (JD_NAME.test(fileName) && resumeScore <= jdScore) return 'job_description';
  if (RESUME_NAME.test(fileName) && jdScore <= resumeScore) return 'resume';

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

  return can('REFERENCE_FILE') ? 'REFERENCE_FILE' : (allowed[0] ?? 'REFERENCE_FILE');
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
  const allowed = input.allowedSourceTypes ?? (['REFERENCE_FILE'] as const);
  for (const f of input.files) {
    sourceTypes.set(f.id, sourceTypeForFile(f.fileName, f.content, allowed));
    activeVersions.set(f.id, 'legacy');
    chunkVersions.set(f.id, 'legacy');
    sourceScopes.set(f.id, { userId: input.userId });
  }

  return createLegacyRetrievalPort({
    registry: { sourceTypes, activeVersions, chunkVersions, sourceScopes },
    retrieve: async (query: string, opts: { topK: number }) => {
      if (!input.modeInfo || !input.files.length || !input.modesManager.retrieveHybridRaw) return [];
      const res = await input.modesManager.retrieveHybridRaw(input.modeInfo, input.files, {
        query, topK: opts.topK, tokenBudget: input.tokenBudget, allowRerank: false,
      });
      return (res?.chunks ?? []).map((c: Record<string, unknown>) => ({
        sourceId: String(c.sourceId ?? ''),
        fileName: c.fileName as string | undefined,
        text: String(c.text ?? ''),
        chunkIndex: c.chunkIndex as number | undefined,
        score: c.score as number | undefined,
        ftsScore: c.ftsScore as number | undefined,
        vectorScore: c.vectorScore as number | undefined,
      }));
    },
  });
}
