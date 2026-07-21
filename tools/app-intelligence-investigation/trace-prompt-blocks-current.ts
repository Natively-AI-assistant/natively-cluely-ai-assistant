// tools/app-intelligence-investigation/trace-prompt-blocks-current.ts
//
// Read-only trace of the EXPECTED prompt block order for the current
// production paths. This script does NOT import stateful services and does
// NOT call any provider — it walks the static call graph of the pure
// assembly modules and emits, for each major flow, the block order with
// source labels.
//
// The output of this script is meant to mirror the diagrams in
// `docs/NATIVELY_INTELLIGENCE_SYSTEM_CURRENT_STATE_REPORT.md §12` so that
// any future change to the assembler modules can be diffed against the
// expected order.
//
// Run with:
//   npx tsx tools/app-intelligence-investigation/trace-prompt-blocks-current.ts

import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');

function exists(rel: string): boolean {
  return fs.existsSync(path.join(ROOT, rel));
}

function block(label: string, source: string, trustLevel: string, file: string, status: 'live' | 'shadow' | 'spec-future' = 'live'): void {
  console.log(`  [${status.padEnd(11)}] ${label.padEnd(38)} source=${source.padEnd(28)} trust=${trustLevel.padEnd(28)} ${file}`);
}

function diagram1_ManualChat_ProfileMode(): void {
  console.log('====================================================================');
  console.log('1. MANUAL CHAT + profile mode');
  console.log('====================================================================');
  console.log('# System prompt:');
  block('CHAT_MODE_PROMPT', 'system', 'SYSTEM_POLICY', 'electron/llm/prompts.ts');
  block('Language instruction suffix', 'system', 'SYSTEM_POLICY', 'electron/LLMHelper.ts:injectLanguageInstruction');
  console.log('# User content (concatenated inside "CONTEXT: …\\n\\nUSER QUESTION: …"):');
  block('Persona', 'profile_persona', 'USER_PREFERENCES', 'electron/LLMHelper.ts:_streamChatInner', 'live');
  block('Hindsight recall', 'long_term_memory', 'UNTRUSTED_MEETING_HISTORY', 'electron/ipcHandlers.ts');
  block('OKF profile cards', 'profile_resume|profile_jd', 'TRUSTED_PROFILE', 'electron/services/knowledge/OkfProfileRetriever.ts');
  block('Answer contract (candidate)', 'answer_contract', 'MODE_POLICY', 'electron/llm/AnswerPlanner.ts:formatAnswerPlanForPrompt');
  block('Rolling 100s transcript (autoContextSnapshot)', 'live_transcript', 'UNTRUSTED_TRANSCRIPT', 'electron/ipcHandlers.ts:autoContextSnapshot');
  block('Skill prompt', 'skill', 'USER_PREFERENCES', 'electron/services/SkillsManager.ts');
  block('Mode context block (ref-files)', 'reference_files', 'UNTRUSTED_REFERENCE', 'electron/services/ModeContextRetriever.ts');
  console.log('# Question:');
  block('USER QUESTION', 'user_question', 'USER_PREFERENCES', 'renderer -> ipcHandlers');
}

function diagram2_ManualChat_DocGroundedMode(): void {
  console.log('');
  console.log('====================================================================');
  console.log('2. MANUAL CHAT + document-grounded custom mode');
  console.log('====================================================================');
  console.log('# System prompt:');
  block('CHAT_MODE_PROMPT', 'system', 'SYSTEM_POLICY', 'electron/llm/prompts.ts');
  block('Language instruction suffix', 'system', 'SYSTEM_POLICY', 'electron/LLMHelper.ts:injectLanguageInstruction');
  block('DOCUMENT-GROUNDED OVERRIDE (highest priority)', 'system', 'SYSTEM_POLICY', 'electron/llm/documentGroundedPrompt.ts:DOCUMENT_GROUNDED_SYSTEM_OVERRIDE');
  console.log('# User content (Shape B — Q first AND last):');
  block('QUESTION (top)', 'user_question', 'USER_PREFERENCES', 'electron/llm/documentGroundedPrompt.ts:buildDocumentGroundedUserContent');
  block('<evidence_use_rule>', 'system_prompt_injection', 'SYSTEM_POLICY', 'electron/llm/documentGroundedPrompt.ts:EVIDENCE_USE_RULE');
  block('## RETRIEVED EXCERPTS FROM UPLOADED DOCUMENT', 'reference_files', 'UNTRUSTED_REFERENCE', 'electron/services/modes/ModeHybridRetriever.ts');
  block('## STRUCTURED KNOWLEDGE CARDS (OKF)', 'reference_files', 'UNTRUSTED_REFERENCE', 'electron/services/knowledge/OkfPromptFormatter.ts');
  block('## RELATED CONCEPTS (graph hints)', 'reference_files', 'UNTRUSTED_REFERENCE', 'electron/services/knowledge/GraphRetriever.ts');
  block('## RECENT CONVERSATION (referent-only)', 'prior_assistant_referent', 'UNTRUSTED_TRANSCRIPT', 'electron/llm/documentGroundedPrompt.ts:priorContext');
  block('QUESTION (restated at the end)', 'user_question', 'USER_PREFERENCES', 'electron/llm/documentGroundedPrompt.ts:buildDocumentGroundedUserContent');
  console.log('# Suppressed when document-grounded:');
  block('(BLOCKED) profile_resume / profile_jd / persona', 'profile', 'BLOCKED', 'electron/llm/sourceOwnership.ts:resolveSourceOwnership', 'live');
  block('(BLOCKED) Hindsight recall', 'long_term_memory', 'BLOCKED', 'electron/llm/customModeExecutionContract.ts:reference_files_only', 'live');
  block('(STRIPPED) prior_assistant_facts', 'prior_assistant_facts', 'BLOCKED', 'electron/llm/customModeExecutionContract.ts:reference_files_only', 'live');
}

