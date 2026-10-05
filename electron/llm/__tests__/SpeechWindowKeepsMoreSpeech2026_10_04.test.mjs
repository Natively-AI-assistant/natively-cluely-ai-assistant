// The live speech window keeps four to five minutes of talk (2026-10-04, E12).
// Measured in the real app at 2,400 chars: a 20-line exchange (~3,000 chars,
// about ninety seconds) had already lost its first line. And the heard path
// read 60–90 s of a rolling context that is evicted after 180 s, so no budget
// could have kept more. Now: 6,000 chars from the durable transcript.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const P = await import(pathToFileURL(path.join(root, 'dist-electron/electron/llm/conversationHistoryPolicy.js')).href);
const line = (i) => `[${i % 2 ? 'INTERVIEWER' : 'ME'}]: line ${i} ${'talk '.repeat(28)}`.trim();

describe('speech window', () => {
  test('a 30-line exchange (~4,500 chars) is kept whole', () => {
    const formatted = Array.from({ length: 30 }, (_, i) => line(i)).join('\n');
    assert.ok(formatted.length > 2400 && formatted.length < P.SPEECH_WINDOW_MAX_CHARS);
    const w = P.speechWindowForPrompt(formatted);
    assert.ok(w.includes('line 0 ') && w.includes('line 29 '));
  });
  test('beyond the budget the NEWEST whole lines are kept', () => {
    const formatted = Array.from({ length: 80 }, (_, i) => line(i)).join('\n');
    const w = P.speechWindowForPrompt(formatted);
    assert.ok(w.length <= P.SPEECH_WINDOW_MAX_CHARS);
    assert.ok(w.includes('line 79 ') && !w.includes('line 0 '));
    assert.ok(/^\[(ME|INTERVIEWER)\]: line \d+ /.test(w), 'starts at a line boundary');
  });
  test('the sizes', () => {
    assert.equal(P.SPEECH_WINDOW_MAX_CHARS, 6000);
    assert.equal(P.SPEECH_WINDOW_SECONDS, 600);
    assert.equal(P.SPEECH_WINDOW_HISTORY_CHARGE_MAX, 2400);
  });
});

describe('wiring', () => {
  const engine = fs.readFileSync(path.join(root, 'electron/IntelligenceEngine.ts'), 'utf8');
  const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
  const bridge = fs.readFileSync(path.join(root, 'electron/context-intelligence/orchestration/engine-bridge.ts'), 'utf8');
  test('both answer paths read the durable transcript', () => {
    assert.match(engine, /getFormattedSpeech\(SPEECH_WINDOW_SECONDS\)/);
    assert.match(ipc, /getFormattedSpeech\(SPEECH_WINDOW_SECONDS\)/);
  });
  test('the larger window does not shrink what earlier exchanges are given', () => {
    assert.match(bridge, /budgetChars - Math\.min\(speech\.length, SPEECH_WINDOW_HISTORY_CHARGE_MAX\)/);
  });
});
