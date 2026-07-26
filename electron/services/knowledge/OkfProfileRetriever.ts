// electron/services/knowledge/OkfProfileRetriever.ts
//
// OKF Profile Intelligence — Phase 2 (2026-07-02). Retrieves profile OKF cards
// for a question and formats them into a prompt evidence block. This is the
// ONLY place profile cards enter an answer, and it is FAIL-CLOSED by
// construction: it returns evidence ONLY when the caller hands it an explicit,
// affirmative allow derived from an AnswerPlan. Absent a plan/route (the
// phone-chat IPC handler, LLMHelper.chat()), it returns NOTHING — it does NOT
// inherit the legacy fail-open behavior of profileInterceptAllowedByRoute, and
// this module never even consults that function.
//
// The gate order (all must pass, else the coarse blockedReason is returned):
//   1. hasExplicitPlan       — a real AnswerPlan/route exists (else 'no_route')
//   2. okfProfileHybridRetrieval flag on          (else 'flag_off')
//   3. profileContextPolicy is 'required'|'allowed' (else 'policy_forbidden')
//   4. NOT a document-grounded custom mode        (else 'doc_grounded')
//      — profile cards are PROFILE context and are forbidden in doc-grounded
//        modes exactly like every other profile layer, under ANY flag combo.
//
// It layers ON TOP of (never replaces) the deterministic fast path and the
// context_nodes vector retrieval — both run first/independently. The output
// answer still passes through validateProfileOutput / profileEvidenceValidator
// unchanged.

import { isOkfProfileHybridRetrievalEnabled } from '../../intelligence/intelligenceFlags';
import { piTelemetry } from '../../llm/piTelemetry';
import { classifyQuestion } from './QuestionClassifier';
import { queryOkfCards, type ScoredCard } from './OkfRetriever';
import { ProfilePackBuilder } from './ProfilePackBuilder';
import type { KnowledgeCard } from './types';

export type ProfileRetrievalBlockedReason =
  | 'no_route'
  | 'flag_off'
  | 'policy_forbidden'
  | 'doc_grounded'
  | 'no_pack'
  | 'no_match';

export interface ProfileRetrievalInput {
  question: string;
  /** From AnswerPlan.profileContextPolicy. Only 'required'|'allowed' may retrieve. */
  profileContextPolicy: 'required' | 'allowed' | 'forbidden';
  /** AnswerPlan.documentGroundedCustomModeActive === true → always blocked. */
  documentGroundedActive: boolean;
  /**
   * The single fail-closed switch: TRUE only when the caller genuinely produced
   * an AnswerPlan for this turn (the desktop manual chat path). The phone-chat
   * handler and LLMHelper.chat() pass false (or never call this), so they get
   * NOTHING. Do not default this to true anywhere.
   */
  hasExplicitPlan: boolean;
  /** Max cards to surface across resume + JD packs. */
  topN?: number;
}

export interface ProfileRetrievalResult {
  /** Formatted prompt block (empty string when blocked or no cards). */
  block: string;
  cards: ScoredCard[];
  cardCount: number;
  allowed: boolean;
  blockedReason?: ProfileRetrievalBlockedReason;
}

const EMPTY = (blockedReason?: ProfileRetrievalBlockedReason): ProfileRetrievalResult => ({
  block: '', cards: [], cardCount: 0, allowed: false, blockedReason,
});

