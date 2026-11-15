// Live-pipeline forensics F-PRV-01 (2026-11-13): a speech provider picked in
// Settings with no key saved silently became Google STT, so meeting audio
// went to Google (whenever a Google service-account file or
// GOOGLE_APPLICATION_CREDENTIALS was around) without the user choosing it;
// without one, the user saw "Google Key Missing" for a provider they never
// picked. Now nothing is sent anywhere and the overlay says which key is
// missing. Google is used only when Google is the chosen provider.
// Shared TypeScript; the provider ladder has no platform branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO = path.resolve(__dirname, '../../..');
const { MissingKeySTT, missingSttKeyMessage, MISSING_STT_KEY_CODE } = require(path.join(REPO, 'dist-electron/electron/audio/MissingKeySTT.js'));
const { classifySttError } = await import(path.join(REPO, 'electron/audio/sttErrorClassifier.mjs'));

const tick = () => new Promise((r) => setImmediate(r));

test('the stand-in for a missing key sends no audio anywhere and says which key is missing, once per start', async () => {
    const stt = new MissingKeySTT('deepgram');
    const errors = [];
    stt.on('error', (e) => errors.push(e));
    stt.setSampleRate(48_000);
    stt.setRecognitionLanguage('en');
    stt.setCredentials('/x.json');
    stt.write(Buffer.alloc(640));
    await tick();
    assert.equal(errors.length, 0, 'nothing before start');
    stt.start();
    stt.stop();
    stt.start();
    stt.write(Buffer.alloc(640));
    stt.notifySpeechEnded();
    stt.finalize();
    await tick();
    assert.equal(errors.length, 1, 'coalesced: one report for the restart in one tick');
    const err = errors[0];
    assert.equal(err.code, MISSING_STT_KEY_CODE);
    assert.equal(err.terminal, true);
    assert.match(err.message, /^No Deepgram API key is saved/);
    assert.match(err.message, /Settings → Audio/);
    assert.equal(classifySttError(err).kind, 'auth', 'terminal: "failed", never "reconnecting" or a failover');
    stt.stop();
    stt.start();
    stt.stop();
    await tick();
    assert.equal(errors.length, 1, 'stopped before the report: nothing');
});

test('the message names each provider', () => {
    assert.match(missingSttKeyMessage('natively'), /^No Natively key is saved/);
    assert.match(missingSttKeyMessage('groq'), /^No Groq API key is saved/);
    assert.match(missingSttKeyMessage('nvidia_nim'), /^No NVIDIA NIM API key is saved/);
});

test('createSTTProvider builds Google only when Google is the chosen provider', () => {
    const main = fs.readFileSync(path.join(REPO, 'electron/main.ts'), 'utf8');
    const start = main.indexOf('private createSTTProvider(speaker');
    const ladder = main.slice(start, main.indexOf('stt.setRecognitionLanguage(sttLanguage);', start));
    assert.doesNotMatch(ladder, /falling back to GoogleSTT/i);
    assert.equal((ladder.match(/new GoogleSTT\(speaker\)/g) ?? []).length, 1, 'one Google construction');
    assert.match(ladder, /\} else if \(sttProvider === 'google'\) \{\s*stt = new GoogleSTT\(speaker\);/);
    // Every missing key, and an unknown provider id, gets the stand-in.
    assert.ok((ladder.match(/new MissingKeySTT\(sttProvider\)/g) ?? []).length >= 8);
    // The stand-in is no streaming connection: no stall watchdog, no recovery.
    assert.match(main, /stt instanceof MissingKeySTT \? 'none'/);
});

test('the overlay shows the message as a missing key, not a provider fault', async () => {
    const { categorizeSttError } = await import(path.join(REPO, 'src/lib/sttErrorMapper.ts'));
    const c = categorizeSttError(missingSttKeyMessage('soniox'));
    assert.equal(c.title, 'Key Missing');
    assert.equal(c.category, 'auth');
    assert.equal(c.body, missingSttKeyMessage('soniox'));
    // Google's own missing-file case is unchanged.
    assert.equal(categorizeSttError('Google speech-to-text has no working Service Account JSON. Add one in Audio Settings, or choose another speech provider.').title, 'Google Key Missing');
});
