// F-BND-04 (live-pipeline forensics, 2026-11-13): the "Profile & history"
// cloud data scope was not applied to premium generation calls (JIT intro,
// salary estimate, live coaching, company research, résumé/JD extraction all
// go through LLMHelper.generateContentStructured), and the legacy scrubber
// keyed only on `<candidate_` / `<user_context`, so premium blocks such as
// `<target_job>` or `<salary_intelligence>` survived a denial.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();
const { LLMHelper } = require(path.join(root, 'dist-electron/electron/LLMHelper.js'));
const call = (name, self, ...args) => LLMHelper.prototype[name].call(self, ...args);

function fakeHelper({ policy, ollama = false }) {
  const self = Object.create(LLMHelper.prototype);
  const sent = [];
  self.getProviderScopePolicy = () => policy;
  self.useOllama = ollama;
  self.ensureOllamaModelSelected = async () => ollama;
  self.logScopeFallback = () => {};
  self.callOllama = async (m) => { sent.push({ provider: 'ollama', m }); return 'local reply'; };
  self.processResponse = (t) => t;
  // A cloud rung that records what it would have sent.
  self.openaiClient = {};
  self.generateWithOpenai = async (m) => { sent.push({ provider: 'openai', m }); return 'cloud reply'; };
  return { self, sent };
}

describe('premium generation honours the profile_history scope (F-BND-04)', () => {
  test('denied + no local model: nothing is sent to a cloud provider', async () => {
    const { self, sent } = fakeHelper({ policy: { profile_history: false } });
    await assert.rejects(
      () => call('generateContentStructured', self, 'Résumé: Jordan Rivera, Northwind Freight', { dataScopes: ['profile_history'] }),
      /privacy setting/i,
    );
    assert.equal(sent.filter((s) => s.provider !== 'ollama').length, 0, 'profile data reached a cloud provider');
  });

  test('denied + local model available: routed to the local model', async () => {
    const { self, sent } = fakeHelper({ policy: { profile_history: false }, ollama: true });
    const out = await call('generateContentStructured', self, 'Résumé: Jordan Rivera', { dataScopes: ['profile_history'] });
    assert.equal(out, 'local reply');
    assert.deepEqual(sent.map((s) => s.provider), ['ollama']);
  });

  test('allowed: the cloud ladder runs as before', async () => {
    const { self, sent } = fakeHelper({ policy: {} });
    const out = await call('generateContentStructured', self, 'Résumé: Jordan Rivera', { dataScopes: ['profile_history'] });
    assert.equal(out, 'cloud reply');
    assert.deepEqual(sent.map((s) => s.provider), ['openai']);
  });

  test('main.ts declares profile_history on both premium generation functions', () => {
    const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
    const hits = main.match(/generateContentStructured\(joinContents\(contents\), \{ dataScopes: \['profile_history'\] \}\)/g) || [];
    assert.equal(hits.length, 2, 'setGenerateContentFn and setLiveCoachingContentFn must both declare the scope');
  });
});

describe('the scrubber removes premium profile blocks (F-BND-04 / A5 D7)', () => {
  const premiumBlocks = [
    '<target_job>\nStaff Engineer at Kestrel Labs\n</target_job>',
    '<target_job_context>\nKestrel Labs JD\n</target_job_context>',
    '<salary_intelligence>\n$180k-$220k\n</salary_intelligence>',
    '<company_research>\nKestrel Labs dossier\n</company_research>',
    '<gap_pivot_scripts>\npivot\n</gap_pivot_scripts>',
    '<mock_question_hint>\nkey points\n</mock_question_hint>',
    '<culture_alignment company="Kestrel">\nvalues\n</culture_alignment>',
    '<live_negotiation_state>\nanchor 120k\n</live_negotiation_state>',
    '<profile_jit_evidence_request>\nJordan Rivera facts\n</profile_jit_evidence_request>',
  ];
  for (const block of premiumBlocks) {
    const tag = /<([a-z_]+)/.exec(block)[1];
    test(`${tag} is stripped when profile_history is denied`, () => {
      const msg = `${block}\n\nUSER QUESTION:\nwhy this role?`;
      const out = call('stripDeniedScopedBlocksFromMessage', Object.create(LLMHelper.prototype), msg, ['profile_history']);
      assert.ok(!out.includes(`<${tag}`), `${tag} survived the profile_history denial`);
      assert.match(out, /why this role\?/);
    });
    test(`${tag} is inferred as profile_history`, () => {
      const scopes = call('inferEmbeddedMessageScopes', Object.create(LLMHelper.prototype), block);
      assert.ok(scopes.includes('profile_history'), `${tag} not inferred`);
    });
  }
  test('a message with no premium block is unchanged', () => {
    const msg = 'USER QUESTION:\nwhat is a mutex?';
    assert.equal(call('stripDeniedScopedBlocksFromMessage', Object.create(LLMHelper.prototype), msg, ['profile_history']), msg);
  });
});
