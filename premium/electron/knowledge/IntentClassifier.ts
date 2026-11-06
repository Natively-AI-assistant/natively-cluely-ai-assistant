// electron/knowledge/IntentClassifier.ts
// Lightweight keyword + pattern-based intent detection for routing queries

import { IntentType } from './types';

// Pattern sets for each intent type
export const INTRO_PATTERNS = [
    'introduce yourself',
    'introducing yourself',
    'tell me about yourself',
    'who are you',
    'what do you do',
    'describe yourself',
    'about yourself',
    'walk me through your background',
    'brief introduction',
    'quick introduction',
    'short introduction',
    'self introduction',
    'give me your introduction',
    // hyphenated + short-form intro asks — this is the MASTER gate: classifyIntent
    // must return IntentType.INTRO for these or the entire intro-grounding path is
    // bypassed (KnowledgeOrchestrator only builds an introResponse when intent is
    // INTRO), and the live answer degrades to "I don't have a resume loaded" /
    // "could you run that again". Real-backend E2E campaign round 13/14/15,
    // F-VOICE live path (p01/p02/p04/p08/p10 Q1). Must mirror ContextAssembler's
    // INTRO_PATTERNS. Intro-anchored substrings only (contain "intro"/"yourself")
    // so substantive "give me a brief summary of your project" is not captured.
    'self-introduction',
    'self-intro',
    'self intro',
    'brief intro',
    'quick intro',
    'short intro',
    'little intro',
    'introduction of yourself',
    'introduction of who you are',
    'a little about yourself',
    'bit about yourself'
];

const COMPANY_RESEARCH_PATTERNS = [
    'company', 'about the company', 'hiring strategy', 'hiring style',
    'interview process', 'work culture', 'competitor', 'competitors',
    'funding', 'layoffs', 'glassdoor', 'levels.fyi', 'reviews',
    'what is it like to work at', 'tell me about the company'
];

const NEGOTIATION_PATTERNS = [
    'salary', 'compensation', 'package', 'negotiate', 'negotiation',
    'offer', 'counter offer', 'counteroffer', 'ctc', 'equity',
    'stock options', 'signing bonus', 'joining bonus', 'benefits package',
    'what should i ask', 'expected salary', 'expected ctc', 'salary range',
    'how much should', 'market rate', 'pay range', 'base salary',
    // High-signal phrasings that recur in a live comp conversation but lack the
    // obvious "salary" token. Kept SPECIFIC to avoid false positives — generic
    // tokens like "worth", "the number", "comp ", bare "pay"/"bonus" were
    // removed because they collide with non-comp questions ("is it worth
    // learning Rust", "the number of users", "comp sci"). Soft follow-up signals
    // ("the number", "your range") live in NEGOTIATION_FOLLOWUP_SIGNALS below and
    // only count when a comp thread is already active.
    'expected salary', 'expected compensation', 'how much are you looking',
    'how much do you want', 'what are you expecting for', 'looking for in terms of',
    'remuneration', 'last salary', 'current salary', 'current ctc', 'previous salary',
    'notice period', 'how much money', 'salary expectation', 'salary expectations',
    'pay expectation', 'pay expectations', 'compensation expectation',
];

// Soft, ambiguous follow-up signals — these do NOT classify negotiation on their
// own (they collide with non-comp questions), but WHEN a comp thread is already
// active they confirm the follow-up is still about compensation. Used only by
// classifyIntentWithContext, never by the base scorer.
const NEGOTIATION_FOLLOWUP_SIGNALS = [
    'expectation', 'expectations', 'the number', 'a number', 'number in mind',
    'your range', 'the range', 'a range', 'how much', 'how about', 'what works for you',
    'flexible', 'budget', 'pay', 'bonus', 'worth', 'figure', 'come down', 'go higher',
    'meet in the middle', 'works for both', 'open to',
];

// Whole-word matchers for the signals above. A substring test made "pay" match
// "payout", "payments" and "PayPal", "worth" match "worthwhile" — technical
// questions in a fintech or logistics interview stuck to the salary thread.
const NEGOTIATION_FOLLOWUP_SIGNAL_RES = NEGOTIATION_FOLLOWUP_SIGNALS.map(
    s => new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
);

