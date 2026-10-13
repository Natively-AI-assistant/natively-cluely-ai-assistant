import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  LINUX_OPAQUE_WINDOW_BG,
  NET_WM_CM_ROOT_PROPS,
  KNOWN_COMPOSITOR_PROCESSES,
  resolveLinuxWindowChrome,
  xpropIndicatesWindow,
} = require('../../../dist-electron/electron/platform/x11Compositor.js');

describe('xpropIndicatesWindow', () => {
  test('detects EWMH window id format', () => {
    assert.equal(
      xpropIndicatesWindow('_NET_WM_CM_S0(WINDOW): window id # 0x400003'),
      true,
    );
  });

  test('detects bare hex window id', () => {
    assert.equal(xpropIndicatesWindow('0x400003'), true);
  });

  test('rejects empty or unrelated output', () => {
    assert.equal(xpropIndicatesWindow(''), false);
    assert.equal(xpropIndicatesWindow('_NET_WM_CM_S0:  not found'), false);
  });
});

describe('compositor detection constants', () => {
  test('includes S0 and S1 CM atoms', () => {
    assert.ok(NET_WM_CM_ROOT_PROPS.includes('_NET_WM_CM_S0'));
    assert.ok(NET_WM_CM_ROOT_PROPS.includes('_NET_WM_CM_S1'));
  });

  test('includes common compositor process names', () => {
    assert.ok(KNOWN_COMPOSITOR_PROCESSES.includes('picom'));
    assert.ok(KNOWN_COMPOSITOR_PROCESSES.includes('xfwm4'));
  });
});

describe('resolveLinuxWindowChrome', () => {
  test('launcher is always opaque', () => {
    const withCompositor = resolveLinuxWindowChrome('launcher', { isComposited: true, compositorName: null });
    const withoutCompositor = resolveLinuxWindowChrome('launcher', { isComposited: false, compositorName: null });

    assert.equal(withCompositor.transparent, false);
    assert.equal(withoutCompositor.transparent, false);
    assert.equal(withCompositor.backgroundColor, LINUX_OPAQUE_WINDOW_BG);
    assert.equal(withoutCompositor.backgroundColor, LINUX_OPAQUE_WINDOW_BG);
    assert.equal(withoutCompositor.useOpaqueFallback, true);
  });

  test('overlay stays transparent when compositor is available', () => {
    const chrome = resolveLinuxWindowChrome('overlay', { isComposited: true, compositorName: 'picom' });

    assert.equal(chrome.transparent, true);
    assert.equal(chrome.backgroundColor, '#00000000');
    assert.equal(chrome.useOpaqueFallback, false);
  });

  test('overlay uses opaque fallback when compositor is missing', () => {
    const chrome = resolveLinuxWindowChrome('overlay', { isComposited: false, compositorName: null });

    assert.equal(chrome.transparent, false);
    assert.equal(chrome.backgroundColor, LINUX_OPAQUE_WINDOW_BG);
    assert.equal(chrome.useOpaqueFallback, true);
  });
});
