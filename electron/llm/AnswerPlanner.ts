import type { IntentResult } from './IntentClassifier';
import type { ExtractedQuestion } from './transcriptQuestionExtractor';
import { CODING_CONTRACT, CODING_CONTRACT_IMPL, CODING_VERIFICATION_INSTRUCTION } from './codingContract';
import { detectAnswerStyle, type AnswerStyle } from './answerStyle';
import { classifyTargetSpeakability, classifyShortBand, shortBandTargetWords, HARD_MAX_WORDS, SPOKEN_FULL_MAX_WORDS } from './speakability';
import { applyModeFallback, type ActiveModeInfo } from './modeProfiles';
import { classifyDocumentQuestionShape } from './documentGroundedPrompt';
import { includesPlannerTerm } from '../services/modes/retrievalTextMatch';
// Classification regex tables (PR #427 §1.3) — moved verbatim to a sibling
// module to cut this file down; imported under identical names so no
// reference below changes.
import {
  BEHAVIORAL_PATTERNS,
  PEOPLE_OR_CONFLICT_OBJECT,
  CODING_PATTERNS,
  COMMON_CODING_PROBLEM_PATTERNS,
  DEBUGGING_PATTERNS,
  DEVOPS_CICD_PATTERNS,
  DSA_PATTERNS,
  EXPERIENCE_PATTERNS,
  FOLLOW_UP_PATTERNS,
  GAP_PATTERNS,
  HYPOTHETICAL_TECH_PATTERNS,
  IDENTITY_PATTERNS,
  JD_FIT_PATTERNS,
  LECTURE_PATTERNS,
  MEETING_PATTERNS,
  NEGOTIATION_PATTERNS,
  PRODUCT_ABOUT_PATTERNS,
  PRODUCT_CANDIDATE_MIX_PATTERNS,
  PROFILE_FACT_PATTERNS,
  PROJECT_FOLLOWUP_PATTERNS,
  PROJECT_LINK_PATTERNS,
  PROJECT_PATTERNS,
  SAFE_PRODUCT_PRIVACY_PATTERNS,
  SALES_PATTERNS,
  SKILLS_PATTERNS,
  SKILL_EXPERIENCE_PATTERNS,
  SKILL_RATING_PATTERNS,
  SOFTWARE_ENGINEERING_CONCEPT_PATTERNS,
  SOURCE_CODE_EVIDENCE_PATTERNS,
  SYSTEM_DESIGN_PATTERNS,
  TECHNICAL_CONCEPT_PATTERNS,
  TECHNICAL_SUBJECT_PATTERNS,
} from './answerPlannerPatterns';

export type AnswerType =
  | 'identity_answer'
  | 'profile_fact_answer'
  | 'project_answer'
  | 'skills_answer'
  | 'skill_experience_answer'
  | 'experience_answer'
  | 'jd_fit_answer'
  | 'gap_analysis_answer'
  // JD-SOURCE answer shapes (2026-07-07, JD/Resume JIT pipeline fix). The JD is
  // the TARGET-ROLE source, not the candidate's biography. These route the `jd`
  // layer as the PRIMARY source so "what does this role require?" no longer
  // falls to unknown/skills (which forbid jd) and drops the JD before any prompt
  // is built. `sourceOwner` for these is profile_jd (jd_*) or a resume+jd mix.
  | 'jd_summary_answer'        // "what kind of candidate / role does the JD want?"
  | 'jd_requirements_answer'   // "top skills / responsibilities / requirements in the JD"
  | 'jd_fact_answer'           // "does the JD mention salary / relocation / location?"
  | 'resume_jd_fit_answer'     // "which of MY projects best matches this JD?" (resume+jd)
  | 'resume_jd_gap_answer'     // "my gaps for this JD / lack of experience in a requirement"
  | 'resume_jd_intro_answer'   // "tell me about myself FOR THIS ROLE" (identity+resume+jd)
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
  | 'document_structure_answer'
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
  /** BROAD doc-grounded flag — true for every template-seeded doc mode, files
   *  or not. Isolation consumers (contextRoute layer suppression,
   *  conversationHistoryPolicy, candidate-profile drop) key on THIS, per the
   *  ModesManager Defect C doctrine: isolation is cheap and stays wide.
   *  R9 (2026-08-12): #446 briefly repurposed this field to strict-preferred,
   *  silently turning plan-level isolation OFF for broad-not-strict modes. */
  documentGroundedCustomModeActive?: boolean;
  /** STRICT-preferred doc grounding (explicit strictness when the snapshot
   *  carries it; broad fallback for legacy callers). Prompt-refusal semantics
   *  (the grounding policyLine) key on THIS — a refusal instruction is only
   *  honest for a genuinely bounded universe. */
  strictDocumentGroundedActive?: boolean;
  /** The engine's `docGroundedEnforcementActive` (R1): explicit strict contract
   *  OR a doc-grounded mode with at least one real file. Everything that tells
   *  the model (or the validator) to answer FROM documents keys on THIS, so the
   *  prompt, the routing, the forced retrieval and the post-stream validator
   *  cannot disagree about whether a turn is document-grounded. */
  docGroundedEnforcementActive?: boolean;
  /** STRICT on the AUTHORITY ALONE — `activeMode.strictDocumentGroundedActive`
   *  verbatim, with no files check folded in. Deliberately separate from
   *  `strictDocumentGroundedActive` above (which falls back to the broad flag
   *  for legacy callers) because the refusal gate needs the un-fallen-back
   *  value: strictDocumentGroundedFromContract returns true for
   *  `reference_files_only` before anything is uploaded. */
  documentGroundedStrict?: boolean;
  /** Whether the active mode actually has at least one reference file. Paired
   *  with `documentGroundedStrict` so the prompt can distinguish "bounded
   *  universe exists" from "authority says documents, but there are none". */
  documentGroundedFilesPresent?: boolean;
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

// ── JD-SOURCE templates (2026-07-07) ────────────────────────────────────────
// These answer FROM the job description (the target role). They must never
// invent JD content and never turn JD requirements into the candidate's claimed
// experience. When a requested JD field is absent, they state that honestly
// ("the JD does not specify …") rather than refusing or asking for an upload.

