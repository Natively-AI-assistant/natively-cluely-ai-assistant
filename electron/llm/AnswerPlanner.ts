import type { IntentResult } from './IntentClassifier';
import type { ExtractedQuestion } from './transcriptQuestionExtractor';
import { CODING_CONTRACT, CODING_CONTRACT_IMPL, CODING_VERIFICATION_INSTRUCTION } from './codingContract';
import { detectAnswerStyle, type AnswerStyle } from './answerStyle';
import { classifyTargetSpeakability, classifyShortBand, shortBandTargetWords } from './speakability';
import { applyModeFallback, type ActiveModeInfo } from './modeProfiles';
import { classifyDocumentQuestionShape } from './documentGroundedPrompt';

export type AnswerType =
  | 'identity_answer'
  | 'profile_fact_answer'
  | 'project_answer'
  | 'skills_answer'
  | 'skill_experience_answer'
  | 'experience_answer'
  | 'jd_fit_answer'
  | 'gap_analysis_answer'
  | 'behavioral_interview_answer'
  | 'project_followup_answer'
  | 'coding_question_answer'
  | 'dsa_question_answer'
  | 'technical_concept_answer'
  | 'system_design_answer'
  | 'debugging_question_answer'
  | 'negotiation_answer'
  | 'sales_answer'
  | 'product_candidate_mix_answer'
  | 'lecture_answer'
  | 'definitional_answer'
  | 'list_answer'
  | 'exact_numeric_answer'
  | 'document_absent_fact_refusal'
  | 'document_followup_answer'
  | 'follow_up_answer'
  | 'unknown_answer'
  | 'general_meeting_answer'
  // Release 2026-06-06b (real manual-chat log fixes):
  // A request for a project's public link / repo / website. Shares a loaded URL
  // (source-available/public/user-provided), or says the link isn't loaded — NEVER
  // refuses with "I can't share that" and NEVER invents a URL.
  | 'project_link_answer'
  // A request for the ACTUAL source code of a loaded project ("a snippet you used
  // to build Natively", "repo-verifiable code"). Must retrieve real source if
  // loaded + cite it, else say exact source isn't loaded and label any demo
  // conceptual — NEVER present generic code as the real implementation.
  | 'source_code_evidence_answer'
  // A safety route for stealth / undetectability / proctoring-evasion asks. Must
  // decline to help hide the tool from an interviewer or bypass detection, and
  // redirect to privacy-first / consent / transparency / low-distraction themes.
  | 'ethical_usage_answer'
  // A question ABOUT the product/project itself ("what kind of app is Natively?",
  // "how's its backend?") — grounded in loaded project metadata, no overclaim.
  | 'project_about_answer';

export type AnswerSource = 'manual_input' | 'what_to_answer' | 'transcript' | 'system';
export type SpeakerPerspective = 'candidate' | 'interviewer' | 'user' | 'assistant' | 'unknown';
export type OutputPerspective = 'first_person_candidate' | 'second_person_user' | 'assistant_explanation';

// Phase 2: voice is SEPARATE from profile-context usage. A question can need the
// candidate's first-person interview voice WITHOUT needing any profile facts
// (e.g. "how would you use GraphQL?" — speak as the candidate, but invent no
// resume). `outputPerspective` (above) is kept as a backward-compatible alias of
// `voicePerspective` for existing call sites.
export type VoicePerspective =
  | 'first_person_candidate'   // speak AS the candidate ("I would…", "I built…")
  | 'second_person_user'       // assistant telling the user about themselves ("Your name is…")
  | 'assistant_explanation'    // neutral explanation (coding, teaching, sales, lecture)
  | 'third_person_summary';    // summarising others (meeting recap)

// Phase 2: whether the user's PROFILE (resume/JD/projects/experience) may ground
// the answer. Decoupled from voice. `forbidden` is a HARD rule the execution
// path enforces (coding/technical/sales/lecture get NO profile, spec §8.3).
export type ProfileContextPolicy =
  | 'required'    // the answer is ABOUT the user — profile MUST ground it
  | 'allowed'     // profile may help but isn't mandatory (negotiation evidence, general)
  | 'forbidden';  // profile must NOT be injected (coding/technical/sales/lecture)
export type ContextLayer =
  | 'stable_identity'
  | 'resume'
  | 'jd'
  | 'custom_context'
  | 'ai_persona'
  | 'negotiation'
  | 'reference_files'
  | 'live_transcript'
  | 'prior_assistant_responses'
  | 'active_mode'
  | 'screen_context'
  | 'preferred_language';

export interface AnswerPlan {
  answerType: AnswerType;
  source: AnswerSource;
  speakerPerspective: SpeakerPerspective;
  /** @deprecated Backward-compatible alias of `voicePerspective` (Phase 2). */
  outputPerspective: OutputPerspective;
  /** Phase 2: how the answer should SPEAK (voice), independent of profile usage. */
  voicePerspective: VoicePerspective;
  /** Phase 2: whether the user's PROFILE may ground the answer (required|allowed|forbidden). */
  profileContextPolicy: ProfileContextPolicy;
  /**
   * Phase 5: the project/entity a follow-up resolves to ("how is IT developed?"
   * → "Natively"). Set for project_followup_answer; undefined otherwise. Used to
   * scope grounding to the right project node without re-asking the model.
   */
  resolvedEntity?: string;
  requiredContextLayers: ContextLayer[];
  forbiddenContextLayers: ContextLayer[];
  responseTemplate: string;
  /**
   * Latency budget for the first useful token, in ms (the target the live path
   * is held to). Named per REPORT_TO_CHATGPT Phase 5; `maxInitialLatencyMs` is
   * kept as a deprecated alias for any external reader.
   */
  maxFirstUsefulTokenMs: number;
  /** @deprecated alias of maxFirstUsefulTokenMs — kept for compatibility. */
  maxInitialLatencyMs: number;
  requiresLLM: boolean;
  canUseFastPath: boolean;
  /**
   * True for structured answer types (coding/DSA/system-design/debugging) where
   * the UI must paint a deterministic section scaffold BEFORE any model token,
   * so the user never sees code-first / malformed markdown mid-stream.
   */
  shouldShowImmediateScaffold: boolean;
  question: string;
  confidence: number;
  /**
   * Release 2026-06-08: the requested ANSWER STYLE/length detected from the question
   * phrasing ("quickly", "in detail", "one line", "code only", "bullet points",
   * "explain to a beginner"). Shapes FORM only — never routing, voice, grounding, or
   * leak boundaries. 'default' when no explicit cue is present.
   */
  answerStyle: AnswerStyle;
  /** Soft spoken-length target in seconds (0 = no explicit constraint). */
  answerStyleTargetSeconds: number;
  /** True when a user-created custom mode requires uploaded/reference files as source of truth. */
  documentGroundedCustomModeActive?: boolean;
}

export interface PlanAnswerInput {
  question?: string | null;
  source: AnswerSource;
  speakerPerspective?: SpeakerPerspective;
  extractedQuestion?: ExtractedQuestion | null;
  intentResult?: IntentResult | null;
  hasCandidateProfile?: boolean;
  hasJobDescription?: boolean;
  hasNegotiationContext?: boolean;
  /**
   * PI v3 (W1): the active ModesManager mode, used as a routing PRIOR on the
   * classification FALLTHROUGH only (modeProfiles.applyModeFallback). Explicit
   * answer-type signals always win; the mode never relaxes a forbidden layer.
   * Optional — absent keeps the mode-blind behavior byte-for-byte.
   */
  activeMode?: ActiveModeInfo | null;
}

// Derives from the single canonical CODING_CONTRACT (codingContract.ts) so the
// planner's template can never drift from the prompts/validator. Adds the two
// answer-contract rules that are planner-specific (no context leakage, no
// Natively mention) on top of the shared section spec.
// NOTE: the hidden <verification_spec> instruction is appended at PROMPT-BUILD
// time (formatAnswerPlanForPrompt) only when code verification is enabled, so a
// disabled kill-switch also stops the model wasting tokens emitting the spec.
// Keeping it OUT of this base template also keeps AnswerPlanner pure/testable.
const CODING_TEMPLATE = `You are generating a live coding interview answer.

${CODING_CONTRACT}

Additional rules:
- Do not include resume, JD, salary, negotiation, or unrelated profile context unless explicitly asked.
- NEVER mention "Natively", the assistant, the product, or the candidate's profile/projects anywhere in the answer — not in the explanation, not in a closing remark, not in an example. This is a pure technical answer about the algorithm only.`;

// General implementation tasks (React components, scripts, utilities) get the
// IMPL contract: code-first with the correct fence tag, short explanation, NO
// DSA interview walkthrough. dsa_question_answer keeps CODING_TEMPLATE — named
// algorithm problems ("reverse a linked list") still want the six sections.
const CODING_IMPL_TEMPLATE = `You are generating a complete implementation for a coding task.

${CODING_CONTRACT_IMPL}

Additional rules:
- Do not include resume, JD, salary, negotiation, or unrelated profile context.
- NEVER mention "Natively", the assistant, the product, or the candidate's profile anywhere in the answer.`;

const BEHAVIORAL_TEMPLATE = `Use exactly these sections:

Direct Answer:
[One clear first-person answer.]

Strong Example / STAR:
[Situation, task, action, result using only grounded candidate facts.]

Why It Matters For This Role:
[Connect to the role only if JD context is present.]

Short Closing Line:
[One speakable closing sentence.]`;

// Phase 3: a dedicated PROJECT template — project questions are NOT behavioral
// STAR stories. Name the project, what was built, the (grounded) stack, the
// candidate's personal role, and a grounded outcome — never an invented metric.
const PROJECT_TEMPLATE = `Use exactly these sections:

Best / Relevant Project:
[Directly name the project from the grounded profile.]

What I Built:
[One concise first-person explanation of what the project is.]

Tech Stack:
[Technologies used — ONLY those present in the grounded project facts.]

My Role:
[What the candidate personally did. First person.]

Impact / Why It Matters:
[A grounded outcome or value. NEVER invent metrics, percentages, or numbers.]

Speakable Final Answer:
[A 2-4 sentence first-person version the candidate can say aloud.]`;

// Phase 5: project FOLLOW-UP — drilling into a project already named. Answer the
// specific drill-in (how built / role / stack / hardest part / why / learnings)
// in first person, grounded ONLY in that project's facts and the prior turn.
const PROJECT_FOLLOWUP_TEMPLATE = `You are answering a live FOLLOW-UP about a specific project the candidate already mentioned.

Rules:
- Answer the EXACT drill-in asked (how it was built, your role, the tech stack, the hardest part, why you built it, what you learned, optimisation) in FIRST PERSON.
- Stay on the SAME project being discussed; do not switch projects.
- Use ONLY grounded project facts. Never invent metrics, dates, team sizes, or technologies that are not in the project's facts.
- Keep it concise and speakable (2-5 sentences). No headers unless the question asks for a breakdown.`;

const JD_FIT_TEMPLATE = `Use exactly these sections:

Short Fit Summary:
[Concise fit statement.]

Matching Experience:
[Grounded candidate experience relevant to the role.]

Matching Skills/Projects:
[Grounded skills/projects mapped to JD needs.]

Why This Role:
[Specific motivation tied to JD/company context.]

Speakable Final Answer:
[Polished first-person answer the candidate can say.]`;

// GAP / weakness-for-the-role. The answer must LEAD with an honest, specific gap, then
// a concrete mitigation — NOT a fit-summary. First person. Grounds the gap against the
// JD and the candidate's real profile; pivots to adjacent strength only AFTER the gap
// is clearly stated. Never invents experience; never stalls. (Release 2026-06-09.)
const GAP_ANALYSIS_TEMPLATE = `This is a GAP question, not a "why hire me" question. Lead with the honest gap.
Use exactly these sections:

The Honest Gap:
[Name ONE specific, JD-relevant gap or area you're less experienced in. Be concrete (a tool, domain, or depth of experience the JD wants that your profile shows less of). Do NOT pretend you have no gaps. Do NOT turn this into a fit-summary.]

Why It's Manageable:
[Briefly, the adjacent/real experience that makes you confident you can close it fast — grounded in your actual profile, no invented experience.]

How I'd Close It:
[A specific, realistic mitigation/ramp plan.]

Speakable Final Answer:
[A confident-but-honest first-person answer the candidate can say out loud: gap first, then mitigation. Do not say "let me come back to that".]`;

const NEGOTIATION_TEMPLATE = `Use exactly these sections:

Polite Opening:
[Acknowledge the question or offer professionally.]

Flexible Range / Expectation:
[State grounded target/range if available, otherwise preserve flexibility.]

Justification:
[Brief value-based justification.]

Closing:
[Collaborative next step.]`;

const SYSTEM_DESIGN_TEMPLATE = `Use exactly these sections:

Clarify Requirements:
[State the most important assumptions or questions.]

High-Level Design:
[Architecture overview.]

Core Components:
[Main services/components and responsibilities.]

Data Flow:
[How requests/data move through the system.]

Scaling / Reliability:
[Scale, fault tolerance, observability.]

Tradeoffs:
[Key design tradeoffs.]

Follow-up Points:
[Likely interviewer follow-ups.]`;

const DEBUGGING_TEMPLATE = `Use exactly these sections:

Likely Cause:
[Most probable root cause.]

How I Would Investigate:
[Concrete debugging steps.]

Fix:
[Specific fix or mitigation.]

Validation:
[How to prove it works.]

Prevention:
[How to prevent recurrence.]`;

