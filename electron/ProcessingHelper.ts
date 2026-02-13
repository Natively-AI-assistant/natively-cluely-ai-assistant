// ProcessingHelper.ts

import { AppState } from "./main"
import { LLMHelper } from "./LLMHelper"
import { CredentialsManager } from "./services/CredentialsManager"
import { app } from "electron"
// import dotenv from "dotenv" // Removed static import

if (!app.isPackaged) {
  require("dotenv").config()
}

const isDev = process.env.NODE_ENV === "development"
const isDevTest = process.env.IS_DEV_TEST === "true"
const MOCK_API_WAIT_TIME = Number(process.env.MOCK_API_WAIT_TIME) || 500

export class ProcessingHelper {
  private appState: AppState
  private llmHelper: LLMHelper
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null

  constructor(appState: AppState) {
    this.appState = appState

    // Check if user wants to use Ollama
    const useOllama = process.env.USE_OLLAMA === "true"
    const ollamaModel = process.env.OLLAMA_MODEL // Don't set default here, let LLMHelper auto-detect
    const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434"

    if (useOllama) {
      // console.log("[ProcessingHelper] Initializing with Ollama")
      this.llmHelper = new LLMHelper(undefined, true, ollamaModel, ollamaUrl)
    } else {
      // Try environment first (for development)
      let apiKey = process.env.GEMINI_API_KEY
      let groqApiKey = process.env.GROQ_API_KEY
      let openaiApiKey = process.env.OPENAI_API_KEY
      let claudeApiKey = process.env.CLAUDE_API_KEY

      // Allow initializing without key (will be loaded in loadStoredCredentials or via Settings)
      if (!apiKey) {
        console.warn("[ProcessingHelper] GEMINI_API_KEY not found in env. Will try CredentialsManager after ready.")
      }

      this.llmHelper = new LLMHelper(apiKey, false, undefined, undefined, groqApiKey, openaiApiKey, claudeApiKey)
    }
  }

  /**
   * Load stored credentials from CredentialsManager
   * Should be called after app.whenReady() when CredentialsManager is initialized
   */
  public loadStoredCredentials(): void {
    const credManager = CredentialsManager.getInstance();

    const geminiKey = credManager.getGeminiApiKey();
    const groqKey = credManager.getGroqApiKey();
    const openaiKey = credManager.getOpenaiApiKey();
    const claudeKey = credManager.getClaudeApiKey();

    if (geminiKey) {
      console.log("[ProcessingHelper] Loading stored Gemini API Key from CredentialsManager");
      this.llmHelper.setApiKey(geminiKey);
    }

    if (groqKey) {
      console.log("[ProcessingHelper] Loading stored Groq API Key from CredentialsManager");
      this.llmHelper.setGroqApiKey(groqKey);
    }

    if (openaiKey) {
      console.log("[ProcessingHelper] Loading stored OpenAI API Key from CredentialsManager");
      this.llmHelper.setOpenaiApiKey(openaiKey);
    }

    if (claudeKey) {
      console.log("[ProcessingHelper] Loading stored Claude API Key from CredentialsManager");
      this.llmHelper.setClaudeApiKey(claudeKey);
    }

    // CRITICAL: Re-initialize IntelligenceManager now that keys are loaded
    // This fixes the issue where buttons don't work in production because of late key loading
    this.appState.getIntelligenceManager().initializeLLMs();

    // CRITICAL: Initialize RAGManager (Embeddings) with loaded key
    // This fixes "RAG unavailable" in production where process.env is empty
    const ragManager = this.appState.getRAGManager();
    if (ragManager && geminiKey) {
      console.log("[ProcessingHelper] Initializing RAGManager embeddings with loaded key");
      ragManager.initializeEmbeddings(geminiKey);

      // CRITICAL: Retry pending embeddings now that we have a key
      // This ensures any meetings that failed or were queued during startup get processed
      console.log("[ProcessingHelper] Retrying pending embeddings...");
      ragManager.retryPendingEmbeddings().catch(console.error);

      // CRITICAL: Ensure demo meeting has chunks
      ragManager.ensureDemoMeetingProcessed().catch(console.error);

      // CRITICAL: Cleanup stale queue items to prevent "Chunk not found" errors
      ragManager.cleanupStaleQueueItems();
    }

    // NEW: Load Default Model Config
    const defaultModel = credManager.getDefaultModel();
    if (defaultModel) {
      console.log(`[ProcessingHelper] Loading stored Default Model: ${defaultModel}`);
      const customProviders = credManager.getCustomProviders();
      const curlProviders = credManager.getCurlProviders();
      const allProviders = [...(customProviders || []), ...(curlProviders || [])];
      this.llmHelper.setModel(defaultModel, allProviders);
    }
  }

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.appState.getMainWindow()
    if (!mainWindow) return

