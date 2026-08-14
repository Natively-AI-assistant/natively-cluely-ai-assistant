import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(here, '../NativelyInterface.tsx'), 'utf8');

test('imperative stream uses math-aware renderer before DOMPurify', () => {
  assert.match(source, /import\s*\{[^}]*\brenderStreamingMarkdown\b[^}]*\}\s*from\s*['"]\.\.\/lib\/streamingMarkdown['"]/);
  assert.match(source, /const rawHtml = collapseBlockGaps\(renderStreamingMarkdown\(revealedBody\)\);[\s\S]*?DOMPurify\.sanitize\(rawHtml \+ gistHtml\)/);
});

test('NativelyInterface no longer imports or calls the global marked singleton', () => {
  assert.doesNotMatch(source, /import\s*\{\s*marked\s*\}\s*from\s*['"]marked['"]/);
  assert.doesNotMatch(source, /marked\.parse\(/);
});

test('finalized renderer still uses the existing remark/rehype math pipeline', () => {
  assert.match(source, /const REMARK_PLUGINS = \[remarkGfm, remarkMath\]/);
  assert.match(source, /const REHYPE_PLUGINS[^=]*= \[\[rehypeKatex,/);
});


test('every finalized ReactMarkdown source is normalized before remarkMath', () => {
  const blocks = [...source.matchAll(/<ReactMarkdown\b[\s\S]*?>\s*\{([^}]+)\}\s*<\/ReactMarkdown>/g)];
  assert.ok(blocks.length >= 7, `expected all finalized branches, found ${blocks.length}`);
  for (const [, child] of blocks) {
    assert.match(child.trim(), /^normalizeFinalizedMarkdownMath\(/, `unnormalized ReactMarkdown child: ${child.trim()}`);
  }
});
