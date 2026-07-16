// electron/services/modeSourceContract.ts
//
// Real-Custom-Mode Repair (2026-07-11) — the persisted, explicit, typed
// per-mode source contract required by the incident investigation
// (docs/context-os/real-custom-mode-repair/05_PRODUCT_SOURCE_POLICY.md).
//
// WHY: `documentGrounded` / `sourceAuthority` were previously RE-DERIVED on
// every single turn by running two regexes (DOCUMENT_SOURCE_RE,
// DOCUMENT_CONSTRAINT_RE) against the mode's free-form `customContext` text
// (ModesManager.getActiveModeDocumentGroundingInfo). A real user's natural
// phrasing of "answer from my uploaded thesis" routinely fails to satisfy
// both regexes simultaneously, silently downgrading the mode to
// `general_mixed` (everything allowed) with ZERO visibility to the user —
// this was the root cause of the P0 contamination incident (thesis
// questions answered from the candidate's résumé).
//
// This module is the single source of truth for what a mode's source policy
// IS. It is:
//   - EXPLICIT: a typed object, not a regex match against prose.
//   - PERSISTED: written once (by the user, or by one-time migration) and
//     read back identically every time — no re-derivation drift.
//   - GENERALIZED: contains no document names, mode IDs, or hardcoded
//     entities — every field is a closed enum describing a SHAPE of policy,
//     applicable to any future custom mode.
//
// Nothing in this module hardcodes "seminar" / "thesis" / "AgenticVLA" / any
// mode id / any file name / any benchmark question.

export type ModeSourceOwner = 'reference_files' | 'profile' | 'transcript' | 'mixed' | 'clarify';

export type ModeSourceSwitch = 'reference_files' | 'profile' | 'job_description' | 'transcript';

export type ModeSourceAuthority =
  | 'reference_files_only'
  | 'reference_files_primary'
  | 'reference_files_plus_transcript'
  | 'profile_only'
  | 'profile_plus_transcript'
  | 'transcript_only'
  | 'general_mixed'
  | 'ask_if_ambiguous';

export type ModeConflictPolicy =
  | 'reference_files_win'
  | 'profile_wins'
  | 'transcript_wins'
  | 'ask_clarification';

export interface ModeSourceContract {
  /** Schema version — bump and add a migrator when the shape changes. */
  version: 1;
  defaultOwner: ModeSourceOwner;
  allowedExplicitSwitches: ModeSourceSwitch[];
  sourceAuthority: ModeSourceAuthority;
  evidenceRequired: boolean;
  conflictPolicy: ModeConflictPolicy;
  memoryPolicy: {
    allowPriorAssistantFacts: boolean;
    allowPriorAssistantReferents: boolean;
    allowHindsight: boolean;
  };
  /**
   * How this contract came to exist. Surfaced in the UI/telemetry so a
   * silently-migrated legacy mode is visibly distinguishable from a user's
   * explicit, confirmed choice. Never used as a security boundary itself.
   */
  origin: 'user_selected' | 'migrated_from_prompt' | 'default_new_mode';
  /**
   * Which revision of the prompt→contract MIGRATION LOGIC produced this
   * contract, for `origin: 'migrated_from_prompt'` only. When the migration
   * heuristic improves (e.g. the override-grant fix below), a mode migrated
   * by an older revision is re-migrated once on next read so its persisted
   * authority reflects the corrected logic — WITHOUT ever re-deriving a
   * `user_selected` contract (that is the user's explicit choice, never
   * touched). Absent (older serialized contracts) is treated as revision 1.
   * This is NOT the schema version — the shape is unchanged; only the value
   * the migration would compute has been corrected.
   */
  migrationRevision?: number;
}

/**
 * Current revision of the prompt→contract migration heuristic. Bump this
 * whenever `migrateSourceContractFromPrompt` is changed in a way that would
 * compute a DIFFERENT authority for the same prompt, so already-persisted
 * `migrated_from_prompt` contracts self-heal on next read (see
 * ModesManager.getOrMigrateSourceContract). Never affects `user_selected`.
 *
 *   rev 1 — original strict-detector-only migration.
 *   rev 2 — strict lock requires the prompt to NOT also grant explicit
 *           overrides; a "default to the document, but use my résumé/JD if I
 *           ask" prompt migrates to `reference_files_primary`, not the
 *           `reference_files_only` prison (2026-07-14 real-app source-switch
 *           repair).
 */
