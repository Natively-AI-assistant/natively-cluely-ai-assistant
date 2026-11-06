// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var INTRO_PATTERNS = [
    "introduce yourself",
    "introducing yourself",
    "tell me about yourself",
    "who are you",
    "what do you do",
    "describe yourself",
    "about yourself",
    "walk me through your background",
    "brief introduction",
    "quick introduction",
    "short introduction",
    "self introduction",
    "give me your introduction",
    // hyphenated + short-form intro asks — this is the MASTER gate: classifyIntent
    // must return IntentType.INTRO for these or the entire intro-grounding path is
    // bypassed (KnowledgeOrchestrator only builds an introResponse when intent is
    // INTRO), and the live answer degrades to "I don't have a resume loaded" /
    // "could you run that again". Real-backend E2E campaign round 13/14/15,
    // F-VOICE live path (p01/p02/p04/p08/p10 Q1). Must mirror ContextAssembler's
    // INTRO_PATTERNS. Intro-anchored substrings only (contain "intro"/"yourself")
    // so substantive "give me a brief summary of your project" is not captured.
    "self-introduction",
    "self-intro",
    "self intro",
    "brief intro",
    "quick intro",
    "short intro",
    "little intro",
    "introduction of yourself",
    "introduction of who you are",
    "a little about yourself",
    "bit about yourself"
];
var COMPANY_RESEARCH_PATTERNS = [
    "company",
    "about the company",
    "hiring strategy",
    "hiring style",
    "interview process",
    "work culture",
    "competitor",
    "competitors",
    "funding",
    "layoffs",
    "glassdoor",
    "levels.fyi",
    "reviews",
    "what is it like to work at",
    "tell me about the company"
];
var NEGOTIATION_PATTERNS = [
    "salary",
    "compensation",
    "package",
    "negotiate",
    "negotiation",
    "offer",
    "counter offer",
    "counteroffer",
    "ctc",
    "equity",
    "stock options",
    "signing bonus",
    "joining bonus",
    "benefits package",
    "what should i ask",
    "expected salary",
    "expected ctc",
    "salary range",
    "how much should",
    "market rate",
    "pay range",
    "base salary",
    // High-signal phrasings that recur in a live comp conversation but lack the
    // obvious "salary" token. Kept SPECIFIC to avoid false positives — generic
    // tokens like "worth", "the number", "comp ", bare "pay"/"bonus" were
    // removed because they collide with non-comp questions ("is it worth
    // learning Rust", "the number of users", "comp sci"). Soft follow-up signals
    // ("the number", "your range") live in NEGOTIATION_FOLLOWUP_SIGNALS below and
    // only count when a comp thread is already active.
    "expected salary",
    "expected compensation",
    "how much are you looking",
    "how much do you want",
    "what are you expecting for",
    "looking for in terms of",
    "remuneration",
    "last salary",
    "current salary",
    "current ctc",
    "previous salary",
    "notice period",
    "how much money",
    "salary expectation",
    "salary expectations",
    "pay expectation",
    "pay expectations",
    "compensation expectation"
];
var NEGOTIATION_FOLLOWUP_SIGNALS = [
    "expectation",
    "expectations",
    "the number",
    "a number",
    "number in mind",
    "your range",
    "the range",
    "a range",
    "how much",
    "how about",
    "what works for you",
    "flexible",
    "budget",
    "pay",
    "bonus",
    "worth",
    "figure",
    "come down",
    "go higher",
    "meet in the middle",
    "works for both",
    "open to"
];
var NEGOTIATION_FOLLOWUP_SIGNAL_RES = NEGOTIATION_FOLLOWUP_SIGNALS.map((s) => new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`));
var SKILL_RATING_REGEX = /\b(rate|assess)\s+(your|my)self\b|\bhow would (you|i) rate\b|\bhow\s+(good|skilled|proficient|strong|experienced|comfortable|confident)\s+(are|am)\s+(you|i)\b|\b(coding|skill|skills|technical|proficiency)\s+levels?\b|\bon a scale\b|\brate\s+(yourself|myself|your skills?|my skills?)\b|\b(your|my)\s+(expertise|proficiency|competency)\s+(in|with|level)\b/i;
var FUZZY_COMP_WORDS = ["salary", "compensation", "remuneration", "negotiate", "negotiation"];
function levenshtein(a, b) {
    if (a === b)
        return 0;
    const m = a.length, n = b.length;
    if (m === 0)
        return n;
    if (n === 0)
        return m;
    let prev = new Array(n + 1);
    for (let j = 0; j <= n; j++)
        prev[j] = j;
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
function looksLikeGarbledComp(question) {
    const q = question.toLowerCase();
    if (NEGOTIATION_PATTERNS.some((p) => q.includes(p)))
        return false;
    const tokens = q.split(/[^a-z]+/).filter((t) => t.length >= 4);
    for (const tok of tokens) {
        for (const word of FUZZY_COMP_WORDS) {
            if (tok === word)
                continue;
            if (Math.abs(tok.length - word.length) > 2)
                continue;
            const maxDist = word.length >= 8 ? 2 : 1;
            if (levenshtein(tok, word) <= maxDist)
                return true;
        }
    }
    return false;
}
var TECHNICAL_PATTERNS = [
    "explain",
    "how does",
    "what is",
    "difference between",
    "implement",
    "design",
    "architecture",
    "algorithm",
    "data structure",
    "system design",
    "trade-off",
    "tradeoff",
    "pros and cons",
    "best practice",
    "when to use",
    "how to",
    "example of",
    "code",
    "debug",
    "optimize",
    "performance"
];
var PROFILE_DETAIL_PATTERNS = [
    "project",
    "projects",
    "what have you built",
    "what did you build",
    "what have you worked on",
    "side project",
    "education",
    "degree",
    "university",
    "college",
    "school",
    "studied",
    "certification",
    "certifications",
    "certified",
    "achievement",
    "achievements",
    "award",
    "awards",
    "leadership",
    "volunteer",
    "skill",
    "skills",
    "tech stack",
    "technologies you know",
    "your background",
    "your experience",
    "my experience",
    "work history",
    "roles",
    "previous roles",
    "past roles",
    "companies you worked",
    "summarize my",
    "summarise my",
    // Skill SELF-RATING / proficiency phrasings (live fix 2026-06-05): these are
    // the candidate describing their own skill level, so they must route to
    // PROFILE_DETAIL → the orchestrator grounds in the structured resume skills /
    // full profile (applyFullProfileGrounding fires for PROFILE_DETAIL) instead of
    // answering from persona/custom-context alone or falling to blind retrieval.
    "expertise",
    "proficiency",
    "proficient",
    "competency",
    "competencies",
    "rate your",
    "rate yourself",
    "rate my",
    "how would you rate",
    "how good are you",
    "how skilled",
    "how experienced are you",
    "how comfortable are you",
    "coding level",
    "coding levels",
    "skill level",
    "skill levels",
    "on a scale",
    "familiar with",
    "comfortable with"
];
function classifyIntent(question) {
    const q = question.toLowerCase().trim();
    if (INTRO_PATTERNS.some((p) => q.includes(p))) {
        return "intro" /* INTRO */;
    }
    return classifyIntentBody(q);
}
function classifyIntentWithContext(question, ctx) {
    const base = classifyIntent(question);
    if (base !== "general" /* GENERAL */)
        return base;
    const threadActive = Boolean(ctx?.negotiationActive || ctx?.recentIntentWasNegotiation || ctx?.recentInterviewerComp);
    if (!threadActive)
        return base;
    const q = question.toLowerCase().trim();
    if (SKILL_RATING_REGEX.test(q))
        return base;
    const hasFollowupSignal = NEGOTIATION_FOLLOWUP_SIGNAL_RES.some((re) => re.test(q));
    const isShortContinuation = q.split(/\s+/).length <= 4 && /\b(and|so|ok|okay|then|now|you|that|this|it|sure|yeah|fine|hmm)\b/.test(q);
    if (hasFollowupSignal || isShortContinuation)
        return "negotiation" /* NEGOTIATION */;
    return base;
}
function classifyIntentBody(q) {
    const EXPERIENCE_BARE_PATTERNS = /* @__PURE__ */ new Set([
        "how much experience",
        "how many years of experience",
        "what is my experience",
        "whats my experience",
        "what's my experience",
        "what is my background",
        "whats my background",
        "what's my background"
    ]);
    const isCompanyIdentityPattern = (p) => {
        if (p === "what company" || p === "which company")
            return q.includes(p) && !JD_ROLE_FRAME_RE.test(q);
        if (EXPERIENCE_BARE_PATTERNS.has(p))
            return q.includes(p) && !EXPERIENCE_TOPIC_SCOPED_RE.test(q);
        return q.includes(p);
    };
    if (IDENTITY_DIRECT_PATTERNS.some(isCompanyIdentityPattern)) {
        return "intro" /* INTRO */;
    }
    if (NAME_QUESTION_REGEX.test(q) && !NAME_OF_THING_REGEX.test(q)) {
        return "intro" /* INTRO */;
    }
    if (q.split(" ").length <= 6 && !TECHNICAL_PATTERNS.some((p) => q.includes(p)) && q.startsWith("what is ")) {
        return "profile_detail" /* PROFILE_DETAIL */;
    }
    const scores = {
        ["technical" /* TECHNICAL */]: 0,
        ["intro" /* INTRO */]: 0,
        ["company_research" /* COMPANY_RESEARCH */]: 0,
        ["negotiation" /* NEGOTIATION */]: 0,
        ["profile_detail" /* PROFILE_DETAIL */]: 0,
        ["general" /* GENERAL */]: 0
    };
    for (const pattern of COMPANY_RESEARCH_PATTERNS) {
        if (q.includes(pattern))
            scores["company_research" /* COMPANY_RESEARCH */]++;
    }
    for (const pattern of NEGOTIATION_PATTERNS) {
        if (q.includes(pattern))
            scores["negotiation" /* NEGOTIATION */]++;
    }
    for (const pattern of TECHNICAL_PATTERNS) {
        if (q.includes(pattern))
            scores["technical" /* TECHNICAL */]++;
    }
    for (const pattern of PROFILE_DETAIL_PATTERNS) {
        if (q.includes(pattern))
            scores["profile_detail" /* PROFILE_DETAIL */]++;
    }
    const maxScore = Math.max(scores["company_research" /* COMPANY_RESEARCH */], scores["negotiation" /* NEGOTIATION */], scores["technical" /* TECHNICAL */], scores["profile_detail" /* PROFILE_DETAIL */]);
    if (maxScore === 0)
        return "general" /* GENERAL */;
    if (scores["profile_detail" /* PROFILE_DETAIL */] === maxScore)
        return "profile_detail" /* PROFILE_DETAIL */;
    if (scores["negotiation" /* NEGOTIATION */] === maxScore)
        return "negotiation" /* NEGOTIATION */;
    if (scores["company_research" /* COMPANY_RESEARCH */] === maxScore)
        return "company_research" /* COMPANY_RESEARCH */;
    if (scores["technical" /* TECHNICAL */] === maxScore)
        return "technical" /* TECHNICAL */;
    return "general" /* GENERAL */;
}
function needsCompanyResearch(question) {
    const intent = classifyIntent(question);
    return intent === "company_research" /* COMPANY_RESEARCH */ || intent === "negotiation" /* NEGOTIATION */;
}
var CANDIDATE_REF_REGEX = /\b(i|i've|i'm|i'd|i'll|you|your|yours|yourself|you've|you're|you'd|you'll|ya|we|our|ours|ourselves|us|me|my|mine|myself)\b/i;
var NAME_QUESTION_REGEX = /\b(my|your)\s+(full\s+|first\s+|last\s+|complete\s+)?name\b|\bname,?\s*(please|again)\b|\b(tell me|give me|have|spell)\s+(me\s+)?(your|the candidate'?s)\s+name\b/i;
var NAME_OF_THING_REGEX = /\bname\s+of\s+(the|your|that|this|a|an)\s+(company|project|product|tool|app|application|file|repo|repository|model|framework|library|service|system|team|role|position)\b|\b(company|project|product|tool|app|file|repo|model|framework|library|service|system)\s+name\b/i;
var JD_ROLE_FRAME_RE = /\b(this|the)\s+(role|job|position|posting|listing|opening)\b/i;
var EXPERIENCE_TOPIC_SCOPED_RE = /\b(experience|background)\b[\w\s,']{0,30}\b(mentoring|leading|managing|building|designing|architecting|working|using|doing|running|handling|driving|overseeing|coordinating|in|with|on|for|at|as)\s+\S/i;
var IDENTITY_DIRECT_PATTERNS = [
    "what is my name",
    "whats my name",
    "what's my name",
    "who am i",
    "who am I",
    "what is my role",
    "whats my role",
    "what's my role",
    "what role am i",
    "what role am I",
    "what is my job",
    "whats my job",
    "what's my job",
    "where do i work",
    "where do I work",
    "where am i working",
    "what company",
    "which company",
    "what is my current",
    "whats my current",
    "what's my current",
    "how much experience",
    "how many years of experience",
    "what is my background",
    "whats my background",
    "what's my background",
    "my current role",
    "my current job",
    "my current position",
    "what is my experience",
    "whats my experience",
    "what's my experience"
];
var GENERIC_QUESTION_PATTERNS = [
    "what is a ",
    "what is an ",
    "what is the ",
    "what are ",
    "what's a ",
    "what's an ",
    "what's the ",
    "what does ",
    "what do ",
    "define ",
    "definition of ",
    "explain ",
    "explanation of ",
    "describe a ",
    "describe an ",
    "describe the ",
    "how does ",
    "how do i ",
    "how to ",
    "difference between ",
    "differences between ",
    "compare ",
    "comparison of ",
    "vs ",
    "give me an example of ",
    "example of ",
    "show me how ",
    "write the code for ",
    "write code for ",
    "write a function ",
    "write a program ",
    "write a script ",
    "implement a ",
    "implement the ",
    "code for ",
    "code to ",
    "function to ",
    "function that ",
    "program to ",
    "program that ",
    "script to ",
    "pros and cons of ",
    "trade-offs of ",
    "tradeoffs of ",
    "when to use ",
    "when should i use "
];
function isGenericKnowledgeQuestion(question) {
    const q = question.toLowerCase().trim();
    if (!q)
        return false;
    if (CANDIDATE_REF_REGEX.test(q))
        return false;
    if (IDENTITY_DIRECT_PATTERNS.some((p) => q.includes(p)))
        return false;
    if (INTRO_PATTERNS.some((p) => q.includes(p)))
        return false;
    return GENERIC_QUESTION_PATTERNS.some((p) => q.includes(p));
}
export { IDENTITY_DIRECT_PATTERNS, INTRO_PATTERNS, classifyIntent, classifyIntentWithContext, isGenericKnowledgeQuestion, looksLikeGarbledComp, needsCompanyResearch };
