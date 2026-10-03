// electron/llm/__tests__/networkProfile.test.mjs
//
// Unit tests for electron/llm/performance/networkProfile.ts — the local,
// non-identifying network label: interface-name classification per platform,
// subnet reduction, the hashed profile id, and the profile lookup ladder.
//
// The platform and the interface reader are injected, so both the macOS and the
// Windows branches run here on any OS. process.platform is never mutated.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/networkProfile.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const {
  OFFLINE_NETWORK_PROFILE,
  classifyInterfaceName,
  subnetOf,
  computeNetworkProfile,
  currentNetworkProfile,
  profileLookupChain,
  profileKey,
} = require(path.join(repoRoot, 'dist-electron', 'electron', 'llm', 'performance', 'networkProfile.js'));

const v4 = (address, mac = 'aa:bb:cc:dd:ee:01') => ({ address, mac, internal: false, family: 'IPv4' });
const compute = (platform, interfaces) => computeNetworkProfile({ platform, readInterfaces: () => interfaces });

describe('OFFLINE_NETWORK_PROFILE', () => {
  test('has the documented shape', () => {
    assert.deepEqual(OFFLINE_NETWORK_PROFILE, { id: 'offline', interfaceClass: 'other', offline: true });
  });
});

describe('classifyInterfaceName: darwin', () => {
  const cases = [
    ['lo0', 'loopback'],
    ['en0', 'wifi'],
    ['awdl0', 'wifi'],
    ['llw0', 'wifi'],
    ['en1', 'ethernet'],
    ['en7', 'ethernet'],
    ['bridge0', 'other'],
    ['ap1', 'other'],
    ['iPhone USB', 'cellular'],
    ['pdp_ip0', 'cellular'],
    ['utun3', 'other'],
    ['ipsec0', 'other'],
    ['gif0', 'other'],
    ['stf0', 'other'],
    ['something-else', 'other'],
    ['', 'other'],
  ];
  for (const [name, expected] of cases) {
    test(`${JSON.stringify(name)} -> ${expected}`, () => {
      assert.equal(classifyInterfaceName(name, 'darwin'), expected);
    });
  }

  test('matching is case-insensitive', () => {
    assert.equal(classifyInterfaceName('EN0', 'darwin'), 'wifi');
    assert.equal(classifyInterfaceName('LO0', 'darwin'), 'loopback');
  });

  test('Windows friendly names mean nothing on macOS', () => {
    assert.equal(classifyInterfaceName('Wi-Fi', 'darwin'), 'other');
  });
});

describe('classifyInterfaceName: win32', () => {
  const cases = [
    ['Wi-Fi', 'wifi'],
    ['WiFi 2', 'wifi'],
    ['Wireless Network Connection', 'wifi'],
    ['Ethernet', 'ethernet'],
    ['Ethernet 3', 'ethernet'],
    ['Local Area Connection* 12', 'ethernet'],
    ['Cellular', 'cellular'],
    ['Mobile Broadband Connection', 'cellular'],
    ['Loopback Pseudo-Interface 1', 'loopback'],
    ['Bluetooth Network Connection', 'other'],
    ['', 'other'],
  ];
  for (const [name, expected] of cases) {
    test(`${JSON.stringify(name)} -> ${expected}`, () => {
      assert.equal(classifyInterfaceName(name, 'win32'), expected);
    });
  }

  test('macOS names are not read by macOS rules on Windows', () => {
    // "lo0" must not be loopback here, and "en0" must not be wifi.
    assert.equal(classifyInterfaceName('lo0', 'win32'), 'other');
    assert.equal(classifyInterfaceName('en0', 'win32'), 'other');
  });
});

describe('classifyInterfaceName: other platforms', () => {
  test('an unknown platform degrades to "other" and never throws', () => {
    for (const name of ['lo', 'eth0', 'wlan0', 'en0', 'Wi-Fi', '']) {
      assert.equal(classifyInterfaceName(name, 'linux'), 'other', name);
      assert.equal(classifyInterfaceName(name, 'freebsd'), 'other', name);
    }
  });
});

