/**
 * Public contracts used at the boundary between the source-available app and
 * the private premium package.
 *
 * Keep these structural and limited to fields the core app consumes. Core
 * type-checks must not require a checkout of the private repository, while the
 * premium type-check remains responsible for validating its implementation.
 */

export interface PromptAssemblyResult {
    factualRecall?: boolean;
    liveNegotiationResponse?: unknown;
    contextBlock?: string;
    isIntroQuestion?: boolean;
    introResponse?: string;
}

export interface SearchProvider {
    search(query: string): Promise<unknown>;
}
