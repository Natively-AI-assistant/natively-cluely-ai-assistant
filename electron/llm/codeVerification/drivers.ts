// electron/llm/codeVerification/drivers.ts
//
// PURE, templated per-language driver generation. A driver wraps the model's
// code (a function/method `entry`) in a runnable program that reads ONE test
// case's argument list from a JSON env var, calls `entry(*args)`, and prints
// `JSON` of the return value on a sentinel-delimited line so the runner can
// parse it unambiguously. The driver is NEVER model-generated, so it cannot
// introduce bugs into the thing under test.
//
// Design choices:
//   - Args come via an env var (NATIVELY_TC), NOT interpolated into source, so a
//     test input can never break out into code (no injection, no quoting bugs).
//   - The result is printed between RESULT_SENTINEL markers so arbitrary user
//     prints (debug output) don't confuse the judge.

import type { TestCase, VerifyLanguage } from './types';

export const RESULT_SENTINEL_START = '__NATIVELY_RESULT_START__';
export const RESULT_SENTINEL_END = '__NATIVELY_RESULT_END__';
export const TC_ENV = 'NATIVELY_TC';

export interface Driver {
  /** Full source to write to a temp file and execute. */
  source: string;
  /** File extension (no dot). */
  ext: string;
  /** Interpreter token for local runs (undefined for cloud-only langs).
   *  `'python3'` is a CANONICAL marker, not the literal command: localRunner
   *  resolves the real Python interpreter per-platform at run time (python3 on
   *  POSIX; python/py on Windows). `'node'` is spawned verbatim everywhere. */
  localCmd?: 'python3' | 'node';
}

// Locally runnable: python/js via an interpreter; C++ (g++) and Java (javac+java)
// via a compile+run path handled in localRunner — NOT buildDriver's interpreter
// path. Java/C++ only actually run when their toolchain is installed (checked by
// localLanguageAvailable); otherwise the orchestrator skips cleanly.
//
// VERIFIED-EXECUTION COVERAGE: python, javascript, cpp, java, go + sql (separate
// path). Everything else (c, rust, kotlin, ruby, php, swift, c#, …) is a CLEAN
// SKIP today — never a false verdict, just no badge.
//
// TODO(2.7+ / post-release): EXPAND coverage to more languages. Deferred from the
// initial verified-code-execution release on purpose. Prioritization + toolchain
// reality (verified on the dev machine 2026-06-03):
//   - Ruby   — DYNAMIC: cheapest to add (reuse the Python/JS driver pattern, no
//              signature parser). `ruby` present. High value, do first.
//   - Rust   — static, `rustc` present. Signature-aware driver like cppDriver.
//   - Swift  — static, `swiftc` present. Signature-aware driver.
//   - C      — static, `gcc/clang` present. Fiddliest (array length + returnSize
//              out-params); currently the lone CLOUD_LANGUAGES entry.
//   - PHP / Kotlin / C# — toolchains NOT on the dev machine, so they'd ship
//              UNPROVEN (driver-gen only); add behind their toolchain gate, lowest
//              priority. PHP is dynamic (cheap); Kotlin/C# are static.
// When adding a local language: append it here, add a runXCase in localRunner
// (compiled) or a buildDriver branch (interpreted), wire localLanguageAvailable,
// drop it from CLOUD_LANGUAGES, and update the stale CLOUD_LANGUAGES /
// isLocallyRunnable / orchestrator-skip-reason tests. See cppDriver.ts (static)
// or the python/js drivers (dynamic) as templates.
export const LOCAL_LANGUAGES: VerifyLanguage[] = ['python', 'javascript', 'cpp', 'java', 'go'];

export const isLocallyRunnable = (lang: VerifyLanguage): boolean => LOCAL_LANGUAGES.includes(lang);

/**
 * Build a driver that runs `entry` against the SINGLE case whose `input` array
 * is supplied to the process via the NATIVELY_TC env var (JSON-encoded). One
 * process per case keeps a crashing/looping case from poisoning the others and
 * makes the timeout per-case.
 */
/**
 * A valid entry is a plain identifier. We REJECT anything else (returning null
 * → the orchestrator skips) so `entry` can never inject code or break a string
 * literal when interpolated into the driver template. This keeps the harness
 * truly templated even though `entry` originates from the (untrusted) model
 * spec. (The model code body is already sandboxed; this prevents the spec's
 * entry NAME from becoming a second, unsandboxed injection channel and from
 * silently turning a runnable answer into a spurious compile error.)
 */
export const isValidEntry = (entry: string): boolean => /^[A-Za-z_$][\w$]*$/.test(entry);

