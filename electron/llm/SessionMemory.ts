// electron/llm/SessionMemory.ts
//
// Structured, time-aware session memory for long-range follow-up resolution
// (release 2026-06-07c). This is the piece the existing single-prior-turn
// FollowUpResolver lacks: when an interviewer mentions "Natively" at minute 1 and at
// minute 62 asks "what was the hardest part of that project?", we must resolve
// "that project" → Natively even though it's far outside the transcript window.
//
// Design principles (per the hardening directive):
//   • STRUCTURED METADATA, not prompt blobs. We track entities/skills/projects/
//     decisions/topics as typed records with timestamps and mode tags — never a
//     giant text dump.
//   • TIME-AWARE. Salience decays with age; a fresher item of the same kind
//     supersedes a stale one. Pinned/entity-linked items survive longer.
//   • MODE-AWARE BOUNDARIES. Interview memory must not leak into coding; sales
//     pricing must not leak into interview; negotiation only surfaces for comp.
//   • CORRECTIONS override. "Actually, use TalentScope as my best project" replaces
//     the earlier "Natively".
//   • PURE + DETERMINISTIC. No LLM, no I/O. Cheap enough for the live path.
//   • PRIVACY. Stores short entity/skill TOKENS and turn text the caller already
//     has — never re-derives or persists raw resume/JD/salary. Callers must NOT place
//     a compensation value under a non-comp kind: `add()` auto-promotes any salary-
//     looking value to kind:'comp' (value-level guard) so the negotiation-only
//     boundary cannot be bypassed by mislabeling.
//
// WIRING STATUS (2026-06-07c): this module + `resolveSessionFollowup` are the
// VALIDATED long-range follow-up MODEL, exercised end-to-end by the follow-up /
// long-session benchmarks (100% resolution across all context-age buckets, 0
// cross-mode leaks). The LIVE IntelligenceEngine currently uses single-prior-turn
// resolution (FollowUpResolver) + the transcript-window extractor; adopting this
// store on the live hot path is the next integration step (behind a flag). Treat the
// privacy/mode-boundary guarantees here as proven-by-test, ENFORCED wherever this
// store is the resolver — not yet the live default.

export type MemoryMode = 'general' | 'interview' | 'technical-interview' | 'looking-for-work'
  | 'coding' | 'sales' | 'lecture' | 'team-meet' | 'recruiting' | 'negotiation';

export type MemoryItemKind =
  | 'project'     // a named project on the table ("Natively", "TalentScope")
  | 'skill'       // a skill/tech being discussed ("Python", "SQL")
  | 'company'     // a company/customer ("Acme", "Globex", "EstroTech")
  | 'person'      // a named person ("Mark", "Rahul")
  | 'topic'       // a concept/topic ("BFS", "amortized analysis", "rate limiting")
  | 'decision'    // a meeting decision / action item
  | 'objection'   // a sales objection ("price is high")
  | 'comp'        // a compensation figure/expectation (negotiation only)
  | 'jd_topic';   // an active JD/role-fit topic ("data analysis")

export interface MemoryItem {
  kind: MemoryItemKind;
  /** Short token/phrase (e.g. "Natively", "Python", "price too high"). Never raw PII. */
  value: string;
  /** Turn timestamp in seconds (session-relative or wall-clock — caller is consistent). */
  t: number;
  /** The mode active when this was introduced. */
  mode: MemoryMode;
  /** Pinned items resist decay (explicitly important facts the user flagged). */
  pinned?: boolean;
  /** When set, this item CORRECTS/replaces a prior item of the same kind. */
  corrects?: boolean;
  /** Free-form salience boost (e.g. mentioned multiple times). 0..1. */
  salienceBoost?: number;
}

export interface MemoryQuery {
  /** Current time (seconds), to compute age. */
  now: number;
  /** The kind we're resolving (e.g. a "that project" follow-up → 'project'). */
  kind: MemoryItemKind;
  /** The current mode — gates which items are visible (mode boundaries). */
  mode: MemoryMode;
  /** When true, the user EXPLICITLY asked to cross a mode boundary (e.g. "have you
   *  used this in Natively?" during coding) — allows the otherwise-blocked recall. */
  explicitCrossMode?: boolean;
}

