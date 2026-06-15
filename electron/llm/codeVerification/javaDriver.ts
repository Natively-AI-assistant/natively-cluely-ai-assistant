// electron/llm/codeVerification/javaDriver.ts
//
// PURE, signature-aware Java driver generation (GAP 2). Mirrors cppDriver: parse
// the entry's return + parameter types from `class Solution`, build typed Java
// literals from the JSON test input at driver-build time, call the method, and
// serialize the result to the sentinel-delimited JSON the judge expects. Returns
// null for any signature/value we can't represent safely → orchestrator SKIPS
// (never a false verdict). Java is compile-then-run (javac + java), handled by
// localRunner; this module only generates the source.
//
// Supported types (param + return): int, long, double, boolean, String,
// int[], int[][], String[], plus ListNode/TreeNode (LeetCode structures,
// encoded as [1,2,3] / level-order [1,2,null,3]). Anything else → skip.

import type { TestCase } from './types';
import { RESULT_SENTINEL_START, RESULT_SENTINEL_END } from './drivers';

type JType =
  | 'int' | 'long' | 'double' | 'boolean' | 'String'
  | 'intArr' | 'intArr2' | 'StringArr'
  | 'listnode' | 'treenode';

const JAVA_DECL: Record<JType, string> = {
  int: 'int', long: 'long', double: 'double', boolean: 'boolean', String: 'String',
  intArr: 'int[]', intArr2: 'int[][]', StringArr: 'String[]',
  listnode: 'ListNode', treenode: 'TreeNode',
};

const canonicalType = (raw: string): JType | null => {
  const t = raw.replace(/\bfinal\b/g, '').replace(/\s+/g, ' ').trim();
  const norm = t.replace(/\s+/g, '');
  switch (norm) {
    case 'int': return 'int';
    case 'long': return 'long';
    case 'double': case 'float': return 'double';
    case 'boolean': return 'boolean';
    case 'String': return 'String';
    case 'int[]': return 'intArr';
    case 'int[][]': return 'intArr2';
    case 'String[]': return 'StringArr';
    case 'ListNode': return 'listnode';
    case 'TreeNode': return 'treenode';
    default: return null;
  }
};

const isStruct = (t: JType): boolean => t === 'listnode' || t === 'treenode';

interface JSig { returnType: JType; params: JType[] }

// Find `public? <ret> entry(<params>)` inside the model code (class Solution).
export const parseJavaSignature = (code: string, entry: string): JSig | null => {
  const idx = code.search(new RegExp(`\\b${entry}\\s*\\(`));
  if (idx < 0) return null;
  // Return type = the type token(s) immediately before the entry name.
  const before = code.slice(Math.max(0, idx - 120), idx).trim();
  const rt = before.match(/(?:public|private|protected|static|final|\s)*([A-Za-z_][\w.]*(?:\s*\[\s*\]\s*)*|[A-Za-z_][\w.]*)\s*$/);
  if (!rt) return null;
  const returnType = canonicalType(rt[1].replace(/\s+/g, ''));
  if (!returnType) return null;

  const pm = code.slice(idx).match(/\(([^)]*)\)/);
  const paramsRaw = (pm ? pm[1] : '').trim();
  const params: JType[] = [];
  if (paramsRaw) {
    for (const p of splitParams(paramsRaw)) {
      const stripped = p.trim().replace(/=.*$/, '').trim();
      // "<type> <name>" — last token is the name; the rest (incl. []) is the type.
      const parts = stripped.split(/\s+/);
      if (parts.length < 2) return null;
      // Handle "int[] nums" and "int [] nums" and "int nums[]" forms.
      let typeTok = parts.slice(0, -1).join('');
      if (/\[\]$/.test(parts[parts.length - 1])) { typeTok = parts.slice(0, -1).join('') + ''; }
      const ct = canonicalType(typeTok);
      if (!ct) return null;
      params.push(ct);
    }
  }
  return { returnType, params };
};

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

const numArr = (x: unknown): x is number[] => Array.isArray(x) && x.every(n => typeof n === 'number');
const isIntOrNullArr = (x: unknown): x is (number | null)[] =>
  Array.isArray(x) && x.every(n => n === null || (typeof n === 'number' && Number.isInteger(n)));

// Build a Java expression that constructs the argument of the given type.
const javaLiteral = (type: JType, v: unknown): string | null => {
  switch (type) {
    case 'int': case 'long':
      return typeof v === 'number' && Number.isInteger(v) ? (type === 'long' ? `${v}L` : String(v)) : null;
    case 'double':
      return typeof v === 'number' ? `${v}` : null;
    case 'boolean':
      return typeof v === 'boolean' ? String(v) : null;
    case 'String':
      return typeof v === 'string' ? javaStr(v) : null;
    case 'intArr':
      return numArr(v) ? `new int[]{${v.join(',')}}` : null;
    case 'intArr2':
      return Array.isArray(v) && v.every(numArr) ? `new int[][]{${(v as number[][]).map(r => `{${r.join(',')}}`).join(',')}}` : null;
    case 'StringArr':
      return Array.isArray(v) && v.every(s => typeof s === 'string') ? `new String[]{${(v as string[]).map(javaStr).join(',')}}` : null;
    case 'listnode':
      if (v === null) return '(ListNode)null';
      return numArr(v) ? `__natBuildList(new int[]{${v.join(',')}})` : null;
    case 'treenode':
      if (v === null) return '(TreeNode)null';
      return isIntOrNullArr(v) ? `__natBuildTree(new Integer[]{${v.map(x => x === null ? 'null' : String(x)).join(',')}})` : null;
    default: return null;
  }
};

const javaStr = (s: string): string => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';

