// electron/services/knowledge/v3ProfileSources.ts
//
// The ONE collector that turns live Profile Intelligence state into the plain
// data the V3 profile retrieval port consumes.
//
// context-intelligence/ modules import nothing from the legacy stack (their
// stated construction rule), so this bridge lives on the legacy side and both
// wiring sites (ipcHandlers manual-chat, IntelligenceEngine
// v3ModeRetrievalContext) call it instead of each re-deriving canonical ids,
// hashes and pack lookups — two copies of a source-identity derivation is the
// drift pattern this codebase keeps re-learning.

import * as crypto from 'crypto';
import * as fs from 'fs';
import type { ProfileDocLike, ProfileCardLike } from '../../context-intelligence/retrieval/profile-retrieval-port';

/**
 * Raw text for a profile doc (deep-test D1). Prefer the persisted raw_text
 * column; for rows ingested before it existed, fall back to re-reading the
 * original file — plain-text formats only (a PDF on disk is bytes, not text)
 * and size-capped to the same bound ingestion uses. Best-effort: any failure
 * returns null and the structured sections still answer.
 */
const RAW_FALLBACK_TEXT_EXT = /\.(md|markdown|txt|text|csv|json|ya?ml|rst|org)$/i;
const RAW_FALLBACK_MAX_CHARS = 200_000;
function rawTextForDoc(persisted: string | null | undefined, sourceUri: string | undefined): string | null {
  if (typeof persisted === 'string' && persisted.trim()) return persisted;
  try {
    if (!sourceUri || !RAW_FALLBACK_TEXT_EXT.test(sourceUri)) return null;
    if (!fs.existsSync(sourceUri)) return null;
    const text = fs.readFileSync(sourceUri, 'utf8');
    return text.trim() ? text.slice(0, RAW_FALLBACK_MAX_CHARS) : null;
  } catch { return null; }
}

/** Same derivation as ProfilePackBuilder.shortId('psrc', `__profile_okf__:${kind}`)
 *  — pure sha1, no timestamp — so the port's sourceIds MATCH the knowledge_sources
 *  rows when packs exist, and stay stable when they do not (OKF flag off). */
function canonicalProfileSourceId(kind: 'resume' | 'jd' | 'fact'): string {
  return `psrc_${crypto.createHash('sha1').update(`__profile_okf__:${kind}`).digest('hex').slice(0, 16)}`;
}

/**
 * DERIVED profile facts (2026-08-02) — currently the résumé-based salary
 * estimate SalaryIntelligenceEngine computes on every résumé ingest.
 *
 * Why this closes a real hole: the planner emits PROFILE_FACT for questions
 * like "what is my expected salary", but the pool behind it was hardcoded
 * empty, so the turn resolved to zero evidence and answered
 * DOCUMENT_FACT_NOT_FOUND — about a number the app had already calculated and
 * written to its own log. The résumé genuinely does not state an expected
 * salary, so RESUME can never answer it; a derived fact is the correct source.
 *
 * Best-effort and additive: any failure yields no fact source, exactly as
 * before. Never throws into a live answer.
 */
function collectDerivedFacts(orchestrator: unknown): { structured: Record<string, unknown>; versionId: string } | null {
  try {
    const getEstimate = (orchestrator as { getResumeSalaryEstimate?: () => unknown })?.getResumeSalaryEstimate;
    if (typeof getEstimate !== 'function') return null;
    const estimate = getEstimate.call(orchestrator) as Record<string, unknown> | null;
    if (!estimate || typeof estimate !== 'object') return null;
    if (typeof estimate.min !== 'number' || typeof estimate.max !== 'number') return null;

    const structured = { salary_estimate: estimate };
    // Version on the CONTENT of the estimate, not on wall-clock: re-deriving the
    // same band must not invalidate evidence mid-conversation, while a genuinely
    // new estimate (new résumé, new role) must.
    const versionId = crypto.createHash('sha1')
      .update(JSON.stringify([estimate.currency, estimate.min, estimate.max, estimate.confidence, estimate.role, estimate.location]))
      .digest('hex').slice(0, 16);
    return { structured, versionId };
  } catch { return null; }
}

