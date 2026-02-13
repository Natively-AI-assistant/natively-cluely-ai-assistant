import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } from "electron"
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

const logFile = path.join(app.getPath('documents'), 'natively_debug.log');

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

const isDev = process.env.NODE_ENV === "development";

function logToFile(msg: string) {
  // Only log to file in development
  if (!isDev) return;

  try {
    require('fs').appendFileSync(logFile, new Date().toISOString() + ' ' + msg + '\n');
  } catch (e) {
    // Ignore logging errors
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
import { ScreenshotHelper } from "./ScreenshotHelper"
import { ShortcutsHelper } from "./shortcuts"
import { ProcessingHelper } from "./ProcessingHelper"

import { IntelligenceManager } from "./IntelligenceManager"
import { SystemAudioCapture } from "./audio/SystemAudioCapture"
import { MicrophoneCapture } from "./audio/MicrophoneCapture"
import { GoogleSTT } from "./audio/GoogleSTT"
import { RestSTT } from "./audio/RestSTT"
import { DeepgramStreamingSTT } from "./audio/DeepgramStreamingSTT"
import { ThemeManager } from "./ThemeManager"
import { RAGManager } from "./rag/RAGManager"
import { DatabaseManager } from "./db/DatabaseManager"
import { CredentialsManager } from "./services/CredentialsManager"

export class AppState {
  private static instance: AppState | null = null

  private windowHelper: WindowHelper
  public settingsWindowHelper: SettingsWindowHelper
  public modelSelectorWindowHelper: ModelSelectorWindowHelper
  private screenshotHelper: ScreenshotHelper
  public shortcutsHelper: ShortcutsHelper
  public processingHelper: ProcessingHelper

  private intelligenceManager: IntelligenceManager
  private themeManager: ThemeManager
  private ragManager: RAGManager | null = null
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
  private visibilityMode: 'normal' | 'stealth' = 'normal';

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
    // Initialize WindowHelper with this
    this.windowHelper = new WindowHelper(this)
    this.settingsWindowHelper = new SettingsWindowHelper()
    this.modelSelectorWindowHelper = new ModelSelectorWindowHelper()

    // Initialize ScreenshotHelper
    this.screenshotHelper = new ScreenshotHelper(this.view)

    // Initialize ProcessingHelper
    this.processingHelper = new ProcessingHelper(this)

    // Initialize ShortcutsHelper
    this.shortcutsHelper = new ShortcutsHelper(this)





    // Initialize IntelligenceManager with LLMHelper
    this.intelligenceManager = new IntelligenceManager(this.processingHelper.getLLMHelper())

    // Initialize ThemeManager
    this.themeManager = ThemeManager.getInstance()

    // Initialize RAGManager (requires database to be ready)
    this.initializeRAGManager()


    this.setupIntelligenceEvents()

    // Setup Ollama IPC
    this.setupOllamaIpcHandlers()

    // --- NEW SYSTEM AUDIO PIPELINE (SOX + NODE GOOGLE STT) ---
    // LAZY INIT: Do not setup pipeline here to prevent launch volume surge.
    // this.setupSystemAudioPipeline()

    // Initialize Auto-Updater
    this.setupAutoUpdater()
  }

  private initializeRAGManager(): void {
    try {
      const db = DatabaseManager.getInstance();
      // @ts-ignore - accessing private db for RAGManager
      const sqliteDb = db['db'];

      if (sqliteDb) {
        const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
        this.ragManager = new RAGManager({ db: sqliteDb, apiKey });
        this.ragManager.setLLMHelper(this.processingHelper.getLLMHelper());
        console.log('[AppState] RAGManager initialized');
      }
    } catch (error) {
      console.error('[AppState] Failed to initialize RAGManager:', error);
    }
  }

  private setupAutoUpdater(): void {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false  // Manual install only via button

    autoUpdater.on("checking-for-update", () => {
      console.log("[AutoUpdater] Checking for update...")
      this.getMainWindow()?.webContents.send("update-checking")
    })

    autoUpdater.on("update-available", (info) => {
      console.log("[AutoUpdater] Update available:", info.version)
      this.updateAvailable = true
      // Notify renderer that an update is available (for optional UI signal)
      this.getMainWindow()?.webContents.send("update-available", info)
    })

    autoUpdater.on("update-not-available", (info) => {
      console.log("[AutoUpdater] Update not available:", info.version)
      this.getMainWindow()?.webContents.send("update-not-available", info)
    })

    autoUpdater.on("error", (err) => {
      console.error("[AutoUpdater] Error:", err)
      this.getMainWindow()?.webContents.send("update-error", err.message)
    })

    autoUpdater.on("download-progress", (progressObj) => {
      let log_message = "Download speed: " + progressObj.bytesPerSecond
      log_message = log_message + " - Downloaded " + progressObj.percent + "%"
      log_message = log_message + " (" + progressObj.transferred + "/" + progressObj.total + ")"
      console.log("[AutoUpdater] " + log_message)
      this.getMainWindow()?.webContents.send("download-progress", progressObj)
    })

    autoUpdater.on("update-downloaded", (info) => {
      console.log("[AutoUpdater] Update downloaded:", info.version)
      // Notify renderer that update is ready to install
      this.getMainWindow()?.webContents.send("update-downloaded", info)
    })

    // Only skip the automatic check in development
    if (process.env.NODE_ENV === "development") {
      console.log("[AutoUpdater] Skipping automatic update check in development mode")
      return
    }

    // Start checking for updates
    autoUpdater.checkForUpdatesAndNotify().catch(err => {
      console.error("[AutoUpdater] Failed to check for updates:", err)
    })
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
    await autoUpdater.checkForUpdatesAndNotify()
  }

  public downloadUpdate(): void {
    autoUpdater.downloadUpdate()
  }

  // New Property for System Audio & Microphone
  private systemAudioCapture: SystemAudioCapture | null = null;
  private microphoneCapture: MicrophoneCapture | null = null;
  private audioTestCapture: MicrophoneCapture | null = null; // For audio settings test
  private googleSTT: GoogleSTT | RestSTT | DeepgramStreamingSTT | null = null; // Interviewer
  private googleSTT_User: GoogleSTT | RestSTT | DeepgramStreamingSTT | null = null; // User

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
        this.systemAudioCapture.on('error', (err: Error) => {
          console.error('[Main] SystemAudioCapture Error:', err);
        });
      }

      if (!this.microphoneCapture) {
        this.microphoneCapture = new MicrophoneCapture();
        // Wire Capture -> STT
        this.microphoneCapture.on('data', (chunk: Buffer) => {
          this.googleSTT_User?.write(chunk);
        });
        this.microphoneCapture.on('error', (err: Error) => {
          console.error('[Main] MicrophoneCapture Error:', err);
        });
      }

      // 2. Initialize STT Services if missing
      if (!this.googleSTT) {
        // Check which provider to use
        const { CredentialsManager } = require('./services/CredentialsManager');
        const sttProvider = CredentialsManager.getInstance().getSttProvider();

        if (sttProvider === 'deepgram') {
          const apiKey = CredentialsManager.getInstance().getDeepgramApiKey();
          if (apiKey) {
            console.log(`[Main] Using DeepgramStreamingSTT for Interviewer`);
            this.googleSTT = new DeepgramStreamingSTT(apiKey);
          } else {
            console.warn(`[Main] No API key for Deepgram STT, falling back to GoogleSTT`);
            this.googleSTT = new GoogleSTT();
          }
        } else if (sttProvider === 'groq' || sttProvider === 'openai' || sttProvider === 'elevenlabs' || sttProvider === 'azure' || sttProvider === 'ibmwatson') {
          let apiKey: string | undefined;
          let region: string | undefined;
          let modelOverride: string | undefined;

          if (sttProvider === 'groq') {
            apiKey = CredentialsManager.getInstance().getGroqSttApiKey();
            modelOverride = CredentialsManager.getInstance().getGroqSttModel();
          } else if (sttProvider === 'openai') {
            apiKey = CredentialsManager.getInstance().getOpenAiSttApiKey();
          } else if (sttProvider === 'elevenlabs') {
            apiKey = CredentialsManager.getInstance().getElevenLabsApiKey();
          } else if (sttProvider === 'azure') {
            apiKey = CredentialsManager.getInstance().getAzureApiKey();
            region = CredentialsManager.getInstance().getAzureRegion();
          } else if (sttProvider === 'ibmwatson') {
            apiKey = CredentialsManager.getInstance().getIbmWatsonApiKey();
            region = CredentialsManager.getInstance().getIbmWatsonRegion();
          }

          if (apiKey) {
            console.log(`[Main] Using RestSTT (${sttProvider}) for Interviewer`);
            this.googleSTT = new RestSTT(sttProvider, apiKey, modelOverride, region);
          } else {
            console.warn(`[Main] No API key for ${sttProvider} STT, falling back to GoogleSTT`);
            this.googleSTT = new GoogleSTT();
          }
        } else {
          this.googleSTT = new GoogleSTT();
        }

        // Wire Transcript Events
        this.googleSTT.on('transcript', (segment: { text: string, isFinal: boolean, confidence: number }) => {
          if (!this.isMeetingActive) {
            // console.log('[Main] Ignored transcript (Meeting inactive):', segment.text.substring(0, 50));
            return;
          }

          this.intelligenceManager.handleTranscript({
            speaker: 'interviewer',
            text: segment.text,
            timestamp: Date.now(),
            final: segment.isFinal,
            confidence: segment.confidence
          });

          const helper = this.getWindowHelper();
          const payload = {
            speaker: 'interviewer',
            text: segment.text,
            timestamp: Date.now(),
            final: segment.isFinal,
            confidence: segment.confidence
          };
          helper.getLauncherWindow()?.webContents.send('native-audio-transcript', payload);
          helper.getOverlayWindow()?.webContents.send('native-audio-transcript', payload);
        });

        this.googleSTT.on('error', (err: Error) => {
          console.error('[Main] STT (Interviewer) Error:', err);
        });
      }

      if (!this.googleSTT_User) {
        // Check which provider to use
        const { CredentialsManager } = require('./services/CredentialsManager');
        const sttProvider = CredentialsManager.getInstance().getSttProvider();

        if (sttProvider === 'deepgram') {
          const apiKey = CredentialsManager.getInstance().getDeepgramApiKey();
          if (apiKey) {
            console.log(`[Main] Using DeepgramStreamingSTT for User`);
            this.googleSTT_User = new DeepgramStreamingSTT(apiKey);
          } else {
            console.warn(`[Main] No API key for Deepgram STT, falling back to GoogleSTT`);
            this.googleSTT_User = new GoogleSTT();
          }
        } else if (sttProvider === 'groq' || sttProvider === 'openai' || sttProvider === 'elevenlabs' || sttProvider === 'azure' || sttProvider === 'ibmwatson') {
          let apiKey: string | undefined;
          let region: string | undefined;
          let modelOverride: string | undefined;

          if (sttProvider === 'groq') {
            apiKey = CredentialsManager.getInstance().getGroqSttApiKey();
            modelOverride = CredentialsManager.getInstance().getGroqSttModel();
          } else if (sttProvider === 'openai') {
            apiKey = CredentialsManager.getInstance().getOpenAiSttApiKey();
          } else if (sttProvider === 'elevenlabs') {
            apiKey = CredentialsManager.getInstance().getElevenLabsApiKey();
          } else if (sttProvider === 'azure') {
            apiKey = CredentialsManager.getInstance().getAzureApiKey();
            region = CredentialsManager.getInstance().getAzureRegion();
          } else if (sttProvider === 'ibmwatson') {
            apiKey = CredentialsManager.getInstance().getIbmWatsonApiKey();
            region = CredentialsManager.getInstance().getIbmWatsonRegion();
          }

          if (apiKey) {
            console.log(`[Main] Using RestSTT (${sttProvider}) for User`);
            this.googleSTT_User = new RestSTT(sttProvider, apiKey, modelOverride, region);
          } else {
            console.warn(`[Main] No API key for ${sttProvider} STT, falling back to GoogleSTT`);
            this.googleSTT_User = new GoogleSTT();
          }
        } else {
          this.googleSTT_User = new GoogleSTT();
        }

        // Wire Transcript Events
        this.googleSTT_User.on('transcript', (segment: { text: string, isFinal: boolean, confidence: number }) => {
          if (!this.isMeetingActive) {
            // console.log('[Main] Ignored transcript (Meeting inactive):', segment.text.substring(0, 50));
            return;
          }

          this.intelligenceManager.handleTranscript({
            speaker: 'user', // Identified as User
            text: segment.text,
            timestamp: Date.now(),
            final: segment.isFinal,
            confidence: segment.confidence
          });

          // Forward User transcript to UI too
          const helper = this.getWindowHelper();
          const payload = {
            speaker: 'user',
            text: segment.text,
            timestamp: Date.now(),
            final: segment.isFinal,
            confidence: segment.confidence
          };
          helper.getLauncherWindow()?.webContents.send('native-audio-transcript', payload);
          helper.getOverlayWindow()?.webContents.send('native-audio-transcript', payload);
        });

        this.googleSTT_User.on('error', (err: Error) => {
          console.error('[Main] STT (User) Error:', err);
        });
      }

      // --- CRITICAL FIX: SYNC SAMPLE RATES ---
      // Always sync rates, even if just initialized, to ensure consistency

      // 1. Sync System Audio Rate
      const sysRate = this.systemAudioCapture?.getSampleRate() || 16000;
      console.log(`[Main] Configuring Interviewer STT to ${sysRate}Hz`);
      this.googleSTT?.setSampleRate(sysRate);
      if ('setAudioChannelCount' in this.googleSTT!) {
        (this.googleSTT as any).setAudioChannelCount(1);
      }

      // 2. Sync Mic Rate
      const micRate = this.microphoneCapture?.getSampleRate() || 16000;
      console.log(`[Main] Configuring User STT to ${micRate}Hz`);
      this.googleSTT_User?.setSampleRate(micRate);
      if ('setAudioChannelCount' in this.googleSTT_User!) {
        (this.googleSTT_User as any).setAudioChannelCount(1);
      }

      console.log('[Main] Full Audio Pipeline (System + Mic) Initialized (Ready)');

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

    // Stop existing STT instances
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

    // Start the new STT instances if a meeting is active
    if (this.isMeetingActive) {
      this.googleSTT?.start();
      this.googleSTT_User?.start();
    }

    console.log('[Main] STT Provider reconfigured');
  }


  public startAudioTest(deviceId?: string): void {
    console.log(`[Main] Starting Audio Test on device: ${deviceId || 'default'}`);
    this.stopAudioTest(); // Stop any existing test

    try {
      this.audioTestCapture = new MicrophoneCapture(deviceId || undefined);
      this.audioTestCapture.start();

      // Send to settings window if open, else main window
      const win = this.settingsWindowHelper.getSettingsWindow() || this.getMainWindow();

      this.audioTestCapture.on('data', (chunk: Buffer) => {
        // Calculate basic RMS for level meter
        if (!win || win.isDestroyed()) return;

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
          // Normalize 0-1 (heuristic scaling, max comfortable mic input is around 10000-20000)
          const level = Math.min(rms / 10000, 1.0);
          win.webContents.send('audio-level', level);
        }
      });

      this.audioTestCapture.on('error', (err: Error) => {
        console.error('[Main] AudioTest Error:', err);
      });

    } catch (err) {
      console.error('[Main] Failed to start audio test:', err);
    }
  }

  public stopAudioTest(): void {
    if (this.audioTestCapture) {
      console.log('[Main] Stopping Audio Test');
      this.audioTestCapture.stop();
      this.audioTestCapture = null;
    }
  }

  public async startMeeting(metadata?: any): Promise<void> {
    console.log('[Main] Starting Meeting...', metadata);

    this.isMeetingActive = true;
    if (metadata) {
      this.intelligenceManager.setMeetingMetadata(metadata);

      // Check for audio configuration preference
      if (metadata.audio) {
        await this.reconfigureAudio(metadata.audio.inputDeviceId, metadata.audio.outputDeviceId);
      }
    }

    // Emit session reset to clear UI state
    this.getWindowHelper().getOverlayWindow()?.webContents.send('session-reset');
    this.getWindowHelper().getLauncherWindow()?.webContents.send('session-reset');

    // LAZY INIT: Ensure pipeline is ready (if not reconfigured above)
    this.setupSystemAudioPipeline();

    // 3. Start System Audio
    this.systemAudioCapture?.start();
    this.googleSTT?.start();

    // 4. Start Microphone
    this.microphoneCapture?.start();
    this.googleSTT_User?.start();
  }

  public async endMeeting(): Promise<void> {
    console.log('[Main] Ending Meeting...');
    this.isMeetingActive = false; // Block new data immediately

    // 3. Stop System Audio
    this.systemAudioCapture?.stop();
    this.googleSTT?.stop();

    // 4. Stop Microphone
    this.microphoneCapture?.stop();
    this.googleSTT_User?.stop();

    // 4. Reset Intelligence Context & Save
    await this.intelligenceManager.stopMeeting();

    // 5. Revert to Default Model (One-Way Sync Revert)
    // This ensures next meeting starts with default, not the temporary one used in this session
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      const defaultModel = cm.getDefaultModel();
      // Re-fetch custom providers to ensure context correctness
      const curlProviders = cm.getCurlProviders();
      const legacyProviders = cm.getCustomProviders();
      const all = [...(curlProviders || []), ...(legacyProviders || [])];

      console.log(`[Main] Reverting model to default: ${defaultModel}`);
      this.processingHelper.getLLMHelper().setModel(defaultModel, all);

      // Broadcast revert to UI
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) win.webContents.send('model-changed', defaultModel);
      });

    } catch (e) {
      console.error("[Main] Failed to revert model:", e);
    }

    // 6. Process meeting for RAG (embeddings)
    await this.processCompletedMeetingForRAG();
  }

  private async processCompletedMeetingForRAG(): Promise<void> {
    if (!this.ragManager) return;

    try {
      // Get the most recent meeting from database
      const meetings = DatabaseManager.getInstance().getRecentMeetings(1);
      if (meetings.length === 0) return;

      const meeting = DatabaseManager.getInstance().getMeetingDetails(meetings[0].id);
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

      // I will delay this implementation until I see the file contenteting for RAG
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
    this.googleSTT?.setRecognitionLanguage(key);
    this.googleSTT_User?.setRecognitionLanguage(key);
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

  public showMainWindow(): void {
    this.windowHelper.showMainWindow()
  }

  public toggleMainWindow(): void {
    console.log(
      "Screenshots: ",
      this.screenshotHelper.getScreenshotQueue().length,
      "Extra screenshots: ",
      this.screenshotHelper.getExtraScreenshotQueue().length
    )
    this.windowHelper.toggleMainWindow()
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

  // Screenshot management methods
  public async takeScreenshot(): Promise<string> {
    if (!this.getMainWindow()) throw new Error("No main window available")

    const wasOverlayVisible = this.windowHelper.getOverlayWindow()?.isVisible() ?? false

    const screenshotPath = await this.screenshotHelper.takeScreenshot(
      () => this.hideMainWindow(),
      () => {
        if (wasOverlayVisible) {
          this.windowHelper.switchToOverlay()
        } else {
          this.showMainWindow()
        }
      }
    )

    return screenshotPath
  }

  public async takeSelectiveScreenshot(): Promise<string> {
    if (!this.getMainWindow()) throw new Error("No main window available")

    const wasOverlayVisible = this.windowHelper.getOverlayWindow()?.isVisible() ?? false

    const screenshotPath = await this.screenshotHelper.takeSelectiveScreenshot(
      () => this.hideMainWindow(),
      () => {
        if (wasOverlayVisible) {
          this.windowHelper.switchToOverlay()
        } else {
          this.showMainWindow()
        }
      }
    )

    return screenshotPath
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
    const resourcesPath = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');

    // Potential paths for tray icon
    const templatePath = path.join(resourcesPath, 'assets', 'iconTemplate.png');
    const defaultIconPath = app.isPackaged
      ? path.join(resourcesPath, 'src/components/icon.png')
      : path.join(__dirname, '../src/components/icon.png');

    let iconToUse = defaultIconPath;

    // Check if template exists (sync check is fine for startup/rare toggle)
    try {
      if (require('fs').existsSync(templatePath)) {
        iconToUse = templatePath;
        console.log('[Tray] Using template icon:', templatePath);
      } else {
        // Also check src/components for dev
        const devTemplatePath = path.join(__dirname, '../src/components/iconTemplate.png');
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

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show Natively',
        click: () => {
          this.centerAndShowWindow()
        }
      },
      {
        label: 'Toggle Window',
        click: () => {
          this.toggleMainWindow()
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Take Screenshot (Cmd+H)',
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

    this.tray.setToolTip('Natively - Press Cmd+Shift+Space to show')
    this.tray.setContextMenu(contextMenu)

    // Double-click to show window
    this.tray.on('double-click', () => {
      this.centerAndShowWindow()
    })
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
    this.isUndetectable = state
    this.windowHelper.setContentProtection(state)
    this.settingsWindowHelper.setContentProtection(state)

    // Broadcast state change to all relevant windows
    const mainWindow = this.windowHelper.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('undetectable-changed', state);
    }

    // Also broadcast to launcher explicitly if it exists and isn't the main window
    const launcher = this.windowHelper.getLauncherWindow();
    if (launcher && !launcher.isDestroyed() && launcher !== mainWindow) {
      launcher.webContents.send('undetectable-changed', state);
    }

    const settingsWin = this.settingsWindowHelper.getSettingsWindow();
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.webContents.send('undetectable-changed', state);
    }

    if (process.platform === 'darwin') {
      this.applyVisibilityMode(state ? 'stealth' : 'normal');
    }
  }

  public getUndetectable(): boolean {
    return this.isUndetectable
  }

  public setDisguise(mode: 'terminal' | 'settings' | 'activity' | 'none'): void {
    this.disguiseMode = mode;

    // Only apply the disguise if we are currently in undetectable mode
    // Otherwise, just save the preference for later
    if (this.isUndetectable) {
      this._applyDisguise(mode);
    }
  }

  private _applyDisguise(mode: 'terminal' | 'settings' | 'activity' | 'none'): void {
    let appName = "Natively";
    let iconPath = "";

    switch (mode) {
      case 'terminal':
        appName = "Terminal ";
        iconPath = app.isPackaged
          ? path.join(process.resourcesPath, "assets/fakeicon/terminal.png")
          : path.resolve(__dirname, "../assets/fakeicon/terminal.png");
        break;
      case 'settings':
        appName = "System Settings ";
        iconPath = app.isPackaged
          ? path.join(process.resourcesPath, "assets/fakeicon/settings.png")
          : path.resolve(__dirname, "../assets/fakeicon/settings.png");
        break;
      case 'activity':
        appName = "Activity Monitor ";
        iconPath = app.isPackaged
          ? path.join(process.resourcesPath, "assets/fakeicon/activity.png")
          : path.resolve(__dirname, "../assets/fakeicon/activity.png");
        break;
      case 'none':
        appName = "Natively";
        iconPath = app.isPackaged
          ? path.join(process.resourcesPath, "natively.icns")
          : path.resolve(__dirname, "../assets/natively.icns");
        break;
    }

    console.log(`[AppState] Applying disguise: ${mode} (${appName})`);

    // 1. Update process title (affects Activity Monitor / Task Manager)
    process.title = appName;

    // 2. Update app name (affects macOS Menu / Dock)
    app.setName(appName);
    if (process.platform === 'darwin') {
      process.env.CFBundleName = appName.trim();
    }

    // 3. Update App User Model ID (Windows Taskbar grouping)
    if (process.platform === 'win32') {
      app.setAppUserModelId(`${appName.trim()}-${mode}`);
    }

    // 4. Update Icons
    if (fs.existsSync(iconPath)) {
      const image = nativeImage.createFromPath(iconPath);

      if (process.platform === 'darwin') {
        // Only set dock icon if NOT in stealth/accessory mode
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

    // Force periodic updates as seen in reference to ensure it sticks
    const forceUpdate = () => {
      process.title = appName;
      if (process.platform === 'darwin') {
        app.setName(appName);
      }
    };

    setTimeout(forceUpdate, 200);
    setTimeout(forceUpdate, 1000);
    setTimeout(forceUpdate, 5000);
  }

  public getDisguise(): string {
    return this.disguiseMode;
  }

  private applyVisibilityMode(mode: 'normal' | 'stealth') {
    if (process.platform !== 'darwin') return;

    if (mode === 'stealth') {
      app.setActivationPolicy('accessory');

      // Microtask delay to allow macOS to process policy change
      setTimeout(() => {
        const win = this.getMainWindow();
        if (win && !win.isDestroyed()) {
          // Explicitly active the app and focus the window
          // This prevents the window from losing focus when dock icon disappears
          app.focus({ steal: true });
          win.focus();
        }
      }, 10);

    } else {
      app.setActivationPolicy('regular');
      // No delay needed for regular mode, but good practice to ensure focus
      const win = this.getMainWindow();
      if (win && !win.isDestroyed()) {
        win.show();
        win.focus();
      }
    }

    this.visibilityMode = mode;
  }
}

// Application initialization

// Canonical Dock Icon Setup (dev + prod safe) - MUST be called before any window is created
function setMacDockIcon() {
  if (process.platform !== "darwin") return;

  const appState = AppState.getInstance();
  if (appState && appState.getUndetectable()) {
    console.log("[DockIcon] Skipping dock icon setup due to stealth mode");
    return;
  }

  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "natively.icns")
    : path.resolve(__dirname, "../assets/natively.icns");

  console.log("[DockIcon] Using:", iconPath);
  app.dock.setIcon(nativeImage.createFromPath(iconPath));
}

async function initializeApp() {
  await app.whenReady()

  // Initialize CredentialsManager and load keys explicitly
  // This fixes the issue where keys (especially in production) aren't loaded in time for RAG/LLM
  const { CredentialsManager } = require('./services/CredentialsManager');
  CredentialsManager.getInstance().init();

  const appState = AppState.getInstance()

  // Explicitly load credentials into helpers
  appState.processingHelper.loadStoredCredentials();

  // Initialize IPC handlers before window creation
  initializeIpcHandlers(appState)

  app.whenReady().then(() => {
    app.setName("Natively"); // Fix App Name in Menu

    CredentialsManager.getInstance().init();

    // Anonymous install ping - one-time, non-blocking
    // See electron/services/InstallPingManager.ts for privacy details
    const { sendAnonymousInstallPing } = require('./services/InstallPingManager');
    sendAnonymousInstallPing();

    // Load stored API keys into ProcessingHelper/LLMHelper
    appState.processingHelper.loadStoredCredentials();

    // Load stored Google Service Account path (for Speech-to-Text)
    const storedServiceAccountPath = CredentialsManager.getInstance().getGoogleServiceAccountPath();
    if (storedServiceAccountPath) {
      console.log("[Init] Loading stored Google Service Account path");
      appState.updateGoogleCredentials(storedServiceAccountPath);
    }

    try {
      setMacDockIcon(); // 🔴 MUST be first, before any window
    } catch (e) {
      console.error("Failed to set dock icon:", e);
    }

    console.log("App is ready")

    appState.createWindow()

    appState.createWindow()

    // Apply initial stealth state based on isUndetectable setting
    if (process.platform === 'darwin') {
      if (appState.getUndetectable()) {
        app.setActivationPolicy('accessory');
      } else {
        app.setActivationPolicy('regular');
      }
    } else {
      // Non-macOS explicit handling if needed (mostly handled via window skipTaskbar)
      if (appState.getUndetectable()) {
        // ...
      } else {
        appState.showTray();
      }
    }
    // Register global shortcuts using ShortcutsHelper
    appState.shortcutsHelper.registerGlobalShortcuts()

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
  })

  app.on("activate", () => {
    console.log("App activated")
    console.log("App activated")
    if (appState.getMainWindow() === null) {
      appState.createWindow()
    }
  })

  // Quit when all windows are closed, except on macOS
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
    }
  })



  // app.dock?.hide() // REMOVED: User wants Dock icon visible
  app.commandLine.appendSwitch("disable-background-timer-throttling")
}

// Start the application
initializeApp().catch(console.error)
