// electron/context-intelligence/retrieval/meeting-retrieval-port.ts
//
// A RetrievalPort over the meeting RAG store.
//
// WHY THIS EXISTS
// The mode port covers reference files only, so a MEETING_STATEMENT question on
// a wired surface composed an honest but useless no-evidence disclosure even
// when the answer had been said out loud a minute earlier. That gap was recorded
// as the named prerequisite in 13_FINAL_IMPLEMENTATION_REPORT §13.7; this closes
// it.
//
// WHY NOT `meetingChunksToEvidenceItems`
// The removal matrix lists that adapter as "complete, tested, ZERO production
// callers — the fix is to WIRE it". It is wired on the Context OS path and stays
// there. It is deliberately NOT used here, because it produces a Context OS
// `EvidenceItem` — a different evidence contract from V3's — and routing V3
// through it would put two evidence contracts on one answer, which is the exact
// duplication (F2) this rebuild exists to end.
//
// The invariant that adapter enforces is not lost: it rejects chunks from a
// different meeting as `wrong_entity`, and 06_SOURCE_AUTHORITY_SPEC §4 says the
// mechanism should be `scopeId = currentMeetingId`. So this port declares each
// chunk's source scope as its OWN meeting and lets the V3 adapter's scope
// containment do the rejection — the same filter already measured rejecting 14
// out-of-scope records in golden-live. One filter, not two implementations of
// one rule.

import type { EvidenceScope, SourceType } from '../contracts/types';
import type { RetrievalPort } from '../orchestration/orchestrator';
import { createLegacyRetrievalPort } from './legacy-retrieval-port';

/** The slice of RAGRetriever this port uses. Structural — no legacy import. */
export interface MeetingRetrieverLike {
  retrieve?: (query: string, options: { meetingId?: string; topK?: number; maxTokens?: number }) => Promise<{
    chunks?: Array<Record<string, unknown>>;
  } | null | undefined>;
}

export interface MeetingPortInput {
  retriever: MeetingRetrieverLike;
  /** The live meeting. Omit for an explicit post-meeting cross-meeting search. */
  currentMeetingId?: string | null;
  userId: string;
  tokenBudget: number;
  /**
   * Confidence floor, mirroring MEETING_RAG_MIN_SIMILARITY. A similarity-ranked
   * store always returns its top-k, so without a floor the least-bad chunk in an
   * unrelated meeting becomes "evidence" — the failure mode the mode retriever's
   * own MIN_COMBINED_SCORE exists to prevent.
   */
  minSimilarity?: number;
}

export const MEETING_MIN_SIMILARITY = 0.3;

/**
 * A fail-closed RetrievalPort over meeting transcripts.
 *
 * Sources are declared per CHUNK rather than per file, because a meeting store
 * has no file identity — the source id is the meeting, and its scope is that
 * meeting. A chunk from another meeting therefore arrives with a scope the turn
 * does not contain, and the adapter rejects it OUT_OF_SCOPE without this module
 * needing any isolation logic of its own.
 */
export function createMeetingRetrievalPort(input: MeetingPortInput): RetrievalPort {
  const floor = input.minSimilarity ?? MEETING_MIN_SIMILARITY;

  // Populated per call: unlike mode files, the source set is not known up front.
  const sourceTypes = new Map<string, SourceType>();
  const activeVersions = new Map<string, string>();
  const chunkVersions = new Map<string, string>();
  const sourceScopes = new Map<string, EvidenceScope>();

  return createLegacyRetrievalPort({
    registry: { sourceTypes, activeVersions, chunkVersions, sourceScopes },
    retrieve: async (query: string, opts: { topK: number }) => {
      if (!input.retriever.retrieve) return [];
      const res = await input.retriever.retrieve(query, {
        // Scoping the QUERY to the live meeting as well is belt-and-braces: the
        // scope filter would reject a foreign chunk anyway, but not fetching it
        // is cheaper and keeps the candidate pool honest.
        ...(input.currentMeetingId ? { meetingId: input.currentMeetingId } : {}),
        topK: opts.topK,
        maxTokens: input.tokenBudget,
      });

      const out = [];
      for (const c of res?.chunks ?? []) {
        const meetingId = String((c as Record<string, unknown>).meetingId ?? '');
        const text = String((c as Record<string, unknown>).text ?? '');
        if (!meetingId || !text.trim()) continue;

        const similarity = Number((c as Record<string, unknown>).similarity ?? 0);
        if (!Number.isFinite(similarity) || similarity < floor) continue;

        // One source per MEETING. Declaring per chunk would make every chunk its
        // own source and defeat any future version comparison.
        if (!sourceTypes.has(meetingId)) {
          sourceTypes.set(meetingId, 'MEETING_TRANSCRIPT');
          activeVersions.set(meetingId, 'live');
          chunkVersions.set(meetingId, 'live');
          sourceScopes.set(meetingId, { userId: input.userId, meetingId });
        }

        out.push({
          sourceId: meetingId,
          fileName: `meeting:${meetingId}`,
          text,
          chunkIndex: Number((c as Record<string, unknown>).chunkIndex ?? 0),
          score: similarity,
          vectorScore: similarity,
          // Provenance (issue 10 / Pattern D): meeting-RAG chunks are built
          // from spoken transcript (zero-eligible sessions no longer reach RAG
          // at all). Under the explicit test-injection env every session may
          // contain injected turns, so the whole run is stamped
          // TEST_TRANSCRIPT — never LIVE_STT — keeping provenance truthful in
          // test runs. Per-chunk origin fidelity requires persisting origin
          // into the chunk store (documented follow-up).
          provenance: process.env.NATIVELY_TEST_TRANSCRIPT_INJECTION === '1'
            ? 'TEST_TRANSCRIPT' : 'LIVE_STT',
        });
      }
      return out;
    },
  });
}