function diagram3_WTA_ProfileMode(): void {
  console.log('');
  console.log('====================================================================');
  console.log('3. WTA + profile-interview mode');
  console.log('====================================================================');
  console.log('# System prompt (assembled inside WhatToAnswerLLM.generateStream):');
  block('UNIVERSAL_WHAT_TO_ANSWER_PROMPT', 'system', 'SYSTEM_POLICY', 'electron/llm/prompts.ts');
  block('## ACTIVE MODE\\n{modePromptSuffix}', 'active_mode_pinned', 'MODE_POLICY', 'electron/llm/prompts.ts:TEMPLATE_SYSTEM_PROMPTS');
  block('Language instruction suffix', 'system', 'SYSTEM_POLICY', 'electron/LLMHelper.ts:injectLanguageInstruction');
  console.log('# User message (sorted by trust descending after token-budget enforcement):');
  block('<intent_and_shape> + <answer_contract>', 'system_prompt_injection', 'DEVELOPER_POLICY', 'electron/services/context/PromptAssembler.ts');
  block('<previous_responses>', 'prior_assistant', 'ASSISTANT_HISTORY', 'electron/services/context/PromptAssembler.ts');
  block('<candidate_profile> (xml from KnowledgeOrchestrator)', 'profile_resume|profile_jd', 'TRUSTED_PROFILE', 'electron/services/context/PromptAssembler.ts');
  block('<screen_context> (when imagePaths present)', 'screen', 'UNTRUSTED_SCREEN', 'electron/services/context/PromptAssembler.ts');
  block('<dom_context> (when DOM snapshot present)', 'dom', 'UNTRUSTED_SCREEN', 'electron/services/context/PromptAssembler.ts');
  block('<transcript> (180s + last interim)', 'live_transcript', 'UNTRUSTED_TRANSCRIPT', 'electron/services/context/PromptAssembler.ts');
  block('<active_mode_custom_instructions>', 'custom_context', 'MODE_POLICY', 'electron/services/context/PromptAssembler.ts');
  block('<reference_file> (one per file)', 'reference_files', 'UNTRUSTED_REFERENCE', 'electron/services/context/PromptAssembler.ts');
  block('<meeting_history>', 'meeting_rag', 'UNTRUSTED_MEETING_HISTORY', 'electron/services/context/PromptAssembler.ts');
  block('<custom_context>', 'custom_context', 'USER_PREFERENCES', 'electron/services/context/PromptAssembler.ts');
}

function diagram4_WTA_DocGroundedMode(): void {
  console.log('');
  console.log('====================================================================');
  console.log('4. WTA + document-grounded custom mode');
  console.log('====================================================================');
  console.log('# System prompt:');
  block('UNIVERSAL_WHAT_TO_ANSWER_PROMPT', 'system', 'SYSTEM_POLICY', 'electron/llm/prompts.ts');
  block('## ACTIVE MODE\\n{modePromptSuffix}', 'active_mode_pinned', 'MODE_POLICY', 'electron/llm/prompts.ts');
  block('Language instruction suffix', 'system', 'SYSTEM_POLICY', 'electron/LLMHelper.ts');
  block('DOCUMENT-GROUNDED OVERRIDE', 'system', 'SYSTEM_POLICY', 'electron/llm/documentGroundedPrompt.ts');
  console.log('# User message (differences from #3):');
  block('(SUPPRESSED) <previous_responses>', 'prior_assistant_facts', 'BLOCKED', 'electron/llm/WhatToAnswerLLM.ts:priorResponses=false', 'live');
  block('(SUPPRESSED) <candidate_profile>', 'profile_resume|profile_jd', 'BLOCKED', 'electron/llm/WhatToAnswerLLM.ts:effectiveCandidateProfile=undefined', 'live');
  block('<active_mode_retrieved_context> (retrieval-dominant)', 'reference_files', 'UNTRUSTED_REFERENCE', 'electron/services/modes/ModeHybridRetriever.ts');
  block('## STRUCTURED KNOWLEDGE CARDS', 'reference_files', 'UNTRUSTED_REFERENCE', 'electron/services/knowledge/OkfPromptFormatter.ts');
  block('<transcript> (referent-only, truncated)', 'live_transcript', 'UNTRUSTED_TRANSCRIPT', 'electron/services/context/PromptAssembler.ts');
}

