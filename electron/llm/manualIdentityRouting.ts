// electron/llm/manualIdentityRouting.ts
//
// REAL-APP FIX (manual regression 2026-06-12, P2): the manual chat handler's
// identity-probe short-circuit answered "who are you?", "what is your name?",
// and "introduce yourself" with the canned "I'm Natively, an AI assistant."
// BEFORE the candidate-profile fast path could run — the exact assistant-
// identity leak users hit in real sessions. Benchmarks missed it because the
// eval harness never replayed the probe.
//
// This module is THE single decision point both the IPC handler and the evals
// share. The rule:
//   - ASSISTANT-META probes (are you an AI / ChatGPT? what model? who built
//     Natively? what is Natively?) → canned assistant reply, always.
//   - CANDIDATE-AMBIGUOUS probes (who are you? introduce yourself, what's
//     your name?) → when a candidate profile is LOADED, these are interview
//     rehearsal questions about the CANDIDATE → route to the profile fast
//     path. With no profile loaded they keep the assistant reply (general
//     chat user asking the app who it is).
//
// Pure, deterministic, no I/O — trivially testable.

/** Probes that are unambiguously about the ASSISTANT/product/model — never the
 *  candidate, regardless of profile state. Kept byte-compatible with the prior
 *  ipcHandlers regexes for these intents. */
const ASSISTANT_META_PROBE_RE =
  /^\s*(?:so|wait|ok(?:ay)?|um|hey|but|and|actually)?[\s,]*(what\s+(are|r)\s+(you|u)|are\s+you\s+(chatgpt|gpt[-\s]?\d?|claude|gemini|llama|an?\s+(ai|bot|llm|model|assistant)|human|real|a\s+robot)|what('?s|\s+is)\s+your\s+model|which\s+(ai|model|llm)\s+are\s+you|who\s+(made|built|created|developed|trained)\s+(you|this|natively)|what\s+model\s+(are\s+you|do\s+you\s+use)|what\s+(is|'?s)\s+natively)\s*\??\s*$/i;

/** Creator probes — always the assistant's creator. */
const CREATOR_PROBE_RE =
  /^\s*(who\s+(made|built|created|developed|trained)\s+(you|this|natively))\s*\??\s*$/i;

/** Probes that read as CANDIDATE identity when a profile is loaded (interview
 *  rehearsal: "who are you?" → the candidate introduces themselves), and as
 *  assistant identity otherwise. */
const CANDIDATE_AMBIGUOUS_PROBE_RE =
  /^\s*(who\s+(are|r)\s+(you|u|this)|what('?s|\s+is)\s+your\s+name|introduce\s+yourself|tell\s+me\s+who\s+you\s+are)\s*\??\s*$/i;

export type IdentityProbeDecision =
  | { kind: 'assistant_reply'; reply: string }
  | { kind: 'candidate_fast_path' }   // let buildManualProfileBackendAnswer answer
  | { kind: 'none' };                 // not an identity probe — normal pipeline

/**
 * Decide what the manual handler should do with a possible identity probe.
 *
 * @param message       The raw user message.
 * @param profileReady  profileFactsReady(orchestrator.activeResume.structured_data)
 */
export function resolveIdentityProbe(message: string, profileReady: boolean): IdentityProbeDecision {
  if (typeof message !== 'string' || !message.trim()) return { kind: 'none' };

  if (CREATOR_PROBE_RE.test(message)) {
    return { kind: 'assistant_reply', reply: 'I was developed by Evin John.' };
  }
  if (ASSISTANT_META_PROBE_RE.test(message)) {
    return { kind: 'assistant_reply', reply: "I'm Natively, an AI assistant." };
  }
  if (CANDIDATE_AMBIGUOUS_PROBE_RE.test(message)) {
    // Profile loaded → the user is rehearsing as the candidate; the profile
    // fast path owns the answer ("My name is …" / grounded intro). No profile
    // → the canned assistant reply stands (general-chat identity ask).
    return profileReady
      ? { kind: 'candidate_fast_path' }
      : { kind: 'assistant_reply', reply: "I'm Natively, an AI assistant." };
  }
  return { kind: 'none' };
}
