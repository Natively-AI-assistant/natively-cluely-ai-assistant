/**
 * Regression for the LIVE intro-grounding gap found by the real-backend MiniMax
 * E2E campaign (round 13/14). The orchestrator's isIntroQuestion (a substring
 * gate over INTRO_PATTERNS in premium/electron/knowledge/ContextAssembler.ts)
 * did NOT match "self-introduction" / "brief intro" / "introducing yourself",
 * so KnowledgeOrchestrator never produced an introResponse and the live intro
 * answered "I don't have a resume loaded". This asserts the pattern list covers
 * the real interviewer phrasings without over-matching substantive asks.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const src = fs.readFileSync(path.join(repoRoot, 'premium/electron/knowledge/ContextAssembler.ts'), 'utf8');
const m = src.match(/const INTRO_PATTERNS = \[([\s\S]*?)\];/);
const patterns = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
const isIntro = (q) => patterns.some((p) => q.toLowerCase().includes(p));

describe('ContextAssembler INTRO_PATTERNS — live intro phrasings', () => {
  for (const q of [
    'Great to meet you. To start, could you give us a quick self-introduction?',
    'Could you start by giving a brief introduction of yourself?',
    'Can you start by introducing yourself?',
    'Could you start by giving me a brief self-intro?',
    'Could you start us off with a brief self-introduction?',
    'Tell us a little about yourself.',
  ]) {
    test(`intro matched: "${q.slice(0, 42)}…"`, () => assert.ok(isIntro(q), 'must be an intro'));
  }
  // Must NOT over-match substantive asks that merely contain brief/quick.
  for (const q of [
    'Give me a brief summary of your most impactful project.',
    'Can you give a quick overview of the system architecture?',
    'What are your salary expectations?',
    'How many years have you worked with Go?',
  ]) {
    test(`NOT intro: "${q.slice(0, 42)}…"`, () => assert.ok(!isIntro(q), 'must not be an intro'));
  }
});
