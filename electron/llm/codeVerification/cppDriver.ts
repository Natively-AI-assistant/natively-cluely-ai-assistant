// electron/llm/codeVerification/cppDriver.ts
//
// PURE, signature-aware C++ driver generation. C++ is statically typed, so to
// CALL the model's entry we must know its parameter and return types and build
// typed literals from the JSON test input at driver-build time (no JSON parser
// in C++). We support the COMMON LeetCode value shapes and DELIBERATELY SKIP
// anything we can't represent safely (pointers like ListNode*/TreeNode*,
// unknown types) — returning null so the orchestrator skips rather than risking
// a false verdict. "Never a wrong verdict" beats "more coverage".
//
// Supported types (param + return): int, long, long long, double, bool,
// string, vector<int>, vector<vector<int>>, vector<string>, vector<bool>.

import type { TestCase } from './types';
import { RESULT_SENTINEL_START, RESULT_SENTINEL_END } from './drivers';

type CppType =
  | 'int' | 'long' | 'longlong' | 'double' | 'bool' | 'string'
  | 'vint' | 'vvint' | 'vstring' | 'vbool'
  // Pointer-structure types (LeetCode linked list / binary tree). Encoded in
  // test cases as JSON: list = [1,2,3]; tree = level-order [1,2,3,null,null,4,5].
  | 'listnode' | 'treenode';

const CPP_DECL: Record<CppType, string> = {
  int: 'int', long: 'long', longlong: 'long long', double: 'double', bool: 'bool',
  string: 'std::string', vint: 'std::vector<int>', vvint: 'std::vector<std::vector<int>>',
  vstring: 'std::vector<std::string>', vbool: 'std::vector<bool>',
  listnode: 'ListNode*', treenode: 'TreeNode*',
};

// Map a raw C++ type token (as written in the signature) to our canonical type.
// `*` is stripped here because pointer-ness for ListNode/TreeNode is the SUPPORTED
// case (handled below); a `*` on any OTHER type is rejected by the caller.
const canonicalType = (raw: string): CppType | null => {
  const t = raw.replace(/\s+/g, ' ').replace(/[&*]/g, '').trim().replace(/\bconst\b/g, '').trim();
  const norm = t.replace(/\s+/g, '');
  switch (norm) {
    case 'int': return 'int';
    case 'long': return 'long';
    case 'longlong': case 'long long': return 'longlong';
    case 'double': case 'float': return 'double';
    case 'bool': return 'bool';
    case 'string': case 'std::string': return 'string';
    case 'vector<int>': case 'std::vector<int>': return 'vint';
    case 'vector<vector<int>>': case 'std::vector<std::vector<int>>': case 'vector<vector<int> >': return 'vvint';
    case 'vector<string>': case 'std::vector<std::string>': return 'vstring';
    case 'vector<bool>': case 'std::vector<bool>': return 'vbool';
    case 'ListNode': return 'listnode';
    case 'TreeNode': return 'treenode';
    default: return null;
  }
};

const isPointerStruct = (t: CppType): boolean => t === 'listnode' || t === 'treenode';

interface Sig { returnType: CppType; params: CppType[] }

