import { GoogleGenAI } from "@google/genai"
import Groq from "groq-sdk"
import OpenAI from "openai"
import Anthropic from "@anthropic-ai/sdk"
import fs from "fs"
import sharp from "sharp"
import {
  HARD_SYSTEM_PROMPT, GROQ_SYSTEM_PROMPT, OPENAI_SYSTEM_PROMPT, CLAUDE_SYSTEM_PROMPT,
  UNIVERSAL_SYSTEM_PROMPT, UNIVERSAL_ANSWER_PROMPT, UNIVERSAL_WHAT_TO_ANSWER_PROMPT,
  UNIVERSAL_RECAP_PROMPT, UNIVERSAL_FOLLOWUP_PROMPT, UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT, UNIVERSAL_ASSIST_PROMPT,
  CUSTOM_SYSTEM_PROMPT, CUSTOM_ANSWER_PROMPT, CUSTOM_WHAT_TO_ANSWER_PROMPT,
  CUSTOM_RECAP_PROMPT, CUSTOM_FOLLOWUP_PROMPT, CUSTOM_FOLLOW_UP_QUESTIONS_PROMPT, CUSTOM_ASSIST_PROMPT
} from "./llm/prompts"
import { deepVariableReplacer, getByPath } from './utils/curlUtils';
import curl2Json from "@bany/curl-to-json";
import { CustomProvider, CurlProvider } from './services/CredentialsManager';
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import { createProviderRateLimiters, RateLimiter } from './services/RateLimiter';
const execAsync = promisify(exec);

interface OllamaResponse {
  response: string
  done: boolean
}

// Model constant for Gemini 3 Flash
const GEMINI_FLASH_MODEL = "gemini-3-flash-preview"
const GEMINI_PRO_MODEL = "gemini-3-pro-preview"
const GROQ_MODEL = "llama-3.3-70b-versatile"
const OPENAI_MODEL = "gpt-5.2-chat-latest"
const CLAUDE_MODEL = "claude-sonnet-4-5"
const MAX_OUTPUT_TOKENS = 65536
const CLAUDE_MAX_OUTPUT_TOKENS = 64000

// Simple prompt for image analysis (not interview copilot - kept separate)
const IMAGE_ANALYSIS_PROMPT = `Analyze concisely. Be direct. No markdown formatting. Return plain text only.`

export class LLMHelper {
  private client: GoogleGenAI | null = null
  private groqClient: Groq | null = null
  private openaiClient: OpenAI | null = null
  private claudeClient: Anthropic | null = null
  private apiKey: string | null = null
  private groqApiKey: string | null = null
  private openaiApiKey: string | null = null
  private claudeApiKey: string | null = null
  private useOllama: boolean = false
  private ollamaModel: string = "llama3.2"
  private ollamaUrl: string = "http://localhost:11434"
  private ollamaStartedByApp: boolean = false;
  private geminiModel: string = GEMINI_FLASH_MODEL
  private customProvider: CustomProvider | null = null;
  private activeCurlProvider: CurlProvider | null = null;
  private groqFastTextMode: boolean = false;
  private knowledgeOrchestrator: any = null;
  private aiResponseLanguage: string = 'English';
  private sttLanguage: string = 'english-us';

  // Rate limiters per provider to prevent 429 errors on free tiers
  private rateLimiters: ReturnType<typeof createProviderRateLimiters>;

