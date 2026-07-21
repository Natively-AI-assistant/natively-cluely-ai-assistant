export type LLMProviderId = 'natively' | 'groq' | 'codex' | 'gemini_flash' | 'gemini_pro' | 'openai' | 'claude' | 'deepseek' | 'ollama';
export type ProviderCapability = 'chat' | 'stream_chat' | 'structured' | 'vision';
export type ProviderAttemptStatus = 'available' | 'unavailable';
export type ProviderUnavailableReason = 'missing_api_key' | 'missing_config' | 'unsupported_capability' | 'disabled';
export type ProviderDataScope = 'transcript' | 'screenshots' | 'reference_files' | 'profile_history' | 'embeddings' | 'post_call_summary';
export type ProviderDataScopePolicy = Partial<Record<ProviderDataScope, boolean>>;

export const DOCUMENT_GROUNDING_SCOPE_DENIED_MESSAGE = "I can't answer that from the uploaded reference files because the selected provider is not allowed to receive reference-file context. Enable reference-file access for this provider or switch to a local provider, then ask again.";

export class ProviderScopeError extends Error {
    constructor(
        public readonly provider: string,
        public readonly deniedScopes: ProviderDataScope[]
    ) {
        super(`Provider ${provider} blocked by data scope policy: ${deniedScopes.join(', ')}`);
        this.name = 'ProviderScopeError';
    }
}

export function getDeniedDataScopes(scopes: ProviderDataScope[] = [], policy?: ProviderDataScopePolicy): ProviderDataScope[] {
    return scopes.filter(scope => policy?.[scope] === false);
}

export function assertProviderDataScopes(provider: string, scopes: ProviderDataScope[] = [], policy?: ProviderDataScopePolicy): void {
    const denied = getDeniedDataScopes(scopes, policy);
    if (denied.length > 0) {
        throw new ProviderScopeError(provider, denied);
    }
}

export interface ProviderAvailabilityState {
    hasNatively?: boolean;
    hasGroq?: boolean;
    groqDisabled?: boolean;
    hasCodex?: boolean;
    hasGemini?: boolean;
    hasOpenAI?: boolean;
    hasClaude?: boolean;
    hasDeepseek?: boolean;
    hasOllama?: boolean;
}

export interface ProviderModelState {
    natively?: string;
    groq?: string;
    codex?: string;
    geminiFlash?: string;
    geminiPro?: string;
    openai?: string;
    claude?: string;
    deepseek?: string;
    ollama?: string;
}

export interface ProviderRouteOptions {
    capability: ProviderCapability;
    multimodal?: boolean;
    availability: ProviderAvailabilityState;
    models?: ProviderModelState;
    dataScopes?: ProviderDataScope[];
    scopePolicy?: ProviderDataScopePolicy;
}

export interface ProviderAttempt {
    provider: LLMProviderId;
    name: string;
    status: ProviderAttemptStatus;
    unavailableReason?: ProviderUnavailableReason;
    capability: ProviderCapability;
    model?: string;
}

interface ProviderSpec {
    provider: LLMProviderId;
    name: string;
    model?: string;
    available?: boolean;
    unavailableReason?: ProviderUnavailableReason;
    supports: ProviderCapability[];
}

function statusFor(spec: ProviderSpec, capability: ProviderCapability, deniedScopes: ProviderDataScope[] = []): Pick<ProviderAttempt, 'status' | 'unavailableReason'> {
    if (!spec.supports.includes(capability)) {
        return { status: 'unavailable', unavailableReason: 'unsupported_capability' };
    }
    if (deniedScopes.length > 0) {
        return { status: 'unavailable', unavailableReason: 'disabled' };
    }
    if (spec.available) return { status: 'available' };
    return { status: 'unavailable', unavailableReason: spec.unavailableReason ?? 'missing_api_key' };
}

export function hasLocalFallbackAvailable(ollamaModels: string[]): boolean {
    return Array.isArray(ollamaModels) && ollamaModels.some(model => typeof model === 'string' && model.trim().length > 0);
}

