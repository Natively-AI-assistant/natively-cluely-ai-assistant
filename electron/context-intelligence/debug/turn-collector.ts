// electron/context-intelligence/debug/turn-collector.ts
//
// Turn-scoped collector for Context Intelligence debug records.
//
// CORRELATION MODEL: collectors live in a registry keyed by requestId — there
// is deliberately NO "current turn" global. Two overlapping turns each hold
// their own collector; a delayed stream completion finds its collector by the
// requestId it captured at start. The collector receives SNAPSHOTS (values,
// never live references) and tolerates missing stages: complete() emits
// whatever was recorded, even when retrieval or generation failed.
//
// The collector OBSERVES production decisions (AnswerTrace, TurnDecision,
// EvidenceItem) — it never recomputes intent, plans, coverage or precedence.

import type { TurnDecision, EvidenceItem } from '../contracts/types';
import type { AnswerTrace } from '../observability/answer-trace';
import type {
  ContextDebugError, ContextDebugEvidence, ContextDebugIdentity, ContextDebugLevel,
  ContextDebugPrecedenceSource, ContextDebugRejectedEvidence, ContextDebugRetrievalQuery,
  ContextDebugSource, ContextDebugTurnComplete,
} from './debug-types';
import { CONTEXT_DEBUG_SCHEMA_VERSION } from './debug-types';
import { buildPreview, deepRedactStrings } from './redaction';
import { getContextDebugWriter } from './jsonl-writer';
import { renderTurnSummary } from './terminal';

const RETIRED_STATUSES = new Set(['retired', 'deprecated', 'archived', 'superseded', 'legacy', 'obsolete']);

export interface CollectorOptions {
  level: Exclude<ContextDebugLevel, 'off'>;
  includeContent: boolean;
  now?: () => Date;
  /** Injectable sinks for tests. Defaults: shared writer + console. */
  write?: (record: unknown) => void;
  print?: (text: string) => void;
}

interface EvidenceSnapshot {
  evidence: ContextDebugEvidence[];
  rejected: ContextDebugRejectedEvidence[];
}

const matchTypeOf = (lexical?: number | null, vector?: number | null): ContextDebugEvidence['matchType'] => {
  const hasLex = typeof lexical === 'number' && lexical > 0;
  const hasVec = typeof vector === 'number' && vector > 0;
  if (hasLex && hasVec) return 'mixed';
  if (hasLex) return 'lexical';
  if (hasVec) return 'semantic';
  return undefined;
};

export class ContextDebugTurnCollector {
  readonly identity: ContextDebugIdentity;
  private readonly level: Exclude<ContextDebugLevel, 'off'>;
  private readonly includeContent: boolean;
  private readonly now: () => Date;
  private readonly write: (record: unknown) => void;
  private readonly print: (text: string) => void;

  private readonly startedAt: Date;
  private completedAt: Date | null = null;
  private finalized = false;

  private trace: AnswerTrace | null = null;
  private decision: Readonly<TurnDecision> | null = null;
  private modeName: string | undefined;
  private modeType: 'default' | 'custom' = 'default';
  private policyVersion: string | undefined;
  private extraAllowedSourceTypes: string[] = [];

  private availableSources: ContextDebugTurnComplete['availableSources'] = {
    modeAttachmentCount: 0, profileResumeCount: 0,
    profileJobDescriptionCount: 0, profileFactCount: 0,
  };
  private authorizedSources: ContextDebugSource[] = [];
  private conversationState: ContextDebugTurnComplete['conversationState'];
  private evidenceSnapshot: EvidenceSnapshot = { evidence: [], rejected: [] };
  private documentSpecific = false;
  private propertyMatched = false;

  private generationStartedAtMs: number | null = null;
  private firstTokenAtMs: number | null = null;
  private generationEndedAtMs: number | null = null;
  private provider: string | undefined;
  private serverModel: string | undefined;
  private outputCharacters = 0;
  private streamCommitted = false;
  private commitRejectedReason: string | null = null;
  private finalAnswer = '';
  private errors: ContextDebugError[] = [];

  constructor(identity: ContextDebugIdentity, opts: CollectorOptions) {
    this.identity = identity;
    this.level = opts.level;
    this.includeContent = opts.includeContent;
    this.now = opts.now ?? (() => new Date());
    this.startedAt = this.now();
    this.write = opts.write ?? ((record) => { getContextDebugWriter()?.append(record); });
    this.print = opts.print ?? ((text) => { console.log(text); });
  }

