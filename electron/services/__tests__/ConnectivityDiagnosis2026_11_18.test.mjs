// Why can't this install reach Natively? (2026-11-18, #759)
//
// A key is pasted and Pro never activates. The log says "fetch failed" and the
// customer cannot tell us more, because nothing on their side can: a stale
// Windows certificate store, antivirus HTTPS scanning, a proxy-only network, a
// wrong clock, DNS and a blocked host all end as the same sentence. This is the
// test the app runs by itself when a key save or the Pro check fails with a
// network error: seven small checks, one verdict, and a report that carries
// nothing but enum values and counts (the funnel catalogue has no free string).
//
// The orchestration is pure — every probe is injected — so macOS and Windows run
// the same cases; nothing here touches an OS API or the network.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseConnection, classifyIssuer, TLS_CODES } from '../connectivityDiagnosis.ts';
import { checkFunnelProps } from '../../../src/lib/funnel/funnelCatalog.mjs';

const HOST = 'api.natively.software';
const NOW = 1_800_000_000_000;

/** A healthy world; each test breaks the parts it is about. */
function probes(over = {}) {
  return {
    dns: async () => ({ ok: true }),
    tls: async (_host, list) => ({ ok: true, ...(over[`tls_${list}`] ?? {}) }),
    http: async () => ({ status: 401 }),
    control: async () => ({ ok: true, serverTime: NOW }),
    proxy: async () => 'none',
    certStats: () => ({ merged: 22, dropped: 19 }),
    now: () => NOW,
    ...Object.fromEntries(Object.entries(over).filter(([k]) => !k.startsWith('tls_'))),
  };
}

