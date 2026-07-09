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
// Display name used for helper processes in Activity Monitor
const DISGUISE_BASE = 'CoreServices';

const HELPER_SUFFIXES = ['', ' (GPU)', ' (Renderer)', ' (Plugin)'];

/**
 * Update the display names inside each helper's Info.plist so Activity Monitor
 * shows "CoreServices Helper" instead of "Natively Helper".
 *
 * IMPORTANT: We only modify CFBundleDisplayName and CFBundleName.
 * We do NOT rename the .app folders or the executable binaries — doing so
 * would break Electron's internal process spawning (Chromium hardcodes the
 * helper paths based on productName).
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
    const appName = context.packager.appInfo.productFilename;
    const appPath = path.join(appOutDir, `${appName}.app`);

    // ── Step 0: Verify packed native binaries match the target arch ──
    // MUST run before signing and before any early return (signed path returns
    // early once it detects a Developer ID identity). A wrong-arch binary here
    // means the DMG for this arch would crash on launch — fail loudly now.
    const targetArchName = ebArchToName(context.arch);
    verifyPackedNativeArch(appPath, targetArchName);

    // ── Step 1: Disguise helper display names (before signing) ──
    // This MUST run regardless of the signing path: it edits helper Info.plist
    // display names, and afterPack runs BEFORE electron-builder's own signing,
    // so a later Developer ID signature will cover these edits correctly.
    try {
        disguiseHelperPlists(appOutDir, appName);
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
    // We MUST do this before signing the .node files with entitlements, because
    // --deep would otherwise overwrite the entitlement-signed .node files.
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

    // ── Step 2b: Re-sign .node binaries with entitlements AFTER --deep ──
    // codesign --deep re-signs nested .node binaries without entitlements (it only
    // applies entitlements to the top-level item). We re-sign them here AFTER --deep
    // so the entitlements (JIT / library-validation) are preserved on the native
    // module binary. (Screen/system-audio access is pure TCC — no entitlement.)
    const unpackedNativeDir = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'native-module');
    if (fs.existsSync(unpackedNativeDir)) {
        const files = fs.readdirSync(unpackedNativeDir);
        for (const file of files) {
            if (file.endsWith('.node')) {
                const nodePath = path.join(unpackedNativeDir, file);
                console.log(`[Ad-Hoc Signing] Re-signing ${file} with entitlements (post --deep)...`);
                try {
                    execSync(`codesign --force ${hardenedOpt}--entitlements "${entitlementsPath}" --sign - "${nodePath}"`, { stdio: 'inherit' });
                } catch (error) {
                    console.error(`[Ad-Hoc Signing] Failed to sign ${file}:`, error);
                }
            }
        }
    }
};