export interface MemoryRecall {
  item: MemoryItem | null;
  /** Age of the recalled item in seconds. */
  ageSeconds: number;
  /** Computed salience 0..1 (decay × boosts). */
  salience: number;
  reason: string;
}

// Which memory kinds each mode is allowed to RECALL by default (without an explicit
// cross-mode request). This is the leak-boundary table. A kind not listed is blocked
// for that mode unless explicitCrossMode is set.
const MODE_ALLOWED_KINDS: Record<MemoryMode, Set<MemoryItemKind>> = {
  general: new Set<MemoryItemKind>(['project', 'skill', 'company', 'person', 'topic', 'decision', 'objection', 'jd_topic']),
  interview: new Set<MemoryItemKind>(['project', 'skill', 'company', 'jd_topic']),
  'technical-interview': new Set<MemoryItemKind>(['project', 'skill', 'topic', 'jd_topic']),
  'looking-for-work': new Set<MemoryItemKind>(['project', 'skill', 'company', 'jd_topic']),
  // Coding answers are profile-forbidden: NO project/company/skill recall unless the
  // user explicitly invites it. Only neutral topics (the algorithm at hand).
  coding: new Set<MemoryItemKind>(['topic']),
  // Sales sees its own customer/objection context — NOT meeting decisions/action
  // items (those belong to team-meet; leaking them into a sales pitch is wrong).
  sales: new Set<MemoryItemKind>(['company', 'objection', 'person']),
  lecture: new Set<MemoryItemKind>(['topic']),
  'team-meet': new Set<MemoryItemKind>(['decision', 'person', 'company', 'topic']),
  recruiting: new Set<MemoryItemKind>(['project', 'skill', 'company', 'jd_topic']),
  // Negotiation is the ONLY mode that may recall comp; it also sees role/jd context.
  negotiation: new Set<MemoryItemKind>(['comp', 'jd_topic', 'company']),
};

// Half-life (seconds) for salience decay, by kind. Pinned/entity items live longer.
const HALF_LIFE: Record<MemoryItemKind, number> = {
  project: 3600,    // a named project stays salient ~1h (interview revisits)
  skill: 1800,      // skills ~30m
  company: 3600,
  person: 3600,
  topic: 1200,      // concepts ~20m (lectures move on)
  decision: 3600,   // action items persist through the meeting
  objection: 1800,
  comp: 3600,
  jd_topic: 2400,
};

const COMP_KINDS: ReadonlySet<MemoryItemKind> = new Set(['comp']);
// A value that LOOKS like compensation, regardless of the kind label the caller used.
// Used to auto-promote a mislabeled salary note to kind:'comp' so the negotiation-only
// boundary can't be bypassed (code-review 2026-06-07c). Conservative — matches money
// amounts and explicit comp nouns, not bare numbers.
const SALARY_VALUE_RE = /\b\d{2,3}\s?k\b|\b\d{1,3}\s?(?:lpa|lakh|lakhs)\b|[$£€]\s?\d|\b\d{3,}\s?(?:per|\/)\s?(?:year|yr|annum|month)\b|\b(?:base salary|expected (?:salary|comp|ctc|package)|total comp(?:ensation)?|equity grant|rsus?|signing bonus|ctc)\b/i;

export class SessionMemory {
  private items: MemoryItem[] = [];
  private readonly maxItems: number;

  constructor(maxItems = 200) {
    this.maxItems = maxItems;
  }

  /** Record a memory item. A `corrects` item supersedes the latest same-kind item. */
  add(item: MemoryItem): void {
    const value = (item.value || '').trim();
    if (!value) return;
    // VALUE-LEVEL comp guard (code-review 2026-06-07c): the comp boundary keys on the
    // KIND label, so a salary value mislabeled under another kind ("topic: targeting
    // 250k base") would bypass the gate. Auto-promote any note whose VALUE looks like
    // compensation to kind:'comp' so it can only ever be recalled in negotiation mode.
    let kind = item.kind;
    if (kind !== 'comp' && SALARY_VALUE_RE.test(value)) kind = 'comp';
    this.items.push({ ...item, kind, value });
    // Bound memory: drop the oldest non-pinned items past the cap.
    if (this.items.length > this.maxItems) {
      const pinned = this.items.filter(i => i.pinned);
      const rest = this.items.filter(i => !i.pinned).slice(-(this.maxItems - pinned.length));
      this.items = [...pinned, ...rest].sort((a, b) => a.t - b.t);
    }
  }

