// Document freshness statuses (2026-09-30).
//
// Documents say they are stale without a "Status:" line, and the model read
// them as current: a partner price sheet "Valid through December 31, 2025"
// quoted as today's price, "DRAFT, not reviewed by attendees" notes stated as
// settled, a policy that says to check for the current version relied on
// (external judge, I5 dev: all capped). Replayed with these statuses and the
// precedence sentence, the expired-sheet answers named the sheet's age and
// offered to confirm today's price 3/3 (0/3 before); the date line alone: 0/3.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = (p) => import(pathToFileURL(path.resolve(process.cwd(), 'dist-electron/electron', p)).href);
const { detectDocumentStatus, parseDocumentDate } = await dist('context-intelligence/retrieval/mode-retrieval-port.js');
const { composePrompt } = await dist('context-intelligence/generation/prompt-composer.js');
const { decide } = await dist('context-intelligence/orchestration/orchestrator.js');
const { resolveModePolicy } = await dist('context-intelligence/policies/mode-policy-registry.js');

const NOW = new Date(2026, 8, 30);

describe('parseDocumentDate', () => {
  test('the shapes documents use', () => {
    assert.equal(parseDocumentDate('December 31, 2025').toDateString(), new Date(2025, 11, 31).toDateString());
    assert.equal(parseDocumentDate('31 December 2025').toDateString(), new Date(2025, 11, 31).toDateString());
    assert.equal(parseDocumentDate('2025-12-31').toDateString(), new Date(2025, 11, 31).toDateString());
    assert.equal(parseDocumentDate('November 2022', true).toDateString(), new Date(2022, 10, 30).toDateString());
    assert.equal(parseDocumentDate('November 2022').toDateString(), new Date(2022, 10, 1).toDateString());
  });
  test('slash dates are ambiguous and not read', () => assert.equal(parseDocumentDate('12/11/2025'), undefined));
});

describe('detectDocumentStatus', () => {
  test('a validity date that has passed is expired', () => {
    assert.equal(detectDocumentStatus('Routewise Partner Price Sheet 2025\nValid through December 31, 2025. For reseller partners.', NOW), 'expired');
    assert.equal(detectDocumentStatus('Promo terms\nThis offer expires on 1 August 2026.', NOW), 'expired');
  });
  test('a validity date still ahead marks nothing', () => {
    assert.equal(detectDocumentStatus('Price sheet\nValid through December 31, 2026.', NOW), undefined);
  });
  test('"check for the current version before relying" is outdated', () => {
    assert.equal(detectDocumentStatus('Support Policy - Version 3.1\nEffective 1 March 2024. Check the Knowledge Base for the current version before relying on this document.', NOW), 'outdated');
  });
  test('a draft is marked only when its content is unconfirmed', () => {
    assert.equal(detectDocumentStatus('Leadership check-in\nThursday 24 September 2026\nNotes by Colin Mercer - DRAFT, not reviewed by attendees', NOW), 'draft');
    assert.equal(detectDocumentStatus('Ph.D. thesis draft, School of Electrical Engineering\nChapter 3', NOW), undefined);
    assert.equal(detectDocumentStatus('Chapter 5 (DRAFT v2 - do not circulate): Results', NOW), undefined);
  });
  test('an old "last updated" date is not a status', () => {
    assert.equal(detectDocumentStatus('Design doc\nAuthor: T. V. | Last updated: 2024-11-18', NOW), undefined);
    assert.equal(detectDocumentStatus('Resume - last updated November 2022', NOW), undefined);
  });
  test('explicit statuses keep precedence', () => {
    assert.equal(detectDocumentStatus('Status: RETIRED. Old pricing.', NOW), 'retired');
    assert.equal(detectDocumentStatus('Status: current\nValid through December 31, 2025.', NOW), 'current');
  });
});

describe('the precedence contract', () => {
  const compose = (status) => composePrompt({
    decision: decide({ requestId: 'r', requestSequence: 1, surface: 'manual_chat', modeId: 'sales', scope: { userId: 'u', modeId: 'sales' }, sessionId: 's', manualQuestion: 'What does Growth cost per seat?' }),
    policy: resolveModePolicy('sales'),
    evidence: [{
      evidenceId: 'e1', sourceType: 'REFERENCE_FILE', sourceId: 'sheet', versionId: 'v1', retrievedVersionId: 'v1', scopeId: 's',
      documentTitle: 'partner-sheet-2025.txt', content: 'Growth: $44 per technician per month.', acceptedFor: ['DOCUMENT_FACT'],
      authorityFor: [], finalScore: 0.9, isDirectFact: true, isInferred: false, trustLevel: 'untrusted_reference',
      metadata: { documentStatus: status },
    }],
  });
  test('an expired document is named, confirmed, and outranked by a current one', () => {
    const { system, user } = compose('expired');
    assert.match(user, /status="expired"/);
    assert.match(system, /A status of expired or outdated means that document's values may no longer hold/);
    assert.match(system, /A draft's decisions are proposed, not settled/);
  });
});