// Find `returnType entry(params)` either as a method in `class Solution` or a
// free function. Returns null when the signature isn't parseable/supported.
//
// Return-type capture: grab the run of type tokens IMMEDIATELY before `entry(`.
// A C++ type is `[std::]word` optionally with a `<...>` template and trailing
// `*`/`&`. We capture that minimal token group, not everything since the class
// brace (which would wrongly include `public:` etc.).
export const parseCppSignature = (code: string, entry: string): Sig | null => {
  // Locate `entry(` then read the return type BACKWARD (the trailing type token
  // immediately before the name) and the params forward. Backward capture
  // avoids wrongly swallowing `public:`/class text before the type.
  const idx = code.search(new RegExp(`\\b${entry}\\s*\\(`));
  if (idx < 0) return null;
  const before = code.slice(Math.max(0, idx - 100), idx).trim();
  // A type token is an identifier with optional `::` namespace segments and an
  // optional template that allows ONE level of nesting so `vector<vector<int>>`
  // parses as a RETURN type (common for matrix problems), not just as a param.
  // A bare single `:` (from `public:`) is NOT part of a type, so we match
  // `(?:::\w+)*` rather than putting `:` in the char class — otherwise
  // `public:int` is wrongly read as one token.
  const TYPE = String.raw`[A-Za-z_]\w*(?:::\w+)*(?:\s*<[^<>]*(?:<[^<>]*>[^<>]*)?>)?`;
  const rt = before.match(new RegExp(`(${TYPE})\\s*([*&]?)\\s*$`));
  if (!rt) return null;
  const returnType = canonicalType(rt[1]);
  if (!returnType) return null;
  // A `*` is permitted ONLY for ListNode/TreeNode (the supported pointer
  // structures). A pointer on any other type is unsupported → skip.
  if (rt[2] === '*' && !isPointerStruct(returnType)) return null;
  if (rt[2] !== '*' && isPointerStruct(returnType)) return null; // ListNode/TreeNode must be a pointer

  const pm = code.slice(idx).match(/\(([^)]*)\)/);
  const paramsRaw = (pm ? pm[1] : '').trim();
  const params: CppType[] = [];
  if (paramsRaw) {
    for (const p of splitParams(paramsRaw)) {
      // Each param: "<type> <name>" — type is everything but the last identifier.
      const stripped = p.trim().replace(/=.*$/, '').trim();
      const hasPtr = /\*/.test(stripped);
      const parts = stripped.replace(/\*/g, ' ').split(/\s+/).filter(Boolean);
      if (parts.length < 2) return null;
      const typeTok = parts.slice(0, -1).join(' ');
      const ct = canonicalType(typeTok);
      if (!ct) return null;
      // Same pointer rule per-param.
      if (hasPtr && !isPointerStruct(ct)) return null;
      if (!hasPtr && isPointerStruct(ct)) return null;
      params.push(ct);
    }
  }
  return { returnType, params };
};

// Split a parameter list on top-level commas (not inside <...>).
const splitParams = (s: string): string[] => {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '<') depth++;
    else if (ch === '>') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
};

// A null-allowed integer array (for level-order tree encoding). null = absent node.
const isIntOrNullArr = (x: unknown): x is (number | null)[] =>
  Array.isArray(x) && x.every(n => n === null || (typeof n === 'number' && Number.isInteger(n)));

// Render a JSON value as a C++ EXPRESSION that constructs the typed argument.
// For pointer structures this is a builder call (__nat_build_list/tree) fed a
// brace-init vector; for value types it's a literal. Returns null on mismatch.
const cppLiteral = (type: CppType, v: unknown): string | null => {
  const numArr = (x: unknown): x is number[] => Array.isArray(x) && x.every(n => typeof n === 'number');
  switch (type) {
    case 'listnode':
      // [1,2,3] → ListNode*. Empty list [] / null → nullptr.
      if (v === null) return '(ListNode*)nullptr';
      return numArr(v) ? `__nat_build_list({${v.join(',')}})` : null;
    case 'treenode':
      // level-order [1,2,null,3] → TreeNode*. null/[] → nullptr.
      if (v === null) return '(TreeNode*)nullptr';
      return isIntOrNullArr(v) ? `__nat_build_tree({${v.map(x => x === null ? 'INT_MIN' : String(x)).join(',')}})` : null;
  }
  switch (type) {
    case 'int': case 'long': case 'longlong':
      return typeof v === 'number' && Number.isInteger(v) ? String(v) : null;
    case 'double':
      return typeof v === 'number' ? String(v) : null;
    case 'bool':
      return typeof v === 'boolean' ? String(v) : null;
    case 'string':
      return typeof v === 'string' ? cppStr(v) : null;
    case 'vint':
      return numArr(v) ? `{${v.join(',')}}` : null;
    case 'vbool':
      return Array.isArray(v) && v.every(b => typeof b === 'boolean') ? `{${v.map(String).join(',')}}` : null;
    case 'vstring':
      return Array.isArray(v) && v.every(s => typeof s === 'string') ? `{${(v as string[]).map(cppStr).join(',')}}` : null;
    case 'vvint':
      return Array.isArray(v) && v.every(numArr) ? `{${(v as number[][]).map(row => `{${row.join(',')}}`).join(',')}}` : null;
    default: return null;
  }
};

