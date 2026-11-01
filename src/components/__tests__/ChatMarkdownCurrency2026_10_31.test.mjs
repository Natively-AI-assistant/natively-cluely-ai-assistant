// Dollar amounts in the meeting chats are text, not math (2026-10-31). The
// meeting chat and the search-all chat (chatMarkdown.tsx) ran remark-math on
// the raw answer, so "$175,000 ... $160,000" paired up as inline math and the
// words between were drawn as KaTeX italics. Found by the Granola benchmark
// (interview-1: "What salary does Tomasz want?"). The overlay and the meeting
// page already escaped currency with normalizeFinalizedMarkdownMath; the chats
// now do too.
//
// Pure renderer logic; no platform branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import { normalizeFinalizedMarkdownMath } from '../../lib/streamingMarkdown.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, '../chatMarkdown.tsx'), 'utf8');

const mathNodes = (md) => {
    const tree = unified().use(remarkParse).use(remarkMath).parse(md);
    let n = 0;
    const walk = (node) => { if (node.type === 'inlineMath' || node.type === 'math') n++; (node.children ?? []).forEach(walk); };
    walk(tree);
    return n;
};

test('the chat renderer escapes dollar amounts before remark-math sees them', () => {
    assert.match(src, /import \{ normalizeFinalizedMarkdownMath \} from '\.\.\/lib\/streamingMarkdown';/);
    assert.match(src, /\{normalizeFinalizedMarkdownMath\(chunk\)\}/);
});

test('two amounts in one answer stay text', () => {
    const answer = 'Tomasz wants a base of $175,000. He is currently at $160,000 and has another offer.';
    assert.ok(mathNodes(answer) > 0, 'unescaped, remark-math pairs the amounts (the bug)');
    assert.equal(mathNodes(normalizeFinalizedMarkdownMath(answer)), 0);
    assert.equal(mathNodes(normalizeFinalizedMarkdownMath('The quote was $2,400/month; Parrotdesk quoted $2,200 a month.')), 0);
});

test('real math in an answer still renders', () => {
    assert.equal(mathNodes(normalizeFinalizedMarkdownMath('Energy is $E=mc^2$ here.')), 1);
});
