import { randomUUID } from 'crypto';
import { SettingsManager } from '../services/SettingsManager';
import { DatabaseManager } from '../db/DatabaseManager';
import { KnowledgeDatabaseManager, bufferToVector } from './KnowledgeDatabaseManager';
import {
  DocType,
  KnowledgeStatus,
  ProfileData,
  KnowledgeProcessResult,
  ActiveJD,
  StructuredResume,
  GenerateContentFn,
  EmbedFn,
} from './types';
import { extractText } from './documentLoader';
import { parseResume } from './ResumeParser';
import { parseJD } from './JDParser';
import { generateJSON, fillTemplate } from './llmInvoker';
import { INTRO_DETECTION_PROMPT } from './prompts';
import { CompanyResearchEngine } from './CompanyResearchEngine';
import {
  NegotiationTracker,
  classifyNegotiationIntent,
  generateScript,
  generateLiveCoaching,
} from './NegotiationCoach';

const QUICK_INTRO_REGEX = /\b(tell me about yourself|walk me through (your|the) (background|career|resume|experience)|who are you|introduce yourself)\b/i;

export class KnowledgeOrchestrator {
  private generateFn: GenerateContentFn | null = null;
  private embedFn: EmbedFn | null = null;
  private embedQueryFn: EmbedFn | null = null;

  private customNotes: string = '';
  private knowledgeMode: boolean = false;

  private negotiationTracker = new NegotiationTracker();
  private companyResearchEngine: CompanyResearchEngine;

  private depthHistory: string[] = []; // last user-typed questions

  constructor(private db: KnowledgeDatabaseManager) {
    this.companyResearchEngine = new CompanyResearchEngine({
      db,
      generateFn: () => this.generateFn,
    });
  }

  // ── Dependency injection ─────────────────────────────────────

  setGenerateContentFn(fn: GenerateContentFn): void { this.generateFn = fn; }
  setEmbedFn(fn: EmbedFn): void { this.embedFn = fn; }
  setEmbedQueryFn(fn: EmbedFn): void { this.embedQueryFn = fn; }

  // ── Mode + notes ─────────────────────────────────────────────

  isKnowledgeMode(): boolean { return this.knowledgeMode; }

  setKnowledgeMode(enabled: boolean): void {
    this.knowledgeMode = enabled;
    try { SettingsManager.getInstance().set('knowledgeMode', enabled); } catch { /* ignore */ }
  }

  setCustomNotes(notes: string): void { this.customNotes = notes ?? ''; }
  getCustomNotes(): string { return this.customNotes; }

  // ── Status & profile data ────────────────────────────────────

  getStatus(): KnowledgeStatus {
    const profile = this.db.getUserProfile();
    if (!profile) return { hasResume: false, activeMode: this.knowledgeMode };

    const s = profile.structured;
    return {
      hasResume: true,
      activeMode: this.knowledgeMode,
      resumeSummary: {
        name: s.identity?.name,
        role: s.current_role ?? s.experiences?.[0]?.title,
        totalExperienceYears: s.total_experience_years,
      },
    };
  }

  getProfileData(): ProfileData | null {
    const profile = this.db.getUserProfile();
    const activeJD = this.db.getActiveJD();
    const negotiationScript = this.db.getCurrentScript() ?? undefined;

    if (!profile && !activeJD) return null;

    const counts = this.db.countResumeNodesByCategory();
    const experienceCount = counts['experience'] ?? 0;
    const projectCount = counts['project'] ?? 0;
    const nodeCount = Object.values(counts).reduce((a, b) => a + b, 0);

    return {
      identity: profile
        ? { name: profile.structured.identity?.name ?? '', email: profile.structured.identity?.email ?? '' }
        : undefined,
      skills: profile?.structured.skills ?? [],
      experienceCount,
      projectCount,
      nodeCount,
      hasActiveJD: !!activeJD,
      activeJD: activeJD?.jd,
      negotiationScript,
    };
  }