export interface CollectedProfileSources {
  docs: ProfileDocLike[];
  counts: { profileResume: number; profileJd: number; profileFact: number };
  /** [{role, id}] for the [V3] telemetry line — identity only, never content. */
  resolved: Array<{ role: string; id: string }>;
}

const EMPTY: CollectedProfileSources = {
  docs: [],
  counts: { profileResume: 0, profileJd: 0, profileFact: 0 },
  resolved: [],
};

/**
 * Collect the ACTIVE profile documents (+ their OKF verified cards, when packs
 * exist) as plain values. Read per turn — no caching here — so a profile
 * re-upload is visible on the very next answer; versionId is the content hash
 * of the structured extraction, which is what invalidates stale evidence.
 *
 * Never throws: profile hydration is additive, and a defect here must degrade
 * to "mode attachments only", never break a live answer.
 */
export function collectV3ProfileSources(orchestrator: unknown): CollectedProfileSources {
  try {
    if (!orchestrator) return EMPTY;
    const { buildActiveProfileContext } = require('../../llm/ActiveProfileContext') as
      typeof import('../../llm/ActiveProfileContext');
    const ctx = buildActiveProfileContext(orchestrator as never);

    // OKF verified cards (optional — packs exist only when the OKF flag was on
    // at ingest time). Keyed by kind via pack fileName? No — by source type.
    let resumeCards: ProfileCardLike[] = [];
    let jdCards: ProfileCardLike[] = [];
    try {
      const { ProfilePackBuilder } = require('./ProfilePackBuilder') as typeof import('./ProfilePackBuilder');
      const builder = ProfilePackBuilder.getInstance();
      const toCards = (pack: { cards?: unknown[] } | null): ProfileCardLike[] =>
        ((pack?.cards ?? []) as Array<Record<string, unknown>>).map((c) => ({
          id: String(c.id ?? ''),
          type: typeof c.type === 'string' ? c.type : undefined,
          title: String(c.title ?? ''),
          body: String(c.body ?? ''),
          approvalStatus: typeof c.approvalStatus === 'string' ? c.approvalStatus : undefined,
        }));
      resumeCards = toCards(builder.getProfilePack('resume'));
      jdCards = toCards(builder.getProfilePack('jd'));
    } catch { /* cards are additive; sections alone still answer */ }

    const docs: ProfileDocLike[] = [];
    const resolved: Array<{ role: string; id: string }> = [];

    if (ctx.activeResume?.structured) {
      const id = canonicalProfileSourceId('resume');
      docs.push({
        kind: 'resume',
        sourceId: id,
        versionId: ctx.activeResume.documentHash,
        fileName: 'Candidate Resume (Profile Intelligence)',
        structured: ctx.activeResume.structured as Record<string, unknown>,
        cards: resumeCards,
        rawText: rawTextForDoc(ctx.activeResume.rawText, ctx.activeResume.sourceUri),
      });
      resolved.push({ role: 'profile_resume', id });
    }
    if (ctx.activeJD?.structured) {
      const id = canonicalProfileSourceId('jd');
      docs.push({
        kind: 'jd',
        sourceId: id,
        versionId: ctx.activeJD.documentHash,
        fileName: 'Target Job Description (Profile Intelligence)',
        structured: ctx.activeJD.structured as Record<string, unknown>,
        cards: jdCards,
        rawText: rawTextForDoc(ctx.activeJD.rawText, ctx.activeJD.sourceUri),
      });
      resolved.push({ role: 'profile_job_description', id });
    }

    // DERIVED facts last: they are the lowest-precedence pool, and a document
    // that actually STATES a fact must always outrank a computed one.
    const facts = collectDerivedFacts(orchestrator);
    if (facts) {
      const id = canonicalProfileSourceId('fact');
      docs.push({
        kind: 'fact',
        sourceId: id,
        versionId: facts.versionId,
        fileName: 'Derived profile facts (Profile Intelligence)',
        structured: facts.structured,
        cards: [],
        rawText: null,
      });
      resolved.push({ role: 'profile_fact', id });
    }

    return {
      docs,
      counts: {
        profileResume: ctx.activeResume ? 1 : 0,
        profileJd: ctx.activeJD ? 1 : 0,
        // DERIVED facts only (2026-08-02). profile_custom_notes still has no
        // production accessor (orphaned v13→14 table), so USER_MOTIVATION —
        // where RESUME is PROHIBITED — remains structurally unsupported and is
        // correctly disclosed as unstated. What changed is that PROFILE_FACT is
        // no longer unconditionally empty: the salary estimate the app already
        // computes is now reachable, instead of the planner asking for a source
        // that could never resolve.
        profileFact: facts ? 1 : 0,
      },
      resolved,
    };
  } catch (err) {
    // Degrading is right; degrading SILENTLY is not — an empty result here is
    // indistinguishable from "no profile uploaded" and reproduces the very
    // defect this module fixes (§22.1: failures are recorded, never converted).
    try { console.warn('[V3] collectV3ProfileSources failed:', (err as Error)?.message ?? err); } catch { /* noop */ }
    return EMPTY;
  }
}

