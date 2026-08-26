/**
 * Pure input-device selection logic, shared by the microphone picker
 * (AudioDevices / SettingsOverlay), the meeting audio pipeline (main.ts) and
 * the launcher's saved-preference read (App.tsx).
 *
 * Authored as .mjs + .d.mts (same pattern as systemAudioHealthClassifier.mjs)
 * so the node:test suite imports the REAL implementation instead of asserting
 * on main.ts source text.
 *
 * CROSS-PLATFORM: no platform branches, and none are wanted.
 *   - The internal-device filter is a name match. macOS is the only platform
 *     that produces the name today; on Windows/WASAPI nothing matches and the
 *     filter is inert, so both platforms run identical code.
 *   - resolveRequestedInputDevice mirrors the tier order of
 *     `resolve_input_device` in native-module/src/microphone.rs, which is
 *     itself shared by the CoreAudio and WASAPI backends (not #[cfg]-gated).
 *     Keep the two in sync: this function decides whether we even ASK Rust to
 *     open a device, so a divergence turns a clean fallback back into the
 *     hard "Input device not found" error it exists to prevent.
 */

/**
 * Devices Natively creates for its OWN capture pipeline and must never offer
 * as a microphone.
 *
 * "NativelySystemAudioTap" is the CoreAudio aggregate device built by
 * native-module/src/speaker/core_audio.rs (`agg_name`) to tap system audio.
 * It is created with kAudioAggregateDeviceIsPrivateKey — but "private" only
 * hides it from OTHER processes. cpal's host.input_devices(), running inside
 * OUR process, enumerates it for as long as the tap is live, so it shows up in
 * the microphone dropdown ranked between the real mics and can be selected and
 * persisted as preferredInputDeviceId.
 *
 * It is not a microphone. It exists only while a meeting is capturing system
 * audio, and the mic channel starts BEFORE the tap is created — so a stored
 * selection makes every subsequent meeting fail with
 * "Input device 'NativelySystemAudioTap' not found".
 *
 * Keep in sync with `agg_name` in native-module/src/speaker/core_audio.rs.
 */
export const INTERNAL_CAPTURE_DEVICE_NAMES = Object.freeze(['NativelySystemAudioTap']);

/**
 * The synthetic "use the system default" row that Rust's list_input_devices()
 * prepends. It is NOT returned by host.input_devices(), so it must never be
 * treated as a match candidate — otherwise a stored "Default Microphone" would
 * resolve here and then fail in Rust.
 */
const DEFAULT_DEVICE_ID = 'default';

/**
 * Mirror of `normalize_device_name` in native-module/src/microphone.rs.
 * Strips the WASAPI "(2- " index prefix and the trailing paren, folds
 * en/em-dash and minus onto ASCII hyphen, lowercases.
 *
 * Character classes are deliberately ASCII-exact (`[(0-9\- ]`, not `\s`) to
 * match Rust's `is_ascii_digit()` / literal-space predicates.
 */
export function normalizeDeviceName(value) {
  const raw = typeof value === 'string' ? value : '';
  const stripped = raw
    .trim()
    .replace(/^[(0-9\- ]+/, '')
    .replace(/[) ]+$/, '');
  return stripped.replace(/[–—−]/g, '-').toLowerCase();
}

/** True when the id or name refers to one of Natively's own capture devices. */
export function isInternalCaptureDevice(idOrName) {
  if (typeof idOrName !== 'string' || !idOrName.trim()) return false;
  const normalized = normalizeDeviceName(idOrName);
  return INTERNAL_CAPTURE_DEVICE_NAMES.some(
    (internal) => normalizeDeviceName(internal) === normalized,
  );
}

/**
 * Drop Natively's own capture devices from an enumerated input list. Applied
 * at the single choke point (AudioDevices.getInputDevices) so the picker, the
 * I/O-conflict fallback, the built-in-mic lookup and the last-resort candidate
 * ladder all inherit it.
 */
export function filterSelectableInputDevices(devices) {
  if (!Array.isArray(devices)) return [];
  return devices.filter(
    (device) =>
      device &&
      !isInternalCaptureDevice(device.id) &&
      !isInternalCaptureDevice(device.name),
  );
}

/**
 * Decide what will happen when Rust is asked to open `requestedId`, WITHOUT
 * opening anything. Constructing the native capture is what lights the macOS
 * orange mic indicator, so availability must be answered from the enumeration
 * alone.
 *
 * Returns one of:
 *   { status: 'default' }  — no preference (null/empty/"default")
 *   { status: 'matched', id, name, tier }  — Rust will resolve this
 *   { status: 'missing', available }       — Rust will throw "not found"
 *
 * Tiers mirror Rust: 0 exact, 1 case-insensitive, 2 fuzzy-normalized.
 * (JS toLowerCase() folds Unicode where Rust's eq_ignore_ascii_case does not,
 * so tier 1 here is a superset. A device that matches here but not in Rust
 * simply falls through to Rust's own error path — never a worse outcome than
 * skipping this gate entirely.)
 */
export function resolveRequestedInputDevice(requestedId, devices) {
  const requested = typeof requestedId === 'string' ? requestedId.trim() : '';
  if (!requested || requested.toLowerCase() === DEFAULT_DEVICE_ID) {
    return { status: 'default' };
  }

  const normalizedRequest = normalizeDeviceName(requested);
  const requestedLower = requested.toLowerCase();
  const candidates = (Array.isArray(devices) ? devices : []).filter(
    (device) =>
      device && typeof device.name === 'string' && device.id !== DEFAULT_DEVICE_ID,
  );

  let best = null;
  for (const device of candidates) {
    let tier = null;
    if (device.name === requested) tier = 0;
    else if (device.name.toLowerCase() === requestedLower) tier = 1;
    else if (normalizeDeviceName(device.name) === normalizedRequest) tier = 2;
    if (tier === null) continue;

    if (!best || tier < best.tier) {
      best = { status: 'matched', id: device.id, name: device.name, tier };
      if (tier === 0) break;
    }
  }

  return best ?? { status: 'missing', available: candidates.map((d) => d.name) };
}