// Intent → card-type boost. The shared lexical scorer (queryOkfCards) matches on
// word overlap, so a question whose intent word is NOT in the target card's body
// ranks the right card too low — e.g. "Where did you study?" / "go to college?"
// shares no tokens with "B.S. in Computer Science, University of Texas at Austin",
// so the education card fell out of the top-6 (observed in the live MiniMax run,
// 2026-07-02). These regex→type boosts are the profile analogue of
// HybridSearchEngine's category hints: when a question clearly targets a profile
// dimension, boost that dimension's card type so it surfaces regardless of lexical
// overlap. Additive and small — never overrides a strong lexical match, only
// rescues an intent the bag-of-words scorer can't see.
const INTENT_TYPE_BOOSTS: Array<{ re: RegExp; types: Partial<Record<KnowledgeCard['type'], number>> }> = [
  { re: /\b(study|studied|studies|educat|college|university|degree|graduat|major|school|alma mater|gpa)\b/i,
    types: { candidate_education: 0.6 } },
  { re: /\b(salary|compensation|pay|negotiat|offer|worth|ask for|comp\b)\b/i,
    types: { artifact_negotiation: 0.5 } },
  { re: /\b(gap|missing|don'?t (yet )?meet|lack|weakness|not qualified|shortfall)\b/i,
    types: { artifact_gap_analysis: 0.5 } },
  { re: /\b(intro|introduce|elevator|30.?second|60.?second|pitch|tell me about yourself)\b/i,
    types: { artifact_intro: 0.4, candidate_summary: 0.3, candidate_identity: 0.3 } },
  { re: /\b(achiev|accomplish|proud|award|won|impact|result)\b/i,
    types: { candidate_achievement: 0.4, candidate_experience: 0.2 } },
  { re: /\b(language|programming|coding skill|tech stack|technolog|framework|tool|proficien)\b/i,
    types: { candidate_skills: 0.4 } },
  { re: /\b(project|built|created|side project|portfolio)\b/i,
    types: { candidate_project: 0.4 } },
  { re: /\b(experience|work|role|job|position|employ|career|company|worked)\b/i,
    types: { candidate_experience: 0.3 } },
  { re: /\b(mock|interview question|practice question|prep)\b/i,
    types: { artifact_mock_questions: 0.4 } },
  { re: /\b(culture|values?|fit with the (company|team)|mission)\b/i,
    types: { artifact_culture_mapping: 0.4 } },
];

/** Additive intent→type boost applied on top of the lexical score. Deterministic, small. */
/**
 * Precompute the per-card-type intent boost for a question ONCE (each regex is
 * tested a single time, not once per card). Returns a Map keyed by card type; a
 * type absent from the map has boost 0.
 */
function buildIntentBoostMap(question: string): Map<KnowledgeCard['type'], number> {
  const map = new Map<KnowledgeCard['type'], number>();
  for (const rule of INTENT_TYPE_BOOSTS) {
    if (!rule.re.test(question)) continue;
    for (const [type, val] of Object.entries(rule.types) as Array<[KnowledgeCard['type'], number]>) {
      map.set(type, (map.get(type) || 0) + val);
    }
  }
  return map;
}

// Per-card evidence cap in the prompt block. A defensive backstop over the
// source-level MAX_BODY_CHARS cap in ProfileCardTemplates (a user-edited card
// could exceed it) — kept slightly under the 1200 source cap so a normal card
// is never truncated here, only a pathological one.
const MAX_CARD_EVIDENCE_CHARS = 1000;

function formatCardBlock(cards: ScoredCard[]): string {
  if (cards.length === 0) return '';
  const lines: string[] = [];
  lines.push('## CANDIDATE KNOWLEDGE CARDS (from your uploaded resume/JD)');
  lines.push('These are grounded, source-attributed summaries of the candidate\'s own resume/JD. Use them to answer; never invent employers, dates, or metrics. Raw retrieved profile details (if any) win on conflict. Answer in the perspective the answer contract specifies.');
  cards.forEach(({ card }, i) => {
    lines.push('');
    lines.push(`Card ${i + 1}:`);
    lines.push(`Title: ${card.title}`);
    lines.push(`Type: ${card.type}`);
    const body = card.body.length > MAX_CARD_EVIDENCE_CHARS
      ? `${card.body.slice(0, MAX_CARD_EVIDENCE_CHARS)}…`
      : card.body;
    lines.push(`Evidence: ${body}`);
  });
  return lines.join('\n');
}

/**
 * Retrieve profile OKF card evidence for a question — fail-closed. Returns an
 * empty result (with a coarse blockedReason marker) whenever the gate denies.
 */
export function retrieveProfileEvidence(input: ProfileRetrievalInput): ProfileRetrievalResult {
  // Gate 1 — fail-closed: no explicit plan/route → contribute nothing.
  if (!input.hasExplicitPlan) {
    piTelemetry.emit('pi_okf_profile_retrieval_blocked', { blockedReason: 'no_route' });
    return EMPTY('no_route');
  }
  // Gate 2 — flag.
  if (!isOkfProfileHybridRetrievalEnabled()) {
    piTelemetry.emit('pi_okf_profile_retrieval_blocked', { blockedReason: 'flag_off' });
    return EMPTY('flag_off');
  }
  // Gate 3 — policy.
  if (input.profileContextPolicy === 'forbidden') {
    piTelemetry.emit('pi_okf_profile_retrieval_blocked', { blockedReason: 'policy_forbidden' });
    return EMPTY('policy_forbidden');
  }
  // Gate 4 — document-grounded custom modes never receive profile cards.
  if (input.documentGroundedActive) {
    piTelemetry.emit('pi_okf_profile_retrieval_blocked', { blockedReason: 'doc_grounded' });
    return EMPTY('doc_grounded');
  }

  let packs;
  try {
    packs = ProfilePackBuilder.getInstance().getAllProfilePacks();
  } catch {
    return EMPTY('no_pack');
  }
  if (!packs || packs.length === 0) {
    piTelemetry.emit('pi_okf_profile_retrieval_blocked', { blockedReason: 'no_pack' });
    return EMPTY('no_pack');
  }

  const topN = input.topN ?? 6;
  const classification = classifyQuestion(input.question);
  const intentBoost = buildIntentBoostMap(input.question); // computed ONCE per question
  const byId = new Map<string, ScoredCard>();
  for (const pack of packs) {
    // Reuse the shared lexical retriever per pack. Pull a WIDER candidate set
    // (2×topN, floor 12) so the intent-boost pass below can rescue a card the
    // pure-lexical top-N would have dropped, then the final sort+slice trims to topN.
    for (const sc of queryOkfCards(pack, input.question, classification, { topN: Math.max(topN * 2, 12), minScore: 0.1 })) {
      const existing = byId.get(sc.card.id);
      if (!existing || sc.score > existing.score) byId.set(sc.card.id, sc);
    }
    // Intent-seed: a card whose TYPE the question's intent targets is added to
    // the candidate set at base score 0 EVEN IF its lexical score was below the
    // 0.1 threshold (queryOkfCards would have dropped it). This is what lets
    // "What salary should you ask for?" surface the negotiation artifact card,
    // whose body ("target the upper end of the band") shares no tokens with the
    // question. The intent boost below then lifts it to the top. Without this the
    // lexical pre-filter discards the very card the intent wants.
    for (const card of pack.cards) {
      if (card.approvalStatus === 'rejected') continue;
      if ((intentBoost.get(card.type) || 0) > 0 && !byId.has(card.id)) {
        byId.set(card.id, { card, score: 0 });
      }
    }
  }
  // Apply the additive intent→type boost, then final sort.
  const boosted = [...byId.values()]
    .map((sc) => ({ card: sc.card, score: sc.score + (intentBoost.get(sc.card.type) || 0) }))
    .filter((sc) => sc.score >= 0.1)
    .sort((a, b) => b.score - a.score);

  // Relevance-band trim (signal-to-noise): when a clear top signal exists (a real
  // lexical/intent hit, score >= 0.35), drop trailing filler cards that sit well
  // below it — the ~0.15 floor cards queryOkfCards emits from tenure/recency
  // boosts on a query with no genuine match (observed: a salary question padded
  // with 5 unrelated resume cards behind the 0.50 negotiation card). The band is
  // RELATIVE (half the top score) so it scales with signal strength: a 0.75 top
  // keeps >=0.375, a 0.50 top keeps >=0.25 (drops 0.15 filler), a 0.96 top keeps
  // >=0.48. A BROAD question whose cards all cluster near the floor (e.g. "tell me
  // about yourself" → identity/summary/experience all ~0.15-0.45) has topScore
  // that still admits the cluster, OR topScore < 0.35 → no trim, since those
  // low-but-uniform cards ARE the answer.
  const topScore = boosted[0]?.score ?? 0;
  const bandFloor = topScore >= 0.35 ? Math.max(0.1, topScore * 0.5) : 0;
  const merged = boosted.filter((sc) => sc.score >= bandFloor).slice(0, topN);

  if (merged.length === 0) {
    piTelemetry.emit('pi_okf_profile_retrieval_allowed', { cardCount: 0, blockedReason: 'no_match' });
    return { block: '', cards: [], cardCount: 0, allowed: true, blockedReason: 'no_match' };
  }

  piTelemetry.emit('pi_okf_profile_retrieval_allowed', { cardCount: merged.length });
  return { block: formatCardBlock(merged), cards: merged, cardCount: merged.length, allowed: true };
}
