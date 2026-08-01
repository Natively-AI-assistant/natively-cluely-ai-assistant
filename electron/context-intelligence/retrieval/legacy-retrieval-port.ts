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

// ── Targeted-lookup detection (all-files stress run, 2026-08-01) ─────────────
//
// The legacy retriever ranks candidates by hybrid similarity, and a document
// whose pages share boilerplate ("This section is part of the current …")
// makes its own chunks indistinguishable to that ranking: which of them make
// the topK cut is luck. Two observed failures follow directly:
//
//   * "What is TECH-PDF-START-481 associated with?" — the chunk containing the
//     identifier was never a candidate; six sibling chunks of the same PDF were.
//   * "What is the last-page canary?" — the last-page chunk (chunk 13 of 14)
//     missed the cut while pages 3–13 filled every accepted slot.
//
// Both are exact lookups the QUESTION declares structurally, so the port can
// recover them without fixture knowledge and without raising topK globally:
// ONE bounded retry with a distilled query, fired only when the admitted
// evidence visibly lacks what was asked for.

/** Hyphenated codes: ≥2 hyphen segments AND (a digit or all-caps), so
 *  "QF-2026-0514" and "TECH-PDF-START-481" match while hyphenated prose
 *  ("state-of-the-art", "end-to-end") does not. */
const IDENTIFIER_RE = /\b[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+){2,}\b/g;

const extractIdentifiers = (question: string): string[] =>
  (question.match(IDENTIFIER_RE) ?? ([] as string[])).filter((t) => /\d/.test(t) || t === t.toUpperCase());

/** Positional-page qualifiers: the compound form only ("last-page", "first
 *  section"), never a bare positional word — "last quarter revenue" must not
 *  trigger document-position targeting. */
const POSITIONAL_RE = /\b(first|last|final|middle|start|starting|opening|end|ending|closing)[-\s](page|pages|section|paragraph|line|chunk)s?\b/i;

type PositionalDirection = 'first' | 'last' | 'middle';

const positionalDirection = (question: string): PositionalDirection | undefined => {
  const m = question.match(POSITIONAL_RE);
  if (!m) return undefined;
  const w = m[1].toLowerCase();
  if (w === 'middle') return 'middle';
  return w === 'first' || w === 'start' || w === 'starting' || w === 'opening' ? 'first' : 'last';
};

