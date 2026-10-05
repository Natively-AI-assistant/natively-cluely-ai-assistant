// A live session (2026-10-04) stored the spoken line "Name." twice, 1.7 s
// apart: once from the mic, once re-added as typed chat when the Answer button
// sent it. The chat handler now asks this helper before re-adding.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const { spokenLineAlreadyInTranscript, SPOKEN_DUPLICATE_WINDOW_MS } = await import(pathToFileURL(
  path.resolve(root, 'dist-electron/electron/llm/spokenLineAlreadyInTranscript.js')).href);

const NOW = 1_791_108_903_319;
const spoken = (text, agoMs = 1700, speaker = 'user') => ({ speaker, text, timestamp: NOW - agoMs, origin: 'stt' });

describe('spokenLineAlreadyInTranscript', () => {
  test('the exact case from the session: the mic stored it 1.7 s earlier', () => {
    assert.equal(spokenLineAlreadyInTranscript([spoken('Name.')], 'Name.', NOW), true);
  });

  test('punctuation and case differences still match', () => {
    assert.equal(spokenLineAlreadyInTranscript([spoken('What is your biggest weakness?')], 'what is your biggest weakness', NOW), true);
  });

  test('a question joined from two mic segments matches', () => {
    const t = [spoken('Tell me about', 4000), spoken('your last project.', 1500)];
    assert.equal(spokenLineAlreadyInTranscript(t, 'Tell me about your last project.', NOW), true);
  });

  test('typed chat with the same words is not speech', () => {
    const t = [{ speaker: 'user', text: 'Name.', timestamp: NOW - 1000, origin: 'manual_chat' }];
    assert.equal(spokenLineAlreadyInTranscript(t, 'Name.', NOW), false);
  });

  test("the other side's speech does not count as the user's", () => {
    assert.equal(spokenLineAlreadyInTranscript([spoken('Name.', 1700, 'interviewer')], 'Name.', NOW), false);
  });

  test('an old spoken line is outside the window', () => {
    assert.equal(spokenLineAlreadyInTranscript([spoken('Name.', SPOKEN_DUPLICATE_WINDOW_MS + 1)], 'Name.', NOW), false);
  });

  test('a question whose STT final never landed is kept', () => {
    assert.equal(spokenLineAlreadyInTranscript([spoken('Something else entirely.')], 'Name.', NOW), false);
    assert.equal(spokenLineAlreadyInTranscript([], 'Name.', NOW), false);
    assert.equal(spokenLineAlreadyInTranscript(null, 'Name.', NOW), false);
  });

  test('a question that is part of a longer spoken line matches', () => {
    assert.equal(spokenLineAlreadyInTranscript([spoken('Okay, so tell me about your last project please.')], 'Tell me about your last project', NOW), true);
  });

  test('an earlier short utterance does not make an unrecorded question look recorded', () => {
    // "okay" was said a minute ago; the question's own STT final never landed.
    const t = [spoken('Okay.', 60_000)];
    assert.equal(spokenLineAlreadyInTranscript(t, 'Okay so how would you design the retry policy', NOW), false);
    assert.equal(spokenLineAlreadyInTranscript([spoken('Yes.', 5000), spoken('Design.', 3000)], 'How would you design this, yes or no?', NOW), false);
  });

  test('matching is by whole words, not characters', () => {
    assert.equal(spokenLineAlreadyInTranscript([spoken('So.')], 'Tell me something personal.', NOW), false);
    assert.equal(spokenLineAlreadyInTranscript([spoken('Tell me something personal about your reasons.')], 'person', NOW), false);
  });

  test('a spoken segment of only punctuation never matches', () => {
    assert.equal(spokenLineAlreadyInTranscript([spoken('...')], 'Name.', NOW), false);
  });
});

describe('wiring', () => {
  const src = fs.readFileSync(path.resolve(root, 'electron/ipcHandlers.ts'), 'utf8');

  test('the chat handler checks before re-adding, at both of its record sites', () => {
    const checks = src.match(/questionOnRecordAsSpeech = options\?\.liveQuestion === true\s*&& spokenLineAlreadyInTranscript\(/g) || [];
    assert.equal(checks.length, 2, 'the main record site and the legacy identity reply');
    const guarded = src.match(/if \(!questionOnRecordAsSpeech\) \{\s*intelligenceManager\.addTranscript\(/g) || [];
    assert.equal(guarded.length, 2);
  });

  test("the Answer button's first route (live search) has the same guard", () => {
    const at = src.indexOf('function recordLiveRagTurn(');
    const body = src.slice(at, at + 5200);
    assert.match(body, /questionOnRecordAsSpeech = spokenLineAlreadyInTranscript\(im\?\.getCurrentMeetingTranscript\?\.\(\) \?\? \[\], query, Date\.now\(\)\);\s*if \(!questionOnRecordAsSpeech\) \{\s*im\?\.addTranscript\?\.\(/);
    assert.match(body, /addAssistantMessage\?\.\(ragLiveAnswer, questionOnRecordAsSpeech \? \{ answersSpokenQuestion: true \} : undefined, 'manual_chat'\)/);
  });
});
