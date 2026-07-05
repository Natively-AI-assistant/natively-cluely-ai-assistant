// Shared Prism language resolution for the chat/markdown code renderers
// (NativelyInterface, MeetingDetails, MeetingChatOverlay). Previously each
// component carried a byte-identical copy of mapLanguageForPrism; they drifted
// and none handled JSX/TSX. This is the single source of truth.
//
// NOTE: registering the grammars with SyntaxHighlighter.registerLanguage(...)
// still happens per-file via side-effecting imports — that mutates the Prism
// singleton and must run in each module that renders code. This util only
// resolves a fence tag (+ code body) to a registered Prism language name.

// A model frequently emits React/JSX fenced as ```python (or plain, or
// ```javascript). Sniff the BODY for React/JSX signals so we can override a
// wrong-or-missing tag. Mirrors the backend inferLanguage sniff in
// electron/llm/AnswerValidator.ts so client and server agree.
export const looksLikeJsx = (code: string): boolean =>
  /\bimport\s+React\b|\buseState\s*\(|\buseEffect\s*\(|\buseRef\s*\(|\bclassName\s*=|<[A-Z][a-zA-Z]*[\s/>]/.test(code);

// TS vs JS discriminator for JSX: type annotations / generics / interfaces →
// tsx, else jsx.
export const jsxDialect = (code: string): 'tsx' | 'jsx' =>
  /:\s*[A-Za-z_][\w.]*(\[\])?\s*[=,);]|<[A-Za-z_][\w.]*>|\binterface\s|\btype\s+\w+\s*=|\bas\s+[A-Z]/.test(code) ? 'tsx' : 'jsx';

// Fence tag → registered Prism grammar name. Keep in sync with the grammars
// registered in registerPrismLanguages.ts — a tag resolved here to a name that
// isn't registered there falls back to unhighlighted plaintext.
const MAPPER: Record<string, string> = {
  // Core / web
  'js': 'javascript', 'javascript': 'javascript', 'node': 'javascript', 'mjs': 'javascript', 'cjs': 'javascript',
  'jsx': 'jsx',
  'ts': 'typescript', 'typescript': 'typescript',
  'tsx': 'tsx',
  'html': 'markup', 'xml': 'markup', 'svg': 'markup', 'xhtml': 'markup', 'markup': 'markup',
  'css': 'css',
  'scss': 'scss',
  'sass': 'sass',
  'less': 'less',
  'json': 'json', 'jsonc': 'json',
  'json5': 'json5',
  'graphql': 'graphql', 'gql': 'graphql',
  // Frameworks / templating
  'vue': 'vue',
  'svelte': 'svelte',
  'astro': 'markup',
  'handlebars': 'handlebars', 'hbs': 'handlebars', 'mustache': 'handlebars',
  'pug': 'pug', 'jade': 'pug',
  // Backend / systems
  'py': 'python', 'python': 'python',
  'rb': 'ruby', 'ruby': 'ruby',
  'php': 'php',
  'java': 'java',
  'kt': 'kotlin', 'kotlin': 'kotlin', 'kts': 'kotlin',
  'scala': 'scala',
  'groovy': 'groovy', 'gradle': 'groovy',
  'go': 'go', 'golang': 'go',
  'rs': 'rust', 'rust': 'rust',
  'c': 'c', 'h': 'c',
  'cpp': 'cpp', 'c++': 'cpp', 'cc': 'cpp', 'cxx': 'cpp', 'hpp': 'cpp',
  'cs': 'csharp', 'csharp': 'csharp',
  'objc': 'objectivec', 'objectivec': 'objectivec', 'objective-c': 'objectivec',
  'swift': 'swift',
  'dart': 'dart',
  'ex': 'elixir', 'exs': 'elixir', 'elixir': 'elixir',
  'erl': 'erlang', 'erlang': 'erlang',
  'hs': 'haskell', 'haskell': 'haskell',
  'clj': 'clojure', 'cljs': 'clojure', 'clojure': 'clojure',
  'lua': 'lua',
  'pl': 'perl', 'perl': 'perl',
  'r': 'r',
  'jl': 'julia', 'julia': 'julia',
  'sol': 'solidity', 'solidity': 'solidity',
  'fs': 'fsharp', 'fsharp': 'fsharp',
  'ml': 'ocaml', 'ocaml': 'ocaml',
  // Shell / config / data / infra
  'sh': 'bash', 'bash': 'bash', 'shell': 'bash', 'zsh': 'bash', 'shellscript': 'bash', 'console': 'bash',
  'powershell': 'powershell', 'ps1': 'powershell', 'pwsh': 'powershell',
  'bat': 'batch', 'batch': 'batch', 'cmd': 'batch',
  'yml': 'yaml', 'yaml': 'yaml',
  'toml': 'toml',
  'ini': 'ini', 'cfg': 'ini', 'conf': 'ini',
  'sql': 'sql', 'postgres': 'sql', 'postgresql': 'sql', 'mysql': 'sql',
  'docker': 'docker', 'dockerfile': 'docker',
  'nginx': 'nginx',
  'hcl': 'hcl', 'terraform': 'hcl', 'tf': 'hcl',
  'makefile': 'makefile', 'make': 'makefile',
  'diff': 'diff', 'patch': 'diff',
  'git': 'git',
  'md': 'markdown', 'markdown': 'markdown',
  'proto': 'protobuf', 'protobuf': 'protobuf',
  'regex': 'regex', 'regexp': 'regex',
};

export const mapLanguageForPrism = (lang: string, code: string): string => {
  const lower = (lang || '').toLowerCase().trim();
  // Override a wrong/absent tag on clearly-JSX content BEFORE trusting the tag.
  // Only intercept the tags a model actually mislabels JSX as — never touch a
  // deliberate tsx/jsx/html/markup tag.
  if ((lower === '' || lower === 'python' || lower === 'py' || lower === 'javascript' || lower === 'js' || lower === 'typescript' || lower === 'ts') && looksLikeJsx(code)) {
    return jsxDialect(code);
  }
  if (!lang) {
    if (code.includes('def ') || code.includes('import ') || code.includes('elif ') || code.includes('print(') || code.includes(':\n')) {
      return 'python';
    }
    return 'javascript';
  }
  return MAPPER[lower] || lower;
};

// react-markdown v10 REMOVED the `inline` prop from the `code` component, so the
// old `inline ?? …` checks are unreliable (always undefined). This is the single
// correct block-vs-inline test for v10: a fenced block always carries a
// `language-*` class OR its text content ends in a newline (markdown appends one
// to fenced blocks); a backtick span has neither. Every code-rendering surface
// must use this so inline `useState` doesn't render as a full block and an
// untagged ```fence``` doesn't render inline.
export const isBlockCode = (className: string | undefined, codeText: string): boolean =>
  /language-(\w+)/.test(className || '') || /\n$/.test(codeText);
