// electron/llm/questionLedger.ts
//
// WTA audit Phase 2 (2026-08-18, .audit/wta-audit.md §F/G): the QUESTION
// LEDGER — a session-scoped record of every detected interviewer ask, its
// relationship to earlier asks, and whether the candidate has answered it.
//
// Why: the live WTA path has no question state at all. Selection is a
// stateless "latest eligible interviewer turn wins" recompute over the 180s
// window on every press, so earlier unanswered questions silently vanish,
// compound questions collapse to one blob, and corrections/refinements are
// invisible. The ledger inverts the model: the transcript provides EVIDENCE;
// this store holds STATE ("3 open asks in this cluster; the latest utterance
// refines ask #2").
//
// Phase 2 scope — deterministic only, SHADOW-ONLY consumption:
//   • sentence + compound-clause segmentation (regex; the E/I token tagger is
//     Phase 3),
//   • dialogue-act shape detection with punctuation-provenance-aware scoring
//     (a missing '?' is NEUTRAL when the provider never guaranteed
//     punctuation — F9),
//   • fragment resolution via the shared FollowUpResolver (narrowing,
//     corrections, topic shifts) so ledger rewrites can never drift from the
//     live resolver's,
//   • conservative term-overlap answer linking,
//   • bounded, in-memory, per-session.
//
// Deliberate Phase-2 limits, surfaced as LOW per-dimension confidence rather
// than papered over: semantic parent-linking (e.g. "the rebalancing problem"
// → the consumer-groups ask) needs the Phase-4 embedding/SLM arbiter; the
// deterministic linker uses content-term overlap with a most-recent-open
// fallback and marks the fallback with confidence.relationship = 0.5 so the
// arbiter knows exactly which links to re-examine.
//
// No LLM, no I/O, no timers — pure and deterministic (timestamps are always
// supplied by the caller), so every lifecycle transition is unit-testable.

import { resolveFollowUpOrClarify } from './FollowUpResolver';
import type { PunctuationSource } from './punctuationProvenance';

export type DialogueAct =
    | 'question'
    | 'request'
    | 'clarification'
    | 'statement'
    | 'backchannel'
    | 'interruption';

export type AskRelation =
    | 'new'
    | 'refinement'
    | 'expansion'
    | 'correction'
    | 'contrast'
    | 'repeat'
    | 'continuation';

export type AskStatus =
    | 'provisional'
    | 'open'
    | 'answered'
    | 'partially_answered'
    | 'superseded'
    | 'abandoned';

export interface AskConfidence {
    /** How sure segmentation is that this clause is one atomic ask. */
    segmentation: number;
    /** How sure the shape detector is that this is a question/request at all. */
    dialogueAct: number;
    /** Fidelity of the standalone rewrite (1.0 = verbatim, else resolver conf). */
    rewrite: number;
    /** Parent/cluster linking certainty (0.5 = recency fallback — re-examine). */
    relationship: number;
    /** Certainty of the current answered/open state transition. */
    state: number;
}

export interface Ask {
    id: string;
    /** Timestamp of the turn this ask came from (caller-supplied, ms). */
    sourceTimestamp: number;
    /** The clause exactly as spoken (never mutated). */
    rawText: string;
    /** Lowercased, punctuation-stripped — used for repeat detection. */
    normalizedText: string;
    /** Self-contained form (rewritten for fragments; verbatim otherwise). */
    standaloneText: string;
    dialogueAct: DialogueAct;
    relationToPrevious: AskRelation;
    parentAskId?: string;
    clusterId: string;
    status: AskStatus;
    confidence: AskConfidence;
}

export interface InterviewerTurnInput {
    text: string;
    timestamp: number;
    punctuationSource?: PunctuationSource;
}

export interface CandidateTurnInput {
    text: string;
    timestamp: number;
}

