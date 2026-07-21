// electron/llm/codeVerification/goDriver.ts
//
// PURE, signature-aware Go driver generation (GAP A). Mirrors cppDriver/
// javaDriver: parse `func entry(params) ret`, build typed Go literals from JSON
// args, call entry, serialize the result to sentinel-delimited JSON. Returns
// null for any signature/value we can't represent safely → orchestrator SKIPS
// (never a false verdict). Go LeetCode uses FREE functions (no receiver) and
// exported struct fields (Val/Next/Left/Right). Compile+run via `go run`
// (handled by localRunner.runGoCase).
//
// Supported (param + return): int, int64, float64, bool, string, []int,
// [][]int, []string, *ListNode, *TreeNode. Anything else → skip.

import type { TestCase } from './types';
import { RESULT_SENTINEL_START, RESULT_SENTINEL_END } from './drivers';

type GoType =
  | 'int' | 'int64' | 'float64' | 'bool' | 'string'
  | 'sliceInt' | 'sliceSliceInt' | 'sliceString'
  | 'listnode' | 'treenode';

const GO_DECL: Record<GoType, string> = {
  int: 'int', int64: 'int64', float64: 'float64', bool: 'bool', string: 'string',
  sliceInt: '[]int', sliceSliceInt: '[][]int', sliceString: '[]string',
  listnode: '*ListNode', treenode: '*TreeNode',
};

const canonicalType = (raw: string): GoType | null => {
  const t = raw.replace(/\s+/g, '');
  switch (t) {
    case 'int': return 'int';
    case 'int64': return 'int64';
    case 'float64': case 'float32': return 'float64';
    case 'bool': return 'bool';
    case 'string': return 'string';
    case '[]int': return 'sliceInt';
    case '[][]int': return 'sliceSliceInt';
    case '[]string': return 'sliceString';
    case '*ListNode': return 'listnode';
    case '*TreeNode': return 'treenode';
    default: return null;
  }
};

const isStruct = (t: GoType): boolean => t === 'listnode' || t === 'treenode';
const isSlice = (t: GoType): boolean => t === 'sliceInt' || t === 'sliceSliceInt' || t === 'sliceString';

interface GoSig { returnType: GoType; params: GoType[] }

/**
 * Parse `func <entry>(params) ret {`. Go params are `name type` (name FIRST),
 * with the shared-type shorthand `func f(a, b int)` (names listed, type once at
 * the end of the group). Returns null on unsupported/unparseable signatures.
 */
