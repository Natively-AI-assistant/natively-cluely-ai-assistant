// electron/knowledge/AOTPipeline.ts
// Ahead-of-Time background pipeline triggered at JD upload
// Runs company research, negotiation script, and gap analysis concurrently

import { KnowledgeDocument, StructuredResume, StructuredJD, CompanyDossier, AOTStatus, GapAnalysisResult, StarStory, DocType } from './types';
import { KnowledgeDatabaseManager } from './KnowledgeDatabaseManager';
import { CompanyResearchEngine, jdContextFromStructured } from './CompanyResearchEngine';
import { generateNegotiationScript, NegotiationScript } from './NegotiationEngine';
import { analyzeGaps } from './GapAnalysisEngine';
import { processResume } from './PostProcessor';
import { generateMockQuestions } from './MockInterviewGenerator';
import { resolveCompanyValues, mapStoriesToValues, CultureMappingResult } from './CultureValuesMapper';
import { generateCandidateIntro } from './ContextAssembler';

export class AOTPipeline {
    private db: KnowledgeDatabaseManager;
    private companyResearch: CompanyResearchEngine;
    private generateContentFn: ((contents: any[]) => Promise<string>) | null = null;
    private status: AOTStatus = {
        companyResearch: 'pending',
        negotiationScript: 'pending',
        gapAnalysis: 'pending',
        starMapping: 'pending'
    };

    // Cached results
    private cachedDossier: CompanyDossier | null = null;
    private cachedNegotiationScript: NegotiationScript | null = null;
    private cachedGapAnalysis: GapAnalysisResult | null = null;
    private cachedCultureMapping: CultureMappingResult | null = null;

    constructor(db: KnowledgeDatabaseManager, companyResearch: CompanyResearchEngine) {
        this.db = db;
        this.companyResearch = companyResearch;
    }

    setGenerateContentFn(fn: (contents: any[]) => Promise<string>): void {
        this.generateContentFn = fn;
    }

    getStatus(): AOTStatus {
        return { ...this.status };
    }

    getCachedDossier(): CompanyDossier | null {
        return this.cachedDossier;
    }

    getCachedNegotiationScript(): NegotiationScript | null {
        return this.cachedNegotiationScript;
    }

    getCachedGapAnalysis(): GapAnalysisResult | null {
        return this.cachedGapAnalysis;
    }

    getCachedCultureMapping(): CultureMappingResult | null {
        return this.cachedCultureMapping;
    }

    /**
     * Run the full AOT pipeline for a newly uploaded JD.
     * All tasks run concurrently. Failures in one don't block others.
     */
    async runForJD(jdDoc: KnowledgeDocument, resumeDoc: KnowledgeDocument | null): Promise<void> {
        if (!this.generateContentFn) {
            console.warn('[AOTPipeline] No generateContentFn set, skipping pipeline');
            return;
        }

        const jd = jdDoc.structured_data as StructuredJD;
        console.log(`[AOTPipeline] ⚡ Starting AOT pipeline for ${jd.title || (jd as any).role || 'Unknown'} at ${jd.company || 'Unknown'}...`);

        // Reset status
        this.status = {
            companyResearch: 'running',
            negotiationScript: resumeDoc ? 'running' : 'pending',
            gapAnalysis: resumeDoc ? 'running' : 'pending',
            starMapping: 'pending' // STAR mapping is handled during resume ingestion
        };

        // Phase 1: Company research must complete first — negotiation + gap analysis depend on the dossier
        await this.preComputeCompanyResearch(jd);

        // Phase 2: Negotiation + Gap Analysis + Intro run in parallel.
        // The JD-tailored intro is precomputed here so "tell me about yourself"
        // serves instantly at query time instead of making a live LLM call.
        if (resumeDoc) {
            await Promise.allSettled([
                this.preComputeNegotiationScript(jdDoc, resumeDoc),
                this.preComputeGapAnalysis(jdDoc, resumeDoc),
                this.preComputeIntro(jdDoc, resumeDoc)
            ]);
        }

        // Phase 3: Mock interview questions (uses dossier + gap analysis)
        if (resumeDoc) {
            await this.preComputeMockQuestions(jdDoc, resumeDoc);
        }

        // Phase 4: Culture values mapping (maps STAR stories to company core values)
        if (resumeDoc) {
            await this.preComputeCultureMapping(jdDoc, resumeDoc);
        }

        console.log('[AOTPipeline] ✅ AOT pipeline complete. Status:', JSON.stringify(this.status));
    }

    private async preComputeCompanyResearch(jd: StructuredJD): Promise<void> {
        try {
            this.status.companyResearch = 'running';
            const dossier = await this.companyResearch.researchCompany(
                jd.company, jdContextFromStructured(jd)
            );
            this.cachedDossier = dossier;
            this.status.companyResearch = 'done';
            console.log(`[AOTPipeline] Company research complete for ${jd.company}`);
        } catch (error: any) {
            this.status.companyResearch = 'failed';
            console.error(`[AOTPipeline] Company research failed: ${error.message}`);
        }
    }