// Skill SELF-RATING phrasings — a candidate rating their own proficiency. These
// must NEVER be treated as a negotiation follow-up even when they carry a soft
// comp token like "how much" / "out of" (live regression 2026-06-05: "out of 10,
// how much would you rate yourself?" fired the salary script). Mirrors the
// AnswerPlanner SKILL_RATING_PATTERNS so both classifiers agree.
const SKILL_RATING_REGEX = /\b(rate|assess)\s+(your|my)self\b|\bhow would (you|i) rate\b|\bhow\s+(good|skilled|proficient|strong|experienced|comfortable|confident)\s+(are|am)\s+(you|i)\b|\b(coding|skill|skills|technical|proficiency)\s+levels?\b|\bon a scale\b|\brate\s+(yourself|myself|your skills?|my skills?)\b|\b(your|my)\s+(expertise|proficiency|competency)\s+(in|with|level)\b/i;

// Core comp words used for the garbled/typo rescue (Phase 2, looksLikeGarbledComp).
// A question token that's a near-miss (edit distance 1-2) of one of these — i.e.
// a likely STT/typo garble like "slalary"/"salery"/"compensaton" — but NOT an
// exact comp keyword (those are handled by the keyword scorer) is treated as a
// comp turn. Kept to high-salience, low-collision words so the edit-distance
// check has no false positives across general/technical vocabulary.
//
// NOTE: an earlier design routed near-misses to a zero-shot SLM for a final
// semantic call. That was removed after empirical testing: mobilebert-mnli MISSED
// the real garble ("slalary" → 0.18) and false-fired on unrelated tech terms
// ("hashmap" → 0.82), while this deterministic gate scored 10/10 on real typos
// with zero false positives over a 133-word vocabulary. The gate is now the
// terminal verdict, not an advisory pre-filter.
const FUZZY_COMP_WORDS = ['salary', 'compensation', 'remuneration', 'negotiate', 'negotiation'];

function levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        const cur = [i];
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        }
        prev = cur;
    }
    return prev[n];
}

/**
 * Phase 2 terminal classifier: does this question contain a token that's a
 * NEAR-MISS of a core comp word (likely garbled STT/typo) without being an exact
 * comp keyword? When true, the orchestrator routes an otherwise-GENERAL turn to
 * NEGOTIATION. Allowed edit distance scales with word length (1 for short words,
 * 2 for longer) and we require a length-similar token to avoid matching short
 * common words. Returns false when the base classifier would already catch it
 * (exact comp keyword present). Deterministic — no model call.
 */
export function looksLikeGarbledComp(question: string): boolean {
    const q = question.toLowerCase();
    // If an exact comp keyword is present, the sync scorer already handles it.
    if (NEGOTIATION_PATTERNS.some(p => q.includes(p))) return false;
    const tokens = q.split(/[^a-z]+/).filter(t => t.length >= 4);
    for (const tok of tokens) {
        for (const word of FUZZY_COMP_WORDS) {
            if (tok === word) continue; // exact handled elsewhere
            if (Math.abs(tok.length - word.length) > 2) continue;
            const maxDist = word.length >= 8 ? 2 : 1;
            if (levenshtein(tok, word) <= maxDist) return true;
        }
    }
    return false;
}

const TECHNICAL_PATTERNS = [
    'explain', 'how does', 'what is', 'difference between',
    'implement', 'design', 'architecture', 'algorithm', 'data structure',
    'system design', 'trade-off', 'tradeoff', 'pros and cons',
    'best practice', 'when to use', 'how to', 'example of',
    'code', 'debug', 'optimize', 'performance'
];

