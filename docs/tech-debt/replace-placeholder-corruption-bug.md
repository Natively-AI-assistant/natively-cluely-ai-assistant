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
- `$`` — Replaced by the portion of the string preceding the matched substring.
- `$'` — Replaced by the portion of the string following the matched substring.
- `$n` (where `n` is a digit) — Replaced by capturing groups.

Because the code blocks (`f`, `c`) and math blocks (`m`) are **untrusted LLM outputs**, they frequently contain `$` characters. When these blocks contain dollar-sign patterns, JavaScript expands them during the replacement, corrupting the code block.

### Concrete Failure Examples

#### 1. Shell Script / Bash Variables (`$1`, `$2`, `$n`)
If the model outputs a Bash script containing command line arguments:
```bash
#!/bin/bash
echo "First arg: $1"
echo "Second arg: $2"
```
Because the replacement pattern is a literal string, `$1` and `$2` are interpreted as capture groups. Since there are no capturing groups in the literal string matches (`"FENCE0"`), `$1` and `$2` are replaced by **empty strings** or left partially unresolved depending on the engine context, corrupting the script:
```bash
#!/bin/bash
echo "First arg: "
echo "Second arg: "
```

#### 2. jQuery / Regex / Bash Run-in-Background (`$&`)
If the model outputs Javascript regex code or jQuery operations using `$&` (which denotes the last match):
```javascript
let pattern = /foo/;
let replaced = text.replace(pattern, "bar $& baz");
```
During restoration, the JS engine replaces `$&` in the replacement string with the matched pattern (` CODE0 `). The output becomes corrupted, leaking the internal template marker:
```javascript
let pattern = /foo/;
let replaced = text.replace(pattern, "bar  CODE0  baz");
```

#### 3. Math Formulas containing multiple `$` symbols
If a math block contains variable names like `$x_1` or expressions with sub-scripts:
```markdown
We can see that $x_1 = a$ and $y_2 = b$.
```
The `$1` in `$x_1` is stripped, rendering the math incorrectly in the UI:
```markdown
We can see that $x_ = a$ and $y_2 = b$.
```

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
