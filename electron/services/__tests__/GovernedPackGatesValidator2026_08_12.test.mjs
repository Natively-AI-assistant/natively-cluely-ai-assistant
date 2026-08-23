// electron/services/__tests__/GovernedPackGatesValidator2026_08_12.test.mjs
//
// A ContextOsGenerationContext carries an evidencePack even when it does NOT
// govern the turn: packGovernsGeneration returns false for unbounded
// authorities (profile_only / general_mixed), and the turn then runs the LEGACY
// retrieval path — that fall-through is the 2026-08-11 fix for WTA screenshot
// turns being refused with "not directly mentioned in the uploaded material".
//
// Three consumers read that pack. WhatToAnswerLLM was gated on `govern` when
// the fall-through landed; the two post-stream doc-grounded validators were
// not (code review 2026-08-12). They keyed on pack PRESENCE, so an ungoverned
// (item-less) pack became the evidence block, the legacy re-retrieval branches
// were skipped, and the validator refused an answer the legacy path had just
// produced correctly.
//
// Source-level pin: these are deep inside streaming IPC handlers with no unit
// seam. What must never drift is that all three read `govern`, not presence.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8')
  // Strip comments: prose describing the OLD keying must not satisfy a check.
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const SITES = [
  {
    file: 'electron/IntelligenceEngine.ts',
    what: 'the WTA post-stream doc-grounded validator',
    context: 'wtaContextOsGeneration',
  },
  {
    file: 'electron/ipcHandlers.ts',
    what: 'the manual-chat post-stream doc-grounded validator',
    context: 'manualContextOsGeneration',
  },
];

describe('an ungoverned evidence pack never becomes a validator evidence block', () => {
  for (const site of SITES) {
    test(`${site.what} gates _governedPack on govern, not presence`, () => {
      const src = read(site.file);
      const decl = new RegExp(`const\\s+_governedPack\\s*=([\\s\\S]{0,240}?);`, 'm');
      const match = src.match(decl);
      assert.ok(match, `${site.file}: _governedPack declaration not found`);
      assert.match(match[1], /\bgovern\b/,
        `${site.file}: _governedPack must be read only when the pack GOVERNS the turn, got:${match[1]}`);
      assert.match(match[1], new RegExp(site.context),
        `${site.file}: expected the ${site.context} snapshot to be the source`);
    });
  }

  test('WhatToAnswerLLM keeps its own govern gate on the generation-side pack', () => {
    const src = read('electron/llm/WhatToAnswerLLM.ts');
    const match = src.match(/let\s+governedEvidencePack[\s\S]{0,300}?;/);
    assert.ok(match, 'governedEvidencePack declaration not found');
    assert.match(match[0], /govern/,
      'an ungoverned pack must not suppress the legacy mode-context retrieval');
  });
});
