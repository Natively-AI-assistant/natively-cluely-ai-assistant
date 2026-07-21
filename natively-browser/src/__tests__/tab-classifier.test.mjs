// natively-browser/src/__tests__/tab-classifier.test.mjs
//
// Tests the local tab classifier, signal scorer, and sensitive-page detector.
// Pure logic — no DOM/chrome stub. Imports compiled dist-test/ modules.
//
// Run: npm run build:test && node --test src/__tests__/tab-classifier.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reg = await import(pathToFileURL(path.resolve(__dirname, '../../dist-test/capture/registry/registry.js')).href);
const scorer = await import(pathToFileURL(path.resolve(__dirname, '../../dist-test/capture/classifier/signal-scorer.js')).href);
const sens = await import(pathToFileURL(path.resolve(__dirname, '../../dist-test/capture/classifier/sensitive-page-detector.js')).href);
const cls = await import(pathToFileURL(path.resolve(__dirname, '../../dist-test/capture/classifier/tab-classifier.js')).href);

const R = reg.DEFAULT_REGISTRY;

describe('signal-scorer — additive bands', () => {
  test('known coding host + problem URL + IO signals → auto (>=80)', () => {
    const r = scorer.scoreSignals({
      knownCodingHost: true, problemUrlToken: true, ioConstraintSignals: true,
    });
    assert.equal(r.score, 95);
    assert.equal(r.band, 'auto');
  });

  test('coding host alone (50) → ask band', () => {
    const r = scorer.scoreSignals({ knownCodingHost: true });
    assert.equal(r.score, 50);
    assert.equal(r.band, 'ask');
  });

  test('weak signals (<50) → manual', () => {
    const r = scorer.scoreSignals({ hasSelection: true });
    assert.equal(r.score, 10);
    assert.equal(r.band, 'manual');
  });

  test('blockedHost forces blocked even with high coding score', () => {
    const r = scorer.scoreSignals({ knownCodingHost: true, problemUrlToken: true, blockedHost: true });
    assert.equal(r.band, 'blocked');
  });

  test('explicit blocked flag forces blocked band', () => {
    const r = scorer.scoreSignals({ knownCodingHost: true, problemUrlToken: true }, true);
    assert.equal(r.band, 'blocked');
  });
});

describe('sensitive-page-detector — privacy floor', () => {
  test('Gmail host is sensitive (email, critical)', () => {
    const v = sens.detectSensitive(R, 'mail.google.com', 'https://mail.google.com/mail/u/0/');
    assert.equal(v.sensitive, true);
    assert.equal(v.category, 'email');
    assert.equal(v.sensitivity, 'critical');
  });

  test('Slack is sensitive (chat)', () => {
    const v = sens.detectSensitive(R, 'app.slack.com', 'https://app.slack.com/client/T0/C0');
    assert.equal(v.sensitive, true);
    assert.equal(v.category, 'chat');
  });

  test('checkout URL on unknown host is sensitive (banking)', () => {
    const v = sens.detectSensitive(R, 'shop.example.com', 'https://shop.example.com/checkout');
    assert.equal(v.sensitive, true);
    assert.equal(v.category, 'banking');
  });

  test('login URL token is sensitive (auth)', () => {
    const v = sens.detectSensitive(R, 'example.com', 'https://example.com/login');
    assert.equal(v.sensitive, true);
    assert.equal(v.category, 'auth');
  });

  test('password field signal forces auth block on any host', () => {
    const v = sens.detectSensitive(R, 'example.com', 'https://example.com/dashboard', { hasPasswordField: true });
    assert.equal(v.sensitive, true);
    assert.equal(v.category, 'auth');
  });

  test('plain coding page is not sensitive', () => {
    const v = sens.detectSensitive(R, 'leetcode.com', 'https://leetcode.com/problems/two-sum/');
    assert.equal(v.sensitive, false);
  });
});

