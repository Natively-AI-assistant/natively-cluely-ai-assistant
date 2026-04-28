import { ISearchProvider, SearchResult } from './types';

/**
 * Open-source build stub. The real Natively backend search lives in the
 * proprietary premium module; without it, this provider always reports
 * exhausted quota so CompanyResearchEngine falls back to LLM-only synthesis.
 */
export class NativelySearchProvider implements ISearchProvider {
  public quotaExhausted = true;

  constructor(_apiKey: string, _trialToken?: string) {
    // No-op
  }

  async search(_query: string): Promise<SearchResult[]> {
    return [];
  }
}
