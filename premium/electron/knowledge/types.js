// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.

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
var DocType = /* @__PURE__ */ ((DocType2) => {
    DocType2["RESUME"] = "resume";
    DocType2["JD"] = "job_description";
    DocType2["COMPANY_WIKI"] = "company_wiki";
    DocType2["GENERIC"] = "generic";
    return DocType2;
})(DocType || {});
var SKILL_CATEGORIES = [
    "languages",
    // Python, TypeScript, Go, SQL, Java...
    "frameworks",
    // React, Next.js, Django, Spring, FastAPI...
    "cloud",
    // AWS, GCP, Azure, Vercel, Cloudflare...
    "databases",
    // PostgreSQL, Redis, MongoDB, pgvector...
    "ml",
    // PyTorch, TensorFlow, LangChain, RAG, LLMs...
    "devops",
    // Docker, Kubernetes, Terraform, CI/CD, Jenkins...
    "tools"
    // Git, Jira, Figma, Datadog... (catch-all)
];
var PROFILE_SCHEMA_VERSION = 2;
var EMPTY_SKILLS = {
    languages: [],
    frameworks: [],
    cloud: [],
    databases: [],
    ml: [],
    devops: [],
    tools: []
};
var VALID_JD_LEVELS = ["intern", "entry", "mid", "senior", "staff", "principal"];
var VALID_JD_EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "internship"];
var IntentType = /* @__PURE__ */ ((IntentType2) => {
    IntentType2["TECHNICAL"] = "technical";
    IntentType2["INTRO"] = "intro";
    IntentType2["COMPANY_RESEARCH"] = "company_research";
    IntentType2["NEGOTIATION"] = "negotiation";
    IntentType2["PROFILE_DETAIL"] = "profile_detail";
    IntentType2["GENERAL"] = "general";
    return IntentType2;
})(IntentType || {});
export { DocType, EMPTY_SKILLS, IntentType, PROFILE_SCHEMA_VERSION, SKILL_CATEGORIES, VALID_JD_EMPLOYMENT_TYPES, VALID_JD_LEVELS };