// Java code that serializes a value of the return type to JSON on stdout (sb).
const javaSerialize = (type: JType, varName: string): string => {
  switch (type) {
    case 'int': case 'long': case 'double':
      return `sb.append(${varName});`;
    case 'boolean':
      return `sb.append(${varName} ? "true" : "false");`;
    case 'String':
      return `__natEmitStr(sb, ${varName});`;
    case 'intArr':
      return `{ sb.append("["); for(int i=0;i<${varName}.length;i++){ if(i>0)sb.append(","); sb.append(${varName}[i]); } sb.append("]"); }`;
    case 'intArr2':
      return `{ sb.append("["); for(int i=0;i<${varName}.length;i++){ if(i>0)sb.append(","); sb.append("["); for(int j=0;j<${varName}[i].length;j++){ if(j>0)sb.append(","); sb.append(${varName}[i][j]); } sb.append("]"); } sb.append("]"); }`;
    case 'StringArr':
      return `{ sb.append("["); for(int i=0;i<${varName}.length;i++){ if(i>0)sb.append(","); __natEmitStr(sb, ${varName}[i]); } sb.append("]"); }`;
    case 'listnode':
      return `__natEmitList(sb, ${varName});`;
    case 'treenode':
      return `__natEmitTree(sb, ${varName});`;
    default: return `sb.append("null");`;
  }
};

const structPreamble = (code: string, usesList: boolean, usesTree: boolean): string => {
  const modelList = /\bclass\s+ListNode\b/.test(code);
  const modelTree = /\bclass\s+TreeNode\b/.test(code);
  const parts: string[] = [];
  if (usesList && !modelList) parts.push(`static class ListNode { int val; ListNode next; ListNode(int x){ val=x; } }`);
  if (usesTree && !modelTree) parts.push(`static class TreeNode { int val; TreeNode left; TreeNode right; TreeNode(int x){ val=x; } }`);
  if (usesList) {
    parts.push(`static ListNode __natBuildList(int[] a){ ListNode d=new ListNode(0); ListNode t=d; for(int x: a){ t.next=new ListNode(x); t=t.next; } return d.next; }`);
    parts.push(`static void __natEmitList(StringBuilder sb, ListNode h){ sb.append("["); boolean f=true; while(h!=null){ if(!f)sb.append(","); sb.append(h.val); f=false; h=h.next; } sb.append("]"); }`);
  }
  if (usesTree) {
    parts.push(`static TreeNode __natBuildTree(Integer[] a){ if(a.length==0||a[0]==null) return null; TreeNode root=new TreeNode(a[0]); java.util.Queue<TreeNode> q=new java.util.LinkedList<>(); q.add(root); int i=1; while(i<a.length&&!q.isEmpty()){ TreeNode n=q.poll(); if(i<a.length){ if(a[i]!=null){ n.left=new TreeNode(a[i]); q.add(n.left);} i++; } if(i<a.length){ if(a[i]!=null){ n.right=new TreeNode(a[i]); q.add(n.right);} i++; } } return root; }`);
    parts.push(`static void __natEmitTree(StringBuilder sb, TreeNode root){ java.util.List<String> out=new java.util.ArrayList<>(); java.util.Queue<TreeNode> q=new java.util.LinkedList<>(); if(root!=null)q.add(root); while(!q.isEmpty()){ TreeNode n=q.poll(); if(n==null)out.add("null"); else { out.add(String.valueOf(n.val)); q.add(n.left); q.add(n.right);} } int e=out.size(); while(e>0&&out.get(e-1).equals("null"))e--; sb.append("["); for(int k=0;k<e;k++){ if(k>0)sb.append(","); sb.append(out.get(k)); } sb.append("]"); }`);
  }
  return parts.join('\n  ');
};

/**
 * Build a complete Main.java that wraps the model's `class Solution`, calls
 * `entry` with the case's typed arguments, and prints the sentinel-delimited
 * JSON result. Returns null when the signature/args aren't safely representable.
 */
export const buildJavaProgram = (code: string, entry: string, tc: TestCase): string | null => {
  const sig = parseJavaSignature(code, entry);
  if (!sig) return null;
  const args = tc.input ?? [];
  if (args.length !== sig.params.length) return null;

  const decls: string[] = [];
  const callArgs: string[] = [];
  for (let i = 0; i < sig.params.length; i++) {
    const lit = javaLiteral(sig.params[i], args[i]);
    if (lit === null) return null;
    decls.push(`      ${JAVA_DECL[sig.params[i]]} a${i} = ${lit};`);
    callArgs.push(`a${i}`);
  }

  const usesList = sig.returnType === 'listnode' || sig.params.includes('listnode');
  const usesTree = sig.returnType === 'treenode' || sig.params.includes('treenode');
  const preamble = structPreamble(code, usesList, usesTree);

  return `import java.util.*;

public class Main {
  ${preamble}

  ${code}

  static Main __natMain(){ return new Main(); }

  static void __natEmitStr(StringBuilder sb, String s){ sb.append('"'); for(char c: s.toCharArray()){ if(c=='"'||c=='\\\\') sb.append('\\\\'); sb.append(c);} sb.append('"'); }

  public static void main(String[] args) {
    try {
${decls.join('\n')}
      ${JAVA_DECL[sig.returnType] === 'void' ? '' : ''}var __res = __natMain().new Solution().${entry}(${callArgs.join(', ')});
      StringBuilder sb = new StringBuilder();
      ${javaSerialize(sig.returnType, '__res')}
      System.out.print("${RESULT_SENTINEL_START}" + sb.toString() + "${RESULT_SENTINEL_END}");
    } catch (Throwable t) {
      System.err.print("runtime error: " + t);
      System.exit(3);
    }
  }
}
`;
};
