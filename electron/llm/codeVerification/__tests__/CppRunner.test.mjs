// electron/llm/codeVerification/__tests__/CppRunner.test.mjs
//
// C++ verification: signature parsing (pure) + real g++ compile/run/judge
// (gated-skip when g++ is unavailable). Confirms correct→pass, wrong→fail,
// compile-error→error, and that UNSUPPORTED signatures (pointers, unknown
// types) SKIP rather than produce a false verdict.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { parseCppSignature, buildCppProgram } from '../../../../dist-electron/electron/llm/codeVerification/cppDriver.js';
import { runCase, localLanguageAvailable } from '../../../../dist-electron/electron/llm/codeVerification/localRunner.js';

const tc = (input, expected, source = 'problem') => ({ input, expected, source });

describe('parseCppSignature (pure)', () => {
  test('parses a free function', () => {
    const s = parseCppSignature('int firstMissingPositive(vector<int>& nums){ return 1; }', 'firstMissingPositive');
    assert.deepEqual(s, { returnType: 'int', params: ['vint'] });
  });
  test('parses a Solution method (spaced and compact)', () => {
    assert.deepEqual(parseCppSignature('class Solution { public: int add(int a, int b){return a+b;} };', 'add'), { returnType: 'int', params: ['int', 'int'] });
    assert.deepEqual(parseCppSignature('class Solution{public:int add(int a,int b){return a+b;}};', 'add'), { returnType: 'int', params: ['int', 'int'] });
  });
  test('parses vector<int> and vector<vector<int>>', () => {
    assert.deepEqual(parseCppSignature('vector<int> twoSum(vector<int>& n, int t){return {};}', 'twoSum'), { returnType: 'vint', params: ['vint', 'int'] });
    assert.deepEqual(parseCppSignature('int f(vector<vector<int>>& g){return 0;}', 'f'), { returnType: 'int', params: ['vvint'] });
  });
  test('REJECTS unknown/unsupported types → null', () => {
    assert.equal(parseCppSignature('MyType compute(int x){return {};}', 'compute'), null);
  });
  test('parses vector<vector<int>> as a RETURN type (nested template)', () => {
    assert.deepEqual(parseCppSignature('vector<vector<int>> transpose(vector<vector<int>>& m){return m;}', 'transpose'),
      { returnType: 'vvint', params: ['vvint'] });
  });
  test('ACCEPTS ListNode*/TreeNode* pointer signatures (now supported)', () => {
    assert.deepEqual(parseCppSignature('class Solution{public:ListNode* reverseList(ListNode* head){return head;}};', 'reverseList'),
      { returnType: 'listnode', params: ['listnode'] });
    assert.deepEqual(parseCppSignature('class Solution{public:int maxDepth(TreeNode* root){return 0;}};', 'maxDepth'),
      { returnType: 'int', params: ['treenode'] });
    assert.deepEqual(parseCppSignature('ListNode* mergeTwoLists(ListNode* a, ListNode* b){return a;}', 'mergeTwoLists'),
      { returnType: 'listnode', params: ['listnode', 'listnode'] });
  });
  test('still REJECTS other pointer types (only ListNode/TreeNode allowed)', () => {
    assert.equal(parseCppSignature('int* foo(int* p){return p;}', 'foo'), null);
    assert.equal(parseCppSignature('char* bar(char* s){return s;}', 'bar'), null);
  });
});

describe('C++ entry validation (no throw, no injection)', () => {
  test('a non-identifier entry is a clean skip, never throws (RegExp-safe)', async () => {
    // parseCppSignature interpolates entry into a RegExp; a regex-special entry
    // must NOT throw out of runCase (which would abort the whole batch).
    for (const bad of ['f(', 'f)', 'a.b', 'f; system("x")', '']) {
      const r = await runCase('cpp', 'int f(int x){return x;}', bad, tc([1], 1));
      assert.equal(r.status, 'error', `entry "${bad}" must be a clean error`);
      assert.equal(r.error, 'invalid_entry');
    }
  });
});

