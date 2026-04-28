import { tavily, type TavilyClient } from '@tavily/core';
import { ISearchProvider, SearchResult } from './types';

export class TavilySearchProvider implements ISearchProvider {
  public quotaExhausted = false;
  private client: TavilyClient;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error('Tavily API key is required');
    this.client = tavily({ apiKey });
  }

  async search(query: string, opts: { maxResults?: number } = {}): Promise<SearchResult[]> {
    if (this.quotaExhausted) return [];
    try {
      const resp = await this.client.search(query, {
        searchDepth: 'advanced',
        maxResults: opts.maxResults ?? 5,
        includeAnswer: false,
      });
      return (resp.results ?? []).map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.content,
        publishedDate: r.publishedDate,
      }));
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (/429|quota|rate.?limit/i.test(msg)) {
        this.quotaExhausted = true;
        console.warn('[TavilySearchProvider] Quota exhausted:', msg);
        return [];
      }
      console.warn('[TavilySearchProvider] search failed:', msg);
      return [];
    }
  }
}
