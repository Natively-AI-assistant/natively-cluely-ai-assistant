// electron/intelligence/SearchOrchestrator.ts
//
// Spec Phase 11 (globalSearch) + Phase 12 (inMeetingSearch).
//
// HONEST STATUS: the repo has rag:query-global / rag:query-live (RAG AI answers) but
// NO fusion-ranked search ORCHESTRATOR, and the renderer "literal search"
// (Launcher.tsx) is fake (re-runs the AI query). This module is the missing
// orchestrator: it MERGES candidate results from multiple sources (local FTS/lexical,
// vector, meeting-memory, optional long-term memory), applies the spec's exact fusion
// ranking, enforces user/org ISOLATION locally BEFORE any external memory call, and
// dedupes + reranks.
//
// It is a PURE ranking/fusion/isolation engine: each backend (SQLite FTS, VectorStore,
// Hindsight) is injected as already-fetched candidates, so the engine is deterministic
// and unit-testable, and the real async backends wire in at Phase 16/19 without
// changing this logic. Never throws.

export type SearchSourceType = 'lexical' | 'vector' | 'memory' | 'metadata';

export interface SearchCandidate {
  meetingId: string;
  title?: string;
  date?: number;
  mode?: string;
  /** The matched snippet to show the user. */
  snippet: string;
  /** Which source produced it. */
  source: SearchSourceType;
  /** Source-native score in 0..1 (already normalized by the caller/adapter). */
  score: number;
  /** Owner scoping — REQUIRED for isolation. */
  userId: string;
  orgId?: string;
  /** Optional transcript timestamp for a transcript match. */
  timestampMs?: number;
  /** Free-form metadata for filters + metadata-match scoring. */
  metadata?: Record<string, string>;
}

export interface GlobalSearchFilters {
  dateFrom?: number;
  dateTo?: number;
  mode?: string;
  company?: string;
  participant?: string;
  sourceType?: SearchSourceType;
  meetingTitle?: string;
  tag?: string;
  hasActionItems?: boolean;
  hasInterviewQuestions?: boolean;
  course?: string;
  lectureTopic?: string;
}

export interface SearchScope {
  userId: string;
  orgId?: string;
}

export interface GlobalSearchResult {
  meetingId: string;
  title: string;
  date?: number;
  mode?: string;
  matchedSnippet: string;
  whyMatched: string;
  sourceTypes: SearchSourceType[];
  confidence: number;
  timestampMs?: number;
}

// Spec fusion weights — must sum to 1.0.
const WEIGHTS = { lexical: 0.30, vector: 0.30, memory: 0.20, recency: 0.10, metadata: 0.10 } as const;

const now1e13 = 1e13; // a fixed "recent" anchor (no Date.now in pure logic)

function recencyScore(date: number | undefined, anchor: number): number {
  if (!date) return 0;
  const ageMs = Math.max(0, anchor - date);
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // 1.0 today → ~0 after ~180 days (exponential-ish, bounded).
  return Math.max(0, Math.min(1, 1 - ageDays / 180));
}

function metadataMatchScore(c: SearchCandidate, filters: GlobalSearchFilters): number {
  let hits = 0, checks = 0;
  const md = c.metadata || {};
  if (filters.company) { checks++; if ((md.company || '').toLowerCase().includes(filters.company.toLowerCase())) hits++; }
  if (filters.participant) { checks++; if ((md.participant || '').toLowerCase().includes(filters.participant.toLowerCase())) hits++; }
  if (filters.course) { checks++; if ((md.course || '').toLowerCase() === filters.course.toLowerCase()) hits++; }
  if (filters.lectureTopic) { checks++; if ((md.lectureTopic || '').toLowerCase().includes(filters.lectureTopic.toLowerCase())) hits++; }
  if (filters.tag) { checks++; if ((md.tags || '').toLowerCase().includes(filters.tag.toLowerCase())) hits++; }
  if (checks === 0) return c.metadata ? 0.5 : 0; // neutral when no metadata filter set
  return hits / checks;
}

function passesFilters(c: SearchCandidate, f: GlobalSearchFilters): boolean {
  if (f.dateFrom && (c.date ?? 0) < f.dateFrom) return false;
  if (f.dateTo && (c.date ?? Infinity) > f.dateTo) return false;
  if (f.mode && c.mode !== f.mode) return false;
  if (f.sourceType && c.source !== f.sourceType) return false;
  if (f.meetingTitle && !(c.title || '').toLowerCase().includes(f.meetingTitle.toLowerCase())) return false;
  const md = c.metadata || {};
  if (f.company && !(md.company || '').toLowerCase().includes(f.company.toLowerCase())) return false;
  if (f.participant && !(md.participant || '').toLowerCase().includes(f.participant.toLowerCase())) return false;
  if (f.course && (md.course || '').toLowerCase() !== f.course.toLowerCase()) return false;
  if (f.hasActionItems && md.hasActionItems !== 'true') return false;
  if (f.hasInterviewQuestions && md.hasInterviewQuestions !== 'true') return false;
  return true;
}