export function createLegacyRetrievalPort(deps: LegacyPortDeps): RetrievalPort {
  const now = deps.now ?? (() => 0);

  return {
    async retrieve({ decision }: { decision: Readonly<TurnDecision> }) {
      const attempts: RetrievalAttemptTrace[] = [];
      if (!decision.retrievalPlan.shouldRetrieve) {
        return { evidence: [], attempts };
      }

      // Only source types the MODE authorized for this turn.
      const allowed = new Set<SourceType>(decision.retrievalPlan.sourceTypes);

      // Claim authority: an item is kept only if it can evidence a claim this
      // turn actually needs. This is what stops "Postgres required" (JD) from
      // answering "does the candidate have Postgres experience?".
      const neededClaims = new Set(
        decision.claimRequirements
          .filter((c) => c.authority === 'PRIVATE_SOURCE_REQUIRED')
          .map((c) => c.claimType),
      );

      /** One retrieve → adapt → authorize pass. Both the primary query and the
       *  targeted retry go through EXACTLY this pipeline: the retry must never
       *  become a side door around scope, version, type or claim filtering. */
      const runPass = async (query: string, attempt: 1 | 2, strategy: string) => {
        const t0 = now();
        let raw: LegacyChunk[] = [];
        let failed: string | undefined;
        try {
          raw = await deps.retrieve(query, {
            topK: decision.retrievalPlan.maximumCandidates,
            timeoutMs: decision.retrievalPlan.timeoutMs,
          });
        } catch (e) {
          // §22.1: a retrieval failure is RECORDED, never silently converted
          // into an ungrounded answer that looks grounded.
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

        const inScope = adapted.evidence.filter((e) => allowed.has(e.sourceType));
        const kept: EvidenceItem[] = neededClaims.size
          ? inScope.filter((e) => e.acceptedFor.some((c) => neededClaims.has(c)))
          : inScope;

        // Post-adapter drops, made observable (context-debug, 2026-08-01):
        // "20 admitted, 0 evidence" was a reachable and unexplainable
        // telemetry state before these were recorded.
        const inScopeSet = new Set(inScope);
        const keptSet = new Set(kept);
        // Title + declared status ride along so the ignored side of a
        // precedence decision can be RECORDED (conversation state), not just
        // counted — "why did you ignore the other values?" needs to know the
        // ignored source was retired, not merely that something was dropped.
        const describe = (e: EvidenceItem) => {
          const s = (e.metadata as Record<string, unknown> | undefined)?.documentStatus;
          return {
            ...(e.documentTitle ? { documentTitle: e.documentTitle } : {}),
            ...(typeof s === 'string' ? { documentStatus: s } : {}),
          };
        };
        const rejections: Array<{ sourceId: string; reason: string; documentTitle?: string; documentStatus?: string }> = [
          ...adapted.rejected.map((r) => ({ sourceId: r.sourceId, reason: r.reason })),
        ];
        for (const e of adapted.evidence) {
          if (!inScopeSet.has(e)) rejections.push({ sourceId: e.sourceId, reason: 'PLANNED_TYPE_FILTER', ...describe(e) });
          else if (!keptSet.has(e)) rejections.push({ sourceId: e.sourceId, reason: 'CLAIM_AUTHORITY', ...describe(e) });
        }

        attempts.push({
          attempt,
          strategy,
          queries: [query],
          candidateCount: raw.length,
          admittedAfterScopeFilter: adapted.evidence.length,
          rejectedByScopeFilter: adapted.rejected.length,
          rejections,
          durationMs: now() - t0,
          ...(failed ? { failed } : {}),
        });

        return kept;
      };

      const primaryQuery = decision.retrievalPlan.queries[0] ?? decision.resolvedQuestion;
      const primary = await runPass(primaryQuery, 1, 'legacy_mode_hybrid');

      // ── PROPERTY-AWARE RETRY ──────────────────────────────────────────────
      // Bounded and deterministic: at most ONE extra retrieval, only when the
      // question names an exact identifier that no admitted chunk contains, or
      // targets a document position. Never expands to unauthorized sources —
      // the retry runs through the same runPass filters.
      const identifiers = extractIdentifiers(decision.resolvedQuestion);
      const identifierMissing =
        identifiers.length > 0 &&
        !primary.some((e) => identifiers.some((id) => e.content.toLowerCase().includes(id.toLowerCase())));
      const direction = positionalDirection(decision.resolvedQuestion);

      let merged = primary;
      if (identifierMissing || direction) {
        const retryQuery = identifierMissing
          ? identifiers.join(' ')
          // Strip the positional compound so lexical search finds the asked-for
          // head term wherever it sits ("last-page canary" → "canary").
          : decision.resolvedQuestion.replace(new RegExp(POSITIONAL_RE.source, 'gi'), ' ').replace(/\s+/g, ' ').trim();
        const retry = retryQuery
          ? await runPass(retryQuery, 2, identifierMissing ? 'targeted_exact_lookup' : 'targeted_positional')
          : [];

        // Merge without double-counting: evidenceId is derived from
        // sourceId+chunkIndex, but chunkIndex-less stores fall back to the raw
        // array index, so the key includes a content prefix as a tiebreaker.
        const seen = new Set<string>();
        const key = (e: EvidenceItem) =>
          `${e.sourceId}|${e.chunkIndex ?? '?'}|${e.content.replace(/\s+/g, ' ').slice(0, 80)}`;
        merged = [];
        for (const e of [...primary, ...retry]) {
          const k = key(e);
          if (!seen.has(k)) { seen.add(k); merged.push(e); }
        }
      }

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

      // EXACT-IDENTIFIER tier: a chunk containing the very code the question
      // asks about outranks everything — asking about "QF-2026-0514" is as
      // explicit as naming a file, so this sits above status precedence too.
      const identifierHit = (e: EvidenceItem): number =>
        identifiers.length && identifiers.some((id) => e.content.toLowerCase().includes(id.toLowerCase())) ? 1 : 0;

      // POSITIONAL tier: for "last-page …" prefer each multi-chunk document's
      // extremal chunk. Only documents with ≥2 indexed candidate chunks get a
      // target — a single-chunk file is trivially both its first and last page
      // and must not be boosted for free. Sits BELOW status precedence: a
      // retired document's last page must not beat current evidence.
      let positionalHit = (_e: EvidenceItem): number => 0;
      if (direction) {
        const perDoc = new Map<string, number[]>();
        for (const e of merged) {
          if (typeof e.chunkIndex !== 'number') continue;
          const list = perDoc.get(e.sourceId) ?? [];
          list.push(e.chunkIndex);
          perDoc.set(e.sourceId, list);
        }
        const target = new Map<string, number>();
        for (const [sid, idxs] of perDoc) {
          const uniq = [...new Set(idxs)].sort((a, b) => a - b);
          if (uniq.length < 2) continue;
          if (direction === 'first') target.set(sid, uniq[0]);
          else if (direction === 'last') target.set(sid, uniq[uniq.length - 1]);
          else target.set(sid, uniq[Math.floor(uniq.length / 2)]);
        }
        positionalHit = (e: EvidenceItem): number =>
          typeof e.chunkIndex === 'number' && target.get(e.sourceId) === e.chunkIndex ? 1 : 0;
      }

      const sorted = merged.sort((a, b) =>
        identifierHit(b) - identifierHit(a)
        || titleMatchCount(b) - titleMatchCount(a)
        || statusClass(a) - statusClass(b)
        || positionalHit(b) - positionalHit(a)
        || b.finalScore - a.finalScore);

      // ── ACCEPTED-SLICE FILL ───────────────────────────────────────────────
      // Three rules, applied in order of authority:
      //
      //  1. STATUS PARTITION (audit MEDIUM, 2026-08-01): the diversity
      //     round-robin used to walk per-type lists in lockstep, so a retired
      //     chunk of type B re-entered ahead of current chunks of type A —
      //     re-promoting exactly what the sort had demoted. Current-class
      //     items now fill every slot they can before any retired-class item
      //     is considered.
      //  2. PER-TYPE round-robin (deep-run 2, issue 5): a flooded pool (résumé
      //     chunks on a project question) must not consume every slot; each
      //     planned type with admitted evidence keeps at least one.
      //  3. PER-DOCUMENT interleave within a type (all-files stress run): a
      //     large PDF and a small summary are both PROJECT_FILE, and the PDF's
      //     sibling chunks consumed the whole type allotment — the "small file
      //     loses to large distractor" failure. Documents within a type now
      //     alternate, best-first; a type with one document is unchanged.
      //
      // Exact duplicates (same source, same normalized text) are dropped
      // outright — they add zero information. Deliberately NOT fuzzy: the
      // observed flooding chunks share a boilerplate opening but differ in
      // body, and a similarity threshold could discard the only chunk that
      // contains the asked-for fact.
      const max = decision.retrievalPlan.maximumAcceptedEvidence;
      const ranked: EvidenceItem[] = [];
      const seenContent = new Set<string>();
      // An EXPLICIT reference — the exact identifier, or a file the question
      // names with ≥2 distinctive tokens — is exempt from status demotion in
      // the fill, mirroring the sort tiers above: "what price is in the
      // pricing archive?" must lead with the archive even though it is
      // archived, while un-named retired chunks still fill last.
      const fillClass = (e: EvidenceItem): number =>
        identifierHit(e) || titleMatchCount(e) > 0 ? 0 : statusClass(e);
      const classes: EvidenceItem[][] = [[], []];
      for (const e of sorted) {
        const ck = `${e.sourceId}|${e.content.replace(/\s+/g, ' ').trim().toLowerCase()}`;
        if (seenContent.has(ck)) continue;
        seenContent.add(ck);
        classes[fillClass(e)].push(e);
      }

      for (const cls of classes) {
        if (ranked.length >= max) break;

        // type -> document -> chunks, all in best-first insertion order.
        const byType = new Map<string, Map<string, EvidenceItem[]>>();
        for (const e of cls) {
          const docs = byType.get(e.sourceType) ?? new Map<string, EvidenceItem[]>();
          const doc = docs.get(e.sourceId) ?? [];
          doc.push(e);
          docs.set(e.sourceId, doc);
          byType.set(e.sourceType, docs);
        }

        // Interleave documents within each type (rule 3).
        const perType: EvidenceItem[][] = [...byType.values()].map((docs) => {
          const lists = [...docs.values()];
          if (lists.length <= 1) return lists[0] ?? [];
          const out: EvidenceItem[] = [];
          for (let round = 0; out.length < cls.length; round++) {
            let added = false;
            for (const l of lists) {
              const item = l[round];
              if (item) { out.push(item); added = true; }
            }
            if (!added) break;
          }
          return out;
        });

        // Round-robin across types (rule 2), inside this status class only
        // (rule 1).
        if (perType.length <= 1) {
          for (const e of perType[0] ?? []) {
            if (ranked.length >= max) break;
            ranked.push(e);
          }
        } else {
          for (let round = 0; ranked.length < max; round++) {
            let added = false;
            for (const g of perType) {
              if (ranked.length >= max) break;
              const item = g[round];
              if (item) { ranked.push(item); added = true; }
            }
            if (!added) break;
          }
        }
      }

      // SCORE_CAP bookkeeping over the final selection (the per-pass rejection
      // reasons were recorded in runPass).
      const rankedSet = new Set(ranked);
      const last = attempts[attempts.length - 1];
      if (last) {
        for (const e of merged) {
          if (rankedSet.has(e)) continue;
          const s = (e.metadata as Record<string, unknown> | undefined)?.documentStatus;
          last.rejections?.push({
            sourceId: e.sourceId,
            reason: 'SCORE_CAP',
            ...(e.documentTitle ? { documentTitle: e.documentTitle } : {}),
            ...(typeof s === 'string' ? { documentStatus: s } : {}),
          });
        }
      }

      return { evidence: ranked, attempts };
    },
  };
}
