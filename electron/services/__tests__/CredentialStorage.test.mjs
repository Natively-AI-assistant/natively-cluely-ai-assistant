import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('CredentialsManager persists via an app-managed ENCRYPTED fallback (never plaintext) when the keyring is unavailable', () => {
  const source = read('electron/services/CredentialsManager.ts');
  const saveStart = source.indexOf('    private saveCredentials(): boolean');
  const saveEnd = source.indexOf('    private removeFallbackFile(): void', saveStart);
  const saveSource = source.slice(saveStart, saveEnd);

  assert.ok(saveStart >= 0, 'saveCredentials should exist');
  // Keyring-unavailable branch must encrypt with the AES fallback, NOT write plaintext.
  assert.match(saveSource, /encryptCredentialBlob\(JSON\.stringify\(this\.credentials\), this\.getFallbackKey\(\)\)/);
  // The blob is written to the dedicated fallback path with 0600 perms.
  assert.match(saveSource, /fs\.renameSync\(tmpFb, FALLBACK_PATH\)/);
  assert.match(saveSource, /mode: 0o600/);
  // Security invariant preserved: no plaintext-at-rest. The credential JSON is only
  // ever handed to an encryptor (safeStorage or encryptCredentialBlob), never written raw.
  assert.doesNotMatch(saveSource, /falling back to plaintext/);
  assert.doesNotMatch(saveSource, /writeFileSync\([^\n]*\.json/i);
  assert.doesNotMatch(saveSource, /fs\.writeFileSync\([^,]*,\s*JSON\.stringify\(this\.credentials\)\)/);
});

test('CredentialsManager removes plaintext fallback files instead of loading them', () => {
  const source = read('electron/services/CredentialsManager.ts');

  // Plaintext handling now lives in a dedicated remover; the file must still be
  // deleted, and NOTHING anywhere may read or parse it back in.
  assert.match(source, /private removePlaintextFile\(\): void/);
  assert.match(source, /Removed plaintext credential file/);
  assert.doesNotMatch(source, /Loaded plaintext credentials/);
  assert.doesNotMatch(source, /readFileSync\(plaintextPath/);
  assert.doesNotMatch(source, /const data = fs\.readFileSync\(plaintextPath/);
});

test('saveCredentials reports whether the write reached disk (keyring OR fallback) and false only on throw', () => {
  const source = read('electron/services/CredentialsManager.ts');
  const saveStart = source.indexOf('    private saveCredentials(): boolean');
  const saveEnd = source.indexOf('    private removeFallbackFile(): void', saveStart);
  const saveSource = source.slice(saveStart, saveEnd);

  assert.ok(saveStart >= 0, 'saveCredentials should return boolean');
  // A real keyring write returns true.
  assert.match(saveSource, /fs\.renameSync\(tmpEnc, CREDENTIALS_PATH\);[\s\S]*?return true;/);
  // The fallback write also returns true — keys now survive a restart without the keyring.
  assert.match(saveSource, /fs\.renameSync\(tmpFb, FALLBACK_PATH\);[\s\S]*?return true;/);
  // Only a thrown write returns false (a genuinely unwritable disk).
  assert.match(saveSource, /Failed to save credentials:[^\n]*\)\s*;\s*\n\s*return false;/);
});

test('isPersistenceAvailable is satisfied by the fallback, not just the keyring', () => {
  const source = read('electron/services/CredentialsManager.ts');
  const start = source.indexOf('public isPersistenceAvailable(): boolean');
  const block = source.slice(start, start + 600);
  assert.ok(start >= 0, 'isPersistenceAvailable should exist');
  // True when the keyring is available...
  assert.match(block, /safeStorage\.isEncryptionAvailable\(\)/);
  // ...OR when the app-managed fallback key can be derived.
  assert.match(block, /this\.getFallbackKey\(\)/);
});

test('loadCredentials reads the encrypted fallback and migrates up to the keyring when it returns', () => {
  const source = read('electron/services/CredentialsManager.ts');
  const loadStart = source.indexOf('    private loadCredentials(): void');
  const loadSource = source.slice(loadStart);

  assert.ok(loadStart >= 0, 'loadCredentials should exist');
  // Decrypts the fallback with the derived key.
  assert.match(loadSource, /decryptCredentialBlob\(blob, this\.getFallbackKey\(\)\)/);
  // Migrate-up: when the keyring is available again, re-persist (which prefers the
  // keyring and deletes the fallback).
  assert.match(loadSource, /migrating fallback credentials to keyring/);
  assert.match(loadSource, /this\.saveCredentials\(\)/);
});

test('CredentialsManager exposes isPersistenceAvailable for the STT-key save guard', () => {
  const source = read('electron/services/CredentialsManager.ts');
  assert.match(source, /public isPersistenceAvailable\(\): boolean/);
  // Persistence is available via the keyring OR the app-managed fallback (asserted
  // in detail by the 'satisfied by the fallback' test); here we just pin that the
  // keyring is still consulted as the preferred path.
  assert.match(source, /if \(safeStorage\.isEncryptionAvailable\(\)\) return true;/);
});

test('STT key IPC handlers warn on the ACTUAL write result, not a capability probe', () => {
  const source = read('electron/ipcHandlers.ts');
  assert.match(source, /const sttKeyPersistenceWarning/);
  // The guard must branch on the real persisted boolean (`!persisted`), NOT on
  // isPersistenceAvailable() — a capability probe can't see a disk-write failure,
  // which is how the original false-"Saved" bug slipped through.
  const guardStart = source.indexOf('const sttKeyPersistenceWarning');
  const guardBlock = source.slice(guardStart, guardStart + 700);
  assert.match(guardBlock, /apiKey: string, persisted: boolean/);
  assert.match(guardBlock, /apiKey\.trim\(\)\.length > 0 && !persisted/);
  assert.doesNotMatch(guardBlock, /isPersistenceAvailable\(\)/,
    'guard must use the real write result, not the capability probe');

  // Every STT key save handler must capture the setter's boolean and pass it to
  // the guard, so a failed disk write surfaces a real error instead of "Saved".
  const handlers = [
    'set-groq-stt-api-key',
    'set-openai-stt-api-key',
    'set-deepgram-api-key',
    'set-elevenlabs-api-key',
    'set-azure-api-key',
    'set-ibmwatson-api-key',
    'set-soniox-api-key',
  ];
  for (const id of handlers) {
    const start = source.indexOf(`'${id}'`);
    assert.ok(start >= 0, `${id} handler should exist`);
    const block = source.slice(start, start + 1000);
    assert.match(block, /const persisted = CredentialsManager\.getInstance\(\)\.set\w+\(apiKey\)/,
      `${id} should capture the setter's persisted result`);
    assert.match(block, /sttKeyPersistenceWarning\(apiKey, persisted\) \?\? \{ success: true \}/,
      `${id} should return the persistence-aware result`);
  }
});

test('STT key setters return the saveCredentials() boolean (not void)', () => {
  const source = read('electron/services/CredentialsManager.ts');
  const setters = [
    'setDeepgramApiKey', 'setGroqSttApiKey', 'setOpenAiSttApiKey',
    'setElevenLabsApiKey', 'setAzureApiKey', 'setIbmWatsonApiKey', 'setSonioxApiKey',
  ];
  for (const name of setters) {
    const re = new RegExp(`public ${name}\\(key: string\\): boolean`);
    assert.match(source, re, `${name} must return boolean`);
  }
});

test('CredentialsManager emits a privacy-safe storage-status diagnostic at startup and on STT-save failure', () => {
  const source = read('electron/services/CredentialsManager.ts');

  // A single emitter that both call sites reuse.
  assert.match(source, /public emitStorageStatusDiagnostic\(phase: 'startup' \| 'stt_save_failed'\): void/);
  // It must go through the shared TelemetryService under the typed event name.
  assert.match(source, /telemetryService\.record\('credential_storage_status', properties\)/);

  // Required environment fields — booleans/enums/platform only.
  assert.match(source, /available = safeStorage\.isEncryptionAvailable\(\)/);
  assert.match(source, /platform: process\.platform/);
  assert.match(source, /packaged: \(\(\) => \{ try \{ return app\.isPackaged === true;/);
  // Linux backend is the key no-keyring signal and must be probed (linux only).
  assert.match(source, /process\.platform === 'linux'/);
  assert.match(source, /getSelectedStorageBackend/);
  assert.match(source, /properties\.backend = getBackend\.call\(safeStorage\)/);

  // Startup emission wired into init().
  const initStart = source.indexOf('public init(): void');
  const initBlock = source.slice(initStart, initStart + 600);
  assert.match(initBlock, /this\.emitStorageStatusDiagnostic\('startup'\)/);

  // MUST NOT leak key material: no credential value / api-key field is logged.
  const emitStart = source.indexOf('public emitStorageStatusDiagnostic');
  const emitEnd = source.indexOf('\n    }', source.indexOf('telemetryService.record', emitStart));
  const emitBlock = source.slice(emitStart, emitEnd);
  assert.doesNotMatch(emitBlock, /this\.credentials/);
  assert.doesNotMatch(emitBlock, /ApiKey|apiKey|encryptString|decryptString/);
});

test('STT save-failure path emits the storage-status diagnostic for correlation', () => {
  const source = read('electron/ipcHandlers.ts');
  const guardStart = source.indexOf('const sttKeyPersistenceWarning');
  const guardBlock = source.slice(guardStart, guardStart + 700);
  // The failure branch (after the persistence check) must emit the diagnostic
  // so the failure can be correlated with the environment.
  assert.match(guardBlock, /emitStorageStatusDiagnostic\('stt_save_failed'\)/);
});

test('SettingsManager does not log full settings JSON', () => {
  const source = read('electron/services/SettingsManager.ts');

  assert.match(source, /Settings loaded successfully', \{ keys: Object\.keys\(this\.settings\)\.length \}/);
  assert.doesNotMatch(source, /JSON\.stringify\(this\.settings\)/);
  assert.doesNotMatch(source, /console\.(?:log|warn|error)\([^\n]*,\s*this\.settings\s*[),]/);
  assert.doesNotMatch(source, /console\.(?:log|warn|error)\([^\n]*,\s*parsed\s*[),]/);
});