  // ── Document ingestion ───────────────────────────────────────

  async ingestDocument(filePath: string, type: DocType): Promise<{ success: boolean; error?: string }> {
    if (!this.generateFn) return { success: false, error: 'LLM not initialized' };
    try {
      const rawText = await extractText(filePath);
      if (!rawText || rawText.length < 50) {
        return { success: false, error: 'Document is empty or too short' };
      }

      if (type === DocType.RESUME) {
        await this.ingestResume(filePath, rawText);
      } else if (type === DocType.JD) {
        await this.ingestJD(filePath, rawText);
      } else {
        return { success: false, error: `Unsupported document type: ${type}` };
      }

      return { success: true };
    } catch (e: any) {
      console.error('[KnowledgeOrchestrator] ingestDocument failed:', e);
      return { success: false, error: e?.message ?? 'Unknown error' };
    }
  }

  private async ingestResume(filePath: string, rawText: string): Promise<void> {
    const generateFn = this.generateFn!;

    // Replace any prior resume — only one resume at a time
    this.db.deleteDocumentsByType(DocType.RESUME);
    this.db.clearUserProfile();
    this.db.clearResumeNodes();
    this.db.clearCurrentScript();

    // Parse + generate intros + persona in parallel
    const activeJD = this.db.getActiveJD()?.jd ?? null;
    const artifacts = await parseResume(rawText, generateFn, activeJD);

    // Save denormalized profile (used by LLMHelper context injection)
    this.db.saveUserProfile(
      artifacts.structured,
      artifacts.compactPersona,
      artifacts.introShort,
      artifacts.introInterview
    );

    // Doc-level embedding (optional — best effort)
    let docEmbedding: number[] | null = null;
    if (this.embedFn) {
      try { docEmbedding = await this.embedFn(rawText.slice(0, 8000)); }
      catch (e: any) { console.warn('[KnowledgeOrchestrator] resume embedding failed:', e?.message); }
    }

    const docId = randomUUID();
    this.db.insertDocument({
      id: docId,
      docType: DocType.RESUME,
      fileName: filePath.split('/').pop() ?? null,
      rawText,
      structuredJson: JSON.stringify(artifacts.structured),
      embedding: docEmbedding,
    });

    // Per-node embeddings — small in number (typically 5-30 nodes)
    await this.indexResumeNodes(artifacts.structured);
  }

  private async indexResumeNodes(resume: StructuredResume): Promise<void> {
    const nodes: Array<{
      category: string; title: string; organization?: string;
      start_date?: string; end_date?: string; duration_months?: number;
      text_content: string; tags?: string[];
    }> = [];

    for (const exp of resume.experiences ?? []) {
      const text = [
        `${exp.title} at ${exp.organization}`,
        ...(exp.bullets ?? []),
        ...(exp.technologies?.length ? ['Technologies: ' + exp.technologies.join(', ')] : []),
      ].join('\n');
      nodes.push({
        category: 'experience',
        title: exp.title,
        organization: exp.organization,
        start_date: exp.start_date ?? undefined,
        end_date: exp.end_date ?? undefined,
        duration_months: exp.duration_months ?? undefined,
        text_content: text,
        tags: exp.technologies,
      });
    }

    for (const proj of resume.projects ?? []) {
      nodes.push({
        category: 'project',
        title: proj.name,
        text_content: `${proj.name}\n${proj.description}${proj.technologies?.length ? '\nTechnologies: ' + proj.technologies.join(', ') : ''}${proj.url ? '\nURL: ' + proj.url : ''}`,
        tags: proj.technologies,
      });
    }

    for (const edu of resume.education ?? []) {
      nodes.push({
        category: 'education',
        title: edu.degree,
        organization: edu.institution,
        start_date: edu.start_date ?? undefined,
        end_date: edu.end_date ?? undefined,
        text_content: `${edu.degree} at ${edu.institution}${edu.details ? '\n' + edu.details : ''}`,
      });
    }

    // Skills as a single node (so question retrieval can match the skill cloud)
    if (resume.skills?.length) {
      nodes.push({
        category: 'skills',
        title: 'Skills overview',
        text_content: 'Skills: ' + resume.skills.join(', '),
        tags: resume.skills,
      });
    }

    for (const node of nodes) {
      let embedding: number[] | undefined;
      if (this.embedFn) {
        try { embedding = await this.embedFn(node.text_content.slice(0, 4000)); }
        catch (e: any) { /* skip on error */ }
      }
      this.db.insertResumeNode({ ...node, embedding });
    }
  }

