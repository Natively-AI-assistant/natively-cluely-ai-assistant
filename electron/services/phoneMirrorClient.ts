// Mobile client served by PhoneMirrorService.
// Inlined here so it travels with the asar bundle without extra build steps.
// Edit the template below; whitespace is preserved as written.

export const PHONE_MIRROR_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#050706" />
    <meta name="referrer" content="no-referrer" />
    <title>Natively Mirror</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #05070a;
        --panel: #0c1117;
        --panel-2: #111821;
        --line: rgba(120, 200, 255, 0.18);
        --line-soft: rgba(255, 255, 255, 0.07);
        --text: #f1f6fb;
        --muted: #7b8896;
        --accent: #6cf0d6;
        --accent-2: #55a6ff;
        --danger: #ff5d6c;
        --bar-h: 84px;
      }
      * { box-sizing: border-box; }
      html, body { min-height: 100%; }
      body {
        margin: 0;
        background:
          radial-gradient(1200px 600px at 18% -10%, rgba(85,166,255,0.10), transparent 70%),
          radial-gradient(900px 600px at 110% 110%, rgba(108,240,214,0.08), transparent 70%),
          linear-gradient(180deg, #05070a 0%, #070a0f 100%);
        color: var(--text);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      button { border: 0; color: inherit; font: inherit; cursor: pointer; }
      .app {
        display: grid;
        grid-template-rows: auto 1fr auto;
        min-height: 100dvh;
        padding: env(safe-area-inset-top) 14px env(safe-area-inset-bottom);
      }
      .topbar {
        position: sticky; top: 0; z-index: 5;
        display: flex; align-items: center; justify-content: space-between; gap: 16px;
        padding: 18px 4px 14px;
        background: linear-gradient(180deg, rgba(5,7,10,0.96), rgba(5,7,10,0.72) 78%, transparent);
        backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
      }
      h1 { margin: 0; font-size: 18px; line-height: 1.05; font-weight: 700; letter-spacing: 0.2px; }
      .subtitle { margin-top: 5px; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
      .status {
        display: inline-flex; align-items: center; gap: 8px;
        flex: 0 0 auto; min-height: 32px; padding: 0 11px;
        border: 1px solid var(--line-soft); border-radius: 999px;
        background: rgba(11,15,21,0.76); color: var(--muted); font-size: 12px;
      }
      .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--danger); }
      .status.connected { color: var(--text); }
      .status.connected .dot { background: var(--accent); animation: pulse 1.8s ease-in-out infinite; }
      .feed {
        display: flex; flex-direction: column; gap: 12px; min-height: 0;
        overflow-y: auto; padding: 12px 0 calc(var(--bar-h) + 20px);
        scroll-behavior: smooth; overscroll-behavior: contain;
      }
      .empty {
        display: grid; place-items: center; min-height: 58dvh;
        color: var(--muted); text-align: center; font-size: 14px; line-height: 1.55; padding: 0 16px;
      }
      .card {
        position: relative; padding: 14px 14px 16px;
        border: 1px solid var(--line-soft); border-radius: 10px;
        background: linear-gradient(180deg, rgba(17,24,33,0.92), rgba(11,16,22,0.96)), var(--panel);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
        animation: rise 240ms cubic-bezier(0.16,1,0.3,1) both;
      }
      .card.live { border-color: var(--line); box-shadow: 0 0 0 1px rgba(108,240,214,0.10), inset 0 1px 0 rgba(255,255,255,0.05); }
      .card.user {
        background: linear-gradient(180deg, rgba(20,28,40,0.92), rgba(15,21,30,0.96));
        border-color: rgba(85,166,255,0.16);
      }
      .meta {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        margin-bottom: 8px; color: var(--muted); font-size: 11px;
        font-variant-numeric: tabular-nums; text-transform: uppercase; letter-spacing: 0.6px;
      }
      .role { display: inline-flex; align-items: center; gap: 6px; }
      .role .pip { width: 6px; height: 6px; border-radius: 999px; background: var(--accent); }
      .role.user .pip { background: var(--accent-2); }
      .badge {
        display: none; padding: 3px 7px;
        border: 1px solid rgba(108,240,214,0.32); border-radius: 999px;
        color: var(--accent); font-size: 10px; font-weight: 700; letter-spacing: 0.6px;
      }
      .card.live .badge { display: inline-block; }
      .content { font-size: 15.5px; line-height: 1.6; overflow-wrap: anywhere; word-break: break-word; }
      .content > :first-child { margin-top: 0; }
      .content > :last-child { margin-bottom: 0; }
      .content p { margin: 0 0 10px; }
      .content strong { font-weight: 700; color: #ffffff; }
      .content em { font-style: italic; color: rgba(255,255,255,0.92); }
      .content h1, .content h2, .content h3 {
        margin: 14px 0 8px; line-height: 1.25; letter-spacing: -0.01em;
        color: #ffffff; font-weight: 700;
      }
      .content h1 { font-size: 19px; }
      .content h2 { font-size: 17px; }
      .content h3 { font-size: 15px; }
      .content ul, .content ol { margin: 6px 0 12px; padding-left: 22px; }
      .content ul { list-style: disc; }
      .content ol { list-style: decimal; }
      .content li { margin: 3px 0; padding-left: 4px; }
      .content li::marker { color: rgba(255,255,255,0.42); }
      .content blockquote {
        margin: 8px 0; padding: 4px 12px;
        border-left: 2px solid rgba(108,240,214,0.35);
        color: rgba(255,255,255,0.82); font-style: italic;
      }
      .content a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
      .content code.inline {
        padding: 1px 6px; border-radius: 4px;
        background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.06);
        color: #d6e6ff; font: 0.92em ui-monospace, "SF Mono", Menlo, Consolas, monospace;
        word-break: break-word; white-space: pre-wrap;
      }
      .content .math {
        font: 0.95em ui-monospace, "SF Mono", Menlo, Consolas, monospace;
        color: #ffe8a8;
      }
      .content .codeblock {
        margin: 10px 0 14px; border-radius: 10px; overflow: hidden;
        background: rgba(0,0,0,0.42); border: 1px solid rgba(255,255,255,0.07);
      }
      .content .codeblock-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 6px 10px 6px 12px;
        background: rgba(255,255,255,0.03);
        border-bottom: 1px solid rgba(255,255,255,0.05);
        color: rgba(255,255,255,0.55); font-size: 11px;
        text-transform: uppercase; letter-spacing: 0.08em;
      }
      .content .codeblock-copy {
        background: transparent; color: rgba(255,255,255,0.55);
        font-size: 11px; padding: 2px 8px; border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.08);
        text-transform: none; letter-spacing: 0;
        transition: color 160ms ease, background 160ms ease, border-color 160ms ease;
      }
      .content .codeblock-copy:active { transform: scale(0.97); }
      .content .codeblock-copy.copied { color: var(--accent); border-color: rgba(108,240,214,0.32); }
      .content .codeblock pre {
        margin: 0; padding: 12px 14px; overflow-x: auto;
        font: 12.5px/1.55 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
        color: #e6edf3; white-space: pre;
        scrollbar-width: thin;
      }
      .content .codeblock pre::-webkit-scrollbar { height: 6px; }
      .content .codeblock pre::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
      /* Streaming-fence visual cue. */
      .content .codeblock.streaming { border-color: rgba(108,240,214,0.18); }
      .content .codeblock.streaming .codeblock-head { color: var(--accent); }
      /* ── Syntax tokens. Theme matches the dark surface above; readable in
         both AMOLED-bright and dim rooms. */
      .content pre .hl-c    { color: #6b7d99; font-style: italic; }   /* comment */
      .content pre .hl-s    { color: #a3e9b6; }                        /* string */
      .content pre .hl-k    { color: #c8a8ff; }                        /* keyword */
      .content pre .hl-n    { color: #ffd58a; }                        /* number */
      .content pre .hl-f    { color: #7ec8ff; }                        /* function name */
      .content pre .hl-t    { color: #ff9bb6; }                        /* tag (html/xml) */
      .content pre .hl-a    { color: #6cf0d6; }                        /* attribute / property */
      .content pre .hl-v    { color: #ffb482; font-style: italic; }    /* variable / built-in (self, this) */
      .content pre .hl-o    { color: #c0d0e0; }                        /* operator / punctuation accent */
      .content hr {
        border: 0; height: 1px;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent);
        margin: 14px 0;
      }
      .content .caret {
        display: inline-block; width: 7px; height: 1em; vertical-align: -2px; margin-left: 2px;
        background: var(--accent); border-radius: 2px;
        animation: blink 1s steps(2, end) infinite;
      }
      .actions {
        position: fixed; left: 14px; right: 14px;
        bottom: calc(14px + env(safe-area-inset-bottom));
        display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 9px;
        min-height: 56px; padding: 8px;
        border: 1px solid var(--line-soft); border-radius: 12px;
        background: rgba(8,12,17,0.86);
        backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
        box-shadow: 0 16px 42px rgba(0,0,0,0.45);
      }
      .action {
        min-width: 0; min-height: 42px; border-radius: 8px;
        background: var(--panel-2); color: var(--text);
        font-size: 13px; font-weight: 600; letter-spacing: 0.2px;
        transition: transform 160ms cubic-bezier(0.16,1,0.3,1), background 160ms;
      }
      .action:active { transform: scale(0.98) translateY(1px); }
      .action.primary { background: linear-gradient(180deg, var(--accent), #4dd9bd); color: #00261d; }
      .toast {
        position: fixed; left: 50%; top: calc(env(safe-area-inset-top) + 70px);
        transform: translateX(-50%);
        padding: 8px 12px; border-radius: 999px;
        background: rgba(8,12,17,0.92); color: var(--text);
        border: 1px solid var(--line-soft);
        font-size: 12px; opacity: 0; pointer-events: none;
        transition: opacity 160ms ease;
      }
      .toast.show { opacity: 1; }
      @keyframes pulse {
        0%,100% { box-shadow: 0 0 0 0 rgba(108,240,214,0.36); }
        50% { box-shadow: 0 0 0 7px rgba(108,240,214,0); }
      }
      @keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes blink { 50% { opacity: 0; } }
    </style>
  </head>
  <body>
    <main class="app">
      <header class="topbar">
        <div class="title">
          <h1>Natively Mirror</h1>
          <div class="subtitle" id="subtitle">Connecting</div>
        </div>
        <div class="status" id="status">
          <span class="dot" aria-hidden="true"></span>
          <span id="statusText">Offline</span>
        </div>
      </header>

      <section class="feed" id="feed" aria-live="polite">
        <div class="empty" id="empty">
          Waiting for the next response from your desktop.
        </div>
      </section>

      <nav class="actions" aria-label="Actions">
        <button class="action" id="clearButton" type="button">Clear</button>
        <button class="action primary" id="copyButton" type="button">Copy</button>
        <button class="action" id="scrollButton" type="button">Bottom</button>
      </nav>

      <div class="toast" id="toast" role="status"></div>
    </main>

    <script>
      (function () {
        const feed = document.getElementById('feed');
        const empty = document.getElementById('empty');
        const status = document.getElementById('status');
        const statusText = document.getElementById('statusText');
        const subtitle = document.getElementById('subtitle');
        const toast = document.getElementById('toast');

        // ───── Markdown renderer ─────────────────────────────────────────
        // Tiny, dependency-free, XSS-safe (escapes everything before
        // re-inserting any tag). Built specifically to match what the
        // desktop app's ReactMarkdown produces: code fences, inline code,
        // bold/italic, headings, ordered + unordered lists, blockquotes,
        // links, $math$, and horizontal rules.
        const HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        function esc(str) { return String(str || '').replace(/[&<>"']/g, function (c) { return HTML_ESCAPE[c]; }); }

        // ───── Syntax highlighter ────────────────────────────────────────
        // Hand-rolled, language-by-language ordered rules. Each rule is a
        // [token-class, regex-anchored-at-start]. We walk the source string
        // left-to-right, taking the first matching rule each step. Token
        // class shorthand (single char) keeps the served HTML small.
        // Unknown languages fall back to "generic" which still tints
        // strings/comments/numbers — useful for SQL dialects, ruby, etc.
        const LANG_ALIAS = {
          js: 'js', javascript: 'js', jsx: 'js',
          ts: 'js', typescript: 'js', tsx: 'js',
          py: 'py', python: 'py',
          sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh',
          json: 'json',
          go: 'go', golang: 'go',
          rs: 'rs', rust: 'rs',
          c: 'c', cpp: 'c', 'c++': 'c', cc: 'c', h: 'c', hpp: 'c', java: 'c', cs: 'c', csharp: 'c',
          html: 'html', xml: 'html', svg: 'html',
          css: 'css', scss: 'css', sass: 'css',
          sql: 'sql',
          yaml: 'yaml', yml: 'yaml',
        };
        const HL_RULES = {
          py: [
            ['c', /^#[^\\n]*/],
            ['s', /^(?:"""[\\s\\S]*?(?:"""|$)|'''[\\s\\S]*?(?:'''|$)|"(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*')/],
            ['k', /^\\b(?:def|class|return|if|elif|else|for|while|in|is|not|and|or|import|from|as|with|try|except|finally|raise|lambda|yield|pass|break|continue|global|nonlocal|None|True|False|async|await|del|assert|match|case)\\b/],
            ['v', /^\\b(?:self|cls)\\b/],
            ['n', /^\\b(?:0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|\\d+\\.?\\d*(?:e[+-]?\\d+)?[jJ]?)\\b/],
            ['f', /^\\b[A-Za-z_]\\w*(?=\\s*\\()/],
            ['o', /^[+\\-*/%=<>!&|^~?:@]+/],
          ],
          js: [
            ['c', /^(?:\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$))/],
            ['s', /^(?:\`(?:[^\`\\\\]|\\\\.)*(?:\`|$)|"(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*')/],
            ['k', /^\\b(?:const|let|var|function|return|if|else|for|while|do|break|continue|switch|case|default|new|delete|typeof|instanceof|in|of|throw|try|catch|finally|class|extends|super|null|undefined|true|false|async|await|yield|import|export|from|as|static|get|set|public|private|protected|interface|type|enum|namespace|implements|readonly|abstract|declare|void|never|any|unknown|keyof|infer|satisfies)\\b/],
            ['v', /^\\b(?:this|arguments|console|window|document|globalThis|process|require|module|exports)\\b/],
            ['n', /^\\b(?:0x[0-9a-fA-F]+|0b[01]+|\\d+\\.?\\d*(?:e[+-]?\\d+)?n?|\\.\\d+(?:e[+-]?\\d+)?)\\b/],
            ['f', /^\\b[A-Za-z_$][\\w$]*(?=\\s*\\()/],
            ['o', /^[+\\-*/%=<>!&|^~?:]+/],
          ],
          sh: [
            ['c', /^#[^\\n]*/],
            ['s', /^(?:"(?:[^"\\\\]|\\\\.)*"|'[^']*')/],
            ['v', /^\\$(?:\\{[^}]+\\}|[A-Za-z_]\\w*|[0-9!#?@*$])/],
            ['k', /^\\b(?:if|then|else|elif|fi|for|while|until|do|done|case|esac|in|function|return|exit|echo|export|local|set|unset|test|cd|ls|cat|grep|sed|awk|cut|sort|uniq|head|tail|wc|find|chmod|chown|mkdir|rm|cp|mv|ln|ssh|scp|rsync|curl|wget|sudo|read|printf|trap|source|eval)\\b/],
            ['n', /^\\b\\d+\\b/],
            ['o', /^[|&;<>=()$]+/],
          ],
          json: [
            ['a', /^"(?:[^"\\\\]|\\\\.)*"(?=\\s*:)/],
            ['s', /^"(?:[^"\\\\]|\\\\.)*"/],
            ['n', /^-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?/],
            ['k', /^\\b(?:true|false|null)\\b/],
            ['o', /^[{}\\[\\],:]/],
          ],
          go: [
            ['c', /^(?:\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$))/],
            ['s', /^(?:\`[^\`]*(?:\`|$)|"(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')/],
            ['k', /^\\b(?:break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go|goto|if|import|interface|map|package|range|return|select|struct|switch|type|var|nil|true|false|iota)\\b/],
            ['v', /^\\b(?:append|cap|close|complex|copy|delete|imag|len|make|new|panic|print|println|real|recover|string|int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|byte|rune|float32|float64|bool|error)\\b/],
            ['n', /^\\b(?:0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|\\d+\\.?\\d*(?:e[+-]?\\d+)?)\\b/],
            ['f', /^\\b[A-Za-z_]\\w*(?=\\s*\\()/],
            ['o', /^[+\\-*/%=<>!&|^~?:]+/],
          ],
          rs: [
            ['c', /^(?:\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$))/],
            ['s', /^(?:b?"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)')/],
            ['k', /^\\b(?:as|async|await|break|const|continue|crate|dyn|else|enum|extern|false|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|Self|static|struct|super|trait|true|type|unsafe|use|where|while)\\b/],
            ['v', /^\\b(?:i8|i16|i32|i64|i128|isize|u8|u16|u32|u64|u128|usize|f32|f64|bool|char|str|String|Vec|Option|Result|Box|Rc|Arc|HashMap|HashSet|None|Some|Ok|Err)\\b/],
            ['n', /^\\b(?:0x[0-9a-fA-F_]+|0b[01_]+|0o[0-7_]+|\\d[\\d_]*\\.?\\d*(?:e[+-]?\\d+)?(?:[iuf](?:8|16|32|64|128|size))?)\\b/],
            ['f', /^\\b[A-Za-z_]\\w*(?=\\s*[(!])/],
            ['o', /^[+\\-*/%=<>!&|^~?:@#]+/],
          ],
          c: [
            ['c', /^(?:\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$))/],
            ['s', /^(?:"(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')/],
            ['k', /^\\b(?:auto|break|case|char|const|continue|default|do|double|else|enum|extern|float|for|goto|if|inline|int|long|register|restrict|return|short|signed|sizeof|static|struct|switch|typedef|union|unsigned|void|volatile|while|class|public|private|protected|virtual|new|delete|this|nullptr|namespace|using|template|typename|true|false|try|catch|throw|public|private|protected|abstract|interface|implements|extends|package|import|null|var|let|val|fun|fn)\\b/],
            ['n', /^\\b(?:0x[0-9a-fA-F]+|\\d+\\.?\\d*(?:[eE][+-]?\\d+)?[fFlLuU]*)\\b/],
            ['f', /^\\b[A-Za-z_]\\w*(?=\\s*\\()/],
            ['o', /^[+\\-*/%=<>!&|^~?:]+/],
          ],
          html: [
            ['c', /^<!--[\\s\\S]*?(?:-->|$)/],
            ['t', /^<\\/?[A-Za-z][\\w-]*/],
            ['a', /^[A-Za-z_][\\w-]*(?=\\s*=)/],
            ['s', /^(?:"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')/],
            ['o', /^[<>=\\/]/],
          ],
          css: [
            ['c', /^\\/\\*[\\s\\S]*?(?:\\*\\/|$)/],
            ['s', /^(?:"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')/],
            ['a', /^[-A-Za-z]+(?=\\s*:)/],
            ['n', /^-?\\d+\\.?\\d*(?:px|em|rem|vw|vh|vmin|vmax|%|s|ms|deg|rad|turn|fr|ch|ex)?\\b/],
            ['k', /^@[A-Za-z-]+/],
            ['t', /^[#.][A-Za-z_][\\w-]*/],
            ['o', /^[{}();:,>+~]/],
          ],
          sql: [
            ['c', /^(?:--[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$))/],
            ['s', /^'(?:[^']|'')*'/],
            ['k', /^\\b(?:SELECT|FROM|WHERE|JOIN|INNER|LEFT|RIGHT|FULL|OUTER|CROSS|ON|GROUP|BY|HAVING|ORDER|LIMIT|OFFSET|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|DROP|ALTER|TABLE|INDEX|VIEW|AS|AND|OR|NOT|IN|EXISTS|BETWEEN|LIKE|ILIKE|IS|NULL|TRUE|FALSE|UNION|ALL|DISTINCT|CASE|WHEN|THEN|ELSE|END|WITH|RECURSIVE|PRIMARY|FOREIGN|KEY|REFERENCES|CONSTRAINT|UNIQUE|DEFAULT|CHECK|RETURNING|GRANT|REVOKE|BEGIN|COMMIT|ROLLBACK)\\b/i],
            ['n', /^\\b\\d+\\.?\\d*\\b/],
            ['f', /^\\b[A-Za-z_]\\w*(?=\\s*\\()/],
            ['o', /^[=<>!()*,;.+\\-]/],
          ],
          yaml: [
            ['c', /^#[^\\n]*/],
            ['a', /^[A-Za-z_][\\w-]*(?=\\s*:)/],
            ['s', /^(?:"(?:[^"\\\\]|\\\\.)*"|'(?:[^']|'')*'|\\|[\\s\\S]*?$|>[\\s\\S]*?$)/],
            ['k', /^\\b(?:true|false|null|yes|no|on|off)\\b/i],
            ['n', /^-?\\d+\\.?\\d*\\b/],
            ['o', /^[:\\-?>|&*!]/],
          ],
          generic: [
            ['c', /^(?:\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$)|#[^\\n]*)/],
            ['s', /^(?:"(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*(?:\`|$))/],
            ['n', /^\\b(?:0x[0-9a-fA-F]+|\\d+\\.?\\d*)\\b/],
            ['f', /^\\b[A-Za-z_]\\w*(?=\\s*\\()/],
          ],
        };
        // Order-independent fast path: for any language, the ident/whitespace/
        // single-char fall-through is the same.
        function highlightCode(code, lang) {
          const key = LANG_ALIAS[(lang || '').toLowerCase()] || (lang ? null : null);
          const rules = (key && HL_RULES[key]) || (lang ? HL_RULES.generic : null);
          if (!rules) return esc(code);
          const out = [];
          let i = 0;
          const n = code.length;
          while (i < n) {
            // Skip whitespace cheaply (no regex per char).
            const ch = code.charCodeAt(i);
            if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
              const start = i;
              do { i++; } while (i < n && (code.charCodeAt(i) === 32 || code.charCodeAt(i) === 9 || code.charCodeAt(i) === 10 || code.charCodeAt(i) === 13));
              out.push(esc(code.slice(start, i)));
              continue;
            }
            const tail = code.slice(i);
            let consumed = 0;
            for (let r = 0; r < rules.length; r++) {
              const rule = rules[r];
              const m = tail.match(rule[1]);
              if (m && m[0].length > 0) {
                out.push('<span class="hl-' + rule[0] + '">' + esc(m[0]) + '</span>');
                consumed = m[0].length;
                break;
              }
            }
            if (consumed === 0) {
              // No rule matched — consume one ident-ish run or one char.
              const idm = tail.match(/^[A-Za-z_$][\\w$]*/);
              if (idm) { out.push(esc(idm[0])); consumed = idm[0].length; }
              else { out.push(esc(code[i])); consumed = 1; }
            }
            i += consumed;
          }
          return out.join('');
        }

        function renderInline(text) {
          // Order matters: inline code first (so its content doesn't get
          // mangled by other rules), then math, then bold > italic, then links.
          let out = esc(text);
          // \`inline code\`
          out = out.replace(/\`([^\`\\n]+)\`/g, function (_m, c) { return '<code class="inline">' + c + '</code>'; });
          // $...$ math (single-dollar, not crossing newlines, not empty)
          out = out.replace(/(^|[^\\\\])\\$([^$\\n]+?)\\$/g, function (_m, pre, c) { return pre + '<span class="math">' + c + '</span>'; });
          // **bold** before *italic* so we don't eat the inner asterisks.
          out = out.replace(/\\*\\*([^*\\n]+?)\\*\\*/g, '<strong>$1</strong>');
          out = out.replace(/__([^_\\n]+?)__/g, '<strong>$1</strong>');
          out = out.replace(/(^|[^\\*])\\*([^*\\n]+?)\\*(?!\\*)/g, '$1<em>$2</em>');
          out = out.replace(/(^|[^_])_([^_\\n]+?)_(?!_)/g, '$1<em>$2</em>');
          // [text](url) — only allow http(s) and relative links.
          out = out.replace(/\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)/g, function (_m, label, href) {
            const safe = /^https?:\\/\\//i.test(href) ? href : '#';
            return '<a href="' + safe + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
          });
          return out;
        }

        function renderMarkdown(src) {
          if (!src) return '';
          // 1. Pull out fenced code blocks first (so their contents stay literal).
          //    Pass A: closed fences. Pass B: a trailing UNCLOSED fence (live
          //    streaming case) — anything from the last \`\`\` to end-of-input
          //    is shown as an "open" code block, so streamed code looks right
          //    well before the closing fence arrives.
          const fences = [];
          const fenceRe = /\`\`\`([\\w-]*)?\\n?([\\s\\S]*?)\`\`\`/g;
          let placeheld = src.replace(fenceRe, function (_m, lang, code) {
            fences.push({ lang: (lang || '').toLowerCase(), code: code.replace(/\\n$/, ''), open: false });
            return '\\u0000FENCE' + (fences.length - 1) + '\\u0000';
          });
          const openFenceRe = /(^|\\n)\`\`\`([\\w-]*)?\\n?([\\s\\S]*)$/;
          const openMatch = placeheld.match(openFenceRe);
          if (openMatch) {
            const startIdx = openMatch.index + openMatch[1].length;
            fences.push({ lang: (openMatch[2] || '').toLowerCase(), code: openMatch[3], open: true });
            placeheld = placeheld.slice(0, startIdx) + '\\u0000FENCE' + (fences.length - 1) + '\\u0000';
          }

          // 2. Walk lines, building paragraphs / lists / headings / quotes.
          const lines = placeheld.split(/\\n/);
          const out = [];
          let para = [];
          let list = null; // { type: 'ul'|'ol', items: string[] }
          let quote = [];

          function flushPara() {
            if (!para.length) return;
            const joined = para.join(' ').trim();
            if (joined) out.push('<p>' + renderInline(joined) + '</p>');
            para = [];
          }
          function flushList() {
            if (!list) return;
            out.push('<' + list.type + '>' + list.items.map(function (i) {
              return '<li>' + renderInline(i) + '</li>';
            }).join('') + '</' + list.type + '>');
            list = null;
          }
          function flushQuote() {
            if (!quote.length) return;
            out.push('<blockquote>' + renderInline(quote.join(' ')) + '</blockquote>');
            quote = [];
          }
          function flushAll() { flushPara(); flushList(); flushQuote(); }

          for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const line = raw;
            const trimmed = line.trim();

            // Code fence placeholder restores immediately, ending blocks.
            const fenceMatch = trimmed.match(/^\\u0000FENCE(\\d+)\\u0000$/);
            if (fenceMatch) {
              flushAll();
              const f = fences[parseInt(fenceMatch[1], 10)];
              const langLabel = f.lang ? esc(f.lang) : 'code';
              // While streaming an open fence: skip highlighting (it would
              // re-tokenize on every keystroke) and replace the Copy button
              // with a "Streaming…" label so the user knows it's live.
              const body = f.open ? esc(f.code) : highlightCode(f.code, f.lang);
              const trailing = f.open
                ? '<span class="codeblock-copy" aria-hidden="true">Streaming…</span>'
                : '<button type="button" class="codeblock-copy">Copy</button>';
              out.push(
                '<div class="codeblock' + (f.open ? ' streaming' : '') + '" data-lang="' + esc(f.lang) + '">' +
                '<div class="codeblock-head"><span>' + langLabel + '</span>' + trailing + '</div>' +
                '<pre><code>' + body + '</code></pre>' +
                '</div>'
              );
              continue;
            }

            // Blank line → paragraph break.
            if (!trimmed) { flushAll(); continue; }

            // Horizontal rule.
            if (/^(-{3,}|_{3,}|\\*{3,})$/.test(trimmed)) {
              flushAll(); out.push('<hr />'); continue;
            }

            // Heading.
            const h = trimmed.match(/^(#{1,3})\\s+(.+)$/);
            if (h) { flushAll(); out.push('<h' + h[1].length + '>' + renderInline(h[2]) + '</h' + h[1].length + '>'); continue; }

            // Block quote.
            const q = trimmed.match(/^>\\s?(.*)$/);
            if (q) { flushPara(); flushList(); quote.push(q[1]); continue; }

            // Ordered list.
            const ol = trimmed.match(/^(\\d+)[.)]\\s+(.+)$/);
            if (ol) {
              flushPara(); flushQuote();
              if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
              list.items.push(ol[2]);
              continue;
            }

            // Unordered list.
            const ul = trimmed.match(/^[-*+]\\s+(.+)$/);
            if (ul) {
              flushPara(); flushQuote();
              if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
              list.items.push(ul[1]);
              continue;
            }

            // Continuation line for the open block.
            if (list) { list.items[list.items.length - 1] += ' ' + trimmed; continue; }
            if (quote.length) { quote.push(trimmed); continue; }
            para.push(trimmed);
          }
          flushAll();
          return out.join('');
        }

        // Wires copy buttons inside code blocks. Idempotent — safe to call
        // after each render or token append.
        function bindCodeCopy(root) {
          const buttons = (root || feed).querySelectorAll('.codeblock-copy:not([data-bound])');
          buttons.forEach(function (btn) {
            btn.dataset.bound = '1';
            btn.addEventListener('click', async function (e) {
              e.stopPropagation();
              const block = btn.closest('.codeblock');
              const codeEl = block && block.querySelector('pre code');
              if (!codeEl) return;
              const text = codeEl.textContent || '';
              try {
                if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
                else throw new Error('insecure');
                btn.textContent = 'Copied'; btn.classList.add('copied');
                setTimeout(function () { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1100);
              } catch (_) { showToast('Copy blocked'); }
            });
          });
        }

        const params = new URLSearchParams(window.location.search);
        const token = params.get('t') || '';

        const messages = [];           // {id, role, content, createdAt}
        let live = null;               // { streamId, content, createdAt }
        let socket = null;
        let reconnectTimer = null;
        let reconnectDelay = 800;
        let wakeLock = null;

        function showToast(text) {
          toast.textContent = text;
          toast.classList.add('show');
          setTimeout(() => toast.classList.remove('show'), 1100);
        }

        function setConnected(isConnected) {
          status.classList.toggle('connected', isConnected);
          statusText.textContent = isConnected ? 'Connected' : 'Offline';
          subtitle.textContent = isConnected ? 'Live mirror active' : 'Reconnecting';
        }

        function fmtTime(value) {
          const d = value ? new Date(value) : new Date();
          if (Number.isNaN(d.getTime())) return '';
          return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        function near(scrollEl, px) {
          return scrollEl.scrollHeight - scrollEl.clientHeight - scrollEl.scrollTop < px;
        }

        function scrollToLatest(force) {
          if (force || near(feed, 80)) {
            feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
          }
        }

        function buildCard(m, opts) {
          const card = document.createElement('article');
          card.className = 'card' + (m.role === 'user' ? ' user' : '') + (opts && opts.live ? ' live' : '');
          card.dataset.id = m.id || '';
          const meta = document.createElement('div');
          meta.className = 'meta';
          const role = document.createElement('span');
          role.className = 'role' + (m.role === 'user' ? ' user' : '');
          const pip = document.createElement('span'); pip.className = 'pip';
          const roleLabel = document.createElement('span');
          roleLabel.textContent = m.role === 'user' ? 'You' : 'Assistant';
          role.append(pip, roleLabel);
          const right = document.createElement('span');
          right.textContent = fmtTime(m.createdAt);
          const badge = document.createElement('span');
          badge.className = 'badge'; badge.textContent = 'Live';
          meta.append(role, badge, right);
          const content = document.createElement('div');
          content.className = 'content';
          // User messages stay verbatim (they're transcripts/typed text).
          // Assistant messages get the full markdown treatment.
          if (m.role === 'user') {
            content.style.whiteSpace = 'pre-wrap';
            content.textContent = m.content || '';
          } else {
            content.innerHTML = renderMarkdown(m.content || '');
            if (opts && opts.live) {
              const caret = document.createElement('span');
              caret.className = 'caret';
              content.appendChild(caret);
            }
            bindCodeCopy(content);
          }
          card.append(meta, content);
          return card;
        }

        function render() {
          empty.style.display = (messages.length === 0 && !live) ? 'grid' : 'none';
          feed.querySelectorAll('.card').forEach((c) => c.remove());
          for (const m of messages) feed.appendChild(buildCard(m));
          if (live) feed.appendChild(buildCard({ id: 'live:' + live.streamId, role: 'assistant', content: live.content, createdAt: live.createdAt }, { live: true }));
          scrollToLatest();
        }

        // Coalesce token-driven renders to one per animation frame so a burst
        // of buffered tokens (network often delivers 5-20 at once) costs one
        // re-parse instead of N. requestAnimationFrame also pauses while the
        // tab is hidden — we'll catch up automatically on visibility return.
        let liveRenderRaf = 0;
        function flushLiveRender() {
          liveRenderRaf = 0;
          if (!live) return;
          let card = feed.querySelector('.card.live');
          if (!card) { render(); return; }
          const content = card.querySelector('.content');
          content.innerHTML = renderMarkdown(live.content);
          const caret = document.createElement('span');
          caret.className = 'caret';
          content.appendChild(caret);
          bindCodeCopy(content);
          empty.style.display = 'none';
          scrollToLatest();
        }
        function scheduleLiveRender() {
          if (liveRenderRaf) return;
          if (typeof requestAnimationFrame === 'function') {
            liveRenderRaf = requestAnimationFrame(flushLiveRender);
          } else {
            liveRenderRaf = setTimeout(flushLiveRender, 16);
          }
        }
        function appendLiveToken(streamId, token) {
          if (!live || live.streamId !== streamId) {
            live = { streamId, content: '', createdAt: new Date().toISOString() };
          }
          live.content += token;
          scheduleLiveRender();
        }

        function finalizeLive(streamId, content, createdAt) {
          // Cancel any pending live render — we're about to do a final one
          // with the canonical (server-confirmed) content.
          if (liveRenderRaf) {
            if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(liveRenderRaf);
            else clearTimeout(liveRenderRaf);
            liveRenderRaf = 0;
          }
          if (live && live.streamId === streamId) {
            messages.push({ id: 'a:' + streamId, role: 'assistant', content: content || live.content, createdAt: createdAt || live.createdAt });
            live = null;
            render();
          } else if (content) {
            messages.push({ id: 'a:' + streamId, role: 'assistant', content, createdAt: createdAt || new Date().toISOString() });
            render();
          }
        }

        function handleEvent(ev) {
          if (!ev || typeof ev !== 'object') return;
          if (ev.type === 'history' && Array.isArray(ev.messages)) {
            messages.length = 0;
            for (const m of ev.messages) messages.push(m);
            live = null;
            render();
            return;
          }
          if (ev.type === 'user') {
            messages.push({ id: ev.id, role: 'user', content: ev.content, createdAt: ev.createdAt });
            render();
            return;
          }
          if (ev.type === 'token') {
            appendLiveToken(String(ev.streamId), String(ev.token || ''));
            return;
          }
          if (ev.type === 'done') {
            finalizeLive(String(ev.streamId), ev.content, ev.createdAt);
            return;
          }
          if (ev.type === 'error') {
            if (live && live.streamId === String(ev.streamId)) {
              live.content += '\\n\\n[error: ' + (ev.message || 'stream failed') + ']';
              render();
              live = null;
            }
            showToast('Stream error');
            return;
          }
          if (ev.type === 'status') {
            // server-pushed status, ignored visually beyond connection state
            return;
          }
        }

        function connect() {
          clearTimeout(reconnectTimer);
          const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          const url = proto + '//' + window.location.host + '/ws?t=' + encodeURIComponent(token);
          try { socket = new WebSocket(url); } catch (e) { scheduleReconnect(); return; }

          socket.addEventListener('open', () => {
            setConnected(true);
            reconnectDelay = 800;
          });
          socket.addEventListener('close', (ev) => {
            setConnected(false);
            if (ev.code === 4401) { subtitle.textContent = 'Pairing token rejected'; return; }
            scheduleReconnect();
          });
          socket.addEventListener('error', () => {
            try { socket && socket.close(); } catch (e) {}
          });
          socket.addEventListener('message', (event) => {
            let payload;
            try { payload = JSON.parse(event.data); } catch (e) { return; }
            handleEvent(payload);
          });
        }

        function scheduleReconnect() {
          clearTimeout(reconnectTimer);
          const wait = Math.min(reconnectDelay, 8000);
          reconnectTimer = setTimeout(connect, wait);
          reconnectDelay = Math.min(reconnectDelay * 1.6, 8000);
        }

        async function requestWakeLock() {
          if (!('wakeLock' in navigator)) return;
          try {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => { wakeLock = null; });
          } catch (e) { wakeLock = null; }
        }

        document.getElementById('clearButton').addEventListener('click', () => {
          messages.length = 0; live = null; render();
        });
        document.getElementById('copyButton').addEventListener('click', async () => {
          const parts = messages.map((m) => (m.role === 'user' ? 'You: ' : '') + m.content);
          if (live && live.content) parts.push(live.content);
          const text = parts.join('\\n\\n');
          if (!text) return;
          try {
            if (navigator.clipboard && window.isSecureContext) {
              await navigator.clipboard.writeText(text);
            } else {
              const ta = document.createElement('textarea');
              ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
              document.body.appendChild(ta); ta.select();
              document.execCommand('copy'); document.body.removeChild(ta);
            }
            showToast('Copied');
          } catch (e) { showToast('Copy blocked'); }
        });
        document.getElementById('scrollButton').addEventListener('click', () => scrollToLatest(true));

        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') requestWakeLock();
        });

        if (!token) {
          subtitle.textContent = 'Missing pairing token';
          status.classList.remove('connected');
          return;
        }

        requestWakeLock();
        connect();
      })();
    </script>
  </body>
</html>
`;