/**
 * Fan out to several ports and merge their evidence for one turn.
 *
 * A live meeting question can legitimately need BOTH a reference file and
 * something that was said — the mode port and the meeting port each see half.
 * Merging at the port boundary keeps `orchestrate()` unchanged and preserves
 * every per-source rule: each port applies its own fail-closed registry first,
 * so this can only ever narrow what a single port would have admitted.
 */
export function combineRetrievalPorts(ports: RetrievalPort[]): RetrievalPort {
  return {
    async retrieve(args) {
      const results = await Promise.all(ports.map(async (p) => {
        try {
          return await p.retrieve(args);
        } catch (e) {
          // One failing source must not blank the turn — §22.1: a dependency
          // failure is RECORDED, never silently converted into an ungrounded
          // answer that looks grounded.
          return {
            evidence: [],
            attempts: [{
              attempt: 1 as const, strategy: 'combined_port_failure', queries: [],
              candidateCount: 0, admittedAfterScopeFilter: 0, rejectedByScopeFilter: 0,
              durationMs: 0, failed: e instanceof Error ? e.message : String(e),
            }],
          };
        }
      }));

      const merged = results.flatMap((r) => r.evidence);
      const attempts = results.flatMap((r) => r.attempts);

      // Cross-port content dedup (2026-07-31): the same document can now
      // legitimately arrive from two pools — the Profile Intelligence résumé
      // AND a duplicate copy attached to the mode. Identical passages from
      // different sourceIds would double-weight one document inside the cap,
      // so exact (normalised) duplicates keep only the highest-scoring copy.
      // Distinct wordings of the same fact are NOT deduped — that is ordinary
      // multi-source corroboration and the packer budget handles it.
      const byContent = new Map<string, (typeof merged)[number]>();
      for (const e of merged) {
        const key = e.content.trim().toLowerCase().replace(/\s+/g, ' ');
        const prior = byContent.get(key);
        if (!prior) { byContent.set(key, e); continue; }
        const winner = e.finalScore > prior.finalScore ? e : prior;
        const loser = winner === e ? prior : e;
        // Identical text: the complete-record declaration transfers to the
        // surviving copy, or the absence contract would silently stop
        // rendering because the higher-scoring duplicate came from a port
        // that does not stamp metadata (review finding, 2026-07-31).
        const keep = (loser.metadata as Record<string, unknown> | undefined)?.completeInventory === true
          && (winner.metadata as Record<string, unknown> | undefined)?.completeInventory !== true
          ? { ...winner, metadata: { ...winner.metadata, ...loser.metadata } }
          : winner;
        byContent.set(key, keep);
      }
      const evidence = [...byContent.values()];

      // Re-rank across sources, then apply the turn's own accepted-evidence cap
      // — otherwise two ports each returning their maximum would double it.
      const max = args.decision.retrievalPlan.maximumAcceptedEvidence;
      evidence.sort((a, b) => b.finalScore - a.finalScore);
      return { evidence: evidence.slice(0, max), attempts };
    },
  };
}
