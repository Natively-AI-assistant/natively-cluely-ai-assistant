import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildProfileJitPrompt, escapeProfileJitXml } = require('../../../dist-electron/electron/llm/ProfileJitPromptBuilder.js');
const { selectManualProfileEvidence } = require('../../../dist-electron/electron/llm/manualProfileIntelligence.js');

const PROFILE = {
  identity: { name: 'Evin John' },
  skills: { languages: ['Python', 'TypeScript'], frameworks: ['React'] },
  education: [{ institution: 'State University', degree: 'BS', field: 'Computer Science', cgpa: '7.5/10' }],
  projects: [{ name: 'Revenue Forecasting', description: 'Predicted revenue with Python', technologies: ['Python'] }],
};

describe('ProfileJitPromptBuilder', () => {
  test('includes exact question and allowed evidence in a compact JIT prompt', () => {
    const question = 'What CGPA is listed in my profile?';
    const evidence = selectManualProfileEvidence({ question, profile: PROFILE, jobDescription: null, source: 'manual_input' });
    assert.ok(evidence);
    const prompt = buildProfileJitPrompt({
      question,
      answerType: evidence.answerType,
      answerShape: evidence.answerShape,
      sourceOwner: evidence.sourceOwner,
      evidence,
      maxAnswerWords: 40,
    });

    assert.equal(prompt.exactQuestionIncluded, true);
    assert.ok(prompt.evidenceItemCount > 0);
    assert.match(prompt.userPrompt, /<question trust="untrusted" data_only="true">What CGPA is listed in my profile\?<\/question>/);
    assert.match(prompt.userPrompt, /7\.5\/10/);
    assert.match(prompt.userPrompt, /Answer only from allowed_evidence/);
    assert.ok(prompt.promptChars < 5000, `prompt should stay compact, got ${prompt.promptChars}`);
  });

  test('filters forbidden evidence sources by source contract', () => {
    const evidence = {
      answerType: 'jd_fit_answer',
      answerShape: 'jd_fit_answer',
      sourceOwner: 'profile',
      items: [
        { field: 'identity.name', value: 'Evin John', sourceKind: 'profile_resume', confidence: 'high', sourceRef: 'identity:name' },
        { field: 'job.title', value: 'Data Analyst', sourceKind: 'profile_jd', confidence: 'high', sourceRef: 'jd:title' },
      ],
      checkedSources: ['profile_resume', 'profile_jd'],
    };
    const prompt = buildProfileJitPrompt({
      question: 'How do I fit this role?',
      answerType: 'jd_fit_answer',
      sourceOwner: 'profile',
      evidence,
      contract: {
        allowedSources: ['profile_resume'],
        forbiddenSources: ['profile_jd'],
        sourceAuthority: 'profile_only',
      },
    });
    assert.equal(prompt.evidenceItemCount, 1);
    assert.match(prompt.userPrompt, /Evin John/);
    assert.doesNotMatch(prompt.userPrompt, /Data Analyst/);
    assert.deepEqual(prompt.allowedSourceKinds, ['profile_resume']);
  });

  test('missing-info prompt tells provider to state absence, not invent filler', () => {
    const evidence = selectManualProfileEvidence({
      question: 'What is my expected salary?',
      profile: PROFILE,
      jobDescription: null,
      source: 'manual_input',
    });
    assert.ok(evidence);
    assert.equal(evidence.missingInfoDetected, true);
    const prompt = buildProfileJitPrompt({
      question: 'What is my expected salary?',
      answerType: evidence.answerType,
      sourceOwner: 'profile',
      evidence,
    });
    assert.equal(prompt.evidenceItemCount, 0);
    assert.match(prompt.userPrompt, /<missing_info>/);
    assert.match(prompt.userPrompt, /honest absence statement/);
    assert.match(prompt.userPrompt, /Do not infer/);
    assert.match(prompt.userPrompt, /Do not use generic HR\/interview filler/);
  });

  test('XML escaping protects question and evidence text', () => {
    assert.equal(escapeProfileJitXml('<x & y>'), '&lt;x &amp; y&gt;');
    const prompt = buildProfileJitPrompt({
      question: 'What about <script> & GPA?',
      answerType: 'profile_fact_answer',
      sourceOwner: 'profile',
      evidence: {
        items: [{ field: 'education.note', value: '<unsafe & value>', sourceKind: 'profile_resume', confidence: 'high' }],
        checkedSources: ['profile_resume'],
      },
    });
    assert.match(prompt.userPrompt, /&lt;script&gt; &amp; GPA/);
    assert.match(prompt.userPrompt, /&lt;unsafe &amp; value&gt;/);
  });
});
