'use strict';
/**
 * Run create-dmg with a retry for its flaky Finder step (macOS only).
 *
 * create-dmg lays out the DMG window by driving Finder over AppleScript. That step
 * fails now and then (create-dmg itself sleeps 2 s to dodge "Can't get disk
 * (-1728)"), more often while the machine is busy, e.g. signing the other arch.
 * When it fails, create-dmg detaches the image and exits 64, leaving its 2-3 GB
 * read-write working image ("rw.<pid>.<dmg name>") next to the output. Seen in
 * the 2026-11-16 signed build: the early arm64 DMG job died this way after 27 s,
 * and the same command passed when run again.
 *
 * So: exit 64 → remove the leftover working image, wait, try again (up to
 * `maxAttempts` in all). Exit 2 → create-dmg built and signed the DMG but could not
 * write the window layout; the DMG is usable, so accept it (as before). Any other
 * failure, or 64 on the last attempt → throw a SHORT error naming the exit code
 * (the full command line used to fill the job's 500-char error field, hiding why).
 */
const fs = require('fs');
const path = require('path');

const EXIT_COSMETIC = 2;
const EXIT_FINDER_LAYOUT = 64;

/** create-dmg's leftover working images for this output DMG, e.g. rw.33719.Natively-3.2.0-arm64.dmg */
function leftoverWorkImages(outDmg, fsImpl = fs) {
  const dir = path.dirname(outDmg);
  const name = path.basename(outDmg);
  let entries = [];
  try { entries = fsImpl.readdirSync(dir); } catch { return []; }
  return entries
    .filter((f) => f.startsWith('rw.') && f.endsWith(`.${name}`) && /^rw\.\d+\./.test(f))
    .map((f) => path.join(dir, f));
}

function removeLeftoverWorkImages(outDmg, { fsImpl = fs, log = console } = {}) {
  for (const f of leftoverWorkImages(outDmg, fsImpl)) {
    try {
      fsImpl.rmSync(f, { force: true });
      log.log(`[dmg] removed create-dmg's leftover working image ${path.basename(f)}`);
    } catch (e) {
      log.warn(`[dmg] could not remove ${path.basename(f)}: ${e && e.message}`);
    }
  }
}

function describeExit(status) {
  if (status === EXIT_FINDER_LAYOUT) return 'exit 64: Finder layout (AppleScript) step failed';
  if (status == null) return 'killed or could not start';
  return `exit ${status}`;
}

/**
 * @param {object} o
 * @param {string[]} o.args       create-dmg arguments (output DMG and source folder last)
 * @param {string}   o.outDmg     the output DMG path
 * @param {Function} [o.exec]     (cmd, args, opts) => void; throws {status} on failure
 * @returns {'ok'|'cosmetic'}
 */
function runCreateDmg({
  args,
  outDmg,
  exec = (cmd, a, opts) => require('child_process').execFileSync(cmd, a, opts),
  fsImpl = fs,
  sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  log = console,
  maxAttempts = 3,
  retryDelayMs = 5000,
}) {
  for (let attempt = 1; ; attempt++) {
    try {
      exec('create-dmg', args, { stdio: 'inherit' });
      return 'ok';
    } catch (e) {
      const status = e && typeof e.status === 'number' ? e.status : null;
      removeLeftoverWorkImages(outDmg, { fsImpl, log });
      if (status === EXIT_COSMETIC && fsImpl.existsSync(outDmg)) {
        log.warn('[dmg] create-dmg exit 2 (cosmetic layout skipped) — dmg built + signed OK.');
        return 'cosmetic';
      }
      if (status === EXIT_FINDER_LAYOUT && attempt < maxAttempts) {
        log.warn(`[dmg] create-dmg ${describeExit(status)} — retrying (${attempt + 1}/${maxAttempts}) in ${Math.round(retryDelayMs * attempt / 1000)} s…`);
        if (fsImpl.existsSync(outDmg)) fsImpl.rmSync(outDmg, { force: true });
        sleepSync(retryDelayMs * attempt);
        continue;
      }
      const err = new Error(`create-dmg failed for ${path.basename(outDmg)} (${describeExit(status)}, attempt ${attempt}/${maxAttempts})`);
      err.status = status;
      err.cause = e;
      throw err;
    }
  }
}

module.exports = {
  EXIT_COSMETIC,
  EXIT_FINDER_LAYOUT,
  leftoverWorkImages,
  removeLeftoverWorkImages,
  runCreateDmg,
};
