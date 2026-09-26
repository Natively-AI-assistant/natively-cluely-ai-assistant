// Native popups are their own OS windows, outside the content protection the
// app's windows carry in Undetectable mode, so they show up in screen shares.
// Recorded 2026-09-27 on macOS: a native <select>'s option list and a
// window.confirm() dialog both appeared over an otherwise empty desktop while
// the launcher itself stayed hidden. Use AipSelect / an in-window menu and
// ConfirmDialog (useConfirmDialog) instead. Title tooltips are handled at
// runtime by src/lib/nativeTooltipGuard.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function sources(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    // .js under src are gitignored build leftovers (.gitignore: /src/**/*.js);
    // vite resolves the .ts/.tsx/.mjs source first.
    else if (/\.(tsx|ts|mjs)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

// Blank out comments and string literals in one left-to-right pass, keeping
// every newline so reported line numbers stay right. Two separate regexes got
// this wrong: a `/*` inside a `//` comment opened a fake block that hid real
// code up to the next `*/`. Template literals are blanked whole (their `${}`
// code is not scanned); JSX text is left alone, since it is not a JS string.
export function blankCommentsAndStrings(src, { strings = true } = {}) {
  let out = '';
  let i = 0;
  const keepNewlines = (text) => text.replace(/[^\n]/g, ' ');
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      out += keepNewlines(src.slice(i, stop));
      i = stop;
    } else if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += keepNewlines(src.slice(i, stop));
      i = stop;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') j++;
        else if (c !== '`' && src[j] === '\n') break; // unterminated: stop at the line end
        j++;
      }
      const body = src.slice(i + 1, j);
      out += c + (strings ? keepNewlines(body) : body) + (src[j] === c ? c : '');
      i = src[j] === c ? j + 1 : j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// A call of the global dialog, however it is reached: bare, or through
// window. / self. / globalThis. (optional-chained too). A function DECLARED with
// one of those names is not a call. Matched with strings blanked.
const NATIVE_DIALOG_CALL =
  /(?:(?:^|[^\w.$])(?<!function\s)|\b(?:window|self|globalThis)\??\.)(?:confirm|alert|prompt)\s*(?:\?\.)?\(/;
// window['confirm'](…): the name IS a string, so matched with strings kept.
const NATIVE_DIALOG_INDEXED = /\b(?:window|self|globalThis)\??\.?\[\s*['"`](?:confirm|alert|prompt)['"`]\s*\]/;
const isNativeDialog = (codeLine, codeWithStringsLine) =>
  NATIVE_DIALOG_CALL.test(codeLine) || NATIVE_DIALOG_INDEXED.test(codeWithStringsLine);
const NATIVE_SELECT = /<select(?:\s|>|$)|createElement\(\s*['"`]select['"`]/;

const FILES = [...sources(path.join(repoRoot, 'src')), ...sources(path.join(repoRoot, 'premium', 'src'))];

test('the scan actually covers the renderer', () => {
  assert.ok(FILES.some((f) => f.endsWith(path.join('settings', 'AIProvidersSettings.tsx'))));
  assert.ok(FILES.length > 50);
});

test('no native confirm/alert/prompt dialogs', () => {
  const hits = [];
  for (const f of FILES) {
    const src = readFileSync(f, 'utf8');
    const withStrings = blankCommentsAndStrings(src, { strings: false }).split('\n');
    blankCommentsAndStrings(src).split('\n').forEach((line, i) => {
      if (isNativeDialog(line, withStrings[i])) hits.push(`${path.relative(repoRoot, f)}:${i + 1}: ${withStrings[i].trim()}`);
    });
  }
  assert.deepEqual(hits, [], `native dialogs leak into screen shares; use useConfirmDialog:\n${hits.join('\n')}`);
});

test('no native <select> elements', () => {
  const hits = [];
  for (const f of FILES) {
    blankCommentsAndStrings(readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
      if (NATIVE_SELECT.test(line)) hits.push(`${path.relative(repoRoot, f)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, [], `a native <select> popup leaks into screen shares; use AipSelect:\n${hits.join('\n')}`);
});

test('the scanner itself: comments and strings hide nothing real, and every call form is caught', () => {
  // The bug this replaced: `/*` inside a line comment swallowed the code after it.
  const hidden = "// every meta/* chat id\nconfirm('x');\n// done */";
  assert.match(blankCommentsAndStrings(hidden).split('\n')[1], NATIVE_DIALOG_CALL);
  // Line numbers survive a multi-line block comment.
  assert.equal(blankCommentsAndStrings('/*\n\n*/\nalert(1)').split('\n')[3], 'alert(1)');
  const flagged = (code) => isNativeDialog(blankCommentsAndStrings(code), blankCommentsAndStrings(code, { strings: false }));
  for (const call of ['confirm("x")', 'window.confirm("x")', 'window?.confirm("x")', 'window.confirm?.("x")',
    'globalThis.alert(1)', 'self.prompt("q")', "window['confirm']('x')", 'x = alert (1)']) {
    assert.equal(flagged(call), true, call);
  }
  for (const fine of ['askConfirm({ title })', 'dialog.confirm()', 'function confirm(a) {}', "t('Please confirm (twice)')",
    '// confirm("x")', '/* alert(1) */', 'const s = `alert(1)`']) {
    assert.equal(flagged(fine), false, fine);
  }
  assert.match('<select', NATIVE_SELECT);
  assert.match("React.createElement('select', null)", NATIVE_SELECT);
  assert.doesNotMatch('<selectable-row>', NATIVE_SELECT);
});