export const parseGoSignature = (code: string, entry: string): GoSig | null => {
  const m = code.match(new RegExp(`func\\s+${entry}\\s*\\(([^)]*)\\)\\s*([^{]*)\\{`));
  if (!m) return null;
  const paramsRaw = m[1].trim();
  const retRaw = m[2].trim();

  // Multiple return values (e.g. "(int, error)") are unsupported → skip.
  if (/^\(/.test(retRaw)) return null;
  const returnType = retRaw === '' ? null : canonicalType(retRaw);
  if (!returnType) return null; // void / unsupported return → skip

  const params: GoType[] = [];
  if (paramsRaw) {
    // Split on top-level commas. Each group is either "name type" or, for the
    // shorthand, several "name"s sharing the trailing group's type. We resolve
    // right-to-left: a group with a type sets the pending type for bare-name
    // groups to its left.
    const groups = splitParams(paramsRaw).map(s => s.trim()).filter(Boolean);
    const resolved: (GoType | null)[] = new Array(groups.length).fill(null);
    let pending: GoType | null = null;
    for (let i = groups.length - 1; i >= 0; i--) {
      const parts = groups[i].split(/\s+/);
      if (parts.length >= 2) {
        const typeTok = parts.slice(1).join('');
        const ct = canonicalType(typeTok);
        if (!ct) return null;
        resolved[i] = ct;
        pending = ct;
      } else {
        // bare name → takes the pending (to-the-right) type
        if (!pending) return null;
        resolved[i] = pending;
      }
    }
    for (const r of resolved) { if (!r) return null; params.push(r); }
  }
  return { returnType, params };
};

const splitParams = (s: string): string[] => {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
};

const numArr = (x: unknown): x is number[] => Array.isArray(x) && x.every(n => typeof n === 'number');
const isIntOrNullArr = (x: unknown): x is (number | null)[] =>
  Array.isArray(x) && x.every(n => n === null || (typeof n === 'number' && Number.isInteger(n)));

// Build a Go expression constructing the argument of the given type.
const goLiteral = (type: GoType, v: unknown): string | null => {
  switch (type) {
    case 'int': case 'int64':
      return typeof v === 'number' && Number.isInteger(v) ? String(v) : null;
    case 'float64':
      return typeof v === 'number' ? String(v) : null;
    case 'bool':
      return typeof v === 'boolean' ? String(v) : null;
    case 'string':
      return typeof v === 'string' ? goStr(v) : null;
    case 'sliceInt':
      return numArr(v) ? `[]int{${v.join(',')}}` : null;
    case 'sliceSliceInt':
      return Array.isArray(v) && v.every(numArr) ? `[][]int{${(v as number[][]).map(r => `{${r.join(',')}}`).join(',')}}` : null;
    case 'sliceString':
      return Array.isArray(v) && v.every(s => typeof s === 'string') ? `[]string{${(v as string[]).map(goStr).join(',')}}` : null;
    case 'listnode':
      if (v === null) return '(*ListNode)(nil)';
      return numArr(v) ? `__natBuildList([]int{${v.join(',')}})` : null;
    case 'treenode':
      if (v === null) return '(*TreeNode)(nil)';
      return isIntOrNullArr(v) ? `__natBuildTree([]interface{}{${v.map(x => x === null ? 'nil' : String(x)).join(',')}})` : null;
    default: return null;
  }
};

const goStr = (s: string): string => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';

// Go code that prints the JSON serialization of the result to stdout.
const goSerialize = (type: GoType, varName: string): string => {
  switch (type) {
    case 'listnode': return `__natEmitList(${varName})`;
    case 'treenode': return `__natEmitTree(${varName})`;
    case 'int': case 'int64': case 'float64':
      return `fmt.Print(${varName})`;
    case 'bool':
      return `if ${varName} { fmt.Print("true") } else { fmt.Print("false") }`;
    case 'string':
      return `__natEmitStr(${varName})`;
    case 'sliceInt': case 'sliceSliceInt': case 'sliceString':
      // json.Marshal of a nil slice yields "null"; normalize to the non-nil
      // form so an empty result compares against [] (LeetCode convention).
      return `__natEmitJSON(${varName})`;
    default: return `fmt.Print("null")`;
  }
};

const structPreamble = (code: string, usesList: boolean, usesTree: boolean): { structs: string; helpers: string } => {
  const modelList = /type\s+ListNode\s+struct/.test(code);
  const modelTree = /type\s+TreeNode\s+struct/.test(code);
  const structs: string[] = [];
  const helpers: string[] = [];
  if (usesList) {
    if (!modelList) structs.push(`type ListNode struct { Val int; Next *ListNode }`);
    helpers.push(`func __natBuildList(a []int) *ListNode { d := &ListNode{}; t := d; for _, x := range a { t.Next = &ListNode{Val: x}; t = t.Next }; return d.Next }`);
    helpers.push(`func __natEmitList(h *ListNode) { fmt.Print("["); first := true; for h != nil { if !first { fmt.Print(",") }; fmt.Print(h.Val); first = false; h = h.Next }; fmt.Print("]") }`);
  }
  if (usesTree) {
    if (!modelTree) structs.push(`type TreeNode struct { Val int; Left *TreeNode; Right *TreeNode }`);
    helpers.push(`func __natBuildTree(a []interface{}) *TreeNode { if len(a) == 0 || a[0] == nil { return nil }; root := &TreeNode{Val: a[0].(int)}; q := []*TreeNode{root}; i := 1; for i < len(a) && len(q) > 0 { n := q[0]; q = q[1:]; if i < len(a) { if a[i] != nil { n.Left = &TreeNode{Val: a[i].(int)}; q = append(q, n.Left) }; i++ }; if i < len(a) { if a[i] != nil { n.Right = &TreeNode{Val: a[i].(int)}; q = append(q, n.Right) }; i++ } }; return root }`);
    helpers.push(`func __natEmitTree(root *TreeNode) { out := []string{}; q := []*TreeNode{}; if root != nil { q = append(q, root) }; for len(q) > 0 { n := q[0]; q = q[1:]; if n == nil { out = append(out, "null") } else { out = append(out, fmt.Sprintf("%d", n.Val)); q = append(q, n.Left); q = append(q, n.Right) } }; e := len(out); for e > 0 && out[e-1] == "null" { e-- }; fmt.Print("["); for k := 0; k < e; k++ { if k > 0 { fmt.Print(",") }; fmt.Print(out[k]) }; fmt.Print("]") }`);
  }
  return { structs: structs.join('\n'), helpers: helpers.join('\n') };
};

/**
 * Build a complete `package main` Go program calling `entry` with this case's
 * typed args and printing sentinel-delimited JSON. null when unrepresentable.
 */
export const buildGoProgram = (code: string, entry: string, tc: TestCase): string | null => {
  const sig = parseGoSignature(code, entry);
  if (!sig) return null;
  const args = tc.input ?? [];
  if (args.length !== sig.params.length) return null;

  const decls: string[] = [];
  const callArgs: string[] = [];
  for (let i = 0; i < sig.params.length; i++) {
    const lit = goLiteral(sig.params[i], args[i]);
    if (lit === null) return null;
    decls.push(`\ta${i} := ${lit}`);
    callArgs.push(`a${i}`);
  }

  const usesList = sig.returnType === 'listnode' || sig.params.includes('listnode');
  const usesTree = sig.returnType === 'treenode' || sig.params.includes('treenode');
  const { structs, helpers } = structPreamble(code, usesList, usesTree);
  const retSlice = isSlice(sig.returnType);
  const retString = sig.returnType === 'string';
  // `encoding/json` is used only by the slice (nil→[] normalize) and string
  // emitters; import it only when needed (Go errors on unused imports).
  const needsJSON = retSlice || retString;

  const emitters: string[] = [];
  if (retString) emitters.push(`func __natEmitStr(s string) { b, _ := json.Marshal(s); fmt.Print(string(b)) }`);
  if (retSlice) emitters.push(`func __natEmitJSON(v interface{}) {
\trv := v
\tswitch t := v.(type) {
\tcase []int:
\t\tif t == nil { rv = []int{} }
\tcase [][]int:
\t\tif t == nil { rv = [][]int{} }
\tcase []string:
\t\tif t == nil { rv = []string{} }
\t}
\tb, _ := json.Marshal(rv)
\tfmt.Print(string(b))
}`);

  return `package main

import (
\t"fmt"${needsJSON ? '\n\t"encoding/json"' : ''}
)

${structs}

${code}

${helpers}

${emitters.join('\n')}

func main() {
${decls.join('\n')}
\t__res := ${callArgs.length ? `${entry}(${callArgs.join(', ')})` : `${entry}()`}
\tfmt.Print("${RESULT_SENTINEL_START}")
\t${goSerialize(sig.returnType, '__res')}
\tfmt.Print("${RESULT_SENTINEL_END}")
}
`;
};