describe('subnetOf', () => {
  test('IPv4 reduces to its /24, for string and numeric family', () => {
    assert.equal(subnetOf('192.168.1.42', 'IPv4'), '192.168.1.0/24');
    assert.equal(subnetOf('10.0.7.255', 4), '10.0.7.0/24');
  });

  test('a malformed IPv4 address is returned unchanged', () => {
    assert.equal(subnetOf('1.2.3', 'IPv4'), '1.2.3');
    assert.equal(subnetOf('', 'IPv4'), '');
  });

  test('IPv6 reduces to its /64, for string and numeric family', () => {
    assert.equal(subnetOf('2001:db8:aaaa:bbbb:1:2:3:4', 'IPv6'), '2001:db8:aaaa:bbbb::/64');
    assert.equal(subnetOf('fe80:0:0:1:a:b:c:d', 6), 'fe80:0:0:1::/64');
  });

  test('an IPv6 address with fewer than four groups is returned unchanged', () => {
    assert.equal(subnetOf('::1', 'IPv6'), '::1');
  });

  test('two hosts on one network share a subnet; different networks do not', () => {
    assert.equal(subnetOf('192.168.1.10', 'IPv4'), subnetOf('192.168.1.200', 'IPv4'));
    assert.notEqual(subnetOf('192.168.1.10', 'IPv4'), subnetOf('192.168.2.10', 'IPv4'));
  });
});

describe('computeNetworkProfile: offline cases', () => {
  test('a reader that throws yields the offline profile', () => {
    const p = computeNetworkProfile({ platform: 'darwin', readInterfaces: () => { throw new Error('EPERM'); } });
    assert.deepEqual(p, OFFLINE_NETWORK_PROFILE);
  });

  test('a reader returning null/undefined/{} yields offline', () => {
    for (const v of [null, undefined, {}]) assert.deepEqual(compute('win32', v), OFFLINE_NETWORK_PROFILE);
  });

  test('loopback-named, internal, address-less and empty entries are all skipped', () => {
    const p = compute('darwin', {
      lo0: [v4('127.0.0.1')],
      en0: [{ address: '192.168.1.5', mac: 'aa', internal: true, family: 'IPv4' }, { address: '', mac: 'aa', internal: false, family: 'IPv4' }, null],
      en1: undefined,
      en2: [],
    });
    assert.deepEqual(p, OFFLINE_NETWORK_PROFILE);
  });
});

describe('computeNetworkProfile: id', () => {
  test('is the first 12 hex of sha256 over "mac|subnet"', () => {
    const p = compute('darwin', { en0: [v4('192.168.1.42', 'aa:bb:cc:dd:ee:01')] });
    const expected = createHash('sha256').update('aa:bb:cc:dd:ee:01|192.168.1.0/24').digest('hex').slice(0, 12);
    assert.deepEqual(p, { id: expected, interfaceClass: 'wifi', offline: false });
  });

  test('is opaque: 12 lowercase hex chars carrying no raw address or MAC', () => {
    const p = compute('win32', { 'Wi-Fi': [v4('192.168.1.42', 'aa:bb:cc:dd:ee:01')] });
    assert.match(p.id, /^[0-9a-f]{12}$/);
    assert.ok(!JSON.stringify(p).includes('192.168'));
    assert.ok(!JSON.stringify(p).includes('aa:bb'));
  });

  test('a DHCP lease change on the same network keeps the id', () => {
    const a = compute('darwin', { en0: [v4('192.168.1.42')] });
    const b = compute('darwin', { en0: [v4('192.168.1.199')] });
    assert.equal(a.id, b.id);
  });

  test('a different subnet or a different MAC changes the id', () => {
    const home = compute('darwin', { en0: [v4('192.168.1.42')] });
    assert.notEqual(compute('darwin', { en0: [v4('172.20.10.3')] }).id, home.id);
    assert.notEqual(compute('darwin', { en0: [v4('192.168.1.42', '11:22:33:44:55:66')] }).id, home.id);
  });

  test('every candidate contributes: adding a second interface changes the id', () => {
    const one = compute('darwin', { en0: [v4('192.168.1.42')] });
    const two = compute('darwin', { en0: [v4('192.168.1.42')], utun3: [v4('10.8.0.2', '00:00:00:00:00:00')] });
    assert.notEqual(one.id, two.id);
  });

  test('does not depend on the order interfaces are enumerated in', () => {
    const wifi = [v4('192.168.1.42', 'aa:aa:aa:aa:aa:aa')];
    const eth = [v4('10.0.0.5', 'bb:bb:bb:bb:bb:bb')];
    assert.deepEqual(compute('darwin', { en0: wifi, en1: eth }), compute('darwin', { en1: eth, en0: wifi }));
  });

  test('a missing MAC and an IPv6 address are both handled', () => {
    const p = compute('darwin', { en0: [{ address: '2001:db8:aaaa:bbbb:1:2:3:4', internal: false, family: 'IPv6' }] });
    const expected = createHash('sha256').update('|2001:db8:aaaa:bbbb::/64').digest('hex').slice(0, 12);
    assert.deepEqual(p, { id: expected, interfaceClass: 'wifi', offline: false });
  });
});

