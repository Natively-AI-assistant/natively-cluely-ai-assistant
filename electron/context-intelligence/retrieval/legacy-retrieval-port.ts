// electron/context-intelligence/retrieval/legacy-retrieval-port.ts
//
// A RetrievalPort backed by the EXISTING mode retriever.
//
// This is what lets a surface adopt the V3 decision layer before the retrieval
// layer is rebuilt. The orchestrator states WHAT is needed (authorized source
// types, scope, active versions); this adapter asks the legacy retriever for
// candidates and then applies the V3 rules the legacy path never had:
//
//   * scope + active-version filtering BEFORE anything is accepted
//     (Phase 2 measured a 54.8% stale-version rate when this is left to ranking)
//   * claim-authority filtering, so a JD chunk cannot support a user-skill claim
//
// Everything is injected. No import of the legacy stack appears here, so the
// module stays testable without Electron, a DB, or an embedding model.

import type { TurnDecision, EvidenceItem, SourceType } from '../contracts/types';
import type { RetrievalPort } from '../orchestration/orchestrator';
import type { RetrievalAttemptTrace } from '../observability/answer-trace';
import { adaptLegacyChunks, type LegacyChunk } from './legacy-adapter';

/** The shape the legacy retriever returns (ModeHybridRetriever.retrieve). */
export interface LegacyRetrieveFn {
  (query: string, opts: { topK: number; timeoutMs: number }): Promise<LegacyChunk[]>;
}

export interface SourceRegistry {
  /** sourceId -> SourceType. Never guessed: a mislabelled JD defeats authority. */
  sourceTypes: Map<string, SourceType>;
  /** sourceId -> ACTIVE versionId. Absent ⇒ the source is not retrievable. */
  activeVersions: Map<string, string>;
  /** sourceId -> the version a chunk actually came from, when the store knows. */
  chunkVersions?: Map<string, string>;
  /** sourceId -> the scope the source belongs to. Absent ⇒ fails closed. */
  sourceScopes?: Map<string, import('../contracts/types').EvidenceScope>;
}

export interface LegacyPortDeps {
  retrieve: LegacyRetrieveFn;
  registry: SourceRegistry;
  now?: () => number;
  /**
   * Admit chunks whose own version is unknown (see AdaptOptions). Required by
   * the wired manual-chat surface, because the legacy mode-reference store has
   * no version concept; deliberately NOT defaulted on, so a harness that omits
   * `chunkVersions` fails closed instead of measuring an inert filter as a pass.
   */
  assumeCurrentWhenVersionUnknown?: boolean;
  /** See AdaptOptions.assumeInScopeWhenUnknown. Required by the legacy store. */
  assumeInScopeWhenUnknown?: boolean;
}

