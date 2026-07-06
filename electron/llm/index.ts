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
export { shouldThrottleTrigger } from "./triggerGate";
export type { TriggerGateInput } from "./triggerGate";
export { clampResponse, validateResponse, reduceDashes, reduceDashesInChunk, StreamingDashReducer } from "./postProcessor";
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
export { planAnswer, formatAnswerPlanForPrompt, isCodingAnswerType, shouldScaffold, isStealthEvasionQuestion } from "./AnswerPlanner";
export { detectAnswerStyle, styleSuppressesScaffold } from "./answerStyle";
export type { AnswerStyle, AnswerStyleResult } from "./answerStyle";
export { detectExplicitCodingContract, isCodingContinuation, buildPriorCodingContextBlock, buildCodingContractPrompt, explicitContractProducesCode } from "./codingFollowup";
export type { ExplicitCodingContract, PriorCodingTurn } from "./codingFollowup";
export { shouldHumanize, shouldHumanizeOutput, detectCorporateFiller, humanizeDirectiveFor, HUMANIZE_DIRECTIVE, humanizeSpokenAnswer, humanizeForAnswerType } from "./humanLikeness";
export type { CorporateFillerVerdict } from "./humanLikeness";
export {
  countSpokenWordsExcludingCode, estimateSpeakSeconds, decideSpeakability,
  trimToSpeakable, applySpeakabilityBudget, compressTechnicalConcept,
  classifySpeakability, classifyTargetSpeakability,
  classifyShortBand, shortBandTargetWords,
  SOFT_MIN_WORDS, SOFT_MAX_WORDS, HARD_MAX_WORDS, HARD_MAX_SECONDS, SPOKEN_FULL_MAX_WORDS,
} from "./speakability";
export type { SpeakabilityDecision, SpeakabilityClass, SpeakabilityTarget, ShortLengthBand, ShortBandTarget } from "./speakability";
export { checkAnswerForCodeBugs, checkCodeCompleteness } from "./CodeSanityCheck";
export type { CodeSanityResult, CodeSanityIssue } from "./CodeSanityCheck";
export { AnswerDiversityGuard, cleanAnswerArtifacts, isLeakedSchemaStub, stripMetaPreamble, compressToSpeakable, varySpokenOpening, SCAFFOLD_LABEL_RE } from "./answerPolish";
export type { RepetitionVerdict, RepetitionReason, DiversityCheckOpts } from "./answerPolish";
export type { AnswerPlan, AnswerSource, AnswerType, ContextLayer, OutputPerspective, SpeakerPerspective } from "./AnswerPlanner";
export { applyModeFallback, MODE_CONTEXT_PROFILES } from "./modeProfiles";
export type { ActiveModeInfo, ModeContextProfile, ModeTemplateType } from "./modeProfiles";
export { resolveFollowUp, resolveFollowUpOrClarify, isBareFollowUp, isRefinementFollowUp, isSameSessionFollowUp, buildContextFreeClarification } from "./FollowUpResolver";
export { classifyProviderError, isClarificationStall, isPermanentKeyError } from "./providerErrorClassifier";
export type { ProviderErrorKind, ProviderErrorClassification } from "./providerErrorClassifier";
export { SessionMemory, isKindAllowedInMode } from "./SessionMemory";
export type { MemoryMode, MemoryItemKind, MemoryItem, MemoryQuery, MemoryRecall } from "./SessionMemory";
export { resolveSessionFollowup } from "./sessionFollowupResolver";
export type { SessionFollowupInput, SessionFollowupResult } from "./sessionFollowupResolver";
export { extractTranscriptEntities, isCorrectionTurn, isExplicitCrossModeInvite } from "./transcriptEntityExtractor";
export type { ExtractedEntity } from "./transcriptEntityExtractor";
export { isLiveSessionMemoryEnabled, liveSessionMemoryMaxItems, liveSessionMemoryDebug, __resetLiveSessionMemoryCache, resolveLiveSessionMemoryConfig, sessionBucket } from "./liveSessionMemoryConfig";
export type { LiveSessionMemoryRolloutConfig } from "./liveSessionMemoryConfig";
export { piTelemetry, scrubTelemetry, ageBucket } from "./piTelemetry";
export type { PiTelemetryEvent, PiTelemetryRecord } from "./piTelemetry";
export { resolveLiveFollowup, isContextFreeBareFollowup, toMemoryMode, toSurface, effectiveMemoryMode } from "./liveSessionMemory";
export type { LiveTurn, LiveResolveInput } from "./liveSessionMemory";
export {
  raceStreamWithDeadline, firstUsefulDeadlineMs,
  LIVE_FIRST_USEFUL_BUDGET_MS, LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS,
  LIVE_PROVIDER_FIRST_USEFUL_COMPLEX_TIMEOUT_MS, LIVE_TOTAL_HARD_TIMEOUT_MS,
  LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS, LIVE_LOCAL_TOTAL_HARD_TIMEOUT_MS,
  LIVE_INTER_TOKEN_STALL_MS, BENCHMARK_PER_QUESTION_HARD_TIMEOUT_MS,
} from "./liveDeadlines";
export type { FollowUpContext, ResolvedFollowUp, FollowUpSurface } from "./FollowUpResolver";
export { renderCodingAnswerMarkdown, repairCodingAnswer, repairCodingMarkdown, validateAnswerStructure, validateCodingMarkdown, buildCodingScaffold } from "./AnswerValidator";
export type { AnswerValidationResult, CodingAnswer } from "./AnswerValidator";
export { validateProfileOutput, buildProfileRepairInstruction, stripProfileTokensFromCoding, sanitizeCandidateAnswer, CANDIDATE_VOICE_ANSWER_TYPES, detectAssistantVoiceMisfire, ASSISTANT_VOICE_ANSWER_TYPES } from "./ProfileOutputValidator";
export type { ProfileValidationResult, ProfileViolation, ProfileViolationCode, ProfileValidationInput, CandidateSanitizeResult, AssistantVoiceSanitizeResult } from "./ProfileOutputValidator";
export { validateProfileEvidence } from "./profileEvidenceValidator";
export type { EvidenceValidationResult, EvidenceViolation, EvidenceViolationCode, EvidenceValidationInput } from "./profileEvidenceValidator";
export { decideProfileIntelligence } from "./ProfileIntelligenceRouter";
export type { ProfileIntelligenceDecision, ProfileContextType, AnswerPerspective, DecideProfileInput } from "./ProfileIntelligenceRouter";
export { CODING_CONTRACT, CODING_CONTRACT_TINY, CODING_SECTIONS, CODING_SECTION_HEADINGS, CODING_VERIFICATION_INSTRUCTION, VERIFICATION_SPEC_RE, stripVerificationSpec, StreamingSpecStripper } from "./codingContract";
export { verifyCodingAnswer } from "./codeVerification/verifyCodingAnswer";
export type { VerifyCodingOptions, CorrectionFn } from "./codeVerification/verifyCodingAnswer";
export type { Verdict, VerificationOutcome, VerifyLanguage, TestCase, RunResult, VerificationSpec } from "./codeVerification/types";
export { extractVerificationSpec, parseProblemExamples, extractCodeBlock } from "./codeVerification/extractTests";
export { buildContextRoute, isLayerAllowed, summarizeContextRoute } from "./contextRoute";
export type { ContextRoute, ContextRouteLayer } from "./contextRoute";
export {
    classifyCustomContext,
    splitCustomContextChunks,
    selectCustomContextForAnswer,
    buildScopedCustomContext,
    summarizeCustomContextSelection,
} from "./customContextClassifier";
export type { CustomContextCategory, CustomContextChunk, ClassifiedCustomContext, CustomContextSelection } from "./customContextClassifier";
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
    parseOllamaSize,
    getOpenAiMaxOutput,
    getOpenAiReasoningEffort
} from "./modelCapabilities";
export type { ModelCapabilities, ModelTier, PromptTier, OpenAiReasoningEffort } from "./modelCapabilities";
