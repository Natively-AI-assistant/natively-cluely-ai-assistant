// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { coerceSkills } from "./skillsUtil";
import { EMPTY_SKILLS } from "./types";
import { flattenSkills } from "./skillsUtil";
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
// premium/electron/knowledge/StructuredResumeNormalizer.ts
var strings = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
var text = (value) => typeof value === "string" ? value : "";
var nullableText = (value) => typeof value === "string" && value ? value : null;
function normalizeStructuredResume(input) {
    const raw = input && typeof input === "object" ? input : {};
    const identity = raw.identity && typeof raw.identity === "object" ? raw.identity : {};
    const skills = coerceSkills(raw.skills ?? EMPTY_SKILLS);
    return {
        ...raw,
        identity: {
            ...identity,
            name: text(identity.name) || "Unknown Candidate",
            email: text(identity.email),
            phone: text(identity.phone),
            location: text(identity.location),
            linkedin: text(identity.linkedin),
            github: text(identity.github),
            website: text(identity.website),
            summary: text(identity.summary)
        },
        skills,
        skills_flat: flattenSkills(skills),
        experience: Array.isArray(raw.experience) ? raw.experience.filter((entry) => entry && typeof entry === "object").map((entry) => ({
            ...entry,
            company: text(entry.company),
            role: text(entry.role),
            start_date: text(entry.start_date),
            end_date: nullableText(entry.end_date),
            bullets: strings(entry.bullets)
        })) : [],
        projects: Array.isArray(raw.projects) ? raw.projects.filter((entry) => entry && typeof entry === "object").map((entry) => ({
            ...entry,
            name: text(entry.name),
            description: text(entry.description),
            technologies: strings(entry.technologies),
            highlights: strings(entry.highlights),
            url: text(entry.url)
        })) : [],
        education: Array.isArray(raw.education) ? raw.education.filter((entry) => entry && typeof entry === "object").map((entry) => ({
            ...entry,
            institution: text(entry.institution),
            degree: text(entry.degree),
            field: text(entry.field),
            start_date: text(entry.start_date),
            end_date: nullableText(entry.end_date),
            gpa: text(entry.gpa)
        })) : [],
        achievements: Array.isArray(raw.achievements) ? raw.achievements.filter((entry) => entry && typeof entry === "object").map((entry) => ({ ...entry, title: text(entry.title), description: text(entry.description), date: text(entry.date) })) : [],
        certifications: Array.isArray(raw.certifications) ? raw.certifications.filter((entry) => entry && typeof entry === "object").map((entry) => ({ ...entry, name: text(entry.name), issuer: text(entry.issuer), date: text(entry.date) })) : [],
        leadership: Array.isArray(raw.leadership) ? raw.leadership.filter((entry) => entry && typeof entry === "object").map((entry) => ({ ...entry, role: text(entry.role), organization: text(entry.organization), description: text(entry.description) })) : []
    };
}
export { normalizeStructuredResume };