describe('buildCppProgram (pure)', () => {
  test('returns null on arity mismatch', () => {
    assert.equal(buildCppProgram('int add(int a, int b){return a+b;}', 'add', tc([1], 2)), null);
  });
  test('returns null when a value does not fit the declared type', () => {
    assert.equal(buildCppProgram('int add(int a, int b){return a+b;}', 'add', tc(['x', 'y'], 2)), null);
  });
  test('builds a program embedding model code + sentinels for a valid case', () => {
    const p = buildCppProgram('int add(int a, int b){return a+b;}', 'add', tc([2, 3], 5));
    assert.ok(p);
    assert.match(p, /int a0 = 2;/);
    assert.match(p, /int a1 = 3;/);
    assert.match(p, /__NATIVELY_RESULT_START__/);
    assert.doesNotMatch(p, /bits\/stdc\+\+\.h/, 'must use portable headers, not the GCC-only bits header');
  });
});

describe('C++ real execution (g++)', async () => {
  const have = await localLanguageAvailable('cpp');
  const maybe = (name, fn) => test(name, { skip: have ? false : 'g++ unavailable' }, fn);

  maybe('correct Two Sum (Solution method, vector<int>) → pass', async () => {
    const code = 'class Solution { public: vector<int> twoSum(vector<int>& nums, int target){ unordered_map<int,int> m; for(int i=0;i<(int)nums.size();i++){ if(m.count(target-nums[i])) return {m[target-nums[i]],i}; m[nums[i]]=i;} return {}; } };';
    const r = await runCase('cpp', code, 'twoSum', tc([[2, 7, 11, 15], 9], [0, 1]));
    assert.equal(r.status, 'pass', r.error);
  });
  maybe('correct firstMissingPositive (free fn) → pass with actual 3', async () => {
    const code = 'int firstMissingPositive(vector<int>& nums){ int n=nums.size(); for(int i=0;i<n;i++){ while(nums[i]>0&&nums[i]<=n&&nums[nums[i]-1]!=nums[i]) swap(nums[i],nums[nums[i]-1]); } for(int i=0;i<n;i++) if(nums[i]!=i+1) return i+1; return n+1; }';
    const r = await runCase('cpp', code, 'firstMissingPositive', tc([[1, 2, 0]], 3));
    assert.equal(r.status, 'pass', r.error);
    assert.equal(r.actual, 3);
  });
  maybe('wrong output → fail (ran, not error)', async () => {
    const r = await runCase('cpp', 'class Solution{public:int add(int a,int b){return a-b;}};', 'add', tc([2, 3], 5));
    assert.equal(r.status, 'fail');
    assert.match(r.error, /expected 5, got -1/);
  });
  maybe('compile error → error', async () => {
    const r = await runCase('cpp', 'class Solution{public:int f(int x){return x}};', 'f', tc([1], 1)); // missing ;
    assert.equal(r.status, 'error');
    assert.match(r.error, /compile error/);
  });
  maybe('an UNSUPPORTED pointer type (int*) → skipped (cpp_signature_unsupported), never a false verdict', async () => {
    const r = await runCase('cpp', 'class Solution{public:int* rev(int* p){return p;}};', 'rev', tc([1], 1));
    assert.equal(r.status, 'error');
    assert.equal(r.error, 'cpp_signature_unsupported');
  });
  maybe('infinite loop in C++ is killed by the run timeout', async () => {
    const r = await runCase('cpp', 'int f(int x){ while(true){} return x; }', 'f', tc([1], 1));
    assert.equal(r.status, 'error');
    assert.match(r.error, /timed out/);
  });
});

