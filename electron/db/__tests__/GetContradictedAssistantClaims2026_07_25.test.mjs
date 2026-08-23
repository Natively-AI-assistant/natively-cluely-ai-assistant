// electron/db/__tests__/GetContradictedAssistantClaims2026_07_25.test.mjs
//
// Phase 6 Slice 7 (context-rebuild, RC8): getContradictedAssistantClaims is
// the read-side counterpart to getVerifiedAssistantClaims, added so a
// future precedence check (assistantClaimsPrecedenceCheck.ts) can fetch the
// contradicted-claims corpus. DatabaseManager touches real sqlite
// (ABI-mismatched in this dev environment — established baseline this
// session), so this is source-pinned, mirroring
// GetVerifiedAssistantClaims-style coverage elsewhere in this suite.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '../DatabaseManager.ts'), 'utf8');

describe('DatabaseManager.getContradictedAssistantClaims', () => {
  test('exists, queries validation_status = contradicted, defensive (never throws, returns [] on error)', () => {
    const start = src.indexOf('public getContradictedAssistantClaims(limit = 50): any[] {');
    assert.ok(start >= 0, 'method must exist with this exact signature');
    const end = src.indexOf('\n    }', start);
    const body = src.slice(start, end);
    assert.match(body, /validation_status = 'contradicted'/);
    assert.match(body, /ORDER BY created_at DESC LIMIT \?/);
    assert.match(body, /catch \(e\) \{/);
    assert.match(body, /return \[\];/);
  });

  test('mirrors getVerifiedAssistantClaims\'s shape exactly except for the status filter', () => {
    const verifiedStart = src.indexOf('public getVerifiedAssistantClaims(limit = 50): any[] {');
    const verifiedEnd = src.indexOf('\n    }', verifiedStart);
    const verifiedBody = src.slice(verifiedStart, verifiedEnd);

    const contradictedStart = src.indexOf('public getContradictedAssistantClaims(limit = 50): any[] {');
    const contradictedEnd = src.indexOf('\n    }', contradictedStart);
    const contradictedBody = src.slice(contradictedStart, contradictedEnd);

    const normalize = (body) => body
      .replace(/getVerifiedAssistantClaims|getContradictedAssistantClaims/g, '<METHOD>')
      .replace(/verified|contradicted/gi, '<STATUS>')
      .replace(/\s+/g, ' ');
    assert.equal(normalize(contradictedBody), normalize(verifiedBody));
  });
});
