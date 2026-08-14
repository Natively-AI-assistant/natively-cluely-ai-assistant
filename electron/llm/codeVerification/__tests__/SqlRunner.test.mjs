// electron/llm/codeVerification/__tests__/SqlRunner.test.mjs
//
// SQL verification (GAP B). Pure core (isReadOnlySelect / buildSqlScript /
// parseSqlRows / compareResultSet) always runs. Real execution uses sqlite3
// (present in this env) and proves the headline safety property: a MySQL-dialect
// query ERRORS → skip, never a false fail; a wrong result set → fail; non-SELECT
// → skip. `-safe` must block filesystem escape (ATTACH).

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { isReadOnlySelect, buildSqlScript, parseSqlRows } from '../../../../dist-electron/electron/llm/codeVerification/sqlRunner.js';
import { compareResultSet } from '../../../../dist-electron/electron/llm/codeVerification/judge.js';
import { runSqlCase, localLanguageAvailable } from '../../../../dist-electron/electron/llm/codeVerification/localRunner.js';
import { extractVerificationSpec } from '../../../../dist-electron/electron/llm/codeVerification/extractTests.js';
import fs from 'node:fs';

describe('isReadOnlySelect', () => {
  test('accepts SELECT and WITH…SELECT', () => {
    assert.ok(isReadOnlySelect('SELECT * FROM t'));
    assert.ok(isReadOnlySelect('  select a from t where b>1  '));
    assert.ok(isReadOnlySelect('WITH c AS (SELECT 1 AS x) SELECT x FROM c'));
    assert.ok(isReadOnlySelect('SELECT 1;')); // single trailing ; ok
  });
  test('rejects mutations / DDL / multi-statement / fs-escape', () => {
    for (const q of [
      'UPDATE t SET a=1', 'DELETE FROM t', 'INSERT INTO t VALUES (1)',
      'CREATE TABLE x(a INT)', 'DROP TABLE t', 'PRAGMA table_info(t)',
      'ATTACH DATABASE \'x.db\' AS y', 'SELECT 1; DROP TABLE t', 'VACUUM',
      'WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d',
    ]) assert.equal(isReadOnlySelect(q), false, q);
  });
  test('strips comments before deciding', () => {
    assert.ok(isReadOnlySelect('-- a comment\nSELECT 1'));
    assert.equal(isReadOnlySelect('/* x */ DELETE FROM t'), false);
  });
});

describe('buildSqlScript', () => {
  test('null for non-SELECT or empty schema', () => {
    assert.equal(buildSqlScript('DELETE FROM t', ['CREATE TABLE t(a INT)'], []), null);
    assert.equal(buildSqlScript('SELECT 1', [], []), null);
  });
  test('emits .mode json + schema + seeds + query in order', () => {
    const s = buildSqlScript('SELECT a FROM t', ['CREATE TABLE t(a INT)'], ['INSERT INTO t VALUES (1)']);
    assert.ok(s);
    assert.match(s, /\.mode json/);
    assert.ok(s.indexOf('CREATE TABLE') < s.indexOf('INSERT INTO'));
    assert.ok(s.indexOf('INSERT INTO') < s.indexOf('SELECT a FROM t'));
  });
});

describe('parseSqlRows', () => {
  test('parses a JSON array of rows', () => {
    const r = parseSqlRows('[{"a":1},\n{"a":2}]');
    assert.equal(r.found, true);
    assert.deepEqual(r.rows, [{ a: 1 }, { a: 2 }]);
  });
  test('empty stdout → empty result set', () => {
    assert.deepEqual(parseSqlRows('   '), { found: true, rows: [] });
  });
  test('non-JSON → not found', () => {
    assert.equal(parseSqlRows('Error: no such table').found, false);
  });
});

