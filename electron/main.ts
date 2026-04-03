import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, systemPreferences, screen } from "electron"
import path from "path"
import fs from "fs"
import { autoUpdater } from "electron-updater"
if (!app.isPackaged) {
  require('dotenv').config();
}

// Handle stdout/stderr errors at the process level to prevent EIO crashes
// This is critical for Electron apps that may have their terminal detached
process.stdout?.on?.('error', () => { });
process.stderr?.on?.('error', () => { });

process.on('uncaughtException', (err) => {
  logToFile('[CRITICAL] Uncaught Exception: ' + (err.stack || err.message || err));
});

process.on('unhandledRejection', (reason, promise) => {
  logToFile('[CRITICAL] Unhandled Rejection at: ' + promise + ' reason: ' + (reason instanceof Error ? reason.stack : reason));
});

// CQ-04 fix: do NOT call app.getPath() at module load time.
// app.getPath('documents') is not guaranteed to be available before app.whenReady().
// Use a lazy getter instead — the path is resolved on first logToFile() call.
let _logFile: string | null = null;
const getLogFile = (): string | null => {
  if (_logFile) return _logFile;
  try {
    _logFile = path.join(app.getPath('documents'), 'natively_debug.log');
    return _logFile;
  } catch {
    // app.ready not yet fired — return null, logToFile will skip silently
    return null;
  }
};

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

/** Maximum log file size before rotation (10 MB). */
const LOG_MAX_BYTES = 10 * 1024 * 1024;

function logToFile(msg: string) {
  try {
    const logFile = getLogFile();
    // If the app isn't ready yet (path not available), skip silently.
    if (!logFile) return;

    // P2-1: rotate the log file when it exceeds LOG_MAX_BYTES so that long-running
    // sessions (or meetings with dense transcripts) don't fill the user's disk.
    // The previous log is kept as .log.1 for one-generation rollover.
    try {
      const stat = fs.statSync(logFile);
      if (stat.size >= LOG_MAX_BYTES) {
        const rotated = logFile + '.1';
        if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
        fs.renameSync(logFile, rotated);
      }
    } catch {
      // statSync throws if the file doesn't exist yet — that's fine
    }
    fs.appendFileSync(logFile, new Date().toISOString() + ' ' + msg + '\n');
  } catch (e) {
    // Ignore logging errors
  }
}

async function ensureMacMicrophoneAccess(context: string): Promise<boolean> {
  if (process.platform !== 'darwin') return true;

  try {
    const currentStatus = systemPreferences.getMediaAccessStatus('microphone');
    console.log(`[Main] macOS microphone permission before ${context}: ${currentStatus}`);

    if (currentStatus === 'granted') {
      return true;
    }

    const granted = await systemPreferences.askForMediaAccess('microphone');
    console.log(
      `[Main] macOS microphone permission request during ${context}: ${granted ? 'granted' : 'denied'}`
    );
    return granted;
  } catch (error) {
    console.error(`[Main] Failed to check macOS microphone permission during ${context}:`, error);
    return false;
  }
}

