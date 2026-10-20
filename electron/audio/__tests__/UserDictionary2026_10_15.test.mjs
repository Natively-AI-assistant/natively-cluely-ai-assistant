// The user's dictionary (2026-10-15): names and words the transcript should
// spell right, edited in Settings > Audio, sent to every provider that takes a
// word list, each in its own shape. Platform-neutral: strings in the settings
// JSON and plain request fields, identical on macOS and Windows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO = path.resolve(__dirname, '../../..');
const DIST = path.join(REPO, 'dist-electron/electron/audio');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

const dict = require(path.join(DIST, 'userDictionary.js'));
const terms = require(path.join(DIST, 'sttContextTerms.js'));

function memoryStore(initial, { refuse = false } = {}) {
    const data = { userDictionary: initial };
    return { data, get: (k) => data[k], set: (k, v) => { if (refuse) return false; data[k] = v; return true; } };
}

test('sanitize: trimmed, one per word (case-insensitive), identifier-like only, at most 100', () => {
    assert.deepEqual(
        dict.sanitizeUserDictionary(['  Kubernetes ', 'kubernetes', 'Priya   Raman', '<script>', '', 7, 'C++', 'C#', 'AT&T', 'Node.js', '.NET', '---', 'x'.repeat(41)]),
        ['Kubernetes', 'Priya Raman', 'C++', 'C#', 'AT&T', 'Node.js', '.NET'],
    );
    const many = Array.from({ length: 150 }, (_, i) => `Term${i}`);
    const kept = dict.sanitizeUserDictionary(many);
    assert.equal(kept.length, 100);
    assert.equal(kept[99], 'Term99', 'the first 100, in the user\'s order');
    assert.deepEqual(dict.sanitizeUserDictionary('not a list'), []);
});

test('pasted text splits on lines, commas and semicolons', () => {
    assert.deepEqual(dict.parseUserDictionaryText('Acme Corp, Priya\nZoho;  acme corp'), ['Acme Corp', 'Priya', 'Zoho']);
});

test('getUserDictionary / setUserDictionary read and write the settings store, cleaned', () => {
    const store = memoryStore(['Stripe', 'stripe', '  Lena ']);
    assert.deepEqual(dict.getUserDictionary(store), ['Stripe', 'Lena']);
    assert.deepEqual(dict.setUserDictionary(['Figma', 'figma', 'Lena'], store), ['Figma', 'Lena']);
    assert.deepEqual(store.data.userDictionary, ['Figma', 'Lena']);
    assert.equal(dict.setUserDictionary(['x'], memoryStore([], { refuse: true })), null, 'a refused write says so');
    assert.deepEqual(dict.getUserDictionary({ get() { throw new Error('degraded'); }, set() { return false; } }), []);
    assert.deepEqual(dict.getUserDictionary(memoryStore(undefined)), []);
});

test('the terms every provider reads: the name first, then the dictionary, 100 at most', () => {
    terms.setSttContextTerms(['Evin John', 'Evin']);
    terms.setSttDictionaryTerms(['Natively', 'evin', ...Array.from({ length: 200 }, (_, i) => `W${i}`)]);
    const all = terms.getSttContextTerms();
    assert.deepEqual(all.slice(0, 3), ['Evin John', 'Evin', 'Natively']);
    assert.equal(all.length, 100);
    assert.equal(terms.getSttDictionaryTerms().length, 100);
    terms.setSttContextTerms([]);
    terms.setSttDictionaryTerms([]);
    assert.deepEqual(terms.getSttContextTerms(), []);
});

test('per-provider shapes: Deepgram, Natively, Google, Whisper prompt', () => {
    const list = ['Evin', 'C++', 'AT&T', 'Priya Raman'];
    assert.deepEqual(terms.deepgramHintParams('nova-3-general', list), { keyterm: list });
    assert.deepEqual(terms.deepgramHintParams('nova-2-meeting', list), { keywords: list });
    assert.deepEqual(terms.deepgramHintParams('enhanced', list), {});
    assert.deepEqual(terms.deepgramHintParams('nova-3', []), {});
    assert.deepEqual(terms.nativelyContextTerms(list), ['Evin', 'Priya Raman'], 'natively-api\'s own charset only');
    assert.deepEqual(terms.googleSpeechContexts(list), [{ phrases: list }]);
    assert.deepEqual(terms.googleSpeechContexts([]), []);
    assert.equal(terms.whisperGlossaryPrompt(list), 'Glossary: Evin, C++, AT&T, Priya Raman.');
    const long = terms.whisperGlossaryPrompt(Array.from({ length: 100 }, (_, i) => `Longish term ${i}`), 120);
    assert.ok(long.length <= 120 && long.endsWith('.'), 'whole terms inside the window');
    assert.equal(terms.whisperGlossaryPrompt([]), '');
});

