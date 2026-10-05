// Covers electron/services/meeting/MeetingRecipes.ts: the built-in recipe list,
// generateRecipe (one renderer per recipe) and generateBuiltInRecipes (mode filter).
// Run from the repo root: node --test electron/services/__tests__/MeetingRecipes.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const { BUILT_IN_RECIPES, generateRecipe, generateBuiltInRecipes } = require(
    path.join(repoRoot, 'dist-electron/electron/services/meeting/MeetingRecipes.js'),
);
const { buildFollowUpBody } = require(
    path.join(repoRoot, 'dist-electron/electron/services/meeting/MeetingSummaryReducer.js'),
);

const section = (title, ...bullets) => ({ title, bullets: bullets.map(text => ({ text })) });

function makeSummary(overrides = {}) {
    return {
        title: 'Q3 Pricing Sync',
        overview: 'Discussed the move to tiered pricing.',
        tldr: ['Pricing moves to tiers', 'Launch in October'],
        decisions: [{ text: 'Adopt tiered pricing' }],
        actionItems: [
            { text: 'Draft pricing page', owner: 'Ana', deadline: 'Friday' },
            { text: 'Email customers' },
        ],
        risks: [{ text: 'Churn from legacy users', severity: 'high' }],
        openQuestions: [{ text: 'Who owns billing migration?' }],
        sections: [],
        ...overrides,
    };
}

const EMPTY = {
    title: '', overview: '', tldr: [], decisions: [], actionItems: [], risks: [], openQuestions: [], sections: [],
};

// The bullet lines directly under `heading`, up to the next blank line.
function block(output, heading) {
    const lines = output.split('\n');
    const start = lines.indexOf(heading);
    assert.notEqual(start, -1, `heading not found: ${heading}`);
    const out = [];
    for (let i = start + 1; i < lines.length && lines[i] !== ''; i++) out.push(lines[i]);
    return out;
}

const NONE = ['- None captured'];

describe('BUILT_IN_RECIPES', () => {
    test('ids are unique and every entry has a label', () => {
        const ids = BUILT_IN_RECIPES.map(r => r.id);
        assert.equal(new Set(ids).size, ids.length);
        assert.equal(ids.length, 10);
        for (const recipe of BUILT_IN_RECIPES) {
            assert.equal(typeof recipe.label, 'string');
            assert.ok(recipe.label.length > 0);
        }
    });

    test('every listed recipe renders a non-empty string', () => {
        for (const recipe of BUILT_IN_RECIPES) {
            const out = generateRecipe(makeSummary(), recipe.id);
            assert.equal(typeof out, 'string', recipe.id);
            assert.ok(out.trim().length > 0, recipe.id);
        }
    });
});

describe('generateRecipe: follow-up-email', () => {
    test('uses the stored follow-up draft body when there is one', () => {
        const summary = makeSummary({ followUpDraft: { body: 'Hi Sam,\n\nGreat chat.' } });
        assert.equal(generateRecipe(summary, 'follow-up-email'), 'Hi Sam,\n\nGreat chat.');
    });

    test('falls back to the deterministic body when the draft is missing or empty', () => {
        const summary = makeSummary();
        const expected = buildFollowUpBody(summary.decisions, summary.actionItems, undefined);
        assert.equal(generateRecipe(summary, 'follow-up-email'), expected);
        assert.equal(generateRecipe({ ...summary, followUpDraft: { body: '' } }, 'follow-up-email'), expected);
        assert.equal(generateRecipe({ ...summary, followUpDraft: {} }, 'follow-up-email'), expected);
        assert.match(expected, /^Hi team,/);
        assert.ok(expected.includes('- Adopt tiered pricing'));
    });

    test('the fallback follows the summary mode, preferring summaryModeUsed', () => {
        const base = makeSummary();
        const both = generateRecipe(
            { ...base, mode: { summaryModeUsed: 'sales', selectedModeId: 'lecture' } }, 'follow-up-email');
        assert.equal(both, buildFollowUpBody(base.decisions, base.actionItems, 'sales'));
        assert.match(both, /^Hi there,/);
        assert.ok(both.includes('What we aligned on:'));

        const selectedOnly = generateRecipe({ ...base, mode: { selectedModeId: 'lecture' } }, 'follow-up-email');
        assert.equal(selectedOnly, buildFollowUpBody(base.decisions, base.actionItems, 'lecture'));
        assert.match(selectedOnly, /^Study recap:/);
        assert.notEqual(selectedOnly, both);
    });
});

