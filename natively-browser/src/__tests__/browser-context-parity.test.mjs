// natively-browser/src/__tests__/browser-context-parity.test.mjs
//
// Drift-guard for the per-subsystem-duplicated Smart Browser Context types.
// The vocabulary lives in THREE copies (the extension package, electron, and the
// renderer .d.ts can't share a file). This test reads all three as TEXT and
// asserts the union literals + envelope field set are byte-identical, so a union
// edited in one place can never silently diverge from the others.
//
// Reads source (not compiled) — no build step required.
// Run: node --test src/__tests__/browser-context-parity.test.mjs  (or npm test)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../');

const FILES = {
  extension: path.join(repoRoot, 'natively-browser/src/capture/types.ts'),
  desktop: path.join(repoRoot, 'electron/services/browser-context/types.ts'),
  renderer: path.join(repoRoot, 'src/types/electron.d.ts'),
};

// Pull the quoted string-literal members of `export type <Name> = '...' | '...';`
// out of a source string. Returns the literals in source order.
function extractUnion(source, typeName) {
  const re = new RegExp(`export type ${typeName}\\s*=([\\s\\S]*?);`);
  const m = source.match(re);
  assert.ok(m, `union "${typeName}" not found`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

// Pull the field names from `export interface ContextEnvelope... { ... }` — only
// the TOP-LEVEL keys (depth 1), so the nested `meta: { ... }` object counts once.
function extractEnvelopeFields(source) {
  const start = source.indexOf('interface ContextEnvelope');
  assert.ok(start >= 0, 'ContextEnvelope interface not found');
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  const fields = [];
  let i = braceStart;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) break;
    } else if (depth === 1) {
      // A top-level field is `name:` or `name?:` at depth 1. Capture identifiers
      // that are immediately followed (ignoring `?`) by a colon.
      const rest = source.slice(i);
      const fm = rest.match(/^(\w+)\??:/);
      if (fm) {
        fields.push(fm[1]);
        i += fm[0].length - 1;
      }
    }
  }
  return fields;
}

const UNIONS = {
  BrowserContextCategory: [
    'coding_problem', 'coding_editor', 'interview_assessment', 'developer_docs',
    'job_description', 'google_docs_visible', 'notes', 'article', 'email', 'chat',
    'banking', 'auth', 'unknown',
  ],
  AutoPolicy: ['auto', 'auto_if_high_confidence', 'ask', 'manual', 'blocked'],
  BrowserContextSensitivity: ['low', 'medium', 'high', 'critical'],
  ClassificationConfidence: ['high', 'medium', 'low'],
  CaptureMode: ['auto', 'manual', 'selected_text', 'screenshot_fallback'],
  ExtractionSource: [
    'platform-selector', 'embedded-state', 'editor-dom', 'selection',
    'readability', 'innerText', 'screenshot',
  ],
};

const ENVELOPE_FIELDS = [
  'envelopeVersion', 'contextId', 'source', 'captureMode', 'category',
  'sensitivity', 'confidence', 'meta', 'payload',
];

describe('Smart Browser Context — type parity across 3 subsystem copies', () => {
  const sources = Object.fromEntries(
    Object.entries(FILES).map(([k, f]) => [k, fs.readFileSync(f, 'utf8')]),
  );

  for (const [typeName, expected] of Object.entries(UNIONS)) {
    test(`union ${typeName} matches in extension/desktop/renderer`, () => {
      for (const [where, src] of Object.entries(sources)) {
        assert.deepEqual(
          extractUnion(src, typeName),
          expected,
          `${typeName} drifted in ${where} (${FILES[where]})`,
        );
      }
    });
  }

  test('ContextEnvelope top-level fields match in all 3 copies', () => {
    for (const [where, src] of Object.entries(sources)) {
      assert.deepEqual(
        extractEnvelopeFields(src),
        ENVELOPE_FIELDS,
        `ContextEnvelope fields drifted in ${where}`,
      );
    }
  });
});
