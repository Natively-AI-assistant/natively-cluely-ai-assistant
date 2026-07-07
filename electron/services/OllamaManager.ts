// electron/services/OllamaManager.ts
import { ChildProcess, spawn } from 'child_process';
import treeKill from 'tree-kill';
import { ProviderStatusRegistry } from './ProviderStatusRegistry';
import type { ProviderStatus } from './providerStatus';

// Re-exported so tests that require OllamaManager can also access the
// same singleton the manager writes to. esbuild inlines this re-export
// into the OllamaManager bundle.
export { ProviderStatusRegistry } from './ProviderStatusRegistry';

export type OllamaStartReason = 'startup-selected' | 'auto-start-setting' | 'user-action' | 'selected-model';

export interface OllamaEnsureOptions {
  reason: OllamaStartReason;
  selectedModel?: string;
  url?: string;
}

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const OPTIONAL_MISSING_BACKOFF_MS = 60_000;

export class OllamaManager {
  private static instance: OllamaManager;
  private ollamaProcess: ChildProcess | null = null;
  private isAppManaged: boolean = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private maxRetries = 24; // 24 attempts * 5 seconds = 120 seconds (2 minutes)
  private attempts = 0;
  private missingBackoffUntil = 0;
  private lastStatus: ProviderStatus | null = null;
  // Single-flight gate for ensureRunning. Two near-simultaneous calls (e.g.
  // startup gating + a user toggle) would otherwise both pass checkIsRunning
  // and both spawn a daemon, leaving the second poll running against the
  // first process. The shared in-flight Promise ensures only one ensureRunning
  // runs at a time and the second call awaits the first's resolution.
  private ensuringPromise: Promise<ProviderStatus> | null = null;

  private constructor() {}

  public static getInstance(): OllamaManager {
    if (!OllamaManager.instance) {
      OllamaManager.instance = new OllamaManager();
    }
    return OllamaManager.instance;
  }

  /**
   * True only when THIS app spawned the Ollama daemon (via startOllama()).
   * False when a user-managed `ollama serve` was already running at init.
   * Consulted before any destructive restart so we never `kill -9` a daemon
   * the user (or another app) owns.
   */
  public getIsAppManaged(): boolean {
    return this.isAppManaged;
  }

  public getLastStatus(): ProviderStatus | null {
    return this.lastStatus ? { ...this.lastStatus, details: this.lastStatus.details ? { ...this.lastStatus.details } : undefined } : null;
  }

  /**
   * Side-effect-free probe. This never spawns `ollama serve`; use ensureRunning()
   * only after the user selects Ollama, enables auto-start, or clicks Start.
   */
  public async probe(url: string = DEFAULT_OLLAMA_URL): Promise<ProviderStatus> {
    const running = await this.checkIsRunning(url);
    if (running) {
      this.isAppManaged = this.ollamaProcess != null;
      return this.recordStatus({
        id: 'ollama',
        kind: 'external_local',
        health: 'ready',
        requiredForStartup: false,
        requiredForCoreFallback: false,
        message: 'Ollama is running',
        recoverable: true,
        details: { url, appManaged: this.isAppManaged },
      });
    }

    return this.recordStatus({
      id: 'ollama',
      kind: 'external_local',
      health: 'missing_optional_dependency',
      requiredForStartup: false,
      requiredForCoreFallback: false,
      message: 'Ollama is not running; optional external provider unavailable',
      recoverable: true,
      details: { url },
    });
  }

  /**
   * Compatibility wrapper. Startup code should prefer skipStartup()/probe() unless
   * Ollama is explicitly selected. Explicit user-action IPC may pass a reason.
   */
  public async init(options?: Partial<OllamaEnsureOptions>): Promise<void> {
    if (!options?.reason) {
      this.skipStartup('Ollama provider not selected; startup skipped');
      console.log('[OllamaManager] Skipping Ollama startup; Ollama provider not selected');
      return;
    }
    await this.ensureRunning({ reason: options.reason, selectedModel: options.selectedModel, url: options.url });
  }

  public skipStartup(message = 'Ollama not selected; startup skipped'): ProviderStatus {
    return this.recordStatus({
      id: 'ollama',
      kind: 'external_local',
      health: 'missing_optional_dependency',
      requiredForStartup: false,
      requiredForCoreFallback: false,
      message,
      recoverable: true,
    });
  }

  /**
   * Ensure Ollama is running only for explicit opt-in/selection flows. Missing
   * binary is a recoverable optional-provider state, not a startup fatal error.
   */
  public async ensureRunning(options: OllamaEnsureOptions): Promise<ProviderStatus> {
    if (this.ensuringPromise) return this.ensuringPromise;
    this.ensuringPromise = this.runEnsure(options).finally(() => {
      this.ensuringPromise = null;
    });
    return this.ensuringPromise;
  }