    const view = this.appState.getView()

    if (view === "queue") {
      const screenshotQueue = this.appState.getScreenshotHelper().getScreenshotQueue()
      if (screenshotQueue.length === 0) {
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS)
        return
      }



      const allPaths = this.appState.getScreenshotHelper().getScreenshotQueue();
      const lastPath = allPaths[allPaths.length - 1];

      // NEW: Handle screenshot as plain text (like audio)
      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_START)
      this.appState.setView("solutions")
      this.currentProcessingAbortController = new AbortController()
      try {
        const imageResult = await this.llmHelper.analyzeImageFile(lastPath);
        const problemInfo = {
          problem_statement: imageResult.text,
          input_format: { description: "Generated from screenshot", parameters: [] as any[] },
          output_format: { description: "Generated from screenshot", type: "string", subtype: "text" },
          complexity: { time: "N/A", space: "N/A" },
          test_cases: [] as any[],
          validation_type: "manual",
          difficulty: "custom"
        };
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.PROBLEM_EXTRACTED, problemInfo);
        this.appState.setProblemInfo(problemInfo);
      } catch (error: any) {
        // console.error("Image processing error:", error)
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, error.message)
      } finally {
        this.currentProcessingAbortController = null
      }
      return;
    } else {
      // Debug mode
      const extraScreenshotQueue = this.appState.getScreenshotHelper().getExtraScreenshotQueue()
      if (extraScreenshotQueue.length === 0) {
        // console.log("No extra screenshots to process")
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS)
        return
      }

      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.DEBUG_START)
      this.currentExtraProcessingAbortController = new AbortController()

      try {
        // Get problem info and current solution
        const problemInfo = this.appState.getProblemInfo()
        if (!problemInfo) {
          throw new Error("No problem info available")
        }

        // Get current solution from state
        const currentSolution = await this.llmHelper.generateSolution(problemInfo)
        const currentCode = currentSolution.solution.code

        // Debug the solution using vision model
        const debugResult = await this.llmHelper.debugSolutionWithImages(
          problemInfo,
          currentCode,
          extraScreenshotQueue
        )

        this.appState.setHasDebugged(true)
        mainWindow.webContents.send(
          this.appState.PROCESSING_EVENTS.DEBUG_SUCCESS,
          debugResult
        )

      } catch (error: any) {
        // console.error("Debug processing error:", error)
        mainWindow.webContents.send(
          this.appState.PROCESSING_EVENTS.DEBUG_ERROR,
          error.message
        )
      } finally {
        this.currentExtraProcessingAbortController = null
      }
    }
  }

  public cancelOngoingRequests(): void {
    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort()
      this.currentProcessingAbortController = null
    }

    if (this.currentExtraProcessingAbortController) {
      this.currentExtraProcessingAbortController.abort()
      this.currentExtraProcessingAbortController = null
    }

    this.appState.setHasDebugged(false)
  }



  public getLLMHelper() {
    return this.llmHelper;
  }
}
