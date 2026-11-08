// Granola parity round 4 (2026-10-16): language-aware failover. When the live
// transcription provider goes down, a stand-in that cannot do the user's
// language is skipped, so a non-English meeting is never handed to an
// English-only transcriber. Pure logic; no network, no settings singletons.
//
// Run (after `npm run build:electron`):
//   node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=natively-test-userdata \
//     --set ELECTRON_RUN_AS_NODE=1 -- electron --test --test-force-exit <this file>
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const lang = require(path.join(REPO, 'dist-electron/electron/audio/sttLanguageSupport.js'));

// Stand-ins: a model per provider; `en-only` is an english-only checkpoint.
const MODELS = { deepgram: 'nova-3', openai: 'en-only', groq: 'whisper-large', 'local-whisper': 'local' };
const deps = (localKeys) => ({
    modelFor: (id) => MODELS[id],
    isEnglishOnlyModel: (_id, model) => model === 'en-only',
    localModelLanguageKeys: (id) => (id === 'local-whisper' ? (localKeys ?? null) : null),
});

describe('sttCandidateSupportsLanguage', () => {
    test('English (any variant) and auto are supported by every provider', () => {
        for (const key of ['english-us', 'english-uk', 'auto', 'english']) {
            for (const id of ['deepgram', 'openai', 'groq']) {
                assert.equal(lang.sttCandidateSupportsLanguage(id, key, deps()), true, `${id}/${key}`);
            }
        }
    });
    test('a non-English language excludes an english-only model, keeps an unrestricted one', () => {
        assert.equal(lang.sttCandidateSupportsLanguage('openai', 'japanese', deps()), false);
        assert.equal(lang.sttCandidateSupportsLanguage('deepgram', 'japanese', deps()), true);
        assert.equal(lang.sttCandidateSupportsLanguage('groq', 'spanish', deps()), true);
    });
    test('a Parakeet-only language is kept only for a local model whose set has it', () => {
        // cloud providers are not verified for these
        assert.equal(lang.sttCandidateSupportsLanguage('deepgram', 'estonian', deps()), false);
        // a local model that lists it
        assert.equal(lang.sttCandidateSupportsLanguage('local-whisper', 'estonian', deps(new Set(['estonian', 'english-us']))), true);
        // a local model that does not
        assert.equal(lang.sttCandidateSupportsLanguage('local-whisper', 'estonian', deps(new Set(['english-us']))), false);
    });
    test('a local model is judged against its own language set, not the english-only rule', () => {
        assert.equal(lang.sttCandidateSupportsLanguage('local-whisper', 'japanese', deps(new Set(['japanese']))), true);
        assert.equal(lang.sttCandidateSupportsLanguage('local-whisper', 'japanese', deps(new Set(['spanish']))), false);
    });
    test('an unknown provider or unknown restriction is kept, never wrongly excluded', () => {
        assert.equal(lang.sttCandidateSupportsLanguage('soniox', 'japanese', deps()), true);
        assert.equal(lang.sttCandidateSupportsLanguage('elevenlabs', 'arabic', deps()), true);
    });
});

describe('candidatesForLanguage', () => {
    test('English keeps every candidate in order (the common case is unchanged)', () => {
        const ids = ['openai', 'deepgram', 'groq', 'local-whisper'];
        assert.deepEqual(lang.candidatesForLanguage(ids, 'english-us', deps(new Set(['english-us']))), ids);
    });
    test('a non-English meeting drops the english-only stand-in, preserving order', () => {
        const ids = ['deepgram', 'openai', 'groq'];
        assert.deepEqual(lang.candidatesForLanguage(ids, 'japanese', deps()), ['deepgram', 'groq']);
    });
    test('when nothing can do the language the list is empty on purpose (no wrong-language failover)', () => {
        assert.deepEqual(lang.candidatesForLanguage(['openai'], 'japanese', deps()), []);
    });
});

describe('isEnglishLanguageKey', () => {
    test('true for english variants and the bare english group, false for others and auto', () => {
        assert.equal(lang.isEnglishLanguageKey('english-us'), true);
        assert.equal(lang.isEnglishLanguageKey('english'), true);
        assert.equal(lang.isEnglishLanguageKey('japanese'), false);
        assert.equal(lang.isEnglishLanguageKey('auto'), false);
    });
});
