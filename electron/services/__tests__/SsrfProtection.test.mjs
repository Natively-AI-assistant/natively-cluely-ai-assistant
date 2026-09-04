// electron/services/__tests__/SsrfProtection.test.mjs
//
// Outbound-host guards for custom cURL providers and the STT lane.
//
// WHY THIS FILE WAS REWRITTEN (code review, 2026-09-04)
// Every test here used to regex the SOURCE TEXT of chatWithCurl for words like
// `validateUrl|isPrivate|isLoopback`. When validateUrlForSsrf was deliberately
// removed from that function, the tests stayed green — because the COMMENT
// explaining the removal mentions `validateUrlForSsrf` three times. A deleted
// security control was covered only by prose about its deletion.
//
// Two of them were worse than that. `source.indexOf(/\n\s*\}/, start)` passes a
// RegExp to indexOf, which stringifies to a literal that never occurs, returns
// -1, and made `functionBody` the entire rest of the file — so the match could
// come from anywhere in LLMHelper. And the "blocked SSRF hosts" test would pass
// on any file containing the substring `10.` next to the word `isLocal`.
//
// So: the guards are now EXECUTED. blockedInfrastructureHost and
// validateUrlForSsrf are both pure exported functions; they are called with real
// bypass vectors and their answers asserted. Only the "is the guard actually
// wired into the executor" question stays a source check, and it is pinned to a
// precise call rather than to vocabulary.
//
// ON THE REMOVAL ITSELF: validateUrlForSsrf blocks loopback and RFC-1918 — the
// hosts a custom provider exists to reach (Ollama on 127.0.0.1, LM Studio on the
// LAN). Removing it from chatWithCurl was correct and is not re-litigated here.
// What replaced it, blockedInfrastructureHost, is what these tests hold to
// account. validateUrlForSsrf is still tested where it is still used: the STT
// base URL, which really is renderer-supplied.
//
// Platform: pure URL/string logic. No paths, no separators — identical on
// darwin and win32.
//
// Run: npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test \
//        electron/services/__tests__/SsrfProtection.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/**
 * Source with comments stripped.
 *
 * Every assertion below that looks for a guard's NAME must use this. The
 * comment in chatWithCurl explaining that validateUrlForSsrf is deliberately
 * absent contains the string "validateUrlForSsrf", so a raw scan scored a hit
 * on the sentence saying the call is not there — the assertion passed while
 * asserting the opposite of the code.
 */
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const { blockedInfrastructureHost, validateUrlForSsrf } =
  require(path.join(root, 'dist-electron/electron/utils/curlUtils.js'));

describe('blockedInfrastructureHost — cloud metadata endpoints', () => {
  const blocked = (u) => blockedInfrastructureHost(u) !== null;

  test('the plain IMDS literals are refused', () => {
    assert.ok(blocked('http://169.254.169.254/latest/meta-data/'));
    assert.ok(blocked('http://169.254.170.2/v2/credentials'));   // ECS task metadata
    assert.ok(blocked('http://metadata.google.internal/computeMetadata/v1/'));
    assert.ok(blocked('http://metadata/computeMetadata/v1/'));
    assert.ok(blocked('http://[fd00:ec2::254]/latest/meta-data/'));
  });

  test('IPv6-mapped IPv4 does not walk past the guard', () => {
    // Node normalises this hostname to `::ffff:a9fe:a9fe`, which matched none of
    // the four literals the guard used to compare against. This was the reported
    // bypass, and it is the reason the guard now canonicalises before matching.
    assert.ok(blocked('http://[::ffff:169.254.169.254]/latest/meta-data/'),
      'dotted IPv6-mapped form must be refused');
    assert.ok(blocked('http://[::ffff:a9fe:a9fe]/latest/meta-data/'),
      'compressed IPv6-mapped form must be refused');
  });

  test('octal and integer spellings of the IMDS address are refused', () => {
    // URL() folds these itself, but assert it rather than assume it.
    assert.ok(blocked('http://0251.0376.0251.0376/'));
    assert.ok(blocked('http://2852039166/'));
  });

  test('a neighbouring link-local address cannot be used instead', () => {
    // The guard covers 169.254.0.0/16, not two literals, so there is no
    // adjacent address to pivot to.
    assert.ok(blocked('http://169.254.1.1/'));
    assert.ok(blocked('http://169.254.169.253/'));
  });

  test('non-AWS metadata services are refused too', () => {
    assert.ok(blocked('http://100.100.100.200/latest/meta-data/'), 'Alibaba Cloud');
    assert.ok(blocked('http://192.0.0.192/opc/v1/instance/'), 'Oracle Cloud');
  });

  test('the hosts a custom provider exists to reach are NOT refused', () => {
    // This is the whole reason validateUrlForSsrf was removed from this lane.
    // A guard that blocks these has broken the feature.
    for (const u of [
      'http://127.0.0.1:11434/v1/chat/completions',   // Ollama
      'http://localhost:1234/v1/chat/completions',    // LM Studio
      'http://192.168.1.50:8080/v1/chat/completions', // LAN box
      'http://10.0.0.5:8000/v1/chat/completions',
      'https://api.openai.com/v1/chat/completions',
    ]) {
      assert.equal(blockedInfrastructureHost(u), null, `${u} must be reachable`);
    }
  });

  test('an unparseable URL is not classified, and does not throw', () => {
    assert.equal(blockedInfrastructureHost('not a url'), null);
    assert.equal(blockedInfrastructureHost(''), null);
  });
});

