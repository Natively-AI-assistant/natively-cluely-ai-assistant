// Settings titles share one face (2026-11-09): Inter, bundled as the
// 'Natively Title' family, at 600. Guards the font file, the two shared roles
// and the stylesheet-scoped equivalents so a tab cannot drift back to the
// system bold on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

test('the title face is bundled, not linked', () => {
  const css = read('src/index.css');
  const face = css.match(/@font-face\s*\{[^}]*font-family:\s*'Natively Title'[^}]*\}/);
  assert.ok(face, "@font-face 'Natively Title' exists");
  const url = face[0].match(/url\('\.\/([^']+)'\)/)[1];
  assert.doesNotMatch(url, /^https?:/);
  assert.ok(existsSync(path.join(root, 'src', url)), `${url} is in the repo`);
  assert.match(css, /--font-title:\s*"Natively Title",[^;]*"Segoe UI"/, 'falls back to the system stack on both platforms');
});

test('the shared roles use the title face at 600', () => {
  const css = read('src/index.css');
  for (const role of ['settings-title', 'settings-heading']) {
    const rule = css.match(new RegExp(`\\.${role}\\s*\\{([^}]*)\\}`));
    assert.ok(rule, `.${role} is defined`);
    assert.match(rule[1], /font-family:\s*var\(--font-title\)/);
    assert.match(rule[1], /font-weight:\s*600/);
  }
});

test('stylesheet-scoped titles use the same face', () => {
  const checks = [
    ['src/components/settings/AIProvidersSettings.tsx', ['aip-title', 'aip-row-title', 'aip-card-title']],
    ['src/components/settings/CalendarSettings.css', ['cp-label', 'cp-card-label']],
  ];
  for (const [file, classes] of checks) {
    const src = read(file);
    for (const cls of classes) {
      const rule = src.match(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`));
      assert.ok(rule, `${file}: .${cls} is defined`);
      assert.match(rule[1], /font-family:\s*var\(--font-title\)/, `${file}: .${cls}`);
    }
  }
});

test('the title face stays inside Settings', () => {
  // Profile Intelligence ("About you" / Cue Cards) is a launcher manager panel,
  // not a Settings tab: it keeps the system font.
  const pi = read('src/components/ProfileIntelligenceSettings.tsx');
  assert.doesNotMatch(pi, /--font-title|settings-title|settings-heading/);
  assert.doesNotMatch(read('src/components/OwnAnswersSection.tsx'), /--font-title|settings-title|settings-heading/);
});

test('no Settings title falls back to the old system bold', () => {
  const files = [
    'src/components/SettingsOverlay.tsx',
    'src/components/AboutSection.tsx',
    'src/components/settings/SettingsRow.tsx',
    'src/components/settings/PhoneMirrorSettings.tsx',
    'src/components/settings/connectors/parts.tsx',
    'src/components/settings/AIProvidersSettings.tsx',
    'src/components/settings/EmbeddingSettings.tsx',
    'src/components/settings/RerankerSettings.tsx',
  ];
  for (const f of files) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(code, /text-(sm|lg) font-bold (text-text-primary|mb-0 aip-hero|aip-hero)/, f);
  }
});
