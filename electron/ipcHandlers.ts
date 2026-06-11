// ipcHandlers.ts

import * as crypto from 'crypto';
import { app, BrowserWindow, dialog, ipcMain, shell, systemPreferences } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AudioDevices } from './audio/AudioDevices';
import { DatabaseManager } from './db/DatabaseManager'; // Import Database Manager
import { AppState } from './main';
import { CodexCliService } from './services/CodexCliService';
import { PhoneMirrorService } from './services/PhoneMirrorService';
import { SettingsManager } from './services/SettingsManager';
import { SkillsManager } from './services/SkillsManager';

import { TRIAL_SENTINEL_KEY } from './config/constants';
import { AI_RESPONSE_LANGUAGES, RECOGNITION_LANGUAGES } from './config/languages';
import { planAnswer, formatAnswerPlanForPrompt, isCodingAnswerType, validateAnswerStructure, validateProfileOutput, validateProfileEvidence, buildProfileRepairInstruction, raceStreamWithDeadline, firstUsefulDeadlineMs, isStealthEvasionQuestion, stripProfileTokensFromCoding, isBareFollowUp, buildContextFreeClarification, sanitizeCandidateAnswer, CANDIDATE_VOICE_ANSWER_TYPES, piTelemetry, classifyProviderError } from './llm';
import { buildLiveFallbackAnswer } from './llm/manualProfileIntelligence';
import { isCodeVerificationEnabled } from './llm/codeVerification/verificationEnabled';
import { CodingStreamGate } from './llm/codingStreamGate';
import { PiLatencyTrace } from './services/telemetry/PiLatencyTracer';
import { CHAT_MODE_PROMPT } from './llm/prompts';
import { isAssistantIdentityQuestion, profileFactsReady } from './llm/manualProfileIntelligence';
import { buildManualProfileBackendAnswer } from './llm/profileAnswerBackend';

