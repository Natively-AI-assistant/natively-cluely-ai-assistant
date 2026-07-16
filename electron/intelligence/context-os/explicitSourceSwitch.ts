// electron/intelligence/context-os/explicitSourceSwitch.ts
//
// Context OS (evidence-execution-repair, 2026-07-11) — canonical explicit
// source-switch detection, resolved BEFORE the turn contract is built.
//
// WHY THIS EXISTS: the prior architecture let Profile Intelligence
// INDEPENDENTLY decide "this looks like a JD question" (via its own
// selectedContextLayers heuristic inside buildManualProfileEvidenceRoute)
// while the SourceAuthorityKernel's contract remained locked at
// reference_files_only — a hard architectural contradiction: the canonical
// contract said "no profile, no JD" while a parallel system silently
// selected and rendered JD content into the prompt anyway. Root cause:
// `_contractAllowsProfile` (ipcHandlers.ts) checked only profile_resume/
// profile_project, never profile_jd — so a JD-only leak sailed through a
// gate that LOOKED like it covered "profile" but didn't cover JD.
//
// THE FIX: resolve the user's explicit source intent ONCE, generically (no
// document/company/mode names hardcoded), BEFORE any contract or evidence
// selection happens. The result feeds `userExplicitSource` into
// buildCustomModeExecutionContract/SourceAuthorityKernel — which ALREADY
// had first-class support for this input (customModeExecutionContract.ts's
// `userExplicitSource` param, SourceAuthorityKernel's explicit-switch
// branches) but no real caller ever populated it. This module is that
// caller.
//
// An explicit switch changes ONLY the current turn's contract. It never
// mutates the mode's persisted ModeSourceContract default (verified by
// construction: this module returns a value, never writes to ModesManager).

export type ExplicitSourceSwitch = 'reference_files' | 'profile' | 'job_description' | 'transcript' | null;

// GENERAL possessive/reference shapes — never a specific document, company,
// or mode name. Mirrors (and slightly extends) the shapes already proven in
// electron/llm/sourceOwnership.ts's EXPLICIT_PROFILE_POSSESSIVE_RE /
// EXPLICIT_JD_ARTICLE_RE, consolidated here as the single pre-contract
// resolution point every surface (manual chat, WTA, phone-mirror,
// recap/follow-up) should call before building a contract.

const PROFILE_RE =
  /\b(?:my|mine|our|your)\b[\s\w-]{0,40}\b(?:resume|résumé|cv|profile|projects?|portfolio|experience|background|skills?|education|career|work\s+history)\b|\b(?:from|on|in|per|according\s+to|based\s+on|using)\s+(?:my|mine|our)\b[\s\w-]{0,20}\b(?:resume|résumé|cv|profile|projects?|portfolio|experience|background|skills?|education|career)\b/i;

// A job description is an artifact the user did not author — commonly
// referenced with the definite article ("the JD"), not a possessive.
const JD_RE =
  /\b(?:the|this|my)\s+(?:job\s+description|jd)\b|\baccording\s+to\s+(?:the|my)\s+(?:job\s+description|jd)\b|\bdoes\s+the\s+jd\b/i;

// "return to the thesis", "use the uploaded file", "back to the document".
// Widened prepositions (in/from/against) to cover "answer in the deck",
// "info from the upload", "compare against the contract" etc.
const REFERENCE_FILES_RE =
  /\b(?:return|go|back)\s+(?:to|back to)\s+(?:the\s+)?(?:uploaded\s+)?(?:document|thesis|file|material|paper|pdf)\b|\b(?:use|using|answer\s+from|based\s+on|in|from|against)\s+(?:the\s+)?(?:uploaded\s+)?(?:document|thesis|file|material|paper|pdf)\b/i;

// "based on the meeting", "use the transcript", "according to the call".
const TRANSCRIPT_RE =
  /\b(?:use|using|answer\s+from|based\s+on|according\s+to)\s+(?:the\s+)?(?:meeting|transcript|conversation|call)\b/i;

type RequestedSource = Exclude<ExplicitSourceSwitch, null>;

/**
 * Lossless multi-request resolver. Returns every independently-named source
 * the user's question requests so a comparison turn ("compare my résumé
 * with the JD") can grant both — the legacy scalar API collapses two
 * requests into one and silently picks the wrong family.
 */
export function resolveExplicitSourceRequests(question: string): RequestedSource[] {
  const q = String(question || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const requests: RequestedSource[] = [];
  if (REFERENCE_FILES_RE.test(q)) requests.push('reference_files');
  if (PROFILE_RE.test(q)) requests.push('profile');
  if (JD_RE.test(q)) requests.push('job_description');
  if (TRANSCRIPT_RE.test(q)) requests.push('transcript');
  return requests;
}

/**
 * Legacy scalar adapter. New policy code must use resolveExplicitSourceRequests
 * so it can retain every requested family for comparisons and synthesis.
 */
export function resolveExplicitSourceRequest(question: string): ExplicitSourceSwitch {
  const requests = resolveExplicitSourceRequests(question);
  if (requests.includes('job_description')) return 'job_description';
  if (requests.includes('profile')) return 'profile';
  if (requests.includes('reference_files')) return 'reference_files';
  if (requests.includes('transcript')) return 'transcript';
  return null;
}

/**
 * Maps an ExplicitSourceSwitch onto the `userExplicitSource` shape
 * `buildCustomModeExecutionContract`/`SourceAuthorityKernel` already accept.
 * `job_description` folds onto 'profile' at that layer (the kernel treats
 * JD as a profile-family capability distinguished by sourceKind, not by a
 * separate sourceOwner) — the distinction survives downstream via
 * `ProfileEvidenceService`, which tags JD facts `role_requirement` and
 * never lets them read as candidate claims (invariant 7).
 */
export function toLegacyUserExplicitSource(
  sw: ExplicitSourceSwitch,
): 'reference_files' | 'profile' | 'transcript' | null {
  if (sw === 'job_description') return 'profile';
  return sw;
}
