// src/lib/__tests__/PlansPriceRow2026_11_16.test.mjs
//
// Settings › Plans & Billing, the plan cards' price row (2026-11-16):
//   - Yearly put "2 months free" at the row's right edge; a narrow card split
//     "/ year" across two lines and wrapped the pill. It now stacks under
//     "/ year", and the pair never wraps.
//   - Hourly swaps the cards, so no price stayed mounted to roll the way
//     Monthly / Yearly's odometer does. The incoming cards now roll from the
//     prices they replace, slot by slot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(__dirname, '..', '..', rel), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const code = stripComments(read('components/settings/NativelyApiSettings.tsx'));
const css = read('components/settings/apiTier.css');

test('Yearly stacks "/ year" over "2 months free", and the pair never wraps', () => {
  assert.match(code, /<span className="api-tier-per-group" data-stacked=\{yearly \? 'true' : undefined\}>\s*<span className="api-tier-per">\{yearly \? '\/ year' : '\/ month'\}<\/span>\s*\{yearly && \(\s*<span className="api-tier-save api-tier-save-stacked"/);
  assert.doesNotMatch(code, /api-tier-save-inline/, 'the right-edge pill is gone');
  const group = css.slice(css.indexOf('.api-tier-per-group {'));
  assert.match(group, /^\.api-tier-per-group \{[^}]*white-space: nowrap;/);
  assert.match(css, /\.api-tier-per-group\[data-stacked='true'\] \{ align-self: flex-end; \}/);
  // Two 16px lines are the 32px price line, so Yearly and Monthly cards match.
  assert.match(css, /\.api-tier-per-group\[data-stacked='true'\] > span \{ line-height: 16px; \}/);
  assert.match(css, /\.api-tier-amount \{[^}]*line-height: 32px;/);
});

test('Hourly and back: the incoming cards roll from the prices they replace', () => {
  assert.match(code, /const \[priceFrom, setPriceFrom\] = useState<readonly string\[\]>\(\[\]\);/, 'no roll on first paint');
  assert.match(code, /if \(next === 'hourly'\) \{\s*setPriceFrom\(PLANS\.map\(\(p\) => \(billingCycle === 'yearly' \? p\.yearlyPrice : p\.price\)\)\);/);
  assert.match(code, /if \(packsView\) \{\s*setPriceFrom\(PRO_PACKS\.map\(\(p\) => `\$\$\{p\.price\}`\)\);/);
  assert.match(code, /<ProPacks [^>]*rollFrom=\{priceFrom\} \/>/);
  assert.match(code, /<RollingPrice price=\{`\$\$\{p\.price\}`\} from=\{rollFrom\[i\] \?\? `\$\$\{p\.price\}`\} \/>/);
  assert.match(code, /<RollingPrice price=\{price\} from=\{priceFrom\[PLANS\.indexOf\(plan\)\] \?\? price\} \/>/);
  // Monthly <-> Yearly still sets the cycle and tells plans_visit.
  assert.match(code, /plansVisit\.cycleSwitched\(next\);\s*setBillingCycle\(next\);/);
});