const PROFILE_DETAIL_PATTERNS = [
    'project', 'projects', 'what have you built', 'what did you build',
    'what have you worked on', 'side project',
    'education', 'degree', 'university', 'college', 'school', 'studied',
    'certification', 'certifications', 'certified',
    'achievement', 'achievements', 'award', 'awards',
    'leadership', 'volunteer',
    'skill', 'skills', 'tech stack', 'technologies you know',
    'your background', 'your experience', 'my experience', 'work history',
    'roles', 'previous roles', 'past roles', 'companies you worked',
    'summarize my', 'summarise my',
    // Skill SELF-RATING / proficiency phrasings (live fix 2026-06-05): these are
    // the candidate describing their own skill level, so they must route to
    // PROFILE_DETAIL → the orchestrator grounds in the structured resume skills /
    // full profile (applyFullProfileGrounding fires for PROFILE_DETAIL) instead of
    // answering from persona/custom-context alone or falling to blind retrieval.
    'expertise', 'proficiency', 'proficient', 'competency', 'competencies',
    'rate your', 'rate yourself', 'rate my', 'how would you rate', 'how good are you',
    'how skilled', 'how experienced are you', 'how comfortable are you',
    'coding level', 'coding levels', 'skill level', 'skill levels', 'on a scale',
    'familiar with', 'comfortable with',
];

/**
 * Classify the intent of a user question.
 * Returns the most likely intent type based on keyword matching.
 */
export function classifyIntent(question: string): IntentType {
    const q = question.toLowerCase().trim();

    // Check intro first (most specific)
    if (INTRO_PATTERNS.some(p => q.includes(p))) {
        return IntentType.INTRO;
    }
    return classifyIntentBody(q);
}

/**
 * Context-aware classification. Adds CONVERSATIONAL STICKINESS for negotiation:
 * once a comp/offer topic is active (the live NegotiationConversationTracker is
 * running, or a recent turn was negotiation), ambiguous follow-ups like "what
 * are your expectations?", "give me the number", "and your range?" — which carry
 * no salary keyword in isolation and would otherwise fall to GENERAL — stay
 * NEGOTIATION so the salary intelligence keeps applying. Identity/intro and
 * clearly-generic/technical questions still override (you can always change topic).
 */
export function classifyIntentWithContext(
    question: string,
    ctx?: {
        negotiationActive?: boolean;
        recentIntentWasNegotiation?: boolean;
        /**
         * Transcript-aware signal (Phase 1): the last 1-2 INTERVIEWER turns in the
         * rolling ~180s window carried comp evidence (a $/Nk amount or a salary
         * keyword). This ACTIVATES the comp thread even in paths where the live
         * NegotiationConversationTracker isn't fed interviewer STT (e.g. typed
         * chat), so a follow-up can be recognized. It does NOT blanket-stick: an
         * ambiguous turn still needs an affirmative follow-up signal below.
         */
        recentInterviewerComp?: boolean;
    },
): IntentType {
    const base = classifyIntent(question);
    if (base !== IntentType.GENERAL) return base;            // a confident classification wins

    // The comp thread is "live" if the tracker is running, a recent turn was
    // negotiation, OR the interviewer just raised comp (transcript hint).
    const threadActive = Boolean(
        ctx?.negotiationActive || ctx?.recentIntentWasNegotiation || ctx?.recentInterviewerComp,
    );
    if (!threadActive) return base;

    // We're in a negotiation thread and this turn is ambiguous (GENERAL). Stick
    // to NEGOTIATION only when the turn carries an AFFIRMATIVE comp follow-up
    // signal — a soft comp token ("the number", "your range", "how much", "pay"),
    // OR a very short pronoun-y reply that's clearly continuing the exchange
    // ("and you?", "go on", "okay?"). This is deliberately the inverse of a
    // denylist: we do NOT blanket-stick every GENERAL turn (that wrongly captured
    // behavioral/fit asks like "why am I a good fit" / "what are my strengths"
    // for the whole window). A substantive non-comp question simply falls through
    // to GENERAL and is handled normally — even mid-thread.
    const q = question.toLowerCase().trim();
    // SKILL SELF-RATING guard (live regression 2026-06-05): a question asking the
    // candidate to rate their own skill/proficiency ("rate yourself out of 10",
    // "how good are you at X", "your coding levels", "on a scale of 1-10") often
    // contains a soft comp follow-up token ("how much", "a number", "out of") and
    // wrongly stuck to NEGOTIATION mid-thread — firing the salary script for a
    // skills question. A self-rating is never compensation: never stick it.
    if (SKILL_RATING_REGEX.test(q)) return base;
    const hasFollowupSignal = NEGOTIATION_FOLLOWUP_SIGNAL_RES.some(re => re.test(q));
    const isShortContinuation = q.split(/\s+/).length <= 4 &&
        /\b(and|so|ok|okay|then|now|you|that|this|it|sure|yeah|fine|hmm)\b/.test(q);
    if (hasFollowupSignal || isShortContinuation) return IntentType.NEGOTIATION;
    return base;
}