export function routeLLMProviders(options: ProviderRouteOptions): ProviderAttempt[] {
    const availability = { ...options.availability };
    const models = { ...options.models };
    const capability = options.capability;

    const natively: ProviderSpec = {
        provider: 'natively',
        name: 'Natively API',
        model: models.natively,
        available: Boolean(availability.hasNatively),
        unavailableReason: 'missing_api_key',
        supports: ['chat', 'stream_chat', 'vision'],
    };
    const groq: ProviderSpec = {
        provider: 'groq',
        name: `Groq (${models.groq ?? 'default'})`,
        model: models.groq,
        available: Boolean(availability.hasGroq) && !availability.groqDisabled,
        unavailableReason: availability.groqDisabled ? 'disabled' : 'missing_api_key',
        supports: ['chat', 'stream_chat', 'structured', 'vision'],
    };
    const codex: ProviderSpec = {
        provider: 'codex',
        name: `Codex CLI (${models.codex ?? 'default'})`,
        model: models.codex,
        available: Boolean(availability.hasCodex),
        unavailableReason: 'missing_config',
        supports: ['chat', 'stream_chat', 'structured', 'vision'],
    };
    const geminiFlash: ProviderSpec = {
        provider: 'gemini_flash',
        name: `Gemini Flash (${models.geminiFlash ?? 'default'})`,
        model: models.geminiFlash,
        available: Boolean(availability.hasGemini),
        unavailableReason: 'missing_api_key',
        supports: ['chat', 'stream_chat', 'vision'],
    };
    const geminiPro: ProviderSpec = {
        provider: 'gemini_pro',
        name: `Gemini Pro (${models.geminiPro ?? 'default'})`,
        model: models.geminiPro,
        available: Boolean(availability.hasGemini),
        unavailableReason: 'missing_api_key',
        supports: ['chat', 'stream_chat', 'structured', 'vision'],
    };
    const openai: ProviderSpec = {
        provider: 'openai',
        name: `OpenAI (${models.openai ?? 'default'})`,
        model: models.openai,
        available: Boolean(availability.hasOpenAI),
        unavailableReason: 'missing_api_key',
        supports: ['chat', 'stream_chat', 'structured', 'vision'],
    };
    const claude: ProviderSpec = {
        provider: 'claude',
        name: `Claude (${models.claude ?? 'default'})`,
        model: models.claude,
        available: Boolean(availability.hasClaude),
        unavailableReason: 'missing_api_key',
        supports: ['chat', 'stream_chat', 'structured', 'vision'],
    };
    // DeepSeek (OpenAI-compatible) is intentionally text-only — no vision support
    // declared, so it is excluded from multimodal/screenshot fallback chains.
    const deepseek: ProviderSpec = {
        provider: 'deepseek',
        name: `DeepSeek (${models.deepseek ?? 'default'})`,
        model: models.deepseek,
        available: Boolean(availability.hasDeepseek),
        unavailableReason: 'missing_api_key',
        supports: ['chat', 'stream_chat', 'structured'],
    };
    const ollama: ProviderSpec = {
        provider: 'ollama',
        name: `Ollama (${models.ollama ?? 'local'})`,
        model: models.ollama,
        available: Boolean(availability.hasOllama),
        unavailableReason: 'missing_config',
        supports: ['chat', 'stream_chat', 'structured', 'vision'],
    };

    // DeepSeek is placed after Claude in the text-only chain (between the existing
    // cloud chat providers and the local Ollama fallback) and is omitted from the
    // multimodal chain since no DeepSeek vision model is supported.
    const orderedSpecs: ProviderSpec[] = options.multimodal
        ? [natively, codex, openai, geminiFlash, claude, geminiPro, groq]
        : [natively, groq, codex, geminiFlash, geminiPro, openai, claude, deepseek];

    if (availability.hasOllama) {
        orderedSpecs.push(ollama);
    }

    const deniedScopes = getDeniedDataScopes(options.dataScopes, options.scopePolicy);

    return orderedSpecs.map(spec => ({
        provider: spec.provider,
        name: spec.name,
        capability,
        model: spec.model,
        ...statusFor(spec, capability, spec.provider === 'ollama' && spec.available ? [] : deniedScopes),
    }));
}

export function routeWithScopeFallback(options: ProviderRouteOptions): ProviderAttempt[] {
    return routeLLMProviders(options);
}

// =============================================================================
// Policy-Aware Routing + Circuit Breaker
// =============================================================================