  /** The bridge's one-shot snapshot: the production trace + frozen decision. */
  recordDecisionTrace(input: {
    trace: AnswerTrace;
    decision: Readonly<TurnDecision>;
    modeName?: string | null;
    modeType?: 'default' | 'custom';
    policyVersion?: string;
    extraAllowedSourceTypes?: readonly string[];
    documentSpecific?: boolean;
    propertyMatched?: boolean;
  }): void {
    this.trace = input.trace;
    this.decision = input.decision;
    this.modeName = input.modeName ?? undefined;
    if (input.modeType) this.modeType = input.modeType;
    this.policyVersion = input.policyVersion;
    this.extraAllowedSourceTypes = [...(input.extraAllowedSourceTypes ?? [])];
    this.documentSpecific = Boolean(input.documentSpecific);
    this.propertyMatched = Boolean(input.propertyMatched);
  }

  recordAvailableSources(counts: Partial<ContextDebugTurnComplete['availableSources']>): void {
    this.availableSources = { ...this.availableSources, ...counts };
  }

  /** Identity of the files/pools this turn COULD read (never content). */
  recordAuthorizedSources(sources: ContextDebugSource[]): void {
    this.authorizedSources = sources;
  }

  recordConversationState(state: NonNullable<ContextDebugTurnComplete['conversationState']>): void {
    this.conversationState = state;
  }

  /** Selected evidence with port metadata (status, section, scores, content). */
  recordEvidenceItems(evidence: readonly EvidenceItem[]): void {
    this.evidenceSnapshot.evidence = evidence.map((e) => {
      const md = (e.metadata ?? {}) as Record<string, unknown>;
      const item: ContextDebugEvidence = {
        sourceId: e.sourceId,
        sourceRole: e.sourceType,
        sourceName: e.documentTitle,
        chunkId: typeof e.chunkIndex === 'number' ? `chunk_${e.chunkIndex}` : undefined,
        section: e.section,
        lexicalScore: e.keywordScore ?? null,
        vectorScore: e.semanticScore ?? null,
        rerankScore: e.rerankerScore ?? null,
        answerabilityScore: e.answerabilityScore ?? null,
        finalScore: e.finalScore ?? null,
        matchType: matchTypeOf(e.keywordScore, e.semanticScore),
        contentLength: e.content?.length ?? 0,
      };
      if (this.level === 'verbose' && typeof e.content === 'string' && e.content) {
        const p = this.includeContent
          ? { text: buildPreview(e.content, { includePii: true, maxChars: Number.MAX_SAFE_INTEGER }).text, redacted: true, truncated: false }
          : buildPreview(e.content);
        item.preview = p.text;
        item.previewRedacted = p.redacted || p.truncated;
      }
      return item;
    });
  }

  recordRejectedEvidence(rejected: ContextDebugRejectedEvidence[]): void {
    this.evidenceSnapshot.rejected = rejected;
  }

  recordGenerationStart(info: { provider?: string; serverModel?: string } = {}): void {
    this.generationStartedAtMs = Date.now();
    this.provider = info.provider ?? this.provider;
    this.serverModel = info.serverModel ?? this.serverModel;
  }

  recordFirstToken(): void {
    if (this.firstTokenAtMs === null) this.firstTokenAtMs = Date.now();
  }

  recordAnswer(finalText: string, committed: boolean, commitRejectedReason?: string | null): void {
    this.generationEndedAtMs = Date.now();
    this.finalAnswer = finalText;
    this.outputCharacters = finalText.length;
    this.streamCommitted = committed;
    this.commitRejectedReason = commitRejectedReason ?? null;
  }

  recordError(err: ContextDebugError): void {
    this.errors.push(err);
  }

  // ── finalization ──────────────────────────────────────────────────────────