describe('generateRecipe: slack-update', () => {
    test('renders title, TLDR, decisions and owner/deadline-decorated next steps', () => {
        assert.equal(generateRecipe(makeSummary(), 'slack-update'), [
            '*Q3 Pricing Sync*',
            '',
            '*TLDR*',
            '- Pricing moves to tiers',
            '- Launch in October',
            '',
            '*Decisions*',
            '- Adopt tiered pricing',
            '',
            '*Next steps*',
            '- Ana: Draft pricing page — Friday',
            '- Email customers',
        ].join('\n'));
    });

    test('an empty summary gets a default title and "None captured" everywhere', () => {
        assert.equal(generateRecipe(EMPTY, 'slack-update'), [
            '*Meeting update*', '', '*TLDR*', '- None captured', '', '*Decisions*', '- None captured',
            '', '*Next steps*', '- None captured',
        ].join('\n'));
    });

    test('owner without deadline and deadline without owner', () => {
        const out = generateRecipe(makeSummary({
            actionItems: [{ text: 'Ship it', owner: 'Bo' }, { text: 'Review', deadline: 'Monday' }],
        }), 'slack-update');
        assert.deepEqual(block(out, '*Next steps*'), ['- Bo: Ship it', '- Review — Monday']);
    });
});

describe('generateRecipe: project-update', () => {
    test('renders all five sections', () => {
        assert.equal(generateRecipe(makeSummary(), 'project-update'), [
            '# Project Update',
            '',
            '## What changed',
            '- Pricing moves to tiers',
            '- Launch in October',
            '',
            '## Decisions',
            '- Adopt tiered pricing',
            '',
            '## Owners / next steps',
            '- Ana — Draft pricing page (Friday)',
            '- Unassigned — Email customers',
            '',
            '## Risks / blockers',
            '- [high] Churn from legacy users',
            '',
            '## Open questions',
            '- Who owns billing migration?',
        ].join('\n'));
    });

    test('empty summary: every section says None captured', () => {
        const out = generateRecipe(EMPTY, 'project-update');
        for (const heading of ['## What changed', '## Decisions', '## Owners / next steps', '## Risks / blockers', '## Open questions']) {
            assert.deepEqual(block(out, heading), NONE, heading);
        }
    });
});

describe('generateRecipe: crm-note', () => {
    const summary = makeSummary({
        sections: [
            section('Customer pain points', 'Manual invoicing is slow'),
            section('DISCOVERY', 'Team of 40 reps'),
            section('Objections', 'Too expensive', 'Security review needed'),
            section('Buying signals', 'Asked for a contract'),
            section('Small talk', 'Weather'),
        ],
    });

    test('routes section bullets by title, case-insensitively', () => {
        const out = generateRecipe(summary, 'crm-note');
        assert.ok(out.startsWith('## CRM Note\n\nSummary: Discussed the move to tiered pricing.\n'));
        assert.deepEqual(block(out, 'Pain / needs:'), ['- Manual invoicing is slow', '- Team of 40 reps']);
        assert.deepEqual(block(out, 'Objections:'), ['- Too expensive', '- Security review needed']);
        assert.deepEqual(block(out, 'Buying signals:'), ['- Asked for a contract']);
        assert.deepEqual(block(out, 'Next steps:'), ['- Ana — Draft pricing page (Friday)', '- Unassigned — Email customers']);
        assert.ok(!out.includes('Weather'));
    });

    test('no matching sections and no action items', () => {
        const out = generateRecipe({ ...EMPTY, overview: 'Short call.' }, 'crm-note');
        assert.ok(out.includes('Summary: Short call.'));
        for (const heading of ['Pain / needs:', 'Objections:', 'Buying signals:', 'Next steps:']) {
            assert.deepEqual(block(out, heading), NONE, heading);
        }
    });
});

describe('generateRecipe: investor-update', () => {
    test('renders highlights, decisions, severity-tagged risks and bare asks', () => {
        assert.equal(generateRecipe(makeSummary(), 'investor-update'), [
            '# Investor Update',
            '',
            '## Highlights',
            '- Pricing moves to tiers',
            '- Launch in October',
            '',
            '## Key decisions',
            '- Adopt tiered pricing',
            '',
            '## Risks',
            '- [high] Churn from legacy users',
            '',
            '## Asks / next steps',
            '- Draft pricing page',
            '- Email customers',
        ].join('\n'));
    });
});