describe('C++ pointer-structure real execution (g++)', async () => {
  const have = await localLanguageAvailable('cpp');
  const maybe = (name, fn) => test(name, { skip: have ? false : 'g++ unavailable' }, fn);

  maybe('Reverse Linked List ([1,2,3,4,5] → [5,4,3,2,1])', async () => {
    const code = 'class Solution{public:ListNode* reverseList(ListNode* head){ListNode* p=nullptr;while(head){auto n=head->next;head->next=p;p=head;head=n;}return p;}};';
    const r = await runCase('cpp', code, 'reverseList', tc([[1, 2, 3, 4, 5]], [5, 4, 3, 2, 1]));
    assert.equal(r.status, 'pass', r.error);
    assert.deepEqual(r.actual, [5, 4, 3, 2, 1]);
  });
  maybe('Merge Two Sorted Lists', async () => {
    const code = 'class Solution{public:ListNode* mergeTwoLists(ListNode* a, ListNode* b){ListNode d(0);ListNode* t=&d;while(a&&b){if(a->val<=b->val){t->next=a;a=a->next;}else{t->next=b;b=b->next;}t=t->next;}t->next=a?a:b;return d.next;}};';
    const r = await runCase('cpp', code, 'mergeTwoLists', tc([[1, 2, 4], [1, 3, 4]], [1, 1, 2, 3, 4, 4]));
    assert.equal(r.status, 'pass', r.error);
  });
  maybe('WRONG linked-list answer is caught (fail, not false pass)', async () => {
    const r = await runCase('cpp', 'class Solution{public:ListNode* reverseList(ListNode* head){return head;}};', 'reverseList', tc([[1, 2, 3]], [3, 2, 1]));
    assert.equal(r.status, 'fail');
  });
  maybe('model-defined ListNode struct does NOT double-define (no compile error)', async () => {
    const code = 'struct ListNode { int val; ListNode* next; ListNode(int x):val(x),next(nullptr){} };\nclass Solution{public:ListNode* reverseList(ListNode* head){ListNode* p=nullptr;while(head){auto n=head->next;head->next=p;p=head;head=n;}return p;}};';
    const r = await runCase('cpp', code, 'reverseList', tc([[1, 2]], [2, 1]));
    assert.equal(r.status, 'pass', r.error);
  });
  maybe('Max Depth of Binary Tree (level-order [3,9,20,null,null,15,7] → 3)', async () => {
    const code = 'class Solution{public:int maxDepth(TreeNode* root){if(!root)return 0;return 1+max(maxDepth(root->left),maxDepth(root->right));}};';
    const r = await runCase('cpp', code, 'maxDepth', tc([[3, 9, 20, null, null, 15, 7]], 3));
    assert.equal(r.status, 'pass', r.error);
    assert.equal(r.actual, 3);
  });
  maybe('Invert Binary Tree (tree → tree, level-order round-trip)', async () => {
    const code = 'class Solution{public:TreeNode* invertTree(TreeNode* root){if(!root)return nullptr;swap(root->left,root->right);invertTree(root->left);invertTree(root->right);return root;}};';
    const r = await runCase('cpp', code, 'invertTree', tc([[4, 2, 7, 1, 3, 6, 9]], [4, 7, 2, 9, 6, 3, 1]));
    assert.equal(r.status, 'pass', r.error);
  });
  maybe('WRONG tree depth is caught', async () => {
    const r = await runCase('cpp', 'class Solution{public:int maxDepth(TreeNode* root){return 1;}};', 'maxDepth', tc([[3, 9, 20, null, null, 15, 7]], 3));
    assert.equal(r.status, 'fail');
  });
  maybe('empty list ([]) builds nullptr safely', async () => {
    const code = 'class Solution{public:ListNode* reverseList(ListNode* head){ListNode* p=nullptr;while(head){auto n=head->next;head->next=p;p=head;head=n;}return p;}};';
    const r = await runCase('cpp', code, 'reverseList', tc([[]], []));
    assert.equal(r.status, 'pass', r.error);
  });
});