const DIRECT_SHORT_TEMPLATE = `Answer directly in 1-2 sentences. Do not include irrelevant context. Do not mention loaded context.`;
// Skill experience / self-rating asks ("rate Python out of 10", "how strong is your
// SQL?"). The model must answer AS THE CANDIDATE with a confident, concrete rating —
// NEVER refuse as "an AI assistant" or say it "cannot assign ratings" (release
// 2026-06-07: flash-lite was declining skill ratings). Ground the rating in the
// loaded experience; speak to the user about their own skill.
const SKILL_RATING_TEMPLATE = `Answer in 1-2 sentences as the candidate. If asked to rate a skill (e.g. "out of 10"), GIVE a concrete number grounded in the loaded experience and add one phrase of justification. Never refuse, never say you are an AI or that you "cannot assign ratings". Do not mention the profile/context explicitly — just answer confidently.`;
const GENERAL_TEMPLATE = `Answer naturally and directly. Use only relevant context. Keep it predictable and concise.`;
const DOCUMENT_DEFINITION_TEMPLATE = `Answer from the uploaded document evidence only. Give a concise definition in 1-3 sentences. Prefer text that explicitly defines the term ("is", "are", "refers to", "represents") and do not drift into procedures or training details unless the question asks for them.`;
const DOCUMENT_LIST_TEMPLATE = `Answer from the uploaded document evidence only. Return the complete list the question asks for. Scan every retrieved excerpt before answering; include all listed items, phases, questions, models, objects, or components that are literally present. Do not stop at the first matching excerpt and do not invent missing list items.`;
const DOCUMENT_NUMERIC_TEMPLATE = `Answer from the uploaded document evidence only. Report exact values with units and the entity they belong to. If multiple related values are present (training/peak/inference, control/sampling, per-model rates), include all of them. Do not infer numbers that are not written in the evidence.`;
const DOCUMENT_ABSENT_FACT_TEMPLATE = `Answer from the uploaded document evidence only. If the requested fact is not supported by the selected evidence after retrieval, say exactly and briefly that it is not directly mentioned in the uploaded seminar material. Do not provide a plausible estimate or use general knowledge.`;
const DOCUMENT_FOLLOWUP_TEMPLATE = `Answer the follow-up from the uploaded document evidence only. Resolve pronouns like "it", "that", and "they" using the immediately previous topic, but treat the prior answer only as a referent hint — facts must come from the retrieved document excerpts.`;

// Generic technical-concept answers (what is Redis / JWT / CORS / caching / REST) were
// coming back as long beginner TUTORIALS. In an interview the user needs a short, confident
// spoken answer, not a classroom lesson (spoken-answer-quality sprint 2026-06-15).
const TECHNICAL_CONCEPT_TEMPLATE = `You are the candidate SPEAKING this answer aloud to an interviewer. Give the exact words you'd SAY — a short, plain spoken answer, NOT documentation.

THIS IS A SPOKEN ANSWER. Output MUST be ONE short paragraph of plain sentences. It is WRONG if it contains ANY of these:
- a markdown heading (## or **Heading**)
- a bullet list or a numbered list
- a "Key Concepts" / "How it works" / "Common use cases" / "Performance" section
- a code block or a code example
- a table

Shape:
- 2 to 4 sentences, usually 40 to 80 words. If a single sentence answers it, stop there.
- Sentence 1 is a plain one-line definition. Then at most one or two sentences with the single most relevant tradeoff or use, woven into prose.
- No analogy unless the user asked for simple terms / "explain like I'm 5".

Example of the RIGHT shape (for "what is Redis?"):
"Redis is an in-memory key-value store, so reads and writes are extremely fast. People mostly use it for caching, sessions, and rate limiting, and the main tradeoff is that it lives in memory, so you watch cost and what data really belongs there."

Sound like a competent engineer answering quickly in conversation — calm, specific, done in about 20 seconds.`;

// SALES voice (manual regression 2026-06-12): real sales-mode sessions answered
// "why is your product expensive?" with "I'm Natively, an AI assistant. I don't
// have a product or pricing model" — the model fell back to its system identity
// because sales_answer had no template telling it WHO it is in this turn. The
// seller speaks as the PRODUCT/TEAM REP, grounded in the active mode's product
// material (custom context / reference files); the resume/JD stay forbidden.
const SALES_TEMPLATE = `You are the SELLER'S spoken voice in a live sales/commercial conversation. The user is selling a product; the question comes from a customer or prospect.

Rules:
- Speak in FIRST PERSON as the product's representative ("our product", "we", "our pricing"). You are NOT an AI assistant in this answer and must NEVER say "I'm Natively", "as an AI", or "I don't have a product" — the user's product context defines the product.
- Ground product claims in the provided mode/custom/reference context. If pricing or a specific fact isn't in the context, handle it like a real seller: acknowledge, reframe around value, and offer to follow up with specifics — never claim the product doesn't exist.
- Handle objections (price, speed, competitors) with empathy + value reframe + one concrete differentiator from the context when available.
- 2-5 sentences, confident, speakable, no headings or bullet markers unless asked.
- Never pull the user's resume, JD, or salary data into a sales answer.`;

// Release 2026-06-06b — safety route for stealth/undetectability/evasion asks.
const ETHICAL_USAGE_TEMPLATE = `The user is asking how to make this tool hidden, undetectable, invisible to an interviewer, or how to evade detection / proctoring / screen-share / network monitoring.

You MUST NOT provide any guidance for hiding the tool from an interviewer, making it undetectable, evading screen-share or proctoring detection, bypassing monitoring, or otherwise using it to deceive or cheat. Do not describe hidden overlays, transparency tricks, secondary-monitor concealment, virtual-device evasion, or network-evasion.

Instead, in 2-4 sentences:
1. Briefly and politely decline to help make it undetectable or hidden from an interviewer.
2. Redirect to what IS supported: privacy-first design, on-device/local processing, clear permissions and consent, a low-distraction minimal UI, accessibility, and transparent, user-controlled use in meetings.
3. Note that the tool should be used openly and ethically, not to deceive interviewers or bypass rules.

Do NOT lecture at length. Be concise, helpful, and firm.`;

// Release 2026-06-06b — project link / repo / public URL.
const PROJECT_LINK_TEMPLATE = `The user is asking for a project's link, repository, GitHub, website, or source URL.

Rules:
- ONLY share a URL that is actually present in the provided project/profile/custom context. Quote it verbatim.
- If NO URL is loaded for the relevant project, say plainly: "I don't have the repository/link loaded in my current profile context." Optionally add: "If you add it to the project metadata I can share it."
- NEVER invent or guess a GitHub/GitLab/website URL from the project name.
- NEVER say "I can't share that information" — a missing link is "not loaded", not "forbidden", unless the context explicitly marks the link private.
Keep it to 1-2 sentences.`;

// Release 2026-06-06b — actual source-code evidence requests.
const SOURCE_CODE_EVIDENCE_TEMPLATE = `The user is asking for the ACTUAL source code / a real snippet used in a loaded project (possibly to cross-verify against a public repo).

Rules:
- If the exact source code for the project is present in the provided context (reference files / loaded source), quote the relevant real snippet, name the file it came from, and add a one-line explanation. Do not modify it unless asked.
- If the exact source code is NOT loaded, say clearly: "I don't have Natively's exact source code loaded in my current context, so I can't give you a repo-verifiable snippet." Then, ONLY IF it helps, offer a clearly-labeled CONCEPTUAL example: prefix it with "Here's a conceptual illustration (NOT the actual repo code):".
- NEVER present a generic/conceptual snippet as if it were the real implementation.
- NEVER invent file names, function names, or claim a snippet is "from the repo" when it is not loaded.
Be honest about what is and isn't available.`;

// Release 2026-06-06b — questions ABOUT the product/project itself.
const PRODUCT_ABOUT_TEMPLATE = `The user is asking about the product/project itself (what kind of app it is, its backend, architecture, or tech).

Ground every concrete claim in the provided project/profile metadata. If the metadata describes it (e.g. "privacy-first, source-available, local RAG, Electron + Rust core, Ollama, SQLite"), you may state those. If a detail is NOT in the loaded context, do not invent it — say "from the loaded project description…" and stay within what's described, or note that a specific detail isn't in your loaded context. Distinguish the desktop app core from any local services and any separately-loaded cloud/API path. Keep it concise and concrete.`;

const includesAny = (text: string, patterns: RegExp[]): boolean => patterns.some(pattern => pattern.test(text));

// CS/technical subject terms that, when combined with explain/what-is framing,
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
  /\b(rest|graphql|grpc|microservice|monolith|cache|caching|cdn|load balanc|rate limit\w*|rate[- ]?limiter|message queue|pub[- ]?sub|webhook|idempoten\w*|backpressure|circuit breaker)\b/i,
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
const isLikelyTechnicalConcept = (text: string): boolean => includesAny(text, TECHNICAL_SUBJECT_PATTERNS);

