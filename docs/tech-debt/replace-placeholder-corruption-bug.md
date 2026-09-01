# Unsafe String Replacement: Code and Math Placeholder Corruption Bug

> **Scope**: `electron/llm/answerPolish.ts` (line 480) and `electron/llm/postProcessor.ts` (lines 85, 88, 133, 134)  
> **Author**: Architecture review, August 2026  
> **Status**: Findings only — no code changed in this PR

---

## The Bug: Restoring Fenced Templates via Unsafe `.replace()`

To protect code blocks, inline code, and mathematical formulas from prose post-processing (such as dash reduction or bullet cleaning), the pipeline temporarily extracts them and replaces them with unique tokens (e.g. `FENCE0`, ` CODE0 `, ` INL0 `, ` MATH0 `).

After post-processing completes, the tokens are restored to the final answer string using JavaScript's `String.prototype.replace()`.

### The Vulnerable Code

In `electron/llm/answerPolish.ts`:
```ts
// Line 480: Unsafe replacement of fence tokens
fences.forEach((f, i) => { out = out.replace(`FENCE${i}`, f); });
```

In `electron/llm/postProcessor.ts`:
```ts
// Lines 84-89: Unsafe replacement of code blocks and inline code
inlineCodes.forEach((c, i) => {
    result = result.replace(` INL${i} `, c);
});
codeBlocks.forEach((c, i) => {
    result = result.replace(` CODE${i} `, c);
});

// Lines 133-134: Unsafe replacement of inline math and inline code
math.forEach((m, i) => { s = s.replace(`  MATH${i}  `, m); });
inline.forEach((c, i) => { s = s.replace(`  INL${i}  `, c); });
```

---

## Why This Causes Wrong Answers / Code Corruption

When the first argument to `String.prototype.replace()` is a string and the second argument is a **replacement string**, JavaScript searches for special **dollar-sign replacement patterns** in that replacement string:

- `$&` — Replaced by the matched substring (in this case, the placeholder token itself, e.g. `FENCE0`).
- `` $` `` — Replaced by the portion of the string **preceding** the matched substring.
- `$'` — Replaced by the portion of the string **following** the matched substring.
- `$n` (where `n` is a digit) — **Only expands when the search pattern is a regex with capturing groups.** With a literal string search there are no capturing groups, so `$1`, `$2`, etc. are left as-is and are **not** a vulnerability here.

Because the code blocks (`f`, `c`) and math blocks (`m`) are **untrusted LLM outputs**, they frequently contain `$` characters. When these blocks contain dollar-sign patterns, JavaScript expands them during the replacement, corrupting the code block.

### Concrete Failure Examples

#### 1. jQuery / Code using `$&` (matched-substring expansion)

If the model outputs JavaScript that uses `$&` — for example as a literal symbol in a regex explanation or a jQuery snippet:

```javascript
// LLM output inside a fenced code block:
let result = str.replace(/foo/, "matched: $& done");
```

When the pipeline restores ` CODE0 ` via `result.replace(" CODE0 ", block)`, JavaScript
exands `$&` in `block` to the match string (` CODE0 ` itself), leaking the internal token
into the rendered answer:

```javascript
// Corrupted output:
let result = str.replace(/foo/, "matched:  CODE0  done");
```

#### 2. Preceding-context expansion with `` $` ``

If the model outputs a code block containing `` $` `` (the backtick form of the pre-match pattern),
the replacement inserts everything in the output string that appears **before** the placeholder.
This causes arbitrary text from the surrounding prose to be injected into the middle of the code block:

```ts
// LLM output:
const s = `hello $\`world\``;
```

```ts
// Corrupted — preceding prose bled into the code block:
const s = `hello The answer to your question is...world`;
```

#### 3. Following-context expansion with `$'`

Similarly, `$'` expands to everything **after** the matched placeholder, injecting the
remainder of the answer string into the code block — a mirror image of the `` $` `` vulnerability.

> **Note on `$n` patterns (Bash variables, math subscripts):** When `.replace()` is called
> with a **literal string** as the first argument (as in this code), there are no regex
> capturing groups. Per the ECMAScript specification, `$1`, `$2`, `$x_1`, etc. are therefore
> left **entirely literal** in the replacement output. Bash scripts with `$1` / `$2` and math
> formulas with `$x_1` are **not** corrupted by this mechanism. The only real danger patterns
> are `$&`, `` $` ``, and `$'`.

---

## The Solution: Callback-Based Replacement

To prevent JavaScript from parsing dollar-sign patterns in the replacement string, the second argument to `replace()` must be a **callback function** that returns the string. 

When a function is provided, JavaScript does **not** evaluate dollar-sign replacement patterns; the return value of the function is inserted exactly as-is.

### Recommended Fix

Update the restoration loops to use callback functions:

#### In `electron/llm/answerPolish.ts` (line 480):
```diff
-fences.forEach((f, i) => { out = out.replace(`FENCE${i}`, f); });
+fences.forEach((f, i) => { out = out.replace(`FENCE${i}`, () => f); });
```

#### In `electron/llm/postProcessor.ts` (lines 84-89 and 133-134):
```diff
-inlineCodes.forEach((c, i) => {
-    result = result.replace(` INL${i} `, c);
-});
-codeBlocks.forEach((c, i) => {
-    result = result.replace(` CODE${i} `, c);
-});
+inlineCodes.forEach((c, i) => {
+    result = result.replace(` INL${i} `, () => c);
+});
+codeBlocks.forEach((c, i) => {
+    result = result.replace(` CODE${i} `, () => c);
+});
```

```diff
-math.forEach((m, i) => { s = s.replace(`  MATH${i}  `, m); });
-inline.forEach((c, i) => { s = s.replace(`  INL${i}  `, c); });
+math.forEach((m, i) => { s = s.replace(`  MATH${i}  `, () => m); });
+inline.forEach((c, i) => { s = s.replace(`  INL${i}  `, () => c); });
```

This single character change (`f` → `() => f`) completely neutralizes the placeholder corruption vulnerability across all coding and mathematical outputs.
