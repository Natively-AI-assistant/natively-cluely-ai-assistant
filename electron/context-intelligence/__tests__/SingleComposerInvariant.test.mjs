// Phase 9 §28 regression guard — ONE prompt composer, permanently.
//
// The investigation found two composers: electron/llm/promptComposer.ts
// (complete, tested, ZERO importers) and the V3 composer. The removal matrix
// §2.1 stated the rule — "either wire it or delete it; what must not persist is
// a third composer" — Phase 4 chose the V3 one, and Phase 9 deleted the other.
//
// This test is what stops the pattern returning. It fails if a second composer
// reappears, or if the surviving one loses its call sites and becomes the same
// unreachable code the mission exists to eliminate.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

const repo = process.cwd();
const read = (p) => { try { return fs.readFileSync(path.join(repo, p), 'utf8'); } catch { return null; } };

describe('single-composer invariant', () => {
  test('the legacy composer is gone and does not come back', () => {
    assert.equal(read('electron/llm/promptComposer.ts'), null,
      'electron/llm/promptComposer.ts was removed in Phase 9 — it had zero importers while the V3 composer drives five surfaces');
  });

  test('its orphaned flag is gone too', () => {
    const flags = read('electron/intelligence/intelligenceFlags.ts') ?? '';
    assert.ok(!flags.includes("promptComposerV2:"),
      'a flag whose only module is deleted is debris, and its dev/test-only default was an F5 split');
  });

  test('exactly ONE composePrompt implementation exists in electron/', () => {
    const impls = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(path.join(repo, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          if (e.name === '__tests__' || e.name === 'node_modules') continue;
          walk(rel);
        } else if (e.name.endsWith('.ts')) {
          const src = read(rel) ?? '';
          if (/export function composePrompt\b/.test(src)) impls.push(rel);
        }
      }
    };
    walk('electron');
    assert.deepEqual(impls, ['electron/context-intelligence/generation/prompt-composer.ts'],
      `expected exactly one composer implementation, found: ${JSON.stringify(impls)}`);
  });

  test('the surviving composer is REACHED — deleting the wrong one would have left dead code', () => {
    // The whole point: a composer with no callers is the defect. These are the
    // adoption sites Phase 6/7 wired.
    const callers = [
      'electron/ipcHandlers.ts',
      'electron/context-intelligence/orchestration/engine-bridge.ts',
    ];
    for (const c of callers) {
      const src = read(c) ?? '';
      assert.ok(/composePrompt/.test(src), `${c} must still reach the composer`);
    }
  });
});
