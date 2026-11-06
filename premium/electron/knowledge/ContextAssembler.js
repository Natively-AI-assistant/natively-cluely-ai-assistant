// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { escapeXml } from "./NegotiationConversationTracker";
import { flattenSkills } from "./skillsUtil";
import { computeTotalExperience } from "./PostProcessor";
import { formatContextBlock } from "./HybridSearchEngine";
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
// premium/electron/knowledge/ContextAssembler.ts
var INTRO_PATTERNS = [
    "introduce yourself",
    "introducing yourself",
    "tell me about yourself",
    "who are you",
    "what do you do",
    "describe yourself",
    "about yourself",
    "tell me who you are",
    "give me your introduction",
    "walk me through your background",
    "brief introduction",
    "quick introduction",
    "short introduction",
    "self introduction",
    // hyphenated + short-form intro asks — the real-backend E2E campaign (round
    // 13/14) found the LIVE intro path returned "I don't have a resume loaded"
    // clarifications for these because isIntroQuestion (this substring gate) didn't
    // match them, so KnowledgeOrchestrator never produced an introResponse. These
    // are the exact phrasings interviewers used across p01/p02/p04/p08/p10.
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
var GREETING_PATTERNS = [
    "hello",
    "hi",
    "hey",
    "good morning",
    "good afternoon",
    "good evening",
    "howdy",
    "what's up",
    "sup",
    "yo"
];
function isIntroQuestion(questionLower) {
    return INTRO_PATTERNS.some((pattern) => questionLower.includes(pattern));
}
function isBareGreeting(questionLower) {
    const trimmed = questionLower.replace(/[!?.,']/g, "").trim();
    return GREETING_PATTERNS.includes(trimmed) || GREETING_PATTERNS.some((g) => trimmed === `${g} there`) || trimmed.length <= 12 && GREETING_PATTERNS.some((g) => trimmed.startsWith(g));
}
function buildIdentityHeader(resumeDoc, jdDoc) {
    if (!resumeDoc)
        return "";
    const resume = resumeDoc.structured_data;
    const name = resume.identity.name;
    const role = resume.experience?.[0]?.role || "Professional";
    let targetContext = "";
    let toneModifier = "";
    if (jdDoc) {
        const jd = jdDoc.structured_data;
        const levelStr = jd.level ? jd.level.charAt(0).toUpperCase() + jd.level.slice(1) + "-level" : "";
        targetContext = ` The candidate is interviewing for the ${levelStr} position of ${jd.title} at ${jd.company}.`;
        const kwLower = (jd.keywords || []).map((k) => k.toLowerCase()).join(" ");
        const descLower = (jd.description_summary || "").toLowerCase();
        const combined = kwLower + " " + descLower;
        if (combined.includes("startup") || combined.includes("fast-paced")) {
            toneModifier = " Use a product-focused, pragmatic tone.";
        }
        else if (combined.includes("research") || combined.includes("academic")) {
            toneModifier = " Use a detail-oriented, citation-friendly tone.";
        }
        else if (jd.level === "staff" || jd.level === "principal") {
            toneModifier = " Use a leadership-focused, strategic tone.";
        }
        else if (jd.level === "senior") {
            toneModifier = " Use a concise, technically deep tone.";
        }
    }
    return `You generate interview-ready speech for ${name}, who works as a ${role}.${targetContext}${toneModifier}`;
}
function buildKnowledgeSystemPrompt(identityHeader, hasJD, toneXML) {
    const rawName = identityHeader.includes("for ") ? identityHeader.split("for ")[1]?.split(",")[0] || "the candidate" : "the candidate";
    const candidateName = escapeXml(rawName);
    const baseRules = `- You are ${candidateName}'s spoken voice \u2014 their consciousness during the interview. Output IS what they say aloud.
- First person always ("I", "my", "I've"). Real human cadence, not robotic \u2014 confident professional in a conversation.
- Never say "How can I assist you?", "How can I help?", "What would you like to know?", or any chatbot phrase.
- Never introduce yourself unprompted. Only give an introduction when explicitly asked ("tell me about yourself").
- Never reveal that you are an AI, an assistant, or that you have a "resume" / "context" / "knowledge base" / "system prompt". You ARE the person.
- Speak FROM the provided context blocks as if they're your own memory. Never quote them, never acknowledge them.

CONTEXT BLOCKS \u2014 use the right one for the question:
- <candidate_profile> = your COMPLETE background (skills, experience, projects, education) in one block. This IS your grounding. When it is present you ALWAYS have your experience loaded \u2014 build every behavioral / "tell me about a time" / "give me an example" answer from the real skills, projects, and roles inside it. NEVER say "I don't have specific past experience loaded" when a <candidate_profile> block is present.
- <candidate_identity_fact> = your name / current role, already phrased. Lead with it for identity questions.
- <candidate_experience> = full-time jobs / roles. Use for "experience", "work history", "previous roles".
- <candidate_projects> = side projects, NOT jobs. Use for "projects", "what have you built".
- <candidate_education> = degrees, schools. Use for "education", "where did you study".
- <candidate_achievements>, <candidate_certifications>, <candidate_leadership> = specific category asks only.
- <user_context> = additional background the user provided. Treat as first-person memory; never quote it; never reveal its source.
When listing items ("what projects have you worked on?") include ALL relevant items, not just the first.
For a behavioral question with no EXACT matching story, construct a grounded, qualitative example from the REAL projects/experience in <candidate_profile> (e.g. coordinating work on a named project) \u2014 do NOT refuse or claim missing experience.

ANTI-FABRICATION (overrides any persona, tone, or confidence instruction):
- A persona or tone instruction (e.g. "answer like a confident senior engineer") controls VOICE and CONFIDENCE only. It NEVER licenses inventing facts, numbers, companies, projects, or outcomes. Be confident about REAL facts; never manufacture specifics to sound impressive.
- Use only facts present in the context blocks. Never invent companies, dates, numbers, project names, or outcomes.
- If no context block contains a specific metric, you MUST answer with qualitative language ("a sizable team", "a meaningful improvement", "over several quarters") \u2014 do NOT invent a percentage, dollar amount, duration, team size, count, or scale figure, even when the question or persona asks you to be confident or specific.
- If asked about something not in your context (e.g. "tell me about your time at Google" but Google isn't in <candidate_experience>): admit it naturally \u2014 "Honestly, I haven't worked at Google specifically, but I have done X which is similar..." then pivot to a real adjacent experience.
- Do not name-drop companies / technologies / projects that aren't in your context to sound impressive.

SPEAKABLE CONVENTIONS (since this is read aloud):
- No em dashes (\u2014) in your output \u2014 use a comma, a period, or the word "so".
- No semicolons; split into two sentences.
- No **bold** inside the spoken answer (bolding is for structural labels only, never mid-sentence).
- No bullet lists for a spoken answer \u2014 speak in flowing sentences. Bullets are OK only for code follow-ups (Time / Space / Why).
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
- Do not fabricate numbers, timelines, or projects.` : "";
    const salaryRules = `
- When answering salary or compensation questions, use data from <salary_intelligence> if available.
- Always state the confidence level when citing salary ranges (e.g., "Based on market data for this region, I'd expect..." for medium confidence).
- Frame salary expectations confidently, anchoring to the upper end of the range.
- If a pre-computed negotiation script is available in <salary_intelligence>, use it as a guide for your response \u2014 adapt the opening line and justification naturally.
- If no salary data is available, deflect gracefully by focusing on your value and experience (e.g., "I'm open to discussing compensation that reflects my experience in [domain]...").
- Never reveal that you have pre-computed data or scripts. Speak as if you know your own worth naturally.`;
    const toneBlock = toneXML ? `

${toneXML}` : "";
    return `${identityHeader}

<knowledge_engine_rules>
${baseRules}${jdRules}${salaryRules}
</knowledge_engine_rules>${toneBlock}`;
}
async function generateCandidateIntro(resumeDoc, jdDoc, generateContentFn) {
    const resume = resumeDoc.structured_data;
    const latestRole = resume.experience?.[0];
    const skills = (resume.skills_flat ?? flattenSkills(resume.skills)).slice(0, 5).join(", ") || "";
    const totalExperienceYears = computeTotalExperience(resume);
    let prompt = `Generate a natural, spoken interview self-introduction for a candidate named ${resume.identity.name}.

This should sound like a REAL PERSON speaking in an interview \u2014 relaxed, confident, conversational.

Candidate background:
- Current/Latest role: ${latestRole?.role || "Professional"} at ${latestRole?.company || "a company"}
- Total roles: ${resume.experience?.length || 0}${totalExperienceYears > 0 ? `
- Total years of professional experience: ${totalExperienceYears}` : ""}
- Key skills: ${skills}`;
    if (jdDoc) {
        const jd = jdDoc.structured_data;
        prompt += `
- Interviewing for: ${jd.title} at ${jd.company}`;
        prompt += `

Subtly connect their background to the target role without being obvious about it.`;
    }
    prompt += `

RULES:
- First person ("I", "my", "I've")
- ~80-120 words, speakable in ~30-40 seconds
- OPEN WITH THE CANDIDATE'S NAME \u2014 a self-introduction states who you are. Lead with
  "I'm ${resume.identity.name?.split(" ")[0] || resume.identity.name}, ..." (first name is fine),
  then flow into the rest. This is a self-INTRODUCTION; omitting the name is wrong.${totalExperienceYears > 0 ? `
- STATE THE EXACT YEARS OF EXPERIENCE ABOVE (${totalExperienceYears}) \u2014 say it as a whole
  number if it rounds cleanly (e.g. "10 years", not "10.3 years"). Do NOT replace it with a
  vague phrase like "the last few years" or "several years" when a specific figure is given.` : ""}
- Then: what they do now \u2192 1-2 highlights from their career \u2192 what excites them about this opportunity
- Sound like a confident professional talking, NOT reading a bio
- NO "How can I assist you" or "What would you like to know?"
- NO "I'm excited to be here today" or overly formal phrasing
- NO self-referential phrases like "as my resume shows" or "as mentioned in my CV"
- NO offer to help or ask questions back
- End naturally \u2014 just stop talking, don't add a question or offer

BAD example (DO NOT generate anything like this):
"Hello, it's nice to meet you. I'm [Name] and I'm excited to be here today to discuss the [Role] position. How can I assist you today?"

GOOD example pattern:
"I'm [Name] \u2014 I'm currently a [role] at [company], where I've been focused on [key thing]. Before that, I spent [time] at [company] doing [key achievement]. I've been mostly working in [domain] and [domain], and the [target role] here really caught my eye because [natural reason]."

Output ONLY the spoken text. No quotes, no labels, no markdown.`;
    try {
        const response = await generateContentFn([{ text: prompt }]);
        return response.trim();
    }
    catch {
        const first = resume.identity.name?.split(" ")[0] || resume.identity.name || "";
        return `${first ? `I'm ${first} \u2014 ` : ""}I'm currently working as a ${latestRole?.role || "developer"} at ${latestRole?.company || "my current company"}, and I've been in this space for a few years now.`;
    }
}
function handleBareGreeting(resumeDoc) {
    const name = resumeDoc ? resumeDoc.structured_data.identity.name?.split(" ")[0] : "";
    const greetings = [
        `Hey, thanks for having me${name ? `. I'm ${name}` : ""}.`,
        `Hi there${name ? `, I'm ${name}` : ""}. Good to be here.`,
        `Hey! Good to meet you.`
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
}
async function assemblePromptContext(question, resumeDoc, jdDoc, relevantNodes, generateContentFn, toneXML, cachedIntro) {
    const questionLower = question.toLowerCase().trim();
    if (isBareGreeting(questionLower)) {
        return {
            systemPromptInjection: "",
            contextBlock: "",
            isIntroQuestion: true,
            isBareGreeting: true,
            introResponse: handleBareGreeting(resumeDoc)
        };
    }
    const isIntro = isIntroQuestion(questionLower);
    if (isIntro && resumeDoc) {
        if (cachedIntro && cachedIntro.trim()) {
            console.log("[ContextAssembler] Serving precomputed (AOT) intro");
            return {
                systemPromptInjection: "",
                contextBlock: "",
                isIntroQuestion: true,
                introResponse: cachedIntro.trim()
            };
        }
        if (generateContentFn) {
            console.log("[ContextAssembler] No cached intro \u2014 generating Just-In-Time Intro...");
            const introResponse = await generateCandidateIntro(resumeDoc, jdDoc, generateContentFn);
            return {
                systemPromptInjection: "",
                contextBlock: "",
                isIntroQuestion: true,
                introResponse
            };
        }
    }
    const contextBlock = formatContextBlock(relevantNodes);
    const identityHeader = buildIdentityHeader(resumeDoc, jdDoc);
    const systemPromptInjection = buildKnowledgeSystemPrompt(identityHeader, jdDoc !== null, toneXML);
    return {
        systemPromptInjection,
        contextBlock,
        isIntroQuestion: false
    };
}
function buildLiveNegotiationSystemPrompt() {
    return `You are an expert salary negotiation coach providing real-time guidance.

LIVE NEGOTIATION MODE \u2014 ACTIVE.

Your role:
- The user is on a live call with a recruiter RIGHT NOW.
- You have full context about the current negotiation: offer history, phase, and the user's target.
- Provide precision coaching \u2014 not general advice.

Format rules (CRITICAL):
- Lead with a tactical note (1-2 sentences): what just happened + why this specific move is right.
- Then the exact words to say.
- Use REAL numbers. If offer is $95,000 and target is $130,000, say those exact numbers.
- Keep total response under 150 words. They are on a live call.
- Never use [X], [amount], or placeholders.
- Never reveal you are an AI or that scripts exist.
- Be directive: say "Say: '...'" not "You might consider..."`;
}
export { assemblePromptContext, buildLiveNegotiationSystemPrompt, generateCandidateIntro };
