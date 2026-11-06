import type { SearchResult } from "./CompanyResearchEngine";

export declare class NativelySearchProvider {
  apiKey: string;
  trialToken: string | undefined;
  endpoint: string;
  sessionId: string;
  quotaExhausted: boolean;
  constructor(apiKey: string, trialToken?: string);
  search(query: string, numResults?: number): Promise<SearchResult[]>;
}
