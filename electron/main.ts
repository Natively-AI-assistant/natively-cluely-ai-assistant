import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, systemPreferences, screen, desktopCapturer } from "electron"
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

/**
 * Check macOS Screen Recording (kTCCServiceScreenCapture) permission status.
 *
 * Electron has no askForMediaAccess('screen') API — macOS only shows the TCC
 * dialog when the app actually calls a protected API (SCK / CoreAudio tap).
 * If the permission is 'denied', we cannot re-prompt; the user must re-enable
 * manually in System Settings → Privacy & Security → Screen Recording.
 *
 * Returns false only when the permission is explicitly 'denied'. All other
 * statuses ('granted', 'not-determined', 'restricted') return true because:
 *   - 'granted':         already allowed — nothing to do.
 *   - 'not-determined':  macOS will show the dialog when SCK/CoreAudio tap runs.
 *   - 'restricted':      managed device policy — nothing we can do programmatically.
 */
function getMacScreenCaptureStatus(): 'granted' | 'denied' | 'not-determined' | 'restricted' {
  if (process.platform !== 'darwin') return 'granted';
  
  // In development mode, macOS TCC often falsely reports 'denied' for the electron binary 
  // even if the user has granted permission to their Terminal app.
  if (!app.isPackaged) {
    console.log('[Main] Ignoring screen capture permission check in development mode');
    return 'granted';
  }

  try {
    return systemPreferences.getMediaAccessStatus('screen') as
      'granted' | 'denied' | 'not-determined' | 'restricted';
  } catch (error) {
    console.error('[Main] Failed to check screen recording permission:', error);
    return 'not-determined';
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
import { scanAudioSourcePids } from "./audio/audioSourcePidScanner"
import { MicrophoneCapture } from "./audio/MicrophoneCapture"
import { GoogleSTT } from "./audio/GoogleSTT"
import { RestSTT } from "./audio/RestSTT"
import { DeepgramStreamingSTT } from "./audio/DeepgramStreamingSTT"
import { SonioxStreamingSTT } from "./audio/SonioxStreamingSTT"
import { ElevenLabsStreamingSTT } from "./audio/ElevenLabsStreamingSTT"
import { OpenAIStreamingSTT } from "./audio/OpenAIStreamingSTT"
import { NativelyProSTT } from "./audio/NativelyProSTT"
import { ThemeManager } from "./ThemeManager"
import { RAGManager } from "./rag/RAGManager"
import { DatabaseManager } from "./db/DatabaseManager"
import { warmupIntentClassifier } from "./llm"

/** Unified type for all STT providers with optional extended capabilities */
type STTProvider = (GoogleSTT | RestSTT | DeepgramStreamingSTT | SonioxStreamingSTT | ElevenLabsStreamingSTT | OpenAIStreamingSTT | NativelyProSTT) & {
  finalize?: () => void;
  setAudioChannelCount?: (count: number) => void;
  notifySpeechEnded?: () => void;
};

type ScreenshotWindowMode = 'launcher' | 'overlay';

/** Payload for stt-status IPC events broadcast from main to renderer */
interface SttStatusPayload {
  state: 'connected' | 'reconnecting' | 'failed';
  provider: string;
  error?: string;
  channel: 'user' | 'interviewer';
  reconnectAttempts?: number;
}
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

import { KnowledgeOrchestrator } from './knowledge/KnowledgeOrchestrator';
import { KnowledgeDatabaseManager } from './knowledge/KnowledgeDatabaseManager';
const KnowledgeOrchestratorClass: any = KnowledgeOrchestrator;
const KnowledgeDatabaseManagerClass: any = KnowledgeDatabaseManager;

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
          // Route to renderer via global-shortcut so the renderer handles the
          // screenshot through the IPC invoke path (request/response guarantee).
          // The old pattern — main takes screenshot → fires screenshot-taken event →
          // renderer listener catches it — was unreliable in overlay mode because the
          // fire-and-forget event could be missed if the listener registration had any
          // timing gap. The invoke path used by generalHandlers.takeScreenshot() is
          // already proven to work for UI-button screenshots; reuse it here.
          const mainWindow = this.getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('global-shortcut', { action: 'takeScreenshot' });
          }
        } else if (actionId === 'general:selective-screenshot') {
          const mainWindow = this.getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('global-shortcut', { action: 'selectiveScreenshot' });
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

    // Restore toggle states that live in LLMHelper memory.
    // This MUST happen here — not inside initializeRAGManager() — so that
    // it runs unconditionally regardless of whether premium modules are available.
    // Previously, groqFastTextMode restore was inside the KnowledgeOrchestrator
    // block which silently skips when premium modules are absent.
    {
      const llmHelper = this.processingHelper.getLLMHelper();
      if (settingsManager.get('groqFastTextMode')) {
        llmHelper.setGroqFastTextMode(true);
        console.log('[AppState] Fast mode restored from settings');
      }
      // Restore custom notes for non-premium path
      try {
        const savedNotes = DatabaseManager.getInstance().getCustomNotes();
        if (savedNotes) {
          llmHelper.setCustomNotes(savedNotes);
        }
      } catch (_) {}
    }

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

    this.ensureKnowledgeOrchestrator();
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
  private sourceAudioTestCapture: SystemAudioCapture | null = null; // For audio settings source meter
  private _sourceAudioTestStarting = false;
  private systemAudioLevelSamples: number = 0;
  private systemAudioRmsTotal: number = 0;
  private systemAudioSilenceWarned: boolean = false;
  private lastSystemAudioActiveAt: number = 0;

  // Rolling RMS history for speaker attribution. Each entry is { ts, rms }.
  // We keep ~2s of frames per channel and consult the peak of the recent
  // window when deciding whether a mic transcript is the local user or
  // bleed from the speakers picking up the interviewer.
  private micRmsHistory: Array<{ ts: number; rms: number }> = [];
  private sysRmsHistory: Array<{ ts: number; rms: number }> = [];
  private static readonly RMS_HISTORY_WINDOW_MS = 2000;
  private googleSTT: STTProvider | null = null; // Interviewer
  private googleSTT_User: STTProvider | null = null; // User

  private createSTTProvider(speaker: 'interviewer' | 'user'): STTProvider | null {
    const { CredentialsManager } = require('./services/CredentialsManager');
    const sttProvider = CredentialsManager.getInstance().getSttProvider();
    const sttLanguage = CredentialsManager.getInstance().getSttLanguage();
    const envDeepgramKey = process.env.DEEPGRAM_API_KEY?.trim();
    const effectiveSttProvider =
      sttProvider === 'none' && envDeepgramKey ? 'deepgram' : sttProvider;

    // 'none' means the user has explicitly disabled STT (no provider selected).
    // Return null so the pipeline skips STT without falling back to Google.
    if (effectiveSttProvider === 'none') {
      console.log(`[Main] STT provider is 'none' — audio capture will proceed but transcription is disabled.`);
      return null;
    }

    let stt: STTProvider;

    if (effectiveSttProvider === 'natively') {
      const nativelyKey = CredentialsManager.getInstance().getNativelyApiKey();
      if (!nativelyKey) {
        // Natively is Coming Soon — no key means degrade gracefully like every other provider
        console.warn(`[Main] No Natively API Key configured for ${speaker}, falling back to GoogleSTT`);
        stt = new GoogleSTT(speaker);
      } else {
        // 'system' for interviewer (system audio), 'mic' for user (microphone).
        // The server uses ${key}:${channel} as the session key so both streams
        // can coexist without triggering concurrent_session_blocked.
        stt = new NativelyProSTT(nativelyKey, speaker === 'interviewer' ? 'system' : 'mic');
      }
    } else if (effectiveSttProvider === 'deepgram') {
      const apiKey = CredentialsManager.getInstance().getDeepgramApiKey() || envDeepgramKey;
      if (apiKey) {
        if (sttProvider === 'none' && envDeepgramKey)
          console.log(`[Main] STT provider unset — using DEEPGRAM_API_KEY from .env for ${speaker}`);
        console.log(`[Main] Using DeepgramStreamingSTT for ${speaker}`);
        stt = new DeepgramStreamingSTT(apiKey, speaker);
      } else {
        console.warn(`[Main] No API key for Deepgram STT, falling back to GoogleSTT`);
        stt = new GoogleSTT(speaker);
      }
    } else if (effectiveSttProvider === 'soniox') {
      const apiKey = CredentialsManager.getInstance().getSonioxApiKey();
      if (apiKey) {
        console.log(`[Main] Using SonioxStreamingSTT for ${speaker}`);
        stt = new SonioxStreamingSTT(apiKey);
      } else {
        console.warn(`[Main] No API key for Soniox STT, falling back to GoogleSTT`);
        stt = new GoogleSTT(speaker);
      }
    } else if (effectiveSttProvider === 'elevenlabs') {
      const apiKey = CredentialsManager.getInstance().getElevenLabsApiKey();
      if (apiKey) {
        console.log(`[Main] Using ElevenLabsStreamingSTT for ${speaker}`);
        stt = new ElevenLabsStreamingSTT(apiKey);
      } else {
        console.warn(`[Main] No API key for ElevenLabs STT, falling back to GoogleSTT`);
        stt = new GoogleSTT(speaker);
      }
    } else if (effectiveSttProvider === 'openai') {
      // OpenAI: WebSocket Realtime (gpt-4o-transcribe → gpt-4o-mini-transcribe) with whisper-1 REST fallback
      const apiKey = CredentialsManager.getInstance().getOpenAiSttApiKey();
      if (apiKey) {
        console.log(`[Main] Using OpenAIStreamingSTT (WebSocket+REST fallback) for ${speaker}`);
        stt = new OpenAIStreamingSTT(apiKey);
      } else {
        console.warn(`[Main] No API key for OpenAI STT, falling back to GoogleSTT`);
        stt = new GoogleSTT(speaker);
      }
    } else if (effectiveSttProvider === 'groq' || effectiveSttProvider === 'azure' || effectiveSttProvider === 'ibmwatson') {
      let apiKey: string | undefined;
      let region: string | undefined;
      let modelOverride: string | undefined;

      if (effectiveSttProvider === 'groq') {
        apiKey = CredentialsManager.getInstance().getGroqSttApiKey();
        modelOverride = CredentialsManager.getInstance().getGroqSttModel();
      } else if (effectiveSttProvider === 'azure') {
        apiKey = CredentialsManager.getInstance().getAzureApiKey();
        region = CredentialsManager.getInstance().getAzureRegion();
      } else if (effectiveSttProvider === 'ibmwatson') {
        apiKey = CredentialsManager.getInstance().getIbmWatsonApiKey();
        region = CredentialsManager.getInstance().getIbmWatsonRegion();
      }

      if (apiKey) {
        console.log(`[Main] Using RestSTT (${effectiveSttProvider}) for ${speaker}`);
        stt = new RestSTT(effectiveSttProvider, apiKey, modelOverride, region);
      } else {
        console.warn(`[Main] No API key for ${effectiveSttProvider} STT, falling back to GoogleSTT`);
        stt = new GoogleSTT(speaker);
      }
    } else {
      stt = new GoogleSTT(speaker);
    }

    stt.setRecognitionLanguage(sttLanguage);

    // Wire Transcript Events
    stt.on('transcript', (segment: { text: string, isFinal: boolean, confidence: number }) => {
      if (!this.isMeetingActive) {
        return;
      }

      const routedSpeaker =
        speaker === 'user' && this.shouldRouteMicrophoneAsInterviewer(segment.text)
          ? 'interviewer'
          : speaker;
      if (routedSpeaker !== speaker && segment.text.trim()) {
        const micMean = this.meanRmsSince(this.micRmsHistory, 1500);
        const sysMean = this.meanRmsSince(this.sysRmsHistory, 1500);
        const dominance = this.sysDominanceFraction(1500, 1.5);
        console.log(
          `[Main] Relabeling mic transcript as interviewer (sysMean=${sysMean.toFixed(0)} vs micMean=${micMean.toFixed(0)}, dominance=${(dominance * 100).toFixed(0)}%): "${segment.text.substring(0, 60)}..."`
        );
      }

      this.intelligenceManager.handleTranscript({
        speaker: routedSpeaker,
        text: segment.text,
        timestamp: Date.now(),
        final: segment.isFinal,
        confidence: segment.confidence
      });

      // Feed final transcript to JIT RAG indexer
      if (segment.isFinal && this.ragManager) {
        this.ragManager.feedLiveTranscript([{
          speaker: routedSpeaker,
          text: segment.text,
          timestamp: Date.now()
        }]);
      }

      const helper = this.getWindowHelper();
      const payload = {
        speaker: routedSpeaker,
        text: segment.text,
        timestamp: Date.now(),
        final: segment.isFinal,
        confidence: segment.confidence
      };
      helper.getLauncherWindow()?.webContents.send('native-audio-transcript', payload);
      helper.getOverlayWindow()?.webContents.send('native-audio-transcript', payload);

      // Feed final recruiter (system audio) transcripts to negotiation tracker
      if (segment.isFinal && routedSpeaker === 'interviewer') {
        this.knowledgeOrchestrator?.feedInterviewerUtterance?.(segment.text);
      }
    });

    // Consecutive failure counter — reset on any successful final transcript
    let _consecutiveErrors = 0;

    // Track state so we broadcast 'connected' on recovery from failed/reconnecting
    let _lastState: 'connected' | 'reconnecting' | 'failed' = 'reconnecting';

    stt.on('error', (err: Error) => {
      console.error(`[Main] STT (${speaker}) Error:`, err);

      // Extract richer error info from Axios errors (RestSTT)
      let errorMessage = err.message;
      const axiosErr = err as any;
      const httpStatus = axiosErr?.response?.status || 0;
      if (axiosErr?.response?.data?.error) {
        const respErr = axiosErr.response.data.error;
        const respMsg = typeof respErr === 'string' ? respErr : (respErr.message || respErr.code || JSON.stringify(respErr));
        errorMessage = httpStatus ? `${httpStatus} ${respMsg}` : respMsg;
      } else if (httpStatus) {
        errorMessage = `${httpStatus} ${axiosErr.response.statusText}`;
      }

      // Immediately fatal: auth/account problems — no amount of retrying helps
      const isAuthError = httpStatus === 401
        || err.message.toLowerCase().includes('auth_timeout')
        || err.message.toLowerCase().includes('invalid_key')
        || err.message.toLowerCase().includes('invalid api')
        || err.message.toLowerCase().includes('authentication');

      const isQuotaError = err.message.toLowerCase().includes('transcription_quota_exceeded')
        || err.message.toLowerCase().includes('quota');

      if (isAuthError) {
        _consecutiveErrors = 0;
        _lastState = 'failed';
        this.broadcast('stt-status', {
          state: 'failed',
          provider: sttProvider,
          error: errorMessage,
          channel: speaker,
        } as SttStatusPayload);
        return;
      }

      // Retryable: network drop, timeout, 5xx, 400, 429, WS drop
      _consecutiveErrors++;
      const maxErrors = 5;

      if (_consecutiveErrors >= maxErrors || isQuotaError) {
        _lastState = 'failed';
        this.broadcast('stt-status', {
          state: 'failed',
          provider: sttProvider,
          error: isQuotaError
            ? errorMessage
            : `STT provider failed (${_consecutiveErrors} consecutive errors): ${errorMessage}`,
          channel: speaker,
          reconnectAttempts: _consecutiveErrors,
        } as SttStatusPayload);
      } else {
        _lastState = 'reconnecting';
        this.broadcast('stt-status', {
          state: 'reconnecting',
          provider: sttProvider,
          error: errorMessage,
          channel: speaker,
          reconnectAttempts: _consecutiveErrors,
        } as SttStatusPayload);
      }
    });

    // Track successful transcripts — resets consecutive error counter
    // Broadcasts 'connected' whenever we recover from reconnecting/failed
    stt.on('transcript', (segment: { text: string, isFinal: boolean, confidence: number }) => {
      if (segment.isFinal) {
        _consecutiveErrors = 0; // Success — reset counter
        if (_lastState !== 'connected') {
          _lastState = 'connected';
          this.broadcast('stt-status', {
            state: 'connected',
            provider: sttProvider,
            channel: speaker,
          } as SttStatusPayload);
        }
      }
    });

    // Auto language detection: NativelyProSTT emits 'languageDetected' when the
    // backend resolves the language from the first audio batch. Notify the renderer
    // so the settings UI can show what was detected.
    if (stt instanceof NativelyProSTT) {
      stt.on('languageDetected', (bcp47: string) => {
        console.log(`[Main] STT language auto-detected (${speaker}): ${bcp47}`);
        const helper = this.getWindowHelper();
        helper.getMainWindow()?.webContents.send('stt-language-auto-detected', bcp47);
        helper.getLauncherWindow()?.webContents.send('stt-language-auto-detected', bcp47);
      });
    }

    return stt;
  }

  /**
   * Default bundle-id prefix allowlist passed to CoreAudio's per-process tap. CoreAudio
   * enumerates *every* audio process and unions in any whose bundle_id starts with one
   * of these — far more reliable than guessing the right Chromium subprocess from `ps`,
   * because the audio-producing helper has a `com.google.Chrome.helper.*` bundle id but
   * its executable name is just "Google Chrome Helper".
   */
  private resolveAudioSourceBundleIds(): string[] {
    if (process.platform !== 'darwin') return [];
    if (process.env.NATIVELY_DISABLE_PER_APP_TAP === '1') return [];
    return [
      'com.google.Chrome',
      'com.brave.Browser',
      'com.microsoft.edgemac',
      'org.mozilla.firefox',
      'com.apple.Safari',
      'company.thebrowser.Browser', // Arc
      'com.vivaldi.Vivaldi',
      'com.operasoftware.Opera',
      'com.microsoft.teams',
      'com.microsoft.teams2',
      'us.zoom.xos',
      'com.tinyspeck.slackmacgap',
      'com.cisco.webexmeetingsapp',
      'com.hnc.Discord',
      'com.apple.FaceTime',
    ];
  }

  /**
   * Scan for PIDs of likely meeting-audio producers (browsers, Zoom/Teams/etc.) so the
   * macOS CoreAudio Tap can capture only their audio. Eliminates mic-bleed because the
   * tap no longer receives audio that's also being played to physical speakers.
   *
   * Set env NATIVELY_DISABLE_PER_APP_TAP=1 (or pass empty extra hints) to fall back to
   * the global tap behavior when this heuristic doesn't fit a particular workflow.
   */
  private resolveAudioSourcePids(): number[] {
    if (process.platform !== 'darwin') return [];
    if (process.env.NATIVELY_DISABLE_PER_APP_TAP === '1') {
      console.log('[Main] Per-app system audio tap disabled via NATIVELY_DISABLE_PER_APP_TAP');
      return [];
    }
    try {
      const matches = scanAudioSourcePids();
      if (matches.length === 0) {
        console.log('[Main] No browser/meeting processes found — using global system audio tap');
        return [];
      }
      const pids = matches.map((m) => m.pid);
      console.log(
        `[Main] Per-app system audio tap targeting ${matches.length} process(es): ` +
          matches.map((m) => `${m.pid}=${m.command.split('/').pop() || m.command}`).join(', '),
      );
      return pids;
    } catch (err) {
      console.warn('[Main] resolveAudioSourcePids failed, falling back to global tap:', (err as Error).message);
      return [];
    }
  }

  private setupSystemAudioPipeline(): void {
    // REMOVED EARLY RETURN: if (this.systemAudioCapture && this.microphoneCapture) return; // Already initialized

    try {
      // 1. Initialize Captures if missing
      // If they already exist (e.g. from reconfigureAudio), they are already wired to write to this.googleSTT/User
      if (!this.systemAudioCapture) {
        this.systemAudioCapture = new SystemAudioCapture(undefined, this.effectiveAudioSourcePids(), this.effectiveAudioSourceBundleIds());
        // Wire Capture -> STT
        let _sysChunkCount = 0;
        this.systemAudioCapture.on('data', (chunk: Buffer) => {
          _sysChunkCount++;
          this.observeSystemAudioChunk('SystemAudio->STT', _sysChunkCount, chunk);
          this.googleSTT?.write(chunk);
        });
        this.systemAudioCapture.on('sample_rate_changed', (rate: number) => {
          console.log(`[Main] SystemAudioCapture rate updated dynamically to ${rate}Hz`);
          // Forward to ALL active STT providers — STTProvider union includes setSampleRate
          this.googleSTT?.setSampleRate(rate);
        });
        this.systemAudioCapture.on('speech_ended', () => {
          this.googleSTT?.notifySpeechEnded?.();
        });
        // PR #173: Wire audio recovery handler — handles both logging and auto-restart.
        // NOTE: Do NOT add a separate 'error' listener here; setupAudioRecoveryHandler
        // registers its own which logs + recovers. Dual listeners would double-fire.
        this.setupAudioRecoveryHandler();
      }

      if (!this.microphoneCapture) {
        this.microphoneCapture = new MicrophoneCapture();
        this.microphoneCapture.on('data', (chunk: Buffer) => {
          this.observeMicrophoneChunk(chunk);
          this.googleSTT_User?.write(chunk);
        });
        this.microphoneCapture.on('sample_rate_changed', (rate: number) => {
          console.log(`[Main] MicrophoneCapture rate updated dynamically to ${rate}Hz`);
          // Forward to ALL active STT providers — STTProvider union includes setSampleRate
          this.googleSTT_User?.setSampleRate(rate);
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
        const { CredentialsManager } = require('./services/CredentialsManager');
        const sttProv = CredentialsManager.getInstance().getSttProvider();
        console.log(`[Main] Creating interviewer STT provider: ${sttProv}`);
        this.googleSTT = this.createSTTProvider('interviewer');
      }

      if (!this.googleSTT_User) {
        const { CredentialsManager } = require('./services/CredentialsManager');
        const sttProv = CredentialsManager.getInstance().getSttProvider();
        console.log(`[Main] Creating user STT provider: ${sttProv}`);
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

  /** PIDs explicitly chosen by the user via the Audio Source picker in settings.
   *  When set, takes precedence over `resolveAudioSourcePids()` auto-detection. */
  private manualAudioSourcePids: number[] = [];
  private manualAudioSourceBundleIds: string[] = [];

  public setManualAudioSourcePids(pids: number[]): void {
    this.setManualAudioSourceFilter({ pids, bundleIds: [] });
  }

  public setManualAudioSourceFilter(filter: { pids?: number[]; bundleIds?: string[] }): void {
    this.manualAudioSourcePids = Array.isArray(filter?.pids)
      ? filter.pids.filter((p) => Number.isFinite(p) && p > 0)
      : [];
    this.manualAudioSourceBundleIds = Array.isArray(filter?.bundleIds)
      ? filter.bundleIds.filter((b) => typeof b === 'string' && b.trim().length > 0)
      : [];
    console.log(
      `[Main] Manual audio source filter: pids=${this.manualAudioSourcePids.join(', ') || '(none)'} ` +
      `bundleIds=${this.manualAudioSourceBundleIds.join(', ') || '(none)'} ` +
      `${this.manualAudioSourcePids.length === 0 && this.manualAudioSourceBundleIds.length === 0 ? '(auto)' : ''}`,
    );
  }

  private effectiveAudioSourcePids(): number[] {
    if (this.manualAudioSourceBundleIds.length > 0) return [];
    if (this.manualAudioSourcePids.length > 0) return this.manualAudioSourcePids;
    return this.resolveAudioSourcePids();
  }

  /** Bundle filters are skipped when the user has made a manual selection — the manual
   *  PIDs are authoritative and we don't want auto-discovery silently widening the tap. */
  private effectiveAudioSourceBundleIds(): string[] {
    if (this.manualAudioSourceBundleIds.length > 0) return this.manualAudioSourceBundleIds;
    if (this.manualAudioSourcePids.length > 0) return [];
    return this.resolveAudioSourceBundleIds();
  }

  private getPcm16Level(chunk: Buffer): { rms: number; peak: number } {
    let sumSquares = 0;
    let peak = 0;
    let count = 0;

    for (let i = 0; i + 1 < chunk.length; i += 2) {
      const sample = chunk.readInt16LE(i);
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
      sumSquares += sample * sample;
      count++;
    }

    return {
      rms: count > 0 ? Math.sqrt(sumSquares / count) : 0,
      peak,
    };
  }

  private observeSystemAudioChunk(label: string, chunkCount: number, chunk: Buffer): void {
    const level = this.getPcm16Level(chunk);
    this.systemAudioLevelSamples++;
    this.systemAudioRmsTotal += level.rms;
    if (level.rms >= 80 || level.peak >= 500) {
      this.lastSystemAudioActiveAt = Date.now();
    }
    this.recordRms(this.sysRmsHistory, level.rms);

    if (chunkCount <= 3 || chunkCount % 200 === 0) {
      console.log(
        `[Main] ${label}: chunk #${chunkCount}, ${chunk.length}B, ` +
        `rms=${level.rms.toFixed(1)}, peak=${level.peak}, googleSTT=${this.googleSTT ? 'active' : 'NULL'}`,
      );
    }

    if (!this.systemAudioSilenceWarned && this.systemAudioLevelSamples >= 200) {
      const avgRms = this.systemAudioRmsTotal / this.systemAudioLevelSamples;
      if (avgRms < 20) {
        this.systemAudioSilenceWarned = true;
        console.warn(
          `[Main] System audio is effectively silent (avgRms=${avgRms.toFixed(1)}). ` +
          'If the source is playing, do not mute macOS output; use headphones, a low output volume, or a virtual output device instead.',
        );
      }
    }
  }

  private recordRms(history: Array<{ ts: number; rms: number }>, rms: number): void {
    const now = Date.now();
    history.push({ ts: now, rms });
    const cutoff = now - AppState.RMS_HISTORY_WINDOW_MS;
    // Trim the head while it's older than the window. The arrays are appended
    // chronologically, so a single forward sweep is enough.
    let drop = 0;
    while (drop < history.length && history[drop].ts < cutoff) drop++;
    if (drop > 0) history.splice(0, drop);
  }

  private peakRmsSince(history: Array<{ ts: number; rms: number }>, sinceMs: number): number {
    const cutoff = Date.now() - sinceMs;
    let peak = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i];
      if (entry.ts < cutoff) break;
      if (entry.rms > peak) peak = entry.rms;
    }
    return peak;
  }

  private meanRmsSince(history: Array<{ ts: number; rms: number }>, sinceMs: number): number {
    const cutoff = Date.now() - sinceMs;
    let sum = 0;
    let count = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i];
      if (entry.ts < cutoff) break;
      sum += entry.rms;
      count++;
    }
    return count === 0 ? 0 : sum / count;
  }

  private sysDominanceFraction(sinceMs: number, marginRatio: number): number {
    const cutoff = Date.now() - sinceMs;
    const sysSlice = this.sysRmsHistory.filter(e => e.ts >= cutoff);
    if (sysSlice.length === 0) return 0;
    let dominantSamples = 0;
    for (const sysEntry of sysSlice) {
      let micRms = 0;
      let bestDelta = Infinity;
      for (const micEntry of this.micRmsHistory) {
        const delta = Math.abs(micEntry.ts - sysEntry.ts);
        if (delta < bestDelta) {
          bestDelta = delta;
          micRms = micEntry.rms;
        }
        if (micEntry.ts > sysEntry.ts + 100) break;
      }
      if (sysEntry.rms > micRms * marginRatio) dominantSamples++;
    }
    return dominantSamples / sysSlice.length;
  }

  private observeMicrophoneChunk(chunk: Buffer): void {
    const level = this.getPcm16Level(chunk);
    this.recordRms(this.micRmsHistory, level.rms);
  }

  private shouldRouteMicrophoneAsInterviewer(text: string): boolean {
    // The mic almost always doubles as a speaker echo channel: when the user
    // is on built-in speakers, anything Chrome/Zoom plays back leaks into the
    // mic and Deepgram transcribes it as if the user spoke.
    //
    // Earlier versions used peak RMS over a single 1.5s window, which mislabeled
    // legitimate user speech whenever a brief system-audio spike (a notification
    // ding, a transient interviewer syllable) coincided with quieter user speech.
    // The fix: require *sustained* system-audio dominance — both the mean energy
    // over the window AND the fraction of samples where sys > mic must clear
    // their thresholds. Mean RMS is robust to transient peaks; the dominance
    // fraction confirms it's not just one loud half-second.
    const normalized = text.trim();
    if (!normalized) return false;

    const WINDOW_MS = 1500;
    const micMean = this.meanRmsSince(this.micRmsHistory, WINDOW_MS);
    const sysMean = this.meanRmsSince(this.sysRmsHistory, WINDOW_MS);
    const micPeak = this.peakRmsSince(this.micRmsHistory, WINDOW_MS);
    const sysPeak = this.peakRmsSince(this.sysRmsHistory, WINDOW_MS);

    // No meaningful sustained source audio → keep on user channel.
    // Use mean (not peak) so a single transient spike doesn't trip relabeling.
    if (sysMean < 60) return false;

    // Barge-in carveout (strengthened): if the mic shows sustained speech-like
    // energy — mean above the typical bleed floor (~250–350) AND a real peak
    // (>=600) — the user is actually talking. Bleed is a roughly continuous
    // noise floor; speech has both a higher floor and clear peaks. Both
    // conditions must hold to avoid a single mic spike rescuing pure echo.
    const MIC_SUSTAINED_SPEECH_MEAN = 350;
    const MIC_SPEECH_PEAK_FLOOR = 600;
    if (micMean >= MIC_SUSTAINED_SPEECH_MEAN && micPeak >= MIC_SPEECH_PEAK_FLOOR) {
      // Even with sustained mic speech, allow relabeling only if the system
      // audio is overwhelmingly louder (e.g. user is on speakers and the
      // mic is fully drowned out by a loud playback) — otherwise treat as
      // genuine user speech.
      if (sysMean < micMean * 2.5) return false;
    }

    // Sustained dominance check: at least 60% of recent system-audio samples
    // must outweigh the (time-aligned) mic by >=1.5x. This prevents a single
    // ~300ms peak from triggering relabel.
    const dominanceFraction = this.sysDominanceFraction(WINDOW_MS, 1.5);
    if (dominanceFraction < 0.6) return false;

    // Mean dominance — the average source energy over the window must beat
    // the average mic energy by >=1.4x. Combined with the dominance fraction
    // above, this ensures we only relabel when the source is loudly and
    // consistently dominant, not when peaks happen to align.
    if (sysMean > micMean * 1.4 && sysPeak > micPeak * 1.2) return true;

    return false;
  }

  private async reconfigureAudio(inputDeviceId?: string, outputDeviceId?: string, enableVoiceProcessing?: boolean): Promise<void> {
    console.log(
      `[Main] Reconfiguring Audio: Input=${inputDeviceId}, Output=${outputDeviceId}, AEC=${enableVoiceProcessing ? 'on' : 'off'}`
    );

    // 1. System Audio (Output Capture)
    if (this.systemAudioCapture) {
      // destroy() calls stop() AND removeAllListeners(), preventing EventEmitter listener leaks.
      // Using stop()+null would orphan all 'data', 'speech_ended', 'sample_rate_changed'
      // closures (they still hold a ref to `this`) and trigger them on the next meeting.
      this.systemAudioCapture.destroy();
      this.systemAudioCapture = null;
    }

    try {
      console.log('[Main] Initializing SystemAudioCapture...');
      this.systemAudioCapture = new SystemAudioCapture(outputDeviceId || undefined, this.effectiveAudioSourcePids(), this.effectiveAudioSourceBundleIds());
      const rate = this.systemAudioCapture.getSampleRate();
      console.log(`[Main] SystemAudioCapture rate: ${rate}Hz`);
      this.googleSTT?.setSampleRate(rate);

      let _rcfgSysChunkCount = 0;
      this.systemAudioCapture.on('data', (chunk: Buffer) => {
        _rcfgSysChunkCount++;
        this.observeSystemAudioChunk('(Reconfigured) SystemAudio->STT', _rcfgSysChunkCount, chunk);
        this.googleSTT?.write(chunk);
      });
      this.systemAudioCapture.on('sample_rate_changed', (rate: number) => {
        console.log(`[Main] (Reconfigured) SystemAudioCapture rate updated dynamically to ${rate}Hz`);
        this.googleSTT?.setSampleRate(rate);
      });
      this.systemAudioCapture.on('speech_ended', () => {
        this.googleSTT?.notifySpeechEnded?.();
      });
      // PR #173: Re-wire recovery handler on the new capture instance after device reconfigure.
      // Without this, audio recovery is lost whenever the user changes their output device.
      this.setupAudioRecoveryHandler();
      console.log('[Main] SystemAudioCapture initialized.');
    } catch (err) {
      console.warn('[Main] Failed to initialize SystemAudioCapture with preferred ID. Falling back to default.', err);
      try {
        this.systemAudioCapture = new SystemAudioCapture(undefined, this.effectiveAudioSourcePids(), this.effectiveAudioSourceBundleIds()); // Default
        const rate = this.systemAudioCapture.getSampleRate();
        console.log(`[Main] SystemAudioCapture (Default) rate: ${rate}Hz`);
        this.googleSTT?.setSampleRate(rate);

        let _dfltSysChunkCount = 0;
        this.systemAudioCapture.on('data', (chunk: Buffer) => {
          _dfltSysChunkCount++;
          this.observeSystemAudioChunk('(Default) SystemAudio->STT', _dfltSysChunkCount, chunk);
          this.googleSTT?.write(chunk);
        });
        this.systemAudioCapture.on('sample_rate_changed', (rate: number) => {
          console.log(`[Main] (Reconfigured Default) SystemAudioCapture rate updated dynamically to ${rate}Hz`);
          this.googleSTT?.setSampleRate(rate);
        });
        this.systemAudioCapture.on('speech_ended', () => {
          this.googleSTT?.notifySpeechEnded?.();
        });
        // PR #173: Recovery handler on fallback path too
        this.setupAudioRecoveryHandler();
      } catch (err2) {
        console.error('[Main] Failed to initialize SystemAudioCapture (Default):', err2);
      }
    }

    // 2. Microphone (Input Capture)
    if (this.microphoneCapture) {
      // destroy() calls stop() AND removeAllListeners(), preventing EventEmitter listener leaks.
      this.microphoneCapture.destroy();
      this.microphoneCapture = null;
    }

    try {
      console.log('[Main] Initializing MicrophoneCapture...');
      this.microphoneCapture = new MicrophoneCapture(inputDeviceId || undefined);
      // Forward the AEC preference to the wrapper. If the native module hasn't
      // been rebuilt with voice-processing support yet, the wrapper logs the
      // request and gracefully no-ops — preserving today's behavior while
      // letting the toggle round-trip end-to-end.
      this.microphoneCapture.setVoiceProcessing?.(enableVoiceProcessing === true);
      const rate = this.microphoneCapture.getSampleRate();
      console.log(`[Main] MicrophoneCapture rate: ${rate}Hz`);
      this.googleSTT_User?.setSampleRate(rate);

      this.microphoneCapture.on('data', (chunk: Buffer) => {
        this.observeMicrophoneChunk(chunk);
        this.googleSTT_User?.write(chunk);
      });
      this.microphoneCapture.on('sample_rate_changed', (rate: number) => {
        console.log(`[Main] (Reconfigured) MicrophoneCapture rate updated dynamically to ${rate}Hz`);
        this.googleSTT_User?.setSampleRate(rate);
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
          this.observeMicrophoneChunk(chunk);
          this.googleSTT_User?.write(chunk);
        });
        this.microphoneCapture.on('sample_rate_changed', (rate: number) => {
          console.log(`[Main] (Reconfigured Default) MicrophoneCapture rate updated dynamically to ${rate}Hz`);
          this.googleSTT_User?.setSampleRate(rate);
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

    // Only reinitialize the pipeline when a meeting is already active.
    // Outside a meeting, defer pipeline creation to startMeeting() so we never
    // eagerly construct a MicrophoneCapture (which calls build_input_stream on
    // macOS and immediately triggers the orange mic indicator even without .play()).
    if (this.isMeetingActive) {
      this.setupSystemAudioPipeline();
      this.systemAudioCapture?.start();
      this.microphoneCapture?.start();
      this.googleSTT?.start();
      this.googleSTT_User?.start();
    }

    console.log('[Main] STT Provider reconfigured');

    // Broadcast the new STT config state to all windows so they can update banners / warnings
    const { CredentialsManager: CM } = require('./services/CredentialsManager');
    const newProvider = CM.getInstance().getSttProvider();
    this.broadcast('stt-config-changed', { configured: newProvider !== 'none', provider: newProvider });
  }

  /**
   * PR #173: Audio Recovery Handler
   *
   * Listens for 'audio-capture-failed' emit from SystemAudioCapture and
   * transparently restarts the full capture + STT pipeline without ending the
   * meeting session. Prevents silent audio loss when macOS CoreAudio or SCK
   * drops the capture stream mid-session (e.g. device re-plug, Display Sleep).
   */
  private _systemAudioRecoveryInProgress = false;
  private _systemAudioRecoveryAttempts = 0;
  private _systemAudioRecoveryTimer: NodeJS.Timeout | null = null;
  private _systemAudioLastFailureAt: number | null = null;
  private _systemAudioSuccessfulRestarts = 0;
  private _systemAudioConsecutiveFailures = 0;

  private setupAudioRecoveryHandler(): void {
    if (!this.systemAudioCapture) return;

    this.systemAudioCapture.on('error', async (err: Error) => {
      if (!this.isMeetingActive) return; // Only attempt recovery during active meetings

      const now = Date.now();
      this._systemAudioLastFailureAt = now;
      this._systemAudioConsecutiveFailures++;

      // Cap at 3 consecutive recovery attempts to avoid infinite restart loops
      if (this._systemAudioRecoveryInProgress || this._systemAudioRecoveryAttempts >= 3) {
        console.warn(
          `[AudioRecovery] Skipping recovery — already in progress or max attempts (${this._systemAudioRecoveryAttempts}/3) reached.`,
        );
        return;
      }

      this._systemAudioRecoveryInProgress = true;
      this._systemAudioRecoveryAttempts++;
      console.warn(
        `[AudioRecovery] SystemAudioCapture error — attempting recovery #${this._systemAudioRecoveryAttempts}: ${err.message}`,
      );

      try {
        // Brief delay so the OS can release the device before re-acquisition
        await new Promise<void>(resolve => {
          this._systemAudioRecoveryTimer = setTimeout(resolve, 1500);
        });
        this._systemAudioRecoveryTimer = null;

        // Restart the audio captures without disturbing the STT provider or the session
        this.systemAudioCapture?.stop();
        this.systemAudioCapture?.start();

        this._systemAudioSuccessfulRestarts++;
        this._systemAudioConsecutiveFailures = 0;
        console.log(
          `[AudioRecovery] SystemAudioCapture restarted successfully (total restarts: ${this._systemAudioSuccessfulRestarts}).`,
        );
      } catch (recoveryErr: any) {
        console.error(`[AudioRecovery] Recovery attempt #${this._systemAudioRecoveryAttempts} failed:`, recoveryErr);
      } finally {
        this._systemAudioRecoveryInProgress = false;
      }
    });
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

  public async startSourceAudioTest(filter?: { pids?: number[]; bundleIds?: string[]; outputDeviceId?: string }): Promise<void> {
    if (this._sourceAudioTestStarting) return;
    this._sourceAudioTestStarting = true;
    try {
      this.stopSourceAudioTest();

      // Don't spin up a second tap during a live meeting — the active capture
      // already feeds the interviewer STT and a duplicate could fight for the
      // CoreAudio aggregate device. The meter is a pre-meeting setup tool.
      if (this.isMeetingActive) {
        console.log('[Main] Skipping source audio test: meeting is active');
        return;
      }

      const pids = Array.isArray(filter?.pids)
        ? filter!.pids.filter((p) => Number.isFinite(p) && p > 0)
        : [];
      const bundleIds = Array.isArray(filter?.bundleIds)
        ? filter!.bundleIds.filter((b) => typeof b === 'string' && b.length > 0)
        : [];
      const outputDeviceId = typeof filter?.outputDeviceId === 'string' && filter.outputDeviceId.length > 0
        ? filter.outputDeviceId
        : undefined;

      console.log(`[Main] Starting Source Audio Test. pids=[${pids.join(',')}] bundleIds=[${bundleIds.join(',')}] output=${outputDeviceId || 'default'}`);

      try {
        this.sourceAudioTestCapture = new SystemAudioCapture(outputDeviceId, pids, bundleIds);
      } catch (e) {
        console.error('[Main] Failed to create SystemAudioCapture for source test:', e);
        this.sourceAudioTestCapture = null;
        return;
      }

      this.sourceAudioTestCapture.on('data', (chunk: Buffer) => {
        const targets = [
          this.settingsWindowHelper.getSettingsWindow(),
          this.getWindowHelper().getLauncherWindow(),
          this.getWindowHelper().getOverlayWindow(),
        ].filter((win): win is BrowserWindow => !!win && !win.isDestroyed());

        if (targets.length === 0) return;

        const { rms } = this.getPcm16Level(chunk);
        // Match the mic meter scaling so the two bars are visually comparable.
        const level = Math.min(rms / 10000, 1.0);
        for (const target of targets) {
          target.webContents.send('source-audio-test-level', level);
        }
      });

      this.sourceAudioTestCapture.on('error', (err: Error) => {
        console.error('[Main] SourceAudioTest Error:', err);
      });

      this.sourceAudioTestCapture.start();
    } finally {
      this._sourceAudioTestStarting = false;
    }
  }

  public stopSourceAudioTest(): void {
    if (this.sourceAudioTestCapture) {
      console.log('[Main] Stopping Source Audio Test');
      // destroy() also removes listeners so any in-flight Rust callback won't
      // fire on a disposed instance.
      this.sourceAudioTestCapture.destroy();
      this.sourceAudioTestCapture = null;
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

    // PR #173: Reset audio recovery state for fresh session
    this._systemAudioRecoveryInProgress = false;
    this._systemAudioRecoveryAttempts = 0;
    this._systemAudioConsecutiveFailures = 0;
    this.systemAudioLevelSamples = 0;
    this.systemAudioRmsTotal = 0;
    this.systemAudioSilenceWarned = false;
    this.lastSystemAudioActiveAt = 0;
    this.micRmsHistory = [];
    this.sysRmsHistory = [];
    if (this._systemAudioRecoveryTimer) {
      clearTimeout(this._systemAudioRecoveryTimer);
      this._systemAudioRecoveryTimer = null;
    }

    // Tear down the audio settings preview taps before bringing up the live
    // ones; otherwise the meeting capture could collide with a leftover meter.
    this.stopAudioTest();
    this.stopSourceAudioTest();

    if (!(await ensureMacMicrophoneAccess('meeting start'))) {
      const message = 'Microphone access denied. Please allow microphone access in System Settings.';
      this.broadcast('meeting-audio-error', message);
      throw new Error(message);
    }

    // Check Screen Recording permission required for system audio capture
    // (CoreAudio Global Process Tap + ScreenCaptureKit both need this).
    // NOTE: The 'not-determined' TCC dialog is triggered once at app startup
    // (in initializeApp) so it never pops up mid-meeting here. We only act on
    // explicit 'denied' — in that case warn the user but let the meeting continue
    // with microphone-only transcription.
    if (process.platform === 'darwin') {
      const screenStatus = getMacScreenCaptureStatus();
      console.log(`[Main] macOS screen recording permission status: ${screenStatus}`);
      if (screenStatus === 'denied') {
        // Permission was explicitly denied — warn the user via the UI but do NOT
        // auto-open System Settings. Forcing that window open every meeting start
        // is extremely disruptive, especially when mic transcription is still working.
        // The UI will show a non-blocking banner; the user can fix it deliberately.
        const message = 'Screen Recording permission denied. System audio will not be captured. To fix: System Settings → Privacy & Security → Screen Recording → enable Natively.';
        console.warn('[Main]', message);
        this.broadcast('system-audio-permission-denied', message);
        // NOTE: Do NOT call shell.openExternal() here — it hijacks focus on every meeting
        // start. The UI banner (system-audio-permission-denied IPC event) handles this.
      }
      // 'not-determined': Handled at startup. SCK/CoreAudio will trigger the TCC
      // dialog itself when it first attempts to access screen content.
    }

    this.isMeetingActive = true;
    this.broadcastMeetingState()
    if (metadata) {
      this.intelligenceManager.setMeetingMetadata(metadata);
    }

    // Reset overlay position to default center so each new meeting starts
    // with the overlay in a predictable centered position, regardless of where
    // the user moved it during the previous meeting session.
    this.windowHelper.resetOverlayPosition();

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
          await this.reconfigureAudio(
            metadata.audio.inputDeviceId,
            metadata.audio.outputDeviceId,
            metadata.audio.enableVoiceProcessing,
          );
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

    // 'auto' is only meaningful for NativelyProSTT — other providers fall back to en-US.
    const sttProvider = CredentialsManager.getInstance().getSttProvider();
    const effectiveKey = (key === 'auto' && sttProvider !== 'natively') ? 'english-us' : key;

    this.googleSTT?.setRecognitionLanguage(effectiveKey);
    this.googleSTT_User?.setRecognitionLanguage(effectiveKey);
    this.processingHelper.getLLMHelper().setSttLanguage(effectiveKey);
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
    if (!this.knowledgeOrchestrator) {
      this.ensureKnowledgeOrchestrator();
    }
    return this.knowledgeOrchestrator;
  }

  private ensureKnowledgeOrchestrator(): void {
    if (this.knowledgeOrchestrator) return;
    try {
      const db = DatabaseManager.getInstance();
      const sqliteDb = db.getDb();

      if (!sqliteDb || !KnowledgeDatabaseManagerClass || !KnowledgeOrchestratorClass) {
        console.warn('[AppState] KnowledgeOrchestrator dependencies missing:', {
          sqliteDb: !!sqliteDb,
          KnowledgeDatabaseManagerClass: !!KnowledgeDatabaseManagerClass,
          KnowledgeOrchestratorClass: !!KnowledgeOrchestratorClass,
        });
        return;
      }

      const knowledgeDb = new KnowledgeDatabaseManagerClass(sqliteDb);
      this.knowledgeOrchestrator = new KnowledgeOrchestratorClass(knowledgeDb);

      const llmHelper = this.processingHelper.getLLMHelper();

      this.knowledgeOrchestrator.setGenerateContentFn(async (contents: any[]) => {
        return await llmHelper.generateContentStructured(contents[0]?.text || '');
      });

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

      llmHelper.setKnowledgeOrchestrator(this.knowledgeOrchestrator);

      const sm = SettingsManager.getInstance();
      if (sm.get('knowledgeMode')) {
        this.knowledgeOrchestrator.setKnowledgeMode(true);
        console.log('[AppState] Knowledge mode restored from settings');
      }

      const savedNotes = DatabaseManager.getInstance().getCustomNotes();
      if (savedNotes) {
        this.knowledgeOrchestrator.setCustomNotes(savedNotes);
        llmHelper.setCustomNotes(savedNotes);
        console.log('[AppState] Custom notes restored');
      }

      console.log('[AppState] KnowledgeOrchestrator initialized');
    } catch (error: any) {
      console.error('[AppState] Failed to initialize KnowledgeOrchestrator:', error?.message ?? error);
      console.error(error?.stack);
    }
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
      // setOpacity(0) makes the window invisible to the compositor immediately
      // (within the current frame). hide() removes it from the event dispatch
      // tree synchronously. One compositor frame flush (~16ms) is enough for
      // macOS to stop including the window in the next capture frame. We wait
      // 80ms to give the GPU render server one full v-sync cycle + overhead,
      // which consistently avoids the black-frame artifact without the
      // excessive 150ms latency the old value imposed.
      await new Promise(resolve => setTimeout(resolve, process.platform === 'darwin' ? 80 : 40));
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

    // Immediately revalidate global shortcuts after the window interaction-policy
    // changes.  The OS can silently drop Carbon/IOKit hotkey registrations when
    // window focusability or visibility changes; revalidating surgically
    // re-registers any that were lost without clobbering the others.
    KeybindManager.getInstance().revalidateShortcuts();

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
    // Notify all renderer windows so they can start/stop forwarding their console output
    this.broadcast('verbose-logging-changed', enabled);
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

  // One-time macOS screen recording permission prompt.
  //
  // We must fire this AFTER createWindow() so that:
  //   1. The Natively launcher window is visible and focused when the TCC dialog
  //      appears — macOS anchors the dialog to the frontmost app window on Ventura+.
  //      Without a visible window the dialog can appear behind other apps (Sequoia).
  //   2. In stealth/undetectable mode the dock icon is hidden, but the window is
  //      still visible — the dialog still has a surface to attach to.
  //
  // The 800ms delay lets the launcher's ready-to-show animation complete so the
  // window is fully composited before the system sheet appears above it.
  //
  // TCC caches the decision permanently after the first response — this block
  // runs exactly ONCE on the first launch of each unique packaged binary.
  // On every subsequent launch the status is 'granted' or 'denied', and we skip.
  if (process.platform === 'darwin') {
    setTimeout(async () => {
      try {
        const screenStatus = systemPreferences.getMediaAccessStatus('screen');
        console.log(`[Init] Screen recording permission status at startup: ${screenStatus}`);

        if (!app.isPackaged) {
          console.log('[Init] Ignoring screen recording permission check in development mode');
          return;
        }

        if (screenStatus === 'not-determined') {
          // First launch: trigger the one-time TCC dialog by making a minimal
          // desktopCapturer call. macOS will show the permission sheet anchored
          // to our window. The user's response is stored permanently in the TCC
          // database — we do NOT check status immediately after because the dialog
          // is still open; the status will be read correctly next time `startMeeting`
          // is called (which is the correct gate for system audio access).
          console.log('[Init] Screen recording not-determined — showing one-time TCC dialog...');
          try {
            await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
          } catch (e) {
            // On some Electron builds getSources throws when permission is pending —
            // that's fine; the TCC dialog has still been triggered.
            console.log('[Init] getSources threw (expected during TCC pending state):', (e as Error).message);
          }
          // NOTE: Do NOT read afterStatus here — TCC response is async (dialog still open).
          // startMeeting() reads the status when the user actually tries to use audio.

        } else if (screenStatus === 'denied') {
          // Returning user who previously denied — show the banner immediately at startup
          // so they know system audio won't work before they even start a meeting.
          console.warn('[Init] Screen recording was previously denied — notifying UI banner.');
          const { BrowserWindow } = require('electron');
          BrowserWindow.getAllWindows().forEach((win: Electron.BrowserWindow) => {
            if (!win.isDestroyed()) {
              win.webContents.send(
                'system-audio-permission-denied',
                'Screen Recording is disabled. System audio capture will not work. Click "Open Settings" to enable it, then restart Natively.'
              );
            }
          });
        } else {
          // 'granted' or 'restricted' — nothing to do.
          console.log(`[Init] Screen recording permission already resolved: ${screenStatus}`);
        }
      } catch (e) {
        console.warn('[Init] Startup screen recording permission check failed:', e);
      }
    }, 800);
  }

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