/** Optional structure hints for dynamically-typed drivers (Python/JS). Absent =
 * every arg/return is a plain JSON value (backward compatible). */
export interface DriverHints {
  argTypes?: ('value' | 'list' | 'tree')[];
  retType?: 'value' | 'list' | 'tree';
}

export const buildDriver = (language: VerifyLanguage, code: string, entry: string, hints?: DriverHints): Driver | null => {
  if (!isValidEntry(entry)) return null;
  switch (language) {
    case 'python':
      return { localCmd: 'python3', ext: 'py', source: pythonDriver(code, entry, hints) };
    case 'javascript':
      return { localCmd: 'node', ext: 'js', source: javascriptDriver(code, entry, hints) };
    // C++ and Java do NOT go through buildDriver — localRunner.runCppCase /
    // runJavaCase handle them with signature-aware per-case programs
    // (cppDriver.ts / javaDriver.ts), intercepted before buildDriver is called.
    default:
      return null;
  }
};

const hintsJson = (hints?: DriverHints): string =>
  JSON.stringify({ argTypes: hints?.argTypes ?? [], retType: hints?.retType ?? 'value' });

// ── Python ───────────────────────────────────────────────────────────────────
// Structure helpers (ListNode/TreeNode) are defined ONLY when not already in the
// model's globals, so a LeetCode-style solution that defines its own class isn't
// clobbered. Conversion (JSON↔structure) is gated on the per-value hints; with
// no hints every arg/return is a plain JSON value (unchanged behavior).
const pythonDriver = (code: string, entry: string, hints?: DriverHints): string => `import json, os, sys

# ---- model code (verbatim) ----
${code}
# ---- end model code ----

__HINTS = json.loads(${JSON.stringify(hintsJson(hints))})

# Define ListNode/TreeNode only if the model didn't (avoid clobbering its class).
if "ListNode" not in globals():
    class ListNode:
        def __init__(self, val=0, next=None):
            self.val = val; self.next = next
if "TreeNode" not in globals():
    class TreeNode:
        def __init__(self, val=0, left=None, right=None):
            self.val = val; self.left = left; self.right = right

def __nat_to_list(arr):
    if not arr: return None
    head = ListNode(arr[0]); t = head
    for x in arr[1:]:
        t.next = ListNode(x); t = t.next
    return head

def __nat_from_list(node):
    out = []
    while node is not None:
        out.append(node.val); node = node.next
    return out

def __nat_to_tree(arr):
    if not arr or arr[0] is None: return None
    from collections import deque
    root = TreeNode(arr[0]); q = deque([root]); i = 1
    while i < len(arr) and q:
        n = q.popleft()
        if i < len(arr):
            if arr[i] is not None: n.left = TreeNode(arr[i]); q.append(n.left)
            i += 1
        if i < len(arr):
            if arr[i] is not None: n.right = TreeNode(arr[i]); q.append(n.right)
            i += 1
    return root

def __nat_from_tree(root):
    from collections import deque
    out = []; q = deque([root]) if root else deque()
    while q:
        n = q.popleft()
        if n is None: out.append(None)
        else:
            out.append(n.val); q.append(n.left); q.append(n.right)
    while out and out[-1] is None: out.pop()
    return out

def __nat_decode(v, hint):
    if hint == "list": return __nat_to_list(v)
    if hint == "tree": return __nat_to_tree(v)
    return v

def __nat_encode(v, hint):
    if hint == "list": return __nat_from_list(v)
    if hint == "tree": return __nat_from_tree(v)
    return v

def __natively_main():
    raw = os.environ.get(${JSON.stringify(TC_ENV)}, "[]")
    args = json.loads(raw)
    arg_types = __HINTS.get("argTypes", [])
    args = [__nat_decode(a, arg_types[i] if i < len(arg_types) else "value") for i, a in enumerate(args)]
    fn = None
    # The entry may be a bare function or a method on a class named Solution.
    if ${JSON.stringify(entry)} in globals():
        fn = globals()[${JSON.stringify(entry)}]
    elif "Solution" in globals():
        fn = getattr(Solution(), ${JSON.stringify(entry)}, None)
    if fn is None:
        sys.stderr.write("entry not found: ${entry}")
        sys.exit(3)
    result = fn(*args)
    result = __nat_encode(result, __HINTS.get("retType", "value"))
    # Strict JSON: allow_nan=False makes inf/-inf/nan raise (an HONEST "couldn't
    # verify" error) instead of emitting bare Infinity/NaN that isn't valid JSON
    # and would be mis-judged as a raw string. No default= coercion, so a
    # non-serializable return errors rather than silently stringifying to a pass.
    sys.stdout.write(${JSON.stringify(RESULT_SENTINEL_START)} + json.dumps(result, allow_nan=False) + ${JSON.stringify(RESULT_SENTINEL_END)})

if __name__ == "__main__":
    __natively_main()
`;