describe('tab-classifier — known coding platforms', () => {
  test('LeetCode problem with IO signals → coding_problem + auto', () => {
    const c = cls.classifyTab({
      registry: R,
      host: 'leetcode.com',
      url: 'https://leetcode.com/problems/two-sum/',
      title: 'Two Sum - LeetCode',
      signals: { codeEditorPresent: true, ioConstraintSignals: true, runSubmitSignals: true },
    });
    assert.equal(c.matchedCategory, 'coding_problem');
    assert.equal(c.matchedPlatform, 'leetcode');
    assert.equal(c.autoPolicy, 'auto');
    assert.ok(c.confidenceScore >= 80);
  });

  test('CoderPad editor (no problem signals) → interview_assessment, not auto without confidence', () => {
    const c = cls.classifyTab({
      registry: R,
      host: 'app.coderpad.io',
      url: 'https://app.coderpad.io/ABCXYZ',
      title: 'CoderPad',
      signals: { codeEditorPresent: true },
    });
    assert.equal(c.matchedCategory, 'interview_assessment');
    // host(+50, coding) + editor(+15) = 65 → ask band, not auto.
    assert.equal(c.autoPolicy, 'ask');
  });

  test('background path (no signals) still classifies category from metadata', () => {
    const c = cls.classifyTab({
      registry: R,
      host: 'leetcode.com',
      url: 'https://leetcode.com/problems/two-sum/',
      title: 'Two Sum - LeetCode',
      // no signals → metadata-only (background)
    });
    assert.equal(c.matchedCategory, 'coding_problem');
    // host(+50) + url token(+25) + title keyword(+20) = 95 → auto from metadata alone.
    assert.ok(c.confidenceScore >= 80);
    assert.equal(c.autoPolicy, 'auto');
  });
});

describe('tab-classifier — non-coding + unknown + sensitive', () => {
  test('Google Docs → manual (never auto, high sensitivity)', () => {
    const c = cls.classifyTab({
      registry: R,
      host: 'docs.google.com',
      url: 'https://docs.google.com/document/d/abc/edit',
      title: 'My private doc - Google Docs',
    });
    assert.equal(c.matchedCategory, 'google_docs_visible');
    assert.equal(c.autoPolicy, 'manual');
  });

  test('Gmail → blocked candidate, score 0', () => {
    const c = cls.classifyTab({
      registry: R,
      host: 'mail.google.com',
      url: 'https://mail.google.com/mail/u/0/',
      title: 'Inbox (3) - me@example.com - Gmail',
    });
    assert.equal(c.autoPolicy, 'blocked');
    assert.equal(c.confidenceScore, 0);
    assert.equal(c.matchedCategory, 'email');
  });

  test('unknown coding-like host cannot auto-attach locally (→ ask at most)', () => {
    const c = cls.classifyTab({
      registry: R,
      host: 'assess.acme-corp.com',
      url: 'https://assess.acme-corp.com/challenge/42',
      title: 'Coding Challenge',
      signals: { codeEditorPresent: true, ioConstraintSignals: true, runSubmitSignals: true },
    });
    assert.equal(c.matchedCategory, 'unknown');
    assert.notEqual(c.autoPolicy, 'auto');
    assert.ok(['ask', 'manual'].includes(c.autoPolicy));
  });

  test('a non-coding category never auto-attaches even at high score', () => {
    // Developer docs host with strong signals: category rule is "ask".
    const c = cls.classifyTab({
      registry: R,
      host: 'developer.mozilla.org',
      url: 'https://developer.mozilla.org/en-US/docs/Web/API/fetch',
      title: 'fetch() - Web APIs | MDN',
      signals: { codeEditorPresent: true, ioConstraintSignals: true },
    });
    assert.notEqual(c.autoPolicy, 'auto');
  });
});

