// F-502 regression test (audit/autopilot-2026-08-18).
//
// streamContextPolicy documents pinnedModeId as the defence against a
// mid-request `modes:set-active` leaking a different mode's document content
// into an answer whose contract is scoped to the first mode. Only the WTA path
// ever produced it: desktop manual chat and phone-mirror chat both built
// StreamRouteOptions without it, so every mode read inside streamChat after an
// await resolved the LIVE ModesManager singleton.
//
// The phone surface was the worse half — unlike desktop it never registers in
// _chatStreamsBySender, so modes:set-active does not abort it either. It had
// neither the pin nor the abort.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const src = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
const helper = fs.readFileSync(path.join(root, 'electron/LLMHelper.ts'), 'utf8');

test('desktop manual chat pins the t0 mode id', () => {
  const blocks = [];
  for (let i = src.indexOf('answerType: answerPlan.answerType,'); i !== -1;
       i = src.indexOf('answerType: answerPlan.answerType,', i + 1)) {
    blocks.push(src.slice(i, i + 1600));
  }
  assert.ok(blocks.length > 0, 'no manual-chat StreamRouteOptions literal found');
  assert.ok(
    /pinnedModeId:\s*manualActiveMode\?\.id\s*\?\?\s*null/.test(blocks.join('\n')),
    'manual chat must pass the mode captured at request start (F-502)'
  );
});

test('phone-mirror chat captures a mode id at t0 and passes it', () => {
  assert.ok(/phonePinnedModeId\s*=\s*phoneModeInfo\?\.id\s*\?\?\s*null/.test(src),
    'the phone path must capture the active mode id at t0 (F-502)');
  const i = src.indexOf('phoneRouteOptions = {');
  assert.notEqual(i, -1);
  assert.ok(/pinnedModeId:\s*phonePinnedModeId/.test(src.slice(i, i + 500)),
    'the phone StreamRouteOptions must carry the pin (F-502)');
});

test('the phone pin is captured before the provider stream starts', () => {
  const capture = src.indexOf('phonePinnedModeId: string | null = null');
  const stream = src.indexOf('llmHelper.streamChat(message, undefined, context');
  assert.notEqual(capture, -1);
  assert.notEqual(stream, -1);
  assert.ok(capture < stream, 'the pin must be taken before the awaits it protects');
});

test('LLMHelper still honours the pin (pinning must not be theatre)', () => {
  assert.ok(/routeOptions\?\.pinnedModeId\s*\?\?\s*null/.test(helper),
    'LLMHelper must resolve the pinned mode rather than the live singleton');
});
