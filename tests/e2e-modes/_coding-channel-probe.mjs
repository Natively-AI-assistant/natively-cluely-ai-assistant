// tests/e2e-modes/_coding-channel-probe.mjs
//
// REAL-APP round-trip for the two coding channels previously verified only at
// prompt-composition level (channel audit, .audit/coding-template-audit-2026-08-18.md):
//   A. chat-attach — a screenshot of a coding stub attached in MANUAL CHAT with
//      a deictic ask ("solve this") → must return code written INTO the stub;
//   B. cross-surface follow-up — a real WTA answer, then "what is the time and
//      space complexity" typed in chat → must anchor to THAT problem;
//   C. control — a sales question in chat → no code dump.
//
// Launches the actual Electron main process (dist-electron), drives the actual
// preload API (`streamGeminiChat`, `gemini-stream-token`), spends real Gemini
// quota. Run: node tests/e2e-modes/_coding-channel-probe.mjs

import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

// ── render the stub screenshot the user would attach ────────────────────────
const STUB = `42. Trapping Rain Water

Given n non-negative integers representing an elevation map where
the width of each bar is 1, compute how much water it can trap.

Example: height = [0,1,0,2,1,0,1,3,2,1,2,1]  ->  6

class Solution:
    def trap(self, height: List[int]) -> int:
        `;
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const lines = STUB.split('\n');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="${140 + lines.length * 28}">
  <rect width="100%" height="100%" fill="#1e1e1e"/>
  ${lines.map((l, i) => `<text x="36" y="${60 + i * 28}" font-family="Menlo, monospace" font-size="19" fill="#d4d4d4" xml:space="preserve">${esc(l)}</text>`).join('\n')}
</svg>`;
const stubPng = path.join(ROOT, 'benchmarks/coding-contract/_probe-stub.png');
fs.writeFileSync(stubPng, await sharp(Buffer.from(svg)).png().toBuffer());

// ── launch the real app ─────────────────────────────────────────────────────
const env = {
  ...process.env,
  NATIVELY_E2E: '1',
  NODE_ENV: 'development',
  NATIVELY_DEV_BYPASS_SCREEN_TCC: '1',
  NATIVELY_E2E_LOCAL_TEST_TOKEN: 'local-test',
  OLLAMA_URL: 'http://127.0.0.1:1',
};
const app = await electron.launch({ args: ['dist-electron/electron/main.js'], env, timeout: 60000, cwd: ROOT });
const win = await app.firstWindow({ timeout: 30000 });
await win.waitForLoadState('domcontentloaded').catch(() => {});
const page = () => app.windows()[0];

// The real renderer chat transport: invoke gemini-chat-stream and collect the
// gemini-stream-token / gemini-stream-done events exactly as the chat panel does.
const chat = (message, imagePaths) => page().evaluate(async ({ message, imagePaths }) => {
  const api = window.electronAPI || window.api;
  return await new Promise((resolve) => {
    let text = '';
    let done = false;
    const offTok = api.onGeminiStreamToken((token) => { text += token; });
    const offDone = api.onGeminiStreamDone
      ? api.onGeminiStreamDone(() => { if (!done) { done = true; setTimeout(() => resolve(text), 300); } })
      : null;
    // Fallback settle: resolve when tokens stop flowing for 4s.
    let last = Date.now();
    const iv = setInterval(() => {
      if (text.length) last = last; // updated below
    }, 500);
    const origLen = { v: 0 };
    const settle = setInterval(() => {
      if (text.length > origLen.v) { origLen.v = text.length; last = Date.now(); }
      else if (text.length > 0 && Date.now() - last > 4000 && !done) { done = true; resolve(text); }
      else if (Date.now() - last > 90000) { done = true; resolve(text); }
    }, 500);
    api.streamGeminiChat(message, imagePaths, undefined, undefined)
      .then(() => { setTimeout(() => { if (!done) { done = true; resolve(text); } }, 1500); })
      .catch((e) => { if (!done) { done = true; resolve(text || `__ERROR__ ${e?.message || e}`); } })
      .finally(() => { clearInterval(iv); setTimeout(() => clearInterval(settle), 100); });
  });
}, { message, imagePaths });

const results = [];
const grade = (id, text, checks) => {
  const failures = [];
  for (const [label, ok] of checks) if (!ok) failures.push(label);
  results.push({ id, pass: failures.length === 0, failures, sample: text.slice(0, 200) });
  console.log(`  ${failures.length ? 'FAIL' : 'PASS'}  ${id}${failures.length ? '  → ' + failures.join('; ') : ''}  (${text.length} chars)`);
};

try {
  await page().evaluate(async () => (window.electronAPI || window.api).e2eInvoke('__e2e__:enable-pro')).catch(() => {});

  // ── A. chat-attach: stub screenshot + deictic ask ─────────────────────────
  const a = await chat('solve this', [stubPng]);
  grade('A chat-attach: stub + "solve this"', a, [
    ['no code fence', /```/.test(a)],
    ['did not use the stub signature', /def\s+trap\s*\(\s*self\s*,\s*height/.test(a)],
    ['asked for the problem instead', !/provide the (problem|function|image)/i.test(a)],
  ]);

  // ── B. real WTA answer, then a chat follow-up ─────────────────────────────
  const wta = await page().evaluate(async () => (window.electronAPI || window.api).e2eInvoke('__e2e__:ask', {
    question: 'Solve the trapping rain water problem in python',
    timeoutMs: 60000,
  }));
  console.log(`  (seed WTA: success=${wta?.success} len=${(wta?.answer || '').length})`);
  const b = await chat('what is the time and space complexity', undefined);
  grade('B follow-up after WTA: complexity', b, [
    ['no O(...) bound', /O\(/.test(b)],
    ['did not anchor to trapping water', /trap|water|height|two.?pointer/i.test(b)],
    ['asked which problem', !/which (problem|solution)|provide the/i.test(b)],
  ]);

  // ── C. control: sales question stays prose ────────────────────────────────
  const c = await chat('what should I say to a customer who says we are too expensive', undefined);
  grade('C control: sales question', c, [
    ['code fence appeared on a sales turn', !/```/.test(c)],
  ]);
} finally {
  await app.close().catch(() => {});
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n[coding-channel-probe] ${passed}/${results.length} pass (REAL app, real IPC, real model)`);
if (passed !== results.length) {
  for (const r of results.filter((x) => !x.pass)) console.log(`  ${r.id}: ${r.sample}`);
}
process.exit(passed === results.length ? 0 : 1);
