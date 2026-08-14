// natively-browser/src/__tests__/registry.test.mjs
//
// Tests the Smart Browser Context capture registry: schema validation, expiry,
// safe fallback to the bundled default, and the pure host/URL matchers used by
// the classifier. Imports the compiled module from dist-test/ (built by
// esbuild.test.mjs), matching the repo's "import compiled JS" convention.
//
// Run: npm run build:test && node --test src/__tests__/registry.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../dist-test/capture/registry/registry.js');
const {
  DEFAULT_REGISTRY,
  isValidRegistry,
  isExpired,
  loadRegistry,
  normalizeHost,
  hostMatches,
  hostMatchesAny,
  urlMatchesAny,
  findPlatform,
  findBlocked,
  findCategory,
  findCategoryByHostUrl,
  codingOptionalOrigins,
} = await import(pathToFileURL(modPath).href);

describe('registry — bundled default integrity', () => {
  test('default registry is structurally valid', () => {
    assert.equal(isValidRegistry(DEFAULT_REGISTRY), true);
  });

  test('covers the headline coding platforms', () => {
    const ids = new Set(DEFAULT_REGISTRY.platforms.map((p) => p.id));
    for (const id of ['leetcode', 'hackerrank', 'codesignal', 'coderpad', 'codeforces', 'replit']) {
      assert.ok(ids.has(id), `missing platform ${id}`);
    }
  });

  test('blocks email/chat/banking/auth hosts', () => {
    const ids = new Set(DEFAULT_REGISTRY.blockedHosts.map((b) => b.id));
    for (const id of ['gmail', 'slack', 'whatsapp', 'chase', 'google_auth']) {
      assert.ok(ids.has(id), `missing blocked host ${id}`);
    }
  });

  test('no platform uses the blocked extractor', () => {
    assert.ok(DEFAULT_REGISTRY.platforms.every((p) => p.extractor !== 'blocked'));
  });

  test('default registry is frozen (immutable)', () => {
    assert.throws(() => {
      // @ts-ignore
      DEFAULT_REGISTRY.platforms.push({});
    });
  });
});

describe('registry — validation', () => {
  test('rejects non-objects', () => {
    assert.equal(isValidRegistry(null), false);
    assert.equal(isValidRegistry('nope'), false);
    assert.equal(isValidRegistry(42), false);
  });

  test('rejects missing arrays', () => {
    assert.equal(isValidRegistry({ version: '1', createdAt: 'x' }), false);
  });

  test('rejects a category with an unknown extractor', () => {
    const bad = {
      version: '1', createdAt: 'x',
      categories: [{
        id: 'coding_problem', label: 'x', autoPolicy: 'auto', sensitivity: 'low',
        urlPatterns: [], hostPatterns: [], positiveSignals: [], negativeSignals: [],
        extractor: 'rm -rf', // not in the allowlist
      }],
      platforms: [], blockedHosts: [],
    };
    assert.equal(isValidRegistry(bad), false);
  });

  test('accepts a minimal well-formed registry', () => {
    const ok = { version: '1', createdAt: 'x', categories: [], platforms: [], blockedHosts: [] };
    assert.equal(isValidRegistry(ok), true);
  });
});

describe('registry — expiry + safe fallback', () => {
  const NOW = Date.parse('2026-06-19T00:00:00Z');

  test('isExpired true when expiresAt is in the past', () => {
    assert.equal(isExpired({ expiresAt: '2020-01-01T00:00:00Z' }, NOW), true);
  });

  test('isExpired false when expiresAt is in the future or absent', () => {
    assert.equal(isExpired({ expiresAt: '2030-01-01T00:00:00Z' }, NOW), false);
    assert.equal(isExpired({}, NOW), false);
  });

  test('loadRegistry falls back to bundled on invalid candidate', () => {
    assert.equal(loadRegistry({ garbage: true }, NOW), DEFAULT_REGISTRY);
  });

  test('loadRegistry falls back to bundled on expired candidate', () => {
    const expired = { version: '9', createdAt: 'x', expiresAt: '2000-01-01T00:00:00Z', categories: [], platforms: [], blockedHosts: [] };
    assert.equal(loadRegistry(expired, NOW), DEFAULT_REGISTRY);
  });

  test('loadRegistry accepts a valid unexpired candidate', () => {
    const fresh = { version: '9', createdAt: 'x', expiresAt: '2030-01-01T00:00:00Z', categories: [], platforms: [], blockedHosts: [] };
    assert.equal(loadRegistry(fresh, NOW), fresh);
  });

  test('loadRegistry with no candidate returns bundled', () => {
    assert.equal(loadRegistry(undefined, NOW), DEFAULT_REGISTRY);
  });
});