  private buildRecord(): ContextDebugTurnComplete {
    const t = this.trace;
    const d = this.decision;
    this.completedAt = this.completedAt ?? this.now();

    const queries: ContextDebugRetrievalQuery[] = (t?.retrievalAttempts ?? []).map((a, i) => ({
      queryId: `query_${i + 1}`,
      ...(this.level === 'verbose' ? { query: a.queries[0] } : {}),
      targetRoles: [...(t?.plannedSourceTypes ?? [])] as string[],
      searchType: (a.strategy as ContextDebugRetrievalQuery['searchType']) ?? 'hybrid',
      candidateCount: a.candidateCount,
      admittedCount: a.admittedAfterScopeFilter,
      rejectedCount: a.rejectedByScopeFilter,
      durationMs: a.durationMs,
      ...(a.failed ? { failed: a.failed } : {}),
    }));

    // Rejections the trace already carries (scope/version/authority gate at the
    // adapter) — merged with any port-level rejections recorded explicitly.
    const traceRejections: ContextDebugRejectedEvidence[] = (t?.retrievalAttempts ?? [])
      .flatMap((a) => a.rejections ?? [])
      .map((r) => ({
        sourceId: r.sourceId,
        sourceRole: 'unknown',
        rejectionStage: r.reason === 'UNAUTHORIZED_SOURCE' ? 'authorization'
          : r.reason === 'OUT_OF_SCOPE' || r.reason === 'UNKNOWN_SOURCE_SCOPE' ? 'scope_version_gate'
            : r.reason === 'SUPERSEDED_VERSION' || r.reason === 'NO_ACTIVE_VERSION' || r.reason === 'UNKNOWN_CHUNK_VERSION' ? 'scope_version_gate'
              : r.reason === 'UNKNOWN_SOURCE_TYPE' ? 'source_role_gate'
                : r.reason === 'PLANNED_TYPE_FILTER' ? 'source_role_gate'
                  : r.reason === 'CLAIM_AUTHORITY' ? 'claim_authority_gate'
                    : r.reason === 'SCORE_CAP' ? 'rerank'
                      : r.reason === 'DEDUPLICATION' ? 'deduplication'
                        : 'retrieval',
        rejectionReason: r.reason,
      }));

    // Precedence: observed from the status metadata the ports stamped. A source
    // whose status is retired-class and contributed no selected evidence is an
    // ignored source; selected evidence carries its own status.
    const selectedBySource = new Map<string, ContextDebugEvidence[]>();
    for (const e of this.evidenceSnapshot.evidence) {
      const list = selectedBySource.get(e.sourceId) ?? [];
      list.push(e);
      selectedBySource.set(e.sourceId, list);
    }
    const statusOf = new Map(this.authorizedSources.map((s) => [s.id, s]));
    const anyStatus = this.authorizedSources.some((s) => s.status);
    let precedence: ContextDebugTurnComplete['precedence'];
    if (anyStatus) {
      const selected: ContextDebugPrecedenceSource[] = [];
      const ignored: ContextDebugPrecedenceSource[] = [];
      for (const s of this.authorizedSources) {
        const used = selectedBySource.has(s.id);
        const retired = s.status ? RETIRED_STATUSES.has(s.status) : false;
        if (used) {
          selected.push({
            sourceId: s.id, sourceName: s.name, status: s.status, version: s.version,
            reason: retired ? 'RETIRED_SOURCE_STILL_SELECTED' : 'ACTIVE_SOURCE',
          });
        } else if (retired) {
          ignored.push({
            sourceId: s.id, sourceName: s.name, status: s.status, version: s.version,
            reason: 'SUPERSEDED_SOURCE',
          });
        }
      }
      if (selected.length || ignored.length) precedence = { selectedSources: selected, ignoredSources: ignored };
    }

    const tfftMs = this.generationStartedAtMs !== null && this.firstTokenAtMs !== null
      ? this.firstTokenAtMs - this.generationStartedAtMs : undefined;
    const totalStreamMs = this.generationStartedAtMs !== null && this.generationEndedAtMs !== null
      ? this.generationEndedAtMs - this.generationStartedAtMs : undefined;

    const record: ContextDebugTurnComplete = {
      schemaVersion: CONTEXT_DEBUG_SCHEMA_VERSION,
      event: 'context_turn_complete',
      level: this.level,
      identity: this.identity,
      timestamp: {
        startedAt: this.startedAt.toISOString(),
        completedAt: this.completedAt.toISOString(),
        durationMs: this.completedAt.getTime() - this.startedAt.getTime(),
      },
      mode: {
        canonicalId: this.identity.modeId,
        uniqueId: this.identity.modeUniqueId,
        name: this.modeName,
        type: this.modeType,
        knowledgePolicy: (t?.groundingPolicy ?? d?.groundingPolicy ?? 'OPEN_KNOWLEDGE') as ContextDebugTurnComplete['mode']['knowledgePolicy'],
        policyVersion: this.policyVersion,
        ...(this.extraAllowedSourceTypes.length ? { extraAllowedSourceTypes: this.extraAllowedSourceTypes } : {}),
      },
      question: {
        original: t?.originalQuestion ?? d?.rawQuestion ?? '',
        resolved: t?.resolvedQuestion ?? d?.resolvedQuestion ?? '',
        intent: [...(t?.questionTypes ?? d?.questionTypes ?? [])] as string[],
        claimTypes: (d?.claimRequirements ?? []).map((c) => String(c.claimType)),
        documentSpecific: this.documentSpecific,
        followUpDetected: Boolean(d?.isFollowUp),
      },
      ...(this.conversationState ? { conversationState: this.conversationState } : {}),
      availableSources: this.availableSources,
      sourcePlan: {
        path: (t?.retrievalPath ?? d?.retrievalPlan.path ?? 'GROUNDED') as ContextDebugTurnComplete['sourcePlan']['path'],
        shouldRetrieve: Boolean(d?.retrievalPlan.shouldRetrieve),
        plannedRoles: [...(t?.plannedSourceTypes ?? d?.retrievalPlan.sourceTypes ?? [])] as string[],
        authorizedSources: this.authorizedSources,
      },
      retrieval: {
        queries,
        candidateCount: (t?.retrievalAttempts ?? []).reduce((n, a) => n + a.candidateCount, 0),
        admittedCount: (t?.retrievalAttempts ?? []).reduce((n, a) => n + a.admittedAfterScopeFilter, 0),
        rejectedCount: (t?.retrievalAttempts ?? []).reduce((n, a) => n + a.rejectedByScopeFilter, 0),
        selectedEvidence: this.evidenceSnapshot.evidence.map((e) =>
          this.level === 'verbose' ? e : { ...e, preview: undefined, previewRedacted: undefined }),
        ...(this.level === 'verbose'
          ? { rejectedEvidence: [...traceRejections, ...this.evidenceSnapshot.rejected] }
          : {}),
      },
      evidenceCoverage: {
        propertyMatched: this.propertyMatched,
        directEvidenceFound: (t?.claimPlan ?? []).some((c) => c.support === 'DIRECT_EVIDENCE'),
        documentSpecific: this.documentSpecific,
        answerability: (t?.answerability ?? 'NONE') as ContextDebugTurnComplete['evidenceCoverage']['answerability'],
        ...(this.level === 'verbose' && t?.claimPlan
          ? { claimSupport: t.claimPlan.map((c) => ({ claimType: c.claimType, support: c.support, evidenceIds: c.evidenceIds })) }
          : {}),
      },
      ...(precedence ? { precedence } : {}),
      generation: {
        provider: this.provider,
        serverModel: this.serverModel,
        fallback: t?.fallbackUsed ?? 'NONE',
        fallbackUsed: (t?.fallbackUsed ?? 'NONE') !== 'NONE',
        ...(tfftMs !== undefined ? { tfftMs } : {}),
        ...(totalStreamMs !== undefined ? { totalStreamMs } : {}),
        outputCharacters: this.outputCharacters,
        streamCommitted: this.streamCommitted,
        commitRejectedReason: this.commitRejectedReason,
        ...(t?.promptTokenEstimate ? { promptTokenEstimate: t.promptTokenEstimate } : {}),
      },
      answer: { final: this.finalAnswer },
      errors: this.errors,
    };
    return record;
  }

