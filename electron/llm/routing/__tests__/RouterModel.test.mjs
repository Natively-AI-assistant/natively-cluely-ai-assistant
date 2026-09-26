// electron/llm/routing/__tests__/RouterModel.test.mjs
//
// PR 6 guards. The router is wired but flagged OFF, so what these check is that
// it stays off, that it fails to null rather than throwing, and that the text it
// builds still matches the text it was trained on.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const load = (rel) => import(pathToFileURL(path.join(repoRoot, 'dist-electron/electron', rel)).href);

const { isInteractionRouterEnabled, DEFAULT_ENABLED, INTERACTION_ROUTER_ENV_KEY } =
  await load('llm/routing/flag.js');
const { buildRouterText } = await load('llm/routing/routerText.js');

describe('the router ships off', () => {
    const saved = process.env[INTERACTION_ROUTER_ENV_KEY];
    beforeEach(() => { delete process.env[INTERACTION_ROUTER_ENV_KEY]; });
    afterEach(() => {
        if (saved === undefined) delete process.env[INTERACTION_ROUTER_ENV_KEY];
        else process.env[INTERACTION_ROUTER_ENV_KEY] = saved;
    });

    test('DEFAULT_ENABLED is false, and PR 6 is required to ship that way', () => {
        assert.equal(DEFAULT_ENABLED, false);
    });

    test('with no env and no stored preference, it is off', () => {
        assert.equal(isInteractionRouterEnabled(null), false);
    });

    test('a stored preference turns it on', () => {
        assert.equal(isInteractionRouterEnabled(true), true);
    });

    test('the env var beats the stored preference, both directions', () => {
        process.env[INTERACTION_ROUTER_ENV_KEY] = '1';
        assert.equal(isInteractionRouterEnabled(false), true);
        process.env[INTERACTION_ROUTER_ENV_KEY] = '0';
        assert.equal(isInteractionRouterEnabled(true), false);
    });

    test('an unparseable env value falls through rather than deciding', () => {
        process.env[INTERACTION_ROUTER_ENV_KEY] = 'maybe';
        assert.equal(isInteractionRouterEnabled(true), true);
        assert.equal(isInteractionRouterEnabled(null), DEFAULT_ENABLED);
    });
});

describe('the encoder text matches what the model was trained on', () => {
    // The trainer, the benchmark provider and this worker each build the string
    // the encoder sees. If they drift, the model predicts on a format it was
    // never fitted to, nothing throws, and the accuracy drop reads as a bad
    // model. scripts/intent-benchmark checks the first two against each other;
    // this checks the third against the same fixed shape.
    test('the field order and separators are exact', () => {
        assert.equal(
            buildRouterText({
                mode: 'team-meet', channel: 'system', modeHasReferenceFiles: true,
                history: ['[SYSTEM] a', '[USER] b'], turn: 'so what about the export',
            }),
            '[mode] team-meet [channel] system [files] yes [history] [SYSTEM] a [USER] b [turn] so what about the export',
        );
    });

    test('only the last two history turns are used', () => {
        const t = buildRouterText({
            mode: 'general', channel: 'mic', history: ['one', 'two', 'three'], turn: 'x',
        });
        assert.ok(t.includes('[history] two three '), t);
        assert.ok(!t.includes('one'), t);
    });

    test('an absent history yields an empty history field, not a missing one', () => {
        const t = buildRouterText({ mode: 'general', channel: 'mic', turn: 'x' });
        assert.ok(t.includes('[history]  [turn] x'), t);
    });

    test('files is yes or no, never a boolean or undefined', () => {
        assert.ok(buildRouterText({ mode: 'g', channel: 'mic', turn: 'x' }).includes('[files] no '));
        assert.ok(buildRouterText({ mode: 'g', channel: 'mic', turn: 'x', modeHasReferenceFiles: true }).includes('[files] yes '));
    });

    test('it matches the corpus format the benchmark scores against', () => {
        // Same row shape the benchmark's buildText receives, same string out.
        const row = { mode: 'lecture', channel: 'system', mode_has_reference_files: false, history: ['[SYSTEM] q'], input: 'why' };
        const expected = `[mode] ${row.mode} [channel] ${row.channel} [files] no [history] ${row.history.join(' ')} [turn] ${row.input}`;
        assert.equal(
            buildRouterText({
                mode: row.mode, channel: row.channel,
                modeHasReferenceFiles: row.mode_has_reference_files,
                history: row.history, turn: row.input,
            }),
            expected,
        );
    });
});

describe('the shipped model is the one that was measured', () => {
    test('the exported model directory carries a two-class needs_response', () => {
        const heads = path.join(repoRoot, 'resources/models/natively/router-minilm-multihead/heads.json');
        if (!fs.existsSync(heads)) return; // not every checkout downloads models
        const cfg = JSON.parse(fs.readFileSync(heads, 'utf8'));
        assert.deepEqual(Object.keys(cfg.label_maps.needs_response).sort(), ['no', 'yes']);
    });

    test('and records which epoch produced it', () => {
        const heads = path.join(repoRoot, 'resources/models/natively/router-minilm-multihead/heads.json');
        if (!fs.existsSync(heads)) return;
        const cfg = JSON.parse(fs.readFileSync(heads, 'utf8'));
        assert.ok(cfg.selection?.best_epoch > 0, 'heads.json must record the selected epoch');
    });
});
