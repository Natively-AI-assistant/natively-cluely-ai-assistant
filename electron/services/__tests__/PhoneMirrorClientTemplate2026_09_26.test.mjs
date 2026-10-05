// electron/services/__tests__/PhoneMirrorClientTemplate2026_09_26.test.mjs
//
// The phone mirror page is one HTML string inside a TypeScript template
// literal (electron/services/phoneMirrorClient.ts), served by
// PhoneMirrorService. Nothing type-checks its script, so these pin what breaks
// silently:
//
//   - the page script compiles (a stray backslash or dollar-brace in the
//     template changes the JS it ships)
//   - every element the script looks up exists in the markup
//   - every event type the service sends has a handler in the page
//   - nothing loads from off the machine (the CSP allows 'self' + data: only,
//     and the phone may have no internet)
//   - the chat input can't exceed the server's 2000-character cap
//   - the split-layout media query in CSS and the one JS checks are the same
//
// Behaviour (scrolling, transcript merge, pending answers, reconnect replay,
// every device shape) is exercised by the Playwright check in
// tests/phone-mirror/phone-mirror-client.check.mjs.
//
// Platform-agnostic: string and vm checks only.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../');
const require = createRequire(import.meta.url);

const bundlePath = process.env.PHONE_MIRROR_CLIENT_BUNDLE
  ? path.resolve(process.env.PHONE_MIRROR_CLIENT_BUNDLE)
  : path.resolve(repoRoot, 'dist-electron/electron/services/phoneMirrorClient.js');
const { PHONE_MIRROR_HTML: html } = require(bundlePath);
// Normalised so a CRLF checkout (Windows without the repo's eol=lf) still parses.
const serviceSource = fs
  .readFileSync(path.join(repoRoot, 'electron/services/PhoneMirrorService.ts'), 'utf8')
  .replace(/\r\n/g, '\n');

const script = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
const markup = html.replace(/<script>[\s\S]*?<\/script>/, '').replace(/<style>[\s\S]*?<\/style>/, '');

describe('phone mirror page template', () => {
  test('has one script and one stylesheet', () => {
    assert.ok(script.length > 1000, 'script found');
    assert.ok(style.length > 1000, 'style found');
  });

  test('the page script compiles', () => {
    assert.doesNotThrow(() => new vm.Script(script, { filename: 'phone-mirror-page.js' }));
  });

  test('every element the script looks up exists', () => {
    const ids = [...script.matchAll(/byId\('([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]);
    assert.ok(ids.length > 20, `found ${ids.length} lookups`);
    const missing = ids.filter((id) => !markup.includes(`id="${id}"`));
    assert.deepEqual(missing, []);
  });

  test('every event type the service sends has a handler', () => {
    const union = serviceSource.match(/export type StreamEvent =([\s\S]*?);\n\n/);
    assert.ok(union, 'StreamEvent union found in PhoneMirrorService.ts');
    const types = [...union[1].matchAll(/type: '([a-z-]+)'/g)].map((m) => m[1]);
    for (const t of ['history', 'token', 'done', 'assistant', 'transcript', 'transcript-history', 'meeting']) {
      assert.ok(types.includes(t), `service union lists ${t}`);
    }
    const unhandled = types.filter((t) => !script.includes(`case '${t}':`));
    assert.deepEqual(unhandled, []);
  });

  test('nothing loads from off the machine', () => {
    assert.doesNotMatch(html, /(?:src|href)\s*=\s*"(?:https?:)?\/\//i);
    assert.doesNotMatch(style, /@import|url\(\s*['"]?(?:https?:)?\/\//i);
    assert.doesNotMatch(script, /new WebSocket\(\s*['"]wss?:\/\/[^'"]*['"]/);
  });

  test('the chat input is capped at the server limit', () => {
    const cap = serviceSource.match(/c\.message\.length <= (\d+)/);
    assert.ok(cap, 'server chat cap found');
    const input = markup.match(/<textarea[^>]*id="input"[^>]*>/);
    assert.ok(input, 'chat input found');
    const max = input[0].match(/maxlength="(\d+)"/);
    assert.ok(max && Number(max[1]) <= Number(cap[1]), `maxlength ${max && max[1]} <= ${cap[1]}`);
  });

  test('the viewport opts into safe areas', () => {
    assert.match(markup, /<meta name="viewport" content="[^"]*viewport-fit=cover/);
  });

  test('the split layout query is the same in CSS and in the script', () => {
    const inCss = style.match(/\/\* ── Split layout[^*]*\*\/\s*@media ([^{]+)\{/);
    const inJs = script.match(/var splitQuery = window\.matchMedia\('([^']+)'\)/);
    assert.ok(inCss && inJs, 'both queries found');
    assert.equal(inCss[1].trim(), inJs[1].trim());
  });
});
