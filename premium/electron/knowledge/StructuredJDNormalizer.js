// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { VALID_JD_LEVELS } from "./types";
import { VALID_JD_EMPLOYMENT_TYPES } from "./types";
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
// premium/electron/knowledge/StructuredJDNormalizer.ts
var strings = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
var text = (value) => typeof value === "string" ? value : "";
function normalizeStructuredJD(input) {
    const raw = input && typeof input === "object" ? input : {};
    return {
        ...raw,
        title: text(raw.title) || "Unknown Role",
        company: text(raw.company),
        location: text(raw.location) || "Unknown Location",
        description_summary: text(raw.description_summary),
        level: VALID_JD_LEVELS.includes(raw.level) ? raw.level : "mid",
        employment_type: VALID_JD_EMPLOYMENT_TYPES.includes(raw.employment_type) ? raw.employment_type : "full_time",
        min_years_experience: typeof raw.min_years_experience === "number" && Number.isFinite(raw.min_years_experience) ? raw.min_years_experience : 0,
        compensation_hint: text(raw.compensation_hint),
        requirements: strings(raw.requirements),
        nice_to_haves: strings(raw.nice_to_haves),
        responsibilities: strings(raw.responsibilities),
        technologies: strings(raw.technologies),
        keywords: strings(raw.keywords)
    };
}
export { normalizeStructuredJD };
