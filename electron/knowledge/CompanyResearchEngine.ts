import { CompanyDossier, ISearchProvider, GenerateContentFn, ActiveJD, SearchResult } from './types';
import { COMPANY_RESEARCH_SYNTHESIS_PROMPT } from './prompts';
import { generateJSON, fillTemplate } from './llmInvoker';
import { KnowledgeDatabaseManager } from './KnowledgeDatabaseManager';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface CompanyResearchEngineDeps {
  db: KnowledgeDatabaseManager;
  generateFn: () => GenerateContentFn | null;
}

export class CompanyResearchEngine {
  private provider: ISearchProvider | null = null;

  constructor(private deps: CompanyResearchEngineDeps) {}

  setSearchProvider(provider: ISearchProvider | null): void {
    this.provider = provider;
  }

  get searchProvider(): ISearchProvider | null {
    return this.provider;
  }

  async researchCompany(
    companyName: string,
    jdCtx: Partial<ActiveJD> & Record<string, any>,
    bypassCache: boolean = false
  ): Promise<CompanyDossier | null> {
    const name = (companyName ?? '').trim();
    if (!name) throw new Error('companyName is required');

    if (!bypassCache) {
      const cached = this.deps.db.getDossier(name);
      if (cached && Date.now() - new Date(cached.createdAt).getTime() < CACHE_TTL_MS) {
        return cached.dossier;
      }
    }

    const generateFn = this.deps.generateFn();
    if (!generateFn) throw new Error('LLM not initialized');

    const snippets = await this.gatherSnippets(name, jdCtx);

    const jdContextSnippet = JSON.stringify({
      title: jdCtx.title ?? null,
      level: jdCtx.level ?? null,
      location: jdCtx.location ?? null,
      technologies: jdCtx.technologies ?? [],
      requirements: (jdCtx.requirements ?? []).slice(0, 8),
      compensation_hint: jdCtx.compensation_hint ?? null,
    }, null, 2);

    const prompt = fillTemplate(COMPANY_RESEARCH_SYNTHESIS_PROMPT, {
      COMPANY: name,
      JD_CONTEXT: jdContextSnippet,
      SEARCH_SNIPPETS: snippets.length > 0
        ? snippets.map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.snippet}`).join('\n\n').slice(0, 14000)
        : '(no web search results — synthesize from training data)',
    });

    let dossier: CompanyDossier;
    try {
      dossier = await generateJSON<CompanyDossier>(generateFn, prompt);
    } catch (e: any) {
      console.warn('[CompanyResearchEngine] synthesis failed:', e?.message);
      throw e;
    }

    if (!dossier.sources || dossier.sources.length === 0) {
      dossier.sources = snippets.length > 0
        ? snippets.map(s => s.url).slice(0, 6)
        : ['model knowledge — verify before interview'];
    }

    this.deps.db.upsertDossier(name, null, dossier);
    return dossier;
  }

  private async gatherSnippets(
    company: string,
    jdCtx: Partial<ActiveJD>
  ): Promise<SearchResult[]> {
    if (!this.provider || this.provider.quotaExhausted) return [];

    const queries = [
      `${company} engineering culture interview process`,
      `${company} ${jdCtx.title ?? 'engineer'} salary glassdoor`,
      `${company} employee reviews pros cons`,
      `${company} recent news 2025`,
      `${company} competitors`,
    ];

    const results: SearchResult[] = [];
    for (const q of queries) {
      if (this.provider.quotaExhausted) break;
      try {
        const r = await this.provider.search(q, { maxResults: 4 });
        results.push(...r);
      } catch (e: any) {
        console.warn(`[CompanyResearchEngine] query "${q}" failed:`, e?.message);
      }
    }

    const seen = new Set<string>();
    return results.filter(r => {
      if (!r.url || seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    }).slice(0, 12);
  }
}
