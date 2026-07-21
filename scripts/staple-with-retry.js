#!/usr/bin/env node
/**
 * staple-with-retry.js — robust `xcrun stapler staple` with exponential backoff.
 *
 * WHY THIS EXISTS (the Error 65 staple race):
 *   `xcrun notarytool submit --wait` returns once Apple has DECIDED the verdict
 *   (Accepted/Invalid). But the notarization TICKET is published to Apple's
 *   CDN slightly later. `xcrun stapler staple` fetches that ticket from the
 *   CDN — so a staple fired immediately after `--wait` frequently fails with:
 *
 *     CloudKit query for X failed due to "Record not found".
 *     Could not find base64 encoded ticket in response for <cdhash>
 *     The staple and validate action failed! Error 65.
 *
 *   @electron/notarize (used by BOTH electron-builder's built-in
 *   `mac.notarize:true` AND scripts/notarize.js) does a SINGLE staple attempt
 *   with no retry, so this CDN-propagation lag fails the entire build even
 *   though notarization SUCCEEDED. This wrapper retries the staple with
 *   backoff until the ticket is available.
 *
 * USAGE:
 *   CLI:   node scripts/staple-with-retry.js <path-to-.app-or-.dmg> [maxAttempts] [baseDelayMs]
 *   Module: const { stapleWithRetry } = require('./scripts/staple-with-retry');
 *           await stapleWithRetry(appPath, { maxAttempts: 6, baseDelayMs: 15000 });
 *
 * Exit code 0 on success, 1 on exhausted retries.
 *
 * NOTE: This only retries Error 65 / "Record not found" (the propagation race).
 * A genuine notarization rejection (the binary signature is invalid) produces a
 * DIFFERENT failure at submit time, not here — so retrying staple is always safe:
 * if the ticket truly doesn't exist because notarization was Invalid, the submit
 * step already failed the build before we got here.
 */

const { execFileSync } = require('node:child_process');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Staple a notarized .app or .dmg, retrying through CDN-propagation lag.
 * @param {string} targetPath  absolute path to the .app or .dmg
 * @param {{maxAttempts?: number, baseDelayMs?: number}} [opts]
 */
async function stapleWithRetry(targetPath, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 6; // ~ up to 15+30+60+120+240s of waiting
  const baseDelayMs = opts.baseDelayMs ?? 15000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      execFileSync('xcrun', ['stapler', 'staple', targetPath], { stdio: 'inherit' });
      // Validate to be certain the ticket is actually attached.
      execFileSync('xcrun', ['stapler', 'validate', targetPath], { stdio: 'inherit' });
      console.log(`[staple-retry] ${targetPath} stapled + validated on attempt ${attempt}.`);
      return;
    } catch (err) {
      const isLast = attempt === maxAttempts;
      const msg = (err && err.message) || String(err);
      // Error 65 / "Record not found" is the propagation race we retry.
      // Any other staple error is unexpected — surface it but still retry
      // (cheap, and Apple's CDN errors are not always consistently worded).
      if (isLast) {
        console.error(`[staple-retry] FAILED after ${maxAttempts} attempts: ${msg}`);
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(
        `[staple-retry] attempt ${attempt}/${maxAttempts} failed (likely CDN propagation lag); ` +
          `retrying in ${Math.round(delay / 1000)}s…`
      );
      await sleep(delay);
    }
  }
}

module.exports = { stapleWithRetry };

// CLI entry point.
if (require.main === module) {
  const [, , target, maxAttemptsArg, baseDelayArg] = process.argv;
  if (!target) {
    console.error('Usage: node scripts/staple-with-retry.js <path-to-.app-or-.dmg> [maxAttempts] [baseDelayMs]');
    process.exit(1);
  }
  stapleWithRetry(target, {
    maxAttempts: maxAttemptsArg ? Number(maxAttemptsArg) : undefined,
    baseDelayMs: baseDelayArg ? Number(baseDelayArg) : undefined,
  })
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