export const CURRENT_MIGRATION_REVISION = 2;

const CONFLICT_POLICY_FOR_AUTHORITY: Record<ModeSourceAuthority, ModeConflictPolicy> = {
  reference_files_only: 'reference_files_win',
  reference_files_primary: 'reference_files_win',
  reference_files_plus_transcript: 'reference_files_win',
  profile_only: 'profile_wins',
  profile_plus_transcript: 'profile_wins',
  transcript_only: 'transcript_wins',
  general_mixed: 'ask_clarification',
  ask_if_ambiguous: 'ask_clarification',
};

const EVIDENCE_REQUIRED_FOR_AUTHORITY: Record<ModeSourceAuthority, boolean> = {
  reference_files_only: true,
  reference_files_primary: true,
  reference_files_plus_transcript: true,
  profile_only: false,
  profile_plus_transcript: false,
  transcript_only: true,
  general_mixed: false,
  ask_if_ambiguous: false,
};

/**
 * A brand-new mode with no reference files / prompt yet: safe, ambiguous-aware default.
 *
 * `templateType` is honored so the seed matches the renderer's per-mode default
 * table (general / sales / recruiting / team-meet / lecture → reference_files,
 * looking-for-work / technical-interview → profile + job_description). Without
 * template awareness the seed listed every switch and the renderer would have
 * to ignore it on every freshly-created mode.
 *
 * The deprecated 'transcript' switch is never seeded; it's always available
 * via ProviderDataScope during STT sessions, never as a user-settable switch.
 */
export function defaultSourceContractForNewMode(
  templateType?: string,
): ModeSourceContract {
  const isInterviewPrep = templateType === 'looking-for-work'
    || templateType === 'technical-interview';
  const allowedExplicitSwitches: ModeSourceSwitch[] = isInterviewPrep
    ? ['profile', 'job_description']
    : ['reference_files'];
  const defaultOwner: ModeSourceOwner = isInterviewPrep ? 'profile' : 'reference_files';
  const sourceAuthority: ModeSourceAuthority = (isInterviewPrep
    ? 'profile_only'
    : 'reference_files_primary') as ModeSourceAuthority;
  // Interview-prep modes (Looking-for-Work, Technical Interview) are
  // profile-first: they must remember prior assistant context (the
  // ongoing interview) and may use Hindsight (cross-meeting recall).
  // Document-grounded modes must NOT — that's invariant #3 (Hindsight is
  // forbidden when sourceOwner in {reference_files, transcript, mixed}).
  const isReferenceFilesAuthority =
    sourceAuthority === 'reference_files_only'
    || sourceAuthority === 'reference_files_primary'
    || sourceAuthority === 'reference_files_plus_transcript';
  return {
    version: 1,
    defaultOwner,
    allowedExplicitSwitches,
    sourceAuthority,
    evidenceRequired: EVIDENCE_REQUIRED_FOR_AUTHORITY[sourceAuthority],
    conflictPolicy: CONFLICT_POLICY_FOR_AUTHORITY[sourceAuthority],
    memoryPolicy: isReferenceFilesAuthority
      ? { allowPriorAssistantFacts: false, allowPriorAssistantReferents: true, allowHindsight: false }
      : { allowPriorAssistantFacts: true, allowPriorAssistantReferents: true, allowHindsight: true },
    origin: 'default_new_mode',
  };
}

/**
 * Build a contract from the user's explicit "Primary knowledge source" UI
 * selection (Phase 5 design). This is the AUTHORITATIVE construction path —
 * the renderer maps its radio/checkbox state directly onto these fields, no
 * prompt-text inference involved.
 */