const cppStr = (s: string): string => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';

// Code that serializes a value of the return type to JSON on stdout.
const cppSerialize = (type: CppType, varName: string): string => {
  switch (type) {
    case 'listnode':
      return `__nat_emit_list(${varName});`;
    case 'treenode':
      return `__nat_emit_tree(${varName});`;
    case 'int': case 'long': case 'longlong': case 'double':
      return `std::cout << ${varName};`;
    case 'bool':
      return `std::cout << (${varName} ? "true" : "false");`;
    case 'string':
      return `__nat_emit_str(${varName});`;
    case 'vint':
      return `{ std::cout << "["; for (size_t i=0;i<${varName}.size();++i){ if(i)std::cout<<","; std::cout<<${varName}[i]; } std::cout << "]"; }`;
    case 'vbool':
      return `{ std::cout << "["; for (size_t i=0;i<${varName}.size();++i){ if(i)std::cout<<","; std::cout<<(${varName}[i]?"true":"false"); } std::cout << "]"; }`;
    case 'vstring':
      return `{ std::cout << "["; for (size_t i=0;i<${varName}.size();++i){ if(i)std::cout<<","; __nat_emit_str(${varName}[i]); } std::cout << "]"; }`;
    case 'vvint':
      return `{ std::cout << "["; for (size_t i=0;i<${varName}.size();++i){ if(i)std::cout<<","; std::cout<<"["; for(size_t j=0;j<${varName}[i].size();++j){ if(j)std::cout<<","; std::cout<<${varName}[i][j]; } std::cout<<"]"; } std::cout << "]"; }`;
    default: return `std::cout << "null";`;
  }
};

// Harness preamble for ListNode/TreeNode problems: struct defs + build/serialize
// helpers. CRITICAL: LeetCode-style solutions OFTEN include their own
// `struct ListNode {...}` / `struct TreeNode {...}`. Defining them again would be
// a redefinition compile error → false 'error' verdict. So we DETECT the model's
// own definition and only define the struct it didn't. The helper functions
// (__nat_build_*/__nat_emit_*) are always ours (uniquely named, no collision).
// Tree level-order uses INT_MIN as the "null node" sentinel in the int vector.
// Returns the STRUCT defs (emitted BEFORE the model code) and the build/serialize
// HELPERS (emitted AFTER the model code). Splitting matters: when the model
// defines its OWN ListNode/TreeNode, our helpers must appear AFTER that
// definition so they reference a declared type — emitting a helper that uses
// `ListNode` before the model's struct would be a compile error.
const pointerStructPreamble = (code: string, usesList: boolean, usesTree: boolean): { structs: string; helpers: string } => {
  const modelDefinesList = /struct\s+ListNode\b|class\s+ListNode\b/.test(code);
  const modelDefinesTree = /struct\s+TreeNode\b|class\s+TreeNode\b/.test(code);
  const structs: string[] = [];
  const helpers: string[] = [];

  if (usesList) {
    if (!modelDefinesList) {
      structs.push(`struct ListNode { int val; ListNode* next; ListNode(int x): val(x), next(nullptr) {} };`);
    }
    helpers.push(`static ListNode* __nat_build_list(const std::vector<int>& v){ ListNode dummy(0); ListNode* t=&dummy; for(int x: v){ t->next=new ListNode(x); t=t->next; } return dummy.next; }`);
    helpers.push(`static void __nat_emit_list(ListNode* h){ std::cout<<"["; bool f=true; while(h){ if(!f)std::cout<<","; std::cout<<h->val; f=false; h=h->next; } std::cout<<"]"; }`);
  }
  if (usesTree) {
    if (!modelDefinesTree) {
      structs.push(`struct TreeNode { int val; TreeNode* left; TreeNode* right; TreeNode(int x): val(x), left(nullptr), right(nullptr) {} };`);
    }
    // Build from level-order with INT_MIN as the null sentinel.
    helpers.push(`static TreeNode* __nat_build_tree(const std::vector<int>& v){ if(v.empty()||v[0]==INT_MIN) return nullptr; TreeNode* root=new TreeNode(v[0]); std::queue<TreeNode*> q; q.push(root); size_t i=1; while(i<v.size()&&!q.empty()){ TreeNode* n=q.front(); q.pop(); if(i<v.size()){ if(v[i]!=INT_MIN){ n->left=new TreeNode(v[i]); q.push(n->left);} i++; } if(i<v.size()){ if(v[i]!=INT_MIN){ n->right=new TreeNode(v[i]); q.push(n->right);} i++; } } return root; }`);
    // Serialize back to LeetCode level-order, trimming trailing nulls.
    helpers.push(`static void __nat_emit_tree(TreeNode* root){ std::vector<std::string> out; std::queue<TreeNode*> q; if(root)q.push(root); while(!q.empty()){ TreeNode* n=q.front(); q.pop(); if(n){ out.push_back(std::to_string(n->val)); q.push(n->left); q.push(n->right);} else out.push_back("null"); } while(!out.empty()&&out.back()=="null") out.pop_back(); std::cout<<"["; for(size_t i=0;i<out.size();++i){ if(i)std::cout<<","; std::cout<<out[i]; } std::cout<<"]"; }`);
  }
  return { structs: structs.join('\n'), helpers: helpers.join('\n') };
};

