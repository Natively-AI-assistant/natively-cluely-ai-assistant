// electron/llm/index.ts
// Central export for all LLM modules

export { AnswerLLM } from "./AnswerLLM";
export { AssistLLM } from "./AssistLLM";
export { BrainstormLLM } from "./BrainstormLLM";
export { BugFinderLLM } from "./BugFinderLLM";
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
export { MODE_CONFIGS } from "./types";
export type { GenerationConfig, GeminiContent, LLMClient } from "./types";
export {
    HARD_SYSTEM_PROMPT,
    ANSWER_MODE_PROMPT,
    ASSIST_MODE_PROMPT,
    FOLLOWUP_MODE_PROMPT,
    RECAP_MODE_PROMPT,
    WHAT_TO_ANSWER_PROMPT,
    TEMPORAL_CONTEXT_TEMPLATE,
    GROQ_TITLE_PROMPT,
    GROQ_SUMMARY_JSON_PROMPT,
    FOLLOWUP_EMAIL_PROMPT,
    GROQ_FOLLOWUP_EMAIL_PROMPT,
    CODE_HINT_PROMPT,
    buildCodeHintMessage,
    BRAINSTORM_MODE_PROMPT,
    BUG_FINDER_PROMPT,
    buildBugFinderMessage
} from "./prompts";