  /**
   * Emit the consolidated record. Idempotent; tolerates missing stages; never
   * throws. Redaction is applied to the WHOLE record as the last line of
   * defence (secrets always; PII unless unsafe content mode).
   */
  complete(): void {
    if (this.finalized) return;
    this.finalized = true;
    try {
      const record = deepRedactStrings(this.buildRecord(), this.includeContent);
      this.print(renderTurnSummary(record));
      if (this.level === 'verbose') {
        try { this.print(JSON.stringify(record, null, 2)); } catch { /* sink only */ }
      }
      this.write(record);
    } catch (e) {
      try { console.warn('[CONTEXT_DEBUG] collector finalization failed:', (e as Error)?.message); } catch { /* noop */ }
    } finally {
      unregisterCollector(this.identity.requestId);
    }
  }
}

// ── registry (keyed, never a single mutable "current") ──────────────────────
//
// Anchored on globalThis, same rule as conversation-state-store and
// SettingsManager: esbuild inlines this module per entry bundle, and harness
// runs co-load bundles — a collector begun by the bridge's copy must be
// findable by the transport's copy.

const REGISTRY_KEY = '__nativelyContextDebugCollectorsV1__';
function collectorsMap(): Map<string, ContextDebugTurnCollector> {
  const g = globalThis as unknown as Record<string, unknown>;
  let m = g[REGISTRY_KEY] as Map<string, ContextDebugTurnCollector> | undefined;
  if (!m) { m = new Map(); g[REGISTRY_KEY] = m; }
  return m;
}
const MAX_LIVE_COLLECTORS = 32;   // leak bound: an abandoned turn cannot accumulate forever

export function beginTurnCollector(
  identity: ContextDebugIdentity,
  opts: CollectorOptions,
): ContextDebugTurnCollector {
  const collectors = collectorsMap();
  if (collectors.size >= MAX_LIVE_COLLECTORS) {
    // Drop the OLDEST abandoned collector (insertion order) — finalize it so
    // its partial record is not lost silently.
    const oldest = collectors.keys().next().value;
    if (oldest !== undefined) {
      const c = collectors.get(oldest);
      collectors.delete(oldest);
      try { c?.recordError({ stage: 'logging', message: 'collector evicted (turn never completed)', recoverable: true }); c?.complete(); } catch { /* noop */ }
    }
  }
  const collector = new ContextDebugTurnCollector(identity, opts);
  collectors.set(identity.requestId, collector);
  return collector;
}

export function getTurnCollector(requestId: string): ContextDebugTurnCollector | undefined {
  return collectorsMap().get(requestId);
}

export function unregisterCollector(requestId: string): void {
  collectorsMap().delete(requestId);
}