function classifyIntentBody(q: string): IntentType {

    // Identity-direct questions (name, role, employer) always treated as intro-level
    // Grounding-campaign fix (2026-07-17): 'what company'/'which company' in
    // IDENTITY_DIRECT_PATTERNS was meant for the candidate's OWN employer
    // ("what company do you work for") but also matched a JD-framed question
    // ABOUT THE TARGET ROLE ("what company IS THIS ROLE at?") — confirmed live
    // (test/harness case C4-002): this forced INTRO intent, which produces only
    // a compact identity block (~118 chars) instead of the real JD text, so a
    // pure factual "what company/comp range does the JD state" lookup got a
    // false refusal even though the JD literally states both. A JD-referencing
    // frame ("this/the role/job/position/posting/listing/opening") after the
    // company keyword means the question is about the ROLE, not the candidate.
    const EXPERIENCE_BARE_PATTERNS = new Set([
        'how much experience', 'how many years of experience',
        'what is my experience', 'whats my experience', "what's my experience",
        'what is my background', 'whats my background', "what's my background",
    ]);
    const isCompanyIdentityPattern = (p: string) => {
        if (p === 'what company' || p === 'which company') return q.includes(p) && !JD_ROLE_FRAME_RE.test(q);
        if (EXPERIENCE_BARE_PATTERNS.has(p)) return q.includes(p) && !EXPERIENCE_TOPIC_SCOPED_RE.test(q);
        return q.includes(p);
    };
    if (IDENTITY_DIRECT_PATTERNS.some(isCompanyIdentityPattern)) {
        return IntentType.INTRO;
    }

    // Robust name-question detector. IDENTITY_DIRECT_PATTERNS only lists exact
    // phrasings ("what is my name"), so common live variants slip through and
    // get mis-routed to TECHNICAL via the "what is" keyword: "what is my full
    // name?", "can you tell me your name?", "may I have your name?", "your full
    // name?". Any question that asks for a (my/your) name — and is NOT asking
    // for a company/project/tool/file "name" — is an identity question.
    if (NAME_QUESTION_REGEX.test(q) && !NAME_OF_THING_REGEX.test(q)) {
        return IntentType.INTRO;
    }

    // Direct Project match heuristics
    // If the question is short (<= 8 words) and just asks "what is [ProjectName]" or "[ProjectName]"
    // and that word isn't a common English word (cheap heuristic: capitalized in original, or part of a noun phrase),
    // we want to strongly hint PROFILE_DETAIL so the orchestrator routes to the fast path.
    // We don't have the resume here, so we just boost PROFILE_DETAIL if it looks like a direct noun ask
    // that isn't caught by generic technical patterns.
    if (q.split(' ').length <= 6 && !TECHNICAL_PATTERNS.some(p => q.includes(p)) && q.startsWith('what is ')) {
        return IntentType.PROFILE_DETAIL;
    }

    // Score each intent
    const scores: Record<IntentType, number> = {
        [IntentType.TECHNICAL]: 0,
        [IntentType.INTRO]: 0,
        [IntentType.COMPANY_RESEARCH]: 0,
        [IntentType.NEGOTIATION]: 0,
        [IntentType.PROFILE_DETAIL]: 0,
        [IntentType.GENERAL]: 0
    };

    for (const pattern of COMPANY_RESEARCH_PATTERNS) {
        if (q.includes(pattern)) scores[IntentType.COMPANY_RESEARCH]++;
    }

    for (const pattern of NEGOTIATION_PATTERNS) {
        if (q.includes(pattern)) scores[IntentType.NEGOTIATION]++;
    }

    for (const pattern of TECHNICAL_PATTERNS) {
        if (q.includes(pattern)) scores[IntentType.TECHNICAL]++;
    }

    for (const pattern of PROFILE_DETAIL_PATTERNS) {
        if (q.includes(pattern)) scores[IntentType.PROFILE_DETAIL]++;
    }

    // Find highest scoring intent
    const maxScore = Math.max(
        scores[IntentType.COMPANY_RESEARCH],
        scores[IntentType.NEGOTIATION],
        scores[IntentType.TECHNICAL],
        scores[IntentType.PROFILE_DETAIL]
    );

    if (maxScore === 0) return IntentType.GENERAL;

    // Priority: profile_detail > negotiation > company_research > technical (when scores tie)
    if (scores[IntentType.PROFILE_DETAIL] === maxScore) return IntentType.PROFILE_DETAIL;
    if (scores[IntentType.NEGOTIATION] === maxScore) return IntentType.NEGOTIATION;
    if (scores[IntentType.COMPANY_RESEARCH] === maxScore) return IntentType.COMPANY_RESEARCH;
    if (scores[IntentType.TECHNICAL] === maxScore) return IntentType.TECHNICAL;

    return IntentType.GENERAL;
}

