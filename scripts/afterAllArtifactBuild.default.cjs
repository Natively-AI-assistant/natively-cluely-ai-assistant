// ────────────────────────────────────────────────────────────────────────────
// afterAllArtifactBuild.default.cjs — DEFAULT (ad-hoc / `npm run dist`) build hook.
//
// Verifies every packaged artifact has its Electron runtime. Wired via
// package.json → build.afterAllArtifactBuild. The SIGNED path uses its own hook
// (scripts/afterAllArtifactBuild.cjs) and is unaffected.
//
// WHY THIS EXISTS (v2.9.1 "cannot be opened" crash):
//   electron-builder 26.8.1's DMG step produced an app whose
//     Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework
//   (the framework's 191 MB main Mach-O) was MISSING — the symlink dyld loads via
//   @rpath then dangled and every launch aborted ("Library not loaded: @rpath/
//   Electron Framework…"). The staged .app and the .zip were fine; only the DMG
//   was broken, and the build reported success.
//
//   Cause (electron-userland/electron-builder#9706): the bundled dmgbuild sized
//   the image only ~2.4% above the payload and ignored ditto's exit code, so on a
//   large app the copy ran out of space and the biggest file was dropped silently.
//   Fixed upstream in the dmg-builder 1.2.3 toolset, which electron-builder ships
//   from 26.14.0. We are past that, so electron-builder builds the DMG again
//   (package.json build.mac.target has `dmg`, layout in build.dmg) and the DMG has
//   its install window back (background, icon positions, Applications link).
//
// WHAT THIS HOOK DOES NOW:
//   Every DMG electron-builder produced is mounted and verified: the framework
//   binary must be present and non-empty, AND `codesign --verify --deep` must pass.
//   Both are FATAL — an invalid signature makes macOS 27 ignore the app's
//   entitlements and SIGTRAP the main process at ElectronMain (V8 cannot set up
//   JIT). A correctly signed ad-hoc build (scripts/ad-hoc-sign.js, no post---deep
//   re-sign) passes. A DMG without its install-window layout is a warning only.
//
// CROSS-PLATFORM: the DMG checks are macOS-only (behind platform==='darwin').
// Windows has no Electron Framework bundle; its branch verifies the unpacked
// Chromium runtime (exe + core DLLs + app.asar). Unknown platforms are a no-op.
// Platform, fs, exec and mount/detach are all injected so BOTH platform branches
// are unit-testable from either host (never mutate process.platform).
// ────────────────────────────────────────────────────────────────────────────
const path = require('path');

// The framework's main binary, relative to the .app root. Absent/empty ⇒ the app
// cannot launch (the @rpath load of Electron Framework fails at dyld).
const MAC_FRAMEWORK_BINARY =
  'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework';
// The top-level symlink dyld actually resolves (→ Versions/Current/… → A/…). Checking
// it (existsSync follows symlinks) proves the whole chain resolves, not just the file.
const MAC_FRAMEWORK_SYMLINK =
  'Contents/Frameworks/Electron Framework.framework/Electron Framework';

// Core Chromium runtime files a Windows Electron app cannot launch without,
// relative to the unpacked app dir — the Windows analogue of the framework binary.
const WIN_REQUIRED_FILES = [
  'ffmpeg.dll',
  'libEGL.dll',
  'libGLESv2.dll',
  'vk_swiftshader.dll',
  'icudtl.dat',
  path.join('resources', 'app.asar'),
];

/** Filesystem-predicate view from a real (or fake) fs module. */
function fsView(fsImpl) {
  return {
    exists: (p) => fsImpl.existsSync(p),
    sizeOf: (p) => fsImpl.statSync(p).size,
    listDir: (p) => (fsImpl.existsSync(p) ? fsImpl.readdirSync(p) : []),
  };
}

/**
 * Problems with a macOS .app's Electron runtime. Pure: injected fs predicates in,
 * array of human-readable problem strings out (empty = healthy). No codesign here
 * (that is a separate, advisory exec check) so it is testable with fixtures alone.
 */
function macAppProblems(appPath, view) {
  const problems = [];

  const macosDir = path.join(appPath, 'Contents', 'MacOS');
  if (!view.exists(macosDir) || view.listDir(macosDir).length === 0) {
    problems.push('Contents/MacOS has no main executable');
  }

  const bin = path.join(appPath, MAC_FRAMEWORK_BINARY);
  if (!view.exists(bin)) {
    problems.push(
      `missing Electron Framework binary (${MAC_FRAMEWORK_BINARY}) — dyld would abort at launch ` +
        'with "Library not loaded: @rpath/Electron Framework.framework/Electron Framework"'
    );
  } else if (view.sizeOf(bin) === 0) {
    problems.push(`Electron Framework binary is 0 bytes (${MAC_FRAMEWORK_BINARY})`);
  }

  // existsSync follows the symlink chain; a dangling Versions/Current also fails here.
  if (!view.exists(path.join(appPath, MAC_FRAMEWORK_SYMLINK))) {
    problems.push(
      `top-level Electron Framework symlink does not resolve (${MAC_FRAMEWORK_SYMLINK}) — the @rpath load would fail`
    );
  }

  return problems;
}

