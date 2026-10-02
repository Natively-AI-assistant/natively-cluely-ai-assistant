/**
 * LiveModelCatalogService.ts
 *
 * Manages dynamic model catalog caching, discovery, and synchronization
 * across all configured AI providers with a 24-hour TTL (stale-while-revalidate).
 */

import { fetchProviderModels, ProviderModel } from '../utils/modelFetcher';

export type LiveCatalogProvider =
    | 'openai'
    | 'gemini'
    | 'claude'
    | 'groq'
    | 'deepseek'
    | 'nvidia_nim'
    | 'openrouter'
    | 'fluxion'
    | 'agentrouter';

export interface LiveModelCatalogOptions {
    credentialsManager?: any;
    fetcher?: (provider: any, apiKey: string) => Promise<ProviderModel[]>;
    onUpdated?: (provider: string, models: ProviderModel[]) => void;
}

export class LiveModelCatalogService {
    private static instance: LiveModelCatalogService | null = null;
    public static readonly DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

    private credentialsManager: any;
    private fetcher: (provider: any, apiKey: string) => Promise<ProviderModel[]>;
    private onUpdated?: (provider: string, models: ProviderModel[]) => void;
    private inFlight = new Map<string, Promise<{ success: boolean; models: ProviderModel[]; error?: string }>>();
    private inFlightKey = new Map<string, string>();
    private inFlightSeq = new Map<string, number>();
    private requestSeq = new Map<string, number>();

    constructor(options?: LiveModelCatalogOptions) {
        this.credentialsManager = options?.credentialsManager;
        this.fetcher = options?.fetcher || fetchProviderModels;
        this.onUpdated = options?.onUpdated;
    }

    public static getInstance(): LiveModelCatalogService {
        if (!LiveModelCatalogService.instance) {
            LiveModelCatalogService.instance = new LiveModelCatalogService();
        }
        return LiveModelCatalogService.instance;
    }

    private getCm(): any {
        if (this.credentialsManager) return this.credentialsManager;
        const { CredentialsManager } = require('./CredentialsManager');
        return CredentialsManager.getInstance();
    }

    public setOnUpdated(callback: (provider: string, models: ProviderModel[]) => void): void {
        this.onUpdated = callback;
    }

    /**
     * Check whether the cached catalog for a given provider has exceeded TTL or never been fetched.
     */
    public isStale(provider: string, ttlMs: number = LiveModelCatalogService.DEFAULT_TTL_MS): boolean {
        const cm = this.getCm();
        const fetchedAtMap = cm.getCloudFetchedAt?.() || {};
        const fetchedAt = fetchedAtMap[provider] || 0;
        if (!fetchedAt || fetchedAt <= 0) return true;
        return Date.now() - fetchedAt > ttlMs;
    }

    /**
     * Get API key for a provider.
     */
    public getApiKeyForProvider(provider: string): string {
        const cm = this.getCm();
        switch (provider) {
            case 'openai': return cm.getOpenaiApiKey?.() || '';
            case 'gemini': return cm.getGeminiApiKey?.() || '';
            case 'claude': return cm.getClaudeApiKey?.() || '';
            case 'groq': return cm.getGroqApiKey?.() || '';
            case 'deepseek': return cm.getDeepseekApiKey?.() || '';
            case 'nvidia_nim': return cm.getNvidiaNimApiKey?.() || '';
            case 'openrouter': return cm.getOpenrouterApiKey?.() || '';
            case 'fluxion': return cm.getFluxionApiKey?.() || '';
            case 'agentrouter': return cm.getAgentRouterApiKey?.() || '';
            default: return '';
        }
    }

    /**
     * Stale-while-revalidate: returns cached models immediately,
     * kicking off background refresh if stale or never fetched.
     */
    public getLiveModels(provider: string): ProviderModel[] {
        const cm = this.getCm();
        const cached = cm.getCloudFetchedModels?.(provider) || [];
        if (this.isStale(provider)) {
            // Background refresh without blocking caller
            this.refreshProvider(provider, false).catch(() => {});
        }
        return cached;
    }

