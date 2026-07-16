const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const {
  isSafeExternalUrl,
  isTrustedRendererUrl,
} = require('../dist-electron/electron/utils/trustedRenderer.js');

test('packaged renderer trust is limited to the bundled index', () => {
  const appPath = path.join('/Applications', 'Natively.app', 'Contents', 'Resources', 'app.asar');
  const config = { appPath, isPackaged: true };
  const indexUrl = `${pathToFileURL(path.join(appPath, 'dist', 'index.html')).href}?window=launcher`;

  assert.equal(isTrustedRendererUrl(indexUrl, config), true);
  assert.equal(isTrustedRendererUrl('https://attacker.example/', config), false);
  assert.equal(isTrustedRendererUrl(pathToFileURL('/tmp/index.html').href, config), false);
});

test('development trust is limited to the local Vite origin', () => {
  const config = { appPath: '/tmp/app', isPackaged: false, devPort: 5180 };
  assert.equal(isTrustedRendererUrl('http://localhost:5180/?window=launcher', config), true);
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5180/', config), true);
  assert.equal(isTrustedRendererUrl('http://localhost:5173/', config), false);
  assert.equal(isTrustedRendererUrl('https://localhost:5180/', config), false);
});

test('only browser-safe external protocols are delegated to the OS', () => {
  assert.equal(isSafeExternalUrl('https://example.com'), true);
  assert.equal(isSafeExternalUrl('mailto:test@example.com'), true);
  assert.equal(isSafeExternalUrl('file:///tmp/private'), false);
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
});
