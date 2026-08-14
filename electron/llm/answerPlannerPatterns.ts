// electron/llm/answerPlannerPatterns.ts
//
// Question-classification regex tables extracted from AnswerPlanner.ts
// (PR #427 §1.3). These are pure data: arrays of regex literals with no
// module-scope mutable state and no behaviour of their own. planAnswer()
// imports them back under the same names, so classification is byte-for-byte
// unchanged — this split is mechanical, not behavioural.
//
// Kept as one module rather than split per answer-type: the tables are
// cross-referenced by a single classifier and splitting further would only
// add import churn without improving navigability.

export // CS/technical subject terms that, when combined with explain/what-is framing,
// mark a generic technical-concept question (no profile). Deliberately broad —
// the gate is "explain/what-is + (a DSA term OR one of these)", so a plain
// profile question like "what is my name" never reaches here (IDENTITY wins
// first), and "what projects have I done" lacks both a DSA term and these.
const TECHNICAL_SUBJECT_PATTERNS = [
  /\b(deadlock|mutex|semaphore|thread|process|concurrency|race condition)\b/i,
  /\b(tcp|udp|http|https|dns|ip|osi|latency|throughput|socket)\b/i,
  /\b(database|index|normalization|acid|transaction|sharding|replication)\b/i,
  /\b(sql|nosql|no[- ]?sql|relational|document (db|database|store)|key[- ]?value|columnar|mongodb|postgres\w*|mysql|sqlite)\b/i,
  /\b(eventual consistency|strong consistency|consistency model|cap theorem|consensus|quorum|paxos|raft|two[- ]?phase commit)\b/i,
  /\b(amortized|complexity|big[- ]?o|asymptotic|np[- ]?complete)\b/i,
  /\b(closure|hoisting|prototype|garbage collection|event loop|promise|async)\b/i,
  /\b(rest|restful|graphql|graph\s*ql|apis?|grpc|microservice|monolith|cache|caching|cdn|load balanc|rate limit\w*|rate[- ]?limiter|message queue|pub[- ]?sub|webhook|idempoten\w*|backpressure|circuit breaker)\b/i,
  /\b(encryption|hashing|oauth|jwt|tls|ssl|cors|xss|csrf|sql injection)\b/i,
  /\b(pointer|reference|stack|heap|recursion|iteration|polymorphism|inheritance)\b/i,
  // Frameworks / cloud / data-eng subjects that appear in "explain X" concept
  // asks (benchmark 2026-06-05): FastAPI, AWS EC2/S3/Lambda, indexing, dashboard,
  // pandas/numpy/spark/hadoop, A/B testing, retention/ETL/pipeline.
  /\b(fastapi|flask|django|express|node\.?js|react|next\.?js|spring)\b/i,
  /\b(aws|ec2|s3|lambda|azure|gcp|kubernetes|docker|redis|kafka)\b/i,
  /\b(indexing|pandas|numpy|spark|hadoop|etl|dataframe)\b/i,
  /\b(a\/b test|ab test|retention|cohort|regression|classification|clustering)\b/i,
];

export // CI/CD and related devops terms (live-confirmed leak, 2026-07-27): "what is
// CI/CD" fell through to unknown_answer (profileContextPolicy: 'allowed')
// instead of technical_concept_answer (forbidden) — a downstream relevance-
// match then injected profile context because the profile happens to contain
// devops-adjacent terms. Deliberately kept OUT of TECHNICAL_SUBJECT_PATTERNS
// itself (not merged into the array above) — that array is also consulted
// directly by the project_followup_answer negation guard below (~line 2535,
// `!includesAny(textNoTechStack, TECHNICAL_SUBJECT_PATTERNS)`), and a code-
// review pass confirmed live that merging it there misroutes genuine own-
// project follow-ups ("how did you handle CI/CD?", "why did you choose
// jenkins?") away from project_followup_answer/required. This array is only
// consulted by isLikelyTechnicalConcept below, which the negation guard does
// NOT use (same reason "framework"/RC-2's typo-tolerant list is excluded
// from that guard — see the guard's own comment).
const DEVOPS_CICD_PATTERNS = [
  /\b(ci[\s/]*cd|continuous integration|continuous (delivery|deployment)|devops|jenkins|github actions|gitlab[- ]?ci|build pipeline)\b/i,
];

export // Software-engineering concept vocabulary (live-confirmed leak, 2026-07-27,
// n=20 harness run): "what is dependency injection" fell through to
// unknown_answer (profileContextPolicy: 'allowed') instead of
// technical_concept_answer (forbidden), and the full candidate profile
// (~10.6K chars) was injected into a request that has nothing to do with the
// candidate — confirmed via promptAuditLatest.hasRawCandidateProfile, 5/5
// reps. A vocabulary sweep against sibling "what is X" phrasing found 12 more
// common OOP/design-pattern/testing/infra terms with the identical gap.
// Deliberately kept OUT of TECHNICAL_SUBJECT_PATTERNS (same reason as
// DEVOPS_CICD_PATTERNS above): that array also feeds the project_followup_answer
// negation guard below (~line 2547), and merging there would misroute genuine
// own-project follow-ups ("how did you apply dependency injection in your
// project?") away from project_followup_answer/required. Consulted only by
// isLikelyTechnicalConcept, which the negation guard does not use.
const SOFTWARE_ENGINEERING_CONCEPT_PATTERNS = [
  /\b(dependency injection|inversion of control|ioc)\b/i,
  // Code-review fix (2026-07-27): the original singular-only forms
  // (`design pattern`, `factory pattern`, `observer pattern`, `memory leak`,
  // `monorepo`) never matched plural phrasing ("what are design patterns",
  // "what causes memory leaks") — the exact bug class this array exists to
  // close, live-confirmed via before/after classification.
  /\b(design patterns?|singletons?|factory patterns?|observer patterns?|solid principles?)\b/i,
  /\b(memory leaks?|load balanc\w*)\b/i,
  /\b(unit test\w*|\btdd\b|test[- ]?driven development|monorepos?)\b/i,
];

// A PEOPLE / leadership / conflict OBJECT after a lead/manage/handle verb marks a behavioral
// STORY (not a skill probe). This ONE source is interpolated into the behavioral matcher AND
// its two skill-side guards so the guard is always a superset of the matcher and the three lists
// can never drift apart (code-review 2026-06-16). A tech/tool object ("a database", "Python")
// is deliberately NOT here — those stay skill_experience.
export const PEOPLE_OR_CONFLICT_OBJECT =
  '(?:team|teams|people|person|peers?|reports?|engineers?|developers?|juniors?|staff|direct\\s+reports?|group|anyone|someone|somebody|anybody|conflict|disagreement|crisis|escalation|difficult|tough)';

export const DSA_PATTERNS = [
  /\btwo\s*sum\b/i,
  /\blongest substring\b/i,
  /\breverse (a )?linked list\b/i,
  /\blinked list\b/i,
  /\bbinary search\b/i,
  /\bsliding window\b/i,
  /\btwo pointers?\b/i,
  /\bhash\s?(map|set|table)\b/i,
  /\bstack\b|\bqueue\b|\bheap\b|\btrie\b/i,
  /\bgraph\b|\btree\b|\bbfs\b|\bdfs\b/i,
  /\bdynamic programming\b|\bdp\b|\bmemoization\b/i,
  /\bbacktracking\b|\brecursion\b|\bunion[- ]find\b/i,
  /\btime complexity\b|\bspace complexity\b|\bbig[- ]?o\b/i,
  /\bkth (largest|smallest|highest|lowest)\b|\bk-?th\b/i,
  /\b(find|merge|sort|detect|check) (the )?(kth|longest|shortest|maximum|minimum|cycle|duplicate|missing|first|second highest)\b/i,
  /\b(quicksort|mergesort|bubble sort|insertion sort|palindrome|fibonacci|anagram|fizzbuzz)\b/i,
];

export const COMMON_CODING_PROBLEM_PATTERNS = [
  /\bodd\s*(?:\/|or|and|even)?\s*even\b|\beven\s*(?:\/|or|and)?\s*odd\b/i,
  /\b(check|find|determine|detect)\b.*\b(odd|even)\b/i,
  /\bprime number\b|\bpalindrome\b|\bfactorial\b|\bfibonacci\b/i,
  /\breverse string\b|\bsort array\b|\bfind (?:max|min)\b/i,
  /\bcheck if\b/i,
  // Named classic problems that lack an explicit coding verb. These are
  // unambiguously DSA/coding asks ("valid parentheses", "fizzbuzz") so the
  // planner must route them to the coding contract even when phrased bare.
  /\bvalid parentheses\b|\bbalanced parentheses\b|\bmatching brackets\b/i,
  /\bfizz\s?buzz\b/i,
  /\banagram\b|\bsubarray\b|\bsubstring\b/i,
  /\bmerge (?:two )?(?:sorted )?(?:arrays?|lists?)\b/i,
  /\b(?:detect|find)\b.*\bcycle\b|\blinked list cycle\b/i,
  // Grounding-campaign fix (2026-07-17): bare "in order"/"level order"/etc.
  // false-positived on ordinary English ("what companies have you worked at,
  // IN ORDER?", "list your certifications in order of date") — a confirmed
  // live incident where a résumé question got misrouted to
  // coding_question_answer (which forbids the resume context layer per spec
  // §8.3), so the model got zero evidence for a "coding" answer type and
  // fabricated a fictional employment history instead of grounding correctly.
  // "traversal" alone is unambiguous DSA vocabulary and stays a bare match;
  // the order-word variants now require an explicit tree/traversal-adjacent
  // co-occurrence (checked via lookahead so word order in the sentence
  // doesn't matter), mirroring the class/method narrowing above in this file.
  /\btraversal\b/i,
  /(?=.*\b(?:tree|node|binary|bst)\b)(?=.*\b(?:level|in|pre|post)\s?order\b)/i,
  /\bgcd\b|\blcm\b|\bgreatest common divisor\b/i,
  /\bbubble sort\b|\bquick\s?sort\b|\bmerge sort\b|\binsertion sort\b/i,
];

