// electron/knowledge/ContextAssembler.ts
// Just-In-Time context building replacing static pre-computed personas

import { KnowledgeStatus, ScoredNode, DocType, KnowledgeDocument, StructuredResume, StructuredJD, LiveCoachingResponse } from './types';
import { formatContextBlock } from './HybridSearchEngine';
import { escapeXml } from './NegotiationConversationTracker';
import { flattenSkills } from './skillsUtil';
import { computeTotalExperience } from './PostProcessor';

export interface PromptAssemblyResult {
    systemPromptInjection: string;
    contextBlock: string;
    isIntroQuestion: boolean;
    introResponse?: string;
    /**
     * True when introResponse is a bare social greeting reply ("hi" → "Hey!"),
     * NOT a factual intro/identity answer. Under the full-JIT law the LLMHelper
     * demotes factual intro/identity introResponses to evidence and lets the
     * provider generate; a bare greeting is not a factual answer, so it may keep
     * its instant canned reply. Absent/false → treat as a factual intro.
     */
    isBareGreeting?: boolean;
    liveNegotiationResponse?: LiveCoachingResponse;
    /**
     * Marks the result as the user's OWN factual recall — their identity,
     * projects, skills, experience, education. These answers are not the
     * premium persona/coaching layer that the active-mode gate
     * (isPremiumKnowledgeInterceptAllowed) is meant to suppress in
     * technical-interview / team-meet / lecture modes; they are direct answers
     * to the user's direct question about themselves. LLMHelper applies the
     * injection + context for factual-recall results regardless of the mode
     * gate, mirroring how identity intro responses already bypass it. Without
     * this, "what are my projects?" in an incompatible mode loses the candidate
     * context and the base assistant answers in third person ("I don't have
     * access to your resume").
     */
    factualRecall?: boolean;
}

