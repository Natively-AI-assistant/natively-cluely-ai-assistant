const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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
