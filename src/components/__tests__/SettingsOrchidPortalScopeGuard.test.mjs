/**
 * SettingsOrchidPortalScopeGuard.test.mjs
 *
 * Regression guard for the Soft Orchid Settings rebrand (2026-07).
 *
 * THE RISK THIS PINS: the orchid accent is delivered by scoping CSS custom
 * properties to a DOM subtree — `[data-settings-theme="orchid"]` on the main
 * Settings modal root, `.pi-root` for Profile Intelligence, `.modes-manager-root`
 * for the Modes Manager. Custom-property resolution follows normal DOM
 * ancestry, so any element rendered via `createPortal(..., document.body)`
 * (or an equivalent escape hatch — a Radix UI Select/Popover/Tooltip/Dialog,
 * which portal by default) would mount OUTSIDE these scoped subtrees and
 * silently fall back to the root (blue) tokens. There is no runtime error —
 * it just renders the wrong color, which is easy to miss in review.
 *
 * At the time of the rebrand, none of these files used portals. This test
 * keeps it that way: it fails loudly the moment a portal is introduced,
 * forcing whoever adds one to either propagate the scope attribute onto the
 * portal container or consciously update this guard.
 *
 * Run: `node --test src/components/__tests__/SettingsOrchidPortalScopeGuard.test.mjs`
 * (no build step required — pure source-text scan)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');

// Every file whose DOM subtree relies on one of the orchid-scoped selectors
// ([data-settings-theme="orchid"], .pi-root, .modes-manager-root) resolving
// its CSS custom properties via normal ancestry.
const GUARDED_FILES = [
  'src/components/SettingsOverlay.tsx',
  'src/components/settings/AIProvidersSettings.tsx',
  'src/components/settings/ProviderCard.tsx',
  'src/components/settings/HelpSettings.tsx',
  'src/components/settings/HowItWorksRefund.tsx',
  'src/components/settings/IntelligenceSettings.tsx',
  'src/components/settings/NativelyApiSettings.tsx',
  'src/components/settings/NativelyProSettings.tsx',
  'src/components/settings/PhoneMirrorSettings.tsx',
  'src/components/settings/PlansSettings.tsx',
  'src/components/settings/Sidebar.tsx', // dead code (unused, zero imports) — covered in case it's ever revived
  'src/components/settings/SkillsSettings.tsx',
  'src/components/settings/ModesSettings.tsx',
  'src/components/settings/VisionModelBenchmark.tsx',
  'src/components/LocalWhisperModelPanel.tsx',
  'src/components/ProfileIntelligenceSettings.tsx',
  'src/components/ui/AccordionSection.tsx', // shared disclosure primitive used by several guarded files above
  'premium/src/ModesSettings.tsx',
  'premium/src/PremiumUpgradeModal.tsx',
  'premium/src/ProfileVisualizer.tsx',
];

// Portal signatures to detect. `createPortal` covers the direct React API;
// the Radix import covers its portal-by-default primitives (Select, Popover,
// Tooltip, Dialog, DropdownMenu, ContextMenu, HoverCard) even if the call
// site never spells "Portal" explicitly.
const PORTAL_SIGNATURES = [
  /createPortal\s*\(/,
  /from\s+['"]react-dom['"]/,
  /@radix-ui\/react-(select|popover|tooltip|dialog|dropdown-menu|context-menu|hover-card)/,
];

// This file's own header intentionally documents `createPortal` in prose —
// exclude comment-only mentions by stripping // and /* */ comments before
// scanning, so the guard tests real usage, not documentation about itself.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('Soft Orchid Settings — portal scope guard', () => {
  for (const relPath of GUARDED_FILES) {
    test(`${relPath} has no portal-rendered content escaping its orchid scope`, () => {
      let source;
      try {
        source = readFileSync(resolve(REPO_ROOT, relPath), 'utf8');
      } catch (err) {
        if (err.code === 'ENOENT') {
          // premium/ is a submodule; some checkouts (source-available builds)
          // may not have it present. Absence is not a portal violation.
          return;
        }
        throw err;
      }

      const scanned = stripComments(source);
      for (const sig of PORTAL_SIGNATURES) {
        assert.equal(
          sig.test(scanned),
          false,
          `${relPath} matches portal signature ${sig} — if you've added a ` +
          `portal-rendered element (createPortal, or a Radix primitive that ` +
          `portals by default), it will render OUTSIDE this file's orchid ` +
          `scope and silently fall back to blue. Propagate the scope ` +
          `attribute/class onto the portal container, then update this guard.`
        );
      }
    });
  }

  test('guard file list is not stale — settings/*.tsx on disk matches GUARDED_FILES', () => {
    const settingsDir = resolve(REPO_ROOT, 'src/components/settings');
    const onDisk = readdirSync(settingsDir)
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => `src/components/settings/${f}`)
      .sort();
    const guarded = GUARDED_FILES
      .filter((f) => f.startsWith('src/components/settings/'))
      .sort();
    assert.deepEqual(
      onDisk,
      guarded,
      'A file was added to or removed from src/components/settings/ without ' +
      'updating GUARDED_FILES above — every Settings-tab component consumes ' +
      'the orchid-scoped tokens and needs portal coverage.'
    );
  });
});