export class SearchOrchestrator {
  /**
   * Global meeting search (Phase 11). Candidates are ALREADY-FETCHED results from each
   * source. The orchestrator: (1) enforces user/org isolation LOCALLY, (2) applies
   * filters, (3) fuses per-meeting across sources with the spec weights, (4) dedupes
   * by meetingId, (5) reranks by confidence. Pure + never throws.
   *
   * ISOLATION INVARIANT: any candidate whose userId !== scope.userId (or orgId
   * mismatch) is dropped BEFORE ranking — a foreign or external-memory result can
   * never surface, mirroring the spec's "Hindsight must never bypass local user/org
   * filtering" rule.
   */
  globalSearch(
    candidates: SearchCandidate[],
    scope: SearchScope,
    filters: GlobalSearchFilters = {},
    recencyAnchorMs: number = now1e13,
  ): GlobalSearchResult[] {
    try {
      const scoped = (candidates || []).filter((c) =>
        c && c.userId === scope.userId &&
        (scope.orgId === undefined || (c.orgId ?? undefined) === scope.orgId) &&
        passesFilters(c, filters),
      );

      // Fuse per meeting: take the best score per source type, then weighted sum.
      const byMeeting = new Map<string, SearchCandidate[]>();
      for (const c of scoped) {
        const arr = byMeeting.get(c.meetingId) || [];
        arr.push(c);
        byMeeting.set(c.meetingId, arr);
      }

      // Phase 2 (smart-retrieval): when ragRrfFusion is on, fuse the per-source
      // RANKED lists by Reciprocal Rank Fusion instead of weighted-summing
      // incomparable native scores. This is exactly the scale-mismatch this
      // path has today — local lexical scores live on a different scale than
      // Hindsight's flat 0.85 memory score, so a weighted sum systematically
      // over/under-weights memory hits. RRF ranks by POSITION (scale-agnostic)
      // and lets a meeting corroborated by multiple sources rise. Default OFF →
      // the exact weighted-sum path below is unchanged. Pure, never throws.
      let rrfByMeeting: Map<string, number> | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { isRagRrfFusionEnabled } = require('./intelligenceFlags');
        if (isRagRrfFusionEnabled()) {
          rrfByMeeting = this.rrfFuseMeetingRanks(scoped, filters, recencyAnchorMs);
        }
      } catch { /* flag/module unavailable → weighted-sum path */ }

      const results: GlobalSearchResult[] = [];
      for (const [meetingId, group] of byMeeting) {
        const best = (type: SearchSourceType) =>
          group.filter((g) => g.source === type).reduce((m, g) => Math.max(m, g.score), 0);
        const lexical = best('lexical');
        const vector = best('vector');
        const memory = best('memory');
        const rep = group.slice().sort((a, b) => b.score - a.score)[0];
        const recency = recencyScore(rep.date, recencyAnchorMs);
        const metaScore = metadataMatchScore(rep, filters);

        // When RRF is active the fused score IS the confidence — recency and
        // metadata are folded into the fusion AS RANKED SOURCES (see
        // rrfFuseMeetingRanks), not added out-of-band, so no scale-mixing
        // re-buries the rank signal. When off, the original spec weighted-sum
        // is used unchanged.
        const confidence = rrfByMeeting
          ? (rrfByMeeting.get(meetingId) ?? 0)
          : WEIGHTS.lexical * lexical +
            WEIGHTS.vector * vector +
            WEIGHTS.memory * memory +
            WEIGHTS.recency * recency +
            WEIGHTS.metadata * metaScore;

        const sourceTypes = [...new Set(group.map((g) => g.source))];
        const whyParts: string[] = [];
        if (lexical > 0) whyParts.push('exact text match');
        if (vector > 0) whyParts.push('semantic match');
        if (memory > 0) whyParts.push('long-term memory');
        if (recency > 0.5) whyParts.push('recent');
        if (metaScore > 0.5 && (filters.company || filters.participant || filters.course)) whyParts.push('metadata match');

        results.push({
          meetingId,
          title: rep.title || 'Untitled meeting',
          date: rep.date,
          mode: rep.mode,
          matchedSnippet: rep.snippet,
          whyMatched: whyParts.join(', ') || 'relevant',
          sourceTypes,
          // RRF scores live on a ~1/(k+rank) scale (≈0.016 at rank 0), so 3
          // decimals would collapse adjacent ranks — round finer when fused.
          confidence: rrfByMeeting
            ? Math.round(confidence * 1e6) / 1e6
            : Math.round(confidence * 1000) / 1000,
          timestampMs: rep.timestampMs,
        });
      }

      return results.sort((a, b) => b.confidence - a.confidence);
    } catch {
      return [];
    }
  }

  /**
   * Phase 2 (smart-retrieval): build per-source RANKED meeting lists and fuse
   * them by Reciprocal Rank Fusion, returning meetingId → fused RRF score.
   *
   * For each source type (lexical/vector/memory), meetings are ranked by their
   * BEST candidate score from that source (descending), so only the rank
   * position feeds RRF — the incomparable native scores never mix. A meeting
   * that ranks well in several sources accumulates contributions and rises.
   * Pure; returns an empty map on any error (caller then keeps weighted-sum).
   */
  private rrfFuseMeetingRanks(
    scoped: SearchCandidate[],
    filters: GlobalSearchFilters,
    recencyAnchorMs: number,
  ): Map<string, number> {
    const out = new Map<string, number>();
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { fuseRanked } = require('./RrfFusion');

      // Best score per meeting per source, plus a representative candidate per
      // meeting (highest-scoring) for the recency/metadata ranked lists.
      const repByMeeting = new Map<string, SearchCandidate>();
      for (const c of scoped) {
        const cur = repByMeeting.get(c.meetingId);
        if (!cur || c.score > cur.score) repByMeeting.set(c.meetingId, c);
      }

      const sources: Array<{ source: string; weight: number; items: Array<{ id: string; text: string }> }> = [];
      const addRankedSource = (
        source: string,
        scoreByMeeting: Map<string, number>,
        weight: number,
      ) => {
        const ranked = [...scoreByMeeting.entries()]
          .filter(([, s]) => s > 0)          // a 0 score = not a real hit for that signal
          .sort((a, b) => b[1] - a[1]);      // rank by the signal's native value
        if (ranked.length === 0) return;
        sources.push({ source, weight, items: ranked.map(([id]) => ({ id, text: id })) });
      };

      // Retrieval sources keep the spec's relative emphasis as RRF weights
      // (lexical/vector dominant, memory secondary) — but applied to RANK, not
      // to incomparable native scores, so a #1 memory hit is never buried.
      for (const [type, weight] of [
        ['lexical', WEIGHTS.lexical],
        ['vector', WEIGHTS.vector],
        ['memory', WEIGHTS.memory],
      ] as Array<[SearchSourceType, number]>) {
        const bestByMeeting = new Map<string, number>();
        for (const c of scoped) {
          if (c.source !== type) continue;
          bestByMeeting.set(c.meetingId, Math.max(bestByMeeting.get(c.meetingId) ?? 0, c.score));
        }
        addRankedSource(type, bestByMeeting, weight);
      }

      // Recency + metadata fold in as their OWN ranked sources (weighted like
      // the spec) — so the existing filters still bias ordering, but on the same
      // rank scale as everything else (no out-of-band additive that swamps RRF).
      const recencyByMeeting = new Map<string, number>();
      const metaByMeeting = new Map<string, number>();
      for (const [meetingId, rep] of repByMeeting) {
        recencyByMeeting.set(meetingId, recencyScore(rep.date, recencyAnchorMs));
        metaByMeeting.set(meetingId, metadataMatchScore(rep, filters));
      }
      addRankedSource('recency', recencyByMeeting, WEIGHTS.recency);
      addRankedSource('metadata', metaByMeeting, WEIGHTS.metadata);

      const { fused } = fuseRanked(sources);
      for (const f of fused) out.set(f.id, f.rrfScore);
    } catch {
      return out;
    }
    return out;
  }

  /**
   * In-meeting search (Phase 12) — local-first lexical/fuzzy over the CURRENT meeting's
   * finalized chunks. NO external memory. Returns timestamped, highlighted matches,
   * ranked by lexical relevance. Pure + never throws.
   */
  inMeetingSearch(
    chunks: Array<{ text: string; timestampMs?: number; speaker?: string }>,
    query: string,
  ): Array<{ snippet: string; timestampMs?: number; speaker?: string; score: number }> {
    try {
      const q = (query || '').toLowerCase().trim();
      if (!q) return [];
      const terms = q.split(/\s+/).filter((t) => t.length > 1);
      if (terms.length === 0) return [];
      const out: Array<{ snippet: string; timestampMs?: number; speaker?: string; score: number }> = [];
      for (const chunk of chunks || []) {
        const text = chunk?.text || '';
        const lower = text.toLowerCase();
        let hits = 0;
        for (const t of terms) if (lower.includes(t)) hits++;
        if (hits === 0) continue;
        // Score = term coverage (capped at 0.7) + a contiguous-phrase bonus (0.3).
        // Capping coverage below 1.0 keeps the phrase bonus VISIBLE even when every
        // term already matches — otherwise a full-coverage scattered match and a true
        // phrase match both clamp to 1.0 and phrase priority is lost to the timestamp
        // tiebreaker (test-engineer Phase 10). An exact contiguous phrase → 1.0.
        const coverage = (hits / terms.length) * 0.7;
        const phraseBonus = lower.includes(q) ? 0.3 : 0;
        const score = Math.min(1, coverage + phraseBonus);
        out.push({ snippet: text, timestampMs: chunk.timestampMs, speaker: chunk.speaker, score: Math.round(score * 1000) / 1000 });
      }
      return out.sort((a, b) => b.score - a.score || (a.timestampMs ?? 0) - (b.timestampMs ?? 0));
    } catch {
      return [];
    }
  }
}

export const SEARCH_FUSION_WEIGHTS = WEIGHTS;
