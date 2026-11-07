// The Pro (or trial) gate for IPC handlers outside Connectors (Connectors have
// their own: outputs/connectorAccess.ts). Two things live here:
//
//   1. proRefusal(): the one answer a Pro handler gives without Pro or a trial.
//      Before 2026-11-07 it came in three shapes ('pro_required', 'Pro license
//      required.', and a longer sentence), so an upgrade prompt keyed on
//      'pro_required' missed a third of them. `error` is always the code; the
//      words are in `message` (src/lib/proRefusal.ts shows them).
//   2. The channel lists. Every IPC channel under a Pro prefix is either Pro
//      (it must check proAccess.isProOrTrialActive() and refuse with proRefusal)
//      or deliberately free (reads, deletes, turning something off). A new
//      channel in neither list fails ProIpcGateDrift2026_11_07.test.mjs, so a
//      Pro feature cannot ship ungated by being forgotten.
//
// No platform branches: the licence and trial stores behind
// isProOrTrialActive hide the macOS Keychain / Windows DPAPI differences.

export const PRO_REQUIRED = 'pro_required' as const;

export const PRO_REQUIRED_MESSAGE = 'This is part of Natively Pro. Activate a licence or start the free trial to use it.';

export function proRefusal<T extends Record<string, unknown> = Record<string, never>>(
  message: string = PRO_REQUIRED_MESSAGE,
  extra?: T,
): { success: false; error: typeof PRO_REQUIRED; message: string } & T {
  return { ...(extra ?? ({} as T)), success: false, error: PRO_REQUIRED, message };
}

/** Channel prefixes whose handlers are Pro features or sit right beside them. */
export const PRO_IPC_PREFIXES = ['profile:', 'knowledge:', 'modes:', 'roleInsight:', 'live-notes:', 'user-bio-'] as const;

/**
 * Pro or trial. Each handler checks isProOrTrialActive() itself (some only for
 * one argument: switching on, a Pro mode, a Pro template) and refuses with
 * proRefusal().
 */
export const PRO_IPC_CHANNELS: readonly string[] = [
  // Profile Intelligence
  'profile:upload-resume',
  'profile:upload-jd',
  'profile:set-mode', // switching on
  'profile:research-company',
  'profile:generate-negotiation',
  'profile:generate-cover-letter',
  'profile:save-own-answer',
  'profile:use-own-answer-drafts',
  'profile:draft-own-answers',
  'user-bio-set', // saving text; clearing it is free
  // Knowledge packs
  'knowledge:export-profile-pack',
  'knowledge:list-profile-packs',
  'knowledge:get-profile-pack',
  'knowledge:regenerate-pack',
  'knowledge:export-pack',
  'knowledge:edit-card',
  'knowledge:approve-card',
  'knowledge:reject-card',
  'knowledge:restore-card-version',
  // Role Insight
  'roleInsight:analyse',
  'roleInsight:apply-correction',
  'roleInsight:answer-clarification',
  'roleInsight:save-to-profile',
  'roleInsight:paste-jd',
  'roleInsight:import-jd-url',
  // Modes
  'modes:create',
  'modes:generate-from-brief',
  'modes:update',
  'modes:build-user-source-contract',
  'modes:delete',
  'modes:set-active', // a Pro mode; General and clearing are free
  'modes:upload-reference-file',
  'modes:delete-reference-file',
  'modes:add-note-section',
  'modes:update-note-section',
  'modes:delete-note-section',
  'modes:apply-note-template',
  'modes:remove-all-note-sections',
  // Live notes
  'live-notes:set-template', // a Pro template
];

/**
 * Pro channels that check Pro but cannot answer with proRefusal, because their
 * caller reads any object as success. Each says what it answers instead.
 */
export const PRO_CHANNELS_REFUSING_OTHERWISE: Readonly<Record<string, string>> = {
  'modes:build-user-source-contract': 'answers null: the Modes editor treats any object as a built contract, null as not built',
};

/** Under a Pro prefix, free on purpose: reading, deleting, cancelling, the notepad itself. */
export const FREE_IPC_CHANNELS: readonly string[] = [
  'profile:delete',
  'profile:delete-jd',
  'profile:get-company-dossier',
  'profile:get-negotiation-state',
  'profile:get-own-answers',
  'profile:get-profile',
  'profile:get-status',
  'profile:reset-negotiation',
  'profile:select-file',
  'user-bio-get',
  'knowledge:get-card-history',
  'knowledge:get-pack',
  'knowledge:list-packs',
  'roleInsight:cancel',
  'roleInsight:get-report', // reads; its auto-refresh is Pro-checked
  'roleInsight:get-status',
  'roleInsight:list-history',
  'modes:get-active',
  'modes:get-all',
  'modes:get-default-note-sections',
  'modes:get-note-sections',
  'modes:get-reference-file-status',
  'modes:get-reference-files',
  'modes:get-source-contract',
  'live-notes:attach-image',
  'live-notes:calendar-candidates', // Calendar is free
  'live-notes:get-state',
  'live-notes:get-template',
  'live-notes:link-event', // Calendar is free
  'live-notes:meeting-info',
  'live-notes:set-attendees',
  'live-notes:set-title',
  'live-notes:shorten-line',
];
