/**
 * Pure, unit-tested decision helpers for streaming-STT reconnection.
 *
 * Context: the streaming providers (Soniox, Deepgram, ElevenLabs, …) cap
 * automatic reconnects at RECONNECT_MAX_ATTEMPTS and then latch
 * `shouldReconnect = false` so a flapping endpoint can't storm forever. But
 * that latch is permanent for the life of the session: once it trips, the
 * write()-driven lazy reconnect never fires again, so the STT is dead until the
 * user manually stops/starts the meeting.
 *
 * Real-world failure (reported): the user hides the app for a while. During the
 * silent/hidden stretch the socket drops and the backoff ladder quietly burns
 * all its attempts (≈2 min with exponential backoff). When the user comes back
 * and speaks, audio flows into write() again — but `shouldReconnect` is already
 * latched off, so nothing reconnects and the UI sits on "STT reconnecting"
 * forever.
 *
 * Fix: genuine audio arriving at write() means the capture pipeline is alive and
 * the user wants transcription again. Grant the session ONE fresh reconnect
 * budget instead of staying dead — but only after a cooldown since the last
 * exhaustion, so a genuinely-dead endpoint can't be re-stormed on every chunk.
 *
 * These functions are pure so they can be unit-tested without a WebSocket,
 * network, or Electron. See sttReconnectPolicy.test.mjs.
 */

/** Default gap after exhaustion before resumed audio may trigger a revival. */
export const DEFAULT_REVIVE_COOLDOWN_MS = 15000;

/**
 * Decide whether a write() carrying real audio should REVIVE a session whose
 * automatic reconnect was exhausted and latched off.
 *
 * @param {object} s
 * @param {boolean} s.isActive       Session is still active (NOT stopped by the user).
 * @param {boolean} s.shouldReconnect Auto-reconnect flag; false after exhaustion OR after stop().
 * @param {boolean} s.isConnecting   A connect() attempt is already in flight.
 * @param {boolean} s.hasSocket      A live socket already exists.
 * @param {number|null} s.exhaustedAt Timestamp (ms) when reconnect was exhausted, or null if it wasn't.
 * @param {number} s.now             Current time (ms).
 * @param {number} [s.cooldownMs]    Min gap since exhaustion before reviving.
 * @returns {boolean}
 */
export function shouldReviveExhaustedReconnect({
  isActive,
  shouldReconnect,
  isConnecting,
  hasSocket,
  exhaustedAt,
  now,
  cooldownMs = DEFAULT_REVIVE_COOLDOWN_MS,
}) {
  // Only revive a session that is still active (a user stop() sets isActive=false
  // AND shouldReconnect=false — we must never resurrect after a real stop).
  if (!isActive) return false;
  // If reconnect is still enabled, the normal lazy-reconnect path handles it.
  if (shouldReconnect) return false;
  // Don't stack a revival on top of an in-flight connect or a live socket.
  if (isConnecting || hasSocket) return false;
  // Only revive an EXHAUSTED session (exhaustedAt set). A latch with no
  // exhaustion timestamp is a normal stop() — leave it dead.
  if (exhaustedAt === null || exhaustedAt === undefined) return false;
  // Rate-limit: wait out the cooldown so a truly-dead endpoint isn't re-stormed
  // on every incoming chunk.
  return now - exhaustedAt >= cooldownMs;
}