export const CODING_PATTERNS = [
  // Real-custom-mode-repair (2026-07-11): dropped bare `method` and `class`
  // from this line — both are extremely common non-coding English nouns
  // ("What fine-tuning METHOD was used?", "teaching method", "what CLASS of
  // algorithm is this", "business class") and produced a confirmed P0
  // incident (a document-grounded thesis question about a fine-tuning
  // method was misrouted to coding_question_answer and answered with an
  // unrelated Two Sum LeetCode solution — see docs/context-os/
  // real-custom-mode-repair/06_ROOT_CAUSE_REPORT.md). `class`/`method` alone
  // are now handled ONLY by the paired-with-coding-object pattern two lines
  // below (e.g. "write a class for X", "implement a method to Y") — bare
  // occurrence of either word no longer trips the coding route on its own.
  /\b(write|implement|code|program|solve)\b/i,
  /\bcode for\b|\bprogram for\b|\bfunction for\b|\balgorithm for\b/i,
  /\balgorithm\b|\bdebug this\b|\bfix (this|the) bug\b/i,
  // `class`/`method` count as a coding signal ONLY when paired with an
  // explicit coding verb or a function/algorithm noun in the same clause —
  // "write a class that…", "implement the method for sorting…" — never bare.
  /\b(write|implement|code|create|define)\b[\w ,'-]{0,20}\b(class|method|function)\b/i,
  /\b(class|method|function)\b[\w ,'-]{0,20}\bto\s+(sort|search|traverse|reverse|parse|compute|calculate|return)\b/i,
  // A bare language name is NOT a coding signal on its own — "how would you use
  // SQL", "explain SQL", "have you used Python" are concept/experience asks, not
  // "write code" tasks. Only treat a language as coding when paired with an
  // explicit coding verb so the bare name can't hijack technical_concept /
  // skill_experience / jd_fit routing (benchmark 2026-06-05).
  /\b(write|implement|code|coding|program|snippet|function|script|reverse|sort|parse)\b[\w ,'-]*\b(javascript|typescript|python|java|c\+\+|sql|go|golang|rust)\b/i,
  /\bin (javascript|typescript|python|java|c\+\+|sql|golang|rust)\b[\w ,'-]*\b(write|code|implement|function|program)\b/i,
  ...COMMON_CODING_PROBLEM_PATTERNS,
];

export const SYSTEM_DESIGN_PATTERNS = [
  /\bsystem design\b|\bdesign (a|an|the)\b/i,
  // Bare technology nouns (scalable / scale / architecture / distributed) only
  // signal a SYSTEM-DESIGN ASK when paired with a design/build imperative. Without
  // this guard, a candidate EXPERIENCE probe that merely mentions the technology —
  // "how many years have you worked on DISTRIBUTED systems?", "tell me about your
  // SCALABLE services experience" — misrouted to a system_design_answer (profile
  // FORBIDDEN, assistant voice), so it got the "Clarify Requirements / High-Level
  // Design" template instead of a first-person experience answer AND could not be
  // grounded in the résumé (E2E campaign Round 1, F-ROUTE). A real design ask
  // ("design a scalable system", "how would you architect a distributed cache")
  // still matches via the design verb.
  /\b(design|architect|build|scale|structure|lay ?out)\b[^.?!]{0,40}\b(scalable|architecture|distributed|high[- ]?throughput|fault[- ]?toleran\w+)\b/i,
  /\b(scalable|distributed|high[- ]?throughput)\b[^.?!]{0,40}\b(system|service|architecture|design)\b[^.?!]{0,40}\b(design|build|architect|handle|scale to|support)\b/i,
  /\brate limiter\b|\burl shortener\b|\bchat system\b|\bnotification system\b/i,
];

export const DEBUGGING_PATTERNS = [
  /\bdebug\b|\broot cause\b|\bwhy.*(failing|crashing|broken)\b/i,
  /\berror\b|\bexception\b|\bstack trace\b|\bbug\b/i,
  // "why is my API returning 500 / a 404 / errors intermittently", "why does X
  // return <status>", "why is my <thing> slow/timing out" (release 2026-06-07).
  /\bwhy (is|does|are|do)\b.{0,40}\b(return\w*|throw\w*|fail\w*|crash\w*|hang\w*|timing out|time out|timeout|slow|leak\w*|intermittent\w*)\b/i,
  /\breturn\w*\s+(a\s+)?(4\d\d|5\d\d)\b|\b(4\d\d|5\d\d)\s+(error|status|response|intermittent\w*)\b/i,
  /\bwhy.*(not working|isn'?t working|won'?t work|keeps? (failing|crashing|breaking))\b/i,
];

export const NEGOTIATION_PATTERNS = [
  /\bsalary\b|\bcompensation\b|\bctc\b|\boffers?\b|\boffered\b|\bpay\b|\bequity\b|\bbonus\b|\braise\b/i,
  /\bexpected\s+(range|salary|compensation|package|pay|ctc)\b|\bcurrent\s+(salary|ctc|package)\b/i,
  // "expected/expecting package", "how much package", "what package" — comp asks
  // that use "package" as the salary noun (benchmark 2026-06-05). Requires the
  // expect/how-much framing so "tech stack package" or an npm "package" never trips.
  /\b(expecting|expect|how much|what(?:'s| is)?)\s+(your\s+)?(expected\s+)?package\b/i,
  /\bpackage\s+(are|you|expectation|expecting)\b/i,
  // Offer/counter-offer phrasing without an explicit "salary" noun. Deliberately
  // does NOT match a bare number alone ("100k array") — only negotiation verbs —
  // so a coding question that happens to mention a size isn't mis-routed.
  /\bcounter(?:\s*-?\s*offer|ing|\b)|\bnegotiat\w*\b|\blow\s?ball\b|\bwalk\s?away\b|\bbatna\b/i,
  /\b(lpa|\d\s?k)\b.*\b(counter|offer|salary|negotiat\w*|expect)\b|\b(counter|offer|salary|negotiat\w*|expect)\b.*\b(lpa|\d\s?k)\b/i,
  // High-signal compensation PUSHBACK phrasings the interviewer uses ("our budget
  // is lower", "can you come down", "that's higher than we budgeted"). Specific
  // enough to avoid colliding with a PM's "project budget" — requires the comp
  // direction verb. Mirrors the premium classifier's stickiness vocabulary.
  /\bbudget is (lower|tight|limited|less|under|capped|fixed|only|around|\$|\d)\b/i,
  /\b(come down|go lower|do better) (on|with)\b|\bcan you come down\b|\bmeet (me )?in the middle\b/i,
];

export const IDENTITY_PATTERNS = [
  // Both "my name" (manual/user asking) and "your name" (interviewer asking the
  // candidate) — spec §1/§11 require both. The candidate-voice perspective is
  // decided separately from the answerType, so "your name" still answers
  // "My name is ..." in first person when an interviewer asks.
  /\bwhat(?:'s| is)? (my|your) name\b/i,
  /\bwhats (my|your) name\b/i,
  /\bwho am i\b/i,
  /\bwho are you\b|\bwho (u|r) (u|r|you)\b|\bwho\s+u\s*r\b/i,    // "who u r", "who r u"
  /\btell me who you are\b|\bwho you are\b/i,
  /\bstart with (an? )?intro\b|\blet'?s start with (your|an) intro\b/i,
  // Typo / greeting / SMS-spelling tolerant intro (real manual-chat log
  // 2026-06-06b: "introduce yourseld", "introduce urself", "hey man introduce
  // yourself"). The verb "introduc(e)" + a self-pronoun token (yourself/yourselD/
  // yoursef/urself/urslf) anywhere in the message routes to identity — greetings
  // and trailing typos no longer drop it to unknown_answer.
  // Self-pronoun is REQUIRED (code-review 2026-06-06b HIGH): "introduce a bug",
  // "how would you introduce DI" must NOT match — only "introduce yourself" and its
  // typos (yourseld/yoursef/urself/urslf).
  /\bintroduce\s+(yo?u?r?se?l?[fd]|u?r?se?l?[fd]|me to (?:you|the team))\b/i,
  /\b(quick|brief|short)\s+intro\b|\b(give|do)\s+(me\s+)?(a\s+|an\s+|your\s+)?intro\b|\bintro\s+(yourself|urself|please|pls|me|about you)\b|^intro$/i,
  /\btell me about yourself\b/i,
  /\bstate your name\b/i,
  /\bwhat(?:'s| is) your (full )?name\b/i,
  // "Walk me through your background/career/journey" — the intro/identity ask
  // (spec groups it with identity). First-person, profile required.
  /\bwalk me through your (background|experience|resume|cv|career|journey|profile)\b/i,
  // Natural intro/identity phrasings (benchmark 2026-06-05): "give me a quick
  // introduction", "what should I call you?", "how would you describe yourself
  // (professionally)?", "(can you )summarize who you are", "introduce yourself".
  /\b(give|tell|provide|share)\s+(me\s+|us\s+|the team\s+|everyone\s+)?(a\s+)?(quick\s+|brief\s+|short\s+|little\s+)?(self[- ]?introduction|introduction|intro|overview of yourself|rundown)\b/i,
  // bare "(quick) self-introduction" / "self intro" anywhere (E2E F-VOICE Q1:
  // "could you give us a quick self-introduction?" fell to general_meeting).
  /\bself[- ]?(introduc(tion|e)|intro)\b/i,
  // "tell me a little about yourself and your background", "tell us about yourself
  // and what you do" — the classic opener. The "about yourself" anchor makes it an
  // intro even when it trails into "and your background/experience" (which would
  // otherwise pull it to experience_answer). E2E MiniMax campaign, F-VOICE Q1.
  // `(?![-\w])` stops "yourself" matching the "your self" in a hyphenated
  // compound ("tell me about your self-attention / self-hosted / self-driving
  // project") — those are technical/project asks, NOT an intro. (Code review.)
  /\btell (me|us)\b.{0,25}\babout your ?self\b(?![-\w])/i,
  /\b(quick|brief|short|little)\s+(bit\s+)?(about|on)\s+your ?self\b(?![-\w])/i,
  /\bwhat should (i|we) call you\b/i,
  /\b(how (would|do) you )?describe yourself\b/i,
  /\b(summari[sz]e|describe|tell me about) who you are\b/i,
  /\bcan you (introduce|tell me about) yourself\b/i,
  // "Give me the 30-second / elevator / short version of who you are / yourself" —
  // an intro ask phrased as a length-bounded "version" (release 2026-06-06 WTA).
  /\b(give|tell)\s+me\s+(the|a)\s+(\d+[- ]?second|elevator|short|quick|brief|two[- ]?minute|one[- ]?minute)\s+(version|pitch|rundown|summary)\b/i,
  /\b(\d+[- ]?second|elevator)\s+(version|pitch|intro|introduction)\b/i,
  /\bversion of (who you are|yourself)\b/i,
  // "(Give|tell) me your/a-quick/a-brief background|intro|overview" — a
  // conversational opener intro ask (release 2026-06-06: medium_003). Whether bare
  // ("give me your background") or brevity-qualified ("a quick background"), it's an
  // intro/identity pitch, not a detailed experience walkthrough. The SECOND pattern
  // adds the explicitly TIME-BOUNDED form ("your background in 30 seconds / under a
  // minute"). JD-fit "how does your background match this role?" is unaffected — it
  // requires neither "give/tell me" nor a time bound, so it never matches here.
  /\b(give|tell)\s+me\s+(your|a quick|a brief|a short)\s+(background|intro|overview)\b/i,
  /\byour\s+(background|story|intro)\s+(in|under)\s+(\d+\s*(seconds?|minutes?)|a (minute|sentence|line))\b/i,
];

export // SAFE product/privacy phrasings — used ONLY to lightly bias an ambiguous answer
// toward the product route; they NEVER override isStealthEvasionQuestion (an
// evasion+object combination wins regardless). "how is it low-distraction?", "does
// it process locally?", "is it privacy-first?".
const SAFE_PRODUCT_PRIVACY_PATTERNS = [
  /\b(low[- ]?distraction|privacy[- ]?first|process(ing)? local|local (processing|first)|on[- ]?device|consent|transparent|accessib|minimal ui|cognitive load|data retention|stores? (data|nothing)|opt[- ]?in)\b/i,
];

export // ── PROJECT LINK / repo / public URL (release 2026-06-06b) ──
// "can you give me the link", "share the github repo", "show the website",
// "it's source available right, share the link". Routes to `project_link_answer`: share
// a LOADED url, else say the link isn't loaded — never refuse, never invent.
const PROJECT_LINK_PATTERNS = [
  /\b(give|share|send|show|drop|paste|provide|get) (me )?(the |a |your )?(git ?hub|gitlab|bitbucket|repo|repository|link|url|website|site|demo link|project link|source link|public link)\b/i,
  /\b(git ?hub|gitlab|repo|repository)\s+(link|url|page)?\b/i,
  /\bwhat(?:'s| is)?\s+(the )?(link|url|repo|github|gitlab|website)\b/i,
  /\bwhats?\s+the\s+github\b|\bthe github\??$/i,           // "whats the github"
  // "where can I find/see the repo/link/website/source/code ON GITHUB" — a link
  // ask. Bare "find the source/code" (no github/repo) stays a coding ask, but
  // "see the code ON GITHUB" / "find the source ON GITHUB" is asking for the repo.
  /\b(can|could|where) (i|we) (find|see|get|access) (the |your )?(link|repo|repository|github|gitlab|website|site|demo)\b/i,
  /\b(see|find|view|access) (the )?(code|source|repo|project)\b.{0,20}\b(on|at|in|via)\s+(git ?hub|gitlab|the repo)\b/i,
  // "where can I find the source/repo" — a source-available PROJECT locator → link.
  // EXCLUDES "source code FOR <algorithm>" (a coding ask) via the negative
  // lookahead, and "the code" alone (that's coding). Only bare "the source"/"repo".
  /\bwhere(?:'?s| is| can i (?:find|see)) (the )?(source|repo|repository)\b(?!\s*code\s+(for|of|to))/i,
  /\bopen[- ]?source\b.{0,30}\b(link|repo|github|share|url)\b|\b(link|repo|github|url)\b.{0,30}\bopen[- ]?source\b/i,
  // "it's a source-available project right [share it]" — the user is angling for the
  // link. A BARE "is it source available" (no share/link cue) is a product-about
  // yes/no and is handled by PRODUCT_ABOUT instead, so require a share/right cue.
  // "source available" (a distinct, real licensing term from "open-source") is
  // included alongside open-source in every alternative below.
  /\b(its|it'?s|so its|so it'?s)\s+an?\s+(open[- ]?source|source[- ]?available)\b|\b(opensource|source[- ]?available) (porject|project)\b|\b(open[- ]?source|source[- ]?available)\b.{0,20}\bright\b/i,
  /\bwhy (can'?t|cant|wont|won'?t) (you )?share\b/i,    // "why can't you share, it's source available"
];

export // ── ACTUAL SOURCE CODE evidence requests (release 2026-06-06b) ──
// "a snippet you used to build Natively", "repo-verifiable code", "actual code
// from your codebase", "we'll cross-verify with github". Must not fabricate real
// code. Routes to `source_code_evidence_answer`.
const SOURCE_CODE_EVIDENCE_PATTERNS = [
  // "actual/real/exact code ... of NATIVELY / your repo / the codebase / github" —
  // the real code OF THE LOADED PROJECT. Requires a project/repo anchor so a
  // generic "write the exact code for binary search" stays a coding task
  // (code-review 2026-06-06b HIGH).
  /\b(actual|real|exact|repo[- ]?verifiable|github[- ]?verifiable)\s+(code|snippet|implementation|function|source)\b.{0,50}\b(natively|nativley|your (repo|codebase|source|project)|the (repo|codebase|source|project)|github|gitlab)\b/i,
  /\b(natively|nativley|your (repo|codebase|source|project)|the (repo|codebase)|github)\b.{0,50}\b(actual|real|exact|repo[- ]?verifiable)\s+(code|snippet|implementation|function|source)\b/i,
  /\b(snippet|code|function|implementation|file)\b.{0,40}\b(you (used|wrote|built|made)|from (your|the) (codebase|repo|repository|source|github|project)|to (build|built) natively)\b/i,
  // "what does your actual <X> code look like", "show me your <X> code", "your
  // real code for <X>" — asking about NATIVELY's own implementation. A source-
  // evidence request (must not fabricate), not a generic coding task.
  /\b(what does |show me |whats )?(your|the natively|natively'?s)\s+(actual\s+|real\s+)?[\w ]*\bcode\b\s*(look|is|for|of)?/i,
  /\byour (real|actual) code\b/i,
  // "repo-verifiable / github-verifiable snippet|code" — explicitly asks for code
  // that can be checked against the public repo; this IS a source-evidence request
  // on its own (the "repo-verifiable" qualifier is the anchor).
  /\b(repo[- ]?verifiable|github[- ]?verifiable|verifiable against (?:the )?(?:repo|github))\s+(code|snippet|implementation|function|source)\b/i,
  // "paste/show/give a snippet from the natively repo/codebase/source"
  /\b(paste|show|give|share|pull)\b.{0,30}\b(snippet|code|function|file)\b.{0,30}\b(from (the )?(natively|nativley) (repo|codebase|source|project)|from (your|the) (repo|codebase|github))\b/i,
  /\bsnippet from (the )?(natively|nativley|your|the) (repo|codebase|source|project|github)\b/i,
  /\b(cross[- ]?verif|cross[- ]?check)\b.{0,40}\b(github|repo|actual code|source)\b|\b(github|repo)\b.{0,40}\b(cross[- ]?verif|cross[- ]?check|verify)\b/i,
  /\b(show|give|write|share)\b.{0,40}\b(code|snippet)\b.{0,40}\b(you (used|wrote)|to (build|built)|from natively|actual|real|repo|github)\b/i,
  /\bdemo code of a snippet you have used\b/i,
  /\b(exact|actual) code from (file|the file|your)\b/i,
  // "write/give a demo snippet FOR NATIVELY" / "demo code for natively" — a request
  // for code OF the loaded project (even with a write-verb, the "for Natively"
  // anchor makes it a source-evidence ask, not a generic coding task; the template
  // says "conceptual if not loaded"). Release 2026-06-07: res_src_005.
  /\b(write|give|show|share|make)\b.{0,30}\b(demo |sample |example )?(code|snippet)\b.{0,20}\b(for|of|from)\s+(natively|nativley|your project|the project)\b/i,
  /\b(demo|sample|example)\s+(code|snippet)\s+(for|of|from)\s+(natively|nativley|the natively)\b/i,
  // Meta-instructions about source-code authenticity: "if source isn't loaded say
  // so", "don't fake the code", "don't hallucinate the code" — a source-evidence
  // discipline ask (release 2026-06-07: res_src_004).
  /\b(if (the )?source (code )?(is)?n'?t loaded|don'?t fake (the )?code|don'?t hallucinate (the )?code|say (so )?if (you )?(don'?t have|can'?t)|only (show|give) (real|actual) code if loaded)\b/i,
  // "show code you actually used / really wrote, I'll cross-check" — a verifiability
  // challenge about the loaded project's real code (release 2026-06-07 multimode-1000).
  /\b(show|give|share)\b.{0,20}\bcode\b.{0,20}\b(you|u) (actually|really|genuinely) (used|wrote|built|made|wrote)\b/i,
  /\bcode (you|u) (actually|really) (used|wrote)\b|\b(actually|really) (used|wrote) .{0,15}\b(cross[- ]?check|verify)\b/i,
];

export // ── PRODUCT / PROJECT "what is it" questions (release 2026-06-06b) ──
// "what kind of app is Natively?", "how's its backend?", "what do you think about
// Natively?", "what tech does it use?". Grounded in loaded project metadata.
// Distinct from project_answer (which lists the candidate's projects) — this is a
// drill-in ABOUT the product the user is asking about.
const PRODUCT_ABOUT_PATTERNS = [
  /\bwhat\s+(kind|kinda|type|sort)\s+(of\s+)?(app|application|product|tool|project|software)\b/i,
  /\bhow(?:'?s| is| does)\s+(natively|nativley|nativly|it|the (app|product|backend|architecture|frontend|stack))\b/i,
  /\bwhat\s+(do you think about|about)\s+(natively|nativley|nativly)\b/i,
  /\bwhat (tech|technolog|stack|languages?|framework)\w*\s+(does|do)\s+(natively|nativley|it|this)\b/i,
  /\bis (natively|nativley|it|this)\s+(local|cloud|open[- ]?source|source[- ]?available|privacy|low[- ]?distraction|on[- ]?device|transparent|accessib)\w*/i,
  /\b(natively|nativley|nativly)'?s\s+(backend|architecture|stack|frontend|core)\b/i,
  // Safe product-attribute / behavior probes ("is it low-distraction?", "does it
  // process locally?", "is it privacy-first?", "does it use Ollama?", "what part
  // uses Rust?") — these are about the PRODUCT, grounded in loaded metadata.
  /\b(is|are) (it|this|they)\s+(local|cloud[- ]?based|open[- ]?source|source[- ]?available|privacy[- ]?first|low[- ]?distraction|on[- ]?device|free|paid|safe|secure)\b/i,
  /\b(does|do)\s+(it|this|natively|nativley)\s+(process|run|store|work|use|have|support|need)\b/i,
  /\b(what|which) part (of (natively|nativley|it|the app))?\s*(uses|is in|runs|handles|does)\b|\b(does|do) (it|natively) (use|have) (a )?(backend|server|database|ollama|rust|electron|local)\b/i,
  // "what uses Rust", "what runs on Electron", "what's written in Go" — asking which
  // part of the product uses a named technology (release 2026-06-07 multimode-1000).
  /\bwhat (uses|runs on|is (written|built) (in|with)|handles|powers)\s+(rust|electron|react|node|python|go|typescript|sqlite|the (backend|frontend|audio|stt|ml))\b/i,
  /\bwhat (does|do) (natively|nativley|it) use\b|\bwhat'?s (natively|nativley|it) (built|made|written) (with|in)\b/i,
  // Architecture / build-stack questions ABOUT the product: "what is Natively built
  // with", "what is it made using", "what are the technologies behind Natively",
  // "what is the architecture of Natively", "how did you build Natively" (release
  // 2026-06-07: residual pattern #1). Grounded in loaded project metadata. NOTE:
  // "how did you build" about a project = a product-about/architecture question;
  // it's distinct from the project-LIST ("what projects have you built").
  /\bwhat (is|'?s|are) (the )?(tech ?(stack)?|technolog\w*|stack|architecture|framework\w*)\s+(of\s+|behind\s+|powering\s+)?(natively|nativley|it|this|the (app|product|project))\b/i,
  /\b(natively|nativley|nativly|it|this)\s+(is\s+)?(built|made|written|developed|created|powered)\s+(with|using|in|on)\b/i,
  /\bwhat (is|'?s) (it|natively|nativley)\s+(made|built|written|developed)\s+(of|with|using|in)\b/i,
  /\b(what is|whats|describe) (the )?architecture (of )?(natively|nativley|it|this|the (app|product|project))\b/i,
  /\bhow (did|do|was) (you|natively|it|this)\s+(build|built|develop\w*|architect\w*|design\w*)\s+(natively|it|this|the (app|product))\b/i,
  /\bhow (is|was) (natively|nativley|it|this) (built|made|developed|architected|designed)\b/i,
  // "how (do you make|to make) it low-distraction / privacy-first / local" — a
  // product-design question about Natively, grounded in metadata (1000-q
  // benchmark 2026-06-06b). NOT a stealth ask (no evasion/interview object).
  /\bhow (do you |to )?(make|keep|design)\s+(it|natively|this)\s+(low[- ]?distraction|privacy[- ]?first|private|transparent|accessible|local|on[- ]?device|minimal)\b/i,
  /\b(low[- ]?distraction|privacy[- ]?first)\b.{0,30}\b(mode|design|approach|first)\b|\bkeep (it|natively|this) (low[- ]?distraction|privacy)/i,
  // Responsible-use / disclosure / accessibility product questions (release
  // 2026-06-07): "how to disclose it in a meeting", "make it accessible without being
  // distracting" — about using the PRODUCT transparently, NOT hiding it (≠ stealth).
  /\bhow (to|do i|should i) disclose (it|natively|this|using it)\b|\bdisclose (it|natively|this) (in|during|to)\b/i,
  /\bmake (it|natively|this) accessible\b|\baccessible (without|but not) (being )?distract\w*/i,
];

export const JD_FIT_PATTERNS = [
  /\bwhy (this role|this company|us|our company|are you a good fit)\b/i,
  // "Why do you want to work here / for us / at <company>" — the canonical
  // company-motivation interview question (spec §11.11). Profile + JD/company
  // context, NOT a generic meeting answer.
  /\bwhy (do|would) (you|i) want to (work|join)\b/i,
  /\bwhy (do you )?want to work (here|with us|for us|for this)\b/i,
  /\bfit (for|this|the) (this |the )?role\b|\bmatch(?:es)? the job\b/i,
  /\b(why|how) (do |would |are )?(you|i) (a good )?fit\b/i,
  /\bhow (do|would|can) (i|you) fit\b/i,
  /\bgood fit for\b|\bright (fit|candidate) for\b|\bsuited (for|to) (this|the) (role|job|position)\b/i,
  /\bhow.*experience.*(role|job|position)\b/i,
  // "how do I fit this <role> JD/role/position" and tailoring asks against the JD.
  /\bfit (this|the|that) (data analyst |[a-z ]+)?(role|job|position|jd|description)\b/i,
  /\b(tailor|match|align) (my |the )?(answer|resume|experience|skills?|background).*(jd|job|role|position)\b/i,
  /\b(gaps?|strengths?).*(this|the).*(jd|role|job|position|data analyst)\b/i,
  // "what is your strongest match / best fit for the JD/role" — REQUIRES JD/role
  // context so a bare "biggest strength" stays behavioral (not jd_fit).
  /\b(strongest|best|biggest|top)\s+(match|fit|asset|selling point)\b.*\b(jd|role|job|position|description|this)\b/i,
  /\b(strongest|best|biggest|top)\s+(match|fit|strength|asset)\s+for\s+(the|this)\s+(jd|role|job|position|data analyst|[a-z]+ (role|job|position))\b/i,
  /\bstrongest\s+(match|fit|skill|area)\s+(for|to)\s+(the|this)\s+(jd|role|job|position)\b/i,
  // "Why should we hire you?" and its variants — the canonical fit/sell question
  // (live regression 2026-06-05). Profile + JD, NOT a generic meeting answer.
  /\bwhy should (we|i|they|you) (hire|pick|choose|select|consider|take|go with|bring (on|in))\b/i,
  /\bwhat makes (you|me) (a |an |the )?(good|great|right|ideal|strong|best|perfect|standout|qualified|suitable) (fit|candidate|choice|hire|person|applicant)?\b/i,
  /\bwhat makes (you|me) (suitable|qualified|fit|right)\b/i,
  /\bwhy are (you|i)\b.*\b(right|best|good|ideal|strong|qualified|suitable)\b.*\b(candidate|fit|person|choice|applicant|role|job|position)\b/i,
  /\bwhy (do|would) (we|they) (need|want) (you|to hire)\b/i,
  /\bwhy are (you|i) qualified\b/i,
  // "How good are you FOR this job/role", "are you good/suitable/qualified/right
  // for this job/role/position" — casual fit phrasings (live audit 2026-06-05).
  /\bhow (good|suitable|qualified|fit) (are|r) (you|u) for (this|the|a|our)\b/i,
  /\bare (you|u) (good|suitable|qualified|right|fit|a good fit|the right (fit|candidate|person)) (for|to)\b/i,
  /\bare (you|u) (a )?(good|right|strong|ideal) (fit|match|candidate) (for|to)\b/i,
  // "how does your background/experience/skills match/align/fit this role"
  /\bhow (does|do|would|can) (your|my|the) (background|experience|skills?|profile|resume|qualifications?) (match|align|fit|suit|relate|map)\b/i,
  // MOTIVATION + CONTRIBUTION + fit-confidence phrasings (benchmark 2026-06-05):
  // "why do you want this job/role?", "what excites you about this role?", "how
  // can you contribute?", "what value can you bring?", "what makes you confident
  // you can do this job?", "do you think this role matches your profile?", "where
  // do you see overlap?", "how close is your background to what we're looking
  // for?". All are role-fit asks → resume+JD, first person.
  /\bwhy do (you|i) want (this|the|to work)\b/i,
  /\bwhat (excites|interests|draws|attracts) (you|me) (about|to)\b.*\b(role|job|position|company|team)\b/i,
  /\bhow (can|would|will) (you|i) (contribute|add value|help|benefit|impact)\b/i,
  /\bwhat (value|impact|contribution) (can|would|will|do) (you|i) (bring|add|make|provide|offer)\b/i,
  /\bwhat makes (you|me) confident\b/i,
  /\bdo you think (this|the) (role|job|position) (matches|fits|suits|aligns)\b/i,
  /\bwhere do (you|i) see (overlap|alignment|a (good )?(fit|match))\b/i,
  /\bhow (close|well) (is|does) (your|my) (background|experience|profile)\b/i,
  // Opinion-about-the-role → still a fit question ("what do you think about this
  // job/role/position/opportunity?") (benchmark 2026-06-05).
  /\bwhat do you think (about|of) (this|the) (job|role|position|opportunity|company)\b/i,
  /\bhow do you feel about (this|the) (job|role|position|opportunity)\b/i,
  // Casual / indirect fit phrasings that fell to unknown (benchmark 2026-06-05):
  // "convince me you are right (for this role)", "in what ways are you a match",
  // "are you the candidate we should pick", "do you fit what this Data Analyst
  // position needs", "how good are you actually for this analyst thing", "why you
  // for this job not generally this one".
  /\bconvince me\b/i,
  /\bin what ways are (you|i) (a )?(match|fit|suitable|qualified)\b/i,
  /\b(are|why are) (you|i) the (candidate|person|one) (we|they|i) should (pick|choose|select|hire|take)\b/i,
  /\bdo (you|i) fit what (this|the)\b/i,
  /\bfit what (this|the) [\w ]*(role|position|job|analyst|team) (needs?|wants?|requires?|is looking for)\b/i,
  /\bhow good are (you|u|i)\b.*\b(for this|this job|this role|this analyst|this position|this thing)\b/i,
  /\bwhy (you|u|me)\b.*\b(for this|this job|this role|this one|this position)\b/i,
  // Engineering→data-analyst BRIDGE challenges (benchmark 2026-06-05): the
  // interviewer pushes that the background doesn't match. Still a fit question —
  // answer must bridge the experience to the role honestly.
  /\b(connect|bridge|relate|map|link) (it|this|that|them|the two|your (experience|background|skills?))\b/i,
  /\b(data analyst|analyst|data)\b.*\b(connect|bridge|relate|link)\b|\b(connect|bridge|relate|link)\b.*\b(data analyst|analyst|data|role|job)\b/i,
  /\b(full[- ]?stack|engineering|engineer|backend|software)\b.*\b(different|not|but|vs|versus)\b.*\b(data analyst|analyst|data)\b/i,
  /\b(full[- ]?stack|engineering|engineer|backend|software)\b.*\b(data analyst|analyst)\b.*\b(connect|explain|bridge|why)\b/i,
  /\b(why|how) (is|does) (natively|this project|that project|your project|it)\b.*\b(relevant|prove|matter|fit|qualify|show)\b.*\b(analyst|data|role|job)?/i,
  /\b(prove|show|demonstrate) (you can|i can|that you|that i)\b.*\b(analyst|data analyst|this role|this job)\b/i,
  /\b(seem|seems|look|looks).*(engineering|engineer|technical|full[- ]?stack|not).*(why|convince|but)\b/i,
  /\b(don'?t|do not) seem like\b.*\b(analyst|fit|right)\b/i,
  /\bwhy (data|analyst|analytics)\b\??$/i,
  // Gap / readiness for the role (still JD-fit, resume+JD+gap): "what gap do you
  // have for this role", "where are you weak for this JD", "if we need SQL daily
  // how ready are you", "strongest/weakest matching skill for the JD".
  /\b(what|where|which) (gap|gaps|weak|weakness)\b.*\b(role|job|jd|position|this)\b/i,
  /\bwhat will (you|i) need to learn\b/i,
  /\b(strongest|weakest|best|main) (matching )?skill\b.*\b(jd|role|job|position)\b/i,
  /\bif (we|they) need\b.*\bhow ready\b/i,
  /\bhow ready are (you|i)\b/i,
  /\bif (we|they) need [\w ]+,? where do (you|i) stand\b/i,
  // Remaining natural/noisy fit phrasings (benchmark 2026-06-05):
  /\bwhere are (you|i) weak\b/i,
  /\bweak (for|on) (this|the) (jd|role|job|position)\b/i,
  /\bso why this (job|role|position)\b/i,            // "okay cool yeah, so why this job?"
  /\bwhy this (job|role|position)\b/i,
  /\bcompare (yourself|myself) (to|with|against) (other |the other )?(candidates?|applicants?|people)\b/i,
  // Explicit steer to use the JD ("use JD but no salary", "answer using the job
  // description", "tailor it to the JD") — a role-fit answer grounded in the JD
  // (Issue 7). The salary negation is handled separately so this stays jd_fit.
  /\b(use|using|with|from|tailor (it|the answer) to|against) (the )?(jd|job description)\b/i,
  // "The JD calls for/requires X — how do you stack/measure up (there)?" — an
  // explicit JD-requirement comparison (grounding-campaign2 fix, 2026-07-17).
  // Matches both the raw idiom ("stack up") and its textNoTechStack-neutralized
  // form ("measure up") so this fires whichever text this list happens to be
  // tested against. Resume+JD grounded self-assessment, not a generic concept.
  /\b(jd|role|position|job) (calls for|requires|wants|needs|is (looking|asking) for)\b.{0,80}\bhow (do|does|would) (you|i) (stack|measure)(s|ed)?\s+up\b/i,
];

export // GAP / weakness-for-the-role asks (release 2026-06-09). These must produce an HONEST
// GAP + MITIGATION answer in the candidate's first-person voice — NOT a fit-summary
// ("why you're great") and NOT a stall. Distinct from a generic behavioral "biggest
// weakness" (which isn't JD-anchored) and from jd_fit (which sells the match). Checked
// BEFORE jd_fit so a gap ask doesn't get swallowed by the fit patterns above.
const GAP_PATTERNS = [
  /\b(what|which|any|where('?s| is)?|do you have a?)\s+(gaps?|weak(?:ness(?:es)?)?|shortcomings?|limitations?|missing|lacking)\b/i,
  /\bwhat\s+gaps?\s+do\s+(you|i)\s+have\b/i,
  /\bwhere\s+(are|r)\s+(you|u|i)\s+weak\b/i,
  /\b(weakest|least (ready|prepared|qualified|strong|experienced))\b.*\b(jd|role|job|position|match|for (this|the))\b/i,
  /\bwhat('?s| is)?\s+your\s+weakest\s+(match|area|point|skill)\b/i,
  /\bwhat\s+(do|would|will|might|should)\s+(you|i)\s+(need|have)\s+to\s+(improve|learn|work on|develop|build|pick up|get better)\b/i,
  /\bwhat\s+(would|do|will)\s+(you|i)\s+need\s+to\s+learn\b/i,
  /\bwhat('?s| is)?\s+missing\s+(from|in)\s+(your|my)\s+(profile|resume|background|experience)\b/i,
  /\bwhat\s+part\s+of\s+(this|the)\s+(jd|role|job|description)\s+.*\b(least|not)\s+(ready|prepared|strong|confident)\b/i,
  /\bwhere\s+(do|would)\s+(you|i)\s+(fall short|struggle|need (work|improvement))\b/i,
  /\bwhat\s+(are|r)\s+(you|i)\s+(missing|lacking)\s+for\s+(this|the)\b/i,
  // "give me a (confident but honest) gap answer", "a gap answer", "answer about my gaps"
  /\b(a|an|the|my|your)\s+(confident.{0,20})?gap\s+answer\b|\banswer\s+(about|on|for)\s+(my|your|the)\s+gaps?\b|\bgive me\s+.{0,30}\bgap\b/i,
];

export const SKILLS_PATTERNS = [
  /\b(skills|tools|technologies|frameworks|tech stack)\b/i,
  // "what programming/coding languages do you know/use?" (benchmark 2026-06-05).
  /\b(programming|coding) languages?\b/i,
  /\bwhat languages do (you|i)\b/i,
  // "where do you specialise/specialize the most", "what's your strongest area",
  // "what are you best at", "your area of expertise" (real manual-chat log
  // 2026-06-06b "where do you specialise the most"). A self-strength/skill probe.
  /\b(where|what) (do|are) (you|u)\s+(speciali[sz]e|special|strongest|best|expert|most (skilled|experienced|confident))\b/i,
  /\b(your|my) (area of |main |core )?(expertise|specialit|specialisation|specialization|strong suit|forte)\b/i,
  /\bwhat(?:'s| is) (your|my) strongest (skill|area|tech|language|domain)\b/i,
  /\bwhere do (you|i) special/i,
];

export // Spec Case F exception: "have you used / worked with / do you know <tech>" is a
// SKILL-EXPERIENCE question about the USER (profile YES, first person) — NOT a
// generic technical concept. This must be checked BEFORE coding/DSA patterns so
// "have you used a hashmap?" routes to skills, not to the coding contract.
const SKILL_EXPERIENCE_PATTERNS = [
  // "have you used/built/managed <tech>" is a skill probe. But "have you managed/handled/led
  // PEOPLE / a TEAM" is a behavioral STORY, not a skill — the negative lookahead lets those
  // fall through to BEHAVIORAL_PATTERNS (code-review caveat 2026-06-16). A tech object after
  // managed/handled (e.g. "have you managed a database/cluster") still routes to skills.
  //
  // Grounding-campaign2 fix (2026-07-17): "what scale have you OPERATED it at?"
  // (script-a press A14, canonical: "What scale have you operated Kubernetes
  // at?") fell through this whole pattern list — "operated" was missing from
  // the verb group — and ended up at `general_meeting_answer` (forbids
  // resume), giving candidateProfileChars:0 for a clearly candidate-directed
  // operational-scale question. Live-confirmed on the real backend
  // (test/harness-longsession script-a run-018): the answer was 92 ALL-CAPS
  // words with no résumé grounding at all — a distinct symptom from the
  // "stack up" idiom bugs (fix#14/#15/#17), but the same root shape (a
  // legitimate candidate-experience verb missing from a keyword list).
  // Added operated/run/scaled/maintained — common "have you run/scaled/
  // maintained X at scale" interview phrasings for infra/ops experience.
  new RegExp(`\\bhave you (ever )?(?:(?:managed|handled|led)\\b(?!\\s+(?:a\\s+|an\\s+|the\\s+|your\\s+|some\\s+|any\\s+)?${PEOPLE_OR_CONFLICT_OBJECT}\\b)|(?:used|worked with|worked on|built|built with|written|coded in|programmed in|implemented|done|created|analy[sz]ed|normali[sz]ed|deployed|designed|operated|run|scaled|maintained))\\b`, 'i'),
  /\bdo you (know|have experience (with|in)|use)\b/i,
  /\bare you (familiar|comfortable|proficient|experienced) (with|in)\b/i,
  // "Are you good/strong/skilled at X?", "are you any good with React?" — a
  // proficiency probe about the USER (real manual-chat log 2026-06-06b "are you
  // good at python"). First-person skill-experience answer, profile required.
  // EXCLUDES "are you good FOR this role/job/position/fit" (that's jd_fit) via the
  // negative lookahead — only "good AT/IN/WITH <skill>" or a bare "are you good at"
  // qualifies, never "good for <role>".
  /\bare you (any )?(good|strong|skilled|decent|solid|great|proficient|comfortable|confident|experienced|fluent)\b\s*(at|in|with|on)\b(?!\s+(this|the|a|your)?\s*(role|job|position|fit|company|data analyst))/i,
  /\bare (you|u) (a )?(good|strong|skilled|solid) (coder|developer|programmer|engineer)\b/i,
  // Bare "you good/strong at X" (subject dropped, common in chat-speak after SMS
  // normalization: "u gud at python" → "you good at python").
  /\byou (good|strong|skilled|decent|solid|great|proficient|comfortable|experienced|fluent) (at|in|with|on)\b(?!\s+(this|the|a|your)?\s*(role|job|position|fit))/i,
  // "how strong/good/proficient is your <skill>", "how many years of <skill> do you
  // have" — proficiency/experience probes about the USER (1000-q 2026-06-06b).
  /\bhow (strong|good|solid|proficient|deep|extensive) (is|are) (your|ur)\b/i,
  // "how is your SQL/Python/React?" — a bare proficiency probe naming a skill/tech.
  // Requires a recognized tech token so "how is your day/weekend" doesn't match
  // (release 2026-06-07c: live stale-vs-fresh skill follow-up).
  /\bhow (is|are|s) (your|ur) (python|sql|java(?:script)?|typescript|react|node(?:\.?js)?|c\+\+|go(?:lang)?|rust|aws|gcp|azure|docker|kubernetes|graphql|rest|fastapi|django|flask|spring|pandas|numpy|spark|hadoop|tableau|power\s?bi|excel|tensorflow|pytorch|backend|frontend|full[\s-]?stack|databases?|machine learning|sql skills|coding skills)\b/i,
  /\bhow many years (of|with)\b.{0,30}\b(do you have|experience|you got)\b/i,
  // "how many years have you (been) working on/with/in X", "how long have you
  // worked with X" — a duration/experience probe about the USER phrased with a
  // work verb instead of "experience"/"do you have". Without this, e.g. "how many
  // years have you been working directly on distributed systems?" missed
  // skill-experience framing and fell to a forbidden general/system-design route
  // (E2E Round 1, F-ROUTE).
  /\bhow (many years|long) have you (been )?(work(ed|ing)?|do(ing|ne)?|us(e|ed|ing)|build(ing)?|built|develop(ed|ing)?|cod(e|ed|ing)|programm(ed|ing))\b/i,
  /\bhow (much|many years) (of )?experience\b/i,
  /\byour experience (with|in|using)\b/i,
  /\bhow (much |many years )?(experience|familiar).*\b(with|in|using)\b/i,
  /\bever (used|worked with|built)\b/i,
  // "Did you actually use X / use X or just know it", "did you work with X" —
  // past-experience probes (benchmark 2026-06-05 would-vs-have, honest-evidence). The
  // handle/deal-with verbs are split out with a people/conflict-object negative lookahead so
  // "did you handle a crisis" / "did you deal with a difficult teammate" fall through to a
  // behavioral STORY instead of a skill probe (code-review 2026-06-16).
  /\bdid you (actually |really |ever )?(use|work with|work on|build|implement|write|analy[sz]e)\b/i,
  new RegExp(`\\bdid you (actually |really |ever )?(do|handle|deal with|manage)\\b(?!\\s+(?:a\\s+|an\\s+|the\\s+|your\\s+|some\\s+|any\\s+)?${PEOPLE_OR_CONFLICT_OBJECT}\\b)`, 'i'),
  /\b(used|worked with) [\w ]+ or just (know|knew|theoretical|theory)\b/i,
  /\bexperienced or just theoretical\b/i,
  // "How HAVE you used X", "where HAVE you used X" — explicit past usage (vs the
  // hypothetical "how WOULD you use X" which is technical_concept).
  /\bhow have (you|i) used\b/i,
  /\bwhere have (you|i) (used|worked|applied)\b/i,
];

export // SKILL SELF-RATING (live regression 2026-06-05): "how would you rate your
// expertise in Python", "how good are you at React", "out of 10 rate yourself",
// "what are your coding levels", "on a scale of 1-10 how proficient are you".
// These are about the USER's own proficiency — profile, first person — NOT a
// request to WRITE code and NOT compensation. Kept SEPARATE from
// SKILL_EXPERIENCE_PATTERNS because the rating branch must win even when the
// question contains the bare word "scale" (which otherwise trips
// SYSTEM_DESIGN_PATTERNS); a self-rating question is never a system-design ask.
const SKILL_RATING_PATTERNS = [
  /\b(rate|assess)\s+(your|my)self\b/i,
  /\bhow would (you|i) rate\b/i,
  // "what is your confidence?" / "how confident are you?" — a self-assessment of
  // the candidate's own proficiency (Issue 8).
  /\bwhat(?:'s| is)\s+(your|my)\s+confidence\b/i,
  /\bhow confident are (you|u|i)\b/i,
  // "how good/skilled/proficient are you AT/IN/WITH <skill>" — require the skill
  // preposition so "how good are you FOR THIS JOB" falls through to jd_fit, not
  // skill-rating (live audit 2026-06-05 collision).
  /\bhow\s+(good|skilled|proficient|strong|experienced|comfortable|confident)\s+(are|am)\s+(you|i)\s+(at|in|with|on|using)\b/i,
  /\b(your|my)\s+(coding|skill|skills|technical|proficiency)\s+levels?\b/i,
  /\bcoding\s+levels?\b/i,
  /\bon a scale\b/i,
  /\brate\s+(yourself|myself|your|my)\b/i,
  /\b(your|my)\s+(expertise|proficiency|competency)\s+(in|with|level)\b/i,
  // "rate your Python skills out of 10", "how would you rate your SQL skills" —
  // a skill name may sit between rate/your and skills (benchmark 2026-06-05).
  /\b(rate|how would you rate)\s+(your|my)\s+[\w+#.]+\s+(skills?|expertise|level)\b/i,
  // Bare / fragmentary self-rating in a live transcript (benchmark 2026-06-05):
  // "So Python, like out of 10?", "Okay, out of ten?", "your coding level, 10
  // scale, what?", "What are your levels at, like Python SQL coding?". The
  // "out of N" / "N scale" / "levels at" framing is a proficiency rating, never
  // a coding task or compensation.
  /\bout of (10|ten)\b/i,
  /\b(10|ten)\s*scale\b|\bscale of (10|ten)\b/i,
  /\b(your|my) (coding |skill )?levels? (at|are|is)\b/i,
  /\bwhat (are|is) (your|my) levels?\b/i,
  /\blike\b.*\bout of (10|ten)\b/i,
  /\bjust rate (coding|python|sql|my|your|me)\b/i,
  // "rate <skill>" / "rate me on <skill>" without your/my — "rate Python", "if I
  // ask you to rate Python" (benchmark 2026-06-05). Skill-rating, not coding.
  /\brate\s+(me\s+(on|in)\s+)?(python|sql|java|javascript|typescript|react|node|coding|programming|data|analytics|excel|tableau|full[- ]?stack|backend|frontend)\b/i,
  /\bask (you )?to rate\b/i,
];

export // Generic technical-concept questions ("explain BFS", "what is a deadlock") —
// no profile, generic_ai voice. Distinct from coding (which asks to WRITE code)
// and from skill_experience (which asks about the USER). Checked only when there
// is no coding verb and no skill-experience framing.
const TECHNICAL_CONCEPT_PATTERNS = [
  /\b(explain|what(?:'s| is| are)|describe|how does|how do|define|difference between|compare)\b/i,
  // "give me an example for/of a REST API / SQL query / recursion" — a CONCEPT
  // example request (real manual-chat log 2026-06-06b). A technical explanation,
  // NOT a behavioral story. The tech subject must follow the example phrasing.
  /\b(give|show|share)\s+(me\s+)?(an?\s+)?(example|demo|sample|illustration|snippet)\b\s*(of|for|with|using)?\s*(a |an |the )?(rest|api|sql|graphql|recursion|binary|hash|loop|function|query|algorithm|regex|json|http|crud|endpoint|database|schema|closure|promise|async|middleware)\b/i,
  /\b(example|demo|sample) (of|for) (a |an |the )?(rest|api|sql|graphql|recursion|hashmap|linked list|binary search)\b/i,
];

export // Phase 2: HYPOTHETICAL technical application — "how would you use X", "how would
// you design Y", "what's your approach to Z". The candidate answers in FIRST
// PERSON ("I would use GraphQL when…") but invents NO resume facts: this is a
// technical answer (profileContextPolicy = forbidden) spoken in candidate voice.
// Distinct from skill_experience ("how HAVE you used X" → profile required).
const HYPOTHETICAL_TECH_PATTERNS = [
  /\bhow would (you|i)\s+(use|approach|implement|design|build|handle|structure|architect|optimi[sz]e|solve|tackle|model|set ?up|integrate|scale|test|debug|secure|clean|validate|analy[sz]e|query|explain|process|transform|visuali[sz]e|aggregate|join|filter|measure|investigate|diagnose)\b/i,
  /\bhow might (you|i)\b/i,
  /\bwhat(?:'s| is| would be)?\s+your approach to\b/i,
  /\bif you (were|had) to\b/i,
  /\bwould you (use|choose|pick|prefer|recommend)\b/i,
];

export const PROJECT_PATTERNS = [
  /\b(project|projects|built|shipped|worked on)\b/i,
  // "Tell me about Natively", "explain Natively", "what is Natively", "talk about
  // Natively" — direct asks about a named project (benchmark 2026-06-05). The
  // known project entity is resolved at runtime; here we recognise the intent.
  /\b(tell me about|talk about|explain|describe|walk me through|what(?:'s| is)?)\s+natively\b/i,
  /\bwhat (did|have) you (build|built|made|create|created|develop)\b/i,
  /\bwhat (was|is) your (best|strongest|most important|favou?rite|biggest) (project|work)\b/i,
];

export // Phase 5: project/entity FOLLOW-UP — once a project is on the table, an
// interviewer drills in ("how is it developed?", "what was your role?", "what
// tech did you use?", "hardest part?", "why did you build it?", "what did you
// learn?"). These resolve to a specific project (explicit name here, or the
// prior turn's project via extractedQuestion.followUpTarget) and ground in that
// project's resume facts — first person, never negotiation/JD/sales/lecture.
const PROJECT_FOLLOWUP_PATTERNS = [
  /\bhow (is|was|are|were)\s+.{1,40}?\s+(developed|built|made|implemented|architected|designed|created|structured|engineered)\b/i,
  /\bwhat (was|is) (your|my) role (in|on|for|at|there)\b|\bwhat (was|is) (your|my) role\b.*\b(there|in it|on it|in that)\b/i,
  /\bwhat (tech stack|technologies|tools|languages|frameworks|stack|tech) (did|do|does|was|were) (you|i|it|used)\b/i,
  /\bwhat was the hardest (part|challenge|thing)\b/i,
  /\bwhy did (you|i) (build|make|create|choose|pick|use)\b/i,
  /\bhow did (you|i) (optimi[sz]e|scale|test|build|implement|design|handle|architect|secure|deploy)\b/i,
  /\bwhat did (you|i) learn\b/i,
  /\b(explain|tell me (more |about )|describe|walk me through)\s+(that|this|the|your|it)\b.*\b(project|more|further|again|in detail)\b/i,
  // Drill-ins anchored by "there"/"in it"/"on it" on the project under discussion
  // (benchmark 2026-06-05): "what backend did you use there?", "what was the
  // database there?", "how did you handle latency there?", "what was the
  // architecture there?". The trailing locative refers to the active project.
  /\bwhat (backend|database|frontend|stack|tech|framework|language|architecture|infra|infrastructure|api) (did|was|were) (you|it)?\s*(use[d]?|there|built)?\b.*\bthere\b/i,
  /\bwhat (was|were) the (backend|database|frontend|architecture|stack|tech|infra) there\b/i,
  /\bhow did you (handle|manage|deal with|solve|optimi[sz]e|build|design) [\w ]+ there\b/i,
  /\b(did|how did) you (work with|use|build|handle|coordinate)\b.*\b(there|in (it|that|the project)|on (it|that|the project))\b/i,
  // Personal-contribution drill-ins on the project ("what did you personally
  // contribute", "what did others do and what did you do", "what was the
  // measurable result"). First-person project ownership, never negotiation.
  /\bwhat did you (personally )?(contribute|do|build|own|lead)\b/i,
  /\bwhat (was|were) (the )?(measurable )?(result|impact|outcome|metric)s?\b/i,
];

export const EXPERIENCE_PATTERNS = [
  /\bexperience|background|previous role|last role|work history|internship|interned|worked at|time at\b/i,
  // "what do you currently do?", "what are you working on (now)?", "what's your
  // current role/job?" (benchmark 2026-06-05) — present-tense experience asks.
  /\bwhat do you (currently|now) do\b/i,
  /\bwhat(?:'s| is) your current (role|job|position|title)\b/i,
  /\bwhat are you (currently )?working on\b/i,
  /\bwhat have you been (building|working on|doing|up to)\b|\bwhat have you built (lately|recently)\b/i,
  // "what do you think about/of <Company>" — an opinion about a company the
  // candidate has worked at (real manual-chat log 2026-06-06b "what do you think
  // about estrotech"). Grounded in loaded experience; first-person. The trailing
  // token must be a NAME-like word (≥4 chars, not a generic concept/discourse word
  // like "all this", "the role", "everything"). Excludes product/project names
  // (caught earlier by PRODUCT_ABOUT) and generic determiners/discourse fillers.
  /\bwhat do you think (about|of)\s+(?!the\b|this\b|that\b|your\b|my\b|it\b|all\b|everything\b|us\b|them\b|natively|nativley|the (role|job|company|position|team))[a-z][\w-]{3,}\b/i,
  /\bhow (was|is) (your|the) (time|experience|stint|tenure) (at|with|in)\b/i,
];

export const BEHAVIORAL_PATTERNS = [
  /\btell me about a time\b|\bdescribe a situation\b|\bexample of when\b|\bconflict\b|\bfailure\b|\bchallenge\b/i,
  // "biggest / greatest / proudest achievement/accomplishment", "what are you most
  // proud of", "your proudest/best work at <Company>" — an accomplishment probe
  // about the CANDIDATE. Without this it fell to general_meeting_answer (profile
  // FORBIDDEN, assistant voice) when phrased with an employer ("...at Stripe?"),
  // so the answer could not name the employer or speak in first person (E2E Round
  // 1, F-ROUTE + the "answer omits employer" F-FACT root for achievement Qs).
  // Accomplishment nouns ONLY (NOT "project"/"work" — those belong to
  // project_answer; "best project" must stay a project ask).
  /\b(biggest|greatest|proudest|best|most (significant|impactful|notable))\s+(achievement|accomplishment|win|success|contribution|impact)\b/i,
  /\bwhat (are|were) you most proud of\b|\bwhat achievement\b|\bproudest (achievement|accomplishment|moment)\b/i,
  /\bwhat (did|have) you (accomplish|achieve|deliver)\w*\b.{0,30}\bat\b/i,
  // Past-experience war stories about a specific artifact — "tell me about a
  // difficult BUG you solved", "the hardest issue you ever faced" (manual
  // regression 2026-06-12, stress seq_056: the bare \bbug\b debugging pattern
  // pulled these into the technical lane where the model answered as the
  // assistant — "I don't have personal experiences").
  /\b(tell me about|describe|share|walk me through)\b.{0,60}\b(bug|issue|error|incident|problem|outage)\b.{0,40}\b(you|you'?ve|u)\b.{0,30}\b(solved|fixed|faced|debugged|handled|dealt with|encountered|resolved|found)\b/i,
  /\b(hardest|toughest|most difficult|trickiest|worst)\b.{0,30}\b(bug|error|issue|crash|incident|outage)\b.{0,40}\b(you|you'?ve|your career|you ever)\b/i,
  // Strength/weakness — classic behavioral self-reflection (benchmark 2026-06-05).
  /\b(your|my) (biggest |greatest |main )?(strength|weakness|strengths|weaknesses)\b/i,
  /\bwhat are you (good|bad) at\b/i,
  // "Give me an example of X", "tell me a story where/about", "tell me a
  // time/failure/conflict" — STAR prompts that lack the literal "a time" phrasing
  // (benchmark 2026-06-05): ownership, teamwork, leadership, ambiguity, pressure,
  // coordination, deadline.
  // "Give me an example of teamwork" — a STAR prompt. EXCLUDES a TECHNICAL example
  // request ("give me an example for/of a REST API / a SQL query / recursion"),
  // which is a concept/coding ask, not a behavioral story (real manual-chat log
  // 2026-06-06b "can you give me an example for rest api"). The negative lookahead
  // rejects a following tech-subject noun.
  /\b(give me|share|tell me|do you have) (an?|one|a single) ?(example|instance|story|case)\b(?!\s*(?:of|for|with|using)?\s*(?:a |an |the )?(?:rest|api|sql|graphql|recursion|binary|hash|loop|function|query|algorithm|regex|json|http|crud|endpoint|database|schema|code|snippet|python|javascript|react|node))/i,
  /\btell me (a|one|about a) (story|time|failure|conflict|situation|deadline)\b/i,
  /\btell me about (your |how you )?(handle|handling|deal with|dealing with|manage|managing)?\s*(teamwork|leadership|ownership|coordination|pressure|ambiguity|conflict|uncertainty|a deadline|deadlines|failure|stress)\b/i,
  /\b(handling|dealing with|managing|under) (ambiguity|pressure|uncertainty|conflict|stress|a deadline|deadlines)\b/i,
  // "how do you handle/deal with/manage/approach <soft trait>", "how do you learn
  // quickly", "describe a time you <verb>" — STAR / behavioral self-reflection
  // (1000-q benchmark 2026-06-06b). The trait/verb anchors it as behavioral, not a
  // generic how-to. "learn (new things) quickly" is the classic adaptability ask.
  /\bhow do (you|i) (handle|deal with|manage|approach|cope with|respond to|react to|navigate)\b\s*(?:a |an |the )?(pressure|stress|conflict|ambiguity|uncertainty|failure|criticism|feedback|deadline|setback|difficult|challenging|disagreement|change|tight)\w*/i,
  /\bhow do (you|i) (learn|pick up|adapt|stay (?:motivated|organized|focused))\b/i,
  /\bdescribe (a time|a situation|an? (?:experience|instance))\b|\bdescribe a time (you|i)\b/i,
  /\b(time|example|instance) (you|i|when (?:you|i))\s+(took|showed|demonstrated|led|handled|overcame|failed|learned|built|shipped|resolved|managed)\b/i,
  /\bwhat (do|would) you do (when|if)\b.{0,40}\b(stuck|fail|wrong|conflict|disagree|pressure|deadline)\b/i,
  // "Did/Have you ever <lead/manage/mentor/handle> <people/team/conflict>" or "...deliver under
  // pressure" — a past-experience yes/no that really wants a STAR story ("Did you ever lead a
  // team?", "Have you managed people?", "Have you handled a conflict?", "Have you mentored
  // anyone?"). The PEOPLE/leadership/conflict OBJECT is the discriminator (shared
  // PEOPLE_OR_CONFLICT_OBJECT): a tool/task object ("have you built a REST API", "what projects
  // have you built", "did you finish the migration") is NOT a story and is deliberately excluded
  // (code-review caveat 2026-06-16). The object list here is identical to the one the two
  // skill-side guards exclude, so they can never drift.
  new RegExp(`\\b(?:did|have|has)\\s+(?:you|u)\\s+(?:ever\\s+)?(?:led|lead|manage[d]?|mentor(?:ed)?|coach(?:ed)?|supervis(?:e|ed)|handle[d]?|resolv(?:e|ed)|navigat(?:e|ed)|deal[t]?\\s+with)\\s+(?:a\\s+|an\\s+|the\\s+|your\\s+|some\\s+|any\\s+)?${PEOPLE_OR_CONFLICT_OBJECT}\\w*\\b`, 'i'),
  /\b(?:did|have|has)\s+(?:you|u)\s+(?:ever\s+)?(?:deliver(?:ed)?|shipped?|launched?|worked|performed)\b.{0,30}\b(?:under\s+(?:pressure|a\s+(?:tight\s+)?deadline)|tight\s+deadline|crunch|high[- ]pressure)\b/i,
  /\b(can you )?talk (more )?about your (project )?coordination\b/i,
  /\bproject coordinati(on|vely)\b/i,
  /\bproof of\b|\bprove[sd]? (your|my|analytical|that you|i)\b|\bthat proves?\b/i,
];

export // MEETING / lecture-recap questions about the CONVERSATION, not the candidate —
// must route to general_meeting_answer (profile/JD/negotiation FORBIDDEN), never
// unknown_answer or a profile answer (benchmark 2026-06-05 context leaks).
const MEETING_PATTERNS = [
  /\b(action items?|next steps?|to-?dos?)\b/i,
  /\bwhat did we (decide|agree|conclude|discuss|cover|say)\b/i,
  /\bwhat (was|were) (decided|agreed|discussed|the takeaways?)\b/i,
  /\bwhat decisions? (was|were|did)\b|\bwhat (was|were) the decisions?\b/i,
  // "summarize the last 5 minutes" → meeting recap, BUT not when it names the
  // lecture/class (that's a lecture summary — handled by LECTURE_PATTERNS).
  /\bsummari[sz]e (the )?(last|previous|past)\b(?!.*\b(lecture|class|professor|slide|chapter)\b)|\bsummari[sz]e (the )?(meeting|call|discussion|conversation)\b/i,
  /\bwhat (was|is) the customer (asking|saying|wanting)\b/i,
  /\bwhat should i (say|do|answer) (next )?(in this|in the) (meeting|call)\b/i,
  /\bwhat did (the )?(interviewer|client|customer|they) mean\b/i,
  // "who owns the next step", "who is taking X", "who's responsible" — ownership of
  // meeting action items (release 2026-06-07).
  /\bwho (owns|is taking|is responsible for|has|will (do|own|take|handle))\b/i,
  // "what did <Name> ask/say/want", "what was <Name>'s point" — referencing a
  // speaker in the meeting transcript.
  /\bwhat did [A-Z][a-z]+ (ask|say|want|mean|raise|bring up|propose)\b/i,
  /\bwhat (are|were) the (open questions?|next steps? for|takeaways?)\b/i,
  /\b(write|draft|send) (a |the )?(follow[- ]?up|recap|summary|meeting) (email|note|message|mail)\b/i,
  /\brecap\b|\bcatch me up\b/i,
];

export // Profile FACT lookups (education, target role) — short factual answers
// (benchmark 2026-06-05): "where did you study?", "what role are you applying
// for?", "what's your degree?".
const PROFILE_FACT_PATTERNS = [
  /\bwhere did (you|i) (study|go to (school|college|university)|graduate)\b/i,
  /\bwhat (role|job|position) (are|am) (you|i) (applying|interviewing) for\b/i,
  /\bwhat(?:'s| is) (your|my) (degree|major|gpa|cgpa|grade\s*point|qualification)\b/i,
  // Recruiter logistics / factual probes (release 2026-06-07 multimode-1000):
  // qualification, graduation, location, relocation, notice period, current title,
  // years of experience, last company, area of focus.
  /\bwhat(?:'s| is) (your|my) (highest )?(qualification|education|background)\b/i,
  /\bwhen did (you|i) graduate\b|\bwhat year did (you|i) (graduate|finish)\b/i,
  /\bwhat(?:'s| is) (your|my) (current )?(location|city|base|notice period|current title|current role|area of focus|special4?ation|focus area)\b/i,
  /\b(are|r) (you|u) (open to|willing to|up for) relocat\w*\b|\bwould (you|u) relocate\b/i,
  /\bhow many years (of )?(experience|exp)\b|\bwhat(?:'s| is) (your|my) (years of )?experience\b/i,
  /\bwhat (was|is) (your|my) (last|current|previous) (company|employer|job|role|title)\b/i,
  /\bwhere (are|r) (you|u) (based|located)\b|\bwhat(?:'s| is) (your|my) availability\b/i,
];

export // Sales: pricing/product/competitor/objection questions (spec Case G). Uses sales
// context, NOT resume/JD/negotiation. The active mode also signals sales, but the
// answerType lets the selector exclude resume/salary regardless of mode.
const SALES_PATTERNS = [
  // Commercial terms. NOTE: bare "deal" is EXCLUDED (it collides with "deal with
  // pressure/ambiguity" — a behavioral ask; 1000-q benchmark 2026-06-06b). A sales
  // "deal" needs a commercial qualifier ("close the deal", "the deal/discount").
  /\b(pricing|price|cost|expensive|cheaper|discount|quote|contract|close the deal|the deal\b|better deal|a deal on)\b/i,
  /\bcompare(?:d)?\s+(?:to|with|against)\s+(?:your\s+|the\s+|other\s+)?competitors?\b|\bvs\.?\s+(?:a\s+)?competitors?\b|\bcompetitors?\b/i,
  /\b(your|the) product\b.*\b(do|offer|cost|price|compare|better|why)\b/i,
  // "why should we buy/choose/pick X" is sales ONLY when X is a product/vendor.
  // "why should we pick YOU (over other candidates)" is the canonical why-hire
  // question and must fall through to JD_FIT (benchmark 2026-06-12
  // wta_jdfit_030 false-refusal: sales_answer forbids the resume, so the model
  // claimed nothing was loaded). "pick you guys" (the vendor) stays sales via
  // the inner exception.
  /\bwhy (should|would) (i|we) (buy|choose|pick|go with)\b(?!\s+(?:you|me)\b(?!\s+guys))/i,
  // "why should a customer/prospect/buyer choose/buy …" — the seller rehearsing
  // the value pitch (manual regression 2026-06-12 set 17). The subject being a
  // CUSTOMER (not i/we) makes it unambiguous sales.
  /\bwhy (should|would|will) (a |the |any )?(customer|prospect|client|buyer)s?\b.{0,30}\b(choose|buy|pick|go with|select|switch)\b/i,
  /\b(roi|return on investment|value proposition|use case)\b/i,
  // Objection-handling & deal/close/sell coaching (release 2026-06-07 multimode-1000):
  // "how do you handle this objection", "handle the objection that X", "how do we
  // close this deal", "how would you sell this to a recruiter", "what's the pitch".
  /\b(handle|address|respond to|overcome|deal with) (this |that |the |an? |their )?objection\b/i,
  /\bobjection (that|about|is|handling)\b/i,
  /\bhow (do|would|should) (we|you|i)\b.{0,30}\b(close (the|this) deal|sell (this|it)|pitch (this|it)|sell to|upsell)\b/i,
  /\bhow (would|do) you sell\b|\bwhat(?:'s| is) the (pitch|sales pitch|sell)\b/i,
  /\bfounder credibility\b|\b(give me|write) (a )?(founder|sales|pitch) (answer|response|credibility)\b/i,
  // "what should I say to a customer who says X / when the prospect objects" — sales
  // objection coaching (release 2026-06-07 multimode-1000).
  /\bwhat should i say to (a |the )?(customer|prospect|client|lead|buyer)\b/i,
  /\b(customer|prospect|client) (says?|objects?|asks?|complains?)\b.{0,40}\b(too (slow|expensive|hard|much)|not (sure|interested)|why|how)\b/i,
];

export // PRODUCT + CANDIDATE MIX (Issue 5): "why is your PROFILE good for selling this
// product?", "why are you CREDIBLE to sell this?", "why are you the right FOUNDER
// for this product?". These mix candidate credibility with a product/sales
// frame — they must NOT route to profile_fact (which would dump the résumé).
// Founder credibility is allowed, but as framing (persona/custom), not a profile
// list — the layer table forbids resume/jd/negotiation.
const PRODUCT_CANDIDATE_MIX_PATTERNS = [
  /\bwhy (is|are) (your|you)\b.*\b(profile|background|experience|credible|qualified|right (founder|person))\b.*\b(sell|selling|sell this|this product|pitch|founder)\b/i,
  /\bwhy (are|r) (you|u)\b.*\b(credible|the right founder|qualified)\b.*\b(sell|selling|this product|pitch)\b/i,
  /\bwhy (are|r) (you|u) the right founder\b/i,
  /\b(your|you) (profile|background|credibility)\b.*\b(good for|right for) (selling|pitching|this product)\b/i,
  /\bwhy (should|would) (i|we|they) (buy from|trust) (you|your)\b/i,
];

export // Lecture: questions about lecture/slide/lecture material (spec Case H). Uses
// lecture materials + screen + reference files, NOT resume/JD/negotiation.
const LECTURE_PATTERNS = [
  /\b(this slide|the slide|lecture slide|this diagram|the diagram|the professor|the lecturer|the lecture|lecture)\b/i,
  /\bwhat (did|does) (the )?(professor|lecturer|teacher) (mean|say)\b/i,
  /\bon (the|this) (slide|board|screen)\b/i,
  // Exam/study-domain asks that are lecture-mode regardless of an active-mode signal
  // (release 2026-06-07 multimode-1000): "give me a 6/12-mark answer", "what are the
  // exam points", "make notes", "what should I revise", "summarize this concept".
  /\b(give me |write )?(an? )?\d+[- ]?marks?\s+(answer|question|response)\b|\bfor \d+ marks?\b/i,
  /\b(what are|whats?) the (exam|key) (points?|takeaways?)\b|\bexam (points?|answer|prep|revision)\b/i,
  /\bmake (me )?notes?\b|\btake notes?\b|\bclass notes?\b/i,
  /\bwhat should i revise\b|\bwhat (to|should i) study\b|\brevise for (the )?(exam|test)\b/i,
  /\bsummari[sz]e (this|the) (concept|topic|chapter|lesson|material|reading)\b/i,
  /\bexplain (this|the) (concept|topic) (like|as|for) (an? )?(exam|student)\b/i,
];

export const FOLLOW_UP_PATTERNS = [
  /\b(that|this) (project|approach|answer|solution)\b|\bcan you (expand|optimize|dry run|explain)\b|\bwhat about complexity\b|\bwhy did you choose\b/i,
  // Bare imperative refinements of the prior answer (release 2026-06-07): "now
  // optimize it", "optimize this", "make it faster", "improve it", "expand on that".
  /^(?:(?:ok(?:ay)?|so|now|right|alright)[\s,]*)*(?:optimi[sz]e|improve|refactor|simplify|expand|elaborate|continue|go deeper)\b[\s\w]{0,20}(it|this|that|further|more)?[\s?.!]*$/i,
  /\b(now |then )?(optimi[sz]e|improve|refactor|speed up|make .{0,10}faster) (it|this|that)\b/i,
  // VOICE-CONTROL / EVIDENCE-CONTROL coaching directives (Issue 8) — "answer like
  // a candidate, not like an assistant", "say what I should say but in my voice",
  // "make it sound confident but don't lie", "if no metric is there answer
  // without fake metric". These modify HOW the prior answer is delivered; they
  // resolve against the prior turn in the live path.
  /\banswer (like|as) a candidate\b|\bnot (like|as) an? assistant\b/i,
  /\bsay what i should say\b|\bin my (own )?voice\b/i,
  /\b(without|no) (fake|made[- ]?up|invented) (metric|number|stat)/i,
  /\bif no metric is there\b/i,
  /\bsound confident but (don'?t|do not) lie\b/i,
  /\bmake it (sound )?(confident|natural|concise)\b/i,
  // BARE follow-up fragments (Issue 8) — "why?", "how so?", "and X?", "what about
  // X?". On their own they're ambiguous, but they are ALWAYS follow-ups (never a
  // standalone question), so route to follow_up_answer instead of unknown. In the
  // live path the FollowUpResolver runs first and resolves them to a concrete
  // type using the prior turn; this is the no-prior-context floor.
  /^(?:(?:ok(?:ay)?|so|hmm|right|alright|cool|yeah)[\s,]*)*(?:why|how so|how come)\b[\s?.!]*$/i,
  /^(?:(?:ok(?:ay)?|so|hmm|right|yeah|cool)[\s,]*)*(?:and|what about|how about)\s+[\w +#.]{1,30}\??$/i,
  // Bare continuation fragments — "go on", "continue", "tell me more", "and?",
  // "keep going", "more" (1000-q 2026-06-06b). Always a follow-up, never standalone.
  /^(?:(?:ok(?:ay)?|so|hmm|right|yeah|cool|um)[\s,]*)*(?:go on|continue|keep going|tell me more|more|and\??|then\??|next)\b[\s?.!]*$/i,
  // BARE "what should I say/answer?" with NO embedded question — the canonical
  // live "what's my next line?" trigger. With no prior turn it carries no signal,
  // so it's the follow_up floor (profile FORBIDDEN, resolved live by prior turn).
  // A LONGER form that embeds the actual ask ("what should I say if they ask about
  // SQL?") is handled by INDIRECT_COACHING in the unmatched fallback, not here.
  /^(?:(?:ok(?:ay)?|so|hmm|right|alright|cool|yeah|um)[\s,]*)*what should i (say|answer|respond)\b[\s?.!]*$/i,
];
