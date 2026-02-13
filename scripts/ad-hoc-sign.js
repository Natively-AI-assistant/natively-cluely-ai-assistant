const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

exports.default = async function (context) {
    // Only sign on macOS
    if (process.platform !== 'darwin') {
        return;
    }

    const appOutDir = context.appOutDir;
    const appName = context.packager.appInfo.productFilename;
    const appPath = path.join(appOutDir, `${appName}.app`);

    console.log(`[Ad-Hoc Signing] Signing ${appPath}...`);

    try {
        // Ad-hoc sign with entitlements if needed, but simple ad-hoc is often enough for "damaged" error
        // --force: replace existing signature
        // --deep: sign nested code
        // --sign -: ad-hoc signature
        execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
        console.log('[Ad-Hoc Signing] Successfully signed the application.');
    } catch (error) {
        console.error('[Ad-Hoc Signing] Failed to sign the application:', error);
        throw error;
    }
};
