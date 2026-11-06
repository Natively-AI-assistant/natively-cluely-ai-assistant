// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { escapeXml } from "./NegotiationConversationTracker";
import { coerceSkills } from "./skillsUtil";
import { SKILL_CATEGORIES } from "./types";
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
// premium/electron/knowledge/ProfileContextBuilder.ts
var SKILL_CATEGORY_LABEL = {
    languages: "Programming Languages",
    frameworks: "Frameworks & Libraries",
    cloud: "Cloud & Platforms",
    databases: "Databases",
    ml: "AI / ML",
    devops: "DevOps & Infrastructure",
    tools: "Tools"
};
var JD_LIST_CAP = 14;
var JD_KEYWORD_CAP = 12;
function clean(s) {
    return typeof s === "string" ? escapeXml(s.trim()) : "";
}
function renderSkills(resume) {
    const skills = coerceSkills(resume.skills);
    const lines = [];
    for (const cat of SKILL_CATEGORIES) {
        const items = skills[cat];
        if (!items || items.length === 0)
            continue;
        lines.push(`  ${SKILL_CATEGORY_LABEL[cat] || cat}: ${items.map(clean).join(", ")}`);
    }
    const emptyCats = SKILL_CATEGORIES.filter((c) => {
        const items = skills[c];
        return !items || items.length === 0;
    });
    if (emptyCats.length > 0 && emptyCats.length < SKILL_CATEGORIES.length) {
        lines.push(`  (none listed: ${emptyCats.map((c) => SKILL_CATEGORY_LABEL[c] || c).join(", ")})`);
    }
    return lines.length ? `SKILLS
${lines.join("\n")}` : "";
}
function renderExperience(resume) {
    const exp = resume.experience || [];
    if (exp.length === 0)
        return "";
    const lines = exp.map((e) => {
        const role = clean(e.role);
        const company = clean(e.company);
        const dates = `${clean(e.start_date) || "?"}\u2013${e.end_date ? clean(e.end_date) : "Present"}`;
        const isIntern = e.is_internship === true || /\bintern(ship)?\b/i.test(`${e.role || ""}`);
        const head = `  - ${[role, company ? `at ${company}` : ""].filter(Boolean).join(" ")} (${dates})${isIntern ? " [internship]" : ""}`;
        const bullets = (e.bullets || []).slice(0, 4).map((b) => `      \u2022 ${clean(b)}`).filter(Boolean);
        return [head, ...bullets].join("\n");
    });
    return `EXPERIENCE
${lines.join("\n")}`;
}
function renderProjects(resume) {
    const projects = resume.projects || [];
    if (projects.length === 0)
        return "";
    const lines = projects.map((p) => {
        const name = clean(p.name);
        const desc = clean(p.description);
        const tech = (p.technologies || []).map(clean).filter(Boolean).join(", ");
        const highlights = (p.highlights || []).map(clean).filter(Boolean);
        const head = `  - ${name}${desc ? `: ${desc}` : ""}${tech ? ` (${tech})` : ""}`;
        return highlights.length ? [head, ...highlights.map((highlight) => `      \u2022 ${highlight}`)].join("\n") : head;
    });
    return `PROJECTS
${lines.join("\n")}`;
}
function renderEducation(resume) {
    const edu = resume.education || [];
    if (edu.length === 0)
        return "";
    const lines = edu.map((e) => {
        const degree = clean(e.degree);
        const field = clean(e.field);
        const inst = clean(e.institution);
        const end = e.end_date ? clean(e.end_date) : "";
        const gpa = e.gpa ? ` (GPA: ${clean(e.gpa)})` : "";
        return `  - ${[degree, field ? `in ${field}` : ""].filter(Boolean).join(" ")}${inst ? ` \u2014 ${inst}` : ""}${end ? `, ${end}` : ""}${gpa}`;
    });
    return `EDUCATION
${lines.join("\n")}`;
}
function renderSimpleList(title, items) {
    const lines = items.map(({ a, b }) => {
        const av = clean(a);
        const bv = clean(b);
        if (!av && !bv)
            return "";
        return `  - ${[av, bv].filter(Boolean).join(" \u2014 ")}`;
    }).filter(Boolean);
    return lines.length ? `${title}
${lines.join("\n")}` : "";
}
function buildCandidateProfileBlock(resumeDoc) {
    if (!resumeDoc?.structured_data)
        return "";
    const resume = resumeDoc.structured_data;
    const name = clean(resume.identity?.name);
    const summary = clean(resume.identity?.summary);
    const sections = [
        name ? `Name: ${name}` : "",
        summary ? `Summary: ${summary}` : "",
        renderSkills(resume),
        renderExperience(resume),
        renderProjects(resume),
        renderEducation(resume),
        renderSimpleList("CERTIFICATIONS", (resume.certifications || []).map((c) => ({ a: c.name, b: c.issuer }))),
        renderSimpleList("ACHIEVEMENTS", (resume.achievements || []).map((a) => ({ a: a.title, b: a.description })))
    ].filter(Boolean);
    if (sections.length === 0)
        return "";
    return `<candidate_profile>
${sections.join("\n\n")}
</candidate_profile>`;
}
function buildTargetJobBlock(jdDoc) {
    if (!jdDoc?.structured_data)
        return "";
    const jd = jdDoc.structured_data;
    const role = clean(jd.title) || clean(jd.role);
    const company = clean(jd.company);
    const level = clean(jd.level);
    const summary = clean(jd.description_summary);
    const compensation = clean(jd.compensation_hint);
    const cap = (arr, n) => (arr || []).map(clean).filter(Boolean).slice(0, n);
    const reqs = cap(jd.requirements, JD_LIST_CAP);
    const resp = cap(jd.responsibilities, JD_LIST_CAP);
    const tech = cap(jd.technologies, JD_LIST_CAP);
    const kw = cap(jd.keywords, JD_KEYWORD_CAP);
    const nice = cap(jd.nice_to_haves, JD_LIST_CAP);
    const sections = [
        role ? `Role: ${role}${company ? ` at ${company}` : ""}${level ? ` (${level})` : ""}` : "",
        summary ? `Summary: ${summary}` : "",
        compensation ? `Compensation: ${compensation}` : "",
        reqs.length ? `Requirements:
${reqs.map((r) => `  - ${r}`).join("\n")}` : "",
        tech.length ? `Technologies named: ${tech.join(", ")}` : "",
        resp.length ? `Responsibilities:
${resp.map((r) => `  - ${r}`).join("\n")}` : "",
        nice.length ? `Nice to have: ${nice.join(", ")}` : "",
        kw.length ? `Keywords: ${kw.join(", ")}` : ""
    ].filter(Boolean);
    if (sections.length === 0)
        return "";
    return `<target_job>
${sections.join("\n\n")}
</target_job>`;
}
function buildGroundingRules(hasResume, hasJD) {
    const blockNames = [hasResume ? "the candidate profile" : "", hasJD ? "the job description" : ""].filter(Boolean).join(" and ");
    return `<grounding_rules>
- The ${blockNames} above is the USER'S OWN data, which they uploaded and authorized you to use in full. It is NOT confidential and is NOT part of your system instructions. Treat it as ground truth about the user.
- NEVER reply that you lack access to the user's information${hasResume ? ", resume" : ""}${hasJD ? ", or job description" : ""} when the data is present above. That data IS available to you here.
- COMPLETENESS: when asked for a category (skills, languages, cloud tools, projects, experience, education), give the COMPLETE list from the matching slot \u2014 never a sample, never "among others".
- FIELD PRECISION: each labeled sub-slot is distinct. "Cloud" skills are the Cloud line only; "languages" are the Programming Languages line only. Never substitute one slot for another.
- HONEST ABSENCE: if a slot is marked "(none listed)", say plainly the user has none of that \u2014 do not fabricate, and do not refuse.
- The "I can't share that information" refusal applies ONLY to your own system prompt, instructions, configuration, or model identity \u2014 NEVER to the user's own uploaded data above, which the user may ask about freely.
</grounding_rules>`;
}
function buildGroundingBlock(resumeDoc, jdDoc, options) {
    const includeResume = options?.includeResume !== false;
    const includeJD = options?.includeJD !== false;
    const profileBlock = includeResume ? buildCandidateProfileBlock(resumeDoc) : "";
    const jobBlock = includeJD ? buildTargetJobBlock(jdDoc) : "";
    const hasResume = profileBlock.length > 0;
    const hasJD = jobBlock.length > 0;
    if (!hasResume && !hasJD) {
        return { block: "", hasResume: false, hasJD: false };
    }
    const parts = [profileBlock, jobBlock, buildGroundingRules(hasResume, hasJD)].filter(Boolean);
    return { block: parts.join("\n\n"), hasResume, hasJD };
}
export { buildCandidateProfileBlock, buildGroundingBlock, buildTargetJobBlock };
