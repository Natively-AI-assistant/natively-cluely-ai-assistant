import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export interface AppSettings {
    // Only boot-critical or non-encrypted settings should live here.
    // In the future, other non-secret data like 'language' or 'theme'
    // can be moved here from CredentialsManager to allow early boot access.
    isUndetectable?: boolean;
    disguiseMode?: 'terminal' | 'settings' | 'activity' | 'none';
    verboseLogging?: boolean;
    actionButtonMode?: 'recap' | 'brainstorm';
    groqFastTextMode?: boolean;
    codexCliEnabled?: boolean;
    codexCliPath?: string;
    codexCliModel?: string;
    codexCliFastModel?: string;
    codexCliTimeoutMs?: number;
    codexCliSandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
    codexCliServiceTier?: 'default' | 'fast' | 'flex';
    // Valid values mirror CodexCliService.resolveCodexReasoningEffort — the union
    // is permissive (the per-model VALID set is enforced at runtime so e.g.
    // xhigh on gpt-5.3-codex is silently downgraded). 'none' means "don't pass
    // -c model_reasoning_effort at all" — distinct from omitting the setting.
    codexCliModelReasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
    // Hindsight long-term memory server (optional, user-provisioned sidecar — Cloud OR
    // local). baseUrl empty by default → feature off. Env (HINDSIGHT_BASE_URL) overrides
    // these for dev. apiKey only for Hindsight Cloud. autoStart/serverCommand reserved for
    // the deferred auto-spawn follow-up (auto-start-when-installed, like Ollama).
    hindsightBaseUrl?: string;
    hindsightApiKey?: string;
    hindsightAutoStart?: boolean;
    hindsightServerCommand?: string;
    hindsightLlmProvider?: string;
    // Explicit opt-out sentinel for "I do not want Hindsight at all". Distinct from
    // "hindsightBaseUrl is empty" — that condition means "user hasn't configured yet"
    // (synthetic default applies). `true` here means "user has actively disabled Hindsight"
    // and getHindsightConfig() must return null. Set via the `hindsight:disable` IPC; the
    // renderer offers a "Don't use Hindsight" link in the setup card.
    hindsightExplicitlyDisabled?: boolean;
    // Persisted override for the `hindsightMemory` intelligence flag (see
    // electron/intelligence/intelligenceFlags.ts). HindsightManager.start() flips this ON
    // when the user has a baseUrl configured + autoStart on, so the `memoryFlagOn()` gate
    // inside start() doesn't early-return on the flag's default-OFF registry value. The
    // flag's setting key in the registry is `hindsightMemoryEnabled` — keep them aligned.
    hindsightMemoryEnabled?: boolean;
    // True when the user has explicitly set the hindsightMemory flag to a non-default
    // value. Distinguishes "default OFF, user hasn't touched it" from "user explicitly
    // set OFF" — without this, the auto-flip on every Settings save would silently
    // re-enable a flag the user intentionally disabled. Written by `setIntelligenceFlag`
    // whenever value !== registry default. NAME MUST MATCH the runtime key: the registry
    // setting is `hindsightMemoryEnabled`, so the explicit sibling is
    // `<setting>Explicit` = `hindsightMemoryEnabledExplicit` (read by
    // HindsightManager.hindsightMemoryExplicitlyOff()).
    hindsightMemoryEnabledExplicit?: boolean;
    knowledgeMode?: boolean;
    phoneMirrorEnabled?: boolean;
    phoneMirrorExposeOnLan?: boolean;
    // ── Smart Browser Context v2 ───────────────────────────────────────────
    // Manual browser capture is always available (no flag). These control the
    // AUTOMATIC behaviour. Defaults (read at the use sites): coding auto-detect
    // and auto-attach default ON (high-confidence coding only); the AI metadata
    // classifier is OFF (opt-in); job-desc/dev-docs auto-detect OFF. Sensitive
    // categories (email/chat/banking/auth) are ALWAYS blocked — there is no
    // setting to disable that floor.
    browserAutoDetectCoding?: boolean;        // default true
    browserAutoAttachCoding?: boolean;        // default true
    browserAskBeforeUnknown?: boolean;        // default true
    browserAiClassifierEnabled?: boolean;     // default false (opt-in)
    browserAutoDetectJobDescriptions?: boolean; // default false
    browserAutoDetectDeveloperDocs?: boolean; // default false
    // EXPERIMENTAL: when true, the auto-capture path attaches the FULL page
    // content (readable text) for ANY non-sensitive page — not just coding — and
    // lets the answer model pick what it needs. Default false. Sensitive pages
    // (email/chat/banking/auth) are STILL hard-blocked; this only relaxes the
    // coding-only / high-confidence-only gate, never the sensitive floor.
    browserExperimentalFullPageCapture?: boolean; // default false (experimental)
    localWhisperModel?: string;
    // Per-channel model overrides for local Whisper. When
    // localWhisperPerChannelEnabled is true, the two LocalWhisperSTT instances
    // pick their own model (mic / system) instead of sharing localWhisperModel.
    // Use case: tiny model for the user's own voice (predictable, fast) + a
    // larger one for system audio (varied accents / jargon).
    localWhisperPerChannelEnabled?: boolean;
    localWhisperModelMic?: string;
    localWhisperModelSystem?: string;
    // Phase 6 — TelemetryService toggle. Defaults to true (local-only JSONL).
    // When false, no telemetry is written to disk and no sinks fire.
    telemetryEnabled?: boolean;
    // Phase 9 — privacy/retention controls. Foundation only. Encryption is
    // documented in docs/engineering/LOCAL_DB_ENCRYPTION_DESIGN.md.
    // 'forever' (default), '7d', '30d', or 'never' (do not store transcripts).
    meetingRetention?: 'forever' | '7d' | '30d' | 'never';
    providerDataScopes?: {
        transcript?: boolean;
        screenshots?: boolean;
        reference_files?: boolean;
        profile_history?: boolean;
        embeddings?: boolean;
        post_call_summary?: boolean;
        // Verified code execution: when false, the model's code is NOT sent to
        // the cloud (Piston) runner for languages we can't run locally. Default
        // allowed; only the cloud path consults this (local py/js never sends).
        code_execution?: boolean;
    };
    // Kill-switch for verified code execution (running model code against test
    // cases in a sandbox after the answer). Default ON; set false to disable at
    // runtime without a redeploy. Also overridable by env NATIVELY_CODE_VERIFY=off.
    codeVerificationEnabled?: boolean;
    // Screen-understanding routing — VISION-ONLY architecture (legacy OCR removed from runtime).
    //   vision_first   — Default. Send screenshot to the first available vision-capable provider; cascade through fallback chain on failure.
    //   vision_only    — Stricter: require vision-capable provider. No text-only provider fallback. No OCR fallback.
    //   private_vision — Local vision only (Ollama image-capable / Codex local / approved local custom). Never call cloud vision. Hard error if no local vision provider available.
    screenUnderstandingMode?: 'vision_first' | 'vision_only' | 'private_vision';
    // When true (default) and the active mode is a technical / coding interview, prefer
    // direct vision LLM over structured-extract-then-answer for lowest latency.
    technicalInterviewVisionFirst?: boolean;
    // Onboarding and gate flags for persistent settings backup
    seenStartup?: boolean;
    seenProfileOnboarding?: boolean;
    seenModesOnboarding?: boolean;
    permsShown?: boolean;
    // Live SessionMemory rollout controls (release 2026-06-07c). Env vars take
    // precedence; these let the rollout be driven from settings without a redeploy.
    enableLiveSessionMemory?: boolean;
    liveSessionMemoryKillSwitch?: boolean;
    liveSessionMemoryRolloutPercent?: number;

    // ── Regional STT relay (Phase 7/8) ─────────────────────────────────────
    // Master switch. When false (DEFAULT), NativelyProSTT behaves byte-for-byte
    // identical to today: it never calls /v1/stt/session and connects directly
    // to the hardcoded Railway WS with the legacy auth frame.
    regionalSttRelayEnabled?: boolean;
    // Client-side rollout gate (0–100). enabled = regionalSttRelayEnabled &&
    // (hash(apiKey) % 100) < regionalSttRelayPercent. PRECEDENCE: if percent is 0
    // but regionalSttRelayEnabled is true, Enabled acts as an explicit override
    // (treated as 100%) — a developer flipping the master switch always gets the
    // relay regardless of the rollout dial. See isRegionalSttRelayEnabledForKey().
    regionalSttRelayPercent?: number;
    // Forced region hint passed to session-create as region_hint. null → let the
    // control plane decide (geo/latency).
    forceSttRelayRegion?: 'us' | 'asia' | null;
    // When false, do NOT append the Railway URL to the fallback chain (lets QA
    // test relays in isolation). DEFAULT true so production always has the net.
    sttRailwayFallbackEnabled?: boolean;
    // Client-side caps echoed into the session-create request. The server is
    // still authoritative (it re-clamps), these are advisory ceilings.
    sttMaxSampleRate?: number;
    sttMaxChannels?: number;
    sttAllowDualStream?: boolean;
}