describe('computeNetworkProfile: interface class', () => {
  test('ethernet outranks wifi, wifi outranks a VPN tunnel (darwin)', () => {
    assert.equal(compute('darwin', { en0: [v4('192.168.1.2')], en1: [v4('10.0.0.2')] }).interfaceClass, 'ethernet');
    assert.equal(compute('darwin', { utun3: [v4('10.8.0.2')], en0: [v4('192.168.1.2')] }).interfaceClass, 'wifi');
  });

  test('cellular outranks other (darwin)', () => {
    assert.equal(compute('darwin', { utun3: [v4('10.8.0.2')], pdp_ip0: [v4('100.64.0.2')] }).interfaceClass, 'cellular');
  });

  test('win32: a machine whose only adapter is "Local Area Connection* 12" is online ethernet', () => {
    const p = compute('win32', { 'Local Area Connection* 12': [v4('192.168.137.1')] });
    assert.equal(p.offline, false);
    assert.equal(p.interfaceClass, 'ethernet');
  });

  test('win32: Wi-Fi alone is wifi; the loopback pseudo-interface is ignored', () => {
    const p = compute('win32', {
      'Loopback Pseudo-Interface 1': [v4('127.0.0.1')],
      'Wi-Fi': [v4('192.168.1.7')],
    });
    assert.equal(p.interfaceClass, 'wifi');
    assert.equal(p.id, compute('win32', { 'Wi-Fi': [v4('192.168.1.7')] }).id);
  });

  test('an unknown platform still produces an online profile, classed "other"', () => {
    const p = compute('linux', { wlan0: [v4('192.168.1.7')] });
    assert.equal(p.offline, false);
    assert.equal(p.interfaceClass, 'other');
    assert.match(p.id, /^[0-9a-f]{12}$/);
  });

  test('the same addresses hash to the same id whatever the platform', () => {
    const ifs = (name) => ({ [name]: [v4('192.168.1.7')] });
    assert.equal(compute('darwin', ifs('en0')).id, compute('win32', ifs('Wi-Fi')).id);
  });
});

describe('currentNetworkProfile', () => {
  test('returns a well-formed profile on this machine without throwing', () => {
    // Values depend on the host, so only the contract is asserted.
    const p = currentNetworkProfile();
    assert.equal(typeof p.offline, 'boolean');
    assert.ok(['wifi', 'ethernet', 'cellular', 'loopback', 'other'].includes(p.interfaceClass));
    if (p.offline) assert.deepEqual(p, OFFLINE_NETWORK_PROFILE);
    else assert.match(p.id, /^[0-9a-f]{12}$/);
  });
});

describe('profileKey / profileLookupChain', () => {
  test('profileKey joins the three parts with "|"', () => {
    assert.equal(profileKey('openai', 'gpt-4o', 'abc123def456'), 'openai|gpt-4o|abc123def456');
  });

  test('the lookup chain goes most specific first, widening one tier at a time', () => {
    assert.deepEqual(profileLookupChain('openai', 'gpt-4o', 'abc123def456'), [
      'openai|gpt-4o|abc123def456',
      'openai|gpt-4o|*',
      'openai|*|*',
    ]);
  });

  test('the first rung of the chain is exactly the profile key', () => {
    assert.equal(profileLookupChain('groq', 'qwen/qwen3.8-27b', 'offline')[0], profileKey('groq', 'qwen/qwen3.8-27b', 'offline'));
  });
});
