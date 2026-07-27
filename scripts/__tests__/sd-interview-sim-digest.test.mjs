// scripts/__tests__/sd-interview-sim-digest.test.mjs
// SPEC 11 — review digests: truncate prose, keep fences, soft tags.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  truncateTurnText,
  detectReviewTags,
  buildDigestMarkdown,
  writeCorpusDigest,
  FULL_IN_JSON,
} = require('../lib/sd-interview-sim/digest.js');

describe('sd-interview-sim digest', () => {
  test('truncateTurnText keeps ASCII fence and truncates surrounding prose', () => {
    const long = 'A'.repeat(500);
    const text = `${long}\n\`\`\`text\n+---+\n| A |\n+---+\n\`\`\`\n${long}`;
    const out = truncateTurnText(text, 80);
    assert.match(out, /```text/);
    assert.match(out, /\+---\+/);
    assert.match(out, new RegExp(FULL_IN_JSON.replace(/[[\]]/g, '\\$&')));
    assert.ok(out.length < text.length);
  });

  test('detectReviewTags flags ascii and late requirements rewind', () => {
    const tags = detectReviewTags({
      provenance: { full_raw: true },
      turns: [
        { role: 'interviewer', text: 'open' },
        { role: 'assistant', text: 'early' },
        { role: 'interviewer', text: 'probe' },
        {
          role: 'assistant',
          text: '```text\n+--+\n```\n**Functional Requirements:**\n- x',
        },
      ],
    });
    assert.ok(tags.includes('ascii_hld_present'));
    assert.ok(tags.includes('full_raw'));
    assert.ok(tags.includes('candidate_rewind'));
  });

  test('buildDigestMarkdown includes meta tags and turn headings', () => {
    const md = buildDigestMarkdown({
      run_id: 'demo-1',
      provenance: { tier: 'T2', models: { sut: 'flash' }, full_raw: true },
      outcome: {
        end_reason: 'coverage_complete',
        spend: { estimated_usd: 0.01 },
      },
      turns: [
        { role: 'interviewer', text: 'Design a URL shortener.' },
        {
          role: 'assistant',
          text: `${'word '.repeat(200)}\n\`\`\`text\n[LB]->[API]\n\`\`\``,
        },
      ],
    });
    assert.match(md, /demo-1/);
    assert.match(md, /coverage_complete/);
    assert.match(md, /Turn 1 — INTERVIEWER/);
    assert.match(md, /Turn 2 — ASSISTANT/);
    assert.match(md, /```text/);
    assert.match(md, /full in json/);
  });

  test('writeCorpusDigest writes paired .digest.md', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-digest-'));
    try {
      const jsonPath = path.join(dir, 't2-abc.json');
      const bundle = {
        run_id: 'abc',
        turns: [{ role: 'interviewer', text: 'hi' }],
        outcome: { end_reason: 'scenario_stop', spend: {} },
        provenance: {},
      };
      fs.writeFileSync(jsonPath, JSON.stringify(bundle), 'utf8');
      const { path: digestPath } = writeCorpusDigest(bundle, { jsonPath });
      assert.equal(digestPath, path.join(dir, 't2-abc.digest.md'));
      assert.ok(fs.existsSync(digestPath));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