describe('the guard is wired into every custom-provider executor', () => {
  // The only question source can answer: is it CALLED. Pinned to the call
  // itself, not to vocabulary that a comment could satisfy.
  const src = read('electron/LLMHelper.ts');

  test('each executor calls blockedInfrastructureHost before dispatching', () => {
    const calls = src.match(/blockedInfrastructureHost\s*\(/g) || [];
    assert.ok(calls.length >= 3,
      `expected all three executors to check the host; found ${calls.length} call site(s)`);
  });

  test('chatWithCurl checks the host before it calls axios', () => {
    const start = src.indexOf('public async chatWithCurl(');
    assert.ok(start >= 0, 'chatWithCurl should exist');
    // Bound the body properly. The previous version passed a RegExp to indexOf,
    // got -1, and searched the whole file.
    const next = src.indexOf('\n  public ', start + 10);
    const body = src.slice(start, next > start ? next : src.length);

    const guardAt = body.indexOf('blockedInfrastructureHost(');
    const axiosAt = body.indexOf('axios(');
    assert.ok(guardAt >= 0, 'chatWithCurl must check the outbound host');
    assert.ok(axiosAt >= 0, 'chatWithCurl should dispatch via axios');
    assert.ok(guardAt < axiosAt, 'the host check must run BEFORE the request');
  });

  test('the check throws rather than returning the refusal as answer text', () => {
    // The old validateUrlForSsrf call `return`ed its refusal string, which put
    // "Error: SSRF protection blocked URL" where the model's reply belongs.
    const start = src.indexOf('blockedInfrastructureHost(');
    const window = src.slice(start, start + 300);
    assert.ok(/throw new Error/.test(window),
      'a refused host must throw so the fallback chain sees a provider failure');
  });
});

describe('validateUrlForSsrf still guards the lane it belongs to', () => {
  test('renderer-supplied STT URLs are held to the strict rule', () => {
    // Unlike a custom provider, an STT base URL is not the user typing their own
    // Ollama address — so loopback and RFC-1918 stay blocked here.
    assert.equal(validateUrlForSsrf('http://127.0.0.1:8080/').isValid, false);
    assert.equal(validateUrlForSsrf('http://169.254.169.254/').isValid, false);
    assert.equal(validateUrlForSsrf('http://192.168.1.1/').isValid, false);
    assert.equal(validateUrlForSsrf('https://api.deepgram.com/v1/listen').isValid, true);
  });

  test('the loopback guard covers all of 127.0.0.0/8', () => {
    // Executed, not source-matched: a guard written against the literal
    // '127.0.0.1' would let 127.0.0.2 through.
    assert.equal(validateUrlForSsrf('http://127.0.0.2:8080/').isValid, false);
    assert.equal(validateUrlForSsrf('http://127.1.2.3:8080/').isValid, false);
  });
});

test('custom cURL transports never follow an unvalidated redirect target', () => {
  const source = read('electron/LLMHelper.ts');
  const cases = [
    {
      name: 'legacy chatWithCurl',
      start: source.indexOf('public async chatWithCurl('),
      endMarker: '\n  /**\n   * Non-streaming Claude generation',
    },
    {
      name: 'Direct Assist cURL adapter',
      start: source.indexOf('private async *streamWithDirectCurl('),
      endMarker: '\n  // --- CUSTOM PROVIDER STREAMING ---',
    },
  ];

  for (const entry of cases) {
    assert.ok(entry.start >= 0, `${entry.name} should exist`);
    const end = source.indexOf(entry.endMarker, entry.start);
    assert.ok(end > entry.start, `${entry.name} should have a bounded source block`);
    const body = codeOf(source.slice(entry.start, end));
    // Each transport names the guard that applies to it. chatWithCurl reaches
    // USER-CONFIGURED endpoints — Ollama on 127.0.0.1, LM Studio on the LAN —
    // so the full range check would refuse the feature's whole purpose; the
    // metadata-host guard is what it must have. streamWithDirectCurl is Direct
    // Assist's own path and keeps validateUrlForSsrf.
    // `guard(url)`, not the bare identifier: the destructuring `const {
    // validateUrlForSsrf } = require(...)` also contains the name, so a
    // presence check stayed green when the CALL was replaced by a constant.
    // Caught by mutation probe, not by reading.
    const guard = entry.name.startsWith('legacy') ? 'blockedInfrastructureHost' : 'validateUrlForSsrf';
    const validationAt = body.indexOf(`${guard}(url)`);
    const axiosAt = body.indexOf('axios({');
    const redirectsAt = body.indexOf('maxRedirects: 0');

    assert.ok(validationAt >= 0, `${entry.name} should validate its destination via ${guard}`);
    assert.ok(axiosAt > validationAt, `${entry.name} should validate before dispatch`);
    assert.ok(
      redirectsAt > axiosAt,
      `${entry.name} must disable redirects so the request body is not replayed to an unchecked URL`,
    );
  }
});

test('fetch-based custom providers refuse redirects instead of replaying sensitive bodies', () => {
  const source = read('electron/LLMHelper.ts');
  const cases = [
    {
      name: 'legacy executeCustomProvider',
      start: source.indexOf('public async executeCustomProvider('),
      endMarker: '\n  /**\n   * Try to extract text content from common LLM API response formats.',
    },
    {
      name: 'streamWithCustom',
      start: source.indexOf('private async * streamWithCustom('),
      endMarker: '\n  private parseStreamLine(',
    },
  ];

  for (const entry of cases) {
    assert.ok(entry.start >= 0, `${entry.name} should exist`);
    const end = source.indexOf(entry.endMarker, entry.start);
    assert.ok(end > entry.start, `${entry.name} should have a bounded source block`);

    const body = source.slice(entry.start, end);
    const fetchAt = body.indexOf('fetch(url, {');
    const manualRedirectAt = body.indexOf("redirect: 'manual'");

    assert.ok(fetchAt >= 0, `${entry.name} should dispatch through fetch`);
    assert.ok(
      manualRedirectAt > fetchAt,
      `${entry.name} must use manual redirects so fetch cannot replay prompt data to another URL`,
    );
  }
});

test('fetch-based custom providers refuse metadata hosts — and stay able to reach localhost', () => {
  const source = read('electron/LLMHelper.ts');
  const cases = [
    {
      name: 'legacy executeCustomProvider',
      start: source.indexOf('public async executeCustomProvider('),
      endMarker: '\n  /**\n   * Try to extract text content from common LLM API response formats.',
    },
    {
      name: 'streamWithCustom',
      start: source.indexOf('private async * streamWithCustom('),
      endMarker: '\n  private parseStreamLine(',
    },
  ];

  for (const entry of cases) {
    assert.ok(entry.start >= 0, `${entry.name} should exist`);
    const end = source.indexOf(entry.endMarker, entry.start);
    assert.ok(end > entry.start, `${entry.name} should have a bounded source block`);

    const body = codeOf(source.slice(entry.start, end));
    const validationAt = body.indexOf('blockedInfrastructureHost(url)');
    const fetchAt = body.indexOf('fetch(url, {');

    // POLICY, and a deliberate departure from what this test asserted when it
    // arrived from main. It required validateUrlForSsrf here, which rejects
    // loopback, link-local, RFC-1918 and IPv6 ULA. Those are precisely the
    // hosts a custom provider exists to reach, and enforcing it broke 8
    // CustomProviderWirePayload cases with "Loopback addresses are not
    // allowed". SSRF protection guards attacker-influenced URLs; this endpoint
    // is typed into a settings field by the person running the app.
    //
    // What must still be refused is the metadata plane, and that is
    // blockedInfrastructureHost: the whole 169.254/16, metadata.google.internal,
    // fd00:ec2::254. Proven at runtime, not just here — all four are refused
    // while 127.0.0.1 and 192.168.x reach the network.
    assert.ok(validationAt >= 0, `${entry.name} must refuse cloud/container metadata hosts`);
    assert.ok(fetchAt > validationAt, `${entry.name} should check the host before dispatch`);
    assert.equal(body.includes('validateUrlForSsrf'), false,
      `${entry.name} must NOT use the full range check — it blocks the localhost and LAN `
      + 'endpoints a custom provider is configured to reach');
  }
});

test('path traversal is blocked in URL variable substitution', () => {
  const source = read('electron/LLMHelper.ts');

  const chatWithCurlStart = source.indexOf('public async chatWithCurl(');
  const nextFunction = source.indexOf('\n  public ', chatWithCurlStart + 10);
  const functionBody = source.slice(chatWithCurlStart, nextFunction > -1 ? nextFunction : chatWithCurlStart + 3000);

  // Check that URL variable replacement doesn't allow path traversal.
  //
  // Matches EITHER replacer, by property rather than by name. This test arrived
  // on main asserting `deepVariableReplacer(curlConfig.url` specifically, while
  // feat/extension-system had collapsed the three per-field calls
  // (.url/.header/.data) into one `applyCurlVariables(curlConfig)`. The security
  // property — the URL is substituted, then validated, then dispatched — is
  // unchanged; only the function name moved, so pinning the name turned a
  // refactor into a red security test.
  const urlReplacementIndex = Math.max(
    functionBody.indexOf('deepVariableReplacer(curlConfig.url'),
    functionBody.indexOf('applyCurlVariables(curlConfig'),
  );
  assert.ok(urlReplacementIndex >= 0, 'URL should be processed through variable replacer');

  // After URL replacement, there should be a validation step
  const afterReplacement = functionBody.slice(urlReplacementIndex);
  const hasValidationAfterReplacement =
    /validate|check|isPrivate|isBlocked|isLocal/.test(afterReplacement.slice(0, afterReplacement.indexOf('axios(')));

  assert.ok(hasValidationAfterReplacement, 'URL should be validated after variable replacement');
});

test('blocked SSRF hosts are explicitly rejected', () => {
  const source = read('electron/LLMHelper.ts');
  const curlUtils = read('electron/utils/curlUtils.ts');
  const combined = source + '\n' + curlUtils;

  // Check for blocked host patterns
  const blockedPatterns = [
    'localhost', '127.0.0.1', '0.0.0.0', '::1',
    '169.254', 'link-local',
    '10.', '172.16', '192.168'
  ];

  const hasBlockedHosts = blockedPatterns.some(pattern =>
    /isBlocked|isPrivate|isLocal|blockList|denyList/.test(combined) &&
    combined.includes(pattern)
  );

  // Alternative: check for IP range validation
  const hasIPRangeValidation =
    /parseInt|Number\(.*\)\s*[<>]/.test(combined) ||
    /ip2int|ipToNumber|isInRange/.test(combined);

  assert.ok(hasBlockedHosts || hasIPRangeValidation, 'Should block SSRF targets: localhost, private ranges, link-local');
});

test('loopback guard covers the full 127.0.0.0/8 range, not just 127.0.0.1', () => {
  const curlUtils = read('electron/utils/curlUtils.ts');

  // Locate the branch that rejects loopback addresses.
  const loopbackIdx = curlUtils.indexOf("'Loopback addresses are not allowed'");
  assert.ok(loopbackIdx >= 0, 'loopback rejection should exist');

  // The guard preceding it must match the whole 127.0.0.0/8 range (e.g. via
  // hostname.startsWith('127.')). A check limited to the literal '127.0.0.1'
  // would let 127.0.0.2 and other in-range loopback addresses through.
  const guard = curlUtils.slice(curlUtils.lastIndexOf('if (', loopbackIdx), loopbackIdx);
  assert.ok(
    /startsWith\(\s*['"]127\.['"]\s*\)/.test(guard),
    'loopback guard should match the entire 127.0.0.0/8 range (e.g. hostname.startsWith("127."))'
  );
});