/** Problems with a Windows unpacked app dir's Chromium runtime (pure). */
function winUnpackedProblems(dir, view) {
  const problems = [];
  if (!view.listDir(dir).some((f) => f.toLowerCase().endsWith('.exe'))) {
    problems.push('no .exe (main executable) in the unpacked app dir');
  }
  for (const rel of WIN_REQUIRED_FILES) {
    if (!view.exists(path.join(dir, rel))) problems.push(`missing Electron runtime file: ${rel}`);
  }
  return problems;
}

/** The DMGs electron-builder reports having built (BuildResult.artifactPaths). */
function dmgArtifacts(buildResult) {
  const artifacts = (buildResult && buildResult.artifactPaths) || [];
  return artifacts.filter((p) => p.toLowerCase().endsWith('.dmg'));
}

/**
 * Problems with a mounted DMG's install window (pure). electron-builder writes
 * the Finder layout to .DS_Store and the picture to .background.tiff (or a
 * .background folder for a custom image); without them the DMG opens as a plain
 * folder window. Cosmetic, so the caller warns instead of failing the build.
 */
function dmgLayoutProblems(mount, view) {
  const problems = [];
  if (!view.exists(path.join(mount, '.DS_Store'))) {
    problems.push('no .DS_Store (window size and icon positions are not set)');
  }
  const entries = view.listDir(mount);
  if (!entries.some((f) => f === '.background' || f.startsWith('.background.'))) {
    problems.push('no background picture');
  }
  if (!entries.includes('Applications')) {
    problems.push('no Applications link');
  }
  return problems;
}

/** Compact first-line form of an exec/error for a problem/warning message. */
function oneLine(err) {
  const s =
    `${(err && err.stderr) || ''}${(err && err.stdout) || ''}` || String((err && err.message) || err);
  return s.split('\n').map((l) => l.trim()).filter(Boolean).join(' ').slice(0, 300);
}

/**
 * The gate/finalize logic. `deps` is fully injectable:
 *   { platform, view, outDir, attach(dmg)->mount, detach(mount),
 *     verifyCodesign(appPath)->{ok,message}, log, warn }
 * darwin: mount + verify each DMG electron-builder built.
 * win32 : verify the unpacked Chromium runtime (no DMG).
 * Throws (fails the build) on any fatal problem. Returns the verified DMG paths.
 */