const INTRO_PATTERNS = [
    'introduce yourself',
    'introducing yourself',
    'tell me about yourself',
    'who are you',
    'what do you do',
    'describe yourself',
    'about yourself',
    'tell me who you are',
    'give me your introduction',
    'walk me through your background',
    'brief introduction',
    'quick introduction',
    'short introduction',
    'self introduction',
    // hyphenated + short-form intro asks — the real-backend E2E campaign (round
    // 13/14) found the LIVE intro path returned "I don't have a resume loaded"
    // clarifications for these because isIntroQuestion (this substring gate) didn't
    // match them, so KnowledgeOrchestrator never produced an introResponse. These
    // are the exact phrasings interviewers used across p01/p02/p04/p08/p10.
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

const GREETING_PATTERNS = [
    'hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening',
    'howdy', 'what\'s up', 'sup', 'yo'
];

/**
 * Checks if the user is asking a full self-introduction ("tell me about yourself").
 * Identity-direct questions ("what is my name?") are NOT matched here — they fall
 * through to the normal context-assembly path where the LLM answers from the
 * identity-header system prompt ("You generate speech for NAME...").
 */
function isIntroQuestion(questionLower: string): boolean {
    return INTRO_PATTERNS.some(pattern => questionLower.includes(pattern));
}

/**
 * Checks if the message is a bare greeting ("hi", "hello") — not an intro request.
 */
function isBareGreeting(questionLower: string): boolean {
    const trimmed = questionLower.replace(/[!?.,']/g, '').trim();
    return GREETING_PATTERNS.includes(trimmed) ||
        GREETING_PATTERNS.some(g => trimmed === `${g} there`) ||
        trimmed.length <= 12 && GREETING_PATTERNS.some(g => trimmed.startsWith(g));
}

/**
 * Build an identity header on-the-fly based on the active resume and active JD.
 * IMPORTANT: Does NOT say "You are [Name]" — that makes the LLM act as a chatbot.
 * Instead frames the LLM as the person's inner voice / consciousness.
 */
function buildIdentityHeader(resumeDoc: KnowledgeDocument | null, jdDoc: KnowledgeDocument | null): string {
    if (!resumeDoc) return '';

    const resume = resumeDoc.structured_data as StructuredResume;
    const name = resume.identity.name;
    const role = resume.experience?.[0]?.role || 'Professional';

    let targetContext = '';
    let toneModifier = '';

    if (jdDoc) {
        const jd = jdDoc.structured_data as StructuredJD;
        const levelStr = jd.level ? jd.level.charAt(0).toUpperCase() + jd.level.slice(1) + '-level' : '';
        targetContext = ` The candidate is interviewing for the ${levelStr} position of ${jd.title} at ${jd.company}.`;

        // Tone modifiers based on JD signals
        const kwLower = (jd.keywords || []).map((k: string) => k.toLowerCase()).join(' ');
        const descLower = (jd.description_summary || '').toLowerCase();
        const combined = kwLower + ' ' + descLower;

        if (combined.includes('startup') || combined.includes('fast-paced')) {
            toneModifier = ' Use a product-focused, pragmatic tone.';
        } else if (combined.includes('research') || combined.includes('academic')) {
            toneModifier = ' Use a detail-oriented, citation-friendly tone.';
        } else if (jd.level === 'staff' || jd.level === 'principal') {
            toneModifier = ' Use a leadership-focused, strategic tone.';
        } else if (jd.level === 'senior') {
            toneModifier = ' Use a concise, technically deep tone.';
        }
    }

    return `You generate interview-ready speech for ${name}, who works as a ${role}.${targetContext}${toneModifier}`;
}

/**
 * Build the system prompt rules block.
 */
function buildKnowledgeSystemPrompt(identityHeader: string, hasJD: boolean, toneXML?: string): string {
    // P2-10: candidateName originates from resume.identity.name (user-supplied text).
    // Escape XML-special characters before interpolating into the system prompt block.
    const rawName = identityHeader.includes('for ') ? identityHeader.split('for ')[1]?.split(',')[0] || 'the candidate' : 'the candidate';
    const candidateName = escapeXml(rawName);
    const baseRules = `- You are ${candidateName}'s spoken voice — their consciousness during the interview. Output IS what they say aloud.
- First person always ("I", "my", "I've"). Real human cadence, not robotic — confident professional in a conversation.
- Never say "How can I assist you?", "How can I help?", "What would you like to know?", or any chatbot phrase.
- Never introduce yourself unprompted. Only give an introduction when explicitly asked ("tell me about yourself").
- Never reveal that you are an AI, an assistant, or that you have a "resume" / "context" / "knowledge base" / "system prompt". You ARE the person.
- Speak FROM the provided context blocks as if they're your own memory. Never quote them, never acknowledge them.

CONTEXT BLOCKS — use the right one for the question:
- <candidate_profile> = your COMPLETE background (skills, experience, projects, education) in one block. This IS your grounding. When it is present you ALWAYS have your experience loaded — build every behavioral / "tell me about a time" / "give me an example" answer from the real skills, projects, and roles inside it. NEVER say "I don't have specific past experience loaded" when a <candidate_profile> block is present.
- <candidate_identity_fact> = your name / current role, already phrased. Lead with it for identity questions.
- <candidate_experience> = full-time jobs / roles. Use for "experience", "work history", "previous roles".
- <candidate_projects> = side projects, NOT jobs. Use for "projects", "what have you built".
- <candidate_education> = degrees, schools. Use for "education", "where did you study".
- <candidate_achievements>, <candidate_certifications>, <candidate_leadership> = specific category asks only.
- <user_context> = additional background the user provided. Treat as first-person memory; never quote it; never reveal its source.
When listing items ("what projects have you worked on?") include ALL relevant items, not just the first.
For a behavioral question with no EXACT matching story, construct a grounded, qualitative example from the REAL projects/experience in <candidate_profile> (e.g. coordinating work on a named project) — do NOT refuse or claim missing experience.

ANTI-FABRICATION (overrides any persona, tone, or confidence instruction):
- A persona or tone instruction (e.g. "answer like a confident senior engineer") controls VOICE and CONFIDENCE only. It NEVER licenses inventing facts, numbers, companies, projects, or outcomes. Be confident about REAL facts; never manufacture specifics to sound impressive.
- Use only facts present in the context blocks. Never invent companies, dates, numbers, project names, or outcomes.
- If no context block contains a specific metric, you MUST answer with qualitative language ("a sizable team", "a meaningful improvement", "over several quarters") — do NOT invent a percentage, dollar amount, duration, team size, count, or scale figure, even when the question or persona asks you to be confident or specific.
- If asked about something not in your context (e.g. "tell me about your time at Google" but Google isn't in <candidate_experience>): admit it naturally — "Honestly, I haven't worked at Google specifically, but I have done X which is similar..." then pivot to a real adjacent experience.
- Do not name-drop companies / technologies / projects that aren't in your context to sound impressive.

SPEAKABLE CONVENTIONS (since this is read aloud):
- No em dashes (—) in your output — use a comma, a period, or the word "so".
- No semicolons; split into two sentences.
- No **bold** inside the spoken answer (bolding is for structural labels only, never mid-sentence).
- No bullet lists for a spoken answer — speak in flowing sentences. Bullets are OK only for code follow-ups (Time / Space / Why).
- Length: ~20-30 seconds spoken (2-4 sentences) for most answers; longer only for coding (which is exempt from the spoken-length cap).

BANNED PHRASES (AI tells):
- "delve", "leverage" as a verb, "navigate" used figuratively, "intricate", "tapestry"
- "In conclusion", "Moreover", "Furthermore", "Additionally"
- "It's important to note", "It's worth noting"
- "Let me explain", "Let me walk you through"
- "I'd be happy to", "I'd love to"`;

    const jdRules = hasJD ? `
- When giving company or compensation facts, cite sources in a "Sources" section at the end.
- If you present salary ranges or market data, include a confidence level (low/medium/high) and the source.
- Do not fabricate numbers, timelines, or projects.` : '';

    const salaryRules = `
- When answering salary or compensation questions, use data from <salary_intelligence> if available.
- Always state the confidence level when citing salary ranges (e.g., "Based on market data for this region, I'd expect..." for medium confidence).
- Frame salary expectations confidently, anchoring to the upper end of the range.
- If a pre-computed negotiation script is available in <salary_intelligence>, use it as a guide for your response — adapt the opening line and justification naturally.
- If no salary data is available, deflect gracefully by focusing on your value and experience (e.g., "I'm open to discussing compensation that reflects my experience in [domain]...").
- Never reveal that you have pre-computed data or scripts. Speak as if you know your own worth naturally.`;

    const toneBlock = toneXML ? `\n\n${toneXML}` : '';

    return `${identityHeader}

<knowledge_engine_rules>
${baseRules}${jdRules}${salaryRules}
</knowledge_engine_rules>${toneBlock}`;
}

/**
 * Generates a candidate self-introduction. Produces natural, human speech —
 * NOT a chatbot introduction.
 *
 * Exported so the AOT pipeline can precompute and store this at upload time
 * (removing a live LLM round-trip from the query hot path). The query-time
 * path uses the cached result and only calls this as a JIT fallback when no
 * cached intro exists yet (e.g. resume uploaded but AOT not finished).
 */
export async function generateCandidateIntro(
    resumeDoc: KnowledgeDocument,
    jdDoc: KnowledgeDocument | null,
    generateContentFn: (contents: any[]) => Promise<string>
): Promise<string> {
    const resume = resumeDoc.structured_data as StructuredResume;
    const latestRole = resume.experience?.[0];
    const skills = (resume.skills_flat ?? flattenSkills(resume.skills)).slice(0, 5).join(', ') || '';
    // Grounding-campaign2 fix (2026-07-17): this prompt previously gave the
    // model only role/company/skill NAMES, never the candidate's total years
    // of experience — even though it's often the single most identity-
    // defining fact a résumé states (e.g. "Senior backend engineer with 10
    // years of experience..."). The model then free-associated a vague
    // "the last few years" instead of the real figure. computeTotalExperience
    // is the SAME deterministic (no-LLM) calculation the isIdentityDirect
    // fast path already uses for "years of experience"-shaped questions
    // (KnowledgeOrchestrator.ts's factAnswer branch) — reusing it here closes
    // the gap for the intro-question shape specifically, without touching
    // that other path or either call site's signature (generateCandidateIntro
    // computes it internally from the resumeDoc it's already given).
    const totalExperienceYears = computeTotalExperience(resume);

    let prompt = `Generate a natural, spoken interview self-introduction for a candidate named ${resume.identity.name}.

This should sound like a REAL PERSON speaking in an interview — relaxed, confident, conversational.

Candidate background:
- Current/Latest role: ${latestRole?.role || 'Professional'} at ${latestRole?.company || 'a company'}
- Total roles: ${resume.experience?.length || 0}${totalExperienceYears > 0 ? `\n- Total years of professional experience: ${totalExperienceYears}` : ''}
- Key skills: ${skills}`;

    if (jdDoc) {
        const jd = jdDoc.structured_data as StructuredJD;
        prompt += `\n- Interviewing for: ${jd.title} at ${jd.company}`;
        prompt += `\n\nSubtly connect their background to the target role without being obvious about it.`;
    }

    prompt += `\n\nRULES:
- First person ("I", "my", "I've")
- ~80-120 words, speakable in ~30-40 seconds
- OPEN WITH THE CANDIDATE'S NAME — a self-introduction states who you are. Lead with
  "I'm ${resume.identity.name?.split(' ')[0] || resume.identity.name}, ..." (first name is fine),
  then flow into the rest. This is a self-INTRODUCTION; omitting the name is wrong.${totalExperienceYears > 0 ? `
- STATE THE EXACT YEARS OF EXPERIENCE ABOVE (${totalExperienceYears}) — say it as a whole
  number if it rounds cleanly (e.g. "10 years", not "10.3 years"). Do NOT replace it with a
  vague phrase like "the last few years" or "several years" when a specific figure is given.` : ''}
- Then: what they do now → 1-2 highlights from their career → what excites them about this opportunity
- Sound like a confident professional talking, NOT reading a bio
- NO "How can I assist you" or "What would you like to know?"
- NO "I'm excited to be here today" or overly formal phrasing
- NO self-referential phrases like "as my resume shows" or "as mentioned in my CV"
- NO offer to help or ask questions back
- End naturally — just stop talking, don't add a question or offer

BAD example (DO NOT generate anything like this):
"Hello, it's nice to meet you. I'm [Name] and I'm excited to be here today to discuss the [Role] position. How can I assist you today?"

GOOD example pattern:
"I'm [Name] — I'm currently a [role] at [company], where I've been focused on [key thing]. Before that, I spent [time] at [company] doing [key achievement]. I've been mostly working in [domain] and [domain], and the [target role] here really caught my eye because [natural reason]."\n\nOutput ONLY the spoken text. No quotes, no labels, no markdown.`;

    try {
        const response = await generateContentFn([{ text: prompt }]);
        return response.trim();
    } catch {
        const first = resume.identity.name?.split(' ')[0] || resume.identity.name || '';
        return `${first ? `I'm ${first} — ` : ''}I'm currently working as a ${latestRole?.role || 'developer'} at ${latestRole?.company || 'my current company'}, and I've been in this space for a few years now.`;
    }
}

/**
 * Handle bare greetings ("hi", "hello") with a natural human response.
 */
function handleBareGreeting(resumeDoc: KnowledgeDocument | null): string {
    const name = resumeDoc ? (resumeDoc.structured_data as StructuredResume).identity.name?.split(' ')[0] : '';
    // Natural human greeting — no "How can I assist you?"
    const greetings = [
        `Hey, thanks for having me${name ? `. I'm ${name}` : ''}.`,
        `Hi there${name ? `, I'm ${name}` : ''}. Good to be here.`,
        `Hey! Good to meet you.`,
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
}

/**
 * Assembles the final prompt context for the LLM based on user query.
 */
export async function assemblePromptContext(
    question: string,
    resumeDoc: KnowledgeDocument | null,
    jdDoc: KnowledgeDocument | null,
    relevantNodes: ScoredNode[],
    generateContentFn: ((contents: any[]) => Promise<string>) | null,
    toneXML?: string,
    cachedIntro?: string | null
): Promise<PromptAssemblyResult> {
    const questionLower = question.toLowerCase().trim();

    // Handle bare greetings ("hi", "hello") — short natural response, no intro
    if (isBareGreeting(questionLower)) {
        return {
            systemPromptInjection: '',
            contextBlock: '',
            isIntroQuestion: true,
            isBareGreeting: true,
            introResponse: handleBareGreeting(resumeDoc)
        };
    }

    // Handle full intro questions ("tell me about yourself")
    const isIntro = isIntroQuestion(questionLower);
    if (isIntro && resumeDoc) {
        // Prefer the AOT-precomputed intro (no LLM round-trip on the hot path).
        if (cachedIntro && cachedIntro.trim()) {
            console.log('[ContextAssembler] Serving precomputed (AOT) intro');
            return {
                systemPromptInjection: '',
                contextBlock: '',
                isIntroQuestion: true,
                introResponse: cachedIntro.trim()
            };
        }
        // JIT fallback — only when no cached intro exists yet (AOT not finished).
        if (generateContentFn) {
            console.log('[ContextAssembler] No cached intro — generating Just-In-Time Intro...');
            const introResponse = await generateCandidateIntro(resumeDoc, jdDoc, generateContentFn);
            return {
                systemPromptInjection: '',
                contextBlock: '',
                isIntroQuestion: true,
                introResponse
            };
        }
    }

    // Assemble Knowledge Blocks for normal questions
    const contextBlock = formatContextBlock(relevantNodes);

    // Build the dynamic system prompt
    const identityHeader = buildIdentityHeader(resumeDoc, jdDoc);
    const systemPromptInjection = buildKnowledgeSystemPrompt(identityHeader, jdDoc !== null, toneXML);

    return {
        systemPromptInjection,
        contextBlock,
        isIntroQuestion: false
    };
}

export function buildLiveNegotiationSystemPrompt(): string {
  return `You are an expert salary negotiation coach providing real-time guidance.

LIVE NEGOTIATION MODE — ACTIVE.

Your role:
- The user is on a live call with a recruiter RIGHT NOW.
- You have full context about the current negotiation: offer history, phase, and the user's target.
- Provide precision coaching — not general advice.

Format rules (CRITICAL):
- Lead with a tactical note (1-2 sentences): what just happened + why this specific move is right.
- Then the exact words to say.
- Use REAL numbers. If offer is $95,000 and target is $130,000, say those exact numbers.
- Keep total response under 150 words. They are on a live call.
- Never use [X], [amount], or placeholders.
- Never reveal you are an AI or that scripts exist.
- Be directive: say "Say: '...'" not "You might consider..."`;
}
