// The provider-failure sentences are translated, and stay translated
// (2026-10-01).
//
// They shipped English-only at first. The table is checked against the list
// the wording module publishes, so a sentence added there without a row here
// fails this test instead of quietly showing English in a Japanese overlay.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DIRECT_ASSIST_OPEN_PROVIDERS,
  DIRECT_ASSIST_PHRASES,
  directAssistFailureText,
  directAssistNoticeView,
} from '../directAssistFailure.mjs';
import {
  DIRECT_ASSIST_ES,
  DIRECT_ASSIST_JA,
  DIRECT_ASSIST_RU,
  DIRECT_ASSIST_ZH,
} from '../../i18n.directAssist.ts';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const TABLES = { ru: DIRECT_ASSIST_RU, zh: DIRECT_ASSIST_ZH, ja: DIRECT_ASSIST_JA, es: DIRECT_ASSIST_ES };
const SENTENCES = [...DIRECT_ASSIST_PHRASES, DIRECT_ASSIST_OPEN_PROVIDERS];
const slots = (text) => (text.match(/\{\w+\}/g) || []).sort();

test('every sentence has a row in every language, and no row is left over', () => {
  for (const [lang, table] of Object.entries(TABLES)) {
    assert.deepEqual(Object.keys(table).sort(), [...SENTENCES].sort(), `${lang} covers exactly the published sentences`);
    for (const sentence of SENTENCES) {
      assert.ok(table[sentence].trim().length > 0, `${lang}: "${sentence}" is empty`);
      assert.notEqual(table[sentence], sentence, `${lang}: "${sentence}" was left in English`);
    }
  }
});

test('a translation keeps exactly the slots of its sentence, so a name is never dropped or left as {provider}', () => {
  for (const [lang, table] of Object.entries(TABLES)) {
    for (const sentence of SENTENCES) {
      assert.deepEqual(slots(table[sentence]), slots(sentence), `${lang}: "${sentence}"`);
    }
  }
});

test('a translated notice has the names filled in and no English left in its fixed parts', () => {
  for (const [lang, table] of Object.entries(TABLES)) {
    const t = (text) => table[text] ?? text;
    const view = directAssistNoticeView({
      fallbackNotice: {
        hops: [
          { provider: 'OpenAI', code: 'AUTH_FAILED', next: 'Groq' },
          { provider: 'Groq', code: 'CONNECT_TIMEOUT', waitedMs: 35_000, next: 'Google' },
        ],
        answeredBy: 'Google',
      },
    }, t);
    const lines = [view.headline, ...view.rows.map((row) => row.text)];
    assert.match(lines[0], /Google/);
    assert.match(lines[1], /OpenAI/);
    assert.match(lines[2], /Groq/);
    assert.match(lines[2], /35/);
    for (const line of lines) {
      assert.doesNotMatch(line, /\{\w+\}/, `${lang}: an unfilled slot in "${line}"`);
      // Whole English words only: Spanish "Respondió" is not English "respond".
      assert.doesNotMatch(line, /\b(?:rejected|answered by|didn't respond|your key)\b/i, `${lang}: English left in "${line}"`);
    }
  }
});

test('the plain sentence ends the way its language ends a sentence', () => {
  const failure = { provider: 'Anthropic', code: 'QUOTA_EXHAUSTED', message: 'x' };
  assert.match(directAssistFailureText(failure, (text) => DIRECT_ASSIST_JA[text] ?? text), /。$/);
  assert.match(directAssistFailureText(failure, (text) => DIRECT_ASSIST_ZH[text] ?? text), /。$/);
  assert.match(directAssistFailureText(failure, (text) => DIRECT_ASSIST_ES[text] ?? text), /[^。]\.$/);
});

test('the app actually loads the table into each language', () => {
  const i18n = fs.readFileSync(path.resolve(dirname, '../../i18n.tsx'), 'utf8');
  for (const name of ['DIRECT_ASSIST_RU', 'DIRECT_ASSIST_ZH', 'DIRECT_ASSIST_JA', 'DIRECT_ASSIST_ES']) {
    assert.match(i18n, new RegExp(`\\.\\.\\.${name},`), `${name} is spread into its dictionary`);
  }
});