    /**
     * Refresh models for a specific provider.
     */
    public async refreshProvider(
        provider: string,
        force: boolean = false
    ): Promise<{ success: boolean; models: ProviderModel[]; error?: string }> {
        const cm = this.getCm();
        const key = this.getApiKeyForProvider(provider)?.trim();

        if (!key) {
            this.requestSeq.set(provider, (this.requestSeq.get(provider) || 0) + 1);
            cm.setCloudFetchedModels?.(provider, [], 0);
            return {
                success: false,
                models: [],
                error: `No API key available for provider ${provider}`,
            };
        }

        if (!force && !this.isStale(provider)) {
            return {
                success: true,
                models: cm.getCloudFetchedModels?.(provider) || [],
            };
        }

        // Deduplicate in-flight requests for the same provider ONLY when not forcing and key matches
        if (!force && this.inFlight.has(provider) && this.inFlightKey.get(provider) === key) {
            return this.inFlight.get(provider)!;
        }

        const seq = (this.requestSeq.get(provider) || 0) + 1;
        this.requestSeq.set(provider, seq);

        const task = (async () => {
            try {
                const models = await this.fetcher(provider, key);

                // Verify that credential hasn't rotated or cleared during the in-flight network call
                const currentKey = this.getApiKeyForProvider(provider)?.trim();
                if (currentKey !== key) {
                    return {
                        success: false,
                        models: cm.getCloudFetchedModels?.(provider) || [],
                        error: 'Credential changed while request was in-flight',
                    };
                }

                // Verify that a newer refresh has not started/completed (distinguish overlapping requests)
                if (this.requestSeq.get(provider) !== seq) {
                    return {
                        success: false,
                        models: cm.getCloudFetchedModels?.(provider) || [],
                        error: 'Superseded by a newer refresh request',
                    };
                }

                if (Array.isArray(models) && models.length > 0) {
                    const formatted = models.map((m: any) => ({
                        id: m.id,
                        label: m.label || m.id,
                    }));
                    cm.setCloudFetchedModels?.(provider, formatted, Date.now());
                    if (this.onUpdated) {
                        try {
                            this.onUpdated(provider, formatted);
                        } catch (e) {
                            console.error('[LiveModelCatalogService] onUpdated listener failed:', e);
                        }
                    }
                    return { success: true, models: formatted };
                }
                return {
                    success: false,
                    models: cm.getCloudFetchedModels?.(provider) || [],
                    error: 'Empty model catalog received',
                };
            } catch (error: any) {
                // NEVER log raw error with credentials
                const safeInfo = {
                    provider,
                    status: error?.response?.status,
                    message: error?.message,
                };
                console.warn('[LiveModelCatalogService] Refresh failed safely:', safeInfo);
                return {
                    success: false,
                    models: cm.getCloudFetchedModels?.(provider) || [],
                    error: error?.message || 'Failed to refresh provider models',
                };
            } finally {
                if (this.inFlightSeq.get(provider) === seq) {
                    this.inFlight.delete(provider);
                    this.inFlightKey.delete(provider);
                    this.inFlightSeq.delete(provider);
                }
            }
        })();

        this.inFlight.set(provider, task);
        this.inFlightKey.set(provider, key);
        this.inFlightSeq.set(provider, seq);
        return task;
    }

    /**
     * Refresh all configured providers in the background.
     */
    public async refreshAllConfiguredProviders(force: boolean = false): Promise<void> {
        const providers: LiveCatalogProvider[] = [
            'openai',
            'gemini',
            'claude',
            'groq',
            'deepseek',
            'nvidia_nim',
            'openrouter',
            'fluxion',
            'agentrouter',
        ];

        for (const provider of providers) {
            const key = this.getApiKeyForProvider(provider)?.trim();
            if (key) {
                try {
                    await this.refreshProvider(provider, force);
                } catch {
                    // Ignored in batch mode
                }
            }
        }
    }
}
