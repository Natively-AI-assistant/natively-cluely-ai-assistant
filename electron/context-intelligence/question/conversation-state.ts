// electron/context-intelligence/question/conversation-state.ts
//
// Compact, SCOPED follow-up continuity.
//
// WHAT THIS REPLACES
// Today five of nine surfaces pass `session.getFormattedContext(N)` — an
// unbounded transcript blob that also contains the assistant's own prior output
// labelled only as "ASSISTANT (PREVIOUS SUGGESTION)". A guard for that exists
// (context-os/assistantClaims) but is wired to ONE surface and disabled in
// production, so on the rest a single fabrication becomes self-reinforcing.
//
// Two rules follow, and both are enforced here rather than in a prompt:
//   1. State is SIZE-BOUNDED and reset on meeting change (§12.3).
//   2. Prior assistant output is a REFERENT, never evidence. It can tell you what
//      "it" refers to; it can never support a factual claim.

import type { EvidenceScope, PriorTurnDecision } from '../contracts/types';
import { scopeKey } from '../contracts/types';
import { isBareFollowUp, isResponseRequest } from './turn-classifier';

export interface ConversationTurn {
  role: 'user' | 'interviewer' | 'assistant';
  text: string;
  timestamp: number;
}

export interface ConversationState {
  scopeId: string;
  activeTopic?: string;
  /**
   * The PERSON the conversation is about (deep-test D9, 2026-08-01). A single
   * untyped topic slot bound "she" to whatever capitalised token came last —
   * "Does she have Kubernetes experience?" made the topic Kubernetes, and the
   * next "Has she used GCP?" resolved she = Kubernetes. Personal pronouns
   * resolve ONLY against this slot, and it is deliberately sticky: a tech noun
   * can take the topic slot without evicting the person.
   */
  activePerson?: string;
  activeEntities: string[];
  previousQuestion?: string;
  /** A SUMMARY of the assistant's last answer, usable only to resolve
   *  references. Never promoted to evidence. */
  previousAnswerSummary?: string;
  previousEvidenceIds: string[];
  previousSourceIds: string[];
  /**
   * The last RETRIEVAL turn's source-precedence outcome (selected vs ignored
   * sources, with their declared statuses). A "why did you ignore X" follow-up
   * answers from this record. Preserved across intervening FAST turns — a
   * definition question between the price answer and the why must not erase
   * the decision being asked about — and reset with the rest of the state on
   * scope change.
   */
  previousDecision?: PriorTurnDecision;
  unresolvedReferences: string[];
  updatedAt: number;
}

export const MAX_ENTITIES = 8;
export const MAX_SUMMARY_CHARS = 280;

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'was',
  'were', 'you', 'your', 'our', 'their', 'about', 'what', 'how', 'why', 'when', 'did', 'does',
  'can', 'could', 'would', 'should', 'they', 'them', 'been', 'into', 'more', 'than', 'then']);

/** Ordinary English words that are capitalised purely because they begin a
 *  sentence. Without this, "Tell me about the Cassandra migration" yields
 *  activeTopic = "Tell", and the next pronoun resolves against a verb — silently
 *  redirecting retrieval at nothing. */
const SENTENCE_STARTERS = new Set(['tell', 'what', 'how', 'why', 'when', 'where', 'who', 'which',
  'can', 'could', 'would', 'should', 'did', 'does', 'do', 'is', 'are', 'was', 'were', 'will',
  'explain', 'describe', 'walk', 'give', 'show', 'let', 'please', 'talk', 'help', 'compare',
  'summarize', 'summarise', 'list', 'write', 'and', 'but', 'so', 'now', 'okay', 'ok', 'also',
  'has', 'have', 'had']);

/** Capitalised tokens and code-ish identifiers — the things a pronoun usually
 *  refers back to. Deliberately conservative: a wrong entity silently redirects
 *  the next retrieval, which is worse than resolving nothing. */
export function extractEntities(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (v: string) => { if (!seen.has(v)) { seen.add(v); out.push(v); } };

  for (const m of text.matchAll(/\b([A-Z][A-Za-z0-9]{2,}(?:\s+[A-Z][A-Za-z0-9]{2,})?)\b/g)) {
    const token = m[1];
    const idx = m.index ?? 0;
    // Sentence-initial = start of string, or preceded only by whitespace after
    // sentence-ending punctuation.
    const before = text.slice(0, idx);
    const sentenceInitial = /(^|[.!?]\s*)$/.test(before);
    if (sentenceInitial && SENTENCE_STARTERS.has(token.split(/\s+/)[0].toLowerCase())) continue;
    add(token);
  }
  for (const m of text.matchAll(/\b([a-z]+[A-Z]\w+|\w+\.\w+|\w+_\w+)\b/g)) add(m[1]);

  return out.filter((e) => !STOP.has(e.toLowerCase())).slice(0, MAX_ENTITIES);
}

