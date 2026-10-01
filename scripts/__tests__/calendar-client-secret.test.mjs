// Calendar sync's Google client secret is baked in at build time, not
// committed (scripts/lib/calendar-client-secret.cjs). A build without it ships
// a calendar that can never connect, which is how every release before
// 2026-09-26 shipped without a client ID. These pin where the secret comes
// from, the gate that refuses to package without it, and the contract between
// build-electron.js's esbuild `define` and what CalendarManager reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lib = require(path.join(repoRoot, 'scripts/lib/calendar-client-secret.cjs'));

/** A fake repo root with an optional .env and an optional compiled main.js. */
function fakeRoot({ dotenv, mainJs } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-secret-'));
    if (dotenv !== undefined) fs.writeFileSync(path.join(root, '.env'), dotenv);
    if (mainJs !== undefined) {
        fs.mkdirSync(path.join(root, 'dist-electron', 'electron'), { recursive: true });
        fs.writeFileSync(path.join(root, 'dist-electron', 'electron', 'main.js'), mainJs);
    }
    return root;
}

test('the secret comes from the environment first, then .env, else it is empty', () => {
    const root = fakeRoot({ dotenv: 'OTHER=1\nGOOGLE_CALENDAR_CLIENT_SECRET="from-dotenv"\n' });
    assert.equal(lib.resolveCalendarClientSecret(root, { GOOGLE_CALENDAR_CLIENT_SECRET: 'from-env' }), 'from-env');
    assert.equal(lib.resolveCalendarClientSecret(root, {}), 'from-dotenv');
    assert.equal(lib.resolveCalendarClientSecret(fakeRoot(), {}), '');
});

test('the gate names each way a build can lack the secret, and passes a baked one', () => {
    assert.match(lib.calendarSecretProblem(fakeRoot({ mainJs: 'x' }), {}), /GOOGLE_CALENDAR_CLIENT_SECRET is not set/);
    assert.match(lib.calendarSecretProblem(fakeRoot(), { GOOGLE_CALENDAR_CLIENT_SECRET: 's3' }), /npm run build:electron/);
    assert.match(
        lib.calendarSecretProblem(fakeRoot({ mainJs: 'const s = "" || "";' }), { GOOGLE_CALENDAR_CLIENT_SECRET: 's3' }),
        /built without GOOGLE_CALENDAR_CLIENT_SECRET/,
        'a build made before the secret was set is caught, not just a missing .env',
    );
    assert.equal(lib.calendarSecretProblem(fakeRoot({ mainJs: 'const s = "s3";' }), { GOOGLE_CALENDAR_CLIENT_SECRET: 's3' }), null);
    assert.throws(() => lib.assertCalendarSecretBaked(fakeRoot(), {}), /\[calendar\]/);
});

test('only unpacked dir builds are let through without it', () => {
    assert.equal(lib.isUnpackedDirBuild(['--win', 'dir', '--x64']), true, 'the Windows CI smoke build');
    assert.equal(lib.isUnpackedDirBuild(['--dir']), true);
    assert.equal(lib.isUnpackedDirBuild([]), false, 'npm run dist');
    assert.equal(lib.isUnpackedDirBuild(['--config', 'electron-builder.signed.cjs']), false, 'npm run dist:signed');
    assert.equal(lib.isUnpackedDirBuild(['--mac', 'dmg']), false);
});

test('the esbuild define in build-electron.js reaches what CalendarManager reads', () => {
    const esbuild = require(require.resolve('esbuild', { paths: [repoRoot] }));
    const out = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, 'electron/services/CalendarManager.ts')],
        bundle: false,
        write: false,
        platform: 'node',
        format: 'cjs',
        define: { [lib.BAKED_EXPRESSION]: JSON.stringify('probe-secret-value') },
    }).outputFiles[0].text;
    assert.ok(out.includes('"probe-secret-value"'), 'the baked value must land in the compiled calendar code');
    assert.equal(out.includes('NATIVELY_BAKED_CALENDAR_CLIENT_SECRET'), false, 'no unreplaced env read may remain');
});
