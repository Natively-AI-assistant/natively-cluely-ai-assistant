// The Usage statistics switch in Settings › General › Advanced: the one visible
// control over every optional report the app makes about itself.
//
// What the switch DOES is executed in electron/services/__tests__/
// FunnelIpc2026_10_01.test.mjs (through the real handlers). This file pins the
// part only the renderer source can show: the row exists, it reads and writes
// through the bridge, it goes back when the write is refused, and both strings
// are translated everywhere the row above it is.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(here, p), 'utf8');
const overlay = read('../SettingsOverlay.tsx');
const row = overlay.slice(overlay.indexOf('{/* Usage statistics */}'), overlay.indexOf('{/* Debug Logging */}'));

const LABEL = 'Usage statistics';
const DESC = 'Sends which features are used and how often. Never what you say, see or type.';

test('the row sits directly above Debug logging, inside the advanced section', () => {
  assert.ok(row.length > 0, 'the Usage statistics row must come before the Debug Logging row');
  assert.ok(overlay.indexOf('<Disclosure open={showAdvancedSettings}') < overlay.indexOf('{/* Usage statistics */}'));
  assert.ok(row.includes(`{t('${LABEL}')}`));
  assert.ok(row.includes(`{t('${DESC}')}`));
});

test('it is on by default and takes its real state from the main process', () => {
  assert.match(overlay, /const \[usageStatistics, setUsageStatistics\] = useState\(true\);/);
  assert.ok(overlay.includes('window.electronAPI?.getUsageStatistics?.().then((v) => setUsageStatistics(v !== false))'));
});

test('a refused write puts the switch back, so it never shows off while reports continue', () => {
  assert.ok(row.includes('const revert = () => setUsageStatistics(!newState);'));
  assert.ok(row.includes('window.electronAPI?.setUsageStatistics?.(newState)'));
  assert.ok(row.includes('pending.then((r) => { if (!r?.success) revert(); }).catch(revert);'));
  assert.ok(row.includes('if (!pending) { revert(); return; }'), 'a missing bridge is a refusal too');
});

test('the copy carries no long dashes', () => {
  assert.ok(!/[–—]/.test(LABEL + DESC));
});

test('both strings are translated in every language Debug logging is', () => {
  for (const file of ['../../i18n.tsx', '../../i18n.es.generated.ts', '../../i18n.zh.generated.ts', '../../i18n.ja.generated.ts']) {
    const text = read(file);
    assert.ok(text.includes('Debug logging'), `${file}: precondition`);
    for (const key of [LABEL, DESC]) {
      const m = text.match(new RegExp(`['"]${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]: ['"](.+?)['"],`));
      assert.ok(m, `${file} has no translation for "${key}"`);
      assert.notEqual(m[1], key, `${file}: "${key}" is not translated`);
      assert.ok(!/[–—]/.test(m[1]), `${file}: no long dashes in translated copy`);
    }
  }
});

test('the bridge and its types name both calls', () => {
  const preload = read('../../../electron/preload.ts');
  assert.ok(preload.includes("getUsageStatistics: () => ipcRenderer.invoke('get-usage-statistics'),"));
  assert.ok(preload.includes("setUsageStatistics: (enabled: boolean) => ipcRenderer.invoke('set-usage-statistics', enabled),"));
  const types = read('../../types/electron.d.ts');
  assert.ok(types.includes('getUsageStatistics: () => Promise<boolean>;'));
  assert.ok(types.includes('setUsageStatistics: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;'));
});
