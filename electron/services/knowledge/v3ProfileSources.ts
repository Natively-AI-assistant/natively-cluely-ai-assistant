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
