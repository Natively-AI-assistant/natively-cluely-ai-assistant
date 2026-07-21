// electron/llm/codeVerification/__tests__/GoRunner.test.mjs
//
// Go verification (GAP A). Driver GENERATION is pure and always tested. Real
// compile/run is gated on a local `go` toolchain and SKIPS when absent — in
// this env there's no `go`, so the orchestrator must SKIP (runtime_unavailable),
// never a false verdict. When Go is installed the gated tests prove the path.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { parseGoSignature, buildGoProgram } from '../../../../dist-electron/electron/llm/codeVerification/goDriver.js';
import { runCase, localLanguageAvailable } from '../../../../dist-electron/electron/llm/codeVerification/localRunner.js';

const tc = (input, expected, source = 'problem') => ({ input, expected, source });

describe('parseGoSignature (pure)', () => {
  test('parses []int+int → []int (Two Sum)', () => {
    assert.deepEqual(parseGoSignature('func twoSum(nums []int, target int) []int { return nil }', 'twoSum'),
      { returnType: 'sliceInt', params: ['sliceInt', 'int'] });
  });
  test('parses the shared-type shorthand func add(a, b int) int', () => {
    assert.deepEqual(parseGoSignature('func add(a, b int) int { return a+b }', 'add'),
      { returnType: 'int', params: ['int', 'int'] });
  });
  test('parses [][]int and []string and string', () => {
    assert.deepEqual(parseGoSignature('func f(g [][]int) int { return 0 }', 'f'), { returnType: 'int', params: ['sliceSliceInt'] });
    assert.deepEqual(parseGoSignature('func g(ss []string) int { return 0 }', 'g'), { returnType: 'int', params: ['sliceString'] });
    assert.deepEqual(parseGoSignature('func h(s string) int { return 0 }', 'h'), { returnType: 'int', params: ['string'] });
  });
  test('parses *ListNode / *TreeNode', () => {
    assert.deepEqual(parseGoSignature('func reverseList(head *ListNode) *ListNode { return head }', 'reverseList'),
      { returnType: 'listnode', params: ['listnode'] });
    assert.deepEqual(parseGoSignature('func maxDepth(root *TreeNode) int { return 0 }', 'maxDepth'),
      { returnType: 'int', params: ['treenode'] });
  });
  test('REJECTS multi-return, maps, generics, unknown → null (skip)', () => {
    assert.equal(parseGoSignature('func f(x int) (int, error) { return x, nil }', 'f'), null);
    assert.equal(parseGoSignature('func f(m map[int]int) int { return 0 }', 'f'), null);
    assert.equal(parseGoSignature('func f(x byte) byte { return x }', 'f'), null);
    assert.equal(parseGoSignature('func f(x int) { }', 'f'), null); // void
  });
});

describe('buildGoProgram (pure)', () => {
  test('builds package main + typed decls + sentinels', () => {
    const p = buildGoProgram('func add(a, b int) int { return a+b }', 'add', tc([2, 3], 5));
    assert.ok(p);
    assert.match(p, /package main/);
    assert.match(p, /a0 := 2/);
    assert.match(p, /a1 := 3/);
    assert.match(p, /add\(a0, a1\)/);
    assert.match(p, /__NATIVELY_RESULT_START__/);
  });
  test('slice return imports encoding/json + nil-slice→[] normalizer', () => {
    const p = buildGoProgram('func twoSum(nums []int, target int) []int { return []int{0,1} }', 'twoSum', tc([[2, 7], 9], [0, 1]));
    assert.match(p, /encoding\/json/);
    assert.match(p, /__natEmitJSON/);
    assert.match(p, /rv = \[\]int\{\}/);
  });
  test('list return emits ListNode struct + build/emit helpers', () => {
    const p = buildGoProgram('func reverseList(head *ListNode) *ListNode { return head }', 'reverseList', tc([[1, 2, 3]], [3, 2, 1]));
    assert.match(p, /type ListNode struct/);
    assert.match(p, /__natBuildList/);
    assert.match(p, /__natEmitList/);
  });
  test('does NOT redefine a model-provided struct', () => {
    const code = 'type ListNode struct { Val int; Next *ListNode }\nfunc reverseList(head *ListNode) *ListNode { return head }';
    const p = buildGoProgram(code, 'reverseList', tc([[1]], [1]));
    // exactly one definition (the model's) — our preamble must not add a second
    assert.equal((p.match(/type ListNode struct/g) || []).length, 1);
  });
  test('null on arity mismatch / unfit value', () => {
    assert.equal(buildGoProgram('func add(a, b int) int { return a+b }', 'add', tc([1], 2)), null);
    assert.equal(buildGoProgram('func add(a, b int) int { return a+b }', 'add', tc(['x', 'y'], 2)), null);
  });
});

describe('Go real execution (go run) — gated', async () => {
  const have = await localLanguageAvailable('go');
  const maybe = (n, f) => test(n, { skip: have ? false : 'go unavailable' }, f);

  maybe('correct add → pass', async () => {
    const r = await runCase('go', 'func add(a, b int) int { return a+b }', 'add', tc([2, 3], 5));
    assert.equal(r.status, 'pass', r.error);
  });
  maybe('Two Sum ([]int+int→[]int) → pass', async () => {
    const code = 'func twoSum(nums []int, target int) []int { m := map[int]int{}; for i, x := range nums { if j, ok := m[target-x]; ok { return []int{j, i} }; m[x] = i }; return []int{} }';
    const r = await runCase('go', code, 'twoSum', tc([[2, 7, 11, 15], 9], [0, 1]));
    assert.equal(r.status, 'pass', r.error);
  });
  maybe('Reverse Linked List (*ListNode→*ListNode) → pass', async () => {
    const code = 'func reverseList(head *ListNode) *ListNode { var prev *ListNode; for head != nil { n := head.Next; head.Next = prev; prev = head; head = n }; return prev }';
    const r = await runCase('go', code, 'reverseList', tc([[1, 2, 3]], [3, 2, 1]));
    assert.equal(r.status, 'pass', r.error);
  });
  maybe('wrong answer → fail', async () => {
    const r = await runCase('go', 'func add(a, b int) int { return a-b }', 'add', tc([2, 3], 5));
    assert.equal(r.status, 'fail');
  });
  maybe('compile error → error', async () => {
    const r = await runCase('go', 'func f(x int) int { return x', 'f', tc([1], 1)); // missing }
    assert.equal(r.status, 'error');
  });
});