// ── Semantic arm for the profile documents' raw text ────────────────────────
//
// The V3 profile port ranks with BM25 only. Rather than build a second vector
// stack, each profile document's RAW TEXT is indexed by the mode retriever as a
// pseudo reference file — `profile:<kind>:<contentHash>` — so chunking, batched
// embedding, embedding-space handling, stale-index detection, hybrid ranking and
// reranking all come from the one place that already does them. The pseudo-files
// are never rows in the reference-file table: no UI lists them, and they are not
// counted as mode attachments.

const PROFILE_FILE_PREFIX = 'profile:';
const PROFILE_PSEUDO_MODE = { id: '__profile_raw__' };

export interface ProfilePseudoFile { id: string; modeId: string; fileName: string; content: string; createdAt: string; docSourceId: string; kind: string }

export function profilePseudoFiles(docs: ReadonlyArray<{ kind: string; sourceId: string; versionId: string; fileName: string; rawText?: string | null }>): ProfilePseudoFile[] {
  return docs
    .filter((d) => d.kind !== 'fact' && typeof d.rawText === 'string' && d.rawText.trim().length > 0)
    .map((d) => ({
      id: `${PROFILE_FILE_PREFIX}${d.kind}:${d.versionId}`, modeId: PROFILE_PSEUDO_MODE.id, fileName: d.fileName,
      content: d.rawText as string, createdAt: '', docSourceId: d.sourceId, kind: d.kind,
    }));
}

interface ProfileRawModesManager {
  retrieveHybridRaw?: (mode: unknown, files: unknown[], opts: Record<string, unknown>) => Promise<{ chunks?: Array<Record<string, unknown>> } | null | undefined>;
  indexReferenceFile?: (file: unknown) => Promise<void>;
  pruneReferenceFileIndexesByPrefix?: (prefix: string, keepId: string) => number;
}

/**
 * The function the profile port takes as `rawRetriever`. Null when there is no
 * raw text or no retriever — the port then keeps its BM25 raw chunks.
 */
export function buildProfileRawRetriever(
  modesManager: ProfileRawModesManager | null | undefined,
  docs: Parameters<typeof profilePseudoFiles>[0],
  opts: { tokenBudget: number; rerankSurface: 'live' | 'manual'; meetingActive?: () => boolean },
): ((query: string, o: { topK: number; timeoutMs?: number }) => Promise<Array<{ sourceId: string; text: string; chunkIndex: number; score: number }>>) | null {
  const files = profilePseudoFiles(docs);
  if (!modesManager?.retrieveHybridRaw || files.length === 0) return null;
  const docIdByFile = new Map(files.map((f) => [f.id, f.docSourceId]));
  return async (query, o) => {
    let meetingActive: boolean | undefined;
    try { meetingActive = opts.meetingActive ? opts.meetingActive() === true : undefined; } catch { meetingActive = true; }
    const res = await modesManager.retrieveHybridRaw!(PROFILE_PSEUDO_MODE, files, {
      query, topK: o.topK, tokenBudget: opts.tokenBudget, allowRerank: true, rerankSurface: opts.rerankSurface,
      forceDocumentGrounding: true, ...(meetingActive === undefined ? {} : { meetingActive }),
      // The mode port forwards these (2026-09-10, after a measured 13.5 s stall); this binding did not.
      ...(typeof o.timeoutMs === 'number' ? { timeoutMs: o.timeoutMs, queryEmbedRetryBudgetMs: o.timeoutMs } : {}),
    });
    const out: Array<{ sourceId: string; text: string; chunkIndex: number; score: number }> = [];
    for (const c of res?.chunks ?? []) {
      const docId = docIdByFile.get(String(c.sourceId ?? ''));
      if (!docId) continue;
      // The retriever returns chunks in its FINAL order (rerank and rank fusion
      // applied). `rerankScore` is on another scale — fusion caps it near 0.2 — so
      // preferring it, as this did, pushed every reranked row under the port's
      // relevance gate. The first-stage score is the comparable one; order is kept
      // by never letting a later row score above an earlier one.
      const native = Number(c.score ?? 0);
      const prev = out.length ? out[out.length - 1].score : Number.POSITIVE_INFINITY;
      out.push({ sourceId: docId, text: String(c.text ?? ''), chunkIndex: Number(c.chunkIndex ?? 0), score: Math.min(native, prev) });
    }
    return out;
  };
}

