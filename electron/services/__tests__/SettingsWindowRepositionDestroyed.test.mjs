// electron/services/__tests__/SettingsWindowRepositionDestroyed.test.mjs
//
// Regression: Spotlight / second-instance focus moves the launcher while the
// settings BrowserWindow is destroyed. Calling isVisible() before isDestroyed()
// throws TypeError "Object has been destroyed" and storms the main process
// (renderer UNRESPONSIVE / UI hang).
//
// Run: node --test electron/services/__tests__/SettingsWindowRepositionDestroyed.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire as createRequireFromPath } from 'module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// SettingsWindowHelper imports electron at module load — stub minimal surface
// before requiring the compiled (or ts-node) module. Prefer dist-electron.
const electronStub = {
  BrowserWindow: class {},
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  app: {
    getAppPath: () => ROOT,
    isPackaged: false,
    getPath: () => '/tmp',
  },
};

// Inject stub into require cache under both names electron may resolve as.
require.cache[require.resolve('electron')] = {
  id: require.resolve('electron'),
  filename: require.resolve('electron'),
  loaded: true,
  exports: electronStub,
};

// WindowHelper is a peer import — provide a tiny stub via cache if needed.
const distHelper = path.join(ROOT, 'dist-electron/electron/SettingsWindowHelper.js');
const srcHelper = path.join(ROOT, 'electron/SettingsWindowHelper.ts');
let SettingsWindowHelper;
try {
  ({ SettingsWindowHelper } = require(distHelper));
} catch {
  // Fall back: dynamic import won't work for TS without build. Force build path.
  throw new Error(
    `Missing ${distHelper} — run npm run build:electron first. Original: ${srcHelper}`,
  );
}

function makeDestroyedSettingsWindow() {
  // Mimic Electron: isDestroyed() can still return false briefly, OR more
  // commonly isVisible()/setPosition throw while isDestroyed() is already true.
  // The bug was calling isVisible() BEFORE isDestroyed().
  let destroyed = true;
  return {
    isDestroyed: () => destroyed,
    isVisible: () => {
      throw new TypeError('Object has been destroyed');
    },
    setPosition: () => {
      throw new TypeError('Object has been destroyed');
    },
  };
}

describe('SettingsWindowHelper.reposition — destroyed window', () => {
  it('does not throw when settings window is destroyed (isVisible would throw)', () => {
    const helper = new SettingsWindowHelper();
    helper.settingsWindow = makeDestroyedSettingsWindow();
    // offset fields are private; reposition only needs them if past the guard
    assert.doesNotThrow(() => {
      helper.reposition({ x: 10, y: 20, width: 100, height: 50 });
    });
  });

  it('does not throw when isDestroyed is false but isVisible/setPosition throw (race)', () => {
    const helper = new SettingsWindowHelper();
    helper.settingsWindow = {
      isDestroyed: () => false,
      isVisible: () => {
        throw new TypeError('Object has been destroyed');
      },
      setPosition: () => {
        throw new TypeError('Object has been destroyed');
      },
    };
    assert.doesNotThrow(() => {
      helper.reposition({ x: 10, y: 20, width: 100, height: 50 });
    });
  });
});
