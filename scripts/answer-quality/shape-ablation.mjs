#!/usr/bin/env node
// scripts/answer-quality/shape-ablation.mjs
//
// Does the Answer Shape change the ANSWER, or only the label?
//
// Every number in this campaign so far is label agreement. None of it says a
// correctly labelled turn produces a better answer, and that is the question
// that decides whether the classifier is worth having at all.
//
// Four conditions on the same real questions, through the real /v1/chat
// endpoint against a LOCAL natively-api, because the notes are explicit about
// never load testing production:
//
//   oracle      the ground truth label's shape. The ceiling.
//   none        always `general`. This is deleting the classifier.
//   production  the shape the shipped three-tier classifier picks.
//   router      the shape the new MiniLM head picks.
//
// The objective measure is whether a coding question comes back with a code
// block. That is not a matter of taste: the `coding` shape asks for "a FULL,
// complete, working and production-ready code implementation" and the `general`
// shape asks for a conversational reply. If both produce code the shape is not
// load bearing and the classifier can go. If only the labelled one does, it is
// earning its place on exactly those turns.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const API = process.env.NATIVELY_API_URL || 'http://127.0.0.1:8788';
const KEY = fs.readFileSync(path.join(repoRoot, '.env'), 'utf8')
  .split('\n').find((l) => l.startsWith('NATIVELY_API_KEY='))?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');

// The REAL shapes, copied verbatim from electron/llm/IntentClassifier.ts.
const SHAPES = {
  clarification: 'Give a direct, focused 1-2 sentence clarification. No setup, no context-setting.',
  follow_up: 'Continue the narrative naturally. 1-2 sentences. No recap of what was already said.',
  deep_dive: 'Provide a structured but concise explanation. Use concrete specifics, not abstract concepts.',
  behavioral: 'Use a specific story only when grounded candidate/profile context exists. Without grounding, use the required no-context admission opener and keep any example illustrative, unnamed, modest, and qualitative.',
  example_request: 'Provide one concrete example from grounded context when available. Without grounding, label it as illustrative and avoid invented names, companies, dates, metrics, or first-person claims.',
  summary_probe: 'Confirm the summary briefly and add one clarifying point if needed.',
  coding: 'Provide a FULL, complete, working and production-ready code implementation (including necessary boilerplate like Java imports/classes). Start with a brief approach description, then the fully runnable code block, then a concise explanation of why this approach works.',
  general: 'Respond naturally based on context. Keep it conversational and direct.',
};

async function ask(question, shape) {
  const content = `You are helping a candidate in a live technical interview. Answer the interviewer's question.\n\nANSWER SHAPE: ${SHAPES[shape]}\n\nInterviewer said: "${question}"`;
  const r = await fetch(`${API}/v1/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-natively-key': KEY },
    body: JSON.stringify({ messages: [{ role: 'user', content }] }),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.content ?? '';
}

/** Objective: did a runnable code block come back? */
const hasCode = (t) => /```[\s\S]*?```/.test(t) || /\b(def |class |function |public static|const \w+ =|for \(|while \()/.test(t);

const QUESTIONS = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'));

const rows = [];
for (const q of QUESTIONS) {
  const out = { question: q.question, truth: q.truth };
  for (const [cond, shape] of Object.entries(q.shapes)) {
    try {
      const a = await ask(q.question, shape);
      out[cond] = { shape, code: hasCode(a), chars: a.length, text: a };
    } catch (e) {
      out[cond] = { shape, error: String(e).slice(0, 120) };
    }
  }
  rows.push(out);
  const mark = (c) => (out[c]?.error ? 'ERR' : out[c].code ? 'CODE' : ' -- ');
  console.log(`${q.truth.padEnd(16)} oracle=${mark('oracle')} none=${mark('none')} prod=${mark('production')} router=${mark('router')}  "${q.question.slice(0, 46)}"`);
}

fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(rows, null, 2));

const coding = rows.filter((r) => r.truth === 'coding');
console.log(`\ncoding questions: ${coding.length}`);
for (const c of ['oracle', 'none', 'production', 'router']) {
  const n = coding.filter((r) => r[c]?.code).length;
  console.log(`  ${c.padEnd(11)} produced code on ${n}/${coding.length}`);
}
console.log('\nfull answers in scripts/answer-quality/results.json');
