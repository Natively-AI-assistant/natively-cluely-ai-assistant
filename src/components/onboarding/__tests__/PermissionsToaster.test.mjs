/**
 * PermissionsToaster.test.mjs
 *
 * Source-level tests for the permissions onboarding card. This project runs
 * `node --test` with no JSX renderer, so the component is read as text and
 * its contracts asserted directly. Which rows show, and what each one says,
 * is permissionRowPolicy's job and is covered in src/lib/__tests__/.
 *
 * What these pin is how the card opens and closes: through GenieModal, like
 * every other popup, pouring one picture of itself instead of dozens of live
 * copies of its DOM, with its pictures kept per permission state.
 *
 * Run: node --test src/components/onboarding/__tests__/PermissionsToaster.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\n]*?\/\/[^\n]*$/gm, '');
const source = readFileSync(resolve(__dirname, '../PermissionsToaster.tsx'), 'utf8');
const rendered = stripComments(source);
const modal = stripComments(readFileSync(resolve(__dirname, '../../ui/GenieModal.tsx'), 'utf8'));
const snapshots = stripComments(readFileSync(resolve(__dirname, '../genieSnapshots.ts'), 'utf8'));

test('pours out of one picture of itself, like every other popup', () => {
  // useGenieCard on its own has no pictures, so it pours dozens of live copies
  // of the card (49 copies, 3,136 nodes on macOS), which replay the card's
  // entrance and arrive empty. GenieModal hands it the pictures.
  assert.ok(source.includes("import { GenieModal } from '../ui/GenieModal';"));
  assert.ok(rendered.includes('<GenieModal') && rendered.includes('label="PermissionsToaster"'));
  assert.ok(!/useGenieCard/.test(rendered), 'no direct hook: that is the live-copy genie');
  assert.ok(modal.includes('const genie = useGenieCard(presence.mounted, label, {') && modal.includes('    snapshots,'),
    'GenieModal gives the hook its pictures');
});

test('pictures are kept per permission state', () => {
  // What the card shows is decided by the statuses, so a picture of one state
  // must never pour out when the card opens in another.
  const view = rendered.match(/const genieView = `([^`]*)`;/);
  assert.ok(view, 'the view is built from the statuses');
  for (const part of ['${platform}', '${micStatus}', '${isMac ? scrStatus :']) {
    assert.ok(view[1].includes(part), part);
  }
  assert.ok(rendered.includes('openingView={genieView}'), 'the open looks up this state, not the last one remembered');
  assert.ok(rendered.includes("'data-genie-view': genieView"), 'pictures taken while open are filed under this state');
  assert.ok(snapshots.includes("const own = card.getAttribute('data-genie-view');"),
    'viewOf reads the card\'s own attribute first');
  // A picture taken while the consent prompt is up shows a spinner.
  assert.ok(rendered.includes('keepPictures={requesting === null}'));
});

test('opens once the statuses are read, and every way out reports after the genie', () => {
  assert.ok(rendered.includes('refreshStatus().then(() => setReady(true));'));
  assert.ok(rendered.includes('open={ready}'));
  const closeThen = rendered.slice(rendered.indexOf('const closeThen'), rendered.indexOf('const colors'));
  assert.ok(closeThen.includes('if (afterCloseRef.current) return;'), 'the first way out wins');
  assert.ok(closeThen.includes('setReady(false);'));
  assert.ok(!/after\s*\(/.test(closeThen), 'closeThen only schedules the report');
  assert.ok(rendered.includes('onClosed={() => { const after = afterCloseRef.current; afterCloseRef.current = null; after?.(); }}'));
  // The host unmounts the card the moment it hears onDismiss.
  const dismiss = rendered.slice(rendered.indexOf('const handleDismiss'), rendered.indexOf('const isMac'));
  assert.ok(/closeThen\(\(\) => \{\s*localStorage\.setItem\(STORAGE_KEY, '1'\);\s*onDismiss\(\);\s*\}\);/.test(dismiss));
  assert.ok(rendered.includes('onBackdropClick={handleDismiss}'));
  assert.ok(modal.includes("pointerEvents: closing ? 'none' : 'auto'"), 'clicks pass through while it drains away');
});

test('the genie pours the card out whole: nothing inside animates in on top of it', () => {
  assert.ok(rendered.includes('const enter = reduced || landed;'));
  assert.ok(rendered.includes('onOpened={() => setLanded(true)}'), 'content that arrives after landing still animates in');
  assert.ok(rendered.includes('if (!isOpen) { setReady(false); setLanded(false); return; }'));
  // Every entrance in the file waits on `enter`.
  const initials = [...rendered.matchAll(/initial=\{([^\n]*)/g)].map(m => m[1]);
  assert.ok(initials.length >= 6, `found ${initials.length} entrances`);
  for (const i of initials) {
    assert.ok(/^(enter \?|!enter \?)/.test(i), `ungated entrance: initial={${i}`);
  }
  const rise = rendered.slice(rendered.indexOf('const rise = (delay: number) =>'), rendered.indexOf('return (', rendered.indexOf('const rise')));
  assert.ok(rise.includes('!enter') && rise.includes('initial: false as const'), 'the guide steps too');
});

test('both platforms keep their layout', () => {
  // Windows: microphone only, no macOS guide, a narrower card with its close
  // in the corner. None of that moves with the genie.
  assert.ok(rendered.includes("const CARD_W = isMac ? '600px' : '420px';"));
  assert.ok(rendered.includes("wrapStyle={{ width: CARD_W, maxWidth: '92vw' }}"));
  assert.ok(rendered.includes('{!isMac && ('), 'Windows keeps its corner close');
  assert.ok(rendered.includes('{isMac && (\n        <PermItem'), 'the screen row is macOS only');
  assert.ok(/\{isMac && \(\s*<motion\.div[\s\S]{0,200}flex: '0 0 40%'/.test(rendered), 'the guide is macOS only');
});

test('dialog semantics', () => {
  assert.ok(rendered.includes("role: 'dialog'"));
  assert.ok(rendered.includes("'aria-modal': true"));
  assert.ok(rendered.includes("'aria-labelledby': 'perm-toast-title'") && rendered.includes('id="perm-toast-title"'));
  assert.ok(rendered.includes("'aria-describedby': 'perm-toast-desc'") && rendered.includes('id="perm-toast-desc"'));
});
