// src/lib/__tests__/prismLanguage.test.mjs
//
// Covers src/utils/prismLanguage.ts — fence tag (+ code body) → Prism grammar
// name resolution, the JSX sniffers, and the react-markdown v10 block-vs-inline
// test. The source lives in src/utils, but the test lives here because CI's
// `test:lib` glob only runs src/lib/**/__tests__.
//
// Run: node --experimental-strip-types --test src/lib/__tests__/prismLanguage.test.mjs
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeJsx, jsxDialect, mapLanguageForPrism, isBlockCode } from '../../utils/prismLanguage.ts';

const JSX_BODY = 'export default function App() {\n  return <Card title="x" />;\n}\n';
const TSX_BODY = 'export default function App({ title }: Props) {\n  return <Card title={title} />;\n}\n';

describe('looksLikeJsx', () => {
  for (const [label, code] of [
    ['import React', "import React from 'react';"],
    ['useState(', 'const [n, setN] = useState(0);'],
    ['useState with whitespace before the paren', 'useState (0)'],
    ['useEffect(', 'useEffect(() => {}, []);'],
    ['useRef(', 'const ref = useRef(null);'],
    ['className=', '<div className="row">hi</div>'],
    ['className with spaces around =', '<div className = "row" />'],
    ['capitalised component, self-closing', 'return <Card />;'],
    ['capitalised component, with props', 'return <Card title="x">y</Card>;'],
    ['capitalised component, bare', 'return <Card>y</Card>;'],
  ]) {
    test(`detects ${label}`, () => assert.equal(looksLikeJsx(code), true));
  }

  for (const [label, code] of [
    ['empty string', ''],
    ['plain python', 'def add(a, b):\n    return a + b\n'],
    ['plain javascript', 'const a = 1;\nconsole.log(a);'],
    ['lower-case html tags', '<div class="row"><span>hi</span></div>'],
    ['less-than comparison with spaces', 'if (a < B) return 1;'],
    ['importing something that merely starts with React', "import Reactive from 'x';"],
    ['an identifier that merely ends in useState', 'const v = myuseState(1);'],
    ['a class attribute, not className', '<p class="x">'],
  ]) {
    test(`does not flag ${label}`, () => assert.equal(looksLikeJsx(code), false));
  }
});

describe('jsxDialect', () => {
  for (const [label, code] of [
    ['a parameter type annotation', 'function f(a: string) { return <B a={a} />; }'],
    ['an array type annotation', 'function f(a: string[]) { return null; }'],
    ['a typed variable', 'const n: number = 1;'],
    ['a generic call', 'const [n, setN] = useState<number>(0);'],
    ['an interface', 'interface Props { title: string }'],
    ['a type alias', 'type Props = { title: string };'],
    ['an `as` cast', 'const el = ref.current as HTMLDivElement'],
  ]) {
    test(`${label} → tsx`, () => assert.equal(jsxDialect(code), 'tsx'));
  }

  for (const [label, code] of [
    ['empty string', ''],
    ['component with props', JSX_BODY],
    ['hooks without annotations', 'const [n, setN] = useState(0);\nreturn <Counter value={n} />;'],
    ['a lower-case `as` word', 'render it as plain text'],
  ]) {
    test(`${label} → jsx`, () => assert.equal(jsxDialect(code), 'jsx'));
  }
});

describe('mapLanguageForPrism — tag lookup', () => {
  for (const [tag, expected] of [
    ['js', 'javascript'], ['javascript', 'javascript'], ['node', 'javascript'], ['mjs', 'javascript'], ['cjs', 'javascript'],
    ['jsx', 'jsx'], ['ts', 'typescript'], ['typescript', 'typescript'], ['tsx', 'tsx'],
    ['html', 'markup'], ['xml', 'markup'], ['svg', 'markup'], ['astro', 'markup'],
    ['css', 'css'], ['scss', 'scss'], ['json', 'json'], ['jsonc', 'json'], ['json5', 'json5'], ['gql', 'graphql'],
    ['hbs', 'handlebars'], ['mustache', 'handlebars'], ['jade', 'pug'],
    ['py', 'python'], ['python', 'python'], ['rb', 'ruby'], ['kt', 'kotlin'], ['kts', 'kotlin'], ['gradle', 'groovy'],
    ['golang', 'go'], ['rs', 'rust'], ['h', 'c'], ['c++', 'cpp'], ['hpp', 'cpp'], ['cs', 'csharp'],
    ['objective-c', 'objectivec'], ['exs', 'elixir'], ['erl', 'erlang'], ['hs', 'haskell'], ['cljs', 'clojure'],
    ['pl', 'perl'], ['r', 'r'], ['jl', 'julia'], ['sol', 'solidity'], ['fs', 'fsharp'], ['ml', 'ocaml'],
    ['sh', 'bash'], ['zsh', 'bash'], ['shell', 'bash'], ['console', 'bash'],
    ['ps1', 'powershell'], ['pwsh', 'powershell'], ['bat', 'batch'], ['cmd', 'batch'],
    ['yml', 'yaml'], ['toml', 'toml'], ['cfg', 'ini'], ['conf', 'ini'],
    ['postgres', 'sql'], ['mysql', 'sql'], ['dockerfile', 'docker'], ['tf', 'hcl'], ['terraform', 'hcl'],
    ['make', 'makefile'], ['patch', 'diff'], ['git', 'git'], ['md', 'markdown'], ['proto', 'protobuf'], ['regexp', 'regex'],
  ]) {
    test(`\`${tag}\` → ${expected}`, () => {
      assert.equal(mapLanguageForPrism(tag, 'x = 1'), expected);
    });
  }

  test('the tag is matched case-insensitively', () => {
    assert.equal(mapLanguageForPrism('Python', 'x = 1'), 'python');
    assert.equal(mapLanguageForPrism('BASH', 'ls -la'), 'bash');
    assert.equal(mapLanguageForPrism('C++', 'int main() {}'), 'cpp');
  });

  test('surrounding whitespace on the tag is ignored', () => {
    assert.equal(mapLanguageForPrism('  yml  ', 'a: 1'), 'yaml');
    assert.equal(mapLanguageForPrism('rust\n', 'fn main() {}'), 'rust');
  });

  test('an unknown tag passes through lower-cased and trimmed', () => {
    assert.equal(mapLanguageForPrism('zig', 'const x = 1;'), 'zig');
    assert.equal(mapLanguageForPrism(' Nim ', 'echo 1'), 'nim');
  });
});

