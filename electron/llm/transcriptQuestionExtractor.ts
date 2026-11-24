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
import {
    SOCIAL_PLEASANTRY, WAIT_IDIOM,
    CLAUSE_INTERROGATIVE, AUX_SECOND_PERSON, TRAILING_WH_FRAGMENT, SHORT_TOPIC_SHIFT,
    WH_NOUN_AUX, TASK_DIRECTIVE,
    QUESTION_MARK, INTERROGATIVE_LEAD, IMPERATIVE_ASK, scoreAskShape,
} from './questionShapes';

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

// A turn that only constrains the previous ask (issue #539) — see the split
// constraint join in extractLatestQuestion.
const SPLIT_CONSTRAINT_LEAD = /^(?:you\s+(?:can|may|should|could)\s+(?:safely\s+)?assume|assume\b|note\s+that|the\s+constraints?\b|constraints?\s*:|the\s+input\s+(?:is|will|can|may)|inputs?\s+(?:are|is|will)|do\s+it\s+(?:in|without)|without\s+using\b|in\s+o\s*\(|with\s+o\s*\()/i;
const SPLIT_CONSTRAINT_MAX_GAP_MS = 30_000;
// GENERIC CLOSER (#741): an interviewer states a task over several sentences
// ("So I'd like you to design the notification delivery service ...", three
// sentences of requirements) and closes with a prompt that has no subject of
// its own ("So where would you start?"). Recency picked the closer alone, which
// routed as a general answer with a 75-word ceiling. The closer is joined back
// to the stated ask, through the requirement turns between, when every turn is
// the interviewer's (no candidate turn between) and the ask began within 60s.
const GENERIC_CLOSING_ASK = /^(?:(?:so|okay|ok|alright|all\s+right|and|well|now|then|great)[,.!]?\s+)*(?:where\s+(?:would|do|will|should|could|might)\s+you\s+(?:like\s+to\s+)?(?:start|begin)|where\s+(?:do|should|shall)\s+we\s+(?:start|begin)|how\s+(?:would|do|will|should|could|might)\s+you\s+(?:start|begin|approach|tackle|go\s+about)(?:\s+(?:it|this|that|this\s+one|that\s+one))?|how\s+(?:do|should|shall)\s+we\s+(?:start|begin)|what(?:'s|\s+is|\s+would\s+be)\s+your\s+(?:approach|first\s+step|plan|starting\s+point)|what\s+would\s+you\s+do\s+first|what\s+are\s+your\s+(?:initial\s+|first\s+)?thoughts|(?:any\s+)?(?:initial\s+|first\s+)?thoughts|take\s+it\s+away|over\s+to\s+you|go\s+ahead)\s*[?.!]*$/i;
// A stated task that a generic closer can belong to: an imperative ask, or one
// framed as a request ("I'd like you to design", "can you build", "let's design").
const STATED_TASK_RE = /\b(?:i'?d\s+like\s+you\s+to|i\s+would\s+like\s+you\s+to|i\s+want\s+you\s+to|we'?d\s+like\s+you\s+to|can\s+you|could\s+you|let'?s|let\s+us|your\s+(?:task|job|challenge)\s+(?:is|will\s+be)\s+to)\s+(?:\w+\s+){0,2}?(?:design|build|implement|write|solve|architect|sketch|model|plan|code|create|estimate|debug)\b/i;
const GENERIC_CLOSER_MAX_SPAN_MS = 60_000;
const GENERIC_CLOSER_MAX_TURNS_BACK = 6;
// MID-SENTENCE SPLIT (#773): the STT provider ends a final in the middle of a
// sentence ("…what would be a pseudo code? Can you" | "think of?"), and
// recency picked the tail alone, losing the ask. An interviewer turn with no
// terminal . ? ! whose last word cannot end a sentence (an article, a
// possessive, "of", a conjunction, a modal, or a question opener such as
// "can you") is joined to the interviewer turn that follows within 8s.
const MID_SENTENCE_TAIL = /(?:^|\s)(?:(?:a|an|the|my|your|our|their|of|and|or|but|because|whether|than|would|could|should|might|must)|(?:can|could|would|will|should|do|does|did|are|is|were|have|has)\s+(?:you|we|i|they|he|she))$/i;
const MID_SENTENCE_MAX_GAP_MS = 8_000;
const MID_SENTENCE_MAX_TURNS_BACK = 4;
function endsMidSentence(raw: string): boolean {
    const t = raw.trim().replace(/[\s,;:\-–—]+$/, '');
    if (!t || /[.?!]["'”’)]*$/.test(t)) return false;
    return MID_SENTENCE_TAIL.test(t);
}

// Social-pleasantry chit-chat that is grammatically a question ("did you have
// any trouble finding parking?", "how was your weekend?", "did you find us
// okay?") but is NOT a substantive interview question. These pass QUESTION_MARK
// + INTERROGATIVE_LEAD, so without this the live speculative gate (0.75) fires a
// WhatToAnswer suggestion on small-talk (E2E MiniMax campaign, F-DETECT round-13
// p08). We DON'T drop these (they may precede a real question) — we cap their
// confidence below the live gate so they don't trigger a suggestion on their own.
// Anchored on the social TOPIC so a real question that merely contains the word
// (e.g. "how did you architect the parking-lot allocation service?") is unaffected.
// SOCIAL_PLEASANTRY: shared — see questionShapes.ts.

// An imperative ask appearing ANYWHERE in the turn, not just sentence-initially.
// INTERROGATIVE_LEAD is ^-anchored on purpose (it feeds confidence scoring), but
// the answerability floor must not reject a genuine ask merely because it is
// preceded by a clause: "One more question — tell me about levee." is the exact
// shape campaign2 fix#5 (2026-07-17) was written to keep selecting.
// IMPERATIVE_ASK: shared — see questionShapes.ts.

// Wait/hold idioms (negative-benchmark neg_logistics_011, 2026-08-18): "give
// me one second", "bear with me" are pause REQUESTS, not asks — but "give me"
// sits in IMPERATIVE_ASK/INTERROGATIVE_LEAD, so "Give me one second, my other
// monitor just died." scored 0.8 (0.95 under unavailable punctuation) and
// cleared both live gates. Capped below the gates like SOCIAL_PLEASANTRY —
// unless the turn also classifies as a substantive type (a real question can
// follow the pause in the same breath). The lookahead keeps "give me a second
// OPINION/chance/example…" out of the idiom.
// WAIT_IDIOM: shared — see questionShapes.ts.

// Interrogative signal: a question mark, or a leading wh-/aux question word.
// QUESTION_MARK / INTERROGATIVE_LEAD: shared — see questionShapes.ts (unified
// with the shadow ledger's copies, code review 2026-08-19; definitions are
// verbatim the ones that lived here, so live selection is unchanged).

// Follow-up markers: the turn leans on a previously-mentioned thing.
//
// Split into WEAK and STRONG tiers (Campaign 2, longsession, 2026-07-16 —
// forensic-report.md H3). WEAK markers (bare "that"/"this"/"it"/"the project")
// are common words that can appear in a perfectly ordinary FRESH question too
// ("what did you build with that framework?"), so they only count as a
// follow-up signal on a SHORT turn — a long turn containing "that" is more
// likely a new, self-contained question that happens to use the word. STRONG
// markers ("you mentioned", "earlier", "going back to", "the previous", "you
// said") are unambiguous explicit backward-references regardless of how long
// the sentence built around them is — a real interviewer callback like "going
// back to the memory leak you mentioned earlier, how long did it take your
// team to ship the fix?" is 26 words but is exactly as much a follow-up as a
// 5-word one. Applying the same length cap to both tiers silently mis-typed
// realistic long callback questions as fresh/standalone (live-proven:
// traces2/golden-longctx-18.txt, isFollowUp:false on that exact sentence).
const WEAK_FOLLOW_UP_MARKERS = /\b(that|this|it|those|these|the (project|one|system|approach|role|company)|in more detail|more about (that|it|this)|elaborate|go deeper|expand on)\b/i;
// STRONG markers must be phrase-anchored to an explicit conversational
// recall — NOT bare words that also occur constantly in ordinary fresh
// speech. Skeptic-pass review (Campaign 2, 2026-07-16) found the first draft
// of this tier matched bare "earlier" ("I graduated earlier than my cohort"),
// bare "the previous" ("the previous role I held"), and open-object "going
// back to" ("going back to the office three days a week") — all common,
// NON-callback interview phrasings that got misclassified as follow-ups,
// corrupting downstream grounding lookups (a bogus followUpTarget can
// overwrite a perfectly good identity/technical query — see
// IntelligenceEngine.ts's lookupQ override) and letting small talk escape the
// SOCIAL_PLEASANTRY confidence down-weight. Each alternative below requires
// the recall verb/phrase itself, not just a co-occurring word:
//   - "you (just) said/mentioned ... earlier" or "mentioned earlier" as a unit
//   - "going/coming back to" ONLY when the object is a demonstrative or an
//     explicit "what you said/mentioned" — not an open noun phrase like "the
//     office"/"school"
//   - "the previous" ONLY when paired with a conversation-shaped noun
//     (point/topic/question/thing/example you mentioned), not a career noun
//     (role/company/job/quarter)
const STRONG_FOLLOW_UP_MARKERS = /\b(you (just )?(said|mentioned)\b|\bmentioned (earlier|before)\b|\bsaid (earlier|before)\b|(going|coming) back to (that|this|it|what you (said|mentioned)|the (earlier|previous|last) (point|topic|question|thing))\b|the previous (point|topic|question|thing|example)( you (mentioned|said|brought up|raised))?\b|circling back|you (had )?(brought up|touched on|referenced))\b/i;
const FOLLOW_UP_WORD_CAP = 14;

// ── Clause-level interrogatives for UNPUNCTUATED providers (WTA audit
// F9/Phase 3, 2026-08-18) ───────────────────────────────────────────────────
// INTERROGATIVE_LEAD is ^-anchored by design, and on punctuating providers a
// prefix clause is separated by a comma/period so the lead survives cleaning.
// On a no-punctuation provider ("Soniox-class"), "Just to confirm, what
// should I call you?" arrives as one flat "just to confirm what should i
// call you" — the wh-lead sits MID-STRING, hasMark/hasLead both fail, and
// the answerability floor caps the turn at 0.3, silently skipping profile
// grounding (measured: 12 of the 102 selection-dataset cases cross below the
// 0.6 gate this way). These patterns recover the interrogative CLAUSE
// deterministically and are consulted ONLY when the turn's
// punctuationSource === 'unavailable' — on punctuating providers the missing
// '?'/comma stays real negative evidence.
//   1. wh-word + auxiliary/degree word ("how strong is", "what should i",
//      "how ready are", "why did you") anywhere in the turn.
// CLAUSE_INTERROGATIVE: shared — see questionShapes.ts.
//   2. auxiliary + second person ("can you", "did you", "are you") anywhere —
//      the interviewer addressing the candidate interrogatively.
// AUX_SECOND_PERSON: shared — see questionShapes.ts.
//   3. a trailing wh-fragment ("…engineering-heavy why data"): why/what-about
//      + a 1-2 word object at the very END of the turn.
// TRAILING_WH_FRAGMENT: shared — see questionShapes.ts.
//   4. a bare topic-shift fragment ("and sql", "and python frameworks") —
//      "and" is too common for the anywhere rule, so the WHOLE turn must be
//      the fragment (≤4 words).
// SHORT_TOPIC_SHIFT: shared — see questionShapes.ts.

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
    //
    // Every second-person INTRO_PATTERN has to be here (premium
    // IntentClassifier; drift guard in IntroFramingKeepsIntro2026_09_27). Live
    // 2026-09-27, looking for work: "walk me through your background" became
    // "walk me through my background", classified GENERAL instead of INTRO, and
    // the answer was built from two arbitrary résumé nodes — "most recently I
    // was at Shiplane" for a candidate whose current job is Ledgerly, and an
    // invented earlier employer. 7 of 24 intro patterns broke this way.
    // "what do you do" / "who are you" also open ordinary questions ("what do
    // you do when a deploy fails?"), so they are kept only as the WHOLE ask.
    const INTRO_IDIOM = /\b(introduce yourself|introducing yourself|tell me about yourself|describe yourself|about yourself|introduction of yourself|introduction of who you are|walk me through your background|give me your introduction)\b/i;
    const INTRO_WHOLE_ASK = /\b(what do you do(\s+(now|currently|today|these days|for (a )?(living|work)))?|who are you)\s*[?.!]*\s*$/i;
    if (INTRO_IDIOM.test(question) || INTRO_WHOLE_ASK.test(question)) {
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

    // Map every cleaned turn back to the RAW turn it came from, by ORIGINAL
    // INDEX rather than by timestamp.
    //
    // The previous implementation keyed a Set on `${timestamp}:${role}` and
    // looked turns up with `turns.find(t => t.timestamp === …)` — two different
    // key shapes for the same relation. Streaming STT regularly emits several
    // turns inside the same millisecond, so the timestamp-only lookup returned
    // the FIRST turn sharing that millisecond rather than the one being
    // examined, which silently defeated the raw-text greeting guard below.
    // cleanTranscript preserves order and only ever drops turns, so a single
    // forward pointer recovers the exact correspondence and is collision-proof.
    const rawIndexOfCleaned: number[] = [];
    {
        let p = 0;
        for (const c of cleaned) {
            while (p < turns.length && !(turns[p].role === c.role && turns[p].timestamp === c.timestamp)) p++;
            rawIndexOfCleaned.push(p < turns.length ? p : -1);
            p++;
        }
    }
    const keptRaw = new Set(rawIndexOfCleaned.filter(i => i >= 0));
    turns.forEach((turn, i) => {
        if (!keptRaw.has(i)) {
            const trimmed = turn.text.trim();
            if (trimmed) ignoredTranscriptNoise.push(trimmed);
        }
    });
    /** Raw (uncleaned) text for a cleaned-array index, falling back to cleaned. */
    const rawTextAt = (cleanedIdx: number): string => {
        const ri = rawIndexOfCleaned[cleanedIdx];
        const raw = ri >= 0 ? turns[ri]?.text?.trim() : '';
        return raw || cleaned[cleanedIdx]?.text?.trim() || '';
    };

    // Background window: the most recent few cleaned turns, oldest-first.
    const window = cleaned.slice(-windowTurns);
    const relevantTranscriptWindow = window
        .map(t => `[${t.role === 'interviewer' ? 'INTERVIEWER' : t.role === 'user' ? 'ME' : 'ASSISTANT'}]: ${t.text}`)
        .join('\n');

    // Walk backwards for the latest meaningful INTERVIEWER turn. Greeting-only
    // interviewer turns are skipped, so "Hi, can you hear me?" → keep walking.
    // Otherwise take the FIRST (i.e. most recent) non-greeting, non-empty
    // interviewer turn outright — do NOT keep searching backward for an OLDER
    // turn that merely LOOKS more question-shaped (has "?" or an interrogative
    // lead). "Tell me about X" / "One more question — tell me about levee." are
    // genuine imperative asks that don't match QUESTION_MARK/INTERROGATIVE_LEAD
    // (no "?", and the lead word isn't sentence-initial), so the old logic kept
    // them only as a "weak candidate" and preferred an earlier, more question-
    // shaped turn instead — inverting recency in a live conversation (harness
    // longsession campaign2, 2026-07-17: live-proven on 4 real presses —
    // traces2/harness-script-{a,c}-press-{A12,A15,C11,C14}.txt — where the
    // extractor locked onto a stale prior "?"-turn while the interviewer had
    // already moved on to a new imperative ask). The shape signals
    // (QUESTION_MARK/INTERROGATIVE_LEAD) still matter for isFollowUp/confidence
    // scoring below, just not for WHICH turn is chosen — recency wins.
    let chosen: TranscriptTurn | null = null;
    let chosenIdx = -1;
    for (let i = cleaned.length - 1; i >= 0; i--) {
        const turn = cleaned[i];
        if (turn.role !== 'interviewer') continue;
        const text = turn.text.trim();
        if (!text) continue;
        // Check GREETING_ONLY against both the cleaned text AND the original
        // raw turn. cleanText() strips leading acknowledgement words (e.g.
        // "nice", "great") as discourse-marker noise, so "Nice to meet you"
        // cleans to "to meet you" — no longer matching the greeting pattern.
        // Falling through to the raw text catches this so a genuine greeting
        // isn't mistaken for a real (fragmentary, meaningless) question now
        // that this loop stops at the first non-greeting turn instead of
        // continuing to search for a more question-shaped one.
        const original = rawTextAt(i) || text;
        if (GREETING_ONLY.test(text) || GREETING_ONLY.test(original)) {
            ignoredTranscriptNoise.push(turn.text.trim());
            continue;
        }
        chosen = turn;
        chosenIdx = i;
        break;
    }

    if (!chosen) {
        // No interviewer turn at all — speaker unknown, nothing to answer.
        return { ...empty, relevantTranscriptWindow, ignoredTranscriptNoise };
    }

    // SHAPE SCORING runs on the CLEANED text; the EMITTED question is the RAW
    // interviewer utterance.
    //
    // These must be different strings. cleanText() lowercases everything and
    // strips leading/trailing discourse markers *including their punctuation*,
    // so emitting the cleaned text handed downstream consumers a mangled
    // question: "PostgreSQL"/"Kafka"/"React" arrived case-flattened in the
    // retrieval query and the prompt, and "…for three years, right?" lost its
    // terminal '?' along with the stripped "right". Both the résumé lookup
    // (toCandidateFraming → orchestrator.processQuestion) and the model prompt
    // consume the returned string, so both were degraded.
    //
    // Scoring stays on the cleaned text deliberately: INTERROGATIVE_LEAD is
    // anchored at ^, so a raw "Um, what is your name?" would lose its lead
    // signal and drop from 0.95 to 0.4 confidence. Cleaning exists to make the
    // heuristics robust — it is a FILTER, not a transformation of the output.
    let scoringText = chosen.text.trim();
    let latestQuestion = rawTextAt(chosenIdx) || scoringText;
    // MID-SENTENCE SPLIT (#773), see MID_SENTENCE_TAIL. firstIdx is the first
    // turn of the joined sentence; the joins below look back from it.
    let firstIdx = chosenIdx;
    for (let j = chosenIdx - 1; j >= 0 && chosenIdx - j <= MID_SENTENCE_MAX_TURNS_BACK; j--) {
        const turn = cleaned[j];
        if (turn.role !== 'interviewer') break;
        if (Math.abs(cleaned[j + 1].timestamp - turn.timestamp) > MID_SENTENCE_MAX_GAP_MS) break;
        const text = turn.text.trim();
        const raw = rawTextAt(j) || text;
        if (!text || GREETING_ONLY.test(text) || GREETING_ONLY.test(raw) || !endsMidSentence(raw)) break;
        firstIdx = j;
    }
    if (firstIdx < chosenIdx) {
        const span = cleaned.slice(firstIdx, chosenIdx + 1);
        scoringText = span.map((t) => t.text.trim()).join(' ');
        latestQuestion = span.map((t, k) => rawTextAt(firstIdx + k) || t.text.trim()).join(' ');
    }
    // SPLIT CONSTRAINT (issue #539): "Implement an LRU cache with get and put."
    // then, after a pause, "You can assume capacity is positive." Recency picks
    // the constraint, which has no ask of its own, and the turn routes as
    // general. Join it to the interviewer ask right before it — ONE turn back,
    // only when this turn is a pure constraint (no '?', constraint lead) and the
    // previous turn is itself an ask within 30s. Anything else stays recency-only.
    const sentenceRaw = latestQuestion;
    const prevIdx = firstIdx - 1;
    const prevTurn = prevIdx >= 0 ? cleaned[prevIdx] : null;
    if (prevTurn && prevTurn.role === 'interviewer'
        && !QUESTION_MARK.test(latestQuestion) && SPLIT_CONSTRAINT_LEAD.test(scoringText)
        && Math.abs(cleaned[firstIdx].timestamp - prevTurn.timestamp) <= SPLIT_CONSTRAINT_MAX_GAP_MS) {
        const prevText = prevTurn.text.trim();
        const prevRaw = rawTextAt(prevIdx) || prevText;
        const prevIsAsk = QUESTION_MARK.test(prevRaw) || INTERROGATIVE_LEAD.test(prevText) || TASK_DIRECTIVE.test(prevText);
        if (prevIsAsk && !GREETING_ONLY.test(prevText) && !GREETING_ONLY.test(prevRaw)) {
            scoringText = `${prevText} ${scoringText}`;
            latestQuestion = `${prevRaw} ${latestQuestion}`;
        }
    }
    // GENERIC CLOSER (#741), see GENERIC_CLOSING_ASK. Walks back over the
    // interviewer's own run of turns to the stated ask, and joins all of them.
    if (latestQuestion === sentenceRaw
        && (GENERIC_CLOSING_ASK.test(scoringText) || GENERIC_CLOSING_ASK.test(latestQuestion))) {
        let anchorIdx = -1;
        for (let j = firstIdx - 1; j >= 0 && chosenIdx - j <= GENERIC_CLOSER_MAX_TURNS_BACK; j--) {
            const turn = cleaned[j];
            if (turn.role !== 'interviewer') break;
            if (Math.abs(chosen.timestamp - turn.timestamp) > GENERIC_CLOSER_MAX_SPAN_MS) break;
            const text = turn.text.trim();
            const raw = rawTextAt(j) || text;
            if (!text || GREETING_ONLY.test(text) || GREETING_ONLY.test(raw)) break;
            if (GENERIC_CLOSING_ASK.test(text) || GENERIC_CLOSING_ASK.test(raw)) continue;
            if (TASK_DIRECTIVE.test(text) || STATED_TASK_RE.test(raw) || QUESTION_MARK.test(raw)) { anchorIdx = j; break; }
        }
        if (anchorIdx >= 0) {
            const span = cleaned.slice(anchorIdx, chosenIdx + 1);
            scoringText = span.map((t) => t.text.trim()).join(' ');
            latestQuestion = span.map((t, k) => rawTextAt(anchorIdx + k) || t.text.trim()).join(' ');
        }
    }
    const hasMark = QUESTION_MARK.test(scoringText) || QUESTION_MARK.test(latestQuestion);
    const hasLead = INTERROGATIVE_LEAD.test(scoringText);
    // F9: on providers that never guarantee punctuation, the absence of '?'
    // (and of clause-separating commas) is NEUTRAL — see the clause patterns
    // above and the confidence block below.
    const punctuationUnavailable = chosen.punctuationSource === 'unavailable';
    const hasClauseInterrogative = punctuationUnavailable && !hasMark && !hasLead && (
        CLAUSE_INTERROGATIVE.test(scoringText)
        || AUX_SECOND_PERSON.test(scoringText)
        || TRAILING_WH_FRAGMENT.test(scoringText)
        || WH_NOUN_AUX.test(scoringText)
        || (scoringText.split(/\s+/).length <= 4 && SHORT_TOPIC_SHIFT.test(scoringText))
    );
    // Task directives ("Rate your SQL out of ten", "Convince me you're right
    // for this role", "Solve two sum") are imperative asks with no '?', no
    // clause-initial lead and no tell-me phrase. Unlike the clause-recovery
    // patterns this is provenance-INDEPENDENT: an imperative is imperative
    // whether or not the provider punctuates. Live session A (2026-08-20):
    // these scored 0.3 and lost the résumé on every press.
    const hasTaskDirective = TASK_DIRECTIVE.test(scoringText);

    // Follow-up detection: demonstrative-only ask, a STRONG explicit backward-
    // reference marker (unambiguous regardless of sentence length), or a WEAK
    // marker on a short turn (length-capped since a bare "that"/"this" is
    // common in ordinary fresh questions too) — AND there's a prior turn to
    // refer back to.
    const priorTurns = cleaned.slice(0, chosenIdx);
    const hasPrior = priorTurns.length > 0;
    // ANSWERABILITY FLOOR. Selection is recency-first and has no question-shape
    // requirement (deliberately — see the comment above the walk-back loop), so
    // a purely evaluative interviewer turn can become "the question":
    //
    //   interviewer: "Tell me about your distributed systems work."
    //   user:        "Sure, I built a sharded event bus…"
    //   interviewer: "Interesting, that sounds pretty solid."
    //
    // The last turn carries no '?', no interrogative lead and no imperative
    // ask, but the bare word "that" matched WEAK_FOLLOW_UP_MARKERS under the
    // 14-word cap, so it was labelled follow_up — which floors confidence at
    // 0.7 (below), clearing the 0.6 grounding gate in IntelligenceEngine — and
    // pickSalientToken's fallback produced followUpTarget "second.", so the
    // résumé was queried with "Tell me about my second."
    //
    // A weak demonstrative alone is not evidence of a question. Require real
    // interrogative or imperative shape, or an explicit backward reference.
    const isAnswerable = hasMark || hasLead
        || hasClauseInterrogative
        || hasTaskDirective
        || IMPERATIVE_ASK.test(scoringText)
        || DEMONSTRATIVE_FOLLOW_UP.test(scoringText)
        || STRONG_FOLLOW_UP_MARKERS.test(scoringText);

    const isFollowUp = hasPrior && isAnswerable && (
        DEMONSTRATIVE_FOLLOW_UP.test(scoringText) ||
        STRONG_FOLLOW_UP_MARKERS.test(scoringText) ||
        (WEAK_FOLLOW_UP_MARKERS.test(scoringText) && scoringText.split(/\s+/).length <= FOLLOW_UP_WORD_CAP)
    );

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
            const original = rawTextAt(i) || cand;
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
                const original = rawTextAt(i) || cand;
                const found = pickSalientToken(original);
                if (found) { followUpTarget = found; break; }
                const words = cand.split(/\s+/).filter(w => w.length > 4 && !CAPITALIZED_STOPWORDS.has(w.toLowerCase()));
                if (words.length > 0) { followUpTarget = words[words.length - 1]; break; }
            }
        }
    }

    const questionType: ExtractedQuestionType = isFollowUp ? 'follow_up' : classifyType(scoringText);

    // Confidence: explicit '?' + interrogative lead is strongest. A bare
    // imperative ask ("tell me about your projects") with a lead but no '?' is
    // still high. A non-question interviewer statement we fell back to is low.
    //
    // Punctuation-provenance-aware scoring (WTA audit F9/Phase 3, 2026-08-18):
    // whether a '?' CAN appear is a property of the STT provider, not the
    // utterance — only Deepgram/Google/local models guarantee punctuation
    // (see punctuationProvenance.ts). When the chosen turn is stamped
    // 'unavailable', a missing mark is NEUTRAL: an interrogative lead alone
    // scores like mark+lead. Measured before this fix (102-case selection
    // dataset, punctuation-stripped): selection unchanged, but mean
    // confidence fell 0.777 → 0.63 and 18 → 30 cases dropped below the live
    // 0.6 grounding gate — ~12% of turns silently losing profile grounding
    // on no-punctuation providers. ABSENT provenance (legacy writers, typed
    // questions) keeps byte-identical legacy scoring — this branch only
    // fires for segments stamped by the STT seam. Mirrors
    // QuestionLedger.askShape so live and shadow scoring cannot drift.
    // Core mark/lead scoring comes from the SHARED table (questionShapes.ts)
    // so the shadow ledger cannot drift from it; the 0.4 baseline and the
    // clause-interrogative recovery below are this selector's own tail.
    let confidence = 0.4;
    const coreConfidence = scoreAskShape({ hasMark, hasLead, punctuationSource: chosen.punctuationSource });
    if (coreConfidence !== null) confidence = coreConfidence;
    else if (hasClauseInterrogative) confidence = 0.75;
    else if (hasTaskDirective) confidence = 0.75;
    if (questionType !== 'general' && confidence < 0.8) confidence = 0.7;

    // Social-pleasantry down-weight: a question-shaped chit-chat turn ("did you
    // have any trouble finding parking?") should NOT clear the live speculative
    // gate (0.75) on its own. Cap below the gate UNLESS the turn also carries a
    // substantive classified type (a real question bundled after the pleasantry,
    // e.g. "...found us okay? Great — walk me through your last project."), in
    // which case classifyType already returned something other than 'general'.
    //
    // 'follow_up' counts as non-substantive here (live session A, 2026-08-20):
    // "How's your day going so far? I know it's evening over in Kochi" set
    // isFollowUp, which short-circuits classifyType to 'follow_up', so the cap
    // was skipped and small talk scored 0.95 — clearing BOTH the grounding and
    // the speculative gate. 'follow_up' is a STRUCTURAL label, not a
    // substantive topic, so it must not act as the escape hatch that only a
    // real classified topic (identity/profile/jd/negotiation/behavioral/
    // technical) was meant to open.
    const nonSubstantiveType = questionType === 'general' || questionType === 'follow_up';
    if (SOCIAL_PLEASANTRY.test(scoringText) && nonSubstantiveType) {
        confidence = Math.min(confidence, 0.5);
    }
    // Wait/hold idiom cap (see WAIT_IDIOM above): same shape as the
    // pleasantry down-weight — below both live gates unless a substantive
    // classified type says a real ask shares the turn.
    if (WAIT_IDIOM.test(scoringText) && nonSubstantiveType) {
        confidence = Math.min(confidence, 0.5);
    }

    // Answerability floor (see isAnswerable above): a turn with no question
    // shape at all must not clear the 0.6 grounding gate, and must not carry a
    // salient-token guess that would become a fabricated retrieval query.
    if (!isAnswerable) {
        confidence = Math.min(confidence, 0.3);
        followUpTarget = '';
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

// Spoken fillers that sit between the words of a repeated question ("Like, how
// long is your sprint?"). Dropped from both sides before the comparison.
const ECHO_FILLER = new Set(['like', 'um', 'umm', 'uh', 'uhh', 'erm', 'hmm', 'so', 'okay', 'ok', 'well', 'yeah', 'and']);
// Words a question is built from. A shared run made only of these ("do you have
// any", "how long is") says nothing about WHAT is asked, so it never makes an echo.
const ECHO_FRAME = new Set([
    'what', 'which', 'how', 'who', 'whom', 'when', 'where', 'why', 'long', 'many', 'much', 'often',
    'be', 'do', 'does', 'did', 'have', 'has', 'had', 'can', 'could', 'would', 'should', 'will', 'not',
    'a', 'an', 'the', 'any', 'some', 'of', 'to', 'in', 'on', 'for', 'at', 'with', 'about', 'from', 'or', 'but',
    'poss', 'you', 'i', 'we', 'they', 'he', 'she', 'it', 'me', 'us', 'them', 'this', 'that', 'there', 'these', 'those',
]);
const ECHO_QUESTION_START = /^(?:what|which|how|who|whom|when|where|why|do|does|did|is|are|was|were|can|could|would|should|will|have|has)\b/;

/**
 * Words of one spoken line, normalised so a question said back in the
 * speaker's own way still matches: "what's" = "what is", is/are/was/were are one
 * word, "your"/"our"/"my"/"their" are one word ("how long is OUR sprint" said
 * back to "how long is YOUR sprint"), and a plural matches its singular.
 */
function echoWords(text: string): string[] {
    return String(text ?? '')
        .toLowerCase()
        .replace(/[’‘]/g, "'")
        .replace(/\b(what|how|who|where|when|that|it|there|here)'s\b/g, '$1 is')
        .replace(/n't\b/g, ' not')
        .replace(/'re\b/g, ' are')
        .replace(/'ve\b/g, ' have')
        .replace(/'ll\b/g, ' will')
        .replace(/'d\b/g, ' would')
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .split(/\s+/)
        .filter((w) => w && !ECHO_FILLER.has(w))
        .map((w) => {
            if (w === 'is' || w === 'are' || w === 'was' || w === 'were' || w === 'am') return 'be';
            if (w === 'your' || w === 'our' || w === 'my' || w === 'their') return 'poss';
            return w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
        })
        .slice(0, 80);
}

/** Sentences of a line, each with whether it was said as a question. */
function echoSentences(text: string): Array<{ words: string[]; asked: boolean }> {
    return (String(text ?? '').match(/[^?.!;\n…]+[?.!;\n…]*/g) ?? [])
        .map((raw) => {
            const words = echoWords(raw);
            return { words, asked: /\?/.test(raw) || ECHO_QUESTION_START.test(words.join(' ')) };
        })
        .filter((s) => s.words.length > 0);
}

/** The longest run of consecutive words two lines share, and its position in `a`. */
function longestSharedRun(a: string[], b: string[]): { length: number; end: number } {
    let best = { length: 0, end: 0 };
    let prev = new Array<number>(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
        const row = new Array<number>(b.length + 1).fill(0);
        for (let j = 1; j <= b.length; j++) {
            if (a[i - 1] === b[j - 1]) {
                row[j] = prev[j - 1] + 1;
                if (row[j] > best.length) best = { length: row[j], end: i };
            }
        }
        prev = row;
    }
    return best;
}

/** Whether one sentence of the user's repeats one sentence of the other party's. */
function sentenceRepeats(user: string[], other: string[]): boolean {
    if (user.length < 3 || other.length < 3) return false;
    const run = longestSharedRun(user, other);
    if (run.length < 3) return false;
    if (user.slice(run.end - run.length, run.end).every((w) => ECHO_FRAME.has(w))) return false;
    return run.length >= 5 || run.length / other.length >= 2 / 3;
}

/**
 * Whether the user's line REPEATS the other party's question rather than
 * asking one of its own (issue #777, 2026-11-21). A candidate often says the
 * question back while thinking: asked "how long is your sprint typically?",
 * they said "Like, how long is your sprint? We... Our our our sprint". On a
 * manual press that line passed as the user's own newer question, the prompt
 * then said the user asked it, and "your sprint" came back as the
 * interviewer's: "I'd want to understand how your team runs them".
 *
 * Each question the user asks in the line must repeat a sentence the other
 * party said (`otherPartyText` may hold several of their turns): a shared run
 * of words that holds a real word, not only question frame ("do you have
 * any"), and covers two thirds of that sentence or five words. A line with an
 * echo AND a question of the user's own is not an echo, and neither is a
 * question that only opens the same way ("what is the biggest risk in the
 * plan?" after "what is the biggest challenge you faced?").
 */
export function isEchoOfOtherPartyQuestion(userText: string, otherPartyText: string): boolean {
    const other = echoSentences(otherPartyText);
    const userSentences = echoSentences(userText);
    if (!other.length || !userSentences.length) return false;
    const asked = userSentences.filter((s) => s.asked);
    const checked = asked.length ? asked : [{ words: userSentences.flatMap((s) => s.words), asked: false }];
    return checked.every((u) => other.some((o) => sentenceRepeats(u.words, o.words)));
}

/**
 * What the other party said since the user last spoke, before turn `userIndex`
 * (up to four of their turns), plus the question already picked. The question
 * the user may be repeating is not always the other party's LAST turn: "how
 * long is your sprint typically?" can be followed by "take your time".
 */
export function otherPartyLinesBefore(
    turns: ReadonlyArray<{ role: string; text?: unknown }>,
    userIndex: number,
    pickedQuestion?: string | null,
): string {
    const said: string[] = [];
    for (let i = userIndex - 1; i >= 0 && said.length < 4; i--) {
        const t = turns[i];
        if (t.role === 'user') { if (said.length) break; continue; }
        const text = String(t.text ?? '').trim();
        if (t.role === 'interviewer' && text) said.push(text);
    }
    if (String(pickedQuestion ?? '').trim()) said.push(String(pickedQuestion).trim());
    return said.join('\n');
}
