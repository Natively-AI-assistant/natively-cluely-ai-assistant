// src/components/__tests__/VoiceChipSpeak2026_10_30.test.mjs
//
// The voice button reads Speak, not Answer (the owner, 2026-10-30: "Answer"
// sat beside "What to answer?"). The overlay, Settings › Overlay (its preview
// and tray) and the phone's chip all say it. The overlay and Settings read the
// word from one list, so they can't drift: Settings › Overlay still said
// Answer after the overlay had changed.
//
// Source reads only. The phone chip is driven in a real browser by
// tests/phone-mirror (the 'recording' scenario). No platform branch.
//
// Run: node --test src/components/__tests__/VoiceChipSpeak2026_10_30.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('the shared button list names it Speak', () => {
  assert.match(read('src/components/overlay/overlayButtons.ts'), /answer: \{ Icon: Mic, label: 'Speak' \},/);
});

test('the overlay draws its label and its sizer from that list', () => {
  const overlay = read('src/components/NativelyInterface.tsx');
  assert.match(overlay, /const answerLabel = t\(OVERLAY_BUTTONS\.answer\.label\);/);
  assert.match(overlay, /\{ghost\(answerLabel\)\}/);
  assert.doesNotMatch(overlay, /t\('Answer'\)|t\('Speak'\)/);
});

test('Settings › Overlay draws every chip, and its labels, from that list', () => {
  assert.match(read('src/components/settings/OverlayMockup.tsx'), /const \{ Icon, label \} = OVERLAY_BUTTONS\[id\];/);
  assert.match(read('src/components/settings/OverlaySettings.tsx'), /t\(OVERLAY_BUTTONS\[id\]\.label\)/);
});

test('the phone chip reads Speak, and the word has its translations', () => {
  const phone = read('electron/services/phoneMirrorClient.ts');
  assert.match(phone, /data-action="answer">Speak<\/button>/);
  assert.match(phone, /answerChip\.textContent = recording \? 'Stop' : 'Speak';/);
  assert.match(read('src/i18n.onboarding.ts'), /'Speak': \['Сказать', '说话', '話す', 'Hablar'\],/);
});