  private async ingestJD(filePath: string, rawText: string): Promise<void> {
    const generateFn = this.generateFn!;

    const jd = await parseJD(rawText, generateFn);

    let docEmbedding: number[] | null = null;
    if (this.embedFn) {
      try { docEmbedding = await this.embedFn(rawText.slice(0, 8000)); }
      catch (e: any) { console.warn('[KnowledgeOrchestrator] JD embedding failed:', e?.message); }
    }

    // Replace prior JD — only one active JD at a time
    this.db.deleteDocumentsByType(DocType.JD);

    const docId = randomUUID();
    this.db.insertDocument({
      id: docId,
      docType: DocType.JD,
      fileName: filePath.split('/').pop() ?? null,
      rawText,
      structuredJson: JSON.stringify(jd),
      embedding: docEmbedding,
    });
    this.db.setActiveJD(docId);

    // Background: regenerate cached intro_interview against the new JD if a resume is loaded.
    // Also clear any stale negotiation script — it was built for a different JD.
    this.db.clearCurrentScript();
    this.regenerateInterviewIntroIfPossible().catch(e =>
      console.warn('[KnowledgeOrchestrator] intro regen failed:', e?.message)
    );
  }

  private async regenerateInterviewIntroIfPossible(): Promise<void> {
    const profile = this.db.getUserProfile();
    const jd = this.db.getActiveJD();
    if (!profile || !jd || !this.generateFn) return;
    const fresh = await parseResume(
      // Re-running parse would be wasteful — instead just regenerate the intro from existing structured data
      this.serializeResumeForReparse(profile.structured),
      this.generateFn,
      jd.jd
    ).catch((): null => null);
    if (fresh) {
      this.db.saveUserProfile(profile.structured, fresh.compactPersona, fresh.introShort, fresh.introInterview);
    }
  }

  private serializeResumeForReparse(r: StructuredResume): string {
    // Rebuild a text representation so parseResume can regenerate intros without a fresh PDF.
    const lines: string[] = [];
    lines.push(r.identity?.name ?? '');
    lines.push(r.identity?.email ?? '');
    if (r.summary) lines.push(r.summary);
    if (r.current_role) lines.push(`Current role: ${r.current_role}`);
    lines.push('Skills: ' + (r.skills ?? []).join(', '));
    lines.push('');
    for (const e of r.experiences ?? []) {
      lines.push(`${e.title} — ${e.organization} (${e.start_date ?? ''} – ${e.end_date ?? ''})`);
      for (const b of e.bullets ?? []) lines.push(`• ${b}`);
      lines.push('');
    }
    for (const p of r.projects ?? []) {
      lines.push(`Project: ${p.name} — ${p.description}`);
    }
    for (const ed of r.education ?? []) {
      lines.push(`${ed.degree} — ${ed.institution}`);
    }
    return lines.join('\n');
  }

  deleteDocumentsByType(type: DocType): void {
    this.db.deleteDocumentsByType(type);
    if (type === DocType.RESUME) {
      this.db.clearUserProfile();
      this.db.clearResumeNodes();
    } else if (type === DocType.JD) {
      this.db.clearActiveJD();
    }
    this.db.clearCurrentScript(); // either deletion invalidates the cached script
  }

