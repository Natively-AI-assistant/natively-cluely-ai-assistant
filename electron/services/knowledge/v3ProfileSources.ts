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
import type { ProfileDocLike, ProfileCardLike } from '../../context-intelligence/retrieval/profile-retrieval-port';

/** Same derivation as ProfilePackBuilder.shortId('psrc', `__profile_okf__:${kind}`)
 *  — pure sha1, no timestamp — so the port's sourceIds MATCH the knowledge_sources
 *  rows when packs exist, and stay stable when they do not (OKF flag off). */
function canonicalProfileSourceId(kind: 'resume' | 'jd'): string {
  return `psrc_${crypto.createHash('sha1').update(`__profile_okf__:${kind}`).digest('hex').slice(0, 16)}`;
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
      });
      resolved.push({ role: 'profile_job_description', id });
    }

    return {
      docs,
      counts: {
        profileResume: ctx.activeResume ? 1 : 0,
        profileJd: ctx.activeJD ? 1 : 0,
        // profile_custom_notes has no production accessor (orphaned v13→14
        // table) — the PROFILE_FACT pool is empty until one exists. Most
        // PROFILE_FACT-authoritative claims are also RESUME-authoritative and
        // ride the résumé sections; the KNOWN exception is USER_MOTIVATION
        // (RESUME is PROHIBITED for it), which therefore stays structurally
        // unsupported — an unstated reason is disclosed as unstated, which is
        // the correct behaviour until real profile facts exist.
        profileFact: 0,
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