export function buildUserSelectedSourceContract(input: {
  defaultOwner: ModeSourceOwner;
  allowedExplicitSwitches?: ModeSourceSwitch[];
  hasLiveTranscriptCapable?: boolean;
}): ModeSourceContract {
  const switches = input.allowedExplicitSwitches ?? [];
  const sourceAuthority: ModeSourceAuthority = (() => {
    switch (input.defaultOwner) {
      case 'reference_files':
        if (switches.length > 0) return 'reference_files_primary';
        return switches.includes('transcript') ? 'reference_files_plus_transcript' : 'reference_files_only';
      case 'profile':
        return input.hasLiveTranscriptCapable ? 'profile_plus_transcript' : 'profile_only';
      case 'transcript':
        return 'transcript_only';
      case 'mixed':
      case 'clarify':
      default:
        return 'ask_if_ambiguous';
    }
  })();
  return {
    version: 1,
    defaultOwner: input.defaultOwner,
    allowedExplicitSwitches: switches,
    sourceAuthority,
    evidenceRequired: EVIDENCE_REQUIRED_FOR_AUTHORITY[sourceAuthority],
    conflictPolicy: CONFLICT_POLICY_FOR_AUTHORITY[sourceAuthority],
    memoryPolicy: sourceAuthority === 'reference_files_only' || sourceAuthority === 'reference_files_primary' || sourceAuthority === 'reference_files_plus_transcript'
      ? { allowPriorAssistantFacts: false, allowPriorAssistantReferents: true, allowHindsight: false }
      : { allowPriorAssistantFacts: true, allowPriorAssistantReferents: true, allowHindsight: true },
    origin: 'user_selected',
  };
}

// ── Legacy prompt-text heuristic — kept ONLY for one-time migration ────────
//
// Mirrors the pre-existing DOCUMENT_SOURCE_RE / DOCUMENT_CONSTRAINT_RE pair
// from ModesManager.ts so a legacy mode whose prompt ALREADY satisfied the
// strict old detector keeps its exact prior (correct) behavior after
// migration. Never re-run per-turn after this — the migration result is
// persisted once and becomes the mode's stable contract.

const DOCUMENT_SOURCE_RE = /\b(uploaded|attached|provided|reference|source material|course material|seminar material|lecture material|presentation|slides?|deck|papers?|pdfs?|files?|documents?|docs?|notes?|attached material|uploaded content|provided material)\b/i;
const DOCUMENT_CONSTRAINT_RE = /\b(source[-\s]?of[-\s]?truth|from the files?|from the documents?|from the uploaded|answer(?:s|ing)?\s+from\s+(?:the\s+)?(?:uploaded|attached|provided|reference|files?|documents?)|based on (?:uploaded|provided|attached|the\s+(?:uploaded|attached|provided|reference)|my\s+(?:uploaded|attached|provided|reference|files?|documents?|docs?|notes?|papers?|slides?|presentation))|based on the [a-z]+ i(?:'ve| have)?\s+(?:uploaded|attached|provided|shared|given)|use only|only use|only reference|only rely|rely only|use\s+the\s+(?:uploaded|attached|provided|reference|files?|documents?|docs?|notes?|papers?|slides?|presentation)|(?:stick to|restrict to|limit to|draw from)(?:\s+\w+){0,2}\s+(?:the\s+)?(?:uploaded|attached|provided|reference|files?|documents?|docs?|notes?|papers?|slides?|presentation|material)|(?:material|content|info(?:rmation)?)\s+in\s+the\s+(?:file|document|pdf|notes?|slides?|presentation)|do not use knowledge outside|(?:don['’]?t|do not)\s+(?:use|rely on|draw on|add)\s+(?:anything\s+)?(?:outside|beyond|other than|not\s+(?:written|mentioned|present|found)\s+(?:there|in))|ground(?:ed)? (?:your )?answers? in|ground(?:ed)? in|(?:check|read|refer to|consult|verify|look at)\s+the\s+(?:file|document|pdf|notes?|slides?|presentation|material)\s+(?:first|before))\b/i;

/** True only when the OLD strict detector would have matched (both regexes). */
export function legacyPromptDetectsStrictDocumentGrounding(customContext: string): boolean {
  const prompt = customContext || '';
  return DOCUMENT_SOURCE_RE.test(prompt) && DOCUMENT_CONSTRAINT_RE.test(prompt);
}

/**
 * Fold accents to ASCII so word-boundary matching works on natural spellings.
 * A JS `\b` never fires adjacent to a non-ASCII letter, so "résumé" would fail
 * `\bresume\b`; normalizing to NFD and stripping combining marks turns it into
 * "resume" first. General text hygiene — no entity/mode names involved.
 */
