#!/usr/bin/env node
/**
 * notarize.js — electron-builder `afterSign` hook (ACTIVE production path).
 *
 * This is the wired `afterSign` hook for electron-builder.signed.cjs, which now
 * sets `mac.notarize: false` so electron-builder does NOT run its own built-in
 * notarize+staple. We do it here instead, because we need a STAPLE RETRY:
 *
 *   THE Error 65 STAPLE RACE:
 *   `notarytool --wait` (and @electron/notarize's submit-and-wait) returns once
 *   Apple has DECIDED the verdict, but the notarization TICKET is published to
 *   Apple's CDN slightly later. `xcrun stapler staple` fetches that ticket — so a
 *   staple fired immediately after the verdict frequently fails with:
 *     CloudKit query … "Record not found" → The staple and validate action failed! Error 65.
 *   @electron/notarize staples exactly once with no retry, so this CDN lag was
 *   failing the entire signed build even though notarization SUCCEEDED.
 *
 *   FIX: we let @electron/notarize do the (robust) zip-and-submit + first staple
 *   attempt, but if that first staple hits the propagation race, we recover with
 *   scripts/staple-with-retry.js (exponential backoff) instead of failing the build.
 *
 * DMGs are still produced + notarized + stapled by scripts/afterAllArtifactBuild.cjs.
 *
 * Submits the freshly code-signed .app to Apple's notary service (notarytool)
 * and staples the resulting ticket to the bundle. @electron/notarize v3 performs
 * BOTH the submit-and-wait and the staple in one call.
 *
 * SAFETY / NON-BREAKING CONTRACT:
 *   - No-op on non-macOS.
 *   - No-op when notarization credentials are absent (local / dev / ad-hoc builds).
 *     This means `npm run app:build` (the ad-hoc dev path) is completely unaffected —
 *     it never tries to notarize and never fails for lack of an Apple account.
 *   - No-op when NATIVELY_SKIP_NOTARIZE=1 is set (explicit escape hatch).
 *   - Notarization only runs when one of the three credential strategies is fully
 *     configured via environment variables (see below). This is the production path.
 *
 * Credential strategies (pick ONE; checked in this order):
 *   1) App Store Connect API key (recommended for CI):
 *        APPLE_API_KEY       = absolute path to the .p8 key file
 *        APPLE_API_KEY_ID    = key id (e.g. T9GPZ92M7K)
 *        APPLE_API_ISSUER    = issuer UUID (team keys)
 *   2) Apple ID + app-specific password:
 *        APPLE_ID                      = your Apple Developer login email
 *        APPLE_APP_SPECIFIC_PASSWORD   = app-specific password (NOT your Apple ID password)
 *        APPLE_TEAM_ID                 = 10-char Team ID
 *   3) Stored keychain profile (created via `xcrun notarytool store-credentials`):
 *        APPLE_KEYCHAIN_PROFILE        = profile name
 *        APPLE_KEYCHAIN                = (optional) keychain path
 *
 * We never log secret values — only which strategy was selected.
 */

const path = require('path');

/** Decide which credential strategy is configured, if any. Returns null if none. */
function resolveCredentials() {
  const env = process.env;

  // App Store Connect API key. APPLE_API_ISSUER is REQUIRED for Team keys but must be
  // OMITTED for Individual keys (passing it yields a 401), so we only require key+id and
  // forward the issuer only when present (matches @electron/notarize v3 optional issuer).
  if (env.APPLE_API_KEY && env.APPLE_API_KEY_ID) {
    return {
      strategy: 'api-key',
      creds: {
        appleApiKey: env.APPLE_API_KEY,
        appleApiKeyId: env.APPLE_API_KEY_ID,
        ...(env.APPLE_API_ISSUER ? { appleApiIssuer: env.APPLE_API_ISSUER } : {}),
      },
    };
  }

  if (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) {
    return {
      strategy: 'apple-id',
      creds: {
        appleId: env.APPLE_ID,
        appleIdPassword: env.APPLE_APP_SPECIFIC_PASSWORD,
        teamId: env.APPLE_TEAM_ID,
      },
    };
  }

  if (env.APPLE_KEYCHAIN_PROFILE) {
    return {
      strategy: 'keychain-profile',
      creds: {
        keychainProfile: env.APPLE_KEYCHAIN_PROFILE,
        ...(env.APPLE_KEYCHAIN ? { keychain: env.APPLE_KEYCHAIN } : {}),
      },
    };
  }

  return null;
}

module.exports = async function notarizeHook(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return; // Windows / Linux — nothing to notarize.
  }

  if (process.env.NATIVELY_SKIP_NOTARIZE === '1') {
    console.log('[notarize] NATIVELY_SKIP_NOTARIZE=1 — skipping notarization.');
    return;
  }

  const resolved = resolveCredentials();
  if (!resolved) {
    console.log(
      '[notarize] No Apple notarization credentials in environment — skipping. ' +
        '(This is expected for local/ad-hoc dev builds. Set APPLE_API_KEY*/APPLE_ID*/APPLE_KEYCHAIN_PROFILE for production.)'
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(
    `[notarize] Submitting "${appName}.app" to Apple notary service via notarytool (strategy: ${resolved.strategy})…`
  );
  console.log('[notarize] This can take several minutes. Credentials are NOT logged.');

  // Lazy-require so machines without the dep installed (or non-mac CI) don't choke at load time.
  const { notarize } = require('@electron/notarize');
  const { stapleWithRetry } = require('./staple-with-retry');

  const start = Date.now();
  try {
    await notarize({ appPath, ...resolved.creds });
    console.log(
      `[notarize] Success — notarized and stapled in ${Math.round((Date.now() - start) / 1000)}s.`
    );
  } catch (err) {
    const msg = (err && err.message ? err.message : String(err)) || '';
    // STAPLE RACE RECOVERY: @electron/notarize submits + waits for the verdict,
    // then staples ONCE. If only the staple failed due to CDN ticket-propagation
    // lag (Error 65 / "Record not found" / "Could not find base64 encoded ticket"),
    // the submission ALREADY SUCCEEDED — so we recover by retrying just the staple
    // with backoff rather than failing the whole build. Any OTHER failure (e.g. a
    // genuine notarization rejection, auth error, network failure during submit)
    // does NOT match these signatures and is rethrown loudly.
    const isStapleRace =
      /staple/i.test(msg) &&
      (/Error 65/i.test(msg) ||
        /Record not found/i.test(msg) ||
        /Could not find base64 encoded ticket/i.test(msg) ||
        /CloudKit/i.test(msg));

    if (isStapleRace) {
      console.warn(
        '[notarize] Notarization succeeded but the initial staple hit the CDN ticket-propagation race. ' +
          'Recovering via staple-with-retry (exponential backoff)…'
      );
      try {
        await stapleWithRetry(appPath, { maxAttempts: 6, baseDelayMs: 15000 });
        console.log(
          `[notarize] Success — notarized, then stapled via retry in ${Math.round((Date.now() - start) / 1000)}s total.`
        );
        return;
      } catch (stapleErr) {
        console.error(
          '[notarize] Staple still failed after retries — the notarization verdict was accepted but the ' +
            'ticket never became stapleable. Failing the build.',
          stapleErr && stapleErr.message ? stapleErr.message : stapleErr
        );
        throw stapleErr;
      }
    }

    // Fail the build loudly: a release that silently skipped notarization is worse than a failed build.
    console.error('[notarize] Notarization FAILED:', msg);
    throw err;
  }
};