export const VALID_SCREEN_UNDERSTANDING_MODES = ['vision_first', 'vision_only', 'private_vision'] as const;
export type ScreenUnderstandingMode = typeof VALID_SCREEN_UNDERSTANDING_MODES[number];

// LEGACY values kept ONLY for migration of existing settings.json files written by older builds.
// New code MUST NOT branch on these — they are normalized to a VALID_SCREEN_UNDERSTANDING_MODES value on load.
const LEGACY_SCREEN_MODE_MIGRATION: Record<string, ScreenUnderstandingMode> = {
    auto: 'vision_first',
    balanced: 'vision_first',
    best: 'vision_first',
    fast: 'vision_first',
    ocr_only: 'vision_first',
    private: 'private_vision',
};

/**
 * Stable FNV-1a 32-bit bucket in [0,99] for a string. Used by the client-side
 * STT relay rollout gate so the same key deterministically lands in the same
 * bucket. Mirrors the server's deterministic-rollout intent (docs/01 §8): the
 * exact hash function need not match the server's (the server gates by key-id,
 * the client by key string) — what matters is stability per key on THIS side so
 * a given install's relay decision doesn't flap.
 */
export function fnv1aBucket(input: string): number {
    let h = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        // 32-bit FNV prime multiply via shifts (avoids float precision loss).
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h % 100;
}

