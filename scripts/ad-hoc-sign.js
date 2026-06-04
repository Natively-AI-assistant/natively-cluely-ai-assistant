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
    try {
        disguiseHelperPlists(appOutDir, appName);
    } catch (error) {
        console.error('[Helper Disguise] Failed to update helper plists:', error);
        // Non-fatal: continue to signing
    }

    // ── Step 2: Ad-hoc sign the application ──
    // Resolve the path to the entitlements file so V8 gets JIT memory permissions
    const entitlementsPath = path.join(context.packager.info.projectDir, 'assets', 'entitlements.mac.plist');
    
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
        execSync(`codesign --force --deep --entitlements "${entitlementsPath}" --sign - "${appPath}"`, { stdio: 'inherit' });
        console.log('[Ad-Hoc Signing] Successfully signed the application with entitlements.');
    } catch (error) {
        console.error('[Ad-Hoc Signing] Failed to sign the application:', error);
        throw error;
    }

    // ── Step 2b: Re-sign .node binaries with entitlements AFTER --deep ──
    // codesign --deep re-signs nested .node binaries without entitlements (it only
    // applies entitlements to the top-level item). We re-sign them here AFTER --deep
    // so the entitlements are not stripped. This ensures the screen-capture entitlement
    // is present on the native module binary for CoreAudio Tap TCC checks.
    const unpackedNativeDir = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'native-module');
    if (fs.existsSync(unpackedNativeDir)) {
        const files = fs.readdirSync(unpackedNativeDir);
        for (const file of files) {
            if (file.endsWith('.node')) {
                const nodePath = path.join(unpackedNativeDir, file);
                console.log(`[Ad-Hoc Signing] Re-signing ${file} with entitlements (post --deep)...`);
                try {
                    execSync(`codesign --force --entitlements "${entitlementsPath}" --sign - "${nodePath}"`, { stdio: 'inherit' });
                } catch (error) {
                    console.error(`[Ad-Hoc Signing] Failed to sign ${file}:`, error);
                }
            }
        }
    }

    // Re-seal the outer bundle after modifying nested code signatures.
    try {
        console.log('[Ad-Hoc Signing] Re-sealing app bundle after nested signatures...');
        execSync(`codesign --force --entitlements "${entitlementsPath}" --sign - "${appPath}"`, { stdio: 'inherit' });
    } catch (error) {
        console.error('[Ad-Hoc Signing] Failed to re-seal application:', error);
        throw error;
    }
};