    private async preComputeNegotiationScript(jdDoc: KnowledgeDocument, resumeDoc: KnowledgeDocument): Promise<void> {
        try {
            this.status.negotiationScript = 'running';
            const dossier = this.cachedDossier || this.companyResearch.getCachedDossier(
                (jdDoc.structured_data as StructuredJD).company
            );
            const script = await generateNegotiationScript(
                resumeDoc, jdDoc, dossier, this.generateContentFn!
            );
            if (script) {
                this.cachedNegotiationScript = script;
                // Store in DB for persistence
                this.db.saveNegotiationScript(jdDoc.id!, script);
            }
            this.status.negotiationScript = 'done';
            console.log('[AOTPipeline] Negotiation script pre-computed');
        } catch (error: any) {
            this.status.negotiationScript = 'failed';
            console.error(`[AOTPipeline] Negotiation script failed: ${error.message}`);
        }
    }

    /**
     * Precompute the JD-tailored self-introduction and store it keyed by the JD
     * document id. Served instantly at query time for "tell me about yourself",
     * removing a live LLM round-trip from the hot path. Best-effort: a failure
     * here is non-fatal — the query path falls back to JIT generation.
     */
    private async preComputeIntro(jdDoc: KnowledgeDocument, resumeDoc: KnowledgeDocument): Promise<void> {
        try {
            const intro = await generateCandidateIntro(resumeDoc, jdDoc, this.generateContentFn!);
            if (intro && intro.trim() && jdDoc.id != null) {
                this.db.saveIntro(jdDoc.id, intro.trim());
                console.log('[AOTPipeline] Intro pre-computed (JD-tailored)');
            }
        } catch (error: any) {
            console.error(`[AOTPipeline] Intro pre-compute failed: ${error.message}`);
        }
    }

    private async preComputeGapAnalysis(jdDoc: KnowledgeDocument, resumeDoc: KnowledgeDocument): Promise<void> {
        try {
            this.status.gapAnalysis = 'running';
            const resume = resumeDoc.structured_data as StructuredResume;
            const jd = jdDoc.structured_data as StructuredJD;
            const { skillExperienceMap } = processResume(resume);

            const analysis = await analyzeGaps(resume, jd, skillExperienceMap, this.generateContentFn!);
            this.cachedGapAnalysis = analysis;
            // Store in DB
            this.db.saveGapAnalysis(jdDoc.id!, analysis);
            this.status.gapAnalysis = 'done';
            console.log(`[AOTPipeline] Gap analysis complete: ${analysis.match_percentage}% match`);
        } catch (error: any) {
            this.status.gapAnalysis = 'failed';
            console.error(`[AOTPipeline] Gap analysis failed: ${error.message}`);
        }
    }

    private async preComputeMockQuestions(jdDoc: KnowledgeDocument, resumeDoc: KnowledgeDocument): Promise<void> {
        try {
            const questions = await generateMockQuestions(
                resumeDoc, jdDoc, this.cachedDossier, this.cachedGapAnalysis, this.generateContentFn!
            );
            if (questions.length > 0) {
                this.db.saveMockQuestions(jdDoc.id!, questions);
            }
            console.log(`[AOTPipeline] Mock questions pre-computed: ${questions.length} questions`);
        } catch (error: any) {
            console.error(`[AOTPipeline] Mock questions failed: ${error.message}`);
        }
    }

    private async preComputeCultureMapping(jdDoc: KnowledgeDocument, resumeDoc: KnowledgeDocument): Promise<void> {
        try {
            this.status.starMapping = 'running';
            const jd = jdDoc.structured_data as StructuredJD;

            // 1. Resolve core values for this company
            const coreValues = resolveCompanyValues(jd.company, this.cachedDossier);
            if (coreValues.length === 0) {
                console.log(`[AOTPipeline] No core values found for ${jd.company}, skipping culture mapping`);
                this.status.starMapping = 'done';
                return;
            }

            // 2. Retrieve STAR stories from DB
            const starNodes = this.db.getNodesBySourceType(DocType.RESUME)
                .filter(n => n.category === 'star_story');

            if (starNodes.length === 0) {
                console.log('[AOTPipeline] No STAR stories found, skipping culture mapping');
                this.status.starMapping = 'done';
                return;
            }

            // 3. Convert context nodes back to StarStory-like objects
            const stories: StarStory[] = starNodes.map(node => ({
                original_bullet: node.text_content,
                situation: '',
                task: '',
                action: '',
                result: '',
                full_narrative: node.text_content,
                parent_role: node.title.replace('STAR: ', '').split(' at ')[0] || '',
                parent_company: node.organization || '',
                timeline: node.start_date ? `${node.start_date}–${node.end_date || 'Present'}` : ''
            }));

            // 4. Map stories to values
            const mapping = await mapStoriesToValues(
                stories, coreValues, jd.company, this.generateContentFn!
            );

            // 5. Cache and persist
            this.cachedCultureMapping = mapping;
            this.db.saveCultureMappings(jdDoc.id!, mapping);
            this.status.starMapping = 'done';
            console.log(`[AOTPipeline] Culture mapping complete: ${mapping.mappings.length} mappings, ${mapping.unmapped_values.length} unmapped values`);
        } catch (error: any) {
            this.status.starMapping = 'failed';
            console.error(`[AOTPipeline] Culture mapping failed: ${error.message}`);
        }
    }

    /**
     * Reset cached state (e.g., when a new JD is uploaded).
     */
    reset(): void {
        this.cachedDossier = null;
        this.cachedNegotiationScript = null;
        this.cachedGapAnalysis = null;
        this.cachedCultureMapping = null;
        this.status = {
            companyResearch: 'pending',
            negotiationScript: 'pending',
            gapAnalysis: 'pending',
            starMapping: 'pending'
        };
    }
}