  private async runEnsure(options: OllamaEnsureOptions): Promise<ProviderStatus> {
    const url = options.url || DEFAULT_OLLAMA_URL;
    console.log('[OllamaManager] Checking Ollama availability...', { reason: options.reason, selectedModel: options.selectedModel || null });

    const isRunning = await this.checkIsRunning(url);
    if (isRunning) {
      console.log('[OllamaManager] Ollama is already running. App will not manage its lifecycle.');
      this.isAppManaged = false;
      return this.recordStatus({
        id: 'ollama',
        kind: 'external_local',
        health: 'ready',
        requiredForStartup: false,
        requiredForCoreFallback: false,
        message: 'Ollama is running',
        recoverable: true,
        details: { url, reason: options.reason, selectedModel: options.selectedModel || null, appManaged: false },
      });
    }

    const now = Date.now();
    if (now < this.missingBackoffUntil) {
      const seconds = Math.ceil((this.missingBackoffUntil - now) / 1000);
      return this.recordStatus({
        id: 'ollama',
        kind: 'external_local',
        health: 'missing_optional_dependency',
        requiredForStartup: false,
        requiredForCoreFallback: false,
        message: `Ollama is not installed or unavailable in PATH. Retrying is on cooldown for ${seconds}s.`,
        recoverable: true,
        details: { url, reason: options.reason, selectedModel: options.selectedModel || null, cooldownSeconds: seconds },
      });
    }

    console.log('[OllamaManager] Ollama selected but not running. Attempting to start external provider...');
    const startResult = await this.startOllama();
    if (startResult.ok) {
      this.pollUntilReady(url);
      return this.recordStatus({
        id: 'ollama',
        kind: 'external_local',
        health: 'degraded',
        requiredForStartup: false,
        requiredForCoreFallback: false,
        message: 'Ollama process started; waiting for readiness',
        recoverable: true,
        details: { url, reason: options.reason, selectedModel: options.selectedModel || null, appManaged: true },
      });
    }

    this.missingBackoffUntil = Date.now() + OPTIONAL_MISSING_BACKOFF_MS;
    const isEnoent = (startResult.ok === false) && (startResult.errorCode === 'ENOENT' || /ENOENT/i.test(startResult.error || ''));
    const errorText = (startResult.ok === false) ? startResult.error : 'unknown error';
    const errorCode = (startResult.ok === false) ? startResult.errorCode : undefined;
    const status: ProviderStatus = {
      id: 'ollama',
      kind: 'external_local',
      health: isEnoent ? 'missing_optional_dependency' : 'unavailable',
      requiredForStartup: false,
      requiredForCoreFallback: false,
      message: isEnoent
        ? 'Ollama is not installed or not available in PATH. Install Ollama or switch to another provider.'
        : `Ollama could not be started: ${errorText}`,
      recoverable: true,
      details: { url, reason: options.reason, selectedModel: options.selectedModel || null, error: errorText, errorCode: errorCode || null },
    };
    console.warn('[OllamaManager] Ollama not available:', status.message);
    return this.recordStatus(status);
  }

  /**
   * Ping the local Ollama server to see if it responds.
   */
  private async checkIsRunning(url: string = DEFAULT_OLLAMA_URL): Promise<boolean> {
    try {
      const base = url.replace('localhost', '127.0.0.1').replace(/\/+$/, '');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000); // 1s timeout

      const response = await fetch(`${base}/api/tags`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      // ECONNREFUSED or timeout means it's not running
      return false;
    }
  }

