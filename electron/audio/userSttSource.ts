/**
 * Active user-speech STT source policy (InterviewMan / ADR 0015).
 *
 * One device owns user-mic STT at a time — last-armed wins. Desktop remains
 * the LLM host; this only selects which mic transcript stream is accepted.
 *
 * Glossary: phone-stt-source
 */

export type UserSttSource = 'desktop' | 'phone' | 'none';

/** Phone arms as the active user-speech STT source (last-armed wins). */
export function armPhoneUserSttSource(_current?: UserSttSource): UserSttSource {
  return 'phone';
}

/** Desktop mic arms as the active user-speech STT source (last-armed wins). */
export function armDesktopUserSttSource(_current?: UserSttSource): UserSttSource {
  return 'desktop';
}

/** Clear active user-STT source (meeting end / explicit none). */
export function disarmUserSttSource(_current?: UserSttSource): UserSttSource {
  return 'none';
}

/**
 * Phone releases its arm. Restore desktop so the meeting does not lose
 * user-mic STT after the phone stops owning the source.
 */
export function releasePhoneUserSttSource(current: UserSttSource): UserSttSource {
  return current === 'phone' ? 'desktop' : current;
}

/** Whether a transcript from `from` should be ingested into the session. */
export function shouldAcceptUserSttFrom(
  active: UserSttSource,
  from: 'desktop' | 'phone',
): boolean {
  return active === from;
}

/** Overlay / status pill label for the active user-STT source. */
export function labelUserSttSource(source: UserSttSource): string {
  switch (source) {
    case 'phone':
      return 'Phone';
    case 'desktop':
      return 'Desktop mic';
    default:
      return 'None';
  }
}

export interface PhoneSttIngestPlan {
  accept: boolean;
  text?: string;
  final?: boolean;
  speaker?: 'user';
  /** Spoken provenance — same eligibility as desktop mic STT. */
  origin?: 'stt';
}

const MAX_PHONE_STT_TEXT = 2000;

/**
 * Decide whether a phone-stt-transcript payload should merge into the desktop
 * session + always-on live transcript display path.
 */
export function planPhoneSttIngest(
  active: UserSttSource,
  text: unknown,
  final?: unknown,
): PhoneSttIngestPlan {
  if (active !== 'phone') return { accept: false };
  if (typeof text !== 'string') return { accept: false };
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_PHONE_STT_TEXT) return { accept: false };
  return {
    accept: true,
    text: trimmed,
    final: final === undefined ? true : Boolean(final),
    speaker: 'user',
    origin: 'stt',
  };
}
