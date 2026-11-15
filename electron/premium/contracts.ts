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
    /** Persona system-prompt text (LLMHelper chat paths). F-BND-03, 2026-11-13. */
    systemPromptInjection?: string;
    /** introResponse is a bare greeting reply, not a factual intro. F-BND-03. */
    isBareGreeting?: boolean;
}

/**
 * The KnowledgeOrchestrator surface core calls (F-BND-03, 2026-11-13). Before
 * this the orchestrator crossed the boundary as `any`, so a premium rename
 * reached core as `undefined` at runtime with no compile error. Methods core
 * merely feature-detects stay optional. The drift test
 * (PremiumContractDrift2026_11_13) checks premium against these names.
 */
export interface KnowledgeOrchestratorBoundary {
    processQuestion(question: string): Promise<PromptAssemblyResult | null>;
    /** Pro or trial AND the switch on AND a résumé or JD loaded. */
    isKnowledgeMode(): boolean;
    /** The raw Profile Intelligence switch. */
    isKnowledgeModeSwitchedOn?(): boolean;
}

export interface SearchProvider {
    search(query: string): Promise<unknown>;
}
