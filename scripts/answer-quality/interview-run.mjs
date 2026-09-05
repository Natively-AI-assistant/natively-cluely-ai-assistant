#!/usr/bin/env node
// scripts/answer-quality/interview-run.mjs
//
// Evin's test: a real continuous interview, not isolated questions.
//
// This matters and the isolated-question test could not show it. In a real
// interview context ACCUMULATES. Turn nine only makes sense against turns one
// through eight, and that is exactly where the classifier is most handicapped:
// tiers 1 and 2 see `lastInterviewerTurn` and nothing else, while the model
// receiving their verdict sees the whole transcript.
//
// So an isolated-question benchmark is the classifier's best case. This is its
// real one.
//
// Input: transcript.txt, one turn per line, prefixed INTERVIEWER: or CANDIDATE:
// Styled as the STT actually emits, which is no punctuation and no casing.
//
// For each interviewer turn that needs an answer, generate twice against the
// SAME accumulated history:
//
//   with_intent     the real classifier runs, and its answer shape is injected
//   without_intent  no shape, the model reads the transcript itself
//
// Then judge blind.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const API = process.env.NATIVELY_API_URL || 'http://127.0.0.1:8788';
const KEY = fs.readFileSync(path.join(repoRoot, '.env'), 'utf8')
  .split('\n').find((l) => l.startsWith('NATIVELY_API_KEY=')).split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');

// The REAL classifier, out of the compiled bundle. Not a reimplementation.
process.resourcesPath ||= path.join(repoRoot, 'resources');
const IC = await import(pathToFileURL(path.join(repoRoot, 'dist-electron/electron/llm/IntentClassifier.js')).href);

const lines = fs.readFileSync(path.join(__dirname, 'transcript.txt'), 'utf8')
  .split('\n').map((l) => l.trim()).filter(Boolean);

async function generate(history, question, shape) {
  const shapeLine = shape ? `\n\nANSWER SHAPE: ${shape}` : '';
  const content = `You are helping a candidate in a live software engineering interview. They are reading your answer off a screen while speaking, so it must be usable out loud.

INTERVIEW SO FAR:
${history.join('\n')}

The interviewer just asked: "${question}"${shapeLine}

Give the candidate what to say.`;
  const r = await fetch(`${API}/v1/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-natively-key': KEY },
    body: JSON.stringify({ messages: [{ role: 'user', content }] }),
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return (await r.json()).content ?? '';
}

const history = [];
const rows = [];
for (const line of lines) {
  const m = /^(INTERVIEWER|CANDIDATE):\s*(.+)$/i.exec(line);
  if (!m) continue;
  const [, who, text] = m;
  if (who.toUpperCase() === 'CANDIDATE') { history.push(`[CANDIDATE] ${text}`); continue; }

  // The real three-tier classifier, on the real accumulated transcript.
  const res = await IC.classifyIntent(text, history.join('\n'), history.filter((h) => h.startsWith('[CANDIDATE]')).length);
  const withIntent = await generate(history, text, res.answerShape);
  const withoutIntent = await generate(history, text, null);

  rows.push({ question: text, intent: res.intent, confidence: res.confidence,
              with_intent: withIntent, without_intent: withoutIntent });
  console.log(`${String(res.intent).padEnd(16)} conf=${String(res.confidence).padEnd(5)} with=${String(withIntent.length).padStart(5)}ch  without=${String(withoutIntent.length).padStart(5)}ch  "${text.slice(0, 44)}"`);

  history.push(`[INTERVIEWER] ${text}`);
}

fs.writeFileSync(path.join(__dirname, 'interview-results.json'), JSON.stringify(rows, null, 2));

// Blind pairwise, randomised order.
let a = 0, b = 0, tie = 0;
for (const r of rows) {
  const flip = Math.random() < 0.5;
  const [X, Y] = flip ? [r.without_intent, r.with_intent] : [r.with_intent, r.without_intent];
  const prompt = `A candidate is in a LIVE interview reading this off a screen while speaking. The interviewer asked: "${r.question}"

ANSWER 1:
${X.slice(0, 2200)}

ANSWER 2:
${Y.slice(0, 2200)}

Which helps the candidate more in that live moment? Consider correctness and whether it can be used while talking. Reply with exactly: 1, 2, or TIE.`;
  try {
    const res = await fetch(`${API}/v1/chat`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-natively-key': KEY },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }) });
    const v = ((await res.json()).content ?? '').trim().toUpperCase();
    const win = v.startsWith('1') ? (flip ? 'without' : 'with') : v.startsWith('2') ? (flip ? 'with' : 'without') : 'tie';
    if (win === 'with') a++; else if (win === 'without') b++; else tie++;
  } catch { /* skip */ }
}
console.log(`\nBLIND, on a continuous interview: with_intent ${a}  |  without_intent ${b}  |  tie ${tie}`);
console.log(`turns: ${rows.length}   full answers in interview-results.json`);
