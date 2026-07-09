// electron/llm/transcriptQuestionExtractor.ts
//
// Deterministic (NO LLM) extractor that pulls the latest meaningful
// interviewer question out of the last ~180s of meeting transcript and
// classifies its perspective/shape. Runs on the "What to answer?" hot path,
// so it must be fast (<500ms p95 — in practice sub-millisecond, it's pure
// string work) and never block on a model.
//
// Why this exists: the live answer pipeline previously fed the whole sparsified
// transcript to the LLM and relied on it to infer "what is being asked". That
// (a) wastes prompt tokens, (b) lets transcription noise/greetings dominate, and
// (c) loses the speaker perspective — so an interviewer's "tell me about your
// projects" could be answered as if the *assistant* were asked about *its* work.
// Extracting the question deterministically lets us route context correctly
// (run profile grounding on the real question) and answer in the candidate's
// first-person voice.
//
// Fully dynamic: no profile-, company-, or fixture-specific strings. Everything
// is derived from the transcript turns and generic question/role grammar.

import { TranscriptTurn, cleanTranscript } from './transcriptCleaner';

export type DetectedSpeaker = 'interviewer' | 'candidate' | 'unknown';

export type ExtractedQuestionType =
    | 'identity'        // name / who-are-you (about the candidate)
    | 'profile_detail'  // projects / experience / skills / education / background
    | 'jd_alignment'    // "why are you a good fit", role-fit
    | 'negotiation'     // salary / compensation / offer
    | 'behavioral'      // "tell me about a time" / STAR
    | 'technical'       // explain / implement / how does X work
    | 'follow_up'       // "can you explain that in more detail" — depends on prior turn
    | 'general';        // anything else meaningful

export interface ExtractedQuestion {
    /** Who spoke the latest meaningful turn we keyed on. */
    detectedSpeaker: DetectedSpeaker;
    /** The latest meaningful interviewer question (cleaned). '' if none found. */
    latestQuestion: string;
    /** Coarse shape used for context routing + answer framing. */
    questionType: ExtractedQuestionType;
    /** True when the question refers back to a prior turn rather than standing alone. */
    isFollowUp: boolean;
    /** Best-effort noun/topic the follow-up refers to (e.g. a project name said earlier). '' if none. */
    followUpTarget: string;
    /** 0..1 confidence that latestQuestion is a real, answerable interviewer question. */
    confidence: number;
    /** Small window of surrounding turns (most-recent few) used as background. */
    relevantTranscriptWindow: string;
    /** Cleaned-away turns (filler/greetings/noise) — for safe debug only. */
    ignoredTranscriptNoise: string[];
}