describe('compareResultSet', () => {
  test('order-insensitive multiset by default', () => {
    assert.ok(compareResultSet([{ a: 1 }, { a: 2 }], [{ a: 2 }, { a: 1 }]));
    assert.ok(!compareResultSet([{ a: 1 }, { a: 1 }], [{ a: 1 }, { a: 2 }]));
  });
  test('ordered=true is positional', () => {
    assert.ok(compareResultSet([{ a: 1 }, { a: 2 }], [{ a: 1 }, { a: 2 }], true));
    assert.ok(!compareResultSet([{ a: 2 }, { a: 1 }], [{ a: 1 }, { a: 2 }], true));
  });
  test('column-name match, extra columns → mismatch', () => {
    assert.ok(!compareResultSet([{ a: 1, b: 2 }], [{ a: 1 }]));
    assert.ok(compareResultSet([{ b: 2, a: 1 }], [{ a: 1, b: 2 }])); // column order irrelevant
  });
  test('numeric/null normalization via valuesEqual', () => {
    assert.ok(compareResultSet([{ a: 90000 }], [{ a: '90000' }]));
    assert.ok(compareResultSet([{ a: null }], [{ a: null }]));
  });
  test('cardinality matters', () => {
    assert.ok(!compareResultSet([{ a: 1 }], [{ a: 1 }, { a: 1 }]));
  });
});

describe('extractVerificationSpec — SQL shape', () => {
  test('parses schema/seeds/expected/ordered', () => {
    const a = `<verification_spec>{"language":"sql","schema":["CREATE TABLE t(a INT)"],"seeds":["INSERT INTO t VALUES (1)"],"expected":[{"a":1}],"ordered":true}</verification_spec>`;
    const { spec } = extractVerificationSpec(a);
    assert.equal(spec.language, 'sql');
    assert.deepEqual(spec.sql.schema, ['CREATE TABLE t(a INT)']);
    assert.deepEqual(spec.sql.expected, [{ a: 1 }]);
    assert.equal(spec.sql.ordered, true);
  });
  test('empty schema or expected → sql undefined (skip)', () => {
    const { spec } = extractVerificationSpec(`<verification_spec>{"language":"sql","schema":[],"seeds":[],"expected":[]}</verification_spec>`);
    assert.equal(spec.language, 'sql');
    assert.equal(spec.sql, undefined);
  });
});

describe('runSqlCase — real sqlite3 execution', async () => {
  const have = await localLanguageAvailable('sql');
  const maybe = (n, f) => test(n, { skip: have ? false : 'sqlite3 unavailable' }, f);
  const schema = ['CREATE TABLE E (id INT, name TEXT, salary INT)'];
  const seeds = ['INSERT INTO E VALUES (1,\'Joe\',70000),(2,\'Jim\',90000)'];

  maybe('correct query → pass', async () => {
    const r = await runSqlCase('SELECT name AS Employee FROM E WHERE salary >= 80000', { schema, seeds, expected: [{ Employee: 'Jim' }] });
    assert.equal(r.status, 'pass', r.error);
  });
  maybe('wrong result set → fail', async () => {
    const r = await runSqlCase('SELECT name AS Employee FROM E WHERE salary > 200000', { schema, seeds, expected: [{ Employee: 'Jim' }] });
    assert.equal(r.status, 'fail');
  });
  maybe('MySQL-only dialect → error (skip, NEVER false fail)', async () => {
    const r = await runSqlCase("SELECT DATE_FORMAT(NOW(),'%Y') AS y", { schema, seeds, expected: [{ y: '2026' }] });
    assert.equal(r.status, 'error');
    assert.match(r.error, /sql error/);
  });
  maybe('non-SELECT → not verifiable (sql_not_verifiable)', async () => {
    const r = await runSqlCase('DELETE FROM E WHERE id=1', { schema, seeds, expected: [] });
    assert.equal(r.status, 'error');
    assert.equal(r.error, 'sql_not_verifiable');
  });
  maybe('order-insensitive pass; ordered=true fail on wrong order', async () => {
    const pass = await runSqlCase('SELECT name AS n FROM E ORDER BY salary ASC', { schema, seeds, expected: [{ n: 'Jim' }, { n: 'Joe' }] });
    assert.equal(pass.status, 'pass', pass.error);
    const fail = await runSqlCase('SELECT name AS n FROM E ORDER BY salary ASC', { schema, seeds, expected: [{ n: 'Jim' }, { n: 'Joe' }], ordered: true });
    assert.equal(fail.status, 'fail');
  });
  maybe('-safe blocks ATTACH (no filesystem escape)', async () => {
    const canary = `/tmp/natively-sql-canary-${process.pid}.db`;
    try { fs.rmSync(canary, { force: true }); } catch {}
    // ATTACH is non-SELECT so it's rejected upstream; assert no file regardless.
    const r = await runSqlCase(`ATTACH DATABASE '${canary}' AS evil`, { schema, seeds, expected: [] });
    assert.equal(r.status, 'error');
    assert.ok(!fs.existsSync(canary), 'no file may be created');
  });
});
