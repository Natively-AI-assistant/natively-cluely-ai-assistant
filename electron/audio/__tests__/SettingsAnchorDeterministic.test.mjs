import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const helperPath = path.resolve(__dirname, '../../../electron/SettingsWindowHelper.ts');
const source = readFileSync(helperPath, 'utf8');

test('SettingsWindowHelper anchors off the deterministic main window, not getAllWindows iteration order', () => {
  assert.ok(
    !/BrowserWindow\.getAllWindows\s*\(\s*\)\s*\.find\s*\(/.test(source),
    'BUG: SettingsWindowHelper must not pick an anchor by iterating BrowserWindow.getAllWindows().',
  );
  assert.ok(
    /toggleWindow[\s\S]*this\.windowHelper\?\.\s*getMainWindow\s*\(\s*\)/.test(source),
    'BUG: toggleWindow must look up the active main window via the WindowHelper.',
  );
  assert.ok(
    /emitVisibilityChange[\s\S]*this\.windowHelper\?\.\s*getMainWindow\s*\(\s*\)/.test(source),
    'BUG: settings-visibility-changed must target the active main window, not whichever window appears first in getAllWindows().',
  );
  assert.ok(
    /settings-visibility-changed dropped/.test(source),
    'BUG: emitVisibilityChange should surface a warning when no main window is bound so renderer/main desync is visible.',
  );
});