describe('generateRecipe: recruiting-scorecard', () => {
    test('routes sections and appends risks to concerns', () => {
        const out = generateRecipe(makeSummary({
            sections: [
                section('Candidate background', '8 years backend'),
                section('Strengths', 'Clear communicator'),
                section('Role fit', 'Matches the platform team'),
                section('Concerns', 'Little frontend exposure'),
                section('Compensation & timeline', 'Can start in March'),
            ],
            risks: [{ text: 'Competing offer', severity: 'medium' }],
        }), 'recruiting-scorecard');
        assert.ok(out.startsWith('# Recruiting Scorecard\n'));
        assert.deepEqual(block(out, '## Candidate profile'), ['- 8 years backend']);
        assert.deepEqual(block(out, '## Strengths'), ['- Clear communicator', '- Matches the platform team']);
        assert.deepEqual(block(out, '## Concerns'), ['- Little frontend exposure', '- Competing offer']);
        assert.deepEqual(block(out, '## Logistics'), ['- Can start in March']);
        assert.deepEqual(block(out, '## Next steps'), ['- Draft pricing page', '- Email customers']);
    });

    test('concerns fall back to None captured only when both sources are empty', () => {
        assert.deepEqual(block(generateRecipe(EMPTY, 'recruiting-scorecard'), '## Concerns'), NONE);
        const risksOnly = generateRecipe({ ...EMPTY, risks: [{ text: 'Notice period', severity: 'low' }] }, 'recruiting-scorecard');
        assert.deepEqual(block(risksOnly, '## Concerns'), ['- Notice period']);
    });
});

describe('generateRecipe: lecture-study-notes', () => {
    test('routes concepts and examples, lists open questions and the summary', () => {
        const out = generateRecipe(makeSummary({
            sections: [
                section('Core concepts', 'Entropy measures disorder'),
                section('Definitions', 'Enthalpy: heat content'),
                section('Worked example', 'Ice melting at 0C'),
                section('Admin', 'Exam is on week 9'),
            ],
        }), 'lecture-study-notes');
        assert.ok(out.startsWith('# Lecture Study Notes\n'));
        assert.deepEqual(block(out, '## Core concepts'), ['- Entropy measures disorder', '- Enthalpy: heat content']);
        assert.deepEqual(block(out, '## Examples / steps'), ['- Ice melting at 0C']);
        assert.deepEqual(block(out, '## Questions to review'), ['- Who owns billing migration?']);
        assert.deepEqual(block(out, '## Study summary'), ['- Pricing moves to tiers', '- Launch in October']);
        assert.ok(!out.includes('Exam is on week 9'));
    });
});

describe('generateRecipe: technical-interview-feedback', () => {
    test('routes each rubric section', () => {
        const out = generateRecipe(makeSummary({
            sections: [
                section('Problem & approach', 'Two-pointer solution'),
                section('Correctness', 'Missed the empty-array case'),
                section('Complexity', 'O(n) time'),
                section('Code quality', 'Readable naming'),
                section('Hiring signal', 'Lean hire'),
            ],
        }), 'technical-interview-feedback');
        assert.ok(out.startsWith('# Technical Interview Feedback\n'));
        assert.deepEqual(block(out, '## Problem / approach'), ['- Two-pointer solution']);
        assert.deepEqual(block(out, '## Correctness / complexity'), ['- Missed the empty-array case', '- O(n) time']);
        assert.deepEqual(block(out, '## Communication / code quality'), ['- Readable naming']);
        assert.deepEqual(block(out, '## Hiring signal'), ['- Lean hire']);
        assert.deepEqual(block(out, '## Follow-up'), ['- Draft pricing page', '- Email customers']);
    });
});

