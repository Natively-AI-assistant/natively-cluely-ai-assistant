// benchmarks/deepseek-vs-gemini/fixtures/validate-fixtures.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFixtureFile } from './validate-fixtures.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('validateFixtureFile', () => {
  test('rejects a file with duplicate ids', () => {
    const tmp = path.join(__dirname, '__tmp_dup.json');
    fs.writeFileSync(tmp, JSON.stringify([
      { id: 'x-001', category: 'x', context: 'c', question: 'q', rubric_notes: 'r' },
      { id: 'x-001', category: 'x', context: 'c2', question: 'q2', rubric_notes: 'r2' },
    ]));
    const result = validateFixtureFile(tmp, 'x');
    fs.unlinkSync(tmp);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('duplicate id')));
  });

  test('rejects a file with a wrong category tag', () => {
    const tmp = path.join(__dirname, '__tmp_cat.json');
    fs.writeFileSync(tmp, JSON.stringify([
      { id: 'x-001', category: 'wrong', context: 'c', question: 'q', rubric_notes: 'r' },
    ]));
    const result = validateFixtureFile(tmp, 'x');
    fs.unlinkSync(tmp);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('category')));
  });

  test('rejects a file with a missing required field', () => {
    const tmp = path.join(__dirname, '__tmp_missing.json');
    fs.writeFileSync(tmp, JSON.stringify([
      { id: 'x-001', category: 'x', context: 'c', question: '' },
    ]));
    const result = validateFixtureFile(tmp, 'x');
    fs.unlinkSync(tmp);
    assert.equal(result.valid, false);
  });

  test('accepts a well-formed file', () => {
    const tmp = path.join(__dirname, '__tmp_ok.json');
    fs.writeFileSync(tmp, JSON.stringify([
      { id: 'x-001', category: 'x', context: 'some context', question: 'a real question?', rubric_notes: 'should cover Y' },
      { id: 'x-002', category: 'x', context: 'more context', question: 'another question?', rubric_notes: 'should cover Z' },
    ]));
    const result = validateFixtureFile(tmp, 'x');
    fs.unlinkSync(tmp);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  test('each real fixture file has >= 30 entries, unique ids, correct category', () => {
    for (const [file, category] of [
      ['meeting.json', 'meeting'],
      ['technical-interview.json', 'technical-interview'],
      ['sales.json', 'sales'],
      ['recruiting.json', 'recruiting'],
      ['general.json', 'general'],
    ]) {
      const filePath = path.join(__dirname, file);
      const result = validateFixtureFile(filePath, category);
      assert.equal(result.valid, true, `${file} errors: ${result.errors.join('; ')}`);
      const entries = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      assert.ok(entries.length >= 30, `${file} has only ${entries.length} entries`);
    }
  });
});