  // ── Live meeting hooks ───────────────────────────────────────

  feedForDepthScoring(question: string): void {
    const trimmed = (question ?? '').trim();
    if (!trimmed) return;
    this.depthHistory.push(trimmed);
    if (this.depthHistory.length > 12) this.depthHistory.shift();
  }

  feedInterviewerUtterance(utterance: string): void {
    const trimmed = (utterance ?? '').trim();
    if (!trimmed) return;

    this.negotiationTracker.recordUtterance(trimmed);
    const advanced = this.negotiationTracker.advancePhaseByRegex(trimmed);

    // If regex didn't advance state but content might still be negotiation-relevant,
    // run an LLM classifier in the background.
    if (!advanced && this.generateFn && this.maybeNegotiation(trimmed)) {
      void this.classifyAndApply(trimmed);
    }
  }

  private async classifyAndApply(utterance: string): Promise<void> {
    if (!this.generateFn) return;
    const intent = await classifyNegotiationIntent(this.generateFn, utterance);
    if (!intent) return;
    if (intent.intent === 'asking_expectations' && this.negotiationTracker.getState().phase === 'idle') {
      // synthetic regex update
      this.negotiationTracker.advancePhaseByRegex('what are your salary expectations');
    } else if (intent.intent === 'making_offer' && intent.amount) {
      this.negotiationTracker.advancePhaseByRegex(`prepared to offer ${intent.amount}`);
    } else if (intent.intent === 'closing') {
      this.negotiationTracker.advancePhaseByRegex('move forward');
    }
  }

  private maybeNegotiation(text: string): boolean {
    return /\b(salary|compensation|comp|offer|range|base|equity|bonus|stock|pay|negotiat)\b/i.test(text);
  }

  async processQuestion(message: string): Promise<KnowledgeProcessResult | null> {
    if (!this.knowledgeMode) return null;
    const trimmed = (message ?? '').trim();
    if (!trimmed) return null;

    const result: KnowledgeProcessResult = {};

    // Live negotiation short-circuit — if tracker is mid-negotiation, deliver coaching directly.
    if (this.negotiationTracker.isActive() && this.generateFn) {
      const script = this.db.getCurrentScript();
      const state = this.negotiationTracker.getState();
      const coaching = await generateLiveCoaching(this.generateFn, state, script);
      if (coaching) {
        result.liveNegotiationResponse = JSON.stringify(coaching);
        return result;
      }
    }

    // Intro question detection
    const introHit = await this.detectIntro(trimmed);
    if (introHit) {
      const profile = this.db.getUserProfile();
      const activeJD = this.db.getActiveJD();
      if (profile) {
        const useInterview = activeJD || introHit === 'background';
        result.isIntroQuestion = true;
        result.introResponse = useInterview ? profile.introInterview : profile.introShort;
        return result;
      }
    }

    // Build context block from notes + persona + JD + top resume nodes
    const contextBlock = await this.buildContextBlock(trimmed);
    if (contextBlock) result.contextBlock = contextBlock;

    if (contextBlock) {
      result.systemPromptInjection =
        'You have a Profile Intelligence layer with the candidate\'s resume, an optional active job description, and custom notes. ' +
        'Use them to ground your answer in the candidate\'s actual experience and the role they\'re targeting. ' +
        'When citing the candidate\'s background, be specific (companies, technologies, years) — never invent details that aren\'t in the context.';
    }

    return Object.keys(result).length > 0 ? result : null;
  }

  private async detectIntro(question: string): Promise<'background' | 'role' | 'general' | null> {
    if (QUICK_INTRO_REGEX.test(question)) return 'background';
    if (!this.generateFn) return null;
    try {
      const cls = await generateJSON<{ isIntro: boolean; type: string }>(
        this.generateFn,
        fillTemplate(INTRO_DETECTION_PROMPT, { QUESTION: question.slice(0, 500) })
      );
      if (cls.isIntro && cls.type !== 'none') {
        if (cls.type === 'background' || cls.type === 'role' || cls.type === 'general') return cls.type;
        return 'general';
      }
    } catch (e: any) {
      // fall through
    }
    return null;
  }

