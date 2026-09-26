// Bundle entry: re-exports the REAL production modules the post-meeting summary path uses.
// Built with the same esbuild options as scripts/build-electron.js into benchmark/build/.
export { LLMHelper } from '../../electron/LLMHelper';
export { MeetingContextAssembler } from '../../electron/services/meeting/MeetingContextAssembler';
export { generateTitleFromSummaryWithSource } from '../../electron/MeetingPersistence';
export { buildPostCallEnhancements } from '../../electron/services/post-call/PostCallWorkflow';
export { TEMPLATE_NOTE_SECTIONS } from '../../electron/services/ModesManager';
export { MeetingModeDetector } from '../../electron/services/meeting/MeetingModeDetector';
export { isIntelligenceFlagEnabled } from '../../electron/intelligence/intelligenceFlags';
export { TranscriptNormalizer } from '../../electron/services/meeting/TranscriptNormalizer';
export { TranscriptChunker } from '../../electron/services/meeting/TranscriptChunker';