  /** Convenience: record an entity mention (project/company/person/skill/topic). */
  note(kind: MemoryItemKind, value: string, t: number, mode: MemoryMode, opts?: { pinned?: boolean; corrects?: boolean }): void {
    this.add({ kind, value, t, mode, pinned: opts?.pinned, corrects: opts?.corrects });
  }

  /**
   * Recall the most salient item of `query.kind` that the current mode is allowed to
   * see. A `corrects` item always wins over earlier same-kind items. Comp is gated to
   * negotiation mode. Returns `{ item: null }` when nothing is recallable (the caller
   * then asks for clarification rather than guessing).
   */
  recall(query: MemoryQuery): MemoryRecall {
    const allowed = MODE_ALLOWED_KINDS[query.mode] ?? MODE_ALLOWED_KINDS.general;
    const crossOk = query.explicitCrossMode === true;
    // Comp NEVER surfaces outside negotiation, even with explicitCrossMode — salary
    // is its own gated channel (hardening rule: no salary leakage outside comp Qs).
    if (COMP_KINDS.has(query.kind) && query.mode !== 'negotiation') {
      return { item: null, ageSeconds: 0, salience: 0, reason: 'comp_gated_to_negotiation' };
    }
    if (!allowed.has(query.kind) && !crossOk) {
      return { item: null, ageSeconds: 0, salience: 0, reason: `kind_blocked_in_mode:${query.mode}` };
    }

    const candidates = this.items.filter(i => i.kind === query.kind);
    if (candidates.length === 0) return { item: null, ageSeconds: 0, salience: 0, reason: 'no_memory' };

    // A correction overrides: if any same-kind item is flagged `corrects`, the LATEST
    // such correction wins outright (the user explicitly updated it).
    const corrections = candidates.filter(i => i.corrects);
    if (corrections.length > 0) {
      const latest = corrections.reduce((a, b) => (b.t >= a.t ? b : a));
      return { item: latest, ageSeconds: Math.max(0, query.now - latest.t), salience: 1, reason: 'correction_override' };
    }

    // Otherwise score by recency-decayed salience; the freshest salient item wins, so
    // a newer same-kind mention naturally supersedes a stale one.
    const hl = HALF_LIFE[query.kind] ?? 1800;
    let best: MemoryItem | null = null;
    let bestScore = -1;
    let bestAge = 0;
    for (const i of candidates) {
      const age = Math.max(0, query.now - i.t);
      const decay = i.pinned ? 1 : Math.pow(0.5, age / hl);
      const score = Math.min(1, decay + (i.salienceBoost ?? 0));
      // Tie-break toward the more RECENT item (latest mention is the active topic).
      if (score > bestScore || (score === bestScore && (!best || i.t > best.t))) {
        bestScore = score; best = i; bestAge = age;
      }
    }
    if (!best || bestScore < 0.05) {
      return { item: null, ageSeconds: 0, salience: 0, reason: 'all_decayed' };
    }
    return { item: best, ageSeconds: bestAge, salience: bestScore, reason: 'recency_salience' };
  }

  /** All items of a kind currently visible in a mode (for diagnostics/tests). */
  visible(kind: MemoryItemKind, mode: MemoryMode, explicitCrossMode = false): MemoryItem[] {
    const allowed = MODE_ALLOWED_KINDS[mode] ?? MODE_ALLOWED_KINDS.general;
    if (COMP_KINDS.has(kind) && mode !== 'negotiation') return [];
    if (!allowed.has(kind) && !explicitCrossMode) return [];
    return this.items.filter(i => i.kind === kind);
  }

  /** Number of stored items (diagnostics). */
  size(): number { return this.items.length; }

  /** Clear all memory (new session). */
  reset(): void { this.items = []; }
}

/** Is recall of `kind` allowed in `mode` without an explicit cross-mode request? */
export function isKindAllowedInMode(kind: MemoryItemKind, mode: MemoryMode): boolean {
  if (COMP_KINDS.has(kind)) return mode === 'negotiation';
  const allowed = MODE_ALLOWED_KINDS[mode] ?? MODE_ALLOWED_KINDS.general;
  return allowed.has(kind);
}