const DSA_PATTERNS = [
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

const COMMON_CODING_PROBLEM_PATTERNS = [
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
  /\blevel order\b|\bin\s?order\b|\bpre\s?order\b|\bpost\s?order\b|\btraversal\b/i,
  /\bgcd\b|\blcm\b|\bgreatest common divisor\b/i,
  /\bbubble sort\b|\bquick\s?sort\b|\bmerge sort\b|\binsertion sort\b/i,
];

const CODING_PATTERNS = [
  /\b(write|implement|code|program|function|class|method|solve)\b/i,
  /\bcode for\b|\bprogram for\b|\bfunction for\b|\balgorithm for\b/i,
  /\balgorithm\b|\bdebug this\b|\bfix (this|the) bug\b/i,
  // A bare language name is NOT a coding signal on its own — "how would you use
  // SQL", "explain SQL", "have you used Python" are concept/experience asks, not
  // "write code" tasks. Only treat a language as coding when paired with an
  // explicit coding verb so the bare name can't hijack technical_concept /
  // skill_experience / jd_fit routing (benchmark 2026-06-05).
  /\b(write|implement|code|coding|program|snippet|function|script|reverse|sort|parse)\b[\w ,'-]*\b(javascript|typescript|python|java|c\+\+|sql|go|golang|rust)\b/i,
  /\bin (javascript|typescript|python|java|c\+\+|sql|golang|rust)\b[\w ,'-]*\b(write|code|implement|function|program)\b/i,
  ...COMMON_CODING_PROBLEM_PATTERNS,
];

const SYSTEM_DESIGN_PATTERNS = [
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

const DEBUGGING_PATTERNS = [
  /\bdebug\b|\broot cause\b|\bwhy.*(failing|crashing|broken)\b/i,
  /\berror\b|\bexception\b|\bstack trace\b|\bbug\b/i,
  // "why is my API returning 500 / a 404 / errors intermittently", "why does X
  // return <status>", "why is my <thing> slow/timing out" (release 2026-06-07).
  /\bwhy (is|does|are|do)\b.{0,40}\b(return\w*|throw\w*|fail\w*|crash\w*|hang\w*|timing out|time out|timeout|slow|leak\w*|intermittent\w*)\b/i,
  /\breturn\w*\s+(a\s+)?(4\d\d|5\d\d)\b|\b(4\d\d|5\d\d)\s+(error|status|response|intermittent\w*)\b/i,
  /\bwhy.*(not working|isn'?t working|won'?t work|keeps? (failing|crashing|breaking))\b/i,
];

const NEGOTIATION_PATTERNS = [
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

const IDENTITY_PATTERNS = [
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

// ── SAFETY: stealth / undetectability / proctoring-evasion (release 2026-06-06b) ──
// Asking how to hide the tool from an interviewer, make it undetectable/invisible
// in a screen share, evade detection/proctoring/network-monitoring, or otherwise
// cheat covertly. These route to `ethical_usage_answer` (a safe decline + redirect
// to privacy/consent/transparency). Checked FIRST so a stealth ask can never reach
// a route that would give specific evasion advice. The phrasing must combine an
// EVASION verb/adjective with an interview/screen/detection OBJECT so legitimate
// product questions ("is it low-distraction?", "does it process locally?") are
// unaffected.
// An EVASION token — wanting the tool unseen/undetected/concealed, OR a covert /
// cheat / "get caught" / "under the radar" / "without them knowing" intent. Kept
// broad on purpose: a missed stealth ask reaches the generic LLM with no decline
// contract, so over-coverage (a few false safety-redirects) is far safer than
// under-coverage (code-review 2026-06-06b CRITICAL). Soft verbs (notice / see /
// realize / nobody / discreet / secret) are included.
const STEALTH_INTENT_RE = /\b(undetect\w*|undetectible|undectable|invisible|invisibility|conceal\w*|covert\w*|stealth\w*|sneak\w*|discree\w*|secret\w*|surreptitious\w*|cheat\w*|hide\b|hidden\b|hiding\b|off[- ]?screen|keep (?:this|it|natively|the (?:app|tool|overlay)) off|under the radar|on the (?:dl|down[- ]?low)|(?:avoid|evade|bypass|beat|get around|defeat|fool|trick|dodge|escape)\s+(?:being\s+|getting\s+|the\s+)?(?:caught|seen|noticed|detected|detection|proctor\w*|monitor\w*|virtual (?:mic|microphone|camera)|network|webcam|camera)|without (?:them|the interviewer|anyone|him|her|people) (?:know|notic|see|find)\w*|so (?:nobody|no one|they|the interviewer|he|she) (?:can'?t|won'?t|doesn'?t|don'?t) (?:see|notice|detect|catch|find|know)|(?:not|don'?t|won'?t|can'?t) (?:get|getting|be) caught|avoid (?:being |getting )?(?:caught|seen|noticed|detected)|nobody (?:sees|notices|knows)|no one (?:sees|notices|knows))\b/i;
// An INTERVIEW / detection OBJECT — the thing the user wants to evade.
const STEALTH_OBJECT_RE = /\b(interview\w*|proctor\w*|invigilat\w*|recruiter|examiner|screen[- ]?shar\w*|screenshar\w*|share my screen|sharing my screen|webcam|web cam|camera|monitor\w*|detection|second(?:ary)? (?:screen|monitor|display)|virtual (?:mic|microphone|camera)|network monitor\w*|the (?:call|meeting|assessment|exam|test)|video call|video[- ]?conferenc\w*|zoom|google meet|ms teams|teams call)\b/i;
// SOFT visibility verbs paired with an interview object even WITHOUT an explicit
// evasion token ("can the interviewer SEE this overlay?", "will the recruiter
// NOTICE the app?", "will it be VISIBLE in the screen share?").
const STEALTH_SOFT_VISIBILITY_RE = /\b(see|sees|seeing|notice\w*|realize\w*|realise\w*|spot|catch\w*|find out|aware|visible|detect\w*|know about|figure out)\b/i;

/**
 * True when the message is a stealth / undetectability / proctoring-evasion ask
 * that must be DECLINED + redirected (ethical_usage_answer), regardless of where
 * else it might route. Two ways to trip:
 *   (a) an explicit evasion intent + an interview/detection object, OR
 *   (b) a soft visibility verb ("see / notice / visible") aimed at an
 *       interviewer/proctor/screen-share object.
 * A SAFE product/privacy phrasing ("is it low-distraction?", "does it process
 * locally?") is NOT enough to exempt this — an evasion+object combination ALWAYS
 * wins (code-review 2026-06-06b HIGH: the privacy carve-out was exploitable).
 */
export const isStealthEvasionQuestion = (question: string): boolean => {
  const t = (question || '').toLowerCase();
  const hasObject = STEALTH_OBJECT_RE.test(t);
  const hasIntent = STEALTH_INTENT_RE.test(t);
  // (a) explicit evasion intent + an interview/detection object.
  if (hasIntent && hasObject) return true;
  // (a') explicit evasion intent aimed at the TOOL/overlay (no object needed):
  // "make it invisible", "keep natively undetectable", "hide the overlay".
  if (hasIntent && /\b(it|natively|nativley|the (?:app|tool|overlay|window|ui)|this)\b/.test(t)
    && /\b(invisible|undetect\w*|hidden|hide|conceal|stealth|disappear|off[- ]?screen)\b/.test(t)) return true;
  // (a'') a bare CHEAT / covert intent with no object — "how do I cheat without
  // being caught", "help me cheat", "cheat on the interview". Cheating in an
  // interview/assessment context is always the safety route.
  if (/\bcheat\w*\b/.test(t) && /\b(without (?:being |getting )?(?:caught|seen|noticed|detected)|interview|exam|test|assessment|proctor|coding (?:round|test)|on (?:the|this|my))\b/.test(t)) return true;
  // (a''') "use IT/THIS/the tool WITHOUT THEM KNOWING / secretly / on the sly" —
  // covertly using the tool to deceive, even with no explicit interview object
  // (release 2026-06-07: "how do I use it without them knowing"). The covert-use
  // intent + a reference to the tool is the evasion.
  if (/\b(use|using|run|running)\s+(it|this|natively|nativley|the (?:app|tool|overlay))\b/.test(t)
    && /\b(without (?:them|the interviewer|anyone|him|her|people|him\/her) (?:know|notic|see|find|realiz|realis)\w*|secretly|covertly|on the (?:sly|dl|down[- ]?low)|so (?:nobody|no one|they) (?:know|notic|see)\w*|undetect\w*|without being (?:caught|seen|noticed))\b/.test(t)) return true;
  // (b) soft visibility verb aimed at an interview/proctor/screen-share object.
  // EXCLUDE a candidate-possessive object ("will the interviewer see MY code/
  // portfolio/answer/screen?") — that's a benign visibility question, not an ask to
  // hide the TOOL. Only fire when there's no "my/mine" object the candidate owns
  // (code-review 2026-06-07 false-positive-refusal fix).
  const candidatePossessiveVisibility = /\b(see|view|notice|read|watch)\b[^.?!]{0,30}\bmy\b/.test(t)
    || /\bmy (code|portfolio|answer|screen|solution|work|repo|link|profile)\b/.test(t);
  if (hasObject && STEALTH_SOFT_VISIBILITY_RE.test(t) && !candidatePossessiveVisibility
    // require the object to be an interviewer/proctor/screen-share (not a bare
    // "monitor" hardware word) so "does it work with a second monitor" is safe.
    && /\b(interview\w*|proctor\w*|invigilat\w*|recruiter|examiner|screen[- ]?shar\w*|screenshar\w*|share my screen|sharing my screen|the (?:call|meeting|assessment|exam|test))\b/.test(t)) return true;
  return false;
};

// SAFE product/privacy phrasings — used ONLY to lightly bias an ambiguous answer
// toward the product route; they NEVER override isStealthEvasionQuestion (an
// evasion+object combination wins regardless). "how is it low-distraction?", "does
// it process locally?", "is it privacy-first?".
const SAFE_PRODUCT_PRIVACY_PATTERNS = [
  /\b(low[- ]?distraction|privacy[- ]?first|process(ing)? local|local (processing|first)|on[- ]?device|consent|transparent|accessib|minimal ui|cognitive load|data retention|stores? (data|nothing)|opt[- ]?in)\b/i,
];

// ── PROJECT LINK / repo / public URL (release 2026-06-06b) ──
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
  /\b(its|it'?s|so its|so it'?s)\s+an?\s+open[- ]?source\b|\bopensource (porject|project)\b|\bopen[- ]?source\b.{0,20}\bright\b/i,
  /\bwhy (can'?t|cant|wont|won'?t) (you )?share\b/i,    // "why can't you share, it's source available"
];

// ── ACTUAL SOURCE CODE evidence requests (release 2026-06-06b) ──
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

// ── PRODUCT / PROJECT "what is it" questions (release 2026-06-06b) ──
// "what kind of app is Natively?", "how's its backend?", "what do you think about
// Natively?", "what tech does it use?". Grounded in loaded project metadata.
// Distinct from project_answer (which lists the candidate's projects) — this is a
// drill-in ABOUT the product the user is asking about.
const PRODUCT_ABOUT_PATTERNS = [
  /\bwhat\s+(kind|kinda|type|sort)\s+(of\s+)?(app|application|product|tool|project|software)\b/i,
  /\bhow(?:'?s| is| does)\s+(natively|nativley|nativly|it|the (app|product|backend|architecture|frontend|stack))\b/i,
  /\bwhat\s+(do you think about|about)\s+(natively|nativley|nativly)\b/i,
  /\bwhat (tech|technolog|stack|languages?|framework)\w*\s+(does|do)\s+(natively|nativley|it|this)\b/i,
  /\bis (natively|nativley|it|this)\s+(local|cloud|open[- ]?source|privacy|low[- ]?distraction|on[- ]?device|transparent|accessib)\w*/i,
  /\b(natively|nativley|nativly)'?s\s+(backend|architecture|stack|frontend|core)\b/i,
  // Safe product-attribute / behavior probes ("is it low-distraction?", "does it
  // process locally?", "is it privacy-first?", "does it use Ollama?", "what part
  // uses Rust?") — these are about the PRODUCT, grounded in loaded metadata.
  /\b(is|are) (it|this|they)\s+(local|cloud[- ]?based|open[- ]?source|privacy[- ]?first|low[- ]?distraction|on[- ]?device|free|paid|safe|secure)\b/i,
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

const JD_FIT_PATTERNS = [
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
];

// GAP / weakness-for-the-role asks (release 2026-06-09). These must produce an HONEST
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

const SKILLS_PATTERNS = [
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
// A PEOPLE / leadership / conflict OBJECT after a lead/manage/handle verb marks a behavioral
// STORY (not a skill probe). This ONE source is interpolated into the behavioral matcher AND
// its two skill-side guards so the guard is always a superset of the matcher and the three lists
// can never drift apart (code-review 2026-06-16). A tech/tool object ("a database", "Python")
// is deliberately NOT here — those stay skill_experience.
const PEOPLE_OR_CONFLICT_OBJECT =
  '(?:team|teams|people|person|peers?|reports?|engineers?|developers?|juniors?|staff|direct\\s+reports?|group|anyone|someone|somebody|anybody|conflict|disagreement|crisis|escalation|difficult|tough)';

// Spec Case F exception: "have you used / worked with / do you know <tech>" is a
// SKILL-EXPERIENCE question about the USER (profile YES, first person) — NOT a
// generic technical concept. This must be checked BEFORE coding/DSA patterns so
// "have you used a hashmap?" routes to skills, not to the coding contract.
const SKILL_EXPERIENCE_PATTERNS = [
  // "have you used/built/managed <tech>" is a skill probe. But "have you managed/handled/led
  // PEOPLE / a TEAM" is a behavioral STORY, not a skill — the negative lookahead lets those
  // fall through to BEHAVIORAL_PATTERNS (code-review caveat 2026-06-16). A tech object after
  // managed/handled (e.g. "have you managed a database/cluster") still routes to skills.
  new RegExp(`\\bhave you (ever )?(?:(?:managed|handled|led)\\b(?!\\s+(?:a\\s+|an\\s+|the\\s+|your\\s+|some\\s+|any\\s+)?${PEOPLE_OR_CONFLICT_OBJECT}\\b)|(?:used|worked with|worked on|built|built with|written|coded in|programmed in|implemented|done|created|analy[sz]ed|normali[sz]ed|deployed|designed))\\b`, 'i'),
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
// SKILL SELF-RATING (live regression 2026-06-05): "how would you rate your
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
// Generic technical-concept questions ("explain BFS", "what is a deadlock") —
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
// Phase 2: HYPOTHETICAL technical application — "how would you use X", "how would
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
const isHypotheticalTech = (text: string): boolean => includesAny(text, HYPOTHETICAL_TECH_PATTERNS);
const PROJECT_PATTERNS = [
  /\b(project|projects|built|shipped|worked on)\b/i,
  // "Tell me about Natively", "explain Natively", "what is Natively", "talk about
  // Natively" — direct asks about a named project (benchmark 2026-06-05). The
  // known project entity is resolved at runtime; here we recognise the intent.
  /\b(tell me about|talk about|explain|describe|walk me through|what(?:'s| is)?)\s+natively\b/i,
  /\bwhat (did|have) you (build|built|made|create|created|develop)\b/i,
  /\bwhat (was|is) your (best|strongest|most important|favou?rite|biggest) (project|work)\b/i,
];
// Phase 5: project/entity FOLLOW-UP — once a project is on the table, an
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
const EXPERIENCE_PATTERNS = [
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
const BEHAVIORAL_PATTERNS = [
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
// MEETING / lecture-recap questions about the CONVERSATION, not the candidate —
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
// Profile FACT lookups (education, target role) — short factual answers
// (benchmark 2026-06-05): "where did you study?", "what role are you applying
// for?", "what's your degree?".
const PROFILE_FACT_PATTERNS = [
  /\bwhere did (you|i) (study|go to (school|college|university)|graduate)\b/i,
  /\bwhat (role|job|position) (are|am) (you|i) (applying|interviewing) for\b/i,
  /\bwhat(?:'s| is) (your|my) (degree|major|gpa|qualification)\b/i,
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
// Sales: pricing/product/competitor/objection questions (spec Case G). Uses sales
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
// PRODUCT + CANDIDATE MIX (Issue 5): "why is your PROFILE good for selling this
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
// Lecture: questions about lecture/slide/lecture material (spec Case H). Uses
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
const FOLLOW_UP_PATTERNS = [
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

// ── Standalone elliptical/meta-directive resolution (Issue 4/5/6/7) ───────────
// A live transcript resolves these against the prior turn (FollowUpResolver). But
// when they arrive WITHOUT prior context (manual chat, the benchmark's manual
// surface), they still carry enough signal to pick the most likely CONCRETE
// answer type instead of collapsing to the generic follow_up floor. Each block
// below is checked (in classifyStandaloneFragment) BEFORE the follow_up floor so
// the fragment routes to a real, correctly-grounded answer type. The follow_up
// floor remains for fragments with NO usable signal ("what about data?", "what
// should I answer?") — those stay profile-FORBIDDEN so they can't dump the résumé.

// Skill/tech tokens recognised inside a bare topic-shift ("and Python?", "what
// about SQL?"). A named skill → skill_experience (profile required, first
// person). Mirrors FollowUpResolver.SKILL_TOKEN_RE.
const STANDALONE_SKILL_TOKEN_RE = /\b(python|sql|java(?:script)?|typescript|react|node(?:\.?js)?|c\+\+|go(?:lang)?|rust|aws|gcp|azure|docker|kubernetes|graphql|rest|fastapi|django|flask|spring|pandas|numpy|spark|hadoop|tableau|power\s?bi|excel|tensorflow|pytorch|backend|frontend|full[\s-]?stack)\b/i;
// A bare topic-shift fragment: "and X?", "what about X?", "how about X?",
// optionally with filler ("hmm right, and Python?").
const TOPIC_SHIFT_FRAGMENT_RE = /^(?:(?:ok(?:ay)?|so|hmm|right|alright|cool|yeah|well|um|uh)[\s,]*)*(?:and|what about|how about|what of)\s+([a-z0-9+#.\- ]{2,30}?)\s*\??$/i;
// WORK-EXPERIENCE nouns that, as a bare topic shift, are about the candidate's
// own past work ("what about stakeholders?", "what about dashboards?") → an
// experience/skill answer (profile required). Distinct from the AMBIGUOUS bare
// "data" (excluded — appears in non-candidate chatter), which stays on the floor.
// NOTE: coding-ambiguous nouns ("testing", "documentation", "data") are EXCLUDED
// (code-review 2026-06-06, LOW): as a bare topic shift in a coding interview they
// likely mean the current problem's tests/docs, not the candidate's past work. The
// live FollowUpResolver resolves them with prior-turn context; the standalone floor
// keeps them out of a profile answer.
const STANDALONE_WORK_NOUN_RE = /\b(stakeholders?|dashboards?|reporting|reports?|requirements?|deadlines?|teamwork|collaboration|ownership|leadership|analytics|visuali[sz]ations?|pipelines?|etl|migrations?)\b/i;
// VOICE / EVIDENCE-CONTROL directives ("answer like a candidate", "say it in my
// voice", "make it sound confident but don't lie", "if no metric is there answer
// without a fake metric"). These are NOT how-to-deliver no-ops: they're an
// interview coaching ask for the candidate's OWN answer → a profile-grounded
// candidate answer in first person, never the generic floor and never the
// assistant voice (Issue 5: veryhard_016/017/012/047).
const VOICE_CONTROL_RE = /\banswer (like|as) a candidate\b|\bnot (like|as) an? assistant\b|\bsay what i should say\b|\bin my (own )?voice\b|\bmake it sound like me\b|\bsay (this|it) as me\b|\bgive me the candidate answer\b|\bdon'?t answer like (chatgpt|an? ai)\b/i;
// EVIDENCE-CONTROL directives — "don't overclaim / no fake metric / sound
// confident but don't lie". Same routing as voice-control (candidate answer).
// NOTE: every alternative requires CANDIDATE-ANSWER context (a metric/profile/lie
// cue) — a bare "don't overclaim" was REMOVED (code-review 2026-06-06, MED): on its
// own it hijacked a pure technical ask ("explain binary search but don't
// overclaim") into a profile-grounded answer, because metaDirective wins over every
// later matcher. The "use my profile but don't overclaim" alternative still covers
// the genuine profile-steer case.
const EVIDENCE_CONTROL_RE = /\b(without|no|don'?t (use|invent|add)) (a |any )?(fake|made[- ]?up|invented) (metric|number|stat)|\bif no metric is there\b|\bsound confident but (don'?t|do not) lie\b|\b(use|using) my profile but (don'?t|do not) overclaim\b/i;
// A JD-FIT GAP-BRIDGE meta-ask: the candidate states a mismatch between what they
// have and what's asked, then asks what to say ("I have full-stack, they ask data
// analyst, what do I say?", "I have projects but not pure analyst, answer this").
// This is a role-fit answer (resume + JD), not a project/skill answer (Issue 7).
// The middle clause MUST carry a ROLE/JD token (code-review 2026-06-06, MED): a
// bare "they want"/"but not" without a role noun ("I have a list, they want it
// sorted, what do I say") is a coding ask, not a JD-fit meta-prompt — require an
// explicit role/position/JD/job/hire/analyst/engineer token between the have-claim
// and the what-to-say ask so generic content can't mis-route to jd_fit.
const JD_ROLE_TOKEN = '(?:role|position|job|jd|job description|hir(?:e|ing)|analyst|engineer|developer|data analyst|this (?:role|job|position|one))';
const JD_GAP_BRIDGE_RE = new RegExp(
  `\\bi have\\b.{0,80}?\\b${JD_ROLE_TOKEN}\\b.{0,60}?\\b(what (do|should) i (say|answer)|answer this|how do i (say|answer)|what to say)\\b`,
  'i',
);

/**
 * Resolve a standalone elliptical / meta-directive fragment to a CONCRETE answer
 * type using only the signal in the fragment itself (no prior turn). Returns null
 * when the fragment carries no usable signal — the caller then uses the generic
 * follow_up floor (profile FORBIDDEN, so it can't dump the résumé).
 *
 * Ordering matters: the most specific signal wins. A JD-gap-bridge meta-ask beats
 * a bare topic shift; a named skill beats a work-noun; "complexity" is technical.
 * The LIVE path's FollowUpResolver still runs first and supersedes this with
 * prior-turn context; this is the manual / no-context resolver.
 */
const classifyStandaloneFragment = (text: string): AnswerType | null => {
  const t = text.trim();

  // 1. JD-fit gap-bridge meta-ask ("I have X, they ask Y, what do I say?").
  if (JD_GAP_BRIDGE_RE.test(t)) return 'jd_fit_answer';

  // 2. Bare topic shift "and X?" / "what about X?".
  const shift = t.match(TOPIC_SHIFT_FRAGMENT_RE);
  if (shift) {
    const topic = shift[1].trim();
    // "what about complexity?" → a technical follow-up (profile FORBIDDEN).
    if (/\bcomplexity\b/i.test(topic)) return 'technical_concept_answer';
    // A named skill → skill_experience (profile required, first person).
    if (STANDALONE_SKILL_TOKEN_RE.test(topic)) return 'skill_experience_answer';
    // A work-experience noun ("stakeholders", "dashboards") → the candidate's own
    // experience (profile required). Bare ambiguous "data" is deliberately NOT
    // matched here — it stays on the follow_up floor (profile forbidden).
    if (STANDALONE_WORK_NOUN_RE.test(topic)) return 'skill_experience_answer';
    // Otherwise an ambiguous topic ("what about data?") → null → floor.
    return null;
  }

  // 3. Voice / evidence-control directive → a profile-grounded candidate answer.
  //    Pick the nearest concrete bucket by embedded cue; default to experience.
  if (VOICE_CONTROL_RE.test(t) || EVIDENCE_CONTROL_RE.test(t)) {
    if (/\b(fit|hire|role|job|position|confident|sell|right for)\b/i.test(t)) return 'jd_fit_answer';
    if (/\b(project|built|natively|metric|impact|result)\b/i.test(t)) return 'project_answer';
    if (/\b(rate|skill|python|sql|level|proficien)\b/i.test(t)) return 'skill_experience_answer';
    return 'experience_answer';
  }

  return null;
};

const templateFor = (answerType: AnswerType): string => {
  switch (answerType) {
    case 'dsa_question_answer':
      return CODING_TEMPLATE;
    case 'coding_question_answer':
      return CODING_IMPL_TEMPLATE;
    case 'behavioral_interview_answer':
    case 'experience_answer':
      return BEHAVIORAL_TEMPLATE;
    case 'project_answer':
      // Phase 3: dedicated project structure (NOT behavioral STAR).
      return PROJECT_TEMPLATE;
    case 'project_followup_answer':
      // Phase 5: concise first-person drill-in on the resolved project.
      return PROJECT_FOLLOWUP_TEMPLATE;
    case 'jd_fit_answer':
      return JD_FIT_TEMPLATE;
    case 'gap_analysis_answer':
      return GAP_ANALYSIS_TEMPLATE;
    case 'negotiation_answer':
      return NEGOTIATION_TEMPLATE;
    case 'system_design_answer':
      return SYSTEM_DESIGN_TEMPLATE;
    case 'debugging_question_answer':
      return DEBUGGING_TEMPLATE;
    case 'technical_concept_answer':
      // Generic technical explanation — no profile, no persona, and a SHORT spoken
      // interview answer (not a tutorial). spoken-answer-quality sprint 2026-06-15.
      return TECHNICAL_CONCEPT_TEMPLATE;
    case 'identity_answer':
    case 'profile_fact_answer':
    case 'skills_answer':
    case 'skill_experience_answer':
      return SKILL_RATING_TEMPLATE;
    case 'sales_answer':
    case 'product_candidate_mix_answer':
      return SALES_TEMPLATE;
    case 'lecture_answer':
      return GENERAL_TEMPLATE;
    case 'definitional_answer':
      return DOCUMENT_DEFINITION_TEMPLATE;
    case 'list_answer':
      return DOCUMENT_LIST_TEMPLATE;
    case 'exact_numeric_answer':
      return DOCUMENT_NUMERIC_TEMPLATE;
    case 'document_absent_fact_refusal':
      return DOCUMENT_ABSENT_FACT_TEMPLATE;
    case 'document_followup_answer':
      return DOCUMENT_FOLLOWUP_TEMPLATE;
    case 'ethical_usage_answer':
      return ETHICAL_USAGE_TEMPLATE;
    case 'project_link_answer':
      return PROJECT_LINK_TEMPLATE;
    case 'source_code_evidence_answer':
      return SOURCE_CODE_EVIDENCE_TEMPLATE;
    case 'project_about_answer':
      return PRODUCT_ABOUT_TEMPLATE;
    default:
      return GENERAL_TEMPLATE;
  }
};

const requiredLayersFor = (answerType: AnswerType, documentGroundedCustomModeActive = false): ContextLayer[] => {
  switch (answerType) {
    case 'identity_answer':
      return ['stable_identity', 'resume'];
    case 'profile_fact_answer':
    case 'project_answer':
    case 'skills_answer':
    case 'skill_experience_answer':
    case 'experience_answer':
    case 'behavioral_interview_answer':
      return ['resume', 'custom_context', 'ai_persona'];
    case 'project_followup_answer':
      // Drill-in on a project: the project's resume facts + the prior assistant
      // turn (to resolve "it"/"that") + custom context + persona style.
      return ['resume', 'prior_assistant_responses', 'custom_context', 'ai_persona'];
    case 'jd_fit_answer':
    case 'gap_analysis_answer':
      return ['resume', 'jd', 'custom_context', 'ai_persona'];
    case 'coding_question_answer':
    case 'dsa_question_answer':
    case 'technical_concept_answer':
    case 'system_design_answer':
    case 'debugging_question_answer':
      return ['live_transcript', 'active_mode', 'screen_context', 'preferred_language'];
    case 'negotiation_answer':
      return ['negotiation', 'jd', 'custom_context', 'ai_persona'];
    case 'sales_answer':
      return ['custom_context', 'reference_files', 'active_mode', 'ai_persona'];
    case 'product_candidate_mix_answer':
      // Sales/product context + persona/custom for FOUNDER credibility framing —
      // NOT the résumé (no full profile dump in a selling answer).
      return ['custom_context', 'reference_files', 'active_mode', 'ai_persona'];
    case 'lecture_answer':
    case 'definitional_answer':
    case 'list_answer':
    case 'exact_numeric_answer':
    case 'document_absent_fact_refusal':
    case 'document_followup_answer':
      return ['live_transcript', 'screen_context', 'reference_files', 'active_mode'];
    case 'follow_up_answer':
      // Document-grounded custom mode (audit 2026-06-27): drop
      // `prior_assistant_responses` from the follow-up layer. A wrong prior
      // assistant answer about the uploaded material would otherwise become
      // truth on the next follow-up via `live_transcript`. The transcript
      // layer is preserved so pronoun resolution ("that", "it") still works,
      // but factual claims must come from the document, not from a
      // previously-emitted answer. Non-document-grounded follow-ups keep
      // the original layer set so chat-style continuity is preserved.
      if (documentGroundedCustomModeActive) {
        return ['live_transcript', 'active_mode'];
      }
      return ['live_transcript', 'prior_assistant_responses', 'active_mode'];
    case 'project_about_answer':
      // Grounded in the loaded project metadata (résumé projects) + custom context
      // + persona. NOT the JD/negotiation. Same grounding as a project answer.
      return ['resume', 'custom_context', 'reference_files', 'ai_persona'];
    case 'project_link_answer':
      // The link lives in the project metadata (résumé) or custom context /
      // reference files. No JD/negotiation. The template enforces no-invention.
      return ['resume', 'custom_context', 'reference_files'];
    case 'source_code_evidence_answer':
      // Real code only comes from reference files / loaded source; project
      // metadata names the project. No JD/negotiation. The template enforces
      // honesty about what's loaded.
      return ['reference_files', 'custom_context', 'resume', 'active_mode'];
    case 'ethical_usage_answer':
      // A safety answer needs NO candidate context — it's a policy redirect about
      // the product. Persona only (for tone). Never résumé/JD/negotiation.
      return ['ai_persona'];
    default:
      return ['live_transcript', 'active_mode'];
  }
};

const forbiddenLayersFor = (answerType: AnswerType): ContextLayer[] => {
  switch (answerType) {
    case 'identity_answer':
      return ['jd', 'negotiation', 'reference_files'];
    case 'coding_question_answer':
    case 'dsa_question_answer':
    case 'technical_concept_answer':
    case 'system_design_answer':
    case 'debugging_question_answer':
      // Spec §8.3: generic coding/technical answers must NOT use any profile.
      return ['resume', 'jd', 'negotiation', 'custom_context', 'reference_files'];
    case 'skill_experience_answer':
    case 'skills_answer':
    case 'profile_fact_answer':
      // About the user's own facts — resume YES, but not JD/negotiation (spec §8:
      // negotiation context only for salary answers).
      return ['jd', 'negotiation', 'reference_files'];
    case 'project_answer':
    case 'experience_answer':
    case 'behavioral_interview_answer':
      // Profile narrative answers — never the negotiation/salary layer.
      return ['negotiation'];
    case 'project_followup_answer':
      // A project drill-in stays on the project's own facts: never negotiation,
      // and not the JD (unrelated to "how was it built / what was your role").
      return ['negotiation', 'jd', 'reference_files'];
    case 'jd_fit_answer':
    case 'gap_analysis_answer':
      return ['negotiation'];
    case 'negotiation_answer':
      return ['reference_files'];
    case 'sales_answer':
      // Sales answers must not pull the user's resume/JD or negotiation/salary.
      return ['resume', 'jd', 'negotiation'];
    case 'product_candidate_mix_answer':
      // Founder/credibility-for-selling: no résumé/JD DUMP, no salary. Credibility
      // comes from persona/custom-context framing, not a profile list.
      return ['resume', 'jd', 'negotiation'];
    case 'lecture_answer':
    case 'definitional_answer':
    case 'list_answer':
    case 'exact_numeric_answer':
    case 'document_absent_fact_refusal':
    case 'document_followup_answer':
      // Document/lecture answers must not pull resume/JD/negotiation.
      return ['resume', 'jd', 'negotiation'];
    case 'general_meeting_answer':
      // Meeting recap ("action items?", "what did we decide?", "what was the
      // customer asking?") is about the CONVERSATION — never the candidate's
      // profile. Forbid resume/JD/negotiation so the knowledge intercept can't
      // inject the résumé (benchmark 2026-06-05 context-leak).
      return ['resume', 'jd', 'negotiation'];
    case 'follow_up_answer':
      // A BARE, unresolved follow-up fragment ("what about data?", "what should I
      // answer?") with no prior turn to inherit from is the FLOOR case. It must
      // never trigger a broad résumé/skill dump (benchmark 2026-06-06 leak:
      // "what about data?" returned "Based on your profile, here is the complete
      // list of your data-related skills…"). Forbid resume/JD/negotiation so the
      // knowledge intercept can't inject them. In the LIVE path the
      // FollowUpResolver resolves the fragment to a CONCRETE type BEFORE planning,
      // so a genuine "And SQL?" becomes skill_experience (resume allowed) and
      // never lands here — this floor only bites truly context-free fragments.
      return ['resume', 'jd', 'negotiation'];
    case 'ethical_usage_answer':
      // A safety/policy answer must pull NO candidate context at all.
      return ['resume', 'jd', 'negotiation', 'custom_context', 'reference_files'];
    case 'project_about_answer':
      // Product description — never the JD/negotiation/salary layer.
      return ['jd', 'negotiation'];
    case 'project_link_answer':
    case 'source_code_evidence_answer':
      // Link/source answers are about the project artifact, never JD/negotiation.
      return ['jd', 'negotiation'];
    default:
      return [];
  }
};

export const isCodingAnswerType = (answerType: AnswerType): boolean =>
  answerType === 'coding_question_answer' || answerType === 'dsa_question_answer';

// Phase 2: answer types that speak AS the candidate (first person live / second
// person manual). Profile-directed asks + negotiation (the candidate negotiates).
const CANDIDATE_VOICE_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
  'identity_answer', 'profile_fact_answer', 'project_answer', 'project_followup_answer',
  'skills_answer', 'skill_experience_answer', 'experience_answer', 'jd_fit_answer',
  'gap_analysis_answer', 'behavioral_interview_answer', 'negotiation_answer',
]);

// Phase 2: the profile-context policy per answer type. `forbidden` is the hard
// leak rule (coding/technical/sales/lecture get NO profile, spec §8.3); `required`
// means the answer is about the user and MUST be grounded; `allowed` means profile
// may help but isn't mandatory (negotiation leverage, generic meeting).
export const profileContextPolicyFor = (answerType: AnswerType): ProfileContextPolicy => {
  switch (answerType) {
    case 'coding_question_answer':
    case 'dsa_question_answer':
    case 'technical_concept_answer':
    case 'system_design_answer':
    case 'debugging_question_answer':
    case 'sales_answer':
    case 'product_candidate_mix_answer':
    case 'lecture_answer':
    case 'definitional_answer':
    case 'list_answer':
    case 'exact_numeric_answer':
    case 'document_absent_fact_refusal':
    case 'document_followup_answer':
    case 'general_meeting_answer':
      // Meeting recap is about the conversation, not the candidate — no profile.
      return 'forbidden';
    case 'ethical_usage_answer':
      // Safety answer: NO profile at all.
      return 'forbidden';
    case 'identity_answer':
    case 'profile_fact_answer':
    case 'project_answer':
    case 'project_followup_answer':
    case 'skills_answer':
    case 'skill_experience_answer':
    case 'experience_answer':
    case 'jd_fit_answer':
    case 'gap_analysis_answer':
    case 'behavioral_interview_answer':
    case 'project_about_answer':
      // Product-about answers MUST be grounded in the loaded project metadata
      // (no overclaim) — same as a project answer.
      return 'required';
    case 'project_link_answer':
    case 'source_code_evidence_answer':
      // The link/source comes from loaded metadata/reference files; grounding is
      // REQUIRED so the answer reflects ONLY what's loaded (no invented URL/code).
      return 'required';
    case 'follow_up_answer':
      // FLOOR for an unresolved bare fragment — profile FORBIDDEN so an ambiguous
      // "what about data?" can't dump the résumé (benchmark 2026-06-06 leak). The
      // live FollowUpResolver upgrades genuine follow-ups to a concrete type
      // (which sets its own policy) before this floor is ever reached.
      return 'forbidden';
    case 'negotiation_answer':
    case 'unknown_answer':
    // NOTE: general_meeting_answer is handled in the 'forbidden' group above
    // (meeting recaps must never pull the profile) — do not re-add it here.
    default:
      return 'allowed';
  }
};

// Phase 5: pull a likely project/entity NAME out of a follow-up question
// ("how is Natively developed?" → "Natively", "what was your role in SQL-Copilot?"
// → "SQL-Copilot"). Deterministic, conservative: prefers a capitalized /
// hyphenated token after a project preposition; never invents. Returns '' when
// the question only uses a pronoun ("it"/"that") — the orchestrator then resolves
// from the prior turn instead.
const PROJECT_ENTITY_RE = /\b(?:in|on|for|about|of|is|was|did)\s+([A-Z][A-Za-z0-9]*(?:[-_ ][A-Z0-9][A-Za-z0-9]*){0,3})\b/;
const ENTITY_STOPWORDS = new Set(['I', 'You', 'We', 'It', 'That', 'This', 'The', 'My', 'Your', 'A', 'An', 'Their', 'Our', 'His', 'Her']);
// Common TECHNOLOGY nouns that are NOT project names. A capitalized tech token
// after a preposition ("optimize binary search in Postgres") must NOT be treated
// as a project entity, or it would bypass the DSA/coding guard and leak the
// resume into a pure coding answer (code-review 2026-06-05, HIGH, invariant #1).
const TECH_NOT_ENTITY = new Set([
  'postgres', 'postgresql', 'mysql', 'sqlite', 'mongo', 'mongodb', 'redis', 'kafka',
  'rabbitmq', 'elasticsearch', 'python', 'java', 'javascript', 'typescript', 'golang',
  'rust', 'react', 'angular', 'vue', 'node', 'nodejs', 'express', 'django', 'flask',
  'fastapi', 'spring', 'aws', 'gcp', 'azure', 'docker', 'kubernetes', 'k8s', 'graphql',
  'rest', 'grpc', 'sql', 'nosql', 'pandas', 'numpy', 'spark', 'hadoop', 'tableau',
  'excel', 'powerbi', 'linux', 'nginx', 'terraform',
]);
export const extractProjectEntity = (question: string): string => {
  const m = question.match(PROJECT_ENTITY_RE);
  if (!m) return '';
  // Strip any LEADING stopword tokens ("The Project" → "Project", "My Project" →
  // "Project") so a determiner/possessive prefix doesn't leak as the entity. If
  // nothing survives, there's no real named entity — return '' and let the
  // orchestrator resolve from the prior turn instead.
  const tokens = m[1].trim().split(/\s+/);
  while (tokens.length && ENTITY_STOPWORDS.has(tokens[0])) tokens.shift();
  const candidate = tokens.join(' ');
  // A bare common word like "Project" alone isn't a usable project NAME either.
  if (!candidate || /^(Project|Projects|Role|Thing|Part|Work)$/i.test(candidate)) return '';
  // A bare technology token is NOT a project entity (see TECH_NOT_ENTITY above).
  if (tokens.length === 1 && TECH_NOT_ENTITY.has(candidate.toLowerCase())) return '';
  return candidate;
};

// A project follow-up has explicit project CONTEXT when the prior turn resolved a
// project (followUpTarget) OR the question names a project after a project
// preposition ("in/on/for <Name>"). When true, a project-drill-in verb is
// unambiguously about that project even if the name contains a tech token
// (SQL-Copilot). A bare generic subject ("optimize binary search") yields no
// entity here, so the technical guards still apply.
const followUpHasProjectContext = (input: PlanAnswerInput, rawQuestion: string): boolean => {
  if (input.extractedQuestion?.followUpTarget) return true;
  if (extractProjectEntity(rawQuestion) !== '') return true;
  // A trailing locative pronoun ("…there?", "…in it?", "…on that project?")
  // anchors the drill-in to the project already under discussion — treat it as
  // explicit project context so a technical noun (database/latency/backend) in
  // the question doesn't bounce it out of project_followup (benchmark 2026-06-05).
  return /\b(there|in it|on it|in that|on that|in the project|on the project)\b\s*\??$/i.test(rawQuestion.trim());
};

// Phase 2: profile-aware fallback for questions that matched NO explicit pattern.
// Conservative by design — only pulls an unmatched question into a profile answer
// type when it is clearly DIRECTED AT THE CANDIDATE (second/first person about
// them) in a manual/interview context. Everything else stays unknown_answer
// (profileContextPolicy 'allowed' — no forced profile, no leak).
const SELF_REFERENTIAL_RE = /\b(you|your|yours|yourself|u|ur)\b/i;          // interviewer→candidate
const FIRST_PERSON_RE = /\b(i|i'?m|i'?ve|my|me|mine|myself)\b/i;            // user→self ("what should I say")
// "What should I say/answer if they ask X" — indirect recruiter coaching. We
// route by the EMBEDDED ask so the right profile context is selected.
const INDIRECT_COACHING_RE = /\bwhat (should|do|would) (i|you) (say|answer|tell them|respond)\b/i;
const classifyUnmatchedFallback = (text: string, input: PlanAnswerInput): AnswerType => {
  const interview = input.source === 'what_to_answer' || input.source === 'transcript';
  const manual = input.source === 'manual_input';
  const hasProfile = input.hasCandidateProfile !== false; // default-allow when unknown
  // Only engage the profile fallback in a manual/interview context with a profile.
  if (!(interview || manual) || !hasProfile) {
    return manual ? 'unknown_answer' : 'general_meeting_answer';
  }
  // Vague opinion / discourse questions ("so what do you think about all this?",
  // "how about that?") contain "you" but are NOT about the candidate's profile —
  // they must stay neutral, not pull profile. Require the question to reference a
  // candidate ATTRIBUTE or be an explicit coaching ask before engaging profile.
  // NOTE: bare "data" is deliberately EXCLUDED (it appears in non-candidate
  // analyst chatter — "send me the data", "the data pipeline is down"); only the
  // role-framed "data analyst"/"analytics" qualify (code-review 2026-06-05, MED).
  const CANDIDATE_ATTRIBUTE_RE = /\b(experience|background|skill|skills|project|projects|role|job|fit|hire|qualif|strength|weakness|study|studied|education|degree|college|university|intern|work|built|build|develop|languages?|tools?|tech|stack|rate|level|expertise|proficien|company|companies|career|resume|cv|profile|data analyst|analytics)\b/i;
  const candidateDirected =
    (SELF_REFERENTIAL_RE.test(text) && CANDIDATE_ATTRIBUTE_RE.test(text))
    || (FIRST_PERSON_RE.test(text) && CANDIDATE_ATTRIBUTE_RE.test(text))
    || INDIRECT_COACHING_RE.test(text);
  if (!candidateDirected) {
    // Not clearly about the candidate — keep neutral (no forced profile).
    return manual ? 'unknown_answer' : 'general_meeting_answer';
  }
  // Candidate-directed but unmatched. Pick the nearest SAFE profile bucket by
  // light keyword lean; default to profile_fact_answer (resume-grounded, concise,
  // first-person, NO jd/negotiation) — the safest "about me" answer.
  if (/\b(job|role|position|fit|hire|company|this (one|role|job)|qualified|suitable)\b/i.test(text)) return 'jd_fit_answer';
  if (/\b(project|built|build|developed|natively|app|system|architecture|stack|backend|database)\b/i.test(text)) return 'project_answer';
  if (/\b(rate|out of (10|ten)|level|scale|score)\b/i.test(text)) return 'skill_experience_answer';
  if (/\b(strength|weakness|example|story|time|teamwork|leadership|conflict|failure|pressure|ownership)\b/i.test(text)) return 'behavioral_interview_answer';
  if (/\b(experience|background|intern|internship|worked|company|role|did you do)\b/i.test(text)) return 'experience_answer';
  if (/\b(skill|skills|language|tool|tech|technolog|good at)\b/i.test(text)) return 'skills_answer';
  return 'profile_fact_answer';
};

// Normalize common chat-speak / SMS spellings for ROUTING ONLY (the displayed
// answer still uses the original text). Conservative, whole-word mappings of
// unambiguous abbreviations so noisy real-user input ("u gud at python", "wat
// kinda app is dis", "tell me ur best projcet") routes like its proper-English
// form (1000-q benchmark 2026-06-06b noisy category). NOT a spell-checker — only
// these well-known tokens are touched.
const SMS_NORMALIZATIONS: Array<[RegExp, string]> = [
  [/\bu\b/gi, 'you'], [/\bur\b/gi, 'your'], [/\bgud\b/gi, 'good'], [/\bwat\b/gi, 'what'],
  [/\bdis\b/gi, 'this'], [/\bpls\b/gi, 'please'], [/\bplz\b/gi, 'please'], [/\bthx\b/gi, 'thanks'],
  [/\br\b/gi, 'are'], [/\bcuz\b/gi, 'because'], [/\bkinda\b/gi, 'kind of'], [/\byoself\b/gi, 'yourself'],
  [/\byoursef\b/gi, 'yourself'], [/\bprojcet\b/gi, 'project'], [/\bprojects?et\b/gi, 'project'],
  [/\bexperince\b/gi, 'experience'], [/\bnativley\b/gi, 'natively'], [/\bnativly\b/gi, 'natively'],
];
const normalizeSms = (s: string): string => {
  let out = s;
  for (const [re, rep] of SMS_NORMALIZATIONS) out = out.replace(re, rep);
  return out;
};

export const planAnswer = (input: PlanAnswerInput): AnswerPlan => {
  const rawQuestion = input.question || input.extractedQuestion?.latestQuestion || '';
  const question = rawQuestion.trim();
  const text = normalizeSms(question.toLowerCase());
  // "tech stack" / "technology stack" is a phrase, not the DSA `stack` data
  // structure — neutralize it so the project-followup DSA-exclusion guard below
  // doesn't mis-fire on "what tech stack did you use?".
  // Neutralize "tech stack" / "technology stack" AND bare "full-stack" so the
  // DSA `\bstack\b` data-structure pattern can't fire on them ("you said full
  // stack, but this is data analyst" must not become a stack/DSA question).
  const textNoTechStack = text
    .replace(/\b(tech|technology|technical)\s+stack\b/g, 'techstack')
    .replace(/\bfull[- ]?stack\b/g, 'fullstack');
  const extractedType = input.extractedQuestion?.questionType;
  const documentGroundedCustomModeActive = input.activeMode?.documentGroundedCustomModeActive === true;
  const explicitDocumentModeCodingAsk = /\b(write|implement|code|coding interview|dsa|dry run|time complexity|space complexity|big[-\s]?o|algorithm(?:ic)?|solution code|source code)\b/i.test(text);
  const explicitDocumentModeProfileAsk = /\b(resume|cv|profile|job description|\bjd\b|career|work experience|candidate profile|my background|your background|my projects?|your projects?|my skills?|your skills?)\b/i.test(text);

  let answerType: AnswerType = 'general_meeting_answer';

  // Skill-experience framing ("have you used X?", "do you know X?") is about the
  // USER, so it must win BEFORE coding/DSA/technical patterns — otherwise
  // "have you used a hashmap?" mis-routes to the coding contract. It still yields
  // to explicit negotiation/identity (those are higher-priority profile asks).
  // "what tech stack / technologies / backend / database / framework DID YOU USE"
  // is a project ARCHITECTURE follow-up, not a generic skill-experience probe —
  // exclude it here so the project_followup branch (checked later) wins and
  // grounds in the specific project (ProfileRoutingMatrix invariant).
  // Project ARCHITECTURE drill-in (tech stack / backend / database of a project) —
  // NOT a generic "what languages do you know" skills question, so `languages`/
  // `tools` are deliberately excluded here.
  const isProjectStackQuestion = /\b(tech ?stack|technolog\w+|backend|database|frontend|framework|infra\w*|architecture|stack) (did|do|does|was|were)\b/i.test(textNoTechStack)
    || /\bwhat (tech ?stack|technolog\w+|backend|database|frontend|framework|stack) (did|do)\b/i.test(text);
  // PROJECT-framed asks must not be captured by the broadened skill-experience
  // "have/did you build/do/develop" patterns — they belong to project_answer /
  // project_followup (ProfileRoutingMatrix invariants). Exclude when the question
  // is about "projects", names/pronouns a project ("build IT", "develop THAT"),
  // or is a project drill-in ("why did you build it", "how did you optimise the
  // pipeline"). Bare skill probes ("have you built dashboards?") still match.
  // A project DRILL-IN ("what projects have you done", "build IT", "develop THAT
  // project") should defer to project routing. But a SKILL-experience probe that
  // merely mentions "project(s)" as a scope ("have you written SQL in your
  // projects?", "have you used BFS in a project?") is still skill_experience —
  // so only exclude when there's NO explicit have/did-you-use skill framing.
  // A "have/did you USE <skill>" probe (with the use-verb LEADING the question)
  // is skill_experience even when it mentions "project" as scope ("have you used
  // BFS in a project?", "have you written SQL in your projects?"). But a question
  // that LEADS with "what projects" or drills into a specific project ("why did
  // you build it?") is project routing. Distinguish by whether the use-verb opens
  // the question vs. "project" being the subject.
  const leadsWithUseVerb = /^(have|did|do)\s+you\s+(ever\s+)?(used?|worked|written|wrote|implement|implemented|deploy|deployed|design|designed|know|knew)\b/i.test(text.trim());
  const isProjectFramed = (
    /\bwhat\s+projects?\b/i.test(text)
    || /\b(build|built|develop|developed|made|make|create|created|optimi[sz]e[d]?|design(ed)?)\s+(it|that|this|the (project|app|system|pipeline|product|tool))\b/i.test(text)
    || includesAny(text, PROJECT_FOLLOWUP_PATTERNS)
  ) && !leadsWithUseVerb;
  const hasSkillExperienceFraming = includesAny(text, SKILL_EXPERIENCE_PATTERNS) && !isProjectStackQuestion && !isProjectFramed;
  // Skill self-rating ("rate yourself out of 10", "how good are you at X",
  // "your coding levels", "on a scale of 1-10 how proficient are you"). About the
  // USER's proficiency → skill_experience. Checked as its own branch (no
  // system-design exclusion) because "scale" collides with SYSTEM_DESIGN_PATTERNS
  // yet a self-rating is never a system-design question.
  // "Rate your <role> FIT out of 10" is a JD-fit self-assessment, NOT a skill
  // rating — the thing being rated is suitability for the role, which needs the
  // JD (Issue 7: hard_014 "rate your data analyst fit out of 10"). Detect a fit /
  // role cue inside the rating frame and let the JD_FIT branch below claim it.
  const ratesRoleFit = /\b(fit|suitabilit|match|readiness|how ready)\b/i.test(text)
    || /\brate\s+(your|my)\s+[\w ]*\b(fit|suitabilit|match|readiness|data analyst|analyst)\b/i.test(text);
  const hasSkillRatingFraming = includesAny(text, SKILL_RATING_PATTERNS) && !ratesRoleFit;

  // "solve" alone is a false-positive coding signal for a PRODUCT/PROJECT
  // question ("What's RedisMart and what problem does it SOLVE?", "What
  // problem does Natively solve?") — a bare project-description ask that
  // shares the word "solve" with a genuine coding task ("solve two sum",
  // "can you solve this problem"), but is never asking for code. Without
  // this guard the bare `\bsolve\b` in CODING_PATTERNS (and the
  // hasExplicitCodingVerb/hasWriteCodeVerb checks below) hijacked the
  // question into coding_question_answer — profile FORBIDDEN, so the model
  // never named the actual project and instead answered a generic invented
  // Redis-concept essay (Phase 0 replay finding, real-session desync bug).
  // Scoped narrowly to "what problem(s) does <it/this/that/a project name/
  // your/my/the> solve" so a genuine coding ask ("how did you solve the
  // caching problem in RedisMart", "solve two sum") is unaffected.
  //
  // COMPOUND-MESSAGE FIX (code-review 2026-07-05 HIGH + debugger-confirmed):
  // the original fix computed isProductProblemSolveQuestion as a whole-message
  // boolean and, once true, narrowed hasExplicitCodingVerb/hasWriteCodeVerb's
  // verb regex for the ENTIRE message — so a compound message pairing the
  // product-solve phrase with a SEPARATE, genuine coding request ("What
  // problem does RedisMart solve? Also please write a function that reverses
  // a linked list.") lost its `write` signal too and fell through to
  // unknown_answer/profileContextPolicy:'allowed' instead of
  // coding_question_answer/forbidden — silently dropping the coding-answer
  // safety nets (structure validation, contract injection) for a genuine
  // coding ask. Fixed by stripping ONLY the matched product-solve CLAUSE from
  // a working copy of the text before testing for the bare `solve` verb, so a
  // `write`/`implement`/DSA signal ELSEWHERE in the same message still fires
  // normally — the guard now suppresses just its own clause, not the whole
  // message.
  const productProblemSolveMatch = text.match(/\bwhat\s+(problem|issue|pain\s?point)s?\s+(does|do|did)\s+(it|this|that|he|she|they|natively|redismart|talentscope|your|my|the|his|her)\b[\w '-]{0,20}\bsolves?\b/i);
  const textWithoutProductSolveClause = productProblemSolveMatch
    ? (text.slice(0, productProblemSolveMatch.index) + text.slice((productProblemSolveMatch.index || 0) + productProblemSolveMatch[0].length))
    : text;
  // A CODING TASK that merely mentions a comp word as DATA ("write a SQL query
  // for the second highest SALARY", "function to compute BONUS") is NOT a
  // negotiation question — the explicit code verb wins. Guard the negotiation
  // branch so a "salary"/"bonus" COLUMN in a coding ask doesn't mis-route to
  // compensation (benchmark 2026-06-05: salary-false-positive category).
  // Explicit code-writing verbs. NOTE: "query" is intentionally EXCLUDED — "how
  // would you use a GraphQL query" / "query data using GraphQL" is a hypothetical
  // concept ask, not a code-writing task. A genuine "write a SQL query" is caught
  // by the write/COMMON_CODING patterns instead.
  // NOTE: compute/return/print are EXCLUDED here (code-review 2026-06-05, MED) —
  // they'd wrongly veto a real comp question ("compute my total compensation").
  // Genuine SQL/coding "salary" cases are caught by the write/COMMON_CODING/DSA
  // signals instead.
  const hasExplicitCodingVerb = /\b(write|implement|code|program|function|solve)\b/i.test(textWithoutProductSolveClause)
    || includesAny(text, COMMON_CODING_PROBLEM_PATTERNS) || includesAny(textNoTechStack, DSA_PATTERNS);
  // Strict "write code" verbs only (no DSA-term inference). Used to gate the
  // HYPOTHETICAL branch: "how would you use BFS?" is a concept (BFS is a DSA term
  // but there's no write-verb), so it must NOT be blocked from technical_concept.
  const hasWriteCodeVerb = /\b(write|implement|code|program|solve)\b/i.test(textWithoutProductSolveClause)
    || includesAny(text, COMMON_CODING_PROBLEM_PATTERNS);
  // A CLEAR past/present EXPERIENCE probe ("have you implemented X before", "where
  // have you used X", "did you actually use X") is about the CANDIDATE — it must
  // win even when the subject collides with a system-design noun ("rate limiter",
  // "caching", "logging"). Without this, "have you implemented a rate limiter
  // before" mis-routed to system_design (release 2026-06-07: residual pattern #2).
  // A write-code verb still vetoes (that's a coding task, not an experience ask).
  // EXCLUDE when the object is the named product Natively ("how did you build
  // Natively" is a product-about/architecture question, not a generic skill probe).
  const asksAboutNatively = /\bnativel?y\b|\bnativly\b/i.test(text);
  // "what PROJECTS have you built" is a project-LIST ask, not a skill probe — the
  // experience probe must not steal it (release 2026-06-07 regression guard).
  const asksAboutProjectsList = /\b(what|which|any)\s+projects?\b/i.test(text);
  // A PROJECT-FOLLOWUP drill-in ("what backend did you use THERE", "what tech stack
  // did you use", "why did you build IT", "how did you handle latency there") is
  // about a specific project on the table — NOT a generic skill probe. Detect the
  // project-drill-in signals so the experience probe doesn't steal them (the probe
  // is for "have you used <skill>?" / "have you implemented <X> before?", which
  // name a SKILL, not a project artifact). Release 2026-06-07 regression guard.
  const isProjectDrillIn = includesAny(text, PROJECT_FOLLOWUP_PATTERNS)
    || /\b(there|in it|on it|in that|in the project|build it|built it)\b/i.test(text)
    || /\b(tech|technology|technical)\s+stack\b/i.test(text);
  // A PEOPLE/team/leadership object after managed/handled/led marks a behavioral STORY, not a
  // skill probe — exclude it so it falls through to BEHAVIORAL_PATTERNS (code-review caveat
  // 2026-06-16). "have you managed a database/cluster" (a tech object) stays a skill probe.
  const hasPeopleObject = new RegExp(`\\b(?:manage[d]?|handle[d]?|led|lead|mentor(?:ed)?|coach(?:ed)?|supervis(?:e|ed)|resolv(?:e|ed)|navigat(?:e|ed)|deal[t]?\\s+with)\\s+(?:a\\s+|an\\s+|the\\s+|your\\s+|some\\s+|any\\s+)?${PEOPLE_OR_CONFLICT_OBJECT}\\b`, 'i').test(text);
  const isExplicitExperienceProbe = !hasWriteCodeVerb && !asksAboutNatively && !asksAboutProjectsList && !isProjectDrillIn && !hasPeopleObject && (
    /\bhave (you|u) (ever )?(used|worked with|worked on|built|implemented|written|coded|deployed|designed|done|handled|managed)\b/i.test(text)
    || /\bdid (you|u) (actually |really |ever )?(use|work with|build|implement|write|deploy|design|do|handle)\b/i.test(text)
    || /\bwhere have (you|i) (used|worked|applied|built|implemented)\b/i.test(text)
    || /\bhave (you|u) (implemented|built|used|designed)\b.{0,40}\bbefore\b/i.test(text)
    || /\byour experience (with|in|using|building)\b/i.test(text)
  );

  // EXPLICIT comp NEGATION + a skill-rating cue ("rate Python but NOT salary",
  // "do NOT give salary, just rate coding", "your level, NOT salary, coding
  // level") — the user is steering AWAY from compensation toward a skill rating.
  // Suppress the negotiation branch so the salary word inside the negation doesn't
  // mis-route (benchmark 2026-06-05 salary-false-positive category).
  // The negation must target a COMP word: "no/not <…> salary" (negation BEFORE the
  // comp word) OR "salary <…> not" where the trailing negation has NO other noun to
  // bind to. A bare "salary but no PROJECT" negates PROJECT, not salary, so it must
  // NOT count (code-review 2026-06-06: veryhard_050 "use salary but no project" was
  // mis-suppressed → mis-routed to project instead of negotiation).
  const negatesSalary = /\b(not|no|don'?t|without|never|skip|avoid|exclude)\s+(?:any\s+|the\s+|give\s+|giving\s+|mention(?:ing)?\s+|talk(?:ing)?\s+about\s+|discuss(?:ing)?\s+)?(salary|compensation|package|ctc|pay|money|offer)\b/i.test(text)
    || /\b(salary|compensation|package|ctc|pay)\b[\w ,'-]*\b(not|no|don'?t)\s*$/i.test(text.trim());

  // META-DIRECTIVES (Issue 5/7): coaching asks that wrap a candidate answer —
  // a JD-fit gap-bridge ("I have X, they ask Y, what do I say?") or a voice/
  // evidence-control directive ("answer like a candidate", "make it confident but
  // don't lie"). These must resolve to a CONCRETE candidate type BEFORE the
  // generic pattern matchers (which would mis-grab "projects"/"full-stack"/
  // "generic" out of the wrapper text). A genuine code verb opts out — a coding
  // ask is never a profile meta-directive.
  const metaDirective = (!hasWriteCodeVerb && question) ? classifyStandaloneFragment(text) : null;

  // SAFETY (release 2026-06-06b): a stealth / undetectability / proctoring-evasion
  // ask must be caught BEFORE any other route so it can never receive specific
  // evasion advice. A SAFE product/privacy phrasing ("is it low-distraction?",
  // "does it process locally?") with no evasion+interview combination is excluded.
  // SAFETY: an evasion+object combination ALWAYS wins — the privacy carve-out can
  // never exempt it (code-review 2026-06-06b HIGH). isStealthEvasionQuestion is the
  // single authoritative predicate (also consulted by the manual fast-path).
  const isStealthEvasion = isStealthEvasionQuestion(text);
  // SOURCE-CODE evidence: a request for the ACTUAL code of a loaded project. Must
  // win over the generic coding route (which would fabricate a plausible snippet).
  const wantsSourceEvidence = includesAny(text, SOURCE_CODE_EVIDENCE_PATTERNS);
  // PROJECT LINK: a repo/url/website ask. Win over unknown so it never false-refuses.
  const wantsProjectLink = includesAny(text, PROJECT_LINK_PATTERNS);

  if (!question) {
    answerType = 'unknown_answer';
  } else if (isStealthEvasion) {
    answerType = 'ethical_usage_answer';
  } else if (wantsSourceEvidence) {
    answerType = 'source_code_evidence_answer';
  } else if (wantsProjectLink) {
    answerType = 'project_link_answer';
  } else if (metaDirective) {
    answerType = metaDirective;
  } else if (includesAny(text, NEGOTIATION_PATTERNS) && !hasExplicitCodingVerb && !negatesSalary) {
    // A salary word that is explicitly NEGATED ("use JD but no salary", "rate me
    // but not compensation") is a steer AWAY from negotiation — never a comp ask.
    // (Previously this only suppressed negotiation when a rating cue was ALSO
    // present; "use JD but no salary" had no rating cue and mis-routed to
    // negotiation — Issue 7.)
    answerType = 'negotiation_answer';
  } else if (includesAny(text, IDENTITY_PATTERNS) || extractedType === 'identity') {
    answerType = 'identity_answer';
  } else if (hasSkillRatingFraming) {
    // Self-rating of a skill → first-person profile answer (wins over coding's
    // bare-language-name match and over system-design's "scale" collision).
    answerType = 'skill_experience_answer';
  } else if (isExplicitExperienceProbe) {
    // A clear "have you used/implemented X (before)?" experience probe → profile
    // skill-experience, even if X is a system-design noun (rate limiter, caching).
    answerType = 'skill_experience_answer';
  } else if (hasSkillExperienceFraming && !includesAny(text, SYSTEM_DESIGN_PATTERNS)) {
    // "Have you used WebRTC / a hashmap / AWS?" → profile skill-experience answer
    // in first person. Wins over coding/DSA/technical-concept routing below.
    answerType = 'skill_experience_answer';
  } else if (includesAny(text, PROJECT_FOLLOWUP_PATTERNS)
             // An EXPLICIT project entity ("...in SQL-Copilot?", "...role in
             // Natively?") OR a resolved prior-turn target makes this an
             // unambiguous project follow-up — even if the project NAME contains a
             // technology token (SQL-Copilot has "sql"). In that case we skip the
             // technical-subject guards. Otherwise (a bare drill-in verb on a
             // generic subject — "how did you optimize binary search?"), the
             // guards below keep it OUT of project_followup so coding/DSA answers
             // never use the profile (code-review 2026-06-05, HIGH).
             // HARD precondition (code-review 2026-06-05, HIGH, invariant #1): a
             // write-code verb or a named DSA problem ALWAYS keeps a question out
             // of project_followup, even if a project entity was extracted — so
             // "how did you optimize binary search in Postgres?" can never inject
             // the resume into a coding answer. Real project drill-ins ("what was
             // your role in SQL-Copilot?") carry neither a write verb nor a DSA
             // term, so they're unaffected.
             && !hasWriteCodeVerb
             && (followUpHasProjectContext(input, question)
                 || (!includesAny(textNoTechStack, DSA_PATTERNS)
                     && !includesAny(text, CODING_PATTERNS)
                     && !isLikelyTechnicalConcept(textNoTechStack)))) {
    // Phase 5: a drill-in on a project already on the table ("how is it built?",
    // "what was your role?", "what tech stack did you use?", "hardest part?",
    // "why did you build it?", "what did you learn?"). These are PROFILE questions
    // about the candidate's own work — they win BEFORE BEHAVIORAL (a project
    // "hardest part" is not a generic STAR story) and resolve to a specific
    // project, grounding in its resume facts.
    //
    // GUARD (code-review 2026-06-05, HIGH): a project-drill-in verb attached to a
    // GENERIC technical subject is NOT a project follow-up — "how did you optimize
    // BINARY SEARCH?", "how did you implement BFS?" must stay coding/DSA with NO
    // profile. So we explicitly EXCLUDE any question that carries a DSA term, a
    // coding verb, or a technical-concept subject; those fall through to the
    // technical/DSA/coding cluster below (profileContextPolicy = forbidden). This
    // keeps the "coding answers never use resume" invariant intact. ("what tech
    // STACK did you use?" survives: `stack` here is matched by the followup
    // pattern, and DSA's bare `stack` is gated by this being a personal "did you
    // use" phrasing — verified by ProfileRoutingMatrix over-capture guards.)
    answerType = 'project_followup_answer';
  } else if (
    // HIGH-CONFIDENCE JD-FIT BRIDGE — the interviewer challenges that the
    // candidate's background (full-stack/engineering) doesn't match the data-
    // analyst role and asks them to connect/explain the fit. This is a fit
    // question (resume+JD), NOT a generic "explain X" concept, so it must beat
    // the technical_concept branch below (benchmark 2026-06-05).
    /\b(full[- ]?stack|engineering|engineer|backend|software)\b/i.test(text)
    && /\b(data analyst|analyst|data)\b/i.test(text)
    && /\b(connect|bridge|relate|link|explain the connection|why (data|analyst)|different|convince)\b/i.test(text)) {
    answerType = 'jd_fit_answer';
  } else if (includesAny(text, MEETING_PATTERNS)) {
    // Meeting/conversation recap ("action items?", "what did we decide?",
    // "summarise the last 5 min", "what was the customer asking?") — about the
    // CONVERSATION, never the candidate. Routed here (profile FORBIDDEN) instead
    // of falling through to unknown and leaking profile context.
    answerType = 'general_meeting_answer';
  } else if (includesAny(text, PRODUCT_CANDIDATE_MIX_PATTERNS)) {
    // "Why is your profile good for selling this product?" — credibility-for-
    // selling. NOT profile_fact (no résumé dump): the layer table forbids
    // resume/jd/negotiation; founder framing comes from persona/custom context.
    answerType = 'product_candidate_mix_answer';
  } else if (includesAny(text, SALES_PATTERNS)) {
    answerType = 'sales_answer';
  } else if (includesAny(text, LECTURE_PATTERNS)) {
    answerType = 'lecture_answer';
  } else if (asksAboutNatively && includesAny(text, PRODUCT_ABOUT_PATTERNS)) {
    // A question that NAMES Natively and is about its build/architecture/stack is a
    // product-about answer (grounded in loaded metadata), NOT a generic system-
    // design task — checked before system_design so "what is the architecture of
    // Natively" / "how did you build Natively" route to product-about
    // (release 2026-06-07: residual pattern #1).
    answerType = 'project_about_answer';
  } else if (includesAny(text, SYSTEM_DESIGN_PATTERNS)
             // A WRITE-CODE verb makes it a coding task, not a design discussion
             // ("write code for a rate limiter" → coding, not system_design).
             && !hasWriteCodeVerb
             // "EXPLAIN/WHAT IS rate limiting/caching" is a CONCEPT question, not a
             // design task — defer to technical_concept (release 2026-06-07:
             // "explain rate limiting" must be technical_concept, while "how would
             // you DESIGN a rate limiter" stays system_design). Only defer when
             // there's an explain/what-is frame AND no explicit "design" verb.
             && !(/\b(explain|what(?:'s| is| are)?|describe|how does|tell me about)\b/i.test(text)
                  && !/\bdesign\b|\bscalable\b|\barchitect/i.test(text))) {
    answerType = 'system_design_answer';
  } else if (includesAny(text, DEBUGGING_PATTERNS) && !includesAny(textNoTechStack, DSA_PATTERNS)
             // BEHAVIORAL-PAST-EXPERIENCE GUARD (manual regression 2026-06-12,
             // stress seq_056): "tell me about a difficult BUG you solved" is a
             // STAR story about the candidate's past, not a live debugging task —
             // the bare \bbug\b pattern captured it into the technical lane
             // (profile forbidden, neutral voice) where the model answered
             // "I'm Natively, an AI assistant. I don't have personal
             // experiences." A past-tense candidate frame defers to BEHAVIORAL.
             && !/\b(tell me about|describe|share|give me an example of)\b.{0,60}\b(you|you'?ve|u)\b.{0,60}\b(solved|fixed|faced|debugged|handled|dealt with|encountered|resolved|found)\b/i.test(text)
             && !/\b(hardest|toughest|most difficult|trickiest|worst)\b.{0,30}\b(bug|error|issue|crash)\b.{0,40}\b(you|you'?ve|your career|you ever)\b/i.test(text)) {
    answerType = 'debugging_question_answer';
  } else if (isHypotheticalTech(text) && !hasWriteCodeVerb) {
    // HYPOTHETICAL application — "how would you use GraphQL?", "how would you
    // clean a messy dataset?", "how would you approach a data analysis task?",
    // "how would you optimise a slow API?" (Phase 2 + benchmark 2026-06-05). The
    // candidate answers in FIRST PERSON but invents NO resume facts — a technical
    // answer (profile forbidden) in candidate voice. This now fires for ANY
    // "how would you …" application even without a DSA/technical-subject keyword,
    // as long as there's no explicit code verb (write/implement/solve/query →
    // those are genuine coding tasks and fall through to DSA/CODING below). A
    // bare language name ("how would you use SQL") no longer mis-routes to coding.
    answerType = 'technical_concept_answer';
  } else if (
    // Explicit "answer GENERICALLY / DON'T use my resume" steer on an explain/
    // tell-me ask — the user wants a neutral concept answer even though a skill
    // word + "my resume" appears (benchmark 2026-06-05 context-confusing traps:
    // "explain SQL but don't use my resume", "tell me about Python but explain it
    // generally"). Concept wins, profile forbidden.
    (includesAny(text, TECHNICAL_CONCEPT_PATTERNS) || /\btell me about\b/i.test(text))
    && /\b(generally|in general|don'?t use my (resume|profile|cv)|without my (resume|profile)|explain it generally|generic(ally)?)\b/i.test(text)
    // POLARITY GUARD (Issue 5): "don't make it generic" / "not generic" / "but not
    // generic" is the OPPOSITE steer — the user wants a SPECIFIC, profile-grounded
    // answer, not a neutral concept. Exclude the negated form so
    // "tell me about pressure, but don't make it generic" stays behavioral.
    && !/\b(not|don'?t|do not|never|avoid|without)\b[\w ,'-]*\bgeneric/i.test(text)
    && !hasWriteCodeVerb) {
    answerType = 'technical_concept_answer';
  } else if (includesAny(text, TECHNICAL_CONCEPT_PATTERNS) &&
             !includesAny(text, CODING_PATTERNS) &&
             (includesAny(textNoTechStack, DSA_PATTERNS) || isLikelyTechnicalConcept(text))) {
    // "Explain BFS", "what is a deadlock", "difference between TCP and UDP" —
    // generic technical CONCEPT, NO profile (spec Case F). Checked before
    // DSA/coding: a DSA noun with explain/what-is framing and NO coding verb is a
    // concept, not a coding task.
    answerType = 'technical_concept_answer';
  } else if (includesAny(textNoTechStack, DSA_PATTERNS)) {
    // Named DSA problem ("two sum", "reverse a linked list", "solve two sum").
    // Kept BEFORE generic CODING so the specific DSA label/template wins.
    answerType = 'dsa_question_answer';
  } else if (
    // "What problem does RedisMart/Natively/it solve?" trips the bare
    // `\bsolve\b` inside CODING_PATTERNS — that's a project-description ask,
    // never a coding task. CODING_PATTERNS is tested against the
    // clause-stripped text (textWithoutProductSolveClause) so a genuine
    // coding request ELSEWHERE in the same message still routes correctly
    // (compound-message fix, code-review 2026-07-05 HIGH: the original whole-
    // message boolean silently swallowed a real "write a function..." coding
    // ask appended after a "what problem does X solve" clause).
    (includesAny(textWithoutProductSolveClause, CODING_PATTERNS) || input.intentResult?.intent === 'coding')
    // Guard: a very short addend phrase like "with code?", "show code?", "include code?",
    // "add code?", "can you give code?" is a conversational follow-up requesting a code
    // example from the prior context — NOT a new standalone coding problem. Only suppress
    // the coding route when ALL three conditions hold:
    //   (1) the message is short (≤5 words, punctuation stripped)
    //   (2) the only coding signal is the bare noun "code" (no stronger cue:
    //       write/implement/program/function/class/method/solve/algorithm/debug/snippet)
    //   (3) the message starts with a modifier/preposition typical of addends
    //       (with, show, include, add, give, can you, using, just)
    // A genuine coding ask like "write code for bubble sort" fails condition (2) and
    // passes through normally. This guard does NOT touch the DSA_PATTERNS path above.
    && !((() => {
      const wordCount = text.replace(/[?.!,]/g, '').split(/\s+/).filter(Boolean).length;
      if (wordCount > 5) return false; // not short enough to be an addend
      const hasStrongCodingCue = /\b(write|implement|program|function|class|method|solve|algorithm|debug|snippet|script)\b/i.test(text)
        || includesAny(text, COMMON_CODING_PROBLEM_PATTERNS)
        || includesAny(textNoTechStack, DSA_PATTERNS);
      if (hasStrongCodingCue) return false; // real coding ask — don't suppress
      // Only the bare word "code" triggered the match. Check for addend preposition.
      const isAddend = /^(?:with|show|include|add|give|can\s+you|using|just|also|and)\b/i.test(text.trim());
      return isAddend;
    })())
  ) {
    answerType = 'coding_question_answer';
  } else if (includesAny(text, GAP_PATTERNS)) {
    // Honest gap + mitigation for the role (checked BEFORE jd_fit so a gap ask isn't
    // swallowed by the fit patterns). Resume+JD grounded, first-person candidate.
    answerType = 'gap_analysis_answer';
  } else if (includesAny(text, JD_FIT_PATTERNS) || extractedType === 'jd_alignment') {
    answerType = 'jd_fit_answer';
  } else if (includesAny(text, BEHAVIORAL_PATTERNS) || extractedType === 'behavioral') {
    answerType = 'behavioral_interview_answer';
  } else if (includesAny(text, PROFILE_FACT_PATTERNS)) {
    // Short factual profile lookups (education, target role, degree) — benchmark
    // 2026-06-05. Profile required, concise direct answer.
    answerType = 'profile_fact_answer';
  } else if (includesAny(text, PRODUCT_ABOUT_PATTERNS)) {
    // "what kind of app is Natively?", "how's its backend?", "what do you think
    // about Natively?" — a drill-in ABOUT the product, grounded in loaded project
    // metadata (no overclaim). Checked before the generic project-list branch so a
    // product question isn't answered with the candidate's whole project list.
    answerType = 'project_about_answer';
  } else if (includesAny(text, PROJECT_PATTERNS)) {
    answerType = 'project_answer';
  } else if (includesAny(text, SKILLS_PATTERNS)) {
    answerType = 'skills_answer';
  } else if (includesAny(text, EXPERIENCE_PATTERNS) || extractedType === 'profile_detail') {
    answerType = 'experience_answer';
  } else if (includesAny(text, FOLLOW_UP_PATTERNS) || extractedType === 'follow_up') {
    // A fragment matched the follow-up floor. Before accepting the generic
    // follow_up_answer (profile FORBIDDEN), try to resolve it to a CONCRETE type
    // from its own signal — a named skill ("and SQL?"), a work noun ("what about
    // stakeholders?"), a voice/evidence-control directive ("answer like a
    // candidate"), or a JD-gap-bridge ("I have full-stack, they ask analyst,
    // what do I say?"). Only truly context-free fragments ("what about data?",
    // "what should I answer?") fall through to the floor. The live FollowUpResolver
    // still supersedes this with prior-turn context (Issue 4/5/6/7).
    answerType = classifyStandaloneFragment(text) || 'follow_up_answer';
  } else {
    // PROFILE-AWARE FALLBACK (Phase 2). Nothing above matched. In a manual or
    // interview context with a profile available, an unmatched but clearly
    // candidate-directed question ("you/your/I/my", or a short interview-style
    // fragment) must NOT collapse to unknown_answer — that strips profile/JD
    // context and cascades into route/voice failures. Route it to the nearest
    // SAFE profile answer type. Generic non-candidate questions still go to
    // unknown (profileContextPolicy 'allowed', no forced profile).
    const fb = classifyUnmatchedFallback(text, input);
    answerType = fb;
    // MODE PRIOR (PI v3, W1): nothing explicit matched AND the profile-aware
    // fallback landed on a floor type (unknown/general). In a sales call that
    // ambiguous turn is a sales question; in a lecture it's about the material.
    // applyModeFallback rewrites ONLY unknown_answer/general_meeting_answer —
    // a candidate-directed fallback (profile type from classifyUnmatchedFallback)
    // or any explicitly-matched type above is never touched, so every leak
    // invariant (coding/identity/negotiation routing) is preserved.
    answerType = applyModeFallback(answerType, true, input.source, input.activeMode);
  }

  if (documentGroundedCustomModeActive && !explicitDocumentModeCodingAsk && !explicitDocumentModeProfileAsk) {
    // A user-created document-grounded custom mode makes uploaded/reference files
    // the primary source. Do not let generic coding/profile heuristics steal normal
    // seminar/thesis questions into contracts that forbid reference_files. Within
    // that safe document lane, preserve the QUESTION SHAPE so retrieval/packing and
    // validators can prefer definitions, lists, exact values, absent-fact refusals,
    // and follow-up referents instead of collapsing every turn to lecture_answer.
    const docShape = classifyDocumentQuestionShape(question, input.extractedQuestion?.isFollowUp ? input.extractedQuestion?.followUpTarget || 'prior' : undefined);
    answerType = docShape === 'broad_overview' ? 'lecture_answer' : docShape;
  }

  const speakerPerspective = input.speakerPerspective
    || (input.source === 'what_to_answer' || input.source === 'transcript' ? 'interviewer' : 'user');

  // Phase 2: VOICE (how to speak) is computed SEPARATELY from PROFILE-CONTEXT
  // POLICY (whether profile facts may ground the answer). The classic conflation
  // bug: "how would you use GraphQL?" needs first-person candidate VOICE but NO
  // profile facts. The hypothetical-technical flag captures exactly that case.
  const hypotheticalTech = answerType === 'technical_concept_answer' && isHypotheticalTech(text);
  const interviewerAsked = speakerPerspective === 'interviewer'
    || input.source === 'what_to_answer' || input.source === 'transcript';

  const profileContextPolicy = profileContextPolicyFor(answerType);

  // MANUAL VOICE POLICY (release 2026-06-06b, Phase 5). In manual chat, an
  // INTERVIEW-style question directed at the candidate ("introduce yourself", "why
  // should we hire you", "are you good at Python", "what's your experience") should
  // be answered in FIRST-PERSON candidate voice — the real manual-chat log showed
  // second-person ("Your skills include…") reading oddly when the user is
  // rehearsing as the candidate. A COACHING ask ("what should I say?", "help me
  // answer", "draft my intro") keeps second-person / "Say this:" so the assistant
  // is clearly advising. A bare factual list ("what are my skills") stays
  // second-person (it's the user querying their own data, not rehearsing a line).
  const isCoachingPhrasing = /\b(what should (i|we) (say|answer|respond)|how (should|do) i (answer|respond|introduce|frame|phrase)|help me (answer|draft|write|frame|prepare|say)|draft (my|an|a)|write (my|an|a)|prepare (my|an|a)|give me (an answer|a script|a line)|coach me|how would you phrase|how to answer)\b/i.test(text);
  // First-person-preferring INTERVIEW phrasing in manual mode: the question reads
  // as if an interviewer is asking the candidate directly ("introduce yourself",
  // "why should we hire you", "are you good at X", "tell me about your project").
  const isManualInterviewPhrasing = /\b(introduce yourself|introduc\w*|tell me about your(self|\s)|why should (we|i|they) hire|are (you|u) (good|strong|skilled|experienced|comfortable|proficient)|what(?:'s| is)? your (experience|background|strength|weakness|project|weakest|strongest)|why (are|do) you|how (are|do) you (fit|think you (are|'?re) fit)|how (do|are) you.{0,20}\bfit\b|what did you (build|do|work)|walk me through your|what gaps? do you have|where are you (weak|least)|what (do|would) you need to (improve|learn)|what part of (this|the) (jd|role|job).{0,30}(ready|prepared)|what(?:'s| is)? missing from your)\b/i.test(text)
    && !isCoachingPhrasing
    && !/\bmy\b/i.test(text.replace(/\binterview my\b/gi, '')); // "what are MY skills" → keep 2nd-person list

  const voicePerspective: VoicePerspective = (() => {
    if (CANDIDATE_VOICE_TYPES.has(answerType)) {
      // Profile-directed answer types speak AS the candidate live, or tell the
      // user about themselves in a manual chat.
      if (interviewerAsked) return 'first_person_candidate';
      if (input.source === 'manual_input') {
        // Phase 5: manual interview-style phrasing → first-person candidate;
        // coaching / bare-list phrasing → second-person.
        return isManualInterviewPhrasing ? 'first_person_candidate' : 'second_person_user';
      }
      return 'assistant_explanation';
    }
    // Hypothetical technical ("how would you use X") in a live/interview setting
    // → candidate voice, even though profile is forbidden. Manual/teaching → neutral.
    if (hypotheticalTech && interviewerAsked) return 'first_person_candidate';
    // Coding / "explain X" technical / sales / lecture / general → neutral voice.
    return 'assistant_explanation';
  })();

  // Backward-compatible alias for existing call sites (third_person collapses to
  // the neutral assistant voice for the legacy 3-value type).
  const outputPerspective: OutputPerspective =
    voicePerspective === 'first_person_candidate' ? 'first_person_candidate'
      : voicePerspective === 'second_person_user' ? 'second_person_user'
        : 'assistant_explanation';

  // Phase 5: resolve which project a follow-up is about — the prior turn's target
  // (from the transcript extractor) or an explicit name in the question. Used to
  // scope grounding; never fabricated.
  const resolvedEntity = answerType === 'project_followup_answer'
    ? (input.extractedQuestion?.followUpTarget || extractProjectEntity(question) || undefined)
    : undefined;

  const fastPathTypes: AnswerType[] = ['identity_answer', 'profile_fact_answer'];
  const latencyMs = isCodingAnswerType(answerType) || answerType === 'system_design_answer'
    ? 2500
    : fastPathTypes.includes(answerType)
      ? 800
      : 1500;

  return {
    answerType,
    source: input.source,
    speakerPerspective,
    outputPerspective,
    voicePerspective,
    profileContextPolicy,
    resolvedEntity,
    requiredContextLayers: requiredLayersFor(answerType, documentGroundedCustomModeActive),
    forbiddenContextLayers: forbiddenLayersFor(answerType),
    responseTemplate: templateFor(answerType),
    maxFirstUsefulTokenMs: latencyMs,
    maxInitialLatencyMs: latencyMs, // deprecated alias
    requiresLLM: !fastPathTypes.includes(answerType),
    canUseFastPath: fastPathTypes.includes(answerType),
    shouldShowImmediateScaffold: shouldScaffold(answerType) && !styleSuppressesScaffoldSafe(answerType, question),
    question,
    confidence: Math.max(input.intentResult?.confidence || input.extractedQuestion?.confidence || 0.7, 0),
    answerStyle: detectAnswerStyle(question).style,
    answerStyleTargetSeconds: detectAnswerStyle(question).targetSeconds,
    documentGroundedCustomModeActive,
  };
};

// Only let a style suppress the coding scaffold for CODING answer types (a "code only"
// cue on a non-coding answer must not change anything). Keeps the scaffold for the
// common case; suppresses it for an explicit "just the code" / "one line" coding ask.
const styleSuppressesScaffoldSafe = (answerType: AnswerType, question: string): boolean => {
  if (!isCodingAnswerType(answerType)) return false;
  const s = detectAnswerStyle(question).style;
  return s === 'code_only' || s === 'one_liner';
};

/**
 * Structured answer types whose UI must paint a deterministic section scaffold
 * BEFORE any model token. Coding/DSA use the six-section coding contract;
 * system-design and debugging use their own sectioned templates. For these, the
 * live path must never stream raw code-first tokens (REPORT hypothesis C1).
 */
export const shouldScaffold = (answerType: AnswerType): boolean =>
  answerType === 'coding_question_answer'
  || answerType === 'dsa_question_answer'
  || answerType === 'system_design_answer'
  || answerType === 'debugging_question_answer';

/**
 * Render the plan as the prompt's answer-contract block. When
 * `includeVerificationSpec` is true (code verification enabled) AND this is a
 * coding/DSA answer, the hidden <verification_spec> instruction is appended so
 * the model emits test cases; when false (kill-switch off), it's omitted so no
 * tokens are wasted on a spec nothing will run.
 */
// Answer types whose templates carry visible section scaffolds (The Honest Gap /
// Short Fit Summary / Direct Answer / STAR / …). Manual regression 2026-06-12:
// these headings rendered in EVERY default answer, reading as robotic templates.
// By default the structure is now INTERNAL (think through it, output speakable
// prose); the headings render only when the user explicitly asks for structure.
const SCAFFOLDED_PROFILE_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
  'behavioral_interview_answer', 'project_answer', 'jd_fit_answer',
  'gap_analysis_answer', 'negotiation_answer',
  // Audit 2026-06-16 (H6): simple factual profile questions — "what companies have
  // you worked at", "how many years of experience", "introduce yourself", "what is
  // your current role" — were shipping their full template scaffold (STAR / Direct
  // Answer / Why It Matters …) because they were absent here, so isSpeakableOnlyPlan
  // returned false and the scaffold rendered verbatim. A factual question must answer
  // in natural spoken prose, not a story scaffold. Adding them flips on the speakable
  // rendering directive (headings suppressed; explicit "detailed/bullets/STAR" style
  // still keeps structure via STRUCTURE_REQUESTING_STYLES below).
  'experience_answer', 'skill_experience_answer', 'profile_fact_answer', 'identity_answer',
]);

// Styles that explicitly request visible structure — sections/bullets stay.
const STRUCTURE_REQUESTING_STYLES: ReadonlySet<AnswerStyle> = new Set<AnswerStyle>([
  'detailed', 'bullets', 'exam', 'notes',
]);

/** True when this plan should render as speakable prose (headings suppressed). */
export const isSpeakableOnlyPlan = (plan: Pick<AnswerPlan, 'answerType' | 'answerStyle' | 'source' | 'question'>): boolean => {
  if (!SCAFFOLDED_PROFILE_TYPES.has(plan.answerType)) return false;
  // Live WTA answers are spoken aloud — ALWAYS speakable regardless of style.
  if (plan.source === 'what_to_answer' || plan.source === 'transcript') return true;
  if (STRUCTURE_REQUESTING_STYLES.has(plan.answerStyle)) return false;
  // 'star' auto-detects from the IMPLICIT behavioral phrasing ("tell me about a
  // time…") — that's not a request for visible sections. Only an EXPLICIT
  // "use STAR" / "STAR format" keeps the labels (manual regression 2026-06-12).
  if (plan.answerStyle === 'star' && /\bstar\b/i.test(plan.question || '')) return false;
  return true;
};

const SPEAKABLE_RENDERING_DIRECTIVE =
  `\n\nRENDERING (overrides the section labels above): the sections are your INTERNAL thinking structure only. ` +
  `OUTPUT ONLY the final speakable answer as natural first-person prose (2-6 sentences, no section headings, no labels, no bullet markers). ` +
  `Cover the same substance — lead with the direct answer, ground every claim, close naturally. ` +
  `Never print "Speakable Final Answer", "Direct Answer", "The Honest Gap", "Short Fit Summary", or any other label.`;

export const formatAnswerPlanForPrompt = (plan: AnswerPlan, includeVerificationSpec = false): string => {
  const verificationBlock = (includeVerificationSpec && isCodingAnswerType(plan.answerType))
    ? `\n\n${CODING_VERIFICATION_INSTRUCTION}`
    : '';
  // Phase 2: a single explicit directive that translates the voice/policy split
  // into model instructions — this is what makes "how would you use GraphQL?"
  // answer in first person WITHOUT inventing resume facts.
  const voiceLine = plan.voicePerspective === 'first_person_candidate'
    ? 'Speak in the FIRST PERSON as the candidate ("I would…", "I built…").'
    : plan.voicePerspective === 'second_person_user'
      ? 'Address the user about themselves in the second person ("Your …").'
      : (plan.answerType === 'sales_answer' || plan.answerType === 'product_candidate_mix_answer')
        // Sales turns speak as the seller/product rep — the neutral-assistant
        // voice line caused "I'm Natively… I don't have a product" in real
        // sales sessions (manual regression 2026-06-12).
        ? 'Speak in the FIRST PERSON as the product\'s seller/representative ("our product", "we"). Never identify as an AI assistant.'
        : 'Answer in a neutral, explanatory voice. Do not roleplay as the candidate.';
  const policyLine = plan.documentGroundedCustomModeActive
    ? 'Ground every concrete claim in the uploaded/reference files for this custom mode. If the answer is not supported by the uploaded material, say plainly that the requested information is not in the uploaded material. Do not reconstruct it from general knowledge, prior assistant answers, profile, resume, JD, or persona context.'
    : plan.profileContextPolicy === 'required'
      ? 'Ground every concrete claim in the provided profile facts. Never invent names, numbers, metrics, companies, or technologies that are not in those facts.'
      : plan.profileContextPolicy === 'forbidden'
        ? 'Do NOT use or reference the resume, JD, projects, or any personal profile context. Answer from general knowledge only.'
        : 'Use profile facts only where directly relevant; never fabricate.';
  const entityLine = plan.resolvedEntity
    ? `\nresolvedEntity: ${plan.resolvedEntity} (answer about THIS project; stay on it)`
    : '';
  // Adaptive style directive (form only) — appended when the question requested a
  // specific style/length. Never overrides VOICE/GROUNDING/leak boundaries.
  const styleDirective = plan.answerStyle && plan.answerStyle !== 'default'
    ? `\n\n${detectAnswerStyle(plan.question).directive}`
    : '';
  // Adaptive LENGTH directive (2026-06-16): for a default-style SPOKEN_SHORT answer, inject a
  // CONCRETE per-answer word/second target so the model lands in the 15-30s band by question
  // intent instead of always running ~30s. Only fires for SPOKEN_SHORT with no explicit style
  // cue — SPOKEN_FULL / STRUCTURED_FULL and explicit styles own their own length, so emit
  // nothing for them (additive, non-conflicting). Prompt-guidance only; the deterministic
  // trimmer is unchanged.
  let lengthDirective = '';
  if (!plan.answerStyle || plan.answerStyle === 'default') {
    const tier = classifyTargetSpeakability(plan.answerType, plan.answerStyle, plan.question);
    if (tier === 'SPOKEN_SHORT') {
      const band = classifyShortBand(plan.answerType, plan.answerStyle, plan.question);
      const t = shortBandTargetWords(band);
      lengthDirective = `\n\nLENGTH: aim for about ${t.seconds}s spoken — roughly ${t.min} to ${t.max} words (${t.guidance}). Use fewer if the question is fully answered in fewer; never pad to reach the number.`;
    }
  }
  // Speakable-by-default (manual regression 2026-06-12): scaffolded profile
  // templates become internal thinking structure; the rendered answer is
  // natural prose unless the user explicitly asked for structure.
  const renderingDirective = isSpeakableOnlyPlan(plan) ? SPEAKABLE_RENDERING_DIRECTIVE : '';
  return `<answer_contract>
answerType: ${plan.answerType}
source: ${plan.source}
speakerPerspective: ${plan.speakerPerspective}
outputPerspective: ${plan.outputPerspective}
voicePerspective: ${plan.voicePerspective}
profileContextPolicy: ${plan.profileContextPolicy}${entityLine}
requiredContextLayers: ${plan.requiredContextLayers.join(', ') || 'none'}
forbiddenContextLayers: ${plan.forbiddenContextLayers.join(', ') || 'none'}
maxInitialLatencyMs: ${plan.maxInitialLatencyMs}
answerStyle: ${plan.answerStyle}

VOICE: ${voiceLine}
GROUNDING: ${policyLine}

STRICT RESPONSE TEMPLATE:
${plan.responseTemplate}${renderingDirective}${styleDirective}${lengthDirective}${verificationBlock}
</answer_contract>`;
};