console.log = (...args: any[]) => {
  const msg = args.map(a => (a instanceof Error) ? a.stack || a.message : (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  logToFile('[LOG] ' + msg);
  try {
    originalLog.apply(console, args);
  } catch { }
};

console.warn = (...args: any[]) => {
  const msg = args.map(a => (a instanceof Error) ? a.stack || a.message : (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  logToFile('[WARN] ' + msg);
  try {
    originalWarn.apply(console, args);
  } catch { }
};

console.error = (...args: any[]) => {
  const msg = args.map(a => (a instanceof Error) ? a.stack || a.message : (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  logToFile('[ERROR] ' + msg);
  try {
    originalError.apply(console, args);
  } catch { }
};

import { initializeIpcHandlers } from "./ipcHandlers"
import { WindowHelper } from "./WindowHelper"
import { SettingsWindowHelper } from "./SettingsWindowHelper"
import { ModelSelectorWindowHelper } from "./ModelSelectorWindowHelper"
import { CropperWindowHelper } from "./CropperWindowHelper"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { KeybindManager } from "./services/KeybindManager"
import { ProcessingHelper } from "./ProcessingHelper"

import { IntelligenceManager } from "./IntelligenceManager"
import { SystemAudioCapture } from "./audio/SystemAudioCapture"
import { MicrophoneCapture } from "./audio/MicrophoneCapture"
import { GoogleSTT } from "./audio/GoogleSTT"
import { RestSTT } from "./audio/RestSTT"
import { DeepgramStreamingSTT } from "./audio/DeepgramStreamingSTT"
import { SonioxStreamingSTT } from "./audio/SonioxStreamingSTT"
import { ElevenLabsStreamingSTT } from "./audio/ElevenLabsStreamingSTT"
import { OpenAIStreamingSTT } from "./audio/OpenAIStreamingSTT"
import { ThemeManager } from "./ThemeManager"
import { RAGManager } from "./rag/RAGManager"
import { DatabaseManager } from "./db/DatabaseManager"
import { warmupIntentClassifier } from "./llm"

/** Unified type for all STT providers with optional extended capabilities */
type STTProvider = (GoogleSTT | RestSTT | DeepgramStreamingSTT | SonioxStreamingSTT | ElevenLabsStreamingSTT | OpenAIStreamingSTT) & {
  finalize?: () => void;
  setAudioChannelCount?: (count: number) => void;
  notifySpeechEnded?: () => void;
};

type ScreenshotWindowMode = 'launcher' | 'overlay';
type ScreenshotCaptureKind = 'full' | 'selective';

interface ScreenshotCaptureSession {
  captureKind: ScreenshotCaptureKind;
  wasMainWindowVisible: boolean;
  windowMode: ScreenshotWindowMode;
  wasSettingsVisible: boolean;
  wasModelSelectorVisible: boolean;
  overlayBounds: Electron.Rectangle | null;
  overlayDisplayId: number | null;
  restoreWithoutFocus: boolean;
}

// Premium: Knowledge modules loaded conditionally
let KnowledgeOrchestratorClass: any = null;
let KnowledgeDatabaseManagerClass: any = null;
try {
    KnowledgeOrchestratorClass = require('../premium/electron/knowledge/KnowledgeOrchestrator').KnowledgeOrchestrator;
    KnowledgeDatabaseManagerClass = require('../premium/electron/knowledge/KnowledgeDatabaseManager').KnowledgeDatabaseManager;
} catch {
    console.log('[Main] Knowledge modules not available — profile intelligence disabled.');
}

import { CredentialsManager } from "./services/CredentialsManager"
import { SettingsManager } from "./services/SettingsManager"
import { setVerboseLoggingFlag } from "./verboseLog"
import { ReleaseNotesManager } from "./update/ReleaseNotesManager"
import { OllamaManager } from './services/OllamaManager'

export class AppState {
  private static instance: AppState | null = null

  private windowHelper: WindowHelper
  public settingsWindowHelper: SettingsWindowHelper
  public modelSelectorWindowHelper: ModelSelectorWindowHelper
  public cropperWindowHelper: CropperWindowHelper
  private screenshotHelper: ScreenshotHelper
  public processingHelper: ProcessingHelper

  private intelligenceManager: IntelligenceManager
  private themeManager: ThemeManager
  private ragManager: RAGManager | null = null
  private knowledgeOrchestrator: any = null
  private tray: Tray | null = null
  private updateAvailable: boolean = false
  private disguiseMode: 'terminal' | 'settings' | 'activity' | 'none' = 'none'

  // View management
  private view: "queue" | "solutions" = "queue"
  private isUndetectable: boolean = false

  private problemInfo: {
    problem_statement: string
    input_format: Record<string, any>
    output_format: Record<string, any>
    constraints: Array<Record<string, any>>
    test_cases: Array<Record<string, any>>
  } | null = null // Allow null

  private hasDebugged: boolean = false
  private isMeetingActive: boolean = false; // Guard for session state leaks
  private _isQuitting: boolean = false;
  private _verboseLogging: boolean = false;
  private _disguiseTimers: NodeJS.Timeout[] = []; // Track forceUpdate timeouts
  private _dockDebounceTimer: NodeJS.Timeout | null = null; // Debounce dock state changes
  private _dockReassertTimers: NodeJS.Timeout[] = []; // Re-assert dock-hidden state after show+focus
  private _ollamaBootstrapPromise: Promise<void> | null = null;
  private screenshotCaptureInProgress: boolean = false;


  // Processing events
  public readonly PROCESSING_EVENTS = {
    //global states
    UNAUTHORIZED: "procesing-unauthorized",
    NO_SCREENSHOTS: "processing-no-screenshots",

    //states for generating the initial solution
    INITIAL_START: "initial-start",
    PROBLEM_EXTRACTED: "problem-extracted",
    SOLUTION_SUCCESS: "solution-success",
    INITIAL_SOLUTION_ERROR: "solution-error",

    //states for processing the debugging
    DEBUG_START: "debug-start",
    DEBUG_SUCCESS: "debug-success",
    DEBUG_ERROR: "debug-error"
  } as const

  constructor() {
    // 1. Load boot-critical settings first (used by WindowHelpers)
    const settingsManager = SettingsManager.getInstance();
    this.isUndetectable = settingsManager.get('isUndetectable') ?? false;
    this.disguiseMode = settingsManager.get('disguiseMode') ?? 'none';
    this._verboseLogging = settingsManager.get('verboseLogging') ?? false;
    setVerboseLoggingFlag(this._verboseLogging);
    console.log(`[AppState] Initialized with isUndetectable=${this.isUndetectable}, disguiseMode=${this.disguiseMode}, verboseLogging=${this._verboseLogging}`);

    // 2. Initialize Helpers with loaded state
    this.windowHelper = new WindowHelper(this)
    this.settingsWindowHelper = new SettingsWindowHelper()
    this.modelSelectorWindowHelper = new ModelSelectorWindowHelper()
    this.cropperWindowHelper = new CropperWindowHelper()

    // 3. Initialize other helpers
    this.screenshotHelper = new ScreenshotHelper(this.view)
    this.processingHelper = new ProcessingHelper(this)

    this.windowHelper.setContentProtection(this.isUndetectable);
    this.settingsWindowHelper.setContentProtection(this.isUndetectable);
    this.modelSelectorWindowHelper.setContentProtection(this.isUndetectable);
    this.cropperWindowHelper.setContentProtection(this.isUndetectable);

    if (process.platform === 'win32' || process.platform === 'darwin') {
      this.cropperWindowHelper.preload();
    }

    // Initialize KeybindManager
    const keybindManager = KeybindManager.getInstance();
    keybindManager.setWindowHelper(this.windowHelper);
    keybindManager.setupIpcHandlers();
    keybindManager.onUpdate(() => {
      this.updateTrayMenu();
    });

    keybindManager.onShortcutTriggered(async (actionId) => {
      console.log(`[Main] Global shortcut triggered: ${actionId}`);
      try {
        if (actionId === 'general:toggle-visibility') {
          this.toggleMainWindow();
        } else if (actionId === 'general:toggle-mouse-passthrough') {
          // Adapted from public PR #113 — verify premium interaction
          this.toggleOverlayMousePassthrough();
        } else if (actionId === 'general:take-screenshot') {
          const screenshotPath = await this.takeScreenshot(false);
          const preview = await this.getImagePreview(screenshotPath);
          const mainWindow = this.getMainWindow();
          if (mainWindow) {
            mainWindow.webContents.send("screenshot-taken", {
              path: screenshotPath,
              preview
            });
          }
        } else if (actionId === 'general:selective-screenshot') {
          const screenshotPath = await this.takeSelectiveScreenshot(false);
          const preview = await this.getImagePreview(screenshotPath);
          const mainWindow = this.getMainWindow();
          if (mainWindow) {
            // preload.ts maps 'screenshot-attached' to onScreenshotAttached
            mainWindow.webContents.send("screenshot-attached", {
              path: screenshotPath,
              preview
            });
          }
        } else if (actionId === 'general:capture-and-process') {
          // Single-trigger: capture current screen then immediately request AI analysis
          const screenshotPath = await this.takeScreenshot(false);
          const preview = await this.getImagePreview(screenshotPath);
          // Ensure the window is visible so the user can see the response without stealing focus
          this.showMainWindow(true);
          // win.focus() can cause macOS to re-activate the app. Re-hide the dock
          // if we are in undetectable mode.
          if (process.platform === 'darwin' && this.isUndetectable) {
            app.dock.hide();
          }
          const mainWindow = this.getMainWindow();
          if (mainWindow) {
            mainWindow.webContents.send("capture-and-process", {
              path: screenshotPath,
              preview
            });
          }

        // --- STEALTH SHORTCUTS: no focus, no show, pure IPC dispatch ---

        // Chat actions — fire into the renderer without focusing the window
        } else if (
          actionId === 'chat:whatToAnswer' ||
          actionId === 'chat:clarify' ||
          actionId === 'chat:followUp' ||
          actionId === 'chat:answer' ||
          actionId === 'chat:codeHint' ||
          actionId === 'chat:brainstorm' ||
          actionId === 'chat:dynamicAction4' ||
          actionId === 'chat:scrollUp' ||
          actionId === 'chat:scrollDown'
        ) {
          const actionMap: Record<string, string> = {
            'chat:whatToAnswer': 'whatToAnswer',
            'chat:clarify': 'clarify',
            'chat:followUp': 'followUp',
            'chat:answer': 'answer',
            'chat:codeHint': 'codeHint',
            'chat:brainstorm': 'brainstorm',
            'chat:dynamicAction4': 'dynamicAction4',
            'chat:scrollUp': 'scrollUp',
            'chat:scrollDown': 'scrollDown',
          };
          const action = actionMap[actionId];
          // Send to all windows without focusing — stealth operation
          const allWindows = BrowserWindow.getAllWindows();
          allWindows.forEach(win => {
            if (!win.isDestroyed()) {
              win.webContents.send('global-shortcut', { action });
            }
          });

        // Window movement — move window position without focus change
        } else if (actionId === 'window:move-up') {
          this.windowHelper.moveWindowUp();
        } else if (actionId === 'window:move-down') {
          this.windowHelper.moveWindowDown();
        } else if (actionId === 'window:move-left') {
          this.windowHelper.moveWindowLeft();
        } else if (actionId === 'window:move-right') {
          this.windowHelper.moveWindowRight();

        // General actions that are now global (stealth)
        } else if (actionId === 'general:process-screenshots') {
          const allWindows = BrowserWindow.getAllWindows();
          allWindows.forEach(win => {
            if (!win.isDestroyed()) {
              win.webContents.send('global-shortcut', { action: 'processScreenshots' });
            }
          });
        } else if (actionId === 'general:reset-cancel') {
          const allWindows = BrowserWindow.getAllWindows();
          allWindows.forEach(win => {
            if (!win.isDestroyed()) {
              win.webContents.send('global-shortcut', { action: 'resetCancel' });
            }
          });
        }
      } catch (e: any) {
        if (e.message !== "Selection cancelled" && e.message !== "Screenshot capture already in progress") {
          console.error(`[Main] Error handling global shortcut ${actionId}:`, e);
        }
      }
    });

    // Inject WindowHelper into other helpers
    this.settingsWindowHelper.setWindowHelper(this.windowHelper);
    this.modelSelectorWindowHelper.setWindowHelper(this.windowHelper);





    // Initialize IntelligenceManager with LLMHelper
    this.intelligenceManager = new IntelligenceManager(this.processingHelper.getLLMHelper())

    // Initialize ThemeManager
    this.themeManager = ThemeManager.getInstance()

    // Initialize RAGManager (requires database to be ready)
    this.initializeRAGManager()
    
    // Check and prep Ollama embedding model
    this.bootstrapOllamaEmbeddings()


    this.setupIntelligenceEvents()

    // Pre-warm the zero-shot intent classifier in background
    warmupIntentClassifier();

    // Setup Ollama IPC
    this.setupOllamaIpcHandlers()

    // --- NEW SYSTEM AUDIO PIPELINE (SOX + NODE GOOGLE STT) ---
    // LAZY INIT: Do not setup pipeline here to prevent launch volume surge.
    // this.setupSystemAudioPipeline()

    // Initialize Auto-Updater
    this.setupAutoUpdater()
  }

  private broadcast(channel: string, ...args: any[]): void {
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, ...args);
      }
    });
  }

  public getIsMeetingActive(): boolean {
    return this.isMeetingActive;
  }

  public isQuitting(): boolean {
    return this._isQuitting;
  }

  public setQuitting(value: boolean): void {
    this._isQuitting = value;
  }

  private broadcastMeetingState(): void {
    this.broadcast('meeting-state-changed', { isActive: this.isMeetingActive });
  }

  private async bootstrapOllamaEmbeddings() {
    this._ollamaBootstrapPromise = (async () => {
      try {
        const { OllamaBootstrap } = require('./rag/OllamaBootstrap');
        const bootstrap = new OllamaBootstrap();

        // Fire and forget — don't await this before showing the window
        const result = await bootstrap.bootstrap('nomic-embed-text', (status: string, percent: number) => {
          // Send progress to renderer via IPC
          this.broadcast('ollama:pull-progress', { status, percent });
        });

        if (result === 'pulled' || result === 'already_pulled') {
          this.broadcast('ollama:pull-complete');
          // Re-resolve the embedding provider given that Ollama might now be available
          if (this.ragManager) {
             console.log('[AppState] Ollama model ready, re-evaluating RAG pipeline provider');
             const { CredentialsManager } = require('./services/CredentialsManager');
             const cm = CredentialsManager.getInstance();
             this.ragManager.initializeEmbeddings({
                openaiKey: cm.getOpenaiApiKey() || process.env.OPENAI_API_KEY || undefined,
                geminiKey: cm.getGeminiApiKey() || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || undefined,
                ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434"
             });
          }
        }
      } catch (err) {
         console.error('[AppState] Failed to bootstrap Ollama:', err);
      }
    })();
  }

  private initializeRAGManager(): void {
    try {
      const db = DatabaseManager.getInstance();
      const sqliteDb = db.getDb();

      if (sqliteDb) {
        const { CredentialsManager } = require('./services/CredentialsManager');
        const cm = CredentialsManager.getInstance();
        const openaiKey = cm.getOpenaiApiKey() || process.env.OPENAI_API_KEY;
        const geminiKey = cm.getGeminiApiKey() || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
        
        this.ragManager = new RAGManager({ 
            db: sqliteDb, 
            dbPath: db.getDbPath(),
            extPath: db.getExtPath(),
            openaiKey,
            geminiKey,
            ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434'
        });
        this.ragManager.setLLMHelper(this.processingHelper.getLLMHelper());
        console.log('[AppState] RAGManager initialized');
      }
    } catch (error) {
      console.error('[AppState] Failed to initialize RAGManager:', error);
    }

    // Initialize Knowledge Orchestrator
    try {
      const db = DatabaseManager.getInstance();
      const sqliteDb = db.getDb();

      if (sqliteDb && KnowledgeDatabaseManagerClass && KnowledgeOrchestratorClass) {
        const knowledgeDb = new KnowledgeDatabaseManagerClass(sqliteDb);
        this.knowledgeOrchestrator = new KnowledgeOrchestratorClass(knowledgeDb);

        // Wire up LLM functions
        const llmHelper = this.processingHelper.getLLMHelper();

        // generateContent function for LLM calls
        this.knowledgeOrchestrator.setGenerateContentFn(async (contents: any[]) => {
          return await llmHelper.generateContentStructured(
            contents[0]?.text || ''
          );
        });

        // Embedding function — lazily delegate to the cascaded EmbeddingPipeline
        // (OpenAI → Gemini → Ollama → Local bundled model).
        // We await waitForReady() so uploads during boot wait for the pipeline
        // instead of immediately throwing 'not ready'.
        const self = this;
        this.knowledgeOrchestrator.setEmbedFn(async (text: string) => {
          const pipeline = self.ragManager?.getEmbeddingPipeline();
          if (!pipeline) throw new Error('RAG pipeline not available');
          await pipeline.waitForReady();
          return await pipeline.getEmbedding(text);
        });
        if (typeof this.knowledgeOrchestrator.setEmbedQueryFn === 'function') {
          this.knowledgeOrchestrator.setEmbedQueryFn(async (text: string) => {
            const pipeline = self.ragManager?.getEmbeddingPipeline();
            if (!pipeline) throw new Error('RAG pipeline not available');
            await pipeline.waitForReady();
            return await pipeline.getEmbeddingForQuery(text);
          });
        }

        // Attach KnowledgeOrchestrator to LLMHelper
        llmHelper.setKnowledgeOrchestrator(this.knowledgeOrchestrator);

        console.log('[AppState] KnowledgeOrchestrator initialized');
      }
    } catch (error) {
      console.error('[AppState] Failed to initialize KnowledgeOrchestrator:', error);
    }
  }

  private setupAutoUpdater(): void {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false  // Manual install only via button

    // Default to latest (stable) channel - matches latest.yml generated by electron-builder
    autoUpdater.channel = 'latest'
    console.log(`[AutoUpdater] Channel: ${autoUpdater.channel}`)

    autoUpdater.on("checking-for-update", () => {
      console.log("[AutoUpdater] Checking for update...")
      this.broadcast("update-checking")
    })

    autoUpdater.on("update-available", async (info) => {
      console.log("[AutoUpdater] Update available:", info.version)
      this.updateAvailable = true

      // Fetch structured release notes
      const releaseManager = ReleaseNotesManager.getInstance();
      const notes = await releaseManager.fetchReleaseNotes(info.version);

      // Notify renderer that an update is available with parsed notes if available
      this.broadcast("update-available", {
        ...info,
        parsedNotes: notes
      })
    })

    autoUpdater.on("update-not-available", (info) => {
      console.log("[AutoUpdater] Update not available:", info.version)
      this.broadcast("update-not-available", info)
    })

    autoUpdater.on("error", (err) => {
      console.error("[AutoUpdater] Error:", err)
      // Include more details in the error message for debugging
      const errorMessage = err.message || err.toString() || 'Unknown update error'
      this.broadcast("update-error", errorMessage)
    })

    autoUpdater.on("download-progress", (progressObj) => {
      let log_message = "Download speed: " + progressObj.bytesPerSecond
      log_message = log_message + " - Downloaded " + progressObj.percent + "%"
      log_message = log_message + " (" + progressObj.transferred + "/" + progressObj.total + ")"
      console.log("[AutoUpdater] " + log_message)
      this.broadcast("download-progress", progressObj)
    })

    autoUpdater.on("update-downloaded", (info) => {
      console.log("[AutoUpdater] Update downloaded:", info.version)
      // Notify renderer that update is ready to install
      this.broadcast("update-downloaded", info)
    })

    // Start checking for updates with a 10-second delay
    setTimeout(() => {
      if (process.env.NODE_ENV === "development") {
        console.log("[AutoUpdater] Development mode: Skipping auto check (use manual button)");
      } else {
        autoUpdater.checkForUpdatesAndNotify().catch(err => {
          console.error("[AutoUpdater] Failed to check for updates:", err);
        });
      }
    }, 10000);
  }

  private async checkForUpdatesManual(): Promise<void> {
    try {
      console.log('[AutoUpdater] Checking for updates manually via GitHub API...');
      const releaseManager = ReleaseNotesManager.getInstance();
      // Fetch latest release
      const notes = await releaseManager.fetchReleaseNotes('latest');

      if (notes) {
        const currentVersion = app.getVersion();
        const latestVersionTag = notes.version; // e.g., "v1.2.0" or "1.2.0"
        const latestVersion = latestVersionTag.replace(/^v/, '');

        console.log(`[AutoUpdater] Manual Check: Current=${currentVersion}, Latest=${latestVersion}`);

        if (this.isVersionNewer(currentVersion, latestVersion)) {
          console.log('[AutoUpdater] Manual Check: New version found!');
          this.updateAvailable = true;

          // Mock an info object compatible with electron-updater
          const info = {
            version: latestVersion,
            files: [] as any[],
            path: '',
            sha512: '',
            releaseName: notes.summary,
            releaseNotes: notes.fullBody
          };

          // Notify renderer
          this.broadcast("update-available", {
            ...info,
            parsedNotes: notes
          });
        } else {
          console.log('[AutoUpdater] Manual Check: App is up to date.');
          this.broadcast("update-not-available", { version: currentVersion });
        }
      }
    } catch (err) {
      console.error('[AutoUpdater] Manual update check failed:', err);
    }
  }

  private isVersionNewer(current: string, latest: string): boolean {
    // EC-01 fix: strip pre-release suffixes (e.g. "2.1.0-beta.1" → "2.1.0")
    // before splitting so Number() never returns NaN on comparison.
    const stripPre = (v: string) => v.replace(/-.*$/, '');
    const c = stripPre(current).split('.').map(Number);
    const l = stripPre(latest).split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      const cv = c[i] || 0;
      const lv = l[i] || 0;
      if (lv > cv) return true;
      if (lv < cv) return false;
    }
    return false;
  }


  public async quitAndInstallUpdate(): Promise<void> {
    console.log('[AutoUpdater] quitAndInstall called - applying update...')

    // On macOS, unsigned apps can't auto-restart via quitAndInstall
    // Workaround: Open the folder containing the downloaded update so user can install manually
    if (process.platform === 'darwin') {
      try {
        // Get the downloaded update file path (e.g., .../Natively-1.0.9-mac.zip)
        const updateFile = (autoUpdater as any).downloadedUpdateHelper?.file
        console.log('[AutoUpdater] Downloaded update file:', updateFile)

        if (updateFile) {
          const updateDir = path.dirname(updateFile)
          // Open the directory containing the update in Finder
          await shell.openPath(updateDir)
          console.log('[AutoUpdater] Opened update directory:', updateDir)

          // Quit the app so user can install new version
          setTimeout(() => app.quit(), 1000)
          return
        }
      } catch (err) {
        console.error('[AutoUpdater] Failed to open update directory:', err)
      }
    }

    // Fallback to standard quitAndInstall (works on Windows/Linux or if signed)
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall(false, true)
      } catch (err) {
        console.error('[AutoUpdater] quitAndInstall failed:', err)
        app.exit(0)
      }
    })
  }

  public async checkForUpdates(): Promise<void> {
    console.log('[AutoUpdater] Manual check for updates requested')
    try {
      // In development mode, use manual GitHub API check (electron-updater skips in dev)
      if (process.env.NODE_ENV === "development") {
        await this.checkForUpdatesManual()
      } else {
        await autoUpdater.checkForUpdatesAndNotify()
      }
    } catch (err: any) {
      console.error('[AutoUpdater] checkForUpdates failed:', err)
      const errorMessage = err.message || err.toString() || 'Update check failed'
      this.broadcast("update-error", errorMessage)
    }
  }

  public downloadUpdate(): void {
    console.log('[AutoUpdater] Starting download...')
    try {
      // Errors during download are surfaced via autoUpdater.on("error") which
      // already broadcasts "update-error". Do not broadcast here to avoid duplicates.
      autoUpdater.downloadUpdate().catch(err => {
        console.error('[AutoUpdater] downloadUpdate failed:', err)
      })
    } catch (err: any) {
      console.error('[AutoUpdater] downloadUpdate exception:', err)
    }
  }

  // New Property for System Audio & Microphone
  private systemAudioCapture: SystemAudioCapture | null = null;
  private microphoneCapture: MicrophoneCapture | null = null;
  private audioTestCapture: MicrophoneCapture | null = null; // For audio settings test
  private _audioTestStarting = false;               // P2-12: in-flight guard against concurrent calls
  private googleSTT: STTProvider | null = null; // Interviewer
  private googleSTT_User: STTProvider | null = null; // User

  private createSTTProvider(speaker: 'interviewer' | 'user'): STTProvider {
    const { CredentialsManager } = require('./services/CredentialsManager');
    const sttProvider = CredentialsManager.getInstance().getSttProvider();
    const sttLanguage = CredentialsManager.getInstance().getSttLanguage();

    let stt: STTProvider;

    if (sttProvider === 'deepgram') {
      const apiKey = CredentialsManager.getInstance().getDeepgramApiKey();
      if (apiKey) {
        console.log(`[Main] Using DeepgramStreamingSTT for ${speaker}`);
        stt = new DeepgramStreamingSTT(apiKey);
      } else {
        console.warn(`[Main] No API key for Deepgram STT, falling back to GoogleSTT`);
        stt = new GoogleSTT();
      }
    } else if (sttProvider === 'soniox') {
      const apiKey = CredentialsManager.getInstance().getSonioxApiKey();
      if (apiKey) {
        console.log(`[Main] Using SonioxStreamingSTT for ${speaker}`);
        stt = new SonioxStreamingSTT(apiKey);
      } else {
        console.warn(`[Main] No API key for Soniox STT, falling back to GoogleSTT`);
        stt = new GoogleSTT();
      }
    } else if (sttProvider === 'elevenlabs') {
      const apiKey = CredentialsManager.getInstance().getElevenLabsApiKey();
      if (apiKey) {
        console.log(`[Main] Using ElevenLabsStreamingSTT for ${speaker}`);
        stt = new ElevenLabsStreamingSTT(apiKey);
      } else {
        console.warn(`[Main] No API key for ElevenLabs STT, falling back to GoogleSTT`);
        stt = new GoogleSTT();
      }
    } else if (sttProvider === 'openai') {
      // OpenAI: WebSocket Realtime (gpt-4o-transcribe → gpt-4o-mini-transcribe) with whisper-1 REST fallback
      const apiKey = CredentialsManager.getInstance().getOpenAiSttApiKey();
      if (apiKey) {
        console.log(`[Main] Using OpenAIStreamingSTT (WebSocket+REST fallback) for ${speaker}`);
        stt = new OpenAIStreamingSTT(apiKey);
      } else {
        console.warn(`[Main] No API key for OpenAI STT, falling back to GoogleSTT`);
        stt = new GoogleSTT();
      }
    } else if (sttProvider === 'groq' || sttProvider === 'azure' || sttProvider === 'ibmwatson') {
      let apiKey: string | undefined;
      let region: string | undefined;
      let modelOverride: string | undefined;

      if (sttProvider === 'groq') {
        apiKey = CredentialsManager.getInstance().getGroqSttApiKey();
        modelOverride = CredentialsManager.getInstance().getGroqSttModel();
      } else if (sttProvider === 'azure') {
        apiKey = CredentialsManager.getInstance().getAzureApiKey();
        region = CredentialsManager.getInstance().getAzureRegion();
      } else if (sttProvider === 'ibmwatson') {
        apiKey = CredentialsManager.getInstance().getIbmWatsonApiKey();
        region = CredentialsManager.getInstance().getIbmWatsonRegion();
      }

      if (apiKey) {
        console.log(`[Main] Using RestSTT (${sttProvider}) for ${speaker}`);
        stt = new RestSTT(sttProvider, apiKey, modelOverride, region);
      } else {
        console.warn(`[Main] No API key for ${sttProvider} STT, falling back to GoogleSTT`);
        stt = new GoogleSTT();
      }
    } else {
      stt = new GoogleSTT();
    }

    stt.setRecognitionLanguage(sttLanguage);

    // Wire Transcript Events
    stt.on('transcript', (segment: { text: string, isFinal: boolean, confidence: number }) => {
      if (!this.isMeetingActive) {
        return;
      }

      this.intelligenceManager.handleTranscript({
        speaker: speaker,
        text: segment.text,
        timestamp: Date.now(),
        final: segment.isFinal,
        confidence: segment.confidence
      });

      // Feed final transcript to JIT RAG indexer
      if (segment.isFinal && this.ragManager) {
        this.ragManager.feedLiveTranscript([{
          speaker: speaker,
          text: segment.text,
          timestamp: Date.now()
        }]);
      }

      const helper = this.getWindowHelper();
      const payload = {
        speaker: speaker,
        text: segment.text,
        timestamp: Date.now(),
        final: segment.isFinal,
        confidence: segment.confidence
      };
      helper.getLauncherWindow()?.webContents.send('native-audio-transcript', payload);
      helper.getOverlayWindow()?.webContents.send('native-audio-transcript', payload);

      // Feed final recruiter (system audio) transcripts to negotiation tracker
      if (segment.isFinal && speaker === 'interviewer') {
        this.knowledgeOrchestrator?.feedInterviewerUtterance?.(segment.text);
      }
    });

    stt.on('error', (err: Error) => {
      console.error(`[Main] STT (${speaker}) Error:`, err);
    });

    return stt;
  }

  private setupSystemAudioPipeline(): void {
    // REMOVED EARLY RETURN: if (this.systemAudioCapture && this.microphoneCapture) return; // Already initialized

    try {
      // 1. Initialize Captures if missing
      // If they already exist (e.g. from reconfigureAudio), they are already wired to write to this.googleSTT/User
      if (!this.systemAudioCapture) {
        this.systemAudioCapture = new SystemAudioCapture();
        // Wire Capture -> STT
        this.systemAudioCapture.on('data', (chunk: Buffer) => {
          this.googleSTT?.write(chunk);
        });
        this.systemAudioCapture.on('speech_ended', () => {
          this.googleSTT?.notifySpeechEnded?.();
        });
        this.systemAudioCapture.on('error', (err: Error) => {
          console.error('[Main] SystemAudioCapture Error:', err);
        });
      }

      if (!this.microphoneCapture) {
        this.microphoneCapture = new MicrophoneCapture();
        this.microphoneCapture.on('data', (chunk: Buffer) => {
          this.googleSTT_User?.write(chunk);
        });
        this.microphoneCapture.on('speech_ended', () => {
          this.googleSTT_User?.notifySpeechEnded?.();
        });
        this.microphoneCapture.on('error', (err: Error) => {
          console.error('[Main] MicrophoneCapture Error:', err);
        });
      }

      // 2. Initialize STT Services if missing
      if (!this.googleSTT) {
        this.googleSTT = this.createSTTProvider('interviewer');
      }

      if (!this.googleSTT_User) {
        this.googleSTT_User = this.createSTTProvider('user');
      }

      // --- CRITICAL FIX: SYNC SAMPLE RATES ---
      // Always sync rates, even if just initialized, to ensure consistency

      // 1. Sync System Audio Rate
      const sysRate = this.systemAudioCapture?.getSampleRate() || 48000;
      if (this._verboseLogging) console.log(`[Main] Configuring Interviewer STT to ${sysRate}Hz`);
      this.googleSTT?.setSampleRate(sysRate);
      this.googleSTT?.setAudioChannelCount?.(1);

      // 2. Sync Mic Rate
      const micRate = this.microphoneCapture?.getSampleRate() || 48000;
      if (this._verboseLogging) console.log(`[Main] Configuring User STT to ${micRate}Hz`);
      this.googleSTT_User?.setSampleRate(micRate);
      this.googleSTT_User?.setAudioChannelCount?.(1);

      if (this._verboseLogging) console.log('[Main] Full Audio Pipeline (System + Mic) Initialized (Ready)');

    } catch (err) {
      console.error('[Main] Failed to setup System Audio Pipeline:', err);
    }
  }

  private async reconfigureAudio(inputDeviceId?: string, outputDeviceId?: string): Promise<void> {
    console.log(`[Main] Reconfiguring Audio: Input=${inputDeviceId}, Output=${outputDeviceId}`);

    // 1. System Audio (Output Capture)
    if (this.systemAudioCapture) {
      this.systemAudioCapture.stop();
      this.systemAudioCapture = null;
    }

    try {
      console.log('[Main] Initializing SystemAudioCapture...');
      this.systemAudioCapture = new SystemAudioCapture(outputDeviceId || undefined);
      const rate = this.systemAudioCapture.getSampleRate();
      console.log(`[Main] SystemAudioCapture rate: ${rate}Hz`);
      this.googleSTT?.setSampleRate(rate);

      this.systemAudioCapture.on('data', (chunk: Buffer) => {
        // console.log('[Main] SysAudio chunk', chunk.length);
        this.googleSTT?.write(chunk);
      });
      this.systemAudioCapture.on('speech_ended', () => {
        this.googleSTT?.notifySpeechEnded?.();
      });
      this.systemAudioCapture.on('error', (err: Error) => {
        console.error('[Main] SystemAudioCapture Error:', err);
      });
      console.log('[Main] SystemAudioCapture initialized.');
    } catch (err) {
      console.warn('[Main] Failed to initialize SystemAudioCapture with preferred ID. Falling back to default.', err);
      try {
        this.systemAudioCapture = new SystemAudioCapture(); // Default
        const rate = this.systemAudioCapture.getSampleRate();
        console.log(`[Main] SystemAudioCapture (Default) rate: ${rate}Hz`);
        this.googleSTT?.setSampleRate(rate);

        this.systemAudioCapture.on('data', (chunk: Buffer) => {
          this.googleSTT?.write(chunk);
        });
        this.systemAudioCapture.on('speech_ended', () => {
          this.googleSTT?.notifySpeechEnded?.();
        });
        this.systemAudioCapture.on('error', (err: Error) => {
          console.error('[Main] SystemAudioCapture (Default) Error:', err);
        });
      } catch (err2) {
        console.error('[Main] Failed to initialize SystemAudioCapture (Default):', err2);
      }
    }

    // 2. Microphone (Input Capture)
    if (this.microphoneCapture) {
      this.microphoneCapture.stop();
      this.microphoneCapture = null;
    }

    try {
      console.log('[Main] Initializing MicrophoneCapture...');
      this.microphoneCapture = new MicrophoneCapture(inputDeviceId || undefined);
      const rate = this.microphoneCapture.getSampleRate();
      console.log(`[Main] MicrophoneCapture rate: ${rate}Hz`);
      this.googleSTT_User?.setSampleRate(rate);

      this.microphoneCapture.on('data', (chunk: Buffer) => {
        // console.log('[Main] Mic chunk', chunk.length);
        this.googleSTT_User?.write(chunk);
      });
      this.microphoneCapture.on('speech_ended', () => {
        this.googleSTT_User?.notifySpeechEnded?.();
      });
      this.microphoneCapture.on('error', (err: Error) => {
        console.error('[Main] MicrophoneCapture Error:', err);
      });
      console.log('[Main] MicrophoneCapture initialized.');
    } catch (err) {
      console.warn('[Main] Failed to initialize MicrophoneCapture with preferred ID. Falling back to default.', err);
      try {
        this.microphoneCapture = new MicrophoneCapture(); // Default
        const rate = this.microphoneCapture.getSampleRate();
        console.log(`[Main] MicrophoneCapture (Default) rate: ${rate}Hz`);
        this.googleSTT_User?.setSampleRate(rate);

        this.microphoneCapture.on('data', (chunk: Buffer) => {
          this.googleSTT_User?.write(chunk);
        });
        this.microphoneCapture.on('speech_ended', () => {
          this.googleSTT_User?.notifySpeechEnded?.();
        });
        this.microphoneCapture.on('error', (err: Error) => {
          console.error('[Main] MicrophoneCapture (Default) Error:', err);
        });
      } catch (err2) {
        console.error('[Main] Failed to initialize MicrophoneCapture (Default):', err2);
      }
    }
  }

  /**
   * Reconfigure STT provider mid-session (called from IPC when user changes provider)
   * Destroys existing STT instances and recreates them with the new provider
   */
  public async reconfigureSttProvider(): Promise<void> {
    console.log('[Main] Reconfiguring STT Provider...');

    // RC-01 fix: pause audio captures FIRST so their EventEmitter queues drain
    // before we null-out the STT instances. Without this, buffered 'data' events
    // still in-flight call this.googleSTT?.write() while googleSTT is already null.
    if (this.isMeetingActive) {
      this.systemAudioCapture?.stop();
      this.microphoneCapture?.stop();
    }

    // Now safe to destroy STT instances — no more audio events incoming
    if (this.googleSTT) {
      this.googleSTT.stop();
      this.googleSTT.removeAllListeners();
      this.googleSTT = null;
    }
    if (this.googleSTT_User) {
      this.googleSTT_User.stop();
      this.googleSTT_User.removeAllListeners();
      this.googleSTT_User = null;
    }

    // Reinitialize the pipeline (will pick up the new provider from CredentialsManager)
    this.setupSystemAudioPipeline();

    // Restart audio captures and new STT instances if a meeting is active
    if (this.isMeetingActive) {
      this.systemAudioCapture?.start();
      this.microphoneCapture?.start();
      this.googleSTT?.start();
      this.googleSTT_User?.start();
    }

    console.log('[Main] STT Provider reconfigured');
  }


  public async startAudioTest(deviceId?: string): Promise<void> {
    // P2-12: guard against two concurrent calls both passing the async permission check
    // before either has created a capture — the second call would orphan the first capture.
    if (this._audioTestStarting) return;
    this._audioTestStarting = true;
    try {
      await this._startAudioTestImpl(deviceId);
    } finally {
      this._audioTestStarting = false;
    }
  }

  private async _startAudioTestImpl(deviceId?: string): Promise<void> {
    console.log(`[Main] Starting Audio Test on device: ${deviceId || 'default'}`);
    this.stopAudioTest(); // Stop any existing test

    if (!(await ensureMacMicrophoneAccess('audio test'))) {
      throw new Error('Microphone access denied. Please allow microphone access in System Settings and try again.');
    }

    const attachAudioTestListeners = (capture: MicrophoneCapture) => {
      capture.on('data', (chunk: Buffer) => {
        const targets = [
          this.settingsWindowHelper.getSettingsWindow(),
          this.getWindowHelper().getLauncherWindow(),
          this.getWindowHelper().getOverlayWindow(),
        ].filter((win): win is BrowserWindow => !!win && !win.isDestroyed());

        if (targets.length === 0) return;

        let sum = 0;
        const step = 10;
        const len = chunk.length;

        for (let i = 0; i < len; i += 2 * step) {
          const val = chunk.readInt16LE(i);
          sum += val * val;
        }

        const count = len / (2 * step);
        if (count > 0) {
          const rms = Math.sqrt(sum / count);
          const level = Math.min(rms / 10000, 1.0);
          for (const target of targets) {
            target.webContents.send('audio-test-level', level);
          }
        }
      });

      capture.on('error', (err: Error) => {
        console.error('[Main] AudioTest Error:', err);
      });
    };

    try {
      this.audioTestCapture = new MicrophoneCapture(deviceId || undefined);
      attachAudioTestListeners(this.audioTestCapture);
      this.audioTestCapture.start();
    } catch (err) {
      console.warn('[Main] Failed to start audio test on preferred device. Falling back to default.', err);
      // RC-02 fix: explicitly stop and null the failed capture before creating
      // the fallback to prevent a brief double-microphone-capture window.
      try { this.audioTestCapture?.stop(); } catch { /* ignore errors on already-failed capture */ }
      this.audioTestCapture = null;
      try {
        this.audioTestCapture = new MicrophoneCapture();
        attachAudioTestListeners(this.audioTestCapture);
        this.audioTestCapture.start();
      } catch (fallbackErr) {
        console.error('[Main] Failed to start audio test:', fallbackErr);
        throw fallbackErr;
      }
    }
  }

  public stopAudioTest(): void {
    if (this.audioTestCapture) {
      console.log('[Main] Stopping Audio Test');
      this.audioTestCapture.stop();
      this.audioTestCapture = null;
    }
  }

  public finalizeMicSTT(): void {
    // We only want to finalize the user microphone, because the context is Manual Answer
    if (this.googleSTT_User?.finalize) {
      console.log('[Main] Finalizing STT');
      this.googleSTT_User.finalize();
    }
  }

  public async startMeeting(metadata?: any): Promise<void> {
    console.log('[Main] Starting Meeting...', metadata);

    if (!(await ensureMacMicrophoneAccess('meeting start'))) {
      const message = 'Microphone access denied. Please allow microphone access in System Settings.';
      this.broadcast('meeting-audio-error', message);
      throw new Error(message);
    }

    this.isMeetingActive = true;
    this.broadcastMeetingState();
    if (metadata) {
      this.intelligenceManager.setMeetingMetadata(metadata);
    }

    // Emit session reset to clear UI state immediately
    this.getWindowHelper().getOverlayWindow()?.webContents.send('session-reset');
    this.getWindowHelper().getLauncherWindow()?.webContents.send('session-reset');

    // ★ ASYNC AUDIO INIT: Return INSTANTLY so the IPC response goes back
    // to the renderer immediately, allowing the UI to switch to overlay
    // without waiting for SCK/audio initialization (which takes 5-7 seconds).
    // setTimeout(0) ensures setWindowMode IPC is processed first.
    setTimeout(async () => {
      // BUG-02 fix: a fast start→stop sequence can call endMeeting() before
      // this callback fires, leaving isMeetingActive=false. If that happened,
      // do NOT boot the audio pipeline — it would run forever with no stop signal.
      if (!this.isMeetingActive) {
        console.warn('[Main] Meeting was cancelled before audio pipeline could start — aborting init.');
        return;
      }
      try {
        // Check for audio configuration preference
        if (metadata?.audio) {
          await this.reconfigureAudio(metadata.audio.inputDeviceId, metadata.audio.outputDeviceId);
        }

        // LAZY INIT: Ensure pipeline is ready (if not reconfigured above)
        this.setupSystemAudioPipeline();

        // Start System Audio
        this.systemAudioCapture?.start();
        this.googleSTT?.start();

        // Start Microphone
        this.microphoneCapture?.start();
        this.googleSTT_User?.start();

        // Start JIT RAG live indexing
        if (this.ragManager) {
          this.ragManager.startLiveIndexing('live-meeting-current');
        }

        if (this._verboseLogging) {
          const requestedInput = metadata?.audio?.inputDeviceId || 'default';
          const requestedOutput = metadata?.audio?.outputDeviceId || 'default';
          const backend = requestedOutput === 'sck' ? 'sck' : 'coreaudio';
          const sysRate = this.systemAudioCapture?.getSampleRate() || 48000;
          const micRate = this.microphoneCapture?.getSampleRate() || 48000;
          console.log(`[Main][debug] Audio pipeline: input=${requestedInput} output=${requestedOutput} backend=${backend} sysRate=${sysRate}Hz micRate=${micRate}Hz`);
        }
        console.log('[Main] Audio pipeline started successfully.');
      } catch (err) {
        console.error('[Main] Error initializing audio pipeline:', err);
        // Notify UI so user knows microphone/audio failed to start
        this.broadcast('meeting-audio-error', (err as Error).message || 'Audio pipeline failed to start');
      }
    }, 0); // Defer to next event loop tick — ensures IPC response reaches renderer before audio init
  }

  public async endMeeting(): Promise<void> {
    console.log('[Main] Ending Meeting...');
    this.isMeetingActive = false; // Block new data immediately
    this.broadcastMeetingState();

    // Reset Mouse Passthrough so the next meeting overlay starts fresh and focusable
    if (this.overlayMousePassthrough) {
      this.setOverlayMousePassthrough(false);
    }

    // Stop audio captures synchronously — these are fire-and-forget internally
    this.systemAudioCapture?.stop();
    this.googleSTT?.stop();
    this.microphoneCapture?.stop();
    this.googleSTT_User?.stop();

    // Save session state and reset context — MeetingPersistence.stopMeeting() is
    // already fire-and-forget internally (processAndSaveMeeting runs in background).
    // Capture the meetingId NOW so the background IIFE uses a deterministic ID
    // rather than getRecentMeetings(1) which could return a different meeting if the
    // user starts a new session before background processing finishes.
    const meetingId = await this.intelligenceManager.stopMeeting();

    // Revert to Default Model — synchronous, no blocking I/O
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      const defaultModel = cm.getDefaultModel();
      const all = [...(cm.getCurlProviders() || []), ...(cm.getCustomProviders() || [])];
      console.log(`[Main] Reverting model to default: ${defaultModel}`);
      this.processingHelper.getLLMHelper().setModel(defaultModel, all);
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) win.webContents.send('model-changed', defaultModel);
      });
    } catch (e) {
      console.error('[Main] Failed to revert model:', e);
    }

    // ─── Background post-processing ──────────────────────────────────────────
    // These are the previously blocking operations that caused the stop-button
    // delay. They are pure background tasks with no UI dependency:
    //   • stopLiveIndexing flushes the JIT RAG live stream
    //   • processCompletedMeetingForRAG embeds the full meeting into the vector store
    //   • deleteMeetingData cleans up provisional JIT chunks
    // Chain them sequentially in the background so ordering is preserved,
    // but the IPC call returns immediately and the UI transitions without delay.
    const ragManager = this.ragManager;
    if (meetingId) {
      (async () => {
        try {
          if (ragManager) {
            await ragManager.stopLiveIndexing();
            console.log('[Main] Live RAG indexing stopped.');
          }
          await this.processCompletedMeetingForRAG(meetingId);
          // Guard: only delete live-meeting-current provisional chunks if no new
          // meeting has started while we were processing. If a new meeting IS active,
          // 'live-meeting-current' now belongs to that session — leave it alone.
          if (ragManager && !this.isMeetingActive) {
            ragManager.deleteMeetingData('live-meeting-current');
            console.log('[Main] JIT RAG provisional chunks cleaned up.');
          } else if (this.isMeetingActive) {
            console.log('[Main] New meeting started during cleanup — skipping live-meeting-current deletion.');
          }
        } catch (err) {
          console.error('[Main] Background post-meeting RAG processing failed:', err);
        }
      })();
    } else {
      // Meeting was too short — still flush the live indexer and clean up
      if (ragManager) {
        ragManager.stopLiveIndexing().catch(() => {});
        if (!this.isMeetingActive) ragManager.deleteMeetingData('live-meeting-current');
      }
    }
    // ─────────────────────────────────────────────────────────────────────────
  }

  private async processCompletedMeetingForRAG(meetingId: string): Promise<void> {
    if (!this.ragManager) return;

    try {
      // Use the explicit meetingId passed from endMeeting() — deterministic, never
      // picks up a concurrently started meeting the way getRecentMeetings(1) could.
      const meeting = DatabaseManager.getInstance().getMeetingDetails(meetingId);
      if (!meeting || !meeting.transcript || meeting.transcript.length === 0) return;

      // Convert transcript to RAG format
      const segments = meeting.transcript.map(t => ({
        speaker: t.speaker,
        text: t.text,
        timestamp: t.timestamp
      }));

      // Generate summary from detailedSummary if available
      let summary: string | undefined;
      if (meeting.detailedSummary) {
        summary = [
          ...(meeting.detailedSummary.keyPoints || []),
          ...(meeting.detailedSummary.actionItems || []).map(a => `Action: ${a}`)
        ].join('. ');
      }

      const result = await this.ragManager.processMeeting(meeting.id, segments, summary);
      console.log(`[AppState] RAG processed meeting ${meeting.id}: ${result.chunkCount} chunks`);

    } catch (error) {
      console.error('[AppState] Failed to process meeting for RAG:', error);
    }
  }

  private setupIntelligenceEvents(): void {
    const mainWindow = this.getMainWindow.bind(this)

    // Forward intelligence events to renderer
    this.intelligenceManager.on('assist_update', (insight: string) => {
      // Send to both if both exist, though mostly overlay needs it
      const helper = this.getWindowHelper();
      helper.getLauncherWindow()?.webContents.send('intelligence-assist-update', { insight });
      helper.getOverlayWindow()?.webContents.send('intelligence-assist-update', { insight });
    })

    this.intelligenceManager.on('suggested_answer', (answer: string, question: string, confidence: number) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-suggested-answer', { answer, question, confidence })
      }

    })

    this.intelligenceManager.on('suggested_answer_token', (token: string, question: string, confidence: number) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-suggested-answer-token', { token, question, confidence })
      }
    })

    this.intelligenceManager.on('refined_answer_token', (token: string, intent: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-refined-answer-token', { token, intent })
      }
    })

    this.intelligenceManager.on('refined_answer', (answer: string, intent: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-refined-answer', { answer, intent })
      }

    })

    this.intelligenceManager.on('recap', (summary: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-recap', { summary })
      }
    })

    this.intelligenceManager.on('recap_token', (token: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-recap-token', { token })
      }
    })

    this.intelligenceManager.on('clarify', (clarification: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-clarify', { clarification })
      }
    })

    this.intelligenceManager.on('clarify_token', (token: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-clarify-token', { token })
      }
    })

    this.intelligenceManager.on('follow_up_questions_update', (questions: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-follow-up-questions-update', { questions })
      }
    })

    this.intelligenceManager.on('follow_up_questions_token', (token: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-follow-up-questions-token', { token })
      }
    })

    this.intelligenceManager.on('manual_answer_started', () => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-manual-started')
      }
    })

    this.intelligenceManager.on('manual_answer_result', (answer: string, question: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-manual-result', { answer, question })
      }

    })

    this.intelligenceManager.on('mode_changed', (mode: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-mode-changed', { mode })
      }
    })

    this.intelligenceManager.on('error', (error: Error, mode: string) => {
      console.error(`[IntelligenceManager] Error in ${mode}:`, error)
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-error', { error: error.message, mode })
      }
    })
  }





  public updateGoogleCredentials(keyPath: string): void {
    console.log(`[AppState] Updating Google Credentials to: ${keyPath}`);
    // Set global environment variable so new instances pick it up
    process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;

    if (this.googleSTT) {
      this.googleSTT.setCredentials(keyPath);
    }

    if (this.googleSTT_User) {
      this.googleSTT_User.setCredentials(keyPath);
    }
  }

  public setRecognitionLanguage(key: string): void {
    console.log(`[AppState] Setting recognition language to: ${key}`);
    const { CredentialsManager } = require('./services/CredentialsManager');
    CredentialsManager.getInstance().setSttLanguage(key);
    this.googleSTT?.setRecognitionLanguage(key);
    this.googleSTT_User?.setRecognitionLanguage(key);
    this.processingHelper.getLLMHelper().setSttLanguage(key);
  }

  public static getInstance(): AppState {
    if (!AppState.instance) {
      AppState.instance = new AppState()
    }
    return AppState.instance
  }

  // Getters and Setters
  public getMainWindow(): BrowserWindow | null {
    return this.windowHelper.getMainWindow()
  }

  public getWindowHelper(): WindowHelper {
    return this.windowHelper
  }

  public getIntelligenceManager(): IntelligenceManager {
    return this.intelligenceManager
  }

  public getThemeManager(): ThemeManager {
    return this.themeManager
  }

  public getRAGManager(): RAGManager | null {
    return this.ragManager;
  }

  public getKnowledgeOrchestrator(): any {
    return this.knowledgeOrchestrator;
  }

  public getView(): "queue" | "solutions" {
    return this.view
  }

  public setView(view: "queue" | "solutions"): void {
    this.view = view
    this.screenshotHelper.setView(view)
  }

  public isVisible(): boolean {
    return this.windowHelper.isVisible()
  }

  public getScreenshotHelper(): ScreenshotHelper {
    return this.screenshotHelper
  }

  public getProblemInfo(): any {
    return this.problemInfo
  }

  public setProblemInfo(problemInfo: any): void {
    this.problemInfo = problemInfo
  }

  public getScreenshotQueue(): string[] {
    return this.screenshotHelper.getScreenshotQueue()
  }

  public getExtraScreenshotQueue(): string[] {
    return this.screenshotHelper.getExtraScreenshotQueue()
  }

  // Window management methods
  public setupOllamaIpcHandlers(): void {
    ipcMain.handle('get-ollama-models', async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout for detection

        const response = await fetch('http://localhost:11434/api/tags', {
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          // data.models is an array of objects: { name: "llama3:latest", ... }
          return data.models.map((m: any) => m.name);
        }
        return [];
      } catch (error) {
        // console.warn("Ollama detection failed:", error);
        return [];
      }
    });
  }

  public createWindow(): void {
    this.windowHelper.createWindow()
  }

  public hideMainWindow(): void {
    this.windowHelper.hideMainWindow()
  }

  public showMainWindow(inactive?: boolean): void {
    if (this.windowHelper) {
      this.windowHelper.showMainWindow(inactive)
    }
  }

  public toggleMainWindow(): void {
    console.log(
      "Screenshots: ",
      this.screenshotHelper.getScreenshotQueue().length,
      "Extra screenshots: ",
      this.screenshotHelper.getExtraScreenshotQueue().length
    )
    
    const mode = this.windowHelper.getCurrentWindowMode();
    
    if (mode === 'launcher') {
      // In launcher mode, just physically hide/show the window
      this.windowHelper.toggleMainWindow();
    } else {
      // In overlay mode, send toggle-expand IPC to expand/collapse the UI
      const targetWindow = this.windowHelper.getOverlayWindow();
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('toggle-expand');
      }
    }
  }

  public setWindowDimensions(width: number, height: number): void {
    this.windowHelper.setWindowDimensions(width, height)
  }

  public clearQueues(): void {
    this.screenshotHelper.clearQueues()

    // Clear problem info
    this.problemInfo = null

    // Reset view to initial state
    this.setView("queue")
  }

  private createScreenshotCaptureSession(
    captureKind: ScreenshotCaptureKind,
    restoreFocus: boolean
  ): ScreenshotCaptureSession {
    const settingsWindow = this.settingsWindowHelper.getSettingsWindow();
    const modelSelectorWindow = this.modelSelectorWindowHelper.getWindow();

    return {
      captureKind,
      wasMainWindowVisible: this.windowHelper.isVisible(),
      windowMode: this.windowHelper.getCurrentWindowMode(),
      wasSettingsVisible: !!settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible(),
      wasModelSelectorVisible: !!modelSelectorWindow && !modelSelectorWindow.isDestroyed() && modelSelectorWindow.isVisible(),
      overlayBounds: this.windowHelper.getLastOverlayBounds(),
      overlayDisplayId: this.windowHelper.getLastOverlayDisplayId(),
      restoreWithoutFocus: process.platform === 'darwin' || !restoreFocus
    };
  }

  private getDisplayById(displayId: number | null): Electron.Display | undefined {
    if (displayId === null) return undefined;
    return screen.getAllDisplays().find(display => display.id === displayId);
  }

  private getTargetDisplayForFullScreenshot(session: ScreenshotCaptureSession): Electron.Display {
    if (session.windowMode === 'overlay' && session.overlayBounds) {
      return screen.getDisplayMatching(session.overlayBounds);
    }

    const lastOverlayDisplay = this.getDisplayById(session.overlayDisplayId);
    if (lastOverlayDisplay) {
      return lastOverlayDisplay;
    }

    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  }

  private hideWindowsForScreenshot(session: ScreenshotCaptureSession): void {
    if (session.wasModelSelectorVisible) {
      this.modelSelectorWindowHelper.hideWindow();
    }

    if (session.wasSettingsVisible) {
      this.settingsWindowHelper.closeWindow();
    }

    if (session.wasMainWindowVisible) {
      this.hideMainWindow();
    }
  }

  private restoreWindowsAfterScreenshot(session: ScreenshotCaptureSession): void {
    const activate = !session.restoreWithoutFocus;
    const shouldRestoreMainWindow = session.wasMainWindowVisible;

    if (shouldRestoreMainWindow) {
      if (session.windowMode === 'overlay') {
        this.windowHelper.switchToOverlay(!activate);
      } else {
        this.windowHelper.switchToLauncher(!activate);
      }
    }

    if (session.wasSettingsVisible) {
      const settingsWindow = this.settingsWindowHelper.getSettingsWindow();
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        const { x, y } = settingsWindow.getBounds();
        this.settingsWindowHelper.showWindow(x, y, { activate });
      }
    }

    if (session.wasModelSelectorVisible) {
      const modelSelectorWindow = this.modelSelectorWindowHelper.getWindow();
      if (modelSelectorWindow && !modelSelectorWindow.isDestroyed()) {
        const { x, y } = modelSelectorWindow.getBounds();
        this.modelSelectorWindowHelper.showWindow(x, y, { activate });
      }
    }
  }

  private async withScreenshotCaptureSession<T>(
    captureKind: ScreenshotCaptureKind,
    restoreFocus: boolean,
    capture: (session: ScreenshotCaptureSession) => Promise<T>
  ): Promise<T> {
    if (!this.getMainWindow()) {
      throw new Error("No main window available");
    }

    if (this.screenshotCaptureInProgress) {
      throw new Error("Screenshot capture already in progress");
    }

    const session = this.createScreenshotCaptureSession(captureKind, restoreFocus);
    this.screenshotCaptureInProgress = true;

    try {
      this.hideWindowsForScreenshot(session);
      await new Promise(resolve => setTimeout(resolve, 50));
      return await capture(session);
    } finally {
      try {
        this.restoreWindowsAfterScreenshot(session);
      } finally {
        this.screenshotCaptureInProgress = false;
      }
    }
  }

  // Screenshot management methods
  public async takeScreenshot(restoreFocus: boolean = true): Promise<string> {
    return this.withScreenshotCaptureSession('full', restoreFocus, (session) =>
      this.screenshotHelper.takeScreenshot(this.getTargetDisplayForFullScreenshot(session))
    )
  }

  public async takeSelectiveScreenshot(restoreFocus: boolean = true): Promise<string> {
    return this.withScreenshotCaptureSession('selective', restoreFocus, async () => {
      let captureArea: Electron.Rectangle | undefined;

      if (process.platform === 'win32' || process.platform === 'darwin') {
        captureArea = await this.cropperWindowHelper.showCropper();

        if (!captureArea) {
          throw new Error("Selection cancelled");
        }
      }

      return this.screenshotHelper.takeSelectiveScreenshot(captureArea)
    })
  }

  public async getImagePreview(filepath: string): Promise<string> {
    return this.screenshotHelper.getImagePreview(filepath)
  }

  public async deleteScreenshot(
    path: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.screenshotHelper.deleteScreenshot(path)
  }

  // New methods to move the window
  public moveWindowLeft(): void {
    this.windowHelper.moveWindowLeft()
  }

  public moveWindowRight(): void {
    this.windowHelper.moveWindowRight()
  }
  public moveWindowDown(): void {
    this.windowHelper.moveWindowDown()
  }
  public moveWindowUp(): void {
    this.windowHelper.moveWindowUp()
  }

  public centerAndShowWindow(): void {
    this.windowHelper.centerAndShowWindow()
  }

  public createTray(): void {
    this.showTray();
  }

  public showTray(): void {
    if (this.tray) return;

    // Try to find a template image first for macOS
    const resourcesPath = app.isPackaged ? process.resourcesPath : app.getAppPath();

    // Potential paths for tray icon
    const templatePath = path.join(resourcesPath, 'assets', 'iconTemplate.png');
    const defaultIconPath = app.isPackaged
      ? path.join(resourcesPath, 'src/components/icon.png')
      : path.join(app.getAppPath(), 'src/components/icon.png');

    let iconToUse = defaultIconPath;

    // Check if template exists (sync check is fine for startup/rare toggle)
    try {
      if (require('fs').existsSync(templatePath)) {
        iconToUse = templatePath;
        console.log('[Tray] Using template icon:', templatePath);
      } else {
        // Also check src/components for dev
        const devTemplatePath = path.join(app.getAppPath(), 'src/components/iconTemplate.png');
        if (require('fs').existsSync(devTemplatePath)) {
          iconToUse = devTemplatePath;
          console.log('[Tray] Using dev template icon:', devTemplatePath);
        } else {
          console.log('[Tray] Template icon not found, using default:', defaultIconPath);
        }
      }
    } catch (e) {
      console.error('[Tray] Error checking for icon:', e);
    }

    const trayIcon = nativeImage.createFromPath(iconToUse).resize({ width: 16, height: 16 });
    // IMPORTANT: specific template settings for macOS if needed, but 'Template' in name usually suffices
    trayIcon.setTemplateImage(iconToUse.endsWith('Template.png'));

    this.tray = new Tray(trayIcon)
    this.tray.setToolTip('Natively') // This tooltip might also need update if we change global shortcut, but global shortcut is removed.
    this.updateTrayMenu();

    // Double-click to show window
    this.tray.on('double-click', () => {
      this.centerAndShowWindow()
    })
  }

  public updateTrayMenu() {
    if (!this.tray) return;

    const keybindManager = KeybindManager.getInstance();
    const screenshotAccel = keybindManager.getKeybind('general:take-screenshot') || 'CommandOrControl+H';

    console.log('[Main] updateTrayMenu called. Screenshot Accelerator:', screenshotAccel);

    // Update tooltip for verification
    this.tray.setToolTip('Natively');

    // Helper to format accelerator for display (e.g. CommandOrControl+H -> Cmd+H)
    const formatAccel = (accel: string) => {
      return accel
        .replace('CommandOrControl', 'Cmd')
        .replace('Command', 'Cmd')
        .replace('Control', 'Ctrl')
        .replace('OrControl', '') // Cleanup just in case
        .replace(/\+/g, '+');
    };

    const displayScreenshot = formatAccel(screenshotAccel);
    // We can also get the toggle visibility shortcut if desired
    const toggleKb = keybindManager.getKeybind('general:toggle-visibility');
    const toggleAccel = toggleKb || 'CommandOrControl+B';
    const displayToggle = formatAccel(toggleAccel);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show Natively',
        click: () => {
          this.centerAndShowWindow()
        }
      },
      {
        label: `Toggle Window (${displayToggle})`,
        click: () => {
          this.toggleMainWindow()
        }
      },
      {
        type: 'separator'
      },
      {
        label: `Take Screenshot (${displayScreenshot})`,
        accelerator: screenshotAccel,
        click: async () => {
          try {
            const screenshotPath = await this.takeScreenshot()
            const preview = await this.getImagePreview(screenshotPath)
            const mainWindow = this.getMainWindow()
            if (mainWindow) {
              mainWindow.webContents.send("screenshot-taken", {
                path: screenshotPath,
                preview
              })
            }
          } catch (error) {
            console.error("Error taking screenshot from tray:", error)
          }
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Quit',
        accelerator: 'Command+Q',
        click: () => {
          app.quit()
        }
      }
    ])

    this.tray.setContextMenu(contextMenu)
  }

  public hideTray(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  public setHasDebugged(value: boolean): void {
    this.hasDebugged = value
  }

  public getHasDebugged(): boolean {
    return this.hasDebugged
  }

  public setUndetectable(state: boolean): void {
    // Guard: skip if state hasn't actually changed to prevent
    // duplicate dock hide/show cycles from renderer feedback loops
    if (this.isUndetectable === state) return;

    console.log(`[Stealth] setUndetectable(${state}) called`);

    this.isUndetectable = state
    this.windowHelper.setContentProtection(state)
    this.settingsWindowHelper.setContentProtection(state)
    this.modelSelectorWindowHelper.setContentProtection(state)
    this.cropperWindowHelper.setContentProtection(state)

    // Persist state via SettingsManager
    SettingsManager.getInstance().set('isUndetectable', state);

    // Cancel all pending disguise timers to prevent their app.setName() calls
    // from re-registering the dock icon after we hide it
    if (state) {
      for (const timer of this._disguiseTimers) {
        clearTimeout(timer);
      }
      this._disguiseTimers = [];
    }

    // Broadcast state change to all relevant windows
    this._broadcastToAllWindows('undetectable-changed', state);

    // --- STEALTH MODE LOGIC ---
    // The dock hide/show is debounced: rapid toggles update isUndetectable immediately
    // (so content protection, IPC broadcasts and the guard above are always current),
    // but the actual macOS dock/tray/focus operation only fires once the user stops
    // toggling. This eliminates the race where dock.show() + NSApp.activate() lingers
    // after a subsequent dock.hide() call.
    if (process.platform === 'darwin') {
      if (this._dockDebounceTimer) {
        clearTimeout(this._dockDebounceTimer);
        this._dockDebounceTimer = null;
      }

      this._dockDebounceTimer = setTimeout(() => {
        this._dockDebounceTimer = null;

        // Read the settled state — may differ from the `state` captured above
        // if the user toggled again before the timer fired.
        const settled = this.isUndetectable;

        const activeWindow = this.windowHelper.getMainWindow();
        const settingsWindow = this.settingsWindowHelper.getSettingsWindow();
        let targetFocusWindow = activeWindow;
        if (settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible()) {
          targetFocusWindow = settingsWindow;
        }

        const modelSelectorWindow = this.modelSelectorWindowHelper.getWindow();
        const isModelSelectorVisible = modelSelectorWindow && !modelSelectorWindow.isDestroyed() && modelSelectorWindow.isVisible();

        if (targetFocusWindow && targetFocusWindow === settingsWindow) {
          this.settingsWindowHelper.setIgnoreBlur(true);
        }
        if (isModelSelectorVisible) {
          this.modelSelectorWindowHelper.setIgnoreBlur(true);
        }

        if (settled) {
          // Capture whether Natively is currently the frontmost app BEFORE
          // dock.hide() — that call triggers an implicit macOS app-deactivation
          // which shifts keyboard focus to the next frontmost app (Chrome, etc.).
          const nativelyWasFocused =
            targetFocusWindow != null &&
            !targetFocusWindow.isDestroyed() &&
            targetFocusWindow.isFocused();

          console.log('[Stealth] Calling app.dock.hide()');
          app.dock.hide();
          this.hideTray();

          // If Natively was the focused window when the user toggled stealth,
          // restore focus to our window after dock.hide() so macOS does not
          // hand control to Chrome / whatever is behind us.
          // We use win.focus() (not app.focus()) to avoid the heavy-handed
          // [NSApp activateIgnoringOtherApps:YES] side-effect.
          if (nativelyWasFocused && targetFocusWindow && !targetFocusWindow.isDestroyed()) {
            targetFocusWindow.focus();
          }
        } else {
          console.log('[Stealth] Calling app.dock.show()');
          app.dock.show();
          this.showTray();
          // Do NOT call focus() — let the user's current app retain focus
        }

        if (targetFocusWindow && targetFocusWindow === settingsWindow) {
          setTimeout(() => { this.settingsWindowHelper.setIgnoreBlur(false); }, 500);
        }
        if (isModelSelectorVisible) {
          setTimeout(() => { this.modelSelectorWindowHelper.setIgnoreBlur(false); }, 500);
        }
      }, 150);
    }
  }

  public getUndetectable(): boolean {
    return this.isUndetectable
  }

  // --- Mouse Passthrough (Adapted from public PR #113 — verify premium interaction) ---
  private overlayMousePassthrough: boolean = false;

  public setOverlayMousePassthrough(state: boolean): void {
    if (this.overlayMousePassthrough === state) return;

    console.log(`[Overlay] setOverlayMousePassthrough(${state}) called`);

    this.overlayMousePassthrough = state;
    this.windowHelper.syncOverlayInteractionPolicy();
    this._broadcastToAllWindows('overlay-mouse-passthrough-changed', state);
  }

  public toggleOverlayMousePassthrough(): boolean {
    const next = !this.overlayMousePassthrough;
    this.setOverlayMousePassthrough(next);
    return next;
  }

  public getOverlayMousePassthrough(): boolean {
    return this.overlayMousePassthrough;
  }

  public getVerboseLogging(): boolean {
    return this._verboseLogging;
  }

  public setVerboseLogging(enabled: boolean): void {
    this._verboseLogging = enabled;
    setVerboseLoggingFlag(enabled);
    SettingsManager.getInstance().set('verboseLogging', enabled);
    console.log(`[AppState] verboseLogging set to ${enabled}`);
  }

  public setDisguise(mode: 'terminal' | 'settings' | 'activity' | 'none'): void {
    this.disguiseMode = mode;
    SettingsManager.getInstance().set('disguiseMode', mode);

    // Apply the disguise regardless of undetectable state
    // (disguise affects Activity Monitor name via process.title,
    //  dock icon only updates when NOT in stealth)
    this._applyDisguise(mode);
  }

  public applyInitialDisguise(): void {
    this._applyDisguise(this.disguiseMode);
  }

  private _applyDisguise(mode: 'terminal' | 'settings' | 'activity' | 'none'): void {
    let appName = "Natively";
    let iconPath = "";

    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    switch (mode) {
      case 'terminal':
        appName = isWin ? "Command Prompt " : "Terminal ";
        if (isWin) {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "assets/fakeicon/win/terminal.png")
            : path.join(app.getAppPath(), "assets/fakeicon/win/terminal.png");
        } else {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "assets/fakeicon/mac/terminal.png")
            : path.join(app.getAppPath(), "assets/fakeicon/mac/terminal.png");
        }
        break;
      case 'settings':
        appName = isWin ? "Settings " : "System Settings ";
        if (isWin) {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "assets/fakeicon/win/settings.png")
            : path.join(app.getAppPath(), "assets/fakeicon/win/settings.png");
        } else {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "assets/fakeicon/mac/settings.png")
            : path.join(app.getAppPath(), "assets/fakeicon/mac/settings.png");
        }
        break;
      case 'activity':
        appName = isWin ? "Task Manager " : "Activity Monitor ";
        if (isWin) {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "assets/fakeicon/win/activity.png")
            : path.join(app.getAppPath(), "assets/fakeicon/win/activity.png");
        } else {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "assets/fakeicon/mac/activity.png")
            : path.join(app.getAppPath(), "assets/fakeicon/mac/activity.png");
        }
        break;
      case 'none':
        appName = "Natively";
        if (isMac) {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "natively.icns")
            : path.join(app.getAppPath(), "assets/natively.icns");
        } else if (isWin) {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "assets/icons/win/icon.ico")
            : path.join(app.getAppPath(), "assets/icons/win/icon.ico");
        } else {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "icon.png")
            : path.join(app.getAppPath(), "assets/icon.png");
        }
        break;
    }

    console.log(`[AppState] Applying disguise: ${mode} (${appName}) on ${process.platform}`);

    // 1. Update process title (affects Activity Monitor / Task Manager)
    process.title = appName;

    // 2. Update app name (affects macOS Menu / Dock)
    // Skip when undetectable — app.setName() causes macOS to re-register
    // the app and re-show the dock icon even after dock.hide()
    if (!this.isUndetectable) {
      app.setName(appName);
    }

    if (isMac) {
      process.env.CFBundleName = appName.trim();
    }

    // 3. Update App User Model ID (Windows Taskbar grouping)
    if (isWin) {
      // Use unique AUMID per disguise to avoid grouping with the real app
      app.setAppUserModelId(`com.natively.assistant.${mode}`);
    }

    // 4. Update Icons
    if (fs.existsSync(iconPath)) {
      const image = nativeImage.createFromPath(iconPath);

      if (isMac) {
        // Skip dock icon update when dock is hidden to avoid potential flicker
        if (!this.isUndetectable) {
          app.dock.setIcon(image);
        }
      } else {
        // Windows/Linux: Update all window icons
        this.windowHelper.getLauncherWindow()?.setIcon(image);
        this.windowHelper.getOverlayWindow()?.setIcon(image);
        this.settingsWindowHelper.getSettingsWindow()?.setIcon(image);
      }
    } else {
      console.warn(`[AppState] Disguise icon not found: ${iconPath}`);
    }

    // 5. Update Window Titles
    const launcher = this.windowHelper.getLauncherWindow();
    if (launcher && !launcher.isDestroyed()) {
      launcher.setTitle(appName.trim());
      launcher.webContents.send('disguise-changed', mode);
    }

    const overlay = this.windowHelper.getOverlayWindow();
    if (overlay && !overlay.isDestroyed()) {
      overlay.setTitle(appName.trim());
      overlay.webContents.send('disguise-changed', mode);
    }

    const settingsWin = this.settingsWindowHelper.getSettingsWindow();
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.setTitle(appName.trim());
      settingsWin.webContents.send('disguise-changed', mode);
    }

    // Cancel any stale forceUpdate timeouts from previous disguise changes
    for (const timer of this._disguiseTimers) {
      clearTimeout(timer);
    }
    this._disguiseTimers = [];

    // Periodically re-assert process.title only — it can drift on some systems.
    // NOTE: We intentionally do NOT call app.setName() here — it was already called
    // synchronously above, and repeated calls on macOS cause the system to briefly
    // show a second dock tile while re-registering the app identity.
    const scheduleUpdate = (ms: number) => {
      const ts = setTimeout(() => {
        process.title = appName;
        this._disguiseTimers = this._disguiseTimers.filter(t => t !== ts);
      }, ms);
      this._disguiseTimers.push(ts);
    };

    scheduleUpdate(200);
    scheduleUpdate(1000);
    scheduleUpdate(5000);
  }

  // Helper: broadcast an IPC event to all windows
  private _broadcastToAllWindows(channel: string, ...args: any[]): void {
    const windows = [
      this.windowHelper.getMainWindow(),
      this.windowHelper.getLauncherWindow(),
      this.windowHelper.getOverlayWindow(),
      this.settingsWindowHelper.getSettingsWindow(),
      this.modelSelectorWindowHelper.getWindow(),
    ];
    const sent = new Set<number>();
    for (const win of windows) {
      if (win && !win.isDestroyed() && !sent.has(win.id)) {
        sent.add(win.id);
        win.webContents.send(channel, ...args);
      }
    }
  }

  public getDisguise(): string {
    return this.disguiseMode;
  }
}