  /**
   * Spawns the 'ollama serve' command invisibly.
   */
  private startOllama(): Promise<{ ok: true } | { ok: false; error: string; errorCode?: string }> {
    return new Promise((resolve) => {
      try {
        this.clearPoll();
        this.isAppManaged = true;

        const child = spawn('ollama', ['serve'], {
          detached: false, // Keep attached to app lifecycle
          windowsHide: true, // Hide terminal on Windows
          stdio: 'ignore', // We don't care about its logs
        });
        this.ollamaProcess = child;

        let settled = false;
        const settle = (result: { ok: true } | { ok: false; error: string; errorCode?: string }) => {
          if (settled) return;
          settled = true;
          resolve(result);
        };

        child.once('spawn', () => {
          settle({ ok: true });
        });

        child.on('error', (err: NodeJS.ErrnoException) => {
          this.isAppManaged = false;
          this.ollamaProcess = null;
          this.clearPoll();
          settle({ ok: false, error: err.message, errorCode: err.code });
        });

        child.on('close', (code) => {
          // 2026-07-07 fix: surface the close event in the ProviderStatus
          // contract. Without this, an app-managed spawn that died would leave
          // the status at `degraded: "Ollama process started; waiting for
          // readiness"` — even though our process is gone. The poll loop may
          // then see a DIFFERENT (user-managed) daemon on 11434 and flip the
          // status to `ready`, which is misleading. We only publish the
          // `unavailable` status when this app owned the process (otherwise
          // exit-by-another-app would falsely mark Ollama as broken).
          const wasAppManaged = this.isAppManaged;
          this.ollamaProcess = null;
          if (this.isAppManaged) this.isAppManaged = false;
          if (wasAppManaged && code !== 0) {
            console.warn(`[OllamaManager] App-managed Ollama process exited with code ${code}`);
            this.missingBackoffUntil = Date.now() + OPTIONAL_MISSING_BACKOFF_MS;
            this.recordStatus({
              id: 'ollama',
              kind: 'external_local',
              health: 'unavailable',
              requiredForStartup: false,
              requiredForCoreFallback: false,
              message: code === null || code === undefined
                ? 'Ollama process ended unexpectedly. Install Ollama or switch to another provider.'
                : `Ollama process exited with code ${code}. Install Ollama or switch to another provider.`,
              recoverable: true,
              details: { exitCode: code, cooldownSeconds: OPTIONAL_MISSING_BACKOFF_MS / 1000 },
            });
          } else {
            console.log(`[OllamaManager] Process exited with code ${code}`);
          }
        });
      } catch (err: any) {
        this.isAppManaged = false;
        this.ollamaProcess = null;
        this.clearPoll();
        resolve({ ok: false, error: err?.message || String(err), errorCode: err?.code });
      }
    });
  }

  /**
   * Polls every 5 seconds for up to 2 minutes.
   */
  private pollUntilReady(url: string): void {
    this.attempts = 0;
    this.clearPoll();

    this.pollInterval = setInterval(async () => {
      this.attempts++;
      const isRunning = await this.checkIsRunning(url);

      if (isRunning) {
        console.log(
          `[OllamaManager] Successfully connected to Ollama after ${this.attempts * 5} seconds!`,
        );
        this.clearPoll();
        this.recordStatus({
          id: 'ollama',
          kind: 'external_local',
          health: 'ready',
          requiredForStartup: false,
          requiredForCoreFallback: false,
          message: 'Ollama is running',
          recoverable: true,
          details: { url, appManaged: this.isAppManaged },
        });
        return;
      }

      if (this.attempts >= this.maxRetries) {
        console.warn(
          '[OllamaManager] Timeout: Failed to connect to Ollama after 2 minutes. Please check if it is installed properly.',
        );
        this.clearPoll();
        this.recordStatus({
          id: 'ollama',
          kind: 'external_local',
          health: 'unavailable',
          requiredForStartup: false,
          requiredForCoreFallback: false,
          message: 'Ollama process was started but did not become ready within 2 minutes',
          recoverable: true,
          details: { url, appManaged: this.isAppManaged },
        });
      } else {
        console.log(
          `[OllamaManager] Waiting for Ollama... (Attempt ${this.attempts}/${this.maxRetries})`,
        );
      }
    }, 5000);
    this.pollInterval.unref?.();
  }

  private clearPoll(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private recordStatus(status: ProviderStatus): ProviderStatus {
    this.lastStatus = ProviderStatusRegistry.getInstance().setStatus(status);
    return this.lastStatus;
  }

  /**
   * Test-only: clear the poll interval and reset internal state. Useful for
   * test isolation so a long-lived poll doesn't keep the test runner alive.
   */
  public __resetForTests(): void {
    this.clearPoll();
    this.ollamaProcess = null;
    this.isAppManaged = false;
    this.missingBackoffUntil = 0;
    this.attempts = 0;
    this.lastStatus = null;
  }

  /**
   * Kills the Ollama process ONLY if this app started it.
   * Called when Electron is quitting.
   */
  public stop(): void {
    this.clearPoll();

    if (this.isAppManaged && this.ollamaProcess && this.ollamaProcess.pid) {
      console.log('[OllamaManager] App is quitting. Terminating managed Ollama process tree...');
      try {
        // Use tree-kill to ensure Ollama and all its nested runner processes die
        treeKill(this.ollamaProcess.pid, 'SIGTERM', (err) => {
          if (err) {
            console.error('[OllamaManager] Failed to tree-kill Ollama process:', err);
          } else {
            console.log('[OllamaManager] Successfully killed Ollama process tree.');
          }
        });
      } catch (e) {
        console.error('[OllamaManager] Exception during kill:', e);
      }
    }
  }
}
