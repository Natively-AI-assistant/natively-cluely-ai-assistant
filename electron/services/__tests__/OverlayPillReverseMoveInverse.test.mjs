// On X11 the overlay group ran away down the screen (~7000 px/s, even hidden):
// the pill 'move' handler's reverse placement was not the inverse of
// positionPillWindow's forward placement, so each async pill↔overlay round trip
// shifted the overlay by OVERLAY_PANEL_INSET.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(__dirname, '../../WindowHelper.ts'), 'utf8');

test('pill reverse placement is the exact inverse of the forward placement', () => {
  const forward = src.match(/const idealY = o\.y \+ OVERLAY_PANEL_INSET - WindowHelper\.PILL_GAP - ph;/);
  assert.ok(forward, 'fixture: forward placement anchors on the panel top');
  const handler = src.slice(src.indexOf("this.pillWindow.on('move'"), src.indexOf('overlay.setPosition(targetX, targetY);'));
  // Inverting idealY gives o.y = p.y + ph + PILL_GAP - OVERLAY_PANEL_INSET.
  assert.match(handler, /const targetY = p\.y \+ p\.height \+ WindowHelper\.PILL_GAP - OVERLAY_PANEL_INSET;/);
});