export type ModeTemplateType = 'sales' | 'recruiting' | 'interview' | 'default';
export type ActionType = 'answer' | 'code_hint' | 'brainstorm' | 'recap' | 'summary';
export type ProviderHealthStatus = 'healthy' | 'degraded' | 'down';

export interface RoutingPolicy {
    mode?: ModeTemplateType;
    actionType?: ActionType;
    needsVision?: boolean;
    preferLowLatency?: boolean;
    privacySetting?: 'cloud' | 'local-only';
    providerHealth?: Record<string, ProviderHealthStatus>;
}

export interface ProviderChoice {
    provider: string;
    model: string;
    reason: string;
}

// Vision-capable providers (ordered by capability)
const VISION_PROVIDERS = ['gemini', 'claude', 'openai', 'groq'];
// Low-latency providers (ordered by speed)
const LOW_LATENCY_PROVIDERS = ['groq', 'gemini'];
// Quality providers (for summary/recap tasks)
const QUALITY_PROVIDERS = ['claude', 'openai', 'gemini_pro'];
// Local providers (for privacy mode)
const LOCAL_PROVIDERS = ['ollama', 'custom'];

export interface CircuitBreakerConfig {
    threshold: number;        // failures before opening
    resetTimeout: number;      // ms before trying again (half-open)
    halfOpenMaxCalls: number; // max calls in half-open state
}

export class CircuitBreaker {
    public failureCount: number = 0;
    public lastFailure: number = 0;
    public state: 'closed' | 'open' | 'half-open' = 'closed';
    public halfOpenCalls: number = 0;

    constructor(
        public readonly provider: string,
        public readonly config: CircuitBreakerConfig
    ) {}

    recordSuccess(): void {
        this.failureCount = 0;
        this.state = 'closed';
        this.halfOpenCalls = 0;
    }

    recordFailure(): void {
        this.failureCount++;
        this.lastFailure = Date.now();

        if (this.state === 'half-open') {
            this.halfOpenCalls++;
            if (this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
                this.state = 'open';
            }
        } else if (this.failureCount >= this.config.threshold) {
            this.state = 'open';
        }
    }

    canExecute(): boolean {
        if (this.state === 'closed') return true;

        if (this.state === 'open') {
            const elapsed = Date.now() - this.lastFailure;
            if (elapsed >= this.config.resetTimeout) {
                this.state = 'half-open';
                this.halfOpenCalls = 0;
                return true;
            }
            return false;
        }

        // half-open: allow limited calls
        return this.halfOpenCalls < this.config.halfOpenMaxCalls;
    }

    get timeUntilRetry(): number {
        if (this.state !== 'open') return 0;
        const elapsed = Date.now() - this.lastFailure;
        return Math.max(0, this.config.resetTimeout - elapsed);
    }
}

export class ProviderRouter {
    private circuitBreakers: Map<string, CircuitBreaker> = new Map();
    private readonly defaultCircuitConfig: CircuitBreakerConfig = {
        threshold: 5,
        resetTimeout: 30000,
        halfOpenMaxCalls: 1
    };

    constructor(circuitConfig?: Partial<CircuitBreakerConfig>) {
        const config = { ...this.defaultCircuitConfig, ...circuitConfig };
        // Initialize circuit breakers for each provider
        ['gemini', 'groq', 'openai', 'claude', 'deepseek', 'natively', 'codex'].forEach(provider => {
            this.circuitBreakers.set(provider, new CircuitBreaker(provider, config));
        });
    }