describe('sanitizeUrl — host+path kept, secrets dropped', () => {
  test('keeps scheme://host/path, drops query + fragment', () => {
    assert.equal(
      cls.sanitizeUrl('https://leetcode.com/problems/two-sum/?source=nav#editor'),
      'https://leetcode.com/problems/two-sum/',
    );
  });

  test('strips www and lowercases host', () => {
    assert.equal(cls.sanitizeUrl('https://WWW.LeetCode.com/problems/x'), 'https://leetcode.com/problems/x');
  });

  test('redacts UUID / long-id / email / token path segments', () => {
    assert.equal(
      cls.sanitizeUrl('https://x.com/u/550e8400-e29b-41d4-a716-446655440000/edit'),
      'https://x.com/u/:id/edit',
    );
    assert.equal(cls.sanitizeUrl('https://x.com/orders/123456789'), 'https://x.com/orders/:id');
    assert.equal(cls.sanitizeUrl('https://x.com/u/me@example.com'), 'https://x.com/u/:email');
    assert.equal(cls.sanitizeUrl('https://x.com/s/AbCdEf0123456789ghIjKlMnOp'), 'https://x.com/s/:token');
  });

  test('redacts an ALL-ALPHA opaque run >20 chars (no digit) — review gap fix', () => {
    assert.equal(cls.sanitizeUrl('https://x.com/s/abcdefghijklmnopqrstuvwxyz'), 'https://x.com/s/:token');
  });

  test('redacts a realistic JWT (mixed-case base64url parts ≥16)', () => {
    assert.equal(
      cls.sanitizeUrl('https://x.com/auth/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0AbCdEf.s5kT9QabcdefGhIJ'),
      'https://x.com/auth/:token',
    );
  });

  test('FINAL-REVIEW HIGH: redacts a SHORT token (16-19 chars) embedded in a slug-shaped segment', () => {
    // 18-char reset token after a hyphen — the old 20-char/slug-whitelist logic let this through.
    assert.equal(cls.sanitizeUrl('https://app.acme.com/reset/AbCdEfGhIjKlMnOpQr'), 'https://app.acme.com/reset/:token');
  });

  test('FINAL-REVIEW HIGH: redacts an underscore-separated key (sk_live_...)', () => {
    assert.equal(cls.sanitizeUrl('https://acme.com/p/sk_live_51HxYzAbCdEfGhIj'), 'https://acme.com/p/:token');
  });

  test('FINAL-REVIEW HIGH: redacts an opaque SUBDOMAIN label but keeps the registrable domain', () => {
    assert.equal(cls.sanitizeUrl('https://s3cr3tt0ken1234abcd.acme.com/dashboard'), 'https://:sub.acme.com/dashboard');
  });

  test('keeps descriptive slugs + readable subdomains (not redacted)', () => {
    assert.equal(cls.sanitizeUrl('https://x.com/problems/two-sum'), 'https://x.com/problems/two-sum');
    // a short multi-word hyphenated slug stays even though it's long overall
    assert.equal(cls.sanitizeUrl('https://x.com/longest-substring-without-repeating'), 'https://x.com/longest-substring-without-repeating');
    // a long all-lowercase WORD (≤20) stays
    assert.equal(cls.sanitizeUrl('https://x.com/internationalization'), 'https://x.com/internationalization');
    // readable subdomains kept
    assert.equal(cls.sanitizeUrl('https://app.leetcode.com/problems/x'), 'https://app.leetcode.com/problems/x');
  });

  test('downgrades non-http(s) schemes and returns "" for junk', () => {
    assert.equal(cls.sanitizeUrl('javascript://evil/x'), 'https://evil/x');
    assert.equal(cls.sanitizeUrl('not a url'), '');
    assert.equal(cls.sanitizeUrl(undefined), '');
  });

  test('buildSafeMetadata includes sanitizedUrl without the raw query', () => {
    const m = cls.buildSafeMetadata({
      registry: R,
      host: 'assess.acme.com',
      url: 'https://assess.acme.com/challenge/42?token=SECRET',
      title: 'Coding Challenge',
    });
    assert.equal(m.sanitizedUrl, 'https://assess.acme.com/challenge/42');
    assert.ok(!JSON.stringify(m).includes('SECRET'));
  });
});

describe('buildSafeMetadata — sanitized AI input', () => {
  test('contains tokens + host + booleans, never raw body/url path values beyond tokens', () => {
    const m = cls.buildSafeMetadata({
      registry: R,
      host: 'leetcode.com',
      url: 'https://leetcode.com/problems/two-sum/?session=SECRET123',
      title: 'Two Sum - LeetCode',
      signals: { codeEditorPresent: true },
    });
    assert.equal(m.host, 'leetcode.com');
    assert.ok(m.hostHash && m.hostHash.length > 0);
    assert.equal(m.knownPlatformMatch, 'leetcode');
    assert.equal(m.hasCodeEditorSignal, true);
    assert.ok(Array.isArray(m.pathTokens));
    // The raw session token must NOT survive tokenization as a full secret string.
    const joined = JSON.stringify(m);
    assert.ok(!joined.includes('SECRET123'), 'raw URL secret leaked into safe metadata');
  });

  test('flags sensitive pages in metadata', () => {
    const m = cls.buildSafeMetadata({
      registry: R,
      host: 'mail.google.com',
      url: 'https://mail.google.com/',
      title: 'Gmail',
    });
    assert.equal(m.hasSensitiveSignals, true);
  });
});