const JD_SUMMARY_TEMPLATE = `You are describing the TARGET ROLE from the job description, to the user. Neutral, second-person/explanatory voice (not first-person candidate).

Answer concisely:
- What kind of role/candidate the JD is looking for (seniority, focus, the core of the role).
- Ground EVERY claim in the JD evidence provided. Do not invent responsibilities or requirements that are not in the JD.
- If a detail the user asked about is not in the JD, say plainly it is not specified. Do not ask the user to upload or paste the JD — it is already provided as evidence.
- 2-4 sentences, speakable.`;

const JD_REQUIREMENTS_TEMPLATE = `You are listing what the job description REQUIRES (skills, responsibilities, requirements), to the user. Neutral, explanatory voice.

Answer:
- Pull the requested items (top skills / requirements / responsibilities / technologies) DIRECTLY from the JD evidence provided.
- Do not add requirements that are not in the JD. Do not map them onto the candidate's resume here — this is about the role only.
- If the JD does not list the requested category, say so honestly.
- Prefer a short, scannable list; keep it tight.`;

const JD_FACT_TEMPLATE = `You are answering a specific FACTUAL question about the job description (e.g. salary, relocation, location, employment type, years required).

Answer:
- If the JD evidence contains the fact, state it directly.
- If the JD does NOT contain the fact, say plainly: "The JD does not specify [that]." Never say the JD is not loaded, never ask for an upload, and never pivot into salary negotiation advice unless the user explicitly asked how to negotiate.
- One or two sentences. No filler.`;

const RESUME_JD_FIT_TEMPLATE = `Use exactly these sections. Resume evidence describes the CANDIDATE; JD evidence describes the TARGET ROLE — keep them distinct and never present a JD requirement as the candidate's experience.

Short Fit Summary:
[Concise first-person fit statement for THIS role.]

Matching Experience & Projects:
[Only the candidate's real resume experience/projects that map to the JD's needs. Name the specific project/role. Never invent experience the resume does not show.]

Where I'm Strongest For This JD:
[The 1-2 requirements from the JD the candidate most clearly meets, tied to concrete resume evidence.]

Speakable Final Answer:
[A polished 2-4 sentence first-person answer.]`;

const RESUME_JD_GAP_TEMPLATE = `This is a GAP question about the candidate vs THIS JD. Lead with the honest gap. Resume evidence = the candidate; JD evidence = the role. If the JD asks for something the resume does not show, that is the gap — name it; do NOT fabricate the experience.
Use exactly these sections:

The Honest Gap:
[ONE specific JD requirement the candidate's resume shows less of. Concrete. Do not pretend there is no gap; do not turn this into a fit-summary.]

Why It's Manageable:
[Adjacent, REAL resume experience that makes closing the gap credible — no invented experience.]

How I'd Close It:
[A specific, realistic ramp/mitigation plan.]

Speakable Final Answer:
[Confident-but-honest first person: gap first, then mitigation. Never stall.]`;

const RESUME_JD_INTRO_TEMPLATE = `You are giving a first-person self-introduction TAILORED TO THIS ROLE. Use the candidate's real identity + resume, and steer the emphasis toward what the JD values. Resume evidence = the candidate; JD evidence = the role — do not claim JD requirements as experience you don't have.

Answer:
- Open with who the candidate is (name + current focus), then 2-3 of the most role-relevant experiences/projects/skills from the resume, framed toward the JD's priorities.
- First person, natural, speakable (about 4-6 sentences). No headers.
- Never invent experience; if the JD wants something the resume lacks, simply emphasize the closest real strength instead of fabricating.`;

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
const DOCUMENT_STRUCTURE_TEMPLATE = `Answer from the uploaded document's table-of-contents / heading evidence only. These are navigation questions — a chapter or section title, the page a section begins on, or how many chapters/sections/pages there are. Report the exact title or number as written in the evidence. Do not summarize the section's content and do not infer a title or page that is not literally present.`;
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

