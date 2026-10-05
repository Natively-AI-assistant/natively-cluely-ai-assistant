const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Packed native-arch guard ───
// better-sqlite3 + keytar ship a SINGLE compiled binary each (no per-arch
// loader), so a build on an Apple-Silicon Mac can silently embed arm64 binaries
// in the x64 (`Natively.dmg`) pack — every Intel Mac then boots into main.ts's
// nativeArchGate "Architecture mismatch" dialog. scripts/rebuild-native-for-target.cjs
// (beforeBuild) rebuilds them for the correct target arch; THIS guard verifies
// the binaries actually inside the packed .app match the target arch and FAILS
// the build if they don't — closing the silent-ship hole. Runs for both the
// default (ad-hoc) and signed configs since both inherit this afterPack.
const ARCH_VERIFY_TARGETS = [
    path.join('better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
    path.join('keytar', 'build', 'Release', 'keytar.node'),
];

// ─── Per-arch package-family guard ───
// The guard above catches a binary built for the WRONG arch, but deliberately
// TOLERATES a missing file. That hole shipped v2.8.7's Intel DMG: families that
// resolve their binding by arch (`<name>-darwin-x64` / `-arm64`) come from npm
// optional deps, npm installs only the HOST arch, and electron-builder packs
// whatever is on disk — so the x64 pack contained ONLY
// @napi-rs/canvas-darwin-arm64. Nothing was mis-built, so nothing was flagged;
// every Intel user's PDF text extraction then failed at runtime with
// "DOMMatrix is not defined". A MISSING target-arch member of one of these
// families is fatal, because the pack cannot possibly work on that chip.
// scripts/ensure-*-mac-deps.js prevent it; this catches it if they regress.
const ARCH_FAMILY_TARGETS = [
    { family: '@napi-rs/canvas', pkg: (a) => `@napi-rs/canvas-darwin-${a}` },
    { family: 'sharp', pkg: (a) => `@img/sharp-darwin-${a}` },
    { family: 'sharp-libvips', pkg: (a) => `@img/sharp-libvips-darwin-${a}` },
    { family: 'sqlite-vec', pkg: (a) => `sqlite-vec-darwin-${a}` },
];

/**
 * Assert the packed app contains the TARGET arch's member of every per-arch
 * package family. A family absent from the pack entirely is skipped (the dep may
 * legitimately not ship); a family present for the OTHER arch but missing the
 * target's is fatal — that is precisely the v2.8.7 canvas shape.
 */
function verifyPackedArchFamilies(appPath, targetArchName) {
    if (targetArchName !== 'x64' && targetArchName !== 'arm64') return;
    const otherArch = targetArchName === 'x64' ? 'arm64' : 'x64';
    const unpackedModules = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules');
    const broken = [];
    for (const { family, pkg } of ARCH_FAMILY_TARGETS) {
        const wantDir = path.join(unpackedModules, ...pkg(targetArchName).split('/'));
        const otherDir = path.join(unpackedModules, ...pkg(otherArch).split('/'));
        const haveWant = fs.existsSync(path.join(wantDir, 'package.json'));
        const haveOther = fs.existsSync(path.join(otherDir, 'package.json'));
        if (haveWant) {
            console.log(`[Arch Guard] OK ${pkg(targetArchName)} present (target ${targetArchName})`);
        } else if (haveOther) {
            broken.push({ family, want: pkg(targetArchName), other: pkg(otherArch) });
        } else {
            console.warn(`[Arch Guard] ${family}: neither arch packed — skipping (dep may not ship here).`);
        }
    }
    if (broken.length > 0) {
        const lines = broken.map((b) => `  - ${b.want} MISSING, but ${b.other} IS packed`);
        throw new Error(
            `[Arch Guard] FATAL: the ${targetArchName} pack is missing per-arch native packages:\n` +
            lines.join('\n') +
            `\n\nThese resolve their binding by arch, so the ${targetArchName === 'x64' ? 'Intel' : 'Apple-Silicon'} ` +
            `build would fail at runtime when the feature is used (v2.8.7 shipped exactly this and broke ` +
            `PDF text extraction on every Intel Mac). Run the matching scripts/ensure-*-mac-deps.js before packing.`
        );
    }
}

/** electron-builder ArchType enum / string → Node arch string. */
function ebArchToName(arch) {
    if (arch === 1 || arch === 'x64' || arch === 'x86_64') return 'x64';
    if (arch === 3 || arch === 'arm64' || arch === 'aarch64') return 'arm64';
    return String(arch);
}

/** Mach-O arch of a .node via `file -b`, normalized to a Node arch string. */
function binaryArchOf(absPath) {
    const out = execFileSync('file', ['-b', absPath], { encoding: 'utf8' });
    if (/\barm64\b/.test(out)) return 'arm64';
    if (/\bx86_64\b/.test(out)) return 'x64';
    return `unknown (${out.trim()})`;
}

/**
 * Assert every guarded .node inside the packed .app matches the target arch.
 * Throws (failing the build) on any mismatch. Missing files are tolerated (a
 * dep layout change should not hard-fail here — the runtime gate still catches
 * a genuinely absent binary), but a WRONG arch is fatal.
 */
function verifyPackedNativeArch(appPath, targetArchName) {
    if (targetArchName !== 'x64' && targetArchName !== 'arm64') {
        console.warn(`[Arch Guard] Non-mac/unknown target arch "${targetArchName}" — skipping packed-arch verification.`);
        return;
    }
    const unpackedModules = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules');
    const mismatches = [];
    for (const rel of ARCH_VERIFY_TARGETS) {
        const abs = path.join(unpackedModules, rel);
        if (!fs.existsSync(abs)) {
            console.warn(`[Arch Guard] not present in pack (skipping): ${rel}`);
            continue;
        }
        const actual = binaryArchOf(abs);
        if (String(actual).startsWith('unknown')) {
            // FAIL OPEN on unclassifiable `file -b` output, matching the deliberate
            // policy in electron/lib/nativeArch.mjs:156-161. `file`'s phrasing varies
            // across macOS releases/locales; unknown output is NOT proof of a
            // wrong-arch binary. A build-time false-negative is still caught by the
            // runtime boot gate (main.ts nativeArchGate), whereas failing closed here
            // would block every release on a benign `file` wording change — the exact
            // fragility class behind the v2.8.1→v2.8.2 boot-dialog regression.
            console.warn(`[Arch Guard] could not classify ${rel} (${actual}); skipping arch check for this file`);
            continue;
        }
        if (actual === targetArchName) {
            console.log(`[Arch Guard] OK ${rel} → ${actual} (target ${targetArchName})`);
        } else {
            mismatches.push({ rel, actual, expected: targetArchName });
        }
    }
    if (mismatches.length > 0) {
        const lines = mismatches.map((m) => `  - ${m.rel}: packed ${m.actual}, target needs ${m.expected}`);
        throw new Error(
            `[Arch Guard] FATAL: packed native binaries do not match the ${targetArchName} target:\n` +
            lines.join('\n') +
            `\n\nThe ${targetArchName === 'x64' ? 'Intel (Natively.dmg)' : 'Apple-Silicon (Natively-arm64.dmg)'} build would crash on launch. ` +
            `Ensure scripts/rebuild-native-for-target.cjs (build.beforeBuild) is wired and ran for this arch.`
        );
    }
    console.log(`[Arch Guard] All packed native binaries match target arch ${targetArchName} ✅`);
}

// ─── Helper Disguise Configuration ───
// Display name used for helper processes in Activity Monitor.
//
// Sourced from scripts/disguise-name.cjs (single source of truth) and kept in
// lockstep with the build-time productName (package.json "build" →
// "productName"). electron-builder already names the helper bundles +
// executables "<productName> Helper (X)", and Chromium derives each helper's
// launch path from the main executable's basename
// (content::ChildProcessHost::GetChildPath → "<base> Helper (Renderer).app"),
// so a CONSISTENT rename is safe — this is exactly how the Interview Coder
// bundle ships. The plist pass below just re-asserts the same name on
// CFBundleName/CFBundleDisplayName so the metadata matches the on-disk
// executable (no "Natively" left anywhere).
// ad-hoc signing is macOS-only, so use the darwin disguise name.
const DISGUISE_BASE = require('./disguise-name.cjs').darwin;

const HELPER_SUFFIXES = ['', ' (GPU)', ' (Renderer)', ' (Plugin)'];

/**
 * Re-assert the BRAND display name on the MAIN app's Info.plist so Finder/Dock/Spotlight
 * show "Natively" while the executable/bundle stays "corespeechd" (the disguise).
 *
 * ONLY CFBundleDisplayName is set. CFBundleName MUST stay the disguise alias
 * (corespeechd, from productName): Electron/Chromium derives the helper app name from the
 * main bundle's CFBundleName, so branding it makes Electron look for "Natively Helper.app"
 * — which does not exist (the helpers are "corespeechd Helper.app") — and the main process
 * aborts at launch (electron_main_delegate_mac.mm "Unable to find helper app" → SIGTRAP at
 * ElectronMain). This was the v2.9.1 launch crash. The app still renames itself to
 * "Natively" at runtime via app.setName, so the menu-bar name is branded regardless.
 * (scripts/disguise-name.cjs and packaging-config.test.mjs both require CFBundleName to
 * stay the alias.)
 */
function enforceMainAppDisplayName(appOutDir, appName) {
    const mainAppPath = path.join(appOutDir, `${appName}.app`);
    const plistPath = path.join(mainAppPath, 'Contents', 'Info.plist');

    if (!fs.existsSync(plistPath)) {
        console.log('[Main Display] Main app Info.plist not found, skipping.');
        return;
    }

    try {
        // CFBundleDisplayName = what Finder/Dock/Spotlight shows (BRAND). Safe to brand.
        execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName 'Natively'" "${plistPath}"`, { stdio: 'pipe' });
        // Do NOT touch CFBundleName — it must stay the disguise alias so Electron finds
        // "<alias> Helper.app". Setting it to the brand is the "Unable to find helper app"
        // launch crash.
        console.log('[Main Display] Main app CFBundleDisplayName set to "Natively" (CFBundleName left as the disguise alias)');
    } catch (err) {
        console.warn('[Main Display] PlistBuddy warning for main app:', err.message);
    }
}

/**
 * Re-assert the disguised name on each helper's Info.plist so the metadata
 * (CFBundleName / CFBundleDisplayName) matches the on-disk executable
 * ("<DISGUISE_BASE> Helper (X)") — no "Natively" left in the bundle.
 *
 * The .app folders and executable binaries are already named by
 * electron-builder from productName; we do NOT rename them here (that would
 * desync CFBundleExecutable and the signed binary).
 */
function disguiseHelperPlists(appOutDir, appName) {
    const frameworksDir = path.join(appOutDir, `${appName}.app`, 'Contents', 'Frameworks');

    if (!fs.existsSync(frameworksDir)) {
        console.log('[Helper Disguise] Frameworks directory not found, skipping.');
        return;
    }

    for (const suffix of HELPER_SUFFIXES) {
        const helperName = `${appName} Helper${suffix}`;
        const disguisedName = `${DISGUISE_BASE} Helper${suffix}`;
        const helperAppPath = path.join(frameworksDir, `${helperName}.app`);
        const plistPath = path.join(helperAppPath, 'Contents', 'Info.plist');

        if (!fs.existsSync(plistPath)) {
            console.log(`[Helper Disguise] Skipping (not found): ${helperName}.app`);
            continue;
        }

        console.log(`[Helper Disguise] ${helperName} → display as "${disguisedName}"`);

        try {
            // Update CFBundleDisplayName (Activity Monitor display)
            execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName '${disguisedName}'" "${plistPath}"`, { stdio: 'pipe' });
            // Update CFBundleName (Dock / menu bar fallback)
            execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleName '${disguisedName}'" "${plistPath}"`, { stdio: 'pipe' });
        } catch (err) {
            console.warn(`[Helper Disguise] PlistBuddy warning for ${helperName}:`, err.message);
        }
    }

    console.log('[Helper Disguise] All helper plists updated successfully.');
}

exports.default = async function (context) {
    // Only process on macOS
    if (process.platform !== 'darwin') {
        return;
    }

    const appOutDir = context.appOutDir;
    // The bundle folder is named from productName (the darwin disguise alias,
    // "corespeechd") — NOT the brand. appName is used as a path component to find
    // the .app and its helper bundles, so it MUST be the on-disk folder name. The
    // brand ("Natively") is applied separately as CFBundleDisplayName only (see
    // enforceMainAppDisplayName) and the bundle is deliberately NEVER renamed to
    // "Natively.app" (that would leak the brand into the on-disk path a proctoring
    // scanner reads — the stealth-clean contract).
    const appName = context.packager.appInfo.productFilename;
    const appPath = path.join(appOutDir, `${appName}.app`);

    // ── Step 0: Verify packed native binaries match the target arch ──
    // MUST run before signing and before any early return (signed path returns
    // early once it detects a Developer ID identity). A wrong-arch binary here
    // means the DMG for this arch would crash on launch — fail loudly now.
    const targetArchName = ebArchToName(context.arch);
    verifyPackedNativeArch(appPath, targetArchName);
    // Same stage, different failure shape: a per-arch package family whose
    // target-arch member was never installed (v2.8.7's Intel canvas gap).
    verifyPackedArchFamilies(appPath, targetArchName);

    // ── Step 1: Disguise helper display names (before signing) ──
    // This MUST run regardless of the signing path: it edits helper Info.plist
    // display names, and afterPack runs BEFORE electron-builder's own signing,
    // so a later Developer ID signature will cover these edits correctly.
    try {
        disguiseHelperPlists(appOutDir, appName);
        enforceMainAppDisplayName(appOutDir, appName);
    } catch (error) {
        console.error('[Helper Disguise] Failed to update helper plists:', error);
        // Non-fatal: continue to signing
    }

    // ── Production guard: never ad-hoc sign when a real Developer ID identity is configured ──
    // When CSC_LINK / CSC_NAME / NATIVELY_SIGN_IDENTITY is present, electron-builder performs
    // proper inside-out Developer ID signing with the entitlements + hardened runtime declared
    // in package.json, and electron-builder's built-in mac.notarize notarizes + staples.
    // Running `codesign --sign -` here would clobber that real signature with an ad-hoc one,
    // which can never be notarized — so we skip the ad-hoc step entirely in that case.
    const hasRealIdentity = !!(
        process.env.NATIVELY_PRODUCTION_SIGN === '1' || // set by electron-builder.signed.cjs
        process.env.CSC_LINK ||
        process.env.CSC_NAME ||
        process.env.NATIVELY_SIGN_IDENTITY
    );
    if (hasRealIdentity) {
        console.log(
            '[Ad-Hoc Signing] Developer ID identity detected (CSC_LINK/CSC_NAME/NATIVELY_SIGN_IDENTITY) — ' +
            'skipping ad-hoc signing. electron-builder will sign with Developer ID; afterSign will notarize.'
        );
        return;
    }

    // Optional: shape the ad-hoc build like a hardened-runtime build for local TCC testing.
    // Off by default because a hardened-runtime ad-hoc build has stricter launch requirements
    // that cannot be fully verified without a real signing identity. Set NATIVELY_ADHOC_HARDENED=1
    // to opt in when testing entitlement/permission behavior locally.
    const hardenedOpt = process.env.NATIVELY_ADHOC_HARDENED === '1' ? '--options runtime ' : '';

    // ── Step 2: Ad-hoc sign the application (DEV / local distribution only) ──
    // Resolve the path to the entitlements file so V8 gets JIT memory permissions
    const entitlementsPath = path.join(context.packager.info.projectDir, 'build', 'entitlements.mac.plist');
    
    // ── Step 2a: Sign the main app bundle with --deep first ──
    // --deep recurses into nested Mach-O binaries (frameworks, helpers, .node files).
    // It signs them with --sign - only (no custom entitlements on nested items).
    // Sign the whole bundle ONCE, with --deep. The entitlements attach to the
    // top-level executable (what V8's JIT needs); --deep ad-hoc-signs the nested
    // frameworks, helpers, dylibs and .node. NOTHING is re-signed after this, so the
    // bundle's seal stays valid.
    console.log(`[Ad-Hoc Signing] Signing main app ${appPath} with entitlements...`);

    try {
        // --force: replace existing signature
        // --deep: sign nested code (frameworks, helpers, .dylib, .node)
        // --entitlements: attach entitlements to the top-level app bundle
        // --sign -: ad-hoc signature
        execSync(`codesign --force --deep ${hardenedOpt}--entitlements "${entitlementsPath}" --sign - "${appPath}"`, { stdio: 'inherit' });
        console.log('[Ad-Hoc Signing] Successfully signed the application with entitlements.');
    } catch (error) {
        console.error('[Ad-Hoc Signing] Failed to sign the application:', error);
        throw error;
    }

    // ── Do NOT re-sign the .node binaries after --deep (removed 2026-10-03). ──
    // The previous code re-signed Contents/Resources/app.asar.unpacked/native-module/*.node
    // with `codesign --force` AFTER the --deep bundle seal, to put JIT/library-validation
    // entitlements on them. But that MODIFIES the files whose hashes --deep just sealed
    // into the app's CodeResources, so the app's own signature becomes invalid
    // ("a sealed resource is missing or invalid"). On macOS 27's stricter code-signing
    // enforcement the invalid signature makes the app's entitlements be ignored and the
    // main process SIGTRAPs at ElectronMain (V8 cannot set up JIT) — the v2.9.1
    // post-framework-fix launch crash. The native .node addons are not V8 and need no JIT
    // entitlement; under an ad-hoc, non-hardened-runtime build there is no library
    // validation to disable either. --deep already ad-hoc-signs them, which is enough.
    // Verified on macOS 27: without this step `codesign --verify --deep --strict` passes
    // and the app launches cleanly.
};

// Exported for scripts/__tests__ — electron-builder only ever calls the default
// hook above, so the extra properties are inert at build time.
module.exports.verifyPackedArchFamilies = verifyPackedArchFamilies;
module.exports.verifyPackedNativeArch = verifyPackedNativeArch;
