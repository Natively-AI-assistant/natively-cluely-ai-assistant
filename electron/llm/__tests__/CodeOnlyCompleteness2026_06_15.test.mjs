// electron/llm/__tests__/CodeOnlyCompleteness2026_06_15.test.mjs
//
// Property tests for checkCodeCompleteness (spoken-answer-quality sprint). Truncated code
// (unbalanced brackets, unclosed function, dangling token, unterminated string) must be
// flagged; VALID code — including code with brackets inside strings/comments — must NOT be
// flagged (conservative: unclosed-only, string/comment-masked).

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { checkCodeCompleteness } from '../../../dist-electron/electron/llm/index.js';

const fence = (lang, body) => '```' + lang + '\n' + body + '\n```';

describe('checkCodeCompleteness — flags truncation', () => {
  const truncated = [
    ['js unclosed paren', 'js', 'function f() {\n  return g(a, b'],
    ['cpp unclosed brace', 'cpp', 'int main() {\n  vector<int> v;\n  for (int i=0;i<n;i++) {'],
    ['java unclosed brace', 'java', 'class A {\n  void m() {\n    list.add('],
    ['js dangling operator', 'js', 'const x = a +'],
    ['python unterminated string', 'python', 'msg = "hello world'],
    ['js mid-call truncation', 'javascript', 'arr.map(x => x.'],
    ['go unclosed brace', 'go', 'func main() {\n\tfor i := 0; i < n; i++ {'],
  ];
  for (const [label, lang, body] of truncated) {
    test(`flags: ${label}`, () => {
      const r = checkCodeCompleteness(fence(lang, body));
      assert.equal(r.ok, false, `should flag truncated ${lang}`);
      assert.ok(r.issues.some((i) => i.code === 'truncated_code'));
    });
  }
});

describe('checkCodeCompleteness — does NOT flag valid code (conservative)', () => {
  const valid = [
    ['python valid', 'python', 'def isValid(s):\n    stack = []\n    for c in s:\n        stack.append(c)\n    return not stack'],
    ['js valid', 'js', 'function twoSum(nums, target) {\n  const seen = {};\n  return [];\n}'],
    ['cpp valid', 'cpp', 'int main() {\n  std::vector<int> v;\n  return 0;\n}'],
    ['brace inside string', 'python', 'x = "a string with { an unbalanced brace"\nprint(x)'],
    ['paren inside comment', 'js', '// this comment has ( an unbalanced paren\nconst x = 1;'],
    ['regex-ish content', 'js', 'const re = /[(){}]/;\nconst y = 2;'],
    ['python dict', 'python', 'd = {"a": 1, "b": 2}\nreturn d'],
    ['sql valid select', 'sql', 'SELECT id, name FROM users WHERE active = 1'],
    ['python f-string with brace', 'python', 'name = "x"\nprint(f"hello {name} world")'],
  ];
  for (const [label, lang, body] of valid) {
    test(`clean: ${label}`, () => {
      const r = checkCodeCompleteness(fence(lang, body));
      assert.equal(r.ok, true, `valid ${lang} must not flag: ${JSON.stringify(r.issues)}`);
    });
  }
});

describe('checkCodeCompleteness — language-specific false-positive guards (code-review 2026-06-15)', () => {
  const safe = [
    ['rust lifetimes', 'rust', "impl<'a> Iterator for Foo<'a> {\n    fn next(&mut self) -> Option<&'a str> { None }\n}"],
    ['rust single lifetime', 'rust', "fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {\n    x\n}"],
    ['js regex with brackets', 'js', 'const re = /[(){}]/;\nconst x = 1;\nfunction f() { return re.test(x); }'],
    ['js regex unbalanced paren in class', 'js', 'const re = /[a-z(]/;\nlet y = 2;'],
    ['cpp char literal brace', 'cpp', "char c = '{';\nint main() { return 0; }"],
    ['cpp char literal paren', 'cpp', "char p = '(';\nint x = 0;"],
    ['cpp escape char', 'cpp', "char nl = '\\n';\nint x = 0;"],
    ['java char literal', 'java', "char c = '}';\nclass A { int x = 1; }"],
    ['trailing float dot', 'python', 'x = 3.\nprint(x)'],
  ];
  for (const [label, lang, body] of safe) {
    test(`not flagged: ${label}`, () => {
      assert.equal(checkCodeCompleteness(fence(lang, body)).ok, true, `${label} must not flag`);
    });
  }

  // Genuine truncation must STILL be caught in these same languages.
  const stillTruncated = [
    ['rust unclosed brace', 'rust', "fn main() {\n    let v = vec![1, 2"],
    ['cpp unclosed after char', 'cpp', "char c = '{';\nint main() {\n  foo("],
  ];
  for (const [label, lang, body] of stillTruncated) {
    test(`still flags: ${label}`, () => {
      assert.equal(checkCodeCompleteness(fence(lang, body)).ok, false, `${label} should still flag`);
    });
  }
});

describe('checkCodeCompleteness — non-code inputs are safe', () => {
  test('prose with no fence is ok', () => {
    assert.equal(checkCodeCompleteness('I would use a hash map here.').ok, true);
  });
  test('empty / null safe', () => {
    assert.equal(checkCodeCompleteness('').ok, true);
    assert.equal(checkCodeCompleteness(null).ok, true);
  });
  test('mermaid/diagram fence is not brace-balanced (skipped)', () => {
    const mermaid = fence('mermaid', 'graph TD\n  A[Start] --> B{Decision}\n  B --> C');
    assert.equal(checkCodeCompleteness(mermaid).ok, true);
  });
  test('an extra CLOSING bracket is NOT flagged (only unclosed = truncation)', () => {
    const r = checkCodeCompleteness(fence('js', 'function f() {\n  return 1;\n}\n}'));
    assert.equal(r.ok, true);
  });
});
