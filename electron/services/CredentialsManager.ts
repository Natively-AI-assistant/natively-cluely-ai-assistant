/**
 * CredentialsManager - Secure storage for API keys and service account paths
 * Uses Electron's safeStorage API for encryption at rest
 */

import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import * as crypto from 'crypto';
import { deriveFallbackKey, encryptCredentialBlob, decryptCredentialBlob } from './credentialFallbackCrypto';

const CREDENTIALS_PATH = path.join(app.getPath('userData'), 'credentials.enc');
// App-managed AES fallback, used ONLY when the OS keyring (safeStorage) is
// unavailable so keys still survive a restart. See credentialFallbackCrypto.ts for
// the (honest) security posture: obfuscation-grade, machine-bound, never plaintext.
const FALLBACK_PATH = path.join(app.getPath('userData'), 'credentials.fallback.enc');
// Per-install random salt for the fallback key derivation (32 raw bytes, 0600).
const SALT_PATH = path.join(app.getPath('userData'), 'credentials.salt');
// Sidecar tracking consecutive cold-start keyring decrypt failures (issue #322).
// Escalates to needsCredentialReentry() after DECRYPT_FAIL_THRESHOLD failures so
// the UI can ask the user to re-enter keys when the store is permanently unreadable.
const DECRYPT_FAIL_PATH = path.join(app.getPath('userData'), 'credentials.decryptfail');
const DECRYPT_FAIL_THRESHOLD = 3;

export interface CustomProvider {
    id: string;
    name: string;
    curlCommand: string;
    /**
     * Whether this provider can accept screenshots. When undefined, vision
     * support is auto-detected from the cURL template (an `{{IMAGE_BASE64}}`
     * placeholder, or an OpenAI-compatible `messages` body). Set explicitly to
     * override the guess. See customProviderSupportsVision().
     */
    multimodal?: boolean;
    /** True if this provider's endpoint is loopback/local (skips cloud-scope gating). */
    localOnly?: boolean;
}

export interface CurlProvider {
    id: string;
    name: string;
    curlCommand: string;
    responsePath: string; // e.g. "choices[0].message.content"
}

export interface StoredCredentials {
    geminiApiKey?: string;
    groqApiKey?: string;
    openaiApiKey?: string;
    claudeApiKey?: string;
    deepseekApiKey?: string;
    litellmApiKey?: string;
    litellmBaseURL?: string;
    /** Manual output ceiling for LiteLLM-proxied models. Unset → Auto (per-model via /model/info). */
    litellmMaxTokens?: number;
    googleServiceAccountPath?: string;
    customProviders?: CustomProvider[];
    curlProviders?: CurlProvider[];
    defaultModel?: string;
    nativelyApiKey?: string;
    // STT Provider settings
    sttProvider?: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'natively' | 'local-whisper';
    groqSttApiKey?: string;
    groqSttModel?: string;
    openAiSttApiKey?: string;
    /** Custom OpenAI-compatible STT base URL (e.g. self-hosted Speaches).
     *  Empty / unset → use https://api.openai.com. */
    openAiSttBaseUrl?: string;
    deepgramApiKey?: string;
    elevenLabsApiKey?: string;
    azureApiKey?: string;
    azureRegion?: string;
    ibmWatsonApiKey?: string;
    ibmWatsonRegion?: string;
    sonioxApiKey?: string;
    sttLanguage?: string;
    aiResponseLanguage?: string;
    // Tavily Search
    tavilyApiKey?: string;
    // Dynamic Model Discovery – preferred models per provider
    geminiPreferredModel?: string;
    groqPreferredModel?: string;
    openaiPreferredModel?: string;
    claudePreferredModel?: string;
    deepseekPreferredModel?: string;
    // Free trial state
    trialToken?: string;   // server-issued signed token (natively_trial_…)
    trialExpiresAt?: string;   // ISO timestamp — local copy for startup check
    trialStartedAt?: string;   // ISO timestamp
    trialClaimed?: boolean;  // set true on first claim, never cleared — hides start card permanently
    /**
     * Companion-extension pairing token. LOOPBACK-SCOPED — only the extension uses
     * it, over 127.0.0.1, and it never travels the wire off-box. Persisted
     * (encrypted via safeStorage) so the extension pairs ONCE and survives
     * restarts; regenerated only on a deliberate "Rotate token". Kept SEPARATE from
     * the phone token: the phone token is exposed in a plaintext-HTTP LAN QR when
     * exposeOnLan is on, so sharing one secret would let a sniffed LAN token reach
     * the extension's /dom capture capability. See PhoneMirrorService + CONTRACT.md.
     *
     * (Field name retained for backward-compat with already-persisted credentials.)
     */
    phoneMirrorToken?: string;
    /**
     * ChatGPT Codex OAuth tokens. Persisted (encrypted via safeStorage) so the
     * user only signs in once per device. Written by CodexOAuthService on a
     * successful PKCE callback+exchange and on each refresh-token rotation;
     * cleared on signOut or on permanent refresh failure (invalid_grant).
     * Shape: { accessToken, refreshToken, idToken?, expiresAt, email?, accountId? }.
     */
    codexOAuthTokens?: {
        accessToken: string;
        refreshToken: string;
        idToken?: string;
        expiresAt: number;
        email?: string;
        accountId?: string;
        /**
         * Epoch ms of the last successful token exchange (initial login OR
         * refresh). Used by the 8-day proactive re-auth check: OpenAI may
         * silently invalidate refresh tokens that have been aging in storage
         * for too long, and the result is a sudden `invalid_grant` mid-use.
         * Tracking the last-exchange time lets us clear credentials and
         * prompt the user to re-auth BEFORE the user hits a broken call.
         * Mirrors open-sse `trackRefreshAt: true` + `maxRefreshAgeMs:
         * 691200000` (8 days) at codex.md:1167 / 1329.
         */
        lastRefreshAt?: number;
    };
}

export class CredentialsManager {
    private static instance: CredentialsManager;
    private credentials: StoredCredentials = {};
    /** Memoized AES-256 key for the app-managed fallback (derived once per process). */
    private fallbackKey?: Buffer;
    /**
     * True when this launch found an on-disk keyring store that could not be
     * decrypted (issue #322). While set, empty saves must not clobber the file,
     * and fallback must not be deleted until a cold-start decrypt proves the
     * keyring readable again ("verified-healed").
     */
    private existingStoreUnreadable = false;
    /**
     * True when this launch successfully populated `credentials` from a readable
     * on-disk store (keyring or fallback). While the keyring is unreadable and
     * this is false, in-memory state is empty/sparse — persisting it would
     * permanently replace still-recoverable ciphertext (Greptile P1 / #322).
     */
    private recoveredFromReadableStore = false;
    /** True after DECRYPT_FAIL_THRESHOLD consecutive cold-start decrypt failures. */
    private credentialReentryNeeded = false;