export function initializeIpcHandlers(appState: AppState): void {
  const safeHandle = (
    channel: string,
    listener: (event: any, ...args: any[]) => Promise<any> | any,
  ) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, listener);
  };

  const safeOn = (
    channel: string,
    listener: (event: any, ...args: any[]) => void,
  ) => {
    ipcMain.removeAllListeners(channel);
    ipcMain.on(channel, listener);
  };

  /**
   * Returns true if the user has an active premium license OR an unexpired free trial.
   * Used to gate profile intelligence features (resume upload, JD upload, company research, etc.).
   */
  const isProOrTrialActive = (): boolean => {
    // 1. Full premium license (Dodo / Gumroad / Natively API subscription)
    try {
      const { LicenseManager } = require('../premium/electron/services/LicenseManager');
      if (LicenseManager.getInstance().isPremium()) return true;
    } catch {
      /* premium module not available */
    }

    // 2. Active free trial (token present and not expired)
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      const token = cm.getTrialToken();
      if (!token) return false;
      const expiresAt = cm.getTrialExpiresAt();
      if (!expiresAt) return false;
      return new Date(expiresAt).getTime() > Date.now();
    } catch {
      return false;
    }
  };

  // Clears premium-only context when the pro license is lost.
  const clearActiveModeOnLicenseLoss = (): void => {
    try {
      const { DatabaseManager } = require('./db/DatabaseManager');
      const db = DatabaseManager.getInstance();
      db.setActiveMode(null);
      db.clearProfilePersona?.();
      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      llmHelper?.setPersonaPrompt?.('');
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('modes-active-cleared');
      });
      console.log('[IPC] Premium-only context cleared due to license loss');
    } catch (e) {
      /* non-fatal */
    }
  };

  // --- NEW Test Helper ---
  safeHandle('test-release-fetch', async () => {
    try {
      console.log('[IPC] Manual Test Fetch triggered (forcing refresh)...');
      const { ReleaseNotesManager } = require('./update/ReleaseNotesManager');
      const notes = await ReleaseNotesManager.getInstance().fetchReleaseNotes('latest', true);

      if (notes) {
        console.log('[IPC] Notes fetched for:', notes.version);
        const info = {
          version: notes.version || 'latest',
          files: [] as any[],
          path: '',
          sha512: '',
          releaseName: notes.summary,
          releaseNotes: notes.fullBody,
          parsedNotes: notes,
        };
        // Send to renderer
        appState.getMainWindow()?.webContents.send('update-available', info);
        return { success: true };
      }
      return { success: false, error: 'No notes returned' };
    } catch (err: any) {
      console.error('[IPC] test-release-fetch failed:', err);
      return { success: false, error: err.message };
    }
  });

  // DEV-ONLY: thinking-budget sweep against the app's LIVE Gemini key (the .env
  // key is billing-dead). Trigger from devtools:
  //   await window.electronAPI.invoke?.('dev:thinking-budget-bench', { budgets:[0,128,512,1024,-1], repeats:1 })
  // or via the exposed helper if present. Writes userData/thinking-budget-bench-results.json.
  safeHandle('dev:thinking-budget-bench', async (_event, opts?: { budgets?: number[]; repeats?: number }) => {
    try {
      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      if (!llmHelper) return { ok: false, error: 'LLMHelper unavailable' };
      const { runThinkingBudgetBench } = require('./services/dev/ThinkingBudgetBench');
      const report = await runThinkingBudgetBench(llmHelper, {
        budgets: opts?.budgets,
        repeats: opts?.repeats,
        log: (s: string) => console.log(s),
      });
      return { ok: true, summary: report.summary, path: require('electron').app.getPath('userData') + '/thinking-budget-bench-results.json' };
    } catch (err: any) {
      console.error('[IPC] dev:thinking-budget-bench failed:', err);
      return { ok: false, error: String(err?.message || err) };
    }
  });

  safeHandle('license:activate', async (event, key: string) => {
    try {
      const { LicenseManager } = require('../premium/electron/services/LicenseManager');
      const result = await LicenseManager.getInstance().activateLicense(key);
      if (result?.success) {
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed())
            win.webContents.send('license-status-changed', { isPremium: true });
        });
      }
      return result;
    } catch (err: any) {
      // Only show generic message if the premium module itself is missing.
      // activateLicense() returns {success:false, error} for all expected failures
      // (bad key, network error, etc.) — it should never throw in normal operation.
      console.error('[IPC] license:activate unexpected error:', err);
      return { success: false, error: 'Premium features not available in this build.' };
    }
  });
  safeHandle('license:check-premium', async () => {
    try {
      const { LicenseManager } = require('../premium/electron/services/LicenseManager');
      return LicenseManager.getInstance().isPremium();
    } catch {
      return false;
    }
  });

  safeHandle('license:get-details', async () => {
    try {
      const { LicenseManager } = require('../premium/electron/services/LicenseManager');
      return LicenseManager.getInstance().getLicenseDetails();
    } catch {
      return { isPremium: false };
    }
  });
  // Async variant: performs Dodo server-side revocation check on startup.
  // Returns false only if the server definitively revokes the key.
  // Network errors fail-open (returns cached sync result).
  safeHandle('license:check-premium-async', async () => {
    try {
      const { LicenseManager } = require('../premium/electron/services/LicenseManager');
      return await LicenseManager.getInstance().isPremiumAsync();
    } catch {
      return false;
    }
  });
  safeHandle('license:deactivate', async () => {
    try {
      const { LicenseManager } = require('../premium/electron/services/LicenseManager');
      // deactivate() is async — it calls the Dodo server to free the activation slot
      // before removing the local license file. Must be awaited.
      await LicenseManager.getInstance().deactivate();
      // Auto-disable knowledge mode when license is removed
      try {
        const orchestrator = appState.getKnowledgeOrchestrator();
        if (orchestrator) {
          orchestrator.setKnowledgeMode(false);
          console.log('[IPC] Knowledge mode auto-disabled due to license deactivation');
        }
      } catch (e) {
        /* ignore */
      }
      // Notify all windows so the license UI (ProGate, settings) refreshes immediately
      clearActiveModeOnLicenseLoss();
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed())
          win.webContents.send('license-status-changed', { isPremium: false });
      });
    } catch {
      /* LicenseManager not available */
    }
    return { success: true };
  });
  safeHandle('license:get-hardware-id', async () => {
    try {
      const { LicenseManager } = require('../premium/electron/services/LicenseManager');
      return LicenseManager.getInstance().getHardwareId();
    } catch {
      return 'unavailable';
    }
  });

  safeHandle('get-recognition-languages', async () => {
    return RECOGNITION_LANGUAGES;
  });

  safeHandle('get-ai-response-languages', async () => {
    return AI_RESPONSE_LANGUAGES;
  });

  safeHandle('set-ai-response-language', async (_, language: string) => {
    // Validate: must be a non-empty string
    if (!language || typeof language !== 'string' || !language.trim()) {
      console.warn('[IPC] set-ai-response-language: invalid or empty language received, ignoring.');
      return { success: false, error: 'Invalid language value' };
    }
    const sanitizedLanguage = language.trim();
    const { CredentialsManager } = require('./services/CredentialsManager');
    // Persist to disk
    CredentialsManager.getInstance().setAiResponseLanguage(sanitizedLanguage);
    // Update live in-memory LLMHelper (same instance used by IntelligenceEngine)
    const llmHelper = appState.processingHelper?.getLLMHelper?.();
    if (llmHelper) {
      llmHelper.setAiResponseLanguage(sanitizedLanguage);
      console.log(`[IPC] AI response language updated to: ${sanitizedLanguage}`);
    } else {
      console.warn(
        '[IPC] set-ai-response-language: processingHelper or LLMHelper not ready, language saved to disk only.',
      );
    }
    return { success: true };
  });

  safeHandle('get-stt-language', async () => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return CredentialsManager.getInstance().getSttLanguage();
  });

  safeHandle('get-ai-response-language', async () => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return CredentialsManager.getInstance().getAiResponseLanguage();
  });
  safeHandle(
    'update-content-dimensions',
    async (event, { width, height }: { width: number; height: number }) => {
      if (!width || !height) return;

      const senderWebContents = event.sender;
      const settingsWin = appState.settingsWindowHelper.getSettingsWindow();
      const overlayWin = appState.getWindowHelper().getOverlayWindow();
      const launcherWin = appState.getWindowHelper().getLauncherWindow();

      if (
        settingsWin &&
        !settingsWin.isDestroyed() &&
        settingsWin.webContents.id === senderWebContents.id
      ) {
        appState.settingsWindowHelper.setWindowDimensions(settingsWin, width, height);
      } else if (
        overlayWin &&
        !overlayWin.isDestroyed() &&
        overlayWin.webContents.id === senderWebContents.id
      ) {
        // NativelyInterface logic - Resize ONLY the overlay window using dedicated method
        appState.getWindowHelper().setOverlayDimensions(width, height);
      } else if (
        launcherWin &&
        !launcherWin.isDestroyed() &&
        launcherWin.webContents.id === senderWebContents.id
      ) {
        // EC-05 fix: launcher window resize events were previously silently ignored.
        // Log them so that if the launcher ever sends this IPC it's visible in logs.
        console.log(
          `[IPC] update-content-dimensions: launcher window resize request ${width}x${height} (ignored — launcher has fixed dimensions)`,
        );
      }
    },
  );

  // Centered variant: keeps horizontal center fixed during width changes.
  // Used by code-expansion animations to prevent the top pill from sliding sideways.
  safeHandle(
    'update-content-dimensions-centered',
    async (event, { width, height }: { width: number; height: number }) => {
      if (!width || !height) return;
      const senderWebContents = event.sender;
      const overlayWin = appState.getWindowHelper().getOverlayWindow();
      if (
        overlayWin &&
        !overlayWin.isDestroyed() &&
        overlayWin.webContents.id === senderWebContents.id
      ) {
        appState.getWindowHelper().setOverlayDimensionsCentered(width, height);
      }
    },
  );

  // (Removed) 'animate-overlay-width' — the overlay window is a FIXED WIDTH
  // (WindowHelper.OVERLAY_DEFAULT_WIDTH = 780) and is NEVER width-resized. The
  // expand/contract animation is CSS-only in the renderer (the panel tweens
  // 600↔780 centered inside the fixed window). 'update-content-dimensions-centered'
  // now only carries HEIGHT changes (the renderer always sends the fixed width),
  // which is a top-anchored resize that does not move X — so there is no
  // sideways jump and no per-frame transparent-window re-raster. See
  // NativelyInterface.startTransition for the renderer side.

  safeHandle('set-window-mode', async (event, mode: 'launcher' | 'overlay', inactive?: boolean) => {
    appState.getWindowHelper().setWindowMode(mode, inactive);
    return { success: true };
  });

  safeHandle('delete-screenshot', async (event, filePath: string) => {
    // Guard: only allow deletion of files within the app's own userData directory
    const userDataDir = app.getPath('userData');
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(userDataDir + path.sep)) {
      console.warn('[IPC] delete-screenshot: path outside userData rejected:', filePath);
      return { success: false, error: 'Path not allowed' };
    }
    return appState.deleteScreenshot(resolved);
  });

  safeHandle('take-screenshot', async () => {
    try {
      const screenshotPath = await appState.takeScreenshot();
      const preview = await appState.getImagePreview(screenshotPath);
      return { path: screenshotPath, preview };
    } catch (error) {
      // console.error("Error taking screenshot:", error)
      throw error;
    }
  });

  safeHandle('take-selective-screenshot', async () => {
    try {
      const screenshotPath = await appState.takeSelectiveScreenshot();
      const preview = await appState.getImagePreview(screenshotPath);
      return { path: screenshotPath, preview };
    } catch (error) {
      // EC-04 fix: cast unknown error to Error before accessing .message
      if ((error as Error).message === 'Selection cancelled') {
        return { cancelled: true };
      }
      throw error;
    }
  });

  safeHandle('get-screenshots', async () => {
    // console.log({ view: appState.getView() })
    try {
      let previews = [];
      if (appState.getView() === 'queue') {
        previews = await Promise.all(
          appState.getScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path),
          })),
        );
      } else {
        previews = await Promise.all(
          appState.getExtraScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path),
          })),
        );
      }
      // previews.forEach((preview: any) => console.log(preview.path))
      return previews;
    } catch (error) {
      // console.error("Error getting screenshots:", error)
      throw error;
    }
  });

  safeHandle('toggle-window', async () => {
    appState.toggleMainWindow();
  });

  safeHandle('show-window', async (event, inactive?: boolean) => {
    // Default show main window (Launcher usually)
    appState.showMainWindow(inactive);
  });

  safeHandle('hide-window', async () => {
    appState.hideMainWindow();
  });

  safeHandle('show-overlay', async () => {
    appState.getWindowHelper().showOverlay();
  });

  safeHandle('hide-overlay', async () => {
    appState.getWindowHelper().hideOverlay();
  });

  safeHandle('get-meeting-active', async () => {
    return appState.getIsMeetingActive();
  });

  safeHandle('reset-queues', async () => {
    try {
      appState.clearQueues();
      // console.log("Screenshot queues have been cleared.")
      return { success: true };
    } catch (error: any) {
      // console.error("Error resetting queues:", error)
      return { success: false, error: error.message };
    }
  });

  // Donation IPC Handlers
  safeHandle('get-donation-status', async () => {
    const { DonationManager } = require('./DonationManager');
    const manager = DonationManager.getInstance();
    return {
      shouldShow: manager.shouldShowToaster(),
      hasDonated: manager.getDonationState().hasDonated,
      lifetimeShows: manager.getDonationState().lifetimeShows,
    };
  });

  safeHandle('mark-donation-toast-shown', async () => {
    const { DonationManager } = require('./DonationManager');
    DonationManager.getInstance().markAsShown();
    return { success: true };
  });

  safeHandle('set-donation-complete', async () => {
    const { DonationManager } = require('./DonationManager');
    DonationManager.getInstance().setHasDonated(true);
    return { success: true };
  });

  // Generate suggestion from transcript - Natively-style text-only reasoning
  safeHandle('generate-suggestion', async (event, context: string, lastQuestion: string) => {
    try {
      const suggestion = await appState.processingHelper
        .getLLMHelper()
        .generateSuggestion(context, lastQuestion);
      return { suggestion };
    } catch (error: any) {
      // console.error("Error generating suggestion:", error)
      throw error;
    }
  });

  safeHandle('finalize-mic-stt', async () => {
    appState.finalizeMicSTT();
  });

  // IPC handler for analyzing image from file path
  safeHandle('analyze-image-file', async (event, filePath: string) => {
    // Guard: only allow reading files within the app's own userData directory
    const userDataDir = app.getPath('userData');
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(userDataDir + path.sep)) {
      console.warn('[IPC] analyze-image-file: path outside userData rejected:', filePath);
      throw new Error('Path not allowed');
    }
    try {
      const result = await appState.processingHelper.getLLMHelper().analyzeImageFiles([resolved]);
      return result;
    } catch (error: any) {
      throw error;
    }
  });

  safeHandle(
    'gemini-chat',
    async (
      event,
      message: string,
      imagePaths?: string[],
      context?: string,
      options?: { skipSystemPrompt?: boolean },
    ) => {
      try {
        const result = await appState.processingHelper
          .getLLMHelper()
          .chatWithGemini(message, imagePaths, context, options?.skipSystemPrompt);

        console.log(`[IPC] gemini - chat response received`, { length: result?.length ?? 0 });

        // Don't process empty responses
        if (!result || result.trim().length === 0) {
          console.warn('[IPC] Empty response from LLM, not updating IntelligenceManager');
          return "I apologize, but I couldn't generate a response. Please try again.";
        }

        // Sync with IntelligenceManager so Follow-Up/Recap work
        const intelligenceManager = appState.getIntelligenceManager();

        // 1. Add user question to context (as 'user')
        // CRITICAL: Skip refinement check to prevent auto-triggering follow-up logic
        // The user's manual question is a NEW input, not a refinement of previous answer.
        intelligenceManager.addTranscript(
          {
            text: message,
            speaker: 'user',
            timestamp: Date.now(),
            final: true,
          },
          true,
        );

        // 2. Add assistant response and set as last message
        console.log(`[IPC] Updating IntelligenceManager with assistant message...`);
        intelligenceManager.addAssistantMessage(result);
        console.log(`[IPC] Updated IntelligenceManager.Last message`, {
          length: intelligenceManager.getLastAssistantMessage()?.length ?? 0,
        });

        // Log Usage
        intelligenceManager.logUsage('chat', message, result);

        return result;
      } catch (error: any) {
        // console.error("Error in gemini-chat handler:", error);
        throw error;
      }
    },
  );

  // Streaming IPC Handler
  let _chatStreamId = 0;
  // Keep IDs globally unique for phone/desktop message correlation; supersession is per sender.
  const _chatStreamsBySender = new Map<number, { streamId: number; controller: AbortController }>();

  // Matches narrow identity/meta probes only. Kept tight so coding/normal asks don't trip it.
  // Prevents the small fast-mode model from over-firing the "I'm Natively" canned reply
  // (which used to escape the prompt's hard rule for any ambiguous input).
  const IDENTITY_PROBE_RE =
    /^\s*(who\s+(are|r)\s+(you|u|this|natively)|what\s+(are|r)\s+(you|u)|are\s+you\s+(chatgpt|gpt[-\s]?\d?|claude|gemini|llama|an?\s+(ai|bot|llm|model|assistant))|what('?s|\s+is)\s+your\s+(name|model)|which\s+(ai|model|llm)\s+are\s+you|who\s+(made|built|created|developed|trained)\s+(you|this|natively)|what\s+model\s+(are\s+you|do\s+you\s+use)|introduce\s+yourself)\s*\??\s*$/i;
  const CREATOR_PROBE_RE =
    /^\s*(who\s+(made|built|created|developed|trained)\s+(you|this|natively))\s*\??\s*$/i;

  safeHandle(
    'gemini-chat-stream',
    async (
      event,
      message: string,
      imagePaths?: string[],
      context?: string,
      options?: { skipSystemPrompt?: boolean; ignoreKnowledgeMode?: boolean },
    ) => {
      let myController: AbortController | null = null;
      try {
        console.log('[IPC] gemini-chat-stream started using LLMHelper.streamChat');
        const llmHelper = appState.processingHelper.getLLMHelper();

        const senderId = event.sender.id;
        const myStreamId = ++_chatStreamId;
        const priorStream = _chatStreamsBySender.get(senderId);
        if (priorStream) {
          try { priorStream.controller.abort(); } catch { /* noop */ }
        }
        myController = new AbortController();
        _chatStreamsBySender.set(senderId, { streamId: myStreamId, controller: myController });

        const intelligenceManager = appState.getIntelligenceManager();

        // Identity probe short-circuit — bypasses the LLM entirely so small models can't
        // reframe the canned reply or misfire it on coding asks (the original bug).
        // Regex is `^...$` anchored, so non-probe questions cannot match.
        if (!imagePaths?.length && typeof message === 'string') {
          const identityHit = CREATOR_PROBE_RE.test(message)
            ? 'I was developed by Evin John.'
            : IDENTITY_PROBE_RE.test(message)
              ? "I'm Natively, an AI assistant."
              : null;
          if (identityHit) {
            intelligenceManager.addTranscript(
              { text: message, speaker: 'user', timestamp: Date.now(), final: true },
              true,
            );
            try {
              PhoneMirrorService.getInstance().publishUserMessage(String(myStreamId), message);
            } catch (_) {
              /* noop */
            }
            // Guard against a newer chat stream having taken over while we were computing
            // the canned reply — matches the protection the LLM path uses around its token
            // loop. Prevents cross-stream UI bleed.
            if (_chatStreamsBySender.get(senderId)?.streamId !== myStreamId) {
              console.log(
                `[IPC] gemini-chat-stream ${myStreamId} (identity probe) superseded for sender ${senderId}, skipping emit.`,
              );
              return null;
            }
            event.sender.send('gemini-stream-token', identityHit);
            event.sender.send('gemini-stream-done');
            try {
              PhoneMirrorService.getInstance().publishToken(String(myStreamId), identityHit);
            } catch (_) {
              /* noop */
            }
            try {
              PhoneMirrorService.getInstance().publishDone(String(myStreamId), identityHit);
            } catch (_) {
              /* noop */
            }
            intelligenceManager.addAssistantMessage(identityHit);
            intelligenceManager.logUsage('chat', message, identityHit);
            return null;
          }
        }

        // Capture rolling context BEFORE adding the new user message — otherwise the
        // 100s window would echo back the user's just-typed message as both context and
        // question, confusing small models (the "20-char context" log line was just an echo).
        let autoContextSnapshot: string | undefined;
        if (!context) {
          try {
            const snap = intelligenceManager.getFormattedContext(100);
            if (snap && snap.trim().length > 0) autoContextSnapshot = snap;
          } catch (ctxErr) {
            console.warn('[IPC] Failed to capture pre-turn context:', ctxErr);
          }
        }

        // Now add USER message to IntelligenceManager (after context snapshot)
        intelligenceManager.addTranscript(
          {
            text: message,
            speaker: 'user',
            timestamp: Date.now(),
            final: true,
          },
          true,
        );

        // Mirror to phone (no-op if PhoneMirrorService isn't running).
        try {
          PhoneMirrorService.getInstance().publishUserMessage(String(myStreamId), message);
        } catch (_) {
          /* noop */
        }

        let fullResponse = '';

        // Per-request latency trace (MEASURE_LATENCY=true prints a stage
        // breakdown to the console so we can see exactly where the wall time
        // goes: pre-work in streamChat → provider first token → stream).
        const chatTrace = new PiLatencyTrace({ source: 'manual' });
        chatTrace.mark('question_submitted');

        const answerPlan = planAnswer({
          question: message,
          source: 'manual_input',
          speakerPerspective: 'user',
        });
        const isCodingChat = isCodingAnswerType(answerPlan.answerType);
        chatTrace.mark('answer_type_selected', { answerType: answerPlan.answerType, isCoding: isCodingChat });
        piTelemetry.emit('pi_answer_plan_created', { answerType: answerPlan.answerType, surface: 'manual', isCoding: isCodingChat, profilePolicy: answerPlan.profileContextPolicy, answerStyle: answerPlan.answerStyle });

        // Context-free bare follow-up ("why?", "and?", "continue") typed in MANUAL
        // mode has no prior turn to resolve against (manual chat is single-shot — no
        // conversation history is threaded here). Emit a safe clarification
        // deterministically instead of letting the LLM self-identify or dump the
        // profile (release 2026-06-07c). A provided `context` string counts as prior
        // context, so a follow-up with pasted context still flows normally.
        //
        // SAFETY ORDERING (code-review 2026-06-07c): this runs BEFORE the stealth/
        // safety route, which is sound because `isBareFollowUp` only matches
        // content-free single fragments ("why", "and", "continue", "explain") — a
        // stealth/evasion ask is necessarily multi-word ("how do I stay undetected"),
        // so it can never be classified bare and short-circuited here. The emitted
        // clarification is a fixed safe string. If `isBareFollowUp` is ever broadened,
        // re-verify it cannot swallow a stealth ask.
        if (!context && isBareFollowUp(message)) {
          const clarification = buildContextFreeClarification('manual');
          if (_chatStreamsBySender.get(senderId)?.streamId !== myStreamId) return null;
          event.sender.send('gemini-stream-token', clarification);
          event.sender.send('gemini-stream-done', { finalText: clarification });
          try { PhoneMirrorService.getInstance().publishToken(String(myStreamId), clarification); } catch (_) { /* noop */ }
          try { PhoneMirrorService.getInstance().publishDone(String(myStreamId), clarification); } catch (_) { /* noop */ }
          intelligenceManager.addAssistantMessage(clarification);
          intelligenceManager.logUsage('chat', message, clarification);
          chatTrace.markFirstUseful({ via: 'context_free_clarification' });
          chatTrace.mark('response_completed', { chars: clarification.length, deterministic: true });
          chatTrace.finish({ chars: clarification.length });
          return null;
        }

        // Manual Profile Intelligence preflight: simple profile facts must not fall
        // through to generic CHAT_MODE_PROMPT, where the assistant identity can win
        // over the loaded candidate identity. Structured resume/JD facts are ready
        // before embeddings/AOT, so answer these deterministically with no provider.
        // SAFETY (code-review 2026-06-06b CRITICAL): the deterministic fast-path
        // runs BEFORE the safety route, so a stealth/evasion ask that also trips an
        // intro/skill pattern could get a candidate answer instead of the decline.
        // Skip the fast-path entirely for a stealth/evasion question AND for any
        // CONTRACT-ENFORCED type (safety/link/source/product-about) so those always
        // flow through the contract-injected streamChat below.
        const isStealthChat = isStealthEvasionQuestion(message);
        const fastPathEligible = !imagePaths?.length && !isCodingChat
          && !isAssistantIdentityQuestion(message)
          && !isStealthChat
          && answerPlan.answerType !== 'ethical_usage_answer'
          && answerPlan.answerType !== 'project_link_answer'
          && answerPlan.answerType !== 'source_code_evidence_answer'
          && answerPlan.answerType !== 'project_about_answer';
        if (fastPathEligible) {
          try {
            const orchestrator = llmHelper.getKnowledgeOrchestrator?.();
            const { route: fastPath, routeLog } = buildManualProfileBackendAnswer({
              question: message,
              orchestrator,
              source: 'manual_input',
            });
            if (fastPath || routeLog.profileFactsReady) {
              console.log('[ProfileIntelligence] manual route', routeLog);
            }
            if (fastPath) {
              if (_chatStreamsBySender.get(senderId)?.streamId !== myStreamId) return null;
              event.sender.send('gemini-stream-token', fastPath.answer);
              event.sender.send('gemini-stream-done', { finalText: fastPath.answer });
              try { PhoneMirrorService.getInstance().publishToken(String(myStreamId), fastPath.answer); } catch (_) { /* noop */ }
              try { PhoneMirrorService.getInstance().publishDone(String(myStreamId), fastPath.answer); } catch (_) { /* noop */ }
              intelligenceManager.addAssistantMessage(fastPath.answer);
              intelligenceManager.logUsage('chat', message, fastPath.answer);
              chatTrace.markFirstUseful({ via: 'profile_fast_path' });
              chatTrace.mark('response_completed', { chars: fastPath.answer.length, deterministic: true });
              chatTrace.finish({ chars: fastPath.answer.length });
              return null;
            }
          } catch (profileRouteError: any) {
            console.warn('[ProfileIntelligence] manual route preflight failed; falling back to generic chat:', profileRouteError?.message || profileRouteError);
          }
        }

        if (!isCodingChat) {
          try {
            const orchestrator = llmHelper.getKnowledgeOrchestrator?.();
            const activeResume = (orchestrator as any)?.activeResume?.structured_data ?? null;
            const profileReady = profileFactsReady(activeResume);
            const wantsProfileContext = answerPlan.requiredContextLayers.some((layer) =>
              layer === 'stable_identity' || layer === 'resume' || layer === 'jd' || layer === 'negotiation'
            );
            if (wantsProfileContext || profileReady) {
              console.log('[ProfileIntelligence] manual route', {
                source: 'manual_input',
                questionHash: crypto.createHash('sha256').update(message).digest('hex').slice(0, 12),
                answerType: answerPlan.answerType,
                selectedContextLayers: wantsProfileContext ? answerPlan.requiredContextLayers : [],
                excludedContextLayers: answerPlan.forbiddenContextLayers,
                profileFactsReady: profileReady,
                usedDeterministicFastPath: false,
                providerUsed: true,
                promptContainsProfileContext: Boolean(profileReady && wantsProfileContext),
              });
            }
          } catch { /* safe logging only */ }
        }

        // Answer types whose deterministic TEMPLATE carries non-negotiable
        // behavior the model MUST follow — the safety decline (stealth/evasion),
        // the no-invented-link rule, the no-hallucinated-source-code rule, and the
        // grounded product-about rule. For these we inject the answer contract into
        // the prompt (like coding) so the template reaches the model, and we drop
        // the rolling 100s context (it would dilute the contract). Release 2026-06-06b.
        const CONTRACT_ENFORCED_TYPES = new Set([
          'ethical_usage_answer', 'project_link_answer',
          'source_code_evidence_answer', 'project_about_answer',
        ]);
        const isContractEnforced = CONTRACT_ENFORCED_TYPES.has(answerPlan.answerType);
        if (isCodingChat || isContractEnforced) {
          context = formatAnswerPlanForPrompt(answerPlan, isCodingChat && isCodeVerificationEnabled());
          console.log('[IPC] Answer-contract enforced; rolling context excluded', {
            answerType: answerPlan.answerType,
          });
        } else if (!context && autoContextSnapshot) {
          context = autoContextSnapshot;
          console.log(
            `[IPC] Auto-injected 100s context for gemini-chat-stream (${context.length} chars)`,
          );
        }
        // MANUAL REGRESSION FIX (release 2026-06-08): for ANY profile-required
        // candidate answer type (jd_fit / skill / behavioral / project / experience /
        // identity / negotiation), ADDITIVELY prepend the answer-contract — the
        // answerType + the adaptive STYLE directive + the strict response template —
        // WITHOUT dropping the rolling profile grounding. Without this the model
        // received the profile facts as raw context with no instruction and collapsed
        // EVERY non-fast-path question into the generic self-intro (the exact bug the
        // user hit: "why should we hire you", "rate your Python", "JD fit", "what gap"
        // all returned the same intro). The contract makes the model produce the RIGHT
        // answer type AND honor the requested style (one-line / bullets / detailed).
        const CANDIDATE_CONTRACT_TYPES = new Set([
          'identity_answer', 'profile_fact_answer', 'experience_answer', 'project_answer',
          'project_followup_answer', 'skills_answer', 'skill_experience_answer',
          'jd_fit_answer', 'gap_analysis_answer', 'behavioral_interview_answer', 'negotiation_answer',
        ]);
        const wantsCandidateContract = CANDIDATE_CONTRACT_TYPES.has(answerPlan.answerType)
          // a styled question ALWAYS gets the contract so the style reaches the model.
          || (answerPlan.answerStyle && answerPlan.answerStyle !== 'default');
        if (wantsCandidateContract && !isContractEnforced && !isCodingChat) {
          const candidateContract = formatAnswerPlanForPrompt(answerPlan, false);
          context = context ? `${candidateContract}\n\n${context}` : candidateContract;
        }

        // Use CHAT_MODE_PROMPT for general chat — bypasses the interview-copilot
        // framing in HARD_SYSTEM_PROMPT/ASSIST_MODE_PROMPT that was causing coding
        // questions to be answered with "At Aetherbot AI, I was responsible for..."
        // (resume hijack via CONTEXT_INTELLIGENCE_LAYER's "you ARE the user").
        const systemPromptOverride: string | undefined = options?.skipSystemPrompt
          ? ''
          : CHAT_MODE_PROMPT;

        try {
          // USE streamChat which handles routing. Pass the abort signal as
          // the trailing arg so the generator stops yielding when this stream
          // is superseded or explicitly cancelled via gemini-chat-stream-stop.
          // The signature accepts a final optional `abortSignal?: AbortSignal`
          // that streamChat extracts from its variadic args.
          // NOTE: streamChat does its pre-stream work (knowledge intercept /
          // processQuestion, cache create, provider connect) lazily on the first
          // `for await` pull — so the gap between this mark and first_useful_token
          // below is exactly the pre-work + provider TTFT we're hunting.
          // A pure SAFETY answer (stealth/evasion decline) must not run the
          // knowledge intercept at all — no profile, no intro, no candidate
          // grounding belongs in a policy redirect (release 2026-06-06b).
          const isSafetyAnswer = answerPlan.answerType === 'ethical_usage_answer';
          const ignoreKnowledge = isCodingChat || isSafetyAnswer ? true : options?.ignoreKnowledgeMode;
          chatTrace.mark('provider_request_started', { ignoreKnowledgeMode: Boolean(ignoreKnowledge) });
          const stream = llmHelper.streamChat(
            message,
            imagePaths,
            context,
            systemPromptOverride,
            ignoreKnowledge,
            isCodingChat || isSafetyAnswer, // skipModeInjection; safety/coding must not pull active-mode resume/JD/reference context
            [],    // extraDataScopes
            myController.signal,
            // Coding gets a small reasoning budget (correctness); everything else
            // streams with thinking off (fastest TTFT).
            llmHelper.thinkingBudgetForAnswerType(isCodingChat),
            // D1/R1: thread the deterministic routing decision into the execution
            // path so the knowledge intercept + active-mode injection HONOR the
            // answer type's forbidden layers (no profile for coding/technical/
            // sales/lecture) and scope custom context by the real answer type.
            { answerType: answerPlan.answerType, forbiddenContextLayers: answerPlan.forbiddenContextLayers },
          );

          // Coding chat STREAMS LIVE through a gate that holds tokens only until
          // the first "## " heading is confirmed (never code-first), then passes
          // every token through. This fixes the regression where coding chat
          // buffered the whole response and the user waited the full generation
          // time with no visible progress. validate→repair below is a SAFETY NET:
          // if repair changed the answer, we send the corrected final text on
          // 'gemini-stream-done' so the renderer replaces the row in place.
          const codingGate = isCodingChat ? new CodingStreamGate() : null;
          // Suppress the trailing hidden <verification_spec> from the live stream.
          const { StreamingSpecStripper } = require('./llm/codingContract') as typeof import('./llm/codingContract');
          const chatSpecStripper = isCodingChat ? new StreamingSpecStripper() : null;
          const sendChunk = (chunk: string) => {
            const visible = chatSpecStripper ? chatSpecStripper.push(chunk) : chunk;
            if (!visible) return;
            event.sender.send('gemini-stream-token', visible);
            try {
              PhoneMirrorService.getInstance().publishToken(String(myStreamId), visible);
            } catch (_) {
              /* noop */
            }
          };

          // LIVE LATENCY GUARD (manual chat) — the centralized deadline driver
          // (electron/llm/liveDeadlines.ts). A `for await` blocks forever on a
          // hung provider and even `await iterator.return()` blocks if the
          // generator is stuck in an await, so the driver fire-and-forgets
          // cleanup. First-useful budget (per answer type) then an inter-token
          // stall guard (not a wall-clock cap, so long coding answers stream in
          // full). This is the no-134s / no-30s-hang guarantee (Issue 1, P0).
          let manualFirstUseful = false;
          let manualSuperseded = false;
          await raceStreamWithDeadline({
            stream: stream as AsyncGenerator<string>,
            firstUsefulDeadlineMs: firstUsefulDeadlineMs(answerPlan.answerType),
            isUsefulYet: () => manualFirstUseful,
            shouldAbort: () => {
              if (_chatStreamsBySender.get(senderId)?.streamId !== myStreamId) {
                console.log(`[IPC] gemini-chat-stream ${myStreamId} superseded for sender ${senderId}, stopping.`);
                manualSuperseded = true; return true;
              }
              return false;
            },
            onFirstUsefulTimeout: () => { chatTrace.mark('provider_timeout', { reason: 'first_useful' }); },
            onStallTimeout: () => { chatTrace.mark('provider_timeout', { reason: 'inter_token_stall' }); },
            // Abort the underlying provider request on timeout/supersession so a
            // stalled HTTP stream doesn't leak (the signal was passed to streamChat).
            onCleanup: () => { try { myController?.abort(); } catch { /* noop */ } },
            onToken: (token: string) => {
              manualFirstUseful = true;
              // First token back from the provider — the gap from
              // provider_request_started is pre-work + provider TTFT (the real cost).
              chatTrace.markFirstUseful({ via: codingGate ? 'gated' : 'stream' });
              fullResponse += token;
              if (codingGate) {
                const out = codingGate.push(token);
                if (out) sendChunk(out);
              } else {
                sendChunk(token);
              }
            },
          });
          if (manualSuperseded) return null;

          // Flush any tokens still held by the gate (short answer that never
          // crossed the "## " heading), so the streamed row holds the full text.
          if (codingGate) {
            const gatedTail = codingGate.finish();
            const tail = chatSpecStripper ? (chatSpecStripper.push(gatedTail) + chatSpecStripper.finish()) : gatedTail;
            if (tail) {
              event.sender.send('gemini-stream-token', tail);
              try { PhoneMirrorService.getInstance().publishToken(String(myStreamId), tail); } catch (_) { /* noop */ }
            }
          }

          // DEADLINE FALLBACK (manual chat): the provider stalled past the
          // first-useful budget and streamed nothing useful — substitute a
          // deterministic grounded answer (profile routes) or an honest
          // insufficient-context line, so a live answer is NEVER blank when a safe
          // fallback exists (Issue 1 / spec). Only when !manualFirstUseful.
          if (!manualFirstUseful && !fullResponse.trim()) {
            let fb = '';
            try {
              const orchFb = llmHelper.getKnowledgeOrchestrator?.();
              const resumeFb = (orchFb as any)?.activeResume?.structured_data ?? null;
              const jdFb = (orchFb as any)?.activeJD?.structured_data ?? null;
              if (resumeFb && answerPlan.profileContextPolicy === 'required') {
                fb = buildLiveFallbackAnswer({ question: message, answerType: answerPlan.answerType, profile: resumeFb, jobDescription: jdFb }) || '';
              }
            } catch { /* best effort */ }
            if (!fb) {
              fb = (answerPlan.answerType === 'general_meeting_answer' || answerPlan.answerType === 'lecture_answer')
                ? "I don't have enough context from the conversation to answer that yet."
                : 'Let me come back to that in just a moment.';
            }
            fullResponse = fb;
            sendChunk(fb);
            chatTrace.mark('fallback_answer_used' as any, { answerType: answerPlan.answerType });
          }

          // Keep the RAW response (with the hidden <verification_spec>) for
          // background verification; strip it from everything displayed/persisted.
          const rawResponseForVerify = fullResponse;
          const { stripVerificationSpec: _stripSpec } = require('./llm/codingContract') as typeof import('./llm/codingContract');
          if (isCodingChat) fullResponse = _stripSpec(fullResponse);

          // Safety net: validate the STREAMED coding answer; only when repair
          // actually changes it do we hand the renderer a corrective finalText.
          let finalText: string | undefined;
          if (isCodingChat) {
            const structureValidation = validateAnswerStructure(answerPlan.answerType, fullResponse);
            if (!structureValidation.ok && structureValidation.repaired) {
              console.warn('[IPC] Repaired coding chat answer structure', {
                answerType: answerPlan.answerType,
                missingSections: structureValidation.missingSections,
                hasCodeBlock: structureValidation.hasCodeBlock,
                hasComplexity: structureValidation.hasComplexity,
              });
              if (structureValidation.repaired !== fullResponse) {
                finalText = structureValidation.repaired;
              }
              fullResponse = structureValidation.repaired;
            }
          } else {
            // Spec §7 / §12.9: validate PROFILE answers post-generation. Detects
            // the assistant-identity leak ("I am Natively"), false "no access" /
            // "no experience" refusals when the profile exists, wrong perspective,
            // and sensitive/salary leaks. Deterministic, no extra LLM call on the
            // hot path; logged for telemetry. A future iteration can trigger a
            // bounded regeneration with buildProfileRepairInstruction.
            try {
              const orchestrator = llmHelper.getKnowledgeOrchestrator?.();
              const activeResume = (orchestrator as any)?.activeResume?.structured_data ?? null;
              const activeJD = (orchestrator as any)?.activeJD?.structured_data ?? null;
              const profileAvailable = profileFactsReady(activeResume);
              // Phase 6: evidence-aware validation. Composes the perspective /
              // identity / refusal / leak checks AND flags FABRICATED metrics
              // ("25% retention") or companies not present in the grounded facts.
              // Evidence = the profile facts the model was grounded in. Deterministic,
              // log-only on this hot path (no re-generation → no added latency); the
              // violation CODES are logged, never raw profile content.
              const evidence = `${JSON.stringify(activeResume || {})}\n${JSON.stringify(activeJD || {})}`;
              const profileValidation = validateProfileEvidence({
                answer: fullResponse,
                plan: answerPlan,
                evidence,
                profileAvailable,
                // Manual chat: the user is asking; only treat as candidate-directed
                // when the answer type speaks as the candidate AND a profile exists.
                candidateDirected: profileAvailable,
              });
              if (!profileValidation.ok) {
                console.warn('[ProfileIntelligence] profile evidence violations', {
                  answerType: answerPlan.answerType,
                  violations: profileValidation.violations.map(v => v.code),
                });
              }

              // Phase 4/7: CRITICAL-violation REPAIR (manual path). A profile/
              // identity answer must never answer as "Natively / an AI" or falsely
              // refuse ("I can't share that", "I don't have your resume loaded")
              // when the profile IS loaded. On such a violation we do ONE bounded
              // regeneration grounded in the candidate facts and hand the renderer
              // a corrective finalText (in-place replace via gemini-stream-done).
              // Only fires on a real detected violation → zero happy-path latency.
              const CRITICAL_CODES = new Set(['assistant_identity_leak', 'false_no_access_refusal', 'false_no_experience_refusal']);
              const critical = profileAvailable
                && answerPlan.profileContextPolicy === 'required'
                && validateProfileOutput({ answer: fullResponse, plan: answerPlan, profileAvailable: true, candidateDirected: true })
                  .violations.find(v => v.severity === 'error' && CRITICAL_CODES.has(v.code));
              if (critical && _chatStreamsBySender.get(senderId)?.streamId === myStreamId) {
                try {
                  const orch2 = llmHelper.getKnowledgeOrchestrator?.();
                  let facts = '';
                  try { facts = (await orch2?.processQuestion?.(message))?.contextBlock || ''; } catch { /* best effort */ }
                  if (!facts) facts = `${JSON.stringify(activeResume || {})}`;
                  const repairInstruction = buildProfileRepairInstruction({ ok: false, violations: [critical] } as any);
                  const repairPrompt = `${repairInstruction}\n\nCandidate facts (ground every claim in these; second person to the user is fine, but NEVER say you are Natively or an AI, and NEVER claim the profile is missing):\n${facts}\n\nQuestion: ${message}\n\nRewrite the answer now.`;
                  let repaired = '';
                  // Deadline-guarded (7s) so a stalled repair provider can't re-hang
                  // the request after a streamed answer already showed (Issue 1). 7s
                  // (was 4s) clears MiniMax's 4-6s first-token when it's the fallback.
                  await raceStreamWithDeadline({
                    stream: llmHelper.streamChat(repairPrompt, undefined, undefined, undefined, true, true) as AsyncGenerator<string>,
                    firstUsefulDeadlineMs: 7000,
                    isUsefulYet: () => repaired.length >= 5,
                    shouldAbort: () => repaired.length > 1200,
                    onToken: (tok: string) => { repaired += tok; },
                  });
                  const repairedTrim = repaired.trim();
                  if (repairedTrim.length >= 5) {
                    const reCheck = validateProfileOutput({ answer: repairedTrim, plan: answerPlan, profileAvailable: true, candidateDirected: true });
                    const stillCritical = reCheck.violations.some(v => v.severity === 'error' && CRITICAL_CODES.has(v.code));
                    if (!stillCritical) {
                      fullResponse = repairedTrim;
                      finalText = repairedTrim;
                      console.warn('[ProfileIntelligence] manual profile repair applied', { code: critical.code });
                    }
                  }
                } catch (repairErr: any) {
                  console.warn('[ProfileIntelligence] manual profile repair failed (non-fatal):', repairErr?.message || repairErr);
                }
              }
            } catch (validationError: any) {
              console.warn('[ProfileIntelligence] profile output validation failed (non-fatal):', validationError?.message || validationError);
            }
          }

          // Release 2026-06-07 (code-review hardening): ANY profile-FORBIDDEN answer
          // (coding/DSA/technical-concept/system-design/debugging/sales/lecture/
          // meeting) must NOT name Natively, the candidate, a loaded project/company,
          // or reference the profile/JD/salary — flash-lite intermittently appends a
          // stray mention. Detect deterministically and STRIP the offending prose
          // sentence (code blocks preserved). Self-gated by the validator (only fires
          // for forbidden types) → zero happy-path cost on profile answers. The user
          // can opt in ("use my Natively project"). Runs for coding AND non-coding
          // forbidden types (previously coding-only).
          if (answerPlan.profileContextPolicy === 'forbidden') {
            try {
              const orchC = llmHelper.getKnowledgeOrchestrator?.();
              const resumeC = (orchC as any)?.activeResume?.structured_data ?? null;
              const profileTokens = resumeC ? {
                firstName: (resumeC.identity?.name || resumeC.name || '').trim().split(/\s+/)[0] || undefined,
                projects: (resumeC.projects || []).map((p: any) => (p?.name || '').split(/[–—-]/)[0].trim()).filter((s: string) => s.length >= 3),
                companies: (resumeC.experience || []).map((e: any) => (e?.company || '').trim()).filter((s: string) => s.length >= 3),
              } : undefined;
              const profileExplicitlyInvited = /\b(use|using|with|in|from)\s+(my|your|the)\s+(natively|project|portfolio)\b|\bin natively\b|\b(my|your) natively project\b/i.test(message);
              const codeLeak = validateProfileOutput({
                answer: fullResponse, plan: answerPlan, profileAvailable: Boolean(resumeC),
                candidateDirected: false, profileTokens, profileExplicitlyInvited,
              }).violations.find(v => v.code === 'profile_token_in_coding_answer');
              if (codeLeak) {
                const tokens = [profileTokens?.firstName, ...(profileTokens?.projects || []), ...(profileTokens?.companies || [])].filter((t): t is string => !!t);
                const stripped = stripProfileTokensFromCoding(fullResponse, tokens);
                const reCheck = validateProfileOutput({ answer: stripped, plan: answerPlan, profileAvailable: Boolean(resumeC), candidateDirected: false, profileTokens, profileExplicitlyInvited });
                const stillLeaks = reCheck.violations.some(v => v.code === 'profile_token_in_coding_answer');
                if (!stillLeaks && stripped.trim().length >= 20) {
                  fullResponse = stripped;
                  finalText = stripped;
                  console.warn('[ProfileIntelligence] stripped stray profile token from a profile-forbidden answer', { answerType: answerPlan.answerType });
                }
              }
            } catch (codeLeakErr: any) {
              console.warn('[ProfileIntelligence] forbidden-answer leak validation skipped:', codeLeakErr?.message);
            }
          }

          // Release 2026-06-07c: FINAL candidate-answer sanitizer. A candidate-facing
          // answer (identity/experience/project/skills/jd-fit/behavioral/negotiation)
          // must NOT tail-append assistant-meta ("as an AI assistant", "I'm Natively",
          // "I can't share", "I don't have your resume"). Flash-lite occasionally adds
          // such a sentence to an otherwise-valid answer. Strip it deterministically;
          // if stripping empties the answer, fall back to the deterministic profile
          // backend so the user never gets a broken/empty answer.
          if (CANDIDATE_VOICE_ANSWER_TYPES.has(answerPlan.answerType)) {
            try {
              const sani = sanitizeCandidateAnswer(fullResponse);
              if (sani.repaired && !sani.needsFallback) {
                fullResponse = sani.text;
                finalText = sani.text;
                piTelemetry.emit('pi_candidate_sanitizer_applied', { answerType: answerPlan.answerType, repaired: true, needsFallback: false, markerCount: sani.removedMarkers.length });
                console.warn('[ProfileIntelligence] sanitized assistant-meta tail from candidate answer', { answerType: answerPlan.answerType, markers: sani.removedMarkers });
              } else if (sani.needsFallback) {
                piTelemetry.emit('pi_candidate_sanitizer_applied', { answerType: answerPlan.answerType, repaired: true, needsFallback: true, markerCount: sani.removedMarkers.length });
                // The whole answer was assistant-meta. Build a deterministic
                // profile-grounded replacement instead of shipping an empty/broken one.
                const orchS = llmHelper.getKnowledgeOrchestrator?.();
                const fb = buildManualProfileBackendAnswer({ question: message, orchestrator: orchS, source: 'manual_input' });
                if (fb?.route?.answer && fb.route.answer.trim().length >= 15) {
                  fullResponse = fb.route.answer;
                  finalText = fb.route.answer;
                  console.warn('[ProfileIntelligence] candidate answer was all assistant-meta; used deterministic fallback', { answerType: answerPlan.answerType });
                }
              }
            } catch (saniErr: any) {
              console.warn('[ProfileIntelligence] candidate sanitizer skipped:', saniErr?.message);
            }
          }

          // Final check: only send done if we are still the active stream
          if (_chatStreamsBySender.get(senderId)?.streamId === myStreamId) {
            // finalText is set ONLY when repair changed the streamed answer — the
            // renderer replaces the streamed row in place (no double-render). When
            // the streamed answer was already valid, finalText is undefined and the
            // already-streamed tokens stand.
            event.sender.send('gemini-stream-done', finalText ? { finalText } : undefined);
            chatTrace.mark('response_completed', { chars: fullResponse.length, repaired: Boolean(finalText) });
            chatTrace.finish({ chars: fullResponse.length });
            try {
              PhoneMirrorService.getInstance().publishDone(String(myStreamId), fullResponse);
            } catch (_) {
              /* noop */
            }

            // Update IntelligenceManager with ASSISTANT message after completion
            if (fullResponse.trim().length > 0) {
              intelligenceManager.addAssistantMessage(fullResponse);
              // Log Usage for streaming chat
              intelligenceManager.logUsage('chat', message, fullResponse);
            }

            // VERIFIED CODE EXECUTION (background, strictly additive). For coding
            // chat answers, run the code against test cases AFTER it's shown —
            // never awaited, so first answer has zero added latency. Emits a ✓
            // badge on pass or a corrected message on a re-verified fix.
            if (isCodingChat && fullResponse.trim().length > 0 && isCodeVerificationEnabled()) {
              // Verify against the RAW response (keeps the spec); if repair changed
              // the answer, prefer the repaired (already spec-free) text.
              const verifyTarget = finalText || rawResponseForVerify;
              void (async () => {
                try {
                  const { verifyCodingAnswer } = await import('./llm/codeVerification/verifyCodingAnswer');
                  const { stripVerificationSpec } = await import('./llm/codingContract');
                  const outcome = await verifyCodingAnswer({
                    answer: verifyTarget,
                    question: message,
                    correct: async (repairPrompt: string) => {
                      // Background coding-correction (post-answer). Deadline-guarded
                      // so a stalled provider can't leave a hung background task. 7s
                      // (was 6s) clears MiniMax's 4-6s first-token when it's the fallback.
                      let fixed = '';
                      await raceStreamWithDeadline({
                        stream: llmHelper.streamChat(repairPrompt, undefined, undefined, undefined, true, true) as AsyncGenerator<string>,
                        firstUsefulDeadlineMs: 7000,
                        isUsefulYet: () => fixed.length >= 5,
                        onToken: (tok: string) => { fixed += tok; },
                      });
                      return fixed;
                    },
                  });
                  if (_chatStreamsBySender.get(senderId)?.streamId !== myStreamId) return; // superseded
                  if (outcome.verdict.passed) {
                    event.sender.send('intelligence-code-verified', {
                      question: message,
                      passed: outcome.verdict.passedCount,
                      total: outcome.verdict.total,
                      language: outcome.verdict.language || 'unknown',
                    });
                  } else if (outcome.corrected) {
                    event.sender.send('intelligence-code-correction', {
                      question: message,
                      answer: stripVerificationSpec(outcome.corrected.answer),
                      note: outcome.corrected.note,
                      reVerified: outcome.corrected.reVerifiedPassed,
                    });
                  }
                } catch (verifyErr: any) {
                  console.warn('[IPC] chat coding verification skipped (non-fatal):', verifyErr?.message);
                }
              })();
            }
          }
        } catch (streamError: any) {
          console.error('[IPC] Streaming error:', streamError);
          // Classify the provider failure (marker-only telemetry) and, when the route
          // can answer deterministically (a profile-required answer), emit the
          // deterministic profile fallback instead of a blank error — no empty answer
          // when a safe fallback exists. The fallback uses buildManualProfileBackendAnswer
          // (the DETERMINISTIC profile backend, NO LLM), so it cannot contain assistant-
          // meta and does not need the candidate sanitizer — same as the happy-path
          // profile fast-path which also emits this builder's output directly. It is
          // gated to profileContextPolicy==='required', so it can NEVER fire for a
          // coding/technical answer (those are 'forbidden') — no profile-into-coding leak.
          try {
            const klass = classifyProviderError(streamError);
            piTelemetry.emit('pi_provider_error_classified', { kind: klass.kind, outage: klass.isOutage, retryable: klass.retryable, surface: 'manual' });
            if (klass.isOutage && answerPlan.profileContextPolicy === 'required' && !fullResponse.trim()) {
              const orchE = llmHelper.getKnowledgeOrchestrator?.();
              const fb = buildManualProfileBackendAnswer({ question: message, orchestrator: orchE, source: 'manual_input' });
              if (fb?.route?.answer && fb.route.answer.trim().length >= 15 && _chatStreamsBySender.get(senderId)?.streamId === myStreamId) {
                piTelemetry.emit('provider_fallback_used', { surface: 'manual', kind: klass.kind, answerType: answerPlan.answerType });
                event.sender.send('gemini-stream-token', fb.route.answer);
                event.sender.send('gemini-stream-done', { finalText: fb.route.answer });
                try { PhoneMirrorService.getInstance().publishToken(String(myStreamId), fb.route.answer); PhoneMirrorService.getInstance().publishDone(String(myStreamId), fb.route.answer); } catch (_) { /* noop */ }
                intelligenceManager.addAssistantMessage(fb.route.answer);
                return null;
              }
            }
          } catch (classifyErr: any) { console.warn('[IPC] provider-error classify/fallback skipped:', classifyErr?.message); }
          if (_chatStreamsBySender.get(senderId)?.streamId === myStreamId) {
            event.sender.send(
              'gemini-stream-error',
              streamError.message || 'Unknown streaming error',
            );
            try {
              PhoneMirrorService.getInstance().publishError(
                String(myStreamId),
                streamError?.message || 'Unknown streaming error',
              );
            } catch (_) {
              /* noop */
            }
          }
        }

        return null; // Return null as data is sent via events
      } catch (error: any) {
        console.error('[IPC] Error in gemini-chat-stream setup:', error);
        throw error;
      } finally {
        if (myController) {
          const current = _chatStreamsBySender.get(event.sender.id);
          if (current?.controller === myController) {
            _chatStreamsBySender.delete(event.sender.id);
          }
        }
      }
    },
  );

  // Renderer-driven cancellation for the sender's active chat stream.
  safeOn('gemini-chat-stream-stop', (event) => {
    const senderId = event.sender.id;
    const stream = _chatStreamsBySender.get(senderId);
    if (stream) {
      try { stream.controller.abort(); } catch { /* noop */ }
      _chatStreamsBySender.delete(senderId);
    }
  });

  safeHandle('quit-app', () => {
    app.quit();
  });

  safeHandle('quit-and-install-update', async () => {
    try {
      console.log('[IPC] Quit and install update requested');
      await appState.quitAndInstallUpdate();
      return { success: true };
    } catch (err: any) {
      console.error('[IPC] quit-and-install-update failed:', err);
      return { success: false, error: err.message };
    }
  });

  safeHandle('delete-meeting', async (_, id: string) => {
    return DatabaseManager.getInstance().deleteMeeting(id);
  });

  safeHandle('check-for-updates', async () => {
    try {
      console.log('[IPC] Manual update check requested');
      await appState.checkForUpdates();
      return { success: true };
    } catch (err: any) {
      console.error('[IPC] check-for-updates failed:', err);
      return { success: false, error: err.message };
    }
  });

  safeHandle('download-update', async () => {
    try {
      console.log('[IPC] Download update requested');
      await appState.downloadUpdate();
      return { success: true };
    } catch (err: any) {
      console.error('[IPC] download-update failed:', err);
      return { success: false, error: err.message };
    }
  });

  // Whether this build can perform a real in-place auto-install + relaunch
  // (signed macOS build, or any packaged Windows/Linux build). The renderer
  // uses this to choose the in-app update flow vs. the manual download fallback.
  safeHandle('get-can-auto-update', async () => {
    try {
      return { canAutoUpdate: appState.canAutoUpdate() };
    } catch (err: any) {
      console.error('[IPC] get-can-auto-update failed:', err);
      return { canAutoUpdate: false };
    }
  });

  // Window movement handlers
  safeHandle('move-window-left', async () => {
    appState.moveWindowLeft();
  });

  safeHandle('move-window-right', async () => {
    appState.moveWindowRight();
  });

  safeHandle('move-window-up', async () => {
    appState.moveWindowUp();
  });

  safeHandle('move-window-down', async () => {
    appState.moveWindowDown();
  });

  safeHandle('center-and-show-window', async () => {
    appState.centerAndShowWindow();
  });

  // Window Controls
  safeHandle('window-minimize', async () => {
    appState.getWindowHelper().minimizeWindow();
  });

  safeHandle('window-maximize', async () => {
    appState.getWindowHelper().maximizeWindow();
  });

  safeHandle('window-close', async () => {
    appState.getWindowHelper().closeWindow();
  });

  safeHandle('window-is-maximized', async () => {
    return appState.getWindowHelper().isMainWindowMaximized();
  });

  // Settings Window
  safeHandle('toggle-settings-window', (event, { x, y } = {}) => {
    appState.settingsWindowHelper.toggleWindow(x, y);
  });

  // Open the launcher's SettingsOverlay on a specific tab (callable from any window)
  safeHandle('settings:open-tab', (_, tab: string) => {
    const launcherWin = appState.getWindowHelper().getLauncherWindow();
    if (launcherWin && !launcherWin.isDestroyed()) {
      launcherWin.webContents.send('settings:open-tab', tab);
      if (appState.getUndetectable()) {
        launcherWin.showInactive();
      } else {
        launcherWin.show();
        launcherWin.focus();
      }
    }
  });

  safeHandle('close-settings-window', () => {
    appState.settingsWindowHelper.closeWindow();
  });

  safeHandle('set-undetectable', async (_, state: boolean) => {
    appState.setUndetectable(state);
    // Return the AUTHORITATIVE final state so the renderer can reconcile / roll
    // back its optimistic toggle instead of assuming success (RC-2).
    return { success: true, state: appState.getUndetectable() };
  });

  safeHandle('set-disguise', async (_, mode: 'terminal' | 'settings' | 'activity' | 'none') => {
    appState.setDisguise(mode);
    return { success: true };
  });

  safeHandle('get-undetectable', async () => {
    return appState.getUndetectable();
  });

  // Adapted from public PR #113 — verify premium interaction
  safeHandle('set-overlay-mouse-passthrough', async (_, enabled: boolean) => {
    appState.setOverlayMousePassthrough(enabled);
    // Authoritative final state for renderer reconciliation (RC-2).
    return { success: true, enabled: appState.getOverlayMousePassthrough() };
  });

  safeHandle('toggle-overlay-mouse-passthrough', async () => {
    const enabled = appState.toggleOverlayMousePassthrough();
    return { success: true, enabled };
  });

  safeHandle('get-overlay-mouse-passthrough', async () => {
    return appState.getOverlayMousePassthrough();
  });

  // Hover-gated click-through for the fixed-width overlay's transparent margins.
  // The renderer hit-tests the pointer against the painted panel rect and reports
  // whether the pointer is currently over interactive content (true) or over a
  // transparent margin / outside it (false). This ONLY affects interactive mode —
  // when the master stealth passthrough is on, the window stays fully
  // click-through regardless (enforced in syncOverlayInteractionPolicy). Only the
  // overlay window's own webContents may drive this.
  safeHandle('set-overlay-interactive-region', async (event, overContent: boolean) => {
    const overlayWin = appState.getWindowHelper().getOverlayWindow();
    if (
      overlayWin &&
      !overlayWin.isDestroyed() &&
      overlayWin.webContents.id === event.sender.id
    ) {
      appState.getWindowHelper().setOverlayHoverInteractive(!!overContent);
    }
    return { success: true };
  });

  safeHandle('get-disguise', async () => {
    return appState.getDisguise();
  });

  safeHandle('set-open-at-login', async (_, openAtLogin: boolean) => {
    app.setLoginItemSettings({
      openAtLogin,
      openAsHidden: false,
      path: app.getPath('exe'), // Explicitly point to executable for production reliability
    });
    return { success: true };
  });

  safeHandle('get-open-at-login', async () => {
    const settings = app.getLoginItemSettings();
    return settings.openAtLogin;
  });

  safeHandle('get-verbose-logging', async () => {
    return appState.getVerboseLogging();
  });

  safeHandle('set-verbose-logging', async (_, enabled: boolean) => {
    appState.setVerboseLogging(enabled);
    return { success: true };
  });

  safeHandle('get-meeting-retention', async () => {
    return SettingsManager.getInstance().get('meetingRetention') ?? 'forever';
  });

  safeHandle('set-meeting-retention', async (_, retention: 'forever' | '7d' | '30d' | 'never') => {
    if (!['forever', '7d', '30d', 'never'].includes(retention)) {
      return { success: false, error: 'invalid_retention' };
    }
    SettingsManager.getInstance().set('meetingRetention', retention);
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('meeting-retention-changed', retention);
      }
    });
    return { success: true };
  });

  safeHandle('get-provider-data-scopes', async () => {
    return SettingsManager.getInstance().get('providerDataScopes') ?? {};
  });

  safeHandle('set-provider-data-scopes', async (_, scopes: Record<string, boolean>) => {
    if (!scopes || typeof scopes !== 'object') {
      return { success: false, error: 'invalid_scopes' };
    }
    const allowedKeys = new Set([
      'transcript',
      'screenshots',
      'reference_files',
      'profile_history',
      'embeddings',
      'post_call_summary',
    ]);
    const sanitized: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(scopes)) {
      if (allowedKeys.has(key) && typeof value === 'boolean') {
        sanitized[key] = value;
      }
    }
    SettingsManager.getInstance().set('providerDataScopes', sanitized as any);
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('provider-data-scopes-changed', sanitized);
      }
    });
    return { success: true };
  });

  safeHandle('get-screen-understanding-mode', async () => {
    return SettingsManager.getInstance().getScreenUnderstandingMode();
  });

  safeHandle(
    'set-screen-understanding-mode',
    async (_, mode: 'vision_first' | 'vision_only' | 'private_vision') => {
      if (!['vision_first', 'vision_only', 'private_vision'].includes(mode)) {
        return { success: false, error: 'invalid_mode' };
      }
      SettingsManager.getInstance().setScreenUnderstandingMode(mode);
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send('screen-understanding-mode-changed', mode);
        }
      });
      return { success: true };
    },
  );

  safeHandle('get-technical-interview-vision-first', async () => {
    return SettingsManager.getInstance().getTechnicalInterviewVisionFirst();
  });

  safeHandle('set-technical-interview-vision-first', async (_, enabled: boolean) => {
    if (typeof enabled !== 'boolean') {
      return { success: false, error: 'invalid_value' };
    }
    SettingsManager.getInstance().set('technicalInterviewVisionFirst', enabled);
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('technical-interview-vision-first-changed', enabled);
      }
    });
    return { success: true };
  });

  // Legacy alias for renderer builds that still call the old IPC name.
  // Maps the deprecated technicalInterviewDirectVision channel onto the new
  // technicalInterviewVisionFirst getter/setter so old renderer builds keep working.
  safeHandle('get-technical-interview-direct-vision', async () => {
    return SettingsManager.getInstance().getTechnicalInterviewVisionFirst();
  });
  safeHandle('set-technical-interview-direct-vision', async (_, enabled: boolean) => {
    if (typeof enabled !== 'boolean') {
      return { success: false, error: 'invalid_value' };
    }
    SettingsManager.getInstance().set('technicalInterviewVisionFirst', enabled);
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('technical-interview-vision-first-changed', enabled);
      }
    });
    return { success: true };
  });

  // Onboarding & gate persistent backup flags
  safeHandle('onboarding:get-flags', async () => {
    const sm = SettingsManager.getInstance();
    return {
      seenStartup: sm.get('seenStartup') ?? false,
      seenProfileOnboarding: sm.get('seenProfileOnboarding') ?? false,
      seenModesOnboarding: sm.get('seenModesOnboarding') ?? false,
      permsShown: sm.get('permsShown') ?? false,
    };
  });

  safeHandle('onboarding:set-flag', async (_, key: string, value: boolean) => {
    if (['seenStartup', 'seenProfileOnboarding', 'seenModesOnboarding', 'permsShown'].includes(key)) {
      if (typeof value !== 'boolean') {
        return { success: false, error: 'invalid_value_type' };
      }
      SettingsManager.getInstance().set(key as any, value);
      return { success: true };
    }
    return { success: false, error: 'invalid_key' };
  });

  safeHandle('get-log-file-path', async () => {
    try {
      return path.join(app.getPath('documents'), 'natively_debug.log');
    } catch {
      return null;
    }
  });

  safeHandle('open-log-file', async () => {
    try {
      const logPath = path.join(app.getPath('documents'), 'natively_debug.log');
      // Ensure the file exists before opening
      if (!fs.existsSync(logPath)) {
        fs.writeFileSync(logPath, '');
      }
      await shell.openPath(logPath);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // Fire-and-forget: renderer forwards its console output to the main-process log file.
  // Only written when verbose logging is enabled. Hardened against log injection
  // (CWE-117) and rotation thrash by validating types, capping length, stripping
  // control characters, and rate-limiting per sender.
  const FORWARD_LOG_MAX_LEN = 4 * 1024;
  const FORWARD_LOG_RATE_REFILL_MS = 1_000;
  const FORWARD_LOG_RATE_BUCKET = 200;
  const _forwardLogBuckets = new Map<number, { tokens: number; lastRefill: number }>();
  safeOn('forward-log-to-file', (event, level: unknown, msg: unknown) => {
    if (!appState.getVerboseLogging()) return;
    if (typeof level !== 'string' || typeof msg !== 'string') return;

    const senderId = event.sender?.id ?? -1;
    const now = Date.now();
    let bucket = _forwardLogBuckets.get(senderId);
    if (!bucket) {
      bucket = { tokens: FORWARD_LOG_RATE_BUCKET, lastRefill: now };
      _forwardLogBuckets.set(senderId, bucket);
      // Reap the bucket when the renderer goes away so the Map cannot grow
      // unbounded across renderer reloads / hidden-window churn.
      try {
        event.sender?.once?.('destroyed', () => {
          _forwardLogBuckets.delete(senderId);
        });
      } catch { /* noop */ }
    } else {
      const elapsed = now - bucket.lastRefill;
      if (elapsed > 0) {
        const refill = Math.floor((elapsed * FORWARD_LOG_RATE_BUCKET) / FORWARD_LOG_RATE_REFILL_MS);
        if (refill > 0) {
          bucket.tokens = Math.min(FORWARD_LOG_RATE_BUCKET, bucket.tokens + refill);
          bucket.lastRefill += Math.floor((refill * FORWARD_LOG_RATE_REFILL_MS) / FORWARD_LOG_RATE_BUCKET);
        }
      }
    }
    if (bucket.tokens <= 0) return;
    bucket.tokens -= 1;

    const tag =
      level === 'error' ? '[RENDERER-ERROR]' : level === 'warn' ? '[RENDERER-WARN]' : '[RENDERER]';
    const sanitized = msg
      .replace(/[\r\n\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ')
      .slice(0, FORWARD_LOG_MAX_LEN);
    console.log(`${tag}[${senderId}] ${sanitized}`);
  });

  // Meeting interface theme cross-window broadcast. The settings window writes
  // localStorage + sends this IPC; main re-broadcasts to every renderer so the
  // overlay window's React state updates without depending on the same-origin
  // `storage` event (which does not cross BrowserWindow boundaries in Electron).
  // Without this, switching the meeting interface theme while the overlay is
  // hidden leaves it with stale CSS on the next meeting start — manifest as a
  // half-painted UI that requires force-quit.
  // Allowlist must mirror MeetingInterfaceTheme in src/lib/meetingInterfaceTheme.ts.
  // Any string that reaches a renderer via interface-theme:changed ends up in
  // a `data-interface-theme={value}` DOM attribute on the overlay's wrapper
  // div (NativelyInterface.tsx). Without an allowlist, a compromised or buggy
  // renderer could broadcast an arbitrary string — at best CSS selector
  // mismatch (overlay falls back to default), at worst an attribute-injection
  // vector if any consumer ever switched from `setAttribute` to template
  // literals. Hardening the trust boundary at the broadcast point is cheap.
  const VALID_INTERFACE_THEMES = new Set(['default', 'liquid-glass', 'modern']);
  safeOn('interface-theme:set', (_event, theme: string) => {
    if (typeof theme !== 'string' || !VALID_INTERFACE_THEMES.has(theme)) {
      // Truncate + strip control chars before logging — a 64-char payload can
      // still embed \n/\r to forge log lines if a future log shipper parses
      // newline-delimited records.
      const safe = typeof theme === 'string'
        ? theme.slice(0, 64).replace(/[\r\n\x00-\x1f]/g, '?')
        : typeof theme;
      console.warn(`[interface-theme:set] Rejected unknown theme: ${safe}`);
      return;
    }
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.send('interface-theme:changed', theme);
      } catch {
        // Renderer may be tearing down between isDestroyed() and send.
      }
    });
  });

  safeHandle('get-arch', async () => {
    return process.arch;
  });

  safeHandle('get-os-version', async () => {
    const platform = process.platform;
    if (platform === 'darwin') {
      const darwinMajor = parseInt(os.release().split('.')[0] || '0', 10);
      // Darwin 25+ = macOS 26+ (calendar-year scheme), Darwin 20-24 = macOS 11-15
      const macosMajor =
        darwinMajor >= 25 ? darwinMajor + 1 : darwinMajor >= 20 ? darwinMajor - 9 : null;
      return macosMajor ? `macOS ${macosMajor}` : `macOS ${os.release()}`;
    }
    if (platform === 'win32') {
      const release = os.release();
      // Windows 11 build starts at 22000
      const majorBuild = parseInt(release.split('.')[2] || '0', 10);
      return majorBuild >= 22000 ? `Windows 11` : `Windows 10`;
    }
    return os.type();
  });

  // LLM Model Management Handlers
  safeHandle('get-current-llm-config', async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      return {
        provider: llmHelper.getCurrentProvider(),
        model: llmHelper.getCurrentModel(),
        isOllama: llmHelper.isUsingOllama(),
      };
    } catch (error: any) {
      // console.error("Error getting current LLM config:", error);
      throw error;
    }
  });

  safeHandle('get-available-ollama-models', async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const models = await llmHelper.getOllamaModels();
      return models;
    } catch (error: any) {
      // console.error("Error getting Ollama models:", error);
      throw error;
    }
  });

  safeHandle('switch-to-ollama', async (_, model?: string, url?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToOllama(model, url);
      return { success: true };
    } catch (error: any) {
      // console.error("Error switching to Ollama:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('force-restart-ollama', async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const success = await llmHelper.forceRestartOllama();
      return { success };
    } catch (error: any) {
      console.error('Error force restarting Ollama:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('restart-ollama', async () => {
    try {
      // First try to kill it if it's running
      await appState.processingHelper.getLLMHelper().forceRestartOllama();

      // The forceRestartOllama now calls OllamaManager.getInstance().init() internally
      // so we don't need to do it again here.

      return true;
    } catch (error: any) {
      console.error('[IPC restart-ollama] Failed to restart:', error);
      return false;
    }
  });

  safeHandle('ensure-ollama-running', async () => {
    try {
      const { OllamaManager } = require('./services/OllamaManager');
      await OllamaManager.getInstance().init();
      return { success: true };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  });

  safeHandle('switch-to-gemini', async (_, apiKey?: string, modelId?: string) => {
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
  safeHandle('set-gemini-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setGeminiApiKey(apiKey);

      // Also update the LLMHelper immediately
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setApiKey(apiKey);

      // CQ-06 fix: cancel any in-flight LLM stream before swapping LLM clients.
      // Use resetEngine() (NOT reset()) so session transcript is preserved mid-meeting.
      // initializeLLMs() now also calls engine.reset() internally for double-safety.
      appState.getIntelligenceManager().resetEngine();
      // Re-init IntelligenceManager
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error('Error saving Gemini API key:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-groq-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setGroqApiKey(apiKey);

      // Also update the LLMHelper immediately
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setGroqApiKey(apiKey);

      // CQ-06 fix: cancel in-flight stream before re-init (engine only, not session)
      appState.getIntelligenceManager().resetEngine();
      // Re-init IntelligenceManager
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error('Error saving Groq API key:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-openai-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setOpenaiApiKey(apiKey);

      // Also update the LLMHelper immediately
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setOpenaiApiKey(apiKey);

      // CQ-06 fix: cancel in-flight stream before re-init (engine only, not session)
      appState.getIntelligenceManager().resetEngine();
      // Re-init IntelligenceManager
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error('Error saving OpenAI API key:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-claude-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setClaudeApiKey(apiKey);

      // Also update the LLMHelper immediately
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setClaudeApiKey(apiKey);

      // CQ-06 fix: cancel in-flight stream before re-init (engine only, not session)
      appState.getIntelligenceManager().resetEngine();
      // Re-init IntelligenceManager
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error('Error saving Claude API key:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-deepseek-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setDeepseekApiKey(apiKey);

      // Also update the LLMHelper immediately
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setDeepseekApiKey(apiKey);

      // Cancel in-flight stream before re-init (engine only, not session)
      appState.getIntelligenceManager().resetEngine();
      // Re-init IntelligenceManager
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error('Error saving DeepSeek API key:', error);
      return { success: false, error: error.message };
    }
  });

  // ── Usage cache (60-second TTL, keyed by API key) ──────────────────────────
  const _usageCache = new Map<string, { data: any; ts: number }>();
  const USAGE_CACHE_TTL_MS = 60_000;
  const _pricingCache = new Map<string, { data: any; ts: number }>();
  const PRICING_CACHE_TTL_MS = 5 * 60_000;

  safeHandle('set-natively-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      const prevSttProvider = cm.getSttProvider();
      cm.setNativelyApiKey(apiKey);

      // Update LLMHelper immediately (same pattern as other provider keys)
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setNativelyKey(apiKey || null);

      // Sync the model into LLMHelper and notify the UI whenever the effective default changed
      const defaultModel = cm.getDefaultModel();
      const providers = [...(cm.getCurlProviders() || []), ...(cm.getCustomProviders() || [])];
      llmHelper.setModel(defaultModel, providers);
      appState.broadcast('model-changed', defaultModel);

      // If setNativelyApiKey auto-promoted the STT provider to 'natively', reconfigure
      // the audio pipeline immediately — without this, the in-memory pipeline still uses
      // the old STT provider (e.g. Google) until the app restarts.
      const newSttProvider = cm.getSttProvider();
      if (newSttProvider !== prevSttProvider) {
        console.log(
          `[IPC] set-natively-api-key: STT provider changed ${prevSttProvider} → ${newSttProvider}, reconfiguring pipeline`,
        );
        await appState.reconfigureSttProvider();
      }

      // Refresh any open settings UI. The Natively-key flow mutates the STT
      // provider and default model server-side (CredentialsManager.setNativelyApiKey
      // auto-promotes/reverts both). The SettingsOverlay STT dropdown re-reads
      // credentials only on the 'credentials-changed' event, so without this
      // broadcast the dropdown shows a stale provider after a key save/clear.
      // (Previously this refresh came transitively from the renderer's extra
      // setSttProvider() call, which we removed to kill the double-reconfigure
      // race — so the broadcast now has to happen here, at the source of truth.)
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('credentials-changed');
      });

      // Auto-activate Natively Pro for pro/max/ultra API plans.
      // Skips silently if the user already has a Gumroad/Dodo lifetime license.
      //
      // This is awaited inline — NOT detached. The await is what serializes a
      // rapid set→clear (or clear→set) sequence: it keeps the renderer's
      // "Saving…" state (and the disabled button) active until the license
      // mutation completes, so the user physically cannot fire the conflicting
      // call mid-flight. Detaching it removed that backpressure and opened an
      // ordering race where a fire-and-forget activate could land its
      // storeLicense AFTER a clear's deactivate, leaving Pro active with no key
      // (an entitlement leak), since LicenseManager has no cross-call mutex.
      // The crash/hang this whole change set fixes is closed by the
      // reconfigureSttProvider serialization alone; this activation already ran
      // strictly AFTER reconfigure completed (never concurrent with it), so
      // there is nothing to gain by detaching it and a billing bug to lose.
      if (apiKey) {
        try {
          const { LicenseManager } = require('../premium/electron/services/LicenseManager');
          const result = await LicenseManager.getInstance().activateWithApiKey(apiKey);
          if (result.success) {
            console.log('[IPC] set-natively-api-key: Pro auto-activated via API plan.');
            // Notify all windows so the license UI refreshes immediately
            BrowserWindow.getAllWindows().forEach((win) => {
              if (!win.isDestroyed())
                win.webContents.send('license-status-changed', { isPremium: true });
            });
          } else if (result.skipped) {
            console.log(
              '[IPC] set-natively-api-key: existing Gumroad/Dodo license preserved — Pro not overwritten.',
            );
          } else {
            console.log('[IPC] set-natively-api-key: Pro not activated —', result.error);
          }
        } catch (e: any) {
          // LicenseManager not available in this build — non-fatal
          console.warn(
            '[IPC] set-natively-api-key: LicenseManager unavailable for Pro auto-activation:',
            e?.message,
          );
        }
      } else {
        // API key was cleared — deactivate any natively_api Pro license so premium is revoked.
        try {
          const { LicenseManager } = require('../premium/electron/services/LicenseManager');
          const lm = LicenseManager.getInstance();
          // Only deactivate if the stored license is from a natively_api subscription.
          // Never touch Gumroad/Dodo lifetime licenses here.
          const details = lm.getLicenseDetails();
          if (details.isPremium && details.provider === 'natively_api') {
            await lm.deactivate();
            console.log(
              '[IPC] set-natively-api-key: key cleared — natively_api Pro license deactivated.',
            );
            clearActiveModeOnLicenseLoss();
            BrowserWindow.getAllWindows().forEach((win) => {
              if (!win.isDestroyed())
                win.webContents.send('license-status-changed', { isPremium: false });
            });
          }
        } catch (e: any) {
          console.warn(
            '[IPC] set-natively-api-key: LicenseManager unavailable for Pro deactivation on key clear:',
            e?.message,
          );
        }
      }

      return { success: true };
    } catch (error: any) {
      console.error('Error saving Natively API key:', error);
      return { success: false, error: error.message };
    } finally {
      // Always bust the cache when the key changes so the next usage fetch is fresh
      _usageCache?.clear();
    }
  });

  safeHandle('get-natively-pricing', async () => {
    try {
      const cached = _pricingCache.get('pricing');
      if (cached && Date.now() - cached.ts < PRICING_CACHE_TTL_MS) {
        return cached.data;
      }

      const res = await fetch('https://api.natively.software/v1/pricing', {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as any;
        return { ok: false, error: body.error || 'request_failed', status: res.status };
      }
      const data = (await res.json()) as any;
      const result = { ok: true, ...data };
      _pricingCache.set('pricing', { data: result, ts: Date.now() });
      return result;
    } catch (error: any) {
      return { ok: false, error: error.message || 'network_error' };
    }
  });

  safeHandle('get-natively-usage', async () => {
    // Hoisted out of try so the catch block's stale-cache lookup can reach it.
    let key: string | undefined;
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      key = CredentialsManager.getInstance().getNativelyApiKey();
      if (!key) return { ok: false, error: 'no_key' };

      // Return cached value if it's still fresh
      const cached = _usageCache.get(key);
      if (cached && Date.now() - cached.ts < USAGE_CACHE_TTL_MS) {
        return cached.data;
      }

      const res = await fetch('https://api.natively.software/v1/usage', {
        headers: { 'x-natively-key': key },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as any;
        return { ok: false, error: body.error || 'request_failed', status: res.status };
      }
      const data = (await res.json()) as any;
      const result = { ok: true, ...data };

      // Cache the successful response
      _usageCache.set(key, { data: result, ts: Date.now() });
      return result;
    } catch (error: any) {
      // On transient DNS/network failure, serve stale cache rather than showing an error.
      // Railway uses 1s TTL on DNS records, so a momentary resolver hiccup causes ENOTFOUND
      // even when the server is up. Stale quota data is far better than a broken UI.
      const stale = key ? _usageCache.get(key) : undefined;
      if (stale) return { ...stale.data, stale: true };
      return { ok: false, error: error.message || 'network_error' };
    }
  });

  // Allow other handlers to force-invalidate the usage cache (e.g. after key change)
  safeHandle('invalidate-natively-usage-cache', () => {
    _usageCache.clear();
    return { ok: true };
  });

  // ── Free Trial IPC ───────────────────────────────────────────────────────────

  // Start or resume a free trial. Fetches HWID, calls server, persists token locally.
  safeHandle('trial:start', async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();

      // Get hardware ID for HWID-binding
      let hwid = 'unavailable';
      try {
        const { LicenseManager } = require('../premium/electron/services/LicenseManager');
        hwid = LicenseManager.getInstance().getHardwareId() || 'unavailable';
      } catch {
        /* LicenseManager not available — fall back */
      }

      const res = await fetch('https://api.natively.software/v1/trial/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hwid }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as any;
        return { ok: false, error: body.error || 'request_failed', status: res.status };
      }

      const data = (await res.json()) as any;

      if (data.ok && data.trial_token && !data.expired) {
        cm.setTrialToken(data.trial_token, data.expires_at, data.started_at);

        // Auto-configure natively as the model + STT provider during trial
        const prevSttProvider = cm.getSttProvider();
        cm.setNativelyApiKey(TRIAL_SENTINEL_KEY); // sentinel — activates natively model routing
        const newSttProvider = cm.getSttProvider();
        if (newSttProvider !== prevSttProvider) {
          await appState.reconfigureSttProvider();
        }
        const llmHelper = appState.processingHelper?.getLLMHelper?.();
        if (llmHelper) llmHelper.setNativelyKey(TRIAL_SENTINEL_KEY);
      }

      const { trial_token, ...safeData } = data;
      return { ok: true, ...safeData, hasToken: Boolean(data.trial_token) };
    } catch (error: any) {
      console.error('[IPC] trial:start failed:', error);
      return { ok: false, error: error.message || 'network_error' };
    }
  });

  // Poll the server for live trial status (remaining time + usage counters).
  safeHandle('trial:status', async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const token = CredentialsManager.getInstance().getTrialToken();
      if (!token) return { ok: false, error: 'no_trial_token' };

      const res = await fetch('https://api.natively.software/v1/trial/status', {
        headers: { 'x-trial-token': token },
        signal: AbortSignal.timeout(8_000),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as any;
        return { ok: false, error: body.error || 'request_failed', status: res.status };
      }

      return await res.json();
    } catch (error: any) {
      return { ok: false, error: error.message || 'network_error' };
    }
  });

  // Return local trial state from credentials (no network call — safe for startup check).
  safeHandle('trial:get-local', async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      const token = cm.getTrialToken();
      if (!token) return { hasToken: false, trialClaimed: cm.getTrialClaimed() };
      return {
        hasToken: true,
        trialClaimed: true,
        expiresAt: cm.getTrialExpiresAt(),
        startedAt: cm.getTrialStartedAt(),
        expired: cm.getTrialExpiresAt()
          ? new Date(cm.getTrialExpiresAt()!).getTime() < Date.now()
          : false,
      };
    } catch {
      return { hasToken: false, trialClaimed: false };
    }
  });

  // Record the user's post-trial choice in analytics and clean up local state.
  safeHandle('trial:convert', async (_, choice: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const token = CredentialsManager.getInstance().getTrialToken();
      if (!token) return { ok: true }; // no token to report

      await fetch('https://api.natively.software/v1/trial/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-trial-token': token },
        body: JSON.stringify({ choice }),
        signal: AbortSignal.timeout(5_000),
      }).catch(() => {}); // fire-and-forget — don't block local cleanup on network failure

      return { ok: true };
    } catch {
      return { ok: true };
    }
  });

  // End trial via BYOK path: wipe Pro-ingested data, clear trial token + natively key.
  safeHandle('trial:end-byok', async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();

      // 1. Fire-and-forget analytics (non-blocking)
      const token = cm.getTrialToken();
      if (token) {
        fetch('https://api.natively.software/v1/trial/convert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-trial-token': token },
          body: JSON.stringify({ choice: 'byok' }),
          signal: AbortSignal.timeout(4_000),
        }).catch(() => {});
      }

      // 2. Clear trial token
      cm.clearTrialToken();

      // 3. Clear the trial sentinel key + revert model / STT to open defaults
      cm.setNativelyApiKey('');
      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      if (llmHelper) llmHelper.setNativelyKey(null);
      await appState.reconfigureSttProvider();

      // 4. Deactivate Pro license (removes license.enc)
      try {
        const { LicenseManager } = require('../premium/electron/services/LicenseManager');
        await LicenseManager.getInstance().deactivate();
      } catch {
        /* LicenseManager not available in this build */
      }

      // 5. Disable knowledge mode + wipe orchestrator in-memory caches for resume/JD
      try {
        const orchestrator = appState.getKnowledgeOrchestrator();
        if (orchestrator) {
          orchestrator.setKnowledgeMode(false);
          const { DocType } = require('../premium/electron/knowledge/types');
          orchestrator.deleteDocumentsByType(DocType.RESUME);
          orchestrator.deleteDocumentsByType(DocType.JD);
        }
      } catch {
        /* ignore */
      }

      // 6. Wipe Pro-specific cached data from local SQLite
      //    Targets: company dossiers, knowledge docs (+ cascades), resume nodes, user profile
      //    NOT wiped: meetings, transcripts, chunks (user's own recordings)
      try {
        const sqliteDb = DatabaseManager.getInstance().getDb();
        if (sqliteDb) {
          sqliteDb.exec(`
            DELETE FROM company_dossiers;
            DELETE FROM knowledge_documents;
            DELETE FROM resume_nodes;
            DELETE FROM user_profile;
          `);
          console.log('[IPC] trial:end-byok: Pro data wiped from SQLite');
        }
      } catch (dbErr: any) {
        console.warn('[IPC] trial:end-byok: SQLite wipe partial error:', dbErr.message);
      }

      // 7. Notify all windows to refresh license + model state
      clearActiveModeOnLicenseLoss();
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send('license-status-changed', { isPremium: false });
          win.webContents.send('trial-ended', { choice: 'byok' });
        }
      });

      return { success: true };
    } catch (error: any) {
      console.error('[IPC] trial:end-byok error:', error);
      return { success: false, error: error.message };
    }
  });

  // Wipe only Pro profile data (resume + JD + company dossiers) without clearing
  // trial token or natively key. Called automatically when trial expires so that
  // profile intelligence data can't linger in SQLite after the trial window closes.
  safeHandle('trial:wipe-profile-data', async () => {
    try {
      // 1. Disable knowledge mode + wipe orchestrator in-memory caches
      try {
        const orchestrator = appState.getKnowledgeOrchestrator();
        if (orchestrator) {
          orchestrator.setKnowledgeMode(false);
          const { DocType } = require('../premium/electron/knowledge/types');
          orchestrator.deleteDocumentsByType(DocType.RESUME);
          orchestrator.deleteDocumentsByType(DocType.JD);
        }
      } catch {
        /* ignore — orchestrator may not be initialised */
      }

      // 2. Wipe Pro-specific SQLite tables
      //    NOT wiped: meetings, transcripts, audio chunks (user's own recordings)
      try {
        const sqliteDb = DatabaseManager.getInstance().getDb();
        if (sqliteDb) {
          sqliteDb.exec(`
            DELETE FROM company_dossiers;
            DELETE FROM knowledge_documents;
            DELETE FROM resume_nodes;
            DELETE FROM user_profile;
          `);
        }
      } catch (dbErr: any) {
        console.warn('[IPC] trial:wipe-profile-data: SQLite wipe partial error:', dbErr.message);
      }

      return { success: true };
    } catch (error: any) {
      console.error('[IPC] trial:wipe-profile-data error:', error);
      return { success: false, error: error.message };
    }
  });

  // Custom Provider Handlers
  safeHandle('get-custom-providers', async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      // Merge new Curl Providers with legacy Custom Providers
      // New ones take precedence if IDs conflict (though unlikely as UUIDs)
      const curlProviders = cm.getCurlProviders();
      const legacyProviders = cm.getCustomProviders() || [];
      return [...curlProviders, ...legacyProviders];
    } catch (error: any) {
      console.error('Error getting custom providers:', error);
      return [];
    }
  });

  const validateCurlProviderPayload = (provider: unknown): { ok: true } | { ok: false; error: string } => {
    if (
      typeof provider !== 'object' ||
      provider === null ||
      typeof (provider as any).id !== 'string' ||
      typeof (provider as any).name !== 'string' ||
      typeof (provider as any).curlCommand !== 'string'
    ) {
      return { ok: false, error: 'Invalid provider payload' };
    }

    if (!(provider as any).curlCommand.includes('{{TEXT}}')) {
      return { ok: false, error: 'curlCommand must contain {{TEXT}} placeholder for the prompt' };
    }

    if (
      'responsePath' in provider &&
      typeof (provider as any).responsePath !== 'string'
    ) {
      return { ok: false, error: 'Invalid provider responsePath' };
    }

    return { ok: true };
  };

  safeHandle('save-custom-provider', async (_, provider: unknown) => {
    try {
      const validation = validateCurlProviderPayload(provider);
      if (!validation.ok) {
        console.error('[IPC] save-custom-provider: invalid payload');
        return { success: false, error: (validation as any).error };
      }

      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().saveCurlProvider(provider as any);
      return { success: true };
    } catch (error: any) {
      console.error('Error saving custom provider:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('delete-custom-provider', async (_, id: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      // Try deleting from both storages to be safe
      CredentialsManager.getInstance().deleteCurlProvider(id);
      CredentialsManager.getInstance().deleteCustomProvider(id);
      return { success: true };
    } catch (error: any) {
      console.error('Error deleting custom provider:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('switch-to-custom-provider', async (_, providerId: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      // BUG-05 fix: providers may be in either the curl or legacy custom store —
      // merge both when looking up by id so neither store is silently ignored.
      const provider = [...(cm.getCurlProviders() || []), ...(cm.getCustomProviders() || [])].find(
        (p: any) => p.id === providerId,
      );

      if (!provider) {
        throw new Error('Provider not found');
      }

      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToCustom(provider);

      // Re-init IntelligenceManager (optional, but good for consistency)
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error('Error switching to custom provider:', error);
      return { success: false, error: error.message };
    }
  });

  // cURL Provider Handlers
  safeHandle('get-curl-providers', async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      return CredentialsManager.getInstance().getCurlProviders();
    } catch (error: any) {
      console.error('Error getting curl providers:', error);
      return [];
    }
  });

  safeHandle('save-curl-provider', async (_, provider: unknown) => {
    try {
      const validation = validateCurlProviderPayload(provider);
      if (!validation.ok) {
        console.error('[IPC] save-curl-provider: invalid payload');
        return { success: false, error: (validation as any).error };
      }

      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().saveCurlProvider(provider as any);
      return { success: true };
    } catch (error: any) {
      console.error('Error saving curl provider:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('delete-curl-provider', async (_, id: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().deleteCurlProvider(id);
      return { success: true };
    } catch (error: any) {
      console.error('Error deleting curl provider:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('switch-to-curl-provider', async (_, providerId: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const provider = CredentialsManager.getInstance()
        .getCurlProviders()
        .find((p: any) => p.id === providerId);

      if (!provider) {
        throw new Error('Provider not found');
      }

      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToCurl(provider);

      // Re-init IntelligenceManager (optional, but good for consistency)
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error('Error switching to curl provider:', error);
      return { success: false, error: error.message };
    }
  });

  // Get stored API keys (masked for UI display)
  safeHandle('get-stored-credentials', async () => {
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
        hasDeepseekKey: hasKey(creds.deepseekApiKey),
        hasNativelyKey: hasKey(creds.nativelyApiKey),
        googleServiceAccountPath: creds.googleServiceAccountPath || null,
        sttProvider: creds.sttProvider || 'none',
        groqSttModel: creds.groqSttModel || 'whisper-large-v3-turbo',
        hasSttGroqKey: hasKey(creds.groqSttApiKey),
        hasSttOpenaiKey: hasKey(creds.openAiSttApiKey),
        hasDeepgramKey: hasKey(creds.deepgramApiKey),
        hasElevenLabsKey: hasKey(creds.elevenLabsApiKey),
        hasAzureKey: hasKey(creds.azureApiKey),
        azureRegion: creds.azureRegion || 'eastus',
        hasIbmWatsonKey: hasKey(creds.ibmWatsonApiKey),
        ibmWatsonRegion: creds.ibmWatsonRegion || 'us-south',
        hasSonioxKey: hasKey(creds.sonioxApiKey),
        // STT key values — returned so the settings UI can pre-populate input fields.
        // SECURITY FIX (P0): Return masked keys only, never raw API keys.
        // The hasSttGroqKey boolean tells UI if key exists — no raw key needed.
        sttGroqKey: creds.groqSttApiKey ? `sk-...${creds.groqSttApiKey.slice(-4)}` : '',
        sttOpenaiKey: creds.openAiSttApiKey ? `sk-...${creds.openAiSttApiKey.slice(-4)}` : '',
        sttDeepgramKey: creds.deepgramApiKey ? `sk-...${creds.deepgramApiKey.slice(-4)}` : '',
        sttElevenLabsKey: creds.elevenLabsApiKey ? `sk-...${creds.elevenLabsApiKey.slice(-4)}` : '',
        sttAzureKey: creds.azureApiKey ? `sk-...${creds.azureApiKey.slice(-4)}` : '',
        sttIbmKey: creds.ibmWatsonApiKey ? `sk-...${creds.ibmWatsonApiKey.slice(-4)}` : '',
        sttSonioxKey: creds.sonioxApiKey ? `sk-...${creds.sonioxApiKey.slice(-4)}` : '',
        openAiSttBaseUrl: creds.openAiSttBaseUrl || '',
        hasTavilyKey: hasKey(creds.tavilyApiKey),
        // Dynamic Model Discovery - preferred models
        geminiPreferredModel: creds.geminiPreferredModel || undefined,
        groqPreferredModel: creds.groqPreferredModel || undefined,
        openaiPreferredModel: creds.openaiPreferredModel || undefined,
        claudePreferredModel: creds.claudePreferredModel || undefined,
        deepseekPreferredModel: creds.deepseekPreferredModel || undefined,
      };
    } catch (error: any) {
      // SECURITY FIX (P0): Error fallback returns masked keys, not raw strings
      return {
        hasGeminiKey: false,
        hasGroqKey: false,
        hasOpenaiKey: false,
        hasClaudeKey: false,
        hasDeepseekKey: false,
        hasNativelyKey: false,
        googleServiceAccountPath: null,
        sttProvider: 'none',
        groqSttModel: 'whisper-large-v3-turbo',
        hasSttGroqKey: false,
        hasSttOpenaiKey: false,
        hasDeepgramKey: false,
        hasElevenLabsKey: false,
        hasAzureKey: false,
        azureRegion: 'eastus',
        hasIbmWatsonKey: false,
        ibmWatsonRegion: 'us-south',
        hasSonioxKey: false,
        hasTavilyKey: false,
        sttGroqKey: '',
        sttOpenaiKey: '',
        sttDeepgramKey: '',
        sttElevenLabsKey: '',
        sttAzureKey: '',
        sttIbmKey: '',
        sttSonioxKey: '',
      };
    }
  });

  // ==========================================
  // Dynamic Model Discovery Handlers
  // ==========================================

  safeHandle(
    'fetch-provider-models',
    async (_, provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', apiKey: string) => {
      try {
        // Fall back to stored key if no key was explicitly provided
        let key = apiKey?.trim();
        if (!key) {
          const { CredentialsManager } = require('./services/CredentialsManager');
          const cm = CredentialsManager.getInstance();
          if (provider === 'gemini') key = cm.getGeminiApiKey();
          else if (provider === 'groq') key = cm.getGroqApiKey();
          else if (provider === 'openai') key = cm.getOpenaiApiKey();
          else if (provider === 'claude') key = cm.getClaudeApiKey();
          else if (provider === 'deepseek') key = cm.getDeepseekApiKey();
        }

        if (!key) {
          return { success: false, error: 'No API key available. Please save a key first.' };
        }

        const { fetchProviderModels } = require('./utils/modelFetcher');
        const models = await fetchProviderModels(provider, key);
        return { success: true, models };
      } catch (error: any) {
        console.error(`[IPC] Failed to fetch ${provider} models:`, error);
        const msg =
          error?.response?.data?.error?.message || error.message || 'Failed to fetch models';
        return { success: false, error: msg };
      }
    },
  );

  safeHandle(
    'set-provider-preferred-model',
    async (_, provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', modelId: string) => {
      try {
        const { CredentialsManager } = require('./services/CredentialsManager');
        CredentialsManager.getInstance().setPreferredModel(provider, modelId);
      } catch (error: any) {
        console.error(`[IPC] Failed to set preferred model for ${provider}:`, error);
      }
    },
  );

  // ==========================================
  // STT Provider Management Handlers
  // ==========================================

  safeHandle(
    'set-stt-provider',
    async (
      _,
      provider:
        | 'none'
        | 'google'
        | 'groq'
        | 'openai'
        | 'deepgram'
        | 'elevenlabs'
        | 'azure'
        | 'ibmwatson'
        | 'soniox'
        | 'natively',
    ) => {
      try {
        const { CredentialsManager } = require('./services/CredentialsManager');
        CredentialsManager.getInstance().setSttProvider(provider);

        // Reconfigure the audio pipeline to use the new STT provider
        await appState.reconfigureSttProvider();

        // Notify all windows so the settings UI reflects the change immediately
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) win.webContents.send('credentials-changed');
        });

        return { success: true };
      } catch (error: any) {
        console.error('Error setting STT provider:', error);
        return { success: false, error: error.message };
      }
    },
  );

  safeHandle('get-stt-provider', async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      return CredentialsManager.getInstance().getSttProvider();
    } catch (error: any) {
      return 'none';
    }
  });

  safeHandle('set-groq-stt-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setGroqSttApiKey(apiKey);
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('credentials-changed');
      });
      return { success: true };
    } catch (error: any) {
      console.error('Error saving Groq STT API key:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-openai-stt-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setOpenAiSttApiKey(apiKey);
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('credentials-changed');
      });
      return { success: true };
    } catch (error: any) {
      console.error('Error saving OpenAI STT API key:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-openai-stt-base-url', async (_, url: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setOpenAiSttBaseUrl(url);
      // Reconfigure the active pipeline so the new endpoint is used immediately,
      // matching the behavior of azure/ibmwatson region setters.
      await appState.reconfigureSttProvider();
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('credentials-changed');
      });
      return { success: true };
    } catch (error: any) {
      console.error('Error saving OpenAI STT base URL:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-deepgram-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setDeepgramApiKey(apiKey);
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('credentials-changed');
      });
      return { success: true };
    } catch (error: any) {
      console.error('Error saving Deepgram API key:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-groq-stt-model', async (_, model: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setGroqSttModel(model);

      // Reconfigure the audio pipeline to use the new model
      await appState.reconfigureSttProvider();

      return { success: true };
    } catch (error: any) {
      console.error('Error setting Groq STT model:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-elevenlabs-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setElevenLabsApiKey(apiKey);
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('credentials-changed');
      });
      return { success: true };
    } catch (error: any) {
      console.error('Error saving ElevenLabs API key:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-azure-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setAzureApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error('Error saving Azure API key:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-azure-region', async (_, region: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setAzureRegion(region);

      // Reconfigure the pipeline since region changes the endpoint URL
      await appState.reconfigureSttProvider();

      return { success: true };
    } catch (error: any) {
      console.error('Error setting Azure region:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-ibmwatson-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setIbmWatsonApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error('Error saving IBM Watson API key:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-soniox-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setSonioxApiKey(apiKey);
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('credentials-changed');
      });
      return { success: true };
    } catch (error: any) {
      console.error('Error saving Soniox API key:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-ibmwatson-region', async (_, region: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setIbmWatsonRegion(region);

      // Reconfigure the pipeline since region changes the endpoint URL
      await appState.reconfigureSttProvider();

      return { success: true };
    } catch (error: any) {
      console.error('Error setting IBM Watson region:', error);
      return { success: false, error: error.message };
    }
  });

  // Helper to sanitize error messages (remove API key references)
  const sanitizeErrorMessage = (msg: string): string => {
    // Remove patterns like ": sk-***...***" or ": sdasdada***...dwwC"
    return msg.replace(/:\s*[a-zA-Z0-9*]+\*+[a-zA-Z0-9*]+\.?$/g, '').trim();
  };

  safeHandle(
    'test-stt-connection',
    async (
      _,
      provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox',
      apiKey: string,
      region?: string,
    ) => {
      console.log(`[IPC] Received test - stt - connection request for provider: ${provider} `);
      try {
        if (provider === 'deepgram') {
          const WebSocket = require('ws');
          const token = apiKey.trim();
          return await new Promise<{ success: boolean; error?: string }>((resolve) => {
            const url =
              'wss://api.deepgram.com/v1/listen?model=nova-2&encoding=linear16&sample_rate=16000&channels=1';
            const ws = new WebSocket(url, {
              headers: { Authorization: `Token ${token}` },
            });

            const timeout = setTimeout(() => {
              ws.close();
              console.error('[IPC] Deepgram test failed: Connection timed out');
              resolve({ success: false, error: 'Connection timed out' });
            }, 15000);

            ws.on('open', () => {
              clearTimeout(timeout);
              try {
                ws.send(JSON.stringify({ type: 'CloseStream' }));
              } catch {}
              ws.close();
              resolve({ success: true });
            });

            ws.on('unexpected-response', (request: any, response: any) => {
              clearTimeout(timeout);
              const status = response.statusCode;
              let body = '';
              response.on('data', (chunk: Buffer) => {
                body += chunk.toString();
              });
              response.on('end', () => {
                const errMsg = `Unexpected server response: ${status} - ${body}`;
                console.error(`[IPC] Deepgram test failed: ${errMsg}`);
                resolve({ success: false, error: errMsg });
              });
            });

            ws.on('error', (err: any) => {
              clearTimeout(timeout);
              console.error(`[IPC] Deepgram test error: ${err.message}`);
              resolve({ success: false, error: err.message || 'Connection failed' });
            });
          });
        }

        if (provider === 'soniox') {
          // Test Soniox via WebSocket connection.
          // With a valid key, Soniox accepts the config and then silently waits for audio —
          // it never sends a response message. With an invalid key it immediately sends an
          // error message and closes. So the strategy is:
          //   • If we receive an error message → fail
          //   • If the connection errors at the WS level → fail
          //   • If 2.5 s pass after sending the config with no error → success
          const WebSocket = require('ws');
          return await new Promise<{ success: boolean; error?: string }>((resolve) => {
            let resolved = false;
            const done = (result: { success: boolean; error?: string }) => {
              if (resolved) return;
              resolved = true;
              try {
                ws.close();
              } catch {}
              resolve(result);
            };

            const ws = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');

            // Hard connect timeout — server unreachable
            const connectTimeout = setTimeout(() => {
              done({ success: false, error: 'Connection timed out' });
            }, 10000);

            ws.on('open', () => {
              clearTimeout(connectTimeout);
              ws.send(
                JSON.stringify({
                  api_key: apiKey,
                  model: 'stt-rt-v4',
                  audio_format: 'pcm_s16le',
                  sample_rate: 16000,
                  num_channels: 1,
                }),
              );
              // Give Soniox 2.5 s to reject the key; silence means the key is valid
              setTimeout(() => done({ success: true }), 2500);
            });

            ws.on('message', (msg: any) => {
              try {
                const res = JSON.parse(msg.toString());
                if (res.error_code) {
                  done({ success: false, error: `${res.error_code}: ${res.error_message}` });
                }
                // Non-error message is unexpected but treat as success
              } catch {
                // Unparseable message — treat as success
              }
            });

            ws.on('error', (err: any) => {
              clearTimeout(connectTimeout);
              done({ success: false, error: err.message || 'Connection failed' });
            });

            ws.on('close', (code: number) => {
              // Abnormal close before we resolved means the server rejected us
              if (!resolved && code !== 1000) {
                done({ success: false, error: `Server closed connection (code ${code})` });
              }
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
          // ElevenLabs: Use /v1/voices to validate the API key (minimal scope required).
          // Scoped keys may lack speech_to_text or user_read but still be usable once permissions are added.
          try {
            await axios.get('https://api.elevenlabs.io/v1/voices', {
              headers: { 'xi-api-key': apiKey },
              timeout: 10000,
            });
          } catch (elErr: any) {
            const elStatus = elErr?.response?.data?.detail?.status;
            // If the error is "invalid_api_key", the key itself is wrong — fail.
            // Any other error (missing permission, etc.) means the key IS valid, just possibly scoped.
            if (elStatus === 'invalid_api_key') {
              throw elErr;
            }
            // Key is valid but scoped — pass with a warning
            console.log(
              '[IPC] ElevenLabs key is valid but may have restricted scopes. Saving key.',
            );
          }
        } else if (provider === 'azure') {
          // Azure: raw binary with subscription key
          const azureRegion = region || 'eastus';
          await axios.post(
            `https://${azureRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US`,
            testWav,
            {
              headers: { 'Ocp-Apim-Subscription-Key': apiKey, 'Content-Type': 'audio/wav' },
              timeout: 15000,
            },
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
            },
          );
        } else {
          // Groq / OpenAI: multipart FormData
          let openAiEndpoint = 'https://api.openai.com/v1/audio/transcriptions';
          if (provider === 'openai') {
            // If a custom OpenAI-compatible base URL is configured, test against it.
            const { CredentialsManager } = require('./services/CredentialsManager');
            const customBase = (
              CredentialsManager.getInstance().getOpenAiSttBaseUrl() || ''
            ).trim();
            if (customBase) {
              const trimmed = customBase.replace(/\/+$/, '');
              openAiEndpoint = /\/v\d+$/.test(trimmed)
                ? `${trimmed}/audio/transcriptions`
                : `${trimmed}/v1/audio/transcriptions`;
            }
          }
          const endpoint =
            provider === 'groq'
              ? 'https://api.groq.com/openai/v1/audio/transcriptions'
              : openAiEndpoint;
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
        const respData = error?.response?.data;
        const rawMsg =
          respData?.error?.message ||
          respData?.detail?.message ||
          respData?.message ||
          error.message ||
          'Connection failed';
        const msg = sanitizeErrorMessage(rawMsg);
        console.error('STT connection test failed:', msg);
        return { success: false, error: msg };
      }
    },
  );

  // ==========================================
  // Local Whisper STT Handlers
  // ==========================================

  const activeWhisperDownloads = new Set<string>();

  safeHandle('local-whisper-get-models', async () => {
    try {
      const { getAvailableModels } = require('./audio/whisper/modelManager');
      const models = getAvailableModels();
      const activeModelId = SettingsManager.getInstance().get('localWhisperModel') ?? '';
      return { models, activeModelId };
    } catch (e: any) {
      console.error('[IPC] local-whisper-get-models error:', e.message);
      return { models: [], activeModelId: '' };
    }
  });

  safeHandle('local-whisper-set-model', async (_, modelId: string) => {
    try {
      SettingsManager.getInstance().set('localWhisperModel', modelId);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // Per-channel model overrides (mic / system audio). When enabled, the two
  // STT instances pick their own model via these slots. When disabled, both
  // fall back to localWhisperModel (the existing global setting).
  safeHandle('local-whisper-get-channel-config', async () => {
    const sm = SettingsManager.getInstance();
    return {
      enabled: !!sm.get('localWhisperPerChannelEnabled'),
      micModelId: sm.get('localWhisperModelMic') ?? '',
      systemModelId: sm.get('localWhisperModelSystem') ?? '',
      globalModelId: sm.get('localWhisperModel') ?? '',
    };
  });

  safeHandle(
    'local-whisper-set-channel-config',
    async (_, cfg: { enabled?: boolean; micModelId?: string; systemModelId?: string }) => {
      try {
        const sm = SettingsManager.getInstance();
        if (typeof cfg?.enabled === 'boolean') sm.set('localWhisperPerChannelEnabled', cfg.enabled);
        if (typeof cfg?.micModelId === 'string') sm.set('localWhisperModelMic', cfg.micModelId);
        if (typeof cfg?.systemModelId === 'string')
          sm.set('localWhisperModelSystem', cfg.systemModelId);
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    },
  );

  safeHandle('local-whisper-delete-model', async (_, modelId: string) => {
    try {
      const { deleteModel } = require('./audio/whisper/modelManager');
      deleteModel(modelId);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  safeHandle('local-whisper-start-download', async (event, modelId: string) => {
    if (activeWhisperDownloads.has(modelId)) {
      return { success: false, error: 'already-downloading' };
    }
    activeWhisperDownloads.add(modelId);
    try {
      const { Worker } = require('worker_threads');
      const nodePath = require('path');
      const { buildWorkerInitMessage } = require('./audio/whisper/inferenceConfig');
      const workerPath = nodePath.join(__dirname, 'audio', 'whisper', 'whisperWorker.js');
      const w = new Worker(workerPath);
      const sender = event.sender;
      w.on('message', (msg: any) => {
        if (sender.isDestroyed()) return;
        if (msg.type === 'progress') {
          sender.send('local-whisper-download-progress', { modelId, progress: msg.progress });
        } else if (msg.type === 'ready') {
          activeWhisperDownloads.delete(modelId);
          sender.send('local-whisper-download-complete', { modelId });
          w.terminate();
        } else if (msg.type === 'error') {
          activeWhisperDownloads.delete(modelId);
          sender.send('local-whisper-download-error', { modelId, error: msg.message });
          w.terminate();
        }
      });
      w.on('error', (err: Error) => {
        activeWhisperDownloads.delete(modelId);
        if (!sender.isDestroyed()) {
          sender.send('local-whisper-download-error', { modelId, error: err.message });
        }
      });
      w.postMessage(buildWorkerInitMessage(modelId));
      return { success: true };
    } catch (e: any) {
      activeWhisperDownloads.delete(modelId);
      return { success: false, error: e.message };
    }
  });

  safeHandle('local-whisper-preload', async (_, modelId: string) => {
    try {
      const { modelPreloader } = require('./audio/whisper/modelPreloader');
      const { isModelCached } = require('./audio/whisper/modelManager');
      const { resolveInferenceConfig } = require('./audio/whisper/inferenceConfig');
      const { SettingsManager } = require('./services/SettingsManager');
      const id =
        modelId ||
        SettingsManager.getInstance().get('localWhisperModel') ||
        'Xenova/whisper-tiny.en';
      // Pass active dtype so the cache check verifies the SPECIFIC ONNX
      // files (e.g. encoder_model.onnx for fp32) are present — not just
      // "directory non-empty". Otherwise a v2-cached _quantized.onnx-only
      // directory would be reported "available" but trigger a 142MB
      // background fetch on first start().
      const { dtype } = resolveInferenceConfig();
      if (!isModelCached(id, dtype)) {
        return { success: false, reason: 'model-not-cached' };
      }
      modelPreloader.preload(id);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  safeHandle('local-whisper-get-hardware', () => {
    const { detectHardware } = require('./audio/whisper/hardwareDetect');
    return detectHardware();
  });

  safeHandle(
    'test-llm-connection',
    async (_, provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', apiKey?: string) => {
      console.log(`[IPC] Received test-llm-connection request for provider: ${provider}`);
      try {
        if (!apiKey || !apiKey.trim()) {
          const { CredentialsManager } = require('./services/CredentialsManager');
          const creds = CredentialsManager.getInstance();
          if (provider === 'gemini') apiKey = creds.getGeminiApiKey();
          else if (provider === 'groq') apiKey = creds.getGroqApiKey();
          else if (provider === 'openai') apiKey = creds.getOpenaiApiKey();
          else if (provider === 'claude') apiKey = creds.getClaudeApiKey();
          else if (provider === 'deepseek') apiKey = creds.getDeepseekApiKey();
        }

        if (!apiKey || !apiKey.trim()) {
          return { success: false, error: 'No API key provided' };
        }

        const axios = require('axios');
        let response;

        if (provider === 'gemini') {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent`;
          response = await axios.post(
            url,
            {
              contents: [{ parts: [{ text: 'Hello' }] }],
            },
            {
              headers: { 'x-goog-api-key': apiKey },
              timeout: 15000,
            },
          );
        } else if (provider === 'groq') {
          response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
              model: 'llama-3.3-70b-versatile',
              messages: [{ role: 'user', content: 'Hello' }],
            },
            {
              headers: { Authorization: `Bearer ${apiKey}` },
              timeout: 15000,
            },
          );
        } else if (provider === 'openai') {
          response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
              model: 'gpt-4o-mini',
              messages: [{ role: 'user', content: 'Hello' }],
            },
            {
              headers: { Authorization: `Bearer ${apiKey}` },
              timeout: 15000,
            },
          );
        } else if (provider === 'claude') {
          response = await axios.post(
            'https://api.anthropic.com/v1/messages',
            {
              model: 'claude-sonnet-4-6',
              max_tokens: 10,
              messages: [{ role: 'user', content: 'Hello' }],
            },
            {
              headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
              },
              timeout: 15000,
            },
          );
        } else if (provider === 'deepseek') {
          response = await axios.post(
            'https://api.deepseek.com/chat/completions',
            {
              model: 'deepseek-v4-flash',
              max_tokens: 10,
              messages: [{ role: 'user', content: 'Hello' }],
            },
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'content-type': 'application/json',
              },
              timeout: 15000,
            },
          );
        }

        if (response && (response.status === 200 || response.status === 201)) {
          return { success: true };
        } else {
          return { success: false, error: 'Request failed with status ' + response?.status };
        }
      } catch (error: any) {
        // CRITICAL: do NOT log the raw axios error — it includes the request config
        // with the Authorization header (full API key) and is dumped verbatim by
        // Node's util.inspect. Strip to a safe shape before logging.
        const safeInfo = {
          provider,
          status: error?.response?.status,
          statusText: error?.response?.statusText,
          code: error?.code,
          message: error?.message,
          responseError: error?.response?.data?.error?.message || error?.response?.data?.message,
        };
        console.error('LLM connection test failed:', safeInfo);
        const rawMsg =
          error?.response?.data?.error?.message ||
          error?.response?.data?.message ||
          (error.response?.data?.error?.type
            ? `${error.response.data.error.type}: ${error.response.data.error.message}`
            : error.message) ||
          'Connection failed';
        const msg = sanitizeErrorMessage(rawMsg);
        return { success: false, error: msg };
      }
    },
  );

  safeHandle('get-groq-fast-text-mode', () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      return { enabled: llmHelper.getGroqFastTextMode() };
    } catch (error: any) {
      return { enabled: false };
    }
  });

  // Set Groq Fast Text Mode
  safeHandle('set-groq-fast-text-mode', (_, enabled: boolean) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setGroqFastTextMode(enabled);

      const { SettingsManager } = require('./services/SettingsManager');
      SettingsManager.getInstance().set('groqFastTextMode', enabled);

      // Broadcast to all windows
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('groq-fast-text-changed', enabled);
      });

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle('get-codex-cli-config', () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      return llmHelper.getCodexCliConfig();
    } catch {
      return CodexCliService.normalizeConfig({});
    }
  });

  safeHandle('set-codex-cli-config', (_, config: any) => {
    try {
      const normalized = CodexCliService.normalizeConfig(config || {});
      const sm = SettingsManager.getInstance();
      sm.set('codexCliEnabled', normalized.enabled);
      sm.set('codexCliPath', normalized.path);
      sm.set('codexCliModel', normalized.model);
      sm.set('codexCliFastModel', normalized.fastModel);
      sm.set('codexCliTimeoutMs', normalized.timeoutMs);
      sm.set('codexCliSandboxMode', normalized.sandboxMode);
      sm.set('codexCliServiceTier', normalized.serviceTier);
      sm.set('codexCliModelReasoningEffort', normalized.modelReasoningEffort);
      appState.processingHelper.getLLMHelper().setCodexCliConfig(normalized);
      return { success: true, config: normalized };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle('test-codex-cli', async (_, config?: any) => {
    try {
      const current = appState.processingHelper.getLLMHelper().getCodexCliConfig();
      const normalized = CodexCliService.normalizeConfig({ ...current, ...(config || {}) });
      const result = await CodexCliService.validateExecutable(normalized.path);
      // If auto-detection found a different working path, persist it so
      // subsequent chat calls don't re-ENOENT.
      if (result.success && result.resolvedPath && result.resolvedPath !== normalized.path) {
        const updated = CodexCliService.normalizeConfig({
          ...normalized,
          path: result.resolvedPath,
        });
        const sm = SettingsManager.getInstance();
        sm.set('codexCliPath', updated.path);
        appState.processingHelper.getLLMHelper().setCodexCliConfig(updated);
        return { success: true, resolvedPath: result.resolvedPath, config: updated };
      }
      return result;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle('set-model', async (_, modelId: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();

      // Get all providers (Curl + Custom)
      const curlProviders = cm.getCurlProviders();
      const legacyProviders = cm.getCustomProviders() || [];
      const allProviders = [...curlProviders, ...legacyProviders];

      llmHelper.setModel(modelId, allProviders);

      appState.broadcast('model-changed', modelId);

      // Close the selector window if open
      appState.modelSelectorWindowHelper.hideWindow();

      return { success: true };
    } catch (error: any) {
      console.error('Error setting model:', error);
      return { success: false, error: error.message };
    }
  });

  // Persist default model (from Settings), update runtime, and notify model UI surfaces
  safeHandle('set-default-model', async (_, modelId: string) => {
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

      appState.broadcast('model-changed', modelId);

      // Close the selector window if open
      appState.modelSelectorWindowHelper.hideWindow();

      return { success: true };
    } catch (error: any) {
      console.error('Error setting default model:', error);
      return { success: false, error: error.message };
    }
  });

  // Read the persisted default model
  safeHandle('get-default-model', async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      return { model: cm.getDefaultModel() };
    } catch (error: any) {
      console.error('Error getting default model:', error);
      return { model: 'gemini-3.5-flash' };
    }
  });

  // --- Model Selector Window IPC ---

  safeHandle('show-model-selector', (_, coords: { x: number; y: number; activate?: boolean }) => {
    appState.modelSelectorWindowHelper.showWindow(coords.x, coords.y, { activate: coords.activate });
  });

  safeHandle('hide-model-selector', () => {
    appState.modelSelectorWindowHelper.hideWindow();
  });

  safeHandle('toggle-model-selector', (_, coords: { x: number; y: number; activate?: boolean }) => {
    appState.modelSelectorWindowHelper.toggleWindow(coords.x, coords.y, { activate: coords.activate });
  });

  // ROUND 3 FIX (#4): click-outside close for ModelSelector. With panel-
  // nonactivating + becomesKeyOnlyIfNeeded, the on('blur') auto-close in
  // ModelSelectorWindowHelper fires unreliably (panel may never become key
  // → never receives blur). The overlay's renderer fires this IPC on every
  // mousedown that isn't on the toggle button itself; if the model selector
  // is open, we close it. No-op when closed (toggleWindow handled the open).
  safeHandle('model-selector:close-if-open', () => {
    const win = appState.modelSelectorWindowHelper.getWindow();
    if (win && !win.isDestroyed() && win.isVisible()) {
      appState.modelSelectorWindowHelper.hideWindow();
    }
  });

  // Native Audio Service Handlers
  // Native Audio handlers removed as part of migration to driverless architecture
  safeHandle('native-audio-status', async () => {
    // Always return true or pseudo-status since it's "driverless"
    return { connected: true };
  });

  safeHandle('get-input-devices', async () => {
    return AudioDevices.getInputDevices();
  });

  safeHandle('get-output-devices', async () => {
    return AudioDevices.getOutputDevices();
  });

  safeHandle('start-audio-test', async (event, deviceId?: string) => {
    await appState.startAudioTest(deviceId);
    return { success: true };
  });

  safeHandle('stop-audio-test', async () => {
    await appState.stopAudioTest();
    return { success: true };
  });

  safeHandle('set-recognition-language', async (_, key: string) => {
    appState.setRecognitionLanguage(key);
    return { success: true };
  });

  // ==========================================
  // Meeting Lifecycle Handlers
  // ==========================================

  safeHandle('start-meeting', async (event, metadata?: any) => {
    try {
      await appState.startMeeting(metadata);
      return { success: true };
    } catch (error: any) {
      console.error('Error starting meeting:', error);
      // Forward the structured error code (e.g. 'mic-permission-denied') so the
      // renderer can surface a recoverable permissions prompt rather than a
      // silent failure. Falls back to undefined for plain errors.
      return { success: false, error: error?.message, code: error?.code };
    }
  });

  safeHandle('end-meeting', async () => {
    try {
      await appState.endMeeting();
      return { success: true };
    } catch (error: any) {
      console.error('Error ending meeting:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('get-recent-meetings', async () => {
    // Fetch from SQLite (limit 50)
    return DatabaseManager.getInstance().getRecentMeetings(50);
  });

  safeHandle('get-meeting-details', async (event, id) => {
    // Helper to fetch full details
    return DatabaseManager.getInstance().getMeetingDetails(id);
  });

  safeHandle('update-meeting-title', async (_, { id, title }: { id: string; title: string }) => {
    return DatabaseManager.getInstance().updateMeetingTitle(id, title);
  });

  safeHandle('update-meeting-summary', async (_, { id, updates }: { id: string; updates: any }) => {
    return DatabaseManager.getInstance().updateMeetingSummary(id, updates);
  });

  safeHandle('seed-demo', async () => {
    DatabaseManager.getInstance().seedDemoMeeting();

    // Ensure RAG embeddings exist for the demo meeting.
    // Use ensureDemoMeetingProcessed so we skip if already embedded
    // (avoids re-clearing 14 queue items on every app launch once processed).
    const ragManager = appState.getRAGManager();
    if (ragManager && ragManager.isReady()) {
      ragManager.ensureDemoMeetingProcessed().catch(console.error);
    }

    return { success: true };
  });

  safeHandle('flush-database', async () => {
    const result = DatabaseManager.getInstance().clearAllData();
    return { success: result };
  });

  // UX2: in-app TCC repair button.
  //
  // Runs `tccutil reset Microphone <bundleId>` AND
  // `tccutil reset ScreenCapture <bundleId>` to clear stale macOS TCC entries
  // for Natively. This is the user-facing self-service recovery for the
  // dominant "permissions appear granted in System Settings but capture is
  // silently zero-filled" failure mode — which is caused by TCC binding the
  // grant to a binary's cdhash, and the cdhash changing on every rebuild
  // (ad-hoc-signed builds — see AUDIO_RELIABILITY_REPORT.md §3 A1).
  //
  // After tccutil reset, the user MUST force-quit and relaunch the app for
  // the next TCC prompt to appear cleanly. We return the prompt copy so the
  // renderer can show a "Quit & relaunch" CTA.
  //
  // Service-name capitalization MATTERS: Apple requires capital `Microphone`
  // and `ScreenCapture` — lowercase fails with "Invalid Service Name." This
  // is the most common implementation bug.
  safeHandle('repair-tcc-permissions', async () => {
    if (process.platform !== 'darwin') {
      return { ok: false, error: 'TCC repair is macOS-only.' };
    }

    // Bundle ID resolution: prefer the live Electron app identifier (handles
    // signed packaged builds and dev-mode Electron alike). Falls back to the
    // package.json appId if app.getAppPath() inspection somehow fails.
    let bundleId: string;
    try {
      // app.isPackaged → packaged Info.plist CFBundleIdentifier
      //                  (== package.json build.appId for electron-builder)
      // !app.isPackaged → 'com.github.Electron' (the dev Electron binary's
      //                   bundle id; TCC entries land here in dev mode)
      bundleId = app.isPackaged ? 'com.electron.meeting-notes' : 'com.github.Electron';
    } catch {
      bundleId = 'com.electron.meeting-notes';
    }

    const { execFile } = require('node:child_process');
    const { promisify } = require('node:util');
    const execFileAsync = promisify(execFile);

    const services = ['Microphone', 'ScreenCapture']; // Capital letters REQUIRED.
    const results: Array<{ service: string; ok: boolean; output: string }> = [];

    for (const service of services) {
      try {
        // Absolute path — defense-in-depth against PATH shadowing. tccutil is
        // a SIP-protected stock macOS binary at /usr/bin/tccutil; using the
        // bare name would resolve via inherited PATH, which a user-modified
        // shell could in theory redirect.
        const { stdout, stderr } = await execFileAsync('/usr/bin/tccutil', ['reset', service, bundleId], {
          timeout: 5000,
        });
        results.push({ service, ok: true, output: (stdout || stderr || '').toString().trim() });
        console.log(`[IPC] tccutil reset ${service} ${bundleId}: OK`);
      } catch (err: any) {
        const msg = err?.stderr?.toString?.() || err?.message || String(err);
        results.push({ service, ok: false, output: msg.trim() });
        console.warn(`[IPC] tccutil reset ${service} ${bundleId} failed: ${msg}`);
      }
    }

    const anyOk = results.some((r) => r.ok);
    return {
      ok: anyOk,
      bundleId,
      results,
      promptRelaunch: anyOk,
      message: anyOk
        ? 'Permissions reset. Quit Natively completely (Cmd+Q) and reopen — macOS will ask you to grant Microphone and Screen Recording again. Approve both to restore audio capture.'
        : `Permission reset failed for ${bundleId}. ${results
            .filter((r) => !r.ok)
            .map((r) => `${r.service}: ${r.output}`)
            .join('; ')}`,
    };
  });

  safeHandle('open-external', async (event, url: string) => {
    try {
      if (typeof url !== 'string') {
        console.warn('[IPC] Blocked invalid open-external request', { reason: 'non-string' });
        return;
      }

      const parsed = new URL(url);
      const allowedWebUrl = parsed.protocol === 'https:';
      // x-apple.systempreferences is a macOS-only URI scheme. Allowing it on
      // Windows let renderer regressions hand Windows shell an unknown
      // protocol → Microsoft Store popup (issue #252). Gate the allowlist on
      // the actual platform so the IPC layer is the last line of defense.
      const allowedSystemSettingsUrl =
        parsed.protocol === 'x-apple.systempreferences:' && process.platform === 'darwin';

      if (allowedWebUrl || allowedSystemSettingsUrl) {
        await shell.openExternal(url);
      } else {
        console.warn('[IPC] Blocked open-external request', {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
        });
      }
    } catch {
      console.warn('[IPC] Invalid URL in open-external');
    }
  });

  // ==========================================
  // Intelligence Mode Handlers
  // ==========================================

  // MODE 1: Assist (Passive observation)
  safeHandle('generate-assist', async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const insight = await intelligenceManager.runAssistMode();
      if (insight) {
        try {
          PhoneMirrorService.getInstance().publishAssistantMessage(
            crypto.randomUUID(),
            insight,
            'Assist',
          );
        } catch (_) {}
      }
      return { insight };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 2: What Should I Say (Primary auto-answer)
  //
  // VISION-FIRST: image paths are validated and forwarded to IntelligenceManager
  // which routes them through the vision provider fallback chain.
  // LEGACY OCR PATH DISABLED: the previous build called ScreenContextService.captureScreenFromPath
  // here to run Tesseract OCR before answering. That path is now removed from the runtime —
  // Natively answers from the image directly via a vision-capable provider. Do not re-introduce
  // OCR here unless a future explicit OCR-only mode is reintroduced.
  safeHandle(
    'generate-what-to-say',
    async (
      _,
      question?: string,
      imagePaths?: string[],
      options?: { promptInstruction?: string },
    ) => {
      try {
        let screenContext: any;
        let screenContextStatus: 'not_available' | 'available' | 'failed' = 'not_available';
        let visionProviderUsed: string | undefined;
        let visionModelUsed: string | undefined;
        let visionAttempts: number | undefined;
        let visionFailureReason: string | undefined;

        const validatedImagePaths: string[] | undefined = imagePaths?.length ? [] : undefined;

        // SECURITY (P0): Validate image paths if provided from renderer
        if (imagePaths && imagePaths.length > 0) {
          if (
            !Array.isArray(imagePaths) ||
            imagePaths.length > 5 ||
            imagePaths.some(
              (imagePath) => typeof imagePath !== 'string' || imagePath.trim().length === 0,
            )
          ) {
            console.warn('[IPC] generate-what-to-say: malformed image path payload rejected');
            return {
              answer: null,
              question: question || 'unknown',
              screenContextStatus,
              error: 'Invalid image path payload',
            };
          }

          const { app } = require('electron');
          const { validateImagePath } = require('./utils/curlUtils');
          const userDataDir = app.getPath('userData');

          for (const imagePath of imagePaths) {
            const validation = validateImagePath(imagePath, userDataDir);
            if (!validation.isValid) {
              console.warn(
                `[IPC] generate-what-to-say: invalid image path rejected: ${validation.reason}`,
              );
              return {
                answer: null,
                question: question || 'unknown',
                screenContextStatus,
                error: `Invalid image path: ${validation.reason}`,
              };
            }
            validatedImagePaths!.push(imagePath);
          }

          // Vision-first: run the ScreenUnderstandingService so the image is hashed, optimized,
          // and routed through the vision provider fallback chain. The structured result becomes
          // the screenContext that PromptAssembler consumes.
          try {
            const {
              getScreenUnderstandingService,
            } = require('./services/screen/ScreenUnderstandingService');
            const { CredentialsManager } = require('./services/CredentialsManager');
            const sus = getScreenUnderstandingService();
            const settings = SettingsManager.getInstance();
            const credentials = CredentialsManager.getInstance();
            const providerScopes = settings.get('providerDataScopes') || {};
            const localVisionAvailable = credentials.anyLocalVisionProviderConfigured?.() ?? false;
            if (providerScopes.screenshots === false) {
              console.warn(
                localVisionAvailable
                  ? '[ScopeFallback] screenshots denied for cloud; routing to Ollama'
                  : '[ScopeFallback] screenshots denied; Ollama unavailable, omitting from context',
              );
            }

            const sur = await sus.understand({
              modeId: 'what-to-say',
              transcript: question,
              userAction: 'what_to_say',
              qualityMode: 'balanced',
              imagePaths: validatedImagePaths,
              screenUnderstandingMode: settings.getScreenUnderstandingMode(),
              technicalInterviewVisionFirst: settings.getTechnicalInterviewVisionFirst(),
              providerPolicy: {
                localOnly: settings.getScreenUnderstandingMode() === 'private_vision',
                allowScreenshots: providerScopes.screenshots !== false,
                visionAvailable: credentials.anyVisionProviderConfigured?.() ?? true,
                localVisionAvailable,
              },
            });

            screenContext = sur.status === 'available' ? sur : undefined;
            screenContextStatus =
              sur.status === 'available'
                ? 'available'
                : sur.status === 'failed'
                  ? 'failed'
                  : 'not_available';
            visionProviderUsed = sur.providerUsed;
            visionModelUsed = sur.modelUsed;
            visionAttempts = Array.isArray(sur.attempts) ? sur.attempts.length : undefined;
            visionFailureReason = sur.failureReason;
          } catch (sErr: any) {
            screenContextStatus = 'failed';
            console.warn('[IPC] generate-what-to-say: ScreenUnderstandingService failed', {
              errorClass: sErr?.name || 'Error',
            });
          }
        }

        const intelligenceManager = appState.getIntelligenceManager();
        // Question and imagePaths are now optional - IntelligenceManager infers from transcript
        const answer = await intelligenceManager.runWhatShouldISay(
          question,
          0.8,
          validatedImagePaths,
          {
            // A manual hotkey/button press is explicit user intent and must never
            // be throttled by the auto-trigger cooldown — the speculative pre-fetch
            // keeps refreshing lastTriggerTime on every interviewer question, which
            // otherwise leaves manual presses landing inside the cooldown window and
            // returning null ("What to answer stops responding after a few messages"
            // P0). The cooldown still throttles the automatic speculative path.
            skipCooldown: true,
            screenContext,
            promptInstruction:
              typeof options?.promptInstruction === 'string'
                ? options.promptInstruction
                : undefined,
          },
        );
        if (answer) {
          try {
            PhoneMirrorService.getInstance().publishAssistantMessage(
              crypto.randomUUID(),
              answer,
              'What to Answer',
            );
          } catch (_) {}
        }
        return {
          answer,
          question: question || 'inferred from context',
          screenContextStatus,
          visionProviderUsed,
          visionModelUsed,
          visionAttempts,
          visionFailureReason,
          imageCount: validatedImagePaths?.length || 0,
          usedImageInput: Boolean(validatedImagePaths?.length),
        };
      } catch (error: any) {
        console.error('[IPC] generate-what-to-say error:', error);
        return {
          answer: null,
          question: question || 'unknown',
          error: error?.message || 'unknown_error',
        };
      }
    },
  );

  safeHandle('generate-clarify', async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const clarification = await intelligenceManager.runClarify();
      // If null returned without throwing, the engine already set mode to idle.
      // We must still ensure the frontend un-sticks — emit an error so onIntelligenceError fires.
      if (clarification === null) {
        const win = appState.getMainWindow();
        win?.webContents.send('intelligence-error', {
          error:
            'Could not generate a clarifying question. Try again after some audio context is available.',
          mode: 'clarify',
        });
      } else {
        try {
          PhoneMirrorService.getInstance().publishAssistantMessage(
            crypto.randomUUID(),
            clarification,
            'Clarify',
          );
        } catch (_) {}
      }
      return { clarification };
    } catch (error: any) {
      throw error;
    }
  });

  // Shared helper: validate, then run images through the vision-first ImageOptimizer
  // so downstream provider calls send compressed JPEG payloads instead of raw retina PNGs.
  // Falls back to the original paths if optimization fails — image input is more important
  // than payload size, so a Sharp failure must not block the request.
  async function optimizeImagesForVision(
    paths: string[],
    handlerLabel: string,
    profile: 'fast' | 'balanced' | 'technical' | 'best' = 'technical',
  ): Promise<string[]> {
    if (paths.length === 0) return paths;
    try {
      const { getImageOptimizer } = require('./services/screen/ImageOptimizer');
      const optimizer = getImageOptimizer();
      const optimized: string[] = [];
      for (const p of paths) {
        try {
          const out = await optimizer.optimize(p, { profile, provider: 'openai', cacheKey: p });
          optimized.push(out.path);
        } catch (err: any) {
          console.warn(
            `[IPC] ${handlerLabel}: image optimization failed for ${p}, using original`,
            { errorClass: err?.name },
          );
          optimized.push(p);
        }
      }
      return optimized;
    } catch {
      return paths;
    }
  }

  safeHandle('generate-code-hint', async (_, imagePaths?: string[], problemStatement?: string) => {
    try {
      // If no explicit images were passed from the frontend, fall back to the
      // screenshot queue so the AI can always "see" the user's screen.
      const screenshotQueue = appState.getScreenshotQueue();
      const resolvedImagePaths: string[] =
        imagePaths && imagePaths.length > 0 ? imagePaths : screenshotQueue;

      // SECURITY (P0): Validate image paths if provided from renderer
      if (imagePaths && imagePaths.length > 0) {
        const { app } = require('electron');
        const { validateImagePath } = require('./utils/curlUtils');
        const userDataDir = app.getPath('userData');

        for (const imagePath of imagePaths) {
          const validation = validateImagePath(imagePath, userDataDir);
          if (!validation.isValid) {
            console.warn(
              `[IPC] generate-code-hint: invalid image path rejected: ${validation.reason}`,
            );
            return { error: `Invalid image path: ${validation.reason}`, hint: null };
          }
        }
      }

      console.log(
        `[IPC] generate-code-hint: using ${resolvedImagePaths.length} image(s) (${imagePaths?.length ? 'explicit' : 'queue fallback'})`,
      );

      // VISION-FIRST: optimize the screenshot(s) with Sharp before they reach the LLM,
      // using the 'technical' profile so code text stays sharp at 1536px.
      const optimizedPaths = await optimizeImagesForVision(
        resolvedImagePaths,
        'generate-code-hint',
        'technical',
      );

      const intelligenceManager = appState.getIntelligenceManager();
      const hint = await intelligenceManager.runCodeHint(
        optimizedPaths.length > 0 ? optimizedPaths : undefined,
        problemStatement,
      );
      if (hint) {
        try {
          PhoneMirrorService.getInstance().publishAssistantMessage(
            crypto.randomUUID(),
            hint,
            'Code Hint',
          );
        } catch (_) {}
      }
      return { hint };
    } catch (error: any) {
      throw error;
    }
  });

  safeHandle('generate-brainstorm', async (_, imagePaths?: string[], problemStatement?: string) => {
    try {
      // If no explicit images were passed from the frontend, fall back to the
      // screenshot queue so the AI can always "see" the user's screen.
      const screenshotQueue = appState.getScreenshotQueue();
      const resolvedImagePaths: string[] =
        imagePaths && imagePaths.length > 0 ? imagePaths : screenshotQueue;

      // SECURITY (P0): Validate image paths if provided from renderer
      if (imagePaths && imagePaths.length > 0) {
        const { app } = require('electron');
        const { validateImagePath } = require('./utils/curlUtils');
        const userDataDir = app.getPath('userData');

        for (const imagePath of imagePaths) {
          const validation = validateImagePath(imagePath, userDataDir);
          if (!validation.isValid) {
            console.warn(
              `[IPC] generate-brainstorm: invalid image path rejected: ${validation.reason}`,
            );
            return { error: `Invalid image path: ${validation.reason}`, script: null };
          }
        }
      }

      console.log(
        `[IPC] generate-brainstorm: using ${resolvedImagePaths.length} image(s) (${imagePaths?.length ? 'explicit' : 'queue fallback'})`,
      );

      // VISION-FIRST: balanced profile (1280px) — brainstorm doesn't need code-sharp text.
      const optimizedPaths = await optimizeImagesForVision(
        resolvedImagePaths,
        'generate-brainstorm',
        'balanced',
      );

      const intelligenceManager = appState.getIntelligenceManager();
      const script = await intelligenceManager.runBrainstorm(
        optimizedPaths.length > 0 ? optimizedPaths : undefined,
        problemStatement,
      );
      if (script) {
        try {
          PhoneMirrorService.getInstance().publishAssistantMessage(
            crypto.randomUUID(),
            script,
            'Brainstorm',
          );
        } catch (_) {}
      }
      return { script };
    } catch (error: any) {
      throw error;
    }
  });

  // Dynamic Action Button Mode (Recap vs Brainstorm)
  safeHandle('get-action-button-mode', () => {
    const { SettingsManager } = require('./services/SettingsManager');
    const sm = SettingsManager.getInstance();
    return sm.get('actionButtonMode') ?? 'recap';
  });

  safeHandle('set-action-button-mode', (_, mode: 'recap' | 'brainstorm') => {
    const { SettingsManager } = require('./services/SettingsManager');
    const sm = SettingsManager.getInstance();
    sm.set('actionButtonMode', mode);

    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('action-button-mode-changed', mode);
      }
    });

    return { success: true };
  });

  // MODE 3: Follow-Up (Refinement)
  safeHandle('generate-follow-up', async (_, intent: string, userRequest?: string) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const refined = await intelligenceManager.runFollowUp(intent, userRequest);
      if (refined) {
        try {
          PhoneMirrorService.getInstance().publishAssistantMessage(
            crypto.randomUUID(),
            refined,
            'Follow Up',
          );
        } catch (_) {}
      }
      return { refined, intent };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 4: Recap (Summary)
  safeHandle('generate-recap', async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const summary = await intelligenceManager.runRecap();
      if (summary) {
        try {
          PhoneMirrorService.getInstance().publishAssistantMessage(
            crypto.randomUUID(),
            summary,
            'Recap',
          );
        } catch (_) {}
      }
      return { summary };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 6: Follow-Up Questions
  safeHandle('generate-follow-up-questions', async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const questions = await intelligenceManager.runFollowUpQuestions();
      if (questions) {
        try {
          PhoneMirrorService.getInstance().publishAssistantMessage(
            crypto.randomUUID(),
            questions,
            'Follow-Up Questions',
          );
        } catch (_) {}
      }
      return { questions };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 5: Manual Answer (Fallback)
  safeHandle('submit-manual-question', async (_, question: string) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const answer = await intelligenceManager.runManualAnswer(question);
      if (answer) {
        try {
          PhoneMirrorService.getInstance().publishUserMessage(crypto.randomUUID(), question);
          PhoneMirrorService.getInstance().publishAssistantMessage(
            crypto.randomUUID(),
            answer,
            'Answer',
          );
        } catch (_) {}
      }
      return { answer, question };
    } catch (error: any) {
      throw error;
    }
  });

  // Get current intelligence context
  safeHandle('get-intelligence-context', async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      return {
        context: intelligenceManager.getFormattedContext(),
        lastAssistantMessage: intelligenceManager.getLastAssistantMessage(),
        activeMode: intelligenceManager.getActiveMode(),
      };
    } catch (error: any) {
      throw error;
    }
  });

  // Reset intelligence state
  safeHandle('reset-intelligence', async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      intelligenceManager.reset();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Phase 3 — Dynamic Actions IPC. Accept/dismiss/list. The action emission
  // direction is push-only (intelligence-dynamic-action channel from main →
  // renderer); these handlers are the renderer → main control plane.
  safeHandle('dynamic-action:accept', async (_, actionId: string) => {
    try {
      if (typeof actionId !== 'string' || !actionId) {
        return { success: false, error: 'invalid_action_id' };
      }
      const intelligenceManager = appState.getIntelligenceManager();
      const action = intelligenceManager.acceptDynamicAction(actionId);
      if (!action) return { success: false, error: 'not_found' };
      // Phase 6 — telemetry on accept (no transcript, no evidence body).
      try {
        const { telemetryService } = require('./services/telemetry/TelemetryService');
        telemetryService.track({
          name: 'dynamic_action_accepted',
          sessionId: action.sessionId,
          modeId: action.modeId,
          properties: {
            actionId: action.id,
            actionType: action.type,
            modeTemplateType: action.modeTemplateType,
          },
        });
      } catch {
        /* non-fatal */
      }
      // Caller (renderer) is expected to follow up with a normal Ask-AI call
      // using action.promptInstruction. We return the action so the renderer
      // can populate the answer prompt without a second round-trip.
      return { success: true, action };
    } catch (error: any) {
      return { success: false, error: error?.message ?? 'internal_error' };
    }
  });

  safeHandle('dynamic-action:dismiss', async (_, actionId: string) => {
    try {
      if (typeof actionId !== 'string' || !actionId) {
        return { success: false, error: 'invalid_action_id' };
      }
      const intelligenceManager = appState.getIntelligenceManager();
      intelligenceManager.dismissDynamicAction(actionId);
      // Phase 6 — telemetry on dismiss.
      try {
        const { telemetryService } = require('./services/telemetry/TelemetryService');
        telemetryService.track({ name: 'dynamic_action_dismissed', properties: { actionId } });
      } catch {
        /* non-fatal */
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error?.message ?? 'internal_error' };
    }
  });

  safeHandle('dynamic-action:list', async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      return { success: true, actions: intelligenceManager.getActiveDynamicActions() };
    } catch (error: any) {
      return { success: false, error: error?.message ?? 'internal_error', actions: [] };
    }
  });

  safeHandle(
    'test-inject-transcript',
    async (_, segment: { speaker: string; text: string; timestamp?: number; final?: boolean }) => {
      try {
        if (process.env.NODE_ENV !== 'test') return { success: false, error: 'test_only' };
        const intelligenceManager = appState.getIntelligenceManager();
        intelligenceManager.addTranscript(
          {
            speaker: segment.speaker,
            text: segment.text,
            timestamp: segment.timestamp ?? Date.now(),
            final: segment.final ?? true,
          },
          true,
        );
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  );

  safeHandle('test-get-mode-context', async () => {
    try {
      if (process.env.NODE_ENV !== 'test') return { success: false, error: 'test_only' };
      const { ModesManager } = require('./services/ModesManager');
      const manager = ModesManager.getInstance();
      return {
        success: true,
        block: manager.buildActiveModeContextBlock(),
        suffix: manager.getActiveModeSystemPromptSuffix(),
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Service Account Selection
  safeHandle('select-service-account', async () => {
    try {
      const result: any = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
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
      console.error('Error selecting service account:', error);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Theme System Handlers
  // ==========================================

  safeHandle('theme:get-mode', () => {
    const tm = appState.getThemeManager();
    return {
      mode: tm.getMode(),
      resolved: tm.getResolvedTheme(),
    };
  });

  safeHandle('theme:set-mode', (_, mode: 'system' | 'light' | 'dark') => {
    appState.getThemeManager().setMode(mode);
    return { success: true };
  });

  // ==========================================
  // Calendar Integration Handlers
  // ==========================================

  safeHandle('calendar-connect', async () => {
    try {
      const { CalendarManager } = require('./services/CalendarManager');
      await CalendarManager.getInstance().startAuthFlow();
      return { success: true };
    } catch (error: any) {
      console.error('Calendar auth error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('calendar-disconnect', async () => {
    const { CalendarManager } = require('./services/CalendarManager');
    await CalendarManager.getInstance().disconnect();
    return { success: true };
  });

  safeHandle('get-calendar-status', async () => {
    const { CalendarManager } = require('./services/CalendarManager');
    return CalendarManager.getInstance().getConnectionStatus();
  });

  safeHandle('get-upcoming-events', async () => {
    const { CalendarManager } = require('./services/CalendarManager');
    return CalendarManager.getInstance().getUpcomingEvents();
  });

  safeHandle('calendar-refresh', async () => {
    const { CalendarManager } = require('./services/CalendarManager');
    await CalendarManager.getInstance().refreshState();
    return { success: true };
  });

  // ==========================================
  // Follow-up Email Handlers
  // ==========================================

  safeHandle('generate-followup-email', async (_, input: any) => {
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
      const emailBody = await llmHelper.chatWithGemini(
        geminiPrompt,
        undefined,
        undefined,
        true,
        groqPrompt,
      );

      return emailBody;
    } catch (error: any) {
      console.error('Error generating follow-up email:', error);
      throw error;
    }
  });

  safeHandle('extract-emails-from-transcript', async (_, transcript: Array<{ text: string }>) => {
    try {
      const { extractEmailsFromTranscript } = require('./utils/emailUtils');
      return extractEmailsFromTranscript(transcript);
    } catch (error: any) {
      console.error('Error extracting emails:', error);
      return [];
    }
  });

  safeHandle('get-calendar-attendees', async (_, eventId: string) => {
    try {
      const { CalendarManager } = require('./services/CalendarManager');
      const cm = CalendarManager.getInstance();

      // Try to get attendees from the event
      const events = await cm.getUpcomingEvents();
      const event = events?.find((e: any) => e.id === eventId);

      if (event && event.attendees) {
        return event.attendees
          .map((a: any) => ({
            email: a.email,
            name: a.displayName || a.email?.split('@')[0] || '',
          }))
          .filter((a: any) => a.email);
      }

      return [];
    } catch (error: any) {
      console.error('Error getting calendar attendees:', error);
      return [];
    }
  });

  safeHandle(
    'open-mailto',
    async (_, { to, subject, body }: { to: string; subject: string; body: string }) => {
      try {
        const { buildMailtoLink } = require('./utils/emailUtils');
        const mailtoUrl = buildMailtoLink(to, subject, body);
        await shell.openExternal(mailtoUrl);
        return { success: true };
      } catch (error: any) {
        console.error('Error opening mailto:', error);
        return { success: false, error: error.message };
      }
    },
  );

  // ==========================================
  // RAG (Retrieval-Augmented Generation) Handlers
  // ==========================================

  // Store active query abort controllers for cancellation
  const activeRAGQueries = new Map<string, AbortController>();

  // Query meeting with RAG (meeting-scoped)
  safeHandle(
    'rag:query-meeting',
    async (event, { meetingId, query }: { meetingId: string; query: string }) => {
      const ragManager = appState.getRAGManager();

      if (!ragManager || !ragManager.isReady()) {
        // Fallback to regular chat if RAG not available
        console.log('[RAG] Not ready, falling back to regular chat');
        return { fallback: true };
      }

      // For completed meetings, check if post-meeting RAG is processed.
      // For live meetings with JIT indexing, let RAGManager.queryMeeting() decide.
      if (
        !ragManager.isMeetingProcessed(meetingId) &&
        !ragManager.isLiveIndexingActive(meetingId)
      ) {
        console.log(
          `[RAG] Meeting ${meetingId} not processed and no JIT indexing, falling back to regular chat`,
        );
        return { fallback: true };
      }

      const abortController = new AbortController();
      const queryKey = `meeting-${meetingId}-${crypto.randomUUID()}`;
      activeRAGQueries.set(queryKey, abortController);

      try {
        const stream = ragManager.queryMeeting(meetingId, query, abortController.signal);

        for await (const chunk of stream) {
          if (abortController.signal.aborted) break;
          event.sender.send('rag:stream-chunk', { meetingId, chunk });
        }

        event.sender.send('rag:stream-complete', { meetingId });
        return { success: true };
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          const msg = error.message || '';
          // If specific RAG failures, return fallback to use transcript window
          if (msg.includes('NO_RELEVANT_CONTEXT') || msg.includes('NO_MEETING_EMBEDDINGS')) {
            console.log(`[RAG] Query failed with '${msg}', falling back to regular chat`);
            return { fallback: true };
          }

          console.error('[RAG] Query error:', error);
          event.sender.send('rag:stream-error', { meetingId, error: msg });
        }
        return { success: false, error: error.message };
      } finally {
        activeRAGQueries.delete(queryKey);
      }
    },
  );

  // Query live meeting with JIT RAG
  safeHandle('rag:query-live', async (event, { query }: { query: string }) => {
    const ragManager = appState.getRAGManager();

    if (!ragManager || !ragManager.isReady()) {
      return { fallback: true };
    }

    // Check if JIT indexing is active AND has at least one embedded chunk.
    // isLiveIndexingActive() only tells us the indexer is running — it may have
    // received segments but not yet produced queryable embeddings. Calling
    // queryMeeting() with zero chunks throws NO_MEETING_EMBEDDINGS, adding
    // ~300ms of wasted try/catch overhead before the fallback fires.
    if (!ragManager.isLiveIndexingActive('live-meeting-current') || !ragManager.hasLiveChunks()) {
      return { fallback: true };
    }

    const abortController = new AbortController();
    // Date.now() alone collides when two queries fire in the same ms — the
    // second `set` would overwrite the first AbortController, the first
    // stream would become un-cancellable, and the `finally` `delete` would
    // evict the wrong entry. UUID guarantees uniqueness.
    // (Note: rag:cancel-query only matches `meeting-` and `global` prefixes,
    // so `live-` keys aren't cancellable through that path — pre-existing
    // behaviour, not regressed by this change.)
    const queryKey = `live-${crypto.randomUUID()}`;
    activeRAGQueries.set(queryKey, abortController);

    try {
      const stream = ragManager.queryMeeting('live-meeting-current', query, abortController.signal);

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break;
        event.sender.send('rag:stream-chunk', { live: true, chunk });
      }

      event.sender.send('rag:stream-complete', { live: true });
      return { success: true };
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        const msg = error.message || '';
        // If JIT RAG failed (no embeddings yet, no relevant context), fallback to regular chat
        if (msg.includes('NO_RELEVANT_CONTEXT') || msg.includes('NO_MEETING_EMBEDDINGS')) {
          console.log(`[RAG] JIT query failed with '${msg}', falling back to regular live chat`);
          return { fallback: true };
        }
        console.error('[RAG] Live query error:', error);
        event.sender.send('rag:stream-error', { live: true, error: msg });
      }
      return { success: false, error: error.message };
    } finally {
      activeRAGQueries.delete(queryKey);
    }
  });

  // Query global (cross-meeting search)
  safeHandle('rag:query-global', async (event, { query }: { query: string }) => {
    const ragManager = appState.getRAGManager();

    if (!ragManager || !ragManager.isReady()) {
      return { fallback: true };
    }

    const abortController = new AbortController();
    // See live-${...} comment above for why Date.now() alone is unsafe.
    const queryKey = `global-${crypto.randomUUID()}`;
    activeRAGQueries.set(queryKey, abortController);

    try {
      const stream = ragManager.queryGlobal(query, abortController.signal);

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break;
        event.sender.send('rag:stream-chunk', { global: true, chunk });
      }

      event.sender.send('rag:stream-complete', { global: true });
      return { success: true };
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        event.sender.send('rag:stream-error', { global: true, error: error.message });
      }
      return { success: false, error: error.message };
    } finally {
      activeRAGQueries.delete(queryKey);
    }
  });

  // Cancel active RAG query
  safeHandle(
    'rag:cancel-query',
    async (_, { meetingId, global }: { meetingId?: string; global?: boolean }) => {
      if (!global && !meetingId) {
        return { success: false, error: 'meetingId is required' };
      }

      const queryKey = global ? 'global' : `meeting-${meetingId}`;

      // Cancel any matching key
      for (const [key, controller] of activeRAGQueries) {
        const matchesQuery = global ? key.startsWith('global-') : key.startsWith(`${queryKey}-`);
        if (matchesQuery) {
          controller.abort();
          activeRAGQueries.delete(key);
        }
      }

      return { success: true };
    },
  );

  // Check if meeting has RAG embeddings
  safeHandle('rag:is-meeting-processed', async (_, meetingId: string) => {
    try {
      const ragManager = appState.getRAGManager();
      if (!ragManager) throw new Error('RAGManager not initialized');
      return ragManager.isMeetingProcessed(meetingId);
    } catch (error: any) {
      console.error('[IPC rag:is-meeting-processed] Error:', error);
      return false;
    }
  });

  safeHandle('rag:reindex-incompatible-meetings', async () => {
    try {
      const ragManager = appState.getRAGManager();
      if (!ragManager) throw new Error('RAGManager not initialized');
      await ragManager.reindexIncompatibleMeetings();
      return { success: true };
    } catch (error: any) {
      console.error('[IPC rag:reindex-incompatible-meetings] Error:', error);
      return { success: false, error: error.message };
    }
  });

  // Get RAG queue status
  safeHandle('rag:get-queue-status', async () => {
    const ragManager = appState.getRAGManager();
    if (!ragManager) return { pending: 0, processing: 0, completed: 0, failed: 0 };
    return ragManager.getQueueStatus();
  });

  // Retry pending embeddings
  safeHandle('rag:retry-embeddings', async () => {
    const ragManager = appState.getRAGManager();
    if (!ragManager) return { success: false };
    await ragManager.retryPendingEmbeddings();
    return { success: true };
  });

  // ==========================================
  // Profile Engine IPC Handlers
  // ==========================================

  // Allowlist of file paths the user explicitly selected via profile:select-file.
  // Without this, a compromised renderer could pass arbitrary filesystem paths
  // (e.g. /etc/passwd, ~/.ssh/id_rsa) to the upload handlers and exfiltrate
  // their contents through the knowledge index. Entries expire after 60s.
  const PROFILE_SELECTED_PATH_TTL_MS = 60_000;
  const profileSelectedPaths = new Map<string, number>();
  const normalizeProfilePath = (p: string): string => path.resolve(p);
  const sweepExpiredProfilePaths = (now: number): void => {
    for (const [key, expiresAt] of profileSelectedPaths) {
      if (now > expiresAt) profileSelectedPaths.delete(key);
    }
  };
  const registerSelectedProfilePath = (filePath: string): void => {
    const now = Date.now();
    sweepExpiredProfilePaths(now);
    profileSelectedPaths.set(normalizeProfilePath(filePath), now + PROFILE_SELECTED_PATH_TTL_MS);
  };
  const consumeSelectedProfilePath = (filePath: unknown): string | null => {
    if (typeof filePath !== 'string' || filePath.length === 0) return null;
    const key = normalizeProfilePath(filePath);
    const expiresAt = profileSelectedPaths.get(key);
    if (!expiresAt) return null;
    if (Date.now() > expiresAt) {
      profileSelectedPaths.delete(key);
      return null;
    }
    profileSelectedPaths.delete(key);
    return key;
  };

  safeHandle('profile:upload-resume', async (_, filePath: string) => {
    try {
      // Premium gate: require active license or free trial for profile features
      if (!isProOrTrialActive()) {
        return {
          success: false,
          error:
            'Pro license required. Please activate a license key to use Profile Intelligence features.',
        };
      }
      const resolvedPath = consumeSelectedProfilePath(filePath);
      if (!resolvedPath) {
        console.warn('[IPC] profile:upload-resume rejected: path was not produced by profile:select-file or has expired.');
        return { success: false, error: 'Please re-select the resume file.' };
      }
      console.log(`[IPC] profile:upload-resume called with: ${resolvedPath}`);
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return {
          success: false,
          error: 'Knowledge engine not initialized. Please ensure API keys are configured.',
        };
      }
      const { DocType } = require('../premium/electron/knowledge/types');
      const result = await orchestrator.ingestDocument(resolvedPath, DocType.RESUME);
      if (result?.success) {
        // RC-8 fix: uploading a resume must make it immediately usable. Previously
        // knowledge mode was a SEPARATE manual toggle, so a freshly-uploaded resume
        // sat inert until the user found the switch — every question fell through to
        // the bare chat prompt and got "I don't have access to your information".
        // Enable + persist so it survives restart (main.ts:1113 restores the setting).
        try {
          orchestrator.setKnowledgeMode(true);
          const { SettingsManager } = require('./services/SettingsManager');
          SettingsManager.getInstance().set('knowledgeMode', true);
        } catch (e) {
          console.warn('[IPC] profile:upload-resume: failed to auto-enable knowledge mode', e);
        }
        const activeResume = (orchestrator as any)?.activeResume?.structured_data ?? null;
        const factsReady = profileFactsReady(activeResume);
        console.log('[ProfileIntelligence] profileFactsReady', {
          profileFactsReady: factsReady,
          hasName: Boolean(activeResume?.identity?.name),
          experienceCount: Array.isArray(activeResume?.experience) ? activeResume.experience.length : 0,
          projectCount: Array.isArray(activeResume?.projects) ? activeResume.projects.length : 0,
          skillsCount: Array.isArray(activeResume?.skills)
            ? activeResume.skills.length
            : (activeResume?.skills && typeof activeResume.skills === 'object'
                ? Object.values(activeResume.skills).reduce((n: number, v: any) => n + (Array.isArray(v) ? v.length : 0), 0)
                : 0),
        });
      }
      return result;
    } catch (error: any) {
      console.error('[IPC] profile:upload-resume error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('profile:get-status', async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { hasProfile: false, profileMode: false };
      }
      // Map new KnowledgeStatus back to legacy UI shape temporarily, plus explicit
      // readiness flags used by eval/UI polling. profileFactsReady is true as soon
      // as structured resume extraction is saved; it does NOT wait for embeddings
      // or the JD AOT pipeline.
      const status = orchestrator.getStatus();
      const activeResume = (orchestrator as any)?.activeResume?.structured_data ?? null;
      const activeJD = (orchestrator as any)?.activeJD?.structured_data ?? null;
      return {
        hasProfile: status.hasResume,
        profileMode: status.activeMode,
        name: status.resumeSummary?.name,
        role: status.resumeSummary?.role,
        totalExperienceYears: status.resumeSummary?.totalExperienceYears,
        resume_structured_extraction_complete: Boolean(activeResume),
        resume_profile_facts_ready: profileFactsReady(activeResume),
        profileFactsReady: profileFactsReady(activeResume),
        jd_structured_extraction_complete: Boolean(activeJD),
        jdFactsReady: Boolean(activeJD),
        aot_pipeline_running: Boolean((orchestrator as any)?.getAOTPipeline?.()?.isRunning?.()),
        // D3: surface how the resume was parsed so the UI can hint that a
        // heuristic (LLM-down) profile may be re-extracted for richer facts.
        extractionMode: activeResume
          ? ((activeResume as any)?._extraction_mode === 'heuristic' ? 'heuristic' : 'llm')
          : 'none',
      };
    } catch (error: any) {
      return { hasProfile: false, profileMode: false };
    }
  });

  safeHandle('profile:set-mode', async (_, enabled: boolean) => {
    try {
      // Premium gate: only allow enabling profile mode with active license or free trial
      if (enabled && !isProOrTrialActive()) {
        return {
          success: false,
          error:
            'Pro license required. Please activate a license key to use Profile Intelligence features.',
        };
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      orchestrator.setKnowledgeMode(enabled);

      const { SettingsManager } = require('./services/SettingsManager');
      SettingsManager.getInstance().set('knowledgeMode', enabled);

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle('profile:delete', async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      const { DocType } = require('../premium/electron/knowledge/types');
      orchestrator.deleteDocumentsByType(DocType.RESUME);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle('profile:get-profile', async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return null;
      return orchestrator.getProfileData();
    } catch (error: any) {
      return null;
    }
  });

  safeHandle('profile:select-file', async () => {
    try {
      const result: any = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Resume Files', extensions: ['pdf', 'docx', 'txt'] }],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { cancelled: true };
      }

      const selected = result.filePaths[0];
      registerSelectedProfilePath(selected);
      return { success: true, filePath: selected };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // JD & Research IPC Handlers
  // ==========================================

  safeHandle('profile:upload-jd', async (_, filePath: string) => {
    try {
      // Premium gate
      if (!isProOrTrialActive()) {
        return {
          success: false,
          error:
            'Pro license required. Please activate a license key to use Profile Intelligence features.',
        };
      }
      const resolvedPath = consumeSelectedProfilePath(filePath);
      if (!resolvedPath) {
        console.warn('[IPC] profile:upload-jd rejected: path was not produced by profile:select-file or has expired.');
        return { success: false, error: 'Please re-select the JD file.' };
      }
      console.log(`[IPC] profile:upload-jd called with: ${resolvedPath}`);
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return {
          success: false,
          error: 'Knowledge engine not initialized. Please ensure API keys are configured.',
        };
      }
      const { DocType } = require('../premium/electron/knowledge/types');
      const result = await orchestrator.ingestDocument(resolvedPath, DocType.JD);
      if (result?.success) {
        // RC-8 fix: a JD is only useful with knowledge mode on. If a resume is already
        // loaded, setKnowledgeMode(true) takes effect immediately; if not, it no-ops
        // safely (the gate still requires a resume) but we persist the intent so the
        // JD becomes active as soon as a resume is uploaded.
        try {
          orchestrator.setKnowledgeMode(true);
          const { SettingsManager } = require('./services/SettingsManager');
          SettingsManager.getInstance().set('knowledgeMode', true);
        } catch (e) {
          console.warn('[IPC] profile:upload-jd: failed to auto-enable knowledge mode', e);
        }
      }
      return result;
    } catch (error: any) {
      console.error('[IPC] profile:upload-jd error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('profile:delete-jd', async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      const { DocType } = require('../premium/electron/knowledge/types');
      orchestrator.deleteDocumentsByType(DocType.JD);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle('profile:research-company', async (_, companyName: string) => {
    try {
      // Premium gate
      if (!isProOrTrialActive()) {
        return {
          success: false,
          error:
            'Pro license required. Please activate a license key to use Profile Intelligence features.',
        };
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      const engine = orchestrator.getCompanyResearchEngine();

      // Wire search provider: Tavily (user key) → Natively API (fallback) → none (LLM-only)
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      const tavilyApiKey = cm.getTavilyApiKey();
      if (tavilyApiKey) {
        const {
          TavilySearchProvider,
        } = require('../premium/electron/knowledge/TavilySearchProvider');
        engine.setSearchProvider(new TavilySearchProvider(tavilyApiKey));
      } else {
        const nativelyKey = cm.getNativelyApiKey();
        if (nativelyKey) {
          const {
            NativelySearchProvider,
          } = require('../premium/electron/knowledge/NativelySearchProvider');
          // Pass the real trial token when key is the __trial__ sentinel so the
          // server can authenticate via x-trial-token instead of the invalid key.
          const trialToken = nativelyKey === TRIAL_SENTINEL_KEY ? cm.getTrialToken() : undefined;
          engine.setSearchProvider(
            new NativelySearchProvider(nativelyKey, trialToken ?? undefined),
          );
          console.log(
            '[IPC] Company research: using Natively API search (no Tavily key configured)',
          );
        }
      }

      // Build full JD context so the dossier is tailored to the exact role
      const profileData = orchestrator.getProfileData();
      const activeJD = profileData?.activeJD;
      const jdCtx = activeJD
        ? {
            title: activeJD.title,
            location: activeJD.location,
            level: activeJD.level,
            technologies: activeJD.technologies,
            requirements: activeJD.requirements,
            keywords: activeJD.keywords,
            compensation_hint: activeJD.compensation_hint,
            min_years_experience: activeJD.min_years_experience,
          }
        : {};
      const dossier = await engine.researchCompany(companyName, jdCtx, true);
      const searchQuotaExhausted = (engine.searchProvider as any)?.quotaExhausted === true;
      return { success: true, dossier, searchQuotaExhausted };
    } catch (error: any) {
      console.error('[IPC] profile:research-company error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('profile:generate-negotiation', async (_, force: boolean = false) => {
    try {
      // Premium gate
      if (!isProOrTrialActive()) {
        return {
          success: false,
          error:
            'Pro license required. Please activate a license key to use Profile Intelligence features.',
        };
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      const status = orchestrator.getStatus();
      if (!status.hasResume) {
        return { success: false, error: 'No resume loaded' };
      }

      // Use cache unless force-regenerating
      let script = force ? null : orchestrator.getNegotiationScript();
      if (!script) {
        script = await orchestrator.generateNegotiationScriptOnDemand();
      }
      if (!script) {
        return {
          success: false,
          error:
            'Could not generate negotiation script. Ensure a resume and job description are uploaded.',
        };
      }
      return { success: true, script };
    } catch (error: any) {
      console.error('[IPC] profile:generate-negotiation error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('profile:get-negotiation-state', async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return { success: false, error: 'Engine not ready' };
      const tracker = orchestrator.getNegotiationTracker();
      return {
        success: true,
        state: tracker.getState(),
        isActive: tracker.isActive(),
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle('profile:reset-negotiation', async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return { success: false };
      orchestrator.resetNegotiationSession();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Profile Custom Notes
  // ==========================================

  safeHandle('profile:get-notes', async () => {
    try {
      const content = DatabaseManager.getInstance().getCustomNotes();
      return { success: true, content };
    } catch (error: any) {
      return { success: false, content: '', error: error.message };
    }
  });

  safeHandle('profile:save-notes', async (_, content: string) => {
    try {
      // Enforce a max length of 4000 chars to prevent prompt bloat
      const trimmed = typeof content === 'string' ? content.slice(0, 4000) : '';
      DatabaseManager.getInstance().saveCustomNotes(trimmed);

      // Propagate to orchestrator (premium path) and LLMHelper (all-provider path)
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (orchestrator?.setCustomNotes) orchestrator.setCustomNotes(trimmed);

      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      if (llmHelper?.setCustomNotes) llmHelper.setCustomNotes(trimmed);

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle('profile:get-persona', async () => {
    try {
      if (!isProOrTrialActive()) return { success: false, content: '', error: 'pro_required' };
      const content = DatabaseManager.getInstance().getPersona();
      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      if (llmHelper?.setPersonaPrompt) llmHelper.setPersonaPrompt(content);
      return { success: true, content };
    } catch (error: any) {
      return { success: false, content: '', error: error.message };
    }
  });

  safeHandle('profile:save-persona', async (_, content: string) => {
    try {
      if (!isProOrTrialActive()) return { success: false, error: 'pro_required' };
      if (typeof content !== 'string') return { success: false, error: 'invalid_persona' };
      const trimmed = content.trim().slice(0, 4000);
      DatabaseManager.getInstance().savePersona(trimmed);

      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      if (llmHelper?.setPersonaPrompt) llmHelper.setPersonaPrompt(trimmed);

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Tavily Search API Credentials
  // ==========================================

  safeHandle('set-tavily-api-key', async (_, apiKey: string) => {
    try {
      if (apiKey && !apiKey.startsWith('tvly-')) {
        return { success: false, error: 'Invalid Tavily API key. Keys must start with "tvly-".' };
      }
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setTavilyApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Overlay Opacity (Stealth Mode)
  // ==========================================

  safeHandle('set-overlay-opacity', async (_, opacity: number) => {
    // Clamp to valid range
    const clamped = Math.min(1.0, Math.max(0.35, opacity));
    // Broadcast to all renderer windows so the overlay picks it up in real-time
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('overlay-opacity-changed', clamped);
      }
    });
    return;
  });

  // ── Permissions ──────────────────────────────────────────────
  safeHandle('permissions:check', async () => {
    if (process.platform === 'darwin') {
      const mic = systemPreferences.getMediaAccessStatus('microphone');
      const screen = systemPreferences.getMediaAccessStatus('screen');
      return { microphone: mic, screen, platform: 'darwin' };
    }
    // Windows/Linux: no TCC — permissions handled by OS at install/first-use time
    return { microphone: 'granted', screen: 'granted', platform: process.platform };
  });

  safeHandle('permissions:request-mic', async () => {
    if (process.platform !== 'darwin') return true;
    try {
      return await systemPreferences.askForMediaAccess('microphone');
    } catch {
      return false;
    }
  });

  // ==========================================
  // Modes IPC Handlers
  // ==========================================

  safeHandle('modes:get-all', async () => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      const mgr = ModesManager.getInstance();
      const modes = mgr.getModes();
      // Attach reference file counts
      return modes.map((m: any) => ({
        ...m,
        referenceFileCount: mgr.getReferenceFiles(m.id).length,
      }));
    } catch (e: any) {
      console.error('[IPC] modes:get-all error:', e);
      return [];
    }
  });

  safeHandle('modes:get-active', async () => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      return ModesManager.getInstance().getActiveMode();
    } catch (e: any) {
      console.error('[IPC] modes:get-active error:', e);
      return null;
    }
  });

  safeHandle('modes:create', async (_, params: { name: string; templateType: string }) => {
    try {
      if (!isProOrTrialActive()) return { success: false, error: 'pro_required' };
      const { ModesManager } = require('./services/ModesManager');
      const mode = ModesManager.getInstance().createMode({
        name: params.name,
        templateType: params.templateType as any,
      });
      return { success: true, mode };
    } catch (e: any) {
      console.error('[IPC] modes:create error:', e);
      return { success: false, error: e.message };
    }
  });

  safeHandle(
    'modes:update',
    async (
      _,
      id: string,
      updates: { name?: string; templateType?: string; customContext?: string },
    ) => {
      try {
        const { ModesManager } = require('./services/ModesManager');
        const mgr = ModesManager.getInstance();
        // Gate: changing templateType to a non-general template requires pro.
        // Also gate if the existing mode is already non-general (editing a pro mode requires pro).
        if (!isProOrTrialActive()) {
          if (updates.templateType && updates.templateType !== 'general') {
            return { success: false, error: 'pro_required' };
          }
          const existing = mgr.getModes().find((m: any) => m.id === id);
          if (existing && existing.templateType !== 'general') {
            return { success: false, error: 'pro_required' };
          }
        }
        mgr.updateMode(id, updates);
        return { success: true };
      } catch (e: any) {
        console.error('[IPC] modes:update error:', e);
        return { success: false, error: e.message };
      }
    },
  );

  safeHandle('modes:delete', async (_, id: string) => {
    try {
      if (!isProOrTrialActive()) return { success: false, error: 'pro_required' };
      const { ModesManager } = require('./services/ModesManager');
      ModesManager.getInstance().deleteMode(id);
      return { success: true };
    } catch (e: any) {
      console.error('[IPC] modes:delete error:', e);
      return { success: false, error: e.message };
    }
  });

  safeHandle('modes:set-active', async (_, id: string | null) => {
    try {
      // Allow clearing (null) or setting general mode without pro; all other modes require pro
      if (id !== null) {
        const { ModesManager } = require('./services/ModesManager');
        const targetMode = ModesManager.getInstance()
          .getModes()
          .find((m: any) => m.id === id);
        if (targetMode && targetMode.templateType !== 'general' && !isProOrTrialActive()) {
          return { success: false, error: 'pro_required' };
        }
      }
      const { ModesManager } = require('./services/ModesManager');
      // BUG-MODE-BLEEDING fix: clear mode-specific session context BEFORE switching modes
      // so Interview mode resume/JD context doesn't bleed into the new mode's responses.
      try {
        const appStateIntMgr = appState.getIntelligenceManager();
        if (appStateIntMgr) appStateIntMgr.clearSessionContext();
      } catch {
        /* non-fatal — session may not exist during startup */
      }

      ModesManager.getInstance().setActiveMode(id);
      // Broadcast mode change to all windows so indicators update immediately
      const activeMode = id ? ModesManager.getInstance().getActiveMode() : null;
      const activeName = activeMode?.name ?? null;
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('mode-changed', { id, name: activeName });
      });
      // Phase 3 — re-bind dynamic action engine so the new mode's trigger pack
      // takes effect immediately. New (sessionId, modeId) pair flushes the per-
      // session store inside DynamicActionEngine, killing any old-mode candidates.
      try {
        const appStateIntMgr = appState.getIntelligenceManager();
        if (appStateIntMgr && activeMode) {
          appStateIntMgr.setDynamicActionContext({
            sessionId: `session_${crypto.randomUUID()}`,
            modeId: activeMode.id,
            modeTemplateType: activeMode.templateType,
          });
        } else if (appStateIntMgr && !id) {
          appStateIntMgr.clearDynamicActionContext();
        }
      } catch {
        /* non-fatal */
      }
      // Phase 6 — mode_switched telemetry (no PII).
      try {
        const { telemetryService } = require('./services/telemetry/TelemetryService');
        telemetryService.track({
          name: 'mode_switched',
          modeId: activeMode?.id,
          properties: { modeTemplateType: activeMode?.templateType, cleared: !id },
        });
      } catch {
        /* non-fatal */
      }
      return { success: true };
    } catch (e: any) {
      console.error('[IPC] modes:set-active error:', e);
      return { success: false, error: e.message };
    }
  });

  safeHandle('modes:get-reference-files', async (_, modeId: string) => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      return ModesManager.getInstance().getReferenceFiles(modeId);
    } catch (e: any) {
      console.error('[IPC] modes:get-reference-files error:', e);
      return [];
    }
  });

  safeHandle('modes:upload-reference-file', async (_, modeId: string) => {
    try {
      if (!isProOrTrialActive()) return { success: false, error: 'pro_required' };
      // Server-side allow-list. The dialog filter is a hint to users — never
      // trust it for validation, since the user can rename a file or the
      // filter can be bypassed by selecting "All Files" in the dialog UI.
      // Plain-text formats parse trivially; PDF and DOCX go through their
      // dedicated parsers below.
      const ALLOWED_EXTENSIONS = new Set([
        '.txt',
        '.md',
        '.markdown',
        '.json',
        '.csv',
        '.tsv',
        '.xml',
        '.html',
        '.htm',
        '.log',
        '.pdf',
        '.docx',
        '.doc',
      ]);
      // 10 MiB per file. Anything larger is almost always a database dump,
      // a media file, or a misclicked archive; the modes layer would just
      // truncate it to ~40 KB anyway via MAX_TOTAL_CHARS.
      const MAX_FILE_BYTES = 10 * 1024 * 1024;

      const result: any = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          {
            name: 'Text & Documents',
            extensions: ['txt', 'md', 'json', 'csv', 'xml', 'html', 'pdf', 'docx', 'doc'],
          },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (result.canceled || !result.filePaths.length) {
        return { success: false, cancelled: true };
      }
      const filePath = result.filePaths[0];
      const fileName = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();

      if (!ALLOWED_EXTENSIONS.has(ext)) {
        // Friendly, actionable message — UI surfaces this to the user.
        return {
          success: false,
          error: `Unsupported file type "${ext || 'none'}". Supported formats: TXT, MD, JSON, CSV, XML, HTML, LOG, PDF, DOCX, DOC. For resumes and job descriptions, use Profile Intelligence under Settings instead.`,
        };
      }

      // Pre-flight stat. Use lstat so we don't auto-follow symlinks — a
      // symlink to /dev/zero or a network mount that lies about size would
      // otherwise hang the renderer-IPC reply forever via readFileSync.
      let stats: ReturnType<typeof fs.lstatSync>;
      try {
        stats = fs.lstatSync(filePath);
      } catch {
        return {
          success: false,
          error: 'Could not read the selected file. It may have moved or been deleted.',
        };
      }
      if (!stats.isFile()) {
        return {
          success: false,
          error:
            'Selected path is not a regular file (it may be a symlink, device, or directory). Pick a real document file.',
        };
      }
      if (stats.size > MAX_FILE_BYTES) {
        const mb = (stats.size / (1024 * 1024)).toFixed(1);
        return {
          success: false,
          error: `File is ${mb} MB; the maximum is 10 MB. Trim the file or split it into smaller reference documents.`,
        };
      }

      // Wrap the parser branches in a per-call timeout. pdf-parse and mammoth
      // have both hung historically on malformed input or zip-bomb DOCX —
      // 15 s is generous for a 10 MiB document.
      const PARSE_TIMEOUT_MS = 15_000;
      function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
        return Promise.race([
          p,
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
          ),
        ]);
      }

      let content = '';
      try {
        if (ext === '.pdf') {
          const { PDFParse } = require('pdf-parse');
          const buffer = fs.readFileSync(filePath);
          const parser = new PDFParse({ data: buffer });
          const data: any = await withTimeout<any>(parser.getText(), PARSE_TIMEOUT_MS, 'PDF parse');
          content = data.text;
        } else if (ext === '.docx' || ext === '.doc') {
          const mammoth = require('mammoth');
          const result2: any = await withTimeout<any>(
            mammoth.extractRawText({ path: filePath }),
            PARSE_TIMEOUT_MS,
            'DOCX parse',
          );
          content = result2.value;
        } else {
          // Plain-text family. Read raw bytes first so we can detect text
          // encoding from a leading byte-order-mark before deciding whether
          // a null byte is binary noise or a legitimate UTF-16 zero-pad.
          const probe = fs.readFileSync(filePath, { encoding: null });
          if (probe.length === 0) {
            return { success: false, error: `"${fileName}" is empty.` };
          }
          // BOM-aware decode. UTF-16 files have many embedded null bytes; we
          // must NOT treat those as a binary-rename signal.
          if (probe.length >= 2 && probe[0] === 0xff && probe[1] === 0xfe) {
            content = probe.subarray(2).toString('utf16le');
          } else if (probe.length >= 2 && probe[0] === 0xfe && probe[1] === 0xff) {
            // UTF-16 BE → swap pairs then decode as utf16le.
            const swapped = Buffer.allocUnsafe(probe.length - 2);
            for (let i = 2; i + 1 < probe.length; i += 2) {
              swapped[i - 2] = probe[i + 1];
              swapped[i - 1] = probe[i];
            }
            content = swapped.toString('utf16le');
          } else if (
            probe.length >= 3 &&
            probe[0] === 0xef &&
            probe[1] === 0xbb &&
            probe[2] === 0xbf
          ) {
            content = probe.subarray(3).toString('utf8');
          } else {
            // No BOM. Sniff the first 2 KiB for a null byte — that's the
            // strongest signal of a renamed binary.
            const sniffWindow = probe.subarray(0, Math.min(2048, probe.length));
            if (sniffWindow.includes(0)) {
              return {
                success: false,
                error: `"${fileName}" looks like a binary file even though its extension is ${ext}. Re-save the file as plain text or pick a supported document format.`,
              };
            }
            content = probe.toString('utf8');
          }
        }
      } catch (parseErr: any) {
        // Parser-specific failures (timeout, malformed PDF, zip-bomb DOCX).
        // Log detail to main-process; return a generic message.
        console.error(
          '[IPC] modes:upload-reference-file parser error:',
          parseErr?.message ?? parseErr,
        );
        return {
          success: false,
          error: `Could not parse "${fileName}". The file may be corrupt, password-protected, or in an unsupported variant of ${ext}.`,
        };
      }

      if (!content || content.trim().length === 0) {
        return {
          success: false,
          error: `"${fileName}" parsed to empty text. The file may be password-protected, image-only, or corrupt.`,
        };
      }

      const { ModesManager } = require('./services/ModesManager');
      const file = ModesManager.getInstance().addReferenceFile({ modeId, fileName, content });
      return { success: true, file };
    } catch (e: any) {
      console.error('[IPC] modes:upload-reference-file error:', e);
      // Do not leak raw error.message to the renderer (may contain absolute
      // paths or library internals). Return a generic message; the detail is
      // already in the main-process log above.
      return {
        success: false,
        error: 'Could not read the selected file. Please try a different file or contact support.',
      };
    }
  });

  safeHandle('modes:delete-reference-file', async (_, id: string) => {
    try {
      if (!isProOrTrialActive()) return { success: false, error: 'pro_required' };
      const { ModesManager } = require('./services/ModesManager');
      ModesManager.getInstance().deleteReferenceFile(id);
      return { success: true };
    } catch (e: any) {
      console.error('[IPC] modes:delete-reference-file error:', e);
      return { success: false, error: e.message };
    }
  });

  // ── Note Sections ──────────────────────────────────────────────

  safeHandle('modes:get-note-sections', async (_, modeId: string) => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      return ModesManager.getInstance().getNoteSections(modeId);
    } catch (e: any) {
      console.error('[IPC] modes:get-note-sections error:', e);
      return [];
    }
  });

  safeHandle(
    'modes:add-note-section',
    async (_, modeId: string, title: string, description: string) => {
      try {
        if (!isProOrTrialActive()) return { success: false, error: 'pro_required' };
        const { ModesManager } = require('./services/ModesManager');
        const section = ModesManager.getInstance().addNoteSection({ modeId, title, description });
        return { success: true, section };
      } catch (e: any) {
        console.error('[IPC] modes:add-note-section error:', e);
        return { success: false, error: e.message };
      }
    },
  );

  safeHandle(
    'modes:update-note-section',
    async (_, id: string, updates: { title?: string; description?: string }) => {
      try {
        if (!isProOrTrialActive()) return { success: false, error: 'pro_required' };
        const { ModesManager } = require('./services/ModesManager');
        ModesManager.getInstance().updateNoteSection(id, updates);
        return { success: true };
      } catch (e: any) {
        console.error('[IPC] modes:update-note-section error:', e);
        return { success: false, error: e.message };
      }
    },
  );

  safeHandle('modes:delete-note-section', async (_, id: string) => {
    try {
      if (!isProOrTrialActive()) return { success: false, error: 'pro_required' };
      const { ModesManager } = require('./services/ModesManager');
      ModesManager.getInstance().deleteNoteSection(id);
      return { success: true };
    } catch (e: any) {
      console.error('[IPC] modes:delete-note-section error:', e);
      return { success: false, error: e.message };
    }
  });

  safeHandle('modes:remove-all-note-sections', async (_, modeId: string) => {
    try {
      if (!isProOrTrialActive()) return { success: false, error: 'pro_required' };
      const { ModesManager } = require('./services/ModesManager');
      ModesManager.getInstance().removeAllNoteSections(modeId);
      return { success: true };
    } catch (e: any) {
      console.error('[IPC] modes:remove-all-note-sections error:', e);
      return { success: false, error: e.message };
    }
  });

  // -----------------------------------------------------------------------
  // Phone Mirror — stream live AI responses to a paired phone over WS.
  // -----------------------------------------------------------------------

  // Push status updates to the renderer whenever the service starts/stops
  // or a phone connects/disconnects. Idempotent — multiple windows can listen.
  PhoneMirrorService.getInstance().onStatusChange((info) => {
    const win = appState.getMainWindow();
    win?.webContents.send('phone-mirror:status', info);
    try {
      const settingsWin = (appState as any).settingsWindowHelper?.getWindow?.();
      settingsWin?.webContents?.send('phone-mirror:status', info);
    } catch (_) {
      /* settings window may not exist yet */
    }
  });

  safeHandle('skills:list', () => {
    try {
      return SkillsManager.getInstance().listSkills();
    } catch (e: any) {
      console.warn('[IPC] skills:list error:', e?.message || e);
      return [];
    }
  });

  safeHandle('skills:open-folder', async () => {
    try {
      return await SkillsManager.getInstance().openSkillsFolder();
    } catch (e: any) {
      console.warn('[IPC] skills:open-folder error:', e?.message || e);
      return { success: false, path: '', error: e?.message || 'failed to open skills folder' };
    }
  });

  safeHandle('phone-mirror:get-info', async () => {
    return PhoneMirrorService.getInstance().snapshot();
  });

  safeHandle('phone-mirror:enable', async (_, exposeOnLan?: boolean) => {
    try {
      return await PhoneMirrorService.getInstance().start({
        exposeOnLan: !!exposeOnLan,
        persist: true,
      });
    } catch (e: any) {
      console.error('[IPC] phone-mirror:enable error:', e);
      return { error: e?.message || 'failed to start phone mirror' };
    }
  });

  safeHandle('phone-mirror:disable', async () => {
    await PhoneMirrorService.getInstance().stop({ persist: true });
    return { success: true };
  });

  safeHandle('phone-mirror:set-lan', async (_, exposeOnLan: boolean) => {
    try {
      return await PhoneMirrorService.getInstance().setExposeOnLan(!!exposeOnLan);
    } catch (e: any) {
      console.error('[IPC] phone-mirror:set-lan error:', e);
      return { error: e?.message || 'failed to update lan setting' };
    }
  });

  safeHandle('phone-mirror:rotate-token', async () => {
    try {
      return await PhoneMirrorService.getInstance().rotateToken();
    } catch (e: any) {
      console.error('[IPC] phone-mirror:rotate-token error:', e);
      return { error: e?.message || 'failed to rotate token' };
    }
  });

  // Stealth screenshot capture triggered from the phone UI.
  // Takes a screenshot on the PC (adding it to the screenshot queue so it can
  // be used in the next AI prompt), then broadcasts an ack so the phone shows
  // a confirmation toast.  The image is NOT sent to the phone — the phone is
  // just a remote shutter; the screenshot stays on the desktop for AI use.
  safeHandle('phone-mirror:push-screenshot', async (_, screenshotPath?: string) => {
    try {
      const imgPath = screenshotPath || (await appState.takeScreenshot(false));
      PhoneMirrorService.getInstance().publishAck(
        'screenshot',
        'Screenshot captured — queued for AI',
      );
      return { success: true, path: imgPath };
    } catch (e: any) {
      console.error('[IPC] phone-mirror:push-screenshot error:', e);
      return { error: e?.message || 'failed to capture screenshot' };
    }
  });

  // Route commands sent by the phone browser back to the Electron renderer so
  // the existing action system (global-shortcut events, chat stream) handles
  // them without duplicating logic.
  PhoneMirrorService.getInstance().onPhoneCommand(async (cmd) => {
    const win = appState.getMainWindow();

    if (cmd.type === 'action') {
      // Re-use the same global-shortcut dispatch path the keyboard uses.
      // This keeps phone actions identical to key-triggered stealth actions.
      const helper = appState.getWindowHelper();
      const sent = new Set<number>();
      for (const w of [helper.getLauncherWindow(), helper.getOverlayWindow()]) {
        if (!w || w.isDestroyed() || sent.has(w.id)) continue;
        sent.add(w.id);
        try {
          w.webContents.send('global-shortcut', { action: cmd.action });
        } catch {
          // Window is tearing down; keep delivering to any other valid surface.
        }
      }
    } else if (cmd.type === 'chat') {
      // Stream a phone-initiated chat through the LLM exactly like gemini-chat-stream
      // but without requiring a renderer event sender. Tokens are pushed directly to
      // the phone over WebSocket; desktop renderer also receives them so both views
      // stay in sync.
      const myStreamId = ++_chatStreamId;
      const message = cmd.message;
      const phoneMirror = PhoneMirrorService.getInstance();
      const intelligenceManager = appState.getIntelligenceManager();

      // Capture rolling context BEFORE adding the new user message — same ordering
      // as gemini-chat-stream so Recap / Follow Up / What to Answer see phone turns.
      let context: string | undefined;
      try {
        const snap = intelligenceManager.getFormattedContext(100);
        if (snap && snap.trim().length > 0) context = snap;
      } catch (ctxErr) {
        console.warn('[PhoneMirror] Failed to capture pre-turn context:', ctxErr);
      }

      intelligenceManager.addTranscript(
        { text: message, speaker: 'user', timestamp: Date.now(), final: true },
        true,
      );

      try {
        phoneMirror.publishUserMessage(String(myStreamId), message);
      } catch (_) {}
      // Notify renderer so it can display the incoming phone message too.
      win?.webContents.send('phone-mirror:incoming-chat', {
        message,
        streamId: String(myStreamId),
      });

      try {
        const llmHelper = appState.processingHelper.getLLMHelper();
        // AbortController so the live-deadline driver can cancel a stalled provider
        // request (not just stop emitting) — mirrors the desktop chat path.
        const phoneController = new AbortController();
        const stream = llmHelper.streamChat(message, undefined, context, CHAT_MODE_PROMPT, false, false, [], phoneController.signal);
        let full = '';
        let phoneSuperseded = false;
        // Deadline-guarded (Issue 1) — this is a live streaming surface too: a hung
        // provider must never block it forever. Uses the standard chat first-useful
        // budget; an inter-token stall guard protects long answers.
        await raceStreamWithDeadline({
          stream: stream as AsyncGenerator<string>,
          firstUsefulDeadlineMs: firstUsefulDeadlineMs('general_meeting_answer'),
          isUsefulYet: () => full.trim().length >= 5,
          shouldAbort: () => {
            if (_chatStreamId !== myStreamId) {
              console.log(`[PhoneMirror] phone-chat ${myStreamId} superseded by ${_chatStreamId}, stopping.`);
              phoneSuperseded = true; return true;
            }
            // Cancel early if all phones disconnected and there's no desktop renderer.
            if (!phoneMirror.hasClients() && win?.isDestroyed()) return true;
            return false;
          },
          onToken: (token: string) => {
            try { phoneMirror.publishToken(String(myStreamId), token); } catch (_) {}
            win?.webContents.send('gemini-stream-token', token);
            full += token;
          },
          onCleanup: () => { try { phoneController.abort(); } catch { /* noop */ } },
        });
        if (phoneSuperseded) return;
        if (_chatStreamId === myStreamId) {
          try {
            phoneMirror.publishDone(String(myStreamId), full);
          } catch (_) {}
          win?.webContents.send('gemini-stream-done');
          if (full.trim().length > 0) {
            intelligenceManager.addAssistantMessage(full);
            intelligenceManager.logUsage('chat', message, full);
          }
        }
      } catch (err: any) {
        console.error('[PhoneMirror] phone-chat stream error:', err);
        if (_chatStreamId === myStreamId) {
          try {
            phoneMirror.publishError(String(myStreamId), err?.message || 'stream error');
          } catch (_) {}
          win?.webContents.send('gemini-stream-error', err?.message || 'stream error');
        }
      }
    } else if (cmd.type === 'screenshot') {
      // Stealth screenshot: capture on PC → add to screenshot queue → ack to phone.
      // The image is NOT sent to the phone — it stays on the desktop for AI use.
      // The phone simply acts as a remote shutter button.
      try {
        await appState.takeScreenshot(false);
        PhoneMirrorService.getInstance().publishAck(
          'screenshot',
          'Screenshot captured — queued for AI',
        );
      } catch (e: any) {
        console.error('[PhoneMirror] phone screenshot request failed:', e);
        PhoneMirrorService.getInstance().publishAck('screenshot', 'Screenshot failed');
      }
    }
  });
}
