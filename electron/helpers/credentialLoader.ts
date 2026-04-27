/**
 * Credential loading logic extracted from ProcessingHelper.
 * Single testable function that can be mocked.
 */

import { LLMHelper } from '../LLMHelper';
import { CredentialsManager } from '../services/CredentialsManager';

/**
 * Loads stored credentials from CredentialsManager into LLMHelper and
 * reinitializes dependent managers (IntelligenceManager, RAGManager).
 *
 * Should be called after app.whenReady() when CredentialsManager is initialized.
 *
 * @param llmHelper - The LLMHelper instance to load credentials into
 * @param appState - AppState instance for accessing IntelligenceManager and RAGManager
 */
export function loadStoredCredentials(
  llmHelper: LLMHelper,
  appState: {
    getIntelligenceManager(): { initializeLLMs(): void };
    getRAGManager(): {
      initializeEmbeddings(keys: { openaiKey?: string; geminiKey?: string }): void;
      retryPendingEmbeddings(): Promise<void>;
      ensureDemoMeetingProcessed(): Promise<void>;
      cleanupStaleQueueItems(): void;
    } | null;
  }
): void {
  const credManager = CredentialsManager.getInstance();

  const geminiKey = credManager.getGeminiApiKey();
  const groqKey = credManager.getGroqApiKey();
  const openaiKey = credManager.getOpenaiApiKey();
  const claudeKey = credManager.getClaudeApiKey();

  if (geminiKey) {
    console.log("[ProcessingHelper] Loading stored Gemini API Key from CredentialsManager");
    llmHelper.setApiKey(geminiKey);
  }

  if (groqKey) {
    console.log("[ProcessingHelper] Loading stored Groq API Key from CredentialsManager");
    llmHelper.setGroqApiKey(groqKey);
  }

  if (openaiKey) {
    console.log("[ProcessingHelper] Loading stored OpenAI API Key from CredentialsManager");
    llmHelper.setOpenaiApiKey(openaiKey);
  }

  if (claudeKey) {
    console.log("[ProcessingHelper] Loading stored Claude API Key from CredentialsManager");
    llmHelper.setClaudeApiKey(claudeKey);
  }

  // CRITICAL: Re-initialize IntelligenceManager now that keys are loaded
  appState.getIntelligenceManager().initializeLLMs();

  // CRITICAL: Initialize RAGManager (Embeddings) with loaded keys
  const ragManager = appState.getRAGManager();
  if (ragManager) {
    console.log("[ProcessingHelper] Initializing RAGManager embeddings with available keys");
    ragManager.initializeEmbeddings({
      openaiKey: openaiKey || undefined,
      geminiKey: geminiKey || undefined,
    });

    // CRITICAL: Retry pending embeddings now that we have a key
    console.log("[ProcessingHelper] Retrying pending embeddings...");
    ragManager.retryPendingEmbeddings().catch(console.error);

    // CRITICAL: Ensure demo meeting has chunks
    ragManager.ensureDemoMeetingProcessed().catch(console.error);

    // CRITICAL: Cleanup stale queue items to prevent "Chunk not found" errors
    ragManager.cleanupStaleQueueItems();
  }

  // Initialize self-improving model version manager (background, non-blocking)
  llmHelper.initModelVersionManager().catch(err => {
    console.warn('[ProcessingHelper] ModelVersionManager initialization failed (non-critical):', err.message);
  });

  // NEW: Load Default Model Config
  const defaultModel = credManager.getDefaultModel();
  if (defaultModel) {
    console.log(`[ProcessingHelper] Loading stored Default Model: ${defaultModel}`);
    const customProviders = credManager.getCustomProviders();
    const curlProviders = credManager.getCurlProviders();
    const allProviders = [...(customProviders || []), ...(curlProviders || [])];
    llmHelper.setModel(defaultModel, allProviders);
  }

  // Load Languages
  const sttLanguage = credManager.getSttLanguage();
  const aiResponseLanguage = credManager.getAiResponseLanguage();

  if (sttLanguage) {
    llmHelper.setSttLanguage(sttLanguage);
  }

  if (aiResponseLanguage) {
    llmHelper.setAiResponseLanguage(aiResponseLanguage);
  }
}
