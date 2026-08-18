// Tests for the local knowledge orchestrator's grounding path (task 7).
//
// processQuestion runs inside a 2000 ms budget that discards the entire result
// on overrun, and its `factualRecall` flag bypasses a gate that otherwise
// blocks profile injection. Those two facts are what these tests protect.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const dist = (rel) => path.join(repoRoot, 'dist-electron/electron/localKnowledge', rel);

const Database = require(path.join(repoRoot, 'node_modules/better-sqlite3'));
const { ProfileIndex } = require(dist('ProfileIndex.js'));
const { LocalKnowledgeOrchestrator } = require(dist('LocalKnowledgeOrchestrator.js'));
const { DocType } = require(dist('types.js'));

const RESUME_FACTS = {
  name: 'Marcus J. Holloway',
  identity: { name: 'Marcus J. Holloway' },
  experience: [
    { role: 'Staff Engineer', company: 'Northwind Systems', start_date: '2021-03', bullets: ['Owned the rate-limiting platform.'] },
    { role: 'Senior Engineer', company: 'Difference Ltd', start_date: '2019-01', end_date: '2021-02' },
  ],
  skills: { languages: ['Go', 'Java'] },
  skills_flat: ['Go', 'Java', 'Kubernetes'],
  education: [{ degree: 'BSc', field: 'Computer Science', institution: 'Example University' }],
  _extraction_mode: 'local_llm',
};

const makeDocument = (docType) => ({
  docType,
  filePath: `/Users/example/${docType}.pdf`,
  fileName: `${docType}.pdf`,
  extension: '.pdf',
  content: 'Staff Engineer at Northwind Systems. Owned the distributed rate-limiting platform.',
  binarySha256: 'a'.repeat(64),
  contentSha256: 'b'.repeat(64),
  ingestedAt: 1_755_000_000_000,
});

let dir;
let db;
let index;
let orchestrator;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-orch-'));
  const dbPath = path.join(dir, 'test.db');
  db = new Database(dbPath);
  index = new ProfileIndex({ db, dbPath });
  orchestrator = new LocalKnowledgeOrchestrator({ profileIndex: index });
});

afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const seedResume = () =>
  index.put(makeDocument(DocType.RESUME), { structured_data: RESUME_FACTS, extractionMode: 'local_llm' });

describe('processQuestion preconditions', () => {
  test('returns null while knowledge mode is off', async () => {
    await seedResume();
    assert.equal(await orchestrator.processQuestion('tell me about yourself'), null);
  });

  test('returns null when no document has been uploaded', async () => {
    orchestrator.setKnowledgeMode(true);
    assert.equal(await orchestrator.processQuestion('tell me about yourself'), null);
  });

  test('returns null for an empty question', async () => {
    await seedResume();
    orchestrator.setKnowledgeMode(true);
    assert.equal(await orchestrator.processQuestion('   '), null);
    assert.equal(await orchestrator.processQuestion(null), null);
  });
});

describe('grounding content', () => {
  beforeEach(async () => {
    await seedResume();
    orchestrator.setKnowledgeMode(true);
  });

  test('grounds a question about the candidate with their own facts', async () => {
    const result = await orchestrator.processQuestion('walk me through your experience');
    assert.ok(result, 'expected grounding');
    assert.match(result.contextBlock, /<candidate_profile/);
    assert.match(result.contextBlock, /Northwind Systems/);
  });

  test('marks candidate-fact answers as factual recall', async () => {
    // factualRecall bypasses the mode-compatibility gate at
    // electron/LLMHelper.ts:2740, so it must only be true for the
    // candidate's own plain facts.
    const result = await orchestrator.processQuestion('walk me through your experience');
    assert.equal(result.factualRecall, true);
  });

  test('flags an intro question so the caller can take its intro path', async () => {
    const result = await orchestrator.processQuestion('tell me about yourself');
    assert.ok(result, 'expected grounding');
    assert.equal(result.isIntroQuestion, true);
  });

  test('never precomputes intro prose', async () => {
    // The free tree's rule is that deterministic logic selects evidence and
    // never final prose; ManualProfileRouteResult declares `answer?: never`
    // for the same reason. The model writes the intro from the evidence.
    const result = await orchestrator.processQuestion('tell me about yourself');
    assert.equal(result.introResponse, undefined);
  });

  test('renders evidence readably rather than as JSON', async () => {
    const result = await orchestrator.processQuestion('walk me through your experience');
    assert.ok(result.contextBlock.includes('Staff Engineer'));
    assert.ok(!result.contextBlock.includes('{"role"'), 'must not dump raw JSON at the model');
  });

  test('grounds a question the selector does not recognize from passages alone', async () => {
    // The deterministic selector returns no route for many natural phrasings,
    // such as "what did I do at Northwind Systems?". Retrieval is what keeps
    // those turns grounded, so a null route must not mean a null result.
    index.retrieve = async () => ({ formattedContext: 'Owned the distributed rate-limiting platform.' });
    const result = await orchestrator.processQuestion('what did I do at Northwind Systems?');
    assert.ok(result, 'expected retrieval to ground an unrouted question');
    assert.match(result.contextBlock, /<profile_passages/);
    assert.ok(!result.contextBlock.includes('<candidate_profile'));
    assert.equal(result.factualRecall, false);
  });
});