describe('generateRecipe: sales-meddic', () => {
    test('a Budget section feeds both Metrics and Economic buyer; decisions join criteria', () => {
        const out = generateRecipe(makeSummary({
            sections: [
                section('Budget', '$50k approved'),
                section('Decision process', 'Legal signs off last'),
                section('Pain', 'Reps lose 5h a week'),
            ],
        }), 'sales-meddic');
        assert.ok(out.startsWith('# MEDDIC Summary\n'));
        assert.deepEqual(block(out, '## Metrics'), ['- $50k approved']);
        assert.deepEqual(block(out, '## Economic buyer / authority'), ['- $50k approved']);
        assert.deepEqual(block(out, '## Decision criteria / process'), ['- Legal signs off last', '- Adopt tiered pricing']);
        assert.deepEqual(block(out, '## Identify pain'), ['- Reps lose 5h a week']);
        assert.deepEqual(block(out, '## Champion / next steps'), ['- Ana — Draft pricing page', '- Unassigned — Email customers']);
    });

    test('empty summary', () => {
        const out = generateRecipe(EMPTY, 'sales-meddic');
        for (const heading of ['## Metrics', '## Economic buyer / authority', '## Decision criteria / process', '## Identify pain', '## Champion / next steps']) {
            assert.deepEqual(block(out, heading), NONE, heading);
        }
    });
});

describe('generateRecipe: customer-feedback', () => {
    test('routes requests and objections, appends risks', () => {
        const out = generateRecipe(makeSummary({
            sections: [
                section('Feature requests', 'CSV export'),
                section('Concerns', 'Onboarding takes too long'),
            ],
        }), 'customer-feedback');
        assert.equal(out, [
            '# Customer Feedback',
            '',
            '## Feature requests / needs',
            '- CSV export',
            '',
            '## Objections / risks',
            '- Onboarding takes too long',
            '- Churn from legacy users',
            '',
            '## Follow-up',
            '- Draft pricing page',
            '- Email customers',
        ].join('\n'));
    });
});

describe('generateBuiltInRecipes', () => {
    const keys = (mode, ...rest) => Object.keys(generateBuiltInRecipes(makeSummary(), mode, ...rest));
    const ALWAYS = ['follow-up-email', 'slack-update', 'investor-update'];

    test('no mode (undefined, null, empty): only the mode-agnostic recipes', () => {
        assert.deepEqual(Object.keys(generateBuiltInRecipes(makeSummary())), ALWAYS);
        assert.deepEqual(keys(null), ALWAYS);
        assert.deepEqual(keys(''), ALWAYS);
    });

    test('an unknown mode adds nothing', () => {
        assert.deepEqual(keys('not-a-mode'), ALWAYS);
    });

    test('each mode adds its own recipes, in BUILT_IN_RECIPES order', () => {
        assert.deepEqual(keys('general'), ['follow-up-email', 'slack-update', 'project-update', 'investor-update', 'customer-feedback']);
        assert.deepEqual(keys('team-meet'), ['follow-up-email', 'slack-update', 'project-update', 'investor-update']);
        assert.deepEqual(keys('sales'), ['follow-up-email', 'slack-update', 'crm-note', 'investor-update', 'sales-meddic', 'customer-feedback']);
        assert.deepEqual(keys('recruiting'), ['follow-up-email', 'slack-update', 'investor-update', 'recruiting-scorecard']);
        assert.deepEqual(keys('lecture'), ['follow-up-email', 'slack-update', 'investor-update', 'lecture-study-notes']);
        assert.deepEqual(keys('technical-interview'), ['follow-up-email', 'slack-update', 'investor-update', 'technical-interview-feedback']);
    });

    test('mode matching is exact (case-sensitive)', () => {
        assert.deepEqual(keys('Sales'), ALWAYS);
    });

    test('values equal generateRecipe output, trimmed', () => {
        const summary = makeSummary({ followUpDraft: { body: '\n  Hello there.  \n' } });
        const out = generateBuiltInRecipes(summary, 'sales');
        assert.equal(out['follow-up-email'], 'Hello there.');
        for (const id of Object.keys(out)) {
            assert.equal(out[id], generateRecipe(summary, id).trim(), id);
        }
    });

    test('an empty summary still yields the three mode-agnostic recipes', () => {
        const out = generateBuiltInRecipes(EMPTY);
        assert.deepEqual(Object.keys(out), ALWAYS);
        for (const value of Object.values(out)) assert.ok(value.length > 0);
    });

    test('does not mutate the summary', () => {
        const summary = makeSummary({ sections: [section('Pain', 'Slow')] });
        const before = JSON.stringify(summary);
        generateBuiltInRecipes(summary, 'sales');
        assert.equal(JSON.stringify(summary), before);
    });
});
