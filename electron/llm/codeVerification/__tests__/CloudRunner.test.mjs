// electron/llm/codeVerification/__tests__/CloudRunner.test.mjs
//
// The cloud (Piston) backend is a CONSENT/PRIVACY boundary: it sends the
// model's code off-device. It must be OFF by default and never run un-gated.
// These pin that boundary so enabling cloud later can't silently regress it.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  cloudExecutionEnabled,
  runCaseCloud,
  pistonUrl,
  CLOUD_LANGUAGES,
} from '../../../../dist-electron/electron/llm/codeVerification/cloudRunner.js';

const tc = { input: [1], expected: 1, source: 'model' };

describe('cloudRunner — gated OFF by default', () => {
  test('cloudExecutionEnabled() is false without the opt-in flag', () => {
    const prev = process.env.NATIVELY_CODE_EXECUTION_CLOUD;
    delete process.env.NATIVELY_CODE_EXECUTION_CLOUD;
    try {
      assert.equal(cloudExecutionEnabled(), false);
    } finally {
      if (prev !== undefined) process.env.NATIVELY_CODE_EXECUTION_CLOUD = prev;
    }
  });

  test('runCaseCloud returns a skip-error (no send) when disabled', async () => {
    const prev = process.env.NATIVELY_CODE_EXECUTION_CLOUD;
    delete process.env.NATIVELY_CODE_EXECUTION_CLOUD;
    try {
      const r = await runCaseCloud('java', 'class Solution {}', 'f', tc);
      assert.equal(r.status, 'error');
      assert.equal(r.error, 'cloud_execution_disabled');
    } finally {
      if (prev !== undefined) process.env.NATIVELY_CODE_EXECUTION_CLOUD = prev;
    }
  });

  test('even with the flag on, the stub does not execute (pending) — never a false pass', async () => {
    const prev = process.env.NATIVELY_CODE_EXECUTION_CLOUD;
    process.env.NATIVELY_CODE_EXECUTION_CLOUD = 'true';
    try {
      const r = await runCaseCloud('java', 'class Solution {}', 'f', tc);
      // Either the SettingsManager require fails (→ disabled) or the stub is
      // pending — both are 'error', never 'pass'.
      assert.equal(r.status, 'error');
      assert.match(r.error, /cloud_runner_pending|cloud_execution_disabled/);
    } finally {
      if (prev !== undefined) process.env.NATIVELY_CODE_EXECUTION_CLOUD = prev; else delete process.env.NATIVELY_CODE_EXECUTION_CLOUD;
    }
  });

  test('pistonUrl honors the override env, falls back to default', () => {
    const prev = process.env.NATIVELY_PISTON_URL;
    process.env.NATIVELY_PISTON_URL = 'https://piston.internal/api';
    try {
      assert.equal(pistonUrl(), 'https://piston.internal/api');
    } finally {
      if (prev !== undefined) process.env.NATIVELY_PISTON_URL = prev; else delete process.env.NATIVELY_PISTON_URL;
    }
    delete process.env.NATIVELY_PISTON_URL;
    assert.match(pistonUrl(), /piston/);
  });

  test('CLOUD_LANGUAGES is just [c] — everything else runs locally now', () => {
    assert.ok(CLOUD_LANGUAGES.includes('c'));
    // python/js (interpreted), cpp/java/go (local compile+run), sql (sqlite3)
    // all run LOCALLY → none are cloud.
    for (const local of ['python', 'javascript', 'cpp', 'java', 'go', 'sql']) {
      assert.ok(!CLOUD_LANGUAGES.includes(local), `${local} should not be cloud`);
    }
  });
});
