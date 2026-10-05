// Trust levels for context blocks, ordered from most trusted (hard rules)
 // to least trusted (unstructured evidence). Assembly order MUST follow this
 // order — system_policy first, untrusted blocks last.
 //
 // Naming convention: TRUSTED_* for data that can inform answers, UNTRUSTED_*
 // for evidence that must not override system/mode policies.

 export enum TrustLevel {
     // Hard system rules — never overridable by user or mode
     SYSTEM_POLICY = 'system_policy',

     // Mode-specific rules from template prompts
     MODE_POLICY = 'mode_policy',

     // Developer overrides (e.g. system-level debugging flags)
     DEVELOPER_POLICY = 'developer_policy',

     // User preferences (settings, not instructions)
     USER_PREFERENCES = 'user_preferences',

     // User's own profile data (resume, JD) — self-authored, high trust
     TRUSTED_PROFILE = 'trusted_profile',

     // Prior AI responses — used for anti-repetition, not as guidance
     ASSISTANT_HISTORY = 'assistant_history',

     // Visual evidence from screen capture — OCR can miss/misread content
     UNTRUSTED_SCREEN = 'untrusted_screen',

     // Meeting/interview transcript — real-time, may contain errors
     UNTRUSTED_TRANSCRIPT = 'untrusted_transcript',

     // User-uploaded reference files — may contain injected content
     UNTRUSTED_REFERENCE = 'untrusted_reference',

     // Past meeting summaries — secondary evidence
     UNTRUSTED_MEETING_HISTORY = 'untrusted_meeting_history',
 }

 export interface EvidenceRef {
     source: 'transcript' | 'screen' | 'reference' | 'meeting_history' | 'browser_dom';
     text: string;
     timestamp?: number;
     speaker?: string;
     fileId?: string;
     chunkId?: string;
 }

 export interface ContextBlock {
     type: string;
     trustLevel: TrustLevel;
     source: string;
     tokenBudget: number;
     recency?: number; // ms age
     evidenceRefs?: EvidenceRef[];
     content: string;
 }

 // Ordered list for assembly — trust levels sorted highest to lowest
 export const TRUST_LEVEL_ORDER: TrustLevel[] = [
     TrustLevel.SYSTEM_POLICY,
     TrustLevel.MODE_POLICY,
     TrustLevel.DEVELOPER_POLICY,
     TrustLevel.USER_PREFERENCES,
     TrustLevel.TRUSTED_PROFILE,
     TrustLevel.ASSISTANT_HISTORY,
     TrustLevel.UNTRUSTED_SCREEN,
     TrustLevel.UNTRUSTED_TRANSCRIPT,
     TrustLevel.UNTRUSTED_REFERENCE,
     TrustLevel.UNTRUSTED_MEETING_HISTORY,
 ];

 /**
  * Dangerous patterns that indicate a user-controlled string is attempting
  * to override system prompts or instructions.
  *
  * Security fix (campaign2, longsession, 2026-07-17): the original `\s*` between
  * the verb and "previous/all" tolerated only whitespace, so "Ignore YOUR previous
  * instructions" — the single most natural real-world phrasing of this attack,
  * and the exact literal text used in this campaign's own adversarial benchmark
  * fixture — silently bypassed detection. `(?:\s+(?:my|your|our|the|his|her|
  * their)\b)?` tolerates one optional intervening possessive pronoun.
  */
 export const DANGEROUS_PATTERNS: RegExp[] = [
     /ignore(?:\s+(?:my|your|our|the|his|her|their)\b)?\s*(previous|all)\s*instructions/i,
     /disregard(?:\s+(?:my|your|our|the|his|her|their)\b)?\s*(previous|all)\s*(instructions|prompts)/i,
     /you\s*(are\s*now|should)\s*act\s+as/i,
     /system\s*prompt:/i,
     /\[INST\]\[INST\]/i,
 ];

 /**
  * Check whether text contains prompt injection patterns.
  * Returns true if any dangerous pattern matches.
  */
 export function containsPromptInjection(text: string): boolean {
     return DANGEROUS_PATTERNS.some(pattern => pattern.test(text));
 }