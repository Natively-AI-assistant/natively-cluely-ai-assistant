// electron/llm/codeVerification/__tests__/StructHints.test.mjs
//
// Python/JS linked-list & binary-tree verification via the spec's argTypes/
// retType hints (GAP 1 for dynamically-typed languages). Real execution, gated
// on python3/node. Also pins backward-compat: no hints → plain JSON values.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { runCase, localLanguageAvailable } from '../../../../dist-electron/electron/llm/codeVerification/localRunner.js';
import { extractVerificationSpec } from '../../../../dist-electron/electron/llm/codeVerification/extractTests.js';

const tc = (input, expected, source = 'problem') => ({ input, expected, source });

describe('extractVerificationSpec parses argTypes/retType (sanitized)', () => {
  test('valid hints round-trip; junk → value', () => {
    const a = `<verification_spec>{"entry":"f","language":"python","argTypes":["list","junk","tree"],"retType":"list","cases":[]}</verification_spec>`;
    const { spec } = extractVerificationSpec(a);
    assert.deepEqual(spec.argTypes, ['list', 'value', 'tree']);
    assert.equal(spec.retType, 'list');
  });
  test('absent hints → undefined (backward compatible)', () => {
    const { spec } = extractVerificationSpec(`<verification_spec>{"entry":"f","language":"python","cases":[]}</verification_spec>`);
    assert.equal(spec.argTypes, undefined);
    assert.equal(spec.retType, undefined);
  });
});

describe('Python list/tree via hints (real execution)', async () => {
  const have = await localLanguageAvailable('python');
  const maybe = (n, f) => test(n, { skip: have ? false : 'python3 unavailable' }, f);
  const H = (argTypes, retType) => ({ argTypes, retType });

  maybe('Reverse Linked List (list→list)', async () => {
    const code = 'def reverseList(head):\n    prev=None\n    while head:\n        nx=head.next; head.next=prev; prev=head; head=nx\n    return prev';
    const r = await runCase('python', code, 'reverseList', tc([[1, 2, 3, 4, 5]], [5, 4, 3, 2, 1]), H(['list'], 'list'));
    assert.equal(r.status, 'pass', r.error);
    assert.deepEqual(r.actual, [5, 4, 3, 2, 1]);
  });
  maybe('Max Depth (tree→int)', async () => {
    const code = 'def maxDepth(root):\n    if not root: return 0\n    return 1+max(maxDepth(root.left),maxDepth(root.right))';
    const r = await runCase('python', code, 'maxDepth', tc([[3, 9, 20, null, null, 15, 7]], 3), H(['tree'], 'value'));
    assert.equal(r.status, 'pass', r.error);
  });
  maybe('Invert Tree (tree→tree, round-trip)', async () => {
    const code = 'def invertTree(root):\n    if not root: return None\n    root.left,root.right=invertTree(root.right),invertTree(root.left)\n    return root';
    const r = await runCase('python', code, 'invertTree', tc([[4, 2, 7, 1, 3, 6, 9]], [4, 7, 2, 9, 6, 3, 1]), H(['tree'], 'tree'));
    assert.equal(r.status, 'pass', r.error);
  });
  maybe('WRONG linked-list answer is caught', async () => {
    const r = await runCase('python', 'def reverseList(head): return head', 'reverseList', tc([[1, 2, 3]], [3, 2, 1]), H(['list'], 'list'));
    assert.equal(r.status, 'fail');
  });
  maybe('model that defines its OWN ListNode is not clobbered', async () => {
    const code = 'class ListNode:\n    def __init__(self,val=0,next=None): self.val=val; self.next=next\ndef reverseList(head):\n    prev=None\n    while head:\n        nx=head.next; head.next=prev; prev=head; head=nx\n    return prev';
    const r = await runCase('python', code, 'reverseList', tc([[1, 2]], [2, 1]), H(['list'], 'list'));
    assert.equal(r.status, 'pass', r.error);
  });
  maybe('NO hints → plain values unchanged (backward compat)', async () => {
    const code = 'def twoSum(nums,t):\n    seen={}\n    for i,x in enumerate(nums):\n        if t-x in seen: return [seen[t-x],i]\n        seen[x]=i\n    return []';
    const r = await runCase('python', code, 'twoSum', tc([[2, 7, 11, 15], 9], [0, 1]));
    assert.equal(r.status, 'pass', r.error);
  });
});

describe('JavaScript list/tree via hints (real execution)', async () => {
  const have = await localLanguageAvailable('javascript');
  const maybe = (n, f) => test(n, { skip: have ? false : 'node unavailable' }, f);
  const H = (argTypes, retType) => ({ argTypes, retType });

  maybe('Reverse Linked List (list→list)', async () => {
    const code = 'function reverseList(head){let prev=null;while(head){const nx=head.next;head.next=prev;prev=head;head=nx;}return prev;}';
    const r = await runCase('javascript', code, 'reverseList', tc([[1, 2, 3]], [3, 2, 1]), H(['list'], 'list'));
    assert.equal(r.status, 'pass', r.error);
  });
  maybe('Merge Two Sorted Lists (list,list→list)', async () => {
    const code = 'function mergeTwoLists(a,b){const d=new globalThis.ListNode(0);let t=d;while(a&&b){if(a.val<=b.val){t.next=a;a=a.next;}else{t.next=b;b=b.next;}t=t.next;}t.next=a||b;return d.next;}';
    const r = await runCase('javascript', code, 'mergeTwoLists', tc([[1, 2, 4], [1, 3, 4]], [1, 1, 2, 3, 4, 4]), H(['list', 'list'], 'list'));
    assert.equal(r.status, 'pass', r.error);
  });
  maybe('Max Depth (tree→int)', async () => {
    const code = 'function maxDepth(root){if(!root)return 0;return 1+Math.max(maxDepth(root.left),maxDepth(root.right));}';
    const r = await runCase('javascript', code, 'maxDepth', tc([[3, 9, 20, null, null, 15, 7]], 3), H(['tree'], 'value'));
    assert.equal(r.status, 'pass', r.error);
  });
});
