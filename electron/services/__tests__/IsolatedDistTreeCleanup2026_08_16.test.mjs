// Regression guard for the Windows node_modules-destroying cleanup (2026-08-16).
//
// Two suites build an isolated dist tree in os.tmpdir() and link the repo's
// real node_modules into it. Their cleanup used a bare
// `fs.rmSync(dir, { recursive: true, force: true })`, which on Windows can
// traverse the JUNCTION and delete the contents of the real node_modules.
//
// Caught in CI: esbuild's win32 package was present when the Electron suite
// started and gone when it finished, taking down every later step. Off CI it is
// worse — a Windows developer running `npm test` corrupts their own install.
//
// These tests exercise the real helper against a real link, so they prove the
// property rather than pattern-matching source text. On POSIX the link is a
// directory symlink and on Windows a junction; in BOTH cases the linked-to
// directory and its contents must survive.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    NODE_MODULES_LINK_TYPE,
    detachNodeModulesLink,
    removeIsolatedDistTree,
} from './isolatedDistTree.mjs';

/** Build a (real node_modules stand-in) + (isolated tree linking to it) pair. */
function makeLinkedPair() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-dist-guard-'));
    const realModules = path.join(root, 'real_node_modules');
    fs.mkdirSync(path.join(realModules, '@esbuild', 'win32-x64'), { recursive: true });
    fs.writeFileSync(path.join(realModules, '@esbuild', 'win32-x64', 'package.json'), '{"name":"stand-in"}');

    const isolated = path.join(root, 'isolated');
    fs.mkdirSync(isolated);
    fs.writeFileSync(path.join(isolated, 'compiled.js'), '// emitted output');
    fs.symlinkSync(realModules, path.join(isolated, 'node_modules'), NODE_MODULES_LINK_TYPE);

    return { root, realModules, isolated };
}

describe('isolated dist tree cleanup cannot destroy the real node_modules', () => {
    test('removeIsolatedDistTree deletes the tree but leaves the linked-to directory intact', () => {
        const { root, realModules, isolated } = makeLinkedPair();
        try {
            const canary = path.join(realModules, '@esbuild', 'win32-x64', 'package.json');
            assert.ok(fs.existsSync(canary), 'setup: the stand-in package must exist before cleanup');

            removeIsolatedDistTree(isolated);

            assert.equal(fs.existsSync(isolated), false, 'the isolated tree itself must be removed');
            assert.ok(
                fs.existsSync(canary),
                'BUG: cleanup followed the node_modules link and deleted the REAL tree — on Windows this '
                + 'wipes the developer\'s node_modules and breaks every later CI step (esbuild first).',
            );
            assert.deepEqual(
                fs.readdirSync(path.join(realModules, '@esbuild')), ['win32-x64'],
                'the linked-to directory must be untouched, not merely present',
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('detachNodeModulesLink removes the link itself without touching the target', () => {
        const { root, realModules, isolated } = makeLinkedPair();
        try {
            assert.equal(detachNodeModulesLink(isolated), true, 'the link must be detachable');
            assert.equal(
                fs.existsSync(path.join(isolated, 'node_modules')), false,
                'the link must be gone after detaching',
            );
            assert.ok(fs.existsSync(realModules), 'detaching must not remove the target directory');
            // The isolated tree's own contents must survive detaching — cleanup
            // detaches first and deletes second, so this must not be destructive.
            assert.ok(fs.existsSync(path.join(isolated, 'compiled.js')), 'detaching must not empty the tree');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('removeIsolatedDistTree detaches the link BEFORE deleting (bites on every platform)', () => {
        // The end-state assertions above cannot distinguish the safe
        // implementation from the destructive one on POSIX: fs.rmSync unlinks a
        // symlink rather than following it, so a bare rmSync passes here and
        // fails only on Windows junctions. Mutation-probed and confirmed — with
        // the detach deleted, every other test in this file still passed on
        // macOS. Assert the CALL so a regression is caught on the platform the
        // developer is actually running, not by corrupting a Windows install.
        const { root, isolated } = makeLinkedPair();
        try {
            const calls = [];
            let linkStillPresentAtDetach = null;
            removeIsolatedDistTree(isolated, (dir) => {
                calls.push(dir);
                // Ordering matters as much as the call: detaching after the
                // recursive delete would be useless.
                linkStillPresentAtDetach = fs.existsSync(path.join(dir, 'node_modules'));
                return detachNodeModulesLink(dir);
            });
            assert.deepEqual(
                calls, [isolated],
                'BUG: removeIsolatedDistTree must detach the node_modules link exactly once, for this tree.',
            );
            assert.equal(
                linkStillPresentAtDetach, true,
                'BUG: the detach must run BEFORE the recursive delete — afterwards it protects nothing.',
            );
            assert.equal(fs.existsSync(isolated), false, 'the tree must still be removed');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('detaching is idempotent and safe when setup never created the link', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-dist-nolink-'));
        try {
            // Cleanup runs even when setup threw before symlinking; it must not throw.
            assert.equal(detachNodeModulesLink(dir), false, 'no link present => nothing detached');
            removeIsolatedDistTree(dir);
            assert.equal(fs.existsSync(dir), false, 'the tree is still removed when there was no link');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
