#!/usr/bin/env node
/**
 * Feedback loop: "I don't see where to open the hotkeys list."
 *
 * Asserts the discoverability path still exists in source:
 *   1. Launcher exposes a Settings control that calls onOpenSettings
 *   2. SettingsOverlay sidebar has a Keybinds tab (Keyboard icon + setActiveTab('keybinds'))
 *   3. Keybinds panel renders "Keyboard shortcuts" heading
 *
 * RED = path missing/broken in source (user can't reach hotkeys list).
 * GREEN = path present — if user still can't find it, it's discovery/UX, not a missing control.
 *
 *   node scripts/diag-hotkeys-entry-point.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const launcher = fs.readFileSync(path.join(root, 'src/components/Launcher.tsx'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'src/components/SettingsOverlay.tsx'), 'utf8');

const checks = [
  {
    id: 'launcher-settings-button',
    ok:
      /title=\{t\(["']Settings["']\)\}/.test(launcher) &&
      /onOpenSettings\(\)/.test(launcher) &&
      /<Settings\b/.test(launcher),
    detail: 'Launcher Settings gear → onOpenSettings()',
  },
  {
    id: 'settings-keybinds-tab',
    ok:
      /setActiveTab\(['"]keybinds['"]\)/.test(settings) &&
      /\{t\(['"]Keybinds['"]\)\}/.test(settings) &&
      /<Keyboard\b/.test(settings),
    detail: "Settings sidebar tab Keybinds (Keyboard icon)",
  },
  {
    id: 'keybinds-panel-heading',
    ok:
      /activeTab === ['"]keybinds['"]/.test(settings) &&
      /\{t\(['"]Keyboard shortcuts['"]\)\}/.test(settings),
    detail: "Keybinds panel heading 'Keyboard shortcuts'",
  },
  {
    id: 'no-direct-launcher-hotkeys-button',
    // Document whether a ONE-CLICK launcher "Hotkeys" control exists.
    // Absence is not RED by itself — Settings path is the supported entry.
    ok: true,
    detail: /Hotkeys|Keybinds|Keyboard shortcuts/.test(launcher)
      ? 'Launcher also mentions hotkeys/keybinds inline'
      : 'No dedicated Hotkeys button on Launcher (must use Settings → Keybinds)',
  },
];

let red = false;
console.log('[diag-hotkeys] entry-point checks:');
for (const c of checks) {
  const status = c.ok ? 'PASS' : 'FAIL';
  if (!c.ok) red = true;
  console.log(`  ${status}  ${c.id} — ${c.detail}`);
}

if (red) {
  console.log(
    '[diag-hotkeys] RED — hotkeys list entry path missing/broken in source (user symptom: nowhere to click for hotkeys)',
  );
  process.exitCode = 1;
} else {
  console.log(
    '[diag-hotkeys] GREEN — Settings gear → Keybinds tab path exists. If user still cannot find it, label as discoverability (not a missing control).',
  );
  process.exitCode = 0;
}
