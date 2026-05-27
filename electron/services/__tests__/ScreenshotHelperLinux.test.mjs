import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const platformDir = path.resolve(__dirname, '../../../dist-electron/electron/platform');
const screenshotPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/ScreenshotHelper.js',
);

async function loadLinuxScreenshot() {
  return import(pathToFileURL(path.join(platformDir, 'linuxScreenshot.js')).href);
}

async function loadScreenshotHelper() {
  return import(pathToFileURL(screenshotPath).href);
}

describe('Linux screenshot path guard', () => {
  test('allows paths under userData', async () => {
    const { assertScreenshotPathWithinUserData } = await loadLinuxScreenshot();
    const userData = '/home/user/.config/Natively';
    const output = `${userData}/screenshots/abc.png`;
    assert.doesNotThrow(() => assertScreenshotPathWithinUserData(output, userData));
  });

  test('rejects paths outside userData (AC-S4)', async () => {
    const { assertScreenshotPathWithinUserData } = await loadLinuxScreenshot();
    const userData = '/home/user/.config/Natively';
    assert.throws(
      () => assertScreenshotPathWithinUserData('/tmp/evil.png', userData),
      /Refusing shell command for path outside userData/,
    );
  });

  test('rejects prefix tricks that do not start with userData', async () => {
    const { assertScreenshotPathWithinUserData } = await loadLinuxScreenshot();
    const userData = '/home/user/.config/Natively';
    assert.throws(() =>
      assertScreenshotPathWithinUserData('/home/user/.config/Natively-evil/x.png', userData),
    );
  });

  test('rejects empty output path (negative)', async () => {
    const { assertScreenshotPathWithinUserData } = await loadLinuxScreenshot();
    const userData = '/home/user/.config/Natively';
    assert.throws(() => assertScreenshotPathWithinUserData('', userData));
  });

  test('rejects relative path outside userData (negative)', async () => {
    const { assertScreenshotPathWithinUserData } = await loadLinuxScreenshot();
    const userData = '/home/user/.config/Natively';
    assert.throws(() => assertScreenshotPathWithinUserData('../outside.png', userData));
  });
});

describe('Linux screenshot install hint', () => {
  test('install hint mentions apt install scrot (AC-S3)', async () => {
    const { LINUX_SCREENSHOT_INSTALL_HINT } = await loadLinuxScreenshot();
    assert.match(LINUX_SCREENSHOT_INSTALL_HINT, /apt install scrot/);
    assert.match(LINUX_SCREENSHOT_INSTALL_HINT, /gnome-screenshot|imagemagick/);
  });
});

describe('ScreenshotHelper.detectLinuxScreenshotTool', () => {
  test('returns null on non-linux platforms', async () => {
    if (process.platform === 'linux') return;
    const { ScreenshotHelper } = await loadScreenshotHelper();
    assert.equal(ScreenshotHelper.detectLinuxScreenshotTool(), null);
  });

  test('returns a known tool name or null on linux', async () => {
    if (process.platform !== 'linux') return;
    const { ScreenshotHelper } = await loadScreenshotHelper();
    const tool = ScreenshotHelper.detectLinuxScreenshotTool();
    if (tool !== null) {
      assert.ok(['gnome-screenshot', 'scrot', 'import'].includes(tool));
    }
  });
});
