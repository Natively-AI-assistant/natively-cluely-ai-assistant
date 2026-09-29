#!/usr/bin/env node
// scripts/manual-chat-live-check.mjs
//
// Live check of the MANUAL-CHAT coding path against a real provider.
// Replicates what ipcHandlers.ts does for a chat message: router verdict ->
// buildV3Prompt with the real personaBase callback -> provider -> grade.
//
// MUST run under the Electron runner: native modules (better-sqlite3) are built
// for Electron's ABI, so plain `node` fails with NODE_MODULE_VERSION 148 vs 141.
//
//   ELECTRON_RUN_AS_NODE=1 npx electron scripts/manual-chat-live-check.mjs
//
// Optional: pass your own questions.
//   ELECTRON_RUN_AS_NODE=1 npx electron scripts/manual-chat-live-check.mjs "Reverse a linked list."
//
// Reads DEEPSEEK_API_KEY from .env. NOTE: the value is quoted in .env — the
// quotes must be stripped or DeepSeek returns "Authentication Fails".

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const D = path.join(ROOT, 'dist-electron/electron');

const { planAnswer, isCodingAnswerType } = await import(`${D}/llm/index.js`);
const { buildV3Prompt } = await import(`${D}/context-intelligence/orchestration/engine-bridge.js`);
const { resolveV2SystemPrompt, v2TierForPromptTier } = await import(`${D}/llm/promptSystemV2.js`);

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(),
               l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
const KEY = env.DEEPSEEK_API_KEY;
if (!KEY) { console.error('DEEPSEEK_API_KEY missing from .env'); process.exit(1); }

// EXACT mirror of ipcHandlers.ts — the six-section contract is injected by THIS
// callback, not by `codingTask` alone. Omit it and every prompt looks empty.
const personaBase = ({ codingTask }) => resolveV2SystemPrompt({
  action: 'answer', tier: v2TierForPromptTier(undefined),
  activeMode: undefined, codingTask, chatSurface: true,
});

const DEFAULTS = [
  'Write a BFS shortest-path function for an unweighted graph in Python.',
  'Given a binary tree, return its level order traversal.',
  'Detect a cycle in a directed graph.',
  'Find the longest substring without repeating characters.',
  'Show a Makefile rule using $@ and $<.',
  'Tell me about a time you failed.',
];
const QUESTIONS = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULTS;
const SECTIONS = ['Approach', 'Technique', 'Code', 'Dry Run', 'Complexity', 'Interviewer Follow-up'];

for (const q of QUESTIONS) {
  const plan = planAnswer({ question: q, source: 'manual_input', speakerPerspective: 'user' });
  const codingTask = isCodingAnswerType(plan.answerType);

  const composed = await buildV3Prompt({
    surface: 'manual-chat', question: q, codingTask, personaBase,
    requestId: 'live-check',
    // Fresh session per question: otherwise turn N inherits turn N-1's topic.
    scope: { userId: 'live-check', sessionId: `s-${Math.random()}` },
  });

  const t0 = Date.now();
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: 'deepseek-chat', max_tokens: 1600, temperature: 0.2,
      messages: [
        { role: 'system', content: composed.system },
        { role: 'user', content: composed.user || q },
      ],
    }),
  });
  const json = await res.json();
  const answer = json?.choices?.[0]?.message?.content;
  if (!answer) { console.log(`ERROR  ${q}\n  ${JSON.stringify(json).slice(0, 200)}`); continue; }

  const have = SECTIONS.filter(s => answer.includes(s));
  const placeholder = /O\(\?\)/.test(answer);
  const tokenLeak = /__CODE|FENCE\d||||/.test(answer);
  const bigO = /O\([^)]{1,24}\)/.exec(answer);

  console.log(`\n=== ${q}`);
  console.log(`    router      : ${plan.answerType}  codingTask=${codingTask}`);
  console.log(`    prompt      : ${composed.system.length} chars`);
  console.log(`    answer      : ${answer.length} chars in ${Date.now() - t0}ms`);
  console.log(`    sections    : ${have.length}/6 ${codingTask ? (have.length === 6 ? 'OK' : 'MISSING ' + SECTIONS.filter(s => !have.includes(s)).join(', ')) : '(not a coding turn — expected)'}`);
  console.log(`    complexity  : ${bigO ? bigO[0] : 'none'}${placeholder ? '   <-- O(?) PLACEHOLDER BUG' : ''}`);
  if (tokenLeak) console.log('    TOKEN LEAK  : internal placeholder reached the answer');
}