describe('registry — host/URL matchers', () => {
  test('normalizeHost strips www and lowercases', () => {
    assert.equal(normalizeHost('WWW.LeetCode.com'), 'leetcode.com');
    assert.equal(normalizeHost(undefined), '');
  });

  test('hostMatches handles subdomains', () => {
    assert.equal(hostMatches('www.leetcode.com', 'leetcode.com'), true);
    assert.equal(hostMatches('app.codesignal.com', 'codesignal.com'), true);
    assert.equal(hostMatches('notleetcode.com', 'leetcode.com'), false);
    assert.equal(hostMatches('leetcode.com.evil.com', 'leetcode.com'), false);
  });

  test('urlMatchesAny is case-insensitive substring', () => {
    assert.equal(urlMatchesAny('https://x.com/Problems/two-sum', ['/problems']), true);
    assert.equal(urlMatchesAny('https://x.com/home', ['/problems']), false);
  });

  test('hostMatchesAny', () => {
    assert.equal(hostMatchesAny('leetcode.cn', ['leetcode.com', 'leetcode.cn']), true);
  });
});

describe('registry — lookups', () => {
  test('findPlatform resolves LeetCode problem URL', () => {
    const p = findPlatform(DEFAULT_REGISTRY, 'leetcode.com', 'https://leetcode.com/problems/two-sum/');
    assert.ok(p);
    assert.equal(p.id, 'leetcode');
    assert.equal(p.category, 'coding_problem');
  });

  test('findPlatform requires the URL gate when patterns exist', () => {
    // LeetCode homepage (no /problems/) should not resolve to the platform rule.
    const p = findPlatform(DEFAULT_REGISTRY, 'leetcode.com', 'https://leetcode.com/');
    assert.equal(p, null);
  });

  test('findPlatform resolves CoderPad (bare "/" gate matches)', () => {
    const p = findPlatform(DEFAULT_REGISTRY, 'app.coderpad.io', 'https://app.coderpad.io/ABCXYZ');
    assert.ok(p);
    assert.equal(p.id, 'coderpad');
  });

  test('findBlocked resolves Gmail by host', () => {
    const b = findBlocked(DEFAULT_REGISTRY, 'mail.google.com', 'https://mail.google.com/mail/u/0/');
    assert.ok(b);
    assert.equal(b.category, 'email');
  });

  test('findBlocked resolves generic checkout by URL', () => {
    const b = findBlocked(DEFAULT_REGISTRY, 'shop.example.com', 'https://shop.example.com/checkout/pay');
    assert.ok(b);
    assert.equal(b.category, 'banking');
  });

  test('findCategory returns the rule', () => {
    const c = findCategory(DEFAULT_REGISTRY, 'coding_problem');
    assert.ok(c);
    assert.equal(c.autoPolicy, 'auto');
  });

  test('codingOptionalOrigins includes leetcode + excludes blocked hosts', () => {
    const origins = codingOptionalOrigins(DEFAULT_REGISTRY);
    assert.ok(origins.some((o) => o.includes('leetcode.com')));
    assert.ok(!origins.some((o) => o.includes('mail.google.com')));
  });

  test('findCategoryByHostUrl: job_description matches by host OR url', () => {
    const byHost = findCategoryByHostUrl(DEFAULT_REGISTRY, 'linkedin.com', 'https://www.linkedin.com/jobs/view/1');
    assert.ok(byHost && byHost.id === 'job_description');
    const byUrl = findCategoryByHostUrl(DEFAULT_REGISTRY, 'careers.acme.com', 'https://careers.acme.com/careers/eng');
    assert.ok(byUrl && byUrl.id === 'job_description');
  });

  test('FINAL-REVIEW MEDIUM: developer_docs requires a HOST match (broad /api,/docs url tokens alone do NOT match)', () => {
    // A bare /api token on an unknown host must NOT classify as developer_docs.
    assert.equal(findCategoryByHostUrl(DEFAULT_REGISTRY, 'internal.corp.com', 'https://internal.corp.com/api/patients'), null);
    assert.equal(findCategoryByHostUrl(DEFAULT_REGISTRY, 'admin.shop.com', 'https://admin.shop.com/docs/orders'), null);
    // A KNOWN docs host still matches.
    const mdn = findCategoryByHostUrl(DEFAULT_REGISTRY, 'developer.mozilla.org', 'https://developer.mozilla.org/en-US/docs/Web/API/fetch');
    assert.ok(mdn && mdn.id === 'developer_docs');
  });

  test('findCategoryByHostUrl never returns a coding or sensitive category', () => {
    // coding-like url on an unknown host → not matched here (stays platform-gated/AI)
    assert.equal(findCategoryByHostUrl(DEFAULT_REGISTRY, 'assess.acme.com', 'https://assess.acme.com/challenge/42'), null);
    // a Gmail-ish url → not matched here (handled by the blocked floor)
    assert.equal(findCategoryByHostUrl(DEFAULT_REGISTRY, 'mail.google.com', 'https://mail.google.com/'), null);
  });
});
