// Settings › Connectors shows each service's own logo. The rows used to share
// generic lucide glyphs (Contact for all five CRMs, Hash for Slack, BookOpen for
// Notion), so this pins the wiring: every connector row asks for a mark, every
// mark resolves to a vendored file on disk, and the vendored SVGs are safe to
// inline and sized by font-size.
//
// Run: node --test src/components/__tests__/ConnectorMarkCoverage.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const pane = read('src/components/settings/ConnectionsSettings.tsx');
const markSrc = read('src/components/settings/ConnectorMark.tsx');
const logos = path.join(root, 'src/assets/provider-logos');

// id → file, as ConnectorMark.tsx imports them.
const imports = Object.fromEntries(
    [...markSrc.matchAll(/import (\w+) from '\.\.\/\.\.\/assets\/provider-logos\/([\w.-]+?)(?:\?raw)?';/g)].map((m) => [m[1], m[2]]),
);
const registry = {};
for (const [, id, ident] of markSrc.matchAll(/^\s{4}(\w+): (\w+),$/gm)) registry[id] = imports[ident];

test('every connector on the list has a real mark, in Granola\'s order', () => {
    const catalog = read('src/components/settings/connectors/catalog.ts');
    const marks = [...catalog.matchAll(/key: '(\w+)', group: '\w+', title: '[^']+', mark: '(\w+)'/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(marks.map(([k]) => k), ['gmail', 'slack', 'notion', 'zapier', 'affinity', 'hubspot', 'salesforce', 'attio', 'pipedrive', 'clearbit', 'webhooks']);
    for (const [, mark] of marks) assert.ok(registry[mark], `${mark} has no entry in ConnectorMark.tsx`);
    // The list draws each row's mark from the catalog, and the pages' rows use marks too.
    assert.match(pane, /<ConnectorMark id=\{e\.mark\}/);
    const ids = [...pane.matchAll(/<ConnectorMark id="(\w+)"/g)].map((m) => m[1]);
    for (const id of ids) assert.ok(registry[id], `${id} has no entry in ConnectorMark.tsx`);
    assert.doesNotMatch(pane, /<(Contact|Hash|BookOpen) size=\{20\}/);
});

test('every registered mark is a vendored file on disk', () => {
    assert.ok(Object.keys(registry).length >= 8);
    for (const [id, file] of Object.entries(registry)) {
        assert.ok(fs.existsSync(path.join(logos, file)), `${id}: ${file} missing`);
    }
});

test('inlined SVGs are 1em-sized and carry nothing but vector art', () => {
    for (const [id, file] of Object.entries(registry)) {
        if (!file.endsWith('.svg')) continue;
        const svg = fs.readFileSync(path.join(logos, file), 'utf8');
        const root = svg.match(/<svg[^>]*>/)[0];
        assert.match(root, /width="1em"/, `${id} width`);
        assert.match(root, /height="1em"/, `${id} height`);
        assert.doesNotMatch(svg, /<script|<foreignObject|href=|on\w+=/i, `${id} unsafe content`);
    }
});

test('the tab is called Connectors in the nav; its id stays "connections"', () => {
    const overlay = read('src/components/SettingsOverlay.tsx');
    assert.match(overlay, /<Plug size=\{16\} \/> \{t\('Connectors'\)\}/);
    assert.match(overlay, /setActiveTab\('connections'\)/);
});