    private constructor() {
        // Load on construction after app ready
    }

    public static getInstance(): CredentialsManager {
        if (!CredentialsManager.instance) {
            CredentialsManager.instance = new CredentialsManager();
        }
        return CredentialsManager.instance;
    }

    /**
     * Initialize - load credentials from disk
     * Must be called after app.whenReady()
     */
    public init(): void {
        this.existingStoreUnreadable = false;
        this.recoveredFromReadableStore = false;
        this.credentialReentryNeeded = false;
        this.loadCredentials();
        console.log('[CredentialsManager] Initialized');
        // One-shot diagnostic so we can confirm, from real telemetry, WHICH
        // population hits the "key not persisted" path: the expected Linux-
        // without-keyring case vs a signing/keyring regression on packaged
        // macOS/Windows. Metadata only — never key contents.
        this.emitStorageStatusDiagnostic('startup');
    }

    /**
     * True when this launch could not decrypt an existing keyring file.
     * Call sites that auto-persist single fields (Google SA path, PhoneMirror
     * ext-token mint) MUST skip disk writes while this is true, or they will
     * clobber a still-recoverable store with a sparse credential set.
     */
    public wasExistingStoreUnreadable(): boolean {
        return this.existingStoreUnreadable;
    }

    /**
     * True when credentials were loaded from a readable on-disk store this launch.
     * Exposed for tests covering the sparse-recovery guard (Greptile P1).
     */
    public didRecoverFromReadableStore(): boolean {
        return this.recoveredFromReadableStore;
    }

    /**
     * True after enough consecutive cold-start decrypt failures that the user
     * should be prompted to re-enter API keys (issue #322 permanent path).
     */
    public needsCredentialReentry(): boolean {
        return this.credentialReentryNeeded;
    }

    /**
     * Emit a privacy-safe snapshot of OS secure-storage availability via the
     * shared TelemetryService. Carries ONLY booleans/enums/platform — never any
     * key material. Called once at startup and again when an STT key save fails
     * to persist (so the failure can be correlated with the environment).
     *
     * Fields:
     *  - available:   safeStorage.isEncryptionAvailable() — false ⇒ keys won't survive restart
     *  - platform:    process.platform (darwin/win32/linux)
     *  - backend:     (linux only) safeStorage.getSelectedStorageBackend() — the
     *                 key signal: 'basic_text' ⇒ no keyring (expected failure),
     *                 'gnome_libsecret'/'kwallet*' ⇒ keyring present
     *  - packaged:    app.isPackaged — distinguishes the unsigned/dev-build hypothesis
     *
     * Never throws and never blocks; a telemetry/env edge can at worst drop the
     * event. Respects the telemetry consent gate (the service no-ops when the
     * user disabled telemetry).
     */
    public emitStorageStatusDiagnostic(phase: 'startup' | 'stt_save_failed'): void {
        try {
            let available = false;
            try { available = safeStorage.isEncryptionAvailable(); } catch { available = false; }

            const properties: Record<string, unknown> = {
                phase,
                available,
                platform: process.platform,
                packaged: (() => { try { return app.isPackaged === true; } catch { return false; } })(),
                // Which persistence path keys actually take: the OS keyring, or the
                // app-managed AES fallback. Lets us size the keyring-less population and
                // judge whether signing/keyring follow-up is warranted. Never key material.
                mode: available ? 'keyring' : 'fallback',
                usedFallback: !available,
            };

            // Linux is the only platform where the backend enum is meaningful and
            // available — it tells basic_text (no keyring) from gnome_libsecret/kwallet.
            if (process.platform === 'linux') {
                try {
                    const getBackend = (safeStorage as unknown as { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend;
                    if (typeof getBackend === 'function') {
                        properties.backend = getBackend.call(safeStorage);
                    }
                } catch { /* backend probe unavailable — leave it off */ }
            }

            const { telemetryService } = require('./telemetry/TelemetryService');
            telemetryService.record('credential_storage_status', properties);
        } catch {
            // Diagnostics must never break credential loading or key saves.
        }
    }

    // =========================================================================
    // Getters
    // =========================================================================

    public getGeminiApiKey(): string | undefined {
        return this.credentials.geminiApiKey;
    }

    public getGroqApiKey(): string | undefined {
        return this.credentials.groqApiKey;
    }

    public getOpenaiApiKey(): string | undefined {
        return this.credentials.openaiApiKey;
    }

    public getClaudeApiKey(): string | undefined {
        return this.credentials.claudeApiKey;
    }

    public getDeepseekApiKey(): string | undefined {
        return this.credentials.deepseekApiKey;
    }

    /** Persisted loopback-scoped companion-extension token (stable across restarts). */
    public getPhoneMirrorToken(): string | undefined {
        return this.credentials.phoneMirrorToken;
    }

    /**
     * Persisted ChatGPT Codex OAuth tokens. Read by CodexOAuthService.getAccessToken()
     * to refresh-and-retry on a 401 from the Codex API. Returns a defensive deep
     * copy so callers can't mutate the stored bundle by accident.
     */
    public getCodexOAuthTokens(): { accessToken: string; refreshToken: string; idToken?: string; expiresAt: number; email?: string; accountId?: string; lastRefreshAt?: number } | null {
        const t = this.credentials.codexOAuthTokens;
        if (!t || typeof t.accessToken !== 'string' || typeof t.refreshToken !== 'string') return null;
        return { ...t };
    }

    public setCodexOAuthTokens(tokens: { accessToken: string; refreshToken: string; idToken?: string; expiresAt: number; email?: string; accountId?: string; lastRefreshAt?: number }): void {
        this.credentials.codexOAuthTokens = { ...tokens };
        this.saveCredentials();
        console.log('[CredentialsManager] Codex OAuth tokens updated');
    }

    public clearCodexOAuthTokens(): void {
        this.credentials.codexOAuthTokens = undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] Codex OAuth tokens cleared');
    }

    public getLitellmApiKey(): string | undefined {
        return this.credentials.litellmApiKey;
    }

    public getLitellmBaseURL(): string | undefined {
        return this.credentials.litellmBaseURL;
    }

    public getLitellmMaxTokens(): number | undefined {
        return this.credentials.litellmMaxTokens;
    }

    public getGoogleServiceAccountPath(): string | undefined {
        return this.credentials.googleServiceAccountPath;
    }

    public getCustomProviders(): CustomProvider[] {
        return this.credentials.customProviders || [];
    }

    public getSttProvider(): 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'natively' | 'local-whisper' {
        const provider = this.credentials.sttProvider || 'none';
        // Self-heal: if provider is 'none' but a Natively key exists, the user is in a
        // broken state (key cleared then re-entered via a path that skipped auto-promote,
        // or credentials restored from backup). Silently restore to 'natively' so STT works.
        if (provider === 'none' && this.credentials.nativelyApiKey) {
            this.credentials.sttProvider = 'natively';
            this.saveCredentials();
            console.log('[CredentialsManager] Self-healed sttProvider: none→natively (Natively key present)');
            return 'natively';
        }
        return provider;
    }

    public getDeepgramApiKey(): string | undefined {
        return this.credentials.deepgramApiKey;
    }

    public getGroqSttApiKey(): string | undefined {
        return this.credentials.groqSttApiKey;
    }

    public getGroqSttModel(): string {
        return this.credentials.groqSttModel || 'whisper-large-v3-turbo';
    }

    public getOpenAiSttApiKey(): string | undefined {
        return this.credentials.openAiSttApiKey;
    }

    public getOpenAiSttBaseUrl(): string | undefined {
        return this.credentials.openAiSttBaseUrl;
    }

    public getElevenLabsApiKey(): string | undefined {
        return this.credentials.elevenLabsApiKey;
    }

    public getAzureApiKey(): string | undefined {
        return this.credentials.azureApiKey;
    }

    public getAzureRegion(): string {
        return this.credentials.azureRegion || 'eastus';
    }

    public getIbmWatsonApiKey(): string | undefined {
        return this.credentials.ibmWatsonApiKey;
    }

    public getIbmWatsonRegion(): string {
        return this.credentials.ibmWatsonRegion || 'us-south';
    }

    public getSonioxApiKey(): string | undefined {
        return this.credentials.sonioxApiKey;
    }

    public getTavilyApiKey(): string | undefined {
        return this.credentials.tavilyApiKey;
    }

    public getSttLanguage(): string {
        return this.credentials.sttLanguage || 'english-us';
    }

    public getAiResponseLanguage(): string {
        return this.credentials.aiResponseLanguage || 'auto';
    }
    public getDefaultModel(): string {
        // Default to Flash-Lite: ~0.65s first-token vs ~2.3s for full Flash on
        // the same prompt (measured), and faster output streaming — the
        // Cluely-class interactive latency target. Full Flash / Pro remain
        // user-selectable for harder problems.
        return this.credentials.defaultModel || 'gemini-3.1-flash-lite';
    }

    public getNativelyApiKey(): string | undefined {
        return this.credentials.nativelyApiKey;
    }

    public getAllCredentials(): StoredCredentials {
        return { ...this.credentials };
    }

    // =========================================================================
    // Vision provider availability — used by the vision-first screen pipeline
    // =========================================================================

    /**
     * True if at least one configured provider is vision-capable.
     * Used by ScreenUnderstandingService to gate vision_only / decide fallback.
     */
    public anyVisionProviderConfigured(): boolean {
        if (this.credentials.nativelyApiKey) return true;       // Natively API supports vision
        if (this.credentials.openaiApiKey) return true;          // gpt-4o / gpt-5 vision
        if (this.credentials.claudeApiKey) return true;          // Claude vision
        if (this.credentials.geminiApiKey) return true;          // Gemini vision
        if (this.credentials.groqApiKey) return true;            // Groq llama-4-scout vision
        // Custom providers: only count if they have screenshots scope AND multimodal flag
        const custom = this.credentials.customProviders || [];
        if (custom.some(p => (p as any)?.multimodal === true)) return true;
        return this.anyLocalVisionProviderConfigured();
    }

    /**
     * True if at least one LOCAL vision provider is configured (Ollama vision model,
     * Codex CLI with vision support, or a local-only custom provider).
     * Used by private_vision mode to enforce no cloud-vision calls.
     */
    public anyLocalVisionProviderConfigured(): boolean {
        // Ollama: caller verifies the configured model is vision-capable via modelCapabilities.
        // Here we only assert the runtime is configured — model gating happens in the chain.
        const ollamaBaseUrl = (this.credentials as any).ollamaBaseUrl as string | undefined;
        if (ollamaBaseUrl && ollamaBaseUrl.trim().length > 0) return true;
        // Codex CLI is local in normal install — capability is verified by ProviderRouter.
        const codexCliPath = (this.credentials as any).codexCliPath as string | undefined;
        if (codexCliPath && codexCliPath.trim().length > 0) return true;
        return false;
    }

    // =========================================================================
    // Setters (auto-save)
    // =========================================================================

    public setGeminiApiKey(key: string): void {
        const trimmed = (key || '').trim();
        this.credentials.geminiApiKey = trimmed || undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] Gemini API Key updated');
    }