// ── JavaScript ────────────────────────────────────────────────────────────────
// ListNode/TreeNode are injected as globals ONLY if the model didn't define them
// (LeetCode JS solutions assume these constructors exist). Conversion is gated on
// the per-value hints; no hints = plain JSON values (unchanged behavior).
const javascriptDriver = (code: string, entry: string, hints?: DriverHints): string => `'use strict';
// Structure constructors (defined before model code; guarded so a model that
// declares its own ListNode/TreeNode wins via its later declaration is avoided —
// we only set them if absent at call time via globalThis checks below).
if (typeof globalThis.ListNode === 'undefined') {
  globalThis.ListNode = function ListNode(val, next) { this.val = (val===undefined?0:val); this.next = (next===undefined?null:next); };
}
if (typeof globalThis.TreeNode === 'undefined') {
  globalThis.TreeNode = function TreeNode(val, left, right) { this.val = (val===undefined?0:val); this.left = (left===undefined?null:left); this.right = (right===undefined?null:right); };
}
// ---- model code (verbatim) ----
${code}
// ---- end model code ----

const __HINTS = JSON.parse(${JSON.stringify(hintsJson(hints))});
function __natToList(arr){ if(!arr||arr.length===0) return null; let head=new globalThis.ListNode(arr[0]),t=head; for(let i=1;i<arr.length;i++){t.next=new globalThis.ListNode(arr[i]);t=t.next;} return head; }
function __natFromList(node){ const out=[]; while(node!=null){out.push(node.val);node=node.next;} return out; }
function __natToTree(arr){ if(!arr||arr.length===0||arr[0]==null) return null; const root=new globalThis.TreeNode(arr[0]); const q=[root]; let i=1; while(i<arr.length&&q.length){ const n=q.shift(); if(i<arr.length){ if(arr[i]!=null){n.left=new globalThis.TreeNode(arr[i]);q.push(n.left);} i++; } if(i<arr.length){ if(arr[i]!=null){n.right=new globalThis.TreeNode(arr[i]);q.push(n.right);} i++; } } return root; }
function __natFromTree(root){ const out=[]; const q=root?[root]:[]; while(q.length){ const n=q.shift(); if(n==null)out.push(null); else {out.push(n.val);q.push(n.left);q.push(n.right);} } while(out.length&&out[out.length-1]==null)out.pop(); return out; }
function __natDecode(v,h){ return h==='list'?__natToList(v):h==='tree'?__natToTree(v):v; }
function __natEncode(v,h){ return h==='list'?__natFromList(v):h==='tree'?__natFromTree(v):v; }

(function __nativelyMain() {
  let args = JSON.parse(process.env[${JSON.stringify(TC_ENV)}] || '[]');
  const at = __HINTS.argTypes || [];
  args = args.map((a,i) => __natDecode(a, at[i] || 'value'));
  let fn = null;
  if (typeof ${entry} === 'function') {
    fn = ${entry};
  } else if (typeof Solution === 'function') {
    try { fn = (new Solution())[${JSON.stringify(entry)}].bind(new Solution()); } catch (e) { fn = null; }
  } else if (typeof module !== 'undefined' && module.exports && typeof module.exports[${JSON.stringify(entry)}] === 'function') {
    fn = module.exports[${JSON.stringify(entry)}];
  }
  if (typeof fn !== 'function') {
    process.stderr.write('entry not found: ${entry}');
    process.exit(3);
  }
  let result = fn(...args);
  result = __natEncode(result, __HINTS.retType || 'value');
  process.stdout.write(${JSON.stringify(RESULT_SENTINEL_START)} + JSON.stringify(result === undefined ? null : result) + ${JSON.stringify(RESULT_SENTINEL_END)});
})();
`;

/** Parse the sentinel-delimited result out of stdout. Returns undefined if absent. */
export const parseDriverResult = (stdout: string): { found: boolean; value?: unknown; raw?: string } => {
  const start = stdout.lastIndexOf(RESULT_SENTINEL_START);
  const end = stdout.lastIndexOf(RESULT_SENTINEL_END);
  if (start < 0 || end < 0 || end <= start) return { found: false };
  const raw = stdout.slice(start + RESULT_SENTINEL_START.length, end);
  try {
    return { found: true, value: JSON.parse(raw), raw };
  } catch {
    return { found: true, value: raw, raw };
  }
};

/** Smoke case: call the entry with a trivial arg so we at least exercise parse+run. */
export const smokeCase = (): TestCase => ({ input: [], expected: undefined, source: 'smoke' });