// Pure greetings / acknowledgements that are never the "question" even if they
// land on an interviewer turn. cleanTranscript already strips most filler; this
// catches whole-turn greetings that survive as short meaningful-looking turns.
const GREETING_ONLY = /^(hi|hello|hey|good (morning|afternoon|evening)|how are you|nice to meet you|thanks?|thank you|welcome|let'?s (get )?started|can you hear me|are you there)[\s!.,?]*$/i;

// Social-pleasantry chit-chat that is grammatically a question ("did you have
// any trouble finding parking?", "how was your weekend?", "did you find us
// okay?") but is NOT a substantive interview question. These pass QUESTION_MARK
// + INTERROGATIVE_LEAD, so without this the live speculative gate (0.75) fires a
// WhatToAnswer suggestion on small-talk (E2E MiniMax campaign, F-DETECT round-13
// p08). We DON'T drop these (they may precede a real question) — we cap their
// confidence below the live gate so they don't trigger a suggestion on their own.
// Anchored on the social TOPIC so a real question that merely contains the word
// (e.g. "how did you architect the parking-lot allocation service?") is unaffected.
const SOCIAL_PLEASANTRY = /\b(trouble |any (trouble|problem)s? )?(finding|find) (the office|us|parking|the parking|your way|this place|the building)\b|\bfind (us|the office|parking|the building|your way|this place)\s+(ok(ay)?|alright|all right)\b|\bhow (was|is|'?s) your (weekend|day|morning|week|commute|drive|trip|flight)\b|\bhow (are|'?re) you (doing|feeling|holding up)\b|\bhow'?s the weather\b|\bdid you (get|grab|have) (any |some )?(coffee|water|tea|lunch)\b|\b(traffic|parking|weather|commute) (was|is|been)\b|\bhow was the (traffic|commute|drive|trip|flight|parking)\b/i;

// Interrogative signal: a question mark, or a leading wh-/aux question word.
const QUESTION_MARK = /\?/;
const INTERROGATIVE_LEAD = /^(\s*)(what|who|why|where|when|which|how|whose|whom|can|could|would|will|do|did|does|are|is|were|was|have|has|had|tell me|walk me|describe|explain|give me|share|let'?s talk about|talk about|i'?d like to (hear|know)|i want to (hear|know))\b/i;

// Follow-up markers: the turn leans on a previously-mentioned thing.
const FOLLOW_UP_MARKERS = /\b(that|this|it|those|these|the (project|one|system|approach|role|company)|in more detail|more about (that|it|this)|elaborate|go deeper|expand on|you (just )?(said|mentioned)|the previous|earlier)\b/i;

// Demonstrative-only openers that strongly imply a follow-up ("can you explain that?").
const DEMONSTRATIVE_FOLLOW_UP = /\b(explain|elaborate on|tell me more about|go deeper into|expand on)\s+(that|this|it|those|these)\b/i;

/**
 * Rewrite an interviewer's second-person question into the candidate's
 * first-person framing, e.g. "What are your projects?" → "What are my projects?".
 *
 * The KnowledgeOrchestrator's intent classifier and identity fast-paths are
 * built around the candidate asking about THEMSELVES ("my name", "my projects").
 * An interviewer says "your", so the same factual question would miss the
 * identity/profile routing. Normalizing the pronouns lets one orchestrator serve
 * both the manual ("what is my name?") and live-transcript ("what is your
 * name?") paths without duplicating routing logic.
 *
 * This is used ONLY to look up grounding facts — never shown to the user. Purely
 * pronoun-level and word-boundary matched; no profile/fixture-specific strings.
 */
export function toCandidateFraming(question: string): string {
    // Preserve intro idioms verbatim: "introduce yourself" / "tell me about
    // yourself" are the exact phrases the orchestrator's INTRO_PATTERNS match to
    // route a self-introduction. Rewriting "yourself"→"myself" there ("introduce
    // myself") breaks intro detection and the name never grounds. Detect and
    // keep these, rewriting only the rest.
    const INTRO_IDIOM = /\b(introduce yourself|tell me about yourself|describe yourself|about yourself)\b/i;
    if (INTRO_IDIOM.test(question)) {
        // Leave the question essentially as-is — it's already a candidate-
        // directed intro request the orchestrator understands.
        return question;
    }
    return question
        // possessive: your → my, yours → mine
        .replace(/\byours\b/gi, 'mine')
        .replace(/\byour\b/gi, 'my')
        // subject/object: you → I (best-effort; orchestrator only keys off nouns
        // + "my", so over-rewriting "you" is harmless and keeps phrasing natural)
        .replace(/\byou'?ve\b/gi, "I've")
        .replace(/\byou'?re\b/gi, 'I am')
        .replace(/\byou\b/gi, 'I')
        // reflexive
        .replace(/\byourself\b/gi, 'myself');
}

// Capitalized words that are NOT meaningful follow-up targets even when they
// appear capitalized (sentence-initial fillers, pronouns, common openers).
const CAPITALIZED_STOPWORDS = new Set([
    'so', 'well', 'right', 'okay', 'ok', 'yeah', 'yes', 'no', 'sure', 'and', 'but',
    'the', 'a', 'an', 'i', 'we', 'they', 'he', 'she', 'it', 'this', 'that', 'then',
    'also', 'basically', 'actually', 'now', 'first', 'second', 'third', 'finally',
    'my', 'our', 'their', 'his', 'her', 'its', 'you', 'your', 'me', 'us', 'them',
    'when', 'where', 'what', 'who', 'why', 'how', 'because', 'after', 'before',
]);

/**
 * Pick the most salient product/topic-like token from a turn for follow-up
 * grounding. Prefers an explicit CamelCase token (e.g. a product name), then a
 * capitalized word that is NOT a sentence-initial filler/stopword. Returns ''
 * when nothing salient is found (caller falls back to last long content word).
 */
function pickSalientToken(text: string): string {
    // 1. CamelCase / internal-capital tokens are almost always product/proper
    //    names (CamelCase products) regardless of sentence position. When a
    //    turn names several, prefer the LAST one — it's the most recently
    //    mentioned topic, which is what a follow-up ("go deeper on that") refers to.
    const camelAll = text.match(/\b[A-Z][a-z0-9]+[A-Z][a-zA-Z0-9]*\b/g);
    if (camelAll && camelAll.length > 0) return camelAll[camelAll.length - 1];

    // 2. Otherwise scan capitalized tokens and skip the first word of each
    //    sentence (which is capitalized by convention) plus known stopwords.
    const sentences = text.split(/(?<=[.!?])\s+/);
    let best = '';
    for (const sentence of sentences) {
        const tokens = sentence.split(/\s+/);
        for (let i = 0; i < tokens.length; i++) {
            const raw = tokens[i].replace(/[^A-Za-z0-9]/g, '');
            if (!raw) continue;
            const isCapitalized = /^[A-Z][a-zA-Z0-9]+$/.test(raw);
            if (!isCapitalized) continue;
            if (i === 0) continue; // sentence-initial → capitalized by grammar
            if (CAPITALIZED_STOPWORDS.has(raw.toLowerCase())) continue;
            best = raw; // keep the last salient one (most recent topic)
        }
    }
    return best;
}

function classifyType(q: string): ExtractedQuestionType {
    const t = q.toLowerCase();

    // Identity: name / who-are-you / introduce-yourself variants.
    // "your full name", "introduce yourself", "introduce yourself as a <role>" all
    // require profile grounding — they're identity questions even without the
    // exact phrase "what is your name".
    if (/\b(your (full |first |last )?name|who are you|what'?s your name|what is your name)\b/.test(t)) return 'identity';
    if (/\b(introduce yourself|introducing yourself|tell me about yourself|describe yourself|about yourself)\b/.test(t)) return 'identity';
    // Intro/self-introduction openers ("quick self-introduction", "give a brief
    // intro", "start us off with a brief self-intro", "introduction of yourself").
    // The LIVE grounding gate keys on this classifier (NOT AnswerPlanner), so
    // without these the auto-trigger skipped identity grounding and returned a
    // clarification ("could you give me a bit more to go on?"). E2E MiniMax
    // campaign round-13/14, F-VOICE live-path parity with AnswerPlanner.
    if (/\bself[- ]?(introduc(tion|e)|intro)\b/.test(t)) return 'identity';
    if (/\b(give|giving|provide|share|start (us |me |the team )?off with)\b.{0,30}\b(a |an )?(quick |brief |short |little )?(introduction|intro)\b/.test(t)) return 'identity';
    if (/\b(who (are|is) (the|this) (candidate|person|interviewee))\b/.test(t)) return 'identity';

    // Negotiation
    if (/\b(salary|compensation|comp|pay|package|ctc|equity|stock|bonus|offer|expectations? (for|on) (pay|salary|comp)|how much (do|are) you (expect|looking)|what are you (expecting|looking for)|notice period|joining date)\b/.test(t)) {
        return 'negotiation';
    }

    // JD / role alignment
    if (/\b(good fit|right fit|why (should we|do you want|are you interested)|fit for (this|the) (role|position|job)|why this (role|company|position)|what makes you|why you)\b/.test(t)) {
        return 'jd_alignment';
    }

    // Behavioral / STAR
    if (/\b(tell me about a time|describe a (situation|time)|give me an example of a time|when have you|a time when you|walk me through a (time|situation)|how did you handle|conflict|challenge you faced)\b/.test(t)) {
        return 'behavioral';
    }

    // Profile detail: projects / experience / skills / education / background
    if (/\b(your )?(projects?|side projects?|experience|work history|background|skills?|tech stack|education|degree|studied|university|college|achievements?|certifications?|what have you (built|worked on|done))\b/.test(t)) {
        return 'profile_detail';
    }

    // Technical / conceptual
    if (/\b(implement|write (code|a function|a program)|algorithm|data structure|system design|how does .* work|explain (how|the)|difference between|what is (a|an|the)|optimi[sz]e|debug|complexity)\b/.test(t)) {
        return 'technical';
    }

    return 'general';
}

/**
 * Extract the latest meaningful interviewer question from a transcript window.
 *
 * @param turns Raw transcript turns (already role-tagged). Pass the last ~180s.
 * @param windowTurns How many recent turns to include as background context.
 */
export function extractLatestQuestion(
    turns: TranscriptTurn[],
    windowTurns: number = 6
): ExtractedQuestion {
    const empty: ExtractedQuestion = {
        detectedSpeaker: 'unknown',
        latestQuestion: '',
        questionType: 'general',
        isFollowUp: false,
        followUpTarget: '',
        confidence: 0,
        relevantTranscriptWindow: '',
        ignoredTranscriptNoise: [],
    };

    if (!Array.isArray(turns) || turns.length === 0) return empty;

    // Track what cleaning removed (for debug). A turn is "noise" if it cleaned
    // to empty/too-short or is a whole-turn greeting.
    const ignoredTranscriptNoise: string[] = [];
    const cleaned = cleanTranscript(turns);
    const cleanedKey = new Set(cleaned.map(c => `${c.timestamp}:${c.role}`));
    for (const turn of turns) {
        if (!cleanedKey.has(`${turn.timestamp}:${turn.role}`)) {
            const trimmed = turn.text.trim();
            if (trimmed) ignoredTranscriptNoise.push(trimmed);
        }
    }

    // Background window: the most recent few cleaned turns, oldest-first.
    const window = cleaned.slice(-windowTurns);
    const relevantTranscriptWindow = window
        .map(t => `[${t.role === 'interviewer' ? 'INTERVIEWER' : t.role === 'user' ? 'ME' : 'ASSISTANT'}]: ${t.text}`)
        .join('\n');

    // Walk backwards for the latest meaningful INTERVIEWER turn that looks like
    // a question (or an imperative ask like "tell me about ..."). Greeting-only
    // interviewer turns are skipped, so "Hi, can you hear me?" → keep walking.
    let chosen: TranscriptTurn | null = null;
    let chosenIdx = -1;
    for (let i = cleaned.length - 1; i >= 0; i--) {
        const turn = cleaned[i];
        if (turn.role !== 'interviewer') continue;
        const text = turn.text.trim();
        if (!text) continue;
        if (GREETING_ONLY.test(text)) {
            ignoredTranscriptNoise.push(turn.text.trim());
            continue;
        }
        const looksLikeQuestion = QUESTION_MARK.test(text) || INTERROGATIVE_LEAD.test(text);
        if (looksLikeQuestion) {
            chosen = turn;
            chosenIdx = i;
            break;
        }
        // First non-greeting interviewer turn that ISN'T obviously a question:
        // keep it as a weak candidate but keep looking for a stronger one.
        if (!chosen) { chosen = turn; chosenIdx = i; }
    }

    if (!chosen) {
        // No interviewer turn at all — speaker unknown, nothing to answer.
        return { ...empty, relevantTranscriptWindow, ignoredTranscriptNoise };
    }

    const latestQuestion = chosen.text.trim();
    const hasMark = QUESTION_MARK.test(latestQuestion);
    const hasLead = INTERROGATIVE_LEAD.test(latestQuestion);

    // Follow-up detection: demonstrative-only ask, or follow-up markers present
    // AND there's a prior turn to refer back to.
    const priorTurns = cleaned.slice(0, chosenIdx);
    const hasPrior = priorTurns.length > 0;
    const isFollowUp = hasPrior && (DEMONSTRATIVE_FOLLOW_UP.test(latestQuestion) ||
        (FOLLOW_UP_MARKERS.test(latestQuestion) && latestQuestion.split(/\s+/).length <= 14));

    // Follow-up target: the most recent salient noun phrase from a prior turn.
    // Strategy: scan backward through ALL prior turns (both candidate and
    // interviewer). The topic is often introduced by the interviewer ("You
    // mentioned a recommendation system project") and the candidate's response is
    // a brief acknowledgement ("Yes."). If we only scan candidate turns, we miss
    // the topic noun. Scan all turns; prefer user/candidate turns first (they
    // often contain the actual product/project name), then interviewer turns as
    // fallback so we capture "You mentioned X" patterns.
    let followUpTarget = '';
    if (isFollowUp) {
        // Pass 1: candidate/user turns (highest signal — they named the thing themselves)
        for (let i = priorTurns.length - 1; i >= 0; i--) {
            if (priorTurns[i].role === 'interviewer') continue;
            const cand = priorTurns[i].text;
            const original = turns.find(t => t.timestamp === priorTurns[i].timestamp)?.text || cand;
            const found = pickSalientToken(original);
            if (found) { followUpTarget = found; break; }
            const words = cand.split(/\s+/).filter(w => w.length > 4 && !CAPITALIZED_STOPWORDS.has(w.toLowerCase()));
            if (words.length > 0) { followUpTarget = words[words.length - 1]; break; }
        }
        // Pass 2: interviewer turns (fallback — "You mentioned X project")
        if (!followUpTarget) {
            for (let i = priorTurns.length - 1; i >= 0; i--) {
                if (priorTurns[i].role !== 'interviewer') continue;
                const cand = priorTurns[i].text;
                const original = turns.find(t => t.timestamp === priorTurns[i].timestamp)?.text || cand;
                const found = pickSalientToken(original);
                if (found) { followUpTarget = found; break; }
                const words = cand.split(/\s+/).filter(w => w.length > 4 && !CAPITALIZED_STOPWORDS.has(w.toLowerCase()));
                if (words.length > 0) { followUpTarget = words[words.length - 1]; break; }
            }
        }
    }

    const questionType: ExtractedQuestionType = isFollowUp ? 'follow_up' : classifyType(latestQuestion);

    // Confidence: explicit '?' + interrogative lead is strongest. A bare
    // imperative ask ("tell me about your projects") with a lead but no '?' is
    // still high. A non-question interviewer statement we fell back to is low.
    let confidence = 0.4;
    if (hasMark && hasLead) confidence = 0.95;
    else if (hasMark || hasLead) confidence = 0.8;
    if (questionType !== 'general' && confidence < 0.8) confidence = 0.7;

    // Social-pleasantry down-weight: a question-shaped chit-chat turn ("did you
    // have any trouble finding parking?") should NOT clear the live speculative
    // gate (0.75) on its own. Cap below the gate UNLESS the turn also carries a
    // substantive classified type (a real question bundled after the pleasantry,
    // e.g. "...found us okay? Great — walk me through your last project."), in
    // which case classifyType already returned something other than 'general'.
    if (SOCIAL_PLEASANTRY.test(latestQuestion) && questionType === 'general') {
        confidence = Math.min(confidence, 0.5);
    }

    return {
        detectedSpeaker: 'interviewer',
        latestQuestion,
        questionType,
        isFollowUp,
        followUpTarget,
        confidence,
        relevantTranscriptWindow,
        ignoredTranscriptNoise,
    };
}