export function createLegacyRetrievalPort(deps: LegacyPortDeps): RetrievalPort {
  const now = deps.now ?? (() => 0);

  return {
    async retrieve({ decision }: { decision: Readonly<TurnDecision> }) {
      const attempts: RetrievalAttemptTrace[] = [];
      if (!decision.retrievalPlan.shouldRetrieve) {
        return { evidence: [], attempts };
      }

      const query = decision.retrievalPlan.queries[0] ?? decision.resolvedQuestion;
      const t0 = now();

      let raw: LegacyChunk[] = [];
      let failed: string | undefined;
      try {
        raw = await deps.retrieve(query, {
          topK: decision.retrievalPlan.maximumCandidates,
          timeoutMs: decision.retrievalPlan.timeoutMs,
        });
      } catch (e) {
        // §22.1: a retrieval failure is RECORDED, never silently converted into
        // an ungrounded answer that looks grounded. The legacy path turns both
        // NO_RELEVANT_CONTEXT_FOUND and a timeout into {fallback:true}, which is
        // indistinguishable to the user and to telemetry.
        failed = e instanceof Error ? e.message : String(e);
      }

      const adapted = adaptLegacyChunks(raw, {
        scope: decision.scope,
        sourceTypes: deps.registry.sourceTypes,
        activeVersions: deps.registry.activeVersions,
        chunkVersions: deps.registry.chunkVersions,
        sourceScopes: deps.registry.sourceScopes,
        assumeCurrentWhenVersionUnknown: deps.assumeCurrentWhenVersionUnknown,
        assumeInScopeWhenUnknown: deps.assumeInScopeWhenUnknown,
      });

      // Only source types the MODE authorized for this turn.
      const allowed = new Set<SourceType>(decision.retrievalPlan.sourceTypes);
      const inScope = adapted.evidence.filter((e) => allowed.has(e.sourceType));

      // Claim authority: an item is kept only if it can evidence a claim this
      // turn actually needs. This is what stops "Postgres required" (JD) from
      // answering "does the candidate have Postgres experience?".
      const neededClaims = new Set(
        decision.claimRequirements
          .filter((c) => c.authority === 'PRIVATE_SOURCE_REQUIRED')
          .map((c) => c.claimType),
      );
      const evidence: EvidenceItem[] = neededClaims.size
        ? inScope.filter((e) => e.acceptedFor.some((c) => neededClaims.has(c)))
        : inScope;

      // STATUS PRECEDENCE (deep-run 2, issue 4): a retired document's chunk
      // must never outrank a current one on similarity alone — retired pricing
      // beat active pricing in the live run. Retired-class sources sort BELOW
      // every current/unknown source unless the question explicitly asks for
      // the historical value.
      const wantsHistorical = /\b(retired|legacy|archived|old|previous|former|superseded|original|historical)\b/i
        .test(decision.resolvedQuestion);
      const RETIRED = new Set(['retired', 'deprecated', 'archived', 'superseded', 'legacy', 'obsolete']);
      const statusClass = (e: EvidenceItem): number => {
        if (wantsHistorical) return 0;
        const s = (e.metadata as Record<string, unknown> | undefined)?.documentStatus;
        return typeof s === 'string' && RETIRED.has(s) ? 1 : 0;
      };

      // EXPLICITLY-NAMED document targeting (deep-run 2, issue 8): when the
      // question names a specific attachment ("the DECOY candidate ID",
      // "the formula sheet"), chunks from files whose NAME shares a
      // distinctive question token outrank everything else. Generic filename
      // matching — no fixture vocabulary; inert when no title matches.
      const qTokens = new Set(
        decision.resolvedQuestion.toLowerCase().replace(/[^a-z0-9\s_-]/g, ' ').split(/\s+/)
          .filter((w) => w.length > 3),
      );
      // COUNT of distinctive shared tokens, not a boolean: "the decoy
      // candidate ID" shares one token with the primary résumé's filename
      // ("candidate") but two with the decoy's ("candidate", "decoy") — the
      // more specifically named file wins.
      //
      // A count below 2 is NOT an explicit file reference and scores 0: one
      // incidental token ("pricing" in pricing-archive-2023.pdf) placed this
      // tier above status precedence and re-inverted the retired-below-current
      // ordering one commit after it was fixed (audit 2026-08-01). Two shared
      // distinctive tokens is the threshold at which the question is naming
      // the file rather than sharing its vocabulary.
      const titleMatchCount = (e: EvidenceItem): number => {
        const title = (e.documentTitle ?? '').toLowerCase();
        if (!title) return 0;
        const n = new Set(title.split(/[^a-z0-9]+/).filter((t) => t.length > 3 && qTokens.has(t))).size;
        return n >= 2 ? n : 0;
      };
      const sorted = evidence.sort((a, b) =>
        titleMatchCount(b) - titleMatchCount(a)
        || statusClass(a) - statusClass(b)
        || b.finalScore - a.finalScore);

      // PER-TYPE DIVERSITY (deep-run 2, issue 5): a flooded pool (résumé
      // chunks on a project question) consumed every accepted slot. Round-robin
      // across source types in best-first order guarantees each planned type
      // with any admitted evidence keeps at least one slot; within a type,
      // score order is unchanged.
      const max = decision.retrievalPlan.maximumAcceptedEvidence;
      const byType = new Map<string, EvidenceItem[]>();
      for (const e of sorted) {
        const list = byType.get(e.sourceType) ?? [];
        list.push(e);
        byType.set(e.sourceType, list);
      }
      const ranked: EvidenceItem[] = [];
      if (byType.size <= 1) {
        ranked.push(...sorted.slice(0, max));
      } else {
        const groups = [...byType.values()];   // insertion order = best-first
        for (let round = 0; ranked.length < max; round++) {
          let added = false;
          for (const g of groups) {
            if (ranked.length >= max) break;
            const item = g[round];
            if (item) { ranked.push(item); added = true; }
          }
          if (!added) break;
        }
      }

      // Post-adapter drops, made observable (context-debug, 2026-08-01). These
      // three narrowing stages were SILENT — "20 admitted, 0 evidence" was a
      // reachable and unexplainable telemetry state. Set-difference bookkeeping
      // over ≤ maximumCandidates items; no behavioural change.
      const inScopeSet = new Set(inScope);
      const evidenceSet = new Set(evidence);
      const rankedSet = new Set(ranked);
      const postAdapterRejections: Array<{ sourceId: string; reason: string }> = [];
      for (const e of adapted.evidence) {
        if (!inScopeSet.has(e)) postAdapterRejections.push({ sourceId: e.sourceId, reason: 'PLANNED_TYPE_FILTER' });
        else if (!evidenceSet.has(e)) postAdapterRejections.push({ sourceId: e.sourceId, reason: 'CLAIM_AUTHORITY' });
        else if (!rankedSet.has(e)) postAdapterRejections.push({ sourceId: e.sourceId, reason: 'SCORE_CAP' });
      }

      attempts.push({
        attempt: 1,
        strategy: 'legacy_mode_hybrid',
        queries: [query],
        candidateCount: raw.length,
        admittedAfterScopeFilter: adapted.evidence.length,
        rejectedByScopeFilter: adapted.rejected.length,
        // The adapter already knows the reason for every rejection; dropping it
        // here is what made "0 rejected" and "nothing to reject" look identical.
        rejections: [
          ...adapted.rejected.map((r) => ({ sourceId: r.sourceId, reason: r.reason })),
          ...postAdapterRejections,
        ],
        durationMs: now() - t0,
        ...(failed ? { failed } : {}),
      });

      return { evidence: ranked, attempts };
    },
  };
}