// ── shape signals (local copies of the extractor's shapes; the Phase-3
// segmenter unifies these — drift here only affects the SHADOW ledger) ──────
const QUESTION_MARK = /\?/;
const INTERROGATIVE_LEAD = /^(\s*)(what|who|why|where|when|which|how|whose|whom|can|could|would|will|do|did|does|are|is|were|was|have|has|had)\b/i;
const IMPERATIVE_ASK = /\b(tell me|walk me|describe|explain|give me|show me|share|talk about|let'?s talk about|i'?d like to (hear|know)|i want to (hear|know))\b/i;
// Task directives ("Solve Two Sum.", "Rate your Python skills out of 10.",
// "Convince me…") — imperative-mood asks the tell-me family misses
// (ledger-benchmark 2026-08-18: 9 of 10 no-ask windows). Anchored to the
// clause START (imperative position) or a comma boundary ("…analyst role,
// connect it for me") so declarative uses ("We design for scale") don't match.
const TASK_DIRECTIVE = /(?:^|,\s*)(?:(?:ok(?:ay)?|so|now|next|alright|great|please)[,.!]?\s+)*(?:please\s+)?(solve|write|implement|rate|rank|convince|design|build|debug|code|optimi[sz]e|refactor|estimate|compare|sketch|whiteboard|connect|reverse|check|find|print|sort)\b/i;
const CORRECTION_LEAD = /^(?:(?:sorry|no|actually|wait)[,.!]?\s+)+i\s+meant?\b/i;
// Discourse/backchannel prefixes that precede a real ask in the same breath
// ("That makes sense, but why…", "Sorry, before that — why…"). Stripped
// iteratively from the FRONT of a clause only; never from the middle.
const DISCOURSE_PREFIX = /^(?:(?:that makes sense|that'?s (?:fair|great|good|interesting)|makes sense|got it|i see|interesting|okay|ok|great|nice|good|right|sure|perfect|cool|thanks|thank you|sorry|so|well|now|and|but|actually)[,.!]?\s+|before (?:that|we continue)[,.!]?\s*[—–-]*\s*)/i;
// Compound-clause boundaries: a comma (optionally + coordinator) or a bare
// coordinator directly before a wh-lead. A mid-sentence wh without either
// ("tell me WHAT you did") is NOT a boundary.
const CLAUSE_SPLIT = /,\s*(?:and\s+|but\s+|or\s+)?(?=(?:what|why|how|when|where|which|who|whose|whom)\b)|\s+(?:and|but|or)\s+(?=(?:what|why|how|when|where|which|who|whose|whom)\b)/i;
// Pleasantries and wait/hold idioms are question-SHAPED but not asks the
// candidate should answer via WTA (divergence-benchmark negatives 008/009/011).
// Local copies of the extractor's guards — the Phase-3 segmenter unifies them.
const PLEASANTRY = /\b(trouble |any (trouble|problem)s? )?(finding|find) (the office|us|parking|the parking|your way|this place|the building)\b|\bhow (was|is|'?s) your (weekend|day|morning|week|commute|drive|trip|flight)\b|\bhow (are|'?re) you (doing|feeling|holding up)\b|\bhow'?s the weather\b|\bdid you (get|grab|have) (any |some )?(coffee|water|tea|lunch)\b|\bhow was the (traffic|commute|drive|trip|flight|parking)\b/i;
const WAIT_IDIOM = /\b(give (me|us) (a|one|two|just a) (sec(ond)?s?|minutes?|moments?|mins?)\b(?!\s+(opinion|chance|example|reason|thought|look))|bear with me|hold on a (sec(ond)?|minute|moment)|one (moment|sec(ond)?),? please)\b/i;
// Clause-level interrogatives for UNPUNCTUATED turns — mirrors the live
// extractor's F9/Phase-3 recovery (transcriptQuestionExtractor.ts): with no
// '?'/comma, a prefix clause hides the wh/aux lead mid-string ("just to
// confirm what should i call you"). Consulted only when punctuationSource is
// 'unavailable'. Local copies; the Phase-3 segmenter unifies these.
const CLAUSE_INTERROGATIVE = /\b(what|why|how|when|where|which|who|whose|whom)\s+(should|would|could|can|do|did|does|is|are|was|were|am|have|has|had|will|many|much|long|soon|often|strong|ready|good|comfortable|confident|familiar|experienced|about)\b/i;
const AUX_SECOND_PERSON = /\b(can|could|would|will|do|did|does|are|were|have|has)\s+you\b/i;
const TRAILING_WH_FRAGMENT = /\b(why|what about|how about)\s+[\w'-]+( [\w'-]+)?$/i;

const STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'but', 'or', 'so', 'that', 'this', 'these', 'those', 'there', 'here',
    'what', 'why', 'how', 'when', 'where', 'which', 'who', 'whose', 'whom',
    'you', 'your', 'yours', 'me', 'my', 'mine', 'we', 'our', 'they', 'their', 'it', 'its',
    'did', 'do', 'does', 'have', 'has', 'had', 'was', 'were', 'is', 'are', 'will', 'would', 'could', 'can', 'should',
    'tell', 'about', 'with', 'for', 'from', 'into', 'onto', 'over', 'under', 'been', 'being',
    'specifically', 'particular', 'particularly', 'mean', 'sorry', 'please', 'just', 'really',
]);

