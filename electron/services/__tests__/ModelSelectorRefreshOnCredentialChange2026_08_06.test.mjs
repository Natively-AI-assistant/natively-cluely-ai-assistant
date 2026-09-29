// The meeting-overlay model selector must rebuild its list when providers change.
//
// THE BUG: ModelSelectorWindowHelper pre-warms its BrowserWindow offscreen and
// thereafter only hide()s / show()s it — closeWindow() calls hideWindow(), and
// the window is recreated only `if (!this.window || this.window.isDestroyed())`.
// So the React component mounts ONCE per app lifetime and its `useEffect(…, [])`
// runs loadModels() exactly once, at startup.
//
// With no `credentials-changed` subscription, the list was frozen at that
// startup snapshot: configure a LiteLLM proxy (or add an API key, or sign into
// Codex) afterwards and the models never appeared in the overlay until the app
// was restarted.
//
// It failed SILENTLY — which is why it survived — because `availableModels`
// seeds from localStorage['cached-models'] and `isLoading` is false whenever
// that cache is non-empty. So the stale list rendered with no spinner, no error
// and no empty state.
//
// These are source-level assertions because the failure is a missing
// SUBSCRIPTION across a window-lifetime boundary — there is no pure function to
// call, and a DOM-level test would need the whole Electron multi-window harness.
//
// Run via: node --test electron/services/__tests__/ModelSelectorRefreshOnCredentialChange2026_08_06.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const selector = fs.readFileSync(path.join(root, 'src/components/ModelSelectorWindow.tsx'), 'utf8');
const helper = fs.readFileSync(path.join(root, 'electron/ModelSelectorWindowHelper.ts'), 'utf8');
const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');

describe('model selector list invalidation', () => {
  test('the selector rebuilds its list on credentials-changed', () => {
    assert.match(
      selector,
      /onCredentialsChanged\?\.\(\(\) => \{\s*loadModels\(\);\s*\}\)/,
      'the selector must reload the model list when providers change',
    );
  });

  test('the subscription is torn down with the effect', () => {
    // A leaked listener on a window that outlives every other renderer would
    // keep firing loadModels forever.
    assert.match(selector, /unsubCredentials\?\.\(\)/, 'the credentials listener must be unsubscribed');
  });

  test('onModelChanged is NOT treated as a substitute', () => {
    // It only moves the checkmark. Relying on it was the original mistake.
    // Anchor on the SUBSCRIPTION CALL, not the first textual mention — the
    // latter is a comment far above loadModels()' own definition, so slicing
    // from it swallows the whole function and the assertion measures nothing.
    const callSite = selector.indexOf('window.electronAPI?.onModelChanged?.(');
    assert.ok(callSite !== -1, 'the onModelChanged subscription should exist');
    const handler = selector.slice(callSite, selector.indexOf('onCredentialsChanged?.('));
    assert.doesNotMatch(handler, /loadModels\(\)/, 'onModelChanged must not be the list-refresh path');
    assert.match(handler, /setCurrentModel\(modelId\)/, 'onModelChanged still just tracks the active model');
  });

  test('only the newest load may commit (stale-overwrite guard)', () => {
    // A cold LiteLLM discovery takes up to 5s; a load started before a
    // credential change must not land after the reload it triggered.
    assert.match(selector, /const myToken = \+\+runToken/, 'each run needs a token');
    assert.match(selector, /if \(cancelled \|\| myToken !== runToken\) return/, 'stale runs must not commit the list');
    assert.match(selector, /if \(!cancelled && myToken === runToken\) setIsLoading\(false\)/, 'nor the loading flag');
  });

  test('the premise still holds: the window is REUSED, not recreated per open', () => {
    // If this ever changes to destroy-on-close, the component would remount and
    // reload naturally — but until then the subscription is the only refresh.
    assert.match(helper, /closeWindow\(\)[\s\S]{0,80}this\.hideWindow\(\)/, 'close should still hide, not destroy');
    assert.match(
      helper,
      /if \(!this\.window \|\| this\.window\.isDestroyed\(\)\)/,
      'the window should still be reused when it already exists',
    );
  });

  test('the LiteLLM config + refresh paths actually emit the signal', () => {
    // The subscription is only as good as the broadcast behind it.
    const setConfig = ipc.slice(
      ipc.indexOf("safeHandle('set-litellm-config'"),
      ipc.indexOf("const discoverLitellmModels"),
    );
    assert.match(setConfig, /broadcastCredentialsChanged\(\)/, 'saving a proxy must notify renderers');
    const refresh = ipc.slice(
      ipc.indexOf("safeHandle('refresh-litellm-models'"),
      ipc.indexOf("safeHandle('refresh-litellm-models'") + 500,
    );
    assert.match(refresh, /broadcastCredentialsChanged\(\)/, 're-discovery must notify renderers');
    assert.match(
      ipc,
      /BrowserWindow\.getAllWindows\(\)\.forEach[\s\S]{0,140}send\('credentials-changed'\)/,
      'the broadcast must reach EVERY window, including the selector',
    );
  });
});
