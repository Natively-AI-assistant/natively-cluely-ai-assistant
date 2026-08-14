// electron/services/__tests__/ProfileGroundingV2Flag.test.mjs
//
// Unit tests for the PROFILE_GROUNDING_V2 flag in isolation. No DB, no async
// orchestrator work — so toggling the process-global env here cannot race any
// other test. Runs under plain node (no Electron ABI needed).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { isProfileGroundingV2Enabled, __resetProfileGroundingV2Cache } = await import(
    pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/profileGroundingV2.js')).href
);

// V2 now ships DEFAULT ON with an explicit "off" kill-switch (mirrors
// verificationEnabled.ts). These tests pin that contract.
describe('PROFILE_GROUNDING_V2 flag (default ON, off-kill-switch)', () => {
    test('default (no env, no settings) → ON', () => {
        delete process.env.PROFILE_GROUNDING_V2;
        __resetProfileGroundingV2Cache();
        assert.equal(isProfileGroundingV2Enabled(), true);
    });

    test('env "off" / "0" / "false" / "disabled" → OFF (kill switch)', () => {
        for (const v of ['off', '0', 'false', 'disabled', 'OFF', 'False']) {
            process.env.PROFILE_GROUNDING_V2 = v;
            __resetProfileGroundingV2Cache();
            assert.equal(isProfileGroundingV2Enabled(), false, `"${v}" must disable`);
        }
    });

    test('env "on" / "" / garbage → ON (only explicit off disables)', () => {
        for (const v of ['on', '1', 'true', '', 'maybe', 'enabled']) {
            process.env.PROFILE_GROUNDING_V2 = v;
            __resetProfileGroundingV2Cache();
            assert.equal(isProfileGroundingV2Enabled(), true, `"${v}" must stay ON`);
        }
        delete process.env.PROFILE_GROUNDING_V2;
        __resetProfileGroundingV2Cache();
    });
});