const PROFILE_RAW_KINDS = ['resume', 'jd'] as const;

/**
 * Drop the raw-text index of every profile document that is no longer the
 * active one — for EVERY kind, including kinds that have no active document.
 *
 * Review finding, reproduced (2026-09-20): pruning used to run only for kinds
 * that still had an active document, so deleting a résumé pruned nothing and its
 * text and vectors stayed on disk; and a re-upload while v1 was still embedding
 * had v1's in-flight job write its rows back after the prune. Both are personal
 * data outliving the user's request to remove it.
 */
function pruneSupersededProfileIndexes(modesManager: ProfileRawModesManager, activeFiles: ProfilePseudoFile[]): void {
  for (const kind of PROFILE_RAW_KINDS) {
    const keep = activeFiles.find((f) => f.kind === kind)?.id ?? '';
    try { modesManager.pruneReferenceFileIndexesByPrefix?.(`${PROFILE_FILE_PREFIX}${kind}:`, keep); } catch { /* non-fatal */ }
  }
}

/** One run at a time: an index job that is still writing must finish before the next run prunes. */
let profileIndexChain: Promise<unknown> = Promise.resolve();

/**
 * Index the profile documents' raw text (idempotent; the retriever skips a file
 * whose hash, space and chunker version are current) and drop every superseded
 * or deleted version's index — before indexing, and AGAIN after, because the
 * documents can change while a job runs. Called after an ingest AND after a
 * delete or wipe — fire and forget. A document ingested before this shipped is
 * otherwise indexed lazily, by the retriever, the first time a question touches it.
 */
export function indexProfileRawText(modesManager: ProfileRawModesManager | null | undefined, orchestrator: unknown): Promise<number> {
  const run = async (): Promise<number> => {
    if (!modesManager) return 0;
    const current = () => profilePseudoFiles(collectV3ProfileSources(orchestrator).docs as never);
    const files = current();
    pruneSupersededProfileIndexes(modesManager, files);
    if (modesManager.indexReferenceFile) {
      for (const f of files) await modesManager.indexReferenceFile(f).catch(() => { /* logged inside */ });
    }
    pruneSupersededProfileIndexes(modesManager, current());
    return files.length;
  };
  const next = profileIndexChain.then(run, run);
  profileIndexChain = next.catch(() => 0);
  return next;
}

/** Fire-and-forget wrapper for the ingest, delete and wipe handlers: never throws, never blocks the caller. */
export function kickProfileRawIndex(orchestrator: unknown): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ModesManager } = require('../ModesManager');
    void indexProfileRawText(ModesManager.getInstance(), orchestrator).catch(() => { /* non-fatal */ });
  } catch { /* non-fatal: the retriever indexes lazily on first use */ }
}

/**
 * Remove EVERY profile raw-text index, needing no orchestrator. For the wipe
 * paths (trial end, "wipe profile data"): those must clear personal data even
 * when the knowledge orchestrator was never initialised this session.
 */
export function wipeProfileRawIndexes(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ModesManager } = require('../ModesManager');
    const mm = ModesManager.getInstance() as ProfileRawModesManager;
    profileIndexChain = profileIndexChain.then(() => pruneSupersededProfileIndexes(mm, []), () => pruneSupersededProfileIndexes(mm, []));
  } catch { /* non-fatal */ }
}