function contentTerms(text: string): Set<string> {
    const out = new Set<string>();
    for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) {
        if (w.length >= 4 && !STOPWORDS.has(w)) out.add(w);
    }
    return out;
}

function overlapCount(a: Set<string>, b: Set<string>): number {
    let n = 0;
    for (const t of a) if (b.has(t)) n++;
    return n;
}

function normalize(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function toStandalone(clause: string): string {
    let s = clause.trim().replace(/^(?:and|but|or)\s+/i, '');
    if (!s) return s;
    s = s[0].toUpperCase() + s.slice(1);
    if (!/[.?!]$/.test(s)) s += '?';
    return s;
}

/** Bounds. Hard caps, not tuning knobs: they only stop pathological growth. */
const MAX_ASKS = 200;
const MAX_OPEN_ASKS = 12;

/**
 * Session-scoped ask ledger. Construct one per meeting session; feed every
 * interviewer/candidate turn; read open asks + rankings at WTA press time.
 */
export class QuestionLedger {
    private asks: Ask[] = [];
    private askCounter = 0;
    private clusterCounter = 0;
    private currentClusterId: string | null = null;

    getAsks(): Ask[] { return [...this.asks]; }

    getOpenAsks(): Ask[] { return this.asks.filter(a => a.status === 'open'); }

    getActiveClusterId(): string | null { return this.currentClusterId; }

    /**
     * Open + partially-answered asks ranked for answering. Recency is a
     * FEATURE (exponential decay, 120s half-life-ish), never the whole
     * decision — an old fully-open ask still outranks a new partially-
     * answered one when the decay gap is small.
     */
    rankActiveAsks(nowMs: number): Ask[] {
        const active = this.asks.filter(a => a.status === 'open' || a.status === 'partially_answered');
        const score = (a: Ask): number => {
            const ageSec = Math.max(0, (nowMs - a.sourceTimestamp) / 1000);
            const recency = Math.exp(-ageSec / 120);
            const state = a.status === 'open' ? 1 : 0.5;
            return recency * state * a.confidence.dialogueAct;
        };
        return active.sort((a, b) => score(b) - score(a));
    }

    ingestCandidateTurn(turn: CandidateTurnInput): void {
        const words = turn.text.trim().split(/\s+/).filter(Boolean);
        // Pure acknowledgements ("Yeah, sure.", "Okay.") never answer anything;
        // nor does anything under 4 words.
        const ACK_WORDS = new Set(['yeah', 'yes', 'no', 'sure', 'okay', 'ok', 'right', 'got', 'it',
            'of', 'course', 'definitely', 'absolutely', 'correct', 'exactly', 'thanks', 'thank', 'you']);
        const isAckOnly = words.every(w => ACK_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, '')));
        if (words.length < 4 || isAckOnly) return;
        const turnTerms = contentTerms(turn.text);
        const open = this.asks.filter(a =>
            (a.status === 'open' || a.status === 'partially_answered') && a.sourceTimestamp <= turn.timestamp);
        if (words.length >= 8) {
            for (const ask of open) {
                const ov = overlapCount(contentTerms(ask.standaloneText), turnTerms);
                if (ov >= 2) {
                    ask.status = 'answered';
                    ask.confidence.state = 0.8;
                } else if (ov === 1 && words.length >= 25) {
                    ask.status = 'partially_answered';
                    ask.confidence.state = 0.6;
                }
            }
        }
        // A direct reply right after a SINGLE open ask addresses it even
        // without term echo (people rarely repeat the question's words).
        // Divergence-benchmark adjudication 2026-08-18: the old 15-word floor
        // left stale asks open, which then OUTRANKED the fresh follow-up. A
        // short direct reply (4-7 words: "That would be Natively.") is
        // PARTIALLY answered — enough to stop outranking a fresh ask, honest
        // about possibly being an interrupted lead-in ("Sure, so at a high
        // level…"). A substantive reply (≥8 words) is answered.
        const stillOpen = this.asks.filter(a => a.status === 'open');
        if (stillOpen.length === 1) {
            if (words.length >= 8) {
                stillOpen[0].status = 'answered';
                stillOpen[0].confidence.state = 0.6;
            } else {
                stillOpen[0].status = 'partially_answered';
                stillOpen[0].confidence.state = 0.55;
            }
        }
    }

    ingestInterviewerTurn(turn: InterviewerTurnInput): Ask[] {
        const created: Ask[] = [];
        const sentences = turn.text.trim().split(/(?<=[.?!])\s+/).filter(s => s.trim());
        for (const sentence of sentences) {
            created.push(...this.ingestSentence(sentence, turn));
        }
        this.enforceBounds();
        return created;
    }

    // ── internals ────────────────────────────────────────────────────────────

    private ingestSentence(sentence: string, turn: InterviewerTurnInput): Ask[] {
        // 1. Corrections and short fragments resolve through the SAME
        //    FollowUpResolver the live path uses — before any prefix stripping
        //    (the correction lead "Sorry, I mean…" would otherwise be eaten).
        const words = sentence.trim().split(/\s+/).filter(Boolean).length;
        const isCorrection = CORRECTION_LEAD.test(sentence.trim());
        if ((isCorrection || words <= 8) && this.asks.length > 0) {
            const resolvedAsk = this.tryResolveFragment(sentence, turn);
            if (resolvedAsk) return [resolvedAsk];
        }

        // 2. Strip leading discourse/backchannel prefixes, then split compound
        //    clauses ("why X, how Y, and what Z" → three asks).
        let body = sentence.trim();
        for (let guard = 0; guard < 8; guard++) {
            const next = body.replace(DISCOURSE_PREFIX, '');
            if (next === body) break;
            body = next;
        }
        if (!body.trim()) return [];
        const rawClauses = body.split(CLAUSE_SPLIT).map(c => c.trim()).filter(Boolean);
        // Merge bare wh tail-clauses back into their sibling ("what did you
        // study" + "where?" → one ask): a ≤2-word clause is a coordination
        // remnant, not an atomic ask (divergence-benchmark case 080 — a
        // standalone "Where?" ask is unanswerable).
        const clauses: string[] = [];
        for (const clause of rawClauses) {
            const w = clause.replace(/[?.!]+$/, '').trim().split(/\s+/).filter(Boolean);
            if (w.length <= 2 && clauses.length > 0) {
                clauses[clauses.length - 1] = `${clauses[clauses.length - 1].replace(/[?.!]+$/, '')} and ${clause.replace(/^(and|but|or)\s+/i, '')}`;
            } else {
                clauses.push(clause);
            }
        }
        const compound = clauses.length > 1;

        const out: Ask[] = [];
        for (const clause of clauses) {
            const ask = this.tryCreateAsk(clause, turn, compound);
            if (ask) out.push(ask);
        }
        return out;
    }

    private askShape(clause: string, punctuation: PunctuationSource | undefined): { isAsk: boolean; act: DialogueAct; conf: number } {
        const hasMark = QUESTION_MARK.test(clause);
        const hasLead = INTERROGATIVE_LEAD.test(clause);
        const hasImperative = IMPERATIVE_ASK.test(clause) || TASK_DIRECTIVE.test(clause);
        // Pleasantry/wait idioms: question-shaped small talk and pause
        // requests are not asks (nothing for WTA to answer).
        if (PLEASANTRY.test(clause) || WAIT_IDIOM.test(clause)) {
            return { isAsk: false, act: 'statement', conf: 0.8 };
        }
        if (!hasMark && !hasLead && !hasImperative) {
            // Unpunctuated clause-level recovery (parity with the extractor's
            // F9 fix): only when the provider never guaranteed punctuation.
            if (punctuation === 'unavailable' && (
                CLAUSE_INTERROGATIVE.test(clause)
                || AUX_SECOND_PERSON.test(clause)
                || TRAILING_WH_FRAGMENT.test(clause)
            )) {
                return { isAsk: true, act: 'question', conf: 0.75 };
            }
            const short = clause.split(/\s+/).length <= 5;
            return { isAsk: false, act: short ? 'backchannel' : 'statement', conf: 0.8 };
        }
        // Punctuation-provenance-aware scoring (F9): a missing '?' is real
        // evidence only when the provider guarantees punctuation. When it is
        // 'unavailable' (Soniox/OpenAI/ElevenLabs/NativelyPro/REST) or
        // unknown, an interrogative lead alone scores as high as mark+lead.
        const punctuationGuaranteed = punctuation === 'provider_final' || punctuation === 'provider_interim';
        let conf: number;
        if (hasMark && hasLead) conf = 0.95;
        else if (hasLead) conf = punctuationGuaranteed ? 0.8 : 0.95;
        else if (hasMark) conf = 0.85;
        else conf = 0.75; // imperative ask ("tell me about…")
        return { isAsk: true, act: hasImperative && !hasLead && !hasMark ? 'request' : 'question', conf };
    }

    private tryCreateAsk(clause: string, turn: InterviewerTurnInput, fromCompound: boolean): Ask | null {
        const shape = this.askShape(clause, turn.punctuationSource);
        if (!shape.isAsk) return null;

        const normalizedText = normalize(clause);
        // Repeat: the same question re-asked re-opens the existing ask
        // instead of duplicating it.
        const existing = this.asks.find(a => a.status !== 'superseded' && a.normalizedText === normalizedText);
        if (existing) {
            existing.status = 'open';
            existing.sourceTimestamp = turn.timestamp;
            existing.relationToPrevious = 'repeat';
            return null;
        }

        const ask: Ask = {
            id: `ask-${++this.askCounter}`,
            sourceTimestamp: turn.timestamp,
            rawText: clause,
            normalizedText,
            standaloneText: toStandalone(clause),
            dialogueAct: shape.act,
            relationToPrevious: 'new',
            clusterId: this.resolveClusterId(),
            status: 'open',
            confidence: {
                segmentation: fromCompound ? 0.85 : 1.0,
                dialogueAct: shape.conf,
                rewrite: 1.0,
                relationship: 1.0,
                state: 1.0,
            },
        };
        this.asks.push(ask);
        return ask;
    }

    /**
     * Resolve a short fragment/correction against the ledger via the shared
     * FollowUpResolver. Parent = max content-term overlap among active asks;
     * zero overlap falls back to the most recent active ask with
     * confidence.relationship = 0.5 (the Phase-4 semantic arbiter's queue).
     */
    private tryResolveFragment(sentence: string, turn: InterviewerTurnInput): Ask | null {
        const active = this.asks.filter(a => a.status === 'open' || a.status === 'partially_answered');
        const candidates = active.length > 0 ? active : this.asks;
        if (candidates.length === 0) return null;

        const fragTerms = contentTerms(sentence);
        let parent = candidates[candidates.length - 1];
        let bestOverlap = 0;
        for (const a of candidates) {
            const ov = overlapCount(contentTerms(a.standaloneText), fragTerms);
            if (ov > bestOverlap) { bestOverlap = ov; parent = a; }
        }

        const resolved = resolveFollowUpOrClarify({
            latestQuestion: sentence,
            previousQuestion: parent.standaloneText,
            surface: 'what_to_answer',
            hasPriorContext: true,
        });
        if (resolved.isClarification || resolved.confidence < 0.7 || !resolved.resolvedQuestion) return null;

        const relation: AskRelation =
            resolved.reason.startsWith('correction') ? 'correction'
            : resolved.reason.startsWith('narrowing') ? 'refinement'
            : resolved.reason.startsWith('topic_shift') ? 'expansion'
            : 'refinement';

        if (relation === 'correction') {
            parent.status = 'superseded';
            parent.confidence.state = resolved.confidence;
        }

        const ask: Ask = {
            id: `ask-${++this.askCounter}`,
            sourceTimestamp: turn.timestamp,
            rawText: sentence.trim(),
            normalizedText: normalize(resolved.resolvedQuestion),
            standaloneText: resolved.resolvedQuestion,
            dialogueAct: 'question',
            relationToPrevious: relation,
            parentAskId: parent.id,
            clusterId: parent.clusterId,
            status: 'open',
            confidence: {
                segmentation: 1.0,
                dialogueAct: 0.9,
                rewrite: resolved.confidence,
                relationship: bestOverlap > 0 ? 0.9 : 0.5,
                state: 1.0,
            },
        };
        this.asks.push(ask);
        return ask;
    }

    /** New asks join the current cluster while it has active asks; a fresh
     *  cluster starts once everything prior is answered/superseded. */
    private resolveClusterId(): string {
        const clusterHasActive = this.currentClusterId !== null
            && this.asks.some(a => a.clusterId === this.currentClusterId
                && (a.status === 'open' || a.status === 'partially_answered'));
        if (!clusterHasActive) {
            this.currentClusterId = `cluster-${++this.clusterCounter}`;
        }
        return this.currentClusterId as string;
    }

    private enforceBounds(): void {
        // Too many open asks → abandon the oldest open ones.
        const open = this.asks.filter(a => a.status === 'open');
        if (open.length > MAX_OPEN_ASKS) {
            for (const a of open.slice(0, open.length - MAX_OPEN_ASKS)) {
                a.status = 'abandoned';
                a.confidence.state = 1.0;
            }
        }
        // Hard cap on total retained asks → drop the oldest.
        if (this.asks.length > MAX_ASKS) {
            this.asks.splice(0, this.asks.length - MAX_ASKS);
        }
    }
}