describe('mapLanguageForPrism — JSX override of a wrong or missing tag', () => {
  for (const tag of ['', 'python', 'py', 'javascript', 'js', 'typescript', 'ts']) {
    test(`tag ${JSON.stringify(tag)} on JSX content resolves to jsx`, () => {
      assert.equal(mapLanguageForPrism(tag, JSX_BODY), 'jsx');
    });

    test(`tag ${JSON.stringify(tag)} on typed JSX content resolves to tsx`, () => {
      assert.equal(mapLanguageForPrism(tag, TSX_BODY), 'tsx');
    });
  }

  test('the override also applies to an upper-cased or padded mislabel', () => {
    assert.equal(mapLanguageForPrism('Python', JSX_BODY), 'jsx');
    assert.equal(mapLanguageForPrism(' JS ', JSX_BODY), 'jsx');
  });

  test('null / undefined tags behave like an empty tag', () => {
    assert.equal(mapLanguageForPrism(undefined, JSX_BODY), 'jsx');
    assert.equal(mapLanguageForPrism(null, TSX_BODY), 'tsx');
  });

  test('a deliberate jsx / tsx tag is trusted as written', () => {
    assert.equal(mapLanguageForPrism('jsx', TSX_BODY), 'jsx');
    assert.equal(mapLanguageForPrism('tsx', JSX_BODY), 'tsx');
  });

  test('a deliberate html / markup tag is never overridden', () => {
    assert.equal(mapLanguageForPrism('html', JSX_BODY), 'markup');
    assert.equal(mapLanguageForPrism('markup', JSX_BODY), 'markup');
  });

  test('other languages are not intercepted even if the body looks like JSX', () => {
    assert.equal(mapLanguageForPrism('java', 'List<String> xs = new ArrayList<>();'), 'java');
    assert.equal(mapLanguageForPrism('vue', JSX_BODY), 'vue');
  });

  test('a mislabel-prone tag on non-JSX content is left alone', () => {
    assert.equal(mapLanguageForPrism('python', 'def f():\n    return 1\n'), 'python');
    assert.equal(mapLanguageForPrism('js', 'const a = 1;'), 'javascript');
    assert.equal(mapLanguageForPrism('ts', 'const a = 1;'), 'typescript');
  });
});

describe('mapLanguageForPrism — untagged fences', () => {
  for (const [label, code] of [
    ['def', 'def add(a, b):\n    return a + b'],
    ['elif', 'if x: y\nelif z: w'],
    ['print(', 'print("hi")'],
    ['a line ending in a colon', 'for i in range(3):\n    pass'],
    ['a python import', 'import os\nos.getcwd()'],
  ]) {
    test(`python signal (${label}) → python`, () => {
      assert.equal(mapLanguageForPrism('', code), 'python');
    });
  }

  test('no python signal → javascript', () => {
    assert.equal(mapLanguageForPrism('', 'const a = 1;\nconsole.log(a);'), 'javascript');
  });

  test('empty body → javascript', () => {
    assert.equal(mapLanguageForPrism('', ''), 'javascript');
  });

  test('undefined / null tags take the same untagged path', () => {
    assert.equal(mapLanguageForPrism(undefined, 'print("hi")'), 'python');
    assert.equal(mapLanguageForPrism(null, 'let a = 2;'), 'javascript');
  });

  test('JSX wins over the python heuristic on an untagged fence', () => {
    assert.equal(mapLanguageForPrism('', "import React from 'react';\nexport const A = () => <B c=\"d\" />;"), 'jsx');
  });
});

describe('isBlockCode', () => {
  test('a language-* class marks a block', () => {
    assert.equal(isBlockCode('language-js', 'const a = 1'), true);
  });

  test('a language-* class among other classes marks a block', () => {
    assert.equal(isBlockCode('hljs language-python wrap', 'x'), true);
  });

  test('an untagged fence is a block because its text ends in a newline', () => {
    assert.equal(isBlockCode(undefined, 'plain fence\n'), true);
    assert.equal(isBlockCode('', 'a\nb\n'), true);
  });

  test('an inline backtick span is not a block', () => {
    assert.equal(isBlockCode(undefined, 'useState'), false);
    assert.equal(isBlockCode('', 'useState'), false);
  });

  test('a newline in the middle (not at the end) is not a block', () => {
    assert.equal(isBlockCode(undefined, 'a\nb'), false);
  });

  test('an unrelated class with no trailing newline is not a block', () => {
    assert.equal(isBlockCode('inline-code', 'x'), false);
  });

  test('a bare "language-" class with no name is not a block', () => {
    assert.equal(isBlockCode('language-', 'x'), false);
  });

  test('empty text with no class is not a block', () => {
    assert.equal(isBlockCode(undefined, ''), false);
  });

  test('a lone newline is a block', () => {
    assert.equal(isBlockCode(undefined, '\n'), true);
  });
});