async function runHook(buildResult, deps) {
  const { platform, view, outDir } = deps;
  const log = deps.log || (() => {});
  const warn = deps.warn || (() => {});

  if (platform === 'darwin') {
    const dmgs = dmgArtifacts(buildResult);
    if (dmgs.length === 0) {
      warn('[verify-runtime] electron-builder reported no macOS DMG — nothing to verify.');
      return [];
    }

    // NOTE: the bundle inside is deliberately left named "corespeechd.app" (the
    // darwin disguise alias). We do NOT rename it to "Natively.app" for a branded
    // Finder label: that would leak the brand into the on-disk bundle path, which
    // a proctoring scanner enumerating /Applications reads. Finder/Dock show the
    // disguise; the brand is applied as CFBundleDisplayName only (cosmetic).
    const problems = [];

    for (const outDmg of dmgs) {
      log(`[verify-runtime] verifying DMG: ${path.basename(outDmg)}`);

      let mount;
      try {
        mount = deps.attach(outDmg);
      } catch (e) {
        problems.push(`${path.basename(outDmg)}: could not mount for verification — ${oneLine(e)}`);
        continue;
      }
      try {
        const appName = view.listDir(mount).find((f) => f.endsWith('.app'));
        if (!appName) {
          problems.push(`${path.basename(outDmg)}: no .app found inside the DMG`);
          continue;
        }
        for (const p of dmgLayoutProblems(mount, view)) {
          warn(`[verify-runtime] WARNING: ${path.basename(outDmg)} install window: ${p}`);
        }
        const appInDmg = path.join(mount, appName);
        const probs = macAppProblems(appInDmg, view);
        for (const p of probs) problems.push(`${path.basename(outDmg)} → ${appName}: ${p}`);
        if (probs.length === 0) {
          // FATAL: an invalid signature (e.g. a sealed resource modified after the
          // --deep seal — see scripts/ad-hoc-sign.js) makes macOS 27 ignore the app's
          // entitlements and SIGTRAP the main process at ElectronMain (V8 cannot set up
          // JIT). A correctly signed ad-hoc build passes `codesign --verify --deep`.
          const cs = deps.verifyCodesign(appInDmg);
          if (!cs.ok) {
            problems.push(
              `${path.basename(outDmg)}: codesign --verify failed — "${cs.message}" ` +
                '(an invalid signature makes macOS 27 ignore entitlements and SIGTRAP the app at launch)'
            );
          }
        }
      } finally {
        if (mount) deps.detach(mount);
      }
    }

    if (problems.length) {
      throw new Error(
        '[verify-runtime] FATAL: a packaged macOS DMG is missing its Electron runtime:\n' +
          problems.map((p) => `  - ${p}`).join('\n') +
          '\n\nThis is the v2.9.1 "cannot be opened because of a problem" crash (dyld cannot load the ' +
          'Electron Framework). The artifact must not ship.'
      );
    }
    log(
      `[verify-runtime] OK — verified ${dmgs.length} DMG(s); Electron Framework present and signature valid in each ✅`
    );
    return dmgs;
  }

  if (platform === 'win32') {
    const dirs = view
      .listDir(outDir)
      .filter((n) => n.startsWith('win') && /unpacked$/.test(n))
      .map((n) => path.join(outDir, n));
    if (dirs.length === 0) {
      warn('[verify-runtime] no win-unpacked dir found to verify (skipping Windows runtime check).');
      return [];
    }
    const problems = [];
    for (const dir of dirs) {
      for (const p of winUnpackedProblems(dir, view)) problems.push(`${path.basename(dir)}: ${p}`);
    }
    if (problems.length) {
      throw new Error(
        '[verify-runtime] FATAL: a packaged Windows app is missing its Electron/Chromium runtime:\n' +
          problems.map((p) => `  - ${p}`).join('\n') +
          '\n\nThe installer would produce an app that cannot launch. The artifact must not ship.'
      );
    }
    log(`[verify-runtime] OK — ${dirs.length} Windows unpacked app(s) have the core Chromium runtime ✅`);
    return [];
  }

  return [];
}

// ─── Real (non-injected) implementations ───
function realAttach(dmgPath, execFileSync) {
  const out = execFileSync('hdiutil', ['attach', dmgPath, '-nobrowse', '-readonly', '-noverify'], {
    encoding: 'utf8',
  });
  const line = String(out).split('\n').find((l) => l.includes('/Volumes/'));
  const mount = line ? line.slice(line.indexOf('/Volumes/')).trim() : null;
  if (!mount) throw new Error(`could not determine mount point for ${path.basename(dmgPath)}`);
  return mount;
}

function realDetach(mount, execFileSync) {
  try {
    execFileSync('hdiutil', ['detach', mount, '-quiet'], { stdio: 'ignore' });
  } catch {
    try {
      execFileSync('hdiutil', ['detach', mount, '-force'], { stdio: 'ignore' });
    } catch {
      /* best-effort: a leaked read-only mount must not fail an otherwise-passing build */
    }
  }
}

function realVerifyCodesign(appPath, execFileSync) {
  try {
    execFileSync('codesign', ['--verify', '--deep', appPath], { stdio: 'pipe' });
    return { ok: true, message: '' };
  } catch (e) {
    return { ok: false, message: oneLine(e) };
  }
}

/** electron-builder entrypoint: default export, invoked with the BuildResult. */
module.exports = async function afterAllArtifactBuild(buildResult) {
  const fs = require('fs');
  const { execFileSync } = require('child_process');
  const artifacts = (buildResult && buildResult.artifactPaths) || [];
  const outDir = artifacts.length
    ? path.dirname(artifacts[0])
    : path.resolve(process.cwd(), 'release');

  return runHook(buildResult, {
    platform: process.platform,
    view: fsView(fs),
    outDir,
    attach: (dmg) => realAttach(dmg, execFileSync),
    detach: (mount) => realDetach(mount, execFileSync),
    verifyCodesign: (app) => realVerifyCodesign(app, execFileSync),
    log: console.log,
    warn: console.warn,
  });
};

// Exported for scripts/__tests__ — electron-builder only ever calls the default hook.
module.exports.runHook = runHook;
module.exports.macAppProblems = macAppProblems;
module.exports.winUnpackedProblems = winUnpackedProblems;
module.exports.dmgArtifacts = dmgArtifacts;
module.exports.dmgLayoutProblems = dmgLayoutProblems;
module.exports.fsView = fsView;
module.exports.MAC_FRAMEWORK_BINARY = MAC_FRAMEWORK_BINARY;
module.exports.MAC_FRAMEWORK_SYMLINK = MAC_FRAMEWORK_SYMLINK;
module.exports.WIN_REQUIRED_FILES = WIN_REQUIRED_FILES;
