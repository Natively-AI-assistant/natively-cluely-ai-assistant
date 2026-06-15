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
// flows from SettingsManager, not just shell env. Auto-spawn IS implemented: when the
// memory flag is on + a baseUrl is configured + the server is not already healthy + a
// hindsightServerCommand is set (autoStart defaults on), start() spawns it (detached,
// group-killed on quit via stopSync) and polls for readiness. Cloud / a user-run server
// stays healthy → no spawn.

import type { HindsightConfig } from '../intelligence/memory/HindsightClientAdapter';
import type { ChildProcess } from 'child_process';

interface SettingsLike {
  get(key: string): unknown;
}

const HEALTH_TIMEOUT_MS = 1000;       // match OllamaManager.checkIsRunning
const AVAILABILITY_TTL_MS = 30_000;   // cache health so per-retain/recall calls are cheap
const SPAWN_POLL_INTERVAL_MS = 5000;  // poll for readiness (like OllamaManager)
const SPAWN_MAX_ATTEMPTS = 36;        // 36 * 5s = 180s (first boot downloads embedding models)

export class HindsightManager {
  private static instance: HindsightManager | null = null;
  static getInstance(): HindsightManager {
    if (!HindsightManager.instance) HindsightManager.instance = new HindsightManager();
    return HindsightManager.instance;
  }

  /** Cached health result + when it was taken. */
  private lastHealthy = false;
  private lastCheckedAt = 0;
  /** True only when WE spawned the server (so we kill it on quit). A user-run or Cloud
   *  server is never app-managed and is left running. */
  private isAppManaged = false;
  private serverProcess: ChildProcess | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private spawnAttempts = 0;

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
   * Resolve the Hindsight config: env (dev) takes precedence over the persisted setting
   * (packaged app). Returns null when no baseUrl is configured (→ feature off).
   */
  getHindsightConfig(): HindsightConfig | null {
    try {
      const s = this.settings();
      const baseUrl = (process.env.HINDSIGHT_BASE_URL
        || (s?.get('hindsightBaseUrl') as string | undefined)
        || '').trim();
      if (!baseUrl) return null;
      const apiKey = (process.env.HINDSIGHT_API_KEY
        || (s?.get('hindsightApiKey') as string | undefined)
        || '').trim() || undefined;
      const timeoutMs = Number(process.env.HINDSIGHT_TIMEOUT_MS) || 800;
      return { baseUrl, apiKey, timeoutMs };
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

  /** GET <baseUrl>/health with a 1s timeout. Returns false on any error/timeout. */
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
      const ok = res.ok;
      this.lastHealthy = ok;
      this.lastCheckedAt = Date.now();
      return ok;
    } catch {
      this.lastHealthy = false;
      this.lastCheckedAt = Date.now();
      return false;
    }
  }

  /**
   * Cheap gate for the retain/recall paths: a baseUrl is configured AND a recent health
   * check passed. Caches for AVAILABILITY_TTL_MS so calling it per answer is free; kicks
   * a background re-check when stale (never blocks the caller). Returns the cached value
   * immediately — callers that need a fresh result await healthCheck() directly.
   */
  isAvailable(): boolean {
    if (!this.getHindsightConfig()) return false;
    // Cold start: never health-checked yet (e.g. start() hasn't run / completed). Be
    // OPTIMISTIC — return true and kick a check. Worst case is one recall to a down server
    // (already timeout-bounded); the alternative (return false) would wrongly skip recall
    // for a configured+healthy server on the first question after launch.
    if (this.lastCheckedAt === 0) { void this.healthCheck(); return true; }
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

  /** Should we auto-spawn a local server? Resolve the launch command + autoStart toggle. */
  private autoStartCommand(): string | null {
    try {
      const s = this.settings();
      // Default ON (auto-start-when-installed, per the design) unless explicitly disabled.
      const autoStart = (s?.get('hindsightAutoStart') as boolean | undefined) ?? true;
      if (!autoStart) return null;
      const cmd = (process.env.HINDSIGHT_SERVER_COMMAND
        || (s?.get('hindsightServerCommand') as string | undefined)
        || '').trim();
      return cmd || null;
    } catch {
      return null;
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
      const cfg = this.getHindsightConfig();
      if (!cfg) return;                 // no baseUrl → feature off, stay Noop
      if (!this.memoryFlagOn()) return; // flag off → don't manage anything

      const healthy = await this.healthCheck();
      if (healthy) {
        console.log('[HindsightManager] server already running — connecting (not app-managed).', { baseUrl: cfg.baseUrl });
        this.isAppManaged = false;
        return;
      }

      const cmd = this.autoStartCommand();
      if (!cmd) {
        console.log('[HindsightManager] server not running + auto-start off/unset — staying Noop until a server appears.', { baseUrl: cfg.baseUrl });
        return;
      }

      console.log('[HindsightManager] server not detected — auto-starting:', cmd);
      this.spawnServer(cmd);
      this.pollUntilReady();
    } catch (e: any) {
      console.warn('[HindsightManager] start skipped (non-fatal):', e?.message);
    }
  }

  /** Spawn the configured server command (shell form, like `bash scripts/hindsight-start.sh`).
   *  Degrades gracefully on error ("python/script not found") — app unaffected. */
  private spawnServer(command: string): void {
    try {
      const { spawn } = require('child_process') as typeof import('child_process');
      this.isAppManaged = true;
      // Shell form so a multi-token command (`bash scripts/...`) works cross-platform.
      // detached:true on POSIX puts the server in its OWN process group, so on quit we can
      // synchronously kill the WHOLE tree (Python + embedded Postgres workers, which
      // re-parent/daemonize) with one `process.kill(-pid)` inside before-quit — tree-kill
      // is async and the app can exit before it finishes, orphaning Postgres. (Windows has
      // no process groups; we fall back to taskkill /T in stopSync.)
      const isWin = process.platform === 'win32';
      this.serverProcess = spawn(command, {
        shell: true,
        detached: !isWin,   // own process group on POSIX for group-kill on quit
        windowsHide: true,
        stdio: 'ignore',
        cwd: process.cwd(),
      });
      // Don't let the detached child keep the parent event loop alive.
      this.serverProcess.unref?.();
      this.serverProcess.on('error', (err: any) => {
        console.error('[HindsightManager] failed to start server (is it installed?):', err?.message);
        this.isAppManaged = false;
        this.serverProcess = null;
        if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
      });
      this.serverProcess.on('close', (code: number | null) => {
        console.log('[HindsightManager] server process exited', { code });
        this.serverProcess = null;
      });
    } catch (e: any) {
      console.error('[HindsightManager] exception spawning server:', e?.message);
      this.isAppManaged = false;
    }
  }

  /** Poll /health every 5s for up to ~3min (first boot downloads embedding models). */
  private pollUntilReady(): void {
    // Guard against a leaked interval if pollUntilReady is ever entered twice (e.g. a
    // future second start()): clear any prior one before arming a new one.
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
    this.spawnAttempts = 0;
    this.pollInterval = setInterval(async () => {
      this.spawnAttempts++;
      const healthy = await this.healthCheck();
      if (healthy) {
        console.log(`[HindsightManager] server ready after ~${this.spawnAttempts * 5}s`);
        if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
        return;
      }
      if (this.spawnAttempts >= SPAWN_MAX_ATTEMPTS) {
        console.warn('[HindsightManager] timeout waiting for server — staying Noop. Check the install / command.');
        if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
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
}