  constructor(apiKey?: string, useOllama: boolean = false, ollamaModel?: string, ollamaUrl?: string, groqApiKey?: string, openaiApiKey?: string, claudeApiKey?: string) {
    this.useOllama = useOllama

    // Initialize rate limiters
    this.rateLimiters = createProviderRateLimiters();

    // Initialize Groq client if API key provided
    if (groqApiKey) {
      this.groqApiKey = groqApiKey
      this.groqClient = new Groq({ apiKey: groqApiKey })
      console.log(`[LLMHelper] Groq client initialized with model: ${GROQ_MODEL}`)
    }

    // Initialize OpenAI client if API key provided
    if (openaiApiKey) {
      this.openaiApiKey = openaiApiKey
      this.openaiClient = new OpenAI({ apiKey: openaiApiKey })
      console.log(`[LLMHelper] OpenAI client initialized with model: ${OPENAI_MODEL}`)
    }

    // Initialize Claude client if API key provided
    if (claudeApiKey) {
      this.claudeApiKey = claudeApiKey
      this.claudeClient = new Anthropic({ apiKey: claudeApiKey })
      console.log(`[LLMHelper] Claude client initialized with model: ${CLAUDE_MODEL}`)
    }

    if (useOllama) {
      this.ollamaUrl = ollamaUrl || "http://localhost:11434"
      this.ollamaModel = ollamaModel || "gemma:latest" // Default fallback
      // console.log(`[LLMHelper] Using Ollama with model: ${this.ollamaModel}`)

      // Auto-detect and use first available model if specified model doesn't exist
      this.initializeOllamaModel()
    } else if (apiKey) {
      this.apiKey = apiKey
      // Initialize with v1alpha API version for Gemini 3 support
      this.client = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: { apiVersion: "v1alpha" }
      })
      // console.log(`[LLMHelper] Using Google Gemini 3 with model: ${this.geminiModel} (v1alpha API)`)
    } else {
      console.warn("[LLMHelper] No API key provided. Client will be uninitialized until key is set.")
    }
  }

  public setApiKey(apiKey: string) {
    this.apiKey = apiKey;
    this.client = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: { apiVersion: "v1alpha" }
    })
    console.log("[LLMHelper] Gemini API Key updated.");
  }

  public setGroqApiKey(apiKey: string) {
    this.groqClient = new Groq({ apiKey });
    console.log("[LLMHelper] Groq API Key updated.");
  }

  public setOpenaiApiKey(apiKey: string) {
    this.openaiApiKey = apiKey;
    this.openaiClient = new OpenAI({ apiKey });
    console.log("[LLMHelper] OpenAI API Key updated.");
  }

  public setClaudeApiKey(apiKey: string) {
    this.claudeApiKey = apiKey;
    this.claudeClient = new Anthropic({ apiKey });
    console.log("[LLMHelper] Claude API Key updated.");
  }

  /**
   * Scrub all API keys from memory to minimize exposure window.
   * Called on app quit.
   */
  public scrubKeys(): void {
    this.apiKey = null;
    this.groqApiKey = null;
    this.openaiApiKey = null;
    this.claudeApiKey = null;
    this.client = null;
    this.groqClient = null;
    this.openaiClient = null;
    this.claudeClient = null;
    // Destroy rate limiters
    if (this.rateLimiters) {
      Object.values(this.rateLimiters).forEach(rl => rl.destroy());
    }
    console.log('[LLMHelper] Keys scrubbed from memory');
  }

  public setGroqFastTextMode(enabled: boolean) {
    this.groqFastTextMode = enabled;
    console.log(`[LLMHelper] Groq Fast Text Mode: ${enabled}`);
  }

  public getGroqFastTextMode(): boolean {
    return this.groqFastTextMode;
  }

  public getAiResponseLanguage(): string {
    return this.aiResponseLanguage;
  }

  // --- Model Type Checkers ---
  private isOpenAiModel(modelId: string): boolean {
    return modelId.startsWith("gpt-") || modelId.startsWith("o1-") || modelId.startsWith("o3-") || modelId.includes("openai");
  }

  private isClaudeModel(modelId: string): boolean {
    return modelId.startsWith("claude-");
  }

  private isGroqModel(modelId: string): boolean {
    return modelId.startsWith("llama-") || modelId.startsWith("mixtral-") || modelId.startsWith("gemma-");
  }

  private isGeminiModel(modelId: string): boolean {
    return modelId.startsWith("gemini-") || modelId.startsWith("models/");
  }
  // ---------------------------

  private currentModelId: string = GEMINI_FLASH_MODEL;

  public setModel(modelId: string, customProviders: (CustomProvider | CurlProvider)[] = []) {
    // Map UI short codes to internal Model IDs
    let targetModelId = modelId;
    if (modelId === 'gemini') targetModelId = GEMINI_FLASH_MODEL;
    if (modelId === 'gemini-pro') targetModelId = GEMINI_PRO_MODEL;
    if (modelId === 'gpt-4o') targetModelId = OPENAI_MODEL;
    if (modelId === 'claude') targetModelId = CLAUDE_MODEL;
    if (modelId === 'llama') targetModelId = GROQ_MODEL;

    if (targetModelId.startsWith('ollama-')) {
      this.useOllama = true;
      this.ollamaModel = targetModelId.replace('ollama-', '');
      this.customProvider = null;
      this.activeCurlProvider = null;
      console.log(`[LLMHelper] Switched to Ollama: ${this.ollamaModel}`);
      return;
    }

    const custom = customProviders.find(p => p.id === targetModelId);
    if (custom) {
      this.useOllama = false;
      this.customProvider = null;
      // Treat text-only custom providers as CurlProviders (responsePath optional)
      this.activeCurlProvider = custom as CurlProvider;
      console.log(`[LLMHelper] Switched to cURL Provider: ${custom.name}`);
      return;
    }

    // Standard Cloud Models
    this.useOllama = false;
    this.customProvider = null;
    this.currentModelId = targetModelId;

    // Update specific model props if needed
    if (targetModelId === GEMINI_PRO_MODEL) this.geminiModel = GEMINI_PRO_MODEL;
    if (targetModelId === GEMINI_FLASH_MODEL) this.geminiModel = GEMINI_FLASH_MODEL;

    console.log(`[LLMHelper] Switched to Cloud Model: ${targetModelId}`);
  }

  public switchToCurl(provider: CurlProvider) {
    this.useOllama = false;
    this.customProvider = null;
    this.activeCurlProvider = provider;
    console.log(`[LLMHelper] Switched to cURL provider: ${provider.name}`);
  }

  private cleanJsonResponse(text: string): string {
    // Remove markdown code block syntax if present
    text = text.replace(/^```(?:json)?\n/, '').replace(/\n```$/, '');
    // Remove any leading/trailing whitespace
    text = text.trim();
    return text;
  }

  private async callOllama(prompt: string): Promise<string> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.7,
            top_p: 0.9,
          }
        }),
      })

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
      }

      const data: OllamaResponse = await response.json()
      return data.response
    } catch (error: any) {
      // console.error("[LLMHelper] Error calling Ollama:", error)
      throw new Error(`Failed to connect to Ollama: ${error.message}. Make sure Ollama is running on ${this.ollamaUrl}`)
    }
  }

  private async checkOllamaAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`)
      return response.ok
    } catch {
      return false
    }
  }

  private async initializeOllamaModel(): Promise<void> {
    try {
      const availableModels = await this.getOllamaModels()
      if (availableModels.length === 0) {
        // console.warn("[LLMHelper] No Ollama models found")
        return
      }

      // Check if current model exists, if not use the first available
      if (!availableModels.includes(this.ollamaModel)) {
        this.ollamaModel = availableModels[0]
        // console.log(`[LLMHelper] Auto-selected first available model: ${this.ollamaModel}`)
      }

      // Test the selected model works
      await this.callOllama("Hello")
      // console.log(`[LLMHelper] Successfully initialized with model: ${this.ollamaModel}`)
    } catch (error: any) {
      // console.error(`[LLMHelper] Failed to initialize Ollama model: ${error.message}`)
      // Try to use first available model as fallback
      try {
        const models = await this.getOllamaModels()
        if (models.length > 0) {
          this.ollamaModel = models[0]
          // console.log(`[LLMHelper] Fallback to: ${this.ollamaModel}`)
        }
      } catch (fallbackError: any) {
        // console.error(`[LLMHelper] Fallback also failed: ${fallbackError.message}`)
      }
    }
  }

  /**
   * Generate content using Gemini 3 Flash (text reasoning)
   * Used by IntelligenceManager for mode-specific prompts
   * NOTE: Migrated from Pro to Flash for consistency
   */
  public async generateWithPro(contents: any[]): Promise<string> {
    if (!this.client) throw new Error("Gemini client not initialized")

    await this.rateLimiters.gemini.acquire();
    // console.log(`[LLMHelper] Calling ${GEMINI_FLASH_MODEL}...`)
    const response = await this.client.models.generateContent({
      model: GEMINI_PRO_MODEL,
      contents: contents,
      config: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.3,      // Lower = faster, more focused
      }
    })
    return response.text || ""
  }

  /**
   * Generate content using Gemini 3 Flash (audio + fast multimodal)
   * CRITICAL: Audio input MUST use this model, not Pro
   */
  public async generateWithFlash(contents: any[]): Promise<string> {
    if (!this.client) throw new Error("Gemini client not initialized")

    await this.rateLimiters.gemini.acquire();
    // console.log(`[LLMHelper] Calling ${GEMINI_FLASH_MODEL}...`)
    const response = await this.client.models.generateContent({
      model: GEMINI_FLASH_MODEL,
      contents: contents,
      config: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.3,      // Lower = faster, more focused
      }
    })
    return response.text || ""
  }

  /**
   * Post-process the response
   * NOTE: Truncation/clamping removed - response length is handled in prompts
   */
  private processResponse(text: string): string {
    // Basic cleaning
    let clean = this.cleanJsonResponse(text);

    // Truncation/clamping removed - prompts already handle response length
    // clean = clampResponse(clean, 3, 60);

    // Filter out fallback phrases
    const fallbackPhrases = [
      "I'm not sure",
      "It depends",
      "I can't answer",
      "I don't know"
    ];

    if (fallbackPhrases.some(phrase => clean.toLowerCase().includes(phrase.toLowerCase()))) {
      throw new Error("Filtered fallback response");
    }

    return clean;
  }

  /**
   * Retry logic with exponential backoff
   * Specifically handles 503 Service Unavailable
   */
  private async withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    let delay = 400;
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (e: any) {
        // Only retry on 503 or overload errors
        if (!e.message?.includes("503") && !e.message?.includes("overloaded")) throw e;

        console.warn(`[LLMHelper] 503 Overload. Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      }
    }
    throw new Error("Model busy, try again");
  }

  /**
   * Generate content using the currently selected model
   */
  private async generateContent(contents: any[]): Promise<string> {
    if (!this.client) throw new Error("Gemini client not initialized")

    console.log(`[LLMHelper] Calling ${this.geminiModel}...`)

    return this.withRetry(async () => {
      // @ts-ignore
      const response = await this.client!.models.generateContent({
        model: this.geminiModel,
        contents: contents,
        config: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          temperature: 0.4,
        }
      });

      // Debug: log full response structure
      // console.log(`[LLMHelper] Full response:`, JSON.stringify(response, null, 2).substring(0, 500))

      const candidate = response.candidates?.[0];
      if (!candidate) {
        console.error("[LLMHelper] No candidates returned!");
        console.error("[LLMHelper] Full response:", JSON.stringify(response, null, 2).substring(0, 1000));
        return "";
      }

      if (candidate.finishReason && candidate.finishReason !== "STOP") {
        console.warn(`[LLMHelper] Generation stopped with reason: ${candidate.finishReason}`);
        console.warn(`[LLMHelper] Safety ratings:`, JSON.stringify(candidate.safetyRatings));
      }

      // Try multiple ways to access text - handle different response structures
      let text = "";

      // Method 1: Direct response.text
      if (response.text) {
        text = response.text;
      }
      // Method 2: candidate.content.parts array (check all parts)
      else if (candidate.content?.parts) {
        const parts = Array.isArray(candidate.content.parts) ? candidate.content.parts : [candidate.content.parts];
        for (const part of parts) {
          if (part?.text) {
            text += part.text;
          }
        }
      }
      // Method 3: candidate.content directly (if it's a string)
      else if (typeof candidate.content === 'string') {
        text = candidate.content;
      }

      if (!text || text.trim().length === 0) {
        console.error("[LLMHelper] Candidate found but text is empty.");
        console.error("[LLMHelper] Response structure:", JSON.stringify({
          hasResponseText: !!response.text,
          candidateFinishReason: candidate.finishReason,
          candidateContent: candidate.content,
          candidateParts: candidate.content?.parts,
        }, null, 2));

        if (candidate.finishReason === "MAX_TOKENS") {
          return "Response was truncated due to length limit. Please try a shorter question or break it into parts.";
        }

        return "";
      }

      console.log(`[LLMHelper] Extracted text length: ${text.length}`);
      return text;
    });
  }

  public async extractProblemFromImages(imagePaths: string[]) {
    try {
      // Build content parts with images
      const parts: any[] = []

      for (const imagePath of imagePaths) {
        const imageData = await fs.promises.readFile(imagePath)
        parts.push({
          inlineData: {
            data: imageData.toString("base64"),
            mimeType: "image/png"
          }
        })
      }

      const prompt = `${IMAGE_ANALYSIS_PROMPT}\n\nYou are a wingman. Please analyze these images and extract the following information in JSON format:\n{
  "problem_statement": "A clear statement of the problem or situation depicted in the images.",
  "context": "Relevant background or context from the images.",
  "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
  "reasoning": "Explanation of why these suggestions are appropriate."
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

      parts.push({ text: prompt })

      // Use Flash for multimodal (images)
      const text = await this.generateWithFlash(parts)
      return JSON.parse(this.cleanJsonResponse(text))
    } catch (error) {
      // console.error("Error extracting problem from images:", error)
      throw error
    }
  }

  public async generateSolution(problemInfo: any) {
    const prompt = `${IMAGE_ANALYSIS_PROMPT}\n\nGiven this problem or situation:\n${JSON.stringify(problemInfo, null, 2)}\n\nPlease provide your response in the following JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

    // console.log("[LLMHelper] Calling Gemini LLM for solution...");
    try {
      // Use Flash as default (Pro is experimental)
      const text = await this.generateWithFlash([{ text: prompt }])
      // console.log("[LLMHelper] Gemini LLM returned result.");
      const parsed = JSON.parse(this.cleanJsonResponse(text))
      // console.log("[LLMHelper] Parsed LLM response:", parsed)
      return parsed
    } catch (error) {
      // console.error("[LLMHelper] Error in generateSolution:", error);
      throw error;
    }
  }

  public async debugSolutionWithImages(problemInfo: any, currentCode: string, debugImagePaths: string[]) {
    try {
      const parts: any[] = []

      for (const imagePath of debugImagePaths) {
        const imageData = await fs.promises.readFile(imagePath)
        parts.push({
          inlineData: {
            data: imageData.toString("base64"),
            mimeType: "image/png"
          }
        })
      }

      const prompt = `${IMAGE_ANALYSIS_PROMPT}\n\nYou are a wingman. Given:\n1. The original problem or situation: ${JSON.stringify(problemInfo, null, 2)}\n2. The current response or approach: ${currentCode}\n3. The debug information in the provided images\n\nPlease analyze the debug information and provide feedback in this JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

      parts.push({ text: prompt })

      // Use Flash for multimodal (images)
      const text = await this.generateWithFlash(parts)
      const parsed = JSON.parse(this.cleanJsonResponse(text))
      // console.log("[LLMHelper] Parsed debug LLM response:", parsed)
      return parsed
    } catch (error) {
      // console.error("Error debugging solution with images:", error)
      throw error
    }
  }





  /**
   * NEW: Helper to process image: resize to max 1536px and compress to JPEG 80%
   * drastically reduces token usage and upload time.
   */
  private async processImage(path: string): Promise<{ mimeType: string, data: string }> {
    try {
      const imageBuffer = await fs.promises.readFile(path);

      // Resize and compress
      const processedBuffer = await sharp(imageBuffer)
        .resize({
          width: 1536,
          height: 1536,
          fit: 'inside', // Maintain aspect ratio, max dimension 1536
          withoutEnlargement: true
        })
        .jpeg({ quality: 80 }) // 80% quality JPEG is much smaller than PNG
        .toBuffer();

      return {
        mimeType: "image/jpeg",
        data: processedBuffer.toString("base64")
      };
    } catch (error) {
      console.error("[LLMHelper] Failed to process image with sharp:", error);
      // Fallback to raw read if sharp fails
      const data = await fs.promises.readFile(path);
      return {
        mimeType: "image/png",
        data: data.toString("base64")
      };
    }
  }

  public async analyzeImageFiles(imagePaths: string[]) {
    try {
      // Build prompt
      const prompt = `${HARD_SYSTEM_PROMPT}\n\nDescribe the content of ${imagePaths.length > 1 ? 'these images' : 'this image'} in a short, concise answer. If it contains code or a problem, solve it.`;

      const contents: any[] = [
        { role: "user", parts: [{ text: prompt }] },
      ];

      // Add all images as inline data parts
      const imageParts: any[] = [];
      for (const p of imagePaths) {
        if (fs.existsSync(p)) {
          const { mimeType, data } = await this.processImage(p);
          imageParts.push({ inlineData: { mimeType, data } });
        }
      }

      if (imageParts.length > 0) {
        contents.push({ role: "user", parts: imageParts });
      }

      // Use Flash for multimodal
      const text = await this.generateWithFlash(contents);

      return { text: text, timestamp: Date.now() };

    } catch (error: any) {
      console.error("Error analyzing image files:", error);
      return {
        text: `I couldn't analyze the screen right now (${error.message}). Please try again.`,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Generate a suggestion based on conversation transcript - Natively-style
   * This uses Gemini Flash to reason about what the user should say
   * @param context - The full conversation transcript
   * @param lastQuestion - The most recent question from the interviewer
   * @returns Suggested response for the user
   */
  public async generateSuggestion(context: string, lastQuestion: string): Promise<string> {
    const systemPrompt = `You are an expert interview coach. Based on the conversation transcript, provide a concise, natural response the user could say.

RULES:
- Be direct and conversational
- Keep responses under 3 sentences unless complexity requires more  
- Focus on answering the specific question asked
- If it's a technical question, provide a clear, structured answer
- Do NOT preface with "You could say" or similar - just give the answer directly
- If unsure, answer briefly and confidently anyway.
- Never hedge.
- Never say "it depends".

CONVERSATION SO FAR:
${context}

LATEST QUESTION FROM INTERVIEWER:
${lastQuestion}

ANSWER DIRECTLY:`;

    try {
      if (this.useOllama) {
        return await this.callOllama(systemPrompt);
      } else if (this.client) {
        // Use Flash model as default (Pro is experimental)
        // Wraps generateWithFlash logic but with retry
        const text = await this.generateWithFlash([{ text: systemPrompt }]);
        return this.processResponse(text);
      } else {
        throw new Error("No LLM provider configured");
      }
    } catch (error) {
      //   console.error("[LLMHelper] Error generating suggestion:", error);
      // Silence error
      throw error;
    }
  }

  public setKnowledgeOrchestrator(orchestrator: any): void {
    this.knowledgeOrchestrator = orchestrator;
    console.log('[LLMHelper] KnowledgeOrchestrator attached');
  }

  public getKnowledgeOrchestrator(): any {
    return this.knowledgeOrchestrator;
  }

  public setAiResponseLanguage(language: string) {
    this.aiResponseLanguage = language;
    console.log(`[LLMHelper] AI Response Language set to: ${language}`);
  }

  public setSttLanguage(language: string) {
    this.sttLanguage = language;
    console.log(`[LLMHelper] STT Language set to: ${language}`);
  }

  /**
   * Helper to inject language instruction into system prompt
   */
  private injectLanguageInstruction(systemPrompt: string): string {
    return `${systemPrompt}\n\nCRITICAL: You MUST respond ONLY in ${this.aiResponseLanguage}. This is an absolute requirement. All generated text that the user should say must be in ${this.aiResponseLanguage}.`;
  }

  public async chatWithGemini(message: string, imagePaths?: string[], context?: string, skipSystemPrompt: boolean = false, alternateGroqMessage?: string): Promise<string> {
    try {
      console.log(`[LLMHelper] chatWithGemini called with message:`, message.substring(0, 50))

      // ============================================================
      // KNOWLEDGE MODE INTERCEPT
      // If knowledge mode is active, check for intro questions and
      // inject system prompt + relevant context
      // ============================================================
      if (this.knowledgeOrchestrator?.isKnowledgeMode()) {
        try {
          // Feed the interviewer's utterance to the Technical Depth Scorer
          // so tone adapts dynamically (HR buzzwords → high-level, technical terms → deep technical)
          this.knowledgeOrchestrator.feedInterviewerUtterance(message);

          const knowledgeResult = await this.knowledgeOrchestrator.processQuestion(message);
          if (knowledgeResult) {
            // Intro question shortcut — return generated response directly
            if (knowledgeResult.isIntroQuestion && knowledgeResult.introResponse) {
              console.log('[LLMHelper] Knowledge mode: returning generated intro response');
              return knowledgeResult.introResponse;
            }
            // Inject knowledge system prompt and context
            if (!skipSystemPrompt && knowledgeResult.systemPromptInjection) {
              skipSystemPrompt = false; // ensure we use the knowledge prompt
              // Prepend knowledge context to existing context
              if (knowledgeResult.contextBlock) {
                context = context
                  ? `${knowledgeResult.contextBlock}\n\n${context}`
                  : knowledgeResult.contextBlock;
              }
            }
          }
        } catch (knowledgeError: any) {
          console.warn('[LLMHelper] Knowledge mode processing failed, falling back to normal:', knowledgeError.message);
        }
      }

      const isMultimodal = !!(imagePaths?.length);

      // Helper to build combined prompts for Groq/Gemini
      const buildMessage = (systemPrompt: string) => {
        if (skipSystemPrompt) {
          return context
            ? `CONTEXT:\n${context}\n\nUSER QUESTION:\n${message}`
            : message;
        }
        return context
          ? `${systemPrompt}\n\nCONTEXT:\n${context}\n\nUSER QUESTION:\n${message}`
          : `${systemPrompt}\n\n${message}`;
      };

      // For OpenAI/Claude: separate system prompt + user message
      const userContent = context
        ? `CONTEXT:\n${context}\n\nUSER QUESTION:\n${message}`
        : message;

      const finalGeminiPrompt = this.injectLanguageInstruction(HARD_SYSTEM_PROMPT);
      const finalGroqPrompt = alternateGroqMessage || this.injectLanguageInstruction(GROQ_SYSTEM_PROMPT);

      const combinedMessages = {
        gemini: buildMessage(finalGeminiPrompt),
        groq: buildMessage(finalGroqPrompt),
      };

      // GROQ FAST TEXT OVERRIDE (Text-Only)
      if (this.groqFastTextMode && !isMultimodal && this.groqClient) {
        console.log(`[LLMHelper] ⚡️ Groq Fast Text Mode Active. Routing to Groq...`);
        try {
          return await this.generateWithGroq(combinedMessages.groq);
        } catch (e: any) {
          console.warn("[LLMHelper] Groq Fast Text failed, falling back to standard routing:", e.message);
          // Fall through to standard routing
        }
      }

      // System prompts for OpenAI/Claude (skipped if skipSystemPrompt)
      const openaiSystemPrompt = skipSystemPrompt ? undefined : this.injectLanguageInstruction(OPENAI_SYSTEM_PROMPT);
      const claudeSystemPrompt = skipSystemPrompt ? undefined : this.injectLanguageInstruction(CLAUDE_SYSTEM_PROMPT);

      if (this.useOllama) {
        return await this.callOllama(combinedMessages.gemini);
      }

      if (this.activeCurlProvider) {
        return await this.chatWithCurl(message, skipSystemPrompt ? undefined : CUSTOM_SYSTEM_PROMPT);
      }

      if (this.customProvider) {
        console.log(`[LLMHelper] Using Custom Provider: ${this.customProvider.name}`);
        // For non-streaming call — use rich CUSTOM prompts since custom providers can be cloud models
        const response = await this.executeCustomProvider(
          this.customProvider.curlCommand,
          combinedMessages.gemini,
          skipSystemPrompt ? "" : CUSTOM_SYSTEM_PROMPT,
          message,
          context || "",
          imagePaths?.[0]
        );
        return this.processResponse(response);
      }

      // --- Direct Routing based on Selected Model ---
      if (this.isOpenAiModel(this.currentModelId) && this.openaiClient) {
        return await this.generateWithOpenai(userContent, openaiSystemPrompt, imagePaths);
      }
      if (this.isClaudeModel(this.currentModelId) && this.claudeClient) {
        return await this.generateWithClaude(userContent, claudeSystemPrompt, imagePaths);
      }
      if (this.isGroqModel(this.currentModelId) && this.groqClient && !isMultimodal) {
        return await this.generateWithGroq(combinedMessages.groq);
      }

      // Fallback (Gemini) - logic handled below by SMART DYNAMIC FALLBACK list

      // ============================================================
      // SMART DYNAMIC FALLBACK (Non-Streaming)
      // Multimodal: Gemini Flash → OpenAI → Claude → Gemini Pro (Groq excluded)
      // Text-only:  Gemini Flash → Gemini Pro → Groq → OpenAI → Claude
      // OpenAI/Claude use proper system+user message separation
      // ============================================================
      type ProviderAttempt = { name: string; execute: () => Promise<string> };
      const providers: ProviderAttempt[] = [];

      if (isMultimodal) {
        // MULTIMODAL: Only vision-capable providers (NO Groq)
        if (this.client) {
          providers.push({ name: `Gemini Flash`, execute: () => this.tryGenerateResponse(combinedMessages.gemini, imagePaths) });
        }
        if (this.openaiClient) {
          providers.push({ name: `OpenAI (${OPENAI_MODEL})`, execute: () => this.generateWithOpenai(userContent, openaiSystemPrompt, imagePaths) });
        }
        if (this.claudeClient) {
          providers.push({ name: `Claude (${CLAUDE_MODEL})`, execute: () => this.generateWithClaude(userContent, claudeSystemPrompt, imagePaths) });
        }
        if (this.client) {
          providers.push({
            name: `Gemini Pro`,
            execute: async () => {
              const orig = this.geminiModel;
              this.geminiModel = GEMINI_PRO_MODEL;
              try {
                const r = await this.tryGenerateResponse(combinedMessages.gemini, imagePaths);
                this.geminiModel = orig;
                return r;
              } catch (e) {
                this.geminiModel = orig;
                throw e;
              }
            }
          });
        }
      } else {
        // TEXT-ONLY: All providers including Groq
        if (this.groqClient) {
          providers.push({ name: `Groq (${GROQ_MODEL})`, execute: () => this.generateWithGroq(combinedMessages.groq) });
        }
        if (this.client) {
          providers.push({ name: `Gemini Flash`, execute: () => this.tryGenerateResponse(combinedMessages.gemini) });
          providers.push({
            name: `Gemini Pro`,
            execute: async () => {
              const orig = this.geminiModel;
              this.geminiModel = GEMINI_PRO_MODEL;
              try {
                const r = await this.tryGenerateResponse(combinedMessages.gemini);
                this.geminiModel = orig;
                return r;
              } catch (e) {
                this.geminiModel = orig;
                throw e;
              }
            }
          });
        }
        if (this.openaiClient) {
          providers.push({ name: `OpenAI (${OPENAI_MODEL})`, execute: () => this.generateWithOpenai(userContent, openaiSystemPrompt) });
        }
        if (this.claudeClient) {
          providers.push({ name: `Claude (${CLAUDE_MODEL})`, execute: () => this.generateWithClaude(userContent, claudeSystemPrompt) });
        }
      }

      if (providers.length === 0) {
        return "No AI providers configured. Please add at least one API key in Settings.";
      }

      // ============================================================
      // RELENTLESS RETRY: Try all providers, then retry entire chain
      // with exponential backoff. Max 2 full rotations.
      // ============================================================
      const MAX_FULL_ROTATIONS = 3;

      for (let rotation = 0; rotation < MAX_FULL_ROTATIONS; rotation++) {
        if (rotation > 0) {
          const backoffMs = 1000 * rotation;
          console.log(`[LLMHelper] 🔄 Non-streaming rotation ${rotation + 1}/${MAX_FULL_ROTATIONS} after ${backoffMs}ms backoff...`);
          await this.delay(backoffMs);
        }

        for (const provider of providers) {
          try {
            console.log(`[LLMHelper] ${rotation === 0 ? '🚀' : '🔁'} Attempting ${provider.name}...`);
            const rawResponse = await provider.execute();
            if (rawResponse && rawResponse.trim().length > 0) {
              console.log(`[LLMHelper] ✅ ${provider.name} succeeded`);
              return this.processResponse(rawResponse);
            }
            console.warn(`[LLMHelper] ⚠️ ${provider.name} returned empty response`);
          } catch (error: any) {
            console.warn(`[LLMHelper] ⚠️ ${provider.name} failed: ${error.message}`);
          }
        }
      }

      // All exhausted
      console.error("[LLMHelper] ❌ All non-streaming providers exhausted");
      return "I apologize, but I couldn't generate a response. Please try again.";

    } catch (error: any) {
      console.error("[LLMHelper] Critical Error in chatWithGemini:", error);

      if (error.message.includes("503") || error.message.includes("overloaded")) {
        return "The AI service is currently overloaded. Please try again in a moment.";
      }
      if (error.message.includes("API key")) {
        return "Authentication failed. Please check your API key in settings.";
      }
      return `I encountered an error: ${error.message || "Unknown error"}. Please try again.`;
    }
  }

  /**
   * Generate content using only reasoning-capable models.
   * Priority: OpenAI → Claude → Gemini Pro → Groq (last resort).
   * Used for structured JSON output tasks (resume/JD/company research).
   * NOTE: Does NOT mutate this.geminiModel — calls Gemini Pro directly to avoid race conditions.
   */
  public async generateContentStructured(message: string): Promise<string> {
    type ProviderAttempt = { name: string; execute: () => Promise<string> };
    const providers: ProviderAttempt[] = [];

    // Priority 1: OpenAI
    if (this.openaiClient) {
      providers.push({ name: `OpenAI (${OPENAI_MODEL})`, execute: () => this.generateWithOpenai(message) });
    }

    // Priority 2: Claude
    if (this.claudeClient) {
      providers.push({ name: `Claude (${CLAUDE_MODEL})`, execute: () => this.generateWithClaude(message) });
    }

    // Priority 3: Gemini Pro (Skip Flash, and don't mutate this.geminiModel to avoid race conditions)
    if (this.client) {
      providers.push({
        name: `Gemini Pro (${GEMINI_PRO_MODEL})`,
        execute: async () => {
          // Call the API directly with the Pro model instead of touching shared state
          const response = await this.withRetry(async () => {
            // @ts-ignore
            const res = await this.client!.models.generateContent({
              model: GEMINI_PRO_MODEL,
              contents: [{ role: 'user', parts: [{ text: message }] }],
              config: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.4 }
            });
            const candidate = res.candidates?.[0];
            if (!candidate) return '';
            if (res.text) return res.text;
            const parts = candidate.content?.parts ?? [];
            return (Array.isArray(parts) ? parts : [parts]).map((p: any) => p?.text ?? '').join('');
          });
          return response;
        }
      });
    }

    // Priority 4: Groq (Fallback despite JSON hallucination risks)
    if (this.groqClient) {
      providers.push({ name: `Groq (${GROQ_MODEL}) fallback`, execute: () => this.generateWithGroq(message) });
    }

    if (providers.length === 0) {
      throw new Error('No reasoning model available. Please configure an OpenAI, Claude, Gemini, or Groq API key.');
    }

    for (const provider of providers) {
      try {
        console.log(`[LLMHelper] 🧠 Structured generation: trying ${provider.name}...`);
        const result = await provider.execute();
        if (result && result.trim().length > 0) {
          console.log(`[LLMHelper] ✅ Structured generation succeeded with ${provider.name}`);
          return result;
        }
        console.warn(`[LLMHelper] ⚠️ ${provider.name} returned empty response`);
      } catch (error: any) {
        console.warn(`[LLMHelper] ⚠️ Structured generation: ${provider.name} failed: ${error.message}`);
      }
    }

    throw new Error('All reasoning models failed for structured generation');
  }

  private async generateWithGroq(fullMessage: string): Promise<string> {
    if (!this.groqClient) throw new Error("Groq client not initialized");

    await this.rateLimiters.groq.acquire();

    // Non-streaming Groq call
    const response = await this.groqClient.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: "user", content: fullMessage }],
      temperature: 0.4,
      max_tokens: 32768,
      stream: false
    });

    return response.choices[0]?.message?.content || "";
  }

  /**
   * Non-streaming OpenAI generation with proper system/user separation
   */
  private async generateWithOpenai(userMessage: string, systemPrompt?: string, imagePaths?: string[]): Promise<string> {
    if (!this.openaiClient) throw new Error("OpenAI client not initialized");

    await this.rateLimiters.openai.acquire();

    const messages: any[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }

    if (imagePaths?.length) {
      const contentParts: any[] = [{ type: "text", text: userMessage }];
      for (const p of imagePaths) {
        if (fs.existsSync(p)) {
          const imageData = await fs.promises.readFile(p);
          contentParts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${imageData.toString("base64")}` } });
        }
      }
      messages.push({ role: "user", content: contentParts });
    } else {
      messages.push({ role: "user", content: userMessage });
    }

    const response = await this.openaiClient.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      max_completion_tokens: MAX_OUTPUT_TOKENS,
    });

    return response.choices[0]?.message?.content || "";
  }

  // The handler for cURL requests
  public async chatWithCurl(userMessage: string, systemPrompt?: string): Promise<string> {
    if (!this.activeCurlProvider) throw new Error("No cURL provider active");

    const { curlCommand, responsePath } = this.activeCurlProvider;

    // 1. Parse cURL to config object
    // @ts-ignore
    const curlConfig = curl2Json(curlCommand);

    // 2. Prepare Variables
    // We combine System Prompt + User Message into {{TEXT}} for simplicity in raw mode, 
    // or you can support {{SYSTEM}} if you want to get fancy later.
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${userMessage}` : userMessage;

    const variables = {
      TEXT: fullPrompt.replace(/\n/g, "\\n").replace(/"/g, '\\"') // Basic escaping
    };

    // 3. Inject Variables into URL, Headers, and Body
    const url = deepVariableReplacer(curlConfig.url, variables);
    const headers = deepVariableReplacer(curlConfig.header || {}, variables);
    const data = deepVariableReplacer(curlConfig.data || {}, variables);

    // 4. Execute
    try {
      const response = await axios({
        method: curlConfig.method || 'POST',
        url: url,
        headers: headers,
        data: data
      });

      // 5. Extract Answer
      // If user didn't specify a path, try to guess or dump string
      if (!responsePath) return JSON.stringify(response.data);

      const answer = getByPath(response.data, responsePath);

      if (typeof answer === 'string') return answer;
      return JSON.stringify(answer); // Fallback if they pointed to an object

    } catch (error: any) {
      console.error("[LLMHelper] cURL Execution Error:", error.message);
      return `Error: ${error.message}`;
    }
  }

  /**
   * Non-streaming Claude generation with proper system/user separation
   */
  private async generateWithClaude(userMessage: string, systemPrompt?: string, imagePaths?: string[]): Promise<string> {
    if (!this.claudeClient) throw new Error("Claude client not initialized");

    await this.rateLimiters.claude.acquire();

    const content: any[] = [];
    if (imagePaths?.length) {
      for (const p of imagePaths) {
        if (fs.existsSync(p)) {
          const imageData = await fs.promises.readFile(p);
          content.push({
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: imageData.toString("base64")
            }
          });
        }
      }
    }
    content.push({ type: "text", text: userMessage });

    const response = await this.claudeClient.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_OUTPUT_TOKENS,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: "user", content }],
    });

    const textBlock = response.content.find((block: any) => block.type === 'text') as any;
    return textBlock?.text || "";
  }

  /**
   * Executes a custom cURL provider defined by the user
   */
  public async executeCustomProvider(
    curlCommand: string,
    combinedMessage: string,
    systemPrompt: string,
    rawUserMessage: string,
    context: string,
    imagePath?: string
  ): Promise<string> {

    // 1. Parse cURL to JSON object
    const requestConfig = curl2Json(curlCommand);

    // 2. Prepare Image (if any)
    let base64Image = "";
    if (imagePath) {
      try {
        const imageData = await fs.promises.readFile(imagePath);
        base64Image = imageData.toString("base64");
      } catch (e) {
        console.warn("Failed to read image for Custom Provider:", e);
      }
    }

    // 3. Prepare Variables
    const variables = {
      TEXT: combinedMessage,             // Deprecated but kept for compat: System + Context + User
      PROMPT: combinedMessage,           // Alias for TEXT
      SYSTEM_PROMPT: systemPrompt,       // Raw System Prompt
      USER_MESSAGE: rawUserMessage,      // Raw User Message
      CONTEXT: context,                  // Raw Context
      IMAGE_BASE64: base64Image,         // Base64 encoded image string
    };

    // 4. Inject Variables into URL, Headers, and Body
    const url = deepVariableReplacer(requestConfig.url, variables);
    const headers = deepVariableReplacer(requestConfig.header || {}, variables);
    const body = deepVariableReplacer(requestConfig.data || {}, variables);

    // 5. Execute Fetch
    try {
      const response = await fetch(url, {
        method: requestConfig.method || 'POST',
        headers: headers,
        body: JSON.stringify(body)
      });

      const data = await response.json();
      console.log(`[LLMHelper] Custom Provider raw response:`, JSON.stringify(data).substring(0, 1000));

      if (!response.ok) {
        throw new Error(`Custom Provider HTTP ${response.status}: ${JSON.stringify(data).substring(0, 200)}`);
      }

      // 6. Extract Answer - try common response formats
      const extracted = this.extractFromCommonFormats(data);
      console.log(`[LLMHelper] Custom Provider extracted text length: ${extracted.length}`);
      return extracted;
    } catch (error) {
      console.error("Custom Provider Error:", error);
      throw error;
    }
  }

  /**
   * Try to extract text content from common LLM API response formats.
   * Supports: Ollama, OpenAI, Anthropic, and generic formats.
   */
  private extractFromCommonFormats(data: any): string {
    if (!data || typeof data === 'string') return data || "";

    // Ollama format: { response: "..." }
    if (typeof data.response === 'string') return data.response;

    // OpenAI format: { choices: [{ message: { content: "..." } }] }
    if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;

    // OpenAI delta/streaming format: { choices: [{ delta: { content: "..." } }] }
    if (data.choices?.[0]?.delta?.content) return data.choices[0].delta.content;

    // Anthropic format: { content: [{ text: "..." }] }
    if (Array.isArray(data.content) && data.content[0]?.text) return data.content[0].text;

    // Generic text field
    if (typeof data.text === 'string') return data.text;

    // Generic output field
    if (typeof data.output === 'string') return data.output;

    // Generic result field
    if (typeof data.result === 'string') return data.result;

    // Fallback: stringify the whole response
    console.warn("[LLMHelper] Could not extract text from custom provider response, returning raw JSON");
    return JSON.stringify(data);
  }

  /**
   * Map UNIVERSAL (local model) prompts to richer CUSTOM prompts.
   * Custom providers can be any cloud model, so they get detailed prompts.
   */
  private mapToCustomPrompt(prompt: string): string {
    // Map from concise UNIVERSAL to rich CUSTOM equivalents
    if (prompt === UNIVERSAL_SYSTEM_PROMPT || prompt === HARD_SYSTEM_PROMPT) return CUSTOM_SYSTEM_PROMPT;
    if (prompt === UNIVERSAL_ANSWER_PROMPT) return CUSTOM_ANSWER_PROMPT;
    if (prompt === UNIVERSAL_WHAT_TO_ANSWER_PROMPT) return CUSTOM_WHAT_TO_ANSWER_PROMPT;
    if (prompt === UNIVERSAL_RECAP_PROMPT) return CUSTOM_RECAP_PROMPT;
    if (prompt === UNIVERSAL_FOLLOWUP_PROMPT) return CUSTOM_FOLLOWUP_PROMPT;
    if (prompt === UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT) return CUSTOM_FOLLOW_UP_QUESTIONS_PROMPT;
    if (prompt === UNIVERSAL_ASSIST_PROMPT) return CUSTOM_ASSIST_PROMPT;
    // If it's already a different override (e.g. user-supplied), pass through
    return prompt;
  }

  private async tryGenerateResponse(fullMessage: string, imagePaths?: string[]): Promise<string> {
    let rawResponse: string;

    if (imagePaths?.length) {
      const contents: any[] = [{ text: fullMessage }];
      for (const p of imagePaths) {
        if (fs.existsSync(p)) {
          const imageData = await fs.promises.readFile(p);
          contents.push({
            inlineData: {
              mimeType: "image/png",
              data: imageData.toString("base64")
            }
          });
        }
      }

      // Use current model for multimodal (allows Pro fallback)
      if (this.client) {
        rawResponse = await this.generateContent(contents);
      } else {
        throw new Error("No LLM provider configured");
      }
    } else {
      // Text-only chat
      if (this.useOllama) {
        rawResponse = await this.callOllama(fullMessage);
      } else if (this.client) {
        rawResponse = await this.generateContent([{ text: fullMessage }])
      } else {
        throw new Error("No LLM provider configured");
      }
    }

    return rawResponse || "";
  }



  /**
   * Stream chat response with Groq-first fallback chain for text-only,
   * and Gemini-only for multimodal (images)
   * 
   * TEXT-ONLY FALLBACK CHAIN:
   * 1. Groq (llama-3.3-70b-versatile) - Primary
   * 2. Gemini Flash - 1st fallback
   * 3. Gemini Flash + Pro parallel - 2nd fallback
   * 4. Gemini Flash retries (max 3) - Last resort
   * 
   * MULTIMODAL: Gemini-only (existing logic)
   */
  public async * streamChatWithGemini(message: string, imagePaths?: string[], context?: string, skipSystemPrompt: boolean = false): AsyncGenerator<string, void, unknown> {
    console.log(`[LLMHelper] streamChatWithGemini called with message:`, message.substring(0, 50));

    const isMultimodal = !!(imagePaths?.length);

    // Build single-string messages for Groq/Gemini (which use combined prompts)
    const buildCombinedMessage = (systemPrompt: string) => {
      const finalPrompt = skipSystemPrompt ? systemPrompt : this.injectLanguageInstruction(systemPrompt);
      if (skipSystemPrompt) {
        return context
          ? `CONTEXT:\n${context}\n\nUSER QUESTION:\n${message}`
          : message;
      }
      return context
        ? `${finalPrompt}\n\nCONTEXT:\n${context}\n\nUSER QUESTION:\n${message}`
        : `${finalPrompt}\n\n${message}`;
    };

    // For OpenAI/Claude: separate system prompt + user message (proper API pattern)
    const userContent = context
      ? `CONTEXT:\n${context}\n\nUSER QUESTION:\n${message}`
      : message;

    const combinedMessages = {
      gemini: buildCombinedMessage(HARD_SYSTEM_PROMPT),
      groq: buildCombinedMessage(GROQ_SYSTEM_PROMPT),
    };

    if (this.useOllama) {
      const response = await this.callOllama(combinedMessages.gemini);
      yield response;
      return;
    }

    // ============================================================
    // SMART DYNAMIC FALLBACK: Build provider list based on what's configured
    // Multimodal requests EXCLUDE Groq (no vision support)
    // Text-only requests can use ALL providers
    // OpenAI/Claude use proper system+user message separation for quality
    // ============================================================
    type ProviderAttempt = { name: string; execute: () => AsyncGenerator<string, void, unknown> };
    const providers: ProviderAttempt[] = [];

    // System prompts for OpenAI/Claude (skipped if skipSystemPrompt)
    const openaiSystemPrompt = skipSystemPrompt ? undefined : this.injectLanguageInstruction(OPENAI_SYSTEM_PROMPT);
    const claudeSystemPrompt = skipSystemPrompt ? undefined : this.injectLanguageInstruction(CLAUDE_SYSTEM_PROMPT);

    if (isMultimodal) {
      // MULTIMODAL PROVIDER ORDER: Gemini Flash → OpenAI → Claude → Gemini Pro
      // Groq does NOT support vision
      if (this.client) {
        providers.push({ name: `Gemini Flash (${GEMINI_FLASH_MODEL})`, execute: () => this.streamWithGeminiModel(combinedMessages.gemini, GEMINI_FLASH_MODEL, imagePaths) });
      }
      if (this.openaiClient) {
        providers.push({ name: `OpenAI (${OPENAI_MODEL})`, execute: () => this.streamWithOpenaiMultimodal(userContent, imagePaths!, openaiSystemPrompt) });
      }
      if (this.claudeClient) {
        providers.push({ name: `Claude (${CLAUDE_MODEL})`, execute: () => this.streamWithClaudeMultimodal(userContent, imagePaths!, claudeSystemPrompt) });
      }
      if (this.client) {
        providers.push({ name: `Gemini Pro (${GEMINI_PRO_MODEL})`, execute: () => this.streamWithGeminiModel(combinedMessages.gemini, GEMINI_PRO_MODEL, imagePaths) });
      }
    } else {
      // TEXT-ONLY PROVIDER ORDER: Groq → OpenAI → Claude → Gemini Flash → Gemini Pro
      if (this.groqClient) {
        providers.push({ name: `Groq (${GROQ_MODEL})`, execute: () => this.streamWithGroq(combinedMessages.groq) });
      }
      if (this.openaiClient) {
        providers.push({ name: `OpenAI (${OPENAI_MODEL})`, execute: () => this.streamWithOpenai(userContent, openaiSystemPrompt) });
      }
      if (this.claudeClient) {
        providers.push({ name: `Claude (${CLAUDE_MODEL})`, execute: () => this.streamWithClaude(userContent, claudeSystemPrompt) });
      }
      if (this.client) {
        providers.push({ name: `Gemini Flash (${GEMINI_FLASH_MODEL})`, execute: () => this.streamWithGeminiModel(combinedMessages.gemini, GEMINI_FLASH_MODEL) });
        providers.push({ name: `Gemini Pro (${GEMINI_PRO_MODEL})`, execute: () => this.streamWithGeminiModel(combinedMessages.gemini, GEMINI_PRO_MODEL) });
      }
    }

    if (providers.length === 0) {
      yield "No AI providers configured. Please add at least one API key in Settings.";
      return;
    }

    // ============================================================
    // RELENTLESS RETRY: Try all providers, then retry entire chain
    // with exponential backoff. Max 2 full rotations.
    // ============================================================
    const MAX_FULL_ROTATIONS = 3;

    for (let rotation = 0; rotation < MAX_FULL_ROTATIONS; rotation++) {
      if (rotation > 0) {
        const backoffMs = 1000 * rotation;
        console.log(`[LLMHelper] 🔄 Starting rotation ${rotation + 1}/${MAX_FULL_ROTATIONS} after ${backoffMs}ms backoff...`);
        await this.delay(backoffMs);
      }

      for (let i = 0; i < providers.length; i++) {
        const provider = providers[i];
        try {
          console.log(`[LLMHelper] ${rotation === 0 ? '🚀' : '🔁'} Attempting ${provider.name}...`);
          yield* provider.execute();
          console.log(`[LLMHelper] ✅ ${provider.name} stream completed successfully`);
          return; // SUCCESS — exit immediately
        } catch (err: any) {
          console.warn(`[LLMHelper] ⚠️ ${provider.name} failed: ${err.message}`);
          // Continue to next provider
        }
      }
    }

    // Truly exhausted after all rotations
    console.error(`[LLMHelper] ❌ All providers exhausted after ${MAX_FULL_ROTATIONS} rotations`);
    yield "All AI services are currently unavailable. Please check your API keys and try again.";
  }

  /**
   * Universal Stream Chat - Routes to correct provider based on currentModelId
   */
  public async * streamChat(
    message: string,
    imagePaths?: string[],
    context?: string,
    systemPromptOverride?: string // Optional override (defaults to HARD_SYSTEM_PROMPT)
  ): AsyncGenerator<string, void, unknown> {

    // ============================================================
    // KNOWLEDGE MODE INTERCEPT (Streaming)
    // ============================================================
    if (this.knowledgeOrchestrator?.isKnowledgeMode()) {
      try {
        const knowledgeResult = await this.knowledgeOrchestrator.processQuestion(message);
        if (knowledgeResult) {
          // Intro question shortcut — yield generated response directly
          if (knowledgeResult.isIntroQuestion && knowledgeResult.introResponse) {
            console.log('[LLMHelper] Knowledge mode (stream): returning generated intro response');
            yield knowledgeResult.introResponse;
            return;
          }
          // Inject knowledge system prompt
          if (knowledgeResult.systemPromptInjection) {
            systemPromptOverride = knowledgeResult.systemPromptInjection;
          }
          // Inject knowledge context
          if (knowledgeResult.contextBlock) {
            context = context
              ? `${knowledgeResult.contextBlock}\n\n${context}`
              : knowledgeResult.contextBlock;
          }
        }
      } catch (knowledgeError: any) {
        console.warn('[LLMHelper] Knowledge mode (stream) processing failed, falling back:', knowledgeError.message);
      }
    }

    // Preparation
    const isMultimodal = !!(imagePaths?.length);

    // Determine the system prompt to use
    // logic: if override provided, use it. otherwise use HARD_SYSTEM_PROMPT (which is the universal base)
    const baseSystemPrompt = systemPromptOverride || HARD_SYSTEM_PROMPT;
    const finalSystemPrompt = this.injectLanguageInstruction(baseSystemPrompt);

    // Helper to build combined user message
    const userContent = context
      ? `CONTEXT:\n${context}\n\nUSER QUESTION:\n${message}`
      : message;

    // GROQ FAST TEXT OVERRIDE (Text-Only)
    if (this.groqFastTextMode && !isMultimodal && this.groqClient) {
      console.log(`[LLMHelper] ⚡️ Groq Fast Text Mode Active (Streaming). Routing to Groq...`);
      try {
        const groqSystem = systemPromptOverride || GROQ_SYSTEM_PROMPT;
        const finalGroqSystem = this.injectLanguageInstruction(groqSystem);
        const groqFullMessage = `${finalGroqSystem}\n\n${userContent}`;
        yield* this.streamWithGroq(groqFullMessage);
        return;
      } catch (e: any) {
        console.warn("[LLMHelper] Groq Fast Text streaming failed, falling back:", e.message);
        // Fall through
      }
    }

    // 1. Ollama Streaming
    if (this.useOllama) {
      yield* this.streamWithOllama(message, context, finalSystemPrompt);
      return;
    }

    // 2. Custom Provider Streaming (via cURL - Non-streaming fallback for now)
    if (this.activeCurlProvider) {
      const response = await this.executeCustomProvider(
        this.activeCurlProvider.curlCommand,
        userContent,
        finalSystemPrompt,
        message,
        context || "",
        imagePaths?.[0]
      );
      yield response;
      return;
    }

    // 3. Cloud Provider Routing

    // OpenAI
    if (this.isOpenAiModel(this.currentModelId) && this.openaiClient) {
      const openAiSystem = systemPromptOverride || OPENAI_SYSTEM_PROMPT;
      const finalOpenAiSystem = this.injectLanguageInstruction(openAiSystem);
      if (isMultimodal && imagePaths) {
        yield* this.streamWithOpenaiMultimodal(userContent, imagePaths, finalOpenAiSystem);
      } else {
        yield* this.streamWithOpenai(userContent, finalOpenAiSystem);
      }
      return;
    }

    // Claude
    if (this.isClaudeModel(this.currentModelId) && this.claudeClient) {
      const claudeSystem = systemPromptOverride || CLAUDE_SYSTEM_PROMPT;
      const finalClaudeSystem = this.injectLanguageInstruction(claudeSystem);
      if (isMultimodal && imagePaths) {
        yield* this.streamWithClaudeMultimodal(userContent, imagePaths, finalClaudeSystem);
      } else {
        yield* this.streamWithClaude(userContent, finalClaudeSystem);
      }
      return;
    }

    // Groq (Text Only)
    if (this.isGroqModel(this.currentModelId) && this.groqClient && !isMultimodal) {
      // Build Groq message
      const groqSystem = systemPromptOverride ? baseSystemPrompt : GROQ_SYSTEM_PROMPT;
      const finalGroqSystem = this.injectLanguageInstruction(groqSystem);
      const groqFullMessage = `${finalGroqSystem}\n\n${userContent}`;
      yield* this.streamWithGroq(groqFullMessage);
      return;
    }

    // 4. Gemini Routing & Fallback
    if (this.client) {
      // Direct model use if specified
      if (this.isGeminiModel(this.currentModelId)) {
        const fullMsg = `${finalSystemPrompt}\n\n${userContent}`;
        yield* this.streamWithGeminiModel(fullMsg, this.currentModelId, imagePaths);
        return;
      }

      // Race strategy (default)
      const raceMsg = `${finalSystemPrompt}\n\n${userContent}`;
      yield* this.streamWithGeminiParallelRace(raceMsg, imagePaths);
    } else {
      throw new Error("No LLM provider available");
    }
  }

  /**
   * Stream response from Groq
   */
  private async * streamWithGroq(fullMessage: string): AsyncGenerator<string, void, unknown> {
    if (!this.groqClient) throw new Error("Groq client not initialized");

    const stream = await this.groqClient.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: "user", content: fullMessage }],
      stream: true,
      temperature: 0.4,
      max_tokens: 32768,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  /**
   * Stream response from OpenAI with proper system/user message separation
   */
  private async * streamWithOpenai(userMessage: string, systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    if (!this.openaiClient) throw new Error("OpenAI client not initialized");

    const messages: any[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: userMessage });

    const stream = await this.openaiClient.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      stream: true,
      max_completion_tokens: MAX_OUTPUT_TOKENS,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  /**
   * Stream response from Claude with proper system/user message separation
   */
  private async * streamWithClaude(userMessage: string, systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    if (!this.claudeClient) throw new Error("Claude client not initialized");

    const stream = await this.claudeClient.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_OUTPUT_TOKENS,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: "user", content: userMessage }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }

  /**
   * Stream multimodal (image + text) response from OpenAI with system/user separation
   */
  private async * streamWithOpenaiMultimodal(userMessage: string, imagePaths: string[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    if (!this.openaiClient) throw new Error("OpenAI client not initialized");

    const messages: any[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }

    const contentParts: any[] = [{ type: "text", text: userMessage }];
    for (const p of imagePaths) {
      if (fs.existsSync(p)) {
        const imageData = await fs.promises.readFile(p);
        contentParts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${imageData.toString("base64")}` } });
      }
    }
    messages.push({ role: "user", content: contentParts });

    const stream = await this.openaiClient.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      stream: true,
      max_completion_tokens: MAX_OUTPUT_TOKENS,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  /**
   * Stream multimodal (image + text) response from Claude with system/user separation
   */
  private async * streamWithClaudeMultimodal(userMessage: string, imagePaths: string[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    if (!this.claudeClient) throw new Error("Claude client not initialized");

    const imageContentParts: any[] = [];
    for (const p of imagePaths) {
      if (fs.existsSync(p)) {
        const imageData = await fs.promises.readFile(p);
        imageContentParts.push({
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: imageData.toString("base64")
          }
        });
      }
    }

    const stream = await this.claudeClient.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_OUTPUT_TOKENS,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{
        role: "user",
        content: [
          ...imageContentParts,
          { type: "text", text: userMessage }
        ]
      }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }

  /**
   * Stream response from a specific Gemini model
   */
  private async * streamWithGeminiModel(fullMessage: string, model: string, imagePaths?: string[]): AsyncGenerator<string, void, unknown> {
    if (!this.client) throw new Error("Gemini client not initialized");

    const contents: any[] = [{ text: fullMessage }];
    if (imagePaths?.length) {
      for (const p of imagePaths) {
        if (fs.existsSync(p)) {
          const imageData = await fs.promises.readFile(p);
          contents.push({
            inlineData: {
              mimeType: "image/png",
              data: imageData.toString("base64")
            }
          });
        }
      }
    }

    const streamResult = await this.client.models.generateContentStream({
      model: model,
      contents: contents,
      config: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.4,
      }
    });

    // @ts-ignore
    const stream = streamResult.stream || streamResult;

    for await (const chunk of stream) {
      let chunkText = "";
      if (typeof chunk.text === 'function') {
        chunkText = chunk.text();
      } else if (typeof chunk.text === 'string') {
        chunkText = chunk.text;
      } else if (chunk.candidates?.[0]?.content?.parts?.[0]?.text) {
        chunkText = chunk.candidates[0].content.parts[0].text;
      }
      if (chunkText) {
        yield chunkText;
      }
    }
  }

  /**
   * Race Flash and Pro streams, return whichever succeeds first
   */
  private async * streamWithGeminiParallelRace(fullMessage: string, imagePaths?: string[]): AsyncGenerator<string, void, unknown> {
    if (!this.client) throw new Error("Gemini client not initialized");

    // Start both streams
    const flashPromise = this.collectStreamResponse(fullMessage, GEMINI_FLASH_MODEL, imagePaths);
    const proPromise = this.collectStreamResponse(fullMessage, GEMINI_PRO_MODEL, imagePaths);

    // Race - whoever finishes first wins
    const result = await Promise.any([flashPromise, proPromise]);

    // Yield the collected response character by character to simulate streaming
    // (Or yield in chunks for efficiency)
    const chunkSize = 10;
    for (let i = 0; i < result.length; i += chunkSize) {
      yield result.substring(i, i + chunkSize);
    }
  }

  /**
   * Collect full response from a Gemini model (non-streaming for race)
   */
  private async collectStreamResponse(fullMessage: string, model: string, imagePaths?: string[]): Promise<string> {
    if (!this.client) throw new Error("Gemini client not initialized");

    const contents: any[] = [{ text: fullMessage }];
    if (imagePaths?.length) {
      for (const p of imagePaths) {
        if (fs.existsSync(p)) {
          const imageData = await fs.promises.readFile(p);
          contents.push({
            inlineData: {
              mimeType: "image/png",
              data: imageData.toString("base64")
            }
          });
        }
      }
    }

    const response = await this.client.models.generateContent({
      model: model,
      contents: contents,
      config: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.4,
      }
    });

    return response.text || "";
  }

  // --- OLLAMA STREAMING ---
  private async * streamWithOllama(message: string, context?: string, systemPrompt: string = UNIVERSAL_SYSTEM_PROMPT): AsyncGenerator<string, void, unknown> {
    const fullPrompt = context
      ? `SYSTEM: ${systemPrompt}\nCONTEXT: ${context}\nUSER: ${message}`
      : `SYSTEM: ${systemPrompt}\nUSER: ${message}`;

    try {
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt: fullPrompt,
          stream: true,
          options: { temperature: 0.7 }
        })
      });

      if (!response.body) throw new Error("No response body from Ollama");

      // iterate over the readable stream
      // @ts-ignore
      for await (const chunk of response.body) {
        const text = new TextDecoder().decode(chunk);
        // Ollama sends JSON objects per line
        const lines = text.split('\n').filter(l => l.trim());
        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            if (json.response) yield json.response;
            if (json.done) return;
          } catch (e) {
            // ignore partial json
          }
        }
      }
    } catch (e) {
      console.error("Ollama streaming failed", e);
      yield "Error: Failed to stream from Ollama.";
    }
  }

  // --- CUSTOM PROVIDER STREAMING ---
  private async * streamWithCustom(message: string, context?: string, imagePaths?: string[], systemPrompt: string = UNIVERSAL_SYSTEM_PROMPT): AsyncGenerator<string, void, unknown> {
    if (!this.customProvider) return;
    // We reuse the executeCustomProvider logic but we need it to stream.
    // If the user provided a curl command, it might support streaming (SSE) or not.
    // If we execute it via Child Process, we can read stdout stream.

    // 1. Prepare command with variables
    // Re-use logic from executeCustomProvider to replace variables
    // But we can't easily reuse the function since it awaits the whole fetch.
    // So we'll implement a simplified streaming version using our existing variable replacer and node-fetch.

    const curlCommand = this.customProvider.curlCommand;
    const requestConfig = curl2Json(curlCommand);

    let base64Image = "";
    if (imagePaths?.length) {
      try {
        // Use the first image for custom providers (they typically only support one)
        const data = await fs.promises.readFile(imagePaths[0]);
        base64Image = data.toString("base64");
      } catch (e) { }
    }

    const combinedMessage = context ? `${context}\n\n${message}` : message;

    const variables = {
      TEXT: combinedMessage,
      PROMPT: combinedMessage,
      SYSTEM_PROMPT: systemPrompt,
      USER_MESSAGE: message,
      CONTEXT: context || "",
      IMAGE_BASE64: base64Image,
    };

    const url = deepVariableReplacer(requestConfig.url, variables);
    const headers = deepVariableReplacer(requestConfig.header || {}, variables);
    const body = deepVariableReplacer(requestConfig.data || {}, variables);

    try {
      const response = await fetch(url, {
        method: requestConfig.method || 'POST',
        headers: headers,
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Custom Provider HTTP ${response.status}: ${errorText.substring(0, 200)}`);
        yield `Error: Custom Provider returned HTTP ${response.status}`;
        return;
      }

      if (!response.body) return;

      // Collect all chunks to handle both SSE streaming and non-SSE JSON responses
      let fullBody = "";
      let yieldedAny = false;

      // @ts-ignore
      for await (const chunk of response.body) {
        const text = new TextDecoder().decode(chunk);
        fullBody += text;

        const lines = text.split('\n');
        for (const line of lines) {
          if (line.trim().length === 0) continue;

          const items = this.parseStreamLine(line);
          if (items) {
            yield items;
            yieldedAny = true;
          }
        }
      }

      // If no SSE content was yielded, try parsing the full body as JSON
      // This handles non-streaming responses (e.g. Ollama with stream: false)
      if (!yieldedAny && fullBody.trim().length > 0) {
        try {
          const data = JSON.parse(fullBody);
          const extracted = this.extractFromCommonFormats(data);
          if (extracted) yield extracted;
        } catch {
          // Not JSON, yield raw text if it's not looking like garbage
          if (fullBody.length < 5000) yield fullBody.trim();
        }
      }

    } catch (e) {
      console.error("Custom streaming failed", e);
      yield "Error streaming from custom provider.";
    }
  }

  private parseStreamLine(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    // 1. Handle SSE (data: ...)
    if (trimmed.startsWith("data: ")) {
      if (trimmed === "data: [DONE]") return null;
      try {
        const json = JSON.parse(trimmed.substring(6));
        return this.extractFromCommonFormats(json);
      } catch {
        return null;
      }
    }

    // 2. Handle raw JSON chunks (Ollama/Generic)
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const json = JSON.parse(trimmed);
        return this.extractFromCommonFormats(json);
      } catch {
        return null;
      }
    }

    return null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }


  public isUsingOllama(): boolean {
    return this.useOllama;
  }

  public async getOllamaModels(): Promise<string[]> {
    const baseUrl = (this.ollamaUrl || "http://127.0.0.1:11434").replace('localhost', '127.0.0.1');
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1000); // Fast 1s timeout

        const response = await fetch(`${baseUrl}/api/tags`, {
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);

        if (!response.ok) return [];

        const data = await response.json();
        if (data && data.models) {
            return data.models.map((m: any) => m.name);
        }
        
        return [];
    } catch (error: any) {
        // Silently catch connection refused/timeout errors. 
        // OllamaManager handles logging the startup status.
        return [];
    }
  }

  public async forceRestartOllama(): Promise<boolean> {
    try {
      console.log("[LLMHelper] Attempting to force restart Ollama...");

      // 1. Check for process on port 11434
      try {
        const { stdout } = await execAsync(`lsof -t -i:11434`);
        const pid = stdout.trim();
        if (pid) {
          console.log(`[LLMHelper] Found blocking PID: ${pid}. Killing...`);
          await execAsync(`kill -9 ${pid}`);
        }
      } catch (e: any) {
        // lsof returns 1 if no process found, which throws error in execAsync
        // Ignore unless it's a real error
      }

      // 2. Restart Ollama through the Manager (which handles polling and background spawn)
      // We don't want to use exec('ollama serve') here directly anymore to avoid duplicate tracking
      const { OllamaManager } = require('./services/OllamaManager');
      await OllamaManager.getInstance().init();

      return true;
    } catch (error) {
      console.error("[LLMHelper] Failed to restart Ollama:", error);
      return false;
    }
  }

  public getCurrentProvider(): "ollama" | "gemini" | "custom" {
    if (this.customProvider) return "custom";
    return this.useOllama ? "ollama" : "gemini";
  }

  public getCurrentModel(): string {
    if (this.customProvider) return this.customProvider.name;
    if (this.activeCurlProvider) return this.activeCurlProvider.id;
    return this.useOllama ? this.ollamaModel : this.currentModelId;
  }

  /**
   * Get the Gemini client for mode-specific LLMs
   * Used by AnswerLLM, AssistLLM, FollowUpLLM, RecapLLM
   * RETURNS A PROXY client that handles retries and fallbacks transparently
   */
  public getGeminiClient(): GoogleGenAI | null {
    if (!this.client) return null;
    return this.createRobustClient(this.client);
  }

  /**
   * Get the Groq client for mode-specific LLMs
   */
  public getGroqClient(): Groq | null {
    return this.groqClient;
  }

  /**
   * Check if Groq is available
   */
  public hasGroq(): boolean {
    return this.groqClient !== null;
  }

  /**
   * Get the OpenAI client for mode-specific LLMs
   */
  public getOpenaiClient(): OpenAI | null {
    return this.openaiClient;
  }

  /**
   * Get the Claude client for mode-specific LLMs
   */
  public getClaudeClient(): Anthropic | null {
    return this.claudeClient;
  }

  /**
   * Check if OpenAI is available
   */
  public hasOpenai(): boolean {
    return this.openaiClient !== null;
  }

  /**
   * Check if Claude is available
   */
  public hasClaude(): boolean {
    return this.claudeClient !== null;
  }

  /**
   * Stream with Groq using a specific prompt, with Gemini fallback
   * Used by mode-specific LLMs (RecapLLM, FollowUpLLM, WhatToAnswerLLM)
   * @param groqMessage - Message with Groq-optimized prompt
   * @param geminiMessage - Message with Gemini prompt (for fallback)
   * @param config - Optional temperature and max tokens
   */
  public async * streamWithGroqOrGemini(
    groqMessage: string,
    geminiMessage: string,
    config?: { temperature?: number; maxTokens?: number }
  ): AsyncGenerator<string, void, unknown> {
    const temperature = config?.temperature ?? 0.3;
    const maxTokens = config?.maxTokens ?? 8192;

    // Try Groq first if available
    if (this.groqClient) {
      try {
        console.log(`[LLMHelper] 🚀 Mode-specific Groq stream starting...`);
        const stream = await this.groqClient.chat.completions.create({
          model: GROQ_MODEL,
          messages: [{ role: "user", content: groqMessage }],
          stream: true,
          temperature: temperature,
          max_tokens: maxTokens,
        });

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            yield content;
          }
        }
        console.log(`[LLMHelper] ✅ Mode-specific Groq stream completed`);
        return; // Success - done
      } catch (err: any) {
        console.warn(`[LLMHelper] ⚠️ Groq mode-specific failed: ${err.message}, falling back to Gemini`);
      }
    }

    // Fallback to Gemini
    if (this.client) {
      console.log(`[LLMHelper] 🔄 Falling back to Gemini for mode-specific request...`);
      yield* this.streamWithGeminiModel(geminiMessage, GEMINI_FLASH_MODEL);
    } else {
      throw new Error("No LLM provider available");
    }
  }

  /**
   * Creates a proxy around the real Gemini client to intercept generation calls
   * and apply robust retry/fallback logic without modifying consumer code.
   */
  private createRobustClient(realClient: GoogleGenAI): GoogleGenAI {
    // We proxy the 'models' property to intercept 'generateContent'
    const modelsProxy = new Proxy(realClient.models, {
      get: (target, prop, receiver) => {
        if (prop === 'generateContent') {
          return async (args: any) => {
            return this.generateWithFallback(realClient, args);
          };
        }
        return Reflect.get(target, prop, receiver);
      }
    });

    // We proxy the client itself to return our modelsProxy
    return new Proxy(realClient, {
      get: (target, prop, receiver) => {
        if (prop === 'models') {
          return modelsProxy;
        }
        return Reflect.get(target, prop, receiver);
      }
    });
  }

  /**
   * ROBUST GENERATION STRATEGY (SPECULATIVE PARALLEL EXECUTION)
   * 1. Attempt with original model (Flash).
   * 2. If it fails/empties:
   *    - IMMEDIATELY launch two requests in parallel:
   *      a) Retry Flash (Attempt 2)
   *      b) Start Pro (Backup)
   * 3. Return whichever finishes successfully first (prioritizing Flash if both fast).
   * 4. If both fail, try Flash one last time (Attempt 3).
   * 5. If that fails, throw error.
   */
  private async generateWithFallback(client: GoogleGenAI, args: any): Promise<any> {
    const originalModel = args.model;

    // Helper to check for valid content
    const isValidResponse = (response: any) => {
      const candidate = response.candidates?.[0];
      if (!candidate) return false;
      // Check for text content
      if (response.text && response.text.trim().length > 0) return true;
      if (candidate.content?.parts?.[0]?.text && candidate.content.parts[0].text.trim().length > 0) return true;
      if (typeof candidate.content === 'string' && candidate.content.trim().length > 0) return true;
      return false;
    };

    // 1. Initial Attempt (Flash)
    try {
      const response = await client.models.generateContent({
        ...args,
        model: originalModel
      });
      if (isValidResponse(response)) return response;
      console.warn(`[LLMHelper] Initial ${originalModel} call returned empty/invalid response.`);
    } catch (error: any) {
      console.warn(`[LLMHelper] Initial ${originalModel} call failed: ${error.message}`);
    }

    console.log(`[LLMHelper] 🚀 Triggering Speculative Parallel Retry (Flash + Pro)...`);

    // 2. Parallel Execution (Retry Flash vs Pro)
    // We create promises for both but treat them carefully
    const flashRetryPromise = (async () => {
      // Small delay before retry to let system settle? No, user said "immediately"
      try {
        const res = await client.models.generateContent({ ...args, model: originalModel });
        if (isValidResponse(res)) return { type: 'flash', res };
        throw new Error("Empty Flash Response");
      } catch (e) { throw e; }
    })();

    const proBackupPromise = (async () => {
      try {
        // Pro might be slower, but it's the robust backup
        const res = await client.models.generateContent({ ...args, model: GEMINI_PRO_MODEL });
        if (isValidResponse(res)) return { type: 'pro', res };
        throw new Error("Empty Pro Response");
      } catch (e) { throw e; }
    })();

    // 3. Race / Fallback Logic
    try {
      // We want Flash if it succeeds, but will accept Pro if Flash fails
      // If Flash finishes first and success -> return Flash
      // If Pro finishes first -> wait for Flash? Or return Pro?
      // User said: "if the gemini 3 flash again fails the gemini 3 pro response can be immediatly displayed"
      // This implies we prioritize Flash's *result*, but if Flash fails, we want Pro.

      // We use Promise.any to get the first *successful* result
      const winner = await Promise.any([flashRetryPromise, proBackupPromise]);
      console.log(`[LLMHelper] Parallel race won by: ${winner.type}`);
      return winner.res;

    } catch (aggregateError) {
      console.warn(`[LLMHelper] Both parallel retry attempts failed.`);
    }

    // 4. Last Resort: Flash Final Retry
    console.log(`[LLMHelper] ⚠️ All parallel attempts failed. Trying Flash one last time...`);
    try {
      return await client.models.generateContent({ ...args, model: originalModel });
    } catch (finalError) {
      console.error(`[LLMHelper] Final retry failed.`);
      throw finalError;
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
    let timeoutHandle: NodeJS.Timeout;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    return Promise.race([
      promise.then(result => {
        clearTimeout(timeoutHandle);
        return result;
      }),
      timeoutPromise
    ]);
  }

  /**
   * Robust Meeting Summary Generation
   * Strategy:
   * 1. Groq (if context text < 100k tokens approx)
   * 2. Gemini Flash (Retry 2x)
   * 3. Gemini Pro (Retry 5x)
   */
  public async generateMeetingSummary(systemPrompt: string, context: string, groqSystemPrompt?: string): Promise<string> {
    console.log(`[LLMHelper] generateMeetingSummary called. Context length: ${context.length}`);

    // Helper: Estimate tokens (crude approximation: 4 chars = 1 token)
    const estimateTokens = (text: string) => Math.ceil(text.length / 4);
    const tokenCount = estimateTokens(context);
    console.log(`[LLMHelper] Estimated tokens: ${tokenCount}`);

    // ATTEMPT 1: Groq (if text-only and within limits)
    // Groq Llama 3.3 70b has ~128k context, let's be safe with 100k
    if (this.groqClient && tokenCount < 100000) {
      console.log(`[LLMHelper] Attempting Groq for summary...`);
      try {
        const groqPrompt = groqSystemPrompt || systemPrompt;
        // Use non-streaming for summary
        const response = await this.withTimeout(
          this.groqClient.chat.completions.create({
            model: GROQ_MODEL,
            messages: [
              { role: "system", content: groqPrompt },
              { role: "user", content: `Context:\n${context}` }
            ],
            temperature: 0.3,
            max_tokens: 32768,
            stream: false
          }),
          45000,
          "Groq Summary"
        );

        const text = response.choices[0]?.message?.content || "";
        if (text.trim().length > 0) {
          console.log(`[LLMHelper] ✅ Groq summary generated successfully.`);
          return this.processResponse(text);
        }
      } catch (e: any) {
        console.warn(`[LLMHelper] ⚠️ Groq summary failed: ${e.message}. Falling back to Gemini...`);
      }
    } else {
      if (tokenCount >= 100000) {
        console.log(`[LLMHelper] Context too large for Groq (${tokenCount} tokens). Skipping straight to Gemini.`);
      }
    }

    // ATTEMPT 2: Gemini Flash (with 2 retries = 3 attempts total)
    console.log(`[LLMHelper] Attempting Gemini Flash for summary...`);
    const contents = [{ text: `${systemPrompt}\n\nCONTEXT:\n${context}` }];

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const text = await this.withTimeout(
          this.generateWithFlash(contents),
          45000,
          `Gemini Flash Summary (Attempt ${attempt})`
        );
        if (text.trim().length > 0) {
          console.log(`[LLMHelper] ✅ Gemini Flash summary generated successfully (Attempt ${attempt}).`);
          return this.processResponse(text);
        }
      } catch (e: any) {
        console.warn(`[LLMHelper] ⚠️ Gemini Flash attempt ${attempt}/3 failed: ${e.message}`);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1000 * attempt)); // Linear backoff
        }
      }
    }

    // ATTEMPT 3: Gemini Pro (Infinite-ish loop)
    // User requested "call gemini 3 pro until summary is generated"
    // We will cap it at 5 heavily backed-off retries to avoid hanging processes forever,
    // but effectively this acts as a very persistent retry.
    console.log(`[LLMHelper] ⚠️ Flash exhausted. Switching to Gemini Pro for robust retry...`);
    const maxProRetries = 5;

    if (!this.client) throw new Error("Gemini client not initialized");

    for (let attempt = 1; attempt <= maxProRetries; attempt++) {
      try {
        console.log(`[LLMHelper] 🔄 Gemini Pro Attempt ${attempt}/${maxProRetries}...`);
        const response = await this.withTimeout(
          // @ts-ignore
          this.client.models.generateContent({
            model: GEMINI_PRO_MODEL,
            contents: contents,
            config: {
              maxOutputTokens: MAX_OUTPUT_TOKENS,
              temperature: 0.3,
            }
          }),
          60000,
          `Gemini Pro Summary (Attempt ${attempt})`
        );
        const text = response.text || "";

        if (text.trim().length > 0) {
          console.log(`[LLMHelper] ✅ Gemini Pro summary generated successfully.`);
          return this.processResponse(text);
        }
      } catch (e: any) {
        console.warn(`[LLMHelper] ⚠️ Gemini Pro attempt ${attempt} failed: ${e.message}`);
        // Aggressive backoff for Pro: 2s, 4s, 8s, 16s, 32s
        const backoff = 2000 * Math.pow(2, attempt - 1);
        console.log(`[LLMHelper] Waiting ${backoff}ms before next retry...`);
        await new Promise(r => setTimeout(r, backoff));
      }
    }

    throw new Error("Failed to generate summary after all fallback attempts.");
  }

  public async switchToOllama(model?: string, url?: string): Promise<void> {
    this.useOllama = true;
    if (url) this.ollamaUrl = url;

    if (model) {
      this.ollamaModel = model;
    } else {
      // Auto-detect first available model
      await this.initializeOllamaModel();
    }

    // console.log(`[LLMHelper] Switched to Ollama: ${this.ollamaModel} at ${this.ollamaUrl}`);
  }

  public async switchToGemini(apiKey?: string, modelId?: string): Promise<void> {
    if (modelId) {
      this.geminiModel = modelId;
    }

    if (apiKey) {
      this.apiKey = apiKey;
      this.client = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: { apiVersion: "v1alpha" }
      });
    } else if (!this.client) {
      throw new Error("No Gemini API key provided and no existing client");
    }

    this.useOllama = false;
    this.customProvider = null;
    // console.log(`[LLMHelper] Switched to Gemini: ${this.geminiModel}`);
  }

  public async switchToCustom(provider: CustomProvider): Promise<void> {
    this.customProvider = provider;
    this.useOllama = false;
    this.client = null;
    this.groqClient = null;
    this.openaiClient = null;
    this.claudeClient = null;
    console.log(`[LLMHelper] Switched to Custom Provider: ${provider.name}`);
  }

  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.useOllama) {
        const available = await this.checkOllamaAvailable();
        if (!available) {
          return { success: false, error: `Ollama not available at ${this.ollamaUrl}` };
        }
        // Test with a simple prompt
        await this.callOllama("Hello");
        return { success: true };
      } else {
        if (!this.client) {
          return { success: false, error: "No Gemini client configured" };
        }
        // Test with a simple prompt using the selected model
        const text = await this.generateContent([{ text: "Hello" }])
        if (text) {
          return { success: true };
        } else {
          return { success: false, error: "Empty response from Gemini" };
        }
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
  /**
   * Universal Chat (Non-streaming)
   */
  public async chat(message: string, imagePaths?: string[], context?: string, systemPromptOverride?: string): Promise<string> {
    let fullResponse = "";
    for await (const chunk of this.streamChat(message, imagePaths, context, systemPromptOverride)) {
      fullResponse += chunk;
    }
    return fullResponse;
  }

}