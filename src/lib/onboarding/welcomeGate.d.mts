export declare const WELCOME_SEEN_KEY: 'natively_seen_welcome_v1';
export declare const LEGACY_PERMS_SHOWN_KEY: 'natively_perms_shown_v1';

export function shouldShowWelcome(
  flags: { seenStartup?: boolean; permsShown?: boolean } | null | undefined,
  local: { welcomeSeen?: boolean; permsShown?: boolean },
): boolean;
