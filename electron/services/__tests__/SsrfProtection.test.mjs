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
