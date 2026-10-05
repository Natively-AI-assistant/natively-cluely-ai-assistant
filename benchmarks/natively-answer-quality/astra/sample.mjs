// Deterministic per-mode subset, so two answer sets judged separately (a replay variant and its control, or an
// in-app run and a replay) land on the SAME items. Order = sha256 of a fixed salt + id, first n per mode.
import crypto from 'node:crypto';

const rank = (id) => crypto.createHash('sha256').update(`astra-sample-v1:${id}`).digest('hex');

/** ids: iterable of benchmark ids; modeOf(id) → mode; n per mode. Returns a Set of the chosen ids. */
export function samplePerMode(ids, modeOf, n) {
  const by = {};
  for (const id of new Set(ids)) (by[modeOf(id)] ??= []).push(id);
  const out = new Set();
  for (const list of Object.values(by)) for (const id of list.sort((a, b) => rank(a).localeCompare(rank(b))).slice(0, n)) out.add(id);
  return out;
}
