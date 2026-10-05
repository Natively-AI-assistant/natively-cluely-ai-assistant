// electron/services/__tests__/ModeTemplateGalleryCoverage2026_09_16.test.mjs
//
// Bug (2026-09-16): the Modes Manager "Templates" gallery offered six
// templates while the app ships nine built-ins. Seminar (8th, 2026-07-19) and
// Call Center (9th, 2026-08-23) were added to the backend — BUILTIN_MODE_LABELS,
// TEMPLATE_NOTE_SECTIONS, the prompts, the source contract — but never to the
// renderer's hand-maintained copies in premium/src/ModesSettings.tsx, so a user
// could not create either mode from the gallery, and a custom mode's template
// <select> could not display or pick them.
//
// The renderer cannot import the backend module (premium/src is bundled into the
// renderer; electron/services is main-process), so the lists are duplicated by
// design. This pins them together: every built-in except General (which the
// gallery offers as "Start from empty mode") must appear in the renderer's
// TemplateType union, TEMPLATES, TEMPLATE_DEFAULTS and context placeholders.
//
// TEMPLATE_DEFAULTS is only checked for KEYS: nothing in the renderer reads it
// (the backend's TEMPLATE_NOTE_SECTIONS is what seeds a new mode), and its
// General / Team Meet titles already predate the backend's current ones.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = (p) => fs.readFileSync(path.resolve(repoRoot, p), 'utf8');

const builtinSrc = read('electron/services/builtinModes.ts');
const rendererSrc = read('premium/src/ModesSettings.tsx');

/** The text between `startMarker` and the first `endMarker` after it. */
function block(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, `marker not found: ${startMarker}`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.ok(end >= 0, `end marker not found after: ${startMarker}`);
  return src.slice(start + startMarker.length, end);
}

/** Top-level keys of an object literal whose values are `[ ... ]` or strings. */
function keysOf(body) {
  return [...body.matchAll(/^\s+'?([a-z-]+)'?\s*:/gm)].map((m) => m[1]);
}

/** Template keys of a `Record<TemplateType, Array<...>>` body (4-space top level). */
function arrayKeysOf(body) {
  return [...body.matchAll(/^\s{4}'?([a-z-]+)'?\s*:\s*\[/gm)].map((m) => m[1]);
}

const builtins = [...block(builtinSrc, 'export const BUILTIN_MODE_LABELS = {', '} as const;')
  .matchAll(/^\s+'([a-z-]+)'\s*:/gm)].map((m) => m[1]);
const galleryExpected = builtins.filter((t) => t !== 'general');

describe('Modes Manager template gallery covers every built-in template', () => {
  test('backend list parsed (guards against a vacuous pass)', () => {
    assert.ok(builtins.includes('seminar') && builtins.includes('call-center') && builtins.length >= 9,
      `parsed built-ins: ${builtins.join(', ')}`);
  });

  test('renderer TemplateType union includes every built-in', () => {
    const union = [...block(rendererSrc, 'type TemplateType =', ';').matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    assert.deepEqual([...union].sort(), [...builtins].sort());
  });

  test('TEMPLATES gallery offers every built-in except General', () => {
    const body = block(rendererSrc, 'const TEMPLATES: Array<{', '\n];');
    const types = [...body.matchAll(/type:\s*'([a-z-]+)'/g)].map((m) => m[1]).filter((t) => t !== 'TemplateType');
    assert.deepEqual([...types].sort(), [...galleryExpected].sort());
  });

  test('TEMPLATE_DEFAULTS has an entry for every built-in', () => {
    const renderer = arrayKeysOf(block(rendererSrc,
      'const TEMPLATE_DEFAULTS: Record<TemplateType, Array<{ title: string; description: string }>> = {', '\n};'));
    assert.deepEqual(renderer.sort(), [...builtins].sort());
  });

  // The notes Summary leads with a mode's defining section, looked up BY TITLE
  // (MeetingSummaryReducer MODE_HEADLINE_SECTIONS). Seminar shipped naming
  // 'Core concepts' / 'Open questions' — titles its seeded sections don't have —
  // so its Summary silently fell through to the generic shape.
  //
  // Scoped to the two templates this file is about: 'looking-for-work' also names
  // a 'Role fit' it doesn't seed (its 'Next steps' still matches), which predates
  // them and changes a shipped mode's Summary if fixed, so it is reported instead.
  test('Seminar and Call Center headline titles exist in their note sections', () => {
    const managerSrc = read('electron/services/ModesManager.ts');
    const reducerSrc = read('electron/services/meeting/MeetingSummaryReducer.ts');
    const sections = {};
    const body = block(managerSrc,
      'export const TEMPLATE_NOTE_SECTIONS: Record<ModeTemplateType, Array<{ title: string; description: string }>> = {', '\n};');
    for (const m of body.matchAll(/^\s{4}'?([a-z-]+)'?\s*:\s*\[([\s\S]*?)^\s{4}\],/gm)) {
      sections[m[1]] = [...m[2].matchAll(/title:\s*'([^']*)'/g)].map((t) => t[1]);
    }
    const headlines = block(reducerSrc, 'const MODE_HEADLINE_SECTIONS: Record<string, string[]> = {', '\n};');
    const pairs = [...headlines.matchAll(/^\s+'?([a-z-]+)'?\s*:\s*\[([^\]]*)\]/gm)];
    assert.ok(pairs.length >= 8, `parsed ${pairs.length} headline entries`);
    const checked = pairs.filter(([, t]) => t === 'seminar' || t === 'call-center');
    assert.equal(checked.length, 2, 'seminar and call-center headline entries present');
    for (const [, t, list] of checked) {
      for (const [, title] of list.matchAll(/'([^']*)'/g)) {
        assert.ok(sections[t]?.includes(title), `'${t}' headline '${title}' is not one of its note sections: ${JSON.stringify(sections[t])}`);
      }
    }
  });

  test('every built-in has a context placeholder', () => {
    const body = block(rendererSrc, 'const map: Record<TemplateType, string> = {', '\n    };');
    assert.deepEqual(keysOf(body).sort(), [...builtins].sort());
  });
});