// BEHAVIORAL-PAST-EXPERIENCE GUARD (shared). A past-tense candidate frame
// ("tell me about a time you fixed a memory leak", "describe how you improved
// test coverage with unit testing at your last job") must defer away from a
// forbidden-profile technical/debugging lane into behavioral/skill-experience
// routing — the candidate is telling a STAR story about their own past, not
// asking for a neutral definition. Originally inline in the debugging-question
// branch only (manual regression 2026-06-12, stress seq_056; narrower verb
// list: solved/fixed/faced/debugged/handled/dealt with/encountered/resolved/
// found). Factored out and widened (2026-07-27, RC-9 code review): the
// SOFTWARE_ENGINEERING_CONCEPT_PATTERNS vocabulary expansion above (design
// pattern, load balancing, unit testing, etc.) widened the technical_concept
// branch's surface into far more common behavioral-interview phrasing than the
// old DSA-only terms did ("describe a time you set up load balancing under
// pressure", "describe a design pattern you introduced to fix a messy
// codebase", "describe how you improved test coverage with unit testing at
// your last job") — none of which the original narrow verb list caught, since
// none of those questions use "solved/fixed/faced/...". Both branches now
// share this wider guard so they can't drift out of sync.
const PAST_TENSE_STORY_FRAME_RE = /\b(tell me about|describe|share|give me an example of)\b.{0,60}\b(you|you'?ve|u)\b.{0,80}\b(solved|fixed|faced|debugged|handled|dealt with|encountered|resolved|found|improved|introduced|set up|built|designed|used|implemented|created|adopted|migrated|optimi[sz]ed|refactored|chose|architected)\b/i;
const HARDEST_BUG_STORY_FRAME_RE = /\b(hardest|toughest|most difficult|trickiest|worst)\b.{0,30}\b(bug|error|issue|crash)\b.{0,40}\b(you|you'?ve|your career|you ever)\b/i;
const isPastTensePersonalExperienceFrame = (text: string): boolean =>
  PAST_TENSE_STORY_FRAME_RE.test(text) || HARDEST_BUG_STORY_FRAME_RE.test(text);
// Typo-tolerant technical vocabulary (RC-2 fix): a one-edit-distance misspelling
// of a common technical term ("qraphql") should route the same as the correctly
// spelled term, rather than falling through to classifyUnmatchedFallback's
// unknown_answer (which had no relevance-gated profile policy — see RC-1). Only
// terms >= 4 chars are fuzzed by includesPlannerTerm, so short acronyms like
// "api" rely on the exact TECHNICAL_SUBJECT_PATTERNS entry above instead.
// "mutex" deliberately excluded (code-review 2026-07-27): levenshtein1('mute',
// 'mutex') is true, and "mute" is a common word in a live-meeting/interview
// product's transcripts — the exact `\bmutex\b` pattern in
// TECHNICAL_SUBJECT_PATTERNS above already covers the correctly-spelled term.
const TYPO_TOLERANT_TECHNICAL_TERMS = [
  'graphql', 'database', 'algorithm', 'javascript', 'typescript', 'kubernetes',
  'docker', 'postgres', 'postgresql', 'mongodb', 'redis', 'kafka',
  'microservice', 'recursion', 'encryption', 'deadlock', 'semaphore',
  'concurrency', 'asynchronous', 'polymorphism', 'inheritance', 'websocket',
  'idempotent', 'middleware', 'endpoint', 'authentication', 'authorization',
  'serverless', 'container', 'framework', 'compiler', 'interpreter',
];
const isLikelyTechnicalConcept = (text: string): boolean =>
  includesAny(text, TECHNICAL_SUBJECT_PATTERNS)
  || includesAny(text, DEVOPS_CICD_PATTERNS)
  || includesAny(text, SOFTWARE_ENGINEERING_CONCEPT_PATTERNS)
  || TYPO_TOLERANT_TECHNICAL_TERMS.some((term) => includesPlannerTerm(text, term));








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
  // SENTENCE-SCOPED (RC-1a, live session C 2026-08-21): the verb and the object
  // must co-occur in ONE sentence. Tested whole-string, a long multi-question
  // turn paired "the call" from the interviewer's opener with "noticeably" from
  // a performance question ~700 chars later, routing 17 real technical answers
  // into the safe-decline contract. A genuine stealth ask ("can the interviewer
  // see this overlay?") always keeps verb and object in the same sentence.
  // Branch (a) above deliberately stays whole-string — explicit evasion intent
  // is a strong signal and over-coverage there is the documented safety posture.
  // Newlines count as sentence boundaries too: an UNPUNCTUATED transcript
  // (local STT emits no punctuation) would otherwise be one giant "sentence"
  // and reopen the cross-match this scoping exists to close (review pass,
  // 2026-08-22).
  for (const sentence of t.split(/[.?!…\n]+/)) {
    if (!STEALTH_SOFT_VISIBILITY_RE.test(sentence)) continue;
    // require the object to be an interviewer/proctor/screen-share (not a bare
    // "monitor" hardware word) so "does it work with a second monitor" is safe.
    if (!/\b(interview\w*|proctor\w*|invigilat\w*|recruiter|examiner|screen[- ]?shar\w*|screenshar\w*|share my screen|sharing my screen|the (?:call|meeting|assessment|exam|test))\b/.test(sentence)) continue;
    // EXCLUDE a candidate-possessive object ("will the interviewer see MY code/
    // portfolio/answer/screen?") — a benign visibility question, not an ask to
    // hide the TOOL (code-review 2026-06-07 false-positive-refusal fix)...
    const candidatePossessiveVisibility = /\b(see|view|notice|read|watch)\b[^.?!]{0,30}\bmy\b/.test(sentence)
      || /\bmy (code|portfolio|answer|screen|solution|work|repo|link|profile)\b/.test(sentence);
    // ...UNLESS the same sentence ALSO aims a visibility verb at the TOOL
    // itself ("if I share my screen on the call, will they detect the tool?") —
    // then the possessive is incidental and the tool-visibility ask wins.
    // Code-review 2026-08-22: bare "it" removed from the tool-noun set —
    // an anaphoric "it" ("will they see my screen when I share it?") sat
    // within 40 chars of the verb and overrode the possessive exemption,
    // refusing a benign question. An explicit tool noun is required; a
    // genuine "will they detect it?" with a possessive nearby is the
    // benign shape, and without one, branch (b)'s object test still fires.
    const toolVisibility = /\b(see|sees|notice\w*|detect\w*|spot|catch\w*|find)\b[^.?!]{0,40}\b(the (?:tool|app|overlay|window|ui)|natively|nativley)\b/.test(sentence);
    if (candidatePossessiveVisibility && !toolVisibility) continue;
    return true;
  }
  return false;
};








// ── JD-SOURCE cue predicates (2026-07-07, JD/Resume JIT pipeline fix) ─────────
//
// GENERALIZED, benchmark-free cues. They key off SHAPE — "does the question
// refer to the target role / job description?" vs "does it claim first-person
// candidate ownership (my / I / me)?" — never off any specific JD title,
// company, or question string. The routing rule (applied in planAnswer):
//   JD-reference cue WITHOUT candidate cue  → JD-source shape (jd_* )
//   JD-reference cue WITH candidate cue     → resume+JD shape (resume_jd_*)
//   candidate cue, no JD cue                → existing profile route (unchanged)
//   no cue                                  → existing route (unchanged)

// The question references the TARGET ROLE / JD as a source. Deliberately broad
// on role/JD nouns but requires the JD framing, not just any occurrence of
// "role" (a bare "your role in the project" is candidate-owned, handled by the
// candidate cue winning the mix).
const JD_REFERENCE_CUE_RE = /\bjd\b|\b(this|the)\s+(job\s*description|role|position|job|posting|listing|opening|vacancy)\b|\bjob\s*description\b|\bfor\s+(this|the)\s+(role|position|job)\b|\brequired\s+for\s+(the|this)\s+(role|position|job)\b|\b(they|the\s+employer|the\s+company|the\s+recruiter|the\s+hiring\s+manager)\s+(want|wants|require|requires|need|needs|are\s+looking\s+for|is\s+looking\s+for|expect|expects)\b|\blooking\s+for\s+in\s+(a|the|this)\b/i;

// First-person candidate ownership: "my / I / me / mine / myself" over a
// candidate-ish noun, OR the bare first-person pronouns in an interview frame.
// Reuses the same shape sourceOwnership.ts uses so the two stay consistent.
const CANDIDATE_OWNERSHIP_CUE_RE = /\b(my|mine|myself)\b|\bi\s+(have|had|did|do|am|was|worked|built|made|led|used|studied|know)\b|\b(should|do|would|can)\s+i\b|\bam\s+i\b|\bfor\s+me\b/i;

// A JD FACTUAL lookup — a specific field of the JD (salary, relocation,
// location, employment type, years required, a named technology requirement).
const JD_FACT_CUE_RE = /\b(salary|compensation|pay|wage|stipend|ctc|relocat(?:e|ion)|location|remote|onsite|on-site|hybrid|employment\s*type|full[- ]?time|part[- ]?time|contract|years?\s+of\s+experience|experience\s+(required|needed)|visa|sponsor(?:ship)?|benefits?)\b/i;

// The JD asks for its own requirements/skills/responsibilities (role-directed,
// not the candidate's skills). "skills required for this role", "what does the
// role require", "responsibilities in the JD", "technologies the JD lists".
const JD_REQUIREMENTS_CUE_RE = /\b(require(?:d|ment|ments)?|responsibilit(?:y|ies)|skills?\s+(required|needed|listed|for\s+(the|this))|technolog(?:y|ies)|qualifications?|must[- ]haves?|duties|expect(?:ed|ations?)?)\b/i;

// The JD-summary shape: "what kind of candidate/engineer/analyst/person does
// the JD want", "what is this role", "what are they looking for".
const JD_SUMMARY_CUE_RE = /\bwhat\s+(kind|type|sort)\s+of\s+(candidate|engineer|developer|analyst|person|role|hire|profile)\b|\bwhat\s+(is|kind of)\s+(this|the)\s+(role|job|position)\b|\bwhat\s+(are|is)\s+(they|the\s+employer|the\s+company)\s+looking\s+for\b|\bwhat\s+does\s+(this|the)\s+(role|job|position)\s+(involve|entail|need|want)\b/i;

// A JD-tailored INTRO ("tell me about yourself / walk me through my resume FOR
// THIS ROLE / WITH THIS JD in mind"). Needs BOTH an intro cue and a JD cue.
const INTRO_SHAPE_CUE_RE = /\b(tell me about (yourself|myself)|introduce (yourself|myself)|walk me through (your|my) (resume|cv|background)|give me (a|an) (intro|introduction)|30[- ]?second (intro|introduction|pitch)|elevator pitch)\b/i;

// A JD-relative RESUME selector ("most relevant PROJECT / internship / experience
// FOR THIS JD/role", "which of my X best matches"). Needs a candidate-owned
// artifact noun AND a JD cue.
const RESUME_JD_SELECTOR_CUE_RE = /\b(most|best|strongest)\s+(relevant\s+)?(project|projects|internship|internships|experience|role|work)\b|\bwhich\s+(of\s+)?(my\s+)?(project|projects|internship|internships|experience|role|skill)s?\b/i;

// A gap/lack-of-experience cue explicitly relative to the JD's requirements.
// This must be checked BEFORE isHypotheticalTech so "how would you explain your
// lack of experience in [a JD requirement]" stops routing to technical_concept.
const RESUME_JD_GAP_CUE_RE = /\b(lack|lacking|missing|gap|gaps|weak|weakness|don'?t\s+have|do\s+not\s+have|no\s+experience|less\s+experience|not\s+experienced|short\s+on)\b/i;

// Explicit "how to negotiate" steer — the ONLY thing that keeps a salary
// question on the negotiation route instead of jd_fact.
const NEGOTIATION_ADVICE_CUE_RE = /\b(how\s+(should|do|would|can)\s+i\s+(negotiate|ask\s+for|counter)|negotiat(?:e|ing|ion)\s+(advice|tips|strategy|script)|counter[- ]?offer|how\s+much\s+should\s+i\s+ask)\b/i;

/** Does the question reference the target role / JD as a source? */
const hasJdReferenceCue = (text: string): boolean => JD_REFERENCE_CUE_RE.test(text);
/** Does the question claim first-person candidate ownership? */
const hasCandidateOwnershipCue = (text: string): boolean => CANDIDATE_OWNERSHIP_CUE_RE.test(text);

// Grounding-campaign fix (2026-07-17): a bare comp keyword ("compensation",
// "salary") in a question that ALSO frames the JD as the source ("what's the
// compensation range for THIS ROLE?") is a factual JD lookup — planAnswer's
// own resolveJdSourceType correctly routes it to jd_fact_answer. But
// IntelligenceEngine.ts's live WTA grounding gate uses a separate, cruder
// classifier (transcriptQuestionExtractor.classifyType) that has no JD-frame
// awareness and routes ANY comp keyword straight to 'negotiation' —
// excluding ALL candidate-profile/JD grounding for that turn, including a
// pure "what does the document literally state" lookup. Confirmed live
// (test/harness case C4-002): the model then falsely claimed the JD "does
// not specify the company name" and "does not state a salary range" when
// both were literally present in the real JD text.
// This helper reuses the SAME jd-reference-cue + negotiation-advice-cue
// signals resolveJdSourceType already relies on, without duplicating its
// full JD-shape resolution logic — narrowly answering just the one question
// IntelligenceEngine.ts's gate needs: "is this JD-framed and NOT asking for
// negotiation advice/strategy?" A true negotiation-coaching ask ("how should
// I negotiate my salary", "what should I counter with") still routes through
// the existing negotiation channel untouched.
export const isJdFactualLookupNotNegotiationAdvice = (text: string): boolean =>
  hasJdReferenceCue(text) && !NEGOTIATION_ADVICE_CUE_RE.test(text);

const isHypotheticalTech = (text: string): boolean => includesAny(text, HYPOTHETICAL_TECH_PATTERNS);

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
    case 'jd_summary_answer':
      return JD_SUMMARY_TEMPLATE;
    case 'jd_requirements_answer':
      return JD_REQUIREMENTS_TEMPLATE;
    case 'jd_fact_answer':
      return JD_FACT_TEMPLATE;
    case 'resume_jd_fit_answer':
      return RESUME_JD_FIT_TEMPLATE;
    case 'resume_jd_gap_answer':
      return RESUME_JD_GAP_TEMPLATE;
    case 'resume_jd_intro_answer':
      return RESUME_JD_INTRO_TEMPLATE;
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
    case 'document_structure_answer':
      return DOCUMENT_STRUCTURE_TEMPLATE;
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

// Exported (Phase 6 Slice 2, context-rebuild, 2026-07-25) so the exhaustiveness
// test for isLayerAllowed's fail-closed prior_assistant_responses rule
// (contextRoute.ts) can iterate every real AnswerType directly instead of
// reverse-engineering a question per type. Pure, deterministic, no behavior
// change from exporting.
export const requiredLayersFor = (answerType: AnswerType, documentGroundedCustomModeActive = false): ContextLayer[] => {
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
    // JD-SOURCE shapes. The JD is the PRIMARY source (target role), so `jd` is
    // required. jd_summary may also use custom_context (a user preference like
    // "I care about remote"), but never the resume as a mandatory source — these
    // describe the ROLE, not the candidate.
    case 'jd_summary_answer':
      return ['jd', 'custom_context'];
    case 'jd_requirements_answer':
    case 'jd_fact_answer':
      return ['jd'];
    // Resume+JD MIX shapes. Both the candidate resume AND the target JD ground
    // the answer; the prompt keeps them in SEPARATE labelled blocks so JD
    // requirements never become candidate claims.
    case 'resume_jd_fit_answer':
      return ['resume', 'jd', 'custom_context', 'ai_persona'];
    case 'resume_jd_gap_answer':
      return ['resume', 'jd'];
    case 'resume_jd_intro_answer':
      return ['stable_identity', 'resume', 'jd', 'custom_context', 'ai_persona'];
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
    case 'document_structure_answer':
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

// Exported for the same reason as requiredLayersFor above.
export const forbiddenLayersFor = (answerType: AnswerType): ContextLayer[] => {
  switch (answerType) {
    case 'identity_answer':
      return ['jd', 'negotiation', 'reference_files'];
    case 'coding_question_answer':
    case 'dsa_question_answer':
    case 'technical_concept_answer':
    case 'system_design_answer':
    case 'debugging_question_answer':
      // Spec §8.3: generic coding/technical answers must NOT use any profile.
      // RC3 fix (Phase 6 Slice 2, context-rebuild, 2026-07-25): also forbid
      // prior_assistant_responses. Before this fix, these five answer types
      // appeared in NEITHER forbiddenLayersFor NOR requiredLayersFor for this
      // layer, so isLayerAllowed's fail-open default
      // (`!plan.forbiddenContextLayers.includes(layer)`, contextRoute.ts)
      // silently ALLOWED it — an unrelated prior turn's content (e.g. a
      // résumé/JD-fit answer) could leak into a subsequent, unrelated
      // coding/technical question's prompt. See
      // docs/context-rebuild/03_ROOT_CAUSES.md RC3 and
      // 04_TARGET_ARCHITECTURE.md §8.
      return ['resume', 'jd', 'negotiation', 'custom_context', 'reference_files', 'prior_assistant_responses'];
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
    case 'jd_summary_answer':
    case 'jd_requirements_answer':
    case 'jd_fact_answer':
      // JD-source answers describe the TARGET ROLE only — never the salary/
      // negotiation layer (jd_fact reports an absent comp field honestly instead
      // of negotiating) and never reference_files (the JD is structured, not an
      // uploaded doc in a custom mode).
      return ['negotiation', 'reference_files'];
    case 'resume_jd_fit_answer':
    case 'resume_jd_gap_answer':
    case 'resume_jd_intro_answer':
      // Resume+JD answers never pull the negotiation/salary layer.
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
    case 'document_structure_answer':
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
  // Resume+JD mixes are answered in the candidate's own voice (fit/gap/intro
  // for THIS role). JD-only shapes (jd_summary/requirements/fact) are NOT here —
  // they describe the role to the user in neutral assistant voice.
  'resume_jd_fit_answer', 'resume_jd_gap_answer', 'resume_jd_intro_answer',
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
    case 'document_structure_answer':
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
    case 'resume_jd_fit_answer':
    case 'resume_jd_gap_answer':
    case 'resume_jd_intro_answer':
      // Resume+JD mixes are ABOUT the candidate (in the context of the role) —
      // profile grounding is required, same as jd_fit.
      // Product-about answers MUST be grounded in the loaded project metadata
      // (no overclaim) — same as a project answer.
      return 'required';
    case 'jd_summary_answer':
    case 'jd_requirements_answer':
    case 'jd_fact_answer':
      // JD-source answers describe the TARGET ROLE, not the candidate. The
      // profile is NOT required (and must not be forced in); the JD layer is the
      // source. 'allowed' keeps the profile from being mandated while the `jd`
      // layer (required above) carries the actual grounding.
      return 'allowed';
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

// ── JD-SOURCE resolver (2026-07-07, JD/Resume JIT pipeline fix) ──────────────
//
// The SINGLE, generalized decision for "is this a JD-source or resume+JD
// question, and which shape?". Returns one of the 6 new answer types or null.
// Keyed purely off SHAPE cues (JD-reference vs candidate-ownership vs
// fact/requirement/intro/gap/selector) — never off any specific JD/company/
// project/question string. Runs EARLY in planAnswer (before negotiation/
// identity/skills/technical/unknown) so a JD question can no longer have its
// `jd` layer dropped by a candidate-centric branch.
//
// Precedence inside a JD context:
//   1. JD-tailored intro (intro cue + JD cue)          → resume_jd_intro_answer
//   2. JD-relative resume gap (gap cue + JD cue)        → resume_jd_gap_answer
//   3. JD-relative resume selector (my-artifact + JD)   → resume_jd_fit_answer
//   4. Candidate-owned fit inside a JD frame            → resume_jd_fit_answer
//   5. JD factual field lookup (no candidate cue)       → jd_fact_answer
//   6. JD requirements/skills/responsibilities          → jd_requirements_answer
//   7. JD summary ("what role/candidate do they want")  → jd_summary_answer
// A coding/write verb ALWAYS vetoes (a JD-shaped coding task is still coding).
// The resolver is deliberately CONSERVATIVE: it only claims questions the
// existing branches MISS (JD-only → unknown/skills, which forbid jd) or
// MISROUTE (JD-tailored intro → identity; gap-for-JD phrased as "how would you
// explain your lack…" → technical_concept). Questions the established
// GAP_PATTERNS / JD_FIT_PATTERNS branches already route correctly (both emit
// resume+jd) are DEFERRED (return null) so their proven regression guards stay
// authoritative. `matchesJdFitPattern`/`matchesGapPattern`/`isHypotheticalTechAsk`
// are passed in from planAnswer so this stays a pure function of the same text.
const resolveJdSourceType = (
  text: string,
  hasWriteCodeVerb: boolean,
  isHypotheticalTechAsk: boolean,
  matchesJdFitPattern: boolean,
  matchesGapPattern: boolean,
): AnswerType | null => {
  if (hasWriteCodeVerb) return null;
  const jdRef = hasJdReferenceCue(text);
  // First-person candidate ownership ("my resume", "I built", "should I").
  const firstPerson = hasCandidateOwnershipCue(text);
  // Second-person address to the candidate ("you/your").
  const secondPerson = /\b(you|your|yourself|u|ur)\b/i.test(text);
  const candidateAddressed = firstPerson || secondPerson;
  const introShape = INTRO_SHAPE_CUE_RE.test(text);

  // (1) JD-tailored intro: an intro request tied to the role. Needs BOTH the
  // intro shape and a JD reference so a plain "tell me about yourself" (no JD
  // cue) still routes to the existing identity path. Fixes "tell me about
  // yourself FOR THIS ROLE" / "walk me through my resume WITH THIS JD" collapsing
  // to identity_answer (which forbids jd).
  if (introShape && jdRef) return 'resume_jd_intro_answer';

  // Everything below requires a JD reference cue — no JD framing, no JD route.
  if (!jdRef) return null;

  // (2) Gap-for-JD phrased as a HYPOTHETICAL ("how would you explain your lack
  // of experience in [a JD requirement]"). This is the ONLY gap shape we claim:
  // it is the one the existing GAP_PATTERNS branch never sees because
  // isHypotheticalTech steals it into technical_concept FIRST. A plain gap ask
  // ("what gap do you have for this role") does NOT match isHypotheticalTech, so
  // it falls through to the proven GAP_PATTERNS→gap_analysis_answer route.
  if (isHypotheticalTechAsk && RESUME_JD_GAP_CUE_RE.test(text) && candidateAddressed) {
    return 'resume_jd_gap_answer';
  }

  // (3) JD-relative resume SELECTOR ("most relevant project/internship for this
  // JD", "which of my projects best matches"). Fixes "most relevant project for
  // this JD" → project_answer (drops jd). Defer if the existing jd_fit patterns
  // already claim it (they route resume+jd correctly).
  if (!matchesJdFitPattern && RESUME_JD_SELECTOR_CUE_RE.test(text) && candidateAddressed) {
    return 'resume_jd_fit_answer';
  }

  // A candidate-addressed question the existing GAP/JD_FIT patterns already
  // handle → defer to them (they route resume+jd; their guards are proven).
  if (candidateAddressed && (matchesJdFitPattern || matchesGapPattern)) return null;

  // (4) A FIRST-PERSON question in a JD frame that the existing patterns MISSED
  // is an explicit resume+JD FIT ask ("how do I align with this role").
  if (firstPerson) return 'resume_jd_fit_answer';

  // A bare second-person motivation/fit question the existing patterns missed is
  // still deferred (return null) — the JD-ONLY shapes below are only for
  // questions that do NOT address the candidate at all.
  if (secondPerson) return null;

  // ── JD-ONLY shapes (the question does not address the candidate) ──
  // (5) A factual field lookup about the JD ("does the JD mention salary?",
  // "is relocation required?", "how many years does the role need?"). Reported
  // from the JD's fields, or an honest absence — NOT negotiation. GUARD: a
  // "use the JD but NOT salary" fit STEER negates the field — it is not a salary
  // FACT lookup, so defer it to the jd_fit route. A genuine fact question ("does
  // the JD mention salary?") does not negate the field and still routes here.
  if (JD_FACT_CUE_RE.test(text)) {
    const negatesTheFact = /\b(not|no|without|never|skip|avoid|exclude|but no|but not)\s+(?:any\s+|the\s+|give\s+|giving\s+|mention(?:ing)?\s+|talk(?:ing)?\s+about\s+|discuss(?:ing)?\s+)?(salary|compensation|package|ctc|pay|money|relocat(?:e|ion))\b/i.test(text);
    if (negatesTheFact) return matchesJdFitPattern ? null : 'jd_summary_answer';
    return 'jd_fact_answer';
  }

  // (6) The JD's own requirements/skills/responsibilities/technologies.
  if (JD_REQUIREMENTS_CUE_RE.test(text)) return 'jd_requirements_answer';

  // (7) A summary of the role / what kind of candidate the JD wants.
  if (JD_SUMMARY_CUE_RE.test(text)) return 'jd_summary_answer';

  // A JD reference the existing jd_fit patterns already claim → defer.
  if (matchesJdFitPattern) return null;

  // A JD reference with no more specific shape and not claimed elsewhere →
  // summarize the role.
  return 'jd_summary_answer';
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
  // Grounding-campaign2 fix (2026-07-17): "how do you stack up (there/against
  // the JD)?" is the comparison IDIOM ("measure up"), not the data-structure
  // noun — but the bare `\bstack\b` in DSA_PATTERNS/TECHNICAL_SUBJECT_PATTERNS
  // matched it anyway, misrouting a JD-fit self-assessment question ("The JD
  // calls for 8+ years and deep Go or Java expertise — how do you stack up
  // there?") into technical_concept_answer. That answer type FORBIDS the
  // resume/jd context layers (it's meant for "what is Redis?"-style neutral
  // explanations), so the candidate's own profile/JD never reached the prompt
  // and the model answered from CORE_IDENTITY's blanket "reveal internals"
  // refusal instead ("I can't share that information.") — live-confirmed on
  // run-014/verify_fix10 (press A9). Neutralize the idiom the same way the
  // tech-stack/full-stack phrases are neutralized above, before any DSA/
  // technical-concept pattern sees the text.
  const textNoTechStack = text
    .replace(/\b(tech|technology|technical)\s+stack\b/g, 'techstack')
    .replace(/\bfull[- ]?stack\b/g, 'fullstack')
    .replace(/\bstack(s|ed)?\s+up\b/g, 'measure$1 up')
    // WTA audit F1 (2026-08-18): a demonstrative/possessive "stack" ("that
    // stack", "your stack") is a tech-stack reference — the data-structure
    // noun is never referred to that way in an interviewer ask. Without this,
    // "Why did you choose that stack?" fails the project-followup branch's
    // DSA negation guard and lands on dsa_question_answer (profile forbidden
    // + six-section coding repair). Choice-verb + "the stack" is the same
    // tech-stack sense; bare "a stack"/"the stack" elsewhere ("difference
    // between the stack and the heap") stays a data-structure term.
    .replace(/\b(that|this|your|our|their|my)\s+stack\b/g, '$1 techstack')
    .replace(/\b(chose|choose|chosen|choosing|pick|picked|picking|selected|select|use|used|using|went with|decided? on)\s+the\s+stack\b/g, '$1 the techstack');
  const extractedType = input.extractedQuestion?.questionType;
  // Defect C split: prefer the EXPLICIT strictness flag when the snapshot
  // carries it (live snapshots always do since 2026-08-12); fall back to the
  // broad flag only for older callers/tests that never pass strict. Keying
  // doc-shape routing and layer suppression on the broad flag ran the strict
  // pipeline for stock template-seeded modes with zero files.
  const documentGroundedCustomModeActive =
    (input.activeMode?.strictDocumentGroundedActive ?? input.activeMode?.documentGroundedCustomModeActive) === true;
  // R9: the raw broad flag, for the PLAN FIELD isolation consumers read.
  const broadDocumentGroundedActive = input.activeMode?.documentGroundedCustomModeActive === true;
  // 2026-08-13: the SAME predicate IntelligenceEngine calls
  // `docGroundedEnforcementActive` (R1) — an explicit strict contract, or any
  // doc-grounded mode with at least one real file.
  //
  // It exists here because the four gates that decide "this turn answers from
  // documents" had drifted apart, and a template-seeded mode the user uploaded
  // a file into fell through the crack: origin stays 'default_new_mode' so
  // strict is false, but files exist so enforcement is true. Measured on main:
  //
  //   forced retrieval  routed doc-shape  grounding line  validator
  //   lecture   true        true (fallback)     FALSE        true
  //   team_meet true        FALSE               FALSE        false
  //
  // The lecture row is the dangerous one: the model is handed a document
  // context block and then graded by the post-stream zero-fabrication
  // validator, while its prompt never told it to ground anything — judged on a
  // rule it was never given. The team_meet row is R1's own stated goal
  // (restore the validator for seeded modes WITH files) going unmet, because
  // the validator also requires a doc-shaped answerType that routing never
  // produced.
  //
  // Fileless modes are unaffected (enforcement is false without files), so
  // this cannot reopen the 2026-08-05 Bug 001 refusals. Isolation is untouched
  // and stays authority-only on `broadDocumentGroundedActive`.
  const docGroundedEnforcementActive = input.activeMode?.strictDocumentGroundedActive === true
    || (broadDocumentGroundedActive && input.activeMode?.hasReferenceFiles === true);
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

  // JD-SOURCE routing decision (2026-07-07). Computed once; consulted in the
  // chain BELOW so JD/resume+JD questions never have their `jd` layer dropped by
  // a candidate-centric or fallback branch. A negotiation-ADVICE cue ("how
  // should I negotiate salary") keeps the negotiation route; a bare JD salary
  // FACT ("does the JD mention salary") routes jd_fact instead of negotiation.
  const jdSourceType = resolveJdSourceType(
    text,
    hasWriteCodeVerb,
    isHypotheticalTech(text),
    includesAny(text, JD_FIT_PATTERNS),
    includesAny(text, GAP_PATTERNS),
  );
  const wantsNegotiationAdvice = NEGOTIATION_ADVICE_CUE_RE.test(text);

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
  } else if (jdSourceType && !wantsNegotiationAdvice) {
    // A JD-source / resume+JD question. Placed before negotiation/identity/
    // skills/technical/unknown so the JD layer is routed as the primary source.
    // The one carve-out: an explicit "how do I negotiate / counter" steer keeps
    // the question on the negotiation route (falls through to the branch below),
    // so a JD-framed comp question that ASKS FOR NEGOTIATION ADVICE isn't
    // swallowed by the JD-source route.
    answerType = jdSourceType;
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
                     // Scoped to the exact TECHNICAL_SUBJECT_PATTERNS check only
                     // (NOT the typo-tolerant isLikelyTechnicalConcept) — code-review
                     // finding (2026-07-27): the broadened typo-tolerant matcher added
                     // for RC-2 (see isLikelyTechnicalConcept above) includes exact
                     // trigger words like "framework"/"api" that weren't guarded
                     // before, and this negation would then wrongly exclude a genuine
                     // project follow-up like "what frameworks did you use in your
                     // project?" from project_followup routing (recreating the same
                     // unknown_answer-leak bug class for a different question shape).
                     && !includesAny(textNoTechStack, TECHNICAL_SUBJECT_PATTERNS)))) {
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
    // STACK did you use?" survives because the textNoTechStack rewrite above
    // neutralizes "tech/technology/technical stack", "full-stack",
    // "stack(s|ed) up", and — WTA audit F1, 2026-08-18 — demonstrative/
    // possessive "that/this/your/our/their/my stack" plus choice-verb + "the
    // stack" BEFORE the DSA/technical patterns see the text. There is no
    // "personal did-you-use" gate; the rewrite is the ONLY protection, so any
    // new tech-stack phrasing must be added there. Pinned by
    // ProfileRoutingMatrix + WtaBareStackRouting2026_08_18.)
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
             // Now shared with the technical_concept branch below — see
             // isPastTensePersonalExperienceFrame's definition above.
             && !isPastTensePersonalExperienceFrame(text)) {
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
             (includesAny(textNoTechStack, DSA_PATTERNS) || isLikelyTechnicalConcept(textNoTechStack)) &&
             // BEHAVIORAL-PAST-EXPERIENCE GUARD (RC-9 code review, 2026-07-27):
             // same guard as the debugging branch above. "describe a time you
             // set up load balancing under pressure" / "describe how you
             // improved test coverage with unit testing at your last job" are
             // STAR stories about the candidate's own past, not neutral concept
             // asks — live-confirmed to wrongly lose profile access (was
             // behavioral_interview_answer/skill_experience/jd_fit before the
             // SOFTWARE_ENGINEERING_CONCEPT_PATTERNS vocabulary expansion widened
             // this branch's surface, technical_concept_answer/forbidden after,
             // with no guard). Without this, the wider vocabulary above
             // regresses exactly the class of question this guard was invented
             // to protect, just via new terms instead of "bug".
             !isPastTensePersonalExperienceFrame(text)) {
    // "Explain BFS", "what is a deadlock", "difference between TCP and UDP" —
    // generic technical CONCEPT, NO profile (spec Case F). Checked before
    // DSA/coding: a DSA noun with explain/what-is framing and NO coding verb is a
    // concept, not a coding task.
    // Grounding-campaign2 fix (2026-07-17): use the SAME textNoTechStack (which
    // now also neutralizes the "stack up" idiom, see its definition above) that
    // the DSA_PATTERNS check on this line already uses — isLikelyTechnicalConcept
    // wraps TECHNICAL_SUBJECT_PATTERNS, which independently contains a bare
    // \bstack\b, so calling it against the raw `text` let "how do you stack up
    // there?" slip through this branch even after the DSA_PATTERNS check itself
    // was fixed.
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
    // Grounding-campaign2 fix (2026-07-17): pass textNoTechStack, not raw
    // text — classifyUnmatchedFallback's own project-vs-jd_fit lean (below)
    // has the SAME bare \bstack\b collision as DSA_PATTERNS/
    // TECHNICAL_SUBJECT_PATTERNS above ("how do you stack up there?" tripped
    // its project_answer branch via the "stack" keyword instead of the
    // intended jd_fit_answer route for a JD-comparison question).
    const fb = classifyUnmatchedFallback(textNoTechStack, input);
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

  if (docGroundedEnforcementActive && !explicitDocumentModeCodingAsk && !explicitDocumentModeProfileAsk) {
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
    documentGroundedCustomModeActive: broadDocumentGroundedActive,
    strictDocumentGroundedActive: documentGroundedCustomModeActive,
    docGroundedEnforcementActive,
    // Kept as two separate facts rather than one pre-combined boolean. The
    // refusal gate needs BOTH, and the two previous attempts at this each
    // failed by collapsing them: keying on strict alone let a fileless
    // `reference_files_only` mode refuse against material the user never
    // provided; keying on enforcement alone made a template-seeded mode refuse
    // even though its retrieval was never forced.
    documentGroundedStrict: input.activeMode?.strictDocumentGroundedActive === true,
    documentGroundedFilesPresent: input.activeMode?.hasReferenceFiles === true,
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

/**
 * The adaptive per-turn LENGTH directive as a bare line ('' when the plan's
 * speakability tier doesn't warrant one). Extracted (RC-5, session C
 * 2026-08-21) so the V3 prompt path can deliver it too: V3's composed user
 * message replaces the whole <answer_contract>, and with it the only length
 * target the model ever saw — measured live, 73/85 answers overshot the
 * contract's own 60-word target (median 155, p90 310) because no per-turn
 * length line was delivered at all on V3-owned turns.
 */
export const renderLengthDirectiveForPlan = (plan: AnswerPlan): string => {
  if (plan.answerStyle && plan.answerStyle !== 'default') return '';
  // Coding output owns its own length (the contract's sections + code).
  if (isCodingAnswerType(plan.answerType)) return '';
  const tier = classifyTargetSpeakability(plan.answerType, plan.answerStyle, plan.question);
  // STRUCTURED_FULL is INTENTIONALLY long (speakability.ts: "must never be
  // length-trimmed" — code, system design, lecture notes, evidence quotes,
  // explicit step-by-step asks). Code-review 2026-08-23: the first ceiling
  // draft capped these at 130 words, contradicting the module contract and
  // self-contradicting on exactly the "walk me through it step by step"
  // questions that select the tier. No directive here, by design.
  if (tier === 'STRUCTURED_FULL') return '';
  if (tier === 'SPOKEN_FULL') {
    // A fuller spoken answer (STAR story, multi-part, pressured negotiation)
    // has its own budget — SPOKEN_FULL_MAX_WORDS, the same number
    // speakability's telemetry classifies against. Cap-first framing chosen
    // by paired live A/B (155w -> 131w on the equivalent outer-cap test).
    return `LENGTH LIMIT: at most ${SPOKEN_FULL_MAX_WORDS} words (~60 seconds spoken) — a hard cap, not a target. This is a LIVE spoken answer: tell the story or make the case completely, then stop — do not enumerate every angle. If your draft runs past ${SPOKEN_FULL_MAX_WORDS} words, cut whole branches, not adjectives.`;
  }
  const band = classifyShortBand(plan.answerType, plan.answerStyle, plan.question);
  const t = shortBandTargetWords(band);
  // The "aim for" phrasing alone was overshot ~50-100% live (sessions D/E:
  // 124w against a 60w band). The band stays the target; the ceiling gives
  // the model a hard number to cut against — clamped to HARD_MAX_WORDS so
  // the prompt can never instruct the model into the range speakability's
  // telemetry classifies as over_budget (code-review 2026-08-23: 85x1.25=106
  // crossed the 100-word line and would have corrupted the tuning signal).
  const ceiling = Math.min(Math.round(t.max * 1.25), HARD_MAX_WORDS);
  return `LENGTH: aim for about ${t.seconds}s spoken — roughly ${t.min} to ${t.max} words (${t.guidance}). Use fewer if the question is fully answered in fewer; never pad to reach the number. Hard ceiling: never go past ${ceiling} words — if your draft runs longer, cut examples and caveats, keep the point.`;
};

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
  // R9: the grounding/refusal instruction keys on STRICT-preferred — telling
  // the model to refuse outside "the uploaded material" is only honest when a
  // bounded universe exists; the broad flag put that line into every
  // template-seeded fileless mode's prompt.
  // 2026-08-13: keyed on ENFORCEMENT, so the instruction the model receives
  // matches the retrieval and validation it is actually subject to. Older
  // plans that predate the field fall back to the previous behaviour.
  // 2026-08-16: the doc-grounding policy line additionally requires FILES.
  //
  // R1 (`docGroundedEnforcementActive`) is what sets forceDocumentGrounding on
  // the retrieval call (LLMHelper.ts:2299, IntelligenceEngine.ts:1179), so
  // wherever it is true the model really is answering over retrieved documents
  // and the honesty mandate is honest — that is the F9 dissolution, pinned by
  // F9PurposeHonestyUnderR1_2026_08_15.
  //
  // But enforcement is ALSO true on the authority alone:
  // strictDocumentGroundedFromContract returns true for `reference_files_only`
  // before anything is uploaded, and its hasReferenceFiles check guards only the
  // reference_files_primary/_plus_transcript branch. A mode with nothing
  // uploaded — or whose last file was deleted — was therefore told to say the
  // answer "is not in the uploaded material" when there was no uploaded material
  // to be absent from. Requiring files closes exactly that hole and nothing else.
  //
  // Plans predating documentGroundedFilesPresent keep the old predicate.
  const _docEnforcement = (plan.docGroundedEnforcementActive
    ?? plan.strictDocumentGroundedActive ?? plan.documentGroundedCustomModeActive) === true;
  const _docPolicyActive = plan.documentGroundedFilesPresent === undefined
    ? _docEnforcement
    : (_docEnforcement && plan.documentGroundedFilesPresent === true);

  const policyLine = _docPolicyActive
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
  const _lengthLine = renderLengthDirectiveForPlan(plan);
  const lengthDirective = _lengthLine ? `\n\n${_lengthLine}` : '';
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
