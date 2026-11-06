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
// premium/electron/knowledge/GapAnalysisEngine.ts
async function analyzeGaps(resume, jd, skillExperienceMap, generateContentFn) {
    console.log("[GapAnalysisEngine] Starting gap analysis...");
    const candidateSkillsLower = new Set((resume.skills_flat ?? flattenSkills(resume.skills)).map((s) => s.toLowerCase().trim()));
    const bulletText = (resume.experience || []).flatMap((e) => e.bullets).join(" ").toLowerCase();
    const { jdSkills, nonSkillRequirements } = buildJdSkillUniverse(jd, resume.skills_flat ?? flattenSkills(resume.skills));
    const matched = [];
    const rawGaps = [];
    for (const skill of jdSkills) {
        const skillLower = skill.toLowerCase().trim();
        const experienceMonths = findSkillExperience(skillLower, skillExperienceMap);
        if (candidateSkillsLower.has(skillLower) || experienceMonths > 6) {
            matched.push(skill);
        }
        else if (bulletText.includes(skillLower) || experienceMonths > 0) {
            rawGaps.push({ skill, gap_type: "weak" });
        }
        else {
            rawGaps.push({ skill, gap_type: "missing" });
        }
    }
    const totalSkills = matched.length + rawGaps.length;
    const matchPercentage = totalSkills > 0 ? Math.round(matched.length / totalSkills * 100) : 100;
    console.log(`[GapAnalysisEngine] Match: ${matched.length}/${totalSkills} (${matchPercentage}%), Gaps: ${rawGaps.length}`);
    if (nonSkillRequirements.length > 0) {
        console.log(`[GapAnalysisEngine] ${nonSkillRequirements.length} non-skill requirement(s) excluded from the skill match: ` + nonSkillRequirements.map((r) => JSON.stringify(r)).join(", "));
    }
    let gaps = [];
    if (rawGaps.length > 0) {
        gaps = await generatePivotScripts(rawGaps, resume, generateContentFn);
    }
    console.log(`[GapAnalysisEngine] \u2705 Gap analysis complete`);
    return {
        matched_skills: matched,
        gaps,
        match_percentage: matchPercentage
    };
}
var MAX_SKILL_TOKEN_WORDS = 4;
function isSkillToken(entry) {
    const trimmed = entry.trim();
    if (!trimmed)
        return false;
    if (trimmed.split(/\s+/).length > MAX_SKILL_TOKEN_WORDS)
        return false;
    if (/[;:]/.test(trimmed))
        return false;
    if (/\.(\s|$)/.test(trimmed))
        return false;
    return true;
}
var escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function mentionsToken(haystack, token) {
    const needle = token.trim();
    if (!needle)
        return false;
    try {
        return new RegExp(`(?<![a-z0-9+#.])${escapeRegExp(needle)}(?![a-z0-9+#])`, "i").test(haystack);
    }
    catch {
        return haystack.toLowerCase().includes(needle.toLowerCase());
    }
}
function dedupeByLower(values) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const value of values) {
        const key = value.toLowerCase().trim();
        if (!key || seen.has(key))
            continue;
        seen.add(key);
        out.push(value.trim());
    }
    return out;
}
function buildJdSkillUniverse(jd, candidateSkills) {
    const technologies = (jd.technologies || []).filter((t) => typeof t === "string").map((t) => t.trim()).filter(Boolean);
    const vocabulary = dedupeByLower([...technologies, ...candidateSkills]);
    const jdSkills = [...technologies];
    const nonSkillRequirements = [];
    for (const requirement of jd.requirements || []) {
        if (typeof requirement !== "string")
            continue;
        const entry = requirement.trim();
        if (!entry)
            continue;
        if (isSkillToken(entry)) {
            jdSkills.push(entry);
            continue;
        }
        const mined = vocabulary.filter((term) => mentionsToken(entry, term));
        if (mined.length === 0) {
            nonSkillRequirements.push(entry);
            continue;
        }
        jdSkills.push(...mined);
    }
    return { jdSkills: dedupeByLower(jdSkills), nonSkillRequirements };
}
function findSkillExperience(skillLower, map) {
    for (const [key, months] of Object.entries(map)) {
        if (key.toLowerCase() === skillLower)
            return months;
    }
    for (const [key, months] of Object.entries(map)) {
        if (key.toLowerCase().includes(skillLower) || skillLower.includes(key.toLowerCase())) {
            return months;
        }
    }
    return 0;
}
async function generatePivotScripts(rawGaps, resume, generateContentFn) {
    const candidateSkills = (resume.skills_flat ?? flattenSkills(resume.skills)).join(", ");
    const topExperience = (resume.experience || []).slice(0, 3).map((e) => `${e.role} at ${e.company}: ${e.bullets.slice(0, 2).join("; ")}`).join("\n");
    const gapList = rawGaps.map((g, i) => `${i + 1}. "${g.skill}" (${g.gap_type})`).join("\n");
    const prompt = `You are a career coach helping a candidate handle skill gap questions in interviews.

Candidate's Skills: ${candidateSkills}
Top Experience:
${topExperience}

For each missing/weak skill below, generate a realistic "pivot script" \u2014 a confident 2-3 sentence response that:
- Acknowledges the gap honestly (if missing) or positions limited experience positively (if weak)
- Pivots to specific transferable skills from the candidate's actual background
- Shows willingness and ability to learn quickly

Gaps:
${gapList}

Return a JSON array (no markdown fences):
[
  {
    "index": 1,
    "pivot_script": "...",
    "transferable_skills": ["skill1", "skill2"]
  }
]

Return ONLY the JSON array.`;
    try {
        const response = await callWithTimeout(() => generateContentFn([{ text: prompt }]), 3e4);
        const parsed = extractJSONArray(response);
        return parsed.map((item, idx) => {
            const gap = rawGaps[idx];
            return {
                skill: gap.skill,
                gap_type: gap.gap_type,
                pivot_script: item.pivot_script || "",
                transferable_skills: item.transferable_skills || []
            };
        });
    }
    catch (error) {
        console.error("[GapAnalysisEngine] Failed to generate pivot scripts:", error.message);
        return rawGaps.map((g) => ({
            skill: g.skill,
            gap_type: g.gap_type,
            pivot_script: `While I haven't worked extensively with ${g.skill}, I have strong experience with related technologies and can ramp up quickly.`,
            transferable_skills: []
        }));
    }
}
export { analyzeGaps, buildJdSkillUniverse };
