/**
 * Regression test for the Profile Intelligence production-fix autopilot
 * (2026-07-05, docs/investigations/pi-production-fix-progress.md, Confirmed
 * Bug #4). A project's single `description` field can't hold every resume
 * bullet — the metrics bullet ("gained 4,000+ users and 500+ stars in one
 * week") was silently dropped when the LLM extractor compressed a
 * multi-bullet project into one summary sentence. Fixed by adding an
 * optional `highlights: string[]` field (types.ts ProjectEntry,
 * StructuredExtractor RESUME_SCHEMA) and surfacing the first
 * number-bearing highlight in the fast-path single-project template.
 *
 * Requires: npm run build:electron.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mpi = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/manualProfileIntelligence.js')).href
);
const { tryBuildManualProfileFastPathAnswer } = mpi;

const NATIVELY_PROJECT_WITH_HIGHLIGHTS = {
  identity: { name: 'Evin John' },
  name: 'Evin John',
  projects: [
    {
      name: 'Natively',
      description: 'A privacy-first AI meeting assistant featuring local RAG for offline context retention and multi-vendor AI model integration.',
      highlights: [
        'Launched a privacy-first AI assistant that gained 4,000+ users and 500+ stars in one week, managing the full product lifecycle from system design to public release and community support.',
        'Architected a Local RAG system using SQLite and Vector Embeddings to enable offline context retention, ensuring secure data flow and 100% privacy.',
      ],
      technologies: ['Electron', 'TypeScript', 'Rust'],
    },
  ],
};

const NATIVELY_PROJECT_NO_HIGHLIGHTS = {
  identity: { name: 'Evin John' },
  name: 'Evin John',
  projects: [
    {
      name: 'Natively',
      description: 'A privacy-first AI meeting assistant featuring local RAG for offline context retention and multi-vendor AI model integration.',
      technologies: ['Electron', 'TypeScript', 'Rust'],
    },
  ],
};

describe('project metric-bearing highlights are recalled when present', () => {
  test('"How many users and stars did Natively get?" cites the real 4,000+/500+ metric', () => {
    const r = tryBuildManualProfileFastPathAnswer({
      question: 'How many users and stars did Natively get, and in what timeframe?',
      profile: NATIVELY_PROJECT_WITH_HIGHLIGHTS, source: 'manual_input',
    });
    assert.ok(r);
    assert.match(r.answer, /4,000\+?/);
    assert.match(r.answer, /500\+?/);
  });

  test('"Tell me about Natively" still reads cleanly with a metric highlight present', () => {
    const r = tryBuildManualProfileFastPathAnswer({
      question: 'Tell me about Natively.', profile: NATIVELY_PROJECT_WITH_HIGHLIGHTS, source: 'manual_input',
    });
    assert.ok(r);
    assert.match(r.answer, /privacy-first/i);
  });
});

describe('backward compatibility — profiles without `highlights` are unaffected', () => {
  test('"Tell me about Natively" answers normally when highlights is absent', () => {
    const r = tryBuildManualProfileFastPathAnswer({
      question: 'Tell me about Natively.', profile: NATIVELY_PROJECT_NO_HIGHLIGHTS, source: 'manual_input',
    });
    assert.ok(r);
    assert.match(r.answer, /privacy-first/i);
    assert.doesNotMatch(r.answer, /undefined|null/i);
  });
});
