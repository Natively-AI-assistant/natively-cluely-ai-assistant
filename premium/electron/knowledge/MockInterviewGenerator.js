// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { flattenSkills } from "./skillsUtil";
import { callWithTimeout } from "./llmUtils";
import { extractJSONArray } from "./llmUtils";
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
// premium/electron/knowledge/MockInterviewGenerator.ts
async function generateMockQuestions(resumeDoc, jdDoc, dossier, gapAnalysis, generateContentFn) {
    const resume = resumeDoc.structured_data;
    const jd = jdDoc.structured_data;
    console.log("[MockInterviewGenerator] Generating mock interview questions...");
    const candidateProfile = `
Name: ${resume.identity.name}
Current/Last Role: ${resume.experience?.[0]?.role || "N/A"} at ${resume.experience?.[0]?.company || "N/A"}
Skills: ${(resume.skills_flat ?? flattenSkills(resume.skills)).slice(0, 15).join(", ")}
Experience Count: ${resume.experience?.length || 0} roles
Projects: ${resume.projects?.map((p) => p.name).join(", ") || "None listed"}`;
    const jobContext = `
Title: ${jd.title}
Company: ${jd.company}
Level: ${jd.level || "mid"}
Requirements: ${jd.requirements?.join(", ")}
Technologies: ${jd.technologies?.join(", ")}
Responsibilities: ${jd.responsibilities?.slice(0, 5).join(", ")}`;
    let gapContext = "";
    if (gapAnalysis && gapAnalysis.gaps.length > 0) {
        const gapSkills = gapAnalysis.gaps.slice(0, 5).map((g) => `${g.skill} (${g.gap_type})`).join(", ");
        gapContext = `
Skill Gaps: ${gapSkills}`;
    }
    let companyContext = "";
    if (dossier) {
        companyContext = `
Company Focus: ${dossier.interview_focus || "General"}`;
        if (dossier.core_values && dossier.core_values.length > 0) {
            companyContext += `
Core Values: ${dossier.core_values.join(", ")}`;
        }
    }
    const prompt = `You are an experienced hiring manager for ${jd.company}. Generate the 10 most likely interview questions this candidate will face.

Candidate:
${candidateProfile}

Job:
${jobContext}
${gapContext}
${companyContext}

Generate a MIX of question types:
- 3-4 technical questions (aligned with required technologies/skills)
- 2-3 behavioral questions (STAR format triggers like "Tell me about a time...")
- 1-2 system design questions (if senior/staff level)
- 1-2 culture fit questions (aligned with company values if known)

Focus on GAPS between the resume and JD \u2014 interviewers probe weaknesses.

Return a JSON array (no markdown fences, no explanation):
[
  {
    "question": "...",
    "category": "technical|behavioral|system_design|culture_fit",
    "difficulty": "easy|medium|hard",
    "rationale": "Why this question is likely (1 sentence)",
    "suggested_answer_key": "Key points to hit from the resume (1-2 sentences)"
  }
]

Return EXACTLY 10 questions. Return ONLY the JSON array.`;
    try {
        const response = await callWithTimeout(() => generateContentFn([{ text: prompt }]), 3e4);
        const parsed = extractJSONArray(response);
        const validated = parsed.slice(0, 10).map((q) => ({
            question: q.question || "",
            category: ["technical", "behavioral", "system_design", "culture_fit"].includes(q.category) ? q.category : "technical",
            difficulty: ["easy", "medium", "hard"].includes(q.difficulty) ? q.difficulty : "medium",
            rationale: q.rationale || "",
            suggested_answer_key: q.suggested_answer_key || ""
        }));
        console.log(`[MockInterviewGenerator] \u2705 Generated ${validated.length} mock questions`);
        return validated;
    }
    catch (error) {
        console.error("[MockInterviewGenerator] Failed to generate questions:", error.message);
        return [];
    }
}
export { generateMockQuestions };
