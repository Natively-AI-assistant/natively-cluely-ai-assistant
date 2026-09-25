/**
 * Fold a `phone-mirror:status` broadcast into the Settings pane's PhoneMirrorInfo
 * (pure, unit-tested, platform-agnostic).
 *
 * Extracted from PhoneMirrorSettings' onPhoneMirrorStatus handler on 2026-09-22
 * after "Allow LAN access → confirm → toggle snaps back OFF and the Enable row
 * reads 'port undefined · bound to undefined (loopback only)'".
 *
 * The launcher window deliberately receives only the small flag subset of a
 * status broadcast — { running, enabled, clients, extensionConnected, extPairedAt } — see the
 * onStatusChange listener in electron/ipcHandlers.ts (large payloads into a
 * software-composited Windows launcher hurt paint). PhoneMirrorSettings is
 * mounted INSIDE the launcher (SettingsOverlay) and holds the full snapshot it
 * got from get-info / the enable / set-lan reply. Treating every broadcast as a
 * full snapshot replaced that object wholesale, so port / bindAddress /
 * exposeOnLan / URLs / tokens became undefined ~150 ms (the service's status
 * debounce) after the IPC reply had painted the right values.
 *
 * Rules:
 *  - full snapshot → same short-circuit as before: identical qr / url / tokens /
 *    running / clients / extensionConnected / extPairedAt keeps `prev` (React skips the
 *    render); anything else replaces the state with the snapshot.
 *  - partial (flag subset) → only the known flags it actually carries are laid
 *    over `prev`; nothing else is touched. Same object back when none changed.
 *    Callers should follow a partial payload with a get-info refetch: the
 *    subset cannot describe a restart (new port / bind host / URLs).
 */

/** Flags the launcher-side subset may carry. Anything else is ignored. */
const PARTIAL_KEYS = ['running', 'enabled', 'clients', 'extensionConnected', 'extPairedAt'];

/**
 * @param {unknown} next
 * @returns {boolean} true unless `next` is a full PhoneMirrorInfo (has the
 *   resolved `port` and `bindAddress` only snapshot() fills in).
 */
export function isPartialPhoneMirrorStatus(next) {
  if (!next || typeof next !== 'object') return true;
  const n = /** @type {Record<string, unknown>} */ (next);
  return typeof n.port !== 'number' || typeof n.bindAddress !== 'string';
}

/**
 * @template {Record<string, any>} T
 * @param {T} prev current PhoneMirrorInfo state
 * @param {unknown} next payload of a `phone-mirror:status` broadcast
 * @returns {T} the next state — `prev` itself when nothing changed
 */
export function mergePhoneMirrorStatus(prev, next) {
  if (!next || typeof next !== 'object') return prev;
  const n = /** @type {Record<string, any>} */ (next);

  if (!isPartialPhoneMirrorStatus(n)) {
    if (
      prev &&
      prev.qrDataUrl === n.qrDataUrl &&
      prev.primaryUrl === n.primaryUrl &&
      prev.token === n.token &&
      prev.extToken === n.extToken &&
      prev.running === n.running &&
      prev.clients === n.clients &&
      prev.extensionConnected === n.extensionConnected &&
      prev.extPairedAt === n.extPairedAt
    ) {
      return prev;
    }
    return /** @type {T} */ (n);
  }

  let changed = false;
  const merged = { ...prev };
  for (const key of PARTIAL_KEYS) {
    if (!(key in n) || n[key] === undefined) continue;
    if (prev[key] === n[key]) continue;
    merged[key] = n[key];
    changed = true;
  }
  return changed ? merged : prev;
}

/**
 * Has the extension pairing window Settings opened at `armedAt` done its job?
 * Yes once the extension is connected AND the service stamped a successful
 * /pair at or after `armedAt`. The stamp is what a Re-pair needs: the extension
 * stays connected on the same token, so extensionConnected never changes. A
 * stamp from before this window (an earlier pairing) does not count.
 *
 * @param {{ extensionConnected?: boolean, extPairedAt?: number } | null | undefined} info
 * @param {number} armedAt epoch ms when this window was opened (renderer Date.now())
 * @returns {boolean}
 */
export function extensionPairingSatisfied(info, armedAt) {
  if (!info || !info.extensionConnected) return false;
  const stamp = typeof info.extPairedAt === 'number' ? info.extPairedAt : 0;
  return stamp > 0 && stamp >= armedAt;
}
