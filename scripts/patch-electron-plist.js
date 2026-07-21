#!/usr/bin/env node
/**
 * patch-electron-plist.js
 *
 * Patches the development Electron.app Info.plist to add the required
 * NSScreenCaptureUsageDescription, NSMicrophoneUsageDescription, and
 * NSAudioCaptureUsageDescription keys.
 *
 * Without NSScreenCaptureUsageDescription in the Info.plist, macOS silently
 * refuses to show the TCC screen recording permission prompt — or grants it
 * under the generic "com.github.Electron" bundle ID, which means the entry
 * is lost the next time electron is reinstalled / node_modules is cleared.
 *
 * Run this script after every `npm install` via `postinstall` in package.json.
 * It is idempotent — safe to run multiple times.
 */

const fs = require('fs');
const path = require('path');

const plistPath = path.join(
  __dirname,
  '..',
  'node_modules',
  'electron',
  'dist',
  'Electron.app',
  'Contents',
  'Info.plist'
);

if (!fs.existsSync(plistPath)) {
  console.log('[patch-electron-plist] Info.plist not found — skipping (non-macOS or missing dist).');
  process.exit(0);
}

let content = fs.readFileSync(plistPath, 'utf8');

let modified = false;

// Patch NSScreenCaptureUsageDescription
if (!content.includes('NSScreenCaptureUsageDescription')) {
  content = content.replace(
    '<key>NSMicrophoneUsageDescription</key>',
    '<key>NSScreenCaptureUsageDescription</key>\n\t<string>Natively needs Screen Recording permission to capture system audio for meeting transcription.</string>\n\t<key>NSMicrophoneUsageDescription</key>'
  );
  modified = true;
  console.log('[patch-electron-plist] Added NSScreenCaptureUsageDescription.');
} else {
  console.log('[patch-electron-plist] NSScreenCaptureUsageDescription already present — skipping.');
}

// Patch NSAudioCaptureUsageDescription
if (!content.includes('NSAudioCaptureUsageDescription')) {
  content = content.replace(
    '<key>NSMicrophoneUsageDescription</key>',
    '<key>NSAudioCaptureUsageDescription</key>\n\t<string>Natively needs system audio access to transcribe meeting audio.</string>\n\t<key>NSMicrophoneUsageDescription</key>'
  );
  modified = true;
  console.log('[patch-electron-plist] Added NSAudioCaptureUsageDescription.');
} else {
  console.log('[patch-electron-plist] NSAudioCaptureUsageDescription already present — skipping.');
}

// Patch LSUIElement — make the dev Electron.app launch as an agent (no dock
// tile at process spawn).
//
// In dev we run the loose node_modules `Electron.app`, whose stock Info.plist
// has CFBundleName=Electron and NO LSUIElement, so macOS paints a generic
// "Electron" dock tile the instant `electron .` launches — before any JS runs.
// The app then renames itself to "Natively" (app.setName + CFBundleName),
// triggering a LaunchServices re-registration that can leave the original tile
// behind alongside the renamed one. With LSUIElement set, the process starts
// agent-style (no tile), and the app's existing setActivationPolicy('regular')
// promotion at startup paints exactly one correctly-timed "Natively" tile.
//
// Scope: this only touches the DEV node_modules bundle. Packaged/signed builds
// use their own production plist (package.json build.mac.extendInfo /
// electron-builder.signed.cjs), which does NOT set LSUIElement — so packaged
// builds still spawn as 'regular'. They rely instead on the runtime
// accessory→regular activation-policy fix in electron/main.ts. If the dual-tile
// bug ever resurfaces in a packaged build, mirroring LSUIElement into extendInfo
// is the next lever (decide deliberately — it changes production launch).
if (!content.includes('LSUIElement')) {
  content = content.replace(
    '<key>LSMinimumSystemVersion</key>',
    '<key>LSUIElement</key>\n\t<string>1</string>\n\t<key>LSMinimumSystemVersion</key>'
  );
  modified = true;
  console.log('[patch-electron-plist] Added LSUIElement (dev launches without a dock tile until promoted).');
} else {
  console.log('[patch-electron-plist] LSUIElement already present — skipping.');
}

// Patch NSMicrophoneUsageDescription if it has the generic stock text
if (content.includes('This app needs access to the microphone')) {
  content = content.replace(
    '<string>This app needs access to the microphone</string>',
    '<string>Natively needs microphone access to transcribe your voice during meetings.</string>'
  );
  modified = true;
  console.log('[patch-electron-plist] Updated NSMicrophoneUsageDescription text.');
}

if (modified) {
  fs.writeFileSync(plistPath, content, 'utf8');
  console.log('[patch-electron-plist] Info.plist patched successfully.');
} else {
  console.log('[patch-electron-plist] No changes needed.');
}
