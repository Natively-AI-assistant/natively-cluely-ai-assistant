// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { calculateDurationMonths } from "./DocumentChunker";
import { flattenSkills } from "./skillsUtil";
import { coerceSkills } from "./skillsUtil";
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
// premium/electron/knowledge/PostProcessor.ts
function computeTotalExperience(resume) {
    if (!resume.experience || resume.experience.length === 0)
        return 0;
    let totalMonths = 0;
    for (const exp of resume.experience) {
        totalMonths += calculateDurationMonths(exp.start_date, exp.end_date);
    }
    return Math.round(totalMonths / 12 * 10) / 10;
}
function buildSkillExperienceMap(resume) {
    const map = {};
    const flatSkills = resume.skills_flat ?? flattenSkills(resume.skills);
    for (const exp of resume.experience) {
        const duration = calculateDurationMonths(exp.start_date, exp.end_date);
        const allText = (exp.bullets || []).join(" ").toLowerCase();
        for (const skill of flatSkills) {
            const skillLower = skill.toLowerCase();
            if (allText.includes(skillLower)) {
                map[skill] = (map[skill] || 0) + duration;
            }
        }
    }
    if (resume.projects) {
        for (const project of resume.projects) {
            for (const tech of project.technologies || []) {
                const existing = map[tech] || 0;
                if (existing === 0) {
                    map[tech] = 6;
                }
            }
        }
    }
    return map;
}
function normalizeTimeline(resume) {
    if (resume.experience) {
        resume.experience.sort((a, b) => {
            const aDate = a.start_date || "0000-00";
            const bDate = b.start_date || "0000-00";
            return bDate.localeCompare(aDate);
        });
    }
    if (resume.education) {
        resume.education.sort((a, b) => {
            const aDate = a.start_date || "0000-00";
            const bDate = b.start_date || "0000-00";
            return bDate.localeCompare(aDate);
        });
    }
    resume.skills = coerceSkills(resume.skills);
    resume.skills_flat = flattenSkills(resume.skills);
    return resume;
}
function deduplicateSkills(skills) {
    const seen = /* @__PURE__ */ new Set();
    const result = [];
    for (const skill of skills) {
        const key = skill.toLowerCase().trim();
        if (!seen.has(key) && key.length > 0) {
            seen.add(key);
            result.push(skill.trim());
        }
    }
    return result;
}
function processResume(resume) {
    console.log("[PostProcessor] Running deterministic post-processing...");
    const cloned = JSON.parse(JSON.stringify(resume));
    const normalized = normalizeTimeline(cloned);
    const totalExperienceYears = computeTotalExperience(normalized);
    const skillExperienceMap = buildSkillExperienceMap(normalized);
    console.log(`[PostProcessor] Total experience: ${totalExperienceYears} years`);
    console.log(`[PostProcessor] Skills mapped: ${Object.keys(skillExperienceMap).length}`);
    return {
        structured: normalized,
        totalExperienceYears,
        skillExperienceMap
    };
}
export { buildSkillExperienceMap, computeTotalExperience, deduplicateSkills, normalizeTimeline, processResume };
