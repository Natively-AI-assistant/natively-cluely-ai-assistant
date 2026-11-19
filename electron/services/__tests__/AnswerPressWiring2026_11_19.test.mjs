// 2026-11-19. Every What to answer press is counted into its meeting by what it
// gave (src/lib/funnel/answerPress.mjs), from the one IPC handler every press
// goes through (button, hotkey, phone, an accepted Auto Answer offer). Source
// pins: the handler is too entangled to drive here; FunnelTelemetry's counting
// and the classifier are tested by behaviour elsewhere. No platform branches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
const at = src.indexOf("'generate-what-to-say',");
const end = src.indexOf("safeHandle('generate-clarify'", at);
const body = src.slice(at, end);

test('the press is started before the answer runs and finished in a finally', () => {
  const start = body.indexOf('funnelTelemetry.answerPressStarted()');
  const run = body.indexOf('pressResult = await _tracked(');
  const fin = body.lastIndexOf('} finally {');
  const done = body.indexOf('pressDone(classifyAnswerPress({', fin);
  assert.ok(start > 0 && run > start, 'started before the answer runs');
  assert.ok(fin > run && done > fin, 'finished in a finally, so a throw is counted too');
  assert.match(body, /answersBefore = appState\.getIntelligenceManager\?\.\(\)\?\.getAnswerCount\?\.\(\)/);
  assert.match(body, /answersAfter: appState\.getIntelligenceManager\?\.\(\)\?\.getAnswerCount\?\.\(\)/);
  assert.match(body, /return pressResult;/);
});

test('counting never reaches the answer: wrapped in its own try', () => {
  assert.match(body, /try \{\s*pressDone\(classifyAnswerPress\(\{[\s\S]*?\}\)\);\s*\} catch \{ \/\* analytics never touches the answer \*\/ \}/);
});