    /**
     * Select the best provider based on routing policy
     */
    selectProvider(policy: RoutingPolicy): ProviderChoice {
        const health = policy.providerHealth || {};

        // Rule 1: Local-only mode -> only local providers
        if (policy.privacySetting === 'local-only') {
            return {
                provider: 'ollama',
                model: 'local',
                reason: 'local-only mode: using local provider'
            };
        }

        // Rule 2: Check circuit breakers and skip unhealthy providers
        const availableProviders = this.filterHealthyProviders(
            ['gemini', 'groq', 'openai', 'claude', 'deepseek', 'natively', 'codex'],
            health
        );

        if (availableProviders.length === 0) {
            // All providers down, return lowest priority
            return {
                provider: 'gemini',
                model: 'gemini-3.5-flash',
                reason: 'all providers unhealthy, using Gemini as last resort'
            };
        }

        // Rule 3: Vision request -> prefer vision-capable providers
        if (policy.needsVision) {
            const visionProvider = this.selectFromCapabilities(availableProviders, VISION_PROVIDERS, 'vision', health);
            if (visionProvider) return visionProvider;
        }

        // Rule 4: Low-latency request -> prefer fast providers
        if (policy.preferLowLatency) {
            const fastProvider = this.selectFromCapabilities(availableProviders, LOW_LATENCY_PROVIDERS, 'low-latency', health);
            if (fastProvider) return fastProvider;
        }

        // Rule 5: Summary/recap -> quality over speed
        if (policy.actionType === 'summary' || policy.actionType === 'recap') {
            const qualityProvider = this.selectFromCapabilities(availableProviders, QUALITY_PROVIDERS, 'quality', health);
            if (qualityProvider) return qualityProvider;
        }

        // Rule 6: Mode-based routing (future enhancement hook)
        if (policy.mode) {
            const modeProvider = this.getModeProvider(policy.mode, availableProviders, health);
            if (modeProvider) return modeProvider;
        }

        // Default: Groq for speed (most bang for buck on free tier)
        return {
            provider: 'groq',
            model: 'llama-3.3-70b-versatile',
            reason: 'default routing: Groq (fastest free tier)'
        };
    }

    private filterHealthyProviders(
        providers: string[],
        health: Record<string, ProviderHealthStatus>
    ): string[] {
        return providers.filter(p => {
            const status = health[p];
            return status !== 'down' && this.getCircuitBreaker(p).canExecute();
        });
    }

    private selectFromCapabilities(
        available: string[],
        preference: string[],
        reason: string,
        health: Record<string, ProviderHealthStatus>
    ): ProviderChoice | null {
        for (const provider of preference) {
            if (available.includes(provider) && health[provider] !== 'down') {
                return {
                    provider,
                    model: this.getDefaultModel(provider),
                    reason: `${reason}: selected ${provider}`
                };
            }
        }
        return null;
    }

    private getModeProvider(
        mode: ModeTemplateType,
        available: string[],
        health: Record<string, ProviderHealthStatus>
    ): ProviderChoice | null {
        // Mode-specific routing (simplified)
        const modePreferences: Record<ModeTemplateType, string[]> = {
            'sales': ['groq', 'gemini', 'openai'],
            'recruiting': ['claude', 'groq', 'gemini'],
            'interview': ['gemini', 'groq', 'openai'],
            'default': ['groq', 'gemini', 'openai']
        };

        const preferences = modePreferences[mode] || modePreferences['default'];
        return this.selectFromCapabilities(available, preferences, `mode:${mode}`, health);
    }

    private getDefaultModel(provider: string): string {
        const models: Record<string, string> = {
            'gemini': 'gemini-3.5-flash',
            'groq': 'llama-3.3-70b-versatile',
            'openai': 'gpt-5.4',
            'claude': 'claude-sonnet-4-6',
            'deepseek': 'deepseek-v4-flash',
            'natively': 'default',
            'codex': 'default'
        };
        return models[provider] || 'default';
    }

    getCircuitBreaker(provider: string): CircuitBreaker {
        let cb = this.circuitBreakers.get(provider);
        if (!cb) {
            cb = new CircuitBreaker(provider, this.defaultCircuitConfig);
            this.circuitBreakers.set(provider, cb);
        }
        return cb;
    }

    recordSuccess(provider: string): void {
        this.getCircuitBreaker(provider).recordSuccess();
    }

    recordFailure(provider: string): void {
        this.getCircuitBreaker(provider).recordFailure();
    }

    getProviderHealth(): Record<string, 'healthy' | 'degraded' | 'down' | 'unknown'> {
        const health: Record<string, 'healthy' | 'degraded' | 'down' | 'unknown'> = {};
        this.circuitBreakers.forEach((cb, provider) => {
            if (cb.state === 'closed') health[provider] = 'healthy';
            else if (cb.state === 'half-open') health[provider] = 'degraded';
            else health[provider] = 'down';
        });
        return health;
    }
}
