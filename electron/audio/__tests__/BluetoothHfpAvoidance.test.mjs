import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../../electron/main.ts');
const coreAudioPath = path.resolve(__dirname, '../../../native-module/src/speaker/core_audio.rs');
const mainSource = readFileSync(mainPath, 'utf8');
const coreAudioSource = readFileSync(coreAudioPath, 'utf8');

function extractMethodBody(methodName) {
  const methodRe = new RegExp(`private\\s+(?:async\\s+)?${methodName}\\s*\\([^)]*\\)[^{]*\\{`);
  const match = methodRe.exec(mainSource);
  assert.ok(match, `could not locate ${methodName}`);

  let i = match.index + match[0].length;
  let depth = 1;
  const start = i;
  let inLineComment = false;
  let inBlockComment = false;
  let inString = null;

  while (i < mainSource.length && depth > 0) {
    const ch = mainSource[i];
    const next = mainSource[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }

  assert.equal(depth, 0, `unbalanced braces while extracting ${methodName}`);
  return mainSource.slice(start, i - 1);
}

const bluetoothNameBodyRaw = extractMethodBody('isBluetoothInputName');
const bluetoothNameBody = bluetoothNameBodyRaw.toLowerCase();
const reconfigureBody = extractMethodBody('reconfigureAudio');

test('Bluetooth HFP avoidance recognizes OnePlus and generic TWS earbuds', () => {
  for (const expected of ['oneplus', 'one plus', 'buds', 'earbuds', 'earbud', 'tws']) {
    assert.ok(
      bluetoothNameBody.includes(expected),
      `BUG: isBluetoothInputName() must recognize "${expected}" so default-input HFP avoidance catches OnePlus/TWS earbuds before opening the mic.`,
    );
  }
});

test('Bluetooth HFP name heuristic covers real devices without flagging built-in or USB names', () => {
  const familyMatch = /const\s+families\s*=\s*\[([\s\S]*?)\];/.exec(bluetoothNameBodyRaw);
  assert.ok(familyMatch, 'could not locate Bluetooth device family list');
  const families = Array.from(familyMatch[1].matchAll(/['"]([^'"]+)['"]/g), m => m[1]);
  const normalize = (name) => (name || '')
    .replace(/:(input|output)$/i, '')
    .replace(/[–—−]/g, '-')
    .trim()
    .toLowerCase();
  const isBluetooth = (name) => {
    const n = normalize(name);
    return !!n && (
      n.includes('hands-free') ||
      n.includes('handsfree') ||
      n.includes('(hfp') ||
      families.some(f => n.includes(f))
    );
  };

  for (const btName of [
    'OnePlus Buds Pro 2',
    'One Plus Buds 3',
    'TWS Earbuds',
    'Evin’s AirPods Pro:output',
    'Sony WF-1000XM5',
    'Bluetooth Hands-Free Audio',
  ]) {
    assert.equal(isBluetooth(btName), true, `expected Bluetooth/HFP-prone device: ${btName}`);
  }

  for (const safeName of [
    'MacBook Air Microphone',
    'Built-in Microphone',
    'USB Audio Device',
    'Studio Monitor Speakers',
  ]) {
    assert.equal(isBluetooth(safeName), false, `expected non-Bluetooth device: ${safeName}`);
  }
});

test('HFP avoidance resolves the effective output name for default output', () => {
  assert.match(
    mainSource,
    /getEffectiveOutputDeviceName/,
    'BUG: AppState needs a helper that resolves explicit output IDs and current default output IDs to a friendly output name.',
  );
  assert.match(
    mainSource,
    /getDefaultOutputDeviceId/,
    'BUG: default-output HFP avoidance must use native getDefaultOutputDeviceId() when output selection is Default.',
  );
  assert.doesNotMatch(
    reconfigureBody,
    /if\s*\(\s*wantedOutput\s*\)\s*\{[\s\S]{0,700}?outputIsBt\s*=/,
    'BUG: outputIsBt must not only be assigned inside `if (wantedOutput)` because normalizeDeviceId("default") returns undefined.',
  );
});

test('HFP avoidance selects built-in mic before opening MicrophoneCapture', () => {
  assert.match(
    reconfigureBody,
    /const\s+outputName\s*=\s*this\.getEffectiveOutputDeviceName\(wantedOutput\)/,
    'BUG: reconfigureAudio() must resolve outputName from the effective output device, including current Default output.',
  );
  assert.match(
    reconfigureBody,
    /const\s+willBeHfp\s*=\s*inputIsExplicitBt\s*\|\|\s*\(inputIsDefault\s*&&\s*\(outputIsBt\s*\|\|\s*outputResolutionUnknown\)\)/,
    'BUG: default input plus Bluetooth/unknown output must proactively trigger HFP avoidance.',
  );
  assert.ok(
    reconfigureBody.indexOf('const willBeHfp') < reconfigureBody.indexOf('new MicrophoneCapture(wantedInput)'),
    'BUG: HFP avoidance must run before MicrophoneCapture opens a Bluetooth mic and forces HFP.',
  );
});

test('reconfigureAudio awaits capture destroy before constructing replacements', () => {
  assert.match(
    reconfigureBody,
    /await\s+oldSystemAudioCapture\.destroy\(\)/,
    'BUG: reconfigureAudio() must await old system audio native teardown before constructing a replacement SystemAudioCapture.',
  );
  assert.match(
    reconfigureBody,
    /await\s+oldMicrophoneCapture\.destroy\(\)/,
    'BUG: reconfigureAudio() must await old microphone native teardown before constructing a replacement MicrophoneCapture.',
  );
  assert.ok(
    reconfigureBody.indexOf('await oldMicrophoneCapture.destroy()') < reconfigureBody.indexOf('new MicrophoneCapture(wantedInput)'),
    'BUG: old microphone native teardown must finish before a replacement MicrophoneCapture is constructed.',
  );
});

test('active meeting reconfigure starts replacement captures and STT streams', () => {
  const activeStartIndex = reconfigureBody.indexOf('if (this.isMeetingActive)');
  assert.ok(
    activeStartIndex > reconfigureBody.indexOf('new MicrophoneCapture(wantedInput)'),
    'BUG: active-meeting reconfigure must start replacements after new captures are constructed and wired.',
  );

  const activeStartBlock = reconfigureBody.slice(activeStartIndex);
  for (const expected of [
    'this.systemAudioCapture?.start()',
    'this.microphoneCapture?.start()',
    'this.googleSTT?.start()',
    'this.googleSTT_User?.start()',
  ]) {
    assert.ok(activeStartBlock.includes(expected), `BUG: active reconfigure must call ${expected}.`);
  }
});

test('effective output name falls back to current default when explicit output id is unresolved', () => {
  const helperBody = extractMethodBody('getEffectiveOutputDeviceName');
  assert.match(
    helperBody,
    /const\s+resolveOutputName\s*=/,
    'BUG: getEffectiveOutputDeviceName() should have a reusable resolver for explicit and default output ids.',
  );
  assert.match(
    helperBody,
    /const\s+explicitName\s*=\s*resolveOutputName\(outputDeviceId\)/,
    'BUG: getEffectiveOutputDeviceName() must try the explicit requested output id first.',
  );
  assert.match(
    helperBody,
    /if\s*\(\s*explicitName\s*\)\s*return\s+explicitName/,
    'BUG: resolved explicit output names should win over default fallback.',
  );
  assert.match(
    helperBody,
    /getDefaultOutputDeviceId[\s\S]*resolveOutputName\(defaultOutputId\)/,
    'BUG: unresolved explicit output ids must fall back to current native default output for HFP detection.',
  );
  assert.doesNotMatch(
    helperBody,
    /this\._lastRequestedOutputDeviceId\s*=/,
    'BUG: effective-output lookup must not pin Default output state.',
  );
});

test('default input treats unresolved explicit output as unsafe for HFP', () => {
  assert.match(
    reconfigureBody,
    /const\s+outputResolutionUnknown\s*=\s*!!wantedOutput\s*&&\s*!outputName/,
    'BUG: reconfigureAudio() must track unresolved explicit output ids.',
  );
  assert.match(
    reconfigureBody,
    /const\s+willBeHfp\s*=\s*inputIsExplicitBt\s*\|\|\s*\(inputIsDefault\s*&&\s*\(outputIsBt\s*\|\|\s*outputResolutionUnknown\)\)/,
    'BUG: default input plus unresolved explicit output must avoid opening the OS default/Bluetooth mic.',
  );
});

test('CoreAudio output selection matches suffixed output ids instead of silently falling back', () => {
  assert.match(
    coreAudioSource,
    /strip_audio_suffix/,
    'BUG: CoreAudio output matching must strip :input/:output suffixes like JS device matching does.',
  );
  assert.match(
    coreAudioSource,
    /strip_audio_suffix\(uid\)/,
    'BUG: requested CoreAudio output uid must be normalized before matching.',
  );
  assert.match(
    coreAudioSource,
    /strip_audio_suffix\([^)]*to_string\(\)[^)]*\)/,
    'BUG: enumerated CoreAudio device uid must be normalized before matching requested output.',
  );
});
