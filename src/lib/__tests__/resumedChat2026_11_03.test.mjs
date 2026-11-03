// A resumed meeting's overlay chat carries on from the saved meeting (2026-11-03).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resumedChatMessages, resumedDirectHistory } from '../resumedChat.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const entries = [
  { type: 'assist', timestamp: 1, question: 'What to Answer', answer: 'Say the launch moves.', hasImages: true },
  { type: 'chat', timestamp: 2, question: 'Who owns billing?', answer: 'Priya.', source: 'manual_chat' },
  { type: 'chat', timestamp: 3, question: 'Recap Meeting', answer: 'Launch on the 18th.', source: 'generated_action', synthetic: true },
  { type: 'rag_live', timestamp: 4, question: 'what did Sam say', answer: 'He agreed.' },
  { type: 'chat', timestamp: 5, question: 'Empty', answer: '  ' },
];

test('each answer comes back with its question; buttons show as labels, typed questions as questions', () => {
  const m = resumedChatMessages(entries);
  assert.deepEqual(m.map((x) => [x.role, x.text]), [
    ['user', 'What to Answer'], ['system', 'Say the launch moves.'],
    ['user', 'Who owns billing?'], ['system', 'Priya.'],
    ['user', 'Recap Meeting'], ['system', 'Launch on the 18th.'],
    ['user', 'what did Sam say'], ['system', 'He agreed.'],
  ]);
  assert.equal(m[0].isQuickActionLabel, true);
  assert.equal(m[0].hasScreenshot, true);
  assert.equal(m[2].isQuickActionLabel, undefined, 'typed');
  assert.equal(m[4].isQuickActionLabel, true, 'Recap is a button');
  assert.equal(m[6].isQuickActionLabel, undefined, 'live search is typed');
  assert.ok(m.every((x) => x.id.startsWith('resumed-')));
  assert.equal(new Set(m.map((x) => x.id)).size, m.length, 'ids are unique');
});

test('an answer without a question still shows', () => {
  assert.deepEqual(resumedChatMessages([{ type: 'chat', timestamp: 1, question: '', answer: 'Hi' }]).map((x) => x.role), ['system']);
});

test('nothing to show: not a resume, or junk', () => {
  assert.deepEqual(resumedChatMessages(undefined), []);
  assert.deepEqual(resumedChatMessages('x'), []);
  assert.deepEqual(resumedChatMessages([null, {}]), []);
});

test('typed turns become Direct history, the last 12 pairs', () => {
  assert.deepEqual(resumedDirectHistory(entries), [
    { role: 'user', content: 'Who owns billing?' }, { role: 'assistant', content: 'Priya.' },
    { role: 'user', content: 'what did Sam say' }, { role: 'assistant', content: 'He agreed.' },
  ]);
  const many = Array.from({ length: 20 }, (_, i) => ({ type: 'chat', source: 'manual_chat', timestamp: i, question: `q${i}`, answer: `a${i}` }));
  const h = resumedDirectHistory(many);
  assert.equal(h.length, 24);
  assert.equal(h[0].content, 'q8');
});

test('the overlay fills its chat from the start\'s session-reset', () => {
  const src = fs.readFileSync(path.join(REPO, 'src/components/NativelyInterface.tsx'), 'utf8');
  const start = src.indexOf('window.electronAPI.onSessionReset((payload)');
  assert.ok(start > 0);
  const body = src.slice(start, src.indexOf('return () => unsubscribe();', start));
  assert.ok(body.indexOf('setMessages([])') < body.indexOf('resumedChatMessages(payload?.resumedChat)'), 'cleared first, then the earlier chat');
  assert.match(body, /directAssistHistoryRef\.current = resumedDirectHistory\(payload\?\.resumedChat\)/);
});