// Application initialization

async function initializeApp() {
  // 1. Enforce single instance — prevent duplicate dock icons from leftover processes.
  // In development mode with hot-reload this is still safe because electron is restarted
  // by the build step, not re-launched by concurrently while the old process is alive.
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    console.log('[Main] Another instance is already running. Quitting this instance.');
    app.quit();
    return;
  }

  // 2. Wait for app to be ready
  await app.whenReady()

  // 2a. PRE-EMPTIVE dock hide: must happen before ANY operation that causes macOS to
  // register a dock entry (app.setName, BrowserWindow creation, etc.).
  // We read isUndetectable directly from settings here — AppState singleton isn't
  // constructed yet, so we cannot call appState.getUndetectable().
  if (process.platform === 'darwin') {
    // SettingsManager is already statically imported — no require() needed.
    const isUndetectableOnStartup = SettingsManager.getInstance().get('isUndetectable') ?? false;
    if (isUndetectableOnStartup) {
      app.dock.hide();
    }
  }

  // 3. Initialize Managers
  // Initialize CredentialsManager and load keys explicitly
  // This fixes the issue where keys (especially in production) aren't loaded in time for RAG/LLM
  const { CredentialsManager } = require('./services/CredentialsManager');
  CredentialsManager.getInstance().init();

  // 4. Initialize State
  const appState = AppState.getInstance()

  // Explicitly load credentials into helpers
  appState.processingHelper.loadStoredCredentials();

  // Initialize IPC handlers before window creation
  initializeIpcHandlers(appState)

  // Apply the full disguise payload (names, dock icon, AUMID) early
  appState.applyInitialDisguise();

  // Start the Ollama lifecycle manager
  OllamaManager.getInstance().init().catch(console.error);

  // NOTE: CredentialsManager.init() and loadStoredCredentials() are already called
  // above before this block — do NOT call them again here to avoid double key-load.

  // Anonymous install ping - one-time, non-blocking
  // See electron/services/InstallPingManager.ts for privacy details
  const { sendAnonymousInstallPing } = require('./services/InstallPingManager');
  sendAnonymousInstallPing();

  // Load stored Google Service Account path (for Speech-to-Text)
  // Fall back to GOOGLE_APPLICATION_CREDENTIALS env var (set in terminal but not Spotlight)
  const storedServiceAccountPath = CredentialsManager.getInstance().getGoogleServiceAccountPath()
    || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (storedServiceAccountPath) {
    console.log("[Init] Loading stored Google Service Account path");
    appState.updateGoogleCredentials(storedServiceAccountPath);
    // Persist env-var path so Spotlight launches also work going forward
    if (!CredentialsManager.getInstance().getGoogleServiceAccountPath()) {
      CredentialsManager.getInstance().setGoogleServiceAccountPath(storedServiceAccountPath);
    }
  }

  console.log("App is ready")

  appState.createWindow()

  // Apply initial stealth state based on isUndetectable setting.
  // NOTE: app.dock.hide() was already called pre-emptively before createWindow()
  // when isUndetectable=true. Here we only need to initialize the tray for non-stealth mode.
  if (!appState.getUndetectable()) {
    // Normal mode: show tray (dock is already showing — no need to call dock.show() again)
    appState.showTray();
  }
  // Stealth mode: dock is already hidden, tray stays hidden, no action needed here.
  // Register global shortcuts using KeybindManager
  KeybindManager.getInstance().registerGlobalShortcuts()

  // Pre-create settings window in background for faster first open
  appState.settingsWindowHelper.preloadWindow()

  // Initialize CalendarManager
  try {
    const { CalendarManager } = require('./services/CalendarManager');
    const calMgr = CalendarManager.getInstance();
    calMgr.init();

    calMgr.on('start-meeting-requested', (event: any) => {
      console.log('[Main] Start meeting requested from calendar notification', event);
      appState.centerAndShowWindow();
      appState.startMeeting({
        title: event.title,
        calendarEventId: event.id,
        source: 'calendar'
      });
    });

    calMgr.on('open-requested', () => {
      appState.centerAndShowWindow();
    });

    console.log('[Main] CalendarManager initialized');
  } catch (e) {
    console.error('[Main] Failed to initialize CalendarManager:', e);
  }

  // Recover unprocessed meetings (persistence check)
  appState.getIntelligenceManager().recoverUnprocessedMeetings().catch(err => {
    console.error('[Main] Failed to recover unprocessed meetings:', err);
  });

  // Note: We do NOT force dock show here anymore, respecting stealth mode.

  app.on("activate", () => {
    console.log("App activated")
    if (process.platform === 'darwin') {
      // Do NOT call dock.show() while a meeting is running — the dock icon
      // appearing mid-meeting is a critical stealth failure.
      if (!appState.getUndetectable() && !appState.getIsMeetingActive()) {
        app.dock.show();
      }
    }
    
    // If no window exists, create it
    if (appState.getMainWindow() === null) {
      appState.createWindow()
    } else {
      // If the window exists but is hidden, clicking the dock icon should restore it
      if (!appState.isVisible()) {
        appState.toggleMainWindow();
      }
    }
  })

  // Quit when all windows are closed, except on macOS
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
    }
  })

  // Scrub API keys from memory on quit to minimize exposure window
  app.on("before-quit", (event) => {
    console.log("App is quitting, cleaning up resources...");
    appState.setQuitting(true);

    // Dispose CropperWindowHelper to clean up IPC listeners and prevent memory leaks
    // This is critical to prevent resource leaks and ensure proper cleanup
    if (appState?.cropperWindowHelper) {
      appState.cropperWindowHelper.dispose();
    }

    // Kill Ollama if we started it
    OllamaManager.getInstance().stop();

    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().scrubMemory();
      appState.processingHelper.getLLMHelper().scrubKeys();
      console.log('[Main] Credentials scrubbed from memory on quit');
    } catch (e) {
      console.error('[Main] Failed to scrub credentials on quit:', e);
    }
  })



  // app.dock?.hide() // REMOVED: User wants Dock icon visible
  app.commandLine.appendSwitch("disable-background-timer-throttling")
}

// Start the application
initializeApp().catch(console.error)
