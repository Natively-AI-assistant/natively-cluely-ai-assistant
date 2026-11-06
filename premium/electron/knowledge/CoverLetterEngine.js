// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { flattenSkills } from "./skillsUtil";
import { extractJsonObject } from "./jsonExtract";
import { humanizeSpokenAnswer } from "../../../electron/llm/humanLikeness";
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
// premium/electron/knowledge/CoverLetterEngine.ts
async function generateCoverLetter(resumeDoc, jdDoc, dossier, generateContentFn) {
    const resume = resumeDoc.structured_data;
    const rawName = (resume.identity?.name ?? "").trim();
    const name = rawName.length > 0 ? rawName : "the candidate";
    const topExperience = resume.experience?.slice(0, 3).map((e) => `${e.role} at ${e.company} (${e.bullets?.slice(0, 2).join("; ")})`).join("\n") || "No experience data";
    const topSkills = (resume.skills_flat ?? flattenSkills(resume.skills)).slice(0, 8).join(", ") || "Not specified";
    let jdContext = "";
    let jdCompany;
    if (jdDoc) {
        const jd = jdDoc.structured_data;
        jdCompany = jd.company;
        jdContext = `Target Role: ${jd.title} at ${jd.company} (${jd.level || "mid"}-level, ${jd.location || "unspecified location"})`;
        if (jd.requirements?.length) {
            jdContext += `
Key Requirements: ${jd.requirements.slice(0, 5).join("; ")}`;
        }
        if (jd.technologies?.length) {
            jdContext += `
Technologies: ${jd.technologies.slice(0, 6).join(", ")}`;
        }
    }
    let companyInsightContext = "";
    if (dossier) {
        const lines = [];
        if (dossier.hiring_strategy)
            lines.push(`Hiring Strategy: ${dossier.hiring_strategy}`);
        if (dossier.core_values && dossier.core_values.length > 0) {
            lines.push(`Company Values: ${dossier.core_values.slice(0, 5).join(", ")}`);
        }
        if (dossier.recent_news)
            lines.push(`Recent News: ${dossier.recent_news}`);
        if (lines.length > 0) {
            companyInsightContext = `
Company Signals (from prior research):
${lines.map((l) => `  - ${l}`).join("\n")}`;
        }
    }
    const prompt = `Write a formal cover letter for ${name}, in standard business-letter format. Follow the exact format specified below \u2014 every block has a role.

Resume:
${topExperience}
Top Skills: ${topSkills}

${jdContext}
${companyInsightContext ? `
${companyInsightContext}` : ""}

Return JSON only (no markdown, no fences), exactly:

{
  "sender_block": [
    "${name}",
    "${name}'s email if it appears in the resume, else omit this line",
    "${name}'s phone if it appears in the resume, else omit this line",
    "${name}'s location (city, country) if it appears in the resume, else omit this line"
  ],
  "date": "today's date in 'Month DD, YYYY' format, e.g. 'January 15, 2026'",
  "recipient_block": [
    "Recipient name if you can confidently infer it from the JD, else 'Hiring Manager'",
    "Recipient title (e.g. 'Engineering Manager') if the JD names one, else this line",
    "${jdCompany ?? "the company"}",
    "Company location if the JD gives one, else this line"
  ],
  "greeting": "1 formal salutation line, e.g. 'Dear Hiring Manager,' or 'Dear ${jdCompany ?? "Hiring"} Team,'",
  "opening_hook": "1 sentence. Name the role by title and state the one clear reason ${name} is a fit.",
  "body_paragraphs": [
    "paragraph 1: 2-4 sentences. The candidate's most relevant experience, with 2-4 real achievements. Concrete numbers when the resume has them.",
    "paragraph 2 (only if there's something left to say): 2-3 sentences on why ${name} wants to work at ${jdCompany ?? "this company"} specifically, and a clear ask for next steps."
  ],
  "closing": "1 short sentence expressing appreciation and next-step intent, e.g. 'I look forward to hearing from you.'",
  "signature": [
    "Sincerely,",
    "${name}"
  ]
}

Hard rules:
- Total letter 250 words MAX across greeting, opening_hook, body, and closing. Closer to 200 is better. The full document is longer because of the address blocks, but the prose itself stays tight.
- First person from ${name}.
- REAL achievements only. No invented metrics, scopes, or impacts.
- 1-2 body paragraphs. If one paragraph carries the letter, return body_paragraphs as a single-entry array.
- NO em-dashes (\u2014), NO en-dashes (\u2013), NO "--". Use comma, period, or colon.
- NEVER begin a sentence with "I am writing to apply", "I am excited to apply", "I would like to", "I have always been passionate". Start with the substance.
- No filler phrases: "unique blend", "drive business objectives", "competitive advantage", "data-driven mindset", "technical rigor", "actionable insights", "leverage", "synergy", "best-in-class", "results-oriented", "proven track record", "cutting-edge", "seamless", "spearheaded", "passionate about". If it sounds like a LinkedIn caption, do not write it.
- Don't reference "the resume" or "the job description" in the prose. Just make the points.
- Plain words over fancy ones.
- sender_block / recipient_block / signature arrays: omit any entry whose content you cannot fill from the inputs above. Do NOT invent an address line.
- Do NOT include any markdown formatting, bullet points, or JSON fences in the output values.
- Return JSON only.`;
    try {
        const response = await generateContentFn([{ text: prompt }]);
        const parsed = extractJsonObject(response);
        const scrubDash = (s) => s.replace(/—/g, ",").replace(/–/g, ",").replace(/--/g, ",").replace(/ ,/g, ",");
        const arrayOrEmpty = (v) => Array.isArray(v) ? v : [];
        const sender_block = arrayOrEmpty(parsed.sender_block).map((s) => scrubDash(String(s ?? "").trim())).filter((s) => s.length > 0);
        const recipient_block = arrayOrEmpty(parsed.recipient_block).map((s) => scrubDash(String(s ?? "").trim())).filter((s) => s.length > 0);
        const signature = arrayOrEmpty(parsed.signature).map((s) => scrubDash(String(s ?? "").trim())).filter((s) => s.length > 0);
        const date = scrubDash(String(parsed.date ?? "").trim());
        const rawParas = arrayOrEmpty(parsed.body_paragraphs);
        const body_paragraphs = rawParas.map((p) => scrubDash(humanizeSpokenAnswer(String(p ?? "").trim()))).filter((s) => s.length > 0);
        const greeting = scrubDash(humanizeSpokenAnswer(String(parsed.greeting ?? "").trim())) || "Dear Hiring Manager,";
        const opening_hook = scrubDash(humanizeSpokenAnswer(String(parsed.opening_hook ?? "").trim()));
        const rawClosing = scrubDash(humanizeSpokenAnswer(String(parsed.closing ?? "").trim()));
        const closing = rawClosing ? rawClosing.includes(name) ? rawClosing : `${rawClosing}

${name}` : `Thank you for your time and consideration.

${name}`;
        const full_text = [
            greeting,
            opening_hook,
            ...body_paragraphs,
            closing
        ].filter((s) => s.length > 0).join("\n\n");
        return {
            sender_block,
            date,
            recipient_block,
            greeting,
            opening_hook,
            body_paragraphs,
            closing,
            signature,
            full_text
        };
    }
    catch (error) {
        console.error("[CoverLetterEngine] Failed to generate cover letter:", error.message);
        return null;
    }
}
export { generateCoverLetter };