    public setGroqApiKey(key: string): void {
        const trimmed = (key || '').trim();
        this.credentials.groqApiKey = trimmed || undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] Groq API Key updated');
    }

    public setOpenaiApiKey(key: string): void {
        const trimmed = (key || '').trim();
        this.credentials.openaiApiKey = trimmed || undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] OpenAI API Key updated');
    }

    public setClaudeApiKey(key: string): void {
        const trimmed = (key || '').trim();
        this.credentials.claudeApiKey = trimmed || undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] Claude API Key updated');
    }

    public setDeepseekApiKey(key: string): void {
        const trimmed = key.trim();
        this.credentials.deepseekApiKey = trimmed || undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] DeepSeek API Key updated');
    }

    /**
     * Persist the loopback-scoped companion-extension token. Pass an empty string
     * to clear it (next start mints a fresh one). Only the PhoneMirrorService
     * writes this — on first start (mint) and on Rotate token. The phone token is
     * NOT persisted (per-session, LAN-exposed) and is intentionally separate.
     */
    public setPhoneMirrorToken(token: string): void {
        this.credentials.phoneMirrorToken = token || undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] Extension pairing token updated');
    }

    /**
     * Persist LiteLLM proxy config. baseURL is the proxy location (required to
     * enable the provider); apiKey is the optional virtual/master key;
     * maxTokens is the optional user-set output ceiling (0/undefined → default).
     * Passing an empty baseURL clears everything, disabling the provider.
     */
    public setLitellmConfig(apiKey: string, baseURL: string, maxTokens?: number): void {
        const trimmedURL = (baseURL || '').trim();
        const trimmedKey = (apiKey || '').trim();
        if (!trimmedURL) {
            this.credentials.litellmApiKey = undefined;
            this.credentials.litellmBaseURL = undefined;
            this.credentials.litellmMaxTokens = undefined;
            this.saveCredentials();
            console.log('[CredentialsManager] LiteLLM config cleared');
            return;
        }
        // Empty key + existing stored key = keep it (the Settings field is masked
        // and left blank when re-saving e.g. just the max-tokens). Clearing the
        // key entirely is done via Remove (empty baseURL clears everything).
        this.credentials.litellmApiKey = trimmedKey || this.credentials.litellmApiKey || undefined;
        this.credentials.litellmBaseURL = trimmedURL;
        const mt = Number(maxTokens);
        this.credentials.litellmMaxTokens = Number.isFinite(mt) && mt > 0 ? Math.floor(mt) : undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] LiteLLM config updated');
    }

    public setGoogleServiceAccountPath(filePath: string): void {
        this.credentials.googleServiceAccountPath = filePath;
        this.saveCredentials();
        console.log('[CredentialsManager] Google Service Account path updated');
    }

    public setSttProvider(provider: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'natively' | 'local-whisper'): boolean {
        this.credentials.sttProvider = provider;
        const persisted = this.saveCredentials();
        console.log(`[CredentialsManager] STT Provider set to: ${provider}`);
        return persisted;
    }

    // NOTE: the STT key setters return saveCredentials()'s boolean (true = the write
    // actually reached disk) so the IPC layer can surface a REAL error instead of a
    // false "Saved" when a write fails. Do not change these back to void.
    //
    // Empty/whitespace input is normalized to `undefined` (not `''`) so the canonical
    // `hasKey = (k?: string) => !!(k && k.trim().length > 0)` check returns false on
    // reload — matching `setNativelyApiKey` / `setDeepseekApiKey`. The Remove button
    // (which calls these with `''`) still correctly clears the stored key.
    public setDeepgramApiKey(key: string): boolean {
        const trimmed = (key || '').trim();
        this.credentials.deepgramApiKey = trimmed || undefined;
        const persisted = this.saveCredentials();
        console.log('[CredentialsManager] Deepgram API Key updated');
        return persisted;
    }

    public setGroqSttApiKey(key: string): boolean {
        const trimmed = (key || '').trim();
        this.credentials.groqSttApiKey = trimmed || undefined;
        const persisted = this.saveCredentials();
        console.log('[CredentialsManager] Groq STT API Key updated');
        return persisted;
    }

    public setOpenAiSttApiKey(key: string): boolean {
        const trimmed = (key || '').trim();
        this.credentials.openAiSttApiKey = trimmed || undefined;
        const persisted = this.saveCredentials();
        console.log('[CredentialsManager] OpenAI STT API Key updated');
        return persisted;
    }

    public setOpenAiSttBaseUrl(url: string): void {
        // Store undefined (not empty string) when clearing, so callers can fall back
        // to the default api.openai.com endpoint with a simple truthiness check.
        const trimmed = url.trim();
        this.credentials.openAiSttBaseUrl = trimmed || undefined;
        this.saveCredentials();
        console.log(`[CredentialsManager] OpenAI STT Base URL set to: ${trimmed || '(default)'}`);
    }

    public setGroqSttModel(model: string): void {
        this.credentials.groqSttModel = model;
        this.saveCredentials();
        console.log(`[CredentialsManager] Groq STT Model set to: ${model}`);
    }

    public setElevenLabsApiKey(key: string): boolean {
        const trimmed = (key || '').trim();
        this.credentials.elevenLabsApiKey = trimmed || undefined;
        const persisted = this.saveCredentials();
        console.log('[CredentialsManager] ElevenLabs API Key updated');
        return persisted;
    }

    public setAzureApiKey(key: string): boolean {
        const trimmed = (key || '').trim();
        this.credentials.azureApiKey = trimmed || undefined;
        const persisted = this.saveCredentials();
        console.log('[CredentialsManager] Azure API Key updated');
        return persisted;
    }

    public setAzureRegion(region: string): void {
        this.credentials.azureRegion = region;
        this.saveCredentials();
        console.log(`[CredentialsManager] Azure Region set to: ${region}`);
    }

    public setIbmWatsonApiKey(key: string): boolean {
        const trimmed = (key || '').trim();
        this.credentials.ibmWatsonApiKey = trimmed || undefined;
        const persisted = this.saveCredentials();
        console.log('[CredentialsManager] IBM Watson API Key updated');
        return persisted;
    }

    public setIbmWatsonRegion(region: string): void {
        this.credentials.ibmWatsonRegion = region;
        this.saveCredentials();
        console.log(`[CredentialsManager] IBM Watson Region set to: ${region}`);
    }

    public setSonioxApiKey(key: string): boolean {
        const trimmed = (key || '').trim();
        this.credentials.sonioxApiKey = trimmed || undefined;
        const persisted = this.saveCredentials();
        console.log('[CredentialsManager] Soniox API Key updated');
        return persisted;
    }

    public setTavilyApiKey(key: string): void {
        // Store undefined (not empty string) when removing, so hasKey() checks stay consistent
        this.credentials.tavilyApiKey = key.trim() || undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] Tavily API Key updated');
    }

    public setSttLanguage(language: string): void {
        this.credentials.sttLanguage = language;
        this.saveCredentials();
        console.log(`[CredentialsManager] STT Language set to: ${language}`);
    }

    /**
     * Dispatch the persisted STT key for a given provider. Used by the
     * `test-stt-connection` IPC when the renderer sends the `__USE_STORED__`
     * sentinel (e.g. post-restart, when the input field is empty but the key is
     * on disk). Returns `undefined` for unsupported providers or when no key is
     * stored — caller should branch on the result and surface a clean error to
     * the renderer.
     *
     * NEVER call from a code path that would round-trip the key back into
     * renderer state — the masked pre-population regression from #318 was
     * caused by exactly that pattern. This getter is test-time only.
     */
    public getStoredSttKeyForProvider(provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox'): string | undefined {
        switch (provider) {
            case 'groq':       return this.credentials.groqSttApiKey;
            case 'openai':     return this.credentials.openAiSttApiKey;
            case 'deepgram':   return this.credentials.deepgramApiKey;
            case 'elevenlabs': return this.credentials.elevenLabsApiKey;
            case 'azure':      return this.credentials.azureApiKey;
            case 'ibmwatson':  return this.credentials.ibmWatsonApiKey;
            case 'soniox':     return this.credentials.sonioxApiKey;
        }
    }

    public setAiResponseLanguage(language: string): void {
        this.credentials.aiResponseLanguage = language;
        this.saveCredentials();
        console.log(`[CredentialsManager] AI Response Language set to: ${language}`);
    }
    public setDefaultModel(model: string): void {
        this.credentials.defaultModel = model;
        this.saveCredentials();
        console.log(`[CredentialsManager] Default Model set to: ${model}`);
    }

    public setNativelyApiKey(key: string): void {
        const trimmed = key.trim();
        this.credentials.nativelyApiKey = trimmed || undefined;

        if (trimmed) {
            // Auto-promote natively to default model unless user already chose a non-Gemini/Groq model
            const current = this.credentials.defaultModel || '';
            const isAutoDefault = !current
                || current.startsWith('gemini-')
                || current.startsWith('llama-')
                || current.startsWith('mixtral-')
                || current.startsWith('gemma-')
                || current === 'gemini'
                || current === 'llama';
            if (isAutoDefault) {
                this.credentials.defaultModel = 'natively';
                console.log('[CredentialsManager] Auto-set default model to natively');
            }

            // Auto-promote natively STT if still on 'none' or the default Google STT
            if (!this.credentials.sttProvider || this.credentials.sttProvider === 'none' || this.credentials.sttProvider === 'google') {
                this.credentials.sttProvider = 'natively';
                console.log('[CredentialsManager] Auto-set STT provider to natively');
            }
        } else {
            // Key cleared — revert natively-auto-set defaults back to safe fallbacks
            if (this.credentials.defaultModel === 'natively') {
                this.credentials.defaultModel = 'gemini-3.1-flash-lite';
                console.log('[CredentialsManager] Natively key cleared — reset default model to Gemini Flash-Lite');
            }
            if (this.credentials.sttProvider === 'natively') {
                this.credentials.sttProvider = 'none';
                console.log('[CredentialsManager] Natively key cleared — reset STT provider to none');
            }
        }

        this.saveCredentials();
        console.log('[CredentialsManager] Natively API Key updated');
    }

    public getPreferredModel(provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek'): string | undefined {
        const key = `${provider}PreferredModel` as keyof StoredCredentials;
        return this.credentials[key] as string | undefined;
    }

    public setPreferredModel(provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', modelId: string): void {
        const key = `${provider}PreferredModel` as keyof StoredCredentials;
        (this.credentials as any)[key] = modelId;
        this.saveCredentials();
        console.log(`[CredentialsManager] ${provider} preferred model set to: ${modelId}`);
    }

    public saveCustomProvider(provider: CustomProvider): void {
        if (!this.credentials.customProviders) {
            this.credentials.customProviders = [];
        }
        // Check if exists, update if so
        const index = this.credentials.customProviders.findIndex(p => p.id === provider.id);
        if (index !== -1) {
            this.credentials.customProviders[index] = provider;
        } else {
            this.credentials.customProviders.push(provider);
        }
        this.saveCredentials();
        console.log(`[CredentialsManager] Custom Provider '${provider.name}' saved`);
    }

    public deleteCustomProvider(id: string): void {
        if (!this.credentials.customProviders) return;
        this.credentials.customProviders = this.credentials.customProviders.filter(p => p.id !== id);
        this.saveCredentials();
        console.log(`[CredentialsManager] Custom Provider '${id}' deleted`);
    }

    public getCurlProviders(): CurlProvider[] {
        return this.credentials.curlProviders || [];
    }

    public saveCurlProvider(provider: CurlProvider): void {
        if (!this.credentials.curlProviders) {
            this.credentials.curlProviders = [];
        }
        const index = this.credentials.curlProviders.findIndex(p => p.id === provider.id);
        if (index !== -1) {
            this.credentials.curlProviders[index] = provider;
        } else {
            this.credentials.curlProviders.push(provider);
        }
        this.saveCredentials();
        console.log(`[CredentialsManager] Curl Provider '${provider.name}' saved`);
    }

    public deleteCurlProvider(id: string): void {
        if (!this.credentials.curlProviders) return;
        this.credentials.curlProviders = this.credentials.curlProviders.filter(p => p.id !== id);
        this.saveCredentials();
        console.log(`[CredentialsManager] Curl Provider '${id}' deleted`);
    }

    // ── Free Trial ─────────────────────────────────────────────
    public getTrialToken(): string | undefined {
        return this.credentials.trialToken;
    }

    public getTrialExpiresAt(): string | undefined {
        return this.credentials.trialExpiresAt;
    }

    public getTrialStartedAt(): string | undefined {
        return this.credentials.trialStartedAt;
    }

    public getTrialClaimed(): boolean {
        return this.credentials.trialClaimed === true;
    }

    public setTrialToken(token: string, expiresAt: string, startedAt: string): void {
        this.credentials.trialToken = token;
        this.credentials.trialExpiresAt = expiresAt;
        this.credentials.trialStartedAt = startedAt;
        this.credentials.trialClaimed = true;
        this.saveCredentials();
        console.log('[CredentialsManager] Trial token stored, expires:', expiresAt);
    }

    public clearTrialToken(): void {
        delete this.credentials.trialToken;
        delete this.credentials.trialExpiresAt;
        delete this.credentials.trialStartedAt;
        // trialClaimed intentionally NOT cleared — keeps start card hidden after token wipe
        this.saveCredentials();
        console.log('[CredentialsManager] Trial token cleared');
    }

    public clearAll(): void {
        this.scrubMemory();
        if (fs.existsSync(CREDENTIALS_PATH)) {
            fs.unlinkSync(CREDENTIALS_PATH);
        }
        const plaintextPath = CREDENTIALS_PATH + '.json';
        if (fs.existsSync(plaintextPath)) {
            fs.unlinkSync(plaintextPath);
        }
        // App-managed fallback + its salt, and the cached derived key.
        this.removeFallbackFile();
        try {
            if (fs.existsSync(SALT_PATH)) fs.unlinkSync(SALT_PATH);
        } catch (err) {
            console.warn('[CredentialsManager] Could not remove device salt:', err);
        }
        this.fallbackKey = undefined;
        console.log('[CredentialsManager] All credentials cleared');
    }

    /**
     * Scrub all API keys from memory to minimize exposure window.
     * Called on app quit and credential clear.
     */
    public scrubMemory(): void {
        // Overwrite each string field with empty before discarding
        for (const key of Object.keys(this.credentials) as (keyof StoredCredentials)[]) {
            const val = this.credentials[key];
            if (typeof val === 'string') {
                (this.credentials as any)[key] = '';
            }
        }
        this.credentials = {};
        console.log('[CredentialsManager] Memory scrubbed');
    }

    // =========================================================================
    // Storage (Encrypted)
    // =========================================================================

    /**
     * True when credentials can actually be written to disk so they survive a
     * restart — via EITHER the OS keyring (safeStorage) OR the app-managed AES
     * fallback. The fallback only needs a writable userData dir, which is
     * effectively always true, so the only way this returns false is a genuinely
     * unwritable disk. Callers (the STT-key save handlers) use it to decide whether
     * to warn the user; with the fallback in place that warning is now rare.
     */
    public isPersistenceAvailable(): boolean {
        try {
            if (safeStorage.isEncryptionAvailable()) return true;
        } catch {
            // fall through to the fallback check
        }
        // Fallback path: usable as long as we can derive a key and write the file.
        try {
            return !!this.getFallbackKey();
        } catch {
            return false;
        }
    }

    /**
     * Load (or create) the per-install 32-byte random salt that anchors the
     * fallback key derivation. Stored as raw bytes at 0600. A fresh, random salt
     * per install is the ONLY machine/install-binding input — see getFallbackKey()
     * for why we deliberately avoid volatile attributes like hostname.
     *
     * Read errors are handled carefully: a *missing* salt (first run) creates one;
     * a *wrong-length* salt (truncated/corrupt, unrecoverable anyway) regenerates;
     * but a *transient* read error (EIO/EACCES on an existing file) FAILS CLOSED —
     * we must not regenerate a salt that would orphan a still-recoverable fallback.
     */
    private getOrCreateDeviceSalt(): Buffer {
        if (fs.existsSync(SALT_PATH)) {
            let existing: Buffer;
            try {
                existing = fs.readFileSync(SALT_PATH);
            } catch (err) {
                // The salt file exists but we couldn't read it right now. Regenerating
                // would permanently strand any existing encrypted fallback, so refuse.
                throw new Error(`device salt exists but is unreadable (transient): ${(err as Error)?.message || err}`);
            }
            if (existing.length === 32) return existing;
            console.warn('[CredentialsManager] Device salt has wrong length; regenerating (existing fallback, if any, becomes unrecoverable)');
            // fall through to regenerate
        }
        const salt = crypto.randomBytes(32);
        const tmp = SALT_PATH + '.tmp';
        fs.writeFileSync(tmp, salt, { mode: 0o600 });
        fs.renameSync(tmp, SALT_PATH);
        return salt;
    }

    /**
     * Derive (once) and memoize the AES key for the app-managed fallback.
     *
     * Key-material composition:
     *   - Stable domain/version tag (`'natively-credential-fallback-v1'`) so a
     *     future KDF migration can rotate without colliding with old keys.
     *   - The per-install RANDOM 32-byte salt from SALT_PATH — this is the SOLE
     *     machine/install binding. It never leaves this box and differs per
     *     install, so a copied or cloud-synced fallback file is still useless
     *     elsewhere.
     *
     * Deliberately omitted (would only add fragility):
     *   - `process.platform` — is a constant on a given machine; adds no
     *     entropy. Including it would risk breaking the fallback if Electron's
     *     platform reporting ever drifts (e.g. Linux container reporting a
     *     different `process.platform` than the host).
     *   - `os.hostname()` — flips with Wi-Fi/DHCP/mDNS `.lan`↔`.local` and
     *     machine renames. Would silently orphan the fallback on a rename.
     *   - `os.userInfo().username` — can change with admin/SSH contexts.
     *   - `app.getPath('userData')` — moves when the disguise feature calls
     *     `app.setName()`.
     */
    private getFallbackKey(): Buffer {
        if (this.fallbackKey) return this.fallbackKey;
        const salt = this.getOrCreateDeviceSalt();
        const materialParts = [
            'natively-credential-fallback-v1', // stable domain/version tag
        ];
        this.fallbackKey = deriveFallbackKey(materialParts, salt);
        return this.fallbackKey;
    }

    /**
     * Persist the in-memory credentials. Prefers the OS keyring (safeStorage); when
     * that is unavailable, falls back to an app-managed AES-256-GCM file so keys
     * still survive a restart (the fix for "STT keys reset to none"). Returns true
     * when the write reached disk by either path, false only when even the fallback
     * write threw (a genuinely unwritable disk) — or when an empty-state save is
     * refused to avoid clobbering an undecryptable store (issue #322).
     *
     * Public so tests / recovery tooling can exercise the clobber guard directly.
     */
    public saveCredentials(): boolean {
        const isEmpty = Object.keys(this.credentials).length === 0;

        // Issue #322 clobber guard: a session that failed to decrypt the on-disk
        // store must never overwrite that file with encrypted "{}". The undecryptable
        // ciphertext may become readable again on a later launch (transient keychain
        // lock / ACL prompt); destroying it makes the loss permanent.
        if (this.existingStoreUnreadable && isEmpty) {
            console.warn('[CredentialsManager] Refusing to clobber undecryptable on-disk store with empty credentials (issue #322)');
            return false;
        }

        // Greptile P1: after an undecryptable launch with nothing readable loaded,
        // in-memory credentials are empty or a sparse re-entry of one provider.
        // Writing that set to the keyring (or a fallback that later wins via mtime)
        // permanently destroys every other key still sitting in the undecryptable
        // ciphertext. Refuse until we recovered a full readable store this session;
        // permanent re-entry may stage into the fallback ONLY (keyring preserved).
        if (this.existingStoreUnreadable && !this.recoveredFromReadableStore) {
            if (!this.credentialReentryNeeded) {
                console.warn(
                    '[CredentialsManager] Refusing to persist sparse credentials over an undecryptable store (issue #322 / Greptile P1)',
                );
                return false;
            }
            return this.persistFallbackOnlyPreservingKeyring(isEmpty);
        }

        // Try the OS keyring first. When safeStorage is available, this is the
        // preferred path. On Windows the underlying DPAPI can still throw after
        // isEncryptionAvailable() returns true (e.g. policy restrictions, roaming
        // profiles) — we must catch that and fall through to the app-managed
        // fallback instead of returning false, otherwise keys are silently lost
        // on restart (the bug reported for Deepgram and other STT keys).
        try {
            if (safeStorage.isEncryptionAvailable()) {
                const data = JSON.stringify(this.credentials);
                const encrypted = safeStorage.encryptString(data);
                const tmpEnc = CREDENTIALS_PATH + '.tmp';
                fs.writeFileSync(tmpEnc, encrypted);
                fs.renameSync(tmpEnc, CREDENTIALS_PATH);
                // Verified-healed gate (issue #322): only drop the fallback after a
                // COLD-START decrypt proves the keyring readable. A recovery re-key
                // / migrate-up during an unreadable session must keep the fallback
                // as a safety net — encrypt can succeed while decrypt of the prior
                // item is still broken.
                if (!this.existingStoreUnreadable) {
                    this.removeFallbackFile();
                } else {
                    console.warn('[CredentialsManager] Recovery keyring write: preserving fallback until a cold-start decrypt proves the keyring readable (issue #322)');
                }
                if (!isEmpty) {
                    this.clearDecryptFailSidecar();
                }
                return true;
            }
        } catch (keyringErr) {
            // Keyring write failed — don't give up yet. Try the fallback below.
            // Whitelist `message` only: on Windows, DPAPI exceptions can include
            // user SIDs and profile paths, which we don't want in any downstream
            // log scraper.
            console.warn('[CredentialsManager] Keyring save failed, trying app-managed fallback:', (keyringErr as Error)?.message ?? String(keyringErr));
        }

        // OS keyring unavailable or threw — use the app-managed encrypted fallback so the
        // key is not silently lost on restart. Weaker than the keyring (see
        // credentialFallbackCrypto.ts) but never plaintext at rest.
        try {
            const blob = encryptCredentialBlob(JSON.stringify(this.credentials), this.getFallbackKey());
            const tmpFb = FALLBACK_PATH + '.tmp';
            fs.writeFileSync(tmpFb, blob, { mode: 0o600 });
            fs.renameSync(tmpFb, FALLBACK_PATH);
            // Normal path: drop the stale keyring so it cannot win over the fresh
            // fallback on next load. Unreadable-store path: KEEP the keyring file —
            // it may still hold recoverable ciphertext for a later launch.
            if (!this.existingStoreUnreadable) {
                this.removeKeyringFile();
            } else {
                console.warn('[CredentialsManager] Recovery fallback write: preserving undecryptable keyring file (issue #322)');
            }
            console.warn('[CredentialsManager] OS keyring unavailable; saved via app-managed encrypted fallback (machine-bound, will survive restart)');
            if (!isEmpty) {
                this.clearDecryptFailSidecar();
            }
            return true;
        } catch (error) {
            console.error('[CredentialsManager] Failed to save credentials:', (error as Error)?.message ?? String(error));
            return false;
        }
    }

    /**
     * Permanent re-entry path (#322 / Greptile P1): stage credentials into the
     * app-managed fallback while leaving the undecryptable keyring file untouched
     * so a later heal can still recover sibling keys. Callers must only use this
     * when `needsCredentialReentry()` is true and nothing readable was loaded.
     */
    private persistFallbackOnlyPreservingKeyring(isEmpty: boolean): boolean {
        try {
            const blob = encryptCredentialBlob(JSON.stringify(this.credentials), this.getFallbackKey());
            const tmpFb = FALLBACK_PATH + '.tmp';
            fs.writeFileSync(tmpFb, blob, { mode: 0o600 });
            fs.renameSync(tmpFb, FALLBACK_PATH);
            console.warn(
                '[CredentialsManager] Permanent re-entry: staged credentials to fallback only; preserving undecryptable keyring (issue #322 / Greptile P1)',
            );
            if (!isEmpty) {
                this.clearDecryptFailSidecar();
            }
            return true;
        } catch (error) {
            console.error(
                '[CredentialsManager] Failed to stage re-entry credentials to fallback:',
                (error as Error)?.message ?? String(error),
            );
            return false;
        }
    }

    /**
     * Merge `overlay` into `base`. Non-empty overlay string/object fields win;
     * empty/missing overlay fields keep the base value. Used when a healed
     * keyring load coexists with a newer fallback that may hold re-entered keys.
     */
    private mergeCredentials(
        base: StoredCredentials,
        overlay: StoredCredentials,
    ): StoredCredentials {
        const merged: StoredCredentials = { ...base };
        for (const key of Object.keys(overlay) as (keyof StoredCredentials)[]) {
            const next = overlay[key];
            if (next === undefined || next === null) continue;
            if (typeof next === 'string' && next.length === 0) continue;
            (merged as any)[key] = next;
        }
        return merged;
    }

    /** Increment the decrypt-fail sidecar; escalate to re-entry at the threshold. */
    private recordDecryptFailure(): void {
        let count = 0;
        try {
            if (fs.existsSync(DECRYPT_FAIL_PATH)) {
                const parsed = JSON.parse(fs.readFileSync(DECRYPT_FAIL_PATH, 'utf8'));
                count = Number(parsed?.count) || 0;
            }
        } catch {
            count = 0;
        }
        count += 1;
        try {
            fs.writeFileSync(
                DECRYPT_FAIL_PATH,
                JSON.stringify({ count, lastAt: new Date().toISOString() }),
                { mode: 0o600 },
            );
        } catch (err) {
            console.warn('[CredentialsManager] Could not write decrypt-fail sidecar:', err);
        }
        this.credentialReentryNeeded = count >= DECRYPT_FAIL_THRESHOLD;
        console.warn(`[CredentialsManager] Keyring decrypt failure ${count}/${DECRYPT_FAIL_THRESHOLD}` +
            (this.credentialReentryNeeded ? ' — credential re-entry required' : ''));
    }

    /** Clear the decrypt-fail sidecar and the re-entry banner flag. */
    private clearDecryptFailSidecar(): void {
        this.credentialReentryNeeded = false;
        try {
            if (fs.existsSync(DECRYPT_FAIL_PATH)) {
                fs.unlinkSync(DECRYPT_FAIL_PATH);
            }
        } catch (err) {
            console.warn('[CredentialsManager] Could not remove decrypt-fail sidecar:', err);
        }
    }

    /** Remove the app-managed fallback file (best-effort). */
    private removeFallbackFile(): void {
        try {
            if (fs.existsSync(FALLBACK_PATH)) {
                fs.unlinkSync(FALLBACK_PATH);
            }
        } catch (err) {
            console.warn('[CredentialsManager] Could not remove fallback credential file:', err);
        }
    }

    /**
     * Remove the stale OS keyring credential file (best-effort).
     * Called when the keyring write failed and we fell back to the app-managed
     * fallback — the old keyring file contains stale credentials and would
     * be treated as authoritative by loadCredentials() on next startup,
     * silently discarding the just-saved keys.
     */
    private removeKeyringFile(): void {
        try {
            if (fs.existsSync(CREDENTIALS_PATH)) {
                fs.unlinkSync(CREDENTIALS_PATH);
                console.log('[CredentialsManager] Removed keyring credential file');
            }
        } catch (err) {
            console.warn('[CredentialsManager] Could not remove keyring credential file:', err);
        }
    }

    /** Remove any leftover legacy plaintext credential file (security invariant). */
    private removePlaintextFile(): void {
        const plaintextPath = CREDENTIALS_PATH + '.json';
        if (fs.existsSync(plaintextPath)) {
            try {
                fs.unlinkSync(plaintextPath);
                console.log('[CredentialsManager] Removed plaintext credential file');
            } catch (cleanupErr) {
                console.warn('[CredentialsManager] Could not remove plaintext credential file:', cleanupErr);
            }
        }
    }

    private loadCredentials(): void {
        try {
            // 1) Try the OS keyring file when available.
            //    IMPORTANT (Greptile P1 / #322): never delete the keyring before
            //    attempting decrypt solely because a newer fallback exists. A
            //    sparse re-entry staged to fallback must not destroy still-
            //    recoverable ciphertext. Prefer: decrypt keyring → if success
            //    and a newer fallback also decrypts, merge (fallback wins on
            //    non-empty fields) → only then drop the redundant file.
            if (fs.existsSync(CREDENTIALS_PATH)) {
                let keyringAvailable = false;
                try { keyringAvailable = safeStorage.isEncryptionAvailable(); } catch { keyringAvailable = false; }

                if (keyringAvailable && fs.existsSync(CREDENTIALS_PATH)) {
                    // Issue #322: decryptString MUST be in its own try/catch. A throw
                    // used to hit the outer catch, set credentials={}, skip the
                    // fallback entirely, and let a later empty save permanently
                    // destroy the still-recoverable keyring file.
                    let decrypted: string | null = null;
                    try {
                        const encrypted = fs.readFileSync(CREDENTIALS_PATH);
                        decrypted = safeStorage.decryptString(encrypted);
                    } catch (decryptErr) {
                        console.error(
                            '[CredentialsManager] Keyring decrypt failed — preserving on-disk store and trying fallback:',
                            (decryptErr as Error)?.message ?? String(decryptErr),
                        );
                        this.existingStoreUnreadable = true;
                        this.recordDecryptFailure();
                    }

                    if (decrypted !== null) {
                        try {
                            const parsed = JSON.parse(decrypted);
                            if (typeof parsed === 'object' && parsed !== null) {
                                let loaded = parsed as StoredCredentials;
                                // Healed keyring + newer fallback (e.g. permanent
                                // re-entry staged during the outage): merge so
                                // sibling keys from the keyring survive and
                                // re-entered fields from the fallback win.
                                const fallbackOverlay = this.tryReadFallbackCredentials();
                                if (fallbackOverlay) {
                                    let preferFallback = false;
                                    try {
                                        preferFallback =
                                            fs.statSync(FALLBACK_PATH).mtimeMs >
                                            fs.statSync(CREDENTIALS_PATH).mtimeMs;
                                    } catch {
                                        preferFallback = true;
                                    }
                                    if (preferFallback) {
                                        console.warn(
                                            '[CredentialsManager] Merging newer fallback into healed keyring (issue #322 / Greptile P1)',
                                        );
                                        loaded = this.mergeCredentials(loaded, fallbackOverlay);
                                    }
                                }
                                this.credentials = loaded;
                                this.recoveredFromReadableStore = true;
                                this.existingStoreUnreadable = false;
                                this.clearDecryptFailSidecar();
                                // Verified-healed: cold-start decrypt proved the keyring.
                                // Persist merge (if any) then drop the fallback safety net.
                                if (fallbackOverlay) {
                                    if (this.saveCredentials()) {
                                        this.removeFallbackFile();
                                    } else {
                                        console.warn(
                                            '[CredentialsManager] Merge persist failed — keeping fallback safety net',
                                        );
                                    }
                                } else {
                                    this.removeFallbackFile();
                                }
                                this.removePlaintextFile();
                                console.log('[CredentialsManager] Loaded encrypted credentials');
                                return;
                            }
                            throw new Error('Decrypted credentials is not a valid object');
                        } catch (parseError) {
                            console.error('[CredentialsManager] Failed to parse decrypted credentials — trying fallback:', parseError);
                            // Leave the keyring file alone; fall through to fallback.
                        }
                    }
                } else if (!keyringAvailable) {
                    // Keyring file exists but keyring is unavailable: fall through to try
                    // the app-managed fallback below (we cannot decrypt the keyring file).
                    console.warn('[CredentialsManager] Encrypted credentials present but keyring unavailable; trying app-managed fallback');
                }
            }

            // 2) App-managed encrypted fallback.
            if (fs.existsSync(FALLBACK_PATH)) {
                try {
                    const blob = fs.readFileSync(FALLBACK_PATH);
                    const decrypted = decryptCredentialBlob(blob, this.getFallbackKey());
                    const parsed = JSON.parse(decrypted);
                    if (typeof parsed === 'object' && parsed !== null) {
                        this.credentials = parsed;
                        this.recoveredFromReadableStore = true;
                        console.log('[CredentialsManager] Loaded credentials from app-managed fallback');
                    } else {
                        throw new Error('Fallback credentials is not a valid object');
                    }
                } catch (fbErr) {
                    console.error('[CredentialsManager] Failed to read app-managed fallback — starting fresh:', fbErr);
                    this.credentials = {};
                }

                // Migrate up: if the keyring is now available, re-persist via safeStorage.
                // When this launch also had an undecryptable keyring file, saveCredentials
                // preserves the fallback until a later cold-start decrypt proves healed.
                // When nothing was recovered (empty after fallback parse fail), skip.
                let keyringNow = false;
                try { keyringNow = safeStorage.isEncryptionAvailable(); } catch { keyringNow = false; }
                if (keyringNow && Object.keys(this.credentials).length > 0 && this.recoveredFromReadableStore) {
                    console.log('[CredentialsManager] Keyring now available — migrating fallback credentials to keyring');
                    this.saveCredentials();
                }
                this.removePlaintextFile();
                return;
            }

            // 3) Nothing readable. If we had an undecryptable keyring file, leave
            //    credentials empty but DO NOT delete that file — a later launch may
            //    decrypt it again.
            this.removePlaintextFile();
            if (this.existingStoreUnreadable) {
                console.warn('[CredentialsManager] Existing keyring store is unreadable and no fallback is available');
            } else {
                console.log('[CredentialsManager] No stored credentials found');
            }
        } catch (error) {
            console.error('[CredentialsManager] Failed to load credentials:', error);
            this.credentials = {};
        }
    }

    /** Best-effort read of the app-managed fallback; null if missing/unreadable. */
    private tryReadFallbackCredentials(): StoredCredentials | null {
        if (!fs.existsSync(FALLBACK_PATH)) return null;
        try {
            const blob = fs.readFileSync(FALLBACK_PATH);
            const decrypted = decryptCredentialBlob(blob, this.getFallbackKey());
            const parsed = JSON.parse(decrypted);
            if (typeof parsed === 'object' && parsed !== null) {
                return parsed as StoredCredentials;
            }
        } catch {
            // ignore — caller keeps keyring-only load
        }
        return null;
    }
}

