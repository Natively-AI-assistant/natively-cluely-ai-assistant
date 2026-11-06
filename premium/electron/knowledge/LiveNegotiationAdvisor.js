// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { flattenSkills } from "./skillsUtil";
import { escapeXml } from "./NegotiationConversationTracker";
import { buildLiveNegotiationSystemPrompt } from "./ContextAssembler";
import { extractJsonObject } from "./jsonExtract";
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
// premium/electron/knowledge/LiveNegotiationAdvisor.ts
var LLM_TIMEOUT_MS = 12e3;
var PHASE_INSTRUCTIONS = {
    INACTIVE: "The negotiation has not started yet.",
    PROBE: `No numbers on table yet. Coach user to delay their ask by asking "What's the budgeted range?" OR anchor at upper market range if pressed.`,
    ANCHOR: `Recruiter dropped a number. User needs to counter. Acknowledge briefly, counter 10-15% above their target. Ground in 2-3 specific achievements + market data. Never accept first offer.`,
    COUNTER: `User countered. Hold position and reinforce justification with specific wins. Ask open-ended question to keep negotiation alive. Do NOT drop the ask unless recruiter makes a specific counter.`,
    HOLD: `Recruiter pushed back saying ask is above range. This is NOT a final no \u2014 it is a tactic. Options in order: (1) hold with silence + re-justify, (2) ask "What is the budget band for this role?", (3) ask about signing bonus or equity. Do NOT immediately drop the number.`,
    PIVOT_BENEFITS: `Salary ceiling appears fixed. Maximize total comp: (1) signing bonus first \u2014 easiest approval, different budget, (2) equity, (3) extra PTO, (4) remote flexibility. Frame as: "I understand the base is set \u2014 could we look at the signing bonus?"`,
    CLOSE: `Recruiter signaling agreement. Confirm full package, request written offer within 24-48h. Say: "That sounds great \u2014 could you send the written offer so I can review the full package?"`
};
async function generateLiveCoachingResponse(tracker, userQuestion, resumeDoc, jdDoc, dossier, negotiationScript, generateContentFn) {
    const state = tracker.getState();
    const resume = resumeDoc.structured_data;
    const jd = jdDoc?.structured_data;
    const highlights = (resume.experience || []).slice(0, 3).map((e) => `${e.role} at ${e.company}: ${(e.bullets || []).slice(0, 2).join("; ")}`).filter(Boolean).join("\n");
    const marketRange = negotiationScript?.salary_range ? `${negotiationScript.salary_range.currency} ${negotiationScript.salary_range.min.toLocaleString()} \u2013 ${negotiationScript.salary_range.max.toLocaleString()} (${negotiationScript.salary_range.confidence} confidence)` : dossier?.salary_estimates?.[0] ? `${dossier.salary_estimates[0].currency} ${dossier.salary_estimates[0].min.toLocaleString()} \u2013 ${dossier.salary_estimates[0].max.toLocaleString()}` : "No market data available";
    const userTarget = state.userTarget ?? negotiationScript?.salary_range?.max ?? null;
    const stateXML = tracker.getStateXML();
    const scriptCurrency = negotiationScript?.salary_range?.currency || dossier?.salary_estimates?.[0]?.currency || "USD";
    const prompt = `CURRENT NEGOTIATION STATE:
${stateXML}

USER'S PROFILE:
Role: ${(resume.experience || [])[0]?.role || "Unknown"}
Skills: ${(resume.skills_flat ?? flattenSkills(resume.skills)).slice(0, 8).join(", ")}
Key achievements:
${highlights || "(none available)"}

CONTEXT:
Job: ${jd?.title || "Unknown"} at ${jd?.company || "Unknown"}
Market salary range: ${marketRange}
User's target: ${userTarget ? `USD ${userTarget.toLocaleString()}` : "Not established"}

PHASE GUIDANCE:
${PHASE_INSTRUCTIONS[state.phase]}

USER'S QUESTION: ${escapeXml(userQuestion)}

Respond in exactly this JSON format (no markdown fences):
{
  "tacticalNote": "1-2 sentences: what just happened tactically and why this is the right move",
  "exactScript": "Exact words for the user to say \u2014 first person, real numbers, under 3 sentences"
}`;
    const PHASE_LABELS = {
        INACTIVE: "Getting started",
        PROBE: "Exploring the range",
        ANCHOR: "Recruiter made an offer",
        COUNTER: "You countered \u2014 holding position",
        HOLD: "Recruiter pushed back",
        PIVOT_BENEFITS: "Pivoting to total comp",
        CLOSE: "Closing the deal"
    };
    const fallback = () => ({
        tacticalNote: `${PHASE_LABELS[state.phase] ?? "Negotiating"}.${state.offers.latestRecruiterAmount ? ` Their offer: ${scriptCurrency} ${state.offers.latestRecruiterAmount.toLocaleString()}.` : ""} Hold your position and justify with market data.`,
        exactScript: negotiationScript?.opening_line || "Based on my experience and the market data for this role, I'm targeting the upper end of the range we discussed.",
        showSilenceTimer: state.silenceTimerActive,
        phase: state.phase,
        theirOffer: state.offers.latestRecruiterAmount,
        yourTarget: userTarget,
        currency: scriptCurrency,
        isNegotiationCoaching: true
    });
    try {
        const controller = new AbortController();
        let timeoutHandle;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => {
                controller.abort();
                reject(new Error("advisor_timeout"));
            }, LLM_TIMEOUT_MS);
        });
        const systemPrefix = buildLiveNegotiationSystemPrompt();
        let raw;
        try {
            raw = await Promise.race([generateContentFn([{ text: systemPrefix }, { text: prompt }]), timeoutPromise]);
        }
        finally {
            clearTimeout(timeoutHandle);
        }
        const parsed = extractJsonObject(raw);
        return {
            tacticalNote: parsed.tacticalNote || fallback().tacticalNote,
            exactScript: parsed.exactScript || fallback().exactScript,
            showSilenceTimer: state.silenceTimerActive,
            phase: state.phase,
            theirOffer: state.offers.latestRecruiterAmount,
            yourTarget: userTarget,
            currency: scriptCurrency,
            isNegotiationCoaching: true
        };
    }
    catch {
        return fallback();
    }
}
export { generateLiveCoachingResponse };
