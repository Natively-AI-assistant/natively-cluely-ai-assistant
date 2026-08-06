import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  isHotspotUsbAddress,
  isInternetSharingBridgeAddress,
  findUsbInterviewHosts,
  pickSuggestedHost,
  buildReport,
  PAIRING_USB_HOST_HINT,
  DEFAULT_PORT,
} = require('../lib/iosUsbInterviewHost.js');

describe('iosUsbInterviewHost', () => {
  it('recognizes Personal Hotspot USB client addresses', () => {
    assert.equal(isHotspotUsbAddress('172.20.10.2'), true);
    assert.equal(isHotspotUsbAddress('172.20.10.1'), true);
    assert.equal(isHotspotUsbAddress('172.20.10.15'), false);
    assert.equal(isHotspotUsbAddress('192.168.1.10'), false);
  });

  it('recognizes common Internet Sharing bridge prefixes', () => {
    assert.equal(isInternetSharingBridgeAddress('192.168.2.1'), true);
    assert.equal(isInternetSharingBridgeAddress('10.0.0.1'), false);
  });

  it('prefers personal-hotspot over internet-sharing', () => {
    const candidates = findUsbInterviewHosts({
      en0: [{ address: '192.168.1.20', family: 'IPv4', internal: false }],
      bridge100: [{ address: '192.168.2.1', family: 'IPv4', internal: false }],
      en7: [{ address: '172.20.10.2', family: 'IPv4', internal: false }],
    });
    assert.equal(pickSuggestedHost(candidates), '172.20.10.2');
    assert.equal(candidates[0].kind, 'personal-hotspot');
  });

  it('ignores VM-style bridge addresses that are not Internet Sharing', () => {
    const candidates = findUsbInterviewHosts({
      bridge100: [{ address: '192.168.64.1', family: 'IPv4', internal: false }],
      en0: [{ address: '192.168.1.20', family: 'IPv4', internal: false }],
    });
    assert.equal(candidates.length, 0);
  });

  it('accepts Internet Sharing bridge 192.168.2.1', () => {
    const candidates = findUsbInterviewHosts({
      bridge100: [{ address: '192.168.2.1', family: 'IPv4', internal: false }],
    });
    assert.equal(pickSuggestedHost(candidates), '192.168.2.1');
    assert.equal(candidates[0].kind, 'internet-sharing');
  });

  it('buildReport on darwin with no tether explains next step', () => {
    const report = buildReport({
      platform: 'darwin',
      candidates: [],
      port: 4123,
    });
    assert.equal(report.supported, true);
    assert.equal(report.suggestedHost, null);
    assert.equal(report.hostHint, PAIRING_USB_HOST_HINT);
    assert.match(report.message, /No USB\/tether/i);
  });

  it('buildReport on win32 documents the gap without inventing a host', () => {
    const report = buildReport({
      platform: 'win32',
      candidates: [{ iface: 'Ethernet', address: '172.20.10.2', kind: 'personal-hotspot' }],
      port: DEFAULT_PORT,
    });
    assert.equal(report.supported, false);
    assert.equal(report.windowsGap, true);
    assert.equal(report.suggestedHost, null);
    assert.match(report.message, /Windows/i);
  });

  it('buildReport returns suggested host on darwin', () => {
    const report = buildReport({
      platform: 'darwin',
      candidates: [{ iface: 'en7', address: '172.20.10.2', kind: 'personal-hotspot' }],
      port: 4123,
    });
    assert.equal(report.suggestedHost, '172.20.10.2');
    assert.equal(report.port, 4123);
    assert.equal(report.windowsGap, false);
  });
});
