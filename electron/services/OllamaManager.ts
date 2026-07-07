// electron/services/OllamaManager.ts
import { ChildProcess, spawn } from 'child_process';
import treeKill from 'tree-kill';

export class OllamaManager {
  private static instance: OllamaManager;
  private ollamaProcess: ChildProcess | null = null;
  private isAppManaged: boolean = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private maxRetries = 24; // 24 attempts * 5 seconds = 120 seconds (2 minutes)
  private attempts = 0;

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

  /**
   * Initialize the manager. Checks if Ollama is running, starts it if not.
   */
  public async init(): Promise<void> {
    console.log('[OllamaManager] Checking if Ollama is already running...');
    const isRunning = await this.checkIsRunning();

    if (isRunning) {
      console.log('[OllamaManager] Ollama is already running. App will not manage its lifecycle.');
      this.isAppManaged = false;
      return;
    }

    console.log('[OllamaManager] Ollama not detected. Attempting to start in background...');
    this.startOllama();
    this.pollUntilReady();
  }

  /**
   * Ping the local Ollama server to see if it responds.
   */
  private async checkIsRunning(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000); // 1s timeout

      const response = await fetch('http://127.0.0.1:11434/api/tags', {
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
  private startOllama(): void {
    try {
      this.isAppManaged = true;

      // Spawn detached and hidden
      this.ollamaProcess = spawn('ollama', ['serve'], {
        detached: false, // Keep attached to app lifecycle
        windowsHide: true, // Hide terminal on Windows
        stdio: 'ignore', // We don't care about its logs
      });

      this.ollamaProcess.on('error', (err) => {
        console.error('[OllamaManager] Failed to start Ollama. Is it installed?', err.message);
        this.isAppManaged = false;
        this.ollamaProcess = null;
        if (this.pollInterval) clearInterval(this.pollInterval);
      });

      this.ollamaProcess.on('close', (code) => {
        console.log(`[OllamaManager] Process exited with code ${code}`);
        this.ollamaProcess = null;
      });
    } catch (err) {
      console.error('[OllamaManager] Exception while spawning Ollama:', err);
      this.isAppManaged = false;
    }
  }

  /**
   * Polls every 5 seconds for up to 2 minutes.
   */
  private pollUntilReady(): void {
    this.attempts = 0;

    this.pollInterval = setInterval(async () => {
      this.attempts++;
      const isRunning = await this.checkIsRunning();

      if (isRunning) {
        console.log(
          `[OllamaManager] Successfully connected to Ollama after ${this.attempts * 5} seconds!`,
        );
        if (this.pollInterval) clearInterval(this.pollInterval);
        return;
      }

      if (this.attempts >= this.maxRetries) {
        console.log(
          '[OllamaManager] Timeout: Failed to connect to Ollama after 2 minutes. Please check if it is installed properly.',
        );
        if (this.pollInterval) clearInterval(this.pollInterval);
      } else {
        console.log(
          `[OllamaManager] Waiting for Ollama... (Attempt ${this.attempts}/${this.maxRetries})`,
        );
      }
    }, 5000);
    this.pollInterval.unref?.();
  }

  /**
   * Kills the Ollama process ONLY if this app started it.
   * Called when Electron is quitting.
   */
  public stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

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
