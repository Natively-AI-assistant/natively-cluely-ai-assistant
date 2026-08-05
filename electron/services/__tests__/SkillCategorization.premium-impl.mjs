// electron/services/__tests__/SkillCategorization.test.mjs
//
// RC-3 regression: skills were a flat string[] with no sub-categories, so
// "what cloud tools do I know?" returned the entire skill list (languages
// included). These tests pin the categorization layer:
//   - coerceSkills tolerates legacy flat arrays, partial/full objects, undefined
//   - categorizeFlatSkills deterministically buckets known skills, unknown→tools
//   - flattenSkills round-trips
//   - detectSkillCategories maps the user's actual transcript questions to the
//     correct bucket (cloud ≠ languages, ml, etc.)
//
// Pure functions — no DB/Electron — but the compiled module is loaded from
// dist-electron so this also proves skillsUtil compiled and loads.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(
    pathToFileURL(path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/skillsUtil.js')).href
);
const { coerceSkills, flattenSkills, categorizeFlatSkills, classifySkill, detectSkillCategories, isLegacyFlatSkills } = mod;

const ALL_CATS = ['languages', 'frameworks', 'cloud', 'databases', 'ml', 'devops', 'tools'];

describe('RC-3: coerceSkills tolerates every historical shape', () => {
    test('undefined → all-empty categorized object', () => {
        const s = coerceSkills(undefined);
        for (const c of ALL_CATS) assert.deepEqual(s[c], [], `${c} must be []`);
    });

    test('legacy flat array → deterministically categorized, nothing dropped', () => {
        const s = coerceSkills(['Python', 'React', 'AWS', 'PostgreSQL', 'PyTorch', 'Docker', 'Jira']);
        assert.ok(s.languages.includes('Python'));
        assert.ok(s.frameworks.includes('React'));
        assert.ok(s.cloud.includes('AWS'));
        assert.ok(s.databases.includes('PostgreSQL'));
        assert.ok(s.ml.includes('PyTorch'));
        assert.ok(s.devops.includes('Docker'));
        assert.ok(s.tools.includes('Jira'));
        // nothing lost
        assert.equal(flattenSkills(s).length, 7);
    });

    test('partial object → missing keys filled', () => {
        const s = coerceSkills({ languages: ['Go'], cloud: ['GCP'] });
        assert.deepEqual(s.languages, ['Go']);
        assert.deepEqual(s.cloud, ['GCP']);
        assert.deepEqual(s.frameworks, []);
        for (const c of ALL_CATS) assert.ok(Array.isArray(s[c]));
    });

    test('object with unknown category key → folded into tools, not dropped', () => {
        const s = coerceSkills({ languages: ['Rust'], soft_skills: ['Leadership'] });
        assert.ok(s.languages.includes('Rust'));
        assert.ok(s.tools.includes('Leadership'), 'unknown-bucket skills must land in tools');
    });

    test('dedupes within a bucket case-insensitively', () => {
        const s = coerceSkills({ languages: ['Python', 'python', 'PYTHON'] });
        assert.equal(s.languages.length, 1);
    });
});

describe('RC-3: classifySkill buckets correctly (the wrong-field root cause)', () => {
    const cases = [
        ['Python', 'languages'], ['TypeScript', 'languages'], ['Go', 'languages'], ['SQL', 'languages'], ['R', 'languages'],
        ['React', 'frameworks'], ['Next.js', 'frameworks'], ['FastAPI', 'frameworks'], ['Node.js', 'frameworks'], ['Spring Boot', 'frameworks'],
        ['AWS', 'cloud'], ['GCP', 'cloud'], ['Azure', 'cloud'], ['Vercel', 'cloud'], ['Firebase', 'cloud'],
        ['PostgreSQL', 'databases'], ['Redis', 'databases'], ['MongoDB', 'databases'], ['pgvector', 'databases'],
        ['PyTorch', 'ml'], ['TensorFlow', 'ml'], ['LangChain', 'ml'], ['Hugging Face', 'ml'], ['pandas', 'ml'],
        ['Docker', 'devops'], ['Kubernetes', 'devops'], ['Terraform', 'devops'], ['Kafka', 'devops'], ['Datadog', 'devops'],
        ['Git', 'tools'], ['Jira', 'tools'], ['Figma', 'tools'],
    ];
    for (const [skill, expected] of cases) {
        test(`${skill} → ${expected}`, () => {
            assert.equal(classifySkill(skill), expected);
        });
    }

    test('the disambiguation rules: PyTorch is ml not frameworks; Kubernetes is devops not cloud', () => {
        assert.equal(classifySkill('PyTorch'), 'ml');
        assert.equal(classifySkill('Kubernetes'), 'devops');
    });

    test('unknown skill → tools (never dropped)', () => {
        assert.equal(classifySkill('SomeProprietaryThing'), 'tools');
    });
});

describe('RC-3: detectSkillCategories maps the real transcript questions to the RIGHT bucket', () => {
    // These are verbatim from the failing live session.
    test('"What are my main programming languages?" → languages', () => {
        assert.deepEqual(detectSkillCategories('What are my main programming languages?'), ['languages']);
    });
    test('"What cloud or DevOps tools do I know?" → cloud + devops (NOT languages)', () => {
        const cats = detectSkillCategories('What cloud or DevOps tools do I know?');
        assert.ok(cats.includes('cloud'));
        assert.ok(cats.includes('devops'));
        assert.ok(!cats.includes('languages'), 'must NOT map a cloud/devops question to languages — the original bug');
    });
    test('"What AI or machine learning tools are on my resume?" → ml', () => {
        const cats = detectSkillCategories('What AI or machine learning tools are on my resume?');
        assert.ok(cats.includes('ml'));
        assert.ok(!cats.includes('languages'));
    });
    test('generic "what are my skills?" → [] (all buckets)', () => {
        assert.deepEqual(detectSkillCategories('what are my skills?'), []);
    });
});

describe('RC-3: end-to-end bucket isolation (the exact failing query)', () => {
    test('cloud query returns ONLY cloud skills, never the languages list', () => {
        const skills = coerceSkills(['Python', 'TypeScript', 'SQL', 'AWS', 'GCP', 'PostgreSQL']);
        const cats = detectSkillCategories('What cloud or DevOps tools do I know?');
        const returned = cats.flatMap(c => skills[c]);
        assert.ok(returned.includes('AWS'));
        assert.ok(returned.includes('GCP'));
        // The original bug: languages leaking into a cloud answer.
        assert.ok(!returned.includes('Python'), 'Python must NOT appear in a cloud-tools answer');
        assert.ok(!returned.includes('TypeScript'));
        assert.ok(!returned.includes('SQL'));
    });
});

describe('RC-3: isLegacyFlatSkills', () => {
    test('array is legacy', () => assert.equal(isLegacyFlatSkills(['Python']), true));
    test('object is not legacy', () => assert.equal(isLegacyFlatSkills({ languages: [] }), false));
    test('undefined is not legacy', () => assert.equal(isLegacyFlatSkills(undefined), false));
});
