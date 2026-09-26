/**
 * Regression test for the Profile Intelligence production-fix autopilot
 * (2026-07-05, docs/investigations/pi-production-fix-progress.md, Confirmed
 * Bug #4). A project's single `description` field can't hold every resume
 * bullet — the metrics bullet ("gained 4,000+ users and 500+ stars in one
 * week") was silently dropped when the LLM extractor compressed a
 * multi-bullet project into one summary sentence. Fixed by adding an
 * optional `highlights: string[]` field (types.ts ProjectEntry,
 * StructuredExtractor RESUME_SCHEMA) and surfacing it as structured
 * evidence for the fast-path single-project selection.
 *
 * Since the Full-JIT policy (2026-07-07/08, commit 6e6189b4), this
 * deterministic project selection no longer renders a final `.answer`
 * string — it SELECTS the project (including `highlights`, when present)
 * as structured evidence (`items`/`selectedProjects`) for a downstream JIT
 * prompt to phrase. These tests assert against that evidence-selection
 * shape instead of the old rendered-string contract.
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
  test('"How many users and stars did Natively get?" selects the highlights evidence with the real 4,000+/500+ metric', () => {
    const r = tryBuildManualProfileFastPathAnswer({
      question: 'How many users and stars did Natively get, and in what timeframe?',
      profile: NATIVELY_PROJECT_WITH_HIGHLIGHTS, source: 'manual_input',
    });
    assert.ok(r);
    assert.equal(r.answer, undefined, 'Full-JIT policy: must not render a final answer string');
    const highlights = r.items.find((f) => f.field === 'projects.0.highlights');
    assert.ok(highlights, 'must select the highlights field as evidence');
    assert.ok(highlights.value.some((h) => /4,000\+?/.test(h) && /500\+?/.test(h)));
    assert.deepEqual(r.selectedProjects[0].highlights, NATIVELY_PROJECT_WITH_HIGHLIGHTS.projects[0].highlights);
  });

  test('"Tell me about Natively" still selects the project evidence with a metric highlight present', () => {
    const r = tryBuildManualProfileFastPathAnswer({
      question: 'Tell me about Natively.', profile: NATIVELY_PROJECT_WITH_HIGHLIGHTS, source: 'manual_input',
    });
    assert.ok(r);
    assert.equal(r.answerType, 'project_answer');
    assert.ok(r.items.some((f) => f.field === 'projects.0.description' && /privacy-first/i.test(f.value)));
  });
});

describe('backward compatibility — profiles without `highlights` are unaffected', () => {
  test('"Tell me about Natively" selects project evidence normally when highlights is absent', () => {
    const r = tryBuildManualProfileFastPathAnswer({
      question: 'Tell me about Natively.', profile: NATIVELY_PROJECT_NO_HIGHLIGHTS, source: 'manual_input',
    });
    assert.ok(r);
    assert.equal(r.answerType, 'project_answer');
    assert.ok(r.items.some((f) => f.field === 'projects.0.description' && /privacy-first/i.test(f.value)));
    assert.ok(!r.items.some((f) => f.field === 'projects.0.highlights'), 'must not fabricate a highlights field');
  });
});