/**
 * Sentinel string the renderer sends when the input field is empty post-restart
 * (the #318 fix intentionally does NOT pre-populate masked values) but the key
 * IS on disk. Resolved at call time in main — the raw key never round-trips
 * back into renderer state, so the masked-key regression cannot recur.
 *
 * Centralized here so the renderer can `require` it from the SAME module that
 * resolves it (ipcHandlers.ts) without duplicating the magic string in two
 * places. The renderer pulls the value via preload.ts if needed in the future;
 * for now both sides hard-code the literal and a source-text guard test pins
 * them against drift.
 */
export const USE_STORED_KEY_SENTINEL = '__USE_STORED__';

/**
 * Resolve an STT API key coming from the renderer side, applying the
 * `__USE_STORED__` sentinel → persisted-key substitution and validating that
 * the result is non-empty.
 *
 * Return shape is the IPC contract used by `test-stt-connection`:
 *   - `{ ok: true,  apiKey }`       → caller should use `apiKey` against the provider
 *   - `{ ok: false, error }`       → caller should return this directly to the renderer
 *
 * Pure function (no I/O), so it is unit-testable without spinning up Electron.
 * Refactored out of the inline handler in ipcHandlers.ts to make the sentinel
 * resolution contract independently verifiable (M-1 from the pre-release review).
 */
export function resolveSttTestKey(
    provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox',
    apiKey: string | undefined | null,
): { ok: true; apiKey: string } | { ok: false; error: string } {
    if (apiKey === USE_STORED_KEY_SENTINEL) {
        const stored = CredentialsManager.getInstance().getStoredSttKeyForProvider(provider);
        if (!stored || !stored.trim()) {
            return {
                ok: false,
                error: 'No API key saved for this provider. Please add one in Settings.',
            };
        }
        apiKey = stored;
    }
    if (!apiKey || !apiKey.trim()) {
        return { ok: false, error: 'No API key provided.' };
    }
    return { ok: true, apiKey: apiKey.trim() };
}
