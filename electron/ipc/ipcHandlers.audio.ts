/**
 * Audio/STT handlers extracted from ipcHandlers.ts.
 * Handles recognition languages, STT settings.
 */

import { safeHandle } from './safeHandle';
import { AppState } from '../main';
import { RECOGNITION_LANGUAGES, AI_RESPONSE_LANGUAGES } from '../config/languages';
import { CredentialsManager } from '../services/CredentialsManager';

export function registerAudioHandlers(appState: AppState): void {
  safeHandle("get-recognition-languages", async () => {
    return RECOGNITION_LANGUAGES;
  });

  safeHandle("get-ai-response-languages", async () => {
    return AI_RESPONSE_LANGUAGES;
  });

  safeHandle("set-ai-response-language", async (_, language: string) => {
    if (!language || typeof language !== 'string' || !language.trim()) {
      console.warn('[IPC] set-ai-response-language: invalid or empty language received, ignoring.');
      return { success: false, error: 'Invalid language value' };
    }
    const sanitizedLanguage = language.trim();
    CredentialsManager.getInstance().setAiResponseLanguage(sanitizedLanguage);
    const llmHelper = appState.processingHelper?.getLLMHelper?.();
    if (llmHelper) {
      llmHelper.setAiResponseLanguage(sanitizedLanguage);
      console.log(`[IPC] AI response language updated to: ${sanitizedLanguage}`);
    } else {
      console.warn('[IPC] set-ai-response-language: processingHelper or LLMHelper not ready, language saved to disk only.');
    }
    return { success: true };
  });

  safeHandle("get-stt-language", async () => {
    return CredentialsManager.getInstance().getSttLanguage();
  });

  safeHandle("get-ai-response-language", async () => {
    return CredentialsManager.getInstance().getAiResponseLanguage();
  });
}