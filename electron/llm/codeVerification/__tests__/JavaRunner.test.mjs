// electron/llm/codeVerification/__tests__/JavaRunner.test.mjs
//
// Java verification (GAP 2). Driver GENERATION is pure and always tested. Real
// compile/run is gated on a local JDK (javac+java) and SKIPS when absent — in
// CI/dev without Java, the orchestrator must SKIP (runtime_unavailable), never a
// false verdict. When a JDK is present the gated tests prove correct/wrong/skip.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { parseJavaSignature, buildJavaProgram } from '../../../../dist-electron/electron/llm/codeVerification/javaDriver.js';
import { runCase, localLanguageAvailable } from '../../../../dist-electron/electron/llm/codeVerification/localRunner.js';

const tc = (input, expected, source = 'problem') => ({ input, expected, source });

describe('parseJavaSignature (pure)', () => {
  test('parses int[]+int → int[] (Two Sum)', () => {
    assert.deepEqual(parseJavaSignature('class Solution { public int[] twoSum(int[] nums, int target){return new int[]{};} }', 'twoSum'),
      { returnType: 'intArr', params: ['intArr', 'int'] });
  });
  test('parses scalar + String + int[][]', () => {
    assert.deepEqual(parseJavaSignature('class Solution { public int add(int a, int b){return a+b;} }', 'add'), { returnType: 'int', params: ['int', 'int'] });
    assert.deepEqual(parseJavaSignature('class Solution { public int longest(String s){return 0;} }', 'longest'), { returnType: 'int', params: ['String'] });
    assert.deepEqual(parseJavaSignature('class Solution { public int islands(int[][] g){return 0;} }', 'islands'), { returnType: 'int', params: ['intArr2'] });
  });
  test('parses ListNode/TreeNode structures', () => {
    assert.deepEqual(parseJavaSignature('class Solution { public ListNode reverseList(ListNode head){return head;} }', 'reverseList'), { returnType: 'listnode', params: ['listnode'] });
    assert.deepEqual(parseJavaSignature('class Solution { public int maxDepth(TreeNode root){return 0;} }', 'maxDepth'), { returnType: 'int', params: ['treenode'] });
  });
  test('REJECTS unsupported types → null (skip, never false verdict)', () => {
    assert.equal(parseJavaSignature('class Solution { public Map<Integer,Integer> f(int x){return null;} }', 'f'), null);
    assert.equal(parseJavaSignature('class Solution { public double[] g(double[] a){return a;} }', 'g'), null);
  });
});

describe('buildJavaProgram (pure)', () => {
  test('wraps Solution in Main with typed args + sentinels', () => {
    const p = buildJavaProgram('class Solution { public int add(int a, int b){return a+b;} }', 'add', tc([2, 3], 5));
    assert.ok(p);
    assert.match(p, /public class Main/);
    assert.match(p, /int a0 = 2;/);
    assert.match(p, /int a1 = 3;/);
    assert.match(p, /__natMain\(\)\.new Solution\(\)\.add\(a0, a1\)/);
    assert.match(p, /__NATIVELY_RESULT_START__/);
  });
  test('emits ListNode build/serialize helpers when the signature uses them', () => {
    const p = buildJavaProgram('class Solution { public ListNode reverseList(ListNode head){return head;} }', 'reverseList', tc([[1, 2, 3]], [3, 2, 1]));
    assert.ok(p);
    assert.match(p, /__natBuildList/);
    assert.match(p, /__natEmitList/);
  });
  test('null on arity mismatch / unfit value', () => {
    assert.equal(buildJavaProgram('class Solution { public int add(int a, int b){return a+b;} }', 'add', tc([1], 2)), null);
    assert.equal(buildJavaProgram('class Solution { public int add(int a, int b){return a+b;} }', 'add', tc(['x', 'y'], 2)), null);
  });
});

describe('Java real execution (javac+java) — gated', async () => {
  const have = await localLanguageAvailable('java');
  const maybe = (n, f) => test(n, { skip: have ? false : 'javac/java unavailable' }, f);

  maybe('correct add → pass', async () => {
    const r = await runCase('java', 'class Solution { public int add(int a, int b){return a+b;} }', 'add', tc([2, 3], 5));
    assert.equal(r.status, 'pass', r.error);
  });
  maybe('Two Sum (int[]+int→int[]) → pass', async () => {
    const code = 'class Solution { public int[] twoSum(int[] nums, int target){ java.util.Map<Integer,Integer> m=new java.util.HashMap<>(); for(int i=0;i<nums.length;i++){ if(m.containsKey(target-nums[i])) return new int[]{m.get(target-nums[i]),i}; m.put(nums[i],i);} return new int[]{}; } }';
    const r = await runCase('java', code, 'twoSum', tc([[2, 7, 11, 15], 9], [0, 1]));
    assert.equal(r.status, 'pass', r.error);
  });
  maybe('Reverse Linked List (ListNode→ListNode) → pass', async () => {
    const code = 'class Solution { public ListNode reverseList(ListNode head){ ListNode p=null; while(head!=null){ ListNode n=head.next; head.next=p; p=head; head=n;} return p; } }';
    const r = await runCase('java', code, 'reverseList', tc([[1, 2, 3]], [3, 2, 1]));
    assert.equal(r.status, 'pass', r.error);
  });
  maybe('wrong answer → fail', async () => {
    const r = await runCase('java', 'class Solution { public int add(int a, int b){return a-b;} }', 'add', tc([2, 3], 5));
    assert.equal(r.status, 'fail');
  });
  maybe('compile error → error', async () => {
    const r = await runCase('java', 'class Solution { public int f(int x){return x} }', 'f', tc([1], 1)); // missing ;
    assert.equal(r.status, 'error');
    assert.match(r.error, /compile error/);
  });
});