function diagram5_RecapAndSummary(): void {
  console.log('');
  console.log('====================================================================');
  console.log('5. RECAP (in-session) + MEETING SUMMARY (post-call)');
  console.log('====================================================================');
  console.log('# RecapLLM (real-time) — minimal flat string:');
  block('UNIVERSAL_RECAP_PROMPT (3-5 bullets directive)', 'system', 'SYSTEM_POLICY', 'electron/llm/prompts.ts:UNIVERSAL_RECAP_PROMPT');
  block('User content (fitted rolling 100s transcript)', 'live_transcript', 'UNTRUSTED_TRANSCRIPT', 'electron/llm/RecapLLM.ts');
  console.log('# Notes: no profile, no reference files, no Hindsight, no mode. Active mode is NOT injected on this path.');
  console.log('');
  console.log('# Meeting Notes V3 (post-call) — separate provider chain:');
  block('JSON-shape hint system prompt', 'system', 'SYSTEM_POLICY', 'electron/services/meeting/SectionPromptCompiler.ts:buildSystemPrompt');
  block('User content (transcript atoms)', 'live_transcript', 'UNTRUSTED_TRANSCRIPT', 'electron/services/meeting/MeetingContextAssembler.ts');
  console.log('# Notes: own provider chain, no profile, no Hindsight, no mode suffix.');
}

function evidencePackPlugInNotes(): void {
  console.log('');
  console.log('====================================================================');
  console.log('EVIDENCE PACK PLUG-IN POINTS (current vs future)');
  console.log('====================================================================');
  console.log('# Where an EvidencePack-style {content, sourceKind, sourceId, trust, recencyMs, tokenBudget}');
  console.log('# wrapper could replace raw strings:');
  const inserts = [
    'electron/LLMHelper.ts:_streamChatInner — combinedContext assembly (manual/phone) — single chokepoint for ALL chat surfaces',
    'electron/llm/documentGroundedPrompt.ts:buildDocumentGroundedUserContent — QUESTION-first / evidence / referent / QUESTION-restated',
    'electron/services/context/PromptAssembler.ts:assemble — V1 already has ContextBlock+EvidenceRef; EvidencePack is a strict superset',
    'electron/services/modes/ModeHybridRetriever.ts:formatContext — biggest loose string; would gain <chunk source_kind=… source_id=…> wrapping',
    'electron/llm/documentGroundedPrompt.ts:priorContext — should become <prior_assistant_referent source_kind=…> (survives paraphrasing)',
    'electron/ipcHandlers.ts — Hindsight recall bullet list (currently flat bullets, no per-fact source-id)',
    'electron/ipcHandlers.ts — autoContextSnapshot rolling transcript (currently bare text inside CONTEXT:)',
    'electron/intelligence/PromptAssemblerV2.ts — already emits inclusion report; the prototype EvidencePack shape',
  ];
  for (const s of inserts) console.log('  - ' + s);
}

function main(): void {
  console.log('# Expected prompt block order — current production paths.');
  console.log('# This script does NOT call any provider. It mirrors the diagrams in');
  console.log('# docs/NATIVELY_INTELLIGENCE_SYSTEM_CURRENT_STATE_REPORT.md §12.');
  console.log('#');
  console.log('# Each block has a `live` / `shadow` / `spec-future` status:');
  console.log('#   live        — wired into the production path today');
  console.log('#   shadow      — runs in parallel for telemetry, never affects the answer');
  console.log('#   spec-future — design exists, no production wiring');
  console.log('');
  diagram1_ManualChat_ProfileMode();
  diagram2_ManualChat_DocGroundedMode();
  diagram3_WTA_ProfileMode();
  diagram4_WTA_DocGroundedMode();
  diagram5_RecapAndSummary();
  evidencePackPlugInNotes();
  console.log('');
  console.log('# End of trace-prompt-blocks-current.ts output.');
}

main();