/**
 * Check if the question needs company research (for use in orchestrator).
 */
export function needsCompanyResearch(question: string): boolean {
    const intent = classifyIntent(question);
    return intent === IntentType.COMPANY_RESEARCH || intent === IntentType.NEGOTIATION;
}

// Second-person / candidate-referring tokens. If ANY of these appear in the
// question, treat it as a candidate-directed question and let the persona run.
// Word-boundary matched to avoid hitting "your" inside e.g. "yourself.com" or
// "you" inside "youtube" (not realistic but cheap to guard).
// Includes bare "i"/"i've"/"i'm"/etc — "what do I do", "what have I built" are
// unambiguously candidate-directed but were missed when only "me/my/mine/
// myself" counted, so they fell through to isGenericKnowledgeQuestion's
// GENERIC_QUESTION_PATTERNS ('what do ' matches "what do I do") and got
// answered as generic assistant capability text with zero profile grounding
// (live bug report 2026-07-04: "what do i do" → "I can help you summarize
// meetings..."). Mirrors the identical fix already applied to
// CANDIDATE_FRAMING_REGEX below for the same reason.
const CANDIDATE_REF_REGEX = /\b(i|i've|i'm|i'd|i'll|you|your|yours|yourself|you've|you're|you'd|you'll|ya|we|our|ours|ourselves|us|me|my|mine|myself)\b/i;

