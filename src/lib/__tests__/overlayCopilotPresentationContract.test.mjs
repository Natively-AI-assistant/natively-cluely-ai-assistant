import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const copilotSource = readFileSync(
  path.resolve(__dirname, '../../components/ui/CopilotPane.tsx'),
  'utf8',
);
const interfaceSource = readFileSync(
  path.resolve(__dirname, '../../components/NativelyInterface.tsx'),
  'utf8',
);
const stylesheet = readFileSync(path.resolve(__dirname, '../../index.css'), 'utf8');

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stylesheet.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1].replace(/\s+/g, ' ');
}

test('Copilot text surfaces wrap unbroken URLs, hashes, and words inside the pane', () => {
  assert.match(
    copilotSource,
    /className=["'][^"']*\bcopilot-pane-content\b[^"']*\bmin-w-0\b[^"']*["']/,
    'the always-mounted Copilot content wrapper must own a scoped wrapping policy',
  );

  const contentRule = ruleBody('.copilot-pane-content .markdown-content');
  assert.match(contentRule, /min-width:\s*0\s*;/);
  assert.match(contentRule, /max-width:\s*100%\s*;/);
  assert.match(contentRule, /overflow-wrap:\s*anywhere\s*;/);
  assert.match(contentRule, /word-break:\s*break-word\s*;/);
});

test('Copilot wrapping policy preserves no-wrap horizontal scrolling for fenced code', () => {
  const streamingPreRule = ruleBody('.copilot-pane-content .markdown-content pre');
  assert.match(streamingPreRule, /max-width:\s*100%\s*;/);
  assert.match(streamingPreRule, /overflow-x:\s*auto\s*;/);

  const codeResetRule = ruleBody('.copilot-pane-content .markdown-content pre *');
  assert.match(codeResetRule, /overflow-wrap:\s*normal\s*;/);
  assert.match(codeResetRule, /word-break:\s*normal\s*;/);
  assert.match(
    interfaceSource,
    /className=["']w-full min-w-0 bg-transparent overflow-x-auto["']/,
  );
  assert.match(interfaceSource, /wrapLongLines=\{false\}/);
});

test('manual resize reverses from the midpoint state shown by the resize icon', () => {
  const start = interfaceSource.indexOf('const handleManualResizeToggle = useCallback(() => {');
  const end = interfaceSource.indexOf('// Derive the resize-button icon state', start);
  assert.ok(start >= 0 && end > start, 'could not isolate handleManualResizeToggle');
  const handler = interfaceSource.slice(start, end);

  assert.match(
    handler,
    /const target\s*=\s*isShellWide\s*\?\s*SHELL_WIDTH_COLLAPSED\s*:\s*SHELL_WIDTH_EXPANDED\s*;/,
    'the click target must be the opposite of the midpoint-derived icon state',
  );
  assert.doesNotMatch(
    handler,
    /shellWidth\.get\(\)/,
    'endpoint comparison cannot reverse an in-flight expansion after the icon crosses its midpoint',
  );
  assert.match(
    handler,
    /\[[^\]]*\bisShellWide\b[^\]]*\]/,
    'the callback must refresh when the visible midpoint state changes',
  );
});
