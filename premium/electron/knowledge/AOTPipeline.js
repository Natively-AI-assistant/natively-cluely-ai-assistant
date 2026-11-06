// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { jdContextFromStructured } from "./CompanyResearchEngine";
import { generateNegotiationScript } from "./NegotiationEngine";
import { generateCandidateIntro } from "./ContextAssembler";
import { processResume } from "./PostProcessor";
import { analyzeGaps } from "./GapAnalysisEngine";
import { generateMockQuestions } from "./MockInterviewGenerator";
import { resolveCompanyValues } from "./CultureValuesMapper";
import { mapStoriesToValues } from "./CultureValuesMapper";
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
// premium/electron/knowledge/AOTPipeline.ts
var AOTPipeline = class {
    db;
    companyResearch;
    generateContentFn = null;
    status = {
        companyResearch: "pending",
        negotiationScript: "pending",
        gapAnalysis: "pending",
        starMapping: "pending"
    };
    // Cached results
    cachedDossier = null;
    cachedNegotiationScript = null;
    cachedGapAnalysis = null;
    cachedCultureMapping = null;
    constructor(db, companyResearch) {
        this.db = db;
        this.companyResearch = companyResearch;
    }
    setGenerateContentFn(fn) {
        this.generateContentFn = fn;
    }
    getStatus() {
        return { ...this.status };
    }
    getCachedDossier() {
        return this.cachedDossier;
    }
    getCachedNegotiationScript() {
        return this.cachedNegotiationScript;
    }
    getCachedGapAnalysis() {
        return this.cachedGapAnalysis;
    }
    getCachedCultureMapping() {
        return this.cachedCultureMapping;
    }
    /**
     * Run the full AOT pipeline for a newly uploaded JD.
     * All tasks run concurrently. Failures in one don't block others.
     */
    async runForJD(jdDoc, resumeDoc) {
        if (!this.generateContentFn) {
            console.warn("[AOTPipeline] No generateContentFn set, skipping pipeline");
            return;
        }
        const jd = jdDoc.structured_data;
        console.log(`[AOTPipeline] \u26A1 Starting AOT pipeline for ${jd.title || jd.role || "Unknown"} at ${jd.company || "Unknown"}...`);
        this.status = {
            companyResearch: "running",
            negotiationScript: resumeDoc ? "running" : "pending",
            gapAnalysis: resumeDoc ? "running" : "pending",
            starMapping: "pending"
            // STAR mapping is handled during resume ingestion
        };
        await this.preComputeCompanyResearch(jd);
        if (resumeDoc) {
            await Promise.allSettled([
                this.preComputeNegotiationScript(jdDoc, resumeDoc),
                this.preComputeGapAnalysis(jdDoc, resumeDoc),
                this.preComputeIntro(jdDoc, resumeDoc)
            ]);
        }
        if (resumeDoc) {
            await this.preComputeMockQuestions(jdDoc, resumeDoc);
        }
        if (resumeDoc) {
            await this.preComputeCultureMapping(jdDoc, resumeDoc);
        }
        console.log("[AOTPipeline] \u2705 AOT pipeline complete. Status:", JSON.stringify(this.status));
    }
    async preComputeCompanyResearch(jd) {
        try {
            this.status.companyResearch = "running";
            const dossier = await this.companyResearch.researchCompany(jd.company, jdContextFromStructured(jd));
            this.cachedDossier = dossier;
            this.status.companyResearch = "done";
            console.log(`[AOTPipeline] Company research complete for ${jd.company}`);
        }
        catch (error) {
            this.status.companyResearch = "failed";
            console.error(`[AOTPipeline] Company research failed: ${error.message}`);
        }
    }
    async preComputeNegotiationScript(jdDoc, resumeDoc) {
        try {
            this.status.negotiationScript = "running";
            const dossier = this.cachedDossier || this.companyResearch.getCachedDossier(jdDoc.structured_data.company);
            const script = await generateNegotiationScript(resumeDoc, jdDoc, dossier, this.generateContentFn);
            if (script) {
                this.cachedNegotiationScript = script;
                this.db.saveNegotiationScript(jdDoc.id, script);
            }
            this.status.negotiationScript = "done";
            console.log("[AOTPipeline] Negotiation script pre-computed");
        }
        catch (error) {
            this.status.negotiationScript = "failed";
            console.error(`[AOTPipeline] Negotiation script failed: ${error.message}`);
        }
    }
    /**
     * Precompute the JD-tailored self-introduction and store it keyed by the JD
     * document id. Served instantly at query time for "tell me about yourself",
     * removing a live LLM round-trip from the hot path. Best-effort: a failure
     * here is non-fatal — the query path falls back to JIT generation.
     */
    async preComputeIntro(jdDoc, resumeDoc) {
        try {
            const intro = await generateCandidateIntro(resumeDoc, jdDoc, this.generateContentFn);
            if (intro && intro.trim() && jdDoc.id != null) {
                this.db.saveIntro(jdDoc.id, intro.trim());
                console.log("[AOTPipeline] Intro pre-computed (JD-tailored)");
            }
        }
        catch (error) {
            console.error(`[AOTPipeline] Intro pre-compute failed: ${error.message}`);
        }
    }
    async preComputeGapAnalysis(jdDoc, resumeDoc) {
        try {
            this.status.gapAnalysis = "running";
            const resume = resumeDoc.structured_data;
            const jd = jdDoc.structured_data;
            const { skillExperienceMap } = processResume(resume);
            const analysis = await analyzeGaps(resume, jd, skillExperienceMap, this.generateContentFn);
            this.cachedGapAnalysis = analysis;
            this.db.saveGapAnalysis(jdDoc.id, analysis);
            this.status.gapAnalysis = "done";
            console.log(`[AOTPipeline] Gap analysis complete: ${analysis.match_percentage}% match`);
        }
        catch (error) {
            this.status.gapAnalysis = "failed";
            console.error(`[AOTPipeline] Gap analysis failed: ${error.message}`);
        }
    }
    async preComputeMockQuestions(jdDoc, resumeDoc) {
        try {
            const questions = await generateMockQuestions(resumeDoc, jdDoc, this.cachedDossier, this.cachedGapAnalysis, this.generateContentFn);
            if (questions.length > 0) {
                this.db.saveMockQuestions(jdDoc.id, questions);
            }
            console.log(`[AOTPipeline] Mock questions pre-computed: ${questions.length} questions`);
        }
        catch (error) {
            console.error(`[AOTPipeline] Mock questions failed: ${error.message}`);
        }
    }
    async preComputeCultureMapping(jdDoc, resumeDoc) {
        try {
            this.status.starMapping = "running";
            const jd = jdDoc.structured_data;
            const coreValues = resolveCompanyValues(jd.company, this.cachedDossier);
            if (coreValues.length === 0) {
                console.log(`[AOTPipeline] No core values found for ${jd.company}, skipping culture mapping`);
                this.status.starMapping = "done";
                return;
            }
            const starNodes = this.db.getNodesBySourceType("resume" /* RESUME */).filter((n) => n.category === "star_story");
            if (starNodes.length === 0) {
                console.log("[AOTPipeline] No STAR stories found, skipping culture mapping");
                this.status.starMapping = "done";
                return;
            }
            const stories = starNodes.map((node) => ({
                original_bullet: node.text_content,
                situation: "",
                task: "",
                action: "",
                result: "",
                full_narrative: node.text_content,
                parent_role: node.title.replace("STAR: ", "").split(" at ")[0] || "",
                parent_company: node.organization || "",
                timeline: node.start_date ? `${node.start_date}\u2013${node.end_date || "Present"}` : ""
            }));
            const mapping = await mapStoriesToValues(stories, coreValues, jd.company, this.generateContentFn);
            this.cachedCultureMapping = mapping;
            this.db.saveCultureMappings(jdDoc.id, mapping);
            this.status.starMapping = "done";
            console.log(`[AOTPipeline] Culture mapping complete: ${mapping.mappings.length} mappings, ${mapping.unmapped_values.length} unmapped values`);
        }
        catch (error) {
            this.status.starMapping = "failed";
            console.error(`[AOTPipeline] Culture mapping failed: ${error.message}`);
        }
    }
    /**
     * Reset cached state (e.g., when a new JD is uploaded).
     */
    reset() {
        this.cachedDossier = null;
        this.cachedNegotiationScript = null;
        this.cachedGapAnalysis = null;
        this.cachedCultureMapping = null;
        this.status = {
            companyResearch: "pending",
            negotiationScript: "pending",
            gapAnalysis: "pending",
            starMapping: "pending"
        };
    }
};
export { AOTPipeline };
