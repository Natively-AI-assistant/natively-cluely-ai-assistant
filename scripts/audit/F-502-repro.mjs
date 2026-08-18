// F-502 repro: manual and phone chat never pinned the mode, so a mid-request
// `modes:set-active` could leak another mode's documents into the answer.
//
// streamContextPolicy documents pinnedModeId as exactly this defence:
//   "Without this pin, a mid-request `modes:set-active` could leak a different
//    mode's document content into an answer the contract declares is scoped to
//    the first mode."
// The ONLY producers were WhatToAnswerLLM (the live/WTA path). Desktop manual
// chat and phone-mirror chat both built StreamRouteOptions without it, so every
// mode read inside streamChat after an await resolved the LIVE ModesManager
// singleton. The phone surface is the worse half: unlike desktop it never
// registers in _chatStreamsBySender, so modes:set-active does not abort it
// either — it has neither the pin nor the abort.
//
// Static contract check over the two producers plus the consumer.
// Expected (correct): both surfaces pass a t0-captured pinnedModeId → exit 0.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const src = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
const helper = fs.readFileSync(path.join(root, 'electron/LLMHelper.ts'), 'utf8');

let bad = false;

// The consumer must still honour the pin (otherwise pinning is theatre).
if (!/routeOptions\?\.pinnedModeId\s*\?\?\s*null/.test(helper)) {
  console.error('[F-502] LLMHelper no longer reads routeOptions.pinnedModeId'); bad = true;
}

// Desktop manual chat. Scan EVERY StreamRouteOptions literal built from
// answerPlan and require at least one to carry the t0 pin (comments between
// the fields make a fixed-width window unreliable).
const deskBlocks = [];
for (let i = src.indexOf('answerType: answerPlan.answerType,'); i !== -1;
     i = src.indexOf('answerType: answerPlan.answerType,', i + 1)) {
  deskBlocks.push(src.slice(i, i + 1600));
}
const deskBlock = deskBlocks.join('\n');
if (!/pinnedModeId:\s*manualActiveMode\?\.id\s*\?\?\s*null/.test(deskBlock)) {
  console.error('[F-502] desktop manual chat does not pin the t0 mode id'); bad = true;
} else {
  console.log('[F-502] desktop manual chat pins manualActiveMode.id');
}

// Phone-mirror chat.
if (!/phonePinnedModeId\s*=\s*phoneModeInfo\?\.id\s*\?\?\s*null/.test(src)) {
  console.error('[F-502] phone path does not capture a mode id at t0'); bad = true;
} else {
  console.log('[F-502] phone path captures phonePinnedModeId at t0');
}
const roIdx = src.indexOf('phoneRouteOptions = {');
const roBlock = roIdx === -1 ? '' : src.slice(roIdx, roIdx + 500);
if (!/pinnedModeId:\s*phonePinnedModeId/.test(roBlock)) {
  console.error('[F-502] phone StreamRouteOptions does not carry the pin'); bad = true;
} else {
  console.log('[F-502] phone StreamRouteOptions carries the pin');
}

// The capture must happen BEFORE the provider call it protects.
const capIdx = src.indexOf('phonePinnedModeId: string | null = null');
const streamIdx = src.indexOf('llmHelper.streamChat(message, undefined, context');
if (capIdx === -1 || streamIdx === -1 || capIdx > streamIdx) {
  console.error('[F-502] the phone pin is not captured before the stream starts'); bad = true;
}

if (bad) { console.error('[F-502] FAIL (F-502 reproduced).'); process.exit(1); }
console.log('[F-502] PASS: both manual-chat surfaces pin the t0 mode, and the consumer still honours it.');
process.exit(0);
