/**
 * Map calendar-connect IPC / OAuth errors to user-facing copy (#257).
 * IPC returns `{ success: false, error }` without throwing — callers must
 * surface these strings or the Connect button looks dead.
 */
export function formatCalendarConnectError(raw: unknown): string {
  const msg = typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : '';
  const lower = msg.toLowerCase();

  if (!msg.trim()) {
    return 'Could not connect calendar. Please try again.';
  }
  if (lower.includes('google_client_id') || lower.includes('not configured')) {
    return 'Calendar isn’t configured in this build. Update Natively or set GOOGLE_CLIENT_ID for local development.';
  }
  if (
    lower.includes('access_denied') ||
    lower.includes('access denied') ||
    lower.includes('403') ||
    lower.includes('not verified') ||
    lower.includes('unverified')
  ) {
    return 'Google sign-in was blocked. Calendar sync is limited to approved test accounts until Google finishes verifying the app.';
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return 'Google sign-in didn’t finish in time. Complete consent in the browser, or try again.';
  }
  if (lower.includes('eaddrinuse') || lower.includes('address already in use')) {
    return 'Calendar auth port is already in use. Close other Natively windows and try again.';
  }
  return msg;
}
