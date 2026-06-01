// electron/llm/index.ts
// Central export for all LLM modules

export { AnswerLLM } from "./AnswerLLM";
export { AssistLLM } from "./AssistLLM";
export { BrainstormLLM } from "./BrainstormLLM";
export { ClarifyLLM } from "./ClarifyLLM";
export { CodeHintLLM } from "./CodeHintLLM";
export { FollowUpLLM } from "./FollowUpLLM";
export { FollowUpQuestionsLLM } from "./FollowUpQuestionsLLM";
export { RecapLLM } from "./RecapLLM";
export { WhatToAnswerLLM } from "./WhatToAnswerLLM";
export { clampResponse, validateResponse } from "./postProcessor";
export {
    cleanTranscript,
    sparsifyTranscript,
    formatTranscriptForLLM,
    prepareTranscriptForWhatToAnswer
} from "./transcriptCleaner";
export type { TranscriptTurn } from "./transcriptCleaner";
export { extractLatestQuestion, toCandidateFraming } from "./transcriptQuestionExtractor";
export type { ExtractedQuestion, ExtractedQuestionType, DetectedSpeaker } from "./transcriptQuestionExtractor";
export {
    buildTemporalContext,
    formatTemporalContextForPrompt
} from "./TemporalContextBuilder";
export type { TemporalContext, AssistantResponse } from "./TemporalContextBuilder";
export {
    classifyIntent,
    getAnswerShapeGuidance,
    warmupIntentClassifier
} from "./IntentClassifier";
export type { ConversationIntent, IntentResult } from "./IntentClassifier";
export { planNextAssistantAction } from "./PlannerDecision";
export type { PlannerDecision, PlannerDecisionKind, PlannerInput } from "./PlannerDecision";
export { routeLLMProviders } from "./ProviderRouter";
export type { LLMProviderId, ProviderAttempt, ProviderAttemptStatus, ProviderAvailabilityState, ProviderCapability, ProviderModelState, ProviderRouteOptions, ProviderUnavailableReason } from "./ProviderRouter";
export { MODE_CONFIGS } from "./types";
export type { GenerationConfig, GeminiContent, LLMClient } from "./types";
export {
    HARD_SYSTEM_PROMPT,
    ANSWER_MODE_PROMPT,
    ASSIST_MODE_PROMPT,
    FOLLOWUP_MODE_PROMPT,
    WHAT_TO_ANSWER_PROMPT,
    GROQ_TITLE_PROMPT,
    GROQ_SUMMARY_JSON_PROMPT,
    FOLLOWUP_EMAIL_PROMPT,
    GROQ_FOLLOWUP_EMAIL_PROMPT,
    CODE_HINT_PROMPT,
    buildCodeHintMessage,
    BRAINSTORM_MODE_PROMPT
} from "./prompts";
export {
    TINY_CORE,
    TINY_SYSTEM_PROMPT,
    TINY_ANSWER_PROMPT,
    TINY_WHAT_TO_ANSWER_PROMPT,
    TINY_ASSIST_PROMPT,
    TINY_RECAP_PROMPT,
    TINY_FOLLOWUP_PROMPT,
    TINY_FOLLOW_UP_QUESTIONS_PROMPT,
    TINY_BRAINSTORM_PROMPT,
    TINY_CLARIFY_PROMPT,
    TINY_CODE_HINT_PROMPT,
    TINY_TITLE_PROMPT,
    TINY_SUMMARY_JSON_PROMPT,
    TINY_FOLLOWUP_EMAIL_PROMPT,
    TINY_MODE_GENERAL_PROMPT,
    TINY_MODE_LOOKING_FOR_WORK_PROMPT,
    TINY_MODE_SALES_PROMPT,
    TINY_MODE_RECRUITING_PROMPT,
    TINY_MODE_TEAM_MEET_PROMPT,
    TINY_MODE_LECTURE_PROMPT,
    TINY_MODE_TECHNICAL_INTERVIEW_PROMPT,
    TINY_PROMPTS_SET
} from "./tinyPrompts";
export {
    getModelCapabilities,
    selectPromptTier,
    estimateTokens,
    truncateTranscriptToFit,
    parseOllamaSize
} from "./modelCapabilities";
export type { ModelCapabilities, ModelTier, PromptTier } from "./modelCapabilities";