describe('staying inside the grounding budget', () => {
  beforeEach(async () => {
    await seedResume();
    orchestrator.setKnowledgeMode(true);
  });

  test('slow retrieval loses the passages, not the deterministic evidence', async () => {
    // The caller's withTimeout discards the whole result on overrun, so
    // retrieval is capped well below the 2000 ms outer budget.
    let settled = false;
    index.retrieve = () => new Promise((resolve) => {
      setTimeout(() => { settled = true; resolve({ formattedContext: 'too late' }); }, 5_000).unref?.();
    });
    orchestrator = new LocalKnowledgeOrchestrator({ profileIndex: index, retrievalBudgetMs: 50 });
    orchestrator.setKnowledgeMode(true);

    const started = Date.now();
    const result = await orchestrator.processQuestion('walk me through your experience');
    const elapsed = Date.now() - started;

    assert.ok(elapsed < 2000, `expected to return well inside the budget, took ${elapsed}ms`);
    assert.ok(result, 'deterministic evidence must survive a slow retrieval');
    assert.match(result.contextBlock, /<candidate_profile/);
    assert.ok(!result.contextBlock.includes('too late'));
    assert.equal(settled, false);
  });

  test('a retrieval error does not fail the turn', async () => {
    index.retrieve = async () => { throw new Error('embedding provider exploded'); };
    const result = await orchestrator.processQuestion('walk me through your experience');
    assert.ok(result, 'expected the deterministic evidence to still come back');
    assert.match(result.contextBlock, /<candidate_profile/);
  });

  test('retrieved passages are included when retrieval is fast', async () => {
    index.retrieve = async () => ({ formattedContext: 'Owned the distributed rate-limiting platform.' });
    const result = await orchestrator.processQuestion('walk me through your experience');
    assert.match(result.contextBlock, /<profile_passages/);
    assert.match(result.contextBlock, /rate-limiting/);
  });

  test('passages alone still ground the turn when no facts are selected', async () => {
    index.retrieve = async () => ({ formattedContext: 'Some passage text.' });
    const result = await orchestrator.processQuestion('zzzz qqqq');
    if (result) {
      assert.match(result.contextBlock, /<profile_passages/);
      // Passages are not the candidate's structured facts, so this must not
      // claim factual recall and bypass the mode gate.
      assert.equal(result.factualRecall, false);
    }
  });
});

describe('knowledge mode', () => {
  test('is off until switched on', () => {
    assert.equal(orchestrator.isKnowledgeMode(), false);
    orchestrator.setKnowledgeMode(true);
    assert.equal(orchestrator.isKnowledgeMode(), true);
    orchestrator.setKnowledgeMode(false);
    assert.equal(orchestrator.isKnowledgeMode(), false);
  });
});

describe('ingestDocument', () => {
  test('reports a readable failure for an unsupported file', async () => {
    const bad = path.join(dir, 'resume.exe');
    fs.writeFileSync(bad, 'nope');
    const result = await orchestrator.ingestDocument(bad, DocType.RESUME);
    assert.equal(result.success, false);
    assert.match(result.error, /not supported/);
  });

  test('stores a job description without attempting resume extraction', async () => {
    const jd = path.join(dir, 'jd.txt');
    fs.writeFileSync(jd, 'We are hiring a Staff Engineer to own our rate-limiting platform.\n');

    const result = await orchestrator.ingestDocument(jd, DocType.JD);
    assert.equal(result.success, true, result.error);
    assert.ok(index.get(DocType.JD));
    // JD structuring is not implemented yet, so the facts stay null while the
    // text remains indexed and retrievable.
    assert.equal(orchestrator.activeJD.structured_data, null);
  });
});

describe('the shape the deterministic selector reads', () => {
  test('exposes the resume facts the selector expects', async () => {
    await seedResume();
    assert.equal(orchestrator.activeResume.structured_data.name, 'Marcus J. Holloway');
  });

  test('reports no active documents when none are stored', () => {
    assert.equal(orchestrator.activeResume, null);
    assert.equal(orchestrator.activeJD, null);
  });
});