// A question that asks for a person's name. Matches "my/your name", "my/your
// full name", "your name please", "tell me your name", "may I have your name".
// Word-boundary anchored on the personal possessive so it won't fire on
// "the name of your project".
const NAME_QUESTION_REGEX = /\b(my|your)\s+(full\s+|first\s+|last\s+|complete\s+)?name\b|\bname,?\s*(please|again)\b|\b(tell me|give me|have|spell)\s+(me\s+)?(your|the candidate'?s)\s+name\b/i;

// Disqualifier: the question is about the NAME OF A THING (company/project/tool/
// product/file/repo/model), not the person. Keeps "what's the name of your
// company/project" out of the identity fast-path.
const NAME_OF_THING_REGEX = /\bname\s+of\s+(the|your|that|this|a|an)\s+(company|project|product|tool|app|application|file|repo|repository|model|framework|library|service|system|team|role|position)\b|\b(company|project|product|tool|app|file|repo|model|framework|library|service|system)\s+name\b/i;

// Disqualifier for the 'what company'/'which company' IDENTITY_DIRECT_PATTERNS
// entries: a JD-referencing frame ("this/the role/job/position/posting/
// listing/opening") means the question is about the TARGET ROLE's company,
// not the candidate's own employer.
const JD_ROLE_FRAME_RE = /\b(this|the)\s+(role|job|position|posting|listing|opening)\b/i;

// Disqualifier for the 'how much experience'/'what is my experience'/'what is
// my background' IDENTITY_DIRECT_PATTERNS entries (grounding-campaign2 fix,
// 2026-07-17). These were meant for a BARE experience-level lookup ("what's my
// experience?", "how much experience do you have?") but also matched a
// TOPIC-SCOPED experience question after IntelligenceEngine's toCandidateFraming
// rewrites "your"→"my" ("what's YOUR experience mentoring engineers?" becomes
// "what's MY experience mentoring engineers?" before reaching this classifier)
// — live-confirmed on the real backend (test/harness-longsession script-a press
// A11): this forced INTRO intent → "Direct Identity Fact match" → only ~95
// chars of compact identity block instead of the résumé's actual mentoring
// bullet, so a specific mentoring question got a vague non-answer even though
// the resume states "Mentored 4 engineers through promotion to senior...". A
// following topic word (mentoring/leading/a skill/tech/domain via
// in/with/on/for/at/as) means the question asks about experience IN
// SOMETHING SPECIFIC — profile_detail territory, not a bare identity lookup.
const EXPERIENCE_TOPIC_SCOPED_RE = /\b(experience|background)\b[\w\s,']{0,30}\b(mentoring|leading|managing|building|designing|architecting|working|using|doing|running|handling|driving|overseeing|coordinating|in|with|on|for|at|as)\s+\S/i;

// Identity direct patterns — these always trigger the persona path regardless
// of intent score, because they are unambiguously about the candidate's personal
// facts (name, role, employer, experience level, etc.)
export const IDENTITY_DIRECT_PATTERNS = [
    'what is my name', 'whats my name', 'what\'s my name',
    'who am i', 'who am I',
    'what is my role', 'whats my role', 'what\'s my role',
    'what role am i', 'what role am I',
    'what is my job', 'whats my job', 'what\'s my job',
    'where do i work', 'where do I work', 'where am i working',
    'what company', 'which company',
    'what is my current', 'whats my current', 'what\'s my current',
    'how much experience', 'how many years of experience',
    'what is my background', 'whats my background', "what's my background",
    'my current role', 'my current job', 'my current position',
    'what is my experience', 'whats my experience', "what's my experience",
];

// Phrases that are unambiguously generic-knowledge or generic-coding asks.
// All matched as substrings on the lowercased, trimmed question.
const GENERIC_QUESTION_PATTERNS = [
    'what is a ', 'what is an ', 'what is the ', 'what are ',
    "what's a ", "what's an ", "what's the ",
    'what does ', 'what do ',
    'define ', 'definition of ',
    'explain ', 'explanation of ',
    'describe a ', 'describe an ', 'describe the ',
    'how does ', 'how do i ', 'how to ',
    'difference between ', 'differences between ',
    'compare ', 'comparison of ', 'vs ',
    'give me an example of ', 'example of ', 'show me how ',
    'write the code for ', 'write code for ', 'write a function ',
    'write a program ', 'write a script ',
    'implement a ', 'implement the ',
    'code for ', 'code to ', 'function to ', 'function that ',
    'program to ', 'program that ', 'script to ',
    'pros and cons of ', 'trade-offs of ', 'tradeoffs of ',
    'when to use ', 'when should i use ',
];

/**
 * Returns true when the question is a generic definitional, comparison, or
 * coding-task ask with NO candidate framing (no "you / your / we / our").
 *
 * Used as a gate in front of the knowledge / persona pipeline: when a user
 * types something like "what is an API" or "write the code for odd even",
 * we don't want to wrap the answer in the candidate's first-person voice
 * or retrieve resume nodes — those answers should fall back to the base
 * assistant prompt.
 *
 * Returns false the moment any second-person token appears, so
 * "what is your experience with APIs?" / "explain how you used Redis"
 * still go through the persona path.
 */
export function isGenericKnowledgeQuestion(question: string): boolean {
    const q = question.toLowerCase().trim();
    if (!q) return false;

    // Any candidate-referring token disqualifies — this is being asked of the
    // candidate, not as a generic concept question.
    if (CANDIDATE_REF_REGEX.test(q)) return false;

    // Identity-direct questions (name, role, company) always go through persona path
    if (IDENTITY_DIRECT_PATTERNS.some(p => q.includes(p))) return false;

    // Intro requests are handled separately downstream — never treat them as
    // generic-knowledge.
    if (INTRO_PATTERNS.some(p => q.includes(p))) return false;

    return GENERIC_QUESTION_PATTERNS.some(p => q.includes(p));
}
