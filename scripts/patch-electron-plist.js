#!/usr/bin/env node
/**
 * patch-electron-plist.js
 *
 * Patches the development Electron.app Info.plist to add the required
 * NSScreenCaptureUsageDescription, NSAudioCaptureUsageDescription, and
 * NSMicrophoneUsageDescription keys.
 *
 * Without the usage descriptions in Info.plist, macOS can silently refuse to
 * grant the TCC permissions needed by Electron, ScreenCaptureKit, and CoreAudio
 * taps, or grant them under the generic "com.github.Electron" bundle ID.
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
    '<key>NSScreenCaptureUsageDescription</key>\n\t<string>Natively needs Screen Recording permission to capture meeting context.</string>\n\t<key>NSMicrophoneUsageDescription</key>'
  );
  modified = true;
  console.log('[patch-electron-plist] Added NSScreenCaptureUsageDescription.');
} else {
  console.log('[patch-electron-plist] NSScreenCaptureUsageDescription already present — skipping.');
}

if (content.includes('Natively needs Screen Recording permission to capture system audio for meeting transcription.')) {
  content = content.replace(
    '<string>Natively needs Screen Recording permission to capture system audio for meeting transcription.</string>',
    '<string>Natively needs Screen Recording permission to capture meeting context.</string>'
  );
  modified = true;
  console.log('[patch-electron-plist] Updated NSScreenCaptureUsageDescription text.');
}

// Patch NSAudioCaptureUsageDescription
if (!content.includes('NSAudioCaptureUsageDescription')) {
  content = content.replace(
    '<key>NSMicrophoneUsageDescription</key>',
    '<key>NSAudioCaptureUsageDescription</key>\n\t<string>Natively needs System Audio Recording permission to capture meeting audio for transcription.</string>\n\t<key>NSMicrophoneUsageDescription</key>'
  );
  modified = true;
  console.log('[patch-electron-plist] Added NSAudioCaptureUsageDescription.');
} else {
  console.log('[patch-electron-plist] NSAudioCaptureUsageDescription already present — skipping.');
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
