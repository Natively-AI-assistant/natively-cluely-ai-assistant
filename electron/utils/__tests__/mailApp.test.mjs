// Covers electron/utils/mailApp.ts: the default mail app (name + icon) the
// follow-up sheet's send menu shows, on both platform branches, with Electron's
// `app` replaced by a stand-in.
// Run from the repo root after build:electron: node --test electron/utils/__tests__/mailApp.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const { defaultMailApp, mailAppName } = require(path.join(repoRoot, 'dist-electron/electron/utils/mailApp.js'));

const icon = (empty = false) => ({
    isEmpty: () => empty,
    resize: ({ width, height }) => ({ toDataURL: () => `data:image/png;base64,${width}x${height}` }),
});
const source = ({ info, infoError, name = '', nameError } = {}) => {
    const asked = [];
    return {
        asked,
        getApplicationInfoForProtocol: async (url) => { asked.push(url); if (infoError) throw infoError; return info; },
        getApplicationNameForProtocol: (url) => { asked.push(url); if (nameError) throw nameError; return name; },
    };
};

describe('mailAppName', () => {
    test('drops a bundle or executable suffix and spaces', () => {
        assert.equal(mailAppName('Mail.app'), 'Mail');
        assert.equal(mailAppName(' OUTLOOK.EXE '), 'OUTLOOK');
        assert.equal(mailAppName('Microsoft Outlook'), 'Microsoft Outlook');
        assert.equal(mailAppName(undefined), '');
    });
});

for (const platform of ['darwin', 'win32']) {
    describe(`defaultMailApp on ${platform}`, () => {
        test('the handler of mailto: by name, with a 32px icon', async () => {
            const s = source({ info: { name: platform === 'darwin' ? 'Mail.app' : 'Outlook', icon: icon() } });
            assert.deepEqual(await defaultMailApp(platform, s), {
                name: platform === 'darwin' ? 'Mail' : 'Outlook',
                icon: 'data:image/png;base64,32x32',
            });
            assert.deepEqual(s.asked, ['mailto://'], 'asks with a whole URL, as Electron wants');
        });
        test('an empty icon is left out', async () => {
            assert.deepEqual(await defaultMailApp(platform, source({ info: { name: 'Thunderbird', icon: icon(true) } })), { name: 'Thunderbird' });
        });
        test('no info to be had: the name alone, then none', async () => {
            assert.deepEqual(await defaultMailApp(platform, source({ infoError: new Error('no handler'), name: 'Spark.app' })), { name: 'Spark' });
            assert.equal(await defaultMailApp(platform, source({ infoError: new Error('no handler'), name: '' })), null);
            assert.equal(await defaultMailApp(platform, source({ infoError: new Error('x'), nameError: new Error('y') })), null);
        });
        test('a handler with no name is none', async () => {
            assert.equal(await defaultMailApp(platform, source({ info: { name: '  ', icon: icon() } })), null);
        });
    });
}

describe('defaultMailApp elsewhere', () => {
    test('a platform Natively does not ship on reports none, without asking', async () => {
        const s = source({ info: { name: 'Evolution', icon: icon() } });
        assert.equal(await defaultMailApp('linux', s), null);
        assert.deepEqual(s.asked, []);
    });
});