export class SettingsManager {
    private static instance: SettingsManager;
    private settings: AppSettings = {};
    private settingsPath: string;

    private constructor() {
        if (!app.isReady()) {
            throw new Error('[SettingsManager] Cannot initialize before app.whenReady()');
        }
        this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
        this.loadSettings();
    }

    public static getInstance(): SettingsManager {
        if (!SettingsManager.instance) {
            SettingsManager.instance = new SettingsManager();
        }
        return SettingsManager.instance;
    }

    public get<K extends keyof AppSettings>(key: K): AppSettings[K] {
        return this.settings[key];
    }

    public set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
        this.settings[key] = value;
        this.saveSettings();
    }

    // Resolved screen-understanding mode with default and runtime validation.
    // Use this instead of get('screenUnderstandingMode') from callers so the default applies consistently.
    public getScreenUnderstandingMode(): ScreenUnderstandingMode {
        const stored = this.settings.screenUnderstandingMode;
        if (stored && (VALID_SCREEN_UNDERSTANDING_MODES as readonly string[]).includes(stored)) {
            return stored;
        }
        return 'vision_first';
    }

    public setScreenUnderstandingMode(mode: ScreenUnderstandingMode): void {
        if (!(VALID_SCREEN_UNDERSTANDING_MODES as readonly string[]).includes(mode)) {
            throw new Error(`[SettingsManager] Invalid screenUnderstandingMode: ${mode}`);
        }
        this.settings.screenUnderstandingMode = mode;
        this.saveSettings();
    }

    public getTechnicalInterviewVisionFirst(): boolean {
        return this.settings.technicalInterviewVisionFirst !== false;
    }

    // ── Smart Browser Context v2 — resolved settings (single default source) ──
    // Manual capture is always on (not represented here). These resolve the
    // documented defaults so callers never repeat them. Sensitive blocking is a
    // hard floor in the policy engine and is intentionally NOT a setting.
    public getBrowserContextSettings(): {
        autoDetectCoding: boolean;
        autoAttachCoding: boolean;
        askBeforeUnknown: boolean;
        aiClassifierEnabled: boolean;
        autoDetectJobDescriptions: boolean;
        autoDetectDeveloperDocs: boolean;
        experimentalFullPageCapture: boolean;
    } {
        const s = this.settings;
        return {
            autoDetectCoding: s.browserAutoDetectCoding !== false, // default true
            autoAttachCoding: s.browserAutoAttachCoding !== false, // default true
            askBeforeUnknown: s.browserAskBeforeUnknown !== false, // default true
            aiClassifierEnabled: s.browserAiClassifierEnabled === true, // default false (opt-in)
            autoDetectJobDescriptions: s.browserAutoDetectJobDescriptions === true, // default false
            autoDetectDeveloperDocs: s.browserAutoDetectDeveloperDocs === true, // default false
            experimentalFullPageCapture: s.browserExperimentalFullPageCapture === true, // default false (experimental)
        };
    }

    // ── Regional STT relay (Phase 7/8) typed accessors ─────────────────────
    // These apply the documented defaults consistently so callers never have to
    // remember them. The class is the single source of truth for the relay flag
    // defaults; NativelyProSTT reads through these.

    public getRegionalSttRelayEnabled(): boolean {
        return this.settings.regionalSttRelayEnabled === true; // default false
    }

    public getRegionalSttRelayPercent(): number {
        const raw = this.settings.regionalSttRelayPercent;
        if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0; // default 0
        return Math.max(0, Math.min(100, Math.floor(raw)));
    }

    public getForceSttRelayRegion(): 'us' | 'asia' | null {
        const raw = this.settings.forceSttRelayRegion;
        return raw === 'us' || raw === 'asia' ? raw : null; // default null
    }

    public getSttRailwayFallbackEnabled(): boolean {
        return this.settings.sttRailwayFallbackEnabled !== false; // default true
    }

    public getSttMaxSampleRate(): number {
        const raw = this.settings.sttMaxSampleRate;
        return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 16000; // default 16000
    }

    public getSttMaxChannels(): number {
        const raw = this.settings.sttMaxChannels;
        return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1; // default 1
    }

    public getSttAllowDualStream(): boolean {
        return this.settings.sttAllowDualStream === true; // default false
    }

    /**
     * Deterministic client-side rollout gate for the regional STT relay.
     *
     * PRECEDENCE (documented):
     *   - Master OFF (regionalSttRelayEnabled !== true)  → always false.
     *   - Master ON + percent <= 0                       → true (override = 100%).
     *     Rationale: a developer/dogfooder who flips the master switch with no
     *     rollout dial set expects the relay ON, not silently gated to nothing.
     *   - Master ON + percent >= 100                     → true.
     *   - Master ON + 0 < percent < 100                  → (hash(key) % 100) < percent.
     *
     * The hash is a stable FNV-1a over the key string, so the same key always
     * lands in the same bucket; raising the percent only ever adds keys
     * (monotonic) — mirroring the server's rollout semantics (docs/01 §8).
     */
    public isRegionalSttRelayEnabledForKey(apiKey: string | undefined | null): boolean {
        if (!this.getRegionalSttRelayEnabled()) return false;
        const percent = this.getRegionalSttRelayPercent();
        if (percent <= 0) return true;   // Enabled-as-override
        if (percent >= 100) return true;
        const bucket = fnv1aBucket(apiKey ?? '');
        return bucket < percent;
    }

    private loadSettings(): void {
        try {
            if (fs.existsSync(this.settingsPath)) {
                const data = fs.readFileSync(this.settingsPath, 'utf8');
                try {
                    const parsed = JSON.parse(data);
                    // Minimal validation to ensure it's an object before assigning
                    if (typeof parsed === 'object' && parsed !== null) {
                        this.settings = parsed;
                        this.migrateLegacySettings();
                        console.log('[SettingsManager] Settings loaded successfully', { keys: Object.keys(this.settings).length });
                    } else {
                        throw new Error('Settings JSON is not a valid object');
                    }
                } catch (parseError) {
                    console.error('[SettingsManager] Failed to parse settings.json. Continuing with empty settings. Error:', parseError);
                    this.settings = {};
                }
                console.log('[SettingsManager] Settings loaded');
            }
        } catch (e) {
            console.error('[SettingsManager] Failed to read settings file:', e);
            this.settings = {};
        }
    }

    // Normalize legacy screen-understanding mode values written by older builds.
    // Runs once on load; rewrites settings.json if any migration was applied.
    private migrateLegacySettings(): void {
        const raw = this.settings.screenUnderstandingMode as unknown as string | undefined;
        if (!raw) return;
        if ((VALID_SCREEN_UNDERSTANDING_MODES as readonly string[]).includes(raw)) return;
        const migrated = LEGACY_SCREEN_MODE_MIGRATION[raw];
        if (migrated) {
            console.warn(`[SettingsManager] Migrating legacy screenUnderstandingMode "${raw}" → "${migrated}" (OCR runtime path removed)`);
            this.settings.screenUnderstandingMode = migrated;
            this.saveSettings();
        } else {
            console.warn(`[SettingsManager] Unknown legacy screenUnderstandingMode "${raw}" — defaulting to vision_first`);
            this.settings.screenUnderstandingMode = 'vision_first';
            this.saveSettings();
        }
    }

    private saveSettings(): void {
        try {
            const tmpPath = this.settingsPath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(this.settings, null, 2));
            fs.renameSync(tmpPath, this.settingsPath);
        } catch (e) {
            console.error('[SettingsManager] Failed to save settings:', e);
        }
    }
}
