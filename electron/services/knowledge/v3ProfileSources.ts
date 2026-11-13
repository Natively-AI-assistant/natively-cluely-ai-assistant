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

/*
 * NO DERIVED PROFILE FACTS (2026-09-30).
 *
 * From 2026-08-02 this module served the résumé-based salary ESTIMATE
 * (SalaryIntelligenceEngine) as a PROFILE_FACT source, so "what is my expected
 * salary" had evidence. That was the wrong fix for a real gap: the figure is a
 * model's MARKET estimate for the role and location, not the candidate's
 * expectation, and PROFILE_FACT is an authoritative source for claims about the
 * user (source-authority-policy USER_* claims). Served there, an LLM guess was
 * spoken in the first person as the user's own number — and it could be the
 * previous résumé's guess, because the estimate cache is unkeyed.
 *
 * PROFILE_FACT is reserved for facts the user stated or verified. Since
 * 2026-10-14 it has a store: "Cue Cards" in Profile Intelligence
 * (ownAnswers.ts, OwnAnswersStore.ts), where the user writes or approves what
 * they say about themselves. Only those answers are served here; a draft
 * Natively wrote and the user has not approved never is. With none saved the
 * pool is empty and a salary-expectation question is answered as unstated,
 * which it is.
 */

/** The user's own saved answers as one profile document, or null when there are none. */
function ownAnswersDoc(): ProfileDocLike | null {
  try {
    const { listOwnAnswers } = require('./OwnAnswersStore') as typeof import('./OwnAnswersStore');
    const { servedOwnAnswers } = require('./ownAnswers') as typeof import('./ownAnswers');
    const answers = servedOwnAnswers(listOwnAnswers());
    if (answers.length === 0) return null;
    return {
      kind: 'fact',
      sourceId: canonicalProfileSourceId('fact'),
      // The content hash: an edited answer is a new version, so the next turn reads the new words.
      versionId: crypto.createHash('sha1').update(JSON.stringify(answers)).digest('hex').slice(0, 16),
      fileName: 'Your own answers (Profile Intelligence)',
      structured: { ownAnswers: answers },
    };
  } catch (err) {
    try { console.warn('[V3] own answers unavailable this turn:', (err as Error)?.message ?? err); } catch { /* noop */ }
    return null;
  }
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

/** The globalThis key premium KnowledgeOrchestrator.setProAccessCheck writes
 *  (ipcHandlers wires proAccess.isProOrTrialActive into it). Read here so the
 *  Cue Cards are held to the same read-time Pro check as the résumé. */
const KNOWLEDGE_PRO_ACCESS_KEY = '__nativelyKnowledgeProAccessV1__';

/** Same rule as premium isKnowledgeMode's first step: wired and not Pro → false;
 *  unwired (tests, OSS) → nothing withheld. */
function proAccessAllows(): boolean {
  const check = (globalThis as unknown as Record<string, unknown>)[KNOWLEDGE_PRO_ACCESS_KEY];
  if (typeof check !== 'function') return true;
  try { return (check as () => unknown)() === true; } catch { return false; }
}

/**
 * May an ANSWER read the résumé / JD? (F-BND-01, F-BND-05, 2026-11-13.)
 *
 * V3 hydrated the profile on mode policy alone: the user's Profile
 * Intelligence switch was never read on the default answer path, and nothing
 * here asked for Pro, so after a licence or trial ended the in-memory résumé
 * stayed one mode-template lock away from every answer. The orchestrator's own
 * `isKnowledgeMode()` is the one answer to both: switch on AND Pro/trial AND a
 * document loaded — the same gate the legacy paths already use.
 *
 * An orchestrator without that method is a duck-typed fixture, not premium;
 * it keeps the old behaviour.
 */
function profileDocsAllowedForAnswers(orchestrator: unknown): boolean {
  const o = orchestrator as { isKnowledgeMode?: () => unknown };
  if (typeof o?.isKnowledgeMode !== 'function') return true;
  try { return o.isKnowledgeMode() === true; } catch { return false; }
}

/**
 * May an ANSWER read the Cue Cards? They are a Pro feature kept under Profile
 * Intelligence, so: Pro at read time, and not when the user switched Profile
 * Intelligence off. The switch can only be ON with a résumé or JD loaded
 * (setKnowledgeMode refuses otherwise), so with no document loaded the cards
 * are read on Pro alone — exactly as before for that user.
 */
function ownAnswersAllowedForAnswers(orchestrator: unknown): boolean {
  if (!proAccessAllows()) return false;
  const o = orchestrator as { isKnowledgeModeSwitchedOn?: () => unknown; activeResume?: unknown; activeJD?: unknown };
  if (typeof o?.isKnowledgeModeSwitchedOn !== 'function') return true;
  if (!o.activeResume && !o.activeJD) return true;
  try { return o.isKnowledgeModeSwitchedOn() === true; } catch { return false; }
}

/**
 * Collect the ACTIVE profile documents (+ their OKF verified cards, when packs
 * exist) as plain values, for an ANSWER: gated on the user's Profile
 * Intelligence switch and on Pro (see profileDocsAllowedForAnswers). Read per
 * turn — no caching here — so a profile re-upload is visible on the very next
 * answer; versionId is the content hash of the structured extraction, which is
 * what invalidates stale evidence.
 *
 * Never throws: profile hydration is additive, and a defect here must degrade
 * to "mode attachments only", never break a live answer.
 */
export function collectV3ProfileSources(orchestrator: unknown): CollectedProfileSources {
  if (!orchestrator) return EMPTY;
  return collectProfileSources(orchestrator, {
    docs: profileDocsAllowedForAnswers(orchestrator),
    ownAnswers: ownAnswersAllowedForAnswers(orchestrator),
  });
}

/**
 * Every active profile document, ungated: for the raw-text INDEX only, which
 * must keep tracking the active documents (and pruning superseded ones)
 * whatever the switch says. An upload indexes before it switches Profile
 * Intelligence on, and switching off must not delete or re-embed the index.
 * Never hand this to an answer.
 */
export function collectProfileSourcesForIndex(orchestrator: unknown): CollectedProfileSources {
  if (!orchestrator) return EMPTY;
  return collectProfileSources(orchestrator, { docs: true, ownAnswers: true });
}

function collectProfileSources(orchestrator: unknown, allow: { docs: boolean; ownAnswers: boolean }): CollectedProfileSources {
  try {
    if (!orchestrator) return EMPTY;
    if (!allow.docs && !allow.ownAnswers) return EMPTY;
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
          // Provenance travels so the port can refuse model-composed AOT cards.
          generatedFrom: typeof c.generatedFrom === 'string' ? c.generatedFrom : undefined,
        }));
      resumeCards = toCards(builder.getProfilePack('resume'));
      jdCards = toCards(builder.getProfilePack('jd'));
    } catch { /* cards are additive; sections alone still answer */ }

    const docs: ProfileDocLike[] = [];
    const resolved: Array<{ role: string; id: string }> = [];

    if (allow.docs && ctx.activeResume?.structured) {
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
    if (allow.docs && ctx.activeJD?.structured) {
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
    const own = allow.ownAnswers ? ownAnswersDoc() : null;
    if (own) {
      docs.push(own);
      resolved.push({ role: 'profile_fact', id: own.sourceId });
    }

    return {
      docs,
      counts: {
        profileResume: allow.docs && ctx.activeResume ? 1 : 0,
        profileJd: allow.docs && ctx.activeJD ? 1 : 0,
        // Only what the user wrote or approved (see the note above). No derived
        // fact is served: a salary ESTIMATE is not a profile fact.
        profileFact: own ? 1 : 0,
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
      // Unlike the mode port, this arm IS raced at the plan's timeout (the
      // profile port's semantic-arm deadline), so a rerank whose own budget is
      // longer can never be waited for. Without the deadline it started anyway
      // and took the arm down with it: live 2026-09-27 (looking for work),
      // "semantic arm exceeded 1200 ms" on 19 of 19 turns — every answer paid
      // 1.2 s and got BM25 only. With it, the retriever skips a rerank that
      // cannot fit and returns its first-stage ranking inside the budget.
      ...(typeof o.timeoutMs === 'number' ? { rerankDeadlineMs: o.timeoutMs } : {}),
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
    const current = () => profilePseudoFiles(collectProfileSourcesForIndex(orchestrator).docs as never);
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
