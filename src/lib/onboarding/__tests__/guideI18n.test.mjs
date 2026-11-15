// The first-run guide is translated like the welcome it follows: every string
// a guide component hands to tr() has a row in src/i18n.onboarding.ts for
// ru, zh, ja and es, unless all four generated dictionaries already have it.
// A translation keeps every {placeholder} the component fills.
// Run: node --experimental-strip-types --test src/lib/onboarding/__tests__/guideI18n.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ONBOARDING_RU, ONBOARDING_ZH, ONBOARDING_JA, ONBOARDING_ES } from '../../../i18n.onboarding.ts';
import { RU_GENERATED } from '../../../i18n.ru.generated.ts';
import { ZH_GENERATED } from '../../../i18n.zh.generated.ts';
import { JA_GENERATED } from '../../../i18n.ja.generated.ts';
import { ES_GENERATED } from '../../../i18n.es.generated.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const GUIDE = path.join(ROOT, 'src/components/guide');
const OURS = { ru: ONBOARDING_RU, zh: ONBOARDING_ZH, ja: ONBOARDING_JA, es: ONBOARDING_ES };
const GENERATED = { ru: RU_GENERATED, zh: ZH_GENERATED, ja: JA_GENERATED, es: ES_GENERATED };

function guideStrings() {
  const out = new Set(['Show the guide again', 'Walks you through your first meeting, one step at a time.']);
  // Step 6's titles come from planStepTitle (firstRunGuide.mjs), translated by the caller.
  const lib = fs.readFileSync(path.join(ROOT, 'src/lib/onboarding/firstRunGuide.mjs'), 'utf8');
  const fn = lib.slice(lib.indexOf('export function planStepTitle'), lib.indexOf('export function trialEventFromLocal'));
  for (const m of fn.matchAll(/return '((?:[^'\\]|\\.)*)'/g)) out.add(m[1]);
  for (const f of fs.readdirSync(GUIDE).filter((n) => n.endsWith('.tsx'))) {
    const src = fs.readFileSync(path.join(GUIDE, f), 'utf8');
    for (const m of src.matchAll(/\btr\('((?:[^'\\]|\\.)*)'\)/g)) out.add(m[1].replace(/\\'/g, "'"));
  }
  return [...out];
}

test('the scan finds the guide copy', () => {
  const found = guideStrings();
  assert.ok(found.includes('Start your first meeting.'));
  assert.ok(found.includes('Skip guide'));
  assert.ok(found.length > 40);
});

test('every guide string is translated into ru, zh, ja and es', () => {
  const missing = [];
  for (const en of guideStrings()) {
    for (const lang of Object.keys(OURS)) {
      if (!OURS[lang][en] && !GENERATED[lang][en]) missing.push(`${lang}: ${en}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('translations keep their placeholders', () => {
  for (const en of guideStrings()) {
    const want = (en.match(/\{\w+\}/g) ?? []).sort();
    for (const lang of Object.keys(OURS)) {
      const tx = OURS[lang][en] ?? GENERATED[lang][en];
      if (!tx) continue;
      assert.deepEqual((tx.match(/\{\w+\}/g) ?? []).sort(), want, `${lang}: ${en}`);
    }
  }
});

test('no English string has two rows (a later row would silently win)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/i18n.onboarding.ts'), 'utf8');
  const keys = [...src.matchAll(/^  '((?:[^'\\]|\\.)*)': \[/gm)].map((m) => m[1]);
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  assert.deepEqual(dupes, []);
});
