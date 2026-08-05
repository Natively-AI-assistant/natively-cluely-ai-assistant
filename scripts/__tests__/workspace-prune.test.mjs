import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  planPrune,
  matchesGlob,
  isEphemeral,
  isGrillKeep,
} = require('../lib/workspacePrune.js');

const DAY = 86_400_000;
const NOW = Date.parse('2026-08-05T12:00:00Z');

function entry(rel, ageDays, extra = {}) {
  return {
    rel,
    kind: rel.endsWith('/') ? 'dir' : 'file',
    mtimeMs: NOW - ageDays * DAY,
    tracked: false,
    ...extra,
  };
}

describe('matchesGlob', () => {
  it('matches .scratch/*/debug trees', () => {
    assert.equal(matchesGlob('.scratch/foo/debug', '.scratch/*/debug'), true);
    assert.equal(matchesGlob('.scratch/foo/debug/a.json', '.scratch/*/debug'), true);
    assert.equal(matchesGlob('.scratch/foo/issues/01.md', '.scratch/*/debug'), false);
  });
});

describe('isEphemeral / isGrillKeep', () => {
  it('flags debug and archive', () => {
    assert.equal(isEphemeral('.scratch/x/debug/run.json'), true);
    assert.equal(isEphemeral('_workspace/grill-with-docs/archive/old'), true);
    assert.equal(isEphemeral('_workspace/code-review/x.md'), true);
  });

  it('protects grill ledger', () => {
    assert.equal(isGrillKeep('_workspace/grill-with-docs/01_question_log.md'), true);
    assert.equal(isGrillKeep('_workspace/grill-with-docs/archive/x'), false);
  });
});

describe('planPrune', () => {
  it('deletes ephemeral immediately', () => {
    const { delete: del } = planPrune({
      nowMs: NOW,
      entries: [
        entry('.scratch/foo/debug/a.json', 0),
        entry('.scratch/foo/issues/01.md', 0),
        entry('_workspace/code-review/note.md', 0),
      ],
    });
    assert.ok(del.some((p) => p.includes('debug') || p === '.scratch/foo/debug/a.json'));
    assert.ok(del.some((p) => p.includes('code-review')));
    assert.ok(!del.some((p) => p.includes('issues')));
  });

  it('keeps grill ledger and skips tracked by default', () => {
    const { delete: del, keep } = planPrune({
      nowMs: NOW,
      entries: [
        entry('_workspace/grill-with-docs/01_question_log.md', 40),
        entry('.scratch/old/PRD.md', 40, { tracked: true }),
      ],
      features: true,
    });
    assert.ok(!del.includes('_workspace/grill-with-docs/01_question_log.md'));
    assert.ok(keep.some((k) => k.rel.includes('01_question_log') && k.reason === 'grill-ledger'));
    assert.ok(keep.some((k) => k.rel.includes('PRD.md') && k.reason === 'git-tracked'));
  });

  it('ages out _workspace implement runs', () => {
    const { delete: del } = planPrune({
      nowMs: NOW,
      workspaceDays: 14,
      entries: [
        entry('_workspace/implement/speakable-sd-20260101/team.md', 20),
        entry('_workspace/implement/fresh-run/team.md', 2),
      ],
    });
    assert.ok(del.some((p) => p.includes('speakable-sd-20260101')));
    assert.ok(!del.some((p) => p.includes('fresh-run')));
  });

  it('feature prune is opt-in and age-gated', () => {
    const off = planPrune({
      nowMs: NOW,
      featureDays: 30,
      entries: [entry('.scratch/vesta/PRD.md', 40)],
    });
    assert.equal(off.delete.length, 0);

    const on = planPrune({
      nowMs: NOW,
      features: true,
      featureDays: 30,
      entries: [
        entry('.scratch/vesta/PRD.md', 40),
        entry('.scratch/vesta/issues/01.md', 40),
      ],
    });
    assert.ok(
      on.delete.includes('.scratch/vesta') ||
        on.delete.every((p) => p.startsWith('.scratch/vesta')),
    );
  });
});
