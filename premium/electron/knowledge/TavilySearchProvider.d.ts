import type { SearchResult } from "./CompanyResearchEngine";

export declare class TavilySearchProvider {
  creditsUsed: number;
  constructor(apiKey: string);
  get sessionCreditsUsed(): number;
  search(query: string, numResults?: number): Promise<SearchResult[]>;
  extractUrl(url: string): Promise<{ title: string; content: string } | null>;
}
