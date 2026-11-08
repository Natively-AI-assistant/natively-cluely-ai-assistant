/**
 * Electron fuses for every packaged Natively build (macOS and Windows alike).
 *
 * Every Pro check is JavaScript in the main process. Without these, anyone could
 * start the packaged app with `--inspect` (a debugger in main, where one line
 * turns Pro on), run it as plain Node with ELECTRON_RUN_AS_NODE, inject code
 * with NODE_OPTIONS, or edit app.asar. Off, those are refused by Electron itself:
 *
 *   runAsNode: false                            ELECTRON_RUN_AS_NODE ignored
 *   enableNodeOptionsEnvironmentVariable: false NODE_OPTIONS ignored
 *   enableNodeCliInspectArguments: false        --inspect / --inspect-brk ignored
 *   enableEmbeddedAsarIntegrityValidation: true app.asar checked against the hash
 *                                               electron-builder embeds (Info.plist
 *                                               on macOS, an exe resource on Windows)
 *   onlyLoadAppFromAsar: true                   no loading an unpacked app/ folder
 *
 * Checked before adding them (2026-11-07): the app never relaunches itself as
 * Node (its workers are worker_threads and utilityProcess, its helpers native
 * binaries), and nothing changes app.asar after electron-builder packs it.
 * Development runs (`npm run dev`, dev:agent, the test runner's
 * ELECTRON_RUN_AS_NODE) use the unpackaged Electron binary, which these do not
 * touch. Cookie encryption and the file:// privileges are left as they are:
 * changing either changes behaviour for existing installs.
 *
 * Flipped in afterPack, before signing (electron-builder signs after afterPack;
 * the ad-hoc signer for unsigned macOS builds must stay the last change to the
 * app, see after-pack.cjs). NATIVELY_NO_FUSES=1 skips it, for diagnosing a
 * packaged build only, never for a release.
 */
const NATIVELY_FUSES = Object.freeze({
  runAsNode: false,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  enableEmbeddedAsarIntegrityValidation: true,
  onlyLoadAppFromAsar: true,
});

async function flipFusesForAfterPack(context, { env = process.env, log = console } = {}) {
  if (env.NATIVELY_NO_FUSES === '1') {
    log.warn('[fuses] NATIVELY_NO_FUSES=1: Electron fuses NOT flipped. Never ship this build.');
    return false;
  }
  const packager = context && context.packager;
  if (!packager || typeof packager.generateFuseConfig !== 'function' || typeof packager.addElectronFuses !== 'function') {
    // Fail the build rather than ship an app without them.
    throw new Error('[fuses] electron-builder packager cannot flip Electron fuses (needs electron-builder 26+).');
  }
  const config = await packager.generateFuseConfig(NATIVELY_FUSES);
  await packager.addElectronFuses(context, config);
  log.log(`[fuses] flipped for ${context.electronPlatformName}: ${Object.entries(NATIVELY_FUSES).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  return true;
}

module.exports = { NATIVELY_FUSES, flipFusesForAfterPack };