/**
 * Lowercase TOPIC of a question — what capitalisation-gated entity extraction
 * structurally cannot see (Defect D, 2026-08-01).
 *
 * "What does this lecture say about quantum computing?" holds no capitalised
 * token, so activeTopic stayed empty and the follow-up "Can you explain it
 * generally instead?" resolved nothing — the turn was answered about an
 * unrelated retrieved chunk. The topic of a question is usually its
 * about-complement or the definiendum; both are extractable without guessing.
 */
export function extractTopicPhrase(text: string): string | undefined {
  const q = String(text).trim().replace(/[?!.]+$/, '');
  const pats = [
    /\babout ((?:[\w-]+ ){0,4}[\w-]+)$/i,                       // "…about quantum computing"
    /\bwhat (?:is|are) (?:a |an |the )?((?:[\w-]+ ){0,3}[\w-]+)$/i, // "what is a mutex"
    /\b(?:explain|define|describe) (?:a |an |the )?((?:[\w-]+ ){0,3}[\w-]+)$/i,
  ];
  for (const p of pats) {
    const m = q.match(p);
    if (!m) continue;
    const phrase = m[1]
      .split(/\s+/)
      .filter((w) => !STOP.has(w.toLowerCase()) || w.includes('-'))
      .join(' ')
      .trim();
    // A topic must carry substance: pure stop/aux residue resolves the next
    // pronoun at nothing, which silently redirects retrieval.
    if (phrase.length >= 3 && !SENTENCE_STARTERS.has(phrase.toLowerCase())) return phrase;
  }
  return undefined;
}

/**
 * People named in a question — conservative on purpose, like extractEntities.
 * A person is recognised only by an explicit person-shaped cue: a possessive
 * ("Leena's strongest signal"), a person title ("candidate Leena", "Dr Raman"),
 * or a who-question subject ("Who is Leena?"). A bare capitalised token is NOT
 * enough — that is exactly how Kubernetes became "she".
 */