test('a Whisper prompt is sent only when the user has a dictionary, never for the name alone', () => {
    terms.setSttContextTerms(['Evin']);
    terms.setSttDictionaryTerms([]);
    assert.equal(terms.currentWhisperGlossaryPrompt(), '');
    terms.setSttDictionaryTerms(['Natively']);
    assert.equal(terms.currentWhisperGlossaryPrompt(), 'Glossary: Evin, Natively.');
    terms.setSttContextTerms([]);
    terms.setSttDictionaryTerms([]);
});

test('Whisper echoing its prompt on silence is dropped; real speech with a glossary word is kept', () => {
    const prompt = 'Glossary: Evin, Natively.';
    assert.equal(terms.isGlossaryEcho('Glossary: Evin, Natively.', prompt), true);
    assert.equal(terms.isGlossaryEcho('glossary natively', prompt), true);
    assert.equal(terms.isGlossaryEcho('Evin, can you take this one?', prompt), false);
    assert.equal(terms.isGlossaryEcho('Natively', prompt), false);
    assert.equal(terms.isGlossaryEcho('Glossary: Evin', ''), false);
});

test('Soniox and Deepgram connect frames carry the dictionary', () => {
    const { SonioxStreamingSTT } = require(path.join(DIST, 'SonioxStreamingSTT.js'));
    const { DeepgramStreamingSTT } = require(path.join(DIST, 'DeepgramStreamingSTT.js'));
    terms.setSttContextTerms(['Evin']);
    terms.setSttDictionaryTerms(['Kubernetes']);
    assert.deepEqual(new SonioxStreamingSTT('k').buildConfigFrame().context, { terms: ['Evin', 'Kubernetes'] });
    assert.deepEqual(new DeepgramStreamingSTT('k', 'nova-3').hintTerms(), { keyterm: ['Evin', 'Kubernetes'] });
    terms.setSttContextTerms([]);
    terms.setSttDictionaryTerms([]);
});

test('OpenAI: prompt on gpt-4o-transcribe sessions, never on the live model; REST paths send it too', () => {
    const { OpenAIStreamingSTT } = require(path.join(DIST, 'OpenAIStreamingSTT.js'));
    terms.setSttDictionaryTerms(['Natively']);
    const stt = new OpenAIStreamingSTT('k');
    const tx = (m) => stt._buildSessionUpdate(m).session.audio.input.transcription;
    assert.equal(tx('gpt-4o-transcribe').prompt, 'Glossary: Natively.');
    assert.equal(tx('gpt-live-transcribe').prompt, undefined);
    terms.setSttDictionaryTerms([]);
    assert.equal(tx('gpt-4o-transcribe').prompt, undefined, 'unchanged without a dictionary');

    const openai = read('electron/audio/OpenAIStreamingSTT.ts');
    assert.match(openai, /const prompt = currentWhisperGlossaryPrompt\(\);\s*if \(prompt\) form\.append\('prompt', prompt\);/);
    const rest = read('electron/audio/RestSTT.ts');
    assert.match(rest, /\(this\.provider === 'groq' \|\| this\.provider === 'openai'\) \? currentWhisperGlossaryPrompt\(\) : ''/);
    assert.match(rest, /isGlossaryEcho\(text, prompt\) \? '' : text/);
});

test('Natively sends its charset of the terms; Google sends them as phrases; local Whisper gets the prompt', () => {
    assert.match(read('electron/audio/NativelyProSTT.ts'), /nativelyContextTerms\(getSttContextTerms\(\)\)/);
    assert.match(read('electron/audio/GoogleSTT.ts'), /speechContexts: googleSpeechContexts\(getSttContextTerms\(\)\)/);
    const main = read('electron/main.ts');
    assert.match(main, /setSttDictionaryTerms\(getUserDictionary\(\)\)/);
    assert.match(main, /\(stt as any\)\.setContext\(currentWhisperGlossaryPrompt\(\)\)/);
});

test('Settings: the IPC pair saves through the cleaner and refreshes the live terms; the Audio tab shows the list', () => {
    const ipc = read('electron/ipcHandlers.ts');
    assert.match(ipc, /safeHandle\('user-dictionary-get'/);
    assert.match(ipc, /safeHandle\('user-dictionary-set'[\s\S]{0,500}setUserDictionary\(terms\)[\s\S]{0,300}setSttDictionaryTerms\(saved\)/);
    const preload = read('electron/preload.ts');
    assert.match(preload, /getUserDictionary: \(\) => ipcRenderer\.invoke\('user-dictionary-get'\)/);
    assert.match(preload, /setUserDictionary: \(terms: string\[\]\) => ipcRenderer\.invoke\('user-dictionary-set', terms\)/);
    const overlay = read('src/components/SettingsOverlay.tsx');
    const audio = overlay.indexOf("{activeTab === 'audio' && (");
    const dictAt = overlay.indexOf('<SpeechDictionarySettings sttProvider={sttProvider} />');
    // Under the input and output devices, above the meeting app's mute row (2026-10-20).
    // Anchored on markup (the section heading, the mute row's icon), not comments.
    const heading = overlay.indexOf("{t('Audio Configuration')}");
    const muteRow = overlay.indexOf('<MicOff size={20} />');
    assert.ok(audio > 0 && heading > audio && dictAt > heading && muteRow > dictAt);
});