/**
 * Build a complete, compilable C++ program that calls `entry` with this case's
 * arguments and prints the sentinel-delimited JSON result. Returns null when the
 * signature/args aren't safely representable (→ orchestrator skips, no false
 * verdict). The model code is included verbatim; the driver is templated.
 */
export const buildCppProgram = (code: string, entry: string, tc: TestCase): string | null => {
  const sig = parseCppSignature(code, entry);
  if (!sig) return null;
  const args = tc.input ?? [];
  if (args.length !== sig.params.length) return null; // arity mismatch → skip

  const decls: string[] = [];
  const callArgs: string[] = [];
  for (let i = 0; i < sig.params.length; i++) {
    const lit = cppLiteral(sig.params[i], args[i]);
    if (lit === null) return null; // value doesn't fit the declared type → skip
    // Pointer structs are a builder CALL returning a typed pointer → `auto` is
    // correct and avoids spelling `ListNode*`. Value types need their EXACT
    // declared type: `auto a = {1,2}` deduces initializer_list (won't bind to
    // `vector<int>&`), so we must write `std::vector<int> a = {1,2}`.
    const decl = isPointerStruct(sig.params[i])
      ? `    auto a${i} = ${lit};`
      : `    ${CPP_DECL[sig.params[i]]} a${i} = ${lit};`;
    decls.push(decl);
    callArgs.push(`a${i}`);
  }

  const usesList = sig.returnType === 'listnode' || sig.params.includes('listnode');
  const usesTree = sig.returnType === 'treenode' || sig.params.includes('treenode');
  const { structs, helpers } = pointerStructPreamble(code, usesList, usesTree);

  const isMethod = new RegExp(`class\\s+Solution\\b`).test(code);
  const callExpr = isMethod ? `Solution().${entry}(${callArgs.join(', ')})` : `${entry}(${callArgs.join(', ')})`;

  // Portable header set (Apple clang has no <bits/stdc++.h>). Covers the
  // containers/algorithms typical LeetCode solutions use.
  return `#include <iostream>
#include <vector>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <map>
#include <set>
#include <queue>
#include <stack>
#include <deque>
#include <list>
#include <array>
#include <tuple>
#include <bitset>
#include <functional>
#include <utility>
#include <algorithm>
#include <climits>
#include <cmath>
#include <numeric>
#include <sstream>
using namespace std;

${structs}
${code}
${helpers}

static void __nat_emit_str(const std::string& s){ std::cout << '"'; for(char c: s){ if(c=='"'||c=='\\\\') std::cout<<'\\\\'; std::cout<<c; } std::cout << '"'; }

int main(){
${decls.join('\n')}
    auto __res = ${callExpr};
    std::cout << "${RESULT_SENTINEL_START}";
    ${cppSerialize(sig.returnType, '__res')}
    std::cout << "${RESULT_SENTINEL_END}";
    return 0;
}
`;
};
