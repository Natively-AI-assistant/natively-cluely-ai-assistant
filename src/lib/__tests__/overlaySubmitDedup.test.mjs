import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSubmitText,
  shouldDedupeManualSubmit,
} from '../overlaySubmitDedup.mjs';

describe('overlaySubmitDedup', () => {
  test('normalizeSubmitText trims and collapses whitespace', () => {
    assert.equal(normalizeSubmitText('  hello   world  '), 'hello world');
  });

  test('shouldDedupeManualSubmit returns false with no prior submit', () => {
    assert.equal(
      shouldDedupeManualSubmit({
        text: 'What is Kubernetes?',
        lastText: null,
        lastAtMs: null,
        nowMs: 10000,
      }),
      false,
    );
  });

  test('shouldDedupeManualSubmit returns true for same text inside window', () => {
    assert.equal(
      shouldDedupeManualSubmit({
        text: 'What is Kubernetes?',
        lastText: 'What is Kubernetes?',
        lastAtMs: 5000,
        nowMs: 7000,
        windowMs: 5000,
      }),
      true,
    );
  });

  test('shouldDedupeManualSubmit returns false after window expires', () => {
    assert.equal(
      shouldDedupeManualSubmit({
        text: 'What is Kubernetes?',
        lastText: 'What is Kubernetes?',
        lastAtMs: 1000,
        nowMs: 7000,
        windowMs: 5000,
      }),
      false,
    );
  });

  test('shouldDedupeManualSubmit treats whitespace-normalized text as duplicate', () => {
    assert.equal(
      shouldDedupeManualSubmit({
        text: '  What   is Kubernetes? ',
        lastText: 'What is Kubernetes?',
        lastAtMs: 9000,
        nowMs: 10000,
      }),
      true,
    );
  });
});
