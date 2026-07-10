// electron/intelligence/context-os/index.ts
//
// Context OS — Source Authority Kernel barrel. See docs/context-os/ for the
// phase-by-phase migration plan and PHASE_0_BASELINE.md for the audit that
// motivated this layer.

export * from './types';
export {
  ALL_SOURCE_KINDS,
  PROFILE_SOURCE_KINDS,
  REFERENCE_SOURCE_KINDS,
  TRANSCRIPT_SOURCE_KINDS,
  MEMORY_SOURCE_KINDS,
  UNTRUSTED_CAPTURE_KINDS,
  isProfileSourceKind,
  isMemorySourceKind,
  legacyKindsFor,
} from './sourceKinds';
export * from './evidencePack';
export * from './trace';
export { detectRequestedProperty } from './requestedPropertyDetector';
export {
  SourceAuthorityKernel,
  buildAmbiguousSourceClarification,
  buildSourceClarification,
  isExplicitSelfProfileAsk,
  type BuildTurnContractInput,
} from './SourceAuthorityKernel';
export { PROPERTY_RULES, propertyRuleFor, textCanProveProperty } from './requestedProperty';
export {
  EvidenceOrchestrator,
  parseModeSnippets,
  type EvidenceRetrievers,
  type BuildEvidencePackInput,
} from './EvidenceOrchestrator';
export {
  validateEvidenceForProperty,
  itemSupportsProperty,
  buildInsufficientPropertyAnswer,
  type PropertyEvidenceValidationResult,
} from './propertyEvidenceValidator';
export {
  buildDocumentEvidencePackFromBlock,
  renderGoverningFactualBlock,
  type ContextOsGenerationContext,
  type ContextOsModeSnapshot,
} from './generationContext';
export {
  mapAnswerTypeToAnswerShape,
  mapPlannerVoice,
  isContextOsEnabledForSurface,
  contextOsEnforcementMode,
  buildTurnContractForSurface,
  buildTurnContractIfEnabled,
  contractBlocks,
  assertNoAuthorityContradiction,
  type BuildTurnContractForSurfaceInput,
  type AuthorityContradictionCheck,
} from './integration';
export {
  extractCandidateClaims,
  verifyClaimAgainstEvidence,
  buildAssistantClaims,
  claimReusableAsEvidence,
  claimContradictedByEvidence,
  type AssistantClaim,
  type ClaimValidationStatus,
} from './assistantClaims';
export {
  ProfileEvidenceService,
  type ProfileEvidenceServiceInput,
} from './ProfileEvidenceService';
export {
  meetingChunksToEvidenceItems,
  MEETING_RAG_MIN_SIMILARITY,
  type MeetingRagConversionResult,
} from './meetingRagEvidence';
export {
  buildRecapContractRule,
  buildFollowUpContractRule,
  detectFollowUpSourceSwitch,
} from './recapFollowUp';
export {
  toRecalledMemoryEvidence,
  recalledMemoryToEvidenceItems,
  renderHindsightRecallBlock,
  type RecalledMemoryEvidence,
} from './hindsightEvidence';
export {
  renderContractForPrompt,
  renderEvidencePackForPrompt,
  renderEvidenceUseRule,
  renderContextOsPromptPrefix,
  escapeXml,
} from './promptRenderer';