export function extractPersonEntities(text: string): string[] {
  const s = String(text);
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (v: string | undefined) => {
    const t = (v ?? '').trim();
    if (!t || seen.has(t) || STOP.has(t.toLowerCase()) || SENTENCE_STARTERS.has(t.toLowerCase())) return;
    seen.add(t); out.push(t);
  };
  for (const m of s.matchAll(/\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)['’]s\b/g)) add(m[1]);
  for (const m of s.matchAll(/\b(?:candidate|mr|mrs|ms|dr|prof(?:essor)?)\.?\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)/gi)) add(m[1]);
  for (const m of s.matchAll(/\bwho\s+is\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/g)) add(m[1]);
  return out;
}

export function emptyState(scope: EvidenceScope): ConversationState {
  return {
    scopeId: scopeKey(scope),
    activeEntities: [],
    previousEvidenceIds: [],
    previousSourceIds: [],
    unresolvedReferences: [],
    updatedAt: 0,
  };
}

export interface AdvanceInput {
  scope: EvidenceScope;
  question: string;
  answerSummary?: string;
  evidenceIds?: string[];
  sourceIds?: string[];
  /** This turn's source decision, when it retrieved. Absent ⇒ the previous
   *  decision is PRESERVED, not cleared. */
  decision?: PriorTurnDecision;
  at?: number;
}

/** Bounded copy: state is size-capped by contract, and a pathological source
 *  list must not grow it without limit. */
const MAX_DECISION_SOURCES = 8;
const boundDecision = (d: PriorTurnDecision): PriorTurnDecision => ({
  question: d.question.slice(0, MAX_SUMMARY_CHARS),
  selectedSources: d.selectedSources.slice(0, MAX_DECISION_SOURCES),
  ignoredSources: d.ignoredSources.slice(0, MAX_DECISION_SOURCES),
  ...(d.precedenceReason ? { precedenceReason: d.precedenceReason } : {}),
});

/**
 * Advance the state after a turn.
 *
 * RESETS when the scope changes. A meeting change must not carry the previous
 * meeting's entities forward — the corpus contains two transcripts that REVERSE
 * each other's decisions precisely to make that failure visible.
 */
export function advance(prev: ConversationState | null, input: AdvanceInput): ConversationState {
  const sid = scopeKey(input.scope);
  const base = prev && prev.scopeId === sid ? prev : emptyState(input.scope);

  const fresh = extractEntities(input.question);
  const merged = [...new Set([...fresh, ...base.activeEntities])].slice(0, MAX_ENTITIES);
  const persons = extractPersonEntities(input.question);

  return {
    scopeId: sid,
    // Lowercase topics ("quantum computing", "a mutex") fall back to phrase
    // extraction — capitalisation-gated entities alone left activeTopic empty
    // for exactly the questions whose follow-ups need resolving (Defect D).
    activeTopic: fresh[0] ?? extractTopicPhrase(input.question) ?? base.activeTopic,
    // Sticky: a turn about a technology must not evict the person (D9).
    activePerson: persons[0] ?? base.activePerson,
    activeEntities: merged,
    previousQuestion: input.question,
    previousAnswerSummary: input.answerSummary
      ? input.answerSummary.slice(0, MAX_SUMMARY_CHARS)
      : undefined,
    previousEvidenceIds: input.evidenceIds ?? [],
    previousSourceIds: input.sourceIds ?? [],
    previousDecision: input.decision ? boundDecision(input.decision) : base.previousDecision,
    unresolvedReferences: [],
    updatedAt: input.at ?? 0,
  };
}

// Split by referent TYPE (deep-test D9, 2026-08-01): a personal pronoun refers
// to a person and must never resolve to a technology topic; the untyped union
// is how "she" became Kubernetes.
const PERSONAL_PRONOUN_RE = /\b(she|he|her|him|his|hers)\b/i;
// `its` added 2026-08-02: "What is its worst-case complexity?" is the canonical
// short follow-up, and the possessive was simply missing — the turn passed
// through unresolved and was answered as a fresh question.
const NONPERSON_PRONOUN_RE = /\b(it|its|that|this|those|these|they|them|the (?:same|latter|former)|there)\b/i;

/**
 * A pronoun licenses state resolution only in a SHORT turn (2026-08-02).
 *
 * A genuine follow-up is short because its subject lives elsewhere — the same
 * insight FOLLOW_UP_MAX_WORDS encodes in the classifier. A long turn containing
 * "this/that/it" almost always binds the pronoun to its own antecedent: "I paid
 * for the subscription yesterday, but the application still shows the free
 * plan. Please fix this immediately." is fully self-contained, and resolving
 * its "this" against state glued "(referring to: Array)" onto it — the previous
 * turn was a multiple-choice answer — rewriting a support request into
 * nonsense (measured, 2026-08-01). Twelve words is deliberately generous: it
 * admits every measured real follow-up ("Can you explain it generally
 * instead?") while excluding any turn long enough to state its own subject.
 */
const PRONOUN_RESOLUTION_MAX_WORDS = 12;

export interface ResolvedReference {
  resolved: string;
  usedState: boolean;
  referent?: string;
  /**
   * WHY this outcome — observability only (context-debug logging), never
   * consulted by routing. Stable machine-readable identifiers.
   */
  reason?:
    | 'NO_CONVERSATION_STATE'
    | 'NO_REFERENT_TRIGGER'
    | 'CURRENT_QUESTION_CONTAINS_EXPLICIT_ENTITY'
    | 'PRONOUN_RESOLVED_TO_ACTIVE_PERSON'
    | 'RESOLVED_TO_ACTIVE_TOPIC'
    | 'REPHRASE_ANCHORED_TO_PREVIOUS_QUESTION'
    | 'ANCHORED_TO_PREVIOUS_QUESTION'
    | 'PERSONAL_PRONOUN_NO_KNOWN_PERSON'
    | 'CURRENT_TURN_SELF_CONTAINED';
}

/**
 * Resolve a bare follow-up against state.
 *
 * Returns the question UNCHANGED when there is nothing to resolve against —
 * guessing a referent silently redirects retrieval at a document the user never
 * mentioned, which is worse than asking.
 *
 * REWRITTEN 2026-08-01 (Defect D): detection and resolution previously used
 * DISJOINT gates — `isBareFollowUp` (turn-classifier) flagged "What should I
 * say?" and "Why not?" which PRONOUN_RE could not resolve, while "Can you
 * explain it generally instead?" carried a resolvable pronoun but exceeded the
 * bare-follow-up word cap and was planned as a fresh question. Every reported
 * failure fell in a cell where the two gates disagreed. The resolver now
 * accepts the union of both gates and falls back to the previous QUESTION as
 * the referent when no topic/entity exists — the previous answer stays a
 * referent-only summary, never evidence.
 */
export function resolveReference(question: string, state: ConversationState | null): ResolvedReference {
  const q = question.trim();
  if (!state) return { resolved: q, usedState: false, reason: 'NO_CONVERSATION_STATE' };

  const pronounAnywhere = PERSONAL_PRONOUN_RE.test(q) || NONPERSON_PRONOUN_RE.test(q);
  const shortTurn = q.split(/\s+/).filter(Boolean).length <= PRONOUN_RESOLUTION_MAX_WORDS;
  const personal = PERSONAL_PRONOUN_RE.test(q) && shortTurn;
  const pronoun = pronounAnywhere && shortTurn;
  const bare = isBareFollowUp(q);
  const rephrase = isResponseRequest(q);
  if (!pronoun && !bare && !rephrase) {
    return {
      resolved: q, usedState: false,
      // Distinguish "no trigger at all" from "a pronoun exists but the turn is
      // long enough to bind it internally" — the second is the contamination
      // class this gate closes, and telemetry needs to see it as a decision.
      reason: pronounAnywhere ? 'CURRENT_TURN_SELF_CONTAINED' : 'NO_REFERENT_TRIGGER',
    };
  }

  // SELF-CONTAINED questions get no referent (deep-test D9): "How many
  // students used CampusMesh?" is five words starting with "how", so the bare
  // gate fired and glued "(referring to: exact interview process)" onto a
  // question that already names its own subject. An explicit entity in the
  // current question always takes precedence over inherited state.
  if (!pronoun && !rephrase && extractEntities(q).length > 0) {
    return { resolved: q, usedState: false, reason: 'CURRENT_QUESTION_CONTAINS_EXPLICIT_ENTITY' };
  }

  // Personal pronouns resolve ONLY to a person; everything else resolves to
  // the topic. No known person → anchor to the previous QUESTION rather than
  // guess a topic — a wrong referent silently redirects retrieval.
  const referent = personal
    ? state.activePerson
    : state.activeTopic ?? state.activeEntities[0];

  // "What should I say?" asks how to DELIVER the previous exchange, not a new
  // fact. Embedding the previous question keeps its salient terms in the
  // retrieval query, so the same sources ground the rephrasing.
  if (rephrase && state.previousQuestion) {
    return {
      resolved: `${q} (rephrasing request: how to phrase the answer to "${state.previousQuestion}"${referent ? `, topic: ${referent}` : ''})`,
      usedState: true,
      referent: referent ?? state.previousQuestion,
      reason: 'REPHRASE_ANCHORED_TO_PREVIOUS_QUESTION',
    };
  }

  if (referent) {
    return {
      resolved: `${q} (referring to: ${referent})`, usedState: true, referent,
      reason: personal ? 'PRONOUN_RESOLVED_TO_ACTIVE_PERSON' : 'RESOLVED_TO_ACTIVE_TOPIC',
    };
  }

  // No topic and no entity — a bare follow-up can still anchor to the previous
  // question itself ("Why not?" after "What is a mutex?").
  if ((pronoun || bare) && state.previousQuestion) {
    return {
      resolved: `${q} (follow-up to: "${state.previousQuestion}")`,
      usedState: true,
      referent: state.previousQuestion,
      reason: 'ANCHORED_TO_PREVIOUS_QUESTION',
    };
  }

  return {
    resolved: q, usedState: false,
    reason: personal ? 'PERSONAL_PRONOUN_NO_KNOWN_PERSON' : 'NO_REFERENT_TRIGGER',
  };
}

/**
 * Prior source ids a follow-up may REUSE — but only as a retrieval hint.
 *
 * §12.4: reused sources must still be authorized, current and version-valid at
 * the time of reuse. This returns candidate ids only; it confers no authority,
 * and the scope/version filter still applies downstream.
 */
export function continuitySourceIds(state: ConversationState | null, scope: EvidenceScope): string[] {
  if (!state || state.scopeId !== scopeKey(scope)) return [];
  return state.previousSourceIds;
}