describe('verdicts', () => {
  test('the built-in list works and the merged one does not → stale store, and the app can heal itself', async () => {
    const d = await diagnoseConnection(probes({ tls_merged: { ok: false, code: 'CERT_HAS_EXPIRED' } }), HOST, { reason: 'key_saved' });
    assert.equal(d.verdict, 'stale_store');
    assert.equal(d.heal, 'drop_system_ca');
    assert.equal(d.report.tls_builtin, 'ok');
    assert.equal(d.report.tls_merged, 'cert_has_expired');
    assert.equal(d.report.certs_merged, 22);
  });

  test('both lists fail on a certificate the antivirus signed → interception, named from a fixed list', async () => {
    const fail = { ok: false, code: 'SELF_SIGNED_CERT_IN_CHAIN', issuer: 'Kaspersky Anti-Virus Personal Root Certificate' };
    const d = await diagnoseConnection(probes({ tls_builtin: fail, tls_merged: fail }), HOST, { reason: 'pro_check' });
    assert.equal(d.verdict, 'interception');
    assert.equal(d.report.interceptor, 'kaspersky');
    assert.equal(d.heal, undefined);
  });

  test('an interceptor that is not on the list is "other", never a free string', async () => {
    const fail = { ok: false, code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', issuer: 'Acme Corp Internal Root' };
    const d = await diagnoseConnection(probes({ tls_builtin: fail, tls_merged: fail }), HOST, { reason: 'key_saved' });
    assert.equal(d.verdict, 'interception');
    assert.equal(d.report.interceptor, 'other');
  });

  test('certificates look expired or not yet valid and the PC clock is hours off → clock, not antivirus', async () => {
    const fail = { ok: false, code: 'CERT_NOT_YET_VALID', issuer: "Let's Encrypt YE1" };
    const d = await diagnoseConnection(probes({
      tls_builtin: fail, tls_merged: fail,
      control: async () => ({ ok: true, serverTime: NOW + 3 * 3_600_000 }), // the world is 3 h ahead of this PC
    }), HOST, { reason: 'key_saved' });
    assert.equal(d.verdict, 'clock');
    assert.equal(d.report.clock_skew_min, 180);
  });

  test('connection refused with a system proxy set and other sites reachable → proxy', async () => {
    const fail = { ok: false, code: 'ECONNREFUSED' };
    const d = await diagnoseConnection(probes({ tls_builtin: fail, tls_merged: fail, proxy: async () => 'system' }), HOST, { reason: 'key_saved' });
    assert.equal(d.verdict, 'proxy');
    assert.equal(d.report.proxy, 'system');
  });

  test('a proxy-only network: the direct control probe fails too, and it is still the proxy, not "offline"', async () => {
    const fail = { ok: false, code: 'ETIMEDOUT' };
    const d = await diagnoseConnection(probes({ tls_builtin: fail, tls_merged: fail, proxy: async () => 'system', control: async () => ({ ok: false }), dns: async () => ({ ok: false, code: 'ENOTFOUND' }) }), HOST, { reason: 'key_saved' });
    assert.equal(d.verdict, 'proxy');
  });

  test('the connection works with the OS certificates and fails without them (antivirus root only the OS trusts) → reachable, the interceptor still recorded, never "turn off your antivirus"', async () => {
    const d = await diagnoseConnection(probes({ tls_builtin: { ok: false, code: 'SELF_SIGNED_CERT_IN_CHAIN', issuer: 'Kaspersky Anti-Virus Personal Root Certificate' } }), HOST, { reason: 'pro_check' });
    assert.equal(d.verdict, 'reachable');
    assert.equal(d.report.interceptor, 'kaspersky');
    assert.equal(d.heal, undefined);
  });

  test('a certificate failure is a certificate failure even when the control sites cannot be reached (they were skipped)', async () => {
    const fail = { ok: false, code: 'SELF_SIGNED_CERT_IN_CHAIN', issuer: 'Zscaler Root CA' };
    const d = await diagnoseConnection(probes({ tls_builtin: fail, tls_merged: fail, control: async () => ({ ok: false, unknown: true }) }), HOST, { reason: 'key_saved' });
    assert.equal(d.verdict, 'interception');
    assert.equal(d.report.control_ok, undefined, 'unknown is not reported as false');
  });

  test('control checks skipped (Usage statistics off): never "offline", never "other sites load"', async () => {
    const fail = { ok: false, code: 'ETIMEDOUT' };
    const d = await diagnoseConnection(probes({ tls_builtin: fail, tls_merged: fail, control: async () => ({ ok: false, unknown: true }) }), HOST, { reason: 'key_saved' });
    assert.equal(d.verdict, 'blocked');
    assert.doesNotMatch(d.userMessage, /other sites load/i);
  });

  test('connection times out with no proxy while other sites load → our host is blocked', async () => {
    const fail = { ok: false, code: 'ETIMEDOUT' };
    const d = await diagnoseConnection(probes({ tls_builtin: fail, tls_merged: fail }), HOST, { reason: 'key_saved' });
    assert.equal(d.verdict, 'blocked');
  });

  test('our name does not resolve but other sites load → dns', async () => {
    const d = await diagnoseConnection(probes({ dns: async () => ({ ok: false, code: 'ENOTFOUND' }), tls_builtin: { ok: false, code: 'ENOTFOUND' }, tls_merged: { ok: false, code: 'ENOTFOUND' } }), HOST, { reason: 'key_saved' });
    assert.equal(d.verdict, 'dns');
    assert.equal(d.report.dns, 'enotfound');
  });

  test('nothing loads at all → offline', async () => {
    const d = await diagnoseConnection(probes({
      dns: async () => ({ ok: false, code: 'EAI_AGAIN' }), control: async () => ({ ok: false }),
      tls_builtin: { ok: false, code: 'ENOTFOUND' }, tls_merged: { ok: false, code: 'ENOTFOUND' },
    }), HOST, { reason: 'pro_check' });
    assert.equal(d.verdict, 'offline');
  });

  test('everything works → reachable: the trouble is not the network, and nothing is healed', async () => {
    const d = await diagnoseConnection(probes(), HOST, { reason: 'key_saved' });
    assert.equal(d.verdict, 'reachable');
    assert.equal(d.heal, undefined);
    assert.equal(d.report.http, '401');
  });
});

describe('robustness', () => {
  test('a probe that throws or never answers cannot stop the diagnosis', async () => {
    const d = await diagnoseConnection(probes({
      dns: async () => { throw new Error('boom'); },
      http: () => new Promise(() => {}),
      control: () => new Promise(() => {}),
    }), HOST, { reason: 'key_saved', timeoutMs: 25 });
    assert.ok(d.verdict);
    assert.equal(d.report.dns, 'other');
    assert.equal(d.report.http, 'none');
  });

  test('every report the app can produce passes the funnel catalogue', async () => {
    const worlds = [
      probes({ tls_merged: { ok: false, code: 'CERT_HAS_EXPIRED' } }),
      probes({ tls_builtin: { ok: false, code: 'SELF_SIGNED_CERT_IN_CHAIN', issuer: 'ESET SSL Filter CA' }, tls_merged: { ok: false, code: 'SELF_SIGNED_CERT_IN_CHAIN' } }),
      probes({ dns: async () => ({ ok: false, code: 'SOMETHING_ELSE' }), tls_builtin: { ok: false, code: 'WEIRD' }, tls_merged: { ok: false, code: 'WEIRD' }, control: async () => ({ ok: false }) }),
    ];
    for (const w of worlds) {
      for (const reason of ['key_saved', 'pro_check']) {
        const d = await diagnoseConnection(w, HOST, { reason });
        const checked = checkFunnelProps('connect_diag', d.report);
        assert.equal(checked.ok, true, `${JSON.stringify(d.report)} -> ${checked.error}`);
      }
    }
  });

  test('every code the app can name is in the catalogue (an unknown code becomes "other", it is never dropped)', () => {
    for (const code of TLS_CODES) {
      assert.equal(checkFunnelProps('connect_diag', { tls_builtin: code }).ok, true, code);
    }
  });

  test('nothing in the report or the message carries the host, a key or an address', async () => {
    const d = await diagnoseConnection(probes({ tls_merged: { ok: false, code: 'CERT_HAS_EXPIRED' } }), HOST, { reason: 'key_saved' });
    const text = JSON.stringify(d);
    assert.doesNotMatch(text, /natively_sk_|api\.natively|\d+\.\d+\.\d+\.\d+/);
  });

  test('the message says what to do for each verdict', async () => {
    const seen = new Set();
    const cases = [
      probes({ tls_merged: { ok: false, code: 'CERT_HAS_EXPIRED' } }),
      probes({ tls_builtin: { ok: false, code: 'SELF_SIGNED_CERT_IN_CHAIN', issuer: 'Zscaler Root CA' }, tls_merged: { ok: false, code: 'SELF_SIGNED_CERT_IN_CHAIN' } }),
      probes({ tls_builtin: { ok: false, code: 'ECONNREFUSED' }, tls_merged: { ok: false, code: 'ECONNREFUSED' }, proxy: async () => 'system' }),
      probes({ tls_builtin: { ok: false, code: 'ETIMEDOUT' }, tls_merged: { ok: false, code: 'ETIMEDOUT' } }),
      probes({ control: async () => ({ ok: false }), dns: async () => ({ ok: false, code: 'EAI_AGAIN' }), tls_builtin: { ok: false, code: 'ENOTFOUND' }, tls_merged: { ok: false, code: 'ENOTFOUND' } }),
    ];
    for (const w of cases) {
      const d = await diagnoseConnection(w, HOST, { reason: 'key_saved' });
      assert.ok(typeof d.userMessage === 'string' && d.userMessage.length > 20, d.verdict);
      seen.add(d.userMessage);
    }
    assert.equal(seen.size, cases.length, 'each verdict gets its own message');
  });
});

describe('classifyIssuer', () => {
  test('our own chain is "none"', () => {
    for (const cn of ["Let's Encrypt YE1", 'ISRG Root X1', 'R11']) assert.equal(classifyIssuer(cn), 'none', cn);
  });
  test('the products people run map to a fixed name', () => {
    assert.equal(classifyIssuer('Kaspersky Anti-Virus Personal Root Certificate'), 'kaspersky');
    assert.equal(classifyIssuer('ESET SSL Filter CA'), 'eset');
    assert.equal(classifyIssuer('Avast trusted CA'), 'avast');
    assert.equal(classifyIssuer('Bitdefender Personal CA.Net-Defender'), 'bitdefender');
    assert.equal(classifyIssuer('Zscaler Root CA'), 'zscaler');
    assert.equal(classifyIssuer('Netskope CA'), 'netskope');
    assert.equal(classifyIssuer('Fortinet CA'), 'fortinet');
    assert.equal(classifyIssuer('Sophos SSL CA'), 'sophos');
  });
  test('anything else, and anything missing, is not echoed', () => {
    assert.equal(classifyIssuer('Acme Corp Internal Root'), 'other');
    assert.equal(classifyIssuer(undefined), 'none');
    assert.equal(classifyIssuer(''), 'none');
  });
});