  private async buildContextBlock(question: string): Promise<string> {
    const parts: string[] = [];

    if (this.customNotes.trim()) {
      parts.push(`<user_context>\n${this.customNotes.trim()}\n</user_context>`);
    }

    const profile = this.db.getUserProfile();
    if (profile) {
      parts.push(`<resume_summary>\n${profile.compactPersona}\n</resume_summary>`);
    }

    const activeJD = this.db.getActiveJD();
    if (activeJD) {
      const jd = activeJD.jd;
      const jdText = [
        `Title: ${jd.title}`,
        jd.company ? `Company: ${jd.company}` : null,
        jd.level ? `Level: ${jd.level}` : null,
        jd.location ? `Location: ${jd.location}` : null,
        jd.technologies?.length ? `Technologies: ${jd.technologies.join(', ')}` : null,
        jd.requirements?.length ? `Requirements:\n- ${jd.requirements.slice(0, 8).join('\n- ')}` : null,
      ].filter(Boolean).join('\n');
      parts.push(`<active_jd>\n${jdText}\n</active_jd>`);
    }

    // Vector-retrieved resume nodes
    if (this.embedQueryFn || this.embedFn) {
      try {
        const top = await this.findTopResumeNodes(question, 3);
        if (top.length > 0) {
          const block = top.map(n => `[${n.category}] ${n.title}\n${n.text_content}`).join('\n\n');
          parts.push(`<top_resume_nodes>\n${block}\n</top_resume_nodes>`);
        }
      } catch (e: any) {
        // best effort — fall through
      }
    }

    return parts.join('\n\n');
  }

  private async findTopResumeNodes(query: string, k: number): Promise<Array<{ category: string; title: string; text_content: string; score: number }>> {
    const embedFn = this.embedQueryFn ?? this.embedFn;
    if (!embedFn) return [];
    const queryVec = await embedFn(query);
    if (!queryVec || queryVec.length === 0) return [];

    const nodes = this.db.getResumeNodes();
    const scored: Array<{ category: string; title: string; text_content: string; score: number }> = [];

    for (const node of nodes) {
      const vec = bufferToVector(node.embedding);
      if (!vec || vec.length !== queryVec.length) continue;
      const score = cosine(queryVec, vec);
      scored.push({
        category: node.category,
        title: node.title,
        text_content: node.text_content,
        score,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  // ── Negotiation ──────────────────────────────────────────────

  getNegotiationScript() {
    return this.db.getCurrentScript();
  }

  async generateNegotiationScriptOnDemand() {
    if (!this.generateFn) throw new Error('LLM not initialized');
    const profile = this.db.getUserProfile();
    const jdRow = this.db.getActiveJD();
    if (!profile || !jdRow) return null;

    let dossier = null;
    if (jdRow.jd.company) {
      const cached = this.db.getDossier(jdRow.jd.company);
      if (cached) dossier = cached.dossier;
    }

    const script = await generateScript(this.generateFn, profile.structured, jdRow.jd, dossier);
    this.db.saveCurrentScript(script, jdRow.id, null);

    if (script.salary_range?.max) {
      this.negotiationTracker.setTarget(script.salary_range.max, script.salary_range.currency || 'USD');
    }

    return script;
  }

  getNegotiationTracker(): NegotiationTracker {
    return this.negotiationTracker;
  }

  resetNegotiationSession(): void {
    this.negotiationTracker.reset();
  }

  // ── Company research ─────────────────────────────────────────

  getCompanyResearchEngine(): CompanyResearchEngine {
    return this.companyResearchEngine;
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

// Re-export DatabaseManager so callers don't need to import it (silences unused warning if it migrates)
export { DatabaseManager };
