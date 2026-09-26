// F-107 regression pin (audit/autopilot-2026-08-14).
//
// When loadNativeModule() returns null (missing binary, wrong arch, packaging
// regression, early-boot cache poisoning), both capture wrappers' start()
// methods used to console.error and RETURN — no 'error', no 'start' (so the
// stuck watchdog never armed), empty device lists, and a meeting that
// reported success with zero transcript and zero UI signal. Live-reproduced
// in scripts/audit/F-107-repro.mjs (bare-file launch without the
// native-module symlink).
//
// Contract pinned here: both wrappers THROW from start() when the native
// class is missing, so every call site (startCaptureChannels, recovery,
// resume, audio test) surfaces a terminal channel banner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const audioDir = path.join(__dirname, '..', '..', 'audio');

for (const [file, guard] of [
  ['SystemAudioCapture.ts', '!RustAudioCapture'],
  ['MicrophoneCapture.ts', '!RustMicCapture'],
]) {
  test(`${file} start() throws when the native module is missing`, () => {
    const source = fs.readFileSync(path.join(audioDir, file), 'utf8');
    // The guard appears in the constructor too (console.error only — that one
    // is fine); at least one occurrence must be the throwing start() branch.
    const blocks = [];
    for (let idx = source.indexOf(`if (${guard}) {`); idx !== -1; idx = source.indexOf(`if (${guard}) {`, idx + 1)) {
      blocks.push(source.slice(idx, idx + 900));
    }
    assert.ok(blocks.length > 0, `missing-native guard not found in ${file}`);
    assert.ok(
      blocks.some((b) => /throw new Error\('Native audio engine unavailable/.test(b)),
      `${file}: the missing-native start() branch must throw — a bare return makes the failure a silent no-op meeting (F-107)`
    );
  });
}
