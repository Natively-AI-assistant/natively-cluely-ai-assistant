// ipcHandlers.ts

import { app, ipcMain, shell, dialog, desktopCapturer, systemPreferences, BrowserWindow, screen } from "electron"
import { AppState } from "./main"
import { GEMINI_FLASH_MODEL, GEMINI_PRO_MODEL } from "./IntelligenceManager"
import { DatabaseManager } from "./db/DatabaseManager"; // Import Database Manager
import * as path from "path";
import * as fs from "fs";
import { AudioDevices } from "./audio/AudioDevices";

import { ENGLISH_VARIANTS } from "./config/languages"

export function initializeIpcHandlers(appState: AppState): void {
  const safeHandle = (channel: string, listener: (event: any, ...args: any[]) => Promise<any> | any) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, listener);
  };

  safeHandle("get-recognition-languages", async () => {
    return ENGLISH_VARIANTS;
  });
  safeHandle(
    "update-content-dimensions",
    async (event, { width, height }: { width: number; height: number }) => {
      if (!width || !height) return

      const senderWebContents = event.sender
      const settingsWin = appState.settingsWindowHelper.getSettingsWindow()
      const overlayWin = appState.getWindowHelper().getOverlayWindow()
      const launcherWin = appState.getWindowHelper().getLauncherWindow()

      if (settingsWin && !settingsWin.isDestroyed() && settingsWin.webContents.id === senderWebContents.id) {
        appState.settingsWindowHelper.setWindowDimensions(settingsWin, width, height)
      } else if (
        overlayWin && !overlayWin.isDestroyed() && overlayWin.webContents.id === senderWebContents.id
      ) {
        // NativelyInterface logic - Resize ONLY the overlay window using dedicated method
        appState.getWindowHelper().setOverlayDimensions(width, height)
      }
    }
  )

  safeHandle("set-window-mode", async (event, mode: 'launcher' | 'overlay') => {
    appState.getWindowHelper().setWindowMode(mode);
    return { success: true };
  })

  safeHandle("delete-screenshot", async (event, path: string) => {
    return appState.deleteScreenshot(path)
  })

  safeHandle("take-screenshot", async () => {
    try {
      const screenshotPath = await appState.takeScreenshot()
      const preview = await appState.getImagePreview(screenshotPath)
      return { path: screenshotPath, preview }
    } catch (error) {
      // console.error("Error taking screenshot:", error)
      throw error
    }
  })

  safeHandle("get-screenshots", async () => {
    // console.log({ view: appState.getView() })
    try {
      let previews = []
      if (appState.getView() === "queue") {
        previews = await Promise.all(
          appState.getScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path)
          }))
        )
      } else {
        previews = await Promise.all(
          appState.getExtraScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path)
          }))
        )
      }
      // previews.forEach((preview: any) => console.log(preview.path))
      return previews
    } catch (error) {
      // console.error("Error getting screenshots:", error)
      throw error
    }
  })

  safeHandle("toggle-window", async () => {
    appState.toggleMainWindow()
  })

  safeHandle("show-window", async () => {
    // Default show main window (Launcher usually)
    appState.showMainWindow()
  })

  safeHandle("hide-window", async () => {
    appState.hideMainWindow()
  })

  safeHandle("reset-queues", async () => {
    try {
      appState.clearQueues()
      // console.log("Screenshot queues have been cleared.")
      return { success: true }
    } catch (error: any) {
      // console.error("Error resetting queues:", error)
      return { success: false, error: error.message }
    }
  })



  // Generate suggestion from transcript - Natively-style text-only reasoning
  safeHandle("generate-suggestion", async (event, context: string, lastQuestion: string) => {
    try {
      const suggestion = await appState.processingHelper.getLLMHelper().generateSuggestion(context, lastQuestion)
      return { suggestion }
    } catch (error: any) {
      // console.error("Error generating suggestion:", error)
      throw error
    }
  })

  // IPC handler for analyzing image from file path
  safeHandle("analyze-image-file", async (event, path: string) => {
    try {
      const result = await appState.processingHelper.getLLMHelper().analyzeImageFile(path)
      return result
    } catch (error: any) {
      // console.error("Error in analyze-image-file handler:", error)
      throw error
    }
  })

  safeHandle("gemini-chat", async (event, message: string, imagePath?: string, context?: string, options?: { skipSystemPrompt?: boolean }) => {
    try {
      const result = await appState.processingHelper.getLLMHelper().chatWithGemini(message, imagePath, context, options?.skipSystemPrompt);

      console.log(`[IPC] gemini - chat response: `, result ? result.substring(0, 50) : "(empty)");

      // Don't process empty responses
      if (!result || result.trim().length === 0) {
        console.warn("[IPC] Empty response from LLM, not updating IntelligenceManager");
        return "I apologize, but I couldn't generate a response. Please try again.";
      }

      // Sync with IntelligenceManager so Follow-Up/Recap work
      const intelligenceManager = appState.getIntelligenceManager();

      // 1. Add user question to context (as 'user')
      // CRITICAL: Skip refinement check to prevent auto-triggering follow-up logic
      // The user's manual question is a NEW input, not a refinement of previous answer.
      intelligenceManager.addTranscript({
        text: message,
        speaker: 'user',
        timestamp: Date.now(),
        final: true
      }, true);

      // 2. Add assistant response and set as last message
      console.log(`[IPC] Updating IntelligenceManager with assistant message...`);
      intelligenceManager.addAssistantMessage(result);
      console.log(`[IPC] Updated IntelligenceManager.Last message: `, intelligenceManager.getLastAssistantMessage()?.substring(0, 50));

      // Log Usage
      intelligenceManager.logUsage('chat', message, result);

      return result;
    } catch (error: any) {
      // console.error("Error in gemini-chat handler:", error);
      throw error;
    }
  });

  // Streaming IPC Handler
  safeHandle("gemini-chat-stream", async (event, message: string, imagePath?: string, context?: string, options?: { skipSystemPrompt?: boolean }) => {
    try {
      console.log("[IPC] gemini-chat-stream started using LLMHelper.streamChat");
      const llmHelper = appState.processingHelper.getLLMHelper();

      // Update IntelligenceManager with USER message immediately
      const intelligenceManager = appState.getIntelligenceManager();
      intelligenceManager.addTranscript({
        text: message,
        speaker: 'user',
        timestamp: Date.now(),
        final: true
      }, true);

      let fullResponse = "";

      // Context Injection for "Answer" button (100s rolling window)
      if (!context) {
        // User requested 100 seconds of context for the answer button
        // Logic: If no explicit context provided (like from manual override), auto-inject from IntelligenceManager
        try {
          const autoContext = intelligenceManager.getFormattedContext(100);
          if (autoContext && autoContext.trim().length > 0) {
            context = autoContext;
            console.log(`[IPC] Auto-injected 100s context for gemini-chat-stream (${context.length} chars)`);
          }
        } catch (ctxErr) {
          console.warn("[IPC] Failed to auto-inject context:", ctxErr);
        }
      }

      try {
        // USE streamChat which handles routing
        const stream = llmHelper.streamChat(message, imagePath, context, options?.skipSystemPrompt ? "" : undefined);

        for await (const token of stream) {
          event.sender.send("gemini-stream-token", token);
          fullResponse += token;
        }

        event.sender.send("gemini-stream-done");

        // Update IntelligenceManager with ASSISTANT message after completion
        if (fullResponse.trim().length > 0) {
          intelligenceManager.addAssistantMessage(fullResponse);
          // Log Usage for streaming chat
          intelligenceManager.logUsage('chat', message, fullResponse);
        }

      } catch (streamError: any) {
        console.error("[IPC] Streaming error:", streamError);
        event.sender.send("gemini-stream-error", streamError.message || "Unknown streaming error");
      }

      return null; // Return null as data is sent via events

    } catch (error: any) {
      console.error("[IPC] Error in gemini-chat-stream setup:", error);
      throw error;
    }
  });

  safeHandle("quit-app", () => {
    app.quit()
  })

  safeHandle("quit-and-install-update", () => {
    console.log('[IPC] quit-and-install-update handler called')
    appState.quitAndInstallUpdate()
  })

  safeHandle("delete-meeting", async (_, id: string) => {
    return DatabaseManager.getInstance().deleteMeeting(id);
  });

  safeHandle("check-for-updates", async () => {
    await appState.checkForUpdates()
  })

  safeHandle("download-update", async () => {
    appState.downloadUpdate()
  })

  // Window movement handlers
  safeHandle("move-window-left", async () => {
    appState.moveWindowLeft()
  })

  safeHandle("move-window-right", async () => {
    appState.moveWindowRight()
  })

  safeHandle("move-window-up", async () => {
    appState.moveWindowUp()
  })

  safeHandle("move-window-down", async () => {
    appState.moveWindowDown()
  })

  safeHandle("center-and-show-window", async () => {
    appState.centerAndShowWindow()
  })

  // Settings Window
  safeHandle("toggle-settings-window", (event, { x, y } = {}) => {
    appState.settingsWindowHelper.toggleWindow(x, y)
  })

  safeHandle("close-settings-window", () => {
    appState.settingsWindowHelper.closeWindow()
  })



  safeHandle("set-undetectable", async (_, state: boolean) => {
    appState.setUndetectable(state)
    return { success: true }
  })

  safeHandle("set-disguise", async (_, mode: 'terminal' | 'settings' | 'activity' | 'none') => {
    appState.setDisguise(mode)
    return { success: true }
  })

  safeHandle("get-undetectable", async () => {
    return appState.getUndetectable()
  })

  safeHandle("set-open-at-login", async (_, openAtLogin: boolean) => {
    app.setLoginItemSettings({
      openAtLogin,
      openAsHidden: false,
      path: app.getPath('exe') // Explicitly point to executable for production reliability
    });
    return { success: true };
  });

  safeHandle("get-open-at-login", async () => {
    const settings = app.getLoginItemSettings();
    return settings.openAtLogin;
  });

  // LLM Model Management Handlers
  safeHandle("get-current-llm-config", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      return {
        provider: llmHelper.getCurrentProvider(),
        model: llmHelper.getCurrentModel(),
        isOllama: llmHelper.isUsingOllama()
      };
    } catch (error: any) {
      // console.error("Error getting current LLM config:", error);
      throw error;
    }
  });

  safeHandle("get-available-ollama-models", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const models = await llmHelper.getOllamaModels();
      return models;
    } catch (error: any) {
      // console.error("Error getting Ollama models:", error);
      throw error;
    }
  });

  safeHandle("switch-to-ollama", async (_, model?: string, url?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToOllama(model, url);
      return { success: true };
    } catch (error: any) {
      // console.error("Error switching to Ollama:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("force-restart-ollama", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const success = await llmHelper.forceRestartOllama();
      return { success };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("switch-to-gemini", async (_, apiKey?: string, modelId?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToGemini(apiKey, modelId);

      // Persist API key if provided
      if (apiKey) {
        const { CredentialsManager } = require('./services/CredentialsManager');
        CredentialsManager.getInstance().setGeminiApiKey(apiKey);
      }

      return { success: true };
    } catch (error: any) {
      // console.error("Error switching to Gemini:", error);
      return { success: false, error: error.message };
    }
  });

  // Dedicated API key setters (for Settings UI Save buttons)
  safeHandle("set-gemini-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setGeminiApiKey(apiKey);

      // Also update the LLMHelper immediately
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setApiKey(apiKey);

      // Re-init IntelligenceManager
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error("Error saving Gemini API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-groq-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setGroqApiKey(apiKey);

      // Also update the LLMHelper immediately
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setGroqApiKey(apiKey);

      // Re-init IntelligenceManager
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error("Error saving Groq API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-openai-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setOpenaiApiKey(apiKey);

      // Also update the LLMHelper immediately
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setOpenaiApiKey(apiKey);

      // Re-init IntelligenceManager
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error("Error saving OpenAI API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-claude-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setClaudeApiKey(apiKey);

      // Also update the LLMHelper immediately
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setClaudeApiKey(apiKey);

      // Re-init IntelligenceManager
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error("Error saving Claude API key:", error);
      return { success: false, error: error.message };
    }
  });

  // Custom Provider Handlers
  safeHandle("get-custom-providers", async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      // Merge new Curl Providers with legacy Custom Providers
      // New ones take precedence if IDs conflict (though unlikely as UUIDs)
      const curlProviders = cm.getCurlProviders();
      const legacyProviders = cm.getCustomProviders() || [];
      return [...curlProviders, ...legacyProviders];
    } catch (error: any) {
      console.error("Error getting custom providers:", error);
      return [];
    }
  });

  safeHandle("save-custom-provider", async (_, provider: any) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      // Save as CurlProvider (supports responsePath)
      CredentialsManager.getInstance().saveCurlProvider(provider);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving custom provider:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("delete-custom-provider", async (_, id: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      // Try deleting from both storages to be safe
      CredentialsManager.getInstance().deleteCurlProvider(id);
      CredentialsManager.getInstance().deleteCustomProvider(id);
      return { success: true };
    } catch (error: any) {
      console.error("Error deleting custom provider:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("switch-to-custom-provider", async (_, providerId: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const provider = CredentialsManager.getInstance().getCustomProviders().find((p: any) => p.id === providerId);

      if (!provider) {
        throw new Error("Provider not found");
      }

      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToCustom(provider);

      // Re-init IntelligenceManager (optional, but good for consistency)
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error("Error switching to custom provider:", error);
      return { success: false, error: error.message };
    }
  });

  // cURL Provider Handlers
  safeHandle("get-curl-providers", async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      return CredentialsManager.getInstance().getCurlProviders();
    } catch (error: any) {
      console.error("Error getting curl providers:", error);
      return [];
    }
  });

  safeHandle("save-curl-provider", async (_, provider: any) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().saveCurlProvider(provider);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving curl provider:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("delete-curl-provider", async (_, id: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().deleteCurlProvider(id);
      return { success: true };
    } catch (error: any) {
      console.error("Error deleting curl provider:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("switch-to-curl-provider", async (_, providerId: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const provider = CredentialsManager.getInstance().getCurlProviders().find((p: any) => p.id === providerId);

      if (!provider) {
        throw new Error("Provider not found");
      }

      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToCurl(provider);

      // Re-init IntelligenceManager (optional, but good for consistency)
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error("Error switching to curl provider:", error);
      return { success: false, error: error.message };
    }
  });

  // Get stored API keys (masked for UI display)
  safeHandle("get-stored-credentials", async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const creds = CredentialsManager.getInstance().getAllCredentials();

      // Return masked versions for security (just indicate if set)
      const hasKey = (key?: string) => !!(key && key.trim().length > 0);

      return {
        hasGeminiKey: hasKey(creds.geminiApiKey),
        hasGroqKey: hasKey(creds.groqApiKey),
        hasOpenaiKey: hasKey(creds.openaiApiKey),
        hasClaudeKey: hasKey(creds.claudeApiKey),
        googleServiceAccountPath: creds.googleServiceAccountPath || null,
        sttProvider: creds.sttProvider || 'google',
        groqSttModel: creds.groqSttModel || 'whisper-large-v3-turbo',
        hasSttGroqKey: hasKey(creds.groqSttApiKey),
        hasSttOpenaiKey: hasKey(creds.openAiSttApiKey),
        hasDeepgramKey: hasKey(creds.deepgramApiKey),
        hasElevenLabsKey: hasKey(creds.elevenLabsApiKey),
        hasAzureKey: hasKey(creds.azureApiKey),
        azureRegion: creds.azureRegion || 'eastus',
        hasIbmWatsonKey: hasKey(creds.ibmWatsonApiKey),
        ibmWatsonRegion: creds.ibmWatsonRegion || 'us-south',
      };
    } catch (error: any) {
      return { hasGeminiKey: false, hasGroqKey: false, hasOpenaiKey: false, hasClaudeKey: false, googleServiceAccountPath: null, sttProvider: 'google', groqSttModel: 'whisper-large-v3-turbo', hasSttGroqKey: false, hasSttOpenaiKey: false, hasDeepgramKey: false, hasElevenLabsKey: false, hasAzureKey: false, azureRegion: 'eastus', hasIbmWatsonKey: false, ibmWatsonRegion: 'us-south' };
    }
  });

  // ==========================================
  // STT Provider Management Handlers
  // ==========================================

  safeHandle("set-stt-provider", async (_, provider: 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson') => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setSttProvider(provider);

      // Reconfigure the audio pipeline to use the new STT provider
      await appState.reconfigureSttProvider();

      return { success: true };
    } catch (error: any) {
      console.error("Error setting STT provider:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("get-stt-provider", async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      return CredentialsManager.getInstance().getSttProvider();
    } catch (error: any) {
      return 'google';
    }
  });

  safeHandle("set-groq-stt-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setGroqSttApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving Groq STT API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-openai-stt-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setOpenAiSttApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving OpenAI STT API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-deepgram-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setDeepgramApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving Deepgram API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-groq-stt-model", async (_, model: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setGroqSttModel(model);

      // Reconfigure the audio pipeline to use the new model
      await appState.reconfigureSttProvider();

      return { success: true };
    } catch (error: any) {
      console.error("Error setting Groq STT model:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-elevenlabs-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setElevenLabsApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving ElevenLabs API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-azure-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setAzureApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving Azure API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-azure-region", async (_, region: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setAzureRegion(region);

      // Reconfigure the pipeline since region changes the endpoint URL
      await appState.reconfigureSttProvider();

      return { success: true };
    } catch (error: any) {
      console.error("Error setting Azure region:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-ibmwatson-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setIbmWatsonApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving IBM Watson API key:", error);
      return { success: false, error: error.message };
    }
  });

  // Helper to sanitize error messages (remove API key references)
  const sanitizeErrorMessage = (msg: string): string => {
    // Remove patterns like ": sk-***...***" or ": sdasdada***...dwwC"
    return msg.replace(/:\s*[a-zA-Z0-9*]+\*+[a-zA-Z0-9*]+\.?$/g, '').trim();
  };

  safeHandle("test-stt-connection", async (_, provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson', apiKey: string, region?: string) => {
    console.log(`[IPC] Received test-stt-connection request for provider: ${provider}`);
    try {
      if (provider === 'deepgram') {
        // Test Deepgram via WebSocket connection
        const WebSocket = require('ws');
        return await new Promise<{ success: boolean; error?: string }>((resolve) => {
          const url = 'wss://api.deepgram.com/v1/listen?model=nova-2&encoding=linear16&sample_rate=16000&channels=1';
          const ws = new WebSocket(url, {
            headers: { Authorization: `Token ${apiKey}` },
          });

          const timeout = setTimeout(() => {
            ws.close();
            resolve({ success: false, error: 'Connection timed out' });
          }, 15000);

          ws.on('open', () => {
            clearTimeout(timeout);
            try { ws.send(JSON.stringify({ type: 'CloseStream' })); } catch { }
            ws.close();
            resolve({ success: true });
          });

          ws.on('error', (err: any) => {
            clearTimeout(timeout);
            resolve({ success: false, error: err.message || 'Connection failed' });
          });
        });
      }

      const axios = require('axios');
      const FormData = require('form-data');

      // Generate a tiny silent WAV (0.5s of silence at 16kHz mono 16-bit)
      const numSamples = 8000;
      const pcmData = Buffer.alloc(numSamples * 2);
      const wavHeader = Buffer.alloc(44);
      wavHeader.write('RIFF', 0);
      wavHeader.writeUInt32LE(36 + pcmData.length, 4);
      wavHeader.write('WAVE', 8);
      wavHeader.write('fmt ', 12);
      wavHeader.writeUInt32LE(16, 16);
      wavHeader.writeUInt16LE(1, 20);
      wavHeader.writeUInt16LE(1, 22);
      wavHeader.writeUInt32LE(16000, 24);
      wavHeader.writeUInt32LE(32000, 28);
      wavHeader.writeUInt16LE(2, 32);
      wavHeader.writeUInt16LE(16, 34);
      wavHeader.write('data', 36);
      wavHeader.writeUInt32LE(pcmData.length, 40);
      const testWav = Buffer.concat([wavHeader, pcmData]);

      if (provider === 'elevenlabs') {
        // ElevenLabs: multipart with xi-api-key header
        const form = new FormData();
        form.append('file', testWav, { filename: 'test.wav', contentType: 'audio/wav' });
        form.append('model_id', 'scribe_v1');
        await axios.post('https://api.elevenlabs.io/v1/speech-to-text', form, {
          headers: { 'xi-api-key': apiKey, ...form.getHeaders() },
          timeout: 15000,
        });
      } else if (provider === 'azure') {
        // Azure: raw binary with subscription key
        const azureRegion = region || 'eastus';
        await axios.post(
          `https://${azureRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US`,
          testWav,
          {
            headers: { 'Ocp-Apim-Subscription-Key': apiKey, 'Content-Type': 'audio/wav' },
            timeout: 15000,
          }
        );
      } else if (provider === 'ibmwatson') {
        // IBM Watson: raw binary with Basic auth
        const ibmRegion = region || 'us-south';
        await axios.post(
          `https://api.${ibmRegion}.speech-to-text.watson.cloud.ibm.com/v1/recognize`,
          testWav,
          {
            headers: {
              Authorization: `Basic ${Buffer.from(`apikey:${apiKey}`).toString('base64')}`,
              'Content-Type': 'audio/wav',
            },
            timeout: 15000,
          }
        );
      } else {
        // Groq / OpenAI: multipart FormData
        const endpoint = provider === 'groq'
          ? 'https://api.groq.com/openai/v1/audio/transcriptions'
          : 'https://api.openai.com/v1/audio/transcriptions';
        const model = provider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1';

        const form = new FormData();
        form.append('file', testWav, { filename: 'test.wav', contentType: 'audio/wav' });
        form.append('model', model);

        await axios.post(endpoint, form, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            ...form.getHeaders(),
          },
          timeout: 15000,
        });
      }

      return { success: true };
    } catch (error: any) {
      const rawMsg = error?.response?.data?.error?.message || error?.response?.data?.message || error.message || 'Connection failed';
      const msg = sanitizeErrorMessage(rawMsg);
      console.error("STT connection test failed:", msg);
      return { success: false, error: msg };
    }
  });

  safeHandle("test-llm-connection", async (_, provider: 'gemini' | 'groq' | 'openai' | 'claude', apiKey?: string) => {
    console.log(`[IPC] Received test-llm-connection request for provider: ${provider}`);
    try {
      if (!apiKey || !apiKey.trim()) {
        const { CredentialsManager } = require('./services/CredentialsManager');
        const creds = CredentialsManager.getInstance();
        if (provider === 'gemini') apiKey = creds.getGeminiApiKey();
        else if (provider === 'groq') apiKey = creds.getGroqApiKey();
        else if (provider === 'openai') apiKey = creds.getOpenaiApiKey();
        else if (provider === 'claude') apiKey = creds.getClaudeApiKey();
      }

      if (!apiKey || !apiKey.trim()) {
        return { success: false, error: 'No API key provided' };
      }

      const axios = require('axios');
      let response;

      if (provider === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        response = await axios.post(url, {
          contents: [{ parts: [{ text: "Hello" }] }]
        });
      } else if (provider === 'groq') {
        response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
          model: "llama3-8b-8192",
          messages: [{ role: "user", content: "Hello" }]
        }, {
          headers: { Authorization: `Bearer ${apiKey}` }
        });
      } else if (provider === 'openai') {
        response = await axios.post('https://api.openai.com/v1/chat/completions', {
          model: "gpt-3.5-turbo",
          messages: [{ role: "user", content: "Hello" }]
        }, {
          headers: { Authorization: `Bearer ${apiKey}` }
        });
      } else if (provider === 'claude') {
        response = await axios.post('https://api.anthropic.com/v1/messages', {
          model: "claude-3-haiku-20240307",
          max_tokens: 10,
          messages: [{ role: "user", content: "Hello" }]
        }, {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          }
        });
      }

      if (response && (response.status === 200 || response.status === 201)) {
        return { success: true };
      } else {
        return { success: false, error: 'Request failed with status ' + response?.status };
      }

    } catch (error: any) {
      console.error("LLM connection test failed:", error);
      const rawMsg = error?.response?.data?.error?.message || error?.response?.data?.message || (error.response?.data?.error?.type ? `${error.response.data.error.type}: ${error.response.data.error.message}` : error.message) || 'Connection failed';
      const msg = sanitizeErrorMessage(rawMsg);
      return { success: false, error: msg };
    }
  });

  safeHandle("set-model-preference", (_, type: "flash" | "pro") => {
    try {
      const im = appState.getIntelligenceManager();
      const model = type === 'pro' ? GEMINI_PRO_MODEL : GEMINI_FLASH_MODEL;
      im.setModel(model);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-model", async (_, modelId: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();

      // Get all providers (Curl + Custom)
      const curlProviders = cm.getCurlProviders();
      const legacyProviders = cm.getCustomProviders() || [];
      const allProviders = [...curlProviders, ...legacyProviders];

      llmHelper.setModel(modelId, allProviders);

      // Close the selector window if open
      appState.modelSelectorWindowHelper.hideWindow();

      // Broadcast to all windows so NativelyInterface can update its selector (session-only update)
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('model-changed', modelId);
        }
      });

      return { success: true };
    } catch (error: any) {
      console.error("Error setting model:", error);
      return { success: false, error: error.message };
    }
  });

  // Persist default model (from Settings) + update runtime + broadcast to all windows
  safeHandle("set-default-model", async (_, modelId: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      cm.setDefaultModel(modelId);

      // Also update the runtime model
      const llmHelper = appState.processingHelper.getLLMHelper();
      const curlProviders = cm.getCurlProviders();
      const legacyProviders = cm.getCustomProviders() || [];
      const allProviders = [...curlProviders, ...legacyProviders];
      llmHelper.setModel(modelId, allProviders);

      // Close the selector window if open
      appState.modelSelectorWindowHelper.hideWindow();

      // Broadcast to all windows so NativelyInterface can update its selector
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('model-changed', modelId);
        }
      });

      return { success: true };
    } catch (error: any) {
      console.error("Error setting default model:", error);
      return { success: false, error: error.message };
    }
  });

  // Read the persisted default model
  safeHandle("get-default-model", async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      return { model: cm.getDefaultModel() };
    } catch (error: any) {
      console.error("Error getting default model:", error);
      return { model: 'gemini-3-flash-preview' };
    }
  });

  // --- Model Selector Window IPC ---

  safeHandle("show-model-selector", (_, coords: { x: number; y: number }) => {
    appState.modelSelectorWindowHelper.showWindow(coords.x, coords.y);
  });

  safeHandle("hide-model-selector", () => {
    appState.modelSelectorWindowHelper.hideWindow();
  });

  safeHandle("toggle-model-selector", (_, coords: { x: number; y: number }) => {
    appState.modelSelectorWindowHelper.toggleWindow(coords.x, coords.y);
  });

  safeHandle("test-llm-connection", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const result = await llmHelper.testConnection();
      return result;
    } catch (error: any) {
      // console.error("Error testing LLM connection:", error);
      return { success: false, error: error.message };
    }
  });

  // Native Audio Service Handlers
  // Native Audio handlers removed as part of migration to driverless architecture
  safeHandle("native-audio-status", async () => {
    // Always return true or pseudo-status since it's "driverless"
    return { connected: true };
  });

  safeHandle("get-input-devices", async () => {
    return AudioDevices.getInputDevices();
  });

  safeHandle("get-output-devices", async () => {
    return AudioDevices.getOutputDevices();
  });

  safeHandle("start-audio-test", async (event, deviceId?: string) => {
    appState.startAudioTest(deviceId);
    return { success: true };
  });

  safeHandle("stop-audio-test", async () => {
    appState.stopAudioTest();
    return { success: true };
  });

  safeHandle("set-recognition-language", async (_, key: string) => {
    appState.setRecognitionLanguage(key);
    return { success: true };
  });

  // ==========================================
  // Meeting Lifecycle Handlers
  // ==========================================

  safeHandle("start-meeting", async (event, metadata?: any) => {
    try {
      await appState.startMeeting(metadata);
      return { success: true };
    } catch (error: any) {
      console.error("Error starting meeting:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("end-meeting", async () => {
    try {
      await appState.endMeeting();
      return { success: true };
    } catch (error: any) {
      console.error("Error ending meeting:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("get-recent-meetings", async () => {
    // Fetch from SQLite (limit 50)
    return DatabaseManager.getInstance().getRecentMeetings(50);
  });

  safeHandle("get-meeting-details", async (event, id) => {
    // Helper to fetch full details
    return DatabaseManager.getInstance().getMeetingDetails(id);
  });

  safeHandle("update-meeting-title", async (_, { id, title }: { id: string; title: string }) => {
    return DatabaseManager.getInstance().updateMeetingTitle(id, title);
  });

  safeHandle("update-meeting-summary", async (_, { id, updates }: { id: string; updates: any }) => {
    return DatabaseManager.getInstance().updateMeetingSummary(id, updates);
  });

  safeHandle("seed-demo", async () => {
    DatabaseManager.getInstance().seedDemoMeeting();

    // Trigger RAG processing for the new demo meeting
    const ragManager = appState.getRAGManager();
    if (ragManager && ragManager.isReady()) {
      ragManager.reprocessMeeting('demo-meeting').catch(console.error);
    }

    return { success: true };
  });

  safeHandle("flush-database", async () => {
    const result = DatabaseManager.getInstance().clearAllData();
    return { success: result };
  });

  safeHandle("open-external", async (event, url: string) => {
    try {
      const parsed = new URL(url);
      if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        await shell.openExternal(url);
      } else {
        console.warn(`[IPC] Blocked potentially unsafe open-external: ${url}`);
      }
    } catch {
      console.warn(`[IPC] Invalid URL in open-external: ${url}`);
    }
  });

  // ==========================================
  // Intelligence Mode Handlers
  // ==========================================

  // MODE 1: Assist (Passive observation)
  safeHandle("generate-assist", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const insight = await intelligenceManager.runAssistMode();
      return { insight };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 2: What Should I Say (Primary auto-answer)
  safeHandle("generate-what-to-say", async (_, question?: string, imagePath?: string) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      // Question and imagePath are now optional - IntelligenceManager infers from transcript
      const answer = await intelligenceManager.runWhatShouldISay(question, 0.8, imagePath);
      return { answer, question: question || 'inferred from context' };
    } catch (error: any) {
      // Return graceful fallback instead of throwing
      return {
        question: question || 'unknown'
      };
    }
  });

  // MODE 3: Follow-Up (Refinement)
  safeHandle("generate-follow-up", async (_, intent: string, userRequest?: string) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const refined = await intelligenceManager.runFollowUp(intent, userRequest);
      return { refined, intent };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 4: Recap (Summary)
  safeHandle("generate-recap", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const summary = await intelligenceManager.runRecap();
      return { summary };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 6: Follow-Up Questions
  safeHandle("generate-follow-up-questions", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const questions = await intelligenceManager.runFollowUpQuestions();
      return { questions };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 5: Manual Answer (Fallback)
  safeHandle("submit-manual-question", async (_, question: string) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const answer = await intelligenceManager.runManualAnswer(question);
      return { answer, question };
    } catch (error: any) {
      throw error;
    }
  });

  // Get current intelligence context
  safeHandle("get-intelligence-context", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      return {
        context: intelligenceManager.getFormattedContext(),
        lastAssistantMessage: intelligenceManager.getLastAssistantMessage(),
        activeMode: intelligenceManager.getActiveMode()
      };
    } catch (error: any) {
      throw error;
    }
  });

  // Reset intelligence state
  safeHandle("reset-intelligence", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      intelligenceManager.reset();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });


  // Service Account Selection
  safeHandle("select-service-account", async () => {
    try {
      const result: any = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, cancelled: true };
      }

      const filePath = result.filePaths[0];

      // Update backend state immediately
      appState.updateGoogleCredentials(filePath);

      // Persist the path for future sessions
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setGoogleServiceAccountPath(filePath);

      return { success: true, path: filePath };
    } catch (error: any) {
      console.error("Error selecting service account:", error);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Theme System Handlers
  // ==========================================

  safeHandle("theme:get-mode", () => {
    const tm = appState.getThemeManager();
    return {
      mode: tm.getMode(),
      resolved: tm.getResolvedTheme()
    };
  });

  safeHandle("theme:set-mode", (_, mode: 'system' | 'light' | 'dark') => {
    appState.getThemeManager().setMode(mode);
    return { success: true };
  });

  // ==========================================
  // Calendar Integration Handlers
  // ==========================================

  safeHandle("calendar-connect", async () => {
    try {
      const { CalendarManager } = require('./services/CalendarManager');
      await CalendarManager.getInstance().startAuthFlow();
      return { success: true };
    } catch (error: any) {
      console.error("Calendar auth error:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("calendar-disconnect", async () => {
    const { CalendarManager } = require('./services/CalendarManager');
    await CalendarManager.getInstance().disconnect();
    return { success: true };
  });

  safeHandle("get-calendar-status", async () => {
    const { CalendarManager } = require('./services/CalendarManager');
    return CalendarManager.getInstance().getConnectionStatus();
  });

  safeHandle("get-upcoming-events", async () => {
    const { CalendarManager } = require('./services/CalendarManager');
    return CalendarManager.getInstance().getUpcomingEvents();
  });

  safeHandle("calendar-refresh", async () => {
    const { CalendarManager } = require('./services/CalendarManager');
    await CalendarManager.getInstance().refreshState();
    return { success: true };
  });

  // ==========================================
  // Follow-up Email Handlers
  // ==========================================

  safeHandle("generate-followup-email", async (_, input: any) => {
    try {
      const { FOLLOWUP_EMAIL_PROMPT, GROQ_FOLLOWUP_EMAIL_PROMPT } = require('./llm/prompts');
      const { buildFollowUpEmailPromptInput } = require('./utils/emailUtils');

      const llmHelper = appState.processingHelper.getLLMHelper();

      // Build the context string from input
      const contextString = buildFollowUpEmailPromptInput(input);

      // Build prompts
      const geminiPrompt = `${FOLLOWUP_EMAIL_PROMPT}\n\nMEETING DETAILS:\n${contextString}`;
      const groqPrompt = `${GROQ_FOLLOWUP_EMAIL_PROMPT}\n\nMEETING DETAILS:\n${contextString}`;

      // Use chatWithGemini with alternateGroqMessage for fallback
      const emailBody = await llmHelper.chatWithGemini(geminiPrompt, undefined, undefined, true, groqPrompt);

      return emailBody;
    } catch (error: any) {
      console.error("Error generating follow-up email:", error);
      throw error;
    }
  });

  safeHandle("extract-emails-from-transcript", async (_, transcript: Array<{ text: string }>) => {
    try {
      const { extractEmailsFromTranscript } = require('./utils/emailUtils');
      return extractEmailsFromTranscript(transcript);
    } catch (error: any) {
      console.error("Error extracting emails:", error);
      return [];
    }
  });

  safeHandle("get-calendar-attendees", async (_, eventId: string) => {
    try {
      const { CalendarManager } = require('./services/CalendarManager');
      const cm = CalendarManager.getInstance();

      // Try to get attendees from the event
      const events = await cm.getUpcomingEvents();
      const event = events?.find((e: any) => e.id === eventId);

      if (event && event.attendees) {
        return event.attendees.map((a: any) => ({
          email: a.email,
          name: a.displayName || a.email?.split('@')[0] || ''
        })).filter((a: any) => a.email);
      }

      return [];
    } catch (error: any) {
      console.error("Error getting calendar attendees:", error);
      return [];
    }
  });

  safeHandle("open-mailto", async (_, { to, subject, body }: { to: string; subject: string; body: string }) => {
    try {
      const { buildMailtoLink } = require('./utils/emailUtils');
      const mailtoUrl = buildMailtoLink(to, subject, body);
      await shell.openExternal(mailtoUrl);
      return { success: true };
    } catch (error: any) {
      console.error("Error opening mailto:", error);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // RAG (Retrieval-Augmented Generation) Handlers
  // ==========================================

  // Store active query abort controllers for cancellation
  const activeRAGQueries = new Map<string, AbortController>();

  // Query meeting with RAG (meeting-scoped)
  safeHandle("rag:query-meeting", async (event, { meetingId, query }: { meetingId: string; query: string }) => {
    const ragManager = appState.getRAGManager();

    if (!ragManager || !ragManager.isReady()) {
      // Fallback to regular chat if RAG not available
      console.log("[RAG] Not ready, falling back to regular chat");
      return { fallback: true };
    }

    // Check if the meeting actually has embeddings
    if (!ragManager.isMeetingProcessed(meetingId)) {
      console.log(`[RAG] Meeting ${meetingId} not processed, falling back to regular chat`);
      return { fallback: true };
    }

    const abortController = new AbortController();
    const queryKey = `meeting-${meetingId}`;
    activeRAGQueries.set(queryKey, abortController);

    try {
      const stream = ragManager.queryMeeting(meetingId, query, abortController.signal);

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break;
        event.sender.send("rag:stream-chunk", { meetingId, chunk });
      }

      event.sender.send("rag:stream-complete", { meetingId });
      return { success: true };

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        const msg = error.message || "";
        // If specific RAG failures, return fallback to use transcript window
        if (msg.includes('NO_RELEVANT_CONTEXT') || msg.includes('NO_MEETING_EMBEDDINGS')) {
          console.log(`[RAG] Query failed with '${msg}', falling back to regular chat`);
          return { fallback: true };
        }

        console.error("[RAG] Query error:", error);
        event.sender.send("rag:stream-error", { meetingId, error: msg });
      }
      return { success: false, error: error.message };
    } finally {
      activeRAGQueries.delete(queryKey);
    }
  });

  // Query global (cross-meeting search)
  safeHandle("rag:query-global", async (event, { query }: { query: string }) => {
    const ragManager = appState.getRAGManager();

    if (!ragManager || !ragManager.isReady()) {
      return { fallback: true };
    }

    const abortController = new AbortController();
    const queryKey = `global-${Date.now()}`;
    activeRAGQueries.set(queryKey, abortController);

    try {
      const stream = ragManager.queryGlobal(query, abortController.signal);

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break;
        event.sender.send("rag:stream-chunk", { global: true, chunk });
      }

      event.sender.send("rag:stream-complete", { global: true });
      return { success: true };

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        event.sender.send("rag:stream-error", { global: true, error: error.message });
      }
      return { success: false, error: error.message };
    } finally {
      activeRAGQueries.delete(queryKey);
    }
  });

  // Cancel active RAG query
  safeHandle("rag:cancel-query", async (_, { meetingId, global }: { meetingId?: string; global?: boolean }) => {
    const queryKey = global ? 'global' : `meeting-${meetingId}`;

    // Cancel any matching key
    for (const [key, controller] of activeRAGQueries) {
      if (key.startsWith(queryKey) || (global && key.startsWith('global'))) {
        controller.abort();
        activeRAGQueries.delete(key);
      }
    }

    return { success: true };
  });

  // Check if meeting has RAG embeddings
  safeHandle("rag:is-meeting-processed", async (_, meetingId: string) => {
    const ragManager = appState.getRAGManager();
    if (!ragManager) return false;
    return ragManager.isMeetingProcessed(meetingId);
  });

  // Get RAG queue status
  safeHandle("rag:get-queue-status", async () => {
    const ragManager = appState.getRAGManager();
    if (!ragManager) return { pending: 0, processing: 0, completed: 0, failed: 0 };
    return ragManager.getQueueStatus();
  });

  // Retry pending embeddings
  safeHandle("rag:retry-embeddings", async () => {
    const ragManager = appState.getRAGManager();
    if (!ragManager) return { success: false };
    await ragManager.retryPendingEmbeddings();
    return { success: true };
  });
}