function foldAccents(text: string): string {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ── Explicit-override-grant detector (rev 2) ───────────────────────────────
//
// A prompt can BOTH declare a document default ("answer from the uploaded
// thesis") AND explicitly grant source switching ("…but if I ask, use my
// résumé or the JD"). The legacy strict detector only sees the first clause
// and collapses such a mode into `reference_files_only` (a hard prison with
// NO allowed switches) — the exact real-app defect: explicit résumé/JD asks
// in a seminar mode get a source-honest "I only answer from the document"
// clarification instead of the profile answer the prompt itself invited.
//
// This detector answers a DIFFERENT question than the strict detector: "does
// the author explicitly PERMIT the user to pull from their profile / JD /
// the meeting on request?" It is GENERAL — it matches the SHAPE of a
// conditional/permissive override grant over the profile-family artifacts,
// never a specific document, company, résumé, or mode name. When present, the
// mode is reference-file-PRIMARY (default doc, explicit switches allowed), not
// a prison — even if the strict detector also fired on the default clause.
//
// A grant requires, IN THE SAME CLAUSE, a user-directed SWITCH cue and a
// non-negated switch target. The permission cue is deliberately NARROW — it is
// NOT bare "can"/"may"/"also" (those fire on ordinary descriptive prose like
// "the paper also covers the candidate's background"), but an explicit
// user-directed request-or-use-another-source shape:
//   - a conditional user request: "if I ask", "when you ask", "on request",
//     "if requested", "when I explicitly ask", "should I ask";
//   - OR a switch/consult verb aimed at a non-default source: "use", "pull
//     from", "reference", "consult", "cite", "draw on", "switch to", "look at",
//     "check" — optionally softened by can/may/feel-free but the VERB is what
//     makes it a source-switch instruction, not the modal.
// Descriptive prose ("the deck covers your work history") has neither shape.
const SWITCH_REQUEST_RE =
  /\b(?:if|when|whenever|should)\s+(?:i|you|the\s+user)?\s*(?:ask|asks|request|requests|explicitly|want|wants|say|says)\b|\b(?:on|upon)\s+request\b|\bif\s+(?:asked|requested|explicitly)\b|\bwhen\s+(?:asked|requested)\b|\bexplicitly\s+(?:ask|request|asks|requests)\b/i;
// The switch VERBS themselves.
const SWITCH_VERB_BODY = "(?:use|pull\\s+from|refer\\s+to|reference|consult|cite|draw\\s+on|switch\\s+to|look\\s+at|check|answer\\s+from|base\\s+(?:it\\s+)?on)";
// A switch verb only counts as a user-directed instruction when it is in an
// IMPERATIVE or PERMISSION-MODAL position — NOT when it's a gerund/third-person
// description ("the paper discusses USING my experience", "the deck will CHECK
// my background"). Two governing shapes:
//   - permission modal before the verb: "can/may/could/please/feel free to
//     /allowed to/should/must use…",
//   - imperative: the verb at clause start (optionally after "then/and/also"
//     or "if I ask,"), i.e. no third-person noun subject governing it.
// Permission/directive modals only — NOT "will/would" (third-person future:
// "the deck will check my background" is description, not a switch grant).
const SWITCH_VERB_MODAL_RE =
  new RegExp(`\\b(?:can|could|may|might|please|feel\\s+free\\s+to|allowed\\s+to|okay\\s+to|ok\\s+to|should|must|shall)\\s+(?:also\\s+)?${SWITCH_VERB_BODY}\\b`, 'i');
const SWITCH_VERB_IMPERATIVE_RE =
  new RegExp(`(?:^|[,;]\\s*|\\b(?:then|and|also|otherwise|please)\\s+)(?:also\\s+)?${SWITCH_VERB_BODY}\\b`, 'i');

// Per-family switch targets — each independently gated so a forbid on one
// family never grants another. Accent-folded before matching.
//
// The profile family splits into STRONG and WEAK targets:
//   - STRONG (resume/cv/portfolio/profile): unambiguously the candidate's OWN
//     profile artifact — a switch verb over one is a genuine profile grant.
//   - WEAK (projects/experience/skills/education/background/career/work
//     history): these nouns ALSO legitimately describe a DOCUMENT'S contents
//     ("cite the projects in the deck", "the paper covers my background") —
//     so they grant the profile family ONLY when governed by a first-person
//     possessive ("my/your/mine/our"), i.e. clearly the candidate's, not the
//     document's. This closes the doc-internal-noun false grant (code-review
//     2026-07-14) without hardcoding any entity name.
const PROFILE_STRONG_RE = /\b(?:resume|cv|portfolio|profile)\b/i;
const PROFILE_WEAK_POSSESSIVE_RE = /\b(?:my|mine|our|your)\b[\s\w-]{0,12}\b(?:experience|background|projects?|skills?|education|career|work\s+history)\b/i;
const FAMILY_TARGET_RE: Record<'profile' | 'job_description' | 'transcript', RegExp> = {
  // JD is its own family (role requirements ≠ candidate claims). Checked first.
  job_description: /\b(?:job\s+description|jd)\b/i,
  // Union used only for the FORBID check (a forbid on any profile noun, strong
  // or weak, suppresses the family). The GRANT check uses the strong/weak split
  // in `clauseGrantsProfile` below.
  profile: /\b(?:resume|cv|profile|portfolio|experience|background|projects?|skills?|education|career|work\s+history)\b/i,
  transcript: /\b(?:meeting|transcript|conversation|call)\b/i,
};

/** A clause GRANTS the profile family only via a strong artifact OR a possessive weak noun. */
function clauseNamesProfileGrantTarget(clause: string): boolean {
  return PROFILE_STRONG_RE.test(clause) || PROFILE_WEAK_POSSESSIVE_RE.test(clause);
}

// A RETRACTION negates a back-referencing deictic ("never DO THAT", "this is
// not APPROPRIATE", "never USE IT") rather than a concrete source noun — a
// self-contradicting prompt that grants a switch and then walks it back
// ("…use my resume if I ask, though you should really never do that"). Pronoun
// anaphora ("that"/"it"/"this") can't be resolved by a regex, so the safe,
// generic response is: if ANY clause contains such a retraction, treat the
// whole grant set as untrustworthy and revoke it (stay strict — no leak). This
// deliberately does NOT match "never go outside the document" (which negates a
// concrete NON-switch noun, not a deictic), so legitimate grants survive.
const RETRACTION_RE =
  /\b(?:never|not|no|don'?t|do\s+not|should\s+not|must\s+not|cannot|can'?t)\b[\s\w-]*?\b(?:do\s+that|do\s+so|do\s+this|use\s+it|use\s+that|use\s+this|reference\s+it|reference\s+that|appropriate|acceptable|permitted|allowed|advisable|a\s+good\s+idea|okay|ok)\b/i;

// Bidirectional negation: a negator governing the target on EITHER side flips a
// "grant" into a FORBID. "do not use my résumé" (negator-before) AND "the résumé
// should never be used" / "the JD is off-limits" (target-before-negator) must
// both suppress the grant. `T` is the family's own target alternation body.
function familyForbiddenInClause(clause: string, familyTargetBody: string): boolean {
  const NEG = "(?:not|never|no|don'?t|do\\s+not|does\\s+not|isn'?t|aren'?t|won'?t|cannot|can'?t|must\\s+not|should\\s+not|shall\\s+not|without|avoid|exclude|excluding|off[-\\s]?limits|forbidden|prohibited|banned|disallowed|out\\s+of\\s+bounds|not\\s+to\\s+be|refuse|decline|redirect|instead)";
  // A negator governs the target ANYWHERE in the same clause — no character
  // window. "do not use outside knowledge or my resume" and "under no
  // circumstances, even if you really want to, use my resume" both forbid the
  // résumé regardless of how much emphatic text sits between negator and
  // target. The `[^.!?;\n]` class is what actually bounds scope: clauses are
  // already sentence/coordination split, so the span can never cross into an
  // unrelated sentence. A fixed numeric window (previously {0,120}/{0,60}) was
  // escapable by a long qualifier phrase (code-review 2026-07-14) — the class
  // bound is the correct, non-escapable scope. `*?` stays linear (no nested
  // quantifier, negated class → no catastrophic backtracking).
  const before = new RegExp(`\\b${NEG}\\b[^.!?;\\n]*?${familyTargetBody}`, 'i');
  const after = new RegExp(`${familyTargetBody}[^.!?;\\n]*?\\b${NEG}\\b`, 'i');
  return before.test(clause) || after.test(clause);
}

// Split a prompt into clause-sized units so a permission cue in one clause
// cannot reach a target in an unrelated clause. Split on sentence terminators
// AND coordinating/subordinating boundaries (", but", "; ", " but ", " however ")
// so a single run-on sentence with a forbid and a grant is still separated.
function splitClauses(prompt: string): string[] {
  return prompt
    .split(/(?<=[.!?;\n])\s+|\s*[,;]\s*(?=but\b|however\b|although\b|though\b|except\b)|\s+\bbut\b\s+|\s+\bhowever\b\s+/i)
    .filter((c) => c.trim().length > 0);
}

/**
 * A clause "requests a switch" if it carries a conditional user-request
 * ("if I ask") OR a switch verb in an IMPERATIVE / permission-modal position
 * ("you may use…", "then consult…"). A switch verb used descriptively by a
 * third-person subject ("the paper discusses using my experience") is NOT a
 * switch cue — that is prose about the document, not an instruction to pull a
 * different source.
 */
function clauseHasSwitchCue(clause: string): boolean {
  return SWITCH_REQUEST_RE.test(clause)
    || SWITCH_VERB_MODAL_RE.test(clause)
    || SWITCH_VERB_IMPERATIVE_RE.test(clause);
}

/**
 * Which non-default source families does the prompt explicitly GRANT switching
 * to? A family is granted only when SOME clause both (a) carries a user-directed
 * switch cue AND (b) names that family's target with NO negation governing it in
 * that clause — AND the family is NOT forbidden ANYWHERE in the prompt.
 *
 * The forbid is computed PROMPT-WIDE and subtracted last (code-review
 * 2026-07-14): a résumé forbid in one clause must dominate a résumé grant in a
 * DIFFERENT clause, because the whole profile family collapses to a single
 * `profile` switch capability downstream (electron/intelligence/context-os/
 * explicitSourceSwitch.ts) — so granting `profile` at all re-admits the
 * forbidden artifact. When a prompt both forbids and re-grants the same family,
 * the safe direction on that contradiction is NO grant (stay strict, no leak).
 *
 * GENERAL shape detection — no document/company/entity/mode name is referenced.
 * Errs toward NOT granting: an unclear prompt keeps the safe strict behavior.
 */
function grantedFamiliesFromPrompt(customContext: string): Set<ModeSourceSwitch> {
  const prompt = foldAccents(customContext || '');
  const clauses = splitClauses(prompt);
  const FAMILIES = ['job_description', 'profile', 'transcript'] as const;

  // Pass 1: families forbidden ANYWHERE in the prompt (any clause, bidirectional).
  const forbidden = new Set<ModeSourceSwitch>();
  for (const clause of clauses) {
    for (const family of FAMILIES) {
      if (familyForbiddenInClause(clause, FAMILY_TARGET_RE[family].source)) forbidden.add(family);
    }
  }

  // Pass 2: families affirmatively granted by some switch-cue clause naming a
  // non-negated target for that family.
  const granted = new Set<ModeSourceSwitch>();
  for (const clause of clauses) {
    if (!clauseHasSwitchCue(clause)) continue;
    for (const family of FAMILIES) {
      if (granted.has(family)) continue;
      // The GRANT signal: does the clause name this family's switch target?
      // Profile uses the strong/weak-possessive split (a bare doc-internal
      // "projects"/"experience" is NOT a grant); JD and transcript use their
      // plain target.
      const namesTarget = family === 'profile'
        ? clauseNamesProfileGrantTarget(clause)
        : FAMILY_TARGET_RE[family].test(clause);
      if (!namesTarget) continue;
      // Local (same-clause) forbid still suppresses immediately.
      if (familyForbiddenInClause(clause, FAMILY_TARGET_RE[family].source)) continue;
      granted.add(family);
    }
  }

  // Pass 3: a prompt-wide forbid on a family dominates any grant of it.
  for (const family of forbidden) granted.delete(family);

  // Pass 4: a self-contradicting RETRACTION ("…use my resume if I ask, but you
  // should really never do that") negates a deictic that a regex cannot bind to
  // a specific family, so it revokes the ENTIRE grant set — the conservative,
  // no-leak reading of a prompt that both grants and walks back. Legitimate
  // grants never contain this shape (they negate concrete non-switch nouns like
  // "never go outside the document", which RETRACTION_RE does not match).
  if (granted.size > 0 && clauses.some((c) => RETRACTION_RE.test(c))) {
    granted.clear();
  }
  return granted;
}

/**
 * Does the prompt explicitly GRANT the user permission to switch to ANY
 * non-document source (profile / JD / meeting) on request? True iff at least
 * one family is granted by `grantedFamiliesFromPrompt`. GENERAL shape detection
 * only. A false negative keeps the safe `reference_files_only` behavior (no
 * leak); a false positive would loosen a genuinely strict mode, so the detector
 * is deliberately conservative (narrow cues, bidirectional per-clause negation).
 */
export function promptGrantsExplicitSourceOverride(customContext: string): boolean {
  return grantedFamiliesFromPrompt(customContext).size > 0;
}

/**
 * The concrete `allowedExplicitSwitches` for a prompt-migrated
 * `reference_files_primary` mode: exactly the families the prompt granted
 * (never a family it forbade). Only called when
 * `promptGrantsExplicitSourceOverride` is already true, so the set is non-empty.
 */
function grantedSwitchesFromPrompt(customContext: string): ModeSourceSwitch[] {
  return Array.from(grantedFamiliesFromPrompt(customContext));
}

/**
 * One-time migration for a legacy mode with no persisted contract yet.
 *
 * CRITICAL invariant (incident fix): a mode with reference files whose
 * prompt does NOT clearly satisfy the strict legacy detector NEVER migrates
 * to `general_mixed` (everything allowed) — that silent promotion is
 * exactly the leak this incident is about. It migrates to `ask_if_ambiguous`
 * (`defaultOwner: 'clarify'`) instead, so an ambiguous question triggers a
 * source-honest clarification rather than a silent profile/document mix.
 */
export function migrateSourceContractFromPrompt(input: {
  customContext: string;
  hasReferenceFiles: boolean;
  hasProfileFacts: boolean;
}): ModeSourceContract {
  const { customContext, hasReferenceFiles, hasProfileFacts } = input;
  const hasCustomPrompt = (customContext || '').trim().length > 0;

  if (hasReferenceFiles && legacyPromptDetectsStrictDocumentGrounding(customContext)) {
    // The strict detector fired on the DEFAULT clause ("answer from the
    // uploaded document"). But a prompt can ALSO explicitly grant switching
    // ("…but if I ask, use my résumé or the JD"). Only lock to the
    // `reference_files_only` PRISON when the prompt does NOT also grant an
    // explicit override — otherwise the mode is reference-file-PRIMARY
    // (default doc, explicit switches allowed), matching what the author
    // actually wrote (rev-2 real-app source-switch repair, 2026-07-14).
    if (promptGrantsExplicitSourceOverride(customContext)) {
      return {
        version: 1,
        defaultOwner: 'reference_files',
        allowedExplicitSwitches: grantedSwitchesFromPrompt(customContext),
        sourceAuthority: 'reference_files_primary',
        evidenceRequired: true,
        conflictPolicy: 'reference_files_win',
        memoryPolicy: { allowPriorAssistantFacts: false, allowPriorAssistantReferents: true, allowHindsight: false },
        origin: 'migrated_from_prompt',
        migrationRevision: CURRENT_MIGRATION_REVISION,
      };
    }
    // HIGH CONFIDENCE: genuinely exclusive prompt — preserve the exact prior
    // strict behavior (hard prison, no switches).
    return {
      version: 1,
      defaultOwner: 'reference_files',
      allowedExplicitSwitches: [],
      sourceAuthority: 'reference_files_only',
      evidenceRequired: true,
      conflictPolicy: 'reference_files_win',
      memoryPolicy: { allowPriorAssistantFacts: false, allowPriorAssistantReferents: true, allowHindsight: false },
      origin: 'migrated_from_prompt',
      migrationRevision: CURRENT_MIGRATION_REVISION,
    };
  }

  if (hasReferenceFiles && hasCustomPrompt) {
    // AMBIGUOUS: has files, but the prompt doesn't clearly declare
    // exclusivity. NEVER promote to general_mixed (everything allowed) — that
    // silent promotion is exactly the P0 incident. `reference_files_primary`
    // is the correct migration target (not `ask_if_ambiguous`): the kernel
    // resolves it to sourceOwner='reference_files' for EVERY question in this
    // mode (docs/context-os/real-custom-mode-repair/05_PRODUCT_SOURCE_POLICY.md
    // — "default owner: reference files"), not only questions that happen to
    // match an ambiguous-term regex, while explicit "answer from my résumé"
    // asks still work via sourceOwnership.ts's reference_files_primary case.
    // Note: 'transcript' is intentionally NOT in allowedExplicitSwitches here.
    // Live STT is always-on implicit context (ProviderDataScope) during a
    // session, never a user-settable switch. Including it would persist a
    // user-settable signal that the runtime then ignores — inconsistent state.
    return {
      version: 1,
      defaultOwner: 'reference_files',
      allowedExplicitSwitches: ['profile', 'job_description'],
      sourceAuthority: 'reference_files_primary',
      evidenceRequired: true,
      conflictPolicy: 'reference_files_win',
      memoryPolicy: { allowPriorAssistantFacts: false, allowPriorAssistantReferents: true, allowHindsight: false },
      origin: 'migrated_from_prompt',
      migrationRevision: CURRENT_MIGRATION_REVISION,
    };
  }

  if (hasCustomPrompt && hasProfileFacts && !hasReferenceFiles) {
    return {
      version: 1,
      defaultOwner: 'profile',
      allowedExplicitSwitches: ['job_description'],
      sourceAuthority: 'profile_only',
      evidenceRequired: false,
      conflictPolicy: 'profile_wins',
      memoryPolicy: { allowPriorAssistantFacts: true, allowPriorAssistantReferents: true, allowHindsight: true },
      origin: 'migrated_from_prompt',
      migrationRevision: CURRENT_MIGRATION_REVISION,
    };
  }

  return {
    version: 1,
    defaultOwner: 'clarify',
    allowedExplicitSwitches: ['reference_files', 'profile', 'job_description'],
    sourceAuthority: 'ask_if_ambiguous',
    evidenceRequired: false,
    conflictPolicy: 'ask_clarification',
    memoryPolicy: { allowPriorAssistantFacts: true, allowPriorAssistantReferents: true, allowHindsight: true },
    origin: 'migrated_from_prompt',
    migrationRevision: CURRENT_MIGRATION_REVISION,
  };
}

// ── Serialization ────────────────────────────────────────────────────────

export function serializeModeSourceContract(contract: ModeSourceContract): string {
  return JSON.stringify(contract);
}

/** Parses + shape-validates. Returns null on any malformed/missing/older-version input. */
export function parseModeSourceContract(json: string | null | undefined): ModeSourceContract | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.version !== 1) return null;
    if (typeof parsed.defaultOwner !== 'string') return null;
    if (typeof parsed.sourceAuthority !== 'string') return null;
    if (!Array.isArray(parsed.allowedExplicitSwitches)) return null;
    if (typeof parsed.evidenceRequired !== 'boolean') return null;
    if (typeof parsed.conflictPolicy !== 'string') return null;
    if (!parsed.memoryPolicy || typeof parsed.memoryPolicy !== 'object') return null;
    if (typeof parsed.origin !== 'string') return null;
    return parsed as ModeSourceContract;
  } catch {
    return null;
  }
}

// ── Derived flags for legacy call sites ─────────────────────────────────────
//
// `documentGrounded` / `documentGroundedCustomModeActive` remain the field
// names ~65 call sites already read (ModesManager.ActiveModeDocumentGroundingInfo).
// They are now PURE functions of the persisted contract instead of live regex
// re-evaluation, closing the incident's root cause while preserving every
// existing consumer's contract.

export function documentGroundedFromContract(contract: ModeSourceContract, hasReferenceFiles: boolean): boolean {
  if (!hasReferenceFiles) return false;
  return contract.sourceAuthority === 'reference_files_only'
    || contract.sourceAuthority === 'reference_files_primary'
    || contract.sourceAuthority === 'reference_files_plus_transcript';
}
